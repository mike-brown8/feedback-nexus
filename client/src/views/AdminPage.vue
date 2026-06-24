<template>
  <section class="card">
    <h2 class="section-title">管理员后台</h2>
    <div class="actions" style="margin-bottom:20px">
      <button class="btn-secondary" :class="{ active: tab === 'drafts' }" @click="switchTab('drafts')">
        草稿池
        <span v-if="draftTotal > 0" class="badge">{{ draftTotal }}</span>
      </button>
      <button class="btn-secondary" :class="{ active: tab === 'unprocessed' }" @click="switchTab('unprocessed')">
        待处理
        <span v-if="unprocessedCount + failedCount > 0" class="badge">{{ unprocessedCount + failedCount }}</span>
      </button>
      <button class="btn-secondary" :class="{ active: tab === 'published' }" @click="switchTab('published')">
        已发布
        <span v-if="publishedTotal > 0" class="badge">{{ publishedTotal }}</span>
      </button>
      <button class="btn-secondary" :class="{ active: tab === 'users' }" @click="switchTab('users')">用户管理</button>
    </div>

    <!-- ========== 草稿池 ========== -->
    <template v-if="tab === 'drafts'">
      <div class="actions" style="margin-bottom:12px">
        <button class="btn-primary" @click="loadDrafts" :disabled="busy">刷新</button>
        <button class="btn-secondary" :class="{ active: draftFilter === '' }" @click="draftFilter = ''; loadDrafts()">全部</button>
        <button class="btn-secondary" :class="{ active: draftFilter === 'bug' }" @click="draftFilter = 'bug'; loadDrafts()">BUG</button>
        <button class="btn-secondary" :class="{ active: draftFilter === 'suggestion' }" @click="draftFilter = 'suggestion'; loadDrafts()">建议</button>
        <button class="btn-secondary" :class="{ active: draftFilter === 'other' }" @click="draftFilter = 'other'; loadDrafts()">其他</button>
      </div>
      <div v-if="error" class="alert-box">{{ error }}</div>
      <div v-else-if="loading">加载中...</div>
      <div v-else-if="drafts.length === 0">当前暂无草稿。</div>
      <div class="grid-list">
        <article v-for="draft in drafts" :key="draft.id" class="issue-item">
          <div class="issue-header">
            <h3>{{ draft.title }}</h3>
            <span class="status-chip">草稿</span>
          </div>
          <p>{{ draft.description }}</p>
          <div class="meta-row">关联反馈：{{ draft.feedback_count }} 条 · 分类：{{ draft.category }}</div>
          <div class="actions">
            <button class="btn-secondary" @click="viewDraft(draft.id)">
              {{ selectedDraft?.issue?.id === draft.id ? '收起' : '查看详情' }}
            </button>
          </div>
          <!-- 草稿详情（可收起） -->
          <div v-if="selectedDraft?.issue?.id === draft.id" class="draft-detail">
            <div class="form-control">
              <label>标题</label>
              <textarea readonly class="readonly-field" rows="2">{{ selectedDraft.issue.title }}</textarea>
            </div>
            <div class="form-control">
              <label>描述</label>
              <textarea readonly class="readonly-field" rows="3">{{ selectedDraft.issue.description }}</textarea>
            </div>
            <div class="actions">
              <template v-if="selectedDraft.issue.category === 'other'">
                <select v-model="publishCategory" class="input-field" style="margin-right:8px">
                  <option value="">选择目标分类…</option>
                  <option value="bug">归类为 BUG</option>
                  <option value="suggestion">归类为 建议</option>
                </select>
              </template>
              <button class="btn-primary" @click="publishDraft" :disabled="busy || (selectedDraft.issue.category === 'other' && !publishCategory)">批准并公开</button>
              <button class="btn-secondary" @click="rejectDraft" :disabled="busy">驳回并删除</button>
            </div>
            <h4 style="margin:20px 0 12px">关联的原始反馈</h4>
            <div class="feedback-list">
              <article v-for="item in selectedDraft.feedbacks" :key="item.id" class="feedback-item">
                <div class="feedback-meta">
                  <span>用户：{{ item.username || item.phone || '未知' }}</span>
                  <span>{{ item.created_at }}</span>
                </div>
                <textarea readonly class="readonly-field feedback-content" rows="4">{{ item.content }}</textarea>
                <div v-if="item.image_count > 0" class="actions">
                  <button class="btn-secondary btn-sm" @click="openImageViewer(item)">查看图片 ({{ item.image_count }} 张)</button>
                </div>
              </article>
            </div>
          </div>
        </article>
      </div>
      <!-- 分页 -->
      <div v-if="draftTotal > draftPageSize" class="pagination">
        <button class="btn-secondary btn-sm" :disabled="draftPage <= 1" @click="draftPage--; loadDrafts()">上一页</button>
        <span class="page-info">{{ draftPage }} / {{ Math.ceil(draftTotal / draftPageSize) }}</span>
        <button class="btn-secondary btn-sm" :disabled="draftPage * draftPageSize >= draftTotal" @click="draftPage++; loadDrafts()">下一页</button>
      </div>
    </template>

    <!-- ========== 待处理（含失败）========== -->
    <template v-if="tab === 'unprocessed'">
      <div class="actions" style="margin-bottom:16px">
        <button class="btn-primary" @click="loadUnprocessed" :disabled="busy">刷新</button>
        <button class="btn-secondary" @click="retryAll" :disabled="busy || unprocessedList.length + failedList.length === 0">全部重试</button>
      </div>
      <div v-if="unprocError" class="alert-box"><pre style="margin:0;white-space:pre-wrap;font:inherit">{{ unprocError }}</pre></div>
      <div v-else-if="unprocLoading">加载中...</div>
      <template v-if="unprocessedList.length > 0">
        <h3 style="margin:12px 0 8px">待处理（{{ unprocessedList.length }}）</h3>
        <div class="grid-list">
          <article v-for="item in unprocessedList" :key="item.id" class="issue-item">
            <div class="feedback-meta">
              <span>用户：{{ item.username || item.phone || '未知' }}</span>
              <span>{{ item.created_at }}</span>
            </div>
            <textarea readonly class="readonly-field feedback-content" rows="3">{{ item.content }}</textarea>
            <div class="meta-row">图片：{{ item.image_count }} 张</div>
            <div class="actions">
              <button v-if="item.image_count > 0" class="btn-secondary btn-sm" @click="openImageViewer(item)">查看图片</button>
              <button class="btn-secondary btn-sm" @click="retryOne(item.id)" :disabled="retryingId === item.id">
                {{ retryingId === item.id ? '处理中…' : '重试' }}
              </button>
            </div>
          </article>
        </div>
      </template>
      <template v-if="failedList.length > 0">
        <h3 style="margin:20px 0 8px;color:#b3261e">处理失败（{{ failedList.length }}）</h3>
        <div class="grid-list">
          <article v-for="item in failedList" :key="item.id" class="issue-item" style="border-left:3px solid #b3261e">
            <div class="feedback-meta">
              <span>用户：{{ item.username || item.phone || '未知' }}</span>
              <span>{{ item.created_at }}</span>
            </div>
            <textarea readonly class="readonly-field feedback-content" rows="3">{{ item.content }}</textarea>
            <div class="meta-row">图片：{{ item.image_count }} 张</div>
            <div class="actions">
              <button v-if="item.image_count > 0" class="btn-secondary btn-sm" @click="openImageViewer(item)">查看图片</button>
              <button class="btn-secondary btn-sm" @click="retryOne(item.id)" :disabled="retryingId === item.id">
                {{ retryingId === item.id ? '处理中…' : '重试' }}
              </button>
            </div>
          </article>
        </div>
      </template>
      <div v-if="unprocessedList.length === 0 && failedList.length === 0 && !unprocLoading">当前没有待处理的帖子。</div>
    </template>

    <!-- ========== 已发布 ========== -->
    <template v-if="tab === 'published'">
      <div class="actions" style="margin-bottom:12px">
        <button class="btn-primary" @click="loadPublished" :disabled="busy">刷新</button>
        <button class="btn-secondary" :class="{ active: pubFilter === '' }" @click="pubFilter = ''; loadPublished()">全部</button>
        <button class="btn-secondary" :class="{ active: pubFilter === 'bug' }" @click="pubFilter = 'bug'; loadPublished()">BUG</button>
        <button class="btn-secondary" :class="{ active: pubFilter === 'suggestion' }" @click="pubFilter = 'suggestion'; loadPublished()">建议</button>
      </div>
      <div v-if="pubError" class="alert-box">{{ pubError }}</div>
      <div v-else-if="pubLoading">加载中...</div>
      <div v-else-if="publishedList.length === 0">暂无已发布的问题。</div>
      <div class="grid-list">
        <article v-for="item in publishedList" :key="item.id" class="issue-item">
          <div class="issue-header">
            <h3>{{ item.title }}</h3>
            <span class="status-chip" :class="item.status">{{ item.status === 'public' ? '已知' : '处理中' }}</span>
          </div>
          <p>{{ item.description }}</p>
          <div class="meta-row">
            发布：{{ formatDate(item.published_at) }}
            <span style="margin-left:12px">反馈人数：发布前 {{ item.feedback_before }} · 发布后 {{ item.feedback_after }} · 共 {{ item.feedback_total }}</span>
          </div>
          <div class="actions">
            <button class="btn-secondary btn-sm" @click="setStatus(item.id, 'public')" :disabled="item.status === 'public'">标记已知</button>
            <button class="btn-secondary btn-sm" @click="setStatus(item.id, 'processing')" :disabled="item.status === 'processing'">标记处理中</button>
            <button class="btn-primary btn-sm" style="background:#b3261e" @click="completeIssue(item.id)" :disabled="completingId === item.id">
              {{ completingId === item.id ? '处理中…' : '完成并删除' }}
            </button>
          </div>
        </article>
      </div>
    </template>

    <UserListPage v-if="tab === 'users'" />
  </section>

  <!-- ====== 图片查看器浮窗 ====== -->
  <div v-if="imageViewer" class="image-overlay" @click.self="closeImageViewer">
    <div class="image-viewer-card">
      <div class="image-viewer-header">
        <span>用户图片{{ imageViewer.images?.length > 1 ? ` (${imageViewer.currentIndex + 1}/${imageViewer.images.length})` : '' }}</span>
        <button class="btn-close" @click="closeImageViewer">&times;</button>
      </div>
      <div class="image-viewer-body">
        <img :src="imageViewer.src" alt="用户上传的图片" class="viewer-img" :class="{ zoomed: imageViewer.zoomed }" @click="toggleZoom" />
      </div>
      <div v-if="imageViewer.images?.length > 1" class="image-viewer-footer">
        <button class="btn-secondary btn-sm" @click="prevImage">上一张</button>
        <button class="btn-secondary btn-sm" @click="nextImage">下一张</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import UserListPage from './UserListPage.vue'

