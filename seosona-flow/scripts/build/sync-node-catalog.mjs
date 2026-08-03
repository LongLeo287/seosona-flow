#!/usr/bin/env node
// Sinh node-catalog.json TỪ NodeTemplates.js — nguồn sự thật duy nhất về node type.
//
// VÌ SAO: catalog trước đây viết tay nên trôi theo CẢ HAI CHIỀU và không ai biết:
//   - thiếu loop / switch / text_export → node CHẠY ĐƯỢC nhưng framework từ chối validate;
//   - thừa transform / output → workflow chứa chúng QUA được validate rồi mới hỏng lúc chạy
//     (executor không có dispatch nên chúng rơi vào nhánh GENERATE và bị gửi đi như node gen).
// Đúng bài học của sync-privileged-actions.mjs: cái gì suy ra được thì đừng chép tay.
//
//   node scripts/build/sync-node-catalog.mjs          # ghi lại
//   node scripts/build/sync-node-catalog.mjs --check  # chỉ báo lệch (dùng trong gate)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { repoRoot } from '../audit/lib/repo.mjs';

const ROOT = repoRoot();
const NT_PATH = join(ROOT, 'seosona-flow/src/workflow/NodeTemplates.js');
const EX_PATH = join(ROOT, 'seosona-flow/src/core/WorkflowExecutor.js');
const OUT = join(ROOT, 'seosona-flow/src/workflow/framework/node-catalog.json');

function loadTypes() {
  const sb = { console: { log() {}, warn() {}, error() {} } };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  sb.document = { createElement: () => ({ style: {} }), addEventListener() {} };
  vm.createContext(sb);
  vm.runInContext(readFileSync(NT_PATH, 'utf8'), sb, { timeout: 20000 });
  if (!sb.NodeTemplates?.types) throw new Error('không đọc được NodeTemplates.types');
  return sb.NodeTemplates.types;
}

/** Node type nào executor thực sự chạy được. Không có dispatch = chưa cài đặt. */
function dispatched() {
  const src = readFileSync(EX_PATH, 'utf8');
  return new Set([...src.matchAll(/node\.node_type === '([a-z_]+)'/g)].map((m) => m[1]));
}

function portOut(p) { return { name: p.name, type: p.type }; }
function portIn(p) {
  return {
    name: p.name,
    type: p.type,
    required: !!p.required,
    multiple: !!p.multiple,
    visibleWhen: p.visibleWhen || null,
    acceptFromNodeTypes: p.acceptFromNodeTypes || null,
  };
}

function build() {
  const types = loadTypes();
  const canRun = dispatched();
  const out = {};
  const skipped = [];
  for (const key of Object.keys(types).sort()) {
    // CHỈ đưa vào catalog node executor chạy được. Node khai mà chưa cài đặt thì để
    // ngoài, để validate BẮT được workflow dùng chúng thay vì cho qua rồi hỏng lúc chạy.
    if (!canRun.has(key)) { skipped.push(key); continue; }
    const c = types[key];
    out[key] = {
      name: c.name,
      color: c.color,
      inputs: c.inputs,
      outputs: c.outputs,
      portType: c.portType,
      ports_in: (c.ports?.in || []).map(portIn),
      ports_out: (c.ports?.out || []).map(portOut),
    };
  }
  return { out, skipped };
}

const { out, skipped } = build();
const json = JSON.stringify(out, null, 2) + '\n';

if (process.argv.includes('--check')) {
  let cur = null;
  try { cur = readFileSync(OUT, 'utf8'); } catch { /* chưa có */ }
  if (cur !== json) {
    console.error('[node-catalog] DRIFT — chạy `node scripts/build/sync-node-catalog.mjs`'
      + ` (${Object.keys(out).length} node type theo NodeTemplates + executor)`);
    process.exit(1);
  }
  console.log(`[node-catalog] OK ${Object.keys(out).length} node type khớp NodeTemplates.`
    + (skipped.length ? ` Bỏ qua (khai mà chưa có dispatch): ${skipped.join(', ')}` : ''));
} else {
  writeFileSync(OUT, json);
  console.log(`[node-catalog] wrote ${Object.keys(out).length} node type.`
    + (skipped.length ? ` Bỏ qua (khai mà chưa có dispatch): ${skipped.join(', ')}` : ''));
}
