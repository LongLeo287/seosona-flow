#!/usr/bin/env node
// Tiered test runner over the Node built-in test runner.
// Usage: run-tests.mjs <tier> [explicit files...]
// Gracefully no-ops when a tier has no test files yet (phases add them over time).
import { globSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const TIERS = {
  audit: ['tests/audit/*.test.mjs'],
  unit: [
    'tests/*.test.mjs',
    'tests/helpers/**/*.test.mjs',
    'tests/unit/**/*.test.mjs',
    'tests/architecture/**/*.test.mjs',
    'tests/workflow/**/*.test.mjs',
    'tests/providers/**/*.test.mjs',
    'tests/privacy/**/*.test.mjs',
    'tests/contracts/**/*.test.mjs',
    'tests/quality/**/*.test.mjs',
    'tests/observability/**/*.test.mjs',
    'tests/a11y/**/*.test.mjs',
    'tests/visual/**/*.test.mjs',
    'tests/performance/**/*.test.mjs',
    'tests/ux/**/*.test.mjs',
    'tests/release/**/*.test.mjs',
    'tests/docs/**/*.test.mjs',
    'tests/readiness/**/*.test.mjs',
    'tests/governance/**/*.test.mjs',
  ],
  integration: ['tests/integration/**/*.test.mjs', 'tests/security/**/*.test.mjs'],
  providers: ['tests/providers/**/*.test.mjs'],
  privacy: ['tests/privacy/**/*.test.mjs'],
  a11y: ['tests/a11y/**/*.test.mjs'],
  visual: ['tests/visual/**/*.test.mjs'],
  performance: ['tests/performance/**/*.test.mjs'],
  ux: ['tests/ux/**/*.test.mjs'],
  release: ['tests/release/**/*.test.mjs'],
  docs: ['tests/docs/**/*.test.mjs'],
  readiness: ['tests/readiness/**/*.test.mjs'],
  governance: ['tests/governance/**/*.test.mjs'],
};

function main() {
  const tier = process.argv[2];
  const explicit = process.argv.slice(3).filter((a) => !a.startsWith('-'));
  if (!tier || (!TIERS[tier] && explicit.length === 0)) {
    console.error(`[run-tests] unknown tier: ${tier}`);
    console.error(`  known tiers: ${Object.keys(TIERS).join(', ')}`);
    process.exit(2);
  }

  let files = explicit;
  if (files.length === 0) {
    const seen = new Set();
    for (const pattern of TIERS[tier]) {
      for (const f of globSync(pattern)) seen.add(f.split('\\').join('/'));
    }
    files = [...seen].sort();
  }

  if (files.length === 0) {
    console.log(`[run-tests] tier "${tier}" has no test files yet — skipping.`);
    process.exit(0);
  }

  const res = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

main();
