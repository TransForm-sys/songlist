/**
 * 备份与回滚。每次快照把歌曲、设置、主播资料打包成一个 JSON 文件，
 * 存进 data/backups/，比拷数据库文件更好读、好下载、好迁移。
 */
import { mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getMeta, getProfile, getSettings, insertSong, listAllSongs, saveProfile, saveSettings, setMeta } from './db.mjs'

const KEEP = Number(process.env.BACKUP_KEEP ?? 60)

export function ensureBackupDir(dir) {
  mkdirSync(dir, { recursive: true })
  return dir
}

function stamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

export function insertBackupRow(db, { createdAt, reason, file, bytes, songCount }) {
  const info = db
    .prepare(
      'INSERT INTO backups (created_at, reason, file, bytes, song_count) VALUES (?, ?, ?, ?, ?)',
    )
    .run(createdAt, reason, file, bytes, songCount)
  return Number(info.lastInsertRowid)
}

export function listBackups(db) {
  return db
    .prepare('SELECT * FROM backups ORDER BY created_at DESC')
    .all()
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      reason: row.reason,
      file: row.file,
      bytes: row.bytes,
      songCount: row.song_count,
    }))
}

export function backupPath(backupsDir, file) {
  return join(backupsDir, file.replace(/[/\\]/g, ''))
}

export function createBackup(db, backupsDir, reason = 'manual') {
  ensureBackupDir(backupsDir)
  const createdAt = Date.now()
  const snapshot = {
    version: 1,
    createdAt,
    reason,
    settings: getSettings(db),
    profile: getProfile(db),
    songs: listAllSongs(db),
  }
  const file = `backup-${stamp(new Date(createdAt))}-${reason}.json`
  const full = backupPath(backupsDir, file)
  const payload = JSON.stringify(snapshot, null, 2)
  writeFileSync(full, payload, 'utf8')
  const id = insertBackupRow(db, {
    createdAt,
    reason,
    file,
    bytes: Buffer.byteLength(payload),
    songCount: snapshot.songs.length,
  })
  pruneBackups(db, backupsDir, KEEP)
  return { id, createdAt, reason, file, songCount: snapshot.songs.length }
}

/** 自动备份节流：同类操作在 minIntervalMs 内只留一份，避免单曲编辑把磁盘塞满 */
export function maybeAutoBackup(db, backupsDir, reason, minIntervalMs = 5 * 60 * 1000) {
  const last = db
    .prepare('SELECT created_at FROM backups WHERE reason = ? ORDER BY created_at DESC LIMIT 1')
    .get(reason)
  if (last && Date.now() - last.created_at < minIntervalMs) return null
  return createBackup(db, backupsDir, reason)
}

export function pruneBackups(db, backupsDir, keep = KEEP) {
  const rows = listBackups(db)
  const doomed = rows.slice(keep)
  for (const row of doomed) {
    try {
      unlinkSync(backupPath(backupsDir, row.file))
    } catch {
      /* 文件可能已被手工删掉 */
    }
    db.prepare('DELETE FROM backups WHERE id = ?').run(row.id)
  }
  return doomed.length
}

/** 清理没有登记在数据库里的孤儿文件 */
export function pruneOrphanFiles(db, backupsDir) {
  const known = new Set(listBackups(db).map((row) => row.file))
  let removed = 0
  for (const name of readdirSync(backupsDir)) {
    if (!name.startsWith('backup-') || known.has(name)) continue
    try {
      unlinkSync(join(backupsDir, name))
      removed++
    } catch {
      /* 忽略 */
    }
  }
  return removed
}

/**
 * 用快照整体覆盖当前数据。恢复前会先给「恢复前」状态再打一份备份，
 * 免得回滚到一半发现回滚错了。
 */
export function restoreBackup(db, backupsDir, id) {
  const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(id)
  if (!row) throw Object.assign(new Error('备份不存在'), { statusCode: 404 })
  const file = backupPath(backupsDir, row.file)
  let snapshot
  try {
    snapshot = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw Object.assign(new Error('备份文件读不出来或已损坏'), { statusCode: 500 })
  }

  createBackup(db, backupsDir, 'before-restore')

  db.exec('BEGIN')
  try {
    db.exec('DELETE FROM songs')
    let position = 1
    for (const song of snapshot.songs ?? []) {
      if (!song?.title) continue
      insertSong(db, song, Number.isFinite(song.position) ? song.position : position)
      position++
    }
    if (snapshot.settings) saveSettings(db, snapshot.settings)
    if (snapshot.profile) saveProfile(db, snapshot.profile)
    setMeta(db, 'restored_at', String(Date.now()))
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  return {
    restored: listAllSongs(db).length,
    from: { id: row.id, file: row.file, createdAt: row.created_at },
  }
}

export function backupFileInfo(backupsDir, file) {
  try {
    return statSync(backupPath(backupsDir, file))
  } catch {
    return null
  }
}

export function audit(db, action, detail = '', ip = '') {
  db.prepare('INSERT INTO audit (created_at, action, detail, ip) VALUES (?, ?, ?, ?)').run(
    Date.now(),
    action,
    typeof detail === 'string' ? detail : JSON.stringify(detail),
    ip,
  )
  // 只留最近 500 条
  db.prepare(
    'DELETE FROM audit WHERE id NOT IN (SELECT id FROM audit ORDER BY id DESC LIMIT 500)',
  ).run()
}

export function listAudit(db, limit = 100) {
  return db
    .prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      action: row.action,
      detail: row.detail,
      ip: row.ip,
    }))
}