const tab = ref('drafts')
const drafts = ref([])
const selectedDraft = ref(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const draftFilter = ref('')
const draftPage = ref(1)
const draftPageSize = 10
const draftTotal = ref(0)
const publishCategory = ref('')

// 未处理帖子
const unprocessedList = ref([])
const failedList = ref([])
const unprocessedCount = ref(0)
const failedCount = ref(0)
const unprocLoading = ref(false)
const unprocError = ref('')
const retryingId = ref(null)
const completingId = ref(null)

// 已发布
const publishedList = ref([])
const publishedTotal = ref(0)
const pubFilter = ref('')
const pubLoading = ref(false)
const pubError = ref('')

// 图片查看器
const imageViewer = ref(null)

function getAuthHeaders() {
  const token = localStorage.getItem('token')
  return { Authorization: token ? `Bearer ${token}` : '' }
}

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...getAuthHeaders(), ...(options.headers || {}) } })
  if (!res.ok) {
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('session-expired'))
      throw new Error('登录已过期')
    }
    const text = await res.text()
    let msg = text
    try { msg = JSON.parse(text).error || text } catch { /* use raw text */ }
    throw new Error(msg)
  }
  return res.json()
}

function switchTab(name) {
  tab.value = name
  error.value = ''
  unprocError.value = ''
  pubError.value = ''
  selectedDraft.value = null
  // 切换任意 TAB 时更新所有计数
  refreshCounts()
  if (name === 'drafts') { draftPage.value = 1; loadDrafts() }
  else if (name === 'unprocessed') loadUnprocessed()
  else if (name === 'published') loadPublished()
}

