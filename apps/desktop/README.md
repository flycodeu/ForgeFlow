# ForgeFlow Windows 桌面版

使用 Tauri 2 / WebView2 加载正式页面，不启动 Vite。关闭窗口进入托盘，最小化保留任务栏入口；托盘可打开窗口、管理数据位置、停止后台并退出。再次启动会恢复已有窗口。

## 安装和数据位置

运行 `ForgeFlow-Setup-0.1.0.exe`，安装向导支持选择程序目录。目标必须是空的本地文件夹，不需要管理员权限。当前没有原位覆盖升级：先从托盘退出、卸载旧版，再安装新版。卸载仅处理安装清单内未修改的程序文件，不删除项目数据或存储配置。

首次启动会询问数据位置。请选择专用目录；建议位置为 `%LOCALAPPDATA%\ForgeFlow\data`，也可以选择其他本机磁盘。已有旧版默认目录数据会提供沿用选项，不会自动覆盖。

设置页的“数据存储”显示当前位置，点击“管理存储位置”，或使用托盘“数据存储位置…”修改。迁移前停止自有后台，复制后校验文件清单、SHA256 与 SQLite 完整性，验证新后台可以启动后才完成切换。提交配置前失败会恢复原目录服务；提交后若窗口连接失败，重新启动将使用已保存的新目录。原目录始终保留，不自动删除。目标必须为空，不能与旧目录互相包含，也不能放在程序安装目录。迁移时不要退出应用或让其他程序修改数据文件。

位置选择保存在 `%LOCALAPPDATA%\ForgeFlow\storage.json`，不随业务目录移动。所选目录存放项目数据库、文档、工作记录与采集队列。已配置目录的主数据库缺失或文件格式无效时拒绝启动，不会新建空库替代。WebView2 的浏览器缓存不属于所选业务数据目录，仍由 Windows/WebView2 管理。开发调试可用 `FORGEFLOW_DATA_DIR` 覆盖业务目录；使用该覆盖时不支持界面迁移。

便携版可整体移动 `ForgeFlow` 文件夹运行，不能只复制 exe。程序目录和数据目录分开；移动程序不等于迁移数据。桌面不自动读取仓库 `data/forgeflow.db`，开发项目通过档案导出/恢复迁入。

## 构建

```powershell
pnpm build
node scripts/desktop-prepare.mjs
cargo build --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
node scripts/desktop-package.mjs
node scripts/installer-build.mjs
```

构建产物位于 `apps/desktop/dist`。首次编译需要 Rust、MSVC、Cargo 依赖及 Node 24。安装包编译还需要 NSIS 便携工具，详见仓库中的 `apps/desktop/installer/README.md`。当前包未签名，也没有自动更新、开机启动功能；运行机器需安装 Microsoft Edge WebView2 Runtime。

生成优化版本时，Cargo 命令增加 `--release`，然后运行 `node scripts/desktop-package.mjs --release`。运行资源准备只复制已安装的生产依赖，执行 SQLite 原生模块检查。准备/便携打包拒绝覆盖已有目录，请先改名保留旧产物。不要把用户数据放入构建资源目录。

## 后台与验证边界

桌面先取得数据目录唯一锁，再用随机端口启动后台，不占用或关闭开发服务的 8787/5173 端口。受当前用户 ACL 保护的 `runtime.json` 含服务发现凭证，不应分享。只关闭本应用启动的进程；异常退出最多重试三次，主动退出不重启。关闭桌面父进程会关闭自有后台，不停止 Codex、Claude 等其他应用。

```powershell
node --test scripts/desktop-service.test.mjs scripts/lib/desktop-storage.test.mjs scripts/installer-guard.test.mjs
$env:FORGEFLOW_RUNTIME_ROOT = (Resolve-Path apps/desktop/runtime).Path
node --test scripts/desktop-service.integration.test.mjs
```

构建、静默安装和自动化测试不等同于人工完成托盘鼠标交互、多显示器缩放和长期运行验收。具体通过项目与未验证项以本次交付的验证报告为准。

实现参考：[Tauri 托盘](https://v2.tauri.app/learn/system-tray/)、[单实例](https://v2.tauri.app/plugin/single-instance/)、[资源路径](https://v2.tauri.app/develop/resources/)。
