// P2.T6 — launch a clean-profile Chromium with the unpacked extension loaded.
// Uses the new headless mode (extension service workers require it). No live
// account, no network dependency.
import { chromium } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// seosona-flow/ root (contains manifest.json)
const EXT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function launchExtension({ swTimeout = 20000 } = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'seosona-e2e-'));
  const args = [
    `--disable-extensions-except=${EXT_PATH}`,
    `--load-extension=${EXT_PATH}`,
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
  ];

  let context;
  try {
    // Preferred: the "chromium" channel provides new-headless extension support.
    context = await chromium.launchPersistentContext(userDataDir, { channel: 'chromium', args });
  } catch {
    // Fallback: bundled build with the explicit new-headless flag.
    context = await chromium.launchPersistentContext(userDataDir, { headless: false, args });
  }

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent('serviceworker', { timeout: swTimeout });
  const extensionId = new URL(sw.url()).host;

  return {
    context,
    serviceWorker: sw,
    extensionId,
    extensionUrl: (rel) => `chrome-extension://${extensionId}/${rel.replace(/^\//, '')}`,
    async close() {
      await context.close();
      try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* profile cleanup best-effort */ }
    },
  };
}
