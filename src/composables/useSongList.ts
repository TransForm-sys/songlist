import { computed, ref, shallowRef } from 'vue'
import { config } from '../config'
import { loadText } from '../utils/loadText'
import { parseSongList } from '../utils/parse'
import { getSearchEntries, matchesQuery, normalizeQuery } from '../utils/search'
import type {
  DataSource,
  FacetOption,
  LoadError,
  LoadState,
  Profile,
  Song,
  SongListMeta,
} from '../types'

/**
 * 歌单状态（全局单例）。页面只有一块数据，没必要上 Pinia。
 */
const songs = shallowRef<Song[]>([])
const meta = ref<SongListMeta>({
  streamerName: '',
  liveUrl: '',
  notice: '',
  icp: '',
  police: '',
})
const profile = ref<Profile | null>(null)
const status = ref<LoadState>('idle')
const error = ref<LoadError | null>(null)
/** 这一屏的数据到底是后端给的还是静态文件给的，页脚会显示出来 */
const dataSource = ref<DataSource>(null)

const query = ref('')
const selectedLanguages = ref<string[]>([])
const selectedGenres = ref<string[]>([])
const selectedSingers = ref<string[]>([])
const scOnly = ref(false)

type FacetKey = 'language' | 'genre' | 'singer'

const entries = computed(() => getSearchEntries(songs.value))
const normalizedQuery = computed(() => normalizeQuery(query.value))

const langSet = computed(() => new Set(selectedLanguages.value))
const genreSet = computed(() => new Set(selectedGenres.value))
const singerSet = computed(() => new Set(selectedSingers.value))

/** 单首歌是否命中当前条件；skip 用于算某一维的候选项数量（标准分面统计） */
function pass(song: Song, index: number, skip?: FacetKey): boolean {
  if (scOnly.value && !song.sc) return false
  if (skip !== 'language' && langSet.value.size && !langSet.value.has(song.language)) return false
  if (skip !== 'genre' && genreSet.value.size && !genreSet.value.has(song.genre)) return false
  if (skip !== 'singer' && singerSet.value.size && !singerSet.value.has(song.singer)) return false
  return matchesQuery(entries.value[index], normalizedQuery.value)
}

const filteredSongs = computed(() => {
  const list = songs.value
  const out: Song[] = []
  for (let i = 0; i < list.length; i++) {
    if (pass(list[i], i)) out.push(list[i])
  }
  return out
})

