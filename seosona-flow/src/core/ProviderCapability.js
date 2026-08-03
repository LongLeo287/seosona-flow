/**
 * ProviderCapability — NGUỒN SỰ THẬT DUY NHẤT về "provider nào làm được gì, cái nào cần trả phí".
 *
 * Vì sao cần: năng lực provider đang nằm rải rác (supports trong PCM, dispatch trong McpExecutor,
 * danh sách trong PromptAssistantModal, model trong ModelRegistry) nên không ai — kể cả code —
 * biết chắc provider nào làm gì. Hệ quả thực tế đã thấy: Gemini bị tưởng là gen ảnh (thật ra chỉ
 * làm prompt), Claude có content script + host permission nhưng KHÔNG có trong config provider.
 *
 * Nguyên tắc: FREE trước. Tính năng cần tài khoản trả phí phải khai báo rõ `requiresPaid` để UI
 * chặn/cảnh báo TRƯỚC khi chạy, thay vì để user tốn công rồi mới nhận lỗi giữa chừng.
 *
 * API:
 *   ProviderCapability.get(provider)             -> bản mô tả năng lực
 *   ProviderCapability.can(provider, cap)        -> boolean
 *   ProviderCapability.needsPaid(provider, cap)  -> boolean
 *   ProviderCapability.providersFor(cap)         -> ['flow', ...]
 *   ProviderCapability.matrix()                  -> bảng đầy đủ (cho UI/chẩn đoán)
 */
(function (root) {
  'use strict';

  // cap: gen_image · gen_video · prompt (sinh/biến đổi text) · ref_image · ratio · quantity
  var CAPS = {
    flow: {
      label: 'Google Flow',
      caps: { gen_image: true, gen_video: true, prompt: false, ref_image: true, ratio: true, quantity: true },
      // Flow: tài khoản free vẫn gen được, nhưng có hạn mức; model/độ phân giải cao cần gói trả phí.
      paidCaps: { video_1080p: true, video_4k: true, upscale: true },
      planSource: 'flow_credits',      // đọc số dư còn lại (xem AccountPlan)
      note: 'Free dùng được; hết credit thì phải chờ reset hoặc nâng gói.',
    },
    chatgpt: {
      label: 'ChatGPT',
      caps: { gen_image: true, gen_video: false, prompt: true, ref_image: true, ratio: true, quantity: false },
      paidCaps: {},                     // free vẫn gen ảnh được, chỉ giới hạn số lượng/tốc độ
      planSource: 'chatgpt_rate_limit',
      note: 'Free gen được nhưng giới hạn nhanh; Plus nới hạn mức.',
    },
    grok: {
      label: 'Grok',
      caps: { gen_image: true, gen_video: true, prompt: true, ref_image: true, ratio: true, quantity: false },
      // Grok Imagine đòi gói Premium — đây là ca ĐÃ thấy trong log lỗi thật của user.
      paidCaps: { gen_image: true, gen_video: true },
      planSource: 'grok_subscription',
      note: 'Tạo ảnh/video YÊU CẦU gói Premium. Không có gói thì node Grok sẽ fail.',
    },
    gemini: {
      label: 'Gemini',
      // Nền tảng Gemini CÓ sinh ảnh, nhưng extension CHƯA nối đường đó: ModelRegistry khai
      // media_type:'chat', McpExecutor không dispatch gemini, content script không có hàm gen.
      // Khai gen_image:true lúc này sẽ là khai KHỐNG → node dựng ra chắc chắn fail.
      caps: { gen_image: false, gen_video: false, prompt: true, ref_image: true, ratio: false, quantity: false },
      // Việc cần làm để bật: content script submit prompt + thu ảnh, model ảnh trong ModelRegistry,
      // nhánh dispatch trong McpExecutor. Ghi ở đây để không quên và để UI hiển thị đúng trạng thái.
      plannedCaps: { gen_image: true },
      paidCaps: {},
      planSource: null,
      note: 'Hiện chỉ làm trợ lý PROMPT. Sinh ảnh: nền tảng hỗ trợ nhưng extension CHƯA nối — cần dựng đường gen trước khi bật.',
    },
    claude: {
      label: 'Claude',
      caps: { gen_image: false, gen_video: false, prompt: true, ref_image: false, ratio: false, quantity: false },
      paidCaps: {},
      planSource: null,
      note: 'Chỉ dùng làm trợ lý PROMPT (text). Chưa có cấu hình provider đầy đủ.',
    },
  };

  function get(provider) { return CAPS[String(provider || '').toLowerCase()] || null; }

  function can(provider, cap) {
    var p = get(provider);
    return !!(p && p.caps && p.caps[cap] === true);
  }

  /** Năng lực này có ĐÒI tài khoản trả phí không? */
  function needsPaid(provider, cap) {
    var p = get(provider);
    return !!(p && p.paidCaps && p.paidCaps[cap] === true);
  }

  /** Provider nào làm được năng lực này (ưu tiên cái KHÔNG cần trả phí lên trước). */
  function providersFor(cap) {
    return Object.keys(CAPS)
      .filter(function (k) { return can(k, cap); })
      .sort(function (a, b) { return (needsPaid(a, cap) ? 1 : 0) - (needsPaid(b, cap) ? 1 : 0); });
  }

  /** Bảng đầy đủ cho UI/chẩn đoán. */
  function matrix() {
    return Object.keys(CAPS).map(function (k) {
      var p = CAPS[k];
      return {
        provider: k, label: p.label, note: p.note, planSource: p.planSource,
        caps: Object.keys(p.caps).filter(function (c) { return p.caps[c]; }),
        paidCaps: Object.keys(p.paidCaps || {}),
      };
    });
  }

  /**
   * Kiểm TRƯỚC khi chạy: provider có làm được việc này không, và có đòi trả phí không.
   * @returns {{ok:boolean, reason?:string, paidRequired?:boolean}}
   */
  function check(provider, cap, plan) {
    var p = get(provider);
    if (!p) return { ok: false, reason: 'UNKNOWN_PROVIDER' };
    if (!can(provider, cap)) return { ok: false, reason: 'NOT_SUPPORTED' };
    if (needsPaid(provider, cap)) {
      // plan: kết quả từ AccountPlan. Chưa biết → cho chạy (không tự chặn oan), chỉ đánh dấu.
      if (plan && plan.paid === false) return { ok: false, reason: 'PAID_REQUIRED', paidRequired: true };
      return { ok: true, paidRequired: true };
    }
    return { ok: true };
  }

  root.ProviderCapability = { get: get, can: can, needsPaid: needsPaid, providersFor: providersFor, matrix: matrix, check: check, CAPS: CAPS };
})(typeof self !== 'undefined' ? self : this);
