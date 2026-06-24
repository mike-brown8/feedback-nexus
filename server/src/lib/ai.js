import { config } from '../../config.js'
import { logger } from './logger.js'

// ---- 火山方舟 API 工具函数 ----

/** 解析模块 API Key（优先模块级，回退到全局 arkApiKey） */
function resolveApiKey(cfg) {
  return cfg.apiKey || config.arkApiKey
}

/** 构建请求客户端配置 */
function buildClient(cfg) {
  const apiKey = resolveApiKey(cfg)
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`
  }
  return { baseUrl: cfg.baseUrl, headers, cfg }
}

/**
 * 构建火山方舟思维链参数
 * 火山方舟 Chat API 支持：
 *   thinking: { type: "enabled" | "disabled" | "auto" }
 *   reasoning_effort: "minimal" | "low" | "medium" | "high"
 */
function buildThinkingParam(cfg) {
  if (!cfg.reasoningEnabled) return {}
  return {
    thinking: { type: 'enabled' },
    reasoning_effort: cfg.reasoningEffort
  }
}

/**
 * 通用 chat/completions 请求（火山方舟 Chat API）
 * @param {object} cfg - 模块配置
 * @param {object} body - 请求体（不含 thinking 参数，会自动添加）
 * @param {boolean} [skipThinking=false] - 是否强制跳过思维链（用于图片描述等）
 */
async function chatCompletions(cfg, body, skipThinking = false) {
  const { baseUrl, headers } = buildClient(cfg)
  if (!skipThinking) {
    body = { ...body, ...buildThinkingParam(cfg) }
  }
  // 全局最大 completion token 限制（火山方舟 max_completion_tokens）
  if (cfg.maxCompletionTokens) {
    body.max_completion_tokens = cfg.maxCompletionTokens
  }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`火山方舟 Chat API 请求失败: ${errorText}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

// ---- 向量嵌入（火山方舟多模态 /embeddings/multimodal 端点） ----

/**
 * 创建文本嵌入向量。
 * 火山方舟仅有 doubao-embedding-vision 多模态向量化模型，
 * 需使用 POST /embeddings/multimodal 端点，input 为对象数组。
 * API 失败时使用字符哈希回退方案保证系统可用。
 */
export async function createEmbedding(input) {
  const cfg = config.aiEmbedding
  const { baseUrl, headers } = buildClient(cfg)
  const body = {
    model: cfg.model,
    input: [{ type: 'text', text: input }],
    encoding_format: 'float'
  }
  try {
    const res = await fetch(`${baseUrl}/embeddings/multimodal`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Embedding 请求失败: ${errorText}`)
    }
    const data = await res.json()
    // 多模态 embedding 响应：data.data.embedding（对象，非数组）
    if (data.data?.embedding) return data.data.embedding
    throw new Error('响应中未包含 embedding 数据')
  } catch (err) {
    logger.warn(`Embedding API 失败，使用回退方案: ${err.message}`)
    return fallbackEmbedding(input)
  }
}

/** AI 嵌入不可用时的回退方案：基于字符哈希生成确定性向量 */
function fallbackEmbedding(text, dim = 128) {
  const vec = new Array(dim).fill(0)
  const chars = [...(text || '')]
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].charCodeAt(0) || 0
    const idx = i % dim
    vec[idx] += Math.sin(code * (i + 1)) * 0.5 + Math.cos(code * (i + 1)) * 0.5
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map(v => v / norm)
}

// ---- 命名/摘要（唯一允许思维链的模块） ----

/**
 * 创建聊天补全（用于命名/摘要，按配置开启思维链）
 * 这是唯一可以启用 reasoning 的调用路径。
 */
export async function createChatCompletion(messages, options = {}) {
  return chatCompletions(config.aiNaming, {
    model: options.model || config.aiNaming.model,
    messages,
    temperature: options.temperature ?? 0.2
  })
}

// ---- 图片描述（不得开启思维链） ----

/**
 * 图片理解描述（火山方舟 Chat API，强制跳过思维链）
 * 传入 base64 图片数据，返回文本描述。
 */
export async function describeImage(base64, mimeType = 'image/jpeg') {
  return chatCompletions(config.aiImage, {
    model: config.aiImage.model,
    messages: [
      {
        role: 'system',
        content: `你是一个用于解析应用界面截图的视觉助手。你的任务是根据用户上传的截图，输出一段简洁、客观、聚焦于问题事实的文字描述。

请严格遵循以下规则：
1. **只描述你在图片中直接看到的界面元素**，不要猜测用户操作意图、系统状态或未显示的信息。
2. **聚焦异常与问题特征**：重点描述报错信息、异常状态、布局错乱、空白区域、不可点击的组件、加载失败、显示不全、文字重叠等与正常界面不符的现象。
3. **若图中包含明显的错误代码、异常堆栈、弹窗文案、红色/黄色警告标识，务必逐字引用或精确描述位置与内容**。
4. **忽略并不得提及**：
   - 任何可能指向具体身份的信息（姓名、头像、手机号、邮箱、地址等）。
   - 图中可见的个人聊天记录、文件内容或其他非当前系统界面的敏感数据。
   - 任何关于人数、情绪、主观评价的表述（如"很多人"、"糟糕的设计"）。
5. 输出格式统一为一段连续文字，以"【图片描述】"开头，不包含 Markdown 或其他标记。
6. 如果图片内容与系统问题完全无关（如风景照、纯色背景、人物自拍等），输出："【图片描述】该图片未包含与应用问题相关的界面信息。"
7. 如果图片质量太差无法辨认内容，输出："【图片描述】图片模糊，无法解析界面细节。"`
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请根据这张截图生成详细的文本描述：' },
          {
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` }
          }
        ]
      }
    ],
    temperature: 0.2
  }, true) // 强制跳过思维链
}
