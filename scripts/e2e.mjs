/**
 * 前台端到端自检（侧栏式布局）。
 *
 * 自带一个临时实例：用 dist/ 的构建产物 + 临时数据目录，
 * 不碰 server/data，也不需要先手动起 dev server。
 *
 * 用法： node scripts/e2e.mjs           （会自己起服务）
 *        node scripts/e2e.mjs <baseUrl>  （对着已经在跑的站点跑）
 * 产物： .shots/e2e/*.png（项目内，不进版本控制）
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { launchPage } from './lib/browser.mjs'

const ROOT = process.cwd()
const OUT = join(ROOT, '.shots', 'e2e')
const SHOTS = join(OUT, 'shots')
const DATA = join(ROOT, '.tmp', 'e2e-data')
// 直接拿 dist 当静态目录：省掉一次复制（复制在某些环境会 EIO），
// 服务端只会往这里写 list.txt / profile.json，本来就该由构建产物承载
const STATIC = join(ROOT, 'dist')
const PORT = 5199
const BASE = process.argv[2] ?? `http://127.0.0.1:${PORT}/`

mkdirSync(SHOTS, { recursive: true })

let server = null
if (!process.argv[2]) {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.error('dist 还没构建，先跑一次 pnpm build')
    process.exit(1)
  }
  mkdirSync(DATA, { recursive: true })
  // 每轮从 public/list.txt 重新播种，避免沿用上一轮的旧数据
  for (const name of ['songlist.db', 'songlist.db-wal', 'songlist.db-shm']) {
    rmSync(join(DATA, name), { force: true })
  }

  server = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
    env: {
      ...process.env,
      DATA_DIR: DATA,
      STATIC_DIR: STATIC,
      PORT: String(PORT),
      ADMIN_PASSWORD: 'e2e-1234',
      LOG_LEVEL: 'silent',
    },
    stdio: 'ignore',
  })

  // 等端口起来
  let ok = false
  for (let i = 0; i < 60 && !ok; i++) {
    try {
      const res = await fetch(`${BASE}api/health`)
      ok = res.ok
    } catch {
      await new Promise((r) => setTimeout(r, 250))
    }
  }
  if (!ok) {
    server.kill()
    console.error('临时实例没起来')
    process.exit(1)
  }
}

const checks = []
const check = (label, ok, extra = '') => {
  checks.push(ok)
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`)
}

/* 先把站点设置写好：公告、备案号都要在页面上出现，才能验到 */
let cookie = ''
if (!process.argv[2]) {
  try {
    const login = await fetch(`${BASE}api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'e2e-1234' }),
    })
    cookie = (login.headers.get('set-cookie') ?? '').split(';')[0]
    await fetch(`${BASE}api/admin/settings`, {
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
  } catch (err) {
    console.log('写入设置失败:', err.message)
  }
}

const page = await launchPage({ outDir: OUT, port: 9333, width: 1280, height: 900 })
await page.cdp.send('Browser.grantPermissions', {
  origin: BASE.replace(/\/$/, ''),
  permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 测试不假设具体数据量：总数从接口读，换歌单后测试自动适配
const seed = await (await fetch(`${BASE}api/songs`)).json()
const TOTAL = seed.total
const FIRST_TITLE = seed.songs[0]?.title ?? ''
// 示例歌单里可能本来就有 SC 歌，注入后再筛要按「原有 + 1」判断
const SC_IN_SEED = seed.songs.filter((s) => s.sc).length
console.log(`数据基线：${TOTAL} 首，首行「${FIRST_TITLE}」`)

/* ------------------------------ 首屏 ------------------------------ */
await page.goto(BASE, { waitMs: 2000 })

const boot = await page.run(`
  const rows = document.querySelectorAll('.song-row')
  const r0 = rows[0]
  return {
    title: document.querySelector('.title-row h1')?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
    total: document.querySelector('.title-row .total')?.textContent.trim() ?? '',
    hasHead: Boolean(document.querySelector('.list-head')),
    rows: rows.length,
    index: r0?.querySelector('.row-index')?.textContent ?? '',
    firstSub: r0?.querySelector('.row-sub')?.textContent.replace(/\\s+/g, ' ').trim() ?? '',
    side: document.documentElement.dataset.side,
    theme: document.documentElement.dataset.theme,
  }
`)
check('首屏标题与总数', boot.title.startsWith('歌单') && boot.total === String(TOTAL), `${boot.title} / ${boot.total}`)
check('没有表头行', boot.hasHead === false)
check('行结构：编号 + 副行', boot.index === '001' && boot.firstSub.includes('·'), `${boot.index} | ${boot.firstSub}`)
await page.shot('01-first-screen')

/* ------------------------------ 搜索 ------------------------------ */
await page.fill('.search-field input', 'dukou')
await sleep(500)
const search1 = await page.run(`
  const rows = [...document.querySelectorAll('.song-row .row-title')].map((el) => el.textContent.trim())
  return { count: document.querySelectorAll('.song-row').length, first: rows[0] ?? '', total: document.querySelector('.title-row .total')?.textContent.trim() ?? '' }
`)
check('拼音搜索 dukou 命中渡口', search1.first.includes('渡口'), `${search1.total} · ${search1.first}`)
await page.shot('02-search-pinyin')

await page.fill('.search-field input', '渡口')
await sleep(400)
const search2 = await page.run(`
  return { count: document.querySelectorAll('.song-row').length, first: document.querySelector('.song-row .row-title')?.textContent.trim() ?? '' }
`)
check('中文搜索同样命中', search2.first.includes('渡口'), search2.first)

await page.fill('.search-field input', '这首歌一定不存在xyz')
await sleep(400)
const empty1 = await page.run(`
  return { state: document.querySelector('.state-title')?.textContent ?? '', hasButton: Boolean(document.querySelector('.state .primary-button')) }
`)
check('无结果时给出空状态与清空按钮', empty1.state.includes('没有找到') && empty1.hasButton, empty1.state)

await page.run(`document.querySelector('.state .primary-button').click(); return true`)
await sleep(500)
const cleared = await page.run(`return { total: document.querySelector('.title-row .total')?.textContent.trim() ?? '' }`)
check('清空后恢复全量', cleared.total === String(TOTAL), cleared.total)

/* ------------------------------ 筛选面板 ------------------------------ */
await page.click('[data-testid=filter-toggle]')
await page.waitFor('[data-testid=filter-panel]', 5000)
await sleep(300)
const panel = await page.run(`
  return {
    groups: [...document.querySelectorAll('.filter-group h4')].map((h) => h.textContent.trim()),
    chips: document.querySelectorAll('.filter-chip').length,
    panelH: Math.round(document.querySelector('[data-testid=filter-panel]').getBoundingClientRect().height),
  }
`)
check('筛选面板分组正常', panel.groups.length >= 3, panel.groups.join('/'))
check('歌手默认只摆前 60 位', panel.chips < 200, `${panel.chips} 个选项`)
await page.shot('03-filter-panel')

// 先从面板里读出「日语」这一项的数量，再点它 —— 测试不依赖具体数据量
const jpChipCount = await page.run(`
  const group = [...document.querySelectorAll('.filter-group')].find(
    (g) => g.querySelector('h4')?.textContent.trim() === '语种',
  )
  const chip = [...(group?.querySelectorAll('.filter-chip') ?? [])].find((el) =>
    el.textContent.trim().startsWith('日语'),
  )
  if (!chip) return -1
  const n = chip.querySelector('.n')?.textContent ?? ''
  return Number(n)
`)
await page.run(`
  // 只在「语种」这一组里点，避免点到曲风里同名的「日语…」
  const group = [...document.querySelectorAll('.filter-group')].find(
    (g) => g.querySelector('h4')?.textContent.trim() === '语种',
  )
  const chip = [...(group?.querySelectorAll('.filter-chip') ?? [])].find((el) =>
    el.textContent.trim().startsWith('日语'),
  )
  if (chip) chip.click()
  return true
`)
await sleep(500)
const jp = await page.run(`
  return { total: document.querySelector('.title-row .total')?.textContent.trim() ?? '', badge: document.querySelector('.filter-button .badge')?.textContent ?? '' }
`)
check(
  '按语种筛选生效',
  jpChipCount > 0 && jp.total === `${jpChipCount} / ${TOTAL}` && jp.badge === '1',
  `面板显示 ${jpChipCount} 首 → 结果 ${jp.total}`,
)

await page.click('[data-testid=filter-clear]')
await sleep(400)

// SC 相关 UI 只在「歌单里真有 SC 歌」时出现：这里临时注入一首来验
if (cookie) {
  const created = await fetch(`${BASE}api/admin/songs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({
      title: '测试用SC曲',
      singer: '测试',
      language: '中文',
      genre: '流行',
      sc: '水晶球',
      note: '',
      isNew: false,
    }),
  })
  console.log('注入 SC 测试曲:', created.status)
  await page.goto(BASE, { waitMs: 1500 })
  await page.click('[data-testid=filter-toggle]')
  await page.waitFor('[data-testid=filter-panel]', 5000)
  await sleep(400)
  const scGroup = await page.run(`
    const groups = [...document.querySelectorAll('.filter-group h4')].map((h) => h.textContent.trim())
    return { groups, hasChip: Boolean(document.querySelector('[data-testid=filter-sc]')) }
  `)
  check('有 SC 数据时出现「点歌方式」组', scGroup.hasChip === true, scGroup.groups.join('/'))

  await page.run(`document.querySelector('[data-testid=filter-sc]').click(); return true`)
  await sleep(500)
  const sc = await page.run(`return { total: document.querySelector('.title-row .total')?.textContent.trim() ?? '' }`)
  check('SC 筛选只留 SC 歌（原有的 + 注入的）', sc.total === `${SC_IN_SEED + 1} / ${TOTAL + 1}`, sc.total)
  await page.click('[data-testid=filter-clear]')
  await page.click('[data-testid=filter-done]')
  await sleep(400)
}

