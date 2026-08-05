// SEOSONA Flow — connector status evaluator.
// Pure state machine for future status-dot UI and provider/bridge readiness.
(function (global) {
  'use strict';

  var API = {};

  function warn(reason, action) {
    return { state: 'warn', reason: reason, action: action, canRun: false };
  }

  function evaluate(input) {
    input = input || {};
    if (!input.enabled) return { state: 'off', reason: 'DISABLED', action: null, canRun: false };
    if (!input.connectorInstalled) return warn('CONNECTOR_NOT_INSTALLED', 'open_connector_setup');
    if (input.permissionGranted === false) return warn('PERMISSION_MISSING', 'request_permission');
    if (!input.tokenReady) return warn('TOKEN_MISSING', 'open_auth');
    if (!input.providerTabOpen) return warn('PROVIDER_TAB_CLOSED', 'open_provider_tab');
    if (!input.providerReady) return warn('PROVIDER_NOT_READY', 'check_provider');
    return { state: 'ready', reason: 'READY', action: null, canRun: true };
  }

  async function handleMessage(message, opts) {
    opts = opts || {};
    if (opts.trusted === false) return { ok: false, error: 'UNTRUSTED_SENDER' };
    if (!message || message.action !== 'connectorStatus:evaluate') return { ok: false, error: 'UNKNOWN_ACTION' };
    return { ok: true, status: evaluate(message.input || message.status || {}) };
  }

  API.evaluate = evaluate;
  API.handleMessage = handleMessage;

  Object.defineProperty(global, 'SEOSONA_ConnectorStatus', {
    value: API,
    configurable: true,
    writable: true,
  });
})(typeof self !== 'undefined' ? self : this);
