import { z } from 'zod';
import { appUrl } from '@/lib/config';
import { db } from '@/lib/db';
import { HiveError } from '@/lib/errors';
import { encrypt, decrypt, hash, randomToken } from '@/modules/security/crypto';
import { safeHttp, validateBaseUrl } from '@/modules/security/http';
import { createHash } from 'node:crypto';
export const metadataSchema = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  userinfo_endpoint: z.string().url(),
  code_challenge_methods_supported: z.array(z.string()).optional(),
});
async function metadata(issuer: string) {
  const origin = validateBaseUrl(issuer);
  const result = await safeHttp(new URL('/.well-known/openid-configuration', origin));
  if (result.status !== 200) throw new HiveError('APPLICATION_OAUTH_DISCOVERY_FAILED');
  const metadata = metadataSchema.parse(result.data);
  if (
    metadata.issuer.replace(/\/$/, '') !== origin ||
    [metadata.authorization_endpoint, metadata.token_endpoint, metadata.userinfo_endpoint].some(
      (endpoint) => new URL(endpoint).origin !== origin,
    )
  )
    throw new HiveError('INVALID_OAUTH_METADATA');
  if (
    metadata.code_challenge_methods_supported &&
    !metadata.code_challenge_methods_supported.includes('S256')
  )
    throw new HiveError('APPLICATION_PKCE_REQUIRED');
  return metadata;
}
export async function beginApplicationOAuth(applicationId: string, userId: string) {
  const env = await db.applicationEnvironment.findUnique({ where: { applicationId } });
  if (!env) throw new HiveError('APPLICATION_NOT_CONNECTED');
  const discovery = await metadata(env.issuerUrl);
  const state = randomToken(),
    verifier = randomToken();
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  await db.oAuthState.create({
    data: {
      id: hash(state),
      userId,
      purpose: 'application',
      expiresAt: new Date(Date.now() + 600000),
      payload: {
        environmentId: env.id,
        applicationId,
        verifier: encrypt(verifier, `oauth:${userId}`),
      },
    },
  });
  const url = new URL(discovery.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: env.clientId,
    response_type: 'code',
    redirect_uri: `${appUrl()}/api/oauth/application/callback`,
    scope: env.scopes,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return url.toString();
}
const tokensSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.string().refine((v) => v.toLowerCase() === 'bearer'),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive().max(31536000),
});
export async function finishApplicationOAuth(code: string, state: string, userId: string) {
  const record = await db.oAuthState.findUnique({ where: { id: hash(state) } });
  if (
    !record ||
    record.userId !== userId ||
    record.purpose !== 'application' ||
    record.expiresAt <= new Date()
  )
    throw new HiveError('INVALID_OAUTH_STATE');
  const removed = await db.oAuthState.deleteMany({ where: { id: record.id } });
  if (removed.count !== 1) throw new HiveError('INVALID_OAUTH_STATE');
  const payload = z
    .object({ environmentId: z.string(), applicationId: z.string(), verifier: z.string() })
    .parse(record.payload);
  const env = await db.applicationEnvironment.findUniqueOrThrow({
    where: { id: payload.environmentId },
  });
  const discovery = await metadata(env.issuerUrl);
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: env.clientId,
    redirect_uri: `${appUrl()}/api/oauth/application/callback`,
    code_verifier: decrypt(payload.verifier, `oauth:${userId}`),
  });
  if (env.encryptedClientSecret)
    form.set('client_secret', decrypt(env.encryptedClientSecret, `env:${env.id}`));
  const result = await safeHttp(new URL(discovery.token_endpoint), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (result.status !== 200) throw new HiveError('APPLICATION_OAUTH_EXCHANGE_FAILED');
  const tokens = tokensSchema.parse(result.data);
  const identity = await safeHttp(new URL(discovery.userinfo_endpoint), {
    headers: { authorization: `Bearer ${tokens.access_token}` },
  });
  if (identity.status !== 200) throw new HiveError('APPLICATION_IDENTITY_FAILED');
  const { sub } = z.object({ sub: z.string().min(1) }).parse(identity.data);
  const context = `application:${env.id}:${userId}`;
  const data = {
    subject: sub,
    encryptedAccessToken: encrypt(tokens.access_token, context),
    encryptedRefreshToken: tokens.refresh_token ? encrypt(tokens.refresh_token, context) : null,
    expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
  };
  await db.applicationCredential.upsert({
    where: { environmentId_userId: { environmentId: env.id, userId } },
    create: { environmentId: env.id, userId, ...data },
    update: data,
  });
  await db.applicationEnvironment.update({ where: { id: env.id }, data: { status: 'CONNECTED' } });
  return payload.applicationId;
}
export async function applicationToken(environmentId: string, userId: string) {
  const credential = await db.applicationCredential.findUnique({
    where: { environmentId_userId: { environmentId, userId } },
  });
  if (!credential) throw new HiveError('APPLICATION_AUTHORIZATION_REQUIRED', 401);
  // Reauthorization is explicit in V1 when an application token expires.
  if (credential.expiresAt <= new Date())
    throw new HiveError('APPLICATION_REAUTHORIZATION_REQUIRED', 401);
  return decrypt(credential.encryptedAccessToken, `application:${environmentId}:${userId}`);
}
