import { Node, SyntaxKind, type Project } from 'ts-morph';
import { callsIn, permissionsIn } from '../parsers/services';
import type { Endpoint, JsonSchema, SchemaInfo, ServiceInfo } from '../types';
const object = (
  properties: Record<string, JsonSchema> = {},
  required: string[] = [],
): JsonSchema => ({ type: 'object', properties, required, additionalProperties: false });
export function routePath(file: string) {
  return (
    '/' +
    file
      .replace(/^(?:src\/)?app\//, '')
      .replace(/\/route\.tsx?$/, '')
      .split('/')
      .filter((segment) => !/^\(.*\)$/.test(segment))
      .map((segment) => segment.replace(/^\[([^\]]+)\]$/, '{$1}'))
      .join('/')
  );
}
export function extractEndpoints(
  project: Project,
  schemas: SchemaInfo[],
  services: ServiceInfo[],
  relative: (path: string) => string,
): Endpoint[] {
  const endpoints: Endpoint[] = [];
  for (const file of project.getSourceFiles()) {
    const filePath = relative(file.getFilePath());
    if (!/^(src\/)?app\/.*route\.ts$/.test(filePath)) continue;
    for (const [method, declarations] of file.getExportedDeclarations()) {
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) continue;
      const declaration = declarations[0];
      const node = Node.isVariableDeclaration(declaration)
        ? declaration.getInitializer()
        : declaration;
      if (!node) continue;
      const warnings: string[] = [];
      if (
        !Node.isFunctionDeclaration(node) &&
        !Node.isArrowFunction(node) &&
        !Node.isFunctionExpression(node)
      )
        warnings.push('Wrapped handler requires manual analyzer support.');
      const path = routePath(filePath);
      if (path.includes('...') || path.includes('@') || !path.startsWith('/api/'))
        warnings.push('Unsupported route convention.');
      const calls = callsIn(node);
      const matched = services
        .filter((service) =>
          calls.some(
            (call) => call === service.name || call.endsWith(`.${service.name.split('.').at(-1)}`),
          ),
        )
        .filter((service) =>
          file.getImportDeclarations().some(
            (i) =>
              i.getModuleSpecifierSourceFile()?.getFilePath() ===
              project
                .getSourceFiles()
                .find((f) => relative(f.getFilePath()) === service.file)
                ?.getFilePath(),
          ),
        );
      const permissions = [
        ...new Set([...permissionsIn(node), ...matched.flatMap((s) => s.permissions)]),
      ];
      const linked: SchemaInfo[] = [];
      for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        const access = call.getExpression();
        if (
          !Node.isPropertyAccessExpression(access) ||
          !['parse', 'safeParse', 'parseAsync', 'safeParseAsync'].includes(access.getName())
        )
          continue;
        const symbol = access.getExpression().getSymbol();
        const decl = (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
        const found = schemas.find(
          (s) =>
            s.name === access.getExpression().getText() &&
            (decl ? s.file === relative(decl.getSourceFile().getFilePath()) : s.file === filePath),
        );
        if (found) linked.push(found);
        else warnings.push('An input schema could not be resolved.');
      }
      const pathFields = Object.fromEntries(
        [...path.matchAll(/\{([^}]+)\}/g)].map(([, name]) => [
          name,
          { type: 'string', minLength: 1, maxLength: 256 },
        ]),
      );
      const queryFields: Record<string, JsonSchema> = {};
      for (const call of node.getDescendantsOfKind(SyntaxKind.CallExpression)) {
        if (/searchParams\.get$/.test(call.getExpression().getText())) {
          const arg = call.getArguments()[0];
          if (arg && Node.isStringLiteral(arg))
            queryFields[arg.getLiteralValue()] = { type: 'string', maxLength: 2000 };
          else warnings.push('Dynamic query parameter.');
        }
      }
      if (/searchParams/.test(node.getText()) && !Object.keys(queryFields).length)
        warnings.push('Query object mapping is not resolved.');
      const hasBody = /\.json\s*\(/.test(node.getText());
      const body = hasBody && linked.length === 1 ? linked[0].schema : object();
      if (hasBody && linked.length !== 1) warnings.push('Body schema must resolve unambiguously.');
      if (linked.some((s) => !s.supported))
        warnings.push('Schema contains unsupported static constructs.');
      if (/\.formData\s*\(|\.text\s*\(/.test(node.getText()))
        warnings.push('Only JSON input is supported.');
      const inputSchema = object(
        { path: object(pathFields, Object.keys(pathFields)), query: object(queryFields), body },
        [...(Object.keys(pathFields).length ? ['path'] : []), ...(hasBody ? ['body'] : [])],
      );
      endpoints.push({
        id: `${method} ${path}`,
        path,
        method,
        file: filePath,
        handler: method,
        line: node.getStartLineNumber(),
        calls,
        services: matched.map((s) => s.id),
        permissions,
        schemaIds: linked.map((s) => s.id),
        inputSchema,
        supported: !warnings.length,
        warnings,
        evidence: [
          {
            file: filePath,
            symbol: method,
            line: node.getStartLineNumber(),
            reason: 'Exported Next.js route handler',
            snippet: node.getText().slice(0, 6000),
          },
          ...matched.map((s) => ({
            file: s.file,
            symbol: s.name,
            line: s.line,
            reason: 'Imported business service called by handler',
            snippet: s.snippet,
          })),
        ],
      });
    }
  }
  return endpoints;
}
