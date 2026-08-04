/**
 * Background Service Worker - SEOSONA Flow v2.0
 * Handles settings window, keyboard shortcuts, sidePanel, and cross-context communication
 */

// ─── Phase 3 / SEC (P3.T1, AUD-009) — Privileged action gate ────────────────
// Default-deny registry for runtime messages, DISABLED by default (observe-only)
// so current behavior is preserved. Enforcement is opt-in via storage key
// SEOSONA_SECURITY_ENFORCE. When enforcing, unknown actions fail closed.
// Owned suppression — nạp ĐẦU TIÊN để mọi catch im lặng phía sau có chỗ ghi nhận.
try { importScripts('src/core/ErrorCatalog.js'); } catch (_) { /* error catalog optional; suppression thành no-op */ }
try { importScripts('src/core/PrivilegedActionRegistry.js'); } catch (_) { /* registry optional; fail-open */ }
try { importScripts('src/core/SenderPolicy.js'); } catch (_) { /* sender policy optional; fail-open */ }
try { importScripts('src/core/NetworkPolicy.js'); } catch (_) { /* network policy optional */ }
try { importScripts('src/core/RuntimeNetworkGate.js'); } catch (_) { /* runtime network gate optional */ }
try { importScripts('src/core/ApiOriginPolicy.js'); } catch (_) { /* api origin policy optional */ }
try { importScripts('src/core/SecretVault.js'); } catch (_) { /* secret vault optional */ }
try { importScripts('src/core/RedactingLogger.js'); } catch (_) { /* redacting logger optional */ }
try { importScripts('src/core/RunEventCenter.js'); } catch (_) { /* run event center optional */ }
try { importScripts('src/storage/SourceImportStaging.js'); } catch (_) { /* source import staging optional */ }
try { importScripts('src/storage/WorkflowResultsStore.js'); } catch (_) { /* workflow results store optional */ }
try { importScripts('src/background/ContextMenuModel.js'); } catch (_) { /* context menu model optional */ }
try { importScripts('src/background/LifecycleCoordinator.js'); } catch (_) { /* lifecycle coordinator optional */ }
try { importScripts('src/background/NetworkService.js'); } catch (_) { /* network service optional */ }
try {
  // BẬT MẶC ĐỊNH (đổi 2026-08-02). Trước đây phải tự bật nên thực tế không ai bật.
  // Bật được là nhờ registry đã phủ 100% action có handler và có gate
  // `security:actions` giữ nó khớp bằng chứng — thêm/bớt handler mà quên đồng bộ thì
  // CI gãy trước khi tới tay người dùng, chứ không phải chặn nhầm lúc đang chạy.
  // Người dùng vẫn tắt được ở Settings → Advanced; tắt tường minh thì tôn trọng.
  chrome.storage.local.get(['SEOSONA_SECURITY_ENFORCE'], (d) => {
    if (!self.SEOSONA_PrivilegedActionRegistry) return;
    // Chỉ `=== false` mới là TẮT. undefined = chưa từng đụng tới = dùng mặc định (bật).
    const off = d && d.SEOSONA_SECURITY_ENFORCE === false;
    self.SEOSONA_PrivilegedActionRegistry.setEnforce(!off);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.SEOSONA_SECURITY_ENFORCE && self.SEOSONA_PrivilegedActionRegistry) {
      self.SEOSONA_PrivilegedActionRegistry.setEnforce(!!changes.SEOSONA_SECURITY_ENFORCE.newValue);
    }
  });
} catch (_) { /* enforcement flag optional */ }
function _seosonaMessageGate(msg, sender, external, sendResponse) {
  try {
    var reg = self.SEOSONA_PrivilegedActionRegistry;
    var enforcing = reg && reg.isEnforcing();
    function block(reason, action) {
      try { sendResponse({ ok: false, success: false, error: 'BLOCKED_BY_POLICY', reason: reason, action: action }); } catch (_) { /* channel closed */ }
      return true;
    }
    // Sender authorization (SEC-001): reject forged/foreign senders when enforcing.
    var sp = self.SEOSONA_SenderPolicy;
    if (sp) {
      var runtimeId = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) || null;
      var sd = sp.authorize(sender, { external: external, runtimeId: runtimeId });
      if (!sd.allowed && enforcing) return block(sd.reason, msg && (msg.action || msg.type));
    }
    // Action authorization (AUD-009): default-deny unknown actions when enforcing.
    if (reg) {
      var d = reg.guard(msg, sender, { external: external });
      if (d.block) return block(d.reason, d.action);
    }
  } catch (_) { /* fail-open: never break messaging on gate error */ }
  return false;
}

let settingsWindowId = null;
let workflowWindowId = null;
// 2026-05-28: window đang focus TRƯỚC khi focus grok cho Cloudflare challenge → restore sau khi
// resolved (grok:restoreFocus) để trả focus về popup workflow/sidebar thay vì kẹt ở tab grok.
let _grokFocusReturnWindowId = null;
let editingWorkflowId = null;
let templateWindowId = null;
let anglesWindowId = null;
let effectsWindowId = null;

// Track all extension popup windows for cleanup on extension reload/unload
const _extensionPopupWindows = new Set();

// Phase 3.5 Bug I: API base URL — service worker cannot import window.authManager.
// Default constant + cache from chrome.storage.local (set by sidebar after login).
// Single source of truth so changing backend domain only needs 1 edit + chrome.storage.local update.
const API_BASE_DEFAULT = 'http://localhost:8080/api/v1';
let _apiBaseUrl = API_BASE_DEFAULT;
chrome.storage.local.get(['apiBaseUrl'], (data) => {
  if (data?.apiBaseUrl) _apiBaseUrl = data.apiBaseUrl;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.apiBaseUrl?.newValue) {
    _apiBaseUrl = changes.apiBaseUrl.newValue;
  }
});
function getApiBaseUrl() { return _apiBaseUrl; }

// L8: persist transient throttle state across SW suspension via chrome.storage.session.
// Restore on startup; write on change (see _persistApiRateLimit / _persistLastCaptureTime).
try {
  chrome.storage?.session?.get(['_apiRateLimitedUntil', '_lastCaptureTime'], (d) => {
    if (d?._apiRateLimitedUntil) globalThis._apiRateLimitedUntil = d._apiRateLimitedUntil;
    if (d?._lastCaptureTime) globalThis._lastCaptureTime = d._lastCaptureTime;
  });
} catch (_) { /* owned suppression (P4.T7): silent by design */ }
function _persistApiRateLimit() {
  try { chrome.storage?.session?.set({ _apiRateLimitedUntil: globalThis._apiRateLimitedUntil }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
}
function _persistLastCaptureTime() {
  try { chrome.storage?.session?.set({ _lastCaptureTime: globalThis._lastCaptureTime }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Anti-clone: detect backend reject 403 { error: { code: 'DUMMY_FLAG' }}
// Backend VerifyExtensionId middleware reject khi runtime.id không nằm trong whitelist.
// Persist flag + broadcast → sidebar/content scripts render clone-detected overlay.
// Self-heal periodic: nếu admin update whitelist → tự clear flag không cần reload.
// ─────────────────────────────────────────────────────────────────────────────
function _isExtensionAuthRejection() { return false; }

async function _handleExtensionAuthRejection() {}

// ─────────────────────────────────────────────────────────────────────────────
// Device ban (hard-block per-device). /enroll trả DEVICE_BANNED khi (extension_id,
// device_fingerprint) bị revoke với reason hard-ban (abuse/compromised/manual).
// Khác clone-detected (whitelist extension_id). Set cờ persistent → gate MỌI
// apiRequest/_signedFetch (chặn cứng, kể cả unsigned bypass ở log_only) + broadcast
// overlay. Recovery: re-enroll thành công khi admin restore (reason → revoked_at=null).
// ─────────────────────────────────────────────────────────────────────────────
const DEVICE_BANNED_FLAG = 'seosonaflow_device_banned';
let _deviceBanned = false;
try {
  chrome.storage.local.get(DEVICE_BANNED_FLAG, (res) => { _deviceBanned = !!res?.[DEVICE_BANNED_FLAG]; });
} catch (_) { /* owned suppression (P4.T7): silent by design */ }

async function _handleDeviceBanned(reason) {
  const wasBanned = _deviceBanned;
  _deviceBanned = true;
  try {
    await new Promise(r => chrome.storage.local.set({
      [DEVICE_BANNED_FLAG]: { at: Date.now(), reason: reason || 'banned', ext_id: chrome.runtime.id },
    }, r));
    if (!wasBanned) {
      chrome.runtime.sendMessage({ type: 'DEVICE_BANNED' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#_handleDeviceBanned', _e); });
      console.error('[Enrollment] 🚫 Device banned — block ALL requests + overlay');
    }
  } catch (_) { /* owned suppression (P4.T7): silent by design */ }
}

async function _clearDeviceBanned() {
  if (!_deviceBanned) return;
  _deviceBanned = false;
  try {
    await new Promise(r => chrome.storage.local.remove(DEVICE_BANNED_FLAG, r));
    chrome.runtime.sendMessage({ type: 'DEVICE_UNBANNED' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#_clearDeviceBanned', _e); });
    console.log('[Enrollment] ✅ Device un-banned — access restored');
  } catch (_) { /* owned suppression (P4.T7): silent by design */ }
}

// Recovery: thử re-enroll khi đang banned (admin có thể đã restore). Chỉ gọi on
// focus/activation/manual — KHÔNG setInterval tight (route /enroll throttle 30/giờ).
async function _deviceBanRecoveryProbe() {
  if (!_deviceBanned) return;
  try { await _ensureEnrollment(true); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
}

// Self-heal: nếu admin thêm ID vào whitelist (hoặc tắt toggle) sau khi reject → recover tự động.
// Probe endpoint /entitlements (public, light, throttle:60, qua verify.extension_id middleware).
// Toggle OFF → 200 OK → clear flag. Toggle ON + ID mismatch → 403 DUMMY_FLAG.
async function _selfHealProbe() {
  try {
    const stored = await new Promise(resolve =>
      chrome.storage.local.get('dummy_flag', resolve));
    if (!stored?.dummy_flag) return;

    const apiBase = getApiBaseUrl();
    const r = await _signedFetch(`${apiBase}/entitlements`, {
      method: 'GET',
      headers: { 'X-Extension-Id': chrome.runtime.id, 'Accept': 'application/json' },
      cache: 'no-store',
    });

    // Re-check body marker: 200 OK = recovered, 403 DUMMY_FLAG = still rejected.
    // Treat 404/network as inconclusive (skip update flag) — đợi probe sau.
    if (r.ok) {
      await new Promise(resolve =>
        chrome.storage.local.remove('dummy_flag', resolve));
      chrome.runtime.sendMessage({ type: 'EXTENSION_AUTHORIZED' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#_selfHealProbe', _e); });
      console.log('[Auth] ✅ Extension re-authorized — flag cleared');
    } else if (r.status === 403) {
      try {
        const body = await r.clone().json();
        if (body?.error?.code === 'DUMMY_FLAG') {
          console.log('[Auth] 🛡️ Probe still rejected — flag retained');
        }
      } catch (_) { /* owned suppression (P4.T7): silent by design */ }
    }
  } catch (_) { /* network error — retry next interval */ }
}

// Clear flag + probe ngay khi extension install/update/reload (user reload từ chrome://extensions).
// Probe ngay khi background load (tránh chờ interval đầu).
_selfHealProbe();

// NOTE: onInstalled/onStartup listeners đã được consolidate vào 1 nơi duy nhất
// ở cuối file (sau _prefetchAllConfigs definition) để đảm bảo thứ tự chạy đúng:
// 1. Clear cache → 2. Prefetch configs → 3. Enrollment → 4. Inject scripts
// Xem "=== CONSOLIDATED STARTUP LISTENERS ===" section.

// L1: Periodic probe via chrome.alarms (MV3 setInterval does not survive SW suspend).
// Min alarm period is 1 minute; the alarm firing also wakes the SW, replacing the old
// dedicated `swKeepAlive` keep-alive alarm. Dispatched in chrome.alarms.onAlarm below.
chrome.alarms.create('selfHealProbe', { periodInMinutes: 1 });

// Trigger probe khi user focus tab (background tự gọi self-heal khi user thực sự dùng).
try {
  chrome.tabs.onActivated.addListener(() => { _selfHealProbe(); _deviceBanRecoveryProbe(); });
  chrome.windows.onFocusChanged?.addListener?.((id) => {
    if (id !== chrome.windows.WINDOW_ID_NONE) { _selfHealProbe(); _deviceBanRecoveryProbe(); }
  });
} catch (_) { /* owned suppression (P4.T7): silent by design */ }

// Manual retry từ sidebar/content scripts (button click trong overlay).
// Cùng button retry recover cả clone-detected lẫn device-ban.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (_seosonaMessageGate(msg, sender, false, sendResponse)) return true;
  if (msg?.type === 'EXTENSION_AUTH_RETRY' || msg?.type === 'DEVICE_BAN_RETRY') {
    Promise.all([_selfHealProbe(), _deviceBanRecoveryProbe()])
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true; // async response
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HMAC Request Signing (Sprint 2 — EXTENSION_ENROLLMENT_HMAC_PLAN.md)
//
// Mỗi extension instance enroll 1 lần với backend → nhận {client_id, secret}
// → ký mỗi outgoing request với HMAC-SHA256("{ts}:{METHOD}:{path}:{body_sha256}")
// → backend VerifySignature middleware verify (Sprint 1 log_only, Sprint 4 enforce).
//
// Storage keys:
//   seosona_client_enrollment — {client_id, secret, expires_at, device_fingerprint}
//   seosona_device_fp         — UUID persistent per install
//
// Re-enroll khi: enrollment missing | expires < 1 day | server return 403 revoke codes.
// ─────────────────────────────────────────────────────────────────────────────
const ENROLLMENT_KEY = 'seosona_client_enrollment';
const DEVICE_FP_KEY = 'seosona_device_fp';
const ENROLLMENT_REFRESH_BEFORE_EXPIRY_MS = 24 * 3600 * 1000; // refresh nếu < 1 ngày trước expire
const SIGNATURE_RETRY_CODES = new Set(['REVOKED_CLIENT', 'EXPIRED_CLIENT', 'INVALID_CLIENT']);

let _cachedEnrollment = null;
let _enrollmentPromise = null; // dedup concurrent enroll attempts

// Load cached enrollment vào memory (warm SW wake-up)
chrome.storage.local.get([ENROLLMENT_KEY], (res) => {
  if (res?.[ENROLLMENT_KEY]) _cachedEnrollment = res[ENROLLMENT_KEY];
});

// Invalidate memory cache khi storage thay đổi (multi-tab consistency)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[ENROLLMENT_KEY]) {
    _cachedEnrollment = changes[ENROLLMENT_KEY].newValue || null;
  }
});

async function _getOrCreateDeviceFingerprint() {
  const stored = await new Promise(r => chrome.storage.local.get([DEVICE_FP_KEY], r));
  if (stored[DEVICE_FP_KEY]) return stored[DEVICE_FP_KEY];
  const fp = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0')).join('');
  await new Promise(r => chrome.storage.local.set({ [DEVICE_FP_KEY]: fp }, r));
  return fp;
}

async function _getEnrollment() {
  if (_cachedEnrollment) return _cachedEnrollment;
  const stored = await new Promise(r => chrome.storage.local.get([ENROLLMENT_KEY], r));
  _cachedEnrollment = stored[ENROLLMENT_KEY] || null;
  return _cachedEnrollment;
}

function _isEnrollmentValid(e) {
  if (!e || !e.client_id || !e.secret) return false;
  if (!e.expires_at) return true; // legacy / undefined expiry → treat as valid
  const expiresAt = new Date(e.expires_at).getTime();
  return !isNaN(expiresAt) && expiresAt > Date.now() + ENROLLMENT_REFRESH_BEFORE_EXPIRY_MS;
}

async function _doEnrollment() {
  try {
    const fp = await _getOrCreateDeviceFingerprint();
    const apiBase = getApiBaseUrl();
    const extVersion = chrome.runtime.getManifest()?.version || 'unknown';

    const response = await fetch(`${apiBase}/enroll`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Extension-Id': chrome.runtime.id,
      },
      body: JSON.stringify({
        device_fingerprint: fp,
        ext_version: extVersion,
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      // 403 DEVICE_BANNED → log + abort, không retry
      if (response.status === 403) {
        try {
          const body = await response.clone().json();
          if (body?.error?.code === 'DEVICE_BANNED') {
            console.error('[Enrollment] 🚫 Device banned, abort enrollment');
            // Clear any stale enrollment để tránh dùng secret cũ
            await new Promise(r => chrome.storage.local.remove([ENROLLMENT_KEY], r));
            _cachedEnrollment = null;
            // Set cờ persistent → gate mọi request + overlay (chặn cứng, đóng unsigned bypass)
            await _handleDeviceBanned(body?.error?.message || 'banned');
            return null;
          }
          // 403 DUMMY_FLAG (whitelist miss) → bubble up đến anti-clone handler
          if (_isExtensionAuthRejection(body, 403)) {
            _handleExtensionAuthRejection();
            return null;
          }
        } catch (_) { /* owned suppression (P4.T7): silent by design */ }
      }
      console.warn('[Enrollment] Failed HTTP', response.status);
      return null;
    }

    const json = await response.json();
    if (!json.success || !json.data?.client_id || !json.data?.secret) {
      console.warn('[Enrollment] Invalid response shape', json);
      return null;
    }

    const enrollment = {
      client_id: json.data.client_id,
      secret: json.data.secret,
      expires_at: json.data.expires_at,
      device_fingerprint: fp,
    };

    await new Promise(r => chrome.storage.local.set({ [ENROLLMENT_KEY]: enrollment }, r));
    _cachedEnrollment = enrollment;
    console.log('[Enrollment] ✅ Enrolled successfully:', enrollment.client_id);
    // Re-enroll thành công = device không còn banned (admin đã restore) → gỡ cờ + overlay
    await _clearDeviceBanned();
    return enrollment;
  } catch (e) {
    console.warn('[Enrollment] Network error:', e.message);
    return null;
  }
}

async function _ensureEnrollment(force = false) {
  // Reuse pending attempt nếu đang enroll (chống race khi multiple apiRequest concurrent)
  if (_enrollmentPromise) return _enrollmentPromise;

  if (!force) {
    const existing = await _getEnrollment();
    if (_isEnrollmentValid(existing)) return existing;
  }

  _enrollmentPromise = _doEnrollment();
  try {
    return await _enrollmentPromise;
  } finally {
    _enrollmentPromise = null;
  }
}

async function _sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text || ''));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Build HMAC signature headers cho outgoing API request.
 * @param {string} method - 'GET', 'POST', ...
 * @param {string} path - URL pathname (vd '/api/v1/entitlements')
 * @param {string} body - request body (JSON string hoặc empty)
 * @returns {Promise<Object>} headers object (rỗng nếu chưa enroll)
 */
async function _buildSignatureHeaders(method, path, body = '') {
  const enrollment = await _getEnrollment();
  if (!enrollment || !enrollment.secret || !enrollment.client_id) return {};

  const timestamp = Math.floor(Date.now() / 1000);
  const bodyHash = await _sha256Hex(body || '');
  const normalizedPath = '/' + String(path || '').replace(/^\/+/, '');
  const message = `${timestamp}:${String(method || 'GET').toUpperCase()}:${normalizedPath}:${bodyHash}`;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(enrollment.secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const sig = Array.from(new Uint8Array(sigBytes))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return {
    'X-Client-Id': enrollment.client_id,
    'X-Timestamp': String(timestamp),
    'X-Signature': sig,
  };
}

async function _clearEnrollment() {
  _cachedEnrollment = null;
  await new Promise(r => chrome.storage.local.remove([ENROLLMENT_KEY], r));
}

/**
 * fetch wrapper inject HMAC signature headers cho direct fetch() calls
 * (ngoài apiRequest handler). Dùng cho _selfHealProbe, _fetchProviderConfigs,
 * _fetchApiConfigs, selector-failure analytics, system-config/execution.
 *
 * Skip auto-sign nếu url là /enroll (chicken-and-egg) hoặc options.body là FormData.
 */
async function _signedFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const method = (options.method || 'GET').toUpperCase();
  const isEnroll = typeof url === 'string' && /\/enroll(\?|$)/.test(url);
  // Device banned → chặn cứng (trừ /enroll để recovery). Trả 403 synthetic, không gửi request.
  if (_deviceBanned && !isEnroll) {
    return new Response(
      JSON.stringify({ success: false, error: { code: 'DEVICE_BANNED', message: 'Device banned' } }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }
    );
  }
  const bodyIsString = typeof options.body === 'string';
  if (!isEnroll && (!options.body || bodyIsString)) {
    try {
      const pathForSig = new URL(url).pathname;
      const bodyStr = bodyIsString ? options.body : '';
      const sigHeaders = await _buildSignatureHeaders(method, pathForSig, bodyStr);
      Object.assign(headers, sigHeaders);
    } catch (_) { /* signing optional — fail silent in log_only mode */ }
  }
  return fetch(url, { ...options, headers });
}

// Trigger enrollment lúc SW wake (fire-and-forget, nếu enrollment valid sẽ no-op).
// NOTE: onInstalled/onStartup enrollment đã move vào consolidated listeners cuối file.
_ensureEnrollment().catch(function (_e) { globalThis.SEOSONA_swallow?.('background#_signedFetch', _e); });

// Phase 3.5 Bug D: Bootstrap URLs minimized — chỉ giữ keys thực sự được access early-boot.
// Service worker context cannot import PCM. Sidebar push server cache vào chrome.storage.session
// → getProviderUrl() prefers server cache (line 70-90). PROVIDER_URLS = last-resort bootstrap.
// Keys dropped vs prev version: chatgpt.base, gemini.base, grok.saved, grok.base, grok.cdnPatterns.
// Removed keys vẫn available via _serverUrlsCache (sidebar sync) hoặc admin Providers config.
const PROVIDER_URLS = {
  flow: {
    tabQuery: 'https://labs.google/fx/*',
    createUrl: 'https://labs.google/fx/tools/flow',
    localeCreate: 'https://labs.google/fx/vi/tools/flow',
    base: 'https://labs.google/fx',
  },
  chatgpt: {
    tabQuery: '*://chatgpt.com/*',
    createUrl: 'https://chatgpt.com/',
  },
  grok: {
    tabQuery: '*://grok.com/*',
    tabQueryPatterns: ['*://grok.com/*', 'https://x.com/i/grok*'],
    createUrl: 'https://grok.com/',
    imagine: 'https://grok.com/imagine',
  },
  gemini: {
    tabQuery: '*://gemini.google.com/*',
    createUrl: 'https://gemini.google.com/app',
  },
  // Claude: handlers injectScript/checkLogin là stub "ready". Thêm URL để findOrCreateTab
  // không crash (Cannot read 'tabQuery' of undefined). Automation Claude là WIP.
  claude: {
    tabQuery: '*://claude.ai/*',
    createUrl: 'https://claude.ai/',
  },
};

// Phase 3: Cache URLs từ server (populated by sidebar qua message 'updateProviderUrlsCache')
let _serverUrlsCache = null;

/**
 * Phase 3: Get provider URL - check server cache first, fallback to bootstrap.
 * @param {string} provider - 'flow' | 'chatgpt' | 'grok' | 'gemini'
 * @param {string} key - 'tabQuery' | 'createUrl' | 'base' | etc.
 * @returns {string|string[]|null}
 */
function getProviderUrl(provider, key) {
  // 1. Server cache (camelCase key)
  if (_serverUrlsCache?.[provider]?.[key]) {
    return _serverUrlsCache[provider][key];
  }
  // 2. Server cache (snake_case key - backend format)
  const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
  if (_serverUrlsCache?.[provider]?.[snakeKey]) {
    return _serverUrlsCache[provider][snakeKey];
  }
  // 3. Bootstrap fallback
  return PROVIDER_URLS[provider]?.[key] || null;
}

// Load server URLs cache từ session storage (nếu sidebar đã populate)
chrome.storage?.session?.get(['_provider_urls_cache'], (result) => {
  if (result?._provider_urls_cache) {
    _serverUrlsCache = result._provider_urls_cache;
    console.log('[Background] Loaded server URLs cache from session storage');
  }
});

// Restore window IDs from session storage (survives SW hibernation)
chrome.storage?.session?.get([
  '_settingsWindowId',
  '_workflowWindowId',
  '_editingWorkflowId',
  '_templateWindowId',
  '_anglesWindowId',
  '_effectsWindowId',
], (result) => {
  if (result?._settingsWindowId) {
    settingsWindowId = result._settingsWindowId;
    _extensionPopupWindows.add(result._settingsWindowId);
  }
  if (result?._workflowWindowId) {
    workflowWindowId = result._workflowWindowId;
    _extensionPopupWindows.add(result._workflowWindowId);
  }
  if (result?._editingWorkflowId) {
    editingWorkflowId = result._editingWorkflowId;
  }
  if (result?._templateWindowId) {
    templateWindowId = result._templateWindowId;
    _extensionPopupWindows.add(result._templateWindowId);
  }
  if (result?._anglesWindowId) {
    anglesWindowId = result._anglesWindowId;
    _extensionPopupWindows.add(result._anglesWindowId);
  }
  if (result?._effectsWindowId) {
    effectsWindowId = result._effectsWindowId;
    _extensionPopupWindows.add(result._effectsWindowId);
  }
});

// Lock flag to prevent race condition when opening settings window
let _settingsWindowOpening = false;

/** Persist popup window IDs to session storage (survives SW hibernation) */
function _persistWindowIds() {
  chrome.storage?.session?.set({
    _settingsWindowId: settingsWindowId,
    _workflowWindowId: workflowWindowId,
    _editingWorkflowId: editingWorkflowId,
    _templateWindowId: templateWindowId,
    _anglesWindowId: anglesWindowId,
    _effectsWindowId: effectsWindowId,
  }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#_persistWindowIds', _e); });
}

// Close all extension popup windows (called on extension suspend/reload)
async function _closeAllExtensionPopups() {
  const windowIds = [..._extensionPopupWindows];
  for (const windowId of windowIds) {
    try {
      await chrome.windows.remove(windowId);
    } catch (e) {
      // Window may already be closed
    }
  }
  _extensionPopupWindows.clear();
  settingsWindowId = null;
  workflowWindowId = null;
  editingWorkflowId = null;
  templateWindowId = null;
  anglesWindowId = null;
  effectsWindowId = null;
  _persistWindowIds();
}

// Close popup windows when extension is about to be suspended/reloaded
chrome.runtime.onSuspend.addListener(() => {
  console.log('[Background] Extension suspending, closing popup windows...');
  _closeAllExtensionPopups();
});

// Phase 3.5 Bug C.5: Release execution token khi service worker suspend.
// Best-effort fetch với keepalive=true để Chrome cho phép complete request sau khi SW chết.
// Cron `execution:cleanup` (every 10 min) là safety net cho case này fail.
chrome.runtime.onSuspend.addListener(() => {
  try {
    chrome.storage.local.get(['af_running_workflow'], (data) => {
      const execId = data?.af_running_workflow?.execution_id;
      if (!execId) return;
      // keepalive=true: cho phép fetch complete dù SW bị kill
      fetch(`${getApiBaseUrl()}/executions/${execId}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Extension-Id': chrome.runtime.id,
        },
        body: JSON.stringify({ status: 'stopped', summary: { reason: 'sw_suspend' } }),
        keepalive: true,
        credentials: 'include',
      }).catch(() => { /* best effort - cron cleanup is safety net */ });
      console.log('[Background] onSuspend: released execution token', execId);
    });
  } catch (_) { /* ignore */ }
});

/**
 * Open or activate an existing tab matching the URL pattern
 * @param {string} urlPattern - URL pattern to search for existing tabs (e.g., 'https://chatgpt.com/*')
 * @param {string} createUrl - URL to create if no existing tab found
 * @param {boolean} activate - Whether to activate/focus the tab (default: true)
 * @returns {Promise<chrome.tabs.Tab>} - The existing or newly created tab
 */
async function openOrActivateTab(urlPattern, createUrl, activate = true) {
  try {
    // Search for existing tabs matching the pattern
    const existingTabs = await chrome.tabs.query({ url: urlPattern });

    if (existingTabs.length > 0) {
      // Tab exists - activate it
      const tab = existingTabs[0];
      if (activate) {
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      console.log(`[SEOSONA Flow] Activated existing tab: ${tab.url?.substring(0, 50)}`);
      return tab;
    } else {
      // No existing tab - create new one
      const newTab = await chrome.tabs.create({ url: createUrl, active: activate });
      console.log(`[SEOSONA Flow] Created new tab: ${createUrl}`);
      return newTab;
    }
  } catch (err) {
    console.error('[SEOSONA Flow] openOrActivateTab error:', err);
    // Fallback: just create new tab
    return await chrome.tabs.create({ url: createUrl, active: activate });
  }
}

// H5 SSRF hardening: reject loopback, link-local (incl. cloud metadata 169.254.169.254),
// RFC1918 private ranges, IPv6 loopback/unique-local, and any non-http(s) scheme.
// Provider CDN/storage hosts (storage.googleapis.com, flow-content.google, etc.) resolve to
// public IPs and remain allowed. Used to gate every message-driven fetch.
function _isAllowedUrl(url) {
  try {
    const u = new URL(url);
    // Only http(s) — block file:, data:, ftp:, gopher:, etc.
    if (!['https:', 'http:'].includes(u.protocol)) return false;

    let host = (u.hostname || '').toLowerCase();
    if (!host) return false;
    // Strip IPv6 brackets if present
    if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

    // Hostname-based blocks
    if (['localhost', '0.0.0.0'].includes(host)) return false;
    if (host.endsWith('.local') || host.endsWith('.localhost')) return false;

    // IPv6 loopback + unique-local (fc00::/7 → fc.. or fd..) + link-local (fe80::/10)
    if (host === '::1' || host === '::') return false;
    if (/^f[cd][0-9a-f]{0,2}:/i.test(host)) return false; // fc00::/7 unique-local
    if (/^fe[89ab][0-9a-f]:/i.test(host)) return false;   // fe80::/10 link-local

    // IPv4 dotted-quad private / loopback / link-local checks
    const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) {
      const a = +m[1], b = +m[2];
      if ([a, +m[2], +m[3], +m[4]].some(n => n > 255)) return false;
      if (a === 127) return false;                    // 127.0.0.0/8 loopback
      if (a === 10) return false;                     // 10.0.0.0/8
      if (a === 169 && b === 254) return false;       // 169.254.0.0/16 link-local (cloud metadata)
      if (a === 172 && b >= 16 && b <= 31) return false; // 172.16.0.0/12
      if (a === 192 && b === 168) return false;       // 192.168.0.0/16
      if (a === 0) return false;                      // 0.0.0.0/8
    }

    return true;
  } catch { return false; }
}

// M2: defense-in-depth sender guard. Every privileged handler runs from either an
// extension page (sidebar/popup — sender.id === runtime.id, no sender.tab) or one of our
// own content scripts injected on http(s) pages (sender.id === runtime.id + sender.tab.url
// is http/https). Reject anything else (e.g. an unexpected external sender). This does not
// break internal extension-page messaging because those still carry our runtime id.
function _isTrustedSender(sender) {
  try {
    if (!sender || sender.id !== chrome.runtime.id) return false;
    // Extension-page message (no tab) → trusted.
    if (!sender.tab) return true;
    // Content-script message → require an http(s) tab URL.
    const scheme = new URL(sender.url || sender.tab.url || '').protocol;
    return scheme === 'http:' || scheme === 'https:';
  } catch { return false; }
}

/**
 * Tính vị trí popup window: kế bên trái sidebar
 * Sidebar nằm bên phải, rộng ~600px → popup đặt sát trái sidebar
 * @param {number} popupWidth - Chiều rộng popup
 * @param {number} popupHeight - Chiều cao popup
 * @returns {{ left: number, top: number }}
 */
async function _calcWindowPosition(popupWidth, popupHeight) {
  try {
    const currentWin = await chrome.windows.getCurrent();
    const winLeft = currentWin.left || 0;
    const winTop = currentWin.top || 0;
    const winWidth = currentWin.width || 1440;
    const winHeight = currentWin.height || 900;

    const sidebarWidth = 600;
    // Popup nằm kế bên trái sidebar: right edge of popup = left edge of sidebar
    const sidebarLeft = winLeft + winWidth - sidebarWidth;
    let left = sidebarLeft - popupWidth;

    // Nếu popup bị tràn ra ngoài bên trái màn hình → đặt tại winLeft
    if (left < winLeft) left = winLeft;

    // Canh giữa theo chiều dọc trong browser window
    let top = winTop + Math.round((winHeight - popupHeight) / 2);
    if (top < winTop) top = winTop;

    return { left, top };
  } catch (e) {
    // Fallback nếu không lấy được window info
    return { left: 100, top: 100 };
  }
}

// M3: sanitize each path segment of a download folder/filename before building the target
// path. Strips `..`, leading slashes/backslashes, drive letters (C:), and control chars, and
// collapses repeated separators. Chrome blocks the most basic `..` but nested/leading-path/
// control-char segments from untrusted folder/filename must be cleaned to prevent traversal.
function _sanitizePathSegment(seg) {
  if (typeof seg !== 'string') return '';
  return seg
    .replace(/[\x00-\x1f\x7f]/g, '')     // control chars
    .replace(/^[a-zA-Z]:/, '')           // drive letter (C:)
    .replace(/\\/g, '/')                 // normalize backslashes to forward slashes
    .split('/')
    .map(p => p.trim())
    .filter(p => p && p !== '.' && p !== '..')  // drop empty, '.' and '..' segments
    .join('/');
}

// === Download Rename System ===
// Khi Flow native download xảy ra, extension can thiệp đổi tên file + folder
// content.js gọi 'prepareDownloadRename' trước khi trigger Flow menu
// FIFO queue: hỗ trợ nhiều downloads liên tiếp (2+ hình submit cùng lúc)
let _pendingDownloadRenames = []; // [{ folder, filename, expires }]

// Bug fix 2026-06-04: Persist `_pendingDownloadRenames` qua `chrome.storage.session` để
// survive MV3 SW hibernation. Trước fix: SW hibernate sau 30s idle → array reset → entries
// chưa match (delay > 30s giữa prepareDownloadRename và actual download) bị mất → file
// download vào ~/Downloads/ default với filename gốc Flow. User báo "chỉ download 10 cuối"
// — thực tế files vẫn download nhưng nằm sai folder, user không thấy ở subfolder workflow.
// Pattern dùng `chrome.storage.session` (in-memory persist qua SW restart, clear khi
// extension/tab close) đã proven trong code khác (line ~1908 af_execution_event_queue).
const _PERSIST_KEY_RENAMES = 'af_pending_download_renames';
function _persistPendingRenames() {
  try { chrome.storage?.session?.set({ [_PERSIST_KEY_RENAMES]: _pendingDownloadRenames }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
}
async function _restorePendingRenames() {
  try {
    const res = await new Promise((resolve) => {
      chrome.storage?.session?.get([_PERSIST_KEY_RENAMES], (r) => resolve(r || {}));
    });
    const saved = res?.[_PERSIST_KEY_RENAMES];
    if (Array.isArray(saved)) {
      const now = Date.now();
      _pendingDownloadRenames = saved.filter(r => r && typeof r.expires === 'number' && now <= r.expires);
      if (_pendingDownloadRenames.length > 0) {
        console.log(`[SEOSONA Flow] _restorePendingRenames: ${_pendingDownloadRenames.length} entries restored from session`);
      }
    }
  } catch (_) { /* best-effort */ }
}
// Restore ngay khi SW boot (top-level — chạy mỗi lần SW init)
_restorePendingRenames();

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  // ============================================================
  // GIẢI PHÁP CHÍNH: Check byExtensionId TRƯỚC TIÊN
  // Nếu download do extension KHÁC initiate → skip ngay, KHÔNG gọi suggest()
  // Điều này tránh conflict với extension automation khác cùng loại (đa-extension cùng cài)
  // ============================================================
  const initiatorExtId = downloadItem.byExtensionId;
  if (initiatorExtId && initiatorExtId !== chrome.runtime.id) {
    // Download do extension khác initiate → để extension đó xử lý
    console.log(`[SEOSONA Flow] onDeterminingFilename: initiated by different extension (${initiatorExtId}), skip`);
    return;
  }

  // Dọn entries hết hạn
  const now = Date.now();
  const beforeFilter = _pendingDownloadRenames.length;
  _pendingDownloadRenames = _pendingDownloadRenames.filter(r => now <= r.expires);
  if (_pendingDownloadRenames.length !== beforeFilter) _persistPendingRenames();

  // Không có pending rename nào → skip
  if (_pendingDownloadRenames.length === 0) {
    console.log(`[SEOSONA Flow] onDeterminingFilename: no pending renames, skip. file="${downloadItem.filename}"`);
    return;
  }

  const url = downloadItem.url || '';
  const referrer = downloadItem.referrer || '';
  const filename = downloadItem.filename || '';
  const mime = downloadItem.mime || '';

  // Nếu download do extension này initiate (byExtensionId === chrome.runtime.id)
  // → xử lý ngay với pending rename
  if (initiatorExtId === chrome.runtime.id) {
    // Tìm rename entry phù hợp nhất
    let renameIdx = 0;
    const urlUuidMatch = url.match(/name=([a-f0-9-]{36})/i);
    if (urlUuidMatch) {
      const urlUuid = urlUuidMatch[1];
      const matchIdx = _pendingDownloadRenames.findIndex(r =>
        r.identifier && (r.identifier.includes(urlUuid) || urlUuid.includes(r.identifier))
      );
      if (matchIdx >= 0) renameIdx = matchIdx;
    } else {
      // [AUDIT-3b] Khớp theo TIỀN TỐ URL (additive, entry cũ không có urlPrefix → không đổi hành vi).
      // Cần vì hàng đợi DÙNG CHUNG: save-as chuột phải (data: URL) và download workflow có thể cùng
      // pending → lấy index 0 sẽ tráo tên của nhau. Entry i2p gắn urlPrefix='data:image/...'.
      const pIdx = _pendingDownloadRenames.findIndex(r => r.urlPrefix && url.startsWith(r.urlPrefix));
      if (pIdx >= 0) renameIdx = pIdx;
      else {
        // Ngược lại: download KHÔNG phải data: → bỏ qua các entry i2p (tránh chúng bị "ăn" nhầm).
        const nonI2p = _pendingDownloadRenames.findIndex(r => !r.urlPrefix);
        if (nonI2p >= 0) renameIdx = nonI2p;
      }
    }
    const rename = _pendingDownloadRenames.splice(renameIdx, 1)[0];
    _persistPendingRenames();
    const origExt = downloadItem.filename?.split('.').pop() || 'png';
    const rawName = rename.filename.includes('.') ? rename.filename : `${rename.filename}.${origExt}`;
    const customName = _sanitizePathSegment(rawName) || 'download';
    const safeFolder = _sanitizePathSegment(rename.folder || '');
    const fullPath = safeFolder ? `${safeFolder}/${customName}` : customName;
    console.log(`[SEOSONA Flow] Download rename (own extension): ${downloadItem.filename} → ${fullPath}`);
    suggest({ filename: fullPath, conflictAction: 'uniquify' });
    return;
  }

  // ============================================================
  // Từ đây: byExtensionId = undefined (download từ browser/user, ví dụ Flow context menu)
  // Chỉ xử lý nếu download từ Google Flow page
  // ============================================================

  // Skip nếu referrer là từ Grok
  if (referrer.includes('grok.com') || referrer.includes('x.com')) {
    console.log(`[SEOSONA Flow] onDeterminingFilename: referrer is Grok/X, skip`);
    return;
  }

  // Skip nếu URL có vẻ là từ Grok
  const looksLikeGrokUrl = url.includes('grok.com') ||
    url.includes('imagine-public.x.ai') ||
    url.includes('assets.grok') ||
    url.includes('video.grok');
  if (looksLikeGrokUrl) {
    console.log(`[SEOSONA Flow] onDeterminingFilename: URL looks like Grok, skip`);
    return;
  }

  // Check nếu download từ Google Flow
  const hasFlowReferrer = referrer.includes('labs.google');
  const hasFlowUrl = url.includes('labs.google') || url.includes('getMediaUrlRedirect');

  // Video downloads
  const isVideoDownload = mime.startsWith('video/') ||
    filename.endsWith('.mp4') ||
    filename.endsWith('.webm') ||
    filename.endsWith('.mov');

  // Xác định có phải Flow download không
  const isFlowDownload = hasFlowReferrer || hasFlowUrl ||
    ((url.includes('googleusercontent.com') || url.includes('storage.googleapis.com') || url.includes('googlevideo.com')) && hasFlowReferrer) ||
    (url.startsWith('blob:') && hasFlowReferrer) ||
    (isVideoDownload && hasFlowReferrer);

  if (!isFlowDownload) {
    console.log(`[SEOSONA Flow] onDeterminingFilename: not from Flow page, skip`);
    return;
  }

  // Tìm rename entry phù hợp nhất
  let renameIdx = 0;
  const urlUuidMatch = url.match(/name=([a-f0-9-]{36})/i);
  if (urlUuidMatch) {
    const urlUuid = urlUuidMatch[1];
    const matchIdx = _pendingDownloadRenames.findIndex(r =>
      r.identifier && (r.identifier.includes(urlUuid) || urlUuid.includes(r.identifier))
    );
    if (matchIdx >= 0) renameIdx = matchIdx;
  }

  const rename = _pendingDownloadRenames.splice(renameIdx, 1)[0];
  _persistPendingRenames();
  // Đuôi file phải đọc từ TÊN ĐÃ CẮT query/fragment. Bản cũ làm `filename.split('.').pop()`
  // trên chuỗi thô, nên "media.html?x=1" ra đuôi "html?x=1" — không khớp phép so sánh
  // === 'html' bên dưới, thế là lớp chặn HTML nằm im và file vẫn rơi ra .htm.
  const _cleanName = String(downloadItem.filename || '').split(/[?#]/)[0];
  const _dot = _cleanName.lastIndexOf('.');
  let origExt = (_dot >= 0 ? _cleanName.slice(_dot + 1) : '').toLowerCase();

  // Chỉ chấp nhận đuôi media đã biết. Bất kỳ thứ gì khác (html, htm, chuỗi rác, rỗng) đều coi
  // là "không biết" rồi suy lại từ mime — chặn theo danh sách CHO PHÉP thay vì đuổi bắt từng
  // biến thể của cái sai.
  const MEDIA_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm', 'mov', 'm4v'];
  if (!MEDIA_EXTS.includes(origExt)) {
    const before = origExt || '(rỗng)';
    if (mime.startsWith('video/') || isVideoDownload) {
      origExt = 'mp4';
    } else if (mime.startsWith('image/')) {
      origExt = mime === 'image/jpeg' ? 'jpg' : (mime.split('/')[1] || 'png');
    } else {
      origExt = 'png'; // safe default cho Flow image
    }
    console.warn(`[SEOSONA Flow] Download rename: đuôi lạ "${before}" (filename="${downloadItem.filename}", mime="${mime}") → ép về "${origExt}"`);
  }
  // Tên do ta dựng có thể chứa dấu chấm trong chữ prompt; chỉ coi là "đã có đuôi" khi phần
  // sau dấu chấm cuối đúng là một đuôi media. Bản cũ dùng includes('.') nên prompt kiểu
  // "logo 2.0" làm mất bước gắn đuôi và Chrome tự đặt .htm.
  const _rDot = rename.filename.lastIndexOf('.');
  const _rExt = _rDot >= 0 ? rename.filename.slice(_rDot + 1).toLowerCase() : '';
  const rawName2 = MEDIA_EXTS.includes(_rExt) ? rename.filename : `${rename.filename}.${origExt}`;
  const customName = _sanitizePathSegment(rawName2) || 'download';
  const safeFolder2 = _sanitizePathSegment(rename.folder || '');
  const fullPath = safeFolder2 ? `${safeFolder2}/${customName}` : customName;

  console.log(`[SEOSONA Flow] Download rename: ${downloadItem.filename} → ${fullPath}`);

  // ── Chặn để XOÁ WATERMARK trước khi file chạm đĩa ──────────────────────────
  // Video Flow tải về qua blob: URL do CHÍNH TRANG dựng, nên service worker không đọc được
  // bytes. Đường duy nhất là nhờ tab đó xử lý hộ.
  //
  // Thứ tự ở đây là chỗ dễ mất file nhất nên phải nói rõ: KHÔNG huỷ trước rồi mới nhờ. Hoãn
  // suggest() (Chrome cho phép trả true rồi gọi sau) → nhờ tab NẮM bytes → tab báo đã cầm
  // chắc → lúc đó mới huỷ. Tab không trả lời trong 8 giây thì để download gốc chạy bình
  // thường, người dùng vẫn có file — chỉ là còn watermark.
  if (isVideoDownload && !rename.wmDone && rename.tabId != null) {
    _shouldAutoRemoveWm().then((on) => {
      if (!on) { suggest({ filename: fullPath, conflictAction: 'uniquify' }); return; }
      let settled = false;
      const passThrough = (why) => {
        if (settled) return; settled = true;
        console.log(`[SEOSONA Flow] auto-WM: bỏ qua (${why}) → tải bản gốc`);
        suggest({ filename: fullPath, conflictAction: 'uniquify' });
      };
      const timer = setTimeout(() => passThrough('TAB_KHÔNG_TRẢ_LỜI'), 8000);
      try {
        chrome.tabs.sendMessage(rename.tabId, {
          action: 'wm:autoProcess', url, filename: customName, folder: safeFolder2,
        }, (resp) => {
          if (settled) return;
          clearTimeout(timer);
          if (chrome.runtime.lastError || !resp?.ok) { passThrough(chrome.runtime.lastError?.message || resp?.error || 'TAB_TỪ_CHỐI'); return; }
          settled = true;
          // Tab đã cầm bytes → huỷ bản còn watermark. Tab sẽ tự tải bản sạch xuống.
          suggest({ filename: fullPath + '.seosona-tmp', conflictAction: 'uniquify' });
          try {
            chrome.downloads.cancel(downloadItem.id, () => {
              void chrome.runtime.lastError;
              chrome.downloads.erase({ id: downloadItem.id }, () => { void chrome.runtime.lastError; });
            });
          } catch (e) { console.warn('[SEOSONA Flow] auto-WM: huỷ download lỗi', e); }
        });
      } catch (e) { clearTimeout(timer); passThrough(e?.message || 'GỬI_LỖI'); }
    });
    return true;   // suggest() gọi bất đồng bộ
  }

  suggest({ filename: fullPath, conflictAction: 'uniquify' });
});

/** Công tắc tự xoá watermark video. Thiếu key = BẬT (`=== false` chứ không `!== true`). */
function _shouldAutoRemoveWm() {
  return new Promise((res) => {
    try {
      chrome.storage.local.get(['af_settings'], (d) => {
        void chrome.runtime.lastError;
        res(d?.af_settings?.autoRemoveVideoWatermark !== false);
      });
    } catch (_e) { res(false); }
  });
}

// Note: Đã remove chrome.alarms + port keep-alive sau khi xác định root cause thực sự là
// Chrome HTTP cache (fix bằng cache: 'no-store' trong apiRequest handler). SW lifecycle
// không phải nguyên nhân bug login/logout refresh quyền.
//
// UPDATE: Restore lightweight SW keep-alive sau khi user báo "Failed to fetch" liên tục
// khi mở tab Workflow / Tasks. Root cause: Chrome MV3 SW idle timeout ~30s khi không có
// event nào → fetch() trong handler fail vì SW bị suspend giữa chừng.
// L1: Removed the dedicated `swKeepAlive` alarm — the `selfHealProbe` periodic alarm (1 min)
// already wakes the SW on each fire, so a separate no-op keep-alive is redundant. Relying on
// a permanent keep-alive masks real suspend bugs; the alarm-driven probe is the correct pattern.

// Note: Đã remove bgFetchEntitlements + persistent logger sau khi xác định root cause
// là Chrome HTTP cache. SidePanel tự fetch entitlements qua apiRequest handler đã đủ
// (bây giờ fetch options có cache: 'no-store' để bypass cache stale).

// === Phase FAR-1: Silent session refresh ===
// Mục tiêu: Refresh OAuth bearer token định kỳ qua Next.js soft-navigation
// để tránh user phải F5 manual khi Flow gen fail. Plan: docs/plans/flow-auto-retry-plan.md
//
// Phase 2c: FAR settings now server-controlled via /api/v1/system-config/execution
// Background SW fetches from server (fallback to defaults).
//
// Settings (server system_settings.group='execution'):
//   - flow_session_refresh_enabled (bool, default false)
//   - flow_session_refresh_interval_min (int, 5-120, default 120)

// Phase 2c Test: Enable verbose logging
const _FAR_DEBUG = true;

// Cache cho execution config (background SW không có access đến ExecutionConfig class)
let _executionConfigCache = null;
let _executionConfigCacheTime = 0;
const _EXECUTION_CONFIG_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function _fetchExecutionConfig() {
  try {
    // Check in-memory cache
    if (_executionConfigCache && Date.now() - _executionConfigCacheTime < _EXECUTION_CONFIG_CACHE_TTL_MS) {
      if (_FAR_DEBUG) console.log('[background] Using cached execution config');
      return _executionConfigCache;
    }

    // PERF FIX (2026-05-17): Đọc chrome.storage.local.af_execution_config TRƯỚC HTTP fetch.
    // Sidebar ExecutionConfig (sidebar context) đã ghi storage này sau khi fetch — background
    // có thể reuse thay vì fetch riêng. Giảm duplicate request lên VPS server (1.9GB RAM).
    try {
      const stored = await new Promise(resolve => {
        chrome.storage.local.get(['af_execution_config'], res => resolve(res?.af_execution_config));
      });
      if (stored && typeof stored === 'object' && (stored.workflow || stored.flow_recovery)) {
        _executionConfigCache = stored;
        _executionConfigCacheTime = Date.now();
        if (_FAR_DEBUG) console.log('[background] Execution config from chrome.storage (sidebar preload), SKIP HTTP fetch');
        return _executionConfigCache;
      }
    } catch (_) { /* storage read failed — fall through to HTTP */ }

    if (_FAR_DEBUG) console.log('[background] Fetching execution config from server...');
    const response = await _signedFetch(`${getApiBaseUrl()}/system-config/execution`, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'X-Extension-Id': chrome.runtime.id },
    });
    if (response.status === 403) {
      try {
        const body = await response.clone().json();
        if (_isExtensionAuthRejection(body, 403)) _handleExtensionAuthRejection();
      } catch (_) { /* owned suppression (P4.T7): silent by design */ }
    }

    if (!response.ok) {
      if (_FAR_DEBUG) console.warn('[background] Server returned non-OK:', response.status);
      return _executionConfigCache || {};
    }

    const json = await response.json();
    if (json.success && json.data) {
      _executionConfigCache = json.data;
      _executionConfigCacheTime = Date.now();
      // PERF FIX: write storage để sidebar ExecutionConfig.fetch reuse thay vì fetch HTTP riêng.
      try { chrome.storage.local.set({ af_execution_config: json.data }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
      if (_FAR_DEBUG) {
        console.log('[background] ✓ Execution config loaded from server:');
        console.log('  flow_recovery:', JSON.stringify(json.data.flow_recovery || {}));
      }
      return _executionConfigCache;
    }
    return _executionConfigCache || {};
  } catch (e) {
    console.warn('[background] _fetchExecutionConfig error:', e.message);
    return _executionConfigCache || {};
  }
}

async function rescheduleFlowSessionAlarm() {
  try {
    const config = await _fetchExecutionConfig();
    const farConfig = config.flow_recovery || {};

    if (_FAR_DEBUG) {
      console.log('[background] FAR config:');
      console.log('  session_refresh_enabled:', farConfig.session_refresh_enabled);
      console.log('  session_refresh_interval_min:', farConfig.session_refresh_interval_min);
    }

    // Server-controlled: session_refresh_enabled (default false)
    if (farConfig.session_refresh_enabled !== true) {
      chrome.alarms.clear('flowSessionRefresh');
      console.log('[SEOSONA Flow] ✓ Flow session refresh DISABLED (server config)');
      return;
    }

    // Server-controlled: session_refresh_interval_min (default 120)
    const intervalMin = parseInt(farConfig.session_refresh_interval_min || 120, 10);
    // Clamp 5-120 (match validation rule)
    const clampedMin = Math.max(5, Math.min(120, intervalMin));
    chrome.alarms.create('flowSessionRefresh', { periodInMinutes: clampedMin });
    console.log('[SEOSONA Flow] ✓ Flow session refresh ENABLED, interval:', clampedMin, 'min');
  } catch (e) {
    console.warn('[SEOSONA Flow] rescheduleFlowSessionAlarm error:', e.message);
  }
}

// Init alarm khi background SW start
rescheduleFlowSessionAlarm();

// Phase 2c: Listen for SSE updates via sidebar → storage bridge
// Sidebar receives SSE system_settings_changed → updates af_execution_config cache
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // Re-schedule khi execution config cache changes
  if (changes.af_execution_config) {
    _executionConfigCache = changes.af_execution_config.newValue;
    _executionConfigCacheTime = Date.now();
    rescheduleFlowSessionAlarm();
  }
});

// Alarm handler — gửi message đến TẤT CẢ Flow tabs để refresh session
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // L1: periodic self-heal probe (replaces setInterval + swKeepAlive). Firing also wakes SW.
  if (alarm.name === 'selfHealProbe') {
    try { await Promise.all([_selfHealProbe(), _deviceBanRecoveryProbe()]); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
    return;
  }
  if (alarm.name !== 'flowSessionRefresh') return;
  try {
    const tabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
    for (const tab of tabs) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'flow:refreshSession' });
      } catch (e) {
        // Tab content script chưa ready hoặc orphan — skip silent
      }
    }
  } catch (e) {
    console.warn('[SEOSONA Flow] flowSessionRefresh alarm error:', e.message);
  }
});

// === Auto-inject content script vào existing Google Flow tabs ===
// NOTE: onInstalled listener đã move vào consolidated section cuối file.
// Giữ helper function để inject content scripts (được gọi từ consolidated listener).
function _autoInjectContentScripts() {
  chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery }, (tabs) => {
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'ping' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content_scripts/content.js']
          }).catch(err => console.warn('[SEOSONA Flow] Auto-inject failed for tab', tab.id, err.message));
        } else {
          console.log('[SEOSONA Flow] content.js đã active trong tab', tab.id, '→ skip auto-inject');
        }
      });
    }
  });
}

// === chrome.sidePanel Setup ===
// GLOBAL MODE: 1 sidePanel instance cho tất cả tabs (không cần sync state giữa các tabs)
if (chrome.sidePanel) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(err => console.warn('[SEOSONA Flow] sidePanel setPanelBehavior error:', err));

  // Global sidePanel - không dùng tabId → 1 instance duy nhất
  chrome.sidePanel.setOptions({
    path: 'pages/sidebar.html',
    enabled: true
  }).catch(err => console.warn('[SEOSONA Flow] sidePanel setOptions error:', err));

  // Vẫn cần notify project context khi Flow tab URL thay đổi
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!tab.url) return;
    if (tab.url.startsWith(PROVIDER_URLS.flow.base)) {
      // Khi Flow tab URL thay đổi (SPA navigation hoặc page load), thông báo sidebar cập nhật project context
      if (info.status === 'complete' || info.url) {
        const projectMatch = tab.url.match(/\/project\/([a-f0-9-]+)/);
        const projectId = projectMatch ? projectMatch[1] : null;
        // Gửi projectContext tới sidebar để cập nhật state
        chrome.runtime.sendMessage({
          action: 'projectContext',
          projectId: projectId,
          projectName: null, // Sẽ được cập nhật sau khi content.js sẵn sàng
          fromTabUpdate: true
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#_autoInjectContentScripts', _e); });
        // Nếu đang ở project page, yêu cầu content.js gửi context đầy đủ (có projectName)
        if (projectId) {
          setTimeout(() => {
            chrome.tabs.sendMessage(tabId, { action: 'getProjectContext' }, (resp) => {
              if (chrome.runtime.lastError || !resp?.projectId) return;
              chrome.runtime.sendMessage({
                action: 'projectContext',
                projectId: resp.projectId,
                projectName: resp.projectName,
                projectError: resp.projectError === true, // verified DOM → sidebar quyết định ẩn/hiện overlay
              }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#_autoInjectContentScripts', _e); });
            });
          }, 500);
        }
      }
    }
  });

  // Detect khi user switch sang Flow tab → notify sidePanel
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (tab.url && tab.url.startsWith(PROVIDER_URLS.flow.base)) {
        // Notify sidePanel để upload pending files + re-sync project context
        chrome.runtime.sendMessage({
          action: 'flowTabActivated',
          tabId: activeInfo.tabId,
          url: tab.url
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#_autoInjectContentScripts', _e); });
      }
    } catch (e) {
      // Tab không tồn tại hoặc lỗi khác — bỏ qua
    }
  });
}

// Open settings in a separate popup window
async function openSettingsWindow(tab = null) {
  // Prevent race condition: multiple clicks before window is created
  if (_settingsWindowOpening) return;

  const hashSuffix = tab ? `#${tab}` : '';

  // Check if window already exists (in-memory)
  if (settingsWindowId !== null) {
    try {
      const win = await chrome.windows.get(settingsWindowId, { populate: true });
      if (win) {
        // Nếu có tab param → update URL để switch tab; nếu không → chỉ focus
        if (tab && win.tabs?.[0]) {
          chrome.tabs.update(win.tabs[0].id, { url: chrome.runtime.getURL('pages/settings.html' + hashSuffix) });
        }
        chrome.windows.update(settingsWindowId, { focused: true });
        return;
      }
    } catch (e) {
      settingsWindowId = null;
      _persistWindowIds();
    }
  }

  // Fallback: check session storage (SW may have hibernated)
  if (settingsWindowId === null) {
    try {
      const stored = await chrome.storage?.session?.get(['_settingsWindowId']);
      if (stored?._settingsWindowId) {
        const win = await chrome.windows.get(stored._settingsWindowId, { populate: true });
        if (win) {
          settingsWindowId = stored._settingsWindowId;
          _extensionPopupWindows.add(settingsWindowId);
          if (tab && win.tabs?.[0]) {
            chrome.tabs.update(win.tabs[0].id, { url: chrome.runtime.getURL('pages/settings.html' + hashSuffix) });
          }
          chrome.windows.update(settingsWindowId, { focused: true });
          return;
        }
      }
    } catch (e) {
      // Window doesn't exist, proceed to create
    }
  }

  _settingsWindowOpening = true;
  try {
    // Tính vị trí kế bên trái sidebar
    const pos = await _calcWindowPosition(580, 850);
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('pages/settings.html' + hashSuffix),
      type: 'popup',
      width: 580,
      height: 850,
      left: pos.left,
      top: pos.top,
      focused: true
    });

    settingsWindowId = win.id;
    _extensionPopupWindows.add(win.id);
    _persistWindowIds();
  } finally {
    _settingsWindowOpening = false;
  }
}

// Defense-in-depth: re-gate Flow project readiness ở CHOKE POINT (background) trước khi mở editor.
// Phòng gate sidebar (WorkflowTab.openEditor) bị bypass (fail-open exception / race / sender tương lai).
// CHỈ chặn khi DEFINITIVE not-ready (không có Flow tab / không có project / project lỗi-đã xoá).
// Transient (content script chưa phản hồi/cold) → FAIL-OPEN (gate sidebar vừa pass ~100ms trước → tránh chặn oan).
async function _isFlowProjectReadyBg() {
  try {
    const tabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
    if (!tabs.length) return false; // không có Flow tab → chắc chắn not-ready → block
    const activeTab = tabs.find(t => t.active) || tabs[0];
    return await new Promise(resolve => {
      try {
        chrome.tabs.sendMessage(activeTab.id, { action: 'getProjectContext' }, (resp) => {
          if (chrome.runtime.lastError || !resp) return resolve(true); // transient → fail-open
          resolve(resp.projectError !== true && !!resp.projectId); // block khi project lỗi/đã xoá hoặc homepage
        });
      } catch (_) { resolve(true); } // transient → fail-open
    });
  } catch (_) { return true; } // query lỗi → fail-open (tránh chặn oan)
}

// Open workflow editor in a separate popup window
let _workflowWindowOpening = false;
async function openWorkflowWindow(workflowData) {
  console.log('[Background] openWorkflowWindow called, _workflowWindowOpening:', _workflowWindowOpening, 'workflowWindowId:', workflowWindowId);
  // Prevent race condition: multiple messages arriving before window is created
  if (_workflowWindowOpening) {
    console.log('[Background] openWorkflowWindow blocked - already opening');
    return;
  }

  // Track which workflow is being edited
  editingWorkflowId = workflowData?.workflow?.wf_id || null;
  _persistWindowIds();

  // Check if window already exists (in-memory)
  if (workflowWindowId !== null) {
    try {
      const win = await chrome.windows.get(workflowWindowId);
      if (win) {
        chrome.windows.update(workflowWindowId, { focused: true });
        // Always reload workflow data (may have been reset/updated)
        if (workflowData) {
          chrome.runtime.sendMessage({ action: 'loadWorkflowInEditor', data: workflowData });
        }
        editingWorkflowId = workflowData?.workflow?.wf_id || null;
        _persistWindowIds();
        return;
      }
    } catch (e) {
      console.log('[Background] openWorkflowWindow - window.get failed, clearing workflowWindowId');
      workflowWindowId = null;
      _persistWindowIds();
    }
  }

  // Fallback: check session storage (SW may have hibernated)
  if (workflowWindowId === null) {
    try {
      const stored = await chrome.storage?.session?.get(['_workflowWindowId']);
      console.log('[Background] openWorkflowWindow - session storage check:', stored?._workflowWindowId);
      if (stored?._workflowWindowId) {
        const win = await chrome.windows.get(stored._workflowWindowId);
        if (win) {
          console.log('[Background] openWorkflowWindow - found window in session storage, focusing');
          workflowWindowId = stored._workflowWindowId;
          _extensionPopupWindows.add(workflowWindowId);
          chrome.windows.update(workflowWindowId, { focused: true });
          if (workflowData) {
            chrome.runtime.sendMessage({ action: 'loadWorkflowInEditor', data: workflowData });
          }
          editingWorkflowId = workflowData?.workflow?.wf_id || null;
          _persistWindowIds();
          return;
        }
      }
    } catch (e) {
      console.log('[Background] openWorkflowWindow - session storage window invalid, will create new');
      // Window doesn't exist, proceed to create
    }
  }

  console.log('[Background] openWorkflowWindow - creating new window');
  _workflowWindowOpening = true;
  let pendingWorkflowSet = false;
  try {
    // Store workflow data for the new window to pick up
    if (workflowData) {
      await chrome.storage.local.set({ _pendingWorkflow: workflowData });
      pendingWorkflowSet = true;
    }

    // Default size — bump lên 90% Flow window nếu user đang dùng monitor lớn.
    // Lý do: workflow nhiều node + 16:9 monitor → 1440×900 chật. 90% Flow window
    // đảm bảo workflow editor vừa với màn hình user (Flow đã được user resize sẵn).
    let winWidth = 1440;
    let winHeight = 900;
    try {
      const flowTabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
      if (flowTabs.length > 0 && flowTabs[0].windowId) {
        const flowWin = await chrome.windows.get(flowTabs[0].windowId);
        if (flowWin?.width && flowWin?.height) {
          const targetW = Math.round(flowWin.width * 0.9);
          const targetH = Math.round(flowWin.height * 0.9);
          // Chỉ tăng — không giảm. Default 1440×900 là baseline tối thiểu.
          if (targetW > winWidth) winWidth = targetW;
          if (targetH > winHeight) winHeight = targetH;
          console.log('[Background] Workflow window size:', winWidth, 'x', winHeight, '(Flow window:', flowWin.width, 'x', flowWin.height, ')');
        }
      }
    } catch (sizeErr) {
      console.warn('[Background] Failed to read Flow window size:', sizeErr.message);
    }

    const pos = await _calcWindowPosition(winWidth, winHeight);
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('pages/workflow-editor.html'),
      type: 'popup',
      width: winWidth,
      height: winHeight,
      left: pos.left,
      top: pos.top,
      focused: true
    });

    workflowWindowId = win.id;
    _extensionPopupWindows.add(win.id);
    _persistWindowIds();
    pendingWorkflowSet = false; // window created OK, init script sẽ consume + remove
  } catch (createErr) {
    // Gap 4 fix: nếu chrome.windows.create fail → _pendingWorkflow stuck. Lần
    // sau open editor mới (kể cả workflow KHÁC) sẽ load workflow cũ vì init
    // line ~188 đọc _pendingWorkflow. Cleanup để tránh ghi nhầm.
    console.error('[Background] openWorkflowWindow create failed:', createErr.message);
    if (pendingWorkflowSet) {
      try { await chrome.storage.local.remove('_pendingWorkflow'); } catch (e) { /* owned suppression (P4.T7): silent by design */ }
    }
    // Không throw để tránh unhandled rejection ở caller (line ~1075, 1097 không await)
  } finally {
    _workflowWindowOpening = false;
  }
}

// Mở preview template (readonly) trong cửa sổ workflow-editor. _pendingTemplatePreview chỉ được
// workflow-editor-init.js đọc lúc INIT (1 lần). Nếu cửa sổ ĐÃ mở → reload tab để init chạy lại đọc
// preview mới (trước đây openWorkflowWindow chỉ focus + return → "không thấy gì xuất hiện").
let _previewWindowOpening = false;
let _templatePreviewWindowId = null;
// Mở preview workflow template trong cửa sổ SIÊU NHẸ (template-preview.html — KHÔNG phải
// workflow-editor.html 82 script). Dùng CHUNG community + official. Reuse 1 cửa sổ + swap nội dung
// qua message (ko reload) → tránh GPU/memory tích lũy khi mở nhiều lần.
async function openTemplatePreviewWindow(template, kind = 'template') {
  if (_previewWindowOpening) { console.log('[Background] openTemplatePreviewWindow: skip (already opening)'); return; }
  _previewWindowOpening = true;
  setTimeout(() => { _previewWindowOpening = false; }, 1500);

  // Reuse cửa sổ preview nhẹ nếu còn mở → swap qua message (KHÔNG reload, KHÔNG tạo renderer mới).
  let wid = _templatePreviewWindowId;
  if (!wid) { try { wid = (await chrome.storage?.session?.get(['_templatePreviewWindowId']))?._templatePreviewWindowId || null; } catch (_) { /* owned suppression (P4.T7): silent by design */ } }
  if (wid) {
    try {
      const win = await chrome.windows.get(wid);
      if (win) {
        _templatePreviewWindowId = wid;
        // Swap nội dung qua runtime.sendMessage BROADCAST (KHÔNG tabs.sendMessage — extension page
        // KHÔNG nhận tabs.sendMessage; broadcast tới runtime.onMessage của lite page, giống pattern
        // loadWorkflowInEditor của editor). Lite page là cửa sổ DUY NHẤT có handler loadTemplatePreview.
        try { chrome.runtime.sendMessage({ action: 'loadTemplatePreview', template, kind }, () => void chrome.runtime.lastError); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        try { await chrome.windows.update(wid, { focused: true }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        console.log('[Background] template preview: swap content in existing lite window', wid, 'kind=', kind);
        return;
      }
    } catch (e) { _templatePreviewWindowId = null; }
  }

  // Tạo cửa sổ preview NHẸ. _pendingTemplatePreview chỉ set khi tạo mới (init đọc 1 lần). kind phân biệt
  // template (Use → cloneWorkflowTemplate) vs shared workflow (Use → cloneSharedWorkflow).
  await chrome.storage.local.set({ _pendingTemplatePreview: { template, kind, timestamp: Date.now() } });
  let winWidth = 1280, winHeight = 860;
  try {
    const flowTabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
    if (flowTabs.length > 0 && flowTabs[0].windowId) {
      const flowWin = await chrome.windows.get(flowTabs[0].windowId);
      if (flowWin?.width && flowWin?.height) {
        const tw = Math.round(flowWin.width * 0.85), th = Math.round(flowWin.height * 0.85);
        if (tw > winWidth) winWidth = tw;
        if (th > winHeight) winHeight = th;
      }
    }
  } catch (_) { /* owned suppression (P4.T7): silent by design */ }
  try {
    const pos = await _calcWindowPosition(winWidth, winHeight);
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('pages/template-preview.html'),
      type: 'popup', width: winWidth, height: winHeight, left: pos.left, top: pos.top, focused: true,
    });
    _templatePreviewWindowId = win.id;
    _extensionPopupWindows.add(win.id);
    try { await chrome.storage.session.set({ _templatePreviewWindowId: win.id }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
    console.log('[Background] template preview: created lite window', win.id);
  } catch (e) {
    console.error('[Background] template preview create failed:', e.message);
    try { await chrome.storage.local.remove('_pendingTemplatePreview'); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
  }
}

// [Affiliate Creator Page] Web (labs.seosona.vn) gọi extension TRỰC TIẾP qua externally_connectable —
// chuẩn MV3 (response-based). Web biết CHẮC extension đã cài + đã xử lý (ko cần ping/pong đoán mò,
// ko phụ thuộc content script relay). Chỉ chạy với extension ĐÚNG ID web target (prod). Dev (ID khác)
// → web fallback window.postMessage (ref-bridge relay).
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  const origin = sender?.origin || sender?.url || '';
  if (!/^https:\/\/labs\.seosona\.vn([/:]|$)/.test(origin)) { sendResponse({ ok: false, error: 'BAD_ORIGIN' }); return; }
  console.log('[Background] onMessageExternal:', message?.type, 'from', origin);

  if (message?.type === 'ping') {
    // [P3.6] Feature-detect: web gate nút/tab theo capabilities — extension cũ thiếu handler
    // sẽ không fail im lặng nữa (web hiện "Cập nhật extension để dùng X").
    sendResponse({
      ok: true, installed: true,
      version: chrome.runtime.getManifest().version,
      capabilities: ['openTemplatePreview', 'fetchMedia', 'providerStatus', 'runWorkflow', 'stopWorkflow', 'workflowStatus', 'runNode', 'currentProject', 'listFlowLibrary', 'uploadToFlow', 'listFlowCharacters', 'closeWindow'],
    });
    return;
  }

  // [Audit 2026-07-07] Đóng cửa sổ popup (mở bằng chrome.windows.create) — trang web KHÔNG tự
  // window.close() được (browser chặn). Web gửi 'closeWindow' → extension remove window của sender.
  if (message?.type === 'closeWindow') {
    const winId = sender?.tab?.windowId;
    if (winId == null) { sendResponse({ ok: false, error: 'NO_WINDOW' }); return; }
    chrome.windows.remove(winId).then(() => sendResponse({ ok: true })).catch((e) => sendResponse({ ok: false, error: e?.message }));
    return true; // async
  }

  if (message?.type === 'openTemplatePreview') {
    const templateId = message.templateId;
    let refCode = (message.refCode || '').trim();
    if (templateId === undefined || templateId === null || templateId === '') { sendResponse({ ok: false, error: 'NO_TEMPLATE_ID' }); return; }
    (async () => {
      try {
        if (refCode && /^[A-Za-z0-9_\-]{4,40}$/.test(refCode)) {
          try { chrome.storage.local.set({ seosona_ref: { code: refCode, expires: Date.now() + 90 * 24 * 60 * 60 * 1000 } }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        }
        // kind='official' → trang /workflows/{slug} (WorkflowTemplate official); else community /@{slug}.
        const url = message.kind === 'official'
          ? `${getApiBaseUrl()}/workflow-templates/${encodeURIComponent(templateId)}`
          : `${getApiBaseUrl()}/creator-templates/${encodeURIComponent(templateId)}/public`;
        console.log('[Background] external preview fetch:', url);
        // _signedFetch: publicShow nằm trong group verify.signature → BẮT BUỘC ký (plain fetch → 403).
        const resp = await _signedFetch(url, {
          method: 'GET', headers: { 'Accept': 'application/json', 'X-Extension-Id': chrome.runtime.id }, cache: 'no-store',
        });
        const json = await resp.json().catch(() => null);
        console.log('[Background] external preview fetch result:', resp.status, 'success=', json?.success, 'hasData=', !!json?.data);
        if (!resp.ok || !json?.success || !json?.data) { sendResponse({ ok: false, error: 'FETCH_FAILED', status: resp.status }); return; }
        await openTemplatePreviewWindow(json.data);
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Background] onMessageExternal openTemplatePreview error:', err.message);
        sendResponse({ ok: false, error: 'EXCEPTION', message: err.message });
      }
    })();
    return true; // async sendResponse
  }

  // [PLAN A P0.5] Web (labs.seosona.vn) không gửi được cookie provider cross-site → media 401/403.
  // Extension fetch hộ (SW fetch mang cookie nhờ host_permissions) → trả data URL.
  // Allowlist host media provider (Flow/Google + ChatGPT/OpenAI + Grok/xAI) — KHÔNG open proxy.
  if (message?.type === 'fetchMedia') {
    const MEDIA_HOSTS = /(^|\.)(labs\.google|googleusercontent\.com|storage\.googleapis\.com|flow-content\.google|chatgpt\.com|oaiusercontent\.com|openai\.com|grok\.com|x\.ai)$/i;
    const urls = (Array.isArray(message.urls) ? message.urls : []).filter((u) => typeof u === 'string').slice(0, 12);
    (async () => {
      const results = {};
      // Tuần tự + budget tổng payload — 1 response chứa nhiều video base64 có thể vượt limit message Chrome.
      let budget = 48 * 1024 * 1024;
      for (const u of urls) {
        results[u] = null;
        try {
          const parsed = new URL(u);
          if (parsed.protocol !== 'https:' || !MEDIA_HOSTS.test(parsed.hostname)) continue;
          const resp = await fetch(u, { credentials: 'include', signal: AbortSignal.timeout(20000) });
          if (!resp.ok) continue;
          // [Security audit 2026-07-06] Redirect có thể thoát allowlist (host_permissions <all_urls>
          // → fetch follow + gửi cookie host đích) → verify URL CUỐI sau redirect.
          try {
            const finalUrl = new URL(resp.url);
            if (finalUrl.protocol !== 'https:' || !MEDIA_HOSTS.test(finalUrl.hostname)) continue;
          } catch (_) { continue; }
          // Pre-check size trước khi tải blob (tránh tải 25MB rồi mới discard)
          const clen = Number(resp.headers.get('content-length') || 0);
          if (clen > 25 * 1024 * 1024) continue;
          const blob = await resp.blob();
          const isImg = /^image\//.test(blob.type);
          const isVid = /^video\//.test(blob.type);
          if ((!isImg && !isVid) || blob.size > (isVid ? 25 : 20) * 1024 * 1024) continue;
          let outBlob = blob;
          if (isImg) {
            try {
              const bmp = await createImageBitmap(blob);
              const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
              const oc = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * scale)), Math.max(1, Math.round(bmp.height * scale)));
              const ctx = oc.getContext('2d');
              ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, oc.width, oc.height);
              ctx.drawImage(bmp, 0, 0, oc.width, oc.height);
              outBlob = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.82 });
            } catch (_) { /* downscale fail → blob gốc */ }
          }
          const bytes = new Uint8Array(await outBlob.arrayBuffer());
          let bin = '';
          for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
          const b64 = btoa(bin);
          if (b64.length > budget) continue; // hết budget → null, giữ chỗ URL còn lại
          budget -= b64.length;
          results[u] = `data:${outBlob.type || (isVid ? 'video/mp4' : 'image/jpeg')};base64,${b64}`;
        } catch (_) { /* URL hỏng / fetch fail → null */ }
      }
      sendResponse({ ok: true, results });
    })();
    return true; // async sendResponse
  }

  // [Sidebar web] Check provider status (tab mở + composer ready) — badge "Ready" trên brand header
  // /app/spaces (parity extension _renderProviderLoginReminder). Generic composer selector đủ cho badge.
  if (message?.type === 'providerStatus') {
    (async () => {
      const URLS = {
        flow: '*://labs.google/fx/*',
        chatgpt: '*://chatgpt.com/*',
        grok: '*://grok.com/*',
        gemini: '*://gemini.google.com/*', // prompt node use_ai=gemini — composer rich-textarea contenteditable
      };
      const out = {};
      for (const [p, url] of Object.entries(URLS)) {
        try {
          const tabs = await chrome.tabs.query({ url });
          const tab = tabs && tabs.length ? (tabs.find(t => t.active) || tabs[0]) : null;
          if (!tab) { out[p] = { tabOpen: false, ready: false }; continue; }
          let ready = p === 'flow'; // flow: tab mở = đủ (content script tự lo phần sau)
          if (!ready) {
            try {
              const r = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: () => !!document.querySelector('textarea, [contenteditable="true"]'),
              });
              ready = !!(r && r[0] && r[0].result);
            } catch (_) { /* redirect login/cloudflare → ready=false */ }
          }
          out[p] = { tabOpen: true, ready };
        } catch (_) { out[p] = { tabOpen: false, ready: false }; }
      }
      sendResponse({ ok: true, providers: out });
    })();
    return true;
  }

  // [Parity audit] Character Selector Flow — web đọc danh sách nhân vật user đã scrape (storage.local
  // seosona_provider_characters_scraped). Character KHÔNG sync server → chỉ có qua bridge. Read-only.
  if (message?.type === 'listFlowCharacters') {
    (async () => {
      try {
        const res = await chrome.storage.local.get(['seosona_provider_characters_scraped']);
        const wrap = res?.seosona_provider_characters_scraped;
        const list = Array.isArray(wrap?.data) ? wrap.data : (Array.isArray(wrap) ? wrap : []);
        const characters = list.map((c) => ({
          slug: c?.slug || null, name: c?.name || c?.search_value || '',
          search_value: c?.search_value || c?.name || '', thumbnail: c?.thumbnail_url || null,
        })).filter((c) => c.slug && c.search_value).slice(0, 300);
        sendResponse({ ok: true, characters });
      } catch (e) { sendResponse({ ok: false, error: 'EXCEPTION', message: e.message }); }
    })();
    return true;
  }

  // [P3.2] Web bấm Run → mở run-window (popup NHẸ, KHÔNG editor) chạy workflow. Response = accepted
  // (đã mở host), KHÔNG chờ chạy xong — web theo dõi qua P2.7 (postMessage realtime + poll executions).
  if (message?.type === 'runWorkflow' || message?.type === 'runNode') {
    const wfId = String(message.workflowId || message.wfId || '').trim();
    const nodeId = message.type === 'runNode' ? String(message.nodeId || '').trim() : null;
    if (!wfId) { sendResponse({ ok: false, error: 'NO_WORKFLOW_ID' }); return; }
    if (message.type === 'runNode' && !nodeId) { sendResponse({ ok: false, error: 'NO_NODE_ID' }); return; }
    (async () => {
      try {
        // Busy check: af_running_workflow heartbeat-based (same logic executor readRunningFlag —
        // stale >5' coi như context chết, cho chạy đè).
        const stored = await chrome.storage.local.get(['af_running_workflow']);
        const flag = stored?.af_running_workflow;
        const alive = flag && (Date.now() - (flag.last_heartbeat_at || flag.started_at || 0)) < 5 * 60 * 1000;
        if (alive) { sendResponse({ ok: false, error: 'BUSY', wf_id: flag.wf_id, wf_name: flag.wf_name || null }); return; }
        await openRunWindow(wfId, nodeId);
        sendResponse({ ok: true, accepted: true });
      } catch (err) {
        console.error('[Background] runWorkflow error:', err.message);
        sendResponse({ ok: false, error: 'EXCEPTION', message: err.message });
      }
    })();
    return true;
  }

  // [P3.3] Stop: broadcast execution:stop — cùng cơ chế cross-context stop sẵn có
  // (run-window/editor/sidebar listener xử lý như remote stop).
  if (message?.type === 'stopWorkflow') {
    const wfId = String(message.workflowId || message.wfId || '').trim();
    // force=true → dừng CỨNG (parity ext _forceStopExecution:16203): run-window nhận
    // execution:force_stop → cancelAll gate + MessageBridge.stopExecution + clear flag.
    const eventName = message.force === true ? 'execution:force_stop' : 'execution:stop';
    try {
      chrome.runtime.sendMessage({ action: 'workflowExecutionEvent', event: eventName, data: { wf_id: wfId || undefined } }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#func', _e); });
    } catch (_) { /* owned suppression (P4.T7): silent by design */ }
    sendResponse({ ok: true });
    return;
  }

  // [P3.3] Status nhanh từ flag local (web vẫn nên poll executions/{id} server cho node_states).
  if (message?.type === 'workflowStatus') {
    (async () => {
      try {
        const stored = await chrome.storage.local.get(['af_running_workflow']);
        const flag = stored?.af_running_workflow;
        const alive = flag && (Date.now() - (flag.last_heartbeat_at || flag.started_at || 0)) < 5 * 60 * 1000;
        sendResponse({ ok: true, running: !!alive, wf_id: alive ? flag.wf_id : null, wf_name: alive ? (flag.wf_name || null) : null, started_at: alive ? (flag.started_at || null) : null });
      } catch (e) { sendResponse({ ok: false, error: 'EXCEPTION', message: e.message }); }
    })();
    return true;
  }

  // [P3.11] Chip "Target project" trên /app/spaces — đọc project Flow đang mở TRỰC TIẾP từ
  // content script (KHÔNG cần endpoint server — realtime + 0 API).
  if (message?.type === 'currentProject') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: '*://labs.google/fx/*' });
        const tab = tabs && tabs.length ? (tabs.find(t => t.active) || tabs[0]) : null;
        if (!tab) { sendResponse({ ok: true, tabOpen: false, projectId: null, projectName: null }); return; }
        const ctx = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, { action: 'getProjectContext' }, (r) => {
            void chrome.runtime.lastError;
            resolve(r || null);
          });
        });
        sendResponse({ ok: true, tabOpen: true, projectId: ctx?.projectId || null, projectName: ctx?.projectName || null, projectError: !!ctx?.projectError });
      } catch (e) { sendResponse({ ok: false, error: 'EXCEPTION', message: e.message }); }
    })();
    return true;
  }

  // [P5.5b] Web picker tab "Ảnh Flow": scan tiles trang Flow đang mở (content handler
  // 'scanFlowImages' sẵn có — same nguồn ImagePickerModal extension) → {file_id, file_name, thumbnail}.
  if (message?.type === 'listFlowLibrary') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: '*://labs.google/fx/*' });
        const tab = tabs && tabs.length ? (tabs.find(t => t.active) || tabs[0]) : null;
        if (!tab) { sendResponse({ ok: false, error: 'NO_FLOW_TAB' }); return; }
        const r = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, { action: 'scanFlowImages', deep: message.deep === true }, (resp) => {
            void chrome.runtime.lastError;
            resolve(resp || null);
          });
        });
        if (!r || r.error) { sendResponse({ ok: false, error: r?.error || 'SCAN_FAILED' }); return; }
        const images = (Array.isArray(r.images) ? r.images : []).slice(0, 300).map((x) => ({
          file_id: x.fileId || null,
          file_name: x.file_name || null,
          thumbnail: x.thumbnail || null,
          type: x.type || 'image',
        })).filter((x) => x.file_id && x.thumbnail);
        sendResponse({ ok: true, images });
      } catch (e) { sendResponse({ ok: false, error: 'EXCEPTION', message: e.message }); }
    })();
    return true;
  }

  // [P5.5c] Web upload local → Flow TRỰC TIẾP: content handler 'uploadFilesToFlow' sẵn có (same
  // cơ chế MCP upload_ref) → tile_id thật; scan lại để lấy file_name/thumbnail (MediaRegistry là
  // module page-side, background không đọc được).
  if (message?.type === 'uploadToFlow') {
    // Serialize: content handler poll DOM tile mới — 2 instance song song cross-claim tile (Bug 59
    // pattern; MessageBridge có mutex nhưng đường bridge này gọi thẳng content → tự guard).
    if (globalThis._uploadToFlowBusy) { sendResponse({ ok: false, error: 'BUSY', message: 'Đang upload ảnh khác lên Flow — thử lại sau.' }); return; }
    globalThis._uploadToFlowBusy = true;
    (async () => {
      try {
        let b64 = String(message.base64 || '');
        const mimeMatch = b64.startsWith('data:') ? b64.match(/^data:([^;]+);/) : null;
        if (b64.startsWith('data:')) b64 = b64.split(',')[1] || '';
        // ~12MB base64 (~9MB ảnh) — chặn payload quá cỡ
        if (!b64 || b64.length > 12 * 1024 * 1024) { sendResponse({ ok: false, error: 'BAD_IMAGE' }); return; }
        const tabs = await chrome.tabs.query({ url: '*://labs.google/fx/*' });
        const tab = tabs && tabs.length ? (tabs.find(t => t.active) || tabs[0]) : null;
        if (!tab) { sendResponse({ ok: false, error: 'NO_FLOW_TAB' }); return; }
        // Activate tab trước upload (same MessageBridge._ensureFlowTabActive — Chrome throttle tab nền)
        try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        const result = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, {
            action: 'uploadFilesToFlow',
            filesData: [{ name: String(message.name || 'web_ref.jpg').slice(0, 120), type: (mimeMatch && mimeMatch[1]) || message.mime || 'image/jpeg', base64: b64 }],
          }, (resp) => { void chrome.runtime.lastError; resolve(resp || null); });
        });
        const tileId = result?.orderedTileIds?.[0] || result?.tileIds?.[0] || null;
        if (!tileId) {
          sendResponse({ ok: false, error: result?.error || 'UPLOAD_FAILED', message: result?.errorMessage || null });
          return;
        }
        // Scan nhanh lấy file_name/thumbnail của tile vừa upload
        let fileName = null, thumbnail = null;
        try {
          const scan = await new Promise((resolve) => {
            chrome.tabs.sendMessage(tab.id, { action: 'scanFlowImages' }, (resp) => { void chrome.runtime.lastError; resolve(resp || null); });
          });
          const found = (scan?.images || []).find((x) => x.fileId === tileId);
          if (found) { fileName = found.file_name || null; thumbnail = found.thumbnail || null; }
        } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        sendResponse({ ok: true, file_id: tileId, file_name: fileName, thumbnail });
      } catch (e) { sendResponse({ ok: false, error: 'EXCEPTION', message: e.message }); }
      finally { globalThis._uploadToFlowBusy = false; }
    })();
    return true;
  }

  sendResponse({ ok: false, error: 'UNKNOWN_TYPE' });
});

// [PLAN A P3.1] Run-window: popup host NHẸ chạy workflow KHÔNG mở editor (script core execution,
// không Drawflow/editor UI). Single-instance: reuse window nếu còn mở → gửi message load run mới.
let _runWindowId = null;
let _runWindowOpening = false;
let _webSpacesWindowId = null; // [P3.9] popup window /app/spaces (Sửa trên web) — single-instance reuse
async function openRunWindow(wfId, nodeId = null) {
  // Local/offline: run-window.html (popup runner) là asset web-mode KHÔNG ship trong bản
  // offline. Path này chỉ do web app (labs.seosona.vn) trigger qua externally_connectable
  // message runWorkflow/runNode — không tồn tại khi chạy offline. Guard để tuyệt đối không
  // gọi windows.create('run-window.html') (file thiếu → cửa sổ trống lỗi). Workflow offline
  // chạy trực tiếp từ sidebar/editor qua WorkflowExecutor.
  if (self.SEOSONA_LOCAL_MODE !== false) {
    throw new Error('RUN_WINDOW_UNAVAILABLE_OFFLINE');
  }
  if (_runWindowOpening) return;
  _runWindowOpening = true;
  setTimeout(() => { _runWindowOpening = false; }, 1500);
  try {
    await chrome.storage.local.set({ _pendingRunWorkflow: { wfId, nodeId, timestamp: Date.now() } });
    let wid = _runWindowId;
    if (!wid) { try { wid = (await chrome.storage?.session?.get(['_runWindowId']))?._runWindowId || null; } catch (_) { /* owned suppression (P4.T7): silent by design */ } }
    if (wid) {
      try {
        const win = await chrome.windows.get(wid);
        if (win) {
          _runWindowId = wid;
          // Window sống → báo init load run mới (init tự đọc _pendingRunWorkflow)
          try { chrome.runtime.sendMessage({ action: 'loadRunWorkflow' }, () => void chrome.runtime.lastError); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
          try { await chrome.windows.update(wid, { focused: true }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
          return;
        }
      } catch (_) { _runWindowId = null; }
    }
    const pos = await _calcWindowPosition(520, 720);
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('run-window.html'),
      type: 'popup', width: 520, height: 720, left: pos.left, top: pos.top, focused: true,
    });
    _runWindowId = win.id;
    _extensionPopupWindows.add(win.id);
    _persistWindowIds();
    try { await chrome.storage.session.set({ _runWindowId: win.id }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
  } catch (e) {
    console.error('[Background] openRunWindow failed:', e.message);
    try { await chrome.storage.local.remove('_pendingRunWorkflow'); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
    throw e;
  } finally {
    _runWindowOpening = false;
  }
}

// Open template editor in a separate popup window (giống workflow editor)
let _templateWindowOpening = false;

async function openTemplateEditorWindow(templateData) {
  // Prevent race condition
  if (_templateWindowOpening) return;

  // Check if window already exists (in-memory)
  if (templateWindowId !== null) {
    try {
      const win = await chrome.windows.get(templateWindowId);
      if (win) {
        chrome.windows.update(templateWindowId, { focused: true });
        // Reload template data nếu có
        if (templateData) {
          await chrome.storage.local.set({ _pendingTemplate: templateData });
          chrome.runtime.sendMessage({ action: 'loadTemplateInEditor', data: templateData });
        }
        return;
      }
    } catch (e) {
      templateWindowId = null;
      _persistWindowIds();
    }
  }

  // Fallback: check session storage (SW may have hibernated)
  if (templateWindowId === null) {
    try {
      const stored = await chrome.storage?.session?.get(['_templateWindowId']);
      if (stored?._templateWindowId) {
        const win = await chrome.windows.get(stored._templateWindowId);
        if (win) {
          templateWindowId = stored._templateWindowId;
          _extensionPopupWindows.add(templateWindowId);
          chrome.windows.update(templateWindowId, { focused: true });
          if (templateData) {
            await chrome.storage.local.set({ _pendingTemplate: templateData });
            chrome.runtime.sendMessage({ action: 'loadTemplateInEditor', data: templateData });
          }
          return;
        }
      }
    } catch (e) {
      // Window doesn't exist, proceed to create
    }
  }

  _templateWindowOpening = true;
  try {
    // Store template data for the new window to pick up
    // Chỉ set _pendingTemplate nếu templateData có đầy đủ dữ liệu (nodes, edges)
    // Nếu chỉ có { mode, templateId } thì sidebar đã set _pendingTemplate trước đó rồi
    if (templateData && templateData.nodes) {
      await chrome.storage.local.set({ _pendingTemplate: templateData });
    } else if (!templateData) {
      await chrome.storage.local.remove('_pendingTemplate');
    }
    // Nếu templateData là { mode, templateId } - không làm gì, giữ nguyên _pendingTemplate từ sidebar

    // Smart sizing giống workflow editor - 90% Flow window hoặc default 1440x900
    let winWidth = 1440;
    let winHeight = 900;
    try {
      const flowTabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
      if (flowTabs.length > 0 && flowTabs[0].windowId) {
        const flowWin = await chrome.windows.get(flowTabs[0].windowId);
        if (flowWin?.width && flowWin?.height) {
          const targetW = Math.round(flowWin.width * 0.9);
          const targetH = Math.round(flowWin.height * 0.9);
          if (targetW > winWidth) winWidth = targetW;
          if (targetH > winHeight) winHeight = targetH;
          console.log('[Background] Template editor window size:', winWidth, 'x', winHeight);
        }
      }
    } catch (sizeErr) {
      console.warn('[Background] Failed to read Flow window size:', sizeErr.message);
    }

    // Build URL với params — PHẢI có prefix pages/ (file ở pages/, không có bản root) → thiếu thì
    // getURL trỏ chrome-extension://<id>/workflow-template-editor.html → ERR_FILE_NOT_FOUND, cửa sổ 404.
    let url = 'pages/workflow-template-editor.html';
    if (templateData?.mode) {
      const params = new URLSearchParams();
      params.set('mode', templateData.mode);
      if (templateData.templateId) {
        params.set('templateId', String(templateData.templateId));
      }
      url += '?' + params.toString();
    }

    const pos = await _calcWindowPosition(winWidth, winHeight);
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL(url),
      type: 'popup',
      width: winWidth,
      height: winHeight,
      left: pos.left,
      top: pos.top,
      focused: true
    });

    templateWindowId = win.id;
    _extensionPopupWindows.add(win.id);
    _persistWindowIds();
  } finally {
    _templateWindowOpening = false;
  }
}

// Open angles editor in a separate popup window
let _anglesWindowOpening = false;
async function openAnglesWindow() {
  if (_anglesWindowOpening) return;

  // Check if window already exists (in-memory)
  if (anglesWindowId !== null) {
    try {
      const win = await chrome.windows.get(anglesWindowId);
      if (win) {
        chrome.windows.update(anglesWindowId, { focused: true });
        return;
      }
    } catch (e) {
      anglesWindowId = null;
      _persistWindowIds();
    }
  }

  // Fallback: check session storage (SW may have hibernated)
  if (anglesWindowId === null) {
    try {
      const stored = await chrome.storage?.session?.get(['_anglesWindowId']);
      if (stored?._anglesWindowId) {
        const win = await chrome.windows.get(stored._anglesWindowId);
        if (win) {
          anglesWindowId = stored._anglesWindowId;
          _extensionPopupWindows.add(anglesWindowId);
          chrome.windows.update(anglesWindowId, { focused: true });
          return;
        }
      }
    } catch (e) {
      // Window doesn't exist, proceed to create
    }
  }

  _anglesWindowOpening = true;
  try {
    const pos = await _calcWindowPosition(1200, 950);
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('pages/angles-editor.html'),
      type: 'popup',
      width: 1200,
      height: 950,
      left: pos.left,
      top: pos.top,
      focused: true
    });

    anglesWindowId = win.id;
    _extensionPopupWindows.add(win.id);
    _persistWindowIds();
  } finally {
    _anglesWindowOpening = false;
  }
}

// ─── Effects Editor Window ───────────────────────────────────────────────
let _effectsWindowOpening = false;

async function openEffectsWindow() {
  if (_effectsWindowOpening) return;

  // Check if window already exists (in-memory)
  if (effectsWindowId !== null) {
    try {
      const win = await chrome.windows.get(effectsWindowId);
      if (win) {
        chrome.windows.update(effectsWindowId, { focused: true });
        return;
      }
    } catch (e) {
      effectsWindowId = null;
      _persistWindowIds();
    }
  }

  // Fallback: check session storage (SW may have hibernated)
  if (effectsWindowId === null) {
    try {
      const stored = await chrome.storage?.session?.get(['_effectsWindowId']);
      if (stored?._effectsWindowId) {
        const win = await chrome.windows.get(stored._effectsWindowId);
        if (win) {
          effectsWindowId = stored._effectsWindowId;
          _extensionPopupWindows.add(effectsWindowId);
          chrome.windows.update(effectsWindowId, { focused: true });
          return;
        }
      }
    } catch (e) {
      // Window doesn't exist, proceed to create
    }
  }

  _effectsWindowOpening = true;
  try {
    const pos = await _calcWindowPosition(1200, 900);
    const win = await chrome.windows.create({
      url: chrome.runtime.getURL('pages/effects-editor.html'),
      type: 'popup',
      width: 1200,
      height: 900,
      left: pos.left,
      top: pos.top,
      focused: true
    });

    effectsWindowId = win.id;
    _extensionPopupWindows.add(win.id);
    _persistWindowIds();
  } finally {
    _effectsWindowOpening = false;
  }
}

// Clean up when windows close
chrome.windows.onRemoved.addListener(async (windowId) => {
  // Remove from tracking Set
  _extensionPopupWindows.delete(windowId);

  // [P3.9] Web spaces popup ("Sửa trên web"): clear tracking để lần sau tạo mới.
  if (windowId === _webSpacesWindowId) {
    _webSpacesWindowId = null;
    try { await chrome.storage.session.remove('_webSpacesWindowId'); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
  } else {
    try {
      const s = await chrome.storage?.session?.get(['_webSpacesWindowId']);
      if (s?._webSpacesWindowId === windowId) {
        _webSpacesWindowId = null;
        try { await chrome.storage.session.remove('_webSpacesWindowId'); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
      }
    } catch (_) { /* owned suppression (P4.T7): silent by design */ }
  }

  // Template preview lite window: clear tracking để lần sau tạo mới (reuse check).
  if (windowId === _templatePreviewWindowId) {
    _templatePreviewWindowId = null;
    try { await chrome.storage.session.remove('_templatePreviewWindowId'); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
  } else {
    try {
      const s = await chrome.storage?.session?.get(['_templatePreviewWindowId']);
      if (s?._templatePreviewWindowId === windowId) {
        _templatePreviewWindowId = null;
        try { await chrome.storage.session.remove('_templatePreviewWindowId'); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
      }
    } catch (_) { /* owned suppression (P4.T7): silent by design */ }
  }

  // Settings window: check in-memory first, then session storage fallback (SW hibernation)
  let isSettingsWindow = (windowId === settingsWindowId);
  if (!isSettingsWindow) {
    try {
      const stored = await chrome.storage?.session?.get(['_settingsWindowId']);
      if (stored?._settingsWindowId === windowId) isSettingsWindow = true;
    } catch (e) { /* ignore */ }
  }
  if (isSettingsWindow) {
    settingsWindowId = null;
    _persistWindowIds();
    // Notify sidePanel: settings closed (refresh entitlements/account UI if needed)
    chrome.runtime.sendMessage({ action: 'settingsClosed' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#openEffectsWindow', _e); });
  }

  // Workflow window
  let isWorkflowWindow = (windowId === workflowWindowId);
  console.log('[Background] onRemoved windowId:', windowId, 'workflowWindowId:', workflowWindowId, 'isWorkflow:', isWorkflowWindow);
  if (!isWorkflowWindow) {
    try {
      const stored = await chrome.storage?.session?.get(['_workflowWindowId']);
      if (stored?._workflowWindowId === windowId) {
        isWorkflowWindow = true;
        console.log('[Background] onRemoved - matched via session storage');
      }
    } catch (e) { /* ignore */ }
  }
  if (isWorkflowWindow) {
    console.log('[Background] onRemoved - clearing workflow window state');
    workflowWindowId = null;
    editingWorkflowId = null;
    _persistWindowIds();
    chrome.runtime.sendMessage({ action: 'workflowEditorClosed' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#openEffectsWindow', _e); });
  }

  // Template editor window
  let isTemplateWindow = (windowId === templateWindowId);
  if (!isTemplateWindow) {
    try {
      const stored = await chrome.storage?.session?.get(['_templateWindowId']);
      if (stored?._templateWindowId === windowId) isTemplateWindow = true;
    } catch (e) { /* ignore */ }
  }
  if (isTemplateWindow) {
    templateWindowId = null;
    _persistWindowIds();
    chrome.runtime.sendMessage({ action: 'templateEditorClosed' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#openEffectsWindow', _e); });
  }

  // Angles window
  let isAnglesWindow = (windowId === anglesWindowId);
  if (!isAnglesWindow) {
    try {
      const stored = await chrome.storage?.session?.get(['_anglesWindowId']);
      if (stored?._anglesWindowId === windowId) isAnglesWindow = true;
    } catch (e) { /* ignore */ }
  }
  if (isAnglesWindow) {
    anglesWindowId = null;
    _persistWindowIds();
  }

  // Effects window
  let isEffectsWindow = (windowId === effectsWindowId);
  if (!isEffectsWindow) {
    try {
      const stored = await chrome.storage?.session?.get(['_effectsWindowId']);
      if (stored?._effectsWindowId === windowId) isEffectsWindow = true;
    } catch (e) { /* ignore */ }
  }
  if (isEffectsWindow) {
    effectsWindowId = null;
    _persistWindowIds();
  }
});

// Handle messages from content script and settings page
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (_seosonaMessageGate(message, sender, false, sendResponse)) return true;
  // Ping handler để wake up service worker (MV3 hibernation)
  if (message.action === 'ping') {
    sendResponse({ ok: true });
    return true;
  }

  // Source Import Staging (Phase A): SEOSONA-owned transient package layer for
  // web-captured images. UI/features can create/get/cleanup staging refs without
  // coupling workflow inputs to live page state or third-party bridge IDs.
  if (message.action === 'sourceImport:createImage' || message.action === 'sourceImport:get' || message.action === 'sourceImport:cleanupExpired') {
    if (!_isTrustedSender(sender)) { sendResponse({ ok: false, error: 'UNTRUSTED_SENDER' }); return true; }
    (async () => {
      try {
        const S = self.SEOSONA_SourceImportStaging;
        if (!S || typeof S.handleMessage !== 'function') {
          sendResponse({ ok: false, error: 'SOURCE_IMPORT_UNAVAILABLE' });
          return;
        }
        const response = await S.handleMessage(message, { trusted: true });
        sendResponse(response);
      } catch (err) {
        sendResponse({ ok: false, error: 'SOURCE_IMPORT_FAILED', message: err && err.message });
      }
    })();
    return true;
  }

  if (message.action === 'visualPicker:buildNode' || message.action === 'batchCollector:collect') {
    if (!_isTrustedSender(sender)) { sendResponse({ ok: false, error: 'UNTRUSTED_SENDER' }); return true; }
    (async () => {
      try {
        const core = message.action === 'visualPicker:buildNode' ? self.SEOSONA_VisualPickerCore : self.SEOSONA_BatchCollectorCore;
        if (!core || typeof core.handleMessage !== 'function') {
          sendResponse({ ok: false, error: 'CAPTURE_CORE_UNAVAILABLE' });
          return;
        }
        sendResponse(await core.handleMessage(message, { trusted: true }));
      } catch (err) {
        sendResponse({ ok: false, error: 'CAPTURE_CORE_FAILED', message: err && err.message });
      }
    })();
    return true;
  }

  if (message.action === 'visualPicker:probeSelector') {
    if (!_isTrustedSender(sender)) { sendResponse({ ok: false, error: 'UNTRUSTED_SENDER' }); return true; }
    (async () => {
      try {
        const selector = String(message.selector || '').trim();
        const selectorType = message.selectorType === 'xpath' ? 'xpath' : 'css';
        const tabId = message.tabId || sender?.tab?.id;
        if (!selector || selector.length > 2000) { sendResponse({ ok: false, error: 'INVALID_SELECTOR' }); return; }
        if (!tabId) { sendResponse({ ok: false, error: 'NO_TAB' }); return; }
        const result = await chrome.scripting.executeScript({
          target: { tabId },
          args: [selector, selectorType],
          func: (sel, type) => {
            const list = [];
            if (type === 'xpath') {
              const snap = document.evaluate(sel, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
              for (let i = 0; i < snap.snapshotLength && list.length < 20; i++) {
                const el = snap.snapshotItem(i);
                if (el && el.nodeType === 1) list.push(el);
              }
            } else {
              document.querySelectorAll(sel).forEach((el) => { if (list.length < 20) list.push(el); });
            }
            return list.map((el) => ({
              tagName: el.tagName,
              text: (el.innerText || el.textContent || '').trim().slice(0, 500),
              href: el.href || '',
              src: el.currentSrc || el.src || '',
              alt: el.alt || '',
            }));
          },
        });
        const matches = result?.[0]?.result || [];
        const V = self.SEOSONA_VisualPickerCore;
        sendResponse(V?.buildProbeReceipt
          ? V.buildProbeReceipt({ selector, selectorType, matches })
          : { ok: true, selector, selectorType, matchCount: matches.length, matches });
      } catch (err) {
        sendResponse({ ok: false, error: 'SELECTOR_PROBE_FAILED', message: err && err.message });
      }
    })();
    return true;
  }

  // Prefix-match: bao trọn workflowResults:* (createRun/appendRows/setStatus/listRuns/getRun/exportCsv)
  // — trước đây liệt kê cứng 4 action nên action mới thêm sẽ rơi vào "unknown". Vẫn qua
  // _isTrustedSender ngay dưới nên không nới lỏng bảo mật.
  if (typeof message.action === 'string' && message.action.startsWith('workflowResults:')) {
    if (!_isTrustedSender(sender)) { sendResponse({ ok: false, error: 'UNTRUSTED_SENDER' }); return true; }
    (async () => {
      try {
        const R = self.SEOSONA_WorkflowResultsStore;
        if (!R || typeof R.handleMessage !== 'function') {
          sendResponse({ ok: false, error: 'WORKFLOW_RESULTS_UNAVAILABLE' });
          return;
        }
        sendResponse(await R.handleMessage(message, { trusted: true }));
      } catch (err) {
        sendResponse({ ok: false, error: 'WORKFLOW_RESULTS_FAILED', message: err && err.message });
      }
    })();
    return true;
  }

  if (message.action === 'connectorStatus:evaluate') {
    if (!_isTrustedSender(sender)) { sendResponse({ ok: false, error: 'UNTRUSTED_SENDER' }); return true; }
    (async () => {
      try {
        const C = self.SEOSONA_ConnectorStatus;
        if (!C || typeof C.handleMessage !== 'function') {
          sendResponse({ ok: false, error: 'CONNECTOR_STATUS_UNAVAILABLE' });
          return;
        }
        sendResponse(await C.handleMessage(message, { trusted: true }));
      } catch (err) {
        sendResponse({ ok: false, error: 'CONNECTOR_STATUS_FAILED', message: err && err.message });
      }
    })();
    return true;
  }

  if (message.action === 'runEvents:record' || message.action === 'runEvents:markRead' || message.action === 'runEvents:list') {
    if (!_isTrustedSender(sender)) { sendResponse({ ok: false, error: 'UNTRUSTED_SENDER' }); return true; }
    (async () => {
      try {
        const E = self.SEOSONA_RunEventCenter;
        if (!E || typeof E.handleMessage !== 'function') {
          sendResponse({ ok: false, error: 'RUN_EVENTS_UNAVAILABLE' });
          return;
        }
        sendResponse(await E.handleMessage(message, { trusted: true }));
      } catch (err) {
        sendResponse({ ok: false, error: 'RUN_EVENTS_FAILED', message: err && err.message });
      }
    })();
    return true;
  }

  /**
   * Quét tín dụng Flow từ sidebar (2026-07-27).
   *
   * message.openIfClosed = true  → mở/kích hoạt tab Flow rồi mới quét (luồng nút "Mở Google Flow").
   * message.openIfClosed = false → chỉ quét nếu tab Flow ĐANG mở, không tự mở tab.
   *
   * Vì sao tách 2 chế độ: mở tab là hành vi user nhìn thấy được, chỉ nên xảy ra khi họ CHỦ ĐỘNG
   * bấm — không phải mỗi lần sidebar tự làm mới trong nền.
   *
   * "Chưa đọc được" luôn trả về như KẾT QUẢ (known:false + reason), không ném lỗi — để UI nói
   * đúng tình trạng thay vì hiện số sai.
   */
  if (message.action === 'flowCreditsScan') {
    (async () => {
      try {
        const pattern = PROVIDER_URLS.flow.tabQuery;
        let tabs = await chrome.tabs.query({ url: pattern });

        if (!tabs.length) {
          if (!message.openIfClosed) {
            sendResponse({ ok: true, known: false, reason: 'FLOW_NOT_OPEN' });
            return;
          }
          const tab = await openOrActivateTab(pattern, PROVIDER_URLS.flow.createUrl, true);
          // Tab mới cần thời gian tải + content script inject; chờ theo nhịp ngắn, thấy sớm thoát sớm.
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 500));
            try {
              const pong = await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
              if (pong) break;
            } catch (_) { /* content script chưa sẵn sàng — thử tiếp */ }
          }
          tabs = [tab];
        }

        const res = await chrome.tabs.sendMessage(tabs[0].id, { action: 'scanFlowCredits' });
        sendResponse(Object.assign({ ok: true }, res || { known: false, reason: 'NO_RESPONSE' }));
      } catch (err) {
        // Content script chưa nạp (tab vừa mở / extension vừa reload) — nói rõ, đừng coi là hỏng.
        sendResponse({ ok: true, known: false, reason: 'CONTENT_NOT_READY', detail: String(err && err.message || err) });
      }
    })();
    return true;
  }

  // Content.js nhờ re-inject slate-bridge (MAIN world) khi bridge chưa nạp (self-heal). Fix lỗi
  // "Bridge TIMEOUT" hàng loạt khi tab Flow mở trước lúc extension reload → manifest chưa inject bridge.
  if (message.action === 'reinjectSlateBridge') {
    const _tabId = sender && sender.tab && sender.tab.id;
    if (_tabId == null) { sendResponse({ ok: false, error: 'NO_TAB' }); return true; }
    chrome.scripting.executeScript({ target: { tabId: _tabId }, world: 'MAIN', files: ['content_scripts/slate-bridge.js'] })
      .then(() => { console.log('[SEOSONA bg] re-injected slate-bridge (MAIN) → tab', _tabId); sendResponse({ ok: true }); })
      .catch((e) => { console.warn('[SEOSONA bg] reinjectSlateBridge failed:', e && e.message); sendResponse({ ok: false, error: e && e.message }); });
    return true; // async sendResponse
  }

  // Phase 3: Receive URLs cache from sidebar (populated after server fetch)
  if (message.action === 'updateProviderUrlsCache') {
    const urls = message.data;
    if (urls && typeof urls === 'object') {
      _serverUrlsCache = urls;
      // Persist to session storage (survives service worker hibernation)
      chrome.storage?.session?.set({ _provider_urls_cache: urls });
      console.log('[Background] Updated provider URLs cache from sidebar');
    }
    sendResponse({ success: true });
    return false;
  }

  // ===== Provider Config Handlers (DOM Resilience Plan) =====
  // Note: Service worker uses self (globalThis), not window
  if (message.action === 'getProviderConfigs') {
    (async () => {
      try {
        const { provider } = message;
        const cached = await _getProviderConfigsFromCache();
        if (cached?.data?.[provider]) {
          sendResponse({ success: true, data: cached.data[provider] });
        } else {
          const data = await _fetchProviderConfigs();
          sendResponse({ success: true, data: data?.[provider] || null });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // Handler for API configs fetch trigger (content.js calls when cache empty)
  if (message.action === 'getProviderApiConfigs') {
    (async () => {
      try {
        // Trigger fetch (will populate chrome.storage.local.seosona_provider_api_configs)
        await _fetchApiConfigs();
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'reportSelectorFailure') {
    (async () => {
      try {
        const { provider, key, tried_selectors } = message.data || {};
        const baseUrl = await _getApiBaseUrl();
        _signedFetch(`${baseUrl}/api/v1/analytics/selector-failure`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Extension-Id': chrome.runtime.id,
          },
          body: JSON.stringify({
            provider,
            key,
            tried_selectors,
            timestamp: new Date().toISOString(),
          }),
        }).then(async (resp) => {
          if (resp.status === 403) {
            try {
              const body = await resp.clone().json();
              if (_isExtensionAuthRejection(body, 403)) _handleExtensionAuthRejection();
            } catch (_) { /* owned suppression (P4.T7): silent by design */ }
          }
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#func', _e); });
      } catch (_) { /* owned suppression (P4.T7): silent by design */ }
    })();
    sendResponse({ success: true });
    return false;
  }

  // Broadcast provider config update to all content scripts
  if (message.action === 'providerConfigUpdated') {
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'providerConfigUpdated',
          data: message.data,
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#func', _e); });
      });
    });
    sendResponse({ success: true });
    return false;
  }

  // Broadcast provider api_config update (ratios, download_resolutions, error_patterns)
  // tới content scripts để invalidate cache (content scripts đọc từ chrome.storage).
  if (message.action === 'providerApiConfigUpdated') {
    chrome.tabs.query({}, tabs => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          action: 'providerApiConfigUpdated',
          data: message.data,
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#func', _e); });
      });
    });
    sendResponse({ success: true });
    return false;
  }

  // Mở Flow tab để login (gọi từ settings popup)
  if (message.action === 'openFlowTabForLogin') {
    (async () => {
      try {
        console.log('[Background] openFlowTabForLogin called');
        // Tìm Flow tab đã mở
        const flowTabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
        console.log('[Background] Found Flow tabs:', flowTabs.length);

        if (flowTabs.length > 0) {
          // Focus vào Flow tab đã có
          await chrome.tabs.update(flowTabs[0].id, { active: true });
          await chrome.windows.update(flowTabs[0].windowId, { focused: true });
          console.log('[Background] Focused existing Flow tab:', flowTabs[0].id);
        } else {
          // Tạo Flow tab mới
          const newTab = await chrome.tabs.create({ url: PROVIDER_URLS.flow.createUrl });
          console.log('[Background] Created new Flow tab:', newTab.id);
        }
      } catch (err) {
        console.error('[Background] openFlowTabForLogin error:', err);
      }
    })();
    return true;
  }

  // Mở hoặc activate provider tab (ChatGPT/Grok) - gọi từ workflow editor
  if (message.action === 'openProviderTab') {
    (async () => {
      try {
        const provider = message.provider;
        const focusWindow = message.focusWindow !== false; // Default true for backwards compat
        const providerConfig = {
          chatgpt: {
            urlPattern: PROVIDER_URLS.chatgpt.tabQuery,
            createUrl: PROVIDER_URLS.chatgpt.createUrl
          },
          grok: {
            urlPattern: PROVIDER_URLS.grok.tabQueryPatterns,
            createUrl: PROVIDER_URLS.grok.createUrl
          },
          gemini: {
            urlPattern: PROVIDER_URLS.gemini.tabQuery,
            createUrl: PROVIDER_URLS.gemini.createUrl
          }
        };
        const config = providerConfig[provider];
        if (!config) {
          sendResponse({ ok: false, error: 'UNKNOWN_PROVIDER' });
          return;
        }
        // Grok có 2 URL patterns
        const patterns = Array.isArray(config.urlPattern) ? config.urlPattern : [config.urlPattern];
        let existingTab = null;
        for (const pattern of patterns) {
          const tabs = await chrome.tabs.query({ url: pattern });
          if (tabs.length > 0) {
            existingTab = tabs[0];
            break;
          }
        }
        if (existingTab) {
          await chrome.tabs.update(existingTab.id, { active: true });
          if (focusWindow) {
            await chrome.windows.update(existingTab.windowId, { focused: true });
          }
          console.log(`[Background] Activated existing ${provider} tab:`, existingTab.id, focusWindow ? '(focused)' : '(no focus)');
          sendResponse({ ok: true, tabId: existingTab.id, existing: true });
        } else {
          const newTab = await chrome.tabs.create({ url: config.createUrl, active: true });
          if (focusWindow) {
            await chrome.windows.update(newTab.windowId, { focused: true });
          }
          console.log(`[Background] Created new ${provider} tab:`, newTab.id, focusWindow ? '(focused)' : '(no focus)');
          sendResponse({ ok: true, tabId: newTab.id, existing: false });
        }
      } catch (err) {
        console.error('[Background] openProviderTab error:', err);
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'openSettings') {
    openSettingsWindow(message.tab || null);
    sendResponse({ ok: true });
    return true;
  }

  // flow:openSidebar — nút "Mở SEOSONA Flow" trong Flow nav. Mở sidePanel cho ĐÚNG tab gửi (Flow tab),
  // gọi sidePanel.open ở await đầu tiên để giữ user-gesture (giống i2p:openApp). KHÔNG query tab trước.
  if (message.action === 'flow:openSidebar') {
    (async () => {
      const tabId = sender?.tab?.id;
      try { if (tabId && chrome.sidePanel?.open) await chrome.sidePanel.open({ tabId }); }
      catch (e) { console.warn('[Background] flow:openSidebar fail:', e.message); }
      sendResponse({ ok: true });
    })();
    return true;
  }
  // [Affiliate] ref-bridge (labs.seosona.vn) gửi mã giới thiệu → lưu 90 ngày cho register kèm ref_code.
    if (message.action === 'openSidePanel') {
    // Mở sidePanel (gọi từ settings popup khi user click login)
    // CRITICAL: sidePanel chỉ enable trên Flow tabs (labs.google/fx), không phải tabs khác
    (async () => {
      try {
        let tabId = null;

        // 1. Tìm Flow tab đã mở
        const flowTabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
        if (flowTabs.length > 0) {
          tabId = flowTabs[0].id;
          console.log('[Background] Found existing Flow tab:', tabId);
        } else {
          // 2. Không có Flow tab → tạo mới và chờ load
          console.log('[Background] No Flow tab found, creating new one');
          const newTab = await chrome.tabs.create({ url: PROVIDER_URLS.flow.createUrl });
          tabId = newTab.id;

          // Chờ tab load xong (status: complete) để sidePanel được enable
          await new Promise((resolve) => {
            const checkLoaded = (updatedTabId, info) => {
              if (updatedTabId === tabId && info.status === 'complete') {
                chrome.tabs.onUpdated.removeListener(checkLoaded);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(checkLoaded);
            // Timeout fallback 10s
            setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(checkLoaded);
              resolve();
            }, 10000);
          });

          // Thêm delay nhỏ sau khi load để đảm bảo sidePanel được enable
          await new Promise(r => setTimeout(r, 300));
        }

        // Mở sidePanel trên Flow tab
        await chrome.sidePanel.open({ tabId });

        // Đóng settings popup nếu được yêu cầu
        // (chrome.windows.remove sẽ fire onRemoved listener → cleanup settingsWindowId + persist)
        if (message.closeSettingsWindow && settingsWindowId) {
          try {
            await chrome.windows.remove(settingsWindowId);
          } catch (e) {
            // Window đã đóng hoặc không tồn tại — fallback cleanup
            settingsWindowId = null;
            _persistWindowIds();
          }
        }

        // Thông báo sidePanel hiển thị login overlay nếu cần
        if (message.showLoginOverlay) {
          // Delay để sidePanel kịp load
          setTimeout(() => {
            chrome.runtime.sendMessage({ action: 'showLoginOverlay' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#checkLoaded', _e); });
          }, 500);
        }

        sendResponse({ ok: true });
      } catch (e) {
        console.error('[Background] openSidePanel error:', e.message, e);
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true; // async response
  }

  if (message.action === 'openWorkflowEditor') {
    (async () => {
      // Re-gate readiness ở choke point (defense-in-depth cho gate sidebar).
      const ready = await _isFlowProjectReadyBg();
      if (!ready) {
        console.warn('[Background] openWorkflowEditor BỊ CHẶN — Flow project chưa sẵn sàng (re-gate)');
        sendResponse({ ok: false, error: 'PROJECT_NOT_READY' });
        return;
      }
      openWorkflowWindow(message.data || null);
      sendResponse({ ok: true });
    })();
    return true;
  }

  // Open template editor window (với smart sizing giống workflow editor)
  if (message.action === 'openTemplateEditor') {
    openTemplateEditorWindow(message.data || null);
    sendResponse({ ok: true });
    return true;
  }

  // Preview workflow template trong popup window readonly (Phase 4 — Option A)
  if (message.action === 'openWorkflowTemplatePreview') {
    const template = message.template;
    if (!template) { sendResponse({ ok: false, error: 'NO_TEMPLATE' }); return true; }
    (async () => {
      await openTemplatePreviewWindow(template, message.kind || 'template');
      sendResponse({ ok: true });
    })();
    return true;
  }

  // [Affiliate Creator Page] Deep-link từ web /@{slug}: fetch community template theo id →
  // stash preview + set ref → mở editor readonly. KHÔNG nhận full template qua message (nặng).
  if (message.action === 'openWorkflowTemplatePreviewById') {
    const templateId = message.templateId;
    const refCode = (message.refCode || '').trim();
    if (!templateId) { sendResponse({ ok: false, error: 'NO_TEMPLATE_ID' }); return true; }
    (async () => {
      try {
        // Set ref affiliate (attribution) — reuse cùng storage key affiliate:setRef.
        if (refCode) {
          try { chrome.storage.local.set({ seosona_ref: { code: refCode, expires: Date.now() + 90 * 24 * 60 * 60 * 1000 } }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        }
        const apiBaseUrl = getApiBaseUrl();
        // kind='official' → official WorkflowTemplate show; else community publicShow. Cả 2 group verify.signature → _signedFetch.
        const fetchUrl = message.kind === 'official'
          ? `${apiBaseUrl}/workflow-templates/${encodeURIComponent(templateId)}`
          : `${apiBaseUrl}/creator-templates/${encodeURIComponent(templateId)}/public`;
        const resp = await _signedFetch(fetchUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json', 'X-Extension-Id': chrome.runtime.id },
          cache: 'no-store',
        });
        const json = await resp.json().catch(() => null);
        if (!resp.ok || !json?.success || !json?.data) {
          sendResponse({ ok: false, error: 'FETCH_FAILED', status: resp.status });
          return;
        }
        await openTemplatePreviewWindow(json.data);
        sendResponse({ ok: true });
      } catch (err) {
        console.error('[Background] openWorkflowTemplatePreviewById error:', err.message);
        sendResponse({ ok: false, error: 'EXCEPTION', message: err.message });
      }
    })();
    return true;
  }

  // Relay import-from-preview-window → sidePanel WorkflowTemplateList._handleImport
  if (message.action === 'importWorkflowTemplate') {
    if (message.template) {
      chrome.storage.local.set({
        _pendingTemplateImport: { template: message.template, timestamp: Date.now() },
      });
      // Notify sidePanel to pick up
      chrome.runtime.sendMessage({ action: 'workflowTemplateImportRequested', template: message.template }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#checkLoaded', _e); });
    }
    sendResponse({ ok: true });
    return true;
  }

  // [Clean] Bỏ handler 'cloneCommunityTemplate' (đường clone community CŨ qua side panel + pendingCloneReady).
  // Lite preview giờ gửi thẳng 'cloneWorkflowTemplate' khi user bấm Use → sidebar _runCopyTemplate.

  if (message.action === 'openAnglesEditor') {
    // Lưu project context cho angles editor
    if (message.projectId) {
      chrome.storage.local.set({
        _pendingAnglesProject: {
          projectId: message.projectId,
          projectName: message.projectName || null
        }
      });
    }
    openAnglesWindow();
    sendResponse({ ok: true });
    return true;
  }

  if (message.action === 'openEffectsEditor') {
    // Lưu project context cho effects editor
    if (message.projectId) {
      chrome.storage.local.set({
        _pendingEffectsProject: {
          projectId: message.projectId,
          projectName: message.projectName || null
        }
      });
    }
    openEffectsWindow();
    sendResponse({ ok: true });
    return true;
  }

  if (message.action === 'executionStatusUpdate') {
    // Relay execution status between popup and sidePanel
    chrome.runtime.sendMessage(message).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#checkLoaded', _e); });
    sendResponse({ ok: true });
    return true;
  }

  if (message.action === 'workflowSaved') {
    // Relay workflow saved event between popup editor and sidePanel
    chrome.runtime.sendMessage(message).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#checkLoaded', _e); });
    sendResponse({ ok: true });
    return true;
  }

  // Gap 3 fix: Relay workflow deleted event để popup editor đang mở wf_id đó biết và đóng
  if (message.action === 'workflowDeleted') {
    chrome.runtime.sendMessage(message).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#checkLoaded', _e); });
    // Nếu editor đang mở chính wf_id này → reset editingWorkflowId tracking
    if (editingWorkflowId && editingWorkflowId === message.wfId) {
      editingWorkflowId = null;
      _persistWindowIds();
    }
    sendResponse({ ok: true });
    return true;
  }

  // Relay workflow execution events between popup editor and sidePanel.
  // [Audit Bug 7 fix 2026-06-22, re-audit fix] Queue CHỈ khi không có receiver nào.
  //
  // Bug fix 2026-05-25 (duplicate events): chrome.runtime.sendMessage TỪ sender (popup/sidebar)
  // đã auto-broadcast tới mọi extension context. Background re-send với
  // chrome.runtime.sendMessage(message) → broadcast LẠI → sidebar nhận lần 2.
  // → Listener fire 2 lần cho cùng 1 event (execution:started/completed/...).
  // Fix: tag `_bg_relayed` để break loop. Khi re-send, set tag → handler skip nếu thấy tag.
  // [PLAN A P3.9] SSO extension → web: fetch one-time ticket (Bearer) → mở /app/spaces/{wfId}?ticket=
  // → web middleware ConsumeWebTicket tự Auth::login (session) → user không phải login lại.
  // Caller: UI extension (WorkflowList "Mở trên web" — Phase 5) gửi {action:'openWebSpaces', wfId}.
  if (message.action === 'openWebSpaces') {
    // Local/offline: "Sửa/Tạo trên web" mở web app labs.* + fetch signed API → chết offline,
    // và web-loading.html là asset web-mode KHÔNG ship. Guard tường minh (belt-and-suspenders,
    // giống openRunWindow) — dù cổng UI đã gate qua workflow_web_mode=false, chặn luôn ở đây cho chắc.
    if (self.SEOSONA_LOCAL_MODE !== false) {
      sendResponse({ ok: false, error: 'WEB_MODE_UNAVAILABLE_OFFLINE' });
      return true;
    }
    (async () => {
      // [Audit 2026-07-07] Kích thước = editor extension (1440×900, scale 90% Flow window nếu lớn hơn)
      // → popup web mode CÙNG kích thước extension mode.
      let winWidth = 1440, winHeight = 900;
      try {
        const flowTabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
        if (flowTabs.length > 0 && flowTabs[0].windowId) {
          const flowWin = await chrome.windows.get(flowTabs[0].windowId);
          if (flowWin?.width && flowWin?.height) {
            const tw = Math.round(flowWin.width * 0.9), th = Math.round(flowWin.height * 0.9);
            if (tw > winWidth) winWidth = tw;
            if (th > winHeight) winHeight = th;
          }
        }
      } catch (_) { /* owned suppression (P4.T7): silent by design */ }

      // [Fix delay] Mở/reuse popup NGAY (about:blank) → hiển thị TỨC THÌ; loading diễn ra SAU khi
      // navigate (bỏ delay do fetch ticket/create TRƯỚC). Parity extension mode mở cửa sổ tức thì.
      let winId = _webSpacesWindowId;
      if (!winId) { try { winId = (await chrome.storage?.session?.get(['_webSpacesWindowId']))?._webSpacesWindowId || null; } catch (_) { /* owned suppression (P4.T7): silent by design */ } }
      let tabId = null;
      if (winId) {
        try {
          await chrome.windows.get(winId);
          const tabs = await chrome.tabs.query({ windowId: winId });
          tabId = tabs?.[0]?.id ?? null;
          await chrome.windows.update(winId, { focused: true });
        } catch (_) { winId = null; }
      }
      if (!winId) {
        try {
          const pos = await _calcWindowPosition(winWidth, winHeight);
          // Mở trang loading (spinner tối) NGAY → parity extension có loading UI, không blank trắng.
          const win = await chrome.windows.create({ url: chrome.runtime.getURL('web-loading.html'), type: 'popup', width: winWidth, height: winHeight, left: pos.left, top: pos.top, focused: true });
          winId = win.id;
          tabId = win.tabs?.[0]?.id ?? null;
          _webSpacesWindowId = winId;
          _extensionPopupWindows.add(winId);
          try { await chrome.storage.session.set({ _webSpacesWindowId: winId }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        } catch (e) {
          console.error('[Background] openWebSpaces windows.create failed:', e?.message);
          sendResponse({ ok: false, error: 'WINDOW_CREATE_FAILED', message: e?.message });
          return;
        }
      }

      // Popup ĐÃ hiện. Giờ build URL (createNew tạo wf_id) + ticket → navigate tab.
      const base = getApiBaseUrl().replace(/\/api\/v1$/, '');
      try {
        let wfId = String(message.wfId || '').trim();
        const rawPath = String(message.path || '').trim();
        const safePath = /^\/(app|admin\/(workflow-templates|creator-templates))\/[\w\-\/?=&%.]*$/.test(rawPath) ? rawPath : '';
        if (message.createNew === true && !wfId) {
          const stored0 = await chrome.storage.local.get(['af_auth']);
          const token0 = stored0?.af_auth?.token;
          if (token0) {
            const seg = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
              ? crypto.randomUUID().split('-')[0] : Math.random().toString(36).slice(2, 10);
            const newId = `wf_${Date.now()}_${seg}`;
            const cResp = await _signedFetch(`${getApiBaseUrl()}/workflows`, {
              method: 'POST',
              headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${token0}`, 'X-Extension-Id': chrome.runtime.id },
              body: JSON.stringify({ wf_id: newId, wf_name: 'Workflow mới' }),
            });
            const cJson = await cResp.json().catch(() => null);
            wfId = (cResp.ok && cJson?.data?.wf_id) ? cJson.data.wf_id : newId;
          }
        }
        if (!wfId && !safePath) {
          if (tabId) await chrome.tabs.update(tabId, { url: `${base}/app/workflows` });
          sendResponse({ ok: false, error: 'NO_TARGET' });
          return;
        }
        let url = wfId ? `${base}/app/spaces/${encodeURIComponent(wfId)}` : `${base}${safePath}`;
        try {
          const stored = await chrome.storage.local.get(['af_auth']);
          const token = stored?.af_auth?.token;
          if (token) {
            const resp = await _signedFetch(`${getApiBaseUrl()}/auth/web-ticket`, {
              method: 'POST',
              headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'X-Extension-Id': chrome.runtime.id },
              body: '{}',
            });
            const json = await resp.json().catch(() => null);
            if (resp.ok && json?.success && json?.data?.ticket) {
              url += `${url.includes('?') ? '&' : '?'}ticket=${encodeURIComponent(json.data.ticket)}`;
            }
          }
        } catch (_) { /* không ticket → web redirect /login (fallback) */ }
        if (tabId) await chrome.tabs.update(tabId, { url });
        sendResponse({ ok: true });
      } catch (e) {
        console.error('[Background] openWebSpaces navigate error:', e?.message);
        sendResponse({ ok: false, error: 'EXCEPTION', message: e?.message });
      }
    })();
    return true;
  }

  if (message.action === 'workflowExecutionEvent') {
    // Self-echo guard: nếu message ĐÃ có tag → đây là re-broadcast của chính background
    // → KHÔNG re-send nữa. Bản gốc đã được sender broadcast tới mọi context.
    if (message._bg_relayed) {
      sendResponse({ ok: true });
      return true;
    }

    // [PLAN A P2.7 Kênh 1] Relay node-status → web /app/spaces (labs.seosona.vn) — realtime,
    // 0 API call: tabs.sendMessage → ref-bridge.js (content script) → window.postMessage → page.
    // Chỉ bản gốc (đã qua guard _bg_relayed) → không duplicate. Best-effort: tab không có
    // listener → lastError nuốt im lặng.
    const WEB_RELAY_EVENTS = ['execution:started', 'node:started', 'node:phase', 'node:completed', 'node:failed', 'execution:completed', 'workflow:reset',
      // [FLOW_RECAPTCHA_403 Phase 5] relay trạng thái lỗi Flow → web /app/spaces (badge/banner).
      'execution:captcha_detected', 'execution:quota_exceeded', 'node:policy_blocked', 'execution:rate_limited', 'execution:captcha_resolved'];
    if (WEB_RELAY_EVENTS.includes(message.event)) {
      try {
        chrome.tabs.query({ url: '*://labs.seosona.vn/*' }, (tabs) => {
          void chrome.runtime.lastError;
          (tabs || []).forEach((t) => {
            if (t.id == null) return;
            chrome.tabs.sendMessage(t.id, { action: 'wfNodeStatusRelay', event: message.event, data: message.data }, () => void chrome.runtime.lastError);
          });
        });
      } catch (e) { /* best-effort */ }
    }
    try {
      const E = self.SEOSONA_RunEventCenter;
      const eventTitles = {
        'execution:started': 'Workflow started',
        'execution:completed': 'Workflow completed',
        'execution:failed': 'Workflow failed',
        'node:failed': 'Workflow node failed',
        'execution:captcha_detected': 'Provider needs verification',
        'execution:quota_exceeded': 'Provider quota exceeded',
        'execution:rate_limited': 'Provider rate limited',
      };
      if (E?.recordEvent && eventTitles[message.event]) {
        E.recordEvent({
          type: message.event,
          title: eventTitles[message.event],
          data: message.data || null,
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#checkLoaded', _e); });
      }
    } catch (_) { /* best-effort event recording */ }

    // [Results] Ghi KẾT QUẢ mỗi lần chạy workflow vào WorkflowResultsStore (IndexedDB).
    // Trước đây module này đã build nhưng KHÔNG ai gọi → dữ liệu run không được lưu.
    // Best-effort tuyệt đối: KHÔNG await, KHÔNG bao giờ để lỗi ở đây phá luồng chạy workflow.
    try { _wfResultsRecord(message); } catch (e) { console.warn('[WorkflowResults] ghi kết quả lỗi:', e?.message); }
    chrome.runtime.sendMessage({ ...message, _bg_relayed: true })
      .then(() => {
        // Có receiver → không cần queue
      })
      .catch(() => {
        // Không có receiver (sidepanel đóng) → persist vào chrome.storage.session FIFO queue
        try {
          const sessionStore = chrome.storage?.session;
          if (!sessionStore) return;
          sessionStore.get(['af_execution_event_queue'], (res) => {
            const queue = Array.isArray(res?.af_execution_event_queue) ? res.af_execution_event_queue : [];
            queue.push({ ...message, _queued_at: Date.now() });
            if (queue.length > 50) queue.splice(0, queue.length - 50);
            sessionStore.set({ af_execution_event_queue: queue });
          });
        } catch (_) { /* best effort */ }
      });
    sendResponse({ ok: true });
    return true;
  }

  // Relay retry status from content.js to sidePanel for footer display
  if (message.action === 'retry:status') {
    chrome.runtime.sendMessage(message).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#checkLoaded', _e); });
    sendResponse({ ok: true });
    return true;
  }

  // Handle addImageToGenTab from content.js "+" overlay button
  // Store in pending queue so sidePanel can pick up when opened
  if (message.action === 'addImageToGenTab') {
    const { tileId, fileName, thumbnail } = message;
    if (!tileId) {
      sendResponse({ success: false, error: 'Missing tileId' });
      return true;
    }
    (async () => {
      try {
        // Try to relay to sidePanel first (if open)
        // Use Promise with timeout to detect if sidePanel is listening
        let sidePanelHandled = false;
        try {
          const result = await Promise.race([
            new Promise((resolve) => {
              chrome.runtime.sendMessage({
                action: 'addImageToGenTab',
                tileId, fileName, thumbnail,
                _fromBackground: true
              }, (resp) => {
                if (chrome.runtime.lastError) {
                  resolve(null);
                } else {
                  resolve(resp);
                }
              });
            }),
            new Promise(resolve => setTimeout(() => resolve(null), 200))
          ]);
          if (result?.success !== undefined) {
            sidePanelHandled = true;
            sendResponse(result);
          }
        } catch (e) {
          // sidePanel not ready
        }

        // If sidePanel didn't handle, store to pending queue
        if (!sidePanelHandled) {
          const storage = await chrome.storage.local.get(['_pendingAddToGenTab']);
          const pending = storage._pendingAddToGenTab || [];

          // Check duplicate
          if (pending.some(p => p.tileId === tileId)) {
            sendResponse({ success: true, alreadyExists: true, queued: true });
            return;
          }

          pending.push({ tileId, fileName, thumbnail, addedAt: Date.now() });
          // Keep max 20 pending items
          while (pending.length > 20) pending.shift();

          await chrome.storage.local.set({ _pendingAddToGenTab: pending });
          sendResponse({ success: true, queued: true });
        }
      } catch (e) {
        console.error('[Background] addImageToGenTab error:', e);
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true; // async response
  }

  if (message.action === 'getEditingWorkflowId') {
    sendResponse({ editingWorkflowId });
    return true;
  }

  if (message.action === 'updateEditingWorkflowId') {
    editingWorkflowId = message.wfId || null;
    _persistWindowIds();
    sendResponse({ ok: true });
    return true;
  }

  if (message.action === 'getSettingsWindowId') {
    sendResponse({ windowId: settingsWindowId });
    return true;
  }

  // Relay message from settings to content script
  if (message.action === 'settingsAction') {
    chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery }, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, message.payload);
      });
    });
    sendResponse({ ok: true });
    return true;
  }

  // Set extension badge (from NotificationManager)
  if (message.action === 'setBadge') {
    // Guard: chrome.action only exists if manifest has "action" defined
    if (chrome.action) {
      chrome.action.setBadgeText({ text: message.text || '' });
      chrome.action.setBadgeBackgroundColor({ color: '#3d6ff5' });
    }
    sendResponse({ success: true });
    return true;
  }

  // Show notification (from NotificationManager) - dùng chrome.notifications API
  if (message.action === 'showNotification') {
    // notifId ổn định (server notification) → create cùng id ở nhiều tab = replace (dedup),
    // không truyền thì random theo timestamp (gen-done, mỗi lần 1 notif riêng).
    const notifId = message.notifId || ('seosonaflow-' + Date.now());
    chrome.notifications.create(notifId, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title: message.title || 'SEOSONA Flow',
      message: message.body || '',
      priority: 2,
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[background] Notification error:', chrome.runtime.lastError.message);
      }
    });
    // Auto-clear after 5 seconds
    setTimeout(() => {
      chrome.notifications.clear(notifId);
    }, 5000);
    sendResponse({ success: true });
    return true;
  }

  // Ensure Flow tab is ready for upload (Phase S2.1: ImmediateUploader)
  // Google Flow KHÔNG THỂ process file upload khi tab inactive
  // (tile status=failed ngay do Chrome throttle React rendering)
  // → Nếu tab inactive: tạm activate ~2s cho upload, rồi restore tab cũ
  // CRITICAL: Nhận targetTabId để đảm bảo đúng tab khi có nhiều Flow tabs
  if (message.action === 'checkFlowTabOpen' || message.action === 'ensureFlowTabReady') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
        if (!tabs || tabs.length === 0) {
          sendResponse({ isOpen: false });
          return;
        }

        // CRITICAL: Ưu tiên targetTabId từ caller (nếu có)
        let flowTab = null;
        if (message.targetTabId) {
          flowTab = tabs.find(t => t.id === message.targetTabId);
        }
        // Fallback: active tab hoặc tab đầu tiên
        if (!flowTab) {
          flowTab = tabs.find(t => t.active) || tabs[0];
        }

        // Post-audit fix: PING content script + inject nếu chưa attach.
        // Root cause "Could not establish connection. Receiving end does not exist":
        // manifest.content_scripts chỉ inject lúc navigate vào URL match → tab mở
        // TRƯỚC khi extension reload/update sẽ KHÔNG có content script attached.
        const _ensureContentScriptReady = async (tabId) => {
          try {
            const pingResult = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
            if (pingResult?.pong) return { injected: false };
          } catch (_) { /* Content script không có → inject */ }
          try {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['content_scripts/content.js'] });
            await new Promise(r => setTimeout(r, 300));
            return { injected: true };
          } catch (e) {
            console.warn('[ensureFlowTabReady] Inject failed:', e?.message);
            return { injected: false, error: e?.message };
          }
        };

        // Nếu target tab đã active → ping + return
        if (flowTab.active) {
          const ready = await _ensureContentScriptReady(flowTab.id);
          sendResponse({ isOpen: true, tabId: flowTab.id, wasInjected: ready.injected });
          return;
        }

        // Tab tồn tại nhưng inactive → tạm activate cho upload
        // Lưu tab đang active hiện tại để restore sau
        const [currentActiveTab] = await chrome.tabs.query({ active: true, windowId: flowTab.windowId });
        const previousTabId = currentActiveTab?.id || null;

        // Activate Flow tab
        await chrome.tabs.update(flowTab.id, { active: true });
        // Chờ React rendering wake up (Chrome unthrottle ngay khi tab active)
        await new Promise(r => setTimeout(r, 600));

        // Sau khi activate → ping + inject nếu cần
        const ready = await _ensureContentScriptReady(flowTab.id);

        sendResponse({
          isOpen: true,
          tabId: flowTab.id,
          wasActivated: true,
          wasInjected: ready.injected,
          previousTabId
        });
      } catch (e) {
        // [P3 fix 2026-06-10] Log chi tiết error thay vì silent — admin trace upload fail.
        // Common causes: tab discarded (Memory Saver Chrome 110+), Chrome enterprise policy
        // block tab activation, content script inject fail.
        console.warn('[ensureFlowTabReady] Failed:', e?.message || e, {
          action: message.action,
          targetTabId: message.targetTabId,
          errorName: e?.name,
        });
        sendResponse({ isOpen: false, error: e?.message || 'unknown' });
      }
    })();
    return true;
  }

  // Ensure Flow tab active cho download (context menu cần tab active để React render menu)
  if (message.action === 'ensureFlowTabActive') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
        if (!tabs || tabs.length === 0) {
          sendResponse({ ok: false });
          return;
        }
        const flowTab = tabs.find(t => t.active) || tabs[0];
        if (flowTab.active) {
          sendResponse({ ok: true, tabId: flowTab.id, wasActivated: false });
          return;
        }
        await chrome.tabs.update(flowTab.id, { active: true });
        sendResponse({ ok: true, tabId: flowTab.id, wasActivated: true });
      } catch (e) {
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  // Restore tab sau khi upload xong (ImmediateUploader gọi sau upload)
  if (message.action === 'restorePreviousTab') {
    if (message.previousTabId) {
      chrome.tabs.update(message.previousTabId, { active: true }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#_ensureContentScriptReady', _e); });
    }
    sendResponse({ ok: true });
    return true;
  }

  // Browser zoom THẬT (chrome.tabs.setZoom) — giống Cmd/Ctrl + "-", KHÁC document.body.style.zoom.
  // CSS zoom không kích hoạt Flow virtual-scroll render thêm tile ở cuối; browser zoom thì có.
  // Gọi từ content script (Flow tab) → sender.tab.id chính là Flow tab.
  if (message.action === 'getBrowserZoom') {
    (async () => {
      try {
        let tabId = sender.tab?.id;
        if (tabId == null) {
          const tabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
          tabId = (tabs.find(t => t.active) || tabs[0])?.id;
        }
        if (tabId == null) { sendResponse({ zoom: null }); return; }
        const z = await chrome.tabs.getZoom(tabId);
        sendResponse({ zoom: typeof z === 'number' ? z : null, tabId });
      } catch (e) { sendResponse({ zoom: null }); }
    })();
    return true;
  }
  if (message.action === 'setBrowserZoom') {
    (async () => {
      try {
        let tabId = message.tabId ?? sender.tab?.id;
        if (tabId == null) {
          const tabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
          tabId = (tabs.find(t => t.active) || tabs[0])?.id;
        }
        if (tabId == null) { sendResponse({ ok: false }); return; }
        await chrome.tabs.setZoom(tabId, message.factor);
        sendResponse({ ok: true, tabId });
      } catch (e) { sendResponse({ ok: false, error: e?.message }); }
    })();
    return true;
  }

  // ===== Image-to-Prompt (I2P) handlers =====
  // Trả config (default provider + prompt template) từ server cho i2p-content card.
  if (message.action === 'i2p:getConfig') {
    (async () => { try { sendResponse({ ok: true, config: await _i2pGetConfig() }); } catch (e) { sendResponse({ ok: false, error: e.message }); } })();
    return true;
  }
  // SSE default_settings_updated (relay từ sidebar) → xoá cache i2p để lần getConfig sau lấy mới.
  if (message.action === 'i2p:invalidateConfig') {
    _i2pConfigCache = null; _i2pConfigAt = 0;
    _paConfigCache = null; _paConfigAt = 0; // pa dùng chung endpoint default-settings
    sendResponse({ ok: true });
    return true;
  }
  // Prompt Assistant: lấy config (template + default settings A→E) từ server.
  if (message.action === 'pa:getConfig') {
    (async () => { try { sendResponse({ ok: true, config: await _paGetConfig() }); } catch (e) { sendResponse({ ok: false, error: e.message }); } })();
    return true;
  }
  // Prompt Assistant: lấy danh sách content formats (server-driven, giống addon-prompts).
  if (message.action === 'pa:getFormats') {
    (async () => { try { sendResponse({ ok: true, formats: await _paGetFormats() }); } catch (e) { sendResponse({ ok: false, error: e.message }); } })();
    return true;
  }
  // Prompt Assistant: invalidate formats cache (gọi từ SseClient khi admin sửa format) → reload fresh.
  if (message.action === 'pa:invalidateFormats') {
    _paFormatsCache = null; _paFormatsAt = 0;
    sendResponse({ ok: true });
    return;
  }
  // Prompt Assistant: active tab provider ở bước reconfirm (giống GenTab — tab sẵn sàng khi confirm xong).
  if (message.action === 'pa:activateTab') {
    (async () => {
      try { await _i2pEnsureProviderTab(['gemini', 'chatgpt', 'claude', 'grok'].includes(message.provider) ? message.provider : 'chatgpt'); sendResponse({ ok: true }); }
      catch (e) { sendResponse({ ok: false, error: e.message }); }
    })();
    return true;
  }
  // Prompt Assistant: submit meta-prompt (client build) + ref images → provider → đọc text result về.
  // Tái dùng infra i2p (_i2pEnsureProviderTab + _i2pSendAnalyze) + action chung provider:textTask.
  if (message.action === 'pa:generate') {
    (async () => {
      try {
        // Enforcement backstop (UI gate ở PromptAssistantModal.open là chính; đây chặn bypass message trực tiếp).
        const acc = await _featureAllowed('prompt_assistant_enabled');
        if (!acc.allowed) { sendResponse({ success: false, error: 'FEATURE_LOCKED' }); return; }
        const provider = ['gemini', 'chatgpt', 'claude', 'grok'].includes(message.provider) ? message.provider : 'chatgpt';
        const metaPrompt = (message.metaPrompt || '').trim();
        if (!metaPrompt) { sendResponse({ success: false, error: 'NO_PROMPT' }); return; }
        // Modal chạy trong side panel → sender.tab undefined. Capture active tab để restore focus sau.
        let srcTabId = sender?.tab?.id || null;
        let srcWinId = sender?.tab?.windowId || null;
        if (!srcTabId) {
          try {
            const win = await chrome.windows.getLastFocused();
            const [act] = await chrome.tabs.query({ active: true, windowId: win.id });
            if (act) { srcTabId = act.id; srcWinId = act.windowId; }
          } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        }
        const { tabId, created } = await _i2pEnsureProviderTab(provider);
        // 2026-06-16: PA chạy biệt lập (hội thoại MỚI) — giống i2p, KHÔNG reload trang (tránh upload fail).
        // Content tự mở chat mới SPA qua newChat flag; tabFreshlyCreated cho biết tab vừa tạo (delete an toàn).
        const payload = {
          action: 'provider:textTask',
          text: metaPrompt,
          images: Array.isArray(message.images) ? message.images : [],
          timeout: message.timeout || 120000,
          deleteAfter: !!message.deleteAfter,
          newChat: true,
          tabFreshlyCreated: created,
        };
        let result = await _i2pSendAnalyze(tabId, payload, created);
        if (result?.error === 'PROVIDER_NOT_READY' && !created) {
          console.warn('[PA] provider content script stale → reload tab + retry');
          try { await chrome.tabs.reload(tabId); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
          result = await _i2pSendAnalyze(tabId, payload, true);
        }
        if (srcTabId) {
          try { await chrome.tabs.update(srcTabId, { active: true }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
          try { if (srcWinId != null) await chrome.windows.update(srcWinId, { focused: true }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        }
        sendResponse(result);
      } catch (e) {
        sendResponse({ success: false, error: 'ORCHESTRATE_FAIL', message: e.message });
      }
    })();
    return true;
  }
  // Status từng provider: tab mở chưa + ĐÃ SẴN SÀNG chưa (có composer = đã đăng nhập, dùng được).
  // executeScript kiểm tra composer element → ready=true mới analyze được.
  if (message.action === 'i2p:checkProviders') {
    (async () => {
      const out = {};
      // Probe status 4 provider (composer ready = đã login/dùng được) → PA form dot đúng cho cả 4.
      // (i2p CHỈ upload ảnh qua Gemini+ChatGPT — nó tự lọc ở _i2pEnsureProviderTab; probe thêm
      //  Grok/Claude chỉ để status dot PA không xám oan khi đã login, KHÔNG đổi hành vi i2p.)
      const _READY_SEL = {
        chatgpt: '#prompt-textarea, .ProseMirror[contenteditable="true"], div[contenteditable="true"]',
        gemini: 'rich-textarea .ql-editor, .ql-editor[contenteditable="true"], [contenteditable="true"][role="textbox"]',
        grok: 'form div[contenteditable="true"], .ProseMirror, .tiptap, textarea',
        claude: 'div.ProseMirror[contenteditable="true"], div[contenteditable="true"][translate="no"], div[contenteditable="true"]',
      };
      for (const p of ['gemini', 'chatgpt', 'grok', 'claude']) {
        try {
          const tabs = await chrome.tabs.query({ url: PROVIDER_URLS[p].tabQuery });
          const tab = tabs && tabs.length ? (tabs.find(t => t.active) || tabs[0]) : null;
          if (!tab) { out[p] = { tabOpen: false, ready: false }; continue; }
          const sel = _READY_SEL[p] || _READY_SEL.chatgpt;
          let ready = false;
          try {
            const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, args: [sel], func: (s) => !!document.querySelector(s) });
            ready = !!(r && r[0] && r[0].result);
          } catch (_) { /* tab redirect login/cloudflare → executeScript fail → ready=false */ }
          out[p] = { tabOpen: true, ready };
        } catch (_) { out[p] = { tabOpen: false, ready: false }; }
      }
      sendResponse({ ok: true, providers: out });
    })();
    return true;
  }
  // Watermark inject: fetch ảnh http(s) cross-origin (content script bị CORS) → base64 cho content clean.
  if (message.action === 'wm:fetchImage') {
    if (!_isTrustedSender(sender)) { sendResponse({ ok: false, error: 'Untrusted sender' }); return true; }
    (async () => {
      try {
        var url = String(message.url || '');
        if (!/^https?:\/\//i.test(url)) { sendResponse({ ok: false, error: 'BAD_URL' }); return; }
        var resp = await fetch(url);
        if (!resp.ok) { sendResponse({ ok: false, error: 'HTTP_' + resp.status }); return; }
        var buf = new Uint8Array(await resp.arrayBuffer());
        var bin = ''; for (var i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
        sendResponse({ ok: true, base64: btoa(bin), type: resp.headers.get('content-type') || 'image/png' });
      } catch (e) { sendResponse({ ok: false, error: (e && e.message) || 'EXCEPTION' }); }
    })();
    return true;
  }
  // Fetch + downscale ảnh trong background (host <all_urls> → bỏ qua page CORS, parity PromptCard).
  // Fallback cuối khi content-script canvas bị taint. Trả { base64(raw), name, type }.
  if (message.action === 'i2p:fetchImage') {
    if (!_isTrustedSender(sender)) { sendResponse({ ok: false, error: 'Untrusted sender' }); return true; }
    (async () => {
      try {
        if (!_isAllowedUrl(message.srcUrl)) { sendResponse({ ok: false, error: 'URL not allowed' }); return; }
        const maxPx = Number(message.maxPx) || 1536;
        const resp = await fetch(message.srcUrl);
        if (!resp.ok) { sendResponse({ ok: false, error: 'HTTP_' + resp.status }); return; }
        const blob = await resp.blob();
        let outBlob = blob;
        try {
          const bmp = await createImageBitmap(blob);
          const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
          const cw = Math.max(1, Math.round(bmp.width * scale));
          const ch = Math.max(1, Math.round(bmp.height * scale));
          const oc = new OffscreenCanvas(cw, ch);
          const ctx = oc.getContext('2d');
          ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); // nền trắng (JPEG không alpha)
          ctx.drawImage(bmp, 0, 0, cw, ch);
          // JPEG: photo PNG nặng → upload attach không kịp → submit text-only.
          outBlob = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        } catch (_) { /* downscale fail → dùng blob gốc */ }
        const buf = await outBlob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        const type = outBlob.type || 'image/jpeg';
        const ext = type.includes('png') ? 'png' : (type.includes('webp') ? 'webp' : 'jpg');
        sendResponse({ ok: true, image: { base64: btoa(bin), name: 'i2p.' + ext, type } });
      } catch (e) { sendResponse({ ok: false, error: e.message }); }
    })();
    return true;
  }
  // Region screenshot: chụp vùng nhìn thấy của tab user + crop theo rect (CSS px × dpr) → base64.
  if (message.action === 'i2p:captureRegion') {
    if (!_isTrustedSender(sender)) { sendResponse({ ok: false, error: 'Untrusted sender' }); return true; }
    (async () => {
      try {
        const rect = message.rect || {};
        const winId = sender?.tab?.windowId;
        const dataUrl = await chrome.tabs.captureVisibleTab(winId, { format: 'png' });
        const blob = await (await fetch(dataUrl)).blob();
        const bmp = await createImageBitmap(blob);
        const dpr = rect.dpr || 1;
        const sx = Math.max(0, Math.round(rect.x * dpr)), sy = Math.max(0, Math.round(rect.y * dpr));
        const sw = Math.max(1, Math.round(rect.w * dpr)), sh = Math.max(1, Math.round(rect.h * dpr));
        // Downscale cạnh dài về maxImagePx (parity với path context-menu) → ảnh retina full-res
        // nhiều MB hay fail upload paste/drag ở ChatGPT/Gemini → bóp nhỏ cho ổn định + tiết kiệm token.
        const _cfg = await _i2pGetConfig();
        const maxPx = _cfg.maxImagePx || 1536;
        const scale = Math.min(1, maxPx / Math.max(sw, sh));
        const dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale));
        const oc = new OffscreenCanvas(dw, dh);
        const ctx = oc.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, dw, dh); // nền trắng (JPEG không alpha)
        ctx.drawImage(bmp, sx, sy, sw, sh, 0, 0, dw, dh);
        // JPEG thay PNG: screenshot photographic PNG nặng vài MB → upload paste ChatGPT/Gemini
        // attach không kịp trước submit → prompt gửi text-only. JPEG nhỏ hơn nhiều → attach ổn định.
        const outBlob = await oc.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        const buf = await outBlob.arrayBuffer(); const bytes = new Uint8Array(buf);
        let bin = ''; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
        sendResponse({ ok: true, image: { base64: btoa(bin), name: 'i2p-region.jpg', type: 'image/jpeg' } });
      } catch (e) { sendResponse({ ok: false, error: e.message }); }
    })();
    return true;
  }
  // Hủy phân tích đang chạy → gửi abort tới tab provider (ChatGPT có; Gemini bỏ qua).
  if (message.action === 'i2p:cancel') {
    (async () => {
      const p = message.provider === 'chatgpt' ? 'chatgpt' : 'gemini';
      try {
        const tabs = await chrome.tabs.query({ url: PROVIDER_URLS[p].tabQuery });
        const tab = tabs && tabs.length ? (tabs.find(t => t.active) || tabs[0]) : null;
        if (tab) chrome.tabs.sendMessage(tab.id, { action: p + ':abort' }, () => void chrome.runtime.lastError);
      } catch (_) { /* owned suppression (P4.T7): silent by design */ }
      sendResponse({ ok: true });
    })();
    return true;
  }
  // i2p feature gate: check entitlement `i2p_enabled` (content script không có window.featureGate).
  // Cache-first (af_entitlements do sidebar populate) → fallback fetch /entitlements khi cache miss
  // (tránh false-gate user có quyền chưa mở sidebar). Trả {loggedIn, allowed} cho card render login/upgrade.
  if (message.action === 'i2p:checkAccess') {
    (async () => {
      const r = await _featureAllowed('i2p_enabled');
      sendResponse({ ok: true, loggedIn: r.loggedIn, allowed: r.allowed });
    })();
    return true;
  }
  // i2p gate action: mở side panel cho tab hiện tại.
  if (message.action === 'i2p:openApp') {
    (async () => {
      const curTabId = sender?.tab?.id;
      try { if (curTabId && chrome.sidePanel?.open) await chrome.sidePanel.open({ tabId: curTabId }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
      sendResponse({ ok: true });
    })();
    return true;
  }
  // Mở tab provider để user đăng nhập.
  if (message.action === 'i2p:openProviderLogin') {
    const p = message.provider;
    if (PROVIDER_URLS[p]) {
      openOrActivateTab(PROVIDER_URLS[p].tabQuery, PROVIDER_URLS[p].createUrl, true).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#func', _e); });
    }
    sendResponse({ ok: true });
    return true;
  }
  // Closed-loop: đổ prompt vào GenTab + mở Flow. Sidebar mở → fill ngay; đóng → lưu pending,
  // drain khi sidebar init (_processPendingI2pPrompt).
  // [U2] Phân tích ảnh → gửi prompt vào NODE workflow (khác genOnFlow = ô prompt GenTab).
  // Stage vào storage → WorkflowEditor drain (onChanged nếu đang mở; setTimeout nếu mở sau).
  if (message.action === 'i2p:genToNode') {
    (async () => {
      const text = message.prompt || '';
      if (!text) { sendResponse({ ok: false, error: 'NO_PROMPT' }); return; }
      try { await chrome.storage.local.set({ i2p_pending_node_prompt: { text, at: Date.now() } }); } catch (_) { /* owned suppression */ }
      sendResponse({ ok: true });
    })();
    return true;
  }
  if (message.action === 'i2p:genOnFlow') {
    (async () => {
      // CRITICAL: mở side panel NGAY (await đầu tiên) để giữ user-gesture — đồng bộ với i2p:openApp
      // (login-btn). Nếu await _featureAllowed/storage.set trước thì gesture mất → sidePanel.open fail.
      const curTabId = sender?.tab?.id;
      try { if (curTabId && chrome.sidePanel?.open) await chrome.sidePanel.open({ tabId: curTabId }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
      // Enforcement backstop: chặn reuse prompt cũ từ history khi đang gated (race header History).
      const acc = await _featureAllowed('i2p_enabled');
      if (!acc.allowed) { sendResponse({ ok: false, error: 'FEATURE_LOCKED' }); return; }
      const text = message.prompt || '';
      if (!text) { sendResponse({ ok: false, error: 'NO_PROMPT' }); return; }
      try { await chrome.storage.local.set({ i2p_pending_prompt: { text } }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
      // Sidebar đang/đã mở → fill ngay (handler i2p:setGenPrompt tự clear pending).
      chrome.runtime.sendMessage({ action: 'i2p:setGenPrompt', text }, () => void chrome.runtime.lastError);
      sendResponse({ ok: true });
    })();
    return true;
  }
  // 1.1.47 port: gửi ảnh từ i2p card sang GenTab (upload local lazy). base64 sẵn có → dispatch;
  // else fetch srcUrl. Mở side panel NGAY (await đầu tiên) để giữ user-gesture — đồng bộ i2p:genOnFlow.
  if (message.action === 'i2p:sendImageToGen') {
    (async () => {
      const tabId = sender?.tab?.id;
      try { if (tabId && chrome.sidePanel?.open) await chrome.sidePanel.open({ tabId }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
      const img = message.base64
        ? { base64: message.base64, name: message.name || `gen_ref_${Date.now()}.jpg`, type: message.type || 'image/jpeg' }
        : (message.srcUrl ? await _fetchImageAsBase64(message.srcUrl, 2048, 0.92) : null);
      if (!img) { sendResponse({ ok: false }); return; }
      await _dispatchLocalImageToGen(img);
      sendResponse({ ok: true });
    })();
    return true;
  }
  // Orchestrate phân tích: image + provider → mở tab provider → i2p:analyze (template từ server) → text.
  if (message.action === 'i2p:analyze') {
    (async () => {
      try {
        // Enforcement backstop: chặn mọi đường bypass UI (vd re-analyze từ history khi đang gated).
        const acc = await _featureAllowed('i2p_enabled');
        if (!acc.allowed) { sendResponse({ success: false, error: 'FEATURE_LOCKED' }); return; }
        const provider = message.provider === 'chatgpt' ? 'chatgpt' : 'gemini';
        const cfg = await _i2pGetConfig();
        if (!cfg.promptTemplate) { sendResponse({ success: false, error: 'CONFIG_MISSING', message: 'Chưa tải được cấu hình prompt từ server' }); return; }
        if (!message.image || !message.image.base64) { sendResponse({ success: false, error: 'NO_IMAGE' }); return; }
        // Tab user đang xem (nơi card hiển thị) — để restore focus sau khi analyze xong.
        const srcTabId = sender?.tab?.id;
        const srcWinId = sender?.tab?.windowId;
        const { tabId, created } = await _i2pEnsureProviderTab(provider);
        // 2026-06-16: i2p chạy biệt lập (hội thoại MỚI) — KHÔNG reload trang (reload làm composer/upload
        // chưa hydrate → upload ref ảnh fail, bug tái đi tái lại). Content script tự mở chat mới kiểu SPA
        // qua newChat flag. tabFreshlyCreated báo content biết tab vừa tạo → an toàn cho deleteAfter.
        // i2p mặc định model ChatGPT = Instant (nhanh, không thinking delay — phù hợp tác vụ đọc ảnh → text).
        const payload = { action: 'provider:textTask', text: cfg.promptTemplate, images: [message.image], timeout: cfg.timeoutMs || 180000, deleteAfter: !!cfg.deleteAfter, newChat: true, tabFreshlyCreated: created, model: provider === 'chatgpt' ? 'Instant' : undefined };
        let result = await _i2pSendAnalyze(tabId, payload, created);
        // PROVIDER_NOT_READY trên tab CÓ SẴN = content script cũ (mở trước khi reload/update extension,
        // guard chặn inject handler i2p:analyze mới). Reload tab 1 lần để nạp script mới rồi retry.
        if (result?.error === 'PROVIDER_NOT_READY' && !created) {
          console.warn('[I2P] provider content script stale → reload tab + retry');
          try { await chrome.tabs.reload(tabId); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
          result = await _i2pSendAnalyze(tabId, payload, true); // created=true → chờ inject lâu hơn
        }
        // Restore focus về tab user (provider tab được activate để lấy result → trả lại tab cũ).
        if (srcTabId) {
          try { await chrome.tabs.update(srcTabId, { active: true }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
          try { if (srcWinId != null) await chrome.windows.update(srcWinId, { focused: true }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        }
        sendResponse(result);
      } catch (e) {
        sendResponse({ success: false, error: 'ORCHESTRATE_FAIL', message: e.message });
      }
    })();
    return true;
  }

  // PQ: Pipeline control từ FloatingTracker trong content script → relay to sidePanel
  if (message.action === 'pq:stopAll') {
    chrome.runtime.sendMessage({ action: 'queue:stop_all' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#func', _e); });
    sendResponse({ ok: true });
    return true;
  }
  if (message.action === 'pq:stopJob') {
    chrome.runtime.sendMessage({ action: 'queue:stop_job', jobId: message.jobId }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#func', _e); });
    sendResponse({ ok: true });
    return true;
  }
  if (message.action === 'pq:pauseJob') {
    chrome.runtime.sendMessage({ action: 'queue:pause_job', jobId: message.jobId }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#func', _e); });
    sendResponse({ ok: true });
    return true;
  }
  if (message.action === 'pq:resumeJob') {
    chrome.runtime.sendMessage({ action: 'queue:resume_job', jobId: message.jobId }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#func', _e); });
    sendResponse({ ok: true });
    return true;
  }

  // ExecutionLock broadcast relay — popup ↔ sidePanel cross-window sync
  if (message.action === 'execution:lock_broadcast') {
    // Relay to all contexts (sidePanel sẽ nhận và emit lên local eventBus)
    chrome.runtime.sendMessage(message).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#func', _e); });
    sendResponse({ ok: true });
    return true;
  }

  // ExecutionTracker broadcast relay — popup → sidePanel tracker update
  if (message.action === 'execution:tracker_broadcast') {
    chrome.runtime.sendMessage(message).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#func', _e); });
    sendResponse({ ok: true });
    return true;
  }

  // Đóng các tabs thừa của 1 provider (giữ tabs[0], close phần còn lại).
  // Trigger từ UI duplicate warning button "Đóng tabs thừa" (2026-05-22).
  if (message.action === 'closeExtraProviderTabs') {
    (async () => {
      try {
        const provider = message.provider;
        const urlPatterns = {
          flow: PROVIDER_URLS.flow.tabQuery,
          chatgpt: PROVIDER_URLS.chatgpt.tabQuery,
          grok: PROVIDER_URLS.grok.tabQuery,
          gemini: PROVIDER_URLS.gemini.tabQuery,
        };
        const pattern = urlPatterns[provider];
        if (!pattern) {
          sendResponse({ ok: false, error: 'Unknown provider', closed: 0 });
          return;
        }
        const tabs = await chrome.tabs.query({ url: pattern });
        if (!tabs || tabs.length <= 1) {
          sendResponse({ ok: true, closed: 0, kept: tabs?.[0]?.id || null });
          return;
        }
        // Giữ tab đầu tiên (theo Chrome tabs.query order — thường là tab cũ nhất)
        const keepTab = tabs[0];
        const extras = tabs.slice(1);
        const extrasIds = extras.map(t => t.id).filter(Boolean);
        if (extrasIds.length > 0) {
          await chrome.tabs.remove(extrasIds);
        }
        console.log(`[SEOSONA Flow] closeExtraProviderTabs(${provider}): closed ${extrasIds.length} extras, kept tabId=${keepTab.id}`);
        sendResponse({ ok: true, closed: extrasIds.length, kept: keepTab.id });
      } catch (e) {
        console.warn('[SEOSONA Flow] closeExtraProviderTabs error:', e.message);
        sendResponse({ ok: false, error: e.message, closed: 0 });
      }
    })();
    return true;
  }

  // Query số lượng tabs đang mở của 1 provider (flow/chatgpt/grok)
  // Dùng cho duplicate-tab warning trong UI khi user click provider tab.
  if (message.action === 'queryProviderTabs') {
    (async () => {
      try {
        const provider = message.provider;
        const urlPatterns = {
          flow: PROVIDER_URLS.flow.tabQuery,
          chatgpt: PROVIDER_URLS.chatgpt.tabQuery,
          grok: PROVIDER_URLS.grok.tabQuery,
          gemini: PROVIDER_URLS.gemini.tabQuery,
        };
        const pattern = urlPatterns[provider];
        if (!pattern) {
          sendResponse({ count: 0, error: 'Unknown provider' });
          return;
        }
        const tabs = await chrome.tabs.query({ url: pattern });
        sendResponse({ count: tabs?.length || 0, tabs: (tabs || []).map(t => ({ id: t.id, url: t.url })) });
      } catch (e) {
        sendResponse({ count: 0, error: e.message });
      }
    })();
    return true;
  }

  // Activate Flow tab when execution starts (any module)
  if (message.action === 'activateFlowTabForExecution') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
        if (!tabs || tabs.length === 0) {
          sendResponse({ ok: false, error: 'No Flow tab found' });
          return;
        }
        // tabId (per-submit anti-bot, 2026): activate ĐÚNG tab đang gen (tránh activate nhầm khi
        // user mở nhiều tab Flow). Không truyền tabId → giữ hành vi cũ (active/first).
        const flowTab = (message.tabId && tabs.find(t => t.id === message.tabId))
          || tabs.find(t => t.active) || tabs[0];
        if (!flowTab.active) {
          await chrome.tabs.update(flowTab.id, { active: true });
        }
        // focusWindow (MCP): đưa cửa sổ Chrome lên foreground. MCP gọi khi user ở app khác (Claude)
        // → cửa sổ Chrome nền → browser throttle timers/DOM của tab nền → thao tác editor không ổn định.
        // Focus cửa sổ để DOM un-throttle. GenTab/Workflow không truyền cờ này (user đã ở Chrome).
        if (message.focusWindow) {
          try { await chrome.windows.update(flowTab.windowId, { focused: true }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        }
        sendResponse({ ok: true, tabId: flowTab.id });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // Phase 5 (Manual Submit workflow): sau khi user submit thủ công ở tab Flow → đưa cửa sổ
  // workflow editor popup lên foreground. Chỉ focus khi workflowWindowId còn tồn tại (đang mở);
  // chạy từ sidebar / không có popup → id null → no-op (đúng quyết định §12.4 sidebar = no-op).
  if (message.action === 'focusWorkflowWindow') {
    (async () => {
      try {
        if (workflowWindowId !== null) {
          const win = await chrome.windows.get(workflowWindowId).catch(() => null);
          if (win) {
            await chrome.windows.update(workflowWindowId, { focused: true });
            sendResponse({ ok: true, focused: true });
            return;
          }
          workflowWindowId = null; // stale → clear
        }
        sendResponse({ ok: true, focused: false });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // Send webhook notification (proxy from content script)
  if (message.action === 'sendWebhook') {
    if (!_isTrustedSender(sender)) { sendResponse({ success: false, error: 'Untrusted sender' }); return true; }
    const { url, data } = message;
    if (!_isAllowedUrl(url)) {
      sendResponse({ success: false, error: 'URL not allowed' });
      return true;
    }
    (async () => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        sendResponse({ success: response.ok, status: response.status });
      } catch (err) {
        console.warn('[SEOSONA Flow] Webhook send failed:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // Chuẩn bị rename cho download tiếp theo từ Flow
  if (message.action === 'prepareDownloadRename') {
    // Bug fix 2026-06-04: TTL 30s → 5 phút. Flow batch gen multi-prompt (vd 70 prompts)
    // có thể delay > 30s giữa lúc content.js push entry vs lúc Flow render tile + trigger
    // download thực tế (Flow throttle, queue, gen chậm) → entry expire → no rename → file
    // save vào ~/Downloads/ default với filename gốc Flow. User thấy "chỉ 10 cuối có rename".
    // 5 phút đủ cover batch lớn + identifier match dedup tránh collision với job khác.
    const renameEntry = {
      folder: message.folder || '',
      filename: message.filename || '',
      identifier: message.identifier || message.filename || '', // Match bằng filename nếu không có identifier riêng
      expires: Date.now() + 300000, // 5 phút — cover Flow batch gen delay
      // Tab nào yêu cầu — cần để gửi video về đúng trang mà xử lý (xoá watermark).
      tabId: sender?.tab?.id ?? null,
      // Cờ CHỐNG LẶP: bản đã xoá watermark cũng tải bằng <a download> nên sẽ chạy lại qua
      // onDeterminingFilename. Không đánh dấu là nó tự chặn chính nó, lặp vô tận.
      wmDone: !!message.wmDone,
    };
    _pendingDownloadRenames.push(renameEntry);
    _persistPendingRenames();
    console.log(`[SEOSONA Flow] prepareDownloadRename queued: folder="${message.folder}", filename="${message.filename}", identifier="${renameEntry.identifier}", queueSize=${_pendingDownloadRenames.length}`);
    sendResponse({ ok: true });
    return true;
  }

  // Download file via chrome.downloads API (reliable, handles Google CDN auth)
  // waitForComplete=true: đợi download hoàn tất mới trả response (dùng cho delete-after-gen flow)
  if (message.action === 'chromeDownload') {
    if (!_isTrustedSender(sender)) { sendResponse({ success: false, error: 'Untrusted sender' }); return true; }
    const { url, filename, waitForComplete } = message;

    // CRITICAL: Validate URL - reject placeholder/invalid URLs
    if (!url ||
        url.includes('media.html') ||
        url.endsWith('.html') ||
        (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('blob:'))) {
      console.warn(`[SEOSONA Flow] chromeDownload: invalid/placeholder URL rejected: ${url?.substring(0, 80)}`);
      sendResponse({ success: false, error: 'Invalid or placeholder URL rejected' });
      return true;
    }

    // Debug log filename — giúp debug case folder không respect
    console.log(`[SEOSONA Flow] chromeDownload: filename="${filename}", url="${url?.substring(0, 60)}...", waitForComplete=${!!waitForComplete}`);

    (async () => {
      try {
        // CRITICAL FIX: chrome.downloads.download không tự dùng filename nếu blob URL +
        // download item bị onDeterminingFilename listener khác override. Để chắc chắn filename
        // có folder path được Chrome respect, push vào _pendingDownloadRenames trước khi gọi
        // chrome.downloads.download — listener line 117 sẽ pick up và suggest() đúng path.
        if (filename && filename.includes('/')) {
          const lastSlash = filename.lastIndexOf('/');
          const folder = _sanitizePathSegment(filename.substring(0, lastSlash));
          const justFile = _sanitizePathSegment(filename.substring(lastSlash + 1)) || 'download';
          _pendingDownloadRenames.push({
            folder,
            filename: justFile,
            identifier: justFile,
            expires: Date.now() + 300000, // 5 phút — đồng bộ với prepareDownloadRename TTL
          });
          _persistPendingRenames();
          console.log(`[SEOSONA Flow] chromeDownload: queued rename folder="${folder}", file="${justFile}"`);
        }

        const downloadId = await chrome.downloads.download({
          url,
          filename: filename || undefined,
          conflictAction: 'uniquify'
        });

        // Nếu không cần đợi complete, trả về ngay
        if (!waitForComplete) {
          sendResponse({ success: true, downloadId });
          return;
        }

        // Đợi download hoàn tất qua chrome.downloads.onChanged
        const timeout = 30000; // 30s timeout
        const startTime = Date.now();

        const waitForDownloadComplete = () => {
          return new Promise((resolve, reject) => {
            const onChanged = (delta) => {
              if (delta.id !== downloadId) return;

              // Download hoàn tất
              if (delta.state?.current === 'complete') {
                chrome.downloads.onChanged.removeListener(onChanged);
                resolve({ success: true, downloadId, state: 'complete' });
              }
              // Download bị interrupt/cancel
              else if (delta.state?.current === 'interrupted') {
                chrome.downloads.onChanged.removeListener(onChanged);
                resolve({ success: false, downloadId, state: 'interrupted', error: delta.error?.current });
              }
            };

            chrome.downloads.onChanged.addListener(onChanged);

            // Timeout fallback
            setTimeout(() => {
              chrome.downloads.onChanged.removeListener(onChanged);
              // Check trạng thái hiện tại trước khi timeout
              chrome.downloads.search({ id: downloadId }, (items) => {
                if (items?.[0]?.state === 'complete') {
                  resolve({ success: true, downloadId, state: 'complete' });
                } else {
                  resolve({ success: false, downloadId, state: 'timeout', error: 'Download timeout' });
                }
              });
            }, timeout);
          });
        };

        const result = await waitForDownloadComplete();
        console.log(`[SEOSONA Flow] chromeDownload complete: id=${downloadId}, state=${result.state}`);
        sendResponse(result);
      } catch (err) {
        console.warn('[SEOSONA Flow] chrome.downloads failed:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // API proxy: chuyển tiếp request từ content script đến backend (tránh CORS)
  if (message.action === 'apiRequest') {
    if (!_isTrustedSender(sender)) { sendResponse({ success: false, error: { code: 'UNTRUSTED_SENDER', message: 'Untrusted sender' }, httpStatus: 403 }); return true; }
    const { method, endpoint, data, token, headers: extraHeaders, isFormData, formDataFields } = message;

    // [Fix cascade] Global rate-limit cooldown — bắt mọi caller (cả _apiCall lẫn
    // anonymous direct sendMessage). Mọi endpoint auth/* bypass để user recover login.
    const isAuthEndpoint = endpoint && endpoint.startsWith('auth/');
    if (!isAuthEndpoint && globalThis._apiRateLimitedUntil > Date.now()) {
      const retryAfter = Math.ceil((globalThis._apiRateLimitedUntil - Date.now()) / 1000);
      sendResponse({
        success: false,
        error: { code: 'RATE_LIMITED', message: `Too many requests, please try again later (${retryAfter}s)` },
        httpStatus: 429,
        // Bug fix 2026-05-25: forward retry_after để caller (AuthManager) dùng đúng cooldown
        // server-side (vd 9s) thay vì fallback 60s default → freeze toàn bộ API quá lâu.
        retry_after: retryAfter,
        data: { retry_after: retryAfter },
      });
      return true;
    }

    // Device banned → chặn cứng MỌI request (kể cả unsigned ở log_only mode). Không gửi đi.
    // Recovery qua re-enroll (focus/activation/retry) → _clearDeviceBanned gỡ cờ.
    if (_deviceBanned) {
      sendResponse({
        success: false,
        error: { code: 'DEVICE_BANNED', message: 'Device has been banned' },
        httpStatus: 403,
      });
      return true;
    }

    (async () => {
      try {
        // LOCAL MODE (mặc định): KHÔNG gọi backend. Trả lỗi LOCAL_MODE ngay để caller degrade
        // (không fetch thật, không "Failed to fetch", không chờ timeout). Cờ do RuntimeMode.js ghi
        // vào chrome.storage.local; mặc định local nếu key chưa tồn tại.
        const _localMode = await new Promise(r => chrome.storage.local.get(['SEOSONA_LOCAL_MODE'], x => r(x.SEOSONA_LOCAL_MODE)));
        if (_localMode !== false) {
          sendResponse({ success: false, error: { code: 'LOCAL_MODE', message: 'backend disabled' }, httpStatus: 0 });
          return;
        }
        // Phase 3.5 Bug I: dùng getApiBaseUrl() helper thay vì hardcoded fallback
        const stored = await new Promise(resolve => {
          chrome.storage.local.get(['af_auth'], result => resolve(result.af_auth || {}));
        });
        const apiBaseUrl = stored.apiBaseUrl || getApiBaseUrl();
        // H1 (partial): auth-bearing requests over cleartext HTTP leak token/signature. Keep
        // localhost default for dev, but warn loudly if a non-localhost base is non-https.
        try {
          const _b = new URL(apiBaseUrl);
          const _localHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
          if (_b.protocol !== 'https:' && !_localHosts.includes(_b.hostname)) {
            console.warn(`[SEOSONA Flow] SECURITY: API base "${_b.origin}" is non-HTTPS; auth token/signature sent in cleartext. Configure an HTTPS apiBaseUrl.`);
          }
        } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        const url = `${apiBaseUrl}/${endpoint}`;

        // Chuẩn bị headers
        // Lưu ý: Nếu là FormData thì KHÔNG set Content-Type để browser tự thêm boundary
        const headers = {
          'Accept': 'application/json',
          'X-Extension-Id': chrome.runtime.id
        };
        if (!isFormData) {
          headers['Content-Type'] = 'application/json';
        }
        // Gửi version để backend filter node types tương thích (workflow_node_types)
        // Ext cũ (1.0.4) sẽ KHÔNG nhận types có min_extension_version > '1.0.4'
        try {
          const extVersion = chrome.runtime.getManifest()?.version;
          if (extVersion) headers['X-Ext-Version'] = extVersion;
        } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
        // Forward extra headers từ caller (vd: X-Fingerprint cho UsageSync anonymous)
        if (extraHeaders && typeof extraHeaders === 'object') {
          for (const [k, v] of Object.entries(extraHeaders)) {
            if (typeof v === 'string') headers[k] = v;
          }
        }

        // Chuẩn bị fetch options
        // [Fix cache] cache: 'no-store' để Chrome KHÔNG cache response theo URL.
        // Nếu không: login với token A → cache plan=free. Sau logout, anonymous call
        // cùng URL /entitlements → Chrome serve lại plan=free từ cache → UI revert sai.
        const fetchOptions = { method, headers, cache: 'no-store' };
        if ((data || formDataFields) && method !== 'GET' && method !== 'HEAD') {
          // Hỗ trợ FormData upload (EWT-4): khi isFormData=true, formDataFields chứa
          // thông tin file đã encode base64 (vì FormData không serialize qua message)
          // Format: { file: { name, type, base64 }, ...otherFields }
          if (isFormData && formDataFields) {
            const formData = new FormData();
            for (const [key, value] of Object.entries(formDataFields)) {
              if (value && typeof value === 'object' && value.base64 && value.type) {
                // Đây là file, convert base64 → Blob
                const byteString = atob(value.base64);
                const ab = new ArrayBuffer(byteString.length);
                const ia = new Uint8Array(ab);
                for (let i = 0; i < byteString.length; i++) {
                  ia[i] = byteString.charCodeAt(i);
                }
                const blob = new Blob([ab], { type: value.type });
                formData.append(key, blob, value.name || 'file');
              } else {
                // Field thường
                formData.append(key, value);
              }
            }
            fetchOptions.body = formData;
          } else if (data) {
            fetchOptions.body = JSON.stringify(data);
          }
        }

        // Sprint 2 (HMAC): ký request với enrollment secret.
        // Skip cho /enroll (chicken-and-egg — chưa có secret) và FormData uploads
        // (multipart body khó hash deterministic + endpoints này đều auth nên không vào
        // verify.signature group). Sai mismatch trong log_only mode chỉ tạo log warn.
        const isEnrollEndpoint = typeof endpoint === 'string' && (endpoint === 'enroll' || endpoint.startsWith('enroll?'));
        let pathForSig = '';
        let bodyStringForSig = '';
        if (!isEnrollEndpoint && !isFormData) {
          try {
            pathForSig = new URL(url).pathname;
          } catch (_) {
            pathForSig = `/${String(endpoint || '').replace(/^\/+/, '')}`;
          }
          bodyStringForSig = (typeof fetchOptions.body === 'string') ? fetchOptions.body : '';
          const sigHeaders = await _buildSignatureHeaders(method || 'GET', pathForSig, bodyStringForSig);
          Object.assign(headers, sigHeaders);
        }

        let response = await fetch(url, fetchOptions);
        let httpStatus = response.status;

        // Sprint 2 (HMAC retry): nếu 403 với revoke codes → clear enrollment, re-enroll,
        // retry 1 lần với secret mới. Skip cho /enroll, FormData (body stream đã consumed).
        if (httpStatus === 403 && !isEnrollEndpoint && !isFormData) {
          let peekBody = null;
          try {
            peekBody = JSON.parse(await response.clone().text());
          } catch (_) { /* owned suppression (P4.T7): silent by design */ }
          const errCode = peekBody?.error?.code;
          if (errCode === 'CLIENT_BANNED' || errCode === 'DEVICE_BANNED') {
            // Hard-ban từ server → self-block (cờ + overlay + gate). KHÔNG clear enrollment /
            // re-enroll → giữ client_id để backend tiếp tục chặn (đóng unsigned bypass).
            // Recovery qua re-enroll probe (focus/activation/retry) khi admin restore.
            await _handleDeviceBanned(peekBody?.error?.message || 'banned');
          } else if (errCode && SIGNATURE_RETRY_CODES.has(errCode)) {
            console.warn('[Signature] 403', errCode, '→ re-enroll + retry once');
            await _clearEnrollment();
            const fresh = await _ensureEnrollment(true);
            if (fresh) {
              // Strip stale signature headers + apply fresh
              delete headers['X-Client-Id'];
              delete headers['X-Timestamp'];
              delete headers['X-Signature'];
              const newSig = await _buildSignatureHeaders(method || 'GET', pathForSig, bodyStringForSig);
              Object.assign(headers, newSig);
              response = await fetch(url, fetchOptions);
              httpStatus = response.status;
            }
          }
        }
        let body;

        // [Fix cascade] Set global cooldown ngay khi backend trả 429.
        // Đọc Retry-After header (số giây) hoặc default 60s.
        if (httpStatus === 429) {
          const retryAfterHeader = response.headers.get('Retry-After');
          const retryAfter = Number(retryAfterHeader) || 60;
          globalThis._apiRateLimitedUntil = Date.now() + retryAfter * 1000;
          _persistApiRateLimit(); // L8: survive SW suspension
          console.warn(`[SEOSONA Flow] API Proxy: 429 received, global cooldown set ${retryAfter}s`);
        }

        // Đọc response text trước, rồi parse JSON
        // Vì response body chỉ có thể đọc 1 lần, cần làm theo thứ tự này để có text khi JSON parse fail
        const responseText = await response.text();

        try {
          body = JSON.parse(responseText);
        } catch (parseErr) {
          // JSON parse failed — likely server returned HTML (error page, maintenance, redirect)
          const isHtml = responseText.trim().startsWith('<') || responseText.includes('<!DOCTYPE');
          const preview = responseText.substring(0, 200).replace(/\s+/g, ' ').trim();

          // Anti-clone short-circuit — backend luôn trả JSON, nhưng phòng trường hợp HTML 403
          // (vd reverse proxy intercept) → vẫn parse OK ở fallback bên dưới, skip ở đây.

          console.error(`[SEOSONA Flow] API Proxy: JSON parse failed for ${endpoint}`, JSON.stringify({
            status: httpStatus,
            isHtml,
            preview: preview || '(empty response)'
          }));

          // Tạo message có ích hơn cho user
          let userMessage = 'Phản hồi không phải JSON hợp lệ';
          if (httpStatus === 429) {
            userMessage = 'Too many requests, please try again later';
          } else if (httpStatus === 502 || httpStatus === 503 || httpStatus === 504) {
            userMessage = 'Server đang bảo trì hoặc quá tải, vui lòng thử lại sau';
          } else if (httpStatus === 500) {
            userMessage = 'Lỗi server nội bộ, vui lòng thử lại sau';
          } else if (isHtml) {
            userMessage = `Server trả về HTML thay vì JSON (HTTP ${httpStatus})`;
          }

          body = {
            success: false,
            error: {
              code: httpStatus === 429 ? 'RATE_LIMITED' : 'PARSE_ERROR',
              message: userMessage,
              debug: { httpStatus, isHtml, preview: preview.substring(0, 100) }
            }
          };
        }

        // Anti-clone: detect 403 DUMMY_FLAG → trigger clone-detected overlay.
        // Đặt sau JSON parse, trước success branch — chạy 1 lần cho mọi caller qua apiRequest.
        if (_isExtensionAuthRejection(body, httpStatus)) {
          _handleExtensionAuthRejection();
          sendResponse({
            success: false,
            error: body.error,
            httpStatus,
          });
          return;
        }

        if (body.success) {
          sendResponse({ success: true, data: body.data, meta: body.meta, httpStatus });
        } else {
          // Laravel unhandled exceptions trả `{message, exception, file, line, trace}` shape thay vì
          // convention `{success, error: {code, message, details}}`. Surface message để FE log
          // có context thay vì generic "Lỗi HTTP 500". Trace/file/line stripped khỏi response cho safety.
          let errorObj = body.error;
          if (!errorObj) {
            if (body.message || body.exception) {
              errorObj = {
                code: body.exception ? 'SERVER_EXCEPTION' : 'UNKNOWN',
                message: body.message || `Lỗi HTTP ${httpStatus}`,
                exception: body.exception, // Laravel exception class name (vd "Illuminate\\Database\\QueryException")
              };
            } else {
              errorObj = { code: 'UNKNOWN', message: `Lỗi HTTP ${httpStatus}` };
            }
          }
          // Bug fix 2026-05-25: 429 → include retry_after từ Retry-After header để caller
          // (AuthManager) dùng đúng cooldown server-side thay vì default 60s.
          const responsePayload = {
            success: false,
            error: errorObj,
            data: body.data || {},
            httpStatus,
          };
          if (httpStatus === 429) {
            const retryAfterHeader = response.headers.get('Retry-After');
            const retryAfter = Number(retryAfterHeader) || Number(body.data?.retry_after) || 60;
            responsePayload.retry_after = retryAfter;
            responsePayload.data = { ...(body.data || {}), retry_after: retryAfter };
          }
          sendResponse(responsePayload);
        }
      } catch (err) {
        console.error('[SEOSONA Flow] API Proxy: Lỗi kết nối', err.message);
        sendResponse({
          success: false,
          error: { code: 'NETWORK_ERROR', message: err.message || 'Không thể kết nối đến server' },
          httpStatus: 0
        });
      }
    })();

    // Trả về true để giữ sendResponse cho async callback
    return true;
  }

  // === Screen Capture Handler (Q2.2) ===
  // Capture the visible tab in the focused window
  // Supports capturing from any tab using optional_host_permissions
  if (message.action === 'captureScreen') {
    if (!_isTrustedSender(sender)) { sendResponse({ success: false, error: 'Untrusted sender' }); return true; }
    (async () => {
      try {
        // Global rate limiter: Chrome giới hạn ~2 captureVisibleTab calls/second
        const now = Date.now();
        if (globalThis._lastCaptureTime && (now - globalThis._lastCaptureTime) < 600) {
          const waitMs = 600 - (now - globalThis._lastCaptureTime);
          console.log(`[SEOSONA Flow] captureScreen rate limited, waiting ${waitMs}ms...`);
          await new Promise(r => setTimeout(r, waitMs));
        }
        globalThis._lastCaptureTime = Date.now();
        _persistLastCaptureTime(); // L8: survive SW suspension

        // Check if at least one Flow tab is open (required for uploading later)
        const flowTabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
        if (flowTabs.length === 0) {
          sendResponse({
            success: false,
            error: 'Chưa mở Google Flow. Cần mở labs.google/fx để upload ảnh chụp.',
            action: 'openFlow'
          });
          return;
        }

        // Get the currently focused window
        const focusedWindow = await chrome.windows.getLastFocused({ populate: true });
        if (!focusedWindow || !focusedWindow.tabs) {
          sendResponse({ success: false, error: 'Không tìm thấy cửa sổ đang active' });
          return;
        }

        // Find the active tab in this window
        const activeTab = focusedWindow.tabs.find(t => t.active);
        if (!activeTab) {
          sendResponse({ success: false, error: 'Không tìm thấy tab đang active' });
          return;
        }

        console.log(`[SEOSONA Flow] captureScreen: url=${activeTab.url?.substring(0, 50)}, windowId=${focusedWindow.id}`);

        // Helper function to attempt capture
        const attemptCapture = async () => {
          await chrome.windows.update(focusedWindow.id, { focused: true });
          await new Promise(r => setTimeout(r, 150));
          globalThis._lastCaptureTime = Date.now();
          _persistLastCaptureTime(); // L8: survive SW suspension
          return await chrome.tabs.captureVisibleTab(focusedWindow.id, { format: 'png' });
        };

        // Try to capture directly
        try {
          const dataUrl = await attemptCapture();
          sendResponse({ success: true, dataUrl, tabId: activeTab.id });
          return;
        } catch (e) {
          console.warn('[SEOSONA Flow] First capture attempt failed:', e.message);

          // Rate limit error → wait and retry
          if (/quota/i.test(e?.message)) {
            console.log('[SEOSONA Flow] Rate limit, waiting 1s...');
            await new Promise(r => setTimeout(r, 1000));
            globalThis._lastCaptureTime = Date.now();
            _persistLastCaptureTime(); // L8: survive SW suspension
            try {
              const dataUrl = await attemptCapture();
              sendResponse({ success: true, dataUrl, tabId: activeTab.id });
              return;
            } catch (e2) {
              console.warn('[SEOSONA Flow] Retry after rate limit failed:', e2.message);
            }
          }

          // Permission error → check if <all_urls> optional permission is granted
          if (/permission/i.test(e?.message)) {
            // Check if we have <all_urls> permission
            const hasAllUrls = await chrome.permissions.contains({ origins: ['<all_urls>'] });
            console.log('[SEOSONA Flow] Permission denied, hasAllUrls:', hasAllUrls);

            if (!hasAllUrls) {
              // Request user to grant optional permission
              sendResponse({
                success: false,
                error: 'Cần cấp quyền để chụp màn hình từ trang này.',
                action: 'requestCapturePermission'
              });
              return;
            }

            // Has permission but still failed - might be a special page (chrome://, etc.)
            sendResponse({
              success: false,
              error: 'Không thể chụp trang này (trang hệ thống hoặc trang đặc biệt).'
            });
            return;
          }

          // Other error
          sendResponse({
            success: false,
            error: 'Lỗi chụp màn hình: ' + (e?.message || 'Unknown error')
          });
        }
      } catch (err) {
        console.error('[SEOSONA Flow] captureScreen error:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // === Request Capture Permission Handler ===
  // Request optional <all_urls> permission for capturing any tab
  if (message.action === 'requestCapturePermission') {
    (async () => {
      try {
        // Check if already have permission
        const hasPermission = await chrome.permissions.contains({ origins: ['<all_urls>'] });
        if (hasPermission) {
          sendResponse({ success: true, granted: true, alreadyHad: true });
          return;
        }

        // Request permission - this will show Chrome's permission dialog
        const granted = await chrome.permissions.request({ origins: ['<all_urls>'] });
        console.log('[SEOSONA Flow] Capture permission request result:', granted);
        sendResponse({ success: true, granted });
      } catch (err) {
        console.error('[SEOSONA Flow] requestCapturePermission error:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // === Open Flow Tab Handler ===
  // Open Google Flow or activate existing tab (used when Flow is not open for capture)
  if (message.action === 'openFlowTab') {
    (async () => {
      try {
        const tab = await openOrActivateTab(PROVIDER_URLS.flow.tabQuery, PROVIDER_URLS.flow.createUrl);
        sendResponse({ success: true, tabId: tab.id });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // === Generic Open or Activate Tab Handler ===
  // Can be used for ChatGPT, Grok, Flow, etc.
  if (message.action === 'openOrActivateTab') {
    if (!_isTrustedSender(sender)) { sendResponse({ success: false, error: 'Untrusted sender' }); return true; }
    (async () => {
      try {
        const { urlPattern, createUrl, activate = true } = message;
        if (!urlPattern || !createUrl) {
          sendResponse({ success: false, error: 'Missing urlPattern or createUrl' });
          return;
        }
        // L9/M16: only allow http(s) target URLs for tab creation (block javascript:/data:/file:).
        let _createScheme = '';
        try { _createScheme = new URL(createUrl).protocol; } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        if (_createScheme !== 'http:' && _createScheme !== 'https:') {
          sendResponse({ success: false, error: 'Invalid createUrl scheme' });
          return;
        }
        const tab = await openOrActivateTab(urlPattern, createUrl, activate);
        sendResponse({ success: true, tabId: tab.id, url: tab.url });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // === Start Crop Selection on Active Tab (Q2.4) ===
  // Inject crop overlay into ANY active tab (not just Flow)
  if (message.action === 'startCropOnActiveTab') {
    if (!_isTrustedSender(sender)) { sendResponse({ success: false, error: 'Untrusted sender' }); return true; }
    (async () => {
      try {
        // Check if at least one Flow tab is open (required for uploading later)
        const flowTabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
        if (flowTabs.length === 0) {
          sendResponse({
            success: false,
            error: 'Chưa mở Google Flow. Cần mở labs.google/fx để upload ảnh chụp.',
            action: 'openFlow'
          });
          return;
        }

        // Get the currently focused window and active tab
        const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!activeTab || !activeTab.id) {
          sendResponse({ success: false, error: 'Không tìm thấy tab đang active' });
          return;
        }

        // Skip chrome:// and edge:// URLs (cannot inject)
        if (activeTab.url?.startsWith('chrome://') || activeTab.url?.startsWith('edge://') || activeTab.url?.startsWith('about:')) {
          sendResponse({ success: false, error: 'Không thể chụp trang hệ thống (chrome://, edge://)' });
          return;
        }

        // Get locale for translations
        const storage = await chrome.storage.local.get(['af_locale']);
        const locale = storage.af_locale || 'vi';

        // Capture overlay translations
        const captureI18n = {
          vi: { captureBtn: 'Chụp', cancelBtn: 'Hủy', namePlaceholder: 'Tên ảnh (cho @mention)', areaTooSmall: 'Vùng chọn quá nhỏ' },
          en: { captureBtn: 'Capture', cancelBtn: 'Cancel', namePlaceholder: 'Image name (for @mention)', areaTooSmall: 'Selection area too small' },


        };
        const t = captureI18n[locale] || captureI18n.vi;

        // Inject crop overlay script into the active tab
        const results = await chrome.scripting.executeScript({
          target: { tabId: activeTab.id },
          args: [t],
          func: (translations) => {
            return new Promise((resolve) => {
              // Remove existing overlay if any
              const existing = document.getElementById('seosonaflow-crop-overlay');
              if (existing) existing.remove();

              // S7.2: Default name với timestamp
              const defaultName = 'capture_' + Date.now().toString(36);

              // Create overlay
              const overlay = document.createElement('div');
              overlay.id = 'seosonaflow-crop-overlay';
              overlay.innerHTML = `
                <div class="seosonaflow-crop-selection" id="seosonaflow-crop-selection">
                  <div class="seosonaflow-crop-controls" id="seosonaflow-crop-controls">
                    <div class="seosonaflow-crop-name-row">
                      <input type="text" id="seosonaflow-crop-name-input" class="seosonaflow-crop-name-input"
                        placeholder="${translations.namePlaceholder}" value="${defaultName}" maxlength="50"
                        autocomplete="off" spellcheck="false">
                    </div>
                    <div class="seosonaflow-crop-btn-row">
                      <button class="seosonaflow-crop-btn seosonaflow-crop-btn-capture" id="seosonaflow-crop-capture-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                          <circle cx="12" cy="13" r="4"></circle>
                        </svg>
                        ${translations.captureBtn}
                      </button>
                      <button class="seosonaflow-crop-btn seosonaflow-crop-btn-cancel" id="seosonaflow-crop-cancel-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                        ${translations.cancelBtn}
                      </button>
                    </div>
                  </div>
                </div>
              `;

              // Inject styles
              const style = document.createElement('style');
              style.id = 'seosonaflow-crop-styles-injected';
              style.textContent = `
                #seosonaflow-crop-overlay {
                  position: fixed;
                  inset: 0;
                  background: rgba(0,0,0,0.5);
                  z-index: 2147483647;
                  cursor: crosshair;
                }
                #seosonaflow-crop-overlay .seosonaflow-crop-selection {
                  position: absolute;
                  border: 2px dashed #fff;
                  background: transparent;
                  display: none;
                  box-shadow: 0 0 0 9999px rgba(0,0,0,0.5);
                }
                #seosonaflow-crop-overlay .seosonaflow-crop-controls {
                  position: absolute;
                  bottom: -90px;
                  left: 50%;
                  transform: translateX(-50%);
                  display: none;
                  flex-direction: column;
                  gap: 8px;
                  z-index: 2147483647;
                  white-space: nowrap;
                }
                #seosonaflow-crop-overlay .seosonaflow-crop-controls.visible {
                  display: flex;
                }
                #seosonaflow-crop-overlay .seosonaflow-crop-name-row {
                  display: flex;
                  justify-content: center;
                }
                #seosonaflow-crop-overlay .seosonaflow-crop-name-input {
                  width: 220px;
                  padding: 8px 12px;
                  border: 1px solid rgba(255,255,255,0.3);
                  border-radius: 6px;
                  background: rgba(30,30,35,0.95);
                  color: #fff;
                  font-size: 13px;
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                  outline: none;
                  text-align: center;
                }
                #seosonaflow-crop-overlay .seosonaflow-crop-name-input:focus {
                  border-color: #3d6ff5;
                }
                #seosonaflow-crop-overlay .seosonaflow-crop-name-input::placeholder {
                  color: rgba(255,255,255,0.5);
                }
                #seosonaflow-crop-overlay .seosonaflow-crop-btn-row {
                  display: flex;
                  gap: 8px;
                  justify-content: center;
                }
                #seosonaflow-crop-overlay .seosonaflow-crop-btn {
                  display: flex;
                  align-items: center;
                  gap: 6px;
                  padding: 10px 20px;
                  border: none;
                  border-radius: 8px;
                  font-size: 14px;
                  font-weight: 500;
                  cursor: pointer;
                  transition: all 0.15s ease;
                  box-shadow: 0 4px 12px rgba(0,0,0,0.3);
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                }
                #seosonaflow-crop-overlay .seosonaflow-crop-btn svg { flex-shrink: 0; }
                #seosonaflow-crop-overlay .seosonaflow-crop-btn-capture {
                  background: #3d6ff5;
                  color: #1c1c1f;
                }
                #seosonaflow-crop-overlay .seosonaflow-crop-btn-capture:hover {
                  background: #d4ff33;
                  transform: scale(1.02);
                }
                #seosonaflow-crop-overlay .seosonaflow-crop-btn-cancel {
                  background: rgba(40,40,45,0.95);
                  color: #fff;
                  border: 1px solid rgba(255,255,255,0.15);
                }
                #seosonaflow-crop-overlay .seosonaflow-crop-btn-cancel:hover {
                  background: rgba(60,60,65,0.95);
                }
              `;
              document.head.appendChild(style);
              document.body.appendChild(overlay);

              // Selection state
              let startX = 0, startY = 0;
              let isDrawing = false;
              const selection = document.getElementById('seosonaflow-crop-selection');
              const controls = document.getElementById('seosonaflow-crop-controls');

              // Mouse handlers
              overlay.addEventListener('mousedown', (e) => {
                if (e.target.closest('.seosonaflow-crop-controls')) return;
                isDrawing = true;
                controls.classList.remove('visible');
                startX = e.clientX;
                startY = e.clientY;
                selection.style.left = startX + 'px';
                selection.style.top = startY + 'px';
                selection.style.width = '0px';
                selection.style.height = '0px';
                selection.style.display = 'block';
              });

              overlay.addEventListener('mousemove', (e) => {
                if (!isDrawing) return;
                const w = e.clientX - startX;
                const h = e.clientY - startY;
                if (w < 0) {
                  selection.style.left = e.clientX + 'px';
                  selection.style.width = (-w) + 'px';
                } else {
                  selection.style.left = startX + 'px';
                  selection.style.width = w + 'px';
                }
                if (h < 0) {
                  selection.style.top = e.clientY + 'px';
                  selection.style.height = (-h) + 'px';
                } else {
                  selection.style.top = startY + 'px';
                  selection.style.height = h + 'px';
                }
              });

              overlay.addEventListener('mouseup', () => {
                if (!isDrawing) return;
                isDrawing = false;
                const rect = selection.getBoundingClientRect();
                if (rect.width >= 20 && rect.height >= 20) {
                  controls.classList.add('visible');
                }
              });

              // Capture button - S7.3: Truyền name về cùng với cropRect
              document.getElementById('seosonaflow-crop-capture-btn').addEventListener('click', () => {
                const rect = selection.getBoundingClientRect();
                const cropRect = {
                  x: Math.round(rect.left * window.devicePixelRatio),
                  y: Math.round(rect.top * window.devicePixelRatio),
                  width: Math.round(rect.width * window.devicePixelRatio),
                  height: Math.round(rect.height * window.devicePixelRatio)
                };
                // S7.3: Lấy tên ảnh từ input
                const nameInput = document.getElementById('seosonaflow-crop-name-input');
                let captureName = (nameInput?.value || '').trim();
                // Sanitize name: chỉ giữ alphanumeric và underscore
                captureName = captureName.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 50);
                if (!captureName) {
                  captureName = 'capture_' + Date.now().toString(36);
                }

                overlay.remove();
                document.getElementById('seosonaflow-crop-styles-injected')?.remove();
                if (cropRect.width < 20 || cropRect.height < 20) {
                  resolve({ success: false, error: translations.areaTooSmall });
                } else {
                  resolve({ success: true, cropRect, captureName });
                }
              });

              // Cancel button
              document.getElementById('seosonaflow-crop-cancel-btn').addEventListener('click', () => {
                overlay.remove();
                document.getElementById('seosonaflow-crop-styles-injected')?.remove();
                resolve({ success: false, cancelled: true });
              });

              // ESC key to cancel
              const escHandler = (e) => {
                if (e.key === 'Escape') {
                  overlay.remove();
                  document.getElementById('seosonaflow-crop-styles-injected')?.remove();
                  document.removeEventListener('keydown', escHandler);
                  resolve({ success: false, cancelled: true });
                }
              };
              document.addEventListener('keydown', escHandler);
            });
          }
        });

        // Get result from injected script
        const result = results?.[0]?.result;
        if (result) {
          sendResponse({ ...result, tabId: activeTab.id });
        } else {
          sendResponse({ success: false, error: 'Không thể inject overlay vào trang này' });
        }
      } catch (err) {
        console.error('[SEOSONA Flow] startCropOnActiveTab error:', err.message);
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'navigateToProject') {
    if (!_isTrustedSender(sender)) { sendResponse({ success: false, error: 'Untrusted sender' }); return true; }
    const url = message.url;
    // Only allow navigating to http(s) URLs — block javascript:, data:, file:, chrome:, etc.
    let _navScheme = '';
    try { _navScheme = new URL(url).protocol; } catch (_) { _navScheme = ''; }
    if (_navScheme !== 'https:' && _navScheme !== 'http:') {
      sendResponse({ success: false, error: 'Invalid URL scheme' });
      return true;
    }
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
        if (tabs.length > 0) {
          await chrome.tabs.update(tabs[0].id, { url, active: true });
          await chrome.windows.update(tabs[0].windowId, { focused: true });
        } else {
          await chrome.tabs.create({ url });
        }
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }

  if (message.action === 'clickCreateNewProject') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
        if (tabs.length === 0) {
          sendResponse({ success: false, error: 'Không tìm thấy tab Flow' });
          return;
        }
        // Target: active flow tab (đã activate bởi _createNewProject/navigateToProject) → fallback tabs[0].
        const target = tabs.find(t => t.active) || tabs[0];

        // Bug fix 2026-05-28: ĐỢI tab load xong trước khi inject. Sau navigateToProject (reload URL),
        // page chưa render React SPA → inject sớm → script chạy trên page đang load (hoặc bị reload kill)
        // → poll không thấy nút → "redirect nhưng không click". Đợi status='complete' (tới ~8s).
        for (let i = 0; i < 40; i++) {
          let st;
          try { st = (await chrome.tabs.get(target.id))?.status; } catch (_) { break; }
          if (st === 'complete') break;
          await new Promise(r => setTimeout(r, 200));
        }

        // Strict Server-Only: button matchers từ provider_configs.dom_selector.new_project_button
        // (text_match + icon_text + selectors) + icon_element selector. Fallback degraded nếu cache miss.
        const storage = await new Promise(r => chrome.storage.local.get(['seosona_provider_configs'], r));
        const flowSel = storage?.seosona_provider_configs?.data?.flow?.dom_selectors || {};
        const npCfg = flowSel.new_project_button || {};
        const iconText = Array.isArray(npCfg.icon_text) && npCfg.icon_text.length ? npCfg.icon_text : ['add_2', 'add', 'add_circle'];
        const textMatch = Array.isArray(npCfg.text_match) && npCfg.text_match.length ? npCfg.text_match : ['New project', 'Dự án mới', 'Create new project', 'Tạo dự án'];
        const btnSelectors = (Array.isArray(npCfg.selectors) && npCfg.selectors.length ? npCfg.selectors : ['button', '[role="button"]']).join(', ');
        const iconSelectorJoined = (Array.isArray(flowSel.icon_element?.selectors) && flowSel.icon_element.selectors.length
          ? flowSel.icon_element.selectors : ['i.google-symbols']).join(', ');

        // Inject polling script — Flow React SPA, nút có thể render trễ sau load → poll 12s.
        const results = await chrome.scripting.executeScript({
          target: { tabId: target.id },
          args: [iconSelectorJoined, iconText, textMatch, btnSelectors],
          func: (ICON_SELECTOR, ICON_TEXT, TEXT_MATCH, BTN_SEL) => {
            return new Promise((resolve) => {
              const maxWait = 12000;
              const interval = 500;
              let elapsed = 0;

              // Flow React SPA — btn.click() thuần đôi khi KHÔNG trigger onClick (handler nghe
              // pointer/synthetic). Dùng full event sequence + React props.onClick (pattern chatgpt/grok).
              function robustClick(el) {
                const opts = { bubbles: true, cancelable: true, view: window, button: 0 };
                try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
                try { el.dispatchEvent(new MouseEvent('mousedown', opts)); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
                try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
                try { el.dispatchEvent(new MouseEvent('mouseup', opts)); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
                try { el.dispatchEvent(new MouseEvent('click', opts)); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
                try {
                  const k = Object.keys(el).find(x => x.startsWith('__reactProps$'));
                  if (k && typeof el[k]?.onClick === 'function') {
                    el[k].onClick({ preventDefault() {}, stopPropagation() {}, nativeEvent: new MouseEvent('click', opts), type: 'click', target: el, currentTarget: el, button: 0 });
                  }
                } catch (_) { /* owned suppression (P4.T7): silent by design */ }
              }

              function tryClick() {
                const candidates = document.querySelectorAll(BTN_SEL);
                // Strategy 1: icon match (Material Symbol 'add_2' trong <i class="google-symbols">)
                for (const el of candidates) {
                  const icons = el.querySelectorAll(ICON_SELECTOR);
                  for (const icon of icons) {
                    if (ICON_TEXT.includes((icon.textContent || '').trim())) {
                      robustClick(el);
                      resolve({ clicked: true, method: 'icon' });
                      return;
                    }
                  }
                }
                // Strategy 2: text match (text nút, đa ngôn ngữ)
                for (const el of candidates) {
                  const text = (el.textContent || '').trim();
                  if (TEXT_MATCH.some(m => text.includes(m))) {
                    robustClick(el);
                    resolve({ clicked: true, method: 'text' });
                    return;
                  }
                }

                elapsed += interval;
                if (elapsed >= maxWait) resolve({ clicked: false, error: 'timeout' });
                else setTimeout(tryClick, interval);
              }

              tryClick();
            });
          }
        });
        const result = results?.[0]?.result;
        sendResponse({ success: !!result?.clicked, result });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }


  if (message.action === 'getFlowProjectContext') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
        if (tabs.length > 0) {
          // Ưu tiên active tab, fallback tab đầu tiên
          const activeTab = tabs.find(t => t.active) || tabs[0];
          chrome.tabs.sendMessage(activeTab.id, { action: 'getProjectContext' }, (resp) => {
            if (chrome.runtime.lastError) {
              sendResponse({ projectId: null, tabId: activeTab.id });
              return;
            }
            // CRITICAL: Include tabId + tabTitle để sidePanel có thể track target tab + fallback name
            sendResponse({ ...(resp || { projectId: null }), tabId: activeTab.id, tabTitle: activeTab.title || null });
          });
        } else {
          sendResponse({ projectId: null, tabId: null });
        }
      } catch (e) {
        sendResponse({ projectId: null, tabId: null });
      }
    })();
    return true;
  }

  // Fetch blob từ URL ảnh — lý do cần host_permissions "<all_urls>":
  //   • image-to-prompt: user chọn/dán ảnh từ BẤT KỲ trang web → fetch về phân tích → sinh prompt.
  //   • reference images: user cấp URL ảnh từ bất kỳ host → dùng làm ref cho gen/workflow.
  //   • screen capture / album: lấy ảnh trang để tạo album.
  // Fetch qua background để bypass CORS (content script cross-origin bị chặn). _isAllowedUrl chặn
  // localhost/IP nội bộ. (Justification này cũng cần khai trong CWS store listing — permission rationale.)
  if (message.action === 'fetchBlob') {
    if (!_isAllowedUrl(message.url)) {
      sendResponse({ success: false, error: 'URL not allowed' });
      return true;
    }
    (async () => {
      try {
        const resp = await fetch(message.url);
        if (!resp.ok) {
          sendResponse({ success: false, error: `HTTP ${resp.status} ${resp.statusText}` });
          return;
        }
        const contentType = resp.headers.get('content-type') || '';
        // Reject non-image responses (e.g. HTML error pages)
        if (message.expectImage && !contentType.startsWith('image/')) {
          sendResponse({ success: false, error: `Not an image: ${contentType}` });
          return;
        }
        const buffer = await resp.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        const base64 = btoa(binary);
        sendResponse({ success: true, base64, contentType });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // Check if image URL is still valid (lightweight GET with small range)
  if (message.action === 'checkImageUrl') {
    (async () => {
      try {
        if (!_isAllowedUrl(message.url)) {
          sendResponse({ success: true, alive: false, error: 'URL not allowed' });
          return;
        }
        // Google CDN may not support HEAD properly, use GET with range
        const resp = await fetch(message.url, {
          method: 'GET',
          headers: { 'Range': 'bytes=0-0' }
        });
        // 200 or 206 = alive, 404 = dead
        const alive = resp.status >= 200 && resp.status < 400;
        console.log('[checkImageUrl]', message.url.substring(0, 80), '→', resp.status, alive ? 'alive' : 'dead');
        sendResponse({ success: true, alive, status: resp.status });
      } catch (err) {
        console.log('[checkImageUrl] error:', err.message);
        sendResponse({ success: true, alive: false, error: err.message });
      }
    })();
    return true;
  }

  // === Chat AI Integration (Phase X) ===
  // Gửi tin nhắn + ảnh đến ChatGPT hoặc Gemini qua content script
  // FIX: Chỉ tìm/tạo tab trong CÙNG window với tab hiện tại (không mở window mới)
  if (message.action === 'chatAI:send') {
    if (!_isTrustedSender(sender)) { sendResponse({ success: false, error: 'Untrusted sender' }); return true; }
    const { model, text, images } = message;
    const targetUrl = model === 'chatgpt' ? PROVIDER_URLS.chatgpt.createUrl : PROVIDER_URLS.gemini.createUrl;
    const queryUrl = model === 'chatgpt' ? PROVIDER_URLS.chatgpt.tabQuery : PROVIDER_URLS.gemini.tabQuery;
    const scriptFile = model === 'chatgpt' ? 'content_scripts/chat-content-chatgpt.js' : 'content_scripts/chat-content-gemini.js';

    (async () => {
      try {
        // Lấy windowId: từ sender tab, hoặc lấy focused window (khi gửi từ sidePanel)
        let currentWindowId = sender.tab?.windowId;
        if (!currentWindowId) {
          const focusedWindow = await chrome.windows.getCurrent();
          currentWindowId = focusedWindow?.id;
        }

        // 1. Tìm hoặc tạo tab trong CÙNG WINDOW
        let tabs = await chrome.tabs.query({ url: queryUrl, windowId: currentWindowId });
        let tabId;

        if (tabs.length > 0) {
          tabId = tabs[0].id;
          await chrome.tabs.update(tabId, { active: true });
          // Nếu tab đã load xong → không cần navigate lại
          const tabInfo = await chrome.tabs.get(tabId);
          if (tabInfo.status !== 'complete') {
            // Tab đang loading → chờ load xong
            await new Promise((resolve, reject) => {
              const timeout = setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                reject(new Error('Timeout chờ tải trang'));
              }, 15000);

              const listener = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                  clearTimeout(timeout);
                  chrome.tabs.onUpdated.removeListener(listener);
                  resolve();
                }
              };
              chrome.tabs.onUpdated.addListener(listener);
            });
          }
        } else {
          // Tạo tab mới TRONG CÙNG WINDOW và chờ load xong
          const tab = await chrome.tabs.create({ url: targetUrl, active: true, windowId: currentWindowId });
          tabId = tab.id;

          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              reject(new Error('Timeout chờ tải trang'));
            }, 15000);

            const listener = (updatedTabId, changeInfo) => {
              if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
        }

        // 2. Chờ trang khởi tạo JS đầy đủ
        await new Promise(r => setTimeout(r, 2000));

        // 3. Inject content script tương ứng
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [scriptFile]
        });

        // 4. Chờ content script sẵn sàng
        await new Promise(r => setTimeout(r, 500));

        // 5. Gửi lệnh thực thi đến content script
        chrome.tabs.sendMessage(tabId, {
          action: 'chatAI:execute',
          text,
          images
        }, (resp) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: chrome.runtime.lastError.message || 'Không nhận được phản hồi' });
            return;
          }
          sendResponse(resp || { success: true });
        });

      } catch (err) {
        console.error('[SEOSONA Flow] chatAI:send error:', err.message);
        sendResponse({ success: false, error: err.message || 'Lỗi không xác định' });
      }
    })();

    return true; // Giữ sendResponse cho async callback
  }

  // === OAuth Google Success (Phase AU-4.13) ===
  // Nhận token từ OAuth success page → gọi /auth/me → lưu vào af_auth → notify sidePanel
  if (message.action === 'oauth:success') {
    // H6: strict origin + path validation. A bearer token is trusted from this message,
    // so the sender must be the known auth origin serving /auth/google/success — not any
    // page whose URL merely contains that substring (e.g. https://evil.com/auth/google/success).
    let _oauthOk = false;
    try {
      const su = new URL(sender.tab?.url || '');
      if (su.pathname === '/auth/google/success') {
        // Derive expected auth origin from the configured API base origin.
        let expectedOrigin = null;
        try { expectedOrigin = new URL(getApiBaseUrl()).origin; } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        if (expectedOrigin) {
          _oauthOk = su.origin === expectedOrigin;
        } else {
          // Unknown base → require https at minimum.
          _oauthOk = su.protocol === 'https:';
        }
      }
    } catch (_) { _oauthOk = false; }
    if (!_oauthOk) {
      sendResponse({ success: false, error: 'Invalid sender URL' });
      return true;
    }
    const { token } = message;
    if (token) {
      (async () => {
        try {
          // Lấy apiBaseUrl hiện tại
          const stored = await new Promise(resolve => {
            chrome.storage.local.get(['af_auth'], result => resolve(result.af_auth || {}));
          });
          // Phase 3.5 Bug I: dùng getApiBaseUrl() helper
          const apiBaseUrl = stored.apiBaseUrl || getApiBaseUrl();

          // Nếu có user cũ đang login, xóa SSE session của họ trước (fire-and-forget)
          // Điều này đảm bảo session SSE cũ được cleanup khi switch account qua Google OAuth
          if (stored.token && stored.user) {
            console.log('[SEOSONA Flow] OAuth: clearing SSE session for previous user');
            fetch(`${apiBaseUrl}/sse/end-session`, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${stored.token}`,
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-Extension-Id': chrome.runtime.id,
              }
            }).then(async (resp) => {
              if (resp.status === 403) {
                try {
                  const body = await resp.clone().json();
                  if (_isExtensionAuthRejection(body, 403)) _handleExtensionAuthRejection();
                } catch (_) { /* owned suppression (P4.T7): silent by design */ }
              }
            }).catch(() => {
              // Silent fail - expected khi token đã hết hạn
            });
          }

          // Gọi /auth/me để lấy user data đầy đủ (bao gồm google_id)
          let user = null;
          try {
            const resp = await fetch(`${apiBaseUrl}/auth/me`, {
              method: 'GET',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'X-Extension-Id': chrome.runtime.id,
              }
            });
            if (resp.status === 403) {
              try {
                const body = await resp.clone().json();
                if (_isExtensionAuthRejection(body, 403)) _handleExtensionAuthRejection();
              } catch (_) { /* owned suppression (P4.T7): silent by design */ }
            }
            if (resp.ok) {
              const data = await resp.json();
              user = data?.data?.user || data?.user || null;
              console.log('[SEOSONA Flow] OAuth: fetched user data from /auth/me', user?.google_id ? 'with google_id' : 'without google_id');
            }
          } catch (fetchErr) {
            console.warn('[SEOSONA Flow] OAuth: failed to fetch /auth/me, continuing with null user', fetchErr.message);
          }

          // Lưu auth data
          await new Promise(resolve => {
            chrome.storage.local.set({
              af_auth: {
                token,
                user,
                apiBaseUrl,
                savedAt: Date.now()
              }
            }, resolve);
          });

          console.log('[SEOSONA Flow] OAuth success: token saved');

          // Notify tất cả contexts (sidePanel, popups)
          chrome.runtime.sendMessage({
            action: 'auth:oauthLogin',
            token,
            user
          }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#listener', _e); });

          // Sau khi login success: đóng OAuth tab + activate Google Flow tab.
          // Delay 1.5s để user thấy "Đăng nhập thành công" rồi tab đóng.
          if (sender.tab?.id) {
            const oauthTabId = sender.tab.id;
            const oauthWindowId = sender.tab.windowId;
            setTimeout(async () => {
              try {
                await chrome.tabs.remove(oauthTabId);
              } catch (err) {
                console.warn('[SEOSONA Flow] Không thể đóng OAuth tab:', err.message);
              }
              // Tìm Flow tab trong cùng window (hoặc bất kỳ window nếu không có)
              // và activate nó để user tiếp tục thao tác.
              try {
                let flowTabs = await chrome.tabs.query({
                  url: PROVIDER_URLS.flow.tabQuery,
                  windowId: oauthWindowId,
                });
                if (!flowTabs.length) {
                  flowTabs = await chrome.tabs.query({ url: PROVIDER_URLS.flow.tabQuery });
                }
                if (flowTabs.length > 0) {
                  const flowTab = flowTabs[0];
                  await chrome.tabs.update(flowTab.id, { active: true });
                  if (flowTab.windowId !== undefined) {
                    await chrome.windows.update(flowTab.windowId, { focused: true });
                  }
                  console.log('[SEOSONA Flow] Activated Flow tab sau OAuth login');
                } else {
                  console.log('[SEOSONA Flow] Không tìm thấy Flow tab để activate');
                }
              } catch (err) {
                console.warn('[SEOSONA Flow] Không thể activate Flow tab:', err.message);
              }
            }, 1500);
          }

          sendResponse({ success: true });
        } catch (err) {
          console.error('[SEOSONA Flow] OAuth save error:', err.message);
          sendResponse({ success: false, error: err.message });
        }
      })();
      return true;
    }
    sendResponse({ success: false, error: 'Missing token' });
    return true;
  }

  // === OAuth Google Link Success (Phase AU-4.14) ===
  // Nhận thông báo từ OAuth success page (link flow) → notify sidePanel/settings
  if (message.action === 'oauth:linked') {
    const senderUrl = sender.tab?.url || '';
    if (!senderUrl.includes('/auth/google/success')) {
      sendResponse({ success: false, error: 'Invalid sender URL' });
      return true;
    }

    console.log('[SEOSONA Flow] Google link success: notifying extension');

    // Notify tất cả contexts (sidePanel, settings popup)
    chrome.runtime.sendMessage({
      action: 'auth:googleLinked'
    }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#listener', _e); });

    sendResponse({ success: true });
    return true;
  }

  // Payment success callback from checkout page
  if (message.action === 'payment:success') {
    // Sender validation: the checkout origin isn't derivable in this SW, so require a trusted
    // sender served over https (reject foreign/non-https senders spoofing a payment callback).
    if (!_isTrustedSender(sender) || new URL(sender.tab?.url || 'about:blank').protocol !== 'https:') {
      sendResponse({ ok: false, error: 'Invalid sender' });
      return true;
    }
    // Relay to all extension contexts (sidePanel, popups)
    chrome.runtime.sendMessage({
      action: 'payment:completed',
      orderId: message.orderId,
      status: message.status || 'paid'
    }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#listener', _e); });
    sendResponse({ ok: true });
    return true;
  }

  // Payment cancelled callback from checkout page
  if (message.action === 'payment:cancelled') {
    if (!_isTrustedSender(sender) || new URL(sender.tab?.url || 'about:blank').protocol !== 'https:') {
      sendResponse({ ok: false, error: 'Invalid sender' });
      return true;
    }
    chrome.runtime.sendMessage({
      action: 'payment:cancelled',
      orderId: message.orderId
    }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#listener', _e); });
    sendResponse({ ok: true });
    return true;
  }

  // ============================================================
  // === Phase CG-2: ChatGPT Session Manager handlers ============
  // ============================================================
  // Các action `chatgpt:*` riêng biệt với `chatAI:send` (Phase X).
  // Dùng cho ChatGPTSession.js phía sidePanel để quản lý tab + image mode.
  // ============================================================

  // Helper sleep dùng chung trong các executeScript func bên dưới
  // (Khai báo inline trong từng func vì func chạy ở context tab khác — không có closure).
  // Inline pattern: `const sleep = (ms) => new Promise(r => setTimeout(r, ms));`

  if (message.action === 'chatgpt:findOrCreateTab') {
    const { createIfMissing = true, activate = true } = message;
    (async () => {
      try {
        // Lấy windowId từ sender hoặc focused window
        let currentWindowId = sender.tab?.windowId;
        if (!currentWindowId) {
          const focusedWindow = await chrome.windows.getCurrent();
          currentWindowId = focusedWindow?.id;
        }

        // Tìm tab chatgpt.com — ưu tiên trong cùng window
        let tabs = await chrome.tabs.query({ url: PROVIDER_URLS.chatgpt.tabQuery, windowId: currentWindowId });
        if (tabs.length === 0) {
          // Fallback: tìm trên mọi window
          tabs = await chrome.tabs.query({ url: PROVIDER_URLS.chatgpt.tabQuery });
        }

        let tabId;
        if (tabs.length > 0) {
          tabId = tabs[0].id;
        } else if (createIfMissing) {
          const tab = await chrome.tabs.create({
            url: PROVIDER_URLS.chatgpt.createUrl,
            active: !!activate,
            windowId: currentWindowId,
          });
          tabId = tab.id;
          // Chờ tab load xong (max 15s)
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }, 15000);
            const listener = (updatedTabId, changeInfo) => {
              if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
        } else {
          sendResponse({ success: false, error: 'NO_TAB' });
          return;
        }

        sendResponse({ success: true, tabId });
      } catch (err) {
        console.error('[SEOSONA Flow] chatgpt:findOrCreateTab error:', err.message);
        sendResponse({ success: false, error: err.message || 'NO_TAB' });
      }
    })();
    return true;
  }

  if (message.action === 'chatgpt:ensureActive') {
    // Support 2 caller patterns: sidePanel pass tabId, content script fallback sender.tab.id
    const tabId = message.tabId || sender?.tab?.id;
    const focusWindow = message.focusWindow === true;
    const navigateToHome = message.navigateToHome === true;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }
        let tabInfo = await chrome.tabs.get(tabId);

        // Navigate về homepage nếu đang ở conversation page (fix image mode bug)
        // GenTab pattern: navigate về homepage → tạo new chat → UI state reset
        // forceRefresh: luôn navigate ngay cả khi đã ở homepage (fix stale React state)
        const isAtHomepage = tabInfo.url && tabInfo.url.match(/^https:\/\/chatgpt\.com\/?(\?|#|$)/);
        const shouldNavigate = navigateToHome && (!isAtHomepage || message.forceRefresh);
        if (shouldNavigate) {
          console.log('[SEOSONA Flow] chatgpt:ensureActive navigating to homepage from:', tabInfo.url, 'forceRefresh:', !!message.forceRefresh);
          // Thêm timestamp query để force React re-render khi đã ở homepage
          const targetUrl = isAtHomepage ? `https://chatgpt.com/?_t=${Date.now()}` : 'https://chatgpt.com/';
          await chrome.tabs.update(tabId, { url: targetUrl });

          // Đợi page load complete
          await new Promise((resolve) => {
            const checkComplete = async () => {
              try {
                const tab = await chrome.tabs.get(tabId);
                if (tab.status === 'complete' && tab.url?.includes('chatgpt.com')) {
                  resolve();
                } else {
                  setTimeout(checkComplete, 200);
                }
              } catch { resolve(); }
            };
            setTimeout(checkComplete, 300);
          });

          // Đợi React hydration — giảm 800→400ms (preflight poll loop sẽ verify ready)
          await new Promise(r => setTimeout(r, 400));
          tabInfo = await chrome.tabs.get(tabId);
          console.log('[SEOSONA Flow] chatgpt:ensureActive homepage navigation complete');
        }

        if (!tabInfo.active) {
          await chrome.tabs.update(tabId, { active: true });
          // Chờ React unthrottle (300ms — pattern giống Flow tab)
          await new Promise(r => setTimeout(r, 300));
        }
        // Cloudflare/captcha challenge: bring window to front + drawAttention.
        if (focusWindow && tabInfo.windowId) {
          try {
            await chrome.windows.update(tabInfo.windowId, { focused: true, drawAttention: true });
          } catch (winErr) {
            console.warn('[SEOSONA Flow] chatgpt:ensureActive focusWindow failed:', winErr.message);
          }
        }
        sendResponse({ success: true, active: true });
      } catch (err) {
        console.error('[SEOSONA Flow] chatgpt:ensureActive error:', err.message);
        sendResponse({ success: false, error: err.message || 'ACTIVATE_FAILED' });
      }
    })();
    return true;
  }

  if (message.action === 'chatgpt:injectScript') {
    const { tabId } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }

        // 2026-05-25: Pre-check tab URL — tab có thể đã redirect login (auth.openai.com /
        // accounts.google.com) giữa lúc findOrCreateTab và injectScript fire. executeScript
        // sẽ fail "Cannot access contents..." vì URL mới không match host_permissions.
        // Skip silent thay vì log error spam.
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab?.url || !tab.url.startsWith('https://chatgpt.com/')) {
          sendResponse({ success: false, error: 'NOT_CHATGPT_URL', url: tab?.url || '' });
          return;
        }

        // Kiểm tra flag double-inject — nếu đã có thì không inject lại
        const checkResults = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => !!window.__seosonaflowChatGPTLoaded__,
        });
        const alreadyLoaded = !!(checkResults && checkResults[0] && checkResults[0].result);

        if (!alreadyLoaded) {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content_scripts/chat-content-chatgpt.js'],
          });
        }
        sendResponse({ success: true, alreadyLoaded });
      } catch (err) {
        // Demote error → warn (host permission fail = harmless race, không phải crash)
        console.warn('[SEOSONA Flow] chatgpt:injectScript skipped:', err.message);
        sendResponse({ success: false, error: err.message || 'INJECT_FAILED' });
      }
    })();
    return true;
  }

  if (message.action === 'chatgpt:checkLogin') {
    const { tabId } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }

        // [Server-Only refactor 2026-05-24] Đọc selectors + text patterns từ chrome.storage thay hardcode.
        // - Selectors: seosona_provider_configs.chatgpt.dom_selectors.{composer,login_button,auth_link}
        // - Text patterns: af_chatgpt_config.data.not_logged_in_text (split by '|')
        // Admin tune qua /admin/providers/chatgpt khi OpenAI đổi UI → SSE auto sync.
        const storage = await chrome.storage.local.get(['seosona_provider_configs', 'af_chatgpt_config']);
        const chatgptSelectors = storage?.seosona_provider_configs?.data?.chatgpt?.dom_selectors || {};
        const composerSelectors = chatgptSelectors?.composer?.selectors || ['#prompt-textarea'];
        const loginBtnSelectors = chatgptSelectors?.login_button?.selectors || ['[data-testid="login-button"]'];
        const authLinkSelectors = chatgptSelectors?.auth_link?.selectors || ['a[href*="/auth/login"]'];

        const notLoggedInRaw = storage?.af_chatgpt_config?.data?.not_logged_in_text || '';
        const notLoggedInPatterns = notLoggedInRaw
          .split('|')
          .map(s => s.trim().toLowerCase())
          .filter(Boolean);

        const args = {
          composerSelectors,
          loginBtnSelectors,
          authLinkSelectors,
          notLoggedInPatterns,
        };

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          args: [args],
          // Func phải standalone — không reference closure outside
          func: function checkLoginStatus(cfg) {
            const queryFirst = (selectors) => {
              if (!Array.isArray(selectors)) return null;
              for (const sel of selectors) {
                try {
                  const el = document.querySelector(sel);
                  if (el) return el;
                } catch (_) { /* invalid selector skip */ }
              }
              return null;
            };

            const editor = queryFirst(cfg.composerSelectors);
            const loginBtn = queryFirst(cfg.loginBtnSelectors);
            const loginLink = queryFirst(cfg.authLinkSelectors);

            // Text-based fallback (defensive nếu OpenAI đổi data-testid)
            let signInTextBtn = null;
            if (cfg.notLoggedInPatterns && cfg.notLoggedInPatterns.length > 0) {
              try {
                const buttons = document.querySelectorAll('button');
                for (const btn of buttons) {
                  const text = (btn.textContent || '').trim().toLowerCase();
                  if (!text || text.length > 30) continue; // skip empty + long text
                  if (cfg.notLoggedInPatterns.some(p => text === p || text.includes(p))) {
                    signInTextBtn = btn;
                    break;
                  }
                }
              } catch (_) { /* ignore */ }
            }

            if (!editor) return { ready: false, error: 'EDITOR_NOT_FOUND' };
            if (loginBtn || loginLink || signInTextBtn) {
              return {
                ready: false,
                error: 'NOT_LOGGED_IN',
                _detected: signInTextBtn ? 'text_pattern' : (loginBtn ? 'login_button' : 'auth_link'),
              };
            }
            return { ready: true };
          },
        });
        const result = (results && results[0] && results[0].result) || { ready: false, error: 'EDITOR_NOT_FOUND' };
        if (result._detected) {
          console.log('[SEOSONA Flow] chatgpt:checkLogin NOT_LOGGED_IN detected via:', result._detected);
        }
        delete result._detected; // internal field, không gửi consumer
        sendResponse({ success: true, ...result });
      } catch (err) {
        console.error('[SEOSONA Flow] chatgpt:checkLogin error:', err.message);
        sendResponse({ success: false, error: err.message || 'CHECK_FAILED' });
      }
    })();
    return true;
  }

  // ===========================================================================
  // Phase CG-8: Gemini handlers (stub minimal — text-only Prompt node enhance)
  // ===========================================================================

  if (message.action === 'gemini:findOrCreateTab') {
    const { createIfMissing = true, activate = true } = message;
    (async () => {
      try {
        let currentWindowId = sender.tab?.windowId;
        if (!currentWindowId) {
          const focusedWindow = await chrome.windows.getCurrent();
          currentWindowId = focusedWindow?.id;
        }

        let tabs = await chrome.tabs.query({ url: PROVIDER_URLS.gemini.tabQuery, windowId: currentWindowId });
        if (tabs.length === 0) {
          tabs = await chrome.tabs.query({ url: PROVIDER_URLS.gemini.tabQuery });
        }

        let tabId;
        if (tabs.length > 0) {
          tabId = tabs[0].id;
        } else if (createIfMissing) {
          const tab = await chrome.tabs.create({
            url: PROVIDER_URLS.gemini.createUrl,
            active: !!activate,
            windowId: currentWindowId,
          });
          tabId = tab.id;
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }, 15000);
            const listener = (updatedTabId, changeInfo) => {
              if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
        } else {
          sendResponse({ success: false, error: 'NO_TAB' });
          return;
        }

        sendResponse({ success: true, tabId });
      } catch (err) {
        console.error('[SEOSONA Flow] gemini:findOrCreateTab error:', err.message);
        sendResponse({ success: false, error: err.message || 'NO_TAB' });
      }
    })();
    return true;
  }

  if (message.action === 'gemini:ensureActive') {
    // Support 2 caller patterns: sidePanel pass tabId, content script fallback sender.tab.id
    const tabId = message.tabId || sender?.tab?.id;
    const focusWindow = message.focusWindow === true;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }
        const tabInfo = await chrome.tabs.get(tabId);
        if (!tabInfo.active) {
          await chrome.tabs.update(tabId, { active: true });
          await new Promise(r => setTimeout(r, 300));
        }
        // Cloudflare/captcha challenge: bring window to front + drawAttention.
        if (focusWindow && tabInfo.windowId) {
          try {
            await chrome.windows.update(tabInfo.windowId, { focused: true, drawAttention: true });
          } catch (winErr) {
            console.warn('[SEOSONA Flow] gemini:ensureActive focusWindow failed:', winErr.message);
          }
        }
        sendResponse({ success: true, active: true });
      } catch (err) {
        console.error('[SEOSONA Flow] gemini:ensureActive error:', err.message);
        sendResponse({ success: false, error: err.message || 'ACTIVATE_FAILED' });
      }
    })();
    return true;
  }

  if (message.action === 'gemini:injectScript') {
    const { tabId } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }

        // 2026-05-25: Pre-check tab URL (race tab redirect — silent skip).
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab?.url || !tab.url.startsWith('https://gemini.google.com/')) {
          sendResponse({ success: false, error: 'NOT_GEMINI_URL', url: tab?.url || '' });
          return;
        }

        // Guard double-inject (chat-content-gemini.js dùng flag _chatAIGeminiInjected)
        const checkResults = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => !!window._chatAIGeminiInjected,
        });
        const alreadyLoaded = !!(checkResults && checkResults[0] && checkResults[0].result);

        if (!alreadyLoaded) {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content_scripts/chat-content-gemini.js'],
          });
        }
        sendResponse({ success: true, alreadyLoaded });
      } catch (err) {
        console.warn('[SEOSONA Flow] gemini:injectScript skipped:', err.message);
        sendResponse({ success: false, error: err.message || 'INJECT_FAILED' });
      }
    })();
    return true;
  }

  if (message.action === 'gemini:checkLogin') {
    const { tabId } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }

        // 2026-05-31 fix: SPA Gemini chậm hydrate sau khi activate tab → editor element
        // chưa render → checkLogin lần đầu fail "EDITOR_NOT_FOUND" mặc dù user logged in.
        // Retry 4 lần × 400ms (tổng ~1.6s) với fallback signals đáng tin hơn (URL pattern,
        // sidebar nav menu) để giảm false negative.
        const runCheck = async () => {
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: function checkGeminiLogin() {
              const url = location.href || '';
              // Tín hiệu 1 (negative): URL hard signin
              if (/\/(ServiceLogin|signin|accounts\.google\.com)/.test(url)) {
                return { ready: false, error: 'NOT_LOGGED_IN' };
              }
              // Tín hiệu 2 (positive): editor prompt input render
              const editor =
                document.querySelector('.ql-editor[contenteditable="true"]') ||
                document.querySelector('rich-textarea [contenteditable="true"]') ||
                document.querySelector('div[role="textbox"][contenteditable="true"]');
              if (editor) return { ready: true };
              // Tín hiệu 3 (positive): sidebar nav menu (chỉ hiện khi logged in)
              const sidebarNav =
                document.querySelector('side-navigation, [data-test-id="side-nav"], #side-navigation') ||
                document.querySelector('button[aria-label*="account"i], img[alt*="account"i][role]');
              if (sidebarNav) return { ready: true };
              // Tín hiệu 4 (negative): signin link DOM
              const signinLink = document.querySelector('a[href*="accounts.google.com/ServiceLogin"], a[href*="signin"]');
              if (signinLink) return { ready: false, error: 'NOT_LOGGED_IN' };
              return { ready: false, error: 'EDITOR_NOT_FOUND' };
            },
          });
          return (results && results[0] && results[0].result) || { ready: false, error: 'EDITOR_NOT_FOUND' };
        };

        const RETRY_MAX = 4;
        const RETRY_DELAY = 400;
        let result = await runCheck();
        for (let i = 1; i < RETRY_MAX && !result.ready && result.error === 'EDITOR_NOT_FOUND'; i++) {
          await new Promise(r => setTimeout(r, RETRY_DELAY));
          result = await runCheck();
        }
        sendResponse({ success: true, ...result });
      } catch (err) {
        console.error('[SEOSONA Flow] gemini:checkLogin error:', err.message);
        sendResponse({ success: false, error: err.message || 'CHECK_FAILED' });
      }
    })();
    return true;
  }

  if (message.action === 'gemini:getTabInfo') {
    const { tabId } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }
        const tabInfo = await chrome.tabs.get(tabId);
        sendResponse({ success: true, url: tabInfo?.url || null, active: !!tabInfo?.active });
      } catch (err) {
        sendResponse({ success: false, error: err.message || 'TAB_NOT_FOUND' });
      }
    })();
    return true;
  }

  if (message.action === 'gemini:closeTab') {
    const { tabId } = message;
    (async () => {
      try {
        if (tabId) {
          try { await chrome.tabs.remove(tabId); } catch (e) { /* tab có thể đã đóng */ }
        }
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'chatgpt:activateImageMode') {
    const { tabId } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: async function activateImageMode() {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            const log = (...args) => console.log('[ChatGPT-activate]', ...args);

            // Helper: click element bằng cả real MouseEvent + React onClick (max compat)
            const clickElement = (el) => {
              if (!el) return false;
              // 1. Real mouse events (visible click animation + native React handler)
              const rect = el.getBoundingClientRect();
              const x = rect.left + rect.width / 2;
              const y = rect.top + rect.height / 2;
              const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
              try {
                el.dispatchEvent(new PointerEvent('pointerdown', opts));
                el.dispatchEvent(new MouseEvent('mousedown', opts));
                el.dispatchEvent(new PointerEvent('pointerup', opts));
                el.dispatchEvent(new MouseEvent('mouseup', opts));
                el.dispatchEvent(new MouseEvent('click', opts));
              } catch (e) { /* ignore */ }
              // 2. Fallback React onClick/onSelect props (cho Radix menuitemradio)
              const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
              const props = propsKey ? el[propsKey] : null;
              try {
                if (props && typeof props.onSelect === 'function') {
                  props.onSelect({ preventDefault() {}, stopPropagation() {} });
                } else if (props && typeof props.onClick === 'function') {
                  props.onClick({ preventDefault() {}, stopPropagation() {}, nativeEvent: new MouseEvent('click'), type: 'click', target: el, currentTarget: el });
                }
              } catch (e) { /* ignore */ }
              return true;
            };

            // Đóng menu cũ nếu đang mở (tránh state cũ ảnh hưởng) — chỉ chờ 60ms
            try {
              const openMenu = document.querySelector('div[role="menu"][data-state="open"]');
              if (openMenu) {
                document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                await sleep(60);
              }
            } catch (e) { /* owned suppression (P4.T7): silent by design */ }

            // 1. Detect đã ở image mode — ratio dropdown đã visible
            const existingRatioBtn = document.querySelector('button[aria-label="Choose image aspect ratio"]');
            if (existingRatioBtn) {
              log('Step 1: ratio button đã visible — image mode đã active, skip click composer');
              return { activated: true, ratioControlAvailable: true, alreadyActive: true };
            }

            // 2. Click composer plus button (visible click)
            const plusBtn = document.querySelector('#composer-plus-btn')
              || document.querySelector('[data-testid="composer-plus-btn"]');
            if (!plusBtn) {
              log('Step 2 FAIL: PLUS_BUTTON_NOT_FOUND');
              return { activated: false, error: 'PLUS_BUTTON_NOT_FOUND' };
            }
            log('Step 2: Click composer plus button');
            clickElement(plusBtn);

            // 3. Chờ menu render (Radix portal — append vào body, retry nhanh)
            let menuContainer = null;
            for (let i = 0; i < 6; i++) {
              await sleep(80);
              menuContainer = document.querySelector('div[role="menu"][data-radix-menu-content][data-state="open"]');
              if (menuContainer) break;
            }
            if (!menuContainer) {
              log('Step 3 FAIL: MENU_NOT_RENDERED sau 480ms');
              return { activated: false, error: 'MENU_NOT_RENDERED' };
            }
            log('Step 3: Menu rendered');

            // 4. Tìm item "Create image"
            const menuItems = menuContainer.querySelectorAll('[role="menuitemradio"], [role="menuitem"]');
            let createImageItem = null;
            let alreadyChecked = false;
            for (const item of menuItems) {
              const text = (item.innerText || '').trim().toLowerCase();
              if (text === 'create image' || text === 'create an image' || text.startsWith('create image')) {
                createImageItem = item;
                alreadyChecked = item.getAttribute('aria-checked') === 'true'
                  || item.getAttribute('data-state') === 'checked';
                break;
              }
            }
            if (!createImageItem) {
              log('Step 4 FAIL: MENU_ITEM_NOT_FOUND. Items found:', Array.from(menuItems).map(i => i.innerText?.trim()));
              return { activated: false, error: 'MENU_ITEM_NOT_FOUND' };
            }
            log('Step 4: Click "Create image" item (alreadyChecked:', alreadyChecked, ')');

            // 5. Click item — CẢ KHI alreadyChecked (force re-toggle để đảm bảo state đúng)
            //    nếu alreadyChecked → đóng menu bằng Escape (không click again gây toggle off)
            if (!alreadyChecked) {
              clickElement(createImageItem);
            } else {
              try {
                document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              } catch (e) { /* owned suppression (P4.T7): silent by design */ }
            }

            // 6. Chờ ratio dropdown render (retry nhanh)
            let ratioBtn = null;
            for (let i = 0; i < 8; i++) {
              await sleep(80);
              ratioBtn = document.querySelector('button[aria-label="Choose image aspect ratio"]');
              if (ratioBtn) break;
            }
            log('Step 6:', ratioBtn ? 'Ratio button visible' : 'RATIO_CONTROL_NOT_RENDERED sau 640ms');

            return {
              activated: !!ratioBtn,
              ratioControlAvailable: !!ratioBtn,
              wasAlreadyChecked: alreadyChecked,
              error: ratioBtn ? null : 'RATIO_CONTROL_NOT_RENDERED',
            };
          },
        });

        const result = (results && results[0] && results[0].result) || { activated: false, error: 'EXEC_FAILED' };
        sendResponse({ success: !!result.activated, ...result });
      } catch (err) {
        console.error('[SEOSONA Flow] chatgpt:activateImageMode error:', err.message);
        sendResponse({ success: false, activated: false, error: err.message || 'EXEC_FAILED' });
      }
    })();
    return true;
  }

  if (message.action === 'chatgpt:setRatio') {
    const { tabId, ratio, ariaLabelMap } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }
        if (!ratio) { sendResponse({ success: false, error: 'INVALID_RATIO_KEY' }); return; }

        // Strict Server-Only: caller (ChatGPTSession.setRatio) MUST truyền ariaLabelMap từ
        // ChatGPTAdapter.capabilities.ratioAriaLabels (derive từ PCM ratios cache).
        // Nếu missing → return error, KHÔNG fallback hardcoded.
        if (!ariaLabelMap || typeof ariaLabelMap !== 'object' || Object.keys(ariaLabelMap).length === 0) {
          console.debug('[Tier3] chatgpt:setRatio missing ariaLabelMap — caller phải truyền từ ChatGPTAdapter.capabilities');
          sendResponse({ success: false, error: 'MISSING_ARIA_LABEL_MAP' });
          return;
        }
        const resolvedAriaLabelMap = ariaLabelMap;

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          args: [ratio, resolvedAriaLabelMap],
          func: async function setRatio(ratioKey, ARIA_LABEL_MAP) {
            const sleep = (ms) => new Promise(r => setTimeout(r, ms));
            const log = (...args) => console.log('[ChatGPT-setRatio]', ...args);

            const clickElement = (el) => {
              if (!el) return false;
              const rect = el.getBoundingClientRect();
              const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
              try {
                el.dispatchEvent(new PointerEvent('pointerdown', opts));
                el.dispatchEvent(new MouseEvent('mousedown', opts));
                el.dispatchEvent(new PointerEvent('pointerup', opts));
                el.dispatchEvent(new MouseEvent('mouseup', opts));
                el.dispatchEvent(new MouseEvent('click', opts));
              } catch (e) { /* owned suppression (P4.T7): silent by design */ }
              const propsKey = Object.keys(el).find(k => k.startsWith('__reactProps$'));
              const props = propsKey ? el[propsKey] : null;
              try {
                if (props && typeof props.onSelect === 'function') {
                  props.onSelect({ preventDefault() {}, stopPropagation() {} });
                } else if (props && typeof props.onClick === 'function') {
                  props.onClick({ preventDefault() {}, stopPropagation() {}, nativeEvent: new MouseEvent('click'), type: 'click', target: el, currentTarget: el });
                }
              } catch (e) { /* owned suppression (P4.T7): silent by design */ }
              return true;
            };

            const targetAriaLabel = ARIA_LABEL_MAP?.[ratioKey];
            if (!targetAriaLabel) return { success: false, error: 'INVALID_RATIO_KEY' };

            const ratioBtn = document.querySelector('button[aria-label="Choose image aspect ratio"]');
            if (!ratioBtn) {
              log('FAIL: RATIO_BUTTON_NOT_FOUND');
              return { success: false, error: 'RATIO_BUTTON_NOT_FOUND' };
            }
            log('Step 1: Click ratio button →', targetAriaLabel);
            clickElement(ratioBtn);

            // Chờ dropdown render (retry 5 lần)
            let items = [];
            for (let i = 0; i < 5; i++) {
              await sleep(150);
              items = document.querySelectorAll('[role="menuitemradio"]');
              if (items.length >= 5) break; // 5 ratios + có thể thêm Auto
            }
            log('Step 2: Found', items.length, 'menuitemradio options');

            // Primary: aria-label exact
            let target = null;
            for (const item of items) {
              if (item.getAttribute('aria-label') === targetAriaLabel) { target = item; break; }
            }
            if (!target) {
              const ratioName = targetAriaLabel.split(' ')[0].toLowerCase();
              for (const item of items) {
                const text = (item.innerText || '').trim().toLowerCase();
                if (text.startsWith(ratioName)) { target = item; break; }
              }
            }
            if (!target) {
              log('FAIL: RATIO_OPTION_NOT_FOUND. Items aria-labels:', Array.from(items).map(i => i.getAttribute('aria-label')));
              return { success: false, error: 'RATIO_OPTION_NOT_FOUND' };
            }
            log('Step 3: Click target option');
            clickElement(target);

            return { success: true };
          },
        });

        const result = (results && results[0] && results[0].result) || { success: false, error: 'EXEC_FAILED' };
        sendResponse(result);
      } catch (err) {
        console.error('[SEOSONA Flow] chatgpt:setRatio error:', err.message);
        sendResponse({ success: false, error: err.message || 'EXEC_FAILED' });
      }
    })();
    return true;
  }

  // Generic fetch image as base64 - for Flow URLs that need authentication
  if (message.action === 'fetchImageAsBase64') {
    if (!_isTrustedSender(sender)) { sendResponse({ success: false, error: 'Untrusted sender' }); return true; }
    const { url } = message;
    (async () => {
      try {
        if (!url) {
          sendResponse({ success: false, error: 'MISSING_URL' });
          return;
        }
        // SSRF guard: gate the (credentialed) injected fetch on both trusted sender + allowed URL.
        if (!_isAllowedUrl(url)) {
          sendResponse({ success: false, error: 'URL not allowed' });
          return;
        }

        // Find a Flow tab to inject the fetch (Flow tabs have cookies)
        const flowTabs = await chrome.tabs.query({ url: '*://labs.google/*' });
        if (flowTabs.length === 0) {
          // Fallback: try direct fetch (might work if URL doesn't need auth)
          if (!_isAllowedUrl(url)) {
            sendResponse({ success: false, error: 'URL not allowed' });
            return;
          }
          try {
            const resp = await fetch(url);
            if (!resp.ok) {
              sendResponse({ success: false, error: 'HTTP_' + resp.status });
              return;
            }
            const blob = await resp.blob();
            const contentType = blob.type || 'image/jpeg';
            const arrayBuffer = await blob.arrayBuffer();
            // L7: chunked encode (0x8000) — spreading a multi-MB buffer into fromCharCode overflows the stack.
            const bytes = new Uint8Array(arrayBuffer);
            let bin = '';
            const CH = 0x8000;
            for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
            const base64 = btoa(bin);
            sendResponse({ success: true, base64, contentType });
          } catch (e) {
            sendResponse({ success: false, error: 'NO_FLOW_TAB_AND_DIRECT_FAILED' });
          }
          return;
        }

        const tabId = flowTabs[0].id;
        // Inject fetch trong context tab Flow.
        // KHÔNG dùng credentials: 'include' vì redirect chain `labs.google` →
        // `flow-content.google` trả `Access-Control-Allow-Origin: *` → CORS
        // block credentialed request. Signed URL của CDN đã đủ để authenticate
        // qua Expires + Signature query params.
        const [scriptResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: async (imgUrl) => {
            try {
              const resp = await fetch(imgUrl);
              if (!resp.ok) return { ok: false, status: resp.status, error: 'HTTP_' + resp.status };
              const blob = await resp.blob();
              return await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => {
                  // Extract base64 from data URL
                  const dataUrl = reader.result;
                  const base64 = dataUrl.split(',')[1];
                  resolve({
                    ok: true,
                    base64: base64,
                    contentType: blob.type || 'image/jpeg',
                    size: blob.size,
                  });
                };
                reader.onerror = () => resolve({ ok: false, error: 'READ_ERROR' });
                reader.readAsDataURL(blob);
              });
            } catch (e) {
              return { ok: false, error: e.message || 'FETCH_EXCEPTION' };
            }
          },
          args: [url],
        });

        const r = scriptResult?.result;
        if (!r?.ok) {
          sendResponse({ success: false, error: r?.error || 'FETCH_FAILED' });
          return;
        }
        sendResponse({
          success: true,
          base64: r.base64,
          contentType: r.contentType,
          size: r.size,
        });
      } catch (err) {
        console.error('[SEOSONA Flow] fetchImageAsBase64 error:', err.message);
        sendResponse({ success: false, error: 'EXCEPTION', message: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'chatgpt:fetchImage') {
    // Phase CG-3.4: Fetch ChatGPT CDN image qua cookie session của tab chatgpt.com.
    // URL CDN dạng `https://chatgpt.com/backend-api/estuary/content?id=file_xxx&sig=...`
    // CHỈ accessible khi có cookie chatgpt.com — KHÔNG thể fetch từ background context
    // hay tab khác. Phải inject `chrome.scripting.executeScript` vào tab ChatGPT để fetch.
    if (!_isTrustedSender(sender)) { sendResponse({ success: false, error: 'Untrusted sender' }); return true; }
    const { url, tabId } = message;
    (async () => {
      try {
        if (!url || !tabId) {
          sendResponse({ success: false, error: 'MISSING_PARAMS' });
          return;
        }
        // SSRF guard: credentialed injected fetch — reject disallowed (loopback/private/metadata) URLs.
        if (!_isAllowedUrl(url)) {
          sendResponse({ success: false, error: 'URL not allowed' });
          return;
        }
        // Inject fetch trong context tab ChatGPT (cookie session authenticated)
        const [scriptResult] = await chrome.scripting.executeScript({
          target: { tabId },
          func: async (imgUrl) => {
            try {
              const resp = await fetch(imgUrl, { credentials: 'include' });
              if (!resp.ok) return { ok: false, status: resp.status, error: 'HTTP_' + resp.status };
              const blob = await resp.blob();
              // Convert blob → base64 data URL qua FileReader
              return await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve({
                  ok: true,
                  base64: reader.result,
                  mime: blob.type || 'image/png',
                  size: blob.size,
                });
                reader.onerror = () => resolve({ ok: false, error: 'READ_ERROR' });
                reader.readAsDataURL(blob);
              });
            } catch (e) {
              return { ok: false, error: e.message || 'FETCH_EXCEPTION' };
            }
          },
          args: [url],
        });
        const r = scriptResult?.result;
        if (!r?.ok) {
          sendResponse({
            success: false,
            error: r?.error || 'FETCH_FAILED',
            status: r?.status,
          });
          return;
        }
        sendResponse({
          success: true,
          base64: r.base64,
          mime: r.mime,
          size: r.size,
        });
      } catch (err) {
        console.error('[SEOSONA Flow] chatgpt:fetchImage error:', err.message);
        sendResponse({ success: false, error: 'EXCEPTION', message: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'chatgpt:closeTab') {
    const { tabId } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: true }); return; }
        try {
          await chrome.tabs.remove(tabId);
        } catch (e) {
          // Tab có thể đã đóng — bỏ qua
        }
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'chatgpt:navigated') {
    // Chỉ relay khi message đến TỪ content script (sender.tab tồn tại). Bản broadcast
    // background gửi ra sidePanel KHÔNG có sender.tab → tránh infinite loop.
    if (!sender.tab) {
      sendResponse({ success: true, skipped: true });
      return true;
    }
    const tabId = sender.tab.id;
    // Đổi action name để tránh listener này bắt lại bản broadcast của chính nó.
    chrome.runtime.sendMessage({
      action: 'chatgpt:navigatedBroadcast',
      tabId,
      url: message.url,
    }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#onerror', _e); });
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'chatgpt:getTabInfo') {
    const { tabId } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }
        const tabInfo = await chrome.tabs.get(tabId);
        sendResponse({
          success: true,
          url: tabInfo.url || null,
          active: !!tabInfo.active,
          status: tabInfo.status,
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // ============================================================
  // === Phase G-2: Grok Session Manager handlers ================
  // ============================================================
  // Các action `grok:*` riêng biệt với chatgpt:* / gemini:* / chatAI:send.
  // Mirror pattern ChatGPT (Phase CG-2) cho Grok provider.
  // ============================================================

  if (message.action === 'grok:findOrCreateTab') {
    const { createIfMissing = true, activate = true } = message;
    (async () => {
      try {
        let currentWindowId = sender.tab?.windowId;
        if (!currentWindowId) {
          const focusedWindow = await chrome.windows.getCurrent();
          currentWindowId = focusedWindow?.id;
        }

        // Tìm tab grok.com — ưu tiên trong cùng window
        let tabs = await chrome.tabs.query({ url: PROVIDER_URLS.grok.tabQuery, windowId: currentWindowId });
        if (tabs.length === 0) {
          tabs = await chrome.tabs.query({ url: PROVIDER_URLS.grok.tabQuery });
        }

        let tabId;
        if (tabs.length > 0) {
          // Ưu tiên tab đã ở /imagine (sẵn sàng tương tác)
          const imagineTab = tabs.find(t => t.url && t.url.includes('/imagine'));
          if (imagineTab) {
            tabId = imagineTab.id;
          } else {
            // Tab grok.com tồn tại nhưng KHÔNG ở /imagine → navigate đến /imagine
            tabId = tabs[0].id;
            await chrome.tabs.update(tabId, { url: PROVIDER_URLS.grok.imagine });
            // Chờ navigation complete
            await new Promise((resolve) => {
              const timeout = setTimeout(() => {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }, 10000);
              const listener = (updatedTabId, changeInfo) => {
                if (updatedTabId === tabId && changeInfo.status === 'complete') {
                  clearTimeout(timeout);
                  chrome.tabs.onUpdated.removeListener(listener);
                  resolve();
                }
              };
              chrome.tabs.onUpdated.addListener(listener);
            });
          }
        } else if (createIfMissing) {
          const tab = await chrome.tabs.create({
            url: PROVIDER_URLS.grok.imagine,
            active: !!activate,
            windowId: currentWindowId,
          });
          tabId = tab.id;
          // Chờ tab load xong (max 15s)
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }, 15000);
            const listener = (updatedTabId, changeInfo) => {
              if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
        } else {
          sendResponse({ success: false, error: 'NO_TAB' });
          return;
        }

        sendResponse({ success: true, tabId });
      } catch (err) {
        console.error('[SEOSONA Flow] grok:findOrCreateTab error:', err.message);
        sendResponse({ success: false, error: err.message || 'NO_TAB' });
      }
    })();
    return true;
  }

  if (message.action === 'cloudflare:challenge') {
    // Bug 49 forward: content script Grok gửi event → broadcast tới mọi extension page
    // (sidebar + workflow popup). chrome.runtime.sendMessage không có tabId → đến tất cả listener.
    try {
      chrome.runtime.sendMessage({
        action: 'cloudflare:challenge',
        provider: message.provider,
        phase: message.phase,
        elapsedSec: message.elapsedSec || 0,
        timeoutSec: message.timeoutSec || 120,
        tabId: sender?.tab?.id || null,
      }).catch(() => { /* no listener — sidebar maybe closed */ });
    } catch (_) { /* owned suppression (P4.T7): silent by design */ }
    sendResponse?.({ success: true });
    return false;
  }

  if (message.action === 'grok:ensureActive') {
    // Support 2 caller patterns:
    //   - sidePanel: pass tabId explicit
    //   - content script (Grok page itself): no tabId → fallback sender.tab.id
    const tabId = message.tabId || sender?.tab?.id;
    const focusWindow = message.focusWindow === true;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }
        const tabInfo = await chrome.tabs.get(tabId);
        if (!tabInfo.active) {
          await chrome.tabs.update(tabId, { active: true });
          // Chờ React unthrottle (300ms — pattern giống Flow/ChatGPT)
          await new Promise(r => setTimeout(r, 300));
        }
        // Cloudflare challenge: cần bring window to front để user thấy turnstile.
        // Tab có thể active trong window background → user vẫn không thấy.
        if (focusWindow && tabInfo.windowId) {
          try {
            // Nhớ window đang focus (popup workflow-editor) TRƯỚC khi focus grok → restore sau Cloudflare.
            // Set-or-clear: nếu window đang focus CHÍNH là grok (GenTab đã focusWindow:true) → clear
            // (không restore, grok giữ focus). Chỉ workflow-editor (popup ≠ grok) mới remember + restore.
            try {
              const prev = await chrome.windows.getLastFocused();
              _grokFocusReturnWindowId = (prev && prev.id !== tabInfo.windowId) ? prev.id : null;
            } catch (_) { /* owned suppression (P4.T7): silent by design */ }
            await chrome.windows.update(tabInfo.windowId, { focused: true, drawAttention: true });
          } catch (winErr) {
            console.warn('[SEOSONA Flow] grok:ensureActive focusWindow failed:', winErr.message);
          }
        }
        sendResponse({ success: true, active: true });
      } catch (err) {
        console.error('[SEOSONA Flow] grok:ensureActive error:', err.message);
        sendResponse({ success: false, error: err.message || 'ACTIVATE_FAILED' });
      }
    })();
    return true;
  }

  // 2026-05-28: trả focus về window TRƯỚC Cloudflare (popup workflow/sidebar) sau khi challenge
  // resolved + submit xong → không kẹt focus ở tab grok. No-op nếu không có window đã nhớ.
  if (message.action === 'grok:restoreFocus') {
    (async () => {
      try {
        if (_grokFocusReturnWindowId != null) {
          const wid = _grokFocusReturnWindowId;
          _grokFocusReturnWindowId = null;
          try {
            await chrome.windows.get(wid); // verify còn tồn tại
            await chrome.windows.update(wid, { focused: true });
          } catch (_) { /* window đã đóng → bỏ qua */ }
        }
        sendResponse({ success: true });
      } catch (e) {
        sendResponse({ success: false, error: e?.message });
      }
    })();
    return true;
  }

  if (message.action === 'grok:injectScript') {
    const { tabId } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }

        // 2026-05-25: Pre-check tab URL (race tab redirect — silent skip).
        // Grok hợp lệ ở 2 host: grok.com (chính) + x.com/i/grok (sub-route).
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        const url = tab?.url || '';
        const isGrokUrl = url.startsWith('https://grok.com/') || url.includes('://x.com/i/grok');
        if (!isGrokUrl) {
          sendResponse({ success: false, error: 'NOT_GROK_URL', url });
          return;
        }

        // Kiểm tra flag double-inject
        const checkResults = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => !!window.__seosonaflowGrokLoaded__,
        });
        const alreadyLoaded = !!(checkResults && checkResults[0] && checkResults[0].result);

        if (!alreadyLoaded) {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content_scripts/chat-content-grok.js'],
          });
        }
        sendResponse({ success: true, alreadyLoaded });
      } catch (err) {
        console.warn('[SEOSONA Flow] grok:injectScript skipped:', err.message);
        sendResponse({ success: false, error: err.message || 'INJECT_FAILED' });
      }
    })();
    return true;
  }

  if (message.action === 'grok:checkLogin') {
    const { tabId } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }

        const results = await chrome.scripting.executeScript({
          target: { tabId },
          // Func phải standalone — không reference closure outside
          func: function checkGrokLoginStatus() {
            // Editor TipTap: form contenteditable
            const editor = document.querySelector("form div[contenteditable='true']")
                        || document.querySelector('.ProseMirror')
                        || document.querySelector('.tiptap');
            // Login link: a[href*="/login"]
            const loginLink = document.querySelector('a[href*="/login"]')
                           || document.querySelector('a[href*="/signin"]');

            if (!editor) {
              // Nếu có login link rõ ràng + không có editor → chưa login
              if (loginLink) return { ready: false, error: 'NOT_LOGGED_IN' };
              return { ready: false, error: 'EDITOR_NOT_FOUND' };
            }
            return { ready: true };
          },
        });
        const result = (results && results[0] && results[0].result) || { ready: false, error: 'EDITOR_NOT_FOUND' };
        sendResponse({ success: true, ...result });
      } catch (err) {
        console.error('[SEOSONA Flow] grok:checkLogin error:', err.message);
        sendResponse({ success: false, error: err.message || 'CHECK_FAILED' });
      }
    })();
    return true;
  }

  if (message.action === 'grok:applySettings' || message.action === 'grok:setRatio') {
    // Relay tới content script để gọi applyGrokSettings (đã sẵn trong chat-content-grok.js).
    // grok:setRatio là alias chỉ apply ratio.
    const { tabId, settings, ratio } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }

        // Build payload settings
        let payload = settings || {};
        if (message.action === 'grok:setRatio' && ratio) {
          payload = { ratio };
        }

        // Inject inline func gọi applyGrokSettings nếu content script đã loaded.
        // applyGrokSettings được expose qua handler grok:applySettingsInline (chưa có) — thay
        // bằng inline executeScript thực thi trực tiếp các DOM operations.
        // Để đơn giản + idempotent, gọi qua tabs.sendMessage tới content script:
        const sent = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, {
            action: 'grok:applySettingsInline',
            settings: payload,
          }, (resp) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(resp || { success: false, error: 'NO_RESPONSE' });
          });
        });
        sendResponse(sent);
      } catch (err) {
        console.error('[SEOSONA Flow] grok:applySettings error:', err.message);
        sendResponse({ success: false, error: err.message || 'APPLY_FAILED' });
      }
    })();
    return true;
  }

  if (message.action === 'grok:fetchImage' || message.action === 'grok:fetchMedia') {
    // Bug fix 2026-06-03: Try-SW-first cho MỌI host (kể cả grok.com). Trước fix: code split logic
    // theo host — chỉ SW fetch cho non-grok.com; grok.com BẮT BUỘC tab-inject. Khi user đóng tab
    // Grok giữa gen và download → tab-inject fail "No tab with id" → Download node không tải được
    // video Grok (log workflow-editor 2026-06-03). Manifest đã có host_permissions cho `*.grok.com`
    // + `*.x.ai` → SW fetch với credentials:include sẽ send cookies. Tab-inject giữ làm fallback
    // cho edge case SW fetch fail (vd cookie SameSite=Strict không qualify SW context).
    if (!_isTrustedSender(sender)) { sendResponse({ success: false, error: 'Untrusted sender' }); return true; }
    const { url, tabId } = message;
    (async () => {
      try {
        if (!url) {
          sendResponse({ success: false, error: 'MISSING_PARAMS' });
          return;
        }
        // SSRF guard: SW/tab credentialed fetch — reject disallowed (loopback/private/metadata) URLs.
        if (!_isAllowedUrl(url)) {
          sendResponse({ success: false, error: 'URL not allowed' });
          return;
        }
        const fetchHost = (() => { try { return new URL(url).hostname; } catch (_) { return ''; } })();

        // Tier 1: SW fetch (host_permissions cover *.grok.com + *.x.ai). Cookies forwarded
        // qua credentials:include nếu cookie không bị SameSite=Strict restriction.
        const trySwFetch = async () => {
          try {
            const resp = await fetch(url, { credentials: 'include' });
            if (!resp.ok) {
              return { success: false, error: 'HTTP_' + resp.status, status: resp.status };
            }
            const blob = await resp.blob();
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let bin = '';
            const CH = 0x8000; // chunk tránh stack overflow file lớn
            for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
            const mime = blob.type || 'image/jpeg';
            return { success: true, base64: `data:${mime};base64,` + btoa(bin), mime, size: blob.size };
          } catch (e) {
            return { success: false, error: e.message || 'SW_FETCH_FAILED' };
          }
        };

        const swResult = await trySwFetch();
        if (swResult.success) {
          sendResponse(swResult);
          return;
        }

        // Tier 2 fallback: tab-inject (chỉ cho grok.com hosts, cần cookie session từ tab Grok).
        // Non-grok.com hosts (vd *.x.ai) không có tab match → return SW error luôn.
        if (!fetchHost.endsWith('grok.com') || !tabId) {
          console.warn('[SEOSONA Flow] grok:fetchImage SW fetch failed:', swResult.error,
            fetchHost.endsWith('grok.com') ? `(no tabId for tab-inject fallback)` : `(non-grok.com host, no fallback)`);
          sendResponse(swResult);
          return;
        }

        console.log('[SEOSONA Flow] grok:fetchImage SW fetch failed:', swResult.error, '→ trying tab-inject fallback');

        // Tab-inject fetch trong context tab Grok (cookie session đầy đủ)
        let scriptResult;
        try {
          [scriptResult] = await chrome.scripting.executeScript({
            target: { tabId },
            func: async (mediaUrl) => {
              try {
                const resp = await fetch(mediaUrl, { credentials: 'include' });
                if (!resp.ok) return { ok: false, status: resp.status, error: 'HTTP_' + resp.status };
                const blob = await resp.blob();
                return await new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve({
                    ok: true,
                    base64: reader.result,
                    mime: blob.type || 'image/png',
                    size: blob.size,
                  });
                  reader.onerror = () => resolve({ ok: false, error: 'READ_ERROR' });
                  reader.readAsDataURL(blob);
                });
              } catch (e) {
                return { ok: false, error: e.message || 'FETCH_EXCEPTION' };
              }
            },
            args: [url],
          });
        } catch (injectErr) {
          // Tab closed / inaccessible → return SW error (gốc) thay vì inject error (less helpful)
          console.warn('[SEOSONA Flow] grok:fetchImage tab-inject fail:', injectErr.message, '→ return SW error');
          sendResponse(swResult);
          return;
        }

        const r = scriptResult?.result;
        if (!r?.ok) {
          sendResponse({
            success: false,
            error: r?.error || 'FETCH_FAILED',
            status: r?.status,
          });
          return;
        }
        sendResponse({
          success: true,
          base64: r.base64,
          mime: r.mime,
          size: r.size,
        });
      } catch (err) {
        console.error('[SEOSONA Flow] grok:fetchImage error:', err.message);
        sendResponse({ success: false, error: 'EXCEPTION', message: err.message });
      }
    })();
    return true;
  }

  // [Affiliate Creator Page] Unified provider image fetch cho publish modal (CreatorTemplatePublish).
  // Resolve tab provider theo domain URL → inject credentialed fetch (cookie session) → trả data URL.
  // ChatGPT/Grok cookie-gated cần tab provider đang mở. Flow signed → cũng fetch được. Trả base64
  // dạng data URL đầy đủ (data:...;base64,...) để modal parse đồng nhất.
  if (message.action === 'creator:fetchImage') {
    if (!_isTrustedSender(sender)) { sendResponse({ success: false, error: 'Untrusted sender' }); return true; }
    const url = message.url;
    (async () => {
      try {
        if (!url || typeof url !== 'string') { sendResponse({ success: false, error: 'MISSING_URL' }); return; }
        // SSRF guard: gate the injected/SW credentialed fetch on allowed URL (loopback/private/metadata blocked).
        if (!_isAllowedUrl(url)) { sendResponse({ success: false, error: 'URL not allowed' }); return; }
        // Xác định provider theo domain + credentials policy.
        // Flow signed CDN (flow-content.google) trả ACAO:* → credentialed fetch bị CORS chặn →
        // BẮT BUỘC fetch KHÔNG credentials (signed URL tự auth). ChatGPT/Grok cookie-gated → credentials:include.
        let queryPatterns = [];
        let useCredentials = true;
        if (url.includes('chatgpt.com') || url.includes('oaiusercontent.com') || url.includes('sandboxed.openai.com')) {
          queryPatterns = [PROVIDER_URLS.chatgpt.tabQuery];
        } else if (url.includes('grok.com') || url.includes('x.ai')) {
          queryPatterns = PROVIDER_URLS.grok.tabQueryPatterns || [PROVIDER_URLS.grok.tabQuery];
        } else if (url.includes('labs.google') || url.includes('flow.google') || url.includes('flow-content.google') || url.includes('uxlfoundation.org')) {
          queryPatterns = [PROVIDER_URLS.flow.tabQuery];
          useCredentials = false; // Flow signed URL — credentialed → CORS block
        } else {
          // Domain không thuộc provider → thử fetch trực tiếp từ SW (public CDN).
          queryPatterns = [];
        }

        let tabId = null;
        for (const pattern of queryPatterns) {
          try {
            const tabs = await chrome.tabs.query({ url: pattern });
            if (tabs && tabs.length > 0) { tabId = tabs[0].id; break; }
          } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        }

        const fetchInTab = async (tid) => {
          const [res] = await chrome.scripting.executeScript({
            target: { tabId: tid },
            func: async (imgUrl, withCreds) => {
              try {
                const resp = await fetch(imgUrl, withCreds ? { credentials: 'include' } : {});
                if (!resp.ok) return { ok: false, status: resp.status, error: 'HTTP_' + resp.status };
                const blob = await resp.blob();
                return await new Promise((resolve) => {
                  const reader = new FileReader();
                  reader.onload = () => resolve({ ok: true, base64: reader.result, mime: blob.type || 'image/png' });
                  reader.onerror = () => resolve({ ok: false, error: 'READ_ERROR' });
                  reader.readAsDataURL(blob);
                });
              } catch (e) { return { ok: false, error: e.message || 'FETCH_EXCEPTION' }; }
            },
            args: [url, useCredentials],
          });
          return res?.result;
        };

        let r = null;
        if (tabId) {
          r = await fetchInTab(tabId);
        }
        // Fallback: SW direct fetch (public CDN không cần cookie).
        if (!r?.ok && _isAllowedUrl(url)) {
          try {
            const resp = await fetch(url, { cache: 'no-store' });
            if (resp.ok) {
              const blob = await resp.blob();
              const base64 = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(blob);
              });
              if (base64) r = { ok: true, base64, mime: blob.type || 'image/png' };
            }
          } catch (_) { /* owned suppression (P4.T7): silent by design */ }
        }

        if (!r?.ok) {
          sendResponse({ success: false, error: r?.error || 'NO_PROVIDER_TAB', status: r?.status });
          return;
        }
        sendResponse({ success: true, base64: r.base64, mime: r.mime });
      } catch (err) {
        console.error('[SEOSONA Flow] creator:fetchImage error:', err.message);
        sendResponse({ success: false, error: 'EXCEPTION', message: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'grok:closeTab') {
    const { tabId } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: true }); return; }
        try {
          await chrome.tabs.remove(tabId);
        } catch (e) {
          // Tab có thể đã đóng — bỏ qua
        }
        sendResponse({ success: true });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'grok:submitAndWait') {
    // Relay tới content script (chat-content-grok.js đã sẵn listener).
    const { tabId } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }
        // Forward toàn bộ payload đến content script
        const payload = { ...message };
        delete payload.tabId; // không cần bên content script
        const resp = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tabId, payload, (r) => {
            if (chrome.runtime.lastError) {
              resolve({ success: false, error: chrome.runtime.lastError.message });
              return;
            }
            resolve(r || { success: false, error: 'NO_RESPONSE' });
          });
        });
        sendResponse(resp);
      } catch (err) {
        console.error('[SEOSONA Flow] grok:submitAndWait error:', err.message);
        sendResponse({ success: false, error: 'EXCEPTION', message: err.message });
      }
    })();
    return true;
  }

  if (message.action === 'grok:navigated') {
    // CRITICAL re-broadcast loop fix: chỉ relay khi đến từ content script (sender.tab tồn tại).
    // Bản broadcast `grok:navigatedBroadcast` sidePanel nhận sẽ KHÔNG có sender.tab → tránh loop.
    if (!sender.tab) {
      sendResponse({ success: true, skipped: true });
      return true;
    }
    const tabId = sender.tab.id;
    chrome.runtime.sendMessage({
      action: 'grok:navigatedBroadcast',
      tabId,
      url: message.url,
    }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#onerror', _e); });
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'grok:getTabInfo') {
    const { tabId } = message;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }
        const tabInfo = await chrome.tabs.get(tabId);
        sendResponse({
          success: true,
          url: tabInfo.url || null,
          active: !!tabInfo.active,
          status: tabInfo.status,
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // Không xử lý messages khác (contentLog, promptExecutionComplete, etc.)
  // Return false/undefined để Chrome biết listener này không handle message này
  return false;
});

// === Phase CG-2: Forward chatgpt.com tab close events đến ChatGPTSession ===
// Khi user đóng tab chatgpt.com → broadcast 'chatgpt:tabClosed' để ChatGPTSession reset cache.
chrome.tabs.onRemoved.addListener((tabId) => {
  // Broadcast tới mọi context (sidePanel + popups). ChatGPTSession sẽ tự lọc theo _tabId.
  chrome.runtime.sendMessage({ action: 'chatgpt:tabClosed', tabId }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#onerror', _e); });
  // Phase G-2: cùng listener cho Grok — GrokSession sẽ tự lọc theo _tabId.
  chrome.runtime.sendMessage({ action: 'grok:tabClosed', tabId }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#onerror', _e); });
  // [FIX 2026-07-09] Claude cũng subscribe claude:tabClosed để reset cache — trước đây không ai gửi
  // → đóng tab claude.ai xong cache _tabId vẫn sống 60s → ensureReady trả tabId chết.
  chrome.runtime.sendMessage({ action: 'claude:tabClosed', tabId }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#onerror', _e); });
});

// === Phase G-2: Forward grok.com tab navigation events ===
// Khi tab grok.com đổi URL (status='complete'), relay broadcast để GrokSession invalidate UI cache.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  if (!tab || !tab.url || !tab.url.includes('grok.com')) return;
  chrome.runtime.sendMessage({
    action: 'grok:navigatedBroadcast',
    tabId,
    url: tab.url,
  }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#onerror', _e); });
});

// Keyboard shortcuts
chrome.commands?.onCommand?.addListener((command) => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, { action: 'command', command });
    }
  });
});

// ===== Provider Config Helpers (DOM Resilience Plan) =====
const _PROVIDER_CONFIG_CACHE_KEY = 'seosona_provider_configs';
const _PROVIDER_CONFIG_TTL_MS = 60 * 60 * 1000; // 1h

async function _getApiBaseUrl() {
  return new Promise(resolve => {
    chrome.storage.local.get(['af_api_url'], res => {
      // Phase 3.5 Bug I: derive từ API_BASE_DEFAULT (strip /api/v1 suffix nếu có)
      resolve(res?.af_api_url || API_BASE_DEFAULT.replace(/\/api\/v\d+\/?$/, ''));
    });
  });
}

async function _getProviderConfigsFromCache() {
  return new Promise(resolve => {
    chrome.storage.local.get([_PROVIDER_CONFIG_CACHE_KEY], res => {
      const cached = res?.[_PROVIDER_CONFIG_CACHE_KEY];
      if (cached && Date.now() < cached.expiresAt) {
        resolve(cached);
      } else {
        resolve(null);
      }
    });
  });
}

async function _fetchProviderConfigs() {
  try {
    const cached = await _getProviderConfigsFromCache();
    if (cached) return cached.data;

    // Offline: KHÔNG fetch server (API chết) — ProviderConfigManager._primeLocalDefaults đã seed
    // seosona_provider_configs khi load. Nếu race cold-start chưa seed → trả null (caller đọc storage
    // đã prime). Loại request vô vọng, giữ invariant no-backend-offline.
    if (self.SEOSONA_LOCAL_MODE !== false) return null;

    const baseUrl = await _getApiBaseUrl();
    const resp = await _signedFetch(`${baseUrl}/api/v1/providers/dom-selectors`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Extension-Id': chrome.runtime.id,
      },
    });

    if (resp.status === 403) {
      try {
        const body = await resp.clone().json();
        if (_isExtensionAuthRejection(body, 403)) {
          _handleExtensionAuthRejection();
          return null;
        }
      } catch (_) { /* owned suppression (P4.T7): silent by design */ }
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();

    if (json.success && json.data) {
      const cacheData = {
        data: json.data,
        expiresAt: Date.now() + _PROVIDER_CONFIG_TTL_MS,
        fetchedAt: Date.now(),
      };
      chrome.storage.local.set({ [_PROVIDER_CONFIG_CACHE_KEY]: cacheData });
      return json.data;
    }
  } catch (e) {
    console.warn('[Background] Provider config fetch failed:', e.message);
  }
  return null;
}

// ===== API Configs (ratios, download_resolutions, error_patterns) =====
const _API_CONFIGS_CACHE_KEY = 'seosona_provider_api_configs';
const _API_CONFIGS_TTL_MS = 60 * 60 * 1000; // 1h

async function _fetchApiConfigs() {
  try {
    // Check cache first
    const cached = await new Promise(resolve => {
      chrome.storage.local.get([_API_CONFIGS_CACHE_KEY], res => {
        const data = res?.[_API_CONFIGS_CACHE_KEY];
        if (data && Date.now() < data.expiresAt) {
          resolve(data);
        } else {
          resolve(null);
        }
      });
    });
    if (cached) return cached.data;

    // Offline: KHÔNG fetch server (xem _fetchProviderConfigs) — _primeLocalDefaults đã seed api-configs.
    if (self.SEOSONA_LOCAL_MODE !== false) return null;

    const baseUrl = await _getApiBaseUrl();
    const resp = await _signedFetch(`${baseUrl}/api/v1/providers/api-configs`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Extension-Id': chrome.runtime.id,
      },
    });

    if (resp.status === 403) {
      try {
        const body = await resp.clone().json();
        if (_isExtensionAuthRejection(body, 403)) {
          _handleExtensionAuthRejection();
          return null;
        }
      } catch (_) { /* owned suppression (P4.T7): silent by design */ }
    }

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();

    if (json.success && json.data) {
      const cacheData = {
        data: json.data,
        expiresAt: Date.now() + _API_CONFIGS_TTL_MS,
        fetchedAt: Date.now(),
      };
      chrome.storage.local.set({ [_API_CONFIGS_CACHE_KEY]: cacheData });

      // Derive patterns cho content scripts (chat-content-chatgpt.js, chat-content-grok.js)
      // — đọc từ `af_chatgpt_config`/`af_grok_config` storage key.
      // Cold start (sidebar chưa mở) cần data trong storage trước khi content script chạy.
      // ChatGPT có 2 keys api_config (error_patterns + ui_text_patterns) — MERGE thành 1 flat object
      // để content script đọc trực tiếp `cfg.delete_menu_text`, `cfg.cloudflare_challenge_text`, ...
      try {
        const cgErrorPatterns = json.data?.chatgpt?.configs?.error_patterns || {};
        const cgUiTextPatterns = json.data?.chatgpt?.configs?.ui_text_patterns || {};
        const cgMerged = { ...cgErrorPatterns, ...cgUiTextPatterns };
        if (Object.keys(cgMerged).length > 0) {
          chrome.storage.local.set({ af_chatgpt_config: { data: cgMerged, fetched_at: Date.now() } });
        }
        const grokPatterns = json.data?.grok?.configs?.error_patterns;
        if (grokPatterns && typeof grokPatterns === 'object') {
          chrome.storage.local.set({ af_grok_config: { data: grokPatterns, fetched_at: Date.now() } });
        }
      } catch (_) { /* ignore */ }

      return json.data;
    }
  } catch (e) {
    console.warn('[Background] API configs fetch failed:', e.message);
  }
  return null;
}

// Pre-fetch provider configs on extension startup
// Signal `_seosonaConfigsReady` cho sidebar biết background đã fetch xong → tránh duplicate API calls (429).
const _CONFIGS_READY_KEY = '_seosonaConfigsReady';
const _CONFIGS_READY_TTL_MS = 30000; // 30s — sidebar check nếu < 30s thì skip fetch
let _prefetchPromise = null; // Lock: prevent concurrent fetches

async function _prefetchAllConfigs() {
  // Dedup: nếu đang fetch → return promise đang chạy thay vì fetch lại
  if (_prefetchPromise) {
    console.log('[Background] Config fetch already in progress, waiting...');
    return _prefetchPromise;
  }
  _prefetchPromise = (async () => {
    try {
      await Promise.all([
        _fetchProviderConfigs(),
        _fetchApiConfigs(),
      ]);
      // Signal sidebar: background đã fetch xong, cache đã warm
      chrome.storage.local.set({ [_CONFIGS_READY_KEY]: Date.now() });
      console.log('[Background] Provider configs + API configs pre-fetched, signaled _seosonaConfigsReady');
    } catch (e) {
      console.warn('[Background] Pre-fetch configs failed:', e.message);
    } finally {
      _prefetchPromise = null;
    }
  })();
  return _prefetchPromise;
}

// =============================================================================
// === IMAGE-TO-PROMPT (I2P) — Provider mode ===
// Chuột phải ảnh → mở card (i2p-content.js) → phân tích bằng ChatGPT/Gemini user đã login.
// Config (default provider + prompt template) lấy từ server /default-settings (server-only).
// =============================================================================
const I2P_CONTEXT_MENU_ID = self.SEOSONA_ContextMenuModel?.IDS?.ANALYZE_ID || 'seosonaflow-i2p-analyze';
const I2P_REGION_MENU_ID = self.SEOSONA_ContextMenuModel?.IDS?.REGION_ID || 'seosonaflow-i2p-region';
let _i2pConfigCache = null;
let _i2pConfigAt = 0;

// Feature gate dùng chung (content script không có window.featureGate). Đọc af_entitlements (cache do
// sidebar populate) → fallback fetch /entitlements khi cache miss → tránh false-gate user có quyền.
// Trả {loggedIn, allowed}. Dùng cho i2p_enabled + prompt_assistant_enabled.
async function _featureAllowed(featureKey) {
  const isOn = (f) => !!f && (f.value === '1' || f.value === 1 || f.value === true);
  // LOCAL mode: mọi feature allow-all (không server entitlements). Khớp FeatureGate/TrialGate frontend.
  try {
    const _lm = await new Promise(r => chrome.storage.local.get(['SEOSONA_LOCAL_MODE'], x => r(x.SEOSONA_LOCAL_MODE)));
    if (_lm !== false) return { loggedIn: true, allowed: true };
  } catch (_) { /* owned suppression (P4.T7): silent by design */ }
  try {
    const store = await new Promise(r => chrome.storage.local.get(['af_auth', 'af_entitlements'], r));
    const loggedIn = !!(store.af_auth && store.af_auth.token);
    const cached = store.af_entitlements?.entitlements;
    if (cached && cached[featureKey]) return { loggedIn, allowed: isOn(cached[featureKey]) };
    try {
      const r = await _signedFetch(`${getApiBaseUrl()}/entitlements`, {
        method: 'GET', headers: { 'X-Extension-Id': chrome.runtime.id, 'Accept': 'application/json' },
      });
      const json = await r.json();
      const features = json?.data?.features || json?.features || {};
      return { loggedIn, allowed: isOn(features[featureKey]) };
    } catch (_) { return { loggedIn, allowed: false }; }
  } catch (e) { return { loggedIn: false, allowed: false }; }
}

// i2p config đóng gói cho LOCAL mode: instruction "mô tả ảnh → prompt tạo ảnh" gửi kèm ảnh cho
// ChatGPT/Gemini. Không placeholder (ảnh đính riêng). Không fetch server.
const _I2P_LOCAL_CONFIG = {
  mode: 'provider',
  defaultProvider: 'gemini',
  maxImagePx: 1536,
  deleteAfter: false,
  timeoutMs: 180000,
  promptTemplate: [
    'You are an expert text-to-image prompt engineer. Analyze the attached image and produce a prompt',
    'that would let an AI recreate this image faithfully.',
    'Respond with ONLY a single valid minified JSON object — no markdown, no code fence, no commentary,',
    'no text before or after. The object must have EXACTLY these three string keys:',
    '{"subject":"<3-6 word label of the main subject>",',
    '"recreation_prompt_en":"<ONE detailed English prompt in a single flowing paragraph covering: main',
    'subject(s) + what they are doing, setting/background, composition & camera angle, art style/medium,',
    'lighting, color palette & mood, key details/textures. Concrete visual nouns and adjectives. No headings,',
    'no lists, no line breaks.>",',
    '"recreation_prompt_vi":"<the SAME prompt fully and naturally translated into Vietnamese>"}',
    'Describe only what is visible. Escape any double quotes inside the strings. Output ONLY the JSON object.',
  ].join('\n'),
};
async function _i2pGetConfig() {
  const now = Date.now();
  // LOCAL mode: dùng config đóng gói (instruction) — KHÔNG fetch server.
  try {
    var _lm = await new Promise(r => chrome.storage.local.get(['SEOSONA_LOCAL_MODE'], x => r(x.SEOSONA_LOCAL_MODE)));
    if (_lm !== false) { _i2pConfigCache = _I2P_LOCAL_CONFIG; _i2pConfigAt = now; return _i2pConfigCache; }
  } catch (_) { /* owned suppression (P4.T7): silent by design */ }
  if (_i2pConfigCache && (now - _i2pConfigAt) < 30 * 1000) return _i2pConfigCache; // TTL ngắn → admin đổi reflect nhanh
  try {
    const resp = await _signedFetch(`${getApiBaseUrl()}/default-settings`, {
      method: 'GET',
      cache: 'no-store', // bypass HTTP cache (max-age=60) — admin đổi default reflect ngay sau khi SSE clear bg cache
      headers: { 'X-Extension-Id': chrome.runtime.id, 'Accept': 'application/json' },
    });
    const json = await resp.json();
    const s = json?.settings || json?.data || json || {};
    _i2pConfigCache = {
      mode: s.i2pMode || 'provider',
      defaultProvider: s.i2pDefaultProvider || 'gemini',
      promptTemplate: s.i2pPromptTemplate || '',
      maxImagePx: Number(s.i2pMaxImagePx) || 1536,
      deleteAfter: s.i2pDeleteAfter === true || s.i2pDeleteAfter === 1 || s.i2pDeleteAfter === '1',
      timeoutMs: Number(s.i2pTimeoutMs) || 180000, // 180s — admin tune qua default_i2p_timeout_ms
    };
    _i2pConfigAt = now;
  } catch (e) {
    console.warn('[I2P] getConfig fail:', e.message);
    // Server-only: KHÔNG hardcode template. Trả cache cũ nếu có, else rỗng (card sẽ báo lỗi config).
    if (!_i2pConfigCache) _i2pConfigCache = { mode: 'provider', defaultProvider: 'gemini', promptTemplate: '', maxImagePx: 1536, deleteAfter: false, timeoutMs: 180000 };
  }
  return _i2pConfigCache;
}

// Prompt Assistant config (server-driven, mirror i2p). Template + default settings A→E.
let _paConfigCache = null;
let _paConfigAt = 0;
// PA config đóng gói cho LOCAL mode: meta-prompt template (5 placeholder code thay: {media_type}
// {language} {format_structure} {constraints} {user_input}) + defaults + maxCount. Không fetch server.
// Toàn bộ ràng buộc chi tiết do PromptAssistantModal._buildMetaPrompt tự bơm vào {constraints}.
const _PA_LOCAL_CONFIG = {
  defaultProvider: 'chatgpt',
  deleteAfter: false,
  maxCount: 50,
  timeoutMs: 180000,
  promptTemplate: [
    'You are a world-class {media_type} prompt engineer. Turn the USER IDEA below into ready-to-use',
    '{media_type} generation prompts, each fully self-contained and directly pasteable into an AI image/video tool.',
    'Write the prompts in {language}.',
    '',
    'STAY FAITHFUL TO THE IDEA — most important rule:',
    '- Every prompt must depict the EXACT subject, topic and intent of the USER IDEA; never drift to a generic or unrelated scene.',
    '- Keep the specific people, objects, place, mood and message named in the idea; only add detail that serves it.',
    '- If the idea is a list or has steps, cover them faithfully and in order — one clear idea per prompt, no repetition.',
    '',
    'MAKE EACH PROMPT VIVID AND CONCRETE:',
    '- Name the SUBJECT + ACTION + SETTING + COMPOSITION explicitly (who/what, doing what, where, framed how).',
    '- Prefer concrete, filmable nouns and verbs over vague adjectives; no abstract fluff.',
    '',
    'STYLE / STRUCTURE TO FOLLOW:',
    '{format_structure}',
    '',
    'REQUIREMENTS (obey every single one):',
    '{constraints}',
    '',
    'USER IDEA:',
    '{user_input}',
    '',
    'Now output ONLY the finished prompts — no title, no preamble, no explanation, no closing remarks.',
    'Separate each prompt with a line containing only three dashes (---).',
  ].join('\n'),
  defaults: {
    media_type: 'image', count: 'auto', language: 'en', style: 'cinematic',
    aspect_ratio: '16:9', detail_level: 'concise', clip_duration: 'auto',
    total_duration: '', seconds_per_image: '', numbered: true, sequential: true,
    consistency: true, auto_script: false, render_sub: false,
  },
};
async function _paGetConfig() {
  const now = Date.now();
  // LOCAL mode: dùng config đóng gói (promptTemplate + defaults) — KHÔNG fetch server.
  try {
    var _lm = await new Promise(r => chrome.storage.local.get(['SEOSONA_LOCAL_MODE'], x => r(x.SEOSONA_LOCAL_MODE)));
    if (_lm !== false) { _paConfigCache = _PA_LOCAL_CONFIG; _paConfigAt = now; return _paConfigCache; }
  } catch (_) { /* owned suppression (P4.T7): silent by design */ }
  if (_paConfigCache && (now - _paConfigAt) < 30 * 1000) return _paConfigCache;
  try {
    const resp = await _signedFetch(`${getApiBaseUrl()}/default-settings`, {
      method: 'GET',
      cache: 'no-store', // bypass HTTP cache (max-age=60) — admin đổi default reflect ngay sau khi SSE clear bg cache
      headers: { 'X-Extension-Id': chrome.runtime.id, 'Accept': 'application/json' },
    });
    const json = await resp.json();
    const s = json?.settings || json?.data || json || {};
    const bool = (v, d) => (v === true || v === 1 || v === '1') ? true : (v === false || v === 0 || v === '0') ? false : d;
    _paConfigCache = {
      defaultProvider: s.paDefaultProvider || 'chatgpt',
      deleteAfter: bool(s.paDeleteAfter, false),
      promptTemplate: s.paPromptTemplate || '',
      maxCount: parseInt(s.paMaxCount, 10) > 0 ? parseInt(s.paMaxCount, 10) : 50,
      defaults: {
        media_type: s.paDefaultMediaType || 'image',
        count: (s.paDefaultCount != null ? String(s.paDefaultCount) : 'auto'),
        language: s.paDefaultLanguage || 'en',
        style: s.paDefaultStyle || 'cinematic',
        aspect_ratio: s.paDefaultAspectRatio || '16:9',
        detail_level: s.paDefaultDetailLevel || 'concise',
        clip_duration: s.paDefaultClipDuration || 'auto',
        total_duration: (s.paDefaultTotalDuration != null ? String(s.paDefaultTotalDuration) : ''),
        seconds_per_image: (s.paDefaultSecondsPerImage != null ? String(s.paDefaultSecondsPerImage) : ''),
        numbered: bool(s.paNumbered, true),
        sequential: bool(s.paSequential, true),
        consistency: bool(s.paConsistency, true),
        auto_script: bool(s.paAutoScript, false),
        render_sub: bool(s.paRenderSub, false),
      },
    };
    _paConfigAt = now;
  } catch (e) {
    console.warn('[PA] getConfig fail:', e.message);
    // Server-only: KHÔNG hardcode template. Trả cache cũ nếu có, else template rỗng (modal báo lỗi config).
    if (!_paConfigCache) _paConfigCache = { defaultProvider: 'chatgpt', deleteAfter: false, promptTemplate: '', defaults: {} };
  }
  return _paConfigCache;
}

// Prompt Assistant content formats (server-driven, giống addon-prompts). Cache 60s —
// admin tắt/bật format phản ánh nhanh ở extension (API đã active-only + forget cache khi toggle).
// PA style formats đóng gói cho LOCAL mode (trích từ dữ liệu style thật). Local → dùng cái này thay vì fetch server.
const _PA_LOCAL_FORMATS = [{"key":"style_1","name":"Anime","category":"Nghệ thuật","thumbnail":"https://labs.seosona.vn/storage/media/2026/06/539de753-6a23-438e-a067-856e1dff955c.jpeg","structure_prompt":"anime style, Japanese animation, vibrant colors, cel shading, detailed character design","is_premium":false,"defaults":{"style":"anime style"}},{"key":"style_2","name":"Realistic","category":"Nghệ thuật","thumbnail":"","structure_prompt":"photorealistic, hyperrealistic, highly detailed, 8k resolution, lifelike textures","is_premium":false,"defaults":{"style":"photorealistic"}},{"key":"style_3","name":"Watercolor","category":"Nghệ thuật","thumbnail":"","structure_prompt":"watercolor painting, soft brush strokes, fluid colors, wet-on-wet technique, artistic paper texture","is_premium":false,"defaults":{"style":"watercolor painting"}},{"key":"style_4","name":"Oil Painting","category":"Nghệ thuật","thumbnail":"","structure_prompt":"oil painting style, thick impasto brush strokes, rich textures, classical fine art, gallery quality","is_premium":false,"defaults":{"style":"oil painting style"}},{"key":"style_5","name":"Pencil Sketch","category":"Nghệ thuật","thumbnail":"","structure_prompt":"pencil sketch, hand-drawn, graphite shading, detailed line work, crosshatching technique","is_premium":false,"defaults":{"style":"pencil sketch"}},{"key":"style_6","name":"Pop Art","category":"Nghệ thuật","thumbnail":"","structure_prompt":"pop art style, bold flat colors, halftone dots, comic book aesthetic, Andy Warhol inspired","is_premium":false,"defaults":{"style":"pop art style"}},{"key":"style_7","name":"Minimalist","category":"Nghệ thuật","thumbnail":"","structure_prompt":"minimalist design, clean lines, simple geometric shapes, negative space, limited color palette","is_premium":false,"defaults":{"style":"minimalist design"}},{"key":"style_8","name":"Impressionist","category":"Nghệ thuật","thumbnail":"","structure_prompt":"impressionist painting, visible brush strokes, light and color emphasis, Monet inspired, plein air style","is_premium":false,"defaults":{"style":"impressionist painting"}},{"key":"style_9","name":"Art Nouveau","category":"Nghệ thuật","thumbnail":"","structure_prompt":"Art Nouveau style, organic flowing lines, floral ornamental patterns, Alphonse Mucha inspired, decorative borders","is_premium":false,"defaults":{"style":"Art Nouveau style"}},{"key":"style_10","name":"Ukiyo-e","category":"Nghệ thuật","thumbnail":"","structure_prompt":"ukiyo-e Japanese woodblock print style, flat colors, bold outlines, traditional Japanese art, Hokusai inspired","is_premium":false,"defaults":{"style":"ukiyo-e Japanese woodblock print style"}},{"key":"style_11","name":"Vintage Film","category":"Nhiếp ảnh","thumbnail":"","structure_prompt":"vintage film photography, retro aesthetic, film grain, nostalgic warm colors, analog camera look","is_premium":false,"defaults":{"style":"vintage film photography"}},{"key":"style_12","name":"Cinematic","category":"Nhiếp ảnh","thumbnail":"","structure_prompt":"cinematic lighting, movie still, dramatic atmosphere, anamorphic lens, film color grading","is_premium":false,"defaults":{"style":"cinematic lighting"}},{"key":"style_13","name":"Studio Photo","category":"Nhiếp ảnh","thumbnail":"","structure_prompt":"professional studio photography, controlled lighting setup, clean background, commercial quality","is_premium":false,"defaults":{"style":"professional studio photography"}},{"key":"style_14","name":"Editorial Fashion","category":"Nhiếp ảnh","thumbnail":"","structure_prompt":"editorial fashion photography, magazine quality, dramatic lighting, Vogue style, high fashion aesthetic","is_premium":false,"defaults":{"style":"editorial fashion photography"}},{"key":"style_15","name":"Street Photography","category":"Nhiếp ảnh","thumbnail":"","structure_prompt":"street photography, candid moment, urban environment, natural lighting, documentary style","is_premium":false,"defaults":{"style":"street photography"}},{"key":"style_16","name":"Drone Aerial","category":"Nhiếp ảnh","thumbnail":"","structure_prompt":"drone aerial photography, bird eye view, sweeping landscape, high altitude perspective, DJI quality","is_premium":false,"defaults":{"style":"drone aerial photography"}},{"key":"style_17","name":"Macro Close-up","category":"Nhiếp ảnh","thumbnail":"","structure_prompt":"macro photography, extreme close-up, shallow depth of field, intricate details revealed, 100mm macro lens","is_premium":false,"defaults":{"style":"macro photography"}},{"key":"style_18","name":"Long Exposure","category":"Nhiếp ảnh","thumbnail":"","structure_prompt":"long exposure photography, silky smooth water, light trails, motion blur, tripod shot, ND filter","is_premium":false,"defaults":{"style":"long exposure photography"}},{"key":"style_19","name":"Polaroid","category":"Nhiếp ảnh","thumbnail":"","structure_prompt":"Polaroid instant film, white border frame, slightly faded colors, nostalgic warm tone, casual snapshot feel","is_premium":false,"defaults":{"style":"Polaroid instant film"}},{"key":"style_20","name":"Tilt-Shift","category":"Nhiếp ảnh","thumbnail":"","structure_prompt":"tilt-shift photography, miniature effect, selective focus, toy-like appearance, blurred edges","is_premium":false,"defaults":{"style":"tilt-shift photography"}},{"key":"style_21","name":"Studio Ghibli","category":"Xu hướng 2025","thumbnail":"","structure_prompt":"Studio Ghibli anime style, hand-painted backgrounds, warm pastoral scenes, Miyazaki inspired, whimsical magical atmosphere","is_premium":false,"defaults":{"style":"Studio Ghibli anime style"}},{"key":"style_22","name":"Action Figure Box","category":"Xu hướng 2025","thumbnail":"","structure_prompt":"action figure in blister packaging, toy product photography, detailed miniature figure, branded box design, collectible display","is_premium":false,"defaults":{"style":"action figure in blister packaging"}},{"key":"style_23","name":"POP Mart Blind Box","category":"Xu hướng 2025","thumbnail":"","structure_prompt":"POP Mart blind box figure, vinyl collectible toy, cute chibi character, glossy smooth surface, designer toy aesthetic","is_premium":false,"defaults":{"style":"POP Mart blind box figure"}},{"key":"style_24","name":"Chibi Kawaii","category":"Xu hướng 2025","thumbnail":"","structure_prompt":"chibi kawaii style, oversized head, small body, cute big eyes, pastel colors, adorable expression","is_premium":false,"defaults":{"style":"chibi kawaii style"}},{"key":"style_25","name":"AI Generated Portrait","category":"Xu hướng 2025","thumbnail":"","structure_prompt":"AI-enhanced portrait photography, flawless skin, perfect lighting, ultra-sharp 8K detail, professional headshot quality","is_premium":false,"defaults":{"style":"AI-enhanced portrait photography"}},{"key":"style_26","name":"Y2K Aesthetic","category":"Xu hướng 2025","thumbnail":"","structure_prompt":"Y2K aesthetic, early 2000s nostalgia, glossy metallic, bubble text, hot pink and chrome, futuristic retro","is_premium":false,"defaults":{"style":"Y2K aesthetic"}},{"key":"style_27","name":"Cottagecore","category":"Xu hướng 2025","thumbnail":"","structure_prompt":"cottagecore aesthetic, rural countryside, wildflowers, soft natural light, cozy pastoral, warm earthy tones","is_premium":false,"defaults":{"style":"cottagecore aesthetic"}},{"key":"style_28","name":"Dark Academia","category":"Xu hướng 2025","thumbnail":"","structure_prompt":"dark academia aesthetic, moody scholarly atmosphere, rich brown tones, vintage library setting, intellectual elegance","is_premium":false,"defaults":{"style":"dark academia aesthetic"}},{"key":"style_29","name":"Dopamine Decor","category":"Xu hướng 2025","thumbnail":"","structure_prompt":"dopamine decor style, bold vibrant maximalist colors, joyful clashing patterns, playful eclectic mix, happy aesthetic","is_premium":false,"defaults":{"style":"dopamine decor style"}},{"key":"style_30","name":"Aesthetic Collage","category":"Xu hướng 2025","thumbnail":"","structure_prompt":"aesthetic mood board collage, mixed media, torn paper edges, layered textures, Pinterest-style curated visual","is_premium":false,"defaults":{"style":"aesthetic mood board collage"}},{"key":"style_31","name":"Pixar 3D","category":"3D & Animation","thumbnail":"","structure_prompt":"Pixar 3D animation style, smooth plastic-like render, expressive characters, vibrant saturated colors, subsurface scattering","is_premium":false,"defaults":{"style":"Pixar 3D animation style"}},{"key":"style_32","name":"Claymorphism","category":"3D & Animation","thumbnail":"","structure_prompt":"claymorphism style, soft clay material render, rounded shapes, pastel matte colors, playful 3D depth, tactile appearance","is_premium":false,"defaults":{"style":"claymorphism style"}},{"key":"style_33","name":"Isometric 3D","category":"3D & Animation","thumbnail":"","structure_prompt":"isometric 3D illustration, 30-degree angle, clean vector style, miniature diorama, detailed micro world","is_premium":false,"defaults":{"style":"isometric 3D illustration"}},{"key":"style_34","name":"Low Poly","category":"3D & Animation","thumbnail":"","structure_prompt":"low poly 3D art, geometric faceted surfaces, triangulated mesh, flat shading, colorful polygonal style","is_premium":false,"defaults":{"style":"low poly 3D art"}},{"key":"style_35","name":"Voxel Art","category":"3D & Animation","thumbnail":"","structure_prompt":"voxel art style, 3D pixel blocks, Minecraft-like construction, cubic world building, colorful blocky aesthetic","is_premium":false,"defaults":{"style":"voxel art style"}},{"key":"style_36","name":"Glassmorphism","category":"3D & Animation","thumbnail":"","structure_prompt":"glassmorphism style, frosted glass transparency, soft blur background, subtle border light, floating glass panels","is_premium":false,"defaults":{"style":"glassmorphism style"}},{"key":"style_37","name":"Neon Wireframe","category":"3D & Animation","thumbnail":"","structure_prompt":"neon wireframe 3D, glowing edge lines, dark background, holographic display, Tron-inspired digital grid","is_premium":false,"defaults":{"style":"neon wireframe 3D"}},{"key":"style_38","name":"Fantasy","category":"Đặc biệt","thumbnail":"","structure_prompt":"fantasy art, magical atmosphere, ethereal lighting, mystical elements, enchanted world, epic composition","is_premium":false,"defaults":{"style":"fantasy art"}},{"key":"style_39","name":"Cyberpunk","category":"Đặc biệt","thumbnail":"","structure_prompt":"cyberpunk aesthetic, neon lights, futuristic dystopia, dark sci-fi atmosphere, rain-soaked streets, holographic signs","is_premium":false,"defaults":{"style":"cyberpunk aesthetic"}},{"key":"style_40","name":"Steampunk","category":"Đặc biệt","thumbnail":"","structure_prompt":"steampunk aesthetic, Victorian era machinery, brass gears and copper pipes, steam-powered technology, industrial elegance","is_premium":false,"defaults":{"style":"steampunk aesthetic"}},{"key":"style_41","name":"Pixel Art","category":"Đặc biệt","thumbnail":"","structure_prompt":"pixel art style, 16-bit retro game graphics, dithering technique, limited color palette, nostalgic gaming aesthetic","is_premium":false,"defaults":{"style":"pixel art style"}},{"key":"style_42","name":"Comic Book","category":"Đặc biệt","thumbnail":"","structure_prompt":"comic book style, bold ink outlines, dynamic action poses, speech bubbles, Marvel/DC inspired illustration","is_premium":false,"defaults":{"style":"comic book style"}},{"key":"style_43","name":"Stained Glass","category":"Đặc biệt","thumbnail":"","structure_prompt":"stained glass art style, vibrant translucent segments, bold lead lines, cathedral window aesthetic, light filtering through","is_premium":false,"defaults":{"style":"stained glass art style"}},{"key":"style_44","name":"Paper Craft","category":"Đặc biệt","thumbnail":"","structure_prompt":"paper craft art, layered cut paper, 3D paper sculpture, kirigami depth, handmade cardstock texture, shadow layers","is_premium":false,"defaults":{"style":"paper craft art"}},{"key":"style_45","name":"Embroidery","category":"Đặc biệt","thumbnail":"","structure_prompt":"embroidery art style, cross-stitch pattern, thread texture, fabric canvas, handmade needlework, textile art","is_premium":false,"defaults":{"style":"embroidery art style"}},{"key":"style_46","name":"Double Exposure","category":"Đặc biệt","thumbnail":"","structure_prompt":"double exposure photography, two overlapping images blended, silhouette filled with landscape, artistic photo manipulation","is_premium":false,"defaults":{"style":"double exposure photography"}},{"key":"style_47","name":"Surrealist","category":"Đặc biệt","thumbnail":"","structure_prompt":"surrealist art, Salvador Dali inspired, dreamlike impossible scenes, melting forms, subconscious imagery, bizarre juxtaposition","is_premium":false,"defaults":{"style":"surrealist art"}},{"key":"style_48","name":"Psychedelic","category":"Đặc biệt","thumbnail":"","structure_prompt":"psychedelic art, vibrant swirling colors, fractal patterns, kaleidoscopic imagery, trippy visual distortion, 1960s poster style","is_premium":false,"defaults":{"style":"psychedelic art"}},{"key":"style_49","name":"Botanical Illustration","category":"Đặc biệt","thumbnail":"","structure_prompt":"botanical scientific illustration, detailed plant anatomy, vintage herbarium style, fine line work, natural history plate","is_premium":false,"defaults":{"style":"botanical scientific illustration"}},{"key":"style_50","name":"Graffiti Street Art","category":"Đặc biệt","thumbnail":"","structure_prompt":"graffiti street art, spray paint texture, urban wall mural, bold tag lettering, Banksy inspired, stencil technique","is_premium":false,"defaults":{"style":"graffiti street art"}},{"key":"style_51","name":"Retro Futurism","category":"Đặc biệt","thumbnail":"","structure_prompt":"retro futurism, 1950s vision of the future, chrome and atomic age design, space age optimism, Syd Mead inspired","is_premium":false,"defaults":{"style":"retro futurism"}},{"key":"style_52","name":"Noir Detective","category":"Đặc biệt","thumbnail":"","structure_prompt":"film noir detective style, high contrast black and white, dramatic venetian blind shadows, 1940s mystery atmosphere","is_premium":false,"defaults":{"style":"film noir detective style"}},{"key":"style_53","name":"Baroque","category":"Đặc biệt","thumbnail":"","structure_prompt":"baroque art style, ornate dramatic composition, rich golden details, Caravaggio chiaroscuro lighting, opulent grandeur","is_premium":false,"defaults":{"style":"baroque art style"}}];
let _paFormatsCache = null;
let _paFormatsAt = 0;
async function _paGetFormats() {
  const now = Date.now();
  // LOCAL mode: dùng formats đóng gói (không fetch server).
  try { var _lm = await new Promise(r => chrome.storage.local.get(['SEOSONA_LOCAL_MODE'], x => r(x.SEOSONA_LOCAL_MODE))); if (_lm !== false) { _paFormatsCache = _PA_LOCAL_FORMATS; _paFormatsAt = now; return _paFormatsCache; } } catch (_) { /* owned suppression (P4.T7): silent by design */ }
  if (_paFormatsCache && (now - _paFormatsAt) < 60 * 1000) return _paFormatsCache;
  try {
    // Gửi token user (nếu login) để server enforce premium: format premium mà user không có quyền
    // → server ẩn structure_prompt. Anonymous → không token → server ẩn structure_prompt mọi format premium.
    let _paAuthToken = null;
    try { const a = await new Promise(r => chrome.storage.local.get(['af_auth'], x => r(x.af_auth || {}))); _paAuthToken = a.token || null; } catch (_) { /* owned suppression (P4.T7): silent by design */ }
    const resp = await _signedFetch(`${getApiBaseUrl()}/pa-content-formats`, {
      method: 'GET',
      headers: {
        'X-Extension-Id': chrome.runtime.id, 'Accept': 'application/json',
        ...(_paAuthToken ? { 'Authorization': `Bearer ${_paAuthToken}` } : {}),
      },
    });
    const json = await resp.json();
    const list = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
    _paFormatsCache = list;
    _paFormatsAt = now;
  } catch (e) {
    console.warn('[PA] getFormats fail:', e.message);
    if (!_paFormatsCache) _paFormatsCache = [];
  }
  return _paFormatsCache;
}

// Context menu khớp phạm vi i2p-content.js (mọi trang http/https — parity với PromptCard).
// documentUrlPatterns dùng http/https để không hiện ở chrome://, file:// (nơi content script không chạy).
const I2P_SITE_PATTERNS = self.SEOSONA_ContextMenuModel?.SITE_PATTERNS || ['http://*/*', 'https://*/*'];
// Title menu theo ngôn ngữ user (af_locale). Fallback vi.
// Trên ẢNH: submenu ngắn 'SEOSONA Flow' chứa cả 2 action (discoverable, tránh tên dài manifest.name).
// Vùng trống/text: chỉ 'Chọn vùng' → 1 item → top-level KHÔNG submenu (icon extension tự hiện).
// → Region is now a single child under the SEOSONA Flow parent to avoid duplicate right-click actions.
const I2P_PARENT_ID = self.SEOSONA_ContextMenuModel?.IDS?.PARENT_ID || 'seosonaflow-i2p-parent';
const I2P_UPLOAD_PAGE_ID = self.SEOSONA_ContextMenuModel?.IDS?.UPLOAD_ID || 'seosonaflow-i2p-upload-page';
const I2P_UPLOAD_TITLES = {
  vi: 'Tải ảnh từ máy → Prompt',
  en: 'Upload image → Prompt',
};
const I2P_MENU_TITLES = {
  vi: 'Phân tích ảnh → Prompt',
  en: 'Analyze image → Prompt',


};
const I2P_REGION_TITLES = {
  vi: 'Chọn vùng → Prompt',
  en: 'Select area → Prompt',


};
// Parent menu LUÔN là tên ngắn cố định "SEOSONA Flow" (hợp đồng có test:
// tests/unit/context-menu-model.test.mjs). KHÔNG đổi theo app_name/locale.
function _i2pParentTitle() { return self.SEOSONA_ContextMenuModel?.parentTitle?.() || 'SEOSONA Flow'; }
function _i2pMenuTitle(locale) { return I2P_MENU_TITLES[locale] || I2P_MENU_TITLES.vi; }
function _i2pRegionTitle(locale) { return I2P_REGION_TITLES[locale] || I2P_REGION_TITLES.vi; }
function _i2pUploadTitle(locale) { return I2P_UPLOAD_TITLES[locale] || I2P_UPLOAD_TITLES.vi; }
// 1.1.47 port: gửi ảnh (đã capture/chọn) sang tab Gen dạng ref-image upload local (lazy).
const I2P_SEND_GEN_MENU_ID = self.SEOSONA_ContextMenuModel?.IDS?.SEND_GEN_ID || 'seosonaflow-i2p-send-gen';
const I2P_SEND_GEN_TITLES = {
  vi: 'Gửi ảnh → Tạo (ảnh tham chiếu)',
  en: 'Send image → Generate (reference)',
};
function _i2pSendGenTitle(locale) { return I2P_SEND_GEN_TITLES[locale] || I2P_SEND_GEN_TITLES.vi; }
function _i2pSetupContextMenu() {
  if (!chrome.contextMenus) return;
  chrome.storage.local.get(['af_locale'], (r) => {
    const loc = r?.af_locale;
    try {
      chrome.contextMenus.removeAll(() => {
        const model = self.SEOSONA_ContextMenuModel;
        // [fix] fallback: upload thêm 'image' → 5 mục hiện đủ trên ẢNH kể cả khi model chưa load.
        const items = model?.buildItems ? model.buildItems(loc) : [
          { id: I2P_PARENT_ID, title: _i2pParentTitle(), contexts: ['page', 'frame', 'selection', 'link', 'image'], documentUrlPatterns: I2P_SITE_PATTERNS },
          { id: I2P_CONTEXT_MENU_ID, parentId: I2P_PARENT_ID, title: _i2pMenuTitle(loc), contexts: ['image'], documentUrlPatterns: I2P_SITE_PATTERNS },
          { id: I2P_REGION_MENU_ID, parentId: I2P_PARENT_ID, title: _i2pRegionTitle(loc), contexts: ['page', 'frame', 'selection', 'link', 'image'], documentUrlPatterns: I2P_SITE_PATTERNS },
          { id: I2P_SEND_GEN_MENU_ID, parentId: I2P_PARENT_ID, title: _i2pSendGenTitle(loc), contexts: ['image'], documentUrlPatterns: I2P_SITE_PATTERNS },
          { id: I2P_UPLOAD_PAGE_ID, parentId: I2P_PARENT_ID, title: _i2pUploadTitle(loc), contexts: ['page', 'frame', 'selection', 'link', 'image'], documentUrlPatterns: I2P_SITE_PATTERNS },
        ];
        items.forEach((item) => {
          const createInfo = { ...item };
          delete createInfo.format;
          delete createInfo.mimeType;
          chrome.contextMenus.create(createInfo, () => void chrome.runtime.lastError);
        });
        // Create a single short parent menu with deduplicated children for image, region, upload and save-as actions.
      });
    } catch (e) { console.warn('[I2P] setupContextMenu fail:', e.message); }
  });
}
// Đổi ngôn ngữ (af_locale) → dựng lại menu để đổi nhãn các mục con (title parent giữ nguyên).
if (chrome.contextMenus && chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.af_locale) {
      _i2pSetupContextMenu();
    }
  });
}

if (chrome.contextMenus) {
  // [fix #3] Trang đăng nhập/thanh toán — KHÔNG inject/xử lý (khớp exclude_matches của i2p-content
  // static; executeScript activeTab bỏ qua exclude_matches nên phải chặn tường minh ở đây).
  const I2P_BLOCKED_HOST = /(^|\.)(accounts\.google\.com|oauth\.googleusercontent\.com|stripe\.com|checkout\.link\.com|lemonsqueezy\.com|paypal\.com|polar\.sh|sepay\.vn)$/i;
  function _i2pIsBlockedUrl(url) {
    try { return I2P_BLOCKED_HOST.test(new URL(url).hostname); } catch (_) { return false; }
  }
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const isAnalyze = info.menuItemId === I2P_CONTEXT_MENU_ID;
    const isRegion = info.menuItemId === I2P_REGION_MENU_ID;
    const isUpload = info.menuItemId === I2P_UPLOAD_PAGE_ID;
    const isSendGen = info.menuItemId === I2P_SEND_GEN_MENU_ID;
    const saveFormat = self.SEOSONA_ContextMenuModel?.formatFromMenuId?.(info.menuItemId) || null;
    if (!isAnalyze && !isRegion && !isUpload && !isSendGen && !saveFormat) return;
    // [AUDIT-1] Chặn trang nhạy cảm SỚM NHẤT — trước cả nhánh save. Trước đây guard nằm sau nhánh
    // save nên "Lưu ảnh" vẫn executeScript (chèn mã) vào trang đăng nhập/thanh toán.
    if (tab?.url && _i2pIsBlockedUrl(tab.url)) {
      _i2pNotify('SEOSONA Flow', 'Không dùng trên trang đăng nhập/thanh toán (bảo vệ dữ liệu).');
      return;
    }
    // [fix #4] Lưu ảnh CHỈ cần srcUrl — KHÔNG cần tab.id.
    if (saveFormat) {
      // [U5] URL ảnh GỐC. info.srcUrl có (image context) → resolve best; THIẾU (link/overlay context,
      // Pinterest grid) → hỏi ảnh tại con trỏ. _saveImageAsFormat có fallback tải trực tiếp (bỏ qua CORS).
      // Ưu tiên executeScript (tiêm tươi — miễn nhiễm content script stale): srcUrl (image ctx) hoặc
      // tìm <img> trong <a href=linkUrl> (link/overlay ctx). Rỗng → thử ảnh-tại-con-trỏ (content script).
      let _saveUrl = await _i2pBestUrl(tab?.id, info.srcUrl, info.linkUrl);
      if (!_saveUrl) _saveUrl = await _i2pCtxImageUrl(tab?.id);
      if (!_saveUrl) { _i2pNotify('SEOSONA Flow', 'Không tìm thấy ảnh ở vị trí chuột phải. Tải lại trang (F5) rồi thử lại.'); return; }
      try { await _saveImageAsFormat(_saveUrl, saveFormat); }
      catch (e) { _i2pNotify('SEOSONA Flow', `Không lưu được ảnh: ${e?.message || e}`); }
      return;
    }
    if (!tab?.id) return;
    // 1.1.47 port: gửi ảnh sang tab Gen dạng upload local (lazy). KHÔNG cần inject i2p-content.
    if (isSendGen) {
      // [AUDIT-2] THỨ TỰ USER-GESTURE (bug tôi gây ở vòng U5): sidePanel.open + permissions.request
      // CHỈ dùng được gesture của cú click menu, mất ngay sau await ĐẦU TIÊN. Trước fix, resolve URL
      // (executeScript) chạy trước → panel không mở + hộp xin quyền không hiện.
      // Nay: mở panel TRƯỚC (await đầu), rồi xin quyền theo origin lấy SYNC từ info, rồi mới resolve URL.
      try { if (chrome.sidePanel?.open) await chrome.sidePanel.open({ tabId: tab.id }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
      await _i2pEnsureHostPermission(info.srcUrl || info.linkUrl || ''); // best-effort
      // [U5] URL ảnh gốc: image context → best; link/overlay context → tìm <img> trong <a>.
      let _genUrl = await _i2pBestUrl(tab.id, info.srcUrl, info.linkUrl);
      if (!_genUrl) _genUrl = await _i2pCtxImageUrl(tab.id);
      if (!_genUrl) { _i2pNotify('SEOSONA Flow', 'Không tìm thấy ảnh ở vị trí chuột phải. Tải lại trang (F5) rồi thử lại.'); return; }
      // Ảnh gốc có thể khác origin với ảnh hiển thị (vd Google Images → site nguồn) → xin thêm.
      if (_genUrl !== (info.srcUrl || '')) await _i2pEnsureHostPermission(_genUrl);
      await _sendImageToGenTab(_genUrl);
      return;
    }
    // Inject on-demand (tab mở trước reload extension chưa có i2p-content.js).
    // [fix #6] Inject fail (chrome://, web store, PDF, CSP...) → BÁO thay vì im lặng.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content_scripts/i2p-content.js'] });
    } catch (e) {
      console.warn('[I2P] inject i2p-content failed:', e.message);
      _i2pNotify('SEOSONA Flow', 'Không dùng được trên trang này (trình duyệt chặn chèn mã).');
      return;
    }
    // Analyze ở link/overlay context (thiếu info.srcUrl) → resolve ảnh trong <a> để card có ảnh.
    let _anaUrl = info.srcUrl;
    if (isAnalyze && !_anaUrl) _anaUrl = await _i2pBestUrl(tab.id, '', info.linkUrl);
    const msg = isUpload ? { action: 'i2p:uploadMode' }
      : isRegion ? { action: 'i2p:regionMode' }
        : { action: 'i2p:showCard', srcUrl: _anaUrl };
    chrome.tabs.sendMessage(tab.id, msg, () => void chrome.runtime.lastError);
  });
}

// ===== [Results] Ghi kết quả mỗi lần chạy workflow vào WorkflowResultsStore =====
// Map wfId → runId lưu ở storage.session để sống qua service-worker restart (SW MV3 hay bị kill).
// MỌI lời gọi best-effort: hỏng thì log, TUYỆT ĐỐI không ném ra ngoài (không được phá luồng chạy).
const _WF_RUNMAP_KEY = '_wfResultsRunMap';

async function _wfRunMapGet() {
  try {
    const r = await chrome.storage.session.get([_WF_RUNMAP_KEY]);
    return (r && r[_WF_RUNMAP_KEY]) || {};
  } catch (e) { console.warn('[WorkflowResults] đọc run-map lỗi:', e?.message); return {}; }
}
async function _wfRunMapSet(map) {
  try { await chrome.storage.session.set({ [_WF_RUNMAP_KEY]: map }); }
  catch (e) { console.warn('[WorkflowResults] lưu run-map lỗi:', e?.message); }
}

function _wfResultsRecord(message) {
  const R = self.SEOSONA_WorkflowResultsStore;
  if (!R || typeof R.createRun !== 'function') return;          // module chưa nạp → bỏ qua
  const ev = message?.event;
  const data = message?.data || {};
  const wfId = data.wfId || data.wf_id || null;
  if (!wfId) return;                                            // không xác định được run → bỏ qua

  (async () => {
    const map = await _wfRunMapGet();

    if (ev === 'execution:started') {
      const res = await R.createRun({
        workflowId: String(wfId),
        workflowName: data.wfName || data.wf_name || '',
        status: 'running',
      });
      if (res?.ok) { map[String(wfId)] = res.run.id; await _wfRunMapSet(map); }
      return;
    }

    const runId = map[String(wfId)];
    if (!runId) return;                                         // chưa có run (SW restart giữa chừng)

    if (ev === 'node:completed' || ev === 'node:failed') {
      const n = data.node || {};
      const r = data.result || {};
      const files = Array.isArray(r.fileIds) ? r.fileIds : String(r.fileIds || '').split(',').filter(Boolean);
      await R.appendRows(runId, [{
        node_id: n.node_id || '',
        node: n.node_name || '',
        status: ev === 'node:completed' ? 'completed' : 'failed',
        files: files.length,
        file_ids: files.join(' '),
        duration_ms: Number(r.duration) || 0,
        error: ev === 'node:failed' ? String(data.error || r.error || '') : '',
        at: new Date().toISOString(),
      }]);
      return;
    }

    if (ev === 'execution:completed' || ev === 'execution:failed') {
      await R.setStatus(runId, ev === 'execution:completed' ? 'completed' : 'failed');
      delete map[String(wfId)];
      await _wfRunMapSet(map);
    }
  })().catch((e) => console.warn('[WorkflowResults] ghi run lỗi:', e?.message));
}

// ===== 1.1.47 port: ảnh local → tab Gen (ref-image upload lazy) =====
// Fetch ảnh (host <all_urls> bỏ qua CORS) → base64. Giữ PNG (alpha) nếu gốc PNG, else JPEG.
// Downscale cạnh dài về maxPx cho ref gen (upload local nhẹ hơn, message không quá lớn).
function _i2pNotify(title, message) {
  try {
    chrome.notifications?.create({
      type: 'basic',
      iconUrl: 'icons/icon-128.png',
      title: String(title || 'SEOSONA Flow'),
      message: String(message || ''),
    });
  } catch (_) { /* optional notification */ }
}

async function _i2pBlobToDataUrl(blob) {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(bin)}`;
}

async function _i2pConvertImageBlob(blob, mimeType) {
  const bmp = await createImageBitmap(blob);
  const oc = new OffscreenCanvas(Math.max(1, bmp.width), Math.max(1, bmp.height));
  const ctx = oc.getContext('2d');
  if (mimeType === 'image/jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, oc.width, oc.height);
  }
  ctx.drawImage(bmp, 0, 0);
  const opts = { type: mimeType };
  if (mimeType !== 'image/png') opts.quality = 0.92;
  return await oc.convertToBlob(opts);
}

// Đăng ký pending-rename để onDeterminingFilename (dòng 796) suggest ĐÚNG tên — cần vì
// chrome.downloads.download BỎ QUA `filename` khi url là data:/blob: → nếu không, Chrome đặt
// tên mặc định "tải xuống". Dùng chung cơ chế với chromeDownload (dòng 3793).
// urlPrefix: tiền tố URL của chính download này (vd 'data:image/png') → listener khớp ĐÚNG entry,
// không tráo tên với download workflow đang pending. TTL ngắn (30s) vì save-as tải ngay lập tức.
function _i2pQueueRename(filename, urlPrefix) {
  try {
    if (!filename || filename.indexOf('/') === -1) return;
    const i = filename.lastIndexOf('/');
    const folder = _sanitizePathSegment(filename.substring(0, i));
    const justFile = _sanitizePathSegment(filename.substring(i + 1)) || 'image';
    _pendingDownloadRenames.push({
      folder, filename: justFile, identifier: justFile,
      urlPrefix: urlPrefix || 'data:', expires: Date.now() + 30000,
    });
    _persistPendingRenames();
  } catch (_) { /* rename optional */ }
}

async function _saveImageAsFormat(srcUrl, formatInfo) {
  if (!srcUrl) throw new Error('missing image URL');
  if (!_isAllowedUrl(srcUrl)) throw new Error('URL not allowed');
  const format = formatInfo?.format || 'png';
  try {
    // Đường CHÍNH: fetch → chuyển định dạng (PNG/JPEG/WEBP) qua canvas.
    const resp = await fetch(srcUrl);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const sourceBlob = await resp.blob();
    const outputBlob = await _i2pConvertImageBlob(sourceBlob, formatInfo?.mimeType || 'image/png');
    const dataUrl = await _i2pBlobToDataUrl(outputBlob);
    const filename = self.SEOSONA_ContextMenuModel?.downloadFilename?.(srcUrl, format) || `SEOSONA Flow/image.${format}`;
    // data URL → phải queue rename để giữ tên (không thì "tải xuống"); gắn urlPrefix theo ĐÚNG mime
    // của blob vừa tạo để listener khớp chính xác entry này.
    _i2pQueueRename(filename, 'data:' + (outputBlob.type || formatInfo?.mimeType || 'image/png'));
    await chrome.downloads.download({ url: dataUrl, filename, conflictAction: 'uniquify', saveAs: false });
  } catch (e) {
    // FALLBACK: ảnh third-party (Pinterest...) không có host-permission → fetch CORS chặn. Tải TRỰC TIẾP
    // URL gốc qua downloads API — browser tự tải bằng context trang, KHÔNG bị CORS → LUÔN được (giữ
    // định dạng gốc). Vẫn đúng kích thước gốc (bestUrl đã resolve trước đó).
    console.log('[I2P] save convert fail → direct download:', e?.message);
    const m = /\.(jpe?g|png|webp|gif|avif|bmp)(\?|#|$)/i.exec(srcUrl);
    const ext = m ? m[1].toLowerCase().replace('jpeg', 'jpg') : format;
    const base = (self.SEOSONA_ContextMenuModel?.baseNameFromUrl?.(srcUrl) || 'image');
    const fn = `SEOSONA Flow/${base}.${ext}`;
    // [AUDIT-3] KHÔNG queue rename ở nhánh này: url là http(s) nên Chrome tôn trọng `filename` trực
    // tiếp. Queue là hàng đợi DÙNG CHUNG (3 nơi push) mà listener lấy phần tử index 0 khi URL không
    // chứa uuid → queue thừa có thể bị download khác "ăn" mất → đặt sai tên cho cả hai.
    await chrome.downloads.download({ url: srcUrl, filename: fn, conflictAction: 'uniquify', saveAs: false });
  }
}

async function _fetchImageAsBase64(srcUrl, maxPx, quality) {
  try {
    const resp = await fetch(srcUrl);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const srcType = blob.type || '';
    const isPng = srcType.includes('png');
    let outBlob = blob;
    try {
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
      if (scale < 1) {
        const cw = Math.max(1, Math.round(bmp.width * scale));
        const ch = Math.max(1, Math.round(bmp.height * scale));
        const oc = new OffscreenCanvas(cw, ch);
        const ctx = oc.getContext('2d');
        if (!isPng) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, ch); } // JPEG không alpha → nền trắng
        ctx.drawImage(bmp, 0, 0, cw, ch);
        outBlob = isPng ? await oc.convertToBlob({ type: 'image/png' })
                        : await oc.convertToBlob({ type: 'image/jpeg', quality: quality || 0.92 });
      }
    } catch (_) { /* downscale fail → dùng blob gốc */ }
    const buf = await outBlob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    const type = outBlob.type || (isPng ? 'image/png' : 'image/jpeg');
    const ext = type.includes('png') ? 'png' : (type.includes('webp') ? 'webp' : 'jpg');
    return { base64: btoa(bin), name: `gen_ref_${Date.now()}.${ext}`, type };
  } catch (_) { return null; }
}

// Đưa ảnh (base64 sẵn) vào GenTab. LƯU pending TRƯỚC (nguồn sự thật duy nhất) rồi signal sidebar drain
// → tránh race: khi click mở side panel, init-drain của sidebar có thể chạy trước lúc pending kịp lưu.
async function _dispatchLocalImageToGen(img) {
  if (!img?.base64) return;
  try {
    let pendingItem = { base64: img.base64, name: img.name, type: img.type, addedAt: Date.now() };
    try {
      const S = self.SEOSONA_SourceImportStaging;
      if (S && typeof S.createImagePackage === 'function') {
        const result = await S.createImagePackage({
          base64: img.base64,
          mimeType: img.type || 'image/jpeg',
          name: img.name,
        }, {
          inlineLimitChars: 256 * 1024,
          ttlMs: 60 * 60 * 1000,
        });
        if (result && result.ok && result.package) {
          const pkg = result.package;
          pendingItem = {
            base64: pkg.embeddedImage ? pkg.embeddedImage.base64 : null,
            name: pkg.name || img.name,
            type: pkg.mimeType || img.type,
            stagingRef: pkg.stagingRef || null,
            sourceImport: pkg,
            addedAt: Date.now(),
          };
        }
      }
    } catch (_) { /* fallback to inline local image */ }
    const st = await chrome.storage.local.get(['_pendingLocalToGenTab']);
    const pend = st._pendingLocalToGenTab || [];
    pend.push(pendingItem);
    // [U4] Cap 5→20 (gửi nhiều ảnh liên tiếp trước khi sidebar drain không mất). Cảnh báo khi rớt.
    let _dropped = 0;
    while (pend.length > 20) { pend.shift(); _dropped++; }
    if (_dropped > 0) _i2pNotify('SEOSONA Flow', `Hàng đợi ảnh đầy — bỏ ${_dropped} ảnh cũ nhất. Mở side panel để ảnh được nạp bớt.`);
    await chrome.storage.local.set({ _pendingLocalToGenTab: pend });
  } catch (_) { /* owned suppression (P4.T7): silent by design */ }
  // Signal sidebar drain (nếu đang mở → xử lý ngay). Sidebar đóng → init-drain xử lý khi mở.
  try { chrome.runtime.sendMessage({ action: 'drainLocalToGenTab' }, () => void chrome.runtime.lastError); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
}

// [U1] Xin quyền host cho ảnh third-party (Pinterest/blog/CDN bất kỳ) → BG fetch được ảnh mà
// không bị CORS. Với ảnh trên origin đã cấp sẵn (labs.google/chatgpt/...) → contains()=true, KHÔNG
// hiện dialog. Chỉ xin ĐÚNG origin của ảnh (không phải <all_urls>) → ít đáng sợ. PHẢI gọi trong
// user-gesture của context-menu click (đặt là await đầu tiên của nhánh).
async function _i2pEnsureHostPermission(srcUrl) {
  let origin;
  try {
    const u = new URL(srcUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true; // data:/blob: không cần quyền
    origin = u.origin + '/*';
  } catch (_) { return true; } // URL lạ → để bước sau tự xử lý
  try {
    if (!chrome.permissions) return true;
    // Gọi request TRỰC TIẾP (KHÔNG await contains trước) → giữ user-gesture (contains làm mất gesture →
    // request throw). Đã có quyền → request resolve true ngay, KHÔNG hiện dialog.
    return await chrome.permissions.request({ origins: [origin] });
  } catch (_) { return false; }
}

// [U5] Hỏi content script URL ảnh GỐC (độ phân giải cao nhất) cho tab đang phải-chuột. Content script
// (i2p-content static) đọc <img> thật: <a> full / srcset lớn nhất / currentSrc thay vì src thu nhỏ.
// Tab không có content script (stale/excluded) → fallback srcUrl.
// [U5] Hàm TỰ CHỨA chạy TRONG TRANG (executeScript) → tìm URL ảnh gốc độ phân giải cao nhất.
// KHÔNG tham chiếu biến ngoài (bị serialize). Trả Promise → executeScript đợi resolve.
function _pageResolveBestUrl(srcUrl, linkUrl) {
  // Suy URL bản GỐC từ URL thumbnail theo mẫu CDN phổ biến. Đoán sai → probe loại (404/0px) nên
  // thêm mẫu là an toàn. Trả MẢNG biến thể (1 URL có thể suy ra nhiều ứng viên).
  function dethumbAll(u) {
    var out = [], s0 = String(u || '');
    var push = function (x) { if (x && x !== s0 && out.indexOf(x) === -1) out.push(x); };
    try {
      // Chung: bỏ tham số size (?w=&h=&fit=), WordPress name-300x200.jpg → name.jpg
      var g = s0.replace(/([?&])(?:w|width|h|height|size|resize|fit|quality)=[^&]*/gi, '$1')
                .replace(/[?&]+$/, '').replace(/([?&])&+/g, '$1');
      push(g);
      push(s0.replace(/-\d{2,4}x\d{2,4}(\.[a-z0-9]{2,5})(\?|#|$)/i, '$1$2'));
      // Pinterest: /236x/ /564x/ /736x/ → /originals/
      push(s0.replace(/\/(?:\d{2,4}x\d{0,4})\//, '/originals/'));
      // Google-hosted: =w1438-h810 | =s220-c → =s0
      if (/(googleusercontent|ggpht|bp\.blogspot|blogger|gstatic)\.com/i.test(s0)) push(s0.replace(/=[swh]\d+[^/?#]*$/i, '=s0'));
      // MediaWiki/Wikipedia: /thumb/a/ab/File.jpg/220px-File.jpg → /a/ab/File.jpg
      push(s0.replace(/\/thumb\/(.+?\.(?:jpe?g|png|gif|webp|svg))\/[^/]+$/i, '/$1'));
      // Twitter/X: ?format=jpg&name=small|medium|large → name=orig
      if (/(twimg\.com)/i.test(s0)) push(s0.replace(/([?&]name=)[^&]+/i, '$1orig'));
      // Shopify/e-com: file_400x400.jpg | file_400x.jpg → file.jpg
      push(s0.replace(/_\d{2,4}x(?:\d{2,4})?(\.[a-z0-9]{2,5})(\?|#|$)/i, '$1$2'));
      // Tumblr: _250.jpg / _500.jpg → _1280.jpg
      if (/tumblr\.com/i.test(s0)) push(s0.replace(/_(?:75|100|250|400|500|540|640)(\.[a-z0-9]{2,5})(\?|#|$)/i, '_1280$1$2'));
      // Reddit: preview.redd.it (bản resize) → i.redd.it (GỐC). URL mới có slug tiêu đề phía trước
      // id: /hubby-...-v0-m1c0229qq7gh1.jpeg → gốc chỉ là /m1c0229qq7gh1.jpeg → tách id.
      if (/(?:external-)?preview\.redd\.it/i.test(s0)) {
        var rd = s0.replace(/\?.*$/, '').replace(/(^https?:\/\/)(?:external-)?preview\.redd\.it/i, '$1i.redd.it');
        push(rd);
        push(rd.replace(/\/[^/]*?-([a-z0-9]{8,})(\.[a-z0-9]{2,5})$/i, '/$1$2'));
      }
      // Thư mục thumb → bản lớn (nhiều CMS/gallery)
      push(s0.replace(/\/(?:thumbs?|thumbnails?|small|medium|resized|cache)\//i, '/'));
      // Facebook / Instagram CDN: size nằm ở token cắt (stp=dst-jpg_s600x600, ctp=s1447x2048).
      // Thử (a) nâng token lên 2048, (b) bỏ hẳn stp/cstp/ctp. URL fbcdn có CHỮ KÝ oh=/oe= nên
      // biến thể có thể 403 → probe tự loại, không hại.
      if (/(fbcdn\.net|cdninstagram\.com)/i.test(s0)) {
        push(s0.replace(/([sp])\d{2,4}x\d{2,4}/g, '$12048x2048'));
        push(s0.replace(/([?&])(?:stp|cstp|ctp)=[^&]*/gi, '$1').replace(/[?&]+$/, '').replace(/([?&])&+/g, '$1'));
      }
    } catch (_) { /* giữ những gì gom được */ }
    return out;
  }
  // Trích URL ảnh GỐC nhúng trong link trung gian của công cụ tìm ảnh:
  // Google Images  /imgres?imgurl=<GỐC>&imgrefurl=<trang>   → param imgurl
  // Bing Images    /images/search?mediaurl=<GỐC>            → mediaurl/murl
  // → thumbnail chỉ là proxy nhỏ (encrypted-tbn/gstatic), URL gốc nằm ở đây.
  function fromRedirect(u) {
    var out = [];
    try {
      var q = new URL(u, location.href);
      ['imgurl', 'mediaurl', 'murl', 'image_url', 'img_url', 'imageurl', 'image', 'img', 'src', 'url', 'u'].forEach(function (k) {
        var v = q.searchParams.get(k);
        if (v && /^https?:/i.test(v)) out.push(v);
      });
    } catch (_) { /* URL lạ */ }
    return out;
  }
  function srcsetLargest(ss) {
    var best = null, bs = -1;
    String(ss || '').split(',').forEach(function (p) {
      var seg = p.trim().split(/\s+/), url = seg[0]; if (!url) return;
      var sc = 1, d = seg[1] || '', mw = /^(\d+)w$/.exec(d), mx = /^([\d.]+)x$/.exec(d);
      if (mw) sc = parseInt(mw[1], 10); else if (mx) sc = parseFloat(mx[1]) * 100000;
      if (sc > bs) { bs = sc; best = url; }
    });
    return best;
  }
  function probe(url) {
    return new Promise(function (res) {
      var im = new Image(), done = false, f = function (w) { if (!done) { done = true; res({ url: url, w: w }); } };
      im.onload = function () { f(im.naturalWidth || 0); };
      im.onerror = function () { f(0); };
      try { im.src = url; } catch (_) { f(0); }
      setTimeout(function () { f(0); }, 4000);
    });
  }
  try {
    var img = srcUrl ? Array.prototype.find.call(document.images, function (i) { return i.currentSrc === srcUrl || i.src === srcUrl; }) : null;
    // LINK context (ảnh bị <a>/overlay che — Pinterest grid): Chrome không cấp srcUrl, chỉ linkUrl.
    // Tìm <a> đúng href → lấy <img> LỚN NHẤT bên trong; không có → leo lên cha/ông tìm img gần nhất.
    if (!img && linkUrl) {
      var anchors = Array.prototype.filter.call(document.querySelectorAll('a[href]'), function (a) { return a.href === linkUrl; });
      for (var ai = 0; ai < anchors.length && !img; ai++) {
        var scope = anchors[ai], hops = 0;
        while (scope && hops < 4) {
          var found = Array.prototype.slice.call(scope.querySelectorAll('img')).filter(function (im) { return im.currentSrc || im.src; });
          if (found.length) {
            found.sort(function (x, y) { return (y.naturalWidth * y.naturalHeight) - (x.naturalWidth * x.naturalHeight); });
            img = found[0]; break;
          }
          scope = scope.parentElement; hops++;
        }
      }
    }
    var cands = {}, add = function (u) {
      if (!u) return;
      try { u = new URL(u, location.href).href; } catch (_) { return; } // data-* thường là URL tương đối
      if (/^https?:/i.test(u)) cands[u] = 1;
    };
    if (img) {
      add(img.currentSrc); add(img.src); add(srcsetLargest(img.srcset));
      // Lazy-load / zoom-gallery: bản GỐC hay nằm ở data-* (lazysizes, WooCommerce, Shopify...).
      ['data-src', 'data-original', 'data-lazy', 'data-lazy-src', 'data-full', 'data-large',
        'data-large-file', 'data-hi-res', 'data-highres', 'data-zoom-image', 'data-image', 'data-url'
      ].forEach(function (k) { add(img.getAttribute(k)); });
      ['data-srcset', 'data-lazy-srcset'].forEach(function (k) { add(srcsetLargest(img.getAttribute(k))); });
      // <picture><source srcset> anh em → thường là bản lớn/định dạng tốt hơn.
      var pic = img.closest('picture');
      if (pic) Array.prototype.forEach.call(pic.querySelectorAll('source'), function (so) {
        add(srcsetLargest(so.getAttribute('srcset') || so.getAttribute('data-srcset')));
      });
      // <a> trỏ thẳng file ảnh (gallery thumb→full) hoặc data-* trên <a>.
      var a = img.closest('a[href]');
      if (a) {
        if (/\.(jpe?g|png|webp|gif|avif|bmp)(\?|#|$)/i.test(a.href)) add(a.href);
        ['data-full', 'data-large', 'data-image', 'data-zoom-image'].forEach(function (k) { add(a.getAttribute(k)); });
        fromRedirect(a.href).forEach(add);               // Google Images: /imgres?imgurl=<GỐC>
        var mAttr = a.getAttribute('m');                  // Bing Images: m='{"murl":"<GỐC>"}'
        if (mAttr) { try { var j = JSON.parse(mAttr); if (j && j.murl) add(j.murl); } catch (_) { /* attr 'm' của Bing không phải JSON hợp lệ → bỏ ứng viên này, các ứng viên khác vẫn chạy */ } }
      }
    }
    // Link context: URL gốc có thể nằm ngay trong linkUrl (imgres?imgurl=…) — không cần tìm <img>.
    if (linkUrl) fromRedirect(linkUrl).forEach(add);
    // Không có <img> (site dùng CSS background-image) → lấy từ anchor scope / phần tử liên quan.
    if (!img && linkUrl) {
      var scopes = Array.prototype.filter.call(document.querySelectorAll('a[href]'), function (x) { return x.href === linkUrl; });
      scopes.forEach(function (sc) {
        var nodes = [sc].concat(Array.prototype.slice.call(sc.querySelectorAll('*')));
        if (sc.parentElement) nodes = nodes.concat(Array.prototype.slice.call(sc.parentElement.querySelectorAll('*')));
        nodes.slice(0, 60).forEach(function (n) {
          var bg = '';
          try { bg = getComputedStyle(n).backgroundImage || ''; } catch (_) { /* node đã bị gỡ khỏi DOM giữa chừng → bỏ qua, quét tiếp node khác */ }
          var m = /url\(["']?(https?:[^"')]+)["']?\)/i.exec(bg);
          if (m) add(m[1]);
        });
      });
    }
    add(srcUrl);
    Object.keys(cands).forEach(function (u) { dethumbAll(u).forEach(add); });
    var list = Object.keys(cands).slice(0, 12);
    if (list.length === 0) return Promise.resolve('');
    if (list.length === 1) return Promise.resolve(list[0]);
    return Promise.all(list.map(probe)).then(function (sizes) {
      sizes.sort(function (a, b) { return b.w - a.w; });
      return (sizes[0] && sizes[0].w > 0) ? sizes[0].url : (srcUrl || list[0] || '');
    });
  } catch (_) { return srcUrl || ''; }
}

// Trả URL ảnh gốc. srcUrl (image context) HOẶC linkUrl (link/overlay context — tìm <img> trong <a>).
async function _i2pBestUrl(tabId, srcUrl, linkUrl) {
  if (!tabId) return srcUrl || '';
  try {
    // Tiêm hàm TƯƠI (không phụ thuộc content script cũ/stale) → chạy trong trang → trả URL gốc.
    const results = await chrome.scripting.executeScript({ target: { tabId }, func: _pageResolveBestUrl, args: [srcUrl || '', linkUrl || ''] });
    const url = results && results[0] && results[0].result;
    return (url && /^https?:/i.test(url)) ? url : (srcUrl || '');
  } catch (_) { return srcUrl || ''; }
}

// [U5] Ảnh TẠI con trỏ khi Chrome KHÔNG cấp info.srcUrl (link/overlay context — Pinterest grid).
// Hỏi content script (đã bắt _lastCtxImgUrl lúc contextmenu) → resolve bản gốc. Phụ thuộc content
// script sống (đã bắt cursor); stale → '' (báo lỗi ở caller). Inject lại trước để tăng độ chắc.
async function _i2pCtxImageUrl(tabId) {
  if (!tabId) return '';
  try {
    const r = await new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: 'i2p:getCtxImageUrl' }, (resp) => {
        if (chrome.runtime.lastError) resolve(null); else resolve(resp);
      });
    });
    const raw = (r && r.url) ? r.url : '';
    // Content script chỉ trả URL THÔ → resolve bản gốc tại đây (1 nguồn logic duy nhất).
    return raw ? await _i2pBestUrl(tabId, raw, '') : '';
  } catch (_) { return ''; }
}

// Fetch ảnh từ srcUrl → dispatch (dùng cho context menu, chưa có base64).
async function _sendImageToGenTab(srcUrl) {
  if (!srcUrl) return;
  // [U3] Phản hồi ngay: side panel vừa mở còn trống trong lúc fetch ảnh (1-3s) → báo "đang lấy".
  _i2pNotify('SEOSONA Flow', 'Đang lấy ảnh để đưa vào Tạo…');
  const img = await _fetchImageAsBase64(srcUrl, 2048, 0.92);
  // [fix #1 HIGH] Trước đây fetch fail (ảnh third-party CORS / URL chết) → return câm → side panel
  // mở nhưng KHÔNG có ảnh, user không biết vì sao. Giờ báo rõ.
  if (!img) {
    _i2pNotify('SEOSONA Flow', 'Không lấy được ảnh này (trang chặn CORS hoặc ảnh lỗi). Thử "Lưu ảnh" rồi kéo vào, hoặc chuột phải ảnh trên trang Flow/ChatGPT.');
    return;
  }
  await _dispatchLocalImageToGen(img);
}

// Đảm bảo có tab provider + ACTIVATE (Chrome throttle tab nền → không lấy được result response,
// cần active để DOM automation + đọc text chạy đủ). Restore focus tab user sau analyze (handler).
async function _i2pEnsureProviderTab(provider) {
  const cfg = PROVIDER_URLS[provider];
  if (!cfg) throw new Error('UNKNOWN_PROVIDER');
  const tabs = await chrome.tabs.query({ url: cfg.tabQuery });
  let tab = tabs && tabs.length ? (tabs.find(t => t.active) || tabs[0]) : null;
  let created = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: cfg.createUrl, active: true });
    created = true;
  } else {
    try { await chrome.tabs.update(tab.id, { active: true }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
    try { if (tab.windowId != null) await chrome.windows.update(tab.windowId, { focused: true }); } catch (_) { /* owned suppression (P4.T7): silent by design */ }
  }
  return { tabId: tab.id, created };
}

// Gửi i2p:analyze tới tab provider, retry vì content script có thể chưa inject (tab vừa tạo).
async function _i2pSendAnalyze(tabId, payload, created) {
  const maxTries = created ? 25 : 6; // tab mới: đợi load+inject lâu hơn
  for (let i = 0; i < maxTries; i++) {
    const r = await new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, payload, (resp) => {
          if (chrome.runtime.lastError) resolve({ __noReceiver: true });
          else resolve(resp);
        });
      } catch (_) { resolve({ __noReceiver: true }); }
    });
    if (r && !r.__noReceiver) return r;
    await new Promise(rr => setTimeout(rr, created ? 1200 : 600));
  }
  return { success: false, error: 'PROVIDER_NOT_READY' };
}

// =============================================================================
// === CONSOLIDATED STARTUP LISTENERS ===
// Gộp tất cả onInstalled/onStartup vào 1 nơi để đảm bảo thứ tự chạy đúng.
// Tránh race condition giữa cache clear và prefetch (trước đây là listeners riêng).
// =============================================================================

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Background] onInstalled:', details.reason);

  // Step 1: Clear auth rejection flag (cho fresh check sau reload)
  try {
    await new Promise(r => chrome.storage.local.remove('dummy_flag', r));
    chrome.runtime.sendMessage({ type: 'EXTENSION_AUTHORIZED' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('background#_i2pSendAnalyze', _e); });
    console.log('[Auth] 🔄 Extension reloaded — flag cleared, fresh check');
  } catch (_) { /* owned suppression (P4.T7): silent by design */ }

  // Step 2: Clear config cache CHỈ khi version THỰC SỰ đổi (install / update version khác).
  // 2026-05-28: reload extension (kể cả dev reload cùng version) fire reason='update' với
  // previousVersion === version hiện tại → KHÔNG clear (giữ cache warm → sidebar đọc config ngay,
  // không phải chờ re-fetch → loading nhanh). config_version polling/SSE vẫn refresh nếu server đổi.
  const _curVersion = chrome.runtime.getManifest().version;
  const _isRealUpdate = details.reason === 'update'
    && details.previousVersion && details.previousVersion !== _curVersion;
  if (details.reason === 'install' || _isRealUpdate) {
    await new Promise(r => chrome.storage.local.remove([
      'seosona_provider_models',
      'seosona_provider_api_configs',
      'seosona_provider_dom_selectors',
      _CONFIGS_READY_KEY, // Clear ready signal too
    ], r));
    console.log('[SEOSONA Flow] Cache cleared on', details.reason,
      details.previousVersion ? `(v${details.previousVersion} → v${_curVersion})` : '');
  } else {
    console.log('[SEOSONA Flow] Reload cùng version (v' + _curVersion + ') — GIỮ cache warm, prefetch refresh nền');
  }

  // Step 3: Prefetch fresh configs (SAU khi cache đã clear)
  await _prefetchAllConfigs();

  // Step 4: Ensure enrollment
  _ensureEnrollment().catch(function (_e) { globalThis.SEOSONA_swallow?.('background#_i2pSendAnalyze', _e); });

  // Step 5: Redirect to Flow on first install
  if (details.reason === 'install') {
    chrome.tabs.create({ url: PROVIDER_URLS.flow.localeCreate });
  }

  // Step 6: Auto-inject content scripts vào existing tabs
  if (typeof _autoInjectContentScripts === 'function') {
    _autoInjectContentScripts();
  }

  // Step 7: Image-to-Prompt context menu
  _i2pSetupContextMenu();
});

chrome.runtime.onStartup.addListener(async () => {
  console.log('[Background] onStartup');

  // Step 1: Prefetch configs (cache đã có từ trước, chỉ refresh nếu stale)
  await _prefetchAllConfigs();

  // Step 2: Self-heal probe
  _selfHealProbe();

  // Step 3: Ensure enrollment
  _ensureEnrollment().catch(function (_e) { globalThis.SEOSONA_swallow?.('background#_i2pSendAnalyze', _e); });

  // Step 4: Image-to-Prompt context menu (service worker restart cần tạo lại)
  _i2pSetupContextMenu();
});

// Message handler: sidebar request fetch if cache stale
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (_seosonaMessageGate(msg, sender, false, sendResponse)) return true;
  if (msg?.action === 'FETCH_CONFIGS_IF_NEEDED') {
    (async () => {
      try {
        // Check if already fetched recently
        const stored = await new Promise(r => chrome.storage.local.get([_CONFIGS_READY_KEY], r));
        const readyAt = stored?.[_CONFIGS_READY_KEY] || 0;
        if (Date.now() - readyAt < _CONFIGS_READY_TTL_MS) {
          sendResponse({ success: true, cached: true });
          return;
        }
        // Fetch and signal
        await _prefetchAllConfigs();
        sendResponse({ success: true, cached: false });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true; // async response
  }


  // ===========================================================================
  // Phase CG-8: Claude handlers
  // ===========================================================================

  if (msg.action === 'claude:findOrCreateTab') {
    const { createIfMissing = true, activate = true } = msg;
    (async () => {
      try {
        let currentWindowId = sender.tab?.windowId;
        if (!currentWindowId) {
          const focusedWindow = await chrome.windows.getCurrent();
          currentWindowId = focusedWindow?.id;
        }

        let tabs = await chrome.tabs.query({ url: PROVIDER_URLS.claude.tabQuery, windowId: currentWindowId });
        if (tabs.length === 0) {
          tabs = await chrome.tabs.query({ url: PROVIDER_URLS.claude.tabQuery });
        }

        let tabId;
        if (tabs.length > 0) {
          tabId = tabs[0].id;
        } else if (createIfMissing) {
          const tab = await chrome.tabs.create({
            url: PROVIDER_URLS.claude.createUrl,
            active: !!activate,
            windowId: currentWindowId,
          });
          tabId = tab.id;
          await new Promise((resolve) => {
            const timeout = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }, 15000);
            const listener = (updatedTabId, changeInfo) => {
              if (updatedTabId === tabId && changeInfo.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                resolve();
              }
            };
            chrome.tabs.onUpdated.addListener(listener);
          });
        } else {
          sendResponse({ success: false, error: 'NO_TAB' });
          return;
        }

        sendResponse({ success: true, tabId });
      } catch (err) {
        console.error('[SEOSONA Flow] claude:findOrCreateTab error:', err.message);
        sendResponse({ success: false, error: err.message || 'NO_TAB' });
      }
    })();
    return true;
  }

  if (msg.action === 'claude:ensureActive') {
    const tabId = msg.tabId || sender?.tab?.id;
    const focusWindow = msg.focusWindow === true;
    (async () => {
      try {
        if (!tabId) { sendResponse({ success: false, error: 'NO_TAB' }); return; }
        const tabInfo = await chrome.tabs.get(tabId);
        if (!tabInfo.active) {
          await chrome.tabs.update(tabId, { active: true });
          await new Promise(r => setTimeout(r, 300));
        }
        if (focusWindow && tabInfo.windowId) {
          try {
            await chrome.windows.update(tabInfo.windowId, { focused: true, drawAttention: true });
          } catch (winErr) {
            console.warn('[SEOSONA Flow] claude:ensureActive focusWindow failed:', winErr.message);
          }
        }
        sendResponse({ success: true, active: true });
      } catch (err) {
        console.error('[SEOSONA Flow] claude:ensureActive error:', err.message);
        sendResponse({ success: false, error: err.message || 'ACTIVATE_FAILED' });
      }
    })();
    return true;
  }


  if (msg.action === 'claude:injectScript') {
    // Stub for Claude
    sendResponse({ success: true, alreadyLoaded: true });
    return true;
  }

  if (msg.action === 'claude:checkLogin') {
    // [FIX 2026-07-09] Thiếu `success:true` → ClaudeSession.ensureReady gate `!loginResp.success`
    // luôn fail → Claude Prompt node KHÔNG BAO GIỜ chạy (Claude default sonnet-5). Mirror gemini/chatgpt.
    sendResponse({ success: true, ready: true });
    return true;
  }

  // [FIX 2026-07-09] Thiếu handler → ClaudeSession.closeTab/getTabInfo im lặng fail → rò tab claude.ai
  // mỗi lần chạy (delete-after / cleanup). Mirror grok:closeTab/getTabInfo.
  if (msg.action === 'claude:closeTab') {
    (async () => {
      try { if (msg.tabId) await chrome.tabs.remove(msg.tabId); sendResponse({ success: true }); }
      catch (e) { sendResponse({ success: false, error: e.message }); }
    })();
    return true;
  }
  if (msg.action === 'claude:getTabInfo') {
    (async () => {
      try {
        const tab = msg.tabId ? await chrome.tabs.get(msg.tabId).catch(() => null) : null;
        sendResponse({ success: true, url: tab?.url || null, active: !!tab?.active });
      } catch (e) { sendResponse({ success: false, url: null, error: e.message }); }
    })();
    return true;
  }

});
