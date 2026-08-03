/**
 * AccountPlan — tự nhận diện tài khoản của user ở từng provider: free hay trả phí, gói gì, còn
 * bao nhiêu credit (Flow). Để user BIẾT trước, và để extension TÍNH được còn gen được mấy video.
 *
 * Nguyên tắc xương sống: KHÔNG BAO GIỜ BỊA. Không đọc được thì trả { known:false, reason } —
 * một con số credit sai còn tệ hơn không có số, vì extension sẽ tính nhầm rồi gen thất bại giữa chừng.
 *
 * Cách nhận diện (local-first, KHÔNG gọi API riêng, KHÔNG cần Bearer token):
 *   flow    — đọc số credit hiển thị trên chính trang Flow (selector `flow_credit_display`).
 *   grok    — thấy modal/khối đòi Premium (pattern subscription_required_text) ⇒ chưa trả phí.
 *   chatgpt — thấy thông báo chạm hạn mức gói Plus ⇒ suy ra đang ở gói nào.
 *
 * Selector credit có thể CHƯA có sẵn (giao diện Flow đổi theo thời gian). Khi đó user vá nóng bằng
 * SelectorOverride.set('flow','flow_credit_display',['<css>']) — có hiệu lực ngay, không sửa code.
 *
 * API:
 *   AccountPlan.detectFlowCredits(doc)    -> { known, credits?, raw?, reason? }
 *   AccountPlan.detectFromText(provider, pageText, patterns) -> { known, paid?, plan?, reason }
 *   AccountPlan.estimateVideos(credits, costPerVideo)        -> number|null
 *   AccountPlan.save(provider, info) / AccountPlan.load()    -> chia sẻ giữa content script ↔ sidebar
 */
