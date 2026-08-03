// SEOSONA Flow — Cổng chất lượng (Đòn 5).
//
// Đã có skill image-qa và mllm-judge, nhưng chưa có NODE để cắm vào workflow — nghĩa là
// muốn dùng phải tự chạy thủ công từng ảnh. Node quality_gate biến việc chấm thành một
// bước trong dây chuyền, có nhánh "đạt" và nhánh "trượt" để tự gen lại.
//
// Hai nguyên tắc mượn từ flowkit, đều quan trọng:
//   1. Lỗi CRITICAL là TRƯỢT bất kể điểm trung bình — một bàn tay 6 ngón thì "bám prompt
//      9 điểm" cũng vô nghĩa. Trung bình cộng sẽ che mất lỗi chí mạng.
//   2. Chấm theo THANG HÀNH ĐỘNG chứ không chỉ ra điểm: mỗi mức nói rõ làm gì tiếp,
//      và mức 4,0–5,9 phải quay lại gen ẢNH chứ không phải gen lại video — gen lại video
//      từ một ảnh xấu chỉ tốn thêm credit.
//
// Classic script, thuần → test trực tiếp.
(function (global) {
  'use strict';

  // Sáu trục chấm + trọng số. Tổng trọng số = 1.
  var DIMENSIONS = [
    { key: 'prompt_adherence', label: 'Bám prompt', weight: 0.25 },
    { key: 'character_consistency', label: 'Nhất quán nhân vật', weight: 0.25 },
    { key: 'motion_quality', label: 'Chất lượng chuyển động', weight: 0.15 },
    { key: 'visual_fidelity', label: 'Độ nét / chi tiết', weight: 0.15 },
    { key: 'temporal_coherence', label: 'Mạch thời gian', weight: 0.10 },
    { key: 'composition', label: 'Bố cục', weight: 0.10 },
  ];

  // Thang HÀNH ĐỘNG: điểm → làm gì tiếp.
  var BANDS = [
    { min: 9.0, verdict: 'excellent', action: 'accept', label: 'Xuất sắc — dùng luôn' },
    { min: 7.5, verdict: 'good', action: 'accept', label: 'Tốt — dùng được' },
    { min: 6.0, verdict: 'acceptable', action: 'trim', label: 'Tạm — cắt đoạn dùng được, gen lại phần yếu' },
    { min: 4.0, verdict: 'poor', action: 'regen_image', label: 'Kém — gen lại ẢNH rồi mới gen video' },
    { min: 0.0, verdict: 'unusable', action: 'rewrite_prompt', label: 'Hỏng — viết lại prompt, làm lại từ đầu' },
  ];

  // Lấy mẫu khung: nhanh để quét sơ, kỹ để bắt lỗi tinh.
  var SAMPLING = { light: 4, deep: 8 };

  function framesFor(durationSec, mode) {
    var fps = SAMPLING[mode] || SAMPLING.light;
    return Math.max(1, Math.round((Number(durationSec) || 0) * fps));
  }

  function clamp10(v) {
    var n = Number(v);
    if (!isFinite(n)) return 0;
    return Math.min(10, Math.max(0, n));
  }

  /** Điểm tổng có trọng số. Trục thiếu điểm bị BỎ và trọng số chuẩn hoá lại, để
   *  chấm ảnh tĩnh (không có chuyển động / mạch thời gian) vẫn ra điểm đúng thang. */
  function weightedScore(scores) {
    var s = scores || {};
    var sum = 0, w = 0;
    for (var i = 0; i < DIMENSIONS.length; i++) {
      var d = DIMENSIONS[i];
      if (s[d.key] == null) continue;
      sum += clamp10(s[d.key]) * d.weight;
      w += d.weight;
    }
    if (w === 0) return 0;
    return Math.round((sum / w) * 10) / 10;
  }

  function band(score) {
    var v = clamp10(score);
    for (var i = 0; i < BANDS.length; i++) if (v >= BANDS[i].min) return BANDS[i];
    return BANDS[BANDS.length - 1];
  }

  /**
   * Phán quyết cuối.
   * @param {object} scores điểm từng trục 0–10
   * @param {Array<{severity:string,note:string}>} issues lỗi phát hiện
   * @param {{threshold:number}} opts ngưỡng đạt (mặc định 7.5)
   */
  function judge(scores, issues, opts) {
    opts = opts || {};
    var threshold = typeof opts.threshold === 'number' ? opts.threshold : 7.5;
    var list = Array.isArray(issues) ? issues : [];
    var critical = list.filter(function (i) { return String(i && i.severity).toUpperCase() === 'CRITICAL'; });
    var score = weightedScore(scores);
    var b = band(score);

    // Lỗi chí mạng thì TRƯỢT bất kể điểm — trung bình cộng sẽ che mất nó.
    if (critical.length) {
      return {
        pass: false, score: score, verdict: 'critical_fail',
        action: score >= 4.0 ? 'regen_image' : 'rewrite_prompt',
        label: 'Có lỗi nghiêm trọng — trượt bất kể điểm',
        critical: critical.map(function (i) { return i.note || 'lỗi nghiêm trọng'; }),
        reasons: list.map(function (i) { return (i.severity || '?') + ': ' + (i.note || ''); }),
      };
    }
    return {
      pass: score >= threshold, score: score, verdict: b.verdict, action: b.action, label: b.label,
      critical: [],
      reasons: list.map(function (i) { return (i.severity || '?') + ': ' + (i.note || ''); }),
    };
  }

  /**
   * Bộ lọc RẺ chạy trước khi tốn model: loại thẳng những thứ hỏng rõ ràng.
   * Trả null nếu không kết luận được (khi đó mới gọi model).
   */
  function cheapPreFilter(meta) {
    var m = meta || {};
    if (m.fileSize != null && Number(m.fileSize) < 1024) {
      return { pass: false, score: 0, verdict: 'unusable', action: 'rewrite_prompt', label: 'File hỏng hoặc rỗng', critical: ['file < 1KB'], reasons: [] };
    }
    if (m.width != null && m.height != null && (Number(m.width) < 64 || Number(m.height) < 64)) {
      return { pass: false, score: 0, verdict: 'unusable', action: 'rewrite_prompt', label: 'Kích thước bất thường', critical: ['ảnh quá nhỏ'], reasons: [] };
    }
    if (m.durationSec != null && Number(m.durationSec) <= 0) {
      return { pass: false, score: 0, verdict: 'unusable', action: 'rewrite_prompt', label: 'Video không có thời lượng', critical: ['duration = 0'], reasons: [] };
    }
    return null;
  }

  global.QualityGate = {
    DIMENSIONS: DIMENSIONS, BANDS: BANDS, SAMPLING: SAMPLING,
    framesFor: framesFor, weightedScore: weightedScore, band: band,
    judge: judge, cheapPreFilter: cheapPreFilter,
  };
})(typeof self !== 'undefined' ? self : this);
