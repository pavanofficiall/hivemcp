import type { DataModel } from '../types.js';
export function parsePrisma(source: string, file = 'prisma/schema.prisma'): DataModel[] {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  return [...clean.matchAll(/\b(model|enum)\s+(\w+)\s*\{([^}]+)\}/g)].map(
    ([, kind, name, body]) => {
      const lines = body
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      return {
        name,
        kind: kind as 'model' | 'enum',
        file,
        fields: lines
          .filter((l) => !l.startsWith('@@'))
          .map((l) => {
            const [name, type = '', ...attributes] = l.split(/\s+/);
            return { name, type, attributes: attributes.join(' ') };
          }),
        constraints: lines.filter((l) => l.startsWith('@@')),
      };
    },
  );
}
