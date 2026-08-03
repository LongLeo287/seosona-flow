// P2.T4 — page bootstrap smoke (contract level; browser execution is P2.T6).
// Validates all extension pages: existence, order, duplicate init, and errors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import {
  buildArchitectureGraph,
  extensionTrackedSet,
  scriptSrcsInOrder,
  resolveFrom,
} from '../../scripts/audit/lib/graph.mjs';

const root = repoRoot();
const graph = buildArchitectureGraph(root);
const pageScriptsConfig = JSON.parse(
  readFileSync(join(root, 'seosona-flow/config/page-scripts.json'), 'utf8'),
);
const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'pages');

function analyzeHtml(pageRel, html, tracked) {
  const seen = new Set();
  const duplicates = [];
  const missing = [];
  scriptSrcsInOrder(html).forEach((src) => {
    if (/^(https?:|chrome-extension:|data:)/i.test(src)) return;
    const resolved = resolveFrom(pageRel, src);
    if (seen.has(resolved)) duplicates.push(resolved);
    seen.add(resolved);
    if (!tracked.has(resolved)) missing.push(resolved);
  });
  return { duplicates, missing };
}

test('positive: mọi trang tiện ích bootstrap sạch', () => {
  // Trước chốt cứng "8 trang" — số của ảnh chụp Phase-01, thực tế đã 12 nên test hỏng
  // âm thầm. Đối chiếu chéo với config/page-scripts.json (bản sinh từ HTML) thay vì số ma;
  // con số tuyệt đối vẫn được ratchet ở tests/architecture/page-scripts.test.mjs.
  assert.equal(graph.pages.length, Object.keys(pageScriptsConfig.pages).length);
  for (const p of graph.pages) {
    assert.ok(p.scriptCount > 0, `${p.page} loads scripts`);
    assert.deepEqual(p.missing, [], `${p.page} has no missing script`);
    assert.deepEqual(p.duplicates, [], `${p.page} has no duplicate init`);
  }
});

test('positive: script load order is deterministic and monotonic', () => {
  for (const p of graph.pages) {
    p.scripts.forEach((s, i) => assert.equal(s.order, i, `${p.page} order stable`));
  }
});

test('boundary: sidebar loads its foundational scripts before consumers', () => {
  const sidebar = graph.pages.find((p) => p.page === 'pages/sidebar.html');
  const resolved = sidebar.scripts.map((s) => s.resolved);
  const runtimeMode = resolved.indexOf('src/core/RuntimeMode.js');
  const apiClient = resolved.indexOf('src/core/ApiClient.js');
  assert.ok(runtimeMode >= 0 && apiClient >= 0, 'core scripts present');
  // app.js (the consumer) loads after core services
  const app = resolved.findIndex((r) => r.endsWith('app.js'));
  if (app >= 0) assert.ok(app > Math.min(runtimeMode, apiClient), 'app.js after core');
});

test('negative: a page with duplicate scripts is detected', () => {
  const tracked = extensionTrackedSet(root);
  const html = readFileSync(join(fixtures, 'dup-scripts.html'), 'utf8');
  const r = analyzeHtml('pages/dup-scripts.html', html, tracked);
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.duplicates[0], 'src/core/RuntimeMode.js');
});

test('negative: a page with a missing script is detected', () => {
  const tracked = extensionTrackedSet(root);
  const html = readFileSync(join(fixtures, 'missing-script.html'), 'utf8');
  const r = analyzeHtml('pages/missing-script.html', html, tracked);
  assert.equal(r.missing.length, 1);
  assert.ok(r.missing[0].endsWith('DoesNotExist.js'));
});

test('regression: tổng số cạnh trang→script khớp config (không đóng băng số ma)', () => {
  const fromConfig = Object.values(pageScriptsConfig.pages).reduce((a, l) => a + l.length, 0);
  assert.equal(graph.totals.pageScripts, fromConfig);
  assert.equal(graph.totals.pagesWithDuplicates, 0);
});
