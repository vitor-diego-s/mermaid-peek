import * as http from 'node:http';
import { readFile } from 'node:fs/promises';
type Diagram = Record<string, unknown> & { id: number; receivedAt: string };
export async function startServer(opts: { port: number; host?: string; log: (msg: string) => void }):
Promise<{ server: http.Server; port: number; close(): Promise<void> }> {
  if (opts.host && opts.host !== '127.0.0.1') throw new Error('Only 127.0.0.1 is allowed');
  const diagrams: Diagram[] = [];
  const clients = new Set<http.ServerResponse>();
  let id = 0, port = opts.port;
  const json = (res: http.ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value));
  };
  const server = http.createServer(async (req, res) => {
    try {
      if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? '')) {
        json(res, 403, { error: 'Forbidden host' }); return;
      }
      if (req.method === 'GET' && ['/', '/mermaid.min.js'].includes(req.url ?? '')) {
        const html = req.url === '/';
        const data = await readFile(new URL(html ? '../web/index.html' : '../node_modules/mermaid/dist/mermaid.min.js', import.meta.url));
        res.writeHead(200, { 'Content-Type': html ? 'text/html; charset=utf-8' : 'application/javascript' });
        res.end(data);
      } else if (req.method === 'GET' && req.url === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        clients.add(res);
        res.write(`event: history\ndata: ${JSON.stringify(diagrams)}\n\n`);
        const timer = setInterval(() => res.write(': keep-alive\n\n'), 25000);
        res.on('close', () => { clearInterval(timer); clients.delete(res); });
      } else if (req.method === 'GET' && req.url === '/health') {
        json(res, 200, { pid: process.pid, port, clients: clients.size, diagrams: diagrams.length, last: diagrams.at(-1)?.receivedAt ?? null });
      } else if (req.method === 'GET' && req.url === '/diagrams') json(res, 200, diagrams);
      else if (req.method === 'POST' && req.url === '/diagram') {
        if (!req.headers['content-type']?.startsWith('application/json')) {
          json(res, 415, { error: 'Content-Type must be application/json' }); return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 2 * 1024 * 1024) { json(res, 413, { error: 'Body too large' }); return; }
          chunks.push(chunk);
        }
        let payload;
        try { payload = JSON.parse(Buffer.concat(chunks).toString()); }
        catch { json(res, 400, { error: 'Invalid JSON' }); return; }
        if (!payload || typeof payload.source !== 'string' || !payload.source.trim() || Buffer.byteLength(payload.source) > 200 * 1024) {
          json(res, 400, { error: 'source must be non-empty and at most 200 kB' }); return;
        }
        const diagram: Diagram = { ...payload, id: ++id, receivedAt: new Date().toISOString() };
        diagrams.push(diagram);
        if (diagrams.length > 20) diagrams.shift();
        for (const client of clients) client.write(`event: diagram\ndata: ${JSON.stringify(diagram)}\n\n`);
        opts.log(`diagram ${id}, ${clients.size} clients`);
        json(res, 200, { id, clients: clients.size });
      } else json(res, 404, { error: 'Not found' });
    } catch (error) {
      opts.log(String(error));
      if (!res.headersSent) json(res, 500, { error: 'Internal error' });
      else res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  port = (server.address() as { port: number }).port;
  opts.log(`listening on 127.0.0.1:${port}`);
  return { server, port, close: () => new Promise<void>((resolve, reject) => {
    for (const client of clients) client.end();
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }) };
}
