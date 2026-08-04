// Đồng bộ SECRET_KEYS trong src/core/SecretVault.js theo config/sensitive-keys.json.
// Có script này vì hai nơi đã lệch nhau CẢ HAI CHIỀU (SF-018): vault biết vài khoá inventory
// không đánh dấu, và ngược lại. Khoá lọt khỏi một trong hai nghĩa là có chỗ nó không được che
// khi ghi log, hoặc bị xuất ra file backup.
// Chạy: node scripts/build/sync-secret-keys.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../audit/lib/repo.mjs';

const root = join(repoRoot(), 'seosona-flow');
const cfg = JSON.parse(readFileSync(join(root, 'config/sensitive-keys.json'), 'utf8'));
const keys = [...cfg.keys].sort();

// Xuống dòng mỗi 4 khoá cho dễ đọc, giữ thụt lề 4 dấu cách như bản gốc.
const lines = [];
for (let i = 0; i < keys.length; i += 4) {
  lines.push('    ' + keys.slice(i, i + 4).map((k) => `'${k}'`).join(', ') + ',');
}
const literal = '[\n' + lines.join('\n') + '\n  ]';

const vaultPath = join(root, 'src/core/SecretVault.js');
const src = readFileSync(vaultPath, 'utf8');
const re = /(var SECRET_KEYS = )\[[\s\S]*?\];/;
if (!re.test(src)) {
  console.error('[sync-secret-keys] không tìm thấy khai báo SECRET_KEYS');
  process.exit(1);
}
const next = src.replace(re, `$1${literal};`);

if (process.argv.includes('--check')) {
  if (next !== src) {
    console.error(`[sync-secret-keys] LỆCH: SecretVault không khớp config (${keys.length} khoá).`);
    process.exit(1);
  }
  console.log(`[sync-secret-keys] OK ${keys.length} khoá khớp config.`);
} else {
  writeFileSync(vaultPath, next);
  console.log(`[sync-secret-keys] đã ghi ${keys.length} khoá vào SecretVault.js`);
}
