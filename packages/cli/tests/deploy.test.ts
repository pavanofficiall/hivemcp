import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, readFile, writeFile, mkdir, symlink, chmod } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { checkAppUrl, preflight, verifyEndpoint } from '../src/cli/deploy.js';
import type { ToolDefinition } from '../src/capabilities/sync.js';
const cli = path.resolve('dist/cli/index.js');
const fixture = path.resolve('tests/fixtures/tiny-crm');
const modules = path.resolve('node_modules');
function hive(args: string[], cwd: string, extra: Record<string, string> = {}) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env, ...extra };
    delete env.NODE_TEST_CONTEXT;
    const child = spawn(process.execPath, [cli, ...args], { cwd, env, stdio: 'pipe' });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, output }));
  });
}
const tool = (name: string, method: string, route: string): ToolDefinition =>
  ({ name, risk: method === 'GET' ? 'read' : 'write', source: { method, route } }) as any;
const reply = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : '{}', { status, headers });

test('checkAppUrl refuses addresses only this computer can reach', () => {
  for (const raw of [
    'http://localhost:3000',
    'http://127.0.0.1:3001',
    'http://192.168.1.20',
    'http://10.0.0.5',
    'http://[::1]:3000',
    'http://myapp.local',
  ])
    assert.match(checkAppUrl(raw).error ?? '', /only exists on your computer/, raw);
  assert.match(checkAppUrl('not a url').error ?? '', /not a URL/);
  assert.match(checkAppUrl('https://app.com/api').error ?? '', /only the app origin/);
  assert.equal(checkAppUrl('https://app.example.com').url?.origin, 'https://app.example.com');
});

