import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { sinceTime } from '../src/cli/logs.js';
const cli = path.resolve('dist/cli/index.js');
const fixture = path.resolve('tests/fixtures/tiny-crm');
async function generated(t: any) {
  const root = await mkdtemp(path.join(tmpdir(), 'hive-commands-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fixture, root, { recursive: true, filter: (p) => !p.includes('/.hive') });
  const scanned = await hive(
    ['scan', '--select', 'search_contacts,create_contact', '--no-script'],
    root,
  );
  assert.equal(scanned.code, 0, scanned.output);
  return root;
}
function hive(args: string[], cwd: string) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [cli, ...args], { cwd, env, stdio: 'pipe' });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, output }));
  });
}
const policy = async (root: string) =>
  JSON.parse(await readFile(path.join(root, '.hive/policy.json'), 'utf8'));
test('hive tools edits .hive/policy.json and reports effective status', async (t) => {
  const root = await generated(t);
  const listed = await hive(['tools'], root);
  assert.match(listed.output, /✓ create_contact \[WRITE\] enabled/);
  assert.equal((await hive(['tools', 'disable', 'create_contact'], root)).code, 0);
  assert.deepEqual(await policy(root), { mode: 'all', tools: { create_contact: 'deny' } });
  assert.match((await hive(['tools'], root)).output, /✗ create_contact \[WRITE\] disabled/);
  assert.equal((await hive(['tools', 'mode', 'read-only', '-C', root], tmpdir())).code, 0);
  assert.equal((await hive(['tools', 'enable', 'create_contact'], root)).code, 0);
  const enabled = await hive(['tools'], root);
  assert.match(enabled.output, /✗ create_contact \[WRITE\] blocked by mode read-only/);
  assert.match(enabled.output, /✓ search_contacts \[READ\] enabled/);
  const unknown = await hive(['tools', 'disable', 'drop_database'], root);
  assert.equal(unknown.code, 1);
  assert.match(unknown.output, /Unknown tool: drop_database/);
  assert.equal((await hive(['tools', 'mode', 'yolo'], root)).code, 1);
  // Regeneration never touches the developer-owned policy file.
  assert.equal((await hive(['scan', '--select', 'search_contacts', '--no-script'], root)).code, 0);
  assert.equal((await policy(root)).mode, 'read-only');
  await writeFile(path.join(root, '.hive/policy.json'), '{ broken');
  const broken = await hive(['tools'], root);
  assert.equal(broken.code, 1);
  assert.match(broken.output, /Invalid \.hive\/policy\.json; the server disables every tool/);
});
test('hive logs filters recorded agent actions', async (t) => {
  const root = await generated(t);
  assert.match((await hive(['logs'], root)).output, /No agent actions recorded yet/);
  await mkdir(path.join(root, '.hive/logs'), { recursive: true });
  const now = Date.now();
  const line = (minutesAgo: number, tool: string, outcome: string) =>
    JSON.stringify({
      time: new Date(now - minutesAgo * 60_000).toISOString(),
      tool,
      risk: tool.startsWith('search') ? 'read' : 'write',
      outcome,
      status: outcome === 'ok' ? 200 : 403,
      durationMs: 5,
      transport: 'http',
      userAgent: 'Perplexity-MCP/1.0',
    });
  await writeFile(
    path.join(root, '.hive/logs/actions.jsonl'),
    [
      line(120, 'search_contacts', 'ok'),
      line(10, 'create_contact', 'app_error'),
      '{ partial line',
      line(1, 'create_contact', 'ok'),
    ].join('\n') + '\n',
  );
  const all = (await hive(['logs'], root)).output.trim().split('\n');
  assert.equal(all.length, 3);
  assert.match(all[2], /ok\s+create_contact \[WRITE\]\s+200\s+5ms · Perplexity-MCP\/1.0/);
  const errors = (await hive(['logs', '--errors'], root)).output.trim().split('\n');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /app_error/);
  assert.equal((await hive(['logs', '--since', '30m'], root)).output.trim().split('\n').length, 2);
  assert.equal(
    (await hive(['logs', '--tool', 'search_contacts'], root)).output.trim().split('\n').length,
    1,
  );
  assert.equal(
    (await hive(['logs', '--limit', '1', '--json'], root)).output.trim().split('\n').length,
    1,
  );
  assert.equal(sinceTime('2h', 10_000_000), 10_000_000 - 7_200_000);
  assert.throws(() => sinceTime('yesterday'));
  assert.match(await readFile(path.join(root, '.hive/.gitignore'), 'utf8'), /^logs\/$/m);
});
