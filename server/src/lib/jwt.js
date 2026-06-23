import jwt from 'jsonwebtoken'
import { getDb } from './db.js'
import { config } from '../../config.js'

const secret = config.jwtSecret
const expiresIn = '12h'

export function signJwt(payload) {
  return jwt.sign(payload, secret, { expiresIn })
}

export function verifyJwt(token) {
  try {
    return jwt.verify(token, secret)
  } catch (error) {
    return null
  }
}

export function ensureJwt(req, res, next) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) {
    return res.status(401).json({ error: 'Authorization required' })
  }
  const payload = verifyJwt(token)
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' })
  }
  const user = getDb().prepare('SELECT banned_at, ban_reason FROM users WHERE id = ?').get(payload.userId)
  if (user?.banned_at) {
    return res.status(403).json({ error: 'Account banned', reason: user.ban_reason || '已被封禁' })
  }
  req.user = payload
  next()
}
