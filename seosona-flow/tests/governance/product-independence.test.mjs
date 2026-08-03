import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';

const PRODUCT_ROOT = join(repoRoot(), 'seosona-flow');
const SELF = 'tests/governance/product-independence.test.mjs';
const SKIP_DIRS = new Set(['.git', 'node_modules', 'coverage', 'dist']);
const FORBIDDEN = [
  ['toby', 'flow'].join(''),
  ['toby', '.vn'].join(''),
  ['iicjfgdnngmpfocf', 'anpiammedafmomin'].join(''),
];

function productFiles(dir = PRODUCT_ROOT) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...productFiles(abs));
    else files.push(abs);
  }
  return files;
}

test('product tree contains no legacy brand, domain, extension id, or snapshot pointer', () => {
  const violations = [];
  for (const abs of productFiles()) {
    const rel = relative(PRODUCT_ROOT, abs).replaceAll('\\', '/');
    if (rel === SELF) continue;
    const bytes = readFileSync(abs);
    if (bytes.includes(0)) continue;
    const content = bytes.toString('utf8').toLowerCase();
    for (const token of FORBIDDEN) {
      if (content.includes(token)) violations.push(`${rel}: ${token}`);
    }
  }
  assert.deepEqual(violations, []);
});

test('product has no external comparison subsystem', () => {
  for (const rel of ['config/upstream.json', 'scripts/upstream', 'tests/upstream']) {
    assert.equal(existsSync(join(PRODUCT_ROOT, rel)), false, `${rel} must not exist`);
  }

  const pkg = JSON.parse(readFileSync(join(PRODUCT_ROOT, 'package.json'), 'utf8'));
  const scripts = Object.keys(pkg.scripts || {});
  assert.equal(scripts.some((name) => name.startsWith('upstream:')), false);
  assert.equal(JSON.stringify(pkg).includes('scripts/upstream/'), false);
});
