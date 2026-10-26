import * as prompts from '@clack/prompts';
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { cp, mkdir, readFile, rm, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { exists } from '../scanner/project.js';
import { readServed } from '../generator/project.js';
import type { ToolDefinition } from '../capabilities/sync.js';
import { VERSION } from '../version.js';
import { readPolicy } from './tools.js';

export type DeployState = {
  provider: 'vercel';
  appUrl: string;
  project: string;
  key: string;
  url?: string;
  deployedAt?: string;
};
export type DeployOptions = {
  cwd: string;
  appUrl?: string;
  project?: string;
  rotateKey?: boolean;
  skipChecks?: boolean;
  yes?: boolean;
};
type Fetch = typeof fetch;
export type Check = { level: 'ok' | 'warn' | 'error'; message: string };

const statePath = (root: string) => path.join(root, '.hive/deploy.json');
const bundleDir = (root: string) => path.join(root, '.hive/deploy/vercel');
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n';

export async function readDeployState(root: string): Promise<DeployState | undefined> {
  try {
    return JSON.parse(await readFile(statePath(root), 'utf8'));
  } catch (error: any) {
    if (error.code === 'ENOENT') return undefined;
    throw new Error('Cannot read .hive/deploy.json; fix or delete it and run hive deploy again.');
  }
}
async function writeDeployState(root: string, state: DeployState) {
  const temp = statePath(root) + '.' + randomBytes(6).toString('hex') + '.tmp';
  await writeFile(temp, json(state), { mode: 0o600 });
  await rename(temp, statePath(root));
}

function privateAddress(address: string) {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a.startsWith('::ffff:')) return privateAddress(a.slice(7));
    return a === '::1' || a === '::' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
  }
  const [a, b] = address.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

// The hosted MCP server runs on Vercel, so the application must be reachable from the internet.
export function checkAppUrl(raw: string): { url?: URL; error?: string } {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return {
      error: `"${raw}" is not a URL. Use the address of your deployed app, e.g. https://myapp.com`,
    };
  }
  if (!['http:', 'https:'].includes(url.protocol))
    return { error: 'The app URL must start with https://' };
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname))
    return { error: 'Use only the app origin, e.g. https://myapp.com (no path, query or login).' };
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    (isIP(host) && privateAddress(host))
  )
    return {
      error: `${url.origin} only exists on your computer, so a hosted MCP server can't reach it.\n  Deploy your app's frontend and backend first (for example to Vercel), then run hive deploy --app-url https://your-app.com`,
    };
  return { url };
}

function networkReason(error: any) {
  const code = error?.cause?.code ?? error?.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN')
    return 'the domain does not exist (DNS lookup failed)';
  if (code === 'ECONNREFUSED') return 'the server refused the connection';
  if (error?.name === 'TimeoutError' || code === 'UND_ERR_CONNECT_TIMEOUT')
    return 'it did not answer within 10 seconds';
  if (typeof code === 'string' && code.includes('CERT')) return 'its HTTPS certificate is invalid';
  return 'the request failed';
}
const probeRoute = (route: string) => route.replace(/\{[^}]+\}/g, 'hive-check');

