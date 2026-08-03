/**
 * ChatGPTConfig — Fetch + cache admin-tunable ChatGPT config từ backend.
 *
 * Endpoint: GET /api/v1/providers/api-configs (đọc cả 2 keys của ChatGPT)
 *
 * Trả về flat object merge từ 2 api_config keys:
 *   error_patterns:    {rate_limit_error_text, content_blocked_text, image_gen_failed_text,
 *                       network_error_text, cloudflare_challenge_text}
 *   ui_text_patterns:  {delete_menu_text, create_image_menu_text, generated_image_alt_text}
 *
 * Cache: chrome.storage.local.af_chatgpt_config, TTL 1 giờ.
 * Content script `chat-content-chatgpt.js` đọc từ storage này runtime.
 *
 * Refresh:
 *   - On extension boot (stale-while-revalidate: serve cache, refresh background)
 *   - Manual: ChatGPTConfig.refresh()
 */
class ChatGPTConfig {
  static _CACHE_KEY = 'af_chatgpt_config';
  static _CACHE_TTL_MS = 60 * 60 * 1000; // 1h
  static _fetchPromise = null;            // dedup concurrent fetches

  // ───────────────────────────────────────────────────────────────────────
  // LOCAL MODE (offline) — bundled ChatGPT error/UI-text patterns
  // Khi self.SEOSONA_LOCAL_MODE !== false, KHÔNG gọi background/server.
  // Content script chat-content-chatgpt.js đọc từ storage af_chatgpt_config;
  // ta write defaults dưới đây để error/UI detection vẫn hoạt động offline.
  // ───────────────────────────────────────────────────────────────────────
  static _isLocal() {
    try { return self.SEOSONA_LOCAL_MODE !== false; }
    catch (_) { return true; }
  }

  static _LOCAL_DEFAULTS = {
    // error_patterns
    rate_limit_error_text: "You've reached your limit|rate limit|too many requests",
    content_blocked_text: "content policy|can't help with|unable to create|violates",
    image_gen_failed_text: "image generation failed|failed to generate|couldn't generate",
    network_error_text: 'network error|connection error|something went wrong',
    cloudflare_challenge_text: 'Verify you are human|Checking your browser|Just a moment',
    // ui_text_patterns
    delete_menu_text: 'Delete',
    create_image_menu_text: 'Create image',
    generated_image_alt_text: 'Generated image',
  };

  /**
   * Đọc config từ cache hoặc fetch mới nếu hết hạn / chưa có.
   * @returns {Promise<Object|null>} { rate_limit_error_text, content_blocked_text, ... }
   */
  /**
   * Gộp error_patterns + ui_text_patterns từ ProviderConfigManager._LOCAL_API_CONFIGS (nguồn ĐẦY ĐỦ)
   * đè lên _LOCAL_DEFAULTS (bản chép tay, đã trôi khỏi nhau).
   * Cùng lỗi với GrokConfig: bản chép tay thiếu `not_logged_in_text` + `text_only_pattern`.
   */
  static _localPatterns() {
    var merged = Object.assign({}, this._LOCAL_DEFAULTS);
    try {
      var PCM = (typeof self !== 'undefined' && self.ProviderConfigManager) || (typeof window !== 'undefined' && window.ProviderConfigManager);
      var cfg = PCM && PCM._LOCAL_API_CONFIGS && PCM._LOCAL_API_CONFIGS.chatgpt && PCM._LOCAL_API_CONFIGS.chatgpt.configs;
      if (cfg) {
        for (var src of [cfg.error_patterns, cfg.ui_text_patterns]) {
          if (!src) continue;
          for (var k of Object.keys(src)) if (src[k]) merged[k] = src[k];
        }
      }
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

    // Refresh từ server (dedup concurrent calls)
    if (this._fetchPromise) return this._fetchPromise;
    this._fetchPromise = this._doFetch().finally(() => { this._fetchPromise = null; });
    const fetched = await this._fetchPromise;
    // Nếu fetch fail nhưng có cache cũ → trả cache stale (better than nothing)
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
      console.warn('[ChatGPTConfig] background fetch failed:', err?.message || err);
    });
  }

  static async _doFetch() {
    // Fetch từ /providers/api-configs — đọc CẢ 2 keys (error_patterns + ui_text_patterns)
    // → merge flat object cho content script consume.
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({
          action: 'apiRequest',
          method: 'GET',
          endpoint: 'providers/api-configs',
        }, async (resp) => {
          if (chrome.runtime.lastError) {
            console.warn('[ChatGPTConfig] fetch error:', chrome.runtime.lastError.message);
            resolve(null);
            return;
          }
          const errorPatterns = resp?.data?.chatgpt?.configs?.error_patterns || {};
          const uiTextPatterns = resp?.data?.chatgpt?.configs?.ui_text_patterns || {};
          const merged = { ...errorPatterns, ...uiTextPatterns };
          if (resp?.success && Object.keys(merged).length > 0) {
            await this._writeCache(merged);
            resolve(merged);
          } else {
            console.warn('[ChatGPTConfig] No data from providers/api-configs');
            resolve(null);
          }
        });
      } catch (e) {
        console.warn('[ChatGPTConfig] sendMessage failed:', e?.message);
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

window.ChatGPTConfig = ChatGPTConfig;
