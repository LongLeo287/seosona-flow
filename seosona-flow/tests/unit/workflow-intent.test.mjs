// WorkflowIntent — rút yêu cầu kiểm-được từ mô tả NL + đối chiếu workflow AI sinh ra.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const root = {};
new Function('self', readFileSync(join(PKG, 'src/workflow/framework/WorkflowIntent.js'), 'utf8'))(root);
const WI = root.WorkflowIntent;

const tpl = (nodes) => ({ nodes });
const gen = (o) => Object.assign({ node_type: 'generate', media_type: 'Image', ratio: 'Ngang', quantity: 1 }, o);

// ── extract ────────────────────────────────────────────────────────────────
test('extract: số lượng + tỉ lệ + loại media', () => {
  const r = WI.extract('tạo 5 ảnh dọc 9:16 về cà phê');
  assert.equal(r.count, 5);
  assert.equal(r.ratio, 'Dọc');
  assert.equal(r.mediaType, 'Image');
});

test('extract: số viết bằng chữ tiếng Việt', () => {
  assert.equal(WI.extract('làm ba ảnh sản phẩm').count, 3);
});

test('extract: video → mediaType Video', () => {
  const r = WI.extract('làm 1 video reel quảng cáo');
  assert.equal(r.mediaType, 'Video');
  assert.equal(r.ratio, 'Dọc', 'reel ngụ ý dọc');
});

test('extract: vừa ảnh vừa video → KHÔNG chốt cứng mediaType (pipeline ảnh→video)', () => {
  assert.equal(WI.extract('tạo ảnh rồi biến thành video').mediaType, undefined);
});

test('extract: suy ra node cần thiết từ ngữ cảnh', () => {
  assert.ok(WI.extract('poster có chữ GIẢM GIÁ').needs.includes('text_overlay'));
  assert.ok(WI.extract('bộ ảnh cùng phong cách').needs.includes('style_anchor'));
  assert.ok(WI.extract('tách kịch bản thành nhiều cảnh').needs.includes('prompt_sequence'));
  assert.ok(WI.extract('gen xong tải về máy').needs.includes('download'));
});

test('extract: bỏ qua số vô lý (tránh báo sai)', () => {
  assert.equal(WI.extract('làm 99 ảnh').count, undefined);
});

test('extract: mô tả mơ hồ → không bịa ràng buộc', () => {
  const r = WI.extract('làm gì đó hay hay');
  assert.equal(r.count, undefined);
  assert.equal(r.ratio, undefined);
  assert.equal(r.needs.length, 0);
});

// ── verify ─────────────────────────────────────────────────────────────────
test('⭐ bắt được workflow HỢP LỆ nhưng SAI Ý (lỗ hổng cũ)', () => {
  // user xin 5 ảnh dọc — AI trả 1 ảnh ngang: validate cấu trúc vẫn ok, phải bị bắt ở đây
  const req = WI.extract('tạo 5 ảnh dọc 9:16');
  const r = WI.verify(tpl([gen({ ratio: 'Ngang', quantity: 1 })]), req);
  assert.equal(r.ok, false);
  const codes = r.mismatches.map((m) => m.code).sort();
  assert.deepEqual(codes, ['COUNT', 'RATIO']);
});

test('verify: khớp đúng → ok', () => {
  const req = WI.extract('tạo 5 ảnh dọc');
  const r = WI.verify(tpl([gen({ ratio: 'Dọc', quantity: 5 })]), req);
  assert.equal(r.ok, true);
  assert.equal(r.mismatches.length, 0);
});

test('verify: cộng dồn quantity nhiều node gen', () => {
  const req = WI.extract('tạo 6 ảnh dọc');
  const r = WI.verify(tpl([gen({ ratio: 'Dọc', quantity: 3 }), gen({ ratio: 'Dọc', quantity: 3 })]), req);
  assert.equal(r.ok, true, 'ba + ba = sáu, phải tính là đủ');
});

test('verify: sai loại media', () => {
  const req = WI.extract('làm 1 video');
  const r = WI.verify(tpl([gen({ media_type: 'Image' })]), req);
  assert.ok(r.mismatches.some((m) => m.code === 'MEDIA_TYPE'));
});

test('verify: thiếu node năng lực bắt buộc', () => {
  const req = WI.extract('poster có chữ khuyến mãi');
  const r = WI.verify(tpl([gen({})]), req);
  const miss = r.mismatches.find((m) => m.code === 'MISSING_NODE');
  assert.ok(miss);
  assert.equal(miss.want, 'text_overlay');
});

test('verify: có đủ node năng lực → không báo', () => {
  const req = WI.extract('poster có chữ khuyến mãi');
  const r = WI.verify(tpl([gen({}), { node_type: 'text_overlay' }]), req);
  assert.ok(!r.mismatches.some((m) => m.code === 'MISSING_NODE'));
});