// Read-only checks against the live app. Write routes are only probed with OPTIONS, never called.
export async function preflight(
  origin: URL,
  tools: ToolDefinition[],
  headers: Record<string, string>,
  fetchImpl: Fetch = fetch,
): Promise<Check[]> {
  const checks: Check[] = [];
  if (origin.protocol === 'http:')
    checks.push({
      level: 'warn',
      message: `${origin.origin} is not HTTPS; credentials would travel unencrypted.`,
    });
  try {
    const addresses = await lookup(origin.hostname, { all: true });
    if (addresses.length && addresses.every((a) => privateAddress(a.address)))
      return [
        ...checks,
        {
          level: 'error',
          message: `${origin.hostname} points to a private network address, so a hosted server can't reach it. Deploy your app publicly first.`,
        },
      ];
  } catch {}
  try {
    await fetchImpl(origin, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    checks.push({ level: 'ok', message: `${origin.origin} is online` });
  } catch (error) {
    checks.push({
      level: 'error',
      message: `${origin.origin} isn't reachable: ${networkReason(error)}.\n  Is your app deployed and running? Deploy its frontend and backend first, then run hive deploy again.`,
    });
    return checks;
  }
  let authChecked = false;
  for (const tool of tools) {
    const label = `${tool.source.method} ${tool.source.route}`;
    const url = new URL(probeRoute(tool.source.route), origin);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'OPTIONS',
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      checks.push({ level: 'error', message: `${label}: ${networkReason(error)}` });
      continue;
    }
    if (response.status === 404) {
      checks.push({
        level: 'error',
        message: `${label} is missing on the live app (404). Your deployed app is older than your code: deploy your latest version, then try again.`,
      });
      continue;
    }
    const allow = response.headers.get('allow');
    if (
      allow &&
      !allow
        .toUpperCase()
        .split(/\s*,\s*/)
        .includes(tool.source.method)
    ) {
      checks.push({
        level: 'error',
        message: `${label}: the live route doesn't accept ${tool.source.method} yet (allows ${allow}). Deploy your latest app version.`,
      });
      continue;
    }
    checks.push({ level: 'ok', message: `${tool.name} → ${label} exists` });
    // One safe authenticated read tells us whether the app accepts Hive's credentials.
    if (!authChecked && tool.source.method === 'GET' && !tool.source.route.includes('{')) {
      authChecked = true;
      try {
        const read = await fetchImpl(url, {
          headers: { accept: 'application/json', ...headers },
          redirect: 'manual',
          signal: AbortSignal.timeout(10_000),
        });
        if (read.status === 401 || read.status === 403)
          checks.push({
            level: 'error',
            message: `${label} returned ${read.status}: your app rejected Hive's credentials.\n  Set HIVE_APP_BEARER_TOKEN in .hive/mcp/.env to an API key your app accepts.`,
          });
        else if (read.status >= 500)
          checks.push({
            level: 'warn',
            message: `${label} returned ${read.status}; your app has a server error.`,
          });
        else if (read.status >= 300 && read.status < 400)
          checks.push({
            level: 'warn',
            message: `${label} redirects (${read.status}), often to a login page. Hive refuses redirects; check your API key.`,
          });
        else
          checks.push({
            level: 'ok',
            message: `${tool.name} answered ${read.status} with Hive's credentials`,
          });
      } catch (error) {
        checks.push({ level: 'error', message: `${label}: ${networkReason(error)}` });
      }
    }
  }
  if (!authChecked && tools.length)
    checks.push({
      level: 'warn',
      message: 'No simple read tool to test credentials with; write tools were not called.',
    });
  return checks;
}

async function appCredentials(root: string) {
  let env: Record<string, string | undefined> = {};
  try {
    env = parseEnv(await readFile(path.join(root, '.hive/mcp/.env'), 'utf8'));
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }
  const vars: Record<string, string> = {};
  const headers: Record<string, string> = {};
  if (env.HIVE_APP_BEARER_TOKEN) {
    vars.HIVE_APP_BEARER_TOKEN = env.HIVE_APP_BEARER_TOKEN;
    headers.authorization = `Bearer ${env.HIVE_APP_BEARER_TOKEN}`;
  }
  if (env.HIVE_APP_COOKIE) {
    vars.HIVE_APP_COOKIE = env.HIVE_APP_COOKIE;
    headers.cookie = env.HIVE_APP_COOKIE;
  }
  if (env.HIVE_HTTP_TIMEOUT_MS) vars.HIVE_HTTP_TIMEOUT_MS = env.HIVE_HTTP_TIMEOUT_MS;
  return { vars, headers, cookie: Boolean(env.HIVE_APP_COOKIE) };
}

function capture(command: string, args: string[], cwd: string, inheritStderr = true) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['inherit', 'pipe', inheritStderr ? 'inherit' : 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d) => (stdout += d));
    child.stderr?.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
  });
}
function vercelCommand(): [string, string[]] {
  if (process.env.HIVE_VERCEL_BIN) return [process.env.HIVE_VERCEL_BIN, []];
  if (spawnSync('vercel', ['--version'], { stdio: 'ignore' }).status === 0) return ['vercel', []];
  return ['npx', ['--yes', 'vercel@48']];
}