async function refreshCounts() {
  // 草稿池计数
  try {
    const d = await api('/api/admin/drafts?page=1&size=1')
    draftTotal.value = d.total || 0
  } catch {}
  // 待处理计数
  try {
    const u = await api('/api/admin/unprocessed')
    unprocessedCount.value = (u.pending || []).length
    failedCount.value = (u.failed || []).length
  } catch {}
  // 已发布计数
  try {
    const p = await api('/api/admin/published')
    publishedTotal.value = (p.issues || []).length
  } catch {}
}

// ---- 草稿 ----
async function loadDrafts() {
  loading.value = true
  error.value = ''
  try {
    const params = new URLSearchParams({ page: draftPage.value, size: draftPageSize })
    if (draftFilter.value) params.set('category', draftFilter.value)
    const data = await api(`/api/admin/drafts?${params}`)
    drafts.value = data.drafts || []
    draftTotal.value = data.total || 0
  } catch (err) {
    error.value = '无法加载草稿池。'
  } finally {
    loading.value = false
  }
}

async function viewDraft(id) {
  if (selectedDraft.value?.issue?.id === id) {
    selectedDraft.value = null
    return
  }
  busy.value = true
  error.value = ''
  try {
    const data = await api(`/api/admin/drafts/${id}`)
    selectedDraft.value = data
    publishCategory.value = ''
  } catch (err) {
    error.value = '无法加载草稿详情。'
  } finally {
    busy.value = false
  }
}

