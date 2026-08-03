/**
 * FlowApiGateway — cổng gọi Flow API từ ngữ cảnh content script trên labs.google (Phase 1: READ-ONLY).
 *
 * Vì sao ở content script: script này chạy trên https://labs.google/fx/* nên request tới origin
 * labs.google là SAME-ORIGIN, dùng đúng session sẵn có — KHÔNG cần thêm quyền nào.
 *
 * Ranh giới cố ý của SEOSONA Flow API gateway:
 *   - Caller gửi **TÊN endpoint** trong spec, KHÔNG gửi URL thô ⇒ không thể biến cổng này thành
 *     proxy tuỳ ý.
 *   - Phase gate: chỉ endpoint readOnly + origin cho phép (mặc định 'trpc'). Origin API riêng bị
 *     chặn cứng vì cần host_permissions + Bearer + captcha ⇒ phải security review trước.
 *   - KHÔNG bắt token, KHÔNG sửa header, KHÔNG đụng webRequest/DNR.
 *   - Header nhạy cảm bị loại khỏi kết quả trả về; không log body/response.
 *   - Có giới hạn kích thước + timeout.
 *
 * Contract: chrome.runtime.sendMessage({ action:'flowApi:request', endpoint:'<tên>', query:{}, body:{} })
 *        → { ok, status, data?, headersSummary?, error?, reason? }
 */
(function (root) {
  'use strict';

  var ACTION = 'flowApi:request';

  function spec() { return root.FlowApiSpec; }

  function redactHeaders(headers, redactList) {
    var out = {};
    var deny = (redactList || []).map(function (h) { return String(h).toLowerCase(); });
    try {
      headers.forEach(function (value, key) {
        var k = String(key).toLowerCase();
        out[k] = deny.indexOf(k) >= 0 ? '[redacted]' : value;
      });
    } catch (_) { /* Headers không duyệt được → bỏ qua */ }
    return out;
  }

  function fail(error, extra) {
    var o = { ok: false, error: error };
    if (extra) for (var k of Object.keys(extra)) o[k] = extra[k];
    return o;
  }

  /** Xử lý 1 request. Luôn resolve (không throw) để caller nhận lỗi có mã rõ ràng. */
  async function handle(message) {
    var S = spec();
    if (!S) return fail('SPEC_MODULE_MISSING');

    // Chặn sớm: caller cố truyền URL thô → từ chối thẳng (đây là bất biến thiết kế, không phải lỗi gõ).
    if (message && (message.url || message.rawUrl)) return fail('RAW_URL_NOT_ALLOWED');

    var name = message && message.endpoint;
    if (typeof name !== 'string' || !name) return fail('ENDPOINT_REQUIRED');

    var sp = await S.load();
    var usable = S.isUsable(sp);
    if (!usable.usable) return fail('SPEC_NOT_USABLE', { reason: usable.reason, errors: usable.errors });

    var built = S.buildUrl(sp, name, message.query);
    if (!built.ok) return fail(built.error);

    var ep = built.endpoint;
    var limits = (sp && sp.limits) || {};
    var timeoutMs = Number(limits.timeoutMs) || 15000;
    var maxBytes = Number(limits.maxResponseBytes) || 2000000;

    var init = {
      method: String(ep.method || 'GET').toUpperCase(),
      credentials: 'include',
      headers: {},
    };
    if (init.method !== 'GET' && init.method !== 'HEAD' && message.body != null) {
      var bodyStr;
      try { bodyStr = typeof message.body === 'string' ? message.body : JSON.stringify(message.body); }
      catch (_) { return fail('BAD_BODY'); }
      if (bodyStr.length > (Number(limits.maxBodyBytes) || 262144)) return fail('BODY_TOO_LARGE');
      init.body = bodyStr;
      init.headers['content-type'] = ep.contentType || 'application/json';
    }

    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (ctrl) init.signal = ctrl.signal;
    var timer = setTimeout(function () { try { ctrl && ctrl.abort(); } catch (_) { globalThis.SEOSONA_swallow?.('FlowApiGateway#handle', _); } }, timeoutMs);

    try {
      var resp = await fetch(built.url, init);
      var text = await resp.text();
      clearTimeout(timer);
      if (text.length > maxBytes) return fail('RESPONSE_TOO_LARGE', { status: resp.status, bytes: text.length });

      var data;
      try { data = JSON.parse(text); } catch (_) { data = text; }

      return {
        ok: resp.ok,
        status: resp.status,
        data: data,
        headersSummary: redactHeaders(resp.headers, sp.redactHeaders),
      };
    } catch (e) {
      clearTimeout(timer);
      var msg = String((e && e.message) || e);
      return fail(/abort/i.test(msg) ? 'TIMEOUT' : 'NETWORK_ERROR');
    }
  }

  // Tự đăng ký listener — CHỈ nhận action của mình, mọi action khác trả false để không đụng
  // các listener sẵn có trong content.js (tránh lỗi double-handling đã từng gặp).
  function register() {
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.onMessage) return;
      chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
        if (!message || message.action !== ACTION) return false;
        handle(message).then(sendResponse, function (e) {
          sendResponse(fail('INTERNAL_ERROR', { detail: String((e && e.message) || e) }));
        });
        return true; // async
      });
    } catch (_) { /* ngoài ngữ cảnh extension → bỏ qua */ }
  }

  root.FlowApiGateway = { ACTION: ACTION, handle: handle, register: register, redactHeaders: redactHeaders };
  // KHÔNG tự register() nữa. Trước đây module tự mở listener 'flowApi:request' ngay khi load trên
  // MỌI trang labs.google/fx — trong khi KHÔNG code nào gửi action này (chỉ chính nó + registry
  // bảo mật khai báo tên). Đó là bề mặt gọi API bật sẵn cho tính năng chưa dùng.
  // Khi nào có tính năng cần: nạp lại script + gọi FlowApiGateway.register() TƯỜNG MINH.
})(typeof self !== 'undefined' ? self : this);
