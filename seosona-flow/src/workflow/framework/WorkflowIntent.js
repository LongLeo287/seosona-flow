/**
 * WorkflowIntent — rút YÊU CẦU kiểm-được từ mô tả của người dùng, rồi ĐỐI CHIẾU workflow AI sinh ra.
 *
 * Vì sao cần: validate hiện tại chỉ kiểm CẤU TRÚC (node type có thật, port khớp, không cycle).
 * Một workflow "hợp lệ" vẫn có thể SAI HOÀN TOÀN Ý — user xin "5 ảnh dọc 9:16" mà ra 1 ảnh ngang
 * thì validate vẫn báo ok. Module này đóng khoảng trống đó: trích ràng buộc → so → nêu chỗ lệch
 * bằng ngôn ngữ có thể đưa thẳng cho AI sửa.
 *
 * API:
 *   WorkflowIntent.extract(nl)            -> { mediaType?, count?, ratio?, needs:[], raw }
 *   WorkflowIntent.verify(template, req)  -> { ok, mismatches:[{code,msg,want,got}] }
 *   WorkflowIntent.feedback(mismatches)   -> string (ghép vào prompt sửa)
 */
(function (root) {
  'use strict';

  var VI = { 'một': 1, 'hai': 2, 'ba': 3, 'bốn': 4, 'năm': 5, 'sáu': 6, 'bảy': 7, 'tám': 8, 'chín': 9, 'mười': 10 };

  function _n(s) { return String(s == null ? '' : s).toLowerCase(); }

  // Ranh giới từ có dấu: \b của JS là ranh giới ASCII nên "ảnh"/"hình" KHÔNG bao giờ khớp
  // (ả/ì không phải word-char theo \b). Dùng lookaround theo \p{L} + cờ u mới đúng tiếng Việt.
  // Vẫn cần ranh giới thật để "ảnh" không khớp nhầm trong "ảnh hưởng".
  function has(t, words) {
    try { return new RegExp('(?:^|[^\\p{L}])(?:' + words.join('|') + ')(?![\\p{L}])', 'u').test(t); }
    catch (_) { return new RegExp('(?:' + words.join('|') + ')').test(t); }
  }

  /** Trích ràng buộc KIỂM ĐƯỢC. Chỉ nhận cái chắc chắn — mơ hồ thì bỏ qua (tránh báo sai). */
  function extract(nl) {
    var t = _n(nl);
    var req = { needs: [], raw: String(nl || '') };

    // ── Loại media ──
    var vid = has(t, ['video', 'clip', 'reel', 'short', 'quay', 'chuyển động', 'motion', 'veo', 'sora', 'kling']);
    // Bỏ từ ghép dễ nhầm trước khi dò: "ảnh hưởng" (influence) / "hình như" (seems) KHÔNG phải yêu
    // cầu tạo ảnh. Ranh giới regex không tách được từ ghép 2 tiếng nên phải loại thẳng.
    var ti = t.replace(/ảnh hưởng|hình như|hình thức|hình dung/g, ' ');
    var img = has(ti, ['ảnh', 'hình', 'image', 'poster', 'banner', 'thumbnail', 'photo']);
    if (vid && !img) req.mediaType = 'Video';
    else if (img && !vid) req.mediaType = 'Image';
    // cả hai → pipeline ảnh→video, không chốt cứng

    // ── Số lượng: "5 ảnh", "3 cảnh", "năm ảnh" ──
    var m = t.match(/(\d{1,2})\s*(ảnh|hình|image|cảnh|scene|clip|video|biến thể|variant)/);
    if (m) req.count = parseInt(m[1], 10);
    else {
      var mv = t.match(/(một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười)\s*(ảnh|hình|cảnh|clip|video)/);
      if (mv) req.count = VI[mv[1]];
    }
    if (req.count != null && (req.count < 1 || req.count > 50)) delete req.count;

    // ── Tỉ lệ khung ──
    if (/9:16|dọc|portrait|reel|tiktok|short/.test(t)) req.ratio = 'Dọc';
    else if (/16:9|ngang|landscape|youtube(?!\s*short)/.test(t)) req.ratio = 'Ngang';
    else if (/1:1|vuông|square/.test(t)) req.ratio = 'Vuông';

    // ── Năng lực cần có (map sang node chuyên dụng) ──
    if (/chữ|text|caption|poster|banner|tiêu đề|slogan|logo/.test(t)) req.needs.push('text_overlay');
    if (/nhất quán|đồng nhất|cùng phong cách|giữ style|series|bộ ảnh|nhân vật/.test(t)) req.needs.push('style_anchor');
    if (/tải|lưu|download|xuất file/.test(t)) req.needs.push('download');
    if (/nhiều cảnh|kịch bản|storyboard|chia cảnh|tách cảnh/.test(t)) req.needs.push('prompt_sequence');

    return req;
  }

  // Quy tỉ lệ về 1 khoá chuẩn. Template thật dùng LẪN LỘN 2 dạng: "16:9"/"9:16"/"1:1" (áp đảo:
  // 54/43 lần) và "Ngang"/"Dọc"/"Vuông" (8 lần). Không quy chuẩn thì so chuỗi sẽ báo lệch oan.
  function ratioKey(v) {
    var s = _n(v).replace(/\s/g, '');
    if (!s) return '';
    if (s === 'dọc' || s === '9:16' || s === 'portrait') return 'P';
    if (s === 'ngang' || s === '16:9' || s === 'landscape') return 'L';
    if (s === 'vuông' || s === 'vuong' || s === '1:1' || s === 'square') return 'S';
    return s; // dạng lạ → giữ nguyên để vẫn so được với chính nó
  }

  function _nodes(tpl) {
    if (!tpl) return [];
    return tpl.nodes || tpl.wf_nodes || (tpl.workflow && tpl.workflow.nodes) || [];
  }

  function _type(n) { return (n && (n.node_type || n.type || n.class)) || ''; }

  /** Đối chiếu workflow với yêu cầu. Chỉ báo cái CHẮC CHẮN lệch. */
  function verify(template, req) {
    var out = [];
    req = req || {};
    var nodes = _nodes(template);
    if (!nodes.length) return { ok: false, mismatches: [{ code: 'NO_NODES', msg: 'Workflow rỗng — không có node nào.' }] };

    var gens = nodes.filter(function (n) { return /^(generate|image|chatgpt|grok)$/.test(_type(n)); });

    // ── Loại media ──
    if (req.mediaType && gens.length) {
      var mts = gens.map(function (n) { return String(n.media_type || (n.data && n.data.media_type) || ''); }).filter(Boolean);
      if (mts.length && mts.every(function (x) { return x && x !== req.mediaType; })) {
        out.push({ code: 'MEDIA_TYPE', msg: 'User yêu cầu ' + req.mediaType + ' nhưng workflow sinh ' + mts[0] + '.', want: req.mediaType, got: mts[0] });
      }
    }

    // ── Tỉ lệ ──
    // QUAN TRỌNG: template thật dùng CẢ HAI dạng — "16:9"/"9:16"/"1:1" (áp đảo) lẫn
    // "Ngang"/"Dọc"/"Vuông". So chuỗi thô sẽ báo lệch OAN. Quy về 1 dạng chuẩn trước khi so.
    if (req.ratio && gens.length) {
      var rawRs = gens.map(function (n) { return String(n.ratio || (n.data && n.data.ratio) || ''); }).filter(Boolean);
      var rs = rawRs.map(ratioKey);
      var want = ratioKey(req.ratio);
      if (rs.length && rs.every(function (x) { return x !== want; })) {
        // Hiện giá trị THẬT trong workflow (không hiện khoá chuẩn hoá nội bộ P/L/S).
        out.push({ code: 'RATIO', msg: 'User yêu cầu tỉ lệ ' + req.ratio + ' nhưng workflow đặt ' + rawRs[0] + '.', want: req.ratio, got: rawRs[0] });
      }
    }

    // ── Số lượng: tổng quantity của các node gen phải đạt ──
    if (req.count != null && gens.length) {
      var total = gens.reduce(function (s, n) {
        var q = parseInt(n.quantity || (n.data && n.data.quantity) || 1, 10);
        return s + (isNaN(q) ? 1 : q);
      }, 0);
      if (total < req.count) {
        out.push({ code: 'COUNT', msg: 'User cần ' + req.count + ' kết quả nhưng workflow chỉ sinh ' + total + ' (tăng quantity hoặc thêm node).', want: req.count, got: total });
      }
    }

    // ── Năng lực bắt buộc ──
    var types = nodes.map(_type);
    (req.needs || []).forEach(function (need) {
      if (types.indexOf(need) < 0) {
        out.push({ code: 'MISSING_NODE', msg: 'Yêu cầu ngụ ý cần node "' + need + '" nhưng workflow không có.', want: need, got: null });
      }
    });

    return { ok: out.length === 0, mismatches: out };
  }

  // Chỉ dẫn sửa gửi cho MODEL → viết bằng TIẾNG ANH (model bám chỉ thị tiếng Anh tốt hơn), dựng từ
  // dữ liệu có cấu trúc (code/want/got) chứ KHÔNG dùng lại `msg` — `msg` là tiếng Việt dành cho UI.
  var EN = {
    MEDIA_TYPE: function (x) { return 'The user asked for ' + x.want + ' output, but the workflow generates ' + x.got + '. Set media_type to "' + x.want + '" (and use a matching model).'; },
    RATIO: function (x) { return 'The user asked for aspect ratio "' + x.want + '", but the workflow uses "' + x.got + '". Set ratio to "' + x.want + '" on every generate node (keep this literal enum value, do not translate it).'; },
    COUNT: function (x) { return 'The user needs ' + x.want + ' results but the workflow only produces ' + x.got + '. Raise "quantity" on the generate node(s) — prefer raising quantity over duplicating nodes.'; },
    MISSING_NODE: function (x) { return 'The request implies a "' + x.want + '" node, but the workflow has none. Add it and wire it correctly.'; },
    NO_NODES: function () { return 'The workflow contains no nodes at all. Rebuild it from the user request.'; },
  };

  /** Chuyển chỗ lệch thành chỉ dẫn sửa (tiếng Anh) — đưa thẳng vào prompt repair. */
  function feedback(mismatches) {
    var m = mismatches || [];
    if (!m.length) return '';
    return ['The workflow you produced does NOT match the user request. Fix exactly these points:']
      .concat(m.map(function (x) {
        var f = EN[x.code];
        return '- [' + x.code + '] ' + (f ? f(x) : (x.msg || ''));
      }))
      .concat(['', 'Keep everything that is already correct — change only the points listed above. Return ONLY the corrected JSON spec.'])
      .join('\n');
  }

  root.WorkflowIntent = { extract: extract, verify: verify, feedback: feedback };
})(typeof self !== 'undefined' ? self : this);
