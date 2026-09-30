# 薪迹 0.5.2 当前双端方案：技术选择与学习路径

## 当前选择与原因

| 位置 | 当前技术 | 为什么在此使用 | 要掌握的边界 |

| --- | --- | --- | --- |

| 共享界面和规则 | Vue 3、TypeScript、Capacitor | 一套工资语义与交互在 Windows WebView2 和 Android 壳内复用 | Web 预览与原生私有存储不是同一环境；UI 不直接读原生路径 |

| Windows 采集与宿主 | .NET Framework、WinForms、系统 WebView2、可访问性接口 | 从用户已打开的飞书页读取文本，并承载本机文件与截图操作 | 飞书登录上下文不能由独立网页自动继承；采集按需运行 |

| 工资领域 | TypeScript 纯函数、整数分、版本化账本 | 把来源金额、核算和展示分开，让异常与差额可回溯 | null 表示未知；负值、汇总去重和多来源不能靠 UI 修正 |

| 本机数据 | Windows 本机文件与原子保存、Android 私有文件 | 安装目录和档案目录分离，写入失败可恢复 | 浏览器本地存储只是预览；卸载 Android 会删除私有数据 |

| 跨端同步 | JSON、WebDAV、SHA-256、DPAPI / Android Keystore | 不自建业务服务器，合并工资并同步关联原图 | 云端内容无端到端加密；摘要校验、部分失败和删除标记必须实际验证 |

| 更新交付 | GitHub Release、Windows 安装助手、Android 系统安装器 | 在设置中发现版本、下载并交给平台升级 | 代码构建、发布、下载校验和真实覆盖升级是不同证据 |

## 学习顺序

先从一条真实来源跟踪 `windows/SalaryCollector/Program.cs` → `src/domain/capture.ts` → `src/domain/salaryRules.ts` / `src/domain/reconcile.ts` → `src/domain/ledger.ts`。再分别追 `windows/SalaryDesktop/LocalStore.cs` 与 Android 原生 `LedgerStore.java` 的持久化和重启行为；`src/platform/ledgerStore.ts` 的 IndexedDB 分支仅用于浏览器预览，原生分支通过 `hostCall` 读写私有账本。最后沿 `src/platform/sync.ts`、`src/platform/evidenceSync.ts` 观察工资和原图如何合并、验证、删除和重试。界面从 `src/App.vue` 与档案/看板/原图组件进入，原生能力分别在 `windows/SalaryDesktop/` 和 `android/app/src/main/java/com/flylabs/salary/`。

## 选型的代价与下一步验证

复用 Web UI 减少重复业务规则，但必须维护两套原生桥接与升级路径；WebDAV 避免自建服务器，却要自己处理并发、哈希、目录约束及恢复；结构化采集减少 OCR 主链路的不确定性，但真实飞书页面和不同月份仍需采集覆盖测试。不要把 Android 直接采集、完整离线备份或云端端到端加密写成已交付能力。技术使用事实以当前源码和 README.md 为准，验收以独立记录为准。
