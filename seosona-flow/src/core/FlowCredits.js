/**
 * FlowCredits — biết TRƯỚC một lần chạy tốn bao nhiêu tín dụng Google Flow, và số dư có đủ không.
 *
 * Số liệu lấy từ chính giao diện Flow (người dùng chụp màn hình 2026-07-27), không phải phỏng đoán:
 *   Nano Banana 2 Lite (ảnh) — 0 tín dụng, kể cả x4
 *   Omni Flash        1x → 10,  x4 → 40   ⇒ chi phí NHÂN TUYẾN TÍNH theo số lượng
 *   Veo 3.1 - Lite    1x → 10
 *   Veo 3.1 - Fast    1x → 20
 *   Veo 3.1 - Quality 1x → 100
 * Thời lượng (4s/6s/8s/10s) KHÔNG đổi giá ở các ảnh đã chụp — chỉ ghi nhận, chưa suy rộng.
 *
 * Bảng giá có thể LỖI THỜI khi Google đổi giá. Nên:
 *   · luôn ưu tiên con số Flow TỰ HIỆN trên trang ("Quá trình tạo sẽ tốn N tín dụng") — parseCostText()
 *   · bảng dưới chỉ là DỰ PHÒNG khi không đọc được trang
 *   · không đọc được và không có trong bảng ⇒ trả null (KHÔNG đoán bừa)
 *
 * API:
 *   FlowCredits.costOf(model, quantity)          -> số tín dụng | null
 *   FlowCredits.parseCostText(text)              -> số tín dụng hiển thị trên trang | null
 *   FlowCredits.parseBalanceText(text)           -> số dư | null
 *   FlowCredits.check(balance, model, quantity)  -> { ok, cost, balance, shortBy?, maxRuns? }
 *   FlowCredits.planFor(balance, nodes)          -> tổng chi phí 1 workflow + đủ/thiếu
 */
