import { readFile } from 'node:fs/promises';
import { Project, ts } from 'ts-morph';
import { detectProject, indexFiles } from './project.js';
import { extractSchemas } from '../analyzers/parsers/zod.js';
import { extractServices } from '../analyzers/parsers/services.js';
import { parsePrisma } from '../analyzers/parsers/prisma.js';
import { extractEndpoints } from '../analyzers/nextjs/routes.js';
import { buildCandidates } from '../capabilities/build.js';
export async function scan(directory: string) {
  const application = await detectProject(directory);
  const sources = await indexFiles(application.root);
  const config = ts.parseConfigFileTextToJson(
    'tsconfig.json',
    await readFile(`${application.root}/tsconfig.json`, 'utf8'),
  );
  if (config.error) throw new Error('Cannot parse tsconfig.json. Fix its syntax before scanning.');
  const compilerOptions = config.config?.compilerOptions ?? {};
  const warnings: string[] = [];
  if (config.config?.extends)
    warnings.push(
      'Inherited tsconfig aliases are not resolved in v0.0.2; declare paths locally if needed.',
    );
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: {
      baseUrl: '/' + (compilerOptions.baseUrl ?? '.'),
      paths: compilerOptions.paths ?? {},
      allowJs: false,
    },
  });
  for (const source of sources.filter((f) => /\.tsx?$/.test(f.path)))
    project.createSourceFile('/' + source.path, source.content);
  project.resolveSourceFileDependencies();
  const relative = (file: string) => file.replace(/^\//, '');
  const schemas = extractSchemas(project, relative);
  const services = extractServices(project, relative);
  const endpoints = extractEndpoints(project, schemas, services, relative);
  const models = sources
    .filter((f) => f.path.endsWith('.prisma'))
    .flatMap((f) => parsePrisma(f.content, f.path));
  const candidates = buildCandidates(endpoints, services);
  return {
    application,
    files: sources.length,
    schemas,
    services,
    endpoints,
    models,
    candidates,
    warnings,
  };
}
export type ScanResult = Awaited<ReturnType<typeof scan>>;
