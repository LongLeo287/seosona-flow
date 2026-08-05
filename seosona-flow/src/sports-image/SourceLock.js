/**
 * SourceLock — "ảnh nguồn là authority".
 *
 * Lấy từ chương 8.1 của bản đặc tả Sports Image Workflow. Ý tưởng: trước khi cho mô hình đụng
 * vào ảnh, ta CHỐT ảnh gốc lại — băm nội dung, ghi chính sách, phát một biên nhận. Về sau mọi
 * bước (ghép, so sánh, cổng xuất) đều đối chiếu với biên nhận đó.
 *
 * Vì sao cần: khoá bằng PROMPT là không đủ. Bảo mô hình "giữ nguyên khuôn mặt" chỉ là lời đề
 * nghị — nó vẫn vẽ lại và không ai biết đã lệch bao nhiêu. Khoá bằng BĂM thì lệch một pixel
 * ngoài vùng cho phép là phát hiện được, không cần tin ai.
 *
 * Module thuần: không DOM, không mạng, không chrome.*. Chạy được trong worker lẫn trang lẫn test.
 */
(function (root) {
  'use strict';

  var DEFAULT_POLICY = {
    preserveOutsideMask: true,   // ngoài vùng mask phải y hệt nguồn
    lockIdentity: true,          // khuôn mặt/nhận dạng không được vẽ lại
    allowBorderOutpaint: false,  // mở rộng khung có được tính là "thay đổi hợp lệ" không
    maxOutsideDriftRatio: 0.015, // 1,5% — ngưỡng đặc tả đề xuất cho outside-mask drift
  };

  /**
   * Băm nội dung ảnh. Nhận ImageData (canvas) hoặc Uint8Array (bytes file).
   *
   * Dùng FNV-1a 64-bit thay vì SHA-256: băm ở đây để PHÁT HIỆN THAY ĐỔI, không phải để chống
   * giả mạo có chủ đích — không có kẻ tấn công nào trong luồng này, chỉ có mô hình vẽ đè.
   * FNV chạy đồng bộ, không cần crypto.subtle (vốn là async và không có ở mọi ngữ cảnh worker).
   */
  function hashPixels(src) {
    var bytes = src && src.data ? src.data : src;
    if (!bytes || typeof bytes.length !== 'number') return null;
    // 64-bit bằng hai lane 32-bit — JS không có số nguyên 64-bit thật.
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    var n = bytes.length;
    for (var i = 0; i < n; i++) {
      var b = bytes[i];
      h1 = (h1 ^ b) >>> 0;
      h1 = Math.imul(h1, 16777619) >>> 0;
      if ((i & 3) === 3) { h2 = (h2 ^ h1) >>> 0; h2 = Math.imul(h2, 2246822519) >>> 0; }
    }
    var hex = ('00000000' + h1.toString(16)).slice(-8) + ('00000000' + h2.toString(16)).slice(-8);
    return 'fnv1a64:' + hex;
  }

  /** Băm KÈM kích thước — đổi kích thước mà pixel trùng nhau vẫn phải ra băm khác. */
  function hashImage(img) {
    var h = hashPixels(img);
    if (!h) return null;
    var w = (img && img.width) || 0, ht = (img && img.height) || 0;
    return h + ':' + w + 'x' + ht;
  }

  /**
   * Chốt một ảnh nguồn.
   * @param {ImageData|Uint8Array} image
   * @param {object} [policy] ghi đè từng phần lên DEFAULT_POLICY
   * @param {object} [meta] {id, at, note} — `at` do CALLER đưa vào (module này không đọc đồng hồ,
   *        để kết quả tất định và test lại được).
   */
  function lock(image, policy, meta) {
    meta = meta || {};
    var hash = hashImage(image);
    if (!hash) throw new Error('SourceLock: ảnh không hợp lệ');
    var pol = {};
    var k;
    for (k in DEFAULT_POLICY) pol[k] = DEFAULT_POLICY[k];
    if (policy) for (k in policy) if (k in DEFAULT_POLICY) pol[k] = policy[k];
    return {
      schema: 'seosona.sports.sourceLock.v1',
      sourceLockId: meta.id || ('lock_' + hash.slice(-12)),
      sourceHash: hash,
      width: (image && image.width) || null,
      height: (image && image.height) || null,
      policy: pol,
      at: meta.at != null ? meta.at : null,
      note: meta.note || null,
    };
  }

  /**
   * Ảnh này CÓ ĐÚNG là bản đã chốt không?
   * Dùng ở đầu mỗi bước sửa: nếu nguồn đã bị thay giữa chừng thì mọi so sánh phía sau là vô nghĩa.
   */
  function verify(lockRec, image) {
    if (!lockRec || !lockRec.sourceHash) return { ok: false, reason: 'NO_LOCK' };
    var h = hashImage(image);
    if (!h) return { ok: false, reason: 'BAD_IMAGE' };
    if (h !== lockRec.sourceHash) {
      return { ok: false, reason: 'SOURCE_CHANGED', expected: lockRec.sourceHash, actual: h };
    }
    return { ok: true, reason: null };
  }

  /**
   * Biên nhận cho MỘT bước sửa. Ghi lại đủ để phát lại và để so sánh về sau.
   * Đặc tả 8.3 đòi ghi mask dilation/feather và hình chữ nhật crop — nên chúng nằm trong `scope`.
   */
  function receipt(lockRec, step) {
    step = step || {};
    return {
      schema: 'seosona.sports.editReceipt.v1',
      sourceLockId: lockRec ? lockRec.sourceLockId : null,
      sourceHash: lockRec ? lockRec.sourceHash : null,
      step: step.name || 'edit',
      engine: step.engine || null,
      scope: {
        maskDilation: step.maskDilation != null ? step.maskDilation : null,
        feather: step.feather != null ? step.feather : null,
        cropRect: step.cropRect || null,
      },
      params: step.params || null,
      resultHash: step.result ? hashImage(step.result) : null,
      at: step.at != null ? step.at : null,
    };
  }

  root.SEOSONA_SourceLock = {
    DEFAULT_POLICY: DEFAULT_POLICY,
    hashPixels: hashPixels,
    hashImage: hashImage,
    lock: lock,
    verify: verify,
    receipt: receipt,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
