// P7.T2 — local-mode zero-backend proof (SEC-003).
// Boots the extension behind a deny proxy and proves that install, startup,
// sidebar, and a settings page produce ZERO backend network attempts. Provider
// traffic is user-directed and therefore not triggered by merely opening pages.
import { test, expect } from '@playwright/test';
import { launchExtension } from '../../scripts/test/launch-extension.mjs';
import { installDenyProxy } from '../../scripts/test/network-deny-proxy.mjs';

let ext;
let rec;

test.beforeAll(async () => {
  ext = await launchExtension();
  rec = await installDenyProxy(ext.context); // block everything off-extension
});

test.afterAll(async () => {
  await ext?.close();
});

test('startup + sidebar produce zero backend attempts', async () => {
  const page = await ext.context.newPage();
  // Note: with context routing active, goto() may return a null response object
  // for chrome-extension:// navigations even though the page loads — assert on
  // the rendered DOM instead.
  await page.goto(ext.extensionUrl('pages/sidebar.html'), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#flow-auto-sidebar-root')).toHaveCount(1);
  await page.waitForTimeout(1500); // give any deferred startup work time to fire
  await page.close();

  expect(rec.backend, `backend attempts in local mode: ${rec.backend.join(', ')}`).toEqual([]);
});

test('settings page bootstraps with zero backend attempts', async () => {
  const page = await ext.context.newPage();
  await page.goto(ext.extensionUrl('pages/settings.html'), { waitUntil: 'domcontentloaded' });
  await expect(page.locator('body')).toBeVisible();
  await page.waitForTimeout(1000);
  await page.close();

  expect(rec.backend, `backend attempts: ${rec.backend.join(', ')}`).toEqual([]);
});

test('no unclassified off-extension traffic occurred at boot', async () => {
  // The strongest local-first claim: nothing external at all, not even "other".
  expect(rec.other, `unexpected external traffic: ${rec.other.join(', ')}`).toEqual([]);
});
