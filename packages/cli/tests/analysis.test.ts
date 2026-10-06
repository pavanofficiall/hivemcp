import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, cp, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Project } from 'ts-morph';
import { scan } from '../src/scanner/scan.js';
import { detectProject, indexFiles } from '../src/scanner/project.js';
import { parseZod } from '../src/analyzers/parsers/zod.js';
import { parsePrisma } from '../src/analyzers/parsers/prisma.js';
import { routePath } from '../src/analyzers/nextjs/routes.js';
import {
  buildCandidates,
  capabilityName,
  classifyRisk,
  diffCapabilities,
} from '../src/capabilities/build.js';
import { generate, addPackageScript } from '../src/generator/project.js';
const fixture = path.resolve('tests/fixtures/tiny-crm');
async function copied(t: any) {
  const root = await mkdtemp(path.join(tmpdir(), 'hive-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await cp(fixture, root, { recursive: true, filter: (p) => !p.includes('/.hive') });
  return root;
}
function zod(expression: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const source = project.createSourceFile(
    '/schema.ts',
    `import { z as validator } from 'zod'; const S = ${expression};`,
  );
  return parseZod(source.getVariableDeclarationOrThrow('S').getInitializer());
}
test('project detection and unsupported framework errors', async (t) => {
  const root = await copied(t);
  assert.equal((await detectProject(root)).appDirectory, 'app');
  await writeFile(path.join(root, 'package.json'), '{"dependencies":{"@remix-run/node":"1"}}');
  await assert.rejects(detectProject(root), /does not declare Next.js/);
});
test('index skips secrets, symlinks, generated and huge files', async (t) => {
  const root = await copied(t);
  await mkdir(path.join(root, 'generated'));
  await writeFile(path.join(root, 'generated/secret.ts'), 'throw new Error("never execute")');
  await writeFile(path.join(root, '.env'), 'SECRET=never-read');
  await writeFile(path.join(root, 'huge.ts'), 'x'.repeat(300000));
  await symlink(path.join(root, 'lib'), path.join(root, 'linked'));
  const files = await indexFiles(root);
  assert.ok(files.length > 5);
  assert.ok(!files.some((f) => /generated|\.env|huge|linked/.test(f.path)));
});
test('App Router paths strip groups and normalize dynamic segments', () => {
  assert.equal(
    routePath('src/app/(private)/api/widgets/[widgetId]/route.ts'),
    '/api/widgets/{widgetId}',
  );
});
test('Zod AST handles alias imports, common types, optional, nullable and bounds', () => {
  const result = zod(
    `validator.object({ email: validator.string().email(), id: validator.string().uuid(), amount: validator.number().min(0).max(10), active: validator.boolean(), tags: validator.array(validator.string()).optional(), state: validator.enum(['a','b']), memo: validator.string().nullable() })`,
  );
  assert.equal(result.supported, true);
  assert.equal(result.schema.properties?.email.format, 'email');
  assert.equal(result.schema.properties?.amount.minimum, 0);
  assert.ok(!result.schema.required?.includes('tags'));
  assert.equal(result.schema.properties?.memo.anyOf?.[1].type, 'null');
});
test('unsupported transforms and non-Zod factories remain partial', () => {
  assert.equal(zod('validator.string().transform(v => v.length)').supported, false);
  assert.equal(zod('other.object({})').supported, false);
});
test('Zod trim preserves string validation and leaves normalization to the application', () => {
  const result = zod('validator.string().trim().min(1).max(120)');
  assert.equal(result.supported, true);
  assert.equal(result.schema.type, 'string');
  assert.equal(result.schema.minLength, 1);
  assert.equal(result.schema.maxLength, 120);
});
test('Prisma supporting context includes relations, optional fields and enums', () => {
  const models = parsePrisma(
    'model Company {\nid String @id\ncontacts Contact[]\n}\nenum State {\nDRAFT\nLIVE\n}',
  );
  assert.equal(models[0].fields[1].type, 'Contact[]');
  assert.equal(models[1].kind, 'enum');
});
test('deterministic semantic names, including non-CRM operations', () => {
  const cases = [
    ['GET', '/api/contacts', 'search_contacts'],
    ['POST', '/api/deals', 'create_deal'],
    ['PATCH', '/api/deals/{id}/stage', 'update_deal_stage'],
    ['POST', '/api/sequences/{id}/launch', 'launch_sequence'],
    ['POST', '/api/invoices/{id}/send', 'send_invoice'],
    ['GET', '/api/companies/{id}', 'get_company'],
  ];
  for (const [method, p, name] of cases) assert.equal(capabilityName({ method, path: p }), name);
  assert.equal(classifyRisk('GET', '/api/widgets'), 'read');
  assert.equal(classifyRisk('GET', 'WidgetService.deleteAll'), 'destructive');
  assert.equal(classifyRisk('POST', '/api/widgets'), 'write');
  assert.equal(classifyRisk('DELETE', '/api/widgets/{id}'), 'destructive');
});
test('fixture joins routes to service symbols, aliased schemas and permissions', async () => {
  const result = await scan(fixture);
  const launch = result.candidates.find((c) => c.name === 'launch_sequence')!;
  assert.equal(launch.supported, true);
  assert.equal(launch.services[0].name, 'SequenceService.launchSequence');
  assert.match(launch.permissions[0], /SEQUENCE_LAUNCH/);
  assert.equal(launch.inputSchema.properties?.body.properties?.confirm.type, 'boolean');
  const search = result.candidates.find((c) => c.name === 'search_contacts')!;
  assert.equal(search.inputSchema.properties?.query.properties?.q.type, 'string');
  assert.ok(!search.inputSchema.properties?.body);
  assert.equal(result.candidates.length, 6);
  assert.ok(!result.candidates.some((c) => c.source.route.includes('/health')));
});
test('unknown bodies, catch-all routes and wrapped handlers require review', async (t) => {
  const root = await copied(t);
  for (const [route, source] of [
    [
      'import',
      'export async function POST(req: Request) { const body = await req.json(); return Response.json(body); }',
    ],
    ['files/[...slug]', 'export const GET = withAuth(async () => Response.json({}));'],
  ]) {
    const dir = path.join(root, 'app/api', route);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'route.ts'), source);
  }
  const result = await scan(root);
  assert.equal(result.candidates.find((c) => c.source.route === '/api/import')?.supported, false);
  assert.equal(result.candidates.find((c) => c.source.route.includes('slug'))?.supported, false);
});
test('query schemas are mapped to query, not body, and named export aliases work', async (t) => {
  const root = await copied(t);
  const dir = path.join(root, 'app/api/invoices');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'route.ts'),
    `import {z} from 'zod'; const QuerySchema = z.object({ status:z.enum(['open','paid']), tags:z.array(z.string()).optional() }); async function handler(req: Request) { const query=QuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams)); return Response.json(query); } export { handler as GET };`,
  );
  const result = await scan(root);
  const c = result.candidates.find((c) => c.name === 'search_invoices')!;
  assert.equal(c.supported, true);
  assert.deepEqual(c.inputSchema.properties?.query.required, ['status']);
});
test('body schema follows a single assignment inside try/catch', async (t) => {
  const root = await copied(t);
  const dir = path.join(root, 'app/api/tasks');
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'route.ts'),
    `import { z } from 'zod';
const CreateTaskSchema = z.object({ title: z.string().trim().min(1) });
export async function POST(request: Request) {
  let raw: unknown;
  try { raw = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = CreateTaskSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: 'Invalid task' }, { status: 400 });
  return Response.json(parsed.data);
}`,
  );
  const result = await scan(root);
  const candidate = result.candidates.find((c) => c.name === 'create_task')!;
  assert.equal(candidate.supported, true);
  assert.equal(candidate.inputSchema.properties?.body.properties?.title.minLength, 1);
});
test('service correlation does not match unrelated methods with identical names', async (t) => {
  const root = await copied(t);
  await writeFile(
    path.join(root, 'services/unrelated-service.ts'),
    'export class Other { static launchSequence() { return 1; } }',
  );
  const result = await scan(root);
  assert.equal(result.candidates.find((c) => c.name === 'launch_sequence')?.services.length, 1);
});
test('collision names are deterministic and diff reports all four states', async () => {
  const result = await scan(fixture);
  const duplicate = { ...result.endpoints[0], path: '/api/orgs/{org}/contacts', id: 'different' };
  const names = buildCandidates([...result.endpoints, duplicate], result.services).map(
    (c) => c.name,
  );
  assert.equal(new Set(names).size, names.length);
  const before = result.candidates;
  const current = [
    { ...before[0], description: 'Changed' },
    ...before.slice(2),
    { ...before[1], source: { ...before[1].source, route: '/api/new' } },
  ];
  assert.deepEqual(diffCapabilities(before, current), {
    unchanged: 4,
    changed: 1,
    removed: 1,
    added: 1,
  });
});
test('generation is repeatable, protects modified/unowned code and preserves scripts', async (t) => {
  const root = await copied(t);
  const result = await scan(root);
  const chosen = result.candidates.filter((c) => c.risk === 'read');
  await generate(result, chosen);
  await generate(result, chosen);
  const manifest = JSON.parse(await readFile(path.join(root, '.hive/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.capabilities, ['get_sequence', 'search_contacts']);
  await addPackageScript(root);
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.dev, 'next dev --hostname 127.0.0.1');
  assert.equal(pkg.scripts['hive:mcp'], 'npm --prefix .hive/mcp run dev');
  await writeFile(path.join(root, '.hive/mcp/src/server.ts'), '// developer edit');
  await assert.rejects(generate(result, chosen), /Preserving user changes/);
  assert.equal(
    await readFile(path.join(root, '.hive/mcp/src/server.ts'), 'utf8'),
    '// developer edit',
  );
});
test('generation refuses symlinked output and unowned existing files', async (t) => {
  const root = await copied(t);
  const result = await scan(root);
  await mkdir(path.join(root, '.hive/mcp/src'), { recursive: true });
  await writeFile(path.join(root, '.hive/mcp/src/server.ts'), 'custom');
  await assert.rejects(generate(result, []), /Preserving user changes/);
  await rm(path.join(root, '.hive'), { recursive: true });
  await symlink(path.join(root, 'lib'), path.join(root, '.hive'));
  await assert.rejects(generate(result, []), /Refusing symlink/);
});
