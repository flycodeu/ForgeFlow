# AI 研发控制台：Node/TypeScript 技术实现与目录结构

版本：v1.1 · 日期：2026-09-18 · 状态：实现蓝图，尚未编码

## 1. 为什么从 Java/Spring Boot 改为 Node.js

本项目的核心负载是：项目/规格 CRUD、版本与状态事务、REST、MCP、Diff/文本处理、文件证据、SSE 和本地部署。它不是高吞吐交易系统，也没有必须依赖 Java 生态的中间件。

因此 Node.js + TypeScript 更符合首版目标：

- MCP 官方 SDK 本身就是 TypeScript 一等实现，可直接接入 Fastify。
- Web 与 Server 共用 TypeScript 类型和校验模型，减少契约重复。
- 单进程即可同时提供 REST、MCP、静态 Web 和 SSE。
- 本地自用部署可以只保留一个 Node 进程、一个 SQLite 文件和证据目录。
- 对“我 + AI / 少量开发者”的并发量，Java/Spring Boot + 独立 MySQL 服务没有必要成为默认复杂度。

保留 Java 仍然是可行方案，但在这个具体产品上没有明显收益足以抵消依赖和部署复杂度，因此 v1.1 正式改为 Node/TypeScript。

## 2. 目标运行形态

```text
开发：
Vue/Vite :5173  ──proxy──> Fastify :8787 ──> SQLite
                                  └──────> data/evidence

生产：
Browser ──> Fastify :8787
              ├── /              Vue dist
              ├── /api/v1/*      REST
              ├── /mcp           MCP Streamable HTTP
              └── /api/events    SSE（需要时）
                    │
                    ├── SQLite database
                    └── evidence directory
```

不要求 Nginx、Redis、消息队列、Docker 或对象存储才能启动。

## 3. Monorepo

```text
forgeflow/
├── apps/
│   ├── server/
│   └── web/
├── packages/
│   └── contracts/
├── migrations/
├── data/
├── docs/
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

`packages/contracts` 只保存真正需要跨 Server/Web/MCP 共享的 Zod schema、枚举和类型。不要把所有内部实体都移入 shared package。

## 4. Server 结构

```text
apps/server/src/
├── app.ts
├── server.ts
├── config/
├── db/
│   ├── client.ts
│   └── schema/
├── modules/
│   ├── workspace/
│   │   ├── workspace.routes.ts
│   │   ├── workspace.service.ts
│   │   ├── workspace.repository.ts
│   │   └── workspace.schemas.ts
│   ├── specification/
│   ├── review/
│   ├── execution/
│   ├── quality/
│   ├── change/
│   ├── release/
│   └── security/
├── integration/
│   ├── mcp/
│   │   ├── server.ts
│   │   └── tools/
│   ├── import/
│   └── export/
└── shared/
    ├── errors/
    ├── logging/
    └── util/
```

原则：

1. `routes.ts` 只处理 HTTP、认证主体和响应格式。
2. MCP tools 只负责协议映射和输入输出，不写第二套状态机。
3. `service.ts` 是业务规则唯一入口。
4. `repository.ts` 负责 SQL/Drizzle，不决定业务状态。
5. `schemas.ts` 只放本模块实际需要的校验模型。
6. 一个简单模块可以只有 `service.ts + repository.ts`，不要为了目录整齐制造空文件。

## 5. 请求路径

```text
HTTP / MCP
   │
   ▼
Auth Context
   │
   ▼
Domain Service
   ├── policy / state transition
   ├── optimistic version check
   ├── idempotency
   └── transaction
          │
          ▼
      Repository
          │
          ▼
        SQLite
