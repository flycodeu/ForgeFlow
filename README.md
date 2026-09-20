# ForgeFlow

ForgeFlow 是一个面向外部 AI 编程工具的软件工程工作台。它把原本散落在聊天、Markdown、代码仓库和测试输出中的研发信息，组织为可浏览、可追踪、可继续执行的工程上下文。

ForgeFlow 不内置模型，也不会扫描用户磁盘或启动任意 Shell。Codex、Claude Code 等外部工具通过 MCP 读取项目设计和源码绑定，在自己的工作环境中完成开发，再把结果写回 ForgeFlow。

## 核心模型

```text
项目
├─ 模块
│  └─ 功能
│     ├─ 能力项
│     └─ 工程设计
├─ 源码绑定
├─ 实施任务
└─ AI 执行记录
```

- `Specification / Revision` 保存项目、功能和能力项的版本化设计。
- `EngineeringAsset / Revision` 保存数据模型、接口、UI、Pipeline、算法和集成契约等工程设计。
- `ProjectSource` 登记一个项目关联的多个 Git 仓库或普通目录，不把源码位置等同于业务模块。
- `Task / Run` 记录实际实施过程；Run 会冻结当时采用的设计版本和多源码快照。
- 默认工作流为 `AUTO`；已有 `CONTROLLED` 审查与授权数据继续兼容。

## 技术栈

- Node.js 24
- pnpm 11
- Fastify
- Vue 3 + Vite
- SQLite + Drizzle ORM
- Model Context Protocol

## 快速开始

```powershell
pnpm install
pnpm dev
```

- 工作台：<http://127.0.0.1:5173>
- 健康检查：<http://127.0.0.1:8787/api/health>

必须从仓库根目录运行 `pnpm dev` 才会同时启动 Web 和 API。只运行 `pnpm dev:web` 时，页面无法访问后端。

默认数据库为 `data/forgeflow.db`。可通过 `FORGEFLOW_DB_PATH` 指定隔离数据库：

```powershell
$env:FORGEFLOW_DB_PATH = 'D:\Temp\forgeflow-dev.db'
pnpm dev
```

## 数据库结构

`migrations/schema.sql` 是新安装使用的完整数据库基线，不再把开发阶段拆成一组随机命名的 SQL 文件。

```text
migrations/
├─ schema.sql                         # 当前完整结构
├─ meta/
│  ├─ _journal.json                  # Drizzle 迁移账本
│  └─ schema_snapshot.json           # 当前 Drizzle 快照
└─ legacy/
   └─ pre-baseline-upgrade.sql       # 早期开发数据库的兼容升级
```

服务启动时自动初始化空数据库。早期预发布数据库会先走兼容升级，再登记为当前基线；Revision 和 EngineeringAsset 历史不会被覆盖。

修改 `schema.ts` 后生成迁移时必须使用清晰名称，并审阅 SQL：

```powershell
pnpm db:generate add_source_observation
pnpm db:migrate
```

不要提交 Drizzle 自动生成的随机名称，也不要用 schema push 替代可审查的迁移。

## Demo 数据

正式启动不会自动写入 Demo。需要体验多类型工程设计时，显式执行：

```powershell
pnpm seed:demo
```

Demo Revision 的来源统一标记为 `demo-seed:*`，其中的 Commit、测试结果和源码路径只用于界面演示，不能作为真实项目证据。

## 常用命令

```powershell
pnpm dev              # 同时启动 API 和 Web
pnpm dev:server       # 仅启动 API
pnpm dev:web          # 仅启动 Web
pnpm typecheck
pnpm build
pnpm test
pnpm db:migrate
pnpm seed:demo
```

测试使用临时 SQLite 文件，不会修改默认数据库。

## 仓库结构

```text
apps/
├─ server/             # Fastify、数据库、MCP 与领域服务
└─ web/                # Vue 工程工作台
packages/
└─ contracts/          # REST/MCP 共享契约
migrations/            # 数据库基线和兼容升级
```

`docs/`、`data/`、`dist/`、`.artifacts/`、`artifacts/`、IDE 配置和依赖目录均不进入版本库。评审记录、验收截图和过程性设计资料应保存在这些本地目录中，而不是提交到 Git。
