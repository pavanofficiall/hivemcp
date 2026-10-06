# Hive CLI v0.0.2

Turn an existing **TypeScript + Next.js App Router** application into a local, inspectable MCP server. Analysis is deterministic and runs without API keys. The generated tools call existing REST APIs, preserving application authorization, validation and business logic.

This standalone package is `@usehive/cli`; its executable is `hive`. The other code in this repository predates the CLI and is not a dependency of the package. No dashboard, database server, cloud integration or model provider is needed.

The CLI and its generated templates are available under the MIT license; see [LICENSE](./LICENSE).

## Quickstart

Node 22.12+ is required. In the root of an existing TypeScript Next.js App Router application, run:

```sh
npx @usehive/cli scan --dry-run
npx @usehive/cli scan --install
```

The first command previews discovered capabilities without changing files. The second opens an interactive review, generates the approved MCP tools, and installs the generated server's dependencies. You can also install the CLI with `npm install -g @usehive/cli` and then use `hive scan`.

Select the capabilities to expose. Reads start selected; writes and destructive operations start unselected. Selection shows the method, route, risk, confidence and detected permission evidence. Unsupported candidates remain in the inventory with manual-review explanations and cannot be selected.

Start the application normally. Configure its origin and existing auth in `.hive/mcp/.env`, using `.env.example` as a template. Then:

```sh
npm run hive:mcp
```

The MCP endpoint is **http://127.0.0.1:3333/mcp**, separate from the application's port. The app's existing `hive:mcp` script, if any, is preserved; the CLI prints a direct alternative.

Start your application as usual. Copy `.hive/mcp/.env.example` to `.hive/mcp/.env` and set `HIVE_APP_BASE_URL` to the application's origin. Add an application credential there if its API requires one. Then run `npm run hive:mcp` from the application root, or `npx @usehive/cli dev`. Connect a local MCP client to `http://127.0.0.1:3333/mcp` using Streamable HTTP. The generated server runs locally and only exposes tools you approved during review.

## Develop this CLI from source

From the repository root:

```sh
npm install --prefix packages/cli
npm run hive:build
npm run hive:test
```

To inspect a separate application before generating anything, run `node /path/to/hivemcp-v2/packages/cli/dist/cli/index.js scan --dry-run` from that application's root. `npm hive scan` is not a supported invocation.

## Commands

| Command                                              | Purpose                                                               |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `hive scan`                                          | Detect, index, discover, review and generate                          |
| `hive scan --dry-run`                                | Human-readable discovery, no writes                                   |
| `hive scan --json`                                   | Machine-readable analysis, no writes                                  |
| `hive scan --select search_contacts,launch_sequence` | Explicit selection for scripts/CI; names must come from your scan     |
| `hive scan --read-only`                              | Explicitly approve only supported reads                               |
| `hive scan --install`                                | Also install generated dependencies                                   |
| `hive scan --no-script`                              | Leave application package.json untouched                              |
| `hive generate`                                      | Re-scan, review and regenerate                                        |
| `hive sync`                                          | Re-scan and bring the generated server up to date                     |
| `hive sync --check`                                  | Report drift and exit 1 if out of date (CI); no writes                |
| `hive sync --accept-changed`                         | Non-interactively re-approve approved tools whose definition changed  |
| `hive dev`                                           | Start the generated Streamable HTTP server                            |
| `hive dev --stdio`                                   | Start it with clean stdio transport                                   |
| `hive inspect`                                       | Show generated manifest and candidates                                |
| `hive doctor`                                        | Check project, generated files, dependencies and manifest consistency |

Every command accepts `-C /application/root`. Without a terminal, generation requires an explicit `--select` or `--read-only`. `--select ''` generates an empty tool set. There is no automatic “expose all” mode.

## Architecture and scan pipeline

