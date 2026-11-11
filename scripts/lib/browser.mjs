/**
 * 用 Node 内置 WebSocket 驱动 Chrome DevTools Protocol 的小工具库。
 * e2e 脚本共用：起浏览器、开页面、点元素、截图。
 *
 * 只依赖 Node 22+（内置 fetch / WebSocket），不装 puppeteer。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
]

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function findChrome() {
  const found = CHROME_CANDIDATES.find((path) => existsSync(path))
  if (!found) throw new Error('找不到 Chrome / Edge / Chromium')
  return found
}

export class CdpClient {
  constructor(ws) {
    this.ws = ws
    this.seq = 0
    this.pending = new Map()
    this.listeners = new Set()
    ws.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`))
        else entry.resolve(message.result)
        return
      }
      for (const listener of this.listeners) listener(message)
    })
  }

  send(method, params = {}, sessionId, timeout = 20000) {
    const id = ++this.seq
    const payload = { id, method, params }
    if (sessionId) payload.sessionId = sessionId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP 调用超时（${timeout}ms）: ${method}`))
      }, timeout)
      this.pending.set(id, {
        method,
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      this.ws.send(JSON.stringify(payload))
    })
  }

  once(method, sessionId, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener)
        reject(new Error(`等待事件超时: ${method}`))
      }, timeout)
      const listener = (message) => {
        if (message.method === method && (!sessionId || message.sessionId === sessionId)) {
          clearTimeout(timer)
          this.listeners.delete(listener)
          resolve(message.params)
        }
      }
      this.listeners.add(listener)
    })
  }
}

/**
 * 起一个 headless Chrome 并开一个页面。
 * 返回的 page 对象带常用操作，用完调 close()。
 */
