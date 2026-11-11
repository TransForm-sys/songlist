/**
 * 后台的轻提示。前台那套 useToast 是单条覆盖式的，
 * 后台连续写操作（批量改字段）需要排队显示，所以单独做一份。
 */
import { ref } from 'vue'

export interface ToastItem {
  id: number
  text: string
  tone: 'info' | 'error'
}

const items = ref<ToastItem[]>([])
let seq = 0

function push(text: string, tone: ToastItem['tone'], duration: number) {
  const id = ++seq
  items.value = [...items.value, { id, text, tone }]
  window.setTimeout(() => dismiss(id), duration)
}

function dismiss(id: number) {
  items.value = items.value.filter((item) => item.id !== id)
}

export function useAdminToast() {
  return {
    items,
    /** 普通成功提示 */
    show: (text: string) => push(text, 'info', 2400),
    /** 失败提示留久一点，免得没看清就消失 */
    error: (text: string) => push(text, 'error', 5000),
    dismiss,
  }
}
