// SEOSONA Flow — Secure Page Bridge (Phase 6 / P6.T4, SEC-001).
// Classic script, transport-agnostic. Formalizes the content-script ⇄ MAIN-world
// `window.postMessage` channel that today only Flow (`content.js` ⇄
// `slate-bridge.js`) implements — and fixes the two gaps the audit found:
//   1. The live bridge does NOT validate `event.origin` on the inbound side.
//   2. The live bridge does NOT consistently echo the per-request nonce back,
//      so the content side's `nonce === nonce` check is only sometimes real.
//
// This module makes both ends enforce the SAME symmetric contract:
//   - a per-tab secret `channelId` (established out of band via the hidden meta
//     element / crypto.randomUUID in production),
//   - a fresh per-request `nonce` (single-use — consumed on first valid reply),
//   - `event.source === window` AND `event.origin === <own origin>` on BOTH ends,
//   - replies posted to the SPECIFIC origin, never `'*'` (no disclosure),
//   - a TTL so stale requests cannot be answered later (replay/race safety).
//
// It is DOM/postMessage-free: the caller passes normalized `{ origin, sameSource,
// data }` events in and gets `{ envelope, targetOrigin }` out to post. `random()`
// and `now()` are injected so tests are deterministic (prod: crypto.randomUUID).
(function (global) {
  'use strict';

  var CHANNEL_KEY = '__seosonaBridge';
  var REASONS = {
    BAD_SOURCE: 'bad_source',       // event.source !== window
    BAD_ORIGIN: 'bad_origin',       // cross-origin sender
    BAD_CHANNEL: 'bad_channel',     // wrong/absent per-tab channel secret
    BAD_DIR: 'bad_dir',             // request seen where reply expected (or vice versa)
    MALFORMED: 'malformed',         // missing requestId/nonce
    UNKNOWN_REQUEST: 'unknown_request', // no matching outstanding request (forgery/replay)
    BAD_NONCE: 'bad_nonce',         // nonce does not match the issued one
    EXPIRED: 'expired',             // outstanding request timed out
  };

  function fail(reason) { return { ok: false, reason: reason }; }

  function envelope(channelId, dir, requestId, nonce, action, payload) {
    var e = {};
    e[CHANNEL_KEY] = channelId;
    e.dir = dir;
    e.requestId = requestId;
    e.nonce = nonce;
    e.action = action;
    e.payload = payload;
    return e;
  }

  function requireCfg(cfg, needRandom) {
    cfg = cfg || {};
    if (!cfg.origin || typeof cfg.origin !== 'string') throw new Error('PageBridge: origin required');
    if (!cfg.channelId || typeof cfg.channelId !== 'string') throw new Error('PageBridge: channelId required');
    if (typeof cfg.now !== 'function') throw new Error('PageBridge: now() required');
    if (needRandom && typeof cfg.random !== 'function') throw new Error('PageBridge: random() required');
    return cfg;
  }

  // Shared inbound validation (source, origin, channel, direction).
  function validateInbound(cfg, event, wantDir) {
    if (!event || event.sameSource !== true) return fail(REASONS.BAD_SOURCE);
    if (event.origin !== cfg.origin) return fail(REASONS.BAD_ORIGIN);
    var d = event.data;
    if (!d || typeof d !== 'object' || d[CHANNEL_KEY] !== cfg.channelId) return fail(REASONS.BAD_CHANNEL);
    if (d.dir !== wantDir) return fail(REASONS.BAD_DIR);
    return { ok: true, data: d };
  }

  // ---- Content-script side (issues requests, consumes replies) -------------
  function createRequester(cfg) {
    requireCfg(cfg, true);
    var ttl = cfg.ttlMs > 0 ? cfg.ttlMs : 5000;
    var pending = new Map(); // requestId -> { nonce, expiresAt, action }

    function issue(action, payload) {
      var requestId = String(cfg.random());
      var nonce = String(cfg.random());
      pending.set(requestId, { nonce: nonce, expiresAt: cfg.now() + ttl, action: action });
      return { requestId: requestId, targetOrigin: cfg.origin, envelope: envelope(cfg.channelId, 'req', requestId, nonce, action, payload) };
    }

    function acceptReply(event) {
      var base = validateInbound(cfg, event, 'res');
      if (!base.ok) return base;
      var d = base.data;
      var p = pending.get(d.requestId);
      // Unknown requestId also covers: already-consumed (replay) and forged ids.
      if (!p) return fail(REASONS.UNKNOWN_REQUEST);
      if (cfg.now() > p.expiresAt) { pending.delete(d.requestId); return fail(REASONS.EXPIRED); }
      if (d.nonce !== p.nonce) return fail(REASONS.BAD_NONCE);
      pending.delete(d.requestId); // single-use: consume so a replay can't re-satisfy
      return { ok: true, requestId: d.requestId, action: p.action, payload: d.payload };
    }

    function expire() {
      var t = cfg.now(), dropped = 0;
      pending.forEach(function (p, id) { if (t > p.expiresAt) { pending.delete(id); dropped++; } });
      return dropped;
    }

    return { issue: issue, acceptReply: acceptReply, expire: expire, pendingCount: function () { return pending.size; } };
  }

  // ---- MAIN-world bridge side (accepts requests, replies) ------------------
  function createResponder(cfg) {
    requireCfg(cfg, false);

    function acceptRequest(event) {
      var base = validateInbound(cfg, event, 'req');
      if (!base.ok) return base;
      var d = base.data;
      if (typeof d.requestId !== 'string' || typeof d.nonce !== 'string') return fail(REASONS.MALFORMED);
      return { ok: true, requestId: d.requestId, nonce: d.nonce, action: d.action, payload: d.payload };
    }

    // Reply MUST echo BOTH requestId AND nonce (the SEC-001 fix) and target the
    // specific origin. `request` is the object returned by acceptRequest().
    function reply(request, payload) {
      if (!request || !request.ok) throw new Error('PageBridge: cannot reply to an unaccepted request');
      return { targetOrigin: cfg.origin, envelope: envelope(cfg.channelId, 'res', request.requestId, request.nonce, request.action, payload) };
    }

    return { acceptRequest: acceptRequest, reply: reply };
  }

  global.SEOSONA_PageBridge = {
    CHANNEL_KEY: CHANNEL_KEY,
    REASONS: REASONS,
    createRequester: createRequester,
    createResponder: createResponder,
  };
})(typeof self !== 'undefined' ? self : this);
