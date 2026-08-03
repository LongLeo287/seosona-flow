/**
 * ProviderMeta - Cache provider metadata từ backend
 *
 * Cung cấp:
 * - getName(slug) → "ChatGPT" | "Grok" | ...
 * - getIcon(slug) → SVG string | fallback hardcoded
 * - getStatus(slug) → "active" | "maintenance" | "disabled" | ...
 * - isActive(slug) → boolean
 * - getAll() → sorted array
 *
 * SSE listener: provider_updated → update cache + emit event
 *
 * NOTE: Tách biệt với ProviderRegistry (adapter registry) ở providers/ProviderRegistry.js
 */
class ProviderMeta {
  static _cache = null;
  static _cacheTime = 0;
  static _cacheTtl = 300000; // 5 minutes
  static _initialized = false;

  // Fallback icons (current hardcoded SVGs) - used when backend has no icon
  static _FALLBACK_ICONS = {
    flow: `<svg class="provider-tab-icon" width="14" height="14" viewBox="0 0 24 24"><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="#3186FF"/><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#ptab-flow-0)"/><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#ptab-flow-1)"/><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#ptab-flow-2)"/><defs><linearGradient gradientUnits="userSpaceOnUse" id="ptab-flow-0" x1="7" x2="11" y1="15.5" y2="12"><stop stop-color="#08B962"/><stop offset="1" stop-color="#08B962" stop-opacity="0"/></linearGradient><linearGradient gradientUnits="userSpaceOnUse" id="ptab-flow-1" x1="8" x2="11.5" y1="5.5" y2="11"><stop stop-color="#F94543"/><stop offset="1" stop-color="#F94543" stop-opacity="0"/></linearGradient><linearGradient gradientUnits="userSpaceOnUse" id="ptab-flow-2" x1="3.5" x2="17.5" y1="13.5" y2="12"><stop stop-color="#FABC12"/><stop offset=".46" stop-color="#FABC12" stop-opacity="0"/></linearGradient></defs></svg>`,
    chatgpt: `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>`,
    grok: `<svg class="provider-tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"/></svg>`,
    gemini: `<svg class="provider-tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58 12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96 2.19.93 3.81 2.55t2.55 3.81"/></svg>`,
    claude: `<svg class="provider-tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M17.3041 3.541h-3.6718l6.696 16.918H24Zm-10.6082 0L0 20.459h3.7442l1.3693-3.5527h7.0052l1.3693 3.5528h3.7442L10.5363 3.5409Zm-.3712 10.2232 2.2914-5.9456 2.2914 5.9456Z"/></svg>`,
  };

  // Fallback names
  static _FALLBACK_NAMES = {
    flow: 'Google Flow',
    chatgpt: 'ChatGPT',
    grok: 'Grok',
    gemini: 'Gemini',
    claude: 'Claude',
  };

  // Fallback order
  static _FALLBACK_ORDER = {
    flow: 1,
    chatgpt: 2,
    grok: 3,
    gemini: 4,
    claude: 5,
  };

  // [tracker-unified] Màu thương hiệu per-PROVIDER (cho tracker/badge). Trước đây tracker tô màu theo
  // OWNER-type (prompts/task/workflow) → không phản ánh provider. Đây là 1 nguồn màu provider duy nhất.
  static _PROVIDER_COLORS = {
    flow: '#3186FF',    // Google Flow blue
    chatgpt: '#10a37f', // OpenAI green
    grok: '#e5e7eb',    // Grok mono (sáng trên nền tối)
    gemini: '#4285F4',  // Google blue
    claude: '#D97757',  // Anthropic terracotta
  };

  /** Màu thương hiệu của provider (fallback xám nếu slug lạ). Dùng cho tracker/badge. */
  static getColor(slug) {
    return this._PROVIDER_COLORS[String(slug || '').toLowerCase()] || '#6b7280';
  }

