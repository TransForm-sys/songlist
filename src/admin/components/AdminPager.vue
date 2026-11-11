<script setup lang="ts">
import { computed } from 'vue'
import AdminSelect from './AdminSelect.vue'

const props = defineProps<{
  page: number
  pageSize: number
  total: number
  pageSizes?: number[]
}>()

const emit = defineEmits<{
  'update:page': [value: number]
  'update:pageSize': [value: number]
}>()

const sizes = computed(() => props.pageSizes ?? [20, 50, 100, 200])
const pageCount = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
/** 当前页展示的是第几条到第几条，空列表时给 0-0 */
const from = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1))
const to = computed(() => Math.min(props.total, props.page * props.pageSize))

function go(next: number) {
  const clamped = Math.min(pageCount.value, Math.max(1, next))
  if (clamped !== props.page) emit('update:page', clamped)
}

/** 换了每页条数后原页码可能越界，回到第一页最不容易让人迷惑 */
function changeSize(value: number) {
  emit('update:pageSize', value)
  emit('update:page', 1)
}
</script>

<template>
  <div class="adm-pager">
    <span class="adm-pager-info">
      共 {{ total }} 首 · 当前 {{ from }}–{{ to }} · 第 {{ page }} / {{ pageCount }} 页
    </span>

    <div class="adm-pager-controls">
      <AdminSelect
        :model-value="pageSize"
        :options="sizes.map((size) => ({ value: size, label: `每页 ${size} 条` }))"
        placement="top"
        testid="page-size"
        aria-label="每页条数"
        @update:model-value="changeSize(Number($event))"
      />

      <button type="button" class="adm-button is-small" :disabled="page <= 1" @click="go(1)">首页</button>
      <button type="button" class="adm-button is-small" :disabled="page <= 1" @click="go(page - 1)">
        上一页
      </button>
      <button
        type="button"
        class="adm-button is-small"
        data-testid="page-next"
        :disabled="page >= pageCount"
        @click="go(page + 1)"
      >
        下一页
      </button>
      <button type="button" class="adm-button is-small" :disabled="page >= pageCount" @click="go(pageCount)">
        末页
      </button>
    </div>
  </div>
</template>
