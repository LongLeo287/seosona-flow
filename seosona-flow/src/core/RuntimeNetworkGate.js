// SEOSONA Flow — Runtime Network Gate (Phase 3 / P3.T4, SEC-003 / FIND-002).
// Classic worker script. One place that decides whether a network initiator is
// allowed in the current runtime mode. In LOCAL mode, backend/control-plane
// traffic (enrollment, config prefetch, SSE, API) is denied; user-initiated
// provider traffic is always allowed. Observe-only unless enforcing.
(function (global) {
  'use strict';

  // Known first-party provider destinations (user-facing automation targets).
  var PROVIDER_HOST_RE = [
    /(^|\.)labs\.google$/, /(^|\.)google\.com$/, /(^|\.)googleapis\.com$/,
    /(^|\.)flow-content\.google$/, /(^|\.)chatgpt\.com$/, /(^|\.)openai\.com$/,
    /(^|\.)gemini\.google\.com$/, /(^|\.)claude\.ai$/, /(^|\.)grok\.com$/,
    /(^|\.)x\.com$/, /(^|\.)x\.ai$/,
  ];

  // Extension backend / control-plane hints.
  var backendHosts = ['localhost', '127.0.0.1'];
  var BACKEND_HOST_RE = [/(^|\.)seosona\.vn$/];
  var BACKEND_PATH_RE = [/\/api\//, /\/\.well-known\/mercure/, /\/enroll/, /\/mercure/];

  function setBackendHosts(hosts) {
    if (Array.isArray(hosts)) backendHosts = hosts.slice();
  }

  function hostMatches(host, list) {
    return list.some(function (re) { return re.test(host); });
  }

  function classifyTraffic(urlString) {
    var url;
    try { url = new URL(urlString); } catch (_) { return 'invalid'; }
    var host = (url.hostname || '').toLowerCase();
    if (hostMatches(host, PROVIDER_HOST_RE)) return 'provider';
    if (backendHosts.indexOf(host) !== -1) return 'backend';
    if (hostMatches(host, BACKEND_HOST_RE)) return 'backend';
    if (BACKEND_PATH_RE.some(function (re) { return re.test(url.pathname); })) return 'backend';
    return 'other';
  }

  // decision: { allowed, reason, class }
  function guard(urlString, opts) {
    opts = opts || {};
    var localMode = !!opts.localMode;
    var userInitiated = !!opts.userInitiated;
    var cls = classifyTraffic(urlString);
    var decision = { allowed: true, reason: null, class: cls };
    if (localMode && cls === 'backend' && !userInitiated) {
      decision.allowed = false;
      decision.reason = 'LOCAL_MODE_BACKEND_BLOCKED';
    }
    return decision;
  }

  global.SEOSONA_RuntimeNetworkGate = {
    classifyTraffic: classifyTraffic,
    guard: guard,
    setBackendHosts: setBackendHosts,
    PROVIDER_HOST_RE: PROVIDER_HOST_RE,
  };
})(typeof self !== 'undefined' ? self : this);
