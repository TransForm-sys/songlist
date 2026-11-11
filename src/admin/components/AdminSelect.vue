<script setup lang="ts">
/**
 * 后台用的下拉选择器。
 *
 * 为什么不用原生 <select>：它弹出来的选项列表是操作系统/浏览器绘制的，
 * 既吃不到主题变量，也不受 data-theme 控制 —— 深色后台里会弹出一个白底菜单。
 * 这里自己画一个，样式与前台筛选器一致。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

export interface AdminSelectOption {
  value: string | number
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number
    options: AdminSelectOption[]
    /** 选项往哪个方向展开；底部（分页器）用 top 免得被页面边缘挡住 */
    placement?: 'bottom' | 'top'
    testid?: string
    ariaLabel?: string
  }>(),
  { placement: 'bottom' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)

const currentLabel = computed(
  () => props.options.find((option) => option.value === props.modelValue)?.label ?? '',
)

function pick(value: string | number) {
  emit('update:modelValue', value)
  open.value = false
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') open.value = false
}

// 点击组件外部时收起（用 backdrop 也行，但监听 document 更省 DOM）
function onDocumentClick(event: MouseEvent) {
  if (!open.value) return
  if (root.value && !root.value.contains(event.target as Node)) open.value = false
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('click', onDocumentClick, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.removeEventListener('click', onDocumentClick, true)
})
</script>

<template>
  <div ref="root" class="adm-dropdown">
    <button
      type="button"
      class="adm-select adm-dropdown-trigger"
      :class="{ 'is-open': open }"
      :data-testid="testid"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="adm-dropdown-label">{{ currentLabel }}</span>
      <svg class="adm-dropdown-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>

    <div
      v-if="open"
      class="adm-dropdown-panel"
      :class="`is-${placement}`"
      role="listbox"
    >
      <button
        v-for="option in options"
        :key="option.value"
        type="button"
        class="adm-dropdown-item"
        :class="{ 'is-active': option.value === modelValue }"
        role="option"
        :aria-selected="option.value === modelValue"
        @click="pick(option.value)"
      >
        {{ option.label }}
      </button>
    </div>
  </div>
</template>
