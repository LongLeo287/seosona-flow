// Đòn 2 — vô hiệu hoá dây chuyền + cổng chặn ảnh tham chiếu.
//
// Vì sao cần: executor ĐÃ có resume bỏ qua node status='completed'. Chính vì vậy,
// chạy lại 1 node ảnh mà không xoá kết quả phía sau thì workflow báo "xong" trong
// khi video vẫn dựng từ ảnh CŨ — sai âm thầm, tốn credit, chỉ lộ khi xem lại.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');

// Tái dựng đúng 2 hàm thuần từ nguồn (WorkflowExecutor quá nặng để nạp cả file).
// Bám sát bản cài đặt: cùng thuật toán BFS + cùng danh sách trường kết quả.
const RESULT_FIELDS = ['result_file_ids', 'result_thumbnails', 'result_file_names',
  'result_provider_urls', 'result_text', 'result_source', 'error_message', 'executed_at'];

function collectDownstream(wf, nodeId) {
  const edges = wf.edges || [];
  const out = new Set();
  const queue = edges.filter((e) => e.source_node_id === nodeId).map((e) => e.target_node_id);
  while (queue.length) {
    const id = queue.shift();
    if (!id || out.has(id)) continue;
    out.add(id);
    edges.filter((e) => e.source_node_id === id).forEach((e) => queue.push(e.target_node_id));
  }
  out.delete(nodeId);
  return out;
}

function invalidate(wf, nodeId) {
  const ids = collectDownstream(wf, nodeId);
  const cleared = [];
  for (const n of wf.nodes) {
    if (!ids.has(n.node_id)) continue;
    if (n.status !== 'completed' && n.status !== 'failed') continue;
    n.status = 'pending';
    for (const f of RESULT_FIELDS) delete n[f];
    cleared.push(n.node_id);
  }
  return cleared;
}

const chain = () => ({
  nodes: [
    { node_id: 'img', node_type: 'generate', status: 'completed', result_file_ids: 'a' },
    { node_id: 'vid', node_type: 'generate', status: 'completed', result_file_ids: 'b', result_thumbnails: { x: 1 } },
    { node_id: 'dl', node_type: 'download', status: 'completed', result_file_names: 'c.mp4' },
    { node_id: 'other', node_type: 'text', status: 'completed', result_text: 'giữ nguyên' },
  ],
  edges: [
    { source_node_id: 'img', target_node_id: 'vid', target_port: 'input_1' },
    { source_node_id: 'vid', target_node_id: 'dl', target_port: 'input_1' },
  ],
});

test('xoá TOÀN BỘ hạ lưu, không chỉ node kề', () => {
  const wf = chain();
  const cleared = invalidate(wf, 'img');
  assert.deepEqual(cleared.sort(), ['dl', 'vid'], 'phải lan tới cuối chuỗi');
  assert.equal(wf.nodes.find((n) => n.node_id === 'vid').status, 'pending');
  assert.equal(wf.nodes.find((n) => n.node_id === 'dl').status, 'pending');
});

test('xoá SẠCH mọi trường kết quả, không sót thumbnails/file_names', () => {
  const wf = chain();
  invalidate(wf, 'img');
  const vid = wf.nodes.find((n) => n.node_id === 'vid');
  for (const f of RESULT_FIELDS) assert.equal(f in vid, false, `còn sót ${f}`);
});

test('KHÔNG đụng node ngoài luồng và không đụng chính node được chạy lại', () => {
  const wf = chain();
  invalidate(wf, 'img');
  assert.equal(wf.nodes.find((n) => n.node_id === 'other').result_text, 'giữ nguyên');
  assert.equal(wf.nodes.find((n) => n.node_id === 'img').result_file_ids, 'a', 'node gốc do caller tự reset');
});

test('node hạ lưu đang pending thì bỏ qua (không có gì để xoá)', () => {
  const wf = chain();
  wf.nodes.find((n) => n.node_id === 'vid').status = 'pending';
  const cleared = invalidate(wf, 'img');
  assert.deepEqual(cleared, ['dl'], 'chỉ node đã có kết quả mới bị xoá');
});

test('node hạ lưu FAILED cũng phải xoá (lỗi cũ không còn ý nghĩa)', () => {
  const wf = chain();
  const vid = wf.nodes.find((n) => n.node_id === 'vid');
  vid.status = 'failed'; vid.error_message = 'lỗi cũ';
  invalidate(wf, 'img');
  assert.equal(vid.status, 'pending');
  assert.equal('error_message' in vid, false);
});

test('đồ thị có chu trình KHÔNG làm treo vòng lặp', () => {
  const wf = chain();
  wf.edges.push({ source_node_id: 'dl', target_node_id: 'img' }); // vòng ngược
  const cleared = invalidate(wf, 'img');
  assert.ok(cleared.includes('vid') && cleared.includes('dl'));
});

test('nhánh rẽ: cả hai nhánh đều bị xoá', () => {
  const wf = chain();
  wf.nodes.push({ node_id: 'vid2', status: 'completed', result_file_ids: 'z' });
  wf.edges.push({ source_node_id: 'img', target_node_id: 'vid2' });
  const cleared = invalidate(wf, 'img');
  assert.ok(cleared.includes('vid2'), 'nhánh song song bị bỏ sót');
});

// ── Cổng chặn ref ─────────────────────────────────────────────────────────────

test('nguồn: cổng chặn ref nằm TRƯỚC mọi kiểm tra provider', () => {
  const src = read('src/workflow/WorkflowEditorRun.js');
  const iRef = src.indexOf('_findMissingRefs(nodes)');
  const iProv = src.indexOf('providersUsed');
  assert.ok(iRef > 0 && iProv > 0);
  assert.ok(src.indexOf('const missingRefs = this._findMissingRefs(nodes)') < iProv,
    'thiếu ref thì mở tab Flow cũng vô nghĩa — phải chặn trước');
  assert.match(src, /reason: 'MISSING_REFS'/);
});

test('nguồn: upstream cùng chạy trong lượt này thì KHÔNG báo thiếu', () => {
  const src = read('src/workflow/WorkflowEditorRun.js');
  assert.match(src, /if \(willRun\.has\(src\.node_id\)\) continue;/,
    'thiếu điều này thì chạy cả workflow lần đầu sẽ bị chặn oan');
});

test('nguồn: chạy lại 1 node có xoá hạ lưu và LƯU lại', () => {
  const src = read('src/workflow/WorkflowEditorRun.js');
  assert.match(src, /invalidateDownstream\?\.\(actualNodeId, this\.workflow\)/);
  assert.match(src, /saveWorkflow\(\{ skipIfClean: false \}\)/, 'xoá xong phải lưu, không thì reload là quay lại như cũ');
});

test('nguồn: executor có RESULT_FIELDS gom một chỗ (thêm trường mới khỏi sót)', () => {
  const src = read('src/core/WorkflowExecutor.js');
  assert.match(src, /static get RESULT_FIELDS\(\)/);
  for (const f of RESULT_FIELDS) assert.ok(src.includes(`'${f}'`), `RESULT_FIELDS thiếu ${f}`);
});
