<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import FilterPanel from './components/FilterPanel.vue'
import ProfileModal from './components/ProfileModal.vue'
import SearchField from './components/SearchField.vue'
import SongList from './components/SongList.vue'
import ToastHost from './components/ToastHost.vue'
import { copyText } from './composables/useClipboard'
import { useSide } from './composables/useSide'
import { useSongList } from './composables/useSongList'
import { useTheme } from './composables/useTheme'
import { useToast } from './composables/useToast'
import { config } from './config'
import { isPaidSong } from './utils/flags'
import type { Song } from './types'

const {
  songs,
  meta,
  profile,
  status,
  error,
  dataSource,
  displayName,
  hasAnySong,
  hasScSongs,
  query,
  selectedLanguages,
  selectedGenres,
  selectedSingers,
  scOnly,
  activeFilterCount,
  isFiltering,
  filteredSongs,
  languageOptions,
  genreOptions,
  singerOptions,
  scCount,
  load,
  clearFilters,
} = useSongList()

const { theme, toggle: toggleTheme } = useTheme()
const { side, toggleSide } = useSide()
const { show } = useToast()

const text = config.text

const showProfile = ref(false)
const filterOpen = ref(false)
const noticeOpen = ref(false)
/** 手机端向上滚时收起标题/公告，把高度让给列表 */
const compact = ref(false)
const highlightId = ref<number | null>(null)
const listRef = ref<InstanceType<typeof SongList> | null>(null)

const countLabel = computed(() =>
  isFiltering.value
    ? `${filteredSongs.value.length} / ${songs.value.length}`
    : `${songs.value.length}`,
)

/** 背景图：后台没传就用渐变底色 */
const stageBgStyle = computed(() => {
  const url = (meta.value.background ?? '').trim()
  if (!url) return {}
  const position = meta.value.backgroundPosition ?? 'top'
  return {
    backgroundImage: `url("${url}")`,
    backgroundPosition: `center ${position}`,
  }
})

/** 背景视频：有就用视频，背景图退化成它的 poster */
const videoUrl = computed(() => (meta.value.backgroundVideo ?? '').trim())
const posterUrl = computed(() => (meta.value.background ?? '').trim())

/**
 * 什么时候真的放视频：
 * · 后台传了视频
 * · 宽屏（≥1024px）—— 手机上放视频费流量、费电，iOS 还会限制自动播放
 * · 用户没有开「减少动态效果」
 * · 视频本身没出错
 */
const canUseVideo = ref(false)
const videoFailed = ref(false)
/** 视频真的开始播了 —— 用来把兜底的模糊层淡出（否则它会盖住视频） */
const videoReady = ref(false)
const showVideoBg = computed(
  () => Boolean(videoUrl.value) && canUseVideo.value && !videoFailed.value,
)

/**
 * 什么条件下用背景视频：
 * · 宽屏（≥1024px）：用视频
 * · 窄屏：**只有没设背景图时**才用视频兜底 —— 否则手机上就是一片黑
 *   （设了背景图就优先用图，省流量、也避开 iOS 的自动播放限制）
 * · 用户开了「减少动态效果」时一律不用视频
 */
function syncVideoPolicy() {
  if (typeof window === 'undefined') return
  const wide = window.matchMedia('(min-width: 1024px)').matches
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const hasImage = Boolean(posterUrl.value)
  canUseVideo.value = !reduceMotion && (wide || !hasImage)
}

const avatarUrl = computed(() => (profile.value?.avatar ?? '').trim())
const avatarLetter = computed(() => displayName.value.trim().slice(0, 1) || '歌')

/** 有没有「点歌有额外要求」的曲目：有才显示那行中性说明 */
const hasPaidSongs = computed(() => songs.value.some((song) => isPaidSong(song.note)))

/**
 * 公安备案号：后台里允许只填那串数字（很多人拿到手就是纯数字），
 * 这里补上「公网安备 … 号」的规范写法；填了完整文本就原样显示。
 */
const policeText = computed(() => {
  const raw = (meta.value.police ?? '').trim()
  if (!raw) return ''
  return /^[0-9]+$/.test(raw) ? `公网安备 ${raw} 号` : raw
})

/** 查询页要的是纯数字编号；路径必须与公安备案官方给的代码一致 */
const policeUrl = computed(() => {
  const raw = (meta.value.police ?? '').trim()
  const code = raw.replace(/\D/g, '') || raw
  return `https://beian.mps.gov.cn/#/query/webSearch?code=${encodeURIComponent(code)}`
})

watch(displayName, (name) => {
  document.title = `${name}${text.titleSuffix}`
})

// 简介弹窗和 #profile 互相同步，方便直接把简介链接发出去
watch(showProfile, (open) => {
  const url = new URL(window.location.href)
  if (open) url.hash = 'profile'
  else if (url.hash === '#profile') url.hash = ''
  history.replaceState(null, '', url)
})

