// P6.T8 tests — provider matrix.
// positive / negative / boundary / regression across: fixture, browser, adapter,
// capability, privacy, pass, fail, unsupported, and deferred.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { build } from '../../scripts/test/provider-matrix.mjs';

const ROOT = repoRoot();
const VALID = new Set(['pass', 'unsupported', 'deferred', 'fail']);

test('positive: every provider×capability cell has a valid disposition', () => {
  const m = build();
  assert.equal(m.rows.length, 5);
  for (const row of m.rows) {
    for (const cap of m.capabilities) {
      assert.ok(VALID.has(row.cells[cap]), `${row.provider}.${cap}=${row.cells[cap]}`);
    }
  }
});

test('capability: no cell is left uncovered (0 fail)', () => {
  const m = build();
  assert.equal(m.tally.fail, 0, JSON.stringify(m.tally));
});

test('privacy: the fixture corpus is clean', () => {
  assert.equal(build().privacy, 'clean');
});

test('unsupported: Claude declines results/attachments/challenge', () => {
  const claude = build().rows.find((r) => r.provider === 'claude');
  assert.equal(claude.cells.results, 'unsupported');
  assert.equal(claude.cells.attachments, 'unsupported');
  assert.equal(claude.cells.challenge, 'unsupported');
});

test('deferred: browser-only capabilities are deferred, not failed', () => {
  for (const row of build().rows) {
    assert.equal(row.cells.attachments === 'unsupported' || row.cells.attachments === 'deferred', true);
    assert.equal(row.cells.cancellation, 'deferred');
  }
});

test('fixture+pass: an implemented, fixture-backed capability passes', () => {
  const chatgpt = build().rows.find((r) => r.provider === 'chatgpt');
  assert.equal(chatgpt.cells.readiness, 'pass');
  assert.equal(chatgpt.cells.challenge, 'pass');
  assert.equal(chatgpt.cells.results, 'pass');
});

test('adapter: matrix contract version matches the adapter contract', () => {
  const m = build();
  assert.equal(m.contractVersion, 1);
  assert.equal(m.capabilities.length, 10);
});

test('regression: matrix build reconciles with the committed artifact', () => {
  const m = build();
  const onDisk = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/artifacts/providers/phase-06/provider-matrix.json'), 'utf8'));
  assert.equal(onDisk.tally.fail, 0);
  assert.equal(onDisk.privacy, 'clean');
  assert.equal(onDisk.rows.length, m.rows.length);
  // dispositions are stable
  for (const row of m.rows) {
    const disk = onDisk.rows.find((r) => r.provider === row.provider);
    for (const cap of m.capabilities) assert.equal(disk.cells[cap], row.cells[cap], `${row.provider}.${cap}`);
  }
});
