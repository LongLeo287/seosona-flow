/**
 * [Feature: IP Geolocation 2026-05-23] LocationCache — fetch + cache user country/locale/currency.
 *
 * Pattern: tương tự ModelRegistry / PCM — singleton class với chrome.storage.local cache,
 * fetch lazy, refresh trigger qua auth event.
 *
 * Wire vào:
 *  - app.js init: fetch lần đầu sau auth init
 *  - openUpgradeModal: getCurrency() decide render VND vs USD
 *  - auth:login event: refetch (IP có thể đổi nếu user VPN)
 *
 * Plan: data/plans/IP_GEOLOCATION_CURRENCY_EMAIL_LOCALE_PLAN.md (Wave 2.1)
 */
class LocationCache {
  static CACHE_KEY = 'af_location';
  static CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
  static ENDPOINT = 'location/me';

  static _data = null;           // In-memory cache (full object)
  static _fetchPromise = null;   // Dedupe concurrent fetch
  static _cachedLocalPref = null; // Anonymous override currency (load từ af_preferred_currency)
  static _storageListenerInstalled = false; // [Audit Finding 5] Cross-tab sync guard

  static _isLocal() {
    try { return self.SEOSONA_LOCAL_MODE !== false; }
    catch (_) { return true; }
  }

  // LOCAL: default location (offline). App gốc tiếng Việt → VN/vi/VND.
  static _LOCAL_DEFAULT = {
    country_code: 'VN',
    country_name: 'Vietnam',
    locale: 'vi',
    currency: 'VND',
    ip_masked: null,
    cached_at: 0,
  };

  /**
   * Init: đọc cache từ storage, fetch nếu empty/stale (fire-and-forget).
   * Gọi 1 lần lúc app boot (sau authManager.init).
   */
  static async init() {
    try {
      // Load anonymous local override (audit fix 2026-05-23)
      const prefRes = await new Promise(resolve => {
        chrome.storage.local.get(['af_preferred_currency'], res => resolve(res));
      });
      if (prefRes?.af_preferred_currency && ['VND', 'USD'].includes(prefRes.af_preferred_currency)) {
        LocationCache._cachedLocalPref = prefRes.af_preferred_currency;
      }

      // [Audit fix Finding 5] Cross-tab sync — listen storage.onChanged để cập nhật
      // _cachedLocalPref khi user toggle currency ở tab khác. Tránh stale value khi
      // user mở nhiều extension popup/sidebar cùng lúc.
      if (!LocationCache._storageListenerInstalled && typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
          if (areaName !== 'local' || !changes.af_preferred_currency) return;
          const newVal = changes.af_preferred_currency.newValue;
          const oldVal = LocationCache._cachedLocalPref;
          if (newVal !== oldVal) {
            LocationCache._cachedLocalPref = (newVal && ['VND', 'USD'].includes(newVal)) ? newVal : null;
            // Emit để UI re-render currency-aware (vd upgrade modal)
            window.eventBus?.emit?.('location:currency_changed', { currency: LocationCache._cachedLocalPref });
          }
        });
        LocationCache._storageListenerInstalled = true;
      }

