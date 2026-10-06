#!/usr/bin/env node
import { Command } from 'commander';
import * as prompts from '@clack/prompts';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { scan } from '../scanner/scan.js';
import { exists, detectProject } from '../scanner/project.js';
import { generate, readPrevious, readServed, addPackageScript } from '../generator/project.js';
import { diffCapabilities } from '../capabilities/build.js';
import { VERSION } from '../version.js';
import { planSync } from '../capabilities/sync.js';
import { listTools, setTool, setMode, readPolicy, allowed } from './tools.js';
import { showLogs } from './logs.js';
export async function run(command: string, args: string[], cwd: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false });
    const forward = () => child.kill('SIGTERM');
    process.once('SIGINT', forward);
    process.once('SIGTERM', forward);
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      process.removeListener('SIGINT', forward);
      process.removeListener('SIGTERM', forward);
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${signal ?? code}`));
    });
  });
}
type Options = {
  cwd: string;
  select?: string;
  readOnly?: boolean;
  dryRun?: boolean;
  json?: boolean;
  install?: boolean;
  script?: boolean;
};
async function scanCommand(options: Options) {
  const result = await scan(options.cwd);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(
    `Hive v${VERSION}\n\n✓ ${result.application.name}: Next.js + TypeScript + App Router\n✓ ${result.files} source files indexed\n✓ ${result.endpoints.length} API operations, ${result.schemas.length} schemas, ${result.services.length} service functions, ${result.models.length} Prisma models/enums\nZod: ${result.application.zod ? 'detected' : 'not declared'} · Prisma: ${result.application.prisma ? 'detected' : 'not detected'}`,
  );
  const previous = await readPrevious(result.application.root);
  const diff = diffCapabilities(previous, result.candidates);
  console.log(
    `\n${result.candidates.length} candidates: ${diff.unchanged} unchanged, ${diff.added} new, ${diff.changed} changed, ${diff.removed} removed\n`,
  );
  for (const c of result.candidates) {
    console.log(
      `${c.supported ? '✓' : '!'} ${c.name} [${c.risk.toUpperCase()}] ${Math.round(c.confidence * 100)}% — ${c.source.method} ${c.source.route}`,
    );
    for (const warning of c.warnings) console.log(`  Needs manual review: ${warning}`);
  }
  for (const warning of result.warnings) console.log(`! ${warning}`);
  if (options.dryRun) return;
  if (options.select !== undefined && options.readOnly)
    throw new Error('Choose either --select or --read-only.');
  const supported = result.candidates.filter((c) => c.supported);
  let names: string[];
  if (options.select !== undefined) {
    names = options.select
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const name of names)
      if (!supported.some((c) => c.name === name))
        throw new Error(`Unknown or unsupported capability: ${name}`);
  } else if (options.readOnly)
    names = supported.filter((c) => c.risk === 'read').map((c) => c.name);
  else {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error(
        'Interactive review requires a terminal. Use --dry-run / --json to inspect, then --select name1,name2 or --read-only to approve a scope.',
      );
    if (!supported.length)
      throw new Error('No supported capabilities found. Review the warnings above.');
    const selection = await prompts.multiselect({
      message: 'Select capabilities to expose through MCP',
      required: false,
      initialValues: supported.filter((c) => c.risk === 'read').map((c) => c.name),
      options: supported.map((c) => ({
        value: c.name,
        label: `${c.displayName} [${c.risk.toUpperCase()}]`,
        hint: `${c.description} Confidence ${Math.round(c.confidence * 100)}%${c.permissions.length ? ' · ' + c.permissions.join(', ') : ''}`,
      })),
    });
    if (prompts.isCancel(selection)) {
      console.log('Cancelled; nothing generated.');
      return;
    }
    names = selection;
  }
  const generated = await generate(
    result,
    supported.filter((c) => names.includes(c.name)),
  );
  const scriptAvailable =
    options.script !== false && (await addPackageScript(result.application.root));
  if (options.script !== false && !scriptAvailable)
    console.log('Existing hive:mcp script preserved. Use hive dev to run this generated server.');
  console.log(
    `\n✓ Generated .hive/manifest.json, capabilities.json, analysis.json\n✓ Generated MCP server, schemas, API adapter, environment template, tests, README\n${generated.tools} selected tools · ${generated.directory}`,
  );
  if (options.install)
    await run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      generated.directory,
    );
  console.log(
    `\n${options.install ? '' : 'Install: npm --prefix .hive/mcp install\n'}Start your application, set .hive/mcp/.env, then run:\n  hive dev${scriptAvailable ? '\n  npm run hive:mcp' : ''}\nEndpoint: http://127.0.0.1:3333/mcp`,
  );
}
type SyncOptions = { cwd: string; check?: boolean; acceptChanged?: boolean; install?: boolean };
async function syncCommand(options: SyncOptions) {
  const root = path.resolve(options.cwd);
  const served = await readServed(root);
  const result = await scan(root);
  const plan = planSync(served.tools, await readPrevious(root), result.candidates);
  const outdated = served.version !== VERSION;
  console.log(`Hive v${VERSION} sync · ${result.application.name}\n`);
  console.log(`✓ ${plan.keep.length} approved tools unchanged`);
  for (const c of plan.changed)
    console.log(
      `~ ${c.before.name} changed (${c.fields.join(', ')}) — ${c.after.source.method} ${c.after.source.route}`,
    );
  for (const t of plan.removed)
    console.log(`- ${t.name} is gone from the app — ${t.source.method} ${t.source.route}`);
  for (const c of plan.added)
    console.log(
      `+ ${c.name} [${c.risk.toUpperCase()}] is new, not approved — ${c.source.method} ${c.source.route}`,
    );
  if (outdated) console.log(`! Server was generated by Hive v${served.version}`);
  const drift = plan.changed.length + plan.removed.length + plan.added.length > 0 || outdated;
  if (options.check) {
    if (!drift) console.log('\nUp to date.');
    else {
      console.log('\nOut of date. Run hive sync to review and regenerate.');
      process.exitCode = 1;
    }
    return;
  }
  if (!drift) {
    console.log('\nUp to date; nothing to regenerate.');
    return;
  }
  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  let accepted = plan.changed.map((c) => c.after);
  if (plan.changed.length && !options.acceptChanged) {
    if (!interactive)
      throw new Error(
        `${plan.changed.length} approved tool(s) changed. Review with hive sync in a terminal, or pass --accept-changed. Nothing was written.`,
      );
    const choice = await prompts.multiselect({
      message: 'Re-approve changed tools (unselected tools are removed from the server)',
      required: false,
      initialValues: [] as string[],
      options: plan.changed.map((c) => ({
        value: c.after.name,
        label: `${c.after.name} [${c.after.risk.toUpperCase()}]`,
        hint: `changed: ${c.fields.join(', ')}`,
      })),
    });
    if (prompts.isCancel(choice)) {
      console.log('Cancelled; nothing written.');
      return;
    }
    accepted = accepted.filter((c) => choice.includes(c.name));
  }
  let approvedNew: string[] = [];
  if (plan.added.length && interactive) {
    const choice = await prompts.multiselect({
      message: 'Approve new tools (none are approved unless you select them)',
      required: false,
      initialValues: [] as string[],
      options: plan.added.map((c) => ({
        value: c.name,
        label: `${c.displayName} [${c.risk.toUpperCase()}]`,
        hint: `${c.source.method} ${c.source.route}`,
      })),
    });
    if (prompts.isCancel(choice)) {
      console.log('Cancelled; nothing written.');
      return;
    }
    approvedNew = choice;
  }
  const chosen = new Set([...plan.keep, ...accepted]);
  const selected = result.candidates.filter(
    (c) => chosen.has(c) || (plan.added.includes(c) && approvedNew.includes(c.name)),
  );
  const generated = await generate(result, selected);
  console.log(`\n✓ Regenerated ${generated.tools} tools · ${generated.directory}`);
  if (options.install)
    await run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund'],
      generated.directory,
    );
  else if (outdated) console.log('Template updated: run npm --prefix .hive/mcp install');
}
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error('Hive requires Node.js 22.12 or later.');
  process.exit(1);
}
const program = new Command()
  .name('hive')
  .version(VERSION)
  .description('Discover application capabilities and generate a local MCP server');
