# Feedback Nexus

智能反馈聚合系统 — 替代 Issues 的国内部署方案，通过 AI 语义聚类自动归并用户反馈，支持人工审批评审流程。

> 使用 Vibe Coding 编写，感谢 DeepSeek 和 Raptor Mini！

## 核心流程

```
用户提交反馈（文本 + 可选图片）
       ↓
AI 语义匹配 → 归入已有 Issue / 创建新草稿
       ↓
草稿累计满 5 条反馈 → AI 自动优化标题和描述
       ↓
管理员审批 → 批准并公开 / 驳回并删除
       ↓
公开看板展示（标题 + 状态，不暴露原始内容）
```

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Vue 3 (Composition API) + Vite |
| 后端 | Express.js (ESM) |
| 数据库 | SQLite (better-sqlite3) |
| 认证 | VDS OAuth 2.0 + JWT |
| AI | 兼容 OpenAI 格式的 Chat / Embedding / Vision API |

## 项目结构

```
├── client/                  # 前端（Vue 3）
│   ├── src/
│   │   ├── views/
│   │   │   ├── LoginPage.vue      # VDS SSO 登录
│   │   │   ├── SubmitPage.vue     # 反馈提交页面
│   │   │   ├── BoardPage.vue      # 公开看板
│   │   │   ├── AdminPage.vue      # 管理后台
│   │   │   └── UserListPage.vue   # 用户管理
│   │   ├── App.vue
│   │   └── main.js
│   └── vite.config.js
├── server/                  # 后端（Express）
│   ├── src/
│   │   ├── index.js              # 入口，中间件配置
│   │   ├── config.js             # 环境配置
│   │   ├── routes/
│   │   │   ├── auth.js           # VDS OAuth 登录
│   │   │   ├── feedback.js       # 反馈提交 + AI 聚类
│   │   │   ├── public.js         # 公开看板 API
│   │   │   └── admin.js          # 管理后台 API
│   │   └── lib/
│   │       ├── db.js             # SQLite 数据库
│   │       ├── jwt.js            # JWT 认证
│   │       ├── ai.js             # AI 调用封装
│   │       ├── vds-oauth.js      # VDS 平台签名 & OAuth
│   │       ├── logger.js         # 日志
│   │       └── utils.js          # 工具函数
│   ├── .env.example
│   └── data/                     # SQLite 数据库文件
└── .gitignore
```

## 快速开始

### 前置要求

- Node.js 18+
- VDS 开放平台应用（在 https://developer.vds.pub 注册）

### 安装

```bash
# 安装依赖
cd server && npm install
cd ../client && npm install
```

### 配置

```bash
cp server/.env.example server/.env
```

编辑 `server/.env`，填入：

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | JWT 签名密钥，`openssl rand -hex 64` 生成 |
| `AI_CHAT_API_KEY` | Chat 模型 API 密钥 |
| `AI_EMBEDDING_API_KEY` | Embedding 模型 API 密钥 |
| `OAUTH_CLIENT_ID` | VDS 应用 ID（`vap_` 开头） |
| `OAUTH_CLIENT_SECRET` | VDS 应用密钥 |
| `ADMIN_USERNAME` | 管理员 VDS 用户名 |

### 启动开发服务

```bash
# 方式一：同时启动前后端（根目录）
npm run dev

# 方式二：分别启动
cd server && npm run dev    # 后端 http://localhost:4000
cd client && npm run dev    # 前端 http://localhost:5173
```

### 生产部署

```bash
cd client && npm run build     # 构建前端到 dist/
cd server && npm start         # 启动后端（端口 4000）
```

## API 概览

| 路径 | 鉴权 | 说明 |
|------|------|------|
| `GET /api/auth/sso/authorize` | 无 | 跳转 VDS 登录 |
| `GET /api/auth/sso/callback` | 无 | OAuth 回调 |
| `POST /api/auth/sso/complete` | 无 | OAuth 令牌交换 |
| `GET /api/auth/me` | Bearer | 当前用户信息 |
| `POST /api/feedback` | Bearer | 提交反馈 |
| `GET /api/feedback/image-status` | Bearer | 图片服务状态 |
| `GET /api/public/issues` | Bearer | 公开 Issue 列表 |
| `GET /api/admin/drafts` | Admin | 草稿列表 |
| `POST /api/admin/drafts/:id/publish` | Admin | 批准公开 |
| `POST /api/admin/drafts/:id/reject` | Admin | 驳回删除 |
| `GET /api/admin/users` | Admin | 用户管理 |
| `POST /api/admin/users/:id/ban` | Admin | 封禁用户 |
| `POST /api/admin/users/:id/unban` | Admin | 解封用户 |

## 设计原则

- **盲盒式提交**：用户提交后与反馈失联，看不到追踪 ID 和历史
- **内外有别**：管理员可见原始内容（含手机号、图片），公开看板只展示 AI 摘要
- **草稿即沙盒**：新问题先进草稿池，累计满 5 条反馈触发 AI 自动优化
- **发布即冻结**：一旦公开，标题和描述永不改变

## 许可证

GNU General Public License v3.0 — 详见 [LICENSE](./LICENSE) 文件。
