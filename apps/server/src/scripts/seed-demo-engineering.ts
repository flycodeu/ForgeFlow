import type { EngineeringAsset } from '@forgeflow/contracts';
import { openDatabase } from '../db/client.js';
import { WorkspaceRepository } from '../modules/workspace/workspace.repository.js';
import { WorkspaceService } from '../modules/workspace/workspace.service.js';

const { sqlite, db } = openDatabase();
const service = new WorkspaceService(new WorkspaceRepository({ sqlite, db }));

function projectByKey(key: string) {
  const project = service.listProjects().find((item) => item.projectKey === key);
  if (!project) throw new Error(`Missing seeded project ${key}`);
  return project;
}

function asset(projectId: string, featureId: string, input: Parameters<WorkspaceService['createEngineeringAsset']>[2]): EngineeringAsset {
  const existing = service.getFeatureEngineeringBlueprint(projectId, featureId).assets.find((item) => item.kind === input.kind && item.name === input.name);
  return existing ?? service.createEngineeringAsset(projectId, featureId, input);
}

function document(projectId: string, kind: string, title: string, content: string) {
  const specification = service.createSpecification(projectId, { kind, title, featureId: null, capabilityId: null });
  return service.createRevision(projectId, specification.id, { content, changeSummary: `形成${title}`, expectedHeadRevisionId: null, source: 'demo-seed:engineering' });
}

function capabilityDesign(capabilityId: string, code: string, name: string, detail: string) {
  service.createCapabilityDesign(capabilityId, { source: 'demo-seed:engineering', changeSummary: `形成 ${code} 可实施设计`, content: `# ${code} ${name}\n\n## 目标\n\n${detail}\n\n## 输入\n\n输入必须在边界处完成格式、存在性与权限校验。\n\n## 行为流程\n\n按工程蓝图中关联对象与契约执行；任一阶段失败时保留可诊断上下文并按约定恢复。\n\n## 异常和边界\n\n超时、取消、资源不可用和重复请求都有确定结果，不允许静默失败。\n\n## 验证条件\n\n正常路径、非法输入、依赖失败和恢复路径均有可复现验证。` });
}

function augmentWebExample() {
  const project = projectByKey('IAM_WORKBENCH');
  const detail = service.getProject(project.id);
  const feature = detail.features.find((item) => item.code === 'USR')!;
  const caps = detail.capabilities.filter((item) => item.featureId === feature.id);
  const related = caps.map((item) => `${item.code} ${item.name}`);
  asset(project.id, feature.id, { kind: 'DATA_MODEL', name: '用户与角色数据模型', code: 'DM-USR', summary: '用户主表、用户角色关系与组织引用。', structuredData: {
    type: 'database-table', purpose: '用户身份、组织归属与角色关系', relatedCapabilities: related,
    fields: [
      { 对象: 'sys_user.id', 类型: 'bigint', 必填: true, 约束: 'PK', 说明: '用户主键' },
      { 对象: 'sys_user.username', 类型: 'varchar(32)', 必填: true, 约束: 'UK', 说明: '登录名' },
      { 对象: 'sys_user.nickname', 类型: 'varchar(64)', 必填: true, 约束: '', 说明: '显示名称' },
      { 对象: 'sys_user.department_id', 类型: 'bigint', 必填: true, 约束: 'FK', 说明: '所属部门' },
      { 对象: 'sys_user.status', 类型: 'varchar(16)', 必填: true, 约束: 'CHECK', 说明: 'ENABLED / DISABLED' },
      { 对象: 'sys_user.version', 类型: 'bigint', 必填: true, 约束: '乐观锁', 说明: '并发更新版本' },
      { 对象: 'sys_user_role.user_id', 类型: 'bigint', 必填: true, 约束: 'UK联合', 说明: '用户引用' },
      { 对象: 'sys_user_role.role_id', 类型: 'bigint', 必填: true, 约束: 'UK联合', 说明: '角色引用' },
    ], indexes: [{ 名称: 'uk_sys_user_username', 字段: 'username', 类型: 'UNIQUE' }, { 名称: 'idx_user_department', 字段: 'department_id', 类型: 'INDEX' }],
    relations: [{ 来源: 'sys_user.department_id', 目标: 'sys_department.id', 基数: 'N:1' }, { 来源: 'sys_user_role.role_id', 目标: 'sys_role.id', 基数: 'N:1' }],
  }, contentMarkdown: '# 设计原因\n\n用户身份与授权关系分离，用户名唯一约束是并发创建的最终防线。' });
  asset(project.id, feature.id, { kind: 'CODE_MODEL', name: '用户领域与传输模型', code: 'CM-USR', summary: 'Spring Boot 项目的 Entity、DTO、VO 与服务边界。', structuredData: {
    type: 'spring-code-model', framework: 'Spring Boot 3', relatedCapabilities: related,
    fields: [{ 模型: 'UserEntity', 字段: 'id, username, nickname, departmentId, status, version' }, { 模型: 'UserCreateDTO', 字段: 'username, nickname, departmentId, roleIds' }, { 模型: 'UserVO', 字段: 'id, username, nickname, department, roles, status' }],
    methods: [{ 类: 'UserService', 方法: 'createUser(UserCreateDTO)', 返回: 'UserVO', 事务: true }, { 类: 'UserService', 方法: 'updateUser(id, command)', 返回: 'UserVO', 事务: true }, { 类: 'UserService', 方法: 'assignRoles(id, roleIds)', 返回: 'void', 事务: true }],
  }, contentMarkdown: '# 技术适配\n\nEntity / DTO / VO 是本 Spring Boot 项目的实际选择，不是 ForgeFlow 的固定模板。' });
  asset(project.id, feature.id, { kind: 'INTERFACE', name: '用户 REST 契约', code: 'API-USR', summary: '用户查询、创建、编辑与状态操作的 HTTP 契约。', structuredData: {
    type: 'rest', version: 'v1', relatedCapabilities: related,
    contracts: [{ 方法: 'GET', 路径: '/api/users', 能力项: 'U-01 用户列表', 权限: 'system:user:list', 响应: 'Page<UserVO>' }, { 方法: 'POST', 路径: '/api/users', 能力项: 'U-02 新增用户', 权限: 'system:user:create', 响应: '201 UserVO' }, { 方法: 'PUT', 路径: '/api/users/{id}', 能力项: 'U-03 编辑用户', 权限: 'system:user:update', 响应: '200 UserVO' }],
    errors: [{ 代码: 'USERNAME_TAKEN', HTTP: 409, 字段: 'username' }, { 代码: 'DEPARTMENT_NOT_FOUND', HTTP: 422, 字段: 'departmentId' }, { 代码: 'ROLE_INVALID', HTTP: 422, 字段: 'roleIds' }],
  }, contentMarkdown: '# 兼容性\n\n新增响应字段保持向后兼容；错误码是 UI 定位字段错误的稳定契约。' });
  asset(project.id, feature.id, { kind: 'UI_DESIGN', name: '用户管理与新增 Drawer', code: 'UI-USR', summary: '筛选、列表与新增用户闭环交互。', structuredData: {
    type: 'web-page', route: '/system/users', relatedCapabilities: related,
    components: [{ 区域: '筛选区', 内容: '关键字、部门、状态' }, { 区域: '数据表格', 内容: '用户、部门、角色、状态、操作' }, { 区域: '新增 Drawer', 内容: 'username, nickname, departmentId, roleIds' }],
    flow: [{ 步骤: 1, 动作: '点击新增', 结果: '打开 Drawer 并加载部门/角色' }, { 步骤: 2, 动作: '提交', 结果: '前端校验后 POST /users' }, { 步骤: 3, 动作: '成功', 结果: '关闭、刷新、定位新记录' }],
    states: [{ 状态: 'Loading', 表现: '保存按钮 loading，禁止重复提交' }, { 状态: 'Empty', 表现: '解释无数据并保留新增入口' }, { 状态: 'Error', 表现: '字段错误就地展示，系统错误全局提示' }, { 状态: 'Permission Hidden', 表现: '无权限时隐藏新增按钮' }],
  } });
  asset(project.id, feature.id, { kind: 'INTEGRATION', name: '用户界面到领域服务', code: 'INT-USR', summary: 'Vue 管理端、REST API 与用户领域服务的边界。', structuredData: { type: 'integration-contract', relatedCapabilities: related, connections: [{ 生产者: 'UserManagement.vue', 消费者: 'UserController', 协议: 'HTTPS/JSON', 输入: 'UserCreateRequest', 输出: 'UserVO', 超时: '8s', 重试: '0', 失败: '保留 Drawer 输入并映射错误码', 版本: 'v1', 验证: '契约测试' }, { 生产者: 'UserService', 消费者: 'UserRepository', 协议: 'Function/Transaction', 输入: 'User aggregate', 输出: 'persisted user', 超时: '2s', 重试: '0', 失败: '事务回滚', 版本: 'current', 验证: '集成测试' }] } });
  asset(project.id, feature.id, { kind: 'TEST_DESIGN', name: '用户管理验证矩阵', code: 'TEST-USR', summary: '按能力项覆盖规则、权限、事务和界面反馈。', structuredData: { type: 'test-matrix', relatedCapabilities: related, tests: [{ 编号: 'USER-CREATE-001', 能力项: 'U-02', 场景: '正常新增', 层级: 'API + UI', 预期: '用户和角色关系同时创建', 结果: 'PASS' }, { 编号: 'USER-CREATE-002', 能力项: 'U-02', 场景: '用户名重复', 层级: 'Service', 预期: '回滚并返回 USERNAME_TAKEN', 结果: 'PASS' }] } });
}

