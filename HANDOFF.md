# Hive MCP handoff

Snapshot: 2026-10-06. Source checkout inspected: `/Users/pavan/nexaworks/hivemcp-v2` on `main`. The environment-provided path `/Users/pavan/nexaworks/hiveMCP` does **not** exist on this machine; older root README references that path and is stale. `UNVERIFIED` means the claim is not established by current repository files or a test performed for this handoff. Never paste `.env`, access tokens, cookies, or npm credentials into an assistant.

## 1. Summary

Hive has two related implementations in this repository. The product being released is the standalone `@usehive/cli` package in `packages/cli`: it statically scans an existing TypeScript/Next.js App Router application, lets its developer approve discovered operations, and generates a local MCP server whose tools call that application's existing HTTP APIs. Its intended user is an app developer who wants AI clients to operate their app without hand-writing an MCP wrapper. Example: in a Todo app, run `npx @usehive/cli scan --dry-run`, then `npx @usehive/cli scan --install`, approve `search_todos`, `create_todo`, and `complete_todo`, run the app and `npx @usehive/cli dev`, and connect a local MCP client to `http://127.0.0.1:3333/mcp`. Actual tool names depend on discovered routes. The older root Next.js application is a hosted Hive prototype with dashboard, GitHub analysis, Gemini inference, OAuth, and dynamic MCP; it is not required by the CLI package.

## 2. Current status

- **Works now, verified from files/tests:** The CLI detects supported Next.js projects; indexes bounded TypeScript/TSX/Prisma source without executing it; extracts supported routes, Zod inputs, service/permission evidence; classifies and reviews capabilities; generates guarded `.hive` files; serves selected tools over stateless Streamable HTTP or stdio. On 2026-10-06, `npm run typecheck` passed in `packages/cli`, its 21 tests passed (including a real Next.js fixture and MCP SDK client), and root `npm test` passed 50 tests. `packages/cli/VERIFICATION.md` records a Todo demo scan and stored SQLite changes, but that external Todo project was not re-tested for this handoff.
- **Partly built:** The root hosted prototype has implemented dashboard/API routes, GitHub App flow, analysis worker, Gemini inference, PostgreSQL state, Redis queue, application OAuth, agent OAuth, dynamic MCP, and playground. Its synthetic tests pass, but `docs/VERIFICATION.md` says real GitHub/Gemini/Orbit/external-client acceptance was pending. The CLI has an optional local shared MCP token and optional app credential forwarding, not production multi-user authorization.
- **Not built in the CLI:** production hosted gateway, per-user OAuth/account linking, public ChatGPT/Claude/Perplexity submission, automatic client config writing, OpenAPI import, Python/Java/Express analyzers, universal framework support, and model-provider routing. No stubs for these appear as CLI commands.
- **Versions:** local `packages/cli/package.json` and generated template are `0.0.2`; root hosted app is `0.1.0` and private. **Conversation-only:** Pavan provided successful `npm publish --access public` output and an npm email for `@usehive/cli@0.0.2` on 2026-09-26. `packages/cli/VERIFICATION.md` still says “not published,” so that line is stale relative to the conversation. **UNVERIFIED:** current npm registry `latest` tag, because registry lookup was unavailable during this handoff.
- **Git:** `main` has numerous pre-existing uncommitted CLI changes and untracked `packages/cli/LICENSE` and fixture `next-env.d.ts`. Do not reset or overwrite them. Only one commit was visible (`3a2eb7c first commit`).

## 3. Tech stack and environment

Node >=22.12.0 for the CLI/generated server; installed Node reported v22.12.0 during tests. npm lockfiles are present at root and `packages/cli`; project detection recognizes pnpm/yarn/bun but generated installation commands use npm. All three packages below use ESM (`"type": "module"`). CLI TypeScript: ES2022 target, `NodeNext` modules/resolution, strict, declarations into `dist`, `src` root. Generated server: same target/resolution, JSON modules, `dist` output. Root Next.js TypeScript: strict, `module: esnext`, `moduleResolution: bundler`, `noEmit`, React JSX. CLI compilation is `tsc`, no bundler; root build is Prisma generate + Next build. CLI/generated tests use Node's test runner through `tsx`; root tests use Vitest. Root Prettier config is single quotes, trailing commas, print width 100; no ESLint script/config was found. Root UI uses Next.js 16.3.4, React 19.3.0, Prisma/PostgreSQL, Redis/BullMQ, Google GenAI, and Playwright smoke script.

Full `package.json` contents (the dependency manifests; lockfiles are separate):

`/Users/pavan/nexaworks/hivemcp-v2/package.json`:

