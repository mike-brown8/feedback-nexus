import express from 'express'
import path from 'path'
import fs from 'fs'
import { getDb } from '../lib/db.js'
import { config } from '../../config.js'
import { formatDayUTC8, ensureUploadPath, saveUploadedFile, similarity } from '../lib/utils.js'
import { createEmbedding, createChatCompletion, describeImage } from '../lib/ai.js'
import { logger } from '../lib/logger.js'

export const feedbackRouter = express.Router()

// 图片服务状态查询（前端在页面加载时调用）
feedbackRouter.get('/image-status', (req, res) => {
  const available = !!(config.aiImage.apiKey && config.aiImage.baseUrl)
  res.json({ available })
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

function buildIssueEmbeddingTable() {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS issue_embeddings (
      issue_id INTEGER PRIMARY KEY,
      embedding TEXT NOT NULL,
      FOREIGN KEY(issue_id) REFERENCES issues(id) ON DELETE CASCADE
    );
  `)
}

function saveIssueEmbedding(issueId, embedding) {
  const db = getDb()
  const text = JSON.stringify(embedding)
  db.prepare('INSERT OR REPLACE INTO issue_embeddings (issue_id, embedding) VALUES (?, ?)').run(issueId, text)
}

async function buildIssueSummary(content) {
  const message = [
    { role: 'system', content: '你是一个问题摘要生成助手。请严格遵循以下规则：\n1. 标题控制在 15 字以内，简明扼要，让人一眼看懂是什么问题。\n2. 描述控制在 60 字以内，一句话说清问题现象。\n3. 禁止提及任何人数、影响面、频率、情绪词语（如"很多人"、"大量用户"、"频繁"、"糟糕"）。\n4. 只客观描述问题本身，不推测原因，不给出解决方案。' },
    { role: 'user', content: `根据下面的反馈文本生成一个简洁标题和描述，分别用“标题：”与“描述：”开头。

文本：
${content}` }
  ]
  const result = await createChatCompletion(message, { max_tokens: 300 })
  const titleMatch = result.match(/标题：([\s\S]*?)描述：/i)
  const descMatch = result.match(/描述：([\s\S]*)/i)
  const title = titleMatch ? titleMatch[1].trim() : result.slice(0, 120).trim()
  const desc = descMatch ? descMatch[1].trim() : result.trim()
  return { title, description: desc }
}

async function refreshDraftSummary(issueId) {
  const db = getDb()
  const rows = db.prepare('SELECT content FROM feedbacks WHERE issue_id = ?').all(issueId)
  const content = rows.map(r => r.content).join('\n\n')
  if (!content) return
  const summary = await buildIssueSummary(content)
  db.prepare('UPDATE issues SET title = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(summary.title, summary.description, issueId)
}

async function processNewFeedback(issueId) {
  const db = getDb()
  const issue = db.prepare('SELECT status FROM issues WHERE id = ?').get(issueId)
  if (!issue || issue.status !== 'draft') return
  const count = getIssueFeedbackCount(issueId)
  if (count % 5 === 0) {
    await refreshDraftSummary(issueId)
  }
}

function createDraftIssue(title, description) {
  const db = getDb()
  const info = db.prepare('INSERT INTO issues (title, description, status, is_public) VALUES (?, ?, ?, 0)').run(title, description, 'draft')
  return info.lastInsertRowid
}

async function clusterFeedback(fullContent) {
  buildIssueEmbeddingTable()
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
      if (!config.aiImage.apiKey) {
        return res.status(400).json({ error: '图片描述服务未配置，暂不支持上传图片。请仅提交文本反馈。' })
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
    if (currentCount + files.length > 3) {
      return res.status(400).json({ error: '今日上传已达上限（每日最多 3 张图片）' })
    }

    // 1. 先保存原始反馈（无 issue_id，state=pending）
    const db = getDb()
    const rawInsert = db.prepare('INSERT INTO feedbacks (user_id, content, image_count, state) VALUES (?, ?, ?, ?)').run(user.id, text, files.length, 'pending')
    const feedbackId = rawInsert.lastInsertRowid
    incrementDailyUploadCount(user.id, day, files.length)

    // 2. 立即返回
    res.json({ message: '已收到，感谢反馈！' })

    // 3. 异步处理后端逻辑
    processFeedbackAsync(feedbackId, user, text, files, day).catch(err => {
      logger.error(`Async feedback processing failed for #${feedbackId}: ${err.message}`)
      try {
        const db2 = getDb()
        db2.prepare("UPDATE feedbacks SET state = 'failed' WHERE id = ?").run(feedbackId)
      } catch (_) { /* ignore */ }
    })

  } catch (err) {
    logger.error(`Feedback submission error: ${err.message}`)
    res.status(500).json({ error: '服务器内部错误，请稍后重试。' })
  }
})

async function processFeedbackAsync(feedbackId, user, text, files, day) {
  const db = getDb()
  let fullContent = text
  const savedPaths = []
  const descriptions = []

  // 处理图片
  if (files.length > 0) {
    const folder = ensureUploadPath(String(user.id))
    for (const file of files) {
      try {
        const dest = await saveUploadedFile(file, folder)
        savedPaths.push(dest)
        const ext = path.extname(dest).toLowerCase()
        const mime = ext === '.png' ? 'image/png' : ext === '.gif' ? 'image/gif' : 'image/jpeg'
        const base64Data = (await fs.promises.readFile(dest)).toString('base64')
        // 先保存图片记录，确保即使后续 AI 失败也不丢失
        if (savedPaths.length === 1) {
          db.prepare('INSERT INTO feedback_images (feedback_id, path, description) VALUES (?, ?, ?)').run(feedbackId, dest, '')
        }
        const description = await describeImage(base64Data, mime)
        descriptions.push(`【图片描述】${description.trim()}`)
        // 更新图片描述
        db.prepare('UPDATE feedback_images SET description = ? WHERE feedback_id = ? AND path = ?').run(description.trim(), feedbackId, dest)
      } catch (error) {
        logger.error(`Image describe failed for feedback #${feedbackId}: ${error.message}`)
        descriptions.push('【图片描述】无法生成描述')
      }
    }
    fullContent = [text, ...descriptions].filter(Boolean).join('\n\n')

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
    issueId = createDraftIssue(summary.title, summary.description)
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
      const data = await fs.promises.readFile(img.path)
      files.push({ name: path.basename(img.path), size: data.length, data: data.toString('base64') })
    } catch {
      // 图片文件可能已被删除
    }
  }

  await processFeedbackAsync(feedbackId, user, feedback.content, files, null)
}