test('verify: workflow rỗng → báo NO_NODES', () => {
  assert.equal(WI.verify(tpl([]), {}).mismatches[0].code, 'NO_NODES');
});

test('verify: node dùng shape data.* (khác node_type phẳng) vẫn đọc được', () => {
  const req = WI.extract('tạo 4 ảnh vuông');
  const r = WI.verify(tpl([{ type: 'generate', data: { ratio: 'Vuông', quantity: 4 } }]), req);
  assert.equal(r.ok, true);
});

test('verify: không có ràng buộc nào → luôn ok (không bịa lỗi)', () => {
  assert.equal(WI.verify(tpl([gen({})]), WI.extract('làm gì đó')).ok, true);
});

// ── feedback ───────────────────────────────────────────────────────────────
test('feedback: chỉ dẫn cho MODEL viết bằng TIẾNG ANH, nêu rõ chỗ lệch', () => {
  const req = WI.extract('tạo 5 ảnh dọc');
  const r = WI.verify(tpl([gen({ ratio: 'Ngang', quantity: 1 })]), req);
  const fb = WI.feedback(r.mismatches);
  assert.match(fb, /does NOT match the user request/);
  assert.match(fb, /RATIO/);
  assert.match(fb, /COUNT/);
  assert.match(fb, /Keep everything that is already correct/, 'phải dặn giữ phần đã đúng');
  // enum của app phải giữ nguyên, KHÔNG dịch
  assert.match(fb, /"Dọc"/, 'giá trị enum phải giữ literal');
  assert.match(fb, /do not translate/i, 'phải dặn model đừng dịch enum');
  assert.equal(WI.feedback([]), '');
});

test('feedback KHÔNG dùng lại msg tiếng Việt (msg dành cho UI)', () => {
  const req = WI.extract('làm 1 video');
  const r = WI.verify(tpl([gen({ media_type: 'Image' })]), req);
  // msg giữ tiếng Việt cho người đọc
  assert.match(r.mismatches[0].msg, /User yêu cầu/);
  // còn feedback gửi model thì thuần tiếng Anh
  const fb = WI.feedback(r.mismatches);
  assert.ok(!/yêu cầu/.test(fb), 'chỉ dẫn cho model không được lẫn tiếng Việt');
  assert.match(fb, /asked for Video output/);
});

// ── đăng ký vào agent ──────────────────────────────────────────────────────
test('WorkflowAgent có nối kiểm-ý + trả intentOk/mismatches', () => {
  const src = readFileSync(join(PKG, 'src/workflow/framework/WorkflowAgent.js'), 'utf8');
  assert.match(src, /root\.WorkflowIntent/, 'agent chưa dùng WorkflowIntent');
  assert.match(src, /intentOk:/, 'kết quả trả về thiếu intentOk');
  assert.match(src, /icheck\.mismatches\.length < intentCheck\.mismatches\.length/, 'thiếu chốt chỉ-nhận-khi-tốt-hơn');
});

test('metaPrompt đã trỏ node chuyên dụng thay vì bảo làm tay', () => {
  const src = readFileSync(join(PKG, 'src/workflow/framework/WorkflowAgent.js'), 'utf8');
  assert.match(src, /USE THE "text_overlay" NODE/, 'chưa chỉ node text_overlay');
  assert.match(src, /USE THE "style_anchor" NODE/, 'chưa chỉ node style_anchor');
  assert.ok(!/chèn NGUYÊN VĂN khối đó vào data\.prompt của MỌI node generate/.test(src), 'còn hướng dẫn làm tay đã lỗi thời');
});

test('prompt gửi model đã sang TIẾNG ANH (không còn chỉ thị tiếng Việt)', () => {
  const src = readFileSync(join(PKG, 'src/workflow/framework/WorkflowAgent.js'), 'utf8');
  // lấy đúng phần chuỗi trong metaPrompt/repairPrompt (bỏ comment code)
  const body = src.split('function metaPrompt')[1].split('function extractJson')[0];
  const lines = body.split('\n').filter((l) => /^\s*'/.test(l.trim()));
  const viRe = /(Bạn là|Nhiệm vụ|QUY TẮC|Trả về|YÊU CẦU NGƯỜI DÙNG|bắt buộc|hợp lệ)/;
  const bad = lines.filter((l) => viRe.test(l));
  assert.deepEqual(bad, [], 'còn chỉ thị tiếng Việt gửi tới model');
  // nhưng enum của app PHẢI giữ nguyên literal
  assert.match(src, /"Ngang" \(landscape/, 'enum ratio phải được giải thích mà vẫn giữ literal');
  assert.match(src, /do NOT translate them/, 'phải dặn model đừng dịch enum');
});
