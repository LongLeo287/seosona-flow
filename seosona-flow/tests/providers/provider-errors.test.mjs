// P6.T7 tests — provider error normalization.
// positive / negative / boundary / regression across: auth, rate, challenge,
// selector, rejection, network, timeout, cancel, unknown, recovery.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const PE = loadClassic('src/providers/ProviderError.js').SEOSONA_ProviderError;
const C = PE.CODES;

test('positive: each signal family maps to its stable code', () => {
  assert.equal(PE.normalize({ status: 401 }).code, C.AUTH);
  assert.equal(PE.normalize({ status: 429 }).code, C.RATE);
  assert.equal(PE.normalize({ kind: 'captcha' }).code, C.CHALLENGE);
  assert.equal(PE.normalize({ message: 'no matching element in DOM' }).code, C.SELECTOR);
  assert.equal(PE.normalize({ status: 422 }).code, C.REJECTED);
  assert.equal(PE.normalize({ message: 'fetch failed: ECONNREFUSED' }).code, C.NETWORK);
  assert.equal(PE.normalize({ status: 504 }).code, C.TIMEOUT);
  assert.equal(PE.normalize({ name: 'AbortError' }).code, C.CANCELLED);
});

test('positive: retryability + action are correct per code', () => {
  const rate = PE.normalize({ status: 429 });
  assert.equal(rate.retryable, true);
  assert.equal(rate.action, 'wait_and_retry');

  const auth = PE.normalize({ status: 403 });
  assert.equal(auth.retryable, false);
  assert.equal(auth.action, 'reauthenticate');

  const cancelled = PE.normalize({ name: 'AbortError' });
  assert.equal(cancelled.retryable, false);
  assert.equal(cancelled.action, 'none');

  const selector = PE.normalize({ kind: 'selector' });
  assert.equal(selector.retryable, false);
  assert.equal(selector.action, 'update_adapter');
});

test('negative: unmapped signal is UNKNOWN, not retryable', () => {
  const r = PE.normalize({ message: 'something weird happened xyz' });
  assert.equal(r.code, C.UNKNOWN);
  assert.equal(r.retryable, false);
  assert.equal(r.action, 'inspect');
});

test('negative: evidence is redacted — no tokens, emails, query strings, prompts', () => {
  const r = PE.normalize({
    message: 'auth failed for user alice@example.com at https://api.host/x?access_token=abcdefghijklmnopqrstuvwxyz123456 body="my secret prompt about cats"',
    status: 401,
  });
  assert.equal(r.code, C.AUTH);
  assert.ok(!/alice@example\.com/.test(r.evidence), 'email redacted');
  assert.ok(!/abcdefghijklmnopqrstuvwxyz123456/.test(r.evidence), 'token redacted');
  assert.ok(!/access_token=abc/.test(r.evidence), 'query string redacted');
  assert.ok(r.evidence.includes('<email>') || r.evidence.includes('<token>') || r.evidence.includes('<redacted>'));
});

test('boundary: evidence is length-bounded', () => {
  const long = 'x'.repeat(5000);
  const r = PE.normalize({ message: long, kind: 'network' });
  assert.ok(r.evidence.length <= 161, `evidence too long: ${r.evidence.length}`);
});

test('boundary: explicit already-normalized code is preserved', () => {
  const r = PE.normalize({ code: 'E_PROV_RATE' });
  assert.equal(r.code, C.RATE);
});

test('boundary: challenge keyword sniffed from human-check copy', () => {
  assert.equal(PE.normalize({ message: 'Please verify you are human' }).code, C.CHALLENGE);
  assert.equal(PE.normalize({ message: 'Are you a human? complete the captcha' }).code, C.CHALLENGE);
});

test('regression: normalize is deterministic and provider label carried', () => {
  const a = PE.normalize({ status: 429, message: 'slow down' }, { provider: 'chatgpt' });
  const b = PE.normalize({ status: 429, message: 'slow down' }, { provider: 'chatgpt' });
  assert.deepEqual({ ...a }, { ...b });
  assert.equal(a.provider, 'chatgpt');
});

test('regression: isRetryable helper agrees with normalize', () => {
  for (const code of Object.values(C)) {
    const err = PE.normalize({ code });
    assert.equal(PE.isRetryable(err), err.retryable, `${code}`);
  }
});
