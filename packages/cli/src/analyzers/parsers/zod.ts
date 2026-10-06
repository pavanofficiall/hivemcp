import { Node, SyntaxKind, type Expression, type Project } from 'ts-morph';
import type { JsonSchema, SchemaInfo } from '../types.js';
// Interpret AST only. Never import, evaluate, transpile, or run customer code.
export function parseZod(
  node: Node | undefined,
  seen = new Set<string>(),
): { schema: JsonSchema; supported: boolean; optional?: boolean } {
  if (!node) return { schema: {}, supported: false };
  const key = `${node.getSourceFile().getFilePath()}:${node.getStart()}:${node.getEnd()}`;
  if (seen.has(key) || seen.size > 60) return { schema: {}, supported: false };
  const next = new Set(seen).add(key);
  if (Node.isIdentifier(node)) {
    const symbol = node.getSymbol();
    const declaration = (symbol?.getAliasedSymbol() ?? symbol)
      ?.getDeclarations()
      .find(Node.isVariableDeclaration);
    return declaration
      ? parseZod(declaration.getInitializer(), next)
      : { schema: {}, supported: false };
  }
  if (!Node.isCallExpression(node)) return { schema: {}, supported: false };
  const expression = node.getExpression();
  if (!Node.isPropertyAccessExpression(expression)) return { schema: {}, supported: false };
  const method = expression.getName();
  const base = expression.getExpression();
  const args = node.getArguments();
  const symbol = base.getSymbol();
  const factory = (symbol?.getDeclarations() ?? []).some((d) => {
    const imp = d.getFirstAncestorByKind(SyntaxKind.ImportDeclaration);
    return imp && /^zod(?:\/|$)/.test(imp.getModuleSpecifierValue());
  });
  if (factory && ['string', 'number', 'boolean', 'date'].includes(method))
    return {
      schema: { type: method === 'date' ? 'string' : method },
      supported: method !== 'date',
    };
  if (factory && method === 'object' && args[0] && Node.isObjectLiteralExpression(args[0])) {
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    let supported = true;
    for (const property of args[0].getProperties()) {
      if (!Node.isPropertyAssignment(property)) {
        supported = false;
        continue;
      }
      const name = property.getName().replace(/^["']|["']$/g, '');
      if (['__proto__', 'constructor', 'prototype'].includes(name)) {
        supported = false;
        continue;
      }
      const parsed = parseZod(property.getInitializer(), next);
      properties[name] = parsed.schema;
      if (!parsed.optional) required.push(name);
      supported &&= parsed.supported;
    }
    return {
      schema: { type: 'object', properties, required, additionalProperties: false },
      supported,
    };
  }
  if (factory && method === 'array') {
    const parsed = parseZod(args[0], next);
    return { schema: { type: 'array', items: parsed.schema }, supported: parsed.supported };
  }
  if (factory && method === 'enum' && args[0] && Node.isArrayLiteralExpression(args[0])) {
    const values = args[0].getElements();
    return {
      schema: {
        type: 'string',
        enum: values.filter(Node.isStringLiteral).map((v) => v.getLiteralValue()),
      },
      supported: values.every(Node.isStringLiteral),
    };
  }
  if (factory && method === 'literal' && args[0] && Node.isStringLiteral(args[0]))
    return { schema: { type: 'string', enum: [args[0].getLiteralValue()] }, supported: true };
  const parsed = parseZod(base, next);
  const schema = structuredClone(parsed.schema);
  if (['optional', 'default'].includes(method)) return { ...parsed, optional: true };
  if (method === 'nullable') return { ...parsed, schema: { anyOf: [schema, { type: 'null' }] } };
  if (method === 'array') return { ...parsed, schema: { type: 'array', items: schema } };
  // Trimming changes the value the application receives, but not its JSON type.
  // The existing API still performs the actual trim and post-trim validation.
  if (method === 'trim' && schema.type === 'string') return { ...parsed, schema };
  if (['email', 'uuid', 'url'].includes(method))
    return { ...parsed, schema: { ...schema, format: method === 'url' ? 'uri' : method } };
  if (method === 'int') return { ...parsed, schema: { ...schema, type: 'integer' } };
  if (['min', 'max', 'length'].includes(method) && args[0] && Node.isNumericLiteral(args[0])) {
    const value = args[0].getLiteralValue();
    const suffix = schema.type === 'string' ? 'Length' : schema.type === 'array' ? 'Items' : 'imum';
    if (method === 'length') {
      schema[`min${suffix}`] = value;
      schema[`max${suffix}`] = value;
    } else schema[`${method}${suffix}`] = value;
    return { ...parsed, schema };
  }
  if (method === 'partial' && schema.type === 'object')
    return { ...parsed, schema: { ...schema, required: [] } };
  if (method === 'strict') return { ...parsed, schema };
  // Refinements, transforms, coercions, passthrough, dynamic factories require review.
  return { schema, supported: false, optional: parsed.optional };
}
export function extractSchemas(project: Project, relative: (path: string) => string): SchemaInfo[] {
  return project.getSourceFiles().flatMap((file) =>
    file
      .getVariableDeclarations()
      .filter((declaration) => {
        const parsed = parseZod(declaration.getInitializer());
        return parsed.supported || /[Ss]chema$/.test(declaration.getName());
      })
      .map((declaration) => {
        const parsed = parseZod(declaration.getInitializer());
        const path = relative(file.getFilePath());
        return {
          id: `${path}#${declaration.getName()}`,
          name: declaration.getName(),
          file: path,
          schema: parsed.schema,
          supported: parsed.supported,
        };
      }),
  );
}
