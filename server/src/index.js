import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import fileUpload from 'express-fileupload'
import path from 'path'
import { fileURLToPath } from 'url'
import { initDatabase } from './lib/db.js'
import { authRouter } from './routes/auth.js'
import { feedbackRouter } from './routes/feedback.js'
import { adminRouter } from './routes/admin.js'
import { publicRouter } from './routes/public.js'
import { ensureJwt } from './lib/jwt.js'
import { verifyJwt } from './lib/jwt.js'
import { getDb } from './lib/db.js'
import { config } from '../config.js'
import { logger } from './lib/logger.js'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const port = config.port

// ---- 安全头（技术债#6） ----
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}))

// ---- CORS（安全漏洞#4） ----
const corsOrigin = config.corsOrigin || config.frontendRedirectUri
app.use(cors({ origin: corsOrigin, credentials: true }))

// ---- 请求日志中间件（技术债#6） ----
app.use((req, res, next) => {
  const start = Date.now()
  res.on('finish', () => {
    const duration = Date.now() - start
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`)
  })
  next()
})

// ---- 速率限制（安全漏洞#7） ----
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' }
})
app.use('/api', generalLimiter)

const authLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '登录请求过于频繁，请稍后再试' }
})
app.use('/api/auth', authLimiter)

const feedbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '提交过于频繁，请稍后再试' }
})
app.use('/api/feedback', feedbackLimiter)

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true, limit: '1mb' }))
app.use(fileUpload({ limits: { fileSize: 5 * 1024 * 1024 }, createParentPath: true }))

// ---- 移除公开的 /uploads 静态路由（安全漏洞#5） ----
// 图片只能通过带鉴权的 /api/admin/images/file/:imageId 访问

await initDatabase(config.databaseFile)

app.use('/api/auth', authRouter)
app.use('/api/feedback', ensureJwt, feedbackRouter)

// 图片文件路由（放在 ensureJwt 之外，自行通过 query token 鉴权）
app.get('/api/admin/images/file/:imageId', (req, res) => {
  const queryToken = String(req.query.token || '')
  if (!queryToken) return res.status(401).json({ error: 'Authorization required' })
  const payload = verifyJwt(queryToken)
  if (!payload || payload.role !== 'admin') return res.status(403).json({ error: 'Forbidden' })
  const db = getDb()
  const img = db.prepare('SELECT path FROM feedback_images WHERE id = ?').get(req.params.imageId)
  if (!img) return res.status(404).json({ error: 'Image not found' })
  if (!fs.existsSync(img.path)) return res.status(404).json({ error: 'File not found' })
  res.sendFile(img.path)
})

app.use('/api/admin', ensureJwt, adminRouter)
app.use('/api/public', ensureJwt, publicRouter)

app.get('/health', (_req, res) => res.json({ ok: true }))

app.listen(port, () => {
  logger.info(`Server listening on http://localhost:${port}`)
})
