/**
 * FilenameBuilder — phần dùng chung của việc dựng tên file tải về.
 *
 * Trước file này có BA bản dựng tên, chép qua chép lại:
 *   1. DownloadHelper.buildFilename        (src/shared)     — bản gốc
 *   2. _buildFilename                      (content.js)     — bản chép y hệt, kèm chú thích
 *                                                             "content.js không với tới được
 *                                                             window.DownloadHelper"
 *   3. GenTab._buildChatGPTFilename        (GenTab.js)      — bản thứ ba cho ChatGPT/Grok
 * cộng ba bản `_toAscii` riêng.
 *
 * Lý do (2) tồn tại nay không còn đúng: content script NẠP ĐƯỢC module dùng chung, đúng cách
 * DownloadPrefs đang làm. Nên phần lõi gom về đây, ba nơi kia gọi vào.
 *
 * Chỗ ba bản đã LỆCH THẬT — thư mục mặc định:
 *   DownloadHelper + content.js → 'seosonaflow_output'
 *   GenTab + WorkflowExecutor   → 'flow-output'
 * Nghĩa là khi người dùng chưa đặt thư mục, ảnh từ Flow và ảnh từ ChatGPT/Grok rơi vào HAI
 * thư mục khác nhau. Nay chỉ còn một hằng số DEFAULT_FOLDER.
 */
(function (root) {
  'use strict';

  var DEFAULT_FOLDER = 'seosonaflow_output';

  /** Tiếng Việt có dấu → ASCII (đ→d, bỏ dấu tổ hợp). Giữ nguyên hành vi của cả ba bản cũ. */
  function toAscii(str) {
    if (!str) return str;
    return String(str)
      .replace(/[đĐ]/g, function (c) { return c === 'đ' ? 'd' : 'D'; })
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  /** Cắt gọn + bỏ ký tự không an toàn cho tên file. */
  function safeSegment(str, max) {
    return toAscii(str || '').substring(0, max || 30).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  /**
   * Thay biến trong mẫu tên rồi dọn dấu gạch dưới thừa.
   * @returns {string} phần TÊN, chưa có thư mục và chưa có đuôi.
   */
  function applyTemplate(opts) {
    opts = opts || {};
    var now = opts.now || new Date();
    var date = now.toISOString().slice(0, 10);              // 2026-08-04
    var time = now.toTimeString().slice(0, 8).replace(/:/g, '-'); // 14-30-25

    var safeProject = safeSegment(opts.project, 30);
    var safePrompt = safeSegment(opts.prompt || opts.fallbackPrompt || 'flow', 40);
    var safeIndex = opts.index ? String(opts.index).padStart(3, '0') : '';

    var name = String(opts.template || '[Date]_[Prompt]')
      .replace(/\[Date\]/gi, date)
      .replace(/\[Time\]/gi, time)
      .replace(/\[Project\]/gi, safeProject)
      .replace(/\[Prompt\]/gi, safePrompt)
      .replace(/\[Index\]/gi, safeIndex);

    name = name.replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (!name) name = (opts.emptyPrefix || 'flow_') + Date.now();
    return name;
  }

  /**
   * Ghép thư mục con, có chống lặp tầng.
   *
   * Vì sao phải chống: người dùng đặt tên workflow trùng tên thư mục gốc thì đường dẫn thành
   * 'seosonaflow_output/seosonaflow_output/file.png' và Chrome không lưu được. Cả ba bản cũ
   * đều đã tự vá lỗi này riêng — đúng dấu hiệu của việc chép mã.
   */
  function joinFolder(baseFolder, subName) {
    var base = baseFolder || DEFAULT_FOLDER;
    if (!subName) return base;
    var safeSub = safeSegment(subName, 60);
    if (!safeSub) return base;
    var lastSeg = base.split('/').pop() || '';
    if (safeSub.toLowerCase() === lastSeg.toLowerCase()) return base;
    return base + '/' + safeSub;
  }

  /** Dựng đường dẫn đầy đủ: {thư mục}/[{thư mục con}/]{tên}.{đuôi} */
  function buildPath(opts) {
    opts = opts || {};
    var name = applyTemplate(opts);
    var base = opts.folder || DEFAULT_FOLDER;
    var full = joinFolder(base, opts.taskName);
    return full + '/' + name + '.' + (opts.ext || 'png');
  }

  root.FilenameBuilder = {
    DEFAULT_FOLDER: DEFAULT_FOLDER,
    toAscii: toAscii,
    safeSegment: safeSegment,
    applyTemplate: applyTemplate,
    joinFolder: joinFolder,
    buildPath: buildPath,
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
