export type Payload = { source: string; type: string; paneId: string; line: number; ts: number };
export type Health = { pid: number; port: number; clients: number; diagrams: number; last: string | null };
export async function postDiagram(port: number, payload: Payload): Promise<{ id: number; clients: number }> {
  const response = await fetch(`http://127.0.0.1:${port}/diagram`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) throw new Error(`POST /diagram: ${response.status}`);
  return response.json();
}
export async function health(port: number): Promise<Health | undefined> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) });
    return response.ok ? await response.json() : undefined;
  } catch { return undefined; }
}
