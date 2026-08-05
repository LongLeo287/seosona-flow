// SportPreset — bộ hợp prompt 4 lớp (chương 12 của đặc tả Sports Image).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const scope = {};
new Function('self', 'window', readFileSync(join(root, 'src/sports-image/SportPreset.js'), 'utf8'))(scope, scope);
const SP = scope.SEOSONA_SportPreset;

test('positive: hợp đủ 4 lớp đúng thứ tự A → B → C → D', () => {
  const r = SP.resolve('badminton.v1', { node: 'edit only the hand', user: 'slightly warmer light' });
  assert.deepEqual(r.layers, ['A_policy', 'B_preset', 'C_node', 'D_user']);
  const iA = r.positive.indexOf('source-preserving sports photo editing engine');
  const iB = r.positive.indexOf('indoor badminton action photography');
  const iC = r.positive.indexOf('edit only the hand');
  const iD = r.positive.indexOf('slightly warmer light');
  assert.ok(iA >= 0 && iA < iB && iB < iC && iC < iD, 'thứ tự lớp phải giữ nguyên');
});

test('positive: không có lớp C/D thì chỉ còn A + B, không chèn dòng rỗng', () => {
  const r = SP.resolve('badminton.v1');
  assert.deepEqual(r.layers, ['A_policy', 'B_preset']);
  assert.ok(!/\n\n\n/.test(r.positive), 'không được có khoảng trống thừa');
});

test('positive: thay biến {{...}} trong lớp C', () => {
  const r = SP.resolve('badminton.v1', {
    node: 'scope={{edit_scope}} attrs={{equipment_attributes}} vec={{motion_vector}}',
    vars: { edit_scope: 'hand+racket', equipment_attributes: 'carbon frame', motion_vector: 'up-right' },
  });
  assert.match(r.positive, /scope=hand\+racket/);
  assert.match(r.positive, /attrs=carbon frame/);
  assert.match(r.positive, /vec=up-right/);
  assert.ok(!/\{\{/.test(r.positive), 'không còn biến chưa thay');
});

test('boundary: biến thiếu giá trị thì GIỮ NGUYÊN, không thay bằng rỗng', () => {
  const r = SP.resolve('badminton.v1', { node: 'a={{co}} b={{khong_co}}', vars: { co: 'X' } });
  assert.match(r.positive, /a=X/);
  assert.match(r.positive, /b=\{\{khong_co\}\}/,
    'để nguyên thì người đọc thấy ngay là thiếu; thay bằng rỗng là giấu lỗi');
});

// Đây là điểm quan trọng nhất: lệnh người dùng KHÔNG được phá chính sách giữ nguồn.
test('negative: lệnh người dùng phá policy thì bị BỎ và nói ra', () => {
  for (const bad of [
    'regenerate the whole image nicely',
    'give her a new face',
    'apply a beauty filter',
    'vẽ lại toàn bộ ảnh cho đẹp',
    'thay mặt bằng người khác',
  ]) {
    const r = SP.resolve('badminton.v1', { user: bad });
    assert.equal(r.userInstructionRejected, true, `phải chặn: ${bad}`);
    assert.ok(!r.layers.includes('D_user'), 'lớp D bị bỏ hẳn');
    assert.ok(r.rejectedReasons.length > 0, 'phải nêu lý do, không im lặng');
  }
});

test('negative: lệnh người dùng bình thường KHÔNG bị chặn oan', () => {
  for (const ok of [
    'slightly brighter court lighting',
    'làm rõ nét mặt vợt hơn một chút',
    'keep motion blur a bit shorter',
  ]) {
    const r = SP.resolve('badminton.v1', { user: ok });
    assert.equal(r.userInstructionRejected, false, `không được chặn: ${ok}`);
    assert.ok(r.layers.includes('D_user'));
  }
});

test('regression: prompt phủ định luôn có, kể cả khi không truyền gì', () => {
  const r = SP.resolve('badminton.v1');
  assert.match(r.negative, /duplicate racket/);
  assert.match(r.negative, /duplicate shuttlecock/);
  assert.match(r.negative, /text, watermark/);
  assert.match(r.negative, /new person/);
});

test('regression: băm prompt tất định và đổi khi nội dung đổi', () => {
  const a = SP.resolve('badminton.v1', { user: 'x' });
  const b = SP.resolve('badminton.v1', { user: 'x' });
  const c = SP.resolve('badminton.v1', { user: 'y' });
  assert.equal(a.promptHash, b.promptHash, 'cùng đầu vào → cùng băm');
  assert.notEqual(a.promptHash, c.promptHash, 'đổi lệnh → đổi băm');
});

test('regression: preset mang đủ ngưỡng và bố cục cho validator', () => {
  const p = SP.get('badminton.v1');
  assert.equal(p.thresholds.identityDistance, 0.08);
  assert.equal(p.thresholds.outsideDriftRatio, 0.015);
  assert.equal(p.thresholds.minWidth, 4320);
  assert.equal(p.thresholds.minHeight, 7680);
  assert.equal(p.composition.aspect, '9:16');
  assert.deepEqual(p.composition.headroom, [0.18, 0.22]);
  for (const layer of ['face', 'hand', 'racket', 'shuttle', 'border']) {
    assert.ok(p.maskLayers.includes(layer), `thiếu lớp mask ${layer}`);
  }
});

test('boundary: preset lạ thì ném rõ ràng', () => {
  assert.throws(() => SP.resolve('khong_co.v1'), /không có preset/);
  assert.equal(SP.get('khong_co.v1'), null);
});

test('regression: đăng ký môn mới không phải sửa module', () => {
  SP.register('tennis.v1', { sport: 'tennis', version: 'v1', prompt: 'Sport: tennis.' });
  assert.ok(SP.list().includes('tennis.v1'));
  const r = SP.resolve('tennis.v1');
  assert.match(r.positive, /Sport: tennis/);
  assert.match(r.positive, /source-preserving/, 'lớp A vẫn áp cho môn mới');
});
