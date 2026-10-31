import type { ToolDefinition } from './sync.js';
// One difference between the tool an agent knows and the tool the server will now serve.
// "Breaking" means a call that worked before can now be rejected or misread.
export type ToolChange = { path: string; detail: string; breaking: boolean };
type Schema = Record<string, any>;
const LOWER = { minLength: 'length', minimum: 'value', minItems: 'items' } as const;
const UPPER = { maxLength: 'length', maximum: 'value', maxItems: 'items' } as const;
const show = (value: unknown) => JSON.stringify(value);
const nullable = (s: Schema) =>
  Array.isArray(s?.anyOf) && s.anyOf.some((x: Schema) => x?.type === 'null');
const nonNull = (s: Schema): Schema =>
  nullable(s) ? (s.anyOf.find((x: Schema) => x?.type !== 'null') ?? {}) : s;

export function diffSchema(before: Schema = {}, after: Schema = {}, path = ''): ToolChange[] {
  const changes: ToolChange[] = [];
  const at = path || 'input';
  if (nullable(before) !== nullable(after))
    changes.push(
      nullable(before)
        ? { path: at, detail: 'no longer accepts null', breaking: true }
        : { path: at, detail: 'now also accepts null', breaking: false },
    );
  const a = nonNull(before);
  const b = nonNull(after);
  if (a.type !== b.type) {
    changes.push({
      path: at,
      detail: `type ${a.type ?? 'any'} → ${b.type ?? 'any'}`,
      breaking: true,
    });
    return changes;
  }
  if (Array.isArray(a.enum) || Array.isArray(b.enum)) {
    const was: unknown[] = a.enum ?? [];
    const now: unknown[] = b.enum ?? [];
    const gone = was.filter((v) => !now.includes(v));
    const added = now.filter((v) => !was.includes(v));
    if (!a.enum)
      changes.push({
        path: at,
        detail: `now limited to ${now.map(show).join(', ')}`,
        breaking: true,
      });
    else if (!b.enum)
      changes.push({ path: at, detail: 'no longer limited to fixed values', breaking: false });
    else {
      if (gone.length)
        changes.push({
          path: at,
          detail: `no longer accepts ${gone.map(show).join(', ')}`,
          breaking: true,
        });
      if (added.length)
        changes.push({
          path: at,
          detail: `also accepts ${added.map(show).join(', ')}`,
          breaking: false,
        });
    }
  }
  for (const [key, what] of Object.entries(LOWER)) {
    if (a[key] === b[key]) continue;
    const narrower = b[key] !== undefined && (a[key] === undefined || b[key] > a[key]);
    changes.push({
      path: at,
      detail: `minimum ${what} ${a[key] ?? 'none'} → ${b[key] ?? 'none'}`,
      breaking: narrower,
    });
  }
  for (const [key, what] of Object.entries(UPPER)) {
    if (a[key] === b[key]) continue;
    const narrower = b[key] !== undefined && (a[key] === undefined || b[key] < a[key]);
    changes.push({
      path: at,
      detail: `maximum ${what} ${a[key] ?? 'none'} → ${b[key] ?? 'none'}`,
      breaking: narrower,
    });
  }
  if (a.format !== b.format)
    changes.push({
      path: at,
      detail: b.format
        ? `must now be ${b.format}${a.format ? ` (was ${a.format})` : ''}`
        : `no longer must be ${a.format}`,
      breaking: Boolean(b.format),
    });
  if (a.type === 'object') {
    const was = a.properties ?? {};
    const now = b.properties ?? {};
    const required = new Set<string>(b.required ?? []);
    const wasRequired = new Set<string>(a.required ?? []);
    const child = (key: string) => (path ? `${path}.${key}` : key);
    for (const key of Object.keys(was))
      if (!(key in now))
        changes.push({
          path: child(key),
          detail:
            b.additionalProperties === false
              ? 'removed: agents that still send it are rejected'
              : 'removed',
          breaking: b.additionalProperties === false || wasRequired.has(key),
        });
    for (const key of Object.keys(now)) {
      if (!(key in was)) {
        changes.push(
          required.has(key)
            ? {
                path: child(key),
                detail: 'new required field: older calls are rejected',
                breaking: true,
              }
            : { path: child(key), detail: 'new optional field', breaking: false },
        );
        continue;
      }
      if (wasRequired.has(key) !== required.has(key))
        changes.push(
          required.has(key)
            ? { path: child(key), detail: 'optional → required', breaking: true }
            : { path: child(key), detail: 'required → optional', breaking: false },
        );
      changes.push(...diffSchema(was[key], now[key], child(key)));
    }
  } else if (a.type === 'array') changes.push(...diffSchema(a.items, b.items, `${at}[]`));
  return changes;
}

export function diffTool(before: ToolDefinition, after: ToolDefinition): ToolChange[] {
  const changes: ToolChange[] = [];
  if (before.name !== after.name)
    changes.push({
      path: 'name',
      detail: `renamed ${before.name} → ${after.name}`,
      breaking: true,
    });
  if (before.risk !== after.risk) {
    const order = ['read', 'write', 'destructive'];
    changes.push({
      path: 'risk',
      detail: `${before.risk} → ${after.risk}`,
      breaking: order.indexOf(after.risk) > order.indexOf(before.risk),
    });
  }
  changes.push(...diffSchema(before.inputSchema, after.inputSchema));
  if (before.description !== after.description)
    changes.push({ path: 'description', detail: 'updated', breaking: false });
  if (before.source.file !== after.source.file)
    changes.push({ path: 'source', detail: `moved to ${after.source.file}`, breaking: false });
  return changes;
}