function augmentGodotExample() {
  const project = projectByKey('GODOT_INVENTORY');
  const detail = service.getProject(project.id);
  const feature = detail.features.find((item) => item.code === 'INV')!;
  const related = detail.capabilities.filter((item) => item.featureId === feature.id).map((item) => `${item.code} ${item.name}`);
  asset(project.id, feature.id, { kind: 'CODE_MODEL', name: '背包 Resource 与 Node', code: 'GD-INV-MODEL', summary: 'Godot Resource、运行时槽位和控制 Node。', structuredData: { type: 'godot-model', runtime: 'Godot 4.4', relatedCapabilities: related, components: [{ 对象: 'ItemDefinition', 类型: 'Resource', 字段: 'id, display_name, icon, max_stack, use_effect', 职责: '静态物品定义' }, { 对象: 'InventorySlot', 类型: 'RefCounted', 字段: 'item, amount', 职责: '运行时槽位状态' }, { 对象: 'InventoryController', 类型: 'Node', 字段: 'slots, selected_slot', 职责: '变更库存并发送 Signal' }], methods: [{ 对象: 'InventoryController', 方法: 'use_item(slot_index)', 返回: 'UseResult' }, { 对象: 'InventoryController', 方法: 'save_state()', 返回: 'Dictionary' }] }, contentMarkdown: '# 边界\n\nResource 保存静态定义，运行时数量不写回 Resource。没有数据库、Controller 或 REST API。' });
  asset(project.id, feature.id, { kind: 'UI_DESIGN', name: '背包 Panel 交互', code: 'GD-INV-UI', summary: '打开、选择、使用和丢弃的玩家交互。', structuredData: { type: 'godot-ui', relatedCapabilities: related, components: [{ Scene: 'InventoryPanel.tscn', Node: 'Control', 职责: '背包容器' }, { Scene: 'InventorySlot.tscn', Node: 'Button', 职责: '显示图标、数量与焦点' }], flow: [{ 输入: 'inventory_action', 行为: '切换 InventoryPanel.visible', 反馈: '暂停世界输入并聚焦首个槽位' }, { 输入: 'use_item', 行为: '调用 use_item(slot)', 反馈: '播放动画并刷新数量' }], states: [{ 状态: 'Empty Slot', 表现: '禁用使用与丢弃' }, { 状态: 'Use Rejected', 表现: '提示原因，数量不变' }] } });
  asset(project.id, feature.id, { kind: 'SIGNAL', name: '背包 Signal 契约', code: 'GD-INV-SIGNAL', summary: 'Node 间以 Signal 传递状态变化和使用结果。', structuredData: { type: 'godot-signal', relatedCapabilities: related, signals: [{ Signal: 'inventory_changed(slot_index)', Producer: 'InventoryController', Consumer: 'InventoryPanel', 语义: '指定槽位状态已提交' }, { Signal: 'item_used(item_id, amount)', Producer: 'InventoryController', Consumer: 'PlayerStats', 语义: '应用玩法效果' }] } });
  asset(project.id, feature.id, { kind: 'INTEGRATION', name: '背包运行时集成', code: 'GD-INV-INT', summary: 'UI、库存状态、角色属性与存档服务的连接。', structuredData: { type: 'integration-contract', relatedCapabilities: related, connections: [{ 生产者: 'InventoryPanel', 消费者: 'InventoryController', 协议: 'method call', 输入: 'slot_index', 输出: 'UseResult', 失败: '显示不可使用原因', 验证: 'Playtest' }, { 生产者: 'InventoryController', 消费者: 'SaveService', 协议: 'Dictionary snapshot', 输入: 'slots[]', 输出: 'save acknowledged', 失败: '保留 dirty 状态稍后重试', 验证: '保存恢复 Playtest' }] } });
  asset(project.id, feature.id, { kind: 'CONFIG', name: '背包与存档配置', summary: '槽位数量、输入映射与存档版本。', structuredData: { type: 'godot-config', relatedCapabilities: related, settings: [{ 配置: 'inventory.slot_count', 默认值: 24, 说明: '背包槽位数量' }, { 配置: 'input.inventory_action', 默认值: 'Tab', 说明: '打开背包' }, { 配置: 'save.schema_version', 默认值: 2, 说明: '存档兼容版本' }] } });
  asset(project.id, feature.id, { kind: 'TEST_DESIGN', name: '背包 Playtest', summary: '面向玩家可观察行为的验证设计。', structuredData: { type: 'playtest', relatedCapabilities: related, tests: [{ 编号: 'INV-PLAY-01', 场景: '使用治疗药水', 预期: '角色生命增加、数量减一、UI 刷新', 结果: 'NOT_RUN' }, { 编号: 'INV-PLAY-02', 场景: '保存并重新加载', 预期: '槽位、数量与顺序恢复', 结果: 'NOT_RUN' }] } });
}

