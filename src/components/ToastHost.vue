<script setup lang="ts">
import { useToast } from '../composables/useToast'

const { message } = useToast()
</script>

<template>
  <Teleport to="body">
    <Transition name="toast-fade">
      <div v-if="message" class="toast" role="status" aria-live="polite">{{ message }}</div>
    </Transition>
  </Teleport>
</template>
