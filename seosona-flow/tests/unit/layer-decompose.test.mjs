// LayerDecompose — MỘT ảnh có sẵn → NHIỀU lớp PNG, tự động.
//
// Khác LayerPrompt (gen từng vật rời rồi ghép). Ở đây đầu vào là ảnh ĐÃ CÓ nhiều thứ bên trong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const scope = {};
new Function('self', 'window', readFileSync(join(root, 'src/layers/LayerDecompose.js'), 'utf8'))(scope, scope);
const LD = scope.SEOSONA_LayerDecompose;

test('positive: prompt liệt kê bắt trả JSON và xếp theo độ sâu', () => {
  const p = LD.listObjectsPrompt();
  assert.match(p, /ONLY a JSON array/);
  assert.match(p, /FARTHEST to NEAREST/, 'thứ tự chồng phải đúng ngay từ đầu');
  assert.match(p, /occluded/, 'phải hỏi vật nào bị che — đó là vật cần vẽ bù');
  assert.match(p, /Do not invent objects/, 'chặn mô hình bịa thêm vật');
});

test('positive: đọc được JSON sạch', () => {
  const r = LD.parseObjects('[{"id":"court","label":"court floor","depth":0},{"id":"racket","label":"badminton racket","depth":2,"occluded":true}]');
  assert.equal(r.ok, true);
  assert.equal(r.objects.length, 2);
  assert.equal(r.objects[0].id, 'court');
  assert.equal(r.objects[1].occluded, true);
});

// Mô hình gần như luôn bọc code fence dù đã dặn đừng.
test('regression: đọc được cả khi mô hình bọc ```json và thêm chữ thừa', () => {
  const raw = 'Sure, here you go:\n```json\n[{"id":"a","label":"A","depth":1}]\n```\nHope that helps!';
  const r = LD.parseObjects(raw);
  assert.equal(r.ok, true);
  assert.equal(r.objects.length, 1);
  assert.equal(r.objects[0].id, 'a');
});

test('negative: trả lời không phải JSON → báo lý do, không ném', () => {
  for (const [txt, reason] of [['xin chào', 'NO_JSON_ARRAY'], ['[không phải json', 'NO_JSON_ARRAY'], ['[{bad}]', 'BAD_JSON'], ['[]', 'EMPTY']]) {
    const r = LD.parseObjects(txt);
    assert.equal(r.ok, false, txt);
    assert.equal(r.reason, reason, `${txt} → ${r.reason}`);
    assert.deepEqual(r.objects, []);
  }
});

test('boundary: id trùng hoặc rỗng vẫn ra id dùng được, không đè nhau', () => {
  const r = LD.parseObjects('[{"label":"Cây Vợt!","depth":0},{"id":"cay_vot","label":"x","depth":1},{"id":"cay_vot","label":"y","depth":2}]');
  const ids = r.objects.map((o) => o.id);
  assert.equal(new Set(ids).size, ids.length, `id phải duy nhất, đang có ${ids}`);
  for (const id of ids) assert.match(id, /^[a-z0-9_]+$/, `id phải dùng được làm tên file: ${id}`);
});

test('boundary: sắp xếp lại theo depth dù mô hình trả lộn xộn', () => {
  const r = LD.parseObjects('[{"id":"c","label":"C","depth":5},{"id":"a","label":"A","depth":0},{"id":"b","label":"B","depth":2}]');
  assert.deepEqual(r.objects.map((o) => o.id), ['a', 'b', 'c']);
});

// Chỗ khó nhất: bắt mô hình GIỮ NGUYÊN vật, đừng vẽ cái mới đẹp hơn.
test('positive: prompt tách nhấn mạnh GIỮ NGUYÊN, không thiết kế lại', () => {
  const p = LD.extractPrompt({ id: 'racket', label: 'badminton racket', depth: 2 });
  assert.match(p.positive, /ONLY the badminton racket/);
  assert.match(p.positive, /same shape, same colours/);
  assert.match(p.positive, /same camera angle, same lighting/);
  assert.match(p.positive, /Do not redesign it/);
  assert.match(p.negative, /no style change/);
  assert.match(p.negative, /no other objects from the reference/);
});

// Đây chính là việc canvas KHÔNG làm được — phải nhờ mô hình.
test('positive: vật bị che thì YÊU CẦU vẽ bù phần khuất', () => {
  const hidden = LD.extractPrompt({ id: 'x', label: 'a shuttlecock', depth: 3, occluded: true });
  assert.match(hidden.positive, /draw the complete object/);
  assert.match(hidden.positive, /reconstructing the hidden part/);

  const visible = LD.extractPrompt({ id: 'y', label: 'a racket', depth: 1, occluded: false });
  assert.ok(!/reconstructing the hidden part/.test(visible.positive),
    'vật không bị che thì đừng bảo nó bịa thêm');
});

test('boundary: nền lạ hoặc thiếu mô tả thì ném rõ ràng', () => {
  assert.throws(() => LD.extractPrompt({ id: 'a', label: 'x' }, { backdrop: 'vang' }), /nền không hỗ trợ/);
  assert.throws(() => LD.extractPrompt({ id: 'a' }), /thiếu mô tả vật/);
});

// Mỗi lớp tốn một lượt gen — người dùng phải biết TRƯỚC khi bấm chạy.
test('regression: kế hoạch nói rõ chi phí và giới hạn', () => {
  const objs = LD.parseObjects('[{"id":"a","label":"A","depth":0},{"id":"b","label":"B","depth":1},{"id":"c","label":"C","depth":2}]').objects;
  const pl = LD.plan(objs);
  assert.equal(pl.layerCount, 3);
  assert.equal(pl.generations, 3, 'mỗi lớp một lượt gen');
  assert.ok(pl.notes.some((n) => /MỘT lượt gen/.test(n)), 'phải nói chi phí');
  assert.ok(pl.notes.some((n) => /KHÔNG khớp pixel/.test(n)),
    'phải nói thẳng: mô hình vẽ lại chứ không cắt ra');
  assert.ok(pl.notes.some((n) => /vẽ bù phần khuất/.test(n)),
    'phần bị che là mô hình suy ra, không phải dữ liệu thật');
});

test('boundary: không có vật nào thì ném, không trả kế hoạch rỗng', () => {
  assert.throws(() => LD.plan([]), /chưa có vật nào/);
  assert.throws(() => LD.plan(null), /chưa có vật nào/);
});
