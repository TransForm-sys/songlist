<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { confirmState, settleConfirm } from '../useConfirm'

const state = confirmState
const typed = ref('')

// 换了一张确认框就把强确认的输入清空，否则上一张的输入会「继承」过来
watch(
  () => state.value?.title,
  () => {
    typed.value = ''
  },
)

const phraseOk = computed(() => {
  const expected = state.value?.expectedText
  if (!expected) return true
  return typed.value.trim() === expected
})
</script>

<template>
  <Teleport to="body">
    <div v-if="state" class="adm-overlay" data-testid="confirm-dialog" @click.self="settleConfirm(false)">
      <div class="adm-dialog" role="alertdialog" aria-modal="true">
        <h3 class="adm-dialog-title">{{ state.title }}</h3>
        <p class="adm-dialog-message">{{ state.message }}</p>

        <label v-if="state.expectedText" class="adm-field">
          <span class="adm-label">
            请原样输入「{{ state.expectedText }}」以确认
          </span>
          <input v-model="typed" class="adm-input" type="text" autocomplete="off" data-testid="confirm-phrase" />
        </label>

        <div class="adm-dialog-actions">
          <button type="button" class="adm-button" data-testid="confirm-cancel" @click="settleConfirm(false)">
            {{ state.cancelText ?? '取消' }}
          </button>
          <button
            type="button"
            class="adm-button"
            :class="state.danger ? 'is-danger' : 'is-primary'"
            data-testid="confirm-yes"
            :disabled="!phraseOk"
            @click="settleConfirm(true)"
          >
            {{ state.confirmText ?? '确定' }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
