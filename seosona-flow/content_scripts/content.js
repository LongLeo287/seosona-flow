// === Re-injection guard (IIFE pattern) ===
// Manifest content_scripts auto-inject content.js khi page load match labs.google/fx/*
// PLUS background.js onInstalled cũng auto-inject vào existing tabs để cover orphan scenario.
// → Nếu user reload extension KHI tab Flow đã mở, content.js inject 2 LẦN →
// chrome.runtime.onMessage.addListener register 2 lần → mỗi message fire 2× handlers
// → addFileToPrompt right-click 2× cho mỗi ref, downloadTileMedia download 2× mỗi tile.
// Fix: IIFE với early return - không throw error, không console noise.
if (self.__seosonaflowContentJsLoaded__) {
  // Silent skip - đã loaded trước đó
} else {
self.__seosonaflowContentJsLoaded__ = true;

// Post-reload noise guard: khi user reload extension trong lúc tab Flow đang mở, content script
// CŨ vẫn chạy các async chain → chrome.* ném "Extension context invalidated". Vô hại (bản mới sẽ
// inject khi refresh tab). Nuốt các lỗi này để không spam trang chrome://extensions Errors.
(function _installCtxInvalidatedGuard() {
  // Bổ sung: nuốt luôn các lỗi Chrome-internal thoáng qua khi reload extension / SW ngủ dậy:
  //   "No SW" (service worker chưa sẵn sàng), "An unknown error occurred when fetching the script",
  //   "message port/channel closed", "Could not establish connection", "Receiving end does not exist".
  var RE = /context (was )?invalidated|Extension context|Cannot read propert.*of undefined \(reading '(local|sendMessage|id|onMessage|getURL|connect|session)'\)|\bNo SW\b|no service worker|fetching the script|message (port|channel) (is )?closed|could not establish connection|receiving end does not exist|back\/forward cache/i;
  // Context đã chết (extension reload) → chrome.runtime.id undefined. Mọi lỗi lúc này đều vô hại.
  function _ctxDead() { try { return !(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id); } catch (_) { return true; } }
  try {
    window.addEventListener('error', function (e) {
      var m = (e && (e.message || (e.error && e.error.message))) || '';
      if (RE.test(String(m)) || _ctxDead()) { e.preventDefault(); if (e.stopImmediatePropagation) e.stopImmediatePropagation(); return false; }
    }, true);
    window.addEventListener('unhandledrejection', function (e) {
      var r = e && e.reason;
      var m = (r && (r.message || r)) || '';
      if (RE.test(String(m)) || _ctxDead()) { e.preventDefault(); }
    });
  } catch (_) { globalThis.SEOSONA_swallow?.('content#_ctxDead', _); }
})();
// Hạ mức các console.warn/info BÌNH THƯỜNG (operational: skip/fallback/cache-miss/not-ready/reload-noise)
// xuống console.debug → KHÔNG hiện ở trang Lỗi chrome://extensions (panel bắt warn/info, bỏ qua debug).
// GIỮ NGUYÊN console.error + exception uncaught (lỗi thật vẫn phải nổi để còn sửa).
(function _installBenignLogFilter() {
  try {
    var BENIGN = /skipping|without tile|no valid tile|cache miss|fallback|Tier3|chưa sẵn sàng|not ready|đang inject lại|coming soon|cold start|no flow tab|không tìm thấy tab|đang thử lại|bỏ qua|context invalidated|Extension context|\bNo SW\b|fetching the script|Bridge return success=false|\bRetryHelper\b|message channel closed|listener indicated an async|receiving end does not exist|CONFIG_REQUIRED|data_missing|safeGetModelsSync/i;
    // Gộp tất cả args — keyword benign thường ở arg thứ 2+, không chỉ arg[0].
    var _join = function (a) { var s = ''; for (var k = 0; k < a.length && k < 4; k++) { var v = a[k]; try { s += ' ' + String(v && v.message ? v.message : v); } catch (_) { s += ' [obj]'; } } return s; };
    ['warn', 'info'].forEach(function (level) {
      var orig = console[level] ? console[level].bind(console) : null;
      if (!orig) return;
      console[level] = function () {
        try {
          if (BENIGN.test(_join(arguments))) { (console.debug || orig).apply(console, arguments); return; }
        } catch (_) { globalThis.SEOSONA_swallow?.('content#_join', _); }
        return orig.apply(console, arguments);
      };
    });
  } catch (_) { globalThis.SEOSONA_swallow?.('content#_join', _); }
})();
// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CONTENT SCRIPT CODE STARTS HERE (inside else block, closed at end of file)
// ═══════════════════════════════════════════════════════════════════════════════

// Guard: var allows safe re-declaration when extension reloads and re-injects content.js
var isRunning = false;
var shouldStop = false;
var isPaused = false;
var failedPrompts = [];

// ─── DOM Tile Cache ───
// Cache DOM queries để giảm load trong polling loops (TTL 250ms)
var _tileCache = null;
var _tileCacheTime = 0;
var _TILE_CACHE_TTL = 250; // ms

// ─── Multi-language Flow UI text matching — Strict Server-Only ───
// Đọc từ backend provider_configs.dom_selector
//   - project_name_input.aria_labels       (line 2921 extractProjectName + line 7101 list project)
//   - add_to_prompt_menu_item.text_match   (line 4911 context menu chèn ref image)
//   - show_tile_details_setting.text_match (line 6040 auto-bật tile metadata)
//   - toggle_state_button.aria_labels_on/off (line 6044 state check)
// Helper đọc config qua `_getDynamicSelector`. Cache miss → empty + Tier3 warn → caller graceful skip.
function _getFlowLocaleStrings(key, field) {
  var config = _getDynamicSelector(key);
  var arr = config?.[field];
  if (!Array.isArray(arr) || arr.length === 0) {
    console.debug('[Tier3] _getFlowLocaleStrings: ' + key + '.' + field + ' cache miss/empty');
    return [];
  }
  return arr;
}

/**
 * Query inputs by multi-language aria-label fallback
 * @param {string[]} labels - Array of aria-label values to try
 * @returns {NodeList|Element[]} - Matching input elements
 */
function _queryInputsByAriaLabels(labels) {
  for (const label of labels) {
    const inputs = document.querySelectorAll(`input[aria-label="${label}"]`);
    if (inputs.length > 0) return inputs;
  }
  return [];
}

/**
 * Check if aria-label matches any value in array
 * @param {string} label - aria-label value from element
 * @param {string[]} expected - Array of expected values
 * @returns {boolean}
 */
function _ariaLabelMatches(label, expected) {
  return expected.includes(label);
}

/**
 * Check if text content includes any string in array (case-insensitive)
 * @param {string} text - Text content to check
 * @param {string[]} patterns - Array of patterns to match
 * @returns {boolean}
 */
function _textIncludesAny(text, patterns) {
  const textLower = text.toLowerCase();
  return patterns.some(p => textLower.includes(p.toLowerCase()));
}

/**
 * Get tile container selector from dynamic config
 * @returns {{selector: string, attribute: string}} - Selector and attribute to use
 */
function _getTileSelector() {
  var config = _getDynamicSelector('tile_container');
  var selectors = config?.selectors?.length ? config.selectors : [];
  var attribute = config?.attribute || null;

  if (!selectors.length || !attribute) {
    console.debug('[Tier3] _getTileSelector: tile_container config miss');
    return { selector: null, attribute: null };
  }

  for (var i = 0; i < selectors.length; i++) {
    try {
      var els = document.querySelectorAll(selectors[i]);
      if (els.length > 0) {
        return { selector: selectors[i], attribute: attribute };
      }
    } catch (e) { /* invalid selector */ }
  }
  return { selector: selectors[0], attribute: attribute };
}

// Cache tile selector config (refresh every 30s with selector cache)
var _tileSelectorCache = null;

function _getTileSelectorString() {
  var now = Date.now();
  if (!_tileSelectorCache || (now - _selectorConfigTime) > _SELECTOR_CACHE_TTL) {
    _tileSelectorCache = _getTileSelector();
    // DEBUG: Log khi selector được refresh
    console.log('[SEOSONA Flow] _getTileSelectorString: refreshed cache, selector="' + (_tileSelectorCache?.selector || 'NULL') + '"');
  }
  return _tileSelectorCache?.selector || null;
}

if (typeof window !== 'undefined') {
  window._getTileSelectorString = _getTileSelectorString;
}

function _getSlateEditorSelectorString() {
  var config = _getDynamicSelector('slate_editor');
  if (config?.selectors?.length) return config.selectors[0];
  console.debug('[Tier3] _getSlateEditorSelectorString miss');
  return null;
}

if (typeof window !== 'undefined') {
  window._getSlateEditorSelectorString = _getSlateEditorSelectorString;
}

function _getMediaUrlPattern() {
  try {
    var cfg = _apiConfigsCacheLocal?.data?.flow?.configs?.image_url_pattern;
    if (cfg?.url_substring) return cfg.url_substring;
  } catch (_) { globalThis.SEOSONA_swallow?.('content#_getMediaUrlPattern', _); }
  // Trigger async refresh nếu cache empty (background có thể chưa preload xong)
  if (!_apiConfigsCacheLocal && typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    chrome.storage?.local?.get(['seosona_provider_api_configs'], function(res) {
      if (chrome.runtime?.lastError) return;
      if (res && res.seosona_provider_api_configs?.data) {
        _apiConfigsCacheLocal = res.seosona_provider_api_configs;
        _apiConfigsCacheLocalTime = Date.now();
      }
    });
  }
  console.debug('[Tier3] _getMediaUrlPattern miss');
  return null;
}

/**
 * Async version: wait for api_configs to load before returning pattern.
 * Use this in critical paths like waitForNewTiles where null would cause stuck loop.
 * @param {number} [timeoutMs=5000] - Max wait time
 * @returns {Promise<string|null>}
 */
async function _getMediaUrlPatternAsync(timeoutMs = 5000) {
  var pattern = _getMediaUrlPattern();
  if (pattern) return pattern;
  // Wait for cache to load
  var startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    await sleep(200);
    // Re-read from storage
    var res = await new Promise(resolve => chrome.storage.local.get(['seosona_provider_api_configs'], resolve));
    if (res.seosona_provider_api_configs?.data?.flow?.configs?.image_url_pattern?.url_substring) {
      _apiConfigsCacheLocal = res.seosona_provider_api_configs;
      _apiConfigsCacheLocalTime = Date.now();
      return res.seosona_provider_api_configs.data.flow.configs.image_url_pattern.url_substring;
    }
    // Trigger background fetch
    try {
      chrome.runtime.sendMessage({ action: 'getProviderApiConfigs', provider: 'flow' }, function() {
        if (chrome.runtime.lastError) { /* SW suspended */ }
      });
    } catch (_) { globalThis.SEOSONA_swallow?.('content#_getMediaUrlPatternAsync', _); }
  }
  console.warn('[Tier3] _getMediaUrlPatternAsync timeout after ' + timeoutMs + 'ms');
  return null;
}

if (typeof window !== 'undefined') {
  window._getMediaUrlPattern = _getMediaUrlPattern;
}

/**
 * Get cached tile elements - tránh query DOM nhiều lần trong 1 polling cycle
 * Cache tự invalidate sau 250ms (1 polling cycle thường ~2000ms)
 * @returns {NodeList} - Tất cả elements có data-tile-id
 */
function _getCachedTiles() {
  var now = Date.now();
  if (_tileCache && (now - _tileCacheTime) < _TILE_CACHE_TTL) {
    return _tileCache;
  }

  // Get dynamic selector (cached internally)
  if (!_tileSelectorCache || (now - _selectorConfigTime) > _SELECTOR_CACHE_TTL) {
    _tileSelectorCache = _getTileSelector();
  }

  _tileCache = _tileSelectorCache.selector
    ? document.querySelectorAll(_tileSelectorCache.selector)
    : [];
  _tileCacheTime = now;
  return _tileCache;
}

/**
 * Invalidate tile cache - gọi sau mỗi polling cycle hoặc khi biết DOM đã thay đổi
 */
function _invalidateTileCache() {
  _tileCache = null;
  _tileCacheTime = 0;
  _tileSelectorCache = null; // Also refresh selector on next query
  // Xóa cache file_name khi tile cache refresh — đảm bảo dữ liệu luôn đồng bộ với DOM
  _fileNameCache.clear();
}

/**
 * Get tile element by ID using dynamic attribute
 * @param {string} tileId - Tile ID value
 * @returns {Element|null}
 */
function _getTileById(tileId) {
  var config = _getDynamicSelector('tile_container');
  var attribute = config?.attribute || 'data-tile-id';
  return document.querySelector(`[${attribute}="${tileId}"]`);
}

// ─── Cache extractFileName per tile ───
// Tránh query DOM 3 lần mỗi tile mỗi polling cycle. Invalidate cùng lúc với tile cache.
var _fileNameCache = new Map();

// ─── Cache detectTileStatus per tile (TTL 1.5s) ───
// Giảm 4+ DOM queries/tile/call xuống 0 khi cache còn hiệu lực
var _statusCache = new Map();

// ─── Dynamic DOM Selectors (from backend via ProviderConfigManager) ───
// Cache selectors từ chrome.storage.local, refresh từ background khi SSE push
var _selectorConfig = null;
var _selectorConfigTime = 0;
var _seosonaVerboseFlowDebug = false; // 2026-06-02: debug flag cho FlowReady helpers — bật qua CustomEvent
var _SELECTOR_CACHE_TTL = 30000; // 30s - shorter than storage cache
// Cold start race tracking: throttle warn per-key để dev biết khi
// selector được query trước khi cache load (typically <1-2s đầu sau inject).
var _coldStartWarnedKeys = new Set();

// Flow radix trigger button selector template (from api_config.radix_trigger_button_pattern).
// Pattern dạng 'button[id$="-trigger-{suffix}"]' với {suffix} replaced at runtime cho
// mode/ratio/quantity/video_mode buttons. Cache module-level, refresh qua storage.onChanged.
var _radixTriggerPattern = null;
function _loadRadixTriggerPattern() {
  try {
    chrome.storage.local.get(['seosona_provider_api_configs'], function(res) {
      var cfg = res?.seosona_provider_api_configs?.data?.flow?.configs?.radix_trigger_button_pattern;
      if (typeof cfg === 'string' && cfg.includes('{suffix}')) {
        _radixTriggerPattern = cfg;
      }
    });
  } catch (_) { /* ignore */ }
}
_loadRadixTriggerPattern();
try {
  chrome.storage.onChanged.addListener(function(changes, area) {
    if (area === 'local' && changes.seosona_provider_api_configs) {
      var next = changes.seosona_provider_api_configs.newValue;
      var cfg = next?.data?.flow?.configs?.radix_trigger_button_pattern;
      if (typeof cfg === 'string' && cfg.includes('{suffix}')) {
        _radixTriggerPattern = cfg;
      }
    }
  });
} catch (_) { /* ignore */ }

/**
 * Build CSS selector cho radix trigger button bằng pattern từ backend.
 * Strict Server-Only: pattern lấy từ api_config.radix_trigger_button_pattern.
 * Last-resort fallback inline pattern khi cache miss (cold start) — KHÔNG vi phạm Server-Only
 * vì pattern này là radix-internal naming convention, chỉ đổi khi Flow refactor toàn bộ radix lib.
 */
function _buildRadixTriggerSelector(suffix) {
  if (_radixTriggerPattern) {
    return _radixTriggerPattern.replace('{suffix}', String(suffix));
  }
  console.debug('[Tier3] radix_trigger_button_pattern config miss — using last-resort inline pattern');
  return 'button[id$="-trigger-' + String(suffix) + '"]';
}

// Strict Server-Only: — NO hardcoded fallback.
// Bootstrap wait/retry/overlay pattern:
//   1. Storage có data → use ngay
//   2. Storage empty → trigger background fetch + poll storage 200ms × 50 (max 10s)
//   3. Timeout → show overlay "Không có kết nối" → block extension functionality
var _selectorConfigReady = false;
var _SELECTOR_WAIT_MAX_MS = 10000;
var _SELECTOR_WAIT_INTERVAL_MS = 200;

// Overlay i18n (4 locales — reuse sidebar wording `dialog.offline` family).
var _OVERLAY_I18N = {
  vi: { title: 'Mất kết nối server', desc: 'Không thể kết nối tới máy chủ SEOSONA. Vui lòng kiểm tra lại sau.', retry: 'Thử lại' },
  en: { title: 'Server Connection Lost', desc: 'Unable to connect to SEOSONA server. Please try again later.', retry: 'Retry' },


};
var _overlayLocale = 'vi';
chrome.storage.local.get(['af_locale', 'af_settings'], function(r) {
  _overlayLocale = r.af_locale || (r.af_settings && r.af_settings.language) || 'vi';
});

// === Nút "Open SEOSONA Flow" trong Flow header nav → mở extension sidebar ===
// Anchor = thẻ <nav> (semantic tag, stable — KHÔNG dùng styled-component class scrambled của Flow).
// HARDCODE tiếng Anh (KHÔNG đọc locale) — tránh loop flip vi/en khi reload extension. Label cố định.
var _SF_OPEN_LABEL = 'Open SEOSONA Flow';
var _SF_HINT_LABEL = 'Click here to open SEOSONA Flow';
var _tfHintSeen = true; // mặc định true → KHÔNG hiện hint cho tới khi storage xác nhận chưa xem
chrome.storage.local.get(['sf_open_hint_seen'], function(r) {
  _tfHintSeen = r.sf_open_hint_seen === true;
  // Nút có thể đã inject trước khi storage resolve (default _tfHintSeen=true) → gắn hint lại nếu chưa xem.
  if (!_tfHintSeen) {
    var _b = document.getElementById('seosonaflow-open-sidebar-btn');
    if (_b) _tfAttachHint(_b);
  }
});

// Inject CSS pulse + tooltip 1 lần (keyframes không dùng được qua inline style).
function _tfInjectHintStyle() {
  if (document.getElementById('sf-open-hint-style')) return;
  var st = document.createElement('style');
  st.id = 'sf-open-hint-style';
  st.textContent =
    '@keyframes sf-pulse{0%,100%{box-shadow:0 0 0 0 rgba(61, 111, 245,.6)}50%{box-shadow:0 0 0 9px rgba(61, 111, 245,0)}}' +
    '#seosonaflow-open-sidebar-btn.sf-pulse-on{animation:sf-pulse 1.6s ease-out infinite}' +
    '.sf-open-hint{position:absolute;top:calc(100% + 10px);right:0;background:#1a1a1a;color:#fff;padding:7px 12px;border-radius:8px;font-size:12px;font-weight:600;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.35);z-index:2147483647;animation:sf-hint-bounce 1.4s ease-in-out infinite}' +
    '.sf-open-hint::before{content:"";position:absolute;bottom:100%;right:20px;border:6px solid transparent;border-bottom-color:#1a1a1a}' +
    '@keyframes sf-hint-bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}';
  (document.head || document.documentElement).appendChild(st);
}

// Gắn hint pulse + tooltip vào nút (chỉ first-run). Cleanup khi user bấm.
function _tfAttachHint(btn) {
  if (_tfHintSeen) return;
  _tfInjectHintStyle();
  btn.style.position = 'relative';
  btn.classList.add('sf-pulse-on');
  if (!btn.querySelector('.sf-open-hint')) {
    var tip = document.createElement('span');
    tip.className = 'sf-open-hint';
    tip.textContent = _SF_HINT_LABEL;
    btn.appendChild(tip);
  }
}
function _tfDismissHint(btn) {
  _tfHintSeen = true;
  try { chrome.storage.local.set({ sf_open_hint_seen: true }); } catch (_) { globalThis.SEOSONA_swallow?.('content#_tfDismissHint', _); }
  if (btn) {
    btn.classList.remove('sf-pulse-on');
    var tip = btn.querySelector('.sf-open-hint'); if (tip) tip.remove();
  }
}

function _tfBuildOpenButton(label) {
  var logoUrl = ''; try { logoUrl = chrome.runtime.getURL('icons/icon-48.png'); } catch (_) { globalThis.SEOSONA_swallow?.('content#_tfBuildOpenButton', _); }
  var btn = document.createElement('button');
  btn.id = 'seosonaflow-open-sidebar-btn';
  btn.type = 'button';
  btn.title = label;
  // Vị trí cũ: inline trong header <nav> của Flow (bên phải).
  btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:8px;padding:7px 14px;border:none;border-radius:30px;cursor:pointer;font-size:13px;font-weight:600;line-height:1;white-space:nowrap;flex-shrink:0;background:linear-gradient(90deg, rgb(61, 111, 245) 0%, rgb(107 147 248) 100%);color:#ffffff;';
  btn.innerHTML = (logoUrl ? '<img src="' + logoUrl + '" alt="" style="width:18px;height:18px;border-radius:5px;display:block">' : '') + '<span class="sf-open-label">' + label + '</span>';
  btn.addEventListener('click', function(e) {
    e.preventDefault(); e.stopPropagation();
    _tfDismissHint(btn); // bấm lần đầu → tắt hint vĩnh viễn
    try { chrome.runtime.sendMessage({ action: 'flow:openSidebar' }, function() { void chrome.runtime.lastError; }); } catch (_) { globalThis.SEOSONA_swallow?.('content#_tfBuildOpenButton', _); }
  });
  _tfAttachHint(btn);
  return btn;
}

// Brand "Google Flow" (homepage, không có <nav>) → anchor chèn ngay sau brand.
function _tfFindBrandLink() {
  var links = document.querySelectorAll('a[href$="/tools/flow"]');
  for (var i = 0; i < links.length; i++) {
    if ((links[i].textContent || '').trim() === 'Google Flow') return links[i];
  }
  return null;
}

// React của Flow re-render nav có thể GỠ button ngoại lai → MutationObserver gắn lại NGAY (hết flicker
// + giữ logo), thay vì chờ interval 2s. Observe đúng anchor parent (nhẹ). Nav bị thay hẳn → interval re-inject.
var _tfNavObserver = null;
function _tfWatchAnchor(anchorParent, btn) {
  if (_tfNavObserver) { try { _tfNavObserver.disconnect(); } catch (_) { globalThis.SEOSONA_swallow?.('content#_tfWatchAnchor', _); } _tfNavObserver = null; }
  if (!anchorParent || typeof MutationObserver === 'undefined') return;
  _tfNavObserver = new MutationObserver(function() {
    // Dead context → self-disconnect (tránh fight context mới sau reload).
    if (!_tfContextValid()) { try { _tfNavObserver.disconnect(); } catch (_) { globalThis.SEOSONA_swallow?.('content#_tfWatchAnchor', _); } _tfNavObserver = null; return; }
    if (document.body.contains(anchorParent) && !anchorParent.contains(btn)) {
      try { anchorParent.appendChild(btn); } catch (_) { globalThis.SEOSONA_swallow?.('content#_tfWatchAnchor', _); }
    }
  });
  _tfNavObserver.observe(anchorParent, { childList: true });
}

// Context còn hợp lệ? Sau khi reload extension, context CŨ bị invalidate → chrome.runtime.getURL /
// storage throw → button rebuild mất logo + interval/observer cũ chạy fight context mới → loop.
function _tfContextValid() { try { return !!(chrome.runtime && chrome.runtime.id); } catch (_) { return false; } }

function _injectSeosonaFlowOpenButton() {
  // Dead context (reload) → dừng hẳn: clear interval + observer, KHÔNG đụng DOM/getURL nữa.
  if (!_tfContextValid()) {
    try { clearInterval(_tfInjectInterval); } catch (_) { globalThis.SEOSONA_swallow?.('content#_injectSeosonaFlowOpenButton', _); }
    if (_tfNavObserver) { try { _tfNavObserver.disconnect(); } catch (_) { globalThis.SEOSONA_swallow?.('content#_injectSeosonaFlowOpenButton', _); } _tfNavObserver = null; }
    return;
  }
  // Label HARDCODE tiếng Anh — KHÔNG đọc locale, KHÔNG sync đổi ngôn ngữ → triệt tiêu loop flip vi/en.
  var label = _SF_OPEN_LABEL;
  var existing = document.getElementById('seosonaflow-open-sidebar-btn');
  if (existing) return; // đã có → giữ nguyên (label cố định, không rebuild → giữ logo)
  // Editor: header <nav> → append (vị trí cũ). Homepage (không nav): chèn sau brand "Google Flow".
  var nav = document.querySelector('nav');
  if (nav) { var b = _tfBuildOpenButton(label); nav.appendChild(b); _tfWatchAnchor(nav, b); return; }
  var brand = _tfFindBrandLink();
  if (brand && brand.parentElement) { var b2 = _tfBuildOpenButton(label); brand.insertAdjacentElement('afterend', b2); _tfWatchAnchor(brand.parentElement, b2); }
}

// Re-inject qua SPA navigation (nav bị thay). Interval nhẹ (early-return nếu đã có).
// KHÔNG còn storage.onChanged listener cho locale — label cố định tiếng Anh nên không cần react đổi ngôn ngữ.
var _tfInjectInterval = setInterval(_injectSeosonaFlowOpenButton, 2000);

// Refactored từ IIFE → named function để retry button gọi lại sau khi user click "Thử lại"
// (tránh reload page gây infinite loop khi server còn down).
function _runSelectorWaitLoop() {
  var startTime = Date.now();
  var attempts = 0;
  var lastLogElapsed = 0;
  console.log('[Selector:flow:ensure] ⏳ Waiting for server config in chrome.storage.local (timeout ' + _SELECTOR_WAIT_MAX_MS + 'ms)...');

  function checkStorage() {
    attempts++;
    chrome.storage.local.get(['seosona_provider_configs'], function(res) {
      if (res.seosona_provider_configs?.data?.flow) {
        _selectorConfig = res.seosona_provider_configs.data;
        _selectorConfigTime = Date.now();
        _selectorConfigReady = true;
        var keyCount = Object.keys(_selectorConfig.flow?.selectors || {}).length;
        console.log('[Selector:flow:ensure] ✅ Loaded ' + keyCount + ' Flow selectors after ' +
          attempts + ' attempts (' + (Date.now() - startTime) + 'ms)');
        // Ẩn overlay nếu đang hiển thị (khi retry success)
        var existingOverlay = document.getElementById('seosonaflow-config-error-overlay');
        if (existingOverlay) existingOverlay.remove();

        // 2026-05-30: Auto-trigger Agent mode check ngay khi config ready (KHÔNG đợi sidebar).
        // 2026-06-02: Sequence 3 bước (thứ tự bắt buộc):
        //   1. Click "Xong" → đóng dialog "Hướng dẫn cho tác nhân"
        //   2. Close Chat → đóng chat agent panel
        //   3. Agent OFF → toggle button "Tác nhân" về OFF
        //
        // RETRY: Next.js hydrate chậm (2-5s) → DOM chat panel render SAU 1s initial delay.
        // Retry 6 lần × 1.5s = cover 9s total. Exit sớm nếu đã handle ít nhất 1 step (saved time).
        async function _runFlowReadyCheckChain() {
          window._seosonaAgentChainLastRunAt = Date.now();
          // Order: Xong → Close Chat → Agent OFF (RESTORED).
          // Lý do: khi chat panel mở, Agent toggle button (button[aria-pressed]) KHÔNG hiển thị
          // trên DOM (panel header UI replace composer). Cần đóng panel TRƯỚC để toggle button
          // xuất hiện trên DOM, sau đó mới click Agent OFF.
          // Wait 1.5s sau Close Panel để DOM stable (panel animation + toggle render) — tránh
          // click Agent quá sớm gây Flow re-render panel.
          let r1 = null, r2 = null, r3 = null;
          try {
            if (typeof _ensureFlowAgentInstructionDone === 'function') {
              r1 = await _ensureFlowAgentInstructionDone();
              if (r1.wasOpen && r1.success) console.log('[FlowAgentInstruction:chain] ✓ Done clicked');
              else if (r1.found) console.log('[FlowAgentInstruction:chain] ✓ Dialog already closed');
            }
            if (typeof _ensureFlowChatAgentClosed === 'function') {
              r2 = await _ensureFlowChatAgentClosed();
              if (r2.wasOpen && r2.success) console.log('[FlowChatAgent:chain] ✓ Panel closed');
              else if (r2.found) console.log('[FlowChatAgent:chain] ✓ Panel already closed');
            }
            // Sau Close Panel — wait 1.5s cho Flow stable: panel collapse animation hoàn tất +
            // Agent toggle button render lại trên composer area
            if (r2?.wasOpen && r2?.success) {
              await sleep(1500);
            }
            if (typeof _ensureFlowAgentModeOff === 'function') {
              r3 = await _ensureFlowAgentModeOff();
              if (r3.wasOn && r3.success) console.log('[FlowAgent:chain] ✓ Agent disabled');
              else if (r3.found) console.log('[FlowAgent:chain] ✓ Agent already OFF');
            }
          } catch (e) {
            // Bỏ qua lỗi context-invalidated (extension vừa reload) — vô hại, tránh spam.
            var _ctxDead = false;
            try { _ctxDead = !(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id); } catch (_) { _ctxDead = true; }
            if (!_ctxDead && !/context (was )?invalidated|Extension context|Cannot read propert.*of undefined \(reading '(local|sendMessage|id)'\)/i.test(String(e && e.message))) {
              console.warn('[FlowReadyChain] step exception:', e.message);
            }
          }
          return {
            anyFound: !!(r1?.found || r2?.found || r3?.found),
            anyActioned: !!((r1?.wasOpen && r1?.success) || (r2?.wasOpen && r2?.success) || (r3?.wasOn && r3?.success)),
            r1, r2, r3,
          };
        }

        // 2026-06-02: Expose manual trigger qua CustomEvent — user có thể test trong DevTools
        // bằng cách dispatch event để force run chain + log chi tiết kết quả mỗi helper.
        // NOTE: window._seosonaDebugFlowReady từ page main world KHÔNG reach content script isolated
        // → dùng module-level variable _seosonaVerboseFlowDebug set trong event handler.
        document.addEventListener('seosona-debug-flow-ready', async () => {
          console.log('[FlowReadyChain:manual] === Triggered manually (verbose ON) ===');
          // Dump helper source TRƯỚC để verify code version đã load
          if (typeof _findFlowChatAgentCloseButton === 'function') {
            const src = _findFlowChatAgentCloseButton.toString();
            const hasStats = src.includes('stats.iconCloseMatched');
            const hasVerbose = src.includes('_seosonaVerboseFlowDebug');
            console.log(`[FlowReadyChain:manual] CodeVersion check: hasStats=${hasStats} hasVerbose=${hasVerbose}`);
            if (!hasStats || !hasVerbose) {
              console.warn('[FlowReadyChain:manual] ⚠ OLD CODE VERSION DETECTED — extension/tab needs reload');
            }
          }
          // Dump config xem trên live có gì — DÙNG JSON.stringify để tránh console collapse object
          const cfgChat = typeof _getDynamicSelector === 'function' ? _getDynamicSelector('flow_chat_agent_close_button') : null;
          const cfgInstr = typeof _getDynamicSelector === 'function' ? _getDynamicSelector('flow_agent_instruction_done_button') : null;
          const cfgAgent = typeof _getDynamicSelector === 'function' ? _getDynamicSelector('flow_agent_toggle_button') : null;
          const cfgIcon = typeof _getDynamicSelector === 'function' ? _getDynamicSelector('icon_element') : null;
          console.log('[FlowReadyChain:manual] flow_chat_agent_close_button JSON:', JSON.stringify(cfgChat));
          console.log('[FlowReadyChain:manual] flow_agent_instruction_done_button JSON:', JSON.stringify(cfgInstr));
          console.log('[FlowReadyChain:manual] flow_agent_toggle_button JSON:', JSON.stringify(cfgAgent));
          console.log('[FlowReadyChain:manual] icon_element JSON:', JSON.stringify(cfgIcon));

          _seosonaVerboseFlowDebug = true;
          try {
            // Detail check 3 helpers — verbose log từ helpers
            const dialogBtn = typeof _findFlowAgentInstructionDoneButton === 'function' ? _findFlowAgentInstructionDoneButton() : null;
            const chatBtn = typeof _findFlowChatAgentCloseButton === 'function' ? _findFlowChatAgentCloseButton() : null;
            const agentBtn = typeof _findFlowAgentButton === 'function' ? _findFlowAgentButton() : null;
            console.log('[FlowReadyChain:manual] Instruction Done button:', dialogBtn);
            console.log('[FlowReadyChain:manual] Chat Close button:', chatBtn);
            console.log('[FlowReadyChain:manual] Agent toggle button:', agentBtn);
            const r = await _runFlowReadyCheckChain();
            console.log('[FlowReadyChain:manual] Chain result:', r);
          } finally {
            _seosonaVerboseFlowDebug = false;
          }
        });

        (async function _bootstrapWithRetry() {
          const MAX_ATTEMPTS = 6;
          const RETRY_DELAY = 1500;
          await new Promise(res => setTimeout(res, 1000)); // initial delay cho DOM start render
          let actionedInBootstrap = false;
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            const result = await _runFlowReadyCheckChain();
            if (result.anyActioned) {
              console.log(`[FlowReadyChain:bootstrap] ✓ Actioned at attempt ${attempt}/${MAX_ATTEMPTS}`);
              actionedInBootstrap = true;
              // 2026-06-02: Persistent flag — ensureFlowSettingsApplied skip 3-step trong session
              // sau khi bootstrap đã action (tránh sidebar trigger lại 3-step → flicker).
              window._seosonaBootstrapAgentActioned = true;
              // Verify again after 1s — Flow có thể re-render dialog/panel
              await new Promise(res => setTimeout(res, 1000));
              await _runFlowReadyCheckChain();
              break;
            }
            if (attempt < MAX_ATTEMPTS) {
              await new Promise(res => setTimeout(res, RETRY_DELAY));
            }
          }
          if (!actionedInBootstrap) {
            console.log(`[FlowReadyChain:bootstrap] No panel/dialog/agent detected after ${MAX_ATTEMPTS} attempts — starting lifetime DOM monitor`);
          }

          // 2026-06-02: ONE-SHOT periodic poll sau bootstrap — Flow lazy-load panel (~10s+ sau load).
          // Bootstrap retry chỉ cover 10s đầu → panel xuất hiện sau exit. User mong popup tự đóng
          // ngay khi page load (initial state), KHÔNG cản nếu user CHỦ ĐỘNG mở agent sau đó.
          //
          // Approach: poll mỗi 1.5s trong 60s window. Khi panel xuất hiện LẦN ĐẦU → đóng → stop.
          // 60s timeout cũng stop. → User mở panel sau 60s KHÔNG bị can thiệp.
          //
          // Đổi từ MutationObserver sang setInterval vì observer throttle có thể miss "DOM idle
          // moment" khi button close render delay (panel container → 1s sau button render).
          if (!actionedInBootstrap && !window._seosonaOneShotPollInstalled) {
            window._seosonaOneShotPollInstalled = true;
            const POLL_INTERVAL_MS = 1500;
            const MAX_POLL_DURATION_MS = 60000;
            const MAX_POLLS = Math.ceil(MAX_POLL_DURATION_MS / POLL_INTERVAL_MS);
            let pollCount = 0;
            let pollRunning = false;
            let pollerRef = null;

            const cleanup = (reason) => {
              if (pollerRef) {
                clearInterval(pollerRef);
                pollerRef = null;
              }
              console.log(`[FlowReadyChain:oneShot] uninstalled (${reason}, polls=${pollCount}/${MAX_POLLS})`);
            };

            pollerRef = setInterval(async () => {
              pollCount++;
              if (pollCount > MAX_POLLS) {
                cleanup('timeout 60s');
                return;
              }
              if (pollRunning) return;
              pollRunning = true;
              try {
                const r = await _runFlowReadyCheckChain();
                if (r.anyActioned) {
                  cleanup('actioned');
                }
              } catch (e) {
                console.warn('[FlowReadyChain:oneShot] error:', e.message);
              } finally {
                pollRunning = false;
              }
            }, POLL_INTERVAL_MS);
            console.log(`[FlowReadyChain:oneShot] ✓ Periodic poll installed (${POLL_INTERVAL_MS}ms × ${MAX_POLLS} = ${MAX_POLL_DURATION_MS / 1000}s window)`);
          }
        })();
        return;
      }

      // Trigger background fetch (idempotent)
      try {
        chrome.runtime.sendMessage({ action: 'getProviderConfigs', provider: 'flow' }, function() {
          if (chrome.runtime.lastError) { /* SW suspended — retry will continue */ }
        });
      } catch (_) { /* SW disconnected */ }

      var elapsed = Date.now() - startTime;
      if (elapsed - lastLogElapsed >= 1000) {
        lastLogElapsed = elapsed;
        console.log('[Selector:flow:ensure] ⏳ Still waiting (' + (elapsed / 1000).toFixed(1) +
          's/' + (_SELECTOR_WAIT_MAX_MS / 1000) + 's, attempt #' + attempts +
          ') — re-triggering background fetch');
      }
      if (elapsed > _SELECTOR_WAIT_MAX_MS) {
        console.error('[Selector:flow:ensure] ❌ Timeout after ' + attempts +
          ' attempts (' + elapsed + 'ms). Server unreachable — showing overlay.');
        _showConfigErrorOverlay();
        return;
      }
      setTimeout(checkStorage, _SELECTOR_WAIT_INTERVAL_MS);
    });
  }

  checkStorage();
}
_runSelectorWaitLoop();

/**
 * Server-Only: Overlay block khi không có config (server unreachable).
 * Match style với sidebar `.seosonaflow-offline-overlay` (SVG Feather icon + red accent + i18n).
 */
// ─── [FLOW_RECAPTCHA_403 Phase 4] Overlay CAPTCHA — human-in-the-loop ────────────────────
// Hiện overlay ngay trong tab Flow khi phát hiện captcha/403. User giải xác minh (nếu có widget)
// hoặc chờ, rồi bấm "Tiếp tục" → gửi runtime message → execution context resume. Non-blocking:
// KHÔNG dùng alert/confirm (chặn message channel). Reuse CSS class seosonaflow-cfg-err-overlay.
function _showCaptchaOverlay(opts) {
  opts = opts || {};
  var existing = document.getElementById('seosonaflow-captcha-overlay');
  if (existing) existing.remove();
  var msg = opts.text || 'Google phát hiện hoạt động bất thường và yêu cầu xác minh.';
  var canResume = opts.canResume !== false; // GenTab resume được; workflow chỉ đóng + chạy lại
  var overlay = document.createElement('div');
  overlay.id = 'seosonaflow-captcha-overlay';
  overlay.className = 'seosonaflow-cfg-err-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(10,10,14,0.95);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;color:#fff;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;';
  overlay.innerHTML =
    '<div style="max-width:440px;text-align:center;padding:32px;">' +
      '<div style="width:72px;height:72px;border-radius:50%;background:rgba(251,191,36,0.15);display:flex;align-items:center;justify-content:center;margin:0 auto 20px;">' +
        '<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
      '</div>' +
      '<div style="font-size:19px;font-weight:600;margin-bottom:10px;">Google yêu cầu xác minh</div>' +
      '<div style="font-size:14px;line-height:1.6;color:rgba(255,255,255,0.75);margin-bottom:8px;">' + _escapeHtmlSafe(msg) + '</div>' +
      '<div style="font-size:13px;line-height:1.6;color:rgba(255,255,255,0.55);margin-bottom:24px;">' +
        (canResume
          ? 'Giải xác minh trên trang Flow (nếu có), hoặc chờ ~1 phút, rồi bấm <b style="color:#3d6ff5;">Tiếp tục</b>.'
          : 'Giải xác minh trên trang Flow, rồi <b style="color:#3d6ff5;">chạy lại workflow</b>.') +
      '</div>' +
      '<div style="display:flex;gap:10px;justify-content:center;">' +
        (canResume
          ? '<button id="sf-captcha-resume" style="height:40px;padding:0 22px;border-radius:999px;border:none;background:#3d6ff5;color:#161616;font-size:14px;font-weight:600;cursor:pointer;">Tiếp tục</button>'
          : '') +
        '<button id="sf-captcha-abort" style="height:40px;padding:0 22px;border-radius:999px;border:1px solid rgba(255,255,255,0.25);background:transparent;color:#fff;font-size:14px;cursor:pointer;">' +
          (canResume ? 'Dừng workflow' : 'Đóng') + '</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(overlay);
  var resumeBtn = overlay.querySelector('#sf-captcha-resume');
  if (resumeBtn) resumeBtn.addEventListener('click', function () {
    overlay.remove();
    try { chrome.runtime.sendMessage({ action: 'captcha:userAction', decision: 'resume' }, function () { void chrome.runtime.lastError; }); } catch (_) { globalThis.SEOSONA_swallow?.('content#_showCaptchaOverlay', _); }
  });
  var abortBtn = overlay.querySelector('#sf-captcha-abort');
  if (abortBtn) abortBtn.addEventListener('click', function () {
    overlay.remove();
    try { chrome.runtime.sendMessage({ action: 'captcha:userAction', decision: 'abort' }, function () { void chrome.runtime.lastError; }); } catch (_) { globalThis.SEOSONA_swallow?.('content#_showCaptchaOverlay', _); }
  });
}
function _hideCaptchaOverlay() {
  var el = document.getElementById('seosonaflow-captcha-overlay');
  if (el) el.remove();
}
function _escapeHtmlSafe(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function _showConfigErrorOverlay() {
  if (document.getElementById('seosonaflow-config-error-overlay')) {
    console.log('[Selector:flow:overlay] ↩ Overlay already mounted — skip');
    return;
  }
  // [FIX 2026-07-09] Debrand xoá block tạo `overlay` nhưng để lại `overlay.querySelector(...)` →
  // hàm THROW ReferenceError ngay khi gọi (lúc config-selector timeout cold-start) → vòng chờ
  // selector chết → Flow submit/tile/download no-op. Local mode config đã bundled sẵn nên overlay
  // "server unreachable" vô nghĩa. No-op (giống bản đã sửa ở chat-content-grok/chatgpt).
  console.warn('[Selector:flow:overlay] Config selector chưa sẵn sàng (local mode) — bỏ qua overlay, poll loop tự retry.');
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-clone overlay (whitelist miss). Show khi background set storage flag
// `seosonaflow_extension_not_authorized`. Khác offline-overlay: red shield icon,
// button "Open Chrome Web Store" (không retry vì retry cũng bị reject).
// ─────────────────────────────────────────────────────────────────────────────
function _showCloneDetectedOverlay() {
  // Local mode: không có backend anti-clone (không nhận 403 DUMMY_FLAG) → không bao giờ được gọi.
  // Giữ no-op để listener storage/message vẫn tham chiếu hợp lệ. (Debrand đã gỡ block dựng overlay.)
  console.warn('[Auth:flow] clone-detected flag set — bỏ qua (local mode, không có backend anti-clone).');
}

function _hideCloneDetectedOverlay() {
  var el = document.getElementById('seosonaflow-clone-detected-overlay');
  if (el) el.remove();
}

// Init: check flag + listen storage change + runtime message
(function _initCloneDetectedListener() {
  try {
    // Delay 800ms — đợi background self-heal probe (immediate on load) chạy trước.
    // Nếu admin vừa tắt toggle → probe clear flag trong <500ms → tránh flicker overlay.
    setTimeout(function() {
      // Guard: sau khi reload extension, content script cũ vẫn còn sống trên tab → chrome.* ném
      // "Extension context invalidated". Check runtime.id + try/catch để không văng uncaught error.
      try {
        if (!chrome.runtime || !chrome.runtime.id) return;
        chrome.storage.local.get('seosonaflow_extension_not_authorized', function(res) {
          if (chrome.runtime.lastError) return;
          if (res && res.seosonaflow_extension_not_authorized) _showCloneDetectedOverlay();
        });
      } catch (_) { /* context invalidated — bỏ qua */ }
    }, 800);
    chrome.storage.onChanged.addListener(function(changes, area) {
      if (area !== 'local') return;
      if (changes.seosonaflow_extension_not_authorized) {
        if (changes.seosonaflow_extension_not_authorized.newValue) _showCloneDetectedOverlay();
        else _hideCloneDetectedOverlay();
      }
    });
    if (chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function(msg) {
        if (msg && msg.type === 'EXTENSION_NOT_AUTHORIZED') _showCloneDetectedOverlay();
        else if (msg && msg.type === 'EXTENSION_AUTHORIZED') _hideCloneDetectedOverlay();
      });
    }
    // Manual retry: click bất cứ đâu trong overlay → trigger background probe.
    document.addEventListener('click', function(e) {
      if (e.target && e.target.closest && e.target.closest('#seosonaflow-clone-detected-overlay')) {
        try { chrome.runtime.sendMessage({ type: 'EXTENSION_AUTH_RETRY' }); } catch (_) { globalThis.SEOSONA_swallow?.('content#setTimeout', _); }
      }
    }, true);
  } catch (_) { globalThis.SEOSONA_swallow?.('content#setTimeout', _); }
})();

/**
 * Get dynamic selector config for a key (flow provider only in content.js)
 * @param {string} key - Selector key (e.g. 'tile_container', 'submit_button')
 * @returns {Object|null} - Selector config {selectors: [], attribute?, text_match?, icon_text?}
 */
function _getDynamicSelector(key) {
  // Vá nóng: override (chrome.storage) THẮNG config gốc → sửa selector có hiệu lực NGAY,
  // không cần sửa code, không cần reload extension. Xoá override là quay lại config gốc.
  try {
    var _ov = (typeof self !== 'undefined' && self.SelectorOverride) || (typeof window !== 'undefined' && window.SelectorOverride);
    var _hit = _ov && _ov.getConfig && _ov.getConfig('flow', key);
    if (_hit) return _hit;
  } catch (_) { globalThis.SEOSONA_swallow?.('content#_getDynamicSelector', _); }

  var now = Date.now();
  if (_selectorConfig && (now - _selectorConfigTime) < _SELECTOR_CACHE_TTL) {
    return _selectorConfig?.flow?.selectors?.[key] || null;
  }
  // Async refresh cache from storage (non-blocking). Guard: sau khi reload extension,
  // content script cũ vẫn sống → chrome.storage undefined ("Cannot read 'local'"). Optional
  // chaining + try/catch để không văng lỗi.
  try {
    chrome.storage?.local?.get(['seosona_provider_configs'], function(res) {
      if (chrome.runtime?.lastError) return;
      if (res && res.seosona_provider_configs?.data?.flow) {
        _selectorConfig = res.seosona_provider_configs.data;
        _selectorConfigTime = Date.now();
      }
    });
  } catch (_) { /* context invalidated — bỏ qua */ }
  // Cold start race: selector được gọi trước khi cache load. Throttle per-key tránh spam.
  if (!_selectorConfig && !_coldStartWarnedKeys.has(key)) {
    _coldStartWarnedKeys.add(key);
    console.debug('[Selector:flow] _getDynamicSelector("' + key + '") called before config ready — returning null (cold start race)');
  }
  return _selectorConfig?.flow?.selectors?.[key] || null;
}

/**
 * Strict Server-Only query element — KHÔNG hardcoded fallback.
 * @param {string} key - Selector key (must exist in backend dom_selectors)
 * @param {string[]} [defaultSelectors] - Optional inline fallback (last-resort if cache empty)
 * @returns {Element|null}
 */
function _selStr(key) {
  var cfg = _getDynamicSelector(key);
  return cfg?.selectors?.length ? cfg.selectors.join(', ') : null;
}

// Ghi nhận kết quả tra selector cho SelectorDoctor → khi Google đổi UI thì biết ĐÚNG key nào gãy
// (sửa 1 dòng config thay vì dò tay). Thuần quan sát, bọc try/catch, không đổi hành vi.
function _selDoc(key, outcome, selStr) {
  try {
    var SD = (typeof self !== 'undefined' && self.SelectorDoctor) || (typeof window !== 'undefined' && window.SelectorDoctor);
    if (!SD) return;
    var v = null;
    try { v = _getDynamicSelector(key)?.config_version ?? null; } catch (_) { globalThis.SEOSONA_swallow?.('content#_selDoc', _); }
    SD.record('flow', key, outcome, { selectors: selStr || null, version: v });
  } catch (_) { globalThis.SEOSONA_swallow?.('content#_selDoc', _); }
}

function _q(key, scope) {
  var s = _selStr(key);
  if (!s) { console.debug(`[Tier3] _q(${key}) miss`); _selDoc(key, 'no_config'); return null; }
  var el = (scope || document).querySelector(s);
  _selDoc(key, el ? 'ok' : 'not_found', s);
  return el;
}

function _qa(key, scope) {
  var s = _selStr(key);
  if (!s) { console.debug(`[Tier3] _qa(${key}) miss`); _selDoc(key, 'no_config'); return []; }
  var els = (scope || document).querySelectorAll(s);
  _selDoc(key, els && els.length ? 'ok' : 'not_found', s);
  return els;
}

function _queryWithFallback(key, defaultSelectors) {
  var config = _getDynamicSelector(key);
  var isDynamic = config?.selectors?.length > 0;
  // Priority: dynamic (server) > inline param (caller-provided last-resort)
  // _FALLBACK_SELECTORS REMOVED — strict server-only
  var selectors = isDynamic ? config.selectors : (defaultSelectors || []);

  // Debug log: show selector source
  console.log(`[Selector:${key}] Source: ${isDynamic ? '🌐 DYNAMIC' : '📦 FALLBACK'} | Trying ${selectors.length} selectors`);

  for (var i = 0; i < selectors.length; i++) {
    try {
      var el = document.querySelector(selectors[i]);
      if (el) {
        console.log(`[Selector:${key}] ✅ Match #${i + 1}: ${selectors[i]}`);
        return el;
      }
    } catch (e) { /* invalid selector */ }
  }
  console.log(`[Selector:${key}] ❌ No match found`);
  return null;
}

/**
 * Strict Server-Only: Tìm icon element trong parent.
 * Đọc selectors từ `provider_configs.dom_selector.icon_element` (Material Symbol class).
 * Trả null nếu config missing → degrade gracefully (caller skip icon-based detection).
 * Thay thế hardcode `parent.querySelector('i.google-symbols')` ở các helper:
 *   getEditor, getSettingsButton, getSubmitButton, readCurrentSettings, removeExistingRefImages
 * @param {Element|null} parent
 * @returns {Element|null} First icon element matched, null nếu missing/empty
 */
function _findIconInElement(parent) {
  if (!parent) return null;
  var config = _getDynamicSelector('icon_element');
  if (!config?.selectors?.length) return null;
  for (var i = 0; i < config.selectors.length; i++) {
    try {
      var icon = parent.querySelector(config.selectors[i]);
      if (icon) return icon;
    } catch (e) { /* invalid selector — try next */ }
  }
  return null;
}

/**
 * Plural version — trả về ALL icon elements matched (Array, đã convert từ NodeList).
 * Tier đầu tiên có match → return ngay (KHÔNG concat across tiers để tránh duplicate).
 * @param {Element|null} parent
 * @returns {Element[]}
 */
function _findIconsInElement(parent) {
  if (!parent) return [];
  var config = _getDynamicSelector('icon_element');
  if (!config?.selectors?.length) return [];
  for (var i = 0; i < config.selectors.length; i++) {
    try {
      var icons = parent.querySelectorAll(config.selectors[i]);
      if (icons.length > 0) return Array.from(icons);
    } catch (e) { /* invalid selector — try next */ }
  }
  return [];
}

// ─── API configs (download_resolutions, ratios, error_patterns) ────────────
// Mirror ProviderConfigManager._apiConfigsCache qua chrome.storage để content.js đọc.
var _apiConfigsCacheLocal = null;
var _apiConfigsCacheLocalTime = 0;
var _API_CONFIGS_CACHE_TTL = 30000; // 30s — invalidate sớm cho SSE responsiveness

// Preload api configs immediately on script load (warm cache)
(function _preloadApiConfigs() {
  chrome.storage.local.get(['seosona_provider_api_configs'], function(res) {
    if (res.seosona_provider_api_configs?.data) {
      _apiConfigsCacheLocal = res.seosona_provider_api_configs;
      _apiConfigsCacheLocalTime = Date.now();
      console.log('[ApiConfigs:preload] ✅ Loaded from storage, providers:',
        Object.keys(res.seosona_provider_api_configs.data || {}).join(', '));
    } else {
      // Storage rỗng ở đây KHÔNG phải lỗi — là ĐUA THỜI ĐIỂM trong chính content script này:
      // ProviderConfigManager nạp ở vị trí #2 (file này #13) và prime storage bằng
      // chrome.storage.get→set BẤT ĐỒNG BỘ, nên lần tải đầu nó chưa kịp đáp xuống trước khi
      // ta đọc. Trước đây chỗ này chỉ console.warn rồi để _getApiConfigValue() trả null —
      // vừa ồn ở panel lỗi, vừa để caller nhận null oan trong khoảng vài ms.
      //
      // PCM đã nằm sẵn TRONG BỘ NHỚ cùng world ⇒ lấy thẳng, đồng bộ, hết đua.
      var _pcmLocal = null;
      try {
        if (typeof ProviderConfigManager !== 'undefined') _pcmLocal = ProviderConfigManager._LOCAL_API_CONFIGS;
      } catch (_) { /* chưa nạp → rơi xuống nhánh cảnh báo thật bên dưới */ }

      if (_pcmLocal) {
        _apiConfigsCacheLocal = { data: _pcmLocal };
        _apiConfigsCacheLocalTime = Date.now();
        console.debug('[ApiConfigs:preload] Dùng bản local trong bộ nhớ (storage chưa kịp prime) — providers:',
          Object.keys(_pcmLocal).join(', '));
      } else {
        // Đây MỚI là bất thường thật: không có storage LẪN không có PCM.
        console.warn('[ApiConfigs:preload] ⚠️ Cache rỗng và không thấy ProviderConfigManager — _getApiConfigValue() sẽ trả null');
      }
    }
  });
})();

/**
 * Get api_config value (download_resolutions, ratios, error_patterns) cho 1 provider.
 * @param {string} provider — 'flow' | 'chatgpt' | 'grok' | 'gemini'
 * @param {string} key — 'download_resolutions' | 'ratios' | 'error_patterns' | ...
 * @returns {Object|null}
 */
function _getApiConfigValue(provider, key) {
  var now = Date.now();
  if (_apiConfigsCacheLocal && (now - _apiConfigsCacheLocalTime) < _API_CONFIGS_CACHE_TTL) {
    return _apiConfigsCacheLocal?.data?.[provider]?.configs?.[key] || null;
  }
  // Async refresh từ chrome.storage (non-blocking). Guard context-invalidated.
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
    chrome.storage?.local?.get(['seosona_provider_api_configs'], function(res) {
      if (chrome.runtime?.lastError) return;
      if (res && res.seosona_provider_api_configs?.data) {
        _apiConfigsCacheLocal = res.seosona_provider_api_configs;
        _apiConfigsCacheLocalTime = Date.now();
      }
    });
  }
  return _apiConfigsCacheLocal?.data?.[provider]?.configs?.[key] || null;
}

/**
 * Detect toast Flow báo VI PHẠM khi upload ảnh (vd "We do not allow uploads of sexual content").
 * Đọc pattern từ provider_configs.api_config.flow.error_patterns.upload_blocked_text (server-only,
 * pipe-separated lowercase). Scan các Sonner toast (<li data-sonner-toast>) match substring.
 * @returns {string|null} text nguyên văn của toast nếu match (để báo lý do), else null
 */
function _detectFlowUploadError() {
  try {
    const cfg = _getApiConfigValue('flow', 'error_patterns');
    const raw = cfg && cfg.upload_blocked_text;
    if (!raw || typeof raw !== 'string') return null;
    const patterns = raw.split('|').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    if (patterns.length === 0) return null;
    const toasts = document.querySelectorAll('[data-sonner-toast]');
    for (const t of toasts) {
      const text = (t.textContent || '').toLowerCase();
      if (!text) continue;
      if (patterns.some(function (p) { return text.indexOf(p) !== -1; })) {
        const titleEl = t.querySelector('[data-title]') || t;
        return (titleEl.textContent || '').trim();
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

// ─── [FLOW_RECAPTCHA_403 Phase 2] Phân loại lỗi Flow (captcha/rate/quota/policy) ───────────
// Store lỗi API gen mới nhất do slate-bridge (MAIN world fetch interceptor) báo qua postMessage.
// Đây là NGUỒN CHÍNH bắt reCAPTCHA 403 âm thầm (extension không tự đọc được response cross-origin).
var _lastFlowGenError = null; // { httpStatus, message, statusText, reason, ts }
(function _installFlowGenErrorListener() {
  try {
    window.addEventListener('message', function (e) {
      if (e.source !== window || e.origin !== location.origin) return;
      var d = e.data;
      if (!d || d.source !== 'flow-gen-error') return;
      _lastFlowGenError = { httpStatus: d.httpStatus, message: d.message || '', statusText: d.statusText || '', reason: d.reason || '', ts: d.ts || Date.now() };
      // 2-kênh: lỗi gen ĐÃ PHÂN LOẠI (policy/captcha/quota/rate) = user-actionable → sẽ có toast ở
      // _getFlowErrorState → hạ console.debug (KHÔNG spam panel "Lỗi" dev). Lỗi CHƯA phân loại được
      // (có thể bug/đổi API) → GIỮ console.warn cho dev thấy mà fix.
      var _fgCat = _classifyFlowGenError(_lastFlowGenError);
      if (_fgCat) {
        console.debug('[FlowGenError]', _lastFlowGenError.httpStatus, _fgCat, _lastFlowGenError.reason);
      } else {
        console.warn('[FlowGenError] chưa phân loại:', _lastFlowGenError.httpStatus, _lastFlowGenError.message, _lastFlowGenError.reason);
      }
    });
  } catch (_) { globalThis.SEOSONA_swallow?.('content#_installFlowGenErrorListener', _); }
})();

// ─── Sổ tra media đã bắt tại nguồn ────────────────────────────────────────────
// slate-bridge (MAIN world) clone bytes media ngay khi trang tải về và báo blob URL sang
// đây. Mục đích DUY NHẤT: khi link ký của Google hết hạn (~1 giờ) thì vẫn còn đường lấy
// đúng file đó. Sổ này chỉ giữ ID → blob URL; bytes nằm ở MAIN world và do MediaCache
// bên đó quản trần + thu hồi.
var _capturedMedia = new Map();   // mediaId -> { blobUrl, size, type, ts }
var _CAPTURED_MAX = 64;           // chỉ là sổ tra, nhẹ; trần thật nằm ở MediaCache
(function _installMediaCaptureListener() {
  try {
    window.addEventListener('message', function (e) {
      if (e.source !== window || e.origin !== location.origin) return;
      var d = e.data;
      if (!d || d.source !== 'flow-media-captured' || !d.mediaId || !d.blobUrl) return;
      _capturedMedia.set(d.mediaId, { blobUrl: d.blobUrl, size: d.size || 0, type: d.type || '', ts: d.ts || Date.now() });
      // MAIN world đã loại bytes thì mục ở đây cũng vô dụng — cắt bớt để sổ không phình.
      while (_capturedMedia.size > _CAPTURED_MAX) {
        _capturedMedia.delete(_capturedMedia.keys().next().value);
      }
    });
  } catch (_) { globalThis.SEOSONA_swallow?.('content#_installMediaCaptureListener', _); }
})();

/**
 * Tra blob đã bắt cho một URL media (dùng khi link ký hết hạn).
 * @returns {string|null} blob URL, hoặc null nếu chưa bắt được.
 */
function _capturedBlobFor(url) {
  try {
    var MC = window.MediaCache;
    var id = MC && MC.idFromUrl ? MC.idFromUrl(url) : null;
    if (!id) return null;
    var hit = _capturedMedia.get(id);
    return hit ? hit.blobUrl : null;
  } catch (_) { globalThis.SEOSONA_swallow?.('content#_capturedBlobFor', _); return null; }
}

/**
 * Phân loại lỗi API gen (từ interceptor) → category. Reason code chắc chắn nhất, fallback message.
 * @param {object} genErr { httpStatus, message, statusText, reason }
 * @returns {'captcha'|'rate_limit'|'quota'|'policy'|null}
 */
function _classifyFlowGenError(genErr) {
  if (!genErr) return null;
  var reason = String(genErr.reason || '').toUpperCase();
  var msg = String(genErr.message || '').toLowerCase();
  // reCAPTCHA / hoạt động bất thường — chắc chắn nhất (reason code + message).
  if (reason.indexOf('UNUSUAL_ACTIVITY') !== -1 || msg.indexOf('recaptcha') !== -1) return 'captcha';
  if (reason.indexOf('RATE_LIMIT') !== -1 || reason.indexOf('RESOURCE_EXHAUSTED') !== -1) return 'rate_limit';
  if (reason.indexOf('QUOTA') !== -1) return 'quota';
  // PUBLIC_ERROR_UNSAFE_GENERATION = nội dung bị Google chặn vì chính sách an toàn → policy (user-actionable).
  if (reason.indexOf('UNSAFE') !== -1) return 'policy';
  // Fallback: match message/reason với pattern server (phủ code khác Flow đổi về sau).
  var cat = _classifyFlowErrorText(genErr.message + ' ' + genErr.reason);
  if (cat) return cat;
  // 403 PERMISSION_DENIED không rõ reason → coi là captcha (an toàn: dừng thay vì retry mù).
  if (genErr.httpStatus === 403) return 'captcha';
  return null;
}

/**
 * Match text (lowercase) với 1 nhóm pattern từ flow.error_patterns[key] (pipe-separated lowercase).
 * @returns {boolean}
 */
function _matchFlowPattern(textLower, key) {
  try {
    const cfg = _getApiConfigValue('flow', 'error_patterns');
    const raw = cfg && cfg[key];
    if (!raw || typeof raw !== 'string') return false;
    const patterns = raw.split('|').map(function (s) { return s.trim().toLowerCase(); }).filter(Boolean);
    return patterns.some(function (p) { return textLower.indexOf(p) !== -1; });
  } catch (e) { return false; }
}

/**
 * Phân loại 1 đoạn text lỗi → category. Thứ tự ưu tiên: captcha > quota > rate_limit > policy.
 * (captcha/quota rẽ nhánh "nặng" hơn rate; policy check cuối vì text rộng dễ trùng.)
 * @param {string} text
 * @returns {'captcha'|'rate_limit'|'quota'|'policy'|null}
 */
function _classifyFlowErrorText(text) {
  if (!text || typeof text !== 'string') return null;
  const t = text.toLowerCase();
  if (_matchFlowPattern(t, 'captcha_text')) return 'captcha';
  if (_matchFlowPattern(t, 'quota_text')) return 'quota';
  if (_matchFlowPattern(t, 'rate_limit_text')) return 'rate_limit';
  if (_matchFlowPattern(t, 'policy_text')) return 'policy';
  return null;
}

/**
 * Surface A — scan toast/banner Flow → phân loại lỗi. Trả {category, text} hoặc null.
 * Reuse cơ chế _detectFlowUploadError (scan [data-sonner-toast]) nhưng phân loại đa nhóm.
 */
function _classifyFlowToast() {
  try {
    const toasts = document.querySelectorAll('[data-sonner-toast]');
    for (const el of toasts) {
      const text = (el.textContent || '').trim();
      if (!text) continue;
      const category = _classifyFlowErrorText(text);
      if (category) {
        const titleEl = el.querySelector('[data-title]') || el;
        return { category, text: (titleEl.textContent || text).trim() };
      }
    }
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * Surface B — trích reason text từ fail tile (policy). Dựa cấu trúc ỔN ĐỊNH (walk từ warning icon),
 * KHÔNG dựa class sc-* (styled-components hash đổi mỗi deploy).
 * Fail tile DOM: <i>warning</i> + <div>tiêu đề</div> + <div>lý do</div> + <button>×3.
 * @param {Element} tileEl
 * @returns {string|null} reason text (đã bỏ text của button/icon) hoặc null
 */
function _extractTileFailReason(tileEl) {
  if (!tileEl) return null;
  try {
    // Tìm warning icon (dùng warning_icon.text_match server-only, fallback 'warning')
    const warningText = _getDynamicSelector('warning_icon')?.text_match || 'warning';
    let warnIcon = null;
    const icons = tileEl.querySelectorAll('i');
    for (const ic of icons) {
      if ((ic.textContent || '').trim() === warningText) { warnIcon = ic; break; }
    }
    if (!warnIcon) return null;
    // Container reason = tổ tiên gần chứa warning icon + text lý do (walk lên 4 cấp tối đa).
    let container = warnIcon.parentElement;
    for (let i = 0; i < 4 && container && container !== tileEl; i++) {
      // Lấy text div KHÔNG nằm trong <button> (nút Thử lại/Xoá) + KHÔNG phải chính icon.
      const clone = container.cloneNode(true);
      clone.querySelectorAll('button, i').forEach(function (n) { n.remove(); });
      const txt = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      if (txt.length >= 12) return txt; // đủ dài = có lý do thật (không phải "Xoá"/"Thử lại")
      container = container.parentElement;
    }
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * Surface C — detect reCAPTCHA v2 challenge iframe đang HIỂN THỊ (leo thang, tin cậy rất cao).
 * @returns {boolean}
 */
function _detectRecaptchaWidget() {
  try {
    const sels = [
      'iframe[src*="google.com/recaptcha"]',
      'iframe[src*="recaptcha/api2/bframe"]',
      'iframe[src*="recaptcha/enterprise"]',
    ];
    for (const sel of sels) {
      const nodes = document.querySelectorAll(sel);
      for (const n of nodes) {
        const rect = n.getBoundingClientRect();
        if (rect.width > 40 && rect.height > 40) {
          const cs = window.getComputedStyle(n);
          if (cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0') return true;
        }
      }
    }
  } catch (e) { /* ignore */ }
  return false;
}

/**
 * Surface tổng hợp — trạng thái lỗi Flow HIỆN TẠI (query từ TileMonitor/PromptQueue).
 * Ưu tiên NGUỒN CHÍNH: lỗi API gen 403 (interceptor, bắt được reCAPTCHA âm thầm) → sau đó DOM
 * (widget/toast) làm PHỤ cho case Flow có render. Tile reason (policy) xử riêng ở caller.
 * @returns {{category:string, text:string}|null}
 */
function _getFlowErrorState() {
  // 1. NGUỒN CHÍNH — lỗi API gen mới nhất (≤90s, tránh lỗi cũ phiên trước). reCAPTCHA 403 âm thầm.
  // CONSUME-ONCE: 1 lỗi 403 = 1 lần submit = 1 item → clear sau khi đọc để KHÔNG trigger nhầm item
  // kế (nếu captcha vẫn còn, submit kế tạo 403 mới → _lastFlowGenError cập nhật lại).
  if (_lastFlowGenError && (Date.now() - _lastFlowGenError.ts) < 90000) {
    const cat = _classifyFlowGenError(_lastFlowGenError);
    if (cat) {
      // policy (UNSAFE_GENERATION): message API là "Request contains an invalid argument" (khó hiểu)
      // → thay bằng câu VN thân thiện, actionable. Các loại khác giữ message gốc (thường đã là câu Flow VN).
      const text = (cat === 'policy')
        ? (window.I18n?.t?.('workflow.contentBlocked') || 'Nội dung bị Google từ chối (vi phạm chính sách an toàn). Đổi prompt/ảnh khác rồi thử lại.')
        : (_lastFlowGenError.message
          || (window.I18n?.t?.('workflow.unusualActivity'))
          || 'Google phát hiện hoạt động bất thường (reCAPTCHA).');
      _lastFlowGenError = null; // consume
      return { category: cat, text, source: 'api' };
    }
  }
  // 2. PHỤ — widget reCAPTCHA v2 (leo thang) nếu Flow có hiện.
  if (_detectRecaptchaWidget()) {
    return { category: 'captcha', text: 'reCAPTCHA verification required', source: 'widget' };
  }
  // 3. PHỤ — toast/banner (một số lỗi Flow có render).
  const toast = _classifyFlowToast();
  if (toast) { toast.source = 'toast'; return toast; }
  return null;
}

/**
 * Upload VIDEO lên Flow qua drag-drop (input[type=file] chỉ accept image/* → video phải drop).
 * Bug fix 2026-05-28: dispatch DragEvent (dragenter/dragover/drop) với DataTransfer chứa file lên
 * drop-zone, rồi click modal confirm "I agree" (Flow Prohibited Use Policy). Drop-zone: thử
 * slate_editor → main → body (Flow drop handler thường ở page-level nên bubbles tới). Text nút
 * confirm đọc từ config `video_upload_confirm.text_match`, degraded fallback English.
 */
async function _dropVideoToFlow(file) {
  const dt = new DataTransfer();
  dt.items.add(file);

  // Drop target: ưu tiên editor/main (drop handler page-level sẽ bắt qua bubbling), fallback body.
  const dropTarget = _q('slate_editor')
    || document.querySelector('main')
    || document.body;

  const fire = (type) => {
    let e;
    try {
      e = new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt });
    } catch (_) {
      e = new Event(type, { bubbles: true, cancelable: true });
    }
    // Một số Chrome bỏ qua dataTransfer trong constructor → ép gán.
    try { if (!e.dataTransfer) Object.defineProperty(e, 'dataTransfer', { value: dt }); } catch (_) { globalThis.SEOSONA_swallow?.('content#fire', _); }
    dropTarget.dispatchEvent(e);
  };
  try {
    fire('dragenter');
    fire('dragover');
    fire('drop');
    console.log(`[uploadFilesToFlow] video drop dispatched on <${(dropTarget.tagName || 'body').toLowerCase()}> file="${file.name}"`);
  } catch (e) {
    console.warn('[uploadFilesToFlow] video drop dispatch error:', e?.message);
  }

  // Confirm modal "I agree" — Flow Prohibited Use Policy. Config text_match + fallback English.
  const cfg = _getDynamicSelector('video_upload_confirm');
  const texts = (Array.isArray(cfg?.text_match) && cfg.text_match.length)
    ? cfg.text_match
    : ['I agree, Do not show again', 'I agree'];
  const lowered = texts.map((t) => t.toLowerCase());
  for (let i = 0; i < 24; i++) {  // ~7.2s chờ modal
    await sleep(300);
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) continue;
    const btns = Array.from(dialog.querySelectorAll('button'));
    let agree = null;
    for (const lt of lowered) {
      agree = btns.find((b) => (b.textContent || '').trim().toLowerCase().includes(lt));
      if (agree) break;
    }
    if (agree) {
      console.log(`[uploadFilesToFlow] video confirm: click "${(agree.textContent || '').trim()}"`);
      simulateClick(agree);
      return true;
    }
  }
  // Không thấy modal → có thể user đã tick "do not show again" trước đó → vẫn coi là OK.
  console.log('[uploadFilesToFlow] video confirm modal không xuất hiện (có thể đã tắt) — tiếp tục chờ tile');
  return true;
}

/**
 * Click modal consent "Tôi đồng ý" / "I agree" (Flow Prohibited Use Policy) — hiện LẦN ĐẦU upload
 * local file (image). Modal chặn tile xuất hiện → phải click confirm. SYNC một lần check (caller
 * gọi trong poll loop → 0 latency thừa). Config `upload_consent_confirm`: selectors trỏ button trong
 * dialog + text_match lọc nút agree (KHÔNG khớp "Hủy"/Cancel). Degraded fallback đa-locale.
 * @returns {boolean} true nếu đã click nút agree.
 */
function _clickUploadConsentModal() {
  const cfg = _getDynamicSelector('upload_consent_confirm');
  const sels = (cfg?.selectors?.length) ? cfg.selectors
    : ['[role="dialog"][data-state="open"] button', '[role="dialog"] button'];
  const texts = (Array.isArray(cfg?.text_match) && cfg.text_match.length)
    ? cfg.text_match : ['Tôi đồng ý', 'I agree, Do not show again', 'I agree'];
  const lowered = texts.map((t) => t.toLowerCase());
  for (const sel of sels) {
    let btns;
    try { btns = Array.from(document.querySelectorAll(sel)); } catch (_) { continue; }
    for (const lt of lowered) {
      const agree = btns.find((b) => (b.textContent || '').trim().toLowerCase().includes(lt));
      if (agree) {
        console.log(`[uploadConsent] click "${(agree.textContent || '').trim()}"`);
        simulateClick(agree);
        return true;
      }
    }
  }
  return false;
}

// Strict Server-Only: KHÔNG hardcode download_resolutions.
// Backend `provider_configs.api_config.download_resolutions` là source of truth.
// Khi cache miss → return null/empty + log warn [Tier3], caller graceful handle.

/**
 * Get download menu_label cho 1 resolution string (vd '1k' → '1K').
 * Strict Server-Only: cache miss → return null, caller skip label.
 */
function _getDownloadMenuLabel(resolution, isVideo) {
  var cfg = _getApiConfigValue('flow', 'download_resolutions');
  if (!cfg) {
    console.debug('[Tier3] _getDownloadMenuLabel: download_resolutions cache empty — returning null');
    return null;
  }
  var mode = isVideo ? 'video' : 'image';
  var list = Array.isArray(cfg[mode]) ? cfg[mode] : [];
  var found = list.find(function(r) { return r.value === resolution; });
  return found?.menu_label || null;
}

/**
 * Get download fallback chain (vd image: ['4K', '2K', '1K']).
 * Strict Server-Only: cache miss → return empty array, caller skip fallback loop.
 */
function _getDownloadFallbackChain(isVideo) {
  var cfg = _getApiConfigValue('flow', 'download_resolutions');
  if (!cfg) {
    console.debug('[Tier3] _getDownloadFallbackChain: download_resolutions cache empty — returning []');
    return [];
  }
  var key = isVideo ? 'video_fallback_chain' : 'image_fallback_chain';
  return Array.isArray(cfg[key]) ? cfg[key] : [];
}

/**
 * Get pixel_width cho image resolution (dùng cho applyResolutionToUrl).
 * Strict Server-Only: cache miss → return null, caller giữ url nguyên.
 */
function _getDownloadPixelWidth(resolution) {
  var cfg = _getApiConfigValue('flow', 'download_resolutions');
  if (!cfg) {
    console.debug('[Tier3] _getDownloadPixelWidth: download_resolutions cache empty — returning null');
    return null;
  }
  var list = Array.isArray(cfg.image) ? cfg.image : [];
  var found = list.find(function(r) { return r.value === resolution; });
  return found?.pixel_width || null;
}

// ─── FloatingTracker i18n (multi-language support) ───
var _trackerLocale = 'vi';
var _trackerTranslations = {
  vi: {
    stopAll: 'Dừng tất cả',
    zoomedForFarRef: 'Đã thu nhỏ trang Flow vì ảnh tham chiếu nằm ở xa',
    scanningRefImages: 'Đang quét ảnh tham chiếu trên Flow...',
    done: 'xong',
    retrying: 'Đang thử lại',
    paused: 'Tạm dừng',
    completed: 'Xong',
    stopped: 'Đã dừng',
    errors: 'lỗi',
    resume: 'Tiếp tục',
    pause: 'Tạm dừng',
    stop: 'Dừng',
    running: 'đang',
    idle: 'nghỉ',
    sent: 'đã gửi',
    failed: 'lỗi',
    total: 'tổng',
    genActive: 'đang gen',
    flowWaiting: 'chờ Flow',
    flowSlow: 'Flow chậm — đang chờ phản hồi',
    dlPending: 'chờ tải',
    dlActive: 'đang tải',
    chunkDraining: 'Đợi xong chunk, sắp reload Flow...',
    chunkReloading: 'Đang reload Flow page...',
    chunkResumed: 'Chunk xong, tiếp tục batch...',
    andMore: 'và {count} mục khác',
    generating: 'Đang tạo ảnh...',
    // State labels
    statePending: 'Chờ',
    stateSubmitting: 'Đang gửi',
    stateSubmitted: 'Đã gửi',
    stateMonitoring: 'Chờ kết quả',
    stateRetry: 'Thử lại',
    stateCompleted: 'Xong',
    statePartialFail: 'Một phần lỗi',
    stateFailed: 'Lỗi',
    stateCancelled: 'Hủy',
    stateWaitingUser: 'Chờ submit',
    // Manual Enter mode
    manualReady: 'Nhấn Enter / bấm Gửi để gen{pos}{ref}',
    manualClickFirst: 'Click ô prompt rồi Enter/bấm Gửi{pos}{ref}',
    manualSubmitted: 'Đã nhận — đang gen...',
    manualPaused: 'Đã tạm dừng — bấm Tiếp tục để chạy',
    manualSkip: 'Bỏ qua',
    modeAuto: 'Auto',
    modeManual: 'Manual',
  },
  en: {
    stopAll: 'Stop all',
    zoomedForFarRef: 'Zoomed out Flow page to load far-away reference images',
    scanningRefImages: 'Scanning reference images on Flow...',
    done: 'done',
    retrying: 'Retrying',
    paused: 'Paused',
    completed: 'Done',
    stopped: 'Stopped',
    errors: 'errors',
    resume: 'Resume',
    pause: 'Pause',
    stop: 'Stop',
    running: 'running',
    idle: 'idle',
    sent: 'sent',
    failed: 'failed',
    total: 'total',
    genActive: 'generating',
    flowWaiting: 'waiting Flow',
    flowSlow: 'Flow slow — waiting response',
    dlPending: 'pending',
    dlActive: 'downloading',
    chunkDraining: 'Finishing chunk, will reload Flow soon...',
    chunkReloading: 'Reloading Flow page...',
    chunkResumed: 'Chunk done, continuing batch...',
    andMore: 'and {count} more',
    generating: 'Generating...',
    statePending: 'Pending',
    stateSubmitting: 'Submitting',
    stateSubmitted: 'Submitted',
    stateMonitoring: 'Waiting',
    stateRetry: 'Retry',
    stateCompleted: 'Done',
    statePartialFail: 'Partial fail',
    stateFailed: 'Failed',
    stateCancelled: 'Cancelled',
    stateWaitingUser: 'Awaiting Submit',
    // Manual Enter mode
    manualReady: 'Press Enter / click Submit{pos}{ref}',
    manualClickFirst: 'Click prompt box, then Enter/Submit{pos}{ref}',
    manualSubmitted: 'Received — generating...',
    manualPaused: 'Paused — click Resume to continue',
    manualSkip: 'Skip',
    modeAuto: 'Auto',
    modeManual: 'Manual',
  },


};

function _getTrackerT(key, params) {
  var t = _trackerTranslations[_trackerLocale] || _trackerTranslations.vi;
  var text = t[key] || _trackerTranslations.vi[key] || key;
  if (params) {
    for (var k in params) {
      text = text.replace('{' + k + '}', params[k]);
    }
  }
  return text;
}

// Listen for locale changes from sidePanel
(function() {
  try {
    // Priority khớp I18n + overlay (line 307): af_locale (chọn explicit) → af_settings.language → 'vi'.
    chrome.storage.local.get(['af_locale', 'af_settings'], function(result) {
      _trackerLocale = result.af_locale || (result.af_settings && result.af_settings.language) || 'vi';
    });
    chrome.storage.onChanged.addListener(function(changes, area) {
      if (area !== 'local' || (!changes.af_locale && !changes.af_settings)) return;
      // Re-read cả 2 → compute priority (af_locale → af_settings.language → 'vi').
      chrome.storage.local.get(['af_locale', 'af_settings'], function(r) {
        _trackerLocale = r.af_locale || (r.af_settings && r.af_settings.language) || 'vi';
        if (FloatingTracker._el && FloatingTracker._lastData) {
          FloatingTracker.update(FloatingTracker._lastData);
        }
      });
    });
  } catch (e) {
    // Content script may not have storage access in some contexts
  }
})();

// K-2: Download counter (session-scoped)
var downloadCounter = 0;
function incrementDownloadCounter() {
  downloadCounter++;
  try {
    chrome.runtime.sendMessage({ action: 'downloadCountUpdate', count: downloadCounter }).catch(function (_e) { globalThis.SEOSONA_swallow?.('content#_getStateConfig', _e); });
  } catch (e) { globalThis.SEOSONA_swallow?.('content#incrementDownloadCounter', e); }
}
function getDownloadCounter() {
  return downloadCounter;
}

// ─── FloatingTracker: Pipeline control panel inject vào trang Flow (góc phải) ───
var FloatingTracker = {
  _el: null,
  _dragPos: null,   // §11: vị trí đã kéo (giữ qua re-render nếu el bị tạo lại)
  _hideTimer: null,
  _expandedJobs: new Set(),
  _manuallyCollapsed: new Set(),
  _tileProgressCache: {},
  _lastDataHash: null,
  _autoRefreshInterval: null,
  _AUTO_REFRESH_MS: 2000, // Re-scan tile progress mỗi 2 giây khi đang running
  // Chunk Mode (2026-07-26): proactive reload status từ PromptQueue
  _chunkStatus: null, // { phase, chunkSize, completedChunks, remaining }
  _chunkResumedTimer: null, // auto-clear 'resumed' phase sau 3s

  // Owner colors
  _ownerColors: {
    prompts: '#3b82f6', task: '#f97316', workflow: '#a855f7',
    angles: '#ec4899', telegram: '#06b6d4'
  },

  // State badge config (dynamic labels from _getTrackerT)
  _getStateConfig: function() {
    return {
      PENDING:      { label: _getTrackerT('statePending'),      bg: 'rgba(255,255,255,0.08)',  color: 'rgba(255,255,255,0.5)' },
      SUBMITTING:   { label: _getTrackerT('stateSubmitting'),   bg: 'rgba(59,130,246,0.2)',   color: '#60a5fa' },
      WAITING_USER: { label: _getTrackerT('stateWaitingUser'),  bg: 'rgba(234,179,8,0.2)',    color: '#eab308' },
      SUBMITTED:    { label: _getTrackerT('stateSubmitted'),    bg: 'rgba(59,130,246,0.15)', color: '#93c5fd' },
      MONITORING:   { label: _getTrackerT('stateMonitoring'),   bg: 'rgba(168,85,247,0.2)', color: '#c084fc' },
      RETRY_SUBMIT: { label: _getTrackerT('stateRetry'),        bg: 'rgba(249,115,22,0.2)',   color: '#fb923c' },
      COMPLETED:    { label: _getTrackerT('stateCompleted'),    bg: 'rgba(25, 208, 123,0.2)',    color: '#4be3a0' },
      PARTIAL_FAIL: { label: _getTrackerT('statePartialFail'),  bg: 'rgba(234,179,8,0.2)', color: '#facc15' },
      FAILED:       { label: _getTrackerT('stateFailed'),       bg: 'rgba(239,68,68,0.2)',    color: '#f87171' },
      CANCELLED:    { label: _getTrackerT('stateCancelled'),    bg: 'rgba(107,114,128,0.2)',  color: '#9ca3af' },
    };
  },

  _formatTime(ms) {
    if (!ms || ms < 0) return '00:00';
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    var sec = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (sec < 10 ? '0' : '') + sec;
  },

  _escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  _create() {
    // Guard: check both ref AND DOM (content.js có thể bị inject lại khi SPA navigate)
    if (this._el && document.body.contains(this._el)) return;

    // Remove any orphaned element from previous injection
    var existing = document.getElementById('seosonaflow-flow-tracker');
    if (existing) existing.remove();
    this._el = null;

    var el = document.createElement('div');
    el.id = 'seosonaflow-flow-tracker';
    // §11 Redesign: glass card giống UI i2p (border-radius 18, blur backdrop, layered shadow).
    el.style.cssText = 'position:fixed;bottom:16px;right:16px;width:380px;' +
      'background:linear-gradient(180deg, rgba(18,22,30,0.38), rgba(4,7,12,0.47)), linear-gradient(180deg, rgba(255,255,255,0.136), rgba(255,255,255,0.036));' +
      'border:1px solid rgba(239,246,255,0.38);border-radius:18px;' +
      'box-shadow:0 26px 62px rgba(0,0,0,0.21), 0 11px 26px rgba(0,0,0,0.13), inset 0 1px 0 rgba(255,255,255,0.43), inset 0 -1px 0 rgba(255,255,255,0.07);' +
      'backdrop-filter:blur(22px) saturate(1.2) contrast(1.04);-webkit-backdrop-filter:blur(22px) saturate(1.2) contrast(1.04);' +
      'z-index:2147483647;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;color:#fff;display:none;overflow:hidden;';

    // Header - glass + drag handle (§11). cursor:grab để user biết kéo được.
    var header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:7px;padding:11px 14px 9px;background:rgba(61, 111, 245, 0.14);border-bottom:1px solid rgba(255,255,255,0.12);cursor:grab;user-select:none;';
    // [tracker-unified] Provider identity: logo + tên Google Flow (ProviderMeta, fallback bolt+"Google Flow").
    var _PM = (typeof ProviderMeta !== 'undefined') ? ProviderMeta : (typeof window !== 'undefined' ? window.ProviderMeta : null);
    var _flowIcon = (_PM && _PM.getIcon && _PM.getIcon('flow')) || '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#3d6ff5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
    var _flowName = (_PM && _PM.getName && _PM.getName('flow')) || 'Google Flow';
    header.innerHTML = '<span style="flex-shrink:0;display:inline-flex;align-items:center;justify-content:center;width:15px;height:15px;">' + _flowIcon + '</span>' +
      '<span style="font-weight:700;font-size:13px;">' + _flowName + '</span>' +
      '<span class="seosonaflow-ft-mode" style="display:none;flex-shrink:0;align-items:center;gap:3px;font-size:10px;font-weight:600;padding:2px 7px;border-radius:20px;"></span>' +
      '<span style="flex:1;"></span>' +
      '<span class="seosonaflow-ft-counter" style="font-size:11px;opacity:0.75;font-variant-numeric:tabular-nums;"></span>' +
      '<span class="seosonaflow-ft-elapsed" style="font-size:10px;opacity:0.5;font-variant-numeric:tabular-nums;"></span>' +
      '<button class="seosonaflow-ft-stop-all" title="' + _getTrackerT('stopAll') + '" style="width:22px;height:22px;background:rgba(239,68,68,0.2);border:none;border-radius:6px;color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;">' +
        '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>' +
      '</button>';
    el.appendChild(header);

    var self = this;
    header.querySelector('.seosonaflow-ft-stop-all').addEventListener('click', function() {
      self._sendAction('pq:stopAll');
    });

    // Progress bar (GPU-accelerated với transform: scaleX)
    var progress = document.createElement('div');
    progress.style.cssText = 'height:3px;background:rgba(255,255,255,0.08);overflow:hidden;';
    progress.innerHTML = '<div class="seosonaflow-ft-progress-fill" style="height:100%;width:100%;background:linear-gradient(90deg,#3b82f6,#60a5fa,#a78bfa);transform:scaleX(0);transform-origin:left;transition:transform 0.3s ease-out;will-change:transform;"></div>';
    el.appendChild(progress);

    // CSS animations (inject once)
    if (!document.getElementById('seosonaflow-ft-animations')) {
      var style = document.createElement('style');
      style.id = 'seosonaflow-ft-animations';
      style.textContent = '@keyframes seosonaflow-pulse{0%,100%{opacity:1}50%{opacity:0.6}}' +
        '@keyframes seosonaflow-progress-glow{0%,100%{opacity:0.5}50%{opacity:1}}' +
        '.seosonaflow-ft-progress-fill.active{animation:seosonaflow-progress-glow 1.5s ease-in-out infinite}' +
        '.seosonaflow-ft-dot-pulse{animation:seosonaflow-pulse 1.5s ease-in-out infinite}';
      document.head.appendChild(style);
    }

    // Pipeline status row
    var pipelineRow = document.createElement('div');
    pipelineRow.className = 'seosonaflow-ft-pipeline';
    pipelineRow.style.cssText = 'display:none;padding:6px 12px;font-size:11px;color:rgba(255,255,255,0.7);border-bottom:1px solid rgba(255,255,255,0.06);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
    el.appendChild(pipelineRow);

    // Jobs container (§11: dài hơn — min(60vh, 420px))
    var jobsWrap = document.createElement('div');
    jobsWrap.className = 'seosonaflow-ft-jobs';
    jobsWrap.style.cssText = 'max-height:min(60vh, 420px);overflow-y:auto;overflow-x:hidden;';
    el.appendChild(jobsWrap);

    document.body.appendChild(el);
    this._el = el;

    // Hover CSS cho nút pause/resume/stop/skip trong tracker.
    try { _injectTrackerHoverStyles(); } catch (_) { globalThis.SEOSONA_swallow?.('content#_create', _); }

    // §11: kéo di chuyển tracker (port từ i2p makeDraggable). Restore vị trí đã kéo nếu có.
    this._makeDraggable(el, header);
    if (this._dragPos) {
      el.style.left = this._dragPos.left + 'px'; el.style.top = this._dragPos.top + 'px';
      el.style.right = 'auto'; el.style.bottom = 'auto';
    }

    // Event delegation: 1 listener duy nhất trên container thay vì N listeners mỗi lần render
    this._setupJobsDelegation(jobsWrap);
  },

  // §11: header = tay kéo. Bỏ qua khi click nút (stopAll / pause / resume / stop per-job).
  _makeDraggable: function(el, handle) {
    var self = this;
    handle.addEventListener('mousedown', function(e) {
      if (e.target.closest('button') || e.target.closest('[data-action]')) return;
      var r = el.getBoundingClientRect();
      el.style.left = r.left + 'px'; el.style.top = r.top + 'px';
      el.style.right = 'auto'; el.style.bottom = 'auto';
      var sx = e.clientX, sy = e.clientY, ox = r.left, oy = r.top;
      e.preventDefault();
      function move(ev) {
        var nx = Math.max(0, Math.min(ox + (ev.clientX - sx), window.innerWidth - el.offsetWidth));
        var ny = Math.max(0, Math.min(oy + (ev.clientY - sy), window.innerHeight - el.offsetHeight));
        el.style.left = nx + 'px'; el.style.top = ny + 'px';
        self._dragPos = { left: nx, top: ny };
      }
      function up() { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); }
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
  },

  /**
   * Thiết lập event delegation trên container .seosonaflow-ft-jobs.
   * Chỉ gọi 1 lần trong _create(), không gọi lại mỗi lần render.
   * Delegate click dựa vào data-action (stop/pause/resume) và data-job-toggle (expand/collapse).
   */
  _setupJobsDelegation(container) {
    var self = this;
    container.addEventListener('click', function(e) {
      // Ưu tiên xử lý action buttons (stop/pause/resume)
      var actionEl = e.target.closest('[data-action]');
      if (actionEl) {
        e.stopPropagation();
        var action = actionEl.getAttribute('data-action');
        var jobId = actionEl.getAttribute('data-job-id');
        if (action === 'stop') self._sendAction('pq:stopJob', { jobId: jobId });
        else if (action === 'pause') self._sendAction('pq:pauseJob', { jobId: jobId });
        else if (action === 'resume') self._sendAction('pq:resumeJob', { jobId: jobId });
        else if (action === 'skip') { _manualUserSkip = true; } // Manual mode: bỏ qua prompt đang chờ Enter (cùng context content.js)
        return;
      }

      // Toggle expand/collapse job
      var headerEl = e.target.closest('[data-job-toggle]');
      if (headerEl) {
        var toggleJobId = headerEl.getAttribute('data-job-toggle');
        if (self._expandedJobs.has(toggleJobId)) {
          self._expandedJobs.delete(toggleJobId);
          self._manuallyCollapsed.add(toggleJobId);
        } else {
          self._expandedJobs.add(toggleJobId);
          self._manuallyCollapsed.delete(toggleJobId);
        }
        // Re-render ngay với dữ liệu hiện tại
        if (self._lastData) self._renderJobs(self._lastData.jobs || []);
      }
    });
  },

  // §11.6: badge Auto / Manual (Enter) trên header — đọc settings.manualSubmitMode từ job đang chạy.
  // Nguồn dữ liệu: snapshot đã chứa job.settings (PromptQueue._buildSnapshot) → không cần plumbing thêm.
  _updateModeBadge: function(jobs) {
    var badge = this._el && this._el.querySelector('.seosonaflow-ft-mode');
    if (!badge) return;
    var job = (jobs || []).find(function(j){ return j.status === 'running' || j.status === 'paused'; }) || (jobs || [])[0];
    if (!job) { badge.style.display = 'none'; return; }
    var isManual = !!(job.settings && job.settings.manualSubmitMode);
    var waiting = isManual && (job.items || []).some(function(it){ return it.state === 'WAITING_USER'; });
    badge.style.display = 'inline-flex';
    if (isManual) {
      badge.style.background = 'rgba(234,179,8,0.2)';
      badge.style.color = '#eab308';
      badge.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 10h6a3 3 0 0 1 3 3v1"/><polyline points="12 7 9 10 12 13"/></svg><span>' + _getTrackerT('modeManual') + '</span>';
      badge.classList.toggle('seosonaflow-ft-dot-pulse', waiting);
    } else {
      badge.style.background = 'rgba(59,130,246,0.2)';
      badge.style.color = '#60a5fa';
      badge.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg><span>' + _getTrackerT('modeAuto') + '</span>';
      badge.classList.remove('seosonaflow-ft-dot-pulse');
    }
  },

  update(data) {
    this._create();
    if (!data) return;

    clearTimeout(this._hideTimer);
    var el = this._el;
    var completed = data.completed || 0;
    var total = data.total || 0;
    var isRunning = data.isRunning;
    var jobs = data.jobs || [];

    // Completion / hide
    if (!isRunning || total === 0) {
      this._stopAutoRefresh(); // Dừng auto-refresh khi không còn running
      if (completed > 0) {
        el.style.display = 'block';
        // Done state: hiển thị done/total kèm label "xong" — submitted nay = total nên không cần distinction
        el.querySelector('.seosonaflow-ft-counter').textContent = completed + '/' + total + ' ' + _getTrackerT('done');
        var progressFill = el.querySelector('.seosonaflow-ft-progress-fill');
        progressFill.style.transform = 'scaleX(1)';
        progressFill.classList.remove('active');
        el.querySelector('.seosonaflow-ft-elapsed').textContent = '';
        // Ẩn stop button và pipeline row khi đã xong
        var stopBtn = el.querySelector('.seosonaflow-ft-stop-all');
        if (stopBtn) stopBtn.style.display = 'none';
        var modeBadge = el.querySelector('.seosonaflow-ft-mode');
        if (modeBadge) modeBadge.style.display = 'none';
        var pRow = el.querySelector('.seosonaflow-ft-pipeline');
        if (pRow) pRow.style.display = 'none';
        el.querySelector('.seosonaflow-ft-jobs').innerHTML = '';
        this._hideTimer = setTimeout(function() { FloatingTracker.hide(); }, 3000);
      } else {
        this.hide();
      }
      return;
    }

    el.style.display = 'block';

    // Hiện stop button khi đang chạy
    var stopBtn = el.querySelector('.seosonaflow-ft-stop-all');
    if (stopBtn) stopBtn.style.display = '';

    // §11.6: mode badge (Auto / Manual) từ job đang chạy
    this._updateModeBadge(jobs);

    // Header counter & elapsed
    var pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    // 3-tier counter: ${done}/${submitted} ✓ • ${total} total
    // submitted < total → show distinction giữa "đã gửi" vs "tổng batch"
    // submitted >= total → collapse về ${done}/${total} (gọn hơn khi all submitted)
    var submitted = (data.pipeline && data.pipeline.editor && data.pipeline.editor.processedCount) || 0;
    if (submitted < completed) submitted = completed; // defensive: clamp vs data lag
    var counterText;
    if (submitted > 0 && submitted < total) {
      counterText = completed + '/' + submitted + ' ✓ • ' + total + ' ' + _getTrackerT('total');
    } else {
      counterText = completed + '/' + total;
    }
    el.querySelector('.seosonaflow-ft-counter').textContent = counterText;
    var progressFill = el.querySelector('.seosonaflow-ft-progress-fill');
    progressFill.style.transform = 'scaleX(' + (pct / 100) + ')';
    progressFill.classList.add('active'); // Enable glow animation
    el.querySelector('.seosonaflow-ft-elapsed').textContent = this._formatTime(data.elapsed);

    // Pipeline status row
    this._renderPipelineRow(data.pipeline);

    // Scan tile progress % từ DOM cho items đang MONITORING
    this._scanTileProgress(jobs);

    // Jobs
    this._renderJobs(jobs);

    // Start auto-refresh cho legacy mode (re-scan tile progress định kỳ)
    this._startAutoRefresh();
  },

  // Bắt đầu auto-refresh interval để re-scan tile progress (legacy mode)
  _startAutoRefresh() {
    if (this._autoRefreshInterval) return; // Đã chạy rồi
    var self = this;
    this._autoRefreshInterval = setInterval(function() {
      // Guard context-invalidated (extension reload) → dừng interval mồ côi.
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) { self._stopAutoRefresh(); return; }
      // Chỉ re-scan nếu có lastData và đang running
      if (!self._lastData || !self._lastData.isRunning) {
        self._stopAutoRefresh();
        return;
      }
      // Re-scan tile progress và re-render jobs
      var jobs = self._lastData.jobs || [];
      self._scanTileProgress(jobs);
      self._renderJobs(jobs);
    }, this._AUTO_REFRESH_MS);
  },

  // Dừng auto-refresh interval
  _stopAutoRefresh() {
    if (this._autoRefreshInterval) {
      clearInterval(this._autoRefreshInterval);
      this._autoRefreshInterval = null;
    }
  },

  // Đọc % tiến độ từ DOM tile cho items đang MONITORING
  _scanTileProgress(jobs) {
    var cache = {};
    if (!jobs) { this._tileProgressCache = cache; return; }

    try {
      // Thu thập items đang MONITORING và tập hợp preTileIds để chỉ scan tiles cần thiết
      var monitoringItems = [];
      var allPreTileIds = new Set();
      var isLegacyMode = false;
      for (var i = 0; i < jobs.length; i++) {
        var j = jobs[i];
        // Detect legacy mode: job ID starts with _legacy_
        if (j.id && typeof j.id === 'string' && j.id.startsWith('_legacy_')) {
          isLegacyMode = true;
        }
        if (!j.items) continue;
        for (var k = 0; k < j.items.length; k++) {
          var it = j.items[k];
          if (it.state !== 'MONITORING' || !it.preTileIds) continue;
          monitoringItems.push(it);
          for (var pi = 0; pi < it.preTileIds.length; pi++) {
            allPreTileIds.add(it.preTileIds[pi]);
          }
        }
      }

      // Dùng tile cache (250ms TTL) thay vì query DOM trực tiếp
      var allTiles = _getCachedTiles();

      // Legacy mode fallback: không có MONITORING items, scan tiles đang processing trực tiếp
      if (monitoringItems.length === 0 && isLegacyMode) {
        var maxProgress = null;
        for (var lt = 0; lt < allTiles.length; lt++) {
          var ltEl = allTiles[lt];
          var ltStatus = typeof detectTileStatus === 'function' ? detectTileStatus(ltEl) : null;
          // Chỉ scan tiles đang processing
          if (ltStatus !== 'processing') continue;
          var ltPct = typeof extractTileProgress === 'function' ? extractTileProgress(ltEl) : null;
          if (ltPct !== null && (maxProgress === null || ltPct > maxProgress)) {
            maxProgress = ltPct;
          }
        }
        // Lưu với key đặc biệt cho legacy mode
        if (maxProgress !== null) {
          cache._legacy = maxProgress;
        }
        this._tileProgressCache = cache;
        return;
      }

      if (monitoringItems.length === 0) { this._tileProgressCache = cache; return; }

      // Chỉ scan tiles MỚI (không nằm trong preTileIds) — đây là tiles đang generate
      var tilesWithProgress = [];
      for (var t = 0; t < allTiles.length; t++) {
        var tileEl = allTiles[t];
        var tid = tileEl.getAttribute('data-tile-id');
        if (!tid || allPreTileIds.has(tid)) continue; // Bỏ qua tiles cũ

        var pct = typeof extractTileProgress === 'function' ? extractTileProgress(tileEl) : null;
        if (pct !== null) {
          tilesWithProgress.push({ tileId: tid, progress: pct });
        }
      }

      if (tilesWithProgress.length === 0) { this._tileProgressCache = cache; return; }

      // Map tiles có progress vào MONITORING items qua preTileIds exclusion
      for (var mi = 0; mi < monitoringItems.length; mi++) {
        var mit = monitoringItems[mi];
        var preTileSet = new Set(mit.preTileIds);
        var bestProgress = null;

        for (var p = 0; p < tilesWithProgress.length; p++) {
          var pt = tilesWithProgress[p];
          if (preTileSet.has(pt.tileId)) continue; // Tile cũ (trước khi submit)
          if (bestProgress === null || pt.progress > bestProgress) {
            bestProgress = pt.progress;
          }
        }
        if (bestProgress !== null) cache[mit.id] = bestProgress;
      }
    } catch (e) {
      // Không block render nếu scan lỗi
    }
    this._tileProgressCache = cache;
  },

  /**
   * Chunk Mode (2026-07-26): receive chunk_status update từ PromptQueue.
   * Phase logic:
   *   - draining/reloading: hiện banner persistent
   *   - resumed: hiện 3s rồi auto-clear (chunk OK)
   *   - cancelled: clear ngay (reload bị block/fail, không show banner)
   */
  setChunkStatus(data) {
    if (!data || !data.phase) return;

    // Clear timer cũ nếu có
    if (this._chunkResumedTimer) {
      clearTimeout(this._chunkResumedTimer);
      this._chunkResumedTimer = null;
    }

    if (data.phase === 'cancelled') {
      // Reload bị block (cooldown/fail) → clear banner ngay, không show success
      this._chunkStatus = null;
    } else {
      this._chunkStatus = data;
    }

    if (data.phase === 'resumed') {
      // Auto-clear 'resumed' sau 3s — chunk reload xong
      var self = this;
      this._chunkResumedTimer = setTimeout(function() {
        self._chunkStatus = null;
        if (self._el && self._lastData) self.update(self._lastData);
      }, 3000);
    }

    // Re-render ngay với last data
    if (this._el && this._lastData) {
      this.update(this._lastData);
    }
  },

  _renderPipelineRow(pipeline) {
    var row = this._el.querySelector('.seosonaflow-ft-pipeline');
    if (!pipeline) { row.style.display = 'none'; return; }

    // Pipeline summary 2 d\u00f2ng:
    //   D\u00f2ng 1 (gen): \u25b6 sent \u2022 \u26a1 \u0111ang gen \u2022 \u23f8 ch\u1edd Flow \u2022 \u2713 xong \u2022 \u2715 l\u1ed7i
    //   D\u00f2ng 2 (download): \ud83d\udce5 \u0111ang t\u1ea3i/ch\u1edd t\u1ea3i \u2022 \u2713 t\u1ea3i xong (ch\u1ec9 hi\u1ec7n khi c\u00f3 download activity)
    // Stagnant flag \u2192 n\u1ec1n cam + \u26a0\ufe0f icon tr\u00ean d\u00f2ng 1.
    var sent = (pipeline.editor && pipeline.editor.processedCount) || 0;
    var tm = pipeline.tileMonitor || {};
    var active = tm.activeCount || 0;
    var claiming = tm.claimingCount;
    if (typeof claiming !== 'number') claiming = active;
    var waiting = tm.waitingCount;
    if (typeof waiting !== 'number') waiting = 0;
    var done = tm.completedCount || 0;
    var failed = tm.failedCount || 0;
    var stagnant = !!tm.stagnant;

    // Download stats
    var dl = pipeline.download || {};
    var dlQueue = dl.queueLength || 0;
    var dlDone = dl.completedCount || 0;
    var dlState = dl.state || 'idle'; // 'downloading' | 'queued' | 'idle'
    var hasDlActivity = dlQueue > 0 || dlDone > 0 || dlState === 'downloading';

    // Hide row chỉ khi pipeline hoàn toàn empty + không có chunk status active
    var hasChunkStatus = !!(this._chunkStatus && this._chunkStatus.phase);
    if (sent === 0 && active === 0 && done === 0 && failed === 0 && !hasDlActivity && !hasChunkStatus) {
      row.style.display = 'none';
      row.style.background = '';
      row.style.borderLeft = '';
      return;
    }

    var sep = '<span style="opacity:0.3;margin:0 5px;">\u2022</span>';
    var failedColor = failed > 0 ? '#f87171' : 'rgba(255,255,255,0.35)';
    var waitColor = waiting > 0 ? '#fbbf24' : 'rgba(255,255,255,0.35)';
    var claimColor = claiming > 0 ? '#c084fc' : 'rgba(255,255,255,0.35)';
    var stagnantPrefix = stagnant
      ? '<span style="color:#fb923c;font-weight:600;margin-right:6px;" title="' + this._escHtml(_getTrackerT('flowSlow')) + '">\u26a0\ufe0f</span>'
      : '';

    // Chunk Mode banner \u2014 1 d\u00f2ng tr\u00ean c\u00f9ng khi \u0111ang draining/reloading/resumed
    var chunkBanner = '';
    if (this._chunkStatus && this._chunkStatus.phase) {
      var cs = this._chunkStatus;
      var chunkIcon, chunkLabel, chunkColor;
      if (cs.phase === 'draining') {
        chunkIcon = '\u23f3';
        chunkLabel = _getTrackerT('chunkDraining');
        // Append remaining count cu\u1ed1i label (language-agnostic)
        if (typeof cs.remaining === 'number' && cs.remaining > 0) {
          chunkLabel = chunkLabel + ' (' + cs.remaining + ')';
        }
        chunkColor = '#60a5fa';
      } else if (cs.phase === 'reloading') {
        chunkIcon = '\ud83d\udd04';
        chunkLabel = _getTrackerT('chunkReloading');
        chunkColor = '#a78bfa';
      } else if (cs.phase === 'resumed') {
        chunkIcon = '\u2713';
        chunkLabel = _getTrackerT('chunkResumed');
        if (typeof cs.completedChunks === 'number' && cs.completedChunks > 0) {
          chunkLabel = '#' + cs.completedChunks + ' \u2014 ' + chunkLabel;
        }
        chunkColor = '#4be3a0';
      } else {
        chunkIcon = '';
        chunkLabel = '';
        chunkColor = 'rgba(255,255,255,0.5)';
      }
      if (chunkLabel) {
        chunkBanner = '<div style="color:' + chunkColor + ';font-size:11px;padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.06);margin-bottom:4px;">' +
          chunkIcon + ' ' + this._escHtml(chunkLabel) +
        '</div>';
      }
    }

    var genLine = stagnantPrefix +
      '<span style="color:#93c5fd;">\u25b6 ' + sent + ' ' + this._escHtml(_getTrackerT('sent')) + '</span>' + sep +
      '<span style="color:' + claimColor + ';">\u26a1 ' + claiming + ' ' + this._escHtml(_getTrackerT('genActive')) + '</span>' + sep +
      '<span style="color:' + waitColor + ';">\u23f8 ' + waiting + ' ' + this._escHtml(_getTrackerT('flowWaiting')) + '</span>' + sep +
      '<span style="color:#4be3a0;">\u2713 ' + done + ' ' + this._escHtml(_getTrackerT('done')) + '</span>' + sep +
      '<span style="color:' + failedColor + ';">\u2715 ' + failed + ' ' + this._escHtml(_getTrackerT('failed')) + '</span>';

    var html = chunkBanner + '<div>' + genLine + '</div>';

    // D\u00f2ng 2 download \u2014 ch\u1ec9 hi\u1ec7n khi c\u00f3 download activity
    if (hasDlActivity) {
      var dlIcon = dlState === 'downloading' ? '\ud83d\udce5' : (dlQueue > 0 ? '\ud83d\udccb' : '\u2713');
      var dlLabel = dlState === 'downloading'
        ? _getTrackerT('dlActive')
        : (dlQueue > 0 ? _getTrackerT('dlPending') : _getTrackerT('done'));
      var dlPendingColor = dlQueue > 0 ? '#60a5fa' : 'rgba(255,255,255,0.35)';
      var dlDoneColor = dlDone > 0 ? '#4be3a0' : 'rgba(255,255,255,0.35)';
      var dlLine =
        '<span style="color:' + dlPendingColor + ';">' + dlIcon + ' ' + dlQueue + ' ' + this._escHtml(dlLabel) + '</span>' + sep +
        '<span style="color:' + dlDoneColor + ';">\u2713 ' + dlDone + ' ' + this._escHtml(_getTrackerT('done')) + '</span>';
      html += '<div style="margin-top:3px;padding-top:3px;border-top:1px solid rgba(255,255,255,0.05);">' + dlLine + '</div>';
    }

    row.style.display = 'block';
    if (stagnant) {
      row.style.background = 'rgba(251,146,60,0.08)';
      row.style.borderLeft = '3px solid #fb923c';
    } else {
      row.style.background = '';
      row.style.borderLeft = '';
    }
    row.innerHTML = html;
  },

  _renderJobs(jobs) {
    var jobsEl = this._el.querySelector('.seosonaflow-ft-jobs');
    if (!jobs || jobs.length === 0) { jobsEl.innerHTML = ''; return; }

    var self = this;
    var now = Date.now();
    var html = '';

    for (var i = 0; i < jobs.length; i++) {
      var j = jobs[i];
      var color = self._ownerColors[j.owner] || '#6b7280';
      var isDone = j.status === 'completed' || j.status === 'stopped';
      var isPaused = j.status === 'paused';
      var isActive = j.status === 'running' || isPaused;
      var jobPct = j.total > 0 ? Math.round((j.completed / j.total) * 100) : 0;
      var jobElapsed = j.startedAt ? self._formatTime(now - j.startedAt) : '';

      // Auto-expand active jobs, auto-collapse done jobs
      if (isActive && !self._manuallyCollapsed.has(j.id)) {
        self._expandedJobs.add(j.id);
      } else if (isDone) {
        self._expandedJobs.delete(j.id);
        self._manuallyCollapsed.delete(j.id);
      }
      var isExpanded = self._expandedJobs.has(j.id);

      // Check if any items are in RETRY_SUBMIT state
      var hasRetrying = isActive && j.items && j.items.some(function(it) { return it.state === 'RETRY_SUBMIT'; });

      // Status badge
      var statusBadge = '';
      if (hasRetrying) {
        statusBadge = '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(249,115,22,0.2);color:#fb923c;">' + _getTrackerT('retrying') + '</span>';
      } else if (isPaused) {
        statusBadge = '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:rgba(245,158,11,0.2);color:#fbbf24;">' + _getTrackerT('paused') + '</span>';
      } else if (isDone) {
        var doneColor = j.status === 'completed' ? '#4be3a0' : '#f87171';
        var doneBg = j.status === 'completed' ? 'rgba(25, 208, 123,0.2)' : 'rgba(239,68,68,0.2)';
        var doneLabel = j.status === 'completed' ? _getTrackerT('completed') : _getTrackerT('stopped');
        statusBadge = '<span style="font-size:9px;padding:1px 5px;border-radius:3px;background:' + doneBg + ';color:' + doneColor + ';">' + doneLabel + '</span>';
      }

      // Failed count badge
      var failBadge = '';
      if (j.failed > 0) {
        failBadge = '<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(239,68,68,0.2);color:#f87171;margin-left:2px;">' + j.failed + ' ' + _getTrackerT('errors') + '</span>';
      }

      // Action buttons (only for active jobs)
      var actions = '';
      if (isActive) {
        // Pause/Resume button (only for prompts owner)
        if (j.owner === 'prompts') {
          if (isPaused) {
            actions += '<button data-action="resume" data-job-id="' + j.id + '" title="' + _getTrackerT('resume') + '" style="width:20px;height:20px;background:rgba(25, 208, 123,0.2);border:none;border-radius:4px;color:#4be3a0;cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
              '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="8,6 18,12 8,18"/></svg></button>';
          } else {
            actions += '<button data-action="pause" data-job-id="' + j.id + '" title="' + _getTrackerT('pause') + '" style="width:20px;height:20px;background:rgba(255,255,255,0.08);border:none;border-radius:4px;color:rgba(255,255,255,0.6);cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
              '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="6" width="3" height="12" rx="1"/><rect x="14" y="6" width="3" height="12" rx="1"/></svg></button>';
          }
        }
        // Stop button
        actions += '<button data-action="stop" data-job-id="' + j.id + '" title="' + _getTrackerT('stop') + '" style="width:20px;height:20px;background:rgba(239,68,68,0.15);border:none;border-radius:4px;color:#ef4444;cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
          '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1"/></svg></button>';
      }

      // Opacity for done jobs
      var jobOpacity = isDone ? 'opacity:0.5;' : '';

      html += '<div style="padding:4px 12px;border-bottom:1px solid rgba(255,255,255,0.05);' + jobOpacity + '">';
      // Job header row
      html += '<div class="seosonaflow-ft-job-header" data-job-toggle="' + j.id + '" style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:3px 0;">';
      html += '<span class="' + (isActive && !isPaused ? 'seosonaflow-ft-dot-pulse' : '') + '" style="width:8px;height:8px;border-radius:50%;background:' + color + ';flex-shrink:0;"></span>';
      html += '<span style="flex:1;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;">' + self._escHtml(j.label || j.owner) + '</span>';
      html += statusBadge + failBadge;
      html += '<span style="font-size:10px;opacity:0.5;font-variant-numeric:tabular-nums;flex-shrink:0;">' + jobElapsed + '</span>';
      html += '<span style="font-size:10px;opacity:0.6;font-variant-numeric:tabular-nums;flex-shrink:0;">' + jobPct + '%</span>';
      html += '<div style="display:flex;gap:2px;flex-shrink:0;">' + actions + '</div>';
      // Expand chevron
      html += '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;transition:transform 0.2s;' + (isExpanded ? 'transform:rotate(180deg);' : '') + '"><polyline points="6 9 12 15 18 9"/></svg>';
      html += '</div>';

      // Job progress bar (GPU-accelerated)
      html += '<div style="height:2px;background:rgba(255,255,255,0.08);border-radius:1px;margin:3px 0;overflow:hidden;">';
      html += '<div style="height:100%;width:100%;background:' + color + ';border-radius:1px;transform:scaleX(' + (jobPct / 100) + ');transform-origin:left;transition:transform 0.3s ease-out;will-change:transform;"></div>';
      html += '</div>';

      // Items (expandable)
      if (isExpanded && j.items && j.items.length > 0) {
        html += '<div style="padding:0px;margin-left:4px;">';
        // Hiển thị TOÀN BỘ item hàng đợi (container .seosonaflow-ft-jobs đã scroll max-height 60vh).
        // Cap 500 chỉ để chặn pathological (queue thực tế bị giới hạn prompts_per_batch của plan).
        var displayItems = j.items.length > 500 ? j.items.slice(-500) : j.items;
        for (var k = 0; k < displayItems.length; k++) {
          var it = displayItems[k];
          var stateConfig = self._getStateConfig();
          var sc = stateConfig[it.state] || stateConfig.PENDING;
          var promptShort = it.promptText ? (it.promptText.length > 50 ? it.promptText.substring(0, 50) + '...' : it.promptText) : '';

          // Time info: duration from submit to complete
          var timeInfo = '';
          if (it.completedAt && it.submittedAt) {
            timeInfo = self._formatTime(it.completedAt - it.submittedAt);
          } else if (it.submittedAt) {
            timeInfo = self._formatTime(now - it.submittedAt);
          }

          // Retry badge
          var retryBadge = '';
          if (it.retryCount > 0) {
            retryBadge = '<span style="font-size:8px;padding:0 3px;border-radius:2px;background:rgba(249,115,22,0.2);color:#fb923c;">x' + it.retryCount + '</span>';
          }

          // Tile progress % cho items đang MONITORING
          var tileProgress = (it.state === 'MONITORING' && self._tileProgressCache[it.id] != null) ? self._tileProgressCache[it.id] : null;

          // Active item highlight
          var itemBg = (it.state === 'SUBMITTING' || it.state === 'MONITORING') ? 'background:rgba(255,255,255,0.03);border-radius:4px;' : '';

          html += '<div style="display:flex;align-items:center;gap:5px;padding:4px 4px;font-size:11px;' + itemBg + '">';
          html += '<span style="color:rgba(255,255,255,0.4);font-size:10px;width:18px;flex-shrink:0;font-variant-numeric:tabular-nums;">#' + ((it.promptIndex || 0) + 1) + '</span>';
          html += '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,0.7);" title="' + self._escHtml(it.promptText || '') + '">' + self._escHtml(promptShort) + '</span>';
          html += retryBadge;
          if (timeInfo) {
            html += '<span style="font-size:9px;opacity:0.4;font-variant-numeric:tabular-nums;flex-shrink:0;">' + timeInfo + '</span>';
          }
          // State badge: hiện % nếu đang monitoring và có progress
          if (tileProgress !== null) {
            html += '<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:rgba(168,85,247,0.25);color:#c084fc;flex-shrink:0;white-space:nowrap;font-variant-numeric:tabular-nums;">' + tileProgress + '%</span>';
          } else {
            html += '<span style="font-size:9px;padding:1px 4px;border-radius:3px;background:' + sc.bg + ';color:' + sc.color + ';flex-shrink:0;white-space:nowrap;">' + sc.label + '</span>';
          }
          // Manual mode: nút Bỏ qua khi item đang chờ user nhấn Enter (skip = content.js-local flag)
          if (it.state === 'WAITING_USER') {
            html += '<button data-action="skip" title="' + _getTrackerT('manualSkip') + '" style="margin-left:2px;padding:1px 5px;border:none;border-radius:3px;background:rgba(255,255,255,0.12);color:#fff;font-size:9px;cursor:pointer;flex-shrink:0;">' + _getTrackerT('manualSkip') + '</button>';
          }
          html += '</div>';
        }
        if (j.items.length > 500) {
          html += '<div style="font-size:10px;opacity:0.4;padding:2px 4px;">... ' + _getTrackerT('andMore', { count: j.items.length - 500 }) + '</div>';
        }
        html += '</div>';
      }
      // Legacy mode: hiển thị tile progress % khi không có items nhưng có progress từ DOM
      else if (isExpanded && j.id && typeof j.id === 'string' && j.id.startsWith('_legacy_') && isActive) {
        var legacyProgress = self._tileProgressCache._legacy;
        if (legacyProgress !== null && typeof legacyProgress === 'number') {
          html += '<div style="padding:6px 4px;margin-left:4px;">';
          html += '<div style="display:flex;align-items:center;gap:8px;font-size:11px;background:rgba(255,255,255,0.03);border-radius:4px;padding:6px 8px;">';
          html += '<span style="color:rgba(255,255,255,0.5);">' + _getTrackerT('generating') + '</span>';
          html += '<span style="font-size:10px;padding:2px 6px;border-radius:3px;background:rgba(168,85,247,0.25);color:#c084fc;font-variant-numeric:tabular-nums;font-weight:500;">' + legacyProgress + '%</span>';
          html += '</div>';
          html += '</div>';
        }
      }

      html += '</div>';
    }

    jobsEl.innerHTML = html;
    // Event listeners được xử lý bởi _setupJobsDelegation() (gọi 1 lần trong _create())
    // Không cần bind lại mỗi lần render vì dùng event delegation trên container
  },

  /**
   * Legacy mode: cập nhật FloatingTracker cho execution KHÔNG dùng Pipeline Queue
   * Chuyển đổi dữ liệu single-owner thành format multi-job tương thích update()
   */
  updateLegacy(data) {
    if (!data) return;
    this._legacyData = data;
    var isActive = data.status === 'running' || data.status === 'paused';
    this.update({
      isRunning: isActive,
      completed: data.current || 0,
      total: data.total || 0,
      elapsed: data.startedAt ? Date.now() - data.startedAt : 0,
      pipeline: null,
      jobs: [{
        id: '_legacy_' + (data.owner || 'prompts'),
        owner: data.owner || 'prompts',
        label: data.label || data.owner || 'Auto Gen',
        status: data.status || 'running',
        completed: data.current || 0,
        failed: data.failed || 0,
        total: data.total || 0,
        startedAt: data.startedAt,
        items: data.items || []
      }]
    });
  },

  _sendAction(action, data) {
    // Legacy mode: xử lý trực tiếp trong content.js (không cần relay qua sidePanel)
    if (data && data.jobId && typeof data.jobId === 'string' && data.jobId.startsWith('_legacy_')) {
      if (action === 'pq:stopJob' || action === 'pq:stopAll') {
        shouldStop = true;
        isPaused = false;
        if (this._legacyData) {
          this._legacyData.status = 'stopped';
          this.updateLegacy(this._legacyData);
        }
        return;
      }
      if (action === 'pq:pauseJob') {
        isPaused = true;
        if (this._legacyData) {
          this._legacyData.status = 'paused';
          this.updateLegacy(this._legacyData);
        }
        return;
      }
      if (action === 'pq:resumeJob') {
        isPaused = false;
        if (this._legacyData) {
          this._legacyData.status = 'running';
          this.updateLegacy(this._legacyData);
        }
        return;
      }
    }
    // Pipeline mode: stop all legacy too
    if (action === 'pq:stopAll' && isRunning) {
      shouldStop = true;
      isPaused = false;
    }
    // Pipeline mode: relay qua sidePanel
    chrome.runtime.sendMessage(Object.assign({ action: action }, data || {})).catch(function(err) {
      console.warn('[FloatingTracker] Action failed:', action, err.message);
    });
  },

  hide() {
    this._stopAutoRefresh();
    if (this._el) {
      this._el.style.display = 'none';
    }
    this._lastData = null;
    this._legacyData = null;
    this._expandedJobs.clear();
    this._manuallyCollapsed.clear();
    this._tileProgressCache = {};
    // Chunk Mode (2026-07-26): clear chunk state khi hide để batch tiếp theo bắt đầu sạch
    this._chunkStatus = null;
    if (this._chunkResumedTimer) {
      clearTimeout(this._chunkResumedTimer);
      this._chunkResumedTimer = null;
    }
  }
};

// Wrap update to cache last data for re-render
var _origUpdate = FloatingTracker.update;
FloatingTracker.update = function(data) {
  this._lastData = data;
  _origUpdate.call(this, data);
  // Re-assert CSS zoom counter-scale: tracker thường hiện ra/re-render SAU khi zoom session active
  // → set zoom mỗi lần update để tracker giữ kích thước đọc được (CSS zoom compose đúng với browser
  // zoom: 0.3 × 3.33 ≈ 1.0). Chỉ khi session active → an toàn (zoom đang bật).
  try {
    const _zs = window._seosonaFlowZoomSession;
    if (_zs && _zs.active && this._el) {
      // Re-assert counter-scale mỗi update — page đã zoom nhỏ sẵn nên áp ngay, không transient.
      // _zs.active CHỈ true SAU khi browser zoom paint xong (gate ở _ensureZoomSessionActive) →
      // update không counter-scale sớm khi page chưa nhỏ.
      const inv = (_zs.factor && _zs.factor > 0) ? (1 / _zs.factor) : 1;
      if (this._el.style.zoom !== String(inv)) this._el.style.zoom = String(inv);
    }
  } catch (_) { globalThis.SEOSONA_swallow?.('content#update', _); }
};

// ─── ExecutionBlocker: Border glow overlay khi extension thao tác (block click, không che Flow) ───
var ExecutionBlocker = {
  _el: null,
  _styleEl: null,
  _blocking: false,
  _wasBlockingBeforeManual: false, // Manual mode: nhớ trạng thái block trước khi suspend
  _manualSuspended: false,         // Manual mode: đang tạm ẩn overlay (show() giữ ẩn khi true)
  _timeoutId: null,
  _sanityIntervalId: null,
  _escapeCount: 0,
  _escapeTimer: null,
  _pipelineOwned: false, // Pipeline mode owns blocker - don't auto-hide via sanity check
  _MAX_BLOCK_TIME: 5 * 60 * 1000, // 5 phút auto-timeout
  _SANITY_CHECK_INTERVAL: 30 * 1000, // 30 giây check 1 lần

  // Block tất cả events ở capture phase (triệt để hơn pointer-events)
  _blockEvent(e) {
    if (!ExecutionBlocker._blocking) return;

    // Cho phép programmatic events (từ extension) đi qua
    // isTrusted = true: event từ user action
    // isTrusted = false: event từ script (dispatchEvent, click(), etc.)
    if (!e.isTrusted) return;

    // Cho phép events trên FloatingTracker + banner manual (Skip button) + editor Flow (nhấn Enter) đi qua.
    if (e.target && e.target.closest && (
      e.target.closest('#seosonaflow-flow-tracker') ||
      e.target.closest('#seosonaflow-manual-enter-banner')
    )) return;

    // Escape hatch: nhấn Escape 3 lần liên tiếp trong 2 giây để force hide
    if (e.type === 'keydown' && e.key === 'Escape') {
      ExecutionBlocker._escapeCount++;
      clearTimeout(ExecutionBlocker._escapeTimer);
      ExecutionBlocker._escapeTimer = setTimeout(function() {
        ExecutionBlocker._escapeCount = 0;
      }, 2000);

      if (ExecutionBlocker._escapeCount >= 3) {
        console.warn('[ExecutionBlocker] Force hide via Escape x3');
        ExecutionBlocker._escapeCount = 0;
        ExecutionBlocker.hide();
        // Cũng reset execution state
        if (typeof isRunning !== 'undefined') isRunning = false;
        if (typeof isPaused !== 'undefined') isPaused = false;
        if (typeof shouldStop !== 'undefined') shouldStop = true;
        return; // Cho phép Escape cuối cùng đi qua
      }
    }

    e.stopPropagation();
    e.stopImmediatePropagation();
    e.preventDefault();
  },

  _injectStyles() {
    if (this._styleEl) return;
    var style = document.createElement('style');
    style.id = 'seosonaflow-execution-blocker-styles';
    // Performance optimized: dùng opacity animation thay vì box-shadow (GPU-accelerated)
    style.textContent = `
      @keyframes seosonaflow-glow-pulse {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 0.7; }
      }

      @keyframes seosonaflow-glow-paused {
        0%, 100% { opacity: 0.3; }
        50% { opacity: 0.5; }
      }

      #seosonaflow-execution-blocker {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        pointer-events: all;
        cursor: not-allowed;
        background: transparent;
      }

      /* Glow border via pseudo-element (GPU layer với will-change) */
      /* Multi-layer box-shadow simulate blur effect mà không dùng filter:blur (nhẹ hơn) */
      #seosonaflow-execution-blocker::before {
        content: '';
        position: absolute;
        inset: 0;
        border: 5px solid #3d6ff5;
        border-radius: 12px;
        box-shadow:
          inset 0 0 0 2px rgba(61, 111, 245,0.5),
          inset 0 0 8px rgba(61, 111, 245,0.3),
          0 0 8px rgba(61, 111, 245,0.4),
          0 0 20px rgba(61, 111, 245,0.25),
          0 0 40px rgba(61, 111, 245,0.15);
        animation: seosonaflow-glow-pulse 1.8s ease-in-out infinite;
        will-change: opacity;
        pointer-events: none;
      }

      /* Paused state - slower animation, yellow tint */
      #seosonaflow-execution-blocker.seosonaflow-paused::before {
        border-color: #facc15;
        box-shadow:
          inset 0 0 0 2px rgba(250,204,21,0.45),
          inset 0 0 6px rgba(250,204,21,0.25),
          0 0 6px rgba(250,204,21,0.35),
          0 0 15px rgba(250,204,21,0.2),
          0 0 30px rgba(250,204,21,0.1);
        animation: seosonaflow-glow-paused 3s ease-in-out infinite;
      }

      /* Force Flow context menus (Radix UI) unclickable when blocker active */
      body.seosonaflow-execution-blocking [data-radix-popper-content-wrapper],
      body.seosonaflow-execution-blocking [role="menu"][data-state="open"] {
        pointer-events: none !important;
      }
    `;
    document.head.appendChild(style);
    this._styleEl = style;
  },

  _attachBlockers() {
    if (this._blocking) return;
    this._blocking = true;
    // Block tất cả mouse events ở capture phase
    var events = ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'touchend', 'touchmove', 'keydown', 'keyup', 'keypress'];
    events.forEach(function(evt) {
      document.addEventListener(evt, ExecutionBlocker._blockEvent, { capture: true, passive: false });
    });
    // CSS class: force Radix menus pointer-events:none (chặn user click vào context menu)
    document.body.classList.add('seosonaflow-execution-blocking');
  },

  _detachBlockers() {
    if (!this._blocking) return;
    this._blocking = false;
    var events = ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel', 'touchstart', 'touchend', 'touchmove', 'keydown', 'keyup', 'keypress'];
    events.forEach(function(evt) {
      document.removeEventListener(evt, ExecutionBlocker._blockEvent, { capture: true });
    });
    document.body.classList.remove('seosonaflow-execution-blocking');
  },

  // Sanity check: nếu isRunning = false mà blocker vẫn hiện → hide
  // Skip auto-hide nếu Pipeline owns blocker (pq:showBlocker)
  _startSanityCheck() {
    var self = this;
    this._sanityIntervalId = setInterval(function() {
      // Guard context-invalidated (extension reload) → dừng interval mồ côi.
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) { try { clearInterval(self._sanityIntervalId); } catch (_) { globalThis.SEOSONA_swallow?.('content#_startSanityCheck', _); } return; }
      // Pipeline mode: không auto-hide, Pipeline sẽ gọi pq:hideBlocker khi xong
      if (self._pipelineOwned) return;
      if (typeof isRunning !== 'undefined' && !isRunning) {
        console.log('[ExecutionBlocker] Sanity check: isRunning=false, auto-hiding');
        self.hide();
      }
    }, this._SANITY_CHECK_INTERVAL);
  },

  _stopSanityCheck() {
    if (this._sanityIntervalId) {
      clearInterval(this._sanityIntervalId);
      this._sanityIntervalId = null;
    }
  },

  // Auto-timeout: tự hide sau _MAX_BLOCK_TIME
  _startTimeout() {
    var self = this;
    this._timeoutId = setTimeout(function() {
      console.warn('[ExecutionBlocker] Auto-timeout after ' + (self._MAX_BLOCK_TIME / 1000) + 's, force hiding');
      self.hide();
      // Reset execution state để tránh stuck
      if (typeof isRunning !== 'undefined') isRunning = false;
      if (typeof isPaused !== 'undefined') isPaused = false;
      if (typeof shouldStop !== 'undefined') shouldStop = true;
    }, this._MAX_BLOCK_TIME);
  },

  _stopTimeout() {
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }
  },

  // Visibility change: nếu tab ẩn quá 2 phút, cleanup
  _onVisibilityChange() {
    if (document.hidden && ExecutionBlocker._blocking) {
      // Tab bị ẩn, set timer để cleanup sau 2 phút
      ExecutionBlocker._visibilityTimeoutId = setTimeout(function() {
        if (document.hidden && ExecutionBlocker._blocking) {
          console.warn('[ExecutionBlocker] Tab hidden too long, auto-hiding + resetting state');
          ExecutionBlocker.hide();
          // Reset execution state để tránh stuck
          if (typeof isRunning !== 'undefined') isRunning = false;
          if (typeof isPaused !== 'undefined') isPaused = false;
          if (typeof shouldStop !== 'undefined') shouldStop = true;
        }
      }, 2 * 60 * 1000);
    } else {
      // Tab visible lại, cancel timer
      if (ExecutionBlocker._visibilityTimeoutId) {
        clearTimeout(ExecutionBlocker._visibilityTimeoutId);
        ExecutionBlocker._visibilityTimeoutId = null;
      }
    }
  },

  show(options) {
    options = options || {};
    this._injectStyles();

    // Chỉ start timers nếu chưa blocking (tránh restart timeout liên tục)
    var wasBlocking = this._blocking;
    this._attachBlockers();

    if (!wasBlocking) {
      // 2026-06-07: Skip 5-phút auto-timeout khi Pipeline owns blocker.
      // Pipeline 18+ prompts × Flow gen ~30-60s/prompt = 10-18 phút → vượt 300s safety.
      // Khi timeout fire → set shouldStop=true → clearEditor/insertText/clickSubmit
      // cho prompt sau bị ABORT (Aborted before start). Pipeline đã có stagnation
      // watchdog (60s no-claim → reload) + user force stop + tab visibility timeout (2 phút hidden)
      // làm safety nên 300s này dư thừa khi _pipelineOwned=true.
      // Legacy direct call (ExecutionBlocker.show từ submitPrompts) giữ nguyên 5 phút.
      if (!this._pipelineOwned) {
        this._startTimeout();
      }
      this._startSanityCheck();
      // Listen visibility change
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }

    // Manual Submit mode: nếu đang suspend (chờ user submit) → GIỮ overlay ẩn dù có show() (re-show
    // từ pq:showBlocker). Overlay z-index cao + pointer-events:all sẽ phủ banner Skip nếu hiện.
    if (this._el) {
      this._el.style.display = this._manualSuspended ? 'none' : 'block';
      return;
    }

    var el = document.createElement('div');
    el.id = 'seosonaflow-execution-blocker';
    if (this._manualSuspended) el.style.display = 'none';
    document.body.appendChild(el);
    this._el = el;
  },

  // Pause state - chuyển màu vàng, animation chậm hơn
  setPaused(paused) {
    if (!this._el) return;
    if (paused) {
      this._el.classList.add('seosonaflow-paused');
    } else {
      this._el.classList.remove('seosonaflow-paused');
    }
  },

  // update() - simplified, chỉ sync paused state
  // Giữ method để callers không bị crash
  update(options) {
    // No modal to update - border glow animation là đủ
    // Auto-sync với global isPaused
    if (typeof isPaused !== 'undefined') {
      this.setPaused(isPaused);
    }
  },

  hide() {
    this._detachBlockers();
    this._stopTimeout();
    this._stopSanityCheck();
    this._escapeCount = 0;
    this._pipelineOwned = false; // Reset pipeline ownership
    clearTimeout(this._escapeTimer);
    clearTimeout(this._visibilityTimeoutId);
    document.removeEventListener('visibilitychange', this._onVisibilityChange);

    if (this._el) {
      this._el.style.display = 'none';
      this._el.classList.remove('seosonaflow-paused');
    }

    // Universal safety net: blocker ẩn = pipeline kết thúc (xong / error / force-stop / runAutoPrompt
    // catch) → đảm bảo restore zoom, KHÔNG để Flow kẹt zoom nhỏ. Idempotent (no-op nếu không có session).
    try { _endZoomSession(); } catch (_) { globalThis.SEOSONA_swallow?.('content#hide', _); }
  },

  isVisible() {
    return this._el && this._el.style.display !== 'none';
  },

  // Manual Enter mode: TẠM ẨN blocker để user thao tác editor + nhấn Enter. KHÁC hide() —
  // GIỮ _pipelineOwned + timers + zoom session (chỉ tắt _blocking + ẩn overlay). resumeAfterManual
  // sẽ block lại khi user submit xong (monitor phase cần chặn interference).
  suspendForManual() {
    this._manualSuspended = true; // show() sẽ giữ overlay ẩn khi flag này bật (chống re-show phủ banner)
    this._wasBlockingBeforeManual = this._blocking;
    this._blocking = false;
    if (this._el) this._el.style.display = 'none';
  },
  // reblock=true CHỈ khi user đã submit (vào monitor phase cần chặn interference). Skip/abort/timeout
  // → reblock=false → overlay GIỮ ẩn (tránh kẹt sau skip / khi chờ prompt tiếp).
  resumeAfterManual(reblock) {
    this._manualSuspended = false;
    var was = this._wasBlockingBeforeManual;
    this._wasBlockingBeforeManual = false;
    if (!reblock) return; // skip/abort/timeout → KHÔNG re-show overlay
    // KHÔNG block lại nếu đang STOP (footer/tracker stop) — tránh re-show blocker sau khi stop đã hide().
    if (shouldStop || (typeof _manualWaitAbort !== 'undefined' && _manualWaitAbort)) return;
    // Chỉ block lại nếu pipeline VẪN owns blocker (chưa bị stop → hide() reset _pipelineOwned=false).
    if (was && this._pipelineOwned && this._el) {
      this._blocking = true;
      this._el.style.display = 'block';
    }
  }
};

// Debounce utility
function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// Helpers
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ───────────────────────────────────────────────────────────────────────
// Flow Voice Selector — scrape + select helpers
// Server-Only: dùng dynamic selectors từ provider_configs.dom_selector.
// ───────────────────────────────────────────────────────────────────────

/**
 * Set value cho React-controlled input (Slate / Radix search input).
 * React track value qua internal setter — gọi raw `el.value=` không trigger onChange.
 */
function _setReactInputValue(el, value) {
  if (!el) return;
  try {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) {
      setter.call(el, value);
    } else {
      el.value = value;
    }
    // React 17+ delegated events: composed:true để event cross shadow DOM nếu cần
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  } catch (e) {
    el.value = value;
  }
}

/**
 * Find tab button có icon material symbol text khớp iconText.
 * Reuse advanced_menu_voices_tab selector + icon_text từ server config.
 */
function _findTabByIconText(iconText) {
  if (!iconText) return null;

  // Strategy 1: dùng dynamic selector advanced_menu_voices_tab
  const cfg = _getDynamicSelector('advanced_menu_voices_tab');
  if (cfg?.selectors?.length) {
    for (const sel of cfg.selectors) {
      try {
        const candidates = document.querySelectorAll(sel);
        for (const btn of candidates) {
          // Bug fix: icon text NẰM TRONG btn.textContent của tab (i.google-symbols render text)
          // → KHÔNG dùng `!btn.textContent.includes(iconText)` filter (luôn false → dead code).
          // Đơn giản: query icon element + so sánh textContent === iconText.
          const icon = btn.querySelector('i.google-symbols, i[class*="symbol"]');
          if (icon && icon.textContent?.trim() === iconText) return btn;
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('content#_findTabByIconText', _); }
    }
  }

  // Strategy 2 fallback: generic tab buttons + filter by icon text
  const tabCfg = _getDynamicSelector('tab_button_generic');
  const tabSelectors = tabCfg?.selectors?.length ? tabCfg.selectors : ['button[role="tab"]'];
  for (const sel of tabSelectors) {
    try {
      const tabs = document.querySelectorAll(sel);
      for (const btn of tabs) {
        const icon = btn.querySelector('i.google-symbols, i[class*="symbol"]');
        if (icon && icon.textContent?.trim() === iconText) return btn;
      }
    } catch (_) { globalThis.SEOSONA_swallow?.('content#_findTabByIconText', _); }
  }
  return null;
}

/**
 * Open Flow advanced menu (click "+" button trên composer).
 * @returns {Promise<boolean>} true nếu menu mở thành công
 */
async function _openFlowAdvancedMenu() {
  const cfg = _getDynamicSelector('composer_advanced_menu_button');
  const iconText = cfg?.icon_text || 'add_2';

  // Find all buttons có icon "add_2" — chỉ click button trong composer scope (KHÔNG phải homepage "New project")
  const buttons = document.querySelectorAll('button');
  let target = null;
  for (const btn of buttons) {
    const icon = btn.querySelector('i.google-symbols, i[class*="symbol"]');
    if (!icon || icon.textContent?.trim() !== iconText) continue;
    // Filter scope composer: button phải gần composer/textbox (heuristic)
    const nearTextbox = btn.closest('form')?.querySelector('[role="textbox"], [contenteditable="true"]')
      || document.querySelector('[data-slate-editor="true"], [contenteditable="true"]')?.closest('form, [role="group"]')?.contains(btn);
    if (nearTextbox || btn.getAttribute('aria-haspopup') === 'dialog') {
      target = btn;
      break;
    }
  }
  // Fallback: lấy button đầu tiên có icon add_2 không phải link
  if (!target) {
    for (const btn of buttons) {
      const icon = btn.querySelector('i.google-symbols, i[class*="symbol"]');
      if (icon && icon.textContent?.trim() === iconText) {
        target = btn;
        break;
      }
    }
  }

  if (!target) {
    console.warn('[FlowVoice] composer_advanced_menu_button not found (icon_text=' + iconText + ')');
    return false;
  }

  target.click();

  // Wait for menu dialog mở
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const dialog = document.querySelector('[role="dialog"][data-state="open"], [role="dialog"]');
    if (dialog && dialog.querySelector('[role="tab"]')) return true;
    await sleep(80);
  }
  return false;
}

/**
 * Click tab Voices trong advanced menu (đã mở).
 * @returns {Promise<boolean>}
 */
async function _switchToVoicesTab() {
  const iconText = _getDynamicSelector('advanced_menu_voices_tab')?.icon_text || 'voice_selection';
  const tab = _findTabByIconText(iconText);
  if (!tab) {
    console.warn('[FlowVoice] advanced_menu_voices_tab not found');
    return false;
  }
  tab.click();
  await sleep(200);

  // Wait first option render
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (document.querySelector('[role="option"]')) return true;
    await sleep(80);
  }
  return false;
}

/**
 * Close advanced menu via Escape key.
 */
function _closeFlowAdvancedMenu() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
}

/**
 * Scrape TẤT CẢ voices trong menu Voices (base + custom).
 * Virtualization scroll: scroll cho đến khi 3 lần liên tiếp không thêm voice mới.
 * @returns {Promise<{success, voices?: Array<{name, description}>, error?}>}
 */
async function scrapeFlowVoices() {
  try {
    const opened = await _openFlowAdvancedMenu();
    if (!opened) {
      return { success: false, error: 'Could not open advanced menu (composer button not found or menu did not open)' };
    }

    const tabOk = await _switchToVoicesTab();
    if (!tabOk) {
      _closeFlowAdvancedMenu();
      return { success: false, error: 'Could not switch to Voices tab' };
    }

    // Find scroll container — usually parent của virtualization wrapper
    const firstOption = document.querySelector('[role="option"]');
    // Better scroll container detection: try Flow virtualization wrapper `[data-known-size]`
    // → walk up tìm element có overflow scroll thật sự (scrollHeight > clientHeight).
    let scrollContainer = null;
    const knownSizeEl = document.querySelector('[data-known-size]');
    if (knownSizeEl) {
      let el = knownSizeEl.parentElement;
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        if ((style.overflow === 'auto' || style.overflow === 'scroll' ||
             style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight) {
          scrollContainer = el;
          break;
        }
        el = el.parentElement;
      }
    }
    if (!scrollContainer && firstOption) {
      // Fallback: walk up từ option
      let el = firstOption.parentElement;
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight) {
          scrollContainer = el;
          break;
        }
        el = el.parentElement;
      }
    }
    console.log('[FlowVoice] scrollContainer:', scrollContainer?.tagName, scrollContainer?.className,
      'scrollHeight:', scrollContainer?.scrollHeight, 'clientHeight:', scrollContainer?.clientHeight);

    const nameSelCfg = _getDynamicSelector('advanced_menu_voice_name_div');
    const descSelCfg = _getDynamicSelector('advanced_menu_voice_description_div');
    const nameSelectors = nameSelCfg?.selectors?.length ? nameSelCfg.selectors : ['div > div:first-child'];
    const descSelectors = descSelCfg?.selectors?.length ? descSelCfg.selectors : ['div > div:nth-child(2)'];
    console.log('[FlowVoice] Using nameSelectors:', nameSelectors, 'descSelectors:', descSelectors);

    const collected = new Map();
    let stableScrolls = 0;
    const maxScrolls = 50; // tăng từ 30 → 50

    for (let i = 0; i < maxScrolls; i++) {
      const sizeBefore = collected.size;

      const options = document.querySelectorAll('[role="option"]');
      let voiceOptionsCount = 0;

      for (const opt of options) {
        const icon = opt.querySelector('i.google-symbols, i[class*="symbol"]');
        if (!icon || icon.textContent?.trim() !== 'voice_selection') continue;
        voiceOptionsCount++;

        // Strategy 1: CSS selectors từ server config (strict structure match)
        let name = '';
        let desc = '';
        for (const sel of nameSelectors) {
          try {
            const v = opt.querySelector(sel)?.textContent?.trim();
            // Validate: name không được chứa "voice_selection" (icon text leak) và không quá dài
            if (v && !v.includes('voice_selection') && v.length < 50) { name = v; break; }
          } catch (_) { globalThis.SEOSONA_swallow?.('content#scrapeFlowVoices', _); }
        }
        for (const sel of descSelectors) {
          try {
            const v = opt.querySelector(sel)?.textContent?.trim();
            if (v && !v.includes('voice_selection')) { desc = v; break; }
          } catch (_) { globalThis.SEOSONA_swallow?.('content#scrapeFlowVoices', _); }
        }

        // Strategy 2 fallback: icon anchor — KHÔNG phụ thuộc CSS class.
        // Tìm direct child div của opt KHÔNG chứa icon → đó là info container → text divs bên trong.
        if (!name) {
          const directChildren = Array.from(opt.children).filter(c => c.tagName === 'DIV');
          const iconContainer = directChildren.find(d => d.contains(icon));
          const infoContainer = directChildren.find(d => d !== iconContainer && d.textContent?.trim());
          if (infoContainer) {
            // Lấy LEAF divs (không có div con) có text — đây là name + desc
            const leafDivs = Array.from(infoContainer.querySelectorAll('div'))
              .filter(d => !d.querySelector('div') && d.textContent?.trim());
            if (leafDivs.length > 0) {
              name = leafDivs[0].textContent.trim();
              desc = leafDivs[1]?.textContent?.trim() || '';
            } else {
              // Fallback cuối: lấy text node trực tiếp của infoContainer
              name = infoContainer.textContent?.trim() || '';
            }
          }
        }

        if (name && !collected.has(name)) {
          collected.set(name, { name, description: desc || null });
        }
      }

      const sizeAfter = collected.size;
      console.log(`[FlowVoice] Iter ${i}: ${options.length} role=option, ${voiceOptionsCount} voice icons, collected ${sizeAfter} (delta ${sizeAfter - sizeBefore})`);

      if (sizeAfter === sizeBefore) {
        stableScrolls++;
        if (stableScrolls >= 5) {
          console.log(`[FlowVoice] Stable for 5 iterations, stopping scroll`);
          break;
        }
      } else {
        stableScrolls = 0;
      }

      // Scroll down — increase step + use scrollIntoView fallback nếu container chưa scroll
      try {
        if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight + scrollContainer.scrollTop) {
          scrollContainer.scrollTop += 300;
        } else if (options.length > 0) {
          // Scroll last option vào view (virtualization sẽ render thêm)
          options[options.length - 1].scrollIntoView({ block: 'end', behavior: 'instant' });
        }
      } catch (e) {
        console.warn('[FlowVoice] Scroll error:', e.message);
      }

      await sleep(300); // tăng wait từ 180ms → 300ms cho virtualization render
    }

    _closeFlowAdvancedMenu();

    const voices = Array.from(collected.values());
    console.log(`[FlowVoice] Scraped ${voices.length} voices:`, voices.map(v => v.name).join(', '));
    return { success: true, voices };
  } catch (err) {
    console.error('[FlowVoice] scrapeFlowVoices error:', err);
    try { _closeFlowAdvancedMenu(); } catch (_) { globalThis.SEOSONA_swallow?.('content#scrapeFlowVoices', _); }
    return { success: false, error: err.message };
  }
}

/**
 * 2026-05-30: Remove TẤT CẢ voice button đang selected trong prompt editor area.
 * Pattern giống remove ref_img — click vào button voice = React handler remove voice state.
 *
 * Strict server-only: đọc config từ `provider_configs.dom_selector.prompt_selected_voice_button`:
 *   - selectors: CSS selector pattern (vd "button:has(> i.google-symbols)")
 *   - icon_text: text content của direct child icon (vd "voice_selection")
 * Caller filter button có direct child <i> match icon_text → tránh false positive icon nested khác.
 *
 * DOM structure (verified data/dom/flow-voice-selected-dom.html):
 *   <button aria-label="<voice_name>">
 *     <div>...<i class="google-symbols">cancel</i></div>  ← icon hover overlay (cancel — nested)
 *     <i class="google-symbols">voice_selection</i>        ← icon main (direct child)
 *   </button>
 *
 * Loop với safety counter — mỗi click → React re-render → DOM update → loop tiếp tới khi 0.
 *
 * @returns {Promise<number>} Số voices đã remove
 */
async function _removeAllSelectedFlowVoices() {
  const MAX_ITER = 10; // Safety: KHÔNG ai có > 10 voices selected cùng lúc
  let totalRemoved = 0;

  const cfg = _getDynamicSelector('prompt_selected_voice_button');
  if (!cfg) {
    console.warn('[FlowVoice] prompt_selected_voice_button config missing — skip voice cleanup');
    return 0;
  }
  const selectors = cfg.selectors?.length ? cfg.selectors : [];
  const iconText = cfg.icon_text || null;

  if (!selectors.length || !iconText) {
    console.warn('[FlowVoice] prompt_selected_voice_button config incomplete (selectors/icon_text missing) — skip');
    return 0;
  }

  for (let i = 0; i < MAX_ITER; i++) {
    // Step 1: Query candidate buttons qua dynamic selectors
    const candidates = [];
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach(btn => {
          if (!candidates.includes(btn)) candidates.push(btn);
        });
      } catch (_) { /* invalid selector */ }
    }

    // Step 2: Filter button có DIRECT child <i> với text === iconText (exact match)
    // → Loại trừ button có icon 'voice_selection' nested trong wrapper khác (vd cancel icon).
    const voiceButtons = candidates.filter(btn => {
      const directChildren = Array.from(btn.children);
      return directChildren.some(child => {
        if (child.tagName !== 'I') return false;
        return child.textContent?.trim() === iconText;
      });
    });

    if (voiceButtons.length === 0) break;

    console.log(`[FlowVoice] _removeAllSelectedFlowVoices iter ${i}: ${voiceButtons.length} voice button(s) found`);
    try {
      voiceButtons[0].click();
      totalRemoved++;
    } catch (e) {
      console.warn('[FlowVoice] Click voice remove button failed:', e.message);
      break;
    }
    await sleep(200); // Wait React re-render trước iter sau
  }

  return totalRemoved;
}

/**
 * Click chọn 1 voice trong menu (submit pipeline flow).
 * @param {{slug, search_value}} voicePayload
 * @returns {Promise<{success, error?}>}
 */
async function selectFlowVoice(voicePayload) {
  if (!voicePayload?.search_value) {
    return { success: true, skipped: true }; // không có voice → skip
  }

  try {
    console.log(`[FlowVoice] selectFlowVoice START — search_value="${voicePayload.search_value}"`);

    // 2026-05-30: Cleanup trước khi select voice mới — tránh tích lũy voices từ run trước.
    // Editor text + voice buttons persist qua các submits (Flow React state).
    // Pattern giống remove ref_img: query selected voice buttons + click từng cái để remove.
    // Editor clear trước → reset text leftover (clearEditor pipeline gọi sau, nhưng làm sớm để menu mở fresh).
    try {
      const editorEl = document.querySelector('[data-slate-editor="true"]');
      if (editorEl) {
        await clearEditor(editorEl);
        console.log('[FlowVoice] ✓ Cleared editor text trước select voice');
      }
    } catch (e) {
      console.warn('[FlowVoice] clearEditor failed (non-blocking):', e.message);
    }

    const removedCount = await _removeAllSelectedFlowVoices();
    if (removedCount > 0) {
      console.log(`[FlowVoice] ✓ Removed ${removedCount} pre-existing voice(s)`);
    }

    const opened = await _openFlowAdvancedMenu();
    if (!opened) {
      console.warn('[FlowVoice] Could not open advanced menu');
      return { success: false, error: 'Could not open advanced menu' };
    }
    console.log('[FlowVoice] ✓ Menu opened');

    const tabOk = await _switchToVoicesTab();
    if (!tabOk) {
      console.warn('[FlowVoice] Could not switch to Voices tab');
      _closeFlowAdvancedMenu();
      return { success: false, error: 'Could not switch to Voices tab' };
    }
    console.log('[FlowVoice] ✓ Switched to Voices tab');

    // NOTE: Flow search input KHÔNG filter list (verified 2026-05-30 log) — chỉ visual update,
    // không trigger React filter logic. Skip step search, dùng trực tiếp scroll loop bên dưới
    // để load full virtualized list. Tiết kiệm 500ms debounce.

    // Helper: extract name từ option element (reuse logic scrape function)
    const nameSelCfg = _getDynamicSelector('advanced_menu_voice_name_div');
    const nameSelectors = nameSelCfg?.selectors?.length ? nameSelCfg.selectors : ['div > div:first-child'];

    const extractOptName = (opt) => {
      const icon = opt.querySelector('i.google-symbols, i[class*="symbol"]');
      if (!icon || icon.textContent?.trim() !== 'voice_selection') return '';

      // Strategy 1: CSS selectors
      for (const sel of nameSelectors) {
        try {
          const v = opt.querySelector(sel)?.textContent?.trim();
          if (v && !v.includes('voice_selection') && v.length < 50) return v;
        } catch (_) { globalThis.SEOSONA_swallow?.('content#extractOptName', _); }
      }
      // Strategy 2: icon anchor fallback
      const directChildren = Array.from(opt.children).filter(c => c.tagName === 'DIV');
      const iconContainer = directChildren.find(d => d.contains(icon));
      const infoContainer = directChildren.find(d => d !== iconContainer && d.textContent?.trim());
      if (infoContainer) {
        const leafDivs = Array.from(infoContainer.querySelectorAll('div'))
          .filter(d => !d.querySelector('div') && d.textContent?.trim());
        if (leafDivs.length > 0) return leafDivs[0].textContent.trim();
      }
      return '';
    };

    // Find option match by name === search_value — với scroll fallback (giống scrape)
    const targetName = voicePayload.search_value;
    let target = null;
    let scrollContainer = null;

    // Detect scroll container như scrape function
    const firstOpt = document.querySelector('[role="option"]');
    if (firstOpt) {
      let el = firstOpt.parentElement;
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
          scrollContainer = el;
          break;
        }
        el = el.parentElement;
      }
    }

    const maxScrolls = 30;
    for (let i = 0; i < maxScrolls; i++) {
      const options = document.querySelectorAll('[role="option"]');
      const visibleNames = [];
      for (const opt of options) {
        const name = extractOptName(opt);
        if (!name) continue;
        visibleNames.push(name);
        if (name === targetName) {
          target = opt;
          break;
        }
      }
      console.log(`[FlowVoice] Search iter ${i}: ${options.length} options, ${visibleNames.length} voice names: [${visibleNames.slice(0, 8).join(', ')}${visibleNames.length > 8 ? '...' : ''}], target found: ${!!target}`);
      if (target) break;

      // Scroll down để load thêm options (virtualization)
      try {
        if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight + scrollContainer.scrollTop) {
          scrollContainer.scrollTop += 300;
        } else if (options.length > 0) {
          options[options.length - 1].scrollIntoView({ block: 'end', behavior: 'instant' });
        } else {
          break; // không có option nào → menu rỗng
        }
      } catch (e) {
        console.warn('[FlowVoice] Scroll error:', e.message);
        break;
      }
      await sleep(250);
    }

    if (!target) {
      console.warn(`[FlowVoice] Voice "${voicePayload.search_value}" not found in menu after scroll`);
      _closeFlowAdvancedMenu();
      return { success: false, error: 'voice_not_found', name: voicePayload.search_value };
    }

    // Scroll target into view trước khi click (tránh click outside viewport fail)
    try { target.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) { globalThis.SEOSONA_swallow?.('content#extractOptName', _); }
    await sleep(150);
    console.log(`[FlowVoice] ✓ Clicking voice option: "${voicePayload.search_value}"`);

    target.click();
    await sleep(400); // wait preview card render với button "Thêm vào câu lệnh"

    // Strategy 1: Click button "Thêm vào câu lệnh" / "Add To Prompt" để APPLY voice
    const applied = await _clickAddToPromptButton();
    if (applied) {
      await sleep(300); // wait menu close + voice applied to prompt
      return { success: true, selected: voicePayload.search_value, strategy: 'add_to_prompt_button' };
    }

    // Strategy 2 fallback: button không tìm thấy → click VÀO LẠI voice option (double-click behavior).
    // Flow UX: 1st click = preview, 2nd click = apply + close menu (verified behavior).
    console.warn('[FlowVoice] "Add To Prompt" button not found — fallback double-click voice option');

    // Re-find target option (có thể DOM đã render lại sau click 1)
    const reFindTarget = () => {
      const opts = document.querySelectorAll('[role="option"]');
      for (const opt of opts) {
        const name = extractOptName(opt);
        if (name === targetName) return opt;
      }
      return null;
    };

    let target2 = reFindTarget();
    if (!target2) {
      // Option có thể đã được hide sau preview → re-scroll + tìm lại
      await sleep(200);
      target2 = reFindTarget();
    }

    if (target2) {
      try { target2.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) { globalThis.SEOSONA_swallow?.('content#reFindTarget', _); }
      await sleep(100);
      console.log(`[FlowVoice] Fallback: clicking voice option AGAIN (double-click) — "${voicePayload.search_value}"`);
      target2.click();
      await sleep(500); // wait apply + menu close

      // Verify menu đã đóng → success heuristic
      const menuOpen = !!document.querySelector('[role="dialog"][data-state="open"] [role="tab"]');
      if (!menuOpen) {
        console.log('[FlowVoice] ✓ Fallback succeeded — menu closed after double-click');
        return { success: true, selected: voicePayload.search_value, strategy: 'double_click_fallback' };
      }
      // Menu vẫn open — đóng thủ công + báo fail
      _closeFlowAdvancedMenu();
      console.warn('[FlowVoice] Fallback double-click did NOT close menu — voice may not be applied');
      return { success: false, error: 'fallback_double_click_failed' };
    }

    _closeFlowAdvancedMenu();
    return { success: false, error: 'add_to_prompt_button_not_found' };
  } catch (err) {
    console.error('[FlowVoice] selectFlowVoice error:', err);
    try { _closeFlowAdvancedMenu(); } catch (_) { globalThis.SEOSONA_swallow?.('content#reFindTarget', _); }
    return { success: false, error: err.message };
  }
}

/**
 * Click button "Thêm vào câu lệnh" / "Add To Prompt" trong advanced menu voice preview card.
 * Voice menu Flow pattern 2 bước: (1) click option = preview, (2) click button = apply + close.
 */
async function _clickAddToPromptButton() {
  const cfg = _getDynamicSelector('advanced_menu_add_to_prompt_button');
  const buttonTexts = cfg?.button_text?.length
    ? cfg.button_text
    : ['Thêm vào câu lệnh', 'Add To Prompt', 'Add to prompt'];

  // Wait button xuất hiện (preview card render sau click option)
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent?.trim() || '';
      // Match: textContent CHỨA (không equal vì có thể có overlay div text "")
      for (const target of buttonTexts) {
        if (text === target || text.startsWith(target)) {
          // Verify button visible + not disabled
          if (btn.disabled) continue;
          const rect = btn.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          console.log(`[FlowVoice] Clicking "Add To Prompt" button: text="${text}"`);
          btn.click();
          return true;
        }
      }
    }
    await sleep(150);
  }

  console.warn('[FlowVoice] _clickAddToPromptButton timeout — no matching button found');
  return false;
}

// ─── Flow Character Selector (Nhân vật) ───────────────────────────────────────
// Clone pipeline voice nhưng tab "Nhân vật" (icon accessibility_new) + option detect bằng
// <img> avatar (KHÔNG icon voice_selection) + name positional. Tái dùng _openFlowAdvancedMenu,
// _findTabByIconText, _closeFlowAdvancedMenu, _clickAddToPromptButton.

/** Click tab Nhân vật trong advanced menu (đã mở). @returns {Promise<boolean>} */
async function _switchToCharactersTab() {
  const iconText = _getDynamicSelector('advanced_menu_characters_tab')?.icon_text || 'accessibility_new';
  const tab = _findTabByIconText(iconText);
  if (!tab) {
    console.warn('[FlowCharacter] advanced_menu_characters_tab not found');
    return false;
  }
  tab.click();
  await sleep(200);
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    if (document.querySelector('[role="option"]')) return true;
    await sleep(80);
  }
  return false;
}

/** Extract {name, thumbnail} từ 1 character option (có <img> avatar). null nếu không phải character. */
function _extractCharOption(opt, nameSelectors) {
  const img = opt.querySelector('img');
  if (!img) return null; // character option BẮT BUỘC có avatar — phân biệt option khác
  let name = '';
  for (const sel of (nameSelectors || [])) {
    try {
      const v = opt.querySelector(sel)?.textContent?.trim();
      if (v && v.length < 80) { name = v; break; }
    } catch (_) { globalThis.SEOSONA_swallow?.('content#_extractCharOption', _); }
  }
  if (!name) {
    // Fallback: text trực tiếp option (img không có textContent nên an toàn)
    name = (opt.textContent || '').trim();
  }
  if (!name || name.length >= 80) return null;
  let thumb = img.getAttribute('src') || '';
  if (thumb && thumb.startsWith('/')) thumb = 'https://labs.google' + thumb; // relative → full URL
  return { name, thumbnail: thumb || null };
}

/**
 * Scrape TẤT CẢ nhân vật trong tab Nhân vật (local của user). Virtualization scroll.
 * @returns {Promise<{success, characters?: Array<{name, thumbnail}>, error?}>}
 */
async function scrapeFlowCharacters() {
  try {
    const opened = await _openFlowAdvancedMenu();
    if (!opened) {
      return { success: false, error: 'Could not open advanced menu' };
    }
    const tabOk = await _switchToCharactersTab();
    if (!tabOk) {
      _closeFlowAdvancedMenu();
      return { success: false, error: 'Could not switch to Characters tab' };
    }

    // Detect scroll container (giống scrapeFlowVoices — walk-up tìm overflow scroll)
    const firstOption = document.querySelector('[role="option"]');
    let scrollContainer = null;
    const knownSizeEl = document.querySelector('[data-known-size]');
    if (knownSizeEl) {
      let el = knownSizeEl.parentElement;
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        if ((style.overflow === 'auto' || style.overflow === 'scroll' ||
             style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight) { scrollContainer = el; break; }
        el = el.parentElement;
      }
    }
    if (!scrollContainer && firstOption) {
      let el = firstOption.parentElement;
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') &&
            el.scrollHeight > el.clientHeight) { scrollContainer = el; break; }
        el = el.parentElement;
      }
    }

    const nameSelCfg = _getDynamicSelector('advanced_menu_character_name_div');
    const nameSelectors = nameSelCfg?.selectors?.length ? nameSelCfg.selectors : [':scope > div:nth-child(2)'];

    const collected = new Map();
    let stableScrolls = 0;
    const maxScrolls = 50;

    for (let i = 0; i < maxScrolls; i++) {
      const sizeBefore = collected.size;
      const options = document.querySelectorAll('[role="option"]');
      for (const opt of options) {
        const info = _extractCharOption(opt, nameSelectors);
        if (info && !collected.has(info.name)) collected.set(info.name, info);
      }
      const sizeAfter = collected.size;
      console.log(`[FlowCharacter] Iter ${i}: ${options.length} option, collected ${sizeAfter} (delta ${sizeAfter - sizeBefore})`);

      if (sizeAfter === sizeBefore) {
        stableScrolls++;
        if (stableScrolls >= 5) break;
      } else {
        stableScrolls = 0;
      }

      try {
        if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight + scrollContainer.scrollTop) {
          scrollContainer.scrollTop += 300;
        } else if (options.length > 0) {
          options[options.length - 1].scrollIntoView({ block: 'end', behavior: 'instant' });
        }
      } catch (e) {
        console.warn('[FlowCharacter] Scroll error:', e.message);
      }
      await sleep(300);
    }

    _closeFlowAdvancedMenu();
    const characters = Array.from(collected.values());
    console.log(`[FlowCharacter] Scraped ${characters.length} characters:`, characters.map(c => c.name).join(', '));
    return { success: true, characters };
  } catch (err) {
    console.error('[FlowCharacter] scrapeFlowCharacters error:', err);
    try { _closeFlowAdvancedMenu(); } catch (_) { globalThis.SEOSONA_swallow?.('content#scrapeFlowCharacters', _); }
    return { success: false, error: err.message };
  }
}

/** Remove TẤT CẢ character button đang selected trong prompt editor (clone _removeAllSelectedFlowVoices). */
async function _removeAllSelectedFlowCharacters() {
  const MAX_ITER = 10;
  let totalRemoved = 0;

  const cfg = _getDynamicSelector('prompt_selected_character_button');
  if (!cfg) {
    console.warn('[FlowCharacter] prompt_selected_character_button config missing — skip cleanup');
    return 0;
  }
  const selectors = cfg.selectors?.length ? cfg.selectors : [];
  const iconText = cfg.icon_text || null;
  if (!selectors.length || !iconText) {
    console.warn('[FlowCharacter] prompt_selected_character_button config incomplete — skip');
    return 0;
  }

  for (let i = 0; i < MAX_ITER; i++) {
    const candidates = [];
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach(btn => { if (!candidates.includes(btn)) candidates.push(btn); });
      } catch (_) { globalThis.SEOSONA_swallow?.('content#_removeAllSelectedFlowCharacters', _); }
    }
    // Phân biệt CHIP nhân vật (trong câu lệnh) vs nút FILTER "Nhân vật" ở sidebar media-library.
    // CẢ HAI cùng match `button:has(> i.google-symbols)` + direct-child <i>accessibility_new</i>
    // (xác nhận DOM thật 2026-06-25). Nút sidebar click → đổi media panel → vỡ addRefImages.
    // Khác biệt: CHIP có <img> avatar nhân vật; nút sidebar chỉ có <i> + sr-only <span>.
    const charButtons = candidates.filter(btn => {
      const hasDirectIcon = Array.from(btn.children).some(
        child => child.tagName === 'I' && child.textContent?.trim() === iconText);
      return hasDirectIcon && !!btn.querySelector('img');
    });
    if (charButtons.length === 0) break;
    try {
      charButtons[0].click();
      totalRemoved++;
    } catch (e) {
      console.warn('[FlowCharacter] Click character remove button failed:', e.message);
      break;
    }
    await sleep(200);
  }
  return totalRemoved;
}

/**
 * Chọn 1 nhân vật trong menu (submit pipeline). Clone selectFlowVoice.
 * @param {{slug, search_value}} characterPayload
 * @returns {Promise<{success, error?}>}
 */
async function selectFlowCharacter(characterPayload) {
  if (!characterPayload?.search_value) {
    return { success: true, skipped: true };
  }
  try {
    console.log(`[FlowCharacter] selectFlowCharacter START — search_value="${characterPayload.search_value}"`);

    // Cleanup character đã chọn trước (KHÔNG clear editor text — character + voice + prompt độc lập,
    // clearEditor sẽ do pipeline gọi riêng. Character apply ở Step 1.6 cạnh voice, trước insertText).
    const removedCount = await _removeAllSelectedFlowCharacters();
    if (removedCount > 0) console.log(`[FlowCharacter] ✓ Removed ${removedCount} pre-existing character(s)`);

    const opened = await _openFlowAdvancedMenu();
    if (!opened) return { success: false, error: 'Could not open advanced menu' };

    const tabOk = await _switchToCharactersTab();
    if (!tabOk) {
      _closeFlowAdvancedMenu();
      return { success: false, error: 'Could not switch to Characters tab' };
    }

    const nameSelCfg = _getDynamicSelector('advanced_menu_character_name_div');
    const nameSelectors = nameSelCfg?.selectors?.length ? nameSelCfg.selectors : [':scope > div:nth-child(2)'];
    const extractName = (opt) => {
      const info = _extractCharOption(opt, nameSelectors);
      return info ? info.name : '';
    };

    const targetName = characterPayload.search_value;
    let target = null;
    let scrollContainer = null;
    const firstOpt = document.querySelector('[role="option"]');
    if (firstOpt) {
      let el = firstOpt.parentElement;
      while (el && el !== document.body) {
        const style = window.getComputedStyle(el);
        if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
          scrollContainer = el; break;
        }
        el = el.parentElement;
      }
    }

    const maxScrolls = 30;
    for (let i = 0; i < maxScrolls; i++) {
      const options = document.querySelectorAll('[role="option"]');
      for (const opt of options) {
        if (extractName(opt) === targetName) { target = opt; break; }
      }
      if (target) break;
      try {
        if (scrollContainer && scrollContainer.scrollHeight > scrollContainer.clientHeight + scrollContainer.scrollTop) {
          scrollContainer.scrollTop += 300;
        } else if (options.length > 0) {
          options[options.length - 1].scrollIntoView({ block: 'end', behavior: 'instant' });
        } else { break; }
      } catch (e) {
        console.warn('[FlowCharacter] Scroll error:', e.message);
        break;
      }
      await sleep(250);
    }

    if (!target) {
      console.warn(`[FlowCharacter] Character "${characterPayload.search_value}" not found after scroll`);
      _closeFlowAdvancedMenu();
      return { success: false, error: 'character_not_found', name: characterPayload.search_value };
    }

    try { target.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) { globalThis.SEOSONA_swallow?.('content#extractName', _); }
    await sleep(150);
    target.click();
    await sleep(400);

    // Strategy 1: "Thêm vào câu lệnh" button (tái dùng helper voice — cùng button)
    const applied = await _clickAddToPromptButton();
    if (applied) {
      await sleep(300);
      return { success: true, selected: characterPayload.search_value, strategy: 'add_to_prompt_button' };
    }

    // Strategy 2: double-click fallback
    console.warn('[FlowCharacter] "Add To Prompt" button not found — fallback double-click');
    const reFind = () => {
      const opts = document.querySelectorAll('[role="option"]');
      for (const opt of opts) { if (extractName(opt) === targetName) return opt; }
      return null;
    };
    let target2 = reFind();
    if (!target2) { await sleep(200); target2 = reFind(); }
    if (target2) {
      try { target2.scrollIntoView({ block: 'center', behavior: 'instant' }); } catch (_) { globalThis.SEOSONA_swallow?.('content#reFind', _); }
      await sleep(100);
      target2.click();
      await sleep(500);
      const menuOpen = !!document.querySelector('[role="dialog"][data-state="open"] [role="tab"]');
      if (!menuOpen) return { success: true, selected: characterPayload.search_value, strategy: 'double_click_fallback' };
      _closeFlowAdvancedMenu();
      return { success: false, error: 'fallback_double_click_failed' };
    }
    _closeFlowAdvancedMenu();
    return { success: false, error: 'add_to_prompt_button_not_found' };
  } catch (err) {
    console.error('[FlowCharacter] selectFlowCharacter error:', err);
    try { _closeFlowAdvancedMenu(); } catch (_) { globalThis.SEOSONA_swallow?.('content#reFind', _); }
    return { success: false, error: err.message };
  }
}

// Increment daily stat counter (persist to chrome.storage for settings-popup display)
// Serialize qua promise chain để tránh race condition khi multiple increments
// fire concurrent — chrome.storage.local.get/set KHÔNG atomic, race window khiến counter mất count.
var _statQueue = Promise.resolve();
function _incrementDailyStat(key) {
  _statQueue = _statQueue.then(async () => {
    // Guard context-invalidated (extension reload) → chrome.storage undefined.
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) return;
    const today = new Date().toISOString().slice(0, 10);
    const currentUserId = window.authManager?.user?.id || null;
    const res = await new Promise(resolve => chrome.storage.local.get(['af_daily_stats'], resolve));
    const stats = res.af_daily_stats || {};
    // Reset if new day OR different user
    if (stats._date !== today || stats._user_id !== currentUserId) {
      stats._date = today;
      stats._user_id = currentUserId;
      // Provider-specific prompts
      stats.flow_prompt_total = 0;
      stats.chatgpt_prompt_total = 0;
      stats.gemini_prompt_total = 0;
      stats.grok_prompt_total = 0;
      // Provider-specific failures
      stats.flow_fail = 0;
      stats.chatgpt_fail = 0;
      stats.gemini_fail = 0;
      stats.grok_fail = 0;
      // Common stats
      stats.task_run = 0;
      stats.workflow_run = 0;
      stats.angles_run = 0;
      // FAR-1 telemetry — refresh success/fail counters
      stats.flow_refresh_success = 0;
      stats.flow_refresh_fail = 0;
    }
    stats[key] = (stats[key] || 0) + 1;
    await new Promise(resolve => chrome.storage.local.set({ af_daily_stats: stats }, resolve));
  }).catch(err => {
    console.warn('[content.js] _incrementDailyStat error:', err.message);
  });
}

function getInputTimeoutMs() {
  // [Fix] Priority: 1. Payload cache (runtime) → 2. Storage cache → 3. Default
  if (typeof _cachedInputTimeoutMs === 'number' && _cachedInputTimeoutMs > 0) {
    return _cachedInputTimeoutMs;
  }
  // Fallback: dùng cached settings từ chrome.storage
  return window._afSettings?.inputTimeout || 1200;
}

// Derived delays từ inputTimeout — không cần settings riêng
function getClearEditorDelay() {
  return Math.round(getInputTimeoutMs() * 0.4); // ~500ms khi 1200
}

function getSubmitDelay() {
  return Math.round(getInputTimeoutMs() * 0.5); // ~600ms khi 1200
}

function getAfterSubmitDelay() {
  return Math.round(getInputTimeoutMs() * 0.8); // ~960ms khi 1200
}

function getSettingsStepDelay() {
  return Math.round(getInputTimeoutMs() * 0.3); // ~360ms khi 1200 — delay giữa các bước trong settings panel
}

function getDelayBetweenPromptsMs() {
  // Priority: 1. Payload cache (runtime) → 2. Server execution config → 3. Default
  if (typeof _cachedDelayBetweenMs === 'number' && _cachedDelayBetweenMs > 0) {
    return _cachedDelayBetweenMs;
  }
  // Read from server-controlled execution config
  const seconds = window._afExecConfig?.timing?.delay_between_prompts_sec || 5;
  return seconds * 1000;
}

function getRandomDelay() {
  // [Fix] Dùng cached settings từ chrome.storage thay vì đọc DOM
  const min = (window._afSettings?.randomDelayMin || 3) * 1000;
  const max = (window._afSettings?.randomDelayMax || 10) * 1000;
  return min + Math.random() * (max - min);
}

// ─── Selector logging ─────────────────────────────────────────
// Production: silent. Bật khi debug bằng cách set `window._afDebug = true` trong DevTools.
// Lý do: log có thể spam khi gen call dày → noise. Dev-mode opt-in là balance hợp lý.
function _isLogSelectorsEnabled() {
  return !!(typeof window !== 'undefined' && window._afDebug);
}

/**
 * Log unified format cho mọi selector function multi-tier.
 * Format: [Selector] {name} → tier {N} ({tierName}) = {found|null}
 * Vd: [Selector] getSubmitButton → tier 1 (icon) = found
 * Bật log: `window._afDebug = true` trong DevTools.
 * @param {string} name - Tên function (vd 'getSubmitButton')
 * @param {number|string} tier - Số thứ tự tier (1,2,3,...) hoặc 'fallback'
 * @param {string} tierName - Tên tier (vd 'icon', 'aria-haspopup', 'previousElementSibling')
 * @param {*} result - Element tìm được hoặc null
 */
function _logSelectorPick(name, tier, tierName, result) {
  if (!_isLogSelectorsEnabled()) return;
  const status = result ? 'found' : 'null';
  console.log(`[Selector] ${name} → tier ${tier} (${tierName}) = ${status}`);
}

/**
 * Tìm MAIN Slate editor trên Flow page (không phải search box hoặc editor phụ).
 * Disambiguation strategy (5 markers, đọc selectors + icon_text patterns từ backend):
 *   - Marker 1: editor có placeholder annotation bên trong
 *   - Marker 2: container có icon element với text match icon_text patterns
 *   - Marker 3: container có button id prefix theo radix_button_id_prefix config
 *   - Marker 4: container có settings button (selector key settings_button)
 *   - Marker 5: container có add/upload button (selector key add_button)
 * Fallback: nếu không marker nào match → lấy editor cuối cùng (main thường render sau search box).
 */
function getEditor() {
  const _sSel = _getSlateEditorSelectorString();
  const allEditors = _sSel ? document.querySelectorAll(_sSel) : [];

  for (const ed of allEditors) {
    // Marker 1: editor self có placeholder annotation
    const hasPlaceholder = !!ed.querySelector('[data-slate-placeholder]');

    // Markers 2-5: search trong container (đi lên tối đa 5 level)
    let container = ed;
    let containerHit = false;
    for (let i = 0; i < 5 && container; i++) {
      container = container.parentElement;
      if (!container) break;

      // Server-Only: query icons qua server config + derive icon text patterns
      // từ submit_button.icon_text + settings_button.icon_text (đã có config). 'add_2' giữ inline
      // vì là Material Symbol identifier cho ⊕ upload button — chưa có dedicated key.
      const iconsInContainer = _findIconsInElement(container);
      const submitIconText = _getDynamicSelector('submit_button')?.icon_text;
      const settingsIconText = _getDynamicSelector('settings_button')?.icon_text;
      const hasIcon = iconsInContainer.some(ic => {
        const t = ic.textContent.trim();
        if (submitIconText && t === submitIconText) return true;                    // 'arrow_forward'
        if (settingsIconText && t.startsWith(settingsIconText)) return true;        // 'crop_'
        return /^add_2/.test(t); // 'add_2' Material Symbol — upload button marker
      });
      const hasRadixBtn = !!_q('settings_button', container);
      const _stCfg = _getDynamicSelector('settings_button');
      const _menuSel = _stCfg?.selectors?.[0];
      const hasMenuBtn = !!(_menuSel && container.querySelector(_menuSel));
      const hasDialogBtn = !!container.querySelector('button[aria-haspopup="dialog"]');

      if (hasIcon || hasRadixBtn || hasMenuBtn || hasDialogBtn) {
        containerHit = true;
        break;
      }
    }

    if (hasPlaceholder || containerHit) {
      _logSelectorPick('getEditor', 1, hasPlaceholder ? 'placeholder' : 'container-marker', ed);
      return ed;
    }
  }

  // Fallback: editor cuối cùng (main thường render sau search box, sau onboarding hint, ...)
  if (allEditors.length > 0) {
    const last = allEditors[allEditors.length - 1];
    _logSelectorPick('getEditor', 'fallback', 'last-of-list', last);
    return last;
  }

  _logSelectorPick('getEditor', 'fail', 'no-slate-editor', null);
  return null;
}

/**
 * Tìm nút Settings (button mở popup model/ratio/quantity) trên Flow page.
 * RESILIENCE — 4 tier fallback:
 *   • Tier 1 (ARIA + icon, primary): button[aria-haspopup="menu"] chứa <i.google-symbols> bắt đầu "crop_"
 *     → Robust nhất: ARIA standard + Material icon name
 *   • Tier 2 (Radix prefix + icon): button[id^="radix-:"] chứa <i.google-symbols> "crop_"
 *     → Radix UI generated ID, stable prefix
 *   • Tier 3 (positional): submitBtn?.previousElementSibling
 *     → Settings luôn sibling trước submit trong Flow layout hiện tại
 *   • Tier 4 (textContent regex): button có text matching /crop_/
 *     → Last resort, ít stable
 * @param {Element|null} submitBtn - Optional submit button cho positional tier (auto-fetch nếu null)
 * @returns {Element|null}
 */
function getSettingsButton(submitBtn = null) {
  // Server-Only: icon_text từ settings_button config (default seed = 'crop_').
  const settingsConfig = _getDynamicSelector('settings_button');
  const settingsIconPrefix = settingsConfig?.icon_text || null;
  const iconPrefixMatch = (icon) => settingsIconPrefix && icon && icon.textContent.trim().startsWith(settingsIconPrefix);

  const _sb1 = settingsConfig?.selectors?.[0];
  const menuBtns = _sb1 ? document.querySelectorAll(_sb1) : [];
  for (const btn of menuBtns) {
    const icon = _findIconInElement(btn);
    if (iconPrefixMatch(icon)) {
      _logSelectorPick('getSettingsButton', 1, 'aria-menu+icon', btn);
      return btn;
    }
  }

  // Tier 2: Radix prefix + crop icon
  const radixBtns = _qa('settings_button');
  for (const btn of radixBtns) {
    const icon = _findIconInElement(btn);
    if (iconPrefixMatch(icon)) {
      _logSelectorPick('getSettingsButton', 2, 'radix-id+icon', btn);
      return btn;
    }
  }

  // Tier 3: positional — sibling trước submit
  const sb = submitBtn || getSubmitButton();
  if (sb?.previousElementSibling && sb.previousElementSibling.tagName === 'BUTTON') {
    _logSelectorPick('getSettingsButton', 3, 'positional', sb.previousElementSibling);
    return sb.previousElementSibling;
  }

  // Tier 4 (last resort): bất kỳ button nào có textContent chứa icon_text prefix.
  // Server-Only: lấy prefix từ settings_button.icon_text (đã có config).
  if (settingsIconPrefix) {
    const escapedPrefix = settingsIconPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixRegex = new RegExp(escapedPrefix);
    const allBtns = document.querySelectorAll('button');
    for (const btn of allBtns) {
      if (prefixRegex.test(btn.textContent || '')) {
        _logSelectorPick('getSettingsButton', 4, 'text-prefix', btn);
        return btn;
      }
    }
  }

  _logSelectorPick('getSettingsButton', 'fail', 'all', null);
  return null;
}

/**
 * Lấy settings panel popup đang mở (Radix dialog/popper/menu).
 * Settings panel render dạng floating overlay → query toàn document, lấy CÁI CUỐI CÙNG
 * (most-recently-opened theo Radix convention).
 * @returns {Element|Document} Panel element nếu có popup mở, document nếu không
 */
function _getActiveSettingsPanel() {
  // Post-audit fix: prefer panel CHỨA settings controls (button[role="tab"] cho mode/ratio/quantity).
  // Trước fix: chọn LAST menu/dialog → khi [role="menuitem"] context menu mở sau settings dialog,
  // LAST trỏ menu → query mode_tab miss → click fail.
  // Dynamic selectors (admin tweakable qua /admin/providers):
  //   - settings_panel_candidates: list selectors cho candidates
  //   - settings_panel_marker: selector identify panel chứa settings controls
  const _candCfg = _getDynamicSelector('settings_panel_candidates');
  const _candSelectors = _candCfg?.selectors?.length ? _candCfg.selectors : [];
  const _markerCfg = _getDynamicSelector('settings_panel_marker');
  const _markerSelector = _markerCfg?.selectors?.[0] || null;

  if (!_candSelectors.length || !_markerSelector) {
    console.debug('[Tier3] _getActiveSettingsPanel: settings_panel_candidates/marker config miss');
    return document;
  }

  const candidates = document.querySelectorAll(_candSelectors.join(', '));
  // Iterate ngược (LAST trước) để giữ ưu tiên popup mới nhất
  for (let i = candidates.length - 1; i >= 0; i--) {
    const el = candidates[i];
    try {
      if (el.querySelector(_markerSelector)) return el;
    } catch (_) { /* invalid selector */ }
  }
  // Fallback legacy: LAST candidate bất kỳ
  if (candidates.length > 0) return candidates[candidates.length - 1];
  return document;
}

/**
 * Tìm nút Submit trên Flow page.
 * RESILIENCE — 3 tier + dynamic selectors from backend:
 *   • Tier 1 (icon): button có icon element text match icon_text từ submit_button config
 *   • Tier 2 (text): button chứa text từ button_text array trong submit_button config
 *   • Tier 3 (type): submit-type button fallback
 */
function getSubmitButton() {
  // Strict Server-Only: đọc từ provider_configs.dom_selector.submit_button (backend đã seed đầy đủ).
  // Khi cache miss → log [Tier3] warn + empty string/array, caller graceful skip text matching.
  var config = _getDynamicSelector('submit_button');
  var hasConfig = !!config;
  var selectors = config?.selectors || [];
  var iconText = config?.icon_text;
  var submitTexts = config?.button_text?.length ? config.button_text : [];
  if (!iconText) {
    console.debug('[Tier3] getSubmitButton: submit_button.icon_text cache miss');
    iconText = '';
  }

  // Debug log: show config source
  console.log(`[Selector:submit_button] Source: ${hasConfig ? '🌐 DYNAMIC' : '📦 HARDCODED'} | selectors=${selectors.length} | icon_text="${iconText}" | button_text=[${submitTexts.join(', ')}]`);

  // Tier 0 (dynamic selectors): try CSS selectors from backend first
  for (var s = 0; s < selectors.length; s++) {
    try {
      var el = document.querySelector(selectors[s]);
      if (el) {
        console.log(`[Selector:submit_button] ✅ Tier 0 Match #${s + 1}: ${selectors[s]}`);
        _logSelectorPick('getSubmitButton', 0, 'selector', el);
        return el;
      } else {
        console.log(`[Selector:submit_button] ❌ Tier 0 No match: ${selectors[s]}`);
      }
    } catch (e) { /* invalid selector */ }
  }

  // Tier 1 (primary): icon match — Flow DOM hiện tại. Server-Only: icon class qua _findIconInElement.
  var buttons = document.querySelectorAll('button');
  for (var i = 0; i < buttons.length; i++) {
    var btn = buttons[i];
    var icon = _findIconInElement(btn);
    if (icon && icon.textContent.trim() === iconText) {
      _logSelectorPick('getSubmitButton', 1, 'icon', btn);
      return btn;
    }
  }

  // Tier 2 (text fallback): button containing submit text
  for (var j = 0; j < buttons.length; j++) {
    var btn2 = buttons[j];
    var btnText = btn2.textContent.trim();
    if (submitTexts.some(function(t) { return btnText.includes(t); })) {
      _logSelectorPick('getSubmitButton', 2, 'text', btn2);
      return btn2;
    }
  }

  // Tier 3 (legacy): button[type="submit"]
  var submitBtn = _queryWithFallback('submit_button');
  if (submitBtn) {
    _logSelectorPick('getSubmitButton', 3, 'type=submit', submitBtn);
    return submitBtn;
  }

  _logSelectorPick('getSubmitButton', 'fail', 'all', null);
  return null;
}

// UI Logging
function sendLog(msg, level = 'info') {
  console.log(`[FlowAuto] ${msg}`);
  const logContainer = document.getElementById('logContainer');
  if (logContainer) {
    const div = document.createElement('div');
    div.className = `log-entry ${level}`;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logContainer.appendChild(div);
    logContainer.scrollTop = logContainer.scrollHeight;
  }
  // Highlight log tab when receiving logs
  const logTabBtn = document.querySelector('.tab-btn[data-tab="tab-logs"]');
  if (logTabBtn && !logTabBtn.classList.contains('active')) {
    logTabBtn.classList.add('has-new');
  }
  // Forward log to sidePanel via chrome.runtime.sendMessage
  // Check extension context first to avoid "Extension context invalidated" error
  if (!chrome.runtime?.id) return;
  try {
    chrome.runtime.sendMessage({ action: 'contentLog', msg, level }).catch(function (_e) { globalThis.SEOSONA_swallow?.('content#_buildFilename', _e); });
  } catch (e) { globalThis.SEOSONA_swallow?.('content#sendLog', e); }
}

// sendProgress removed — was dead code (referenced sidePanel DOM not available in content.js)

/**
 * Send retry status to sidePanel for footer display
 * @param {string} text - Short status text (e.g., "Click Retry (1/2)", "Gửi lại Prompt")
 */
function sendRetryStatus(text) {
  try {
    chrome.runtime.sendMessage({ action: 'retry:status', text }).catch(function (_e) { globalThis.SEOSONA_swallow?.('content#_buildFilename', _e); });
  } catch (e) { globalThis.SEOSONA_swallow?.('content#sendRetryStatus', e); }
}

/**
 * Check if auto-download is enabled (from settings or Tab 1 toggle)
 */
function isAutoDownloadEnabled() {
  const genTabToggle = document.getElementById('genTabAutoDownload');
  if (genTabToggle) return genTabToggle.checked;
  return false;
}

/**
 * Get download settings from chrome.storage (includes resolution)
 * Uses new template-based filename system
 */
function getDownloadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['af_settings'], (res) => {
      const s = res.af_settings || {};
      resolve({
        folder: s.downloadFolder || 'seosonaflow_output',
        template: s.fileNameTemplate || '[Date]_[Project]_[Prompt]_[Index]',
        project: s.fileNameProject || '',
        resolution: s.downloadResolution || '1k'
      });
    });
  });
}

/**
 * Build filename from template string (inline version of DownloadHelper.buildFilename)
 * content.js runs in page context and cannot access sidePanel's window.DownloadHelper
 * @param {Object} options
 * @param {string} options.template - Template string with [Date], [Time], [Project], [Prompt], [Index]
 * @param {string} [options.project] - Project name
 * @param {string} [options.prompt] - Prompt text
 * @param {number} [options.index] - File index (1-based)
 * @param {string} [options.taskName] - Task name for subfolder
 * @param {string} [options.folder] - Base download folder
 * @param {string} [options.ext] - File extension (default: 'png')
 * @returns {string} Full filename path like "flow-output/TaskName/2026-03-12_Project_prompt_001.png"
 */
// Chuyển tiếng Việt có dấu → ASCII (ả→a, đ→d, ê→e...)
function _toAscii(str) {
  if (!str) return str;
  return str
    .replace(/[đĐ]/g, c => c === 'đ' ? 'd' : 'D')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function _buildFilename({ template, project, prompt, index, taskName, folder, ext }) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10); // 2026-03-12
  const time = now.toTimeString().slice(0, 8).replace(/:/g, '-'); // 14-30-25

  // Sanitize inputs — convert Vietnamese diacritics to ASCII, strip special chars
  const safeProject = _toAscii(project || '').substring(0, 30).replace(/[^a-zA-Z0-9_-]/g, '_');
  const safePrompt = _toAscii(prompt || 'flow').substring(0, 40).replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeIndex = index ? String(index).padStart(3, '0') : '';

  let filename = (template || '[Date]_[Prompt]')
    .replace(/\[Date\]/gi, date)
    .replace(/\[Time\]/gi, time)
    .replace(/\[Project\]/gi, safeProject)
    .replace(/\[Prompt\]/gi, safePrompt)
    .replace(/\[Index\]/gi, safeIndex);

  // Clean up: remove leading/trailing underscores, collapse multiple underscores
  filename = filename.replace(/_+/g, '_').replace(/^_|_$/g, '');

  if (!filename) filename = 'flow_' + Date.now();

  // Build full path
  const baseFolder = folder || 'seosonaflow_output';
  // [Bug fix 2026-06-10] Dedupe taskName === baseFolder để tránh duplicate path.
  // Vd user set node.download_folder = workflow.wf_name = 'seosonaflow_output' (cùng setting) →
  // naive concat tạo 'seosonaflow_output/seosonaflow_output/file' fail zsh "no such file or directory".
  const extension = ext || 'png';

  if (taskName) {
    const safeTaskName = _toAscii(taskName).substring(0, 30).replace(/[^a-zA-Z0-9_-]/g, '_');
    if (safeTaskName.toLowerCase() === baseFolder.toLowerCase()) {
      console.warn('[SEOSONA Flow] _buildFilename: taskName trùng baseFolder, skip duplicate layer:', baseFolder);
      return `${baseFolder}/${filename}.${extension}`;
    }
    return `${baseFolder}/${safeTaskName}/${filename}.${extension}`;
  }
  return `${baseFolder}/${filename}.${extension}`;
}

/**
 * K-7: Modify media URL to request higher resolution if possible
 * Google Flow images from storage.googleapis.com support =wNNNN / =hNNNN params
 */
// Nâng URL ảnh lên KÍCH THƯỚC GỐC (không downscale) theo CDN từng nhà (2026-07-09).
// Google (Flow/Gemini) googleusercontent/lh3/storage → =s0 (source, no resize).
// X/Twitter (pbs.twimg) → name=orig. Grok/OpenAI & khác → bỏ param resize (w/h/quality) → thường trả gốc.
function _fullSizeUrl(url) {
  if (!url || typeof url !== 'string') return url;
  try {
    if (url.includes('googleusercontent.com') || url.includes('storage.googleapis.com') || url.includes('lh3.') || url.includes('ggpht.com')) {
      // Bỏ mọi size-suffix hiện có (=wNNN(-hNNN), =sNNN, =hNNN), gắn =s0 (gốc).
      var clean = url.replace(/=w\d+(-h\d+)?/g, '').replace(/=s\d+/g, '').replace(/=h\d+/g, '').replace(/=+$/, '');
      var sep = clean.includes('=') ? '-' : '=';
      return clean + sep + 's0';
    }
    var u = new URL(url);
    if (/twimg\.com/i.test(u.hostname)) { u.searchParams.set('name', 'orig'); return u.toString(); }
    // Bỏ param resize phổ biến (giữ nguyên phần signature/token khác).
    ['w', 'h', 'width', 'height', 'resize', 'fit', 'sz', 'size'].forEach(function (p) { u.searchParams.delete(p); });
    return u.toString();
  } catch (_) { return url; }
}

function applyResolutionToUrl(url, resolution) {
  if (!url) return url;
  // 'original' = kích thước GỐC thật (không giới hạn theo config). Không còn trả nguyên thumbnail.
  if (resolution === 'original') return _fullSizeUrl(url);

  // Server-first: đọc pixel_width từ provider_configs.download_resolutions.
  // Fallback inline nếu cache miss.
  const targetWidth = _getDownloadPixelWidth(resolution);
  if (!targetWidth) return url;

  try {
    // Google storage URLs: =w1024 or =s1024 style params
    if (url.includes('googleusercontent.com') || url.includes('storage.googleapis.com') || url.includes('lh3.')) {
      // Remove existing size params (=wNNN, =hNNN, =sNNN, =w1024-h768, etc.)
      let cleanUrl = url.replace(/=w\d+(-h\d+)?/g, '').replace(/=s\d+/g, '').replace(/=h\d+/g, '');
      // Remove trailing = if left over
      cleanUrl = cleanUrl.replace(/=+$/, '');
      // Append new size param
      const separator = cleanUrl.includes('=') ? '-' : '=';
      return `${cleanUrl}${separator}w${targetWidth}`;
    }
    // For other URLs, try to add/replace width query param
    const urlObj = new URL(url);
    urlObj.searchParams.set('w', targetWidth.toString());
    return urlObj.toString();
  } catch (e) {
    return url;
  }
}

/**
 * Download a media file from a tile by its ID
 * T-1: Ưu tiên dùng Flow native menu (right-click → Tải xuống → 1K/2K)
 * Fallback sang fetch URL nếu Flow menu thất bại
 * @param {string} tileId
 * @param {string} [promptText] - Prompt text cho tên file (fallback mode)
 * @param {string} [taskName] - Task name cho subfolder (fallback mode)
 * @param {string} [fileName] - file_name UUID để cross-project validation
 * @param {string} [resolution] - '1k', '2k', '4k' cho ảnh; '720p', '1080p', '4k' cho video
 */
async function downloadTileMedia(tileId, promptText, taskName, fileName, resolution, flowFileId, index, videoResolution) {
  // Lấy resolution từ param hoặc settings
  let res = resolution;
  if (!res) {
    const settings = await getDownloadSettings();
    res = settings.resolution;
  }
  // GIỮ 'original' (full size). Chỉ default '1k' khi res chưa set.
  // 'original' → native menu dùng 4K (max Flow render); nếu native fail → legacy fetch =s0 (gốc CDN).
  if (!res) res = '1k';

  // U-2.2: file_id lookup trước (persistent, chính xác nhất)
  if (flowFileId) {
    const tile = findTileByFileId(flowFileId);
    if (tile) tileId = tile.dataset.tileId;
  }

  // Auto-detect video tile và dùng video resolution nếu có
  if (videoResolution) {
    const tileEl = _getTileById(tileId);
    if (tileEl && _q('tile_video', tileEl)) {
      res = videoResolution;
    }
  }

  // Ưu tiên Flow native menu cho CẢ image và video
  // Image: right-click <img> → "Tải xuống" → 1K/2K/4K
  // Video: right-click <video> → "Tải xuống" → 720p/1080p/4K
  // downloadViaFlowMenu là cách DUY NHẤT download video thực (blob: URL không download được qua chrome.downloads)
  // 'original' (Full size): thử đường nút ⋮ (more options) → "Download full size" TRƯỚC — đây là
  // native full-size THẬT của Flow (khác menu right-click 1K/2K/4K). Nếu không có/không thấy → fallback.
  if (res === 'original') {
    const tileForFull = _getTileById(tileId);
    if (tileForFull) {
      const fullOk = await downloadViaFullSizeMenu(tileForFull, fileName, promptText, taskName, index);
      if (fullOk) {
        console.log(`[SEOSONA Flow] downloadTileMedia: FULL-SIZE (⋮ menu) SUCCESS for ${tileId.substring(0, 20)}`);
        return true;
      }
      console.log(`[SEOSONA Flow] downloadTileMedia: ⋮ full-size menu not available → fallback to 4K native`);
    }
  }

  // Native menu không có nhãn 'original' → dùng 4K (bản render lớn nhất Flow cấp).
  const nativeRes = res === 'original' ? '4k' : res;
  console.log(`[SEOSONA Flow] downloadTileMedia: attempting Flow menu for ${tileId.substring(0, 20)}, res=${res} (native=${nativeRes})`);
  const menuSuccess = await downloadViaFlowMenu(tileId, nativeRes, fileName, promptText, taskName, index);
  if (menuSuccess) {
    console.log(`[SEOSONA Flow] downloadTileMedia: Flow menu SUCCESS for ${tileId.substring(0, 20)}`);
    return true;
  }
  console.log(`[SEOSONA Flow] downloadTileMedia: Flow menu FAILED for ${tileId.substring(0, 20)}, trying legacy fallback`);

  // Fallback: chrome.downloads API (chỉ work cho image có HTTP URL, KHÔNG work cho video blob: URL)
  const legacySuccess = await _downloadTileMediaLegacy(tileId, promptText, taskName, fileName, res, index);
  if (legacySuccess) {
    console.log(`[SEOSONA Flow] downloadTileMedia: Legacy fallback SUCCESS for ${tileId.substring(0, 20)}`);
    return true;
  }
  console.warn(`[SEOSONA Flow] downloadTileMedia: BOTH methods FAILED for ${tileId.substring(0, 20)}`);
  return false;
}

/**
 * Legacy download: fetch URL trực tiếp + tạo download link
 * @private
 */
async function _downloadTileMediaLegacy(tileId, promptText, taskName, fileName, resolution, index) {
  // Retry logic: tile có thể chưa appear nếu vừa bridge từ Grok/ChatGPT
  // Ít retries hơn downloadViaFlowMenu vì đây là fallback path
  const MAX_RETRIES = 3;
  const RETRY_INTERVAL = 800;
  let tile = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    tile = _getTileById(tileId);
    if (tile) break;

    if (attempt < MAX_RETRIES - 1) {
      console.log(`[SEOSONA Flow] _downloadTileMediaLegacy: tile not found, retry ${attempt + 1}/${MAX_RETRIES}...`);
      await sleep(RETRY_INTERVAL);
    }
  }

  if (!tile) {
    console.warn(`[SEOSONA Flow] _downloadTileMediaLegacy: tile not found after ${MAX_RETRIES} retries: ${tileId.substring(0, 30)}`);
    return false;
  }

  // Cross-project validation
  if (fileName) {
    const currentFn = extractFileName(tile);
    if (currentFn && currentFn !== fileName) {
      console.warn(`[SEOSONA Flow] _downloadTileMediaLegacy: cross-project collision`);
      sendLog(`Tile ${tileId.substring(0, 15)}... thuộc project khác, bỏ qua.`, 'warn');
      return false;
    }
  }

  // Chờ media load hoàn tất (tránh download media.html hoặc placeholder)
  // Video cần thời gian lâu hơn để load (encoding + streaming) → timeout 15s + preferVideo
  const resLower = (resolution || '').toLowerCase();
  const isVideoRes = resLower === '720p' || resLower === '1080p' || (resLower === '4k' && !!_q('tile_video', tile));
  const mediaTimeout = isVideoRes ? 15000 : 10000;
  const mediaEl = await _waitForTileMediaReady(tile, mediaTimeout, isVideoRes);
  if (!mediaEl) {
    console.warn(`[SEOSONA Flow] _downloadTileMediaLegacy: tile media not ready after ${mediaTimeout / 1000}s, tileId=${tileId.substring(0, 30)}`);
    return false;
  }

  try {
    const settings = await getDownloadSettings();
    const mediaSrc = applyResolutionToUrl(mediaEl.src, resolution || '1k');

    // CRITICAL: Final validation - reject placeholder URLs before download
    if (!mediaSrc ||
        mediaSrc.includes('media.html') ||
        mediaSrc.endsWith('.html') ||
        (!mediaSrc.startsWith('http://') && !mediaSrc.startsWith('https://') && !mediaSrc.startsWith('blob:'))) {
      console.warn(`[SEOSONA Flow] _downloadTileMediaLegacy: invalid/placeholder URL rejected: ${mediaSrc?.substring(0, 80)}`);
      return false;
    }

    // Build filename using template system
    const isVideo = mediaEl.tagName === 'VIDEO';
    const ext = isVideo ? 'mp4' : 'png';

    const filename = _buildFilename({
      template: settings.template,
      project: settings.project,
      prompt: promptText,
      index: index,
      taskName: taskName,
      folder: settings.folder,
      ext
    });

    console.log(`[SEOSONA Flow] _downloadTileMediaLegacy: downloading via chrome.downloads: ${mediaSrc.substring(0, 100)}...`);

    // Dùng chrome.downloads API qua background.js — reliable, handles Google CDN auth/cookies
    const _dlUrl = await (window.scrubbedDownloadUrl?.(mediaSrc) ?? mediaSrc);
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'chromeDownload',
        url: _dlUrl,
        filename
      }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || { success: false, error: 'No response' });
        }
      });
    });

    if (response.success) {
      incrementDownloadCounter();
      const resLabel = resolution ? ` [${resolution.toUpperCase()}]` : '';
      sendLog(`Đã tải${resLabel}: ${filename}`, 'success');
      return true;
    } else {
      console.warn(`[SEOSONA Flow] _downloadTileMediaLegacy: chrome.downloads failed: ${response.error}`);
      return false;
    }
  } catch (e) {
    console.warn(`[SEOSONA Flow] _downloadTileMediaLegacy: exception: ${e.message}`);
    sendLog(`Không thể tải file ${tileId}: ${e.message}`, 'warn');
    return false;
  }
}

/**
 * T-1: Download via Google Flow native context menu (right-click → Tải xuống → 1K/2K)
 * Flow xử lý download, extension chỉ simulate thao tác + rename file trước khi lưu
 * @param {string} tileId - Tile ID cần download
 * @param {string} resolution - '1k', '2k' cho ảnh; '720p', '1080p' cho video
 * @param {string} [fileName] - file_name UUID để cross-project validation
 * @param {string} [promptText] - Prompt text cho tên file
 * @param {string} [taskName] - Task name cho subfolder
 * @returns {Promise<boolean>} true nếu download thành công
 */
/**
 * Download FULL SIZE qua nút ⋮ (more options) trên tile → menu → "Download full size".
 * (2026-07-09) Đây là đường native full-size THẬT của Flow — KHÁC menu right-click 1K/2K/4K.
 *
 * Selector chưa có trong provider_configs (server chưa seed) → dò heuristic + match TEXT đa-ngôn-ngữ.
 * Khi bắt được DOM thật, seed 2 key config để chính xác: `tile_more_button` (nút ⋮) +
 * `download_full_size_item` (text_match cho item full-size). Best-effort: cần verify live trên Flow.
 *
 * @returns {Promise<boolean>} true nếu đã click được "Download full size"
 */
async function downloadViaFullSizeMenu(tile, fileName, promptText, taskName, index) {
  if (!tile) return false;
  // Menu Flow là 2 TẦNG (verified screenshot 2026-07-11): ⋮ → "Download" (cấp 1, có submenu) →
  // submenu resolution: "270p Animated GIF" / "720p Original Size" / "1080p Upscaled" / "4K Upscaled(Upgrade)".
  // Full size = "Original Size" (bản render gốc thật, KHÔNG upscale). 4K khoá gói (Upgrade) → bỏ.
  // Text cấp 1 "Download" (mở submenu). Seed `flow_download_item.text_match` để override.
  const cfgDl = _getDynamicSelector('flow_download_item');
  const DOWNLOAD_TEXTS = (cfgDl?.text_match?.length ? cfgDl.text_match : [
    'download', 'tải xuống', 'tải về', 'ダウンロード', '다운로드', 'télécharger', 'descargar', 'unduh'
  ]).map(s => String(s).toLowerCase());
  // Text resolution "full size" trong submenu = "Original Size". Seed `download_full_size_item.text_match`.
  const cfgItem = _getDynamicSelector('download_full_size_item');
  const FULL_SIZE_TEXTS = (cfgItem?.text_match?.length ? cfgItem.text_match : [
    'original size', 'original', 'kích thước gốc', 'bản gốc', 'gốc',
    '元のサイズ', '원본 크기', 'taille originale', 'tamaño original', 'ukuran asli'
  ]).map(s => String(s).toLowerCase());

  await _acquireCtxMenuLock();
  try {
    tile.scrollIntoView({ behavior: 'instant', block: 'center' });
    // Hover để hiện action controls (nút ⋮ thường ẩn tới khi hover)
    ['mouseover', 'mouseenter', 'mousemove'].forEach(t => tile.dispatchEvent(new MouseEvent(t, { bubbles: true })));
    await sleep(220);

    // 1. Tìm nút ⋮ (config override → heuristic): aria-haspopup, aria-label more/options, icon more_vert
    const cfgBtn = _getDynamicSelector('tile_more_button');
    let moreBtn = null;
    if (cfgBtn?.selectors?.length) {
      for (const s of cfgBtn.selectors) { try { const el = tile.querySelector(s); if (el) { moreBtn = el; break; } } catch (_) { globalThis.SEOSONA_swallow?.('content#downloadViaFullSizeMenu', _); } }
    }
    if (!moreBtn) {
      const btns = Array.from(tile.querySelectorAll('button, [role="button"]'));
      moreBtn = btns.find(b => {
        const al = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).toLowerCase();
        const icon = (b.querySelector('i')?.textContent || '').trim();
        return b.getAttribute('aria-haspopup') === 'menu'
          || /more|option|tùy chọn|thêm|menu|⋮/.test(al)
          || icon === 'more_vert' || icon === 'more_horiz';
      }) || null;
    }
    if (!moreBtn) { console.debug('[full-size] nút ⋮ (more options) không tìm thấy trong tile'); return false; }

    // 2. Mở menu — thử pointer sequence (Radix) rồi click
    const r = moreBtn.getBoundingClientRect();
    const px = r.left + r.width / 2, py = r.top + r.height / 2;
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(t => {
      const Evt = t.startsWith('pointer') ? PointerEvent : MouseEvent;
      try { moreBtn.dispatchEvent(new Evt(t, { bubbles: true, cancelable: true, clientX: px, clientY: py, pointerId: 1, pointerType: 'mouse' })); } catch (_) { try { moreBtn.dispatchEvent(new MouseEvent(t.replace('pointer', 'mouse'), { bubbles: true, cancelable: true, clientX: px, clientY: py })); } catch (__) { globalThis.SEOSONA_swallow?.('content#downloadViaFullSizeMenu', __); } }
    });
    await sleep(280);

    // Helper: click / hover 1 element qua pointer sequence (Radix menu)
    const _menuItems = (scope) => Array.from((scope || document).querySelectorAll('[role="menuitem"], [role="menuitemradio"], [role="option"], button, a, li'));
    const _menusNow = () => Array.from(document.querySelectorAll('[role="menu"], [data-radix-menu-content], [role="listbox"]'));
    const _dispatch = (el, types) => {
      const b = el.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      types.forEach(t => {
        const Evt = t.startsWith('pointer') ? PointerEvent : MouseEvent;
        try { el.dispatchEvent(new Evt(t, { bubbles: true, cancelable: true, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse' })); }
        catch (_) { try { el.dispatchEvent(new MouseEvent(t.replace('pointer', 'mouse'), { bubbles: true, cancelable: true, clientX: cx, clientY: cy })); } catch (__) { globalThis.SEOSONA_swallow?.('content#_dispatch', __); } }
      });
    };
    const _clickEl = (el) => _dispatch(el, ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    const _hoverEl = (el) => _dispatch(el, ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']);

    // 3. Menu cấp 1 → tìm item "Download" (có submenu resolution). Ưu tiên item có aria-haspopup=menu.
    const menu1 = (() => { const m = _menusNow(); return m.length ? m[m.length - 1] : document; })();
    const items1 = _menuItems(menu1);
    let dlItem = items1.find(it => _textIncludesAny((it.textContent || '').trim().toLowerCase(), DOWNLOAD_TEXTS) && it.getAttribute('aria-haspopup') === 'menu')
      || items1.find(it => _textIncludesAny((it.textContent || '').trim().toLowerCase(), DOWNLOAD_TEXTS));
    if (!dlItem) {
      console.debug('[full-size] item "Download" (cấp 1) không thấy trong menu ⋮ — cần seed flow_download_item.text_match');
      _closeContextMenu();
      return false;
    }

    // 4. Hover + click "Download" → mở submenu resolution (Radix submenu mở khi hover)
    _hoverEl(dlItem); await sleep(180); _clickEl(dlItem); await sleep(340);

    // 5. Submenu resolution (menu MỚI ≠ menu1) → chọn "Original Size" (bản gốc); bỏ Upgrade/disabled/GIF.
    const submenu = (() => { const after = _menusNow().filter(m => m !== menu1); return after.length ? after[after.length - 1] : menu1; })();
    const resItems = _menuItems(submenu).filter(it => {
      if (it.getAttribute('aria-disabled') === 'true' || it.hasAttribute('disabled')) return false;
      const t = (it.textContent || '').toLowerCase();
      if (t.includes('upgrade') || t.includes('nâng cấp')) return false; // 4K khoá gói
      return (it.textContent || '').trim().length > 0;
    });
    let target = resItems.find(it => _textIncludesAny((it.textContent || '').toLowerCase(), FULL_SIZE_TEXTS));
    if (!target) {
      // Fallback: resolution có số px CAO nhất (bỏ GIF) khi text "original" không khớp locale
      let best = null, bestPx = -1;
      for (const it of resItems) {
        const t = (it.textContent || '').toLowerCase();
        if (t.includes('gif')) continue;
        const m = t.match(/(\d{3,4})\s*p\b/);
        const px = m ? parseInt(m[1], 10) : 0;
        if (px > bestPx) { bestPx = px; best = it; }
      }
      target = best;
    }
    if (!target) {
      console.debug('[full-size] resolution item không thấy trong submenu Download');
      _closeContextMenu();
      return false;
    }

    // 6. Click resolution → Flow tự tải bản gốc
    _clickEl(target); await sleep(320);
    console.log('[full-size] đã click download resolution:', (target.textContent || '').trim().slice(0, 40));
    return true;
  } catch (e) {
    console.warn('[full-size] lỗi:', e && e.message);
    return false;
  } finally {
    _releaseCtxMenuLock();
  }
}

async function downloadViaFlowMenu(tileId, resolution, fileName, promptText, taskName, index) {
  // Retry logic: tile từ Grok/ChatGPT có thể chưa bridge xong khi Download node chạy
  // Wait + retry tối đa 5 lần, mỗi lần cách 1 giây
  const MAX_TILE_RETRIES = 5;
  const TILE_RETRY_INTERVAL = 1000;
  let tile = null;

  for (let attempt = 0; attempt < MAX_TILE_RETRIES; attempt++) {
    tile = _getTileById(tileId);
    if (tile) break;

    if (attempt < MAX_TILE_RETRIES - 1) {
      console.log(`[SEOSONA Flow] downloadViaFlowMenu: tile not found, retry ${attempt + 1}/${MAX_TILE_RETRIES} in ${TILE_RETRY_INTERVAL}ms...`);
      await sleep(TILE_RETRY_INTERVAL);
    }
  }

  if (!tile) {
    console.warn(`[SEOSONA Flow] downloadViaFlowMenu: tile not found after ${MAX_TILE_RETRIES} retries: ${tileId.substring(0, 20)}`);
    return false;
  }

  // Cross-project validation
  if (fileName) {
    const currentFn = extractFileName(tile);
    if (currentFn && currentFn !== fileName) {
      console.warn(`[SEOSONA Flow] downloadViaFlowMenu: cross-project collision`);
      sendLog(`Tile ${tileId.substring(0, 15)}... thuộc project khác, bỏ qua.`, 'warn');
      return false;
    }
  }

  // Detect if this is a video tile by checking for <video> element
  // Fallback: resolution format (720p/1080p = video, 1k/2k = image)
  // '4k' is ambiguous — check <video> element first, then fallback by resolution format
  // Video tiles may show <img> thumbnail instead of <video> during loading
  // Also check img alt="Video thumbnail" as video element may not be in DOM yet
  const resLower = (resolution || '').toLowerCase();
  const videoEl = _q('tile_video', tile);
  const imgEl = tile?.querySelector('img');
  const isVideoByAlt = imgEl?.alt?.toLowerCase().includes('video');
  const isVideo = !!videoEl || isVideoByAlt ||
    resLower === '720p' || resLower === '1080p';

  // Resolution label: strict Server-Only qua _getDownloadMenuLabel (provider_configs.download_resolutions).
  // Cache miss → null → caller dùng resolution string nguyên gốc (no hardcoded label).
  let resLabel = _getDownloadMenuLabel(resolution, isVideo);
  if (!resLabel) {
    console.debug('[Tier3] downloadViaFlowMenu: resLabel null (config miss), using raw resolution string');
    resLabel = (resolution || '').toString();
  }

  // 0. Ensure Flow tab active (context menu cần tab active để React render menu)
  // Chỉ cần active tab, không cần focus window
  if (document.visibilityState === 'hidden') {
    await new Promise(resolve => {
      chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }, () => resolve());
    });
    await sleep(300); // Chờ tab activate + React unthrottle
  }

  // 1. Chờ media ready TRƯỚC khi acquire context menu lock (tránh block editor lâu)
  // Video: preferVideo=true → đợi <video> element (blob URL OK) → right-click hiện 720p/1080p
  // Image: preferVideo=false → lấy <video> hoặc <img> → right-click hiện 1K/2K
  const mediaTimeout = isVideo ? 15000 : 10000;
  tile.scrollIntoView({ behavior: 'instant', block: 'center' });
  const readyMedia = await _waitForTileMediaReady(tile, mediaTimeout, isVideo);
  if (!readyMedia) {
    console.warn(`[SEOSONA Flow] downloadViaFlowMenu: tile media not ready after ${mediaTimeout / 1000}s, tileId=${tileId.substring(0, 20)}`);
    return false;
  }

  // Context menu mutex — tránh collision với addFileToPrompt trong pipeline mode
  await _acquireCtxMenuLock();
  try {
    // Re-scroll (có thể bị shift trong lúc chờ lock)
    tile.scrollIntoView({ behavior: 'instant', block: 'center' });
    await sleep(100);

    // 2. Right-click vào IMG/VIDEO element (không phải tile container)
    // Flow chỉ hiện menu "Tải xuống" khi right-click trúng media element
    // Video: right-click <video> → menu 720p/1080p
    // Image: right-click <img> → menu 1K/2K
    const targetEl = readyMedia;
    const rect = targetEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    console.log(`[SEOSONA Flow] downloadViaFlowMenu: right-click on ${targetEl.tagName} at (${Math.round(cx)}, ${Math.round(cy)}), rect: ${Math.round(rect.width)}x${Math.round(rect.height)}`);
    targetEl.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: cx, clientY: cy, button: 2
    }));

    const _ctxSel = _selStr('context_menu');
    if (!_ctxSel) {
      console.debug('[Tier3] downloadViaFlowMenu: context_menu config miss');
      return false;
    }
    const contextMenu = await _waitForElement(_ctxSel, 3000);
    if (!contextMenu) {
      // Bước nội bộ có FALLBACK (caller ~4142 thử path khác) → transient, hạ debug (không spam panel dev).
      // Nếu toàn bộ download fail thì caller mới báo user toast "không tải được".
      console.debug('[SEOSONA Flow] downloadViaFlowMenu: context menu not found (sẽ fallback)');
      return false;
    }
    await sleep(50);

    // 4. Tìm menu item "Tải xuống" / "Download" (có aria-haspopup="menu" - submenu)
    // Strict Server-Only: download_menu_trigger config (selectors + icon_text + button_text per locale).
    // Backend đã seed đủ: icon_text='download', button_text=['Tải xuống','Download','ดาวน์โหลด','ダウンロード'].
    const triggerConfig = _getDynamicSelector('download_menu_trigger');
    let triggerIconText = triggerConfig?.icon_text;
    let triggerButtonText = triggerConfig?.button_text?.length ? triggerConfig.button_text : [];
    if (!triggerIconText) {
      console.debug('[Tier3] downloadViaFlowMenu: download_menu_trigger.icon_text cache miss');
      triggerIconText = '';
    }
    if (!triggerButtonText.length) {
      console.debug('[Tier3] downloadViaFlowMenu: download_menu_trigger.button_text cache miss');
    }

    const _miSel = _selStr('menu_item');
    if (!_miSel) {
      console.debug('[Tier3] menu_item config miss');
      return false;
    }
    const menuItems = contextMenu.querySelectorAll(_miSel);
    let downloadItem = null;

    // Strategy 1: icon text match (language-independent) + aria-haspopup="menu"
    for (const item of menuItems) {
      const icon = item.querySelector('i');
      if (icon?.textContent?.trim() === triggerIconText && item.getAttribute('aria-haspopup') === 'menu') {
        downloadItem = item;
        break;
      }
    }

    // Strategy 2: text match multi-locale (từ button_text config)
    if (!downloadItem) {
      for (const item of menuItems) {
        const text = item.textContent?.trim() || '';
        if (_textIncludesAny(text, triggerButtonText) && item.getAttribute('aria-haspopup') === 'menu') {
          downloadItem = item;
          break;
        }
      }
    }

    // Strategy 3: icon fallback không cần aria-haspopup (edge case)
    if (!downloadItem) {
      for (const item of menuItems) {
        if (item.querySelector('i')?.textContent?.trim() === triggerIconText) {
          downloadItem = item;
          break;
        }
      }
    }

    if (!downloadItem) {
      console.warn('[SEOSONA Flow] downloadViaFlowMenu: download menu item not found');
      _closeContextMenu();
      return false;
    }

    // 5. Hover vào "Tải xuống" để trigger sub-menu (Radix UI cần full pointer sequence)
    const dlRect = downloadItem.getBoundingClientRect();
    const dlCx = dlRect.left + dlRect.width / 2;
    const dlCy = dlRect.top + dlRect.height / 2;
    // relatedTarget quan trọng cho Radix UI hover detection
    const pointerOpts = { bubbles: true, cancelable: true, clientX: dlCx, clientY: dlCy, pointerId: 1, pointerType: 'mouse', relatedTarget: contextMenu };
    const mouseOpts = { bubbles: true, cancelable: true, clientX: dlCx, clientY: dlCy, relatedTarget: contextMenu };

    // Helper: tìm sub-menu với nhiều strategies
    // Server-first: đọc download_submenu config (attribute + selectors).
    // attribute='aria-controls' (strategy 1), selectors[] cho strategy 2/3.
    const submenuConfig = _getDynamicSelector('download_submenu');
    const submenuAttribute = submenuConfig?.attribute || 'aria-controls';
    const submenuSelectors = submenuConfig?.selectors?.length ? submenuConfig.selectors : [];
    if (!submenuSelectors.length) console.debug('[Tier3] downloadViaFlowMenu: download_submenu config miss');

    const findSubMenu = () => {
      // Strategy 1: aria-controls (preferred — chính xác nhất)
      const subMenuId = downloadItem.getAttribute(submenuAttribute);
      if (subMenuId) {
        const menu = document.getElementById(subMenuId);
        if (menu) return menu;
      }
      // Strategy 2+: thử lần lượt selectors từ config
      for (const sel of submenuSelectors) {
        try {
          const candidates = document.querySelectorAll(sel);
          for (const m of candidates) {
            if (m !== contextMenu) return m;
          }
        } catch (e) { /* invalid selector */ }
      }
      return null;
    };

    // Full pointer/mouse event sequence cho Radix UI (bao gồm pointerdown/pointerup)
    downloadItem.dispatchEvent(new PointerEvent('pointerover', pointerOpts));
    downloadItem.dispatchEvent(new PointerEvent('pointerenter', pointerOpts));
    downloadItem.dispatchEvent(new PointerEvent('pointermove', pointerOpts));
    downloadItem.dispatchEvent(new PointerEvent('pointerdown', { ...pointerOpts, button: 0 }));
    downloadItem.dispatchEvent(new PointerEvent('pointerup', { ...pointerOpts, button: 0 }));
    downloadItem.dispatchEvent(new MouseEvent('mouseover', mouseOpts));
    downloadItem.dispatchEvent(new MouseEvent('mouseenter', mouseOpts));
    downloadItem.dispatchEvent(new MouseEvent('mousemove', mouseOpts));
    downloadItem.focus();

    // 6. Wait cho sub-menu render (thử nhiều lần nếu cần)
    let subMenu = null;
    for (let attempt = 0; attempt < 5 && !subMenu; attempt++) {
      await sleep(150); // Tăng từ 100ms lên 150ms
      subMenu = findSubMenu();
      if (!subMenu && attempt === 1) {
        // Retry hover sequence ở attempt thứ 2
        downloadItem.dispatchEvent(new PointerEvent('pointerenter', pointerOpts));
        downloadItem.dispatchEvent(new MouseEvent('mouseenter', mouseOpts));
      }
      if (!subMenu && attempt === 3) {
        // Attempt 4: thử focus + keyboard navigation (một số Radix versions cần keyboard)
        downloadItem.focus();
        downloadItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        await sleep(100);
        subMenu = findSubMenu();
      }
    }
    // Final fallback: hover lại với delay dài hơn
    if (!subMenu) {
      downloadItem.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, clientX: dlCx, clientY: dlCy }));
      downloadItem.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: dlCx, clientY: dlCy }));
      await sleep(300);
      subMenu = findSubMenu();
    }
    if (!subMenu) {
      console.warn('[SEOSONA Flow] downloadViaFlowMenu: sub-menu not found after 5 attempts');
      _closeContextMenu();
      return false;
    }

    // 7. Tìm và click option resolution
    // Fallback chain khi aria-disabled="true":
    //   Image: 4K → 2K → 1K
    //   Video: 4K → 1080p → 720p
    // Server-first: đọc từ provider_configs.download_resolutions với inline fallback.
    const subItemConfig = _getDynamicSelector('download_submenu_item');
    const subItemSelectors = subItemConfig?.selectors?.length ? subItemConfig.selectors : [];
    if (!subItemSelectors.length) console.debug('[Tier3] download_submenu_item config miss');
    let subItems = [];
    for (const sel of subItemSelectors) {
      try {
        const found = subMenu.querySelectorAll(sel);
        if (found && found.length > 0) { subItems = found; break; }
      } catch (e) { /* invalid selector */ }
    }
    const fallbackChain = _getDownloadFallbackChain(isVideo);

    // Tìm vị trí của resLabel trong fallback chain, bắt đầu từ đó
    let startIdx = fallbackChain.indexOf(resLabel);
    if (startIdx < 0) startIdx = 0;

    let targetItem = null;
    let actualResLabel = resLabel;
    for (let fi = startIdx; fi < fallbackChain.length && !targetItem; fi++) {
      const tryLabel = fallbackChain[fi];
      for (const item of subItems) {
        const text = item.textContent?.trim() || '';
        if (text.startsWith(tryLabel)) {
          if (item.getAttribute('aria-disabled') === 'true') {
            console.log(`[SEOSONA Flow] downloadViaFlowMenu: ${tryLabel} is disabled (aria-disabled), trying lower resolution`);
            break; // Try next in fallback chain
          }
          targetItem = item;
          actualResLabel = tryLabel;
          break;
        }
      }
    }

    if (targetItem && actualResLabel !== resLabel) {
      sendLog(`${resLabel} không khả dụng, tải ${actualResLabel} thay thế`, 'warn');
    }

    if (!targetItem) {
      // Last resort: tải option đầu tiên available (tốt hơn là không tải gì)
      const availableItems = [...subItems].map(i => i.textContent?.trim()).join(', ');
      console.warn(`[SEOSONA Flow] downloadViaFlowMenu: ${resLabel} not found in sub-menu. Available: [${availableItems}]`);
      for (const item of subItems) {
        if (item.getAttribute('aria-disabled') !== 'true') {
          targetItem = item;
          const firstWord = item.textContent?.trim().split(' ')[0] || '?';
          sendLog(`${resLabel} không khả dụng, tải ${firstWord} thay thế`, 'warn');
          break;
        }
      }
      if (!targetItem) {
        console.warn('[SEOSONA Flow] downloadViaFlowMenu: no downloadable option found');
        _closeContextMenu();
        return false;
      }
    }

    // 8. Re-validate media URL trước khi click download (tránh race condition)
    // Media có thể đã thay đổi trong thời gian chờ menu render
    const mediaForValidation = isVideo
      ? _q('tile_video', tile)
      : _q('tile_video', tile) || tile.querySelector('img');
    if (mediaForValidation) {
      const currentSrc = mediaForValidation.src || '';
      const rawSrc = mediaForValidation.getAttribute('src') || '';
      const isPlaceholder = currentSrc.includes('media.html') ||
        currentSrc.endsWith('.html') ||
        rawSrc === 'media.html' ||
        rawSrc.endsWith('.html') ||
        (!currentSrc.startsWith('http') && !currentSrc.startsWith('blob:') && !rawSrc.startsWith('/fx/'));
      if (isPlaceholder) {
        console.warn('[SEOSONA Flow] downloadViaFlowMenu: media URL is placeholder after menu opened, aborting download');
        _closeContextMenu();
        return false;
      }
    }

    // 9. Chuẩn bị rename file trước khi Flow download (template-based)
    const settings = await getDownloadSettings();
    const downloadFilename = _buildFilename({
      template: settings.template,
      project: settings.project,
      prompt: promptText,
      index: index,
      taskName: taskName,
      folder: settings.folder,
      ext: isVideo ? 'mp4' : 'png'
    });

    // Extract folder and baseName for prepareDownloadRename
    const lastSlash = downloadFilename.lastIndexOf('/');
    const downloadFolder = lastSlash >= 0 ? downloadFilename.substring(0, lastSlash) : settings.folder;
    const baseName = lastSlash >= 0 ? downloadFilename.substring(lastSlash + 1).replace(/\.[^.]+$/, '') : downloadFilename.replace(/\.[^.]+$/, '');

    // Gửi rename request tới background.js TRƯỚC khi click download
    // MUST await để đảm bảo rename entry đã được push vào queue
    // trước khi onDeterminingFilename fires (MV3 service worker race condition)
    // identifier giúp match chính xác khi concurrent downloads
    const identifier = fileName || baseName || tileId;
    await new Promise(resolve => {
      chrome.runtime.sendMessage({
        action: 'prepareDownloadRename',
        folder: downloadFolder,
        filename: baseName,
        identifier: identifier
      }, () => resolve());
    });

    // 10. Click download — Flow xử lý, background.js rename file
    targetItem.click();
    await sleep(50);

    // 11. Increment counter
    incrementDownloadCounter();
    const actualRes = targetItem.textContent?.trim().split(' ')[0] || resLabel;
    sendLog(`Đã tải [${actualRes}]: ${downloadFolder}/${baseName}`, 'success');
    return true;

  } catch (e) {
    console.error('[SEOSONA Flow] downloadViaFlowMenu error:', e);
    _closeContextMenu();
    return false;
  } finally {
    _releaseCtxMenuLock();
  }
}

/**
 * Wait for an element matching selector to appear in DOM
 * @private
 */
function _waitForElement(selector, timeoutMs = 3000, excludeEl = null) {
  return new Promise(resolve => {
    // Kiểm tra ngay nếu element đã tồn tại
    const existing = document.querySelectorAll(selector);
    for (const el of existing) {
      if (!excludeEl || el !== excludeEl) { resolve(el); return; }
    }

    // P3-2: Dùng MutationObserver thay setInterval(100ms) để giảm CPU polling
    const observer = new MutationObserver(() => {
      const els = document.querySelectorAll(selector);
      for (const el of els) {
        if (!excludeEl || el !== excludeEl) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
          return;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Timeout safety net: disconnect observer và trả null nếu hết thời gian
    const timer = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);
  });
}

/**
 * Chờ tile hoàn thành (status check) + media load hoàn tất
 * 2 giai đoạn giống cơ chế retry:
 *   1. Chờ tile settle (success/failed) — reject ngay nếu failed
 *   2. Chờ media element load (src hợp lệ + rendered)
 * Tránh right-click download khi tile chưa render hoặc đã fail
 * @param {Element} tile - Tile DOM element
 * @param {number} timeoutMs - Timeout tổng (ms)
 * @param {boolean} [preferVideo=false] - Nếu true, đợi <video> element cụ thể (không fallback sang <img>)
 * @returns {Promise<Element|null>} Media element đã load, hoặc null nếu timeout/failed
 * @private
 */
function _waitForTileMediaReady(tile, timeoutMs = 10000, preferVideo = false) {
  return new Promise(resolve => {
    const startTime = Date.now();
    // Video fallback: nếu đợi <video> quá lâu (8s), thử fallback <img> sớm
    // Right-click <img> vẫn hoạt động cho download, chỉ không chọn được video resolution
    const videoFallbackMs = Math.min(8000, timeoutMs * 0.6);
    const check = () => {
      // Giai đoạn 1: Check tile status (giống detectTileStatus)
      const status = detectTileStatus(tile);
      if (status === 'failed') {
        console.warn('[SEOSONA Flow] _waitForTileMediaReady: tile is failed, skip download');
        resolve(null);
        return;
      }

      // Giai đoạn 2: Nếu success hoặc processing, check media load
      // preferVideo=true: đợi <video> element, không lấy <img> (tránh download thumbnail thay vì video)
      // preferVideo=false: ưu tiên <video> trước, fallback <img>
      let media;
      if (preferVideo) {
        media = _q('tile_video', tile);
        // Nếu chưa có <video> element VÀ chưa quá videoFallbackMs, tiếp tục poll
        // Sau videoFallbackMs, fallback sang <img> sớm (không chờ hết timeout)
        if (!media && status === 'success' && (Date.now() - startTime >= videoFallbackMs)) {
          const img = tile.querySelector('img');
          if (img) {
            const imgSrc = img.src || '';
            const imgRaw = img.getAttribute('src') || '';
            // CRITICAL: Reject placeholder URLs
            const isValidUrl = imgSrc.startsWith('http') &&
              !imgSrc.includes('media.html') &&
              !imgSrc.endsWith('.html') &&
              !imgRaw.endsWith('.html');
            if (isValidUrl) {
              console.warn('[SEOSONA Flow] _waitForTileMediaReady: video not in DOM after ' + Math.round(videoFallbackMs / 1000) + 's, falling back to img early');
              resolve(img);
              return;
            }
          }
        }
      } else {
        media = _q('tile_video', tile) || tile.querySelector('img');
      }
      if (media && status === 'success') {
        const src = media.src || '';
        // Src phải là URL hợp lệ, không phải placeholder
        // Video trên Google Flow có thể dùng:
        // - blob: URL (blob:https://labs.google/xxx) khi đang play
        // - Relative URL (/fx/api/trpc/media.getMediaUrlRedirect?name=UUID) khi completed
        // - Absolute URL (https://...) cho image
        // Browser tự resolve relative → absolute trong media.src, nhưng getAttribute('src') giữ nguyên
        const rawSrc = media.getAttribute('src') || '';
        const isVideoMedia = media.tagName === 'VIDEO';
        const isVideoBlobOrRelative = isVideoMedia && (src.startsWith('blob:') || rawSrc.startsWith('/fx/'));
        // CRITICAL: Reject placeholder URLs (media.html, *.html patterns)
        const isPlaceholderUrl = src.includes('media.html') ||
          src.endsWith('.html') ||
          rawSrc === 'media.html' ||
          rawSrc.endsWith('.html');
        const hasValidSrc = (isVideoBlobOrRelative || (src.startsWith('http://') || src.startsWith('https://')))
          && !src.includes('chrome-extension')
          && !isPlaceholderUrl;
        // Video: chỉ cần hasValidSrc là đủ cho right-click download
        // Browser throttle video loading khi window không focus (readyState stuck ở 0)
        // Context menu hoạt động dựa trên element type (<video>), không cần video thực sự load
        // Image: cần img.complete + naturalWidth > 0 (trừ khi tab hidden)
        const isTabHidden = document.visibilityState === 'hidden' || !document.hasFocus();
        const isLoaded = isVideoMedia
          ? true  // Video: hasValidSrc đủ, không cần readyState check
          : (isTabHidden
            ? true  // Image unfocused: URL hợp lệ là đủ
            : (media.naturalWidth > 0 && media.complete));
        if (hasValidSrc && isLoaded) {
          resolve(media);
          return;
        }
      }

      // Timeout
      if (Date.now() - startTime >= timeoutMs) {
        // preferVideo fallback: nếu đợi video timeout, thử lấy <img> thay thế
        if (preferVideo) {
          const img = tile.querySelector('img');
          if (img) {
            const imgSrc = img.src || '';
            const imgRaw = img.getAttribute('src') || '';
            // CRITICAL: Reject placeholder URLs
            const isValidUrl = imgSrc.startsWith('http') &&
              !imgSrc.includes('media.html') &&
              !imgSrc.endsWith('.html') &&
              !imgRaw.endsWith('.html');
            if (isValidUrl) {
              console.warn('[SEOSONA Flow] _waitForTileMediaReady: video not ready, falling back to img');
              resolve(img);
              return;
            }
          }
        }
        resolve(null);
        return;
      }
      setTimeout(check, 200);
    };
    check();
  });
}

/**
 * Close any open context menu by pressing Escape
 * @private
 */
function _closeContextMenu() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

/**
 * Context Menu Mutex — Google Flow chỉ cho phép 1 context menu tại 1 thời điểm
 * Serialize addFileToPrompt và downloadViaFlowMenu để tránh context menu collision
 * Giữ làm lớp bảo vệ phụ dù Unified Queue đã serialize submit/download
 * @private
 */
// Guard: var allows safe re-declaration when extension reloads and re-injects content.js
var _ctxMenuLockQueue = _ctxMenuLockQueue || [];
var _ctxMenuLocked = _ctxMenuLocked || false;

async function _acquireCtxMenuLock() {
  if (_ctxMenuLocked) {
    await new Promise(resolve => _ctxMenuLockQueue.push(resolve));
  }
  _ctxMenuLocked = true;
  // Block user interaction khi context menu đang thao tác
  // ExecutionBlocker có thể chưa active (pipeline download chạy ngoài runAutoPrompt)
  if (!ExecutionBlocker._blocking) {
    document.body.classList.add('seosonaflow-execution-blocking');
  }
  // Đóng context menu cũ nếu còn mở (stale từ thao tác trước)
  _closeContextMenu();
  await sleep(50);
}

function _releaseCtxMenuLock() {
  if (_ctxMenuLockQueue.length > 0) {
    const next = _ctxMenuLockQueue.shift();
    next(); // Wake up waiter tiếp theo (FIFO)
  } else {
    _ctxMenuLocked = false;
    // Remove CSS blocking nếu ExecutionBlocker không active
    if (!ExecutionBlocker._blocking) {
      document.body.classList.remove('seosonaflow-execution-blocking');
    }
  }
}

/**
 * Wait for new tiles to appear and fully load (img/video)
 * Returns array of new tile IDs, or empty if timeout
 */
/**
 * Trích xuất file_name (UUID) từ media URL của tile.
 * file_name là persistent across sessions, không đổi khi reload.
 * URL dạng: /fx/api/trpc/media.getMediaUrlRedirect?name=UUID
 * hoặc: /fx/api/trpc/media.getMediaUrlRedirect?input={"json":{"name":"UUID"}}
 */
function extractFileName(tile) {
  if (!tile) return null;
  // Kiểm tra cache trước — tránh lặp lại 3 querySelectorAll mỗi polling cycle
  const tileId = tile.dataset?.tileId;
  if (tileId && _fileNameCache.has(tileId)) return _fileNameCache.get(tileId);
  const urlPattern = _getMediaUrlPattern();
  if (!urlPattern) return null;
  const candidates = [
    ...tile.querySelectorAll(`img[src*="${urlPattern}"]`),
    ...tile.querySelectorAll(`a[href*="${urlPattern}"]`),
    ...tile.querySelectorAll(`[src*="${urlPattern}"]`)
  ];
  if (candidates.length === 0) {
    const img = tile.querySelector('img');
    if (img?.src?.includes(urlPattern)) candidates.push(img);
  }
  for (const el of candidates) {
    const url = el.src || el.href;
    if (!url) continue;
    const fn = extractFileNameFromUrl(url);
    if (fn) {
      // Lưu cache — invalidate cùng lúc với _invalidateTileCache() (250ms TTL)
      if (tileId) _fileNameCache.set(tileId, fn);
      return fn;
    }
  }
  return null;
}

/**
 * Parse file_name UUID từ một URL chứa getMediaUrlRedirect
 */
function extractFileNameFromUrl(url) {
  // Fix audit gen: _getMediaUrlPattern() trả null khi cache lạnh → url.includes(null) coerce thành
  // includes("null") = luôn false → KHÔNG bắt được file_name (kết quả gen rớt). Fallback literal
  // 'getMediaUrlRedirect' (đồng bộ helper ở WorkflowExecutor.extractFileNameFromUrl).
  const _muPat = _getMediaUrlPattern() || 'getMediaUrlRedirect';
  if (!url || !url.includes(_muPat)) return null;
  try {
    const urlObj = new URL(url, window.location.origin);
    // Pattern 1: ?name=UUID (simple)
    const name = urlObj.searchParams.get('name');
    if (name && /^[a-f0-9-]{8,}$/i.test(name)) return name;
    // Pattern 2: tRPC ?input={"json":{"name":"UUID"}} or ?input={"0":{"json":{"name":"UUID"}}}
    const input = urlObj.searchParams.get('input');
    if (input) {
      const parsed = JSON.parse(decodeURIComponent(input));
      const json = parsed?.json || parsed?.['0']?.json || parsed;
      if (json?.name && /^[a-f0-9-]{8,}$/i.test(json.name)) return json.name;
    }
  } catch (e) { globalThis.SEOSONA_swallow?.('content#extractFileNameFromUrl', e); }
  return null;
}

/**
 * MRC-3.4.1.4: Extract thumbnail URL từ tile element
 * @param {Element} tile - Tile DOM element
 * @returns {string|null} - Thumbnail URL hoặc null
 */
function extractThumbnailUrl(tile) {
  if (!tile) return null;

  const _muPat = _getMediaUrlPattern();
  if (_muPat) {
    const imgFlow = tile.querySelector(`img[src*="${_muPat}"]`);
    if (imgFlow?.src) return imgFlow.src;
    const video = tile.querySelector(`video[src*="${_muPat}"]`);
    if (video?.src) return video.src;
  }

  // Legacy: Google CDN URL (có thể vẫn dùng cho một số trường hợp)
  const imgCdn = _q('tile_image', tile);
  if (imgCdn?.src) return imgCdn.src;

  // Fallback: bất kỳ img có src http/https
  const anyImg = tile.querySelector('img[src^="http"]');
  if (anyImg?.src) return anyImg.src;

  // Fallback cuối: img có src bắt đầu bằng /fx/ (relative URL)
  const relativeImg = tile.querySelector('img[src^="/fx/"]');
  if (relativeImg?.src) return relativeImg.src;

  return null;
}

/**
 * Extract actual video URL from video tile for Telegram/download
 * Returns absolute URL (resolves relative /fx/api/... to full https://labs.google/fx/...)
 */
function extractVideoUrl(tile) {
  if (!tile) return null;

  const video = _q('tile_video', tile);
  if (!video) return null;

  let videoUrl = video.src || video.currentSrc || '';
  if (!videoUrl) return null;

  // Resolve relative URL to absolute
  if (!videoUrl.startsWith('http')) {
    try {
      videoUrl = new URL(videoUrl, window.location.origin).href;
    } catch (e) {
      console.warn('[extractVideoUrl] Cannot resolve:', videoUrl);
      return null;
    }
  }

  return videoUrl;
}

/**
 * U-1.1: Extract project_id và file_id từ tile element
 * URL: /fx/vi/tools/flow/project/{project_id}/edit/{file_id}
 */
function extractFlowFileInfo(tile) {
  if (!tile) return null;
  const link = _q('project_link', tile);
  if (!link) return null;
  const match = link.href.match(/\/project\/([a-f0-9-]+)\/edit\/([a-f0-9-]+)/);
  if (!match) return null;
  return { project_id: match[1], file_id: match[2] };
}

/**
 * U-1.1: Lấy project_id hiện tại từ URL hoặc DOM
 * LƯU Ý: Chỉ fallback DOM khi URL có /project/ nhưng thiếu ID.
 *        Khi ở homepage (URL không có /project/), trả về null ngay
 *        để tránh nhầm link đến project khác trên homepage.
 */
function getCurrentProjectId() {
  // Kiểm tra URL trước
  const urlMatch = location.pathname.match(/\/project\/([a-f0-9-]+)/);
  if (urlMatch) return urlMatch[1];

  // Nếu URL không chứa /project/, ta đang ở homepage hoặc trang khác
  // → không có "project hiện tại" → return null
  if (!location.pathname.includes('/project/')) {
    return null;
  }

  // Fallback: URL có /project/ nhưng không có ID (rare case)
  const link = _q('project_link');
  if (link) {
    const m = link.href.match(/\/project\/([a-f0-9-]+)/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Phát hiện Flow project Ở TRẠNG THÁI LỖI/ĐÃ XOÁ.
 * Flow giữ nguyên URL /project/{id} nhưng #__next chỉ render "Đã xảy ra lỗi." + link
 * "Quay lại dự án" (→ /tools/flow), KHÔNG có workspace nào (xem data/dom/flow-error-project-dom.html).
 * → getCurrentProjectId() vẫn trả ID (false-positive) nên cần check bổ sung này.
 *
 * Tín hiệu (Server-Only, không hardcode class hash):
 *   - đang ở URL /project/  +  cache selector đã load (tránh cold-start false)
 *   - KHÔNG có workspace marker nào (slate_editor / submit_button / tile_container / flow_scroll_container)
 *     → loaded project (kể cả rỗng) LUÔN có ít nhất 1 marker; loading page chưa có nhưng cũng chưa có error indicator
 *   - CÓ error indicator (seed key 'project_error_indicator' = link Quay lại dự án)
 * @returns {boolean}
 */
function _isFlowProjectErrorState() {
  if (!location.pathname.includes('/project/')) return false;
  // Cold start: chưa có config selector → chưa kết luận (fail-open, tránh chặn nhầm project hợp lệ)
  if (!_selectorConfig?.flow?.selectors) return false;
  // Loaded project (kể cả chưa có tile) luôn có workspace → KHÔNG phải error.
  // CHỈ dùng marker ĐẶC TRƯNG: slate_editor (contenteditable), submit_button (button), tile_container
  // ([data-tile-id]). KHÔNG dùng flow_scroll_container vì selector '[class*="sc-"]' QUÁ RỘNG — match
  // mọi div styled-component, KỂ CẢ trang lỗi (có <div class="sc-...">) → false-negative detect.
  if (_q('slate_editor') || _q('submit_button') || _q('tile_container')) {
    return false;
  }
  // Không workspace + có error indicator = project lỗi/đã xoá. Loading page (chưa workspace,
  // chưa error indicator) → trả false để không chặn nhầm trong lúc đang tải.
  // Ưu tiên selector server-only; fallback structural (#__next id Next.js ổn định + href semantic
  // "Quay lại dự án" → /tools/flow) để vẫn detect khi selector project_error_indicator CHƯA seed.
  // An toàn vì chỉ chạy SAU khi đã xác nhận KHÔNG có workspace (loaded project luôn có workspace).
  return !!(_q('project_error_indicator') || document.querySelector('#__next a[href$="/tools/flow"]'));
}

/**
 * Flow media viewer mở chưa: URL /project/{id}/edit/{fileId} = đang XEM 1 ảnh/video.
 * Khi đó composer editor KHÔNG sẵn sàng gen mới (gen sẽ fail) — phải quay lại editor (/project/{id}).
 * URL-based: nhanh & chuẩn hơn DOM, không lệ thuộc class hash / aria-label đa ngôn ngữ.
 * getCurrentProjectId() vẫn trả đúng projectId trên URL này (regex chỉ bắt phần /project/{id}).
 * @returns {boolean}
 */
function _isFlowMediaViewerOpen() {
  return /\/project\/[a-f0-9-]+\/edit\/[a-f0-9-]+/.test(location.pathname);
}

/** Chờ thoát media viewer (URL hết /edit/) tối đa maxMs. */
async function _waitExitMediaViewer(maxMs = 3000) {
  for (let i = 0; i < Math.ceil(maxMs / 200); i++) {
    await sleep(200);
    if (!_isFlowMediaViewerOpen()) return true;
  }
  return false;
}

/**
 * Thoát media viewer về editor project (/project/{id}). Chuỗi fallback 3 tầng, mỗi tầng verify URL:
 *  - Tier 1: click nút back viewer (icon arrow_back). Khi viewer mở <nav> biến mất → chỉ 1 arrow_back
 *            → an toàn, không lẫn nav back. SPA, không reload, ở LẠI đúng project (chính xác nhất).
 *  - Tier 2: history.back() (browser back) — SPA về route trước. Verify vẫn đúng project (phòng
 *            overshoot ra homepage khi user deep-link thẳng vào ảnh).
 *  - Tier 3: location.href = URL project sạch (strip /edit/{fileId}) — full reload, luôn về đúng editor.
 * @returns {Promise<boolean>} true nếu đã về editor (URL hết /edit/)
 */
async function _exitFlowMediaViewer() {
  if (!_isFlowMediaViewerOpen()) return true;
  const projectId = getCurrentProjectId();
  const cleanPath = location.pathname.replace(/(\/project\/[a-f0-9-]+)\/edit\/[a-f0-9-]+.*$/, '$1');

  // Tier 1: nút back viewer (arrow_back qua _findIconInElement — Server-Only icon_element config)
  let backBtn = null;
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const icon = _findIconInElement(btn);
    if (icon && icon.textContent.trim() === 'arrow_back') { backBtn = btn; break; }
  }
  if (backBtn) {
    // Robust click (Flow React nghe pointer events, .click() thuần đôi khi không trigger)
    const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
    try { backBtn.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (_) { globalThis.SEOSONA_swallow?.('content#_exitFlowMediaViewer', _); }
    try { backBtn.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (_) { globalThis.SEOSONA_swallow?.('content#_exitFlowMediaViewer', _); }
    try { backBtn.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (_) { globalThis.SEOSONA_swallow?.('content#_exitFlowMediaViewer', _); }
    try { backBtn.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (_) { globalThis.SEOSONA_swallow?.('content#_exitFlowMediaViewer', _); }
    try { backBtn.click(); } catch (_) { globalThis.SEOSONA_swallow?.('content#_exitFlowMediaViewer', _); }
    if (await _waitExitMediaViewer()) return true;
    console.warn('[exitMediaViewer] Tier 1 (nút back) fail → thử history.back()');
  }

  // Tier 2: browser back — về route project trước đó (khi mở ảnh bằng SPA nav)
  try {
    history.back();
    await _waitExitMediaViewer();
    // Chỉ chấp nhận nếu về ĐÚNG project editor (history.back có thể overshoot ra homepage khi deep-link)
    if (!_isFlowMediaViewerOpen() && getCurrentProjectId() === projectId && location.pathname.includes('/project/')) {
      return true;
    }
  } catch (_) { globalThis.SEOSONA_swallow?.('content#_exitFlowMediaViewer', _); }

  // Tier 3: navigate URL project sạch (full reload — last resort, luôn về đúng editor)
  if (cleanPath !== location.pathname) {
    console.warn('[exitMediaViewer] Tier 1+2 fail → reload URL project sạch:', cleanPath);
    location.href = location.origin + cleanPath + location.search;
  }
  return !_isFlowMediaViewerOpen();
}

/**
 * U-1.1: Tìm tile bằng file_id (persistent, không đổi khi reload)
 */
function findTileByFileId(fileId) {
  if (!fileId) return null;
  // Selector key 'edit_link' từ backend (a[href*="/edit/"]). Filter href chứa fileId.
  const editLinks = _qa('edit_link');
  let link = null;
  for (const el of editLinks) {
    if (el.href && el.href.includes(`/edit/${fileId}`)) { link = el; break; }
  }
  return link ? link.closest(_getTileSelectorString()) : null;
}

/**
 * U-1.5: Extract project_name từ Flow header input
 * CRITICAL: Chỉ extract khi đang ở trong project (URL có /project/{id})
 * Không extract khi ở homepage để tránh nhầm input khác làm project name
 */
function extractProjectName() {
  // Guard: chỉ extract project name khi đang ở trong project
  if (!location.pathname.match(/\/project\/[a-f0-9-]+/)) {
    return null;
  }

  // Tìm input project name trong header
  // Strict Server-Only: aria_labels từ backend project_name_input.aria_labels (4 locale).
  // Nằm NGOÀI: tile container, dialog/popup, Slate prompt editor.
  const projectNameLabels = _getFlowLocaleStrings('project_name_input', 'aria_labels');
  const inputs = _queryInputsByAriaLabels(projectNameLabels);
  const _slSel2 = _getSlateEditorSelectorString();
  const slateEditor = _slSel2 ? document.querySelector(_slSel2) : null;
  // Prompt container: bỏ hardcode hash `.sc-45319f81-0`.
  //   Walk-up tìm container CHỨA editor (đảm bảo container chứa cả ref images).
  //   Limit 6 levels — Flow nest editor không quá sâu.
  let promptContainer = null;
  if (slateEditor) {
    let probe = slateEditor.parentElement;
    for (let i = 0; i < 6 && probe; i++) {
      // Container "đúng" là parent có chứa nhiều element (>1 child) — không phải wrapper bare
      if (probe.children.length > 1) { promptContainer = probe; break; }
      probe = probe.parentElement;
    }
    // Fallback: 3-level parent (như cũ) nếu walk-up không tìm
    if (!promptContainer) {
      promptContainer = slateEditor.parentElement?.parentElement?.parentElement;
    }
  }

  for (const input of inputs) {
    // Bug fix 2026-06-21: input tên project nằm trong <nav> (#flow-desktop-header);
    // input tên ẢNH (image viewer header) cùng aria-label "Editable text" nhưng nằm trong
    // <div> thường → trước đây mở ảnh là project sync nhầm tên ảnh. Scope vào <nav>.
    if (!input.closest('nav')) continue;
    // Bỏ qua input rename file nằm trong tile container
    if (input.closest(_getTileSelectorString())) continue;
    // Bỏ qua input trong dialog/popup
    if (input.closest('[role="dialog"]')) continue;
    // Bỏ qua input nằm trong prompt area (Slate editor container)
    if (promptContainer && promptContainer.contains(input)) continue;
    // Bỏ qua input nằm trong cùng parent với Slate editor (extra safety)
    if (slateEditor && input.closest('[data-slate-editor]')) continue;

    const val = input.value?.trim();
    if (val) return val;
  }

  // Fallback: extract từ document.title
  // Format: "Flow - Project Name" hoặc "Project Name - Flow - Labs"
  const title = document.title;
  if (title) {
    const parts = title.split(/\s*[-–—|]\s*/);
    // Tìm phần KHÔNG phải generic text (Flow, Labs, Google...)
    for (const part of parts) {
      const candidate = part.trim();
      if (!candidate || candidate.length === 0 || candidate.length >= 100) continue;
      const lower = candidate.toLowerCase();
      if (lower === 'flow' || lower === 'labs' || lower.includes('labs.google')
        || lower.includes('google')) continue;
      return candidate;
    }
  }

  return null;
}

/**
 * Collect project cards từ Flow homepage DOM (tách từ scanFlowProjects để tái dùng
 * sau mỗi lần scroll lazy-load). Dedup theo project id, preserve thứ tự DOM (flowOrder).
 */
function _collectFlowProjects() {
  const projects = [];
  const seen = new Set();
  let flowOrder = 0;
  const links = _qa('project_link');
  for (const link of links) {
    const m = link.href.match(/\/project\/([a-f0-9-]+)/);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    const order = flowOrder++;

    const card = link.closest(_getTileSelectorString()) || link.parentElement;
    let name = null;
    if (card) {
      // Strategy 1: input rename trong card (project_name_input.aria_labels)
      let renameInput = null;
      const renameLabels = _getFlowLocaleStrings('project_name_input', 'aria_labels');
      for (const label of renameLabels) {
        renameInput = card.querySelector(`input[aria-label="${label}"]`);
        if (renameInput) break;
      }
      if (renameInput?.value?.trim()) name = renameInput.value.trim();

      // Strategy 2: aria-label trên link/card
      if (!name) {
        const ariaLabel = link.getAttribute('aria-label') || card.getAttribute('aria-label');
        if (ariaLabel && ariaLabel.length < 100) name = ariaLabel;
      }

      // Strategy 3: direct text nodes (skip text trong <button> = accessibility label)
      if (!name) {
        const textEls = card.querySelectorAll('span, p');
        for (const el of textEls) {
          if (el.closest('button')) continue;
          let directText = '';
          for (const node of el.childNodes) {
            if (node.nodeType === 3) directText += node.textContent;
          }
          const txt = directText.trim();
          if (!txt || txt.length > 80) continue;
          if (/^\d+$/.test(txt)) continue;
          if (/^(chỉnh sửa|xoá|xóa|edit|delete|remove|sửa|new project|tạo|create)/i.test(txt)) continue;
          name = txt;
          break;
        }
      }
    }
    projects.push({ id: m[1], name, flowOrder: order });
  }
  return projects;
}

/**
 * Auto-scroll Flow homepage để trigger lazy-load TẤT CẢ project cards, rồi return về
 * vị trí scroll ban đầu (1 lần). Anti-loop: dừng khi 2 vòng liên tiếp KHÔNG có project
 * mới VÀ KHÔNG cuộn thêm được (chạm đáy) + hard-cap MAX_STEPS bước.
 * Scroll container: ancestor cuộn được của project link (overflow auto/scroll),
 * fallback window/scrollingElement.
 */
let _autoScrollInFlight = false;
async function _autoScrollLoadProjects() {
  // Guard: 2 sync path gọi đồng thời → tránh fight scroll position. Lần thứ 2 bỏ qua
  // scroll, collect DOM hiện tại (lần đầu vẫn đang lazy-load đủ).
  if (_autoScrollInFlight) return;
  _autoScrollInFlight = true;
  try {
    await _autoScrollLoadProjectsInner();
  } finally {
    _autoScrollInFlight = false;
  }
}

async function _autoScrollLoadProjectsInner() {
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Detect scroll container (walk-up từ project link đầu tiên)
  let scroller = null;
  const firstLink = _qa('project_link')[0];
  if (firstLink) {
    let p = firstLink.parentElement;
    for (let i = 0; i < 12 && p && p !== document.body; i++) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 4) { scroller = p; break; }
      p = p.parentElement;
    }
  }
  const useWindow = !scroller;
  const se = document.scrollingElement || document.documentElement;
  const getTop = () => useWindow ? (window.scrollY || se.scrollTop || 0) : scroller.scrollTop;
  const getMax = () => useWindow ? (se.scrollHeight - window.innerHeight) : (scroller.scrollHeight - scroller.clientHeight);
  const scrollTo = (y) => useWindow ? window.scrollTo(0, y) : (scroller.scrollTop = y);

  const originalTop = getTop();
  const MAX_STEPS = 20; // hard-cap: worst-case ~8s (< caller timeout 12s)
  let lastCount = _qa('project_link').length;
  let stable = 0;

  for (let step = 0; step < MAX_STEPS; step++) {
    const beforeTop = getTop();
    scrollTo(getMax() + 1000); // overshoot để chắc chạm đáy → trigger lazy render
    await sleep(400);

    const count = _qa('project_link').length;
    const grew = count > lastCount;
    const moved = getTop() > beforeTop + 2;
    lastCount = count;

    if (!grew && !moved) {
      if (++stable >= 2) break; // 2 vòng đứng yên → đã hết project
    } else {
      stable = 0;
    }
  }

  scrollTo(originalTop); // return về vị trí ban đầu (1 lần)
  await sleep(120);
}

// Lấy danh sách tile IDs duy nhất trên trang (Google Flow render mỗi tile-id 2 lần trong DOM)
// forceRefresh: true để query DOM mới nhất (dùng trong polling loop), false để dùng cache
function getUniqueTileIds(forceRefresh = false) {
  if (forceRefresh) {
    _invalidateTileCache();
  }
  const tiles = _getCachedTiles();
  return [...new Set([...tiles].map(t => t.dataset.tileId).filter(Boolean))];
}

/**
 * Snapshot tất cả file_name UUIDs hiện có trên page.
 * file_name là persistent (không đổi qua session), dùng để phân biệt
 * tiles cũ lazy-load (file_name đã biết) vs tiles thực sự mới tạo.
 * Tối ưu: batch query tất cả elements có getMediaUrlRedirect URL cùng lúc,
 * thay vì gọi extractFileName() per tile (3 querySelectorAll mỗi cache miss).
 * Reuse extractFileNameFromUrl() để giữ nguyên tất cả URL patterns (simple + tRPC).
 */
function getExistingFileNames() {
  const fileNameSet = new Set();
  const _pat = _getMediaUrlPattern();
  if (!_pat) return fileNameSet;
  const mediaEls = document.querySelectorAll(`[src*="${_pat}"], [href*="${_pat}"]`);
  for (const el of mediaEls) {
    const url = el.src || el.href || '';
    const fn = extractFileNameFromUrl(url);
    if (fn) fileNameSet.add(fn);
  }
  return fileNameSet;
}

/**
 * Kiểm tra tile đã thực sự complete (có file_name)
 * QUAN TRỌNG: Google Flow tạo tile_id ngay khi bắt đầu upload/gen,
 * nhưng file_name (UUID) chỉ có SAU khi server xử lý xong.
 * @param {Element} tile - DOM element có data-tile-id
 * @returns {boolean} - true nếu tile có file_name (complete)
 */
function isTileComplete(tile) {
  if (!tile) return false;
  const fileName = extractFileName(tile);
  return !!fileName;
}

/**
 * Validate tile_id có đúng file (cross-project safety)
 * @param {string} tileId - tile_id cần validate
 * @param {string} expectedFileName - file_name mong đợi
 * @returns {boolean} - true nếu match hoặc không có expected để check
 */
function validateTileFile(tileId, expectedFileName) {
  if (!expectedFileName) return true; // Không có expected → accept
  const tile = _getTileById(tileId);
  if (!tile) return false;
  const currentFileName = extractFileName(tile);
  if (!currentFileName) return true; // Tile chưa complete → accept tạm
  return currentFileName === expectedFileName;
}

/**
 * Click nút "Thử lại" (refresh icon) trên tile bị fail.
 * Dùng React onClick trực tiếp (qua __reactProps$) giống bridge submit.
 * Server-Only fix: Server-Only — đọc selector + icon_text + button_text từ
 * provider_configs.dom_selector.tile_retry_button * Trước fix hardcode: `i.google-symbols` + `'refresh'` → khi Flow đổi UI phải release ext mới.
 * @param {string} tileId - data-tile-id của tile fail
 * @returns {boolean} true nếu tìm & click được nút retry
 */
function clickTileRetryButton(tileId) {
  const tile = _getTileById(tileId);
  if (!tile) return false;

  //  strict Server-Only: 100% config từ server, KHÔNG hardcoded fallback value.
  // Nếu config chưa load (cache miss / migration chưa deploy) → skip retry, degrade gracefully.
  const config = _getDynamicSelector('tile_retry_button');
  if (!config || !Array.isArray(config.selectors) || config.selectors.length === 0) {
    console.warn('[Flow:tile_retry] Config missing/empty — skip retry. Đợi server config sync hoặc admin seed key "tile_retry_button".');
    return false;
  }

  const selectors = config.selectors;
  const iconText = config.icon_text || null;            // null = skip icon match tier
  const buttonTextList = Array.isArray(config.button_text) ? config.button_text : [];

  // Query candidates trong tile bằng selectors từ server (vd: 'button:has(i.google-symbols)').
  let candidates = [];
  for (const sel of selectors) {
    try {
      const found = tile.querySelectorAll(sel);
      candidates.push(...found);
    } catch (e) { /* invalid selector — skip */ }
  }
  if (candidates.length === 0) {
    console.warn('[Flow:tile_retry] No button candidates matched server selectors:', selectors);
    return false;
  }

  // Match button qua icon_text HOẶC button_text (cả 2 đều từ config).
  let retryBtn = null;
  for (const btn of candidates) {
    // Tier 1: icon text match (vd Material Symbol 'refresh' từ config.icon_text)
    if (iconText) {
      const icon = btn.querySelector('i, span, [data-icon]');
      if (icon && icon.textContent.trim() === iconText) {
        retryBtn = btn;
        break;
      }
    }
    // Tier 2: button text label match (vd "Retry"/"Thử lại" từ config.button_text)
    if (buttonTextList.length > 0) {
      const btnText = (btn.textContent || '').trim();
      if (btnText && buttonTextList.some(label => btnText.includes(label))) {
        retryBtn = btn;
        break;
      }
    }
  }
  if (!retryBtn) return false;

  // Ưu tiên React onClick trực tiếp (bypass DOM event system)
  const propsKey = Object.keys(retryBtn).find(k => k.startsWith('__reactProps$'));
  if (propsKey && retryBtn[propsKey] && typeof retryBtn[propsKey].onClick === 'function') {
    try {
      retryBtn[propsKey].onClick({
        preventDefault: function(){},
        stopPropagation: function(){},
        nativeEvent: new MouseEvent('click'),
        type: 'click',
        target: retryBtn,
        currentTarget: retryBtn
      });
      return true;
    } catch (e) {
      console.warn('[SEOSONA Flow] React onClick retry failed:', e.message);
    }
  }

  // Fallback: native click
  simulateClick(retryBtn);
  return true;
}

/**
 * Click retry button trên tile upload fail (khác với gen retry).
 * Upload retry KHÔNG tạo tile mới — chỉ re-render CÙNG tile.
 * Reuse config key: tile_retry_button (DOM selector giống nhau, chỉ khác behavior)
 * @param {string} tileId - data-tile-id của tile upload fail
 * @returns {boolean} true nếu tìm & click được nút retry
 */
function clickUploadRetryButton(tileId) {
  const tile = _getTileById(tileId);
  if (!tile) return false;

  // Reuse tile_retry_button config — DOM selector giống nhau cho cả gen fail và upload fail
  const config = _getDynamicSelector('tile_retry_button');
  if (!config || !Array.isArray(config.selectors) || config.selectors.length === 0) {
    console.warn('[Flow:upload_retry] Config missing/empty — skip retry. Check key "tile_retry_button" trong admin.');
    return false;
  }

  const selectors = config.selectors;
  const iconText = config.icon_text || null;
  const buttonTextList = Array.isArray(config.button_text) ? config.button_text : [];

  // Query candidates trong tile bằng selectors từ server
  let candidates = [];
  for (const sel of selectors) {
    try {
      const found = tile.querySelectorAll(sel);
      candidates.push(...found);
    } catch (e) { /* invalid selector — skip */ }
  }
  if (candidates.length === 0) {
    console.warn('[Flow:upload_retry] No button candidates matched server selectors:', selectors);
    return false;
  }

  // Match button qua icon_text HOẶC button_text
  let retryBtn = null;
  for (const btn of candidates) {
    // Tier 1: icon text match
    if (iconText) {
      const icon = btn.querySelector('i, span, [data-icon]');
      if (icon && icon.textContent.trim() === iconText) {
        retryBtn = btn;
        break;
      }
    }
    // Tier 2: button text label match
    if (buttonTextList.length > 0) {
      const btnText = (btn.textContent || '').trim();
      if (btnText && buttonTextList.some(label => btnText.includes(label))) {
        retryBtn = btn;
        break;
      }
    }
  }
  if (!retryBtn) {
    console.warn('[Flow:upload_retry] No button matched icon_text/button_text criteria');
    return false;
  }

  // Ưu tiên React onClick (bypass DOM event system)
  const propsKey = Object.keys(retryBtn).find(k => k.startsWith('__reactProps$'));
  if (propsKey && retryBtn[propsKey] && typeof retryBtn[propsKey].onClick === 'function') {
    try {
      retryBtn[propsKey].onClick({
        preventDefault: function(){},
        stopPropagation: function(){},
        nativeEvent: new MouseEvent('click'),
        type: 'click',
        target: retryBtn,
        currentTarget: retryBtn
      });
      console.log('[Flow:upload_retry] React onClick triggered for tile:', tileId);
      return true;
    } catch (e) {
      console.warn('[Flow:upload_retry] React onClick failed:', e.message);
    }
  }

  // Fallback: native click
  simulateClick(retryBtn);
  console.log('[Flow:upload_retry] Native click triggered for tile:', tileId);
  return true;
}

// Deduplication lock: track tiles đang được retry để tránh concurrent retry cùng tile
var _retryingTiles = new Set();

// Track tiles đã click retry button — ngăn click lại cùng tile khi waitForNewTiles timeout
// Khi timeout, tile gốc vẫn 'failed' trên DOM nhưng Flow đã tạo tile MỚI đang xử lý.
// Click lại sẽ tạo thêm tile DƯ (double generation). Set này ngăn điều đó.
var _clickedRetryTileIds = new Set();

// Global mutex cho retry operations: serialize tất cả retries để tránh cross-contamination
var _retryMutex = null;

/**
 * Acquire retry mutex - đảm bảo chỉ 1 retry operation chạy tại 1 thời điểm
 * @returns {Promise<Function>} Release function
 */
async function _acquireRetryMutex() {
  // Timeout safety: nếu mutex bị stuck > 120s, force release
  const maxWait = 120000;
  const startWait = Date.now();
  while (_retryMutex) {
    if (Date.now() - startWait > maxWait) {
      console.warn('[SEOSONA Flow] Retry mutex stuck > 120s, force release');
      _retryMutex = null;
      break;
    }
    await _retryMutex;
  }
  let release;
  _retryMutex = new Promise(r => { release = r; });
  return () => {
    release();
    _retryMutex = null;
  };
}

/**
 * Retry failed tiles bằng cách click nút "Thử lại" trên từng tile.
 * Chờ tile chuyển từ 'processing' → 'success'/'failed'.
 * SERIAL: Click từng tile, chờ kết quả, rồi click tile tiếp theo.
 * @param {string[]} failedTileIds - Danh sách tile IDs bị fail
 * @param {number} timeoutMs - Timeout chờ mỗi tile (ms)
 * @returns {{ succeeded: string[], stillFailed: string[] }}
 */
async function retryFailedTilesViaButton(failedTileIds, timeoutMs = 120000, excludeTileIds = null) {
  const succeeded = [];
  const stillFailed = [];
  let clickedCount = 0;       // Số button retry đã thực sự click trong call này
  let skippedAlreadyClicked = 0; // Số tile skip vì đã click trước đó

  // DEDUPLICATION: Filter out tiles đang được retry bởi call khác
  // VÀ tiles đã click retry (ngăn double-click khi timeout)
  const toRetry = failedTileIds.filter(tid => !_retryingTiles.has(tid) && !_clickedRetryTileIds.has(tid));
  const alreadyClicked = failedTileIds.filter(tid => _clickedRetryTileIds.has(tid));
  skippedAlreadyClicked = alreadyClicked.length;
  if (alreadyClicked.length > 0) {
    console.log(`[SEOSONA Flow] ${alreadyClicked.length} tile đã click retry trước đó (skip để tránh tạo dư):`, alreadyClicked.map(t => t.substring(0, 12)));
    // Tiles đã click retry nhưng timeout → không tính là stillFailed (đang xử lý trên Flow)
    // Không push vào stillFailed để tránh outer loop re-click
  }
  if (toRetry.length === 0) {
    console.log('[SEOSONA Flow] Tất cả tiles đã đang được retry hoặc đã click retry, skip');
    return {
      succeeded: [],
      stillFailed: failedTileIds.filter(tid => !_clickedRetryTileIds.has(tid)),
      clickedCount: 0,
      skippedAlreadyClicked,
    };
  }

  // Mark tiles as retrying (lock)
  toRetry.forEach(tid => _retryingTiles.add(tid));

  const excludeSet = excludeTileIds?.length > 0 ? new Set(excludeTileIds) : null;

  // Acquire global retry mutex: serialize tất cả retries across concurrent calls
  // Ngăn race condition khi multiple TileMonitors gọi retry đồng thời
  const releaseMutex = await _acquireRetryMutex();

  try {
    // SERIAL RETRY FIX: Click từng tile riêng lẻ, chờ kết quả, rồi click tile tiếp theo
    // Lý do: Batch click + waitForNewTiles gây cross-contamination trong parallel mode
    // vì không thể phân biệt tile nào thuộc retry nào khi nhiều retries chạy đồng thời
    for (const tileId of toRetry) {
      if (shouldStop) {
        stillFailed.push(tileId);
        continue;
      }

      // Fix: Re-check status TRƯỚC khi click retry — Flow đôi khi flicker UI
      // 'failed' transient (vd loading state) trước khi thực sự render 'success'.
      // Nếu tile giờ đã success → skip click (tránh tạo retry tile dư thừa).
      const currentTile = _getTileById(tileId);
      const currentStatus = detectTileStatus(currentTile);
      if (currentStatus === 'success') {
        console.log(`[SEOSONA Flow] Retry skipped: tile ${tileId.substring(0, 12)}... đã success (transient 'failed' state)`);
        succeeded.push(tileId);
        continue;
      }
      if (currentStatus === 'processing') {
        console.log(`[SEOSONA Flow] Retry skipped: tile ${tileId.substring(0, 12)}... đang processing`);
        // Không push stillFailed vì có thể tile đang resolve → tránh outer loop click thêm
        continue;
      }

      // Snapshot baseline TRƯỚC khi click retry tile này
      // forceRefresh=true vì cần baseline chính xác trước khi click
      const preTileIds = getUniqueTileIds(true);
      const preFileNames = getExistingFileNames();

      // Bug fix: serialize cú click retry với context-menu (addFileToPrompt/download) — tránh click
      // làm văng context menu của prompt đang gắn ref → prompt đó fail giả "Context menu không mở được".
      // Chỉ giữ lock quanh click (ngắn); phần waitForNewTiles (dài) chạy NGOÀI lock.
      await _acquireCtxMenuLock();
      let clicked;
      try {
        clicked = clickTileRetryButton(tileId);
        await sleep(getInputTimeoutMs());
      } finally {
        _releaseCtxMenuLock();
      }
      if (!clicked) {
        console.warn('[SEOSONA Flow] Retry button not found for tile:', tileId);
        stillFailed.push(tileId);
        continue;
      }

      // Track tile đã click retry — ngăn click lại nếu timeout
      _clickedRetryTileIds.add(tileId);
      clickedCount++;

      sendLog(`[Retry L1] Click nút retry tile...`, 'info');

      // Wait retry tile xuất hiện + settle. waitForNewTiles ĐÃ:
      //   1. Poll DOM cho tile mới appear (qua MutationObserver + interval)
      //   2. Wait status settle ('success'/'failed' với file_name)
      //   3. Return khi allDone HOẶC timeout
      // Trong fail-prone hour, Flow có thể tạo retry tile rất chậm (100-200s) → cần
      // timeout đủ lớn. Dùng `timeoutMs` từ caller (TileMonitor pass `this._timeout=180000`)
      // để tránh duplicate phase wait redundant.
      const retryTimeout = Math.max(timeoutMs, 180000);
      const result = await waitForNewTiles(preTileIds, retryTimeout, preFileNames);
      let newTiles = result?.tiles || [];
      if (excludeSet && newTiles.length > 0) {
        newTiles = newTiles.filter(tid => !excludeSet.has(tid));
      }

      // Chỉ lấy 1 tile mới nhất (đây là tile từ retry này, lấy oldest = slice(-1))
      if (newTiles.length > 1) {
        console.log(`[SEOSONA Flow] Retry single tile got ${newTiles.length} tiles, taking oldest`);
        newTiles = newTiles.slice(-1);
      }

      if (newTiles.length > 0) {
        const newTileId = newTiles[0];
        // waitForNewTiles ĐÃ wait settle internally — chỉ return tile khi allDone (status =
        // 'success'/'failed' + có file_name). Status check tại đây an toàn, không cần wait
        // settle thêm (redundant, cause confusion). Xem content.js:2812-2834.
        const tile = _getTileById(newTileId);
        const status = detectTileStatus(tile);
        if (status === 'failed') {
          stillFailed.push(newTileId);
          console.log(`[SEOSONA Flow] Retry tile ${tileId.substring(0, 12)}... → new tile ${newTileId.substring(0, 12)}... FAILED`);
        } else if (status === 'success') {
          succeeded.push(newTileId);
          console.log(`[SEOSONA Flow] Retry tile ${tileId.substring(0, 12)}... → new tile ${newTileId.substring(0, 12)}... SUCCESS`);
        } else {
          // Defensive: status='processing' không nên xảy ra (waitForNewTiles đã settle),
          // nhưng nếu Flow update DOM bất ngờ → coi như stillFailed an toàn.
          stillFailed.push(newTileId);
          console.log(`[SEOSONA Flow] Retry tile ${tileId.substring(0, 12)}... → new tile ${newTileId.substring(0, 12)}... unexpected PROCESSING status, treat as failed`);
        }
      } else {
        // Cả phase 1 + phase 2 đều timeout (tổng ~120s) → Flow thực sự không tạo tile mới
        // (có thể Flow throttle hoặc tile bị lỗi nội bộ).
        // KHÔNG push vào stillFailed → ngăn outer loop click retry LẦN NỮA trên tile này
        // (click lại sẽ tạo THÊM 1 tile dư — double generation).
        // _clickedRetryTileIds đã track tile này, lần gọi tiếp sẽ skip.
        console.log(`[SEOSONA Flow] Retry tile ${tileId.substring(0, 12)}... → cả 2 phase timeout (~120s), skip để tránh tạo dư`);
      }

      // Delay nhỏ trước khi retry tile tiếp theo
      if (toRetry.indexOf(tileId) < toRetry.length - 1) {
        await sleep(300);
      }
    }

    // Xóa duplicate (nếu có)
    const uniqueSucceeded = [...new Set(succeeded)];
    const uniqueFailed = [...new Set(stillFailed)];

    return {
      succeeded: uniqueSucceeded,
      stillFailed: uniqueFailed,
      clickedCount,           // Số button retry đã thực sự click trong call này
      skippedAlreadyClicked,  // Số tile skip vì đã click trước đó
    };

  } finally {
    // Release lock: xóa tiles khỏi retrying set
    toRetry.forEach(tid => _retryingTiles.delete(tid));
    // Release global retry mutex
    releaseMutex();
  }
}

// Detect trạng thái tile trên Google Flow
// Returns: 'success' | 'failed' | 'processing'
// CRITICAL: Check warning icon TRƯỚC img/video — failed tiles có thể có cached <img>
// Processing tiles pre-render warning icon hidden (opacity:0) - must check visibility
function detectTileStatus(tileEl) {
  if (!tileEl) return 'processing';

  // Kiểm tra cache (TTL 1.5 giây) — giảm 4+ DOM queries/tile khi gọi từ nhiều polling loops
  var _statusTileId = tileEl.dataset?.tileId;
  if (_statusTileId) {
    var _cached = _statusCache.get(_statusTileId);
    if (_cached && (Date.now() - _cached.ts) < 1500) return _cached.status;
  }

  // 1. Check success TRƯỚC — có media với src hợp lệ
  const media = _q('tile_video', tileEl) || tileEl.querySelector('img');
  if (media && media.src && !media.src.startsWith('data:')) {
    const mediaSrc = media.src || '';
    const rawSrc = media.getAttribute('src') || '';
    const isPlaceholder =
      mediaSrc.includes('media.html') ||
      mediaSrc.endsWith('.html') ||
      rawSrc === 'media.html' ||
      rawSrc.endsWith('.html') ||
      (!mediaSrc.startsWith('http://') && !mediaSrc.startsWith('https://') && !mediaSrc.startsWith('blob:'));
    if (!isPlaceholder) {
      if (_statusTileId) _statusCache.set(_statusTileId, { status: 'success', ts: Date.now() });
      return 'success';
    }
  }

  // [Fix] Early detect 'processing' via progress % marker.
  //   flow-tile-generating.md: tile có "<div>N%</div>" khi đang gen.
  //   Tile cũ không có element này → safe filter.
  // CRITICAL ORDER: Check % TRƯỚC warning (bước 3 dưới) vì:
  //   1. Tile transitional (vừa fail xong, đang re-gen — xem flow-tile-generating.md)
  //      có CẢ % VÀ warning icon (warning bị ẩn opacity:0). Phải return 'processing'
  //      đúng, không nhầm 'failed'.
  //   2. % marker rẻ hơn warning hidden-detect (warning cần walk parents check opacity).
  //   3. Resilient hơn nếu Flow đổi cách hide warning (CSS animation thay vì opacity:0).
  // KHÔNG ĐẢO THỨ TỰ này.
  // Filter `children.length > 2` align với extractTileProgress (line ~2882) — tránh
  // div ancestor có textContent ngẫu nhiên match "X%" (defensive nếu Flow đổi DOM).
  const progressEl = Array.from(tileEl.querySelectorAll('div')).find(d => {
    if (d.children.length > 2) return false;
    return /^\d+%$/.test(d.textContent.trim());
  });
  if (progressEl) {
    if (_statusTileId) _statusCache.set(_statusTileId, { status: 'processing', ts: Date.now() });
    return 'processing';
  }

  // 1b. [Fix 2026-08] VIDEO đang gen: layer gen có icon `play_circle`; overlay "Failed" là DEFAULT
  // HARDCODED của Flow (luôn trong DOM, ẩn opacity:0 khi gen — visible khi fail thật). Khi số `%`
  // biến mất TẠM giữa các phase gen + Flow lật opacity → warning thành visible → nhầm 'failed' →
  // Stagnation reload KILL video đang gen. Tín hiệu ỔN ĐỊNH: `play_circle` còn hiện (visible) = ĐANG
  // gen → 'processing'. Completed video có media src hợp lệ → đã bắt ở success-check phía trên;
  // fail thật KHÔNG có play_circle (chỉ refresh/undo/delete). Image gen không có play_circle → bỏ qua.
  // `play_circle` là Material Symbol identifier (cho phép inline); `i` là tag, không phải CSS class brittle.
  const _isElVisible = (el) => {
    try {
      const c = window.getComputedStyle(el);
      if (c.opacity === '0' || c.visibility === 'hidden' || c.display === 'none') return false;
    } catch (e) { /* ignore */ }
    let p = el.parentElement;
    while (p && p !== tileEl) {
      if (p.style && p.style.opacity === '0') return false;
      try {
        const c = window.getComputedStyle(p);
        if (c.opacity === '0' || c.visibility === 'hidden' || c.display === 'none') return false;
      } catch (e) { /* ignore */ }
      p = p.parentElement;
    }
    return true;
  };
  const genIcon = Array.from(tileEl.querySelectorAll('i')).find(el => el.textContent.trim() === 'play_circle');
  if (genIcon && _isElVisible(genIcon)) {
    // KHÔNG cache — trạng thái tạm (% có thể quay lại), cần check lại nhanh.
    return 'processing';
  }

  // 2. Check failed — warning icon visible (chỉ khi chưa có media hợp lệ)
  // CRITICAL: Dùng getComputedStyle vì Google Flow có thể dùng CSS class để ẩn warning icon
  // Strict Server-Only: warning_icon.selectors + text_match từ backend (đã seed text_match='warning').
  const warningConfig = _getDynamicSelector('warning_icon');
  let warningText = warningConfig?.text_match;
  if (!warningText) {
    console.debug('[Tier3] warning detection: warning_icon.text_match cache miss');
    warningText = '';
  }
  let warningIcons = [];
  if (Array.isArray(warningConfig?.selectors) && warningConfig.selectors.length > 0) {
    for (const sel of warningConfig.selectors) {
      try {
        const found = tileEl.querySelectorAll(sel);
        if (found.length > 0) { warningIcons = Array.from(found); break; }
      } catch (e) { /* invalid selector — try next */ }
    }
  }
  for (const icon of warningIcons) {
    if (icon.textContent.trim() !== warningText) continue;

    // CRITICAL: Check icon element itself TRƯỚC, không chỉ parents
    // Google Flow có thể hide icon trực tiếp bằng opacity/visibility/display
    let isHidden = false;
    try {
      const iconComputed = window.getComputedStyle(icon);
      if (iconComputed.opacity === '0' || iconComputed.visibility === 'hidden' || iconComputed.display === 'none') {
        isHidden = true;
      }
    } catch (e) { /* ignore */ }

    // Walk up parents to check if hidden (opacity:0, visibility:hidden, display:none)
    if (!isHidden) {
      let parent = icon.parentElement;
      while (parent && parent !== tileEl) {
        // Check inline style first (fast path)
        if (parent.style && parent.style.opacity === '0') {
          isHidden = true;
          break;
        }
        // Check computed style (covers CSS class)
        try {
          const computed = window.getComputedStyle(parent);
          if (computed.opacity === '0' || computed.visibility === 'hidden' || computed.display === 'none') {
            isHidden = true;
            break;
          }
        } catch (e) { /* ignore */ }
        parent = parent.parentElement;
      }
    }

    if (!isHidden) {
      // KHÔNG cache 'failed' — có thể là false positive khi tile đang processing
      // MIN_FAIL_DETECT_MS đã handle việc chờ đủ lâu trong waitForNewTiles
      return 'failed';
    }
  }

  // Không cache 'processing' — trạng thái tạm thời, cần kiểm tra lại nhanh
  return 'processing';
}

/**
 * MRC-3.4.1: Detect media type của tile (image hoặc video)
 * @param {Element} tile - Tile DOM element
 * @returns {string} - 'image' | 'video'
 */
function detectMediaType(tile) {
  if (!tile) return 'image';
  // Ưu tiên video trước — video tiles có cả <img> (ref) lẫn <video> (result)
  const video = _q('tile_video', tile);
  if (video) return 'video';
  // Fallback: detect video tile via img alt="Video thumbnail" (video element may not render yet)
  const img = tile.querySelector('img');
  if (img?.alt?.toLowerCase().includes('video')) return 'video';
  // [Fix 2026-08] Video ĐANG GEN sớm: CHƯA có <video>/img → trước fix trả 'image' (default) → re-adopt
  // filter (TileMonitor) lọc media_type==='video' loại nhầm tile video đang gen → fail + reload.
  // `play_circle` chỉ có ở tile VIDEO (gen layer hoặc nút play); image gen KHÔNG có → vẫn 'image'.
  // Completed video đã trả 'video' ở check <video> phía trên nên không tới đây. (Material Symbol inline OK.)
  if (Array.from(tile.querySelectorAll('i')).some(el => el.textContent.trim() === 'play_circle')) return 'video';
  return 'image';
}

// Đọc % tiến độ gen từ DOM tile (heuristic: tìm element chứa "NN%")
function extractTileProgress(tileEl) {
  if (!tileEl) return null;
  // Chỉ scan các tag phổ biến chứa text — giảm ~80% elements so với querySelectorAll('*')
  var els = tileEl.querySelectorAll('span, div, p');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    // Chỉ check leaf nodes hoặc nodes có ít children (tránh parent match children text)
    if (el.children.length > 2) continue;
    var text = el.textContent.trim();
    if (/^\d{1,3}%$/.test(text)) {
      return parseInt(text, 10);
    }
  }
  return null;
}

async function waitForNewTiles(preTileIds, timeoutMs = 120000, preFileNames = null, maxQuantity = 0) {
  const startTime = Date.now();
  const MIN_FAIL_DETECT_MS = 15000;
  const LAZY_LOAD_GRACE_MS = 15000; // Chờ 15s trước khi chấp nhận tiles "success" ngay lập tức
  const preTileSet = new Set(preTileIds);
  const knownFileNames = preFileNames || new Set();

  // CRITICAL: Đảm bảo image_url_pattern config loaded trước khi monitor
  // Nếu config chưa load, extractFileName() return null → monitor stuck forever
  const urlPattern = await _getMediaUrlPatternAsync(5000);
  if (!urlPattern) {
    console.error('[waitForNewTiles] ❌ image_url_pattern config not loaded after 5s — cannot extract file_name, monitor will fail');
    sendLog('⚠️ Config chưa sẵn sàng, vui lòng thử lại', 'warn');
  } else {
    console.log('[waitForNewTiles] ✅ image_url_pattern ready: ' + urlPattern);
  }

  // Layer 3: Track tiles đã xác nhận là genuinely new (từng thấy ở trạng thái "processing")
  // Tiles genuinely new: Google Flow tạo placeholder (processing) → rồi chuyển success
  // Tiles lazy-loaded: xuất hiện đã có ảnh (success ngay), chưa bao giờ ở processing
  let confirmedNewTiles = null; // null = chưa xác nhận, Set = đã lock tiles chính xác
  let firstNewDetectedAt = 0;   // Thời điểm phát hiện tile mới lần đầu

  // P3-1: MutationObserver phát hiện DOM thay đổi nhanh hơn polling
  // Khi observer fire, đánh dấu pendingCheck để check ngay ở cycle tiếp theo
  let pendingCheck = false;
  const tileContainer = document.querySelector(_getTileSelectorString())?.parentElement || document.body;
  const observer = new MutationObserver(() => {
    pendingCheck = true;
  });
  observer.observe(tileContainer, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'src', 'data-tile-id']
  });

  // Dọn dẹp observer khi function kết thúc
  const cleanup = () => { observer.disconnect(); };

  try {
  while (Date.now() - startTime < timeoutMs) {
    if (shouldStop) { cleanup(); return { tiles: [], failed: false }; }

    // Nếu observer phát hiện thay đổi DOM, chờ 200ms để DOM ổn định rồi check ngay
    // Nếu không có thay đổi, poll fallback mỗi 5s (giảm từ 2s nhờ observer cover fast detection)
    if (pendingCheck) {
      pendingCheck = false;
      await sleep(200);
    } else {
      await sleep(5000);
    }

    // forceRefresh=true vì đây là polling loop cần data mới nhất từ DOM
    const currentTiles = getUniqueTileIds(true);
    let newTiles = currentTiles.filter(id => !preTileSet.has(id));

    if (newTiles.length > 0) {
      // Layer 2: Lọc tiles cũ lazy-load bằng file_name (persistent UUID)
      if (knownFileNames.size > 0) {
        newTiles = newTiles.filter(tid => {
          const tile = _getTileById(tid);
          const fn = extractFileName(tile);
          return !fn || !knownFileNames.has(fn);
        });
        if (newTiles.length === 0) continue;
      }

      // Layer 3: Xác nhận tiles genuinely new bằng processing state
      if (confirmedNewTiles === null) {
        if (!firstNewDetectedAt) firstNewDetectedAt = Date.now();

        // Tìm tiles đang processing (genuinely new — Google Flow vừa tạo placeholder)
        const processingTiles = newTiles.filter(tid => {
          const tile = _getTileById(tid);
          return detectTileStatus(tile) !== 'success';
        });

        // Tìm tiles đã success nhưng file_name mới (genuinely new, hoàn thành nhanh trước poll)
        // Nếu file_name không nằm trong baseline → chắc chắn là kết quả mới, không phải lazy-load
        const fastCompletedTiles = newTiles.filter(tid => {
          if (processingTiles.includes(tid)) return false;
          const tile = _getTileById(tid);
          const fn = extractFileName(tile);
          return fn && knownFileNames.size > 0 && !knownFileNames.has(fn);
        });

        if (processingTiles.length > 0 || fastCompletedTiles.length > 0) {
          // Lock tiles genuinely new (processing hoặc fast-completed với file_name mới)
          confirmedNewTiles = new Set([...processingTiles, ...fastCompletedTiles]);
        } else if (Date.now() - firstNewDetectedAt > LAZY_LOAD_GRACE_MS) {
          // Đã chờ đủ lâu mà chỉ thấy "success" tiles → chấp nhận (fast generation edge case)
          confirmedNewTiles = new Set(newTiles);
        } else {
          // Chỉ thấy "success" tiles → có thể lazy-load, chờ thêm processing tiles
          continue;
        }
      } else {
        // Nếu có tile mới xuất hiện (thêm vào confirmed set)
        for (const tid of newTiles) {
          if (confirmedNewTiles.has(tid)) continue;
          const tile = _getTileById(tid);
          if (detectTileStatus(tile) !== 'success') {
            // Tile đang processing → genuinely new
            confirmedNewTiles.add(tid);
          } else {
            // Tile đã success: check file_name mới (fast-completed, không phải lazy-load)
            const fn = extractFileName(tile);
            if (fn && knownFileNames.size > 0 && !knownFileNames.has(fn)) {
              confirmedNewTiles.add(tid);
            }
          }
        }
      }

      // Chỉ track confirmed tiles
      newTiles = newTiles.filter(id => confirmedNewTiles.has(id));
      if (newTiles.length === 0) continue;

      // maxQuantity: giới hạn tiles cho parallel nodes
      // Google Flow DOM là newest-first → tile mới nhất ở ĐẦU, cũ nhất ở CUỐI
      // Submit mutex serialize: node_01 submit TRƯỚC → tile_A CŨ hơn → nằm ở CUỐI list
      // → slice(-maxQuantity) lấy tiles CŨ nhất = tiles của node submit SỚM nhất
      if (maxQuantity > 0 && newTiles.length > maxQuantity) {
        newTiles = newTiles.slice(-maxQuantity);
      }

      // Check completion status
      // QUAN TRỌNG: tile chỉ "complete" khi có file_name (UUID)
      // file_name chỉ có sau khi upload/gen thực sự hoàn thành trên server
      // PHẢI chờ TẤT CẢ tiles settle (không còn processing) trước khi return
      const elapsed = Date.now() - startTime;
      let allDone = true;
      let anyFailed = false;
      for (const tid of newTiles) {
        const tile = _getTileById(tid);
        const status = detectTileStatus(tile);
        if (status === 'failed' && elapsed >= MIN_FAIL_DETECT_MS) { anyFailed = true; continue; }
        if (status === 'processing' || (status === 'failed' && elapsed < MIN_FAIL_DETECT_MS)) { allDone = false; break; }
        // Check file_name exists (true completion indicator)
        const fileName = extractFileName(tile);
        if (!fileName && status === 'success') {
          // Tile hiển thị success nhưng chưa có file_name → chưa thực sự complete
          allDone = false;
          break;
        }
      }
      // Chờ tất cả tiles settle trước khi return failed (tránh return sớm khi còn tile processing)
      if (anyFailed && allDone) { cleanup(); return { tiles: newTiles, failed: true }; }
      if (!anyFailed && allDone) {
        // Capture thumbnail URLs + file_name (persistent across sessions)
        const thumbnails = {};
        for (const tid of newTiles) {
          const tile = _getTileById(tid);
          if (!tile) continue;
          const img = tile.querySelector('img');
          let video = _q('tile_video', tile);

          // CRITICAL: Video element có thể render SAU khi tile status = 'success'
          // Google Flow lazy-render video element — poll tối đa 10 giây để chờ video xuất hiện
          // Video tiles dài hơn (8s, 10s) có thể cần thêm thời gian render
          // Early detect video tile via alt="Video thumbnail" trên <img>
          const isVideoTileHint = img?.alt?.toLowerCase().includes('video');
          if (!video && isVideoTileHint) {
            const pollVideoStart = Date.now();
            const POLL_VIDEO_TIMEOUT = 10000; // 10 giây max wait (tăng từ 3s)
            const POLL_VIDEO_INTERVAL = 500; // Poll mỗi 500ms
            while (!video && Date.now() - pollVideoStart < POLL_VIDEO_TIMEOUT) {
              await sleep(POLL_VIDEO_INTERVAL);
              video = _q('tile_video', tile);
            }
            if (video) {
              sendLog('[waitForNewTiles] Đã phát hiện <video> sau ' + (Date.now() - pollVideoStart) + 'ms delay', 'info');
            } else {
              sendLog('[waitForNewTiles] Video element không xuất hiện sau ' + POLL_VIDEO_TIMEOUT + 'ms, fallback img-based video detection', 'warn');
            }
          }

          const fileName = extractFileName(tile);
          const flowInfo = extractFlowFileInfo(tile);
          // Video detection: ưu tiên check <video> trước
          if (video) {
            // CRITICAL: Poll để chờ video.src có giá trị hợp lệ
            // Google Flow lazy-load video src — element xuất hiện trước, src xuất hiện sau
            let videoUrl = video.src || video.currentSrc || '';
            if (!videoUrl || videoUrl.length < 10) {
              const pollSrcStart = Date.now();
              const POLL_SRC_TIMEOUT = 3000; // 3 giây max wait cho src
              const POLL_SRC_INTERVAL = 200;
              while ((!videoUrl || videoUrl.length < 10) && Date.now() - pollSrcStart < POLL_SRC_TIMEOUT) {
                await sleep(POLL_SRC_INTERVAL);
                videoUrl = video.src || video.currentSrc || '';
              }
              if (videoUrl && videoUrl.length > 10) {
                sendLog('[waitForNewTiles] Video src loaded sau ' + (Date.now() - pollSrcStart) + 'ms: ' + videoUrl.substring(0, 60), 'info');
              }
            }

            // Resolve relative URL thành absolute (Google Flow dùng relative /fx/api/...)
            if (videoUrl && !videoUrl.startsWith('http')) {
              try {
                videoUrl = new URL(videoUrl, window.location.origin).href;
              } catch (e) {
                console.warn('[waitForNewTiles] Cannot resolve video URL:', videoUrl);
              }
            }

            // video_url: actual video URL để backend gửi qua Telegram
            // thumbnail: poster image hoặc fallback
            let vThumb = video.poster || '';
            if (!vThumb && img?.src && !img.src.includes('chrome-extension')) vThumb = img.src;
            if (!vThumb && videoUrl) vThumb = videoUrl; // Fallback: dùng video URL làm thumbnail
            thumbnails[tid] = {
              thumbnail: vThumb,
              type: 'video',
              video_url: videoUrl,  // Actual video URL để backend download + gửi qua Telegram
              ...(fileName && { file_name: fileName }),
              ...(flowInfo && { file_id: flowInfo.file_id, project_id: flowInfo.project_id })
            };
          } else if (img?.src && !img.src.includes('chrome-extension')) {
            // Detect video tile via alt="Video thumbnail" — set type='video' even without <video> element
            // Flow render img thumbnail trước, video element có thể không xuất hiện trong DOM timeout
            const isVideoByAlt = img.alt?.toLowerCase().includes('video');
            if (isVideoByAlt) {
              // Video tile nhưng không có video element → dùng img URL làm video_url fallback
              thumbnails[tid] = {
                thumbnail: img.src,
                type: 'video',
                video_url: img.src, // Fallback: dùng thumbnail URL — backend có thể retry lấy video
                ...(fileName && { file_name: fileName }),
                ...(flowInfo && { file_id: flowInfo.file_id, project_id: flowInfo.project_id })
              };
              sendLog('[waitForNewTiles] Video tile detected via alt attribute, no <video> element — using img fallback', 'warn');
            } else {
              thumbnails[tid] = { thumbnail: img.src, type: 'image', ...(fileName && { file_name: fileName }), ...(flowInfo && { file_id: flowInfo.file_id, project_id: flowInfo.project_id }) };
            }
          }
        }
        cleanup();
        return { tiles: newTiles, failed: false, thumbnails };
      }
    }
  }
  cleanup();
  return { tiles: [], failed: false };
  } catch (err) {
    // Đảm bảo observer luôn được disconnect kể cả khi có lỗi
    cleanup();
    throw err;
  }
}

/**
 * Wait for new tiles after submit and optionally auto-download
 */
async function waitAndDownloadNewTiles(preTileIds, promptText, timeoutMs = 120000) {
  const startTime = Date.now();
  const MIN_FAIL_DETECT_MS = 15000;
  while (Date.now() - startTime < timeoutMs) {
    await sleep(2000);
    // forceRefresh=true vì đây là polling loop cần data mới nhất từ DOM
    const currentTiles = getUniqueTileIds(true);
    const newTiles = currentTiles.filter(id => !preTileIds.includes(id));

    if (newTiles.length > 0) {
      const elapsed = Date.now() - startTime;
      let allDone = true;
      let anyFailed = false;
      for (const tid of newTiles) {
        const tile = _getTileById(tid);
        const status = detectTileStatus(tile);
        if (status === 'failed' && elapsed >= MIN_FAIL_DETECT_MS) { anyFailed = true; }
        if (status === 'processing' || (status === 'failed' && elapsed < MIN_FAIL_DETECT_MS)) { allDone = false; break; }
      }

      if (anyFailed) {
        sendLog('❌ Google Flow báo lỗi - tạo ảnh thất bại', 'error');
        return [];
      }

      if (allDone) {
        for (const tid of newTiles) {
          await downloadTileMedia(tid, promptText);
          await sleep(150);
        }
        return newTiles;
      }
    }
  }
  sendLog('⚠️ Timeout chờ kết quả để tải', 'warn');
  return [];
}

/**
 * Send browser notification and optional sound when tasks complete
 */
async function notifyCompletion(title, body) {
  const settings = await new Promise(resolve => {
    chrome.storage.local.get(['af_settings'], (res) => resolve(res.af_settings || {}));
  });

  if (settings.notifyOnComplete !== false) {
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        new Notification(title, { body });
      }
    }
  }

  if (settings.notifySound) {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.setValueAtTime(600, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(900, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch (e) { globalThis.SEOSONA_swallow?.('content#notifyCompletion', e); }
  }
}

/**
 * Cached settings from chrome.storage (loaded on startup, updated on storage change)
 * Server-controlled: User-controlled settings only. Execution settings moved to af_execution_config.
 * Server-Only audit removed default(GenType|Ratio|ImageModel|VideoModel) — * không consume trong Flow content context. Sidebar GenTab đọc qua storageSettings.getSettings().
 */
window._afSettings = {
  humanizedMode: false, humanizedSpeed: 0.5,
  // User-controlled timing (kept in af_settings) — bootstrap initial trước khi storage load
  inputTimeout: 1200,
  randomDelayMin: 3,
  randomDelayMax: 10
};

/**
 * Server-controlled: Execution config from server (cached in af_execution_config)
 * Separate cache for server-controlled execution settings.
 */
window._afExecConfig = {
  workflow: { max_retries: 2, timeout_sec: 180 },
  timing: { delay_between_prompts_sec: 5 },
  flow_recovery: {
    backoff_base_sec: 30,
    backoff_max_sec: 300,
    backoff_jitter_percent: 20,
    auto_recovery_enabled: true,
    consecutive_fail_threshold: 2
  }
};

// Load settings from chrome.storage and cache
(function loadAfSettings() {
  chrome.storage.local.get(['af_settings', 'af_execution_config'], (result) => {
    // User settings — chỉ giữ field thực sự dùng trong Flow content context
    const s = result.af_settings || {};
    window._afSettings = {
      ...window._afSettings,
      humanizedMode: s.humanizedMode || false,
      humanizedSpeed: parseFloat(s.humanizedSpeed) || 0.5,
      inputTimeout: parseInt(s.inputTimeout) || 1200,
      randomDelayMin: parseInt(s.randomDelayMin) || 3,
      randomDelayMax: parseInt(s.randomDelayMax) || 10
    };
    // Server-controlled execution config
    const ec = result.af_execution_config;
    if (ec) {
      window._afExecConfig = {
        workflow: ec.workflow || window._afExecConfig.workflow,
        timing: ec.timing || window._afExecConfig.timing,
        flow_recovery: ec.flow_recovery || window._afExecConfig.flow_recovery
      };
    }
  });
})();

// Listen for storage changes to keep cache in sync
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // User settings — chỉ giữ field thực sự dùng trong Flow content context
  if (changes.af_settings) {
    const s = changes.af_settings.newValue || {};
    window._afSettings = {
      ...window._afSettings,
      humanizedMode: s.humanizedMode || false,
      humanizedSpeed: parseFloat(s.humanizedSpeed) || 0.5,
      inputTimeout: parseInt(s.inputTimeout) || 1200,
      randomDelayMin: parseInt(s.randomDelayMin) || 3,
      randomDelayMax: parseInt(s.randomDelayMax) || 10
    };
  }
  // Server-controlled execution config (persisted by ExecutionConfig.js)
  if (changes.af_execution_config) {
    const ec = changes.af_execution_config.newValue;
    if (ec) {
      window._afExecConfig = {
        workflow: ec.workflow || window._afExecConfig.workflow,
        timing: ec.timing || window._afExecConfig.timing,
        flow_recovery: ec.flow_recovery || window._afExecConfig.flow_recovery
      };
    }
  }
});

/**
 * Kiểm tra Humanized Mode có đang bật không
 * Reads from af_settings (set by Settings page)
 */
function isHumanizedEnabled() {
  return window._afSettings?.humanizedMode || false;
}

/**
 * Lấy tốc độ humanized speed multiplier
 * 0.5 = chậm (tự nhiên hơn), 2.0 = nhanh
 */
function getHumanizedSpeed() {
  return window._afSettings?.humanizedSpeed || 0.5;
}

/**
 * Trả về delay với jitter ngẫu nhiên +-30% và áp dụng speed multiplier
 * speed < 1 = chậm hơn (tự nhiên hơn), speed > 1 = nhanh hơn
 */
function getHumanizedDelay(baseMs) {
  const speed = getHumanizedSpeed();
  const adjusted = baseMs / speed;
  const jitter = adjusted * 0.3;
  return adjusted + (Math.random() * 2 - 1) * jitter;
}

/**
 * Inject Slate Bridge vào main world (page context).
 * Content script chạy trong isolated world → không truy cập được React internals.
 * Bridge script chạy trong main world → truy cập React fiber → lấy Slate editor instance.
 * Giao tiếp qua CustomEvent.
 */
// Slate bridge giờ là file riêng (slate-bridge.js) chạy trong main world via manifest.json
// Không cần inject inline script nữa (CSP chặn inline scripts trên labs.google)
function injectSlateBridge() {
  // No-op: bridge đã được load tự động qua manifest content_scripts world: MAIN
}

/**
 * Call Slate API via bridge (main world) — returns Promise<{success, error?}>
 * Dùng window.postMessage vì CustomEvent.detail bị stripped giữa isolated ↔ main world.
 */
/**
 * Phase FAR-1: Silent session refresh — re-auth OAuth Bearer token mà KHÔNG full reload.
 * Trigger Next.js re-fetch session data qua slate-bridge `refreshSession` action.
 * Tham khảo plan docs/plans/flow-auto-retry-plan.md Section 3.1.
 * Telemetry: log success/fail rate + duration để monitor real-world effectiveness.
 * Trigger sources:
 *   - Background alarm (mỗi N phút, default 20)
 *   - Consecutive fail recovery (FAR-2 — sau N fail liên tiếp)
 * @param {string} [trigger='unknown'] - Nguồn gọi refresh ('alarm' | 'recovery' | 'manual')
 * @returns {Promise<boolean>} true nếu refresh thành công
 */
async function refreshFlowSession(trigger) {
  trigger = trigger || 'unknown';
  const startedAt = Date.now();
  try {
    // Đảm bảo Flow tab active để Next.js context tồn tại
    if (document.visibilityState === 'hidden') {
      await new Promise(r => chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }, () => r()));
      await sleep(300);
    }
    const result = await _slateBridgeCall('refreshSession', {});
    const durationMs = Date.now() - startedAt;
    if (result?.success) {
      console.log('[SEOSONA Flow][FAR-1] Refresh OK', { trigger, durationMs });
      // Track stats vào af_daily_stats (giống pattern existing _incrementDailyStat)
      try { _incrementDailyStat('flow_refresh_success'); } catch (e) { globalThis.SEOSONA_swallow?.('content#refreshFlowSession', e); }
      return true;
    }
    console.warn('[SEOSONA Flow][FAR-1] Refresh FAIL', { trigger, durationMs, error: result?.error || 'unknown' });
    try { _incrementDailyStat('flow_refresh_fail'); } catch (e) { globalThis.SEOSONA_swallow?.('content#refreshFlowSession', e); }
    return false;
  } catch (e) {
    const durationMs = Date.now() - startedAt;
    console.warn('[SEOSONA Flow][FAR-1] Refresh exception', { trigger, durationMs, error: e.message });
    try { _incrementDailyStat('flow_refresh_fail'); } catch (e) { globalThis.SEOSONA_swallow?.('content#refreshFlowSession', e); }
    return false;
  }
}

/**
 * Gọi 1 action sang slate-bridge.js (chạy trong page world để truy cập React fiber).
 * QUAN TRỌNG: Mỗi action có internal multi-tier fallback BÊN TRONG bridge:
 *   - 'insert' → slate-bridge.js INSERT_TIERS (3 tier: insertText/applyOp/insertData)
 *   - 'clear'  → slate-bridge.js CLEAR_TIERS  (3 tier: deleteFragment/selectAllDelete/replaceChildren)
 *   - 'submit' → slate-bridge.js submit handler
 * → 1 lần gọi `_slateBridgeCall('insert', ...)` thực tế thử 3 cách Slate API
 *   trước khi return failure. Đừng nhầm "1 outer call = 1 attempt".
 */
// H9 — Shared-nonce handshake giữa isolated world (content.js) và MAIN world (slate-bridge.js).
// Cả hai world share DOM (không share JS context). content.js sinh nonce ngẫu nhiên một lần rồi
// ghi vào data-attr của một element chuyên biệt; bridge (MAIN) đọc nonce từ chính element đó.
// Mọi message `flow-auto-slate` mang nonce, bridge bắt buộc match; mọi reply mang lại nonce,
// content.js bắt buộc match (kèm requestId). Script trang không đọc được nonce vì element được
// content.js inject lazily và nonce là crypto.randomUUID() không đoán được.
const _SLATE_NONCE_EL_ID = 'seosonaflow-slate-nonce';
let _slateNonce = null;
function _getSlateNonce() {
  if (_slateNonce) return _slateNonce;
  try {
    _slateNonce = (crypto && crypto.randomUUID) ? crypto.randomUUID()
      : (Date.now().toString(36) + Math.random().toString(36).slice(2));
    let el = document.getElementById(_SLATE_NONCE_EL_ID);
    if (!el) {
      el = document.createElement('meta');
      el.id = _SLATE_NONCE_EL_ID;
      el.style.display = 'none';
      (document.documentElement || document.head || document.body).appendChild(el);
    }
    el.setAttribute('data-nonce', _slateNonce);
  } catch (e) {
    if (!_slateNonce) _slateNonce = String(Date.now());
  }
  return _slateNonce;
}

// Bridge readiness self-heal (fix lỗi Bridge TIMEOUT hàng loạt): nếu slate-bridge (MAIN world) chưa
// nạp — tab Flow mở TRƯỚC khi extension reload/update, hoặc re-inject MAIN-world thất bại im lặng
// (MessageBridge:251 chỉ warn) — thì MỌI _slateBridgeCall timeout 3s (clear/insert/submit đều fail).
// Ping trước; nếu chết → nhờ background re-inject bridge rồi ping lại. Cache 15s (khỏi ping mỗi call).
let _slateBridgeVerifiedAt = 0;
let _slateBridgeEnsuring = null;
function _pingSlateBridge(ms) {
  return new Promise((resolve) => {
    const rid = (crypto && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    const nonce = _getSlateNonce();
    let done = false;
    const h = (e) => {
      if (e.source !== window) return;
      if (e.data && e.data.source === 'flow-auto-slate-result' && e.data.requestId === rid && e.data.nonce === nonce) {
        done = true; window.removeEventListener('message', h); resolve(true);
      }
    };
    window.addEventListener('message', h);
    window.postMessage({ source: 'flow-auto-slate', action: 'ping', requestId: rid, nonce: nonce }, window.location.origin);
    setTimeout(() => { if (!done) { window.removeEventListener('message', h); resolve(false); } }, ms || 600);
  });
}
async function _ensureSlateBridgeReady() {
  if (_slateBridgeVerifiedAt && Date.now() - _slateBridgeVerifiedAt < 15000) return true;
  if (_slateBridgeEnsuring) return _slateBridgeEnsuring;
  _slateBridgeEnsuring = (async () => {
    if (await _pingSlateBridge(600)) { _slateBridgeVerifiedAt = Date.now(); return true; }
    for (let i = 0; i < 3; i++) {
      console.warn('[SEOSONA Flow] Slate bridge chưa phản hồi — nhờ background re-inject (MAIN world), lần ' + (i + 1));
      try { await new Promise((r) => { chrome.runtime.sendMessage({ action: 'reinjectSlateBridge' }, () => { void chrome.runtime.lastError; r(); }); }); } catch (_) { globalThis.SEOSONA_swallow?.('content#_slateBridgeEnsuring', _); }
      await new Promise((r) => setTimeout(r, 450));
      if (await _pingSlateBridge(700)) { _slateBridgeVerifiedAt = Date.now(); return true; }
    }
    console.error('[SEOSONA Flow] Slate bridge KHÔNG nạp được — hãy F5 (tải lại) trang Google Flow rồi thử lại.');
    return false;
  })();
  try { return await _slateBridgeEnsuring; } finally { _slateBridgeEnsuring = null; }
}

async function _slateBridgeCall(action, detail) {
  // Đảm bảo bridge sẵn sàng trước MỌI thao tác thật (trừ 'ping' để tránh đệ quy).
  if (action !== 'ping') { await _ensureSlateBridgeReady(); }
  return new Promise((resolve) => {
    const requestId = (crypto && crypto.randomUUID) ? crypto.randomUUID()
      : Math.random().toString(36).substr(2, 9);
    const nonce = _getSlateNonce();
    console.log('[SEOSONA Flow] Bridge call:', action, 'rid:', requestId);
    let resolved = false;
    const handler = (e) => {
      if (e.source !== window) return;
      if (e.data && e.data.source === 'flow-auto-slate-result'
          && e.data.requestId === requestId && e.data.nonce === nonce) {
        resolved = true;
        window.removeEventListener('message', handler);
        console.log('[SEOSONA Flow] Bridge response:', action, e.data.success, e.data.error || '');
        resolve({ success: e.data.success, error: e.data.error });
      }
    };
    window.addEventListener('message', handler);
    window.postMessage({
      source: 'flow-auto-slate',
      action,
      requestId,
      nonce,
      slateSelector: _getSlateEditorSelectorString(),
      ...detail
    }, window.location.origin);
    // Timeout 3s
    setTimeout(() => {
      if (!resolved) {
        window.removeEventListener('message', handler);
        console.warn('[SEOSONA Flow] Bridge TIMEOUT:', action, requestId);
        resolve({ success: false, error: 'Bridge timeout' });
      }
    }, 3000);
  });
}

/**
 * Clear toàn bộ nội dung Slate editor.
 * RESILIENCE — KHÔNG nhầm lẫn "1 tier":
 *   • Outer attempt:  1 lần (gọi Slate bridge qua message bus)
 *   • Inner tiers:    3 (slate-bridge.js: deleteFragment → selectAllDelete → replaceChildren)
 *   • DOM fallback:   0 (cố ý, xem lý do bên dưới)
 * → Tổng cộng 3 cách thử clear, TẤT CẢ qua Slate API (không touch DOM).
 * Lý do KHÔNG có DOM fallback (vd execCommand('selectAll') + execCommand('delete')):
 *   DOM manipulation gây Slate model/DOM desync → React throw
 *   "Cannot resolve a Slate node from DOM node" → trang Flow crash trắng,
 *   user mất session, phải F5. Thà fail êm hơn crash.
 */
async function clearEditor(editor) {
  // Inject bridge nếu chưa có
  injectSlateBridge();

  // Outer attempt qua message bus → bridge thử 3 inner tier (xem CLEAR_TIERS trong slate-bridge.js)
  const result = await _slateBridgeCall('clear', {});
  if (result.success) {
    console.log('[SEOSONA Flow] clearEditor: Slate bridge OK (1 trong 3 inner tier work)');
    await sleep(200); // Đợi React re-render
    return;
  }
  // Cả 3 inner tier Slate fail → abort. KHÔNG dùng DOM fallback (xem JSDoc trên).
  console.warn('[SEOSONA Flow] clearEditor: ❌ Slate bridge failed (cả 3 inner tier):', result.error);
  console.warn('[SEOSONA Flow] clearEditor: ⚠️ Aborting — no DOM fallback (tránh crash Flow page)');
}

/**
 * Public API insert text vào Slate editor của Flow page.
 * Là wrapper cho `_insertTextSingle()` — chỉ thêm 2 thứ:
 *   1. Chunked insert: split text thành word-chunks, insert từng chunk với delay nhỏ → tránh dồn
 *      1 input event quá lớn khiến Slate/React composer xử lý state không kịp (mất ký tự).
 *   2. Delay nhỏ trước/sau insert để composer settle state giữa các thao tác.
 * → "insertText" và "_insertTextSingle" và "insert prompt to editor" CÙNG 1 LUỒNG,
 *   chỉ là tên ở các layer abstraction khác nhau:
 *     EditorExecutor / handler  →  insertText() [public]
 *                                    └→ _insertTextSingle() [internal, có thể gọi nhiều lần
 *                                          nếu humanized chunked]
 *                                          └→ _slateBridgeCall('insert') [bridge layer]
 *                                                └→ slate-bridge.js tryInsertText()
 *                                                      [page world, 3 internal Slate tier]
 */
async function insertText(editor, text) {
  // Inject bridge nếu chưa có
  injectSlateBridge();

  // Delay nhỏ ngẫu nhiên trước khi gõ — tránh dồn thao tác liên tiếp khiến composer xử lý state không kịp
  await sleep(100 + Math.random() * 200);

  editor = getEditor() || editor;

  if (isHumanizedEnabled()) {
    // Humanized mode: insert từng word-chunk
    const chunks = text.match(/\S+\s*/g) || [text];
    for (let ci = 0; ci < chunks.length; ci++) {
      if (shouldStop) break;
      await _insertTextSingle(chunks[ci]);
      if (ci < chunks.length - 1) {
        await sleep(getHumanizedDelay(120));
      }
    }
  } else {
    await _insertTextSingle(text);
  }

  // Random delay sau khi gõ
  await sleep(200 + Math.random() * 300);
}

/**
 * Internal helper: insert MỘT lần text (humanized chunk hoặc full text).
 * RESILIENCE — KHÔNG nhầm lẫn "1 tier ONLY":
 *   • Outer attempt:  1 lần (gọi Slate bridge qua message bus)
 *   • Inner tiers:    3 (slate-bridge.js INSERT_TIERS = ['insertText','applyOp','insertData']):
 *       - Tier inner-1 'insertText':  editor.insertText(text) — Slate high-level API
 *       - Tier inner-2 'applyOp':     editor.apply({type:'insert_text',...}) — low-level operation
 *       - Tier inner-3 'insertData':  editor.insertData(DataTransfer) — paste handler
 *     Mỗi tier verify Slate model có chứa text trước khi accept.
 *   • DOM fallback:   0 (cố ý — xem lý do bên dưới)
 * → Tổng cộng 3 cách thử insert, TẤT CẢ qua Slate API (không touch DOM).
 * Lý do KHÔNG có DOM fallback (execCommand / ClipboardEvent / InputEvent / keyboard sim):
 *   Trước đây có 4 tier outer (Slate bridge + 3 DOM approach). Đã REMOVE 3 DOM tier
 *   vì gây Slate model/DOM desync → React throw "Cannot resolve a Slate node from DOM node"
 *   → Next.js client-side exception → Flow page crash TRẮNG (user phải F5, mất session).
 *   Thà fail êm để caller retry hơn là crash trang.
 * Verify thành công:
 *   - Slate bridge return success → poll DOM 2s (200ms/lần) check placeholder gone + text >80% match
 *   - Nếu Slate report success nhưng DOM chưa render xong → trust Slate (model có text,
 *     React sẽ render eventually). Caller verify lần nữa qua verifySlateModel trước submit.
 */
async function _insertTextSingle(text) {
  let editor = getEditor();

  // Helper: check DOM có text và placeholder đã biến mất
  function isDomUpdated() {
    const el = getEditor();
    if (!el) return false;
    const hasPlaceholder = !!el.querySelector('[data-slate-placeholder]');
    const domText = el.textContent?.trim() || '';
    return !hasPlaceholder && domText.length > 0;
  }

  // Helper: check nếu text đã được insert đúng (tránh duplicate từ fallback tiers)
  function isTextAlreadyInserted() {
    const el = getEditor();
    if (!el) return false;
    const domText = el.textContent?.trim() || '';
    // So sánh normalized text (bỏ whitespace thừa)
    const normalizedDom = domText.replace(/\s+/g, ' ').trim();
    const normalizedTarget = text.replace(/\s+/g, ' ').trim();
    // Cho phép match nếu DOM chứa phần lớn text target (>80% chars)
    if (normalizedTarget.length > 20) {
      const matchRatio = normalizedDom.length > 0 ?
        Math.min(normalizedDom.length, normalizedTarget.length) / normalizedTarget.length : 0;
      return matchRatio > 0.8;
    }
    return normalizedDom === normalizedTarget;
  }

  // Outer attempt qua message bus → bridge thử 3 inner tier (xem INSERT_TIERS slate-bridge.js).
  // KHÔNG nhầm "1 tier" — bridge bên trong tự cycle qua insertText/applyOp/insertData.
  const result = await _slateBridgeCall('insert', { text });
  if (result.success) {
    console.log('[SEOSONA Flow] insertText: Slate bridge returned success (1 trong 3 inner tier work)');

    // Poll chờ DOM update (max 2s) thay vì check 1 lần
    // Lần insert đầu tiên cần nhiều thời gian hơn để placeholder biến mất
    const maxWaitDom = 2000;
    const pollInterval = 200;
    let waited = 0;
    while (waited < maxWaitDom) {
      await sleep(pollInterval);
      waited += pollInterval;

      if (isDomUpdated()) {
        console.log('[SEOSONA Flow] insertText: DOM verified OK after', waited, 'ms');
        return;
      }
      // Check text content thay vì chỉ placeholder
      if (isTextAlreadyInserted()) {
        console.log('[SEOSONA Flow] insertText: Text already in editor after', waited, 'ms');
        return;
      }
    }

    // Fix: Slate bridge báo success → KHÔNG dùng fallback DOM manipulation
    // Lý do: Slate model đã được update, nhưng React chưa render
    // Nếu dùng execCommand → DOM bị modify trực tiếp → Slate model và DOM mismatch
    // → "Cannot resolve a Slate node from DOM node" → Application error
    console.log('[SEOSONA Flow] insertText: Slate bridge success BUT DOM not updated after 2s');
    console.log('[SEOSONA Flow] insertText: Skipping DOM fallbacks to avoid Slate state corruption');
    // Trust Slate bridge - Slate model has the text, React will render eventually
    // Caller (EditorExecutor) sẽ verify via verifySlateModel trước khi submit
    return;
  }

  // Cả 3 inner Slate tier (insertText/applyOp/insertData) đều fail → abort.
  // KHÔNG dùng DOM fallback (execCommand/clipboard/InputEvent/keyboard sim) — xem JSDoc trên.
  console.warn('[SEOSONA Flow] insertText: ❌ Slate bridge failed (cả 3 inner tier):', result.error);
  console.warn('[SEOSONA Flow] insertText: ⚠️ Aborting — no DOM fallback (tránh crash Flow page)');
}

/**
 * Clear TẤT CẢ thành phần cũ trong câu lệnh (Flow): ref images + character chip + voice chip.
 * Cả 3 chip cùng row trong composer + đều có icon 'cancel' → click cancel = remove (DOM 2026-06-25).
 * Fallback: còn chip → click "Xoá câu lệnh" (icon 'close') clear-all. Tên giữ legacy (nhiều call site).
 * BẮT BUỘC chạy ĐẦU TIÊN khi submit (clear phase), trước add ref/voice/character.
 */
async function removeExistingRefImages() {
  console.log('[removeExistingRefImages] called — clear ALL chips (ref + character + voice)');
  const editor = getEditor();
  if (!editor) {
    console.log('[removeExistingRefImages] EARLY RETURN — no editor found');
    return 0;
  }

  // Prompt container: bỏ hardcode CSS-in-JS hash `.sc-45319f81-0` (đã đổi nhiều build).
  //   Strategy: walk up tree, tìm container có CHỨA cancel icon — chứng tỏ container đúng.
  //   Limit 6 levels để không scope quá rộng (Flow nest editor sâu nhưng không quá 6).
  let promptContainer = null;
  let probe = editor.parentElement;
  let probeLevel = 0;
  for (let i = 0; i < 6 && probe; i++) {
    // Server-Only: icon class qua _findIconsInElement. Text 'cancel' giữ inline
    // vì là Material Symbol identifier cụ thể — không phải DOM structure.
    const iconsInProbe = _findIconsInElement(probe);
    const hasCancel = iconsInProbe.some(ic => ic.textContent.trim() === 'cancel');
    if (hasCancel) { promptContainer = probe; probeLevel = i + 1; break; }
    probe = probe.parentElement;
  }
  // Fallback: 3-level parent (như cũ) nếu walk-up không tìm — defensive
  if (!promptContainer) {
    promptContainer = editor.parentElement?.parentElement?.parentElement;
    console.log('[removeExistingRefImages] walk-up không tìm cancel icon, fallback 3-level parent');
  } else {
    console.log(`[removeExistingRefImages] container found via walk-up level ${probeLevel} (có cancel icon)`);
  }
  if (!promptContainer) {
    console.log('[removeExistingRefImages] EARLY RETURN — no promptContainer');
    return 0;
  }

  // Clear MỌI chip trong câu lệnh: ref image + CHARACTER + VOICE. Verified DOM 2026-06-25:
  //   - ref/character chip: button class sc-272106cb-0 (có <img> + <i>cancel</i>; character thêm
  //     <i>accessibility_new</i>)
  //   - voice chip: button class sc-60c7ca24-0 (aria-label voice name + <i>voice_selection</i> +
  //     <i>cancel</i>, KHÔNG có <img>)
  //   → CẢ 3 nằm chung row trong composer container + ĐỀU có <i>cancel</i>. Click cancel = remove.
  //   BỎ điều kiện <img> cũ (trước dùng để phân biệt ref vs voice, nay MUỐN clear cả 3).
  //   Nút "Xoá câu lệnh" dùng icon 'close' (KHÁC 'cancel') → KHÔNG bị nhầm.
  //   Phải chạy ĐẦU TIÊN khi submit (clear phase) — trước add ref/voice/character (2026-06-25).
  let removed = 0;
  const MAX_CHIPS = 15; // safety: re-query mỗi lần vì DOM đổi sau click (icon ref stale)
  for (let i = 0; i < MAX_CHIPS; i++) {
    const cancelIcon = _findIconsInElement(promptContainer)
      .find(ic => ic.textContent.trim() === 'cancel');
    if (!cancelIcon) break;
    const cancelBtn = cancelIcon.closest('button') || cancelIcon.parentElement;
    if (!cancelBtn) break;
    simulateClick(cancelBtn);
    removed++;
    await sleep(200); // Chờ React re-render trước lần re-query sau
  }

  // Fallback: còn cancel (chip cứng đầu / click mở card thay vì remove) → click "Xoá câu lệnh"
  //   = clear-all editor (text + mọi chip). Icon 'close' (Material Symbol identifier — inline OK),
  //   scope trong composer container → an toàn. Chỉ chạy khi per-chip loop không sạch.
  const stillHasCancel = _findIconsInElement(promptContainer).some(ic => ic.textContent.trim() === 'cancel');
  if (stillHasCancel) {
    const clearBtn = _findIconsInElement(promptContainer)
      .find(ic => ic.textContent.trim() === 'close')?.closest('button');
    if (clearBtn) {
      console.log('[removeExistingRefImages] còn chip sau loop → fallback click "Xoá câu lệnh" (clear-all)');
      simulateClick(clearBtn);
      removed++;
      await sleep(300);
    }
  }

  if (removed > 0) {
    sendLog(`Đã xoá ${removed} thành phần cũ trong câu lệnh`, 'info');
  } else {
    console.log(`[removeExistingRefImages] DONE — removed=0 (câu lệnh đã trống)`);
  }
  return removed;
}

/**
 * Đọc thông tin settings hiện tại từ settings button.
 * Settings button có 3 phần tách biệt: model text node, ratio icon element, quantity text node.
 * Approach: query từng element/text-node riêng — KHÔNG parse textContent flattened
 * (textContent dính 3 phần liền nhau → regex parse ngược fragile).
 * Trả về { model, ratioIcon, quantity, rawText } hoặc null nếu không đọc được.
 */
function readCurrentSettings() {
  const submitBtn = getSubmitButton();
  // Dùng getSettingsButton() — 4-tier fallback thay vì positional only
  const settingsBtn = getSettingsButton(submitBtn);
  if (!settingsBtn) return null;

  // 1. Ratio icon: Server-Only — icon class qua _findIconsInElement,
  //    prefix từ settings_button.icon_text (vd 'crop_').
  let ratioIcon = null;
  const icons = _findIconsInElement(settingsBtn);
  const settingsIconPrefix = _getDynamicSelector('settings_button')?.icon_text;
  if (settingsIconPrefix) {
    for (const icon of icons) {
      const t = icon.textContent.trim();
      if (t.startsWith(settingsIconPrefix)) { ratioIcon = t; break; }
    }
  }

  // 2. Quantity: tìm trong text nodes (không phải element children).
  //    Format support: "1x"/"2x"/.. (Flow hiện tại) và "x1"/"x2"/.. (legacy).
  //    Single digit vì Flow chỉ có 1-4. Walk trực tiếp text-node con của button (Element.childNodes
  //    bao gồm cả TextNode), bỏ qua element children → tránh dính text từ <i>crop_*</i>.
  let quantity = null;
  for (const node of settingsBtn.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const t = (node.textContent || '').trim();
    if (!t) continue;
    const m = t.match(/^(\d)x$|^x(\d)$/);  // strict: cả text node phải là "Nx" hoặc "xN"
    if (m) { quantity = parseInt(m[1] || m[2]); break; }
  }

  // 3. Model name: text node ĐẦU TIÊN (thường là "🍌 Nano Banana 2"). Bỏ emoji prefix.
  let model = '';
  for (const node of settingsBtn.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE) continue;
    const t = (node.textContent || '').trim();
    if (!t) continue;
    // Bỏ qua text node là quantity (vd "1x" / "x1")
    if (/^\d?x\d?$/.test(t)) continue;
    model = t.replace(/^[\u{1F000}-\u{1FFFF}]\s*/u, '').trim();
    break;
  }

  // rawText giữ lại để debug
  const rawText = settingsBtn.textContent.trim();
  if (!model && !ratioIcon && quantity === null) return null;

  return { model, ratioIcon, quantity, rawText };
}

/**
 * Map ratio setting value sang ratio icon text trong settings button.
 * Google Flow dùng icon names: crop_16_9, crop_landscape, crop_square, crop_portrait, crop_9_16
 *
 * Extension UI uses semantic names:
 * - story = 9:16 (tall portrait)
 * - portrait = 3:4 (standard portrait)
 * - square = 1:1
 * - landscape = 4:3 (standard landscape)
 * - widescreen = 16:9 (wide landscape)
 */
function ratioToIconName(ratio) {
  const r = String(ratio).toLowerCase().trim();
  // 16:9 - Landscape wide (widescreen)
  if (r.includes('16:9') || r === 'ngang' || r === 'widescreen' || r === '16_9') return 'crop_16_9';
  // 4:3 - Landscape standard (Flow uses crop_landscape)
  if (r.includes('4:3') || r === '4_3' || r === 'ngang 4:3' || r === 'landscape') return 'crop_landscape';
  // 1:1 - Square
  if (r.includes('1:1') || r === 'vuông' || r === 'square') return 'crop_square';
  // 3:4 - Portrait standard (Flow uses crop_portrait)
  if (r.includes('3:4') || r === '3_4' || r === 'dọc 3:4' || r === 'portrait') return 'crop_portrait';
  // 9:16 - Portrait tall (story)
  if (r.includes('9:16') || r === 'dọc' || r === 'story' || r === '9_16') return 'crop_9_16';
  return null;
}

// 2026-06-02 defensive guard: catch regression khi selector match nhầm non-element hoặc hidden.
// Phòng Flow internal handler crash với "X is not a function" khi dispatch event sai context.
function simulateClick(element) {
    if (!element || !(element instanceof Element)) {
      console.warn('[Flow] simulateClick: invalid element type', element);
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      console.warn('[Flow] simulateClick: element zero-size (hidden/detached), skip', element);
      return;
    }
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
}

function simulateContextMenu(element) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y }));
    element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, buttons: 2, clientX: x, clientY: y }));
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y }));
}

/**
 * Apply settings to Google Flow settings panel
 * Uses Radix UI ID suffix patterns as PRIMARY strategy (language-agnostic).
 * Fallback strategies use text matching (Vietnamese, English).
 * Radix ID Suffix Patterns:
 * - Type: -trigger-IMAGE, -trigger-VIDEO
 * - Ratio: -trigger-PORTRAIT, -trigger-LANDSCAPE, -trigger-SQUARE, -trigger-LANDSCAPE_4_3, -trigger-PORTRAIT_3_4
 * - Quantity: -trigger-1, -trigger-2, -trigger-3, -trigger-4
 * - Video Mode: -trigger-VIDEO_FRAMES (Frames), -trigger-VIDEO_REFERENCES (Ingredients)
 */
async function applySettings(genType, aspectRatio, modelName, isFrames = false, quantity = 1, flowVideoDuration = null) {
    console.log(`[applySettings] CALLED with: genType="${genType}", aspectRatio="${aspectRatio}", modelName="${modelName}", isFrames=${isFrames} (typeof ${typeof isFrames}), quantity=${quantity}, flowVideoDuration=${flowVideoDuration}`);
    sendLog(`⚙️ Đang thiết lập cấu hình: ${genType}, ${aspectRatio}, ${modelName}, isFrames=${isFrames}, x${quantity}${flowVideoDuration ? ', ' + flowVideoDuration : ''}`);

    // 2026-06-02: Pre-submit guard sequence (thứ tự BẮT BUỘC): Xong → Close Chat → Agent OFF.
    // Dialog instruction là sub-view CON của chat panel → phải đóng dialog trước khi đóng panel.
    // Agent toggle OFF cuối cùng để Flow không tự re-open panel/dialog.
    //
    // 2026-06-02 cooldown guard: nếu bootstrap / ensureFlowSettingsApplied vừa chạy 3-step < 5s
    // trước, skip pre-submit guard (state đã clean). Window ngắn hơn ensureFlowSettingsApplied
    // (10s) vì pre-submit là last-line-of-defense — nếu Flow re-enable agent giữa chừng, vẫn cần
    // chạy. Cooldown 5s đủ để skip back-to-back gen từ sidebar.
    const PRESUBMIT_COOLDOWN_MS = 5000;
    const _presubmitLastRun = window._seosonaAgentChainLastRunAt || 0;
    const _presubmitSince = Date.now() - _presubmitLastRun;
    const _skipPresubmitGuard = _presubmitSince < PRESUBMIT_COOLDOWN_MS;
    let _anyAgentActioned = false; // track xem có action nào trong pre-submit guard không

    if (_skipPresubmitGuard) {
      console.log(`[applySettings] Pre-submit guard SKIPPED (chain ran ${Math.round(_presubmitSince / 1000)}s ago)`);
    } else {
    // Log state mỗi helper TRƯỚC khi check — để diagnose khi user báo "không đóng được" mà extension silent
    try {
      const d = _isFlowAgentInstructionDialogOpen();
      const p = _isFlowChatAgentPanelOpen();
      const a = _isFlowAgentModeOn();
      console.log('[applySettings] Pre-submit guard state:', {
        instructionDialog: d.open ? 'OPEN' : (d.found ? 'closed' : 'NO-BUTTON-ON-DOM'),
        chatPanel: p.open ? 'OPEN' : (p.found ? 'closed' : 'NO-BUTTON-ON-DOM'),
        agentToggle: a.on ? 'ON' : (a.found ? 'OFF' : 'NO-BUTTON-ON-DOM'),
      });
    } catch (e) {
      console.warn('[applySettings] State probe failed:', e.message);
    }

    // Step 1: Click "Xong" — đóng dialog "Hướng dẫn cho tác nhân" (Agent Instructions)
    try {
      const dialogState = _isFlowAgentInstructionDialogOpen();
      if (dialogState.found && dialogState.open) {
        const openMsg = window.I18n?.t?.('flow.agentInstructionDialogOpenTitle') || 'Dialog "Hướng dẫn cho tác nhân" đang mở — tự động click "Xong" trước khi gen';
        sendLog('⚠ ' + openMsg, 'warn');
        const r = await _ensureFlowAgentInstructionDone();
        if (r.success) {
          const okMsg = window.I18n?.t?.('flow.agentInstructionAutoDone') || 'Đã đóng dialog hướng dẫn agent';
          sendLog('✓ ' + okMsg, 'info');
          if (r.wasOpen) _anyAgentActioned = true;
        } else {
          const failMsg = window.I18n?.t?.('flow.agentInstructionDoneFailed') || 'KHÔNG đóng được dialog hướng dẫn — gen có thể fail';
          sendLog('✗ ' + failMsg, 'error');
        }
      }
    } catch (e) {
      console.warn('[applySettings] _ensureFlowAgentInstructionDone failed:', e.message);
    }

    // Step 2: Close Chat Agent panel (parent của dialog instruction)
    let _chatPanelActioned = false;
    try {
      const panelState = _isFlowChatAgentPanelOpen();
      if (panelState.found && panelState.open) {
        const openMsg = window.I18n?.t?.('flow.chatAgentPanelOpenTitle') || 'Chat agent panel đang mở — tự động đóng trước khi gen';
        sendLog('⚠ ' + openMsg, 'warn');
        const r = await _ensureFlowChatAgentClosed();
        if (r.success) {
          const okMsg = window.I18n?.t?.('flow.chatAgentAutoClosed') || 'Đã đóng panel chat agent';
          sendLog('✓ ' + okMsg, 'info');
          if (r.wasOpen) {
            _anyAgentActioned = true;
            _chatPanelActioned = true;
          }
        } else {
          const failMsg = window.I18n?.t?.('flow.chatAgentCloseFailed') || 'KHÔNG đóng được panel chat agent — gen có thể fail';
          sendLog('✗ ' + failMsg, 'error');
        }
      }
    } catch (e) {
      console.warn('[applySettings] _ensureFlowChatAgentClosed failed:', e.message);
    }

    // 2026-06-02: Sau Step 2 (Close Chat) — đợi Flow stable trước khi click Agent toggle.
    // Lý do: nếu click Agent toggle ngay khi panel chưa hoàn tất animation đóng → Flow re-render
    // panel (side effect). User thấy: đóng → mở (re-render) → đóng. Wait 800ms + re-verify panel
    // thực sự đóng trước khi tiếp tục Step 3.
    if (_chatPanelActioned) {
      await sleep(800);
      try {
        const reVerify = _isFlowChatAgentPanelOpen();
        if (reVerify.found && reVerify.open) {
          sendLog('⚠ Panel re-render sau close — đóng lại trước khi tắt Agent', 'warn');
          await _ensureFlowChatAgentClosed();
          await sleep(500);
        }
      } catch (_) { /* defensive */ }
    }

    // Step 3: Turn OFF Agent mode toggle
    try {
      const agentState = _isFlowAgentModeOn();
      if (agentState.found && agentState.on) {
        const onMsg = window.I18n?.t?.('flow.agentModeOnTitle') || 'Agent mode đang ON — tự động tắt trước khi gen';
        sendLog('⚠ ' + onMsg, 'warn');
        const r = await _ensureFlowAgentModeOff();
        if (r.success) {
          const okMsg = window.I18n?.t?.('flow.agentModeAutoDisabled') || 'Đã tắt Agent mode';
          sendLog('✓ ' + okMsg, 'info');
          if (r.wasOn) _anyAgentActioned = true;
        } else {
          const failMsg = window.I18n?.t?.('flow.agentModeDisableFailed') || 'KHÔNG tắt được Agent mode — gen có thể fail';
          sendLog('✗ ' + failMsg, 'error');
        }
      }
    } catch (e) {
      console.warn('[applySettings] _ensureFlowAgentModeOff failed:', e.message);
    }

    // 2026-06-02: Nếu pre-submit guard đã action ở trên (close panel/dialog/agent mode) → Flow
    // unmount chat editor + remount gen composer editor. Nếu insertText ngay → React state mismatch
    // → Flow auto-reload page. Cần đợi editor (data-slate-editor) re-render xong trước khi tiếp tục.
    if (_anyAgentActioned) {
      sendLog('⏳ Đợi editor Flow re-render sau khi đóng agent UI...', 'info');
      const editorReady = await _waitForFlowEditorReady(5000);
      if (editorReady) {
        sendLog('✓ Editor Flow ready (sau ' + editorReady + 'ms)', 'info');
      } else {
        sendLog('⚠ Editor Flow chưa ready sau 5s — vẫn tiếp tục (có thể fail)', 'warn');
      }
    }

    // Mark timestamp để cooldown guard biết
    window._seosonaAgentChainLastRunAt = Date.now();
    } // end PRESUBMIT_COOLDOWN guard

    // Pre-check: đọc settings hiện tại và xác định cần thay đổi gì
    const current = readCurrentSettings();
    let needModel = true;
    let needRatio = true;
    let needQuantity = true;

    // Nếu Image mode và modelName = null/undefined → không set model (giữ nguyên)
    // Video mode luôn cần set model (Frames/Ingredients)
    const isVideoMode = genType.toLowerCase() === 'video';
    if (!isVideoMode && !modelName) {
      needModel = false;
    }

    if (current) {
      // Check model: so sánh tên model (case-insensitive, partial match)
      let targetModel = modelName;
      console.log(`[applySettings] current.model="${current.model}", targetModel="${targetModel}"`);

      // Video mode: luôn set needModel = true vì cần chọn cả input type + video model
      // Pre-check không reliably detect cả 2 nên luôn apply để đảm bảo đúng
      let modelMatches = false;
      if (isVideoMode) {
        // Video mode: check actual video model name (Omni Flash, Veo, ...)
        if (current.model && targetModel) {
          const currentLower = current.model.toLowerCase();
          const targetLower = targetModel.toLowerCase();
          modelMatches = currentLower.includes(targetLower) || targetLower.includes(currentLower);
          console.log(`[applySettings] Video mode: comparing "${currentLower}" with "${targetLower}" → match=${modelMatches}`);
        }
      } else if (current.model && targetModel) {
        // Image mode: EXACT match (bỏ emoji đầu) — tránh "Nano Banana 2 Lite" đang chọn bị coi là khớp
        // target "Nano Banana 2" → skip nhầm → giữ Lite. Partial `includes` cũ nuốt biến thể dài hơn.
        const _strip = (s) => s.replace(/^[\u{1F000}-\u{1FFFF}]\s*/u, '').trim();
        modelMatches = _strip(current.model.toLowerCase()) === _strip(targetModel.toLowerCase());
      }
      if (modelMatches) {
        needModel = false;
        console.log(`[applySettings] Skipping model change - already ${targetModel}`);
      }

      // Check ratio: so sánh icon name
      const targetRatioIcon = ratioToIconName(aspectRatio);
      if (targetRatioIcon && current.ratioIcon === targetRatioIcon) {
        needRatio = false;
      }

      // Check quantity
      if (current.quantity === quantity) {
        needQuantity = false;
      }

      // NOTE: Không skip hoàn toàn — vẫn phải set genType (image/video)
    // vì pre-check không detect được genType hiện tại từ button text.
    // Chỉ skip khi tất cả settings match VÀ genType đã đúng (conservative).
    // Bỏ early return để luôn mở settings panel và set genType.
    if (!needModel && !needRatio && !needQuantity) {
      sendLog('⚙️ Model/Ratio/Quantity đã đúng, chỉ verify genType', 'info');
    }

      const changes = [];
      if (needModel) changes.push('model');
      if (needRatio) changes.push('ratio');
      if (needQuantity) changes.push('quantity');
      sendLog(`⚙️ Cần thay đổi: ${changes.join(', ')}`, 'info');
    }

    const submitBtn = getSubmitButton();
    if (!submitBtn) {
        sendLog('❌ Không tìm thấy nút Submit để mở Settings.', 'error');
        return;
    }
    // Dùng getSettingsButton() — 4-tier fallback (ARIA + Radix + positional + text)
    const settingsBtn = getSettingsButton(submitBtn);
    if (!settingsBtn) {
        sendLog('❌ Không tìm thấy nút Settings.', 'error');
        return;
    }

    // Post-audit fix: Check panel đã mở chưa → tránh click toggle ĐÓNG panel đang mở.
    // Bug user phát hiện: nếu settings panel đang mở sẵn (user mở manual trước khi gen),
    // simulateClick(settingsBtn) sẽ đóng panel → query mode/ratio fail → skip → upload ref.
    const _existingPanel = _getActiveSettingsPanel();
    const _spmSel = _selStr('settings_panel_marker');
    const _panelAlreadyOpen = _existingPanel !== document
        && !!_spmSel && !!_existingPanel.querySelector(_spmSel);

    if (_panelAlreadyOpen) {
        console.log('[applySettings] Settings panel đã mở — skip click settings button');
        sendLog('⚙️ Settings panel đã mở sẵn — skip toggle', 'info');
    } else {
        // open settings
        simulateClick(settingsBtn);
        await sleep(getSettingsStepDelay()); // Chờ settings panel render
    }

    // Helper: Tìm button bằng Radix trigger suffix (language-agnostic).
    // Pattern từ backend api_config.radix_trigger_button_pattern (Server-Only).
    const _findByIdSuffix = (scope, suffix) => {
      return scope.querySelector(_buildRadixTriggerSelector(suffix));
    };

    // Settings panel scope qua helper (dedupe 3 nơi)
    const settingsPanel = _getActiveSettingsPanel();
    console.log(`[applySettings] settings panel: ${settingsPanel === document ? 'document (no popup yet)' : 'popup'}`);

    // Set Type — Strict Server-Only: mode_tab_image / mode_tab_video từ backend
    // đã seed đầy đủ). Cache miss → empty array + Tier 3 warn,
    // caller graceful fallback _findByIdSuffix.
    let typeClicked = false;
    const typeSuffix = genType.toLowerCase() === 'video' ? 'VIDEO' : 'IMAGE';
    const typeKey = genType.toLowerCase() === 'video' ? 'mode_tab_video' : 'mode_tab_image';

    let typeBtn = null;
    const _typeDynCfg = _getDynamicSelector(typeKey);
    const _typeIsDynamic = _typeDynCfg?.selectors?.length > 0;
    const _typeTrySelectors = _typeIsDynamic ? _typeDynCfg.selectors : [];
    if (!_typeIsDynamic) {
      console.debug(`[Tier3] applySettings type: ${typeKey} config miss, fallback _findByIdSuffix`);
    }

    for (const sel of _typeTrySelectors) {
      try {
        typeBtn = settingsPanel.querySelector(sel);
        if (!typeBtn && settingsPanel !== document) typeBtn = document.querySelector(sel);
        if (typeBtn) {
          console.log(`[applySettings] Found type button via ${_typeIsDynamic ? '🌐 DYNAMIC' : '📦 DEFAULT'} selector: ${sel}`);
          break;
        }
      } catch (_) { /* invalid selector */ }
    }

    // Final fallback: legacy Radix ID suffix helper
    if (!typeBtn) {
      typeBtn = _findByIdSuffix(settingsPanel, typeSuffix);
      if (!typeBtn && settingsPanel !== document) typeBtn = _findByIdSuffix(document, typeSuffix);
    }

    if (typeBtn) {
      console.log(`[applySettings] Found type button via ID suffix: -trigger-${typeSuffix}, aria-selected=${typeBtn.getAttribute('aria-selected')}`);
      simulateClick(typeBtn);
      await sleep(getSettingsStepDelay());
      typeClicked = true;
      sendLog(`✓ Type clicked via ID suffix: -trigger-${typeSuffix}`, 'info');
    } else {
      console.log(`[applySettings] Type button NOT found via ID suffix: -trigger-${typeSuffix}`);
    }

    // Set Type - Strategy 2: Text matching (fallback cho DOM cũ)
    if (!typeClicked) {
      console.log(`[applySettings] Trying Strategy 2: text matching for genType="${genType}"`);
      const tabSelector = _selStr('tab_button_generic');
      if (!tabSelector) console.debug('[Tier3] tab_button_generic config miss');
      let allTabs = tabSelector ? settingsPanel.querySelectorAll(tabSelector) : [];
      if (allTabs.length === 0 && settingsPanel !== document && tabSelector) {
        allTabs = document.querySelectorAll(tabSelector);
      }
      console.log(`[applySettings] Found ${allTabs.length} tabs to search`);

      for (let t of allTabs) {
          let textLower = t.textContent.trim().toLowerCase();
          let targetLower = genType.toLowerCase();
          if (textLower === targetLower || (targetLower === 'video' && textLower.includes('video')) || (targetLower === 'image' && (textLower.includes('ảnh') || textLower.includes('image') || textLower.includes('hình')))) {
              console.log(`[applySettings] Found type tab by text: "${textLower}", aria-selected=${t.getAttribute('aria-selected')}`);
              simulateClick(t);
              await sleep(getSettingsStepDelay());
              typeClicked = true;
              sendLog(`✓ Type clicked via text: ${textLower}`, 'info');
              break;
          }
      }

      if (!typeClicked) {
        console.log(`[applySettings] WARNING: Could not find type tab for genType="${genType}"`);
        sendLog(`⚠️ Không tìm thấy tab ${genType}`, 'warn');
      }
    }

    // Set aspect ratio (skip nếu đã đúng)
    if (needRatio) {
      const targetRatioIcon = ratioToIconName(aspectRatio);

      // Helper: Map ratio value sang Radix ID suffix
      // Extension UI semantic names: story, portrait, square, landscape, widescreen
      // Legacy names: 'Dọc', 'Ngang', 'Vuông', '9:16', '16:9', '1:1', '4:3', '3:4'
      const _ratioToIdSuffix = (ratio) => {
        const r = String(ratio).trim().toLowerCase();
        // 9:16 - Portrait tall (story)
        if (r === 'dọc' || r === '9:16' || r === 'story') return 'PORTRAIT';
        // 16:9 - Landscape wide (widescreen)
        if (r === 'ngang' || r === '16:9' || r === 'widescreen') return 'LANDSCAPE';
        // 1:1 - Square
        if (r === 'vuông' || r === '1:1' || r === 'square') return 'SQUARE';
        // 4:3 - Landscape standard
        if (r === '4:3' || r === 'landscape') return 'LANDSCAPE_4_3';
        // 3:4 - Portrait standard
        if (r === '3:4' || r === 'portrait') return 'PORTRAIT_3_4';
        return null;
      };

      // Scope ratio search vào settings panel — dedupe via helper
      const activeMenu = _getActiveSettingsPanel();

      let ratioClicked = false;

      // Strategy 1: Radix ID suffix (language-agnostic) — PRIMARY
      const ratioSuffix = _ratioToIdSuffix(aspectRatio);
      if (ratioSuffix) {
        const ratioBtn = _findByIdSuffix(activeMenu, ratioSuffix);
        if (ratioBtn) {
          simulateClick(ratioBtn);
          await sleep(getSettingsStepDelay());
          ratioClicked = true;
          sendLog(`✓ Ratio clicked via ID suffix: -trigger-${ratioSuffix}`, 'info');
        }
      }

      // Strategy 2: Tìm buttons có google-symbols icon crop_*
      // Server-Only: icon class qua _findIconInElement.
      if (!ratioClicked && targetRatioIcon) {
        const iconButtons = activeMenu.querySelectorAll('button');
        for (const btn of iconButtons) {
          const icon = _findIconInElement(btn);
          if (icon && icon.textContent.trim() === targetRatioIcon) {
            simulateClick(btn);
            await sleep(getSettingsStepDelay());
            ratioClicked = true;
            sendLog(`✓ Ratio clicked via icon: ${targetRatioIcon}`, 'info');
            break;
          }
        }
      }

      // Strategy 3: Tìm buttons với textContent chứa ratio icon name
      if (!ratioClicked && targetRatioIcon) {
        const allButtons = activeMenu.querySelectorAll('button');
        for (const btn of allButtons) {
          const btnText = btn.textContent.trim().toLowerCase();
          if (btnText.includes(targetRatioIcon)) {
            simulateClick(btn);
            await sleep(getSettingsStepDelay());
            ratioClicked = true;
            sendLog(`✓ Ratio clicked via text: ${targetRatioIcon}`, 'info');
            break;
          }
        }
      }

      // Strategy 4 (fallback): Tìm tabs với text match (legacy)
      if (!ratioClicked) {
        const tabSelector = _selStr('tab_button_generic');
        if (!tabSelector) console.debug('[Tier3] tab_button_generic config miss');
        const updatedTabs = tabSelector ? activeMenu.querySelectorAll(tabSelector) : [];
        for (let t of updatedTabs) {
            let textLower = t.textContent.trim().toLowerCase();
            let ratioLower = String(aspectRatio).trim().toLowerCase();
            if (textLower.includes(ratioLower) ||
                (targetRatioIcon && textLower.includes(targetRatioIcon)) ||
                (ratioLower === 'ngang' && (textLower.includes('landscape') || textLower.includes('16_9') || textLower.includes('16:9'))) ||
                (ratioLower === 'dọc' && (textLower.includes('portrait') || textLower.includes('9_16') || textLower.includes('9:16')))) {
                simulateClick(t);
                await sleep(getSettingsStepDelay());
                sendLog(`✓ Ratio clicked via tab: ${textLower}`, 'info');
                break;
            }
        }
      }
    }

    // Set quantity (skip nếu đã đúng)
    if (needQuantity && quantity >= 1 && quantity <= 4) {
        let quantityClicked = false;

        // Strategy 1: Radix ID suffix (language-agnostic) — PRIMARY
        // ID pattern: radix-:xxx:-trigger-{1|2|3|4}
        const quantityBtn = _findByIdSuffix(document, String(quantity));
        if (quantityBtn) {
          simulateClick(quantityBtn);
          await sleep(getSettingsStepDelay());
          quantityClicked = true;
          sendLog(`✓ Quantity clicked via ID suffix: -trigger-${quantity}`, 'info');
        }

        // Strategy 2: Text matching (fallback)
        if (!quantityClicked) {
          const tabSelector = _selStr('tab_button_generic');
          if (!tabSelector) console.debug('[Tier3] tab_button_generic config miss');
          const quantityTabs = tabSelector ? document.querySelectorAll(tabSelector) : [];
          for (let t of quantityTabs) {
              let text = t.textContent.trim();
              if (text === `x${quantity}`) {
                  simulateClick(t);
                  await sleep(getSettingsStepDelay());
                  break;
              }
          }
        }
    }

    // Open model select dropdown (skip nếu đã đúng)
    let targetModelName = modelName;
    // Video mode: tách biệt input type (Frames/Ingredients) và model name (Omni Flash, Veo, ...)
    const videoInputType = isVideoMode ? (isFrames ? 'Frames' : 'Ingredients') : null;
    const actualVideoModel = isVideoMode ? modelName : null; // Giữ lại model name gốc
    if (isVideoMode) {
        // targetModelName tạm thời là input type để select tab đúng
        targetModelName = videoInputType;
        console.log(`[applySettings] Video mode: inputType=${videoInputType}, actualModel=${actualVideoModel}`);
    }

    console.log(`[applySettings] needModel=${needModel}, isVideoMode=${isVideoMode}, isFrames=${isFrames}, targetModelName="${targetModelName}", actualVideoModel="${actualVideoModel}"`);

    // Video mode: click Frames/Ingredients TAB thay vì dùng dropdown
    // Flow UI dùng tabs với text tiếng Việt: "Khung hình" (Frames) / "Thành phần" (Ingredients)
    // DOM: button[role="tab"] với ID suffix -trigger-VIDEO_FRAMES hoặc -trigger-VIDEO_REFERENCES
    if (isVideoMode && needModel) {
        // Scope video mode tab search via helper
        const activeMenu = _getActiveSettingsPanel();
        let videoModeClicked = false;

        // Strict Server-Only: đọc text_match từ video_mode_frames / video_mode_ingredients config.
        // Xác định isFramesTarget bằng cách check targetModelName against server text_match lists.
        const _framesConfig = _getDynamicSelector('video_mode_frames');
        const _ingredientsConfig = _getDynamicSelector('video_mode_ingredients');
        const _framesTextMatch = _framesConfig?.text_match || [];
        const _ingredientsTextMatch = _ingredientsConfig?.text_match || [];
        const _targetLower = targetModelName.toLowerCase();
        const isFramesTarget = _framesTextMatch.some(t => _targetLower.includes(t.toLowerCase()));
        const searchTerms = isFramesTarget ? _framesTextMatch : _ingredientsTextMatch;
        const ariaControlsMatch = isFramesTarget ? 'VIDEO_FRAMES' : 'VIDEO_REFERENCES';
        const videoModeSuffix = isFramesTarget ? 'VIDEO_FRAMES' : 'VIDEO_REFERENCES';

        console.log(`[applySettings] Video mode: looking for ${targetModelName} with ID suffix: -trigger-${videoModeSuffix}`);

        // Strategy 1: Dynamic selectors từ backend (admin tweakable) → fallback Radix ID suffix
        // Post-audit fix: dùng _getDynamicSelector('video_mode_frames'|'video_mode_ingredients').
        const _vmKey = isFramesTarget ? 'video_mode_frames' : 'video_mode_ingredients';
        const _vmDefaults = [_buildRadixTriggerSelector(videoModeSuffix), `button[role="tab"][aria-controls*="${ariaControlsMatch}"]`];
        const _vmDynCfg = _getDynamicSelector(_vmKey);
        const _vmIsDynamic = _vmDynCfg?.selectors?.length > 0;
        const _vmTrySelectors = _vmIsDynamic ? _vmDynCfg.selectors : _vmDefaults;

        let videoModeBtn = null;
        for (const sel of _vmTrySelectors) {
            try {
                videoModeBtn = activeMenu.querySelector(sel);
                if (videoModeBtn) {
                    console.log(`[applySettings] Video mode: found via ${_vmIsDynamic ? '🌐 DYNAMIC' : '📦 DEFAULT'} selector: ${sel}`);
                    break;
                }
            } catch (_) { /* invalid selector */ }
        }

        // Final fallback: legacy Radix ID suffix helper
        if (!videoModeBtn) {
            videoModeBtn = _findByIdSuffix(activeMenu, videoModeSuffix);
        }

        if (videoModeBtn) {
            console.log(`[applySettings] Video mode: clicking via ID suffix -trigger-${videoModeSuffix}`);
            simulateClick(videoModeBtn);
            await sleep(getSettingsStepDelay());
            videoModeClicked = true;
            sendLog(`✓ Video mode: chọn ${targetModelName} (${_vmIsDynamic ? 'dynamic' : 'default'})`, 'info');
        }

        // Strategy 2: Tìm tab bằng aria-controls
        const tabSelector = _selStr('tab_button_generic');
        if (!tabSelector) console.debug('[Tier3] tab_button_generic config miss');
        if (!videoModeClicked) {
            const tabs = tabSelector ? activeMenu.querySelectorAll(tabSelector) : [];
            for (const tab of tabs) {
                const ariaControls = tab.getAttribute('aria-controls') || '';
                if (ariaControls.includes(ariaControlsMatch)) {
                    console.log(`[applySettings] Video mode: clicking tab via aria-controls="${ariaControls}"`);
                    simulateClick(tab);
                    await sleep(getSettingsStepDelay());
                    videoModeClicked = true;
                    sendLog(`✓ Video mode: chọn ${targetModelName} (aria)`, 'info');
                    break;
                }
            }
        }

        // Strategy 3: Tìm tab bằng text content (fallback)
        if (!videoModeClicked) {
            const tabs = activeMenu.querySelectorAll(tabSelector);
            console.log(`[applySettings] Video mode Strategy 3: searching ${tabs.length} tabs by text`);
            for (const tab of tabs) {
                const tabText = tab.textContent.trim().toLowerCase();
                for (const term of searchTerms) {
                    if (tabText === term || tabText.includes(term)) {
                        console.log(`[applySettings] Video mode: clicking tab "${tabText}" for ${targetModelName}`);
                        simulateClick(tab);
                        await sleep(getSettingsStepDelay());
                        videoModeClicked = true;
                        sendLog(`✓ Video mode: chọn ${targetModelName} (tab)`, 'info');
                        break;
                    }
                }
                if (videoModeClicked) break;
            }
        }

        // Strategy 4: Tìm buttons bất kỳ có text match
        if (!videoModeClicked) {
            const allButtons = activeMenu.querySelectorAll('button');
            console.log(`[applySettings] Video mode Strategy 4: searching ${allButtons.length} buttons`);
            for (const btn of allButtons) {
                const btnText = btn.textContent.trim().toLowerCase();
                for (const term of searchTerms) {
                    if (btnText === term || btnText.includes(term)) {
                        console.log(`[applySettings] Video mode: clicking button "${btnText}" for ${targetModelName}`);
                        simulateClick(btn);
                        await sleep(getSettingsStepDelay());
                        videoModeClicked = true;
                        sendLog(`✓ Video mode: chọn ${targetModelName} (button)`, 'info');
                        break;
                    }
                }
                if (videoModeClicked) break;
            }
        }

        if (videoModeClicked) {
            // Input type (Frames/Ingredients) đã chọn xong
            // Tiếp tục chọn video MODEL (Omni Flash, Veo, ...) nếu có
            if (actualVideoModel) {
                await sleep(getSettingsStepDelay()); // Chờ UI update sau khi chọn input type
                targetModelName = actualVideoModel; // Restore original model name for dropdown
                needModel = true; // Tiếp tục dropdown logic bên dưới
                console.log(`[applySettings] Video input type selected, now selecting video model: ${actualVideoModel}`);
            } else {
                needModel = false; // Không có model cụ thể → skip
            }
        } else {
            console.log(`[applySettings] Video mode: "${targetModelName}" input type not found, will try dropdown fallback`);
        }
    }

    if (needModel) {
      const menuSelector = '[role="menu"]';
      const _mpc = _getDynamicSelector('model_picker_button');
      const modelBtnSelector = _mpc?.selectors?.[0];
      if (!modelBtnSelector) console.debug('[Tier3] model_picker_button miss');
      const modelItemsSelector = 'button, [role="menuitem"], [role="menuitemradio"]';

      // Tìm model button: settings panel scope trước, sau đó [role="menu"]
      const activeSettingsPanel = _getActiveSettingsPanel();
      let modelBtn = null;
      if (modelBtnSelector) {
        modelBtn = activeSettingsPanel.querySelector(modelBtnSelector);
        if (modelBtn) {
          console.log(`[applySettings] Found model button in settings panel scope`);
        } else {
          // Fallback: tìm trong [role="menu"]
          const menus = document.querySelectorAll(menuSelector);
          console.log(`[applySettings] Found ${menus.length} menus for model button fallback`);
          if (menus.length > 0) {
            const activeMenu = menus[menus.length - 1];
            modelBtn = activeMenu.querySelector(modelBtnSelector);
            if (modelBtn) {
              console.log(`[applySettings] Found model button in menu scope`);
            }
          }
        }
      }

      // Click model button và chọn model từ dropdown
      if (modelBtn) {
          console.log(`[applySettings] Clicking model button to open dropdown`);
          simulateClick(modelBtn);
          await sleep(getSettingsStepDelay());

          // Find model items trong dropdown mới mở
          const allMenus2 = document.querySelectorAll(menuSelector);
          console.log(`[applySettings] After click, found ${allMenus2.length} menus`);
          if (allMenus2.length > 0) {
              const dropdown = allMenus2[allMenus2.length - 1]; // latest nested popup
              const items = dropdown.querySelectorAll(modelItemsSelector);
              // Debug: log all available items
              const availableItems = Array.from(items).map(i => i.textContent.trim().toLowerCase());
              console.log(`[applySettings] Model dropdown items: [${availableItems.join(', ')}], looking for: "${targetModelName}" (targetText="${String(targetModelName).toLowerCase().trim()}")`);
              console.log(`[applySettings] isFrames parameter received: ${isFrames}, typeof: ${typeof isFrames}`);
              // Strict Server-Only: check text_match từ video_mode configs để xác định exact match
              const _framesMatch = _getDynamicSelector('video_mode_frames')?.text_match || [];
              const _ingredientsMatch = _getDynamicSelector('video_mode_ingredients')?.text_match || [];
              const _exactMatchNames = [..._framesMatch, ..._ingredientsMatch].map(t => t.toLowerCase());

              // Bug fix "Nano Banana 2" chọn nhầm "Nano Banana 2 Lite": partial `includes` nuốt biến thể
              // dài hơn (Lite/Pro) khi nó đứng trước hoặc emoji làm exact trượt. → 2-pass: ƯU TIÊN EXACT
              // (chuẩn hoá bỏ emoji đầu) trước; chỉ fallback partial khi KHÔNG có option trùng khít.
              const _stripLeadEmoji = (s) => s.replace(/^[\u{1F000}-\u{1FFFF}]\s*/u, '').trim();
              const targetText = _stripLeadEmoji(String(targetModelName).toLowerCase().trim());
              const _needsExactMatch = _exactMatchNames.includes(targetText);
              let _clickedModel = false;
              // Pass 1 — EXACT match (sau khi bỏ emoji đầu của DOM item).
              for (let item of items) {
                  if (_stripLeadEmoji(item.textContent.toLowerCase().trim()) === targetText) {
                      console.log(`[applySettings] Clicking model item (exact): "${targetText}"`);
                      simulateClick(item);
                      await sleep(getSettingsStepDelay());
                      _clickedModel = true;
                      break;
                  }
              }
              // Pass 2 — partial (includes) CHỈ khi không có exact + target không yêu cầu exact-only.
              if (!_clickedModel && !_needsExactMatch) {
                  for (let item of items) {
                      const domText = item.textContent.toLowerCase().trim();
                      if (!domText.includes(targetText)) continue;
                      if (targetText.includes('veo') && domText.includes('veo') &&
                          ((targetText.includes('fast') && !domText.includes('fast')) || (targetText.includes('quality') && !domText.includes('quality')))) {
                          // Bỏ qua nếu Veo không đúng hậu tố
                          continue;
                      }
                      console.log(`[applySettings] Clicking model item (partial): domText="${domText}", targetText="${targetText}"`);
                      simulateClick(item);
                      await sleep(getSettingsStepDelay());
                      _clickedModel = true;
                      break;
                  }
              }
          }
      } else {
          console.log(`[applySettings] Model button not found, skipping model selection`);
      }
    }

    // Set video duration (Flow video mode only)
    console.log(`[applySettings] Video duration check: isVideoMode=${isVideoMode}, flowVideoDuration="${flowVideoDuration}" (type: ${typeof flowVideoDuration})`);
    if (isVideoMode && flowVideoDuration) {
      // Strategy 1: Server-Only — đọc selector từ backend dom_selector config
      const _durCfg = _getDynamicSelector('video_duration_tab');
      const _durSelectors = _durCfg?.selectors || [];
      const _durTextMatch = _durCfg?.text_match || ['4s', '6s', '8s', '10s'];
      const durationNum = parseInt(flowVideoDuration); // "10s" → 10

      const tryClickDuration = () => {
        const activeMenu = _getActiveSettingsPanel();
        if (!activeMenu) return false;
        // Strategy 1: config selectors + text match
        if (_durSelectors.length > 0 && _durTextMatch.includes(flowVideoDuration)) {
          for (const sel of _durSelectors) {
            try {
              for (const tab of activeMenu.querySelectorAll(sel)) {
                if ((tab.textContent || '').trim() !== flowVideoDuration) continue;
                if (tab.getAttribute('aria-selected') === 'true' || tab.getAttribute('data-state') === 'active') return true;
                simulateClick(tab);
                sendLog(`✓ Duration: ${flowVideoDuration}`, 'info');
                return true;
              }
            } catch (_) { /* invalid selector */ }
          }
        }
        // Strategy 2: Fallback — Radix ID suffix (trigger-4/6/8/10)
        if (!isNaN(durationNum)) {
          const btn = activeMenu.querySelector(`button[id$="-trigger-${durationNum}"]`);
          if (btn) {
            if (btn.getAttribute('aria-selected') !== 'true' && btn.getAttribute('data-state') !== 'active') {
              simulateClick(btn);
              sendLog(`✓ Duration: ${flowVideoDuration} (ID suffix)`, 'info');
            }
            return true;
          }
        }
        return false;
      };

      // Bug fix 2026-05-27: retry — panel duration RE-RENDER muộn sau khi chọn model (vd Omni Flash
      // bổ sung tab 10s sau ~vài trăm ms) → check ngay sau model click miss → fallback 8s. Chờ tab xuất hiện.
      let durationClicked = false;
      for (let attempt = 0; attempt < 4 && !durationClicked; attempt++) {
        if (attempt > 0) await sleep(400);
        durationClicked = tryClickDuration();
      }
      if (durationClicked) await sleep(getSettingsStepDelay());

      if (!durationClicked) {
        // Diagnostic: dump duration tabs có sẵn → phân biệt timing miss vs Flow constraint thật
        // (vd Omni Flash Ingredients chỉ cho 4s/6s/8s). Giúp chẩn đoán + cảnh báo user.
        const menu = _getActiveSettingsPanel() || document;
        const avail = [];
        menu.querySelectorAll('button[role="tab"], button[id*="-trigger-"]').forEach((b) => {
          const t = (b.textContent || '').trim();
          if (/^\d+\s*s$/.test(t) || /-trigger-\d+$/.test(b.id || '')) avail.push(t || b.id);
        });
        console.log(`[applySettings] Duration ${flowVideoDuration} not found. Available: [${avail.join(', ')}]`);
        sendLog(`⚠️ Duration ${flowVideoDuration} không có trong panel (Flow hỗ trợ: ${avail.filter(Boolean).join(', ') || 'N/A'})`, 'warn');
      }
    }

    // close settings menu
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    simulateClick(document.body);
}

async function addFileToPrompt(fileId, fileName, flowFileId) {
    // Ensure Flow tab active (context menu "Thêm vào câu lệnh" cần tab active)
    if (document.visibilityState === 'hidden') {
      await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }, () => resolve());
      });
      await sleep(300);
    }

    // U-2.1: Priority 1 — file_id lookup (persistent, chính xác nhất)
    if (flowFileId) {
      const tile = findTileByFileId(flowFileId);
      if (tile) {
        fileId = tile.dataset.tileId;
      }
    }

    let els = document.querySelectorAll(`div[data-tile-id="${fileId}"]`);

    // Cross-project validation: nếu tìm thấy tile nhưng file_name không match → không dùng
    if (els.length > 0 && fileName) {
        const tile = els[els.length - 1];
        const currentFn = extractFileName(tile);
        if (currentFn && currentFn !== fileName) {
            console.log(`[SEOSONA Flow] addFileToPrompt: tile_id ${fileId.substring(0, 20)}... exists but file_name mismatch (${currentFn.substring(0, 15)}... vs ${fileName.substring(0, 15)}...) → cross-project collision, finding by file_name`);
            els = []; // Force fallback to file_name search
        }
    }

    // Fallback: tìm tile bằng file_name nếu data-tile-id không tìm thấy hoặc không match
    if (els.length === 0 && fileName) {
        const allTiles = document.querySelectorAll(_getTileSelectorString());
        for (const tile of allTiles) {
            const fn = extractFileName(tile);
            if (fn === fileName) {
                const newId = tile.dataset.tileId;
                console.log(`[SEOSONA Flow] addFileToPrompt: resolved ${fileId.substring(0, 20)}... → ${newId.substring(0, 20)}... via file_name`);
                fileId = newId;
                els = document.querySelectorAll(`div[data-tile-id="${fileId}"]`);
                break;
            }
        }
    }
    // Lớp 2 (2026-05-26): tile chưa lazy-load lại sau reload Flow → force-load rồi thử lại 1 lần.
    // Cả lookup data-tile-id lẫn file_name fallback đều cần tile có trong DOM; sau reload Flow
    // lazy-load theo viewport nên ref tile có thể chưa render. ensureFlowTilesLoaded zoom-out +
    // scroll để render, sau đó re-lookup theo tile_id + file_name (file_name từ Lớp 1 fix).
    if (els.length === 0 && typeof ensureFlowTilesLoaded === 'function') {
        console.log(`[SEOSONA Flow] addFileToPrompt: tile chưa thấy (id=${fileId.substring(0, 20)}...) → ensureFlowTilesLoaded + retry`);
        // Có file_name → truyền target để zoom multi-pass + early-exit (nhanh + chính xác hơn)
        // Hong o day -> tile van chua load -> buoc sau bao 'khong tim thay tile' (sai nguyen nhan).
        try { await ensureFlowTilesLoaded(false, fileName ? [fileName] : []); }
        catch (e) { console.warn('[SEOSONA Flow] ensureFlowTilesLoaded that bai -> co the bao nham "khong thay tile":', e && e.message); }
        els = document.querySelectorAll(`div[data-tile-id="${fileId}"]`);
        if (els.length === 0 && fileName) {
            const allTilesRetry = document.querySelectorAll(_getTileSelectorString());
            for (const tile of allTilesRetry) {
                if (extractFileName(tile) === fileName) {
                    const newId = tile.dataset.tileId;
                    console.log(`[SEOSONA Flow] addFileToPrompt: post-load resolved ${fileId.substring(0, 20)}... → ${newId.substring(0, 20)}... via file_name`);
                    fileId = newId;
                    els = document.querySelectorAll(`div[data-tile-id="${fileId}"]`);
                    break;
                }
            }
        }
    }
    if (els.length === 0) {
        sendLog(`⚠️ Không tìm thấy file có ID: ${fileId} trên màn hình.`, 'warn');
        return false; // Return false để caller biết fail
    }

    const el = els[els.length - 1];

    // Context menu mutex — tránh collision với download context menu trong pipeline mode
    await _acquireCtxMenuLock();
    try {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(getInputTimeoutMs());

      const targetEl = el.querySelector('img') || el.querySelector('a') || el;
      simulateContextMenu(targetEl);
      await sleep(getInputTimeoutMs());

      const _cmSel = _selStr('context_menu');
      const ctxMenu = _cmSel ? document.querySelector(_cmSel) : null;
      if (!_cmSel) console.debug('[Tier3] context_menu config miss');
      if (!ctxMenu) {
          _closeContextMenu();
          sendLog(`⚠️ Lỗi: Context menu không mở được cho file ${fileId}`, 'warn');
          return false; // Return false để caller biết fail
      }

      const menuItems = _qa('menu_item', ctxMenu);
      let clicked = false;

      // Strategy 1: Match text content với multi-language labels (Strict Server-Only).
      const addToPromptLabels = _getFlowLocaleStrings('add_to_prompt_menu_item', 'text_match');
      for (const item of menuItems) {
          const text = item.textContent?.trim() || '';
          if (_textIncludesAny(text, addToPromptLabels)) {
              simulateClick(item);
              clicked = true;
              break;
          }
      }

      // Strategy 2: Fallback - tìm menu item có icon "add" TRONG context menu
      // Server-Only: icon class qua _findIconInElement.
      if (!clicked) {
          for (const item of menuItems) {
              const icon = _findIconInElement(item);
              if (icon && icon.textContent?.trim() === 'add') {
                  simulateClick(item);
                  clicked = true;
                  break;
              }
          }
      }

      // Close context menu after action
      if (clicked) {
          await sleep(100);  // Chờ menu animation
          _closeContextMenu();
      }
      if (!clicked) {
          _closeContextMenu();
          sendLog(`⚠️ Lỗi: Không tìm thấy menu "Add to prompt" ở file ${fileId}`, 'warn');
      }
      await sleep(getInputTimeoutMs());
      return clicked; // Return true nếu thêm thành công, false nếu fail
    } finally {
      _releaseCtxMenuLock();
    }
}

/**
 * Phase FAR-5: Exponential backoff với jitter — match Google retry guidance.
 * Server-controlled: Settings now come from server-controlled ExecutionConfig.
 * @param {number} retryIdx - 0-based retry index (0 = lần retry thứ 1, 1 = lần thứ 2, ...)
 * @param {object} retrySettings - retrySettings từ runAutoPrompt scope (populated from _afExecConfig)
 * @returns {number} delay ms với jitter ±jitterPercent%
 */
function getExponentialBackoffMs(retryIdx, retrySettings) {
  const s = retrySettings || {};
  const baseSec = parseInt(s.flowBackoffBaseSec ?? 30, 10);
  const maxSec = parseInt(s.flowBackoffMaxSec ?? 300, 10);
  const jitterPct = Math.max(0, Math.min(50, parseInt(s.flowBackoffJitterPercent ?? 20, 10))) / 100;
  // retryIdx 0: 30s, 1: 60s, 2: 120s, 3: 240s, 4+: 300s cap
  const baseMs = baseSec * 1000 * Math.pow(2, Math.max(0, retryIdx));
  const cappedMs = Math.min(baseMs, maxSec * 1000);
  const jitter = cappedMs * jitterPct * (Math.random() * 2 - 1);
  return Math.round(cappedMs + jitter);
}

// [Fix] Cache settings từ payload để các delay functions dùng
// var allows safe re-declaration when content.js is re-injected (race condition between manifest inject and MessageBridge inject)
var _cachedInputTimeoutMs = 1200;
var _cachedDelayBetweenMs = 5000;

// Main execution process
async function runAutoPrompt(payload) {
  let { prompts, delayBetweenMs, inputTimeoutMs, fileIds, fileNameMap, genType, aspectRatio, modelName, frameFileIds, refPerPrompt, noTileWait, quantity, autoDownload, downloadResolution, videoDownloadResolution, flowVideoDuration, refImageMode, mentionData, taskName } = payload;
  fileNameMap = fileNameMap || {};
  quantity = quantity || 1;
  refPerPrompt = refPerPrompt || false;
  noTileWait = noTileWait || false;
  // autoDownload: pass qua payload vì sidePanel context không access được DOM của content script
  autoDownload = autoDownload ?? false;
  // T-1: Resolution cho auto-download (1k/2k image, 720p/1080p video)
  downloadResolution = downloadResolution || '1k';
  videoDownloadResolution = videoDownloadResolution || '720p';
  // S4: Ref image mode - 'all' | 'mention' | 'sequential' | 'none'
  refImageMode = refImageMode || 'all';
  mentionData = mentionData || null;
  // [Fix] Cache settings từ payload để các delay functions trả về đúng giá trị
  _cachedInputTimeoutMs = inputTimeoutMs || 1200;
  _cachedDelayBetweenMs = delayBetweenMs || 5000;

  if (isRunning) {
    console.warn('[runAutoPrompt] Blocked: isRunning=true, ExecutionBlocker.isVisible=' + ExecutionBlocker.isVisible());
    return { blocked: true, reason: 'already_running' };
  }
  isRunning = true;
  shouldStop = false;
  isPaused = false;
  failedPrompts = [];
  _clickedRetryTileIds.clear(); // Reset retry tracking cho execution mới
  _retryingTiles.clear(); // Xóa dedup lock retry tiles từ lần chạy trước
  const DELAY_BEFORE_SUBMIT = getSubmitDelay();
  const _startedAt = Date.now();

  // Legacy FloatingTracker: hiển thị ngay khi bắt đầu
  FloatingTracker.updateLegacy({
    owner: payload._owner || 'prompts',
    label: payload._label || 'Auto Gen',
    status: 'running',
    current: 0,
    total: prompts.length,
    failed: 0,
    startedAt: _startedAt
  });

  // ExecutionBlocker: full-screen overlay chặn interaction
  ExecutionBlocker.show({
    title: 'Đang chuẩn bị...',
    subtitle: 'Extension đang thao tác, vui lòng chờ',
    current: 0,
    total: prompts.length,
    promptText: 'Chuẩn bị upload ảnh tham chiếu...',
    owner: payload._owner || 'prompts',
    indeterminate: true
  });

  // Upload pending local files trước khi chạy
  if (fileIds && fileIds.some(id => id.startsWith('upload_'))) {
    const idsStr = fileIds.join(', ');
    if (typeof window.uploadPendingFiles === 'function') {
      const uploaded = await window.uploadPendingFiles(idsStr);
      fileIds = uploaded.split(',').map(s => s.trim()).filter(Boolean);
      // Cập nhật input UI
      const fileIdsInput = document.getElementById('fileIdsInput');
      if (fileIdsInput) {
        fileIdsInput.value = fileIds.join(', ');
        if (typeof window.renderFileIdThumbnails === "function") window.renderFileIdThumbnails();
      }
    }
  }
  if (frameFileIds) {
    // Per-prompt frame pairs: array of { frame1, frame2 }
    if (Array.isArray(frameFileIds)) {
      for (let fi = 0; fi < frameFileIds.length; fi++) {
        const fp = frameFileIds[fi];
        if (!fp) continue;
        if (fp.frame1?.startsWith('upload_') && typeof window.uploadPendingFiles === 'function') {
          fp.frame1 = (await window.uploadPendingFiles(fp.frame1)).trim();
        }
        if (fp.frame2?.startsWith('upload_') && typeof window.uploadPendingFiles === 'function') {
          fp.frame2 = (await window.uploadPendingFiles(fp.frame2)).trim();
        }
      }
    } else {
      // Legacy single pair: { frame1, frame2 }
      if (frameFileIds.frame1?.startsWith('upload_') && typeof window.uploadPendingFiles === 'function') {
        frameFileIds.frame1 = (await window.uploadPendingFiles(frameFileIds.frame1)).trim();
      }
      if (frameFileIds.frame2?.startsWith('upload_') && typeof window.uploadPendingFiles === 'function') {
        frameFileIds.frame2 = (await window.uploadPendingFiles(frameFileIds.frame2)).trim();
      }
    }
  }

  // Re-upload ref files nếu tile không còn trên page
  if (fileIds && fileIds.length > 0 && typeof window.reuploadMissingFiles === 'function') {
    const idsStr = fileIds.join(', ');
    // Truyền caches từ GenTab nếu có (để check file_name trước khi reupload)
    const thumbCache = window.GenTab?.thumbnailCache || {};
    const fnCache = window.GenTab?.fileNameCache || {};
    const updated = await window.reuploadMissingFiles(idsStr, thumbCache, null, fnCache);
    if (updated !== idsStr) {
      fileIds = updated.split(',').map(s => s.trim()).filter(Boolean);
      const fileIdsInput = document.getElementById('fileIdsInput');
      if (fileIdsInput) {
        fileIdsInput.value = fileIds.join(', ');
        if (typeof window.renderFileIdThumbnails === "function") window.renderFileIdThumbnails();
      }
    }
  }

  // Server-controlled: Read execution settings from server-controlled config (af_execution_config)
  // Cached in window._afExecConfig by storage listener
  const wfCfg = window._afExecConfig?.workflow || {};
  const farCfg = window._afExecConfig?.flow_recovery || {};

  let retrySettings = {
    maxRetries: parseInt(wfCfg.max_retries ?? 2, 10),
    tileTimeout: parseInt(wfCfg.timeout_sec ?? 180, 10) * 1000,
    // Phase FAR-5: Exponential backoff — server-controlled
    flowBackoffBaseSec: parseInt(farCfg.backoff_base_sec ?? 30, 10),
    flowBackoffMaxSec: parseInt(farCfg.backoff_max_sec ?? 300, 10),
    flowBackoffJitterPercent: parseInt(farCfg.backoff_jitter_percent ?? 20, 10),
    // Phase FAR-2: Consecutive fail recovery — server-controlled
    flowAutoRecoveryEnabled: farCfg.auto_recovery_enabled !== false,
    flowConsecutiveFailThreshold: parseInt(farCfg.consecutive_fail_threshold ?? 2, 10),
  };

  try {
    // Check retry_on_fail feature - override maxRetries = 0 nếu không có quyền
    const stored = await new Promise(r => chrome.storage.local.get(['af_entitlements'], r));
    const entitlements = stored.af_entitlements?.entitlements || {};
    const retryFeature = entitlements.retry_on_fail;
    const canUseRetry = retryFeature?.value === '1' || retryFeature?.value === 1;
    if (!canUseRetry) {
      retrySettings.maxRetries = 0; // Force no retry
    }
  } catch (e) { globalThis.SEOSONA_swallow?.('content#runAutoPrompt', e); }

  const humanized = isHumanizedEnabled();
  if (humanized) {
    sendLog('Humanized mode: bật - gõ ký tự và delay ngẫu nhiên', 'info');
  }

  sendLog(`🚀 Bắt đầu chạy ${prompts.length} prompt(s)...`);
  if (refPerPrompt) {
    sendLog(`Chế độ mỗi prompt 1 ảnh: ${fileIds.length} ảnh cho ${prompts.length} prompt`, 'info');
  }

  // 2026-06-02: Step 0 — đóng chat panel + Agent OFF + wait editor ready TRƯỚC loop.
  // Tránh removeRefs/addRefs khi chat panel/Agent UI vẫn chiếm composer area.
  // Chạy 1 lần TRƯỚC loop — sau đó loop thao tác trên composer đã ready.
  try {
    let actioned = false;
    const r1 = await _ensureFlowAgentInstructionDone();
    if (r1.wasOpen && r1.success) { sendLog('✓ Đã đóng dialog hướng dẫn agent', 'info'); actioned = true; }
    const r2 = await _ensureFlowChatAgentClosed();
    if (r2.wasOpen && r2.success) {
      sendLog('✓ Đã đóng panel chat agent', 'info');
      actioned = true;
      await sleep(1500); // wait Flow stable: panel collapse + Agent toggle render
    }
    const r3 = await _ensureFlowAgentModeOff();
    if (r3.wasOn && r3.success) { sendLog('✓ Đã tắt Agent mode', 'info'); actioned = true; }
    if (actioned) {
      const editorReadyMs = await _waitForFlowEditorReady(5000);
      sendLog(editorReadyMs ? `✓ Editor Flow ready (${editorReadyMs}ms)` : '⚠ Editor chưa ready sau 5s', editorReadyMs ? 'info' : 'warn');
      window._seosonaAgentChainLastRunAt = Date.now();
    }
  } catch (e) {
    console.warn('[runAutoPrompt] prepareFlowForGen guard failed (non-blocking):', e.message);
  }

  // 2026-05-30 REORDER bug fix: applySettings PHẢI chạy SAU khi add ref images.
  // Lý do: Flow render duration option dựa trên ref type (vd ref=video → KHÔNG có duration options
  // → applySettings(duration=...) fail). Move applySettings vào LOOP, sau addFileToPrompt block.
  // applySettings idempotent (skip nếu match) → cost per iter ~100ms acceptable.
  //
  // Voice select VẪN pre-loop (persist across prompts — KHÔNG đổi theo ref type).

  // Flow Voice Selector — select voice trước vòng lặp prompt nếu có
  // (voice persist xuyên các prompt trong batch — không cần re-select per prompt).
  if (payload.voice && payload.voice.search_value) {
      try {
          const r = await selectFlowVoice(payload.voice);
          if (r?.success && r.selected) {
              sendLog(`Đã chọn voice: ${r.selected}`, 'info');
          } else if (r?.error === 'voice_not_found') {
              sendLog(`Voice "${payload.voice.search_value}" không có trong menu Flow — submit không voice`, 'warning');
          }
      } catch (e) {
          sendLog(`Lỗi chọn voice (non-blocking): ${e.message}`, 'warning');
      }
  }

  // Flow Character Selector — mirror voice: path legacy (queue OFF = mặc định) TRƯỚC ĐÂY bỏ sót
  // payload.character (chỉ pipeline/workflow path gọi) → chọn character ở GenTab rồi gen KHÔNG có
  // character, im lặng. Áp trước vòng lặp prompt (persist xuyên batch như voice).
  if (payload.character && payload.character.search_value) {
      try {
          const r = await selectFlowCharacter(payload.character);
          if (r?.success && r.selected) {
              sendLog(`Đã chọn character: ${r.selected}`, 'info');
          } else if (r?.error) {
              sendLog(`Character "${payload.character.search_value}" không chọn được — submit không character`, 'warning');
          }
      } catch (e) {
          sendLog(`Lỗi chọn character (non-blocking): ${e.message}`, 'warning');
      }
  }

  let completedCount = 0;
  let failedCount = 0;
  const allResultTileIds = []; // Collect actual result tile IDs across all prompts
  let lastPreTileIds = [];     // Track last captured preTileIds (for parallel mode return)
  let lastPreFileNames = null; // Track last captured preFileNames (for parallel mode return)

  // Parallel + autoDownload: capture baseline TRƯỚC prompt đầu tiên để chờ tất cả tiles sau
  // forceRefresh=true vì cần baseline chính xác trước vòng lặp submit
  const initialPreTileIds = noTileWait ? getUniqueTileIds(true) : [];
  const initialPreFileNames = noTileWait ? getExistingFileNames() : null;

  // Phase FAR-2: Consecutive failure tracker — silent session refresh recovery
  // (legacy mode KHÔNG hard-reload mid-runAutoPrompt, chỉ silent refresh).
  // Plan Section 3.2.
  let _consecutiveFailures = 0;
  let _lastSilentRefreshAt = 0;
  const SILENT_REFRESH_COOLDOWN_MS = 60000;  // Min 60s giữa 2 silent refresh attempts

  for (let i = 0; i < prompts.length; i++) {
    if (shouldStop) {
      sendLog('⚠️ Đã nhận lệnh dừng quá trình.', 'warn');
      break;
    }

    // Pause check
    if (isPaused) {
      sendLog('⏸ Đã tạm dừng. Nhấn Resume để tiếp tục.', 'warn');
      while (isPaused && !shouldStop) {
        await sleep(500);
      }
      if (shouldStop) {
        sendLog('⚠️ Đã nhận lệnh dừng quá trình.', 'warn');
        break;
      }
      sendLog('▶ Tiếp tục chạy...', 'info');
    }

    const prompt = prompts[i];
    const currentPrompt = prompt; // alias for blocker update
    sendLog(`[${i + 1}/${prompts.length}] "${prompt.substring(0, 50)}..."`, 'info');

    // Update ExecutionBlocker với prompt hiện tại
    ExecutionBlocker.update({
      title: 'Đang tạo ảnh...',
      subtitle: `Xử lý prompt ${i + 1}/${prompts.length}`,
      current: i,
      total: prompts.length,
      promptText: currentPrompt.length > 100 ? currentPrompt.substring(0, 100) + '...' : currentPrompt,
      indeterminate: false
    });

    let promptSuccess = false;

    // Reset retry tracking cho prompt mới — ngăn leak state từ prompt trước
    _clickedRetryTileIds.clear();

    // Outer attempt loop: 1 lần gốc + maxRetries lần retry (chỉ cho timeout case)
    const totalAttempts = 1 + retrySettings.maxRetries;
    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      if (shouldStop) break;

      if (attempt > 1) {
        // Phase FAR-5: Exponential backoff trước retry attempt — tránh thundering herd
        // attempt=2 → retryIdx=0 (~30s), attempt=3 → retryIdx=1 (~60s), ...
        const retryIdx = attempt - 2;
        const backoffMs = getExponentialBackoffMs(retryIdx, retrySettings);
        sendLog(`[Backoff] Đợi ${Math.round(backoffMs / 1000)}s trước thử lại lần ${attempt - 1}/${retrySettings.maxRetries}`, 'info');
        await sleep(backoffMs);
        if (shouldStop) break;

        sendLog(`Thử lại lần ${attempt - 1}/${retrySettings.maxRetries}...`, 'warn');
        // Update blocker: retry
        ExecutionBlocker.update({
          title: 'Đang thử lại...',
          subtitle: `Lần ${attempt - 1}/${retrySettings.maxRetries} - Prompt ${i + 1}/${prompts.length}`,
          current: i,
          total: prompts.length,
          promptText: currentPrompt.length > 100 ? currentPrompt.substring(0, 100) + '...' : currentPrompt,
          indeterminate: false
        });
      }

      let editor = getEditor();
      if (!editor) {
        sendLog('❌ Không tìm thấy ô nhập liệu (Slate editor)!', 'error');
        break;
      }

      // Check shouldStop trước khi bắt đầu các bước thao tác editor
      if (shouldStop) break;

      // 0. Pre-check: xoá ref images cũ đang có trong prompt area
      await removeExistingRefImages();
      if (shouldStop) break;

      // 1. Clears — delay cho Slate editor reset (sync với WorkflowExecutor)
      await clearEditor(editor);
      if (shouldStop) break;
      await sleep(humanized ? getHumanizedDelay(getClearEditorDelay()) : getClearEditorDelay());
      if (shouldStop) break;

      // 2. Add File References (or Frame references for Video+Frames)
      // Modes:
      // - 'all': tất cả prompts dùng chung tất cả fileIds
      // - 'mention': mỗi prompt dùng ảnh được @mention
      // - 'sequential' (refPerPrompt=true): mỗi prompt dùng 1 ảnh theo index
      // - 'none': không dùng ảnh tham chiếu
      let currentFileIds = fileIds;
      if (refImageMode === 'mention' && mentionData && mentionData[i]) {
        // Mention mode: lấy file_ids từ resolved @mentions
        const promptMentionData = mentionData[i];
        if (promptMentionData.refImages && promptMentionData.refImages.length > 0) {
          currentFileIds = promptMentionData.refImages
            .filter(ref => ref.file_id)  // Chỉ lấy những ref đã có file_id (đã upload)
            .map(ref => ref.file_id);
        } else {
          currentFileIds = [];
        }
      } else if (refImageMode === 'none') {
        // No ref images mode
        currentFileIds = [];
      } else if (refImageMode === 'sequential' || refPerPrompt) {
        // Sequential mode: mỗi prompt dùng 1 ảnh theo index
        currentFileIds = fileIds[i] ? [fileIds[i]] : [];
      }
      // 'all' mode: currentFileIds = fileIds (không thay đổi, dùng tất cả cho mỗi prompt)

      if (shouldStop) break; // Check trước khi add ref images

      if (frameFileIds) {
          // Resolve frame pair for current prompt
          const currentFrames = Array.isArray(frameFileIds)
            ? (frameFileIds[i] || null)
            : frameFileIds;
          if (currentFrames) {
            if (currentFrames.frame1 && !shouldStop) {
                sendLog(Array.isArray(frameFileIds) ? `Đang gài Frame Start (Prompt ${i + 1})...` : 'Đang gài Frame 1...', 'info');
                await addFileToPrompt(currentFrames.frame1, fileNameMap[currentFrames.frame1]);
            }
            if (currentFrames.frame2 && !shouldStop) {
                sendLog(Array.isArray(frameFileIds) ? `Đang gài Frame End (Prompt ${i + 1})...` : 'Đang gài Frame 2...', 'info');
                await addFileToPrompt(currentFrames.frame2, fileNameMap[currentFrames.frame2]);
            }
          }
      } else if (currentFileIds && currentFileIds.length > 0 && !shouldStop) {
          const logMsg = (refImageMode === 'sequential' || refPerPrompt)
            ? `Đang gài ảnh tham chiếu #${i + 1}...`
            : `Đang gài ${currentFileIds.length} ảnh tham chiếu...`;
          sendLog(logMsg, 'info');
          for (const fid of currentFileIds) {
              if (shouldStop) break; // Check trong vòng lặp add refs
              await addFileToPrompt(fid, fileNameMap[fid]);
          }
      }

      if (shouldStop) break; // Check sau khi add ref images

      // 2.5: 2026-05-30 REORDER — applySettings SAU khi add refs (TRƯỚC insertText).
      // Lý do: Flow render UI duration option dựa trên ref type. Vd ref=video → KHÔNG có
      // duration dropdown → applySettings(flowVideoDuration) fail nếu chạy trước add ref.
      // applySettings idempotent (skip nếu match) — first iter heavy, subsequent iter quick.
      // Cho refPerPrompt với refs khác type (image+video mix): apply lại đúng setting per iter.
      try {
        if (genType && aspectRatio && modelName) {
          const isFramesMode = !!frameFileIds;
          await applySettings(genType, aspectRatio, modelName, isFramesMode, quantity, flowVideoDuration);
        }
      } catch (e) {
        sendLog(`Lỗi thiết lập cấu hình AI (iter ${i + 1}): ${e.message}`, 'error');
      }
      if (shouldStop) break;

      // 3. Re-query editor (React có thể re-render sau clearEditor/addFileToPrompt/applySettings → DOM element bị thay thế)
      editor = getEditor();
      if (!editor) {
        sendLog('❌ Không tìm thấy ô nhập liệu sau khi gài ảnh!', 'error');
        break;
      }

      // 3a. Types Prompt
      await insertText(editor, prompt);
      if (shouldStop) break;

      // 3b. Chờ Slate editor xử lý xong text trước khi submit
      // Google Flow Slate cần thời gian process beforeinput event.
      // Nếu click submit trước khi Slate process xong → "Prompt must be provided" error.
      // Dùng 2x inputTimeout giống WorkflowExecutor (đã test ổn định).
      const delayBeforeSubmit = humanized ? getHumanizedDelay(DELAY_BEFORE_SUBMIT) : DELAY_BEFORE_SUBMIT;
      await sleep(delayBeforeSubmit);
      if (shouldStop) break;

      // 4. Verify Slate model has text (check placeholder gone, not just DOM textContent)
      editor = getEditor() || editor;
      const hasPlaceholder = () => {
        const ed = getEditor();
        return ed && ed.querySelector('[data-slate-placeholder]') !== null;
      };

      if (hasPlaceholder()) {
        sendLog('⚠️ Slate placeholder vẫn còn → model rỗng, chờ...', 'warn');
        let waitSlate = 0;
        while (hasPlaceholder() && waitSlate < 2000) {
          await sleep(200);
          waitSlate += 200;
        }

        // Fallback: retry insert
        if (hasPlaceholder()) {
          sendLog('⚠️ Retry insert text...', 'warn');
          await _insertTextSingle(prompt);
          await sleep(500);
        }
      }

      // 4.5: 2026-05-30 — CRITICAL pre-submit check: detect Google Flow account hit credit limit.
      // Khi limit hit, submit button bị REPLACE bằng alert icon (flow_alert_sphere).
      // Phải check Ở ĐÂY (sau apply settings + insertText) — alert chỉ xuất hiện sau khi
      // chọn model + mode đầy đủ. KHÔNG check sớm hơn (vd ở applySettings) vì alert chưa render.
      if (_checkFlowCreditLimit()) {
        // Đa ngôn ngữ: I18n.t fallback VI (content script chạy trong Flow page → window.I18n
        // có thể chưa load nếu page reload nhanh → fallback VI vẫn user-friendly cho default audience).
        const msg = (typeof window.I18n?.t === 'function')
          ? window.I18n.t('flow.creditLimitHit')
          : null;
        const finalMsg = msg || 'Tài khoản Google Flow đã hết credit — KHÔNG thể submit. Đợi reset hoặc upgrade Flow plan.';
        sendLog('❌ ' + finalMsg, 'error');
        if (typeof window.showNotification === 'function') {
          window.showNotification(finalMsg, 'error', 10000);
        }
        // Set last_error code để caller (PromptQueue/WorkflowExecutor) biết stop toàn batch
        try {
          chrome.runtime.sendMessage({
            action: 'reportFlowError',
            errorCode: 'FLOW_CREDIT_LIMIT',
            message: finalMsg,
          }).catch(function (_e) { globalThis.SEOSONA_swallow?.('content#hasPlaceholder', _e); });
        } catch (_) { globalThis.SEOSONA_swallow?.('content#hasPlaceholder', _); }
        break; // Abort remaining prompts trong batch
      }

      // 5. Click Submit
      let submitBtn = getSubmitButton();
      if (!submitBtn) {
        sendLog('❌ Không tìm thấy nút Submit (arrow_forward)!', 'error');
        break;
      }

      // 5a. Chờ submit button enabled (Flow enable nút khi Slate đã process text)
      let waitSubmit = 0;
      while (submitBtn.disabled && waitSubmit < 15000) {
        await sleep(300);
        waitSubmit += 300;
        submitBtn = getSubmitButton() || submitBtn;
      }
      if (submitBtn.disabled) {
        sendLog('⚠️ Nút Submit vẫn disabled sau 15s, thử click...', 'warn');
      }

      // 5b. Record pre-submit tile IDs + file_names (for filtering lazy-loaded old tiles)
      // forceRefresh=true vì cần baseline chính xác trước khi submit
      const allPreTileIds = getUniqueTileIds(true);
      const allPreFileNames = getExistingFileNames();
      // Save for parallel mode return (capture tại thời điểm submit chính xác)
      lastPreTileIds = allPreTileIds;
      lastPreFileNames = allPreFileNames;

      // 5c. Click submit — ưu tiên bridge (main world .click()) rồi fallback simulateClick
      const afterSubmitDelay = getAfterSubmitDelay();
      sendLog(`Đang click Submit...`, 'info');

      // Tier 1: Bridge submit (main world — React onClick trực tiếp).
      // Strict Server-Only: pass iconSelector từ provider_configs.dom_selector.icon_element cho bridge.
      const iconSelectorForBridge = (_getDynamicSelector('icon_element')?.selectors || []).join(', ');
      const submitResult = await _slateBridgeCall('submit', { iconSelector: iconSelectorForBridge, submitIconText: _getDynamicSelector('submit_button')?.icon_text });
      if (!submitResult.success) {
        sendLog('⚠️ Bridge submit failed: ' + submitResult.error + ', fallback simulateClick', 'warn');
        simulateClick(submitBtn);
      }
      _incrementDailyStat('flow_prompt_total');
      await sleep(afterSubmitDelay);

      // 5d. Chờ editor cleared (Flow tự clear sau submit thành công)
      // Chỉ retry nếu bridge submit fail, không retry khi đã thành công
      if (!submitResult.success) {
        const editorAfterSubmit = getEditor();
        const editorTextAfter = editorAfterSubmit?.textContent?.trim() || '';
        if (editorTextAfter.length > 10) {
          sendLog('⚠️ Editor chưa bị xóa sau click, thử submit lại...', 'warn');
          submitBtn = getSubmitButton() || submitBtn;
          submitBtn.click();
          await sleep(afterSubmitDelay);
        }
      }
      sendLog(`✅ Đã submit prompt #${i+1}`, 'success');

      // Update FloatingTracker + ExecutionBlocker + sidePanel progress
      FloatingTracker.updateLegacy({
        owner: payload._owner || 'prompts',
        label: payload._label || 'Auto Gen',
        status: isPaused ? 'paused' : 'running',
        current: i + 1,
        total: prompts.length,
        failed: failedCount,
        startedAt: _startedAt
      });
      ExecutionBlocker.update({
        title: isPaused ? 'Đã tạm dừng' : 'Đang tạo ảnh...',
        subtitle: isPaused ? 'Nhấn Tiếp tục để chạy tiếp' : 'Chờ kết quả từ Flow...',
        current: i + 1,
        total: prompts.length,
        promptText: currentPrompt.length > 100 ? currentPrompt.substring(0, 100) + '...' : currentPrompt,
        indeterminate: false
      });
      try {
        chrome.runtime.sendMessage({
          action: 'promptProgress',
          current: i + 1,
          total: prompts.length
        });
      } catch (e) { globalThis.SEOSONA_swallow?.('content#hasPlaceholder', e); }

      // 6. Wait for result tiles (skip khi noTileWait = true cho parallel mode)
      if (noTileWait) {
        sendLog('Song song: bỏ qua chờ tiles, tiếp tục...', 'info');
        // Parallel mode: trả về preTileIds + preFileNames cho caller tự gọi waitForNewTiles
        // Đây là baseline đúng vì capture ngay trước submit (line 1004-1006)
        completedCount++;
        promptSuccess = true;
      } else if (!shouldStop) {
        sendLog('Chờ kết quả...', 'info');
        // Update blocker: đang chờ tiles
        ExecutionBlocker.update({
          title: 'Đang chờ kết quả...',
          subtitle: `Flow đang xử lý prompt ${i + 1}/${prompts.length}`,
          current: i,
          total: prompts.length,
          promptText: currentPrompt.length > 100 ? currentPrompt.substring(0, 100) + '...' : currentPrompt,
          indeterminate: true
        });
        const result = await waitForNewTiles(allPreTileIds, retrySettings.tileTimeout, allPreFileNames);
        if (result.failed) {
          sendLog('❌ Google Flow báo lỗi - tạo ảnh thất bại', 'error');

          // Tách tiles fail vs success
          const failedTids = result.tiles.filter(tid => {
            const tile = _getTileById(tid);
            return detectTileStatus(tile) === 'failed';
          });
          const successTids = result.tiles.filter(tid => !failedTids.includes(tid));

          const allTilesFailed = successTids.length === 0;

          // Download tiles success ngay (nếu có)
          if (successTids.length > 0) {
            allResultTileIds.push(...successTids);
            if (autoDownload) {
              for (const tid of successTids) {
                await downloadTileMedia(tid, prompt, taskName || null, null, downloadResolution, null, null, videoDownloadResolution);
                await sleep(200);
              }
            }
          }

          // Retry tiles fail bằng nút "Thử lại" trên Flow (nhanh + đáng tin cậy hơn submit lại)
          if (failedTids.length > 0 && retrySettings.maxRetries > 0) {
            let remainingFailed = failedTids;
            // Track running success count: original successTids + tất cả retry successes.
            // Dùng làm discriminator cho Tier 2 (thay vì so sánh length array vốn không
            // chính xác khi retryFailedTilesViaButton trả [] cho cả succeeded + stillFailed
            // trong timeout case — Flow click retry OK nhưng tile mới chưa hiện trong 60s).
            let promptSuccessCount = successTids.length;

            // Tier 1: Click retry trên từng tile fail, lặp (maxRetries - 1) lần
            for (let btnRetry = 1; btnRetry <= retrySettings.maxRetries && remainingFailed.length > 0 && !shouldStop; btnRetry++) {
              sendLog(`[Retry L1] Click "Thử lại" lần ${btnRetry}/${retrySettings.maxRetries} cho ${remainingFailed.length} tile fail...`, 'warn');
              sendRetryStatus(`Click Retry (${btnRetry}/${retrySettings.maxRetries})`);
              const retryResult = await retryFailedTilesViaButton(remainingFailed, retrySettings.tileTimeout);

              if (retryResult.succeeded.length > 0) {
                allResultTileIds.push(...retryResult.succeeded);
                promptSuccessCount += retryResult.succeeded.length;
                sendLog(`[Retry L1] Thành công: ${retryResult.succeeded.length} ảnh`, 'success');
                if (autoDownload) {
                  for (const tid of retryResult.succeeded) {
                    await downloadTileMedia(tid, prompt, taskName || null, null, downloadResolution, null, null, videoDownloadResolution);
                    await sleep(200);
                  }
                }
              }
              remainingFailed = retryResult.stillFailed;
            }

            // Tất cả đã retry thành công
            if (remainingFailed.length === 0 && promptSuccessCount > 0) {
              completedCount++;
              promptSuccess = true;
            }

            // Tier 2 Fallback: CHỈ submit lại prompt 1 LẦN khi 0 tile success suốt
            // original + Tier 1 retry. Dùng promptSuccessCount thay vì array length compare
            // (tránh false negative trong timeout case khi retryFailedTilesViaButton trả [],[]).
            // NOTE: Pipeline mode có thêm bước reload Flow tab giữa Tier 1 và Tier 2 để reset
            // editor state (xem TileMonitor.js + PromptQueue.forceReloadAndStabilize).
            // Legacy mode KHÔNG reload được vì content.js là orchestrator — location.reload()
            // sẽ kill execution context. Để dùng full retry-reload-fallback flow, bật pipeline
            // mode (queueEnabled=true).
            if (promptSuccessCount === 0 && !shouldStop) {
              sendLog(`[Retry L2] Tất cả ${failedTids.length} tile fail - Đang gửi lại prompt...`, 'warn');
              sendRetryStatus('Gửi lại Prompt');
              await sleep(getDelayBetweenPromptsMs());

              let fbEditor = getEditor();
              if (fbEditor) {
                await removeExistingRefImages();
                await clearEditor(fbEditor);
                await sleep(getClearEditorDelay());

                // Re-add ref images
                if (currentFileIds && currentFileIds.length > 0) {
                  for (const fid of currentFileIds) await addFileToPrompt(fid, fileNameMap[fid]);
                }
                if (frameFileIds) {
                  const retryFrames = Array.isArray(frameFileIds) ? (frameFileIds[i] || null) : frameFileIds;
                  if (retryFrames) {
                    if (retryFrames.frame1) await addFileToPrompt(retryFrames.frame1, fileNameMap[retryFrames.frame1]);
                    if (retryFrames.frame2) await addFileToPrompt(retryFrames.frame2, fileNameMap[retryFrames.frame2]);
                  }
                }

                fbEditor = getEditor();
                if (fbEditor) {
                  await insertText(fbEditor, prompt);
                  await sleep(getSubmitDelay());

                  // forceRefresh=true vì cần baseline chính xác trước fallback submit
                  const fbPreTileIds = getUniqueTileIds(true);
                  const fbPreFileNames = getExistingFileNames();

                  const fbSubmitResult = await _slateBridgeCall('submit', {});
                  if (!fbSubmitResult.success) {
                    let fbBtn = getSubmitButton();
                    if (fbBtn) {
                      let fbWait = 0;
                      while (fbBtn.disabled && fbWait < 10000) { await sleep(300); fbWait += 300; fbBtn = getSubmitButton() || fbBtn; }
                      simulateClick(fbBtn);
                    }
                  }
                  await sleep(getAfterSubmitDelay());

                  const fbResult = await waitForNewTiles(fbPreTileIds, retrySettings.tileTimeout, fbPreFileNames);
                  if (fbResult.tiles.length > 0 && !fbResult.failed) {
                    allResultTileIds.push(...fbResult.tiles);
                    sendLog(`[Retry L2] Gửi lại thành công: ${fbResult.tiles.length} ảnh`, 'success');
                    if (autoDownload) {
                      for (const tid of fbResult.tiles) {
                        await downloadTileMedia(tid, prompt, taskName || null, null, downloadResolution, null, null, videoDownloadResolution);
                        await sleep(200);
                      }
                    }
                    completedCount++;
                    promptSuccess = true;
                  } else {
                    sendLog(`[Retry L2] Gửi lại cũng thất bại`, 'error');
                  }
                }
              }
            }

            // Một số tile vẫn fail sau button retry → ghi nhận
            if (!promptSuccess && remainingFailed.length > 0) {
              sendLog(`[Retry L1] ${remainingFailed.length}/${failedTids.length} tile vẫn fail sau click "Thử lại"`, 'warn');
            }
          }

          // Có ít nhất 1 tile success (gốc hoặc từ button retry) → tính là partial success
          const hasAnySuccess = successTids.length > 0 || allResultTileIds.length > 0;
          if (!promptSuccess && hasAnySuccess) {
            completedCount++;
            promptSuccess = true;
          }
          if (!promptSuccess) {
            failedCount++;
            _incrementDailyStat('flow_fail');
            failedPrompts.push({ index: i, prompt, error: 'Google Flow error', timestamp: Date.now() });
          }
        } else if (result.tiles.length > 0) {
          sendLog(`✅ Có ${result.tiles.length} kết quả mới`, 'success');
          allResultTileIds.push(...result.tiles);
          if (autoDownload) {
            sendLog(`Đang tải ${result.tiles.length} file [${downloadResolution.toUpperCase()}]...`, 'info');
            for (const tid of result.tiles) {
              await downloadTileMedia(tid, prompt, taskName || null, null, downloadResolution, null, null, videoDownloadResolution);
              await sleep(200);
            }
          }
          completedCount++;
          promptSuccess = true;
        } else {
          sendLog('⚠️ Timeout - không có kết quả mới', 'warn');
          if (attempt < totalAttempts) {
            const retryDelay = getDelayBetweenPromptsMs();
            const waitSec = Math.round(retryDelay / 1000);
            sendLog(`Chờ ${waitSec}s trước khi thử lại...`, 'warn');
            await sleep(retryDelay);
            continue; // retry
          }
          failedCount++;
          _incrementDailyStat('flow_fail');
          failedPrompts.push({ index: i, prompt, error: 'Timeout - no results', timestamp: Date.now() });
        }
      }
      break; // success or final failure, exit retry loop
    }

    // Phase FAR-2: Consecutive failure tracker → trigger silent session refresh.
    // KHÔNG hard-reload (sẽ kill runAutoPrompt loop). Pipeline mode dùng
    // forceReloadAndStabilize qua TileMonitor (đã có sẵn). Plan Section 3.2.
    if (promptSuccess) {
      _consecutiveFailures = 0;
    } else {
      _consecutiveFailures++;
      const threshold = retrySettings.flowConsecutiveFailThreshold || 2;
      const recoveryEnabled = retrySettings.flowAutoRecoveryEnabled !== false;
      const now = Date.now();
      const cooldownPassed = (now - _lastSilentRefreshAt) > SILENT_REFRESH_COOLDOWN_MS;
      if (recoveryEnabled
          && _consecutiveFailures >= threshold
          && i < prompts.length - 1
          && cooldownPassed
          && !shouldStop) {
        sendLog(`[Recovery] ${_consecutiveFailures} prompt fail liên tiếp — thử silent refresh Flow session...`, 'warn');
        sendRetryStatus('Refreshing Flow session');
        _lastSilentRefreshAt = now;
        const refreshed = await refreshFlowSession('recovery');
        if (refreshed) {
          _consecutiveFailures = 0;
          sendLog('[Recovery] Session refreshed thành công, tiếp tục queue', 'success');
          await sleep(3000);  // settle delay cho Next.js re-fetch
        } else {
          sendLog('[Recovery] Silent refresh fail — tiếp tục normal retry. Bật Pipeline Queue để dùng full reload-recovery flow.', 'warn');
        }
      }
    }

    // 7. Wait for next prompt
    // [Fix] Humanized mode: dùng random delay với jitter
    //       Normal mode: dùng delayBetweenPrompts từ settings (payload)
    if (i < prompts.length - 1 && !shouldStop) {
      const actualDelay = humanized
        ? getHumanizedDelay(getRandomDelay())
        : _cachedDelayBetweenMs;
      sendLog(`Chờ ${(actualDelay / 1000).toFixed(1)}s cho lượt tạo tiếp theo...`);
      await sleep(actualDelay);
    }
  }

  // Parallel mode: chờ TẤT CẢ tiles hoàn thành → retry nếu cần + download nếu bật
  if (noTileWait && !shouldStop && completedCount > 0) {
    sendLog('Chờ tất cả kết quả hoàn thành...', 'info');
    try {
      const allTilesResult = await waitForNewTiles(initialPreTileIds, retrySettings.tileTimeout, initialPreFileNames);
      if (allTilesResult.tiles.length > 0) {
        // Filter bỏ ref images
        const refIdSet = new Set(fileIds || []);
        const pureNewTiles = allTilesResult.tiles.filter(id => !refIdSet.has(id));

        // Fix: Settle delay TRƯỚC classify — Flow đôi khi flicker UI 'failed'
        // transient trước khi render final 'success'. waitForNewTiles return ngay
        // khi tiles có status nào đó stable, nhưng React/Flow có thể re-render lại
        // sau đó. 800ms settle giảm false-positive 'failed' classification → tránh
        // retry dư thừa trên tile thực ra success.
        await sleep(800);

        // Tách tiles thành công vs thất bại.
        // Fix: trước đây else-branch gom CẢ 'processing' và tile=null
        // (DOM removed) vào successTiles → download fire trên tile chưa ready/đã mất →
        // "tile not found" + missing files. Phải check explicit 'success'.
        const successTiles = [];
        const failedTileIds = [];
        const skippedTiles = [];
        for (const tid of pureNewTiles) {
          const tile = _getTileById(tid);
          const status = detectTileStatus(tile);
          if (status === 'failed') {
            failedTileIds.push(tid);
          } else if (status === 'success' && tile) {
            successTiles.push(tid);
          } else {
            // 'processing' hoặc tile=null (DOM removed) → KHÔNG download (sẽ fail).
            // Log warn để user biết, không count vào success/failed.
            skippedTiles.push(tid);
          }
        }
        if (skippedTiles.length > 0) {
          sendLog(`⚠️ ${skippedTiles.length} tile chưa ready (processing/missing) — bỏ qua download`, 'warn');
        }

        // Download tiles thành công
        allResultTileIds.push(...successTiles);
        if (successTiles.length > 0 && autoDownload) {
          sendLog(`Đang tải ${successTiles.length} file [${downloadResolution.toUpperCase()}]...`, 'info');
          // Bug fix 2026-06-03: map tile position → prompt index (same pattern line 7271 retry mapping).
          // Pattern: Flow render `quantity` tiles/prompt theo submit order → position `ti` của tile
          // trong `pureNewTiles` ánh xạ `prompts[Math.floor(ti / quantity)]`.
          // Trước fix: prompts[0] cho TẤT CẢ → filename collision (Chrome auto-suffix _(1), _(2)…)
          // Edge case silent fail (Flow gen error KHÔNG sinh tile UI) → mapping vẫn shift,
          // khuyến nghị user enable Pipeline Queue để dùng claim-by-submit-order chính xác hơn.
          const successSet = new Set(successTiles);
          for (let ti = 0; ti < pureNewTiles.length; ti++) {
            const tid = pureNewTiles[ti];
            if (!successSet.has(tid)) continue;
            const promptIdx = Math.floor(ti / quantity);
            const promptForTile = prompts[promptIdx] || prompts[0] || 'parallel-batch';
            await downloadTileMedia(tid, promptForTile, taskName || null, null, downloadResolution, null, null, videoDownloadResolution);
            await sleep(200);
          }
          sendLog(`Đã tải ${successTiles.length} file`, 'success');
        }

        // Retry failed tiles bằng nút "Thử lại" trên Flow (ưu tiên) → fallback submit lại prompt
        _clickedRetryTileIds.clear(); // Reset cho parallel retry session
        if (failedTileIds.length > 0 && retrySettings.maxRetries > 0) {
          // Map failed tile position → prompt index
          const failedPromptIndices = [];
          for (let ti = 0; ti < pureNewTiles.length; ti++) {
            if (failedTileIds.includes(pureNewTiles[ti])) {
              const promptIdx = Math.floor(ti / quantity);
              if (promptIdx < prompts.length && !failedPromptIndices.includes(promptIdx)) {
                failedPromptIndices.push(promptIdx);
              }
            }
          }

          sendLog(`${failedTileIds.length} ảnh thất bại (${failedPromptIndices.length} prompt), click "Thử lại"...`, 'warn');

          // Tier 1: Click nút "Thử lại" trên tất cả tiles fail (nhanh + đáng tin cậy)
          let remainingFailed = [...failedTileIds];
          for (let btnRetry = 1; btnRetry <= retrySettings.maxRetries && remainingFailed.length > 0 && !shouldStop; btnRetry++) {
            sendLog(`Click "Thử lại" lần ${btnRetry} cho ${remainingFailed.length} tile...`, 'warn');
            sendRetryStatus(`Click Retry (${btnRetry}/${retrySettings.maxRetries})`);
            const btnResult = await retryFailedTilesViaButton(remainingFailed, retrySettings.tileTimeout);

            if (btnResult.succeeded.length > 0) {
              allResultTileIds.push(...btnResult.succeeded);
              sendLog(`Retry button thành công: ${btnResult.succeeded.length} ảnh`, 'success');
              // Known limitation 2026-06-03: filename dùng prompts[0] thay vì prompt gốc của
              // failed tile. Lý do: retryFailedTilesViaButton return [newTid] mà không track
              // mapping {oldFailedTid → newTid} (skip case break order). Fix yêu cầu modify
              // signature (invasive, 3 callers). Scope: chỉ ảnh hưởng retry tile filename;
              // initial download đã đúng prompt (line 7258). User dùng Pipeline Queue mode
              // (default) sẽ không gặp path này.
              for (const tid of btnResult.succeeded) {
                await downloadTileMedia(tid, prompts[0] || 'parallel-batch', taskName || null, null, downloadResolution, null, null, videoDownloadResolution);
                await sleep(200);
              }
            }
            remainingFailed = btnResult.stillFailed;
          }

          // Tier 2 Fallback: CHỈ submit lại prompt khi TẤT CẢ tiles của prompt đó fail
          // Nếu chỉ 1-2 tile fail trong batch quantity=4 → ghi nhận failed, không submit lại cả batch (lãng phí)
          if (remainingFailed.length > 0 && !shouldStop) {
            // Map remaining failed tiles → prompt indices, kiểm tra xem prompt đó CÓ tile nào success không
            const allFailedPromptIndices = [];
            for (let ti = 0; ti < pureNewTiles.length; ti++) {
              if (remainingFailed.includes(pureNewTiles[ti])) {
                const promptIdx = Math.floor(ti / quantity);
                if (promptIdx < prompts.length && !allFailedPromptIndices.includes(promptIdx)) {
                  allFailedPromptIndices.push(promptIdx);
                }
              }
            }

            // Tìm prompts mà TẤT CẢ tiles đều fail (không có tile nào success)
            // Dùng remainingFailed (sau button retry) thay vì failedTileIds (trước retry)
            const fullyFailedPromptIndices = allFailedPromptIndices.filter(promptIdx => {
              const startTile = promptIdx * quantity;
              const endTile = Math.min(startTile + quantity, pureNewTiles.length);
              for (let ti = startTile; ti < endTile; ti++) {
                if (!remainingFailed.includes(pureNewTiles[ti])) return false; // Có tile success hoặc đã retry thành công
              }
              return true;
            });

            // Chỉ fallback submit cho prompts mà TẤT CẢ tiles fail
            if (fullyFailedPromptIndices.length > 0) {
              sendLog(`[Retry L2] ${fullyFailedPromptIndices.length} prompt tất cả tiles fail - Đang gửi lại...`, 'warn');
              sendRetryStatus('Gửi lại Prompt');

              for (let ri = 0; ri < fullyFailedPromptIndices.length && !shouldStop; ri++) {
                const promptIdx = fullyFailedPromptIndices[ri];
                const retryPrompt = prompts[promptIdx];
                sendLog(`[Retry L2] Gửi lại prompt ${ri + 1}/${fullyFailedPromptIndices.length}: "${retryPrompt.substring(0, 40)}..."`, 'warn');

                let editor = getEditor();
                if (!editor) break;
                await clearEditor(editor);
                await sleep(getClearEditorDelay());

                let retryFileIds = [];
                if (refImageMode === 'mention' && mentionData && mentionData[promptIdx]) {
                  const promptMentionData = mentionData[promptIdx];
                  if (promptMentionData.refImages && promptMentionData.refImages.length > 0) {
                    retryFileIds = promptMentionData.refImages.filter(ref => ref.file_id).map(ref => ref.file_id);
                  }
                } else if (refImageMode === 'none') {
                  retryFileIds = [];
                } else if (refImageMode === 'sequential' || refPerPrompt) {
                  retryFileIds = fileIds[promptIdx] ? [fileIds[promptIdx]] : [];
                } else {
                  retryFileIds = fileIds || [];
                }

                if (retryFileIds.length > 0) {
                  for (const fid of retryFileIds) await addFileToPrompt(fid, fileNameMap[fid]);
                }

                editor = getEditor();
                if (!editor) break;
                await insertText(editor, retryPrompt);
                await sleep(getSubmitDelay());

                // forceRefresh=true vì cần baseline chính xác trước retry submit
                const retryPreTileIds = getUniqueTileIds(true);
                const retryPreFileNames = getExistingFileNames();

                const iconSelectorForRetryBridge = (_getDynamicSelector('icon_element')?.selectors || []).join(', ');
                const submitResult = await _slateBridgeCall('submit', { iconSelector: iconSelectorForRetryBridge, submitIconText: _getDynamicSelector('submit_button')?.icon_text });
                if (!submitResult.success) {
                  let submitBtn = getSubmitButton();
                  if (!submitBtn) break;
                  let waitMs = 0;
                  while (submitBtn.disabled && waitMs < 10000) { await sleep(300); waitMs += 300; submitBtn = getSubmitButton() || submitBtn; }
                  simulateClick(submitBtn);
                }
                await sleep(getAfterSubmitDelay());

                const retryResult = await waitForNewTiles(retryPreTileIds, retrySettings.tileTimeout, retryPreFileNames);
                if (retryResult.tiles.length > 0) {
                  const retryNewTiles = retryResult.tiles.filter(id => !refIdSet.has(id));
                  // Tách success vs fail (handle partial success)
                  const retrySuccessTiles = retryNewTiles.filter(tid => {
                    const tile = _getTileById(tid);
                    return detectTileStatus(tile) !== 'failed';
                  });
                  if (retrySuccessTiles.length > 0) {
                    allResultTileIds.push(...retrySuccessTiles);
                    if (autoDownload) {
                      for (const tid of retrySuccessTiles) {
                        await downloadTileMedia(tid, retryPrompt, taskName || null, null, downloadResolution, null, null, videoDownloadResolution);
                        await sleep(200);
                      }
                    }
                    sendLog(`[Retry L2] Gửi lại thành công: ${retrySuccessTiles.length}/${retryNewTiles.length} ảnh`, 'success');
                  }
                  if (retrySuccessTiles.length < retryNewTiles.length) {
                    const fbFailCount = retryNewTiles.length - retrySuccessTiles.length;
                    sendLog(`[Retry L2] ${fbFailCount} tile vẫn fail sau gửi lại`, 'warn');
                    if (retrySuccessTiles.length === 0) {
                      failedCount++;
                      _incrementDailyStat('flow_fail');
                      failedPrompts.push({ index: promptIdx, prompt: retryPrompt, error: 'Retry failed', timestamp: Date.now() });
                    }
                  }
                } else {
                  sendLog(`[Retry L2] Gửi lại thất bại: "${retryPrompt.substring(0, 40)}..."`, 'error');
                  failedCount++;
                  _incrementDailyStat('flow_fail');
                  failedPrompts.push({ index: promptIdx, prompt: retryPrompt, error: 'Retry failed', timestamp: Date.now() });
                }

                if (ri < fullyFailedPromptIndices.length - 1) await sleep(getDelayBetweenPromptsMs());
              }
            }

            // Prompts có partial fail (1-2 tile fail, còn lại success) → ghi nhận failed tiles
            const partialFailPromptIndices = allFailedPromptIndices.filter(idx => !fullyFailedPromptIndices.includes(idx));
            if (partialFailPromptIndices.length > 0) {
              const partialFailCount = remainingFailed.filter(tid => {
                const ti = pureNewTiles.indexOf(tid);
                const promptIdx = Math.floor(ti / quantity);
                return partialFailPromptIndices.includes(promptIdx);
              }).length;
              sendLog(`${partialFailCount} tile fail (partial) — đã tải ${successTiles.length} tile thành công`, 'warn');
            }
          }
        } else if (failedTileIds.length > 0) {
          // retry_on_fail = false → ghi nhận failed per prompt (không per tile), không retry
          const failedPromptSet = new Set();
          for (let ti = 0; ti < pureNewTiles.length; ti++) {
            if (failedTileIds.includes(pureNewTiles[ti])) {
              const promptIdx = Math.floor(ti / quantity);
              if (promptIdx < prompts.length && !failedPromptSet.has(promptIdx)) {
                failedPromptSet.add(promptIdx);
                failedCount++;
                _incrementDailyStat('flow_fail');
                failedPrompts.push({ index: promptIdx, prompt: prompts[promptIdx], error: 'Google Flow error', timestamp: Date.now() });
              }
            }
          }
          sendLog(`${failedTileIds.length} ảnh thất bại (${failedPromptSet.size} prompt) - Retry bị khóa`, 'warn');
        }
      } else {
        sendLog('⚠️ Không có kết quả mới để tải', 'warn');
      }
    } catch (e) {
      sendLog('Lỗi khi chờ/tải kết quả: ' + e.message, 'error');
    }
  }

  if (!shouldStop) {
    if (failedCount > 0) {
      sendLog(`⚠️ Hoàn tất: ${completedCount} thành công, ${failedCount} thất bại`, 'warn');
    } else {
      sendLog('🎉 Hoàn tất tất cả prompts!', 'success');
    }
    notifyCompletion('SEOSONA Flow', `Hoàn tất: ${completedCount}/${prompts.length} prompts`);
  }

  isRunning = false;
  isPaused = false;

  // ExecutionBlocker: ẩn overlay TRƯỚC FloatingTracker (tránh exception block hide)
  ExecutionBlocker.hide();

  // FloatingTracker: hiển thị kết quả hoàn tất (có thể throw, nhưng blocker đã hide)
  try {
    FloatingTracker.updateLegacy({
      owner: payload._owner || 'prompts',
      label: payload._label || 'Auto Gen',
      status: shouldStop ? 'stopped' : 'completed',
      current: completedCount,
      total: prompts.length,
      failed: failedCount,
      startedAt: _startedAt
    });
  } catch (e) {
    console.warn('[runAutoPrompt] FloatingTracker.updateLegacy error:', e.message);
  }

  // Notify sidePanel about completion and failed prompts
  try {
    chrome.runtime.sendMessage({
      action: 'promptExecutionComplete',
      completedCount,
      failedCount,
      totalCount: prompts.length,
      failedPrompts: failedPrompts.length > 0 ? failedPrompts : []
    }).catch(function (_e) { globalThis.SEOSONA_swallow?.('content#scanGalleryTiles', _e); });
  } catch (e) { globalThis.SEOSONA_swallow?.('content#hasPlaceholder', e); }

  return {
    success: true,
    completedCount,
    failedCount,
    totalCount: prompts.length,
    uploadedFileIds: fileIds,
    resultTileIds: allResultTileIds,
    // Parallel mode: trả về baseline tại thời điểm submit để caller tự gọi waitForNewTiles
    preTileIds: lastPreTileIds,
    // Convert Set → Array để serialize qua chrome message
    preFileNames: lastPreFileNames ? Array.from(lastPreFileNames) : null
  };
}

/**
 * K-4: Scan all gallery tiles and return structured data
 * Returns array of { tileId, mediaType, mediaSrc, status, thumbnail }
 */
function scanGalleryTiles() {
  const tileIds = getUniqueTileIds();
  const results = [];
  for (const tileId of tileIds) {
    const tile = _getTileById(tileId);
    if (!tile) continue;

    const img = tile.querySelector('img');
    const video = _q('tile_video', tile);
    let mediaType = 'unknown';
    let mediaSrc = '';
    let thumbnail = '';

    // Video detection: ưu tiên check <video> trước, fallback alt="Video thumbnail"
    // Flow có thể render cả <img> (thumbnail) + <video> trong cùng tile
    // Video element có thể chưa render khi tile vừa complete
    const isVideoByAlt = img?.alt?.toLowerCase().includes('video');
    if (video) {
      mediaType = 'video';
      mediaSrc = video.src || (video.querySelector('source')?.src) || '';
      // Thumbnail priority: poster > <img> sibling > video src
      thumbnail = video.poster || '';
      if (!thumbnail && img && img.src && !img.src.startsWith('data:') && !img.src.includes('chrome-extension')) {
        thumbnail = img.src;
      }
      if (!thumbnail) thumbnail = mediaSrc;
    } else if (isVideoByAlt && img && img.src && !img.src.startsWith('data:') && !img.src.includes('chrome-extension')) {
      // Video tile detected via alt attribute — video element not rendered yet
      mediaType = 'video';
      mediaSrc = img.src; // Fallback to img src
      thumbnail = img.src;
    } else if (img && img.src && !img.src.startsWith('data:') && !img.src.includes('chrome-extension')) {
      mediaType = 'image';
      mediaSrc = img.src;
      thumbnail = img.src;
    }

    const status = detectTileStatus(tile);
    const file_name = extractFileName(tile) || null;

    const flowInfo = extractFlowFileInfo(tile);
    results.push({ tileId, mediaType, mediaSrc, status, thumbnail, file_name, ...(flowInfo && { file_id: flowInfo.file_id, project_id: flowInfo.project_id }) });
  }
  return results;
}

// ─── Flow page settings init (1-time per page load) ───────────────────
// Flag track xem đã apply Grid view + show tile details chưa.
// Persist qua sessionStorage để survive extension reload trong cùng tab.
// 2026-06-03: Bump key v2 — invalidate flag từ code cũ (set unconditionally) để Fix 1
// verify block có cơ hội chạy. Old key 'seosonaflow_settings_applied' bị orphan + clear silently.
var _FLOW_SETTINGS_KEY = 'seosonaflow_settings_applied_v2';
var _flowSettingsApplied = sessionStorage.getItem(_FLOW_SETTINGS_KEY) === 'true';
// One-time cleanup: xóa key v1 nếu tồn tại (giảm sessionStorage clutter)
try { sessionStorage.removeItem('seosonaflow_settings_applied'); } catch (_) { globalThis.SEOSONA_swallow?.('content#scanGalleryTiles', _); }

/**
 * Apply Flow page settings (Grid view + show tile details) — chỉ chạy 1 LẦN per tab session.
 * Intent: setup Flow page UI để extension có thể parse tiles đúng (Grid layout + chi tiết).
 * Idempotent: subsequent calls skip ngay nhờ flag `_flowSettingsApplied` (persist qua sessionStorage).
 * Caller: gọi ở entry point của các operations cần Flow page setup đúng (vd applySettings).
 * Tách riêng từ `ensureFlowTilesLoaded()` (chỉ làm zoom) — settings là 1-time concern,
 * không cần fire mỗi lần check tile.
 */
/**
 * Flow Credit Limit Detection (2026-05-30) — Detect tài khoản Google Flow hit limit credit.
 * Khi limit hit, submit button (arrow_forward) bị REPLACE bằng alert icon (flow_alert_sphere).
 *
 * Strict server-only: query qua selector từ `flow_credit_limit_alert` config.
 * Caller: pre-submit guard trong runAutoPrompt (sau apply settings + insertText, trước getSubmitButton).
 *
 * @returns {boolean} true nếu alert icon visible (limit hit) → caller phải abort submit
 */
function _checkFlowCreditLimit() {
  const cfg = _getDynamicSelector('flow_credit_limit_alert');
  if (!cfg) {
    console.debug('[FlowLimit] flow_credit_limit_alert config missing — skip check');
    return false; // Defensive: KHÔNG block submit nếu config missing (avoid false positive)
  }
  const selectors = cfg.selectors?.length ? cfg.selectors : [];
  if (!selectors.length) return false;

  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) {
        console.warn(`[FlowLimit] ⚠ Credit limit alert detected via selector "${sel}"`);
        return true;
      }
    } catch (_) { /* invalid selector */ }
  }
  return false;
}

/**
 * Flow Agent Mode (2026-05-30) — Find toggle button "Tác nhân"/"Agent" via dynamic config.
 * Server config key: `flow_agent_toggle_button` với selectors + button_text + aria_pressed_on.
 * Caller verify button[aria-pressed] có text content match button_text exact.
 *
 * @returns {HTMLElement|null} Button element hoặc null (Flow chưa có tính năng hoặc config missing)
 */
function _findFlowAgentButton() {
  const cfg = _getDynamicSelector('flow_agent_toggle_button');
  if (!cfg) {
    console.log('[FlowAgent] ⚠ config flow_agent_toggle_button MISSING — backend cần chạy migration 2026_07_25_100003');
    return null;
  }
  const selectors = cfg.selectors?.length ? cfg.selectors : [];
  const textsMatch = cfg.button_text?.length ? cfg.button_text : [];
  if (!selectors.length || !textsMatch.length) return null;

  for (const sel of selectors) {
    try {
      const candidates = document.querySelectorAll(sel);
      for (const btn of candidates) {
        // 2026-06-02: Strip icon textContent prefix (defensive — Flow có thể rollout UI mới với
        // <i>icon</i> trong button toggle agent). Cùng pattern như chat close + instruction done.
        const icon = _findIconInElement(btn);
        const text = _stripIconFromButtonText(btn, icon);
        if (!text) continue;
        // Strict equal — tránh false positive (vd "Tác nhân X" KHÔNG match "Tác nhân")
        if (textsMatch.some(t => text === t)) {
          return btn;
        }
      }
    } catch (_) { /* invalid selector */ }
  }
  return null;
}

/**
 * Flow Agent Mode (2026-05-30) — Check Agent mode đang ON hay OFF.
 * @returns {{found: boolean, on: boolean}} found=false nếu button không tồn tại (Flow chưa update)
 */
function _isFlowAgentModeOn() {
  const btn = _findFlowAgentButton();
  if (!btn) return { found: false, on: false };
  const cfg = _getDynamicSelector('flow_agent_toggle_button');
  const onValue = cfg?.aria_pressed_on || 'true';
  const isOn = (btn.getAttribute('aria-pressed') || '').trim() === onValue;
  return { found: true, on: isOn };
}

/**
 * Flow Agent Mode (2026-05-30) — Auto turn OFF Agent mode nếu đang ON.
 * Tích hợp vào bootstrap (ensureFlowSettingsApplied) + pre-submit guard.
 *
 * Verify click thành công bằng cách re-read aria-pressed sau click.
 *
 * @returns {Promise<{found, wasOn, success}>}
 */
async function _ensureFlowAgentModeOff() {
  const btn = _findFlowAgentButton();
  if (!btn) {
    console.log('[FlowAgent] Button not found (Flow chưa có tính năng hoặc config missing) — skip');
    return { found: false, wasOn: false, success: true };
  }
  const cfg = _getDynamicSelector('flow_agent_toggle_button');
  const onValue = cfg?.aria_pressed_on || 'true';
  const wasOn = (btn.getAttribute('aria-pressed') || '').trim() === onValue;

  if (!wasOn) {
    console.log('[FlowAgent] ✓ Already OFF');
    return { found: true, wasOn: false, success: true };
  }

  console.log('[FlowAgent] 🔄 Agent mode ON → clicking toggle OFF...');
  try { simulateClick(btn); } catch (e) {
    console.warn('[FlowAgent] Click failed:', e.message);
    return { found: true, wasOn: true, success: false };
  }
  await sleep(400);

  // Verify: re-query button (React có thể re-render → element reference stale)
  const verifyBtn = _findFlowAgentButton();
  const stillOn = verifyBtn
    ? (verifyBtn.getAttribute('aria-pressed') || '').trim() === onValue
    : false; // button mất khỏi DOM cũng coi như OFF (mode hidden)
  if (stillOn) {
    console.warn('[FlowAgent] ⚠ Click KHÔNG turn off — button vẫn aria-pressed=' + onValue);
    return { found: true, wasOn: true, success: false };
  }
  console.log('[FlowAgent] ✓ Agent mode turned OFF successfully');
  return { found: true, wasOn: true, success: true };
}

/**
 * Wait for Flow gen composer editor sẵn sàng (2026-06-02).
 * Sau khi đóng chat agent panel/dialog, Flow unmount chat UI + remount gen composer.
 * Poll `getEditor()` (đã có placeholder hoặc container marker) đến khi non-null hoặc timeout.
 *
 * @param {number} maxWaitMs - Timeout total (default 5000ms)
 * @param {number} pollIntervalMs - Poll mỗi N ms (default 200ms)
 * @returns {Promise<number|null>} - ms đã chờ nếu ready, null nếu timeout
 */
async function _waitForFlowEditorReady(maxWaitMs = 5000, pollIntervalMs = 200) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const editor = (typeof getEditor === 'function') ? getEditor() : null;
      if (editor) {
        return Date.now() - startTime;
      }
    } catch (_) { /* getEditor có thể throw khi DOM chuyển trạng thái — retry */ }
    await sleep(pollIntervalMs);
  }
  return null;
}

/**
 * Flow Agent Instruction Done Button (2026-06-02) — Tìm button "Xong" của dialog
 * "Hướng dẫn cho tác nhân" (Agent Instructions) khi đang mở.
 *
 * Khác với close panel button: dialog này là sub-view bên trong chat agent panel (instruction
 * editor). Khi user click vào instruction settings → mở dialog với các "Thêm hướng dẫn" cards +
 * button "Xong"/"Done" ở dưới. Nếu dialog mở khi gen → editor composer bị che → submit fail.
 *
 * Server config key: `flow_agent_instruction_done_button` với:
 *   - button_text: ['Xong', 'Done', ...] — text trực tiếp trên button (KHÔNG qua span a11y)
 *   - panel_label_text: ['Hướng dẫn cho tác nhân', ...] — span title của dialog (anchor)
 *   - anchor_walk_depth: 6 (default) — số ancestor levels walk up từ label span
 *
 * Strategy: tìm panel_label span trước (signature stable) → walk up ancestors → query button match
 * button_text. Tránh false positive với "Done" buttons khác trên page (modal save, settings save).
 *
 * @returns {HTMLElement|null}
 */
function _findFlowAgentInstructionDoneButton() {
  const cfg = _getDynamicSelector('flow_agent_instruction_done_button');
  if (!cfg) {
    console.log('[FlowAgentInstruction] ⚠ config flow_agent_instruction_done_button MISSING — backend cần chạy migration 2026_07_25_100022');
    return null;
  }
  const buttonTexts = cfg.button_text?.length ? cfg.button_text : [];
  const panelLabelTexts = cfg.panel_label_text?.length ? cfg.panel_label_text : [];
  const walkDepth = typeof cfg.anchor_walk_depth === 'number' ? cfg.anchor_walk_depth : 6;
  if (!buttonTexts.length || !panelLabelTexts.length) return null;

  // Tìm panel label span (anchor signature — stable text identifier)
  let panelLabelEl = null;
  try {
    const allSpans = document.querySelectorAll('span');
    for (const sp of allSpans) {
      const text = (sp.textContent || '').trim();
      if (panelLabelTexts.some(t => text === t)) {
        panelLabelEl = sp;
        break;
      }
    }
  } catch (_) { /* defensive */ }
  if (!panelLabelEl) return null;

  // Walk up ancestors, query button match button_text trong container
  let container = panelLabelEl;
  for (let depth = 0; depth < walkDepth && container; depth++) {
    try {
      const buttons = container.querySelectorAll('button');
      for (const btn of buttons) {
        // Strip icon text prefix (defensive — Flow có thể thêm <i>icon</i> trong tương lai)
        const icon = _findIconInElement(btn);
        const text = _stripIconFromButtonText(btn, icon);
        if (buttonTexts.some(t => text === t)) {
          return btn;
        }
      }
    } catch (_) { /* invalid query — try next level */ }
    container = container.parentElement;
  }
  return null;
}

/**
 * Flow Agent Instruction (2026-06-02) — Check dialog "Hướng dẫn cho tác nhân" đang mở hay không.
 * @returns {{found: boolean, open: boolean}}
 */
function _isFlowAgentInstructionDialogOpen() {
  const btn = _findFlowAgentInstructionDoneButton();
  return { found: !!btn, open: !!btn };
}

/**
 * Flow Agent Instruction (2026-06-02) — Click "Xong" button nếu dialog đang mở.
 * @returns {Promise<{found, wasOpen, success}>}
 */
async function _ensureFlowAgentInstructionDone() {
  const btn = _findFlowAgentInstructionDoneButton();
  if (!btn) {
    return { found: false, wasOpen: false, success: true };
  }
  console.log('[FlowAgentInstruction] 🔄 Instruction dialog detected → clicking "Xong"...');
  // Attempt 1: simulateClick (full PointerEvent + MouseEvent sequence)
  try { simulateClick(btn); } catch (e) {
    console.warn('[FlowAgentInstruction] simulateClick failed:', e.message);
  }
  await sleep(400);
  let verifyBtn = _findFlowAgentInstructionDoneButton();
  if (!verifyBtn) {
    console.log('[FlowAgentInstruction] ✓ Instruction dialog closed (simulateClick)');
    return { found: true, wasOpen: true, success: true };
  }
  // Attempt 2: native HTMLElement.click() — fallback
  console.log('[FlowAgentInstruction] simulateClick chưa work → fallback native click()');
  try { verifyBtn.click(); } catch (e) {
    console.warn('[FlowAgentInstruction] native click failed:', e.message);
  }
  await sleep(400);
  verifyBtn = _findFlowAgentInstructionDoneButton();
  if (!verifyBtn) {
    console.log('[FlowAgentInstruction] ✓ Instruction dialog closed (native click)');
    return { found: true, wasOpen: true, success: true };
  }
  console.warn('[FlowAgentInstruction] ⚠ Cả simulateClick + native click KHÔNG đóng dialog');
  return { found: true, wasOpen: true, success: false };
}

/**
 * Flow Chat Agent Panel (2026-06-02) — Tìm close button của panel chat agent đang mở.
 * Khác `flow_agent_toggle_button`: toggle bật/tắt MODE, còn close button đóng PANEL khi đã mở.
 * Mode OFF không tự đóng panel → cần check riêng.
 *
 * Server config key: `flow_chat_agent_close_button` với:
 *   - selectors: button query
 *   - icon_text: 'close' (Material Symbol identifier)
 *   - button_text: ['Đóng', 'Close', '閉じる', 'ปิด'] — a11y span text
 *   - sibling_icon_text: 'edit_square' (button "Phiên mới" sibling)
 *   - sibling_button_text: ['Phiên mới', 'New session', ...] — verify đúng chat panel header
 *
 * Sibling verify: tránh false positive với close button khác (modal, toast, settings).
 *
 * @returns {HTMLElement|null}
 */
function _findFlowChatAgentCloseButton() {
  const cfg = _getDynamicSelector('flow_chat_agent_close_button');
  if (!cfg) {
    console.log('[FlowChatAgent] ⚠ config flow_chat_agent_close_button MISSING — backend cần chạy migration 2026_07_25_100021');
    return null;
  }
  const selectors = cfg.selectors?.length ? cfg.selectors : [];
  const closeIconText = cfg.icon_text || 'close';
  const closeTexts = cfg.button_text?.length ? cfg.button_text : [];
  const siblingIconText = cfg.sibling_icon_text || 'edit_square';
  const siblingTexts = cfg.sibling_button_text?.length ? cfg.sibling_button_text : [];
  if (!selectors.length || !closeTexts.length || !siblingTexts.length) return null;

  const verbose = !!(_seosonaVerboseFlowDebug);
  let stats = { totalBtns: 0, iconCloseMatched: 0, textMatched: 0, siblingFailed: 0, configCfg: cfg };
  for (const sel of selectors) {
    try {
      const candidates = document.querySelectorAll(sel);
      stats.totalBtns += candidates.length;
      for (const btn of candidates) {
        // CHỈ tính nút HIỂN THỊ. Fix "báo cáo bug DOM oan" (2026-07-11): sau khi click, Flow có thể
        // THU GỌN panel (nút close ẩn: display:none/offsetParent null) mà vẫn giữ trong DOM →
        // verifyClosed (=!finder) vẫn "thấy" nút ẩn → tưởng chưa đóng → warn. Cũng chặn false-positive
        // detection khi nút ẩn sẵn. (position:fixed có offsetParent=null nên check thêm bounding rect.)
        const _vr = btn.getBoundingClientRect();
        if ((btn.offsetParent === null && getComputedStyle(btn).position !== 'fixed') || _vr.width < 2 || _vr.height < 2) continue;
        const icon = _findIconInElement(btn);
        if (!icon || (icon.textContent || '').trim() !== closeIconText) continue;
        stats.iconCloseMatched++;
        const text = _stripIconFromButtonText(btn, icon);
        if (!closeTexts.some(t => text === t)) {
          if (verbose) console.log(`[FlowChatAgent:debug] icon=close but text mismatch: ${JSON.stringify(text)} ∉ ${JSON.stringify(closeTexts)}`);
          continue;
        }
        stats.textMatched++;
        const parent = btn.parentElement;
        if (!parent) continue;
        const siblings = parent.querySelectorAll('button');
        let hasSessionSibling = false;
        for (const sib of siblings) {
          if (sib === btn) continue;
          const sibIcon = _findIconInElement(sib);
          if (!sibIcon || (sibIcon.textContent || '').trim() !== siblingIconText) continue;
          const sibText = _stripIconFromButtonText(sib, sibIcon);
          if (siblingTexts.some(t => sibText === t)) {
            hasSessionSibling = true;
            break;
          }
        }
        if (!hasSessionSibling) {
          stats.siblingFailed++;
          if (verbose) console.log(`[FlowChatAgent:debug] Found close+text match but NO sibling Phiên mới. Parent has ${siblings.length} button(s).`, btn);
          continue;
        }
        return btn;
      }
    } catch (_) { /* invalid selector — try next */ }
  }
  if (verbose) {
    console.log(`[FlowChatAgent:debug] No match — stats:`, stats);
  }
  return null;
}

/**
 * Helper: strip icon textContent prefix khỏi button textContent.
 * Vì <i class="google-symbols">close</i> contribute "close" vào button.textContent → cần loại bỏ
 * để so sánh với label text thực.
 * @param {Element} btn
 * @param {Element|null} icon
 * @returns {string}
 */
function _stripIconFromButtonText(btn, icon) {
  const full = (btn.textContent || '').trim();
  if (!icon) return full;
  const iconText = (icon.textContent || '').trim();
  if (!iconText) return full;
  // Strip nếu prefix khớp icon text
  if (full.startsWith(iconText)) return full.slice(iconText.length).trim();
  if (full.endsWith(iconText)) return full.slice(0, -iconText.length).trim();
  // Edge case: nếu icon text xuất hiện ở giữa, vẫn loại bỏ
  return full.replace(iconText, '').trim();
}

/**
 * Flow Chat Agent Panel (2026-06-02) — Check panel chat agent đang mở hay không.
 * @returns {{found: boolean, open: boolean}}
 */
function _isFlowChatAgentPanelOpen() {
  const btn = _findFlowChatAgentCloseButton();
  return { found: !!btn, open: !!btn };
}

/**
 * Flow Chat Agent Panel (2026-06-02) — Click close button nếu panel đang mở.
 * Tích hợp vào bootstrap + applySettings pre-submit + ensureFlowSettingsApplied.
 * @returns {Promise<{found, wasOpen, success}>}
 */
async function _ensureFlowChatAgentClosed() {
  const btn = _findFlowChatAgentCloseButton();
  if (!btn) {
    return { found: false, wasOpen: false, success: true };
  }
  console.log('[FlowChatAgent] 🔄 Chat panel detected → clicking close...');
  console.log('[FlowChatAgent] Button matched (full outerHTML):', btn.outerHTML);
  console.log('[FlowChatAgent] Button parent class:', btn.parentElement?.className, '| grandparent:', btn.parentElement?.parentElement?.className);
  // Check button disabled/aria state
  console.log('[FlowChatAgent] Button state: disabled=', btn.disabled, '| aria-disabled=', btn.getAttribute('aria-disabled'), '| pointer-events=', getComputedStyle(btn).pointerEvents);

  // Pattern 4-tier click cho Radix UI buttons (Google Flow dùng Radix-style components):
  //   1. Focus + native btn.click()
  //   2. simulateClick(btn) — full PointerEvent + MouseEvent sequence
  //   3. Click trên child icon (Radix đôi khi bind handler trên icon, không phải button root)
  //   4. Dispatch click với view: window
  const verifyClosed = () => !_findFlowChatAgentCloseButton();

  // Attempt 1: focus + native click (Radix UI thường cần focus trước click)
  try {
    btn.focus();
    btn.click();
  } catch (e) { console.warn('[FlowChatAgent] focus+click failed:', e.message); }
  await sleep(400);
  if (verifyClosed()) {
    console.log('[FlowChatAgent] ✓ Chat panel closed (focus+click)');
    return { found: true, wasOpen: true, success: true };
  }

  // Attempt 2: simulateClick — re-query (button có thể đã stale)
  let curBtn = _findFlowChatAgentCloseButton();
  if (!curBtn) return { found: true, wasOpen: true, success: true };
  console.log('[FlowChatAgent] focus+click chưa work → try simulateClick');
  try { simulateClick(curBtn); } catch (e) { console.warn('[FlowChatAgent] simulateClick failed:', e.message); }
  await sleep(400);
  if (verifyClosed()) {
    console.log('[FlowChatAgent] ✓ Chat panel closed (simulateClick)');
    return { found: true, wasOpen: true, success: true };
  }

  // Attempt 3: click trên child icon (Radix có thể bind handler trên icon)
  curBtn = _findFlowChatAgentCloseButton();
  if (!curBtn) return { found: true, wasOpen: true, success: true };
  const iconEl = _findIconInElement(curBtn);
  if (iconEl) {
    console.log('[FlowChatAgent] simulateClick chưa work → try click on child icon');
    try {
      iconEl.click();
      simulateClick(iconEl);
    } catch (e) { console.warn('[FlowChatAgent] icon click failed:', e.message); }
    await sleep(400);
    if (verifyClosed()) {
      console.log('[FlowChatAgent] ✓ Chat panel closed (icon click)');
      return { found: true, wasOpen: true, success: true };
    }
  }

  // Attempt 4: dispatch click với view: window + composed:true
  curBtn = _findFlowChatAgentCloseButton();
  if (!curBtn) return { found: true, wasOpen: true, success: true };
  console.log('[FlowChatAgent] icon click chưa work → try MouseEvent with view+composed');
  try {
    const rect = curBtn.getBoundingClientRect();
    const evtInit = {
      bubbles: true, cancelable: true, composed: true, view: window,
      button: 0, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2,
    };
    curBtn.dispatchEvent(new MouseEvent('mousedown', evtInit));
    curBtn.dispatchEvent(new MouseEvent('mouseup', evtInit));
    curBtn.dispatchEvent(new MouseEvent('click', evtInit));
  } catch (e) { console.warn('[FlowChatAgent] MouseEvent dispatch failed:', e.message); }
  await sleep(400);
  if (verifyClosed()) {
    console.log('[FlowChatAgent] ✓ Chat panel closed (MouseEvent+view)');
    return { found: true, wasOpen: true, success: true };
  }

  // Attempt 5: Escape key — Radix UI Dialog/Popover thường có Escape close handler
  curBtn = _findFlowChatAgentCloseButton();
  if (!curBtn) return { found: true, wasOpen: true, success: true };
  console.log('[FlowChatAgent] MouseEvent chưa work → try Escape key');
  try {
    // Dispatch lên cả btn, document, và body để cover các Radix handler bindings
    const escEvt = () => new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true });
    curBtn.dispatchEvent(escEvt());
    document.dispatchEvent(escEvt());
    document.body.dispatchEvent(escEvt());
  } catch (e) { console.warn('[FlowChatAgent] Escape dispatch failed:', e.message); }
  await sleep(400);
  if (verifyClosed()) {
    console.log('[FlowChatAgent] ✓ Chat panel closed (Escape key)');
    return { found: true, wasOpen: true, success: true };
  }

  // Attempt 6: click trên parent element (handler có thể bind trên wrapper)
  curBtn = _findFlowChatAgentCloseButton();
  if (!curBtn) return { found: true, wasOpen: true, success: true };
  const parent = curBtn.parentElement;
  if (parent) {
    console.log('[FlowChatAgent] Escape chưa work → try click on parent wrapper');
    try {
      parent.click();
      simulateClick(parent);
    } catch (e) { console.warn('[FlowChatAgent] parent click failed:', e.message); }
    await sleep(400);
    if (verifyClosed()) {
      console.log('[FlowChatAgent] ✓ Chat panel closed (parent click)');
      return { found: true, wasOpen: true, success: true };
    }
  }

  console.warn('[FlowChatAgent] ⚠ Tất cả 6 click strategies KHÔNG đóng panel — báo cáo bug DOM');
  return { found: true, wasOpen: true, success: false };
}

async function ensureFlowSettingsApplied() {
  // 2026-06-02 Order: Xong → Close Chat → Agent OFF.
  // Khi chat panel mở, button Agent toggle (button[aria-pressed]) KHÔNG hiển thị trên DOM
  // (panel header replace composer area). Cần đóng panel TRƯỚC để toggle button xuất hiện,
  // sau đó mới click Agent OFF. Wait 1.5s giữa Close và Agent click để DOM stable.

  // Step 1: Click "Xong" — đóng dialog hướng dẫn
  try {
    const instructionResult = await _ensureFlowAgentInstructionDone();
    if (instructionResult.wasOpen && instructionResult.success) {
      console.log('[SEOSONA Flow] ✓ Agent instruction dialog closed (was open, now closed)');
    } else if (instructionResult.wasOpen && !instructionResult.success) {
      console.warn('[SEOSONA Flow] ⚠ Agent instruction Done click FAILED — dialog vẫn mở');
    } else if (instructionResult.found) {
      console.log('[SEOSONA Flow] ✓ Agent instruction dialog already closed');
    }
  } catch (e) {
    console.warn('[SEOSONA Flow] _ensureFlowAgentInstructionDone failed (non-blocking):', e.message);
  }

  // Step 2: Close Chat Panel — đóng panel để Agent toggle xuất hiện trên DOM
  let _panelActioned = false;
  try {
    const panelResult = await _ensureFlowChatAgentClosed();
    if (panelResult.wasOpen && panelResult.success) {
      console.log('[SEOSONA Flow] ✓ Chat agent panel auto-closed');
      _panelActioned = true;
    } else if (panelResult.wasOpen && !panelResult.success) {
      console.warn('[SEOSONA Flow] ⚠ Chat agent panel close FAILED — panel vẫn mở');
    } else if (panelResult.found) {
      console.log('[SEOSONA Flow] ✓ Chat agent panel already closed');
    }
  } catch (e) {
    console.warn('[SEOSONA Flow] _ensureFlowChatAgentClosed failed (non-blocking):', e.message);
  }

  // Wait 1.5s cho Flow stable: panel collapse animation + Agent toggle button render
  if (_panelActioned) {
    await sleep(1500);
  }

  // Step 3: Turn OFF Agent mode — chỉ click sau khi panel đóng (toggle button đã render)
  try {
    const agentResult = await _ensureFlowAgentModeOff();
    if (agentResult.wasOn && agentResult.success) {
      console.log('[SEOSONA Flow] ✓ Agent mode auto-disabled (was ON, now OFF)');
    } else if (agentResult.wasOn && !agentResult.success) {
      console.warn('[SEOSONA Flow] ⚠ Agent mode click toggle FAILED — vẫn ON');
    } else if (agentResult.found) {
      console.log('[SEOSONA Flow] ✓ Agent mode already OFF');
    } else {
      console.log('[SEOSONA Flow] Agent button not found (Flow chưa rollout tính năng hoặc page chưa ready)');
    }
  } catch (e) {
    console.warn('[SEOSONA Flow] _ensureFlowAgentModeOff failed (non-blocking):', e.message);
  }

  // Mark timestamp cho pre-submit cooldown
  window._seosonaAgentChainLastRunAt = Date.now();

  // Idempotent guard cho settings menu (grid view + show details) — chỉ apply 1 lần per session.
  if (_flowSettingsApplied) {
    console.log('[SEOSONA Flow] ensureFlowSettingsApplied: settings menu SKIPPED (already applied in this session)');
    return;
  }

  // Tìm Flow header settings button (icon settings_2)
  // Server-Only: icon class qua _findIconsInElement(document).
  let flowSettingsBtn = null;
  const allIcons = _findIconsInElement(document);
  for (const icon of allIcons) {
    if (icon.textContent.trim() === 'settings_2') {
      flowSettingsBtn = icon.closest('button');
      break;
    }
  }

  if (!flowSettingsBtn) {
    // Settings button chưa render (Flow page chưa ready) — KHÔNG set flag, retry lần sau
    console.log('[SEOSONA Flow] ensureFlowSettingsApplied: settings_2 icon chưa có — Flow page chưa ready, retry next call');
    return;
  }

  // Port 1.1.49: verify có thể fail VĨNH VIỄN (aria_labels thiếu locale / Flow đổi DOM) → mỗi
  // tab-activate lại mở menu settings → spam mở/đóng. Cooldown 20s giữa các lần mở menu: vẫn
  // eventually retry (phòng React chưa settle) nhưng không bật menu liên tục.
  const _fsNow = Date.now();
  if (window._flowSettingsLastAttempt && (_fsNow - window._flowSettingsLastAttempt) < 20000) {
    return;
  }
  window._flowSettingsLastAttempt = _fsNow;

  console.log('[SEOSONA Flow] ensureFlowSettingsApplied: applying Grid view + show tile details (1-time)...');

  // Mở settings menu
  simulateClick(flowSettingsBtn);
  await sleep(500);

  // Bật Grid view (nếu chưa active) — Strict Server-Only: aria_labels từ grid_view_tab config
  const tabTriggers = _qa('flow_tab_slider_trigger');
  const gridLabels = _getFlowLocaleStrings('grid_view_tab', 'aria_labels');
  let gridClicked = false;
  for (const trigger of tabTriggers) {
    const label = trigger.getAttribute('aria-label') || trigger.textContent.trim();
    if (_ariaLabelMatches(label, gridLabels) && trigger.getAttribute('data-state') !== 'active') {
      simulateClick(trigger);
      await sleep(300);
      gridClicked = true;
      break;
    }
  }

  // Bật "Hiện thông tin chi tiết về ô" (Strict Server-Only):
  // - settingRows text match: show_tile_details_setting.text_match (4 locale)
  // - toggle state check:    toggle_state_button.aria_labels_on (4 locale)
  let detailsClicked = false;
  const showDetailsLabels = _getFlowLocaleStrings('show_tile_details_setting', 'text_match');
  const toggleOnLabels = _getFlowLocaleStrings('toggle_state_button', 'aria_labels_on');
  const settingRows = _qa('show_tile_details_setting');
  for (const row of settingRows) {
    if (_textIncludesAny(row.textContent, showDetailsLabels)) {
      const toggleBtns = _qa('flow_tab_slider_trigger', row);
      for (const btn of toggleBtns) {
        const label = btn.getAttribute('aria-label') || btn.textContent.trim();
        if (_ariaLabelMatches(label, toggleOnLabels) && btn.getAttribute('data-state') !== 'active') {
          simulateClick(btn);
          await sleep(300);
          detailsClicked = true;
          break;
        }
      }
      break;
    }
  }

  // Port 1.1.49: ép grid size = SMALL (nhiều tile/viewport → scan/capture/download ổn định hơn,
  // ít phải zoom/scroll). Selector 'grid_size_small_button' chưa seed → _qa=[] → no-op an toàn.
  let gridSizeClicked = false;
  for (const btn of _qa('grid_size_small_button')) {
    if (btn.getAttribute('data-state') !== 'active') {
      simulateClick(btn);
      await sleep(300);
      gridSizeClicked = true;
      break;
    }
  }

  // Bug fix 2026-06-03: Verify state THỰC SỰ active TRƯỚC khi đóng menu + set flag.
  // Lý do: gridClicked/detailsClicked chỉ track "có click hay không" — không reflect state đích.
  // Selector miss / aria-label mismatch / React state chưa settle → click không xảy ra
  // (gridClicked=false) nhưng flag vẫn set ở code cũ → call sau skip vĩnh viễn dù page vẫn ở
  // "Theo nhóm" mode (log evidence 2026-06-03). Fix: re-query DOM sau click, verify data-state='active'.
  // Verify PHẢI làm trước Escape menu — sau đóng menu, tab triggers DOM unmount.
  const verifyGridActive = () => {
    // _qa returns NodeList (or [] on config miss) — NodeList có for-of nhưng KHÔNG có .some()
    const triggers = _qa('flow_tab_slider_trigger');
    for (const t of triggers) {
      const label = t.getAttribute('aria-label') || t.textContent.trim();
      if (_ariaLabelMatches(label, gridLabels) && t.getAttribute('data-state') === 'active') {
        return true;
      }
    }
    return false;
  };
  const verifyDetailsOn = () => {
    const rows = _qa('show_tile_details_setting');
    for (const row of rows) {
      if (_textIncludesAny(row.textContent, showDetailsLabels)) {
        const toggleBtns = _qa('flow_tab_slider_trigger', row);
        for (const btn of toggleBtns) {
          const label = btn.getAttribute('aria-label') || btn.textContent.trim();
          if (_ariaLabelMatches(label, toggleOnLabels) && btn.getAttribute('data-state') === 'active') {
            return true;
          }
        }
        return false;
      }
    }
    return false;
  };
  // Port 1.1.49: N/A (không có nút SMALL / chưa seed selector) → true để không block flag.
  const verifyGridSizeSmall = () => {
    const smalls = _qa('grid_size_small_button');
    if (!smalls.length) return true;
    for (const t of smalls) {
      if (t.getAttribute('data-state') === 'active') return true;
    }
    return false;
  };
  const gridActive = verifyGridActive();
  const detailsOn = verifyDetailsOn();
  const gridSizeSmall = verifyGridSizeSmall();

  // Đóng settings menu
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  simulateClick(document.body);
  await sleep(300);

  // SET FLAG CHỈ KHI verify pass — tránh skip vĩnh viễn nếu click không thành công.
  // verify=false → call tiếp theo (vd tab activate, sidebar reconnect) sẽ retry mở menu + apply.
  if (gridActive && detailsOn && gridSizeSmall) {
    _flowSettingsApplied = true;
    sessionStorage.setItem(_FLOW_SETTINGS_KEY, 'true');
    console.log(`[SEOSONA Flow] ensureFlowSettingsApplied: DONE ✓ (gridClicked=${gridClicked}, detailsClicked=${detailsClicked}, gridSizeClicked=${gridSizeClicked}, verify gridActive=${gridActive}, detailsOn=${detailsOn}, gridSizeSmall=${gridSizeSmall})`);
  } else {
    console.warn(`[SEOSONA Flow] ensureFlowSettingsApplied: INCOMPLETE — gridActive=${gridActive}, detailsOn=${detailsOn} (gridClicked=${gridClicked}, detailsClicked=${detailsClicked}). Flag NOT set, sẽ retry lần call sau. Có thể do server config 'grid_view_tab.aria_labels' / 'toggle_state_button.aria_labels_on' thiếu locale hiện tại, hoặc Flow React state chưa settle sau 300ms.`);
  }
}

/**
 * Chuẩn bị Flow page để scan/check tile bằng cách FORCE LOAD tiles qua zoom.
 * Intent: chỉ chạy khi cần TÌM 1 file Flow ở ref_img mà chưa load (vd `correctStaleFileIds`
 * Tầng 3 fallback). Zoom out + scroll trigger lazy-load → tile xuất hiện trong DOM.
 * KHÔNG động vào Flow settings menu (Grid view, show details) — đó là `ensureFlowSettingsApplied()`
 * (1-time concern, tách riêng).
 * Skip zoom nếu DOM đã có ≥50 tiles — assume đủ tiles để check.
 */
// Browser zoom thật qua background (chrome.tabs.setZoom). KHÁC document.body.style.zoom (CSS):
// CSS zoom không làm Flow virtual-scroll render thêm tile; browser zoom (giống Cmd/Ctrl + "-") thì có.
async function _getBrowserZoom() {
  try {
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'getBrowserZoom' }, (r) => {
        resolve((chrome.runtime.lastError || typeof r?.zoom !== 'number') ? null : r.zoom);
      });
    });
  } catch (_) { return null; }
}
async function _setBrowserZoom(factor) {
  try {
    return await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'setBrowserZoom', factor }, (r) => {
        resolve(chrome.runtime.lastError ? false : !!r?.ok);
      });
    });
  } catch (_) { return false; }
}

// Zoom SESSION (2026-06-15): khi submit multi-prompt, zoom nhỏ MỘT LẦN + giữ NGUYÊN suốt cả batch
// (không zoom in/out mỗi prompt → không flicker, tile ref ở xa KHÔNG bị unmount giữa các bước →
// add ref được). Restore zoom khi xong HẾT prompt (endFlowZoomSession).
// `armed` = đang trong batch nhưng chưa zoom; chỉ zoom thật khi có ref xa cần load (lazy → tránh
// zoom vô ích cho gen không ref).
// UX (2026-06-15): khi zoom nhỏ Flow page → (1) banner xanh báo lý do, (2) GIỮ kích thước
// FloatingTracker + banner để vẫn quan sát/đọc được.
// chrome.tabs.setZoom CÓ thu nhỏ element position:fixed → cần counter-scale. Dùng CSS `zoom`
// (= 1/factor) thay vì transform: CSS zoom CÙNG cơ chế với browser zoom nên nhân bù chính xác
// (0.3 × 3.33 ≈ 1.0) + scale đúng cả px children của tracker; transform không compose ổn định
// (gây phình 3.33×).
var _ZOOM_NOTICE_SVG = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';

// Banner xanh dùng chung — text theo i18n key, CSS zoom counter-scale theo factor (đọc được ở zoom nhỏ).
function _showZoomNotice(textKey, factor) {
  try {
    const inv = (factor && factor > 0) ? (1 / factor) : 1;
    let notice = document.getElementById('seosonaflow-zoom-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'seosonaflow-zoom-notice';
      notice.style.cssText = 'position:fixed;top:26px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#19d07b;color:#fff;padding:10px 16px;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,0.35);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px;max-width:80vw;pointer-events:none;';
      document.body.appendChild(notice);
    }
    notice.innerHTML = _ZOOM_NOTICE_SVG + '<span>' + _getTrackerT(textKey) + '</span>';
    // Counter-scale giữ banner đọc được khi page zoom nhỏ — cả CSS lẫn browser zoom (setZoom thu nhỏ
    // position:fixed). Caller session gọi sau khi page đã paint nhỏ → không transient.
    notice.style.zoom = String(inv);
    notice.style.display = 'flex';
  } catch (_) { globalThis.SEOSONA_swallow?.('content#_showZoomNotice', _); }
}
function _hideZoomNotice() {
  try { const n = document.getElementById('seosonaflow-zoom-notice'); if (n) n.remove(); } catch (_) { globalThis.SEOSONA_swallow?.('content#_hideZoomNotice', _); }
}

// Session UX: counter-scale tracker (CSS zoom) + banner "ảnh ở xa".
function _applyZoomUx(factor) {
  try {
    // Counter-scale tracker: CẢ CSS zoom (body con) LẪN browser zoom (setZoom thu nhỏ position:fixed)
    // đều kéo tracker nhỏ theo → bù 1/factor giữ kích thước đọc được (0.3 × 3.33 ≈ 1.0). Gọi từ
    // _ensureZoomSessionActive SAU khi page đã paint nhỏ (double rAF) → không transient "to double".
    const inv = (factor && factor > 0) ? (1 / factor) : 1;
    const tr = document.getElementById('seosonaflow-flow-tracker');
    if (tr) { tr.style.transform = ''; tr.style.transformOrigin = ''; tr.style.zoom = String(inv); }
    _showZoomNotice('zoomedForFarRef', factor);
  } catch (_) { globalThis.SEOSONA_swallow?.('content#_applyZoomUx', _); }
}
function _clearZoomUx() {
  try {
    const tr = document.getElementById('seosonaflow-flow-tracker');
    if (tr) { tr.style.zoom = ''; tr.style.transform = ''; tr.style.transformOrigin = ''; }
    _hideZoomNotice();
  } catch (_) { globalThis.SEOSONA_swallow?.('content#_clearZoomUx', _); }
}

async function _ensureZoomSessionActive() {
  const s = window._seosonaFlowZoomSession;
  if (!s || !s.armed || s.active) return;
  const o = await _getBrowserZoom();
  if (o != null) {
    await _setBrowserZoom(s.factor); s.mode = 'browser'; s.original = o;
    // Đợi browser zoom PAINT xong (double rAF) TRƯỚC khi bật active + counter-scale. setZoom async
    // (resolve ≠ đã repaint) → nếu counter-scale 1/factor áp khi page CHƯA nhỏ → tracker/banner phình
    // 1/factor× 1 nhịp ("to double"). active chỉ true sau paint → tracker.update cũng không bù sớm.
    // Timeout 150ms fallback: rAF bị PAUSE khi tab hidden → tránh stall gen (resolve sớm nhất thắng).
    await new Promise((r) => {
      let done = false; const fin = () => { if (!done) { done = true; r(); } };
      requestAnimationFrame(() => requestAnimationFrame(fin));
      setTimeout(fin, 150);
    });
  } else {
    s.originalCss = document.body.style.zoom || '1'; document.body.style.zoom = String(s.factor); s.mode = 'css';
  }
  s.active = true;
  _applyZoomUx(s.factor); // banner xanh + counter-scale giữ kích thước tracker/banner (sau khi paint nhỏ)
  console.log(`[SEOSONA Flow] zoom session: zoom xuống ${s.factor} (mode=${s.mode}) — giữ suốt batch`);
}
// Manual submit (Phase 5): tạm khôi phục zoom về gốc trong lúc chờ user submit → editor Flow + banner
// (position:fixed) về kích thước bình thường để user click Submit/nhấn Enter được. GIỮ session armed +
// set active=false → prompt/ref kế tự re-zoom qua _ensureZoomSessionActive (KHÔNG end session, WF vẫn hold).
// Ref đã attach vào composer nên restore chỉ unmount tile gallery ở xa, KHÔNG mất ref đã chọn.
async function _suspendZoomForManual() {
  const s = window._seosonaFlowZoomSession;
  if (!s || !s.active) return false; // chưa zoom → không cần
  try {
    if (s.mode === 'browser') {
      const target = (typeof s.original === 'number' && s.original > 0 && s.original !== s.factor) ? s.original : 1;
      await _setBrowserZoom(target);
    } else {
      document.body.style.zoom = (s.originalCss && s.originalCss !== String(s.factor)) ? s.originalCss : '1';
    }
    s.active = false; // cho phép re-zoom cho prompt/ref kế (armed vẫn true)
    _clearZoomUx();    // gỡ counter-scale tracker + banner "ảnh ở xa"
    console.log('[SEOSONA Flow] zoom session: SUSPEND cho manual submit (page về normal, armed giữ nguyên)');
    return true;
  } catch (_) { return false; }
}

async function _endZoomSession() {
  const s = window._seosonaFlowZoomSession;
  if (!s) return;
  window._seosonaFlowZoomSession = null; // clear TRƯỚC (idempotent, tránh double-restore khi gọi đồng thời)
  _clearZoomUx(); // gỡ banner + trả kích thước tracker về bình thường
  if (s.active) {
    if (s.mode === 'browser') {
      // Restore về original; nếu original bất thường (null / ≤0 / == factor đang dùng) → ép 100%
      // để KHÔNG bao giờ để Flow kẹt ở mức zoom nhỏ (kể cả khi error/force-stop/capture sai).
      const target = (typeof s.original === 'number' && s.original > 0 && s.original !== s.factor) ? s.original : 1;
      await _setBrowserZoom(target);
      console.log(`[SEOSONA Flow] zoom session: restore browser zoom → ${target}`);
    } else {
      document.body.style.zoom = (s.originalCss && s.originalCss !== String(s.factor)) ? s.originalCss : '1';
      console.log(`[SEOSONA Flow] zoom session: restore CSS zoom → ${document.body.style.zoom}`);
    }
  }
}

async function ensureFlowTilesLoaded(force = false, targetFileNames = []) {
  // Bug 46 fix: Wait for selector config to be ready before querying tiles
  // Check _selectorConfigReady flag (set by _runSelectorWaitLoop at content script init)
  if (!_selectorConfigReady) {
    console.log('[SEOSONA Flow] ensureFlowTilesLoaded: config not ready, waiting...');
    // Wait up to 3s for config to load
    for (let i = 0; i < 15; i++) {
      await sleep(200);
      if (_selectorConfigReady) break;
    }
    if (!_selectorConfigReady) {
      console.warn('[SEOSONA Flow] ensureFlowTilesLoaded: timeout waiting for config');
      return;
    }
  }
  // Clear stale cache to force refresh after config ready
  _tileSelectorCache = null;
  let selector = _getTileSelectorString();

  // DEBUG: Log selector info
  const rawTiles = document.querySelectorAll('[data-tile-id]');
  console.log(`[SEOSONA Flow] ensureFlowTilesLoaded DEBUG: force=${force}, selector="${selector}", rawTiles=[data-tile-id]=${rawTiles.length}, URL=${location.href.substring(0, 80)}`);

  const tilesBeforeCount = selector ? document.querySelectorAll(selector).length : 0;

  // Fix 2026-06-15 (multi-prompt missing-ref): targetFileNames = danh sách file_name CẦN tìm.
  // Khi có target → zoom sâu dần + scroll, CAPTURE tile_id NGAY khi tile vừa render
  // (capture-on-sight). Flow virtual-scroll gỡ tile ngoài viewport → KHÔNG được "load xong rồi
  // quét lại" vì lúc quét lại tile đã bị unmount. Vì vậy: ghi {file_name → tile_id} ngay tại chỗ
  // (sống sót dù tile unmount sau), return map cho caller dùng trực tiếp → chống reupload duplicate.
  const targets = Array.isArray(targetFileNames) ? targetFileNames.filter(Boolean) : [];
  const hasTargets = targets.length > 0;
  const foundTiles = {}; // file_name → tile_id (capture-on-sight, cumulative)
  let lastFoundEl = null; // tile cuối tìm thấy → scrollIntoView giữ render cho bước add ref

  // Quét DOM hiện tại; ghi lại tile_id cho target vừa thấy. Trả về tổng số target đã capture.
  const _scan = () => {
    if (!hasTargets) return 0;
    const want = new Set(targets.filter(t => !(t in foundTiles)));
    if (want.size === 0) return targets.length;
    const tiles = document.querySelectorAll(_getTileSelectorString());
    for (const tile of tiles) {
      const fn = extractFileName(tile);
      if (fn && want.has(fn)) {
        foundTiles[fn] = tile.dataset.tileId;
        lastFoundEl = tile;
        want.delete(fn);
        if (want.size === 0) break;
      }
    }
    return Object.keys(foundTiles).length;
  };

  // Đã đủ ngay từ đầu → khỏi zoom/scroll
  if (hasTargets && _scan() === targets.length) {
    console.log(`[SEOSONA Flow] ensureFlowTilesLoaded: tất cả ${targets.length} target đã có trên DOM, skip`);
    return foundTiles;
  }

  // skip-zoom heuristic ≥50 CHỈ áp dụng khi KHÔNG force VÀ KHÔNG có target cụ thể.
  // Có target → luôn cố load vì heuristic ≥50 false-negative cho ref nằm xa.
  if (!force && !hasTargets && tilesBeforeCount >= 50) {
    console.log(`[SEOSONA Flow] ensureFlowTilesLoaded: skipping zoom (${tilesBeforeCount} tiles already loaded)`);
    return foundTiles;
  }

  // Browser zoom THẬT (chrome.tabs.setZoom qua background) — KHÁC document.body.style.zoom (CSS).
  // CSS zoom KHÔNG kích hoạt Flow virtual-scroll render thêm tile ở cuối page; browser zoom (giống
  // Cmd/Ctrl + "-") thì có. Fallback CSS zoom nếu browser-zoom không khả dụng (vd context lạ).
  // Trong zoom session (multi-prompt batch): zoom 1 lần + giữ, KHÔNG restore per-call (tránh
  // flicker + tile ref unmount giữa các bước). Ngoài session: zoom + restore per-call như cũ.
  const _inSession = !!(window._seosonaFlowZoomSession && window._seosonaFlowZoomSession.armed);
  const _bzOrig = _inSession ? null : await _getBrowserZoom();
  const _useBz = !_inSession && _bzOrig != null;
  const originalCssZoom = document.body.style.zoom || '1';
  const _applyZoom = async (f) => {
    if (_inSession) { await _ensureZoomSessionActive(); return; }
    if (_useBz) await _setBrowserZoom(f); else document.body.style.zoom = String(f);
    // Per-call (pre-pipeline: correctStaleFileIds + reupload) → báo "đang quét ảnh tham chiếu"
    // + counter-scale banner theo factor hiện tại để đọc được khi zoom nhỏ.
    if (hasTargets) _showZoomNotice('scanningRefImages', f);
  };
  const _restoreZoom = async () => {
    if (_inSession) return; // session tự restore khi endFlowZoomSession
    if (_useBz) await _setBrowserZoom(_bzOrig); else document.body.style.zoom = originalCssZoom;
    if (hasTargets) _hideZoomNotice(); // ẩn banner "đang quét" sau khi restore zoom
  };
  const _scCfg = _getDynamicSelector('flow_scroll_container');
  const _scClosestAttr = _scCfg?.closest_attribute || '[style*="overflow"]';
  const _getScroll = () => _q('flow_scroll_container')?.closest(_scClosestAttr) || document.documentElement;

  try {
    if (hasTargets) {
      // Multi-pass adaptive: zoom sâu dần [0.5 → 0.33 → 0.25], mỗi mức scroll TĂNG DẦN +
      // capture NGAY trong lúc scroll. Early-exit khi đã capture đủ.
      const zoomSteps = [0.5, 0.33, 0.25];
      let done = false;
      let prevTotal = -1; // tổng tile DOM cuối pass trước → dừng sớm khi không render thêm
      for (let s = 0; s < zoomSteps.length && !done; s++) {
        await _applyZoom(zoomSteps[s]);
        await sleep(s === 0 ? 1200 : 800); // chờ reflow ổn định
        const sc = _getScroll();
        const step = Math.max(Math.floor((window.innerHeight || 800) * 0.8), 500);
        const MAX_STEPS = 80; // chặn vòng lặp với library cực lớn
        let stepCount = 0;
        for (let pos = 0; pos <= sc.scrollHeight + step && stepCount < MAX_STEPS; pos += step, stepCount++) {
          sc.scrollTop = pos;
          await sleep(300);
          if (_scan() === targets.length) { done = true; break; }
        }
        if (done) {
          // QUAN TRỌNG: đã capture đủ → KHÔNG cuộn về 0 (giữ tile cuối còn render cho bước add ref).
          const _zlbl = _inSession ? (window._seosonaFlowZoomSession?.factor ?? 'session') : zoomSteps[s];
          console.log(`[SEOSONA Flow] ensureFlowTilesLoaded: capture đủ ${targets.length} target ở zoom=${_zlbl}`);
          break;
        }
        // Chưa đủ → cuộn về 0 cho pass zoom kế tiếp bắt đầu sạch, rồi quét lần nữa.
        sc.scrollTop = 0;
        await sleep(250);
        if (_scan() === targets.length) { done = true; break; }
        // Dừng sớm: zoom sâu hơn không render thêm tile nào (đã quét hết library) → target
        // thực sự không tồn tại trên Flow → recheck báo missing → reupload (đúng fallback).
        const curTotal = document.querySelectorAll(_getTileSelectorString()).length;
        if (s > 0 && curTotal <= prevTotal) {
          console.warn(`[SEOSONA Flow] ensureFlowTilesLoaded: zoom=${zoomSteps[s]} không render thêm tile (${curTotal}) → dừng sớm`);
          break;
        }
        prevTotal = curTotal;
      }
      if (!done) console.warn(`[SEOSONA Flow] ensureFlowTilesLoaded: chỉ capture ${Object.keys(foundTiles).length}/${targets.length} target sau multi-pass`);
    } else {
      // Không có target (caller preparatory: addFileToPrompt no-name, Tầng 3, prepareFlowForScan)
      // → giữ hành vi cũ: zoom 0.5 + scroll 1 lượt (tránh regress timing các luồng này).
      await _applyZoom(0.5);
      await sleep(1500);
      const sc = _getScroll();
      sc.scrollTop = sc.scrollHeight;
      await sleep(800);
      sc.scrollTop = 0;
      await sleep(500);
    }
  } finally {
    await _restoreZoom();
    await sleep(300);
    // Giữ tile vừa tìm thấy trong viewport để bước add ref (addFileToPrompt) click được —
    // sau restore zoom, virtual-scroll có thể đẩy tile ra ngoài → scrollIntoView kéo lại.
    if (hasTargets && lastFoundEl && lastFoundEl.isConnected) {
      try { lastFoundEl.scrollIntoView({ block: 'center' }); } catch (_) { globalThis.SEOSONA_swallow?.('content#_getScroll', _); }
    }
  }

  const tilesAfterLoad = document.querySelectorAll(_getTileSelectorString()).length;
  console.log(`[SEOSONA Flow] ensureFlowTilesLoaded: ${tilesBeforeCount} → ${tilesAfterLoad} tiles (after zoom${hasTargets ? `, captured=${Object.keys(foundTiles).length}/${targets.length}` : ''})`);
  return foundTiles;
}

// sidePanel mode: content script no longer injects sidebar.
// SidebarManager.init() is called from sidebar.html context.
// Content script only provides DOM interaction functions + message listener.

// === Scan tiles mới (không nằm trong exclude) — dùng chung scanNewTiles handler + manual detect ===
// READ-ONLY: KHÔNG claim (không ghi state) → an toàn cho detect-enter (TileMonitor claim sau).
function _scanNewTilesInline(excludeTileIds, excludeFileNames) {
  const excludeIdSet = new Set(excludeTileIds || []);
  const excludeFnSet = new Set((excludeFileNames || []).filter(Boolean));

  const allTiles = document.querySelectorAll(_getTileSelectorString());
  const newTiles = [];
  const seenTileIds = new Set(); // Dedup tiles (DOM có thể có duplicates)

  for (const tile of allTiles) {
    const tileId = tile.dataset.tileId;
    if (!tileId) continue;
    if (seenTileIds.has(tileId)) continue;
    seenTileIds.add(tileId);
    if (excludeIdSet.has(tileId)) continue;
    const fileName = extractFileName(tile);
    if (fileName && excludeFnSet.has(fileName)) continue;
    newTiles.push({
      tile_id: tileId,
      file_name: fileName || null,
      media_type: detectMediaType(tile)  // 'image' | 'video' | 'unknown'
    });
  }
  return { success: true, tiles: newTiles };
}

// === Manual Enter mode (Flow) — banner + detect user submit ===
// Flag: user bấm "Bỏ qua" trên banner → waitUserSubmit thoát với reason SKIP.
var _manualUserSkip = false;
// Flag: EditorExecutor.stop() (stopJob/stopAll) → cancelWaitUserSubmit → thoát wait loop.
var _manualWaitAbort = false;

// Banner xanh cố định bottom-center trên trang Flow — nhắc user nhấn Enter.
// state: 'ready' (xanh, chờ Enter) | 'paused' (xám) | 'submitted' (đã nhận).
// Hover CSS cho nút skip/pause/resume/stop (FloatingTracker + banner manual). Inline style set background
// nên hover rule cần !important để override. Inject 1 lần.
function _injectTrackerHoverStyles() {
  if (document.getElementById('seosonaflow-tracker-hover-styles')) return;
  var st = document.createElement('style');
  st.id = 'seosonaflow-tracker-hover-styles';
  st.textContent =
    '#seosonaflow-flow-tracker button[data-action="pause"]:hover{background:rgba(255,255,255,0.18)!important;color:#fff!important;}' +
    '#seosonaflow-flow-tracker button[data-action="resume"]:hover{background:rgba(25, 208, 123,0.34)!important;}' +
    '#seosonaflow-flow-tracker button[data-action="stop"]:hover{background:rgba(239,68,68,0.30)!important;color:#fff!important;}' +
    '#seosonaflow-flow-tracker button[data-action="skip"]:hover{background:rgba(255,255,255,0.24)!important;}' +
    '#seosonaflow-manual-enter-banner .sf-meb-skip:hover{background:rgba(255,255,255,0.32)!important;}' +
    '#seosonaflow-flow-tracker button[data-action="pause"],#seosonaflow-flow-tracker button[data-action="resume"],' +
    '#seosonaflow-flow-tracker button[data-action="stop"],#seosonaflow-flow-tracker button[data-action="skip"],' +
    '#seosonaflow-manual-enter-banner .sf-meb-skip{transition:background 0.12s ease,color 0.12s ease;}';
  (document.head || document.documentElement).appendChild(st);
}

function _showManualEnterBanner(promptIndex, total, refCount, state) {
  _injectTrackerHoverStyles();
  let el = document.getElementById('seosonaflow-manual-enter-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'seosonaflow-manual-enter-banner';
    el.style.cssText = 'position:fixed;left:50%;bottom:8px;transform:translateX(-50%);z-index:2147483647;' +
      'display:flex;align-items:center;gap:8px;padding:6px 8px 6px 12px;border-radius:10px;' +
      'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:12px;color:#fff;' +
      'box-shadow:0 8px 28px rgba(0,0,0,0.42);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);' +
      'border:1px solid rgba(255,255,255,0.18);max-width:420px;white-space:nowrap;';
    el.innerHTML =
      '<span class="sf-meb-icon" style="flex-shrink:0;display:flex"></span>' +
      '<span class="sf-meb-text" style="line-height:1.3;overflow:hidden;text-overflow:ellipsis"></span>' +
      '<button class="sf-meb-skip" style="flex-shrink:0;background:rgba(255,255,255,0.16);border:none;border-radius:7px;color:#fff;font-size:11px;font-weight:600;padding:4px 9px;cursor:pointer;">Skip</button>';
    document.body.appendChild(el);
    // Skip: pointerdown (sớm, chắc chắn) + click; stopPropagation tránh bị handler khác nuốt.
    var _skipEl = el.querySelector('.sf-meb-skip');
    var _doSkip = function(ev) { if (ev) { ev.stopPropagation(); ev.preventDefault(); } _manualUserSkip = true; };
    _skipEl.addEventListener('pointerdown', _doSkip, true);
    _skipEl.addEventListener('click', _doSkip, true);
  }
  const iconEl = el.querySelector('.sf-meb-icon');
  const textEl = el.querySelector('.sf-meb-text');
  const skipBtn = el.querySelector('.sf-meb-skip');
  const posInfo = (total > 1) ? (' ' + promptIndex + '/' + total) : '';
  const refInfo = (refCount > 0) ? (' (' + refCount + ' ref)') : '';
  if (state === 'submitted') {
    el.style.background = 'linear-gradient(180deg, rgba(25, 208, 123,0.32), rgba(20,120,60,0.4))';
    iconEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4be3a0" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    textEl.textContent = _getTrackerT('manualSubmitted');
    skipBtn.style.display = 'none';
  } else if (state === 'paused') {
    el.style.background = 'linear-gradient(180deg, rgba(120,120,130,0.3), rgba(50,50,60,0.42))';
    iconEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#e5e7eb"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
    textEl.textContent = _getTrackerT('manualPaused');
    skipBtn.style.display = 'none';
  } else if (state === 'click') {
    // Editor CHƯA focus (browser cross-surface) → hướng dẫn user click ô prompt (cursor icon).
    el.style.background = 'linear-gradient(180deg, rgba(234,179,8,0.32), rgba(160,120,10,0.44))';
    iconEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fde047" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/><path d="M13 13l6 6"/></svg>';
    textEl.textContent = _getTrackerT('manualClickFirst', { pos: posInfo, ref: refInfo });
    skipBtn.style.display = '';
    skipBtn.textContent = _getTrackerT('manualSkip');
  } else {
    el.style.background = 'linear-gradient(180deg, rgba(25, 208, 123,0.34), rgba(16,110,55,0.46))';
    // Icon Enter/return (corner-down-left) — chuẩn Lucide, render ổn định.
    iconEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4be3a0" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 0 1-4 4H4"/></svg>';
    textEl.textContent = _getTrackerT('manualReady', { pos: posInfo, ref: refInfo });
    skipBtn.style.display = '';
    skipBtn.textContent = _getTrackerT('manualSkip');
  }
  el.style.display = 'flex';
}
function _hideManualEnterBanner() {
  const el = document.getElementById('seosonaflow-manual-enter-banner');
  if (el) el.style.display = 'none';
}

// === Message listener for sidePanel <-> content script communication ===
// Inject Slate bridge vào main world ngay khi content script load
// Bridge cần có sẵn trước khi bất kỳ insert/clear nào chạy
try { injectSlateBridge(); } catch(e) { console.log('[SEOSONA Flow] Bridge inject deferred:', e.message); }

/**
 * Chặn download video Flow → xoá watermark → tải bản sạch.
 *
 * background.js HOÃN download rồi gọi vào đây. Ta phải TRẢ LỜI NGAY khi đã cầm chắc bytes —
 * đó là tín hiệu để bên kia huỷ bản còn watermark. Trả lời trước khi cầm được bytes là mất
 * file của người dùng; trả lời muộn quá 8 giây thì bên kia tự cho bản gốc đi qua.
 *
 * Xử lý nặng (encode lại từng khung) chạy SAU khi đã trả lời — không giữ kênh message.
 */
async function _wmAutoProcess(message, sendResponse) {
  const fail = (why) => { try { sendResponse({ ok: false, error: why }); } catch (_e) { /* kênh đã đóng */ } };
  if (typeof window.SEOSONA_removeVideoWatermark !== 'function') return fail('ENGINE_MISSING');
  let srcBlob;
  try {
    const r = await fetch(message.url);        // blob: của chính trang này → đọc được
    if (!r.ok) return fail('FETCH_' + r.status);
    srcBlob = await r.blob();
    if (!srcBlob.size) return fail('EMPTY_BLOB');
  } catch (e) { return fail('FETCH_LỖI: ' + (e?.message || e)); }

  sendResponse({ ok: true, bytes: srcBlob.size });   // ← từ đây bản gốc bị huỷ, ta phải giao được file

  const base = String(message.filename || 'video').replace(/\.[^.]+$/, '');
  const deliver = async (blob, ext, note) => {
    // Tải bằng <a download> vì blob do TRANG tạo — service worker không phân giải được nó.
    // wmDone: true để bản này không bị chặn lại lần nữa (chống lặp vô tận).
    await new Promise((res) => {
      try {
        chrome.runtime.sendMessage({
          action: 'prepareDownloadRename', folder: message.folder || '',
          filename: `${base}.${ext}`, identifier: `${base}.${ext}`, wmDone: true,
        }, () => { void chrome.runtime.lastError; res(); });
      } catch (_e) { res(); }
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${base}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => { try { URL.revokeObjectURL(a.href); } catch (_e) { /* đã thu hồi */ } }, 15000);
    console.log(`[SEOSONA Flow] auto-WM: đã giao ${base}.${ext} (${note})`);
  };

  try {
    const cleaned = await window.SEOSONA_removeVideoWatermark(srcBlob, { corner: 'br' });
    await deliver(cleaned, cleaned.seosonaExt || 'webm', 'đã xoá watermark');
  } catch (e) {
    // Xoá watermark hỏng → VẪN phải giao file, vì bản gốc đã bị huỷ rồi.
    console.warn('[SEOSONA Flow] auto-WM thất bại → giao bản gốc còn watermark:', e);
    await deliver(srcBlob, 'mp4', 'CÒN watermark — ' + (e?.message || e));
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'wm:autoProcess') {
    _wmAutoProcess(message, sendResponse);
    return true;   // giữ kênh mở tới lúc cầm được bytes
  }
  // Ping handler — background.js dùng để check content.js đã load chưa trước khi auto-inject
  if (message.action === 'ping') {
    sendResponse({ pong: true, loadedAt: self.__seosonaflowContentJsLoaded__ });
    return false; // Sync response, không giữ channel open
  }

  const handlers = {
    'runAutoPrompt': async () => {
      try {
        const result = await runAutoPrompt(message.payload);
        // runAutoPrompt tự reset isRunning và hide ExecutionBlocker khi hoàn thành
        return result;
      } catch (err) {
        console.error('[runAutoPrompt] Unhandled error:', err);
        // Cleanup nếu có exception không được handle bên trong runAutoPrompt
        ExecutionBlocker.hide();
        isRunning = false;
        isPaused = false;
        return { success: false, error: err.message };
      }
    },
    'applySettings': async () => {
      console.log(`[content.js] applySettings message received:`, JSON.stringify({ genType: message.genType, ratio: message.ratio, model: message.model, isFrames: message.isFrames, quantity: message.quantity, flowVideoDuration: message.flowVideoDuration }));
      await applySettings(message.genType, message.ratio, message.model, message.isFrames, message.quantity, message.flowVideoDuration);
      return { success: true };
    },

    // 2026-06-02: prepareFlowForGen — đóng chat panel + Agent OFF + wait editor ready.
    // Gọi từ EditorExecutor TRƯỚC removeExistingRefImages/addRefImages để đảm bảo composer area
    // (editor + ref slots) đã render xong. Nếu add_ref trong khi panel/Agent UI vẫn mở → ref images
    // không add đúng chỗ.
    'prepareFlowForGen': async () => {
      console.log('[content.js] prepareFlowForGen: ensuring Flow editor ready (close panel + Agent OFF)...');
      let actioned = false;
      let exitedMediaViewer = false;

      // Step 0: nếu đang XEM 1 ảnh/video (URL /project/{id}/edit/{fileId}) → editor composer
      // KHÔNG sẵn sàng gen → quay lại editor project trước. Áp dụng cho MỌI gen (gen/tasks/workflow/mcp).
      try {
        if (_isFlowMediaViewerOpen()) {
          console.log('[prepareFlowForGen] Step 0: đang ở media viewer → quay lại editor project');
          exitedMediaViewer = await _exitFlowMediaViewer();
          actioned = true; // trigger _waitForFlowEditorReady cuối hàm (editor remount sau khi thoát viewer)
        }
      } catch (e) { console.warn('[prepareFlowForGen] Step 0 (media viewer) failed:', e.message); }

      // Step 1: Click Xong (dialog instruction)
      try {
        const r = await _ensureFlowAgentInstructionDone();
        if (r.wasOpen && r.success) {
          console.log('[prepareFlowForGen] ✓ Instruction dialog closed');
          actioned = true;
        }
      } catch (e) { console.warn('[prepareFlowForGen] Step 1 failed:', e.message); }

      // Step 2: Close chat panel
      try {
        const r = await _ensureFlowChatAgentClosed();
        if (r.wasOpen && r.success) {
          console.log('[prepareFlowForGen] ✓ Chat panel closed');
          actioned = true;
          await sleep(1500); // wait Flow stable: panel collapse + Agent toggle render
        }
      } catch (e) { console.warn('[prepareFlowForGen] Step 2 failed:', e.message); }

      // Step 3: Agent OFF
      try {
        const r = await _ensureFlowAgentModeOff();
        if (r.wasOn && r.success) {
          console.log('[prepareFlowForGen] ✓ Agent OFF');
          actioned = true;
        }
      } catch (e) { console.warn('[prepareFlowForGen] Step 3 failed:', e.message); }

      // Wait editor ready nếu actioned (Flow re-mount composer)
      let editorReadyMs = 0;
      if (actioned) {
        editorReadyMs = await _waitForFlowEditorReady(5000) || 0;
        if (editorReadyMs) {
          console.log(`[prepareFlowForGen] ✓ Editor ready (${editorReadyMs}ms wait)`);
        } else {
          console.warn('[prepareFlowForGen] ⚠ Editor not ready after 5s — gen may fail');
        }
      }

      // Mark timestamp cho cooldown
      window._seosonaAgentChainLastRunAt = Date.now();
      return { success: true, actioned, editorReadyMs, exitedMediaViewer };
    },
    'getEditor': () => {
      const editor = getEditor();
      // Check Slate state ngoài DOM existence - verify React/Slate thực sự ready
      let hasSlateState = false;
      let debugInfo = {};

      if (editor) {
        try {
          const _slateSel = _getSlateEditorSelectorString();
          const isDisabled = editor.closest('[data-disabled="true"]') ||
                            (_slateSel && editor.querySelector(_slateSel + '[contenteditable="false"]'));

          const submitBtn = getSubmitButton();
          const btnExists = !!submitBtn;

          const slateEditor = (_slateSel && editor.querySelector(_slateSel)) || editor;
          const isEditable = slateEditor?.getAttribute('contenteditable') === 'true' ||
                            editor.hasAttribute('data-slate-editor');

          // Slate ready khi: editor tồn tại + không disabled + có submit button + editable
          // Bỏ check loading spinner và btnEnabled để tránh false negative
          hasSlateState = !isDisabled && btnExists && isEditable;

          debugInfo = { isDisabled: !!isDisabled, btnExists, isEditable };
        } catch (e) {
          hasSlateState = false;
          debugInfo = { error: e.message };
        }
      }

      return { exists: !!editor, hasSlateState };
    },
    'dismissBlockingModal': () => {
      // Fix: Sau reload, Flow có thể hiện modal xác nhận quyền sử dụng → chặn upload
      // Tìm và dismiss modal nếu có
      let hadModal = false;

      const dialogs = _qa('flow_modal_dialog');
      for (const dialog of dialogs) {
        // Strategy 1: Modal xác nhận quyền - click nút Accept/Confirm/OK/Đồng ý
        const acceptBtn = dialog.querySelector(
          'button:not([aria-label*="close" i]):not([aria-label*="cancel" i])'
        );
        // Tìm nút có text Accept, Confirm, OK, Đồng ý, Continue, Got it, etc.
        const buttons = dialog.querySelectorAll('button');
        for (const btn of buttons) {
          const text = btn.textContent?.toLowerCase() || '';
          if (text.includes('accept') || text.includes('confirm') || text.includes('ok') ||
              text.includes('đồng ý') || text.includes('xác nhận') || text.includes('continue') ||
              text.includes('got it') || text.includes('agree') || text.includes('tiếp tục')) {
            console.log('[dismissBlockingModal] Clicking accept button:', btn.textContent);
            btn.click();
            hadModal = true;
            break;
          }
        }
        if (hadModal) continue;

        // Strategy 2: Nút đóng (X button, Cancel, Close)
        const closeBtn = dialog.querySelector(
          'button[aria-label*="close" i], button[aria-label*="đóng" i], ' +
          '[data-dismiss], [data-close]'
        );
        if (closeBtn) {
          console.log('[dismissBlockingModal] Clicking close button');
          closeBtn.click();
          hadModal = true;
          continue;
        }

        // Strategy 3: Click backdrop/overlay để dismiss
        const backdrop = dialog.parentElement?.querySelector('[data-state="open"][data-overlay]');
        if (backdrop) {
          backdrop.click();
          hadModal = true;
        }
      }

      // Strategy 4: Click Escape key để dismiss modal
      if (!hadModal) {
        const openModal = document.querySelector('[data-state="open"][role="dialog"]');
        if (openModal) {
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          hadModal = true;
        }
      }

      return { hadModal };
    },
    'checkBlockingModal': () => {
      // Check xem có modal đang mở không (không dismiss)
      const hasModal = !!(
        document.querySelector('[role="dialog"][data-state="open"]') ||
        document.querySelector('[role="alertdialog"][data-state="open"]') ||
        document.querySelector('[role="dialog"]:not([data-state="closed"])')
      );
      return { hasModal };
    },
    'insertText': async () => {
      // Abort check — user bấm forceStop trước insert
      if (shouldStop) {
        console.log('[insertText] ⏹ Aborted before start (shouldStop=true)');
        return { success: false, error: 'ABORTED', message: 'User stopped before insert' };
      }
      const editor = getEditor();
      if (editor) await insertText(editor, message.text);
      return { success: true };
    },
    'clearEditor': async () => {
      // Abort check — user bấm forceStop trước clear
      if (shouldStop) {
        console.log('[clearEditor] ⏹ Aborted before start (shouldStop=true)');
        return { success: false, error: 'ABORTED', message: 'User stopped before clear' };
      }
      const editor = getEditor();
      if (editor) await clearEditor(editor);
      return { success: true };
    },
    'clickSubmit': async () => {
      // Abort check — user bấm forceStop trước/trong khi clickSubmit
      if (shouldStop) {
        console.log('[clickSubmit] ⏹ Aborted before start (shouldStop=true)');
        return { success: false, error: 'ABORTED', message: 'User stopped before submit' };
      }
      let btn = getSubmitButton();
      const editor = getEditor();
      console.log('[clickSubmit] 🚀 Start. Button:', !!btn, 'disabled:', btn?.disabled, 'Editor:', !!editor);

      // Visibility: nếu DOM selector miss (Button=false) → Slate Bridge sẽ cứu thoát qua React internal.
      // Đây là design fallback intentional (chống Flow rename CSS class) — KHÔNG phải bug.
      // Log warn để admin biết submit_button selector config có thể stale, cần verify.
      if (!btn) {
        console.warn('[clickSubmit] ⚠️ submit_button DOM selector MISS — sẽ fallback Slate Bridge (React internal). ' +
          'Admin kiểm tra provider_configs.dom_selector.submit_button cho flow nếu thấy log này nhiều.');
      }

      // Wait for button to be enabled (max 5s) - Flow UI enable button sau khi Slate model có text
      let waitMs = 0;
      while (btn?.disabled && waitMs < 5000) {
        if (shouldStop) {
          console.log('[clickSubmit] ⏹ Aborted while waiting button enable');
          return { success: false, error: 'ABORTED', message: 'User stopped while waiting button' };
        }
        await sleep(200);
        waitMs += 200;
        btn = getSubmitButton() || btn;
      }
      if (waitMs > 0) {
        console.log('[clickSubmit] Waited', waitMs, 'ms for button enable, disabled:', btn?.disabled);
      }

      // Approach 1: Slate Bridge (React internal submit handler) — main path
      // Trust bridge return — verify gen-done là trách nhiệm của caller (waitForNewTiles ở
      // workflow executor có MutationObserver + 3-layer filter, đáng tin hơn nhiều so với
      // detector tile-count/btn-disabled inline ở đây).
      // Detector inline trước đây bị FALSE NEGATIVE vì:
      //   - Flow dùng virtual list → tile count có thể GIẢM khi scroll dù gen đã start
      //   - Flow không reliably disable button khi gen, hoặc enable lại quá nhanh (<200ms)
      // → Fall through các approach 2-4 khi bridge đã work gây DOUBLE/TRIPLE submit.
      console.log('[clickSubmit] 🎯 Approach 1: Slate Bridge (React internal submit)');
      injectSlateBridge();
      try {
        const iconSelectorForClickBridge = (_getDynamicSelector('icon_element')?.selectors || []).join(', ');
        const result = await _slateBridgeCall('submit', { iconSelector: iconSelectorForClickBridge, submitIconText: _getDynamicSelector('submit_button')?.icon_text });
        console.log('[clickSubmit]    Bridge return:', result);
        if (result?.success) {
          console.log('[clickSubmit] 🏆 SUBMITTED via Slate Bridge — caller sẽ verify gen-done qua waitForNewTiles');
          return { success: true, approach: 'bridge' };
        }
        console.warn('[clickSubmit] ⚠️ Bridge return success=false:', result?.error, '→ fallback');
      } catch (e) {
        console.warn('[clickSubmit] ⚠️ Bridge throw:', e.message, '→ fallback');
      }

      // Fallback chỉ chạy khi bridge THẬT SỰ fail (success=false hoặc throw)
      // Mỗi approach fire-and-forget, return ngay sau cái đầu tiên gửi được event lên element còn enabled

      // Approach 2: simulateClick (PointerEvent chain — full mouse simulation)
      btn = getSubmitButton();
      if (btn && !btn.disabled) {
        console.log('[clickSubmit] 🎯 Approach 2: simulateClick (bridge failed → fallback)');
        simulateClick(btn);
        return { success: true, approach: 'simulateClick' };
      }
      console.log('[clickSubmit] ⏭️ Approach 2 skipped — button disabled');

      // Approach 3: Enter key on editor
      if (editor) {
        console.log('[clickSubmit] 🎯 Approach 3: Enter key (bridge + simulateClick failed → fallback)');
        editor.focus();
        await sleep(100);
        editor.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13,
          bubbles: true, cancelable: true,
        }));
        return { success: true, approach: 'enterKey' };
      }

      // Approach 4: Native .click() — last resort
      btn = getSubmitButton();
      if (btn && !btn.disabled) {
        console.log('[clickSubmit] 🎯 Approach 4: Native btn.click() (last resort)');
        btn.click();
        return { success: true, approach: 'nativeClick' };
      }

      console.warn('[clickSubmit] ❌ Tất cả approaches đều skip — không có button enabled / editor');
      return { success: false, error: 'No usable element to trigger submit' };
    },
    'addFileToPrompt': async () => {
      await addFileToPrompt(message.fileId, message.fileName, message.flowFileId);
      return { success: true };
    },
    'getCurrentTileIds': () => {
      // Invalidate cache vì API call yêu cầu data mới nhất
      _invalidateTileCache();
      // forceRefresh=true vì API call yêu cầu data mới nhất
      return { tileIds: getUniqueTileIds(true), fileNames: [...getExistingFileNames()] };
    },
    'waitForNewTiles': async () => {
      // Reset shouldStop khi gọi qua MessageBridge
      shouldStop = false;
      // preFileNames: capture tại content script side nếu caller không truyền
      const preFileNames = message.preFileNames
        ? new Set(message.preFileNames)
        : (message.captureFileNames ? getExistingFileNames() : null);
      console.log(`[content.js] waitForNewTiles received — preTileIds=${(message.preTileIds || []).length}, timeout=${message.timeout}, maxQty=${message.maxQuantity}`);
      const result = await waitForNewTiles(
        message.preTileIds || [],
        message.timeout || 120000,
        preFileNames,
        message.maxQuantity || 0
      );
      console.log(`[content.js] waitForNewTiles done — result has ${result?.tiles?.length || 0} new tiles, failed=${result?.failed}`);
      return result;
    },
    'stopExecution': () => {
      shouldStop = true;
      isPaused = false;
      _clickedRetryTileIds.clear(); // Reset retry tracking khi stop
      // Update FloatingTracker UI
      if (FloatingTracker._legacyData) {
        FloatingTracker._legacyData.status = 'stopped';
        FloatingTracker.updateLegacy(FloatingTracker._legacyData);
      }
      // Hide ExecutionBlocker immediately when stopped
      ExecutionBlocker.hide();
      return { success: true };
    },
    'resetStop': () => {
      // Reset shouldStop flag khi bắt đầu execution mới (EditorExecutor.start)
      // Fix bug: shouldStop từ lần stop trước không được clear, abort insertText lần sau
      shouldStop = false;
      return { success: true };
    },
    'pauseExecution': () => {
      isPaused = true;
      // Update FloatingTracker UI
      if (FloatingTracker._legacyData) {
        FloatingTracker._legacyData.status = 'paused';
        FloatingTracker.updateLegacy(FloatingTracker._legacyData);
      }
      return { isPaused: true };
    },
    'resumeExecution': () => {
      isPaused = false;
      // Update FloatingTracker UI
      if (FloatingTracker._legacyData) {
        FloatingTracker._legacyData.status = 'running';
        FloatingTracker.updateLegacy(FloatingTracker._legacyData);
      }
      return { isPaused: false };
    },
    'pq:clearRetryTracking': () => {
      // Clear retry tracking khi job MỚI bắt đầu (PromptQueue.submitJob)
      // Ngăn tiles từ job cũ bị skip retry trong job mới
      _clickedRetryTileIds.clear();
      _retryingTiles.clear();
      return { success: true };
    },
    'getRunningState': () => {
      return { isRunning, shouldStop, isPaused };
    },
    'getFailedPrompts': () => {
      return { failedPrompts };
    },
    'clearFailedPrompts': () => {
      failedPrompts = [];
      return { success: true };
    },
    'getThumbnailsByIds': () => {
      const fileIds = message.fileIds || [];
      const results = {};
      for (const fileId of fileIds) {
        const tile = _getTileById(fileId);
        if (!tile) continue;
        const img = tile.querySelector('img');
        const video = _q('tile_video', tile);
        const fileName = extractFileName(tile);
        const flowInfo = extractFlowFileInfo(tile);
        const isVideoByAlt = img?.alt?.toLowerCase().includes('video');
        // Ưu tiên <video> trước — video tiles có cả <img> (ref image) lẫn <video> (kết quả)
        if (video) {
          // Extract actual video URL for Telegram sending
          const videoUrl = extractVideoUrl(tile);
          results[fileId] = {
            thumbnail: video.poster || video.src || '',
            type: 'video',
            ...(fileName && { file_name: fileName }),
            ...(flowInfo && { file_id: flowInfo.file_id }),
            ...(videoUrl && { video_url: videoUrl })  // Include video_url for Telegram/download
          };
        } else if (isVideoByAlt && img?.src && !img.src.includes('chrome-extension')) {
          // Video tile detected via alt attribute — video element not rendered yet
          results[fileId] = {
            thumbnail: img.src,
            type: 'video',
            video_url: img.src, // Fallback to img src
            ...(fileName && { file_name: fileName }),
            ...(flowInfo && { file_id: flowInfo.file_id })
          };
        } else if (img?.src && !img.src.includes('chrome-extension')) {
          results[fileId] = { thumbnail: img.src, type: 'image', ...(fileName && { file_name: fileName }), ...(flowInfo && { file_id: flowInfo.file_id }) };
        }
      }
      return { results };
    },
    'correctStaleFileIds': async () => {
      // 5-tầng correction: file_id > file_name > thumbnail_url > ensureFlowTilesLoaded > reupload
      const idToUrlMap = message.idToUrlMap || {};
      const fileNameMap = message.fileNameMap || {};
      const fileIdMap = message.fileIdMap || {}; // U-1.4: tile_id → file_id map
      const oldIds = Object.keys(idToUrlMap);
      // Cũng check các IDs chỉ có file_name mà không có thumbnail URL
      const fileNameOnlyIds = Object.keys(fileNameMap).filter(id => !idToUrlMap[id]);
      const allIds = [...new Set([...oldIds, ...fileNameOnlyIds])];
      if (allIds.length === 0) return { corrections: {} };

      // Hàm scan DOM tìm tile bằng file_name (Tầng 1 - ưu tiên cao nhất)
      function scanByFileName(idsToCheck) {
        const corrections = {};
        const fnMap = {};
        for (const id of idsToCheck) {
          if (fileNameMap[id]) fnMap[id] = fileNameMap[id];
        }
        if (Object.keys(fnMap).length === 0) return corrections;
        // Build file_name → tileId map từ DOM
        const fnToTileId = new Map();
        const allTiles = document.querySelectorAll(_getTileSelectorString());
        allTiles.forEach(tile => {
          const tileId = tile.dataset.tileId;
          if (!tileId) return;
          const fn = extractFileName(tile);
          if (fn) fnToTileId.set(fn, tileId);
        });
        for (const oldId of idsToCheck) {
          const savedFn = fnMap[oldId];
          if (!savedFn) continue;
          const newId = fnToTileId.get(savedFn);
          if (newId && newId !== oldId) {
            corrections[oldId] = newId;
          }
        }
        return corrections;
      }

      // Normalize media URL cho thumbnail matching
      // CRITICAL: split('=')[0] quá aggressive cho getMediaUrlRedirect URLs
      // vì TẤT CẢ tiles đều có cùng base path, chỉ khác name param
      function normalizeMediaUrl(url) {
        if (!url || typeof url !== 'string') return '';
        const urlPat = _getMediaUrlPattern();
        if (urlPat && url.includes(urlPat)) {
          try {
            const urlObj = new URL(url, window.location.origin);
            // Giữ path + name param, bỏ các params khác (w, h, etc.)
            const name = urlObj.searchParams.get('name');
            // tRPC format: ?input={"json":{"name":"UUID"}}
            const input = urlObj.searchParams.get('input');
            if (name) return urlObj.pathname + '?name=' + name;
            if (input) {
              try {
                const parsed = JSON.parse(decodeURIComponent(input));
                const json = parsed?.json || parsed?.['0']?.json || parsed;
                if (json?.name) return urlObj.pathname + '?name=' + json.name;
              } catch (e) { /* ignore */ }
            }
          } catch (e) { /* ignore */ }
        }
        // CDN URLs (lh3.googleusercontent.com): split('=') bỏ size params
        return url.split('=')[0];
      }

      // Hàm scan DOM tìm tile bằng thumbnail URL (Tầng 2)
      // CRITICAL: Phải validate file_name để tránh cross-project collision
      function scanByThumbnailUrl(idsToCheck) {
        const corrections = {};
        const crossProjectIds = [];
        const urlToTileData = new Map(); // normalized_url → { tileId, file_name }
        const allTiles = document.querySelectorAll(_getTileSelectorString());
        allTiles.forEach(tile => {
          const tileId = tile.dataset.tileId;
          if (!tileId) return;
          const img = tile.querySelector('img');
          const video = _q('tile_video', tile);
          const src = img?.src || video?.poster || video?.src || '';
          if (src && !src.includes('chrome-extension') && !src.startsWith('data:')) {
            const normalized = normalizeMediaUrl(src);
            const tileFn = extractFileName(tile);
            urlToTileData.set(normalized, { tileId, file_name: tileFn });
          }
        });
        for (const oldId of idsToCheck) {
          const savedUrl = idToUrlMap[oldId];
          if (!savedUrl) continue;
          const normalizedSaved = normalizeMediaUrl(savedUrl);
          const tileData = urlToTileData.get(normalizedSaved);
          if (!tileData || tileData.tileId === oldId) continue;

          const newId = tileData.tileId;
          const savedFn = fileNameMap[oldId];
          const tileFn = tileData.file_name;

          // Cross-project safety: Nếu cả hai đều có file_name và KHÔNG match → skip + track
          if (savedFn && tileFn && savedFn !== tileFn) {
            console.warn(`[SEOSONA Flow] [Tầng 2] Cross-project collision detected: oldId=${oldId.substring(0,20)}... savedFn=${savedFn.substring(0,20)}... vs tileFn=${tileFn.substring(0,20)}...`);
            crossProjectIds.push(oldId);
            continue; // KHÔNG correct - đây là tile từ project khác
          }

          // Safety: Nếu có savedFn nhưng tile KHÔNG có file_name → chờ tile complete, KHÔNG correct mù
          if (savedFn && !tileFn) {
            console.warn(`[SEOSONA Flow] [Tầng 2] Skipping correction: savedFn=${savedFn.substring(0,20)}... but tile has no file_name yet`);
            continue;
          }

          corrections[oldId] = newId;
        }
        return { corrections, crossProjectIds };
      }

      // Hàm validate tile_id với file_name (cross-project safety)
      // Chỉ coi tile_id là valid nếu file_name MATCH hoặc không có saved file_name
      function validateTileIdWithFileName(tileId, savedFileName) {
        if (!savedFileName) return true; // Không có file_name để validate → accept
        const tile = _getTileById(tileId);
        if (!tile) return false;
        const currentFileName = extractFileName(tile);
        if (!currentFileName) return true; // Tile chưa có file_name (đang processing) → accept tạm
        return currentFileName === savedFileName;
      }

      // Tìm IDs cần correction
      // QUAN TRỌNG: Không tin tile_id direct match nếu file_name không khớp (cross-project)
      // Bug 46 fix: Wait for selector config to be ready
      if (!_selectorConfigReady) {
        console.log('[SEOSONA Flow] correctStaleFileIds: config not ready, waiting...');
        for (let i = 0; i < 15; i++) {
          await sleep(200);
          if (_selectorConfigReady) break;
        }
      }
      // Clear stale cache to force refresh
      _tileSelectorCache = null;
      let _selector = _getTileSelectorString();
      // DEBUG: Log selector và raw tile count
      const _rawTiles = document.querySelectorAll('[data-tile-id]');
      console.log(`[SEOSONA Flow] correctStaleFileIds DEBUG: selector="${_selector}", rawTiles=${_rawTiles.length}, URL=${location.href.substring(0, 60)}`);
      const totalTiles = _selector ? document.querySelectorAll(_selector).length : 0;
      const validIds = []; // tile_id tồn tại VÀ file_name match
      const needsCorrectionIds = []; // tile_id không tồn tại HOẶC file_name không match

      for (const id of allIds) {
        const tile = _getTileById(id);
        if (tile) {
          const savedFn = fileNameMap[id];
          if (validateTileIdWithFileName(id, savedFn)) {
            validIds.push(id);
          } else {
            // tile_id tồn tại nhưng file_name KHÔNG match → cross-project collision!
            console.log(`[SEOSONA Flow] Cross-project detected: tile_id ${id.substring(0, 20)}... exists but file_name mismatch`);
            needsCorrectionIds.push(id);
          }
        } else {
          needsCorrectionIds.push(id);
        }
      }

      console.log(`[SEOSONA Flow] correctStaleFileIds: ${allIds.length} IDs check | ${validIds.length} valid | ${needsCorrectionIds.length} need correction | ${totalTiles} tiles trên DOM`);
      if (needsCorrectionIds.length === 0) return { corrections: {} };

      let corrections = {};

      // [Tầng 0] file_id lookup (persistent, chính xác nhất)
      for (const oldId of needsCorrectionIds) {
        const savedFileId = fileIdMap[oldId];
        if (!savedFileId) continue;
        const tile = findTileByFileId(savedFileId);
        if (tile) {
          const newTileId = tile.dataset.tileId;
          if (newTileId && newTileId !== oldId) {
            corrections[oldId] = newTileId;
          }
        }
      }
      const tier0Count = Object.keys(corrections).length;
      if (tier0Count > 0) {
        console.log(`[SEOSONA Flow] [Tầng 0 file_id]: ${tier0Count}/${needsCorrectionIds.length} corrected`);
      }
      const afterTier0 = needsCorrectionIds.filter(id => !corrections[id]);

      // [Tầng 1] file_name matching (ưu tiên cao nhất, cross-project safe)
      const fnCorrections = scanByFileName(afterTier0);
      const fnCount = Object.keys(fnCorrections).length;
      if (fnCount > 0) {
        Object.assign(corrections, fnCorrections);
        console.log(`[SEOSONA Flow] [Tầng 1 file_name]: ${fnCount}/${afterTier0.length} corrected`);
      }
      let uncorrected = needsCorrectionIds.filter(id => !corrections[id]);
      let allCrossProjectIds = [];

      // [Tầng 2] thumbnail URL matching
      if (uncorrected.length > 0) {
        const urlResult = scanByThumbnailUrl(uncorrected);
        const urlCorrections = urlResult.corrections;
        const urlCrossProject = urlResult.crossProjectIds || [];
        const urlCount = Object.keys(urlCorrections).length;
        if (urlCount > 0) {
          Object.assign(corrections, urlCorrections);
          console.log(`[SEOSONA Flow] [Tầng 2 thumbnail_url]: ${urlCount}/${uncorrected.length} corrected`);
        }
        if (urlCrossProject.length > 0) {
          allCrossProjectIds.push(...urlCrossProject);
          console.log(`[SEOSONA Flow] [Tầng 2 cross-project]: ${urlCrossProject.length} detected`);
        }
        uncorrected = uncorrected.filter(id => !corrections[id] && !urlCrossProject.includes(id));
      }

      // [Tầng 3] ensureFlowTilesLoaded → retry file_name + thumbnail.
      // skipZoomScan (2026-06-22): background correction (_correctStaleIds editor refresh) KHÔNG cần
      // multi-pass zoom (best-effort, gây zoom-ra-zoom-vô flicker). Bỏ qua → để uncorrected cho ref-prep
      // lúc gen xử lý (correctFileIds + reupload, đã in zoom-session). Ref-prep caller KHÔNG set flag → giữ zoom.
      if (uncorrected.length > 0 && !message.skipZoomScan) {
        console.log(`[SEOSONA Flow] [Tầng 3]: còn ${uncorrected.length} IDs chưa match, gọi ensureFlowTilesLoaded(targets)...`);
        // Truyền file_name target → ensureFlowTilesLoaded multi-pass + CAPTURE tile_id (chống
        // virtual-scroll unmount). Dùng found map trực tiếp thay vì chỉ dựa scan DOM lại.
        const targetFns = [...new Set(uncorrected.map(id => fileNameMap[id]).filter(Boolean))];
        const found = await ensureFlowTilesLoaded(false, targetFns) || {};
        for (const oldId of uncorrected) {
          const fn = fileNameMap[oldId];
          if (fn && found[fn] && found[fn] !== oldId) corrections[oldId] = found[fn];
        }
        const tilesAfterLoad = document.querySelectorAll(_getTileSelectorString()).length;
        console.log(`[SEOSONA Flow] [Tầng 3]: sau ensureFlowTilesLoaded: ${tilesAfterLoad} tiles, capture ${Object.keys(found).length}/${targetFns.length} target`);

        // Retry Tầng 1 + 2 cho phần còn lại (id không có file_name hoặc capture trượt)
        uncorrected = uncorrected.filter(id => !corrections[id]);
        const retryFn = scanByFileName(uncorrected);
        Object.assign(corrections, retryFn);
        const stillMissing = uncorrected.filter(id => !corrections[id] && !retryFn[id]);
        if (stillMissing.length > 0) {
          const retryUrlResult = scanByThumbnailUrl(stillMissing);
          Object.assign(corrections, retryUrlResult.corrections);
          if (retryUrlResult.crossProjectIds?.length > 0) {
            allCrossProjectIds.push(...retryUrlResult.crossProjectIds);
          }
        }
        const finalUncorrected = uncorrected.filter(id => !corrections[id]);
        console.log(`[SEOSONA Flow] [Tầng 3] retry: ${uncorrected.length - finalUncorrected.length} thêm | ${finalUncorrected.length} vẫn missing`);
      }

      // Dedupe crossProjectIds
      allCrossProjectIds = [...new Set(allCrossProjectIds)];

      console.log(`[SEOSONA Flow] correctStaleFileIds KẾT QUẢ: ${Object.keys(corrections).length}/${needsCorrectionIds.length} corrected, ${allCrossProjectIds.length} cross-project`);
      for (const [oldId, newId] of Object.entries(corrections)) {
        console.log(`[SEOSONA Flow]   ${oldId.substring(0, 30)}... → ${newId.substring(0, 30)}...`);
      }
      if (allCrossProjectIds.length > 0) {
        console.log(`[SEOSONA Flow] Cross-project IDs:`, allCrossProjectIds.map(id => id.substring(0, 25) + '...'));
      }
      return { corrections, crossProjectIds: allCrossProjectIds };
    },
    'findTileByFileName': () => {
      const fileName = message.fileName;
      if (!fileName) return { tileId: null };
      const tiles = document.querySelectorAll(_getTileSelectorString());
      for (const tile of tiles) {
        const fn = extractFileName(tile);
        if (fn === fileName) {
          return { tileId: tile.dataset.tileId };
        }
      }
      return { tileId: null };
    },
    'prepareFlowForScan': async () => {
      await ensureFlowTilesLoaded();
      const tileCount = document.querySelectorAll(_getTileSelectorString()).length;
      return { success: true, tileCount };
    },
    'applyFlowPageSettings': async () => {
      // Apply Flow page settings sớm khi sidebar connect — không cần đợi đến khi run workflow.
      // Idempotent — skip nếu đã apply (sessionStorage flag).
      await ensureFlowSettingsApplied();
      return { success: true, applied: _flowSettingsApplied };
    },
    'scanFlowImages': async () => {
      // Bug 46 fix: Wait for selector config to be ready before scanning
      if (!_selectorConfigReady) {
        console.log('[SEOSONA Flow] scanFlowImages: config not ready, waiting...');
        for (let i = 0; i < 15; i++) {
          await sleep(200);
          if (_selectorConfigReady) break;
        }
        if (!_selectorConfigReady) {
          console.warn('[SEOSONA Flow] scanFlowImages: timeout waiting for config');
          return { images: [], error: 'selector_config_timeout' };
        }
      }
      // Clear stale cache to force refresh
      _tileSelectorCache = null;

      const images = [];
      const seenIds = new Set();
      const tileSelector = _getTileSelectorString();
      console.log(`[SEOSONA Flow] scanFlowImages: selector="${tileSelector}", deep=${message.deep === true}`);
      // Quét tile hiện có trong DOM, append vào images (dedup theo tile_id). Tách thành hàm để
      // deep-scan gọi lại sau mỗi bước scroll (Flow virtual-scroll unmount tile ngoài viewport).
      const _scanCurrent = () => {
        const tiles = document.querySelectorAll(tileSelector || '[data-tile-id]');
        tiles.forEach(tile => {
          const tileId = tile.dataset.tileId;
          if (!tileId || seenIds.has(tileId)) return;
          const img = tile.querySelector('img');
          const video = _q('tile_video', tile);
          const fileName = extractFileName(tile);
          const isVideoByAlt = img?.alt?.toLowerCase().includes('video');
          // Video detection: ưu tiên check <video> trước (tile có thể chứa cả img + video)
          // Fallback: detect video via img alt="Video thumbnail" khi <video> chưa render
          if (video) {
            seenIds.add(tileId);
            const flowInfoV = extractFlowFileInfo(tile);
            const videoSrc = video.src || (video.querySelector('source')?.src) || '';
            // Thumbnail: poster > img sibling > video src
            let vThumb = video.poster || '';
            if (!vThumb && img && img.src && !img.src.includes('chrome-extension')) vThumb = img.src;
            if (!vThumb) vThumb = videoSrc;
            images.push({ fileId: tileId, thumbnail: vThumb, source: 'flow', type: 'video', ...(videoSrc && { video_url: videoSrc }), ...(fileName && { file_name: fileName }), ...(flowInfoV && { file_id: flowInfoV.file_id, project_id: flowInfoV.project_id }) });
          } else if (isVideoByAlt && img && img.src && !img.src.includes('chrome-extension')) {
            // Video tile detected via alt attribute — video element not rendered yet
            seenIds.add(tileId);
            const flowInfoV = extractFlowFileInfo(tile);
            images.push({ fileId: tileId, thumbnail: img.src, source: 'flow', type: 'video', video_url: img.src, ...(fileName && { file_name: fileName }), ...(flowInfoV && { file_id: flowInfoV.file_id, project_id: flowInfoV.project_id }) });
          } else if (img && img.src && !img.src.includes('chrome-extension')) {
            seenIds.add(tileId);
            const flowInfo = extractFlowFileInfo(tile);
            images.push({ fileId: tileId, thumbnail: img.src, source: 'flow', type: 'image', ...(fileName && { file_name: fileName }), ...(flowInfo && { file_id: flowInfo.file_id, project_id: flowInfo.project_id }) });
          }
        });
      };
      _scanCurrent();

      // Fix D (2026-06-15) deep scan on-demand: picker "xem thêm" tới cuối → scroll Flow page +
      // tích luỹ tile qua từng bước (gom trong lúc scroll vì virtual-scroll gỡ tile cũ). Trả về
      // toàn bộ library để user chọn được ảnh nằm sâu.
      if (message.deep === true) {
        // Browser zoom thật (giống Cmd+- 30%) để Flow render nhiều tile/viewport hơn; fallback CSS.
        // Tôn trọng zoom session: nếu đang trong batch submit → dùng session zoom, không tự restore.
        const _inSession = !!(window._seosonaFlowZoomSession && window._seosonaFlowZoomSession.armed);
        const _bzOrig = _inSession ? null : await _getBrowserZoom();
        const _useBz = !_inSession && _bzOrig != null;
        const originalCssZoom = document.body.style.zoom || '1';
        const _scCfg = _getDynamicSelector('flow_scroll_container');
        const _scClosestAttr = _scCfg?.closest_attribute || '[style*="overflow"]';
        const sc = _q('flow_scroll_container')?.closest(_scClosestAttr) || document.documentElement;
        try {
          if (_inSession) await _ensureZoomSessionActive();
          else if (_useBz) await _setBrowserZoom(0.3);
          else document.body.style.zoom = '0.5';
          await sleep(800);
          const step = Math.max(Math.floor((window.innerHeight || 800) * 0.8), 500);
          const MAX_STEPS = 200; // chặn library cực lớn
          let stagnant = 0, prevCount = images.length;
          for (let pos = 0, n = 0; pos <= sc.scrollHeight + step && n < MAX_STEPS; pos += step, n++) {
            sc.scrollTop = pos;
            await sleep(250);
            _scanCurrent();
            if (images.length === prevCount) { if (++stagnant >= 3) break; } // 3 bước liền không thêm → hết
            else { stagnant = 0; prevCount = images.length; }
          }
          sc.scrollTop = 0;
        } finally {
          // Trong session → KHÔNG restore (session tự lo); ngoài session → restore per-call.
          if (!_inSession) { if (_useBz) await _setBrowserZoom(_bzOrig); else document.body.style.zoom = originalCssZoom; }
          await sleep(200);
        }
        console.log(`[SEOSONA Flow] scanFlowImages deep: tích luỹ ${images.length} ảnh`);
      }

      if (images.length === 0) {
        console.log('[SEOSONA Flow] scanFlowImages: fallback to tile_image scan');
        const allImgs = _qa('tile_image');
        allImgs.forEach((img, i) => {
          const src = img.src;
          if (!src || src.includes('chrome-extension') || img.naturalWidth < 50) return;
          // Use tileSelector we already have (or fallback to [data-tile-id])
          const parentTile = img.closest(tileSelector || '[data-tile-id]');
          const fileId = parentTile?.dataset?.tileId;
          // Skip if no valid tile ID found (don't use flow_img_X fallback anymore).
          // Ảnh chưa có tile ID là BÌNH THƯỜNG (Flow chưa gán) → bỏ qua im lặng, KHÔNG log
          // (trước dùng console.warn → bắn mỗi ảnh → spam trang Lỗi chrome://extensions).
          if (!fileId) return;
          if (seenIds.has(fileId)) return;
          seenIds.add(fileId);
          images.push({ fileId, thumbnail: src, source: 'flow', type: 'image' });
        });
      }
      return { images };
    },
    'uploadFilesToFlow': async () => {
      // Nhận file data dưới dạng base64 từ sidePanel, tạo File, inject vào input[type=file]
      // Upload tuần tự để đảm bảo thứ tự, tối ưu thời gian chờ
      const filesData = message.filesData || [];
      console.log('[uploadFilesToFlow] handler called with', filesData.length, 'file(s), url:', window.location.href.substring(0, 80));
      if (filesData.length === 0) return { tileIds: [], orderedTileIds: [] };

      // [P1 fix 2026-06-10] Poll wait input mount up to 8s.
      // Root cause: Chrome 110+ Memory Saver (default ON) discard tab sau 5 min inactive →
      // activate lại → tab auto-reload → Flow React app bootstrap mất ~500ms-vài giây
      // (Windows hardware yếu chậm hơn) → input[type=file] chưa xuất hiện trong DOM.
      // Trước fix: return ngay → ImmediateUploader throw → ⚠️ icon trên image node.
      let flowInputs = Array.from(document.querySelectorAll('input[type="file"]'));
      if (flowInputs.length === 0) {
        const maxWaitMs = 8000;
        const pollInterval = 200;
        let waited = 0;
        while (waited < maxWaitMs && flowInputs.length === 0) {
          await sleep(pollInterval);
          waited += pollInterval;
          flowInputs = Array.from(document.querySelectorAll('input[type="file"]'));
        }
        if (flowInputs.length === 0) {
          console.warn('[uploadFilesToFlow] No file input found after ' + maxWaitMs + 'ms wait (Flow React app chưa bootstrap)');
          return {
            tileIds: [],
            orderedTileIds: [],
            warning: 'No file input found after wait',
            errorCode: 'NO_FLOW_INPUT_AFTER_WAIT',
          };
        }
        console.log('[uploadFilesToFlow] Found ' + flowInputs.length + ' file input(s) after ' + waited + 'ms wait');
      }

      const orderedTileIds = [];
      const tileDetails = [];
      // Modal consent "Tôi đồng ý" (Prohibited Use Policy) hiện LẦN ĐẦU upload → chỉ click 1 lần
      // cho cả batch (modal không reappear sau khi đồng ý). Check trong poll loop bên dưới.
      let consentConfirmed = false;

      for (let fileIdx = 0; fileIdx < filesData.length; fileIdx++) {
        const fd = filesData[fileIdx];
        // forceRefresh=true vì cần baseline chính xác trước upload
        const existingTiles = getUniqueTileIds(true);

        const binary = atob(fd.base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], fd.name, { type: fd.type });

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        // Bug fix 2026-05-28: Flow input[type=file] CHỈ `accept="image/*"` → KHÔNG nhận video qua
        // input.files. Video PHẢI upload bằng drag-drop (DragEvent) lên drop-zone + Flow hiện modal
        // confirm "Rights to use this video" → click "I agree". (Trước: dispatch video vào input ảnh →
        // reject "Unsupported image format" → abort.)
        const isVideoFile = (fd.type || '').startsWith('video/')
          || /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(fd.name || '');

        if (isVideoFile) {
          await _dropVideoToFlow(file);
        } else {
          // Ảnh: dùng input.files (input image/*). Filter input ảnh, tránh input video-only nếu có.
          const targetInputs = flowInputs.filter((input) => {
            const accept = (input.getAttribute('accept') || '').toLowerCase();
            if (!accept) return true;
            const acceptsVideo = accept.includes('video') || /(mp4|mov|webm|avi|mkv|m4v)/.test(accept);
            const acceptsImage = accept.includes('image') || /(png|jpe?g|webp|gif|heic|heif|avif)/.test(accept);
            return acceptsImage || !acceptsVideo;
          });
          const dispatchInputs = targetInputs.length > 0 ? targetInputs : flowInputs;
          for (const input of dispatchInputs) {
            try {
              // [P2 fix 2026-06-10] React 18 override native value setter cho input
              // (React issues #27283, #32300, #10135 + Cypress #3730). Programmatic assignment
              // có thể bypass React's onChange synthetic event handler.
              // Workaround community-confirmed (Cypress/Selenium/Playwright):
              //   1. Call native setter qua descriptor để bypass React's monkey-patch
              //   2. Dispatch CẢ 'input' + 'change' event với bubbles:true
              try {
                const nativeFilesSetter = Object.getOwnPropertyDescriptor(
                  window.HTMLInputElement.prototype, 'files'
                )?.set;
                if (nativeFilesSetter) {
                  nativeFilesSetter.call(input, dataTransfer.files);
                } else {
                  input.files = dataTransfer.files;
                }
              } catch (_) {
                // Fallback: trực tiếp assign (Chrome cũ KHÔNG có descriptor cho files)
                input.files = dataTransfer.files;
              }
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (e) {
              // Nuot im -> o nhap KHONG nhan gia tri, gen chay voi prompt rong ma khong ai biet.
              console.warn('[SEOSONA Flow] Dat gia tri o nhap that bai -> prompt co the rong:', e && e.message);
            }
          }
          document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        }

        // Wait for new tile - optimized: check frequently, shorter initial wait
        let newTileId = null;
        let processingTileId = null; // Track tile đang processing (cho inactive tab fallback)
        let processingSeenAt = 0;    // Thời điểm phát hiện tile processing
        let waitTime = 0;
        const maxWait = 45000; // 45s max per file
        const checkInterval = 500; // Check every 500ms (faster polling)
        const processingAcceptDelay = 15000; // Chấp nhận tile processing sau 15s (tab inactive)

        // Initial wait for upload to start processing
        await sleep(800);
        waitTime += 800;

        while (waitTime < maxWait) {
          // 2026-05-27: bắt toast Flow báo VI PHẠM content (upload_blocked_text) → abort sớm +
          // trả lý do nguyên văn (thay vì chờ 45s timeout vô ích, user không biết tại sao).
          const uploadErr = _detectFlowUploadError();
          if (uploadErr) {
            console.warn('[uploadFilesToFlow] Flow blocked upload:', uploadErr);
            return { tileIds: orderedTileIds, orderedTileIds, error: 'UPLOAD_BLOCKED', errorMessage: uploadErr, blockedFile: fd.name };
          }
          // Lần đầu upload: Flow hiện modal "Tôi đồng ý" (Prohibited Use Policy) chặn tile xuất hiện
          // → click confirm. Tích hợp trong poll loop (0 latency thừa); chỉ 1 lần cho cả batch.
          if (!consentConfirmed) consentConfirmed = _clickUploadConsentModal();
          // forceRefresh=true vì đây là polling loop cần data mới nhất từ DOM
          const currentTiles = getUniqueTileIds(true);
          let newTiles = currentTiles.filter(id => !existingTiles.includes(id) && !orderedTileIds.includes(id));

          // Bug fix: virtual-scroll có thể đẩy tile CŨ vào DOM sau upload → lọt vào newTiles →
          // newTiles[0] lấy NHẦM tile cũ (vd grok record nhầm result của node khác). Disambiguate
          // bằng caption = fd.name (tên file vừa upload — Flow hiển thị đúng tên đó ở tile). Ưu tiên
          // tile khớp tên lên đầu để newTiles[0] lấy đúng tile vừa upload. Không match → giữ nguyên.
          if (newTiles.length > 1 && fd.name) {
            const namedIdx = newTiles.findIndex(id => {
              const t = document.querySelector(`[data-tile-id="${id}"]`);
              return t && (t.textContent || '').includes(fd.name);
            });
            if (namedIdx > 0) {
              const [matched] = newTiles.splice(namedIdx, 1);
              newTiles.unshift(matched);
            }
          }

          if (newTiles.length > 0) {
            const tile = document.querySelector(`[data-tile-id="${newTiles[0]}"]`);
            if (tile) {
              const status = detectTileStatus(tile);
              if (status === 'success') {
                newTileId = newTiles[0];
                break;
              }
              // Wait for success — processing tile can't be used for addFileToPrompt
              // (context menu "Thêm vào câu lệnh" not available on processing tiles)
              if (status === 'failed') {
                console.log('[uploadFilesToFlow] Tile failed, attempting auto-retry:', newTiles[0]);
                // Auto-retry: Click upload retry button và chờ tile recover (Bug 50 fix)
                // Upload retry khác gen retry — KHÔNG tạo tile mới, chỉ re-render CÙNG tile
                // Port 1.1.58: serialize click qua ctx-menu lock → tránh left-click retry đóng
                // context-menu của item khác đang download (parallel multi-prompt) → mất file.
                await _acquireCtxMenuLock();
                let retryClicked;
                try { retryClicked = clickUploadRetryButton(newTiles[0]); }
                finally { _releaseCtxMenuLock(); }
                if (retryClicked) {
                  console.log('[uploadFilesToFlow] Retry button clicked, waiting for recovery...');
                  await sleep(2000);
                  // Re-check status sau retry
                  const retryTile = document.querySelector(`[data-tile-id="${newTiles[0]}"]`);
                  const retryStatus = detectTileStatus(retryTile);
                  if (retryStatus === 'success') {
                    console.log('[uploadFilesToFlow] Tile recovered after retry:', newTiles[0]);
                    newTileId = newTiles[0];
                    break;
                  }
                  console.log('[uploadFilesToFlow] Tile still failed after retry, skipping:', newTiles[0]);
                }
                break;
              }
              // status === 'processing' → track cho inactive tab fallback
              if (!processingTileId) {
                processingTileId = newTiles[0];
                processingSeenAt = waitTime;
              }
              // Inactive tab: React throttle rendering → tile stuck processing
              // THAY ĐỔI: Thử activate tab thay vì chấp nhận processing tile
              // Chấp nhận processing tile → addFileToPrompt fail → submit fail → Application error
              if (processingTileId && (waitTime - processingSeenAt) >= processingAcceptDelay) {
                console.log('[uploadFilesToFlow] Tab inactive: tile stuck processing, trying to activate tab...');
                // Thử activate tab để React resume rendering
                try {
                  await new Promise(resolve => {
                    chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }, () => resolve());
                  });
                  await sleep(2000); // Chờ React resume
                  // Re-check tile status sau khi activate
                  const reCheckTile = document.querySelector(`[data-tile-id="${processingTileId}"]`);
                  const reCheckStatus = detectTileStatus(reCheckTile);
                  if (reCheckStatus === 'success') {
                    console.log('[uploadFilesToFlow] Tab activated, tile now success:', processingTileId);
                    newTileId = processingTileId;
                    break;
                  } else if (reCheckStatus === 'failed') {
                    console.log('[uploadFilesToFlow] Tab activated but tile failed, attempting auto-retry:', processingTileId);
                    // Port 1.1.58: serialize retry click qua ctx-menu lock (tránh mất file item khác).
                    await _acquireCtxMenuLock();
                    let retryClicked;
                    try { retryClicked = clickUploadRetryButton(processingTileId); }
                    finally { _releaseCtxMenuLock(); }
                    if (retryClicked) {
                      await sleep(2000);
                      const retryTile = document.querySelector(`[data-tile-id="${processingTileId}"]`);
                      const retryStatus = detectTileStatus(retryTile);
                      if (retryStatus === 'success') {
                        console.log('[uploadFilesToFlow] Tile recovered after retry:', processingTileId);
                        newTileId = processingTileId;
                        break;
                      }
                    }
                    break;
                  }
                  // Still processing after activate → wait thêm 5s rồi timeout
                  console.log('[uploadFilesToFlow] Tab activated but tile still processing, waiting 5s more...');
                  await sleep(5000);
                  const finalTile = document.querySelector(`[data-tile-id="${processingTileId}"]`);
                  const finalStatus = detectTileStatus(finalTile);
                  if (finalStatus === 'success') {
                    newTileId = processingTileId;
                    break;
                  }
                  // Vẫn processing → log warning và continue loop (sẽ timeout)
                  console.warn('[uploadFilesToFlow] Tile still processing after tab activate + 5s wait, will timeout');
                } catch (e) {
                  console.warn('[uploadFilesToFlow] ensureFlowTabActive failed:', e.message);
                }
              }
            }
          }

          await sleep(checkInterval);
          waitTime += checkInterval;
        }

        // Fallback: nếu timeout mà có tile processing → KHÔNG chấp nhận
        // Processing tile không dùng được cho addFileToPrompt → sẽ gây lỗi
        if (!newTileId && processingTileId) {
          console.warn('[uploadFilesToFlow] Timeout: tile still processing, NOT accepting:', processingTileId);
          // KHÔNG set newTileId = processingTileId để tránh submit fail
        }

        if (newTileId) {
          orderedTileIds.push(newTileId);
          const tile = _getTileById(newTileId);
          const media = tile?.querySelector('img, video');

          // CRITICAL: Chờ file_name + thumbnailUrl có sẵn (img src chứa getMediaUrlRedirect)
          // Nếu tile processing, src có thể là blob/placeholder → extractFileName null + thumbnailUrl sai
          // → lần chạy sau không detect được → reupload vòng lặp vô hạn
          // → ref_thumbnails có URL sai → hiển thị ảnh khác
          let fileName = extractFileName(tile);
          let thumbnailUrl = media?.src || '';
          const isValidThumbUrl = (url) => url && !url.startsWith('blob:') && !url.includes('placeholder');

          if ((!fileName || !isValidThumbUrl(thumbnailUrl)) && tile) {
            // Poll tối đa 5s để chờ file_name và thumbnailUrl
            for (let fnWait = 0; fnWait < 5000 && (!fileName || !isValidThumbUrl(thumbnailUrl)); fnWait += 500) {
              await sleep(500);
              // Force refresh cache
              const tileId = tile.dataset?.tileId;
              if (tileId) _fileNameCache.delete(tileId);
              fileName = extractFileName(tile);
              // Re-query media element và lấy src mới
              const freshMedia = tile.querySelector('img, video');
              if (freshMedia?.src) thumbnailUrl = freshMedia.src;
            }
            if (fileName) {
              console.log('[uploadFilesToFlow] Got file_name after waiting:', fileName);
            } else {
              console.warn('[uploadFilesToFlow] Could not get file_name for tile:', newTileId);
            }
            if (isValidThumbUrl(thumbnailUrl)) {
              console.log('[uploadFilesToFlow] Got valid thumbnailUrl after waiting');
            } else {
              console.warn('[uploadFilesToFlow] Could not get valid thumbnailUrl for tile:', newTileId);
            }
          }

          const flowInfo = extractFlowFileInfo(tile);
          tileDetails.push({
            id: newTileId,
            thumbnailUrl: thumbnailUrl,
            ...(fileName && { file_name: fileName }),
            ...(flowInfo && { file_id: flowInfo.file_id, project_id: flowInfo.project_id }),
            originalName: fd.name,
            originalKey: fd.key  // Fix: Track original key for correct mapping
          });
        }

        // Minimal delay between uploads (just enough for UI to update)
        if (fileIdx < filesData.length - 1) {
          await sleep(200);
        }
      }

      // Fix: Return keyMapping để caller có thể map đúng oldKey → newTileId
      // Trước đây chỉ return orderedTileIds theo thứ tự, nhưng nếu upload 1 fail:
      // pendingIds = [key1, key2], orderedTileIds = [tile2]
      // → Mapping sai: key1 → tile2 (should be: key2 → tile2)
      const keyMapping = {};
      for (const detail of tileDetails) {
        if (detail.originalKey && detail.id) {
          keyMapping[detail.originalKey] = detail.id;
        }
      }

      return { tileIds: orderedTileIds, tileDetails, orderedTileIds, keyMapping };
    },
    'downloadTileMedia': async () => {
      const tileId = message.tileId;
      const promptText = message.promptText || 'flow';
      const taskName = message.taskName || null;
      const fileName = message.fileName || null;
      const resolution = message.resolution || null;
      const flowFileId = message.flowFileId || null;
      const index = message.index || null;
      const videoResolution = message.videoResolution || null;
      if (!tileId && !flowFileId) return { success: false, error: 'No tileId or flowFileId' };
      try {
        const result = await downloadTileMedia(tileId, promptText, taskName, fileName, resolution, flowFileId, index, videoResolution);
        return { success: result !== false };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },
    'extractTileIdentifiers': () => {
      const tileId = message.tileId;
      if (!tileId) return { fileName: null, thumbnailUrl: null };
      const tile = _getTileById(tileId);
      if (!tile) return { fileName: null, thumbnailUrl: null };
      const fileName = extractFileName(tile);
      // Accept any HTTP(S) tile URL — bao gồm `getMediaUrlRedirect?name=UUID` (tile vừa upload
      // local) lẫn `lh3.googleusercontent.com` (tile gen từ Flow). Trước fix chỉ accept lh3
      // → tile upload local trả thumbnailUrl=null → _taskTileCache giữ data:URL local →
      // task save với data URL → reuploadMissingFiles Tầng 3 CDN fetch fail (data URL không fetch được).
      const img = tile.querySelector('img');
      const src = img?.src || '';
      const thumbnailUrl = (src && (src.startsWith('http://') || src.startsWith('https://'))
        && !src.startsWith('data:') && !src.startsWith('chrome-extension:'))
        ? src
        : null;
      return { fileName, thumbnailUrl };
    },
    'scanGalleryTiles': () => {
      const tiles = scanGalleryTiles();
      return { tiles };
    },
    'scanFlowTiles': () => {
      // Scan all Flow tiles for Photos Gallery
      const rawTiles = scanGalleryTiles();
      const tiles = rawTiles
        .filter(t => t.status === 'success' && t.thumbnail)
        .map(t => ({
          id: t.tileId,
          thumbnail: t.thumbnail,
          src: t.mediaSrc,
          type: t.mediaType,
          ...(t.file_name && { file_name: t.file_name }),
          ...(t.file_id && { file_id: t.file_id }),
          ...(t.project_id && { project_id: t.project_id })
        }));
      return { tiles };
    },
    'downloadImage': async () => {
      // Download image from URL
      const url = message.url;
      const filename = message.filename || `flow_${Date.now()}.png`;
      if (!url) return { success: false, error: 'No URL' };
      try {
        const response = await fetch(url);
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },
    'getDownloadCounter': () => {
      return { count: getDownloadCounter() };
    },
    'checkTilesExist': () => {
      const tileIds = message.tileIds || [];
      const existing = [];
      const missing = [];
      for (const id of tileIds) {
        if (_getTileById(id)) {
          existing.push(id);
        } else {
          missing.push(id);
        }
      }
      return { existing, missing };
    },
    'checkFilesExist': () => {
      const fileNames = message.fileNames || [];
      const found = {};
      const tiles = document.querySelectorAll(_getTileSelectorString());
      const domFileNames = [];
      for (const tile of tiles) {
        const fn = extractFileName(tile);
        if (fn) {
          domFileNames.push(fn);
          if (fileNames.includes(fn)) found[fn] = true;
        }
      }
      const existing = fileNames.filter(fn => found[fn]);
      const missing = fileNames.filter(fn => !found[fn]);
      // REUPLOAD_AUDIT: log to compare input vs DOM
      console.log(`[REUPLOAD_AUDIT] checkFilesExist: input=${JSON.stringify(fileNames)}, tiles=${tiles.length}, dom_fns_count=${domFileNames.length}, existing=${JSON.stringify(existing)}, missing=${JSON.stringify(missing)}`);
      if (missing.length > 0 && domFileNames.length > 0) {
        console.log(`[REUPLOAD_AUDIT] checkFilesExist DOM file_names sample (first 5): ${JSON.stringify(domFileNames.slice(0, 5))}`);
      }
      return { existing, missing };
    },
    // BUG FIX 2026-06-05 (Fix D2): expose ensureFlowTilesLoaded ra cho popup/sidebar gọi.
    // Trước: WorkflowExecutor.js Fix 4 + Fix D gọi window.MessageBridge.ensureFlowTilesLoaded()
    // nhưng method không tồn tại trên MessageBridge → silent fail → checkFilesExist query DOM
    // empty (vừa switch tab) → upstream Image tiles "missing" → reupload toàn bộ.
    // Sau: dùng MessageBridge.sendToContentScript('ensureFlowTilesLoaded') → handler này
    // zoom-out + scroll buộc Flow lazy-load tiles vào DOM TRƯỚC khi checkFilesExist.
    'ensureFlowTilesLoaded': async () => {
      if (typeof ensureFlowTilesLoaded !== 'function') {
        return { success: false, error: 'ensureFlowTilesLoaded not defined' };
      }
      try {
        const force = message.force === true;
        const targetFileNames = Array.isArray(message.targetFileNames) ? message.targetFileNames : [];
        const found = await ensureFlowTilesLoaded(force, targetFileNames);
        const tilesCount = document.querySelectorAll(_getTileSelectorString()).length;
        // found = { file_name → tile_id } capture-on-sight → caller dùng trực tiếp, không quét lại DOM
        return { success: true, tilesCount, forced: force, found: found || {} };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },
    // Zoom session: arm khi bắt đầu batch multi-prompt (chưa zoom — chỉ zoom khi có ref xa cần load).
    'beginFlowZoomSession': async () => {
      const factor = typeof message.factor === 'number' ? message.factor : 0.3;
      // Idempotent (2026-06-22): đã armed CÙNG factor → GIỮ NGUYÊN, KHÔNG restore+rearm.
      // Cho phép WorkflowExecutor arm sớm (trước ref-scan) rồi PromptQueue arm lại = no-op → tránh
      // flicker "zoom ra zoom vô" (re-arm = _endZoomSession restore + arm mới → zoom in rồi out lại).
      // hold=true (2026-06-22): owner GIỮ session sống tới khi tự force-end (WorkflowExecutor — await cả
      // gen rồi end ở finally). hold=false (mặc định): transient — GenTab/Tasks arm trước ref-prep nhưng
      // KHÔNG await completion → để PromptQueue _checkAllDone (non-force) restore khi gen xong + không còn holder.
      const hold = message.hold === true;
      const _cur = window._seosonaFlowZoomSession;
      // refs = số owner ĐANG GIỮ. Nhiều arm cùng 0.3 (WF hold + PromptQueue/GenTab transient) → KHÔNG re-arm.
      if (_cur?.armed && _cur.factor === factor) {
        if (hold) _cur.refs = (_cur.refs || 0) + 1;
        return { ok: true, kept: true, refs: _cur.refs };
      }
      // Session cũ factor KHÁC / leak active → restore trước khi arm mới (tránh kẹt zoom vĩnh viễn).
      // Chinh comment tren da canh bao "tranh ket zoom vinh vien" -> nuot im la mat canh bao do.
      if (_cur?.active) {
        try { await _endZoomSession(); }
        catch (e) { console.warn('[SEOSONA Flow] Khong ket thuc duoc zoom session cu -> trang co the ket zoom:', e && e.message); }
      }
      window._seosonaFlowZoomSession = { armed: true, active: false, factor, refs: hold ? 1 : 0, mode: null, original: null, originalCss: null };
      console.log(`[SEOSONA Flow] zoom session: armed (factor=${factor}, hold=${hold})`);
      return { ok: true };
    },
    'endFlowZoomSession': async () => {
      const s = window._seosonaFlowZoomSession;
      if (!s) return { ok: true };
      // force=true (stop): restore NGAY, clear refs (mọi end sau = no-op vì session null).
      if (message.force) {
        s.refs = 0;
        try { await _endZoomSession(); } catch (_) { globalThis.SEOSONA_swallow?.('content#isValidThumbUrl', _); }
        return { ok: true };
      }
      // release=true (holder WF/_runSingleNode kết thúc): giảm refs (hỗ trợ nested holder).
      if (message.release) {
        s.refs = Math.max(0, (s.refs || 0) - 1);
      }
      // restore CHỈ khi không còn holder (refs==0). WF đang giữ → giữ session (tránh restore sớm
      // giữa run). GenTab/Tasks/PromptQueue không hold → refs==0 → restore đúng khi gen xong.
      if ((s.refs || 0) > 0) return { ok: true, kept: true, refs: s.refs };
      try { await _endZoomSession(); } catch (_) { globalThis.SEOSONA_swallow?.('content#isValidThumbUrl', _); }
      return { ok: true };
    },
    'fetchImageAsBase64': async () => {
      const url = message.url;
      if (!url || !url.startsWith('http')) return { success: false, error: 'Invalid URL' };
      try {
        // KHÔNG dùng credentials: 'include' vì sau redirect tới flow-content.google
        // CDN trả Access-Control-Allow-Origin: '*' → CORS spec block credentialed
        // request với wildcard origin. Signed URL đã có Expires + Signature trong
        // query string nên không cần cookies để authenticate.
        const resp = await fetch(url);
        if (!resp.ok) return { success: false, error: `HTTP ${resp.status}` };
        const contentType = resp.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) return { success: false, error: `Not image: ${contentType}` };
        const buffer = await resp.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return { success: true, base64: btoa(binary), contentType };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
    'getProjectContext': () => {
      return {
        projectId: getCurrentProjectId(),
        projectName: extractProjectName(),
        documentTitle: document.title || null,
        projectError: _isFlowProjectErrorState(),  // true = project lỗi/đã xoá (URL còn /project/ nhưng trang lỗi)
        mediaViewer: _isFlowMediaViewerOpen()      // true = đang xem 1 ảnh/video (URL /edit/{fileId}) → editor chưa sẵn sàng gen
      };
    },
    // [FLOW_RECAPTCHA_403 Phase 4] Overlay captcha (human-in-the-loop) trong tab Flow.
    'showCaptchaOverlay': () => { _showCaptchaOverlay({ text: message.text, canResume: message.canResume }); return { ok: true }; },
    'hideCaptchaOverlay': () => { _hideCaptchaOverlay(); return { ok: true }; },
    // [FLOW_RECAPTCHA_403 Phase 2] Query trạng thái lỗi Flow HIỆN TẠI (recaptcha widget + toast
    // captcha/rate/quota). TileMonitor/PromptQueue gọi để rẽ nhánh. tileId optional → kèm reason
    // của fail tile (policy detection Surface B).
    'getFlowErrorState': () => {
      const state = _getFlowErrorState();
      let tileReason = null, tileCategory = null;
      const tid = message.tileId;
      if (tid) {
        try {
          const tileEl = document.querySelector(`[data-tile-id="${tid}"]`);
          if (tileEl) {
            const reason = _extractTileFailReason(tileEl);
            if (reason) { tileReason = reason; tileCategory = _classifyFlowErrorText(reason); }
          }
        } catch (_) { /* ignore */ }
      }
      return { state, tileReason, tileCategory };
    },
    // Scan Flow home page DOM cho danh sách projects (cards/links).
    // Homepage: auto-scroll lazy-load TẤT CẢ project trước khi collect, rồi return scroll
    // về đầu (anti-loop trong _autoScrollLoadProjects). Trong project: collect thường.
    'scanFlowProjects': async () => {
      const isHomePage = !getCurrentProjectId();
      if (isHomePage) {
        try { await _autoScrollLoadProjects(); } catch (_) { globalThis.SEOSONA_swallow?.('content#isValidThumbUrl', _); }
      }
      return { projects: _collectFlowProjects(), isHomePage };
    },
    'command': () => {
      // Keyboard shortcut from background.js
      if (message.command === 'generate') {
        const startBtn = document.getElementById('startBtn');
        if (startBtn && !startBtn.classList.contains('hidden')) startBtn.click();
      }
      return { ok: true };
    },
    // === Q2.3: Screen Capture Crop Overlay ===
    'startCropSelection': () => {
      // Dead code (không có caller thật): chức năng chụp màn hình chạy qua background.js
      // (_startCropOnActiveTab). Trả no-op để không tham chiếu overlay/selection đã bị gỡ.
      return Promise.resolve({ success: false, error: 'CROP_OVERLAY_DISABLED' });
    },
    'cancelCropSelection': () => {
      const overlay = document.getElementById('seosonaflow-crop-overlay');
      if (overlay) overlay.remove();
      return { success: true };
    },

    // --- PQ: PromptQueue Pipeline handlers ---

    'pq:getPreTileSnapshot': () => {
      // Lấy snapshot tile IDs và file names trước khi submit prompt
      // forceRefresh=true vì cần baseline chính xác trước submit
      const ids = getUniqueTileIds(true);
      const names = [...getExistingFileNames()];
      console.log(`[content.js] pq:getPreTileSnapshot — captured ${ids.length} tile IDs + ${names.length} file names (baseline TRƯỚC submit)`);
      return {
        success: true,
        preTileIds: ids,
        preFileNames: names
      };
    },

    'pq:addRefImages': async () => {
      // Thêm ref images vào editor tuần tự
      const { fileIds, fileNameMap } = message;
      // [DEBUG_REF] Trace addRefImages để diagnose video gen missing ref bug (2026-05-21)
      console.log('[DEBUG_REF] pq:addRefImages called with fileIds:', fileIds, 'fileNameMap keys:', Object.keys(fileNameMap || {}));
      let addedCount = 0;
      let failedIds = [];
      for (const fid of (fileIds || [])) {
        const result = await addFileToPrompt(fid, fileNameMap?.[fid]);
        if (result === false) {
          failedIds.push(fid);
        } else {
          addedCount++;
        }
      }
      // Return actual success/failure - caller phải check failedIds
      const allSuccess = failedIds.length === 0;
      console.log('[DEBUG_REF] pq:addRefImages result:', { addedCount, failedIds, totalRequested: (fileIds || []).length });
      if (!allSuccess) {
        console.warn('[pq:addRefImages] Failed to add:', failedIds.length, 'of', (fileIds || []).length, 'ref images');
      }
      return { success: allSuccess, addedCount, failedIds, totalRequested: (fileIds || []).length };
    },

    'pq:removeExistingRefImages': async () => {
      // Xóa ref images hiện có trong editor
      console.log('[content.js] pq:removeExistingRefImages received');
      const removed = await removeExistingRefImages();
      console.log(`[content.js] pq:removeExistingRefImages done — removed ${removed} ref images`);
      return { success: true, removed };
    },

    'pq:verifySlateModel': () => {
      // Kiểm tra Slate model đã có nội dung chưa
      // Fix: Check textContent thay vì chỉ placeholder
      // Vì timing issue, placeholder có thể chưa kịp biến mất dù text đã được insert
      const editor = getEditor();
      if (!editor) return { success: true, hasContent: false };

      // Check CẢ HAI: placeholder đã biến mất HOẶC có text trong editor
      const noPlaceholder = editor.querySelector('[data-slate-placeholder]') === null;
      const hasText = editor.textContent?.trim().length > 0;
      const hasContent = noPlaceholder || hasText;

      return { success: true, hasContent };
    },

    'detectTileStatus': () => {
      // Kiểm tra trạng thái tile qua DOM
      const tile = document.querySelector(`[data-tile-id="${message.tileId}"]`);
      return { status: detectTileStatus(tile) };
    },

    'retryFailedTilesViaButton': async () => {
      // Click nút "Thử lại" trên tiles thất bại (Tier 1 retry)
      shouldStop = false;
      // NOTE: KHÔNG clear _clickedRetryTileIds/_retryingTiles ở đây vì:
      // 1. Multiple TileMonitors có thể gọi handler này đồng thời
      // 2. Clear ở đây gây race condition: call B clear tracking của call A đang execute
      // 3. Tracking được clear tại stopExecution (khi pipeline dừng) hoặc
      //    bên trong retryFailedTilesViaButton cho tiles cụ thể sau khi xử lý xong
      const result = await retryFailedTilesViaButton(
        message.failedTileIds || [],
        message.timeout || 120000,
        message.excludeTileIds || null
      );
      return result;
    },

    // Legacy: Tracker update từ sidePanel (task/workflow/angles owners)
    'legacyTrackerUpdate': () => {
      FloatingTracker.updateLegacy(message.data);
      return { success: true };
    },

    // PQ: Floating Tracker trong trang Flow (góc phải)
    'pq:trackerUpdate': () => {
      FloatingTracker.update(message.data);
      return { success: true };
    },

    'pq:trackerHide': () => {
      FloatingTracker.hide();
      return { success: true };
    },

    // Chunk Mode (2026-07-26): proactive reload status từ PromptQueue.
    // data: { phase: 'draining'|'reloading'|'resumed', chunkSize?, remaining?, completedChunks? }
    'pq:chunkStatus': () => {
      FloatingTracker.setChunkStatus(message.data);
      return { success: true };
    },

    // PQ: Đồng bộ pause/resume từ PromptQueue → content.js
    'pq:pauseExecution': () => {
      if (message.paused) {
        window._pqPaused = true;
      } else {
        window._pqPaused = false;
      }
      return { success: true };
    },

    // PQ + Workflow per-node: ExecutionBlocker — block user interaction khi gen node chạy.
    // Set _pipelineOwned để sanity check không auto-hide.
    // Show cancel pending-hide timer → 2 generate node liên tiếp không flicker.
    'pq:showBlocker': () => {
      if (ExecutionBlocker._pendingHideTimer) {
        clearTimeout(ExecutionBlocker._pendingHideTimer);
        ExecutionBlocker._pendingHideTimer = null;
      }
      ExecutionBlocker._pipelineOwned = true;
      ExecutionBlocker.show();
      return { success: true };
    },
    // Debounce hide 300ms — nếu node generate tiếp theo gửi showBlocker trong delay
    // thì cancel timer → giữ blocker visible, tránh hide/show flash.
    'pq:hideBlocker': () => {
      if (ExecutionBlocker._pendingHideTimer) clearTimeout(ExecutionBlocker._pendingHideTimer);
      ExecutionBlocker._pendingHideTimer = setTimeout(function() {
        ExecutionBlocker._pendingHideTimer = null;
        ExecutionBlocker._pipelineOwned = false;
        ExecutionBlocker.hide();
      }, 300);
      return { success: true };
    },
    'autoReloadFlow': async () => {
      console.log('[content.js] Auto-reloading Flow page...');
      // Clear editor trước khi reload để tránh "Leave site?" modal
      // Flow có beforeunload listener khi editor có content
      try {
        const editor = getEditor();
        if (editor) {
          await clearEditor(editor);
          await sleep(100);
        }
      } catch (e) {
        console.warn('[autoReloadFlow] Clear editor before reload failed:', e.message);
      }
      // Small delay to ensure response is sent before reload
      setTimeout(() => { location.reload(); }, 100);
      return { success: true };
    },
    // Phase FAR-1: Silent session refresh — KHÔNG reload trang, chỉ trigger Next.js
    // re-fetch session data để re-auth Bearer token. Plan Section 3.1.
    'flow:refreshSession': async () => {
      try {
        // Trigger từ background alarm (FAR-1 periodic) — log telemetry với source
        const ok = await refreshFlowSession('alarm');
        return { success: ok };
      } catch (e) {
        console.warn('[content.js] flow:refreshSession error:', e.message);
        return { success: false, error: e.message };
      }
    },
    // Phase FAR-3: Đếm pending tiles (in-flight, chưa success/failed) cho PromptQueue
    // pre-submit gate (DOM check). Plan Section 3.3.2.
    // CRITICAL: Flow KHÔNG set data-status attribute — phải dùng detectTileStatus() để
    // detect status từ DOM signals (img.src valid, warning icon, ...).
    'getPendingTileCount': () => {
      try {
        // PERFORMANCE: project có thể có hàng trăm tile (vd 286). detectTileStatus
        // mỗi tile = ~5 DOM queries → query toàn bộ 286 tiles = expensive.
        // Tối ưu: tile processing thường có placeholder/skeleton element distinguishable
        // qua absence of <img>/<video> với valid src. Pre-filter trước khi gọi detectTileStatus.
        // Lớp 1 (2026-05-28): excludeClaimedTileIds → đếm CHỈ tile gen CHƯA-AI-CLAIM (orphan =
        // replacement của monitor đang gọi). Không truyền (PromptQueue pre-submit gate) → đếm global.
        const { excludeClaimedTileIds = [] } = message;
        const excludeSet = new Set(excludeClaimedTileIds);
        const tiles = document.querySelectorAll(_getTileSelectorString());
        let pending = 0;
        for (const tile of tiles) {
          // Bỏ tile đã claim bởi monitor khác → tránh monitor A "kẹt chờ" gen của B.
          const tid = tile.dataset?.tileId;
          if (tid && excludeSet.has(tid)) continue;
          // [Fix 2026-08] Video DONE = có <video> result src thật → skip (success). Check TRƯỚC mọi
          // thứ vì đây là tín hiệu "xong" tin cậy nhất cho video.
          if (tile.querySelector('video[src^="http"], video[src^="blob:"]')) continue;
          // Video ĐANG GEN (kể cả "sắp xong"): có play_circle NHƯNG CHƯA có <video> result. Lúc gần xong
          // Flow hiện poster <img src=http> + % tạm mất → quick-reject cũ skip nhầm như "success" →
          // pending=0 → "page hết gen" → reload ngay trước khi xong. play_circle = video chưa done → pending.
          if (Array.from(tile.querySelectorAll('i')).some(el => el.textContent.trim() === 'play_circle')) {
            pending++;
            continue;
          }
          // Image DONE = có <img src> hợp lệ (không phải placeholder) + KHÔNG play_circle → skip success.
          const imgDone = tile.querySelector('img[src^="http"], img[src^="blob:"]');
          if (imgDone) {
            const src = imgDone.src || '';
            if (!src.includes('media.html') && !src.endsWith('.html')) {
              continue; // Likely success — skip detectTileStatus
            }
          }
          // Còn lại (image gen skeleton, %, …): cần detectTileStatus (cache 1.5s) confirm processing vs failed
          const status = detectTileStatus(tile);
          if (status === 'processing') pending++;
        }
        return { count: pending };
      } catch (e) {
        return { count: 0, error: e.message };
      }
    },
    'checkContentScriptAlive': () => {
      return { alive: true, hasEditor: !!getEditor() };
    },
    // === MRC-3.4.1.1-1.3: Lấy trạng thái của danh sách tile IDs ===
    'getTileStatuses': () => {
      const { tileIds } = message;
      const statuses = {};

      for (const tileId of tileIds) {
        const tile = _getTileById(tileId);
        if (!tile) {
          statuses[tileId] = { status: 'not_found' };
          continue;
        }

        // Fix: Flow render progressive preview (blur/low-res CDN URL)
        // TRƯỚC khi gen thực sự xong → detectTileStatus return 'success' nhưng tile chưa
        // có file_name (UUID persistent). Pipeline `_waitClaimedTilesComplete` thấy success
        // → declare item COMPLETED → "queue monitor báo done sớm" + download fail (vì
        // tile chưa render full quality, có thể chưa stable).
        // → Demote status 'success' → 'processing' khi file_name vẫn null.
        const initialStatus = detectTileStatus(tile);
        const fileName = initialStatus === 'success' ? extractFileName(tile) : null;
        const status = (initialStatus === 'success' && !fileName)
          ? 'processing'  // Tile có preview URL nhưng chưa có file_name → vẫn đang gen
          : initialStatus;
        const thumbnail = status === 'success' ? extractThumbnailUrl(tile) : null;
        const mediaType = detectMediaType(tile);  // 'image' | 'video'

        // CRITICAL: Extract video_url for video tiles (needed for Telegram video sending)
        const videoUrl = (mediaType === 'video' && status === 'success') ? extractVideoUrl(tile) : null;

        statuses[tileId] = {
          status,
          file_name: fileName,
          thumbnail: thumbnail,
          type: mediaType,
          ...(videoUrl && { video_url: videoUrl })  // Include video_url only if present
        };
      }

      return { success: true, statuses };
    },
    // === MRC-3.4.1.5-1.7: Quét tìm tiles mới không nằm trong danh sách exclude ===
    // Refactor: thân xử lý tách ra _scanNewTilesInline() (top-level) để cả handler này và
    // handler 'waitUserSubmit' (manual mode detect tile-appear) dùng chung — tránh nhân bản query tile.
    'scanNewTiles': () => _scanNewTilesInline(message.excludeTileIds || [], message.excludeFileNames || []),

    // === Manual Enter mode: chờ user tự nhấn Enter submit (Flow) ===
    // SEOSONA Flow đã điền prompt + ref (EditorExecutor Steps 1-7). Handler này:
    //  - Hiện banner xanh nhắc user nhấn Enter.
    //  - Detect user đã submit qua 2 điều kiện AND (tránh false-positive nhấn nhầm phím):
    //      ① Editor CLEAR: [đã điền prompt / non-empty] → [rỗng/placeholder] (Flow tự clear sau submit).
    //      ② Tile MỚI xuất hiện: scanNewTiles(exclude=preTileIds) trả tile mới (gen thực sự bắt đầu).
    //  - excludeTileIds = item.preTileIds (baseline chụp TRƯỚC submit ở Step 7).
    'waitUserSubmit': async () => {
      const { excludeTileIds, promptIndex, total, refCount, timeoutMs } = message;
      _manualUserSkip = false;
      _manualWaitAbort = false;
      // TẠM ẨN ExecutionBlocker TRƯỚC khi hiện banner → click Skip + nhấn Enter không bị chặn.
      // finally sẽ block lại (nếu pipeline vẫn owns) cho monitor phase.
      ExecutionBlocker.suspendForManual();
      // Phase 5 fix zoom: nếu ref ở xa đã zoom nhỏ page → editor Flow + banner bị thu nhỏ, user không
      // click Submit được. Tạm khôi phục zoom về normal suốt lúc chờ (ref đã attach → an toàn).
      try { await _suspendZoomForManual(); } catch (_) { globalThis.SEOSONA_swallow?.('content#isValidThumbUrl', _); }
      _showManualEnterBanner(promptIndex || 1, total || 1, refCount || 0, 'ready');
      // Click-to-focus fallback: browser chặn script focus editor khi document Flow chưa có input focus
      // (side panel giữ focus). Khi user click bất kỳ đâu trên trang Flow = user gesture → focus editor NGAY.
      // Bỏ qua click TRONG editor (native focus lo đúng vị trí) + banner/tracker.
      const _manualClickFocus = function(ev) {
        const t = ev.target;
        if (!t || !t.closest) return;
        // Safety net Skip: bắt click nút Skip (banner + tracker item) ở document capture — chắc chắn set
        // flag dù listener riêng của nút bị nuốt/che. Loop check _manualUserSkip → thoát SKIP.
        if (t.closest('.sf-meb-skip') || t.closest('[data-action="skip"]')) { _manualUserSkip = true; return; }
        if (t.closest('#seosonaflow-manual-enter-banner') || t.closest('#seosonaflow-flow-tracker')) return;
        const ed = getEditor();
        if (ed && ed.contains(t)) return; // click trong editor → native focus
        injectSlateBridge();
        _slateBridgeCall('focus', {}).catch(function (_e) { globalThis.SEOSONA_swallow?.('content#_manualClickFocus', _e); });
      };
      document.addEventListener('pointerdown', _manualClickFocus, true);
      const start = Date.now();
      let sawEditorFilled = false;
      let focusTries = 0;
      let lastBannerState = 'ready';
      let clickStateSince = 0; // thời điểm vào state 'click' — giữ tối thiểu để không nhấp nháy về 'ready'
      const MIN_CLICK_HOLD_MS = 2500; // giữ 'click ô prompt' đủ lâu để user đọc + click editor
      let didSubmit = false;
      try {
        while (!shouldStop && !_manualWaitAbort) {
          // DEFENSIVE: đảm bảo overlay LUÔN ẩn suốt manual-wait — chống MỌI re-show (reload → pq:showBlocker,
          // gen thêm batch, periodic). Giữ _manualSuspended=true để show() không bật lại.
          ExecutionBlocker._manualSuspended = true;
          if (ExecutionBlocker._el && ExecutionBlocker._el.style.display !== 'none') {
            ExecutionBlocker._el.style.display = 'none';
            ExecutionBlocker._blocking = false;
          }
          // DEFENSIVE: nếu có gì re-zoom nhỏ page giữa lúc chờ → suspend lại để editor/banner giữ normal.
          if (window._seosonaFlowZoomSession?.active) { try { await _suspendZoomForManual(); } catch (_) { globalThis.SEOSONA_swallow?.('content#_manualClickFocus', _); } }
          if (timeoutMs > 0 && Date.now() - start > timeoutMs) { _hideManualEnterBanner(); return { submitted: false, reason: 'TIMEOUT' }; }
          if (_manualUserSkip) { _manualUserSkip = false; _hideManualEnterBanner(); return { submitted: false, reason: 'SKIP' }; }
          // Đọc trạng thái editor (dùng getEditor + pattern isDomUpdated có sẵn).
          const el = getEditor();
          const hasPlaceholder = !!(el && el.querySelector('[data-slate-placeholder]'));
          const domText = (el && el.textContent) ? el.textContent.trim() : '';
          const editorEmpty = !el || hasPlaceholder || domText.length === 0;
          if (!editorEmpty) {
            sawEditorFilled = true;                              // đk① baseline: prompt đã điền vào
            // FOCUS editor để user nhấn Enter là tới Flow ngay (khỏi click editor). Giữ focused mỗi vòng
            // vì user có thể quay lại tab Flow sau vài giây (cross-document: side panel vs Flow tab).
            const isFocused = el && (document.activeElement === el || el.contains(document.activeElement));
            if (!isFocused && el) {
              // Bridge focus (MAIN world: set editor.selection + DOM Selection range cuối text).
              // el.focus() isolated KHÔNG set Slate selection → caret rỗng → Enter vô tác dụng.
              // Retry tới ~8s (20×400ms) để bắt được lúc user quay lại/click tab Flow (cross-document focus).
              if (focusTries < 20) {
                focusTries++;
                injectSlateBridge();
                _slateBridgeCall('focus', {}).catch(function (_e) { globalThis.SEOSONA_swallow?.('content#_manualClickFocus', _e); });
              }
              // DOM re-focus nhẹ mỗi vòng (giữ editor focused; selection đã set bởi bridge lần đầu).
              try { el.focus(); } catch (_) { globalThis.SEOSONA_swallow?.('content#_manualClickFocus', _); }
            }
            // Banner: editor focused → 'ready' (nhấn Enter/Submit); chưa focus → 'click' (hướng dẫn click ô prompt).
            let wantState = isFocused ? 'ready' : 'click';
            // Giữ state 'click' tối thiểu MIN_CLICK_HOLD_MS — sau khi click banner editor blur 1 nhịp rồi loop
            // re-focus ngay → tránh nhấp nháy 'click' → 'ready' quá nhanh, cho user kịp đọc/thao tác.
            if (lastBannerState === 'click' && wantState === 'ready' && (Date.now() - clickStateSince) < MIN_CLICK_HOLD_MS) {
              wantState = 'click';
            }
            if (wantState !== lastBannerState) {
              lastBannerState = wantState;
              if (wantState === 'click') clickStateSince = Date.now();
              _showManualEnterBanner(promptIndex || 1, total || 1, refCount || 0, wantState);
            }
          }
          if (sawEditorFilled && editorEmpty) {                  // đk①: filled → cleared
            const scan = _scanNewTilesInline(excludeTileIds || [], []); // đk②: tile mới (read-only)
            if (scan && scan.tiles && scan.tiles.length > 0) {
              // Đã submit: banner 'submitted' tự ẩn sau 2s (KHÔNG hide ngay để user thấy xác nhận).
              _showManualEnterBanner(promptIndex || 1, total || 1, refCount || 0, 'submitted');
              setTimeout(_hideManualEnterBanner, 2000);
              didSubmit = true;
              return { submitted: true };
            }
          }
          await sleep(400);
        }
        _hideManualEnterBanner();
        return { submitted: false, reason: 'ABORTED' };
      } finally {
        document.removeEventListener('pointerdown', _manualClickFocus, true);
        // Re-block CHỈ khi user đã submit (monitor phase). Skip/abort/timeout → overlay giữ ẩn (không kẹt).
        ExecutionBlocker.resumeAfterManual(didSubmit);
      }
    },
    // Hủy wait manual (EditorExecutor.stop() gọi khi user Dừng job đang chờ Enter).
    'cancelWaitUserSubmit': () => { _manualWaitAbort = true; return { success: true }; },
    // === DOM Resilience: Refresh selector cache when backend pushes update ===
    'providerConfigUpdated': async () => {
      return new Promise((resolve) => {
        chrome.storage.local.get(['seosona_provider_configs'], (res) => {
          if (res.seosona_provider_configs?.data) {
            _selectorConfig = res.seosona_provider_configs.data;
            _selectorConfigTime = Date.now();
            const keyCount = Object.keys(_selectorConfig.flow?.selectors || {}).length;
            console.log(`[SEOSONA Flow] Provider config updated via SSE — reloaded ${keyCount} selectors`);
          } else {
            _selectorConfig = null;
            _selectorConfigTime = 0;
            console.warn('[SEOSONA Flow] Provider config updated via SSE — storage empty, cache cleared');
          }
          resolve({ success: true });
        });
      });
    },
    // === API configs (download_resolutions, ratios, error_patterns) ===
    'providerApiConfigUpdated': async () => {
      return new Promise((resolve) => {
        chrome.storage.local.get(['seosona_provider_api_configs'], (res) => {
          if (res.seosona_provider_api_configs?.data) {
            _apiConfigsCacheLocal = res.seosona_provider_api_configs;
            _apiConfigsCacheLocalTime = Date.now();
            const providers = Object.keys(res.seosona_provider_api_configs.data || {});
            console.log(`[SEOSONA Flow] Provider api_config updated via SSE — reloaded for: ${providers.join(', ')}`);
          } else {
            _apiConfigsCacheLocal = null;
            _apiConfigsCacheLocalTime = 0;
            console.warn('[SEOSONA Flow] Provider api_config updated via SSE — storage empty, cache cleared');
          }
          resolve({ success: true });
        });
      });
    },

    // Flow Voice Selector — scrape advanced menu Voices tab
    'scrapeFlowVoices': async () => {
      return await scrapeFlowVoices();
    },

    // Flow Voice Selector — click voice option trong advanced menu (submit pipeline)
    'selectFlowVoice': async () => {
      return await selectFlowVoice(message.voice);
    },

    // Flow Character Selector — scrape advanced menu tab Nhân vật
    'scrapeFlowCharacters': async () => {
      return await scrapeFlowCharacters();
    },

    // Flow Character Selector — click character option trong advanced menu (submit pipeline)
    'selectFlowCharacter': async () => {
      return await selectFlowCharacter(message.character);
    },

    // Flow Agent Mode (2026-05-30) — check state cho sidebar reconfirm modal preflight
    'checkFlowAgentMode': async () => {
      const state = _isFlowAgentModeOn();
      return { success: true, ...state };
    },

    // Flow Agent Mode (2026-05-30) — auto-disable nếu đang ON (caller: sidebar reconfirm "Fix" button)
    'disableFlowAgentMode': async () => {
      return await _ensureFlowAgentModeOff();
    },

    // Flow Chat Agent Panel (2026-06-02) — check panel state
    'checkFlowChatAgentPanel': async () => {
      const state = _isFlowChatAgentPanelOpen();
      return { success: true, ...state };
    },

    // Flow Chat Agent Panel (2026-06-02) — auto-close panel nếu đang mở
    'closeFlowChatAgentPanel': async () => {
      return await _ensureFlowChatAgentClosed();
    },

    // Flow Agent Instruction Dialog (2026-06-02) — check dialog state
    'checkFlowAgentInstructionDialog': async () => {
      const state = _isFlowAgentInstructionDialogOpen();
      return { success: true, ...state };
    },

    // Flow Agent Instruction Dialog (2026-06-02) — click "Xong" nếu dialog đang mở
    'doneFlowAgentInstructionDialog': async () => {
      return await _ensureFlowAgentInstructionDone();
    },

    /**
     * Quét số dư tín dụng Flow (2026-07-27).
     * Số dư nằm trong trình đơn tài khoản (mặc định đóng) nên scanner tự mở/đóng khi cần.
     * Luôn trả success:true — "chưa đọc được" là KẾT QUẢ hợp lệ (known:false), không phải lỗi;
     * để sidebar phân biệt được "chưa biết" với "hỏng", thay vì hiện số bịa.
     */
    'scanFlowCredits': async () => {
      if (!self.FlowCreditsScanner) {
        return { success: true, known: false, reason: 'SCANNER_MISSING' };
      }
      // Quét THỤ ĐỘNG — chỉ đọc DOM, không bấm gì. Xem chú thích đầu FlowCreditsScanner.js:
      // extension mở được trình đơn tài khoản nhưng KHÔNG đóng lại được (cần click chuột thật),
      // nên tự mở sẽ để giao diện lộn xộn.
      const r = self.FlowCreditsScanner.scanPassive();
      return Object.assign({ success: true }, r);
    }
  };

  if (handlers[message.action]) {
    // Wrap trong Promise.resolve().then() để catch cả sync throw lẫn async reject
    Promise.resolve().then(() => handlers[message.action]())
      .then(result => {
        sendResponse(result || { success: true });
      })
      .catch(err => {
        // Bỏ qua "Extension context invalidated" (extension vừa reload, content script cũ) — vô hại.
        if (!/context (was )?invalidated|Extension context/i.test(String(err && err.message))) {
          console.error('[FlowAuto] Handler error:', message.action, err);
        }
        try { sendResponse({ error: err.message }); } catch (_) { /* context gone */ }
      });
    return true; // async response
  }
});

// --- Feature: Inject Floating "+" Button into Image Tiles ---
function injectOverlayButtons() {
    const tileSelector = _getTileSelectorString();
    const tiles = document.querySelectorAll(tileSelector);

    tiles.forEach(tile => {
        // Double-check: data attribute + DOM query để tránh duplicate
        if (tile.dataset.overlayInjected === '1') return;
        if (tile.querySelector(':scope > .flow-auto-overlay-btn')) return;

        tile.dataset.overlayInjected = '1';

        const currentPos = window.getComputedStyle(tile).position;
        if (currentPos === 'static') {
            tile.style.position = 'relative';
        }

        const btn = document.createElement('div');
        btn.className = 'flow-auto-overlay-btn';
        btn.style.cssText = `
            position: absolute;
            bottom: 8px;
            right: 8px;
            width: 28px;
            height: 28px;
            background: rgba(255, 255, 255, 0.7);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 0;
            font-size: 18px;
            font-weight: bold;
            color: #333;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
            background: rgba(255,255,255,0.85);
            transition: background 0.2s, transform 0.1s;
        `;
        btn.innerHTML = '+';
        btn.title = "Thêm ảnh này vào Tab Gen";

        btn.addEventListener('mouseenter', () => {
            btn.style.background = 'rgba(255, 255, 255, 0.95)';
            btn.style.transform = 'scale(1.05)';
        });
        btn.addEventListener('mouseleave', () => {
            btn.style.background = 'rgba(255, 255, 255, 0.7)';
            btn.style.transform = 'scale(1)';
        });

        btn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            const tileId = tile.getAttribute('data-tile-id');
            if (!tileId) return;

            // Extract tile info
            const fileName = extractFileName(tile);
            const thumbnail = extractThumbnailUrl(tile);

            // Gửi message đến sidePanel để add vào GenTab ref images
            try {
                // Check extension context còn valid không (tránh lỗi khi extension reload)
                if (!chrome.runtime?.id) {
                    console.warn('[SEOSONA Flow] Extension context invalidated, reloading page...');
                    location.reload();
                    return;
                }
                chrome.runtime.sendMessage({
                    action: 'addImageToGenTab',
                    tileId: tileId,
                    fileName: fileName,
                    thumbnail: thumbnail
                }, (response) => {
                    if (chrome.runtime.lastError) {
                        // Nếu extension bị reload, không log lỗi gây spam console
                        const errMsg = chrome.runtime.lastError.message || '';
                        if (errMsg.includes('Extension context invalidated') || errMsg.includes('Receiving end does not exist')) {
                            console.warn('[SEOSONA Flow] Extension reloaded, reloading page...');
                            location.reload();
                        } else {
                            sendLog(`Không thể gửi ảnh đến GenTab: ${errMsg}`, 'warn');
                        }
                        return;
                    }
                    if (response?.success) {
                        if (response.alreadyExists) {
                            sendLog(`ID: ${tileId.substring(0, 20)}... đã có trong danh sách`, 'warn');
                            btn.innerHTML = '...';
                            btn.style.color = '#f9ab00';
                            btn.style.fontSize = '10px';
                            setTimeout(() => {
                                btn.innerHTML = '+';
                                btn.style.color = '#333';
                                btn.style.fontSize = '18px';
                            }, 1000);
                        } else if (response.queued) {
                            // Image queued (sidePanel not open) - will be added when panel opens
                            sendLog(`Ảnh đã được đánh dấu, mở sidebar để thêm vào Tab 1`, 'info');
                            btn.innerHTML = '○';
                            btn.style.color = '#4285f4';
                            setTimeout(() => {
                                btn.innerHTML = '+';
                                btn.style.color = '#333';
                            }, 1500);
                        } else {
                            sendLog(`Đã thêm ảnh vào Tab 1: ${tileId.substring(0, 20)}...`, 'success');
                            btn.innerHTML = '✓';
                            btn.style.color = '#0f9d58';
                            setTimeout(() => {
                                btn.innerHTML = '+';
                                btn.style.color = '#333';
                            }, 1000);
                        }
                    }
                });
            } catch(err) {
                // Catch synchronous errors (như extension context invalidated)
                const errMsg = err.message || '';
                if (errMsg.includes('Extension context invalidated')) {
                    console.warn('[SEOSONA Flow] Extension reloaded, reloading page...');
                    location.reload();
                } else {
                    console.error('[SEOSONA Flow] addImageToGenTab error:', err);
                }
            }
        });

        tile.appendChild(btn);
    });
}
// Use MutationObserver instead of setInterval for injecting overlay buttons
// Use var for safe re-injection on extension reload
var _tileObserver = null;

/**
 * Thiết lập MutationObserver cho overlay buttons.
 * Ưu tiên observe tile container thay vì toàn body để giảm số lần fire callback
 * khi React re-render các phần khác của trang.
 * Fallback về body nếu chưa tìm thấy container, thử lại sau 3 giây.
 */
function _setupTileObserver() {
  // Ngắt observer cũ trước khi tạo mới, tránh duplicate observers
  if (_tileObserver) _tileObserver.disconnect();

  // Tìm container chứa tiles (thay vì observe toàn body)
  const firstTile = document.querySelector(_getTileSelectorString());
  const tileContainer = firstTile
    ? (firstTile.closest('[class*="grid"], [class*="Gallery"], [role="list"]')
       || firstTile.parentElement)
    : null;

  const target = tileContainer || document.body;
  _tileObserver = new MutationObserver(debounce(injectOverlayButtons, 500));
  _tileObserver.observe(target, { childList: true, subtree: true });

  // Nếu đang observe body (fallback), thử tìm lại container sau 3 giây
  if (!tileContainer) {
    setTimeout(() => _setupTileObserver(), 3000);
  }
}

_setupTileObserver();

// ============ [Layer 3] SPA navigation hook — notify projectContext khi URL change ============
// Flow là Next.js app dùng pushState/replaceState cho SPA routing → chrome.tabs.onUpdated
// đôi khi không fire (hoặc fire trễ) → sidepanel state lệch (vd modal "Select project" vẫn
// show khi URL đã ở /project/UUID). Hook history APIs để gửi projectContext realtime.
// Anti-loop: dedupe URL (chỉ fire khi location.href THẬT SỰ change từ lần trước).
// ============ [Layer 3] SPA navigation hook — notify projectContext khi URL change ============
// Hook history APIs để gửi projectContext realtime khi Flow Next.js SPA navigate.
// Fix: defer install đến sau DOMContentLoaded để tránh conflict với Next.js hydration
// (root cause bug "extension không load ở Flow homepage" — hook chạy quá sớm khi React đang
// đăng ký router của nó cũng dùng history.pushState → conflict → Flow page hang → content.js
// handlers register fail → sidebar getProjectContext không nhận response → app stuck).
// Anti-loop: dedupe URL — chỉ fire khi location.href THẬT SỰ change.
// Defer: wait 2s sau DOMContentLoaded để Next.js hydration xong → safe wrap history APIs.
function setupFlowSpaNavigateHookDeferred() {
  let _lastUrl = location.href;
  function _notifyFlowNavigate() {
    try {
      if (location.href === _lastUrl) return;  // dedupe
      _lastUrl = location.href;
      const m = location.href.match(/\/project\/([a-f0-9-]+)/);
      const projectId = m ? m[1] : null;
      // KHÔNG call extractProjectName ở đây (có thể throw nếu DOM chưa ready) — // background.js sẽ tự gọi getProjectContext lấy projectName chi tiết.
      const sendResult = chrome.runtime.sendMessage({
        action: 'projectContext',
        projectId,
        projectName: null,
        documentTitle: document.title || null,
        fromSPANavigate: true,
      });
      // Defensive: chỉ catch nếu sendMessage trả Promise (Chrome MV3)
      if (sendResult && typeof sendResult.catch === 'function') {
        sendResult.catch(function (_e) { globalThis.SEOSONA_swallow?.('content#tryAttach', _e); });
      }
    } catch (_) { /* ignore mọi lỗi để không phá Flow navigation */ }
  }
  try {
    const _origPushState = history.pushState;
    const _origReplaceState = history.replaceState;
    history.pushState = function() {
      _origPushState.apply(this, arguments);
      try { setTimeout(_notifyFlowNavigate, 50); } catch (_) { globalThis.SEOSONA_swallow?.('content#pushState', _); }
    };
    history.replaceState = function() {
      _origReplaceState.apply(this, arguments);
      try { setTimeout(_notifyFlowNavigate, 50); } catch (_) { globalThis.SEOSONA_swallow?.('content#replaceState', _); }
    };
    window.addEventListener('popstate', () => {
      try { setTimeout(_notifyFlowNavigate, 50); } catch (_) { globalThis.SEOSONA_swallow?.('content#replaceState', _); }
    });
  } catch (_) { /* ignore */ }
}

// Defer install: chờ DOM ready + 2s extra cho Next.js hydration
// → tránh conflict với React Router init.
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(setupFlowSpaNavigateHookDeferred, 2000);
} else {
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(setupFlowSpaNavigateHookDeferred, 2000);
  });
}

// ============ Flow homepage MutationObserver — detect lazy load project cards ============
// Flow homepage dùng virtual scroll: user scroll → cards mới render → notify sidebar re-scan.
// Anti-loop: debounce 1s + chỉ notify khi count THAY ĐỔI (không spam mỗi mutation).
function setupFlowHomepageObserver() {
  // Chỉ chạy khi ở homepage (no /project/ trong URL)
  if (location.pathname.match(/\/project\/[a-f0-9-]+/)) return;

  let _lastCount = 0;
  let _debounceTimer = null;
  function _notifyHomepageCountChange() {
    const count = _qa('project_link').length;
    if (count === _lastCount) return;  // dedupe
    _lastCount = count;
    try {
      const sendResult = chrome.runtime.sendMessage({
        action: 'flowHomepageProjectsChanged',
        count,
      });
      if (sendResult && typeof sendResult.catch === 'function') {
        sendResult.catch(function (_e) { globalThis.SEOSONA_swallow?.('content#start', _e); });
      }
    } catch (_) { /* ignore */ }
  }

  // Find list container (virtuoso virtual list hoặc body fallback)
  let _homepageObserver = null;
  const tryAttach = () => {
    const container = document.querySelector('[data-testid="virtuoso-item-list"]')
                   || document.querySelector('[data-testid="virtuoso-scroller"]')
                   || document.body;
    if (!container) return false;
    try {
      _homepageObserver = new MutationObserver(() => {
        // SPA navigate vào project (no full reload) → disconnect body-subtree observer để tránh leak.
        if (location.pathname.match(/\/project\/[a-f0-9-]+/)) {
          try { _homepageObserver.disconnect(); } catch (_) { globalThis.SEOSONA_swallow?.('content#tryAttach', _); }
          _homepageObserver = null;
          clearTimeout(_debounceTimer);
          return;
        }
        clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(_notifyHomepageCountChange, 1000);
      });
      _homepageObserver.observe(container, { childList: true, subtree: true });
      // Initial count
      _notifyHomepageCountChange();
      return true;
    } catch (_) { return false; }
  };

  // Retry attach mỗi 500ms tới khi container xuất hiện (max 10s)
  let attempts = 0;
  const tryInterval = setInterval(() => {
    attempts++;
    if (tryAttach() || attempts >= 20) {
      clearInterval(tryInterval);
    }
  }, 500);
}

// Defer setup giống SPA hook để tránh conflict Next.js hydration
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(setupFlowHomepageObserver, 2500);
} else {
  window.addEventListener('DOMContentLoaded', () => {
    setTimeout(setupFlowHomepageObserver, 2500);
  });
}

// Phase FAR-4 (Toast detection) đã REMOVED — risk false positive cao do scan toàn
// document body bắt match bất kỳ added node có pattern "unusual activity" / "rate limit",
// dễ trùng với prompt text user gõ (vd "Generate image of unusual activity at airport").
// Cooldown 5 phút trên false positive = 5 phút queue freeze → UX tệ.
// FAR-1/2/3/5 đã cover scenario rate-limit qua silent refresh + consecutive fail recovery
// + concurrent cap + exponential backoff → KHÔNG cần FAR-4 defense-in-depth.

} // END re-injection guard else block

// ─── Số dư tín dụng Flow (2026-07-27) ─────────────────────────────────────────
// HAI đường, đường 1 là chính:
//
//  1. NGHE LÉN API (không bấm, không gọi thêm request nào) — flow-credits-bridge.js chạy ở MAIN
//     world vá fetch/XHR, đọc ké câu trả lời của chính Flow cho GET /v1/credits. Kiểm trên trang
//     thật: Flow gọi endpoint này NGAY KHI TẢI TRANG, trình đơn tài khoản vẫn đóng ⇒ có số mà
//     người dùng không phải làm gì. Kèm luôn mã gói (sku/tier).
//
//  2. RÌNH DOM (dự phòng) — nếu Google đổi endpoint/định dạng, ta vẫn bắt được số lúc người dùng
//     tự mở trình đơn tài khoản. Không tự mở: mở được nhưng KHÔNG đóng lại được (xem
//     FlowCreditsScanner.js), để mở toang giữa mặt user thì tệ hơn là thiếu tính năng.
(function () {
  var save = function (payload) {
    try { chrome.storage.local.set({ af_flow_credits: payload }); }
    catch (_) { /* extension vừa reload → bỏ qua, lần sau bắt lại */ }
  };

  // (1) Cầu MAIN world gửi sang. Chỉ nhận message của CHÍNH cửa sổ này + đúng type,
  //     tránh nhận nhầm postMessage từ iframe hay script khác trên trang.
  window.addEventListener('message', function (ev) {
    if (ev.source !== window) return;
    var d = ev.data;
    if (!d || d.type !== 'AF_FLOW_CREDITS' || typeof d.credits !== 'number') return;
    save({
      credits: d.credits, at: Date.now(), via: 'api',
      sku: d.sku || null, paygateTier: d.paygateTier || null, serviceTier: d.serviceTier || null,
    });
  }, false);

  // (2) Dự phòng bằng DOM.
  if (!self.FlowCreditsScanner || !self.FlowCreditsScanner.watch) return;
  var start = function () {
    self.FlowCreditsScanner.watch(function (credits, raw) {
      save({ credits: credits, at: Date.now(), raw: raw, via: 'dom' });
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
