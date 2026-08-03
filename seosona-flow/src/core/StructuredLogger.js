// SEOSONA Flow — Structured Logger (Phase 10 / P10.T1, AUD-030).
// Classic script, headless. Emits structured, privacy-filtered events with a
// component, severity, event name, and correlation id. Content is OFF by default
// (payloads reduce to metadata via PrivacyFilter); enabling content is an
// explicit, local-only choice. A bounded ring buffer keeps memory finite and
// tolerates circular data. No Date — the caller stamps time.
(function (global) {
  'use strict';

  var LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

  function create(cfg) {
    cfg = cfg || {};
    var sink = cfg.sink || null;
    var pf = cfg.privacyFilter || global.SEOSONA_PrivacyFilter || null;
    var minLevel = LEVELS[cfg.level] || LEVELS.info;
    var contentEnabled = cfg.contentEnabled === true; // default OFF
    var cap = cfg.bufferSize > 0 ? cfg.bufferSize : 500;
    var buffer = [];

    function filterData(data) {
      if (data == null) return null;
      if (!pf) {
        try { return JSON.parse(JSON.stringify(data)); } catch (_) { return { kind: 'unserializable' }; }
      }
      return pf.filter(data, { keepContent: contentEnabled });
    }

    function emit(component, severity, event, data, correlationId, ts) {
      var lvl = LEVELS[severity] || LEVELS.info;
      if (lvl < minLevel) return null;
      var record = {
        ts: typeof ts === 'number' ? ts : null,
        component: String(component || 'unknown'),
        severity: severity in LEVELS ? severity : 'info',
        event: String(event || ''),
        correlationId: correlationId != null ? String(correlationId) : null,
        data: filterData(data),
      };
      buffer.push(record);
      if (buffer.length > cap) buffer.shift();
      if (sink && typeof sink[record.severity] === 'function') {
        try { sink[record.severity]('[' + record.component + '] ' + record.event, record.data); } catch (_) { /* sink best-effort */ }
      }
      return record;
    }

    return {
      debug: function (c, e, d, id, ts) { return emit(c, 'debug', e, d, id, ts); },
      info: function (c, e, d, id, ts) { return emit(c, 'info', e, d, id, ts); },
      warn: function (c, e, d, id, ts) { return emit(c, 'warn', e, d, id, ts); },
      error: function (c, e, d, id, ts) { return emit(c, 'error', e, d, id, ts); },
      emit: emit,
      recent: function (n) { return buffer.slice(-(n || buffer.length)); },
      size: function () { return buffer.length; },
      setContentEnabled: function (v) { contentEnabled = v === true; },
      isContentEnabled: function () { return contentEnabled; },
    };
  }

  global.SEOSONA_StructuredLogger = { LEVELS: LEVELS, create: create };
})(typeof self !== 'undefined' ? self : this);
