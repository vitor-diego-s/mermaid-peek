export const DIAGRAM_KEYWORDS: readonly string[] = [
  'flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'classDiagram-v2', 'stateDiagram',
  'stateDiagram-v2', 'erDiagram', 'gantt', 'pie', 'mindmap', 'timeline',
  'gitGraph', 'journey', 'quadrantChart', 'xychart-beta', 'sankey-beta',
  'block-beta', 'architecture-beta', 'requirementDiagram', 'C4Context',
  'C4Container', 'C4Component', 'C4Dynamic', 'C4Deployment', 'zenuml',
  'packet-beta', 'kanban', 'radar-beta', 'treemap-beta',
];
export type Block = { type: string; startLine: number; endLine: number; source: string };
function split(line: string) {
  const prefix = line.match(/^\s*(?:[│┃⎿⏺>|](?:\s+|$))?\s*/u)![0];
  return { column: /[│┃>|]/u.test(prefix), gutter: /[│┃⎿⏺>|]/u.test(prefix), width: prefix.length, content: line.slice(prefix.length).trim() };
}
function anchor(content: string): string | undefined {
  const [type, ...args] = content.replace(/;$/, '').split(/\s+/);
  if (!DIAGRAM_KEYWORDS.includes(type) || args.length > 2 ||
      args.some(arg => !/^[A-Za-z0-9:-]+$/.test(arg))) return;
  if (['graph', 'flowchart'].includes(type) && !/^(TB|TD|BT|RL|LR)$/.test(args[0] ?? '')) return;
  return type;
}
function statement(content: string): boolean {
  return !content.endsWith('.') && (
    /--|==|~~~|\.\.|->|-x|-\)|:|\[|\(|\{/.test(content) ||
    /^(?:(?:subgraph|end|participant|actor|note|loop|alt|else|opt|par|critical|break|rect|state|class|click|style|classDef|linkStyle|direction|section|title|activate|deactivate|autonumber|dateFormat|axisFormat|excludes|todayMarker|accTitle|accDescr)\b|%%|\[\*\])/.test(content));
}
export function findBlocks(lines: string[]): Block[] {
  const parsed = lines.map(split);
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i++) {
    const { width, content } = parsed[i];
    const type = anchor(content);
    if (!type) continue;
    let start = i;
    while (start > 0 && parsed[start - 1].width === width && parsed[start - 1].content.startsWith('%%')) start--;
    if (start > 1 && parsed[start - 1].content === '---' && parsed[start - 1].width === width) {
      let j = start - 2;
      while (j >= 0 && parsed[j].width === width && parsed[j].content && parsed[j].content !== '---') j--;
      if (j >= 0 && j < start - 2 && parsed[j].width === width && parsed[j].content === '---') start = j;
    }
    const fenced = start > 0 && /^```mermaid(?:\s.*)?$/.test(parsed[start - 1].content);
    let end = i;
    let flat = true;
    const tableLine = (index: number) => !parsed[i].gutter && /^\s*[\u2500-\u257f|]/u.test(lines[index]);
    for (let j = i + 1; j < lines.length; j++) {
      const part = parsed[j];
      if (tableLine(j)) break;
      if (part.content === '```' || part.content === 'mermaid') break;
      if (!part.content || /^[│┃⎿⏺>|]$/.test(part.content)) {
        let next = j + 1;
        while (next < lines.length && !parsed[next].content && !tableLine(next)) next++;
        if (next === lines.length || tableLine(next) || parsed[next].width < width ||
            (!fenced && parsed[next].width === width &&
              (width === 0 || parsed[i].gutter || !flat || !statement(parsed[next].content))) ||
            (parsed[i].column && !parsed[next].gutter) ||
            ['```', 'mermaid'].includes(parsed[next].content)) break;
        continue;
      }
      if (part.width < width || (parsed[i].column && !part.gutter)) break;
      flat &&= part.width === width;
      end = j;
    }
    if (end === i) continue;
    const source: string[] = [];
    for (let j = start; j <= end; j++) {
      const part = parsed[j];
      const previous = source.at(-1) ?? '';
      const unbalanced = ['[]', '()'].some(pair =>
        previous.split(pair[0]).length > previous.split(pair[1]).length) ||
        (previous.match(/"/g)?.length ?? 0) % 2 === 1;
      if (j > i && part.content && unbalanced) source[source.length - 1] += ' ' + part.content;
      else source.push(part.content ? ' '.repeat(Math.max(0, part.width - width)) + part.content : '');
    }
    blocks.push({ type, startLine: start, endLine: end, source: source.join('\n') });
    i = end;
  }
  return blocks;
}
export function pickBlock(blocks: Block[], line: number, maxDistance = 5): Block | undefined {
  let best: Block | undefined;
  let distance = Infinity;
  for (const block of blocks) {
    const d = Math.max(block.startLine - line, line - block.endLine, 0);
    if (d <= maxDistance && d < distance) { best = block; distance = d; }
  }
  return best;
}
export function latestBlock(blocks: Block[]): Block | undefined { return blocks.at(-1); }
