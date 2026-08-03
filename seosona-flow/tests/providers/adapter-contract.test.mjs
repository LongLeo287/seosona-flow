// P6.T1 tests — provider adapter contract.
// positive / negative / boundary / regression across: readiness, prompts,
// attachments, status, results, cancellation, errors, capability, and abort.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const PA = loadClassic('src/providers/ProviderAdapter.js').SEOSONA_ProviderAdapter;

// A minimal conforming adapter factory for a given profile.
function stubAdapter(profile) {
  const a = { profile };
  for (const cap of Object.keys(PA.CAPABILITIES)) {
    if (profile.supports[cap] === true) a[PA.CAPABILITIES[cap].method] = () => {};
  }
  return a;
}

test('positive: every shipped provider profile is complete', () => {
  for (const name of PA.providers()) {
    const r = PA.validateProfile(PA.PROVIDER_PROFILES[name]);
    assert.equal(r.valid, true, `${name}: ${JSON.stringify(r.issues)}`);
  }
});

test('positive: every capability is dispositioned for every provider', () => {
  const caps = Object.keys(PA.CAPABILITIES);
  for (const name of PA.providers()) {
    const row = PA.describe(PA.PROVIDER_PROFILES[name]);
    for (const cap of caps) {
      assert.notEqual(row.capabilities[cap], 'undeclared', `${name}.${cap} must be implemented or declined`);
    }
  }
});

test('positive: a stub adapter built from its profile conforms', () => {
  for (const name of PA.providers()) {
    const r = PA.conform(stubAdapter(PA.PROVIDER_PROFILES[name]));
    assert.equal(r.valid, true, `${name}: ${JSON.stringify(r.issues)}`);
  }
});

test('negative: a required capability may not be declined', () => {
  const bad = { provider: 'x', version: PA.CONTRACT_VERSION, supports: {
    readiness: false, login: true, prompt: true, status: true, errors: true,
    results: false, attachments: false, challenge: false, cancellation: false, abort: false,
  } };
  const r = PA.validateProfile(bad);
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.code === 'REQUIRED_DECLINED' && i.path === 'supports.readiness'));
});

test('negative: an undeclared capability fails validation', () => {
  const bad = { provider: 'x', version: PA.CONTRACT_VERSION, supports: {
    login: true, prompt: true, status: true, errors: true, readiness: true,
    // results/attachments/challenge/cancellation/abort omitted → undeclared
  } };
  const r = PA.validateProfile(bad);
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.code === 'UNDECLARED_CAPABILITY'));
});

test('negative: an unknown capability key is rejected (drift guard)', () => {
  const p = JSON.parse(JSON.stringify(PA.PROVIDER_PROFILES.chatgpt));
  p.supports.telepathy = true;
  const r = PA.validateProfile(p);
  assert.ok(r.issues.some((i) => i.code === 'UNKNOWN_CAPABILITY' && i.path === 'supports.telepathy'));
});

test('boundary: declined capability exposing a method is a contract lie', () => {
  const a = stubAdapter(PA.PROVIDER_PROFILES.claude);
  // Claude declines attachments; adding the method must fail conformance.
  a[PA.CAPABILITIES.attachments.method] = () => {};
  const r = PA.conform(a);
  assert.equal(r.valid, false);
  assert.ok(r.issues.some((i) => i.code === 'DECLINED_BUT_PRESENT' && i.capability === 'attachments'));
});

test('boundary: supported capability missing its method fails conformance', () => {
  const a = stubAdapter(PA.PROVIDER_PROFILES.chatgpt);
  delete a[PA.CAPABILITIES.prompt.method];
  const r = PA.conform(a);
  assert.ok(r.issues.some((i) => i.code === 'MISSING_METHOD' && i.capability === 'prompt'));
});

test('boundary: version mismatch is flagged', () => {
  const p = JSON.parse(JSON.stringify(PA.PROVIDER_PROFILES.grok));
  p.version = 999;
  assert.ok(PA.validateProfile(p).issues.some((i) => i.code === 'VERSION_MISMATCH'));
});

test('regression: Claude is text-only, Flow uses a page bridge (documented outliers)', () => {
  const claude = PA.PROVIDER_PROFILES.claude;
  assert.equal(claude.supports.results, false);
  assert.equal(claude.supports.challenge, false);
  assert.equal(claude.flags.textOnly, true);

  const flow = PA.PROVIDER_PROFILES.flow;
  assert.equal(flow.flags.usesPageBridge, true);
  assert.equal(flow.supports.results, true);
});

test('regression: EVENTS vocabulary is stable and provider-independent', () => {
  assert.deepEqual([...PA.EVENTS], ['ready', 'submitted', 'generating', 'complete', 'challenge', 'error', 'cancelled']);
});
