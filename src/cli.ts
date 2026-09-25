import { execFile, spawn } from 'node:child_process';
import { appendFile, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absoluteLine, capturePane, reanchor } from './capture.ts';
import { findBlocks, latestBlock, pickBlock } from './extract.ts';
import { health, postDiagram } from './client.ts';
import { startServer } from './server.ts';
const [command, ...args] = process.argv.slice(2);
const quiet = command === 'click' || command === 'latest';
const state = join(homedir(), '.local/state/mermaid-peek');
const profile = join(homedir(), '.local/share/mermaid-peek/firefox-profile');
const logPath = join(state, 'daemon.log');
const stamp = join(state, 'viewer-launched');
let port = Number(process.env.MERMAID_PEEK_PORT ?? 41999);
async function log(message: string) {
  await mkdir(state, { recursive: true });
  await appendFile(logPath, `${new Date().toISOString()} ${message}\n`);
}
function launch(cmd: string, argv: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}
async function ensureDaemon() {
  let status = await health(port);
  if (status) return status;
  await launch(process.execPath, ['--experimental-strip-types', '--no-warnings', fileURLToPath(import.meta.url), 'serve', '--port', String(port)]);
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
    status = await health(port);
    if (status) return status;
  }
  throw new Error('Daemon did not start within 3 seconds');
}
async function openViewer() {
  let last = 0;
  try { last = Number(await readFile(stamp, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (Date.now() - last < 10000) return;
  await mkdir(state, { recursive: true });
  await writeFile(stamp, String(Date.now()));
  await mkdir(profile, { recursive: true });
  const prefs = {
    'browser.shell.checkDefaultBrowser': false,
    'browser.startup.homepage_override.mstone': 'ignore',
    'browser.aboutwelcome.enabled': false,
    'datareporting.policy.dataSubmissionPolicyBypassNotification': true,
    'browser.sessionstore.resume_from_crash': false,
    'browser.startup.page': 0,
    'browser.startup.couldRestoreSession.count': -1,
    'browser.tabs.warnOnClose': false,
    'browser.aboutConfig.showWarning': false,
    'toolkit.telemetry.reportingpolicy.firstRun': false,
  };
  const prefsPath = join(profile, 'user.js');
  let existing = '';
  try { existing = await readFile(prefsPath, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const keys = new Set([...existing.matchAll(/^\s*user_pref\(\s*['"]([^'"]+)['"]\s*,/gm)].map(match => match[1]));
  const missing = Object.entries(prefs).filter(([key]) => !keys.has(key))
    .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`);
  if (missing.length) await appendFile(prefsPath, (existing && !existing.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');
  const browser = process.env.MERMAID_PEEK_BROWSER?.trim().split(/\s+/) ?? ['firefox', '--profile', profile, '--new-window'];
  await launch(browser[0], [...browser.slice(1), `http://127.0.0.1:${port}/`]);
}
async function ensureViewer() {
  const status = await health(port);
  if (status?.clients === 0) await openViewer();
}
async function toast(paneId: string, message: string) {
  await new Promise<void>((resolve, reject) => execFile('tmux', ['display-message', '-t', paneId, '-d', '2500', message], error => error ? reject(error) : resolve()));
}
function usage(): never {
  console.error('Usage: mermaid-peek click <paneId> <mouseY> <scrollPosition> <historySize> <paneWidth> <mouseLine> | latest <paneId> <paneWidth> | extract | serve [--port N] | open | status | install-tmux');
  process.exit(2);
}
async function main() {
  if (command === 'serve' && args.length) {
    if (args.length !== 2 || args[0] !== '--port') usage();
    port = Number(args[1]);
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port');
  if (quiet) {
    if ((command === 'click' ? ![5, 6].includes(args.length) : args.length !== 2)) throw new Error('Invalid trigger arguments');
    const paneId = args[0];
    const values = args.slice(1, command === 'click' ? 5 : 2).map(Number);
    if (values.some(n => !Number.isInteger(n) || n < 0) || values.at(-1) === 0) throw new Error('Invalid pane coordinates');
    const capture = await capturePane(paneId);
    const rawLine = command === 'click' ? reanchor(capture.raw, absoluteLine(values[2], values[1], values[0]), args[5] ?? '') : capture.raw.length - 1;
    const line = capture.map[rawLine] ?? -1;
    const blocks = findBlocks(capture.joined);
    const block = command === 'latest' ? latestBlock(blocks) : pickBlock(blocks, line < 0 ? -Infinity : line);
    if (!block) { await toast(paneId, `mermaid-peek: no diagram near line ${line + 1}`); return; }
    await ensureDaemon();
    const posted = await postDiagram(port, { source: block.source, type: block.type, paneId, line, ts: Date.now() });
    await ensureViewer();
    await toast(paneId, `mermaid-peek: ${block.type}, ${block.source.split('\n').length} lines, line ${line + 1} → ${posted.clients > 0 ? 'viewer' : 'daemon (opening viewer)'}`);
  } else if (command === 'extract') {
    process.stdin.setEncoding('utf8');
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    console.log(JSON.stringify(findBlocks(input.split('\n')), null, 2));
  } else if (command === 'serve') {
    const pending = new Set<Promise<void>>();
    const daemon = await startServer({ port, log: message => {
      console.error(message);
      const task = log(message).catch(error => console.error(String(error)));
      pending.add(task); void task.finally(() => pending.delete(task));
    } });
    await mkdir(state, { recursive: true });
    await writeFile(join(state, 'daemon.pid'), String(process.pid));
    const stop = async () => { await daemon.close(); await unlink(join(state, 'daemon.pid')); await Promise.all(pending); };
    process.once('SIGINT', () => { void stop(); });
    process.once('SIGTERM', () => { void stop(); });
  } else if (command === 'open') { await ensureDaemon(); await openViewer(); }
  else if (command === 'status') {
    console.log(JSON.stringify(await health(port)) ?? 'daemon: not running');
    console.log(`port: ${port}\nprofile: ${profile}\nlog: ${logPath}`);
  } else if (command === 'install-tmux') {
    const bin = fileURLToPath(new URL('../bin/mermaid-peek', import.meta.url));
    console.log(`bind -n M-MouseDown1Pane run-shell -b "${bin} click '#{pane_id}' '#{mouse_y}' '#{scroll_position}' '#{history_size}' '#{pane_width}' #{?mouse_line,#{q:mouse_line},''}"`);
    console.log(`bind g run-shell -b "${bin} latest '#{pane_id}' '#{pane_width}'"`);
  } else usage();
}
main().catch(async error => {
  if (!quiet) console.error(String(error));
  try { await log(String(error)); } catch { /* Trigger commands must remain silent. */ }
  if (quiet && args[0]) { try { await toast(args[0], `mermaid-peek: ${String(error)}`); } catch {} }
  process.exitCode = quiet ? 0 : 1;
});
