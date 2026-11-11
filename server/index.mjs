/**
 * 歌单站后端：静态资源 + 公开接口 + 管理接口，一个进程搞定。
 *
 *   node server/index.mjs
 *
 * 环境变量：
 *   PORT / HOST            监听地址（默认 127.0.0.1:5181）
 *   ADMIN_USER/ADMIN_PASSWORD  管理员账号（给了就每次启动同步密码）
 *   DATA_DIR               数据目录（默认 server/data）
 *   STATIC_DIR             前端构建产物目录（默认 dist）
 *   BACKUP_KEEP            保留备份份数（默认 60）
 *   COOKIE_SECURE=1        走 HTTPS 时把 cookie 标记为 Secure
 *   TRUST_PROXY=0          不信任 X-Forwarded-For（默认信任，用于 nginx 反代）
 */
import { createServer } from 'node:http'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  countSongs,
  ensureDir,
  getSettings,
  insertSong,
  nextPosition,
  openDatabase,
  rebuildSearchBlobs,
  saveProfile,
  saveSettings,
} from './lib/db.mjs'
import {
  SESSION_COOKIE,
  ensureAdmin,
  generatePassword,
  getSessionUser,
  passwordUpdatedAt,
} from './lib/auth.mjs'
import { ensureBackupDir, pruneOrphanFiles } from './lib/backup.mjs'
import { writeStaticExports } from './lib/export.mjs'
import { parseCookies, readJson, sendError, sendJson, safeJoin, serveFile } from './lib/http.mjs'
import { parseListTxt } from './lib/importList.mjs'
import { createApi } from './routes.mjs'

/* ------------------------------ 环境检查 ------------------------------ */

const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 5)) {
  console.error(`需要 Node 22.5 及以上（当前 ${process.versions.node}）。推荐 Node 24 LTS。`)
  process.exit(1)
}
try {
  await import('node:sqlite')
} catch {
  console.error(
    '当前 Node 无法加载 node:sqlite。Node 22.x 请用 `node --experimental-sqlite server/index.mjs`，或升级到 Node 24。',
  )
  process.exit(1)
}

/* ------------------------------ 配置 ------------------------------ */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const config = {
  root: ROOT,
  port: Number(process.env.PORT ?? 5181),
  host: process.env.HOST ?? '127.0.0.1',
  dataDir: resolve(process.env.DATA_DIR ?? join(ROOT, 'server', 'data')),
  staticDir: resolve(process.env.STATIC_DIR ?? join(ROOT, 'dist')),
  publicDir: join(ROOT, 'public'),
  cookieSecure: process.env.COOKIE_SECURE === '1',
  trustProxy: process.env.TRUST_PROXY !== '0',
  adminPath: '/admin',
}
config.uploadsDir = join(config.dataDir, 'uploads')
config.backupsDir = join(config.dataDir, 'backups')

ensureDir(config.dataDir)
ensureDir(config.uploadsDir)
ensureBackupDir(config.backupsDir)

const dbPath = join(config.dataDir, 'songlist.db')
const db = openDatabase(dbPath)

/* ------------------------------ 初始化 ------------------------------ */

const bootLines = []

// 首次启动：建管理员账号。已有账号时绝不覆盖密码（避免服务器上长期挂明文密码）
let admin
try {
  admin = ensureAdmin(db, {
    username: process.env.ADMIN_USER,
    password: process.env.ADMIN_PASSWORD,
    passwordHash: process.env.ADMIN_PASSWORD_HASH,
    generatedPassword: generatePassword(),
  })
} catch (error) {
  console.error(`管理员账号初始化失败：${error.message}`)
  process.exit(1)
}
if (admin.created && admin.generated) {
  bootLines.push(`已创建管理员账号：${admin.username} / ${admin.password}`)
  bootLines.push('这是随机密码，只在这里显示一次；请登录后到「账号安全」里改掉。')
  bootLines.push('（密码在数据库里只存 scrypt 哈希，服务器上不会留下明文）')
} else if (admin.created) {
  bootLines.push(`已创建管理员账号：${admin.username}（密码来自环境变量，数据库中只保存哈希）`)
} else {
  const info = passwordUpdatedAt(db, admin.username)
  const changed = info && info.updatedAt > info.createdAt + 1000
  bootLines.push(
    `管理员账号：${admin.username}${changed ? '' : '（当前仍是初始密码，建议尽快修改）'}`,
  )
}

