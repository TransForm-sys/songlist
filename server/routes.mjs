/**
 * 全部 API：公开接口（前台用）+ 管理接口（后台用）。
 * 约定：handler 返回对象即 200 JSON；自己发响应的返回 undefined；
 * 抛错时带上 statusCode / message。
 */
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createRouter,
  sendJson,
  parseCookies,
  serializeCookie,
} from './lib/http.mjs'
import {
  DEFAULT_SETTINGS,
  countSongs,
  deleteSongs,
  getProfile,
  getSettings,
  listAllSongs,
  nextPosition,
  normalizeSearchTerm,
  reorderSongs,
  rowToSong,
  saveProfile,
  saveSettings,
  songKey,
  songLooseKey,
} from './lib/db.mjs'
import { insertSong, updateSong } from './lib/db.mjs'
import {
  SESSION_COOKIE,
  checkPasswordStrength,
  checkRateLimit,
  clearFailures,
  createSession,
  destroySession,
  findUser,
  getSessionUser,
  isInitialPassword,
  purgeExpiredSessions,
  recordFailure,
  setPassword,
  verifyPassword,
} from './lib/auth.mjs'
import {
  audit,
  backupPath,
  createBackup,
  listAudit,
  listBackups,
  maybeAutoBackup,
  restoreBackup,
} from './lib/backup.mjs'
import { buildExportFileName, renderListTxt, writeStaticExports } from './lib/export.mjs'
import { readFileSync, unlinkSync, statSync } from 'node:fs'

const ALLOWED_UPLOAD = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  // 背景视频：只收浏览器都解得开的两个容器
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024
/**
 * 视频单独放宽到 8MB。
 * 上传走 base64 的 JSON 请求体（体积膨胀约 1/3），而服务端请求体上限是 12MB，
 * 8MB 视频 ≈ 10.7MB 请求体，刚好在安全范围内；再大就得改成二进制直传了。
 */
const MAX_VIDEO_BYTES = 8 * 1024 * 1024

function bad(status, message) {
  return Object.assign(new Error(message), { statusCode: status })
}

function str(value, fallback = '') {
  return value === undefined || value === null ? fallback : String(value)
}

function normalizeSongInput(input = {}) {
  return {
    title: str(input.title).trim(),
    singer: str(input.singer).trim(),
    language: str(input.language).trim(),
    genre: str(input.genre).trim(),
    sc: str(input.sc).trim(),
    note: str(input.note).trim(),
    isNew: Boolean(input.isNew),
  }
}

/** 组装筛选 WHERE；skip 用于分面统计时排除自己这一维 */
function buildFilters(query = {}, skip = null) {
  const clauses = []
  const params = []
  const q = normalizeSearchTerm(query.q)
  if (q) {
    clauses.push('search_blob LIKE ?')
    params.push(`%${q}%`)
  }
  const addMulti = (key, column) => {
    if (skip === key) return
    const values = str(query[key])
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    if (!values.length) return
    clauses.push(`${column} IN (${values.map(() => '?').join(',')})`)
    params.push(...values)
  }
  addMulti('language', 'language')
  addMulti('genre', 'genre')
  addMulti('singer', 'singer')
  if (skip !== 'sc' && (query.sc === '1' || query.sc === 'true')) clauses.push("sc <> ''")
  if (query.isNew === '1' || query.isNew === 'true') clauses.push('is_new = 1')
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params }
}

function facetOf(db, column, query, skip) {
  const { where, params } = buildFilters(query, skip)
  const clause = where ? `${where} AND ${column} <> ''` : `WHERE ${column} <> ''`
  return db
    .prepare(
      `SELECT ${column} AS value, COUNT(*) AS count FROM songs ${clause} GROUP BY ${column} ORDER BY count DESC, value ASC`,
    )
    .all(...params)
}

function scalar(db, sql, ...params) {
  const row = db.prepare(sql).get(...params)
  return row ? Number(row.n ?? 0) : 0
}

