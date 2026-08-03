// SEOSONA Flow — Provider Session Registry (Phase 6 / P6.T5, AUD-019).
// Classic worker script, pure/headless. Today each provider content script
// figures out "which tab am I" ad hoc, and the background has no single source
// of truth for "which provider tab is ready to receive a workflow step." This
// registry leases a provider session by { provider, window, tab, accountHint,
// version } and INVALIDATES it on navigation, logout, or close — so a workflow
// can never be dispatched to a stale or wrong tab.
//
// No chrome APIs: the caller feeds tab lifecycle events in. `now()` and an id
// generator are injected for deterministic tests.
(function (global) {
  'use strict';

  var REASONS = {
    NO_SESSION: 'no_session',   // nothing matched the lease criteria
    NO_LEASE: 'no_lease',       // lease id unknown / released
    GONE: 'gone',               // the tab was closed
    STALE: 'stale',             // navigated away / logged out / version too old
  };

  function originOf(url) {
    try { return new URL(String(url)).origin; } catch (_) { return null; }
  }

  function create(cfg) {
    cfg = cfg || {};
    var now = typeof cfg.now === 'function' ? cfg.now : function () { return 0; };
    var seq = 0;
    var nextId = typeof cfg.idGen === 'function' ? cfg.idGen : (function () { var n = 0; return function () { return 'lease-' + (++n); }; })();

    var sessions = new Map(); // tabId -> session
    var leases = new Map();   // leaseId -> tabId

    function markStale(session, reason) {
      session.status = 'stale';
      session.staleReason = reason;
      // Keep the lease mapping intact so resolveTarget() can report STALE (with
      // the reason) rather than a generic NO_LEASE. A stale session is never
      // re-leased anyway (status !== 'ready'), so exclusivity still holds.
    }

    // Register (or refresh) a provider tab as ready to accept work.
    function register(s) {
      if (!s || s.tabId == null || !s.provider) throw new Error('SessionRegistry: register needs {tabId, provider}');
      var prev = sessions.get(s.tabId);
      var session = {
        tabId: s.tabId,
        provider: String(s.provider),
        windowId: s.windowId != null ? s.windowId : null,
        origin: s.origin || originOf(s.url) || null,
        url: s.url || null,
        accountHint: s.accountHint != null ? String(s.accountHint) : null,
        version: typeof s.version === 'number' ? s.version : 0,
        status: 'ready',
        staleReason: null,
        leaseId: prev ? prev.leaseId : null,
        seq: prev ? prev.seq : ++seq,
        updatedAt: now(),
      };
      sessions.set(s.tabId, session);
      return snapshot(session);
    }

    function snapshot(s) {
      return { tabId: s.tabId, provider: s.provider, windowId: s.windowId, origin: s.origin,
        accountHint: s.accountHint, version: s.version, status: s.status, staleReason: s.staleReason };
    }

    function get(tabId) { var s = sessions.get(tabId); return s ? snapshot(s) : null; }

    // Lease a ready session matching the criteria. Leased sessions are exclusive
    // until released (concurrency guard). Deterministic: oldest registration wins.
    function lease(criteria) {
      criteria = criteria || {};
      if (!criteria.provider) throw new Error('SessionRegistry: lease needs a provider');
      var best = null;
      sessions.forEach(function (s) {
        if (s.status !== 'ready' || s.leaseId) return;
        if (s.provider !== criteria.provider) return;
        if (criteria.windowId != null && s.windowId !== criteria.windowId) return;
        if (criteria.accountHint != null && s.accountHint !== String(criteria.accountHint)) return;
        if (criteria.minVersion != null && s.version < criteria.minVersion) return;
        if (!best || s.seq < best.seq) best = s;
      });
      if (!best) return { ok: false, reason: REASONS.NO_SESSION };
      var leaseId = String(nextId());
      best.leaseId = leaseId;
      leases.set(leaseId, best.tabId);
      return { ok: true, leaseId: leaseId, tabId: best.tabId, session: snapshot(best) };
    }

    // Resolve a lease to a live, still-valid tab. This is the gate every dispatch
    // must pass through — it refuses stale or closed tabs.
    function resolveTarget(leaseId) {
      var tabId = leases.get(leaseId);
      if (tabId == null) return { ok: false, reason: REASONS.NO_LEASE };
      var s = sessions.get(tabId);
      if (!s) { leases.delete(leaseId); return { ok: false, reason: REASONS.GONE }; }
      if (s.status !== 'ready') return { ok: false, reason: REASONS.STALE, staleReason: s.staleReason, tabId: tabId };
      return { ok: true, tabId: tabId, session: snapshot(s) };
    }

    function release(leaseId) {
      var tabId = leases.get(leaseId);
      if (tabId == null) return false;
      leases.delete(leaseId);
      var s = sessions.get(tabId);
      if (s && s.leaseId === leaseId) s.leaseId = null;
      return true;
    }

    // ---- Lifecycle invalidation -------------------------------------------
    function onNavigated(tabId, url) {
      var s = sessions.get(tabId);
      if (!s) return false;
      var org = originOf(url);
      if (s.origin && org && org !== s.origin) {
        markStale(s, 'navigated'); // left the provider origin → wrong tab now
      } else {
        s.url = url || s.url; s.updatedAt = now();
      }
      return true;
    }

    function onLoggedOut(tabId) {
      var s = sessions.get(tabId);
      if (!s) return false;
      markStale(s, 'logged_out');
      return true;
    }

    function onClosed(tabId) {
      var s = sessions.get(tabId);
      if (!s) return false;
      // Keep any lease mapping so a pending resolveTarget() reports GONE (and
      // cleans the lease up lazily) instead of a generic NO_LEASE.
      sessions.delete(tabId);
      return true;
    }

    // Service-worker restart reconciliation: drop any session whose tab is no
    // longer live. Returns the count dropped.
    function rehydrate(liveTabIds) {
      var live = new Set([].concat(liveTabIds || []));
      var dropped = 0;
      sessions.forEach(function (s, tabId) {
        if (!live.has(tabId)) { if (s.leaseId) leases.delete(s.leaseId); sessions.delete(tabId); dropped++; }
      });
      return dropped;
    }

    return {
      register: register, get: get, lease: lease, resolveTarget: resolveTarget, release: release,
      onNavigated: onNavigated, onLoggedOut: onLoggedOut, onClosed: onClosed, rehydrate: rehydrate,
      size: function () { return sessions.size; },
      leaseCount: function () { return leases.size; },
    };
  }

  global.SEOSONA_ProviderSessionRegistry = {
    REASONS: REASONS,
    create: create,
    originOf: originOf,
  };
})(typeof self !== 'undefined' ? self : this);
