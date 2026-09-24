import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
if (existsSync('.env')) {
  console.log('Existing .env preserved.');
  process.exit(0);
}
const password = randomBytes(24).toString('hex');
mkdirSync('.hive', { recursive: true });
writeFileSync(
  '.env',
  `DATABASE_URL=postgresql://hive:${password}@127.0.0.1:54329/hive\nPOSTGRES_PASSWORD=${password}\nREDIS_URL=redis://127.0.0.1:63799\nAPP_URL=http://localhost:3000\nAUTH_SECRET=${randomBytes(32).toString('hex')}\nENCRYPTION_KEY=${randomBytes(32).toString('hex')}\nGITHUB_WEBHOOK_SECRET=${randomBytes(32).toString('hex')}\nGITHUB_APP_ID=\nGITHUB_APP_SLUG=\nGITHUB_CLIENT_ID=\nGITHUB_CLIENT_SECRET=\nGITHUB_APP_PRIVATE_KEY=\nGEMINI_API_KEY=\nGEMINI_ANALYSIS_MODEL=gemini-3.5-flash-lite\n`,
  { mode: 0o600 },
);
console.log('Created .env with local secrets. No external credentials generated.');
