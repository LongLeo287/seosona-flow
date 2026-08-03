// P2.T2 tests — positive, negative, boundary, regression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import {
  trackedExtFiles,
  checkSyntax,
  checkJson,
  checkHtmlResources,
} from '../../scripts/quality/lib/static-checks.mjs';

const root = repoRoot();
const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'quality');

test('positive: all tracked JS passes node --check', async () => {
  const files = trackedExtFiles(root, ['.js', '.mjs']);
  assert.ok(files.length >= 100, 'many tracked JS files');
  const failures = await checkSyntax(files);
  assert.deepEqual(failures, [], `unexpected syntax failures: ${JSON.stringify(failures)}`);
});

test('positive: all tracked JSON parses', () => {
  const files = trackedExtFiles(root, ['.json']);
  assert.ok(files.length >= 3);
  assert.deepEqual(checkJson(files), []);
});

test('positive: every declared HTML/manifest resource exists', () => {
  assert.deepEqual(checkHtmlResources(root), []);
});

test('negative: malformed JavaScript fixture fails', async () => {
  const failures = await checkSyntax([join(fixtures, 'bad-syntax.js')]);
  assert.equal(failures.length, 1);
  assert.ok(failures[0].path.endsWith('bad-syntax.js'));
});

test('negative: malformed JSON fixture fails', () => {
  const failures = checkJson([join(fixtures, 'bad.json')]);
  assert.equal(failures.length, 1);
});

test('boundary: valid fixtures pass', async () => {
  assert.deepEqual(await checkSyntax([join(fixtures, 'good-syntax.js')]), []);
  assert.deepEqual(checkJson([join(fixtures, 'good.json')]), []);
});

test('regression: failures are sorted deterministically', async () => {
  const files = [join(fixtures, 'bad-syntax.js'), join(fixtures, 'good-syntax.js')];
  const a = await checkSyntax(files);
  const b = await checkSyntax([...files].reverse());
  assert.deepEqual(a.map((f) => f.path), b.map((f) => f.path));
});