```

审批、授权、Run 启动、Run 提交这些关键写入由 Service 开启数据库事务。前端隐藏按钮不是权限控制。

## 6. 数据库

首版使用 SQLite，并开启：

```text
foreign_keys = ON
journal_mode = WAL
busy_timeout = 合理值
```

正文、Revision、Run 等普通数据写入 SQLite；截图、日志、测试报告等大文件写入 `data/evidence/`，数据库只保存元数据和 SHA-256。

推荐：Drizzle ORM + better-sqlite3。原因：Node 24 内置 `node:sqlite` 截至本稿仍是 Release Candidate；后续稳定后再评估切换。

不要：

- 把整个数据库设计成单张 JSON 表。
- 把 evidence BLOB 全部塞数据库。
- 首版同时维护 SQLite 和 MySQL/PostgreSQL。
- 声称未来数据库可以“零成本切换”；真正迁移时单独设计。

## 7. 认证

### 人类 Owner

- 初版单 Owner。
- 密码使用 Argon2id 或经评审的现代密码哈希。
- Web 登录后使用 HttpOnly Cookie Session。
- 状态写接口增加 CSRF 防护或等价同源机制。

### AI Client

- 每个 Codex/Claude 客户端签发独立高熵 Bearer Token。
- 数据库只存 Token hash、prefix、scope、project scope、过期/撤销时间。
- AI Token 永远没有 design approve、grant issue、human acceptance、delivery approve 权限。

不建设通用组织/角色/RBAC 平台。

## 8. MCP 实现

使用 MCP 官方 TypeScript SDK v2：

```text
@modelcontextprotocol/server
@modelcontextprotocol/fastify
```

Fastify 中只挂一个 MCP transport。工具函数调用和 REST 相同的 Service：

```text
rd_project_list      -> workspaceService.listProjects()
rd_spec_read         -> specificationService.getRevision()
rd_spec_save         -> specificationService.createRevision()
rd_task_context      -> executionService.getTaskContext()
rd_run_start         -> executionService.startRun()
rd_run_submit        -> executionService.submitRun()
```

MCP 工具禁止暴露：`shell_exec`、`execute_sql`、任意文件读取、任意状态设置、批准/授权接口。

## 9. Web

Vue 页面首版只做六个区域：

```text
项目总览
Feature工作台
评审中心
执行记录
版本/交付
AI接入设置
```

Feature 工作台使用 Tab，而不是每种信息独立路由成几十个页面：

```text
概览 | 设计 | 任务 | 代码/Run | 测试 | 验收 | 历史
```

设计正文仍是 Markdown，但以章节折叠、修订 Diff、待决事项和影响摘要呈现。

## 10. 实时状态

S1/S2 不需要实时通道。S3 有真实 Run 后再增加 SSE：

```text
GET /api/v1/projects/:id/events/stream
```

SSE 只推送平台已经收到的事实，例如 `RUN_STARTED / CHECK_RECORDED / RUN_SUBMITTED`。它不能伪造“AI 正在编辑第 42 行”。

## 11. 测试

Server：

- Service 单元测试：纯业务规则。
- API/MCP 接口测试：Fastify inject / SDK 客户端。
- 数据层关键事务：临时 SQLite 文件真实运行，不全部 mock。

Web：

- 关键组件和状态用 Vitest。
- 评审、授权、验收等真正重要流程用少量 Playwright E2E。

第一阶段最重要测试不是覆盖率数字，而是：

```text
Codex -> MCP 写入 revision 1
Web -> 能看到 revision 1
Claude -> MCP 读取并基于 revision 1 写 revision 2
Web -> 能看到差异
旧 revision 并发写 -> 409/业务冲突
AI 尝试批准 -> 拒绝
```

## 12. 不采用 NestJS 的原因

NestJS 可行，但首版不推荐。当前系统只有一个单体服务，没有复杂团队边界；其 Module/Controller/Provider/Decorator/DI 体系会增加 AI 自动生成模板代码的倾向。Fastify + 显式 Service/Repository 更容易控制“只写必要代码”。

以后如果项目团队和规模改变，可以重新评估，不需要把“框架偏好”升级成产品不变量。

## 13. 依赖控制

首版原则：每增加一个生产依赖必须回答“它解决了当前哪个明确问题”。建议初始集合控制在：

```text
fastify
@modelcontextprotocol/server
@modelcontextprotocol/fastify
zod
drizzle-orm
better-sqlite3
必要的 Fastify auth/cookie/static/rate-limit 插件
Vue/Vite/Element Plus
```

开发工具再加入 TypeScript、Vitest、Playwright、ESLint/Prettier 等。不要在 S1 就加入 Redis、BullMQ、Socket.IO、Prisma + Drizzle 双 ORM、GraphQL、CQRS、事件总线或微服务框架。

## 14. 数据库升级条件

SQLite 不是临时玩具，但需要明确升级触发条件。出现以下情况时再评估 PostgreSQL/MySQL：

- 多用户长期并发写成为常态。
- Run/Event 写入量使单机锁等待明显影响体验。
- 需要数据库独立高可用、远程备份/只读副本。
- 需要多个 Server 实例同时写同一数据库。

在触发前，SQLite 的单文件备份、恢复和部署简单性更符合产品目标。

## 15. 首次编码顺序

不要先生成完整目录和所有模块空文件。按 S1 创建：

```text
1. workspace 根目录 + pnpm workspace
2. Fastify 最小 server + health
3. SQLite / migration / Owner + AI token
4. project + spec revision
5. Vue 最小页面
6. MCP project/spec tools
7. 真实 Codex / Claude 联调
8. S1 验收后停止
```

S2 才创建 Feature/review/task；S3 才创建 grant/run/evidence。没有阶段需求的表和模块不提前生成。
