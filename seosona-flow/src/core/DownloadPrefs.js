/**
 * DownloadPrefs — nguồn chân lý DUY NHẤT cho tuỳ chọn tải về của Google Flow.
 *
 * Vì sao cần: trước file này, mặc định `'1k'` / `'720p'` được viết tay lại ở 11 chỗ trong 6 file
 * (app.js, WorkflowExecutor, WorkflowEditor, TaskModal, TaskList, WorkflowEditorNodeForm). Đổi
 * mặc định là phải sửa đủ 11 chỗ, sót một chỗ là hai đường tải chạy hai kiểu — đúng cái chồng
 * chéo cần dẹp.
 *
 * Khái niệm quan trọng nhất ở đây: **bản gốc** khác **bản phóng to**.
 *
 *   Menu Tải xuống của Flow (ảnh chụp tài khoản Ultra, 2026-08-04):
 *     ảnh : 1K "Kích thước gốc"  · 2K "Đã tăng độ phân giải" · 4K "Đã tăng độ phân giải"
 *     video: 270p "Ảnh GIF động" · 720p "Kích thước gốc"     · 1080p "Đã tăng độ phân giải"
 *            · 4K "Đã tăng độ phân giải · 50 tín dụng"
 *
 *   Chỉ dòng "Kích thước gốc" mới TẢI THẲNG ra file. Các dòng "Đã tăng độ phân giải" là một
 *   THAO TÁC chạy nền — bấm xong không có file ngay, và với video 4K còn trừ tín dụng. Đó là
 *   nguồn gốc mấy file .htm: ta bấm, đứng chờ tải, rồi nhận về trang thông báo và lưu nó lại.
 *
 * Nên nút Tải chỉ hứa đúng một việc: lấy bản gốc. Phóng to là việc riêng, phải do người dùng
 * chủ động chọn ở nơi khác — không mượn nút Tải để làm.
 */
(function (root) {
  'use strict';

  // Khoá trong chrome.storage.local. Đặt tên ở đây để không ai gõ tay chuỗi khoá nữa.
  var KEYS = { image: 'download_resolution', video: 'video_download_resolution' };

  // Mặc định = bản gốc của từng loại. Đổi mặc định thì sửa ĐÚNG hai dòng này.
  var DEFAULTS = { image: '1k', video: '720p' };

  // Mức tải thẳng được. Mọi mức khác Flow đều coi là phóng to.
  var DIRECT = { image: ['1k'], video: ['720p'] };

  function _mode(isVideo) { return isVideo ? 'video' : 'image'; }

  /** Mức này có tải thẳng ra file được không, hay là một thao tác phóng to? */
  function isUpscale(resolution, isVideo) {
    var r = String(resolution || '').toLowerCase();
    if (!r) return false;
    return DIRECT[_mode(isVideo)].indexOf(r) < 0;
  }

  /** Mức bản gốc của loại này. */
  function original(isVideo) { return DEFAULTS[_mode(isVideo)]; }

  /**
   * Chốt mức sẽ dùng cho một lượt tải.
   * @param {string} [wanted] mức người dùng chọn (có thể rỗng / là mức phóng to)
   * @param {boolean} isVideo
   * @returns {{resolution:string, downgraded:boolean, wanted:string}}
   */
  function resolve(wanted, isVideo) {
    var want = String(wanted || '').toLowerCase() || DEFAULTS[_mode(isVideo)];
    if (isUpscale(want, isVideo)) {
      return { resolution: original(isVideo), downgraded: true, wanted: want };
    }
    return { resolution: want, downgraded: false, wanted: want };
  }

  /** Câu giải thích khi phải hạ mức — dùng chung để mọi nơi nói giống nhau. */
  function downgradeReason(wanted, isVideo) {
    var extra = (isVideo && String(wanted).toLowerCase() === '4k') ? ' và tốn tín dụng' : '';
    return 'Mức ' + String(wanted).toUpperCase() + ' là bản PHÓNG TO, Flow không tải thẳng được' +
      extra + ' — đã tải bản gốc ' + original(isVideo).toUpperCase() + ' thay thế.';
  }

  root.DownloadPrefs = {
    KEYS: KEYS,
    DEFAULTS: DEFAULTS,
    DIRECT: DIRECT,
    isUpscale: isUpscale,
    original: original,
    resolve: resolve,
    downgradeReason: downgradeReason,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
