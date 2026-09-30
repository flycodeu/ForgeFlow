# StreamFusion AI · 架构设计

## 先看两条不同成熟度的链

**当前管理链**已经有 Web → Platform API → MySQL/Redis 的实际代码路径。浏览器提供登录与管理操作，API 执行身份、权限、业务事务和审计；MySQL 保存业务记录，Redis 承担会话、验证码与登录防护。Node Agent 与 Runtime 各自能启动并响应健康接口，但尚未加入视频任务的运行链。健康接口只证明进程与依赖探测，不证明视频业务通过。

**目标视频链**是视频源 → Runtime 拉流/解码/推理/聚合 → Agent 协调和上传 → Platform 保存事件元数据与媒体引用 → Web 查询。任务的期望与实际状态、模型/场景版本、证据上传和失败恢复都需要形成可追踪协议。当前没有相机、任务、事件 API 或真实流推理，因此下图把这些交互明确标为规划。

## 项目全景图数据

图谱由本次源码人工核对形成。节点的“已实现”只表示该节点标注的现有职责已经有代码；边的状态才表示两个节点之间的业务调用是否已接通。Agent 与 Runtime 的“基础服务已实现”不得解读为视频链已实现。打开工作区“项目全景图”可按层查看节点、交互方向、技术和源码入口。

```forgeflow-map
{
  "version": 1,
  "nodes": [
    {
      "id": "sf-web",
      "label": "Platform Web 管理界面",
      "layer": "交互界面",
      "summary": "已提供登录、账号与权限管理、审计、服务信息和接口文档页面；视频预览与视频任务页面尚未实现。",
      "status": "implemented",
      "technology": [
        "Vue 3",
        "TypeScript",
        "Element Plus"
      ],
      "source": "platform-web/src"
    },
    {
      "id": "sf-api",
      "label": "Platform API 管理服务",
      "layer": "业务服务",
      "summary": "模块化单体承载认证、授权、管理操作和审计；相机、视频任务和事件 API 尚未实现，不处理逐帧视频。",
      "status": "implemented",
      "technology": [
        "Java 21",
        "Spring Boot",
        "Spring Security",
        "MyBatis-Plus"
      ],
      "source": "platform-api/src/main/java/com/streamfusion/platform"
    },
    {
      "id": "sf-mysql",
      "label": "MySQL 业务数据",
      "layer": "数据依赖",
      "summary": "保存当前管理业务中的用户、角色、菜单、组织关系、操作审计和登录记录；视频业务表尚未建立。",
      "status": "implemented",
      "technology": [
        "MySQL",
        "MyBatis-Plus"
      ],
      "source": "platform-api/sql/业务"
    },
    {
      "id": "sf-redis",
      "label": "Redis 会话与登录防护",
      "layer": "数据依赖",
      "summary": "用于 Spring Session、一次性登录挑战、验证码和登录来源计数；不承担视频帧传输。",
      "status": "implemented",
      "technology": [
        "Redis",
        "Spring Session",
        "Lua"
      ],
      "source": "platform-api/pom.xml"
    },
    {
      "id": "sf-agent",
      "label": "Node Agent 基础服务",
      "layer": "算法节点",
      "summary": "目前只有独立配置、日志、接口文档和 /health 健康入口；节点注册、任务同步、Worker 监督及结果上传仍属规划。",
      "status": "implemented",
      "technology": [
        "Python 3.12",
        "FastAPI"
      ],
      "source": "algorithm-node/node-agent/app/main.py"
    },
    {
      "id": "sf-runtime",
      "label": "Algorithm Runtime 基础服务",
      "layer": "算法节点",
      "summary": "目前只有独立配置、日志、接口文档和 /health 健康入口；没有拉流、解码、模型推理、事件生成或证据处理。",
      "status": "implemented",
      "technology": [
        "Python 3.12",
        "FastAPI"
      ],
      "source": "algorithm-node/runtime/app/main.py"
    },
    {
      "id": "sf-camera",
      "label": "视频源接入",
      "layer": "外部来源",
      "summary": "目标是接入真实相机或视频流；当前没有相机管理 API、已运行的视频任务或真实流验证。",
      "status": "planned",
      "technology": [
        "媒体协议待实流验证"
      ],
      "source": "README.md"
    },
    {
      "id": "sf-event",
      "label": "事件与证据业务",
      "layer": "目标能力",
      "summary": "计划把节点结果转为可查询事件和媒体证据。现有 Runtime Event Schema 只是设计基线，未形成运行中的业务链。",
      "status": "planned",
      "technology": [
        "Runtime Event Schema",
        "存储方案待验证"
      ],
      "source": "contracts/README.md"
    }
  ],
  "edges": [
    {
      "from": "sf-web",
      "to": "sf-api",
      "label": "登录、管理操作与查询",
      "status": "implemented"
    },
    {
      "from": "sf-api",
      "to": "sf-mysql",
      "label": "业务事务与持久化",
      "status": "implemented"
    },
    {
      "from": "sf-api",
      "to": "sf-redis",
      "label": "会话、验证码与登录防护",
      "status": "implemented"
    },
    {
      "from": "sf-camera",
      "to": "sf-runtime",
      "label": "拉流、解码与推理（规划）",
      "status": "planned"
    },
    {
      "from": "sf-agent",
      "to": "sf-runtime",
      "label": "Worker 监督与任务协调（规划）",
      "status": "planned"
    },
    {
      "from": "sf-runtime",
      "to": "sf-agent",
      "label": "运行结果与证据交接（规划）",
      "status": "planned"
    },
    {
      "from": "sf-agent",
      "to": "sf-api",
      "label": "任务同步与状态回报（规划）",
      "status": "planned"
    },
    {
      "from": "sf-agent",
      "to": "sf-event",
      "label": "结果形成事件与证据（规划）",
      "status": "planned"
    }
  ]
}
```

