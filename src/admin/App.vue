<script setup lang="ts">
/**
 * 后台外壳：登录门禁 + 顶部导航 + 主题切换 + 视图切换。
 * 视图只有 6 个，没必要引 vue-router，用一个 ref + hash 就够了，
 * 保留 hash 是为了刷新后还停在原来那一页。
 */
import { computed, onMounted, ref, watch } from 'vue'
import AccountView from './views/AccountView.vue'
import BackupsView from './views/BackupsView.vue'
import ImportView from './views/ImportView.vue'
import ProfileView from './views/ProfileView.vue'
import SettingsView from './views/SettingsView.vue'
import SongsView from './views/SongsView.vue'
import AdminToast from './components/AdminToast.vue'
import ConfirmHost from './components/ConfirmHost.vue'
import { api, ApiError, setUnauthorizedHandler } from './api'
import { useAdminToast } from './useToast'
import { useTheme } from '../composables/useTheme'

type ViewKey = 'songs' | 'import' | 'profile' | 'settings' | 'backups' | 'account'

const VIEWS: { key: ViewKey; label: string; hint: string }[] = [
  { key: 'songs', label: '曲库', hint: '增删改查与排序' },
  { key: 'import', label: '批量导入', hint: '粘贴表格批量新增' },
  { key: 'profile', label: '主播资料', hint: '简介与图片' },
  { key: 'settings', label: '站点设置', hint: '名称 / 直播间 / 公告' },
  { key: 'backups', label: '备份与导出', hint: '回滚与下载' },
  { key: 'account', label: '账号安全', hint: '修改密码' },
]

const viewMap = {
  songs: SongsView,
  import: ImportView,
  profile: ProfileView,
  settings: SettingsView,
  backups: BackupsView,
  account: AccountView,
}

const { theme, toggle } = useTheme()
const { show, error } = useAdminToast()

const ready = ref(false) // 是否已经问过 session，避免闪一下登录框
const username = ref('')
const passwordIsInitial = ref(false)

/* 登录表单 */
const form = ref({ username: '', password: '' })
const loggingIn = ref(false)
const loginError = ref('')

const activeView = ref<ViewKey>(readViewFromHash())

