import express from 'express'
import fs from 'fs'
import { getDb } from '../lib/db.js'
import { deleteFileIfExists } from '../lib/utils.js'
import { logger } from '../lib/logger.js'
import { retryProcessFeedback } from './feedback.js'

export const adminRouter = express.Router()

function ensureAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

adminRouter.use(ensureAdmin)

adminRouter.get('/drafts', (req, res) => {
  const db = getDb()
  const drafts = db.prepare(`
    SELECT issues.id, issues.title, issues.description, issues.status, issues.created_at, issues.updated_at,
      COUNT(feedbacks.id) AS feedback_count
    FROM issues
    LEFT JOIN feedbacks ON feedbacks.issue_id = issues.id
    WHERE issues.status = 'draft'
    GROUP BY issues.id
    ORDER BY feedback_count DESC, issues.updated_at DESC
  `).all()
  res.json({ drafts })
})

adminRouter.get('/drafts/:id', (req, res) => {
  const db = getDb()
  const issue = db.prepare('SELECT id, title, description, status, created_at, updated_at FROM issues WHERE id = ? AND status = ?').get(req.params.id, 'draft')
  if (!issue) {
    return res.status(404).json({ error: 'Draft not found' })
  }
  const feedbacks = db.prepare(`
    SELECT f.id, f.content, f.image_count, f.created_at, u.phone, u.username,
      GROUP_CONCAT(fi.path) AS image_paths,
      GROUP_CONCAT(fi.description) AS image_descriptions
    FROM feedbacks f
    JOIN users u ON u.id = f.user_id
    LEFT JOIN feedback_images fi ON fi.feedback_id = f.id
    WHERE f.issue_id = ?
    GROUP BY f.id
    ORDER BY f.created_at DESC
  `).all(issue.id)
  const normalized = feedbacks.map(item => ({
    id: item.id,
    phone: item.phone,
    username: item.username,
    content: item.content,
    created_at: item.created_at,
    image_count: item.image_count,
    image_descriptions: item.image_descriptions ? item.image_descriptions.split(',') : []
  }))
  res.json({ issue, feedbacks: normalized })
})

adminRouter.post('/drafts/:id/publish', (req, res) => {
  const db = getDb()
  const result = db.prepare('UPDATE issues SET status = ?, is_public = 1, published_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?').run('public', req.params.id, 'draft')
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Draft not found or already published' })
  }
  res.json({ message: 'Draft published' })
})

adminRouter.post('/drafts/:id/reject', (req, res) => {
  const db = getDb()
  const images = db.prepare(`
    SELECT fi.path FROM feedback_images fi
    JOIN feedbacks f ON f.id = fi.feedback_id
    WHERE f.issue_id = ?
  `).all(req.params.id)
  images.forEach(row => deleteFileIfExists(row.path))
  const result = db.prepare('DELETE FROM issues WHERE id = ? AND status = ?').run(req.params.id, 'draft')
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Draft not found or cannot reject' })
  }
  res.json({ message: 'Draft rejected and deleted' })
})

adminRouter.get('/users', (req, res) => {
  const db = getDb()
  const page = Math.max(1, Number(req.query.page) || 1)
  const size = Math.min(50, Math.max(10, Number(req.query.size) || 20))
  const q = String(req.query.q || '').trim()
  const offset = (page - 1) * size
  const pattern = q ? `%${q}%` : '%'
  const countResult = db.prepare(`
    SELECT COUNT(*) AS total FROM users
    WHERE phone LIKE ? OR username LIKE ? OR nickname LIKE ?
  `).get(pattern, pattern, pattern)
  const users = db.prepare(`
    SELECT id, phone, nickname, role, vds_sub, username, avatar_url, email, phone_number, banned_at, ban_reason, created_at
    FROM users
    WHERE phone LIKE ? OR username LIKE ? OR nickname LIKE ?
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `).all(pattern, pattern, pattern, size, offset)
  res.json({ users, page, size, total: countResult.total })
})

adminRouter.get('/users/:id', (req, res) => {
  const db = getDb()
  const user = db.prepare(`
    SELECT id, phone, nickname, role, vds_sub, username, avatar_url, email, phone_number, banned_at, ban_reason, created_at, raw_profile
    FROM users
    WHERE id = ?
  `).get(req.params.id)
  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }
  const feedbackCount = db.prepare('SELECT COUNT(*) AS count FROM feedbacks WHERE user_id = ?').get(user.id).count
  const issueCount = db.prepare('SELECT COUNT(DISTINCT issue_id) AS count FROM feedbacks WHERE user_id = ?').get(user.id).count
  res.json({ user, feedbackCount, issueCount })
})

