import { openDatabase } from '../db/client.js';
import { WorkspaceRepository } from '../modules/workspace/workspace.repository.js';
import { WorkspaceService } from '../modules/workspace/workspace.service.js';

const { sqlite, db } = openDatabase();
const service = new WorkspaceService(new WorkspaceRepository({ sqlite, db }));

function projectDocument(projectId: string, kind: string, title: string, content: string) {
  const specification = service.createSpecification(projectId, { kind, title, featureId: null, capabilityId: null });
  service.createRevision(projectId, specification.id, {
    content,
    changeSummary: `形成${title}`,
    expectedHeadRevisionId: null,
    source: 'demo-seed:note-list',
  });
}

const featureDesignContent = `# 管理笔记｜全流程功能设计

## 1. 业务目标与成功标准

用户无需注册，在一个页面内完成短笔记的新增、编辑、完成、筛选和删除；刷新页面后仍能恢复本机数据。成功不是“页面存在”，而是五项操作均可观察、错误输入有明确结果、持久化可复现。

## 2. 范围与明确排除项

本次包含单用户、本机、离线笔记清单以及全部/未完成/已完成三种筛选。不包含账号、云同步、多人协作、标签、富文本和服务端数据库；这些能力未来接入时必须形成新的设计版本。

## 3. 使用者、权限与运行边界

唯一角色是当前浏览器的本地用户。没有账号和远程权限系统，能打开页面的人即可读写该浏览器配置下的数据；不同浏览器或设备之间默认不共享。不得把“无登录”误写成“无数据边界”。

## 4. 功能明细

N-01 新增笔记：输入有效文本后创建一条未完成笔记。N-02 编辑笔记：修改正文但保留标识、创建时间和完成状态。N-03 切换完成状态：在未完成和已完成之间切换。N-04 筛选笔记：只改变当前展示，不修改持久化数据。N-05 删除与持久化：删除目标后保存完整结果，刷新仍保持一致。

## 5. 正常流程

页面启动时从 StorageAdapter 读取并解析 Note 数组；用户输入标题并提交后由领域函数校验和创建 Note，应用层替换内存数组、写入存储并重新渲染。编辑、切换和删除都遵循“领域函数返回新数组 → 保存 → 渲染”的同一顺序。筛选只计算可见集合。

## 6. 异常、边界与恢复

空白文本不得创建或覆盖原标题；标题最长 120 字符；目标 id 不存在时保持原数组且不误改其他记录。存储为空或根节点不是数组时降级为空列表。当前版本尚未逐条迁移损坏记录，也没有跨标签页冲突合并，必须在界面与维护说明中保留这一限制。

## 7. 数据、字段与兼容性

Note 固定包含 id、title、completed、createdAt、updatedAt。id 使用字符串 UUID；title 为 trim 后 1–120 字符；completed 为 boolean；时间为 ISO 8601 UTC 字符串。领域对象不绑定 localStorage，Web、桌面、移动端和服务端只通过各自 StorageAdapter 映射同一字段。

## 8. 操作契约与依赖

notes.js 提供 addNote、editNote、toggleNote、removeNote、filterNotes 纯函数，输入数组不被原地修改。app.js 负责 DOM 事件、存储调用和渲染。外部依赖只有浏览器 DOM、crypto.randomUUID 与 localStorage；未来换成 SQLite 或 HTTP 时不得改写领域字段语义。

## 9. 页面、状态与适配

页面上部是标题输入和添加按钮，中部是三种筛选，下部是清单。每行展示完成开关、标题、编辑和删除入口。必须区分空列表、筛选后为空、有效列表和输入错误；窄屏保持单列，操作按钮不能挤压正文到不可读。

## 10. 实现影响与工作包

领域工作包负责 Note 与五个纯函数；界面工作包负责输入、筛选、列表状态和反馈；存储工作包负责序列化、读取降级和兼容边界；验证工作包覆盖领域测试、浏览器流程与刷新恢复。新增字段时同步检查 notes.js、app.js、StorageAdapter、渲染、测试和 ForgeFlow 数据模型版本。

## 11. 验收用例与证据

AC-01 输入“准备周报”后列表首位出现 completed=false 的记录，并保存五个字段。AC-02 空白输入不创建记录。AC-03 编辑后仅 title 与 updatedAt 改变。AC-04 切换后 completed 反转。AC-05 三种筛选结果正确且不改存储。AC-06 删除后刷新页面目标仍不存在。自动化测试证明领域行为，浏览器操作证明交互与真实 localStorage 链路。

## 12. 可观测性、安全与交付

存储解析失败要降级并允许排障，不能静默宣称数据完整。笔记可能包含用户私密文本，不上传、不写日志。交付物是可直接打开或由静态服务器托管的 HTML/CSS/ES Modules；不需要服务端部署，回滚方式是恢复上一版本静态文件，不能清空用户 localStorage。

## 13. 未决事项与维护责任

接入第二个平台前必须确认 schemaVersion、逐项校验、迁移器和冲突策略。增加账号或同步后需重新评审权限、API、数据迁移与隐私边界。当前已知缺口不能因为本地演示通过而被标记为已解决。`;

