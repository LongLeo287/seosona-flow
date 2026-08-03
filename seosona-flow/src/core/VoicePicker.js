/**
 * VoicePicker — Reusable trigger button mở VoiceSelectModal.
 *
 * Refactored 2026-05-30: chuyển từ inline popup → modal full-screen (giống StyleSelectModal).
 * Render thumbnail + label hiện tại trên trigger button; click → mở modal qua VoiceSelectModal.show().
 *
 * Usage:
 *   const picker = new VoicePicker({
 *     triggerEl: document.getElementById('genVideoVoiceTrigger'),
 *     thumbEl: document.getElementById('genVideoVoiceTriggerThumb'),
 *     labelEl: document.getElementById('genVideoVoiceLabel'),
 *     hiddenSelectEl: document.getElementById('genVideoVoiceSelect'),
 *     getSelected: () => state.selectedSlug,
 *     onChange: (slug, voiceObj) => { ... },
 *     providerSlug: 'flow',
 *   });
 *   picker.init();
 *   picker.setSelected('achernar');
 */
class VoicePicker {
  constructor(opts) {
    this.triggerEl = opts.triggerEl;
    this.thumbEl = opts.thumbEl;
    this.labelEl = opts.labelEl;
    this.hiddenSelectEl = opts.hiddenSelectEl || null;
    this.onChange = opts.onChange || (() => {});
    this.getSelected = opts.getSelected || (() => '');
    this.providerSlug = opts.providerSlug || 'flow';
    this._initialized = false;
    this._clickHandler = null;
    this._voicesRefreshedHandler = null;
    this._baseCatalogUpdatedHandler = null;
    this._storageChangeHandler = null;
  }

  init() {
    if (!this.triggerEl) return;
    if (this._initialized) return;
    this._initialized = true;

    this._clickHandler = (e) => {
      e.stopPropagation();
      this._openModal();
    };
    this.triggerEl.addEventListener('click', this._clickHandler);

    // Listen voice updates same-context (eventBus)
    if (window.eventBus) {
      this._voicesRefreshedHandler = () => this._updateTrigger();
      this._baseCatalogUpdatedHandler = () => this._updateTrigger();
      window.eventBus.on('voices:refreshed', this._voicesRefreshedHandler);
      window.eventBus.on('voices:base_catalog_updated', this._baseCatalogUpdatedHandler);
    }

    // Listen cross-window (settings.html → sidebar.html) qua chrome.storage.onChanged.
    // VoiceRegistry write af_voices_scraped khi user Resync trong settings page,
    // sidebar instance phải re-load cache + re-render trigger.
    if (chrome?.storage?.onChanged) {
      this._storageChangeHandler = (changes, area) => {
        if (area !== 'local') return;
        if (changes.seosona_provider_voices_scraped || changes.seosona_provider_voices_base) {
          // Force VoiceRegistry reload cache từ storage rồi update trigger
          if (window.VoiceRegistry) {
            window.VoiceRegistry._scrapedCache = null;
            window.VoiceRegistry._baseCache = null;
            // Re-read scraped (mới được write từ settings page)
            window.VoiceRegistry.getScrapedList().then(() => this._updateTrigger());
          } else {
            this._updateTrigger();
          }
        }
      };
      chrome.storage.onChanged.addListener(this._storageChangeHandler);
    }

    this._updateTrigger();
  }

  destroy() {
    if (this._clickHandler && this.triggerEl) {
      this.triggerEl.removeEventListener('click', this._clickHandler);
      this._clickHandler = null;
    }
    if (window.eventBus) {
      if (this._voicesRefreshedHandler) {
        window.eventBus.off?.('voices:refreshed', this._voicesRefreshedHandler);
        this._voicesRefreshedHandler = null;
      }
      if (this._baseCatalogUpdatedHandler) {
        window.eventBus.off?.('voices:base_catalog_updated', this._baseCatalogUpdatedHandler);
        this._baseCatalogUpdatedHandler = null;
      }
    }
    if (this._storageChangeHandler && chrome?.storage?.onChanged) {
      chrome.storage.onChanged.removeListener(this._storageChangeHandler);
      this._storageChangeHandler = null;
    }
    this._initialized = false;
  }

