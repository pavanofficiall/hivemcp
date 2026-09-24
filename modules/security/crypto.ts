import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { required } from '@/lib/config';
export const randomToken = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const sessionHash = (value: string) =>
  createHmac('sha256', required('AUTH_SECRET')).update(value).digest('hex');
export function equal(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
function key() {
  const value = required('ENCRYPTION_KEY');
  if (!/^[a-f\d]{64}$/i.test(value)) throw new Error('CONFIGURATION_REQUIRED:ENCRYPTION_KEY');
  return Buffer.from(value, 'hex');
}
export function encrypt(value: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(context));
  return [
    'v1',
    iv.toString('base64url'),
    Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]).toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
  ].join('.');
}
export function decrypt(value: string, context: string) {
  const [version, iv, body, tag] = value.split('.');
  if (version !== 'v1') throw new Error('Invalid encrypted token');
  const cipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  cipher.setAAD(Buffer.from(context));
  cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([cipher.update(Buffer.from(body, 'base64url')), cipher.final()]).toString(
    'utf8',
  );
}
export function passwordHash(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
export function verifyPassword(password: string, stored: string) {
  const [salt, value] = stored.split(':');
  return equal(scryptSync(password, salt, 64).toString('hex'), value);
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