const noteStructuredData = {
  name: 'Note',
  schemaVersion: '1.0',
  purpose: '跨界面和存储平台传递的一条笔记领域记录',
  serialization: 'JSON object',
  compatibility: '仅使用 JSON 基础类型；平台差异由存储适配层处理',
  fields: [
    { name: 'id', type: 'string', required: true, nullable: false, default: 'crypto.randomUUID()', mutability: '不可变', format: 'UUID 字符串', description: '跨平台稳定标识，避免依赖数据库自增编号' },
    { name: 'title', type: 'string', required: true, nullable: false, default: '无', mutability: '可修改', format: 'trim 后 1–120 字符', description: '用户输入的笔记正文；代码中的真实字段名不是 text' },
    { name: 'completed', type: 'boolean', required: true, nullable: false, default: false, mutability: '可修改', format: 'true / false', description: '表示是否完成，不使用平台相关枚举值' },
    { name: 'createdAt', type: 'string', required: true, nullable: false, default: '创建时刻', mutability: '不可变', format: 'ISO 8601 UTC', description: '字符串可直接通过 JSON、SQLite 和 HTTP 传递' },
    { name: 'updatedAt', type: 'string', required: true, nullable: false, default: '创建时刻', mutability: '修改时更新', format: 'ISO 8601 UTC', description: '用于跨端同步或冲突判断时识别较新的记录' },
  ],
  compatibilityRules: [
    { concern: '标识', decision: '使用字符串 UUID', reason: '浏览器、SQLite、移动端和服务端均可无损表达' },
    { concern: '时间', decision: '使用 ISO 8601 UTC 字符串', reason: '避免 Date 对象无法直接 JSON 序列化以及本地时区歧义' },
    { concern: '状态', decision: '使用 boolean', reason: '当前只有完成和未完成两态，保持最小稳定契约' },
    { concern: '界面状态', decision: 'filter 不进入 Note', reason: '筛选条件属于页面会话，不应污染领域数据' },
  ],
  storageAdapters: [
    { platform: 'Web', storage: 'localStorage', mapping: 'JSON 数组', status: '当前已实现', notes: '键 forgeflow-note-list-demo；当前缺少逐项迁移' },
    { platform: '桌面端', storage: 'SQLite', mapping: 'id/title TEXT，completed INTEGER，时间 TEXT', status: '兼容约定', notes: '由适配器完成 boolean 映射' },
    { platform: '移动端', storage: 'SQLite / JSON', mapping: '保持字段名和 ISO 时间', status: '兼容约定', notes: '不把平台对象写入领域模型' },
    { platform: '服务端', storage: 'HTTP JSON + 数据库', mapping: 'UUID/TEXT/BOOLEAN/TIMESTAMP', status: '兼容约定', notes: 'API 边界校验同一字段约束' },
  ],
  knownGaps: [
    { item: '逐项校验', current: 'loadNotes 只校验根节点是否为数组', target: '按 schemaVersion 校验并迁移每条 Note' },
    { item: '并发同步', current: '单浏览器本地存储', target: '多端同步时定义 updatedAt 冲突策略或版本号' },
  ],
  relatedCapabilities: ['N-01', 'N-02', 'N-03', 'N-04', 'N-05'],
};

const noteModelMarkdown = `# 为什么这样设计

Note 是领域对象，不是 localStorage 专用结构。字段只使用 JSON 能稳定表达的 string 和 boolean，因此同一份契约可以映射到浏览器存储、SQLite、移动端或 HTTP API。

## 字段取舍

- id 使用字符串 UUID：不依赖某个平台的自增主键，复制或同步时仍保持稳定。
- title 对应实际代码字段；输入先 trim，页面限制 120 字符。
- completed 目前只有两态，用 boolean 比平台枚举更简单。
- createdAt 与 updatedAt 使用 ISO 8601 UTC 字符串，避免时区和 Date 序列化差异。
- filter、选中行等 UI 状态不进入 Note，避免领域模型被具体页面污染。

## 跨平台方式

领域层保持 Note 字段不变，每个平台只实现自己的 StorageAdapter。Web 当前使用 localStorage；桌面或移动端可映射到 SQLite；服务端可映射到 JSON API 和数据库类型。

## 当前限制

当前代码直接读取 JSON 数组，只对非法 JSON 和非数组值降级为空列表，尚未做逐条字段校验。要正式支持多个平台，应在存储数据外增加 schemaVersion，并为旧版本提供显式迁移。`;

type CapabilityDesignSeed = {
  title: string; definition: string; actor: string; precondition: string; input: string; output: string;
  flow: string; rules: string; failures: string; contract: string; impact: string; acceptance: string;
};