```json
{
  "name": "hive", "version": "0.1.0", "private": true,
  "scripts": {"dev":"next dev --hostname 127.0.0.1 --port 3000","build":"prisma generate && next build","start":"next start --hostname 127.0.0.1 --port 3000","worker":"tsx --env-file=.env workers/analysis.ts","db:generate":"prisma generate","db:migrate":"prisma migrate deploy","infra:up":"docker compose up -d","infra:down":"docker compose down","typecheck":"tsc --noEmit","test":"vitest run","test:integration":"tsx --env-file=.env scripts/integration.ts","test:ui":"tsx --env-file=.env scripts/ui-smoke.ts","format":"prettier --write .","hive:build":"npm --prefix packages/cli run build","hive:test":"npm --prefix packages/cli test","hive":"node packages/cli/dist/cli/index.js"},
  "dependencies": {"@google/genai":"2.22.0","@modelcontextprotocol/sdk":"1.30.0","@octokit/auth-app":"8.3.1","@octokit/rest":"22.0.1","@prisma/client":"6.19.3","@radix-ui/react-slot":"1.3.3","ajv":"8.20.0","ajv-formats":"3.0.1","bullmq":"6.3.4","class-variance-authority":"0.7.1","clsx":"2.1.1","ioredis":"6.0.0","lucide-react":"1.44.0","next":"16.3.4","react":"19.3.0","react-dom":"19.3.0","tailwind-merge":"3.6.0","ts-morph":"28.0.0","zod":"3.25.76","zod-to-json-schema":"3.25.2"},
  "devDependencies": {"@playwright/test":"1.63.0","@tailwindcss/postcss":"4.3.3","@types/node":"22.20.2","@types/react":"19.3.0","@types/react-dom":"19.3.0","prettier":"3.9.6","prisma":"6.19.3","tailwindcss":"4.3.3","tsx":"4.23.13","typescript":"7.0.2","vitest":"5.0.0"},
  "overrides": {"deepmerge-ts":"8.0.0"}, "type":"module"
}
```

`/Users/pavan/nexaworks/hivemcp-v2/packages/cli/package.json`:

```json
{
  "name":"@usehive/cli","version":"0.0.2","description":"Discover Next.js application capabilities and generate a local MCP server","type":"module","license":"MIT",
  "publishConfig":{"access":"public"},"bin":{"hive":"dist/cli/index.js"},"files":["dist","templates","README.md"],"engines":{"node":">=22.12.0"},
  "scripts":{"build":"tsc && node -e \"require('fs').chmodSync('dist/cli/index.js', 0o755)\"","dev":"tsx src/cli/index.ts","test":"tsx --test tests/*.test.ts","typecheck":"tsc --noEmit","prepack":"npm run build"},
  "dependencies":{"@clack/prompts":"^0.11.0","commander":"^14.0.0","ts-morph":"28.0.0"},
  "devDependencies":{"@modelcontextprotocol/sdk":"1.30.0","@types/node":"22.20.2","tsx":"4.23.13","typescript":"7.0.2","zod":"3.25.76"}
}
```

`/Users/pavan/nexaworks/hivemcp-v2/packages/cli/templates/mcp/package.json` (copied into generated apps):

```json
{
  "name":"hive-generated-mcp","version":"0.0.2","private":true,"type":"module","engines":{"node":">=22.12.0"},
  "scripts":{"build":"tsc","start":"node --env-file-if-exists=.env dist/server.js","dev":"tsx --env-file-if-exists=.env src/server.ts","test":"tsx --test tests/*.test.ts"},
  "dependencies":{"@modelcontextprotocol/sdk":"1.30.0","zod":"3.25.76"},
  "devDependencies":{"@types/node":"22.20.2","tsx":"4.23.13","typescript":"7.0.2"}
}
```

None of these manifests declares `exports`; root is private, CLI has a `bin`, template is private.

## 4. Repository layout

The following is the complete **source/project tree** from tracked files plus the two relevant untracked source files. Excluded as generated/local data: `.git`, all `node_modules`, `dist`, `.next`, `.hive` caches/output, `.env`, `*.tgz`, `.DS_Store`, and `tsconfig.tsbuildinfo`; these are present locally but not source. Every listed file/folder has its purpose after `—`.

