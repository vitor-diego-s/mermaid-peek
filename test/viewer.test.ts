import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

test('history retains selection, falls back to newest and clears empty history', async () => {
  class Element {
    textContent = '';
    innerHTML = '';
    hidden = false;
    style = {};
    children: Element[] = [];
    onclick = () => {};
    replaceChildren() { this.children = []; this.innerHTML = ''; }
    append(...children: Element[]) { this.children.push(...children); }
    setAttribute() {}
    querySelector() { return null; }
    addEventListener() {}
  }
  const elements = new Map<string, Element>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  const handlers = new Map<string, (event: { data: string }) => void>();
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  let finishRender: ((value: { svg: string }) => void) | undefined;
  const context = {
    document: { querySelector: element, createElement: () => new Element() },
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    mermaid: { initialize() {}, render: () => new Promise(resolve => { finishRender = resolve; }) },
    EventSource: class { addEventListener(name: string, fn: (event: { data: string }) => void) { handlers.set(name, fn); } },
  };
  runInNewContext(script, context);
  const send = (diagrams: { id: number; type: string }[]) => handlers.get('history')!({ data: JSON.stringify(diagrams) });
  const a = { id: 1, type: 'first' }, b = { id: 2, type: 'second' };
  send([a, b]);
  assert.match(element('#meta').textContent, /^second/);
  element('#history').children[1].onclick();
  send([a, b]);
  assert.match(element('#meta').textContent, /^first/);
  send([b]);
  assert.match(element('#meta').textContent, /^second/);
  await Promise.resolve();
  send([]);
  assert.equal(element('#history').children.length, 0);
  assert.equal(element('#meta').textContent, 'Waiting for a diagram');
  assert.equal(element('#drawing').innerHTML, '');
  assert.equal(element('#errors').hidden, true);
  finishRender?.({ svg: '<svg>stale</svg>' });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(element('#drawing').innerHTML, '');
});
