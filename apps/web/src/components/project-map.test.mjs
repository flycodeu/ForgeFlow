import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { orderProjectMapLayers, parseProjectMap } from './project-map.ts';

const node = (id) => ({ id, label: id, layer: '界面', summary: `${id} 的职责`, status: 'implemented' });
const document = (map) => `# 架构\n\n\`\`\`forgeflow-map\n${JSON.stringify(map)}\n\`\`\`\n`;

test('architecture map keeps declared direction and planned status', () => {
  const result = parseProjectMap(document({ version: 1, nodes: [node('ui'), { ...node('runtime'), status: 'planned' }],
    edges: [{ from: 'ui', to: 'runtime', label: '配置任务', status: 'planned' }] }));
  assert.equal(result.state, 'ready');
  if (result.state !== 'ready') return;
  assert.equal(result.map.edges[0]?.from, 'ui');
  assert.equal(result.map.edges[0]?.to, 'runtime');
  assert.equal(result.map.edges[0]?.status, 'planned');
  assert.equal(result.map.flows, undefined);
  assert.equal(result.map.nodes[0]?.placement ?? 'main', 'main');
});

test('optional node detail and flow fields survive parsing without changing version 1', () => {
  const result = parseProjectMap(document({ version: 1, nodes: [
    { ...node('ui'), details: ['展示任务和复核状态'], featureCodes: ['CAP-01'], placement: 'main' },
    { ...node('auth'), layer: '横切关注点', placement: 'crosscut' },
    { ...node('host'), layer: '运行环境', placement: 'environment' },
  ], edges: [{ from: 'ui', to: 'auth', label: '校验身份', status: 'implemented' }],
  flows: [{ id: 'submit', label: '提交任务', status: 'implemented', steps: [
    { label: '选择能力', nodeId: 'ui', description: '在工作台选择能力项' },
    { label: '校验权限', nodeId: 'auth' },
  ] }] }));
  assert.equal(result.state, 'ready');
  if (result.state !== 'ready') return;
  assert.deepEqual(result.map.nodes[0]?.details, ['展示任务和复核状态']);
  assert.deepEqual(result.map.nodes[0]?.featureCodes, ['CAP-01']);
  assert.equal(result.map.flows?.[0]?.steps[0]?.nodeId, 'ui');
  assert.deepEqual(orderProjectMapLayers(result.map), ['界面']);
});

test('invalid optional fields and dangling flow references are rejected', () => {
  const base = { version: 1, nodes: [node('ui')], edges: [] };
  const flow = { id: 'submit', label: '提交任务', status: 'planned', steps: [{ label: '开始', nodeId: 'ui' }, { label: '结束' }] };
  const invalid = [
    { ...base, nodes: [{ ...node('ui'), placement: 'sidecar' }] },
    { ...base, nodes: [{ ...node('ui'), details: Array(13).fill('过多') }] },
    { ...base, nodes: [{ ...node('ui'), details: ['x'.repeat(101)] }] },
    { ...base, nodes: [{ ...node('ui'), featureCodes: Array(41).fill('CAP') }] },
    { ...base, nodes: [{ ...node('ui'), featureCodes: [''] }] },
    { ...base, flows: [flow, flow] },
    { ...base, flows: [{ ...flow, status: 'verified' }] },
    { ...base, flows: [{ ...flow, steps: [{ label: '不足两步' }] }] },
    { ...base, flows: [{ ...flow, steps: [{ label: '开始', nodeId: 'ghost' }, { label: '结束' }] }] },
    { ...base, flows: [{ ...flow, steps: [{ label: '开始', description: 'x'.repeat(201) }, { label: '结束' }] }] },
    { ...base, flows: [{ ...flow, steps: [{ label: '开始', extra: true }, { label: '结束' }] }] },
    { ...base, flows: Array(13).fill(flow) },
    { ...base, extra: true },
  ];
  for (const [index, map] of invalid.entries()) {
    assert.equal(parseProjectMap(document(map)).state, 'invalid', `invalid case ${index + 1}`);
  }
});

