// Đồng bộ KNOWN_NODE_TYPES trong WorkflowSchema.js theo node-catalog.json.
// Có script này vì hai nơi đã lệch nhau: schema viết tay 6 type, catalog runtime 26 type (SF-016).
// Chạy: node scripts/build/sync-node-types.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../audit/lib/repo.mjs';

const root = join(repoRoot(), 'seosona-flow');
const catalog = JSON.parse(readFileSync(join(root, 'src/workflow/framework/node-catalog.json'), 'utf8'));
const types = Object.keys(catalog.nodes || catalog).sort();
const literal = '[' + types.map((t) => `'${t}'`).join(', ') + ']';

const schemaPath = join(root, 'src/workflow/WorkflowSchema.js');
const src = readFileSync(schemaPath, 'utf8');
const re = /(var KNOWN_NODE_TYPES = )\[[^\]]*\];/;
if (!re.test(src)) {
  console.error('[sync-node-types] không tìm thấy khai báo KNOWN_NODE_TYPES');
  process.exit(1);
}
const next = src.replace(re, `$1${literal};`);

if (process.argv.includes('--check')) {
  if (next !== src) {
    console.error(`[sync-node-types] LỆCH: schema không khớp catalog (${types.length} type).`);
    process.exit(1);
  }
  console.log(`[sync-node-types] OK ${types.length} type khớp catalog.`);
} else {
  writeFileSync(schemaPath, next);
  console.log(`[sync-node-types] đã ghi ${types.length} type vào WorkflowSchema.js`);
}
