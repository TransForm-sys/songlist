import { ref, watch } from 'vue'
import { config } from '../config'

export type Theme = 'dark' | 'light'

function readForcedTheme(): Theme | null {
  try {
    const forced = new URLSearchParams(window.location.search).get('theme')
    return forced === 'light' || forced === 'dark' ? forced : null
  } catch {
    return null
  }
}

function readTheme(): Theme {
  const forced = readForcedTheme()
  if (forced) return forced
  try {
    return localStorage.getItem(config.themeStorageKey) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

const theme = ref<Theme>(readTheme())

function apply(next: Theme) {
  document.documentElement.dataset.theme = next
  // URL 强制指定的主题不写回 localStorage，避免改掉用户自己的选择
  if (readForcedTheme()) return
  try {
    localStorage.setItem(config.themeStorageKey, next)
  } catch {
    /* 隐私模式下写不了 localStorage，忽略即可 */
  }
}

apply(theme.value)
watch(theme, apply)

// 其他标签页切换主题时同步过来
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === config.themeStorageKey && event.newValue) {
      theme.value = event.newValue === 'light' ? 'light' : 'dark'
    }
  })
}

export function useTheme() {
  const toggle = () => {
    theme.value = theme.value === 'dark' ? 'light' : 'dark'
  }
  return { theme, toggle }
}