for (const name of ['scan', 'generate'])
  program
    .command(name)
    .description(
      name === 'scan'
        ? 'Analyze, review and generate MCP tools'
        : 'Re-scan and generate a reviewed tool selection',
    )
    .option('-C, --cwd <directory>', 'Application root', process.cwd())
    .option('--dry-run', 'Show discovery without writing files')
    .option('--json', 'Print analysis JSON without writing files')
    .option(
      '--select <names>',
      'Explicitly approve comma-separated capability names (including writes/deletes)',
    )
    .option('--read-only', 'Approve supported read capabilities only')
    .option('--install', 'Install generated server dependencies')
    .option('--no-script', 'Do not add a package.json script')
    .action(scanCommand);
program
  .command('sync')
  .description('Re-scan the app and bring the generated MCP server up to date')
  .option('-C, --cwd <directory>', 'Application root', process.cwd())
  .option('--check', 'Report drift and exit 1 if out of date; writes nothing')
  .option('--accept-changed', 'Re-approve approved tools whose definition changed')
  .option('--install', 'Install generated server dependencies')
  .action(syncCommand);
const tools = program
  .command('tools')
  .description('List generated tools and their permissions (.hive/policy.json)')
  .option('-C, --cwd <directory>', 'Application root', process.cwd())
  .action((options) => listTools(options.cwd));
