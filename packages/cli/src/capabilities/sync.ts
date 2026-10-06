import type { Capability } from './build.js';
// The exact shape written to .hive/mcp/src/tools.json: what an agent can actually call.
export type ToolDefinition = Pick<
  Capability,
  'name' | 'description' | 'source' | 'inputSchema' | 'risk'
>;
export const toDefinition = ({
  name,
  description,
  source,
  inputSchema,
  risk,
}: Capability): ToolDefinition => ({ name, description, source, inputSchema, risk });
const id = (c: { source: { method: string; route: string } }) =>
  `${c.source.method} ${c.source.route}`;
export type SyncPlan = {
  keep: Capability[];
  changed: { before: ToolDefinition; after: Capability; fields: string[] }[];
  removed: ToolDefinition[];
  added: Capability[];
};
// Compares the tools the server currently serves with a fresh scan. Approval never carries over
// to a changed definition, and newly discovered operations are reported, never approved.
export function planSync(
  served: ToolDefinition[],
  seen: Capability[],
  current: Capability[],
): SyncPlan {
  const supported = new Map(current.filter((c) => c.supported).map((c) => [id(c), c]));
  const plan: SyncPlan = { keep: [], changed: [], removed: [], added: [] };
  for (const tool of served) {
    const now = supported.get(id(tool));
    if (!now) {
      plan.removed.push(tool);
      continue;
    }
    const after = toDefinition(now);
    const fields = (['name', 'description', 'inputSchema', 'risk'] as const).filter(
      (key) => JSON.stringify(tool[key]) !== JSON.stringify(after[key]),
    ) as string[];
    if (tool.source.file !== after.source.file) fields.push('source file');
    if (fields.length) plan.changed.push({ before: tool, after: now, fields });
    else plan.keep.push(now);
  }
  const known = new Set([...seen.filter((c) => c.supported).map(id), ...served.map(id)]);
  plan.added = current.filter((c) => c.supported && !known.has(id(c)));
  return plan;
}