```text
repo/ — combined hosted prototype and standalone CLI checkout
  .env.example — root hosted-app variable-name template
  .gitignore — ignores dependencies, build/state output and secrets
  .npmrc — local npm cache and exact-save settings
  .prettierignore — formatting exclusions
  .prettierrc.json — formatter settings
  AGENTS.md — Next.js agent rule to read installed Next docs before editing
  CLAUDE.md — companion development guidance
  README.md — hosted prototype overview, CLI pointer, acceptance caveats
  HANDOFF.md — this handoff document
  compose.yaml — local PostgreSQL/Redis services
  next-env.d.ts — Next-generated TypeScript references
  next.config.ts — Next configuration
  package.json — root private app manifest and scripts
  package-lock.json — root npm dependency lock
  postcss.config.mjs — Tailwind PostCSS plugin
  tsconfig.json — root Next TypeScript config
  vitest.config.ts — root test config
  app/ — hosted Next.js routes/pages
    .well-known/ — OAuth discovery endpoints
      oauth-authorization-server/route.ts — authorization-server metadata
      oauth-protected-resource/mcp/[slug]/route.ts — per-app resource metadata
    [[...page]]/page.tsx — catch-all dashboard page
    api/[...path]/route.ts — central hosted REST/auth/admin API dispatcher
    globals.css — global UI styles
    layout.tsx — HTML/root layout
    mcp/[slug]/route.ts — hosted MCP HTTP route
    oauth/authorize/page.tsx — agent consent page
  components/ — hosted UI
    dashboard.tsx — dashboard screens and actions
    login.tsx — sign-in/register interface
    ui/button.tsx — reusable button primitive
  docs/ — hosted prototype setup and acceptance records
    CONFIGURATION.md — GitHub/Gemini/OAuth setup steps
    VERIFICATION.md — hosted synthetic test evidence and pending external proof
  lib/ — hosted shared infrastructure
    config.ts — required environment helpers
    db.ts — Prisma client
    errors.ts — structured API errors
    utils.ts — class-name helper
  modules/ — hosted business modules
    ai/gemini.ts — Gemini inference, schema/evidence validation
    analysis/index.ts — hosted static analysis orchestrator
    analysis/types.ts — analysis contracts
    analysis/graph/build.ts — application capability graph
    analysis/nextjs/routes.ts — hosted App Router endpoint extraction
    analysis/parsers/files.ts — safe source reading
    analysis/parsers/prisma.ts — Prisma context extraction
    analysis/parsers/services.ts — service/permission extraction
    analysis/parsers/zod.ts — Zod AST extraction
    auth/session.ts — account/session/ownership checks
    environments/oauth.ts — external application account linking
    execution/service.ts — approved capability execution and confirmation
    github/client.ts — GitHub App/repository clients
    github/oauth.ts — GitHub user OAuth flow
    github/repository.ts — repository snapshot download
    github/webhook.ts — signed webhook processing
    jobs/queue.ts — BullMQ/Redis and rate limiting
    mcp/playground.ts — hosted MCP client and Gemini test loop
    mcp/server.ts — hosted dynamic MCP server
    oauth/agent.ts — agent OAuth token/code lifecycle
    security/crypto.ts — hashing/encryption/password functions
    security/http.ts — guarded outbound HTTP
    security/redact.ts — source/result redaction
  prisma/ — hosted database schema and migrations
    schema.prisma — entities and relations
    migrations/migration_lock.toml — Prisma migration provider lock
    migrations/202609110001_initial/migration.sql — initial SQL schema
  scripts/ — hosted setup and smoke/integration scripts
    setup-local.mjs — local environment/bootstrap
    integration.ts — synthetic HTTP/PostgreSQL integration run
    ui-smoke.ts — browser smoke test
  tests/ — hosted Vitest tests
    analysis.test.ts — analysis/semantic boundary tests
    fixture.ts — synthetic test fixtures
    security.test.ts — security/execution tests
  workers/analysis.ts — background repository-analysis worker
  packages/ — standalone package area
    cli/ — npm-publishable CLI package
      .gitignore — ignores package build/tarballs/dependencies
      LICENSE — MIT license, currently untracked
      README.md — CLI user and architecture docs
      VERIFICATION.md — CLI test evidence; publish line is stale
      package.json — npm name/bin/scripts/dependencies
      package-lock.json — CLI npm lock
      tsconfig.json — CLI compiler config
      src/ — CLI implementation
        cli/index.ts — Commander parsing, review, dev/inspect/doctor
        scanner/project.ts — project detection and bounded file index
        scanner/scan.ts — in-memory scan orchestration
        analyzers/types.ts — index/schema/evidence contracts
        analyzers/nextjs/routes.ts — route and request-input tracing
        analyzers/parsers/prisma.ts — Prisma models/enums
        analyzers/parsers/services.ts — service/permission symbols
        analyzers/parsers/zod.ts — Zod-to-JSON-Schema AST interpreter
        capabilities/build.ts — names, risk, candidates, diff
        generator/project.ts — guarded file generation and script insertion
      templates/mcp/ — independent generated runtime template
        .env.example — runtime variable-name template
        package.json — generated private package manifest
        tsconfig.json — generated compiler config
        src/adapter.ts — fixed API request mapping/auth strategy
        src/schema.ts — JSON Schema-to-strict-Zod conversion
        src/server.ts — MCP HTTP/stdio server
        src/types.ts — generated Tool/Schema contracts
        tests/generated.test.ts — generated mapping/schema test
      tests/ — CLI Node test suite
        analysis.test.ts — scanner/analyzer/generator cases
        integration.test.ts — real Next app/MCP SDK end-to-end
        runtime.test.ts — generated schema/adapter cases
        fixtures/tiny-crm/ — plain Next.js test application
          README.md — fixture purpose
          next-env.d.ts — untracked Next type reference
          next.config.ts — fixture Next config
          package.json — fixture dependencies
          tsconfig.json — fixture TypeScript setup
          lib/permissions.ts — permission checks
          lib/schemas.ts — input schemas
          services/crm-service.ts — CRM business operations
          prisma/schema.prisma — Prisma context fixture
          app/api/contacts/route.ts — collection handlers
          app/api/contacts/[id]/route.ts — item handler
          app/api/deals/route.ts — deals handler
          app/api/health/route.ts — excluded health handler
          app/api/sequences/[id]/route.ts — sequence read handler
          app/api/sequences/[id]/launch/route.ts — sequence action handler
```

