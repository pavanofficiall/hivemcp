import { readFileSync } from 'node:fs';
// Single version source: the published package.json (one level above src/ and dist/).
export const VERSION: string = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
