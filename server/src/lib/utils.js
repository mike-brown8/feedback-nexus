import fs from 'fs'
import path from 'path'
import { config } from '../../config.js'

export function formatDayUTC8(date = new Date()) {
  const utc8Time = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return utc8Time.toISOString().slice(0, 10)
}

export function ensureUploadPath(userId) {
  const today = formatDayUTC8()
  const base = path.resolve(config.imageStoragePath || process.cwd())
  const folder = path.join(base, userId, today)
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true })
  return folder
}

export async function saveUploadedFile(file, folder) {
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.name)}`
  const dest = path.join(folder, fileName)
  await new Promise((resolve, reject) => {
    file.mv(dest, (err) => (err ? reject(err) : resolve()))
  })
  return dest
}

export function similarity(a, b) {
  if (!a.length || !b.length || a.length !== b.length) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function deleteFileIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch (error) {
    logger.warn(`Failed to delete file ${filePath}: ${error.message}`)
  }
}
