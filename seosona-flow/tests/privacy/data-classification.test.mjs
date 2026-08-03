// P7.T4 tests — stored data classification.
// positive/negative/boundary/regression across: prompts, workflows, media,
// settings, sessions, tokens, logs, caches, purpose, and retention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from '../../scripts/audit/lib/repo.mjs';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const ROOT = repoRoot();
const DC = loadClassic('src/storage/DataClassification.js').SEOSONA_DataClassification;

test('positive: representative keys map to the expected class', () => {
  assert.equal(DC.classify('flow_saved_prompt').class, 'prompt');
  assert.equal(DC.classify('workflow_nodes').class, 'workflow');
  assert.equal(DC.classify('generated_image_cache').class, 'media');
  assert.equal(DC.classify('telegram_bot_token').class, 'token');
  assert.equal(DC.classify('active_provider_tab').class, 'session');
  assert.equal(DC.classify('tracker_history').class, 'log');
  assert.equal(DC.classify('theme_setting').class, 'setting');
});

test('positive: every classification carries purpose + retention', () => {
  for (const cls of DC.classes()) {
    const meta = DC.CLASS_META[cls];
    assert.ok(meta.purpose && meta.retention, cls);
  }
});

test('negative: inventory sensitivity can only escalate to sensitive', () => {
  const r = DC.classify('workflow_nodes', { sensitivity: 'sensitive' });
  assert.equal(r.class, 'workflow');
  assert.equal(r.sensitive, true, 'inventory signal escalates');
});

test('boundary: token/session/prompt/log classes are marked sensitive', () => {
  assert.equal(DC.classify('license_hmac').sensitive, true);
  assert.equal(DC.classify('session_id').sensitive, true);
  assert.equal(DC.classify('user_prompt_text').sensitive, true);
});

test('regression: real app keys (af_*/_pending*) all classify concretely', () => {
  const inv = JSON.parse(readFileSync(join(ROOT, 'seosona-flow/artifacts/audit/phase-01/storage-inventory.json'), 'utf8'));
  // The inventory mixes real keys with scanner-extracted string literals; the
  // unambiguous real keys use the `af_` app namespace or the `_pending` handoff
  // prefix. Those must never fall through to "other".
  const realKeys = (inv.keys || []).map((k) => k.key).filter((k) => /^af_|^_pending/.test(k));
  assert.ok(realKeys.length >= 30, `expected the af_/_pending families, got ${realKeys.length}`);
  const other = realKeys.filter((k) => DC.classify(k).class === 'other');
  assert.deepEqual([...other], [], `unclassified real keys: ${other.join(', ')}`);
  // and every one of them is justified (purpose + retention)
  for (const k of realKeys) assert.ok(DC.justified(DC.classify(k)), k);
});
