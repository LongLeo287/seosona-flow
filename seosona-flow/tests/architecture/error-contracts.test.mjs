// P4.T7 tests — typed errors & owned suppression (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { computeBudgets } from '../../scripts/quality/check-budgets.mjs';

const root = repoRoot();
const EC = loadClassic('src/core/ErrorCatalog.js').SEOSONA_ErrorCatalog;

test('positive: typed errors carry a stable code', () => {
  const e = EC.makeError(EC.CODES.NETWORK, 'boom');
  assert.equal(e.code, 'E_NETWORK');
  assert.ok(EC.isCode(e, EC.CODES.NETWORK));
  assert.equal(EC.isCode(e, EC.CODES.STORAGE), false);
});

test('positive: swallow returns a fallback and records the reason', () => {
  const v = EC.swallow('provider-probe', new Error('x'), 42);
  assert.equal(v, 42);
  const s = EC.suppressions();
  assert.ok(s.some((r) => r.reason === 'provider-probe'));
});

test('boundary: makeError preserves the cause', () => {
  const cause = new Error('root');
  const e = EC.makeError(EC.CODES.WORKFLOW, 'wrap', cause);
  assert.equal(e.cause, cause);
});

// Con số emptyCatch=0 CHỈ có nghĩa nếu SEOSONA_swallow thật sự tồn tại lúc chạy.
// 3 test dưới khoá đủ 3 ngữ cảnh: trang, content script, service worker.
test('wiring: ErrorCatalog xuất SEOSONA_swallow ra global', () => {
  const src = readFileSync(join(root, 'seosona-flow/src/core/ErrorCatalog.js'), 'utf8');
  assert.match(src, /global\.SEOSONA_swallow\s*=\s*swallow/, 'thiếu export global');
  // loadClassic chạy file trong sandbox riêng → kiểm trên chính sandbox đó.
  assert.equal(typeof loadClassic('src/core/ErrorCatalog.js').SEOSONA_swallow, 'function');
});

test('wiring: MỌI trang + MỌI content_scripts entry đều nạp ErrorCatalog', () => {
  // page-scripts.json giữ nguyên src tương đối của HTML (`../src/...`); manifest dùng
  // đường dẫn từ gốc extension (`src/...`).
  const cfg = JSON.parse(readFileSync(join(root, 'seosona-flow/config/page-scripts.json'), 'utf8'));
  for (const [page, list] of Object.entries(cfg.pages)) {
    assert.equal(list[0], '../src/core/ErrorCatalog.js', `${page} phải nạp ErrorCatalog ĐẦU TIÊN`);
  }
  const mf = JSON.parse(readFileSync(join(root, 'seosona-flow/manifest.json'), 'utf8'));
  mf.content_scripts.forEach((cs, i) => {
    assert.equal(cs.js[0], 'src/core/ErrorCatalog.js', `content_scripts[${i}] phải nạp ErrorCatalog ĐẦU TIÊN`);
  });
  const bg = readFileSync(join(root, 'seosona-flow/background.js'), 'utf8');
  assert.match(bg, /importScripts\('src\/core\/ErrorCatalog\.js'\)/, 'background thiếu ErrorCatalog');
});

test('wiring: suppression gọi dạng optional nên KHÔNG bao giờ ném thêm lỗi', () => {
  // Nếu gọi trần `SEOSONA_swallow(...)` mà ngữ cảnh chưa nạp file → ReferenceError
  // NGAY TRONG catch, biến lỗi im lặng thành lỗi to hơn. Bắt buộc `globalThis...?.`.
  const bad = [];
  for (const rel of ['src/app.js', 'content_scripts/content.js', 'background.js']) {
    const t = readFileSync(join(root, 'seosona-flow', rel), 'utf8');
    for (const m of t.match(/[\w$.]*SEOSONA_swallow\??\.?\(/g) || []) {
      if (!/^globalThis\.SEOSONA_swallow\?\.\($/.test(m)) bad.push(`${rel}: ${m}`);
    }
  }
  assert.deepEqual(bad, [], 'phải luôn là globalThis.SEOSONA_swallow?.(');
});

test('regression: empty-catch budget decreased vs the recorded baseline', () => {
  const baseline = JSON.parse(readFileSync(join(root, 'seosona-flow/artifacts/quality/budgets-baseline.json'), 'utf8'));
  const current = computeBudgets(root);
  assert.ok(current.metrics.emptyCatch <= baseline.metrics.emptyCatch, 'no regression');
  // Chốt cuối: 733 -> 0. Toàn bộ catch im lặng (cả `catch {}` lẫn `.catch(() => {})`)
  // đã đổi sang owned suppression `globalThis.SEOSONA_swallow?.('File#fn', err)`, và
  // ErrorCatalog.js được nạp ở CẢ 12 trang + CẢ 10 entry content_scripts + background.
  // Khoá về 0 để debt không bò lại; thêm catch rỗng mới là gãy gate.
  assert.equal(baseline.metrics.emptyCatch, 0, `empty-catch phải giữ 0 (got ${baseline.metrics.emptyCatch})`);
});
