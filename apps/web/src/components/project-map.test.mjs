import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseProjectMap } from './project-map.ts';

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
    assert.ok(result.map.edges.every((edge) => edge.status === 'implemented' || edge.status === 'planned'));
  }
});
