import { pinyin } from 'pinyin-pro'
import type { Song } from '../types'

/**
 * 为每首歌预生成检索串：原名、拼音全拼、拼音首字母。
 * 这样「渡口」「dukou」「dk」都能命中同一首歌。
 */
export interface SearchEntry {
  title: string
  singer: string
  /** 歌名 + 歌手的拼音全拼，去空格小写 */
  fullPinyin: string
  /** 歌名 + 歌手的拼音首字母，去空格小写 */
  initials: string
}

const cache = new WeakMap<Song[], SearchEntry[]>()

function toPinyin(value: string, first: boolean): string {
  if (!value) return ''
  try {
    const parts = pinyin(value, {
      toneType: 'none',
      type: 'array',
      pattern: first ? 'first' : 'pinyin',
      nonZh: 'consecutive',
    }) as string[]
    return parts.join('').toLowerCase()
  } catch {
    return ''
  }
}

function entryOf(song: Song): SearchEntry {
  const title = song.title.toLowerCase()
  const singer = song.singer.toLowerCase()
  return {
    title,
    singer,
    fullPinyin: toPinyin(song.title, false) + toPinyin(song.singer, false),
    initials: toPinyin(song.title, true) + toPinyin(song.singer, true),
  }
}

export function getSearchEntries(songs: Song[]): SearchEntry[] {
  let entries = cache.get(songs)
  if (!entries) {
    entries = songs.map(entryOf)
    cache.set(songs, entries)
  }
  return entries
}

/** 归一化查询串：去掉所有空白，便于「du kou」也能搜到 */
export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, '').toLowerCase()
}

export function matchesQuery(entry: SearchEntry, query: string): boolean {
  if (!query) return true
  return (
    entry.title.includes(query) ||
    entry.singer.includes(query) ||
    entry.fullPinyin.includes(query) ||
    entry.initials.includes(query)
  )
}
