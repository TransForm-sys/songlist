/** 一首歌。字段全部来自 list.txt 的一行。 */
export interface Song {
  /** 稳定 id（行内递增，用于虚拟列表 key） */
  id: number
  /** 第一列的「新」标记：新歌 / 最近更新 */
  isNew: boolean
  /** 歌名 */
  title: string
  /** 歌手（可能用 / 分隔的多人） */
  singer: string
  /** 语种，如 中文 / 日语 / 粤语 */
  language: string
  /** 曲风，如 中文流行 / VOCALOID / アニメ */
  genre: string
  /** 需要 SC 的礼物名，空字符串表示普通点歌 */
  sc: string
  /** 备注 */
  note: string
}

/** list.txt 顶部两行附带的信息，或后端 settings 返回的信息 */
export interface SongListMeta {
  /** 主播名（A1） */
  streamerName: string
  /** 直播间链接（A2） */
  liveUrl: string
  /** 公告，来自后台「站点设置」 */
  notice?: string
  /** ICP 备案号，来自后台「站点设置」 */
  icp?: string
  /** 公安备案号，来自后台「站点设置」 */
  police?: string
  /** 全屏背景图（站内相对路径）；空/未填时前台用渐变底色 */
  background?: string
  /** 背景图焦点：top / center / bottom */
  backgroundPosition?: 'top' | 'center' | 'bottom'
  /** 背景视频（.mp4/.webm，站内相对路径）；填了就优先用视频当背景 */
  backgroundVideo?: string
}

/** 前台数据从哪来：后端接口 / 静态文件 */
export type DataSource = 'api' | 'static' | null

export interface ParsedSongList {
  meta: SongListMeta
  songs: Song[]
  /** 解析过程中被跳过的行数（空行除外），用于诊断表格问题 */
  skippedRows: number
}

/** 主播简介弹窗里的一块内容 */
export type ProfileBlock =
  | { type: 'notice'; title?: string; content: string }
  | { type: 'text'; title?: string; content: string }
  | { type: 'list'; title?: string; items: string[] }
  | { type: 'kv'; title?: string; items: { label: string; value: string }[] }

export interface ProfileLink {
  label: string
  url: string
}

/** profile.json 的结构，与线上实例保持一致，另加了两个可选字段 */
export interface Profile {
  title?: string
  bio?: string
  tags?: string[]
  links?: ProfileLink[]
  blocks?: ProfileBlock[]
  /** 扩展字段：头像图片地址；不填则用主播名首字生成占位头像 */
  avatar?: string
  /** 扩展字段：简介弹窗顶部封面图地址 */
  cover?: string
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error'

export interface LoadError {
  kind: 'timeout' | 'format' | 'empty' | 'http' | 'network'
  message: string
  status?: number
}

/** 一个筛选项及其命中数量 */
export interface FacetOption {
  value: string
  count: number
}
