// SEOSONA Flow — kho STYLE của người dùng (cục bộ).
//
// Sản phẩm cùng ngách cho tạo/sửa/xoá style nhưng lưu qua server (kèm tài khoản).
// SEOSONA local-first nên không đi đường đó: style là văn bản của người dùng, không có
// lý do gì phải rời máy họ. Cùng khuôn với af_user_prompts / af_user_templates đã có.
//
// Phần thuần (validate, thêm/sửa/xoá trên mảng) tách khỏi phần chrome.storage để test
// trực tiếp — logic hợp nhất/trùng tên là chỗ dễ sai nhất, phải kiểm được.
(function (root) {
  'use strict';

  var KEY = 'af_user_styles';
  var MAX_NAME = 60;
  var MAX_CONTENT = 4000;

  function _now() { return new Date().toISOString(); }

  /** Sinh id ổn định, không đụng Date.now để phần thuần vẫn test tất định được. */
  function makeId(name, seed) {
    var s = String(name || '') + '|' + String(seed == null ? '' : seed);
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'ust_' + h.toString(36);
  }

  /**
   * @returns {{ok:boolean, error?:string, style?:object}}
   * Lỗi trả về CÂU TIẾNG VIỆT để hiện thẳng lên form — không bắt nơi gọi tự dịch mã lỗi.
   */
  function validate(input) {
    var name = String((input && input.name) || '').trim();
    var content = String((input && input.content) || '').trim();
    if (!name) return { ok: false, error: 'Chưa đặt tên style.' };
    if (name.length > MAX_NAME) return { ok: false, error: 'Tên dài quá ' + MAX_NAME + ' ký tự.' };
    if (!content) return { ok: false, error: 'Chưa nhập nội dung style.' };
    if (content.length > MAX_CONTENT) return { ok: false, error: 'Nội dung dài quá ' + MAX_CONTENT + ' ký tự.' };
    return {
      ok: true,
      style: {
        id: (input && input.id) || null,
        name: name,
        content: content,
        category: String((input && input.category) || '').trim() || null,
        source: 'user',
      },
    };
  }

  /** Trùng tên (không phân biệt hoa thường), bỏ qua chính mục đang sửa. */
  function findByName(list, name, exceptId) {
    var k = String(name || '').trim().toLowerCase();
    return (list || []).find(function (s) {
      return s && String(s.name || '').trim().toLowerCase() === k && s.id !== exceptId;
    }) || null;
  }

  /**
   * Thêm hoặc sửa. Trả về DANH SÁCH MỚI, không sửa mảng đầu vào — nơi gọi thường đang
   * render từ chính mảng đó; sửa tại chỗ là UI lệch state.
   * @returns {{ok:boolean, error?:string, list?:Array, style?:object, created?:boolean}}
   */
  function upsert(list, input, opts) {
    opts = opts || {};
    var v = validate(input);
    if (!v.ok) return v;
    var arr = (list || []).slice();
    var dup = findByName(arr, v.style.name, v.style.id);
    if (dup) return { ok: false, error: 'Đã có style tên "' + dup.name + '".' };

    if (v.style.id) {
      var i = arr.findIndex(function (s) { return s && s.id === v.style.id; });
      if (i < 0) return { ok: false, error: 'Không tìm thấy style để sửa (có thể đã bị xoá).' };
      // Giữ createdAt của bản gốc — sửa nội dung không phải là tạo mới.
      var merged = Object.assign({}, arr[i], v.style, { updatedAt: opts.now || _now() });
      arr[i] = merged;
      return { ok: true, list: arr, style: merged, created: false };
    }
    var made = Object.assign({}, v.style, {
      id: makeId(v.style.name, opts.seed),
      createdAt: opts.now || _now(),
      updatedAt: opts.now || _now(),
    });
    arr.push(made);
    return { ok: true, list: arr, style: made, created: true };
  }

  function remove(list, id) {
    var arr = (list || []).slice();
    var i = arr.findIndex(function (s) { return s && s.id === id; });
    if (i < 0) return { ok: false, error: 'Không tìm thấy style để xoá.' };
    var gone = arr.splice(i, 1)[0];
    return { ok: true, list: arr, style: gone };
  }

  /**
   * Gộp style hệ thống + style người dùng để hiển thị.
   * Người dùng đặt trùng tên style hệ thống thì bản của HỌ thắng — họ tạo ra nó là để
   * thay cái mặc định, không phải để bị bản mặc định che.
   */
  function mergeForDisplay(builtin, user) {
    var out = (user || []).slice();
    var taken = {};
    out.forEach(function (s) { taken[String(s.name || '').toLowerCase()] = 1; });
    (builtin || []).forEach(function (s) {
      if (!taken[String((s && s.name) || '').toLowerCase()]) out.push(s);
    });
    return out;
  }

  // ── Lớp lưu trữ (chrome.storage) ────────────────────────────────────────────
  function load() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get([KEY], function (r) {
          void chrome.runtime.lastError;
          var v = r && r[KEY];
          resolve(Array.isArray(v) ? v : []);
        });
      } catch (_e) { resolve([]); }
    });
  }

  function save(list) {
    return new Promise(function (resolve) {
      try {
        var o = {}; o[KEY] = list || [];
        chrome.storage.local.set(o, function () { void chrome.runtime.lastError; resolve(true); });
      } catch (_e) { resolve(false); }
    });
  }

  root.UserStyleStore = {
    KEY: KEY, MAX_NAME: MAX_NAME, MAX_CONTENT: MAX_CONTENT,
    makeId: makeId, validate: validate, findByName: findByName,
    upsert: upsert, remove: remove, mergeForDisplay: mergeForDisplay,
    load: load, save: save,
  };
})(typeof window !== 'undefined' ? window : this);
