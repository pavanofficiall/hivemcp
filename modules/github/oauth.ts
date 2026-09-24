import { z } from 'zod';
import { db } from '@/lib/db';
import { appUrl, required, configured, githubAppSlug, githubKeys } from '@/lib/config';
import { HiveError } from '@/lib/errors';
import { encrypt, hash, randomToken } from '@/modules/security/crypto';
import { Octokit } from '@octokit/rest';
export async function githubStart(userId: string) {
  if (!configured(githubKeys)) throw new HiveError('GITHUB_CONFIGURATION_REQUIRED', 503);
  const state = randomToken();
  await db.oAuthState.create({
    data: {
      id: hash(state),
      purpose: 'github',
      userId,
      payload: {},
      expiresAt: new Date(Date.now() + 600000),
    },
  });
  return `https://github.com/apps/${encodeURIComponent(githubAppSlug())}/installations/new?state=${state}`;
}
export async function githubCallback(params: URLSearchParams, userId: string) {
  const state = params.get('state') ?? '';
  const record = await db.oAuthState.findUnique({ where: { id: hash(state) } });
  if (
    !record ||
    record.userId !== userId ||
    record.purpose !== 'github' ||
    record.expiresAt <= new Date()
  )
    throw new HiveError('INVALID_OAUTH_STATE');
  const code = params.get('code');
  if (!code) {
    return `https://github.com/login/oauth/authorize?${new URLSearchParams({ client_id: required('GITHUB_CLIENT_ID'), redirect_uri: `${appUrl()}/api/github/callback`, state })}`;
  }
  const consumed = await db.oAuthState.deleteMany({ where: { id: record.id } });
  if (consumed.count !== 1) throw new HiveError('INVALID_OAUTH_STATE');
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: required('GITHUB_CLIENT_ID'),
      client_secret: required('GITHUB_CLIENT_SECRET'),
      code,
      redirect_uri: `${appUrl()}/api/github/callback`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new HiveError('GITHUB_OAUTH_FAILED');
  const token = z
    .object({ access_token: z.string(), expires_in: z.number().optional() })
    .parse(await response.json());
  const { data: user } = await new Octokit({ auth: token.access_token }).users.getAuthenticated();
  const data = {
    githubUserId: String(user.id),
    login: user.login,
    encryptedAccessToken: encrypt(token.access_token, `github:${userId}`),
    expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null,
  };
  await db.gitHubConnection.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return `${appUrl()}/applications?connected=github`;
}
