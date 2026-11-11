/**
 * 接口层自检：用一种隔离的方式把后端整条链路跑一遍。
 *
 *   node scripts/api-test.mjs
 *
 * 会在临时目录起一个独立实例（自己的 DATA_DIR / STATIC_DIR / 端口），
 * 跑完自动清理，不影响 server/data 里的真实数据。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = resolve(import.meta.dirname, '..')
const PORT = Number(process.env.TEST_PORT ?? 5199)
const BASE = `http://127.0.0.1:${PORT}`
const PASSWORD = 'test-password-123'
const ADMIN_USER = 'admin'

const workDir = mkdtempSync(join(tmpdir(), 'songlist-api-'))
const dataDir = join(workDir, 'data')
const staticDir = join(workDir, 'static')
mkdirSync(dataDir, { recursive: true })
mkdirSync(staticDir, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let passed = 0
let failed = 0
const failures = []

function check(label, ok, extra = '') {
  if (ok) {
    passed++
    console.log(`✓ ${label}${extra ? ` — ${extra}` : ''}`)
  } else {
    failed++
    failures.push(label)
    console.log(`✗ ${label}${extra ? ` — ${extra}` : ''}`)
  }
}

let cookie = ''

async function api(method, path, { body, headers = {}, raw = false } = {}) {
  const init = { method, headers: { ...headers } }
  if (cookie) init.headers.cookie = cookie
  if (body !== undefined) {
    if (typeof body === 'string') {
      init.body = body
      init.headers['content-type'] = init.headers['content-type'] ?? 'text/plain; charset=utf-8'
    } else {
      init.body = JSON.stringify(body)
      init.headers['content-type'] = 'application/json'
    }
  }
  const response = await fetch(`${BASE}${path}`, init)
  const setCookie = response.headers.getSetCookie?.() ?? []
  if (setCookie.length) {
    cookie = setCookie.map((value) => value.split(';')[0]).join('; ')
  }
  const text = await response.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return {
    status: response.status,
    json,
    text,
    headers: response.headers,
    raw: raw ? text : undefined,
  }
}

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const response = await fetch(`${BASE}/api/health`)
      if (response.ok) return true
    } catch {
      /* 还没起来 */
    }
    await sleep(200)
  }
  return false
}

