import express from 'express'
import { getDb } from '../lib/db.js'
import { signJwt, verifyJwt } from '../lib/jwt.js'
import { config } from '../../config.js'
import { createOAuthToken, fetchOAuthUserInfo } from '../lib/vds-oauth.js'
import { logger } from '../lib/logger.js'

export const authRouter = express.Router()

authRouter.get('/sso/authorize', (req, res) => {
  const state = String(req.query.state || '')
  const authorizeUrl = new URL('https://account.vds.pub/authorize')
  authorizeUrl.searchParams.set('client_id', config.oauthClientId)
  authorizeUrl.searchParams.set('redirect_uri', config.oauthRedirectUri)
  authorizeUrl.searchParams.set('response_type', 'code')
  authorizeUrl.searchParams.set('scope', 'profile')
  if (state) authorizeUrl.searchParams.set('state', state)
  res.redirect(authorizeUrl.toString())
})

authRouter.get('/sso/callback', (req, res) => {
  const code = String(req.query.code || '')
  const state = String(req.query.state || '')
  const error = String(req.query.error || '')
  if (error) {
    return res.status(400).send(`SSO error: ${error}`)
  }
  if (!code) return res.status(400).send('Missing code')

  // 立即返回中间态加载页面，前端 JS 异步完成令牌交换
  res.status(200).type('html').send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>正在登录...</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: 'Segoe UI', system-ui, sans-serif;
    background: radial-gradient(circle at 20% 30%, rgba(103,80,164,0.12), transparent 50%),
                linear-gradient(180deg, #fdfcff, #f7f4ff);
    color: #1d192b;
  }
  .card {
    background: rgba(255,255,255,0.85);
    backdrop-filter: blur(16px);
    border-radius: 28px;
    padding: 48px 40px;
    text-align: center;
    box-shadow: 0 24px 64px rgba(103,80,164,0.10);
    border: 1px solid rgba(103,80,164,0.06);
    max-width: 400px;
    width: 90%;
  }
  .spinner {
    width: 44px; height: 44px;
    border: 4px solid rgba(103,80,164,0.12);
    border-top-color: #6750a4;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 24px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 8px; }
  p  { font-size: 0.9rem; color: #5e5480; }
  .error { color: #b3261e; margin-top: 16px; font-size: 0.9rem; display: none; }
</style>
</head>
<body>
  <div class="card">
    <div class="spinner"></div>
    <h2>正在登录</h2>
    <p>正在验证身份并获取账户信息…</p>
    <div class="error" id="errorMsg"></div>
  </div>
  <script>
  (async function() {
    try {
      const res = await fetch('/api/auth/sso/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: ${JSON.stringify(code)}, state: ${JSON.stringify(state)} })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      localStorage.setItem('token', data.token);
      window.location.href = data.redirectUrl;
    } catch (err) {
      document.getElementById('errorMsg').textContent = '登录失败：' + err.message;
      document.getElementById('errorMsg').style.display = 'block';
    }
  })();
  </script>
</body>
</html>`)
})

// 实际的令牌交换处理（由上面的加载页异步调用）
authRouter.post('/sso/complete', express.json(), async (req, res) => {
  const code = String(req.body.code || '')
  const state = String(req.body.state || '')
  if (!code) return res.status(400).json({ error: 'Missing code' })

  try {
    const tokenResponse = await createOAuthToken(code, config.oauthRedirectUri)
    const userInfo = await fetchOAuthUserInfo(tokenResponse.access_token)
    const user = findOrCreateUserFromVds(userInfo)
    if (user.banned_at) {
      return res.status(403).json({ error: '用户账号已封禁' })
    }
    const jwtToken = signJwt({ userId: user.id, username: user.username, role: user.role })
    const redirectUrl = new URL(config.frontendRedirectUri)
    if (state) redirectUrl.searchParams.set('state', state)
    // Token 不放在 URL 中（安全漏洞#8），通过响应体单独返回，前端存入 localStorage
    res.json({ token: jwtToken, redirectUrl: redirectUrl.toString() })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

authRouter.get('/me', (req, res) => {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Authorization required' })
  const payload = verifyJwt(token)
  if (!payload) return res.status(401).json({ error: 'Invalid token' })
  const user = getDb().prepare('SELECT id, phone, nickname, role, vds_sub, username, avatar_url, email, phone_number, banned_at, ban_reason FROM users WHERE id = ?').get(payload.userId)
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({ user })
})

function findOrCreateUserFromVds(profile) {
  const db = getDb()
  // 以 username 为稳定外部主键（human-readable，可反向关联）
  const vdsUsername = (profile.username || '').trim()
  if (!vdsUsername) throw new Error('VDS profile missing username')

  let user = db.prepare('SELECT * FROM users WHERE username = ?').get(vdsUsername)

  const rawProfile = JSON.stringify(profile.raw || profile)
  const shouldBeAdmin = vdsUsername === config.adminUsername || profile.sub === config.adminUsername

  if (user) {
    const newRole = shouldBeAdmin && user.role !== 'admin' ? 'admin' : undefined
    db.prepare(`UPDATE users SET phone = ?, nickname = ?, vds_sub = ?, avatar_url = ?, email = ?, phone_number = ?, raw_profile = ?${newRole ? ', role = ?' : ''} WHERE id = ?`).run(
      profile.phone_number || '',
      profile.nickname || vdsUsername,
      profile.sub,
      profile.avatar_url || '',
      profile.email || '',
      profile.phone_number || '',
      rawProfile,
      ...(newRole ? [newRole, user.id] : [user.id])
    )
    return db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
  }

  const role = shouldBeAdmin ? 'admin' : 'user'
  const info = db.prepare(`INSERT INTO users (username, phone, nickname, role, vds_sub, avatar_url, email, phone_number, raw_profile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      vdsUsername,
      profile.phone_number || '',
      profile.nickname || vdsUsername,
      role,
      profile.sub,
      profile.avatar_url || '',
      profile.email || '',
      profile.phone_number || '',
      rawProfile
    )
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
}