function augmentRtspExample() {
  const project = projectByKey('RTSP_INFERENCE');
  const detail = service.getProject(project.id);
  const feature = detail.features.find((item) => item.code === 'RTP')!;
  const related = detail.capabilities.filter((item) => item.featureId === feature.id).map((item) => `${item.code} ${item.name}`);
  asset(project.id, feature.id, { kind: 'CODE_MODEL', name: 'RTSP Pipeline 核心类', code: 'CPP-PIPE', summary: 'C++20 Source、Decode Worker 与有界队列。', structuredData: { type: 'cpp-class', language: 'C++20', relatedCapabilities: related, components: [{ 对象: 'RtspSource', 类型: 'class', 成员: 'url_, format_ctx_, state_', 职责: '连接、探测、重连' }, { 对象: 'DecodeWorker', 类型: 'class', 成员: 'codec_ctx_, packet_queue_, frame_queue_', 职责: '独占解码器与线程退出' }, { 对象: 'BoundedQueue<T>', 类型: 'template class', 成员: 'capacity_, mutex_, condition_', 职责: '背压与取消' }], methods: [{ 类: 'RtspSource', 方法: 'open()/read()/reconnect()/close()' }, { 类: 'DecodeWorker', 方法: 'run(stop_token)/flush()/rebuild()' }] } });
  asset(project.id, feature.id, { kind: 'PIPELINE', name: 'RTSP 实时推理 Pipeline', code: 'PIPE-RTSP', summary: '从输入到结果的 Stage、线程、Buffer、恢复和性能边界。', structuredData: { type: 'video-pipeline', latencyTarget: '< 100ms', throughput: '25 FPS / stream', relatedCapabilities: related, stages: [{ Stage: 'RTSP Input', 输入: 'URL', 输出: 'AVPacket', 线程: 'SourceWorker', Buffer: 'packet queue 64', 背压: '50ms 后丢旧非关键帧', 错误恢复: '指数退避重连' }, { Stage: 'Decode', 输入: 'AVPacket', 输出: 'AVFrame', 线程: 'DecodeWorker', Buffer: 'frame pool 12', 背压: '实时模式丢旧帧', 错误恢复: '连续30错误重建 decoder' }, { Stage: 'Sampling', 输入: 'AVFrame', 输出: 'SampledFrame', 线程: 'PipelineWorker', Buffer: 'queue 8', 背压: '按 fps policy 跳帧', 错误恢复: '时间戳重置' }, { Stage: 'Inference', 输入: 'GPU Frame', 输出: 'DetectionResult', 线程: 'GPU Worker', Buffer: 'batch 1~4', 背压: '超预算丢过期帧', 错误恢复: 'OOM 降级并告警' }, { Stage: 'Aggregation', 输入: 'DetectionResult', 输出: 'ResultEvent', 线程: 'Aggregator', Buffer: 'window 2s', 背压: '合并重复事件', 错误恢复: '本地暂存' }] } });
  asset(project.id, feature.id, { kind: 'INTEGRATION', name: 'Source 到推理引擎', summary: 'Pipeline 内各 Stage 的所有权转移。', structuredData: { type: 'integration-contract', relatedCapabilities: related, connections: [{ 生产者: 'RtspSource', 消费者: 'DecodeWorker', 协议: 'move-only AVPacketPtr', 输入: 'AVPacket', 输出: 'accepted', 超时: '50ms', 重试: '0', 失败: '丢最旧非关键帧', 版本: 'FFmpeg 7 ABI', 验证: '8h soak' }, { 生产者: 'FrameSampler', 消费者: 'TensorRtDetector', 协议: 'CudaFrameView', 输入: 'NV12 frame + timestamp', 输出: 'detections[] + latency', 超时: '100ms', 重试: '0', 失败: '丢帧并记录指标', 版本: 'contract v1', 验证: 'latency benchmark' }] } });
  asset(project.id, feature.id, { kind: 'CONFIG', name: 'Pipeline 运行配置', summary: 'Codec、队列、抽帧、重连与资源上限。', structuredData: { type: 'yaml-config', relatedCapabilities: related, settings: [{ 配置: 'decode.codec', 默认值: 'auto', 范围: 'h264/h265/auto' }, { 配置: 'queue.frames', 默认值: 8, 范围: '2..32' }, { 配置: 'sampling.fps', 默认值: 5, 范围: '1..25' }, { 配置: 'reconnect.max_backoff', 默认值: '30s', 范围: '1s..120s' }] } });
  asset(project.id, feature.id, { kind: 'TEST_DESIGN', name: 'Pipeline 验证矩阵', summary: 'Codec、断流、资源和长期运行验证。', structuredData: { type: 'test-matrix', relatedCapabilities: related, tests: [{ 编号: 'PIPE-001', 场景: 'H.264 25fps', 指标: '持续输出且 P95 < 100ms', 结果: 'NOT_RUN' }, { 编号: 'PIPE-002', 场景: '断流 30s 后恢复', 指标: '自动重连且无死锁', 结果: 'NOT_RUN' }, { 编号: 'PIPE-003', 场景: '8 小时运行', 指标: 'RSS/VRAM 稳定', 结果: 'NOT_RUN' }] } });
}