adminRouter.post('/users/:id/ban', express.json(), (req, res) => {
  if (Number(req.params.id) === req.user?.userId) {
    return res.status(400).json({ error: '不能封禁自己的账号' })
  }
  const db = getDb()
  const reason = String(req.body.reason || '违规行为')
  const result = db.prepare('UPDATE users SET banned_at = CURRENT_TIMESTAMP, ban_reason = ? WHERE id = ?').run(reason, req.params.id)
  if (result.changes === 0) {
    return res.status(404).json({ error: 'User not found' })
  }
  res.json({ message: 'User banned', reason })
})

adminRouter.post('/users/:id/unban', (req, res) => {
  const db = getDb()
  const result = db.prepare('UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ?').run(req.params.id)
  if (result.changes === 0) {
    return res.status(404).json({ error: 'User not found' })
  }
  res.json({ message: 'User unbanned' })
})

adminRouter.get('/users/:id/feedbacks', (req, res) => {
  const db = getDb()
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id)
  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }
  const feedbacks = db.prepare(`
    SELECT f.id, f.content, f.image_count, f.created_at, f.issue_id,
      i.title AS issue_title, i.status AS issue_status, i.is_public
    FROM feedbacks f
    LEFT JOIN issues i ON i.id = f.issue_id
    WHERE f.user_id = ?
    ORDER BY f.created_at DESC
  `).all(user.id)
  res.json({ feedbacks })
})

// ---- 未处理帖子（state=pending 且未关联 issue） ----
adminRouter.get('/unprocessed', (req, res) => {
  const db = getDb()
  const pending = db.prepare(`
    SELECT f.id, f.content, f.image_count, f.created_at, f.state,
      u.id AS user_id, u.phone, u.username
    FROM feedbacks f
    JOIN users u ON u.id = f.user_id
    WHERE f.state = 'pending' AND f.issue_id IS NULL
    ORDER BY f.created_at DESC
  `).all()
  const failed = db.prepare(`
    SELECT f.id, f.content, f.image_count, f.created_at, f.state,
      u.id AS user_id, u.phone, u.username
    FROM feedbacks f
    JOIN users u ON u.id = f.user_id
    WHERE f.state = 'failed'
    ORDER BY f.created_at DESC
  `).all()
  res.json({ pending, failed })
})

adminRouter.post('/unprocessed/:id/retry', async (req, res) => {
  try {
    await retryProcessFeedback(Number(req.params.id))
    res.json({ message: 'Retry initiated' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

adminRouter.post('/unprocessed/retry-all', async (req, res) => {
  const db = getDb()
  const list = db.prepare("SELECT id FROM feedbacks WHERE (state = 'pending' OR state = 'failed') AND issue_id IS NULL").all()
  const results = { total: list.length, success: 0, failed: 0, errors: [] }
  for (const row of list) {
    try {
      await retryProcessFeedback(row.id)
      results.success++
    } catch (err) {
      results.failed++
      results.errors.push({ id: row.id, error: err.message })
    }
  }
  res.json(results)
})

// ---- 已发布管理 ----
adminRouter.get('/published', (req, res) => {
  const db = getDb()
  const list = db.prepare(`
    SELECT id, title, description, status, published_at, updated_at
    FROM issues
    WHERE is_public = 1
    ORDER BY updated_at DESC
  `).all()
  res.json({ issues: list })
})

adminRouter.post('/issues/:id/status', express.json(), (req, res) => {
  const newStatus = String(req.body.status || '')
  if (!['public', 'processing'].includes(newStatus)) {
    return res.status(400).json({ error: 'Invalid status' })
  }
  const db = getDb()
  db.prepare('UPDATE issues SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND is_public = 1').run(newStatus, req.params.id)
  res.json({ message: 'Status updated' })
})

adminRouter.post('/issues/:id/complete', (req, res) => {
  const db = getDb()
  const issue = db.prepare('SELECT id FROM issues WHERE id = ? AND is_public = 1').get(req.params.id)
  if (!issue) return res.status(404).json({ error: 'Issue not found' })
  // 删除关联的反馈图片文件
  const images = db.prepare(`SELECT fi.path FROM feedback_images fi JOIN feedbacks f ON f.id = fi.feedback_id WHERE f.issue_id = ?`).all(req.params.id)
  images.forEach(row => { try { fs.unlinkSync(row.path) } catch {} })
  // 级联删除：feedbacks → feedback_images → issue（外键 ON DELETE CASCADE）
  db.prepare('DELETE FROM issues WHERE id = ?').run(req.params.id)
  res.json({ message: 'Issue completed and removed' })
})

// ---- 图片查看 ----
adminRouter.get('/images/:feedbackId', (req, res) => {
  const db = getDb()
  const images = db.prepare('SELECT id, path, description FROM feedback_images WHERE feedback_id = ?').all(req.params.feedbackId)
  if (!images.length) return res.status(404).json({ error: 'No images found' })
  res.json({ images: images.map(img => ({ id: img.id, description: img.description })) })
})
