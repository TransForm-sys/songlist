<script setup lang="ts">
/**
 * 曲库管理：列表 + 筛选 + 增删改 + 批量操作 + 拖拽排序。
 *
 * 拖拽只在 sort=position（手工顺序）时开放：其他排序下「第几行」是后端排序算出来的，
 * 拖动它没有明确语义，所以直接禁用并给出提示。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import FilterSelect from '../../components/FilterSelect.vue'
import AdminModal from '../components/AdminModal.vue'
import AdminPager from '../components/AdminPager.vue'
import AdminSelect from '../components/AdminSelect.vue'
import AdminSwitch from '../components/AdminSwitch.vue'
import SongEditor from '../components/SongEditor.vue'
import { api, downloadUrl, exportUrl, type AdminSong, type Overview, type SongInput, type SongSort } from '../api'
import { confirmDialog } from '../useConfirm'
import { useAdminToast } from '../useToast'
import { formatBytes } from '../utils'
import type { FacetOption } from '../../types'

const emit = defineEmits<{ navigate: [view: 'import'] }>()

const { show, error } = useAdminToast()

/* ------------------------------ 列表状态 ------------------------------ */

const items = ref<AdminSong[]>([])
const total = ref(0)
const scCount = ref(0)
const facets = reactive<{ language: FacetOption[]; genre: FacetOption[]; singer: FacetOption[] }>({
  language: [],
  genre: [],
  singer: [],
})

const loading = ref(false)
const loadError = ref('')
const overview = ref<Overview | null>(null)

/**
 * 歌单里有没有「需要 SC」的歌。
 * 没有的话，SC 相关的列、筛选开关、统计格、批量改字段全部隐藏 ——
 * 主播不用 SC 点歌时界面上不该出现“SC/礼物”这类字眼（备案审核也看这个）。
 */
const hasScSongs = computed(() => (overview.value?.scSongs ?? 0) > 0)

const filters = reactive({
  q: '',
  language: [] as string[],
  genre: [] as string[],
  singer: [] as string[],
  sc: false,
  isNew: false,
  sort: 'position' as SongSort,
})

const page = ref(1)
const pageSize = ref(50)
const selectedIds = ref<number[]>([])

const sortOptions: { value: SongSort; label: string }[] = [
  { value: 'position', label: '手工顺序' },
  { value: 'title', label: '按歌名' },
  { value: 'singer', label: '按歌手' },
  { value: 'updated', label: '按更新时间' },
  { value: 'created', label: '按创建时间' },
]

const canDrag = computed(() => filters.sort === 'position')

/** 手工顺序下，第一行不能再上移、最后一行不能再下移（避免点了没反应） */
function canMoveUp(index: number) {
  return canDrag.value && !(page.value === 1 && index === 0)
}

function canMoveDown(index: number) {
  return canDrag.value && !(index === items.value.length - 1 && page.value * pageSize.value >= total.value)
}

const activeFilterCount = computed(
  () =>
    filters.language.length +
    filters.genre.length +
    filters.singer.length +
    (filters.sc ? 1 : 0) +
    (filters.isNew ? 1 : 0) +
    (filters.q.trim() ? 1 : 0),
)

const selectedSet = computed(() => new Set(selectedIds.value))
const allChecked = computed(() => items.value.length > 0 && selectedIds.value.length === items.value.length)
const currentIds = computed(() => items.value.map((song) => song.id))

