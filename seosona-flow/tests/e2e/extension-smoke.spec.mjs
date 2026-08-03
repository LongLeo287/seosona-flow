// P2.T6 — extension smoke E2E: clean profile, unpacked load, sidebar render,
// local-first (no backend), traces on failure.
import { test, expect } from '@playwright/test';
import { launchExtension } from '../../scripts/test/launch-extension.mjs';

const BACKEND_HINTS = ['localhost:8080', '/api/v1', 'mercure', 'api.seosona'];

let ext;

test.beforeAll(async () => {
  ext = await launchExtension();
});

test.afterAll(async () => {
  await ext?.close();
});

test('clean profile loads the unpacked extension with a service worker', async () => {
  expect(ext.extensionId).toMatch(/^[a-p]{32}$/);
  expect(ext.serviceWorker.url()).toContain('background.js');
});

test('sidebar renders under the chrome-extension origin', async () => {
  const page = await ext.context.newPage();
  const backendCalls = [];
  page.on('request', (r) => {
    const u = r.url();
    if (BACKEND_HINTS.some((h) => u.includes(h))) backendCalls.push(u);
  });

  const resp = await page.goto(ext.extensionUrl('pages/sidebar.html'), { waitUntil: 'domcontentloaded' });
  expect(resp?.status()).toBe(200);
  await expect(page).toHaveTitle(/SEOSONA Flow/);
  await expect(page.locator('#flow-auto-sidebar-root')).toHaveCount(1);

  // Local-first: opening the sidebar must not auto-call the backend.
  await page.waitForTimeout(1500);
  expect(backendCalls, `unexpected backend calls: ${backendCalls.join(', ')}`).toEqual([]);
  await page.close();
});

test('a second extension page (settings) also bootstraps', async () => {
  const page = await ext.context.newPage();
  const resp = await page.goto(ext.extensionUrl('pages/settings.html'), { waitUntil: 'domcontentloaded' });
  expect(resp?.status()).toBe(200);
  await expect(page.locator('body')).toBeVisible();
  await page.close();
});
