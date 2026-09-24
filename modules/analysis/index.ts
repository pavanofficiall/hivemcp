import { Project, SyntaxKind } from 'ts-morph';
import { sourceFiles } from './parsers/files';
import { extractSchemas } from './parsers/zod';
import { parsePrisma } from './parsers/prisma';
import { extractServices } from './parsers/services';
import { extractEndpoints } from './nextjs/routes';
import type { ApplicationIndex } from './types';
export async function analyzeRepository(root: string): Promise<ApplicationIndex> {
  const sources = await sourceFiles(root);
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { baseUrl: '/', paths: { '@/*': ['./*', './src/*'] }, allowJs: false },
  });
  for (const source of sources.filter((f) => /\.tsx?$/.test(f.path)))
    project.createSourceFile('/' + source.path, source.content);
  project.resolveSourceFileDependencies();
  const relative = (path: string) => path.replace(/^\//, '');
  const schemas = extractSchemas(project, relative);
  const services = extractServices(project, relative);
  const endpoints = extractEndpoints(project, schemas, services, relative);
  const packages = sources
    .filter((f) => f.path.endsWith('package.json'))
    .map((f) => {
      try {
        return JSON.parse(f.content);
      } catch {
        return {};
      }
    });
  const framework = packages.some((p) => p.dependencies?.next || p.devDependencies?.next)
    ? 'Next.js'
    : 'Unknown';
  return {
    framework,
    language: 'TypeScript',
    files: project.getSourceFiles().length,
    routes: sources.filter((f) => /app\/.*\/page\.tsx?$/.test(f.path)).map((f) => f.path),
    endpoints,
    services,
    schemas,
    models: sources
      .filter((f) => f.path.endsWith('.prisma'))
      .flatMap((f) => parsePrisma(f.content, f.path)),
    authorization: project
      .getSourceFiles()
      .filter((f) => /auth|permission|middleware|rbac/i.test(f.getFilePath()))
      .map((f) => ({
        file: relative(f.getFilePath()),
        symbols: [...f.getExportedDeclarations().keys()],
      })),
    serverActions: project
      .getSourceFiles()
      .filter((f) => /["']use server["']/.test(f.getText()))
      .map((f) => ({
        file: relative(f.getFilePath()),
        symbols: [...f.getExportedDeclarations().keys()],
      })),
    warnings: [
      ...(framework === 'Unknown' ? ['Next.js dependency not found.'] : []),
      ...endpoints.flatMap((e) => e.warnings.map((w) => `${e.id}: ${w}`)),
    ],
  };
}