export function createApi({ db, config }) {
  const router = createRouter()

  const requireUser = (ctx) => {
    if (!ctx.user) throw bad(401, '未登录或登录已过期')
    return ctx.user
  }

  const afterWrite = (ctx, action, detail) => {
    writeStaticExports(db, config.staticDir, { silent: true })
    audit(db, action, detail, ctx.ip)
  }

  /* ------------------------------ 公开接口 ------------------------------ */

  router.get('/api/health', () => ({
    ok: true,
    songs: countSongs(db),
    time: Date.now(),
  }))

  /** 前台读这个：meta + 全部歌曲 */
  router.get('/api/songs', () => {
    const settings = getSettings(db)
    return {
      meta: {
        streamerName: settings.streamerName,
        liveUrl: settings.liveUrl,
        icp: settings.icp,
        police: settings.police,
        notice: settings.notice,
        background: settings.background,
        backgroundPosition: settings.backgroundPosition,
        backgroundVideo: settings.backgroundVideo,
      },
      songs: listAllSongs(db).map((song) => ({
        id: song.id,
        isNew: song.isNew,
        title: song.title,
        singer: song.singer,
        language: song.language,
        genre: song.genre,
        sc: song.sc,
        note: song.note,
      })),
      total: countSongs(db),
      generatedAt: Date.now(),
    }
  })

  router.get('/api/profile', () => getProfile(db) ?? null)

  /* ------------------------------ 登录 ------------------------------ */

  router.get('/api/auth/session', (ctx) => ({
    authed: Boolean(ctx.user),
    user: ctx.user ? { username: ctx.user.username } : null,
    // 还在用初始密码的话，后台要提示去改
    passwordIsInitial: ctx.user ? isInitialPassword(db, ctx.user.username) : null,
  }))

  router.post('/api/auth/login', async (ctx) => {
    const body = ctx.body ?? {}
    const username = str(body.username).trim()
    const password = str(body.password)
    if (!username || !password) throw bad(400, '请输入用户名和密码')

    const limit = checkRateLimit(`login:${ctx.ip}`)
    if (!limit.allowed) {
      throw bad(429, `尝试次数过多，请 ${Math.ceil((limit.retryAfterMs ?? 0) / 60000)} 分钟后再试`)
    }

    const user = findUser(db, username)
    if (!user || !verifyPassword(password, user.password_hash)) {
      recordFailure(`login:${ctx.ip}`)
      throw bad(401, '用户名或密码不对')
    }

    clearFailures(`login:${ctx.ip}`)
    purgeExpiredSessions(db)
    const session = createSession(db, user.id, { userAgent: ctx.userAgent, ip: ctx.ip })
    ctx.setCookie(
      serializeCookie(SESSION_COOKIE, session.id, {
        path: '/',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'Lax',
        secure: config.cookieSecure,
      }),
    )
    audit(db, 'login', user.username, ctx.ip)
    return { ok: true, user: { username: user.username } }
  })

  router.post('/api/auth/logout', (ctx) => {
    const cookies = parseCookies(ctx.req.headers.cookie)
    destroySession(db, cookies[SESSION_COOKIE])
    ctx.setCookie(
      serializeCookie(SESSION_COOKIE, '', {
        path: '/',
        maxAge: 0,
        sameSite: 'Lax',
        secure: config.cookieSecure,
      }),
    )
    return { ok: true }
  })

  /**
   * 改密码。只接受明文入参，落库一律 scrypt 哈希；
   * 改完把其他设备的会话全部踢下线，当前会话保留。
   */
  router.post('/api/admin/password', async (ctx) => {
    const user = requireUser(ctx)
    const body = ctx.body ?? {}
    const current = str(body.currentPassword)
    const next = str(body.newPassword)
    if (!current || !next) throw bad(400, '请填写当前密码和新密码')
    if (next === current) throw bad(400, '新密码不能和当前密码相同')

    const row = findUser(db, user.username)
    if (!row || !verifyPassword(current, row.password_hash)) {
      recordFailure(`password:${ctx.ip}`)
      throw bad(401, '当前密码不对')
    }
    const strength = checkPasswordStrength(next)
    if (!strength.ok) throw bad(400, strength.message)

    setPassword(db, row.id, next)
    // 其他设备上的会话立即失效
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(row.id, user.sessionId)
    audit(db, 'password.change', user.username, ctx.ip)
    return { ok: true, message: '密码已更新，其他设备需要重新登录' }
  })

  /* ------------------------------ 概览 ------------------------------ */

  router.get('/api/admin/overview', (ctx) => {
    requireUser(ctx)
    const total = countSongs(db)
    const lastBackup = listBackups(db)[0] ?? null
    const dbFile = join(config.dataDir, 'songlist.db')
    let dbBytes = 0
    try {
      dbBytes = statSync(dbFile).size
    } catch {
      /* 忽略 */
    }
    return {
      songs: total,
      scSongs: scalar(db, "SELECT COUNT(*) AS n FROM songs WHERE sc <> ''"),
      newSongs: scalar(db, 'SELECT COUNT(*) AS n FROM songs WHERE is_new = 1'),
      languages: facetOf(db, 'language', {}, null),
      genres: facetOf(db, 'genre', {}, null),
      singers: scalar(db, 'SELECT COUNT(DISTINCT singer) AS n FROM songs'),
      lastBackup,
      backups: listBackups(db).length,
      dbBytes,
      settings: getSettings(db),
    }
  })

  /* ------------------------------ 歌曲：读 ------------------------------ */

  router.get('/api/admin/songs', (ctx) => {
    requireUser(ctx)
    const query = ctx.query
    const { where, params } = buildFilters(query)
    const total = scalar(db, `SELECT COUNT(*) AS n FROM songs ${where}`, ...params)
    const page = Math.max(1, Number(query.page) || 1)
    const pageSize = Math.min(500, Math.max(1, Number(query.pageSize) || 50))
    const sortMap = {
      position: 'position ASC, id ASC',
      title: 'title ASC, id ASC',
      singer: 'singer ASC, id ASC',
      updated: 'updated_at DESC, id DESC',
      created: 'created_at DESC, id DESC',
    }
    const order = sortMap[query.sort] ?? sortMap.position
    const items = db
      .prepare(`SELECT * FROM songs ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize)
      .map(rowToSong)

    return {
      items,
      total,
      page,
      pageSize,
      facets: {
        language: facetOf(db, 'language', query, 'language'),
        genre: facetOf(db, 'genre', query, 'genre'),
        singer: facetOf(db, 'singer', query, 'singer'),
      },
      scCount: scalar(
        db,
        `SELECT COUNT(*) AS n FROM songs ${buildFilters(query, 'sc').where || 'WHERE 1=1'} AND sc <> ''`,
        ...buildFilters(query, 'sc').params,
      ),
    }
  })

  router.get('/api/admin/songs/:id', (ctx) => {
    requireUser(ctx)
    const row = db.prepare('SELECT * FROM songs WHERE id = ?').get(Number(ctx.params.id))
    if (!row) throw bad(404, '这首歌不存在')
    return rowToSong(row)
  })

  /* ------------------------------ 歌曲：写 ------------------------------ */

  router.post('/api/admin/songs', async (ctx) => {
    requireUser(ctx)
    const song = normalizeSongInput(ctx.body)
    if (!song.title) throw bad(400, '歌名不能为空')

    maybeAutoBackup(db, config.backupsDir, 'auto')
    const id = insertSong(db, song, nextPosition(db))
    afterWrite(ctx, 'song.create', song.title)
    return { ok: true, id, song: { ...song, id } }
  })

  router.put('/api/admin/songs/:id', async (ctx) => {
    requireUser(ctx)
    const id = Number(ctx.params.id)
    const row = db.prepare('SELECT * FROM songs WHERE id = ?').get(id)
    if (!row) throw bad(404, '这首歌不存在')
    const patch = normalizeSongInput({ ...rowToSong(row), ...ctx.body })
    if (!patch.title) throw bad(400, '歌名不能为空')

    maybeAutoBackup(db, config.backupsDir, 'auto')
    updateSong(db, id, patch)
    afterWrite(ctx, 'song.update', patch.title)
    return { ok: true, song: { ...patch, id } }
  })

  router.delete('/api/admin/songs/:id', async (ctx) => {
    requireUser(ctx)
    const id = Number(ctx.params.id)
    const row = db.prepare('SELECT title FROM songs WHERE id = ?').get(id)
    if (!row) throw bad(404, '这首歌不存在')
    maybeAutoBackup(db, config.backupsDir, 'auto')
    deleteSongs(db, [id])
    afterWrite(ctx, 'song.delete', row.title)
    return { ok: true }
  })

  /**
   * 批量删除
   */
  router.post('/api/admin/songs/bulk-delete', async (ctx) => {
    requireUser(ctx)
    const ids = (ctx.body?.ids ?? []).map(Number).filter(Number.isFinite)
    if (!ids.length) throw bad(400, '没有选中任何歌曲')
    maybeAutoBackup(db, config.backupsDir, 'auto')
    const removed = deleteSongs(db, ids)
    afterWrite(ctx, 'song.bulk-delete', `${removed} 首`)
    return { ok: true, removed }
  })

  /**
   * 清空曲库（换歌单时用）。属于破坏性操作，必定先单独备份。
   */
  router.post('/api/admin/songs/clear', async (ctx) => {
    requireUser(ctx)
    const total = countSongs(db)
    if (!total) return { ok: true, removed: 0 }
    createBackup(db, config.backupsDir, 'before-clear')
    db.exec('DELETE FROM songs')
    afterWrite(ctx, 'song.clear', `清空 ${total} 首`)
    return { ok: true, removed: total }
  })

  /**
   * 批量导入（对应 VioletBlue 的「批量新增」）。
   * mode: append 追加 / replace 清空后导入
   */
  router.post('/api/admin/songs/bulk', async (ctx) => {
    requireUser(ctx)
    const body = ctx.body ?? {}
    const rawItems = Array.isArray(body.items) ? body.items : []
    if (!rawItems.length) throw bad(400, '没有可导入的内容')
    const mode = body.mode === 'replace' ? 'replace' : 'append'

    const items = rawItems.map(normalizeSongInput).filter((song) => song.title)
    if (!items.length) throw bad(400, '所有行都缺少歌名')

    // 整行一致才算重复（跳过）；只有歌名+歌手相同则照样导入，但标记为「疑似重复」
    //
    // 注意：**覆盖模式不能拿现有库去重** —— 覆盖本来就是要清空重来，
    // 若先按"与现有库重复"过滤，导入同一份歌单时会把所有行判成重复，
    // 于是「删光了但一首都没插」，整个歌单直接消失。
    const dedupeAgainstLibrary = mode !== 'replace'
    const existing = new Set(
      dedupeAgainstLibrary
        ? db
            .prepare('SELECT * FROM songs')
            .all()
            .map((row) => songKey(rowToSong(row)))
        : [],
    )
    const existingLoose = new Set(
      dedupeAgainstLibrary
        ? db
            .prepare('SELECT title, singer FROM songs')
            .all()
            .map((row) => songLooseKey(row))
        : [],
    )

    const skipped = rawItems.length - items.length
    const duplicates = []
    const similar = []
    const toInsert = []
    for (const song of items) {
      const key = songKey(song)
      if (existing.has(key)) {
        duplicates.push({ title: song.title, singer: song.singer })
        continue
      }
      if (existingLoose.has(songLooseKey(song))) {
        similar.push({ title: song.title, singer: song.singer })
      }
      existing.add(key)
      existingLoose.add(songLooseKey(song))
      toInsert.push(song)
    }

    // 覆盖式导入属于破坏性操作，先单独留一份备份
    if (mode === 'replace') createBackup(db, config.backupsDir, 'before-replace')
    else maybeAutoBackup(db, config.backupsDir, 'auto')

    // 兜底：覆盖模式下如果一行都没留下（比如全被当成批内重复），
    // 绝不能真的去清空 —— 宁可报错让用户检查，也不制造"歌单突然空了"
    if (mode === 'replace' && toInsert.length === 0) {
      throw bad(400, '这批内容没有可导入的行，已取消覆盖（歌单保持原样）')
    }

    db.exec('BEGIN')
    try {
      if (mode === 'replace') db.exec('DELETE FROM songs')
      let position = mode === 'replace' ? 1 : nextPosition(db)
      for (const song of toInsert) {
        insertSong(db, song, position)
        position++
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    afterWrite(ctx, 'song.bulk-import', `${mode} / 新增 ${toInsert.length} / 重复 ${duplicates.length}`)
    return {
      ok: true,
      mode,
      received: rawItems.length,
      added: toInsert.length,
      skipped,
      duplicates: duplicates.slice(0, 50),
      duplicateCount: duplicates.length,
      similar: similar.slice(0, 50),
      similarCount: similar.length,
      total: countSongs(db),
    }
  })

  /** 拖拽排序：按传入顺序重写 position */
  router.post('/api/admin/songs/reorder', async (ctx) => {
    requireUser(ctx)
    const ids = (ctx.body?.ids ?? []).map(Number).filter(Number.isFinite)
    if (!ids.length) throw bad(400, '缺少排序数据')
    maybeAutoBackup(db, config.backupsDir, 'auto')
    reorderSongs(db, ids)
    afterWrite(ctx, 'song.reorder', `${ids.length} 首`)
    return { ok: true, count: ids.length }
  })

  /** 置顶 / 置底 */
  router.post('/api/admin/songs/pin', async (ctx) => {
    requireUser(ctx)
    const body = ctx.body ?? {}
    const ids = (body.ids ?? []).map(Number).filter(Number.isFinite)
    if (!ids.length) throw bad(400, '没有选中歌曲')
    const mode = body.mode === 'bottom' ? 'bottom' : 'top'

    const all = listAllSongs(db).map((song) => song.id)
    const picked = all.filter((id) => ids.includes(id))
    const rest = all.filter((id) => !ids.includes(id))
    const ordered = mode === 'top' ? [...picked, ...rest] : [...rest, ...picked]

    maybeAutoBackup(db, config.backupsDir, 'auto')
    reorderSongs(db, ordered)
    afterWrite(ctx, 'song.pin', `${mode} / ${picked.length} 首`)
    return { ok: true, mode, count: picked.length }
  })

  /** 上移 / 下移一格 */
  router.post('/api/admin/songs/:id/move', async (ctx) => {
    requireUser(ctx)
    const id = Number(ctx.params.id)
    const direction = ctx.body?.direction === 'up' ? 'up' : 'down'
    const all = listAllSongs(db).map((song) => song.id)
    const index = all.indexOf(id)
    if (index < 0) throw bad(404, '这首歌不存在')
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= all.length) return { ok: true, moved: false }

    const ordered = [...all]
    ;[ordered[index], ordered[target]] = [ordered[target], ordered[index]]
    maybeAutoBackup(db, config.backupsDir, 'auto')
    reorderSongs(db, ordered)
    afterWrite(ctx, 'song.move', `${direction} / #${id}`)
    return { ok: true, moved: true }
  })

  /* ------------------------------ 主播资料 ------------------------------ */

  router.get('/api/admin/profile', (ctx) => {
    requireUser(ctx)
    return { profile: getProfile(db) }
  })

  router.put('/api/admin/profile', async (ctx) => {
    requireUser(ctx)
    const profile = ctx.body?.profile ?? ctx.body
    if (profile && typeof profile !== 'object') throw bad(400, '资料格式不正确')
    if (profile?.blocks && !Array.isArray(profile.blocks)) throw bad(400, 'blocks 必须是数组')
    if (profile?.tags && !Array.isArray(profile.tags)) throw bad(400, 'tags 必须是数组')
    if (profile?.links && !Array.isArray(profile.links)) throw bad(400, 'links 必须是数组')

    maybeAutoBackup(db, config.backupsDir, 'auto')
    saveProfile(db, profile ?? {})
    afterWrite(ctx, 'profile.update', '')
    return { ok: true, profile: getProfile(db) }
  })

  /* ------------------------------ 站点设置 ------------------------------ */

  router.get('/api/admin/settings', (ctx) => {
    requireUser(ctx)
    return { settings: getSettings(db), defaults: DEFAULT_SETTINGS }
  })

  router.put('/api/admin/settings', async (ctx) => {
    requireUser(ctx)
    const patch = ctx.body?.settings ?? ctx.body ?? {}
    const unknown = Object.keys(patch).filter((key) => !(key in DEFAULT_SETTINGS))
    if (unknown.length) throw bad(400, `不认识的设置项：${unknown.join(', ')}`)
    maybeAutoBackup(db, config.backupsDir, 'auto')
    const settings = saveSettings(db, patch)
    afterWrite(ctx, 'settings.update', Object.keys(patch).join(','))
    return { ok: true, settings }
  })

  /* ------------------------------ 图片 / 视频上传 ------------------------------ */

  router.post('/api/admin/upload', async (ctx) => {
    requireUser(ctx)
    const { filename, dataUrl } = ctx.body ?? {}
    const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(str(dataUrl))
    if (!match) throw bad(400, '只接受 base64 dataUrl 形式的图片或视频')
    const mime = match[1].toLowerCase()
    const ext = ALLOWED_UPLOAD[mime]
    if (!ext) throw bad(400, `不支持的文件格式：${mime}`)
    const buffer = Buffer.from(match[2], 'base64')
    const isVideo = mime.startsWith('video/')
    const limit = isVideo ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES
    if (buffer.length > limit) {
      const mb = Math.round(limit / 1024 / 1024)
      throw bad(413, `${isVideo ? '视频' : '图片'}太大了（上限 ${mb}MB）`)
    }
    const name = `${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`
    writeFileSync(join(config.uploadsDir, name), buffer)
    const url = `/uploads/${name}`
    audit(db, 'upload', `${str(filename) || name} (${buffer.length}B)`, ctx.ip)
    return { ok: true, url, bytes: buffer.length, kind: isVideo ? 'video' : 'image' }
  })

  /* ------------------------------ 备份与回滚 ------------------------------ */

  router.get('/api/admin/backups', (ctx) => {
    requireUser(ctx)
    return {
      backups: listBackups(db),
      keep: Number(process.env.BACKUP_KEEP ?? 60),
    }
  })

  router.post('/api/admin/backups', async (ctx) => {
    requireUser(ctx)
    const reason = str(ctx.body?.reason, 'manual').slice(0, 40) || 'manual'
    const created = createBackup(db, config.backupsDir, reason)
    audit(db, 'backup.create', created.file, ctx.ip)
    return { ok: true, backup: created }
  })

  router.post('/api/admin/backups/:id/restore', async (ctx) => {
    requireUser(ctx)
    const result = restoreBackup(db, config.backupsDir, Number(ctx.params.id))
    afterWrite(ctx, 'backup.restore', `#${ctx.params.id}`)
    return { ok: true, ...result, total: countSongs(db) }
  })

  router.delete('/api/admin/backups/:id', async (ctx) => {
    requireUser(ctx)
    const id = Number(ctx.params.id)
    const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(id)
    if (!row) throw bad(404, '备份不存在')
    try {
      unlinkSync(backupPath(config.backupsDir, row.file))
    } catch {
      /* 文件可能已经不在 */
    }
    db.prepare('DELETE FROM backups WHERE id = ?').run(id)
    audit(db, 'backup.delete', row.file, ctx.ip)
    return { ok: true }
  })

  router.get('/api/admin/backups/:id/download', (ctx) => {
    requireUser(ctx)
    const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(Number(ctx.params.id))
    if (!row) throw bad(404, '备份不存在')
    const file = backupPath(config.backupsDir, row.file)
    let content
    try {
      content = readFileSync(file)
    } catch {
      throw bad(500, '备份文件读不出来')
    }
    ctx.res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': content.length,
      'Content-Disposition': `attachment; filename="${row.file}"`,
    })
    ctx.res.end(content)
    return undefined
  })

  /* ------------------------------ 导出 ------------------------------ */

  router.get('/api/admin/export', (ctx) => {
    requireUser(ctx)
    const settings = getSettings(db)
    const songs = listAllSongs(db)
    const format = ctx.query.format === 'json' ? 'json' : 'txt'
    if (format === 'json') {
      const payload = JSON.stringify({ settings, profile: getProfile(db), songs }, null, 2)
      const content = Buffer.from(payload, 'utf8')
      ctx.res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': content.length,
        'Content-Disposition': `attachment; filename="songlist-full.json"`,
      })
      ctx.res.end(content)
      return undefined
    }
    const content = Buffer.from(renderListTxt({ ...settings, songs }), 'utf8')
    ctx.res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': content.length,
      'Content-Disposition': `attachment; filename="${buildExportFileName()}"`,
    })
    ctx.res.end(content)
    return undefined
  })

  router.get('/api/admin/audit', (ctx) => {
    requireUser(ctx)
    return { items: listAudit(db, Math.min(200, Number(ctx.query.limit) || 100)) }
  })

  return router
}
