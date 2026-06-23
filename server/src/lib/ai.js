import { config } from '../../config.js'
import { logger } from './logger.js'

function buildClient(cfg) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`
  }
  return { baseUrl: cfg.baseUrl, headers, cfg }
}

function buildThinkingParam(cfg) {
  const style = (cfg.reasoningStyle || 'none').toLowerCase()
  if (style === 'none' || !cfg.reasoningEnabled) return {}
  if (style === 'openai') {
    return { reasoning_effort: cfg.reasoningEffort }
  }
  // deepseek 标准：thinking 包裹 + reasoning_effort
  return {
    thinking: { type: 'enabled' },
    reasoning_effort: cfg.reasoningEffort
  }
}

function buildResponseFormat(cfg) {
  const style = (cfg.responseFormatStyle || 'none').toLowerCase()
  if (style !== 'json') return {}
  return { response_format: { type: 'json_object' } }
}

/** 通用 chat/completions 请求 */
async function chatCompletions(cfg, body) {
  const { baseUrl, headers } = buildClient(cfg)
  // response_format 由各调用方按需传入（DeepSeek 要求 prompt 包含 "json" 字样才能使用）
  body = { ...body, ...buildThinkingParam(cfg) }
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Chat completion request failed: ${errorText}`)
  }
  const data = await res.json()
  return data.choices?.[0]?.message?.content || ''
}

export async function createEmbedding(input) {
  const cfg = config.aiEmbedding
  if (!cfg.isEmbedding) {
    // 用 chat/completions 生成嵌入向量
    let text
    try {
      text = await chatCompletions(cfg, {
        model: cfg.model,
        messages: [
          { role: 'system', content: '请将用户输入的文本转换为一个 128 维的数值向量用于语义相似度计算。仅输出一个 JSON 数字数组，如 [0.01, -0.02, ...]，不要输出其他任何内容。向量中的值应在 -1 到 1 之间。' },
          { role: 'user', content: input }
        ],
        max_tokens: 800,
        temperature: 0,
        ...buildResponseFormat(cfg)
      })
    } catch (err) {
      logger.warn(`AI embedding chat failed, using fallback: ${err.message}`)
      return fallbackEmbedding(input)
    }
    // 尝试解析模型返回的 JSON 数组
    try {
      const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      return JSON.parse(cleaned)
    } catch {
      logger.warn(`AI embedding parse failed, response was: ${text.slice(0, 300)}`)
      return fallbackEmbedding(input)
    }
  }
  // 独立 embedding 端点
  const { baseUrl, headers } = buildClient(cfg)
  const body = {
    model: cfg.model,
    input,
    ...buildThinkingParam(cfg),
    ...buildResponseFormat(cfg)
  }
  try {
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const errorText = await res.text()
      throw new Error(`Embedding request failed: ${errorText}`)
    }
    const data = await res.json()
    if (data.data?.[0]?.embedding) return data.data[0].embedding
    throw new Error('No embedding in response')
  } catch (err) {
    logger.warn(`Dedicated embedding endpoint failed, using fallback: ${err.message}`)
    return fallbackEmbedding(input)
  }
}

/** 当 AI 嵌入不可用时的回退方案：基于字符哈希生成确定性向量 */
function fallbackEmbedding(text, dim = 128) {
  const vec = new Array(dim).fill(0)
  const chars = [...(text || '')]
  for (let i = 0; i < chars.length; i++) {
    const code = chars[i].charCodeAt(0) || 0
    const idx = i % dim
    vec[idx] += Math.sin(code * (i + 1)) * 0.5 + Math.cos(code * (i + 1)) * 0.5
  }
  // 归一化
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1
  return vec.map(v => v / norm)
}

export async function createChatCompletion(messages, options = {}) {
  return chatCompletions(config.aiChat, {
    model: options.model || config.aiChat.model,
    messages,
    max_tokens: options.max_tokens || 400,
    temperature: options.temperature ?? 0.2
  })
}

export async function describeImage(base64, mimeType = 'image/jpeg') {
  return chatCompletions(config.aiImage, {
    model: config.aiImage.model,
    messages: [
      { role: 'system', content: `你是一个用于解析应用界面截图的视觉助手。你的任务是根据用户上传的截图，输出一段简洁、客观、聚焦于问题事实的文字描述。

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
7. 如果图片质量太差无法辨认内容，输出："【图片描述】图片模糊，无法解析界面细节。"` },
      {
        role: 'user',
        content: [
          { type: 'text', text: '请根据这张截图生成详细的文本描述：' },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
        ]
      }
    ],
    max_tokens: 800,
    temperature: 0.2
  })
}
