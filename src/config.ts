/**
 * 站点级配置。改这里就能换数据源、文案和点歌格式，不用动组件。
 */
export const config = {
  /** 后端接口地址；拿不到时会自动回退到下面的静态文件 */
  api: {
    songsUrl: '/api/songs',
    profileUrl: '/api/profile',
    /** 接口等待时间；超过就当后端不在，直接读静态文件 */
    timeoutMs: 6000,
  },
  /** 歌单数据文件（纯静态部署时用），放在 public/ 下 */
  listUrl: '/list.txt',
  /** 主播简介，放在 public/ 下；文件不存在时会静默降级为「无简介」 */
  profileUrl: '/profile.json',
  /** 加载超时（毫秒） */
  timeoutMs: 10000,
  /** 主题在 localStorage 里的键，与原站保持一致 */
  themeStorageKey: 'vtuber-song-list:theme',

  /** 页面文案 */
  text: {
    siteTitle: '歌单',
    /** 标题后缀，最终显示成「XXX 的歌单」 */
    titleSuffix: '的歌单',
    searchPlaceholder: '搜索歌名 / 歌手，支持拼音（如 dukou、渡口）',
    copyAction: '点歌',
    copyDone: '已复制，粘贴到直播间就能点歌',
    copyFailed: '复制失败，请手动复制歌名',
    profileAction: '主播简介',
    emptyTitle: '没有找到符合条件的歌',
    emptyHint: '试试清空搜索或筛选条件',
    emptyListTitle: '当前歌单还没有可用歌曲',
    retry: '重试',
    loadingText: '正在加载歌单…',
    noticeLabel: '公告',
    /** 头部右上角的直播间入口 */
    liveAction: '直播间',
    /** 标题行右侧的随机选歌 */
    randomAction: '随机一首',
    /** 工具行的筛选入口 */
    filterLabel: '筛选',
  },

  /**
   * 单击歌名时复制到剪贴板的内容 —— 这是整站唯一决定「点歌文本长什么样」的地方。
   *
   * 当前格式：`点歌 阿刁`
   *   · 「点歌」后面是**半角空格**，不是全角冒号
   *     （直播间的点歌机按 `点歌 ` 这个前缀识别，用 `点歌：` 会识别不到）
   *   · **只带歌名，不带歌手** —— 点歌机按歌名匹配，带歌手会认不出来
   *   · 万一某首歌有 SC 标记（本项目当前没有），末尾才补礼物名
   *
   * 换点歌机 / 换识别规则时，只改这一行即可。
   */
  copyTemplate(song: { title: string; singer: string; sc: string }): string {
    const sc = song.sc ? `（${song.sc}）` : ''
    return `点歌 ${song.title}${sc}`
  },
} as const
