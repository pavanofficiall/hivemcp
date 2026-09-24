import { createHash } from 'node:crypto';
import { db } from '@/lib/db';
import { HiveError } from '@/lib/errors';
import { appUrl } from '@/lib/config';
import { hash, randomToken, equal } from '@/modules/security/crypto';
import { z } from 'zod';
export const redirectUri = z
  .string()
  .url()
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.hash &&
      !url.username &&
      !url.password &&
      (url.protocol === 'https:' ||
        (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
    );
  }, 'Use HTTPS or a localhost callback, without credentials or fragments');
export async function issueToken(userId: string, applicationId: string, clientId: string) {
  const access = randomToken(),
    refresh = randomToken();
  await db.agentToken.create({
    data: {
      userId,
      applicationId,
      clientId,
      accessHash: hash(access),
      refreshHash: hash(refresh),
      expiresAt: new Date(Date.now() + 3600000),
      refreshExpiresAt: new Date(Date.now() + 30 * 86400000),
    },
  });
  return {
    access_token: access,
    refresh_token: refresh,
    token_type: 'Bearer',
    expires_in: 3600,
    scope: 'capabilities:execute',
  };
}
export async function authenticateAgent(request: Request, slug: string) {
  const application = await db.application.findUnique({ where: { slug } });
  const match = /^Bearer ([A-Za-z0-9_-]{40,})$/.exec(request.headers.get('authorization') ?? '');
  if (!match) throw new HiveError('AUTHENTICATION_REQUIRED', 401);
  const token = await db.agentToken.findUnique({ where: { accessHash: hash(match[1]) } });
  if (!token || token.revokedAt || token.expiresAt <= new Date())
    throw new HiveError('INVALID_TOKEN', 401);
  if (!application) throw new HiveError('APPLICATION_NOT_FOUND', 404);
  if (token.applicationId !== application.id || token.userId !== application.userId)
    throw new HiveError('APPLICATION_ACCESS_DENIED', 403);
  if (!application.enabled || !application.published)
    throw new HiveError('APPLICATION_NOT_PUBLISHED', 403);
  return { application, token };
}
export const authorizationRequest = z.object({
  client_id: z.string(),
  redirect_uri: redirectUri,
  response_type: z.literal('code'),
  code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  code_challenge_method: z.literal('S256'),
  resource: z.string().url(),
  state: z.string().min(16).max(2048),
  scope: z.literal('capabilities:execute').optional(),
});
export async function validateAuthorization(query: unknown, userId: string) {
  const input = authorizationRequest.parse(query);
  const client = await db.oAuthClient.findUnique({ where: { id: input.client_id } });
  if (!client || client.userId !== userId || !client.redirectUris.includes(input.redirect_uri))
    throw new HiveError('INVALID_OAUTH_CLIENT', 400);
  const application = await db.application.findUnique({ where: { id: client.applicationId } });
  if (
    !application ||
    application.userId !== userId ||
    !application.enabled ||
    !application.published ||
    input.resource !== `${appUrl()}/mcp/${application.slug}`
  )
    throw new HiveError('INVALID_RESOURCE', 400);
  return { input, client, application };
}
export async function authorize(query: unknown, userId: string) {
  const { input, client, application } = await validateAuthorization(query, userId);
  const code = randomToken();
  await db.oAuthCode.create({
    data: {
      id: hash(code),
      clientId: client.id,
      userId,
      applicationId: application.id,
      redirectUri: input.redirect_uri,
      challenge: input.code_challenge,
      resource: input.resource,
      expiresAt: new Date(Date.now() + 120000),
    },
  });
  const redirect = new URL(input.redirect_uri);
  redirect.searchParams.set('code', code);
  redirect.searchParams.set('state', input.state);
  return redirect.toString();
}
export async function exchangeToken(form: Record<string, string>) {
  if (form.grant_type === 'authorization_code') {
    const data = z
      .object({
        code: z.string(),
        client_id: z.string(),
        redirect_uri: redirectUri,
        code_verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
        resource: z.string().url(),
      })
      .parse(form);
    const record = await db.oAuthCode.findUnique({ where: { id: hash(data.code) } });
    if (
      !record ||
      record.expiresAt <= new Date() ||
      record.clientId !== data.client_id ||
      record.redirectUri !== data.redirect_uri ||
      record.resource !== data.resource ||
      !equal(record.challenge, createHash('sha256').update(data.code_verifier).digest('base64url'))
    )
      throw new HiveError('invalid_grant', 400);
    const consumed = await db.oAuthCode.deleteMany({ where: { id: record.id } });
    if (consumed.count !== 1) throw new HiveError('invalid_grant', 400);
    return issueToken(record.userId, record.applicationId, record.clientId);
  }
  if (form.grant_type === 'refresh_token') {
    const data = z
      .object({ refresh_token: z.string(), client_id: z.string(), resource: z.string().url() })
      .parse(form);
    const record = await db.agentToken.findUnique({
      where: { refreshHash: hash(data.refresh_token) },
    });
    if (
      !record ||
      record.revokedAt ||
      record.refreshExpiresAt <= new Date() ||
      record.clientId !== data.client_id
    )
      throw new HiveError('invalid_grant', 400);
    const app = await db.application.findUnique({ where: { id: record.applicationId } });
    if (
      !app ||
      !app.enabled ||
      !app.published ||
      app.userId !== record.userId ||
      data.resource !== `${appUrl()}/mcp/${app.slug}`
    )
      throw new HiveError('invalid_grant', 400);
    const changed = await db.agentToken.updateMany({
      where: { id: record.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (changed.count !== 1) throw new HiveError('invalid_grant', 400);
    return issueToken(record.userId, record.applicationId, record.clientId);
  }
  throw new HiveError('unsupported_grant_type', 400);
}
