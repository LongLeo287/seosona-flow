// ProviderCapability + AccountPlan — nguồn sự thật năng lực provider & nhận diện gói tài khoản.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(join(PKG, p), 'utf8');
const load = (files) => { const g = {}; files.forEach((f) => new Function('self', read(f))(g)); return g; };

const { ProviderCapability: PC } = load(['src/core/ProviderCapability.js']);
const { AccountPlan: AP } = load(['src/core/AccountPlan.js']);

// ── Ma trận năng lực: khớp THỰC TẾ code, không theo cảm tính ──────────────
test('Flow: gen được cả ảnh lẫn video', () => {
  assert.equal(PC.can('flow', 'gen_image'), true);
  assert.equal(PC.can('flow', 'gen_video'), true);
});

test('ChatGPT: gen ảnh + làm prompt, KHÔNG video', () => {
  assert.equal(PC.can('chatgpt', 'gen_image'), true);
  assert.equal(PC.can('chatgpt', 'prompt'), true);
  assert.equal(PC.can('chatgpt', 'gen_video'), false);
});

test('⭐ Gemini KHÔNG gen ảnh — chỉ làm prompt (đính chính nhận thức sai phổ biến)', () => {
  assert.equal(PC.can('gemini', 'gen_image'), false);
  assert.equal(PC.can('gemini', 'gen_video'), false);
  assert.equal(PC.can('gemini', 'prompt'), true);
});

test('Claude: chỉ làm prompt', () => {
  assert.equal(PC.can('claude', 'prompt'), true);
  assert.equal(PC.can('claude', 'gen_image'), false);
});

test('⭐ Grok gen ảnh/video ĐÒI trả phí (đúng lỗi thật trong log user)', () => {
  assert.equal(PC.can('grok', 'gen_image'), true);
  assert.equal(PC.needsPaid('grok', 'gen_image'), true);
  assert.equal(PC.needsPaid('grok', 'gen_video'), true);
  // Flow/ChatGPT gen ảnh KHÔNG đòi trả phí
  assert.equal(PC.needsPaid('flow', 'gen_image'), false);
  assert.equal(PC.needsPaid('chatgpt', 'gen_image'), false);
});

test('providersFor: ưu tiên provider KHÔNG cần trả phí lên trước (free trước)', () => {
  const list = PC.providersFor('gen_image');
  assert.ok(list.includes('flow') && list.includes('chatgpt') && list.includes('grok'));
  assert.ok(list.indexOf('grok') === list.length - 1, 'grok (đòi trả phí) phải xếp cuối');
  assert.deepEqual(PC.providersFor('gen_video').slice(0, 1), ['flow']);
});

test('check: chặn khi biết chắc tài khoản chưa trả phí, KHÔNG chặn khi chưa rõ', () => {
  assert.deepEqual(PC.check('grok', 'gen_image', { paid: false }), { ok: false, reason: 'PAID_REQUIRED', paidRequired: true });
  assert.equal(PC.check('grok', 'gen_image', { paid: true }).ok, true);
  assert.equal(PC.check('grok', 'gen_image', null).ok, true, 'chưa biết gói thì không tự chặn oan');
  assert.equal(PC.check('gemini', 'gen_image').reason, 'NOT_SUPPORTED');
  assert.equal(PC.check('khongcó', 'gen_image').reason, 'UNKNOWN_PROVIDER');
});

// ── AccountPlan: credit Flow ───────────────────────────────────────────────
test('⭐ không tìm thấy khối credit → nói THẲNG là chưa biết, kèm cách vá (không bịa số)', () => {
  // Không selector VÀ quét chữ cũng không ra ⇒ một mã lý do duy nhất: NOT_FOUND.
  const r = AP.detectFlowCredits({ querySelector: () => null });
  assert.equal(r.known, false);
  assert.equal(r.reason, 'NOT_FOUND');
  assert.match(r.hint, /SelectorOverride\.set/);
  assert.equal(r.credits, undefined, 'tuyệt đối không được bịa số credit');
});