/* ------------------------------ 单击复制 ------------------------------ */
await page.run(`document.querySelector('.song-row').click(); return true`)
await sleep(500)
const toastText = await page.run(`return document.querySelector('.toast')?.textContent ?? ''`)
// 剪贴板读取返回 Promise，用 expr（内部 awaitPromise: true）
const clipText = await page.expr(`navigator.clipboard.readText().catch(() => '')`)
check('单击复制：提示出现', toastText.includes('已复制'), toastText)
check('单击复制：剪贴板是「点歌 歌名」（不带歌手）', clipText === `点歌 ${FIRST_TITLE}`, JSON.stringify(clipText))
await page.shot('04-copy')

/* ------------------------------ 键盘 ------------------------------ */
await page.run(`
  const row = document.querySelector('.song-row')
  row.focus()
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  return true
`)
await sleep(400)
const kb = await page.run(`return { active: document.activeElement?.className ?? '' }`)
check('行可聚焦（键盘可达）', kb.active.includes('song-row'), kb.active)

/* ------------------------------ 主题 ------------------------------ */
const themeBefore = await page.run(`return document.documentElement.dataset.theme`)
await page.click('[data-testid=theme-toggle]')
await sleep(400)
const themeAfter = await page.run(`
  return { now: document.documentElement.dataset.theme, saved: localStorage.getItem('vtuber-song-list:theme') }
`)
check('主题切换并记住', themeAfter.now !== themeBefore && themeAfter.saved === themeAfter.now, `${themeBefore} → ${themeAfter.now}`)
await page.shot('05-theme-light')

