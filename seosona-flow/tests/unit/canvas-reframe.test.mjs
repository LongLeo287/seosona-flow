// CanvasReframe — quy tắc bố cục §11, toán thuần, không cần canvas thật.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const scope = {};
for (const f of ['src/sports-image/CanvasReframe.js', 'src/sports-image/SportPreset.js']) {
  new Function('self', 'window', readFileSync(join(root, f), 'utf8'))(scope, scope);
}
const CR = scope.SEOSONA_CanvasReframe;
const COMP = scope.SEOSONA_SportPreset.get('badminton.v1').composition;

test('positive: khung ra đúng tỉ lệ 9:16', () => {
  const p = CR.plan({ width: 4000, height: 3000 }, { x: 1600, y: 900, width: 700, height: 1500 }, COMP);
  const r = p.output.width / p.output.height;
  assert.ok(Math.abs(r - 9 / 16) < 0.01, `tỉ lệ ra ${r.toFixed(3)}, cần 0.563`);
});

test('positive: chủ thể nằm đúng dải chừa đầu / chừa sàn', () => {
  const subject = { x: 1600, y: 900, width: 700, height: 1500 };
  const p = CR.plan({ width: 4000, height: 3000 }, subject, COMP);
  const c = CR.check(p, subject, COMP);
  assert.ok(c.headroomOk, `chừa đầu ${(c.headroom * 100).toFixed(1)}% ngoài dải 18-22%`);
  assert.ok(c.floorOk, `chừa sàn ${(c.floorMargin * 100).toFixed(1)}% ngoài dải 10-14%`);
});

test('positive: ảnh đủ rộng thì KHÔNG cần mở rộng khung', () => {
  const p = CR.plan({ width: 6000, height: 8000 }, { x: 2500, y: 2000, width: 800, height: 3000 }, COMP);
  assert.equal(p.needsOutpaint, false);
  assert.deepEqual(p.border, { left: 0, top: 0, right: 0, bottom: 0 });
  assert.deepEqual(p.paste, { x: 0, y: 0 });
});

// Ảnh ngang mà đích là dọc → chắc chắn thiếu chiều cao.
test('negative: ảnh ngang → phải báo cần mở rộng, KHÔNG bịa pixel', () => {
  const p = CR.plan({ width: 4000, height: 1200 }, { x: 1800, y: 200, width: 400, height: 900 }, COMP);
  assert.equal(p.needsOutpaint, true);
  const total = p.border.left + p.border.top + p.border.right + p.border.bottom;
  assert.ok(total > 0, 'phải nêu rõ thiếu bao nhiêu ở phía nào');
  assert.ok(p.crop.width <= 4000 && p.crop.height <= 1200, 'vùng đọc không vượt ảnh gốc');
});

test('boundary: chủ thể sát mép trái → thiếu bên trái, không âm toạ độ', () => {
  const p = CR.plan({ width: 3000, height: 4000 }, { x: 10, y: 500, width: 600, height: 2000 }, COMP);
  assert.ok(p.border.left > 0, 'phải thiếu bên trái');
  assert.ok(p.crop.x >= 0 && p.crop.y >= 0, 'toạ độ đọc không được âm');
});

test('boundary: chừa đầu + chừa sàn ăn hết khung thì ném rõ ràng', () => {
  assert.throws(
    () => CR.plan({ width: 100, height: 100 }, { x: 0, y: 0, width: 10, height: 10 },
      { aspect: '9:16', headroom: [0.6, 0.6], floorMargin: [0.4, 0.4] }),
    /ăn hết khung/);
});

test('boundary: đầu vào hỏng thì ném, không trả kế hoạch rác', () => {
  assert.throws(() => CR.plan(null, { height: 1 }, COMP), /ảnh không hợp lệ/);
  assert.throws(() => CR.plan({ width: 10, height: 10 }, null, COMP), /hộp chủ thể/);
  assert.throws(() => CR.plan({ width: 10, height: 10 }, { height: 5 }, { aspect: 'xx' }), /tỉ lệ/);
});

// Thiếu mask viền thì mọi ảnh mở rộng khung đều bị chấm "trôi quá ngưỡng" dù không sai gì.
test('regression: mask viền đánh dấu ĐÚNG phần mở rộng, 0 ở phần ảnh thật', () => {
  const p = CR.plan({ width: 4000, height: 1200 }, { x: 1800, y: 200, width: 400, height: 900 }, COMP);
  const m = CR.borderMask(p);
  assert.equal(m.width, p.output.width);
  assert.equal(m.height, p.output.height);

  // giữa vùng dán phải là 0 (ảnh thật)
  const cx = p.paste.x + Math.floor(p.crop.width / 2);
  const cy = p.paste.y + Math.floor(p.crop.height / 2);
  assert.equal(m.data[cy * m.width + cx], 0, 'giữa ảnh thật không phải viền');

  // góc trên-trái ngoài vùng dán phải là 255
  if (p.paste.y > 0) assert.equal(m.data[0], 255, 'phần mở rộng phải được đánh dấu');

  let border = 0;
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) border++;
  assert.ok(border > 0 && border < m.data.length, 'không phải toàn viền cũng không phải không có viền');
});

test('regression: preset badminton dùng đúng dải đặc tả nêu', () => {
  assert.deepEqual(COMP.headroom, [0.18, 0.22]);
  assert.deepEqual(COMP.floorMargin, [0.10, 0.14]);
  assert.deepEqual(COMP.bodyCenterX, [0.44, 0.48]);
  assert.equal(COMP.aspect, '9:16');
});
