<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

const props = withDefaults(
  defineProps<{ title: string; wide?: boolean; testid?: string }>(),
  { wide: false, testid: 'admin-modal' },
)
const emit = defineEmits<{ close: [] }>()

// Esc 关闭是后台表单弹窗的基本期待，挂到 window 上比等焦点更可靠
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  // 弹窗打开时锁住背后的滚动，移动端尤其明显
  document.body.style.overflow = 'hidden'
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <div class="adm-overlay" @click.self="emit('close')">
      <div
        class="adm-modal"
        :class="{ 'is-wide': props.wide }"
        :data-testid="props.testid"
        role="dialog"
        aria-modal="true"
      >
        <header class="adm-modal-head">
          <h3>{{ title }}</h3>
          <button type="button" class="adm-icon-button" aria-label="关闭" @click="emit('close')">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 6l12 12M18 6 6 18" stroke-linecap="round" />
            </svg>
          </button>
        </header>

        <div class="adm-modal-body">
          <slot />
        </div>

        <footer v-if="$slots.footer" class="adm-modal-foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>
