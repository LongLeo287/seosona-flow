/**
 * CreditsPanel — thanh tín dụng Flow trên sidebar + cảnh báo trước khi chạy workflow.
 *
 * Ba trạng thái, mỗi trạng thái nói ĐÚNG một điều:
 *   · chưa mở Flow  → nút "Mở Google Flow" (bấm mới mở tab — không tự ý mở)
 *   · đọc được      → số dư + ước tính còn gen được bao nhiêu clip
 *   · chưa đọc được → nói thẳng chưa biết + cách xử lý. TUYỆT ĐỐI không hiện số bịa,
 *                     vì user sẽ lên kế hoạch gen dựa trên con số đó.
 *
 * Số dư được cache lại (af_flow_credits) để mở sidebar lần sau thấy ngay, kèm mốc thời gian —
 * số cũ vẫn hữu ích nhưng phải nói rõ là cũ, đừng giả vờ là vừa đọc xong.
 */
(function (root) {
  'use strict';

  var KEY = 'af_flow_credits';
  var STALE_MS = 10 * 60 * 1000;   // quá 10 phút thì coi là số cũ

  var _state = { known: false, credits: null, at: 0, reason: null, scanning: false };
  var _el = null;
  var _compact = false;   // true = bản gọn cho footer sidebar

  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function _send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (res) {
          if (chrome.runtime.lastError) return resolve({ ok: false, reason: 'NO_BACKGROUND' });
          resolve(res || { ok: false, reason: 'NO_RESPONSE' });
        });
      } catch (_) { resolve({ ok: false, reason: 'SEND_FAILED' }); }
    });
  }

  function _load() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([KEY], function (r) {
          var v = r && r[KEY];
          if (v && typeof v.credits === 'number') {
            _state.known = true; _state.credits = v.credits; _state.at = v.at || 0;
            _state.sku = v.sku || null; _state.via = v.via || null;
          }
          resolve();
        });
      } catch (_) { resolve(); }
    });
  }

  function _save() {
    try { chrome.storage.local.set({ [KEY]: { credits: _state.credits, at: _state.at } }); } catch (_) { globalThis.SEOSONA_swallow?.('CreditsPanel#_save', _); }
  }

  /** Ước tính còn gen được bao nhiêu clip với model rẻ nhất & đắt nhất — cho user thấy khoảng chạy. */
  function _estimates(credits) {
    var FC = root.FlowCredits;
    if (!FC || credits == null) return null;
    var picks = [
      { label: 'Omni Flash 4s', cost: FC.costOf('Omni Flash', 1, '4s') },
      { label: 'Veo 3.1 Fast', cost: FC.costOf('Veo 3.1 - Fast', 1) },
      { label: 'Veo 3.1 Quality', cost: FC.costOf('Veo 3.1 - Quality', 1) },
    ];
    return picks.filter(function (p) { return p.cost > 0; })
      .map(function (p) { return { label: p.label, runs: Math.floor(credits / p.cost) }; });
  }

  function _fmtAge(at) {
    if (!at) return '';
    var m = Math.floor((Date.now() - at) / 60000);
    if (m < 1) return 'vừa xong';
    if (m < 60) return m + ' phút trước';
    return Math.floor(m / 60) + ' giờ trước';
  }

  /**
   * Bản GỌN cho footer sidebar — chỗ rất hẹp nên chỉ hiện thứ tối thiểu:
   * số dư (hoặc lời mời mở Flow) + nút quét lại. Chi tiết đẩy vào tooltip.
   */
  function _renderCompact() {
    var s = _state;

    if (s.scanning) {
      _el.innerHTML = '<span class="afc-dot afc-wait"></span><span class="afc-c-txt">Đang quét…</span>';
      return;
    }

    if (s.known && s.credits != null) {
      var stale = Date.now() - s.at > STALE_MS;
      var est = _estimates(s.credits) || [];
      var tip = 'Tín dụng Google Flow · cập nhật ' + _fmtAge(s.at) +
        (s.sku ? '\nGói: ' + s.sku : '') +
        (s.via === 'api' ? '\n(đọc trực tiếp từ Flow — không cần thao tác)' : '') +
        (est.length ? '\n' + est.map(function (e) { return e.runs + ' clip ' + e.label; }).join('\n') : '') +
        '\nBấm để quét lại';
      _el.innerHTML =
        '<button type="button" class="afc-c-btn" id="afcRescan" title="' + _esc(tip) + '">' +
          '<span class="afc-dot ' + (s.credits > 0 ? 'afc-ok' : 'afc-low') + (stale ? ' afc-stale-dot' : '') + '"></span>' +
          '<b class="afc-c-num">' + s.credits + '</b>' +
          '<span class="afc-c-unit">tín dụng</span>' +
        '</button>';
      var b = _el.querySelector('#afcRescan');
      if (b) b.addEventListener('click', function () { scan(true); });
      return;
    }

    var msg = 'Chưa rõ tín dụng', cta = 'Quét';
    if (s.reason === 'FLOW_NOT_OPEN') { msg = 'Chưa mở Google Flow'; cta = 'Mở Flow'; }
    else if (s.reason === 'NEED_USER_ACTION') {
      msg = 'Bấm ảnh đại diện góc phải trên trang Flow — số dư sẽ tự được ghi nhớ';
      cta = 'Xem cách';
    }
    else if (s.reason === 'CONTENT_NOT_READY') msg = 'Trang Flow chưa sẵn sàng';
    else if (s.reason === 'NO_ACCOUNT_BUTTON') msg = 'Không thấy nút tài khoản trên trang Flow';
    else if (s.reason === 'NOT_FOUND_AFTER_OPEN') msg = 'Flow có thể đã đổi cách hiển thị số dư';

    _el.innerHTML =
      '<button type="button" class="afc-c-btn afc-c-cta" id="afcScan" title="' + _esc(msg) + ' — bấm để quét tín dụng Google Flow">' +
        '<span class="afc-dot afc-unknown"></span>' +
        '<span class="afc-c-unit">' + _esc(cta) + '</span>' +
      '</button>';
    var btn = _el.querySelector('#afcScan');
    if (btn) btn.addEventListener('click', function () { scan(true); });
  }

  function render() {
    if (!_el) return;
    if (_compact) return _renderCompact();
    var s = _state;

    if (s.scanning) {
      _el.innerHTML = '<div class="afc-row"><span class="afc-dot afc-wait"></span><span class="afc-txt">Đang quét tài khoản…</span></div>';
      return;
    }

    if (s.known && s.credits != null) {
      var stale = Date.now() - s.at > STALE_MS;
      var est = _estimates(s.credits) || [];
      var estHtml = est.map(function (e) {
        return '<span class="afc-est"><b>' + e.runs + '</b> ' + _esc(e.label) + '</span>';
      }).join('');
      _el.innerHTML =
        '<div class="afc-row">' +
          '<span class="afc-dot ' + (s.credits > 0 ? 'afc-ok' : 'afc-low') + '"></span>' +
          '<span class="afc-num">' + s.credits + '</span>' +
          '<span class="afc-txt">tín dụng Flow</span>' +
          '<span class="afc-age' + (stale ? ' afc-stale' : '') + '">' + _fmtAge(s.at) + '</span>' +
          '<button class="afc-btn" id="afcRescan" title="Quét lại số dư">⟳</button>' +
        '</div>' +
        (estHtml ? '<div class="afc-ests">' + estHtml + '</div>' : '');
      var b = _el.querySelector('#afcRescan');
      if (b) b.addEventListener('click', function () { scan(true); });
      return;
    }

    // Chưa biết — nói rõ VÌ SAO và user cần làm gì.
    var msg = 'Chưa biết số dư';
    var cta = 'Quét tài khoản';
    if (s.reason === 'FLOW_NOT_OPEN') { msg = 'Chưa mở Google Flow'; cta = 'Mở Google Flow'; }
    else if (s.reason === 'NEED_USER_ACTION') {
      msg = 'Bấm ảnh đại diện trên trang Flow để đọc số dư';
      cta = 'Mở Flow';
    }
    else if (s.reason === 'CONTENT_NOT_READY') msg = 'Trang Flow chưa sẵn sàng';
    else if (s.reason === 'NO_ACCOUNT_BUTTON') msg = 'Không thấy nút tài khoản trên trang';
    else if (s.reason === 'NOT_FOUND_AFTER_OPEN') msg = 'Flow có thể đã đổi cách hiển thị';

    _el.innerHTML =
      '<div class="afc-row">' +
        '<span class="afc-dot afc-unknown"></span>' +
        '<span class="afc-txt">' + _esc(msg) + '</span>' +
        '<button class="afc-cta" id="afcScan">' + _esc(cta) + '</button>' +
      '</div>';
    var btn = _el.querySelector('#afcScan');
    if (btn) btn.addEventListener('click', function () { scan(true); });
  }

  /**
   * @param {boolean} openIfClosed  true = được phép MỞ tab Flow (chỉ khi user chủ động bấm).
   */
  async function scan(openIfClosed) {
    _state.scanning = true; render();
    var res = await _send({ action: 'flowCreditsScan', openIfClosed: !!openIfClosed });
    _state.scanning = false;

    if (res && res.known && typeof res.credits === 'number') {
      _state.known = true; _state.credits = res.credits; _state.at = Date.now(); _state.reason = null;
      _save();
    } else {
      // Giữ lại số cũ nếu đã từng đọc được — vẫn hữu ích, chỉ là cũ. Chỉ ghi lý do mới.
      _state.reason = (res && res.reason) || 'UNKNOWN';
      if (_state.credits == null) _state.known = false;
    }
    render();
    return _state;
  }

  /**
   * Cảnh báo trước khi chạy: workflow này có vượt số dư không?
   * @returns {{ok:boolean, known:boolean, total?:number, balance?:number, shortBy?:number, unknown?:number}}
   */
  function checkWorkflow(nodes) {
    var FC = root.FlowCredits;
    if (!FC) return { ok: true, known: false };
    return FC.planFor(_state.known ? _state.credits : null, nodes);
  }

  /** Câu cảnh báo cho người đọc. null = không cần cảnh báo gì. */
  function warningFor(nodes) {
    var p = checkWorkflow(nodes);
    if (!p || p.total === 0) return null;
    if (p.known && !p.ok) {
      return 'Workflow này cần ' + p.total + ' tín dụng, bạn còn ' + p.balance +
             ' — thiếu ' + p.shortBy + '. Hãy giảm số lượng, đổi model rẻ hơn, hoặc chờ credit reset.';
    }
    if (!p.known && p.unknown) {
      return 'Còn ' + p.unknown + ' node chưa rõ giá nên chưa tính đủ chi phí.';
    }
    if (!p.known) return 'Chưa đọc được số dư nên không kiểm tra được đủ/thiếu tín dụng.';
    return null;
  }


  /**
   * Nghe kho lưu: content script trên trang Flow "rình" được số dư (lúc user tự mở trình đơn tài
   * khoản) sẽ ghi vào af_flow_credits — sidebar cập nhật NGAY, user không phải bấm quét.
   * Đây là mảnh ghép khiến cách "không tự mở trình đơn" vẫn mượt: làm một lần, tự có mãi.
   */
  function _listenStore() {
    try {
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local' || !changes[KEY]) return;
        var v = changes[KEY].newValue;
        if (!v || typeof v.credits !== 'number') return;
        _state.known = true; _state.credits = v.credits; _state.at = v.at || Date.now(); _state.reason = null;
        _state.sku = v.sku || null; _state.via = v.via || null;
        render();
      });
    } catch (_) { globalThis.SEOSONA_swallow?.('CreditsPanel#_listenStore', _); }
  }

  /** @param {{compact?:boolean}} [opts] compact = bản gọn cho footer (chỗ hẹp). */
  async function mount(el, opts) {
    _el = el || null;
    _compact = !!(opts && opts.compact);
    if (!_el) return;
    await _load();
    _listenStore();
    render();
    // Tự quét im lặng: KHÔNG mở tab. Chỉ đọc khi Flow đã mở sẵn.
    scan(false);
  }


  /**
   * TỰ GẮN — bắt buộc phải ở trong file này.
   * CSP của MV3 (`script-src 'self'`) CHẶN mọi <script> inline trên trang extension, nên đoạn
   * mount viết thẳng vào sidebar.html sẽ IM LẶNG không chạy (đó chính là lỗi "footer trống").
   * Đặt ở đây thì code đi qua đường <script src=...> hợp lệ.
   */
  function _autoMount() {
    var el = (typeof document !== 'undefined') && document.getElementById('flowCreditsBar');
    if (el) mount(el, { compact: true });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _autoMount);
    else _autoMount();
  }

  root.CreditsPanel = {
    mount: mount, scan: scan, render: render,
    checkWorkflow: checkWorkflow, warningFor: warningFor,
    _state: function () { return _state; },
  };
})(typeof self !== 'undefined' ? self : this);