async function publishDraft() {
  if (!selectedDraft.value) return
  busy.value = true
  try {
    const body = {}
    if (selectedDraft.value.issue.category === 'other' && publishCategory.value) {
      body.category = publishCategory.value
    }
    await api(`/api/admin/drafts/${selectedDraft.value.issue.id}/publish`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    await loadDrafts()
    selectedDraft.value = null
  } catch (err) {
    error.value = '批准失败：' + err.message
  } finally {
    busy.value = false
  }
}

async function rejectDraft() {
  if (!selectedDraft.value) return
  busy.value = true
  try {
    await api(`/api/admin/drafts/${selectedDraft.value.issue.id}/reject`, { method: 'POST' })
    await loadDrafts()
    selectedDraft.value = null
  } catch (err) {
    error.value = '驳回失败。'
  } finally {
    busy.value = false
  }
}

// ---- 未处理帖子 ----
async function loadUnprocessed() {
  unprocLoading.value = true
  unprocError.value = ''
  try {
    const data = await api('/api/admin/unprocessed')
    unprocessedList.value = data.pending || []
    failedList.value = data.failed || []
    unprocessedCount.value = unprocessedList.value.length
    failedCount.value = failedList.value.length
  } catch (err) {
    unprocError.value = '无法加载未处理列表。'
  } finally {
    unprocLoading.value = false
  }
}

// ---- 已发布管理 ----
function formatDate(value) {
  return value ? value.replace('T', ' ').replace('Z', '') : '--'
}

async function loadPublished() {
  pubLoading.value = true
  pubError.value = ''
  try {
    const params = new URLSearchParams()
    if (pubFilter.value) params.set('category', pubFilter.value)
    const qs = params.toString()
    const data = await api(`/api/admin/published${qs ? '?' + qs : ''}`)
    publishedList.value = data.issues || []
  } catch {
    pubError.value = '无法加载已发布列表。'
  } finally {
    pubLoading.value = false
  }
}

async function setStatus(id, status) {
  try {
    await api(`/api/admin/issues/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    })
    await loadPublished()
  } catch {
    pubError.value = '更新状态失败。'
  }
}

async function completeIssue(id) {
  if (!confirm('确认完成并删除此问题？所有关联的反馈和图片将被永久删除。')) return
  completingId.value = id
  try {
    await api(`/api/admin/issues/${id}/complete`, { method: 'POST' })
    await loadPublished()
  } catch {
    pubError.value = '操作失败。'
  } finally {
    completingId.value = null
  }
}

async function retryOne(id) {
  retryingId.value = id
  unprocError.value = ''
  try {
    await api(`/api/admin/unprocessed/${id}/retry`, { method: 'POST' })
    await loadUnprocessed()
  } catch (err) {
    unprocError.value = `重试失败: ${err.message}`
  } finally {
    retryingId.value = null
  }
}

async function retryAll() {
  busy.value = true
  unprocError.value = ''
  try {
    const result = await api('/api/admin/unprocessed/retry-all', { method: 'POST' })
    let msg = `成功 ${result.success} / 失败 ${result.failed}`
    if (result.errors?.length > 0) {
      msg += '\n' + result.errors.map(e => `  #${e.id}: ${e.error}`).join('\n')
    }
    unprocError.value = msg
    await loadUnprocessed()
  } catch (err) {
    unprocError.value = '批量重试失败。'
  } finally {
    busy.value = false
  }
}

// ---- 图片查看器 ----
function getImgUrl(imageId) {
  const token = localStorage.getItem('token')
  return `/api/admin/images/file/${imageId}?token=${encodeURIComponent(token || '')}`
}

async function openImageViewer(item) {
  try {
    const data = await api(`/api/admin/images/${item.id}`)
    if (data.images?.length > 0) {
      imageViewer.value = {
        images: data.images,
        currentIndex: 0,
        src: getImgUrl(data.images[0].id),
        zoomed: false
      }
    }
  } catch {
    // ignore
  }
}

function closeImageViewer() {
  imageViewer.value = null
}

function toggleZoom() {
  if (imageViewer.value) imageViewer.value.zoomed = !imageViewer.value.zoomed
}

function prevImage() {
  if (!imageViewer.value) return
  const idx = (imageViewer.value.currentIndex - 1 + imageViewer.value.images.length) % imageViewer.value.images.length
  imageViewer.value.currentIndex = idx
  imageViewer.value.src = getImgUrl(imageViewer.value.images[idx].id)
}

function nextImage() {
  if (!imageViewer.value) return
  const idx = (imageViewer.value.currentIndex + 1) % imageViewer.value.images.length
  imageViewer.value.currentIndex = idx
  imageViewer.value.src = getImgUrl(imageViewer.value.images[idx].id)
}

// 初始化
refreshCounts()
loadDrafts()
</script>

<style scoped>
.feedback-list { display: grid; gap: 16px; margin-top: 12px; }
.feedback-item {
  display: grid; gap: 10px; padding: 18px;
  border-radius: 20px; background: rgba(255,255,255,0.96);
  border: 1px solid rgba(103,80,164,0.08);
}
.feedback-meta {
  display: flex; justify-content: space-between;
  font-size: 0.9rem; color: var(--muted);
}
.readonly-field {
  width: 100%; padding: 12px 16px; border-radius: 16px;
  border: 1px solid rgba(103,80,164,0.12);
  background: rgba(245,241,255,0.5); color: var(--text);
  font-size: 0.95rem; line-height: 1.5; resize: none; cursor: default;
}
.readonly-field:focus {
  outline: none; border-color: rgba(103,80,164,0.12); box-shadow: none;
}
.feedback-content { min-height: 70px; }
.btn-sm { padding: 8px 14px; font-size: 0.85rem; border-radius: 14px; }
.badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px;
  background: #b3261e; color: #fff; font-size: 0.75rem; font-weight: 700;
  margin-left: 4px;
}
.draft-detail {
  margin-top: 16px; padding: 20px; border-radius: 24px;
  background: rgba(255,255,255,0.7); border: 1px solid rgba(103,80,164,0.06);
}

