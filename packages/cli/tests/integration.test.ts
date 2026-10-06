import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, readFile, writeFile, symlink, access } from 'node:fs/promises';
import { request } from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const require = createRequire(import.meta.url);
const cli = path.resolve('dist/cli/index.js');
function command(cmd: string, args: string[], cwd: string, env = process.env) {
  return new Promise<string>((resolve, reject) => {
    const childEnv = { ...env };
    delete childEnv.NODE_TEST_CONTEXT;
    const child = spawn(cmd, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve(output)
        : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}\n${output}`)),
    );
  });
}
async function freePort() {
  const server = createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((r) => server.close(() => r()));
  return port;
}
function start(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout?.on('data', (d) => (logs += d));
  child.stderr?.on('data', (d) => (logs += d));
  return { child, logs: () => logs };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}
async function ready(url: string, process: ReturnType<typeof start>, expected?: number) {
  for (let i = 0; i < 180; i++) {
    if (process.child.exitCode !== null) throw new Error('Server exited:\n' + process.logs());
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (expected ? response.status === expected : response.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Server did not start: ' + process.logs());
}
test(
  'CLI -> real Next.js app -> generated MCP build -> SDK discovery -> authenticated state change',
  { timeout: 240000 },
  async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'hive-integration-'));
    const children: ChildProcess[] = [];
    t.after(async () => {
      for (const child of children.reverse()) await stop(child);
      await rm(root, { recursive: true, force: true });
    });
    await cp(path.resolve('tests/fixtures/tiny-crm'), root, {
      recursive: true,
      filter: (p) => !p.includes('/.hive'),
    });
    await assert.rejects(access(path.join(root, '.hive')));
    await assert.rejects(
      command(process.execPath, [cli, 'scan'], root),
      /Interactive review requires a terminal/,
    );
    const preview = JSON.parse(await command(process.execPath, [cli, 'scan', '--json'], root));
    assert.equal(preview.candidates.length, 6);
    await assert.rejects(access(path.join(root, '.hive')));
    const scan = await command(
      process.execPath,
      [
        cli,
        'scan',
        '--select',
        'search_contacts,launch_sequence,create_contact,get_sequence',
        '--no-script',
      ],
      root,
    );
    assert.match(scan, /6 candidates/);
    assert.match(scan, /4 selected tools/);
    const serverDir = path.join(root, '.hive/mcp');
    const tools = JSON.parse(await readFile(path.join(serverDir, 'src/tools.json'), 'utf8'));
    assert.deepEqual(
      tools.map((x: any) => x.name),
      ['create_contact', 'get_sequence', 'launch_sequence', 'search_contacts'],
    );
    // Install the actual generated package; no runtime imports from Hive CLI.
    await command(
      'npm',
      [
        'install',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        ...(process.env.HIVE_TEST_NPM_CACHE
          ? ['--offline', '--cache', process.env.HIVE_TEST_NPM_CACHE]
          : []),
      ],
      serverDir,
    );
    await command('npm', ['run', 'build'], serverDir);
    const generatedTests = await command('npm', ['test'], serverDir);
    assert.match(generatedTests, /# fail 0/);
    const appPort = await freePort();
    const mcpPort = await freePort();
    const nextBin = require.resolve('next/dist/bin/next');
    // The repository supplies Next.js for fixture execution, independent of the generated package.
    const rootModules = path.resolve(path.dirname(nextBin), '../../../');
    await symlink(rootModules, path.join(root, 'node_modules'));
    const app = start(
      process.execPath,
      [nextBin, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(appPort)],
      root,
      { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    );
    children.push(app.child);
    const appUrl = `http://127.0.0.1:${appPort}`;
    await ready(appUrl + '/api/contacts', app);
    const directBefore = await fetch(appUrl + '/api/sequences/seq_123').then((r) => r.json());
    assert.equal(directBefore.status, 'draft');
    const runtimeEnv = {
      ...process.env,
      HIVE_APP_BASE_URL: appUrl,
      HIVE_MCP_PORT: String(mcpPort),
      HIVE_FORWARD_AUTH: 'true',
    };
    delete runtimeEnv.HIVE_APP_BEARER_TOKEN;
    delete runtimeEnv.HIVE_APP_COOKIE;
    delete runtimeEnv.HIVE_MCP_TOKEN;
    const doctor = await command(process.execPath, [cli, 'doctor', '--cwd', root], root);
    assert.match(doctor, /4 selected tools/);
    const mcp = start(process.execPath, [cli, 'dev', '--cwd', root], serverDir, runtimeEnv);
    children.push(mcp.child);
    const endpoint = `http://127.0.0.1:${mcpPort}/mcp`;
    await ready(endpoint, mcp, 405);
    const unauthenticated = new Client({ name: 'hive-test-unauthenticated', version: '1.0' });
    await unauthenticated.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
    try {
      const denied = await unauthenticated.callTool({
        name: 'launch_sequence',
        arguments: { path: { id: 'seq_123' }, body: { confirm: true } },
      });
      assert.equal(denied.isError, true);
      assert.match(JSON.stringify(denied), /403/);
    } finally {
      await unauthenticated.close();
    }
    const client = new Client({ name: 'hive-integration-test', version: '1.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { headers: { authorization: 'Bearer fixture-token' } },
      }),
    );
    try {
      const listed = await client.listTools();
      assert.ok(listed.tools.some((tool) => tool.name === 'search_contacts'));
      assert.ok(listed.tools.some((tool) => tool.name === 'launch_sequence'));
      assert.ok(!listed.tools.some((tool) => tool.name === 'delete_contact'));
      const searched = await client.callTool({
        name: 'search_contacts',
        arguments: { query: { q: 'Ada' } },
      });
      assert.ok(!searched.isError);
      assert.match(JSON.stringify(searched), /Lovelace/);
      const bad = await client.callTool({
        name: 'launch_sequence',
        arguments: { path: { id: 'seq_123' }, body: { confirm: 'not a boolean' } },
      });
      assert.equal(bad.isError, true);
      const before = await fetch(appUrl + '/api/sequences/seq_123').then((r) => r.json());
      assert.equal(before.launches, 0);
      const launched = await client.callTool({
        name: 'launch_sequence',
        arguments: { path: { id: 'seq_123' }, body: { confirm: true } },
      });
      assert.ok(!launched.isError, JSON.stringify(launched));
      const after = await fetch(appUrl + '/api/sequences/seq_123').then((r) => r.json());
      assert.equal(after.status, 'launched');
      assert.equal(after.launches, 1);
      const created = await client.callTool({
        name: 'create_contact',
        arguments: {
          body: { firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.test' },
        },
      });
      assert.ok(!created.isError, JSON.stringify(created));
      const contacts = await fetch(appUrl + '/api/contacts?q=Grace').then((r) => r.json());
      assert.equal(contacts[0].lastName, 'Hopper');
      const unselected = await client.callTool({
        name: 'delete_contact',
        arguments: { path: { id: 'contact_1' } },
      });
      assert.equal(unselected.isError, true);
    } finally {
      await client.close();
    }
    assert.equal(
      (
        await fetch(endpoint, {
          method: 'POST',
          headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: 'not json',
        })
      ).status,
      400,
    );
    // Every agent call is in the action log, with app status and redaction-safe arguments.
    const actions = (await readFile(path.join(root, '.hive/logs/actions.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      actions.map((a) => [a.tool, a.outcome, a.status]),
      [
        ['launch_sequence', 'app_error', 403],
        ['search_contacts', 'ok', 200],
        ['launch_sequence', 'ok', 200],
        ['create_contact', 'ok', 201],
      ],
    );
    assert.equal(actions[3].args.body.lastName, 'Hopper');
    // A policy edit applies on the next request without a restart.
    await writeFile(
      path.join(root, '.hive/policy.json'),
      JSON.stringify({ mode: 'all', tools: { launch_sequence: 'deny' } }),
    );
    const restricted = new Client({ name: 'hive-policy-test', version: '1.0' });
    await restricted.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
    try {
      const names = (await restricted.listTools()).tools.map((tool) => tool.name);
      assert.ok(!names.includes('launch_sequence'));
      assert.ok(names.includes('search_contacts'));
      const refused = await restricted.callTool({
        name: 'launch_sequence',
        arguments: { path: { id: 'seq_123' }, body: { confirm: true } },
      });
      assert.equal(refused.isError, true);
    } finally {
      await restricted.close();
    }
    assert.equal(
      (await fetch(appUrl + '/api/sequences/seq_123').then((r) => r.json())).launches,
      1,
    );
    await writeFile(path.join(root, '.hive/policy.json'), JSON.stringify({ mode: 'read-only' }));
    const readOnly = new Client({ name: 'hive-read-only-test', version: '1.0' });
    await readOnly.connect(new StreamableHTTPClientTransport(new URL(endpoint)));
    try {
      assert.deepEqual((await readOnly.listTools()).tools.map((tool) => tool.name).sort(), [
        'get_sequence',
        'search_contacts',
      ]);
    } finally {
      await readOnly.close();
    }
    await rm(path.join(root, '.hive/policy.json'));
    // Remote hosts are opt-in and refuse to start without a strong token.
    const remoteHost = 'demo-tunnel.example.test';
    await assert.rejects(
      command(process.execPath, ['dist/server.js'], serverDir, {
        ...runtimeEnv,
        HIVE_MCP_PORT: String(await freePort()),
        HIVE_ALLOWED_HOSTS: remoteHost,
      }),
      /HIVE_ALLOWED_HOSTS requires HIVE_MCP_TOKEN/,
    );
    const remotePort = await freePort();
    const remoteToken = 'r'.repeat(32);
    const remote = start(process.execPath, ['dist/server.js'], serverDir, {
      ...runtimeEnv,
      HIVE_MCP_PORT: String(remotePort),
      HIVE_ALLOWED_HOSTS: remoteHost,
      HIVE_MCP_TOKEN: remoteToken,
    });
    children.push(remote.child);
    await ready(`http://127.0.0.1:${remotePort}/mcp`, remote, 401);
    const viaHost = (host: string, authorization?: string) =>
      new Promise<number>((resolve, reject) => {
        const req = request(
          {
            host: '127.0.0.1',
            port: remotePort,
            path: '/mcp',
            method: 'POST',
            headers: {
              host,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              ...(authorization ? { authorization } : {}),
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 'tunnel-test', version: '1.0' },
            },
          }),
        );
      });
    assert.equal(await viaHost(remoteHost, `Bearer ${remoteToken}`), 200);
    assert.equal(await viaHost(remoteHost), 401);
    assert.equal(await viaHost('attacker.example.test', `Bearer ${remoteToken}`), 403);
    await stop(remote.child);
    const stdio = new Client({ name: 'stdio-test', version: '1.0' });
    await stdio.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['dist/server.js', '--stdio'],
        cwd: serverDir,
        env: runtimeEnv as Record<string, string>,
        stderr: 'pipe',
      }),
    );
    try {
      assert.equal((await stdio.listTools()).tools.length, 4);
    } finally {
      await stdio.close();
    }
    const repeated = await command(process.execPath, [cli, 'scan', '--dry-run'], root);
    assert.match(repeated, /6 unchanged, 0 new, 0 changed, 0 removed/);
    t.diagnostic(
      'Verified real Next.js application state: seq_123 draft -> launched; launches 0 -> 1; Grace Hopper contact created. Streamable HTTP and stdio discovery succeeded.',
    );
  },
);
