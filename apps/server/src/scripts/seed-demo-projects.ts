import { openDatabase } from '../db/client.js';
import { WorkspaceRepository } from '../modules/workspace/workspace.repository.js';
import { WorkspaceService } from '../modules/workspace/workspace.service.js';

const { sqlite, db } = openDatabase();
const service = new WorkspaceService(new WorkspaceRepository({ sqlite, db }));

function projectDocument(projectId: string, kind: string, title: string, content: string) {
  const specification = service.createSpecification(projectId, { kind, title, featureId: null, capabilityId: null });
  service.createRevision(projectId, specification.id, {
    content, changeSummary: `形成${title}`, expectedHeadRevisionId: null, source: 'demo-seed:projects',
  });
}

function foundation(projectId: string, profile: 'web' | 'game' | 'pipeline') {
  projectDocument(projectId, 'research', '调研与分析', profile === 'web' ? `# 调研对象

## 若依

| 属性 | 内容 |
| --- | --- |
| 类型 | 开源后台管理系统 |
| 来源 | 官方站点与公开仓库 |
| URL | https://gitee.com/y_project/RuoYi-Vue |
| 状态 | 已分析 |

### 功能观察

用户、角色、部门、菜单与数据权限形成关联能力。

### 值得借鉴

权限标识与菜单资源解耦，用户通过角色获得权限。

### 不适用

不复制其工程分层与全部表结构；当前项目按自身 Fastify/Vue 架构设计。

### 当前项目采用

采用用户—角色—部门的关系边界与可审计权限标识。` : `# 调研目标

验证当前技术链路与关键依赖的适用边界。

## 官方文档

| 来源 | URL | 观察 | 当前结论 |
| --- | --- | --- | --- |
| ${profile === 'game' ? 'Godot 4 Documentation' : 'FFmpeg Documentation'} | ${profile === 'game' ? 'https://docs.godotengine.org/' : 'https://ffmpeg.org/documentation.html'} | 生命周期与资源管理规则 | 采用公开 API，按当前项目约束设计 |

## 对当前项目的影响

只采用经过当前项目验证的机制，不复制参考项目架构。`);
  projectDocument(projectId, 'requirements', '需求分析', '# 目标\n\n形成可直接实施和验证的能力闭环。\n\n# 范围\n\n所有 Capability 必须有可观察输出和失败边界。');
  projectDocument(projectId, 'architecture', '架构设计', profile === 'game' ? '# Architecture Components\n\nInventory Service → Inventory UI → Save Service\n\n以 Scene、Node、Resource 与 Signal 组织运行结构。' : profile === 'pipeline' ? '# Architecture Components\n\nRTSP Source → Decode → Sample → Inference → Aggregation\n\n控制流与数据流分离；Packet、Frame 和 GPU Buffer 有明确所有权。' : '# Architecture Components\n\nVue Workbench → Fastify API → Domain Service → SQLite\n\n认证、事务与审计在服务端边界完成。');
  projectDocument(projectId, 'technology', 'Technology Decisions', profile === 'game' ? '# Technology Decisions\n\n| 类别 | 选择 | 用途 | 原因 | 替代方案 | 状态 |\n| --- | --- | --- | --- | --- | --- |\n| Game Engine | Godot 4.4 | 2D 运行时 | Scene/Resource 工作流适配 | Unity | ADOPTED |\n| Language | GDScript | 游戏逻辑 | 原型迭代快 | C# | ADOPTED |' : profile === 'pipeline' ? '# Technology Decisions\n\n| 类别 | 选择 | 用途 | 原因 | 替代方案 | 状态 |\n| --- | --- | --- | --- | --- | --- |\n| Language | C++20 | Pipeline 核心 | 显式生命周期与性能控制 | Rust | ADOPTED |\n| Video Decode | FFmpeg 7 | RTSP 解码 | Codec 覆盖广 | GStreamer | ADOPTED |\n| Inference | TensorRT | GPU 推理 | 低延迟 | ONNX Runtime | ADOPTED |' : '# Technology Decisions\n\n| 类别 | 选择 | 用途 | 原因 | 替代方案 | 状态 |\n| --- | --- | --- | --- | --- | --- |\n| Web Framework | Fastify | HTTP API | 轻量且 Schema 友好 | Spring Boot | ADOPTED |\n| Frontend | Vue 3 | 管理工作台 | 组合式 API | React | ADOPTED |\n| Database | SQLite | 本地数据 | 零运维 | PostgreSQL | ADOPTED |');
}