// 数据库为空时，把现有的静态歌单灌进来，保证前台和后台看到的一样
if (countSongs(db) === 0) {
  const listCandidates = [join(config.publicDir, 'list.txt'), join(config.staticDir, 'list.txt')]
  const listFile = listCandidates.find((file) => existsSync(file))
  if (listFile) {
    try {
      const parsed = parseListTxt(readFileSync(listFile, 'utf8'))
      let position = 1
      db.exec('BEGIN')
      for (const song of parsed.songs) {
        insertSong(db, song, position)
        position++
      }
      db.exec('COMMIT')
      if (parsed.meta.streamerName || parsed.meta.liveUrl) {
        saveSettings(db, {
          streamerName: parsed.meta.streamerName || undefined,
          liveUrl: parsed.meta.liveUrl || undefined,
        })
      }
      const profileFile = join(config.publicDir, 'profile.json')
      if (existsSync(profileFile)) {
        try {
          saveProfile(db, JSON.parse(readFileSync(profileFile, 'utf8')))
        } catch {
          /* 静态简介格式有问题就跳过 */
        }
      }
      bootLines.push(`已从 ${listFile.replace(ROOT + '\\', '').replace(ROOT + '/', '')} 导入 ${parsed.songs.length} 首歌`)
    } catch (error) {
      bootLines.push(`导入静态歌单失败：${error.message}`)
    }
  } else {
    bootLines.push('数据库是空的，也没有找到 list.txt，先登录后台添加歌曲吧')
  }
}

const reindexed = rebuildSearchBlobs(db)
if (reindexed) bootLines.push(`已为重排检索的 ${reindexed} 首歌补齐拼音索引`)
writeStaticExports(db, config.staticDir, { silent: true })
pruneOrphanFiles(db, config.backupsDir)

/* ------------------------------ HTTP ------------------------------ */

const api = createApi({ db, config })

function clientIp(req) {
  if (config.trustProxy) {
    const header = req.headers['x-forwarded-for']
    if (header) return String(header).split(',')[0].trim()
  }
  return req.socket.remoteAddress ?? ''
}

function logRequest(req, status, startedAt, extra = '') {
  if (process.env.LOG_LEVEL === 'silent') return
  const ms = Date.now() - startedAt
  console.log(
    `${new Date().toISOString().slice(11, 19)} ${String(status).padEnd(3)} ${req.method.padEnd(6)} ${req.url} ${ms}ms${extra}`,
  )
}

async function handleApi(req, res, url) {
  const startedAt = Date.now()
  const query = Object.fromEntries(url.searchParams)

  const cookies = parseCookies(req.headers.cookie)
  const user = getSessionUser(db, cookies[SESSION_COOKIE])
  const cookiesToSet = []
  const ctx = {
    req,
    res,
    url,
    query,
    params: {},
    // 请求体在路由命中之后再读（见下），这样打错接口的请求不会白读一遍 body
    body: {},
    user,
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] ?? ''),
    setCookie(value) {
      cookiesToSet.push(value)
    },
  }

  const matched = api.match(req.method, url.pathname)
  if (!matched) {
    sendError(res, 404, `没有这个接口：${req.method} ${url.pathname}`)
    logRequest(req, 404, startedAt)
    return
  }
  ctx.params = matched.params

  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const type = String(req.headers['content-type'] ?? '')
      if (type.includes('application/json')) {
        ctx.body = await readJson(req, { limit: 12 * 1024 * 1024 })
      }
    }

    const result = await matched.handler(ctx)
    if (cookiesToSet.length) res.setHeader('Set-Cookie', cookiesToSet)
    if (result !== undefined && !res.writableEnded) sendJson(res, result)
    logRequest(req, res.statusCode, startedAt)
  } catch (error) {
    const status = error?.statusCode ?? 500
    // 4xx 是客户端问题（比如探针发了个非法 JSON），一行提示就够，别刷整段堆栈
    if (status >= 500) console.error('[api] 处理出错:', error)
    else console.warn(`[api] ${status} ${req.method} ${req.url} - ${error?.message ?? error}`)
    if (!res.writableEnded) {
      if (cookiesToSet.length) res.setHeader('Set-Cookie', cookiesToSet)
      sendError(res, status, error?.message ?? '服务器内部错误')
    }
    logRequest(req, status, startedAt, status >= 500 ? ` <- ${error?.message}` : '')
  }
}