export async function launchPage({
  outDir = join(tmpdir(), 'songlist-e2e'),
  port = 9339,
  width = 1280,
  height = 900,
  origin = null,
} = {}) {
  // Chrome 的 --user-data-dir 必须是绝对路径：
  // 传相对路径时它会按自己的启动目录解析，然后弹「无法创建数据目录」并且调试端口起不来
  outDir = resolve(outDir)
  mkdirSync(outDir, { recursive: true })
  // 每轮都用全新 profile，避免上一轮残留把目录锁住（Windows 上会 EPERM）
  const profileDir = mkdtempSync(join(outDir, 'profile-'))

  const chrome = spawn(
    findChrome(),
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--disable-extensions',
      '--hide-scrollbars',
      // 防止页面被判为「被遮挡/后台」后不再出帧，导致截图一直挂着
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-features=CalculateNativeWinOcclusion,TranslateUI',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  let version = null
  for (let i = 0; i < 60 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    } catch {
      await sleep(250)
    }
  }
  if (!version) throw new Error('Chrome 调试端口没起来')

  const ws = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })

  const cdp = new CdpClient(ws)
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId: session } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })

  await cdp.send('Page.enable', {}, session)
  await cdp.send('Runtime.enable', {}, session)
  if (origin) {
    await cdp.send('Browser.grantPermissions', {
      origin,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    })
  }

  /** 执行一段表达式（不要在这里声明变量，跨调用会冲突） */
  const expr = async (code) => {
    const result = await cdp.send(
      'Runtime.evaluate',
      { expression: code, returnByValue: true, awaitPromise: true },
      session,
    )
    if (result.exceptionDetails) {
      throw new Error(`页面脚本报错: ${result.exceptionDetails.exception?.description ?? '未知'}`)
    }
    return result.result.value
  }

  /** 执行一段带语句的代码（自动包 IIFE，可以自由声明变量，用 return 返回） */
  const run = (body) => expr(`(() => { ${body} })()`)

  const page = {
    cdp,
    session,
    browser: version.Browser,

    expr,
    run,

    async viewport(w = width, h = height, mobile = false) {
      await cdp.send(
        'Emulation.setDeviceMetricsOverride',
        { width: w, height: h, deviceScaleFactor: 1, mobile },
        session,
      )
    },

    async goto(url, { waitMs = 900 } = {}) {
      const loaded = cdp.once('Page.loadEventFired', session)
      await cdp.send('Page.navigate', { url }, session)
      await loaded
      await sleep(waitMs)
    },

    async shot(name) {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' }, session)
      const file = join(outDir, `${name}.png`)
      writeFileSync(file, Buffer.from(data, 'base64'))
      console.log(`  📷 ${file}`)
      return file
    },

    async text(selector) {
      return expr(
        `(document.querySelector(${JSON.stringify(selector)})?.textContent ?? '').replace(/\\s+/g, ' ').trim()`,
      )
    },

    async count(selector) {
      return expr(`document.querySelectorAll(${JSON.stringify(selector)}).length`)
    },

    async exists(selector) {
      return expr(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)
    },

    /** 点一个元素；元素不存在返回 false */
    async click(selector) {
      return run(`
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return false
        el.scrollIntoView({ block: 'center' })
        el.click()
        return true
      `)
    },

    /** 在指定容器内按第 n 个匹配点击（用于表格行内按钮） */
    async clickNth(selector, index) {
      return run(`
        const list = document.querySelectorAll(${JSON.stringify(selector)})
        const el = list[${index}]
        if (!el) return false
        el.scrollIntoView({ block: 'center' })
        el.click()
        return true
      `)
    },

    /** 按文本找按钮并点击（用于没有 testid 的按钮） */
    async clickByText(selector, text) {
      return run(`
        const list = [...document.querySelectorAll(${JSON.stringify(selector)})]
        const el = list.find((node) => (node.textContent ?? '').trim().includes(${JSON.stringify(text)}))
        if (!el) return false
        el.scrollIntoView({ block: 'center' })
        el.click()
        return true
      `)
    },

    /** 填输入框 / textarea，并触发 Vue 的 input 事件 */
    async fill(selector, value) {
      return run(`
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return false
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement
        const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set
        setter.call(el, ${JSON.stringify(value)})
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      `)
    },

    async check(selector, checked = true) {
      return run(`
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) return false
        if (el.checked !== ${checked}) el.click()
        return el.checked
      `)
    },

    /** 等元素出现 */
    async waitFor(selector, timeout = 8000) {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        if (await page.exists(selector)) return true
        await sleep(120)
      }
      return false
    },

    /** 等元素带着文本出现（用于 toast 之类的短时提示） */
    async waitForText(selector, timeout = 8000) {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        const value = await page.text(selector)
        if (value) return value
        await sleep(120)
      }
      return ''
    },

    async waitGone(selector, timeout = 8000) {
      const deadline = Date.now() + timeout
      while (Date.now() < deadline) {
        if (!(await page.exists(selector))) return true
        await sleep(120)
      }
      return false
    },

    async close() {
      try {
        ws.close()
      } catch {
        /* 忽略 */
      }
      chrome.kill()
      await sleep(200)
      try {
        rmSync(profileDir, { recursive: true, force: true })
      } catch {
        /* Windows 上偶尔还占着，忽略 */
      }
    },
  }

  await page.viewport(width, height)
  return page
}

/** 一个用着顺手的结果统计器 */
export function createChecker() {
  const state = { passed: 0, failed: 0, failures: [] }
  const check = (label, ok, extra = '') => {
    if (ok) {
      state.passed++
      console.log(`✓ ${label}${extra ? ` — ${extra}` : ''}`)
    } else {
      state.failed++
      state.failures.push(label)
      console.log(`✗ ${label}${extra ? ` — ${extra}` : ''}`)
    }
    return ok
  }
  const summary = () => {
    console.log(`\n${state.passed}/${state.passed + state.failed} 项通过`)
    if (state.failed) {
      console.log('未通过：' + state.failures.join('、'))
      process.exitCode = 1
    }
    return state.failed === 0
  }
  return { check, summary, state }
}
