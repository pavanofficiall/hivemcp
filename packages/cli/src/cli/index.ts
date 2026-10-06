#!/usr/bin/env node
import { Command } from 'commander';
import * as prompts from '@clack/prompts';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { scan } from '../scanner/scan.js';
import { exists, detectProject } from '../scanner/project.js';
import { generate, readPrevious, addPackageScript } from '../generator/project.js';
import { diffCapabilities } from '../capabilities/build.js';
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
    `Hive v0.0.2\n\n✓ ${result.application.name}: Next.js + TypeScript + App Router\n✓ ${result.files} source files indexed\n✓ ${result.endpoints.length} API operations, ${result.schemas.length} schemas, ${result.services.length} service functions, ${result.models.length} Prisma models/enums\nZod: ${result.application.zod ? 'detected' : 'not declared'} · Prisma: ${result.application.prisma ? 'detected' : 'not detected'}`,
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
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error('Hive requires Node.js 22.12 or later.');
  process.exit(1);
}
const program = new Command()
  .name('hive')
  .version('0.0.2')
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
    let configuredBase: string | undefined;
    try {
      configuredBase = parseEnv(await readFile(path.join(dir, '.env'), 'utf8'))
        .HIVE_APP_BASE_URL;
    } catch (error: any) {
      if (error.code !== 'ENOENT') throw error;
    }
    const base = process.env.HIVE_APP_BASE_URL ?? configuredBase ?? 'http://localhost:3000';
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Invalid HIVE_APP_BASE_URL');
    console.log(
      `✓ Generated runtime and ${tools.length} selected tools\nApplication origin: ${url.origin}\nRuntime loads .hive/mcp/.env. Start the application separately.\nLocal MCP default: http://127.0.0.1:3333/mcp`,
    );
  });
program.parseAsync().catch((error) => {
  console.error(`Hive: ${error.message}`);
  process.exitCode = 1;
});