function createVideoPlatform() {
  if (service.listProjects().some((item) => item.projectKey === 'VIDEO_INTELLIGENCE')) return;
  const project = service.createProject({ projectKey: 'VIDEO_INTELLIGENCE', name: '视频智能分析平台', description: '统一管理端、Backend、视频 Pipeline 与 AI 算法的实时分析平台。', projectType: 'Vue + Spring Boot + C++ Video + Python AI', workflowMode: 'AUTO', designProfile: 'web,backend-service,video-pipeline,ai' });
  document(project.id, 'research', '发现与调研', '# 调研证据\n\n| 对象 | 来源 | URL | 观察 | 当前决定 |\n| --- | --- | --- | --- | --- |\n| FFmpeg | 官方文档 | https://ffmpeg.org/documentation.html | 支持 RTSP Demux 与 H264/H265 解码 | 采用 FFmpeg 7，生命周期由 Pipeline 封装 |\n| TensorRT | 官方文档 | https://docs.nvidia.com/deeplearning/tensorrt/ | 支持低延迟 GPU 推理 | 模型引擎预加载，OOM 时明确失败 |\n\n外部事实与当前项目决定分开记录，不复制参考架构。');
  const requirementRevision = document(project.id, 'requirements', '需求定义', '# 实时推理任务\n\n用户可创建实时推理任务，系统连接 RTSP、解码抽帧、调用算法、聚合并保存结果；断流后自动恢复。\n\n验收要求：完整追踪创建、运行、测试和结果。');
  document(project.id, 'architecture', '架构与边界', '# Architecture Components\n\nWeb 管理端 → Backend Task API → Pipeline Orchestrator → RTSP / Decode / Sampling → Algorithm Runtime → Result Aggregator → Backend Storage。\n\n控制面与帧数据面分离。');
  document(project.id, 'technology', '技术决策', '# Technology Decisions\n\n| 类别 | 选择 | 用途 | 原因 | 状态 |\n| --- | --- | --- | --- | --- |\n| Web | Vue 3 | 任务创建与状态 | 已有管理端 | ADOPTED |\n| Backend | Spring Boot 3 | 任务领域与 API | 事务和可观测性 | ADOPTED |\n| Video Decode | FFmpeg 7 | RTSP / Codec | Codec 覆盖 | ADOPTED |\n| Inference | Python + TensorRT | 检测推理 | 低延迟 GPU | ADOPTED |');
  const module = service.createModule(project.id, { code: 'REALTIME', name: '实时推理', description: '控制面、视频数据面与算法对接', sortOrder: 10 });
  const feature = service.createFeature(project.id, { moduleId: module.id, code: 'INF-TASK', name: '实时推理任务', summary: '从任务创建到 RTSP、解码、算法推理、聚合、重连和结果存储的完整闭环。', status: 'IMPLEMENTING', sortOrder: 10 });
  service.createFeatureDesign(feature.id, { source: 'demo-seed:engineering', changeSummary: '形成跨 Web、Backend、Pipeline、算法的共享边界', content: '# 实时推理任务共享设计\n\n控制面管理任务状态和配置，数据面持续处理帧。所有跨进程连接均由 Integration Contract 约束。' });
  const definitions = [['RT-01', '创建任务', '创建包含视频源、算法和抽帧策略的实时任务。'], ['RT-02', '拉取 RTSP', '连接、探测并持续读取压缩数据包。'], ['RT-03', '解码抽帧', '解码 H264/H265 并按策略输出帧。'], ['RT-04', '算法推理', '预处理、TensorRT 推理与后处理。'], ['RT-05', '结果聚合', '按时间窗去重、聚合并生成事件。'], ['RT-06', '断流重连', '按退避策略恢复连接与时间线。'], ['RT-07', '结果存储', '把可追踪结果写回 Backend。']] as const;
  const caps = definitions.map(([code, name, summary], index) => service.createCapability(project.id, feature.id, { code, name, summary, sortOrder: (index + 1) * 10 }));
  definitions.forEach(([code, name, summary], index) => capabilityDesign(caps[index]!.id, code, name, summary));
  const related = caps.map((item) => `${item.code} ${item.name}`);
  const dataAsset = asset(project.id, feature.id, { kind: 'DATA_MODEL', name: '推理任务与结果数据', code: 'DM-INF', summary: '任务配置、运行状态与检测结果的持久化模型。', structuredData: { type: 'database-table', purpose: '控制面持久化', relatedCapabilities: ['RT-01 创建任务', 'RT-05 结果聚合', 'RT-07 结果存储'], fields: [{ 表: 'inference_task', 字段: 'id', 类型: 'bigint', 必填: true, 约束: 'PK', 说明: '任务主键' }, { 表: 'inference_task', 字段: 'camera_id', 类型: 'bigint', 必填: true, 约束: 'FK', 说明: '摄像机' }, { 表: 'inference_task', 字段: 'algorithm_id', 类型: 'bigint', 必填: true, 约束: 'FK', 说明: '算法版本' }, { 表: 'inference_task', 字段: 'rtsp_url_cipher', 类型: 'text', 必填: true, 约束: '加密', 说明: '视频源密文' }, { 表: 'inference_task', 字段: 'sample_fps', 类型: 'decimal(5,2)', 必填: true, 约束: '0 < fps <= 25', 说明: '抽帧率' }, { 表: 'inference_task', 字段: 'status', 类型: 'varchar(16)', 必填: true, 约束: '状态机', 说明: '任务运行状态' }, { 表: 'detection_result', 字段: 'task_id, frame_ts, objects_json', 类型: 'mixed', 必填: true, 约束: 'idx(task_id, frame_ts)', 说明: '检测结果' }], indexes: [{ 名称: 'uk_task_camera_algorithm', 字段: 'camera_id, algorithm_id', 类型: 'UNIQUE active' }, { 名称: 'idx_result_task_time', 字段: 'task_id, frame_ts', 类型: 'INDEX' }], relations: [{ 来源: 'inference_task.camera_id', 目标: 'camera.id', 基数: 'N:1' }, { 来源: 'detection_result.task_id', 目标: 'inference_task.id', 基数: 'N:1' }] }, contentMarkdown: '# 数据边界\n\nRTSP 密钥只保存密文；帧不进入业务数据库，只有聚合结果持久化。' });
  const codeAsset = asset(project.id, feature.id, { kind: 'CODE_MODEL', name: '实时任务领域与 Pipeline 类', code: 'CM-INF', summary: '控制面聚合根、C++ Pipeline 与 Python 推理器的实际代码模型。', structuredData: { type: 'mixed-code-model', relatedCapabilities: related, components: [{ 对象: 'InferenceTask', 技术: 'Java aggregate', 字段: 'id, cameraId, algorithmId, sampleFps, status, version', 职责: '任务状态与规则' }, { 对象: 'InferenceTaskCommand', 技术: 'Java record', 字段: 'cameraId, algorithmId, sampleFps', 职责: '创建输入' }, { 对象: 'RtspPipeline', 技术: 'C++ class', 字段: 'source_, decoder_, sampler_, queue_', 职责: '帧数据面' }, { 对象: 'Detector', 技术: 'Python class', 字段: 'engine, bindings, stream', 职责: '预处理、推理、后处理' }], methods: [{ 对象: 'InferenceTaskService', 方法: 'create(command)', 返回: 'InferenceTaskView', 事务: true }, { 对象: 'RtspPipeline', 方法: 'start()/stop()/reconnect()', 返回: 'PipelineResult', 事务: false }, { 对象: 'Detector', 方法: 'infer(FrameBatch)', 返回: 'DetectionBatch', 事务: false }] }, contentMarkdown: '# 语言边界\n\n各技术栈只展示实际存在的模型；Java 的 Entity/DTO 术语不会强加给 C++ 或 Python。' });
  const apiAsset = asset(project.id, feature.id, { kind: 'INTERFACE', name: '实时推理任务 API', code: 'API-INF', summary: '管理端创建任务并读取运行状态的 REST 契约。', structuredData: { type: 'rest', version: 'v1', relatedCapabilities: ['RT-01 创建任务', 'RT-07 结果存储'], contracts: [{ 方法: 'POST', 路径: '/api/inference-tasks', 能力项: 'RT-01 创建任务', 请求: 'cameraId, algorithmId, sampleFps, resultPolicy', 响应: '201 InferenceTaskView', 权限: 'analysis:task:create' }, { 方法: 'GET', 路径: '/api/inference-tasks/{id}', 能力项: 'RT-01 创建任务', 请求: 'path id', 响应: '200 InferenceTaskView', 权限: 'analysis:task:read' }], errors: [{ 代码: 'CAMERA_NOT_FOUND', HTTP: 422, 说明: '摄像机不存在或无权限' }, { 代码: 'ALGORITHM_UNAVAILABLE', HTTP: 409, 说明: '算法版本不可运行' }, { 代码: 'TASK_CONFLICT', HTTP: 409, 说明: '同摄像机同算法已有运行任务' }] }, contentMarkdown: '# 幂等与安全\n\n客户端请求 ID 用于避免重复创建；RTSP 凭据绝不返回给前端。' });
  const uiAsset = asset(project.id, feature.id, { kind: 'UI_DESIGN', name: '实时推理任务创建页', code: 'UI-INF-CREATE', summary: '从选择设备和算法到创建成功的管理端交互。', structuredData: { type: 'web-page', route: '/analysis/realtime/tasks/new', relatedCapabilities: ['RT-01 创建任务'], components: [{ 区域: '任务信息', 内容: '任务名称、摄像机、算法版本' }, { 区域: '运行策略', 内容: '抽帧率、阈值、结果策略' }, { 区域: '链路预检', 内容: '视频可达、算法就绪、GPU 容量' }], flow: [{ 步骤: 1, 用户动作: '点击新建实时任务', 系统行为: '加载可用摄像机与算法' }, { 步骤: 2, 用户动作: '填写并预检', 系统行为: '检查 RTSP 与算法容量' }, { 步骤: 3, 用户动作: '确认创建', 系统行为: 'POST /api/inference-tasks' }, { 步骤: 4, 用户动作: '创建成功', 系统行为: '进入任务详情并订阅状态' }], states: [{ 状态: 'Loading', 表现: '表单骨架与禁用提交' }, { 状态: 'Empty', 表现: '无可用摄像机时提供设备入口' }, { 状态: 'Error', 表现: '字段错误就地展示，链路失败保留表单' }, { 状态: 'Permission Hidden', 表现: '无创建权限时隐藏入口' }, { 状态: 'Success', 表现: '显示任务编号并跳转详情' }] } });
  const pipelineAsset = asset(project.id, feature.id, { kind: 'PIPELINE', name: '实时视频推理 Pipeline', code: 'PIPE-INF', summary: 'RTSP 输入、解码、抽帧、队列、推理、聚合与输出。', structuredData: { type: 'video-ai-pipeline', latencyTarget: 'P95 < 100ms', throughput: '单路 25fps 输入 / 5fps 推理', relatedCapabilities: ['RT-02 拉取 RTSP', 'RT-03 解码抽帧', 'RT-04 算法推理', 'RT-05 结果聚合', 'RT-06 断流重连'], stages: [{ Stage: 'RTSP Input', 输入: 'RTSP URL', 输出: 'AVPacket', 线程模型: '1 SourceWorker / stream', Buffer: 'packet queue 64', Backpressure: '50ms 后丢旧非关键帧', 错误恢复: '1s~30s 指数退避' }, { Stage: 'Decode', 输入: 'H264/H265 AVPacket', 输出: 'NV12 AVFrame', 线程模型: '1 DecodeWorker / stream', Buffer: 'frame pool 12', Backpressure: '实时模式丢旧帧', 错误恢复: '连续30错误重建' }, { Stage: 'Frame Sampling', 输入: 'AVFrame + PTS', 输出: 'SampledFrame', 线程模型: 'Pipeline worker', Buffer: 'queue 8', Backpressure: '按 sample_fps 跳帧', 错误恢复: '时间线不连续则重置' }, { Stage: 'Inference', 输入: 'CudaFrameView', 输出: 'DetectionBatch', 线程模型: 'shared GPU worker', Buffer: 'batch 1~4', Backpressure: '过期帧丢弃', 错误恢复: 'OOM 降级并告警' }, { Stage: 'Aggregation', 输入: 'DetectionBatch', 输出: 'ResultEvent', 线程模型: 'Aggregator', Buffer: '2s window', Backpressure: '按目标去重', 错误恢复: '本地 spool' }, { Stage: 'Result Output', 输入: 'ResultEvent', 输出: 'Backend message', 线程模型: 'Async publisher', Buffer: 'outbox 1000', Backpressure: '批量发送', 错误恢复: '重试并保留顺序' }] }, contentMarkdown: '# 资源生命周期\n\nPacket 与 Frame 使用 move-only 包装；Decoder join 后才能销毁 CodecContext；GPU surface 归还池后才允许复用。' });
  const algorithmAsset = asset(project.id, feature.id, { kind: 'ALGORITHM', name: '目标检测推理', code: 'ALG-DETECT', summary: '帧输入、预处理、TensorRT 推理、后处理、指标与资源预算。', structuredData: { type: 'object-detection', model: 'YOLO helmet detector / TensorRT engine', latencyTarget: '< 60ms inference', relatedCapabilities: ['RT-04 算法推理'], inputs: [{ 名称: 'frame', 类型: 'BGR/NV12 frame', Shape: '1280×720', 说明: '带 timestamp 与 cameraId' }, { 名称: 'threshold', 类型: 'float', Shape: 'scalar', 说明: '默认 0.5' }], preprocess: [{ 步骤: 'resize', 参数: '640×640 letterbox' }, { 步骤: 'normalize', 参数: '0..1, NCHW FP16' }], postprocess: [{ 步骤: 'decode', 参数: 'boxes + class scores' }, { 步骤: 'NMS', 参数: 'IoU 0.45' }], outputs: [{ 名称: 'detections[]', 类型: 'Detection', 内容: 'bbox, classId, confidence' }, { 名称: 'latency', 类型: 'Metrics', 内容: 'pre/infer/post ms' }], metrics: [{ 指标: 'Precision', 目标: '≥ 0.90' }, { 指标: 'Recall', 目标: '≥ 0.85' }, { 指标: 'P95 latency', 目标: '< 100ms end-to-end' }], resources: [{ 资源: 'GPU', 预算: '1 CUDA stream / worker' }, { 资源: 'VRAM', 预算: '< 1.5GB / model' }, { 资源: 'Engine Artifact', 预算: 'helmet_v3.engine + sha256' }], failures: [{ 错误: 'MODEL_UNAVAILABLE', 处理: '拒绝新任务并告警' }, { 错误: 'GPU_OOM', 处理: '释放 batch、降级或停止任务' }] }, contentMarkdown: '# Artifact\n\n模型文件必须记录版本、校验和、TensorRT/CUDA 兼容矩阵与评估数据集。' });
  const integrationAsset = asset(project.id, feature.id, { kind: 'INTEGRATION', name: 'Web、Backend、Pipeline 与算法集成', code: 'INT-INF', summary: '控制面与数据面跨模块契约。', structuredData: { type: 'integration-contract', relatedCapabilities: related, connections: [{ 生产者: '实时任务创建页', 消费者: 'Backend Task API', 协议: 'HTTPS/JSON', 输入: 'InferenceTaskCreateRequest', 输出: 'InferenceTaskView', 超时: '8s', 重试: '0', 错误: '保留表单并映射业务错误', 版本: 'v1', 兼容性: '新增字段可选', 验证: '前后端契约测试' }, { 生产者: 'Backend Orchestrator', 消费者: 'C++ Pipeline', 协议: 'gRPC', 输入: 'StartPipelineCommand', 输出: 'PipelineStatus stream', 超时: '3s', 重试: '1', 错误: '任务 BLOCKED + 告警', 版本: 'proto v2', 兼容性: '保留 v1 字段号', 验证: '集成测试' }, { 生产者: 'C++ Pipeline', 消费者: 'Python Algorithm', 协议: 'CUDA IPC + gRPC metadata', 输入: 'CudaFrameView', 输出: 'DetectionBatch', 超时: '100ms', 重试: '0', 错误: '丢帧并累加指标', 版本: 'contract v1', 兼容性: 'shape/version 握手', 验证: '延迟基准' }, { 生产者: 'Result Aggregator', 消费者: 'Backend Result API', 协议: 'MQ Topic', 输入: 'ResultEvent', 输出: 'ack', 超时: '2s', 重试: '3 + outbox', 错误: '持久化 outbox', 版本: 'event v1', 兼容性: 'schemaVersion', 验证: '端到端测试' }] }, contentMarkdown: '# 失败策略\n\n帧数据不做跨进程重试；控制命令和结果事件按幂等键处理。' });
  asset(project.id, feature.id, { kind: 'CONFIG', name: '实时推理运行配置', code: 'CFG-INF', summary: '抽帧、队列、重连、模型与告警参数。', structuredData: { type: 'config-schema', relatedCapabilities: related, settings: [{ 配置: 'pipeline.sample_fps', 类型: 'number', 默认值: 5, 范围: '1..25', 生效: '任务启动' }, { 配置: 'pipeline.frame_queue', 类型: 'integer', 默认值: 8, 范围: '2..32', 生效: '进程启动' }, { 配置: 'inference.model_path', 类型: 'path', 默认值: '/models/helmet_v3.engine', 范围: '已签名 artifact', 生效: '模型加载' }, { 配置: 'reconnect.max_backoff', 类型: 'duration', 默认值: '30s', 范围: '1s..120s', 生效: '动态' }] } });
  asset(project.id, feature.id, { kind: 'DEPLOYMENT', name: '混合运行部署', code: 'DEP-INF', summary: 'Web、Backend、原生 Pipeline 与 GPU Algorithm 的运行单元。', structuredData: { type: 'deployment', relatedCapabilities: related, components: [{ 单元: 'Web', 运行时: 'Vue static assets', 依赖: 'Backend API' }, { 单元: 'Backend', 运行时: 'Spring Boot JVM', 依赖: 'PostgreSQL, MQ' }, { 单元: 'Pipeline', 运行时: 'C++20 native process', 依赖: 'FFmpeg 7, CUDA runtime' }, { 单元: 'Algorithm', 运行时: 'Python worker', 依赖: 'TensorRT, model artifact, GPU' }] } });
  const testAsset = asset(project.id, feature.id, { kind: 'TEST_DESIGN', name: '实时推理验证矩阵', code: 'TEST-INF', summary: '从创建任务到断流恢复和结果保存的联合验证。', structuredData: { type: 'test-matrix', relatedCapabilities: related, tests: [{ 编号: 'INF-E2E-001', 能力项: 'RT-01~RT-07', 场景: '创建并运行 H264 任务', 预期: '100ms 内持续产生检测结果', 结果: 'PASS' }, { 编号: 'INF-PIPE-002', 能力项: 'RT-03', 场景: '损坏 Packet', 预期: '跳过并在阈值后重建 decoder', 结果: 'RUNNING' }, { 编号: 'INF-REC-003', 能力项: 'RT-06', 场景: '断流 30 秒恢复', 预期: '自动重连且时间线重置', 结果: 'NOT_RUN' }, { 编号: 'INF-SOAK-004', 能力项: 'RT-02~RT-05', 场景: '8 小时持续运行', 预期: 'RSS/VRAM 稳定，无死锁', 结果: 'NOT_RUN' }] } });

  const ensureSource = (alias: string, displayName: string, localRoot: string) => service.listProjectSources(project.id).find((item) => item.alias === alias)
    ?? service.upsertProjectSource({ projectId: project.id, sourceId: null, alias, displayName, purpose: `${displayName}演示绑定`, sourceKind: 'GIT',
      environmentKey: 'flycode-pc', localRoot, remoteUrl: null, repoSubdir: null, scope: null, expectedUpdatedAt: null, idempotencyKey: `demo-seed-video-source-${alias}` });
  const webSource = ensureSource('web', 'Web 管理端', 'D:\\Projects\\video-web');
  const backendSource = ensureSource('backend', '业务后端', 'E:\\Services\\video-api');
  const sourceBaselines = [
    { sourceId: webSource.id, baseline: { kind: 'GIT', commit: 'web-base-71a2', dirty: false, manifestHash: null }, result: { commit: null, workingTreeSummary: null }, read: true, modified: false, changedFiles: [], verification: [] },
    { sourceId: backendSource.id, baseline: { kind: 'GIT', commit: 'api-base-8c4a', dirty: false, manifestHash: null }, result: { commit: null, workingTreeSummary: null }, read: true, modified: false, changedFiles: [], verification: [] },
  ];

  const createTask = service.createTask(project.id, feature.id, { capabilityId: caps[0]!.id, code: 'T-INF-01', name: '实现实时任务创建闭环', type: 'OTHER', category: 'IMPLEMENTATION', area: 'web+backend', status: 'PLANNED', objective: '按 API、UI、数据模型和集成契约完成创建、校验、持久化与端到端测试。', sortOrder: 10 });
  const createRun = service.startAuthorizedRunByTaskId(createTask.id, { baseCommit: null, actorName: 'Codex', sourceExecutions: sourceBaselines });
  service.updateRunPhaseById(createRun.id, 'TESTING');
  const completedRun = service.submitRunById(createRun.id, { summary: '实时推理任务创建闭环已实现并由 AI 报告 API、UI 与契约测试通过。', resultCommit: null,
    changedFiles: [{ sourceId: backendSource.id, relativePath: 'src/inference/InferenceTaskService.java' }, { sourceId: backendSource.id, relativePath: 'src/inference/InferenceTaskController.java' }, { sourceId: webSource.id, relativePath: 'src/views/RealtimeTaskCreate.vue' }],
    sourceExecutions: [
      { ...sourceBaselines[0]!, modified: true, result: { commit: 'web-result-b71e', workingTreeSummary: '1 file changed' }, changedFiles: [{ sourceId: webSource.id, relativePath: 'src/views/RealtimeTaskCreate.vue' }], verification: [{ command: 'pnpm test', workdir: '.', reportedStatus: 'PASS', summary: '创建页 E2E 4/4' }] },
      { ...sourceBaselines[1]!, modified: true, result: { commit: 'api-result-b71e', workingTreeSummary: '3 files changed' }, changedFiles: [{ sourceId: backendSource.id, relativePath: 'src/inference/InferenceTaskService.java' }, { sourceId: backendSource.id, relativePath: 'src/inference/InferenceTaskController.java' }], verification: [{ command: './gradlew test', workdir: '.', reportedStatus: 'PASS', summary: 'InferenceTaskApiTest 8/8' }] },
    ], verificationSummary: { reportedStatus: 'PASS', origin: 'AI_REPORTED', summary: 'InferenceTaskApiTest 8/8；创建页 E2E 4/4' }, issues: [] });
  service.createEngineeringAssetRevision(project.id, apiAsset.id, { expectedCurrentRevisionId: apiAsset.currentRevisionId,
    changeSummary: '补充请求幂等键与响应状态', source: 'demo-seed:engineering', structuredData: { ...(apiAsset.structuredData ?? {}), idempotency: 'X-Request-Id', responseStatus: 201 },
    contentMarkdown: '# 幂等与安全\n\n客户端请求 ID 用于避免重复创建；RTSP 凭据绝不返回给前端。' });
  const decodeTask = service.createTask(project.id, feature.id, { capabilityId: caps[2]!.id, code: 'T-INF-03', name: '实现解码抽帧与资源回收', type: 'OTHER', category: 'IMPLEMENTATION', area: 'video-pipeline', status: 'PLANNED', objective: '实现 DecodeWorker、FrameSampler、有界队列和 Codec 错误恢复。', sortOrder: 30 });
  const decodeRun = service.startAuthorizedRunByTaskId(decodeTask.id, { baseCommit: 'b71e9fa', actorName: 'Codex' });
  service.updateRunPhaseById(decodeRun.id, 'IMPLEMENTING');

  service.createTraceLink(project.id, { sourceType: 'REQUIREMENT_REVISION', sourceId: requirementRevision.id, targetType: 'FEATURE', targetId: feature.id, relation: 'DERIVED_FROM' });
  for (const cap of caps) service.createTraceLink(project.id, { sourceType: 'CAPABILITY', sourceId: cap.id, targetType: 'FEATURE', targetId: feature.id, relation: 'DERIVED_FROM' });
  for (const engineeringAsset of [dataAsset, codeAsset, apiAsset, uiAsset, pipelineAsset, algorithmAsset, integrationAsset, testAsset]) {
    service.createTraceLink(project.id, { sourceType: 'ENGINEERING_ASSET', sourceId: engineeringAsset.id, targetType: 'FEATURE', targetId: feature.id, relation: 'DERIVED_FROM' });
  }
  service.createTraceLink(project.id, { sourceType: 'TASK', sourceId: createTask.id, targetType: 'CAPABILITY', targetId: caps[0]!.id, relation: 'IMPLEMENTS' });
  service.createTraceLink(project.id, { sourceType: 'RUN', sourceId: completedRun.id, targetType: 'TASK', targetId: createTask.id, relation: 'IMPLEMENTS' });
  service.createTraceLink(project.id, { sourceType: 'CAPABILITY', sourceId: caps[0]!.id, targetType: 'TEST_DESIGN', targetId: testAsset.id, relation: 'VERIFIED_BY' });
  service.createTraceLink(project.id, { sourceType: 'TASK', sourceId: decodeTask.id, targetType: 'PIPELINE', targetId: pipelineAsset.id, relation: 'IMPLEMENTS' });
  service.createTraceLink(project.id, { sourceType: 'RUN', sourceId: decodeRun.id, targetType: 'TASK', targetId: decodeTask.id, relation: 'IMPLEMENTS' });
}