## 5. Architecture

**CLI flow:** `packages/cli/src/cli/index.ts` checks Node version, registers Commander commands, and calls `scanCommand`. `scan()` in `scanner/scan.ts` calls `detectProject()` and `indexFiles()`, builds an in-memory `ts-morph` project, then runs `extractSchemas()`, `extractServices()`, `extractEndpoints()`, and `parsePrisma()`. `buildCandidates()` derives names/risk/confidence, while `diffCapabilities()` compares previous `capabilities.json`. Interactive Clack selection (or explicit flags) chooses supported tools. `generate()` copies readable templates, writes inventory/manifest/ownership hashes, and optionally `addPackageScript()` adds `hive:mcp` to the target app. Generated `server.ts` registers tools; `schema.ts` validates input; `adapter.ts` makes one fixed HTTP request to the app's own `/api/` route. Application auth/business rules remain in the app.

**Hosted prototype flow:** `app/api/[...path]/route.ts` dispatches account, repository, analysis, review, environment, and playground endpoints. `workers/analysis.ts` consumes BullMQ jobs and calls `modules/analysis`, Gemini inference, and Prisma persistence. `app/mcp/[slug]/route.ts` delegates to `handleMcp()` in `modules/mcp/server.ts`; `CapabilityExecutionService` uses an approved capability and per-user app credential to call the existing app API. `modules/mcp/playground.ts` is itself an MCP client. This code is separate from the CLI runtime.

Selected actual type contracts (abridged only where marked):

```ts
// packages/cli/src/scanner/project.ts
export type ProjectInfo = {
  root: string; name: string; framework: 'nextjs'; language: 'typescript';
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun'; appDirectory: string;
  zod: boolean; prisma: boolean; nextConfig: boolean;
};
// packages/cli/src/analyzers/types.ts
export type JsonSchema = {
  type?: string; properties?: Record<string, JsonSchema>; required?: string[];
  additionalProperties?: boolean; items?: JsonSchema; enum?: unknown[];
  format?: string; anyOf?: JsonSchema[]; [key: string]: unknown;
};
export type Evidence = { file: string; symbol: string; line: number; reason: string; snippet?: string };
export type Endpoint = {
  id: string; path: string; method: string; file: string; handler: string;
  line: number; calls: string[]; services: string[]; permissions: string[];
  schemaIds: string[]; inputSchema: JsonSchema; supported: boolean;
  warnings: string[]; evidence: Evidence[];
};
// packages/cli/src/capabilities/build.ts
export type Capability = {
  name: string; displayName: string; description: string;
  source: { method: string; route: string; file: string; handler: string };
  services: ServiceInfo[]; inputSchema: Endpoint['inputSchema']; permissions: string[];
  risk: 'read' | 'write' | 'destructive'; confidence: number;
  evidence: Endpoint['evidence']; supported: boolean; warnings: string[];
};
export interface CapabilityEnricher { enrich(capabilities: Capability[]): Promise<Capability[]>; }
// packages/cli/templates/mcp/src/types.ts
export type Tool = {
  name: string; description: string; risk: 'read' | 'write' | 'destructive';
  source: { method: string; route: string; file: string }; inputSchema: Schema;
};
// packages/cli/templates/mcp/src/adapter.ts
export type AuthContext = { authorization?: string; cookie?: string };
export interface AuthStrategy { headers(context: AuthContext): Record<string, string>; }
```

`ServiceInfo`, `SchemaInfo`, `DataModel`, `ApplicationIndex`, and `Graph` are fully defined in `packages/cli/src/analyzers/types.ts`. The generated `Schema` supports object/string/number/integer/boolean/null/array, enum, anyOf, selected bounds/formats; see `templates/mcp/src/types.ts` for the exact interface.

