/**
 * 忘记密码 / 想换密码时的离线重置工具。直接改数据库里的哈希，不留明文。
 *
 *   node scripts/reset-password.mjs                        # 交互式输入（推荐）
 *   node scripts/reset-password.mjs --generate             # 生成随机密码并打印一次
 *   node scripts/reset-password.mjs --password 'xxx'       # 直接指定（注意 shell 历史里会留痕）
 *   node scripts/reset-password.mjs --user admin --data-dir server/data
 *
 * 也可以只生成一个哈希，塞进 ADMIN_PASSWORD_HASH 环境变量：
 *   node scripts/reset-password.mjs --hash-only 'xxx'
 */
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { openDatabase } from '../server/lib/db.mjs'
import {
  checkPasswordStrength,
  findUser,
  generatePassword,
  hashPassword,
  isPasswordHash,
  setPassword,
  upsertUser,
} from '../server/lib/auth.mjs'

function parseArgs(argv) {
  const args = { dataDir: process.env.DATA_DIR ?? 'server/data', user: process.env.ADMIN_USER ?? 'admin' }
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]
    if (key === '--generate') args.generate = true
    else if (key === '--hash-only') args.hashOnly = argv[++i]
    else if (key === '--password') args.password = argv[++i]
    else if (key === '--user') args.user = argv[++i]
    else if (key === '--data-dir') args.dataDir = argv[++i]
    else if (key === '--help' || key === '-h') args.help = true
  }
  return args
}

function ask(question, { hidden = false } = {}) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
  return new Promise((resolvePromise) => {
    if (!hidden) {
      rl.question(question, (answer) => {
        rl.close()
        resolvePromise(answer)
      })
      return
    }
    // 隐藏输入：把输出流临时改掉
    const stdout = process.stdout
    const originalWrite = stdout.write.bind(stdout)
    stdout.write = (chunk, ...rest) => {
      if (String(chunk).includes('\n')) return originalWrite(chunk, ...rest)
      return true
    }
    rl.question(question, (answer) => {
      stdout.write = originalWrite
      originalWrite('\n')
      rl.close()
      resolvePromise(answer)
    })
  })
}

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log(`用法：
  node scripts/reset-password.mjs [--user admin] [--data-dir server/data] [--generate]
  node scripts/reset-password.mjs --password '新密码'
  node scripts/reset-password.mjs --hash-only '明文密码'   # 只输出哈希，不写库`)
  process.exit(0)
}

if (args.hashOnly) {
  const strength = checkPasswordStrength(args.hashOnly)
  if (!strength.ok) {
    console.error(`密码不符合要求：${strength.message}`)
    process.exit(1)
  }
  console.log(hashPassword(args.hashOnly))
  process.exit(0)
}

const dbPath = resolve(process.cwd(), args.dataDir, 'songlist.db')
const db = openDatabase(dbPath)

try {
  const existing = findUser(db, args.user)

  let password = args.password
  if (!password && args.generate) password = generatePassword(12)
  if (!password) {
    console.log(`即将为账号「${args.user}」设置新密码${existing ? '' : '（这个账号还不存在，会新建）'}`)
    const first = await ask('新密码（至少 8 位，输入时不回显）: ', { hidden: true })
    const second = await ask('再输一遍确认: ', { hidden: true })
    if (first !== second) {
      console.error('两次输入不一致，已取消。')
      process.exit(1)
    }
    password = first
  }

  const strength = checkPasswordStrength(password)
  if (!strength.ok) {
    console.error(`密码不符合要求：${strength.message}`)
    process.exit(1)
  }

  if (existing) {
    setPassword(db, existing.id, password)
  } else {
    upsertUser(db, args.user, password)
  }

  // 密码换了，顺手清掉所有旧会话
  db.prepare('DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE username = ?)').run(
    args.user,
  )

  console.log(`✓ 已更新「${args.user}」的密码（数据库里只存 scrypt 哈希）`)
  console.log('  所有旧登录会话已失效，请用新密码重新登录后台。')
  if (args.generate) console.log(`  新密码：${password}   ← 只显示这一次`)
} finally {
  db.close()
}
