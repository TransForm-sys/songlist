<script setup lang="ts">
/**
 * 筛选面板：把「语种 / 曲风 / 歌手 / SC」收进一个面板。
 * 桌面是从「筛选」按钮下方弹出的浮层，手机是贴底弹层（CSS 里切）。
 *
 * 为什么要收拢：手机上一排三个下拉要占掉一整行，而这个页面真正需要的是列表。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { FacetOption } from '../types'

const props = defineProps<{
  languages: string[]
  genres: string[]
  singers: string[]
  languageOptions: FacetOption[]
  genreOptions: FacetOption[]
  singerOptions: FacetOption[]
  scOnly: boolean
  scCount: number
  hasScSongs?: boolean
}>()

const emit = defineEmits<{
  close: []
  clear: []
  'update:languages': [value: string[]]
  'update:genres': [value: string[]]
  'update:singers': [value: string[]]
  'update:scOnly': [value: boolean]
}>()

const singerQuery = ref('')

/** 歌手可能有几百位，默认只摆前 N 个，其余靠搜索 —— 不然面板里会铺出上千个按钮 */
const SINGER_LIMIT = 60

const matchedSingers = computed(() => {
  const q = singerQuery.value.trim().toLowerCase()
  if (!q) return props.singerOptions
  return props.singerOptions.filter((option) => option.value.toLowerCase().includes(q))
})

const filteredSingers = computed(() =>
  singerQuery.value.trim() ? matchedSingers.value : matchedSingers.value.slice(0, SINGER_LIMIT),
)

const hiddenSingerCount = computed(() => matchedSingers.value.length - filteredSingers.value.length)

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value]
}

const totalSelected = computed(
  () => props.languages.length + props.genres.length + props.singers.length + (props.scOnly ? 1 : 0),
)

// 面板打开期间锁住背景滚动（手机上尤其明显）
onMounted(() => document.body.classList.add('is-filter-open'))
onBeforeUnmount(() => document.body.classList.remove('is-filter-open'))
</script>

<template>
  <div class="filter-scrim" @click="emit('close')" />

  <div class="filter-panel" role="dialog" aria-label="筛选" data-testid="filter-panel">
    <div class="filter-panel-head">
      <b>筛选</b>
      <span class="spacer" />
      <button type="button" class="clear" @click="emit('close')">收起</button>
    </div>

    <div class="filter-panel-body">
      <section class="filter-group">
        <h4>语种</h4>
        <div class="filter-chips">
          <button
            v-for="option in languageOptions"
            :key="option.value"
            type="button"
            class="filter-chip"
            :class="{ 'is-active': languages.includes(option.value) }"
            @click="emit('update:languages', toggle(languages, option.value))"
          >
            {{ option.value }}
            <span class="n">{{ option.count }}</span>
          </button>
        </div>
      </section>

      <section class="filter-group">
        <h4>曲风</h4>
        <div class="filter-chips">
          <button
            v-for="option in genreOptions"
            :key="option.value"
            type="button"
            class="filter-chip"
            :class="{ 'is-active': genres.includes(option.value) }"
            @click="emit('update:genres', toggle(genres, option.value))"
          >
            {{ option.value }}
            <span class="n">{{ option.count }}</span>
          </button>
        </div>
      </section>

      <section class="filter-group">
        <h4>歌手</h4>
        <input
          v-model="singerQuery"
          class="filter-search"
          type="search"
          placeholder="搜歌手…"
          data-testid="filter-singer-search"
        />
        <div class="filter-chips">
          <button
            v-for="option in filteredSingers"
            :key="option.value"
            type="button"
            class="filter-chip"
            :class="{ 'is-active': singers.includes(option.value) }"
            @click="emit('update:singers', toggle(singers, option.value))"
          >
            {{ option.value }}
            <span class="n">{{ option.count }}</span>
          </button>
          <p v-if="filteredSingers.length === 0" class="filter-empty">没有匹配的歌手</p>
          <p v-else-if="hiddenSingerCount > 0" class="filter-empty">
            还有 {{ hiddenSingerCount }} 位歌手，输入关键词搜索
          </p>
        </div>
      </section>

      <!-- 没有 SC 歌曲时整块不出现（备案要求：不出现付费相关字眼） -->
      <section v-if="hasScSongs" class="filter-group">
        <h4>点歌方式</h4>
        <div class="filter-chips">
          <button
            type="button"
            class="filter-chip"
            :class="{ 'is-active': scOnly }"
            data-testid="filter-sc"
            @click="emit('update:scOnly', !scOnly)"
          >
            SC 点歌
            <span class="n">{{ scCount }}</span>
          </button>
        </div>
      </section>
    </div>

    <div class="filter-panel-foot">
      <button type="button" class="clear" data-testid="filter-clear" @click="emit('clear')">
        清空{{ totalSelected ? `（${totalSelected}）` : '' }}
      </button>
      <button type="button" class="done" data-testid="filter-done" @click="emit('close')">完成</button>
    </div>
  </div>
</template>