## 6. CLI surface

All commands are implemented, none are stubs. `-C, --cwd <directory>` is accepted by every command; default is the current directory. `hive --version` and `hive --help` are Commander global options. There are no positional arguments, nested subcommands, or hidden commands in `src/cli/index.ts`.

| Command/options | Action and example |
|---|---|
| `hive scan` | Detect, report, interactively approve, and generate. Example: `npx @usehive/cli scan -C /path/to/app`. Requires a TTY unless explicit selection flag. |
| `hive generate` | Alias-like re-scan/review/generate implementation using the same `scanCommand`; example `hive generate -C /path/to/app`. |
| `scan`/`generate --dry-run` | Human-readable discovery only; no writes. Example `hive scan --dry-run`. |
| `scan`/`generate --json` | Print full `ScanResult` JSON and exit without writes. Example `hive scan --json`. It takes precedence over `--dry-run` because checked first. |
| `scan`/`generate --select <names>` | Approve comma-separated supported names, including writes/deletes. Example `hive scan --select search_contacts,launch_sequence`. `--select ''` yields zero tools. |
| `scan`/`generate --read-only` | Select only supported `risk === 'read'` capabilities. Example `hive scan --read-only`. Cannot combine with `--select`. |
| `scan`/`generate --install` | After generation, run `npm install --ignore-scripts --no-audit --no-fund` in `.hive/mcp`. Example `hive scan --read-only --install`. |
| `scan`/`generate --no-script` | Do not add `hive:mcp` to app `package.json`. Example `hive scan --no-script`. |
| `hive dev [--stdio]` | Start generated source through its installed `tsx`; default HTTP, `--stdio` selects stdio. Example `hive dev --stdio`. |
| `hive inspect` | Print `.hive/manifest.json` and parsed `.hive/capabilities.json`. Example `hive inspect`. |
| `hive doctor` | Check project, generated package/files/SDK, manifest vs tools, and app origin; example `hive doctor`. Does **not** probe app/MCP network availability. |

Representative human output from source (counts vary): `Hive v0.0.2`, `✓ <app>: Next.js + TypeScript + App Router`, `✓ <N> source files indexed`, `<N> candidates: <unchanged> unchanged, <new> new, <changed> changed, <removed> removed`, `✓ search_contacts [READ] 95% — GET /api/contacts`, and after generation `✓ Generated MCP server...` plus local endpoint. Error text uses `Hive: <message>` on stderr and nonzero exit. The current fixture integration verifies `search_contacts`, `launch_sequence`, `create_contact`, `get_sequence`; exact outputs depend on fixture state. `hive doctor` prints `✓ Node ...`, runtime/tool count, app origin, and endpoint.

## 7. MCP specifics

- The **CLI** is a generator/manager, not itself an MCP client/server. Its **generated package** is an MCP server. The **older hosted prototype** is both MCP server (`modules/mcp/server.ts`) and client (`modules/mcp/playground.ts`).
- Generated server uses `@modelcontextprotocol/sdk` pinned to **1.30.0** and advertises server version `0.0.2`. MCP protocol negotiation version is determined by that SDK/client; **UNVERIFIED:** a single fixed protocol date, because the code does not pin one. It supports stateless **Streamable HTTP** via POST `/mcp` on `127.0.0.1:3333` by default and **stdio** via `--stdio`. It does not implement legacy SSE transport. Root hosted server similarly uses stateless Streamable HTTP under `/mcp/[slug]`.
- Generated `createMcp()` iterates selected `src/tools.json` and calls `McpServer.registerTool`. Tools are dynamic, not a fixed global set. Each has name, description, risk annotations (`readOnlyHint`, `destructiveHint`, `openWorldHint`), and a strict Zod object input converted from discovered JSON Schema. Typical schema envelope: `{"type":"object","properties":{"path":{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]},"query":{"type":"object","properties":{}},"body":{"type":"object","properties":{}}}}`; actual required keys/types depend on the scanned route. Example fixture call: `launch_sequence` with `{"path":{"id":"seq_123"},"body":{"confirm":true}}`. No generated resources or prompts are registered or consumed. Root hosted MCP likewise exposes tools only, with optional `hive_confirmation_id` on inputs; no resources/prompts registered in `modules/mcp/server.ts`.
- Generated tool execution calls only the approved fixed `/api/` route, validates path/query/body, refuses redirects, caps response at 2 MB and timeout at 120 seconds maximum. HTTP handler caps request at 1 MB and accepts only POST `/mcp`. Optional `HIVE_MCP_TOKEN` protects that local endpoint; it is never forwarded as app authorization.
- Target: generic compatible local MCP clients; Gemini CLI and SDK client are conversation/verification examples. The CLI **does not write** `.gemini/settings.json`, Claude config, ChatGPT settings, Cursor config, or any other client config. Configure client manually. A web-chat service cannot reach loopback without a tunnel or hosted endpoint. Public multi-user auth is absent in the generated CLI runtime.
- Hosted prototype's OAuth discovery endpoints are `/.well-known/oauth-protected-resource/mcp/[slug]` and `/.well-known/oauth-authorization-server`; its agent scope is `capabilities:execute`, with manual client registration per `README.md`. Do not conflate this with the generated CLI server.

