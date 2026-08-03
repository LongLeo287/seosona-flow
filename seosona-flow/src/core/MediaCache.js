// SEOSONA Flow — bộ nhớ đệm media bắt tại nguồn.
//
// VẤN ĐỀ: link media của Google có CHỮ KÝ HẾT HẠN (~1 giờ). Workflow dài, hoặc mở lại
// kết quả cũ, là link chết — tải về thì 403, mà lúc đó ảnh/video đã sinh xong và đã tốn
// credit rồi. Không có cách nào "làm mới" link đó từ phía ta.
//
// LỜI GIẢI: đừng giữ LINK, giữ BYTES. Trang Flow đã tải media về để hiển thị; bắt lại
// đúng lúc đó là có bản sao không bao giờ hết hạn.
//
// Cái giá là BỘ NHỚ — video vài chục MB mỗi cái. Nên module này tồn tại: một bộ đệm có
// TRẦN CỨNG (số lượng + tổng byte), loại theo LRU, và trả về danh sách cần thu hồi để
// nơi gọi revokeObjectURL — giữ blob mà quên revoke là rò bộ nhớ cho tới khi đóng tab.
//
// Thuần, không DOM/không mạng → test trực tiếp.
(function (root) {
  'use strict';

  var DEFAULTS = {
    maxItems: 12,
    maxBytes: 96 * 1024 * 1024,  // 96 MB: đủ vài video 8s, chưa tới mức làm nặng tab
    ttlMs: 6 * 60 * 60 * 1000,   // 6 giờ — dài hơn hẳn 1 giờ của chữ ký, đủ cho một buổi làm
  };

  function create(opts) {
    opts = opts || {};
    var maxItems = opts.maxItems || DEFAULTS.maxItems;
    var maxBytes = opts.maxBytes || DEFAULTS.maxBytes;
    var ttlMs = opts.ttlMs || DEFAULTS.ttlMs;
    var map = new Map();   // id -> { id, url, bytes, type, at, hits }
    var total = 0;

    function _evict(now) {
      var dropped = [];
      // 1. Hết hạn trước — bỏ đồ cũ bao giờ cũng đúng hơn bỏ đồ vừa dùng.
      for (var e of [...map.values()]) {
        if (now - e.at > ttlMs) { map.delete(e.id); total -= e.bytes; dropped.push(e); }
      }
      // 2. Rồi mới tới LRU cho tới khi lọt trần.
      while (map.size > maxItems || total > maxBytes) {
        var oldest = null;
        for (var v of map.values()) if (!oldest || v.at < oldest.at) oldest = v;
        if (!oldest) break;
        map.delete(oldest.id); total -= oldest.bytes; dropped.push(oldest);
      }
      return dropped;
    }

    return {
      /**
       * @returns {{stored:boolean, dropped:Array, reason?:string}}
       * `dropped` LUÔN phải được nơi gọi revokeObjectURL — đây là hợp đồng, không phải gợi ý.
       */
      put: function (id, url, bytes, type, now) {
        now = now || 0;
        if (!id || !url) return { stored: false, dropped: [], reason: 'THIẾU_ID_HOẶC_URL' };
        var size = Math.max(0, Number(bytes) || 0);
        // Một file to hơn cả trần thì nhận vào cũng vô nghĩa: nó sẽ đẩy hết mọi thứ khác ra.
        if (size > maxBytes) return { stored: false, dropped: [], reason: 'QUÁ_LỚN' };
        var dropped = [];
        var old = map.get(id);
        if (old) { total -= old.bytes; map.delete(id); dropped.push(old); }
        map.set(id, { id: id, url: url, bytes: size, type: type || '', at: now, hits: 0 });
        total += size;
        return { stored: true, dropped: dropped.concat(_evict(now)) };
      },

      /** Lấy ra và ĐÁNH DẤU vừa dùng (LRU) — không đánh dấu thì đồ đang dùng vẫn bị loại. */
      get: function (id, now) {
        var e = map.get(id);
        if (!e) return null;
        if ((now || 0) - e.at > ttlMs) { map.delete(id); total -= e.bytes; return null; }
        e.at = now || e.at; e.hits += 1;
        return e;
      },

      has: function (id) { return map.has(id); },
      size: function () { return map.size; },
      bytes: function () { return total; },
      /** Dọn hết — trả toàn bộ để nơi gọi revoke. */
      clear: function () {
        var all = [...map.values()];
        map.clear(); total = 0;
        return all;
      },
      stats: function () { return { items: map.size, bytes: total, maxItems: maxItems, maxBytes: maxBytes, ttlMs: ttlMs }; },
    };
  }

  /**
   * Rút id media từ URL của Flow. Cùng một media có thể tới qua nhiều URL khác nhau
   * (tRPC redirect, link ký của storage) nên phải quy về MỘT id, nếu không cùng một
   * video bị lưu nhiều lần và đá nhau ra khỏi bộ đệm.
   */
  function idFromUrl(url) {
    var s = String(url || '');
    if (!s) return null;
    // 1. UUID ở bất kỳ đâu trong URL — dạng ổn định nhất.
    var m = s.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    if (m) return m[0].toLowerCase();
    // 2. tRPC: ?name=<id> hoặc input={"json":{"name":"<id>"}}
    var n = s.match(/[?&]name=([^&#]+)/) || s.match(/"name"\s*:\s*"([^"]+)"/);
    if (n) { try { return decodeURIComponent(n[1]).toLowerCase(); } catch (_e) { return n[1].toLowerCase(); } }
    // 3. Tên file cuối đường dẫn, bỏ query — link ký có query rất dài và ĐỔI mỗi lần ký lại.
    var p = s.split('?')[0].split('/').filter(Boolean).pop();
    return p ? p.toLowerCase() : null;
  }

  /** URL này có phải media của Flow đáng bắt không. */
  function isMediaUrl(url) {
    var s = String(url || '');
    if (!s) return false;
    if (/getMediaUrlRedirect/i.test(s)) return true;
    if (/storage\.googleapis\.com\/.*(ai-sandbox|videofx|imagefx)/i.test(s)) return true;
    if (/\.(mp4|webm|png|jpe?g|webp)(\?|$)/i.test(s) && /googleusercontent|googlevideo|googleapis/i.test(s)) return true;
    return false;
  }

  root.MediaCache = { DEFAULTS: DEFAULTS, create: create, idFromUrl: idFromUrl, isMediaUrl: isMediaUrl };
})(typeof window !== 'undefined' ? window : this);
