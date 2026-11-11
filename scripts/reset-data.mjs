/**
 * 数据维护脚本：换歌单、清空示例数据、从文件导入、看统计。
 *
 *   node scripts/reset-data.mjs --status
 *   node scripts/reset-data.mjs --clear-songs --yes
 *   node scripts/reset-data.mjs --clear-all --yes
 *   node scripts/reset-data.mjs --import public/list.txt --replace --yes
 *   node scripts/reset-data.mjs --import 我的歌单.txt --streamer "主播名" --live "https://live.bilibili.com/123"
 *
 * 所有破坏性操作都会先自动备份（可在后台「备份与导出」里回滚）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  countSongs,
  getSettings,
  insertSong,
  listAllSongs,
  nextPosition,
  openDatabase,
  saveProfile,
  saveSettings,
  songKey,
  songLooseKey,
} from '../server/lib/db.mjs'
import { createBackup, ensureBackupDir } from '../server/lib/backup.mjs'
import { parseListTxt } from '../server/lib/importList.mjs'
import { writeStaticExports } from '../server/lib/export.mjs'

function parseArgs(argv) {
  const args = {
    dataDir: process.env.DATA_DIR ?? 'server/data',
    staticDir: process.env.STATIC_DIR ?? 'dist',
    yes: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--status') args.status = true
    else if (key === '--clear-songs') args.clearSongs = true
    else if (key === '--clear-all') args.clearAll = true
    else if (key === '--import') args.import = argv[++i]
    else if (key === '--replace') args.replace = true
    else if (key === '--streamer') args.streamer = argv[++i]
    else if (key === '--live') args.live = argv[++i]
    else if (key === '--data-dir') args.dataDir = argv[++i]
    else if (key === '--static-dir') args.staticDir = argv[++i]
    else if (key === '--yes' || key === '-y') args.yes = true
    else if (key === '--help' || key === '-h') args.help = true
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log(`用法：
  --status                     查看当前数据统计
  --clear-songs --yes          清空全部歌曲（先自动备份）
  --clear-all --yes            清空歌曲 + 主播资料 + 站点设置
  --import <文件> [--replace]  从表格导出的文本导入（TSV/CSV，--replace 表示先清空）
  --streamer <名字>            顺便设置主播名
  --live <链接>                顺便设置直播间链接
  --data-dir <目录>            数据目录，默认 server/data
  --static-dir <目录>          构建产物目录，默认 dist（导入后会同步再生 list.txt）`)
  process.exit(0)
}

const dataDir = resolve(process.cwd(), args.dataDir)
const staticDir = resolve(process.cwd(), args.staticDir)
const dbPath = join(dataDir, 'songlist.db')

if (!existsSync(dbPath)) {
  console.error(`找不到数据库：${dbPath}`)
  console.error('先启动一次后端（node server/index.mjs）让它自动建库，再回来跑这个脚本。')
  process.exit(1)
}

const db = openDatabase(dbPath)
ensureBackupDir(join(dataDir, 'backups'))

function report() {
  const songs = listAllSongs(db)
  const settings = getSettings(db)
  const tally = (key) => {
    const map = new Map()
    for (const song of songs) {
      const value = song[key]
      if (!value) continue
      map.set(value, (map.get(value) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }
  console.log(`主播名：${settings.streamerName || '(空)'}`)
  console.log(`直播间：${settings.liveUrl || '(空)'}`)
  console.log(`歌曲数：${songs.length}`)
  console.log(`语种：${tally('language').map(([v, n]) => `${v}(${n})`).join(' ') || '(无)'}`)
  console.log(`曲风：${tally('genre').map(([v, n]) => `${v}(${n})`).join(' ') || '(无)'}`)
  console.log(`SC：${songs.filter((song) => song.sc).length} 首`)
  console.log(`新歌标记：${songs.filter((song) => song.isNew).length} 首`)
}

function needYes(what) {
  if (args.yes) return true
  console.error(`「${what}」是破坏性操作，确认请加 --yes`)
  return false
}

try {
  if (args.status || (!args.clearSongs && !args.clearAll && !args.import)) {
    report()
    process.exit(0)
  }

  if (args.clearAll) {
    if (!needYes('清空全部数据')) process.exit(1)
    const backup = createBackup(db, join(dataDir, 'backups'), 'before-clear-all')
    db.exec('DELETE FROM songs')
    db.exec('UPDATE settings SET value = \'\'')
    db.exec('DELETE FROM profile')
    console.log(`✓ 已清空歌曲、主播资料与站点设置（备份：${backup.file}）`)
  } else if (args.clearSongs) {
    if (!needYes('清空曲库')) process.exit(1)
    const total = countSongs(db)
    const backup = createBackup(db, join(dataDir, 'backups'), 'before-clear')
    db.exec('DELETE FROM songs')
    console.log(`✓ 已清空 ${total} 首歌（备份：${backup.file}）`)
  }

  if (args.import) {
    const file = resolve(process.cwd(), args.import)
    if (!existsSync(file)) {
      console.error(`找不到文件：${file}`)
      process.exit(1)
    }
    const parsed = parseListTxt(readFileSync(file, 'utf8'))
    if (!parsed.songs.length) {
      console.error('这个文件里没解析出任何歌曲，检查一下是不是表格导出的制表符文本。')
      process.exit(1)
    }
    if (args.replace) {
      if (!needYes('覆盖导入（会清空现有歌曲）')) process.exit(1)
      const backup = createBackup(db, join(dataDir, 'backups'), 'before-replace')
      db.exec('DELETE FROM songs')
      console.log(`  已清空旧数据（备份：${backup.file}）`)
    }

    // 整行一致才算重复（跳过）；歌名+歌手相同但其他字段不同的照样导入，只提示
    const existing = new Set(listAllSongs(db).map((song) => songKey(song)))
    const existingLoose = new Set(listAllSongs(db).map((song) => songLooseKey(song)))
    let added = 0
    let duplicated = 0
    const similar = []
    db.exec('BEGIN')
    try {
      let position = nextPosition(db)
      for (const song of parsed.songs) {
        const key = songKey(song)
        if (existing.has(key)) {
          duplicated++
          continue
        }
        if (existingLoose.has(songLooseKey(song))) similar.push(`${song.title} - ${song.singer}`)
        existing.add(key)
        existingLoose.add(songLooseKey(song))
        insertSong(db, song, position)
        position++
        added++
      }
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }

    if (args.streamer) saveSettings(db, { streamerName: args.streamer })
    else if (parsed.meta.streamerName) saveSettings(db, { streamerName: parsed.meta.streamerName })
    if (args.live) saveSettings(db, { liveUrl: args.live })
    else if (parsed.meta.liveUrl) saveSettings(db, { liveUrl: parsed.meta.liveUrl })

    // 文件旁边如果有同名 profile.json，一并导入
    const profileFile = join(file, '..', 'profile.json')
    if (existsSync(profileFile)) {
      try {
        saveProfile(db, JSON.parse(readFileSync(profileFile, 'utf8')))
        console.log('  同时导入了同目录下的 profile.json')
      } catch {
        console.log('  同目录的 profile.json 格式有问题，已跳过')
      }
    }

    console.log(`✓ 导入完成：新增 ${added} 首，整行重复跳过 ${duplicated} 首`)
    if (similar.length) {
      console.log(`  注意：有 ${similar.length} 首与库里已有歌曲同名同歌手（已照常导入，请自行核对是否重复）：`)
      for (const item of similar.slice(0, 10)) console.log(`    · ${item}`)
      if (similar.length > 10) console.log(`    … 还有 ${similar.length - 10} 首`)
    }
  }

  const exported = writeStaticExports(db, staticDir, { silent: true })
  if (exported) console.log(`  已同步再生静态文件：${join(staticDir, 'list.txt')}`)

  console.log('')
  console.log('当前数据：')
  report()
} finally {
  db.close()
}
