/**
 * 曲目标记的判断逻辑。
 *
 * 「付费曲」目前只写在备注里（后台编辑歌曲 → 备注），前台据此显示一个
 * 中性图标（礼物盒），**不显示任何文字** —— 页面是个人非经营性站点，
 * 不适合出现「付费 / 价格 / 打赏」这类字眼（备案审核会看页面内容）。
 */
export function isPaidSong(note: string | undefined | null): boolean {
  return /付费|收费/.test(note ?? '')
}
