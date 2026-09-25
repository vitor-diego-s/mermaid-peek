import { execFile } from 'node:child_process';
export function alignWrapped(raw: string[], joined: string[]): number[] {
  const map: number[] = [];
  let j = 0, remaining = joined[0] ?? '';
  const matches = (part: string, text: string) => part
    ? text.trimStart().startsWith(part.trimStart())
    : text === '' || /^\s/.test(text);
  for (const line of raw) {
    const part = line.trimEnd();
    if (j < joined.length && !matches(part, remaining)) {
      const next = joined.findIndex((text, index) => index > j && matches(part, text));
      if (next >= 0) { j = next; remaining = joined[j]; }
      else {
        // This row changed between captures; let later rows try to resynchronize.
        map.push(j++);
        remaining = joined[j] ?? '';
        continue;
      }
    }
    map.push(j);
    if (part) remaining = remaining.trimStart().slice(part.trimStart().length);
    // An all-space wrapped row consumes no text from the joined line.
    if (!remaining.trim()) { j++; remaining = joined[j] ?? ''; }
  }
  return map;
}

export function reanchor(raw: string[], index: number, mouseLine: string): number {
  if (!mouseLine.trim()) return index;
  for (let distance = 0; distance <= 200; distance++) {
    for (const candidate of distance ? [index - distance, index + distance] : [index]) {
      if (raw[candidate]?.trimEnd() === mouseLine.trimEnd()) return candidate;
    }
  }
  return index;
}
export function absoluteLine(historySize: number, scrollPosition: number, mouseY: number): number {
  return historySize - scrollPosition + mouseY;
}
export async function capturePane(paneId: string): Promise<{ raw: string[]; joined: string[]; map: number[] }> {
  const capture = async (extra: string[]) => {
    const output = await new Promise<string>((resolve, reject) => {
      execFile('tmux', ['capture-pane', '-p', '-t', paneId, '-S', '-', '-E', '-', ...extra],
        { maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    const lines = output.split('\n');
    if (output.endsWith('\n')) lines.pop();
    return lines;
  };
  const raw = await capture([]);
  const joined = await capture(['-J']);
  return { raw, joined, map: alignWrapped(raw, joined) };
}
