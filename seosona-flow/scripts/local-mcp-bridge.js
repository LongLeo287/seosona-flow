/**
 * LocalMcpBridge — cầu nối LOCAL giữa extension (sidebar) và Local MCP server (Node).
 *
 * Vì sao cần file này:
 *   - SEOSONA Flow chạy LOCAL mode mặc định (RuntimeMode.isLocal() === true): SSE tắt, ApiClient chặn
 *     outbound, nên KHÔNG có transport nào đẩy lệnh `ai_command` vào McpExecutor và cũng không có nơi
 *     nhận kết quả. McpExecutor pipeline vẫn chạy đầy đủ (FeatureGate + quota đều pass ở local mode).
 *   - MV3 extension KHÔNG thể mở socket server. Nên ta chạy 1 Node MCP server nhỏ ở mcp-local/ vừa là
 *     MCP stdio server (Claude Code / Cursor gọi) vừa là WebSocket SERVER trên 127.0.0.1. Sidebar page
 *     này là WS CLIENT — đóng vai "SSE client" trong kiến trúc cũ, Node server đóng vai "backend".
 *
 * Luồng:
 *   Node server  --(ws: ai_command)-->  bridge  --(eventBus.emit 'sse:ai_command')-->  McpExecutor
 *   McpExecutor  --(eventBus 'mcp:local_result')-->  bridge  --(ws: result)-->  Node server  --> agent
 *
 * Bảo mật: chỉ nối loopback 127.0.0.1. Server phía Node CHẶN mọi origin web (http/https) ở handshake
 *   nên trang web bất kỳ KHÔNG mở được ws tới port này để cướp kênh. Thêm shared-secret tuỳ chọn qua
 *   chrome.storage.local['seosonaLocalMcp'].token (khớp SEOSONA_LOCAL_MCP_TOKEN của server): khi CÓ
 *   token, client gửi nonce và chỉ nhận lệnh sau khi server chứng minh giữ token (hello_ack.proof =
 *   HMAC(token, nonce)) → chống server local giả mạo chiếm port. Mặc định (không token) = no-auth trên
 *   localhost nhưng vẫn được Origin-check bảo vệ khỏi web. KHUYẾN NGHỊ đặt token.
 *
 * KHÔNG can thiệp các tính năng khác: chỉ hoạt động khi RuntimeMode.isLocal() và chỉ đụng McpExecutor
 *   qua eventBus (đúng path mà backend SSE vẫn dùng). Tắt bằng cách gỡ <script> include trong sidebar.html.
 */
