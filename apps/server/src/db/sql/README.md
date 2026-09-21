# ForgeFlow 模块化 SQL 架构设计说明

本项目数据库表结构采用**高内聚、低耦合**的独立 SQL 文件管理方式，避免所有 SQL 挤压在一个臃肿文件或依赖易混淆的数字前缀（如 `000xx.sql`）。

## 目录布局 (`apps/server/src/db/sql/`)

| 文件名 | 业务领域 | 核心数据表与对象 | 特性与约束 |
|---|---|---|---|
| `auth.sql` | 认证与凭证安全 | `rd_owner`, `rd_owner_session`, `rd_ai_token` | 单例管理员约束、会话哈希、AI 客户端 Token 隔离 |
| `project.sql` | 项目与功能拆解 | `rd_project`, `rd_module`, `rd_feature`, `rd_capability` | 项目唯一 Key、模块编码、特性状态机与层级排序 |
| `engineering.sql` | 研发规格与工程资产 | `rd_spec`, `rd_spec_revision`, `rd_design_review`, `rd_engineering_asset`, `rd_engineering_asset_revision`, `rd_trace_link` | 规格不可变触发器、工程资产版本防篡改、设计评审基线闭环 |
| `task.sql` | 任务与 AI 协同执行 | `rd_task`, `rd_task_authorization`, `rd_ai_run` | 任务授权周期校验、AI Run 状态与阶段约束、排它执行索引 |
| `source.sql` | 源码仓库与快照解析 | `rd_project_source`, `rd_source_analysis` | 仓库别名与幂等键、源码分析生命周期状态 |
| `work_event.sql` | 工作事件流与审计 | `rd_work_event` | 只追加（Append-Only）事件流、不可修改/不可删除防篡改触发器 |

## 数据库迁移规则 (Migrations)

1. **语义化命名**：迁移文件位于 `migrations/`，必须使用纯业务语义英文命名（例如 `schema.sql`, `work_events.sql`），禁止使用 `0001_`, `0002_` 等无意义数字前缀。
2. **独立性与解耦**：每个模块的 SQL 结构尽量自包含，索引与外键清晰标注。
3. **不可变保护**：历史版本与审计事件均通过 SQLite `TRIGGER` 在底层保障，不允许业务代码绕过。
