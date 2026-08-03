// Bản ĐÓNG GÓI phải chứa mọi tài nguyên mà code trỏ tới.
//
// Bối cảnh: package.mjs chọn file theo `git ls-files` + config/package-allowlist.json.
// Hai lỗ hổng cùng lúc từng khiến gói thiếu TOÀN BỘ thumbnail template mà không gate
// nào kêu: (1) 46 ảnh được template trỏ tới nằm ngoài git; (2) `seosona-flow/assets/`
// không có trong includePrefixes nên kể cả 20 ảnh đã tracked cũng bị loại.
// check:html không bắt được vì nó chỉ soi resource khai báo trong HTML/manifest,
// còn thumbnail thì nằm trong CHUỖI dữ liệu của BundledTemplates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { repoRoot, trackedFiles } from '../../scripts/audit/lib/repo.mjs';

const root = repoRoot();
const MANIFEST = 'seosona-flow/artifacts/release/phase-09/package-manifest.json';
const ASSET_RE = /assets\/[A-Za-z0-9_\-/]+\.(?:png|jpg|jpeg|svg|webp|gif)/g;

// Quét chuỗi CHƯA ĐỦ: BundledWorkflowsExtra.js ghép đường dẫn bằng biến
//   thumbnail_url: "../../assets/templates/thumb_" + id + ".png"
// nên regex không thấy 42 ảnh của template id 1001–1042 — đúng cái bẫy làm chúng bị
// xếp nhầm là "mồ côi". Vì vậy nạp THẬT hai file template rồi đọc thumbnail_url đã
// giải ra, cộng thêm quét chuỗi cho các asset nằm ở HTML/CSS/nơi khác.
function templateThumbnails() {
  const sb = { console };
  sb.window = sb; sb.self = sb; sb.BUNDLED_TEMPLATES = [];
  vm.createContext(sb);
  for (const f of ['BundledTemplates.js', 'BundledWorkflowsExtra.js']) {
    vm.runInContext(readFileSync(join(root, 'seosona-flow/src/workflow', f), 'utf8'), sb, { timeout: 30000 });
  }
  const out = new Set();
  for (const t of sb.BUNDLED_TEMPLATES || []) {
    if (t && typeof t.thumbnail_url === 'string') out.add(t.thumbnail_url.replace(/^(\.\.\/)+/, ''));
  }
  return out;
}

/** Mọi đường dẫn assets/... xuất hiện trong code/dữ liệu tracked. */
function referencedAssets() {
  const refs = templateThumbnails();
  for (const rel of trackedFiles(root)) {
    if (!/^seosona-flow\/.*\.(js|json|html|css)$/.test(rel)) continue;
    if (rel.startsWith('seosona-flow/lib/')) continue;
    let text;
    try { text = readFileSync(join(root, rel), 'utf8'); } catch { continue; }
    for (const m of text.match(ASSET_RE) || []) refs.add(m);
  }
  return refs;
}

const refs = referencedAssets();
const manifest = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8'));
const packaged = new Set(manifest.files.map((f) => f.path));

test('positive: có tài nguyên assets được tham chiếu (bộ dò không rỗng)', () => {
  assert.ok(refs.size > 0, 'không quét ra tham chiếu nào — bộ dò hỏng');
});

test('boundary: bắt được cả thumbnail ghép chuỗi (id 1001–1042), không chỉ literal', () => {
  // Nếu ai đó thay cách nạp template mà bộ dò runtime hỏng, test này gãy trước khi
  // 42 ảnh lặng lẽ rơi khỏi bản đóng gói.
  for (const id of [1001, 1020, 1042]) {
    assert.ok(refs.has(`assets/templates/thumb_${id}.png`), `mất tham chiếu thumb_${id}`);
  }
});

test('regression: mọi ảnh assets được tham chiếu đều nằm trong bản đóng gói', () => {
  const missing = [...refs].filter((r) => !packaged.has(r)).sort();
  assert.deepEqual(missing, [], `gói thiếu ${missing.length} ảnh: ${missing.slice(0, 8).join(', ')}`);
});

test('regression: mọi ảnh assets được tham chiếu đều có trong git', () => {
  const tracked = new Set(trackedFiles(root));
  const untracked = [...refs].filter((r) => !tracked.has('seosona-flow/' + r)).sort();
  assert.deepEqual(untracked, [], `chưa git add ${untracked.length} ảnh: ${untracked.slice(0, 8).join(', ')}`);
});

test('boundary: allowlist đóng gói vẫn khai báo thư mục assets', () => {
  const cfg = JSON.parse(readFileSync(join(root, 'seosona-flow/config/package-allowlist.json'), 'utf8'));
  assert.ok(cfg.includePrefixes.includes('seosona-flow/assets/'), 'gỡ prefix này là gói mất sạch ảnh');
});
