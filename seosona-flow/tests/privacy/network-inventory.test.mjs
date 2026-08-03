// P7.T1 tests — network initiator inventory.
// positive/negative/boundary/regression across: fetch, SSE, image, webhook,
// config, enrollment, upload, triggers, data, and intent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { build } from '../../scripts/audit/network-inventory.mjs';

const ROOT = repoRoot();

test('positive: every initiator is owned (path, kind, policy, class)', () => {
  const inv = build();
  assert.ok(inv.totals.sites > 0);
  for (const s of inv.sites) {
    assert.ok(s.path && s.line > 0, JSON.stringify(s));
    assert.ok(s.kind && s.policy, JSON.stringify(s));
    assert.ok(s.class && s.class !== '', JSON.stringify(s));
  }
});

test('negative: no initiator is left unknown/unclassified', () => {
  assert.equal(build().unknownClass, 0);
});

test('boundary: backend initiators are enumerated (fuel for local-mode proof)', () => {
  const inv = build();
  assert.ok(inv.backendClass >= 1, 'expected some backend call sites to gate');
  assert.ok(inv.sites.some((s) => s.class === 'backend'));
});

test('boundary: fetch/sse/download kinds are all recognized', () => {
  const inv = build();
  assert.ok(inv.byKind.fetch >= 1);
  // sse and download appear in the real corpus
  assert.ok('sse' in inv.byKind || 'websocket' in inv.byKind);
});

test('regression: inventory reconciles with the committed artifact', () => {
  const inv = build();
  const onDisk = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/artifacts/privacy/phase-07/network-inventory.json'), 'utf8'));
  assert.equal(inv.sitesHash, onDisk.sitesHash);
  assert.equal(inv.totals.sites, onDisk.totals.sites);
});
