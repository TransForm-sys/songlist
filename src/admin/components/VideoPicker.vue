<script setup lang="ts">
/**
 * 视频选择器（背景视频用）。
 *
 * 和 ImagePicker 是同一套路（FileReader → base64 → /api/admin/upload），
 * 区别是预览用 <video> 且默认静音自动循环 —— 就是前台的播放方式。
 */
import { computed, ref } from 'vue'
import { api } from '../api'
import { useAdminToast } from '../useToast'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: string
    /** 允许的类型；默认 mp4 + webm */
    accept?: string
  }>(),
  { accept: 'video/mp4,video/webm' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { show, error } = useAdminToast()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

const preview = computed(() => props.modelValue.trim())

function pick() {
  fileInput.value?.click()
}

function clear() {
  emit('update:modelValue', '')
  if (fileInput.value) fileInput.value.value = ''
}

async function onChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return

  if (!/^video\/(mp4|webm)$/.test(file.type)) {
    error('只支持 mp4 / webm 视频')
    return
  }
  // 服务端上限 8MB（base64 后请求体还会再大 1/3）
  if (file.size > 8 * 1024 * 1024) {
    error(`视频太大了（${(file.size / 1024 / 1024).toFixed(1)}MB，上限 8MB）`)
    return
  }

  uploading.value = true
  try {
    const dataUrl = await readAsDataURL(file)
    const result = await api.upload(file.name, dataUrl)
    emit('update:modelValue', result.url)
    show(`已上传，${(result.bytes / 1024 / 1024).toFixed(1)}MB`)
  } catch (err) {
    error((err as Error).message)
  } finally {
    uploading.value = false
  }
}

/** FileReader 而不是 canvas：后端要的就是原始 dataUrl */
function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}
</script>

<template>
  <div class="adm-field">
    <span class="adm-label">{{ label }}</span>

    <div class="adm-video-picker">
      <div class="adm-video-preview">
        <video
          v-if="preview"
          :src="preview"
          muted
          loop
          autoplay
          playsinline
          preload="metadata"
        />
        <span v-else class="adm-video-empty">未上传</span>
      </div>

      <div class="adm-video-actions">
        <input
          ref="fileInput"
          type="file"
          :accept="accept"
          hidden
          data-testid="bg-video-input"
          @change="onChange"
        />
        <button
          type="button"
          class="adm-button is-small"
          :disabled="uploading"
          data-testid="bg-video-pick"
          @click="pick"
        >
          {{ uploading ? '上传中…' : preview ? '重新选择' : '选择视频' }}
        </button>
        <button
          v-if="preview"
          type="button"
          class="adm-button is-small"
          data-testid="bg-video-clear"
          @click="clear"
        >
          清空
        </button>
        <span class="adm-hint">mp4 / webm，≤8MB，建议 10 秒左右的无声循环</span>
      </div>
    </div>

    <p v-if="preview" class="adm-hint adm-video-url">{{ preview }}</p>
  </div>
</template>
