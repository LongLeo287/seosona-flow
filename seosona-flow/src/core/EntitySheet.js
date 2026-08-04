// SEOSONA Flow — Bảng thực thể (Entity Sheet).
//
// Chống trôi nhận diện khi gen loạt cảnh: mỗi nhân vật/bối cảnh/đạo cụ có MỘT ảnh
// gốc, và ảnh đó được dùng lại cho MỌI cảnh sau. Thay cho việc @mention ref thủ công
// ở từng node — cách cũ vừa dễ sót vừa không có chỗ nào kiểm được là đã đủ ref chưa.
//
// Luật viết prompt đi kèm (quan trọng ngang hệ ảnh ref):
//   Cảnh chỉ gọi thực thể BẰNG TÊN và tả HÀNH ĐỘNG. KHÔNG tả lại ngoại hình.
//   Tả lại ngoại hình bằng chữ là đá nhau với ảnh ref → model phải chọn một bên,
//   và đó chính là lúc nhân vật "trôi".
//
// Classic script, thuần, không DOM/không mạng → test được trực tiếp.
(function (global) {
  'use strict';

  // Loại thực thể → hướng khung + nội dung ảnh gốc cần có.
  var TYPES = {
    character: { ratio: '3:4', orient: 'portrait', shot: 'toàn thân, chính diện, đứng giữa khung, nền trơn' },
    creature:  { ratio: '3:4', orient: 'portrait', shot: 'toàn thân, tư thế tự nhiên, nền trơn' },
    location:  { ratio: '16:9', orient: 'landscape', shot: 'cảnh thiết lập, đường chân trời phẳng, không có nhân vật' },
    prop:      { ratio: '3:4', orient: 'portrait', shot: 'cận cảnh, thấy rõ chất liệu, nền trơn' },
  };
  var DEFAULT_TYPE = 'character';

  // VAI TRÒ tham chiếu — KHÁC với loại thực thể ở trên, và đây là chỗ ta từng thiếu.
  // `type` trả lời thứ này LÀ GÌ; `role` trả lời model phải LẤY GÌ từ ảnh này. Trộn hai câu
  // hỏi làm một là mất khả năng diễn đạt: không nói được "giữ mặt người này, lấy chuyển động
  // từ clip kia, đặt vào bối cảnh nọ" — cách dùng thường gặp nhất khi gen video.
  // Nói RÕ vai trò còn chặn một lỗi im lặng: đưa hai ảnh nhân vật mà không phân vai thì model
  // tự đoán, và thường trộn đặc điểm của cả hai thành một người thứ ba.
  var ROLES = {
    identity:    { label: 'Nhân dạng',   take: 'khuôn mặt, dáng người, trang phục, màu tóc — giữ NGUYÊN' },
    motion:      { label: 'Chuyển động', take: 'nhịp và hướng vận động, cách máy quay đi — KHÔNG lấy nhân dạng' },
    environment: { label: 'Bối cảnh',    take: 'không gian, ánh sáng, chất liệu nền — KHÔNG lấy nhân vật trong ảnh' },
  };
  var ROLE_BY_TYPE = { character: 'identity', creature: 'identity', prop: 'identity', location: 'environment' };
  var DEFAULT_ROLE = 'identity';
  function roleOf(entity) {
    var r = String((entity && entity.role) || '').toLowerCase();
    if (ROLES[r]) return r;
    return ROLE_BY_TYPE[String((entity && entity.type) || '').toLowerCase()] || DEFAULT_ROLE;
  }
  function roleInfo(role) { return ROLES[String(role || '').toLowerCase()] || ROLES[DEFAULT_ROLE]; }

  function typeInfo(type) {
    return TYPES[String(type || '').toLowerCase()] || TYPES[DEFAULT_TYPE];
  }

  /** Chuẩn hoá danh sách thực thể từ chuỗi JSON hoặc mảng. Bỏ mục không có tên. */
  function parse(raw) {
    var arr = raw;
    if (typeof raw === 'string') {
      var s = raw.trim();
      if (!s) return [];
      try { arr = JSON.parse(s); } catch (_e) { return parseLines(s); }
    }
    if (!Array.isArray(arr)) return [];
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var e = arr[i] || {};
      var name = String(e.name || '').trim();
      if (!name) continue;
      out.push({
        name: name,
        type: TYPES[String(e.type || '').toLowerCase()] ? String(e.type).toLowerCase() : DEFAULT_TYPE,
        appearance: String(e.appearance || '').trim(),
        voice: String(e.voice || '').trim(),
      });
    }
    return out;
  }

  /**
   * Dạng gõ nhanh cho người dùng, mỗi dòng một thực thể:
   *   Tên | loại | mô tả ngoại hình
   * Thiếu cột thì lấy mặc định — không bắt người dùng viết JSON.
   */
  function parseLines(text) {
    return String(text || '').split('\n').map(function (line) {
      var p = line.split('|');
      var name = String(p[0] || '').trim();
      if (!name) return null;
      return {
        name: name,
        type: TYPES[String(p[1] || '').trim().toLowerCase()] ? String(p[1]).trim().toLowerCase() : DEFAULT_TYPE,
        appearance: String(p[2] || '').trim(),
        voice: String(p[3] || '').trim(),
        // Cột 5 tuỳ chọn. Không ghi thì suy từ loại — đừng bắt khai thứ đoán được.
        role: ROLES[String(p[4] || '').trim().toLowerCase()] ? String(p[4]).trim().toLowerCase() : '',
      };
    }).filter(Boolean);
  }

  /** Tên trùng nhau thì prompt gọi tên sẽ nhập nhằng → phải báo, không tự đổi tên. */
  function duplicateNames(entities) {
    var seen = Object.create(null), dup = [];
    (entities || []).forEach(function (e) {
      var k = e.name.toLowerCase();
      if (seen[k]) { if (dup.indexOf(e.name) === -1) dup.push(e.name); } else seen[k] = 1;
    });
    return dup;
  }

  /**
   * Prompt sinh ẢNH GỐC cho một thực thể. Đây là ảnh sẽ được dùng lại mãi nên cần
   * đúng khung + nền trơn + không có yếu tố cảnh, tránh mang bối cảnh thừa sang cảnh khác.
   */
  function refSheetPrompt(entity) {
    var t = typeInfo(entity && entity.type);
    var desc = (entity && entity.appearance) || '';
    var parts = [
      'Ảnh tham chiếu nhân dạng cho "' + (entity && entity.name) + '".',
      t.shot + '.',
      desc ? ('Đặc điểm: ' + desc) : '',
      'Ánh sáng đều, không đổ bóng mạnh, không chữ, không watermark, không khung viền.',
    ];
    return parts.filter(Boolean).join(' ');
  }

  /**
   * Khối CAST nhúng vào prompt cảnh. CỐ TÌNH không kèm mô tả ngoại hình: ảnh ref đã
   * mang thông tin đó, viết lại bằng chữ chỉ tạo mâu thuẫn.
   */
  function castBlock(entities, opts) {
    opts = opts || {};
    // Ghi kèm VAI TRÒ và LẤY GÌ: model không tự biết ảnh nào để giữ mặt, ảnh nào để lấy
    // chuyển động. Không nói thì nó đoán, và đoán sai thì nhân vật trôi.
    var list = (entities || []).map(function (e) {
      var r = roleOf(e);
      return '- ' + e.name + ' (' + e.type + ' · ' + ROLES[r].label + ') → lấy: ' + ROLES[r].take;
    }).join('\n');
    if (!list) return '';
    var label = opts.label || 'CAST';
    return '[' + label + ']\n' + list + '\n'
      + 'Quy tắc: gọi các tên trên ĐÚNG NGUYÊN VĂN và chỉ tả HÀNH ĐỘNG của họ. '
      + 'KHÔNG tả lại ngoại hình/trang phục — ảnh tham chiếu đã quy định phần đó.\n'
      + 'Mỗi tham chiếu chỉ đóng ĐÚNG vai đã ghi; không mượn thuộc tính chéo giữa chúng.\n'
      + '[/' + label + ']';
  }

  /**
   * Đủ ref chưa. Đây là cổng chặn: thiếu ảnh gốc mà vẫn gen cảnh thì ra sai nhân vật,
   * và chỉ biết sau khi đã tốn credit.
   * @returns {{ok:boolean, missing:string[], covered:number, total:number}}
   */
  function checkCoverage(entities, refCount) {
    var list = entities || [];
    var n = Math.max(0, Number(refCount) || 0);
    var missing = list.slice(n).map(function (e) { return e.name; });
    return { ok: missing.length === 0 && list.length > 0, missing: missing, covered: Math.min(n, list.length), total: list.length };
  }

  /** Ghép ảnh gốc vào thực thể theo THỨ TỰ (ảnh thứ i ↔ thực thể thứ i). */
  function bind(entities, refs) {
    return (entities || []).map(function (e, i) {
      var r = (refs || [])[i];
      return { name: e.name, type: e.type, appearance: e.appearance, voice: e.voice, ref: r == null ? null : r };
    });
  }

  global.EntitySheet = {
    TYPES: TYPES,
    ROLES: ROLES,
    typeInfo: typeInfo,
    roleOf: roleOf,
    roleInfo: roleInfo,
    parse: parse,
    parseLines: parseLines,
    duplicateNames: duplicateNames,
    refSheetPrompt: refSheetPrompt,
    castBlock: castBlock,
    checkCoverage: checkCoverage,
    bind: bind,
  };
})(typeof self !== 'undefined' ? self : this);
