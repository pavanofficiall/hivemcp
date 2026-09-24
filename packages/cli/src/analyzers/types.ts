export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: unknown[];
  format?: string;
  anyOf?: JsonSchema[];
  [key: string]: unknown;
};
export type Evidence = {
  file: string;
  symbol: string;
  line: number;
  reason: string;
  snippet?: string;
};
export type SchemaInfo = {
  id: string;
  name: string;
  file: string;
  schema: JsonSchema;
  supported: boolean;
};
export type ServiceInfo = {
  id: string;
  name: string;
  file: string;
  line: number;
  calls: string[];
  databaseOperations: string[];
  permissions: string[];
  rules: string[];
  arguments: string[];
  returnType: string;
  snippet: string;
};
export type Endpoint = {
  id: string;
  path: string;
  method: string;
  file: string;
  handler: string;
  line: number;
  calls: string[];
  services: string[];
  permissions: string[];
  schemaIds: string[];
  inputSchema: JsonSchema;
  supported: boolean;
  warnings: string[];
  evidence: Evidence[];
};
export type DataModel = {
  name: string;
  kind: 'model' | 'enum';
  file: string;
  fields: { name: string; type: string; attributes: string }[];
  constraints: string[];
};
export type ApplicationIndex = {
  framework: string;
  language: string;
  files: number;
  routes: string[];
  endpoints: Endpoint[];
  services: ServiceInfo[];
  schemas: SchemaInfo[];
  models: DataModel[];
  authorization: { file: string; symbols: string[] }[];
  serverActions: { file: string; symbols: string[] }[];
  warnings: string[];
};
export type Graph = {
  nodes: { id: string; kind: string; label: string; data: unknown }[];
  edges: { source: string; target: string; kind: string }[];
};
