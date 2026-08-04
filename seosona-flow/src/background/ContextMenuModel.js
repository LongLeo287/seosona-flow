// SEOSONA Flow — context menu model.
// Keeps right-click menu labels, grouping and save-as formats deterministic.
(function (global) {
  'use strict';

  var API = {};
  var EXTENSION_NAME = 'SEOSONA Flow';
  var SITE_PATTERNS = ['http://*/*', 'https://*/*'];
  var PARENT_ID = 'seosonaflow-i2p-parent';
  var ANALYZE_ID = 'seosonaflow-i2p-analyze';
  var REGION_ID = 'seosonaflow-i2p-region';
  var UPLOAD_ID = 'seosonaflow-i2p-upload-page';
  var SEND_GEN_ID = 'seosonaflow-i2p-send-gen';
  var SAVE_AS_PARENT_ID = 'seosonaflow-save-image-as';
  var MAGNIFIC_SAVE_AS_PARENT_ID = 'seosonaflow-save-image-as-magnific';
  var MAGNIFIC_SITE_PATTERNS = ['https://magnific.com/*', 'https://*.magnific.com/*'];
  var SAVE_FORMATS = [
    { id: 'seosonaflow-save-image-as-png', title: 'PNG', format: 'png', mimeType: 'image/png' },
    { id: 'seosonaflow-save-image-as-jpeg', title: 'JPEG', format: 'jpeg', mimeType: 'image/jpeg' },
    { id: 'seosonaflow-save-image-as-webp', title: 'WEBP', format: 'webp', mimeType: 'image/webp' },
  ];
  var MAGNIFIC_SAVE_FORMATS = [
    { id: 'seosonaflow-save-image-as-magnific-png', title: 'PNG', format: 'png', mimeType: 'image/png' },
    { id: 'seosonaflow-save-image-as-magnific-jpeg', title: 'JPEG', format: 'jpeg', mimeType: 'image/jpeg' },
    { id: 'seosonaflow-save-image-as-magnific-webp', title: 'WEBP', format: 'webp', mimeType: 'image/webp' },
  ];

  var LABELS = {
    vi: {
      analyze: 'Phân tích ảnh → Prompt',
      region: 'Chọn vùng → Prompt',
      upload: 'Tải ảnh từ máy → Prompt',
      sendGen: 'Gửi ảnh → Tạo (ảnh tham chiếu)',
      saveAs: 'Lưu ảnh dưới dạng',
    },
    en: {
      analyze: 'Analyze image → Prompt',
      region: 'Select area → Prompt',
      upload: 'Upload image → Prompt',
      sendGen: 'Send image → Generate (reference)',
      saveAs: 'Save image as',
    },
  };

  function labels(locale) {
    return LABELS[locale] || LABELS.vi;
  }

  function extensionName() {
    return EXTENSION_NAME;
  }

  // HỢP ĐỒNG (tests/unit/context-menu-model.test.mjs): title parent LUÔN là tên ngắn "SEOSONA Flow",
  // BỎ QUA mọi tham số — buildItems gọi parentTitle(locale) nên nhận locale ở arg1. Từng có bản sửa
  // coi arg1 là app_name → menu hiện "vi"/"en". KHÔNG đổi chữ ký này.
  function parentTitle() {
    return EXTENSION_NAME;
  }

  // ALL_CTX = mọi ngữ cảnh (gồm image) → mục hiện KỂ CẢ khi phải chuột lên ẢNH.
  // Trước đây upload chỉ page/frame/... (KHÔNG image) → trên ảnh chỉ thấy 4/5 mục. Thêm image
  // để đủ 5 mục ở mọi ngữ cảnh (analyze/send-gen/save-as vẫn cần srcUrl ảnh nên giữ image-only).
  var ALL_CTX = ['page', 'frame', 'selection', 'link', 'image'];

  function buildItems(locale) {
    var t = labels(locale);
    var items = [
      { id: PARENT_ID, title: parentTitle(locale), contexts: ALL_CTX, documentUrlPatterns: SITE_PATTERNS },
      // 'image'+'link': hiện cả khi ảnh bị <a>/overlay che (Pinterest grid → Chrome chỉ báo link
      // context, không image). Handler tự resolve ảnh tại con trỏ khi thiếu info.srcUrl.
      { id: ANALYZE_ID, parentId: PARENT_ID, title: t.analyze, contexts: ['image', 'link'], documentUrlPatterns: SITE_PATTERNS },
      { id: REGION_ID, parentId: PARENT_ID, title: t.region, contexts: ALL_CTX, documentUrlPatterns: SITE_PATTERNS },
      { id: SEND_GEN_ID, parentId: PARENT_ID, title: t.sendGen, contexts: ['image', 'link'], documentUrlPatterns: SITE_PATTERNS },
      { id: UPLOAD_ID, parentId: PARENT_ID, title: t.upload, contexts: ALL_CTX, documentUrlPatterns: SITE_PATTERNS },
      { id: SAVE_AS_PARENT_ID, parentId: PARENT_ID, title: t.saveAs, contexts: ['image', 'link'], documentUrlPatterns: SITE_PATTERNS },
      // Magnific places page-context overlays above search/detail images. Register a page-only mirror
      // on that domain so the existing cursor resolver can still find the browser-visible image.
      { id: MAGNIFIC_SAVE_AS_PARENT_ID, parentId: PARENT_ID, title: t.saveAs, contexts: ['page'], documentUrlPatterns: MAGNIFIC_SITE_PATTERNS },
    ];
    for (var i = 0; i < SAVE_FORMATS.length; i++) {
      var f = SAVE_FORMATS[i];
      items.push({
        id: f.id,
        parentId: SAVE_AS_PARENT_ID,
        title: f.title,
        format: f.format,
        mimeType: f.mimeType,
        contexts: ['image', 'link'],
        documentUrlPatterns: SITE_PATTERNS,
      });
    }
    for (var j = 0; j < MAGNIFIC_SAVE_FORMATS.length; j++) {
      var mf = MAGNIFIC_SAVE_FORMATS[j];
      items.push({
        id: mf.id,
        parentId: MAGNIFIC_SAVE_AS_PARENT_ID,
        title: mf.title,
        format: mf.format,
        mimeType: mf.mimeType,
        contexts: ['page'],
        documentUrlPatterns: MAGNIFIC_SITE_PATTERNS,
      });
    }
    return items;
  }

  function formatFromMenuId(menuId) {
    for (var i = 0; i < SAVE_FORMATS.length; i++) {
      if (SAVE_FORMATS[i].id === menuId) return SAVE_FORMATS[i];
    }
    for (var j = 0; j < MAGNIFIC_SAVE_FORMATS.length; j++) {
      if (MAGNIFIC_SAVE_FORMATS[j].id === menuId) return MAGNIFIC_SAVE_FORMATS[j];
    }
    return null;
  }

  function baseNameFromUrl(url) {
    var path = '';
    try { path = new URL(String(url || '')).pathname || ''; }
    catch (_) { path = String(url || ''); }
    var last = decodeURIComponent((path.split('/').filter(Boolean).pop() || 'image').split('?')[0]);
    last = last.replace(/\.[a-z0-9]{1,8}$/i, '');
    last = last.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return last || 'image';
  }

  function downloadFilename(url, format) {
    var fmt = String(format || '').toLowerCase();
    if (fmt !== 'png' && fmt !== 'jpeg' && fmt !== 'webp') fmt = 'png';
    return EXTENSION_NAME + '/' + baseNameFromUrl(url) + '.' + fmt;
  }

  API.IDS = {
    PARENT_ID: PARENT_ID,
    ANALYZE_ID: ANALYZE_ID,
    REGION_ID: REGION_ID,
    UPLOAD_ID: UPLOAD_ID,
    SEND_GEN_ID: SEND_GEN_ID,
    SAVE_AS_PARENT_ID: SAVE_AS_PARENT_ID,
  };
  API.SITE_PATTERNS = SITE_PATTERNS.slice();
  API.SAVE_FORMATS = SAVE_FORMATS.slice();
  API.extensionName = extensionName;
  API.parentTitle = parentTitle;
  API.buildItems = buildItems;
  API.formatFromMenuId = formatFromMenuId;
  API.downloadFilename = downloadFilename;
  API.baseNameFromUrl = baseNameFromUrl;

  Object.defineProperty(global, 'SEOSONA_ContextMenuModel', {
    value: API,
    configurable: true,
    writable: true,
  });
})(typeof self !== 'undefined' ? self : this);
