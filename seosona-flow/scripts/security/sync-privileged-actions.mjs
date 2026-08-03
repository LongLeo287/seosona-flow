#!/usr/bin/env node
// Sinh lại KNOWN_ACTIONS của PrivilegedActionRegistry TỪ BẰNG CHỨNG.
//
// Nguồn sự thật duy nhất: artifacts/audit/phase-01/message-contracts.json (những
// action THỰC SỰ có handler). File registry đã ghi "Do not hand-edit the list;
// regenerate from evidence" nhưng trước giờ không có script sinh — nên nó trôi
// mỗi khi thêm/bớt handler, và chỉ vỡ ra khi chạy tier test:integration.
//
//   node scripts/security/sync-privileged-actions.mjs          # ghi lại
//   node scripts/security/sync-privileged-actions.mjs --check  # chỉ báo lệch (CI)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../audit/lib/repo.mjs';

const ROOT = repoRoot();
const CONTRACTS = join(ROOT, 'seosona-flow/artifacts/audit/phase-01/message-contracts.json');
const REGISTRY = join(ROOT, 'seosona-flow/src/core/PrivilegedActionRegistry.js');
const PER_LINE = 4;

function expected() {
  const c = JSON.parse(readFileSync(CONTRACTS, 'utf8'));
  return [...new Set(c.registry.filter((r) => r.handled).map((r) => r.action))].sort();
}

function render(actions) {
  const rows = [];
  for (let i = 0; i < actions.length; i += PER_LINE) {
    rows.push('    ' + actions.slice(i, i + PER_LINE).map((a) => JSON.stringify(a)).join(', ') + ',');
  }
  return '  var KNOWN_ACTIONS = [\n' + rows.join('\n') + '\n  ];';
}

const src = readFileSync(REGISTRY, 'utf8');
const start = src.indexOf('  var KNOWN_ACTIONS = [');
if (start < 0) { console.error('[privileged-actions] không tìm thấy khối KNOWN_ACTIONS'); process.exit(1); }
const end = src.indexOf('\n  ];', start);
if (end < 0) { console.error('[privileged-actions] khối KNOWN_ACTIONS không có dấu đóng'); process.exit(1); }

const actions = expected();
const next = src.slice(0, start) + render(actions) + src.slice(end + '\n  ];'.length);

if (process.argv.includes('--check')) {
  if (next !== src) {
    console.error(`[privileged-actions] DRIFT — chạy \`node scripts/security/sync-privileged-actions.mjs\` (${actions.length} action theo bằng chứng)`);
    process.exit(1);
  }
  console.log(`[privileged-actions] OK ${actions.length} action khớp bằng chứng.`);
} else {
  writeFileSync(REGISTRY, next);
  console.log(`[privileged-actions] wrote ${actions.length} action từ message-contracts.json`);
}
