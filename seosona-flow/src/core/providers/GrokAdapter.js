/**
 * GrokAdapter - Provider adapter cho Grok (grok.com / x.ai).
 *
 * Phụ thuộc:
 * - window.GrokSession (G-2): ensureReady, setMode, setRatio, setQuantity,
 *   setVideoDuration, setVideoResolution.
 * - window.MessageBridge (G-3.3): grokSubmitAndWait, grokFetchImage,
 *   grokBridgeToFlow. Adapter này CHỈ reference theo tên — không tự
 *   implement bridge logic.
 *
 * Đặc điểm:
 * - 5 ratios: portrait (2:3), landscape (3:2), square (1:1),
 *   story (9:16), widescreen (16:9). Default 'widescreen' (16:9).
 * - Hỗ trợ video mode (duration 6s/10s, resolution 480p/720p).
 * - KHÔNG hỗ trợ quantity (Grok UI SEOSONA Flow mode không có quantity selector).
 * - supportsHumanized=false vì Grok submit qua KeyboardEvent Enter,
 *   không cần humanized typing.
 * - Cross-provider bridge (grok -> generate workflow) defer Phase G-6.
 */
class GrokAdapter extends AIProviderAdapter {
  constructor() {
    super();
    this.key = 'grok';
    this.displayName = 'Grok';
    this.featureKey = 'grok_enabled';
    this.executionAction = 'grok_run';

    // Phase 6 Bug O (2026-06-03): XÓA _fallbackRatios + _defaultCapabilities hardcoded.
    // Strict Server-Only — capabilities + ratios + durations/resolutions/qualities đọc 100% từ PCM.
  }

  /**
   * Phase 6 Bug O: Capabilities strict server-only — đọc từ PCM safeGet*.
   */
  get capabilities() {
    // Memoize same pattern as ChatGPTAdapter
    if (this.constructor._capabilitiesCache) return this.constructor._capabilitiesCache;

    const pcm = typeof ProviderConfigManager !== 'undefined' ? ProviderConfigManager : null;
    const supports = pcm?.safeGetSupportsSync?.('grok') || {};
    const maxRef = pcm?.safeGetMaxRefImagesSync?.('grok', 'image') ?? 0;
    const ratioUiMap = pcm?.safeGetRatioUiMapSync?.('grok') || {};
    const durations = pcm?.getSupportedDurationsSync?.('grok') || [];
    const resolutions = pcm?.getSupportedResolutionsSync?.('grok') || [];
    const imageQualities = pcm?.getSupportedImageQualitiesSync?.('grok') || [];
    const ratios = pcm?.safeGetRatiosSync?.('grok', 'image') || [];

    const result = {
      supportsRatio: supports.ratio ?? false,
      supportsQuantity: supports.quantity ?? false,
      supportsVideo: supports.video ?? false,
      supportsRefImage: supports.ref_image ?? false,
      supportsAutoDownload: supports.auto_download ?? false,
      supportsHumanized: supports.humanized ?? false,
      supportsImageMode: supports.image_mode ?? false,
      maxRefImages: maxRef,
      supportedRatios: ratios.map(r => r.ui_name),
      ratioUiMap: Object.keys(ratioUiMap).length > 0
        ? ratioUiMap
        : ratios.reduce((acc, r) => { acc[r.ui_name] = r.value; return acc; }, {}),
      supportedDurations: durations,
      supportedResolutions: resolutions,
      supportedImageQualities: imageQualities,
    };

    this.constructor._capabilitiesCache = result;
    this.constructor._bindCapabilitiesInvalidation();
    return result;
  }

  // SSE invalidation — same pattern ChatGPTAdapter
  static _bindCapabilitiesInvalidation() {
    if (this._invalidationBound) return;
    this._invalidationBound = true;
    if (!window.eventBus) return;
    const invalidate = (data) => {
      if (!data?.provider || data.provider === 'grok') {
        this._capabilitiesCache = null;
      }
    };
    window.eventBus.on('sse:provider_config_updated', invalidate);
    window.eventBus.on('provider:api_config_updated', invalidate);
    window.eventBus.on('provider:dom_selector_updated', invalidate);
    window.eventBus.on('provider:models_updated', invalidate);
    // Full refetch (version-poller _updateFromVersion) emit 2 event này KHÔNG kèm provider →
    // `!data?.provider` → invalidate. Tránh caps stale khi refetch mà không có provider_config_updated.
    window.eventBus.on('provider:api_configs_loaded', invalidate);
    window.eventBus.on('provider:updated', invalidate);
  }

