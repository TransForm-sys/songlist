/**
 * 侧栏布局的视觉验收：自带临时实例（dist + 新鲜数据），跑完留截图在 .shots/。
 * 用法： node scripts/layout-shots.mjs
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { launchPage } from './lib/browser.mjs'

const ROOT = process.cwd()
const PORT = 5197
const BASE = `http://127.0.0.1:${PORT}`
const OUT = join(ROOT, '.shots')
const DATA = join(ROOT, '.tmp', 'layout-data')
const STATIC = join(ROOT, 'dist')

if (!existsSync(join(STATIC, 'index.html'))) {
  console.error('dist 还没构建，先跑一次 pnpm build')
  process.exit(1)
}
mkdirSync(OUT, { recursive: true })
mkdirSync(DATA, { recursive: true })
for (const name of ['songlist.db', 'songlist.db-wal', 'songlist.db-shm']) {
  rmSync(join(DATA, name), { force: true })
}

const server = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
  env: {
    ...process.env,
    DATA_DIR: DATA,
    STATIC_DIR: STATIC,
    PORT: String(PORT),
    ADMIN_PASSWORD: 'shot-1234',
    LOG_LEVEL: 'silent',
  },
  stdio: 'ignore',
})

let up = false
for (let i = 0; i < 60 && !up; i++) {
  try {
    up = (await fetch(`${BASE}/api/health`)).ok
  } catch {
    await new Promise((r) => setTimeout(r, 250))
  }
}
if (!up) {
  server.kill()
  console.error('临时实例没起来')
  process.exit(1)
}

let loginStatus = 0
let putStatus = 0
try {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'shot-1234' }),
  })
  loginStatus = login.status
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
  const put = await fetch(`${BASE}/api/admin/settings`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      streamerName: '临小渺',
      liveUrl: 'https://live.bilibili.com/123456',
      icp: '京ICP备0000000号-1',
      police: '京公网安备00000000000000号',
      notice: '会唱一点歌，配一点音，一点点游戏（fps除外）',
    }),
  })
  putStatus = put.status
} catch (err) {
  console.log('设置写入失败:', err.message)
}
console.log(`登录=${loginStatus} 写设置=${putStatus}`)

const checks = []
const check = (label, ok, extra = '') => {
  checks.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`)
}

/* ---------------- 桌面 ---------------- */
const desk = await launchPage({ outDir: OUT, port: 9351, width: 1440, height: 960 })
// headless 默认没有剪贴板权限，不授的话「随机一首」会走到「复制失败」分支
await desk.cdp.send('Browser.grantPermissions', {
  origin: BASE,
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
})
await desk.goto(`${BASE}/`, { waitMs: 2200 })

const d1 = await desk.run(`
  const rows = document.querySelectorAll('.song-row')
  const r0 = rows[0]
  const bg = document.querySelector('.stage-bg')
  return {
    side: document.documentElement.dataset.side,
    rows: rows.length,
    hasHead: Boolean(document.querySelector('.list-head')),
    rowHeight: r0 ? Math.round(r0.getBoundingClientRect().height) : 0,
    firstTitle: r0 ? r0.querySelector('.row-title').textContent.trim().slice(0, 10) : '',
    firstSub: r0 ? r0.querySelector('.row-sub').textContent.replace(/\\s+/g, ' ').trim() : '',
    firstIndex: r0 ? r0.querySelector('.row-index').textContent : '',
    footerLines: (() => {
      const el = document.querySelector('.side-foot-meta')
      if (!el) return 0
      const cs = getComputedStyle(el)
      return Math.round(el.getBoundingClientRect().height / parseFloat(cs.lineHeight || '16'))
    })(),
    footer: document.querySelector('.side-foot-meta')?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
    policeHref: document.querySelector('.side-foot-meta a[href*="mps"]')?.getAttribute('href') ?? '',
    sideWidth: Math.round(document.querySelector('.side')?.getBoundingClientRect().width ?? 0),
    blurLayer: Boolean(document.querySelector('.stage-blur')),
    beianIcon: Boolean(document.querySelector('.beian-link img')),
    paidIcons: document.querySelectorAll('.song-row .row-paid').length,
    riskyWords: ['付费', '礼物', '打赏', '价格', '购买'].filter((w) => document.body.innerText.includes(w)),
  }
`)

