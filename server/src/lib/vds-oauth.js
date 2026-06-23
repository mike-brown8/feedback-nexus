import { config } from '../../config.js'

// ---- 平台签名管理器（自动获取/缓存/刷新） ----

const SIGNATURE_URL = `${config.vdpBaseUrl}/api/auth/token`
const REFRESH_WINDOW_MS = 5 * 60 * 1000 // 剩余 < 5 分钟即换新
const REQUEST_TIMEOUT = 15000
const MAX_RETRIES = 3

let cachedToken = null
let cachedExpiry = 0 // ms timestamp

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT)
  try {
    return await fetch(url, { ...options, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * 向 VDS /api/auth/token 请求平台签名。
 * 使用 appId（即 OAUTH_CLIENT_ID，vap_xxx 格式）+ clientSecret 换取 accessToken。
 */
async function requestSignature() {
  const body = JSON.stringify({
    clientId: config.oauthClientId,
    clientSecret: config.oauthClientSecret
  })
  const res = await fetchWithTimeout(SIGNATURE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Platform signature exchange failed (${res.status}): ${text}`)
  }
  const json = await res.json()
  return {
    accessToken: json.accessToken,
    expiresInMs: (json.expiresInSeconds || 3600) * 1000
  }
}

/**
 * 获取可用的平台签名（Bearer token）。
 * 缓存有效则直接返回，否则自动获取；临近过期自动换新。
 * 最多重试 3 次，指数退避。
 */
export async function getPlatformSignature() {
  // 缓存有效且距离过期 > 5 分钟 → 直接返回
  if (cachedToken && Date.now() + REFRESH_WINDOW_MS < cachedExpiry) {
    return cachedToken
  }

  let lastErr
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { accessToken, expiresInMs } = await requestSignature()
      cachedToken = accessToken
      cachedExpiry = Date.now() + expiresInMs
      return accessToken
    } catch (err) {
      lastErr = err
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, attempt * 1000)) // 退避
      }
    }
  }
  throw new Error(`Failed to obtain platform signature after ${MAX_RETRIES} attempts: ${lastErr.message}`)
}

// ---- OAuth 令牌交换 ----

export async function createOAuthToken(code, redirectUri) {
  const platformSig = await getPlatformSignature()

  const params = new URLSearchParams()
  params.append('grant_type', 'authorization_code')
  params.append('code', code)
  if (redirectUri) params.append('redirect_uri', redirectUri)
  params.append('client_id', config.oauthClientId)
  params.append('client_secret', config.oauthClientSecret)

  const response = await fetchWithTimeout(`${config.vdpBaseUrl}/api/proxy/account/sso/token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${platformSig}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OAuth token exchange failed: ${text}`)
  }
  return response.json()
}

export async function fetchOAuthUserInfo(accessToken) {
  const platformSig = await getPlatformSignature()

  const response = await fetchWithTimeout(`${config.vdpBaseUrl}/api/proxy/account/sso/userinfo`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${platformSig}`,
      'X-OAuth-Access-Token': accessToken
    }
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OAuth userinfo fetch failed: ${text}`)
  }
  return normalizeUserInfo(await response.json())
}

export function normalizeUserInfo(data = {}) {
  return {
    sub: data.sub || null,
    username: data.username || '',
    nickname: data.nickname || data.username || '',
    avatar_url: data.avatar_url || '',
    email: data.email || '',
    phone_number: data.phone_number || '',
    raw: data
  }
}
