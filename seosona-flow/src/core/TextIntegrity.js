/**
 * TextIntegrity — kiểm CHÍNH TẢ chữ render trong ảnh (deterministic, offline, zero-dep).
 *
 * Vế QA của vòng Reserve→Overlay: vision/OCR model đọc chữ trong ảnh (chuỗi ocr), module này SO deterministic
 * với chuỗi đích (expected) → verdict pass/warn/fail + phân loại lỗi. Không gọi model (thuần logic).
 * Bổ trợ [[TextOverlay]] + prompt img_text_qa.
 *
 * API (thuần, testable):
 *   TextIntegrity.normalize(s, {caseInsensitive, stripDiacritics, collapse}) -> string
 *   TextIntegrity.levenshtein(a, b) -> number
 *   TextIntegrity.similarity(a, b) -> 0..1
 *   TextIntegrity.hasDiacritics(s) -> bool
 *   TextIntegrity.compare(expected, ocr, opts) -> { match, similarity, issues:[], verdict:'pass|warn|fail' }
 */
(function (root) {
  'use strict';

  function _stripDiacritics(s) {
    // NFD tách dấu kết hợp rồi xoá (U+0300–036F) + xử lý đ/Đ riêng (không phải combining).
    try {
      return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D');
    } catch (e) { return String(s); }
  }
  function hasDiacritics(s) {
    try { return /[̀-ͯ]/.test(String(s).normalize('NFD').replace(/[^̀-ͯ]/g, '')) || /[đĐ]/.test(String(s)); }
    catch (e) { return /[đĐ]/.test(String(s)); }
  }

  function normalize(s, opts) {
    opts = opts || {};
    var out = String(s == null ? '' : s);
    if (opts.collapse !== false) out = out.replace(/\s+/g, ' ').trim();
    if (opts.stripDiacritics) out = _stripDiacritics(out);
    if (opts.caseInsensitive !== false) out = out.toLowerCase();
    return out;
  }

  // Levenshtein edit distance (2-row DP).
  function levenshtein(a, b) {
    a = String(a == null ? '' : a); b = String(b == null ? '' : b);
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    var prev = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      var cur = [i];
      for (var k = 1; k <= b.length; k++) {
        var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function similarity(a, b) {
    a = String(a == null ? '' : a); b = String(b == null ? '' : b);
    var max = Math.max(a.length, b.length);
    if (max === 0) return 1;
    return 1 - levenshtein(a, b) / max;
  }

  // So expected vs ocr. opts: {caseInsensitive=true, stripDiacritics=false, warnThreshold=0.85, expectNoDiacritics=false}
  function compare(expected, ocr, opts) {
    opts = opts || {};
    var warnAt = opts.warnThreshold != null ? opts.warnThreshold : 0.85;
    var ne = normalize(expected, { caseInsensitive: opts.caseInsensitive, stripDiacritics: opts.stripDiacritics });
    var no = normalize(ocr, { caseInsensitive: opts.caseInsensitive, stripDiacritics: opts.stripDiacritics });
    var sim = similarity(ne, no);
    var match = ne === no;
    var issues = [];
    if (!match) {
      if (no.length < ne.length) issues.push('dropped_characters');
      if (no.length > ne.length) issues.push('extra_characters');
      if (sim >= warnAt && sim < 1) issues.push('misspelling');
      if (sim < warnAt) issues.push('garbled_glyphs');
    }
    // dấu ngoài ý muốn: expected không dấu nhưng ocr có dấu.
    if (opts.expectNoDiacritics && hasDiacritics(ocr) && !hasDiacritics(expected)) issues.push('unwanted_diacritics');
    // sai hoa/thường (chỉ khác ở case): so bản strip-diacritics giữ case.
    if (!match) {
      var ceExact = normalize(expected, { caseInsensitive: false, stripDiacritics: opts.stripDiacritics });
      var coExact = normalize(ocr, { caseInsensitive: false, stripDiacritics: opts.stripDiacritics });
      if (ceExact.toLowerCase() === coExact.toLowerCase() && ceExact !== coExact) issues.push('wrong_case');
    }
    var verdict = match ? 'pass' : (sim >= warnAt ? 'warn' : 'fail');
    return { match: match, similarity: Math.round(sim * 1000) / 1000, issues: issues, verdict: verdict };
  }

  // Tóm tắt 1 kết quả compare() thành chuỗi người đọc (cho UI tool + future text_qa node).
  function summary(r) {
    if (!r) return '';
    if (r.verdict === 'pass') return 'Chữ khớp chính xác ✓';
    var pct = Math.round((r.similarity || 0) * 100);
    var label = r.verdict === 'warn' ? 'Gần khớp' : 'Lệch nhiều';
    return label + ' (' + pct + '%)' + (r.issues && r.issues.length ? ' — ' + r.issues.join(', ') : '');
  }

  // Shorthand boolean: chữ render có ĐẠT (khớp chính xác) chuỗi mong đợi không.
  function isPass(expected, ocr, opts) { return compare(expected, ocr, opts).verdict === 'pass'; }

  root.TextIntegrity = {
    normalize: normalize, levenshtein: levenshtein, similarity: similarity,
    hasDiacritics: hasDiacritics, compare: compare, summary: summary, isPass: isPass,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