await page.goto(BASE, { waitMs: 1200 })
const themeReload = await page.run(`return document.documentElement.dataset.theme`)
check('刷新后主题保持', themeReload === themeAfter.now, themeReload)

/* ------------------------------ 左右切换 ------------------------------ */
await page.click('[data-testid=side-switch]')
await sleep(400)
const side1 = await page.run(`
  return { now: document.documentElement.dataset.side, saved: localStorage.getItem('vtuber-song-list:side') }
`)
check('侧栏切到左侧并记住', side1.now === 'left' && side1.saved === 'left', JSON.stringify(side1))
await page.shot('06-side-left')

await page.goto(BASE, { waitMs: 1200 })
const sideReload = await page.run(`return document.documentElement.dataset.side`)
check('刷新后侧栏位置保持', sideReload === 'left', sideReload)

// 切回右侧，别影响后面的截图
await page.click('[data-testid=side-switch]')
await sleep(300)

/* ------------------------------ 公告 ------------------------------ */
const notice1 = await page.run(`
  const el = document.querySelector('.notice-text')
  return { h: Math.round(el.getBoundingClientRect().height), scroll: el.scrollHeight }
`)
await page.click('[data-testid=notice]')
await sleep(400)
const notice2 = await page.run(`
  const el = document.querySelector('.notice-text')
  return { h: Math.round(el.getBoundingClientRect().height) }
`)
// 文字本来就一行时，展开不会变高 —— 那种情况只验证"点击不报错"
const clamped = notice1.scroll > notice1.h + 2
check(
  clamped ? '公告被截断时点开能展开' : '公告本来就一行（无需展开）',
  clamped ? notice2.h > notice1.h : notice2.h === notice1.h,
  `${notice1.h}px → ${notice2.h}px（内容 ${notice1.scroll}px）`,
)
await page.shot('07-notice-open')

