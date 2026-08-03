// VietnameseLint tests — Vietnamese naturalness/translationese linter (port of vietnamese-humanizer ideas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = join(dirname(fileURLToPath(import.meta.url)), '../..');
const src = readFileSync(join(PKG, 'src/core/VietnameseLint.js'), 'utf8');
const root = {};
new Function('self', src)(root);
const VL = root.VietnameseLint;

const ids = (t) => VL.check(t).map((f) => f.id);
const has = (t, id) => ids(t).includes(id);

test('typography: space before punctuation + double space', () => {
  assert.ok(has('xin chào , bạn', 'space-before-punct'));
  assert.ok(has('a  b', 'double-space'));
});

test('calque "nó là quan trọng"', () => {
  assert.ok(has('nó là quan trọng vì nhiều lý do', 'calque-no-la'));
});

test('vague reference "Điều này" at sentence start', () => {
  assert.ok(has('Điều này rất hay', 'vague-dieu-nay'));
  // mid-sentence lowercase reference is NOT flagged (avoid noise)
  assert.ok(!has('Tôi đồng ý với điều này', 'vague-dieu-nay'));
});

test('double modal "có thể được"', () => {
  assert.ok(has('công việc có thể được hoàn thành', 'double-modal'));
});

test('wordiness: một cách / bởi vì / thực hiện việc', () => {
  assert.ok(has('chạy một cách nhanh chóng', 'mot-cach'));
  assert.ok(has('bởi vì trời mưa', 'boi-vi'));
  assert.ok(has('thực hiện việc kiểm tra', 'redundant-viec'));
});

test('filler opener + redundant conjunction', () => {
  assert.ok(has('Nói chung là mọi thứ ổn', 'filler-opener'));
  assert.ok(has('nhanh và cũng rẻ', 'redundant-conj'));
});

test('weasel words → heuristic', () => {
  assert.ok(has('các chuyên gia cho rằng điều đó đúng', 'weasel-experts'));
  assert.ok(has('nghiên cứu cho thấy hiệu quả', 'weasel-studies'));
});

test('clean Vietnamese → no findings', () => {
  assert.deepEqual(VL.check('Hôm nay trời đẹp, tôi đi học rồi về nhà nấu cơm.'), []);
});

test('count + summary', () => {
  const f = VL.check('Nói chung là nó là quan trọng , bởi vì vậy.');
  const c = VL.count(f);
  assert.ok(c.error + c.warning + c.preference + c.heuristic === f.length);
  assert.ok(VL.summary(f).length > 0);
  assert.equal(VL.summary([]), 'Sạch — tiếng Việt tự nhiên.');
});