function handleStatic(req, res, pathname) {
  const startedAt = Date.now()

  // 上传的图片
  if (pathname.startsWith('/uploads/')) {
    const file = safeJoin(config.uploadsDir, pathname.slice('/uploads'.length))
    if (file && serveFile(req, res, file)) return
    sendError(res, 404, '图片不存在')
    return logRequest(req, 404, startedAt)
  }

  // 后台页面
  if (pathname === config.adminPath || pathname === `${config.adminPath}/`) {
    const adminHtml = join(config.staticDir, 'admin.html')
    if (existsSync(adminHtml) && serveFile(req, res, adminHtml)) return
    sendError(
      res,
      404,
      '还没有构建后台页面。开发时用 http://127.0.0.1:5180/admin.html ，部署时先跑 pnpm build',
    )
    return logRequest(req, 404, startedAt)
  }

  // 构建产物
  if (existsSync(config.staticDir)) {
    const file = safeJoin(config.staticDir, pathname)
    if (file) {
      try {
        const stat = statSync(file)
        if (stat.isFile() && serveFile(req, res, file)) return
        // 目录请求（/ 或 /foo/）要返回它下面的 index.html，
        // 否则 curl、不带 Accept 头的客户端请求 / 会拿到 404
        if (stat.isDirectory()) {
          const index = join(file, 'index.html')
          if (existsSync(index) && serveFile(req, res, index)) return
        }
      } catch {
        /* 路径不存在，继续往下走 SPA 回退 */
      }
    }

    // SPA 回退：无扩展名的路径都交给 index.html（不限制 Accept，
    // curl / 接口调试工具请求深层路径时也该拿到页面）
    if (!extname(pathname)) {
      const index = join(config.staticDir, 'index.html')
      if (serveFile(req, res, index)) return
    }
  }

  sendError(res, 404, '资源不存在（前端还没构建？先跑 pnpm build）')
  logRequest(req, 404, startedAt)
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch((error) => {
      console.error('[api] 未捕获错误:', error)
      if (!res.writableEnded) sendError(res, 500, '服务器内部错误')
    })
    return
  }
  try {
    handleStatic(req, res, url.pathname)
  } catch (error) {
    console.error('[static] 处理出错:', error)
    if (!res.writableEnded) sendError(res, 500, '服务器内部错误')
  }
})

server.listen(config.port, config.host, () => {
  const base = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`
  console.log('')
  console.log('  歌单站后端已启动')
  console.log(`    前台      ${base}/`)
  console.log(`    后台      ${base}${config.adminPath}`)
  console.log(`    健康检查  ${base}/api/health`)
  console.log(`    数据目录  ${config.dataDir}`)
  console.log(`    静态目录  ${existsSync(config.staticDir) ? config.staticDir : config.staticDir + '（还没构建）'}`)
  console.log(`    当前歌曲  ${countSongs(db)} 首`)
  if (bootLines.length) {
    console.log('')
    for (const line of bootLines) console.log(`  · ${line}`)
  }
  console.log('')
})

function shutdown(signal) {
  console.log(`\n收到 ${signal}，正在关闭…`)
  server.close(() => {
    try {
      writeStaticExports(db, config.staticDir, { silent: true })
      db.close()
    } catch {
      /* 忽略 */
    }
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

export { config, db, server }
