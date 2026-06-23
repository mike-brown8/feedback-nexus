<template>
  <section class="card">
    <h2 class="section-title">已知问题</h2>
    <div v-if="error" class="alert-box">{{ error }}</div>
    <div v-else-if="loading">加载中...</div>
    <div v-else-if="issues.length === 0">当前暂无公开问题。</div>
    <div class="grid-list">
      <article v-for="issue in issues" :key="issue.id" class="issue-item">
        <div class="issue-header">
          <h3>{{ issue.title }}</h3>
          <span class="status-chip" :class="issue.status">{{ issue.status === 'public' ? '已知' : issue.status === 'processing' ? '处理中' : issue.status }}</span>
        </div>
        <div class="meta-row">更新时间：{{ formatDate(issue.updated_at) }}</div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { ref, onMounted } from 'vue'

const issues = ref([])
const loading = ref(true)
const error = ref('')

function formatDate(value) {
  return value ? value.replace('T', ' ').replace('Z', '') : '--'
}

async function fetchIssues() {
  loading.value = true
  error.value = ''
  try {
    const token = localStorage.getItem('token')
    const res = await fetch('/api/public/issues', {
      headers: { Authorization: token ? `Bearer ${token}` : '' }
    })
    if (!res.ok) {
      throw new Error(await res.text())
    }
    const data = await res.json()
    issues.value = data.issues || []
  } catch (err) {
    error.value = '无法加载已知问题列表，请先登录或检查网络。'
  } finally {
    loading.value = false
  }
}

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
}
.meta-row {
  color: var(--muted);
  font-size: 0.95rem;
}
.status-chip.processing {
  background: rgba(255, 160, 0, 0.15);
  color: #e65100;
}
</style>