async function onPick(song: Song) {
  const payload = config.copyTemplate(song)
  const ok = await copyText(payload)
  show(ok ? `已复制：${payload}` : text.copyFailed)
}

/** 随机一首：滚到它、高亮两秒、顺手把点歌文本复制好 */
function pickRandom() {
  const pool = filteredSongs.value
  if (pool.length === 0) return
  const index = Math.floor(Math.random() * pool.length)
  const song = pool[index]
  if (!song) return

  listRef.value?.scrollToIndex(index)
  highlightId.value = song.id
  window.setTimeout(() => {
    if (highlightId.value === song.id) highlightId.value = null
  }, 2400)
  void onPick(song)
}

/** 列表内部滚动 → 手机端折叠头部（往下滚收起，往上滚展开） */
let lastScrollTop = 0
function onListScroll(scrollTop: number) {
  const delta = scrollTop - lastScrollTop
  if (Math.abs(delta) < 8) return
  if (delta > 0 && scrollTop > 48 && !compact.value) compact.value = true
  else if (delta < 0 && compact.value) compact.value = false
  lastScrollTop = scrollTop
}

onMounted(() => {
  document.title = `${displayName.value}${text.titleSuffix}`
  if (window.location.hash === '#profile') showProfile.value = true
  if (status.value === 'idle') void load()

  // 背景视频的启用条件随窗口宽度 / 系统动效偏好变化
  syncVideoPolicy()
  const wideQuery = window.matchMedia('(min-width: 1024px)')
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  wideQuery.addEventListener('change', syncVideoPolicy)
  motionQuery.addEventListener('change', syncVideoPolicy)
  // 数据是异步加载的：背景图/视频到了之后再评估一次
  watch([posterUrl, videoUrl], () => syncVideoPolicy())
})
</script>

