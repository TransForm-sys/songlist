/**
 * 用 xlsx 导出的 songs JSON 重新生成 public/list.txt。
 * 走项目自己的 renderListTxt，保证格式与后台导出完全一致。
 *
 * 用法：node scripts/build-list-from-json.mjs <songs.json> [streamerName] [liveUrl]
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { renderListTxt } from '../server/lib/export.mjs'

const [, , input, streamer = '临小渺', liveUrl = 'https://live.bilibili.com/123456'] = process.argv
if (!input) {
  console.error('用法: node scripts/build-list-from-json.mjs <songs.json> [主播名] [直播间]')
  process.exit(1)
}

const songs = JSON.parse(readFileSync(input, 'utf8'))
const text = renderListTxt({ streamerName: streamer, liveUrl, songs })
writeFileSync('public/list.txt', text, 'utf8')

const lines = text.split('\n').filter(Boolean)
console.log(`已写入 public/list.txt：${songs.length} 首，${lines.length} 行`)
console.log('表头:', lines[2]?.replace(/\t/g, ' | '))
console.log('首行:', lines[3]?.replace(/\t/g, ' | '))
