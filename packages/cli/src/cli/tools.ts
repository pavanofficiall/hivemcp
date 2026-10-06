import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readServed } from '../generator/project.js';
export type Policy = { mode: 'all' | 'read-only' | 'off'; tools: Record<string, 'allow' | 'deny'> };
export const MODES = ['all', 'read-only', 'off'] as const;
const policyPath = (root: string) => path.join(root, '.hive/policy.json');
// Mirrors templates/mcp/src/policy.ts so the CLI reports exactly what the server enforces.
export async function readPolicy(root: string): Promise<Policy> {
  let text: string;
  try {
    text = await readFile(policyPath(root), 'utf8');
  } catch (error: any) {
    if (error.code === 'ENOENT') return { mode: 'all', tools: {} };
    throw error;
  }
  let value: any;
  try {
    value = JSON.parse(text);
  } catch {
    value = { mode: 'invalid' };
  }
  const policy = { mode: value?.mode ?? 'all', tools: value?.tools ?? {} };
  if (
    !MODES.includes(policy.mode) ||
    typeof policy.tools !== 'object' ||
    Array.isArray(policy.tools) ||
    Object.values(policy.tools).some((v) => v !== 'allow' && v !== 'deny')
  )
    throw new Error('Invalid .hive/policy.json; the server disables every tool until it is fixed.');
  return policy;
}
async function writePolicy(root: string, policy: Policy) {
  const file = policyPath(root);
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(policy, null, 2) + '\n', { flag: 'wx' });
  await rename(temp, file);
}
export const allowed = (policy: Policy, tool: { name: string; risk: string }) =>
  policy.mode !== 'off' &&
  policy.tools[tool.name] !== 'deny' &&
  (policy.mode !== 'read-only' || tool.risk === 'read');
export async function listTools(cwd: string) {
  const root = path.resolve(cwd);
  const { tools } = await readServed(root);
  const policy = await readPolicy(root);
  console.log(`Mode: ${policy.mode}${policy.mode === 'all' ? '' : ' (applies to every tool)'}\n`);
  for (const tool of tools) {
    const on = allowed(policy, tool);
    const why =
      policy.tools[tool.name] === 'deny'
        ? 'disabled'
        : on
          ? 'enabled'
          : `blocked by mode ${policy.mode}`;
    console.log(
      `${on ? '✓' : '✗'} ${tool.name} [${tool.risk.toUpperCase()}] ${why} — ${tool.source.method} ${tool.source.route}`,
    );
  }
  if (!tools.length) console.log('No tools are generated. Run hive scan to approve some.');
  console.log(
    '\nChanges apply to the running HTTP server on the next request (restart stdio clients).',
  );
}
export async function setTool(cwd: string, name: string, enable: boolean) {
  const root = path.resolve(cwd);
  const { tools } = await readServed(root);
  if (!tools.some((t) => t.name === name))
    throw new Error(`Unknown tool: ${name}. Run hive tools to list generated tools.`);
  const policy = await readPolicy(root);
  if (enable) delete policy.tools[name];
  else policy.tools[name] = 'deny';
  await writePolicy(root, policy);
  console.log(`✓ ${name} ${enable ? 'enabled' : 'disabled'} in .hive/policy.json`);
  if (
    enable &&
    !allowed(
      policy,
      tools.find((t) => t.name === name)!,
    )
  )
    console.log(`! Still blocked by mode ${policy.mode}. Run hive tools mode all to lift it.`);
}
export async function setMode(cwd: string, mode: string) {
  if (!MODES.includes(mode as Policy['mode']))
    throw new Error(`Mode must be one of: ${MODES.join(', ')}`);
  const root = path.resolve(cwd);
  await readServed(root);
  const policy = await readPolicy(root);
  policy.mode = mode as Policy['mode'];
  await writePolicy(root, policy);
  console.log(`✓ Server mode set to ${mode} in .hive/policy.json`);
}
