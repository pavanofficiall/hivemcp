import type { NextConfig } from 'next';
const config: NextConfig = {
  // OAuth callback query strings contain one-use codes. Do not log requests.
  logging: false,
  serverExternalPackages: ['ts-morph', 'bullmq', '@prisma/client'],
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'",
          },
        ],
      },
    ];
  },
};
export default config;