/* ------------------------------ 加载 ------------------------------ */

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await api.songs({
      q: filters.q,
      language: filters.language,
      genre: filters.genre,
      singer: filters.singer,
      sc: filters.sc,
      isNew: filters.isNew,
      page: page.value,
      pageSize: pageSize.value,
      sort: filters.sort,
    })
    items.value = result.items
    total.value = result.total
    scCount.value = result.scCount
    facets.language = result.facets.language
    facets.genre = result.facets.genre
    facets.singer = result.facets.singer
    // 删到最后一页空了就自动回退，避免看到一张空表
    if (result.items.length === 0 && result.total > 0 && page.value > 1) {
      page.value = Math.max(1, Math.ceil(result.total / pageSize.value))
      return
    }
    // 勾选的行如果已经不在当前页，顺手清掉，防止误删看不见的歌
    const visible = new Set(result.items.map((song) => song.id))
    selectedIds.value = selectedIds.value.filter((id) => visible.has(id))
  } catch (err) {
    loadError.value = (err as Error).message
    items.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function loadOverview() {
  try {
    overview.value = await api.overview()
  } catch {
    // 概览只是锦上添花，失败不打断列表
  }
}

/* 搜索防抖 300ms：后端每次都查库 + 算分面，打字时不必每个字符都发一次 */
let searchTimer: number | undefined
watch(
  () => filters.q,
  () => {
    if (searchTimer) window.clearTimeout(searchTimer)
    searchTimer = window.setTimeout(() => {
      page.value = 1
      void load()
    }, 300)
  },
)

// 其余条件立即生效（点击类操作没有连打问题）
watch(
  () => [filters.language, filters.genre, filters.singer, filters.sc, filters.isNew, filters.sort],
  () => {
    page.value = 1
    void load()
  },
  { deep: true },
)

watch([page, pageSize], () => void load())

function clearFilters() {
  filters.q = ''
  filters.language = []
  filters.genre = []
  filters.singer = []
  filters.sc = false
  filters.isNew = false
}

/** 当前筛选下拿全部 id：拖动后要提交完整顺序，跨页也不能漏 */
async function fetchAllIds(): Promise<number[]> {
  const ids: number[] = []
  const size = 500
  let current = 1
  for (;;) {
    const result = await api.songs({
      q: filters.q,
      language: filters.language,
      genre: filters.genre,
      singer: filters.singer,
      sc: filters.sc,
      isNew: filters.isNew,
      page: current,
      pageSize: size,
      sort: filters.sort,
    })
    ids.push(...result.items.map((song) => song.id))
    if (ids.length >= result.total || result.items.length === 0) break
    current++
  }
  return ids
}

/* ------------------------------ 单曲操作 ------------------------------ */

const editorOpen = ref(false)
const editing = ref<AdminSong | null>(null)
const saving = ref(false)

function openCreate() {
  editing.value = null
  editorOpen.value = true
}

function openEdit(song: AdminSong) {
  editing.value = song
  editorOpen.value = true
}

async function submitEditor(input: SongInput) {
  saving.value = true
  try {
    if (editing.value) {
      await api.updateSong(editing.value.id, input)
      show(`已保存「${input.title}」`)
    } else {
      await api.createSong(input)
      show(`已新增「${input.title}」`)
    }
    editorOpen.value = false
    await Promise.all([load(), loadOverview()])
  } catch (err) {
    error((err as Error).message)
  } finally {
    saving.value = false
  }
}

async function removeSong(song: AdminSong) {
  const ok = await confirmDialog({
    title: '删除歌曲',
    message: `确定删除「${song.title}」${song.singer ? ` - ${song.singer}` : ''} 吗？\n删除前后端会自动留一份备份，但这一步在界面上不可撤销。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  try {
    await api.deleteSong(song.id)
    show(`已删除「${song.title}」`)
    await Promise.all([load(), loadOverview()])
  } catch (err) {
    error((err as Error).message)
  }
}

async function move(song: AdminSong, direction: 'up' | 'down') {
  try {
    const result = await api.moveSong(song.id, direction)
    show(result.moved ? `已${direction === 'up' ? '上移' : '下移'}「${song.title}」` : '已经在边界上了')
    await load()
  } catch (err) {
    error((err as Error).message)
  }
}

/* ------------------------------ 多选与批量 ------------------------------ */

function toggleSelect(id: number, checked: boolean) {
  if (checked) {
    if (!selectedSet.value.has(id)) selectedIds.value = [...selectedIds.value, id]
  } else {
    selectedIds.value = selectedIds.value.filter((value) => value !== id)
  }
}

function toggleAll(checked: boolean) {
  selectedIds.value = checked ? [...currentIds.value] : []
}

async function bulkDelete() {
  const count = selectedIds.value.length
  if (!count) return
  const ok = await confirmDialog({
    title: '批量删除',
    message: `确定删除选中的 ${count} 首歌吗？\n删除前后端会自动留一份备份。`,
    confirmText: `删除 ${count} 首`,
    danger: true,
  })
  if (!ok) return
  try {
    const result = await api.bulkDelete(selectedIds.value)
    show(`已删除 ${result.removed} 首`)
    selectedIds.value = []
    await Promise.all([load(), loadOverview()])
  } catch (err) {
    error((err as Error).message)
  }
}

async function bulkPin(mode: 'top' | 'bottom') {
  const count = selectedIds.value.length
  if (!count) return
  try {
    await api.pin(selectedIds.value, mode)
    show(`已把 ${count} 首${mode === 'top' ? '置顶' : '置底'}`)
    await load()
  } catch (err) {
    error((err as Error).message)
  }
}

/* 批量改字段：后端没有批量 patch 接口，这里循环调 PUT 并显示进度 */
const bulkOpen = ref(false)
const bulkForm = reactive({ language: '', genre: '', sc: '', useLanguage: false, useGenre: false, useSc: false })
const bulkProgress = ref({ done: 0, total: 0, running: false })

async function runBulkFields() {
  if (!bulkForm.useLanguage && !bulkForm.useGenre && !bulkForm.useSc) {
    error('请先勾选要修改的字段')
    return
  }
  const ids = [...selectedIds.value]
  if (!ids.length) return

  bulkProgress.value = { done: 0, total: ids.length, running: true }
  const patch: Partial<SongInput> = {}
  if (bulkForm.useLanguage) patch.language = bulkForm.language.trim()
  if (bulkForm.useGenre) patch.genre = bulkForm.genre.trim()
  if (bulkForm.useSc) patch.sc = bulkForm.sc.trim()

  let failed = 0
  for (const id of ids) {
    try {
      await api.updateSong(id, patch)
    } catch {
      failed++
    }
    bulkProgress.value = { ...bulkProgress.value, done: bulkProgress.value.done + 1 }
  }

  bulkProgress.value = { ...bulkProgress.value, running: false }
  if (failed) error(`批量修改完成，其中 ${failed} 首失败`)
  else show(`已修改 ${ids.length} 首`)
  bulkOpen.value = false
  await Promise.all([load(), loadOverview()])
}

/* ------------------------------ 拖拽排序 ------------------------------ */

const dragId = ref<number | null>(null)
const dropTarget = ref<{ id: number; after: boolean } | null>(null)
const reordering = ref(false)

function onDragStart(song: AdminSong, event: DragEvent) {
  if (!canDrag.value) return
  dragId.value = song.id
  // 不加这行 Firefox 不会开始拖
  event.dataTransfer?.setData('text/plain', String(song.id))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(song: AdminSong, event: DragEvent) {
  if (!canDrag.value || dragId.value === null || dragId.value === song.id) return
  // 必须 preventDefault 才允许 drop
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'

  const row = event.currentTarget as HTMLElement
  const rect = row.getBoundingClientRect()
  dropTarget.value = { id: song.id, after: event.clientY > rect.top + rect.height / 2 }
}

function resetDrag() {
  dragId.value = null
  dropTarget.value = null
}

async function onDrop() {
  const from = dragId.value
  const target = dropTarget.value
  resetDrag()
  if (!canDrag.value || from === null || !target) return
  await applyReorder(from, target)
}

/**
 * 触屏上的兜底：HTML5 drag 在移动端基本不触发，
 * 所以「按住行首 ⠿ 220ms 再移动」也走一套 pointer 事件排序。
 */
const pointerDrag = ref<{ id: number; pointerId: number } | null>(null)
let pointerTimer: number | undefined

function onHandleDown(song: AdminSong, event: PointerEvent) {
  // 只处理触摸/触控笔，鼠标继续用原生 drag，免得两套逻辑打架
  if (!canDrag.value || event.pointerType === 'mouse') return
  const target = event.currentTarget as HTMLElement
  const pointerId = event.pointerId
  window.clearTimeout(pointerTimer)
  pointerTimer = window.setTimeout(() => {
    dragId.value = song.id
    dropTarget.value = null
    pointerDrag.value = { id: song.id, pointerId }
    // 抓住指针，页面就不会跟着手指滚动
    try {
      target.setPointerCapture(pointerId)
    } catch {
      /* 某些浏览器不支持，忽略 */
    }
  }, 220)
}

function onHandleMove(event: PointerEvent) {
  if (!pointerDrag.value) {
    // 还在等待长按：手指一动就说明用户其实是想滚动，取消
    window.clearTimeout(pointerTimer)
    return
  }
  event.preventDefault()
  const el = document.elementFromPoint(event.clientX, event.clientY)
  const row = el?.closest('tr[data-testid="song-row"]') as HTMLElement | null
  if (!row || row.dataset.songId === String(pointerDrag.value.id)) return
  const id = Number(row.dataset.songId)
  const rect = row.getBoundingClientRect()
  dropTarget.value = { id, after: event.clientY > rect.top + rect.height / 2 }
}

async function onHandleUp() {
  window.clearTimeout(pointerTimer)
  const pointer = pointerDrag.value
  const target = dropTarget.value
  pointerDrag.value = null
  if (!pointer || !target) {
    resetDrag()
    return
  }
  const from = pointer.id
  resetDrag()
  await applyReorder(from, target)
}

/** 把 from 挪到 target 前/后，先本地重排（手感即时），再提交完整顺序 */
async function applyReorder(from: number, target: { id: number; after: boolean }) {
  if (from === target.id) return
  const ids = items.value.map((song) => song.id)
  if (!ids.includes(from) || !ids.includes(target.id)) return

  const next = moveBeforeOrAfter(ids, from, target.id, target.after)
  if (!next) return

  const map = new Map(items.value.map((song) => [song.id, song]))
  items.value = next.map((id) => map.get(id)!).filter(Boolean)

  reordering.value = true
  try {
    const all = await fetchAllIds()
    const sameSet = all.length === next.length && next.every((id) => all.includes(id))
    // 分页只看了一部分时，把「全局顺序」按本地重排的结果重写：
    // 未在当前页的歌保持它们相对的先后，把当前页的新顺序整体嵌进去
    const ordered = sameSet ? next : mergeOrder(all, next)
    await api.reorder(ordered)
    show('顺序已保存')
  } catch (err) {
    error((err as Error).message)
  } finally {
    reordering.value = false
    await load()
  }
}

/**
 * 纯函数：把 from 移到 target 的前面/后面。
 *
 * 必须先删掉 from 再定位 target 的下标——向下拖时 from 在 target 前面，
 * 删掉之后 target 的下标会左移一位，用原来的下标就会算出「没动」。
 */
function moveBeforeOrAfter(ids: number[], from: number, targetId: number, after: boolean): number[] | null {
  const rest = ids.filter((id) => id !== from)
  const targetIndex = rest.indexOf(targetId)
  if (targetIndex < 0) return null
  const insertAt = after ? targetIndex + 1 : targetIndex
  rest.splice(insertAt, 0, from)
  return rest
}

/**
 * 当前页只是全局顺序的一段：把当前页的新次序替换进全局序列对应位置，
 * 其余歌（其他页）保持相对顺序不变。
 */
function mergeOrder(all: number[], pageOrder: number[]): number[] {
  const positions = pageOrder
    .map((id) => all.indexOf(id))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)
  const result = [...all]
  positions.forEach((position, i) => {
    result[position] = pageOrder[i]!
  })
  return result
}

/* ------------------------------ 其他 ------------------------------ */

async function onExportTxt() {
  downloadUrl(exportUrl('txt'))
  show('已开始下载 list.txt')
}

onMounted(() => {
  void load()
  void loadOverview()
})

onBeforeUnmount(() => {
  if (searchTimer) window.clearTimeout(searchTimer)
})
</script>

<template>
  <div class="adm-view is-dense">
    <!-- 标题 / 总数 / 概览 / 主操作挤成一条，垂直空间全留给表格 -->
    <div class="adm-view-bar">
      <h2 data-testid="view-title">曲库管理</h2>
      <p class="adm-view-total" data-testid="songs-total">
        共 {{ total }} 首{{ activeFilterCount ? ' · 已筛选' : '' }}<template v-if="hasScSongs">
          · SC {{ scCount }} 首</template
        >
      </p>

      <span v-if="overview" class="adm-stat-strip">
        <span class="adm-chip-stat">
          <b class="adm-num">{{ overview.songs }}</b> 总歌曲数
        </span>
        <!-- 歌单里没有 SC 歌曲时，这一格整个不显示 -->
        <span v-if="hasScSongs" class="adm-chip-stat">
          <b class="adm-num">{{ overview.scSongs }}</b> 需要 SC
        </span>
        <span class="adm-chip-stat">
          <b class="adm-num">{{ overview.newSongs }}</b> 新歌标记
        </span>
        <span class="adm-chip-stat">
          <b class="adm-num">{{ overview.singers }}</b> 歌手数
        </span>
        <span class="adm-chip-stat">
          <b class="adm-num">{{ overview.backups }}</b> 备份份数
        </span>
        <span class="adm-chip-stat">
          <b class="adm-num">{{ formatBytes(overview.dbBytes) }}</b> 数据库大小
        </span>
      </span>

      <span class="adm-spacer" />

      <button type="button" class="adm-button is-small" @click="loadOverview">刷新</button>
      <button type="button" class="adm-button is-primary is-small" data-testid="song-new" @click="openCreate">
        ＋ 新增歌曲
      </button>
      <button
        type="button"
        class="adm-button is-small"
        data-testid="song-import-entry"
        @click="emit('navigate', 'import')"
      >
        批量导入
      </button>
      <button type="button" class="adm-button is-small" data-testid="export-txt-top" @click="onExportTxt">
        导出 list.txt
      </button>
    </div>

    <!-- 工具栏 -->
    <section class="adm-card is-dense">
      <div class="adm-toolbar">
        <div class="adm-search">
          <input
            v-model="filters.q"
            class="adm-input"
            type="search"
            data-testid="songs-search"
            placeholder="搜索歌名 / 歌手，支持拼音（dukou、dk、渡口）"
          />
          <button
            v-if="filters.q"
            type="button"
            class="adm-search-clear"
            aria-label="清空搜索"
            @click="filters.q = ''"
          >
            ✕
          </button>
        </div>

        <AdminSelect
          v-model="filters.sort"
          :options="sortOptions.map((option) => ({ value: option.value, label: `排序：${option.label}` }))"
          testid="songs-sort"
        />
      </div>

      <div class="adm-toolbar" style="margin-top: 8px">
        <FilterSelect v-model="filters.language" label="语种" :options="facets.language" testid="filter-language" />
        <FilterSelect v-model="filters.genre" label="曲风" :options="facets.genre" testid="filter-genre" />
        <FilterSelect
          v-model="filters.singer"
          label="歌手"
          :options="facets.singer"
          searchable
          testid="filter-singer"
        />

        <AdminSwitch v-if="hasScSongs" v-model="filters.sc" label="SC 点歌" testid="filter-sc" />
        <AdminSwitch v-model="filters.isNew" label="只看新歌" testid="filter-isnew" />

        <button
          v-if="activeFilterCount"
          type="button"
          class="adm-button is-small"
          data-testid="filters-clear"
          @click="clearFilters"
        >
          清空条件
        </button>
      </div>
    </section>

    <p class="adm-hint is-tight">
      {{
        canDrag
          ? '手工顺序：拖动行首 ⠿ 调整顺序，松手即保存；也可用行内 ↑ ↓ 微调。'
          : '非手工顺序：拖拽与 ↑ ↓ 已禁用，切回「排序：手工顺序」后才能调整。'
      }}
    </p>

    <!-- 批量操作条 -->
    <section v-if="selectedIds.length" class="adm-card is-compact">
      <div class="adm-toolbar">
        <strong>已选 {{ selectedIds.length }} 首</strong>
        <button type="button" class="adm-button is-small" @click="bulkPin('top')">置顶</button>
        <button type="button" class="adm-button is-small" @click="bulkPin('bottom')">置底</button>
        <button type="button" class="adm-button is-small" @click="bulkOpen = true">批量改字段</button>
        <button type="button" class="adm-button is-small is-danger" data-testid="bulk-delete" @click="bulkDelete">
          批量删除
        </button>
        <span class="adm-spacer" />
        <button type="button" class="adm-button is-small is-ghost" @click="selectedIds = []">取消选择</button>
      </div>
    </section>

    <!-- 列表 -->
    <div v-if="loading" class="adm-loading">
      <span class="adm-spinner" />
      正在加载…
    </div>

    <div v-else-if="loadError" class="adm-card">
      <p class="adm-error-text">{{ loadError }}</p>
      <button type="button" class="adm-button is-small" style="margin-top: 10px" @click="load">重试</button>
    </div>

    <template v-else>
      <div class="adm-table-wrap">
        <table class="adm-table">
          <thead>
            <tr>
              <th class="adm-col-select">
                <input
                  class="adm-checkbox"
                  type="checkbox"
                  data-testid="select-all"
                  :checked="allChecked"
                  :aria-label="allChecked ? '取消全选' : '全选本页'"
                  @change="toggleAll(($event.target as HTMLInputElement).checked)"
                />
              </th>
              <th class="adm-col-drag">序</th>
              <th class="adm-col-title">歌名</th>
              <th class="adm-col-singer">歌手</th>
              <th class="adm-col-lang">语种</th>
              <th class="adm-col-genre">曲风</th>
              <th v-if="hasScSongs" class="adm-col-sc">需要 SC</th>
              <th class="adm-col-note">备注</th>
              <th class="adm-col-new">新歌</th>
              <th class="adm-col-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(song, index) in items"
              :key="song.id"
              data-testid="song-row"
              :data-song-id="song.id"
              :class="{
                'is-selected': selectedSet.has(song.id),
                'is-dragging': dragId === song.id,
                'is-drop-before': dropTarget?.id === song.id && !dropTarget.after,
                'is-drop-after': dropTarget?.id === song.id && dropTarget.after,
              }"
              :draggable="canDrag"
              @dragstart="onDragStart(song, $event)"
              @dragover="onDragOver(song, $event)"
              @dragend="resetDrag"
              @drop.prevent="onDrop"
            >
              <td>
                <input
                  class="adm-checkbox"
                  type="checkbox"
                  data-testid="song-select"
                  :checked="selectedSet.has(song.id)"
                  :aria-label="`选择 ${song.title}`"
                  @change="toggleSelect(song.id, ($event.target as HTMLInputElement).checked)"
                />
              </td>
              <td>
                <button
                  type="button"
                  class="adm-drag-handle"
                  draggable="false"
                  :disabled="!canDrag"
                  :title="canDrag ? '拖动调整顺序（触屏：按住 ⠿ 再移动）' : '只有手工顺序可以拖动'"
                  @mousedown.stop
                  @pointerdown.stop="onHandleDown(song, $event)"
                  @pointermove="onHandleMove($event)"
                  @pointerup="onHandleUp"
                  @pointercancel="onHandleUp"
                >
                  ⠿
                </button>
                <span class="adm-hint adm-num">{{ (page - 1) * pageSize + index + 1 }}</span>
              </td>
              <td class="adm-cell-title">
                <span class="adm-ellipsis" :title="song.title">{{ song.title }}</span>
              </td>
              <td class="adm-cell-singer">
                <span class="adm-ellipsis" :title="song.singer">{{ song.singer || '—' }}</span>
              </td>
              <td>{{ song.language || '—' }}</td>
              <td>{{ song.genre || '—' }}</td>
              <td v-if="hasScSongs">
                <span v-if="song.sc" class="adm-badge is-sc">{{ song.sc }}</span>
                <span v-else class="adm-hint">—</span>
              </td>
              <td class="adm-cell-note"><span class="adm-ellipsis" :title="song.note">{{ song.note || '—' }}</span></td>
              <td>
                <span v-if="song.isNew" class="adm-badge is-new">新</span>
                <span v-else class="adm-hint">—</span>
              </td>
              <td class="adm-col-actions">
                <div class="adm-cell-actions">
                  <button type="button" class="adm-button is-small" data-testid="song-edit" @click="openEdit(song)">
                    编辑
                  </button>
                  <span class="adm-move-group">
                    <button
                      type="button"
                      class="adm-button is-small is-icon"
                      :disabled="!canMoveUp(index)"
                      title="上移一格"
                      @click="move(song, 'up')"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      class="adm-button is-small is-icon"
                      :disabled="!canMoveDown(index)"
                      title="下移一格"
                      @click="move(song, 'down')"
                    >
                      ↓
                    </button>
                  </span>
                  <button
                    type="button"
                    class="adm-button is-small is-danger"
                    data-testid="song-delete"
                    @click="removeSong(song)"
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>

        <p v-if="!items.length" class="adm-empty">
          {{ activeFilterCount ? '没有符合条件的歌曲，试试清空筛选条件' : '曲库还是空的，先「新增歌曲」或去「批量导入」' }}
        </p>
      </div>

      <AdminPager v-model:page="page" v-model:page-size="pageSize" :total="total" />

      <p v-if="reordering" class="adm-hint">正在提交新的顺序…</p>
    </template>

    <!-- 新增 / 编辑 -->
    <AdminModal
      v-if="editorOpen"
      testid="song-form"
      :title="editing ? `编辑：${editing.title}` : '新增歌曲'"
      @close="editorOpen = false"
    >
      <SongEditor
        :song="editing"
        :saving="saving"
        :show-sc="hasScSongs"
        @submit="submitEditor"
        @cancel="editorOpen = false"
      />
    </AdminModal>

    <!-- 批量改字段 -->
    <AdminModal v-if="bulkOpen" testid="bulk-form" title="批量修改字段" @close="bulkOpen = false">
      <div class="adm-bulk-field">
        <AdminSwitch v-model="bulkForm.useLanguage" label="修改语种" />
        <input
          v-model="bulkForm.language"
          class="adm-input"
          type="text"
          placeholder="新的语种，例如 中文"
          :disabled="!bulkForm.useLanguage"
        />
      </div>

      <div class="adm-bulk-field">
        <AdminSwitch v-model="bulkForm.useGenre" label="修改曲风" />
        <input
          v-model="bulkForm.genre"
          class="adm-input"
          type="text"
          placeholder="新的曲风，例如 中文流行"
          :disabled="!bulkForm.useGenre"
        />
      </div>

      <div v-if="hasScSongs" class="adm-bulk-field">
        <AdminSwitch v-model="bulkForm.useSc" label="修改「需要 SC」" />
        <input
          v-model="bulkForm.sc"
          class="adm-input"
          type="text"
          placeholder="礼物名；留空表示改成普通点歌"
          :disabled="!bulkForm.useSc"
        />
      </div>

      <p class="adm-hint">
        后端没有批量改字段的接口，这里会对选中的 {{ selectedIds.length }} 首逐条调用
        PUT，下面会显示进度。留空即把该字段清空。
      </p>

      <div v-if="bulkProgress.total" class="adm-hint">
        进度：{{ bulkProgress.done }} / {{ bulkProgress.total }}
      </div>

      <template #footer>
        <button type="button" class="adm-button" :disabled="bulkProgress.running" @click="bulkOpen = false">
          取消
        </button>
        <button
          type="button"
          class="adm-button is-primary"
          :disabled="bulkProgress.running"
          @click="runBulkFields"
        >
          {{ bulkProgress.running ? '正在修改…' : '开始修改' }}
        </button>
      </template>
    </AdminModal>
  </div>
</template>