function capabilityDesign(capabilityId: string, content: string) {
  service.createCapabilityDesign(capabilityId, { content, changeSummary: '形成可实施的 Capability 设计', source: 'demo-seed:projects' });
}

function createWebProject() {
  const project = service.createProject({ projectKey: 'IAM_WORKBENCH', name: '权限管理系统', description: '以用户、角色、部门和菜单能力构成的后台管理系统。', projectType: 'Vue + Fastify Web', workflowMode: 'AUTO', designProfile: 'web' });
  foundation(project.id, 'web');
  const module = service.createModule(project.id, { code: 'IAM', name: '用户与权限', description: '身份、组织与权限能力', sortOrder: 10 });
  const feature = service.createFeature(project.id, { moduleId: module.id, code: 'USR', name: '用户管理', summary: '维护用户生命周期、组织归属和角色权限。', status: 'DRAFT', sortOrder: 10 });
  service.createFeatureDesign(feature.id, { source: 'demo-seed:projects', changeSummary: '形成用户管理共享设计', content: `# 用户管理共享设计

## 数据模型

| 对象 | 类型 | 作用 |
| --- | --- | --- |
| User | Entity | 用户身份与状态 |
| UserRole | Relation | 用户和角色的多对多关系 |
| Department | Entity | 用户组织归属 |
| Role | Entity | 权限集合 |

关系：User N:M Role；User N:1 Department。

## 数据表

| 表 | 用途 | 公共约束 |
| --- | --- | --- |
| sys_user | 用户主数据 | username 唯一 |
| sys_user_role | 用户角色关系 | user_id + role_id 唯一 |
| sys_department | 部门 | 必须有效且未停用 |
| sys_role | 角色 | 必须有效 |

## 接口规范

| 方法 | 路径 | Capability |
| --- | --- | --- |
| GET | /api/users | U-01 |
| POST | /api/users | U-02 |
| PUT | /api/users/{id} | U-03 |
| DELETE | /api/users/{id} | U-04 |

## UI 布局

UserManagement 页面左侧为部门筛选，右侧为用户表格；新增和编辑使用 Drawer。

## 权限设计

公共前缀 system:user:*，服务端必须再次校验，不能只依赖按钮可见性。

## 依赖关系

部门管理提供有效部门；角色管理提供可分配角色。` });

  const definitions = [
    ['U-01', '用户列表', '按部门、状态和关键字查询用户。'],
    ['U-02', '新增用户', '创建用户并建立部门与角色关系。'],
    ['U-03', '编辑用户', '修改用户资料、部门和角色。'],
    ['U-04', '删除用户', '在约束允许时删除用户。'],
    ['U-05', '启用 / 停用', '切换账号可登录状态。'],
    ['U-06', '重置密码', '生成一次性重置结果并强制改密。'],
    ['U-07', '分配角色', '调整用户角色集合。'],
    ['U-08', '调整部门', '改变用户组织归属。'],
  ] as const;
  const capabilities = definitions.map(([code, name, summary], index) => service.createCapability(project.id, feature.id, { code, name, summary, sortOrder: (index + 1) * 10 }));
  capabilityDesign(capabilities[0]!.id, `# U-01 用户列表

## 1. 目标

可分页检索用户并看到组织、角色和状态。

## 输入字段

| 字段 | 类型 | 必填 | 限制 |
| --- | --- | --- | --- |
| keyword | string | 否 | 匹配 username 或 nickname |
| departmentId | ID | 否 | 有效部门 |
| status | enum | 否 | ENABLED / DISABLED |

## 业务逻辑

1. 校验查询范围。 2. 应用部门数据权限。 3. 分页返回用户摘要。

## API / 协议

| 方法 | 路径 | Response |
| --- | --- | --- |
| GET | /api/users | Page<UserVO> |

## 测试

| 场景 | 预期 | 实际 |
| --- | --- | --- |
| 默认查询 | 返回第一页 | PASS |`);
  capabilityDesign(capabilities[1]!.id, `# U-02 新增用户

## 1. 目标

一次提交创建可用用户，并原子地建立部门与角色关系。

## 2. 场景

管理员在用户管理页面新增内部账号，保存成功后立即出现在列表。

## 输入字段

| 字段 | 类型 | 必填 | 限制 / 关联 |
| --- | --- | --- | --- |
| username | string | 是 | 唯一；2~32 字符 |
| nickname | string | 是 | 1~64 字符 |
| departmentId | ID | 是 | Department 必须存在且有效 |
| roleIds | ID[] | 否 | Role 必须全部有效；去重 |

## 输出

返回新用户 ID、username、nickname、部门摘要、角色摘要和 ENABLED 状态。

## 前置条件

操作者拥有 system:user:create；部门和角色资料已同步。

## 业务逻辑

1. 规范化 username 并校验格式。
2. 在事务内检查 username 唯一。
3. 校验 departmentId 存在且有效。
4. 批量校验 roleIds，任一非法则拒绝。
5. 创建 User，密码只保存强哈希。
6. 批量创建 UserRole 关系。
7. 任一步失败整体回滚，成功后写审计事件。

## 数据设计

| 对象 / 表 | 类型 | 读取 / 写入 | 本能力影响 |
| --- | --- | --- | --- |
| sys_user | Table | 写入 | 新增用户主记录 |
| sys_user_role | Relation | 写入 | 建立用户角色关系 |
| sys_department | Table | 读取 | 校验有效部门 |
| sys_role | Table | 读取 | 校验有效角色 |

## 领域 / 实体影响

| Artifact | Impact | Reason |
| --- | --- | --- |
| UserEntity | 新增 | 映射 sys_user |
| UserCreateDTO | 新增 | 接收并校验输入 |
| UserVO | 修改 | 返回部门与角色摘要 |

## API / 协议

| 方法 | 路径 | Request | Response / Error |
| --- | --- | --- | --- |
| POST | /api/users | username, nickname, departmentId, roleIds | 201 UserVO / USERNAME_TAKEN / DEPARTMENT_NOT_FOUND / ROLE_INVALID |

## UI / 交互

入口：用户管理 → 新增。点击后打开右侧 Drawer；本地校验后保存；成功关闭并刷新列表，失败保留输入并定位字段。

## 权限

system:user:create；按钮和服务端路由均检查，审计日志记录操作者与新用户 ID。

## 关联能力

| 能力 | 原因 |
| --- | --- |
| 部门管理 | departmentId 只能选择有效部门 |
| 角色管理 | 创建时可分配有效角色 |
| U-01 用户列表 | 创建成功后刷新并定位新用户 |

## 异常和边界

用户名并发重复由数据库唯一约束兜底；空 roleIds 允许；事务失败不得残留 User 或 UserRole。

## 实现指导

| Artifact Type | Artifact | Impact | Reason |
| --- | --- | --- | --- |
| Service | backend/user/UserService.ts | 修改 | 完成校验和事务编排 |
| Route | backend/user/user.routes.ts | 修改 | 暴露 POST /api/users |
| View | frontend/system/user/UserManagement.vue | 修改 | 新增 Drawer 与列表刷新 |
| Test | backend/user/UserService.test.ts | 新增 | 覆盖事务和错误码 |

## 测试

| 场景 | 预期 | 实际 |
| --- | --- | --- |
| 正常新增 | 用户与角色关系同时创建 | PASS |
| 用户名重复 | USERNAME_TAKEN 且无写入 | PASS |
| 非法部门 | DEPARTMENT_NOT_FOUND | PASS |
| 非法角色 | ROLE_INVALID | PASS |
| 事务失败 | 整体回滚 | PASS |

## 当前实现状态

设计：REV 1；实现：DONE；测试：PASS；Commit：abc123。`);
  capabilityDesign(capabilities[2]!.id, '# U-03 编辑用户\n\n## 行为流程\n\n读取版本号，校验差异，在事务内更新用户、部门与角色关系。\n\n## 实现影响\n\n| Artifact | Impact |\n| --- | --- |\n| UserService | 修改 |\n\n## 验证条件\n\n并发版本冲突必须返回 USER_VERSION_CONFLICT。');
  capabilityDesign(capabilities[3]!.id, '# U-04 删除用户\n\n## 规则\n\n当前登录用户、系统内置用户和仍有关联业务的用户不可删除。\n\n## 验证条件\n\n删除成功后用户和关系同时消失。');
  capabilityDesign(capabilities[4]!.id, '# U-05 启用 / 停用\n\n## 行为流程\n\n校验权限与目标用户后切换状态；停用立即使新登录失效。\n\n## 测试\n\n| 场景 | 预期 | 实际 |\n| --- | --- | --- |\n| 停用普通用户 | 无法登录 | RUNNING |');

  for (const [index, capability] of capabilities.slice(0, 2).entries()) {
    const task = service.createTask(project.id, feature.id, { capabilityId: capability.id, code: `T-U0${index + 1}`, name: `实现${capability.name}完整闭环`, type: 'OTHER', category: 'IMPLEMENTATION', area: 'user', status: 'PLANNED', objective: `按 ${capability.code} 设计完成代码、集成与测试。`, sortOrder: index * 10 });
    const run = service.startAuthorizedRunByTaskId(task.id, { baseCommit: 'base001', actorName: 'Codex' });
    service.submitRunById(run.id, { summary: `${capability.name}已完成实现并通过验证。`, resultCommit: index === 1 ? 'abc123' : 'abc120', changedFiles: index === 1 ? ['backend/user/UserService.ts', 'backend/user/user.routes.ts', 'frontend/system/user/UserManagement.vue', 'backend/user/UserService.test.ts'] : ['backend/user/UserQueryService.ts', 'frontend/system/user/UserManagement.vue'], verificationSummary: { reportedStatus: 'PASS', origin: 'AI_REPORTED', summary: index === 1 ? 'UserServiceTest 12/12 PASS，POST /api/users 集成测试 PASS' : '用户列表查询与权限过滤测试 PASS' }, issues: [] });
  }
  const editTask = service.createTask(project.id, feature.id, { capabilityId: capabilities[2]!.id, code: 'T-U03', name: '实现编辑用户完整闭环', type: 'OTHER', category: 'IMPLEMENTATION', area: 'user', status: 'PLANNED', objective: '完成编辑、冲突检测和测试。', sortOrder: 30 });
  service.startAuthorizedRunByTaskId(editTask.id, { baseCommit: 'abc123', actorName: 'Codex' });
  service.updateCapability(project.id, feature.id, capabilities[4]!.id, { status: 'TESTING' });
}

