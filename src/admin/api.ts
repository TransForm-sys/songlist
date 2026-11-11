/**
 * 后台的 HTTP 封装。
 *
 * 只做三件事：同源带 cookie、把后端的 { error } 变成可 catch 的 ApiError、
 * 401 时通知外壳回到登录界面。组件里不直接写 fetch，保证错误口径一致。
 */
import type { FacetOption, Profile, Song } from '../types'

/* ------------------------------ 类型 ------------------------------ */

/** 列表接口里比前台 Song 多出来的管理字段 */
export interface AdminSong extends Song {
  position: number
  createdAt: number
  updatedAt: number
}

export interface SongFacets {
  language: FacetOption[]
  genre: FacetOption[]
  singer: FacetOption[]
}

export interface SongQuery {
  q?: string
  language?: string[]
  genre?: string[]
  singer?: string[]
  sc?: boolean
  isNew?: boolean
  page?: number
  pageSize?: number
  sort?: SongSort
}

export type SongSort = 'position' | 'title' | 'singer' | 'updated' | 'created'

export interface SongListResult {
  items: AdminSong[]
  total: number
  page: number
  pageSize: number
  facets: SongFacets
  scCount: number
}

export type SongInput = Pick<Song, 'title' | 'singer' | 'language' | 'genre' | 'sc' | 'note' | 'isNew'>

export interface SessionInfo {
  authed: boolean
  user: { username: string } | null
  /** 还在用初始密码时后端会给 true，后台要显眼提示 */
  passwordIsInitial: boolean | null
}

export interface SiteSettings {
  streamerName: string
  liveUrl: string
  icp: string
  /** 公安备案号；只填数字也行，前台会自动补成「公网安备 … 号」 */
  police: string
  notice: string
  /** 全屏背景图地址（后台上传得到 /uploads/xxx）；留空用渐变底色 */
  background: string
  /** 背景图裁切焦点：top / center / bottom */
  backgroundPosition: 'top' | 'center' | 'bottom'
  /** 背景视频地址（后台上传得到 /uploads/xxx.mp4）；留空则只用背景图 */
  backgroundVideo: string
}

export interface BackupInfo {
  id: number
  createdAt: number
  reason: string
  file: string
  bytes: number
  songCount: number
}

export interface AuditItem {
  id: number
  createdAt: number
  action: string
  detail: string
  ip: string
}

export interface Overview {
  songs: number
  scSongs: number
  newSongs: number
  singers: number
  languages: FacetOption[]
  genres: FacetOption[]
  lastBackup: BackupInfo | null
  backups: number
  dbBytes: number
  settings: SiteSettings
}

export interface BulkResult {
  ok: boolean
  mode: string
  received: number
  added: number
  skipped: number
  duplicates: { title: string; singer: string }[]
  duplicateCount: number
  /** 歌名 + 歌手相同但其他字段不同：照样导入，只做提醒 */
  similar: { title: string; singer: string }[]
  similarCount: number
  total: number
}

/** 后端统一的错误形状，status 放在对象上方便分支处理 */
export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/* ------------------------------ 401 广播 ------------------------------ */

type UnauthorizedHandler = () => void

let onUnauthorized: UnauthorizedHandler | null = null

/**
 * 外壳注册一次；任何管理接口返回 401 都走这里回到登录页，
 * 这样业务组件不用每个请求都写一遍「未登录」分支。
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler
}

/* ------------------------------ 底层请求 ------------------------------ */

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string }
    if (payload?.error) return payload.error
  } catch {
    /* 后端理论上都返回 JSON，真坏了就给通用文案 */
  }
  return `请求失败（HTTP ${response.status}）`
}

