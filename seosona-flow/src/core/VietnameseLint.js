/**
 * VietnameseLint — lint VĂN BẢN TIẾNG VIỆT cho tự nhiên/đúng (port ý tưởng vietnamese-humanizer sang JS).
 * Dùng cho: QA chữ trên ảnh (caption), QA prompt tiếng Việt, làm sạch copy máy-dịch. KHÔNG cần Python.
 *
 * Taxonomy severity (mượn vietnamese-humanizer):
 *   error      — gần chắc sai (lỗi đánh máy/typography).
 *   warning    — nhiều khả năng vụng (mơ hồ / calque).
 *   preference — phong cách nên gọn hơn (không sai).
 *   heuristic  — dấu hiệu cần người xem (weasel word, thiếu nguồn).
 *
 * API:
 *   VietnameseLint.check(text) -> [{ id, severity, match, index, message, suggest }]
 *   VietnameseLint.summary(findings) -> string
 *   VietnameseLint.count(findings) -> { error, warning, preference, heuristic }
 */
(function (root) {
  'use strict';

  // id · severity · regex(global) · message · suggest(cách sửa gợi ý)
  var RULES = [
    // ── typography (error) ──
    { id: 'space-before-punct', severity: 'error', re: /\s+([,.;:!?])/g, message: 'Khoảng trắng thừa trước dấu câu', suggest: 'bỏ khoảng trắng trước dấu' },
    { id: 'double-space', severity: 'error', re: / {2,}/g, message: 'Khoảng trắng đôi', suggest: 'dùng 1 khoảng trắng' },
    // ── translationese / calque (warning) ──
    { id: 'calque-no-la', severity: 'warning', re: /\bnó là\s+(?:quan trọng|cần thiết|thú vị|rõ ràng)\b/gi, message: 'Calque "it is …" — không tự nhiên trong tiếng Việt', suggest: 'viết "điều quan trọng là …" / bỏ "nó là"' },
    { id: 'vague-dieu-nay', severity: 'warning', re: /(?:^|[.!?]\s+)(?:Điều này|Điều đó|Việc này)\b/g, message: 'Tham chiếu mơ hồ đầu câu ("điều này")', suggest: 'nói rõ "điều" gì' },
    { id: 'double-modal', severity: 'warning', re: /\bcó thể được\b/gi, message: 'Chồng tình thái "có thể được"', suggest: 'dùng "có thể" hoặc "được"' },
    // ── redundancy / wordiness (preference) ──
    { id: 'mot-cach', severity: 'preference', re: /\bmột cách\s+\p{L}+/giu, message: 'Cụm "một cách + tính từ" thường thừa', suggest: 'dùng trạng từ trực tiếp (vd "một cách nhanh chóng" → "nhanh chóng")' },
    { id: 'boi-vi', severity: 'preference', re: /bởi vì(?=\s|[,.;:!?]|$)/gi, message: '"bởi vì" nặng nề', suggest: 'dùng "vì"' },
    { id: 'redundant-viec', severity: 'preference', re: /\b(?:thực hiện|tiến hành|thực thi)\s+việc\s+/gi, message: 'Danh-từ-hoá thừa "thực hiện việc …"', suggest: 'dùng động từ trực tiếp' },
    { id: 'redundant-conj', severity: 'preference', re: /\b(?:và cũng|nhưng tuy nhiên|vì vậy nên|nhưng mà tuy nhiên)\b/gi, message: 'Liên từ chồng/thừa', suggest: 'giữ 1 liên từ' },
    { id: 'filler-opener', severity: 'preference', re: /(?:^|[.!?]\s+)(?:Nói chung(?: là)?|Nhìn chung|Về cơ bản(?: thì)?|Thành thật mà nói|Phải nói rằng)\b/g, message: 'Mở đầu rào đón (throat-clearing)', suggest: 'vào thẳng ý' },
    // ── weasel / cần nguồn (heuristic) ──
    { id: 'weasel-experts', severity: 'heuristic', re: /(?:các chuyên gia|nhiều người|giới chuyên môn)\s+(?:cho rằng|nói rằng|khẳng định|đồng ý)/gi, message: 'Khẳng định không nguồn ("chuyên gia cho rằng")', suggest: 'nêu nguồn cụ thể hoặc bỏ' },
    { id: 'weasel-studies', severity: 'heuristic', re: /\b(?:nghiên cứu|khoa học|thống kê)\s+(?:cho thấy|chỉ ra|chứng minh)\b/gi, message: 'Dẫn nghiên cứu không nguồn', suggest: 'trích nguồn cụ thể' },
  ];

  function check(text) {
    var s = String(text == null ? '' : text);
    var out = [];
    for (var i = 0; i < RULES.length; i++) {
      var r = RULES[i]; r.re.lastIndex = 0;
      var m;
      while ((m = r.re.exec(s)) !== null) {
        out.push({ id: r.id, severity: r.severity, match: m[0].trim() || m[0], index: m.index, message: r.message, suggest: r.suggest });
        if (m.index === r.re.lastIndex) r.re.lastIndex++;
      }
    }
    return out.sort(function (a, b) { return a.index - b.index; });
  }

  function count(findings) {
    var c = { error: 0, warning: 0, preference: 0, heuristic: 0 };
    (findings || []).forEach(function (f) { if (c[f.severity] != null) c[f.severity]++; });
    return c;
  }

  function summary(findings) {
    var f = Array.isArray(findings) ? findings : [];
    if (!f.length) return 'Sạch — tiếng Việt tự nhiên.';
    var c = count(f);
    var parts = [];
    if (c.error) parts.push(c.error + ' lỗi');
    if (c.warning) parts.push(c.warning + ' cảnh báo');
    if (c.preference) parts.push(c.preference + ' nên sửa');
    if (c.heuristic) parts.push(c.heuristic + ' cần xem');
    return parts.join(' · ') + ': ' + f.slice(0, 5).map(function (x) { return '"' + x.match + '" (' + x.message + ')'; }).join('; ');
  }

  root.VietnameseLint = { check: check, count: count, summary: summary, RULES: RULES };
})(typeof self !== 'undefined' ? self : this);
