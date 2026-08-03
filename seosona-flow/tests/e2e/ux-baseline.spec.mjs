// P8.T1 — UX structural baseline (browser). Confirms each critical page renders
// with its expected root and no console errors. Deliberately NOT a pixel baseline
// (those are browser-deferred + review-gated) — this is the reproducible
// structural receipt every critical journey must have.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { launchExtension } from '../../scripts/test/launch-extension.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, '../../config/visual-matrix.json'), 'utf8'));

let ext;
test.beforeAll(async () => { ext = await launchExtension(); });
test.afterAll(async () => { await ext?.close(); });

for (const flow of cfg.criticalFlows) {
  test(`critical flow renders: ${flow.id}`, async () => {
    const page = await ext.context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(ext.extensionUrl(flow.page), { waitUntil: 'domcontentloaded' });
    await expect(page.locator(flow.root)).toHaveCount(1);
    await page.waitForTimeout(300);
    expect(errors, `page errors on ${flow.id}: ${errors.join(' | ')}`).toEqual([]);
    await page.close();
  });
}
