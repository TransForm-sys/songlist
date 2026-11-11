<script setup lang="ts">
/**
 * 批量导入：粘贴表格 → 前端解析 → 预览 → 提交结构化数组。
 * 解析复用前台那套 parseSongList（列名识别、跳过缺歌名的行、识别主播信息）。
 */
import { computed, ref } from 'vue'
import { api, type BulkResult, type SongInput } from '../api'
import { confirmDialog } from '../useConfirm'
import { useAdminToast } from '../useToast'
import { parseSongList } from '../../utils/parse'
import type { ParsedSongList } from '../../types'

const emit = defineEmits<{ navigate: [view: 'songs'] }>()

const { show, error } = useAdminToast()

const text = ref('')
const parsed = ref<ParsedSongList | null>(null)
const parseError = ref('')
const expanded = ref(false)

const mode = ref<'append' | 'replace'>('append')
const importing = ref(false)
const result = ref<BulkResult | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)

/* 可选的字段统一覆盖 */
const override = ref({ language: '', genre: '', sc: '', isNew: false, useLanguage: false, useGenre: false, useSc: false, useIsNew: false })

const canImport = computed(() => Boolean(parsed.value?.songs.length))

function runParse() {
  result.value = null
  parseError.value = ''
  parsed.value = null

  const raw = text.value
  if (!raw.trim()) {
    parseError.value = '还没有内容，先把表格整块复制粘贴进来'
    return
  }
  try {
    parsed.value = parseSongList(raw)
    expanded.value = false
  } catch (err) {
    parseError.value = (err as Error).message
  }
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    text.value = await file.text()
    runParse()
    show(`已读取 ${file.name}`)
  } catch {
    error('文件读不出来，换一个编码为 UTF-8 的文本文件试试')
  }
}

function clearAll() {
  text.value = ''
  parsed.value = null
  parseError.value = ''
  result.value = null
}

/** 把可选覆盖项应用到解析结果上，得到真正要提交的数组 */
function buildItems(): SongInput[] {
  const songs = parsed.value?.songs ?? []
  return songs.map((song) => ({
    title: song.title,
    singer: song.singer,
    language: override.value.useLanguage ? override.value.language.trim() : song.language,
    genre: override.value.useGenre ? override.value.genre.trim() : song.genre,
    sc: override.value.useSc ? override.value.sc.trim() : song.sc,
    // 备注必须一起提交：前台靠它判断「付费曲」并显示礼物图标，
    // 漏掉这个字段的话导入后所有备注都会被清空（之前就是漏了）
    note: song.note,
    isNew: override.value.useIsNew ? override.value.isNew : song.isNew,
  }))
}

async function submit() {
  if (!canImport.value || importing.value) return
  const items = buildItems()
  const count = items.length

  if (mode.value === 'replace') {
    const ok = await confirmDialog({
      title: '覆盖导入（危险）',
      message:
        `这会**清空现有全部歌曲**，再写入本次的 ${count} 首。\n` +
        '服务端会在覆盖前自动留一份 before-replace 备份，但清空动作本身不可撤销。\n' +
        '如果只是想补充新歌，请改用「追加」。',
      confirmText: '确认覆盖导入',
      danger: true,
      expectedText: '覆盖导入',
    })
    if (!ok) return
  }

  importing.value = true
  try {
    const payload = await api.bulkImport(mode.value, items)
    result.value = payload
    show(`导入完成：新增 ${payload.added} 首，重复 ${payload.duplicateCount} 首`)
    // 导入后原文就过期了，清掉避免用户以为还能再点一次
    parsed.value = null
    text.value = ''
  } catch (err) {
    error((err as Error).message)
  } finally {
    importing.value = false
  }
}

const previewSongs = computed(() => buildItems().slice(0, 20))

/**
 * 待导入的内容里有没有 SC 字段。
 * 没有就把预览表的「需要 SC」列和「统一 SC」选项都藏起来 ——
 * 主播不用 SC 点歌时，界面上不该出现付费相关字眼；粘贴的表里带这一列时会自动恢复。
 */
const parsedHasSc = computed(() => buildItems().some((song) => Boolean(song.sc)))
</script>