/* 图片查看器浮窗 */
.image-overlay {
  position: fixed; inset: 0; z-index: 2000;
  display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(8px);
}
.image-viewer-card {
  background: #fff; border-radius: 24px; overflow: hidden;
  max-width: 90vw; max-height: 90vh;
  box-shadow: 0 32px 80px rgba(0,0,0,0.3);
  display: flex; flex-direction: column;
}
.image-viewer-header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 16px 20px; border-bottom: 1px solid rgba(103,80,164,0.08);
  font-weight: 600;
}
.btn-close {
  background: none; border: none; font-size: 1.5rem;
  color: var(--muted); cursor: pointer; padding: 0 4px;
  line-height: 1;
}
.btn-close:hover { color: var(--text); }
.image-viewer-body {
  padding: 20px; overflow: auto; display: flex;
  align-items: center; justify-content: center;
}
.viewer-img {
  max-width: 100%; max-height: 70vh; object-fit: contain;
  border-radius: 12px; cursor: zoom-in; transition: transform 0.2s ease;
}
.viewer-img.zoomed {
  transform: scale(1.8); cursor: zoom-out;
}
.image-viewer-footer {
  display: flex; gap: 12px; justify-content: center;
  padding: 12px 20px 20px;
}
.pagination {
  display: flex; align-items: center; justify-content: center; gap: 12px; margin-top: 20px;
}
.page-info { font-size: 0.9rem; color: var(--muted); }
.input-field {
  padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: 0.95rem;
  background: var(--bg); color: var(--text);
}
</style>
