import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { required } from '@/lib/config';
import { HiveError } from '@/lib/errors';
import { db } from '@/lib/db';
import { decrypt } from '@/modules/security/crypto';
import { z } from 'zod';
export const repositoryMetadata = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  owner: z.object({ login: z.string() }),
  default_branch: z.string(),
});
export async function installationClient(installationId: number, repositoryId?: number) {
  const auth = createAppAuth({
    appId: required('GITHUB_APP_ID'),
    privateKey: required('GITHUB_APP_PRIVATE_KEY').replaceAll('\\n', '\n'),
    installationId,
  });
  const token = await auth({
    type: 'installation',
    ...(repositoryId ? { repositoryIds: [repositoryId] } : {}),
  });
  return new Octokit({ auth: token.token });
}
export async function userClient(userId: string) {
  const connection = await db.gitHubConnection.findUnique({ where: { userId } });
  if (!connection || (connection.expiresAt && connection.expiresAt <= new Date()))
    throw new HiveError('GITHUB_RECONNECT_REQUIRED', 401);
  return new Octokit({ auth: decrypt(connection.encryptedAccessToken, `github:${userId}`) });
}
export async function accessibleRepositories(userId: string) {
  const client = await userClient(userId);
  const installations = await client.paginate('GET /user/installations', { per_page: 100 });
  const repositories = [];
  for (const installation of installations) {
    if (installation.app_id !== Number(required('GITHUB_APP_ID'))) continue;
    const repos = await client.paginate('GET /user/installations/{installation_id}/repositories', {
      installation_id: installation.id,
      per_page: 100,
    });
    for (const repo of repos)
      repositories.push({ ...repositoryMetadata.parse(repo), installationId: installation.id });
  }
  return repositories;
}