function createPythonAiExample() {
  if (service.listProjects().some((item) => item.projectKey === 'PYTHON_VISION')) return;
  const project = service.createProject({ projectKey: 'PYTHON_VISION', name: 'Python 视觉算法', description: '纯 Python 安全帽检测算法与评估流水线。', projectType: 'Python AI/CV', workflowMode: 'AUTO', designProfile: 'ai' });
  document(project.id, 'requirements', '算法需求', '# 目标\n\n输入图像批次，输出安全帽检测框并生成 Precision、Recall 与延迟评估。');
  document(project.id, 'architecture', '算法架构', '# 组件\n\nDataset Loader → Preprocess → Model Runtime → Postprocess → Evaluator。没有前端页面。');
  const module = service.createModule(project.id, { code: 'CV', name: '视觉算法', description: '训练、推理与评估', sortOrder: 10 });
  const feature = service.createFeature(project.id, { moduleId: module.id, code: 'HELMET', name: '安全帽检测', summary: '纯 Python 推理与评估。', status: 'DESIGNING', sortOrder: 10 });
  const cap = service.createCapability(project.id, feature.id, { code: 'AI-01', name: '目标检测推理', summary: '批量预处理、模型推理、后处理与指标输出。', sortOrder: 10 });
  capabilityDesign(cap.id, cap.code, cap.name, cap.summary);
  const related = [`${cap.code} ${cap.name}`];
  asset(project.id, feature.id, { kind: 'DATA_MODEL', name: 'Dataset 与输入 Schema', summary: '数据集划分、标注与模型输入。', structuredData: { type: 'dataset-schema', relatedCapabilities: related, datasets: [{ 名称: 'helmet_train_v3', 格式: 'COCO', 划分: 'train/val/test = 8/1/1', 版本: 'sha256 manifest' }], fields: [{ 字段: 'image', 类型: 'uint8 ndarray', Shape: 'H×W×3' }, { 字段: 'targets', 类型: 'list[Box]', Shape: 'N×6' }] } });
  asset(project.id, feature.id, { kind: 'CODE_MODEL', name: 'Python 推理模型', summary: 'Pydantic 输入、Dataclass 输出与 Detector。', structuredData: { type: 'python-model', relatedCapabilities: related, components: [{ 对象: 'InferenceRequest', 类型: 'Pydantic Model', 字段: 'images, threshold, request_id' }, { 对象: 'Detection', 类型: 'dataclass', 字段: 'bbox, class_id, confidence' }, { 对象: 'HelmetDetector', 类型: 'class', 字段: 'model, device, preprocess' }] } });
  asset(project.id, feature.id, { kind: 'INTERFACE', name: '模型输入输出契约', summary: 'Python function contract，不是 HTTP API。', structuredData: { type: 'function-call', relatedCapabilities: related, contracts: [{ 函数: 'infer(batch: ImageBatch)', 输入: 'uint8 N×H×W×3', 输出: 'list[list[Detection]]', 错误: 'InvalidShape / ModelUnavailable' }] } });
  asset(project.id, feature.id, { kind: 'ALGORITHM', name: '安全帽检测算法', summary: '预处理、模型、后处理、指标与 Artifact。', structuredData: { type: 'computer-vision', model: 'YOLOv8', relatedCapabilities: related, inputs: [{ 名称: 'image', 格式: 'BGR uint8', Shape: 'H×W×3' }], preprocess: [{ 步骤: 'letterbox', 参数: '640×640' }, { 步骤: 'normalize', 参数: '0..1 NCHW' }], postprocess: [{ 步骤: 'NMS', 参数: 'IoU 0.45' }], metrics: [{ 指标: 'Precision', 目标: '>=0.92' }, { 指标: 'Recall', 目标: '>=0.88' }], resources: [{ 资源: 'GPU', 预算: '8GB VRAM' }, { 资源: 'Artifact', 预算: 'helmet_v3.onnx + checksum' }] } });
  asset(project.id, feature.id, { kind: 'CONFIG', name: '推理与评估配置', summary: '阈值、批量、设备和 Artifact 路径。', structuredData: { type: 'yaml-config', relatedCapabilities: related, settings: [{ 配置: 'threshold', 默认值: 0.5 }, { 配置: 'batch_size', 默认值: 8 }, { 配置: 'device', 默认值: 'cuda:0' }] } });
  asset(project.id, feature.id, { kind: 'DEPLOYMENT', name: 'Python Runtime', summary: '虚拟环境、CUDA 与模型 Artifact。', structuredData: { type: 'python-runtime', relatedCapabilities: related, dependencies: [{ 依赖: 'Python', 版本: '3.12' }, { 依赖: 'PyTorch', 版本: '2.x + CUDA' }, { 依赖: 'Artifact', 版本: 'helmet_v3.onnx' }] } });
  asset(project.id, feature.id, { kind: 'INTEGRATION', name: 'Dataset 到 Evaluator', summary: '纯算法模块内的数据契约。', structuredData: { type: 'integration-contract', relatedCapabilities: related, connections: [{ 生产者: 'DatasetLoader', 消费者: 'HelmetDetector', 协议: 'Python iterator', 输入: 'ImageBatch', 输出: 'DetectionBatch', 超时: 'batch 500ms', 重试: '0', 错误: '记录坏样本并跳过', 版本: 'schema v1', 验证: 'evaluation suite' }] } });
  asset(project.id, feature.id, { kind: 'TEST_DESIGN', name: '算法评估设计', summary: '准确率、召回率、延迟和坏输入验证。', structuredData: { type: 'evaluation', relatedCapabilities: related, tests: [{ 编号: 'AI-EVAL-01', 数据集: 'helmet_test_v3', 指标: 'Precision/Recall', 目标: '0.92/0.88', 结果: 'NOT_RUN' }, { 编号: 'AI-PERF-02', 数据集: '2000 images', 指标: 'P95 latency', 目标: '<80ms', 结果: 'NOT_RUN' }] } });
}

try {
  augmentWebExample();
  augmentGodotExample();
  augmentRtspExample();
  createVideoPlatform();
  createPythonAiExample();
  console.log('ForgeFlow engineering blueprint demo data is ready.');
} finally {
  sqlite.close();
}