<template>
  <div class="adm-view">
    <div class="adm-view-head">
      <div>
        <h2 data-testid="view-title">批量导入</h2>
        <p>从 Excel / 腾讯文档 / 飞书表格里整块复制粘贴，前端解析后再提交给后端</p>
      </div>
      <button type="button" class="adm-button is-small" @click="emit('navigate', 'songs')">返回曲库</button>
    </div>

    <div class="adm-import-layout">
      <!-- 左：输入 -->
      <section class="adm-card">
        <div class="adm-card-head">
          <div>
            <h3>粘贴内容</h3>
            <p>含「歌名」列的表头行会被自动识别，前两行主播信息会认成 meta</p>
          </div>
        </div>

        <textarea
          v-model="text"
          class="adm-textarea adm-paste"
          data-testid="import-textarea"
          placeholder="从 Excel / 腾讯文档 / 飞书表格里直接复制整块内容粘进来（保留制表符分隔）"
        />

        <div class="adm-toolbar" style="margin-top: 10px">
          <button type="button" class="adm-button is-small" @click="fileInput?.click()">选择本地文件</button>
          <button type="button" class="adm-button is-small is-primary" data-testid="import-parse" @click="runParse">
            解析预览
          </button>
          <button type="button" class="adm-button is-small is-ghost" @click="clearAll">清空</button>
          <span class="adm-hint">支持 .txt / .csv / .tsv（表格导出的制表符分隔文本）</span>
        </div>

        <input
          ref="fileInput"
          class="adm-hidden-input"
          type="file"
          accept=".txt,.csv,.tsv,text/plain"
          @change="onFile"
        />

        <p v-if="parseError" class="adm-error-text" style="margin-top: 10px">{{ parseError }}</p>
      </section>

      <!-- 右：预览与提交 -->
      <section class="adm-card">
        <div class="adm-card-head">
          <div>
            <h3>解析结果</h3>
            <p v-if="parsed">
              识别到主播「{{ parsed.meta.streamerName || '未识别' }}」
              {{ parsed.meta.liveUrl ? `· ${parsed.meta.liveUrl}` : '' }}
            </p>
            <p v-else>粘贴后点「解析预览」</p>
          </div>
        </div>

        <template v-if="parsed">
          <div class="adm-import-summary">
            <div class="adm-stat">
              <span class="adm-stat-value adm-num">{{ buildItems().length }}</span>
              <span class="adm-stat-label">将新增</span>
            </div>
            <div class="adm-stat">
              <span class="adm-stat-value adm-num">{{ parsed.skippedRows }}</span>
              <span class="adm-stat-label">跳过（缺歌名）</span>
            </div>
          </div>

          <button type="button" class="adm-link" style="align-self: flex-start" @click="expanded = !expanded">
            {{ expanded ? '收起' : `展开前 ${previewSongs.length} 条预览` }}
          </button>

          <div v-if="expanded" class="adm-preview-table-wrap">
            <table class="adm-table" style="min-width: 640px">
              <thead>
                <tr>
                  <th>歌名</th>
                  <th>歌手</th>
                  <th>语种</th>
                  <th>曲风</th>
                  <th v-if="parsedHasSc">需要 SC</th>
                  <th>备注</th>
                  <th>新</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(song, index) in previewSongs" :key="index">
                  <td><span class="adm-ellipsis">{{ song.title }}</span></td>
                  <td>{{ song.singer || '—' }}</td>
                  <td>{{ song.language || '—' }}</td>
                  <td>{{ song.genre || '—' }}</td>
                  <td v-if="parsedHasSc">{{ song.sc || '—' }}</td>
                  <td>{{ song.note || '—' }}</td>
                  <td>{{ song.isNew ? '新' : '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <h4 style="margin: 4px 0 0; font-size: 13px">导入模式</h4>
          <div class="adm-inline">
            <label class="adm-inline">
              <input v-model="mode" type="radio" value="append" data-testid="import-mode-append" />
              追加（保留现有歌，重复的自动跳过）
            </label>
            <label class="adm-inline">
              <input v-model="mode" type="radio" value="replace" data-testid="import-mode-replace" />
              覆盖（清空后导入）
            </label>
          </div>
          <p v-if="mode === 'replace'" class="adm-error-text">
            覆盖会清空现有全部歌曲，服务端会先自动备一份 before-replace。
            服务端按「歌名 + 歌手 + 其他字段完全一致」判断重复，重复项会被跳过，
            所以覆盖后的曲库可能比预期少。
          </p>

          <h4 style="margin: 4px 0 0; font-size: 13px">导入时统一设置（可选）</h4>
          <div class="adm-bulk-field">
            <label class="adm-inline">
              <input v-model="override.useLanguage" type="checkbox" />
              统一语种
            </label>
            <input
              v-model="override.language"
              class="adm-input"
              type="text"
              placeholder="例如：中文"
              :disabled="!override.useLanguage"
            />
          </div>
          <div class="adm-bulk-field">
            <label class="adm-inline">
              <input v-model="override.useGenre" type="checkbox" />
              统一曲风
            </label>
            <input
              v-model="override.genre"
              class="adm-input"
              type="text"
              placeholder="例如：中文流行"
              :disabled="!override.useGenre"
            />
          </div>
          <div v-if="parsedHasSc" class="adm-bulk-field">
            <label class="adm-inline">
              <input v-model="override.useSc" type="checkbox" />
              统一「需要 SC」
            </label>
            <input
              v-model="override.sc"
              class="adm-input"
              type="text"
              placeholder="礼物名；留空表示清空该字段"
              :disabled="!override.useSc"
            />
          </div>
          <div class="adm-inline">
            <label class="adm-inline">
              <input v-model="override.useIsNew" type="checkbox" />
              统一「新歌」标记
            </label>
            <label class="adm-inline">
              <input v-model="override.isNew" type="checkbox" :disabled="!override.useIsNew" />
              标记为新歌
            </label>
          </div>

          <div class="adm-inline" style="justify-content: flex-end">
            <button
              type="button"
              class="adm-button is-primary"
              data-testid="import-submit"
              :disabled="!canImport || importing"
              @click="submit"
            >
              {{ importing ? '导入中…' : `提交导入 ${buildItems().length} 首` }}
            </button>
          </div>
        </template>

        <p v-else class="adm-empty">还没有解析结果</p>
      </section>
    </div>

    <!-- 导入结果 -->
    <section v-if="result" class="adm-card" data-testid="import-result">
      <div class="adm-card-head">
        <div>
          <h3>导入结果</h3>
          <p>模式：{{ result.mode === 'replace' ? '覆盖' : '追加' }}</p>
        </div>
        <button type="button" class="adm-button is-small" @click="emit('navigate', 'songs')">去看曲库</button>
      </div>

      <div class="adm-import-summary">
        <div class="adm-stat">
          <span class="adm-stat-value adm-num">{{ result.received }}</span>
          <span class="adm-stat-label">提交条数</span>
        </div>
        <div class="adm-stat">
          <span class="adm-stat-value adm-num">{{ result.added }}</span>
          <span class="adm-stat-label">实际新增</span>
        </div>
        <div class="adm-stat">
          <span class="adm-stat-value adm-num">{{ result.skipped }}</span>
          <span class="adm-stat-label">跳过（缺歌名）</span>
        </div>
        <div class="adm-stat">
          <span class="adm-stat-value adm-num">{{ result.duplicateCount }}</span>
          <span class="adm-stat-label">重复跳过</span>
        </div>
        <div class="adm-stat">
          <span class="adm-stat-value adm-num">{{ result.similarCount }}</span>
          <span class="adm-stat-label">疑似重复（已导入）</span>
        </div>
        <div class="adm-stat">
          <span class="adm-stat-value adm-num">{{ result.total }}</span>
          <span class="adm-stat-label">导入后总数</span>
        </div>
      </div>

      <div v-if="result.duplicates.length" style="margin-top: 12px">
        <h4 style="margin: 0 0 6px; font-size: 13px">
          被判定重复的歌曲（最多显示 50 条，按「歌名 + 歌手 + 其他字段」完全一致比对）
        </h4>
        <div class="adm-audit">
          <div v-for="(item, index) in result.duplicates" :key="index" class="adm-audit-row">
            <span class="adm-audit-action">{{ item.title }}</span>
            <span class="adm-audit-detail">{{ item.singer || '（无歌手）' }}</span>
          </div>
        </div>
      </div>

      <div v-if="result.similar?.length" style="margin-top: 12px">
        <h4 style="margin: 0 0 6px; font-size: 13px">
          疑似重复但仍导入了 {{ result.similarCount }} 首（歌名 + 歌手相同、其他字段不同）
        </h4>
        <div class="adm-audit">
          <div v-for="(item, index) in result.similar" :key="index" class="adm-audit-row">
            <span class="adm-audit-action">{{ item.title }}</span>
            <span class="adm-audit-detail">{{ item.singer || '（无歌手）' }}</span>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
