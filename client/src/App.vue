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
        <button :class="{ active: currentPage === 'board' }" @click="setPage('board')">已知问题</button>
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
      <BoardPage v-else-if="currentPage === 'board'" />
      <SubmitPage v-else-if="currentPage === 'submit'" />
      <AdminPage v-else-if="currentPage === 'admin'" />
    </main>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import BoardPage from './views/BoardPage.vue'
import SubmitPage from './views/SubmitPage.vue'
import AdminPage from './views/AdminPage.vue'
import LoginPage from './views/LoginPage.vue'

const currentPage = ref('board')
const user = ref(null)

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
})
</script>
