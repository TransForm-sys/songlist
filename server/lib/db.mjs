/**
 * SQLite 数据层。用 Node 内置的 node:sqlite，避免任何原生编译依赖
 * （服务器上直接 node 就能跑，不需要 node-gyp / python / build-essential）。
 *
 * 需要 Node >= 22.5（22.x 要加 --experimental-sqlite，23.4+ 直接可用）。
 */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pinyin } from 'pinyin-pro'

const SCHEMA_VERSION = 1

/**
 * 检索串：原名 + 拼音全拼 + 拼音首字母，全部小写去空格。
 * 这样后台搜索框里敲 dukou / dk / 渡口 都能命中同一首。
 */
export function buildSearchBlob(song) {
  const text = [song.title, song.singer, song.genre, song.language, song.note]
    .filter(Boolean)
    .join(' ')
  let full = ''
  let initials = ''
  try {
    full = pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' }).join('')
    initials = pinyin(text, {
      toneType: 'none',
      type: 'array',
      pattern: 'first',
      nonZh: 'consecutive',
    }).join('')
  } catch {
    /* 拼音库出问题时只影响拼音搜索 */
  }
  return `${text} ${full} ${initials}`.toLowerCase().replace(/\s+/g, '')
}

/** 归一化搜索词，和 search_blob 的口径保持一致 */
export function normalizeSearchTerm(term) {
  return String(term ?? '').toLowerCase().replace(/\s+/g, '')
}

