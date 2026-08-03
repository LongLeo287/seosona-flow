// P1.T3 tests — positive, negative, boundary, regression.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessageContracts } from '../../scripts/audit/lib/messages.mjs';

const c = buildMessageContracts();
const byAction = new Map(c.registry.map((r) => [r.action, r]));

test('positive: every privileged handler has exactly one classified registry row', () => {
  const seen = new Set();
  for (const r of c.registry) {
    assert.ok(!seen.has(r.action), `duplicate row: ${r.action}`);
    seen.add(r.action);
    assert.ok(Array.isArray(r.sources));
    assert.equal(typeof r.privileged, 'boolean');
  }
});

test('positive: known privileged actions are present and classified', () => {
  for (const action of ['chromeDownload', 'fetchImageAsBase64', 'apiRequest']) {
    const r = byAction.get(action);
    assert.ok(r, `action ${action} present`);
    assert.equal(r.handled, true);
  }
});

test('positive: at least one externally reachable action is recorded', () => {
  assert.ok(c.summary.externalListeners >= 1, 'onMessageExternal listener detected');
  assert.ok(c.summary.externallyReachable.length >= 1, 'external-reachable actions recorded');
  for (const a of c.summary.externallyReachable) {
    assert.equal(byAction.get(a).externallyReachable, true);
  }
});

test('boundary: handled actions carry a source context', () => {
  for (const r of c.registry.filter((x) => x.handled)) {
    assert.ok(r.sources.length >= 1, `${r.action} has a source context`);
  }
});

test('negative: an unhandled invented action is absent', () => {
  assert.equal(byAction.has('__totally_made_up_action__'), false);
});

test('boundary: privileged rows list concrete sink families', () => {
  const priv = c.registry.filter((r) => r.privileged);
  assert.ok(priv.length >= 1);
  for (const r of priv) {
    assert.ok(r.privilegedSinks.length >= 1, `${r.action} lists sinks`);
  }
});

test('regression: registry hash and total are deterministic', () => {
  const again = buildMessageContracts();
  assert.equal(again.registryHash, c.registryHash);
  assert.equal(again.summary.totalActions, c.summary.totalActions);
});
