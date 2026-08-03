// P2.T7 tests — quality budgets (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { computeBudgets } from '../../scripts/quality/check-budgets.mjs';

const root = repoRoot();
const current = computeBudgets(root);
const baseline = JSON.parse(readFileSync(join(root, 'seosona-flow/artifacts/quality/budgets-baseline.json'), 'utf8'));

test('positive: budget metrics are captured for the product tree', () => {
  assert.ok(current.fileCount >= 100, 'many product files measured');
  for (const k of ['emptyCatch', 'consoleCalls', 'globalWrites', 'eslintDisables', 'oversizedFiles']) {
    assert.ok(k in current.metrics, `metric ${k} present`);
  }
  // emptyCatch đã về 0 (mọi catch im lặng chuyển sang owned suppression qua
  // SEOSONA_swallow) nên KHÔNG dùng nó làm bằng chứng "detector đang chạy" nữa —
  // consoleCalls giữ vai trò đó. Việc detector còn nhận diện đúng debt được test
  // riêng ở 'negative: the empty-catch pattern detects real debt' bên dưới.
  assert.equal(current.metrics.emptyCatch, 0, 'không được để catch rỗng quay lại');
  assert.ok(current.metrics.consoleCalls > 0, 'detector thực sự quét file sản phẩm');
});

test('regression: no metric exceeds the committed baseline (ratchet)', () => {
  for (const [k, v] of Object.entries(current.metrics)) {
    assert.ok(v <= baseline.metrics[k], `${k} did not regress (${v} <= ${baseline.metrics[k]})`);
  }
});

test('boundary: oversized files are listed with line counts', () => {
  assert.equal(current.metrics.oversizedFiles, current.oversized.length);
  for (const f of current.oversized) {
    assert.ok(f.lines > current.oversizeThreshold);
  }
  assert.ok(current.oversized.some((f) => f.path === 'background.js'));
});

test('negative: the empty-catch pattern detects real debt', () => {
  const re = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
  assert.equal((`try{}catch(e){}`.match(re) || []).length, 1);
  assert.equal((`try{}catch{}`.match(re) || []).length, 1);
  assert.equal((`try{}catch(e){ log(e); }`.match(re) || []).length, 0);
});

test('regression: vendored lib/ is excluded from product budgets', () => {
  // gwr-bundle etc. live under src/core but lib/ vendored files must not count.
  assert.ok(!current.oversized.some((f) => f.path.startsWith('lib/')));
});
