# ForgeFlow Windows 桌面壳

当前是可编译的 Windows 原型，不是已签名安装版。使用 Tauri 2 / WebView2，加载正式构建页面，不启动 Vite。托盘提供打开、后台状态、停止后台并退出。关闭窗口隐藏，最小化仍留在任务栏；再次启动恢复已有窗口。

```powershell
pnpm build
node scripts/desktop-prepare.mjs
cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
powershell -File scripts/desktop-start.ps1
```

完成构建后，`node scripts/desktop-package.mjs` 生成 `apps/desktop/dist/ForgeFlow/ForgeFlow.exe` 及旁边的独立运行资源。整个文件夹可以移动，不能只复制 exe。发布优化版本先 `cargo build --release --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`，再使用 `node scripts/desktop-package.mjs --release`。目前未签名，不含安装/自动更新功能。

首次原生编译需要 Rust、MSVC 构建工具和联网下载 Cargo 依赖。运行资源准备只复制已安装的生产依赖，保留不同版本的嵌套依赖，并执行打包后的 SQLite 原生模块检查。Node 运行时必须为 24，使用准备构建时的同一 node.exe。

数据位于 `%LOCALAPPDATA%\ForgeFlow`；不会复制、迁移或覆盖仓库 `data/forgeflow.db`。现有项目通过项目档案导出/恢复迁入。测试可显式指定 `FORGEFLOW_DATA_DIR`，正式启动不建议改变该路径。

桌面以命名管道取得数据目录唯一锁后启动服务，使用随机端口，不占用或关闭开发服务 8787/5173。随机秘密通过环境和私有管道传递；身份握手后创建 httpOnly 会话。受当前用户 ACL 保护的 `runtime.json` 含服务发现凭证，不应分享；日志不存秘密。只关闭自己启动的进程。意外崩溃最多重启三次，主动关闭不重启。桌面父进程终止会关闭其自有后台服务，不会停止 Codex 或 Claude。

`runtime` 为可丢弃构建目录；准备脚本拒绝覆盖已有目录，升级前将其改名保留，再重新准备。不要把用户数据复制到该目录。便携包中的 exe 自动读取旁边的 `runtime`，开发构建通过启动脚本定位资源；签名安装包、开机启动、持久窗口位置和空闲资源预算尚未验收。

## 检查

```powershell
node --test scripts/desktop-service.test.mjs
$env:FORGEFLOW_RUNTIME_ROOT = (Resolve-Path apps/desktop/runtime).Path
node --test scripts/desktop-service.integration.test.mjs
```

原生构建成功不等于托盘点击、DPI、后台 30 分钟 CPU/内存测试通过。相关结果记录在本轮实施验证文档中。

实现参考：[Tauri 托盘](https://v2.tauri.app/learn/system-tray/)、[单实例](https://v2.tauri.app/plugin/single-instance/)、[资源路径](https://v2.tauri.app/develop/resources/)。
