// SF-015/SF-016/SF-012 — tính toàn vẹn của kho template và schema node.
// Đây là loại drift âm thầm: không cổng nào đỏ, chỉ người dùng thấy category kỳ quặc hoặc
// một template không bao giờ tra ra được vì trùng slug.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (f) => readFileSync(join(root, f), 'utf8');

function loadTemplates() {
  const scope = {};
  // Nuốt log của module — nó in "Appended N template(s)" mỗi lần nạp.
  const realLog = console.log;
  console.log = () => {};
  try {
    for (const f of ['src/workflow/BundledTemplates.js', 'src/workflow/BundledWorkflowsExtra.js']) {
      new Function('self', 'window', read(f))(scope, scope);
    }
  } finally { console.log = realLog; }
  return scope.BUNDLED_TEMPLATES || [];
}

const T = loadTemplates();

test('positive: kho template nạp được và có đủ số lượng', () => {
  assert.ok(T.length >= 91, `phải có ít nhất 91 template, đang có ${T.length}`);
  for (const t of T) {
    assert.ok(t.id != null, 'template nào cũng phải có id');
    assert.ok(t.name, `template ${t.id} phải có tên`);
  }
});

// Slug dùng để tra cứu — trùng nghĩa là một trong hai bản không bao giờ được chọn tới.
test('negative: KHÔNG có slug trùng', () => {
  const seen = new Map();
  const dup = [];
  for (const t of T) {
    if (!t.slug) continue;
    if (seen.has(t.slug)) dup.push(`${t.slug} (id ${seen.get(t.slug)} & ${t.id})`);
    else seen.set(t.slug, t.id);
  }
  assert.deepEqual(dup, [], `slug trùng: ${dup.join(', ')}`);
});

// Đã xảy ra thật: META ghi sẵn 'Video — Thiên nhiên' rồi code nối thêm 'Video — ' lần nữa.
test('negative: category không lặp tiền tố', () => {
  const bad = T
    .filter((t) => /^(.+?)\s*—\s*\1\s*—/.test(String(t.category?.name || '')))
    .map((t) => `${t.id}: ${t.category.name}`);
  assert.deepEqual(bad, [], `category lặp tiền tố: ${bad.join(' | ')}`);
});

test('boundary: id không trùng nhau', () => {
  const ids = T.map((t) => String(t.id));
  assert.equal(new Set(ids).size, ids.length, 'id template phải là duy nhất');
});

// SF-016 — schema từng viết tay 6 type trong khi catalog runtime có 26. Node lạ chỉ warning nên
// workflow vẫn chạy, nhưng validator kêu với gần như mọi workflow thật → cảnh báo mất giá trị.
test('regression: KNOWN_NODE_TYPES khớp node-catalog', () => {
  const catalog = JSON.parse(read('src/workflow/framework/node-catalog.json'));
  const types = Object.keys(catalog.nodes || catalog).sort();
  const schema = read('src/workflow/WorkflowSchema.js');
  const m = schema.match(/var KNOWN_NODE_TYPES = \[([^\]]*)\];/);
  assert.ok(m, 'tìm được khai báo KNOWN_NODE_TYPES');
  const declared = m[1].split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean).sort();
  assert.deepEqual(declared, types, 'schema phải khớp catalog — chạy scripts/build/sync-node-types.mjs');
  assert.ok(types.length >= 26, `catalog phải có ít nhất 26 type, đang có ${types.length}`);
});

// SF-022 + phát hiện kèm theo: hai type chết đã gỡ, còn 'merge' thì SỐNG và phải hiện ra.
test('regression: type chết đã gỡ, node merge KHÔNG bị giấu khỏi picker', () => {
  const nt = read('src/workflow/NodeTemplates.js');
  assert.ok(!/^\s*transform: \{ name: 'Transform'/m.test(nt), 'transform đã gỡ');
  assert.ok(!/^\s*output: \{ name: 'Output'/m.test(nt), 'output đã gỡ');

  const picker = read('src/workflow/WorkflowEditorPickers.js');
  assert.ok(!/\.filter\(\(\[key\]\) => !\['transform', 'merge', 'output'\]/.test(picker),
    'không còn lọc gộp cả merge');
  const catalog = JSON.parse(read('src/workflow/framework/node-catalog.json'));
  assert.ok(Object.keys(catalog.nodes || catalog).includes('merge'),
    'merge có trong catalog — nên nó phải thêm được từ giao diện');
});

// SF-012 — artifact từng trình bày số Phase-01 như hiện trạng.
test('regression: issue registry tách baseline khỏi số hiện tại', () => {
  const j = JSON.parse(read('artifacts/audit/issues.json'));
  assert.ok(j.baselineNote, 'có ghi chú nói rõ facts là baseline');
  assert.ok(j.currentSnapshot, 'có khối số đo lại');
  assert.ok(j.currentSnapshot.trackedFiles > 1000, 'số hiện tại là thật, không phải 232 của baseline');
  for (const f of j.facts) assert.equal(f.kind, 'baseline-fact', `${f.id} được gắn nhãn baseline`);
});
