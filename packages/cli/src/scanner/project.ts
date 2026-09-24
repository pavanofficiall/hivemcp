import { readFile, readdir, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
export type ProjectInfo = {
  root: string;
  name: string;
  framework: 'nextjs';
  language: 'typescript';
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun';
  appDirectory: string;
  zod: boolean;
  prisma: boolean;
  nextConfig: boolean;
};
export async function exists(file: string) {
  try {
    return !(await lstat(file)).isSymbolicLink();
  } catch (error: any) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
export async function detectProject(directory: string): Promise<ProjectInfo> {
  const root = await realpath(directory);
  let pkg;
  try {
    pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  } catch {
    throw new Error('A valid package.json is required. Run Hive in the application root.');
  }
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const appDirectory = (await exists(path.join(root, 'app'))) ? 'app' : 'src/app';
  if (
    !deps.next ||
    !(await exists(path.join(root, 'tsconfig.json'))) ||
    !(await exists(path.join(root, appDirectory)))
  ) {
    throw new Error(
      `Hive v0.1 supports Next.js + TypeScript + App Router. ${deps.next ? 'This project is missing tsconfig.json or an app directory.' : 'This project does not declare Next.js.'}`,
    );
  }
  const entries = await readdir(root);
  return {
    root,
    name: pkg.name ?? path.basename(root),
    framework: 'nextjs',
    language: 'typescript',
    appDirectory,
    packageManager: entries.includes('pnpm-lock.yaml')
      ? 'pnpm'
      : entries.includes('yarn.lock')
        ? 'yarn'
        : entries.some((x) => /^bun.lockb?$/.test(x))
          ? 'bun'
          : 'npm',
    zod: !!deps.zod,
    prisma:
      !!deps.prisma ||
      !!deps['@prisma/client'] ||
      (await exists(path.join(root, 'prisma/schema.prisma'))),
    nextConfig: entries.some((x) => /^next.config\.(ts|js|mjs|cjs)$/.test(x)),
  };
}
const ignored = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.hive',
  'generated',
  '__generated__',
  'vendor',
  'tests',
  '__tests__',
  'fixtures',
]);
export async function indexFiles(root: string) {
  const files: { path: string; content: string }[] = [];
  let bytes = 0;
  async function walk(dir: string) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || ignored.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolute);
        continue;
      }
      if (
        !/\.(tsx?|prisma)$/.test(entry.name) ||
        /\.(test|spec|d|generated)\.tsx?$/.test(entry.name)
      )
        continue;
      const stat = await lstat(absolute);
      if (!stat.isFile() || stat.size > 256_000) continue;
      bytes += stat.size;
      if (bytes > 20_000_000 || files.length >= 3000)
        throw new Error(
          'Repository exceeds v0.1 analysis limit (3,000 files / 20 MB). Scan one application package.',
        );
      const content = await readFile(absolute, 'utf8');
      if (
        content.includes('\0') ||
        /@generated|automatically generated/i.test(content.slice(0, 400))
      )
        continue;
      files.push({ path: path.relative(root, absolute).replaceAll('\\', '/'), content });
    }
  }
  await walk(root);
  return files;
}
