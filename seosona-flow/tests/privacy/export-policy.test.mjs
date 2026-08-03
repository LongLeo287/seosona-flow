// P7.T6 tests — export policy (no credential leaves the extension).
// positive/negative/boundary/regression across: tokens, HMAC, provider state,
// Telegram, MCP, nested canaries, and workflow data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const EP = loadClassic('src/storage/ExportPolicy.js').SEOSONA_ExportPolicy;
const DC = loadClassic('src/storage/DataClassification.js').SEOSONA_DataClassification;
const classify = (k) => DC.classify(k);

test('positive: exportable classes (workflow/setting) survive', () => {
  const { bundle } = EP.sanitizeExport({ workflow_main: { nodes: [] }, theme_setting: 'dark' }, classify);
  assert.deepEqual(Object.keys(bundle).sort(), ['theme_setting', 'workflow_main']);
});

test('negative: token/session/log classes are dropped by policy', () => {
  const { bundle, removed } = EP.sanitizeExport({
    telegram_bot_token: 'x', session_id: 'y', tracker_history: [1, 2],
  }, classify);
  assert.deepEqual(Object.keys(bundle), []);
  assert.equal(removed.length, 3);
});

test('boundary: nested secret keys are stripped even inside exportable objects', () => {
  const { bundle } = EP.sanitizeExport({
    workflow_x: { name: 'ok', apiKey: 'nested-secret', child: { password: 'p', keep: 1 } },
  }, classify);
  assert.equal(bundle.workflow_x.name, 'ok');
  assert.equal('apiKey' in bundle.workflow_x, false);
  assert.equal('password' in bundle.workflow_x.child, false);
  assert.equal(bundle.workflow_x.child.keep, 1);
});

test('boundary: value-shaped secrets are redacted under innocuous keys', () => {
  const { bundle } = EP.sanitizeExport({
    setting_note: 'my key is eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig here',
  }, classify);
  assert.ok(bundle.setting_note.includes('[REDACTED]'));
});

test('regression: a deep canary token never appears in the output', () => {
  const CANARY = 'ghp_CANARY000000000000000000';
  const input = { workflow_z: { steps: [{ meta: { authToken: CANARY } }, { note: `trailing ${CANARY}` }] } };
  const { bundle } = EP.sanitizeExport(input, classify);
  const serialized = JSON.stringify(bundle);
  assert.equal(serialized.includes(CANARY), false, 'canary leaked into export');
});
