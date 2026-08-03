/**
 * EffectsEditor — Main controller for the Image Effects Editor popup window.
 * Provides UI for uploading a reference image, choosing effects,
 * and generating edited variations via Google Flow.
 */
class EffectsEditor {
  constructor(container) {
    this.container = container;
    this.state = {
      refImageId: null,
      refThumbnail: null,
      refFileName: null,
      selectedEffect: null,
      intensity: 75,
      effects: [],
      effectsByCategory: {},
      results: [],
      isGenerating: false,
      builtPrompt: '',
      ratio: '9:16',
      model: '',
      activeCategory: null
    };
    this._isUploading = false;
    this._activeGenCount = 0;
    this.execution = null;

    this.render();
    this._bindEvents();
    this._loadEffects();
    this._initExecution();
    this._loadSavedResults();
    this._loadDefaultSettings();
    this._updateQuotaDisplay();

    // Listen for featuregate changes (SSE → storage → popup)
    window.eventBus?.on('featuregate:refreshed', () => this._updateQuotaDisplay());
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  render() {
    const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;
    this.container.innerHTML = `
      <div class="effects-editor">
        <div class="effects-header">
          <div class="effects-header-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 2v4m0 12v4M2 12h4m12 0h4"/>
              <path d="m4.93 4.93 2.83 2.83m8.48 8.48 2.83 2.83M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83"/>
            </svg>
            <h1>${t('effects.title')}</h1>
          </div>
          <div class="effects-header-right">
            <div class="effects-quota-display" id="effectsQuotaDisplay">
              <div class="effects-quota-item" id="effectsQuotaRuns" title="${t('effects.runsToday')}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span class="effects-quota-label">${t('effects.quotaRuns') || 'Runs'}</span>
                <span class="effects-quota-value">--/--</span>
              </div>
              <span class="effects-quota-sep">&bull;</span>
              <div class="effects-quota-item" id="effectsQuotaPrompts" title="${t('effects.promptsToday')}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span class="effects-quota-label">${t('effects.quotaPrompts') || 'Prompts'}</span>
                <span class="effects-quota-value">--/--</span>
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" id="effectsClearBtn">${t('effects.clearResults')}</button>
            <button class="btn btn-secondary btn-sm" id="effectsDownloadAllBtn">${t('effects.downloadAll')}</button>
            <button class="btn btn-secondary btn-sm" id="effectsCloseBtn">${t('effects.close')}</button>
          </div>
        </div>
        <div class="effects-content">
          <div class="effects-left">
            <div class="effects-results" id="effectsResultsPanel">
              <div class="effects-empty-state" id="effectsEmptyState">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                <p>${t('effects.selectImageAndEffect')}</p>
              </div>
              <div class="effects-results-grid" id="effectsResultsGrid"></div>
            </div>
            <div class="effects-resize-handle" id="effectsResizeHandle">
              <div class="effects-resize-grip"></div>
            </div>
            <div class="effects-picker" id="effectsPickerPanel">
              <label class="effects-section-label">${t('effects.selectEffect')}</label>
              <div class="effects-category-tabs" id="effectsCategoryTabs"></div>
              <div class="effects-grid" id="effectsGrid">
                <div class="effects-loading">${t('effects.loading')}</div>
              </div>
            </div>
          </div>
          <div class="effects-control" id="effectsControlPanel">
            <!-- Upload zone -->
            <div class="effects-section">
              <label class="effects-section-label">${t('effects.sourceImage')}</label>
              <div class="effects-upload-zone" id="effectsUploadZone">
                <div class="effects-upload-placeholder" id="effectsUploadPlaceholder">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  <span>${t('effects.clickToSelect')}</span>
                </div>
                <div class="effects-upload-preview hidden" id="effectsUploadPreview">
                  <img id="effectsRefImage" alt="${t('effects.sourceImage')}" />
                  <button class="effects-upload-change" id="effectsChangeImage" title="${t('effects.changeImage')}">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                    </svg>
                  </button>
                </div>
                <input type="file" id="effectsFileInput" accept="image/*" style="display:none" />
              </div>
            </div>

            <!-- Intensity Slider -->
            <div class="effects-section">
              <div class="effects-slider-header">
                <label class="effects-section-label">${t('effects.intensity')}</label>
                <span class="effects-slider-value" id="effectsIntensityValue">${this.state.intensity}%</span>
              </div>
              <input type="range" class="effects-slider" id="effectsIntensitySlider"
                min="0" max="100" value="${this.state.intensity}" />
            </div>

            <!-- Prompt Preview (collapsible) -->
            <div class="effects-section">
              <button class="effects-toggle-header" id="effectsPromptToggle" type="button">
                <span class="effects-section-label">${t('effects.promptPreview')}</span>
                <svg class="effects-toggle-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="effects-toggle-content hidden" id="effectsPromptToggleContent">
                <textarea class="effects-prompt-preview" id="effectsPromptPreview" readonly rows="3"></textarea>
              </div>
            </div>

            <!-- Model -->
            <div class="effects-section">
              <label class="effects-section-label">${t('effects.model')}</label>
              <div class="input-group select-group">
                <select id="effectsModelSelect" class="effects-model-select">
                  <option value="">${t('effects.defaultModel')}</option>
                  ${(window.ModelRegistry?.getModelsSync('flow', 'image') || [{ name: 'Nano Banana Pro', value: 'Nano Banana Pro' }, { name: 'Nano Banana 2', value: 'Nano Banana 2' }]).map(m => `<option value="${m.value}">${m.name}</option>`).join('')}
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>

            <!-- Ratio — dynamic build từ ProviderConfigManager.getRatiosSync('flow', 'image') -->
            <div class="effects-section">
              <label class="effects-section-label">${t('effects.ratio')}</label>
              <div class="effects-ratio-pills" id="effectsRatioPills">${this._buildRatioPillsHtml()}</div>
            </div>

            <!-- Generate Button -->
            <div class="effects-section effects-section-generate">
              <button class="effects-generate-btn" id="effectsGenerateBtn" disabled>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z"></path><path d="M4.6519 14.7568L4.82063 14.2084C4.84491 14.1295 4.91781 14.0757 5.00037 14.0757C5.08292 14.0757 5.15582 14.1295 5.1801 14.2084L5.34883 14.7568C5.56525 15.4602 6.11587 16.0108 6.81925 16.2272L7.36762 16.3959C7.44652 16.4202 7.50037 16.4931 7.50037 16.5757C7.50037 16.6582 7.44652 16.7311 7.36762 16.7554L6.81926 16.9241C6.11587 17.1406 5.56525 17.6912 5.34883 18.3946L5.1801 18.9429C5.15582 19.0218 5.08292 19.0757 5.00037 19.0757C4.91781 19.0757 4.84491 19.0218 4.82063 18.9429L4.65191 18.3946C4.43548 17.6912 3.88486 17.1406 3.18147 16.9241L2.63311 16.7554C2.55421 16.7311 2.50037 16.6582 2.50037 16.5757C2.50037 16.4931 2.55421 16.4202 2.63311 16.3959L3.18148 16.2272C3.88486 16.0108 4.43548 15.4602 4.6519 14.7568Z"></path></svg>
                <span>${t('effects.generate')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENT BINDING
  // ═══════════════════════════════════════════════════════════════════════════

  _bindEvents() {
    // Close button
    this.container.querySelector('#effectsCloseBtn')?.addEventListener('click', () => {
      window.close();
    });

    // Clear results
    this.container.querySelector('#effectsClearBtn')?.addEventListener('click', () => {
      this._clearResults();
    });

    // Download all
    this.container.querySelector('#effectsDownloadAllBtn')?.addEventListener('click', () => {
      this._downloadAll();
    });

    // Upload zone click
    const uploadZone = this.container.querySelector('#effectsUploadZone');
    uploadZone?.addEventListener('click', (e) => {
      if (e.target.closest('#effectsChangeImage')) return;
      if (this._isUploading) return;
      this._openImagePicker();
    });

    // Change image button
    this.container.querySelector('#effectsChangeImage')?.addEventListener('click', () => {
      if (this._isUploading) return;
      this._openImagePicker();
    });

    // File input
    this.container.querySelector('#effectsFileInput')?.addEventListener('change', (e) => {
      if (this._isUploading) return;
      this._handleFileSelect(e.target.files?.[0]);
    });

    // Intensity slider
    this.container.querySelector('#effectsIntensitySlider')?.addEventListener('input', (e) => {
      this.state.intensity = parseInt(e.target.value);
      this._updateIntensityDisplay();
      this._updatePromptPreview();
    });

    // Model select
    this.container.querySelector('#effectsModelSelect')?.addEventListener('change', (e) => {
      this.state.model = e.target.value;
    });

    // Prompt toggle
    const promptToggle = this.container.querySelector('#effectsPromptToggle');
    const promptContent = this.container.querySelector('#effectsPromptToggleContent');
    promptToggle?.addEventListener('click', () => {
      promptToggle.classList.toggle('expanded');
      promptContent?.classList.toggle('hidden');
    });

    // Ratio pills — event delegation cho dynamic re-render
    const ratioContainer = this.container.querySelector('#effectsRatioPills');
    if (ratioContainer) {
      ratioContainer.addEventListener('click', (e) => {
        const pill = e.target.closest('.effects-ratio-pill');
        if (!pill || !ratioContainer.contains(pill)) return;
        ratioContainer.querySelectorAll('.effects-ratio-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        this.state.ratio = pill.dataset.ratio;
      });
      // Set initial active state
      this._setActiveRatioPill(this.state.ratio || '9:16');
    }

    // Admin update Flow ratios → re-render pills
    if (window.eventBus && !this._ratioSseBound) {
      this._ratioSseBound = true;
      window.eventBus.on('provider:api_config_updated', ({ provider, key }) => {
        if (provider !== 'flow' || key !== 'ratios') return;
        const c = this.container?.querySelector('#effectsRatioPills');
        if (!c) return;
        c.innerHTML = this._buildRatioPillsHtml();
        this._setActiveRatioPill(this.state.ratio || '9:16');
      });

      // Bug 34 fix (2026-05-19): Admin add/remove/rename model → re-populate model select.
      window.eventBus.on('provider:models_updated', () => {
        const selectEl = this.container?.querySelector('#effectsModelSelect');
        if (!selectEl || !window.ModelRegistry?.getModelsSync) return;
        const models = window.ModelRegistry.getModelsSync('flow', 'image');
        if (!Array.isArray(models) || models.length === 0) return;
        const prevValue = selectEl.value;
        selectEl.innerHTML = '';
        for (const m of models) {
          const opt = document.createElement('option');
          opt.value = m.value || m.name;
          opt.textContent = m.name;
          selectEl.appendChild(opt);
        }
        if (prevValue && [...selectEl.options].some(o => o.value === prevValue)) {
          selectEl.value = prevValue;
        } else if (this.state.imageModel) {
          selectEl.value = this.state.imageModel;
        }
      });
    }

    // Generate button
    this.container.querySelector('#effectsGenerateBtn')?.addEventListener('click', () => {
      this._runGeneration();
    });

    // Resize handle for effect picker
    this._bindResizeHandle();
  }

  _setActiveRatioPill(ratio) {
    const pills = this.container?.querySelectorAll('.effects-ratio-pill');
    pills?.forEach(p => p.classList.toggle('active', p.dataset.ratio === ratio));
  }

  /**
   * Build pill HTML từ ProviderConfigManager.getRatiosSync('flow', 'image') với fallback.
   */
  _buildRatioPillsHtml() {
    const fallback = ['16:9', '4:3', '1:1', '3:4', '9:16'];
    const ratios = (window.ProviderConfigManager?.safeGetRatiosSync?.('flow', 'image')) || fallback;
    return ratios.map(r => {
      const value = typeof r === 'string' ? r : (r.value || r.ui_name);
      if (!value) return '';
      const [w, h] = value.split(':').map(Number);
      if (!w || !h) return '';
      const scale = 14 / Math.max(w, h);
      const svgW = Math.round(w * scale * 10) / 10;
      const svgH = Math.round(h * scale * 10) / 10;
      const rectW = Math.max(svgW - 2, 1);
      const rectH = Math.max(svgH - 2, 1);
      return `<button class="effects-ratio-pill" data-ratio="${value}" title="${value}">
        <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="${rectW}" height="${rectH}" rx="1"/></svg>
        ${value}
      </button>`;
    }).join('');
  }

  _bindResizeHandle() {
    const handle = this.container.querySelector('#effectsResizeHandle');
    const picker = this.container.querySelector('#effectsPickerPanel');
    const left = this.container.querySelector('.effects-left');
    if (!handle || !picker || !left) return;

    let startY = 0;
    let startHeight = 0;
    let isDragging = false;

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const delta = startY - e.clientY;
      const newHeight = Math.max(120, Math.min(startHeight + delta, left.clientHeight - 150));
      picker.style.height = newHeight + 'px';
      picker.style.maxHeight = 'none';
    };

    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isDragging = true;
      startY = e.clientY;
      startHeight = picker.offsetHeight;
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EFFECTS LOADING
  // ═══════════════════════════════════════════════════════════════════════════

  async _loadEffects() {
    const grid = this.container.querySelector('#effectsGrid');
    const tabs = this.container.querySelector('#effectsCategoryTabs');

    try {
      // Offline: bỏ hẳn lời gọi API (mỗi lần mở window là 1 IPC vô ích + rủi ro rò request) — dùng
      // thẳng 9 effect hardcoded. KHÔNG return (render nằm sau try/catch). Nhất quán AngleEditor._loadPresets.
      if (self.SEOSONA_LOCAL_MODE !== false) {
        this._useHardcodedEffects();
      } else {
        // Try API first (chỉ khi online)
        const response = await this._fetchEffectsFromAPI();
        if (response?.success && response.data) {
          // response.data is grouped by category: { "Color Grading": [...], "Light": [...] }
          const grouped = response.data;
          const flat = [];
          for (const category of Object.keys(grouped)) {
            const items = grouped[category];
            if (Array.isArray(items)) flat.push(...items);
          }
          if (flat.length > 0) {
            this.state.effects = flat;
            this.state.effectsByCategory = grouped;
          } else {
            this._useHardcodedEffects();
          }
        } else {
          this._useHardcodedEffects();
        }
      }
    } catch (err) {
      console.warn('[EffectsEditor] API failed, using hardcoded:', err.message);
      this._useHardcodedEffects();
    }

    // Render category tabs
    const categories = Object.keys(this.state.effectsByCategory);
    if (categories.length > 0) {
      this.state.activeCategory = categories[0];
      tabs.innerHTML = categories.map(cat => `
        <button class="effects-category-tab ${cat === this.state.activeCategory ? 'active' : ''}" data-category="${cat}">
          ${cat}
        </button>
      `).join('');

      // Bind tab clicks
      tabs.querySelectorAll('.effects-category-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          this.state.activeCategory = tab.dataset.category;
          tabs.querySelectorAll('.effects-category-tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this._renderEffectsGrid();
        });
      });
    }

    this._renderEffectsGrid();
  }

  async _fetchEffectsFromAPI() {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'apiRequest',
        method: 'GET',
        endpoint: 'image-effects'
      }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(resp);
      });
    });
  }

  _useHardcodedEffects() {
    const effects = [
      // Color Grading
      { id: 1, name: 'Cinematic Film', slug: 'cinematic-film', category: 'Color Grading',
        base_prompt: 'Apply cinematic film color grading with orange and teal tones, {intensity} contrast, subtle film grain',
        intensity_keywords: { '25': 'very subtle', '50': 'moderate', '75': 'strong', '100': 'intense dramatic' }, default_intensity: 75 },
      { id: 2, name: 'Vintage 70s', slug: 'vintage-70s', category: 'Color Grading',
        base_prompt: 'Transform with 1970s vintage film look, {intensity} faded colors, warm yellow cast, light leaks',
        intensity_keywords: { '25': 'subtle', '50': 'noticeable', '75': 'prominent', '100': 'heavy' }, default_intensity: 65 },
      { id: 3, name: 'Film Noir', slug: 'film-noir', category: 'Color Grading',
        base_prompt: 'Convert to classic film noir style, {intensity} high contrast black and white, dramatic shadows',
        intensity_keywords: { '25': 'subtle', '50': 'balanced', '75': 'dramatic', '100': 'extreme' }, default_intensity: 80 },
      // Light
      { id: 10, name: 'Golden Hour', slug: 'golden-hour', category: 'Light',
        base_prompt: 'Apply golden hour lighting with warm orange-gold sunlight, {intensity} soft glow, lens flare',
        intensity_keywords: { '25': 'subtle hint of', '50': 'moderate', '75': 'prominent', '100': 'intense' }, default_intensity: 70 },
      { id: 11, name: 'Neon Glow', slug: 'neon-glow', category: 'Light',
        base_prompt: 'Add neon light glow effect with {intensity} pink and cyan rim lighting, cyberpunk atmosphere',
        intensity_keywords: { '25': 'subtle', '50': 'moderate', '75': 'vibrant', '100': 'intense' }, default_intensity: 75 },
      // Weather
      { id: 20, name: 'Rain', slug: 'rain', category: 'Weather',
        base_prompt: 'Add {intensity} rain effect with visible raindrops, wet reflective surfaces, moody atmosphere',
        intensity_keywords: { '25': 'light drizzle', '50': 'steady', '75': 'heavy', '100': 'torrential' }, default_intensity: 60 },
      { id: 21, name: 'Fog', slug: 'fog', category: 'Weather',
        base_prompt: 'Add {intensity} fog atmosphere, misty environment, mysterious ethereal mood',
        intensity_keywords: { '25': 'light haze', '50': 'moderate', '75': 'thick', '100': 'dense' }, default_intensity: 60 },
      // Artistic
      { id: 30, name: 'Watercolor', slug: 'watercolor', category: 'Artistic',
        base_prompt: 'Transform to watercolor painting style with {intensity} soft brush strokes, fluid colors',
        intensity_keywords: { '25': 'subtle', '50': 'moderate', '75': 'strong', '100': 'heavy' }, default_intensity: 75 },
      { id: 31, name: 'Oil Painting', slug: 'oil-painting', category: 'Artistic',
        base_prompt: 'Convert to oil painting with {intensity} visible brush strokes, rich textures, classical art style',
        intensity_keywords: { '25': 'subtle', '50': 'noticeable', '75': 'prominent', '100': 'heavy' }, default_intensity: 70 },
    ];

    this.state.effects = effects;
    this.state.effectsByCategory = effects.reduce((acc, e) => {
      if (!acc[e.category]) acc[e.category] = [];
      acc[e.category].push(e);
      return acc;
    }, {});
  }

  _renderEffectsGrid() {
    const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;
    const grid = this.container.querySelector('#effectsGrid');
    const categoryEffects = this.state.effectsByCategory[this.state.activeCategory] || [];

    if (categoryEffects.length === 0) {
      grid.innerHTML = `<div class="effects-empty">${t('effects.noCategory')}</div>`;
      return;
    }

    grid.innerHTML = categoryEffects.map(effect => `
      <div class="effects-card ${this.state.selectedEffect?.id === effect.id ? 'selected' : ''}"
           data-effect-id="${effect.id}">
        <div class="effects-card-thumb">
          ${effect.thumbnail_url
            ? `<img src="${effect.thumbnail_url}" alt="${effect.name}" />`
            : `<div class="effects-card-placeholder">${effect.name.charAt(0)}</div>`
          }
        </div>
        <div class="effects-card-name">${effect.name}</div>
      </div>
    `).join('');

    // Bind click events
    grid.querySelectorAll('.effects-card').forEach(card => {
      card.addEventListener('click', () => {
        const effectId = parseInt(card.dataset.effectId);
        const effect = this.state.effects.find(e => e.id === effectId);
        if (effect) {
          this._selectEffect(effect);
        }
      });
    });
  }

  _selectEffect(effect) {
    this.state.selectedEffect = effect;
    this.state.intensity = effect.default_intensity || 75;

    // Update UI
    this.container.querySelectorAll('.effects-card').forEach(card => {
      card.classList.toggle('selected', parseInt(card.dataset.effectId) === effect.id);
    });

    // Update intensity slider
    const slider = this.container.querySelector('#effectsIntensitySlider');
    if (slider) slider.value = this.state.intensity;
    this._updateIntensityDisplay();
    this._updatePromptPreview();
    this._updateGenerateButton();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IMAGE HANDLING
  // ═══════════════════════════════════════════════════════════════════════════

  _openImagePicker() {
    if (!window.imagePickerModal) {
      console.warn('[EffectsEditor] ImagePickerModal not initialized');
      return;
    }

    window.imagePickerModal.open({
      singleSelect: true,
      mediaFilter: 'image',
      onConfirm: async (selected) => {
        if (selected && selected.length > 0) {
          const img = selected[0];
          if (img.source === 'album') {
            // Album image → chuẩn bị ALIVE/STALE
            try {
              const prepared = await ImagePickerModal.prepareAlbumImageForRef(img);
              if (!prepared) return;
              const key = prepared.key;
              if (key.startsWith('upload_')) {
                // STALE: upload ngay + show uploading state
                const pendingFile = window.pendingUploadFiles?.get(key)?.file;
                if (pendingFile && window.ImmediateUploader) {
                  this._isAlbumUploading = true;
                  this._albumUploadKey = key;
                  ImmediateUploader.upload(pendingFile, img.thumbnail, { key }).catch(function (_e) { globalThis.SEOSONA_swallow?.('EffectsEditor#onConfirm', _e); });
                }
                // Listen upload:completed để update state eagerly
                const self = this;
                const uploadHandler = (data) => {
                  if (data.key === key) {
                    if (self.state.refImageId === key) {
                      self.state.refImageId = data.tile_id;
                      if (data.file_name) self.state.refFileName = data.file_name;
                      if (data.thumbnail_url) self.state.refThumbnail = data.thumbnail_url;
                      console.log('[EffectsEditor] Upload completed, updated ref:', data.tile_id);
                    }
                    self._isAlbumUploading = false;
                    self._albumUploadKey = null;
                    self._updateRefUploadingState();
                    self._updateGenerateButton();
                    window.eventBus?.off('upload:completed', uploadHandler);
                    window.eventBus?.off('upload:failed', failHandler);
                  }
                };
                const failHandler = (data) => {
                  if (data.key === key) {
                    console.warn('[EffectsEditor] Album upload failed:', data.error);
                    self._isAlbumUploading = false;
                    self._albumUploadKey = null;
                    self._updateRefUploadingState();
                    self._updateGenerateButton();
                    window.eventBus?.off('upload:completed', uploadHandler);
                    window.eventBus?.off('upload:failed', failHandler);
                  }
                };
                window.eventBus?.on('upload:completed', uploadHandler);
                window.eventBus?.on('upload:failed', failHandler);
              }
              this.state.refImageId = key;
              this.state.refThumbnail = img.thumbnail;
              this.state.refFileName = prepared.file_name || '';
            } catch (err) {
              console.error('[EffectsEditor] Lỗi chuẩn bị ảnh album:', err);
            }
          } else {
            this.state.refImageId = img.fileId || img.file_id || img.id;
            this.state.refThumbnail = img.thumbnail;
            this.state.refFileName = img.file_name || img.fileName;
          }
          this._updateRefImagePreview();
          this._updateRefUploadingState();
          this._updateGenerateButton();
        }
      }
    });
  }

  async _handleFileSelect(file) {
    if (!file) return;
    this._isUploading = true;
    this._updateGenerateButton();
    this._updateUploadZoneState();

    try {
      // Create thumbnail
      const thumbnail = await this._createThumbnail(file);

      // Generate temp key
      const key = 'effects_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

      // Upload via ImmediateUploader
      if (window.ImmediateUploader) {
        const result = await window.ImmediateUploader.upload(file, thumbnail, { key });
        if (result.success) {
          this.state.refImageId = result.tile_id || key;
          // Revoke old blob URL to prevent memory leak
          if (this.state.refThumbnail && this.state.refThumbnail.startsWith('blob:')) {
            URL.revokeObjectURL(this.state.refThumbnail);
          }
          this.state.refThumbnail = result.thumbnail_url || URL.createObjectURL(thumbnail);
          this.state.refFileName = result.file_name;
        }
      } else {
        // Fallback: just use blob
        this.state.refImageId = key;
        // Revoke old blob URL to prevent memory leak
        if (this.state.refThumbnail && this.state.refThumbnail.startsWith('blob:')) {
          URL.revokeObjectURL(this.state.refThumbnail);
        }
        this.state.refThumbnail = URL.createObjectURL(file);
        this.state.refFileName = null;
      }

      this._updateRefImagePreview();
    } catch (err) {
      console.error('[EffectsEditor] Upload failed:', err);
    } finally {
      this._isUploading = false;
      this._updateGenerateButton();
      this._updateUploadZoneState();
    }
  }

  async _createThumbnail(file) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const maxSize = 200;
          let w = img.width, h = img.height;
          if (w > h) { h = h * maxSize / w; w = maxSize; }
          else { w = w * maxSize / h; h = maxSize; }
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          canvas.toBlob(resolve, 'image/webp', 0.8);
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  _updateRefImagePreview() {
    const placeholder = this.container.querySelector('#effectsUploadPlaceholder');
    const preview = this.container.querySelector('#effectsUploadPreview');
    const img = this.container.querySelector('#effectsRefImage');

    if (this.state.refThumbnail) {
      placeholder?.classList.add('hidden');
      preview?.classList.remove('hidden');
      if (img) img.src = this.state.refThumbnail;
    } else {
      placeholder?.classList.remove('hidden');
      preview?.classList.add('hidden');
    }
  }

  _updateUploadZoneState() {
    const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;
    const zone = this.container.querySelector('#effectsUploadZone');
    if (!zone) return;

    if (this._isUploading) {
      zone.classList.add('uploading');
      const span = zone.querySelector('.effects-upload-placeholder span');
      if (span) span.textContent = t('effects.uploading');
    } else {
      zone.classList.remove('uploading');
      const span = zone.querySelector('.effects-upload-placeholder span');
      if (span) span.textContent = t('effects.clickToSelect');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROMPT BUILDING
  // ═══════════════════════════════════════════════════════════════════════════

  _buildPrompt() {
    const effect = this.state.selectedEffect;
    if (!effect) return '';

    const keywords = effect.intensity_keywords || {};
    const intensityWord = this._findNearestKeyword(this.state.intensity, keywords);

    return effect.base_prompt.replace('{intensity}', intensityWord);
  }

  _findNearestKeyword(value, keywords) {
    const keys = Object.keys(keywords).map(Number).sort((a, b) => a - b);
    if (keys.length === 0) return 'moderate';

    let nearest = keys[0];
    let minDiff = Math.abs(value - nearest);

    for (const key of keys) {
      const diff = Math.abs(value - key);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = key;
      }
    }

    return keywords[String(nearest)] || 'moderate';
  }

  _updateIntensityDisplay() {
    const valueEl = this.container.querySelector('#effectsIntensityValue');
    if (valueEl) valueEl.textContent = this.state.intensity + '%';
  }

  _updatePromptPreview() {
    const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;
    const preview = this.container.querySelector('#effectsPromptPreview');
    if (!preview) return;

    const prompt = this._buildPrompt();
    if (prompt) {
      preview.value = prompt;
      preview.placeholder = '';
      this.state.builtPrompt = prompt;
    } else {
      preview.value = '';
      preview.placeholder = t('effects.selectEffectPreview');
      this.state.builtPrompt = '';
    }
  }

  _updateRefUploadingState() {
    const preview = this.container.querySelector('#effectsUploadPreview');
    if (!preview) return;

    if (this._isAlbumUploading) {
      preview.classList.add('effects-ref-uploading');
    } else {
      preview.classList.remove('effects-ref-uploading');
    }
  }

  _updateGenerateButton() {
    const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;
    const btn = this.container.querySelector('#effectsGenerateBtn');
    if (!btn) return;

    const canGenerate = this.state.refImageId && this.state.selectedEffect && !this._isUploading && !this._isAlbumUploading;
    btn.disabled = !canGenerate || this.state.isGenerating;

    if (this._isAlbumUploading) {
      btn.classList.add('is-generating');
      btn.innerHTML = `
        <svg class="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        <span>${t('effects.uploadingBtn')}</span>
      `;
    } else if (this.state.isGenerating) {
      btn.classList.add('is-generating');
      btn.innerHTML = `
        <svg class="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
        </svg>
        <span>${t('effects.generating')}</span>
      `;
    } else {
      btn.classList.remove('is-generating');
      btn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z"></path><path d="M4.6519 14.7568L4.82063 14.2084C4.84491 14.1295 4.91781 14.0757 5.00037 14.0757C5.08292 14.0757 5.15582 14.1295 5.1801 14.2084L5.34883 14.7568C5.56525 15.4602 6.11587 16.0108 6.81925 16.2272L7.36762 16.3959C7.44652 16.4202 7.50037 16.4931 7.50037 16.5757C7.50037 16.6582 7.44652 16.7311 7.36762 16.7554L6.81926 16.9241C6.11587 17.1406 5.56525 17.6912 5.34883 18.3946L5.1801 18.9429C5.15582 19.0218 5.08292 19.0757 5.00037 19.0757C4.91781 19.0757 4.84491 19.0218 4.82063 18.9429L4.65191 18.3946C4.43548 17.6912 3.88486 17.1406 3.18147 16.9241L2.63311 16.7554C2.55421 16.7311 2.50037 16.6582 2.50037 16.5757C2.50037 16.4931 2.55421 16.4202 2.63311 16.3959L3.18148 16.2272C3.88486 16.0108 4.43548 15.4602 4.6519 14.7568Z"></path></svg>
        <span>${t('effects.generate')}</span>
      `;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  _initExecution() {
    if (window.EffectsExecution) {
      this.execution = new EffectsExecution(this);
      window.effectsExecution = this.execution;
    }
  }

  /**
   * Update quota display showing runs used/limit and global prompts used/limit
   */
  async _updateQuotaDisplay() {
    const runsEl = this.container.querySelector('#effectsQuotaRuns .effects-quota-value');
    const promptsEl = this.container.querySelector('#effectsQuotaPrompts .effects-quota-value');

    // Get effects_run_max quota
    if (window.featureGate && runsEl) {
      try {
        const runQuota = await window.featureGate.checkQuotaAsync('effects_run_max');
        const limitText = runQuota.limit === 'unlimited' ? '∞' : runQuota.limit;
        runsEl.textContent = `${runQuota.used}/${limitText}`;
        const runsItem = this.container.querySelector('#effectsQuotaRuns');
        if (runQuota.limit !== 'unlimited' && runQuota.used >= runQuota.limit) {
          runsItem?.classList.add('effects-quota-exhausted');
          runsItem?.classList.remove('effects-quota-warning');
        } else if (runQuota.limit !== 'unlimited' && runQuota.used >= runQuota.limit * 0.8) {
          runsItem?.classList.add('effects-quota-warning');
          runsItem?.classList.remove('effects-quota-exhausted');
        } else {
          runsItem?.classList.remove('effects-quota-warning', 'effects-quota-exhausted');
        }
      } catch (e) {
        console.warn('[EffectsEditor] Failed to get run quota:', e.message);
      }
    }

    // Get prompt_submit_max quota (global)
    if (window.featureGate && promptsEl) {
      try {
        const promptQuota = await window.featureGate.checkQuotaAsync('prompt_submit_max');
        const limitText = promptQuota.limit === 'unlimited' ? '∞' : promptQuota.limit;
        promptsEl.textContent = `${promptQuota.used}/${limitText}`;
        const promptsItem = this.container.querySelector('#effectsQuotaPrompts');
        if (promptQuota.limit !== 'unlimited' && promptQuota.used >= promptQuota.limit) {
          promptsItem?.classList.add('effects-quota-exhausted');
          promptsItem?.classList.remove('effects-quota-warning');
        } else if (promptQuota.limit !== 'unlimited' && promptQuota.used >= promptQuota.limit * 0.8) {
          promptsItem?.classList.add('effects-quota-warning');
          promptsItem?.classList.remove('effects-quota-exhausted');
        } else {
          promptsItem?.classList.remove('effects-quota-warning', 'effects-quota-exhausted');
        }
      } catch (e) {
        console.warn('[EffectsEditor] Failed to get prompt quota:', e.message);
      }
    }
  }

  async _runGeneration() {
    if (!this.state.refImageId || !this.state.selectedEffect) return;
    if (this.state.isGenerating) return;

    // Client-side quota check (fast UX — server enforces via ExecutionGate)
    if (window.featureGate) {
      const canRun = await window.featureGate.canRunEffectsAsync?.() ?? window.featureGate.canUse('effects_run_max');
      if (canRun === false || canRun === 0) {
        const isLoggedIn = true;
        if (isLoggedIn) {
          const confirmed = await window.customDialog?.confirm(
            window.I18n?.t('effects.quotaExhaustedLoggedIn') || 'Bạn đã sử dụng hết lượt tạo Effects hôm nay. Nâng cấp gói để không giới hạn.',
            { title: window.I18n?.t('effects.quotaExhaustedTitle') || 'Đã hết lượt', type: 'warning', confirmText: window.I18n?.t('upgrade.upgradeNow') || 'Nâng cấp', cancelText: window.I18n?.t('common.later') || 'Để sau' }
          );
          /* upgrade modal removed — local-first; confirm is now informational only */
          void confirmed;
        } else {
          const confirmed = await window.customDialog?.confirm(
            window.I18n?.t('effects.quotaExhaustedTrial') || 'Bạn đã sử dụng hết lượt tạo Effects trong bản dùng thử.\n\nĐăng nhập để tiếp tục sử dụng.',
            { title: window.I18n?.t('effects.quotaExhaustedTrialTitle') || 'Đã hết lượt dùng thử', type: 'warning', confirmText: window.I18n?.t('auth.googleLogin') || 'Đăng nhập với Google', cancelText: window.I18n?.t('common.later') || 'Để sau' }
          );
          if (confirmed && window.authManager?.loginWithGoogle) {
            console.log('Login bypassed');
          }
        }
        return;
      }
    }

    this._activeGenCount++;
    this.state.isGenerating = true;
    this._updateGenerateButton();

    const currentRatio = this.state.ratio || '9:16';
    this._addLoadingCard(currentRatio);

    // Setup callback to unlock UI immediately after submit succeeds
    // (không cần chờ kết quả trả về - user có thể click Generate tiếp)
    // Note: Callback CHỈ unlock UI, không decrement _activeGenCount (để finally làm)
    if (this.execution) {
      this.execution._onSubmittedCallback = () => {
        this.state.isGenerating = false;
        this._updateGenerateButton();
      };
    }

    try {
      const prompt = this._buildPrompt();
      const result = await this.execution?.runGeneration({
        refImageId: this.state.refImageId,
        refFileName: this.state.refFileName,
        prompt,
        model: this.state.model,
        ratio: currentRatio,
        effectName: this.state.selectedEffect.name
      });

      this._removeLoadingCards();

      if (result?.thumbnails?.length > 0) {
        this._addResults(result.thumbnails, prompt, currentRatio);
      }
    } catch (err) {
      this._removeLoadingCards();
      console.error('[EffectsEditor] Generation failed:', err);
      // Show user-friendly error for quota/permission errors
      if (err.message?.includes('hết lượt') || err.message?.includes('bị khóa') || err.message?.includes('Không được phép')) {
        const isLoggedIn = true;
        if (isLoggedIn) {
          const confirmed = await window.customDialog?.confirm(
            window.I18n?.t('effects.quotaExhaustedLoggedIn') || 'Bạn đã sử dụng hết lượt tạo Effects hôm nay. Nâng cấp gói để không giới hạn.',
            { title: window.I18n?.t('effects.quotaExhaustedTitle') || 'Đã hết lượt', type: 'warning', confirmText: window.I18n?.t('upgrade.upgradeNow') || 'Nâng cấp', cancelText: window.I18n?.t('common.later') || 'Để sau' }
          );
          /* upgrade modal removed — local-first; confirm is now informational only */
          void confirmed;
        } else {
          const confirmed = await window.customDialog?.confirm(
            window.I18n?.t('effects.quotaExhaustedTrial') || 'Bạn đã sử dụng hết lượt tạo Effects trong bản dùng thử.\n\nĐăng nhập để tiếp tục sử dụng.',
            { title: window.I18n?.t('effects.quotaExhaustedTrialTitle') || 'Đã hết lượt dùng thử', type: 'warning', confirmText: window.I18n?.t('auth.googleLogin') || 'Đăng nhập với Google', cancelText: window.I18n?.t('common.later') || 'Để sau' }
          );
          if (confirmed && window.authManager?.loginWithGoogle) {
            console.log('Login bypassed');
          }
        }
      }
    } finally {
      this._activeGenCount--;
      if (this._activeGenCount <= 0) {
        this._activeGenCount = 0;
        this.state.isGenerating = false;
      }
      this._updateGenerateButton();
      // Clear callback sau khi generation này hoàn thành
      if (this.execution) {
        this.execution._onSubmittedCallback = null;
      }
      // Update quota display after generation
      this._updateQuotaDisplay();
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESULTS
  // ═══════════════════════════════════════════════════════════════════════════

  _addResults(thumbnails, prompt, ratio) {
    const newResults = thumbnails.map((thumb, i) => ({
      id: 'result_' + Date.now() + '_' + i,
      thumbnail: thumb.thumbnail || thumb,
      tileId: thumb.tileId,
      fileName: thumb.file_name,
      prompt,
      ratio: ratio || '9:16',
      timestamp: Date.now()
    }));

    this.state.results = [...newResults, ...this.state.results];
    this._renderResults();
    this._saveResults();
  }

  _renderResults() {
    const emptyState = this.container.querySelector('#effectsEmptyState');
    const grid = this.container.querySelector('#effectsResultsGrid');

    if (this.state.results.length === 0) {
      emptyState?.classList.remove('hidden');
      if (grid) grid.innerHTML = '';
      return;
    }

    emptyState?.classList.add('hidden');
    grid.innerHTML = this.state.results.map(result => {
      const cssRatio = this._ratioToCss(result.ratio);
      return `
      <div class="effects-result-card" data-result-id="${result.id}">
        <div class="effects-result-thumb" style="aspect-ratio: ${cssRatio}">
          <img src="${result.thumbnail}" alt="Result" />
        </div>
        <div class="effects-result-actions">
          <button class="effects-result-action" data-action="download" title="${window.I18n?.t('common.download') || 'Tải xuống'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </button>
          <button class="effects-result-action" data-action="delete" title="${window.I18n?.t('common.delete') || 'Xóa'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>`;
    }).join('');

    // Bind actions
    grid.querySelectorAll('.effects-result-action').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const card = btn.closest('.effects-result-card');
        const resultId = card?.dataset.resultId;
        const action = btn.dataset.action;

        if (action === 'download') {
          this._downloadResult(resultId);
        } else if (action === 'delete') {
          this._deleteResult(resultId);
        }
      });
    });
  }