(function (root) {
  'use strict';

  var STORE_KEY = 'af_account_plan';

  function _num(s) {
    // "1,234" · "1.234" · "1 234" · "còn 250 credit" → 1234 / 250
    var m = String(s == null ? '' : s).replace(/[.,\s ]/g, '').match(/\d{1,9}/);
    return m ? parseInt(m[0], 10) : null;
  }

  function _selectorFor(key) {
    // Ưu tiên bản vá nóng, sau đó tới config gốc — cùng đường mà content script vẫn dùng.
    try {
      var ov = root.SelectorOverride;
      var hit = ov && ov.getConfig && ov.getConfig('flow', key);
      if (hit && hit.selectors && hit.selectors.length) return hit.selectors.join(', ');
    } catch (_) { globalThis.SEOSONA_swallow?.('AccountPlan#_selectorFor', _); }
    try {
      if (typeof root._selStr === 'function') return root._selStr(key);
    } catch (_) { globalThis.SEOSONA_swallow?.('AccountPlan#_selectorFor', _); }
    return null;
  }

  /**
   * Đọc số credit còn lại trên trang Flow.
   * @param {Document} [doc]
   * @returns {{known:boolean, credits?:number, raw?:string, reason?:string}}
   */
  /**
   * Nhãn credit lấy TỪ CHÍNH gói i18n của Flow (vi + en), không phải phỏng đoán.
   *
   * Vì sao bắt theo CHỮ chứ không theo class: Flow dùng styled-components, class là hash sinh
   * tự động (`sc-b818c8a-1 gnPjEi`) và ĐỔI MỖI LẦN Google build lại → selector CSS sẽ chết liên
   * tục. Chuỗi hiển thị chỉ đổi khi Google đổi nội dung — hiếm hơn nhiều, nên bền hơn hẳn.
   */
  var CREDIT_LABELS = [
    'tín dụng google flow',      // vi: "60 Tín dụng Google Flow"
    'google flow credits',       // en: "60 Google Flow credits"
    'tín dụng hằng tháng',       // vi: "Còn 1000 tín dụng hằng tháng"
    'monthly credits left',      // en
    'khoản tín dụng',            // vi: "Còn 60 khoản tín dụng"
    'credits left',              // en
  ];

  /**
   * Có ĐANG NHÌN THẤY không.
   *
   * Phải dùng checkVisibility(): kiểm trên DOM Flow thật cho thấy offsetParent và
   * getClientRects().length ĐỀU BÁO SAI là "hiện" với trình đơn tài khoản đã đóng — vì React
   * giữ dialog trong DOM và chỉ ẩn qua tổ tiên, mà hai cách kia không xét tổ tiên.
   */
  function _visible(el) {
    if (!el) return false;
    try {
      if (typeof el.checkVisibility === 'function') {
        return el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
      }
      if (!el.getClientRects().length) return false;      // dự phòng cho trình duyệt cũ
      var s = (el.ownerDocument.defaultView || window).getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    } catch (_) { return false; }
  }

  /**
   * Quét DOM tìm khối chứa nhãn credit + một con số.
   * Ưu tiên phần tử ĐANG HIỆN; phần tử ẩn vẫn nhận (trình đơn đã mở một lần rồi đóng thì React
   * giữ lại trong DOM — đọc được mà KHÔNG phải mở lại, tức không đụng vào giao diện của user).
   * Cùng mức hiện/ẩn thì lấy chuỗi NGẮN NHẤT để tránh vơ cả khối cha.
   */
  function _scanCreditByText(d) {
    var nodes;
    try { nodes = d.querySelectorAll('body *'); } catch (_) { return null; }
    var best = null;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var txt = String(el.textContent || '').trim();
      if (!txt || txt.length > 120) continue;
      var low = txt.toLowerCase();
      var hit = false;
      for (var j = 0; j < CREDIT_LABELS.length; j++) {
        if (low.indexOf(CREDIT_LABELS[j]) !== -1) { hit = true; break; }
      }
      if (!hit) continue;
      if (_num(txt) == null) continue;             // có nhãn nhưng không có số → bỏ
      var vis = _visible(el);
      if (!best || (vis && !best.visible) || (vis === best.visible && txt.length < best.txt.length)) {
        best = { el: el, txt: txt, visible: vis };
      }
    }
    return best;
  }

  function detectFlowCredits(doc) {
    var d = doc || (typeof document !== 'undefined' ? document : null);
    if (!d) return { known: false, reason: 'NO_DOCUMENT' };

    // 1) Selector do người dùng vá (nếu có) — ưu tiên vì chính xác nhất.
    var sel = _selectorFor('flow_credit_display');
    if (sel) {
      var el = null;
      try { el = d.querySelector(sel); } catch (_) { el = null; }
      if (el) {
        var raw = String(el.textContent || '').trim();
        var n = _num(raw);
        if (n != null) return { known: true, credits: n, raw: raw.slice(0, 60), via: 'selector' };
      }
    }

    // 2) Bắt theo CHỮ — không cần selector, sống sót qua các lần Flow đổi class.
    var found = _scanCreditByText(d);
    if (found) {
      var m = _num(found.txt);
      if (m != null) {
        return { known: true, credits: m, raw: found.txt.slice(0, 60), via: 'text', visible: found.visible };
      }
    }

    // 3) Thật sự không thấy → nói thẳng, kèm cách tự vá. KHÔNG bịa số.
    return {
      known: false,
      reason: 'NOT_FOUND',
      hint: "Mở trình đơn tài khoản (chỗ hiện số tín dụng) rồi thử lại; hoặc vá tay: SelectorOverride.set('flow','flow_credit_display',['<css>'])",
    };
  }

  /**
   * Suy ra tình trạng gói từ NỘI DUNG TRANG + pattern sẵn có của provider.
   * @param {string} provider
   * @param {string} pageText  văn bản trang (hoặc phần liên quan)
   * @param {{subscription_required_text?:string, rate_limit_text?:string, not_logged_in_text?:string}} patterns
   */
  function detectFromText(provider, pageText, patterns) {
    var t = String(pageText || '');
    var p = patterns || {};
    if (!t) return { known: false, reason: 'NO_TEXT' };

    var test = function (pat) {
      if (!pat) return false;
      try { return new RegExp(pat, 'i').test(t); } catch (_) { return false; }
    };

    if (test(p.not_logged_in_text)) return { known: true, loggedIn: false, paid: null, reason: 'NOT_LOGGED_IN' };

    // Grok: thấy lời mời mua Premium ⇒ tài khoản CHƯA trả phí cho tính năng đó.
    if (test(p.subscription_required_text)) return { known: true, loggedIn: true, paid: false, plan: 'free', reason: 'SUBSCRIPTION_PROMPT' };

    // ChatGPT: thông báo chạm hạn mức có nhắc tên gói ⇒ suy ra gói hiện tại.
    if (/plus plan limit|you've hit the plus plan/i.test(t)) return { known: true, loggedIn: true, paid: true, plan: 'plus', reason: 'PLAN_IN_LIMIT_MSG' };
    if (test(p.rate_limit_text)) return { known: true, loggedIn: true, paid: null, reason: 'RATE_LIMITED' };

    return { known: false, reason: 'NO_SIGNAL' };
  }

  /**
   * Còn gen được mấy video? null nếu CHƯA BIẾT credit hoặc chi phí.
   *
   * Cẩn trọng: phải loại null/undefined/'' TRƯỚC khi Number() — vì Number(null)===0 sẽ biến
   * "chưa biết credit" thành "còn 0 video", khiến extension từ chối gen oan. Chưa biết thì phải
   * nói chưa biết, không được suy thành 0.
   */
  function estimateVideos(credits, costPerVideo) {
    if (credits == null || credits === '' || costPerVideo == null || costPerVideo === '') return null;
    var c = Number(credits), k = Number(costPerVideo);
    if (!isFinite(c) || !isFinite(k) || k <= 0 || c < 0) return null;
    return Math.floor(c / k);
  }

  function save(provider, info) {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve(false);
        chrome.storage.local.get([STORE_KEY], function (st) {
          var all = (st && st[STORE_KEY]) || {};
          all[provider] = Object.assign({}, info, { at: Date.now() });
          var payload = {}; payload[STORE_KEY] = all;
          chrome.storage.local.set(payload, function () { resolve(true); });
        });
      } catch (_) { resolve(false); }
    });
  }

  function load() {
    return new Promise(function (resolve) {
      try {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return resolve({});
        chrome.storage.local.get([STORE_KEY], function (st) { resolve((st && st[STORE_KEY]) || {}); });
      } catch (_) { resolve({}); }
    });
  }

  root.AccountPlan = {
    _visible: _visible,
    detectFlowCredits: detectFlowCredits, detectFromText: detectFromText,
    estimateVideos: estimateVideos, save: save, load: load, _num: _num,
  };
})(typeof self !== 'undefined' ? self : this);
