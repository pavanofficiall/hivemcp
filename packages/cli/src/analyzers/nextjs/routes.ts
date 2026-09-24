import { Node, SyntaxKind, type Project } from 'ts-morph';
import { callsIn, permissionsIn } from '../parsers/services.js';
import type { Endpoint, JsonSchema, SchemaInfo, ServiceInfo } from '../types.js';
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
      .filter((s) => !/^\(.*\)$/.test(s))
      .map((s) => s.replace(/^\[([^\]]+)\]$/, '{$1}'))
      .join('/')
  );
}
function declarationOf(node: Node) {
  const symbol = node.getSymbol();
  return (symbol?.getAliasedSymbol() ?? symbol)?.getDeclarations()[0];
}
function isRequestJson(node: Node) {
  if (!Node.isCallExpression(node)) return false;
  const expr = node.getExpression();
  if (!Node.isPropertyAccessExpression(expr) || expr.getName() !== 'json') return false;
  const receiver = declarationOf(expr.getExpression());
  return !!receiver && Node.isParameterDeclaration(receiver);
}
// Follow local bindings to establish which request input a parse() consumes.
function origin(node: Node | undefined, seen = new Set<Node>()): 'body' | 'query' | undefined {
  if (!node || seen.has(node) || seen.size > 30) return;
  seen.add(node);
  if (Node.isAwaitExpression(node) || Node.isParenthesizedExpression(node))
    return origin(node.getExpression(), seen);
  if (Node.isIdentifier(node)) {
    const decl = declarationOf(node);
    if (decl && Node.isVariableDeclaration(decl)) return origin(decl.getInitializer(), seen);
  }
  if (Node.isCallExpression(node)) {
    const expr = node.getExpression();
    if (isRequestJson(node)) return 'body';
    for (const arg of node.getArguments()) {
      const found = origin(arg, new Set(seen));
      if (found) return found;
    }
  }
  if (Node.isPropertyAccessExpression(node) && node.getName() === 'searchParams') return 'query';
  return;
}
export function extractEndpoints(
  project: Project,
  schemas: SchemaInfo[],
  services: ServiceInfo[],
  relative: (p: string) => string,
): Endpoint[] {
  const endpoints: Endpoint[] = [];
  for (const file of project.getSourceFiles()) {
    const filePath = relative(file.getFilePath());
    if (!/^(src\/)?app\/(?:.*\/)?route\.ts$/.test(filePath)) continue;
    for (const [method, declarations] of file.getExportedDeclarations()) {
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) continue;
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
      const route = routePath(filePath);
      if (route.includes('...') || route.includes('@') || !route.startsWith('/api/'))
        warnings.push(
          'Unsupported route convention (only /api routes with single dynamic segments).',
        );
      const callNodes = node.getDescendantsOfKind(SyntaxKind.CallExpression);
      const calls = callsIn(node);
      const matched = services.filter((service) =>
        callNodes.some((call) => {
          const decl = declarationOf(call.getExpression());
          return (
            decl &&
            relative(decl.getSourceFile().getFilePath()) === service.file &&
            decl.getStartLineNumber() === service.line
          );
        }),
      );
      const linked: SchemaInfo[] = [];
      const bodies: SchemaInfo[] = [];
      const queries: SchemaInfo[] = [];
      for (const call of callNodes) {
        const access = call.getExpression();
        if (
          !Node.isPropertyAccessExpression(access) ||
          !['parse', 'safeParse', 'parseAsync', 'safeParseAsync'].includes(access.getName())
        )
          continue;
        const decl = declarationOf(access.getExpression());
        const found = schemas.find(
          (s) =>
            decl &&
            Node.isVariableDeclaration(decl) &&
            s.name === decl.getName() &&
            s.file === relative(decl.getSourceFile().getFilePath()),
        );
        const input = origin(call.getArguments()[0]);
        if (found) {
          linked.push(found);
          if (input === 'body') bodies.push(found);
          if (input === 'query') queries.push(found);
        } else if (input) warnings.push('An input schema could not be resolved.');
      }
      const pathFields = Object.fromEntries(
        [...route.matchAll(/\{([^}]+)\}/g)].map(([, name]) => [
          name,
          { type: 'string', minLength: 1 },
        ]),
      );
      const queryFields: Record<string, JsonSchema> = {};
      for (const call of callNodes) {
        const expr = call.getExpression();
        if (
          !Node.isPropertyAccessExpression(expr) ||
          !['get', 'getAll', 'has'].includes(expr.getName()) ||
          origin(expr.getExpression()) !== 'query'
        )
          continue;
        const arg = call.getArguments()[0];
        if (arg && Node.isStringLiteral(arg))
          queryFields[arg.getLiteralValue()] =
            expr.getName() === 'getAll'
              ? { type: 'array', items: { type: 'string' } }
              : { type: 'string' };
        else warnings.push('Dynamic query parameter requires review.');
      }
      const hasBody = callNodes.some(isRequestJson);
      if (hasBody && method === 'GET') warnings.push('GET request bodies cannot be forwarded.');
      if (hasBody && bodies.length !== 1)
        warnings.push('JSON body schema could not be unambiguously traced to request.json().');
      if (
        queries.some((s) =>
          Object.values(s.schema.properties ?? {}).some(
            (p) =>
              p.type === 'object' ||
              p.anyOf ||
              (p.type === 'array' &&
                (!p.items?.type ||
                  !['string', 'number', 'integer', 'boolean'].includes(p.items.type))),
          ),
        )
      )
        warnings.push('Nested or nullable query values require manual mapping.');
      if (queries.length > 1) warnings.push('Multiple query schemas require manual review.');
      if (
        node.getText().includes('searchParams') &&
        !queries.length &&
        !Object.keys(queryFields).length
      )
        warnings.push('Query mapping could not be inferred.');
      if ([...bodies, ...queries].some((s) => !s.supported))
        warnings.push('Input schema is partially inferred: unsupported Zod constructs.');
      if (
        callNodes.some((c) =>
          /\.(formData|text|arrayBuffer|blob)$/.test(c.getExpression().getText()),
        )
      )
        warnings.push('Only JSON request bodies are supported.');
      const inputSchema = object(
        {
          ...(Object.keys(pathFields).length
            ? { path: object(pathFields, Object.keys(pathFields)) }
            : {}),
          ...(queries.length === 1
            ? { query: queries[0].schema }
            : Object.keys(queryFields).length
              ? { query: object(queryFields) }
              : {}),
          ...(hasBody ? { body: bodies.length === 1 ? bodies[0].schema : object() } : {}),
        },
        [
          ...(Object.keys(pathFields).length ? ['path'] : []),
          ...(hasBody ? ['body'] : []),
          ...(queries.length === 1 && queries[0].schema.required?.length ? ['query'] : []),
        ],
      );
      endpoints.push({
        id: `${method} ${route}`,
        path: route,
        method,
        file: filePath,
        handler: method,
        line: node.getStartLineNumber(),
        calls,
        services: matched.map((s) => s.id),
        permissions: [
          ...new Set([...permissionsIn(node), ...matched.flatMap((s) => s.permissions)]),
        ],
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
          },
          ...matched.map((s) => ({
            file: s.file,
            symbol: s.name,
            line: s.line,
            reason: 'Resolved service call from handler',
          })),
          ...linked.map((s) => ({
            file: s.file,
            symbol: s.name,
            line: 1,
            reason: 'Resolved validation schema used by handler',
          })),
        ],
      });
    }
  }
  return endpoints;
}
