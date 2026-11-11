<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useVirtualList } from '../composables/useVirtualList'
import { isPaidSong } from '../utils/flags'
import type { Song } from '../types'

const props = defineProps<{
  songs: Song[]
  copyHint: string
  showSc?: boolean
  /** 刚被「随机一首」选中的歌，短暂高亮 */
  highlightId?: number | null
}>()

const emit = defineEmits<{
  pick: [song: Song]
  scroll: [scrollTop: number]
}>()

/** 行高由 CSS 变量控制（桌面 76 / 手机 72），这里读出来喂给虚拟列表 */
const rowHeight = ref(76)
const source = computed(() => props.songs)

function syncRowHeight() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--row-height')
  const value = Number.parseFloat(raw)
  if (Number.isFinite(value) && value > 0) rowHeight.value = value
}

const { containerRef, rows, totalHeight, onScroll, scrollToTop, scrollToIndex } = useVirtualList(
  source,
  { rowHeight, overscan: 8 },
)

// 换了搜索/筛选条件后回到列表顶部
watch(source, () => scrollToTop())

function handleScroll() {
  onScroll()
  const el = containerRef.value
  if (el) emit('scroll', el.scrollTop)
}

/** 行首序号：001 / 002，跟原站一致 */
function padIndex(index: number) {
  return String(index + 1).padStart(3, '0')
}

onMounted(() => {
  syncRowHeight()
  window.addEventListener('resize', syncRowHeight)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', syncRowHeight)
})

defineExpose({ scrollToTop, scrollToIndex })
</script>

<template>
  <div ref="containerRef" class="list-viewport" @scroll.passive="handleScroll">
    <div class="list-canvas" :style="{ height: `${totalHeight}px` }">
      <div
        v-for="row in rows"
        :key="row.item.id"
        class="song-row"
        :class="{ 'is-active': highlightId === row.item.id }"
        :style="{ transform: `translateY(${row.offset}px)` }"
        tabindex="0"
        role="button"
        :aria-label="`点歌 ${row.item.title}`"
        :data-song-id="row.item.id"
        @click="emit('pick', row.item)"
        @keydown.enter.prevent="emit('pick', row.item)"
        @keydown.space.prevent="emit('pick', row.item)"
      >
        <span class="row-index">{{ padIndex(row.index) }}</span>

        <span class="row-main">
          <span class="row-title">
            {{ row.item.title }}
            <!-- 需要额外条件的曲目：只给图标，不给文字（页面上不出现付费类字眼） -->
            <span
              v-if="isPaidSong(row.item.note)"
              class="row-paid"
              role="img"
              aria-label="点歌有额外要求"
              title="点歌有额外要求"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
                <path d="M4 10h16v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" stroke-linejoin="round" />
                <path d="M2.5 6.5h19V10h-19z" stroke-linejoin="round" />
                <path d="M12 6.5V20.5" />
                <path
                  d="M12 6.5C10.4 6.5 9 5.4 9 4.1S10 1.9 11 1.9s1 1.5 1 4.6zM12 6.5c1.6 0 3-1.1 3-2.4S14 1.9 13 1.9s-1 1.5-1 4.6z"
                  stroke-linejoin="round"
                />
              </svg>
            </span>
            <span v-if="row.item.isNew" class="new-badge">新</span>
            <span v-if="showSc && row.item.sc" class="tag sc" :title="row.item.sc">SC</span>
          </span>
          <span class="row-sub">
            <template v-if="row.item.singer">{{ row.item.singer }}</template>
            <template v-if="row.item.singer && row.item.language"><span class="dot">·</span></template>
            <template v-if="row.item.language">{{ row.item.language }}</template>
            <template v-if="(row.item.singer || row.item.language) && row.item.genre">
              <span class="dot">·</span>
            </template>
            <template v-if="row.item.genre">{{ row.item.genre }}</template>
          </span>
        </span>

        <span class="row-copy-hint">{{ copyHint }}</span>
      </div>
    </div>
  </div>
</template>
