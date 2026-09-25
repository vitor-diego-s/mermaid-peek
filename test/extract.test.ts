import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { findBlocks, pickBlock, latestBlock } from '../src/extract.ts';
import { alignWrapped, reanchor, absoluteLine } from '../src/capture.ts';
const dir = new URL('./fixtures/', import.meta.url);
for (const file of readdirSync(dir).filter(file => file.endsWith('.txt'))) {
  const expected = new URL(file.replace(/\.txt$/, '.expected.mmd'), dir);
  if (!existsSync(expected)) continue;
  test(file, () => {
    const lines = readFileSync(new URL(file, dir), 'utf8').split('\n');
    const blocks = findBlocks(lines);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].source, readFileSync(expected, 'utf8').replace(/\n$/, ''));
    if (file === 'claude-code-tui.txt') {
      assert.equal(blocks[0].startLine, lines.findIndex(line => line.trim() === 'flowchart LR'));
      assert.equal(blocks[0].endLine, lines.findIndex(line => line.trim() === 'SA -. token 600s .-> LK'));
    }
  });
}
test('two blocks and proximity', () => {
  const blocks = findBlocks(readFileSync(new URL('two-blocks.txt', dir), 'utf8').split('\n'));
  assert.deepEqual(blocks.map(b => [b.type, b.startLine, b.endLine]), [['graph', 3, 5], ['erDiagram', 15, 17]]);
  assert.equal(pickBlock(blocks, 10, 3), undefined);
  assert.equal(pickBlock(blocks, 16), blocks[1]);
  assert.equal(pickBlock(blocks, 6), blocks[0]);
  assert.equal(latestBlock(blocks), blocks[1]);
});
test('raw rows align to tmux joined lines', () => {
  assert.deepEqual(alignWrapped(['hello', 'world'], ['hello world']), [0, 0]);
  assert.deepEqual(alignWrapped(['xxxxxxxxxx', '    flowchart LR'], ['xxxxxxxxxx', '    flowchart LR']), [0, 1]);
  assert.deepEqual(alignWrapped(['你好', '世界', ''], ['你好世界', '']), [0, 0, 1]);
  assert.deepEqual(alignWrapped(['hello ', 'world', 'changed', 'tail'], ['hello world', 'different', 'tail']), [0, 0, 1, 2]);
  assert.deepEqual(alignWrapped([], []), []);
});
test('reanchor finds the nearest matching row within 200 rows', () => {
  assert.equal(reanchor(['target', 'x', 'target  '], 3, 'target'), 2);
  assert.equal(reanchor([' target', 'target'], 0, 'target'), 1);
  assert.equal(reanchor(['x', ''], 0, '  '), 0);
  assert.equal(reanchor(['x'], 0, 'missing'), 0);
  assert.equal(reanchor(['target', ...Array(201).fill('x')], 201, 'target'), 201);
  assert.equal(reanchor(['target', ...Array(200).fill('x')], 200, 'target'), 0);
});
test('absolute line', () => {
  assert.equal(absoluteLine(100, 0, 4), 104);
  assert.equal(absoluteLine(100, 30, 4), 74);
});
test('fenced blanks, dedent and argument limits', () => {
  assert.equal(findBlocks(['```mermaid', '  pie showData', '    "A": 2', '', '    "B": 3', '```'])[0].source, 'pie showData\n  "A": 2\n\n  "B": 3');
  assert.deepEqual(findBlocks(['graph', 'body', '', 'sequenceDiagram but neither starts a block', 'body']), []);
  assert.equal(findBlocks(['  graph TD', '    A --> B', 'prose'])[0].endLine, 1);
});

