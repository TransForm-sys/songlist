<script setup lang="ts">
/**
 * 站点设置：主播名 / 直播间 / 备案号 / 公告。
 * PUT 只发要改的键，但这里四个字段都会发——后台是整体编辑场景，
 * 少发一个反而容易让人以为改了没生效。
 */
import { onMounted, reactive, ref } from 'vue'
import { api, type SiteSettings } from '../api'
import { useAdminToast } from '../useToast'
import ImagePicker from '../components/ImagePicker.vue'
import AdminSelect from '../components/AdminSelect.vue'
import VideoPicker from '../components/VideoPicker.vue'

const bgPositionOptions = [
  { value: 'top', label: '保住上方（人物头部）' },
  { value: 'center', label: '居中裁切' },
  { value: 'bottom', label: '保住下方' },
]

const { show, error } = useAdminToast()

const loading = ref(true)
const saving = ref(false)
const loadError = ref('')
const defaults = ref<SiteSettings | null>(null)

const emptySettings = (): SiteSettings => ({
  streamerName: '',
  liveUrl: '',
  icp: '',
  police: '',
  notice: '',
  background: '',
  backgroundPosition: 'top',
  backgroundVideo: '',
})

const form = reactive<SiteSettings>(emptySettings())
const saved = ref<SiteSettings>(emptySettings())

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await api.getSettings()
    Object.assign(form, result.settings)
    saved.value = { ...result.settings }
    defaults.value = result.defaults
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

async function save() {
  if (saving.value) return
  if (!form.streamerName.trim()) {
    error('主播名不能为空，前台的标题会用到它')
    return
  }
  saving.value = true
  try {
    const result = await api.saveSettings({ ...form })
    Object.assign(form, result.settings)
    saved.value = { ...result.settings }
    show('站点设置已保存，前台已同步')
  } catch (err) {
    error((err as Error).message)
  } finally {
    saving.value = false
  }
}

function restoreDefaults() {
  if (!defaults.value) return
  Object.assign(form, defaults.value)
  show('已填入默认值，记得点保存')
}

onMounted(() => void load())
</script>

<template>
  <div class="adm-view">
    <div class="adm-view-head">
      <div>
        <h2 data-testid="view-title">站点设置</h2>
        <p>保存后会同步写回静态文件，前台刷新即可看到最新内容</p>
      </div>
      <div class="adm-toolbar">
        <a class="adm-button is-small" href="/" target="_blank" rel="noopener">在新标签页打开前台</a>
        <button
          type="button"
          class="adm-button is-primary"
          data-testid="settings-save"
          :disabled="saving || loading"
          @click="save"
        >
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="adm-loading"><span class="adm-spinner" />正在加载设置…</div>

    <div v-else-if="loadError" class="adm-card">
      <p class="adm-error-text">{{ loadError }}</p>
      <button type="button" class="adm-button is-small" style="margin-top: 10px" @click="load">重试</button>
    </div>

    <template v-else>
      <section class="adm-card">
        <div class="adm-card-head"><h3>基本信息</h3></div>

        <div class="adm-view">
          <label class="adm-field">
            <span class="adm-label">主播名 streamerName（前台标题：XXX 的歌单）</span>
            <input
              v-model="form.streamerName"
              class="adm-input"
              type="text"
              data-testid="settings-streamer"
              placeholder="例如：浅野天琪"
            />
          </label>

          <label class="adm-field">
            <span class="adm-label">直播间链接 liveUrl</span>
            <input
              v-model="form.liveUrl"
              class="adm-input"
              type="text"
              data-testid="settings-live"
              placeholder="https://live.bilibili.com/123"
            />
          </label>

          <label class="adm-field">
            <span class="adm-label">ICP 备案号（可留空）</span>
            <input
              v-model="form.icp"
              class="adm-input"
              type="text"
              data-testid="settings-icp"
              placeholder="例如：京ICP备2023000000号-1"
            />
            <span class="adm-hint">填了就会显示在页脚，并链接到工信部备案系统</span>
          </label>

          <label class="adm-field">
            <span class="adm-label">公安备案号（可留空）</span>
            <input
              v-model="form.police"
              class="adm-input"
              type="text"
              data-testid="settings-police"
              placeholder="例如：京公网安备11010502030123号"
            />
            <span class="adm-hint">
              也支持只填那串数字（11010502030123），页脚会自动补成「公网安备 … 号」，
              并链接到全国互联网安全管理服务平台的查询页
            </span>
          </label>

          <label class="adm-field">
            <span class="adm-label">公告 notice（支持多行，可留空）</span>
            <textarea
              v-model="form.notice"
              class="adm-textarea"
              data-testid="settings-notice"
              placeholder="例如：点歌请先关注；SC 曲目请先看备注"
            />
          </label>
        </div>
      </section>

      <section class="adm-card">
        <div class="adm-card-head">
          <div>
            <h3>背景与外观</h3>
            <p>全屏背景图用于侧栏式布局；不传就用渐变底色</p>
          </div>
        </div>

        <div class="adm-view">
          <ImagePicker
            v-model="form.background"
            label="全屏背景图"
            shape="wide"
            data-testid="settings-background"
          />

          <label class="adm-field">
            <span class="adm-label">背景图焦点（竖构图插画在宽屏会被裁切）</span>
            <AdminSelect
              v-model="form.backgroundPosition"
              :options="bgPositionOptions"
              testid="settings-bg-pos"
            />
            <span class="adm-hint">建议竖构图人像选「保住上方」</span>
          </label>

          <VideoPicker v-model="form.backgroundVideo" label="背景视频（有就用它，优先于背景图）" />
          <span class="adm-hint">
            传了视频就优先播视频，背景图会退化成视频封面（首帧出来前先显示它）。
            只在宽屏播放；手机上只用背景图 —— 省流量，也避开 iOS 的自动播放限制。
          </span>
        </div>
      </section>

      <section class="adm-card">
        <div class="adm-card-head">
          <div>
            <h3>当前已保存的值</h3>
            <p>保存成功后这里会跟着更新，方便对照</p>
          </div>
          <button type="button" class="adm-button is-small" @click="restoreDefaults">填入默认值</button>
        </div>

        <div class="adm-audit">
          <div class="adm-audit-row">
            <span class="adm-audit-action">主播名</span>
            <span class="adm-audit-detail">{{ saved.streamerName || '（空）' }}</span>
          </div>
          <div class="adm-audit-row">
            <span class="adm-audit-action">直播间</span>
            <span class="adm-audit-detail">{{ saved.liveUrl || '（空）' }}</span>
          </div>
          <div class="adm-audit-row">
            <span class="adm-audit-action">ICP 备案号</span>
            <span class="adm-audit-detail">{{ saved.icp || '（空）' }}</span>
          </div>
          <div class="adm-audit-row">
            <span class="adm-audit-action">公安备案号</span>
            <span class="adm-audit-detail">{{ saved.police || '（空）' }}</span>
          </div>
          <div class="adm-audit-row">
            <span class="adm-audit-action">公告</span>
            <span class="adm-audit-detail" style="white-space: pre-wrap">{{ saved.notice || '（空）' }}</span>
          </div>
          <div class="adm-audit-row">
            <span class="adm-audit-action">背景图</span>
            <span class="adm-audit-detail">{{ saved.background || '（未设置，用渐变底色）' }}</span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
