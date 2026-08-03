// P8.T8 tests — visual matrix config + UX disposition matrix.
// positive/negative/boundary/regression across: sidebar widths, popups,
// scaling, locales, dynamic states, diffs, and retention (disposition).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { build, validateConfig } from '../../scripts/quality/check-visual-matrix.mjs';

const ROOT = repoRoot();
const cfg = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/config/visual-matrix.json'), 'utf8'));

test('positive: the visual matrix config is well-formed', () => {
  assert.deepEqual([...validateConfig(cfg)], []);
  assert.ok(cfg.viewports.length >= 2);
  assert.ok(cfg.criticalFlows.length >= 3);
});

test('boundary: sidebar narrow + wide + popup viewports are covered', () => {
  const ids = cfg.viewports.map((v) => v.id);
  for (const need of ['sidebar-narrow', 'sidebar-wide', 'popup']) assert.ok(ids.includes(need), need);
});

test('negative: validateConfig rejects a missing flow page', () => {
  const broken = { viewports: [{ id: 'a', width: 1, height: 1 }, { id: 'b', width: 2, height: 2 }], criticalFlows: [{ id: 'x', page: 'pages/does-not-exist.html', root: 'body' }] };
  assert.ok(validateConfig(broken).some((p) => /missing/.test(p)));
});

test('capability: every UX dimension has a disposition and none fail', () => {
  const r = build();
  assert.equal(r.tally.fail || 0, 0);
  for (const row of r.rows) assert.ok(['pass', 'deferred', 'fail'].includes(row.disposition));
});

test('regression: UX matrix reconciles with the committed artifact', () => {
  const r = build();
  const onDisk = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/artifacts/ux/phase-08/ux-matrix.json'), 'utf8'));
  assert.equal(r.rows.length, onDisk.rows.length);
  assert.deepEqual(r.tally, onDisk.tally);
});
