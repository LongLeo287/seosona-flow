// SEOSONA local-first (2026-07): the debrand fork has NO backend, so all
// login / premium / upgrade ("Nâng cấp") / paid / quota ("Lượt chạy") / plan-badge
// UI must be hidden. RuntimeMode forces `hide-upgrade-ui` + `seosona-hide-monetization`
// on the body in local mode; CSS hides the elements. Node COUNT stays (useful).
import { test, expect } from '@playwright/test';
import { launchExtension } from '../../scripts/test/launch-extension.mjs';

let ext;
test.beforeAll(async () => { ext = await launchExtension(); });
test.afterAll(async () => { await ext?.close(); });

const hidden = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? getComputedStyle(el).display === 'none' : true; // absent counts as hidden
}, sel);

test('workflow editor hides quota/upgrade/plan-badge, keeps node count', async () => {
  const p = await ext.context.newPage();
  await p.goto(ext.extensionUrl('pages/workflow-editor.html'), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);

  expect(await p.evaluate(() => document.body.classList.contains('seosona-hide-monetization'))).toBe(true);
  expect(await p.evaluate(() => document.body.classList.contains('hide-upgrade-ui'))).toBe(true);

  expect(await hidden(p, '#wfQuotaRuns'), 'Lượt chạy (runs quota) hidden').toBe(true);
  expect(await hidden(p, '#wfUpgradeBtn'), 'Nâng cấp button hidden').toBe(true);
  expect(await hidden(p, '#canvasPlanBadge'), 'canvas plan badge hidden').toBe(true);

  // node count is NOT monetization — it must stay visible
  const nodesVisible = await p.evaluate(() => {
    const el = document.querySelector('#wfQuotaNodes');
    return el ? getComputedStyle(el).display !== 'none' : false;
  });
  expect(nodesVisible, 'node count kept').toBe(true);
  await p.close();
});

test('sidebar hides plan badge, login/logout, upgrade', async () => {
  const p = await ext.context.newPage();
  await p.goto(ext.extensionUrl('pages/sidebar.html'), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2500);
  expect(await p.evaluate(() => document.body.classList.contains('seosona-hide-monetization'))).toBe(true);
  expect(await hidden(p, '#userPlanBadge'), 'plan badge hidden').toBe(true);
  expect(await hidden(p, '#logoutBtn'), 'logout hidden').toBe(true);
  expect(await hidden(p, '#upgradeBtn'), 'upgrade hidden').toBe(true);
  expect(await hidden(p, '#footerUpgradeBtn'), 'footer upgrade hidden').toBe(true);
  await p.close();
});

test('settings page applies the hide-monetization class', async () => {
  const p = await ext.context.newPage();
  await p.goto(ext.extensionUrl('pages/settings.html'), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(2000);
  expect(await p.evaluate(() => document.body.classList.contains('seosona-hide-monetization'))).toBe(true);
  expect(await hidden(p, '#accountLinkingSection'), 'account linking hidden').toBe(true);
  await p.close();
});
