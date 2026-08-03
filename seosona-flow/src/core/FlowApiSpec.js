/**
 * FlowApiSpec — nạp + validate spec LOCAL của Flow API (config/flow-api.json).
 *
 * Nguyên tắc (PLAN-flow-api-adapter.md · REPORT-flow-api-bridge-upgrade):
 *   - Spec để LOCAL, KHÔNG lấy từ server nào. Spec rỗng ⇒ isUsable()=false ⇒ tính năng nằm im.
 *   - Caller chỉ được gọi theo TÊN endpoint (command-level), KHÔNG truyền URL thô → không biến
 *     gateway thành proxy tuỳ ý (security lesson: không mở cổng proxy tuỳ ý).
 *   - Phase 1: chỉ cho endpoint readOnly trên origin được phép (mặc định 'trpc' = same-origin,
 *     không cần quyền mới). Origin 'api' bị chặn cứng tới khi có security review.
 *
 * API:
 *   FlowApiSpec.validate(spec) -> { ok, errors[] }
 *   FlowApiSpec.load()         -> Promise<spec|null>   (fetch qua chrome.runtime.getURL, cache)
 *   FlowApiSpec.isUsable(spec) -> { usable, reason }
 *   FlowApiSpec.resolve(spec, name) -> { ok, endpoint|error }
 *   FlowApiSpec.buildUrl(spec, name, query) -> { ok, url|error }
 */
(function (root) {
  'use strict';

  var METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'];

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  function validate(spec) {
    var e = [];
    if (!isObj(spec)) return { ok: false, errors: ['spec: phải là object'] };
    if (typeof spec.specVersion !== 'string') e.push('specVersion: thiếu');
    if (!isObj(spec.origins)) e.push('origins: thiếu');
    else {
      for (var k of Object.keys(spec.origins)) {
        var o = spec.origins[k];
        if (typeof o !== 'string' || !/^https:\/\/[a-z0-9.-]+$/i.test(o)) e.push('origins.' + k + ': phải là https origin thuần (không path)');
      }
    }
    if (!isObj(spec.phase)) e.push('phase: thiếu');
    else if (!Array.isArray(spec.phase.allowedOrigins)) e.push('phase.allowedOrigins: phải là mảng');
    if (!isObj(spec.endpoints)) e.push('endpoints: phải là object (có thể rỗng)');
    else {
      for (var name of Object.keys(spec.endpoints)) {
        var ep = spec.endpoints[name], p = 'endpoints.' + name;
        if (!isObj(ep)) { e.push(p + ': phải là object'); continue; }
        if (!isObj(spec.origins) || !spec.origins[ep.origin]) e.push(p + '.origin: không có trong origins');
        if (METHODS.indexOf(String(ep.method || '').toUpperCase()) < 0) e.push(p + '.method: không hợp lệ');
        if (typeof ep.path !== 'string' || ep.path[0] !== '/') e.push(p + '.path: phải bắt đầu bằng "/"');
        else if (/\.\.|\/\//.test(ep.path) || /^\/\//.test(ep.path)) e.push(p + '.path: chứa traversal hoặc protocol-relative');
        if (typeof ep.readOnly !== 'boolean') e.push(p + '.readOnly: phải là boolean');
      }
    }
    return { ok: e.length === 0, errors: e };
  }

  /** Spec dùng được chưa? Trả lý do RÕ để UI hiện "spec cần cập nhật" thay vì im lặng hỏng. */
  function isUsable(spec) {
    if (!spec) return { usable: false, reason: 'SPEC_MISSING' };
    var v = validate(spec);
    if (!v.ok) return { usable: false, reason: 'SPEC_INVALID', errors: v.errors };
    if (!Object.keys(spec.endpoints || {}).length) return { usable: false, reason: 'SPEC_EMPTY' };
    if (spec.status === 'draft-empty') return { usable: false, reason: 'SPEC_DRAFT' };
    return { usable: true, reason: 'OK' };
  }

  /** Lấy endpoint theo TÊN + áp gate của phase (readOnly / origin cho phép). */
  function resolve(spec, name) {
    if (!spec || !isObj(spec.endpoints)) return { ok: false, error: 'SPEC_MISSING' };
    var ep = spec.endpoints[name];
    if (!ep) return { ok: false, error: 'UNKNOWN_ENDPOINT' };
    var phase = spec.phase || {};
    if (phase.readOnly === true && ep.readOnly !== true) return { ok: false, error: 'WRITE_BLOCKED_IN_PHASE' };
    var allowed = Array.isArray(phase.allowedOrigins) ? phase.allowedOrigins : [];
    if (allowed.length && allowed.indexOf(ep.origin) < 0) return { ok: false, error: 'ORIGIN_BLOCKED_IN_PHASE' };
    return { ok: true, endpoint: ep };
  }

  /** Dựng URL tuyệt đối từ spec. Query chỉ nhận scalar; mọi thứ khác bị bỏ. */
  function buildUrl(spec, name, query) {
    var r = resolve(spec, name);
    if (!r.ok) return { ok: false, error: r.error };
    var base = spec.origins[r.endpoint.origin];
    var url;
    try { url = new URL(r.endpoint.path, base); } catch (_) { return { ok: false, error: 'BAD_PATH' }; }
    // Chốt chặn cuối: URL dựng ra PHẢI vẫn nằm đúng origin dự kiến (chống path lạ đổi origin).
    if (url.origin !== base) return { ok: false, error: 'ORIGIN_MISMATCH' };
    if (isObj(query)) {
      for (var k of Object.keys(query)) {
        var v = query[k];
        if (v == null) continue;
        var t = typeof v;
        if (t === 'string' || t === 'number' || t === 'boolean') url.searchParams.set(k, String(v));
      }
    }
    return { ok: true, url: url.toString(), endpoint: r.endpoint };
  }

  var _cache = null;
  function load() {
    if (_cache) return Promise.resolve(_cache);
    var u;
    try {
      u = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL('config/flow-api.json') : 'config/flow-api.json';
    } catch (_) { return Promise.resolve(null); }
    return fetch(u)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { _cache = j; return j; })
      .catch(function () { return null; });
  }

  root.FlowApiSpec = {
    validate: validate, isUsable: isUsable, resolve: resolve, buildUrl: buildUrl, load: load,
    _resetCache: function () { _cache = null; },
  };
})(typeof self !== 'undefined' ? self : this);
