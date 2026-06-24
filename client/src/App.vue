<template>
  <div class="app-shell" :class="{ 'is-guest': !user }">
    <!-- 登录前浮动球体背景 -->
    <div v-if="!user" class="floating-spheres" aria-hidden="true">
      <div class="sphere sphere-1"></div>
      <div class="sphere sphere-2"></div>
      <div class="sphere sphere-3"></div>
      <div class="sphere sphere-4"></div>
    </div>

    <header class="app-topbar">
      <div class="brand">智能反馈聚合系统</div>
      <nav v-if="user">
        <button :class="{ active: currentPage === 'bugs' }" @click="setPage('bugs')">已知问题</button>
        <button :class="{ active: currentPage === 'received' }" @click="setPage('received')">收到的反馈</button>
        <button :class="{ active: currentPage === 'submit' }" @click="setPage('submit')">提交反馈</button>
        <button v-if="user?.role === 'admin'" :class="{ active: currentPage === 'admin' }" @click="setPage('admin')">后台</button>
      </nav>
      <div class="user-actions" v-if="user">
        <span>已登录：{{ user.nickname || user.phone }}</span>
        <button class="btn-secondary" @click="logout">登出</button>
      </div>
    </header>

    <main class="app-body">
      <LoginPage v-if="!user" @login="onLogin" />
      <BoardPage v-else-if="currentPage === 'bugs'" board-tab="bugs" />
      <BoardPage v-else-if="currentPage === 'received'" board-tab="received" />
      <SubmitPage v-else-if="currentPage === 'submit'" />
      <AdminPage v-else-if="currentPage === 'admin'" />
    </main>

    <!-- 会话过期浮窗 -->
    <div v-if="showSessionExpired" class="session-overlay" @click.self="handleSessionExpired">
      <div class="session-popup">
        <div class="session-icon">&#9888;</div>
        <h3>登录已过期</h3>
        <p>您的登录会话已过期，请重新登录以继续使用。</p>
        <button class="btn-primary" @click="handleSessionExpired">重新登录</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import BoardPage from './views/BoardPage.vue'
import SubmitPage from './views/SubmitPage.vue'
import AdminPage from './views/AdminPage.vue'
import LoginPage from './views/LoginPage.vue'

const currentPage = ref('bugs')
const user = ref(null)
const showSessionExpired = ref(false)

function loadUser() {
  const stored = localStorage.getItem('user')
  if (stored) {
    try {
      user.value = JSON.parse(stored)
    } catch (_err) {
      user.value = null
    }
  }
}

function handleSessionExpired() {
  logout()
  showSessionExpired.value = false
}

function forceLogout() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  user.value = null
  currentPage.value = 'board'
  showSessionExpired.value = true
}

async function initializeFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')
  if (!token) return
  localStorage.setItem('token', token)
  params.delete('token')
  const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ''}`
  window.history.replaceState({}, '', newUrl)
  try {
    const res = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (res.status === 401) { window.dispatchEvent(new CustomEvent('session-expired')); return }
    if (!res.ok) return
    const data = await res.json()
    localStorage.setItem('user', JSON.stringify(data.user))
    user.value = data.user
  } catch (_error) {
    localStorage.removeItem('token')
  }
}

function onLogin(payload) {
  user.value = payload.user
  setPage('board')
}

function logout() {
  localStorage.removeItem('token')
  localStorage.removeItem('user')
  user.value = null
  currentPage.value = 'board'
}

// 若非管理员切换到后台页面，强制跳转回看板
function setPage(page) {
  if (page === 'admin' && user.value?.role !== 'admin') {
    currentPage.value = 'board'
    return
  }
  currentPage.value = page
}

onMounted(async () => {
  await initializeFromUrl()
  if (!user.value) loadUser()
  // token 存在但 user 未加载 → 用 token 换取用户信息
  if (!user.value && localStorage.getItem('token')) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
      if (res.status === 401) { localStorage.removeItem('token'); return }
      if (res.ok) {
        const data = await res.json()
        localStorage.setItem('user', JSON.stringify(data.user))
        user.value = data.user
      } else {
        localStorage.removeItem('token')
      }
    } catch {
      localStorage.removeItem('token')
    }
  }

  // 全局监听 401 事件
  window.addEventListener('session-expired', forceLogout)
})

onUnmounted(() => {
  window.removeEventListener('session-expired', forceLogout)
})
</script>