(function (root) {
  'use strict';

  // Giá 1 lần sinh (quantity = 1). Khớp nhãn model trong ModelRegistry/template.
  // ẢNH: mọi model Nano Banana đều 0 tín dụng (đã xác nhận Pro/2/2 Lite ở x4 vẫn 0).
  var COST = {
    'nano banana 2 lite': 0,
    'nano banana 2': 0,
    'nano banana pro': 0,
    // VIDEO — giá cơ sở khi KHÔNG rõ thời lượng (Veo hiển thị không kèm chọn thời lượng).
    'omni flash': 10,          // = giá 6s; xem COST_BY_DURATION để tính đúng theo thời lượng
    'veo 3.1 - lite': 10,
    'veo 3.1 - fast': 20,
    'veo 3.1 - quality': 100,
  };

  // ĐÍNH CHÍNH: bản trước ghi "thời lượng KHÔNG đổi giá" — SAI. Dữ liệu Omni Flash cho thấy có đổi:
  //   4s → 7 · 6s → 10 · 10s → 15   (8s CHƯA có dữ liệu ⇒ KHÔNG nội suy, xem _MISSING)
  // Dùng tra bảng thay vì công thức: 3 điểm này không nằm trên một đường thẳng
  // (1.75 / 1.67 / 1.50 tín dụng mỗi giây) nên mọi công thức đều là đoán.
  var COST_BY_DURATION = {
    'omni flash': { '4s': 7, '6s': 10, '10s': 15 },
  };

  // Hạn mức credit theo gói — lấy từ chuỗi i18n của chính trang Flow, không phải phỏng đoán.
  // Free tính theo NGÀY, các gói trả phí tính theo THÁNG (khác đơn vị, đừng so trực tiếp).
  var PLAN_QUOTA = {
    free:      { credits: 50,    period: 'day',   label: 'Không có gói Google AI' },
    plus:      { credits: 200,   period: 'month', label: 'Google AI Plus' },
    pro:       { credits: 1000,  period: 'month', label: 'Google AI Pro' },
    ultra:     { credits: 10000, period: 'month', label: 'Google AI Ultra' },
    ultra_max: { credits: 25000, period: 'month', label: 'Google AI Ultra (bản cao)' },
  };

  // Ngoại lệ theo gói: Flow ghi rõ "Veo 3.1 Fast không tính tín dụng đối với người đăng ký gói
  // Ultra" ⇒ CÙNG một model mà giá khác nhau tuỳ gói. Bỏ qua điều này sẽ tính dư 20đ/clip cho
  // user Ultra và cảnh báo thiếu credit oan.
  var FREE_FOR_PLAN = {
    ultra:     { 'veo 3.1 - fast': true },
    ultra_max: { 'veo 3.1 - fast': true },
  };

  function _key(model) { return String(model == null ? '' : model).toLowerCase().replace(/\s+/g, ' ').trim(); }
  function _dur(d) {
    if (d == null || d === '') return null;
    var m = String(d).match(/(\d+)/);
    return m ? m[1] + 's' : null;
  }

  /**
   * Chi phí cho model + số lượng (+ thời lượng nếu có).
   * @returns {number|null} null khi CHƯA BIẾT giá — gồm cả trường hợp biết model nhưng thời lượng
   *   đó chưa có dữ liệu (vd Omni Flash 8s). Thà nói chưa biết còn hơn nội suy sai.
   */
  function costOf(model, quantity, duration, plan) {
    var k = _key(model);
    var q = parseInt(quantity, 10);
    if (!isFinite(q) || q < 1) q = 1;

    // Ngoại lệ theo gói phải xét TRƯỚC bảng giá chung (vd Ultra: Veo 3.1 Fast = 0).
    var free = FREE_FOR_PLAN[String(plan || '').toLowerCase()];
    if (free && free[k]) return 0;

    var d = _dur(duration);
    if (d) {
      var table = COST_BY_DURATION[k];
      if (table) {
        if (!(d in table)) return null;      // model có bảng thời lượng nhưng THIẾU mốc này
        return table[d] * q;
      }
      // model không phụ thuộc thời lượng (ảnh, Veo) → dùng giá cơ sở
    }
    if (!(k in COST)) return null;
    return COST[k] * q;
  }

  /** Các mốc thời lượng đã biết giá của 1 model (để UI gợi ý / cảnh báo mốc chưa rõ). */
  function knownDurations(model) {
    var t = COST_BY_DURATION[_key(model)];
    return t ? Object.keys(t) : null;
  }

  // "Quá trình tạo sẽ tốn 40 tín dụng" → 40 ; "0 tín dụng" → 0
  function parseCostText(text) {
    var m = String(text == null ? '' : text).match(/(\d[\d.,\s]*)\s*(tín dụng|credit)/i);
    if (!m) return null;
    var n = parseInt(String(m[1]).replace(/[.,\s]/g, ''), 10);
    return isFinite(n) ? n : null;
  }

  // "60 Tín dụng Google Flow" → 60
  function parseBalanceText(text) {
    return parseCostText(text);
  }

  /**
   * Đủ tín dụng để chạy không?
   * Chưa biết số dư HOẶC chưa biết giá ⇒ ok:true + known:false — KHÔNG tự chặn user dựa trên
   * dữ liệu mình không có (chặn oan tệ hơn để chạy rồi Flow tự báo thiếu).
   */
  function check(balance, model, quantity, duration) {
    var cost = costOf(model, quantity, duration);
    var b = (balance == null || balance === '') ? null : Number(balance);
    if (cost == null || b == null || !isFinite(b)) {
      return { ok: true, known: false, cost: cost, balance: (b == null || !isFinite(b)) ? null : b };
    }
    if (cost === 0) return { ok: true, known: true, cost: 0, balance: b, free: true };
    var out = { ok: b >= cost, known: true, cost: cost, balance: b, maxRuns: Math.floor(b / cost) };
    if (!out.ok) out.shortBy = cost - b;
    return out;
  }

  /**
   * Tổng chi phí một workflow (danh sách node generate) + kết luận đủ/thiếu.
   * Node chưa biết giá được đếm riêng vào `unknown` để UI nói rõ "còn X node chưa rõ giá".
   */
  function planFor(balance, nodes) {
    var items = [], total = 0, unknown = 0;
    (nodes || []).forEach(function (n) {
      var d = n || {};
      var model = d.model || (d.data && d.data.model);
      var qty = d.quantity || (d.data && d.data.quantity) || 1;
      // Thời lượng ảnh hưởng giá (Omni Flash) — đọc cả 2 tên field mà template thật dùng.
      var dur = d.flowVideoDuration || d.video_duration || d.duration
        || (d.data && (d.data.flowVideoDuration || d.data.video_duration || d.data.duration));
      var type = d.node_type || d.type;
      if (!/^(generate|image)$/.test(String(type || ''))) return;
      var c = costOf(model, qty, dur);
      if (c == null) { unknown++; items.push({ model: model || '(chưa đặt)', quantity: qty, duration: dur || null, cost: null }); return; }
      total += c;
      items.push({ model: model, quantity: qty, duration: dur || null, cost: c });
    });

    var b = (balance == null || balance === '') ? null : Number(balance);
    var known = b != null && isFinite(b) && unknown === 0;
    var res = { total: total, items: items, unknown: unknown, balance: (b != null && isFinite(b)) ? b : null, known: known };
    if (known) {
      res.ok = b >= total;
      if (!res.ok) res.shortBy = total - b;
    } else {
      res.ok = true; // chưa đủ dữ liệu để kết luận → không chặn
    }
    return res;
  }

  root.FlowCredits = {
    costOf: costOf, parseCostText: parseCostText, parseBalanceText: parseBalanceText,
    check: check, planFor: planFor, knownDurations: knownDurations,
    COST: COST, COST_BY_DURATION: COST_BY_DURATION,
    PLAN_QUOTA: PLAN_QUOTA, FREE_FOR_PLAN: FREE_FOR_PLAN,
  };
})(typeof self !== 'undefined' ? self : this);
