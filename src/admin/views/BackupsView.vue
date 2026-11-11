<script setup lang="ts">
/**
 * 备份与导出：列表 + 手动备份 + 回滚 + 下载 + 删除，另加导出区和审计日志。
 * 回滚会整个覆盖数据库，所以用「强确认」（要敲一遍「回滚」）。
 */
import { computed, onMounted, ref } from 'vue'
import AdminPager from '../components/AdminPager.vue'
import {
  api,
  backupDownloadUrl,
  downloadUrl,
  exportUrl,
  type AuditItem,
  type BackupInfo,
} from '../api'
import { confirmDialog } from '../useConfirm'
import { useAdminToast } from '../useToast'
import { auditActionText, backupReasonText, formatBytes, formatTime } from '../utils'

const { show, error } = useAdminToast()

const backups = ref<BackupInfo[]>([])
const keep = ref(60)
const loading = ref(true)
const loadError = ref('')
const busy = ref<number | 'create' | null>(null)

const auditItems = ref<AuditItem[]>([])
const auditOpen = ref(false)
const auditLoading = ref(false)

/* 列表可能很长（默认留 60 份，但历史数据会更多），做前端分页 */
const page = ref(1)
const pageSize = ref(20)
const pagedBackups = computed(() => backups.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const result = await api.backups()
    backups.value = result.backups
    keep.value = result.keep
    if (page.value > Math.max(1, Math.ceil(backups.value.length / pageSize.value))) page.value = 1
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

async function loadAudit() {
  auditLoading.value = true
  try {
    const result = await api.audit(100)
    auditItems.value = result.items
  } catch (err) {
    error((err as Error).message)
  } finally {
    auditLoading.value = false
  }
}

async function toggleAudit() {
  auditOpen.value = !auditOpen.value
  if (auditOpen.value && !auditItems.value.length) await loadAudit()
}

async function createBackup() {
  busy.value = 'create'
  try {
    const result = await api.createBackup()
    show(`已创建备份 #${result.backup.id}（${result.backup.songCount} 首）`)
    await load()
  } catch (err) {
    error((err as Error).message)
  } finally {
    busy.value = null
  }
}

async function restore(backup: BackupInfo) {
  const ok = await confirmDialog({
    title: '回滚到这个备份（危险）',
    message:
      `备份 #${backup.id}（${formatTime(backup.createdAt)}，${backup.songCount} 首）会整体覆盖当前数据库，\n` +
      '包括歌曲、站点设置和主播资料。\n' +
      '当前数据会先被自动备份成一份 before-restore，回滚完还能再切回来。',
    confirmText: '确认回滚',
    danger: true,
    expectedText: '回滚',
  })
  if (!ok) return
  busy.value = backup.id
  try {
    const result = await api.restoreBackup(backup.id)
    show(`已回滚到备份 #${backup.id}，当前共 ${result.total} 首`)
    await load()
  } catch (err) {
    error((err as Error).message)
  } finally {
    busy.value = null
  }
}

async function remove(backup: BackupInfo) {
  const ok = await confirmDialog({
    title: '删除备份',
    message: `确定删除备份 #${backup.id}（${formatTime(backup.createdAt)}）吗？\n备份文件会一起从磁盘删掉，无法恢复。`,
    confirmText: '删除',
    danger: true,
  })
  if (!ok) return
  busy.value = backup.id
  try {
    await api.deleteBackup(backup.id)
    show('备份已删除')
    await load()
  } catch (err) {
    error((err as Error).message)
  } finally {
    busy.value = null
  }
}

function download(backup: BackupInfo) {
  downloadUrl(backupDownloadUrl(backup.id))
  show('已开始下载备份文件')
}

function exportFile(format: 'txt' | 'json') {
  downloadUrl(exportUrl(format))
  show(format === 'txt' ? '已开始下载 list.txt' : '已开始下载完整 JSON 快照')
}

onMounted(() => void load())
</script>

<template>
  <div class="adm-view">
    <div class="adm-view-head">
      <div>
        <h2 data-testid="view-title">备份与导出</h2>
        <p>最多保留 {{ keep }} 份备份；任何写操作前都会自动留一份（同类操作 5 分钟节流）</p>
      </div>
      <div class="adm-toolbar">
        <button type="button" class="adm-button is-small" @click="load">刷新</button>
        <button
          type="button"
          class="adm-button is-primary"
          data-testid="backup-create"
          :disabled="busy === 'create'"
          @click="createBackup"
        >
          {{ busy === 'create' ? '备份中…' : '立即手动备份' }}
        </button>
      </div>
    </div>

    <!-- 导出 -->
    <section class="adm-card">
      <div class="adm-card-head">
        <div>
          <h3>导出</h3>
          <p>list.txt 可以直接回填表格；JSON 是歌曲 + 设置 + 资料的完整快照</p>
        </div>
      </div>
      <div class="adm-inline">
        <button type="button" class="adm-button" data-testid="export-txt" @click="exportFile('txt')">
          下载 list.txt
        </button>
        <button type="button" class="adm-button" data-testid="export-json" @click="exportFile('json')">
          下载完整 JSON
        </button>
      </div>
    </section>

    <!-- 备份列表 -->
    <section class="adm-card">
      <div class="adm-card-head">
        <div>
          <h3>备份列表</h3>
          <p>共 {{ backups.length }} 份</p>
        </div>
      </div>

      <div v-if="loading" class="adm-loading"><span class="adm-spinner" />正在加载备份列表…</div>

      <div v-else-if="loadError" class="adm-card">
        <p class="adm-error-text">{{ loadError }}</p>
        <button type="button" class="adm-button is-small" style="margin-top: 10px" @click="load">重试</button>
      </div>

      <template v-else>
        <div class="adm-table-wrap">
          <table class="adm-table">
            <thead>
              <tr>
                <th>#</th>
                <th>时间</th>
                <th>原因</th>
                <th>歌曲数</th>
                <th>文件大小</th>
                <th>文件名</th>
                <th class="adm-col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="backup in pagedBackups" :key="backup.id" data-testid="backup-row">
                <td class="adm-num">{{ backup.id }}</td>
                <td class="adm-num">{{ formatTime(backup.createdAt) }}</td>
                <td>{{ backupReasonText(backup.reason) }}</td>
                <td class="adm-num">{{ backup.songCount }}</td>
                <td class="adm-num">{{ formatBytes(backup.bytes) }}</td>
                <td><span class="adm-ellipsis" :title="backup.file">{{ backup.file }}</span></td>
                <td class="adm-col-actions">
                  <div class="adm-cell-actions">
                    <button
                      type="button"
                      class="adm-button is-small"
                      data-testid="backup-restore"
                      :disabled="busy === backup.id"
                      @click="restore(backup)"
                    >
                      回滚
                    </button>
                    <button type="button" class="adm-button is-small" @click="download(backup)">下载</button>
                    <button
                      type="button"
                      class="adm-button is-small is-danger"
                      :disabled="busy === backup.id"
                      @click="remove(backup)"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>

          <p v-if="!backups.length" class="adm-empty">还没有备份，点右上角「立即手动备份」试试</p>
        </div>

        <AdminPager
          v-if="backups.length > pageSize"
          v-model:page="page"
          v-model:page-size="pageSize"
          :total="backups.length"
          :page-sizes="[10, 20, 50]"
          style="margin-top: 12px"
        />
      </template>
    </section>

    <!-- 审计日志 -->
    <section class="adm-card">
      <div class="adm-card-head">
        <div>
          <h3>最近操作日志</h3>
          <p>服务端只保留最近 500 条</p>
        </div>
        <button type="button" class="adm-button is-small" @click="toggleAudit">
          {{ auditOpen ? '收起' : '展开' }}
        </button>
      </div>

      <template v-if="auditOpen">
        <div v-if="auditLoading" class="adm-loading"><span class="adm-spinner" />正在加载日志…</div>
        <div v-else class="adm-audit">
          <div v-for="item in auditItems" :key="item.id" class="adm-audit-row">
            <span class="adm-audit-time">{{ formatTime(item.createdAt) }}</span>
            <span class="adm-audit-action">{{ auditActionText(item.action) }}</span>
            <span class="adm-audit-detail">{{ item.detail || '—' }}</span>
            <span class="adm-audit-time">{{ item.ip }}</span>
          </div>
          <p v-if="!auditItems.length" class="adm-empty">还没有日志</p>
        </div>
      </template>
    </section>
  </div>
</template>