function capabilityDesign(seed: CapabilityDesignSeed) {
  return `# ${seed.title}

## 1. 功能定义

${seed.definition}

## 2. 使用者与场景

${seed.actor}

## 3. 前置条件

${seed.precondition}

## 4. 输入与校验

${seed.input}

## 5. 输出与状态变化

${seed.output}

## 6. 正常流程

${seed.flow}

## 7. 业务规则

${seed.rules}

## 8. 异常、边界与恢复

${seed.failures}

## 9. 数据、契约与依赖

${seed.contract}

## 10. 权限、安全与兼容

本地用户可操作当前浏览器配置下的数据；笔记正文不上传、不写日志。领域规则不依赖 localStorage，替换平台时保持 Note 字段与行为语义。

## 11. 实现影响

${seed.impact}

## 12. 验收用例与证据

${seed.acceptance}

## 13. 当前实现状态

设计已形成；实现和验证状态必须以任务执行记录、自动化结果与浏览器证据为准。

## 14. 未决事项

跨标签页并发、逐项数据迁移和远程同步不在当前范围；一旦引入，必须创建新设计版本并重新分析影响。`;
}

const capabilityDesigns: Record<string, string> = {
  'N-01': capabilityDesign({
    title: 'N-01 新增笔记', definition: '输入有效文本后创建一条未完成笔记。', actor: '本地用户在快速记录想法或待办时使用。输入区始终可见，不要求先选择筛选状态。',
    precondition: '页面已完成初始化；内存中的 notes 为可用数组；浏览器支持 crypto.randomUUID。',
    input: 'title 为 string。先 trim，结果必须为 1–120 个字符；纯空白或超长内容不进入领域创建流程。',
    output: '生成完整 Note：字符串 UUID、清理后的 title、completed=false、相同的 createdAt/updatedAt ISO UTC 时间。新记录进入列表首位，保存后清空输入。',
    flow: '1. 用户输入并提交。2. 界面校验长度。3. addNote 再次执行领域校验并创建 Note。4. 应用层用返回的新数组替换状态。5. StorageAdapter 保存。6. 页面渲染并给出结果。',
    rules: '创建时 completed 必须为 false；id 与 createdAt 后续不可变；不原地修改旧数组；当前筛选为“已完成”时新记录可以不出现在可见集合，但必须已保存。',
    failures: '空白输入不创建且保留可修正的输入状态；超长输入由 maxlength 和领域校验共同阻止；存储写入失败时不得假装成功，应保留内存结果并提示刷新后可能丢失。',
    contract: '依赖 Note 数据模型、addNote(title, now?, idFactory?) 纯函数、StorageAdapter.save(notes) 和页面渲染。可注入时间与 id 工厂以稳定测试。',
    impact: '涉及 notes.js 的创建规则、app.js 的提交处理与存储、index.html 输入约束、style.css 错误反馈以及 notes.test.js。',
    acceptance: 'AC-N01-01 输入“准备周报”后得到 completed=false 且五字段完整的记录；AC-N01-02 输入前后空格时只保存清理后标题；AC-N01-03 空白输入不增加数组长度。证据为领域测试与浏览器新增流程。',
  }),
  'N-02': capabilityDesign({
    title: 'N-02 编辑笔记', definition: '修改既有笔记正文并保留其完成状态。', actor: '本地用户发现文字需要更正时，从目标行进入编辑并提交。',
    precondition: '目标 Note 已存在且 id 可稳定定位；页面没有同时提交另一个编辑操作。',
    input: '输入 notes、目标 id 和新 title；title trim 后为 1–120 个字符。id 不允许由界面修改。',
    output: '返回新数组；目标的 title 与 updatedAt 更新，id、createdAt、completed 保持不变；其他 Note 引用和值不受影响。',
    flow: '1. 用户选择编辑。2. 页面载入原标题。3. 用户提交。4. editNote 校验并按 id 替换目标。5. 保存完整数组。6. 退出编辑态并重绘。',
    rules: '不得通过编辑隐式改变完成状态；同标题提交可视为无业务变化；所有变更采用不可变数组结果。',
    failures: '空白或超长标题拒绝提交；目标不存在时保持原数组并退出危险写入；存储失败时提示当前修改未可靠持久化。',
    contract: '依赖 editNote(notes, id, title)、Note 字段约束、StorageAdapter.save 与行级编辑 UI。',
    impact: '涉及 notes.js 更新逻辑、app.js 编辑状态和事件、列表行布局、字段兼容测试。',
    acceptance: 'AC-N02-01 修改后仅 title/updatedAt 变化；AC-N02-02 已完成记录编辑后仍已完成；AC-N02-03 空白标题不覆盖原值。证据为字段断言和浏览器行内编辑。',
  }),
  'N-03': capabilityDesign({
    title: 'N-03 切换完成状态', definition: '把指定笔记在未完成和已完成之间切换，并保留正文与创建信息。', actor: '本地用户通过每行的完成控件标记进度，也可以再次取消完成。',
    precondition: '目标 Note 存在；列表已完成渲染。', input: '输入 notes 和目标 id；界面不直接传任意状态值，而是基于现值反转 boolean。',
    output: '目标 completed 取反并更新 updatedAt；id、title、createdAt 不变。当前筛选可能使该行切换后立即离开可见列表。',
    flow: '1. 用户点击完成控件。2. toggleNote 按 id 找到记录。3. 生成 completed 反值的新 Note 和新数组。4. 保存。5. 依据当前筛选重新渲染。',
    rules: '只有 true/false 两态；一次操作只影响一个 id；筛选后的视觉消失是正确结果，不等于删除。',
    failures: '目标不存在时保持原数组；连续快速点击应以实际调用顺序得到最终状态；存储失败需提示持久化风险。',
    contract: '依赖 toggleNote、Note.completed、Note.updatedAt、StorageAdapter.save 和 filterNotes 的组合结果。',
    impact: '涉及 notes.js 状态更新、app.js 行事件和筛选后渲染、完成态样式与双向切换测试。',
    acceptance: 'AC-N03-01 false 切换为 true；AC-N03-02 再次切换恢复 false；AC-N03-03 标题与创建时间均不变。证据为自动化字段断言和浏览器筛选联动。',
  }),
  'N-04': capabilityDesign({
    title: 'N-04 筛选笔记', definition: '按全部、未完成和已完成查看笔记，不修改任何持久化记录。', actor: '本地用户在查看清单时选择当前关注范围。',
    precondition: '内存 notes 已加载；筛选控件可用。', input: 'filter 只能为 all、active、completed；未知值不进入持久状态。',
    output: '返回供渲染的派生数组。Note 内容、顺序和存储值不变；页面明确标识当前筛选。',
    flow: '1. 用户选择筛选。2. 页面更新会话级 filter。3. filterNotes 计算可见集合。4. 渲染列表或筛选空状态。',
    rules: 'filter 不是 Note 字段，不写入领域对象；active 匹配 completed=false，completed 匹配 true，all 返回全部。',
    failures: '未知筛选值回退到 all 或明确拒绝；筛选结果为空时显示“当前筛选无结果”，不能误导为全部数据丢失。',
    contract: '依赖 filterNotes(notes, filter) 和页面会话状态，不依赖 StorageAdapter 写入。',
    impact: '涉及 notes.js 派生查询、app.js 筛选状态、筛选控件与空状态样式、三类集合测试。',
    acceptance: 'AC-N04-01 all 显示全部；AC-N04-02 active 只显示未完成；AC-N04-03 completed 只显示已完成；切换前后存储序列化内容一致。',
  }),
  'N-05': capabilityDesign({
    title: 'N-05 删除与持久化', definition: '删除目标笔记，保留其他记录，并把操作结果持久化到当前平台。', actor: '本地用户确认某条笔记不再需要时触发删除；刷新页面用于验证持久化结果。',
    precondition: '目标 Note id 已知；StorageAdapter 已初始化。', input: '输入 notes 和目标 id；删除只接受标识，不用标题匹配，避免同名记录误删。',
    output: '返回排除目标 id 的新数组并保存；其他记录字段与顺序不变。刷新后从存储恢复同一结果。',
    flow: '1. 用户触发删除。2. 页面确认目标。3. removeNote 过滤目标。4. 应用层保存新数组。5. 重绘当前筛选。6. 下次启动读取同一结果。',
    rules: '删除不复用筛选结果作为保存源，必须基于完整 notes；localStorage 只是 Web 适配器，不是领域规则。',
    failures: '目标不存在时保持原数组；非法 JSON 读取时降级为空列表但记录可排障信息；写入失败不得宣称删除已可靠保存。',
    contract: '依赖 removeNote、StorageAdapter.load/save、JSON 序列化和启动恢复流程。桌面端可映射 SQLite 事务，服务端可映射 DELETE/更新接口。',
    impact: '涉及 notes.js 删除、app.js 完整数组保存与初始化读取、StorageAdapter、删除交互和刷新恢复验证。',
    acceptance: 'AC-N05-01 只删除目标 id；AC-N05-02 其他记录保持；AC-N05-03 刷新后目标仍不存在；AC-N05-04 非数组存储安全降级。证据为领域测试、localStorage 检查和刷新后的浏览器结果。',
  }),
};

