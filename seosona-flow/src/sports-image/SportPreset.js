/**
 * SportPreset — preset theo môn + bộ HỢP PROMPT 4 LỚP (chương 12 của đặc tả).
 *
 * Thứ tự lớp là CỐ ĐỊNH và có ý nghĩa:
 *   A. chính sách giữ-nguồn   — toàn cục, KHÔNG ai được ghi đè
 *   B. preset môn             — luật của môn thể thao
 *   C. lệnh riêng của node    — việc cụ thể node đó làm
 *   D. lệnh người dùng        — mong muốn riêng lần chạy này
 *
 * Vì sao thứ tự quan trọng: lớp D đứng CUỐI nên nó bổ sung, không thay thế. Nếu người dùng gõ
 * "vẽ lại toàn bộ ảnh cho đẹp", lớp A phía trên đã nói "không tái tạo toàn khung" và bộ lọc
 * policy bên dưới sẽ chặn — mong muốn của người dùng không được phép phá chính sách giữ nguồn.
 * Đó là lý do đặc tả viết "prompt không được override policy".
 *
 * Module thuần: không DOM, không mạng, không chrome.*.
 */
(function (root) {
  'use strict';

  // ── Lớp A — nguyên văn §12.1 ────────────────────────────────────────────────────────────
  var SOURCE_PRESERVING_POLICY = [
    'You are a source-preserving sports photo editing engine.',
    'The original photograph is the primary authority. Do not regenerate the full image.',
    'Preserve the exact athlete identity, face, hair, body proportions, clothing, shoes,',
    'venue, camera angle and original action moment unless an active node explicitly permits',
    'a small local correction. Modify only the explicitly masked region. Outside the active',
    'mask preserve the source unchanged. Reference images transfer only permitted equipment',
    'attributes inside the bound equipment mask. Produce realistic sports photography.',
  ].join(' ');

  // ── Lớp phủ định — nguyên văn §12.3 ─────────────────────────────────────────────────────
  var NEGATIVE_POLICY = [
    'Do not create a new person, generic athlete face, facial reconstruction, beauty filter,',
    'new hair, altered body type, new clothing or shoes, venue redesign, full-frame repaint,',
    'extra fingers, extra limbs, duplicate racket, duplicate shuttlecock, ghost shuttle,',
    'wrong grip, panhandle unless requested, static shuttle near the foot, text, watermark,',
    'border, poster graphics, fantasy lighting, plastic skin, or artificial HDR.',
  ].join(' ');

  // Cụm mà lệnh người dùng KHÔNG được phép yêu cầu — chúng phá thẳng chính sách lớp A.
  var POLICY_BREAKERS = [
    /\b(regenerate|repaint|redraw)\s+(the\s+)?(whole|full|entire)\b/i,
    /\bfull[- ]frame\s+(repaint|regenerate)\b/i,
    /\b(new|different)\s+(face|person|athlete)\b/i,
    /\b(beauty|glamour)\s+filter\b/i,
    // KHÔNG dùng ranh-giới-từ (\b) với tiếng Việt: regex JS chỉ coi ký tự ASCII là "chữ",
    // nên \b đặt sau "bộ" hay "mặt" không bao giờ khớp — mẫu trông đúng mà chặn hụt.
    /thay\s+(mặt|người)/i,
    /vẽ\s+lại\s+(toàn\s+bộ|cả\s+ảnh)/i,
  ];

  var PRESETS = {
    'badminton.v1': {
      sport: 'badminton',
      version: 'v1',
      // Nguyên văn §12.2
      prompt: [
        'Sport: indoor badminton action photography. Preserve the original lunge and body.',
        'For a low forehand defensive lift: racket hand low but forward, elbow softly bent,',
        'wrist near neutral, racket face slightly open, swing low-to-high. Shuttlecock leaves',
        'the string bed on the same vector; cork leads right/up, feather trail extends left/down.',
        'Keep motion blur short and directional; never create duplicate shuttlecocks or rackets.',
      ].join(' '),
      // Ngưỡng cho SportsValidator và CompareDiff — §11
      thresholds: {
        identityDistance: 0.08,
        outsideDriftRatio: 0.015,
        minWidth: 4320,
        minHeight: 7680,
      },
      // Quy tắc bố cục §11 (dọc 9:16)
      composition: {
        aspect: '9:16',
        bodyCenterX: [0.44, 0.48],   // tâm thị giác của thân
        headroom: [0.18, 0.22],
        floorMargin: [0.10, 0.14],
      },
      // Lớp mask mà mask_editor phải cung cấp
      maskLayers: ['face', 'hair', 'hand', 'racket', 'shuttle', 'border'],
      finishPreset: 'indoor_sport',
      validator: 'badminton.v1',
    },
  };

  function list() { return Object.keys(PRESETS); }
  function get(name) { return PRESETS[name] || null; }
  function register(name, preset) {
    if (!name || !preset || !preset.prompt) throw new Error('SportPreset: preset không hợp lệ');
    PRESETS[name] = preset;
  }

  /** Chuẩn hoá khoảng trắng — đặc tả đòi resolver làm việc này trước khi băm. */
  function _norm(s) { return String(s || '').replace(/\s+/g, ' ').trim(); }

  /** Băm nội dung prompt để ghi vào biên nhận — cùng thuật toán với SourceLock. */
  function _hash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) {
      h = (h ^ s.charCodeAt(i)) >>> 0;
      h = Math.imul(h, 16777619) >>> 0;
    }
    return 'p' + ('00000000' + h.toString(16)).slice(-8);
  }

  /**
   * Hợp 4 lớp thành một prompt.
   * @param {string} presetName
   * @param {object} [opt] {node, user, vars}
   *        node : lệnh riêng của node (lớp C)
   *        user : lệnh người dùng (lớp D)
   *        vars : thay {{biến}} trong lớp C — §12 nêu edit_scope, equipment_attributes, motion_vector
   */
  function resolve(presetName, opt) {
    opt = opt || {};
    var preset = get(presetName);
    if (!preset) throw new Error('SportPreset: không có preset ' + presetName);

    var nodeText = _norm(opt.node);
    if (nodeText && opt.vars) {
      nodeText = nodeText.replace(/\{\{(\w+)\}\}/g, function (m, k) {
        return opt.vars[k] != null ? String(opt.vars[k]) : m;
      });
    }

    // Lệnh người dùng bị soi TRƯỚC khi ghép — chặn ở đây rẻ hơn phát hiện sau khi đã sinh ảnh.
    var userText = _norm(opt.user);
    var rejected = [];
    if (userText) {
      for (var i = 0; i < POLICY_BREAKERS.length; i++) {
        if (POLICY_BREAKERS[i].test(userText)) {
          rejected.push(POLICY_BREAKERS[i].source);
        }
      }
      if (rejected.length) userText = '';   // bỏ hẳn lớp D, KHÔNG cố sửa chữa nửa vời
    }

    var layers = [
      { id: 'A_policy', text: _norm(SOURCE_PRESERVING_POLICY) },
      { id: 'B_preset', text: _norm(preset.prompt) },
    ];
    if (nodeText) layers.push({ id: 'C_node', text: nodeText });
    if (userText) layers.push({ id: 'D_user', text: userText });

    var positive = layers.map(function (l) { return l.text; }).join('\n\n');
    return {
      schema: 'seosona.sports.prompt.v1',
      preset: presetName,
      presetVersion: preset.version,
      positive: positive,
      negative: _norm(NEGATIVE_POLICY),
      layers: layers.map(function (l) { return l.id; }),
      promptHash: _hash(positive + '|' + NEGATIVE_POLICY),
      // Nói RA việc đã bỏ lệnh người dùng, không im lặng — người dùng cần biết vì sao
      // yêu cầu của họ không có tác dụng.
      userInstructionRejected: rejected.length > 0,
      rejectedReasons: rejected,
    };
  }

  root.SEOSONA_SportPreset = {
    SOURCE_PRESERVING_POLICY: SOURCE_PRESERVING_POLICY,
    NEGATIVE_POLICY: NEGATIVE_POLICY,
    list: list,
    get: get,
    register: register,
    resolve: resolve,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
