/**
 * 极简 HTTP 工具：路由、JSON 读写、cookie、静态文件。
 * 不引第三方框架，服务器上零安装成本。
 */
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'

/* ------------------------------ cookie ------------------------------ */

export function parseCookies(header = '') {
  const out = {}
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const key = part.slice(0, index).trim()
    if (!key) continue
    out[key] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return out
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`)
  if (options.path) parts.push(`Path=${options.path}`)
  if (options.httpOnly !== false) parts.push('HttpOnly')
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`)
  if (options.secure) parts.push('Secure')
  return parts.join('; ')
}

/* ------------------------------ 请求体 ------------------------------ */

export function readBody(req, { limit = 8 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大'), { statusCode: 413 }))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export async function readJson(req, options) {
  const raw = await readBody(req, options)
  if (!raw.length) return {}
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw Object.assign(new Error('请求体不是合法 JSON'), { statusCode: 400 })
  }
}

/* ------------------------------ 响应 ------------------------------ */

export function sendJson(res, data, status = 200) {
  const body = Buffer.from(JSON.stringify(data), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

export function sendText(res, text, status = 200, type = 'text/plain; charset=utf-8') {
  const body = Buffer.from(text, 'utf8')
  res.writeHead(status, {
    'Content-Type': type,
    'Content-Length': body.length,
  })
  res.end(body)
}

export function sendError(res, status, message) {
  sendJson(res, { error: message, status }, status)
}

/* ------------------------------ 路由 ------------------------------ */

function compile(pattern) {
  const names = []
  const source = pattern
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      names.push(segment.slice(1))
      return '([^/]+)'
    })
    .join('/')
  return { regex: new RegExp(`^${source}/?$`), names }
}

export function createRouter() {
  const routes = []
  const add = (method, pattern, handler) => {
    const { regex, names } = compile(pattern)
    routes.push({ method, regex, names, handler })
  }
  return {
    get: (p, h) => add('GET', p, h),
    post: (p, h) => add('POST', p, h),
    put: (p, h) => add('PUT', p, h),
    delete: (p, h) => add('DELETE', p, h),
    match(method, pathname) {
      for (const route of routes) {
        if (route.method !== method) continue
        const match = route.regex.exec(pathname)
        if (!match) continue
        const params = {}
        route.names.forEach((name, index) => {
          params[name] = decodeURIComponent(match[index + 1])
        })
        return { handler: route.handler, params }
      }
      return null
    },
  }
}

/* ------------------------------ 静态文件 ------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  // 背景视频：不给正确的 Content-Type，浏览器会把 <video> 当成不支持而拒绝播放
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.pdf': 'application/pdf',
}

export function mimeOf(path) {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/** 把 URL 路径安全地解析到 root 下，防目录穿越 */
export function safeJoin(root, urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0])
  const target = resolve(join(root, normalize(decoded).replace(/^([/\\])+/, '')))
  const rootResolved = resolve(root)
  if (target !== rootResolved && !target.startsWith(rootResolved + sep)) return null
  return target
}

export function serveFile(req, res, filePath, { download = null } = {}) {
  let stat
  try {
    stat = statSync(filePath)
  } catch {
    return false
  }
  if (!stat.isFile()) return false
  const headers = {
    'Content-Type': mimeOf(filePath),
    'Content-Length': stat.size,
    'Last-Modified': stat.mtime.toUTCString(),
  }
  if (download) {
    headers['Content-Disposition'] = `attachment; filename="${download}"; filename*=UTF-8''${encodeURIComponent(download)}`
  }
  // 带 hash 的构建产物可以长缓存，其他文件短缓存
  headers['Cache-Control'] = /-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(filePath)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache'
  res.writeHead(200, headers)
  if (req.method === 'HEAD') {
    res.end()
  } else {
    createReadStream(filePath).pipe(res)
  }
  return true
}
