<script setup lang="ts">
/**
 * 后台表格里用的开关。原生 checkbox 在暗色主题下样式太散，
 * 这里做成一个受控按钮，保持 :active 状态可读。
 */
defineProps<{ modelValue: boolean; label: string; disabled?: boolean; testid?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <button
    type="button"
    class="adm-switch"
    :class="{ 'is-on': modelValue }"
    :disabled="disabled"
    :data-testid="testid || undefined"
    role="switch"
    :aria-checked="modelValue"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span class="adm-switch-track"><span class="adm-switch-thumb" /></span>
    <span class="adm-switch-label">{{ label }}</span>
  </button>
</template>
