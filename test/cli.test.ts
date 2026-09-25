import { execFile } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { absoluteLine, reanchor } from '../src/capture.ts';
import { findBlocks, latestBlock, pickBlock } from '../src/extract.ts';

// Execute the CLI with in-memory I/O: no daemon, browser or user state is touched.
const url = new URL('../src/cli.ts', import.meta.url);
const code = stripTypeScriptTypes(readFileSync(url, 'utf8'))
  .replace(/^import .*;\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(url.href))
  .replace('main().catch', 'globalThis.done = main().catch');
async function cli(args: string[], options: { clients?: number; last?: number; failCapture?: boolean; failToast?: boolean; browser?: string; home?: string } = {}) {
  const files = new Map<string, string>();
  const stamp = '/virtual/.local/state/mermaid-peek/viewer-launched';
  if (options.last !== undefined) files.set(stamp, String(options.last));
  const toasts: string[] = [], output: string[] = [], launches: { cmd: string; args: string[]; stamp: string | undefined }[] = [];
  const signals = new Map<string, () => Promise<void> | void>();
  const proc = { argv: ['node', 'cli', ...args], env: { MERMAID_PEEK_BROWSER: options.browser }, execPath: 'node', pid: 1, exitCode: undefined as number | undefined,
    once: (name: string, fn: () => void) => signals.set(name, fn), exit: () => { throw new Error('unexpected exit'); } };
  let closed = false;
  const context = {
    process: proc, console: { log: (s: string) => output.push(s), error: (s: string) => output.push(s) },
    join, fileURLToPath, URL, homedir: () => options.home ?? '/virtual', absoluteLine, reanchor, findBlocks, latestBlock, pickBlock,
    mkdir: async () => {}, appendFile: async (p: string, s: string) => { files.set(p, (files.get(p) ?? '') + s); },
    readFile: async (p: string) => { if (!files.has(p)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files.get(p); },
    writeFile: async (p: string, s: string) => { files.set(p, s); }, unlink: async (p: string) => { files.delete(p); },
    health: async () => ({ clients: options.clients ?? 0 }), postDiagram: async () => ({ clients: options.clients ?? 0 }),
    capturePane: async () => {
      if (options.failCapture) throw new Error('capture failed');
      return { raw: ['graph LR', '  A[hello', 'world]', '  A --> B'], joined: ['graph LR', '  A[hello world]', '  A --> B'], map: [0, 1, 1, 2] };
    },
    execFile: (_cmd: string, argv: string[], callback: (error?: Error) => void) => { toasts.push(argv.at(-1)!); callback(options.failToast ? new Error('toast failed') : undefined); },
    spawn: (cmd: string, argv: string[]) => {
      launches.push({ cmd, args: argv, stamp: files.get(stamp) });
      const child = Object.assign(new EventEmitter(), { unref() {} });
      queueMicrotask(() => child.emit('spawn'));
      return child;
    },
    startServer: async () => ({ close: async () => { closed = true; } }),
    done: Promise.resolve(),
  };
  if (options.home) Object.assign(context, {
    mkdir: fs.mkdir, appendFile: fs.appendFile, readFile: fs.readFile, writeFile: fs.writeFile, unlink: fs.unlink,
  });
  runInNewContext(code, context);
  await context.done;
  return { files, toasts, output, launches, proc, signals, closed: () => closed };
}
test('trigger errors are silent, logged, toasted and exit zero', async () => {
  for (const args of [['click', '%1'], ['latest', '%1'], ['latest', '%1', 'bad'], ['click', '%1', '-1', '', '0', '80', '']]) {
    const result = await cli(args);
    assert.equal(result.proc.exitCode, 0);
    assert.deepEqual(result.output, []);
    assert.match(result.toasts[0], /Error:/);
    assert.match([...result.files.values()].join(''), /Error:/);
  }
  for (const command of ['click', 'latest']) {
    const args = command === 'click' ? ['click', '%1', '0', '', '0', '80', ''] : ['latest', '%1', '80'];
    const result = await cli(args, { failCapture: true, failToast: true });
    assert.equal(result.proc.exitCode, 0);
    assert.deepEqual(result.output, []);
  }
});
test('click reanchors and reports one-based joined line and POST clients', async () => {
  for (const clients of [0, 1]) {
    const result = await cli(['click', '%1', '0', '', '40', '80', 'world]'], { clients });
    assert.match(result.toasts[0], /line 2 → /);
    assert.ok(result.toasts[0].endsWith(clients ? '→ viewer' : '→ daemon (opening viewer)'));
  }
});
test('viewer claims stamp before spawn, throttles recent launches and retains override', async () => {
  const first = await cli(['open']);
  assert.equal(first.launches[0].cmd, 'firefox');
  assert.ok(!first.launches[0].args.includes('--no-remote'));
  assert.ok(Number(first.launches[0].stamp) > 0);
  assert.equal((await cli(['open'], { last: Date.now() })).launches.length, 0);
  const old = await cli(['open'], { last: Date.now() - 11000, browser: 'custom-browser --flag' });
  assert.equal(old.launches[0].cmd, 'custom-browser');
  assert.deepEqual(Array.from(old.launches[0].args.slice(0, 1)), ['--flag']);
});
test('serve shutdown removes daemon pid after close', async () => {
  const result = await cli(['serve']);
  const pid = '/virtual/.local/state/mermaid-peek/daemon.pid';
  assert.ok(result.files.has(pid));
  result.signals.get('SIGTERM')!();
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.equal(result.closed(), true);
  assert.equal(result.files.has(pid), false);
});
test('five-argument click accepts omitted mouse text', async () => {
  const result = await cli(['click', '%1', '1', '', '0', '20'], { clients: 1 });
  assert.deepEqual(result.output, []);
  assert.match(result.toasts[0], /line 2 → viewer$/);
  assert.ok(!result.toasts.some(message => message.includes('Error:')));
});
test('install-tmux shell-escapes mouse text and preserves empty sixth argument', async () => {
  const result = await cli(['install-tmux']);
  const binding = result.output[0];
  assert.ok(binding.endsWith("click '#{pane_id}' '#{mouse_y}' '#{scroll_position}' '#{history_size}' '#{pane_width}' #{?mouse_line,#{q:mouse_line},''}\""));
  for (const mouseLine of ["node's; printf injected", '']) {
    // Substitute tmux's conditional and shell-escaped q: expansion before sh.
    const escaped = mouseLine.replace(/[^A-Za-z0-9_]/g, char => '\\' + char);
    const values: Record<string, string> = { pane_id: '%1', mouse_y: '1', scroll_position: '', history_size: '0', pane_width: '20' };
    const shellCommand = binding.match(/run-shell -b "(.*)"$/)![1]
      .replace(/^\S+/, 'capture')
      .replace("#{?mouse_line,#{q:mouse_line},''}", () => mouseLine ? escaped : "''")
      .replace(/#\{([^}]+)\}/g, (_, key: string) => values[key]);
    const output = await new Promise<string>((resolve, reject) => {
      execFile('/bin/sh', ['-c', 'capture() { printf "%s\\0" "$@"; }; ' + shellCommand],
        { encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(stdout));
    });
    const argv = output.split('\0').slice(0, -1);
    assert.deepEqual(argv, ['click', '%1', '1', '', '0', '20', mouseLine]);
    const clicked = await cli(argv, { clients: 1 });
    assert.match(clicked.toasts[0], /line 2 → viewer$/);
  }
});

test('viewer merges missing preferences in a temporary HOME without overwriting existing keys', async () => {
  const home = await fs.mkdtemp(join(tmpdir(), 'mermaid-peek-prefs-'));
  const profile = join(home, '.local/share/mermaid-peek/firefox-profile');
  const prefsPath = join(profile, 'user.js');
  const stamp = join(home, '.local/state/mermaid-peek/viewer-launched');
  await fs.mkdir(profile, { recursive: true });
  const original = '// retained settings\nuser_pref("browser.startup.page", 3);';
  await fs.writeFile(prefsPath, original);
  try {
    const first = await cli(['open'], { home });
    assert.equal(first.launches.length, 1);
    const merged = await fs.readFile(prefsPath, 'utf8');
    assert.ok(merged.startsWith(original + '\n'));
    assert.match(merged, /user_pref\("browser.startup.couldRestoreSession.count", -1\);/);
    assert.equal(merged.match(/user_pref\("browser.startup.page",/g)?.length, 1);
    assert.match(merged, /user_pref\("browser.aboutwelcome.enabled", false\);/);
    await fs.unlink(stamp);
    await cli(['open'], { home });
    assert.equal(await fs.readFile(prefsPath, 'utf8'), merged);
  } finally {
    await fs.unlink(prefsPath);
    await fs.unlink(stamp).catch(() => {});
    for (const dir of [profile, join(home, '.local/share/mermaid-peek'), join(home, '.local/share'),
      join(home, '.local/state/mermaid-peek'), join(home, '.local/state'), join(home, '.local'), home]) await fs.rmdir(dir);
  }
});