  /**
   * Kiểm tra session Grok sẵn sàng (tab mở, đăng nhập, editor ready).
   * Delegate sang GrokSession.ensureReady().
   */
  async ensureReady() {
    if (!window.GrokSession) {
      return { ready: false, error: 'GROKSESSION_NOT_LOADED' };
    }
    try {
      return await window.GrokSession.ensureReady({ createIfMissing: true, activate: true });
    } catch (e) {
      return { ready: false, error: e?.message || 'SESSION_ERROR' };
    }
  }

  /**
   * Submit prompt tới Grok.
   *
   * Params:
   *   { prompt, refFileIds, settings: { mode, ratio, duration, resolution, imageQuality, timeout }, taskName }
   *
   * Steps:
   *   1. ensureReady() — đảm bảo tab + session OK.
   *   2. Apply settings sequential (mode → ratio → image_quality hoặc duration/resolution).
   *      Grok không hỗ trợ batch settings như ChatGPT.
   *   3. Resolve ref images sang base64 (cap maxRefImages=4).
   *   4. Gọi MessageBridge.grokSubmitAndWait — đợi media sinh xong.
   *   5. Trả { success, mediaUrls, mediaType, postId, url, error?, message? }.
   *
   * Cross-provider (grok -> generate workflow): caller tự gọi
   * MessageBridge.grokBridgeToFlow sau khi nhận mediaUrls. Adapter
   * không tự bridge để giữ separation of concerns.
   */
  async submit(params = {}) {
    let ready = await this.ensureReady();
    if (!ready || !ready.ready) {
      return { success: false, error: ready?.error || 'NOT_READY' };
    }

    let tabId = ready.tabId || (await window.GrokSession?.getTabInfo?.())?.tabId;
    if (!tabId) {
      return { success: false, error: 'NO_TAB' };
    }

    const settings = params.settings || {};
    const mode = settings.mode || 'image';
    const ratio = this._normalizeRatio(settings.ratio);
    const duration = settings.duration || '6s';
    const resolution = settings.resolution || '720p';
    // Image quality (Grok update 2026-04): 'speed' (nhanh) | 'quality' (chậm).
    // Default 'speed' để gen nhanh hơn. Chỉ áp dụng khi mode=image.
    const imageQuality = String(settings.imageQuality || 'speed').toLowerCase();
    // Hardcode dài làm safety net — actual timeout monitor qua progress indicator
    // ("Generating XX%") trong chat-content-grok.js. Heartbeat 90s ngắt sớm khi stuck.
    // Video render Grok có thể mất 3-5 phút bình thường → 600s safety budget.
    const timeout = settings.timeout || (mode === 'video'
      ? (window.SystemConfig?.getTimeout('video_timeout_ms') || 600000)
      : (window.SystemConfig?.getTimeout('image_timeout_ms') || 300000));

    // Helper: detect content script disconnection error → force re-inject
    // Reference Chrome MV3: chat-content-grok.js inject qua chrome.scripting.executeScript
    // → khi tab navigate (page reload), content script bị destroy.
    // Cache `_ready=true` của GrokSession có thể stale → first call to setMode/setRatio fails với
    // "Could not establish connection. Receiving end does not exist." → cần force re-inject + retry.
    const isDisconnectError = (errMsg) => {
      const m = String(errMsg || '').toLowerCase();
      return m.includes('receiving end does not exist') ||
             m.includes('could not establish connection') ||
             m.includes('message port closed') ||
             // Bug fix 2026-06-03: gen kế tiếp trên cùng tab gặp race navigation
             // → MessageBridge resolve với chrome.runtime.lastError này.
             m.includes('message channel closed') ||
             // Bug fix 2026-06-06: Chrome bfcache trong lúc grokSubmitAndWait chờ response.
             // Error message Chrome: "The page keeping the extension port is moved into
             // back/forward cache, so the message channel is closed."
             // Chứa "message channel IS closed" (có "is") → pattern cũ MISS.
             m.includes('message channel is closed') ||
             m.includes('back/forward cache') ||
             m.includes('extension port');
    };
    const reinjectIfNeeded = async () => {
      console.warn('[GrokAdapter] Content script disconnect detected → force re-inject');
      // Invalidate GrokSession cache + force ensureReady to re-inject
      if (window.GrokSession) {
        window.GrokSession._ready = false;
        window.GrokSession._lastCheck = 0;
      }
      ready = await this.ensureReady();
      if (!ready?.ready) {
        return false;
      }
      tabId = ready.tabId || (await window.GrokSession?.getTabInfo?.())?.tabId;
      return !!tabId;
    };

    // SETTINGS áp 1 LẦN DUY NHẤT trong content script `applyGrokSettings` (handleSubmitAndWait) —
    // chạy SAU `removeExistingRefImages` (đúng thứ tự BẮT BUỘC: phải clear refs trước, nếu không
    // ratio button ẩn khi còn refs → set ratio fail, xem comment chat-content-grok.js:2200).
    // Bỏ áp ratio/imageQuality/duration/resolution ở đây (Path 1 cũ) — vừa double-application vừa
    // SAI state (chạy TRƯỚC ref-clear). settings vẫn được pass xuống grokSubmitAndWait bên dưới.
    //
    // GIỮ setMode làm CONNECTIVITY PROBE + disconnect-heal: ensureReady có cache 60s, cache-hit
    // SKIP inject (GrokSession:177) → script có thể đã chết sau navigate mà cache còn valid → message
    // tab đầu tiên fail "Receiving end does not exist". setMode probe phát hiện → reinject → retry.
    // Mode idempotent — content script áp lại đúng sau ref-clear nên click lại radio ở đây vô hại.
    if (mode) {
      try {
        let modeResp = await window.GrokSession.setMode(mode);
        if (!modeResp?.success && isDisconnectError(modeResp?.error)) {
          const reinjected = await reinjectIfNeeded();
          if (reinjected) {
            modeResp = await window.GrokSession.setMode(mode);
          }
        }
        if (!modeResp?.success) {
          // Bug fix 2026-06-06: probe fail KHÔNG đồng nghĩa connectivity fail.
          // Khi tab Grok đang ở /imagine/post/<id> (xem result page), radiogroup
          // generation_mode KHÔNG render → selectMode return false → SET_MODE_FAILED.
          // Content script VẪN ALIVE (đã response error có cấu trúc, không phải port closed).
          // handleSubmitAndWait sau đây có ensureOnEditorPage navigate back về /imagine
          // + applyGrokSettings áp lại mode/ratio đầy đủ → KHÔNG cần bail ở probe.
          // CHỈ bail khi disconnect error (đã reinject retry nhưng vẫn fail) — đó mới là
          // connectivity thực sự không thể recover.
          if (isDisconnectError(modeResp?.error)) {
            console.warn('[GrokAdapter] setMode probe disconnect after reinject — bail');
            return { success: false, error: 'SET_MODE_FAILED' };
          }
          console.warn('[GrokAdapter] setMode probe fail (non-fatal, handleSubmitAndWait sẽ áp lại):', modeResp?.error);
        }
      } catch (e) {
        console.warn('[GrokAdapter] setMode probe exception:', e?.message || e);
      }
    }

    // Resolve ref images (cap maxRefImages=4).
    const refImagesResolved = await this._resolveRefImages(params.refFileIds || []);
    console.log('[GrokAdapter] refImages resolved:', refImagesResolved.length, '/ tabId:', tabId);

    // Submit qua MessageBridge.grokSubmitAndWait (G-3.3).
    if (!window.MessageBridge || typeof window.MessageBridge.grokSubmitAndWait !== 'function') {
      console.error('[GrokAdapter] MessageBridge.grokSubmitAndWait KHÔNG TỒN TẠI');
      return { success: false, error: 'BRIDGE_NOT_LOADED' };
    }

    console.log('[GrokAdapter] Bắt đầu grokSubmitAndWait, mode:', mode, 'prompt len:', (params.prompt || '').length);
    // inputTimeoutMs: user setting điều khiển tốc độ thao tác content script.
    // Default 1200ms (giống Flow). Content script tự áp dụng 70% ratio cho Grok.
    const inputTimeoutMs = window.storageSettings?.getSettings()?.inputTimeout || 1200;
    const submitPayload = () => ({
      text: params.prompt || '',
      images: refImagesResolved,
      settings: { mode, ratio, duration, resolution, imageQuality, timeout },
      inputTimeoutMs,
      timeout,
      tabId,
      taskName: params.taskName || null,
    });
    let result = await window.MessageBridge.grokSubmitAndWait(submitPayload());
    // Bug fix 2026-06-03: gen kế tiếp trên cùng tab Grok dễ gặp disconnect khi content
    // script bị reload bởi navigation từ gen trước / Cloudflare / user reload. Pattern y
    // hệt setMode probe (line 182-198): catch disconnect → reinject + retry 1 lần.
    if (!result?.success && isDisconnectError(result?.message || result?.error)) {
      console.warn('[GrokAdapter] grokSubmitAndWait disconnect → reinject + retry 1 lần');
      const reinjected = await reinjectIfNeeded();
      if (reinjected) {
        // submitPayload() re-evaluate để pick up tabId mới (reinject có thể đổi tab)
        result = await window.MessageBridge.grokSubmitAndWait(submitPayload());
      }
    }

    // Track grok_prompt_total (success) hoặc grok_fail (failure)
    try {
      if (window.EditorExecutor?._incrementDailyStat) {
        if (result?.success) {
          window.EditorExecutor._incrementDailyStat('grok_prompt_total');
        } else {
          window.EditorExecutor._incrementDailyStat('grok_fail');
        }
      }
    } catch (_) { /* noop */ }

    // CRITICAL: chèn tabId vào result để caller (GenTab._submitViaGrok auto-download flow)
    // có thể fetch CDN qua MessageBridge.grokFetchImage(url, tabId).
    // handleSubmitAndWait response KHÔNG kèm tabId → autoDownload skip vì `result.tabId` undefined.
    return { ...(result || { success: false, error: 'NO_RESPONSE' }), tabId };
  }

