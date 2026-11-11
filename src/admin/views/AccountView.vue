<script setup lang="ts">
/**
 * 账号安全：改密码。
 * 前端先做「至少 8 位」「两次一致」的校验，后端还会再做一次强度校验，
 * 所以后端的错误信息要原样显示出来。
 */
import { ref } from 'vue'
import { api, ApiError } from '../api'
import { useAdminToast } from '../useToast'

const props = defineProps<{ username: string; passwordIsInitial: boolean }>()
const emit = defineEmits<{ 'password-changed': []; }>()

const { show, error } = useAdminToast()

const form = ref({ currentPassword: '', newPassword: '', confirmPassword: '' })
const submitting = ref(false)
const localError = ref('')
const doneMessage = ref('')

async function submit() {
  if (submitting.value) return
  localError.value = ''
  doneMessage.value = ''

  const { currentPassword, newPassword, confirmPassword } = form.value
  if (!currentPassword || !newPassword || !confirmPassword) {
    localError.value = '三项都要填'
    return
  }
  if (newPassword.length < 8) {
    localError.value = '新密码至少 8 位'
    return
  }
  if (newPassword !== confirmPassword) {
    localError.value = '两次输入的新密码不一致'
    return
  }
  if (newPassword === currentPassword) {
    localError.value = '新密码不能和当前密码相同'
    return
  }

  submitting.value = true
  try {
    await api.changePassword(currentPassword, newPassword)
    form.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
    doneMessage.value = '密码已更新，其他设备已下线，请重新登录'
    show('密码已更新')
    emit('password-changed')
  } catch (err) {
    const apiError = err as ApiError
    if (apiError.status === 401) {
      // 当前密码不对也是 401，但这属于表单问题，不该被当成会话过期
      localError.value = apiError.message || '当前密码不对'
    } else {
      localError.value = apiError.message || '修改失败，请重试'
    }
  } finally {
    submitting.value = false
  }
}

async function logoutNow() {
  try {
    await api.logout()
  } catch {
    /* 会话若已失效，刷新一样会回到登录页 */
  }
  window.location.reload()
}
</script>

<template>
  <div class="adm-view">
    <div class="adm-view-head">
      <div>
        <h2 data-testid="view-title">账号安全</h2>
        <p>当前登录账号：{{ props.username }}</p>
      </div>
    </div>

    <div v-if="props.passwordIsInitial" class="adm-card" style="border-color: #ff8a8a88">
      <h3 style="margin: 0 0 6px; font-size: 15px; color: #ff8a8a">⚠ 你还在用初始密码</h3>
      <p class="adm-hint" style="font-size: 13px">
        初始密码是后端首次启动时打印在控制台里的，可能已经被别人看到。
        请立刻在下面设置一个新密码（至少 8 位，别用常见词）。
      </p>
    </div>

    <section class="adm-card">
      <div class="adm-card-head">
        <div>
          <h3>修改密码</h3>
          <p>改完之后其他设备的登录会立刻失效，当前这台不受影响</p>
        </div>
      </div>

      <form class="adm-form" @submit.prevent="submit">
        <label class="adm-field">
          <span class="adm-label">当前密码</span>
          <input
            v-model="form.currentPassword"
            class="adm-input"
            type="password"
            autocomplete="current-password"
            data-testid="password-current"
          />
        </label>

        <label class="adm-field">
          <span class="adm-label">新密码（至少 8 位）</span>
          <input
            v-model="form.newPassword"
            class="adm-input"
            type="password"
            autocomplete="new-password"
            data-testid="password-new"
          />
        </label>

        <label class="adm-field">
          <span class="adm-label">确认新密码</span>
          <input
            v-model="form.confirmPassword"
            class="adm-input"
            type="password"
            autocomplete="new-password"
            data-testid="password-confirm"
          />
        </label>

        <p v-if="localError" class="adm-error-text" data-testid="password-error">{{ localError }}</p>
        <p v-if="doneMessage" class="adm-ok-text" data-testid="password-ok">{{ doneMessage }}</p>

        <div class="adm-inline" style="justify-content: flex-end">
          <button v-if="doneMessage" type="button" class="adm-button" @click="logoutNow">
            重新登录
          </button>
          <button type="submit" class="adm-button is-primary" data-testid="password-save" :disabled="submitting">
            {{ submitting ? '提交中…' : '修改密码' }}
          </button>
        </div>
      </form>
    </section>

    <section class="adm-card">
      <div class="adm-card-head"><h3>安全建议</h3></div>
      <ul class="adm-hint" style="margin: 0; padding-left: 18px; line-height: 1.9">
        <li>后台没有验证码，同一 IP 10 分钟内失败 8 次会临时被限流（429）</li>
        <li>密码用 scrypt 哈希存储，数据库里看不到明文</li>
        <li>会话保存在 HttpOnly cookie 里，有效期 7 天</li>
        <li>长密码也支持，但别用「12345678」这类常见词，后端会直接拒绝</li>
      </ul>
    </section>
  </div>
</template>
