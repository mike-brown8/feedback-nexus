import express from 'express'
import { getDb } from '../lib/db.js'

export const publicRouter = express.Router()

publicRouter.get('/issues', (req, res) => {
  const db = getDb()
  const issues = db.prepare(`
    SELECT id, title, status, published_at, updated_at
    FROM issues
    WHERE is_public = 1 AND (status = 'public' OR status = 'processing')
    ORDER BY updated_at DESC
  `).all()
  res.json({ issues })
})
