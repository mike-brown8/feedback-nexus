import express from 'express'
import path from 'path'
import fs from 'fs'
import { getDb } from '../lib/db.js'
import { config } from '../../config.js'
import { formatDayUTC8, ensureUploadPath, saveUploadedFile, similarity } from '../lib/utils.js'
import { createEmbedding, createChatCompletion, describeImage } from '../lib/ai.js'
import { logger } from '../lib/logger.js'

export const feedbackRouter = express.Router()

// ---- 序列队列：保证起名/摘要操作排队执行，避免竞态条件 ----
class SerialQueue {
  constructor() {
    this._chain = Promise.resolve()
  }
  enqueue(fn) {
    return new Promise((resolve, reject) => {
      this._chain = this._chain
        .then(() => fn())
        .then(resolve)
        .catch(reject)
    })
  }
}

const namingQueue = new SerialQueue()

// ---- 辅助函数 ----

// 图片服务状态查询（前端在页面加载时调用）
feedbackRouter.get('/image-status', (req, res) => {
  const apiKey = config.aiImage.apiKey || config.arkApiKey
  const available = !!(apiKey && config.aiImage.baseUrl)
  res.json({ available, maxDailyUploads: config.maxDailyFeedbacks })
})

function getUserById(userId) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId)
}

function getDailyUploadCount(userId, day) {
  const row = getDb().prepare('SELECT count FROM daily_uploads WHERE user_id = ? AND day = ?').get(userId, day)
  return row ? row.count : 0
}

function incrementDailyUploadCount(userId, day, increment) {
  const db = getDb()
  const existing = db.prepare('SELECT count FROM daily_uploads WHERE user_id = ? AND day = ?').get(userId, day)
  if (existing) {
    db.prepare('UPDATE daily_uploads SET count = count + ? WHERE user_id = ? AND day = ?').run(increment, userId, day)
  } else {
    db.prepare('INSERT INTO daily_uploads (user_id, day, count) VALUES (?, ?, ?)').run(userId, day, increment)
  }
}

function getIssueFeedbackCount(issueId) {
  const row = getDb().prepare('SELECT COUNT(*) as total FROM feedbacks WHERE issue_id = ?').get(issueId)
  return row?.total || 0
}

function saveIssueEmbedding(issueId, embedding) {
  const db = getDb()
  const text = JSON.stringify(embedding)
  db.prepare('INSERT OR REPLACE INTO issue_embeddings (issue_id, embedding) VALUES (?, ?)').run(issueId, text)
}

/**
 * 调用起名模型生成标题和描述（JSON 格式，通过提示词实现）
 * 输出格式：{"title": "xxx", "desc": "xxxx", "category": "bug|suggestion|other"}
 * 自动重试最多 2 次（共 3 次尝试）。
 * 注意：此函数自身不包含队列，由调用方通过 namingQueue.enqueue 确保序列执行。
 */
async function _buildIssueSummary(content) {
  const systemPrompt = `你是一个问题摘要生成助手。请严格遵循以下规则：
1. 必须以严格的 JSON 格式输出，格式为 {"title": "xxx", "desc": "xxx", "category": "bug|suggestion|other"}，不要包含任何其他内容。
2. 标题控制在 15 字以内，简明扼要，让人一眼看懂是什么问题。
3. 描述控制在 60 字以内，一句话说清问题现象。如需换行用 \\n 表示。
4. 禁止提及或暗示任何人数、影响面、频率、情绪词语（如"已有多人"、"大量用户"、"频繁"、"糟糕"、"影响范围大"等）。
5. 只客观描述问题本身，不推测原因，不给出解决方案。
6. category 根据文本内容判断：反馈程序错误/异常 → "bug"；提出新功能/改进 → "suggestion"；其他 → "other"`

  const userPrompt = `根据下面的反馈文本生成一个简洁标题、描述和分类。请以 JSON 格式输出：{"title": "标题", "desc": "描述", "category": "bug|suggestion|other"}

文本：
${content}`

  let lastError
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        logger.info(`_buildIssueSummary 第 ${attempt + 1} 次重试...`)
      }
      const result = await createChatCompletion(
        [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
        {}
      )
      const cleaned = result.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      const parsed = JSON.parse(cleaned)
      if (!parsed.title || !parsed.desc) {
        throw new Error(`JSON 缺少必需字段: ${JSON.stringify(parsed)}`)
      }
      const category = (parsed.category || 'other').toLowerCase()
      const prefix = category === 'bug' ? '【BUG】' : category === 'suggestion' ? '【建议】' : '【其他】'
      return {
        title: `${prefix}${parsed.title.trim()}`,
        description: parsed.desc.trim(),
        category
      }
    } catch (err) {
      lastError = err
      logger.warn(`_buildIssueSummary 第 ${attempt + 1} 次尝试失败: ${err.message}`)
    }
  }
  throw new Error(`_buildIssueSummary 重试 3 次后仍失败: ${lastError.message}`)
}

