// SEOSONA brand theme (2026-07): the lime/acid-green accent is replaced by the
// brand blue (#3d6ff5 dark / #0e4099 light) + emerald success (#19d07b), and the
// UI font is Be Vietnam Pro (bundled woff2, offline). These assert the brand
// tokens resolve and the font actually loads from the extension origin.
import { test, expect } from '@playwright/test';
import { launchExtension } from '../../scripts/test/launch-extension.mjs';

let ext;
test.beforeAll(async () => { ext = await launchExtension(); });
test.afterAll(async () => { await ext?.close(); });

test('workflow editor: brand blue primary, emerald success, Be Vietnam Pro loaded', async () => {
  const p = await ext.context.newPage();
  await p.goto(ext.extensionUrl('pages/workflow-editor.html'), { waitUntil: 'domcontentloaded' });
  await p.waitForTimeout(1500);

  // brand font actually fetched + parsed by the page (woff2 from extension origin)
  const fontReady = await p.evaluate(async () => {
    await document.fonts.ready;
    return document.fonts.check('600 14px "Be Vietnam Pro"');
  });
  expect(fontReady, 'Be Vietnam Pro face available').toBe(true);

  // body renders in the brand font
  const fam = await p.evaluate(() => getComputedStyle(document.body).fontFamily);
  expect(fam.toLowerCase()).toContain('be vietnam pro');

  // --primary resolves to brand blue (dark default) — no lime left
  const primary = await p.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--primary').trim().toLowerCase());
  expect(['#3d6ff5', '#0e4099']).toContain(primary);

  const success = await p.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--success').trim().toLowerCase());
  expect(success).toBe('#19d07b');
  await p.close();
});