  /**
   * Fetch providers từ server, cache locally
   */
  static _isLocal() {
    try { return self.SEOSONA_LOCAL_MODE !== false; }
    catch (_) { return true; }
  }

  /** LOCAL: build provider list từ _FALLBACK_* maps. */
  static _localProviders() {
    return Object.keys(this._FALLBACK_NAMES).map(slug => ({
      slug,
      name: this._FALLBACK_NAMES[slug],
      icon: this._FALLBACK_ICONS[slug] || null,
      status: 'active',
      base_url: null,
      sort_order: this._FALLBACK_ORDER[slug],
    })).sort((a, b) => a.sort_order - b.sort_order);
  }

  static async fetch() {
    // LOCAL: KHÔNG fetch server — trả provider list từ fallback maps.
    if (this._isLocal()) {
      if (!this._cache?.length) {
        this._cache = this._localProviders();
        this._cacheTime = Date.now();
      }
      return this._cache;
    }
    // Check cache
    if (this._cache && Date.now() - this._cacheTime < this._cacheTtl) {
      return this._cache;
    }

    try {
      const baseUrl = window.ApiBaseConfig?.get?.();
      if (!baseUrl) throw new Error('ApiBaseConfig not available');

      const signedHeaders = window.RequestSigner ? await window.RequestSigner.headers('GET', '/api/v1/providers', '') : {};
      // Anti-clone: X-Extension-Id để pass VerifyExtensionId middleware khi toggle ON
      try { if (chrome?.runtime?.id) signedHeaders['X-Extension-Id'] = chrome.runtime.id; } catch (_) { globalThis.SEOSONA_swallow?.('ProviderMeta', _); }
      const resp = await fetch(`${baseUrl}/providers`, {
        headers: signedHeaders,
        cache: 'no-store', // Always fetch fresh data, bypass browser cache
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const json = await resp.json();
      this._cache = json.data || [];
      this._cacheTime = Date.now();

      // Also save to chrome.storage for instant access on next load
      chrome.storage.local.set({ seosona_providers: this._cache });

      console.log('[ProviderMeta] Fetched', this._cache.length, 'providers');
      // Emit event so UI components can update
      window.eventBus?.emit('provider:meta_loaded', { providers: this._cache });
      return this._cache;
    } catch (e) {
      console.warn('[ProviderMeta] Fetch failed:', e.message);
      // Fallback to chrome.storage
      try {
        const stored = await chrome.storage.local.get('seosona_providers');
        if (stored.seosona_providers?.length) {
          this._cache = stored.seosona_providers;
          return this._cache;
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('ProviderMeta', _); }
      return [];
    }
  }

  /**
   * Get provider by slug (sync - from cache only)
   */
  static getSync(slug) {
    return this._cache?.find(p => p.slug === slug) || null;
  }

  /**
   * Get provider name
   */
  static getName(slug) {
    const fromCache = this.getSync(slug)?.name;
    const result = fromCache || this._FALLBACK_NAMES[slug] || slug;
    if (!fromCache) {
      console.log(`[ProviderMeta] getName(${slug}): cache miss, using fallback "${result}"`);
    }
    return result;
  }

  /**
   * Get provider icon (SVG string)
   * Returns backend icon if starts with '<svg', otherwise fallback
   */
  static getIcon(slug) {
    const provider = this.getSync(slug);
    const icon = provider?.icon;
    // Check if icon is SVG markup
    if (icon && (icon.trim().startsWith('<svg') || icon.trim().startsWith('<?xml'))) {
      return icon;
    }
    // Fallback to hardcoded
    return this._FALLBACK_ICONS[slug] || '';
  }

  /**
   * Check if server has a valid custom icon (not empty/fallback)
   */
  static hasServerIcon(slug) {
    const provider = this.getSync(slug);
    const icon = provider?.icon;
    return !!(icon && (icon.trim().startsWith('<svg') || icon.trim().startsWith('<?xml')));
  }

  /**
   * Get provider status
   */
  static getStatus(slug) {
    return this.getSync(slug)?.status || 'active';
  }

  /**
   * Check if provider is active
   */
  static isActive(slug) {
    const status = this.getStatus(slug);
    return status === 'active';
  }

  /**
   * Get provider base URL
   */
  static getBaseUrl(slug) {
    return this.getSync(slug)?.base_url || '';
  }

  /**
   * Get all providers (sorted by sort_order)
   */
  static getAll() {
    if (!this._cache?.length) {
      // Return fallback structure
      return Object.keys(this._FALLBACK_NAMES).map(slug => ({
        slug,
        name: this._FALLBACK_NAMES[slug],
        status: 'active',
        sort_order: this._FALLBACK_ORDER[slug],
      })).sort((a, b) => a.sort_order - b.sort_order);
    }
    return [...this._cache].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
  }

  /**
   * Get active providers only
   */
  static getActiveProviders() {
    return this.getAll().filter(p => p.status === 'active');
  }

  /**
   * Get active provider slugs
   */
  static getActiveSlugs() {
    return this.getActiveProviders().map(p => p.slug);
  }

  /**
   * Invalidate cache (force refetch)
   */
  static invalidate() {
    this._cache = null;
    this._cacheTime = 0;
  }

  /**
   * Handle SSE update - invalidate cache + refetch từ server
   * Pattern từ ModelRegistry: không trust SSE payload, refetch để đảm bảo data mới nhất
   */
  static async handleSseUpdate(data) {
    if (!data?.provider) return;

    console.log('[ProviderMeta] SSE handleSseUpdate called:', {
      provider: data.provider,
      ssePayload: data,
    });

    // Invalidate cache - force refetch
    this._cache = null;
    this._cacheTime = 0;

    // Refetch từ server để lấy data mới nhất
    try {
      await this.fetch();
      console.log('[ProviderMeta] Refetch complete, new cache:', this._cache?.map(p => `${p.slug}:${p.name}`));
    } catch (err) {
      console.warn('[ProviderMeta] Refetch failed:', err.message);
    }
    // NOTE: Event emission moved to SseClient to avoid duplicate events
    // and ensure consistent behavior across all contexts (sidebar + workflow-editor)
  }

  /**
   * Initialize - fetch + bind SSE listener
   */
  static async init() {
    if (this._initialized) return;

    // LOCAL: populate cache từ fallback maps, KHÔNG fetch server, KHÔNG bind SSE.
    if (this._isLocal()) {
      this._cache = this._localProviders();
      this._cacheTime = Date.now();
      window.eventBus?.emit('provider:meta_loaded', { providers: this._cache, source: 'local' });
      this._initialized = true;
      return;
    }

    // Load from storage first (instant) - for fast initial render
    try {
      const stored = await chrome.storage.local.get('seosona_providers');
      if (stored.seosona_providers?.length) {
        this._cache = stored.seosona_providers;
        console.log('[ProviderMeta] Loaded from storage:', this._cache.length, 'providers');
        // Emit event for fast UI update with cached data
        window.eventBus?.emit('provider:meta_loaded', { providers: this._cache, source: 'storage' });
      }
    } catch (_) { globalThis.SEOSONA_swallow?.('ProviderMeta', _); }

    // Force fetch fresh from server (ignore cache TTL on init)
    this._cacheTime = 0; // Reset cache time to force fresh fetch
    this.fetch().catch(function (_e) { globalThis.SEOSONA_swallow?.('ProviderMeta', _e); });

    // SSE listener - MUST be called after eventBus is created
    if (window.eventBus) {
      window.eventBus.on('sse:provider_updated', (data) => {
        this.handleSseUpdate(data);
      });
      console.log('[ProviderMeta] SSE listener bound to sse:provider_updated');
    } else {
      console.warn('[ProviderMeta] eventBus not available, SSE listener NOT bound!');
    }

    this._initialized = true;
    console.log('[ProviderMeta] Initialized');
  }
}

window.ProviderMeta = ProviderMeta;
