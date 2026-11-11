/**
 * 后台通用的小工具。
 */

/** 字节数转人类可读，数据库大小和备份文件大小都用它 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** 时间戳转本地时间字符串，后台所有时间列统一走这里 */
export function formatTime(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

/** 备份原因 → 中文说明 */
export const BACKUP_REASON_TEXT: Record<string, string> = {
  auto: '自动备份（写入前节流）',
  manual: '手动备份',
  'before-replace': '覆盖导入前的备份',
  'before-restore': '回滚前的备份',
  'before-clear': '清空曲库前的备份',
}

export function backupReasonText(reason: string): string {
  return BACKUP_REASON_TEXT[reason] ?? reason
}

/** 审计动作 → 中文说明 */
export const AUDIT_ACTION_TEXT: Record<string, string> = {
  login: '登录',
  'password.change': '修改密码',
  'song.create': '新增歌曲',
  'song.update': '编辑歌曲',
  'song.delete': '删除歌曲',
  'song.bulk-delete': '批量删除',
  'song.bulk-import': '批量导入',
  'song.clear': '清空曲库',
  'song.reorder': '拖拽排序',
  'song.pin': '置顶 / 置底',
  'song.move': '上移 / 下移',
  'profile.update': '保存主播资料',
  'settings.update': '保存站点设置',
  upload: '上传图片',
  'backup.create': '手动备份',
  'backup.restore': '回滚备份',
  'backup.delete': '删除备份',
}

export function auditActionText(action: string): string {
  return AUDIT_ACTION_TEXT[action] ?? action
}
