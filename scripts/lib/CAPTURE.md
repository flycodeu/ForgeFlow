# 本地采集与持久队列

需要 Node.js 24。状态保存在调用方指定目录的 `collector.sqlite`，使用事务、WAL 和 FULL 同步。

## 服务调用

`session-capture.mjs` 导出：

- `configureCapture(stateDir, config)`：写配置，不读取会话目录。
- `captureStatus(stateDir)`：返回配置、待发送数量、阻塞原因、源文件偏移；不返回消息正文。
- `pollCapture(stateDir)`：只在 enabled 时读取显式来源，队列和读取偏移同事务提交。
- `flushCapture(stateDir, { token?, headers?, force?, maxItems?, timeBudgetMs? })`：发送已落盘内容，默认最多 20 项、5 秒预算，单请求最多 3 秒。`force` 明确重试包括 401/409 的阻塞项，不修改内容或标识。
- `enqueueWork`、`enqueueDocument`：供 CLI 入队。`documentQueueHead` 读取文档基线；`adoptDocumentBaseline` 需要用户明确接受远端新基线。

配置格式（不允许凭证进入配置）：

```json
{
  "version": 1,
  "enabled": false,
  "projectId": "0666417d-f47e-4a55-9328-14ffa5166c5b",
  "workspaceRoot": "D:\\FlyLabs\\ForgeFlow",
  "serverUrl": "http://127.0.0.1:8787",
  "includeHistory": false,
  "sources": [{ "kind": "codex", "directory": "D:\\explicit-session-directory" }],
  "maxQueueItems": 10000,
  "maxQueueBytes": 33554432
}
```

`sources.kind` 支持 `codex`、`claude`。不默认扫描用户主目录，不修改 Codex/Claude 配置。首次启用默认只保存配置时间之后的可见消息；为了确定工作目录，可能分批解析既有记录的结构。启用 `includeHistory` 才保存历史正文。已开始读取后不能切换历史模式或改绑项目/工作区，应使用新状态目录。暂停采集不删除已入队内容；CLI `flush` 是用户明确要求重试待发送内容。

服务状态别名：`pendingCount`、`blockedCount`、`queueBytes`、`filesSeen`、`lastError`、`lastPollAt`、`lastSuccessAt`；详细 `failures`、`sources`、`diagnostics` 不含正文。配置和状态应只对本机所有者开放。

## 采集边界

采集 Codex rollout JSONL / Claude Code 本地会话 JSONL 中属于已选工作区（含子目录）的用户、助手可见文本及工具名称/返回状态。推理、系统和开发者提示、加密字段、工具参数和任意工具输出不会保存。标准密钥、Bearer、密码赋值、私钥做尽力脱敏；**不能承诺识别自然语言中所有敏感内容**。队列中的会话正文仍属于私人数据，状态目录应保留用户私有访问权限，不进入 Git。原文文档同步按用户指定保存原文，不改写文档中的内容；请勿选择凭证文件。

格式不匹配、损坏 JSON、过长单行、文件被截断/重写均保留当前偏移并显示问题，不猜测或越过该行。工具 JSONL 是兼容适配器，不是所有客户端的通用会话 API；云端、未落地文件和未知版本不支持。文件解析每轮每文件最多 4 MiB，单行超过 4 MiB 阻塞。来源最多 10,000 个 JSONL、递归 12 层，跳过符号链接。工具将来源会话 ID 哈希为短标识，不读取完整模型内部过程。

