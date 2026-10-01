import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { normalizeMarkdownTables, renderMarkdown } from './markdown-renderer.ts';

test('renders GFM tables with alignment and inline Markdown', () => {
  const html = renderMarkdown('| 模块 | 说明 |\n| :--- | ---: |\n| `API` | **服务** |');
  assert.match(html, /<table>/);
  assert.match(html, /<th style="text-align:left">模块<\/th>/);
  assert.match(html, /<th style="text-align:right">说明<\/th>/);
  assert.match(html, /<td style="text-align:left"><code>API<\/code><\/td>/);
  assert.match(html, /<strong>服务<\/strong>/);
  assert.match(renderMarkdown('| 甲 | 乙 |\n|---|---|\n| A\\|B | C |'), /<td>A\|B<\/td>[\s\S]*<td>C<\/td>/);
});

test('renders saved tables containing blank lines between every row', () => {
  const sample = '| 模块 | 职责 |\n\n| --- | --- |\n\n| 采集 | 文本 |\n\n| 展示 | 看板 |\n\n后续说明。';
  const html = renderMarkdown(sample);
  assert.equal((html.match(/<tr>/g) ?? []).length, 3);
  assert.match(html, /<td>展示<\/td>/);
  assert.match(html, /<p>后续说明。<\/p>/);

  const savedArchitecture = readFileSync(new URL('../../../docs/project-atlas/salary-architecture.md', import.meta.url), 'utf8');
  assert.match(renderMarkdown(savedArchitecture), /<table>[\s\S]*Windows Collector/);
});

test('does not rewrite table-looking text inside fenced code', () => {
  const source = '```md\n| a | b |\n\n| --- | --- |\n```';
  assert.equal(normalizeMarkdownTables(source), source);
  assert.doesNotMatch(renderMarkdown(source), /<table>/);
  const indented = '    | a | b |\n\n    | --- | --- |';
  assert.equal(normalizeMarkdownTables(indented), indented);
});

test('keeps raw HTML inert and blocks unsafe link protocols', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n[run](javascript:alert(1))');
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|href="javascript:/);
});

test('wraps wide tables in a keyboard reachable scroll region', () => {
  const html = renderMarkdown('# 标题\n\n| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |', { headingIds: true });
  assert.match(html, /<h1 id="design-section-1">标题<\/h1>/);
  assert.match(html, /class="markdown-table-wrap archive-table" role="region" aria-label="Markdown 表格" tabindex="0"/);
});
