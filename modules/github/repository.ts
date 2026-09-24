import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { installationClient } from './client';
import { HiveError } from '@/lib/errors';
const permitted = (file: string) =>
  !file
    .split('/')
    .some(
      (s) =>
        s.startsWith('.') || ['node_modules', 'dist', 'build', 'coverage', 'vendor'].includes(s),
    ) &&
  /(?:\.tsx?|\.prisma|(?:^|\/)package\.json)$/.test(file) &&
  !/\.(test|spec|d)\.tsx?$/.test(file);
export async function downloadRepository(
  app: {
    installationId: number;
    repositoryId: number;
    repositoryOwner: string;
    repositoryName: string;
    defaultBranch: string;
  },
  root: string,
) {
  const client = await installationClient(app.installationId, app.repositoryId);
  const params = { owner: app.repositoryOwner, repo: app.repositoryName };
  const { data: commit } = await client.repos.getCommit({ ...params, ref: app.defaultBranch });
  const { data: tree } = await client.git.getTree({
    ...params,
    tree_sha: commit.commit.tree.sha,
    recursive: '1',
  });
  if (tree.truncated) throw new HiveError('REPOSITORY_TREE_TRUNCATED');
  const entries = tree.tree.filter(
    (e) => e.type === 'blob' && e.mode !== '120000' && e.path && permitted(e.path),
  );
  if (entries.length > 1500 || entries.reduce((sum, e) => sum + (e.size ?? 0), 0) > 12_000_000)
    throw new HiveError('REPOSITORY_LIMIT_EXCEEDED');
  for (const entry of entries) {
    if (!entry.path || !entry.sha || (entry.size ?? 0) > 256000) continue;
    const destination = path.resolve(root, entry.path);
    if (!destination.startsWith(path.resolve(root) + path.sep))
      throw new HiveError('INVALID_REPOSITORY_PATH');
    const { data: blob } = await client.git.getBlob({ ...params, file_sha: entry.sha });
    if (blob.encoding !== 'base64' || (blob.size ?? 0) > 256000) continue;
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, Buffer.from(blob.content, 'base64'), { mode: 0o600 });
  }
  return commit.sha;
}