const toolsCwd = (options: { cwd?: string }) => options.cwd ?? tools.opts().cwd;
tools
  .command('enable <name>')
  .description('Allow a generated tool')
  .option('-C, --cwd <directory>', 'Application root')
  .action((name, options) => setTool(toolsCwd(options), name, true));
tools
  .command('disable <name>')
  .description('Hide and refuse a generated tool')
  .option('-C, --cwd <directory>', 'Application root')
  .action((name, options) => setTool(toolsCwd(options), name, false));
tools
  .command('mode <mode>')
  .description('Set server mode: all, read-only (reads only) or off (no tools)')
  .option('-C, --cwd <directory>', 'Application root')
  .action((mode, options) => setMode(toolsCwd(options), mode));
program
  .command('logs')
  .description('Show recorded agent tool calls (.hive/logs/actions.jsonl)')
  .option('-C, --cwd <directory>', 'Application root', process.cwd())
  .option('--tool <name>', 'Only this tool')
  .option('--errors', 'Only calls that did not succeed')
  .option('--since <time>', 'Only calls since 30m, 2h, 7d or an ISO date')
  .option('--limit <n>', 'Show the latest n calls', '50')
  .option('--json', 'Print raw JSON lines')
  .option('-f, --follow', 'Keep printing new calls')
  .action(showLogs);
program
  .command('dev')
  .description('Launch the generated local MCP server')
  .option('-C, --cwd <directory>', 'Application root', process.cwd())
  .option('--stdio', 'Use stdio transport')
  .action(async (options) => {
    const dir = path.resolve(options.cwd, '.hive/mcp');
    if (!(await exists(path.join(dir, 'src/server.ts'))))
      throw new Error('No generated server. Run hive scan first.');
    if (!(await exists(path.join(dir, 'node_modules/tsx/dist/cli.mjs'))))
      throw new Error('Generated dependencies missing. Run npm --prefix .hive/mcp install first.');
    await run(
      process.execPath,
      [
        path.join(dir, 'node_modules/tsx/dist/cli.mjs'),
        '--env-file-if-exists=.env',
        'src/server.ts',
        ...(options.stdio ? ['--stdio'] : []),
      ],
      dir,
    );
  });
program
  .command('inspect')
  .description('Show the generated manifest and candidate inventory')
  .option('-C, --cwd <directory>', 'Application root', process.cwd())
  .action(async (options) => {
    console.log(await readFile(path.resolve(options.cwd, '.hive/manifest.json'), 'utf8'));
    console.log(JSON.stringify(await readPrevious(path.resolve(options.cwd)), null, 2));
  });
