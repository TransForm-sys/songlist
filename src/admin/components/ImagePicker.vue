<script setup lang="ts">
import { computed, ref } from 'vue'
import { api } from '../api'
import { useAdminToast } from '../useToast'

const props = withDefaults(
  defineProps<{
    label: string
    modelValue: string
    /** 预览的长宽比：头像是圆的，封面是宽条 */
    shape?: 'circle' | 'wide'
  }>(),
  { shape: 'circle' },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { show, error } = useAdminToast()
const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)

const preview = computed(() => props.modelValue.trim())

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // 选完立刻清空 value，否则再选同一个文件不会触发 change
  input.value = ''
  if (!file) return

  if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type)) {
    error('只支持 png / jpeg / webp / gif / svg 图片')
    return
  }
  if (file.size > 3 * 1024 * 1024) {
    error('图片超过 3MB，请先压缩再上传')
    return
  }

  uploading.value = true
  try {
    const dataUrl = await readAsDataURL(file)
    const result = await api.upload(file.name, dataUrl)
    emit('update:modelValue', result.url)
    show(`已上传（${Math.round(result.bytes / 1024)}KB）`)
  } catch (err) {
    error((err as Error).message)
  } finally {
    uploading.value = false
  }
}

/** FileReader 而不是 canvas：后端要的就是原始 dataUrl，转一次就够 */
function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}
</script>

<template>
  <div class="adm-image-picker">
    <div class="adm-image-preview" :class="`is-${shape}`">
      <img v-if="preview" :src="preview" :alt="label" />
      <span v-else class="adm-image-placeholder">无图</span>
    </div>

    <div class="adm-image-fields">
      <label class="adm-field">
        <span class="adm-label">{{ label }}地址</span>
        <input
          class="adm-input"
          type="text"
          :value="modelValue"
          placeholder="/uploads/xxx.png 或 https://…"
          @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        />
      </label>

      <div class="adm-inline">
        <button type="button" class="adm-button is-small" :disabled="uploading" @click="fileInput?.click()">
          {{ uploading ? '上传中…' : '选择本地图片' }}
        </button>
        <button
          type="button"
          class="adm-button is-small"
          :disabled="!modelValue"
          @click="emit('update:modelValue', '')"
        >
          清空
        </button>
        <span class="adm-hint">png / jpeg / webp / gif / svg，≤3MB</span>
      </div>

      <input
        ref="fileInput"
        class="adm-hidden-input"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        @change="onFile"
      />
    </div>
  </div>
</template>
