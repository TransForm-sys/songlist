<script setup lang="ts">
/**
 * 新增 / 编辑单曲的表单。用 reactive 复制一份本地副本，
 * 这样「取消」不会把编辑到一半的内容写进列表行里。
 */
import { reactive, watch } from 'vue'
import AdminSwitch from './AdminSwitch.vue'
import type { AdminSong, SongInput } from '../api'

const props = defineProps<{
  song: AdminSong | null
  saving: boolean
  /** 歌单里一个 SC 歌都没有时，这个字段整个不显示 */
  showSc?: boolean
}>()

const emit = defineEmits<{ submit: [value: SongInput]; cancel: [] }>()

function fromSong(song: AdminSong | null): SongInput {
  return {
    title: song?.title ?? '',
    singer: song?.singer ?? '',
    language: song?.language ?? '',
    genre: song?.genre ?? '',
    sc: song?.sc ?? '',
    note: song?.note ?? '',
    isNew: song?.isNew ?? false,
  }
}

const form = reactive<SongInput>(fromSong(props.song))
const localError = reactive({ message: '' })

// 弹窗复用同一个组件，切换编辑对象时要重新灌一遍表单
watch(
  () => props.song,
  (song) => {
    Object.assign(form, fromSong(song))
    localError.message = ''
  },
)

function submit() {
  if (!form.title.trim()) {
    localError.message = '歌名不能为空'
    return
  }
  localError.message = ''
  emit('submit', {
    title: form.title.trim(),
    singer: form.singer.trim(),
    language: form.language.trim(),
    genre: form.genre.trim(),
    sc: form.sc.trim(),
    note: form.note.trim(),
    isNew: form.isNew,
  })
}
</script>

<template>
  <form class="adm-form" @submit.prevent="submit">
    <label class="adm-field">
      <span class="adm-label">歌名 *</span>
      <input
        v-model="form.title"
        class="adm-input"
        type="text"
        placeholder="例如：渡口"
        data-testid="song-form-title"
      />
    </label>

    <div class="adm-grid-2">
      <label class="adm-field">
        <span class="adm-label">歌手</span>
        <input
          v-model="form.singer"
          class="adm-input"
          type="text"
          placeholder="多人用 / 分隔"
          data-testid="song-form-singer"
        />
      </label>

      <label class="adm-field">
        <span class="adm-label">语种</span>
        <input
          v-model="form.language"
          class="adm-input"
          type="text"
          placeholder="中文 / 日语 / 粤语"
          data-testid="song-form-language"
        />
      </label>

      <label class="adm-field">
        <span class="adm-label">曲风</span>
        <input
          v-model="form.genre"
          class="adm-input"
          type="text"
          placeholder="中文流行 / VOCALOID"
          data-testid="song-form-genre"
        />
      </label>

      <label v-if="showSc" class="adm-field">
        <span class="adm-label">需要 SC（礼物名，留空为普通点歌）</span>
        <input
          v-model="form.sc"
          class="adm-input"
          type="text"
          placeholder="例如：星愿水晶球"
          data-testid="song-form-sc"
        />
      </label>
    </div>

    <label class="adm-field">
      <span class="adm-label">备注</span>
      <input
        v-model="form.note"
        class="adm-input"
        type="text"
        placeholder="写「付费曲」会在前台显示礼物图标（不显示文字）"
        data-testid="song-form-note"
      />
    </label>

    <AdminSwitch v-model="form.isNew" label="标记为「新歌」" testid="song-form-isnew" />

    <p v-if="localError.message" class="adm-error-text">{{ localError.message }}</p>

    <div class="adm-inline" style="justify-content: flex-end">
      <button type="button" class="adm-button" @click="emit('cancel')">取消</button>
      <button type="submit" class="adm-button is-primary" data-testid="song-form-save" :disabled="saving">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </div>
  </form>
</template>
