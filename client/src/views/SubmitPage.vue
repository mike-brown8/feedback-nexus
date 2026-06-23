<template>
  <section class="card">
    <h2 class="section-title">提交反馈</h2>
    <div class="form-control">
      <label>问题描述</label>
      <textarea v-model="text" placeholder="请描述遇到的问题"></textarea>
    </div>
    <div class="form-control">
      <label>
        图片上传（可选）
        <span class="muted">仅1张，JPG/PNG，不超过5MB</span>
      </label>
      <input v-if="imageAvailable" type="file" accept=".jpg,.jpeg,.png" @change="onFilesChange" />
      <div v-else class="muted" style="margin-top:4px">图片服务未配置，暂不支持上传图片。</div>
      <div v-if="fileNames.length" class="file-list">已选：{{ fileNames[0] }}</div>
    </div>
    <div class="actions">
      <button class="btn-primary" @click="submit" :disabled="busy || cooldown">提交反馈</button>
      <button class="btn-secondary" @click="resetForm" type="button">重置</button>
    </div>
  </section>

  <!-- 提交中覆盖层 -->
  <div v-if="busy" class="submit-overlay">
    <div class="submit-loading">
      <div class="spinner-lg"></div>
      <p>正在提交反馈…</p>
    </div>
  </div>

  <!-- 结果弹窗 -->
  <div v-if="result" class="result-overlay" @click.self="dismissResult">
    <div class="result-popup" :class="result.type">
      <div class="result-icon">{{ result.type === 'success' ? '✓' : '✕' }}</div>
      <h3>{{ result.type === 'success' ? '提交成功' : '提交失败' }}</h3>
      <p>{{ result.message }}</p>
      <button class="btn-primary" @click="dismissResult">知道了</button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'

const text = ref('')
const files = ref([])
const busy = ref(false)
const cooldown = ref(false)
const result = ref(null)
const imageAvailable = ref(true)
const COOLDOWN_MS = 3000

const fileNames = computed(() => files.value.map(file => file.name))

function onFilesChange(event) {
  const file = event.target.files?.[0]
  if (!file) {
    files.value = []
    return
  }
  if (file.size > 5 * 1024 * 1024) {
    alert(`${file.name} 超过 5MB，请重新选择。`)
    event.target.value = ''
    files.value = []
    return
  }
  const ext = file.name.toLowerCase()
  if (!ext.endsWith('.jpg') && !ext.endsWith('.jpeg') && !ext.endsWith('.png')) {
    alert('仅支持 JPG/JPEG/PNG 格式的图片。')
    event.target.value = ''
    files.value = []
    return
  }
  files.value = [file]
}

async function submit() {
  if (!text.value.trim() && !files.value.length) {
    showResult('error', '请填写问题描述或上传图片。')
    return
  }
  busy.value = true
  result.value = null
  const token = localStorage.getItem('token')
  const formData = new FormData()
  formData.append('text', text.value)
  files.value.forEach(file => formData.append('images', file))

  try {
    const res = await fetch('/api/feedback', {
      method: 'POST',
      body: formData,
      headers: { Authorization: token ? `Bearer ${token}` : '' }
    })
    if (!res.ok) {
      const errorText = await res.text()
      let errorMsg = '提交失败'
      try { errorMsg = JSON.parse(errorText).error || errorText } catch { errorMsg = errorText || '提交失败' }
      throw new Error(errorMsg)
    }
    const data = await res.json()
    resetForm()
    showResult('success', data.message || '已收到，感谢反馈！')
  } catch (err) {
    showResult('error', err.message || '提交失败，请稍后重试。')
  } finally {
    busy.value = false
  }
}

function showResult(type, message) {
  result.value = { type, message }
  cooldown.value = true
  setTimeout(() => { cooldown.value = false }, COOLDOWN_MS)
}

function dismissResult() {
  result.value = null
}

function resetForm() {
  text.value = ''
  files.value = []
}

// 页面加载时查询图片服务状态
onMounted(async () => {
  try {
    const token = localStorage.getItem('token')
    const res = await fetch('/api/feedback/image-status', {
      headers: { Authorization: token ? `Bearer ${token}` : '' }
    })
    const data = await res.json()
    imageAvailable.value = data.available
  } catch {
    imageAvailable.value = false
  }
})
</script>

<style scoped>
.file-list {
  color: var(--muted);
  font-size: 0.95rem;
}
.muted {
  color: var(--muted);
  font-size: 0.95rem;
}

/* 提交中覆盖层 */
.submit-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(6px);
}
.submit-loading {
  text-align: center;
  color: var(--primary);
}
.submit-loading p {
  margin-top: 16px;
  font-size: 1rem;
  font-weight: 600;
}
.spinner-lg {
  width: 48px;
  height: 48px;
  margin: 0 auto;
  border: 4px solid rgba(103, 80, 164, 0.12);
  border-top-color: var(--primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 结果弹窗覆盖层 */
.result-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(10px);
}
.result-popup {
  background: #fff;
  border-radius: 28px;
  padding: 40px 36px;
  text-align: center;
  max-width: 380px;
  width: 90%;
  box-shadow: 0 32px 80px rgba(103, 80, 164, 0.18);
  border: 1px solid rgba(103, 80, 164, 0.06);
}
.result-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 16px;
  font-size: 1.6rem;
  font-weight: 700;
  color: #fff;
}
.result-popup.success .result-icon { background: #4caf50; }
.result-popup.error .result-icon   { background: #b3261e; }
.result-popup h3 {
  margin: 0 0 8px;
  font-size: 1.15rem;
}
.result-popup p {
  margin: 0 0 24px;
  color: var(--muted);
  font-size: 0.95rem;
  line-height: 1.5;
}
</style>