// Builds a self-contained Vercel project from the generated server. .vercel/ (the project link) is kept.
export async function buildBundle(root: string) {
  const mcp = path.join(root, '.hive/mcp');
  const dist = path.join(mcp, 'dist');
  if (!(await exists(path.join(dist, 'vercel.js'))))
    throw new Error('Generated server is not built. Run npm --prefix .hive/mcp run build.');
  const dir = bundleDir(root);
  for (const sub of ['api', 'lib']) await rm(path.join(dir, sub), { recursive: true, force: true });
  await mkdir(path.join(dir, 'api'), { recursive: true });
  await cp(dist, path.join(dir, 'lib'), {
    recursive: true,
    filter: (src) => !src.endsWith('server.js'),
  });
  const generated = JSON.parse(await readFile(path.join(mcp, 'package.json'), 'utf8'));
  await writeFile(
    path.join(dir, 'api/mcp.js'),
    `// Generated by Hive v${VERSION}. Vercel Function entry; see lib/vercel.js.\nimport { handle } from '../lib/vercel.js';\nexport const GET = handle;\nexport const POST = handle;\nexport const DELETE = handle;\n`,
  );
  await writeFile(
    path.join(dir, 'package.json'),
    json({
      name: 'hive-mcp',
      private: true,
      type: 'module',
      engines: { node: '22.x' },
      dependencies: generated.dependencies,
    }),
  );
  await writeFile(
    path.join(dir, 'vercel.json'),
    json({ rewrites: [{ source: '/mcp/:key', destination: '/api/mcp?key=:key' }] }),
  );
  await writeFile(path.join(dir, '.gitignore'), '.vercel\nnode_modules\n');
  return dir;
}

// Calls the deployed endpoint the way a chatbot would: initialize, then tools/list.
export async function verifyEndpoint(endpoint: string, fetchImpl: Fetch = fetch) {
  const call = async (method: string, params: unknown, id: number) => {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
    const body: any = await response.json();
    if (body.error) throw new Error(`${method} failed: ${body.error.message}`);
    return body.result;
  };
  await call(
    'initialize',
    {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'hive-deploy-check', version: VERSION },
    },
    1,
  );
  const listed = await call('tools/list', {}, 2);
  return (listed.tools as { name: string }[]).map((t) => t.name);
}

const slug = (name: string) =>
  (name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90) || 'app') + '-mcp';
const print = (check: Check) =>
  console.log(
    `${check.level === 'ok' ? '✓' : check.level === 'warn' ? '!' : '✗'} ${check.message}`,
  );

