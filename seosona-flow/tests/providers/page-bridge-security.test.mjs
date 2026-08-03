// P6.T4 tests — secure page bridge (SEC-001).
// positive / negative / boundary / regression across: forgery, replay,
// mutation, race, nonces, origins, request IDs, and disclosure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadClassic } from '../../tests/helpers/load-classic.mjs';

const PB = loadClassic('src/providers/PageBridge.js').SEOSONA_PageBridge;
const R = PB.REASONS;

const ORIGIN = 'https://labs.google';
const CHANNEL = 'tab-secret-abc123';

function seededRandom() {
  let n = 0;
  return () => 'r' + (++n);
}
function fixedClock(start = 1000) {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

// Turn one side's {envelope,targetOrigin} into the other side's inbound event.
function toEvent(out, over = {}) {
  return { origin: over.origin ?? out.targetOrigin, sameSource: over.sameSource ?? true, data: over.data ?? out.envelope };
}

function pair() {
  const clock = fixedClock();
  const requester = PB.createRequester({ origin: ORIGIN, channelId: CHANNEL, random: seededRandom(), now: clock.now, ttlMs: 5000 });
  const responder = PB.createResponder({ origin: ORIGIN, channelId: CHANNEL, now: clock.now });
  return { requester, responder, clock };
}

test('positive: full request→reply round-trip delivers the payload', () => {
  const { requester, responder } = pair();
  const req = requester.issue('insert', { text: 'hi' });
  const accepted = responder.acceptRequest(toEvent(req));
  assert.equal(accepted.ok, true);
  assert.equal(accepted.action, 'insert');
  const rep = responder.reply(accepted, { done: true });
  const got = requester.acceptReply(toEvent(rep));
  assert.equal(got.ok, true);
  assert.deepEqual({ ...got.payload }, { done: true });
  assert.equal(requester.pendingCount(), 0, 'request consumed');
});

test('disclosure: envelopes always target the specific origin, never "*"', () => {
  const { requester, responder } = pair();
  const req = requester.issue('clear', {});
  assert.equal(req.targetOrigin, ORIGIN);
  assert.notEqual(req.targetOrigin, '*');
  const rep = responder.reply(responder.acceptRequest(toEvent(req)), {});
  assert.equal(rep.targetOrigin, ORIGIN);
  assert.notEqual(rep.targetOrigin, '*');
});

test('origins: a reply from a foreign origin is rejected', () => {
  const { requester, responder } = pair();
  const req = requester.issue('insert', {});
  const rep = responder.reply(responder.acceptRequest(toEvent(req)), { ok: 1 });
  const got = requester.acceptReply(toEvent(rep, { origin: 'https://evil.example' }));
  assert.equal(got.ok, false);
  assert.equal(got.reason, R.BAD_ORIGIN);
});

test('origins: a request from a foreign origin is rejected by the bridge', () => {
  const { requester, responder } = pair();
  const req = requester.issue('insert', {});
  const got = responder.acceptRequest(toEvent(req, { origin: 'https://evil.example' }));
  assert.equal(got.reason, R.BAD_ORIGIN);
});

test('source: event.source !== window is rejected on both ends', () => {
  const { requester, responder } = pair();
  const req = requester.issue('insert', {});
  assert.equal(responder.acceptRequest(toEvent(req, { sameSource: false })).reason, R.BAD_SOURCE);
  const rep = responder.reply(responder.acceptRequest(toEvent(req)), {});
  assert.equal(requester.acceptReply(toEvent(rep, { sameSource: false })).reason, R.BAD_SOURCE);
});

test('forgery: a reply on the wrong channel is rejected', () => {
  const { requester, responder } = pair();
  const req = requester.issue('insert', {});
  const rep = responder.reply(responder.acceptRequest(toEvent(req)), {});
  const tampered = { ...rep.envelope, [PB.CHANNEL_KEY]: 'wrong-channel' };
  assert.equal(requester.acceptReply(toEvent(rep, { data: tampered })).reason, R.BAD_CHANNEL);
});

test('forgery: a reply for a request that was never issued is rejected', () => {
  const { requester } = pair();
  const forged = {};
  forged[PB.CHANNEL_KEY] = CHANNEL;
  Object.assign(forged, { dir: 'res', requestId: 'ghost', nonce: 'x', action: 'insert', payload: { stolen: true } });
  assert.equal(requester.acceptReply(toEvent({ envelope: forged, targetOrigin: ORIGIN })).reason, R.UNKNOWN_REQUEST);
});

test('replay: a valid reply is accepted exactly once', () => {
  const { requester, responder } = pair();
  const req = requester.issue('insert', {});
  const rep = responder.reply(responder.acceptRequest(toEvent(req)), { v: 1 });
  assert.equal(requester.acceptReply(toEvent(rep)).ok, true);
  // replay the identical reply
  assert.equal(requester.acceptReply(toEvent(rep)).reason, R.UNKNOWN_REQUEST);
});

test('mutation: tampering the nonce is rejected', () => {
  const { requester, responder } = pair();
  const req = requester.issue('insert', {});
  const rep = responder.reply(responder.acceptRequest(toEvent(req)), {});
  const tampered = { ...rep.envelope, nonce: 'not-the-nonce' };
  assert.equal(requester.acceptReply(toEvent(rep, { data: tampered })).reason, R.BAD_NONCE);
});

test('nonces: every request gets a distinct nonce and requestId', () => {
  const { requester } = pair();
  const a = requester.issue('insert', {});
  const b = requester.issue('insert', {});
  assert.notEqual(a.envelope.nonce, b.envelope.nonce);
  assert.notEqual(a.envelope.requestId, b.envelope.requestId);
});

test('race: reply carrying request A id but a different nonce cannot satisfy A', () => {
  const { requester, responder } = pair();
  const a = requester.issue('insert', {});
  const b = requester.issue('clear', {});
  assert.equal(requester.pendingCount(), 2);
  // craft a reply that uses A's requestId but B's nonce
  const evilReply = responder.reply(responder.acceptRequest(toEvent(a)), {});
  const mixed = { ...evilReply.envelope, nonce: b.envelope.nonce };
  assert.equal(requester.acceptReply(toEvent(evilReply, { data: mixed })).reason, R.BAD_NONCE);
  // A and B both still outstanding — nothing consumed by the forged reply
  assert.equal(requester.pendingCount(), 2);
});

test('boundary: an expired request cannot be answered later', () => {
  const clock = fixedClock();
  const requester = PB.createRequester({ origin: ORIGIN, channelId: CHANNEL, random: seededRandom(), now: clock.now, ttlMs: 1000 });
  const responder = PB.createResponder({ origin: ORIGIN, channelId: CHANNEL, now: clock.now });
  const req = requester.issue('insert', {});
  const rep = responder.reply(responder.acceptRequest(toEvent(req)), {});
  clock.advance(2000); // past ttl
  assert.equal(requester.acceptReply(toEvent(rep)).reason, R.EXPIRED);
});

test('regression: wrong-direction envelopes are rejected symmetrically', () => {
  const { requester, responder } = pair();
  const req = requester.issue('insert', {});
  // feed a REQUEST envelope to acceptReply (expects dir=res)
  assert.equal(requester.acceptReply(toEvent(req)).reason, R.BAD_DIR);
  // feed a REPLY envelope to acceptRequest (expects dir=req)
  const rep = responder.reply(responder.acceptRequest(toEvent(req)), {});
  assert.equal(responder.acceptRequest(toEvent(rep)).reason, R.BAD_DIR);
});
