// P1.T4 tests — positive, negative, boundary, regression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStorageInventory } from '../../scripts/audit/lib/storage.mjs';

const inv = buildStorageInventory();
const byKey = new Map(inv.keys.map((r) => [r.key, r]));

test('positive: every concrete key has an owner and lifecycle decision', () => {
  assert.ok(inv.keys.length >= 40, 'meaningful number of keys extracted');
  for (const r of inv.keys) {
    assert.ok(r.owner, `${r.key} owner`);
    assert.ok(r.lifecycle, `${r.key} lifecycle`);
    assert.ok(r.sensitivity, `${r.key} sensitivity`);
    assert.ok(r.areas.length >= 1, `${r.key} area`);
  }
});

test('positive: core app keys are captured with area local', () => {
  for (const key of ['af_workflows', 'af_settings', 'af_auth']) {
    const r = byKey.get(key);
    assert.ok(r, `${key} present`);
    assert.ok(r.areas.includes('local'));
  }
});

test('boundary: sensitive keys are flagged sensitive-persistent', () => {
  const auth = byKey.get('af_auth');
  assert.ok(auth);
  assert.equal(auth.sensitivity, 'sensitive');
  assert.equal(auth.lifecycle, 'sensitive-persistent');
  assert.ok(inv.summary.sensitiveKeys.includes('af_auth'));
});

test('boundary: transient handoff keys classified transient', () => {
  const pending = inv.keys.find((r) => r.key.startsWith('_pending'));
  assert.ok(pending, 'a _pending* key exists');
  assert.equal(pending.owner, 'transient-handoff');
  assert.equal(pending.lifecycle, 'transient');
});

test('negative: an invented key is absent', () => {
  assert.equal(byKey.has('af_this_key_does_not_exist'), false);
});

test('positive: writers and readers are attributed', () => {
  const wf = byKey.get('af_workflows');
  assert.ok(wf.writerCount >= 1 || wf.readerCount >= 1);
});

test('regression: keysHash and totals are deterministic', () => {
  const again = buildStorageInventory();
  assert.equal(again.keysHash, inv.keysHash);
  assert.equal(again.summary.totalKeys, inv.summary.totalKeys);
});
