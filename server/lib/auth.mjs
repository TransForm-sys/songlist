/**
 * 登录与会话。密码用 scrypt 加盐哈希，会话 id 是随机串，存在 SQLite 里，
 * 浏览器只拿到 HttpOnly cookie。
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 }
export const SESSION_COOKIE = 'songlist_session'
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  })
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$')
}

export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$')
    if (scheme !== 'scrypt') return false
    const salt = Buffer.from(saltB64, 'base64')
    const expected = Buffer.from(hashB64, 'base64')
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function countUsers(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM users').get().n
}

export function findUser(db, username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username) ?? null
}

/** 密码强度：至少 8 位，且不能是常见弱口令 */
const WEAK_PASSWORDS = new Set([
  'password',
  'password1',
  '12345678',
  '123456789',
  '1234567890',
  'admin123',
  'admin1234',
  'qwertyui',
  'qwerty123',
  'abc123456',
  'iloveyou',
  'songlist',
  'adminadmin',
])

export function checkPasswordStrength(password) {
  const value = String(password ?? '')
  if (value.length < 8) return { ok: false, message: '密码至少 8 位' }
  if (value.length > 200) return { ok: false, message: '密码太长了' }
  if (WEAK_PASSWORDS.has(value.toLowerCase())) return { ok: false, message: '这个密码太常见了，换一个' }
  if (/^(.)\1+$/.test(value)) return { ok: false, message: '密码不能是同一个字符重复' }
  return { ok: true }
}

export function upsertUser(db, username, password) {
  const strength = checkPasswordStrength(password)
  if (!strength.ok) throw Object.assign(new Error(strength.message), { statusCode: 400 })
  const now = Date.now()
  const existing = findUser(db, username)
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hashPassword(password),
      now,
      existing.id,
    )
    return existing.id
  }
  const info = db
    .prepare(
      'INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)',
    )
    .run(username, hashPassword(password), now, now)
  return Number(info.lastInsertRowid)
}

/** 改密码：只接受明文入参，落库一律是哈希 */
export function setPassword(db, userId, newPassword) {
  const strength = checkPasswordStrength(newPassword)
  if (!strength.ok) throw Object.assign(new Error(strength.message), { statusCode: 400 })
  db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
    hashPassword(newPassword),
    Date.now(),
    userId,
  )
}

/** 是否已经被人改过密码（首次生成的那种算「还没改」） */
export function passwordUpdatedAt(db, username) {
  const row = db.prepare('SELECT updated_at, created_at FROM users WHERE username = ?').get(username)
  if (!row) return null
  return { updatedAt: row.updated_at, createdAt: row.created_at }
}

export function isInitialPassword(db, username) {
  const info = passwordUpdatedAt(db, username)
  if (!info) return true
  // 建号时 created_at 与 updated_at 写的是同一个值，改过密码后 updated_at 才会变晚。
  // 所以直接比大小即可 —— 之前用了 1 秒容差，结果"开机后马上改密码"会被误判成没改过。
  return info.updatedAt <= info.createdAt
}

/**
 * 首次启动时准备管理员账号。
 *
 * 重要：只在数据库里还没有用户时创建，之后**永远不会**用环境变量覆盖已有密码，
 * 免得一份明文 env 文件长期挂在服务器上。忘记密码请用 scripts/reset-password.mjs。
 *
 * 支持 ADMIN_PASSWORD_HASH：直接给 scrypt 哈希（适合用配置管理下发，无需明文）。
 */
export function ensureAdmin(db, { username, password, generatedPassword, passwordHash }) {
  const user = username || process.env.ADMIN_USER || 'admin'

  if (countUsers(db) > 0) {
    return { username: user, password: null, generated: false, created: false }
  }

  const now = Date.now()
  if (passwordHash) {
    if (!isPasswordHash(passwordHash)) {
      throw new Error('ADMIN_PASSWORD_HASH 格式不对，应为 scrypt$N$r$p$salt$hash')
    }
    db.prepare(
      'INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)',
    ).run(user, passwordHash, now, now)
    return { username: user, password: null, generated: false, created: true }
  }

  const secret = password || generatedPassword
  const strength = checkPasswordStrength(secret)
  if (!strength.ok) {
    throw new Error(`ADMIN_PASSWORD 不符合要求：${strength.message}`)
  }
  upsertUser(db, user, secret)
  return {
    username: user,
    password: password ? null : secret,
    generated: !password,
    created: true,
  }
}

/** 校验哈希串格式，避免把明文当哈希写进库 */
export function isPasswordHash(value) {
  const parts = String(value ?? '').split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, N, r, p, salt, hash] = parts
  if (![N, r, p].every((n) => /^\d+$/.test(n))) return false
  return /^[A-Za-z0-9+/=]+$/.test(salt) && /^[A-Za-z0-9+/=]+$/.test(hash)
}

export function generatePassword(bytes = 9) {
  return randomBytes(bytes).toString('base64url')
}

export function createSession(db, userId, { userAgent = '', ip = '', ttlMs = DEFAULT_TTL_MS } = {}) {
  const id = randomBytes(32).toString('hex')
  const now = Date.now()
  db.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, userId, now, now + ttlMs, String(userAgent).slice(0, 200), String(ip).slice(0, 60))
  return { id, expiresAt: now + ttlMs }
}

export function getSessionUser(db, sessionId) {
  if (!sessionId) return null
  const row = db
    .prepare(
      `SELECT s.id, s.expires_at, u.id AS user_id, u.username
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(sessionId)
  if (!row) return null
  if (row.expires_at < Date.now()) {
    destroySession(db, sessionId)
    return null
  }
  return { id: row.user_id, username: row.username, sessionId: row.id }
}

export function destroySession(db, sessionId) {
  if (!sessionId) return
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId)
}

export function purgeExpiredSessions(db) {
  return db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()).changes
}

/* ------------------------------ 登录限流 ------------------------------ */

const attempts = new Map()

export function checkRateLimit(key, { max = 8, windowMs = 10 * 60 * 1000 } = {}) {
  const now = Date.now()
  const entry = attempts.get(key)
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 0, resetAt: now + windowMs })
    return { allowed: true, remaining: max }
  }
  if (entry.count >= max) {
    return { allowed: false, retryAfterMs: entry.resetAt - now }
  }
  return { allowed: true, remaining: max - entry.count }
}

export function recordFailure(key) {
  const entry = attempts.get(key)
  if (!entry) {
    attempts.set(key, { count: 1, resetAt: Date.now() + 10 * 60 * 1000 })
    return
  }
  entry.count += 1
}

export function clearFailures(key) {
  attempts.delete(key)
}