      const cached = await new Promise(resolve => {
        chrome.storage.local.get([LocationCache.CACHE_KEY], res => resolve(res[LocationCache.CACHE_KEY]));
      });
      const fresh = cached && cached.cached_at && (Date.now() - cached.cached_at < LocationCache.CACHE_TTL_MS);
      if (fresh) {
        LocationCache._data = cached;
        console.log(`[LocationCache] Loaded cached location: ${cached.country_code} / ${cached.locale} / ${cached.currency} (age: ${Math.round((Date.now() - cached.cached_at) / 1000 / 60 / 60)}h)`);
        // [Perf 2026-05-23] Bỏ stale-while-revalidate — IP user rất hiếm khi đổi trong 24h.
        // Cache fresh thì dùng cache, không call API tiếp.
        return;
      }
      // Cache empty/expired → fetch ngay (await để upgrade modal có data đúng)
      console.log('[LocationCache] Cache empty/expired → fetch fresh');
      await LocationCache.fetch();
    } catch (e) {
      console.warn('[LocationCache] init error:', e.message);
    }
  }

  /**
   * Fetch fresh từ /api/v1/location/me. Dedupe concurrent calls qua _fetchPromise.
   */
  static async fetch() {
    // LOCAL: KHÔNG fetch server — set bundled default location.
    if (LocationCache._isLocal()) {
      if (!LocationCache._data) {
        LocationCache._data = { ...LocationCache._LOCAL_DEFAULT, cached_at: Date.now() };
      }
      return LocationCache._data;
    }
    if (LocationCache._fetchPromise) return LocationCache._fetchPromise;

    LocationCache._fetchPromise = (async () => {
      try {
        const baseUrl = window.ApiBaseConfig?.get?.() || 'http://localhost:8080/api/v1';
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        // Anti-clone: X-Extension-Id để pass VerifyExtensionId middleware khi toggle ON
        const headers = {};
        try { if (chrome?.runtime?.id) headers['X-Extension-Id'] = chrome.runtime.id; } catch (_) { globalThis.SEOSONA_swallow?.('LocationCache#_fetchPromise', _); }
        // Sprint 3 HMAC: ký để pass VerifySignature enforce mode (đồng bộ background.js)
        try { Object.assign(headers, await (window.RequestSigner?.headers?.('GET', new URL(`${baseUrl}/${LocationCache.ENDPOINT}`).pathname, '') || {})); } catch (_) { globalThis.SEOSONA_swallow?.('LocationCache#_fetchPromise', _); }
        let resp;
        try {
          resp = await fetch(`${baseUrl}/${LocationCache.ENDPOINT}`, {
            cache: 'no-store',
            signal: controller.signal,
            headers,
          });
        } finally {
          clearTimeout(timeoutId);
        }
        if (!resp.ok) {
          console.warn('[LocationCache] fetch HTTP', resp.status);
          return null;
        }
        const json = await resp.json();
        if (!json?.success || !json?.data) {
          console.warn('[LocationCache] fetch invalid response shape');
          return null;
        }
        const data = {
          country_code: json.data.country_code || 'US',
          country_name: json.data.country_name || 'United States',
          locale: json.data.locale || 'en',
          currency: json.data.currency || 'USD',
          ip_masked: json.data.ip_masked || null,
          cached_at: Date.now(),
        };
        LocationCache._data = data;
        // Persist vào chrome.storage.local
        await new Promise(resolve => {
          chrome.storage.local.set({ [LocationCache.CACHE_KEY]: data }, resolve);
        });
        console.log(`[LocationCache] Fetched: ${data.country_code} / ${data.locale} / ${data.currency}`);
        return data;
      } catch (e) {
        console.warn('[LocationCache] fetch failed:', e.message);
        return null;
      } finally {
        LocationCache._fetchPromise = null;
      }
    })();

    return LocationCache._fetchPromise;
  }

  /**
   * Sync getter — return in-memory cache hoặc fallback defaults (US/en/USD).
   * KHÔNG trigger fetch — caller phải gọi init() / fetch() trước.
   */
  static getLocation() {
    if (LocationCache._data) return LocationCache._data;
    // LOCAL: default VN/vi/VND; online (chưa fetch): giữ US/en/USD legacy fallback.
    if (LocationCache._isLocal()) return { ...LocationCache._LOCAL_DEFAULT };
    return {
      country_code: 'US',
      country_name: 'United States',
      locale: 'en',
      currency: 'USD',
      ip_masked: null,
      cached_at: 0,
    };
  }

  /**
   * Get currency để render upgrade modal.
   * Priority chain (bug fix 2026-05-23):
   *  1. Local override `_cachedLocalPref` — user vừa click toggle, tôn trọng intent ngay
   *  2. Server-confirmed user.preferred_currency (auth:me cache) — baseline cross-device
   *  3. Auto detect theo country IP
   *
   * Lý do đảo priority: user click toggle phải reflect ngay. Nếu priority server first,
   * cached user object (login lúc trước) không kịp update → toggle "không có hiệu lực".
   */
  static getCurrency() {
    // Priority 1: local override (user toggle just now, hoặc anonymous session)
    if (LocationCache._cachedLocalPref && ['VND', 'USD'].includes(LocationCache._cachedLocalPref)) {
      return LocationCache._cachedLocalPref;
    }
    // Priority 2: server-confirmed user preference (load lúc login)
    const serverPref = ({ id: 'local_user', name: 'Local User', plan_slug: 'pro' })?.preferred_currency;
    if (serverPref && ['VND', 'USD'].includes(serverPref)) {
      return serverPref;
    }
    // Priority 3: auto theo country
    return LocationCache.getLocation().currency || 'USD';
  }

  static getCountryCode() {
    return LocationCache.getLocation().country_code || 'US';
  }

  static getLocale() {
    return LocationCache.getLocation().locale || 'en';
  }

  /**
   * Set user override currency.
   * Anonymous: chỉ save local af_settings (key 'preferred_currency').
   * Logged-in: gọi PATCH /api/v1/auth/me/preferred-currency để ghi vào users column
   *           (audit fix 2026-05-23: trước đây save qua /settings nhưng validation drop).
   */
  static async setPreferredCurrency(currency) {
    if (!['VND', 'USD', null].includes(currency)) {
      console.warn('[LocationCache] Invalid currency:', currency);
      return;
    }
    try {
      // Local save (qua chrome.storage.local trực tiếp — không phụ thuộc StorageSettings).
      // Dùng key riêng `af_preferred_currency` để tránh conflict với StorageSettings sync flow.
      await new Promise(resolve => {
        chrome.storage.local.set({ af_preferred_currency: currency }, resolve);
      });
      LocationCache._cachedLocalPref = currency;

      // Logged-in + online: persist server-side. LOCAL mode → chỉ lưu local (bỏ qua server).
      if (!LocationCache._isLocal()) {
        try {
          await ApiClient.request('PATCH', 'auth/me/preferred-currency', { currency });
          // Update in-memory authManager.user để getCurrency() priority 2 không stale.
          if (({ id: 'local_user', name: 'Local User', plan_slug: 'pro' })) {
            ({ id: 'local_user', name: 'Local User', plan_slug: 'pro' }).preferred_currency = currency;
          }
          console.log('[LocationCache] Server preferred_currency synced:', currency);
        } catch (apiErr) {
          console.warn('[LocationCache] Server sync failed (local override OK):', apiErr.message);
        }
      }

      // Emit để upgrade modal re-render
      window.eventBus?.emit?.('location:currency_changed', { currency });
      console.log('[LocationCache] User preferred currency set:', currency);
    } catch (e) {
      console.warn('[LocationCache] setPreferredCurrency failed:', e.message);
    }
  }
}

// Singleton + bind to window
window.LocationCache = LocationCache;
