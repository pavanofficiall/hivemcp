/** Real HTTP + PostgreSQL integration against a synthetic ticket application.
 * This is not an Orbit/GitHub/Gemini acceptance test. External provider calls are not fabricated.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db';
import { appUrl } from '../lib/config';
import { fixture } from '../tests/fixture';
import { analyzeRepository } from '../modules/analysis';
import { validateInference, candidate } from '../modules/ai/gemini';
import { randomToken, hash } from '../modules/security/crypto';
const base = appUrl();
const runId = randomUUID().replaceAll('-', '');
const table = `hive_test_${runId}`;
const email = `integration-${runId}@example.invalid`;
let cookie = '',
  userId = '',
  applicationId = '',
  workspace = '',
  client: Client | undefined,
  passed = 0,
  role = 'writer',
  fixtureOrigin = '';
const fixtureAccess = randomToken();
const authorizations = new Map<string, { challenge: string; redirect: string }>();
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
function ok(message: string) {
  passed++;
  console.log(`PASS ${message}`);
}
async function request(route: string, method = 'GET', body?: unknown, auth = true) {
  const response = await fetch(`${base}${route}`, {
    method,
    redirect: 'manual',
    headers: {
      ...(auth ? { cookie } : {}),
      ...(method !== 'GET' ? { origin: base } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return response;
}
async function expectStatus(response: Response, status: number) {
  assert.equal(
    response.status,
    status,
    `HTTP ${response.status}: ${await response.clone().text()}`,
  );
  return response;
}
const fixtureServer = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', fixtureOrigin);
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(data));
    };
    if (url.pathname === '/.well-known/openid-configuration')
      return send(200, {
        issuer: fixtureOrigin,
        authorization_endpoint: `${fixtureOrigin}/authorize`,
        token_endpoint: `${fixtureOrigin}/token`,
        userinfo_endpoint: `${fixtureOrigin}/userinfo`,
        code_challenge_methods_supported: ['S256'],
      });
    if (url.pathname === '/authorize') {
      const code = randomToken();
      authorizations.set(code, {
        challenge: url.searchParams.get('code_challenge')!,
        redirect: url.searchParams.get('redirect_uri')!,
      });
      const target = new URL(url.searchParams.get('redirect_uri')!);
      target.searchParams.set('code', code);
      target.searchParams.set('state', url.searchParams.get('state')!);
      res.writeHead(302, { location: target.toString() });
      res.end();
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    if (url.pathname === '/token') {
      const input = new URLSearchParams(body);
      const saved = authorizations.get(input.get('code') ?? '');
      if (
        !saved ||
        saved.redirect !== input.get('redirect_uri') ||
        saved.challenge !==
          createHash('sha256')
            .update(input.get('code_verifier') ?? '')
            .digest('base64url')
      )
        return send(400, { error: 'invalid_grant' });
      authorizations.delete(input.get('code')!);
      return send(200, { access_token: fixtureAccess, token_type: 'Bearer', expires_in: 3600 });
    }
    if (req.headers.authorization !== `Bearer ${fixtureAccess}`)
      return send(401, { error: 'unauthorized' });
    if (url.pathname === '/userinfo') return send(200, { sub: 'synthetic-ticket-user' });
    if (url.pathname === '/api/tickets' && req.method === 'POST') {
      if (role !== 'writer') return send(403, { error: 'TICKET_CREATE required' });
      const input = JSON.parse(body);
      if (!input.title || input.title === 'blocked') return send(422, { error: 'Invalid title' });
      const id = randomUUID();
      await db.$executeRawUnsafe(
        `INSERT INTO "${table}" (id,title) VALUES ($1,$2)`,
        id,
        input.title,
      );
      return send(201, { id, title: input.title, access_token: 'fixture-secret-must-be-redacted' });
    }
    if (url.pathname === '/api/tickets' && req.method === 'GET')
      return send(200, await db.$queryRawUnsafe(`SELECT id,title FROM "${table}"`));
    return send(404, { error: 'not_found' });
  } catch {
    res.writeHead(500);
    res.end('{}');
  }
});
try {
  await db.$executeRawUnsafe(`CREATE TABLE "${table}" (id text PRIMARY KEY,title text NOT NULL)`);
  await new Promise<void>((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));
  fixtureOrigin = `http://127.0.0.1:${(fixtureServer.address() as { port: number }).port}`;
  const password = randomToken();
  const registration = await expectStatus(
    await request(
      '/api/auth/register',
      'POST',
      { email, password, name: 'Integration Fixture' },
      false,
    ),
    200,
  );
  cookie = registration.headers.get('set-cookie')!.split(';')[0];
  assert(cookie.startsWith('hive_session='));
  assert(registration.headers.get('set-cookie')!.includes('HttpOnly'));
  ok('Secure account registration and session cookie');
  userId = (await db.user.findUniqueOrThrow({ where: { email } })).id;
  await expectStatus(await request('/api/applications', 'GET', undefined, false), 401);
  ok('Unauthenticated dashboard API rejected');
  const csrf = await fetch(`${base}/api/applications`, {
    method: 'POST',
    headers: { cookie, origin: 'https://evil.example', 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(csrf.status, 403);
  ok('Cross-origin mutation rejected');
  const app = await db.application.create({
    data: {
      userId,
      name: 'Synthetic Ticket Fixture',
      slug: `test-${runId}`,
      installationId: 1,
      repositoryId: Math.floor(Math.random() * 1000000000),
      repositoryOwner: 'test-fixture',
      repositoryName: 'synthetic-tickets',
      defaultBranch: 'main',
    },
  });
  applicationId = app.id;
  await mkdir('.hive/tests', { recursive: true });
  workspace = await mkdtemp(path.resolve('.hive/tests/integration-'));
  for (const [name, content] of Object.entries(fixture)) {
    await mkdir(path.dirname(path.join(workspace, name)), { recursive: true });
    await writeFile(path.join(workspace, name), content);
  }
  const index = await analyzeRepository(workspace);
  const endpoint = index.endpoints.find((e) => e.method === 'POST')!;
  // Explicit semantic provider contract fixture, never passed off as a live Gemini response.
  const inferred = validateInference(
    {
      name: 'create_ticket',
      displayName: 'Create Ticket',
      description: 'Create a ticket through its existing service.',
      category: 'tickets',
      implementation: { httpMethod: 'POST', route: '/api/tickets' },
      operationType: 'CREATE',
      preconditions: [],
      sideEffects: ['Creates a ticket.'],
      affectedModels: ['Ticket'],
      risk: 'medium',
      confidence: 0.95,
      idempotent: false,
      evidence: [{ file: endpoint.file, symbol: 'POST', reason: 'Fixture handler' }],
    },
    endpoint,
    index,
  );
  const { idempotent, ...fields } = candidate(inferred, endpoint, index);
  const run = await db.analysisRun.create({
    data: {
      applicationId,
      status: 'COMPLETED',
      stage: 'Synthetic test fixture',
      index: json(index),
    },
  });
  const cap = await db.capability.create({
    data: {
      ...fields,
      applicationId,
      analysisRunId: run.id,
      inputSchema: json(fields.inputSchema),
      implementation: json(fields.implementation),
      evidence: json(fields.evidence),
      permissions: json(fields.permissions),
      preconditions: json(fields.preconditions),
      sideEffects: json(fields.sideEffects),
      affectedModels: json(fields.affectedModels),
    },
  });
  ok('Actual static source analysis produces the execution mapping');
  await expectStatus(
    await request(`/api/apps/${app.id}/publish`, 'POST', { published: true }),
    409,
  );
  ok('Publication blocked before approval and application authorization');
  await expectStatus(
    await request(`/api/apps/${app.id}/capabilities/${cap.id}`, 'PATCH', { status: 'APPROVED' }),
    200,
  );
  await expectStatus(
    await request(`/api/apps/${app.id}/environment`, 'POST', {
      name: 'Synthetic fixture',
      baseUrl: fixtureOrigin,
      issuerUrl: fixtureOrigin,
      clientId: 'hive-test',
      scopes: 'openid profile',
    }),
    200,
  );
  const authStart = await (
    await expectStatus(await request(`/api/apps/${app.id}/authorize`, 'POST'), 200)
  ).json();
  const authorizeResponse = await fetch(authStart.url, { redirect: 'manual' });
  assert.equal(authorizeResponse.status, 302);
  const callback = new URL(authorizeResponse.headers.get('location')!);
  await expectStatus(await request(callback.pathname + callback.search), 302);
  const credential = await db.applicationCredential.findFirstOrThrow({ where: { userId } });
  assert.equal(credential.subject, 'synthetic-ticket-user');
  assert(!credential.encryptedAccessToken.includes(fixtureAccess));
  ok('Application OAuth code + PKCE, userinfo, encrypted per-user credential');
  await expectStatus(await request(callback.pathname + callback.search), 400);
  ok('Application OAuth state replay rejected');
  await expectStatus(
    await request(`/api/apps/${app.id}/publish`, 'POST', { published: true }),
    200,
  );
  const endpointUrl = `${base}/mcp/${app.slug}`;
  const missing = await fetch(endpointUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(missing.status, 401);
  assert(missing.headers.get('www-authenticate')?.includes('resource_metadata'));
  ok('MCP authentication challenge exposes protected resource metadata');
  const metadata = await (
    await fetch(`${base}/.well-known/oauth-protected-resource/mcp/${app.slug}`)
  ).json();
  assert.equal(metadata.resource, endpointUrl);
  ok('Application-specific OAuth resource discovery');
  const clientRecord = await (
    await expectStatus(
      await request(`/api/apps/${app.id}/clients`, 'POST', {
        name: 'Integration MCP Client',
        redirectUris: ['http://localhost:8099/callback'],
      }),
      200,
    )
  ).json();
  const verifier = randomToken();
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const consent = new URLSearchParams({
    client_id: clientRecord.id,
    redirect_uri: 'http://localhost:8099/callback',
    response_type: 'code',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: endpointUrl,
    state: randomToken(),
    scope: 'capabilities:execute',
    approve: 'yes',
  });
  const consentPage = await request(`/oauth/authorize?${consent}`);
  assert.equal(consentPage.status, 200);
  assert((await consentPage.text()).includes('Authorize client'));
  const denied = await fetch(`${base}/api/oauth/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, origin: base, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      ...Object.fromEntries(consent),
      redirect_uri: 'https://evil.example/callback',
    }),
  });
  assert.equal(denied.status, 400);
  ok('OAuth exact redirect URI validation');
  const granted = await fetch(`${base}/api/oauth/authorize`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie, origin: base, 'content-type': 'application/x-www-form-urlencoded' },
    body: consent,
  });
  assert.equal(granted.status, 303);
  const code = new URL(granted.headers.get('location')!).searchParams.get('code')!;
  const tokenForm = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientRecord.id,
    redirect_uri: 'http://localhost:8099/callback',
    code_verifier: verifier,
    resource: endpointUrl,
  });
  const exchange = () =>
    fetch(`${base}/api/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: tokenForm,
    });
  const tokenResponse = await exchange();
  assert.equal(tokenResponse.status, 200, await tokenResponse.clone().text());
  const token = await tokenResponse.json();
  assert.equal((await exchange()).status, 400);
  ok('Agent OAuth PKCE exchange and authorization-code replay rejection');
  const mcpRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    },
  };
  const rawMcp = (slug: string, access: string) =>
    fetch(`${base}/mcp/${slug}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${access}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(mcpRequest),
    });
  assert.equal((await rawMcp(app.slug, randomToken())).status, 401);
  ok('Invalid MCP access token rejected');
  const other = await db.application.create({
    data: {
      userId,
      name: 'Other fixture',
      slug: `other-${runId}`,
      installationId: 1,
      repositoryId: Math.floor(Math.random() * 1000000000),
      repositoryOwner: 'test',
      repositoryName: 'other',
      defaultBranch: 'main',
      published: true,
    },
  });
  assert.equal((await rawMcp(other.slug, token.access_token)).status, 403);
  ok('Tampered application slug rejected despite a valid token');
  await db.agentToken.update({
    where: { accessHash: hash(token.access_token) },
    data: { expiresAt: new Date(0) },
  });
  assert.equal((await rawMcp(app.slug, token.access_token)).status, 401);
  ok('Expired MCP access token rejected');
  await db.agentToken.update({
    where: { accessHash: hash(token.access_token) },
    data: { expiresAt: new Date(Date.now() + 3600000) },
  });
  client = new Client({ name: 'Hive integration test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpointUrl), {
      requestInit: { headers: { authorization: `Bearer ${token.access_token}` } },
    }),
  );
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 1);
  assert.equal(tools.tools[0].name, inferred.name);
  ok('Official MCP client initializes and discovers dynamically approved tool');
  const decode = (value: unknown) =>
    JSON.parse((value as { content: { text: string }[] }).content[0].text);
  const input = { body: { title: 'Integration changes real PostgreSQL state' } };
  const invalid = decode(
    await client.callTool({
      name: inferred.name,
      arguments: { body: { title: 'x' }, endpoint: 'https://evil.example' },
    }),
  );
  assert.equal(invalid.error, 'VALIDATION_ERROR');
  ok('Tool injection and invalid input rejected');
  const pending = decode(await client.callTool({ name: inferred.name, arguments: input }));
  assert.equal(pending.error, 'CONFIRMATION_REQUIRED');
  const count = await db.$queryRawUnsafe<{ count: bigint }[]>(`SELECT count(*) FROM "${table}"`);
  assert.equal(Number(count[0].count), 0);
  ok('Write blocked before human confirmation; database unchanged');
  const premature = decode(
    await client.callTool({
      name: inferred.name,
      arguments: { ...input, hive_confirmation_id: pending.details.confirmationId },
    }),
  );
  assert.equal(premature.error, 'INVALID_CONFIRMATION');
  ok('Agent cannot self-approve a pending write');
  await expectStatus(
    await request(`/api/apps/${app.id}/confirmations/${pending.details.confirmationId}`, 'POST'),
    200,
  );
  const wrongInput = decode(
    await client.callTool({
      name: inferred.name,
      arguments: {
        body: { title: 'Different input' },
        hive_confirmation_id: pending.details.confirmationId,
      },
    }),
  );
  assert.equal(wrongInput.error, 'INVALID_CONFIRMATION');
  ok('Confirmation bound to exact input');
  const executed = decode(
    await client.callTool({
      name: inferred.name,
      arguments: { ...input, hive_confirmation_id: pending.details.confirmationId },
    }),
  );
  assert.equal(executed.status, 201, JSON.stringify(executed));
  assert.equal(executed.data.access_token, '[REDACTED]');
  const stored = await db.$queryRawUnsafe<{ id: string; title: string }[]>(
    `SELECT * FROM "${table}" WHERE id=$1`,
    executed.data.id,
  );
  assert.equal(stored[0].title, input.body.title);
  ok('MCP → Hive execution → fixture HTTP service → real PostgreSQL write → sanitized response');
  const audit = await db.executionLog.findUniqueOrThrow({ where: { id: executed.executionId } });
  assert.equal(audit.status, 'SUCCEEDED');
  assert(!JSON.stringify(audit).includes(input.body.title));
  assert.equal(
    (await db.capability.findUniqueOrThrow({ where: { id: cap.id } })).status,
    'VERIFIED',
  );
  ok('Durable sanitized audit and successful-execution verification');
  const replay = decode(
    await client.callTool({
      name: inferred.name,
      arguments: { ...input, hive_confirmation_id: pending.details.confirmationId },
    }),
  );
  assert.equal(replay.error, 'INVALID_CONFIRMATION');
  ok('Confirmation cannot be replayed');
  role = 'reader';
  const permissionPending = decode(
    await client.callTool({ name: inferred.name, arguments: input }),
  );
  await request(
    `/api/apps/${app.id}/confirmations/${permissionPending.details.confirmationId}`,
    'POST',
  );
  const permissionDenied = decode(
    await client.callTool({
      name: inferred.name,
      arguments: { ...input, hive_confirmation_id: permissionPending.details.confirmationId },
    }),
  );
  assert.equal(permissionDenied.error, 'INSUFFICIENT_PERMISSION');
  ok('Application user permission failure propagates without bypass');
  await request(`/api/apps/${app.id}/capabilities/${cap.id}`, 'PATCH', { enabled: false });
  assert.equal((await client.listTools()).tools.length, 0);
  assert.equal(
    decode(await client.callTool({ name: inferred.name, arguments: input })).error,
    'CAPABILITY_DISABLED',
  );
  ok('Disabled capabilities disappear and cannot be invoked');
  await request(`/api/apps/${app.id}/capabilities/${cap.id}`, 'PATCH', { status: 'REJECTED' });
  assert.equal(
    decode(await client.callTool({ name: inferred.name, arguments: input })).error,
    'CAPABILITY_NOT_APPROVED',
  );
  ok('Rejected capabilities cannot be invoked');
  const refreshBody = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientRecord.id,
    refresh_token: token.refresh_token,
    resource: endpointUrl,
  });
  const refresh = () =>
    fetch(`${base}/api/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: refreshBody,
    });
  const refreshed = await refresh();
  assert.equal(refreshed.status, 200);
  const replacement = await refreshed.json();
  assert.equal((await refresh()).status, 400);
  assert.equal((await rawMcp(app.slug, token.access_token)).status, 401);
  ok('Refresh rotation invalidates old access and refresh tokens');
  await fetch(`${base}/api/oauth/revoke`, {
    method: 'POST',
    body: new URLSearchParams({ client_id: clientRecord.id, token: replacement.access_token }),
  });
  assert.equal((await rawMcp(app.slug, replacement.access_token)).status, 401);
  ok('OAuth revocation enforced');
  console.log(
    `\n${passed} integration checks passed. Synthetic application only; Orbit and provider acceptance remain untested.`,
  );
} finally {
  await client?.close();
  fixtureServer.closeAllConnections();
  await new Promise<void>((resolve) => fixtureServer.close(() => resolve()));
  if (userId) {
    const appIds = (await db.application.findMany({ where: { userId }, select: { id: true } })).map(
      (a) => a.id,
    );
    await db.capability.deleteMany({ where: { applicationId: { in: appIds } } });
    await db.confirmation.deleteMany({ where: { userId } });
    await db.agentToken.deleteMany({ where: { userId } });
    await db.oAuthClient.deleteMany({ where: { userId } });
    await db.oAuthCode.deleteMany({ where: { userId } });
    await db.oAuthState.deleteMany({ where: { userId } });
    await db.user.delete({ where: { id: userId } });
  }
  if (workspace) await rm(workspace, { recursive: true, force: true });
  await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${table}"`);
  await db.$disconnect();
}