  setSelected(slug) {
    if (this.hiddenSelectEl) this.hiddenSelectEl.value = slug || '';
    this._updateTrigger();
  }

  _openModal() {
    if (!window.VoiceSelectModal) {
      console.warn('[VoicePicker] VoiceSelectModal not loaded');
      return;
    }
    const voices = (window.VoiceRegistry?.getRenderListSync(this.providerSlug)) || [];
    const selectedSlug = this.getSelected();

    console.log('[VoicePicker] Opening modal with', voices.length, 'voices (sync cache), selectedSlug=', selectedSlug, '— async refresh sẽ load full list');
    window.VoiceSelectModal.show({
      voices,
      selectedSlug,
      providerSlug: this.providerSlug,   // 2026-05-30: cho modal tự async refresh fresh data
      onSelect: (voiceObj) => {
        const slug = voiceObj?.slug || '';
        console.log('[VoicePicker] onSelect callback fired:', {
          voiceObj,
          slug,
          hiddenSelectExists: !!this.hiddenSelectEl,
        });
        if (this.hiddenSelectEl) this.hiddenSelectEl.value = slug;
        this._updateTrigger();
        try { this.onChange(slug, voiceObj); } catch (e) {
          console.warn('[VoicePicker] onChange callback error:', e);
        }
      },
    });
  }

  _voiceIconSvg() {
    // SVG microphone — server-only đa ngôn ngữ, KHÔNG emoji
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
      <line x1="12" y1="19" x2="12" y2="23"></line>
      <line x1="8" y1="23" x2="16" y2="23"></line>
    </svg>`;
  }

  _randomIconSvg() {
    return `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
      <circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"></circle>
      <circle cx="15.5" cy="8.5" r="1.5" fill="currentColor"></circle>
      <circle cx="8.5" cy="15.5" r="1.5" fill="currentColor"></circle>
      <circle cx="15.5" cy="15.5" r="1.5" fill="currentColor"></circle>
      <circle cx="12" cy="12" r="1.5" fill="currentColor"></circle>
    </svg>`;
  }

  _updateTrigger() {
    if (!this.labelEl || !this.thumbEl) return;
    const thumbId = this.thumbEl.id;
    if (!thumbId) {
      console.warn('[VoicePicker] thumbEl missing id — cannot update trigger');
      return;
    }

    const slug = this.getSelected();
    const t = (key, fallback) => window.I18n?.t?.(key) || fallback;

    if (!slug) {
      this.labelEl.textContent = t('voice.random', 'Random voice');
      this.thumbEl.outerHTML = `<span class="voice-picker-trigger-thumb-svg" id="${thumbId}">${this._voiceIconSvg()}</span>`;
      this.thumbEl = document.getElementById(thumbId);
      this.triggerEl.classList.remove('has-value');
      return;
    }

    const voice = window.VoiceRegistry?.findBySlug?.(slug);
    if (!voice) {
      this.labelEl.textContent = slug;
      this.triggerEl.classList.add('has-value');
      return;
    }

    this.labelEl.textContent = voice.display_name || voice.search_value || slug;
    this.triggerEl.classList.add('has-value');

    const thumbUrl = voice.thumbnail_full_url
      || (voice.thumbnail_url
        ? (voice.thumbnail_url.startsWith('http')
          ? voice.thumbnail_url
          : `${window.ApiBaseConfig?.getWebBase?.() || ''}/storage/${voice.thumbnail_url}`)
        : null);

    if (thumbUrl) {
      this.thumbEl.outerHTML = `<img class="voice-picker-trigger-thumb" id="${thumbId}" src="${this._escape(thumbUrl)}" alt="${this._escape(voice.display_name || '')}" loading="lazy" />`;
    } else {
      this.thumbEl.outerHTML = `<span class="voice-picker-trigger-thumb-svg" id="${thumbId}">${this._voiceIconSvg()}</span>`;
    }
    this.thumbEl = document.getElementById(thumbId);
  }

  _escape(str) {
    return String(str || '').replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }
}

if (typeof window !== 'undefined') {
  window.VoicePicker = VoicePicker;
}
