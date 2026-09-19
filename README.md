# ForgeFlow

ForgeFlow 是面向人和外部 AI 的研发控制台。当前实现 Project → Module → Feature → Feature Design Revision 的基础闭环，并保留 AI Token 接入能力。

## 环境

- Node.js 24 LTS（使用 `node --version` 确认当前终端为 v24）
- pnpm 11.18.0

## 开发

```powershell
pnpm install
pnpm dev
```

- Web：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8787/api/health`

数据库默认位于 `data/forgeflow.db`，Server 启动时会先执行 `migrations/` 中尚未应用的正式迁移。启动或迁移失败会报错并退出。`/api/health` 返回数据库探测结果。

```powershell
pnpm db:generate # 修改 Drizzle schema 后生成待审阅的 SQL migration
pnpm db:migrate  # 单独执行尚未应用的 migration
pnpm test        # 使用临时 SQLite 文件验证迁移、业务与认证
```

本地验证可用 `FORGEFLOW_DB_PATH` 指定另一数据库文件；未设置时始终使用上述默认路径。`data/` 已被 Git 忽略。不要使用 schema 自动同步代替 migration。

Vite 将 `/api` 请求转发给本机 Fastify 服务。也可用 `pnpm dev:server` 和 `pnpm dev:web` 分别启动。

## 检查与构建

```powershell
pnpm typecheck
pnpm build
pnpm start:server
```

`pnpm start:server` 运行构建后的 API。开发时 Vite 将 `/api` 转发给本机 Server；当前 Web 构建产物尚未由 API 服务托管。

## 项目、功能与设计版本

打开 `http://127.0.0.1:5173/` 后直接进入本地项目列表，无需 Web 登录。进入项目后可维护模块与功能，并在 Feature 详情中创建版本化 Markdown 设计。项目级需求、架构、技术栈与 Feature 设计共用 `rd_spec` / `rd_spec_revision`：`feature_id` 为空表示项目级资料，非空表示 Feature 设计。历史 Revision 只读；创建新 Revision 时，API 要求 `expectedHeadRevisionId` 等于当前最新 Revision ID（初版为 `null`），旧页面提交会收到 409，Web 会保留草稿供对照。

Module API：`GET/POST /api/projects/:projectId/modules`、`PATCH /api/projects/:projectId/modules/:moduleId`。Feature API：`GET/POST /api/projects/:projectId/features`（可用 `moduleId` 查询参数过滤）、`GET/PATCH /api/projects/:projectId/features/:featureId`。本阶段不提供删除接口。

Specification API 继续使用 `POST /api/projects/:projectId/specifications`、`GET /api/projects/:projectId/specifications/:specId`，以及该规格下的 `POST/GET .../revisions`、`GET .../revisions/:revisionId`。新 Revision 的 `source` 由服务端认证身份生成；旧数据中的 `api` 或 `unknown` 保留原值。

## 认证

ForgeFlow 当前仅监听 `127.0.0.1`，本地 Web 工作台不再以 Owner Session 作为访问前提。原 Owner Session、初始化和登录接口暂时保留用于兼容，已不再由 Web 入口调用；后续远程部署认证需单独设计和启用。

本地用户可在 Web 的 Token 页面创建、列出和撤销 AI Token；API 对应 `POST/GET /api/ai-tokens`、`POST /api/ai-tokens/:tokenId/revoke`。明文只在创建响应中返回，之后只能看到名称、Scope 和时间。AI Client 使用 `Authorization: Bearer <token>`；三个独立 Scope 是 `project:read`、`spec:read`、`spec:write`，没有隐含继承。携带 Bearer Token 的请求仍严格校验 Scope，权限不足返回 403。

设计蓝图目前保存在 `docs/blueprint/ai-rd-console-design-v1.1-node/docs/blueprint/`。
