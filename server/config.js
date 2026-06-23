import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.join(__dirname, '.env') })

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || 'change-me-securely',
  corsOrigin: process.env.CORS_ORIGIN || '',
  vdpBaseUrl: process.env.VDP_BASE_URL || 'https://open-global.vdsentnet.com',
  oauthClientId: process.env.OAUTH_CLIENT_ID || '',
  oauthClientSecret: process.env.OAUTH_CLIENT_SECRET || '',
  oauthRedirectUri: process.env.OAUTH_REDIRECT_URI || 'http://localhost:4000/api/auth/sso/callback',
  frontendRedirectUri: process.env.FRONTEND_REDIRECT_URI || 'http://localhost:5173',
  adminUsername: process.env.ADMIN_USERNAME || '',
  databaseFile: process.env.DATABASE_FILE || './data/report-site.db',
  imageStoragePath: process.env.IMAGE_STORAGE_PATH || './uploads',
  aiClusterSimilarityThreshold: Number(process.env.AI_CLUSTER_SIMILARITY_THRESHOLD) || 0.85,
  // AI 对话模型
  aiChat: {
    baseUrl: process.env.AI_CHAT_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.AI_CHAT_API_KEY || '',
    model: process.env.AI_CHAT_MODEL || 'gpt-4o-mini',
    reasoningEnabled: process.env.AI_CHAT_REASONING_ENABLED === 'true',
    reasoningEffort: process.env.AI_CHAT_REASONING_EFFORT || 'high',
    reasoningStyle: (process.env.AI_CHAT_REASONING_STYLE || 'none').toLowerCase(),
    responseFormatStyle: (process.env.AI_CHAT_RESPONSE_FORMAT_STYLE || 'none').toLowerCase()
  },
  // AI 图片描述模型
  aiImage: {
    baseUrl: process.env.AI_IMAGE_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.AI_IMAGE_API_KEY || '',
    model: process.env.AI_IMAGE_MODEL || 'gpt-4o-mini',
    reasoningEnabled: process.env.AI_IMAGE_REASONING_ENABLED === 'true',
    reasoningEffort: process.env.AI_IMAGE_REASONING_EFFORT || 'high',
    reasoningStyle: (process.env.AI_IMAGE_REASONING_STYLE || 'none').toLowerCase(),
    responseFormatStyle: (process.env.AI_IMAGE_RESPONSE_FORMAT_STYLE || 'none').toLowerCase()
  },
  // AI 向量嵌入模型
  aiEmbedding: {
    baseUrl: process.env.AI_EMBEDDING_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.AI_EMBEDDING_API_KEY || '',
    model: process.env.AI_EMBEDDING_MODEL || 'text-embedding-3-small',
    isEmbedding: process.env.AI_EMBEDDING_IS_EMBEDDING !== 'false',
    reasoningEnabled: process.env.AI_EMBEDDING_REASONING_ENABLED === 'true',
    reasoningEffort: process.env.AI_EMBEDDING_REASONING_EFFORT || 'high',
    reasoningStyle: (process.env.AI_EMBEDDING_REASONING_STYLE || 'none').toLowerCase(),
    responseFormatStyle: (process.env.AI_EMBEDDING_RESPONSE_FORMAT_STYLE || 'none').toLowerCase()
  }
}
