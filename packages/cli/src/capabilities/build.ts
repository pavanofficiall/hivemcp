import { createHash } from 'node:crypto';
import type { Endpoint, ServiceInfo } from '../analyzers/types.js';
export type Capability = {
  name: string;
  displayName: string;
  description: string;
  source: { method: string; route: string; file: string; handler: string };
  services: ServiceInfo[];
  inputSchema: Endpoint['inputSchema'];
  permissions: string[];
  risk: 'read' | 'write' | 'destructive';
  confidence: number;
  evidence: Endpoint['evidence'];
  supported: boolean;
  warnings: string[];
};
export const snake = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase();
const singular = (s: string) =>
  s.endsWith('ies')
    ? s.slice(0, -3) + 'y'
    : s.endsWith('s') && !s.endsWith('ss')
      ? s.slice(0, -1)
      : s;
export function capabilityName(endpoint: Pick<Endpoint, 'path' | 'method'>) {
  const parts = endpoint.path.split('/').filter(Boolean).slice(1);
  const isParam = (s: string) => s.startsWith('{');
  const last = parts.at(-1) ?? 'resource';
  const resource = parts.findLast((p) => !isParam(p)) ?? 'resource';
  const item = isParam(last);
  const action = parts.length > 2 && isParam(parts.at(-2)!) && !item;
  const parent = parts.slice(0, -2).findLast((p) => !isParam(p)) ?? resource;
  if (action)
    return snake(
      `${endpoint.method === 'POST' ? last : endpoint.method === 'GET' ? 'get_' + last : 'update_' + last}_${singular(parent)}`,
    ).replace(
      `update_${snake(last)}_${snake(singular(parent))}`,
      `update_${snake(singular(parent))}_${snake(last)}`,
    );
  const verb =
    endpoint.method === 'GET'
      ? item
        ? 'get'
        : 'search'
      : endpoint.method === 'POST'
        ? 'create'
        : endpoint.method === 'DELETE'
          ? 'delete'
          : 'update';
  return snake(`${verb}_${endpoint.method === 'GET' && !item ? resource : singular(resource)}`);
}
export function classifyRisk(method: string, evidence: string): Capability['risk'] {
  if (
    method === 'DELETE' ||
    /\b(delete|destroy|purge|truncate|remove|reset|wipe)\b/i.test(
      evidence.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' '),
    )
  )
    return 'destructive';
  if (
    method === 'GET' &&
    !/\b(launch|send|create|update|enroll|start|stop|cancel|archive)\b/i.test(
      evidence.replace(/([a-z])([A-Z])/g, '$1 $2'),
    )
  )
    return 'read';
  return 'write';
}
export function buildCandidates(endpoints: Endpoint[], services: ServiceInfo[]): Capability[] {
  const candidates = endpoints
    .filter((e) => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(e.method))
    .filter(
      (e) =>
        !e.path
          .split('/')
          .some((segment) =>
            /^(health|healthz|ready|readiness|telemetry|metrics|auth|oauth|callback|callbacks|debug|internal|webhook|webhooks)$/i.test(
              segment,
            ),
          ),
    )
    .map((e) => {
      const matched = services.filter((s) => e.services.includes(s.id));
      const name = capabilityName(e);
      return {
        name,
        displayName: name.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        description: `${name.replaceAll('_', ' ')} using ${e.method} ${e.path}.`,
        source: { method: e.method, route: e.path, file: e.file, handler: e.handler },
        services: matched,
        inputSchema: e.inputSchema,
        permissions: e.permissions,
        risk: classifyRisk(e.method, e.path + ' ' + matched.map((s) => s.name).join(' ')),
        confidence: Math.min(
          0.98,
          0.65 +
            (matched.length ? 0.15 : 0) +
            (e.schemaIds.length ? 0.15 : 0) -
            (e.supported ? 0 : 0.3),
        ),
        evidence: e.evidence,
        supported: e.supported,
        warnings: e.warnings,
      } satisfies Capability;
    });
  const counts = new Map<string, number>();
  for (const c of candidates) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  for (const c of candidates) {
    const suffix = createHash('sha256')
      .update(`${c.source.method} ${c.source.route}`)
      .digest('hex')
      .slice(0, 8);
    if (counts.get(c.name)! > 1 || c.name.length > 64) c.name = c.name.slice(0, 55) + '_' + suffix;
  }
  return candidates.sort((a, b) => a.name.localeCompare(b.name));
}
export interface CapabilityEnricher {
  enrich(capabilities: Capability[]): Promise<Capability[]>;
}
export class DeterministicCapabilityEnricher implements CapabilityEnricher {
  async enrich(capabilities: Capability[]) {
    return capabilities;
  }
}
export function diffCapabilities(previous: Capability[], current: Capability[]) {
  const id = (c: Capability) => `${c.source.method} ${c.source.route}`;
  const old = new Map(previous.map((c) => [id(c), c]));
  const counts = { unchanged: 0, added: 0, changed: 0, removed: 0 };
  for (const c of current) {
    const before = old.get(id(c));
    if (!before) counts.added++;
    else if (JSON.stringify(before) === JSON.stringify(c)) counts.unchanged++;
    else counts.changed++;
    old.delete(id(c));
  }
  counts.removed = old.size;
  return counts;
}
