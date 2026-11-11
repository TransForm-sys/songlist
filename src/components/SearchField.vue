<script setup lang="ts">
defineProps<{
  modelValue: string
  placeholder: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  submit: []
}>()
</script>

<template>
  <div class="search-field">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" stroke-linecap="round" />
    </svg>

    <input
      :value="modelValue"
      type="search"
      enterkeyhint="search"
      autocomplete="off"
      autocorrect="off"
      :placeholder="placeholder"
      @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
      @keydown.enter="emit('submit')"
    />

    <button
      v-if="modelValue"
      type="button"
      class="clear"
      aria-label="清空搜索"
      @click="emit('update:modelValue', '')"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 6l12 12M18 6 6 18" stroke-linecap="round" />
      </svg>
    </button>
  </div>
</template>
