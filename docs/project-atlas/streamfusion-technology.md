# StreamFusion AI · 技术选型与学习路径

## 当前代码真正使用的技术

| 位置 | 当前技术 | 为什么在这里 | 学习时要看清的边界 |
| --- | --- | --- | --- |
| 管理界面 | Vue 3、TypeScript、Vite、Element Plus | 提供登录、人员/角色/菜单/部门、审计与服务信息等管理操作 | 路由可见性和后端授权是两道不同检查；界面不处理视频帧 |
| 管理服务 | Java 21、Spring Boot、Spring Security、MyBatis-Plus | 处理身份、业务事务、权限和可追查的管理 API | Platform 是模块化单体，不负责逐帧解码或推理 |
| 业务数据 | MySQL | 保存管理对象、关系、审计和登录记录 | 初始化 SQL 不等于已有库升级；未来视频业务表尚未落地 |
| 会话与登录防护 | Redis、Spring Session、Lua | 保存会话、验证码及登录来源计数等短时/原子状态 | Redis 不承担逐帧视频队列；会话与 MySQL 事务不能假设跨库原子 |
| 节点入口 | Python 3.12、FastAPI、独立环境 | 为 Node Agent 和 Runtime 保留不同职责与部署进程 | 目前主要是配置、日志和健康入口，尚无任务协调或媒体推理 |

依赖和代码入口：`platform-api/pom.xml`、`platform-api/src/main/java/com/streamfusion/platform/`、`platform-web/package.json`、`platform-web/src/`、`algorithm-node/node-agent/pyproject.toml`、`algorithm-node/runtime/pyproject.toml`。本表中的“当前”只表示源码可核对；每项业务验收仍看独立证据。

## 视频链路的候选技术与选择门槛

| 目标 | 候选 | 先做的实验 |
| --- | --- | --- |
| 接入、预览与录像 | 直接拉流；必要时比较 MediaMTX、FFmpeg/GStreamer 分工 | 真实编码、时间戳、断流重连、预览和推理双消费者 |
| 模型执行 | 先用可信模型建立输出基线，再比较 ONNX Runtime CUDA、TensorRT；高密度场景才评估 DeepStream | 同一视频/模型的输出差异、延迟、吞吐、显存与恢复 |
| 证据保存 | S3 兼容对象存储等候选 | 原图、标注图、片段的权限、保留期、回读及失败补偿 |
| 对外结果 | 站内查询先行，后续按接收方选 REST、SSE 或 Webhook | 稳定事件 ID、重复投递、幂等和交付状态 |

候选来自项目原始实施指南及本次调研，**不是已引入依赖**。例如 MediaMTX 只处理媒体分发，TensorRT 只解决特定模型在特定 NVIDIA 环境的执行，二者都不会自动生成业务事件。

## 从一条请求和一条视频流学习

1. **当前可追的管理链**：在 `platform-web/src/` 找页面和 HTTP 客户端，跟到 `platform-api` 的 Controller、鉴权、Service、Mapper，再看 MySQL 事务与 Redis 会话。检查错误如何返回、请求如何审计、权限如何撤销。
2. **尚未贯通的控制链**：对照 `contracts/README.md` 的 TaskSpec / Agent Sync Schema，区分任务期望状态、分配版本、运行实例和 Agent 实际状态；找不到实现时标记“规划”，不要把 Schema 测试写成链路通过。
3. **尚未贯通的数据链**：用真实样本画出视频源 → Runtime 解码/采样/模型 → 观测/事件 → Agent 上传 → 平台查询。逐步测时间戳、重复、断流、证据缺失和恢复，再决定媒体组件与 GPU 优化。

学习成果应是可说明“输入是什么、谁负责、写入哪里、失败如何表现、如何验证”的调用图与实验记录。详细数据对象与接口契约落在功能设计/工程资产，不把项目级技术文档变成类名目录。
