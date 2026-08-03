// PromptLint tests — visual-slop detector (skill anti-slop-visual, eval.md cases).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(join(PKG, 'src/core/PromptLint.js'), 'utf8');
const root = {};
new Function('self', src)(root);
const PL = root.PromptLint;

const terms = (t) => PL.check(t).map((f) => f.term.toLowerCase());
const hasTerm = (t, needle) => terms(t).some((x) => x.includes(needle.toLowerCase()));

test('case 1 — english hype tokens flagged', () => {
  const p = 'a beautiful woman, 8k, masterpiece, hyper-detailed, trending on artstation';
  for (const n of ['beautiful', '8k', 'masterpiece', 'hyper-detailed', 'trending on artstation']) {
    assert.ok(hasTerm(p, n), `should flag ${n}`);
  }
});

test('case 2 — stunning/cinematic/highly-detailed/photorealistic', () => {
  const p = 'stunning landscape, cinematic lighting, highly detailed, photorealistic';
  for (const n of ['stunning', 'cinematic lighting', 'highly detailed', 'photorealistic']) {
    assert.ok(hasTerm(p, n), `should flag ${n}`);
  }
});

test('case 3 — perfect face / flawless skin / ultra realistic / best quality', () => {
  const p = 'perfect face, flawless skin, ultra realistic, best quality';
  for (const n of ['perfect face', 'flawless skin', 'ultra realistic', 'best quality']) {
    assert.ok(hasTerm(p, n), `should flag ${n}`);
  }
});

test('case 4 — Vietnamese slop tells', () => {
  const p = 'chân dung tuyệt đẹp, 4k, siêu chi tiết';
  assert.ok(hasTerm(p, 'tuyệt đẹp'));
  assert.ok(hasTerm(p, '4k'));
  assert.ok(hasTerm(p, 'siêu chi tiết'));
});

test('case 5 — concrete photographic prompt is CLEAN', () => {
  const p = 'chân dung studio, ống 85mm f/1.8, 1 đèn key mềm + rim light viền tóc, da có lỗ chân lông, nền xám seamless, 9:16';
  assert.deepEqual(PL.check(p), [], 'concrete prompt must have zero findings');
  assert.equal(PL.isClean(p), true);
});

test('case 6 — anchored style + negative guard is CLEAN', () => {
  const p = 'tranh gouache trên giấy ráp, 2 nhân vật, bảng màu đất, KHÔNG bóng nhựa';
  assert.deepEqual(PL.check(p), []);
});

test('no false positive: "chi tiết ren tay áo" (concrete) not flagged', () => {
  assert.equal(PL.isClean('cận cảnh chi tiết ren tay áo, cúc ngọc trai'), true);
});

test('summary reads for humans', () => {
  const f = PL.check('8k masterpiece');
  assert.ok(PL.summary(f).includes('slop'));
  assert.equal(PL.summary([]), 'Sạch — không thấy cụm slop.');
});
