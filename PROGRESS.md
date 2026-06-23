# 项目进度

## 已完成

### 管理后台权限控制
- [x] **后端修复**: `auth.js` 中 `findOrCreateUser` 现在检查 `config.adminPhone`，匹配的手机号登录时自动获得 `admin` 角色
- [x] **后端修复**: `findOrCreateUserFromVds` 同样支持 `ADMIN_PHONE` 配置，VDS 登录的管理员也会被升级
- [x] **前端修复**: `App.vue` 中"后台"按钮添加 `v-if="user?.role === 'admin'"` 条件，仅管理员可见
- [x] **前端安全**: 添加 `setPage()` 函数，防止非管理员通过任何方式跳转到后台页面

### Bug 修复
- [x] **vds-oauth.js**: 修复 `normalizeUserInfo` 函数重复声明导致的启动崩溃
- [x] **config.js**: 修复 `.env` 文件路径错误 (`../.env` → `.env`)，使得环境变量实际生效
- [x] **db.js**: 添加 `migrateSchema()` 数据库迁移函数，为已有旧数据库补充 `banned_at` 等缺失列，防止启动报错

### 登录方式简化
- [x] **LoginPage.vue**: 移除手机号/昵称输入和 mock 登录，改为单一"使用 VDS 账号继续"按钮
- [x] **App.vue**: 用户信息显示改用 `nickname` 优先，适配 VDS 用户

### VDP_BEARER 自动获取（替代手动配置）
- [x] **vds-oauth.js**: 重写为内置平台签名管理器，自动调用 `POST /api/auth/token` 用 `clientId` + `clientSecret` 换取 `accessToken`
- [x] **自动缓存**: 签名缓存在内存中，第二次调用直接返回（0.02ms vs 487ms）
- [x] **自动刷新**: 剩余有效期 < 5 分钟时自动换新
- [x] **失败重试**: 最多重试 3 次，指数退避
- [x] **config.js / .env**: 移除 `VDP_BEARER` 配置项

## 配置说明

在 `server/.env` 中设置：

```env
OAUTH_CLIENT_ID=你的VDS应用ID     # vap_xxx 格式
OAUTH_CLIENT_SECRET=你的应用密钥
ADMIN_PHONE=管理员手机号            # 可选，该手机号登录后显示后台
```

`VDP_BEARER` **已移除** — 平台签名由系统自动在运行时获取和管理，无需手动填写。

### 安全加固 & 技术债清理（2026-06-23）
- [x] **安全漏洞#4**: CORS 改为明确指定前端源（`config.corsOrigin`）
- [x] **安全漏洞#5**: 移除公开的 `/uploads` 静态路由，图片仅通过鉴权 API 访问
- [x] **安全漏洞#6**: 引入 `helmet` 中间件添加安全 HTTP 头
- [x] **安全漏洞#7**: 引入 `express-rate-limit` 限流（通用 100/min，认证 15/min，反馈 10/min）
- [x] **安全漏洞#8**: Token 不再通过 URL 参数传递，改为 POST 响应体 + localStorage 存储
- [x] **技术债#1**: 创建项目根 `.gitignore`（排除 node_modules、.env、data、logs、uploads、dist）
- [x] **技术债#2**: 删除未使用的 `findBestMatchIssue` 和 `getAllIssues` 函数
- [x] **技术债#3**: 清理 `migrateSchema()` 注释，标记为后续迁移入口
- [x] **技术债#4**: 修复 `ensureUploadPath` 参数名 (`phone` → `userId`)
- [x] **技术债#6**: 添加请求日志中间件（记录方法、URL、状态码、耗时）
- [x] **技术债#7**: 反馈文本添加 800 字上限，错误信息本地化（中文）
- [x] **技术债#8**: 用户端错误信息统一为通用提示，详细日志写入服务端
- [x] **技术债#10**: JSON body limit 从 10mb 降至 1mb（图片走 fileUpload）

## TODO
- 配置 VDS OAuth 回调 URL（已在 `.env` 中预设）
- 用户自行配置 `ADMIN_PHONE` 环境变量
- ⚠️ **生产前必做**: 更换 `JWT_SECRET` 和 `AI_CHAT_API_KEY` 为真实值
- ⚠️ **生产前必做**: 设置 `CORS_ORIGIN` 环境变量为前端真实域名
