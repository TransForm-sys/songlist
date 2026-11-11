/**
 * 全局确认框。用 Promise 形式，破坏性操作就在调用点写
 * `if (!(await confirmDialog({...}))) return`，比给每个组件塞状态干净。
 */
import { ref } from 'vue'

export interface ConfirmOptions {
  title: string
  message: string
  /** 危险操作的按钮文案与配色 */
  confirmText?: string
  cancelText?: string
  danger?: boolean
  /**
   * 强确认：要求用户把 expectedText 原样敲一遍才能点确认。
   * 覆盖导入、回滚这类不可逆操作用它，避免手滑。
   */
  expectedText?: string
}

export interface ConfirmState extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

export const confirmState = ref<ConfirmState | null>(null)

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  // 上一张还没关就被新的顶掉：旧的按「取消」处理，避免 Promise 悬着
  confirmState.value?.resolve(false)
  return new Promise<boolean>((resolve) => {
    confirmState.value = { ...options, resolve }
  })
}

export function settleConfirm(ok: boolean) {
  const state = confirmState.value
  if (!state) return
  confirmState.value = null
  state.resolve(ok)
}