test('unfenced blanks respect anchor indentation and terminators', () => {
  assert.equal(findBlocks(['graph TD', '  A', '', '  B', '', 'prose'])[0].source, 'graph TD\n  A\n\n  B');
  assert.equal(findBlocks(['graph TD', 'A', '', 'B'])[0].source, 'graph TD\nA');
  for (const ending of ['```', 'mermaid', 'prose']) {
    assert.equal(findBlocks(['  graph TD', '  A', '', ending])[0].endLine, 1);
  }
  assert.equal(findBlocks(['│ graph TD', '┃ A', '│', '┃', '│   B', '  prose'])[0].source, 'graph TD\nA\n\n\n  B');
});
test('gutter blanks end before equal-width prose', () => {
  assert.equal(findBlocks(['│ graph TD', '│ A --> B', '│', '│ Fim.'])[0].source, 'graph TD\nA --> B');
});
test('anchor punctuation, whitespace and classDiagram-v2', () => {
  for (const heading of ['graph TD;', 'flowchart  LR;', 'classDiagram-v2']) {
    assert.equal(findBlocks([heading, '  A'])[0].source, heading + '\n  A');
  }
});
test('comments and directives above anchors retain the enclosing fence', () => {
  const lines = ['```mermaid', '%% comment', '%%{init: {}}%%', 'graph TD', 'A', '', 'B', '```'];
  const block = findBlocks(lines)[0];
  assert.equal(block.startLine, 1);
  assert.equal(block.source, lines.slice(1, -1).join('\n'));
});
test('gutter blocks stop at unguttered lines', () => {
  assert.equal(findBlocks(['│ graph TD', '┃ A --> B', '    prose'])[0].endLine, 1);
});
test('soft continuations merge open brackets, parentheses and quotes', () => {
  for (const [first, second] of [['A[hello', 'world]'], ['A(hello', 'world)'], ['A["hello', 'world"]']]) {
    assert.equal(findBlocks(['  graph TD', '  ' + first, '    ' + second])[0].source, 'graph TD\n' + first + ' ' + second);
  }
});

test('structural braces retain state and class body lines', () => {
  for (const [anchor, body] of [
    ['stateDiagram-v2', ['state Live {', '  [*] --> Ready', '  Ready --> [*]', '}']],
    ['classDiagram', ['class Session {', '  +start()', '  +stop()', '}']],
  ] as const) {
    const blocks = findBlocks([anchor, ...body]);
    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0].source.split('\n').slice(1), body);
  }
});
test('first-line Claude markers do not require gutters on body rows', () => {
  for (const marker of ['⎿', '⏺']) {
    const blocks = findBlocks([`  ${marker}  graph TD`, '     A --> B', '     B --> C']);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].source, 'graph TD\nA --> B\nB --> C');
  }
});
test('alignment handles all-space wraps and resynchronizes after changed rows', () => {
  const raw = ['graph TD', ' '.repeat(20), '     foo', '  foo --> bar', 'tail'];
  const joined = ['graph TD', ' '.repeat(25) + 'foo', '  foo --> bar', 'tail'];
  assert.deepEqual(alignWrapped(raw, joined), [0, 1, 1, 2, 3]);
  assert.deepEqual(alignWrapped(['head', 'foo', 'bar', 'tail'], ['head', 'inserted', 'foo', 'bar', 'tail']), [0, 2, 3, 4]);
  assert.deepEqual(alignWrapped(['changed', 'foo', 'bar'], ['old', 'inserted', 'foo', 'bar']), [0, 2, 3]);
});

test('blank continuation requires flat body and a Mermaid statement', () => {
  const flat = ['  graph TD', '  A --> B', ''];
  assert.equal(findBlocks([...flat, '  B --> C'])[0].source, 'graph TD\nA --> B\n\nB --> C');
  assert.equal(findBlocks([...flat, '  O token é renovado antes de expirar.'])[0].endLine, 1);
  const deep = ['  graph TD', '      A --> B', ''];
  for (const next of ['  Prose follows', '  B --> C', '  ┌──']) {
    assert.equal(findBlocks([...deep, next])[0].endLine, 1);
  }
});
test('raw table borders and column glyphs end whitespace-anchored bodies', () => {
  for (const line of ['  ┌──', '  ├──', '  │ Item │', '  ┃ Item', '  | Item', '  │']) {
    for (const gap of [[], ['']]) {
      assert.equal(findBlocks(['  graph TD', '      A --> B', ...gap, line, '      B --> C'])[0].endLine, 1);
    }
  }
});
