/**
 * 后台端到端自检：在**独立的临时实例**上真点一遍管理后台。
 *
 *   pnpm build && node scripts/e2e-admin.mjs
 *
 * 为什么不用你正在开发的那个后端：这个测试会增删改数据。
 * 它会自己起一个 DATA_DIR 指向临时目录的后端（端口 5191），跑完删掉，
 * 你的 server/data 一动不动。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createChecker, launchPage, sleep } from './lib/browser.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const PORT = Number(process.env.ADMIN_TEST_PORT ?? 5191)
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'E2e-Test-Pass-2026'
const NEW_PASSWORD = 'E2e-New-Pass-2026'

const distDir = join(ROOT, 'dist')
if (!existsSync(join(distDir, 'admin.html'))) {
  console.error('dist/admin.html 不存在。先跑一次 pnpm build（它会同时构建前台和后台）。')
  process.exit(1)
}

const workDir = mkdtempSync(join(tmpdir(), 'songlist-admin-e2e-'))
const dataDir = join(workDir, 'data')
// 截图放固定目录，别跟着临时数据目录一起被删掉，方便事后人工看
const shotDir = join(tmpdir(), 'songlist-e2e-admin')

const { check, summary } = createChecker()

/** 起一个隔离的后端实例（同时提供 dist 里的前台和后台页面） */
const server = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    STATIC_DIR: distDir,
    ADMIN_USER: 'admin',
    ADMIN_PASSWORD: PASSWORD,
    LOG_LEVEL: 'silent',
    BACKUP_KEEP: '10',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverLog = ''
server.stdout.on('data', (chunk) => (serverLog += chunk.toString()))
server.stderr.on('data', (chunk) => (serverLog += chunk.toString()))

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return await response.json()
    } catch {
      /* 还没起来 */
    }
    await sleep(200)
  }
  throw new Error(`后端没起来:\n${serverLog}`)
}