function ensureCapabilityDesigns(projectId: string, featureId: string) {
  for (const capability of service.listCapabilities(projectId, featureId)) {
    const content = capabilityDesigns[capability.code];
    if (!content) continue;
    const detail = service.getCapabilityDetail(projectId, featureId, capability.id);
    if (!detail.design) {
      service.createCapabilityDesign(capability.id, {
        source: 'demo-seed:note-list',
        changeSummary: `形成 ${capability.code} 全流程能力设计`,
        content,
      });
    } else if (!detail.design.latestRevision?.content.includes('## 12. 验收用例与证据')) {
      service.createRevision(projectId, detail.design.specification.id, {
        content,
        changeSummary: `补齐 ${capability.code} 规则、异常、影响与验收证据`,
        expectedHeadRevisionId: detail.design.latestRevision?.id ?? null,
        source: 'demo-seed:note-list',
      });
    }
    service.updateCapability(projectId, featureId, capability.id, { status: 'DONE' });
  }
}

function ensureNoteModel(projectId: string, featureId: string) {
  const current = service.getFeatureEngineeringBlueprint(projectId, featureId).assets.find((item) => item.kind === 'DATA_MODEL' && item.code === 'Note');
  if (!current) {
    return service.createEngineeringAsset(projectId, featureId, {
      kind: 'DATA_MODEL', name: 'Note 数据模型', code: 'Note', summary: '跨平台可序列化的笔记领域模型。',
      structuredData: noteStructuredData, contentMarkdown: noteModelMarkdown, source: 'demo-seed:note-list', status: 'DONE',
    });
  }
  if (current.structuredData?.schemaVersion !== noteStructuredData.schemaVersion || !Array.isArray(current.structuredData?.fields) || current.structuredData.fields.length !== 5) {
    return service.createEngineeringAssetRevision(projectId, current.id, {
      expectedCurrentRevisionId: current.currentRevisionId!,
      changeSummary: '按实际代码补齐字段、设计理由与跨平台映射',
      source: 'demo-seed:note-list', summary: '跨平台可序列化的笔记领域模型。', status: 'DONE',
      structuredData: noteStructuredData, contentMarkdown: noteModelMarkdown,
    });
  }
  return current;
}

