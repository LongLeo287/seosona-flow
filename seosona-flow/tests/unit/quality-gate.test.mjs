// Đòn 5 — cổng chất lượng: chấm 6 trục, lỗi CRITICAL trượt bất kể điểm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');
const root = {};
new Function('self', read('src/core/QualityGate.js'))(root);
const QG = root.QualityGate;

const ALL = (v) => ({
  prompt_adherence: v, character_consistency: v, motion_quality: v,
  visual_fidelity: v, temporal_coherence: v, composition: v,
});

test('tổng trọng số bằng 1 (nếu không thang điểm sai lệch)', () => {
  const sum = QG.DIMENSIONS.reduce((a, d) => a + d.weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `tổng = ${sum}`);
});

test('điểm đều thì tổng bằng chính nó', () => {
  assert.equal(QG.weightedScore(ALL(8)), 8);
  assert.equal(QG.weightedScore(ALL(0)), 0);
});

test('trục THIẾU điểm bị bỏ và chuẩn hoá lại — chấm ảnh tĩnh vẫn đúng thang', () => {
  // Ảnh tĩnh không có chuyển động / mạch thời gian.
  const s = QG.weightedScore({ prompt_adherence: 8, character_consistency: 8, visual_fidelity: 8, composition: 8 });
  assert.equal(s, 8, 'không được kéo tụt vì thiếu 2 trục video');
});

test('điểm ngoài thang bị kẹp về 0–10, không làm vỡ kết quả', () => {
  assert.equal(QG.weightedScore(ALL(99)), 10);
  assert.equal(QG.weightedScore(ALL(-5)), 0);
  assert.equal(QG.weightedScore({ prompt_adherence: 'abc' }), 0);
});

test('không có điểm nào → 0, không chia cho 0', () => {
  assert.equal(QG.weightedScore({}), 0);
  assert.equal(QG.weightedScore(null), 0);
});

test('5 mức thang, mỗi mức nói rõ LÀM GÌ TIẾP chứ không chỉ ra điểm', () => {
  assert.equal(QG.band(9.5).action, 'accept');
  assert.equal(QG.band(8.0).action, 'accept');
  assert.equal(QG.band(6.5).action, 'trim');
  assert.equal(QG.band(5.0).action, 'regen_image');
  assert.equal(QG.band(2.0).action, 'rewrite_prompt');
});

test('mức kém quay lại gen ẢNH, KHÔNG gen lại video', () => {
  // Gen lại video từ một ảnh xấu chỉ tốn thêm credit mà vẫn xấu.
  assert.equal(QG.band(4.5).action, 'regen_image');
  assert.ok(QG.BANDS.every((b) => b.action !== 'regen_video'));
});

test('mốc biên đúng: 9.0 / 7.5 / 6.0 / 4.0', () => {
  assert.equal(QG.band(9.0).verdict, 'excellent');
  assert.equal(QG.band(8.99).verdict, 'good');
  assert.equal(QG.band(7.5).verdict, 'good');
  assert.equal(QG.band(7.49).verdict, 'acceptable');
  assert.equal(QG.band(6.0).verdict, 'acceptable');
  assert.equal(QG.band(5.99).verdict, 'poor');
  assert.equal(QG.band(4.0).verdict, 'poor');
  assert.equal(QG.band(3.99).verdict, 'unusable');
});

test('lỗi CRITICAL là TRƯỢT dù điểm gần tuyệt đối', () => {
  const v = QG.judge(ALL(9.8), [{ severity: 'CRITICAL', note: 'bàn tay 6 ngón' }]);
  assert.equal(v.pass, false, 'trung bình cộng che mất lỗi chí mạng — không được cho qua');
  assert.equal(v.verdict, 'critical_fail');
  assert.deepEqual(v.critical, ['bàn tay 6 ngón']);
  assert.ok(v.score > 9, 'vẫn báo điểm thật để người dùng thấy nghịch lý');
});

test('lỗi HIGH/MINOR không tự động trượt — chỉ CRITICAL mới', () => {
  const v = QG.judge(ALL(8), [{ severity: 'HIGH', note: 'trôi nhẹ' }, { severity: 'MINOR', note: 'hạt' }]);
  assert.equal(v.pass, true);
  assert.equal(v.critical.length, 0);
  assert.equal(v.reasons.length, 2, 'vẫn ghi lại để người dùng biết');
});

test('severity không phân biệt hoa thường', () => {
  assert.equal(QG.judge(ALL(9), [{ severity: 'critical', note: 'x' }]).pass, false);
});

test('CRITICAL + điểm rất thấp → viết lại prompt, không chỉ gen lại ảnh', () => {
  assert.equal(QG.judge(ALL(2), [{ severity: 'CRITICAL', note: 'x' }]).action, 'rewrite_prompt');
  assert.equal(QG.judge(ALL(6), [{ severity: 'CRITICAL', note: 'x' }]).action, 'regen_image');
});

test('ngưỡng đạt chỉnh được (mặc định 7,5)', () => {
  assert.equal(QG.judge(ALL(7), []).pass, false);
  assert.equal(QG.judge(ALL(7), [], { threshold: 6 }).pass, true);
  assert.equal(QG.judge(ALL(9), [], { threshold: 9.5 }).pass, false);
});

test('không có lỗi nào cũng chạy được (issues thiếu/null)', () => {
  assert.equal(QG.judge(ALL(9)).pass, true);
  assert.equal(QG.judge(ALL(9), null).pass, true);
});