function facetOptions(key: FacetKey): FacetOption[] {
  const counts = new Map<string, number>()
  const list = songs.value
  for (let i = 0; i < list.length; i++) {
    const song = list[i]
    if (!pass(song, i, key)) continue
    const value = song[key]
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return Array.from(counts, ([value, count]) => ({ value, count })).sort((a, b) =>
    a.value.localeCompare(b.value, 'zh-Hans-CN'),
  )
}

const languageOptions = computed(() => facetOptions('language'))
const genreOptions = computed(() => facetOptions('genre'))
const singerOptions = computed(() => facetOptions('singer'))

const scCount = computed(() => {
  let count = 0
  for (let i = 0; i < songs.value.length; i++) {
    const song = songs.value[i]
    if (song.sc && pass(song, i, 'language') && pass(song, i, 'genre') && pass(song, i, 'singer')) count++
  }
  return count
})

const activeFilterCount = computed(
  () =>
    selectedLanguages.value.length +
    selectedGenres.value.length +
    selectedSingers.value.length +
    (scOnly.value ? 1 : 0),
)

const displayName = computed(() => meta.value.streamerName || '主播')
const hasAnySong = computed(() => songs.value.length > 0)
/**
 * 歌单里有没有「需要 SC」的歌。
 * 没有就整列 / 整个筛选都不显示 —— 主播不用 SC 点歌时，界面不该留个永远为 0 的空列；
 * 哪天数据里出现 SC（表格导入带上「需要SC」列即可），它会自己回来。
 */
const hasScSongs = computed(() => songs.value.some((song) => Boolean(song.sc)))
const isFiltering = computed(() => Boolean(normalizedQuery.value) || activeFilterCount.value > 0)

function clearFilters() {
  query.value = ''
  selectedLanguages.value = []
  selectedGenres.value = []
  selectedSingers.value = []
  scOnly.value = false
}

/**
 * 取一次接口。任何异常（后端没起、404、返回的不是 JSON）都当成「没有接口」，
 * 这样纯静态部署时前端会安静地退回读 list.txt。
 */
async function fetchApi<T>(url: string, timeoutMs: number): Promise<T | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return null
    return (await response.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

interface SongsPayload {
  meta?: Partial<SongListMeta>
  songs?: Song[]
}

/**
 * 优先走后端接口。返回 false 表示"这个部署没有后端"，
 * 调用方再去读静态文件。
 */
async function loadFromApi(): Promise<boolean> {
  const payload = await fetchApi<SongsPayload>(config.api.songsUrl, config.api.timeoutMs)
  if (!payload || !Array.isArray(payload.songs)) return false

  songs.value = payload.songs.map((song, index) => ({
    id: Number.isFinite(song.id) ? song.id : index,
    isNew: Boolean(song.isNew),
    title: String(song.title ?? ''),
    singer: String(song.singer ?? ''),
    language: String(song.language ?? ''),
    genre: String(song.genre ?? ''),
    sc: String(song.sc ?? ''),
    note: String(song.note ?? ''),
  }))
  meta.value = {
    streamerName: payload.meta?.streamerName ?? '',
    liveUrl: payload.meta?.liveUrl ?? '',
    notice: payload.meta?.notice ?? '',
    icp: payload.meta?.icp ?? '',
    police: payload.meta?.police ?? '',
    // 背景图只从接口来（静态 list.txt 里没有这个字段）
    background: payload.meta?.background ?? '',
    backgroundPosition: payload.meta?.backgroundPosition ?? 'top',
    backgroundVideo: payload.meta?.backgroundVideo ?? '',
  }
  dataSource.value = 'api'
  return true
}

async function loadProfile() {
  // 先问接口，没有接口再读静态 profile.json
  const fromApi = await fetchApi<Profile | null>(config.api.profileUrl, config.api.timeoutMs)
  if (fromApi && typeof fromApi === 'object') {
    profile.value = fromApi
    return
  }

  try {
    const text = await loadText(config.profileUrl, { timeoutMs: config.timeoutMs }, { optional: true })
    if (!text) return
    const parsed = JSON.parse(text) as Profile
    profile.value = parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    // 简介是可选内容：格式错/超时都不该影响歌单本身
    profile.value = null
  }
}

async function load() {
  status.value = 'loading'
  error.value = null

  // 1) 后端接口优先
  if (await loadFromApi()) {
    status.value = 'ready'
    void loadProfile()
    return
  }

  // 2) 退回静态 list.txt（纯静态部署 / 后端挂了）
  try {
    const text = await loadText(config.listUrl, { timeoutMs: config.timeoutMs })
    if (text === null) {
      throw { kind: 'http', message: '歌单加载失败' } satisfies LoadError
    }
    const parsed = parseSongList(text)
    songs.value = parsed.songs
    meta.value = {
      ...parsed.meta,
      notice: '',
      icp: '',
      police: '',
      background: '',
      backgroundPosition: 'top',
      backgroundVideo: '',
    }
    dataSource.value = 'static'
    status.value = 'ready'
  } catch (err) {
    const known = err as LoadError
    error.value = known?.kind
      ? known
      : { kind: 'format', message: (err as Error)?.message || '歌单文件格式不正确' }
    songs.value = []
    status.value = 'error'
  }
  void loadProfile()
}

export function useSongList() {
  return {
    // 数据
    songs,
    meta,
    profile,
    status,
    error,
    dataSource,
    displayName,
    hasAnySong,
    hasScSongs,
    // 条件
    query,
    selectedLanguages,
    selectedGenres,
    selectedSingers,
    scOnly,
    activeFilterCount,
    isFiltering,
    // 结果
    filteredSongs,
    languageOptions,
    genreOptions,
    singerOptions,
    scCount,
    // 动作
    load,
    clearFilters,
  }
}
