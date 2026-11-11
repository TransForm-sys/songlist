import { ref } from 'vue'

const message = ref('')
let timer: number | undefined

/** 极简 toast：全局单例，谁都能调 */
export function useToast() {
  function show(text: string, duration = 2000) {
    message.value = text
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      message.value = ''
    }, duration)
  }
  return { message, show }
}