function createGodotProject() {
  const project = service.createProject({ projectKey: 'GODOT_INVENTORY', name: 'Godot 2D 背包', description: '面向 2D 游戏原型的物品、槽位、交互和存档系统。', projectType: 'Godot 4.4 2D Game', workflowMode: 'AUTO', designProfile: 'game' });
  foundation(project.id, 'game');
  const module = service.createModule(project.id, { code: 'GAMEPLAY', name: 'Gameplay', description: '核心玩法能力', sortOrder: 10 });
  const feature = service.createFeature(project.id, { moduleId: module.id, code: 'INV', name: '背包', summary: '运行时物品管理、交互反馈与存档恢复。', status: 'DRAFT', sortOrder: 10 });
  service.createFeatureDesign(feature.id, { source: 'demo-seed:projects', changeSummary: '形成背包共享设计', content: '# 背包共享设计\n\n## Item Resource\n\n| Resource | 作用 |\n| --- | --- |\n| ItemDefinition | 定义 id、名称、图标、堆叠上限与使用效果 |\n\n## Scene / Node\n\n| Node | 职责 |\n| --- | --- |\n| InventoryPanel | 显示槽位并处理选择 |\n| InventoryService | 管理运行时 Inventory 状态 |\n\n## Signal\n\n| Signal | 参数 | 用途 |\n| --- | --- | --- |\n| inventory_changed | slot_index | 刷新 UI |\n| item_used | item_id, amount | 触发玩法效果 |\n\n## Save Data\n\n保存 item_id、amount、slot_index；加载时跳过未知 ItemDefinition 并记录警告。' });
  const defs = [['I-01','打开背包'],['I-02','添加物品'],['I-03','物品堆叠'],['I-04','使用物品'],['I-05','丢弃物品'],['I-06','保存恢复']] as const;
  const caps = defs.map(([code, name], index) => service.createCapability(project.id, feature.id, { code, name, summary: `${name}的玩家可观察行为。`, sortOrder: index * 10 }));
  for (const capability of caps) capabilityDesign(capability.id, capability.code === 'I-04' ? `# I-04 使用物品

## 1. 目标

玩家从背包使用一个可用物品，玩法效果、库存数量、UI 与存档状态保持一致。

## 输入

slot_index、ItemDefinition、角色当前状态与输入动作 use_item。

## 角色状态

角色必须存活且不处于禁止使用物品的过场状态；治疗效果不得超过 max_health。

## 物品 Resource

ItemDefinition 提供 item_id、effect_type、effect_value、consumable、use_animation。

## Inventory 状态

成功时 amount 减一；归零则清空槽位；失败时 Inventory 不变化。

## Scene / Node

InventoryPanel 将请求交给 InventoryService；PlayerStats 应用效果；SaveService 只订阅成功信号。

## Signal

| Signal | 发出者 | 参数 | 订阅者 |
| --- | --- | --- | --- |
| item_use_requested | InventoryPanel | slot_index | InventoryService |
| item_used | InventoryService | item_id, amount | PlayerStats, SaveService |
| inventory_changed | InventoryService | slot_index | InventoryPanel |

## Animation

use_animation 存在时由 PlayerAnimation 播放；动画不得阻塞库存状态提交。

## Save Data

物品成功消耗后标记存档脏；批量保存时写入剩余槽位，不直接在 Signal 回调内同步落盘。

## 异常和边界

空槽位、数量为零、未知效果和角色状态不允许时返回失败原因，不发出 item_used。

## Playtest

| 场景 | 预期 | 实际 |
| --- | --- | --- |
| 使用治疗药水 | 生命增加且数量减一 | NOT_RUN |
| 满血使用 | 提示不可使用，数量不变 | NOT_RUN |
| 最后一个物品 | 槽位清空，UI 刷新 | NOT_RUN |

## 当前实现状态

设计：DESIGNED；实现：NOT_STARTED；Playtest：NOT_RUN。` : `# ${capability.code} ${capability.name}\n\n## 目标\n\n完成${capability.name}的可观察游戏行为。\n\n## Scene / Node\n\n由 InventoryService 维护状态，InventoryPanel 呈现反馈。\n\n## Signal\n\n状态变化后发出 inventory_changed。\n\n## Playtest\n\n| 场景 | 预期 | 实际 |\n| --- | --- | --- |\n| 玩家主路径 | 行为可观察且无阻断 | NOT_RUN |`);
}