test('⭐ BẮT THEO CHỮ: đọc được credit dù KHÔNG có selector (class Flow đổi hash mỗi lần build)', () => {
  const mk = (texts) => ({
    querySelector: () => null,
    querySelectorAll: () => texts.map((t) => ({ textContent: t })),
  });
  const a = AP.detectFlowCredits(mk(['Leo Long', '60 Tín dụng Google Flow', 'Đăng xuất']));
  assert.equal(a.known, true);
  assert.equal(a.credits, 60);
  assert.equal(a.via, 'text', 'phải nhận qua đường quét chữ, không cần selector');

  const b = AP.detectFlowCredits(mk(['1,250 Google Flow credits']));
  assert.equal(b.credits, 1250, 'bản tiếng Anh + dấu phẩy');

  const c = AP.detectFlowCredits(mk(['Mua tín dụng AI', 'Quản lý gói thành viên']));
  assert.equal(c.known, false, 'có chữ "tín dụng" nhưng KHÔNG có số → không được đoán');
});

test('đọc được credit từ DOM khi có selector', () => {
  const g = load(['src/core/SelectorOverride.js', 'src/core/AccountPlan.js']);
  // giả lập bản vá nóng trỏ tới khối credit
  g.SelectorOverride._cache().flow = { flow_credit_display: ['.credits'] };
  const doc = { querySelector: (s) => (s === '.credits' ? { textContent: 'Còn 1,250 credit' } : null) };
  const r = g.AccountPlan.detectFlowCredits(doc);
  assert.equal(r.known, true);
  assert.equal(r.credits, 1250, 'phải bóc đúng số có dấu phẩy');
});

test('có selector nhưng không có số → known:false (không đoán bừa)', () => {
  const g = load(['src/core/SelectorOverride.js', 'src/core/AccountPlan.js']);
  g.SelectorOverride._cache().flow = { flow_credit_display: ['.c'] };
  const r = g.AccountPlan.detectFlowCredits({ querySelector: () => ({ textContent: 'Không giới hạn' }) });
  assert.equal(r.known, false);
  assert.equal(r.reason, 'NOT_FOUND', 'selector trúng nhưng không có số → vẫn coi như chưa biết');
  assert.equal(r.credits, undefined, 'không được bịa số');
});

test('estimateVideos: tính đúng, trả null khi thiếu dữ liệu', () => {
  assert.equal(AP.estimateVideos(1000, 100), 10);
  assert.equal(AP.estimateVideos(950, 100), 9, 'phải làm tròn XUỐNG');
  assert.equal(AP.estimateVideos(null, 100), null);
  assert.equal(AP.estimateVideos(1000, 0), null, 'chia 0 phải trả null');
});

// ── AccountPlan: suy gói từ nội dung trang ────────────────────────────────
test('⭐ Grok hiện lời mời Premium → kết luận tài khoản CHƯA trả phí', () => {
  const r = AP.detectFromText('grok', 'Unlock your creativity with Imagine', { subscription_required_text: 'unlock your creativity with imagine|subscribe to' });
  assert.equal(r.known, true);
  assert.equal(r.paid, false);
  assert.equal(r.reason, 'SUBSCRIPTION_PROMPT');
});

test('chưa đăng nhập được ưu tiên báo trước tình trạng gói', () => {
  const r = AP.detectFromText('grok', 'Please sign in to continue', { not_logged_in_text: 'sign in|đăng nhập', subscription_required_text: 'subscribe to' });
  assert.equal(r.loggedIn, false);
  assert.equal(r.reason, 'NOT_LOGGED_IN');
});

test('ChatGPT: thông báo chạm hạn mức có tên gói → suy ra đang dùng Plus', () => {
  const r = AP.detectFromText('chatgpt', "you've hit the plus plan limit", {});
  assert.equal(r.paid, true);
  assert.equal(r.plan, 'plus');
});

test('không có tín hiệu → known:false (không kết luận bừa)', () => {
  assert.equal(AP.detectFromText('grok', 'trang bình thường', {}).known, false);
  assert.equal(AP.detectFromText('grok', '', {}).known, false);
});

test('matrix: liệt kê đủ 5 provider kèm ghi chú', () => {
  const m = PC.matrix();
  assert.equal(m.length, 5);
  m.forEach((p) => { assert.ok(p.label && p.note, 'thiếu nhãn/ghi chú: ' + p.provider); });
});