<template>
  <div class="stage" :class="{ 'is-compact': compact, 'has-video': showVideoBg }">
    <div class="stage-bg" :class="{ 'is-plain': !stageBgStyle.backgroundImage }" :style="stageBgStyle" />
    <!-- 背景视频：静音 + 自动循环 + 不显示控件；海报用背景图，失败就退回背景图 -->
    <video
      v-if="showVideoBg"
      class="stage-video"
      :src="videoUrl"
      :poster="posterUrl || undefined"
      muted
      loop
      autoplay
      playsinline
      preload="metadata"
      disablepictureinpicture
      data-testid="stage-video"
      @canplay="videoReady = true"
      @error="videoFailed = true"
    />
    <!--
      没有背景图时的兜底：拿头像做一层模糊底图，别让左侧是块死黑。
      注意两点：
      · 有背景图时不渲染（背景图本身就是底）
      · 有视频且视频已经能播时淡出 —— 否则它会盖在视频上面（模糊层在 DOM 里排在后面）
    -->
    <div
      v-if="!stageBgStyle.backgroundImage && avatarUrl"
      class="stage-blur"
      :class="{ 'is-hidden': showVideoBg && videoReady }"
      :style="{ backgroundImage: `url('${avatarUrl}')` }"
    />
    <div class="stage-mask" />

    <main class="side">
      <header class="side-head">
        <div class="brand-row">
          <span class="avatar">
            <img v-if="avatarUrl" :src="avatarUrl" :alt="displayName" />
            <template v-else>{{ avatarLetter }}</template>
          </span>
          <span class="brand-name">{{ displayName }}</span>
          <span class="brand-gap" />

          <a
            v-if="meta.liveUrl"
            class="live-link"
            :href="meta.liveUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            {{ text.liveAction }}
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M7 17 17 7M9 7h8v8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </a>

          <button type="button" class="icon-button" :aria-label="text.profileAction" @click="showProfile = true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="8" r="3.6" />
              <path d="M4.5 20c1.4-3.6 4.2-5.4 7.5-5.4S18.1 16.4 19.5 20" stroke-linecap="round" />
            </svg>
          </button>

          <button
            type="button"
            class="icon-button"
            :aria-label="theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'"
            data-testid="theme-toggle"
            @click="toggleTheme"
          >
            <svg v-if="theme === 'dark'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="4.2" />
              <path
                d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"
                stroke-linecap="round"
              />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" stroke-linejoin="round" />
            </svg>
          </button>
        </div>

        <div class="title-row collapsible">
          <h1>
            歌单<span class="total">{{ countLabel }}</span>
          </h1>
          <button type="button" class="random-button" data-testid="random-pick" @click="pickRandom">
            随机一首
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 7h3l3 5 3-5h3M4 17h3l3-5 3 5h3" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M16 5l4 2-4 2M16 15l4 2-4 2" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>

        <p
          v-if="meta.notice"
          class="notice collapsible"
          :class="{ 'is-open': noticeOpen }"
          data-testid="notice"
          @click="noticeOpen = !noticeOpen"
        >
          <span class="notice-label">{{ text.noticeLabel }}</span>
          <span class="notice-text">{{ meta.notice }}</span>
        </p>

        <!-- 带礼物盒图标的曲目点歌有额外要求；这里只说"额外要求"，不出现付费类字眼 -->
        <p v-if="hasPaidSongs" class="paid-note" data-testid="paid-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M4 10h16v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" stroke-linejoin="round" />
            <path d="M2.5 6.5h19V10h-19z" stroke-linejoin="round" />
            <path d="M12 6.5V20.5" />
            <path
              d="M12 6.5C10.4 6.5 9 5.4 9 4.1S10 1.9 11 1.9s1 1.5 1 4.6zM12 6.5c1.6 0 3-1.1 3-2.4S14 1.9 13 1.9s-1 1.5-1 4.6z"
              stroke-linejoin="round"
            />
          </svg>
          带此图标的曲目点歌有额外要求，详见直播间规则
        </p>

        <div class="tool-row">
          <SearchField v-model="query" :placeholder="text.searchPlaceholder" />

          <div class="filter-anchor">
            <button
              type="button"
              class="filter-button"
              :class="{ 'is-active': activeFilterCount > 0 }"
              data-testid="filter-toggle"
              @click="filterOpen = !filterOpen"
            >
              筛选
              <span v-if="activeFilterCount > 0" class="badge">{{ activeFilterCount }}</span>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 5v14M5 12h14" stroke-linecap="round" />
              </svg>
            </button>

            <FilterPanel
              v-if="filterOpen"
              :languages="selectedLanguages"
              :genres="selectedGenres"
              :singers="selectedSingers"
              :language-options="languageOptions"
              :genre-options="genreOptions"
              :singer-options="singerOptions"
              :sc-only="scOnly"
              :sc-count="scCount"
              :has-sc-songs="hasScSongs"
              @update:languages="selectedLanguages = $event"
              @update:genres="selectedGenres = $event"
              @update:singers="selectedSingers = $event"
              @update:sc-only="scOnly = $event"
              @clear="clearFilters"
              @close="filterOpen = false"
            />
          </div>
        </div>
      </header>

      <div v-if="status === 'loading'" class="state">
        <div class="spinner" />
        <p>{{ text.loadingText }}</p>
      </div>

      <div v-else-if="status === 'error'" class="state">
        <p class="state-title">{{ error?.message ?? '歌单加载失败' }}</p>
        <p>请检查 public{{ config.listUrl }} 是否存在、格式是否正确。</p>
        <button type="button" class="primary-button" @click="load()">{{ text.retry }}</button>
      </div>

      <div v-else-if="!hasAnySong" class="state">
        <p class="state-title">{{ text.emptyListTitle }}</p>
      </div>

      <div v-else-if="filteredSongs.length === 0" class="state">
        <p class="state-title">{{ text.emptyTitle }}</p>
        <p>{{ text.emptyHint }}</p>
        <button type="button" class="primary-button" @click="clearFilters">清空条件</button>
      </div>

      <template v-else>
        <SongList
          ref="listRef"
          :songs="filteredSongs"
          :copy-hint="`单击${text.copyAction}`"
          :show-sc="hasScSongs"
          :highlight-id="highlightId"
          @pick="onPick"
          @scroll="onListScroll"
        />

        <footer class="side-foot">
          <button
            type="button"
            class="side-switch"
            data-testid="side-switch"
            :aria-label="side === 'right' ? '把歌单移到左侧' : '把歌单移到右侧'"
            @click="toggleSide"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path
                v-if="side === 'right'"
                d="M14 6l-6 6 6 6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                v-else
                d="M10 6l6 6-6 6"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>

          <span class="side-foot-hint">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="4" y="4" width="16" height="16" rx="3" />
              <path d="M8 9h8M8 13h5" stroke-linecap="round" />
            </svg>
            单击任意一行即可复制点歌内容
          </span>

          <!-- 页脚只放备案信息；数据来源仍可通过 data-source 属性查（自动化测试用，不上屏） -->
          <span class="side-foot-meta" :data-source="dataSource ?? 'none'">
            <template v-if="meta.icp">
              <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
                {{ meta.icp }}
              </a>
            </template>
            <template v-if="policeText">
              <span v-if="meta.icp" class="meta-sep">·</span>
              <!-- 公安备案的规范要求：备案号可点击，跳到全国互联网安全管理服务平台的查询页；
                   图标（警徽）要放在备案号前面，且一起做成链接 -->
              <a
                :href="policeUrl"
                class="beian-link"
                target="_blank"
                rel="noreferrer"
                data-testid="police-link"
              >
                <img class="beian-icon" src="/beian.png" alt="" width="11" height="13" />
                {{ policeText }}
              </a>
            </template>
          </span>
        </footer>
      </template>
    </main>

    <ProfileModal
      v-if="showProfile"
      :profile="profile"
      :name="displayName"
      :live-url="meta.liveUrl"
      @close="showProfile = false"
    />

    <ToastHost />
  </div>
</template>
