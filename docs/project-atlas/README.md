# 两个项目的资料基线（2026-09-30）

本目录保存 StreamFusion AI 与薪迹的五类项目级资料正文，以及 `project-profiles.json` 中的项目卡片简介。桌面版的实际项目资料保存在用户数据目录的 SQLite 中；本次通过现有 Specification Revision API 以当前头版本校验追加修订，原修订保留。这里的文件便于复核和后续维护，不是应用启动时自动导入的数据。

| 文件 | 职责 |
| --- | --- |
| `*-background.md` | 创建动因、目标角色、方案形成、完整闭环和边界 |
| `*-requirements.md` | 目标结果、异常路径、当前与待验证范围 |
| `*-research.md` | 问题、来源证据、候选方案与未决事项 |
| `*-architecture.md` | 当前与目标数据流，并内嵌版本化 `forgeflow-map` 图谱 |
| `*-technology.md` | 选型理由、取舍、学习入口和验证边界 |

项目模块图通过架构修订中的 `forgeflow-map` JSON 声明模块、职责、业务流程、横切能力和环境，通过 `featureCodes` 关联实际登记的功能；交互连线仍只读取明确声明的 `edges`。未关联的旧规划保留在可折叠的登记功能目录中。格式见 [map-format.md](map-format.md)。节点和连线的“已实现”是文档标注，不能替代真实集成测试或负责人验收。不要从名称自动推断连接。

StreamFusion 资料依据 `D:/FlyLabs/StreamFusion AI` 当前源码、README 和原始实施指南整理；当前管理链与规划视频链分开。薪迹资料由 `D:/FlyLabs/salary/scripts/forgeflow-sync.mjs --export-project-docs <新目录>` 生成，源脚本与本目录同名文件应保持一致。薪迹 Windows/Android/WebDAV 的代码状态与真机、真实云端验收分开记载。

2026-10-01：两项目新增具体功能层、业务流程、横切能力和环境。StreamFusion 展开管理业务，视频与运维仍单列规划；薪迹沿用当前双端本地实现，早期登记的 OCR、端到端加密等条目未自动升级为已实现。源码核对不等于真机或云端验收。
