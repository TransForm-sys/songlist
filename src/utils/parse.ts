import type { ParsedSongList, Song } from '../types'

/** 表格导出的文本里常见的空白：半角/全角空格、BOM、零宽字符 */
const CLEAN_RE = /[\u200b-\u200d\ufeff]/g

function cleanCell(raw: string | undefined): string {
  if (!raw) return ''
  return raw.replace(CLEAN_RE, '').replace(/\u00a0/g, ' ').trim()
}

/** 看起来像链接的单元格 */
function asUrl(raw: string): string {
  const v = cleanCell(raw)
  return /^https?:\/\/\S+$/i.test(v) ? v : ''
}

/** 看起来像「填写说明」的占位内容，例如 A1填写你的名字 */
function isPlaceholder(raw: string): boolean {
  return /^[A-Z]\d+\s*填/.test(cleanCell(raw))
}

interface ColumnMap {
  isNew: number
  title: number
  singer: number
  language: number
  genre: number
  sc: number
  note: number
  /** 「中文·流行」这种语种+曲风合并列（没有独立语种列时才用） */
  combined: number
}

function matchColumn(header: string[], keywords: RegExp): number {
  return header.findIndex((cell) => keywords.test(cell))
}

/** 常见的语种写法，用来判断「A·B」里的 A 是不是语种 */
const LANGUAGE_WORDS = new Set([
  '中文', '华语', '国语', '普通话', '汉语',
  '粤语', '广东话', '闽南语', '台语', '客家话',
  '日语', '日文', '英语', '英文', '韩语', '韩文',
  '法语', '德语', '俄语', '西语', '西班牙语', '意大利语', '葡萄牙语', '泰语', '越南语',
  '纯音乐', '器乐', '无词', '其他',
])

/** 合并列的分隔符：CJK 间隔号最可靠，其次才是斜杠/竖线 */
const COMBINED_SEPARATOR = /[·・‧|｜/／]/
const STRONG_SEPARATOR = /[·・‧]/

/**
 * 把「中文·流行」这样的合并值拆成语种 + 曲风。
 * 判断依据：出现 CJK 间隔号（强信号），或第一段是已知语种写法。
 * 都不满足时整串当曲风 —— 免得把「摇滚/流行」误拆成语种=摇滚。
 */
export function splitCombinedType(raw: string): { language: string; genre: string } {
  const value = String(raw ?? '').trim()
  if (!value) return { language: '', genre: '' }
  const parts = value.split(COMBINED_SEPARATOR).map((part) => part.trim()).filter(Boolean)
  if (parts.length < 2) return { language: '', genre: value }
  if (STRONG_SEPARATOR.test(value) || LANGUAGE_WORDS.has(parts[0])) {
    return { language: parts[0], genre: parts.slice(1).join('·') }
  }
  return { language: '', genre: value }
}

function buildColumnMap(header: string[]): ColumnMap {
  const title = matchColumn(header, /歌名|曲名|歌曲名|歌\s*曲/)
  if (title < 0) throw new Error('未找到「歌名」列')

  const language = matchColumn(header, /语种|语言|语言类别/)
  const map: ColumnMap = {
    isNew: -1,
    title,
    singer: matchColumn(header, /歌手|唱见|原唱|演唱/),
    language,
    genre: matchColumn(header, /曲风|风格|类型|分类/),
    sc: matchColumn(header, /\bsc\b|superchat|super chat|礼物/i),
    note: matchColumn(header, /备注|说明|备注信息/),
    // 没有独立语种列，但有「类型/分类」列时，按合并列处理（例如 中文·流行）
    combined: language < 0 ? matchColumn(header, /类型|分类|类别|语种\s*[·・/／|｜]\s*曲风/) : -1,
  }

  // 第一列若是「新」标记列（歌名列之前的独立列），识别出来
  const first = header[0] ?? ''
  if (title > 0 && /^新|新歌$|^new$/i.test(first)) map.isNew = 0

  return map
}

function cell(cells: string[], index: number): string {
  if (index < 0) return ''
  return cleanCell(cells[index])
}