  _downloadResult(resultId) {
    const result = this.state.results.find(r => r.id === resultId);
    if (!result || !result.tileId) return;

    this.execution?.downloadImage(result.tileId, result.fileName);
  }

  _deleteResult(resultId) {
    this.state.results = this.state.results.filter(r => r.id !== resultId);
    this._renderResults();
    this._saveResults();
  }

  _clearResults() {
    this.state.results = [];
    this._renderResults();
    this._saveResults();
  }

  async _downloadAll() {
    for (const result of this.state.results) {
      if (result.tileId) {
        this.execution?.downloadImage(result.tileId, result.fileName);
        await new Promise(r => setTimeout(r, 500));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════════

  _saveResults() {
    chrome.storage.local.set({
      af_effects_results: this.state.results.slice(0, 50) // Keep last 50
    });
  }

  _loadSavedResults() {
    chrome.storage.local.get(['af_effects_results'], (res) => {
      if (res.af_effects_results?.length > 0) {
        this.state.results = res.af_effects_results;
        this._renderResults();
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOADING CARDS
  // ═══════════════════════════════════════════════════════════════════════════

  _addLoadingCard(ratio) {
    const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;
    const grid = this.container.querySelector('#effectsResultsGrid');
    const emptyState = this.container.querySelector('#effectsEmptyState');
    if (!grid) return;
    emptyState?.classList.add('hidden');

    const cssRatio = this._ratioToCss(ratio);
    const card = document.createElement('div');
    card.className = 'effects-result-card effects-loading-card';
    card.innerHTML = `
      <div class="effects-result-thumb" style="aspect-ratio: ${cssRatio}">
        <div class="effects-result-skeleton">
          <svg class="effects-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          <span>${t('effects.generating')}</span>
        </div>
      </div>
    `;
    // Insert at beginning
    grid.insertBefore(card, grid.firstChild);
  }

  _removeLoadingCards() {
    const grid = this.container.querySelector('#effectsResultsGrid');
    if (!grid) return;
    grid.querySelectorAll('.effects-loading-card').forEach(el => el.remove());
  }

  _ratioToCss(ratio) {
    const map = {
      '16:9': '16/9',
      '4:3': '4/3',
      '1:1': '1',
      '3:4': '3/4',
      '9:16': '9/16',
      // Legacy values
      'Ngang': '16/9',
      'Dọc': '9/16',
      'Vuông': '1',
      'Giữ nguyên': '1'
    };
    return map[ratio] || '9/16';
  }

  /**
   * Convert ratio to Flow format
   */
  _ratioToFlow(ratio) {
    // Flow now uses same format: 16:9, 4:3, 1:1, 3:4, 9:16
    // Keep legacy support
    const map = {
      'Dọc': '9:16',
      'Ngang': '16:9',
      'Vuông': '1:1'
    };
    return map[ratio] || ratio;
  }

  /**
   * Load default settings from GenTab (chrome.storage.local seosona_gentab_state)
   */
  _loadDefaultSettings() {
    chrome.storage.local.get(['seosona_gentab_state'], (res) => {
      const presets = res.seosona_gentab_state || {};

      // Set default model from GenTab settings
      if (presets.imageModel) {
        this.state.model = presets.imageModel;
        const modelSelect = this.container.querySelector('#effectsModelSelect');
        if (modelSelect) {
          // Check if option exists, if not keep empty (default from Settings)
          const hasOption = Array.from(modelSelect.options).some(opt => opt.value === presets.imageModel);
          if (hasOption) {
            modelSelect.value = presets.imageModel;
          }
        }
      }

      // Set default ratio from GenTab settings
      if (presets.aspectRatio) {
        // Convert Flow format to our format
        const ratioMap = { 'Dọc': '9:16', 'Ngang': '16:9', 'Vuông': '1:1' };
        const convertedRatio = ratioMap[presets.aspectRatio] || presets.aspectRatio;

        // Only set if it's one of our options
        if (convertedRatio === '9:16' || convertedRatio === '16:9') {
          this.state.ratio = convertedRatio;
          // Update ratio pills UI
          this.container.querySelectorAll('.effects-ratio-pill').forEach(pill => {
            pill.classList.toggle('active', pill.dataset.ratio === convertedRatio);
          });
        }
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CLEANUP
  // ═══════════════════════════════════════════════════════════════════════════

  cleanup() {
    // Cleanup any pending operations
  }
}

// Export
window.EffectsEditor = EffectsEditor;
