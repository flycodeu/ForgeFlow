# Windows 安装包

先生成完整便携目录 `apps/desktop/dist/ForgeFlow`，再运行：

```powershell
node scripts/installer-build.mjs
```

输出 `apps/desktop/dist/ForgeFlow-Setup-0.1.0.exe`。安装向导可选择空的本地目录，默认当前用户的 `LocalAppData\Programs\ForgeFlow`，不需要管理员权限。程序目录与项目数据目录分开；数据目录由应用首次启动/设置页管理，选择保存在 `%LOCALAPPDATA%\ForgeFlow\storage.json`。卸载不删除这份配置或数据目录。

升级目前需要先从托盘退出、卸载旧版，再安装新版。安装器拒绝覆盖非空目录和同时存在的本用户安装。没有静默原地升级、自动更新或代码签名。机器需已有 Microsoft Edge WebView2 Runtime。

卸载先检查程序/后台进程、文件占用和路径，再按内嵌 SHA256 清单删除未修改的应用文件。新增文件、被修改的文件、数据库和外部数据目录不属于删除范围；不使用递归删除。卸载器移动过位置、清单被改动或出现链接目录时拒绝卸载。受文件锁影响时退出并保留文件，可关闭占用后重试。

## 编译器

使用 NSIS 3.11 便携工具，不安装系统编译器。默认 `.artifacts/installer-tools/nsis-3.11/makensis.exe`，也可设置 `NSIS_MAKENSIS`。本次工具来源为 [Tauri 官方二进制镜像](https://github.com/tauri-apps/binary-releases/releases/tag/nsis-3.11)，该页说明原包来自 NSIS 官方 SourceForge。下载包 SHA256：

`C7D27F780DDB6CFFB4730138CD1591E841F4B7EDB155856901CDF5F214394FA1`

安装脚本依据 [NSIS 官方手册](https://nsis.sourceforge.io/Docs/Chapter4.html)。编译器不随产品交付。

## 隔离验收

```powershell
$env:FORGEFLOW_INSTALLER_TEST_KEY = 'ForgeFlow-Test-unique-name'
node scripts/installer-build.mjs
node scripts/installer-smoke.mjs
```

测试包注册键和开始菜单入口独立，默认安装路径被强制限定到 `.artifacts`；测试仍显式指定中文带空格目录。测试生成数据保留在 `.artifacts/installer-smoke-*`，不启动真实项目。测试覆盖自选目录、重复安装拒绝、锁定文件时不部分删除，以及用户文件和修改文件保留。界面选择与静默 `/D=` 使用相同目录校验函数，不能将静默测试写成鼠标操作验收。
