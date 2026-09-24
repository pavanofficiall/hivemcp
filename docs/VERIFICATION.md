# Verification and acceptance status

Date: 2026-09-11. Environment: Node 22.12, macOS, Docker PostgreSQL 17 and Redis 7, Next.js 16.3.4, official MCP TypeScript SDK 1.30.0.

## Executed successfully

- PostgreSQL migration from the committed initial SQL migration.
- Strict TypeScript checking.
- Optimized Next.js production build.
- Chrome browser smoke test: actual registration and dashboard navigation, settings and missing-provider state, desktop/mobile screenshots, no JavaScript page errors and no mobile horizontal overflow.
- 42 unit tests: deterministic index/graph, Zod and Prisma parsing, services, permissions, GitHub metadata, semantic JSON/evidence validation, deduplication, safe policy defaults, encryption binding, redaction, input validation and path security.
- 27 HTTP/PostgreSQL integration checks: registration/session, unauthorized dashboard and CSRF rejection, actual fixture source analysis, approval/publication gating, application OAuth with PKCE and userinfo, state replay rejection, MCP resource discovery, exact OAuth redirects, agent code exchange/replay, invalid/expired tokens, cross-application slug denial, official SDK client initialization, dynamic tools, invalid-input/tool injection rejection, pre-confirmation database state, user approval, input-bound one-use confirmation, real fixture HTTP service/PostgreSQL write, sanitized response/audit, verified state, application permission propagation, disabled/rejected capability denial, refresh rotation and revocation.
- Dependency audit after pinning the patched `deepmerge-ts` transitive dependency: zero reported vulnerabilities.

The integration test uses an explicitly synthetic ticket service. Its static index is actually parsed from source; its semantic output is a labeled contract fixture. It never calls GitHub or Gemini. The test writes real rows to an isolated table in Hive's local test database and deletes all test data afterward. It is not evidence of an Orbit database change.

## Pending external proof

| Acceptance item                            | Status     | Required next step                                              |
| ------------------------------------------ | ---------- | --------------------------------------------------------------- |
| Live GitHub App installation and user auth | Not tested | Configure App credentials; install from Hive                    |
| Live repository retrieval                  | Not tested | Select the actual Orbit repository                              |
| Actual Orbit analyzer coverage             | Not tested | Run analysis against its source                                 |
| Live Gemini semantic inference             | Not tested | Configure API key; run evidence inference                       |
| Orbit OAuth and permissions                | Not tested | Configure the existing app's actual OAuth provider              |
| Orbit write through its API and services   | Not tested | Confirm a discovered operation and inspect Orbit state          |
| Real signed GitHub webhook delivery        | Not tested | Configure a reachable receiver                                  |
| ChatGPT                                    | Not tested | Complete local proof, then provide reachable MCP/OAuth endpoint |
| Claude                                     | Not tested | Same endpoint and registry                                      |
| Gemini Spark                               | Not tested | Same endpoint, subject to actual client availability            |

No production deployment, public URL, tunnel, GitHub App, Gemini API key, or Orbit integration change has been created. The implementation deliberately stops at external configuration instead of creating fake provider or Orbit results.

## Material V1 limits

- Conservative analyzer subset; unresolved wrapper/dataflow/schema patterns block approval.
- Direct service relationships rather than a complete transitive program graph; no complete role-permission matrix proof yet.
- Gemini model access, rate limits and live structured schema acceptance remain to be verified.
- Application OAuth requires discovery + userinfo on one issuer origin and explicit reauthorization at expiry.
- MCP client registration is manual; external clients requiring dynamic registration may need an adapter after testing.
- One owner per application; local account auth has no verification/recovery or organization management.
- No automated assertion that a live application deployment corresponds to the analyzed source commit.
- No automatic write retries, exactly-once external execution guarantee, or distributed transaction with the external application's database.
- Force-killed analyses can leave ignored source workspaces; normal completion/failure cleans them.
- UI compatibility badges remain “Not tested”; they are not simulated outcomes.

The next milestone is the real GitHub → Orbit static analysis → Gemini → reviewed capability → Orbit authorization → MCP → verified Orbit state-change proof. The complete engineering report and investor-demo claims must wait for that milestone.
