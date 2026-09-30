export type ProjectMapStatus = 'implemented' | 'planned';

export type ProjectMapNode = {
  id: string;
  label: string;
  layer: string;
  summary: string;
  status: ProjectMapStatus;
  technology?: string[];
  source?: string;
};

export type ProjectMapEdge = {
  from: string;
  to: string;
  label: string;
  status?: ProjectMapStatus;
};

export type ProjectMap = { version: 1; nodes: ProjectMapNode[]; edges: ProjectMapEdge[] };
export type ProjectMapParseResult =
  | { state: 'missing' }
  | { state: 'invalid'; reason: string }
  | { state: 'ready'; map: ProjectMap };

const fence = /^[ \t]*```forgeflow-map[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
const idPattern = /^[\p{L}\p{N}][\p{L}\p{N}._:-]*$/u;
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const bounded = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const onlyKeys = (value: Record<string, unknown>, allowed: string[]) =>
  Object.keys(value).every((key) => allowed.includes(key));
const status = (value: unknown): value is ProjectMapStatus => value === 'implemented' || value === 'planned';

/** Parse only a declared, versioned architecture map. Never infer connections from prose or names. */
export function parseProjectMap(markdown: string | null | undefined): ProjectMapParseResult {
  if (!markdown) return { state: 'missing' };
  const blocks = [...markdown.matchAll(fence)];
  if (!blocks.length) return /^[ \t]*```forgeflow-map\b/m.test(markdown)
    ? { state: 'invalid', reason: 'forgeflow-map 代码块未正确闭合。' }
    : { state: 'missing' };
  if (blocks.length !== 1) return { state: 'invalid', reason: '架构文档只能包含一个 forgeflow-map 图谱块。' };
  const json = blocks[0]?.[1] ?? '';
  if (json.length > 100_000) return { state: 'invalid', reason: '图谱内容过大。' };

  let value: unknown;
  try { value = JSON.parse(json); }
  catch { return { state: 'invalid', reason: 'forgeflow-map 不是有效的 JSON。' }; }
  if (!record(value) || !onlyKeys(value, ['version', 'nodes', 'edges']) || value.version !== 1) {
    return { state: 'invalid', reason: '图谱需要 version: 1、nodes 和 edges。' };
  }
  if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)
    || value.nodes.length < 1 || value.nodes.length > 80 || value.edges.length > 200) {
    return { state: 'invalid', reason: '图谱需要 1–80 个节点和最多 200 条连线。' };
  }

  const ids = new Set<string>();
  const nodes: ProjectMapNode[] = [];
  for (const [index, item] of value.nodes.entries()) {
    if (!record(item) || !onlyKeys(item, ['id', 'label', 'layer', 'summary', 'status', 'technology', 'source'])
      || !bounded(item.id, 64) || !idPattern.test(item.id) || ids.has(item.id)
      || !bounded(item.label, 80) || !bounded(item.layer, 60) || !bounded(item.summary, 500)
      || !status(item.status)
      || (item.source !== undefined && !bounded(item.source, 300))
      || (item.technology !== undefined && (!Array.isArray(item.technology) || item.technology.length > 16
        || !item.technology.every((entry: unknown) => bounded(entry, 80))))) {
      return { state: 'invalid', reason: `第 ${index + 1} 个节点字段无效或 ID 重复。` };
    }
    ids.add(item.id);
    nodes.push(item as ProjectMapNode);
  }

  const edges: ProjectMapEdge[] = [];
  for (const [index, item] of value.edges.entries()) {
    if (!record(item) || !onlyKeys(item, ['from', 'to', 'label', 'status'])
      || !bounded(item.from, 64) || !bounded(item.to, 64) || !bounded(item.label, 100)
      || !ids.has(item.from) || !ids.has(item.to)
      || (item.status !== undefined && !status(item.status))) {
      return { state: 'invalid', reason: `第 ${index + 1} 条连线字段无效，或指向不存在的节点。` };
    }
    edges.push(item as ProjectMapEdge);
  }
  return { state: 'ready', map: { version: 1, nodes, edges } };
}
