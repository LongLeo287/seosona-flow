// P10.T5 tests — documentation links resolve.
// positive/negative/boundary/regression across: install, permissions, modes,
// workflows, providers, privacy, troubleshooting, tests, links, and claims.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';

const ROOT = repoRoot();

// Curated set of authored docs whose relative links must resolve.
const DOCS = [
  'seosona-flow/README.md',
  'docs/user/getting-started.md',
  'docs/development/testing.md',
  'docs/privacy/README.md',
  'docs/privacy/data-map.md',
  'docs/governance/data-first-planning.md',
  'docs/ux/flow-inventory.md',
  'docs/runbooks/release-rollback.md',
  'docs/runbooks/startup-failure.md',
  'docs/runbooks/provider-drift.md',
];

function relLinks(md) {
  const out = [];
  const re = /\]\(([^)]+)\)/g; let m;
  while ((m = re.exec(md)) !== null) {
    const target = m[1].split('#')[0].trim();
    if (!target || /^(https?:|mailto:)/i.test(target)) continue;
    out.push(target);
  }
  return out;
}

test('positive: every authored doc exists', () => {
  for (const d of DOCS) assert.ok(existsSync(join(ROOT, d)), `missing doc ${d}`);
});

test('regression: every relative link in authored docs resolves', () => {
  const broken = [];
  for (const d of DOCS) {
    const abs = join(ROOT, d);
    const base = dirname(abs);
    for (const link of relLinks(readFileSync(abs, 'utf8'))) {
      const targetAbs = resolve(base, link);
      if (!existsSync(targetAbs)) broken.push(`${d} -> ${link}`);
    }
  }
  assert.deepEqual([...broken], [], `broken links:\n  ${broken.join('\n  ')}`);
});
