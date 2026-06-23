import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LOG_DIR = path.join(__dirname, '../../logs')

// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true })

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }
const LEVEL = (process.env.LOG_LEVEL || 'debug').toLowerCase()
const CURRENT_LEVEL = LOG_LEVELS[LEVEL] ?? 0

function pad(n) { return String(n).padStart(2, '0') }

function timestamp() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function dateFile() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function writeLog(level, msg) {
  if (LOG_LEVELS[level] < CURRENT_LEVEL) return
  const line = `[${timestamp()}] [${level.toUpperCase()}] ${msg}`
  console.log(line)
  try {
    fs.appendFileSync(path.join(LOG_DIR, `${dateFile()}.log`), line + '\n', 'utf-8')
  } catch { /* ignore write errors */ }
}

export const logger = {
  debug: (msg, ...args) => writeLog('debug', args.length ? `${msg} ${JSON.stringify(args)}` : msg),
  info:  (msg, ...args) => writeLog('info',  args.length ? `${msg} ${JSON.stringify(args)}` : msg),
  warn:  (msg, ...args) => writeLog('warn',  args.length ? `${msg} ${JSON.stringify(args)}` : msg),
  error: (msg, ...args) => writeLog('error', args.length ? `${msg} ${JSON.stringify(args)}` : msg),
}
