import { onBeforeUnmount, onMounted, ref, computed, unref, type Ref } from 'vue'

interface Options {
  /**
   * 行高必须固定，虚拟滚动才能只靠算术定位。
   * 传 ref 是为了跟随响应式断点（桌机 48px / 手机 52px）。
   */
  rowHeight: number | Ref<number>
  /** 视口上下各多渲染几行，滚动时不容易露白 */
  overscan?: number
}

interface VirtualRow<T> {
  item: T
  index: number
  offset: number
}

/**
 * 极简固定行高虚拟列表：只用 scrollTop + 视口高度算可见区间，
 * 784 首歌也只渲染二十来行 DOM。
 */
export function useVirtualList<T>(source: Ref<T[]>, options: Options) {
  const overscan = options.overscan ?? 6
  const rowHeightRef = computed(() => {
    const value = unref(options.rowHeight)
    return value > 0 ? value : 48
  })
  const containerRef = ref<HTMLElement | null>(null)
  const scrollTop = ref(0)
  const viewportHeight = ref(600)

  const totalHeight = computed(() => source.value.length * rowHeightRef.value)

  const startIndex = computed(() =>
    Math.max(0, Math.floor(scrollTop.value / rowHeightRef.value) - overscan),
  )

  const endIndex = computed(() =>
    Math.min(
      source.value.length,
      Math.ceil((scrollTop.value + viewportHeight.value) / rowHeightRef.value) + overscan,
    ),
  )

  const rows = computed<VirtualRow<T>[]>(() => {
    const out: VirtualRow<T>[] = []
    for (let i = startIndex.value; i < endIndex.value; i++) {
      const item = source.value[i]
      if (item === undefined) continue
      out.push({ item, index: i, offset: i * rowHeightRef.value })
    }
    return out
  })

  function onScroll() {
    const el = containerRef.value
    if (el) scrollTop.value = el.scrollTop
  }

  function scrollToTop() {
    const el = containerRef.value
    if (el) {
      el.scrollTop = 0
      scrollTop.value = 0
    }
  }

  /**
   * 滚到第 index 行并居中（「随机一首」用）。
   * 固定行高下这就是一道算术题，不用去查询 DOM 位置。
   */
  function scrollToIndex(index: number, align: 'start' | 'center' = 'center') {
    const el = containerRef.value
    if (!el) return
    const rowHeight = rowHeightRef.value
    const raw = index * rowHeight
    const target =
      align === 'center'
        ? raw - Math.max(0, (el.clientHeight - rowHeight) / 2)
        : raw
    el.scrollTop = Math.max(0, target)
    scrollTop.value = el.scrollTop
  }

  let observer: ResizeObserver | undefined

  onMounted(() => {
    const el = containerRef.value
    if (!el) return
    viewportHeight.value = el.clientHeight
    observer = new ResizeObserver(() => {
      viewportHeight.value = el.clientHeight
    })
    observer.observe(el)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
  })

  return { containerRef, rows, totalHeight, onScroll, scrollToTop, scrollToIndex }
}
