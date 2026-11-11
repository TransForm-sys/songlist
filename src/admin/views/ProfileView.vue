<script setup lang="ts">
/**
 * 主播资料：编辑 profile 整体并保存（后端是整体覆盖）。
 *
 * blocks 是有类型的数组，这里用一份「宽类型」的本地副本（DirtyBlock）来编辑，
 * 保存前再收窄成 ProfileBlock，省掉一堆 as 断言。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import ImagePicker from '../components/ImagePicker.vue'
import AdminSelect from '../components/AdminSelect.vue'
import { api } from '../api'
import { useAdminToast } from '../useToast'
import type { Profile, ProfileBlock } from '../../types'

const { show, error } = useAdminToast()

type BlockType = ProfileBlock['type']

interface DirtyBlock {
  key: number
  type: BlockType
  title: string
  content: string
  items: string[]
  pairs: { label: string; value: string }[]
}

const loading = ref(true)
const saving = ref(false)
const loadError = ref('')

const form = reactive({
  title: '',
  bio: '',
  avatar: '',
  cover: '',
  tags: [] as string[],
  links: [] as { label: string; url: string }[],
  blocks: [] as DirtyBlock[],
})

let blockSeq = 0

/* ------------------------------ 载入 ------------------------------ */

function toDirty(block: ProfileBlock): DirtyBlock {
  const base: DirtyBlock = {
    key: ++blockSeq,
    type: block.type,
    title: typeof block.title === 'string' ? block.title : '',
    content: '',
    items: [],
    pairs: [],
  }
  if (block.type === 'notice' || block.type === 'text') base.content = block.content ?? ''
  else if (block.type === 'list') base.items = [...(block.items ?? [])]
  else base.pairs = (block.items ?? []).map((item) => ({ ...item }))
  return base
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const { profile } = await api.getProfile()
    const data: Profile = profile ?? {}
    form.title = data.title ?? ''
    form.bio = data.bio ?? ''
    form.avatar = data.avatar ?? ''
    form.cover = data.cover ?? ''
    form.tags = [...(data.tags ?? [])]
    form.links = (data.links ?? []).map((link) => ({ ...link }))
    form.blocks = (data.blocks ?? []).map(toDirty)
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

/* ------------------------------ 标签 / 链接 ------------------------------ */

function addTag() {
  form.tags = [...form.tags, '']
}

function removeTag(index: number) {
  form.tags = form.tags.filter((_, i) => i !== index)
}

function addLink() {
  form.links = [...form.links, { label: '', url: '' }]
}

function removeLink(index: number) {
  form.links = form.links.filter((_, i) => i !== index)
}

function moveLink(index: number, delta: number) {
  const next = [...form.links]
  const target = index + delta
  if (target < 0 || target >= next.length) return
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  form.links = next
}

/* ------------------------------ blocks ------------------------------ */

function addBlock(type: BlockType) {
  form.blocks = [
    ...form.blocks,
    {
      key: ++blockSeq,
      type,
      title: '',
      content: '',
      items: type === 'list' ? [''] : [],
      pairs: type === 'kv' ? [{ label: '', value: '' }] : [],
    },
  ]
}

function removeBlock(index: number) {
  form.blocks = form.blocks.filter((_, i) => i !== index)
}

function moveBlock(index: number, delta: number) {
  const next = [...form.blocks]
  const target = index + delta
  if (target < 0 || target >= next.length) return
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  form.blocks = next
}

/** 换类型时清掉不属于新类型的内容，避免保存出多余字段 */
function changeBlockType(block: DirtyBlock, type: BlockType) {
  block.type = type
  if (type !== 'list') block.items = []
  if (type !== 'kv') block.pairs = []
  if (type === 'list' && block.items.length === 0) block.items = ['']
  if (type === 'kv' && block.pairs.length === 0) block.pairs = [{ label: '', value: '' }]
  if (type === 'list' || type === 'kv') block.content = ''
}

const blockTypeOptions: { value: BlockType; label: string }[] = [
  { value: 'notice', label: 'notice 公告块' },
  { value: 'text', label: 'text 段落' },
  { value: 'list', label: 'list 列表' },
  { value: 'kv', label: 'kv 键值对' },
]

/* ------------------------------ 保存 ------------------------------ */

function buildBlocks(): ProfileBlock[] {
  const blocks: ProfileBlock[] = []
  for (const block of form.blocks) {
    const title = block.title.trim()
    const head = title ? { title } : {}
    if (block.type === 'notice' || block.type === 'text') {
      blocks.push({ type: block.type, ...head, content: block.content })
    } else if (block.type === 'list') {
      const items = block.items.map((item) => item.trim()).filter(Boolean)
      if (!items.length) continue
      blocks.push({ type: 'list', ...head, items })
    } else {
      const items = block.pairs
        .map((pair) => ({ label: pair.label.trim(), value: pair.value }))
        .filter((pair) => pair.label || pair.value)
      if (!items.length) continue
      blocks.push({ type: 'kv', ...head, items })
    }
  }
  return blocks
}

/** 预览要实时反映编辑内容，所以每条渲染路径都走这里 */
const previewBlocks = computed<ProfileBlock[]>(() => buildBlocks())

function buildProfile(): Profile {
  const profile: Profile = {}
  if (form.title.trim()) profile.title = form.title
  if (form.bio) profile.bio = form.bio
  if (form.avatar.trim()) profile.avatar = form.avatar.trim()
  if (form.cover.trim()) profile.cover = form.cover.trim()
  const tags = form.tags.map((tag) => tag.trim()).filter(Boolean)
  if (tags.length) profile.tags = tags
  const links = form.links
    .map((link) => ({ label: link.label.trim(), url: link.url.trim() }))
    .filter((link) => link.label || link.url)
  if (links.length) profile.links = links
  const blocks = buildBlocks()
  if (blocks.length) profile.blocks = blocks
  return profile
}

async function save() {
  if (saving.value) return
  saving.value = true
  try {
    const profile = buildProfile()
    await api.saveProfile(profile)
    show('主播资料已保存，前台已同步')
  } catch (err) {
    error((err as Error).message)
  } finally {
    saving.value = false
  }
}

onMounted(() => void load())
</script>

<template>
  <div class="adm-view">
    <div class="adm-view-head">
      <div>
        <h2 data-testid="view-title">主播资料</h2>
        <p>对应前台「主播简介」弹窗；保存是整体覆盖</p>
      </div>
      <div class="adm-toolbar">
        <button type="button" class="adm-button is-small" :disabled="loading" @click="load">重新加载</button>
        <button type="button" class="adm-button is-primary" :disabled="saving || loading" @click="save">
          {{ saving ? '保存中…' : '保存资料' }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="adm-loading"><span class="adm-spinner" />正在加载资料…</div>

    <div v-else-if="loadError" class="adm-card">
      <p class="adm-error-text">{{ loadError }}</p>
      <button type="button" class="adm-button is-small" style="margin-top: 10px" @click="load">重试</button>
    </div>

    <div v-else class="adm-profile-layout" data-testid="profile-form">
      <!-- 编辑器 -->
      <div class="adm-view">
        <section class="adm-card">
          <div class="adm-card-head"><h3>基本信息</h3></div>

          <div class="adm-view">
            <label class="adm-field">
              <span class="adm-label">副标题（title）</span>
              <input
                v-model="form.title"
                class="adm-input"
                type="text"
                data-testid="profile-title"
                placeholder="例如：唱歌 / 聊天 / 深夜档"
              />
            </label>

            <label class="adm-field">
              <span class="adm-label">自我介绍（bio）</span>
              <textarea
                v-model="form.bio"
                class="adm-textarea"
                data-testid="profile-bio"
                placeholder="支持换行"
              />
            </label>

            <div>
              <span class="adm-label">头像（avatar）</span>
              <ImagePicker v-model="form.avatar" label="头像" shape="circle" />
            </div>

            <div>
              <span class="adm-label">封面（cover）</span>
              <ImagePicker v-model="form.cover" label="封面" shape="wide" />
            </div>
          </div>
        </section>

        <section class="adm-card">
          <div class="adm-card-head">
            <h3>标签 tags</h3>
            <button type="button" class="adm-button is-small" @click="addTag">＋ 添加标签</button>
          </div>

          <div class="adm-list-editor">
            <div v-for="(tag, index) in form.tags" :key="index" class="adm-list-row">
              <input v-model="form.tags[index]" class="adm-input" type="text" placeholder="标签内容" />
              <button type="button" class="adm-button is-small is-danger" @click="removeTag(index)">删除</button>
            </div>
            <p v-if="!form.tags.length" class="adm-hint">还没有标签</p>
          </div>
        </section>

        <section class="adm-card">
          <div class="adm-card-head">
            <h3>链接 links</h3>
            <button type="button" class="adm-button is-small" @click="addLink">＋ 添加链接</button>
          </div>

          <div class="adm-list-editor">
            <div v-for="(link, index) in form.links" :key="index" class="adm-list-row">
              <label class="adm-field">
                <span class="adm-label">文字</span>
                <input v-model="form.links[index]!.label" class="adm-input" type="text" placeholder="例如：B站" />
              </label>
              <label class="adm-field">
                <span class="adm-label">地址</span>
                <input
                  v-model="form.links[index]!.url"
                  class="adm-input"
                  type="text"
                  placeholder="https://…"
                />
              </label>
              <div class="adm-inline">
                <button type="button" class="adm-button is-small" :disabled="index === 0" @click="moveLink(index, -1)">
                  ↑
                </button>
                <button
                  type="button"
                  class="adm-button is-small"
                  :disabled="index === form.links.length - 1"
                  @click="moveLink(index, 1)"
                >
                  ↓
                </button>
                <button type="button" class="adm-button is-small is-danger" @click="removeLink(index)">删除</button>
              </div>
            </div>
            <p v-if="!form.links.length" class="adm-hint">还没有链接</p>
          </div>
        </section>

        <section class="adm-card">
          <div class="adm-card-head">
            <div>
              <h3>内容块 blocks</h3>
              <p>notice / text / list / kv 四种类型，顺序即前台展示顺序</p>
            </div>
            <div class="adm-inline">
              <button
                v-for="option in blockTypeOptions"
                :key="option.value"
                type="button"
                class="adm-button is-small"
                @click="addBlock(option.value)"
              >
                ＋ {{ option.label }}
              </button>
            </div>
          </div>

          <div class="adm-list-editor">
            <div v-for="(block, index) in form.blocks" :key="block.key" class="adm-card" style="padding: 12px">
              <div class="adm-toolbar" style="margin-bottom: 10px">
                <AdminSelect
                  :model-value="block.type"
                  :options="blockTypeOptions"
                  style="min-width: 150px"
                  @update:model-value="changeBlockType(block, $event as BlockType)"
                />
                <span class="adm-spacer" />
                <button type="button" class="adm-button is-small" :disabled="index === 0" @click="moveBlock(index, -1)">
                  ↑ 上移
                </button>
                <button
                  type="button"
                  class="adm-button is-small"
                  :disabled="index === form.blocks.length - 1"
                  @click="moveBlock(index, 1)"
                >
                  ↓ 下移
                </button>
                <button type="button" class="adm-button is-small is-danger" @click="removeBlock(index)">删除</button>
              </div>

              <label class="adm-field">
                <span class="adm-label">标题（可留空）</span>
                <input v-model="block.title" class="adm-input" type="text" />
              </label>

              <template v-if="block.type === 'notice' || block.type === 'text'">
                <label class="adm-field" style="margin-top: 10px">
                  <span class="adm-label">正文</span>
                  <textarea v-model="block.content" class="adm-textarea" />
                </label>
              </template>

              <template v-else-if="block.type === 'list'">
                <div class="adm-list-editor" style="margin-top: 10px">
                  <div v-for="(_, itemIndex) in block.items" :key="itemIndex" class="adm-list-row">
                    <input v-model="block.items[itemIndex]" class="adm-input" type="text" placeholder="列表项" />
                    <button
                      type="button"
                      class="adm-button is-small is-danger"
                      @click="block.items.splice(itemIndex, 1)"
                    >
                      删除
                    </button>
                  </div>
                  <button type="button" class="adm-button is-small" @click="block.items.push('')">＋ 添加一项</button>
                </div>
              </template>

              <template v-else>
                <div class="adm-list-editor" style="margin-top: 10px">
                  <div v-for="(_, pairIndex) in block.pairs" :key="pairIndex" class="adm-list-row">
                    <input v-model="block.pairs[pairIndex]!.label" class="adm-input" type="text" placeholder="名称" />
                    <input v-model="block.pairs[pairIndex]!.value" class="adm-input" type="text" placeholder="内容" />
                    <button
                      type="button"
                      class="adm-button is-small is-danger"
                      @click="block.pairs.splice(pairIndex, 1)"
                    >
                      删除
                    </button>
                  </div>
                  <button
                    type="button"
                    class="adm-button is-small"
                    @click="block.pairs.push({ label: '', value: '' })"
                  >
                    ＋ 添加一项
                  </button>
                </div>
              </template>
            </div>

            <p v-if="!form.blocks.length" class="adm-hint">还没有内容块，点上面的按钮添加</p>
          </div>
        </section>

        <div class="adm-inline" style="justify-content: flex-end">
          <button type="button" class="adm-button is-primary" data-testid="profile-save" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存资料' }}
          </button>
        </div>
      </div>

      <!-- 实时预览 -->
      <aside class="adm-preview">
        <div class="adm-card-head" style="padding: 12px 16px 0; margin-bottom: 0">
          <div>
            <h3>实时预览</h3>
            <p>排版贴近前台「主播简介」弹窗（不含主播名，主播名在站点设置里）</p>
          </div>
        </div>

        <div
          v-if="form.cover"
          class="adm-preview-cover"
          :style="{ backgroundImage: `url(${form.cover})` }"
        />

        <div class="adm-preview-header" :class="{ 'has-cover': form.cover }">
          <img v-if="form.avatar" class="adm-preview-avatar" :src="form.avatar" alt="头像" />
          <div v-else class="adm-preview-avatar">歌</div>
          <div class="adm-preview-heading">
            <h4>主播名（在站点设置里改）</h4>
            <p v-if="form.title">{{ form.title }}</p>
          </div>
        </div>

        <div class="adm-preview-body">
          <p v-if="form.bio">{{ form.bio }}</p>

          <div v-if="form.tags.filter((tag) => tag.trim()).length" class="adm-preview-tags">
            <span v-for="(tag, index) in form.tags.filter((t) => t.trim())" :key="index" class="adm-preview-tag">
              {{ tag }}
            </span>
          </div>

          <div v-if="form.links.length" class="adm-preview-tags">
            <a
              v-for="(link, index) in form.links.filter((l) => l.label.trim() || l.url.trim())"
              :key="index"
              class="adm-preview-link"
              :href="link.url || '#'"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ link.label || link.url }}
            </a>
          </div>

          <section
            v-for="(block, index) in previewBlocks"
            :key="index"
            class="adm-preview-block"
            :class="{ 'is-notice': block.type === 'notice' }"
          >
            <h5 v-if="block.title">{{ block.title }}</h5>
            <p v-if="block.type === 'notice' || block.type === 'text'">{{ block.content }}</p>
            <ul v-else-if="block.type === 'list'">
              <li v-for="item in block.items" :key="item">{{ item }}</li>
            </ul>
            <dl v-else class="adm-preview-kv">
              <template v-for="(item, i) in block.items" :key="i">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </template>
            </dl>
          </section>

          <p v-if="!form.bio && !previewBlocks.length && !form.tags.length" class="adm-hint">
            还没有内容，左边填一点东西这里就会显示。
          </p>
        </div>
      </aside>
    </div>
  </div>
</template>
