// SEOSONA Flow — Media Result normalization (Phase 6 / P6.T6, AUD-020).
// Classic worker script, pure/headless. Turns whatever a provider scraped
// (an <img> src, a blob URL, a download anchor, a data URI) into ONE normalized,
// policy-checked media descriptor. Goals:
//   - Valid media normalizes once and downloads once (stable dedupe key).
//   - Invalid/placeholder/auth-bearing media fails EARLY with a stable reason.
//   - Filenames are sanitized (no path traversal, bounded, extension matches MIME).
// No network, no DOM — callers pass already-extracted fields.
(function (global) {
  'use strict';

  var KIND_BY_MIME = {
    'image/png': 'image', 'image/jpeg': 'image', 'image/jpg': 'image',
    'image/webp': 'image', 'image/gif': 'image', 'image/avif': 'image',
    'video/mp4': 'video', 'video/webm': 'video', 'video/quicktime': 'video',
  };
  var EXT_BY_MIME = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp',
    'image/gif': 'gif', 'image/avif': 'avif',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  };

  var MAX_BYTES = 64 * 1024 * 1024; // 64 MiB hard cap — reject obviously-wrong sizes
  var MIN_DIM = 8;                  // smaller than this is a placeholder/spinner
  var MAX_NAME = 120;

  var REASONS = {
    NO_URL: 'no_url',
    BAD_SCHEME: 'bad_scheme',
    AUTH_IN_URL: 'auth_in_url',
    BAD_MIME: 'bad_mime',
    PLACEHOLDER: 'placeholder',
    TOO_LARGE: 'too_large',
    EXPIRED: 'expired',
    TINY: 'tiny_dimensions',
  };

  function scheme(url) {
    var m = /^([a-z][a-z0-9+.-]*):/i.exec(String(url || ''));
    return m ? m[1].toLowerCase() : '';
  }

  // A URL leaks credentials if it has userinfo or a CREDENTIAL query param.
  // Signed-URL params (sig/signature/x-*-signature) are the intended CDN
  // delivery mechanism — NOT credential leaks. Only reject bearer-style creds.
  function urlCarriesAuth(url) {
    var s = String(url || '');
    if (/^https?:\/\/[^/@]*@/i.test(s)) return true; // user:pass@host
    return /[?&](access_token|id_token|refresh_token|bearer|jwt|apikey|api[_-]?key|x-api-key|password)=/i.test(s);
  }

  // Sanitize a proposed filename: last path segment only, drop the existing
  // extension, delete anything outside [A-Za-z0-9._-], trim, then append the
  // canonical extension for the MIME. Never traverses, never hides.
  function sanitizeName(name, mime, fallbackBase) {
    var raw = String(name || fallbackBase || 'media');
    // Last path segment only (defeats ../ and absolute paths, both separators).
    var base = raw.split(/[\\/]/).pop() || 'media';
    // Strip an existing extension; we re-append the canonical one.
    base = base.replace(/\.[A-Za-z0-9]{1,5}$/, '');
    // Keep only safe chars (deletes spaces, punctuation, control chars).
    base = base.replace(/[^A-Za-z0-9._-]+/g, '');
    // Collapse dot runs, trim leading/trailing dots and dashes (no hidden files).
    base = base.replace(/\.{2,}/g, '.').replace(/^[-.]+|[-.]+$/g, '');
    if (!base) base = 'media';
    if (base.length > MAX_NAME) base = base.slice(0, MAX_NAME);
    var ext = EXT_BY_MIME[mime] || 'bin';
    return base + '.' + ext;
  }

  // Stable dedupe key: content hash if provided, else scheme+host+path (query
  // stripped, since signed URLs vary per fetch but point at the same asset).
  function dedupeKey(url, hash) {
    if (hash) return 'h:' + String(hash);
    var s = String(url || '');
    if (/^(blob|data):/i.test(s)) {
      // blob:/data: are per-page ephemeral; hash the payload prefix instead.
      return 'x:' + s.slice(0, 128);
    }
    var noQuery = s.replace(/[?#].*$/, '');
    return 'u:' + noQuery;
  }

  function fail(reason) { return { ok: false, reason: reason }; }

  // raw: { url, mime, width, height, bytes, name|filename, hash, expiresAt, now }
  function normalize(raw, opts) {
    raw = raw || {};
    opts = opts || {};
    var url = raw.url || raw.src || raw.href;
    if (!url) return fail(REASONS.NO_URL);

    var sc = scheme(url);
    // Allow only safe schemes. http (cleartext) is rejected by policy.
    if (sc !== 'https' && sc !== 'blob' && sc !== 'data') return fail(REASONS.BAD_SCHEME);
    if (urlCarriesAuth(url)) return fail(REASONS.AUTH_IN_URL);

    var mime = String(raw.mime || raw.type || '').toLowerCase().split(';')[0].trim();
    var kind = KIND_BY_MIME[mime];
    if (!kind) return fail(REASONS.BAD_MIME);

    // Placeholder detection: tiny data URIs (spinners), or explicit flag.
    if (raw.placeholder === true) return fail(REASONS.PLACEHOLDER);
    if (sc === 'data' && String(url).length < 64) return fail(REASONS.PLACEHOLDER);

    var w = Number(raw.width) || 0;
    var h = Number(raw.height) || 0;
    if ((w > 0 && w < MIN_DIM) || (h > 0 && h < MIN_DIM)) return fail(REASONS.TINY);

    var bytes = Number(raw.bytes) || 0;
    if (bytes > MAX_BYTES) return fail(REASONS.TOO_LARGE);

    // Expiry: caller provides current epoch via opts.now / raw.now (no Date here).
    var now = typeof opts.now === 'number' ? opts.now : (typeof raw.now === 'number' ? raw.now : null);
    if (raw.expiresAt != null && now != null && Number(raw.expiresAt) <= now) {
      return fail(REASONS.EXPIRED);
    }

    return {
      ok: true,
      kind: kind,
      url: String(url),
      mime: mime,
      width: w || null,
      height: h || null,
      bytes: bytes || null,
      filename: sanitizeName(raw.name || raw.filename, mime, opts.fallbackBase),
      dedupeKey: dedupeKey(url, raw.hash),
      expiresAt: raw.expiresAt != null ? Number(raw.expiresAt) : null,
    };
  }

  // Normalize + dedupe a batch; keeps first occurrence, drops later duplicates
  // and invalids. Returns { items:[valid…], rejected:[{reason}…], seen:count }.
  function collect(rawList, opts) {
    var out = [];
    var rejected = [];
    var seen = {};
    var list = [].concat(rawList || []);
    for (var i = 0; i < list.length; i++) {
      var r = normalize(list[i], opts);
      if (!r.ok) { rejected.push(r); continue; }
      if (seen[r.dedupeKey]) continue;
      seen[r.dedupeKey] = true;
      out.push(r);
    }
    return { items: out, rejected: rejected, seen: list.length };
  }

  global.SEOSONA_MediaResult = {
    REASONS: REASONS,
    normalize: normalize,
    collect: collect,
    sanitizeName: sanitizeName,
    dedupeKey: dedupeKey,
    urlCarriesAuth: urlCarriesAuth,
  };
})(typeof self !== 'undefined' ? self : this);
