import { onMounted, ref } from 'vue'

export type Side = 'left' | 'right'

const STORAGE_KEY = 'vtuber-song-list:side'

function readSide(): Side {
  try {
    // ?side=left / ?side=right 可以强制指定（分享链接用）
    const forced = new URLSearchParams(window.location.search).get('side')
    if (forced === 'left' || forced === 'right') return forced
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'left' || saved === 'right') return saved
    const preset = document.documentElement.dataset.side
    if (preset === 'left' || preset === 'right') return preset
  } catch {
    /* 隐私模式下 localStorage 会抛，忽略即可 */
  }
  return 'right'
}

/**
 * 歌单在左侧还是右侧。
 * 首屏由 index.html 里的内联脚本先写好 data-side，这里只负责后续切换与持久化，
 * 这样刷新时不会看到侧栏"跳"一下。
 */
export function useSide() {
  const side = ref<Side>(readSide())

  function apply(next: Side) {
    document.documentElement.dataset.side = next
  }

  function setSide(next: Side) {
    side.value = next
    apply(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* 存不了就算了，不影响本次浏览 */
    }
  }

  function toggleSide() {
    setSide(side.value === 'right' ? 'left' : 'right')
  }

  onMounted(() => {
    // 内联脚本可能因为 ?side= 或旧版本数据没设过，这里补一次
    if (document.documentElement.dataset.side !== side.value) apply(side.value)
  })

  return { side, setSide, toggleSide }
}
