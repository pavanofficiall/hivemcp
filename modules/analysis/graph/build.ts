import type { ApplicationIndex, Graph } from '../types';
export function buildGraph(index: ApplicationIndex): Graph {
  const nodes = new Map<string, Graph['nodes'][number]>();
  const edges: Graph['edges'] = [];
  const node = (id: string, kind: string, label: string, data: unknown = {}) => {
    nodes.set(id, { id, kind, label, data });
    return id;
  };
  const edge = (source: string, target: string, kind: string) =>
    edges.push({ source, target, kind });
  const app = node('application', 'Application', index.framework);
  for (const schema of index.schemas) node(schema.id, 'Schema', schema.name, schema);
  for (const model of index.models) node(`model:${model.name}`, 'DataModel', model.name, model);
  for (const service of index.services) {
    node(service.id, 'ServiceMethod', service.name, service);
    for (const op of service.databaseOperations) {
      const [, model, method] = op.split('.');
      const found = index.models.find((m) => m.name.toLowerCase() === model?.toLowerCase());
      if (found)
        edge(
          service.id,
          `model:${found.name}`,
          /find|count|aggregate|groupBy/.test(method)
            ? 'SERVICE_READS_MODEL'
            : 'SERVICE_WRITES_MODEL',
        );
    }
    for (const [i, rule] of service.rules.entries())
      edge(
        service.id,
        node(`${service.id}:rule:${i}`, 'BusinessRule', rule.slice(0, 80), { rule }),
        'SERVICE_HAS_RULE',
      );
  }
  for (const endpoint of index.endpoints) {
    node(endpoint.id, 'APIEndpoint', endpoint.id, {
      file: endpoint.file,
      line: endpoint.line,
      supported: endpoint.supported,
    });
    edge(app, endpoint.id, 'APPLICATION_HAS_ENDPOINT');
    const handler = node(`${endpoint.id}:handler`, 'Handler', endpoint.handler, {
      file: endpoint.file,
      line: endpoint.line,
    });
    edge(endpoint.id, handler, 'ROUTE_CALLS_HANDLER');
    for (const schema of endpoint.schemaIds) edge(handler, schema, 'HANDLER_VALIDATES_WITH');
    for (const service of endpoint.services) edge(handler, service, 'HANDLER_CALLS_SERVICE');
    for (const permission of endpoint.permissions)
      edge(
        handler,
        node(`permission:${permission}`, 'Permission', permission),
        'HANDLER_REQUIRES_PERMISSION',
      );
  }
  return { nodes: [...nodes.values()], edges };
}
