<template>
  <section class="card">
    <h2 class="section-title">{{ boardTab === 'bugs' ? '已知问题' : '收到的反馈' }}</h2>
    <div v-if="error" class="alert-box">{{ error }}</div>
    <div v-else-if="loading">加载中...</div>
    <div v-else-if="issues.length === 0">当前暂无{{ boardTab === 'bugs' ? '已知问题' : '收到的反馈' }}。</div>
    <div class="grid-list">
      <article v-for="issue in issues" :key="issue.id" class="issue-item">
        <div class="issue-header" @click="toggleIssue(issue.id)" style="cursor:pointer">
          <h3>{{ issue.title }}</h3>
          <span class="status-chip" :class="issue.status">{{ issue.status === 'public' ? '已知' : issue.status === 'processing' ? '处理中' : issue.status }}</span>
        </div>
        <div class="meta-row">更新时间：{{ formatDate(issue.updated_at) }}</div>
        <div v-if="expandedIssue === issue.id" class="issue-detail">
          <p class="issue-desc">{{ issue.description }}</p>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'

const props = defineProps({ boardTab: { type: String, default: 'bugs' } })
const issues = ref([])
const loading = ref(true)
const error = ref('')
const expandedIssue = ref(null)

function formatDate(value) {
  return value ? value.replace('T', ' ').replace('Z', '') : '--'
}

function toggleIssue(id) {
  expandedIssue.value = expandedIssue.value === id ? null : id
}

async function fetchIssues() {
  loading.value = true
  error.value = ''
  try {
    const token = localStorage.getItem('token')
    const res = await fetch('/api/public/issues', {
      headers: { Authorization: token ? `Bearer ${token}` : '' }
    })
    if (res.status === 401) { window.dispatchEvent(new CustomEvent('session-expired')); return }
    if (!res.ok) throw new Error(await res.text())
    const data = await res.json()
    const all = data.issues || []
    if (props.boardTab === 'bugs') {
      issues.value = all.filter(i => i.title.startsWith('【BUG】'))
    } else {
      issues.value = all.filter(i => i.title.startsWith('【建议】') || i.title.startsWith('【其他】'))
    }
  } catch (err) {
    error.value = '无法加载列表。'
  } finally {
    loading.value = false
  }
}

watch(() => props.boardTab, fetchIssues)
onMounted(fetchIssues)
</script>

<style scoped>
.grid-list {
  display: grid;
  gap: 16px;
}
.issue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  user-select: none;
}
.issue-header:hover h3 {
  color: var(--primary);
}
.meta-row {
  color: var(--muted);
  font-size: 0.95rem;
  margin-top: 4px;
}
.status-chip.processing {
  background: rgba(255, 160, 0, 0.15);
  color: #e65100;
}
.issue-detail {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.issue-desc {
  color: var(--text);
  line-height: 1.6;
  white-space: pre-wrap;
}
</style>
