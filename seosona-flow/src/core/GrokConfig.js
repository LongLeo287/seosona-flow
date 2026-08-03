/**
 * GrokConfig — Fetch + cache admin-tunable Grok config từ backend.
 *
 * Endpoint: GET /api/v1/providers/api-configs
 * Trả về 4 patterns (pipe-separated) để content script detect lỗi + Cloudflare challenge:
 *   - rate_limit_text
 *   - content_blocked_text
 *   - network_error_text
 *   - cloudflare_challenge_text
 *
 * Cache: chrome.storage.local.af_grok_config, TTL 1 giờ.
 * Content script `chat-content-grok.js` đọc từ storage này runtime.
 *
 * Refresh:
 *   - On extension boot (stale-while-revalidate: serve cache, refresh background)
 *   - Manual: GrokConfig.refresh()
 */
class GrokConfig {
  static _CACHE_KEY = 'af_grok_config';
  static _CACHE_TTL_MS = 60 * 60 * 1000; // 1h
  static _fetchPromise = null;

  // ───────────────────────────────────────────────────────────────────────
  // LOCAL MODE (offline) — bundled Grok error patterns
  // Content script chat-content-grok.js đọc từ storage af_grok_config.
  // ───────────────────────────────────────────────────────────────────────
  static _isLocal() {
    try { return self.SEOSONA_LOCAL_MODE !== false; }
    catch (_) { return true; }
  }

  static _LOCAL_DEFAULTS = {
    rate_limit_text: "You've reached your limit|rate limit|too many requests",
    content_blocked_text: "can't help|content policy|unable to|violates|not allowed",
    network_error_text: 'network error|connection error|something went wrong|try again',
    cloudflare_challenge_text: 'Verify you are human|Checking your browser|Just a moment',
  };

  /**
   * Đọc config từ cache hoặc fetch mới nếu hết hạn / chưa có.
   * @returns {Promise<Object|null>} { rate_limit_text, content_blocked_text, network_error_text, cloudflare_challenge_text }
   */
  /**
   * Gộp error_patterns từ ProviderConfigManager._LOCAL_API_CONFIGS (nguồn ĐẦY ĐỦ) đè lên
   * _LOCAL_DEFAULTS (bản chép tay, dễ thiếu).
   *
   * Vì sao: cùng một dữ liệu tồn tại ở 2 nơi và đã TRÔI khỏi nhau — _LOCAL_DEFAULTS thiếu
   * `not_logged_in_text` + `subscription_required_text`, khiến content script grok cảnh báo
   * "notLoggedIn empty" và không nhận diện được modal đòi Premium. PCM mới là bản đủ.
   */
  static _localPatterns() {
    var merged = Object.assign({}, this._LOCAL_DEFAULTS);
    try {
      var PCM = (typeof self !== 'undefined' && self.ProviderConfigManager) || (typeof window !== 'undefined' && window.ProviderConfigManager);
      var ep = PCM && PCM._LOCAL_API_CONFIGS && PCM._LOCAL_API_CONFIGS.grok
        && PCM._LOCAL_API_CONFIGS.grok.configs && PCM._LOCAL_API_CONFIGS.grok.configs.error_patterns;
      if (ep) for (var k of Object.keys(ep)) if (ep[k]) merged[k] = ep[k];
    } catch (_) { /* thiếu PCM → dùng bản chép tay */ }
    return merged;
  }

  static async fetch() {
    // LOCAL: KHÔNG fetch — trả bundled defaults, write storage cho content script.
    if (this._isLocal()) {
      const local = this._localPatterns();
      await this._writeCache(local);
      return local;
    }
    const cached = await this._readCache();
    const fresh = cached && (Date.now() - (cached.fetched_at || 0) < this._CACHE_TTL_MS);
    if (fresh) return cached.data;

    if (this._fetchPromise) return this._fetchPromise;
    this._fetchPromise = this._doFetch().finally(() => { this._fetchPromise = null; });
    const fetched = await this._fetchPromise;
    return fetched || cached?.data || null;
  }

  /** Force refresh từ server, bỏ qua cache. */
  static async refresh() {
    // LOCAL: KHÔNG fetch — trả bundled defaults.
    if (this._isLocal()) {
      await this._writeCache(this._LOCAL_DEFAULTS);
      return this._LOCAL_DEFAULTS;
    }
    if (this._fetchPromise) return this._fetchPromise;
    this._fetchPromise = this._doFetch().finally(() => { this._fetchPromise = null; });
    return this._fetchPromise;
  }

  /** Background fetch + write storage (không block caller nếu user mở extension lần đầu). */
  static fetchInBackground() {
    this.fetch().catch((err) => {
      console.warn('[GrokConfig] background fetch failed:', err?.message || err);
    });
  }

  static async _doFetch() {
    // Fetch error_patterns từ /providers/api-configs
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({
          action: 'apiRequest',
          method: 'GET',
          endpoint: 'providers/api-configs',
        }, async (resp) => {
          if (chrome.runtime.lastError) {
            console.warn('[GrokConfig] fetch error:', chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          const errorPatterns = resp?.data?.grok?.configs?.error_patterns;
          if (resp?.success && errorPatterns && typeof errorPatterns === 'object') {
            await this._writeCache(errorPatterns);
            resolve(errorPatterns);
          } else {
            console.warn('[GrokConfig] No data from providers/api-configs');
            resolve(null);
          }
        });
      } catch (e) {
        console.warn('[GrokConfig] sendMessage failed:', e?.message);
        resolve(null);
      }
    });
  }

  static async _readCache() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get([this._CACHE_KEY], (r) => {
          resolve(r?.[this._CACHE_KEY] || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  static async _writeCache(data) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set({
          [this._CACHE_KEY]: { data, fetched_at: Date.now() },
        }, resolve);
      } catch (e) {
        resolve();
      }
    });
  }

  static async clearCache() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.remove([this._CACHE_KEY], resolve);
      } catch (e) {
        resolve();
      }
    });
  }
}

window.GrokConfig = GrokConfig;
