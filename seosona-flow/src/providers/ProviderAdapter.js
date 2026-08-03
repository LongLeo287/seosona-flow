// SEOSONA Flow — Provider Adapter contract (Phase 6 / P6.T1, AUD-018).
// Classic worker script, pure/headless. Formalizes the implicit contract the
// live provider content scripts already share (ChatGPT/Gemini/Grok) and pins
// down where the outliers (Claude = text-only heuristic; Flow = tile + MAIN-world
// bridge) DECLINE a capability rather than silently lacking it.
//
// The point: the workflow engine must be able to ask any provider the same
// questions and get either "here is my implementation" or an explicit,
// versioned "I do not support this" — never an undefined method or a surprise.
//
// This module does NOT touch the DOM or the network. It defines:
//   - CONTRACT_VERSION      — bump when the capability set changes
//   - CAPABILITIES          — canonical capability → method-name + required flag
//   - EVENTS                — the stable lifecycle event names an adapter emits
//   - validateProfile()     — a provider's capability DECLARATION is complete
//   - conform()             — a concrete adapter OBJECT matches its declaration
//   - PROVIDER_PROFILES     — the five shipped providers' declared dispositions
(function (global) {
  'use strict';

  var CONTRACT_VERSION = 1;

  // Canonical capabilities. `method` is the adapter function that implements it;
  // `required` capabilities may never be declined (every provider must have them).
  var CAPABILITIES = {
    readiness:    { method: 'waitReady',       required: true },
    login:        { method: 'checkStatus',     required: true },
    prompt:       { method: 'submitPrompt',    required: true },
    status:       { method: 'getStatus',       required: true },
    errors:       { method: 'normalizeError',  required: true },
    results:      { method: 'extractResults',  required: false },
    attachments:  { method: 'uploadAttachments', required: false },
    challenge:    { method: 'detectChallenge', required: false },
    cancellation: { method: 'cancel',          required: false },
    abort:        { method: 'onAbort',         required: false },
  };

  // Stable lifecycle events. Adapters report progress via these names only, so
  // the engine never branches on provider-specific strings.
  var EVENTS = ['ready', 'submitted', 'generating', 'complete', 'challenge', 'error', 'cancelled'];

  var CAP_NAMES = Object.keys(CAPABILITIES);

  // ---- Profile validation --------------------------------------------------
  // A "profile" is a pure declaration: { provider, version, supports:{cap:bool}, flags:{} }.
  // Complete = every capability is dispositioned true|false, required ones true.
  function validateProfile(profile) {
    var issues = [];
    if (!profile || typeof profile !== 'object') {
      return { valid: false, issues: [{ code: 'NO_PROFILE', path: '' }] };
    }
    if (profile.version !== CONTRACT_VERSION) {
      issues.push({ code: 'VERSION_MISMATCH', path: 'version', expected: CONTRACT_VERSION, actual: profile.version });
    }
    var supports = profile.supports || {};
    for (var i = 0; i < CAP_NAMES.length; i++) {
      var cap = CAP_NAMES[i];
      var v = supports[cap];
      if (typeof v !== 'boolean') {
        issues.push({ code: 'UNDECLARED_CAPABILITY', path: 'supports.' + cap });
        continue;
      }
      if (CAPABILITIES[cap].required && v !== true) {
        issues.push({ code: 'REQUIRED_DECLINED', path: 'supports.' + cap });
      }
    }
    // Reject capabilities that aren't part of the contract (typos / drift).
    for (var k in supports) {
      if (Object.prototype.hasOwnProperty.call(supports, k) && !CAPABILITIES[k]) {
        issues.push({ code: 'UNKNOWN_CAPABILITY', path: 'supports.' + k });
      }
    }
    return { valid: issues.length === 0, issues: issues };
  }

  // ---- Concrete adapter conformance ---------------------------------------
  // Given a live adapter object that carries `.profile` (its declaration) and
  // the capability methods, verify: supported caps expose a function; declined
  // caps do not pretend to (a stray declined method is a contract lie).
  function conform(adapter) {
    var issues = [];
    if (!adapter || typeof adapter !== 'object') {
      return { valid: false, issues: [{ code: 'NO_ADAPTER', path: '' }] };
    }
    var profileCheck = validateProfile(adapter.profile);
    for (var j = 0; j < profileCheck.issues.length; j++) {
      issues.push({ code: profileCheck.issues[j].code, path: 'profile.' + profileCheck.issues[j].path });
    }
    var supports = (adapter.profile && adapter.profile.supports) || {};
    for (var i = 0; i < CAP_NAMES.length; i++) {
      var cap = CAP_NAMES[i];
      var method = CAPABILITIES[cap].method;
      var declared = supports[cap] === true;
      var present = typeof adapter[method] === 'function';
      if (declared && !present) issues.push({ code: 'MISSING_METHOD', path: method, capability: cap });
      if (!declared && present) issues.push({ code: 'DECLINED_BUT_PRESENT', path: method, capability: cap });
    }
    return { valid: issues.length === 0, issues: issues };
  }

  // Machine-readable capability matrix for a profile (used by the provider matrix).
  function describe(profile) {
    var row = { provider: profile && profile.provider, version: profile && profile.version, capabilities: {} };
    var supports = (profile && profile.supports) || {};
    for (var i = 0; i < CAP_NAMES.length; i++) {
      var cap = CAP_NAMES[i];
      row.capabilities[cap] = supports[cap] === true ? 'implemented'
        : (supports[cap] === false ? 'declined' : 'undeclared');
    }
    return row;
  }

  // ---- Shipped provider profiles (grounded in content-script behavior) -----
  // ChatGPT / Gemini / Grok: full dynamic-selector providers with challenge
  // handling and media/text extraction. Grok+Gemini also upload attachments.
  // Claude: text-only heuristic adapter — declines attachments, results,
  // challenge (it has none). Flow: tile-based media via a MAIN-world bridge —
  // its "login" is a session refresh, it declines attachment upload here.
  function full(provider, over) {
    var s = {
      readiness: true, login: true, prompt: true, status: true, errors: true,
      results: true, attachments: true, challenge: true, cancellation: true, abort: true,
    };
    if (over) for (var k in over) if (Object.prototype.hasOwnProperty.call(over, k)) s[k] = over[k];
    return { provider: provider, version: CONTRACT_VERSION, supports: s, flags: {} };
  }

  var PROVIDER_PROFILES = {
    flow:    full('flow',    { attachments: true }),           // uploadFilesToFlow exists
    chatgpt: full('chatgpt', {}),
    gemini:  full('gemini',  {}),
    grok:    full('grok',    {}),
    claude:  full('claude',  { results: false, attachments: false, challenge: false }), // text-only, no captcha
  };
  // Flag the structural outliers so consumers can special-case transport.
  PROVIDER_PROFILES.flow.flags = { usesPageBridge: true, tileBasedMedia: true, loginIsSessionRefresh: true };
  PROVIDER_PROFILES.claude.flags = { textOnly: true, serverConfigSelectors: false };

  global.SEOSONA_ProviderAdapter = {
    CONTRACT_VERSION: CONTRACT_VERSION,
    CAPABILITIES: CAPABILITIES,
    EVENTS: EVENTS,
    validateProfile: validateProfile,
    conform: conform,
    describe: describe,
    PROVIDER_PROFILES: PROVIDER_PROFILES,
    providers: function () { return Object.keys(PROVIDER_PROFILES); },
  };
})(typeof self !== 'undefined' ? self : this);
