<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import type { Profile, ProfileBlock } from '../types'

const props = defineProps<{
  profile: Profile | null
  name: string
  liveUrl: string
}>()

const emit = defineEmits<{ close: [] }>()

const avatarText = computed(() => props.name.trim().slice(0, 1) || '歌')
const subtitle = computed(() => props.profile?.title || '')
const blocks = computed<ProfileBlock[]>(() =>
  Array.isArray(props.profile?.blocks) ? props.profile!.blocks!.filter(Boolean) : [],
)
const links = computed(() => {
  const list = [...(props.profile?.links ?? [])]
  if (props.liveUrl && !list.some((link) => link.url === props.liveUrl)) {
    list.push({ label: '直播间', url: props.liveUrl })
  }
  return list
})

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  document.body.style.overflow = 'hidden'
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})

function isKv(block: ProfileBlock): block is Extract<ProfileBlock, { type: 'kv' }> {
  return block.type === 'kv'
}

function isList(block: ProfileBlock): block is Extract<ProfileBlock, { type: 'list' }> {
  return block.type === 'list'
}

function hasContent(block: ProfileBlock): block is Extract<ProfileBlock, { type: 'notice' | 'text' }> {
  return block.type === 'notice' || block.type === 'text'
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <div class="modal" role="dialog" aria-modal="true" aria-label="主播简介">
        <button type="button" class="modal-close" aria-label="关闭" @click="emit('close')">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M6 6l12 12M18 6 6 18" stroke-linecap="round" />
          </svg>
        </button>

        <div
          v-if="profile?.cover"
          class="profile-cover"
          :style="{ backgroundImage: `url(${profile.cover})` }"
        />

        <div class="profile-header" :class="{ 'has-cover': profile?.cover }">
          <img v-if="profile?.avatar" class="profile-avatar" :src="profile.avatar" :alt="name" />
          <div v-else class="profile-avatar">{{ avatarText }}</div>
          <div class="profile-heading">
            <h2>{{ name }}</h2>
            <p v-if="subtitle">{{ subtitle }}</p>
          </div>
        </div>

        <div class="profile-body">
          <p v-if="profile?.bio" class="profile-bio-text">{{ profile.bio }}</p>

          <div v-if="profile?.tags?.length" class="profile-tags">
            <span v-for="tag in profile.tags" :key="tag" class="profile-tag">{{ tag }}</span>
          </div>

          <div v-if="links.length" class="profile-tags">
            <a
              v-for="link in links"
              :key="link.url"
              class="profile-link"
              :href="link.url"
              target="_blank"
              rel="noopener noreferrer"
            >
              {{ link.label }}
            </a>
          </div>

          <section
            v-for="(block, index) in blocks"
            :key="index"
            class="profile-block"
            :class="{ notice: block.type === 'notice' }"
          >
            <h3 v-if="block.title">{{ block.title }}</h3>

            <p v-if="hasContent(block)">{{ block.content }}</p>

            <ul v-else-if="isList(block) && block.items?.length">
              <li v-for="item in block.items" :key="item">{{ item }}</li>
            </ul>

            <dl v-else-if="isKv(block) && block.items?.length" class="profile-kv">
              <template v-for="(item, i) in block.items" :key="i">
                <dt>{{ item.label }}</dt>
                <dd>{{ item.value }}</dd>
              </template>
            </dl>
          </section>

          <p v-if="!profile" class="profile-empty">
            还没有配置主播简介：把 profile.json 放进 public/ 目录就会出现这里的内容。
          </p>
        </div>
      </div>
    </div>
  </Teleport>
</template>