let page
try {
  const health = await waitForServer()
  console.log(`后端已就绪: ${BASE}（${health.songs} 首）\n`)

  page = await launchPage({
    outDir: shotDir,
    port: Number(process.env.ADMIN_CDP_PORT ?? 9339),
    origin: BASE,
    width: 1440,
    height: 940,
  })
  console.log(`浏览器: ${page.browser}\n`)

  /* ---------------- 登录 ---------------- */
  console.log('【登录】')
  await page.goto(`${BASE}/admin`)
  const hasLogin = await page.waitFor('[data-testid=login-username]')
  check('打开 /admin 显示登录界面', hasLogin)
  await page.shot('admin-01-login')

  // 先故意输错，验证错误提示
  await page.fill('[data-testid=login-username]', 'admin')
  await page.fill('[data-testid=login-password]', 'definitely-wrong')
  await page.click('[data-testid=login-submit]')
  await sleep(800)
  const errorText = await page.text('[data-testid=login-error]')
  check('密码错误时给出提示', Boolean(errorText), errorText || '（没有找到错误提示元素）')
  await page.shot('admin-02-login-error')

  await page.fill('[data-testid=login-password]', PASSWORD)
  await page.click('[data-testid=login-submit]')
  const loggedIn = await page.waitFor('[data-testid=nav-songs]', 10000)
  check('用正确密码能登录并进入后台', loggedIn)
  const userText = await page.text('[data-testid=admin-user]')
  check('显示当前登录用户', userText.includes('admin'), userText)
  check(
    '初始密码会被提醒',
    await page.exists('[data-testid=admin-initial-password-warning]'),
    '（该元素不存在时算未通过）',
  )
  await page.shot('admin-03-songs')

  /* ---------------- 曲库：列表 / 搜索 ---------------- */
  console.log('\n【曲库列表】')
  const total0 = await page.text('[data-testid=songs-total]')
  const seedTotal = await page.expr(`fetch('/api/admin/songs?pageSize=1').then((r) => r.json()).then((d) => d.total)`)
  check('列表显示总歌曲数', total0.includes(String(seedTotal)), `${total0}（接口 ${seedTotal}）`)

  await page.fill('[data-testid=songs-search]', 'dukou')
  await sleep(900)
  const rowsAfterSearch = await page.count('[data-testid=song-row]')
  const firstTitle = await page.text('[data-testid=song-row]')
  check(
    '后台搜索支持拼音（dukou → 渡口）',
    rowsAfterSearch === 1 && firstTitle.includes('渡口'),
    `${rowsAfterSearch} 行 / ${firstTitle}`,
  )
  await page.shot('admin-04-search')

  await page.fill('[data-testid=songs-search]', '')
  await sleep(900)
  const rowsRestored = await page.count('[data-testid=song-row]')
  check('清空搜索后恢复列表', rowsRestored > 1, `${rowsRestored} 行`)

  // 行高守卫：操作按钮一旦换行堆叠，每行会被撑到 100px 以上，779 首就没法用了
  const rowMetrics = await page.run(`
    const row = document.querySelector('[data-testid=song-row]')
    if (!row) return null
    const actions = row.querySelector('.adm-cell-actions')
    return {
      rowHeight: Math.round(row.getBoundingClientRect().height),
      actionsHeight: actions ? Math.round(actions.getBoundingClientRect().height) : 0,
      visibleRows: Math.floor(window.innerHeight / Math.max(1, row.getBoundingClientRect().height)),
      cellHeights: [...row.children].map((td) => Math.round(td.getBoundingClientRect().height)),
      innerHeights: [...row.children].map((td) =>
        Math.round(Math.max(0, ...[...td.children].map((el) => el.getBoundingClientRect().height))),
      ),
    }
  `)
  check(
    '表格行高正常（操作按钮没有换行堆叠）',
    rowMetrics && rowMetrics.rowHeight <= 60 && rowMetrics.actionsHeight <= 44,
    JSON.stringify(rowMetrics),
  )
  check('一屏至少能看到 10 行', (rowMetrics?.visibleRows ?? 0) >= 10, `约 ${rowMetrics?.visibleRows} 行`)

  /* ---------------- 每页条数下拉（自定义组件，不是原生 select） ---------------- */
  console.log('\n【每页条数下拉】')
  await page.click('[data-testid=page-size]')
  await sleep(400)
  const sizePanel = await page.run(`
    const panel = document.querySelector('.adm-dropdown-panel')
    if (!panel) return null
    const cs = getComputedStyle(panel)
    return {
      options: [...panel.querySelectorAll('.adm-dropdown-item')].map((el) => el.textContent.trim()),
      background: cs.backgroundColor,
      nativeSelects: document.querySelectorAll('select').length,
    }
  `)
  check(
    '下拉是自定义弹出层（4 个选项）',
    Boolean(sizePanel) && sizePanel.options.length === 4,
    JSON.stringify(sizePanel?.options),
  )
  check(
    '弹出层底色跟着深色主题走（不是系统白底菜单）',
    Boolean(sizePanel) && !/255,\s*255,\s*255/.test(sizePanel.background),
    `背景 ${sizePanel?.background}`,
  )
  check('页面里已经没有原生 select 了', sizePanel?.nativeSelects === 0, `${sizePanel?.nativeSelects} 个`)
  await page.shot('admin-05d-pagesize-dropdown')

  await page.clickByText('.adm-dropdown-item', '每页 100 条')
  await sleep(1400)
  const rowsAt100 = await page.count('[data-testid=song-row]')
  check('切到「每页 100 条」后按上限显示', rowsAt100 === Math.min(100, seedTotal), `${rowsAt100} 行（总数 ${seedTotal}）`)
  await page.click('[data-testid=page-size]')
  await sleep(300)
  await page.clickByText('.adm-dropdown-item', '每页 50 条')
  await sleep(1200)
  const rowsAt50 = await page.count('[data-testid=song-row]')
  check('再切回「每页 50 条」也生效', rowsAt50 === Math.min(50, seedTotal), `${rowsAt50} 行（总数 ${seedTotal}）`)

  /* ---------------- 拖拽排序 ---------------- */
  console.log('\n【拖拽排序】')
  const orderBefore = await page.expr(
    `fetch('/api/admin/songs?pageSize=3&sort=position').then(r => r.json()).then(d => d.items.map(s => s.title))`,
  )
  // 合成 HTML5 拖拽事件：把第 1 行拖到第 3 行下方，验证它真的调了 reorder 接口
  const dragDispatched = await page.run(`
    const rows = [...document.querySelectorAll('[data-testid=song-row]')]
    if (rows.length < 3) return false
    const from = rows[0]
    const to = rows[2]
    const rect = to.getBoundingClientRect()
    from.dispatchEvent(new DragEvent('dragstart', { bubbles: true }))
    to.dispatchEvent(new DragEvent('dragover', {
      bubbles: true, cancelable: true,
      clientY: rect.top + rect.height - 2,
    }))
    to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true }))
    from.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
    return true
  `)
  await sleep(2600)
  const orderAfter = await page.expr(
    `fetch('/api/admin/songs?pageSize=3&sort=position').then(r => r.json()).then(d => d.items.map(s => s.title))`,
  )
  check(
    '拖拽后后端顺序确实变了（第 1 行落到第 3 位）',
    dragDispatched &&
      orderAfter[0] === orderBefore[1] &&
      orderAfter[2] === orderBefore[0],
    `${orderBefore.join(' / ')}  →  ${orderAfter.join(' / ')}`,
  )
  await page.shot('admin-05b-drag-sort')

  /* ---------------- 批量置顶 ---------------- */
  console.log('\n【批量置顶】')
  const fifthTitle = await page.expr(
    `fetch('/api/admin/songs?pageSize=5&sort=position').then(r => r.json()).then(d => d.items[4].title)`,
  )
  await page.clickNth('[data-testid=song-select]', 4)
  await sleep(300)
  const pinClicked = await page.clickByText('.adm-button', '置顶')
  await sleep(1800)
  const firstNow = await page.expr(
    `fetch('/api/admin/songs?pageSize=1&sort=position').then(r => r.json()).then(d => d.items[0].title)`,
  )
  check(
    '置顶把第 5 首移到了第一位',
    pinClicked && firstNow === fifthTitle,
    `${fifthTitle} → 首位 ${firstNow}`,
  )
  await page.shot('admin-05c-pin')

  /* ---------------- 新增 / 编辑 / 删除 ---------------- */
  console.log('\n【增删改】')
  const created = '端到端测试曲目'
  await page.click('[data-testid=song-new]')
  const formOpen = await page.waitFor('[data-testid=song-form-title]', 6000)
  check('新增表单能打开', formOpen)
  await page.fill('[data-testid=song-form-title]', created)
  await page.fill('[data-testid=song-form-singer]', 'E2E歌手')
  const langFilled = await page.exists('[data-testid=song-form-language]')
  if (langFilled) await page.fill('[data-testid=song-form-language]', '中文')
  const genreFilled = await page.exists('[data-testid=song-form-genre]')
  if (genreFilled) await page.fill('[data-testid=song-form-genre]', '流行')
  await page.shot('admin-05-song-form')
  await page.click('[data-testid=song-form-save]')
  await sleep(1500)

  const afterCreate = await page.expr(
    `fetch('/api/admin/songs?q=端到端测试曲目').then(r => r.json()).then(d => d.total)`,
  )
  check('新增的歌曲真的写进库了', afterCreate === 1, `接口返回 ${afterCreate} 条`)

  // 编辑
  await page.fill('[data-testid=songs-search]', '端到端测试曲目')
  await sleep(900)
  const rowCount = await page.count('[data-testid=song-row]')
  if (rowCount > 0) {
    await page.clickNth('[data-testid=song-edit]', 0)
    await page.waitFor('[data-testid=song-form-title]', 6000)
    await page.fill('[data-testid=song-form-title]', `${created}改`)
    await page.click('[data-testid=song-form-save]')
    await sleep(1400)
  }
  const afterEdit = await page.expr(
    `fetch('/api/admin/songs?q=端到端测试曲目改').then(r => r.json()).then(d => d.total)`,
  )
  check('编辑保存生效', afterEdit === 1, `接口返回 ${afterEdit} 条`)

  // 删除（走二次确认）
  await page.fill('[data-testid=songs-search]', '端到端测试曲目改')
  await sleep(900)
  await page.clickNth('[data-testid=song-delete]', 0)
  const confirmAppeared = await page.waitFor('[data-testid=confirm-dialog]', 6000)
  check('删除会弹二次确认', confirmAppeared)
  await page.click('[data-testid=confirm-yes]')
  await sleep(1400)
  const afterDelete = await page.expr(
    `fetch('/api/admin/songs?q=端到端测试曲目改').then(r => r.json()).then(d => d.total)`,
  )
  check('确认后真的删掉了', afterDelete === 0, `接口返回 ${afterDelete} 条`)
  await page.fill('[data-testid=songs-search]', '')
  await sleep(800)

  /* ---------------- 批量导入 ---------------- */
  console.log('\n【批量导入】')
  await page.click('[data-testid=nav-import]')
  const importReady = await page.waitFor('[data-testid=import-textarea]', 6000)
  check('批量导入页能打开', importReady)

  const pasteText = [
    'E2E测试主播',
    'https://live.bilibili.com/1',
    '新\t歌名(单击复制)\t歌手\t语种\t曲风\t需要SC\t备注',
    '\t端到端导入A\t歌手A\t中文\t流行\t\t',
    '\t端到端导入B\t歌手B\t日语\tアニメ\t水晶球\t付费曲',
  ].join('\n')

  await page.fill('[data-testid=import-textarea]', pasteText)
  // 这个页面是「粘贴 → 点解析预览」，不是自动解析
  await page.click('[data-testid=import-parse]')
  await sleep(800)
  const preview = await page.text('.adm-import-summary')
  check(
    '粘贴后能解析出预览（识别到 2 首待导入）',
    preview.includes('2') && preview.includes('将新增'),
    preview || '（没有预览区域）',
  )
  await page.shot('admin-06-import')

  await page.click('[data-testid=import-mode-append]')
  await page.click('[data-testid=import-submit]')
  await sleep(2000)
  const importResult = await page.text('[data-testid=import-result]')
  const imported = await page.expr(
    `fetch('/api/admin/songs?q=端到端导入').then(r => r.json()).then(d => d.total)`,
  )
  check('导入结果有反馈', Boolean(importResult), importResult.slice(0, 100))
  check('两首导入的歌进库了', imported === 2, `接口返回 ${imported} 条`)

  // 回归：备注必须跟着导入一起落库（前台靠它显示「付费曲」礼物图标）
  const importedNote = await page.expr(
    `fetch('/api/admin/songs?q=端到端导入B').then(r => r.json()).then(d => d.items[0]?.note ?? '')`,
  )
  check('导入时备注（付费曲）没有丢', importedNote === '付费曲', `note=${JSON.stringify(importedNote)}`)
  await page.shot('admin-07-import-result')

  /* ---------------- 多选批量删除 ---------------- */
  console.log('\n【批量操作】')
  await page.click('[data-testid=nav-songs]')
  await page.waitFor('[data-testid=songs-search]', 6000)
  await page.fill('[data-testid=songs-search]', '端到端导入')
  await sleep(1000)
  const batchRows = await page.count('[data-testid=song-row]')
  check('能筛出刚导入的两首', batchRows === 2, `${batchRows} 行`)

  await page.click('[data-testid=select-all]')
  await sleep(400)
  const selected = await page.count('[data-testid=song-select]:checked')
  check('表头全选能选中当前页', selected >= 2, `${selected} 行被选中`)

  await page.click('[data-testid=bulk-delete]')
  const bulkConfirm = await page.waitFor('[data-testid=confirm-dialog]', 6000)
  check('批量删除也要二次确认', bulkConfirm)
  if (bulkConfirm) {
    await page.click('[data-testid=confirm-yes]')
    await sleep(1800)
    const left = await page.expr(
      `fetch('/api/admin/songs?q=端到端导入').then(r => r.json()).then(d => d.total)`,
    )
    check('批量删除后两首都清掉了', left === 0, `接口返回 ${left} 条`)
  }
  await page.fill('[data-testid=songs-search]', '')
  await sleep(800)

  /* ---------------- 站点设置 ---------------- */
  console.log('\n【站点设置】')
  await page.click('[data-testid=nav-settings]')
  const settingsReady = await page.waitFor('[data-testid=settings-streamer]', 6000)
  check('站点设置页能打开', settingsReady)
  await page.fill('[data-testid=settings-streamer]', 'E2E主播改名')
  await page.click('[data-testid=settings-save]')
  await sleep(1500)
  const metaName = await page.expr(
    `fetch('/api/songs').then(r => r.json()).then(d => d.meta.streamerName)`,
  )
  check('保存后前台接口同步到新主播名', metaName === 'E2E主播改名', String(metaName))
  await page.shot('admin-08-settings')

  /* ---------------- 主播资料 ---------------- */
  console.log('\n【主播资料】')
  const hasProfileNav = await page.exists('[data-testid=nav-profile]')
  check('有主播资料页入口', hasProfileNav)
  if (hasProfileNav) {
    await page.click('[data-testid=nav-profile]')
    const profileReady = await page.waitFor('[data-testid=profile-bio]', 6000)
    check('主播资料页能打开', profileReady)
    if (profileReady) {
      await page.fill('[data-testid=profile-bio]', 'E2E 写入的简介')
      const saveBtn = (await page.exists('[data-testid=profile-save]'))
        ? '[data-testid=profile-save]'
        : '[data-testid=profile-save-btn]'
      await page.click(saveBtn)
      await sleep(1500)
      const bio = await page.expr(`fetch('/api/profile').then(r => r.json()).then(d => d?.bio ?? '')`)
      check('资料保存后能读回', bio === 'E2E 写入的简介', String(bio))
      await page.shot('admin-09-profile')
    }
  }

  /* ---------------- 备份与导出 ---------------- */
  console.log('\n【备份与导出】')
  await page.click('[data-testid=nav-backups]')
  const backupsReady = await page.waitFor('[data-testid=backup-create]', 6000)
  check('备份页能打开', backupsReady)
  const backupsBefore = await page.count('[data-testid=backup-row]')
  await page.click('[data-testid=backup-create]')
  await sleep(1600)
  const backupsAfter = await page.count('[data-testid=backup-row]')
  check('手动备份后列表变长', backupsAfter > backupsBefore, `${backupsBefore} → ${backupsAfter}`)
  check('有导出 list.txt 入口', await page.exists('[data-testid=export-txt]'))
  check('有导出完整 JSON 入口', await page.exists('[data-testid=export-json]'))
  await page.shot('admin-10-backups')

  // 回滚一次，验证破坏性操作真的能用
  if (backupsAfter > 0) {
    await page.clickNth('[data-testid=backup-restore]', 0)
    const restoreConfirm = await page.waitFor('[data-testid=confirm-dialog]', 6000)
    check('回滚会弹二次确认', restoreConfirm)
    if (restoreConfirm) {
      await page.click('[data-testid=confirm-yes]')
      await sleep(2500)
      const songsAfterRestore = await page.expr(
        `fetch('/api/health').then(r => r.json()).then(d => d.songs)`,
      )
      check('回滚后服务仍然正常', Number.isFinite(songsAfterRestore), `${songsAfterRestore} 首`)
    }
  }

  /* ---------------- 改密码 ---------------- */
  console.log('\n【账号安全】')
  await page.click('[data-testid=nav-account]')
  const accountReady = await page.waitFor('[data-testid=password-current]', 6000)
  check('账号安全页能打开', accountReady)

  // 先试一个不一致的确认密码
  await page.fill('[data-testid=password-current]', PASSWORD)
  await page.fill('[data-testid=password-new]', NEW_PASSWORD)
  await page.fill('[data-testid=password-confirm]', `${NEW_PASSWORD}-不一致`)
  await page.click('[data-testid=password-save]')
  await sleep(900)
  const mismatchStayed = await page.exists('[data-testid=password-current]')
  check('两次输入不一致时不会提交', mismatchStayed)

  await page.fill('[data-testid=password-confirm]', NEW_PASSWORD)
  await page.click('[data-testid=password-save]')
  await sleep(1800)
  const newPasswordWorks = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: NEW_PASSWORD }),
  }).then((response) => response.status)
  const oldPasswordFails = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: PASSWORD }),
  }).then((response) => response.status)
  check('改密码后新密码可用', newPasswordWorks === 200, `HTTP ${newPasswordWorks}`)
  check('改密码后旧密码失效', oldPasswordFails === 401, `HTTP ${oldPasswordFails}`)
  await page.shot('admin-11-account')

  /* ---------------- 退出登录 ---------------- */
  console.log('\n【退出登录】')
  await page.click('[data-testid=admin-logout]')
  const backToLogin = await page.waitFor('[data-testid=login-username]', 8000)
  check('退出后回到登录界面', backToLogin)
  const guard = await fetch(`${BASE}/api/admin/songs`).then((response) => response.status)
  check('退出后接口不再放行', guard === 401, `HTTP ${guard}`)

  /* ---------------- 生产形态：由 Node 直接提供前台 ---------------- */
  console.log('\n【生产形态（Node 同时提供前台与后台）】')
  await page.goto(`${BASE}/`)
  const frontTotal = await page.text('.title-row .total')
  // 页脚不再显示「数据来自后台」，改用 data-source 属性判断（不上屏，只给测试看）
  const frontSource = await page.expr(
    `document.querySelector('.side-foot-meta')?.getAttribute('data-source') ?? ''`,
  )
  const frontRows = await page.count('.song-row')
  check('Node 直接提供的前台页面正常渲染', frontTotal.length > 0 && frontRows > 5, `总数 ${frontTotal} / ${frontRows} 行`)
  check('前台走的是后台数据（不是回退静态）', frontSource === 'api', `data-source=${frontSource}`)
  await page.shot('admin-12-frontend-prod')

  const adminRoute = await fetch(`${BASE}/admin`).then((response) => response.status)
  check('/admin 路由可访问', adminRoute === 200, `HTTP ${adminRoute}`)

  // 回归：Node 的 fetch 默认不带 Accept: text/html，
  // 以前会导致 GET / 直接 404（那些没有 Accept 头的客户端全中招）
  const rootNoAccept = await fetch(`${BASE}/`).then((response) => response.status)
  check('根路径不带 Accept 头也返回页面', rootNoAccept === 200, `HTTP ${rootNoAccept}`)

  const spaFallback = await fetch(`${BASE}/some/deep/path`, {
    headers: { accept: 'text/html' },
  }).then((response) => response.status)
  check('前台单页回退可用（浏览器式导航）', spaFallback === 200, `HTTP ${spaFallback}`)
  const spaNoAccept = await fetch(`${BASE}/some/deep/path`).then((response) => response.status)
  check('深层路径不带 Accept 头也能回退', spaNoAccept === 200, `HTTP ${spaNoAccept}`)
  const assetMissing = await fetch(`${BASE}/not-exist.js`).then((response) => response.status)
  check('不存在的静态资源正确返回 404', assetMissing === 404, `HTTP ${assetMissing}`)
} catch (error) {
  console.error('\n测试中断:', error)
  if (serverLog) console.error('--- 后端日志 ---\n' + serverLog)
  process.exitCode = 1
} finally {
  if (page) await page.close()
  server.kill()
  await sleep(300)
  try {
    rmSync(workDir, { recursive: true, force: true })
  } catch {
    /* 忽略 */
  }
}

summary()
