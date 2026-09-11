(function (root) {
  'use strict';

  var DEFAULT_PORT = 8765;
  var LOOPBACK_HOST = '127.0.0.1';

  function normalize(current) {
    var value = current && typeof current === 'object' ? current : {};
    var host = value.host == null || value.host === '' ? LOOPBACK_HOST : String(value.host);
    var port = value.port == null || value.port === '' ? DEFAULT_PORT : Number(value.port);
    var token = value.token == null ? '' : String(value.token);

    if (host !== LOOPBACK_HOST) throw new Error('Local MCP host must be 127.0.0.1.');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Local MCP port must be an integer from 1 through 65535.');
    if (token.length < 16) throw new Error('Local MCP token must contain at least 16 characters.');

    return { enabled: value.enabled !== false, host: host, port: port, token: token };
  }

  async function activate(storageArea, input) {
    if (!storageArea || typeof storageArea.set !== 'function') throw new Error('A writable Chrome storage area is required.');
    var value = input && typeof input === 'object' ? input : {};
    var list = Array.isArray(value.list) ? value.list.slice() : [];
    var config = normalize(Object.assign({}, value.current || {}, { enabled: true, token: value.token }));

    await storageArea.set({ local_mcp_tokens: list, seosonaLocalMcp: config });
    return { enabled: config.enabled, host: config.host, port: config.port, hasToken: true };
  }

  root.SEOSONA_LocalMcpPairing = Object.freeze({ normalize: normalize, activate: activate });
})(typeof window !== 'undefined' ? window : self);
