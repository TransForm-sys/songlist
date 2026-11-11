/**
 * 数据管道自检：解析 public/list.txt，打印统计并验证搜索。
 * 运行： node scripts/verify.mjs（由 pnpm verify 用 esbuild 打包后执行）
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseSongList } from '../src/utils/parse'
import { config } from '../src/config'
import { getSearchEntries, matchesQuery, normalizeQuery } from '../src/utils/search'
import { parseListTxt } from '../server/lib/importList.mjs'
import { renderListTxt } from '../server/lib/export.mjs'

// 打包产物在 node_modules/.cache 下，所以按项目根目录解析数据文件
const text = readFileSync(resolve(process.cwd(), 'public/list.txt'), 'utf8')
const parsed = parseSongList(text)

console.log('主播:', parsed.meta.streamerName, '| 直播间:', parsed.meta.liveUrl)
console.log('歌曲数:', parsed.songs.length, '| 跳过行:', parsed.skippedRows)

const tally = (key: 'language' | 'genre' | 'singer' | 'sc') => {
  const map = new Map<string, number>()
  for (const song of parsed.songs) {
    const value = song[key]
    if (!value) continue
    map.set(value, (map.get(value) ?? 0) + 1)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

console.log('语种:', tally('language').map(([v, n]) => `${v}(${n})`).join(' '))
console.log('曲风:', tally('genre').map(([v, n]) => `${v}(${n})`).join(' '))
console.log('歌手数:', tally('singer').length, '| SC 歌曲:', tally('sc').reduce((sum, [, n]) => sum + n, 0))

const entries = getSearchEntries(parsed.songs)
const find = (query: string) => {
  const normalized = normalizeQuery(query)
  return parsed.songs
    .filter((_, index) => matchesQuery(entries[index], normalized))
    .map((song) => `${song.title} - ${song.singer}`)
}

// 只挑示例歌单里确实存在的几首来验搜索（换歌单也不用改这里：
// 不在歌单里的用例会自动跳过，而不是判失败）
const cases: [string, string][] = [
  ['dukou', '渡口'],
  ['dk', '渡口'],
  ['渡口', '渡口'],
  ['caiqin', '蔡琴'],
  ['cq', '蔡琴'],
  ['lingyuan', '泠鸢yousa'],
  ['beyond', 'Beyond'],
]

const inList = (name: string) => parsed.songs.some((song) => song.title === name || song.singer.includes(name))

let failed = 0
for (const [query, expect] of cases) {
  if (!inList(expect)) {
    console.log(`- 搜「${query}」跳过（示例歌单里没有「${expect}」）`)
    continue
  }
  const hits = find(query)
  const ok = hits.some((hit) => hit.includes(expect))
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} 搜「${query}」-> ${hits.length} 条，前 3：${hits.slice(0, 3).join(' / ') || '无'}`)
}

if (parsed.songs.length < 10) {
  console.error(`✗ 解析出的歌曲数太少（${parsed.songs.length} 首），格式可能不对`)
  failed++
}

/* ------------------------------------------------------------------
   解析器兼容性：合并的「类型 = 中文·流行」列、CSV、以及前后端口径一致性
------------------------------------------------------------------ */
console.log('\n【解析器兼容性】')

function expect(label: string, ok: boolean, extra = '') {
  if (!ok) failed++
  console.log(`${ok ? '✓' : '✗'} ${label}${extra ? ` — ${extra}` : ''}`)
}

// 1) 合并列：语种·曲风写在一列里（用户实际用的格式）
const combinedTsv = [
  '类型\t歌名\t原唱\t专辑\t发行年份\t备注',
  '中文·流行\t123木头人\t黑Girl\t美眉私密的一天\t\t',
  '日语·动漫\t残酷な天使のテーゼ\t高橋洋子\t\t\t',
  '粤语·流行\t海阔天空\tBeyond\t\t\t付费曲',
].join('\n')
const combined = parseSongList(combinedTsv)
expect(
  '「类型 = 中文·流行」能拆出语种',
  combined.songs[0].language === '中文' && combined.songs[0].genre === '流行',
  JSON.stringify({ language: combined.songs[0].language, genre: combined.songs[0].genre }),
)
expect('原唱列被识别为歌手', combined.songs[0].singer === '黑Girl', combined.songs[0].singer)
expect('日语·动漫 也拆得对', combined.songs[1].language === '日语' && combined.songs[1].genre === '动漫')
expect('粤语·流行 也拆得对', combined.songs[2].language === '粤语' && combined.songs[2].genre === '流行')

