// SEOSONA Flow — Message Schemas (Phase 4 / P4.T4, AUD-013).
// Classic worker script. Validates runtime message envelopes before side
// effects and provides bounded legacy adapters. Rejects prototype-pollution
// keys and oversized payloads.
(function (global) {
  'use strict';

  var MESSAGE_VERSION = 1;
  var DANGEROUS_KEYS = ['__proto__', 'prototype', 'constructor'];
  var DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5MB envelope cap

  function hasDangerousKey(obj, depth) {
    depth = depth || 0;
    if (depth > 6 || !obj || typeof obj !== 'object') return false;
    for (var k in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, k)) continue;
      if (DANGEROUS_KEYS.indexOf(k) !== -1) return true;
      if (hasDangerousKey(obj[k], depth + 1)) return true;
    }
    return false;
  }

  function byteLength(value) {
    try { return JSON.stringify(value).length; } catch (_) { return Infinity; }
  }

  // Normalize legacy shapes: {type} -> {action}, missing version -> 0 (legacy).
  function migrate(msg) {
    if (!msg || typeof msg !== 'object') return msg;
    var out = {};
    for (var k in msg) if (Object.prototype.hasOwnProperty.call(msg, k)) out[k] = msg[k];
    if (out.action == null && typeof out.type === 'string') out.action = out.type;
    if (out.version == null) out.version = 0;
    return out;
  }

  // validateEnvelope(msg, opts) -> { valid, version, action, errors:[] }
  function validateEnvelope(msg, opts) {
    opts = opts || {};
    var maxBytes = opts.maxBytes != null ? opts.maxBytes : DEFAULT_MAX_BYTES;
    var errors = [];
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
      return { valid: false, version: null, action: null, errors: ['NOT_AN_OBJECT'] };
    }
    var action = msg.action != null ? msg.action : msg.type;
    if (typeof action !== 'string' || action.length === 0) errors.push('MISSING_ACTION');
    if (action != null && action.length > 128) errors.push('ACTION_TOO_LONG');
    if (hasDangerousKey(msg)) errors.push('DANGEROUS_KEY');
    if (byteLength(msg) > maxBytes) errors.push('PAYLOAD_TOO_LARGE');
    var version = typeof msg.version === 'number' ? msg.version : 0;
    if (version > MESSAGE_VERSION) errors.push('FUTURE_VERSION');
    return { valid: errors.length === 0, version: version, action: action || null, errors: errors };
  }

  global.SEOSONA_MessageSchemas = {
    MESSAGE_VERSION: MESSAGE_VERSION,
    validateEnvelope: validateEnvelope,
    migrate: migrate,
    hasDangerousKey: hasDangerousKey,
  };
})(typeof self !== 'undefined' ? self : this);