export function openDatabase(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      user_agent TEXT NOT NULL DEFAULT '',
      ip         TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS songs (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      title      TEXT NOT NULL,
      singer     TEXT NOT NULL DEFAULT '',
      language   TEXT NOT NULL DEFAULT '',
      genre      TEXT NOT NULL DEFAULT '',
      sc         TEXT NOT NULL DEFAULT '',
      note       TEXT NOT NULL DEFAULT '',
      is_new     INTEGER NOT NULL DEFAULT 0,
      position   INTEGER NOT NULL DEFAULT 0,
      search_blob TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_songs_position ON songs(position, id);
    CREATE INDEX IF NOT EXISTS idx_songs_title ON songs(title);
    CREATE INDEX IF NOT EXISTS idx_songs_singer ON songs(singer);
    CREATE INDEX IF NOT EXISTS idx_songs_language ON songs(language);
    CREATE INDEX IF NOT EXISTS idx_songs_genre ON songs(genre);
    CREATE INDEX IF NOT EXISTS idx_songs_search ON songs(search_blob);

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS profile (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      json       TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS backups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      reason     TEXT NOT NULL DEFAULT 'manual',
      file       TEXT NOT NULL,
      bytes      INTEGER NOT NULL DEFAULT 0,
      song_count INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS audit (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      action     TEXT NOT NULL,
      detail     TEXT NOT NULL DEFAULT '',
      ip         TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit(created_at DESC);
  `)

  const current = Number(getMeta(db, 'schema_version') ?? 0)
  if (current !== SCHEMA_VERSION) {
    setMeta(db, 'schema_version', String(SCHEMA_VERSION))
  }
}

export function getMeta(db, key) {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key)
  return row ? row.value : null
}

export function setMeta(db, key, value) {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

/* ------------------------------ 设置项 ------------------------------ */

export const DEFAULT_SETTINGS = {
  streamerName: '示例主播',
  liveUrl: '',
  /** ICP 备案号，例如 京ICP备2023000000号-1 */
  icp: '',
  /** 公安备案号，例如 京公网安备11010502030123号 */
  police: '',
  notice: '',
  /**
   * 全屏背景图（侧栏布局用）。空字符串 = 不用背景图，前台退回渐变底色。
   * 填的是 /uploads/xxx.jpg 这种站内相对路径（后台上传后自动得到）。
   */
  background: '',
  /** 背景图裁切焦点：top / center / bottom（竖构图插画宽屏会被裁，用它保住头或脚） */
  backgroundPosition: 'top',
  /**
   * 背景视频（.mp4 / .webm）。填了就优先用视频当背景，background 那张图退化成
   * 视频的 poster（首帧出来前先显示它）。
   * 只在宽屏加载 —— 手机上放视频费流量、费电，而且 iOS 会限制自动播放。
   */
  backgroundVideo: '',
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all()
  const out = { ...DEFAULT_SETTINGS }
  for (const row of rows) {
    if (row.key in out) out[row.key] = row.value
  }
  return out
}

export function saveSettings(db, patch) {
  const stmt = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue
    stmt.run(key, value == null ? '' : String(value))
  }
  return getSettings(db)
}

/* ------------------------------ 主播资料 ------------------------------ */

export function getProfile(db) {
  const row = db.prepare('SELECT json FROM profile WHERE id = 1').get()
  if (!row) return null
  try {
    return JSON.parse(row.json)
  } catch {
    return null
  }
}

export function saveProfile(db, profile) {
  const json = JSON.stringify(profile ?? {}, null, 2)
  db.prepare(
    `INSERT INTO profile (id, json, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
  ).run(json, Date.now())
  return profile ?? {}
}

/* ------------------------------ 歌曲 ------------------------------ */

export function rowToSong(row) {
  return {
    id: row.id,
    title: row.title,
    singer: row.singer,
    language: row.language,
    genre: row.genre,
    sc: row.sc,
    note: row.note,
    isNew: Boolean(row.is_new),
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listAllSongs(db) {
  return db
    .prepare(
      'SELECT * FROM songs ORDER BY position ASC, id ASC',
    )
    .all()
    .map(rowToSong)
}

export function countSongs(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM songs').get().n
}

export function nextPosition(db) {
  const row = db.prepare('SELECT MAX(position) AS maxPos FROM songs').get()
  return (row?.maxPos ?? 0) + 1
}

/**
 * 去重键：**整行**完全一致才算真正的重复。
 * 只用「歌名+歌手」会把"同一首但曲风/语种填得不一样"的行误删，
 * 那是用户的真实数据，不能悄悄吃掉。
 */
export function songKey(song) {
  return [song.title, song.singer, song.language, song.genre, song.sc, song.note]
    .map((value) => String(value ?? '').trim())
    .join('\u0000')
}

/** 宽松键（歌名+歌手）：只用来给用户提示「疑似重复」，绝不据此丢弃数据 */
export function songLooseKey(song) {
  return `${String(song.title ?? '').trim()}\u0000${String(song.singer ?? '').trim()}`
}

export function insertSong(db, song, position) {
  const now = Date.now()
  const info = db
    .prepare(
      `INSERT INTO songs (title, singer, language, genre, sc, note, is_new, position, search_blob, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      String(song.title ?? '').trim(),
      String(song.singer ?? '').trim(),
      String(song.language ?? '').trim(),
      String(song.genre ?? '').trim(),
      String(song.sc ?? '').trim(),
      String(song.note ?? '').trim(),
      song.isNew ? 1 : 0,
      position,
      buildSearchBlob(song),
      now,
      now,
    )
  return Number(info.lastInsertRowid)
}

export function updateSong(db, id, patch) {
  const fields = []
  const values = []
  const map = {
    title: 'title',
    singer: 'singer',
    language: 'language',
    genre: 'genre',
    sc: 'sc',
    note: 'note',
    isNew: 'is_new',
  }
  for (const [key, column] of Object.entries(map)) {
    if (!(key in patch)) continue
    fields.push(`${column} = ?`)
    values.push(key === 'isNew' ? (patch.isNew ? 1 : 0) : String(patch[key] ?? '').trim())
  }
  if (!fields.length) return false
  fields.push('updated_at = ?')
  values.push(Date.now(), id)
  db.prepare(`UPDATE songs SET ${fields.join(', ')} WHERE id = ?`).run(...values)

  // 检索串依赖多个字段，改了任何一个就整体重建
  const row = db.prepare('SELECT * FROM songs WHERE id = ?').get(id)
  if (row) {
    db.prepare('UPDATE songs SET search_blob = ? WHERE id = ?').run(buildSearchBlob(rowToSong(row)), id)
  }
  return true
}

/** 启动时补齐/修复检索串（比如从旧数据导入、或改了拼音口径） */
export function rebuildSearchBlobs(db, { force = false } = {}) {
  const rows = db
    .prepare(force ? 'SELECT * FROM songs' : "SELECT * FROM songs WHERE search_blob = ''")
    .all()
  if (!rows.length) return 0
  const stmt = db.prepare('UPDATE songs SET search_blob = ? WHERE id = ?')
  db.exec('BEGIN')
  try {
    for (const row of rows) stmt.run(buildSearchBlob(rowToSong(row)), row.id)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return rows.length
}

export function deleteSongs(db, ids) {
  if (!ids.length) return 0
  const placeholders = ids.map(() => '?').join(',')
  const info = db.prepare(`DELETE FROM songs WHERE id IN (${placeholders})`).run(...ids)
  return info.changes
}

/** 拖拽排序：按传入的 id 顺序重排 position */
export function reorderSongs(db, ids) {
  const stmt = db.prepare('UPDATE songs SET position = ? WHERE id = ?')
  ids.forEach((id, index) => stmt.run(index + 1, id))
}

/** 导出用：把全部数据打包成一个 JSON（也用于 list.txt 生成） */
export function snapshotData(db) {
  return {
    version: SCHEMA_VERSION,
    createdAt: Date.now(),
    settings: getSettings(db),
    profile: getProfile(db),
    songs: listAllSongs(db),
  }
}

export function defaultDbPath(dataDir) {
  return join(dataDir, 'songlist.db')
}

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
