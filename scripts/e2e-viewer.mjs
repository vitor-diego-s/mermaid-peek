// e2e: drive a headless Chromium over the DevTools protocol, wait for the rendered SVG, screenshot.
// Usage: node scripts/e2e-viewer.mjs http://127.0.0.1:41999/ out.png   (Chromium must listen on --remote-debugging-port=9333)
const [,, base, out] = process.argv;
const dbg = 'http://127.0.0.1:9333';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let tab;
for (let i = 0; i < 50 && !tab; i++) { try { tab = await (await fetch(`${dbg}/json/new?${base}`, { method: 'PUT' })).json(); } catch { await sleep(200); } }
if (!tab) { console.log('no debug target'); process.exit(1); }
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pending = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise(r => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evalJs = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
let state;
for (let i = 0; i < 40; i++) {
  state = await evalJs(`JSON.stringify({svg: !!document.querySelector('#drawing svg'), nodes: document.querySelectorAll('#drawing svg .node').length, edges: document.querySelectorAll('#drawing svg .edgePath, #drawing svg path.flowchart-link').length, meta: document.querySelector('#meta').textContent, errorsHidden: document.querySelector('#errors').hidden, history: document.querySelectorAll('#history button').length, title: document.title})`);
  if (state && JSON.parse(state).svg) break;
  await sleep(250);
}
console.log('viewer state:', state);
const shot = await send('Page.captureScreenshot', { format: 'png' });
await import('node:fs').then(fs => fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64')));
ws.close(); process.exit(0);
