/**
 * 把数据库里的内容再导出成 list.txt / profile.json。
 * 这样前台即使后端挂了，退回纯静态文件也照样能用；
 * 同时导出的 list.txt 还能直接回填到表格里。
 */
import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getProfile, getSettings, listAllSongs } from './db.mjs'

const HEADER = ['新', '歌名(单击复制)', '歌手', '语种', '曲风', '需要SC', '备注']

function cleanCell(value) {
  return String(value ?? '')
    .replace(/[\t\r\n]/g, ' ')
    .trim()
}

/**
 * 生成与原表格导出格式一致的文本。
 *
 * 注意：只有歌单里真的存在「需要 SC」的歌时才输出那一列。
 * 这个文件放在网站根目录、是可以被公开访问的，主播不用 SC 点歌时
 * 不该让文件里出现“需要SC”这种付费相关字样（备案审核会看页面与公开文件）。
 */
export function renderListTxt({ streamerName, liveUrl, songs }) {
  const hasSc = songs.some((song) => cleanCell(song.sc))
  const header = hasSc ? HEADER : HEADER.filter((column) => column !== '需要SC')

  const lines = []
  lines.push(cleanCell(streamerName) || '主播')
  lines.push(cleanCell(liveUrl))
  lines.push(header.join('\t'))
  for (const song of songs) {
    const row = [
      song.isNew ? '新' : '',
      cleanCell(song.title),
      cleanCell(song.singer),
      cleanCell(song.language),
      cleanCell(song.genre),
    ]
    if (hasSc) row.push(cleanCell(song.sc))
    row.push(cleanCell(song.note))
    lines.push(row.join('\t'))
  }
  return `${lines.join('\n')}\n`
}

export function renderProfileJson(profile) {
  return `${JSON.stringify(profile ?? {}, null, 2)}\n`
}

/**
 * 把导出文件写到指定目录（通常是前端构建产物目录）。
 * 目录不存在就跳过，避免在没构建过前端的情况下凭空造出 dist/。
 */
export function writeStaticExports(db, staticDir, { silent = false } = {}) {
  if (!staticDir) return null
  if (!existsSync(staticDir)) return null
  const settings = getSettings(db)
  const songs = listAllSongs(db)
  const profile = getProfile(db)
  const listTxt = renderListTxt({ ...settings, songs })
  const profileJson = renderProfileJson(profile)
  try {
    writeFileSync(join(staticDir, 'list.txt'), listTxt, 'utf8')
    writeFileSync(join(staticDir, 'profile.json'), profileJson, 'utf8')
  } catch (error) {
    if (!silent) console.warn('[export] 写静态文件失败:', error.message)
    return null
  }
  return { listTxt, profileJson, songs: songs.length }
}

/** 供 /api/admin/export 下载用 */
export function buildExportFileName(prefix = 'list') {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}.txt`
}

export function staticDirFromEnv(fallback) {
  return process.env.STATIC_DIR || fallback || null
}

export function publicDirFromRoot(root) {
  return join(root, 'dist')
}

export function parentOf(filePath) {
  return dirname(filePath)
}
