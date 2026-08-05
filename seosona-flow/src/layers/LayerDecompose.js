/**
 * LayerDecompose — MỘT ảnh có sẵn → NHIỀU lớp PNG trong suốt, tự động.
 *
 * Khác hẳn LayerPrompt (gen từng vật rời rồi ghép lại). Ở đây đầu vào là một tấm ảnh ĐÃ CÓ,
 * bên trong có nhiều thứ, và ta muốn tách chúng ra.
 *
 * Tách lớp thật cần HAI việc, và chỉ việc đầu làm được bằng canvas:
 *
 *   1. PHÂN VÙNG — pixel nào thuộc vật nào.
 *      Ảnh đồ hoạ màu phẳng thì gom vùng theo màu là đủ. Ảnh chụp thì không.
 *
 *   2. BÙ PHẦN BỊ CHE — sau khi kéo cây vợt ra, chỗ nó che là một lỗ thủng.
 *      KHÔNG có phép toán nào đoán được sau nó là gì. Bắt buộc phải nhờ mô hình.
 *
 * Nên cách làm ở đây: dùng chính ảnh gốc làm ẢNH THAM CHIẾU cho mô hình, bảo nó vẽ lại ĐÚNG
 * một vật trên nền phẳng. Mô hình tự bù phần bị che vì nó vẽ vật hoàn chỉnh. Rồi cắt nền ở máy
 * bằng LayerCutout.
 *
 * Nói thẳng cái giá: mỗi lớp là một lượt gen (tốn hạn mức), và các lớp ghép lại KHÔNG khớp
 * pixel với ảnh gốc — mô hình vẽ lại chứ không cắt ra. Đây là tách lớp để DÙNG TIẾP, không
 * phải để phục dựng nguyên bản.
 *
 * Module thuần: không DOM, không mạng. Nó dựng KẾ HOẠCH và PROMPT; nơi gọi thực thi.
 */
(function (root) {
  'use strict';

  var BACKDROPS = { magenta: '#FF00FF', green: '#00FF00', blue: '#0000FF' };

  /**
   * Prompt bảo mô hình LIỆT KÊ các vật trong ảnh.
   * Gửi kèm ảnh qua đường vision đã có (pa:generate). Bắt trả JSON để đọc được bằng máy.
   */
  function listObjectsPrompt(opt) {
    opt = opt || {};
    var max = opt.max || 8;
    return [
      'Look at the attached image and list the distinct visual objects that could each be',
      'placed on a separate layer. Include the background/scene as one entry.',
      'Order them from FARTHEST to NEAREST (background first, foreground last).',
      'Return ONLY a JSON array, no prose, no code fence. At most ' + max + ' entries.',
      'Each entry: {"id":"short_snake_case","label":"short English noun phrase",',
      '"depth":<integer, 0 = farthest>,"occluded":<true if partly hidden behind something>}.',
      'Do not invent objects that are not visible. Do not split one object into parts.',
    ].join(' ');
  }

  /** Đọc câu trả lời của mô hình. Chịu được rào ```json và chữ thừa hai đầu. */
  function parseObjects(text) {
    var s = String(text || '').trim();
    s = s.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    var i = s.indexOf('['), j = s.lastIndexOf(']');
    if (i < 0 || j < i) return { ok: false, reason: 'NO_JSON_ARRAY', objects: [] };
    var arr;
    try { arr = JSON.parse(s.slice(i, j + 1)); } catch (e) { return { ok: false, reason: 'BAD_JSON', objects: [] }; }
    if (!Array.isArray(arr)) return { ok: false, reason: 'NOT_ARRAY', objects: [] };

    var seen = {}, out = [];
    for (var k = 0; k < arr.length; k++) {
      var o = arr[k];
      if (!o || typeof o !== 'object') continue;
      var id = String(o.id || o.label || ('layer_' + k)).toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
      if (!id || seen[id]) id = id ? (id + '_' + k) : ('layer_' + k);
      seen[id] = true;
      out.push({
        id: id,
        label: String(o.label || id).trim().slice(0, 80),
        depth: Number.isFinite(+o.depth) ? +o.depth : k,
        occluded: o.occluded === true,
      });
    }
    out.sort(function (a, b) { return a.depth - b.depth; });
    return { ok: out.length > 0, reason: out.length ? null : 'EMPTY', objects: out };
  }

  /**
   * Prompt tách MỘT vật ra khỏi ảnh tham chiếu.
   *
   * Chỗ khó nhất là bắt mô hình GIỮ NGUYÊN vật đó chứ đừng vẽ một cái mới đẹp hơn. Nên phần lớn
   * câu chữ ở đây nói về "cùng cái đó", "cùng góc", "cùng ánh sáng".
   */
  function extractPrompt(obj, opt) {
    opt = opt || {};
    var key = opt.backdrop || 'magenta';
    var hex = BACKDROPS[key];
    if (!hex) throw new Error('LayerDecompose: nền không hỗ trợ: ' + key);
    if (!obj || !obj.label) throw new Error('LayerDecompose: thiếu mô tả vật');

    var parts = [
      'Using the attached reference image, output ONLY the ' + obj.label + ' from it.',
      'Keep it identical to the reference: same shape, same colours, same materials,',
      'same camera angle, same lighting direction, same perspective and same relative size.',
      'Do not redesign it, do not stylise it, do not replace it with a similar object.',
      'Place it on a completely flat ' + key + ' (' + hex + ') background filling the whole frame.',
      'Keep the object away from the frame edges.',
    ];
    // Vật bị che thì mô hình PHẢI vẽ nốt phần khuất — đây chính là việc canvas không làm được.
    if (obj.occluded) {
      parts.push('The object is partly hidden in the reference; draw the complete object,',
        'reconstructing the hidden part plausibly and consistently with the visible part.');
    }
    var negative = [
      'no other objects from the reference image', 'no background scene', 'no drop shadow',
      'no reflection', 'no gradient', 'no border', 'no text', 'no watermark',
      'no cropping of the object', 'no style change',
    ];
    return {
      schema: 'seosona.layer.extract.v1',
      id: obj.id,
      label: obj.label,
      depth: obj.depth,
      occluded: !!obj.occluded,
      backdrop: key,
      positive: parts.join(' '),
      negative: negative.join(', ') + '.',
    };
  }

  /**
   * Kế hoạch đầy đủ cho một ảnh: một lượt liệt kê + N lượt tách.
   * Nói RÕ chi phí trước khi chạy, vì mỗi lớp là một lượt gen tốn hạn mức.
   */
  function plan(objects, opt) {
    if (!Array.isArray(objects) || !objects.length) throw new Error('LayerDecompose: chưa có vật nào');
    var steps = objects.map(function (o) { return extractPrompt(o, opt); });
    return {
      schema: 'seosona.layer.decomposePlan.v1',
      layerCount: steps.length,
      generations: steps.length,
      steps: steps,
      notes: [
        'Mỗi lớp là MỘT lượt gen — ' + steps.length + ' lượt cho ảnh này.',
        'Các lớp ghép lại sẽ KHÔNG khớp pixel với ảnh gốc: mô hình vẽ lại chứ không cắt ra.',
        'Vật bị che sẽ được vẽ bù phần khuất — phần đó là mô hình suy ra, không phải dữ liệu thật.',
      ],
    };
  }

  root.SEOSONA_LayerDecompose = {
    BACKDROPS: BACKDROPS,
    listObjectsPrompt: listObjectsPrompt,
    parseObjects: parseObjects,
    extractPrompt: extractPrompt,
    plan: plan,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
