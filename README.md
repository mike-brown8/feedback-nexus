# Feedback Nexus

智能反馈聚合系统 — 替代 Issues 的国内部署方案，通过 AI 语义聚类自动归并用户反馈，支持人工审批评审流程。

> AI 后端使用火山方舟（Volcengine Ark）API

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
| AI | 火山方舟（Volcengine Ark）Chat / Embedding / Vision API |

## 项目结构

```
├── client/                       # 前端（Vue 3 + Vite）
│   ├── src/
│   │   ├── views/
│   │   │   ├── LoginPage.vue     # VDS SSO 登录
│   │   │   ├── SubmitPage.vue    # 反馈提交页面（含图片上传）
│   │   │   ├── BoardPage.vue     # 公开看板（已知问题/收到的反馈）
│   │   │   ├── AdminPage.vue     # 管理后台（草稿/待处理/已发布/用户）
│   │   │   └── UserListPage.vue  # 用户管理
│   │   ├── App.vue               # 根组件（导航/鉴权/会话管理）
│   │   ├── main.js
│   │   └── styles.css            # 全局样式
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── server/                       # 后端（Express + SQLite）
│   ├── config.js                 # 环境配置映射
│   ├── src/
│   │   ├── index.js              # 入口，中间件配置
│   │   ├── routes/
│   │   │   ├── auth.js           # VDS OAuth 登录
│   │   │   ├── feedback.js       # 反馈提交 + AI 聚类 + 起名
│   │   │   ├── public.js         # 公开看板 API
│   │   │   └── admin.js          # 管理后台 API
│   │   └── lib/
│   │       ├── db.js             # SQLite 数据库初始化与 schema
│   │       ├── jwt.js            # JWT 签发与验证
│   │       ├── ai.js             # 火山方舟 AI 调用封装
│   │       ├── vds-oauth.js      # VDS 平台签名 & OAuth 代理
│   │       ├── logger.js         # 日志（控制台+文件）
│   │       └── utils.js          # 工具函数（日期/文件/向量相似度）
│   ├── data/                     # SQLite 数据库文件
│   ├── logs/                     # 日志文件
│   ├── uploads/                  # 用户上传图片
│   ├── .env.example
│   └── package.json
├── start-server.bat              # Windows 服务端启动脚本
├── start-server.sh               # Linux/Mac 服务端启动脚本
├── start-client.bat              # Windows 前端构建脚本
├── start-client.sh               # Linux/Mac 前端构建脚本
├── PROGRESS.md                   # 项目进度
├── project-overview.md           # 架构设计文档
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
| `ARK_API_KEY` | 火山方舟 API Key |
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
# 构建前端
cd client && npm install && npm run build     # 产出 dist/

# 启动后端
cd ../server && npm install && npm start       # 监听 :4000
```

### Nginx 反向代理配置

前端为纯静态文件，后端为 API 服务。通过 nginx 统一入口：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # 前端静态文件
    root /path/to/client/dist;
    index index.html;

    # API 请求转发到后端
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # SPA 路由回退（刷新页面不404）
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

路由规则：
- **`/`** → 前端 Vue 静态页面（`client/dist`）
- **`/api/`** → 后端 Express 服务（`localhost:4000`）

部署后修改 `server/.env` 中的 `OAUTH_REDIRECT_URI` 和 `FRONTEND_REDIRECT_URI` 为生产域名。

## API 概览

| 路径 | 方法 | 鉴权 | 说明 |
|------|------|------|------|
| `GET /health` | GET | 无 | 健康检查 |
| `GET /api/auth/sso/authorize` | GET | 无 | 跳转 VDS 登录 |
| `GET /api/auth/sso/callback` | GET | 无 | OAuth 回调（返回加载页） |
| `POST /api/auth/sso/complete` | POST | 无 | OAuth 令牌交换 |
| `GET /api/auth/me` | GET | Bearer | 当前用户信息 |
| `POST /api/feedback` | POST | Bearer | 提交反馈（文本+可选图片） |
| `GET /api/feedback/image-status` | GET | Bearer | 图片服务状态 & 每日上限 |
| `GET /api/public/issues` | GET | Bearer | 公开 Issue 列表 |
| `GET /api/admin/images/file/:id` | GET | Query Token + Admin | 查看原始图片文件 |
| `GET /api/admin/drafts` | GET | Admin | 草稿列表（分页+分类筛选） |
| `GET /api/admin/drafts/:id` | GET | Admin | 草稿详情 |
| `POST /api/admin/drafts/:id/publish` | POST | Admin | 批准公开 |
| `POST /api/admin/drafts/:id/reject` | POST | Admin | 驳回删除 |
| `GET /api/admin/unprocessed` | GET | Admin | 待处理/失败反馈列表 |
| `POST /api/admin/unprocessed/:id/retry` | POST | Admin | 重试单个失败反馈 |
| `POST /api/admin/unprocessed/retry-all` | POST | Admin | 重试所有失败反馈 |
| `GET /api/admin/published` | GET | Admin | 已发布 Issue 列表（分类筛选） |
| `POST /api/admin/issues/:id/status` | POST | Admin | 切换 issue 状态 |
| `POST /api/admin/issues/:id/complete` | POST | Admin | 完成并删除 issue |
| `GET /api/admin/images/:feedbackId` | GET | Admin | 查询反馈的图片元信息 |
| `GET /api/admin/users` | GET | Admin | 用户列表（搜索+分页） |
| `GET /api/admin/users/:id` | GET | Admin | 用户详情+统计 |
| `POST /api/admin/users/:id/ban` | POST | Admin | 封禁用户 |
| `POST /api/admin/users/:id/unban` | POST | Admin | 解封用户 |
| `GET /api/admin/users/:id/feedbacks` | GET | Admin | 用户的历史反馈 |

## 设计理念

- **盲盒式提交**：用户提交后与反馈失联，看不到追踪 ID 和历史
- **内外有别**：管理员可见原始内容（含手机号、图片），公开看板只展示 AI 摘要
- **草稿即沙盒**：新问题先进草稿池，累计满 5 条反馈触发 AI 自动优化
- **发布即冻结**：一旦公开，标题和描述永不改变

## 许可证

GNU General Public License v3.0 — 详见 [LICENSE](./LICENSE) 文件。
