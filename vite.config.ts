import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'

/** 后端端口，前后端分开跑时前端把 /api 代理过去 */
const API_TARGET = process.env.API_TARGET ?? 'http://127.0.0.1:5181'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '127.0.0.1',
    port: 5180,
    watch: {
      // 编辑器/工具做原子写入时会生成临时目录，监听它们会直接把 dev server 搞崩（EBUSY）
      ignored: ['**/.*.tmpdir/**', '**/*.tmp', '**/node_modules/**', '**/dist/**', '**/server/data/**'],
    },
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/uploads': { target: API_TARGET, changeOrigin: true },
    },
  },
  build: {
    target: 'es2020',
    assetsInlineLimit: 4096,
    rollupOptions: {
      input: {
        // 多入口：前台 index.html + 后台 admin.html
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        admin: fileURLToPath(new URL('./admin.html', import.meta.url)),
      },
    },
  },
})
