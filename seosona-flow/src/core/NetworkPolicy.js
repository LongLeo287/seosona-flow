// SEOSONA Flow — Network Policy (Phase 3 / P3.T3, SEC-002 / FIND-001).
// Classic worker script. Validates privileged-fetch targets on EVERY hop:
// scheme allowlist, private/loopback/link-local/metadata address denial,
// bounded redirects, size caps, and abort deadlines.
//
// Limitation: DNS rebinding cannot be resolved here (no DNS API in the worker);
// literal private IPs and known-internal hostnames are denied. Final-destination
// safety comes from re-validating each redirect hop.
(function (global) {
  'use strict';

  var DEFAULT_SCHEMES = ['https:', 'http:', 'blob:', 'data:'];

  function NetworkPolicyError(reason, url) {
    var e = new Error('NetworkPolicy: ' + reason + (url ? ' (' + url + ')' : ''));
    e.name = 'NetworkPolicyError';
    e.reason = reason;
    e.url = url;
    return e;
  }

  function isIpv4(host) { return /^\d{1,3}(\.\d{1,3}){3}$/.test(host); }

  function isPrivateIpv4(host) {
    var p = host.split('.').map(Number);
    if (p.length !== 4 || p.some(function (n) { return n > 255; })) return true; // malformed -> deny
    if (p[0] === 10) return true;                       // 10.0.0.0/8
    if (p[0] === 127) return true;                      // loopback
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // 172.16/12
    if (p[0] === 192 && p[1] === 168) return true;      // 192.168/16
    if (p[0] === 169 && p[1] === 254) return true;      // link-local + metadata 169.254.169.254
    if (p[0] === 0) return true;                        // 0.0.0.0/8
    if (p[0] >= 224) return true;                       // multicast/reserved
    return false;
  }

  function isPrivateHost(host) {
    if (!host) return true;
    host = host.toLowerCase().replace(/^\[|\]$/g, '');
    if (host === 'localhost' || /\.local$|\.internal$|\.localhost$/.test(host)) return true;
    if (isIpv4(host)) return isPrivateIpv4(host);
    // IPv6 loopback / unique-local / link-local
    if (host === '::1' || host === '::') return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;   // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true;   // fe80::/10 link-local
    return false;
  }

  function validateTarget(urlString, opts) {
    opts = opts || {};
    var schemes = opts.allowedSchemes || DEFAULT_SCHEMES;
    var allowPrivate = !!opts.allowPrivate;
    var url;
    try { url = new URL(urlString); } catch (_) { return { allowed: false, reason: 'INVALID_URL' }; }
    if (schemes.indexOf(url.protocol) === -1) return { allowed: false, reason: 'DISALLOWED_SCHEME' };
    // blob:/data: have no network host
    if (url.protocol === 'blob:' || url.protocol === 'data:') return { allowed: true, reason: null };
    if (!allowPrivate && isPrivateHost(url.hostname)) return { allowed: false, reason: 'PRIVATE_ADDRESS' };
    return { allowed: true, reason: null };
  }

  // Redirect-safe fetch: re-validates every hop, caps redirects/size, aborts on
  // deadline. `fetchImpl` is injected so it is testable and worker-agnostic.
  function createSafeFetch(fetchImpl, defaults) {
    defaults = defaults || {};
    var AbortCtor = (typeof AbortController !== 'undefined') ? AbortController : null;
    return async function safeFetch(urlString, options, ctx) {
      ctx = Object.assign({}, defaults, ctx || {});
      var maxRedirects = ctx.maxRedirects != null ? ctx.maxRedirects : 5;
      var maxBytes = ctx.maxBytes != null ? ctx.maxBytes : 25 * 1024 * 1024;
      var timeoutMs = ctx.timeoutMs != null ? ctx.timeoutMs : 15000;
      var current = urlString;
      var hops = 0;
      for (;;) {
        var v = validateTarget(current, ctx);
        if (!v.allowed) throw NetworkPolicyError(v.reason, current);
        var controller = AbortCtor ? new AbortCtor() : null;
        var timer = setTimeout(function () { if (controller) controller.abort(); }, timeoutMs);
        var resp;
        try {
          resp = await fetchImpl(current, Object.assign({}, options, {
            redirect: 'manual',
            signal: controller ? controller.signal : undefined,
          }));
        } finally { clearTimeout(timer); }
        var status = resp && resp.status;
        var location = resp && resp.headers && resp.headers.get && resp.headers.get('location');
        if (status >= 300 && status < 400 && location) {
          hops++;
          if (hops > maxRedirects) throw NetworkPolicyError('TOO_MANY_REDIRECTS', current);
          current = new URL(location, current).toString();
          continue; // validate the next hop before following
        }
        var len = Number((resp && resp.headers && resp.headers.get && resp.headers.get('content-length')) || 0);
        if (len && len > maxBytes) throw NetworkPolicyError('RESPONSE_TOO_LARGE', current);
        return resp;
      }
    };
  }

  global.SEOSONA_NetworkPolicy = {
    validateTarget: validateTarget,
    isPrivateHost: isPrivateHost,
    createSafeFetch: createSafeFetch,
    NetworkPolicyError: NetworkPolicyError,
    DEFAULT_SCHEMES: DEFAULT_SCHEMES,
  };
})(typeof self !== 'undefined' ? self : this);