## 模块职责

| 模块 | 负责 | 不负责 / 当前缺口 |
| --- | --- | --- |
| Platform Web | 管理界面、表单与状态展示，调用 API | 不授予后端权限，不执行逐帧推理；视频页尚未实现 |
| Platform API | 身份、授权、管理数据和审计；未来持有配置、任务期望状态和事件元数据 | 不搬运逐帧视频；相机/任务/事件业务 API 尚未实现 |
| Node Agent | 目标职责是节点注册、心跳、任务同步、Worker 监督和结果上传 | 目前只有配置、日志、文档与健康骨架 |
| Algorithm Runtime | 目标职责是媒体接入、采样、模型运行、场景规则与事件形成 | 目前没有拉流、推理或 GPU 执行链 |
| MySQL / Redis | 分别保存关系业务数据与会话/短时安全状态 | 不能把视频帧、媒体文件或跨库原子事务寄托于它们 |

## 首个视频闭环需要约定的对象

- `CameraChannel` 指向点位，`StreamProfile` 指向具体码流；预览和推理可用不同码流，但须确认时间对齐。
- `ModelVersion` 固定文件校验与输入输出约定；`ScenarioRelease` 固定模型、规则、区域和阈值。任务引用发布版，运行中不因“最新”变化而悄悄换模型。
- `Task` 是期望配置，`Assignment` 记录节点及版本/epoch，`TaskRun` 表示一次执行。Agent 需要拒绝过期分配并幂等处理重复同步。
- `Observation` 是帧或窗口结果；`Event` 是聚合后的业务事实。事件与原图/片段分开登记，证据上传失败必须呈现为独立状态。

这些是设计对象，不是现行数据库表清单。实际字段、权限和异常处理须在首场景与真实流确定后写入功能设计；`contracts/` 中的 Schema 当前是设计基线。

## 端到端验证顺序

先确定点位/样本/模型并完成单路拉流与时间戳核对；再验证聚合事件、证据引用与重复/断流恢复；随后接入任务分配、Web 查询与权限；最后在指定硬件和网络上验证多路容量、长时间运行和外部交付。每一步记录环境、版本、输入、失败样本与结果，不用合成健康检查替代。

依据：`D:/FlyLabs/StreamFusion AI/README.md`、`contracts/README.md`、`platform-api/`、`platform-web/`、`algorithm-node/` 现行源码，以及冻结的 `docs/video_ai_implementation_v2/Video_AI_Platform_Implementation_Guide_v2.0.md`。运维 OPS 设计稿尚未成为运行组件，不进入现状图。
