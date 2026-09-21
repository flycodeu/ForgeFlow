# ForgeFlow

ForgeFlow 保存功能设计档案与 AI 工作记录，让项目文档、设计变化和实施结果可以持续回看。AI 可以沿用自己的工作方式和文档格式，也可以扩展原计划；这里负责保留记录，不要求固定的规划顺序。

ForgeFlow 不内置模型，也不执行 AI 返回的 Shell。外部工具可以通过 MCP 读写设计和记录；也可在项目内启用本地会话采集，只解析明确指定的目录，保存工作路径匹配本项目的可见消息。

## 核心模型

```text
项目
├─ 模块
│  └─ 功能
│     ├─ 能力项
│     └─ 工程设计
├─ 源码绑定
├─ 项目文档与历史版本
├─ 工作记录
├─ 实施任务
└─ AI 执行记录
```

- `Specification / Revision` 保存项目、功能和能力项的版本化设计。
- `EngineeringAsset / Revision` 保存数据模型、接口、UI、Pipeline、算法和集成契约等工程设计。
- `ProjectSource` 登记一个项目关联的多个 Git 仓库或普通目录，不把源码位置等同于业务模块。
- `Task / Run` 记录实际实施过程；Run 会冻结当时采用的设计版本和多源码快照。
- 默认工作流为 `AUTO`；已有 `CONTROLLED` 审查与授权数据继续兼容。
- 项目文档复用现有资料版本存储；独立工作记录不依赖 Task / Run，不会把“完成”的自述换算成验证通过。

## 项目档案与记录

项目内的“项目档案”支持 Markdown / UTF-8 文本原文存储、编辑、历史查看和 JSON 项目快照导出。编辑必须基于当前版本，冲突不会覆盖旧内容。项目首页可预览 JSON 存档并恢复为新项目，保留历史和结构化关联，不覆盖原项目，不恢复源码文件、凭证或自动启动任务。当前不提供 PDF / Word 解析和二进制附件存储。

“工作记录”可以独立补记计划、进展、设计和结果，并关联具体文档版本。记录只追加；已有工作记录的项目暂不支持永久删除。更正应追加说明，导出不包含系统凭证。

在仓库根目录同步明确指定的文件：

```powershell
pnpm archive sync --project FORGEFLOW --file "设计.md"
pnpm archive sync --project FORGEFLOW --file "设计.md" --watch
pnpm archive record --project FORGEFLOW --type RESULT --title "本轮结果" --file "结果.md" --operation-id "本轮唯一标识"
pnpm archive export --project FORGEFLOW --out "项目档案.json"
```

项目须事先创建。`--watch` 每 5 秒读取指定文件，先把快照保存到 SQLite 持久队列，再发送；观察间隔内的中间版本不保证捕获。关闭进程不会丢弃待传记录，重新运行 watch 或 flush 继续发送。离线首次入队使用 `--project-id UUID`。导出命令拒绝覆盖已有文件。

“工作记录 → 自动采集与重试”支持 Codex、Claude Code 的本地 JSONL 会话。指定项目工作目录及客户端会话目录后，后台持续采集匹配会话，默认只采集启用后的记录；首次接入可选包含历史。不会保存隐藏推理或工具原始参数/输出；可见文本仅作尽力脱敏。格式变化、认证失效和版本冲突会保留队列并显示问题，不跳过或覆盖。其他客户端和云端会话未接入，不能声称“所有 AI 平台”均已支持。

CLI 队列与项目自动采集队列各自持久化；桌面后台只调度项目采集队列，独立 CLI 队列需要 watch 或 `pnpm archive flush --state 队列目录`。文件原文同步不做脱敏，不要选择凭证文件。详见 [采集和重试说明](scripts/lib/CAPTURE.md)。

MCP 新增 `list_project_archive`、`get_project_document`、`archive_project_document`、`record_project_work`、`list_project_work`。读取需要 `project:read` / `spec:read`，写入需要 `spec:write`；导出另需 `task:read`。接入后由客户端主动记录，不改变其原有生成文档方式。

CLI 可通过 `FORGEFLOW_URL` 显式指定本机服务地址，通过 `FORGEFLOW_TOKEN` 提供已有凭证；未指定地址时发现本机桌面服务，没有桌面描述文件时使用开发服务 8787。重试事件保留 `operationId`；AI Token 轮换后的去重续接尚未支持。

## Windows 桌面版

`apps/desktop/dist/ForgeFlow/ForgeFlow.exe` 为未签名便携版，必须保留旁边的运行资源文件夹。使用 WebView2，加载构建页面，不运行 Vite。关闭窗口隐藏到托盘，最小化保留在任务栏；托盘可打开窗口、查看后台状态、停止并退出。数据独立保存在 `%LOCALAPPDATA%\ForgeFlow`，通过导出/恢复迁入开发项目，不自动复制开发数据库。

后台使用随机本机端口和会话认证；不会关闭其他软件端口，崩溃最多自动重启三次。当前 HTTP MCP 配置在后台换端口后需重新复制；稳定的 MCP 服务发现桥接尚未实现。托盘鼠标交互、DPI 和长时间资源占用仍需原生桌面验收；未提供签名安装包、开机启动和自动升级。构建及运行见 [桌面说明](apps/desktop/README.md)。

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

`migrations/schema.sql` 是数据库基线，后续命名迁移按账本顺序应用；不要修改已经应用的迁移。

```text
migrations/
├─ schema.sql                       # 初始基线
├─ 0001_add_project_work_events.sql # 工作记录
├─ 0002_seal_work_events.sql         # 记录只追加
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
