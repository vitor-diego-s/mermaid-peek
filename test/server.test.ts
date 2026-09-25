import { request } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../src/server.ts';
import { health, postDiagram } from '../src/client.ts';
function withHost(url: string, host: string): Promise<{ status: number | undefined; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { Host: host } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('error', reject);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (error) { reject(error); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}
test('HTTP and SSE smoke with clean shutdown', async () => {
  const daemon = await startServer({ port: 0, log: () => {} });
  const base = `http://127.0.0.1:${daemon.port}`;
  try {
    assert.deepEqual(await postDiagram(daemon.port, { source: 'graph TD\nA --> B', type: 'graph', paneId: '%1', line: 3, ts: 123 }), { id: 1, clients: 0 });
    const status = await health(daemon.port);
    assert.equal(status?.diagrams, 1);
    assert.equal(status?.port, daemon.port);
    const diagrams = await (await fetch(`${base}/diagrams`)).json();
    assert.equal(diagrams[0].id, 1);
    assert.equal(diagrams[0].receivedAt, status?.last);
    const response = await fetch(`${base}/events`, { signal: AbortSignal.timeout(3000) });
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.match(first, /^event: history\ndata: /);
    assert.deepEqual(JSON.parse(first.split('\n')[1].slice(6)), diagrams);
    await postDiagram(daemon.port, { source: 'graph LR\nB --> C', type: 'graph', paneId: '%1', line: 4, ts: 124 });
    assert.match(new TextDecoder().decode((await reader.read()).value), /^event: diagram\ndata: /);
    await reader.cancel();
    for (const source of ['', 42, 'a'.repeat(200 * 1024 + 1)]) {
      assert.equal((await fetch(`${base}/diagram`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source }) })).status, 400);
    }
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    for (const host of ['evil.example', '127.0.0.1', 'localhost:1']) {
      const response = await withHost(`${base}/health`, host);
      assert.equal(response.status, 403);
      assert.deepEqual(response.body, { error: 'Forbidden host' });
    }
    const localhost = await withHost(`${base}/health`, `localhost:${daemon.port}`);
    assert.equal(localhost.status, 200);
    assert.equal(localhost.body.port, daemon.port);
    for (const contentType of ['', 'text/plain']) {
      const response = await fetch(`${base}/diagram`, { method: 'POST', headers: { 'Content-Type': contentType }, body: '{"source":"graph TD"}' });
      assert.equal(response.status, 415);
      assert.match((await response.json()).error, /Content-Type/);
    }
    assert.equal((await fetch(`${base}/diagram`, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: '{"source":"graph TD"}' })).status, 200);
  } finally { await daemon.close(); }
  assert.equal(await health(daemon.port), undefined);
});