(function () {
  'use strict';

  var DEFAULTS = { enabled: true, port: 8765, host: '127.0.0.1', token: '' };

  var LocalMcpBridge = {
    _ws: null,
    _cfg: null,
    _reconnectTimer: null,
    _retry: 0,
    _resultListenerBound: false,
    _started: false,
    _nonce: null,
    _serverTrusted: false,   // only honor ai_command once the server side is trusted

    // Random hex nonce for the server to sign (proves the server holds the shared token).
    _genNonce: function () {
      try {
        var a = crypto.getRandomValues(new Uint8Array(16));
        var s = ''; for (var i = 0; i < a.length; i++) s += a[i].toString(16).padStart(2, '0');
        return s;
      } catch (_) { return String(Date.now()) + '.' + Math.floor(performance.now()); }
    },

    // HMAC-SHA256(key, msg) → lowercase hex, via SubtleCrypto.
    _hmacHex: async function (keyStr, msgStr) {
      var enc = new TextEncoder();
      var key = await crypto.subtle.importKey('raw', enc.encode(keyStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      var sig = await crypto.subtle.sign('HMAC', key, enc.encode(msgStr));
      var b = new Uint8Array(sig); var hex = '';
      for (var i = 0; i < b.length; i++) hex += b[i].toString(16).padStart(2, '0');
      return hex;
    },

    isLocal: function () {
      try {
        if (window.RuntimeMode && typeof window.RuntimeMode.isLocal === 'function') return window.RuntimeMode.isLocal();
        return self.SEOSONA_LOCAL_MODE !== false;
      } catch (_) { return true; }
    },

    _loadCfg: function () {
      return new Promise(function (resolve) {
        try {
          chrome.storage.local.get(['seosonaLocalMcp'], function (res) {
            var c = (res && res.seosonaLocalMcp) || {};
            resolve({
              enabled: c.enabled !== false,
              port: Number(c.port) || DEFAULTS.port,
              host: c.host || DEFAULTS.host,
              token: c.token || DEFAULTS.token,
            });
          });
        } catch (_) { resolve(Object.assign({}, DEFAULTS)); }
      });
    },

    init: async function () {
      if (this._started) return;
      if (!this.isLocal()) { console.log('[LocalMcpBridge] online mode → bỏ qua (dùng backend SSE)'); return; }
      this._cfg = await this._loadCfg();
      if (!this._cfg.enabled) { console.log('[LocalMcpBridge] đã tắt qua setting seosonaLocalMcp.enabled=false'); return; }
      this._started = true;
      this._bindResultListener();
      this._connect();
      console.log('[LocalMcpBridge] khởi tạo — sẽ nối ws://' + this._cfg.host + ':' + this._cfg.port);
    },

    _bindResultListener: function () {
      if (this._resultListenerBound) return;
      this._resultListenerBound = true;
      var self_ = this;
      // McpExecutor._sendResult emit body {job_id,status,thumbnails?/error_*,...} ở local mode.
      window.eventBus && window.eventBus.on('mcp:local_result', function (body) {
        self_._send({ type: 'result', payload: body });
      });
      // Progress streaming: McpExecutor._emitProgress → server → MCP notifications/progress.
      window.eventBus && window.eventBus.on('mcp:local_progress', function (body) {
        self_._send({ type: 'progress', payload: body });
      });
    },

    _connect: function () {
      if (this._ws && (this._ws.readyState === 0 || this._ws.readyState === 1)) return;
      var url = 'ws://' + this._cfg.host + ':' + this._cfg.port + '/';
      var ws;
      try { ws = new WebSocket(url); } catch (e) { console.warn('[LocalMcpBridge] WS lỗi tạo:', e && e.message); this._scheduleReconnect(); return; }
      this._ws = ws;
      var self_ = this;

      ws.onopen = function () {
        self_._retry = 0;
        // Handshake: gửi hello + nonce. Nếu KHÔNG cấu hình token → tin server ngay (no-auth localhost).
        // Nếu CÓ token → chỉ tin server sau khi nó chứng minh giữ token (hello_ack.proof) — chống
        // server local giả mạo chiếm port. ai_command bị bỏ qua tới khi _serverTrusted = true.
        self_._nonce = self_._genNonce();
        self_._serverTrusted = !self_._cfg.token;
        self_._send({ type: 'hello', role: 'extension', token: self_._cfg.token || '', nonce: self_._nonce, ext: 'seosona-flow' });
        console.log('[LocalMcpBridge] đã nối Local MCP server' + (self_._cfg.token ? ' — chờ xác thực server…' : ''));
        window.showNotification && window.showNotification('Local MCP: đã kết nối', 'success');
      };

      ws.onmessage = function (ev) {
        var msg;
        try { msg = JSON.parse(ev.data); } catch (_) { return; }
        self_._onMessage(msg);
      };

      ws.onclose = function () { self_._ws = null; self_._scheduleReconnect(); };
      ws.onerror = function () { try { ws.close(); } catch (_) { globalThis.SEOSONA_swallow?.('local-mcp-bridge#onerror', _); } };
    },

    _scheduleReconnect: function () {
      if (this._reconnectTimer) return;
      var self_ = this;
      // backoff 2s → tối đa 30s; giữ chạy để khi user mở Node server là nối lại ngay.
      var delay = Math.min(2000 * Math.pow(1.6, this._retry), 30000);
      this._retry++;
      this._reconnectTimer = setTimeout(function () { self_._reconnectTimer = null; self_._connect(); }, delay);
    },

    _send: function (obj) {
      try { if (this._ws && this._ws.readyState === 1) this._ws.send(JSON.stringify(obj)); } catch (_) { globalThis.SEOSONA_swallow?.('local-mcp-bridge#_send', _); }
    },

    _onMessage: function (msg) {
      if (!msg || !msg.type) return;
      if (msg.type === 'ping') { this._send({ type: 'pong' }); return; }
      // Server chứng minh giữ token (HMAC over nonce). Không token → tin ngay (đã set ở onopen).
      if (msg.type === 'hello_ack') {
        if (!this._cfg.token) { this._serverTrusted = true; return; }
        var self_ = this;
        this._hmacHex(this._cfg.token, this._nonce || '').then(function (expected) {
          if (msg.proof && msg.proof === expected) {
            self_._serverTrusted = true;
            console.log('[LocalMcpBridge] server đã xác thực (token khớp)');
          } else {
            self_._serverTrusted = false;
            console.warn('[LocalMcpBridge] server KHÔNG chứng minh được token → ngắt kết nối (nghi giả mạo)');
            try { self_._ws && self_._ws.close(4010, 'server auth failed'); } catch (_) { globalThis.SEOSONA_swallow?.('local-mcp-bridge#_onMessage', _); }
          }
        }).catch(function () { self_._serverTrusted = false; });
        return;
      }
      if (msg.type === 'ai_command') {
        // Chặn lệnh cho tới khi server được tin (chống server local giả mạo khi có token).
        if (!this._serverTrusted) { console.warn('[LocalMcpBridge] bỏ qua ai_command: server chưa xác thực'); return; }
        var job_id = msg.job_id;
        var command = msg.command;
        var args = msg.args || {};
        if (!job_id || !command) return;
        // ĐÚNG path mà backend SSE vẫn dùng: McpExecutor.init() đã subscribe 'sse:ai_command'.
        if (!window.eventBus || !window.McpExecutor) {
          this._send({ type: 'result', payload: { job_id: job_id, status: 'failed', error_code: 'GEN_FAILED', error_message: 'Extension chưa sẵn sàng (McpExecutor/eventBus thiếu)' } });
          return;
        }
        console.log('[LocalMcpBridge] nhận lệnh', command, job_id);
        window.eventBus.emit('sse:ai_command', { command: command, args: args, job_id: job_id });
        return;
      }
      if (msg.type === 'ai_cancel') {
        if (!this._serverTrusted) return;
        if (window.eventBus) window.eventBus.emit('sse:ai_cancel', { job_id: msg.job_id });
        return;
      }
    },
  };

  window.LocalMcpBridge = LocalMcpBridge;

  // Tự khởi tạo khi DOM sẵn sàng (sidebar). Đợi 1 nhịp để McpExecutor.init() (trong app.js) chạy trước.
  function boot() { setTimeout(function () { LocalMcpBridge.init(); }, 1500); }
  if (document.readyState === 'complete' || document.readyState === 'interactive') boot();
  else document.addEventListener('DOMContentLoaded', boot);
})();