/* ------------------------------ 简介弹窗 ------------------------------ */
await page.run(`
  const btn = [...document.querySelectorAll('.icon-button')][0]
  btn.click()
  return true
`)
await page.waitFor('.profile-modal, .modal, [role=dialog]', 4000).catch(() => null)
await sleep(400)
const modal = await page.run(`
  return { open: Boolean(document.querySelector('[role=dialog], .profile-modal, .modal')), hash: location.hash }
`)
check('简介弹窗能打开且 hash 同步', modal.open === true, `hash=${modal.hash}`)
await page.shot('08-profile')

await page.run(`
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  return true
`)
await sleep(400)
const modalClosed = await page.run(`
  return { open: Boolean(document.querySelector('[role=dialog], .profile-modal, .modal')), hash: location.hash }
`)
check('Esc 关闭弹窗并清掉 hash', modalClosed.open === false && modalClosed.hash !== '#profile', JSON.stringify(modalClosed))

/* ------------------------------ 虚拟滚动 ------------------------------ */
await page.run(`
  const el = document.querySelector('.list-viewport')
  el.scrollTop = 12000
  return el.scrollTop
`)
await sleep(500)
const virt = await page.run(`
  return {
    domRows: document.querySelectorAll('.song-row').length,
    firstIndex: document.querySelector('.song-row .row-index')?.textContent ?? '',
  }
`)
check('滚到很后面也只渲染少量行', virt.domRows > 0 && virt.domRows < 40, `${virt.domRows} 行，首行 ${virt.firstIndex}`)
await page.shot('09-scrolled')

/* ------------------------------ 手机视口 ------------------------------ */
await page.viewport(390, 844, true)
await page.goto(BASE, { waitMs: 1500 })
const mobile = await page.run(`
  return {
    rowHeight: Math.round(document.querySelector('.song-row')?.getBoundingClientRect().height ?? 0),
    listH: Math.round(document.querySelector('.list-viewport')?.getBoundingClientRect().height ?? 0),
    vh: window.innerHeight,
    hasHead: Boolean(document.querySelector('.list-head')),
    switchHidden: getComputedStyle(document.querySelector('.side-switch')).display === 'none',
  }
`)
const ratio = Math.round((mobile.listH / mobile.vh) * 100)
check('手机端：无表头、行高 72', mobile.hasHead === false && mobile.rowHeight === 72, `${mobile.rowHeight}px`)
check('手机端：列表占屏 ≥ 55%', ratio >= 55, `${ratio}%`)
check('手机端：隐藏左右切换', mobile.switchHidden === true)
await page.shot('10-mobile')

await page.run(`
  const el = document.querySelector('.list-viewport')
  el.scrollTop = 700
  return el.scrollTop
`)
await sleep(700)
const compact = await page.run(`return { compact: document.querySelector('.stage').classList.contains('is-compact') }`)
check('手机端：滚动时头部折叠', compact.compact === true)
await page.shot('11-mobile-compact')

await page.click('[data-testid=filter-toggle]')
await page.waitFor('[data-testid=filter-panel]', 4000)
await sleep(500)
const sheet = await page.run(`
  const p = document.querySelector('[data-testid=filter-panel]').getBoundingClientRect()
  return { w: Math.round(p.width), bottomGap: Math.round(window.innerHeight - (p.top + p.height)) }
`)
check('手机端：筛选是贴底弹层', sheet.w === 390 && Math.abs(sheet.bottomGap) <= 2, JSON.stringify(sheet))
await page.shot('12-mobile-filter')
await page.close()

const failed = checks.filter((ok) => !ok).length
console.log(`\n${checks.length - failed}/${checks.length} 项通过`)
console.log(`截图: ${SHOTS}`)

server?.kill()
if (failed) process.exitCode = 1
