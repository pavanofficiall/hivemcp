const secretKey = /password|secret|token|authorization|cookie|api[_-]?key|private[_-]?key/i;
export function redactSource(source: string): string {
  return source
    .replace(
      /-----BEGIN [\s\S]*?PRIVATE KEY-----[\s\S]*?-----END [\s\S]*?PRIVATE KEY-----/g,
      '[REDACTED KEY]',
    )
    .replace(
      /((?:password|secret|token|apiKey|api_key|privateKey)\s*[:=]\s*)(["'`])[^"'`\n]*\2/gi,
      '$1"[REDACTED]"',
    )
    .replace(
      /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+|AIza[A-Za-z0-9_-]{25,}|sk[-_][A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g,
      '[REDACTED]',
    )
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(
      /(["'`])(?=[A-Za-z0-9+/=_-]{32,}\1)(?=[A-Za-z0-9+/=_-]*[A-Z])(?=[A-Za-z0-9+/=_-]*[a-z])(?=[A-Za-z0-9+/=_-]*\d)[A-Za-z0-9+/=_-]{32,}\1/g,
      '"[REDACTED HIGH-ENTROPY LITERAL]"',
    );
}
export function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[DEPTH LIMIT]';
  if (typeof value === 'string') return redactSource(value).slice(0, 12000);
  if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item, depth + 1));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 200)
        .map(([k, v]) => [k, secretKey.test(k) ? '[REDACTED]' : sanitize(v, depth + 1)]),
    );
  return value;
}
// Audit logs retain shape and counts, never raw customer field values.
export function summary(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { type: 'array', count: value.length };
  if (value && typeof value === 'object')
    return {
      type: 'object',
      fields: Object.keys(value)
        .filter((k) => !secretKey.test(k))
        .slice(0, 50),
    };
  return { type: typeof value };
}