// 2) 前端与后端两个解析器必须给出同样的结果（否则界面导入和命令行导入会不一致）
//    只比有意义的字段：前端会额外带上自增 id
const signature = (list: Array<Record<string, unknown>>) =>
  list
    .map((song) =>
      [song.title, song.singer, song.language, song.genre, song.sc, song.note, song.isNew].join('|'),
    )
    .join('\n')
const backendResult = parseListTxt(combinedTsv)
expect(
  '前后端解析器结果一致',
  signature(combined.songs) === signature(backendResult.songs),
  `${combined.songs.length} vs ${backendResult.songs.length} 条`,
)

// 3) CSV（逗号分隔、字段带引号和逗号）
const csvText = ['类型,歌名,原唱', '中文·流行,"明天,你好",牛奶咖啡', '中文·流行,渡口,蔡琴'].join('\n')
const csvParsed = parseSongList(csvText)
expect(
  'CSV 能解析，且带逗号的字段不被切断',
  csvParsed.songs.length === 2 &&
    csvParsed.songs[0].title === '明天,你好' &&
    csvParsed.songs[0].language === '中文',
  JSON.stringify(csvParsed.songs[0]),
)

// 4) 守卫：没有语种特征的值不能被误拆
const guard = parseSongList(['曲风\t歌名', '摇滚/流行\t某首歌'].join('\n'))
expect(
  '「摇滚/流行」不会被误判成语种',
  guard.songs[0].language === '' && guard.songs[0].genre === '摇滚/流行',
  JSON.stringify({ language: guard.songs[0].language, genre: guard.songs[0].genre }),
)

// 5) 原有格式（有独立语种/曲风列）不能被影响
const originalFormat = [
  '示例主播',
  'https://live.bilibili.com/1',
  '新\t歌名(单击复制)\t歌手\t语种\t曲风\t需要SC\t备注',
  '\t渡口\t蔡琴\t中文\t中文流行\t\t',
  '新\t吉祥话\t泠鸢yousa\t中文\t中文流行\t星愿水晶球\t',
].join('\n')
const original = parseSongList(originalFormat)
expect(
  '独立语种/曲风列仍然正常（不受合并列逻辑影响）',
  original.songs[0].language === '中文' &&
    original.songs[0].genre === '中文流行' &&
    original.songs[1].isNew === true &&
    original.songs[1].sc === '星愿水晶球',
  JSON.stringify(original.songs[1]),
)

// 6) 导出的 list.txt 里，没有 SC 数据时不应该出现「需要SC」这一列
//    （这个文件放在网站根目录、可被公开访问，备案审核也会看公开内容）
const noScExport = renderListTxt({
  streamerName: '测试主播',
  liveUrl: 'https://live.bilibili.com/1',
  songs: [
    { title: '渡口', singer: '蔡琴', language: '中文', genre: '经典老歌', sc: '', note: '' },
    { title: '宝贝', singer: '张悬', language: '中文', genre: '流行', sc: '', note: '' },
  ],
})
const withScExport = renderListTxt({
  streamerName: '测试主播',
  liveUrl: 'https://live.bilibili.com/1',
  songs: [
    { title: '吉祥话', singer: '泠鸢yousa', language: '中文', genre: '流行', sc: '水晶球', note: '' },
  ],
})
expect(
  '没有 SC 数据时，导出的 list.txt 不含「需要SC」列',
  !noScExport.includes('需要SC') &&
    noScExport.split('\n')[2] === '新\t歌名(单击复制)\t歌手\t语种\t曲风\t备注',
  JSON.stringify(noScExport.split('\n')[2]),
)
expect(
  '有 SC 数据时，导出仍然保留「需要SC」列',
  withScExport.includes('需要SC') && withScExport.includes('水晶球'),
)

// 8) 点歌复制文本：只带歌名（点歌机按歌名匹配，带歌手会认不出来）
const copyPlain = config.copyTemplate({ title: '阿刁', singer: '赵雷', sc: '' })
expect('复制文本是「点歌 歌名」，不带歌手', copyPlain === '点歌 阿刁', copyPlain)
const copyWithSc = config.copyTemplate({ title: '吉祥话', singer: '泠鸢yousa', sc: '水晶球' })
expect('有 SC 标记时才补礼物名', copyWithSc === '点歌 吉祥话（水晶球）', copyWithSc)
console.log(failed === 0 ? '\n全部检查通过' : `\n${failed} 项检查未通过`)
process.exit(failed === 0 ? 0 : 1)
