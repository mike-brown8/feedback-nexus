import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '.env') })

/** 火山方舟默认配置 */
const ARK_DEFAULTS = {
  baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
}

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'change-me-securely',
  corsOrigin: process.env.CORS_ORIGIN || '',
  vdpBaseUrl: process.env.VDP_BASE_URL || 'https://open-global.vdsentnet.com',
  oauthClientId: process.env.OAUTH_CLIENT_ID || '',
  oauthClientSecret: process.env.OAUTH_CLIENT_SECRET || '',
  oauthRedirectUri: process.env.OAUTH_REDIRECT_URI || 'http://localhost:5173/api/auth/sso/callback',
  frontendRedirectUri: process.env.FRONTEND_REDIRECT_URI || 'http://localhost:5173',
  adminUsername: process.env.ADMIN_USERNAME || '',
  databaseFile: process.env.DATABASE_FILE || './data/report-site.db',
  imageStoragePath: process.env.IMAGE_STORAGE_PATH || './uploads',
  /** 每用户每日最多上传图片数 */
  maxDailyFeedbacks: Number(process.env.MAX_DAILY_FEEDBACKS) || 3,
  aiClusterSimilarityThreshold: Number(process.env.AI_CLUSTER_SIMILARITY_THRESHOLD) || 0.85,
  /** 火山方舟全局 API Key（各模块可单独覆盖） */
  arkApiKey: process.env.ARK_API_KEY || process.env.AI_CHAT_API_KEY || '',
  // AI 命名/摘要模型（唯一允许开启思维链的模块）
  aiNaming: {
    baseUrl: process.env.AI_NAMING_BASE_URL || ARK_DEFAULTS.baseUrl,
    apiKey: process.env.AI_NAMING_API_KEY || '',
    model: process.env.AI_NAMING_MODEL || 'doubao-seed-2-1-pro-260628',
    /** 思维链开关 */
    reasoningEnabled: process.env.AI_NAMING_REASONING_ENABLED !== 'false',
    /** 思维链强度：minimal / low / medium / high */
    reasoningEffort: (process.env.AI_NAMING_REASONING_EFFORT || 'medium').toLowerCase(),
    /** 最大 completion token 数（火山方舟 max_completion_tokens） */
    maxCompletionTokens: Number(process.env.AI_NAMING_MAX_COMPLETION_TOKENS) || 4096,
  },
  // AI 图片描述模型（不得开启思维链）
  aiImage: {
    baseUrl: process.env.AI_IMAGE_BASE_URL || ARK_DEFAULTS.baseUrl,
    apiKey: process.env.AI_IMAGE_API_KEY || '',
    model: process.env.AI_IMAGE_MODEL || 'doubao-seed-2-1-pro-260628',
    reasoningEnabled: false,
    /** 最大 completion token 数（火山方舟 max_completion_tokens） */
    maxCompletionTokens: Number(process.env.AI_IMAGE_MAX_COMPLETION_TOKENS) || 2048,
  },
  // AI 向量嵌入模型（不得开启思维链）
  aiEmbedding: {
    baseUrl: process.env.AI_EMBEDDING_BASE_URL || ARK_DEFAULTS.baseUrl,
    apiKey: process.env.AI_EMBEDDING_API_KEY || '',
    model: process.env.AI_EMBEDDING_MODEL || 'doubao-embedding-vision-250615',
    reasoningEnabled: false
  }
}