## 8. Configuration and state

Generated app files live under `<target-app>/.hive/`: `manifest.json`, `capabilities.json`, `analysis.json`, `ownership.json`, `.gitignore`, `mcp/{package.json,tsconfig.json,.env.example,README.md,src/{server.ts,adapter.ts,schema.ts,types.ts,tools.json},tests/generated.test.ts}`. Optional edit to `<target-app>/package.json` adds `"hive:mcp": "npm --prefix .hive/mcp run dev"`; an existing script is preserved. `--install` creates `.hive/mcp/node_modules` and a lockfile. `.hive/generation.lock` is transient; stale after a crash. `.hive/mcp/.env` is user-created, ignored, and is not overwritten by regeneration.

Full **schema example without real credentials or token values** (derived from `generator/project.ts`; names are illustrative fixture names):

```json
{
  "version": "0.0.2",
  "application": {"name": "tiny-crm-fixture", "framework": "nextjs", "language": "typescript"},
  "generatedAt": "<ISO timestamp>",
  "capabilities": ["search_contacts", "launch_sequence"]
}
```

`capabilities.json` is an array of full `Capability` objects as typed above; `analysis.json` has `files`, `schemas`, `services`, `models`, `warnings`; `ownership.json` maps generated relative paths to SHA-256 content hashes; `mcp/src/tools.json` is an array of `{name,description,source:{method,route,file},inputSchema,risk}`. Read those files after scanning for the exact schema. No committed static config file can know a target app's tools.