```text
src/
  cli/index.ts                 Commander commands and Clack review
  scanner/project.ts           Stack detection and bounded safe indexing
  scanner/scan.ts              In-memory TypeScript analysis pipeline
  analyzers/
    nextjs/routes.ts           Exported handlers and request input tracing
    parsers/zod.ts             Static Zod AST interpreter
    parsers/services.ts        Function/method metadata and permission calls
    parsers/prisma.ts          Supporting model, field, enum and relation context
    types.ts                   Analysis contracts
  capabilities/build.ts        Naming, risk, evidence, confidence, enrichment interface, diff
  generator/project.ts         Templates, manifest, ownership checks, script insertion
templates/mcp/                 Readable generated runtime source and tests
tests/                        Analyzer, generation, adapter and full integration tests
  fixtures/tiny-crm/           Ordinary Next.js app, no MCP code
```

1. Detect package.json, tsconfig, Next.js, App Router, package manager, optional Prisma/Zod and next.config.
2. Index bounded TypeScript/TSX and Prisma files. Skip secrets, symlinks, dependencies, build output, tests, generated code and `.hive`. No source module is evaluated or imported.
3. Build a ts-morph project in memory, using locally declared TypeScript path aliases.
4. Resolve exported GET/POST/PUT/PATCH/DELETE declarations, including arrow handlers and named export aliases. Strip route groups and convert `[id]` into `{id}`. Trace `request.json()` and URL search parameter bindings independently for each handler.
5. Interpret Zod ASTs into JSON Schema: objects, strings, number/integer, boolean, string enums, arrays, optional/default, nullable, email, UUID, URL, bounds, strict and partial. Resolve local/imported schema bindings and aliases. Unknown constructs are marked partial, never executed.
6. Resolve call symbols to service functions/methods; retain parameters, return types, source evidence and permission call evidence. Match symbols and source locations rather than coincidental method names.
7. Extract Prisma models, enums, fields, relation types and attributes as supporting context. Models do not create tools.
8. Filter operational endpoints and derive semantic names from method/path. Use deterministic suffixes for collisions. Risk is based on HTTP method plus destructive/action signals; confidence is heuristic evidence strength, not a calibrated probability.
9. Review, generate selected tools, and record a candidate diff. `CapabilityEnricher` and its deterministic implementation provide an extension point for later enrichment; no model is called.

## Generated output

```text
.hive/
  manifest.json                Application, timestamp and selected names
  capabilities.json            All candidates, schemas, sources, evidence and warnings
  analysis.json                Schema/service/Prisma context and scan warnings
  ownership.json               Content hashes protecting generated files
  .gitignore
  mcp/
    package.json
    tsconfig.json
    .env.example
    README.md
    src/
      tools.json               Only approved semantic tools and fixed routes
      server.ts                Official MCP SDK registerTool + HTTP/stdio transports
      schema.ts                JSON Schema -> strict Zod input validation
      adapter.ts               Existing API execution and modular authentication
      types.ts
    tests/generated.test.ts
```