/** 通过序列队列包装的 buildIssueSummary */
async function buildIssueSummary(content) {
  return namingQueue.enqueue(() => _buildIssueSummary(content))
}

/**
 * 重新优化草稿摘要（每累计 5 条反馈触发一次）。
 * 通过命名队列序列执行，避免与创建新 issue 的起名操作竞态。
 * 内部调用 _buildIssueSummary 而非 buildIssueSummary，避免重复入队。
 */
async function refreshDraftSummary(issueId) {
  return namingQueue.enqueue(async () => {
    const db = getDb()
    const rows = db.prepare('SELECT content FROM feedbacks WHERE issue_id = ?').all(issueId)
    const content = rows.map(r => r.content).join('\n\n')
    if (!content) return
    const summary = await _buildIssueSummary(content)
    db.prepare('UPDATE issues SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(summary.title, summary.description, issueId)
    logger.info(`Draft #${issueId} summary refreshed (title: ${summary.title})`)
  })
}

async function processNewFeedback(issueId) {
  const db = getDb()
  const issue = db.prepare('SELECT status FROM issues WHERE id = ?').get(issueId)
  if (!issue || issue.status !== 'draft') return
  const count = getIssueFeedbackCount(issueId)
  // 第一个反馈在 processFeedbackAsync 的 else 分支通过 buildIssueSummary 起名
  // 之后每累计 5 条反馈（count=5,10,15,...）触发重新优化
  if (count % 5 === 0) {
    await refreshDraftSummary(issueId)
  }
}

function createDraftIssue(title, description, category) {
  const db = getDb()
  const info = db.prepare('INSERT INTO issues (title, description, category, status, is_public) VALUES (?, ?, ?, ?, 0)').run(title, description, category || 'other', 'draft')
  return info.lastInsertRowid
}

async function clusterFeedback(fullContent) {
  const embedding = await createEmbedding(fullContent)
  const db = getDb()
  const draftIssues = db.prepare('SELECT id, title, description, status FROM issues WHERE status = ?').all('draft')
  const publicIssues = db.prepare('SELECT id, title, description, status FROM issues WHERE status != ?').all('draft')
  const candidates = [...draftIssues, ...publicIssues]
  const scored = []
  for (const issue of candidates) {
    const row = db.prepare('SELECT embedding FROM issue_embeddings WHERE issue_id = ?').get(issue.id)
    if (!row) continue
    const vector = JSON.parse(row.embedding)
    scored.push({ issue, similarity: similarity(embedding, vector), isDraft: issue.status === 'draft' })
  }
  if (!scored.length) return null
  scored.sort((a, b) => b.similarity - a.similarity)
  const threshold = config.aiClusterSimilarityThreshold
  const draftMatch = scored.find(item => item.isDraft && item.similarity > threshold)
  if (draftMatch) return draftMatch.issue
  const best = scored[0]
  return best.similarity > threshold ? best.issue : null
}

feedbackRouter.post('/', async (req, res) => {
  try {
    const user = getUserById(req.user.userId)
    if (!user) return res.status(401).json({ error: 'User not found' })
    const text = String(req.body.text || '').trim()
    if (text.length > 800) {
      return res.status(400).json({ error: '反馈文本不能超过 800 字' })
    }
    const rawFile = Array.isArray(req.files?.images) ? req.files.images[0] : req.files?.images || null
    const files = rawFile ? [rawFile] : []
    if (!text && !files.length) {
      return res.status(400).json({ error: '请填写问题描述或上传图片' })
    }

    // 图片校验
    if (files.length > 0) {
      const imageApiKey = config.aiImage.apiKey || config.arkApiKey
      if (!imageApiKey) {
        return res.status(400).json({ error: '图片描述服务未配置，暂不支持上传图片。请仅提交文本反馈。' })
      }
      if (files.length > 1) {
        return res.status(400).json({ error: '每次仅能上传 1 张图片' })
      }
      const file = files[0]
      if (file.size > 5 * 1024 * 1024) {
        return res.status(400).json({ error: '图片超过 5MB 限制' })
      }
      const ext = (file.name || file.mimetype || '').toLowerCase()
      const isAllowed = ext.endsWith('.jpg') || ext.endsWith('.jpeg') || ext.endsWith('.png') ||
        file.mimetype === 'image/jpeg' || file.mimetype === 'image/png'
      if (!isAllowed) {
        return res.status(400).json({ error: '仅支持 JPG/JPEG/PNG 格式的图片' })
      }
    }

    const day = formatDayUTC8()
    const currentCount = getDailyUploadCount(user.id, day)
    if (currentCount + files.length > config.maxDailyFeedbacks) {
      return res.status(400).json({ error: `今日反馈已达上限（每日最多 ${config.maxDailyFeedbacks} 条）` })
    }

    // 1. 先保存原始反馈（无 issue_id，state=pending）
    const db = getDb()
    const rawInsert = db.prepare('INSERT INTO feedbacks (user_id, content, image_count, state) VALUES (?, ?, ?, ?)').run(user.id, text, files.length, 'pending')
    const feedbackId = rawInsert.lastInsertRowid
    incrementDailyUploadCount(user.id, day, 1)

    // 2. 立即返回
    res.json({ message: '已收到，感谢反馈！' })

    // 3. 异步处理后端逻辑
    processFeedbackAsync(feedbackId, user, text, files, day).catch(err => {
      logger.error(`Async feedback processing failed for #${feedbackId}: ${err.message}`)
      try {
        const db2 = getDb()
        db2.prepare("UPDATE feedbacks SET state = 'failed' WHERE id = ?").run(feedbackId)
      } catch (dbErr) {
        logger.error(`Failed to mark feedback #${feedbackId} as failed: ${dbErr.message}`)
      }
    })

  } catch (err) {
    logger.error(`Feedback submission error: ${err.message}`)
    res.status(500).json({ error: '服务器内部错误，请稍后重试。' })
  }
})

async function processFeedbackAsync(feedbackId, user, text, files, day) {
  const db = getDb()
  // 剥离已存在的图片描述，避免重试时重复叠加
  const originalText = text.replace(/【图片描述】[\s\S]*?(?=\n【图片描述】|\n*$)/g, '').trim()
  let fullContent = originalText
  const savedPaths = []
  const descriptions = []

  // 处理图片
  if (files.length > 0) {
    const folder = ensureUploadPath(String(user.id))
    for (const file of files) {
      try {
        let dest, base64Data, mime
        if (typeof file.mv === 'function') {
          // 首次提交：file 来自 express-fileupload，需要保存到磁盘
          dest = await saveUploadedFile(file, folder)
          const ext = path.extname(dest).toLowerCase()
          mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
          base64Data = (await fs.promises.readFile(dest)).toString('base64')
          // 保存图片记录
          db.prepare('INSERT INTO feedback_images (feedback_id, path, description) VALUES (?, ?, ?)').run(feedbackId, dest, '')
        } else if (file.data) {
          // 重试：file 来自数据库已有图片，base64 数据直接使用
          dest = file.path || ''
          mime = file.mime || 'image/jpeg'
          base64Data = file.data
        } else {
          throw new Error('Unknown file format')
        }
        savedPaths.push(dest)
        const description = await describeImage(base64Data, mime)
        descriptions.push(`【图片描述】${description.trim()}`)
        // 更新图片描述
        if (dest) {
          db.prepare('UPDATE feedback_images SET description = ? WHERE feedback_id = ? AND path = ?').run(description.trim(), feedbackId, dest)
        }
      } catch (error) {
        logger.error(`Image describe failed for feedback #${feedbackId}: ${error.message}`)
        descriptions.push('【图片描述】无法生成描述')
      }
    }
    fullContent = [originalText, ...descriptions].filter(Boolean).join('\n\n')

    // 更新反馈内容（追加图片描述）
    db.prepare('UPDATE feedbacks SET content = ? WHERE id = ?').run(fullContent, feedbackId)
  }

  // 聚类匹配
  const matchedIssue = await clusterFeedback(fullContent)
  let issueId = null
  if (matchedIssue) {
    issueId = matchedIssue.id
  } else {
    const summary = await buildIssueSummary(fullContent)
    issueId = createDraftIssue(summary.title, summary.description, summary.category)
    const embedding = await createEmbedding(fullContent)
    saveIssueEmbedding(issueId, embedding)
  }

  // 更新 feedback：关联 issue + 标记完成
  db.prepare('UPDATE feedbacks SET issue_id = ?, state = ? WHERE id = ?').run(issueId, 'processed', feedbackId)

  // 触发草稿演化
  if (matchedIssue) {
    await processNewFeedback(issueId)
  }
}

/** 用于后台重试：从数据库读取 feedback 信息重新处理 */
export async function retryProcessFeedback(feedbackId) {
  const db = getDb()
  const feedback = db.prepare('SELECT * FROM feedbacks WHERE id = ?').get(feedbackId)
  if (!feedback) throw new Error('Feedback not found')
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(feedback.user_id)
  if (!user) throw new Error('User not found')

  // 重置状态
  db.prepare('UPDATE feedbacks SET state = ?, issue_id = NULL WHERE id = ?').run('pending', feedbackId)

  // 读取已保存的图片
  const images = db.prepare('SELECT * FROM feedback_images WHERE feedback_id = ?').all(feedbackId)
  const files = []
  for (const img of images) {
    try {
      const buf = await fs.promises.readFile(img.path)
      const ext = path.extname(img.path).toLowerCase()
      const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
      files.push({
        path: img.path,
        data: buf.toString('base64'),
        mime,
        name: path.basename(img.path),
        size: buf.length
      })
    } catch {
      // 图片文件可能已被删除
    }
  }

  await processFeedbackAsync(feedbackId, user, feedback.content, files, null)
}
