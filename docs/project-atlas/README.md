# 两个项目的资料基线（2026-09-30）

本目录保存 StreamFusion AI 与薪迹的五类项目级资料正文，以及 `project-profiles.json` 中的项目卡片简介。桌面版的实际项目资料保存在用户数据目录的 SQLite 中；本次通过现有 Specification Revision API 以当前头版本校验追加修订，原修订保留。这里的文件便于复核和后续维护，不是应用启动时自动导入的数据。

| 文件 | 职责 |
| --- | --- |
| `*-background.md` | 创建动因、目标角色、方案形成、完整闭环和边界 |
| `*-requirements.md` | 目标结果、异常路径、当前与待验证范围 |
| `*-research.md` | 问题、来源证据、候选方案与未决事项 |
| `*-architecture.md` | 当前与目标数据流，并内嵌版本化 `forgeflow-map` 图谱 |
| `*-technology.md` | 选型理由、取舍、学习入口和验证边界 |

全景图的功能结构从 ForgeFlow 项目的模块、功能、操作记录读取；交互拓扑只解析架构修订中的 `forgeflow-map` JSON。节点和连线的“已实现”是文档标注，不能替代真实集成测试或负责人验收。不要从名称自动推断连接。

StreamFusion 资料依据 `D:/FlyLabs/StreamFusion AI` 当前源码、README 和原始实施指南整理；当前管理链与规划视频链分开。薪迹资料由 `D:/FlyLabs/salary/scripts/forgeflow-sync.mjs --export-project-docs <新目录>` 生成，源脚本与本目录同名文件应保持一致。薪迹 Windows/Android/WebDAV 的代码状态与真机、真实云端验收分开记载。
