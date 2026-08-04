#!/usr/bin/env node
// SF-003 — cổng chặn `fetch` TRẦN trong service worker.
//
// Vì sao cần: NetworkPolicy có sẵn redirect thủ công, chặn địa chỉ nội bộ, timeout và trần kích
// thước — nhưng nó chỉ bảo vệ được những đường ĐI QUA nó. background.js còn nhiều chỗ gọi thẳng
// `fetch()` sau một lần kiểm sơ bộ, nên:
//   · redirect công khai thoát khỏi policy đã kiểm lúc đầu,
//   · phản hồi lớn không bị chặn → phình bộ nhớ, service worker chết,
//   · `wm:fetchImage` chỉ kiểm 'http(s)' rồi tải thẳng, yếu hơn hẳn các đường khác.
// Cổng kiểm hiện tại chứng minh NetworkPolicy tồn tại, chưa chứng minh MỌI nơi đều dùng nó.
//
// Cách làm: đếm số `fetch(` trần trong background.js và giữ trần đó không tăng (ratchet). Mỗi
// lần chuyển một chỗ sang NetworkService.fetchSafe() thì hạ trần xuống. Không đặt mục tiêu 0
// ngay vì phải chuyển từng đường một và kiểm thủ công — nhưng KHÔNG được phép thêm mới.
//
// Chạy: node scripts/security/scan-raw-fetch.mjs [--update]
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../audit/lib/repo.mjs';

const root = join(repoRoot(), 'seosona-flow');
const BASELINE = join(root, 'config/raw-fetch-baseline.json');
const TARGETS = ['background.js'];

// `fetch(` đứng sau await/=/return/( — bỏ qua chú thích và chuỗi trong comment.
const RAW_FETCH = /(?<![.\w])fetch\s*\(/g;

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function scan() {
  const out = {};
  for (const rel of TARGETS) {
    const src = stripComments(readFileSync(join(root, rel), 'utf8'));
    const hits = [...src.matchAll(RAW_FETCH)];
    // NetworkService.fetchSafe / fetchSafe( là đường AN TOÀN — không tính.
    const raw = hits.filter((h) => {
      const before = src.slice(Math.max(0, h.index - 30), h.index);
      return !/fetchSafe\s*$|NetworkService\.\s*$/.test(before);
    });
    out[rel] = raw.length;
  }
  return out;
}

const current = scan();
const update = process.argv.includes('--update');

if (update || !existsSync(BASELINE)) {
  writeFileSync(BASELINE, `${JSON.stringify({
    _note: 'SF-003 — trần số fetch() trần trong service worker. CHỈ được giảm. Giảm bằng cách chuyển sang NetworkService.fetchSafe().',
    counts: current,
  }, null, 2)}\n`);
  console.log(`[raw-fetch] ghi baseline: ${JSON.stringify(current)}`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8')).counts;
let bad = false;
for (const [rel, n] of Object.entries(current)) {
  const limit = base[rel] ?? 0;
  if (n > limit) {
    console.error(`[raw-fetch] ${rel}: ${n} fetch() trần, trần cho phép ${limit} — ĐỪNG thêm fetch mới, dùng NetworkService.fetchSafe().`);
    bad = true;
  } else if (n < limit) {
    console.log(`[raw-fetch] ${rel}: ${n} (giảm từ ${limit}) — chạy --update để chốt mức mới.`);
  }
}
if (bad) process.exit(1);
console.log(`[raw-fetch] OK ${JSON.stringify(current)} — không tăng so với trần.`);
