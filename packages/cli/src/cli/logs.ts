import { readFile, stat } from 'node:fs/promises';
import { watchFile, unwatchFile } from 'node:fs';
import path from 'node:path';
export type LogOptions = {
  cwd: string;
  tool?: string;
  errors?: boolean;
  since?: string;
  limit?: string;
  json?: boolean;
  follow?: boolean;
};
type Entry = {
  time: string;
  tool: string;
  risk: string;
  outcome: string;
  status?: number;
  durationMs: number;
  userAgent?: string;
  transport?: string;
};
export function sinceTime(value: string, now = Date.now()) {
  const relative = /^(\d+)([smhd])$/.exec(value);
  if (relative)
    return now - Number(relative[1]) * { s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[relative[2] as 's'];
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw new Error('--since takes 30m, 2h, 7d or an ISO date');
  return time;
}
function parse(lines: string[]) {
  return lines.flatMap((line) => {
    try {
      return line.trim() ? [JSON.parse(line) as Entry] : [];
    } catch {
      return [];
    }
  });
}
function format(e: Entry) {
  const when = e.time.replace('T', ' ').slice(0, 19);
  const agent = e.userAgent
    ? ` · ${e.userAgent.slice(0, 40)}`
    : e.transport === 'stdio'
      ? ' · stdio'
      : '';
  return `${when}  ${e.outcome.padEnd(9)} ${e.tool} [${e.risk.toUpperCase()}]  ${e.status ?? '-'}  ${e.durationMs}ms${agent}`;
}
export async function showLogs(options: LogOptions) {
  const file = path.resolve(options.cwd, '.hive/logs/actions.jsonl');
  const since = options.since ? sinceTime(options.since) : undefined;
  const limit = Number(options.limit ?? 50);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
  const keep = (e: Entry) =>
    (!options.tool || e.tool === options.tool) &&
    (!options.errors || e.outcome !== 'ok') &&
    (since === undefined || Date.parse(e.time) >= since);
  const print = (e: Entry) => console.log(options.json ? JSON.stringify(e) : format(e));
  let text = '';
  try {
    text = await readFile(file, 'utf8');
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }
  const entries = parse(text.split('\n')).filter(keep);
  if (!entries.length && !options.follow && !options.json)
    console.log('No agent actions recorded yet. Calls appear here once an agent uses a tool.');
  entries.slice(-limit).forEach(print);
  if (!options.follow) return;
  let offset = Buffer.byteLength(text);
  console.error('Following .hive/logs/actions.jsonl (Ctrl+C to stop)…');
  await new Promise<void>((resolve) => {
    watchFile(file, { interval: 500 }, async () => {
      try {
        const size = (await stat(file)).size;
        if (size < offset) offset = 0; // rotated
        const fresh = (await readFile(file)).subarray(offset).toString('utf8');
        offset = size;
        parse(fresh.split('\n')).filter(keep).forEach(print);
      } catch {}
    });
    process.once('SIGINT', () => {
      unwatchFile(file);
      resolve();
    });
  });
}
