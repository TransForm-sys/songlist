import type { LoadError } from '../types'

interface LoadOptions {
  timeoutMs: number
}

/**
 * 带超时和错误分类的文本加载。
 * 返回 null 表示「文件不存在，可静默降级」（用于可选的 profile.json）。
 */
export async function loadText(
  url: string,
  { timeoutMs }: LoadOptions,
  { optional = false }: { optional?: boolean } = {},
): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-cache' })
    if (!response.ok) {
      if (optional && (response.status === 404 || response.status === 403)) return null
      const error: LoadError = {
        kind: 'http',
        status: response.status,
        message: `加载失败（${response.status}）`,
      }
      throw error
    }
    return await response.text()
  } catch (error) {
    if ((error as LoadError)?.kind) throw error
    if ((error as Error)?.name === 'AbortError') {
      const timeout: LoadError = { kind: 'timeout', message: '加载超时，请重试' }
      throw timeout
    }
    if (optional) return null
    const network: LoadError = { kind: 'network', message: '网络异常，歌单加载失败' }
    throw network
  } finally {
    clearTimeout(timer)
  }
}
