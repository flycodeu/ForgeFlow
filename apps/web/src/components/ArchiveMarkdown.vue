<script lang="ts">
import { computed, defineComponent, h, type VNodeChild } from 'vue';

function inline(text: string): VNodeChild[] {
  const parts: VNodeChild[] = [];
  const tokens = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g;
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    const value = match[0];
    parts.push(text.slice(offset, match.index));
    if (value.startsWith('`')) parts.push(h('code', value.slice(1, -1)));
    else if (value.startsWith('**')) parts.push(h('strong', value.slice(2, -2)));
    else {
      const link = /^\[([^\]]+)\]\((.+)\)$/.exec(value)!;
      parts.push(h('a', { href: link[2], target: '_blank', rel: 'noopener noreferrer' }, link[1]));
    }
    offset = (match.index ?? 0) + value.length;
  }
  parts.push(text.slice(offset));
  return parts;
}

function cells(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function render(content: string): VNodeChild[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const nodes: VNodeChild[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!line.trim()) continue;
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      while (++index < lines.length && !/^\s*```/.test(lines[index]!)) code.push(lines[index]!);
      nodes.push(h('pre', [h('code', code.join('\n'))]));
      continue;
    }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) { nodes.push(h(`h${heading[1]!.length}`, inline(heading[2]!))); continue; }
    if (line.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? '') && cells(lines[index + 1]!).every((cell) => /^:?-{3,}:?$/.test(cell))) {
      const headers = cells(line);
      const rows: VNodeChild[] = [];
      index += 2;
      while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim()) {
        const values = cells(lines[index]!);
        rows.push(h('tr', headers.map((_, column) => h('td', inline(values[column] ?? '')))));
        index += 1;
      }
      index -= 1;
      nodes.push(h('div', { class: 'archive-table' }, [h('table', [h('thead', [h('tr', headers.map((header) => h('th', inline(header))))]), h('tbody', rows)])]));
      continue;
    }
    if (/^\s*([-*+] |\d+\. )/.test(line)) {
      const ordered = /^\s*\d+\. /.test(line);
      const items: VNodeChild[] = [];
      while (index < lines.length && (ordered ? /^\s*\d+\. / : /^\s*[-*+] /).test(lines[index]!)) {
        items.push(h('li', inline(lines[index]!.replace(/^\s*(?:[-*+]|\d+\.)\s+/, ''))));
        index += 1;
      }
      index -= 1;
      nodes.push(h(ordered ? 'ol' : 'ul', items));
      continue;
    }
    if (/^>/.test(line)) { nodes.push(h('blockquote', inline(line.replace(/^>\s?/, '')))); continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { nodes.push(h('hr')); continue; }
    nodes.push(h('p', inline(line)));
  }
  return nodes;
}

export default defineComponent({
  props: { content: { type: String, required: true } },
  setup(props) {
    const nodes = computed(() => render(props.content));
    return () => h('div', { class: 'archive-markdown' }, nodes.value);
  },
});
</script>

<style scoped>
.archive-markdown { color: var(--ink-secondary); font-size: 14px; line-height: 1.75; overflow-wrap: anywhere; }
.archive-markdown :deep(h1), .archive-markdown :deep(h2), .archive-markdown :deep(h3) { color: var(--ink); line-height: 1.4; margin: 1.5em 0 .65em; }
.archive-markdown :deep(h1) { font-size: 24px; }
.archive-markdown :deep(h2) { font-size: 20px; }
.archive-markdown :deep(h3) { font-size: 16px; }
.archive-markdown :deep(> :first-child) { margin-top: 0; }
.archive-markdown :deep(p) { margin: 0 0 .7em; white-space: pre-wrap; }
.archive-markdown :deep(a) { color: var(--primary); text-decoration: underline; }
.archive-markdown :deep(code) { font-family: var(--mono); font-size: .9em; background: var(--surface-subtle); padding: 1px 4px; border-radius: 3px; }
.archive-markdown :deep(pre) { overflow-x: auto; max-width: 100%; background: var(--surface-subtle); padding: 14px; border-radius: 5px; }
.archive-markdown :deep(pre code) { padding: 0; background: none; }
.archive-markdown :deep(blockquote) { margin: 12px 0; padding: 4px 14px; border-left: 3px solid var(--primary-border); color: var(--muted); }
.archive-markdown :deep(.archive-table) { overflow-x: auto; margin: 16px 0; }
.archive-markdown :deep(table) { border-collapse: collapse; width: 100%; font-size: 13px; }
.archive-markdown :deep(th), .archive-markdown :deep(td) { border: 1px solid var(--line); padding: 8px 10px; text-align: left; min-width: 100px; vertical-align: top; }
.archive-markdown :deep(th) { background: var(--surface-subtle); color: var(--ink); font-weight: 600; }
.archive-markdown :deep(hr) { border: 0; border-top: 1px solid var(--line); margin: 20px 0; }
</style>
