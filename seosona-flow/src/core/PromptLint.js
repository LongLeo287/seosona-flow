/**
 * PromptLint — phát hiện "AI slop" trong PROMPT ẢNH/VIDEO (skill anti-slop-visual).
 * Chuyển phương pháp no-ai-slop (liệt kê cụm-tố-cáo cần cấm) sang thị giác: cấm token hào nhoáng-rỗng
 * (8k / masterpiece / trending on artstation / tính từ cảm thán) → ép prompt tả CỤ THỂ.
 *
 * API:
 *   PromptLint.check(text) -> [{ term, severity:'slop', hint }]   (rỗng = sạch)
 *   PromptLint.isClean(text) -> boolean
 *   PromptLint.summary(findings) -> string (người đọc)
 *
 * Nguyên tắc chống false-positive: chỉ cấm CỤM sáo (highly detailed / hyper-detailed / siêu chi tiết),
 * KHÔNG cấm "detailed"/"chi tiết" trần khi đi kèm danh từ cụ thể ("chi tiết ren tay áo" → sạch).
 */
(function (root) {
  'use strict';

  // rule: regex (global, i) + hint gợi ý thay thế. Mỗi match = 1 finding.
  var RULES = [
    { re: /\b(?:4k|8k|16k|ultra[\s-]?hd)\b/gi, hint: 'nhãn độ phân giải rỗng → tả chi tiết THẬT (chất liệu/kết cấu)' },
    { re: /\bhyper[\s-]?detailed\b/gi, hint: 'liệt kê chi tiết cụ thể thay vì nói "detailed"' },
    { re: /\bhighly detailed\b/gi, hint: 'liệt kê chi tiết cụ thể (ren, cúc, chỉ khâu…)' },
    { re: /\bintricate details?\b/gi, hint: 'nêu rõ chi tiết nào, đừng nói chung' },
    { re: /\bmasterpiece\b/gi, hint: 'tự khen → bỏ; tả bối cảnh/độ khó thật' },
    { re: /\bbest quality\b/gi, hint: 'bỏ; đưa thông số máy/ánh sáng' },
    { re: /\baward[\s-]?winning\b/gi, hint: 'bỏ nhãn tự khen' },
    { re: /\btrending on (?:artstation|deviantart|pixiv)\b/gi, hint: 'phong cách chung chung → nêu chất liệu/kỹ thuật (gouache, risograph…)' },
    { re: /\b(?:cinematic|dramatic|epic) lighting\b/gi, hint: 'nêu HƯỚNG + CHẤT sáng (ngược sáng hoàng hôn, rim light viền tóc)' },
    { re: /\b(?:beautiful|stunning|gorgeous|breathtaking|majestic)\b/gi, hint: 'tính từ cảm thán 0 thông tin → danh từ + đặc điểm' },
    { re: /\b(?:ultra[\s-]?)?(?:photo[\s-]?)?realistic\b/gi, hint: 'model ảnh mặc định đã thực → đưa thông số ống kính/khẩu độ' },
    { re: /\bperfect face\b/gi, hint: 'gây uncanny → tả đặc điểm mặt cụ thể' },
    { re: /\bflawless skin\b/gi, hint: 'gây bóng-nhựa → "da tự nhiên có lỗ chân lông, KHÔNG làm mịn quá"' },
    // Tiếng Việt
    { re: /tuyệt đẹp|đẹp tuyệt|siêu đẹp|đẹp mê hồn/gi, hint: 'cảm thán rỗng → danh từ + đặc điểm cụ thể' },
    { re: /siêu chi tiết|cực chi tiết|chi tiết cao|chi tiết đến từng/gi, hint: 'liệt kê chi tiết cụ thể' },
    { re: /kiệt tác|chất lượng cao nhất|đỉnh cao nghệ thuật/gi, hint: 'bỏ tự khen' },
  ];

  function check(text) {
    var s = String(text == null ? '' : text);
    var out = [];
    for (var i = 0; i < RULES.length; i++) {
      var re = RULES[i].re; re.lastIndex = 0;
      var m;
      while ((m = re.exec(s)) !== null) {
        out.push({ term: m[0], severity: 'slop', hint: RULES[i].hint });
        if (m.index === re.lastIndex) re.lastIndex++; // guard zero-width
      }
    }
    return out;
  }

  function isClean(text) { return check(text).length === 0; }

  function summary(findings) {
    var f = Array.isArray(findings) ? findings : [];
    if (!f.length) return 'Sạch — không thấy cụm slop.';
    var terms = f.map(function (x) { return '"' + x.term + '"'; });
    return f.length + ' cụm slop: ' + terms.join(', ') + '. Thay bằng chi tiết cụ thể (danh từ/chất liệu/ánh sáng/ống kính).';
  }

  root.PromptLint = { check: check, isClean: isClean, summary: summary, RULES: RULES };
})(typeof self !== 'undefined' ? self : this);
