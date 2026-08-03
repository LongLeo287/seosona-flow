// P1.T7 tests — positive, negative, boundary, regression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { AUD, SEC, UNKNOWNS, FACTS } from '../../scripts/audit/lib/issues-data.mjs';

const root = repoRoot();
const issues = JSON.parse(readFileSync(join(root, 'seosona-flow/artifacts/audit/issues.json'), 'utf8'));
const byId = new Map(issues.findings.map((i) => [i.id, i]));
const roadmap = readFileSync(join(root, 'docs/superpowers/plans/2026-07-15-seosona-flow-10-phase-roadmap.md'), 'utf8');

test('positive: registry contains all 32 AUD and 4 SEC findings', () => {
  assert.equal(issues.counts.aud, 32);
  assert.equal(issues.counts.sec, 4);
  for (const i of [...AUD, ...SEC]) assert.ok(byId.has(i.id), `${i.id} present`);
});

test('positive: every roadmap-referenced issue exists in the registry', () => {
  const refs = new Set(roadmap.match(/\b(?:AUD|SEC)-\d{3}\b/g) || []);
  assert.ok(refs.size >= 30, 'roadmap references many issues');
  const missing = [...refs].filter((r) => !byId.has(r));
  assert.deepEqual(missing, [], `every referenced issue is registered; missing=${missing.join(',')}`);
});

test('positive: every finding is fully classified', () => {
  for (const i of issues.findings) {
    assert.match(i.id, /^(AUD|SEC)-\d{3}$/);
    assert.ok(['Critical', 'High', 'Medium', 'Low'].includes(i.severity));
    assert.ok(i.family.length > 0);
    assert.ok(Number.isInteger(i.targetPhase) && i.targetPhase >= 1 && i.targetPhase <= 10);
    assert.ok(i.owner.length > 0);
    assert.ok(i.closureCriteria.includes(i.id));
    assert.equal(i.kind, 'finding');
  }
});

test('boundary: facts, findings, and unknowns are separated', () => {
  assert.equal(issues.facts.length, FACTS.length);
  assert.equal(issues.unknowns.length, UNKNOWNS.length);
  // ids are disjoint across the three kinds
  const factIds = new Set(issues.facts.map((f) => f.id));
  const unkIds = new Set(issues.unknowns.map((u) => u.id));
  for (const i of issues.findings) {
    assert.ok(!factIds.has(i.id) && !unkIds.has(i.id));
  }
});

test('boundary: unknowns reference sealed-report findings and a phase owner', () => {
  for (const u of issues.unknowns) {
    assert.match(u.relatedFinding, /^FIND-\d{3}$/);
    assert.ok(u.owner && u.owner.length > 0);
    assert.ok(u.question.endsWith('?'));
  }
});

test('negative: an unreferenced fake issue is absent', () => {
  assert.equal(byId.has('AUD-999'), false);
});

test('positive: SEC findings carry related sealed-report findings', () => {
  for (const s of issues.findings.filter((i) => i.id.startsWith('SEC-'))) {
    assert.ok(s.relatedFindings.length >= 1);
    for (const f of s.relatedFindings) assert.match(f, /^FIND-\d{3}$/);
  }
});

test('regression: markdown registry is in sync with the data source', () => {
  const md = readFileSync(join(root, 'docs/audits/issue-registry.md'), 'utf8');
  for (const i of issues.findings) assert.ok(md.includes(i.id), `md lists ${i.id}`);
  for (const f of issues.facts) assert.ok(md.includes(f.id));
});