interface RequestOptions {
  method?: string
  body?: unknown
  /** 登录/登出这种接口不该触发「回到登录页」，否则会把用户自己的操作打断 */
  silentUnauthorized?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, silentUnauthorized = false } = options

  let response: Response
  try {
    response = await fetch(path, {
      method,
      // 同源 + HttpOnly cookie：显式带上 credentials，避免以后换域名时踩坑
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, '网络连接失败，请检查后端是否在运行')
  }

  if (response.status === 401 && !silentUnauthorized) onUnauthorized?.()
  if (!response.ok) throw new ApiError(response.status, await readError(response))

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

/** 查询参数：数组用英文逗号拼接（后端约定），空值直接不发 */
function buildQuery(params: Record<string, string | number | boolean | string[] | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (!value.length) continue
      search.set(key, value.join(','))
      continue
    }
    if (value === false) continue
    search.set(key, value === true ? '1' : String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

/* ------------------------------ 接口 ------------------------------ */

export const api = {
  /* 登录 */
  session: () => request<SessionInfo>('/api/auth/session'),

  login: (username: string, password: string) =>
    request<{ ok: boolean; user: { username: string } }>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
      silentUnauthorized: true,
    }),

  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', silentUnauthorized: true }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean; message: string }>('/api/admin/password', {
      method: 'POST',
      body: { currentPassword, newPassword },
      // 当前密码错也是 401，但这时是表单校验问题，不该把用户踢回登录页
      silentUnauthorized: true,
    }),

  /* 概览 */
  overview: () => request<Overview>('/api/admin/overview'),

  /* 歌曲 */
  songs: (query: SongQuery = {}) =>
    request<SongListResult>(
      `/api/admin/songs${buildQuery({
        q: query.q?.trim(),
        language: query.language,
        genre: query.genre,
        singer: query.singer,
        sc: query.sc,
        isNew: query.isNew,
        page: query.page,
        pageSize: query.pageSize,
        sort: query.sort,
      })}`,
    ),

  createSong: (input: SongInput) =>
    request<{ ok: boolean; id: number; song: AdminSong }>('/api/admin/songs', {
      method: 'POST',
      body: input,
    }),

  updateSong: (id: number, input: Partial<SongInput>) =>
    request<{ ok: boolean; song: AdminSong }>(`/api/admin/songs/${id}`, { method: 'PUT', body: input }),

  deleteSong: (id: number) => request<{ ok: boolean }>(`/api/admin/songs/${id}`, { method: 'DELETE' }),

  bulkDelete: (ids: number[]) =>
    request<{ ok: boolean; removed: number }>('/api/admin/songs/bulk-delete', {
      method: 'POST',
      body: { ids },
    }),

  moveSong: (id: number, direction: 'up' | 'down') =>
    request<{ ok: boolean; moved: boolean }>(`/api/admin/songs/${id}/move`, {
      method: 'POST',
      body: { direction },
    }),

  reorder: (ids: number[]) =>
    request<{ ok: boolean; count: number }>('/api/admin/songs/reorder', { method: 'POST', body: { ids } }),

  pin: (ids: number[], mode: 'top' | 'bottom') =>
    request<{ ok: boolean; mode: string; count: number }>('/api/admin/songs/pin', {
      method: 'POST',
      body: { ids, mode },
    }),

  bulkImport: (mode: 'append' | 'replace', items: SongInput[]) =>
    request<BulkResult>('/api/admin/songs/bulk', { method: 'POST', body: { mode, items } }),

  /** 清空曲库（换歌单时用）。属于破坏性操作，界面上要强确认 */
  clearSongs: () =>
    request<{ ok: boolean; removed: number }>('/api/admin/songs/clear', { method: 'POST', body: {} }),

  /* 主播资料 */
  getProfile: () => request<{ profile: Profile | null }>('/api/admin/profile'),

  saveProfile: (profile: Profile) =>
    request<{ ok: boolean; profile: Profile }>('/api/admin/profile', {
      method: 'PUT',
      body: { profile },
    }),

  upload: (filename: string, dataUrl: string) =>
    request<{ ok: boolean; url: string; bytes: number }>('/api/admin/upload', {
      method: 'POST',
      body: { filename, dataUrl },
    }),

  /* 站点设置 */
  getSettings: () => request<{ settings: SiteSettings; defaults: SiteSettings }>('/api/admin/settings'),

  saveSettings: (settings: Partial<SiteSettings>) =>
    request<{ ok: boolean; settings: SiteSettings }>('/api/admin/settings', {
      method: 'PUT',
      body: { settings },
    }),

  /* 备份 */
  backups: () => request<{ backups: BackupInfo[]; keep: number }>('/api/admin/backups'),

  createBackup: () =>
    request<{ ok: boolean; backup: BackupInfo }>('/api/admin/backups', { method: 'POST', body: {} }),

  restoreBackup: (id: number) =>
    request<{ ok: boolean; restored: number; from: BackupInfo; total: number }>(
      `/api/admin/backups/${id}/restore`,
      { method: 'POST', body: {} },
    ),

  deleteBackup: (id: number) =>
    request<{ ok: boolean }>(`/api/admin/backups/${id}`, { method: 'DELETE' }),

  /* 审计 */
  audit: (limit = 100) => request<{ items: AuditItem[] }>(`/api/admin/audit?limit=${limit}`),
}

/**
 * 下载类接口要用浏览器导航来触发（响应是附件流，不是 JSON），
 * 这里统一一个函数，免得各处手搓 location.href。
 */
export function downloadUrl(path: string) {
  const link = document.createElement('a')
  link.href = path
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
}

export const backupDownloadUrl = (id: number) => `/api/admin/backups/${id}/download`
export const exportUrl = (format: 'txt' | 'json') => `/api/admin/export?format=${format}`