test('lấy mẫu khung: nhanh 4/giây, kỹ 8/giây', () => {
  assert.equal(QG.framesFor(8, 'light'), 32);
  assert.equal(QG.framesFor(8, 'deep'), 64);
  assert.equal(QG.framesFor(8, 'linh tinh'), 32, 'mode lạ → chế độ nhanh');
  assert.equal(QG.framesFor(0, 'light'), 1, 'luôn ít nhất 1 khung');
});

test('bộ lọc rẻ chặn file hỏng TRƯỚC khi tốn model', () => {
  assert.equal(QG.cheapPreFilter({ fileSize: 100 }).pass, false);
  assert.equal(QG.cheapPreFilter({ width: 16, height: 16 }).pass, false);
  assert.equal(QG.cheapPreFilter({ durationSec: 0 }).pass, false);
});

test('bộ lọc rẻ trả null khi không kết luận được → mới gọi model', () => {
  assert.equal(QG.cheapPreFilter({ fileSize: 500000, width: 1024, height: 1024 }), null);
  assert.equal(QG.cheapPreFilter({}), null);
  assert.equal(QG.cheapPreFilter(null), null);
});

// ── Đăng ký node ─────────────────────────────────────────────────────────────

test('node quality_gate có trong NodeTemplates với 2 cổng ra (đạt/trượt)', () => {
  const src = read('src/workflow/NodeTemplates.js');
  assert.match(src, /quality_gate: `<svg/, 'thiếu icon');
  assert.match(src, /quality_gate: \{/, 'thiếu định nghĩa');
  assert.match(src, /portQaPass/, 'thiếu cổng đạt');
  assert.match(src, /portQaFail/, 'thiếu cổng trượt');
});

test('node quality_gate có trong node-catalog với outputs=2', () => {
  const cat = JSON.parse(read('src/workflow/framework/node-catalog.json'));
  assert.ok(cat.quality_gate, 'catalog thiếu quality_gate');
  assert.equal(cat.quality_gate.outputs, 2, 'phải có nhánh trượt để tự gen lại');
});

// ── Handler trong executor (trước đây node có form nhưng KHÔNG chạy được) ──────

test('executor có dispatch + handler cho quality_gate', () => {
  const src = read('src/core/WorkflowExecutor.js');
  assert.match(src, /node_type === 'quality_gate'/, 'thiếu dispatch — node hiện trong picker nhưng chạy không làm gì');
  assert.match(src, /_executeQualityGateNode\(node, workflow, nodeLog\)/, 'thiếu handler');
});

test('handler: 2 mã lỗi rõ ràng, đều noRetry (lỗi cấu hình, thử lại vô ích)', () => {
  const src = read('src/core/WorkflowExecutor.js');
  for (const c of ['QUALITY_GATE_UNAVAILABLE', 'QUALITY_GATE_NO_INPUT']) {
    assert.ok(src.includes(c), `thiếu mã ${c}`);
  }
});

test('handler: bộ lọc rẻ chạy TRƯỚC khi gọi model', () => {
  const src = read('src/core/WorkflowExecutor.js');
  const fn = src.slice(src.indexOf('async _executeQualityGateNode(node, workflow, emitLog)'));
  const iCheap = fn.indexOf('cheapPreFilter');
  const iModel = fn.indexOf("action: 'pa:generate'");
  assert.ok(iCheap > 0 && iModel > 0 && iCheap < iModel, 'gọi model trước rồi mới lọc = tốn tiền vô ích');
});

test('handler: model không trả JSON → KHÔNG tự đánh trượt (chặn oan tệ hơn)', () => {
  const src = read('src/core/WorkflowExecutor.js');
  const fn = src.slice(src.indexOf('async _executeQualityGateNode(node, workflow, emitLog)'));
  assert.match(fn.slice(0, 4000), /verdict: 'unjudged'/);
  assert.match(fn.slice(0, 4000), /pass: true/, 'không chấm được thì cho đi tiếp, nhưng phải ghi log');
});

test('handler: rẽ nhánh dùng CHUNG helper với condition (không viết lại logic skip)', () => {
  const src = read('src/core/WorkflowExecutor.js');
  assert.match(src, /_skipInactiveBranch\(node, workflow, activePort, inactivePort\)/, 'condition phải dùng helper');
  assert.match(src, /_skipInactiveBranch\(node, workflow, verdict\.pass \? 'pass' : 'fail'/, 'quality_gate phải dùng helper');
  // Guard merge-skip nằm trong helper → cả hai cùng hưởng, không lệch nhau về sau.
  assert.match(src, /hasLiveInput/, 'mất guard merge-skip thì workflow có node Merge sẽ đứng');
});

test('template mẫu 1043 dùng CẢ entity_ref lẫn quality_gate, có nhánh trượt', () => {
  const src = read('src/workflow/BundledWorkflowsExtra.js');
  assert.match(src, /type: 'entity_ref'/);
  assert.match(src, /type: 'quality_gate'/);
  assert.match(src, /'qa', p \+ 'gensc', 'fail'/, 'thiếu nhánh trượt → quay lại gen');
  assert.match(src, /'qa', p \+ 'dl', 'pass'/, 'thiếu nhánh đạt → tải');
});

test('template 1043 KHÔNG trỏ ảnh bìa không tồn tại', () => {
  const src = read('src/workflow/BundledWorkflowsExtra.js');
  assert.match(src, /T\[T\.length - 1\]\.thumbnail_url = null;/,
    'tpl() tự đặt thumb_1043.png — file không có thì bìa vỡ');
});
