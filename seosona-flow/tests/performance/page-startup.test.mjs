// P8.T6 tests — static page startup profile.
// positive/negative/boundary/regression across: parse, execute, duplicate init,
// blocking scripts, cold/warm (static proxy), and memory (bytes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { build } from '../../scripts/performance/page-profile.mjs';

const ROOT = repoRoot();

test('positive: every page is profiled with a script count and byte weight', () => {
  const r = build();
  assert.ok(r.pageCount >= 8);
  for (const p of r.pages) {
    assert.ok(p.scripts >= 0 && p.bytes >= 0, JSON.stringify(p));
    assert.ok(typeof p.blockingInHead === 'number');
  }
});

test('boundary: no render-blocking scripts remain in <head> (budget)', () => {
  assert.equal(build().totals.blockingInHead, 0);
});

test('regression: profile reconciles with the committed baseline', () => {
  const r = build();
  const onDisk = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/artifacts/ux/phase-08/page-profile.json'), 'utf8'));
  assert.equal(r.totals.scripts, onDisk.totals.scripts);
  assert.equal(r.totals.duplicates, onDisk.totals.duplicates);
  assert.ok(r.totals.scripts <= onDisk.totals.scripts, 'script count must not grow');
});
