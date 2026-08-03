/**
 * DOM Selector Helper — Query với fallback chain + text match + failure reporting
 */
class DomSelectorHelper {
  /**
   * Query selector với fallback chain
   * @param {Element|Document} root - Root element
   * @param {string|string[]} selectors - 1 hoặc nhiều selectors
   * @param {Object} options - { textMatch, attribute, provider, key, reportFailure }
   * @returns {Element|null}
   */
  static querySelector(root, selectors, options = {}) {
    if (!root) return null;
    const list = Array.isArray(selectors) ? selectors : [selectors];

    for (let i = 0; i < list.length; i++) {
      const sel = list[i];
      if (!sel) continue;

      try {
        const el = root.querySelector(sel);
        if (el && this._matchesText(el, options.textMatch)) {
          if (options.debug) {
            console.log(`[DomSelectorHelper] Found with tier ${i + 1}: ${sel}`);
          }
          return el;
        }
      } catch (e) {
        console.warn('[DomSelectorHelper] Invalid selector:', sel, e.message);
      }
    }

    // Report failure if enabled
    if (options.reportFailure !== false && options.provider && options.key) {
      if (window.ProviderConfigManager) {
        window.ProviderConfigManager.reportFailure(options.provider, options.key, list);
      }
    }

    return null;
  }

  /**
   * Query all với fallback chain
   * @returns {Element[]}
   */
  static querySelectorAll(root, selectors, options = {}) {
    if (!root) return [];
    const list = Array.isArray(selectors) ? selectors : [selectors];

    for (let i = 0; i < list.length; i++) {
      const sel = list[i];
      if (!sel) continue;

      try {
        const nodeList = root.querySelectorAll(sel);
        if (nodeList.length > 0) {
          const arr = Array.from(nodeList);
          if (options.textMatch) {
            const filtered = arr.filter(el => this._matchesText(el, options.textMatch));
            if (filtered.length > 0) {
              if (options.debug) {
                console.log(`[DomSelectorHelper] Found ${filtered.length} elements with tier ${i + 1}: ${sel}`);
              }
              return filtered;
            }
          } else {
            if (options.debug) {
              console.log(`[DomSelectorHelper] Found ${arr.length} elements with tier ${i + 1}: ${sel}`);
            }
            return arr;
          }
        }
      } catch (e) {
        console.warn('[DomSelectorHelper] Invalid selector:', sel, e.message);
      }
    }

    if (options.reportFailure !== false && options.provider && options.key) {
      if (window.ProviderConfigManager) {
        window.ProviderConfigManager.reportFailure(options.provider, options.key, list);
      }
    }

    return [];
  }

  /**
   * Query với config từ ProviderConfigManager
   */
  static async query(root, provider, key, options = {}) {
    const config = await window.ProviderConfigManager?.get(provider, key);
    if (!config) return null;

    return this.querySelector(root, config.selectors, {
      textMatch: config.text_match,
      provider,
      key,
      ...options,
    });
  }

  /**
   * Query all với config
   */
  static async queryAll(root, provider, key, options = {}) {
    const config = await window.ProviderConfigManager?.get(provider, key);
    if (!config) return [];

    return this.querySelectorAll(root, config.selectors, {
      textMatch: config.text_match,
      provider,
      key,
      ...options,
    });
  }

  /**
   * Extract attribute value
   */
  static async queryAttribute(root, provider, key, options = {}) {
    const config = await window.ProviderConfigManager?.get(provider, key);
    if (!config) return null;

    const el = this.querySelector(root, config.selectors, {
      textMatch: config.text_match,
      provider,
      key,
      ...options,
    });

    if (!el) return null;
    return config.attribute ? el.getAttribute(config.attribute) : el.textContent;
  }

  /**
   * Sync version - dùng _DEFAULTS trực tiếp (không async)
   * Hữu ích cho code cần sync access
   */
  static querySync(root, provider, key, options = {}) {
    const defaults = window.ProviderConfigManager?._DEFAULTS?.[provider]?.[key];
    if (!defaults) return null;

    return this.querySelector(root, defaults.selectors, {
      textMatch: defaults.text_match,
      provider,
      key,
      ...options,
    });
  }

  static queryAllSync(root, provider, key, options = {}) {
    const defaults = window.ProviderConfigManager?._DEFAULTS?.[provider]?.[key];
    if (!defaults) return [];

    return this.querySelectorAll(root, defaults.selectors, {
      textMatch: defaults.text_match,
      provider,
      key,
      ...options,
    });
  }

  /**
   * Check text match
   */
  static _matchesText(el, textMatch) {
    if (!textMatch) return true;
    const text = el.textContent?.trim()?.toLowerCase() || '';
    return text.includes(textMatch.toLowerCase());
  }

  /**
   * Wait for element với fallback chain
   * @param {Element|Document} root
   * @param {string|string[]} selectors
   * @param {Object} options - { timeout, interval, textMatch }
   * @returns {Promise<Element|null>}
   */
  static waitFor(root, selectors, options = {}) {
    const timeout = options.timeout || 10000;
    const interval = options.interval || 100;

    return new Promise(resolve => {
      const startTime = Date.now();

      const check = () => {
        const el = this.querySelector(root, selectors, { ...options, reportFailure: false });
        if (el) {
          resolve(el);
          return;
        }

        if (Date.now() - startTime >= timeout) {
          // Report failure on timeout
          if (options.provider && options.key) {
            const list = Array.isArray(selectors) ? selectors : [selectors];
            if (window.ProviderConfigManager) {
              window.ProviderConfigManager.reportFailure(options.provider, options.key, list);
            }
          }
          resolve(null);
          return;
        }

        setTimeout(check, interval);
      };

      check();
    });
  }

  /**
   * Wait for element với config từ ProviderConfigManager
   */
  static async waitForConfig(root, provider, key, options = {}) {
    const config = await window.ProviderConfigManager?.get(provider, key);
    if (!config) return null;

    return this.waitFor(root, config.selectors, {
      textMatch: config.text_match,
      provider,
      key,
      ...options,
    });
  }
}

// Export
if (typeof window !== 'undefined') {
  window.DomSelectorHelper = DomSelectorHelper;
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DomSelectorHelper;
}
