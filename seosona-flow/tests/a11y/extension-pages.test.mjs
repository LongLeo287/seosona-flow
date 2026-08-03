// P8.T2 tests — static accessibility linter + baseline.
// positive/negative/boundary/regression across: landmarks, labels, roles,
// contrast(tokens), errors, and screen-reader names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { build, findings } from '../../scripts/quality/check-a11y.mjs';

const ROOT = repoRoot();

test('positive: the linter runs across all extension pages', () => {
  const r = build();
  assert.ok(r.pages >= 8);
  assert.ok('byRule' in r);
});

test('negative: linter flags a missing alt / label / lang', () => {
  const bad = '<html><body><img src="x.png"><input type="text" id="q"><button></button></body></html>';
  const f = findings(bad, 'x.html');
  assert.ok(f.some((x) => x.rule === 'html-lang'));
  assert.ok(f.some((x) => x.rule === 'img-alt'));
  assert.ok(f.some((x) => x.rule === 'control-label'));
  assert.ok(f.some((x) => x.rule === 'control-name'));
});

test('positive: a well-formed fragment produces no findings', () => {
  const good = '<html lang="en"><body><main><h1>Hi</h1><img src="x.png" alt="a cat">' +
    '<label for="q">Search</label><input type="text" id="q">' +
    '<button aria-label="Close"></button></main></body></html>';
  assert.deepEqual([...findings(good, 'g.html')], []);
});

test('boundary: aria-hidden img and labelled control are accepted', () => {
  const frag = '<html lang="en"><main><img src="i.svg" aria-hidden="true">' +
    '<input id="n" aria-label="Name"></main></html>';
  assert.deepEqual([...findings(frag, 'b.html')], []);
});

test('regression: the a11y baseline artifact reconciles (ratchet)', () => {
  const r = build();
  const onDisk = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/artifacts/ux/phase-08/a11y-report.json'), 'utf8'));
  assert.equal(r.total, onDisk.total, 'no undocumented a11y regressions');
  assert.deepEqual(r.byRule, onDisk.byRule);
});
