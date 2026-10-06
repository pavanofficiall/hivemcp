import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { scan } from '../src/scanner/scan.js';
import { planSync, toDefinition } from '../src/capabilities/sync.js';
const cli = path.resolve('dist/cli/index.js');
const fixture = path.resolve('tests/fixtures/tiny-crm');
async function copied(t: any) {
  const root = await mkdtemp(path.join(tmpdir(), 'hive-sync-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fixture, root, { recursive: true, filter: (p) => !p.includes('/.hive') });
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
const tools = async (root: string) =>
  JSON.parse(await readFile(path.join(root, '.hive/mcp/src/tools.json'), 'utf8')).map(
    (t: any) => t.name,
  );
test('planSync keeps unchanged tools and never carries approval to changed or new ones', async () => {
  const result = await scan(fixture);
  const byName = (n: string) => result.candidates.find((c) => c.name === n)!;
  const served = [byName('search_contacts'), byName('create_contact'), byName('get_sequence')].map(
    toDefinition,
  );
  served[1] = { ...served[1], risk: 'read' };
  served.push({
    ...served[2],
    name: 'old_tool',
    source: { ...served[2].source, route: '/api/old' },
  });
  const seen = result.candidates.filter((c) => c.name !== 'create_deal');
  const plan = planSync(served, seen, result.candidates);
  assert.deepEqual(
    plan.keep.map((c) => c.name),
    ['search_contacts', 'get_sequence'],
  );
  assert.deepEqual(
    plan.changed.map((c) => [c.after.name, c.fields]),
    [['create_contact', ['risk']]],
  );
  assert.deepEqual(
    plan.removed.map((t) => t.name),
    ['old_tool'],
  );
  assert.deepEqual(
    plan.added.map((c) => c.name),
    ['create_deal'],
  );
});
test('hive sync detects drift, refuses silent re-approval and regenerates on request', async (t) => {
  const root = await copied(t);
  const scanned = await hive(
    ['scan', '--select', 'search_contacts,create_contact,get_sequence', '--no-script'],
    root,
  );
  assert.equal(scanned.code, 0, scanned.output);
  const clean = await hive(['sync', '--check'], root);
  assert.equal(clean.code, 0, clean.output);
  assert.match(clean.output, /Up to date/);
  // Change an approved tool's input, remove one route and add a new one.
  const schemas = path.join(root, 'lib/schemas.ts');
  await writeFile(
    schemas,
    (await readFile(schemas, 'utf8')).replace(
      'lastName: z.string(),',
      'lastName: z.string().min(2),',
    ),
  );
  await rm(path.join(root, 'app/api/sequences/[id]/route.ts'));
  await mkdir(path.join(root, 'app/api/notes'), { recursive: true });
  await writeFile(
    path.join(root, 'app/api/notes/route.ts'),
    'export async function GET() {\n  return Response.json([]);\n}\n',
  );
  const drift = await hive(['sync', '--check'], root);
  assert.equal(drift.code, 1, drift.output);
  assert.match(drift.output, /~ create_contact changed \(inputSchema\)/);
  assert.match(drift.output, /- get_sequence is gone from the app/);
  assert.match(drift.output, /\+ search_notes \[READ\] is new, not approved/);
  const before = await readFile(path.join(root, '.hive/mcp/src/tools.json'), 'utf8');
  const refused = await hive(['sync'], root);
  assert.equal(refused.code, 1);
  assert.match(refused.output, /1 approved tool\(s\) changed.*Nothing was written/);
  assert.equal(await readFile(path.join(root, '.hive/mcp/src/tools.json'), 'utf8'), before);
  const synced = await hive(['sync', '--accept-changed'], root);
  assert.equal(synced.code, 0, synced.output);
  assert.deepEqual(await tools(root), ['create_contact', 'search_contacts']);
  const served = JSON.parse(await readFile(path.join(root, '.hive/mcp/src/tools.json'), 'utf8'));
  assert.equal(
    served.find((x: any) => x.name === 'create_contact').inputSchema.properties.body.properties
      .lastName.minLength,
    2,
  );
  const after = await hive(['sync', '--check'], root);
  assert.equal(after.code, 0, after.output);
});
