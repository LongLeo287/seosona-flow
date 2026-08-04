// Thẻ công thức cú máy — 40 thẻ trong kho prompt đóng gói.
// Lược đồ thẻ (dùng-khi · năng lượng · thời lượng · hay-hỏng) học từ Vincentwei1021/video-shotcraft;
// NỘI DUNG là của ta — repo đó chứa công thức motion-design Remotion, không phải cú máy điện ảnh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');

function loadPack() {
  const src = readFileSync(join(root, 'src/prompts/BundledPrompts.js'), 'utf8');
  const scope = {};
  new Function('self', 'window', src)(scope, scope);
  return scope;
}

const pack = loadPack();
const ALL = pack.SEOSONA_BUNDLED_PROMPTS;
const SHOTS = ALL.filter((p) => p.category === '🎬 Shot Recipes');

const ENERGY = ['Lặng', 'Vừa', 'Mạnh'];
const GROUPS = ['mo-man', 'chu-the', 'boc-lo', 'chi-tiet', 'phan-ung',
  'bam-theo', 'chuyen-canh', 'cao-trao', 'khong-khi', 'ket'];

test('positive: 40 thẻ, phủ đủ 10 nhóm chức năng', () => {
  assert.equal(SHOTS.length, 40);
  const seen = new Set(SHOTS.map((p) => p.tags[1]));
  assert.deepEqual([...seen].sort(), [...GROUPS].sort());
  // Mỗi nhóm 4 thẻ — cân đối, không dồn hết vào một nhóm dễ viết.
  for (const g of GROUPS) {
    assert.equal(SHOTS.filter((p) => p.tags[1] === g).length, 4, `nhóm ${g} có 4 thẻ`);
  }
});

test('positive: mọi thẻ có đủ 4 trường hướng dẫn', () => {
  for (const p of SHOTS) {
    assert.ok(p.card, `${p.id} có card`);
    assert.ok(p.card.purpose && p.card.purpose.length > 20, `${p.id} có purpose thực chất`);
    assert.ok(ENERGY.includes(p.card.energy), `${p.id} energy hợp lệ: ${p.card.energy}`);
    assert.match(p.card.duration, /^\d+–\d+s$/, `${p.id} duration dạng "4–6s"`);
    assert.ok(p.card.pitfall && p.card.pitfall.length > 20, `${p.id} có pitfall thực chất`);
  }
});

// Đây là điểm dễ hỏng nhất: 4 trường kia là chỉ dẫn cho NGƯỜI, nếu lọt vào `content` thì
// chúng bị gửi thẳng cho model và làm bẩn prompt.
test('negative: hướng dẫn không lọt vào prompt gửi cho model', () => {
  for (const p of SHOTS) {
    assert.ok(!p.content.includes('Dùng khi'), `${p.id} content sạch`);
    assert.ok(!p.content.includes(p.card.pitfall), `${p.id} không nhét pitfall vào content`);
    assert.ok(!/[À-ỹ]/.test(p.content), `${p.id} content là tiếng Anh (model-facing)`);
  }
});

test('boundary: mọi thẻ có ít nhất 1 biến {slot} và cấm chữ trên hình', () => {
  for (const p of SHOTS) {
    // Cùng lớp ký tự với extractVars() của kho — {subjectA} phải đếm được, không chỉ {subject}.
    assert.ok(pack.normalizeBundledPrompt(p).variables.length > 0, `${p.id} có placeholder`);
    assert.ok(p.content.includes('no on-screen text') || p.content.includes('No on-screen text'),
      `${p.id} cấm chữ/logo — đúng nguyên tắc "AI làm pixel, không làm chữ"`);
  }
});

test('regression: id không đụng phần còn lại của kho', () => {
  assert.equal(new Set(ALL.map((p) => p.id)).size, ALL.length);
  for (const p of SHOTS) assert.match(p.id, /^sr_/);
});

test('regression: normalizeBundledPrompt giữ nguyên thẻ khi copy sang My Prompts', () => {
  const out = pack.normalizeBundledPrompt(SHOTS[0]);
  assert.deepEqual(out.card, SHOTS[0].card);
  // prompt thường không có card thì không được mọc ra khoá rác
  const plain = ALL.find((p) => !p.card);
  assert.equal(pack.normalizeBundledPrompt(plain).card, undefined);
});