Generated runtime environment **variable names only**: `HIVE_APP_BASE_URL`, `HIVE_MCP_PORT`, `HIVE_APP_BEARER_TOKEN`, `HIVE_APP_COOKIE`, `HIVE_FORWARD_AUTH`, `HIVE_MCP_TOKEN`, `HIVE_HTTP_TIMEOUT_MS`. `HIVE_TEST_NPM_CACHE` is an optional CLI integration-test cache path. Root hosted `.env.example` names: `DATABASE_URL`, `POSTGRES_PASSWORD`, `REDIS_URL`, `APP_URL`, `AUTH_SECRET`, `ENCRYPTION_KEY`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GEMINI_API_KEY`, `GEMINI_ANALYSIS_MODEL`. Root setup may create `.env`, `.hive/postgres`, `.hive/redis`; analysis may create ephemeral `.hive/repositories`. Never copy existing secret values into documentation.

## 9. Build, run, test, publish

CLI from this checkout:

```sh
cd /Users/pavan/nexaworks/hivemcp-v2
npm ci --prefix packages/cli
npm run hive:build
npm run hive:test
npm --prefix packages/cli run typecheck
node packages/cli/dist/cli/index.js scan -C packages/cli/tests/fixtures/tiny-crm --dry-run
```

For a separate supported app:

```sh
cd /path/to/nextjs-app
npx @usehive/cli scan --dry-run
npx @usehive/cli scan --install
# Copy .hive/mcp/.env.example to .hive/mcp/.env, then fill only needed variable values locally.
# Start the application in a separate terminal.
npx @usehive/cli doctor
npx @usehive/cli dev
```

Alternative built runtime: `npm --prefix .hive/mcp run build` then `npm --prefix .hive/mcp start`; for clean stdio, from `.hive/mcp` run `node --env-file-if-exists=.env dist/server.js --stdio`. Local CLI link: `cd /Users/pavan/nexaworks/hivemcp-v2/packages/cli && npm link`, then `hive --version` in a target app; `npm unlink -g @usehive/cli` removes that global link. **UNVERIFIED:** link procedure in this checkout was not re-run during handoff.

Root hosted app (separate product): `npm ci`, `node scripts/setup-local.mjs`, `npm run infra:up`, `npm run db:generate`, `npm run db:migrate`, `npm run dev`; run `npm run worker` in another terminal after local `.env` is configured. Checks: `npm run typecheck`, `npm test`, `npm run build`; external integration/UI scripts are `npm run test:integration` and `npm run test:ui` and were not re-run for this handoff.

Publish CLI from `packages/cli`: `npm whoami`, `npm pack --dry-run`, `npm publish --access public`. `prepack` builds automatically. Publishing is irreversible for a version; choose/increment the version and review tarball before any future publish. `npm login` if needed; never document credentials. **Conversation-only:** 0.0.2 was published successfully. Do not republish 0.0.2 without checking registry state.

Current test coverage: 21 CLI tests pass, covering project detection, file safety, route/Zod/Prisma extraction, naming/diff, generation ownership, schema adapter/auth behavior, and real Next.js -> generated HTTP/stdio MCP -> state change. Root 50 tests pass for analysis/security. Untested here: arbitrary customer apps, production remote hosting/OAuth, browser ChatGPT/Claude/Perplexity compatibility, live GitHub/Gemini/Orbit acceptance, Node/platform matrix, and current npm registry state.

## 10. Decisions and reasoning

**Code/docs evidenced:** CLI was split from root hosted prototype to allow an npm package with no dashboard/database/model/API-key dependency. Static `ts-morph` discovery avoids executing target source. Supported input mappings are conservative; unsupported constructs get warnings and cannot be selected. Review is required before tool exposure; reads start selected only in the interactive UI, writes/deletes do not. Source APIs retain app auth, validation, and business rules; no generic HTTP/SQL tool is generated. Separate `path`, `query`, `body` avoids field collisions. Hash ownership and symlink checks protect developer edits; per-file atomic writes and a generation lock reduce corruption. Runtime uses loopback and exact Host/Origin checks because it is a local prototype; shared MCP token is optional and separate from app credentials. CLI avoids model dependency; `DeterministicCapabilityEnricher` is a future extension point, not LLM inference.

**Conversation-only decisions:** Keep npm scope `@usehive`, copyright name Pavan, MIT license, package version 0.0.2. The Todo demo was chosen for a visible chatbot-to-app state-change demonstration. User prefers eventual use from web chat interfaces as well as Gemini CLI, wants more programming-language/framework support, and is exploring Perplexity custom MCP connector, Claude, ChatGPT, OpenRouter, and a private HTTPS tunnel test before a multi-user release. No repository code for that tunnel test was changed in this handoff. The user also wants to interview people directly building product MCP integrations before prioritizing features.

**Tried/dropped or deferred:** Earlier root hosted prototype used GitHub + Gemini + database/OAuth; CLI chose simpler deterministic local generation for public npm release, but root code was retained. Gemini website eligibility and ChatGPT Plus connector capabilities were discussed as platform constraints, not implemented code. No evidence in repository of a discarded OpenAPI/Python/Java implementation. Do not imply client-specific MCP servers are needed; one standards-based remote MCP server can serve multiple compatible clients, subject to their auth/listing requirements.

## 11. Known issues

- `packages/cli/VERIFICATION.md:10` and `:60` say package not published; this conflicts with conversation-provided npm publish success. Update after checking registry.
- Root `README.md` and `docs/CONFIGURATION.md` reference `/Users/pavan/NexaWorks/hiveMCP`, missing in the current filesystem; actual inspected checkout is `/Users/pavan/nexaworks/hivemcp-v2`. **UNVERIFIED:** whether another copy exists elsewhere.
- Many CLI files are modified but uncommitted on `main`; do not discard. `packages/cli/LICENSE` and fixture `next-env.d.ts` are untracked. No distinct branch for remote-connector work was found.
- No `TODO`/`FIXME`/`XXX` markers were found in scanned source paths on 2026-10-06; this does not mean no limitations.
- CLI analyzer limits: 3,000 files/20 MB total, 256 KB per file, static TS/TSX and Prisma only; inherited `tsconfig` aliases explicitly warned as unresolved (`scanner/scan.ts:19`); wrapped handlers, catch-all routes, dynamic schemas/transforms, nested query values, and non-JSON bodies need manual review (`packages/cli/README.md`, generated README text in `generator/project.ts`). Risk/confidence are heuristics, not policy proof.
- Generated `server.ts:51-62,127` binds loopback and rejects non-local Host/Origin; a public HTTPS tunnel may need Host rewriting or code/config changes. **UNVERIFIED:** no tunnel was tested. `server.ts:64` token is optional, so do not expose an unprotected server publicly. Generated runtime has no per-user OAuth or tenant isolation.
- `generator/project.ts:100-122` writes files atomically one by one, not as a whole transaction; a forced crash can leave a stale lock/mixed tree. Regeneration refuses edited/unowned files; preserve them.
- `doctor` checks file/config consistency, not whether app calls succeed. `HIVE_FORWARD_AUTH=true` is opt-in and needs careful auth design before multi-user use.
- Root hosted prototype still requires external provider configuration and real acceptance. Synthetic tests are not proof against Orbit. Root `README.md` may describe older paths/status.
- Tests initially failed inside the restricted sandbox because `tsx` needed a local pipe and Vitest a temp config write; rerun with appropriate filesystem permission passed (21 CLI, 50 root). This was an environment permission issue, not failing assertions.

## 12. Roadmap

Priority is **conversation-only intent**, not committed project planning:

1. **Very next task:** Continue the private Perplexity web-chat demo. Stop point: generated Todo MCP worked locally through Gemini CLI; discussion identified that Perplexity accepts a custom remote MCP URL, but no tunnel, HTTPS endpoint, or Perplexity test was created. First verify the separate Todo app still exists/runs, confirm its generated MCP server and credentials, then test a protected short-lived HTTPS tunnel with correct local Host forwarding. Exercise `tools/list` and one Todo write through the remote URL, then connect in Perplexity and verify app state. Do not change Hive CLI or expose app credentials until the minimal test requirements are clear. **UNVERIFIED:** external Todo app current state, Perplexity plan/connector settings, tunnel provider, and whether Host forwarding alone works.
2. For a public product: decide whether Hive remains generator-only or gains hosted deployment/gateway; implement stable HTTPS, per-user OAuth/account mapping, tenant authorization, revocation, audit, and cross-client conformance before promising browser chatbot use.
3. Add framework coverage based on interviews: proposed OpenAPI import for cross-language APIs, then targeted Python FastAPI / Node Express / Java framework analyzers if demand justifies them. None exists now.
4. Provide client-specific setup guides/config generation for Gemini CLI, Claude, Perplexity, ChatGPT where supported; test each rather than claiming universal compatibility.
5. Optional Hive-owned chat playground with OpenRouter model routing; OpenRouter would supply models, while Hive/backend must still execute MCP tool calls. Not started.
6. Update docs and website install examples, verify published registry metadata, maintain npm releases. Continue targeted customer interviews before locking roadmap.

## 13. Conventions

CLI modules use lower-case folders by responsibility (`scanner`, `analyzers`, `capabilities`, `generator`, `cli`) and named exports; generated runtime lives under `templates/mcp`. User-facing tool names are snake_case (`capabilityName()` in `capabilities/build.ts`); collisions get deterministic hash suffixes. TypeScript is strict ESM and relative imports in CLI source use `.js` extensions. Errors are thrown with actionable text; top-level CLI catch prints `Hive: ...` and sets nonzero exit. Scan output uses `✓` for supported, `!` for warnings, risk/confidence/source route for review. Generated server logs startup/errors to stderr so stdio stdout remains protocol-clean; tool failures return sanitized messages rather than internal response bodies. Root hosted API uses `HiveError` codes and `errorResponse()`. Formatting config is Prettier settings above. No commit message convention is established: only `first commit` was found; **UNVERIFIED** any preferred convention.

**Conversation-only user preferences:** clear numbered steps when giving manual instructions; show visible app state changes as proof; favor an npm package and MIT license; keep package scope `@usehive`; test privately before enabling public multi-user access; be candid about what is not shipped. Do not claim a hosted connector or broad language support yet.

## 14. Open questions

Ask only when the answer is needed to proceed; first inspect current external app/config:

1. Is `/Users/pavan/nexaworks/todo-demo` still the desired private demo app, and is its local `.hive/mcp` output current? **UNVERIFIED.**
2. Which tunnel/domain provider should be used for the private Perplexity test, and does Pavan's Perplexity account expose API-key-authenticated remote MCP? **UNVERIFIED.**
3. Should remote hosting/account linking become part of Hive CLI itself, a separate Hive service, or deployment recipes? Undecided in conversation.
4. Which framework should follow Next.js TypeScript: OpenAPI-first, FastAPI, Express, Java/Spring, or another? User clarified they mean programming languages/frameworks, but did not select a next target.
5. Which browser client should be first production compatibility target, after private Perplexity proof? Undecided.
6. Is a future OpenRouter playground in scope for Hive, or only a separate demo? Undecided.
7. What release/version strategy follows published 0.0.2? Registry latest is **UNVERIFIED**.

## Ten files to read first

1. `packages/cli/README.md` — actual public CLI contract and limitations.
2. `packages/cli/src/cli/index.ts` — exact commands, flags, and review flow.
3. `packages/cli/src/scanner/scan.ts` — scan pipeline.
4. `packages/cli/src/scanner/project.ts` — supported projects and indexing bounds.
5. `packages/cli/src/analyzers/nextjs/routes.ts` — route/input discovery and unsupported cases.
6. `packages/cli/src/capabilities/build.ts` — tool naming, risk, candidate construction.
7. `packages/cli/src/generator/project.ts` — output files, ownership, regeneration.
8. `packages/cli/templates/mcp/src/server.ts` — generated MCP transport/tool registration.
9. `packages/cli/templates/mcp/src/adapter.ts` — existing app API calls and auth boundaries.
10. `packages/cli/tests/integration.test.ts` — reproducible end-to-end proof and its exact limits.