test('absent graph is distinguishable from malformed graph', () => {
  assert.equal(parseProjectMap('# 架构\n\n暂无图谱').state, 'missing');
  assert.equal(parseProjectMap('```forgeflow-map\n{\n').state, 'invalid');
});

test('invalid or ambiguous graph cannot produce a ready topology', () => {
  const cases = [
    { version: 1, nodes: [node('ui'), node('ui')], edges: [] },
    { version: 1, nodes: [node('ui')], edges: [{ from: 'ui', to: 'ghost', label: '调用' }] },
    { version: 1, nodes: [{ ...node('ui'), status: 'verified' }], edges: [] },
  ];
  for (const map of cases) assert.equal(parseProjectMap(document(map)).state, 'invalid');
  assert.equal(parseProjectMap(document({ version: 1, nodes: [node('ui')], edges: [] }).repeat(2)).state, 'invalid');
});

test('project baselines expose explicit, valid topology', async () => {
  for (const project of ['streamfusion', 'salary']) {
    const file = resolve(import.meta.dirname, `../../../../docs/project-atlas/${project}-architecture.md`);
    const result = parseProjectMap(await readFile(file, 'utf8'));
    assert.equal(result.state, 'ready', `${project} architecture map`);
    if (result.state !== 'ready') continue;
    assert.ok(result.map.nodes.length >= 8);
    assert.ok(result.map.edges.length >= 8);
    const ids = new Set(result.map.nodes.map((item) => item.id));
    assert.ok(result.map.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to)));
    assert.ok(result.map.edges.every((edge) => edge.status === 'implemented' || edge.status === 'planned'));
    assert.ok((result.map.flows ?? []).every((flow) => flow.steps.every((step) => !step.nodeId || ids.has(step.nodeId))));
  }
});

test('layer order follows implemented paths while preserving explicit planned directions', async () => {
  const streamfusion = parseProjectMap(await readFile(resolve(import.meta.dirname, '../../../../docs/project-atlas/streamfusion-architecture.md'), 'utf8'));
  assert.equal(streamfusion.state, 'ready');
  if (streamfusion.state !== 'ready') return;
  const layers = orderProjectMapLayers(streamfusion.map);
  const streamLayer = (id) => streamfusion.map.nodes.find((node) => node.id === id)?.layer;
  assert.ok(layers.indexOf(streamLayer('sf-web')) < layers.indexOf(streamLayer('sf-api')));
  assert.ok(layers.indexOf(streamLayer('sf-api')) < layers.indexOf(streamLayer('sf-mysql')));
  assert.ok(!layers.includes('横切能力'));
  assert.ok(!layers.includes('运行与构建环境'));
  assert.deepEqual(streamfusion.map.edges.filter((edge) => edge.from === 'sf-agent' && edge.to === 'sf-runtime').map((edge) => edge.status), ['planned']);
  assert.deepEqual(streamfusion.map.edges.filter((edge) => edge.from === 'sf-runtime' && edge.to === 'sf-agent').map((edge) => edge.status), ['planned']);

  const salary = parseProjectMap(await readFile(resolve(import.meta.dirname, '../../../../docs/project-atlas/salary-architecture.md'), 'utf8'));
  assert.equal(salary.state, 'ready');
  if (salary.state !== 'ready') return;
  const salaryLayers = orderProjectMapLayers(salary.map);
  const salaryLayer = (id) => salary.map.nodes.find((node) => node.id === id)?.layer;
  assert.ok(salaryLayers.indexOf(salaryLayer('salary-feishu')) < salaryLayers.indexOf(salaryLayer('salary-win-host')));
  assert.ok(salaryLayers.indexOf(salaryLayer('salary-ui')) < salaryLayers.indexOf(salaryLayer('salary-android-host')));
  assert.ok(salaryLayers.indexOf(salaryLayer('salary-win-host')) < salaryLayers.indexOf(salaryLayer('salary-win-data')));
  assert.ok(salaryLayers.indexOf(salaryLayer('salary-android-host')) < salaryLayers.indexOf(salaryLayer('salary-android-data')));
  assert.ok(!salaryLayers.includes('横切能力'));
  assert.ok(!salaryLayers.includes('运行与构建环境'));
});
