import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { HiveError } from '@/lib/errors';
export function validateBaseUrl(value: string) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !['http:', 'https:'].includes(url.protocol) ||
    (url.protocol === 'http:' && !local)
  )
    throw new HiveError('INVALID_ENVIRONMENT_URL');
  if (url.pathname !== '/' && url.pathname !== '') throw new HiveError('BASE_URL_MUST_BE_ORIGIN');
  return url.origin;
}
function publicAddress(ip: string) {
  if (isIP(ip) === 6) return !/^(::|fc|fd|fe8|fe9|fea|feb|ff)/i.test(ip) && !ip.includes('.');
  const [a, b] = ip.split('.').map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224 ||
    (a === 198 && [18, 19].includes(b))
  );
}
export async function safeHttp(
  url: URL,
  options: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    maxBytes?: number;
  } = {},
) {
  validateBaseUrl(url.origin);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const local = ['localhost', '127.0.0.1', '::1'].includes(hostname);
  const addresses = await lookup(hostname, { all: true });
  if (
    !addresses.length ||
    addresses.some((a) =>
      local ? !['127.0.0.1', '::1'].includes(a.address) : !publicAddress(a.address),
    )
  )
    throw new HiveError('UNSAFE_TARGET_ADDRESS');
  const address = addresses[0];
  return new Promise<{ status: number; data: unknown }>((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(
      url,
      {
        method: options.method ?? 'GET',
        headers: options.headers,
        // Pin the validated DNS result for this connection; never follow redirects.
        lookup: ((_hostname: string, lookupOptions: { all?: boolean }, callback: Function) =>
          lookupOptions.all
            ? callback(null, [address])
            : callback(null, address.address, address.family)) as never,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > (options.maxBytes ?? 1_000_000)) {
            request.destroy();
            reject(new HiveError('APPLICATION_RESPONSE_TOO_LARGE', 502));
          } else chunks.push(chunk);
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data: unknown;
          try {
            data = text ? JSON.parse(text) : {};
          } catch {
            data = { message: 'Application returned a non-JSON response' };
          }
          resolve({ status: response.statusCode ?? 502, data });
        });
        response.on('error', () => reject(new HiveError('APPLICATION_CONNECTION_FAILED', 502)));
      },
    );
    const timer = setTimeout(() => request.destroy(new Error('timeout')), 20000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', () => reject(new HiveError('APPLICATION_CONNECTION_FAILED', 502)));
    if (options.body) request.write(options.body);
    request.end();
  });
}