官方资料核对于 2026-09-21：[Codex 非交互 JSONL 输出](https://developers.openai.com/codex/noninteractive)、[Codex App Server 可见消息与推理分别建模](https://developers.openai.com/codex/app-server)、[Claude Code Hooks 中的 cwd/transcript_path](https://code.claude.com/docs/en/hooks)。本实现不安装 hook，也不假定内部 rollout 文件格式是稳定公开协议。

## 故障恢复

稳定 operationId 随数据先落盘，收到有效 committed 回执才删除队列；断网、进程退出、回执丢失后使用同一标识重试。错误响应正文和授权头不写入队列或日志。退避最多 5 分钟。401/403/409 等需修复配置/冲突后明确重试；不能通过删除队列伪装成功。应持续使用同一服务端身份，切换凭证身份可能改变服务端幂等范围。

容量满停止推进源文件偏移，已观察到的文档快照无法入队时返回明确失败，不丢弃旧项。队列容量有界；已确认标识账本和源文件索引用于防重，会随使用增长，未自动清理。采集不是操作系统级备份：未轮询到就已被删除/覆盖的文件内容无法恢复。

文档 `sync --watch` 每 5 秒观察一次，每次观察到的内容先保存独立快照，断线恢复后按同文件顺序上传。已有远端文档通过持久版本基线检查，冲突时不覆盖；首次离线无基线且远端已有不同内容时阻塞。用户核对/合并后使用 `--adopt-current` 明确接受基线再重试。上传回执丢失时只在当前远端内容和元数据完全相同时认领该版本，否则保留冲突。工具无法捕获两次观察之间的中间编辑。

## CLI

```powershell
node scripts/session-capture.mjs configure --state D:\\ForgeFlowData\\capture --config capture.json
node scripts/session-capture.mjs watch --state D:\\ForgeFlowData\\capture
node scripts/session-capture.mjs status --state D:\\ForgeFlowData\\capture
node scripts/session-capture.mjs flush --state D:\\ForgeFlowData\\capture --force

pnpm archive record --project-id 0666417d-f47e-4a55-9328-14ffa5166c5b --title "本轮结果" --file result.md
pnpm archive sync --project-id 0666417d-f47e-4a55-9328-14ffa5166c5b --file design.md --watch
pnpm archive status --state data/archive-cli/0666417d-f47e-4a55-9328-14ffa5166c5b
pnpm archive flush --state data/archive-cli/0666417d-f47e-4a55-9328-14ffa5166c5b --force
```

离线入队须使用已知 `--project-id`；项目名称解析需要在线。`FORGEFLOW_TOKEN` 仅来自当前进程环境，不落盘。CLI 会话采集与 CLI 文档同步目录分开，桌面后台不会自动发送未配置的独立 CLI 队列。退出码 2 表示内容已保留但仍有待发送/来源异常，0 表示当前批次无未解决项。

### archive CLI 连接桌面

`sync`、`record`、`export`、`flush` 按以下顺序选择服务：显式 `FORGEFLOW_URL`；否则读取 `FORGEFLOW_DATA_DIR/runtime.json`，或 `%LOCALAPPDATA%/ForgeFlow/runtime.json`。运行信息中的回环地址和协议通过检查后，使用仅在内存中的桌面秘密请求 `/api/runtime/identity`，确认 `instanceId` 一致才访问项目。秘密不进入队列、状态输出或日志。

运行信息不存在时默认连接开发服务 `127.0.0.1:8787`；单独执行 `flush` 会兼容队列中保存的自定义本机服务地址。运行信息存在但损坏、服务离线或身份不匹配时，不回退到其他实例。显式地址不会借用桌面秘密；需要 AI Token 的服务仍通过 `FORGEFLOW_TOKEN` 授权。

`sync --watch` 每轮重新发现服务，因此桌面重启导致端口和秘密轮换后会自动重新握手。已知 `--project-id` 时，即使服务发现失败，`record` / `sync` 仍将内容保存在本地队列，不发送到其他实例；项目名称解析和导出仍要求在线。`status` 只读本地队列，不访问运行信息或网络。恢复后重新执行 `flush`，或保持 watch 运行即可继续发送。`--adopt-current` 需要成功读取远端基线，离线时不会接受新基线。

测试：`node --test scripts/lib/session-capture.test.mjs scripts/lib/runtime-discovery.test.mjs`。