check('侧栏默认在右', d1.side === 'right', d1.side)
check('列表没有表头', d1.hasHead === false)
check('行高 ≈ 76px', Math.abs(d1.rowHeight - 76) <= 2, `${d1.rowHeight}px`)
check(
  '行结构：编号 + 歌名 + 副行',
  Boolean(d1.firstIndex && d1.firstTitle && d1.firstSub),
  `${d1.firstIndex} | ${d1.firstTitle} | ${d1.firstSub}`,
)
check('页脚备案号单行显示', d1.footerLines <= 1, `${d1.footerLines} 行`)
check('页脚含公安备案号', d1.footer.includes('京公网安备00000000000000号'), d1.footer)
check('备案号前面有官方图标', d1.beianIcon === true, `图标=${d1.beianIcon}`)
check(
  '备案链接用官方 webSearch 路径',
  d1.policeHref.includes('#/query/webSearch?code=00000000000000'),
  d1.policeHref,
)
check('桌面侧栏宽 520px', Math.abs(d1.sideWidth - 520) <= 2, `${d1.sideWidth}px`)
const profile = await (await fetch(`${BASE}/api/profile`)).json().catch(() => null)
const hasAvatar = Boolean(profile?.avatar)
check(
  '模糊底图只在「无背景图 + 有头像」时出现',
  d1.blurLayer === hasAvatar,
  `头像=${hasAvatar} 模糊层=${d1.blurLayer}`,
)
check('有额外要求的曲目带礼物图标', d1.paidIcons > 0, `${d1.paidIcons} 个（当前视口内）`)
check(
  '页面上不出现「付费/礼物/打赏」等字眼',
  d1.riskyWords.length === 0,
  d1.riskyWords.length ? d1.riskyWords.join('/') : '干净',
)
await desk.shot('01-desktop-right')

await desk.click('[data-testid=side-switch]')
await new Promise((r) => setTimeout(r, 600))
const d2 = await desk.run(`return { side: document.documentElement.dataset.side }`)
check('点箭头切到左侧', d2.side === 'left', d2.side)
await desk.shot('02-desktop-left')

await desk.click('[data-testid=filter-toggle]')
await desk.waitFor('[data-testid=filter-panel]', 4000)
await new Promise((r) => setTimeout(r, 500))
const d3 = await desk.run(`
  return {
    chips: document.querySelectorAll('.filter-chip').length,
    groups: [...document.querySelectorAll('.filter-group h4')].map((h) => h.textContent.trim()),
  }
`)
check('筛选面板可用', d3.chips > 10, `${d3.chips} 个选项：${d3.groups.join('/')}`)
await desk.shot('03-filter-panel')

// 从面板里读「日语」的实际数量，再点它 —— 不依赖具体歌单数据
const jpCount = await desk.run(`
  const group = [...document.querySelectorAll('.filter-group')].find(
    (g) => g.querySelector('h4')?.textContent.trim() === '语种',
  )
  const chip = [...(group?.querySelectorAll('.filter-chip') ?? [])].find((el) =>
    el.textContent.trim().startsWith('日语'),
  )
  if (!chip) return -1
  return Number(chip.querySelector('.n')?.textContent ?? '')
`)
await desk.run(`
  const group = [...document.querySelectorAll('.filter-group')].find(
    (g) => g.querySelector('h4')?.textContent.trim() === '语种',
  )
  const chip = [...(group?.querySelectorAll('.filter-chip') ?? [])].find((el) =>
    el.textContent.trim().startsWith('日语'),
  )
  if (chip) chip.click()
  return true
`)
await new Promise((r) => setTimeout(r, 800))
const d4 = await desk.run(`
  return {
    total: document.querySelector('.title-row .total')?.textContent.trim() ?? '',
    badge: document.querySelector('.filter-button .badge')?.textContent ?? '',
  }
`)
check('筛选生效', jpCount > 0 && d4.total.startsWith(`${jpCount} / `) && d4.badge === '1', `面板 ${jpCount} 首 → ${d4.total}`)
await desk.shot('04-filtered-jp')