export async function deployCommand(options: DeployOptions) {
  const root = path.resolve(options.cwd);
  const served = await readServed(root);
  const manifest = JSON.parse(await readFile(path.join(root, '.hive/manifest.json'), 'utf8'));
  const previous = await readDeployState(root);
  const interactive = process.stdin.isTTY && process.stdout.isTTY && !options.yes;
  console.log(`Hive v${VERSION} deploy · ${manifest.application?.name ?? path.basename(root)}\n`);

  let raw = options.appUrl ?? previous?.appUrl;
  if (!raw) {
    if (!interactive)
      throw new Error(
        'Pass --app-url https://your-app.com (the public address of your deployed app).',
      );
    const answer = await prompts.text({
      message: 'Where is your app running on the internet?',
      placeholder: 'https://your-app.com',
    });
    if (prompts.isCancel(answer)) return console.log('Cancelled; nothing deployed.');
    raw = answer;
  }
  const checked = checkAppUrl(raw);
  if (!checked.url) throw new Error(checked.error);
  const appUrl = checked.url;

  const policy = await readPolicy(root);
  const credentials = await appCredentials(root);
  if (credentials.cookie)
    console.log(
      '! Using HIVE_APP_COOKIE: browser cookies expire, and the live server breaks when they do. Prefer an API key.',
    );

  if (!options.skipChecks) {
    console.log(`Checking ${appUrl.origin}…`);
    const checks = await preflight(appUrl, served.tools, credentials.headers);
    checks.forEach(print);
    if (checks.some((c) => c.level === 'error'))
      throw new Error(
        'Fix the problems above, then run hive deploy again (or --skip-checks to override).',
      );
    console.log();
  }

  const mcp = path.join(root, '.hive/mcp');
  if (!(await exists(path.join(mcp, 'src/vercel.ts'))))
    throw new Error(
      `Your MCP server was generated by Hive v${served.version}, which can't be hosted yet. Run hive sync first.`,
    );
  if (!(await exists(path.join(mcp, 'node_modules/typescript/package.json')))) {
    console.log('Installing generated server dependencies…');
    const install = await capture(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      mcp,
    );
    if (install.code !== 0) throw new Error('npm install failed in .hive/mcp');
  }
  const build = await capture('npm', ['run', 'build', '--silent'], mcp);
  if (build.code !== 0)
    throw new Error('Building the generated server failed (npm --prefix .hive/mcp run build).');
  const dir = await buildBundle(root);

  const state: DeployState = {
    provider: 'vercel',
    appUrl: appUrl.origin,
    project:
      options.project ??
      previous?.project ??
      slug(manifest.application?.name ?? path.basename(root)),
    key: !options.rotateKey && previous?.key ? previous.key : randomBytes(24).toString('base64url'),
    url: previous?.url,
  };
  const [bin, prefix] = vercelCommand();
  const vercel = (args: string[], inheritStderr = true) =>
    capture(bin, [...prefix, ...args], dir, inheritStderr);

  if ((await vercel(['whoami'], false)).code !== 0) {
    if (!interactive) throw new Error('Not logged in to Vercel. Run: npx vercel login');
    console.log('Log in to Vercel (opens your browser)…');
    if ((await vercel(['login'])).code !== 0) throw new Error('Vercel login failed.');
  }
  if (!(await exists(path.join(dir, '.vercel/project.json')))) {
    if ((await vercel(['link', '--yes', '--project', state.project])).code !== 0)
      throw new Error(`Could not create or link the Vercel project ${state.project}.`);
  }
  const env: Record<string, string> = {
    HIVE_APP_BASE_URL: appUrl.origin,
    HIVE_MCP_PATH_KEY: state.key,
    HIVE_POLICY_JSON: JSON.stringify({ mode: policy.mode, tools: policy.tools }),
    HIVE_LOG: 'stdout',
    ...credentials.vars,
  };
  console.log(`Deploying ${served.tools.length} tools to Vercel project ${state.project}…`);
  const deployed = await vercel([
    'deploy',
    '--prod',
    '--yes',
    ...Object.entries(env).flatMap(([k, v]) => ['--env', `${k}=${v}`]),
  ]);
  const deploymentUrl = deployed.stdout.match(/https?:\/\/\S+/g)?.pop();
  if (deployed.code !== 0 || !deploymentUrl)
    throw new Error('Vercel deployment failed; see the output above.');

  // Unique deployment URLs can sit behind Vercel Authentication; the production alias is public.
  const inspect = await vercel(['inspect', deploymentUrl], false);
  const aliases = [
    ...new Set(
      `${inspect.stdout}\n${inspect.stderr}`.match(/https:\/\/[a-z0-9.-]+\.vercel\.app/g) ?? [],
    ),
  ]
    .filter((u) => u !== deploymentUrl)
    .sort((a, b) => a.length - b.length);
  const candidates = [
    ...new Set([
      ...(state.url ? [state.url] : []),
      ...aliases,
      `https://${state.project}.vercel.app`,
      deploymentUrl,
    ]),
  ];
  let live: string | undefined;
  let names: string[] = [];
  let lastError = '';
  for (const base of candidates) {
    try {
      names = await verifyEndpoint(`${base}/mcp/${state.key}`);
      live = base;
      break;
    } catch (error: any) {
      lastError = `${base}: ${error.message}`;
    }
  }
  if (!live)
    throw new Error(
      `Deployed, but the MCP endpoint did not answer (${lastError}).\n  If Vercel Deployment Protection is on for production, turn it off for project ${state.project}.`,
    );
  state.url = live;
  state.deployedAt = new Date().toISOString();
  await writeDeployState(root, state);
  const endpoint = `${live}/mcp/${state.key}`;
  console.log(
    `\n✓ Live and answering: ${names.length} tools (${names.join(', ') || 'none enabled'})`,
  );
  console.log(
    `\nYour MCP link (keep it private — anyone with it can use these tools):\n  ${endpoint}`,
  );
  console.log(
    `\nClaude:  Settings → Connectors → Add custom connector → paste the link → No sign-in\nChatGPT: Settings → Apps → Add custom MCP server → paste the link → No authentication\nRotate the link with hive deploy --rotate-key. Calls appear in your Vercel project's runtime logs.`,
  );
}