test('preflight explains an offline app, a stale deployment and rejected credentials', async () => {
  const origin = new URL('https://93.184.216.34');
  const tools = [
    tool('search_contacts', 'GET', '/api/contacts'),
    tool('create_deal', 'POST', '/api/deals'),
  ];
  const offline = await preflight(origin, tools, {}, async () => {
    throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  });
  assert.equal(offline.at(-1)?.level, 'error');
  assert.match(offline.at(-1)!.message, /isn't reachable: the server refused/);

  const stale = await preflight(origin, tools, {}, async (url: any, init: any) =>
    String(url).endsWith('/api/deals') ? reply(404) : reply(init?.method === 'OPTIONS' ? 204 : 200),
  );
  assert.ok(stale.some((c) => c.level === 'error' && /missing on the live app/.test(c.message)));

  const calls: { url: string; method: string; auth?: string }[] = [];
  const denied = await preflight(
    origin,
    tools,
    { authorization: 'Bearer k' },
    async (url: any, init: any) => {
      calls.push({
        url: String(url),
        method: init?.method ?? 'GET',
        auth: init?.headers?.authorization,
      });
      return init?.method === 'OPTIONS' ? reply(204, { allow: 'GET, POST, OPTIONS' }) : reply(401);
    },
  );
  assert.ok(
    denied.some((c) => c.level === 'error' && /rejected Hive's credentials/.test(c.message)),
  );
  // Write routes are only probed with OPTIONS, never called.
  assert.ok(!calls.some((c) => c.url.endsWith('/api/deals') && c.method !== 'OPTIONS'));
  assert.equal(
    calls.find((c) => c.method === 'GET' && c.url.endsWith('/api/contacts'))?.auth,
    'Bearer k',
  );

  const ready = await preflight(origin, tools, {}, async (_url: any, init: any) =>
    reply(init?.method === 'OPTIONS' ? 204 : 200),
  );
  assert.ok(!ready.some((c) => c.level === 'error'));
});

test('hive deploy builds a Vercel bundle that serves MCP only behind the secret link', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'hive-deploy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fixture, root, {
    recursive: true,
    filter: (p) => !p.includes('/.hive') && !p.includes('/.next'),
  });
  const scanned = await hive(
    ['scan', '--select', 'search_contacts,create_contact', '--no-script'],
    root,
  );
  assert.equal(scanned.code, 0, scanned.output);
  await symlink(modules, path.join(root, '.hive/mcp/node_modules'), 'dir');
  await writeFile(
    path.join(root, '.hive/policy.json'),
    JSON.stringify({ mode: 'all', tools: { create_contact: 'deny' } }),
  );

  // A stand-in for Vercel: serves the bundle with the same rewrite and the env passed via --env.
  const bundle = path.join(root, '.hive/deploy/vercel');
  const server = createServer(async (req, res) => {
    const env = JSON.parse(await readFile(path.join(bundle, 'env.json'), 'utf8'));
    Object.assign(process.env, env);
    const match = /^\/mcp\/([^/?]+)$/.exec(req.url ?? '');
    const target = new URL(
      match ? `/api/mcp?key=${match[1]}` : (req.url ?? '/'),
      'http://fake.vercel',
    );
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const fn = await import(pathToFileURL(path.join(bundle, 'api/mcp.js')).href);
    const response: Response = await fn[req.method ?? 'GET'](
      new Request(target, {
        method: req.method,
        headers: req.headers as any,
        body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fake = path.join(root, 'fake-vercel.mjs');
  await writeFile(
    fake,
    `#!/usr/bin/env node
import { mkdirSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
const [command, ...rest] = process.argv.slice(2);
if (command === 'link') { mkdirSync('.vercel', { recursive: true }); writeFileSync('.vercel/project.json', '{}'); }
if (command === 'deploy') {
  const env = {};
  for (let i = 0; i < rest.length; i++) if (rest[i] === '--env') { const [k, ...v] = rest[++i].split('='); env[k] = v.join('='); }
  writeFileSync('env.json', JSON.stringify(env));
  if (!existsSync('node_modules')) symlinkSync(${JSON.stringify(modules)}, 'node_modules', 'dir');
  console.log(${JSON.stringify(base)});
}
`,
  );
  await chmod(fake, 0o755);

  const deployed = await hive(
    [
      'deploy',
      '--app-url',
      'https://crm.example.com',
      '--project',
      'hive-test-nonexistent-x9q',
      '--skip-checks',
      '--yes',
    ],
    root,
    { HIVE_VERCEL_BIN: fake },
  );
  assert.equal(deployed.code, 0, deployed.output);
  assert.match(deployed.output, /Live and answering: 1 tools \(search_contacts\)/);
  const state = JSON.parse(await readFile(path.join(root, '.hive/deploy.json'), 'utf8'));
  assert.equal(state.url, base);
  assert.equal(state.appUrl, 'https://crm.example.com');
  assert.ok(state.key.length >= 24);
  assert.ok(deployed.output.includes(`${base}/mcp/${state.key}`));
  const env = JSON.parse(await readFile(path.join(bundle, 'env.json'), 'utf8'));
  assert.equal(env.HIVE_APP_BASE_URL, 'https://crm.example.com');
  assert.equal(env.HIVE_LOG, 'stdout');
  assert.deepEqual(JSON.parse(env.HIVE_POLICY_JSON).tools, { create_contact: 'deny' });

  // The policy travels with the deployment; the secret is required; GET is not an MCP stream.
  assert.deepEqual(await verifyEndpoint(`${base}/mcp/${state.key}`), ['search_contacts']);
  assert.equal(
    (await fetch(`${base}/mcp/wrong-key-wrong-key-wrong-key`, { method: 'POST', body: '{}' }))
      .status,
    404,
  );
  assert.equal((await fetch(`${base}/api/mcp`, { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await fetch(`${base}/mcp/${state.key}`)).status, 405);
  assert.match(await readFile(path.join(root, '.hive/.gitignore'), 'utf8'), /deploy\.json/);

  // Redeploying keeps the same link unless the key is rotated.
  const again = await hive(['deploy', '--skip-checks', '--yes'], root, { HIVE_VERCEL_BIN: fake });
  assert.equal(again.code, 0, again.output);
  assert.equal(
    JSON.parse(await readFile(path.join(root, '.hive/deploy.json'), 'utf8')).key,
    state.key,
  );
  const rotated = await hive(['deploy', '--skip-checks', '--yes', '--rotate-key'], root, {
    HIVE_VERCEL_BIN: fake,
  });
  assert.equal(rotated.code, 0, rotated.output);
  assert.notEqual(
    JSON.parse(await readFile(path.join(root, '.hive/deploy.json'), 'utf8')).key,
    state.key,
  );
});

test('hive deploy stops with a clear message when the app is not online', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'hive-deploy-local-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fixture, root, {
    recursive: true,
    filter: (p) => !p.includes('/.hive') && !p.includes('/.next'),
  });
  assert.equal((await hive(['scan', '--read-only', '--no-script'], root)).code, 0);
  const local = await hive(['deploy', '--app-url', 'http://localhost:3000', '--yes'], root);
  assert.notEqual(local.code, 0);
  assert.match(local.output, /only exists on your computer/);
  assert.match(local.output, /Deploy your app's frontend and backend first/);
});
