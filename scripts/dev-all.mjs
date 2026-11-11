/**
 * 一条命令同时起后端和前端 dev server：
 *   pnpm dev:all
 * 两个进程的输出会带上 [后端] / [前端] 前缀，Ctrl+C 一起退出。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const API_PORT = process.env.PORT ?? '5181'
const VITE_BIN = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')

if (!existsSync(VITE_BIN)) {
  console.error('找不到 vite，先跑一次 pnpm install')
  process.exit(1)
}

const colors = {
  server: '\u001b[36m', // 青
  web: '\u001b[35m', // 紫
  reset: '\u001b[0m',
}

const children = []

function run(label, command, args, extraEnv = {}) {
  const child = spawn(command, args, {
    cwd: ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const prefix = `${colors[label] ?? ''}[${label === 'server' ? '后端' : '前端'}]${colors.reset} `
  const pipe = (stream, isError = false) => {
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        ;(isError ? process.stderr : process.stdout).write(prefix + line + '\n')
      }
    })
  }
  pipe(child.stdout)
  pipe(child.stderr, true)
  child.on('exit', (code, signal) => {
    if (shuttingDown) return
    console.log(`${prefix}进程退出（code=${code} signal=${signal}）`)
    shutdown()
  })
  children.push(child)
  return child
}

let shuttingDown = false
function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    try {
      child.kill()
    } catch {
      /* 忽略 */
    }
  }
  setTimeout(() => process.exit(0), 300)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

console.log('启动后端（端口 %s）和前端（端口 5180）…\n', API_PORT)
run('server', process.execPath, ['--watch', 'server/index.mjs'], { PORT: API_PORT })
run('web', process.execPath, [VITE_BIN])