program
  .command('doctor')
  .description('Check local project and generated runtime configuration')
  .option('-C, --cwd <directory>', 'Application root', process.cwd())
  .option('--network', 'Also check that the application and the MCP server answer')
  .action(async (options) => {
    const info = await detectProject(options.cwd);
    console.log(
      `✓ Node ${process.version}\n✓ ${info.name}: ${info.framework}, ${info.language}, ${info.packageManager}`,
    );
    const dir = path.join(info.root, '.hive/mcp');
    for (const file of [
      'package.json',
      'src/server.ts',
      'src/tools.json',
      'node_modules/@modelcontextprotocol/sdk/package.json',
    ]) {
      if (!(await exists(path.join(dir, file))))
        throw new Error(`Missing .hive/mcp/${file}. Run hive scan --install.`);
    }
    const manifest = JSON.parse(
      await readFile(path.join(info.root, '.hive/manifest.json'), 'utf8'),
    );
    const tools = JSON.parse(await readFile(path.join(dir, 'src/tools.json'), 'utf8'));
    if (
      !Array.isArray(manifest.capabilities) ||
      JSON.stringify(manifest.capabilities) !== JSON.stringify(tools.map((t: any) => t.name))
    )
      throw new Error('Manifest/tool inventory mismatch. Regenerate.');
    let fileEnv: Record<string, string | undefined> = {};
    try {
      fileEnv = parseEnv(await readFile(path.join(dir, '.env'), 'utf8'));
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    const env = (name: string) => process.env[name] ?? fileEnv[name];
    const base = env('HIVE_APP_BASE_URL') ?? 'http://localhost:3000';
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Invalid HIVE_APP_BASE_URL');
    const port = Number(env('HIVE_MCP_PORT') ?? 3333);
    const endpoint = `http://127.0.0.1:${port}/mcp`;
    console.log(
      `✓ Generated runtime and ${tools.length} selected tools\nApplication origin: ${url.origin}\nRuntime loads .hive/mcp/.env. Start the application separately.\nLocal MCP: ${endpoint}`,
    );
    let problems = 0;
    try {
      const policy = await readPolicy(info.root);
      const off = tools.filter((t: any) => !allowed(policy, t)).length;
      console.log(
        `✓ Policy: mode ${policy.mode}, ${tools.length - off} of ${tools.length} tools enabled`,
      );
    } catch (error: any) {
      problems++;
      console.log(`✗ ${error.message}`);
    }
    const token = env('HIVE_MCP_TOKEN') ?? '';
    if (env('HIVE_ALLOWED_HOSTS')) {
      if (token.length < 24) {
        problems++;
        console.log(
          '✗ HIVE_ALLOWED_HOSTS is set but HIVE_MCP_TOKEN is missing or under 24 characters; the server will refuse to start.',
        );
      } else console.log(`✓ Remote hosts allowed with token: ${env('HIVE_ALLOWED_HOSTS')}`);
    }
    if (options.network) {
      try {
        const app = await fetch(url.origin, {
          redirect: 'manual',
          signal: AbortSignal.timeout(3000),
        });
        console.log(`✓ Application answered at ${url.origin} (HTTP ${app.status})`);
      } catch {
        problems++;
        console.log(`✗ Application not reachable at ${url.origin}. Start it first.`);
      }
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          signal: AbortSignal.timeout(3000),
          headers: {
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-06-18',
              capabilities: {},
              clientInfo: { name: 'hive-doctor', version: VERSION },
            },
          }),
        });
        if (response.ok) console.log(`✓ MCP server answered at ${endpoint}`);
        else {
          problems++;
          console.log(
            `✗ MCP server at ${endpoint} returned HTTP ${response.status}${response.status === 401 ? ' (check HIVE_MCP_TOKEN)' : ''}`,
          );
        }
      } catch {
        problems++;
        console.log(`✗ MCP server not reachable at ${endpoint}. Run hive dev.`);
      }
    }
    if (problems) process.exitCode = 1;
  });
program.parseAsync().catch((error) => {
  console.error(`Hive: ${error.message}`);
  process.exitCode = 1;
});
