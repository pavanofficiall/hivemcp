import { chromium } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { db } from '../lib/db';
import { appUrl, configured, githubKeys } from '../lib/config';
const email = `ui-${randomUUID()}@example.invalid`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors: string[] = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  await mkdir('.hive/screenshots', { recursive: true });
  await page.goto(appUrl());
  await page.getByRole('heading', { name: 'Create your workspace' }).waitFor();
  await page.screenshot({ path: '.hive/screenshots/sign-in.png', fullPage: true });
  await page.getByLabel('Name', { exact: true }).fill('UI Test');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(randomUUID());
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('heading', { name: 'Your software, ready for agents.' }).waitFor();
  await page.screenshot({ path: '.hive/screenshots/overview.png', fullPage: true });
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('heading', { name: 'Workspace settings' }).waitFor();
  const githubConfigured = configured(githubKeys);
  await page
    .getByText(githubConfigured ? 'Configured' : 'Setup required', { exact: true })
    .first()
    .waitFor();
  await page.screenshot({ path: '.hive/screenshots/settings.png', fullPage: true });
  await page
    .getByRole('link', { name: /^Applications/ })
    .first()
    .click();
  await page.getByRole('heading', { name: 'No repositories connected' }).waitFor();
  const connectGitHub = page.getByRole('button', { name: 'Connect GitHub', exact: true });
  await connectGitHub.waitFor();
  if (!githubConfigured) {
    await connectGitHub.click();
    const notice = page.locator('.notice[role="alert"]');
    await notice.waitFor();
    const providerMessage = await notice.innerText();
    if (!providerMessage.toLowerCase().includes('github configuration required'))
      throw new Error(`Missing provider setup state: ${providerMessage}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(appUrl());
  await page.getByRole('heading', { name: 'Your software, ready for agents.' }).waitFor();
  await page.screenshot({ path: '.hive/screenshots/mobile.png', fullPage: true });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  if (overflow) throw new Error('Mobile viewport overflows horizontally');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(
    'PASS Browser registration, dashboard, settings, GitHub connection state, mobile layout; no page errors.',
  );
} finally {
  await browser.close();
  await db.user.deleteMany({ where: { email } });
  await db.$disconnect();
}
