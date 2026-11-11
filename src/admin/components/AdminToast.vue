<script setup lang="ts">
import { useAdminToast } from '../useToast'

const { items, dismiss } = useAdminToast()
</script>

<template>
  <Teleport to="body">
    <div class="adm-toasts" role="status" aria-live="polite">
      <TransitionGroup name="adm-toast">
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="adm-toast"
          :class="`is-${item.tone}`"
          data-testid="toast"
          @click="dismiss(item.id)"
        >
          {{ item.text }}
        </button>
      </TransitionGroup>
    </div>
  </Teleport>
</template>