  /**
   * Normalize ratio input → key chuẩn (story/portrait/square/landscape/widescreen).
   * Accept VN ('Dọc', 'Vuông', 'Ngang'), EN, numeric ('9:16', '3:4', '1:1', '4:3', '16:9').
   * Default: 'widescreen' (16:9 — phổ biến nhất với Grok).
   */
  _normalizeRatio(input) {
    if (!input) return 'widescreen';
    const s = String(input).trim().toLowerCase();
    const map = {
      // 9:16 (story / dọc cao)
      '9:16': 'story',
      'dọc': 'story',
      'doc': 'story',
      'story': 'story',
      // 3:4 / 2:3 (portrait)
      '3:4': 'portrait',
      '2:3': 'portrait',
      'portrait': 'portrait',
      // 1:1 (square)
      '1:1': 'square',
      'vuông': 'square',
      'vuong': 'square',
      'square': 'square',
      // 4:3 / 3:2 (landscape)
      '4:3': 'landscape',
      '3:2': 'landscape',
      'landscape': 'landscape',
      // 16:9 (widescreen / ngang rộng)
      '16:9': 'widescreen',
      'ngang': 'widescreen',
      'widescreen': 'widescreen',
    };
    return map[s] || 'widescreen';
  }

  /**
   * Resolve ref tile IDs → base64 objects { base64, name, type }.
   * Cap maxRefImages=4. Pre-resolved object array → pass through.
   *
   * Phase này CHỈ support pre-resolved object array. Tile ID resolution
   * (qua TileResolver / fetchBlob) sẽ làm ở Phase G-6.
   */
  async _resolveRefImages(refIds) {
    const max = this.capabilities.maxRefImages;
    if (!Array.isArray(refIds) || refIds.length === 0) return [];

    // Pre-resolved object array (đã có base64) — pass through, cap với max.
    if (typeof refIds[0] === 'object' && refIds[0] !== null && refIds[0].base64) {
      return refIds.slice(0, max).filter((x) => x?.base64);
    }

    // Tile IDs (string array) — chưa hỗ trợ ở phase này (defer G-6).
    console.warn(
      '[GrokAdapter] _resolveRefImages: bỏ qua', refIds.length,
      'tile ID(s) — chưa wire resolution sang base64 (defer G-6).'
    );
    return [];
  }

  /**
   * Upload reference cho Grok.
   * Reuse ImmediateUploader (Flow infra) — Grok refs upload tới Flow trước
   * để cross-provider compat (giống ChatGPT pattern).
   */
  async uploadRef(file, thumbnail, options) {
    if (typeof window.ImmediateUploader?.upload === 'function') {
      return window.ImmediateUploader.upload(file, thumbnail, options);
    }
    throw new Error('IMMEDIATE_UPLOADER_NOT_LOADED');
  }

  /**
   * Kiểm tra user có quyền dùng Grok provider không (qua FeatureGate).
   * Override base class để dùng đúng featureKey.
   */
  isEnabled() {
    if (!window.featureGate) return true;
    try {
      return !!window.featureGate.canUse(this.featureKey);
    } catch (e) {
      console.warn('[GrokAdapter] isEnabled error:', e?.message || e);
      return false;
    }
  }
}

window.GrokAdapter = GrokAdapter;
