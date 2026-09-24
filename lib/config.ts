export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`CONFIGURATION_REQUIRED:${name}`);
  return value;
}
export const appUrl = () => required('APP_URL').replace(/\/$/, '');
export const configured = (names: string[]) => names.every((name) => Boolean(process.env[name]));
export function normalizeGitHubAppSlug(value: string): string {
  const trimmed = value.trim();
  let slug = trimmed;

  if (trimmed.includes('://')) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error('CONFIGURATION_REQUIRED:GITHUB_APP_SLUG');
    }
    const match = url.pathname.match(/^\/apps\/([^/]+)\/?$/);
    if (url.origin !== 'https://github.com' || url.search || url.hash || !match) {
      throw new Error('CONFIGURATION_REQUIRED:GITHUB_APP_SLUG');
    }
    slug = match[1];
  }

  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(slug)) {
    throw new Error('CONFIGURATION_REQUIRED:GITHUB_APP_SLUG');
  }
  return slug;
}
export const githubAppSlug = () => normalizeGitHubAppSlug(required('GITHUB_APP_SLUG'));
export const githubKeys = [
  'GITHUB_APP_ID',
  'GITHUB_APP_SLUG',
  'GITHUB_CLIENT_ID',
  'GITHUB_CLIENT_SECRET',
  'GITHUB_APP_PRIVATE_KEY',
];
