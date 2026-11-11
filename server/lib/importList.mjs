/**
 * 解析表格导出的文本：既支持制表符分隔（从表格软件复制/导出），也支持逗号分隔的 CSV。
 * 用于首次启动时把已有歌单灌进数据库，以及 scripts/reset-data.mjs 的命令行导入。
 *
 * 解析口径必须与前端 src/utils/parse.ts 保持一致，否则
 * 「后台粘贴导入」和「命令行导入」出来的结果会不一样。
 */
const CLEAN_RE = /[\u200b-\u200d\ufeff]/g

function cleanCell(raw) {
  if (raw === undefined || raw === null) return ''
  return String(raw).replace(CLEAN_RE, '').replace(/\u00a0/g, ' ').trim()
}

function matchColumn(header, regex) {
  return header.findIndex((cell) => regex.test(cell))
}

/** 常见语种写法，用来判断「A·B」里的 A 是不是语种 */
const LANGUAGE_WORDS = new Set([
  '中文', '华语', '国语', '普通话', '汉语',
  '粤语', '广东话', '闽南语', '台语', '客家话',
  '日语', '日文', '英语', '英文', '韩语', '韩文',
  '法语', '德语', '俄语', '西语', '西班牙语', '意大利语', '葡萄牙语', '泰语', '越南语',
  '纯音乐', '器乐', '无词', '其他',
])

const COMBINED_SEPARATOR = /[·・‧|｜/／]/
const STRONG_SEPARATOR = /[·・‧]/

/**
 * 把「中文·流行」这样的合并值拆成语种 + 曲风。
 * 判断依据：出现 CJK 间隔号（强信号），或第一段是已知语种写法。
 * 都不满足时整串当曲风 —— 免得把「摇滚/流行」误拆成语种=摇滚。
 */
export function splitCombinedType(raw) {
  const value = String(raw ?? '').trim()
  if (!value) return { language: '', genre: '' }
  const parts = value
    .split(COMBINED_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length < 2) return { language: '', genre: value }
  if (STRONG_SEPARATOR.test(value) || LANGUAGE_WORDS.has(parts[0])) {
    return { language: parts[0], genre: parts.slice(1).join('·') }
  }
  return { language: '', genre: value }
}

/** 判断按什么分隔：有制表符就是 TSV，否则按逗号（CSV） */
export function detectDelimiter(lines) {
  for (const line of lines) {
    if (!line.trim()) continue
    if (line.includes('\t')) return '\t'
    if (line.includes(',')) return ','
    return '\t'
  }
  return '\t'
}

/** 极简 CSV 切分：支持 "双引号包裹" 与 "" 转义（字段里带逗号时表格软件会这样导出） */
export function splitCsvLine(line) {
  const out = []
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

export function makeSplitter(delimiter) {
  return delimiter === ',' ? splitCsvLine : (line) => line.split('\t')
}

export function parseListTxt(text) {
  const normalized = String(text ?? '')
    .replace(CLEAN_RE, '')
    .replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const delimiter = detectDelimiter(lines)
  const splitLine = makeSplitter(delimiter)

  // 列名行：前 20 行里第一个含「歌名」的行
  let headerIndex = -1
  for (let i = 0; i < Math.min(lines.length, 20); i++) {
    const cells = splitLine(lines[i])
    if (cells.some((cell) => /歌名|曲名|歌曲名/.test(cleanCell(cell)))) {
      headerIndex = i
      break
    }
  }
  if (headerIndex < 0) throw new Error('歌单文件里找不到「歌名」列')

  const header = splitLine(lines[headerIndex]).map(cleanCell)
  const languageColumn = matchColumn(header, /语种|语言/)
  const columns = {
    title: matchColumn(header, /歌名|曲名|歌曲名/),
    singer: matchColumn(header, /歌手|唱见|原唱|演唱/),
    language: languageColumn,
    genre: matchColumn(header, /曲风|风格|类型|分类/),
    sc: matchColumn(header, /\bsc\b|superchat|super chat|礼物/i),
    note: matchColumn(header, /备注|说明/),
    isNew: header[0] && /^新|新歌$|^new$/i.test(header[0]) ? 0 : -1,
    // 没有独立语种列时，把「类型/分类」当合并列（中文·流行）拆开
    combined: languageColumn < 0 ? matchColumn(header, /类型|分类|类别|语种\s*[·・/／|｜]\s*曲风/) : -1,
  }

  // 列名行之前的内容是主播信息（主播名 / 直播间链接）
  const meta = { streamerName: '', liveUrl: '' }
  for (let i = 0; i < headerIndex; i++) {
    for (const cell of splitLine(lines[i])) {
      const value = cleanCell(cell)
      if (!value || /^[A-Z]\d+\s*填/.test(value)) continue
      if (/^https?:\/\/\S+$/i.test(value)) meta.liveUrl ||= value
      else meta.streamerName ||= value
    }
  }

  const cell = (cells, index) => (index < 0 ? '' : cleanCell(cells[index]))
  const songs = []
  const seen = new Set()
  for (let i = headerIndex + 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue
    const cells = splitLine(lines[i])
    const title = cell(cells, columns.title)
    if (!title) continue

    const song = {
      title,
      singer: cell(cells, columns.singer),
      language: cell(cells, columns.language),
      genre: cell(cells, columns.genre),
      sc: cell(cells, columns.sc),
      note: cell(cells, columns.note),
      isNew: Boolean(cell(cells, columns.isNew)),
    }

    // 合并列（类型 = 中文·流行）拆成语种 + 曲风；没有独立语种列时才生效
    if (!song.language && columns.combined >= 0) {
      const split = splitCombinedType(cell(cells, columns.combined))
      if (split.language) song.language = split.language
      if (split.genre) song.genre = split.genre
    }

    const key = [song.title, song.singer, song.language, song.genre, song.sc, song.note].join('\u0000')
    if (seen.has(key)) continue
    seen.add(key)
    songs.push(song)
  }

  return { meta, songs }
}