const engineeringAssetSeeds = [
  {
    kind: 'CODE_MODEL', code: 'note-domain', name: 'Note 领域代码模型', summary: 'Note、领域函数与存储适配器的职责和依赖方向。',
    structuredData: { designCoverage: 'FULL_FLOW', relatedCapabilities: ['N-01', 'N-02', 'N-03', 'N-04', 'N-05'], components: [
      { name: 'Note', type: 'Domain record', responsibility: '承载五个稳定字段，不包含界面状态' },
      { name: 'notes.js', type: 'Domain functions', responsibility: '校验并返回不可变的新记录或新数组' },
      { name: 'app.js', type: 'Application coordinator', responsibility: '连接 DOM、领域操作、存储和渲染' },
      { name: 'StorageAdapter', type: 'Platform boundary', responsibility: 'load/save 与平台类型映射' },
    ] },
    contentMarkdown: '# 依赖方向\n\n页面调用应用层，应用层调用 notes.js 与 StorageAdapter。notes.js 不依赖 DOM、localStorage 或具体平台；StorageAdapter 不修改 Note 的领域语义。',
  },
  {
    kind: 'INTERFACE', code: 'notes.js', name: '笔记领域操作契约', summary: '五项领域操作的输入、输出、失败语义和不可变约束。',
    structuredData: { designCoverage: 'FULL_FLOW', relatedCapabilities: ['N-01', 'N-02', 'N-03', 'N-04', 'N-05'], methods: [
      { name: 'addNote', input: 'title', output: 'Note + new notes[]', failure: '空白或超长标题拒绝' },
      { name: 'editNote', input: 'notes, id, title', output: 'new notes[]', failure: '目标不存在或标题无效时保持原数据' },
      { name: 'toggleNote', input: 'notes, id', output: 'new notes[]', failure: '目标不存在时保持原数据' },
      { name: 'removeNote', input: 'notes, id', output: 'new notes[]', failure: '只按 id 删除' },
      { name: 'filterNotes', input: 'notes, all|active|completed', output: 'visible notes[]', failure: '未知筛选值回退或拒绝' },
    ] },
    contentMarkdown: '# 契约边界\n\nnotes.js 只处理领域数据，不访问 DOM 或 localStorage。所有写操作返回新数组；空输入、目标不存在和字段保持规则必须由自动化测试覆盖。',
  },
  {
    kind: 'UI_DESIGN', code: 'note-list-page', name: '笔记清单页面与交互', summary: '输入、筛选、列表、空状态、错误反馈和窄屏适配。',
    structuredData: { designCoverage: 'FULL_FLOW', relatedCapabilities: ['N-01', 'N-02', 'N-03', 'N-04', 'N-05'], states: [
      { state: '初始化', display: '读取本地数据并渲染', action: '不可误报为空' },
      { state: '空列表', display: '还没有笔记', action: '聚焦输入' },
      { state: '筛选无结果', display: '当前筛选无结果', action: '允许切回全部' },
      { state: '输入错误', display: '就近显示原因', action: '保留可修正输入' },
      { state: '正常列表', display: '完成控件、标题、编辑、删除', action: '窄屏不挤压正文' },
    ] },
    contentMarkdown: '# 页面结构\n\n页面按“快速输入 → 筛选 → 清单”组织。功能名称和当前状态优先，说明文字不占用左侧导航。移动端保持单列，行级操作可触达且不覆盖标题。',
  },
  {
    kind: 'INTEGRATION', code: 'storage-adapter', name: '存储适配契约', summary: '领域 Note 与浏览器、桌面、移动端或服务端存储之间的稳定边界。',
    structuredData: { designCoverage: 'FULL_FLOW', relatedCapabilities: ['N-01', 'N-02', 'N-03', 'N-05'], contracts: [
      { platform: 'Web', adapter: 'localStorage', mapping: 'JSON Note[]', current: '已实现' },
      { platform: 'Desktop', adapter: 'SQLite', mapping: 'TEXT/INTEGER/UTC TEXT', current: '兼容约定' },
      { platform: 'Mobile', adapter: 'SQLite or JSON', mapping: '保持字段名与 ISO 时间', current: '兼容约定' },
      { platform: 'Server', adapter: 'HTTP JSON + DB', mapping: 'UUID/TEXT/BOOLEAN/TIMESTAMP', current: '兼容约定' },
    ] },
    contentMarkdown: '# 集成原则\n\n领域层只认 Note 和 StorageAdapter.load/save。平台适配器负责类型映射、事务与错误反馈；任何平台都不能擅自改名字段或把 UI 会话状态写入 Note。',
  },
  {
    kind: 'CONFIG', code: 'note-runtime', name: '运行与兼容配置', summary: '存储键、标题长度、筛选值和兼容版本的集中约定。',
    structuredData: { designCoverage: 'FULL_FLOW', relatedCapabilities: ['N-01', 'N-04', 'N-05'], settings: [
      { name: 'storageKey', default: 'forgeflow-note-list-demo', constraint: '变更需提供迁移' },
      { name: 'titleMaxLength', default: 120, constraint: 'UI 与领域校验一致' },
      { name: 'filters', default: 'all, active, completed', constraint: '未知值不可持久化' },
      { name: 'schemaVersion', default: '1.0', constraint: '接入第二平台前实现迁移器' },
    ] },
    contentMarkdown: '# 配置原则\n\n配置改变行为时必须同步设计与测试。storageKey 变更不能直接丢弃旧数据；标题长度必须在 HTML 与领域函数保持一致。',
  },
  {
    kind: 'DEPLOYMENT', code: 'static-delivery', name: '静态交付与回滚', summary: '无后端应用的真实交付、浏览器兼容和无损回滚边界。',
    structuredData: { designCoverage: 'FULL_FLOW', relatedCapabilities: ['N-01', 'N-02', 'N-03', 'N-04', 'N-05'], stages: [
      { stage: '验证', requirement: '自动化测试 + 浏览器主流程 + 控制台无错误' },
      { stage: '交付', requirement: '静态服务器或支持 ES Modules 的浏览器环境' },
      { stage: '回滚', requirement: '恢复上一版静态文件，不清空 localStorage' },
    ] },
    contentMarkdown: '# 交付边界\n\n本项目没有服务端部署。发布静态文件前验证 ES Modules、crypto.randomUUID 与 localStorage；回滚代码时保留用户数据，若 Schema 变化必须先验证向后兼容。',
  },
  {
    kind: 'TEST_DESIGN', code: 'notes.test.js', name: '笔记清单验证设计', summary: '把领域测试、浏览器流程和持久化证据分层记录。',
    structuredData: { designCoverage: 'FULL_FLOW', relatedCapabilities: ['N-01', 'N-02', 'N-03', 'N-04', 'N-05'], tests: [
      { id: 'AC-01', level: 'unit', scenario: '新增有效文本与默认字段', expected: '五字段完整，completed=false', evidence: 'node --test' },
      { id: 'AC-02', level: 'unit', scenario: '空白输入', expected: '不创建', evidence: 'node --test' },
      { id: 'AC-03', level: 'unit', scenario: '编辑/切换/筛选/删除', expected: '字段保持与集合正确', evidence: 'node --test' },
      { id: 'AC-04', level: 'browser', scenario: '新增到刷新恢复', expected: '真实 DOM 与 localStorage 一致', evidence: '浏览器操作与控制台' },
    ] },
    contentMarkdown: '# 证据分层\n\n领域测试只能证明纯函数行为；浏览器验证负责 DOM、事件和 localStorage 真实链路。未执行项标记 NOT_RUN，不把设计文本当成通过证据。',
  },
] as const;