// 随机一首：会复制 + 高亮
await desk.click('[data-testid=filter-clear]')
await new Promise((r) => setTimeout(r, 400))
await desk.click('[data-testid=random-pick]')
await new Promise((r) => setTimeout(r, 700))
const d5 = await desk.run(`
  return {
    toast: document.querySelector('.toast')?.textContent ?? '',
    active: document.querySelectorAll('.song-row.is-active').length,
  }
`)
check('随机一首：有高亮行', d5.active === 1, `${d5.active} 行`)
check('随机一首：复制了正确格式', d5.toast.includes('点歌 '), d5.toast)
await desk.shot('05-random')
await desk.close()

/* ---------------- 手机 ---------------- */
const mob = await launchPage({ outDir: OUT, port: 9352, width: 390, height: 844 })
await mob.goto(`${BASE}/`, { waitMs: 2200 })

const m1 = await mob.run(`
  return {
    rowHeight: Math.round(document.querySelector('.song-row')?.getBoundingClientRect().height ?? 0),
    hasHead: Boolean(document.querySelector('.list-head')),
    listH: Math.round(document.querySelector('.list-viewport')?.getBoundingClientRect().height ?? 0),
    viewportH: window.innerHeight,
    switchHidden: getComputedStyle(document.querySelector('.side-switch')).display === 'none',
    noticeLines: (() => {
      const el = document.querySelector('.notice-text')
      if (!el) return 0
      return Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight))
    })(),
    rows: document.querySelectorAll('.song-row').length,
  }
`)
check('手机端行高 ≈ 72px', Math.abs(m1.rowHeight - 72) <= 2, `${m1.rowHeight}px`)
const ratio = Math.round((m1.listH / m1.viewportH) * 100)
check('手机端列表占屏 ≥ 55%', ratio >= 55, `${m1.listH}px / ${m1.viewportH}px = ${ratio}%（可见 ${m1.rows} 行 DOM）`)
check('手机端公告默认折叠成一行', m1.noticeLines <= 1, `${m1.noticeLines} 行`)
check('手机端隐藏切换按钮', m1.switchHidden === true)
await mob.shot('06-mobile-normal')

await mob.run(`
  const el = document.querySelector('.list-viewport')
  el.scrollTop = 900
  return el.scrollTop
`)
await new Promise((r) => setTimeout(r, 900))
const m2 = await mob.run(`
  return {
    compact: document.querySelector('.stage').classList.contains('is-compact'),
    listH: Math.round(document.querySelector('.list-viewport').getBoundingClientRect().height),
  }
`)
check('向下滚动后头部折叠', m2.compact === true, `列表长到 ${m2.listH}px`)
await mob.shot('07-mobile-compact')

await mob.click('[data-testid=filter-toggle]')
await mob.waitFor('[data-testid=filter-panel]', 4000)
await new Promise((r) => setTimeout(r, 600))
const m3 = await mob.run(`
  const p = document.querySelector('.filter-panel').getBoundingClientRect()
  return { top: Math.round(p.top), height: Math.round(p.height), width: Math.round(p.width), vh: window.innerHeight }
`)
check('手机端筛选贴底', m3.width === 390 && m3.top + m3.height >= m3.vh - 6, JSON.stringify(m3))
await mob.shot('08-mobile-filter')
await mob.close()

const failed = checks.filter((ok) => !ok).length
console.log(`\n${checks.length - failed}/${checks.length} 项通过`)
if (failed) process.exitCode = 1
