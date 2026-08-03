// P5.T1 tests — workflow schema (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';

const root = repoRoot();
const WS = loadClassic('src/workflow/WorkflowSchema.js').SEOSONA_WorkflowSchema;
const fixDir = join(root, 'seosona-flow/tests/fixtures/workflows');
const load = (f) => JSON.parse(readFileSync(join(fixDir, f), 'utf8'));

test('positive: valid corpus files pass with no error', () => {
  for (const f of ['valid-minimal.json', 'valid-connected.json', 'valid-unknown-type.json']) {
    const r = WS.validate(load(f));
    assert.equal(r.valid, true, `${f}: ${JSON.stringify(r.issues)}`);
  }
});

test('positive: unknown node type is advisory, not fatal', () => {
  const r = WS.validate(load('valid-unknown-type.json'));
  assert.equal(r.valid, true);
  assert.ok(r.issues.some((i) => i.code === 'UNKNOWN_NODE_TYPE' && i.severity === 'warn'));
});

test('negative: missing name fails with stable path', () => {
  const r = WS.validate(load('invalid-missing-name.json'));
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.path === 'name' && i.code === 'MISSING_NAME'));
});

test('negative: dangling edge target fails with indexed path', () => {
  const r = WS.validate(load('invalid-dangling-edge.json'));
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.path === 'edges[0].target' && i.code === 'DANGLING_TARGET'));
});

test('negative: duplicate node id fails', () => {
  const r = WS.validate(load('invalid-dup-node.json'));
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.code === 'DUPLICATE_NODE_ID'));
});

test('boundary: prototype-pollution and oversize are rejected', () => {
  const evil = JSON.parse('{"name":"x","nodes":[],"__proto__":{"a":1}}');
  assert.ok(WS.validate(evil).issues.some((i) => i.code === 'DANGEROUS_KEY'));
  const big = { name: 'x', nodes: Array.from({ length: 501 }, (_, i) => ({ id: 'n' + i, type: 'image' })) };
  assert.ok(WS.validate(big).issues.some((i) => i.code === 'TOO_MANY_NODES'));
});

test('boundary: real bundled templates validate (spot check)', () => {
  // The bundled template corpus is authored data; every entry must be structurally valid.
  const src = readFileSync(join(root, 'seosona-flow/src/workflow/BundledTemplates.js'), 'utf8');
  const jsonStart = src.indexOf('[');
  // BundledTemplates.js has a trailing IIFE (normalizeBundledTemplateTags) that itself contains 9
  // "]" chars, so lastIndexOf(']') lands inside the IIFE and JSON.parse chokes on trailing code.
  // Anchor on the array terminator "\n];" instead.
  const arrEnd = src.lastIndexOf('\n];');
  const arr = JSON.parse(src.slice(jsonStart, arrEnd + 2));
  let checked = 0;
  for (const wf of arr.slice(0, 5)) {
    const r = WS.validate(wf);
    assert.equal(r.errorCount, 0, `${wf.name}: ${JSON.stringify(r.issues.filter((i) => i.severity === 'error'))}`);
    checked++;
  }
  assert.ok(checked >= 1, 'at least one bundled template checked');
});

test('regression: every corpus file has a deterministic validity receipt', () => {
  // valid-/invalid- fixtures assert directly; legacy-* are migration inputs
  // (validated only after WorkflowMigrator) and are excluded here.
  const files = readdirSync(fixDir).filter((f) => f.endsWith('.json') && /^(valid|invalid)-/.test(f));
  for (const f of files) {
    const a = WS.validate(load(f));
    const b = WS.validate(load(f));
    assert.equal(a.valid, b.valid);
    assert.equal(a.valid, !f.startsWith('invalid-'), `${f} receipt matches its name`);
  }
});
