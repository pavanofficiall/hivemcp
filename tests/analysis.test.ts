import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { Project } from 'ts-morph';
import { fixture } from './fixture';
import { analyzeRepository } from '@/modules/analysis';
import type { ApplicationIndex } from '@/modules/analysis/types';
import { routePath } from '@/modules/analysis/nextjs/routes';
import { parseZod } from '@/modules/analysis/parsers/zod';
import { buildGraph } from '@/modules/analysis/graph/build';
import {
  inferenceSchema,
  validateInference,
  candidate,
  deduplicate,
  geminiFailure,
} from '@/modules/ai/gemini';
import { repositoryMetadata } from '@/modules/github/client';
import { ApiError } from '@google/genai';
let root: string, index: ApplicationIndex;
beforeAll(async () => {
  await mkdir('.hive/tests', { recursive: true });
  root = await mkdtemp(path.resolve('.hive/tests/analyzer-'));
  for (const [name, content] of Object.entries(fixture)) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  }
  await symlink(path.join(root, '.env'), path.join(root, 'symlink.ts'));
  index = await analyzeRepository(root);
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});
describe('deterministic application understanding', () => {
  it('identifies framework and ignores secrets, dependency code, symlinks', () => {
    expect(index.framework).toBe('Next.js');
    expect(index.language).toBe('TypeScript');
    expect(index.files).toBe(7);
    expect(JSON.stringify(index)).not.toContain('must-never-be-indexed');
    expect(JSON.stringify(index)).not.toContain('ignored=true');
  });
  it('extracts routes and actual exported methods', () => {
    expect(index.endpoints.map((e) => e.id).sort()).toEqual([
      'DELETE /api/tickets/{id}',
      'GET /api/tickets',
      'POST /api/tickets',
    ]);
    expect(routePath('src/app/(private)/api/things/[id]/route.ts')).toBe('/api/things/{id}');
  });
  it('extracts input validation and query parameters', () => {
    const post = index.endpoints.find((e) => e.method === 'POST')!;
    expect(post.supported, post.warnings.join(',')).toBe(true);
    expect(post.inputSchema.properties?.body.required).toEqual(['title']);
    expect(post.inputSchema.properties?.body.properties?.title).toEqual({
      type: 'string',
      minLength: 3,
      maxLength: 80,
    });
    expect(
      index.endpoints.find((e) => e.method === 'GET')?.inputSchema.properties?.query.properties,
    ).toHaveProperty('status');
  });
  it('resolves imported business services and permission evidence', () => {
    const post = index.endpoints.find((e) => e.method === 'POST')!;
    expect(post.services).toEqual(['services/ticket-service.ts#TicketService.createTicket']);
    expect(post.permissions).toContain("requirePermission('TICKET_CREATE')");
    expect(
      index.services.find((s) => s.name === 'TicketService.createTicket')?.databaseOperations,
    ).toContain('prisma.ticket.create');
    expect(index.services.find((s) => s.name === 'TicketService.createTicket')?.rules[0]).toContain(
      'Title is reserved',
    );
  });
  it('extracts Prisma fields, relationships, enums and constraints', () => {
    expect(index.models).toHaveLength(3);
    expect(index.models[0].fields.find((f) => f.name === 'project')?.attributes).toContain(
      '@relation',
    );
    expect(index.models[0].constraints).toEqual(['@@index([projectId])']);
  });
  it('builds real graph links with no dangling references', () => {
    const graph = buildGraph(index);
    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(graph.edges.every((e) => ids.has(e.source) && ids.has(e.target))).toBe(true);
    expect(graph.edges.map((e) => e.kind)).toContain('HANDLER_CALLS_SERVICE');
    expect(graph.edges.map((e) => e.kind)).toContain('SERVICE_WRITES_MODEL');
  });
  it('flags unsupported Zod refinements instead of guessing', () => {
    const p = new Project({ useInMemoryFileSystem: true });
    const f = p.createSourceFile(
      '/test.ts',
      `const BadSchema=z.object({x:z.string().refine(v=>v==='special')})`,
    );
    expect(parseZod(f.getVariableDeclarations()[0].getInitializer()).supported).toBe(false);
  });
  it('parses GitHub metadata without treating IDs as authorization', () => {
    expect(
      repositoryMetadata.parse({
        id: 10,
        name: 'example',
        owner: { login: 'team' },
        default_branch: 'main',
        token: 'not-retained',
      }),
    ).not.toHaveProperty('token');
  });
});
describe('semantic output boundary', () => {
  const valid = () => ({
    name: 'create_ticket',
    displayName: 'Create Ticket',
    description: 'Create a ticket using the existing application service.',
    category: 'tickets',
    implementation: { httpMethod: 'POST' as const, route: '/api/tickets' },
    operationType: 'CREATE' as const,
    preconditions: ['Title must not be reserved.'],
    sideEffects: ['Creates a ticket.'],
    affectedModels: ['Ticket'],
    risk: 'medium' as const,
    confidence: 0.95,
    idempotent: false,
    evidence: [{ file: 'app/api/tickets/route.ts', symbol: 'POST', reason: 'Existing handler' }],
  });
  it('validates grounded semantic inference and defaults writes to confirmation', () => {
    const endpoint = index.endpoints.find((e) => e.method === 'POST')!;
    const value = validateInference(valid(), endpoint, index);
    const result = candidate(value, endpoint, index);
    expect(result.policy).toBe('confirmation_required');
    expect(result.enabled).toBe(false);
    expect(result.status).toBe('CANDIDATE');
  });
  it.each([
    { name: 'execute_api' },
    { implementation: { httpMethod: 'POST', route: '/api/admin' } },
    { affectedModels: ['Invented'] },
    { evidence: [{ file: 'fake.ts', symbol: 'POST', reason: 'Injected' }] },
    { operationType: 'READ' },
    { injected: 'unknown-field' },
  ])('rejects fabricated or unsafe output %j', (override) => {
    expect(() =>
      validateInference(
        { ...valid(), ...override },
        index.endpoints.find((e) => e.method === 'POST')!,
        index,
      ),
    ).toThrow();
  });
  it('rejects invalid Gemini JSON shape', () => {
    expect(inferenceSchema.safeParse({ name: 'ticket' }).success).toBe(false);
  });
  it.each([
    [404, 'GEMINI_MODEL_UNAVAILABLE'],
    [401, 'GEMINI_AUTHORIZATION_FAILED'],
    [429, 'GEMINI_QUOTA_EXCEEDED'],
    [500, 'GEMINI_PROVIDER_UNAVAILABLE'],
  ])('maps Gemini HTTP %i to a safe diagnostic code', (status, code) => {
    expect(geminiFailure(new ApiError({ status, message: 'provider detail' }))).toMatchObject({
      code,
    });
  });
  it('deduplicates by proven implementation and combines evidence', () => {
    const v = valid();
    const unique = deduplicate([
      v,
      {
        ...v,
        name: 'add_ticket',
        confidence: 0.9,
        evidence: [{ ...v.evidence[0], reason: 'Additional evidence' }],
      },
    ]);
    expect(unique).toHaveLength(1);
    expect(unique[0].name).toBe('create_ticket');
    expect(unique[0].evidence).toHaveLength(2);
  });
});