function ensureEngineeringAssets(projectId: string, featureId: string) {
  for (const seed of engineeringAssetSeeds) {
    const current = service.getFeatureEngineeringBlueprint(projectId, featureId).assets.find((item) => item.kind === seed.kind && item.code === seed.code);
    if (!current) {
      service.createEngineeringAsset(projectId, featureId, { ...seed, source: 'demo-seed:note-list', status: 'DONE' });
    } else if (current.structuredData?.designCoverage !== 'FULL_FLOW') {
      service.createEngineeringAssetRevision(projectId, current.id, {
        expectedCurrentRevisionId: current.currentRevisionId!, changeSummary: '补齐全流程设计内容与验收边界',
        source: 'demo-seed:note-list', summary: seed.summary, status: 'DONE', structuredData: seed.structuredData, contentMarkdown: seed.contentMarkdown,
      });
    }
  }
}

function ensureNoteTraceLinks(projectId: string, featureId: string) {
  const blueprint = service.getFeatureEngineeringBlueprint(projectId, featureId);
  const noteModel = blueprint.assets.find((item) => item.kind === 'DATA_MODEL' && item.code === 'Note');
  const verification = blueprint.assets.find((item) => item.kind === 'TEST_DESIGN' && item.code === 'notes.test.js');
  const task = service.listTasks(projectId, featureId).find((item) => item.code === 'T-NOTE-01');
  for (const capability of blueprint.capabilities) {
    if (noteModel) service.createTraceLink(projectId, { sourceType: 'CAPABILITY', sourceId: capability.id, targetType: 'ENGINEERING_ASSET', targetId: noteModel.id, relation: 'DEPENDS_ON' });
    if (verification) service.createTraceLink(projectId, { sourceType: 'CAPABILITY', sourceId: capability.id, targetType: 'ENGINEERING_ASSET', targetId: verification.id, relation: 'VERIFIED_BY' });
    if (task) service.createTraceLink(projectId, { sourceType: 'TASK', sourceId: task.id, targetType: 'CAPABILITY', targetId: capability.id, relation: 'IMPLEMENTS' });
  }
}