/** 判断按什么分隔：有制表符就是 TSV（表格软件复制出来的），否则按逗号（CSV） */
export function detectDelimiter(lines: string[]): '\t' | ',' {
  for (const line of lines) {
    if (!line.trim()) continue
    if (line.includes('\t')) return '\t'
    if (line.includes(',')) return ','
    return '\t'
  }
  return '\t'
}

/** 极简 CSV 切分：支持 "双引号包裹" 和 "" 转义（字段里出现逗号时表格软件会这样导出） */
export function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (inQuotes) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        current += char
      }
    } else if (char === '"') {
      inQuotes = true
    } else if (char === ',') {
      out.push(current)
      current = ''
    } else {
      current += char
    }
  }
  out.push(current)
  return out
}

export function makeSplitter(delimiter: '\t' | ','): (line: string) => string[] {
  return delimiter === ',' ? splitCsvLine : (line: string) => line.split('\t')
}

/**
 * 解析表格导出成的 list.txt。
 *
 * 真实格式（前两行是表头信息，第三行是列名，之后才是数据）：
 *   浅野天琪<TAB><TAB>A1填写你的名字
 *   https://live.bilibili.com/21465419<TAB><TAB>A2填直播间链接
 *   新<TAB>歌名(单击复制)<TAB>歌手<TAB>语种<TAB>曲风<TAB>需要SC<TAB>备注
 *   <TAB>渡口<TAB>蔡琴<TAB>中文<TAB>中文流行<TAB><TAB>
 */
export function parseSongList(text: string): ParsedSongList {
  const normalized = text.replace(CLEAN_RE, '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  // 支持两种分隔：表格软件复制/导出多以制表符分隔，另存为 CSV 时是逗号
  const delimiter = detectDelimiter(lines)
  const splitLine = makeSplitter(delimiter)
  if (!lines.some((line) => splitLine(line).length > 1 || line.includes(delimiter))) {
    throw new Error('歌单文件格式不正确：既不是制表符也不是逗号分隔的表格文本')
  }

  // 1) 找列名行：前 20 行里第一个含「歌名」的行
  let headerIndex = -1
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const cells = splitLine(lines[i])
    if (cells.some((c) => /歌名|曲名|歌曲名/.test(cleanCell(c)))) {
      headerIndex = i
      break
    }
  }
  if (headerIndex < 0) {
    throw new Error('歌单文件格式不正确：找不到「歌名」列')
  }

  const header = splitLine(lines[headerIndex]).map(cleanCell)
  const columns = buildColumnMap(header)

  // 2) 列名行之前的内容是主播信息
  let streamerName = ''
  let liveUrl = ''
  for (let i = 0; i < headerIndex; i++) {
    const cells = splitLine(lines[i])
    for (const raw of cells) {
      const value = cleanCell(raw)
      if (!value || isPlaceholder(value)) continue
      const url = asUrl(value)
      if (url && !liveUrl) {
        liveUrl = url
      } else if (!url && !streamerName) {
        streamerName = value
      }
    }
  }

  // 3) 数据行
  const songs: Song[] = []
  const seen = new Set<string>()
  let skippedRows = 0

  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue

    const cells = splitLine(line)
    const title = cell(cells, columns.title)
    if (!title) {
      skippedRows++
      continue
    }

    const song: Song = {
      id: 0,
      isNew: Boolean(cell(cells, columns.isNew)),
      title,
      singer: cell(cells, columns.singer),
      language: cell(cells, columns.language),
      genre: cell(cells, columns.genre),
      sc: cell(cells, columns.sc),
      note: cell(cells, columns.note),
    }

    // 合并列（例如「类型 = 中文·流行」）：拆成语种 + 曲风。
    // 只有在没有独立语种列时才会走到这里。
    if (!song.language && columns.combined >= 0) {
      const split = splitCombinedType(cell(cells, columns.combined))
      if (split.language) song.language = split.language
      if (split.genre) song.genre = split.genre
    }

    // 表格里偶有完全重复的一行，去重避免列表出现两条一模一样的歌
    const key = [song.title, song.singer, song.language, song.genre, song.sc, song.note].join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)

    song.id = songs.length
    songs.push(song)
  }

  return { meta: { streamerName, liveUrl }, songs, skippedRows }
}
