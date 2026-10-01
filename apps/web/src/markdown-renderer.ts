import MarkdownIt from 'markdown-it';

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });

// Keep user-authored HTML inert. Markdown links still pass markdown-it's URL
// validation; external links open outside the desktop application.
markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  const token = tokens[index]!;
  const href = token.attrGet('href') ?? '';
  if (/^https?:\/\//i.test(href)) {
    token.attrSet('target', '_blank');
    token.attrSet('rel', 'noopener noreferrer');
  }
  return self.renderToken(tokens, index, options);
};
markdown.renderer.rules.table_open = () => '<div class="markdown-table-wrap archive-table" role="region" aria-label="Markdown 表格" tabindex="0"><table>\n';
markdown.renderer.rules.table_close = () => '</table></div>\n';
markdown.renderer.rules.heading_open = (tokens, index, options, env, self) => {
  if (env.headingIds) {
    env.headingIndex = (env.headingIndex ?? 0) + 1;
    tokens[index]!.attrSet('id', `design-section-${env.headingIndex}`);
  }
  return self.renderToken(tokens, index, options);
};

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim());
}

function isSeparator(line: string, count: number): boolean {
  if (!line.includes('|')) return false;
  const parts = cells(line);
  return parts.length === count && parts.every((part) => /^:?-{3,}:?$/.test(part));
}

/**
 * Some saved AI documents separate every table line with a blank line. GFM
 * requires the header and separator to be adjacent, so repair only complete
 * pipe-delimited tables before passing the text to the Markdown parser.
 */
export function normalizeMarkdownTables(content: string): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let index = 0;
  let fence: { marker: string; length: number } | null = null;
  while (index < lines.length) {
    const header = lines[index]!;
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(header);
    if (fence) {
      if (fenceMatch && fenceMatch[1]![0] === fence.marker && fenceMatch[1]!.length >= fence.length
        && !header.slice(fenceMatch[0].length).trim()) fence = null;
      output.push(header);
      index += 1;
      continue;
    }
    if (fenceMatch) {
      fence = { marker: fenceMatch[1]![0]!, length: fenceMatch[1]!.length };
      output.push(header);
      index += 1;
      continue;
    }
    if (!header.includes('|') || /^(?: {4,}|\t)/.test(header)) {
      output.push(header);
      index += 1;
      continue;
    }
    let separatorIndex = index + 1;
    while (separatorIndex < lines.length && !lines[separatorIndex]!.trim()) separatorIndex += 1;
    const columnCount = cells(header).length;
    if (columnCount < 2 || !isSeparator(lines[separatorIndex] ?? '', columnCount)) {
      output.push(header);
      index += 1;
      continue;
    }
    output.push(header, lines[separatorIndex]!);
    index = separatorIndex + 1;
    while (index < lines.length) {
      let rowIndex = index;
      while (rowIndex < lines.length && !lines[rowIndex]!.trim()) rowIndex += 1;
      const row = lines[rowIndex] ?? '';
      // Across a blank line, require explicit outer pipes so normal prose
      // containing a vertical bar cannot accidentally join the table.
      if (!row.includes('|') || (rowIndex > index && !/^\s*\|.*\|\s*$/.test(row))) break;
      output.push(row);
      index = rowIndex + 1;
    }
  }
  return output.join('\n');
}

export function renderMarkdown(content: string, options: { headingIds?: boolean } = {}): string {
  return markdown.render(normalizeMarkdownTables(content), { headingIndex: 0, headingIds: options.headingIds ?? false });
}