const existing = service.listProjects().find((project) => project.projectKey === 'NOTE_LIST');
if (existing) {
  const detail = service.getProject(existing.id);
  const feature = detail.features.find((item) => item.code === 'NOTE-LIST');
  if (!feature) throw new Error('NOTE_LIST 缺少 NOTE-LIST 功能');
  const featureSpecification = detail.specifications.find((item) => item.featureId === feature.id && item.kind === 'feature-design');
  if (featureSpecification?.latestRevisionId) {
    const currentDesign = service.getSpecification(existing.id, featureSpecification.id);
    if (!currentDesign.latestRevision?.content.includes('## 13. 未决事项与维护责任')) {
    const revision = service.createRevision(existing.id, featureSpecification.id, {
      content: featureDesignContent,
      changeSummary: '升级为全流程功能设计，补齐异常、影响、验收与交付',
      expectedHeadRevisionId: featureSpecification.latestRevisionId,
      source: 'demo-seed:note-list',
    });
    const review = service.submitDesignReview(existing.id, featureSpecification.id, revision.id);
    service.decideDesignReview(existing.id, review.id, 'APPROVED', '功能范围、详细行为、实现影响和验收证据已形成闭环。');
    }
  }
  ensureCapabilityDesigns(existing.id, feature.id);
  const noteModel = ensureNoteModel(existing.id, feature.id);
  ensureEngineeringAssets(existing.id, feature.id);
  ensureNoteTraceLinks(existing.id, feature.id);
  console.log(JSON.stringify({ projectId: existing.id, featureId: feature.id, noteModelRevision: noteModel.currentRevisionNo, reused: true, reconciled: true }));
  sqlite.close();
  process.exit(0);
}

const project = service.createProject({
  projectKey: 'NOTE_LIST',
  name: '纸页 · 笔记清单',
  description: '一个可离线使用的单页笔记清单，用来验证从需求、设计、实现到证据回写的最小闭环。',
  projectType: 'Vanilla JavaScript Web',
  workflowMode: 'CONTROLLED',
  designProfile: 'web',
});

projectDocument(project.id, 'background', '项目背景', '# 项目目标\n\n让用户无需注册即可快速记录、编辑、完成、筛选和删除短笔记，刷新页面后数据仍然存在。');
projectDocument(project.id, 'requirements', '需求分析', '# 用户场景\n\n用户打开页面后直接输入笔记；可切换完成状态并按全部、未完成、已完成筛选。\n\n# 非目标\n\n不做账号、云同步、多人协作和复杂标签。');
projectDocument(project.id, 'architecture', '架构设计', '# 结构\n\nindex.html 负责语义结构，app.js 负责交互编排，notes.js 负责纯数据操作，localStorage 负责本机持久化。\n\n不引入框架、服务端和构建工具。');
projectDocument(project.id, 'technology', '技术选型', '# 决策\n\n| 类别 | 选择 | 原因 |\n| --- | --- | --- |\n| UI | HTML + CSS | 直接打开即可运行 |\n| 逻辑 | ES Modules | 保持模块边界和可测试性 |\n| 存储 | localStorage | 符合离线单用户边界 |\n| 测试 | Node test | 无第三方依赖 |');

const module = service.createModule(project.id, {
  code: 'NOTES',
  name: '笔记清单',
  description: '记录、整理和回看当天的短笔记。',
  sortOrder: 10,
});
const feature = service.createFeature(project.id, {
  moduleId: module.id,
  code: 'NOTE-LIST',
  name: '管理笔记',
  summary: '在一个页面内新增、编辑、完成、筛选和删除笔记，并在本机持久化。',
  status: 'VERIFYING',
  sortOrder: 10,
});

const featureDesign = service.createFeatureDesign(feature.id, {
  source: 'demo-seed:note-list',
  changeSummary: '形成笔记清单最小可实施设计',
  content: featureDesignContent,
});

