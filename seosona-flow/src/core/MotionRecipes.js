/**
 * MotionRecipes — thư viện recipe chuyển động CSS/web (offline, zero-dep) cho SEOSONA.
 *
 * Học motion-anything (Apache-2.0): mỗi recipe mang schema có "gu" — intent_keywords (tìm theo ý định),
 * avoid_when (chặn dùng sai chỗ, vd reduced-motion / text nhiều), restraint (ngân sách chống lạm dụng
 * animation). Đây là bộ khởi đầu dùng ngay; có thể mở rộng import 403 recipe gốc sau.
 *
 * API:
 *   MotionRecipes.all() -> recipe[]
 *   MotionRecipes.get(id) -> recipe | null
 *   MotionRecipes.find(intent, {context, limit}) -> ranked recipe[]   // THUẦN, testable
 *   MotionRecipes.css(id) -> string   // @keyframes + class dùng được ngay
 * recipe: { id, name, trigger:'entrance|emphasis|attention|exit', intent_keywords[], avoid_when[],
 *           restraint, duration, easing, keyframes, className }
 */
(function (root) {
  'use strict';

  var SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';
  var EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';

  var RECIPES = [
    { id: 'fade-in', name: 'Fade In', trigger: 'entrance', intent_keywords: ['fade', 'appear', 'reveal', 'soft', 'gentle', 'in'], avoid_when: [], restraint: 'Dùng cho hầu hết element vào màn — an toàn, nhẹ.', duration: '.4s', easing: EASE, keyframes: 'from{opacity:0}to{opacity:1}' },
    { id: 'slide-up-in', name: 'Slide Up In', trigger: 'entrance', intent_keywords: ['slide', 'up', 'rise', 'enter', 'reveal', 'in'], avoid_when: ['reduced-motion'], restraint: '1 lần/nhóm — đừng cho mọi item trượt cùng lúc.', duration: '.5s', easing: EASE, keyframes: 'from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}' },
    { id: 'scale-in', name: 'Scale In', trigger: 'entrance', intent_keywords: ['scale', 'pop', 'zoom', 'grow', 'appear', 'in'], avoid_when: ['reduced-motion'], restraint: 'Cho card/modal/CTA — không cho text dài.', duration: '.4s', easing: SPRING, keyframes: 'from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}' },
    { id: 'blur-in', name: 'Blur In', trigger: 'entrance', intent_keywords: ['blur', 'focus', 'soft', 'dreamy', 'reveal', 'in'], avoid_when: ['reduced-motion', 'low-end'], restraint: 'Blur tốn GPU — dùng cho hero, 1 lần.', duration: '.6s', easing: EASE, keyframes: 'from{opacity:0;filter:blur(8px)}to{opacity:1;filter:blur(0)}' },
    { id: 'pulse', name: 'Pulse', trigger: 'emphasis', intent_keywords: ['pulse', 'beat', 'heartbeat', 'emphasis', 'loop', 'attention'], avoid_when: ['reduced-motion'], restraint: 'Chỉ 1 element/màn — loop nhẹ, dễ gây khó chịu nếu lạm dụng.', duration: '1.6s', easing: EASE, keyframes: '0%,100%{transform:scale(1)}50%{transform:scale(1.05)}' },
    { id: 'glow-pulse', name: 'Glow Pulse', trigger: 'attention', intent_keywords: ['glow', 'highlight', 'attention', 'notify', 'pulse'], avoid_when: ['reduced-motion'], restraint: 'Cho badge/notification — không cho vùng lớn.', duration: '1.8s', easing: EASE, keyframes: '0%,100%{box-shadow:0 0 0 0 rgba(61,111,245,.5)}50%{box-shadow:0 0 0 8px rgba(61,111,245,0)}' },
    { id: 'shake', name: 'Shake', trigger: 'attention', intent_keywords: ['shake', 'error', 'invalid', 'wrong', 'alert', 'reject'], avoid_when: ['text-block'], restraint: 'Chỉ cho phản hồi lỗi (form/field) — 1 lần, không loop.', duration: '.4s', easing: EASE, keyframes: '0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}' },
    { id: 'bounce-in', name: 'Bounce In', trigger: 'entrance', intent_keywords: ['bounce', 'playful', 'fun', 'pop', 'enter', 'in'], avoid_when: ['reduced-motion', 'serious'], restraint: 'Cho brand vui/playful — tránh ngữ cảnh nghiêm túc.', duration: '.6s', easing: SPRING, keyframes: '0%{opacity:0;transform:scale(.6)}60%{transform:scale(1.08)}100%{opacity:1;transform:scale(1)}' },
    { id: 'float', name: 'Float', trigger: 'attention', intent_keywords: ['float', 'hover', 'ambient', 'idle', 'gentle', 'loop'], avoid_when: ['reduced-motion'], restraint: 'Ambient — biên độ nhỏ, chỉ 1-2 element.', duration: '3s', easing: EASE, keyframes: '0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}' },
    { id: 'fade-out', name: 'Fade Out', trigger: 'exit', intent_keywords: ['fade', 'out', 'dismiss', 'leave', 'hide', 'exit'], avoid_when: [], restraint: 'Ghép với removal — giữ ngắn.', duration: '.3s', easing: EASE, keyframes: 'from{opacity:1}to{opacity:0}' },
    { id: 'slide-down-out', name: 'Slide Down Out', trigger: 'exit', intent_keywords: ['slide', 'down', 'out', 'dismiss', 'leave', 'exit'], avoid_when: ['reduced-motion'], restraint: 'Cho toast/panel rời màn.', duration: '.4s', easing: EASE, keyframes: 'from{opacity:1;transform:none}to{opacity:0;transform:translateY(16px)}' },
    { id: 'typewriter', name: 'Typewriter', trigger: 'entrance', intent_keywords: ['type', 'text', 'reveal', 'headline', 'terminal', 'in'], avoid_when: ['reduced-motion', 'long-text'], restraint: 'Chỉ cho headline ngắn 1 dòng — text dài sẽ chậm/khó đọc.', duration: '1.5s', easing: 'steps(24,end)', keyframes: 'from{width:0}to{width:100%}' },
    { id: 'flip-in', name: 'Flip In', trigger: 'entrance', intent_keywords: ['flip', 'rotate', 'card', 'reveal', '3d', 'in'], avoid_when: ['reduced-motion'], restraint: 'Cho card/tile lật vào — 1 lần, tránh chóng mặt hàng loạt.', duration: '.5s', easing: SPRING, keyframes: 'from{opacity:0;transform:perspective(600px) rotateY(90deg)}to{opacity:1;transform:none}' },
    { id: 'wipe-in', name: 'Wipe In', trigger: 'entrance', intent_keywords: ['wipe', 'reveal', 'mask', 'clip', 'in'], avoid_when: ['reduced-motion'], restraint: 'Reveal theo hướng — hero/section.', duration: '.6s', easing: EASE, keyframes: 'from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}' },
    { id: 'ken-burns', name: 'Ken Burns', trigger: 'attention', intent_keywords: ['ken', 'burns', 'pan', 'zoom', 'broll', 'photo', 'slideshow', 'ambient'], avoid_when: ['reduced-motion'], restraint: 'Cho ảnh tĩnh/b-roll thành "sống" — biên độ nhỏ, chậm.', duration: '12s', easing: EASE, keyframes: '0%{transform:scale(1) translate(0,0)}100%{transform:scale(1.08) translate(-2%,-2%)}' },
    { id: 'progress-fill', name: 'Progress Fill', trigger: 'attention', intent_keywords: ['progress', 'fill', 'bar', 'load', 'grow'], avoid_when: [], restraint: 'Thanh tiến trình/loading — transform-origin:left.', duration: '1s', easing: EASE, keyframes: 'from{transform:scaleX(0)}to{transform:scaleX(1)}' },
    { id: 'gradient-shift', name: 'Gradient Shift', trigger: 'attention', intent_keywords: ['gradient', 'shimmer', 'ambient', 'background', 'flow', 'loop'], avoid_when: ['reduced-motion'], restraint: 'Ambient nền — cần background-size:200%; nhẹ, không gây nhiễu chữ.', duration: '6s', easing: EASE, keyframes: '0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}' },
    { id: 'ripple', name: 'Ripple', trigger: 'attention', intent_keywords: ['ripple', 'ring', 'pulse', 'click', 'tap', 'notify'], avoid_when: ['reduced-motion'], restraint: 'Phản hồi tap/điểm nhấn — 1 lần/tương tác.', duration: '.8s', easing: EASE, keyframes: '0%{transform:scale(0);opacity:.6}100%{transform:scale(2.4);opacity:0}' },
    { id: 'slide-left-in', name: 'Slide Left In', trigger: 'entrance', intent_keywords: ['slide', 'left', 'enter', 'in', 'from'], avoid_when: ['reduced-motion'], restraint: 'Vào từ phải sang — cho panel/drawer.', duration: '.45s', easing: EASE, keyframes: 'from{opacity:0;transform:translateX(24px)}to{opacity:1;transform:none}' },
    { id: 'slide-right-in', name: 'Slide Right In', trigger: 'entrance', intent_keywords: ['slide', 'right', 'enter', 'in', 'from'], avoid_when: ['reduced-motion'], restraint: 'Vào từ trái sang — cho panel/drawer.', duration: '.45s', easing: EASE, keyframes: 'from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}' },
    { id: 'rotate-in', name: 'Rotate In', trigger: 'entrance', intent_keywords: ['rotate', 'spin', 'twist', 'enter', 'in'], avoid_when: ['reduced-motion', 'serious'], restraint: 'Icon/badge nhỏ — biên độ nhỏ, tránh vùng lớn.', duration: '.5s', easing: SPRING, keyframes: 'from{opacity:0;transform:rotate(-12deg) scale(.9)}to{opacity:1;transform:none}' },
    { id: 'shimmer', name: 'Shimmer (loading)', trigger: 'attention', intent_keywords: ['shimmer', 'skeleton', 'loading', 'placeholder', 'wait', 'loop'], avoid_when: [], restraint: 'Skeleton loading — cần background-gradient 200%; bỏ khi có data.', duration: '1.4s', easing: EASE, keyframes: '0%{background-position:-200% 0}100%{background-position:200% 0}' },
    { id: 'highlight-sweep', name: 'Highlight Sweep', trigger: 'attention', intent_keywords: ['highlight', 'sweep', 'shine', 'marker', 'underline', 'text'], avoid_when: ['reduced-motion'], restraint: 'Nhấn 1 từ/cụm quan trọng — 1 lần, transform-origin:left.', duration: '.7s', easing: EASE, keyframes: 'from{transform:scaleX(0)}to{transform:scaleX(1)}' },
    { id: 'spin', name: 'Spin (loader)', trigger: 'attention', intent_keywords: ['spin', 'loader', 'spinner', 'loading', 'rotate', 'loop'], avoid_when: [], restraint: 'Spinner tải — chỉ khi thật sự đang chờ.', duration: '.9s', easing: 'linear', keyframes: 'to{transform:rotate(360deg)}' },
    { id: 'reveal-mask-up', name: 'Reveal Mask Up', trigger: 'entrance', intent_keywords: ['reveal', 'mask', 'up', 'text', 'headline', 'in'], avoid_when: ['reduced-motion'], restraint: 'Chữ/heading trồi lên sau mặt nạ — cần overflow:hidden bọc ngoài.', duration: '.6s', easing: EASE, keyframes: 'from{transform:translateY(100%)}to{transform:translateY(0)}' },
    { id: 'zoom-in-soft', name: 'Zoom In Soft', trigger: 'entrance', intent_keywords: ['zoom', 'scale', 'grow', 'soft', 'in'], avoid_when: ['reduced-motion'], restraint: 'Hero/ảnh vào nhẹ — biên độ nhỏ tránh giật.', duration: '.7s', easing: EASE, keyframes: 'from{opacity:0;transform:scale(1.06)}to{opacity:1;transform:scale(1)}' },
    { id: 'attention-nudge', name: 'Attention Nudge', trigger: 'attention', intent_keywords: ['nudge', 'bob', 'hint', 'cta', 'arrow', 'scroll', 'loop'], avoid_when: ['reduced-motion'], restraint: 'Gợi ý CTA/scroll — biên độ nhỏ, 1 element.', duration: '1.4s', easing: EASE, keyframes: '0%,100%{transform:translateY(0)}50%{transform:translateY(4px)}' },
    { id: 'card-lift', name: 'Card Lift', trigger: 'attention', intent_keywords: ['lift', 'hover', 'card', 'raise', 'elevate'], avoid_when: ['reduced-motion'], restraint: 'Hover card — dùng với transition, không loop.', duration: '.2s', easing: EASE, keyframes: 'to{transform:translateY(-4px);box-shadow:0 10px 24px rgba(0,0,0,.18)}' },
    { id: 'badge-pop', name: 'Badge Pop', trigger: 'entrance', intent_keywords: ['badge', 'pop', 'notify', 'count', 'appear', 'in'], avoid_when: ['reduced-motion'], restraint: 'Badge/count xuất hiện — 1 lần.', duration: '.35s', easing: SPRING, keyframes: '0%{transform:scale(0)}70%{transform:scale(1.2)}100%{transform:scale(1)}' },
    { id: 'swing-in', name: 'Swing In', trigger: 'entrance', intent_keywords: ['swing', 'rotate', 'hinge', 'playful', 'in'], avoid_when: ['reduced-motion', 'serious'], restraint: 'Element vui vào — transform-origin:top; tránh ngữ cảnh nghiêm túc.', duration: '.6s', easing: SPRING, keyframes: '0%{opacity:0;transform:rotate(-8deg) translateY(-12px)}100%{opacity:1;transform:none}' },
    { id: 'glow-border', name: 'Glow Border', trigger: 'attention', intent_keywords: ['glow', 'border', 'focus', 'highlight', 'ring', 'loop'], avoid_when: ['reduced-motion'], restraint: 'Viền phát sáng cho input/card active — nhẹ.', duration: '2s', easing: EASE, keyframes: '0%,100%{box-shadow:0 0 0 1px rgba(61,111,245,.4)}50%{box-shadow:0 0 12px 2px rgba(61,111,245,.5)}' },
    { id: 'fade-scale-out', name: 'Fade Scale Out', trigger: 'exit', intent_keywords: ['fade', 'scale', 'out', 'dismiss', 'close', 'exit'], avoid_when: ['reduced-motion'], restraint: 'Modal/card đóng — ghép removal.', duration: '.25s', easing: EASE, keyframes: 'from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.94)}' },
  ];

  function all() { return RECIPES.slice(); }
  function get(id) { for (var i = 0; i < RECIPES.length; i++) if (RECIPES[i].id === id) return RECIPES[i]; return null; }
  // Lọc recipe theo trigger (entrance/emphasis/attention/exit) — cho picker nhóm theo mục đích.
  function byTrigger(trigger) { return RECIPES.filter(function (r) { return r.trigger === trigger; }).map(function (r) { return Object.assign({}, r); }); }

  function _tokens(s) { return (String(s == null ? '' : s).toLowerCase().match(/[a-z]{2,}/g) || []); }

  // Tìm recipe theo ý định (intent) + context (mảng cờ như ['reduced-motion','serious']).
  // Loại recipe có avoid_when khớp context; xếp theo số keyword khớp intent.
  function find(intent, opts) {
    opts = opts || {};
    var ctx = opts.context || [];
    var q = _tokens(intent);
    var out = [];
    RECIPES.forEach(function (r) {
      // context loại trừ
      for (var i = 0; i < r.avoid_when.length; i++) if (ctx.indexOf(r.avoid_when[i]) >= 0) return;
      var kw = {}; r.intent_keywords.forEach(function (k) { kw[k] = 1; });
      var hits = 0; q.forEach(function (w) { if (kw[w]) hits++; });
      // cũng khớp nếu intent chứa tên trigger
      if (q.indexOf(r.trigger) >= 0) hits += 1;
      if (hits > 0) out.push({ recipe: r, _score: hits });
    });
    out.sort(function (a, b) { return b._score - a._score; });
    var limited = typeof opts.limit === 'number' ? out.slice(0, opts.limit) : out;
    return limited.map(function (x) { return Object.assign({ _score: x._score }, x.recipe); });
  }

  // Xuất CSS dùng ngay: @keyframes + class .sf-motion-<id> áp animation.
  function css(id) {
    var r = get(id); if (!r) return '';
    var kf = 'sf-kf-' + r.id;
    var iter = (r.trigger === 'emphasis' || r.trigger === 'attention') && /0%|100%/.test(r.keyframes) && r.id !== 'shake' ? ' infinite' : '';
    return '@keyframes ' + kf + '{' + r.keyframes + '}\n' +
      '.sf-motion-' + r.id + '{animation:' + kf + ' ' + r.duration + ' ' + r.easing + iter + ' both}\n' +
      '@media (prefers-reduced-motion: reduce){.sf-motion-' + r.id + '{animation:none}}';
  }

  // Gộp CSS của nhiều recipe (theo id) thành 1 stylesheet — dùng khi chèn nhiều motion vào 1 trang/landing.
  function cssBundle(ids) {
    if (!Array.isArray(ids)) return '';
    var seen = {}, parts = [];
    ids.forEach(function (id) { if (!seen[id]) { seen[id] = 1; var c = css(id); if (c) parts.push(c); } });
    return parts.join('\n\n');
  }

  root.MotionRecipes = { all: all, get: get, find: find, byTrigger: byTrigger, css: css, cssBundle: cssBundle };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