The generated server is an independent package. It uses the official [MCP TypeScript SDK v1](https://ts.sdk.modelcontextprotocol.io/server), pinned to 1.30.0, `McpServer.registerTool`, and stateless Streamable HTTP. It also supports stdio. It contains no imports from Hive or application implementation modules.

Inputs have separate `path`, `query`, and `body` objects. This prevents collisions between a URL identifier and a body field. Each registered tool binds one selected method/route; there is no generic API, SQL or code execution tool.

```json
{
  "name": "launch_sequence",
  "arguments": { "path": { "id": "seq_123" }, "body": { "confirm": true } }
}
```

That example is discovered from the test fixture. Inspect each application's generated `src/tools.json` for its actual names and schemas.

## Runtime and authentication

| Variable                | Behavior                                                                                 |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `HIVE_APP_BASE_URL`     | HTTP(S) application origin; default `http://localhost:3000`                              |
| `HIVE_MCP_PORT`         | Loopback MCP port; default `3333`                                                        |
| `HIVE_APP_BEARER_TOKEN` | Existing application bearer credential                                                   |
| `HIVE_APP_COOKIE`       | Existing application session cookie                                                      |
| `HIVE_FORWARD_AUTH`     | Set `true` to forward incoming Authorization/Cookie headers                              |
| `HIVE_MCP_TOKEN`        | Optional bearer credential protecting the local MCP endpoint; never forwarded to the app |
| `HIVE_HTTP_TIMEOUT_MS`  | 1–120000 ms; default 15000                                                               |

The adapter validates inputs, encodes path segments, serializes query/body values, applies its `AuthStrategy`, calls the fixed API, and returns text plus structured MCP results. Authentication/HTTP failures become tool errors. It refuses redirects and dot path segments, caps responses at 2 MB, and enforces timeouts. HTTP binds to loopback with Host and Origin checks. This is a local single-user runtime, not production OAuth.

`hive dev` and generated npm scripts load `.hive/mcp/.env`. For a process-spawned stdio client, launch `node --env-file-if-exists=.env dist/server.js --stdio` from `.hive/mcp` after building. Avoid npm wrappers when the client requires clean stdout. No diagnostic logs are written to stdio stdout.

## Re-scan and ownership

`hive sync` keeps the generated server in step with the app without re-reviewing everything. It compares the tools the server actually serves (`.hive/mcp/src/tools.json`) with a fresh scan:

- Approved tools whose definition (name, description, input schema, risk or source file) is unchanged stay approved.
- Approved tools whose definition changed need re-approval: interactively, or with `--accept-changed`. Without a terminal and without that flag, sync writes nothing and exits 1. Changed tools you do not re-approve are removed from the server.
- Approved tools whose route is gone are removed.
- New operations are listed and offered interactively, never approved automatically.

`hive sync --check` writes nothing and exits 1 when any of the above applies or the server was generated by another Hive version, so it can guard CI or a pre-commit hook.

Re-scans report unchanged, new, changed and removed candidates. Every generation requires review or explicit command-line selection; previous approval is not silently reused for changed code. Writes stay inside `.hive`, apart from optionally adding the `hive:mcp` script. Existing scripts remain intact.

Before replacing any owned file, Hive verifies its previous hash. Unowned or edited files at generated paths block regeneration. Back up edits outside the generated tree, restore the original generated version, and retry. Unowned extension files and `.env` remain untouched. A generation lock prevents concurrent writers; if a process is forcibly killed, verify it has stopped before removing the stale lock. Generation uses atomic per-file replacement; it is not a transactional multi-file filesystem snapshot.

## Testing

```sh
npm run build
npm test
```

Run these inside `packages/cli`. The integration test installs and builds the generated package, runs its tests, starts the actual Next.js fixture and an MCP server, connects official SDK clients, validates tool discovery on HTTP and stdio, and checks application state before and after authenticated calls. It also verifies unauthorized calls fail and invalid input cannot mutate state. Tests use ephemeral ports and clean up processes and temporary applications.

The monorepo's installed Next.js supplies the integration fixture runtime. Install the repository root dependencies first if using a fresh checkout. Generated runtime dependencies install from npm; `HIVE_TEST_NPM_CACHE=/path/to/populated/cache` opts into an offline cache for the integration install.

## Known limits and next milestone

- One application root at a time; no Pages Router, GraphQL, other frameworks or automatic deployment.
- Catch-all/intercepting/parallel routes, wrapped handlers, non-JSON bodies, dynamic schemas and unresolved input mappings require manual review.
- Local tsconfig aliases work; inherited tsconfig aliases and general interprocedural schema/data-flow analysis are not implemented.
- No Zod transforms, refinements, coercions or arbitrary schema factories; no nested/nullable query values. Validation inside a separate service is not inferred as a request schema.
- Prisma parsing is supporting, best-effort metadata, not a complete Prisma language implementation. Service discovery uses service-named modules. Permission evidence does not prove effective authorization.
- Naming uses English singularization heuristics. Confidence/risk labels need human review, especially GET routes with hidden side effects.
- Indexing is limited to 3,000 files / 20 MB, with a 256 KB per-file cap; generated and oversized files are skipped.
- `doctor` checks local structure/configuration, not authentication validity or every API's health. Developer edits to generated code are protected but not merged.
- A separate Todo app was scanned and exercised through MCP locally. This verifies a real local integration, not arbitrary applications or hosted multi-user deployment.

For a later release, validate against more independent applications; improve alias/re-export and request-to-service schema tracing based on observed gaps, and add reviewed per-capability mapping overrides. Keep the same existing-API execution path and repeatable MCP contract tests.
