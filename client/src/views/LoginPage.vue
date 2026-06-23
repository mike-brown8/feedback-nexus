<template>
  <section class="card login-card">
    <div class="login-intro">
      <p>使用 VDS 账号登录后即可提交反馈和查看已确认的问题列表。</p>
    </div>
    <div class="actions centered">
      <button class="btn-primary btn-lg" @click="ssoLogin">
        <span class="btn-icon">&#10132;</span>
        使用 VDS 账号继续
      </button>
    </div>
  </section>
</template>

<script setup>
function ssoLogin() {
  window.location.href = '/api/auth/sso/authorize'
}
</script>

<style scoped>
.login-card {
  max-width: 440px;
  margin: 60px auto;
  text-align: center;
  padding: 48px 32px;
}
.login-intro {
  color: var(--muted);
  font-size: 0.95rem;
  line-height: 1.6;
  margin-bottom: 32px;
}
.centered {
  justify-content: center;
}
.btn-lg {
  padding: 16px 36px;
  font-size: 1.05rem;
  border-radius: 28px;
  display: inline-flex;
  align-items: center;
  gap: 10px;
}
.btn-icon {
  font-size: 1.2rem;
}
</style>
