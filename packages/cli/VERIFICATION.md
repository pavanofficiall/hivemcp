# Hive CLI v0.1 verification

Verified locally on 2026-09-23 with Node.js 22.12.0.

## Results

| Check | Result |
| --- | --- |
| CLI build (`npm run build --prefix packages/cli`) | Passed |
| CLI typecheck | Passed |
| Existing repository typecheck | Passed |
| CLI tests (`npm test --prefix packages/cli`) | 19 passed, 0 failed, 0 skipped |
| Generated MCP package installation and TypeScript build | Passed inside integration test |
| Generated per-tool schema/mapping tests | 4 passed inside integration test |
| Existing repository tests (`npm test`) | 50 passed in 2 files |
| Interactive review in a real terminal | Passed; reads selected by default, writes/deletes unselected |
| npm package build (`npm pack`) | Passed; executable and runtime templates included |
| Packed tarball installed in a separate consumer | Passed; installed `hive` binary discovered the fixture capabilities |
| Non-interactive unapproved generation | Refused, no output tree created |
| JSON discovery | Returned analysis without writes |
| `hive doctor` | Passed against generated fixture runtime |
| `hive dev` | Started the generated HTTP server successfully |

## End-to-end proof

The source fixture at `tests/fixtures/tiny-crm` has ordinary Next.js API route handlers, Zod schemas, services, permission checks and supporting Prisma metadata. There is no authored MCP server in its source.

The integration test copies that fixture into a temporary application and asserts no `.hive` directory exists. It invokes the built CLI, explicitly selects four discovered capabilities, installs the generated package, compiles it, and runs its generated tests. It starts an actual Next.js development server, then uses `hive dev` to start the generated MCP endpoint.

Official MCP SDK clients verified:

1. `tools/list` exposes `search_contacts` and `launch_sequence` and excludes unselected `delete_contact`.
2. `search_contacts` with query `Ada` returns Ada Lovelace from the actual application API.
3. `launch_sequence` without application authorization returns a tool error with HTTP 403.
4. A malformed launch body is rejected before mutation; launch count remains 0.
5. An authenticated `launch_sequence` call changes `seq_123` from `draft` to `launched`, with launch count changing from 0 to 1. An independent direct API read verifies the mutation.
6. `create_contact` adds Grace Hopper; a separate direct API read finds the new record.
7. Calling an unselected tool returns an MCP tool error.
8. Cross-origin browser requests are rejected; malformed JSON returns HTTP 400.
9. A separate stdio client discovers the same four tools from the compiled server.
10. Re-scan reports six unchanged candidates, zero new, changed or removed.

The interactive manual check separately selected `get_sequence`, `launch_sequence` and `search_contacts`. Its generated output remains under `tests/fixtures/tiny-crm/.hive/` for inspection; it is ignored by Git and excluded from fixture copies in tests.

## Scope of the evidence

These are real local API calls and real MCP protocol exchanges. The fixture uses in-memory state and a fixture-only bearer token, so no database or external credentials are required. Prisma is analyzed as supporting metadata; this does not test Prisma database execution.

Orbit CRM has not been tested because its path was not provided. The package has been packed and installed locally, not published to npm. No claim is made about arbitrary applications, production authentication, hosted deployment, or unsupported framework/schema constructs.

## Reproduce

From the repository root:

```sh
npm install --prefix packages/cli
npm run hive:build
npm run hive:test
npm run typecheck
npm test
```

The integration test needs root dependencies installed for Next.js and access to npm to install the generated package. It uses temporary applications and ephemeral ports and tears them down afterward. `HIVE_TEST_NPM_CACHE=/path/to/a/populated/cache` enables offline generated-package installation.

To inspect discovery without generating:

```sh
node packages/cli/dist/cli/index.js scan -C packages/cli/tests/fixtures/tiny-crm --dry-run
```
