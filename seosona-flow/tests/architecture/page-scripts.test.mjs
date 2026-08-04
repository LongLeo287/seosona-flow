// P4.T6 tests — page bootstrap manifest (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { buildArchitectureGraph } from '../../scripts/audit/lib/graph.mjs';

const root = repoRoot();
const config = JSON.parse(readFileSync(join(root, 'seosona-flow/config/page-scripts.json'), 'utf8'));
const graph = buildArchitectureGraph(root);

test('positive: config covers all extension pages', () => {
  const pages = Object.keys(config.pages).sort();
  const graphPages = graph.pages.map((p) => p.page).sort();
  assert.deepEqual(pages, graphPages);
});

test('positive: config script order matches the live HTML', () => {
  for (const p of graph.pages) {
    assert.deepEqual(config.pages[p.page], p.scripts.map((s) => s.src), `${p.page} order matches`);
  }
});

test('boundary: all scripts are CSP-safe local references', () => {
  assert.equal(config.externalScripts, 0);
  for (const list of Object.values(config.pages)) {
    for (const src of list) assert.ok(!/^https?:|^\/\//i.test(src), `local src: ${src}`);
  }
});

// Ratchet: số script của sidebar phải được cập nhật CÓ Ý THỨC (chống vô tình thêm/xoá script).
// 151 -> 168 khi regen config từ HTML sống (gồm ExecutionStop.js cho nút Dừng ở footer + các
// module nạp thêm ở những thay đổi khác). Sửa số này chỉ khi đã kiểm đúng danh sách.
// 171 -> 172: thêm src/core/ErrorCatalog.js làm script ĐẦU TIÊN (owned suppression —
// mọi catch im lặng gọi SEOSONA_swallow, nếu thiếu file này thì thành no-op).
// 172 -> 173: WorkflowEditorRun.js (đợt tách thứ 3 của WorkflowEditor.js).
// 173 -> 174: WorkflowEditorEvents.js (đợt tách thứ 4).
// 184 -> 185: MetadataScrubber.js (dọn metadata riêng tư ở đường tải về).
// 186 -> 183: GỠ BundledTemplates + BundledWorkflowsExtra khỏi danh sách nạp sẵn (1,4 MB cho
// 30 workflow mẫu mà người dùng mở một cái) — nay nạp theo yêu cầu, xem ensureBundledTemplates.
test('negative: sidebar keeps its full ordered script list', () => {
  assert.equal(config.pages['pages/sidebar.html'].length, 183);
  assert.equal(config.pages['pages/sidebar.html'][0], '../src/core/ErrorCatalog.js');
});

test('regression: no duplicate script within a page', () => {
  for (const [page, list] of Object.entries(config.pages)) {
    assert.equal(new Set(list).size, list.length, `${page} has no duplicate script`);
  }
});
