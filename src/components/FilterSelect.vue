<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { FacetOption } from '../types'

const props = withDefaults(
  defineProps<{
    label: string
    options: FacetOption[]
    modelValue: string[]
    /** 选项多的时候（比如歌手）在面板里给个搜索框 */
    searchable?: boolean
    /** 透传到触发按钮上的 data-testid，方便自动化测试稳定选中 */
    testid?: string
  }>(),
  { searchable: false, testid: '' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()

const open = ref(false)
const keyword = ref('')
const searchInput = ref<HTMLInputElement | null>(null)

const selected = computed(() => new Set(props.modelValue))
const selectedCount = computed(() => props.modelValue.length)

const triggerLabel = computed(() => {
  const n = selectedCount.value
  if (n === 0) return props.label
  if (n === 1) return props.modelValue[0]!
  return `${props.label} · ${n}`
})

const showSearch = computed(() => props.searchable || props.options.length > 12)

const visibleOptions = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.options
  return props.options.filter((option) => option.value.toLowerCase().includes(kw))
})

function toggle(value: string) {
  const next = new Set(props.modelValue)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  emit('update:modelValue', Array.from(next))
}

function clear() {
  emit('update:modelValue', [])
}

function selectAllVisible() {
  const next = new Set(props.modelValue)
  for (const option of visibleOptions.value) next.add(option.value)
  emit('update:modelValue', Array.from(next))
}

async function togglePanel() {
  open.value = !open.value
  if (!open.value) return
  keyword.value = ''
  if (showSearch.value) {
    await nextTick()
    searchInput.value?.focus()
  }
}

watch(
  () => props.options.length,
  (n) => {
    if (n === 0) open.value = false
  },
)
</script>

<template>
  <div class="select">
    <button
      type="button"
      class="select-trigger"
      :class="{ 'is-open': open, 'is-active': selectedCount > 0 }"
      :data-testid="props.testid || undefined"
      :aria-expanded="open"
      @click.stop="togglePanel"
      @keydown.esc="open = false"
    >
      <span class="label">{{ triggerLabel }}</span>
      <svg class="caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <div v-if="open" class="select-backdrop" @click="open = false" />

    <div v-if="open" class="select-panel" @keydown.esc="open = false">
      <div v-if="showSearch" class="select-search">
        <input ref="searchInput" v-model="keyword" type="search" :placeholder="`搜索${label}`" />
      </div>

      <div class="select-options">
        <button
          v-for="option in visibleOptions"
          :key="option.value"
          type="button"
          class="select-option"
          :class="{ 'is-selected': selected.has(option.value) }"
          @click="toggle(option.value)"
        >
          <svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path
              v-if="selected.has(option.value)"
              d="M20 6 9 17l-5-5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <rect v-else x="3.5" y="3.5" width="17" height="17" rx="3" />
          </svg>
          <span class="text">{{ option.value }}</span>
          <span class="count">{{ option.count }}</span>
        </button>

        <p v-if="visibleOptions.length === 0" class="select-empty">
          {{ keyword ? '没有匹配选项' : '暂无可选项' }}
        </p>
      </div>

      <div class="select-footer">
        <button type="button" @click="clear">清空</button>
        <button type="button" @click="selectAllVisible">全选当前</button>
        <button type="button" @click="open = false">完成</button>
      </div>
    </div>
  </div>
</template>