function createPipelineProject() {
  const project = service.createProject({ projectKey: 'RTSP_INFERENCE', name: 'RTSP 实时推理 Pipeline', description: 'C++20 + FFmpeg + TensorRT 的低延迟视频推理链路。', projectType: 'C++20 RTSP Video AI Pipeline', workflowMode: 'AUTO', designProfile: 'pipeline' });
  foundation(project.id, 'pipeline');
  const module = service.createModule(project.id, { code: 'PIPE', name: '实时视频链路', description: '采集、解码、推理与恢复', sortOrder: 10 });
  const feature = service.createFeature(project.id, { moduleId: module.id, code: 'RTP', name: '实时推理 Pipeline', summary: '持续接入 RTSP、解码抽帧、推理聚合并从断流恢复。', status: 'DRAFT', sortOrder: 10 });
  service.createFeatureDesign(feature.id, { source: 'demo-seed:projects', changeSummary: '形成 Pipeline 共享设计', content: '# 实时推理 Pipeline 共享设计\n\n## Pipeline\n\nRTSP Source → Decode → Frame Sampling → Inference → Aggregation → Result Sink。\n\n## Thread Model\n\nSource/Decode 线程与 Inference Worker 通过有界队列隔离。\n\n## Resource Budget\n\n| Resource | Budget |\n| --- | --- |\n| Packet Queue | 64 packets |\n| Frame Queue | 8 frames |\n| GPU Surface | 12 surfaces |' });
  const defs = [['P-01','连接'],['P-02','解码'],['P-03','抽帧'],['P-04','推理'],['P-05','聚合'],['P-06','重连']] as const;
  const caps = defs.map(([code, name], index) => service.createCapability(project.id, feature.id, { code, name, summary: `${name}阶段的输入、资源、恢复与性能边界。`, sortOrder: index * 10 }));
  for (const capability of caps) capabilityDesign(capability.id, capability.code === 'P-02' ? `# P-02 Decode

## 1. 目标

把 RTSP Demux 输出的压缩 Packet 持续解码为带时间戳的 Frame，并在停止、断流和 Codec 错误时安全释放资源。

## 输入流

AVPacket、stream_index、PTS/DTS、time_base；支持 H.264 与 H.265，其他 Codec 返回 UNSUPPORTED_CODEC。

## Codec / FFmpeg

使用 avcodec_find_decoder、avcodec_alloc_context3、avcodec_parameters_to_context、avcodec_open2；循环调用 avcodec_send_packet / avcodec_receive_frame；EOF 时发送 null packet flush。

## Thread

DecodeWorker 独占 AVCodecContext。stop_token 由 PipelineController 发出；线程退出前停止接收新 Packet，排空或丢弃按 stop_mode 决定。

## Queue / Buffer

| Queue | Capacity | Ownership | Backpressure |
| --- | --- | --- | --- |
| packet_queue | 64 | AVPacketPtr move-only | 满时阻塞 50ms，超时丢最旧非关键帧 |
| frame_queue | 8 | AVFramePtr move-only | 实时模式丢旧帧，离线模式阻塞 |

## 资源生命周期

AVPacket 进入 send_packet 后由队列持有者释放；AVFrame 从 pool 获取，成功入队后转移所有权；AVCodecContext 只在 DecodeWorker join 后销毁。

## 超时与错误恢复

EAGAIN 继续 receive；INVALIDDATA 计数并跳过当前 Packet；连续 30 次错误触发 decoder rebuild；输入 EOF 进入 flush；重连由 P-06 负责。

## 性能与资源

1080p@25fps 单路平均解码延迟 < 12ms；Frame Queue 常态占用 ≤ 6；CPU 内存稳定，无 Packet/Frame 泄漏；GPU 解码模式限制 surface 上限。

## 实现影响

| Artifact Type | Artifact | Impact | Reason |
| --- | --- | --- | --- |
| Class | src/pipeline/DecodeWorker.cpp | 新增 | 封装解码循环与停止语义 |
| Header | include/pipeline/DecodeWorker.hpp | 新增 | 声明输入输出与资源所有权 |
| Test | tests/DecodeWorkerTest.cpp | 新增 | 覆盖 Codec、错误与释放 |
| Config | config/pipeline.yaml | 修改 | queue、backpressure、decoder 参数 |

## 测试

| 场景 | 指标 / 预期 | 实际 |
| --- | --- | --- |
| H.264 25fps | 连续输出有效 Frame | NOT_RUN |
| H.265 断续输入 | 无死锁，时间戳单调 | NOT_RUN |
| 损坏 Packet | 跳过并在阈值后重建 | NOT_RUN |
| 8 小时运行 | RSS 稳定，无泄漏 | NOT_RUN |

## 当前实现状态

设计：DESIGNED；实现：NOT_STARTED；性能验证：NOT_RUN。` : `# ${capability.code} ${capability.name}\n\n## 目标\n\n完成 ${capability.name} 阶段并保持 Pipeline 可恢复。\n\n## Thread\n\n定义线程归属与停止语义。\n\n## Queue / Buffer\n\n使用有界队列与显式所有权。\n\n## 测试\n\n| 场景 | 预期 | 实际 |\n| --- | --- | --- |\n| 正常路径 | 持续输出 | NOT_RUN |`);
}

try {
  const keys = new Set(service.listProjects().map((project) => project.projectKey));
  if (!keys.has('IAM_WORKBENCH')) createWebProject();
  if (!keys.has('GODOT_INVENTORY')) createGodotProject();
  if (!keys.has('RTSP_INFERENCE')) createPipelineProject();
console.log('ForgeFlow demo projects are ready.');
} finally {
  sqlite.close();
}
