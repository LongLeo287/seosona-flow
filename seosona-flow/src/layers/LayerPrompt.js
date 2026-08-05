/**
 * LayerPrompt — dựng prompt để mô hình vẽ ĐÚNG MỘT vật trên nền phẳng, cắt được.
 *
 * Đây là nửa đầu của ý tưởng tách lớp làm-được-ngay. Không mô hình nào ta điều khiển (Flow,
 * ChatGPT, Grok, Gemini) xuất được ảnh trong suốt. Nhưng nếu bảo nó vẽ một vật duy nhất trên
 * nền phẳng đã hẹn, thì LayerCutout tách được nền đó ở máy — và ta có lớp thật.
 *
 * Prompt này khó ở chỗ mô hình rất hay "giúp thêm": thêm bóng đổ, thêm nền chuyển sắc, thêm
 * phản chiếu, đóng khung. Mỗi thứ đó đều phá phép cắt. Nên phần lớn nội dung ở đây là CẤM,
 * không phải mô tả.
 *
 * Module thuần: không DOM, không mạng.
 */
(function (root) {
  'use strict';

  var BACKDROP_WORDS = {
    magenta: 'pure flat magenta (#FF00FF)',
    green: 'pure flat chroma green (#00FF00)',
    blue: 'pure flat chroma blue (#0000FF)',
  };

  // Những thứ mô hình tự thêm mà phá phép cắt nền. Thứ tự theo mức độ hay gặp.
  var KILLERS = [
    'no drop shadow, no contact shadow, no cast shadow of any kind',
    'no reflection, no mirror, no glossy floor',
    'no gradient, no vignette, no lighting falloff on the background',
    'no texture, no noise, no paper grain on the background',
    'no ground plane, no horizon line, no floor, no table',
    'no border, no frame, no matte, no rounded corners',
    'no text, no watermark, no logo, no label',
    'no additional objects, no props, no hands unless the subject is a hand',
  ];

  /**
   * @param {string} subject   vật cần vẽ, ví dụ "a badminton racket"
   * @param {object} [opt] {backdrop, detail, angle, negativeExtra}
   */
  function build(subject, opt) {
    opt = opt || {};
    var key = opt.backdrop || 'magenta';
    var words = BACKDROP_WORDS[key];
    if (!words) throw new Error('LayerPrompt: nền không hỗ trợ: ' + key);
    var subj = String(subject || '').trim();
    if (!subj) throw new Error('LayerPrompt: thiếu mô tả vật');

    var parts = [
      'Render exactly one isolated object: ' + subj + '.',
      'Place it centred on a ' + words + ' background that fills the entire frame edge to edge.',
      'The background must be one single uniform colour with zero variation.',
      'The object must not touch the frame edges; leave clear margin on all four sides.',
    ];
    if (opt.angle) parts.push('Camera angle: ' + String(opt.angle).trim() + '.');
    if (opt.detail) parts.push(String(opt.detail).trim());
    parts.push('Photographic realism, even neutral lighting on the object itself.');

    var negative = KILLERS.slice();
    if (opt.negativeExtra) negative.push(String(opt.negativeExtra).trim());

    return {
      schema: 'seosona.layer.prompt.v1',
      subject: subj,
      backdrop: key,
      positive: parts.join(' '),
      negative: negative.join(', ') + '.',
      // Đưa lại cho LayerCutout để nó biết màu HẸN là gì — nhưng nó vẫn ĐO màu thật,
      // vì mô hình không bao giờ trả đúng mã màu.
      expectedKey: key,
    };
  }

  /**
   * Dựng cả BỘ lớp cho một cảnh.
   * Trả về danh sách prompt theo thứ tự chồng, xa nhất trước.
   *
   * @param {Array} items [{id, subject, z, angle, detail}]
   */
  function buildSet(items, opt) {
    if (!Array.isArray(items) || !items.length) throw new Error('LayerPrompt: danh sách lớp rỗng');
    var seen = {};
    return items.slice()
      .sort(function (a, b) { return (a.z || 0) - (b.z || 0); })
      .map(function (it, i) {
        if (!it || !it.id) throw new Error('LayerPrompt: lớp thứ ' + i + ' thiếu id');
        if (seen[it.id]) throw new Error('LayerPrompt: id trùng: ' + it.id);
        seen[it.id] = true;
        var p = build(it.subject, {
          backdrop: (opt && opt.backdrop) || 'magenta',
          angle: it.angle, detail: it.detail,
          negativeExtra: opt && opt.negativeExtra,
        });
        p.id = it.id;
        p.z = it.z != null ? it.z : i;
        return p;
      });
  }

  root.SEOSONA_LayerPrompt = {
    BACKDROP_WORDS: BACKDROP_WORDS,
    KILLERS: KILLERS,
    build: build,
    buildSet: buildSet,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
