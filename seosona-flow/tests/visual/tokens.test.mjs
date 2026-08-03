// P8.T4 tests — design tokens.
// positive/negative/boundary/regression across: colors, spacing, radius,
// shadows, z-index, typography, literals, and contrast (documented).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { build } from '../../scripts/quality/check-tokens.mjs';

const ROOT = repoRoot();
const tokensCss = readFileSync(join(ROOT, 'seosona-flow/styles/tokens.css'), 'utf8');

test('positive: tokens.css declares every required category', () => {
  const r = build();
  assert.deepEqual([...r.missingCategories], []);
  assert.ok(r.categoriesRequired >= 7);
});

test('positive: Be Vietnam Pro (UI) and Lora (editorial) fonts are tokenized', () => {
  assert.ok(/--sf-font-ui:[^;]*Be Vietnam Pro/i.test(tokensCss));
  assert.ok(/--sf-font-editorial:[^;]*Lora/i.test(tokensCss));
});

test('boundary: black + white foundations and a focus ring exist', () => {
  assert.ok(/--sf-color-black:\s*#0b0b0d/i.test(tokensCss));
  assert.ok(/--sf-color-white:\s*#ffffff/i.test(tokensCss));
  assert.ok(/--sf-focus-ring/i.test(tokensCss));
});

test('boundary: a dark-scheme override block is present', () => {
  assert.ok(/prefers-color-scheme:\s*dark/i.test(tokensCss));
});

test('regression: component color-literal budget does not grow', () => {
  const r = build();
  const onDisk = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/artifacts/ux/phase-08/tokens-report.json'), 'utf8'));
  assert.ok(r.componentColorLiterals <= onDisk.componentColorLiterals, 'literals must not increase');
});
