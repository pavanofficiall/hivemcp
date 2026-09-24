import { readdir, readFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { HiveError } from '@/lib/errors';
import { redactSource } from '@/modules/security/redact';
const ignored = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.hive',
  'vendor',
  '.turbo',
  '__tests__',
  'fixtures',
]);
export async function sourceFiles(root: string) {
  const files: { path: string; content: string }[] = [];
  let bytes = 0;
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || ignored.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (!/\.(tsx?|prisma)$/.test(entry.name) && entry.name !== 'package.json') continue;
      if (/\.(test|spec|d)\.tsx?$/.test(entry.name)) continue;
      const stat = await lstat(absolute);
      if (!stat.isFile() || stat.size > 256_000) continue;
      bytes += stat.size;
      if (bytes > 12_000_000 || files.length >= 1500)
        throw new HiveError('REPOSITORY_LIMIT_EXCEEDED');
      files.push({
        path: path.relative(root, absolute).replaceAll('\\', '/'),
        content: redactSource(await readFile(absolute, 'utf8')),
      });
    }
  }
  await walk(root);
  return files;
}
