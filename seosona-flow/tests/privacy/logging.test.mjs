// P7.T7 tests — privacy filter for logs/diagnostics.
// positive/negative/boundary/regression across: prompts, responses, URLs,
// names, accounts, tokens, DOM, nested errors, and truncation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const PF = loadClassic('src/core/PrivacyFilter.js').SEOSONA_PrivacyFilter;

test('positive: content fields collapse to a shape descriptor', () => {
  const out = PF.filter({ prompt: 'a very private prompt about cats', model: 'x' });
  assert.deepEqual({ ...out.prompt }, { kind: 'text', length: 32 });
  assert.equal(out.model, 'x');
});

test('negative: tokens/emails/handles are redacted in strings', () => {
  const s = PF.scrubString('user alice@example.com @alice token eyJhbGciOiJIUzI1NiJ9.payload.sig');
  assert.ok(!s.includes('alice@example.com'));
  assert.ok(!s.includes('eyJhbGciOiJIUzI1NiJ9'));
  assert.ok(s.includes('<email>'));
});

test('boundary: URL query is stripped (tokens ride there)', () => {
  const s = PF.scrubString('GET https://api.host/x?access_token=abc123 done');
  assert.ok(!s.includes('access_token=abc123'));
  assert.ok(s.includes('https://api.host/x'));
});

test('boundary: hashId is stable, opaque, and non-reversible', () => {
  const a = PF.hashId('tab-42-user@x.com');
  const b = PF.hashId('tab-42-user@x.com');
  assert.equal(a, b);
  assert.ok(/^id_[0-9a-f]{8}$/.test(a));
  assert.ok(!a.includes('user'));
});

test('boundary: depth-bounded — deeply nested objects do not blow up', () => {
  let deep = { v: 1 };
  for (let i = 0; i < 20; i++) deep = { child: deep };
  const out = PF.filter(deep, { depth: 4 });
  assert.ok(JSON.stringify(out).includes('[DEPTH]'));
});

test('regression: a canary token buried in a nested error never survives', () => {
  const CANARY = 'sk-CANARY0000000000000000';
  const payload = { error: { message: `boom ${CANARY}`, cause: { detail: CANARY } }, response: 'secret answer' };
  const out = PF.filter(payload);
  const serialized = JSON.stringify(out);
  assert.equal(serialized.includes(CANARY), false, 'canary leaked through filter');
  // response content reduced to a descriptor, not the raw answer
  assert.equal(typeof out.response, 'object');
  assert.equal(out.response.kind, 'text');
});