const review = service.submitDesignReview(project.id, featureDesign.specification.id, featureDesign.revision.id);
service.decideDesignReview(project.id, review.id, 'APPROVED', '最小范围明确，允许实现并验证。');

const capabilities = [
  ['N-01', '新增笔记', '输入有效文本后创建一条未完成笔记。'],
  ['N-02', '编辑笔记', '修改既有笔记正文并保留其完成状态。'],
  ['N-03', '切换完成状态', '在未完成和已完成之间切换。'],
  ['N-04', '筛选笔记', '按全部、未完成和已完成查看。'],
  ['N-05', '删除与持久化', '删除目标笔记，其他数据保持，并持久化到本机。'],
] as const;
const createdCapabilities = capabilities.map(([code, name, summary], index) => service.createCapability(project.id, feature.id, {
  code,
  name,
  summary,
  status: 'TESTING',
  sortOrder: (index + 1) * 10,
}));

ensureCapabilityDesigns(project.id, feature.id);

ensureNoteModel(project.id, feature.id);
ensureEngineeringAssets(project.id, feature.id);

const task = service.createTask(project.id, feature.id, {
  code: 'T-NOTE-01',
  name: '实现并验证笔记清单',
  type: 'FRONTEND',
  category: 'IMPLEMENTATION',
  area: 'note-list',
  status: 'PLANNED',
  objective: '按批准设计实现单页笔记清单，并记录真实自动化与浏览器证据。',
  designRevisionId: featureDesign.revision.id,
  sortOrder: 10,
});
service.updateTask(project.id, feature.id, task.id, { status: 'AUTHORIZED' });
service.authorizeTask(project.id, feature.id, task.id);
const run = service.startAuthorizedRunByTaskId(task.id, { baseCommit: null, actorName: 'Codex' });

const source = service.upsertProjectSource({
  projectId: project.id,
  alias: 'note-app',
  displayName: '笔记清单源码',
  purpose: '浏览器 UI、笔记领域逻辑和自动化测试。',
  sourceKind: 'DIRECTORY',
  environmentKey: 'flycode-pc',
  localRoot: 'D:\\demo\\forgeflow-note-list',
  remoteUrl: null,
  repoSubdir: null,
  scope: { include: ['**/*'], exclude: ['node_modules/**', '.git/**'] },
  idempotencyKey: 'note-list-demo-source-v1',
});
const analysis = service.requestSourceAnalysis({
  projectId: project.id,
  sourceIds: [source.id],
  environmentKey: 'flycode-pc',
  featureId: feature.id,
  capabilityId: null,
  analysisScope: { objective: '确认实现边界、文件职责、测试入口和后续字段变更影响。' },
  prompt: '只读分析当前笔记清单源码，不修改文件。',
});
service.claimSourceAnalysis(project.id, analysis.id);
service.submitSourceAnalysis({
  projectId: project.id,
  analysisId: analysis.id,
  status: 'SYNCED',
  summary: '实现与设计一致：HTML 提供结构，app.js 编排交互与 localStorage，notes.js 保存纯领域操作，notes.test.js 覆盖数据行为。',
  sourceSnapshots: {
    [source.id]: {
      files: ['index.html', 'style.css', 'app.js', 'notes.js', 'notes.test.js', 'README.md'],
      entrypoints: ['index.html', 'app.js'],
      verification: ['npm test', 'browser add/toggle/filter'],
      changeImpact: { priority: ['index.html', 'notes.js', 'app.js', 'notes.test.js', 'style.css'] },
    },
  },
  checkpoint: { inspectedAt: new Date().toISOString(), actor: 'Codex' },
  errors: {},
});

service.submitRunById(run.id, {
  summary: '笔记清单已按批准设计实现；自动化测试与浏览器新增、完成、筛选流程通过。',
  resultCommit: null,
  changedFiles: [
    { sourceId: source.id, relativePath: 'index.html' },
    { sourceId: source.id, relativePath: 'style.css' },
    { sourceId: source.id, relativePath: 'app.js' },
    { sourceId: source.id, relativePath: 'notes.js' },
    { sourceId: source.id, relativePath: 'notes.test.js' },
    { sourceId: source.id, relativePath: 'README.md' },
  ],
  verificationSummary: {
    reportedStatus: 'PASS',
    origin: 'LOCAL_CAPTURED',
    summary: 'npm test 2/2 通过；浏览器新增、完成切换、已完成筛选通过；控制台无错误。',
  },
  issues: [],
});
service.confirmTask(project.id, feature.id, task.id);
ensureNoteTraceLinks(project.id, feature.id);
for (const capability of createdCapabilities) {
  service.updateCapability(project.id, feature.id, capability.id, { status: 'DONE' });
}
service.updateFeature(project.id, feature.id, { status: 'ACCEPTED' });

console.log(JSON.stringify({ projectId: project.id, featureId: feature.id, sourceAnalysisId: analysis.id, reused: false }));
sqlite.close();
