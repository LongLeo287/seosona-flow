#!/usr/bin/env node
/**
 * SEOSONA Flow — Workflow Framework · CLI
 * ------------------------------------------------------------------
 * Cầu dòng lệnh cho Skill/script (deterministic, offline). Lệnh:
 *
 *   node cli.js list-types
 *   node cli.js describe <type>
 *   node cli.js validate <template.json | bundled>        # 'bundled' = 14 template thật
 *   node cli.js create <spec.json>                        # spec → template + validate
 *   node cli.js clone  <bundled|file.json> <id> [--name="..."] [--model="..."] [--ratio="..."]
 *   node cli.js organize <templates.json>                 # dedupe + node_count + sort
 *
 * Mọi lệnh in JSON ra stdout (máy đọc được), tóm tắt ra stderr.
 */
const fs = require('fs');
const path = require('path');
const V = require('./validate.js');
const O = require('./operations.js');

const BUNDLED = 'D:/SEOSONA AI/SEOSONA Workflow/seosona-flow/src/workflow/BundledTemplates.js';

function loadBundled() {
  let s = fs.readFileSync(BUNDLED, 'utf8').replace(/^window\.BUNDLED_TEMPLATES\s*=\s*/, '');
  // BundledTemplates.js có IIFE ở cuối file, bên trong chứa nhiều dấu ']' → lastIndexOf(']') cắt
  // nhầm vào IIFE làm JSON.parse chết. Neo theo dấu kết mảng '\n];'.
  return JSON.parse(s.slice(s.indexOf('['), s.lastIndexOf('\n];') + 2));
}
function loadJson(p) {
  if (p === 'bundled') return loadBundled();
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
function arg(flag) { const a = process.argv.find(x => x.startsWith('--' + flag + '=')); return a ? a.slice(flag.length + 3) : null; }
function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }
function err(s) { process.stderr.write(s + '\n'); }

const cmd = process.argv[2];
try {
  if (cmd === 'list-types') {
    const list = O.listNodeTypes();
    out(list);
    err(`✅ ${list.length} node type`);
  } else if (cmd === 'describe') {
    const d = O.describeNodeType(process.argv[3]);
    if (!d) { err('❌ type không tồn tại: ' + process.argv[3]); process.exit(1); }
    out(d);
  } else if (cmd === 'validate') {
    const target = process.argv[3];
    if (target === 'bundled') {
      const arr = loadBundled(); let pass = 0; const rows = [];
      for (const t of arr) { const r = V.validateWorkflow(t); if (r.ok) pass++; rows.push({ id: t.id, name: t.name, ok: r.ok, errors: r.errors.length, warnings: r.warnings.length }); }
      out({ total: arr.length, pass, rows });
      err(`${pass}/${arr.length} PASS`);
      process.exit(pass === arr.length ? 0 : 1);
    } else {
      const tpl = loadJson(target); const r = V.validateWorkflow(tpl);
      out(r);
      err(r.ok ? `✅ VALID (${r.warnings.length} warning)` : `❌ ${r.errors.length} error`);
      process.exit(r.ok ? 0 : 1);
    }
  } else if (cmd === 'create') {
    const spec = loadJson(process.argv[3]);
    const { template, validation } = O.createWorkflow(spec);
    out({ template, validation });
    err(validation.ok ? `✅ tạo OK (${validation.stats.nodes} node, ${validation.stats.levels} level)` : `❌ ${validation.errors.length} error`);
    process.exit(validation.ok ? 0 : 1);
  } else if (cmd === 'clone') {
    const arr = loadJson(process.argv[3]);
    const id = process.argv[4];
    const src = (Array.isArray(arr) ? arr : [arr]).find(t => String(t.id) === String(id));
    if (!src) { err('❌ không thấy template id=' + id); process.exit(1); }
    const nodePatch = {}; if (arg('model')) nodePatch.model = arg('model'); if (arg('ratio')) nodePatch.ratio = arg('ratio'); if (arg('quantity')) nodePatch.quantity = parseInt(arg('quantity'), 10);
    const { template, validation } = O.cloneTemplate(src, { name: arg('name') || (src.name + ' (clone)'), nodePatch: Object.keys(nodePatch).length ? nodePatch : null });
    out({ template, validation });
    err(validation.ok ? `✅ clone OK → "${template.name}"` : `❌ ${validation.errors.length} error`);
    process.exit(validation.ok ? 0 : 1);
  } else if (cmd === 'organize') {
    const arr = loadJson(process.argv[3]);
    const org = O.organizeLibrary(arr);
    out(org);
    err(`✅ ${arr.length} → ${org.length} sau dedupe`);
  } else {
    err('Lệnh: list-types | describe <type> | validate <file|bundled> | create <spec.json> | clone <file|bundled> <id> [--name=][--model=][--ratio=] | organize <file>');
    process.exit(2);
  }
} catch (e) {
  err('❌ Lỗi: ' + e.message);
  process.exit(1);
}
