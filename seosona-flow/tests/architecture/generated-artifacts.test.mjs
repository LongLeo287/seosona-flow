// P4.T8 tests — generated-artifact reproducibility (positive, negative, boundary, regression).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';

const root = repoRoot();
const cwd = join(root, 'seosona-flow');
const registry = JSON.parse(readFileSync(join(root, 'seosona-flow/config/generated-artifacts.json'), 'utf8'));

test('positive: every reproducible entry declares a source and generator', () => {
  assert.ok(registry.reproducible.length >= 3);
  for (const e of registry.reproducible) {
    assert.ok(e.artifact && e.generator && e.checkCommand && e.source, `${e.artifact} complete`);
    assert.match(e.checkCommand, /--check/);
  }
});

test('positive: each reproducible artifact byte-reproduces (--check passes)', () => {
  for (const e of registry.reproducible) {
    const [cmd, ...args] = e.checkCommand.split(' ');
    const res = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
    assert.equal(res.status, 0, `${e.artifact} reproduces: ${res.stderr}`);
  }
});

test('boundary: deferrals are explicit and owned', () => {
  for (const d of registry.deferred) {
    assert.ok(d.reason && d.owner && d.risk && d.reviewTrigger, `${d.artifact} deferral is owned`);
  }
});

test('regression: the build:generated gate passes', () => {
  const res = spawnSync('node', ['scripts/build/check-generated.mjs', '--check'], { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
});
