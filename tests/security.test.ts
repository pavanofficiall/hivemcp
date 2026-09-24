import { beforeAll, describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  passwordHash,
  verifyPassword,
  canonical,
} from '@/modules/security/crypto';
import { sanitize, redactSource, summary } from '@/modules/security/redact';
import { assertExecutable, executionRequest, validateInput } from '@/modules/execution/service';
import { validateBaseUrl } from '@/modules/security/http';
import { redirectUri } from '@/modules/oauth/agent';
import { normalizeGitHubAppSlug } from '@/lib/config';
beforeAll(() => {
  process.env.ENCRYPTION_KEY = '01'.repeat(32);
});
describe('credential security', () => {
  it('encrypts with identity binding and detects tampering', () => {
    const value = encrypt('test-token', 'user-a:env-1');
    expect(value).not.toContain('test-token');
    expect(decrypt(value, 'user-a:env-1')).toBe('test-token');
    expect(() => decrypt(value, 'user-b:env-1')).toThrow();
    expect(() => decrypt(value.slice(0, -4) + 'AAAA', 'user-a:env-1')).toThrow();
  });
  it('hashes and verifies passwords with salts', () => {
    const value = passwordHash('this is a test password');
    expect(verifyPassword('this is a test password', value)).toBe(true);
    expect(verifyPassword('wrong password', value)).toBe(false);
    expect(passwordHash('this is a test password')).not.toBe(value);
  });
  it('removes credential values and stores only audit field names', () => {
    expect(sanitize({ access_token: 'secret', data: { password: 'bad', title: 'valid' } })).toEqual(
      { access_token: '[REDACTED]', data: { password: '[REDACTED]', title: 'valid' } },
    );
    expect(redactSource(`const apiKey='private-secret';`)).not.toContain('private-secret');
    expect(JSON.stringify(summary({ title: 'private-value', password: 'secret' }))).not.toContain(
      'private-value',
    );
  });
  it('canonicalizes nested inputs for approval binding', () =>
    expect(canonical({ b: { x: 2, a: 1 }, a: 1 })).toBe(canonical({ a: 1, b: { a: 1, x: 2 } })));
});
describe('provider configuration', () => {
  it('accepts a GitHub App slug or its public GitHub URL', () => {
    expect(normalizeGitHubAppSlug('hive-mcp')).toBe('hive-mcp');
    expect(normalizeGitHubAppSlug('https://github.com/apps/hive-mcp')).toBe('hive-mcp');
  });
  it.each([
    'https://example.com/apps/hive-mcp',
    'https://github.com/apps/hive-mcp/installations/new',
    'hive/mcp',
  ])('rejects an invalid GitHub App slug: %s', (value) =>
    expect(() => normalizeGitHubAppSlug(value)).toThrow('CONFIGURATION_REQUIRED:GITHUB_APP_SLUG'),
  );
});
describe('execution boundary', () => {
  it.each(['CANDIDATE', 'REJECTED', 'NEEDS_REVIEW', 'STALE'])('rejects status %s', (status) =>
    expect(() => assertExecutable({ status, enabled: true, policy: 'automatic' })).toThrow(
      'CAPABILITY_NOT_APPROVED',
    ),
  );
  it.each([
    { enabled: false, policy: 'automatic' },
    { enabled: true, policy: 'disabled' },
  ])('rejects disabled capabilities %j', (value) =>
    expect(() => assertExecutable({ status: 'APPROVED', ...value })).toThrow('CAPABILITY_DISABLED'),
  );
  it('rejects unexpected input instead of coercing or stripping it', () => {
    const schema = {
      type: 'object',
      properties: { title: { type: 'string', minLength: 3 } },
      required: ['title'],
      additionalProperties: false,
    };
    expect(() => validateInput(schema, { title: 'valid', endpoint: 'http://evil' })).toThrow(
      'VALIDATION_ERROR',
    );
    expect(() => validateInput(schema, { title: 42 })).toThrow();
    expect(() => validateInput(schema, { title: 'valid' })).not.toThrow();
  });
  const mapping = { httpMethod: 'POST', route: '/api/tickets/{id}', supported: true };
  it('constructs only the discovered route with encoded query data', () => {
    const request = executionRequest('http://localhost:3001', mapping, {
      path: { id: 'ticket-1' },
      query: { search: 'hello & goodbye' },
      body: { title: 'test' },
    });
    expect(request.url.toString()).toBe(
      'http://localhost:3001/api/tickets/ticket-1?search=hello+%26+goodbye',
    );
    expect(request.body).toBe('{"title":"test"}');
  });
  it.each(['..', '.', '../admin', '%2e%2e', 'x?admin=true', 'x/y', 'x\\y'])(
    'blocks path escape %s',
    (id) =>
      expect(() => executionRequest('http://localhost:3001', mapping, { path: { id } })).toThrow(),
  );
  it.each([
    'http://169.254.169.254',
    'file:///etc/passwd',
    'http://example.com',
    'https://user:pass@example.com',
    'https://example.com/subpath',
  ])('blocks unsafe base URL %s', (url) => expect(() => validateBaseUrl(url)).toThrow());
  it('requires valid exact callback origins', () => {
    expect(redirectUri.safeParse('javascript:alert(1)').success).toBe(false);
    expect(redirectUri.safeParse('http://example.com/callback').success).toBe(false);
    expect(redirectUri.safeParse('http://localhost:8080/callback').success).toBe(true);
  });
});
