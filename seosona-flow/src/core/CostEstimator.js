/**
 * CostEstimator — ước lượng "chi phí" 1 kế hoạch gen TRƯỚC khi chạy (deterministic, offline, zero-dep).
 *
 * Học super-video-maker cost-preview gate: cho user THẤY trước số lần sinh, "units" tương đối, thời gian
 * ước tính và BƯỚC ĐẮT NHẤT trước khi bấm chạy hàng loạt (tránh đốt quota bất ngờ). Vì giá $ theo provider
 * biến động/không chắc → dùng "units" TƯƠNG ĐỐI (image=1) thay vì tiền tuyệt đối.
 *
 * API (thuần, testable):
 *   CostEstimator.unitsFor(step) -> number
 *   CostEstimator.estimate(plan, opts) -> { totalGenerations, totalUnits, byProvider, estSeconds, mostExpensive, notes[] }
 * step: { type, provider, quantity=1, mediaType:'image|video', durationSec, label }
 */
(function (root) {
  'use strict';

  // Trọng số units/1 lần sinh theo loại media (tương đối, image = mốc 1).
  var MEDIA_UNIT = { image: 1, video: 4 };
  // Thời gian ước tính (giây) / 1 lần sinh — thô, để user hình dung độ dài hàng đợi.
  var MEDIA_SEC = { image: 15, video: 60 };
  // Node KHÔNG sinh media (không tốn quota): logic/text/pass-through.
  var NON_GEN = { prompt: 1, text: 1, text_template: 1, text_extract: 1, random_pick: 1, condition: 1, switch: 1, merge: 1, loop: 1, delay: 1, note: 1, download: 1, telegram: 1, text_overlay: 1 };

  function _mediaOf(step) {
    if (step.mediaType) return step.mediaType === 'video' ? 'video' : 'image';
    // suy từ type: generate/image → image; video hint qua durationSec
    if (step.durationSec) return 'video';
    return 'image';
  }
  function _isGen(step) {
    var t = step.type || step.node_type || 'generate';
    if (NON_GEN[t]) return false;
    return t === 'generate' || t === 'image' || t === 'video' || t === 'chatgpt' || t === 'grok';
  }

  function unitsFor(step) {
    if (!_isGen(step)) return 0;
    var qty = Math.max(1, Number(step.quantity) || 1);
    var media = _mediaOf(step);
    var w = MEDIA_UNIT[media] || 1;
    // video dài hơn → nặng hơn theo duration (mỗi 10s ~ +1x, tối thiểu 1x)
    if (media === 'video' && step.durationSec) w = Math.max(w, Math.ceil(step.durationSec / 10) * MEDIA_UNIT.video / 2);
    return qty * w;
  }

  function estimate(plan, opts) {
    opts = opts || {};
    var steps = Array.isArray(plan) ? plan : [];
    var totalGen = 0, totalUnits = 0, estSeconds = 0;
    var byProvider = {};
    var mostExpensive = null;
    var notes = [];
    steps.forEach(function (s) {
      if (!_isGen(s)) return;
      var qty = Math.max(1, Number(s.quantity) || 1);
      var media = _mediaOf(s);
      var u = unitsFor(s);
      totalGen += qty;
      totalUnits += u;
      estSeconds += qty * (MEDIA_SEC[media] || 15);
      var prov = s.provider || 'flow';
      byProvider[prov] = (byProvider[prov] || 0) + qty;
      if (!mostExpensive || u > mostExpensive.units) mostExpensive = { step: s.label || s.type || 'gen', units: u, provider: prov, media: media };
    });
    var warnUnits = opts.warnUnits != null ? opts.warnUnits : 40;
    if (totalUnits >= warnUnits) notes.push('Kế hoạch NẶNG (' + totalUnits + ' units ~ ' + totalGen + ' lần sinh) — cân nhắc giảm quantity hoặc số cảnh.');
    if (mostExpensive && mostExpensive.media === 'video') notes.push('Bước đắt nhất là VIDEO ("' + mostExpensive.step + '") — video tốn ~4× ảnh; cân nhắc rút ngắn hoặc dùng ảnh nếu được.');
    if (totalGen === 0) notes.push('Không có bước sinh media nào (chỉ node logic/text) — chi phí ~0.');
    return {
      totalGenerations: totalGen,
      totalUnits: totalUnits,
      byProvider: byProvider,
      estSeconds: estSeconds,
      estMinutes: Math.round(estSeconds / 6) / 10,
      mostExpensive: mostExpensive,
      notes: notes,
    };
  }

  // Dựng plan (mảng step) từ nodes của 1 workflow — map node_type/media_type/quantity → step cho estimate().
  // Bỏ node disabled. Video suy từ media_type='Video' hoặc model chứa veo/video.
  function planFromNodes(nodes) {
    return (Array.isArray(nodes) ? nodes : [])
      .filter(function (n) { return n && n.enabled !== false; })
      .map(function (n) {
        var t = n.node_type;
        var isVid = n.media_type === 'Video' || (t === 'generate' && /veo|video/i.test(n.model || ''));
        return {
          type: t,
          provider: (t === 'chatgpt' || t === 'grok') ? t : 'flow',
          quantity: parseInt(n.quantity, 10) || 1,
          mediaType: isVid ? 'video' : 'image',
          durationSec: isVid ? (parseInt(n.video_duration, 10) || 6) : undefined,
          label: n.node_name || t,
        };
      });
  }

  // Tóm tắt 1 estimate thành chuỗi người đọc (dùng cho cost-gate notification + future cost node).
  function format(est) {
    if (!est || est.totalGenerations <= 0) return 'Không có bước sinh media (chi phí ~0).';
    var heavy = (est.notes || []).some(function (n) { return /NẶNG/.test(n); });
    var s = 'Sắp sinh ' + est.totalGenerations + ' ảnh/clip (~' + est.estMinutes + ' phút, ' + est.totalUnits + ' units)';
    if (est.mostExpensive) s += '; nặng nhất: ' + est.mostExpensive.step + ' (' + est.mostExpensive.units + ' units)';
    if (heavy) s += ' — cân nhắc giảm số lượng';
    return s;
  }

  root.CostEstimator = { unitsFor: unitsFor, estimate: estimate, format: format, planFromNodes: planFromNodes, _MEDIA_UNIT: MEDIA_UNIT };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