function readViewFromHash(): ViewKey {
  const key = window.location.hash.replace(/^#\/?/, '')
  return (VIEWS.some((item) => item.key === key) ? key : 'songs') as ViewKey
}

const currentView = computed(() => viewMap[activeView.value])
const activeMeta = computed(() => VIEWS.find((item) => item.key === activeView.value))

watch(activeView, (key) => {
  const next = `#/${key}`
  if (window.location.hash !== next) history.replaceState(null, '', next)
  document.title = `歌单后台 · ${VIEWS.find((item) => item.key === key)?.label ?? ''}`
})

/** 会话失效时静默退回登录页：不弹错误，避免一堆请求同时刷屏 */
function goToLogin() {
  username.value = ''
  passwordIsInitial.value = false
  loginError.value = ''
  form.value = { username: '', password: '' }
}

async function bootstrap() {
  try {
    const session = await api.session()
    if (session.authed && session.user) {
      username.value = session.user.username
      passwordIsInitial.value = session.passwordIsInitial === true
    }
  } catch {
    // 后端没起来时也应该显示登录框，让用户看到「网络连接失败」而不是白屏
  } finally {
    ready.value = true
  }
}

async function submitLogin() {
  if (loggingIn.value) return
  loginError.value = ''
  const name = form.value.username.trim()
  if (!name || !form.value.password) {
    loginError.value = '请输入用户名和密码'
    return
  }

  loggingIn.value = true
  try {
    const result = await api.login(name, form.value.password)
    username.value = result.user.username
    form.value = { username: '', password: '' }
    // 登录响应里没有 initial 标记，重新问一次 session 才拿得到
    const session = await api.session().catch(() => null)
    passwordIsInitial.value = session?.passwordIsInitial === true
    show('登录成功')
  } catch (err) {
    const apiError = err as ApiError
    if (apiError.status === 429) {
      loginError.value = apiError.message || '尝试次数过多，请稍后再试'
    } else if (apiError.status === 401) {
      loginError.value = apiError.message || '用户名或密码不对'
    } else {
      loginError.value = apiError.message || '登录失败，请重试'
    }
  } finally {
    loggingIn.value = false
  }
}

async function logout() {
  try {
    await api.logout()
  } catch {
    /* 会话可能已经过期，本地照样退出去 */
  }
  goToLogin()
  show('已退出登录')
}

// 任何管理接口 401 都回到登录界面；已经在登录页时不再重复提示
setUnauthorizedHandler(() => {
  if (!username.value) return
  goToLogin()
  error('登录已过期，请重新登录')
})

onMounted(() => {
  document.title = '歌单后台'
  void bootstrap()
})
</script>

<template>
  <div class="adm-shell">
    <div v-if="!ready" class="adm-boot">
      <div class="adm-spinner" />
      <p>正在检查登录状态…</p>
    </div>

    <!-- 登录门禁 -->
    <div v-else-if="!username" class="adm-login-wrap">
      <form class="adm-login" @submit.prevent="submitLogin">
        <h1>歌单管理后台</h1>
        <p class="adm-login-sub">请使用管理员账号登录</p>

        <label class="adm-field">
          <span class="adm-label">用户名</span>
          <input
            v-model="form.username"
            class="adm-input"
            type="text"
            autocomplete="username"
            data-testid="login-username"
          />
        </label>

        <label class="adm-field">
          <span class="adm-label">密码</span>
          <input
            v-model="form.password"
            class="adm-input"
            type="password"
            autocomplete="current-password"
            data-testid="login-password"
          />
        </label>

        <p v-if="loginError" class="adm-error-text" data-testid="login-error">{{ loginError }}</p>

        <button
          type="submit"
          class="adm-button is-primary is-block"
          data-testid="login-submit"
          :disabled="loggingIn"
        >
          {{ loggingIn ? '登录中…' : '登录' }}
        </button>

        <div class="adm-login-foot">
          <a class="adm-link" href="/" target="_blank" rel="noopener">查看前台歌单</a>
          <button type="button" class="adm-link" @click="toggle">
            {{ theme === 'dark' ? '切换到亮色' : '切换到暗色' }}
          </button>
        </div>
      </form>
    </div>

    <!-- 已登录 -->
    <template v-else>
      <header class="adm-header">
        <div class="adm-brand">
          <span class="adm-brand-mark">歌</span>
          <span class="adm-brand-text">歌单后台</span>
        </div>

        <nav class="adm-nav">
          <button
            v-for="item in VIEWS"
            :key="item.key"
            type="button"
            class="adm-nav-item"
            :class="{ 'is-active': activeView === item.key }"
            :data-testid="`nav-${item.key}`"
            :title="item.hint"
            @click="activeView = item.key"
          >
            {{ item.label }}
          </button>
        </nav>

        <div class="adm-header-side">
          <a class="adm-button is-small" href="/" target="_blank" rel="noopener">前台</a>
          <button
            type="button"
            class="adm-icon-button"
            :aria-label="theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'"
            @click="toggle"
          >
            <svg v-if="theme === 'dark'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="4.2" />
              <path
                d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"
                stroke-linecap="round"
              />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" stroke-linejoin="round" />
            </svg>
          </button>
          <span class="adm-user" data-testid="admin-user">{{ username }}</span>
          <button type="button" class="adm-button is-small" data-testid="admin-logout" @click="logout">
            退出登录
          </button>
        </div>
      </header>

      <button
        v-if="passwordIsInitial"
        type="button"
        class="adm-initial-warning"
        data-testid="admin-initial-password-warning"
        @click="activeView = 'account'"
      >
        <strong>你还在用初始密码，请尽快修改</strong>
        <span>点这里去「账号安全」修改 →</span>
      </button>

      <main class="adm-main">
        <component
          :is="currentView"
          :key="activeView"
          :username="username"
          :password-is-initial="passwordIsInitial"
          @navigate="activeView = $event"
          @password-changed="passwordIsInitial = false"
        />
      </main>

      <footer class="adm-footer">
        <span>{{ activeMeta?.hint }}</span>
        <span>歌单管理后台 · 数据来自 server/data/songlist.db</span>
      </footer>
    </template>

    <AdminToast />
    <ConfirmHost />
  </div>
</template>
