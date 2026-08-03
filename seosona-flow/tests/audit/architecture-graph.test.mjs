// P1.T2 tests — positive, negative, boundary, regression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildArchitectureGraph,
  scriptSrcsInOrder,
  resolveFrom,
} from '../../scripts/audit/lib/graph.mjs';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';

const graph = buildArchitectureGraph();

test('positive: every declared resource exists', () => {
  assert.deepEqual(graph.missingResources, [], 'no missing declared resource');
});

// Trước đây 2 test này chốt cứng "8 trang" và "sidebar 141 script" — số của ảnh chụp
// Phase-01. Thực tế đã là 12 trang / 173 script, nên chúng hỏng âm thầm từ lâu (tier
// test:audit ít khi được chạy). Thay số ma bằng ĐỐI CHIẾU CHÉO với config/page-scripts.json:
// graph đọc HTML sống, config là bản sinh ra từ HTML — hai đường dẫn xuất độc lập phải
// khớp nhau. Con số tuyệt đối vẫn được chốt riêng ở tests/architecture/page-scripts.test.mjs
// (ratchet có chủ ý), nên vẫn không ai lỡ tay thêm/xoá script mà không ai biết.
const pageScriptsConfig = JSON.parse(
  readFileSync(join(repoRoot(), 'seosona-flow/config/page-scripts.json'), 'utf8'),
);

test('positive: each page has a load receipt', () => {
  assert.equal(graph.nodes.pages, Object.keys(pageScriptsConfig.pages).length, 'graph và config cùng số trang');
  for (const p of graph.pages) {
    assert.ok(Array.isArray(p.scripts));
    assert.equal(p.scriptCount, p.scripts.length);
    for (const s of p.scripts) assert.equal(s.exists, true);
  }
});

test('positive: sidebar page loads its full ordered script list', () => {
  const sidebar = graph.pages.find((p) => p.page === 'pages/sidebar.html');
  assert.ok(sidebar);
  assert.equal(sidebar.scriptCount, pageScriptsConfig.pages['pages/sidebar.html'].length,
    'số script sidebar theo graph phải khớp config');
  // order is preserved and monotonic
  sidebar.scripts.forEach((s, i) => assert.equal(s.order, i));
});

test('positive: service worker and content-script groups are typed', () => {
  assert.equal(graph.nodes.serviceWorker.rel, 'background.js');
  assert.equal(graph.nodes.serviceWorker.exists, true);
  assert.ok(graph.nodes.contentScriptGroups >= 1);
  for (const g of graph.contentScriptGroups) {
    assert.ok(Array.isArray(g.matches) && g.matches.length > 0);
    for (const s of g.scripts) assert.equal(s.exists, true);
  }
});

test('negative: a fabricated missing src is detected', () => {
  const html = '<script src="../does/not/exist.js"></script>';
  const srcs = scriptSrcsInOrder(html);
  assert.deepEqual(srcs, ['../does/not/exist.js']);
  assert.equal(resolveFrom('pages/x.html', '../does/not/exist.js'), 'does/not/exist.js');
});

test('boundary: external and query/hash srcs resolve safely', () => {
  assert.equal(resolveFrom('pages/sidebar.html', '../src/a.js?v=2'), 'src/a.js');
  assert.equal(resolveFrom('pages/sidebar.html', '../src/a.js#top'), 'src/a.js');
  // external scripts are excluded from resolved list, counted separately
  for (const p of graph.pages) {
    for (const s of p.scripts) assert.ok(!/^https?:/i.test(s.resolved));
  }
});

test('boundary: parser ignores inline scripts', () => {
  const html = '<script>console.log(1)</script><script src="a.js"></script>';
  assert.deepEqual(scriptSrcsInOrder(html), ['a.js']);
});

test('regression: receiptHash is deterministic', () => {
  const again = buildArchitectureGraph();
  assert.equal(again.receiptHash, graph.receiptHash);
});
