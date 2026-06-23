<template>
  <section class="card">
    <h2 class="section-title">用户管理</h2>
    <div class="form-control search-row">
      <input v-model="query" placeholder="搜索手机号、用户名或昵称" @keyup.enter="loadUsers" />
      <button class="btn-primary" @click="loadUsers">搜索</button>
    </div>
    <div v-if="error" class="alert-box">{{ error }}</div>
    <div v-else-if="loading">加载中...</div>
    <div v-else>
      <div class="table-card">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>手机号</th>
              <th>昵称</th>
              <th>用户名</th>
              <th>角色</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="user in users" :key="user.id">
              <td>{{ user.id }}</td>
              <td>{{ user.phone }}</td>
              <td>{{ user.nickname }}</td>
              <td>{{ user.username || '-' }}</td>
              <td>{{ user.role }}</td>
              <td>{{ user.banned_at ? '已封禁' : '正常' }}</td>
              <td>
                <button class="btn-secondary" @click="viewUser(user.id)">查看</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="pagination">
        <button class="btn-secondary" @click="changePage(page - 1)" :disabled="page <= 1">上一页</button>
        <span>第 {{ page }} 页 / 共 {{ totalPages }} 页</span>
        <button class="btn-secondary" @click="changePage(page + 1)" :disabled="page >= totalPages">下一页</button>
      </div>
    </div>
  </section>
  <section class="card" v-if="selectedUser">
    <h3 class="section-title">用户详情</h3>
    <dl class="user-detail-grid">
      <div><strong>ID</strong><span>{{ selectedUser.user.id }}</span></div>
      <div><strong>手机号</strong><span>{{ selectedUser.user.phone }}</span></div>
      <div><strong>昵称</strong><span>{{ selectedUser.user.nickname }}</span></div>
      <div><strong>用户名</strong><span>{{ selectedUser.user.username }}</span></div>
      <div><strong>角色</strong><span>{{ selectedUser.user.role }}</span></div>
      <div><strong>邮箱</strong><span>{{ selectedUser.user.email || '-' }}</span></div>
      <div><strong>VDS ID</strong><span>{{ selectedUser.user.vds_sub || '-' }}</span></div>
      <div><strong>封禁状态</strong><span>{{ selectedUser.user.banned_at ? '已封禁' : '正常' }}</span></div>
      <div><strong>封禁原因</strong><span>{{ selectedUser.user.ban_reason || '-' }}</span></div>
      <div><strong>创建时间</strong><span>{{ selectedUser.user.created_at }}</span></div>
      <div><strong>反馈数</strong><span>{{ selectedUser.feedbackCount }}</span></div>
      <div><strong>关联问题数</strong><span>{{ selectedUser.issueCount }}</span></div>
    </dl>
    <div class="ban-reason-row" v-if="!selectedUser.user.banned_at && !isSelf">
      <input v-model="banReason" placeholder="请输入封禁原因" />
    </div>
    <div class="actions">
      <button class="btn-primary" @click="banUser" :disabled="busy || selectedUser.user.banned_at || isSelf">{{ isSelf ? '不能封禁自己' : '封禁' }}</button>
      <button class="btn-secondary" @click="unbanUser" :disabled="busy || !selectedUser.user.banned_at">解除封禁</button>
    </div>
    <div class="feedback-list">
      <article v-for="item in selectedUser.feedbacks" :key="item.id" class="issue-item">
        <div class="issue-header">
          <span>反馈 ID: {{ item.id }}</span>
          <span>{{ item.created_at }}</span>
        </div>
        <p>{{ item.content }}</p>
        <div class="meta-row">问题ID：{{ item.issue_id }}，状态：{{ item.issue_status }}</div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue'

const users = ref([])
const page = ref(1)
const size = ref(20)
const total = ref(0)
const query = ref('')
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const selectedUser = ref(null)
const banReason = ref('')

const currentUserId = (() => {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}')
    return user.id || null
  } catch { return null }
})()

const isSelf = computed(() => selectedUser.value?.user?.id === currentUserId)

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / size.value)))

function getAuthHeaders() {
  const token = localStorage.getItem('token')
  return { Authorization: token ? `Bearer ${token}` : '' }
}

async function request(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...getAuthHeaders(), ...(options.headers || {}) } })
  if (!res.ok) {
    throw new Error(await res.text())
  }
  return res.json()
}

async function loadUsers() {
  loading.value = true
  error.value = ''
  try {
    const data = await request(`/api/admin/users?page=${page.value}&size=${size.value}&q=${encodeURIComponent(query.value)}`)
    users.value = data.users || []
    total.value = data.total || 0
  } catch (err) {
    error.value = '无法加载用户列表。'
  } finally {
    loading.value = false
  }
}

async function viewUser(id) {
  busy.value = true
  error.value = ''
  try {
    const [detail, feedback] = await Promise.all([
      request(`/api/admin/users/${id}`),
      request(`/api/admin/users/${id}/feedbacks`)
    ])
    selectedUser.value = { ...detail, feedbacks: feedback.feedbacks || [] }
  } catch (err) {
    error.value = '无法加载用户详情。'
  } finally {
    busy.value = false
  }
}

function changePage(value) {
  if (value < 1 || value > totalPages.value) return
  page.value = value
  loadUsers()
}

async function banUser() {
  if (!selectedUser.value || isSelf.value) return
  const reason = banReason.value.trim() || '违规行为'
  busy.value = true
  try {
    await request(`/api/admin/users/${selectedUser.value.user.id}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason })
    })
    banReason.value = ''
    await viewUser(selectedUser.value.user.id)
    loadUsers()
  } catch (err) {
    error.value = '封禁失败。'
  } finally {
    busy.value = false
  }
}

async function unbanUser() {
  if (!selectedUser.value) return
  busy.value = true
  try {
    await request(`/api/admin/users/${selectedUser.value.user.id}/unban`, { method: 'POST' })
    await viewUser(selectedUser.value.user.id)
    loadUsers()
  } catch (err) {
    error.value = '解除封禁失败。'
  } finally {
    busy.value = false
  }
}

loadUsers()
</script>

<style scoped>
.search-row {
  align-items: center;
  grid-template-columns: 1fr auto;
}
.table-card {
  overflow-x: auto;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th,
td {
  padding: 12px 14px;
  border-bottom: 1px solid rgba(103, 80, 164, 0.08);
  text-align: left;
}
.user-detail-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.ban-reason-row {
  margin: 16px 0;
}
.user-detail-grid div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
.pagination {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 18px;
}
</style>
