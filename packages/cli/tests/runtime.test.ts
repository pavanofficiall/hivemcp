import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { requestFor, execute, ApplicationAuth } from '../templates/mcp/src/adapter.js';
import { toZod, toObject } from '../templates/mcp/src/schema.js';
import type { Tool } from '../templates/mcp/src/types.js';
import { loadPolicy, allowed } from '../templates/mcp/src/policy.js';
import { record, redact } from '../templates/mcp/src/log.js';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const tool: Tool = {
  name: 'update_widget',
  description: 'Update widget',
  risk: 'write',
  source: { method: 'POST', route: '/api/widgets/{id}', file: 'route.ts' },
  inputSchema: { type: 'object' },
};
test('runtime schema validates enums, numbers, email, uuid, arrays, null and strict objects', () => {
  const schema = toObject({
    type: 'object',
    properties: {
      email: { type: 'string', format: 'email' },
      id: { type: 'string', format: 'uuid' },
      amount: { type: 'integer', minimum: 1, maximum: 3 },
      state: { type: 'string', enum: ['open', 'closed'] },
      tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
      memo: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
    required: ['email', 'amount', 'state', 'tags'],
  });
  const good = { email: 'a@example.test', amount: 2, state: 'open', tags: ['x'], memo: null };
  assert.equal(schema.safeParse(good).success, true);
  for (const bad of [
    { email: 'bad' },
    { amount: 0 },
    { amount: 1.5 },
    { state: 'unknown' },
    { tags: [] },
    { id: 'not-a-uuid' },
    { unknown: 'x' },
  ])
    assert.equal(schema.safeParse({ ...good, ...bad }).success, false);
  assert.throws(() => toZod({}), /Unsupported/);
});
test('adapter uses fixed origin, encoded paths and repeated query values', () => {
  const req = requestFor(
    tool,
    { path: { id: 'a/b ?' }, query: { tag: ['one', 'two'], count: 3 }, body: { active: true } },
    'https://example.test',
  );
  assert.equal(req.url.pathname, '/api/widgets/a%2Fb%20%3F');
  assert.deepEqual(req.url.searchParams.getAll('tag'), ['one', 'two']);
  assert.equal(req.url.searchParams.get('count'), '3');
  assert.equal(req.body, '{"active":true}');
  for (const id of ['.', '..', ''])
    assert.throws(
      () => requestFor(tool, { path: { id } }, 'http://localhost:3000'),
      /Invalid path/,
    );
  assert.throws(
    () => requestFor(tool, { path: { id: '1' } }, 'http://user:secret@localhost'),
    /without credentials/,
  );
  assert.throws(
    () => requestFor(tool, { path: { id: '1' }, query: { nested: { a: 1 } } }, 'http://localhost'),
    /Nested/,
  );
});
test('application credentials are modular and passthrough is opt-in', () => {
  const saved = { ...process.env };
  try {
    delete process.env.HIVE_FORWARD_AUTH;
    delete process.env.HIVE_APP_COOKIE;
    process.env.HIVE_APP_BEARER_TOKEN = 'configured';
    assert.equal(
      new ApplicationAuth().headers({ authorization: 'Bearer caller' }).authorization,
      'Bearer configured',
    );
    process.env.HIVE_FORWARD_AUTH = 'true';
    assert.equal(
      new ApplicationAuth().headers({ authorization: 'Bearer caller', cookie: 'session=example' })
        .authorization,
      'Bearer caller',
    );
    assert.equal(
      new ApplicationAuth().headers({ cookie: 'session=example' }).cookie,
      'session=example',
    );
  } finally {
    for (const key of ['HIVE_FORWARD_AUTH', 'HIVE_APP_COOKIE', 'HIVE_APP_BEARER_TOKEN'])
      saved[key] === undefined ? delete process.env[key] : (process.env[key] = saved[key]);
  }
});
test('HTTP adapter forwards method/body/auth, reports failures and refuses redirects', async (t) => {
  let observed: any;
  const server = createServer(async (req, res) => {
    if (req.url?.endsWith('/redirect')) {
      res.writeHead(302, { location: 'http://example.test' }).end();
      return;
    }
    if (req.url?.endsWith('/denied')) {
      res.writeHead(403).end('secret stacktrace');
      return;
    }
    if (req.url?.endsWith('/huge')) {
      res.end('x'.repeat(2_000_001));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    observed = { method: req.method, authorization: req.headers.authorization, body };
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(
    () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  );
  const old = process.env.HIVE_APP_BASE_URL;
  const address = server.address() as { port: number };
  process.env.HIVE_APP_BASE_URL = `http://127.0.0.1:${address.port}`;
  try {
    const result = await execute(
      tool,
      { path: { id: '1' }, body: { name: 'A' } },
      {},
      { headers: () => ({ authorization: 'Bearer test' }) },
    );
    assert.deepEqual(result.structuredContent?.data, { ok: true });
    assert.deepEqual(observed, {
      method: 'POST',
      authorization: 'Bearer test',
      body: '{"name":"A"}',
    });
    const denied = await execute(tool, { path: { id: 'denied' } });
    assert.equal(denied.isError, true);
    assert.ok(!JSON.stringify(denied).includes('secret stacktrace'));
    await assert.rejects(execute(tool, { path: { id: 'redirect' } }), /redirect refused/);
    await assert.rejects(execute(tool, { path: { id: 'huge' } }), /exceeds 2 MB/);
  } finally {
    old === undefined
      ? delete process.env.HIVE_APP_BASE_URL
      : (process.env.HIVE_APP_BASE_URL = old);
  }
});
test('policy fails closed, hides denied tools and read-only mode blocks writes', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hive-policy-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'policy.json');
  const read = { name: 'search_widgets', risk: 'read' as const };
  const write = { name: 'update_widget', risk: 'write' as const };
  const missing = loadPolicy(file);
  assert.deepEqual(missing, { mode: 'all', tools: {} });
  assert.ok(allowed(missing, read) && allowed(missing, write));
  await writeFile(file, JSON.stringify({ tools: { update_widget: 'deny' } }));
  assert.equal(allowed(loadPolicy(file), write), false);
  assert.equal(allowed(loadPolicy(file), read), true);
  await writeFile(file, JSON.stringify({ mode: 'read-only', tools: { update_widget: 'allow' } }));
  assert.equal(allowed(loadPolicy(file), write), false);
  assert.equal(allowed(loadPolicy(file), read), true);
  await writeFile(file, '{ not json');
  const broken = loadPolicy(file);
  assert.equal(broken.mode, 'off');
  assert.match(broken.error!, /all tools are disabled/);
  assert.equal(allowed(broken, read), false);
  await writeFile(file, JSON.stringify({ mode: 'everything' }));
  assert.equal(loadPolicy(file).mode, 'off');
});
test('action log redacts secrets, truncates values and can omit arguments', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'hive-log-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'logs/actions.jsonl');
  const saved = { file: process.env.HIVE_LOG_FILE, args: process.env.HIVE_LOG_ARGS };
  t.after(() => {
    process.env.HIVE_LOG_FILE = saved.file;
    process.env.HIVE_LOG_ARGS = saved.args;
    if (saved.file === undefined) delete process.env.HIVE_LOG_FILE;
    if (saved.args === undefined) delete process.env.HIVE_LOG_ARGS;
  });
  assert.deepEqual(redact({ body: { password: 'x', apiKey: 'y', note: 'a'.repeat(300) } }), {
    body: { password: '[redacted]', apiKey: '[redacted]', note: 'a'.repeat(200) + '…' },
  });
  process.env.HIVE_LOG_FILE = file;
  delete process.env.HIVE_LOG_ARGS;
  const entry = {
    time: '2026-10-06T10:00:00.000Z',
    tool: 'update_widget',
    risk: 'write',
    outcome: 'ok' as const,
    status: 200,
    durationMs: 12,
    transport: 'http' as const,
  };
  record(entry, { path: { id: 'w1' }, body: { sessionToken: 'secret-value' } });
  process.env.HIVE_LOG_ARGS = 'off';
  record({ ...entry, outcome: 'denied' }, { path: { id: 'w2' } });
  const lines = (await readFile(file, 'utf8'))
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  assert.equal(lines.length, 2);
  assert.deepEqual(lines[0].args, { path: { id: 'w1' }, body: { sessionToken: '[redacted]' } });
  assert.equal(lines[1].outcome, 'denied');
  assert.equal('args' in lines[1], false);
  assert.ok(!(await readFile(file, 'utf8')).includes('secret-value'));
});
