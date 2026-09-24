import { test } from 'node:test';
import assert from 'node:assert/strict';
import tools from '../src/tools.json' with { type: 'json' };
import { toObject } from '../src/schema.js';
import { requestFor } from '../src/adapter.js';
import type { Tool } from '../src/types.js';
for (const tool of tools as unknown as Tool[])
  test(`${tool.name}: schema and fixed API mapping`, () => {
    assert.match(tool.name, /^[a-z0-9_]{1,64}$/);
    assert.equal(toObject(tool.inputSchema).safeParse({ arbitrary: true }).success, false);
    assert.match(tool.source.route, /^\/api\//);
    const params = Object.fromEntries(
      [...tool.source.route.matchAll(/\{([^}]+)\}/g)].map(([, k]) => [k, 'id/with spaces']),
    );
    const request = requestFor(tool, { path: params }, 'http://localhost:3000');
    assert.equal(request.url.origin, 'http://localhost:3000');
    assert.equal(request.method, tool.source.method);
    assert.ok(!request.url.pathname.includes('{'));
  });
