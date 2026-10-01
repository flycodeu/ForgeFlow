# 项目全景图数据格式

项目级 `architecture` 文档可包含**一个** `forgeflow-map` 代码块。数据格式保持 `version: 1`；原有只含 `nodes`、`edges` 的图谱继续可用。图谱描述项目文档声明的模块与方向，不会从名称推断调用关系。

````text
```forgeflow-map
{
  "version": 1,
  "nodes": [
    {
      "id": "web", "label": "管理界面", "layer": "界面层",
      "summary": "展示任务与证据", "status": "implemented",
      "details": ["提交配置并读取任务状态"],
      "featureCodes": ["TASK-01"], "placement": "main"
    },
    {
      "id": "api", "label": "业务接口", "layer": "服务层",
      "summary": "校验并处理请求", "status": "implemented"
    }
  ],
  "edges": [{ "from": "web", "to": "api", "label": "请求/响应", "status": "implemented" }],
  "flows": [{
    "id": "submit-task", "label": "提交任务", "status": "implemented",
    "steps": [
      { "label": "填写配置", "nodeId": "web" },
      { "label": "校验并保存", "nodeId": "api", "description": "记录校验结果" }
    ]
  }]
}
```
````

## 字段与边界

| 字段 | 规则 |
| --- | --- |
| `nodes` | 1–80 个；`id` 唯一，必填 `label`、`layer`、`summary`、`status`。原有 `technology`、`source` 仍可用。 |
| `nodes[].placement` | 可选：`main`（默认）、`crosscut`（横切关注点）、`environment`（运行环境）。只有 `main` 节点参与主流程的层级排序。 |
| `nodes[].details` | 可选，最多 12 条，每条 1–100 字。直接显示在模块卡片中，宜写简短职责或技术要点。 |
| `nodes[].featureCodes` | 可选，最多 40 个，每项 1–80 字。填写项目已登记的功能编码，界面按编码关联并可打开功能设计；解析器只检查格式，不据此推断调用关系或实现状态。 |
| `edges` | 最多 200 条；`from`、`to` 必须指向已声明节点。`status` 为 `implemented` 或 `planned`。 |
| `flows` | 可选，最多 12 条；`id` 唯一，`label` 最多 80 字，`status` 为 `implemented` 或 `planned`。 |
| `flows[].steps` | 每条流程 2–12 步；每步 `label` 最多 80 字，可选 `description` 最多 200 字，可选 `nodeId` 必须指向已声明节点。 |

图谱拒绝未定义字段、非法枚举、重复 ID 和悬空引用。`implemented` 仅表示架构文档中的状态标注，不能替代源码检查、集成测试或验收记录。业务流程按显式步骤显示；步骤不自动生成 `edges`，模块连线仍须在 `edges` 中单独声明。