const server = spawn(process.execPath, [join(ROOT, 'server', 'index.mjs')], {
  env: {
    ...process.env,
    PORT: String(PORT),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    STATIC_DIR: staticDir,
    ADMIN_USER,
    ADMIN_PASSWORD: PASSWORD,
    LOG_LEVEL: 'silent',
    BACKUP_KEEP: '10',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverLog = ''
server.stdout.on('data', (chunk) => (serverLog += chunk.toString()))
server.stderr.on('data', (chunk) => (serverLog += chunk.toString()))

function cleanup() {
  server.kill()
  try {
    rmSync(workDir, { recursive: true, force: true })
  } catch {
    /* Windows 上偶尔还占着，忽略 */
  }
}

try {
  const up = await waitForServer()
  if (!up) throw new Error(`后端没起来:\n${serverLog}`)
  console.log(`服务已就绪: ${BASE}\n`)

  /* ---------------- 公开接口 ---------------- */
  console.log('【公开接口】')
  const health = await api('GET', '/api/health')
  check('健康检查可用', health.status === 200 && health.json?.ok === true)

  const songs = await api('GET', '/api/songs')
  // 基线从接口读：换歌单后测试不用跟着改数字
  const SEED_TOTAL = songs.json?.total ?? 0
  const SEED_FIRST = songs.json?.songs?.[0]?.title ?? ''
  const SEED_STREAMER = songs.json?.meta?.streamerName ?? ''
  const seedLang = (value) => (songs.json?.songs ?? []).filter((s) => s.language === value).length
  check('首次启动自动从 list.txt 灌入歌曲', SEED_TOTAL > 0, `${SEED_TOTAL} 首`)
  check('歌曲字段完整', Boolean(SEED_FIRST) && 'singer' in (songs.json?.songs?.[0] ?? {}), JSON.stringify(songs.json?.songs?.[0]))
  check('meta 带上了主播信息', Boolean(SEED_STREAMER), SEED_STREAMER)

  const profile = await api('GET', '/api/profile')
  check('静态 profile.json 已被灌入', profile.json?.tags?.length > 0, profile.json?.title)

  /* ---------------- 鉴权 ---------------- */
  console.log('\n【鉴权】')
  const session0 = await api('GET', '/api/auth/session')
  check('未登录时 session 为 false', session0.json?.authed === false)

  const guard = await api('GET', '/api/admin/songs')
  check('未登录访问管理接口被拦截', guard.status === 401, guard.json?.error)

  // 非法 JSON：应该是干净的 400，而不是"未捕获错误 + 整段堆栈"
  const badJson = await api('POST', '/api/auth/login', {
    body: '{这不是合法 JSON',
    headers: { 'content-type': 'application/json' },
  })
  check('非法 JSON 返回 400', badJson.status === 400, badJson.json?.error)

  // 打错接口 + 非法 JSON：应该直接 404，不应该因为解析 body 而报 400
  const wrongRoute = await api('POST', '/api/nope/nope', {
    body: '{也不是合法 JSON',
    headers: { 'content-type': 'application/json' },
  })
  check('不存在的接口直接 404（不读 body）', wrongRoute.status === 404, `HTTP ${wrongRoute.status}`)

  const wrong = await api('POST', '/api/auth/login', { body: { username: ADMIN_USER, password: 'x' } })
  check('密码错误返回 401', wrong.status === 401, wrong.json?.error)

  const login = await api('POST', '/api/auth/login', {
    body: { username: ADMIN_USER, password: PASSWORD },
  })
  check('登录成功并下发 cookie', login.status === 200 && cookie.includes('songlist_session'), cookie)

  const session1 = await api('GET', '/api/auth/session')
  check('session 变为已登录', session1.json?.authed === true, session1.json?.user?.username)

  /* ---------------- 后台列表 / 搜索 / 分面 ---------------- */
  console.log('\n【列表 · 搜索 · 分面】')
  const page1 = await api('GET', '/api/admin/songs?pageSize=10')
  check('分页返回 10 条且总数正确', page1.json?.items?.length === 10 && page1.json?.total === SEED_TOTAL)

  const pinyin = await api('GET', '/api/admin/songs?q=dukou')
  check('后台拼音搜索命中渡口', pinyin.json?.total === 1 && pinyin.json.items[0].title === '渡口', JSON.stringify(pinyin.json?.items?.[0]?.title))

  const initials = await api('GET', '/api/admin/songs?q=dk')
  check('首字母 dk 也能搜', initials.json?.total >= 1, `${initials.json?.total} 条`)

  const facetBefore = page1.json
  check(
    '分面数量正确（语种）',
    facetBefore.facets.language.find((f) => f.value === '日语')?.count === seedLang('日语') &&
      facetBefore.facets.language.find((f) => f.value === '中文')?.count === seedLang('中文'),
    JSON.stringify(facetBefore.facets.language),
  )

  const jp = await api('GET', '/api/admin/songs?language=日语&pageSize=1')
  check('按语种筛选生效', jp.json?.total === seedLang('日语'), `${jp.json?.total} 条（基线 ${seedLang('日语')}）`)
  check(
    '分面统计排除自身维度（选了日语，语种列表仍显示全部）',
    jp.json?.facets?.language?.length === new Set((songs.json?.songs ?? []).map((s) => s.language).filter(Boolean)).size,
    JSON.stringify(jp.json?.facets?.language?.map((f) => `${f.value}:${f.count}`)),
  )

  const SEED_SC = (songs.json?.songs ?? []).filter((s) => s.sc).length
  const scFilter = await api('GET', '/api/admin/songs?sc=1')
  check(
    'SC 筛选命中数 = 歌单里实际带 SC 的数量',
    scFilter.json?.total === SEED_SC,
    `${scFilter.json?.total} 条（基线 ${SEED_SC}）`,
  )

  /* ---------------- 增删改 ---------------- */
  console.log('\n【增删改】')
  const created = await api('POST', '/api/admin/songs', {
    body: { title: '测试歌曲', singer: '测试歌手', language: '中文', genre: '流行', sc: '', note: '接口测试' },
  })
  const newId = created.json?.id
  check('新增歌曲成功', created.status === 200 && Number.isFinite(newId), `id=${newId}`)

  const updated = await api('PUT', `/api/admin/songs/${newId}`, {
    body: { title: '测试歌曲2', sc: '水晶球' },
  })
  check('修改歌曲成功', updated.json?.song?.title === '测试歌曲2')

  const fetched = await api('GET', `/api/admin/songs/${newId}`)
  check('改动已落库', fetched.json?.title === '测试歌曲2' && fetched.json?.sc === '水晶球')

  const searchNew = await api('GET', '/api/admin/songs?q=ceshigequ2')
  check('新增的歌立刻能按全拼搜到', searchNew.json?.total === 1, `ceshigequ2 -> ${searchNew.json?.total} 条`)

  const searchNewInitials = await api('GET', '/api/admin/songs?q=csgq2')
  check('新增的歌也能按首字母搜到', searchNewInitials.json?.total === 1, `csgq2 -> ${searchNewInitials.json?.total} 条`)

  const moveUp = await api('POST', `/api/admin/songs/${newId}/move`, { body: { direction: 'up' } })
  check('上移一格可用', moveUp.json?.ok === true)

  const pinned = await api('POST', '/api/admin/songs/pin', { body: { ids: [newId], mode: 'top' } })
  const afterPin = await api('GET', '/api/admin/songs?pageSize=1')
  check('置顶后排在第一位', pinned.json?.ok === true && afterPin.json?.items?.[0]?.id === newId, `首位=${afterPin.json?.items?.[0]?.title}`)

  /* ---------------- 批量导入 ---------------- */
  console.log('\n【批量导入】')
  const bulk = await api('POST', '/api/admin/songs/bulk', {
    body: {
      mode: 'append',
      items: [
        { title: '批量A', singer: '歌手A', language: '中文', genre: '流行' },
        { title: '批量B', singer: '歌手B', language: '日语', genre: 'アニメ' },
        { title: '批量A', singer: '歌手A', language: '中文', genre: '流行' },
        { title: '渡口', singer: '蔡琴', language: '中文', genre: '中文流行' },
        { title: '', singer: '没有歌名' },
      ],
    },
  })
  check(
    '批量导入去重且统计正确（请求内重复 1 + 与库里重复 1 + 缺歌名 1）',
    bulk.json?.added === 3 && bulk.json?.duplicateCount === 1 && bulk.json?.skipped === 1,
    JSON.stringify(bulk.json),
  )

  // 同名同歌手但字段不同：必须照常导入，只提示疑似重复（不能悄悄吃掉数据）
  const nearDup = await api('POST', '/api/admin/songs/bulk', {
    body: {
      mode: 'append',
      items: [{ title: '渡口', singer: '蔡琴', language: '中文', genre: '民歌' }],
    },
  })
  check(
    '同名同歌手但字段不同 → 照常导入并标记疑似重复',
    nearDup.json?.added === 1 && nearDup.json?.similarCount === 1 && nearDup.json?.duplicateCount === 0,
    JSON.stringify({ added: nearDup.json?.added, similar: nearDup.json?.similarCount, dup: nearDup.json?.duplicateCount }),
  )

  // 整行一致 → 应该被跳过
  const exactDup = await api('POST', '/api/admin/songs/bulk', {
    body: {
      mode: 'append',
      items: [{ title: '渡口', singer: '蔡琴', language: '中文', genre: '民歌' }],
    },
  })
  check('整行一致的重复会被跳过', exactDup.json?.added === 0 && exactDup.json?.duplicateCount === 1)

  /* ---------------- 排序 ---------------- */
  console.log('\n【排序】')
  const all = await api('GET', '/api/admin/songs?pageSize=500&sort=position')
  const ids = all.json.items.map((item) => item.id)
  const reversed = [...ids].reverse()
  const reorder = await api('POST', '/api/admin/songs/reorder', { body: { ids: reversed } })
  const afterReorder = await api('GET', '/api/admin/songs?pageSize=5&sort=position')
  check(
    '拖拽排序后顺序生效',
    reorder.json?.ok === true && afterReorder.json.items[0].id === reversed[0],
    `${afterReorder.json.items[0].title}`,
  )
  // 还原顺序
  await api('POST', '/api/admin/songs/reorder', { body: { ids } })

  const bulkDelete = await api('POST', '/api/admin/songs/bulk-delete', { body: { ids: [newId] } })
  check('批量删除可用', bulkDelete.json?.removed === 1)

  /* ---------------- 设置 / 资料 ---------------- */
  console.log('\n【设置与资料】')
  const settings = await api('PUT', '/api/admin/settings', {
    body: {
      settings: {
        streamerName: '测试主播',
        liveUrl: 'https://live.bilibili.com/1',
        notice: '公告测试',
        icp: '京ICP备2023000000号-1',
        police: '京公网安备11010502030123号',
      },
    },
  })
  check('站点设置保存成功', settings.json?.settings?.streamerName === '测试主播')
  check(
    '公安备案号能存能读',
    settings.json?.settings?.police === '京公网安备11010502030123号',
    settings.json?.settings?.police,
  )

  const badSetting = await api('PUT', '/api/admin/settings', { body: { settings: { hack: '1' } } })
  check('未知设置项被拒绝', badSetting.status === 400, badSetting.json?.error)

  const songsAfterSettings = await api('GET', '/api/songs')
  check(
    '前台接口同步到新设置',
    songsAfterSettings.json?.meta?.streamerName === '测试主播' &&
      songsAfterSettings.json?.meta?.notice === '公告测试',
  )
  check(
    '前台 meta 里带上了 ICP 与公安备案号',
    songsAfterSettings.json?.meta?.icp === '京ICP备2023000000号-1' &&
      songsAfterSettings.json?.meta?.police === '京公网安备11010502030123号',
    JSON.stringify({
      icp: songsAfterSettings.json?.meta?.icp,
      police: songsAfterSettings.json?.meta?.police,
    }),
  )

  const newProfile = {
    title: '副标题',
    bio: '简介',
    tags: ['标签1'],
    links: [{ label: '主页', url: 'https://example.com' }],
    blocks: [{ type: 'notice', title: '公告', content: '内容' }],
  }
  const savedProfile = await api('PUT', '/api/admin/profile', { body: { profile: newProfile } })
  const readProfile = await api('GET', '/api/profile')
  check('主播资料保存并可读回', savedProfile.json?.ok === true && readProfile.json?.blocks?.[0]?.title === '公告')

  const badProfile = await api('PUT', '/api/admin/profile', { body: { profile: { blocks: '不是数组' } } })
  check('资料格式错误被拒绝', badProfile.status === 400, badProfile.json?.error)

  /* ---------------- 上传 ---------------- */
  console.log('\n【图片上传】')
  const pixelPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const upload = await api('POST', '/api/admin/upload', { body: { filename: 'a.png', dataUrl: pixelPng } })
  check('上传图片返回可访问地址', upload.json?.ok === true && upload.json.url.startsWith('/uploads/'), upload.json?.url)
  const img = await fetch(`${BASE}${upload.json.url}`)
  check('上传的图片能取回', img.status === 200 && img.headers.get('content-type') === 'image/png')

  const badUpload = await api('POST', '/api/admin/upload', { body: { filename: 'a.txt', dataUrl: 'data:text/plain;base64,aGk=' } })
  check('非图片格式被拒绝', badUpload.status === 400, badUpload.json?.error)

  /* ---------------- 导出与静态文件 ---------------- */
  console.log('\n【导出与静态再生】')
  const exportTxt = await api('GET', '/api/admin/export?format=txt')
  const lines = exportTxt.text.split('\n')
  check(
    '导出 list.txt 格式正确',
    exportTxt.status === 200 && lines[0] === '测试主播' && lines[2].startsWith('新\t歌名(单击复制)'),
    lines[2],
  )
  check('导出行数与歌曲数一致', lines.filter((line) => line.includes('\t')).length >= 3)

  const exportJson = await api('GET', '/api/admin/export?format=json')
  check('导出完整 JSON 快照', JSON.parse(exportJson.text).songs.length > 0)

  await sleep(200)
  const staticList = join(staticDir, 'list.txt')
  const staticProfile = join(staticDir, 'profile.json')
  check('数据库写入后同步再生了静态 list.txt', existsSync(staticList) && readFileSync(staticList, 'utf8').startsWith('测试主播'))
  check('静态 profile.json 也同步了', existsSync(staticProfile) && JSON.parse(readFileSync(staticProfile, 'utf8')).title === '副标题')

  /* ---------------- 备份与回滚 ---------------- */
  console.log('\n【备份与回滚】')
  const backups = await api('GET', '/api/admin/backups')
  check('写操作已自动产生备份', (backups.json?.backups?.length ?? 0) > 0, `${backups.json?.backups?.length} 份`)

  const manual = await api('POST', '/api/admin/backups', { body: { reason: 'manual' } })
  check('手动备份成功', manual.json?.backup?.id > 0, manual.json?.backup?.file)

  // 先破坏数据，再回滚，验证真的能救回来
  const totalBefore = (await api('GET', '/api/admin/songs?pageSize=1')).json.total
  await api('POST', '/api/admin/songs/bulk-delete', {
    body: { ids: (await api('GET', '/api/admin/songs?pageSize=500')).json.items.map((item) => item.id).slice(0, 20) },
  })
  const totalAfterDelete = (await api('GET', '/api/admin/songs?pageSize=1')).json.total
  check('批量删除确实减少了数据', totalAfterDelete === totalBefore - 20, `${totalBefore} -> ${totalAfterDelete}`)

  const restore = await api('POST', `/api/admin/backups/${manual.json.backup.id}/restore`)
  const totalAfterRestore = (await api('GET', '/api/admin/songs?pageSize=1')).json.total
  check('回滚把数据救回来了', restore.json?.ok === true && totalAfterRestore === totalBefore, `${totalAfterDelete} -> ${totalAfterRestore}`)

  const download = await fetch(`${BASE}/api/admin/backups/${manual.json.backup.id}/download`, {
    headers: { cookie },
  })
  const downloadBody = await download.text()
  check('备份文件可下载', download.status === 200 && JSON.parse(downloadBody).songs.length > 0)

  const removed = await api('DELETE', `/api/admin/backups/${manual.json.backup.id}`)
  check('删除备份可用', removed.json?.ok === true)

  const auditLog = await api('GET', '/api/admin/audit?limit=5')
  check('审计日志有记录', (auditLog.json?.items?.length ?? 0) > 0, auditLog.json?.items?.[0]?.action)

  /* ---------------- 密码安全 ---------------- */
  console.log('\n【密码安全】')
  const sessionInfo = await api('GET', '/api/auth/session')
  check('session 标明还在用初始密码', sessionInfo.json?.passwordIsInitial === true)

  const dbFiles = ['songlist.db', 'songlist.db-wal']
    .map((name) => join(dataDir, name))
    .filter((file) => existsSync(file))
  const dbBytes = Buffer.concat(dbFiles.map((file) => readFileSync(file)))
  check('数据库文件里搜不到明文密码', !dbBytes.includes(Buffer.from(PASSWORD)), `${dbFiles.length} 个文件`)

  const wrongCurrent = await api('POST', '/api/admin/password', {
    body: { currentPassword: 'definitely-wrong', newPassword: 'brand-new-password-1' },
  })
  check('改密码时会校验当前密码', wrongCurrent.status === 401, wrongCurrent.json?.error)

  const weakNext = await api('POST', '/api/admin/password', {
    body: { currentPassword: PASSWORD, newPassword: '12345678' },
  })
  check('弱密码被拒绝', weakNext.status === 400, weakNext.json?.error)

  const newPassword = 'song-list-2026-ok'
  const changed = await api('POST', '/api/admin/password', {
    body: { currentPassword: PASSWORD, newPassword },
  })
  check('改密码成功', changed.json?.ok === true, changed.json?.message)

  // 在「还登录着」的状态下验证：不再标记为初始密码
  // （之前这条放在 logout 之后，服务端返回 null，断言必然失败）
  const sessionAfterChange = await api('GET', '/api/auth/session')
  check(
    '改过密码后不再提示初始密码',
    sessionAfterChange.json?.authed === true && sessionAfterChange.json?.passwordIsInitial === false,
    JSON.stringify({ authed: sessionAfterChange.json?.authed, initial: sessionAfterChange.json?.passwordIsInitial }),
  )

  await api('POST', '/api/auth/logout')
  const oldLogin = await api('POST', '/api/auth/login', {
    body: { username: ADMIN_USER, password: PASSWORD },
  })
  check('旧密码立刻失效', oldLogin.status === 401)

  const newLogin = await api('POST', '/api/auth/login', {
    body: { username: ADMIN_USER, password: newPassword },
  })
  check('新密码可以登录', newLogin.status === 200)

  // 用新密码登录后，session 里也不该再标记初始密码
  const sessionAfterRelogin = await api('GET', '/api/auth/session')
  check(
    '重新登录后仍不提示初始密码',
    sessionAfterRelogin.json?.passwordIsInitial === false,
    String(sessionAfterRelogin.json?.passwordIsInitial),
  )

  const dbBytesAfter = Buffer.concat(
    dbFiles.filter((file) => existsSync(file)).map((file) => readFileSync(file)),
  )
  check(
    '新密码同样没有明文落盘',
    !dbBytesAfter.includes(Buffer.from(newPassword)) && !dbBytesAfter.includes(Buffer.from(PASSWORD)),
  )

  // 直接开一个只读连接，看 users 表里到底存了什么
  const inspect = new DatabaseSync(join(dataDir, 'songlist.db'))
  const userRow = inspect.prepare('SELECT username, password_hash FROM users').get()
  inspect.close()
  check(
    'users 表里存的是 scrypt 哈希',
    typeof userRow?.password_hash === 'string' &&
      userRow.password_hash.startsWith('scrypt$') &&
      userRow.password_hash.length > 80,
    `${String(userRow?.password_hash).slice(0, 26)}…（${String(userRow?.password_hash).length} 字符）`,
  )
  check(
    '哈希串里不含任何明文片段',
    !String(userRow?.password_hash).includes(PASSWORD) &&
      !String(userRow?.password_hash).includes(newPassword),
  )

  /* ---------------- 覆盖导入（回归：不能把歌单删空） ---------------- */
  console.log('\n【覆盖导入】')
  // 先把当前库原样取出来（含备注），再用「覆盖」模式导回去
  const dump = await api('GET', '/api/admin/songs?pageSize=100000')
  const dumpItems = dump.json.items.map((song) => ({
    title: song.title,
    singer: song.singer,
    language: song.language,
    genre: song.genre,
    sc: song.sc,
    note: song.note,
    isNew: song.isNew,
  }))
  const dumpWithNote = dumpItems.filter((song) => song.note).length
  const replaceSame = await api('POST', '/api/admin/songs/bulk', {
    body: { mode: 'replace', items: dumpItems },
  })
  const afterReplace = (await api('GET', '/api/admin/songs?pageSize=1')).json.total
  check(
    '覆盖导入同一份歌单不会清空（核心回归）',
    replaceSame.json?.ok === true && afterReplace === dumpItems.length,
    `${dumpItems.length} 行 → total ${afterReplace}`,
  )

  const notesKept = await api('GET', '/api/admin/songs?pageSize=100000')
  check(
    '覆盖导入后备注（付费曲标记）仍然保留',
    notesKept.json.items.filter((song) => song.note).length === dumpWithNote,
    `备注 ${notesKept.json.items.filter((song) => song.note).length} / ${dumpWithNote}`,
  )

  // 覆盖模式下批内完全重复的两行：应当只保留 1 条，且不会把歌单删空
  const beforeBad = (await api('GET', '/api/admin/songs?pageSize=1')).json.total
  const badReplace = await api('POST', '/api/admin/songs/bulk', {
    body: {
      mode: 'replace',
      items: [
        { title: '重复行', singer: 'X', language: '中文', genre: '流行' },
        { title: '重复行', singer: 'X', language: '中文', genre: '流行' },
      ],
    },
  })
  const afterBad = (await api('GET', '/api/admin/songs?pageSize=1')).json.total
  check(
    '覆盖时批内重复会合并成 1 条（不会删空）',
    badReplace.json?.ok === true && afterBad === 1,
    `${beforeBad} → ${afterBad}（新增 ${badReplace.json?.added}）`,
  )

  /* ---------------- 清空曲库（换歌单用） ---------------- */
  console.log('\n【清空曲库】')
  const beforeClear = (await api('GET', '/api/admin/songs?pageSize=1')).json.total
  const cleared = await api('POST', '/api/admin/songs/clear')
  const afterClear = (await api('GET', '/api/admin/songs?pageSize=1')).json.total
  check(
    '清空曲库可用且会先备份',
    cleared.json?.removed === beforeClear && afterClear === 0,
    `${beforeClear} -> ${afterClear}`,
  )
  const backupsAfterClear = await api('GET', '/api/admin/backups')
  check(
    '清空前留下了 before-clear 备份',
    backupsAfterClear.json.backups.some((item) => item.reason === 'before-clear'),
  )

  /* ---------------- 登出 ---------------- */
  console.log('\n【登出】')
  const logout = await api('POST', '/api/auth/logout')
  const afterLogout = await api('GET', '/api/admin/songs')
  check('登出后管理接口重新被拦截', logout.json?.ok === true && afterLogout.status === 401)
} catch (error) {
  failed++
  failures.push('未捕获异常')
  console.error('\n测试过程中抛错:', error)
  if (serverLog) console.error('--- 服务端日志 ---\n' + serverLog)
} finally {
  cleanup()
}

console.log(`\n${passed}/${passed + failed} 项通过`)
if (failed) {
  console.log('未通过：' + failures.join('、'))
  process.exitCode = 1
}
