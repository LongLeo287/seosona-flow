/**
 * AngleEditor — Main controller for the Angles Editor popup window.
 * Provides UI for uploading a reference image, choosing camera angles,
 * and generating multi-angle variations via Google Flow.
 */
class AngleEditor {
  constructor(container) {
    this.container = container;
    this.state = {
      refImageId: null,
      refThumbnail: null,
      rotation: 0,
      tilt: 0,
      zoom: 0,
      preset: null,
      presets: [],
      results: [],
      isGenerating: false,
      builtPrompt: '',
      ratio: '9:16',
      model: ''
    };
    this._tileCache = new Map();
    this._orbitDragging = false;
    this._isUploading = false;
    this._activeGenCount = 0; // Track concurrent generations
    this.execution = null; // Set after AngleExecution loads

    this.render();
    this._bindEvents();
    this._loadPresets();
    this._initExecution();
    this._loadSavedResults();
    this._updateQuotaDisplay();

    // Listen for featuregate changes (SSE → storage → popup)
    window.eventBus?.on('featuregate:refreshed', () => this._updateQuotaDisplay());
  }

  // Hardcoded fallback preset when API is unavailable
  static get DEFAULT_PRESET() {
    return {
      id: 0,
      name: 'Portrait Re-angle',
      slug: 'portrait-reangle',
      base_prompt: 'Recreate this exact subject, camera positioned {angle_modifier}, {tilt_modifier}, {zoom_modifier}. Maintain identical appearance, clothing, colors, and all details. Same lighting and background style.',
      angle_modifiers: {
        rotation_keywords: {
          '-180': 'directly behind the subject, showing the back',
          '-135': 'behind and to the left of the subject, three-quarter back view',
          '-90': 'to the left of the subject, left profile view',
          '-45': 'slightly to the left of the subject, three-quarter front view from the left',
          '0': 'directly in front of the subject, frontal view facing the camera',
          '45': 'slightly to the right of the subject, three-quarter front view from the right',
          '90': 'to the right of the subject, right profile view',
          '135': 'behind and to the right of the subject, three-quarter back view',
          '180': 'directly behind the subject, showing the back'
        },
        tilt_keywords: {
          '-60': 'very low near the ground looking up at the subject',
          '-30': 'low looking up at the subject',
          '0': 'at eye level with the subject',
          '30': 'above looking down at the subject',
          '60': 'high above looking down at the subject',
          '90': 'directly above the subject, top-down view'
        },
        zoom_keywords: {
          '-2': 'far away, extreme wide shot showing full environment',
          '-1': 'wide shot, full body visible',
          '0': 'medium shot, waist up',
          '1': 'close-up on face and shoulders',
          '2': 'extreme close-up, macro detail'
        }
      },
      // Strict Server-Only: model từ ModelRegistry (server-driven default), cache miss → null.
      default_settings: {
        media_type: 'Image',
        model: window.ModelRegistry?.safeGetDefault?.('flow', 'image') || null,
        ratio: 'Vuông'
      }
    };
  }

  render() {
    const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;

    this.container.innerHTML = `
      <div class="angles-editor">
        <div class="angles-header">
          <div class="angles-header-left">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="22" y1="12" x2="18" y2="12"/>
              <line x1="6" y1="12" x2="2" y2="12"/>
              <line x1="12" y1="6" x2="12" y2="2"/>
              <line x1="12" y1="22" x2="12" y2="18"/>
            </svg>
            <h1>${t('angles.title')}</h1>
          </div>
          <div class="angles-header-right">
            <div class="angles-quota-display" id="anglesQuotaDisplay">
              <div class="angles-quota-item" id="anglesQuotaRuns" title="${t('angles.runsToday')}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                <span class="angles-quota-label">${t('angles.quotaRuns') || 'Runs'}</span>
                <span class="angles-quota-value">--/--</span>
              </div>
              <span class="angles-quota-sep">&bull;</span>
              <div class="angles-quota-item" id="anglesQuotaPrompts" title="${t('angles.promptsToday')}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
                <span class="angles-quota-label">${t('angles.quotaPrompts') || 'Prompts'}</span>
                <span class="angles-quota-value">--/--</span>
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" id="anglesClearBtn">${t('angles.clearResults')}</button>
            <button class="btn btn-secondary btn-sm" id="anglesDownloadAllBtn">${t('angles.downloadAll')}</button>
            <button class="btn btn-secondary btn-sm" id="anglesCloseBtn">${t('angles.close')}</button>
          </div>
        </div>
        <div class="angles-content">
          <div class="angles-results" id="anglesResultsPanel">
            <div class="angles-empty-state" id="anglesEmptyState">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <p>${t('angles.selectImageAndAngle')}</p>
            </div>
            <div class="angles-results-grid" id="anglesResultsGrid"></div>
          </div>
          <div class="angles-control" id="anglesControlPanel">
            <!-- Upload zone (compact) -->
            <div class="angles-section">
              <label class="angles-section-label">${t('angles.sourceImage')}</label>
              <div class="angles-upload-zone angles-upload-compact" id="anglesUploadZone">
                <div class="angles-upload-placeholder" id="anglesUploadPlaceholder">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  <span>${t('angles.clickToSelect')}</span>
                </div>
                <div class="angles-upload-preview hidden" id="anglesUploadPreview">
                  <img id="anglesRefImage" alt="${t('angles.sourceImage')}" />
                  <div class="angles-upload-actions">
                    <button class="angles-upload-change" id="anglesChangeImage" title="${t('angles.changeImage')}">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                      </svg>
                    </button>
                    <button class="angles-upload-remove" id="anglesRemoveImage" title="${t('angles.removeImage') || 'Xóa ảnh'}">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                </div>
                <input type="file" id="anglesFileInput" accept="image/*" style="display:none" />
              </div>
            </div>

            <!-- 3D Camera Visualizer + Sliders -->
            <div class="angles-section">
              <label class="angles-section-label" id="anglesCameraLabel">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -1px; margin-right: 2px;">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                ${t('angles.cameraAngle')}
              </label>
              <div class="angles-3d-container">
                <span class="angles-orbit-hint">${t('angles.dragToChange')}</span>
                <canvas id="anglesOrbitCanvas" width="280" height="200"></canvas>
              </div>
              <div class="angles-sliders-row">
                <div class="angles-slider-group">
                  <div class="angles-slider-header">
                    <span>${t('angles.rotation')}</span>
                    <span class="angles-slider-value" id="anglesRotationValue">0°</span>
                  </div>
                  <input type="range" class="angles-slider" id="anglesRotation" min="-180" max="180" value="0" step="15" />
                </div>
                <div class="angles-slider-group">
                  <div class="angles-slider-header">
                    <span>${t('angles.tilt')}</span>
                    <span class="angles-slider-value" id="anglesTiltValue">0°</span>
                  </div>
                  <input type="range" class="angles-slider" id="anglesTilt" min="-60" max="90" value="0" step="15" />
                </div>
                <div class="angles-slider-group">
                  <div class="angles-slider-header">
                    <span>${t('angles.zoom')}</span>
                    <span class="angles-slider-value" id="anglesZoomValue">0</span>
                  </div>
                  <input type="range" class="angles-slider" id="anglesZoom" min="-2" max="2" value="0" step="1" />
                </div>
              </div>
            </div>

            <!-- Prompt preview (collapsible toggle) -->
            <div class="angles-section">
              <button class="angles-toggle-header" id="anglesPromptToggle" type="button">
                <span class="angles-section-label">${t('angles.promptPreview')}</span>
                <svg class="angles-toggle-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div class="angles-toggle-content hidden" id="anglesPromptToggleContent">
                <textarea class="angles-prompt-preview" id="anglesPromptPreview" readonly rows="4"></textarea>
              </div>
            </div>

            <!-- Prompt Model (preset) -->
            <div class="angles-section">
              <label class="angles-section-label">${t('angles.promptModel')}</label>
              <div class="input-group select-group">
                <select id="anglesPresetSelect" class="angles-preset-select">
                  <option value="">${t('angles.loading')}</option>
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>

            <!-- Model selector -->
            <div class="angles-section">
              <label class="angles-section-label">${t('angles.model')}</label>
              <div class="input-group select-group">
                <select id="anglesModelSelect" class="angles-preset-select">
                  <option value="">${t('angles.defaultModel')}</option>
                  ${(window.ModelRegistry?.getModelsSync('flow', 'image') || [{ name: 'Nano Banana Pro', value: 'Nano Banana Pro' }, { name: 'Nano Banana 2', value: 'Nano Banana 2' }]).map(m => `<option value="${m.value}">${m.name}</option>`).join('')}
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>

            <!-- Ratio selector — dynamic build từ ProviderConfigManager.getRatiosSync('flow', 'image') -->
            <div class="angles-section">
              <label class="angles-section-label">${t('angles.ratio')}</label>
              <div class="angles-ratio-pills" id="anglesRatioPills">${this._buildRatioPillsHtml()}</div>
            </div>

            <!-- Generate button -->
            <div class="angles-section angles-section-generate">
              <button class="angles-generate-btn" id="anglesGenerateBtn" disabled>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M11.8525 4.21651L11.7221 3.2387C11.6906 3.00226 11.4889 2.82568 11.2504 2.82568C11.0118 2.82568 10.8102 3.00226 10.7786 3.23869L10.6483 4.21651C10.2658 7.0847 8.00939 9.34115 5.14119 9.72358L4.16338 9.85396C3.92694 9.88549 3.75037 10.0872 3.75037 10.3257C3.75037 10.5642 3.92694 10.7659 4.16338 10.7974L5.14119 10.9278C8.00938 11.3102 10.2658 13.5667 10.6483 16.4349L10.7786 17.4127C10.8102 17.6491 11.0118 17.8257 11.2504 17.8257C11.4889 17.8257 11.6906 17.6491 11.7221 17.4127L11.8525 16.4349C12.2349 13.5667 14.4913 11.3102 17.3595 10.9278L18.3374 10.7974C18.5738 10.7659 18.7504 10.5642 18.7504 10.3257C18.7504 10.0872 18.5738 9.88549 18.3374 9.85396L17.3595 9.72358C14.4913 9.34115 12.2349 7.0847 11.8525 4.21651Z"></path><path d="M4.6519 14.7568L4.82063 14.2084C4.84491 14.1295 4.91781 14.0757 5.00037 14.0757C5.08292 14.0757 5.15582 14.1295 5.1801 14.2084L5.34883 14.7568C5.56525 15.4602 6.11587 16.0108 6.81925 16.2272L7.36762 16.3959C7.44652 16.4202 7.50037 16.4931 7.50037 16.5757C7.50037 16.6582 7.44652 16.7311 7.36762 16.7554L6.81926 16.9241C6.11587 17.1406 5.56525 17.6912 5.34883 18.3946L5.1801 18.9429C5.15582 19.0218 5.08292 19.0757 5.00037 19.0757C4.91781 19.0757 4.84491 19.0218 4.82063 18.9429L4.65191 18.3946C4.43548 17.6912 3.88486 17.1406 3.18147 16.9241L2.63311 16.7554C2.55421 16.7311 2.50037 16.6582 2.50037 16.5757C2.50037 16.4931 2.55421 16.4202 2.63311 16.3959L3.18148 16.2272C3.88486 16.0108 4.43548 15.4602 4.6519 14.7568Z"></path></svg>
                <span>${t('angles.generate')}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ===== Event Bindings =====

  _bindEvents() {
    const $ = id => this.container.querySelector('#' + id);

    // Prompt toggle
    const promptToggle = $('anglesPromptToggle');
    const promptToggleContent = $('anglesPromptToggleContent');
    if (promptToggle && promptToggleContent) {
      promptToggle.addEventListener('click', () => {
        promptToggleContent.classList.toggle('hidden');
        promptToggle.classList.toggle('open');
      });
    }

    // Upload zone: click to open ImagePickerModal (select from Flow or upload)
    const uploadZone = $('anglesUploadZone');
    const fileInput = $('anglesFileInput');

    uploadZone.addEventListener('click', (e) => {
      // Don't re-trigger if clicking the change/remove buttons
      if (e.target.closest('#anglesChangeImage') || e.target.closest('#anglesRemoveImage')) return;
      this._openImagePicker();
    });

    // Drag-drop
    uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      uploadZone.classList.remove('dragover');
      const file = e.dataTransfer?.files?.[0];
      if (file && file.type.startsWith('image/')) {
        this._handleFileUpload(file);
      }
    });

    // File input change
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) {
        this._handleFileUpload(file);
        fileInput.value = ''; // Reset for re-selection of same file
      }
    });

    // Change image button
    $('anglesChangeImage').addEventListener('click', (e) => {
      e.stopPropagation();
      this._openImagePicker();
    });

    // Remove image button
    $('anglesRemoveImage')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this._clearRefImage();
    });

    // Model select
    const modelSelect = $('anglesModelSelect');
    if (modelSelect) {
      modelSelect.addEventListener('change', () => {
        this.state.model = modelSelect.value;
      });
    }

    // Sliders
    const rotationSlider = $('anglesRotation');
    const tiltSlider = $('anglesTilt');
    const zoomSlider = $('anglesZoom');

    rotationSlider.addEventListener('input', () => {
      this.state.rotation = parseInt(rotationSlider.value, 10);
      $('anglesRotationValue').textContent = this.state.rotation + '°';
      this._updateOrbitPicker();
      this._buildPrompt();
    });

    tiltSlider.addEventListener('input', () => {
      this.state.tilt = parseInt(tiltSlider.value, 10);
      $('anglesTiltValue').textContent = this.state.tilt + '°';
      this._updateOrbitPicker();
      this._buildPrompt();
    });

    zoomSlider.addEventListener('input', () => {
      this.state.zoom = parseInt(zoomSlider.value, 10);
      $('anglesZoomValue').textContent = this.state.zoom.toString();
      this._buildPrompt();
    });

    // Preset select
    $('anglesPresetSelect').addEventListener('change', (e) => {
      const presetId = e.target.value;
      if (presetId) {
        this._loadPreset(parseInt(presetId, 10));
      }
    });

    // Ratio pills
    this._initRatioPills();

    // Generate button
    $('anglesGenerateBtn').addEventListener('click', () => {
      if (!this.state.isGenerating) {
        this._runGeneration();
      }
    });

    // Close button
    $('anglesCloseBtn').addEventListener('click', () => {
      this._cleanupRefCache();
      window.close();
    });

    // Also cleanup on window unload
    window.addEventListener('beforeunload', () => {
      this._cleanupRefCache();
    });

    // Clear results
    $('anglesClearBtn').addEventListener('click', () => {
      this._clearResults();
    });

    // Download all
    $('anglesDownloadAllBtn').addEventListener('click', () => {
      this._downloadAll();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        window.close();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!this.state.isGenerating) {
          this._runGeneration();
        }
      }
    });

    // Bind orbit picker interaction
    this._bindOrbitPicker();

    // Initial orbit render
    this._renderOrbitPicker();
  }

  // ===== Image Picker (Flow images or local upload) =====

  _openImagePicker() {
    if (typeof ImagePickerModal === 'undefined') {
      // Fallback: open file picker directly
      this.container.querySelector('#anglesFileInput')?.click();
      return;
    }
    if (!this._imagePicker) {
      this._imagePicker = new ImagePickerModal();
    }
    this._imagePicker.open({
      singleSelect: true,
      existingFileIds: this.state.refImageId ? [this.state.refImageId] : [],
      onConfirm: async (images) => {
        if (!images || images.length === 0) return;
        const img = images[0];
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
                ImmediateUploader.upload(pendingFile, img.thumbnail, { key }).catch(function (_e) { globalThis.SEOSONA_swallow?.('AngleEditor#onConfirm', _e); });
              }
              // Listen upload:completed / failed để update state
              const self = this;
              const uploadHandler = (data) => {
                if (data.key === key) {
                  if (self.state.refImageId === key) {
                    self.state.refImageId = data.tile_id;
                    if (data.file_name) self.state.refFileName = data.file_name;
                    console.log('[AngleEditor] Upload completed, updated ref:', data.tile_id);
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
                  console.warn('[AngleEditor] Album upload failed:', data.error);
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
            this.state.refFileName = prepared.file_name || '';
            this._useFlowImage(key, img.thumbnail);
            this._updateRefUploadingState();
          } catch (err) {
            console.error('[AngleEditor] Lỗi chuẩn bị ảnh album:', err);
          }
        } else if (img.source === 'upload' && img.file) {
          // Local upload file → go through normal upload flow
          this._handleFileUpload(img.file);
        } else if (img.fileId) {
          // Flow image already on page → use directly
          this._useFlowImage(img.fileId, img.thumbnail);
        }
      }
    });
  }

  _useFlowImage(fileId, thumbnail) {
    const placeholder = this.container.querySelector('#anglesUploadPlaceholder');
    const preview = this.container.querySelector('#anglesUploadPreview');
    const imgEl = this.container.querySelector('#anglesRefImage');

    placeholder.classList.add('hidden');
    preview.classList.remove('hidden');
    if (thumbnail) {
      imgEl.src = thumbnail;
      this.state.refThumbnail = thumbnail;
      this._loadRefThumbForOrbit();
    }
    this.state.refImageId = fileId;
    this._buildPrompt();
    this._updateGenerateButton();
    console.log('[AngleEditor] Using Flow image:', fileId);
  }

  // ===== File Upload =====

  _handleFileUpload(file) {
    if (!file || !file.type.startsWith('image/')) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;

      // Show thumbnail preview immediately
      const placeholder = this.container.querySelector('#anglesUploadPlaceholder');
      const preview = this.container.querySelector('#anglesUploadPreview');
      const img = this.container.querySelector('#anglesRefImage');
      placeholder.classList.add('hidden');
      preview.classList.remove('hidden');
      img.src = dataUrl;
      this.state.refThumbnail = dataUrl;
      this._loadRefThumbForOrbit();

      // Mark uploading — generate button must stay disabled
      this._isUploading = true;
      this._updateGenerateButton();

      // Disable controls + show uploading state
      this._setControlsDisabled(true, window.I18n?.t('angles.uploadingToFlow') || 'Đang upload ảnh lên Flow...');

      // Prepare pending upload entry
      const uploadId = 'upload_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
      window.pendingUploadFiles.set(uploadId, { file, thumbnail: dataUrl, name: file.name, timestamp: Date.now() });
      // S2: Upload ngay nếu Flow tab mở, hoặc lưu lightweight pending
      if (window.ImmediateUploader) {
        ImmediateUploader.upload(file, dataUrl, { key: uploadId }).catch(function (_e) { globalThis.SEOSONA_swallow?.('AngleEditor#onload', _e); });
      } else if (window.PendingUploadStore) {
        PendingUploadStore.saveLightweight(uploadId, { thumbnail: dataUrl, fileName: file.name, fileSize: file.size, fileType: file.type }).catch(function (_e) { globalThis.SEOSONA_swallow?.('AngleEditor#onload', _e); });
      }

      try {
        // Upload to Flow via FileUploader (MessageBridge)
        let realFileId = null;
        if (typeof window.uploadPendingFiles === 'function') {
          const result = await window.uploadPendingFiles(uploadId);
          const resultId = result?.split(',').map(s => s.trim()).filter(Boolean)[0];
          if (resultId && !resultId.startsWith('upload_')) {
            realFileId = resultId;
            console.log('[AngleEditor] Upload trả về file_id:', realFileId);
          }
        }

        // Capture file_name từ MediaRegistry (populated by FileUploader.uploadPendingFiles)
        // CRITICAL: file_name (UUID) cần cho cross-project validation sau reload
        if (realFileId && MediaRegistry.getFileName(realFileId)) {
          this.state.refFileName = MediaRegistry.getFileName(realFileId);
          console.log('[AngleEditor] Captured file_name:', this.state.refFileName?.substring(0, 12) + '...');
        }

        if (!realFileId) {
          console.error('[AngleEditor] Upload ảnh lên Flow thất bại');
          this.state.refImageId = null;
          this.state.refThumbnail = null;
          placeholder.classList.remove('hidden');
          preview.classList.add('hidden');
          img.src = '';
          window.pendingUploadFiles?.delete(uploadId);
          if (window.PendingUploadStore) PendingUploadStore.remove(uploadId).catch(function (_e) { globalThis.SEOSONA_swallow?.('AngleEditor#onload', _e); });
          this._setControlsDisabled(false);
          this._isUploading = false;
          this._updateGenerateButton();
          if (typeof CustomDialog !== 'undefined') {
            CustomDialog.alert(window.I18n?.t('angles.uploadFailedTitle') || 'Upload thất bại', window.I18n?.t('angles.uploadFailedMsg') || 'Không thể upload ảnh lên Flow. Vui lòng thử lại.');
          }
          return;
        }

        // Verify tile exists AND is fully processed on Flow (retry up to 8 times, 2s interval)
        let tileVerified = false;
        let cdnThumbnail = null;
        for (let attempt = 0; attempt < 8; attempt++) {
          try {
            if (window.MessageBridge) {
              const check = await window.MessageBridge.checkTilesExist([realFileId]);
              if (check?.existing?.includes(realFileId)) {
                tileVerified = true;
                // Get real CDN thumbnail URL
                if (check.thumbnails?.[realFileId]) {
                  cdnThumbnail = check.thumbnails[realFileId];
                  break;
                }
                // Tile exists but may still be processing, scan for thumbnail
                const scan = await window.MessageBridge.scanFlowImages();
                const match = scan?.images?.find(i => i.fileId === realFileId);
                if (match?.thumbnail && !match.thumbnail.startsWith('data:')) {
                  cdnThumbnail = match.thumbnail;
                  break;
                }
              }
            }
          } catch (e) { /* ignore check errors */ }
          await new Promise(r => setTimeout(r, 2000));
        }

        // Update preview with CDN thumbnail (replace base64)
        if (cdnThumbnail) {
          img.src = cdnThumbnail;
          this.state.refThumbnail = cdnThumbnail;
          this._loadRefThumbForOrbit();
          console.log('[AngleEditor] Preview cập nhật CDN URL');
        }

        if (!tileVerified) {
          console.warn('[AngleEditor] Tile uploaded nhưng chưa xuất hiện trên page, tiếp tục với file_id');
        } else {
          console.log('[AngleEditor] Upload verified, tile tồn tại trên page');
        }

        // Clean up old cached ref if replacing
        if (this._cachedRefFileId && this._cachedRefFile) {
          window.pendingUploadFiles?.delete(this._cachedRefFileId);
          if (window.PendingUploadStore) PendingUploadStore.remove(this._cachedRefFileId).catch(function (_e) { globalThis.SEOSONA_swallow?.('AngleEditor#onload', _e); });
        }

        // Store real file_id + cache file for re-upload
        this.state.refImageId = realFileId;
        this._cachedRefFileId = realFileId;
        this._cachedRefFile = file;

        // Cache in uploadedFileCache for re-upload if tile expires
        if (!window.uploadedFileCache) window.uploadedFileCache = new Map();
        window.uploadedFileCache.set(realFileId, { file });
        if (window.PendingUploadStore) {
          PendingUploadStore.cacheUploaded(realFileId, file).catch(function (_e) { globalThis.SEOSONA_swallow?.('AngleEditor#onload', _e); });
        }

        this._buildPrompt();
      } catch (err) {
        console.error('[AngleEditor] Lỗi upload ảnh:', err.message);
        this.state.refImageId = null;
        this.state.refThumbnail = null;
        placeholder.classList.remove('hidden');
        preview.classList.add('hidden');
        img.src = '';
        window.pendingUploadFiles?.delete(uploadId);
        if (window.PendingUploadStore) PendingUploadStore.remove(uploadId).catch(function (_e) { globalThis.SEOSONA_swallow?.('AngleEditor#onload', _e); });
      } finally {
        this._isUploading = false;
        this._setControlsDisabled(false);
        this._updateGenerateButton();
      }
    };

    reader.readAsDataURL(file);
  }

  /**
   * Disable/enable all controls during upload
   */
  _setControlsDisabled(disabled, message) {
    const controlPanel = this.container.querySelector('#anglesControlPanel');
    if (!controlPanel) return;

    // Toggle disabled class on control panel
    controlPanel.classList.toggle('angles-controls-disabled', disabled);

    // Show/hide loading overlay
    let overlay = controlPanel.querySelector('.angles-upload-overlay');
    if (disabled) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'angles-upload-overlay';
        overlay.innerHTML = `
          <div class="angles-upload-overlay-content">
            <svg class="angles-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
            </svg>
            <span>${message || window.I18n?.t('exec.processing') || 'Đang xử lý...'}</span>
          </div>`;
        controlPanel.appendChild(overlay);
      }
    } else if (overlay) {
      overlay.remove();
    }

    // Disable interactive elements (except change/remove image buttons)
    const interactives = controlPanel.querySelectorAll('select, input[type="range"], button:not(#anglesChangeImage):not(#anglesRemoveImage)');
    interactives.forEach(el => { el.disabled = disabled; });

    // Keep upload zone clickable for changing image
    const uploadZone = this.container.querySelector('#anglesUploadZone');
    if (uploadZone) uploadZone.style.pointerEvents = disabled ? 'none' : '';
  }

  /**
   * Clean up cached ref file (called on window close)
   */
  _cleanupRefCache() {
    if (this._cachedRefFileId) {
      window.pendingUploadFiles?.delete(this._cachedRefFileId);
      if (window.PendingUploadStore) PendingUploadStore.remove(this._cachedRefFileId).catch(function (_e) { globalThis.SEOSONA_swallow?.('AngleEditor#_cleanupRefCache', _e); });
      this._cachedRefFileId = null;
      this._cachedRefFile = null;
    }
  }

  // ===== Presets =====

  async _loadPresets() {
    const select = this.container.querySelector('#anglesPresetSelect');
    let presets = [];

    try {
      if (self.SEOSONA_LOCAL_MODE === false) {
        const response = await ApiClient.request('GET', 'angle-presets');
        // _apiCall trả về data trực tiếp (hoặc { data, meta } nếu có pagination)
        if (Array.isArray(response)) {
          presets = response;
        } else if (response?.data && Array.isArray(response.data)) {
          presets = response.data;
        }
      }
    } catch (err) {
      console.warn('[AngleEditor] Failed to load presets from API:', err);
    }

    // Fallback to default preset
    if (presets.length === 0) {
      presets = [AngleEditor.DEFAULT_PRESET];
      console.log('[AngleEditor] Using default preset (API unavailable)');
    }

    this.state.presets = presets;

    // Populate select
    select.innerHTML = '';
    for (const preset of presets) {
      const option = document.createElement('option');
      option.value = preset.id;
      option.textContent = preset.name;
      select.appendChild(option);
    }

    // Auto-select first preset
    if (presets.length > 0) {
      select.value = presets[0].id;
      this._loadPreset(presets[0].id);
    }

    console.log('[AngleEditor] Loaded', presets.length, 'presets');
  }

  _loadPreset(presetId) {
    const preset = this.state.presets.find(p => p.id === presetId);
    if (!preset) return;

    this.state.preset = preset;

    // Apply default settings from preset if available
    if (preset.default_settings) {
      // Store for later use during generation
      this._presetDefaults = preset.default_settings;
    }

    this._buildPrompt();
    this._updateGenerateButton();

    console.log('[AngleEditor] Loaded preset:', preset.name);
  }

  // ===== Ratio Pills =====

  /**
   * Build pill HTML từ ProviderConfigManager.getRatiosSync('flow', 'image') với fallback.
   * Mỗi pill có SVG icon scaled theo aspect ratio.
   */
  _buildRatioPillsHtml() {
    const fallback = ['16:9', '4:3', '1:1', '3:4', '9:16'];
    const ratios = (window.ProviderConfigManager?.safeGetRatiosSync?.('flow', 'image')) || fallback;
    return ratios.map(r => {
      const value = typeof r === 'string' ? r : (r.value || r.ui_name);
      if (!value) return '';
      const [w, h] = value.split(':').map(Number);
      if (!w || !h) return '';
      // Normalize SVG size: longest side = 14px.
      const scale = 14 / Math.max(w, h);
      const svgW = Math.round(w * scale * 10) / 10;
      const svgH = Math.round(h * scale * 10) / 10;
      const rectW = Math.max(svgW - 2, 1);
      const rectH = Math.max(svgH - 2, 1);
      return `<button class="angles-ratio-pill" data-ratio="${value}" title="${value}">
        <svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="1" y="1" width="${rectW}" height="${rectH}" rx="1"/></svg>
        ${value}
      </button>`;
    }).join('');
  }

  _initRatioPills() {
    const container = this.container.querySelector('#anglesRatioPills');
    if (!container) return;

    // Set initial active state
    const defaultRatio = this.state.ratio || '9:16';
    this._setActiveRatioPill(defaultRatio);

    container.addEventListener('click', (e) => {
      const pill = e.target.closest('.angles-ratio-pill');
      if (!pill) return;
      const ratio = pill.dataset.ratio;
      this.state.ratio = ratio;
      this._setActiveRatioPill(ratio);
    });

    // Admin update Flow ratios → re-render pills
    if (window.eventBus && !this._ratioSseBound) {
      this._ratioSseBound = true;
      window.eventBus.on('provider:api_config_updated', ({ provider, key }) => {
        if (provider !== 'flow' || key !== 'ratios') return;
        const c = this.container?.querySelector('#anglesRatioPills');
        if (!c) return;
        c.innerHTML = this._buildRatioPillsHtml();
        this._setActiveRatioPill(this.state.ratio || '9:16');
      });

      // Bug 34 fix (2026-05-19): Admin add/remove/rename model → re-populate model select.
      // Pattern giống settings-page.js._fillModelSelect.
      window.eventBus.on('provider:models_updated', () => {
        const selectEl = this.container?.querySelector('#anglesModelSelect');
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
        } else if (this.state.model) {
          selectEl.value = this.state.model;
        }
      });
    }
  }

  _setActiveRatioPill(ratio) {
    const pills = this.container.querySelectorAll('.angles-ratio-pill');
    pills.forEach(p => p.classList.toggle('active', p.dataset.ratio === ratio));
  }

  // ===== Prompt Building =====

  _buildPrompt() {
    const preset = this.state.preset;
    if (!preset) {
      this.state.builtPrompt = '';
      this._updatePromptPreview();
      return '';
    }

    const modifiers = preset.angle_modifiers || {};
    const rotationKw = this._findNearestKey(this.state.rotation, modifiers.rotation_keywords || {});
    const tiltKw = this._findNearestKey(this.state.tilt, modifiers.tilt_keywords || {});
    const zoomKw = this._findNearestKey(this.state.zoom, modifiers.zoom_keywords || {});

    let prompt = preset.base_prompt || '';
    prompt = prompt.replace('{angle_modifier}', rotationKw);
    prompt = prompt.replace('{tilt_modifier}', tiltKw);
    prompt = prompt.replace('{zoom_modifier}', zoomKw);

    this.state.builtPrompt = prompt;
    this._updatePromptPreview();
    return prompt;
  }

  _findNearestKey(value, keysMap) {
    if (!keysMap || Object.keys(keysMap).length === 0) return '';

    const keys = Object.keys(keysMap).map(Number);
    let nearestKey = keys[0];
    let minDiff = Math.abs(value - nearestKey);

    for (const key of keys) {
      const diff = Math.abs(value - key);
      if (diff < minDiff) {
        minDiff = diff;
        nearestKey = key;
      }
    }

    return keysMap[String(nearestKey)] || '';
  }

  _updatePromptPreview() {
    const textarea = this.container.querySelector('#anglesPromptPreview');
    if (textarea) {
      textarea.value = this.state.builtPrompt;
    }
  }

  // ===== Orbit Picker (Canvas) =====

  _renderOrbitPicker() {
    this._updateOrbitPicker();
  }

  _bindOrbitPicker() {
    const canvas = this.container.querySelector('#anglesOrbitCanvas');
    if (!canvas) return;

    let dragStartX = 0, dragStartY = 0;
    let startRotation = 0, startTilt = 0;

    const getClientPos = (e) => {
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return { clientX, clientY };
    };

    const updateAngles = (rotation, tilt) => {
      // Clamp rotation to -180..180
      if (rotation > 180) rotation -= 360;
      if (rotation < -180) rotation += 360;
      rotation = Math.round(rotation / 15) * 15;
      // Clamp tilt to -60..90
      tilt = Math.max(-60, Math.min(90, tilt));
      tilt = Math.round(tilt / 15) * 15;

      this.state.rotation = rotation;
      this.state.tilt = tilt;

      const rotSlider = this.container.querySelector('#anglesRotation');
      const tiltSlider = this.container.querySelector('#anglesTilt');
      if (rotSlider) rotSlider.value = rotation;
      if (tiltSlider) tiltSlider.value = tilt;
      this.container.querySelector('#anglesRotationValue').textContent = rotation + '°';
      this.container.querySelector('#anglesTiltValue').textContent = tilt + '°';
      this._updateOrbitPicker();
      this._buildPrompt();
    };

    const onStart = (e) => {
      e.preventDefault();
      this._orbitDragging = true;
      const pos = getClientPos(e);
      dragStartX = pos.clientX;
      dragStartY = pos.clientY;
      startRotation = this.state.rotation;
      startTilt = this.state.tilt;
    };

    const onMove = (e) => {
      if (!this._orbitDragging) return;
      const pos = getClientPos(e);
      const dx = pos.clientX - dragStartX;
      const dy = pos.clientY - dragStartY;
      // Horizontal drag = rotation (1px = ~1°)
      const newRotation = startRotation + dx * 1;
      // Vertical drag = tilt (1px = ~0.7°, up = positive tilt)
      const newTilt = startTilt - dy * 0.7;
      updateAngles(newRotation, newTilt);
    };

    const onEnd = () => {
      this._orbitDragging = false;
    };

    canvas.addEventListener('mousedown', onStart);
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onEnd);
    canvas.addEventListener('touchstart', onStart, { passive: false });
    canvas.addEventListener('touchmove', (e) => { e.preventDefault(); onMove(e); }, { passive: false });
    canvas.addEventListener('touchend', onEnd);
  }

  _updateOrbitPicker() {
    const canvas = this.container.querySelector('#anglesOrbitCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const R = 90; // Sphere radius

    ctx.clearRect(0, 0, w, h);

    const accent = '#3d6ff5';
    const accentA = (a) => `rgba(61, 111, 245,${a})`;

    // --- 3D Wireframe Sphere ---
    // Equator ring (horizontal)
    ctx.beginPath();
    ctx.ellipse(cx, cy, R, R * 0.35, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Vertical meridian ring (front-facing)
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * 0.35, R, 0, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.stroke();

    // Tilted meridian rings for depth
    ctx.save();
    ctx.translate(cx, cy);
    for (const angle of [30, -30, 60, -60]) {
      const rad = angle * Math.PI / 180;
      ctx.save();
      ctx.rotate(rad);
      ctx.beginPath();
      ctx.ellipse(0, 0, R * 0.35, R, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${Math.abs(angle) > 45 ? 0.05 : 0.07})`;
      ctx.stroke();
      ctx.restore();
    }

    // Latitude rings (horizontal at different heights)
    for (const lat of [-45, 45]) {
      const latRad = lat * Math.PI / 180;
      const ringR = R * Math.cos(latRad);
      const ringY = -R * Math.sin(latRad) * 0.35;
      ctx.beginPath();
      ctx.ellipse(0, ringY, ringR, ringR * 0.35, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.stroke();
    }
    ctx.restore();

    // --- Outer sphere outline (subtle) ---
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // --- Navigation arrows ---
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    const aOff = R + 14;
    const aS = 5;
    // Top
    ctx.beginPath();
    ctx.moveTo(cx - aS, cy - aOff + aS);
    ctx.lineTo(cx, cy - aOff);
    ctx.lineTo(cx + aS, cy - aOff + aS);
    ctx.stroke();
    // Bottom
    ctx.beginPath();
    ctx.moveTo(cx - aS, cy + aOff - aS);
    ctx.lineTo(cx, cy + aOff);
    ctx.lineTo(cx + aS, cy + aOff - aS);
    ctx.stroke();
    // Left
    ctx.beginPath();
    ctx.moveTo(cx - aOff + aS, cy - aS);
    ctx.lineTo(cx - aOff, cy);
    ctx.lineTo(cx - aOff + aS, cy + aS);
    ctx.stroke();
    // Right
    ctx.beginPath();
    ctx.moveTo(cx + aOff - aS, cy - aS);
    ctx.lineTo(cx + aOff, cy);
    ctx.lineTo(cx + aOff - aS, cy + aS);
    ctx.stroke();

    // --- 3D Camera position ---
    const rotRad = this.state.rotation * (Math.PI / 180);
    const tiltRad = this.state.tilt * (Math.PI / 180);

    // Project camera position onto 3D sphere surface
    const camSphereX = R * Math.sin(rotRad) * Math.cos(tiltRad);
    const camSphereY = -R * Math.sin(tiltRad);
    const camSphereZ = R * Math.cos(rotRad) * Math.cos(tiltRad);

    // Simple perspective projection
    const perspD = 300;
    const scale = perspD / (perspD + camSphereZ * 0.3);
    const camX = cx + camSphereX * scale;
    const camY = cy + camSphereY * scale;
    const isBehind = camSphereZ < 0;

    // --- Subject thumbnail (center of sphere) ---
    if (this._refThumbImg && this._refThumbImg.complete && this._refThumbImg.naturalWidth > 0) {
      const thumbS = 36;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, thumbS / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(this._refThumbImg, cx - thumbS / 2, cy - thumbS / 2, thumbS, thumbS);
      ctx.restore();
      // Border
      ctx.beginPath();
      ctx.arc(cx, cy, thumbS / 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      // Fallback: simple box
      const bS = 12;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(cx - bS, cy - bS, bS * 2, bS * 2);
    }

    // --- Dashed line from subject to camera ---
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(camX, camY);
    ctx.strokeStyle = accentA(isBehind ? 0.15 : 0.35);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // --- 3D Camera cube wireframe ---
    const cubeS = 10 * scale;
    const cubeAlpha = isBehind ? 0.3 : 0.9;
    ctx.save();
    ctx.translate(camX, camY);

    // Cube faces (wireframe)
    const cf = cubeS / 2;
    const cd = cubeS * 0.3; // Depth offset for 3D
    // Front face
    ctx.strokeStyle = accentA(cubeAlpha * 0.8);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-cf, -cf, cubeS, cubeS);
    // Back face (offset)
    ctx.strokeStyle = accentA(cubeAlpha * 0.4);
    ctx.lineWidth = 1;
    ctx.strokeRect(-cf + cd, -cf - cd, cubeS, cubeS);
    // Connecting lines
    ctx.beginPath();
    ctx.moveTo(-cf, -cf); ctx.lineTo(-cf + cd, -cf - cd);
    ctx.moveTo(cf, -cf); ctx.lineTo(cf + cd, -cf - cd);
    ctx.moveTo(cf, cf); ctx.lineTo(cf + cd, cf - cd);
    ctx.moveTo(-cf, cf); ctx.lineTo(-cf + cd, cf - cd);
    ctx.strokeStyle = accentA(cubeAlpha * 0.4);
    ctx.stroke();

    // Lens dot (center of front face)
    ctx.beginPath();
    ctx.arc(0, 0, 2, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.restore();

    // --- Angle label ---
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.textAlign = 'center';
    const lbl = this.state.rotation + '°' + (this.state.tilt !== 0 ? ` / ${this.state.tilt}°` : '');
    const lblY = camY < cy ? camY + cubeS + 14 : camY - cubeS - 6;
    ctx.fillText(lbl, camX, lblY);
  }

  /**
   * Load ref thumbnail as Image for orbit picker rendering
   */
  _loadRefThumbForOrbit() {
    if (!this.state.refThumbnail) {
      this._refThumbImg = null;
      this._updateOrbitPicker();
      return;
    }
    const img = new Image();
    img.onload = () => {
      this._refThumbImg = img;
      this._updateOrbitPicker();
    };
    img.src = this.state.refThumbnail;
  }

  // ===== Ref Image Upload State =====

  _updateRefUploadingState() {
    const preview = this.container.querySelector('#anglesUploadPreview');
    if (!preview) return;

    if (this._isAlbumUploading) {
      preview.classList.add('angles-ref-uploading');
    } else {
      preview.classList.remove('angles-ref-uploading');
    }
  }

  // ===== Generate Button State =====

  _updateGenerateButton() {
    const btn = this.container.querySelector('#anglesGenerateBtn');
    if (!btn) return;

    const isSubmitting = this.state.isGenerating && !this._submitted;
    const canGenerate = !!(
      this.state.refImageId &&
      this.state.preset &&
      !isSubmitting &&
      !this._isUploading &&
      !this._isAlbumUploading
    );

    btn.disabled = !canGenerate;

    if (this._isUploading || this._isAlbumUploading) {
      btn.classList.add('is-generating');
      btn.querySelector('span').textContent = window.I18n?.t('angles.uploading') || 'Đang upload...';
    } else if (isSubmitting) {
      btn.classList.add('is-generating');
      btn.querySelector('span').textContent = window.I18n?.t('angles.submitting') || 'Đang gửi...';
    } else {
      btn.classList.remove('is-generating');
      btn.querySelector('span').textContent = window.I18n?.t('angles.generate') || 'Tạo ảnh';
    }
  }

  /**
   * Clear the reference image and reset to upload placeholder state
   */
  _clearRefImage() {
    const $ = (id) => document.getElementById(id);
    const placeholder = $('anglesUploadPlaceholder');
    const preview = $('anglesUploadPreview');
    const img = $('anglesRefImage');

    // Clear state
    const oldId = this.state.refImageId;
    this.state.refImageId = null;
    this.state.refThumbnail = null;
    this.state.refFileName = null;

    // Reset UI
    if (placeholder) placeholder.classList.remove('hidden');
    if (preview) preview.classList.add('hidden');
    if (img) img.src = '';

    // Clean up pending uploads if any
    if (oldId && oldId.startsWith('upload_')) {
      window.pendingUploadFiles?.delete(oldId);
      if (window.PendingUploadStore) {
        PendingUploadStore.remove(oldId).catch(function (_e) { globalThis.SEOSONA_swallow?.('AngleEditor#$', _e); });
      }
      if (window.ImmediateUploader) {
        ImmediateUploader.cancel(oldId);
      }
    }

    // Update button state
    this._updateGenerateButton();

    console.log('[AngleEditor] Ref image cleared');
  }

  // ===== Execution Integration (AngleExecution) =====

  _initExecution() {
    // Defer to allow AngleExecution.js to load after this file
    setTimeout(() => {
      if (typeof AngleExecution !== 'undefined') {
        this.execution = new AngleExecution(this);
        window.angleExecution = this.execution;
        console.log('[AngleEditor] AngleExecution connected');
      } else {
        console.warn('[AngleEditor] AngleExecution not loaded');
      }
    }, 0);
  }

  /**
   * Update quota display showing runs used/limit and global prompts used/limit
   */
  async _updateQuotaDisplay() {
    const runsEl = this.container.querySelector('#anglesQuotaRuns .angles-quota-value');
    const promptsEl = this.container.querySelector('#anglesQuotaPrompts .angles-quota-value');

    // Get angles_run_max quota
    if (window.featureGate && runsEl) {
      try {
        const runQuota = await window.featureGate.checkQuotaAsync('angles_run_max');
        const limitText = runQuota.limit === 'unlimited' ? '∞' : runQuota.limit;
        runsEl.textContent = `${runQuota.used}/${limitText}`;
        const runsItem = this.container.querySelector('#anglesQuotaRuns');
        if (runQuota.limit !== 'unlimited' && runQuota.used >= runQuota.limit) {
          runsItem?.classList.add('angles-quota-exhausted');
          runsItem?.classList.remove('angles-quota-warning');
        } else if (runQuota.limit !== 'unlimited' && runQuota.used >= runQuota.limit * 0.8) {
          runsItem?.classList.add('angles-quota-warning');
          runsItem?.classList.remove('angles-quota-exhausted');
        } else {
          runsItem?.classList.remove('angles-quota-warning', 'angles-quota-exhausted');
        }
      } catch (e) {
        console.warn('[AngleEditor] Failed to get run quota:', e.message);
      }
    }

    // Get prompt_submit_max quota (global)
    if (window.featureGate && promptsEl) {
      try {
        const promptQuota = await window.featureGate.checkQuotaAsync('prompt_submit_max');
        const limitText = promptQuota.limit === 'unlimited' ? '∞' : promptQuota.limit;
        promptsEl.textContent = `${promptQuota.used}/${limitText}`;
        const promptsItem = this.container.querySelector('#anglesQuotaPrompts');
        if (promptQuota.limit !== 'unlimited' && promptQuota.used >= promptQuota.limit) {
          promptsItem?.classList.add('angles-quota-exhausted');
          promptsItem?.classList.remove('angles-quota-warning');
        } else if (promptQuota.limit !== 'unlimited' && promptQuota.used >= promptQuota.limit * 0.8) {
          promptsItem?.classList.add('angles-quota-warning');
          promptsItem?.classList.remove('angles-quota-exhausted');
        } else {
          promptsItem?.classList.remove('angles-quota-warning', 'angles-quota-exhausted');
        }
      } catch (e) {
        console.warn('[AngleEditor] Failed to get prompt quota:', e.message);
      }
    }
  }

  async _runGeneration() {
    if (this.state.isGenerating) return;
    // Audit fix (double-submit): set the busy flag SYNCHRONOUSLY right after the
    // guard, before the canRunAnglesAsync() await, so two fast clicks can't both
    // pass the guard. Early-return paths below reset it before returning.
    this.state.isGenerating = true;

    // Check run limit for angles (applies to both anonymous and logged-in users)
    if (window.featureGate) {
      const canRun = await window.featureGate.canRunAnglesAsync();
      if (!canRun) {
        const isLoggedIn = true;
        if (isLoggedIn) {
          const confirmed = await window.customDialog?.confirm(
            window.I18n?.t('angles.quotaExhaustedLoggedIn') || 'Bạn đã sử dụng hết lượt tạo ảnh Angles hôm nay. Nâng cấp gói để không giới hạn.',
            { title: window.I18n?.t('angles.quotaExhaustedTitle') || 'Đã hết lượt', type: 'warning', confirmText: window.I18n?.t('upgrade.upgradeNow') || 'Nâng cấp', cancelText: window.I18n?.t('common.later') || 'Để sau' }
          );
          /* upgrade modal removed — local-first; confirm is now informational only */
          void confirmed;
        } else {
          const confirmed = await window.customDialog?.confirm(
            window.I18n?.t('angles.quotaExhaustedTrial') || 'Bạn đã sử dụng hết lượt tạo ảnh Angles trong bản dùng thử.\n\nĐăng nhập để tiếp tục sử dụng.',
            { title: window.I18n?.t('angles.quotaExhaustedTrialTitle') || 'Đã hết lượt dùng thử', type: 'warning', confirmText: window.I18n?.t('auth.googleLogin') || 'Đăng nhập với Google', cancelText: window.I18n?.t('common.later') || 'Để sau' }
          );
          if (confirmed && window.authManager?.loginWithGoogle) {
            console.log('Login bypassed');
          }
        }
        this.state.isGenerating = false; // release guard — not proceeding
        return;
      }
    }

    if (!this.state.refImageId || !this.state.preset) { this.state.isGenerating = false; return; }
    if (!this.execution) {
      console.error('[AngleEditor] AngleExecution chưa sẵn sàng');
      this.state.isGenerating = false;
      return;
    }

    this._activeGenCount++;
    this.state.isGenerating = true;
    this._submitted = false;
    this._updateGenerateButton();
    this._setCameraLabelGenerating(true);
    this._setControlsDisabled(true, window.I18n?.t('angles.generating') || 'Đang tạo ảnh...');

    // Callback: unlock controls ngay sau khi submit thành công
    // Cho phép user tạo thêm ảnh khác trong lúc Flow đang xử lý ảnh trước
    this.execution._onSubmittedCallback = () => {
      this._submitted = true;
      this.state.isGenerating = false; // Cho phép generate thêm
      this._setControlsDisabled(false);
      this._setCameraLabelGenerating(false);
      this._updateGenerateButton();
    };

    // Get current ratio from user selection
    const currentRatio = this.state.ratio || 'Dọc';
    this._addLoadingCard(currentRatio);

    try {
      const result = await this.execution.runGeneration(this.state);
      if (result?.fileIds?.length > 0) {
        // Trial gate: ghi nhận lượt tạo ảnh Angles (await to ensure recorded)
        if (window.featureGate && !true) {
          await window.featureGate.recordAnglesRun();
        }

        this._removeLoadingCards();
        // Add entries with placeholder thumbnails + ratio
        const immediateEntries = result.fileIds.map(id => ({
          file_id: id,
          rotation: this.state.rotation,
          tilt: this.state.tilt,
          zoom: this.state.zoom,
          angle_label: this.execution._buildAngleLabel(this.state),
          thumbnail_url: '',
          ratio: currentRatio,
          preset_id: this.state.preset?.id || 0,
          preset_name: this.state.preset?.name || '',
          created_at: new Date().toISOString()
        }));
        this.state.results = [...this.state.results, ...immediateEntries];
        this._renderResults();
        this._currentResults = this.state.results;
        console.log('[AngleEditor] Tạo thành công:', result.fileIds.length, 'ảnh');

        // Background: retry scan thumbnails and update (up to 5 retries, 2s interval)
        this._retryThumbnails(result.fileIds, immediateEntries);

        // Also persist to storage (include ratio for display)
        result.ratio = currentRatio;
        this.execution.saveResult(result, this.state).catch(e => {
          console.warn('[AngleEditor] Lỗi lưu kết quả:', e.message);
        });
      } else {
        this._removeLoadingCards();
        console.warn('[AngleEditor] Generation xong nhưng không phát hiện tile mới');
        // DISABLED: Fallback scan gây bug capture nhầm tiles khác khi Flow fail/retry
        // Thay vào đó, thông báo user kiểm tra trực tiếp trên Flow
        if (window.customDialog) {
          window.customDialog.alert(
            window.I18n?.t('angles.noTilesDetected') || 'Không phát hiện ảnh mới. Vui lòng kiểm tra kết quả trực tiếp trên Google Flow.',
            { title: window.I18n?.t('angles.genWarningTitle') || 'Cảnh báo', type: 'warning' }
          );
        }
      }
    } catch (err) {
      this._removeLoadingCards();
      console.error('[AngleEditor] Lỗi tạo ảnh:', err.message);
      if (window.customDialog) {
        if (err.isFlowFailure) {
          window.customDialog.alert(
            err.message,
            { title: window.I18n?.t('angles.genFailedTitle') || 'Tạo ảnh thất bại', type: 'error' }
          );
        } else {
          window.customDialog.alert(
            err.message,
            { title: window.I18n?.t('angles.genErrorTitle') || 'Lỗi tạo ảnh', type: 'warning' }
          );
        }
      }
    } finally {
      this._activeGenCount--;
      // Chỉ clean up nếu không còn generation nào đang chạy
      if (this._activeGenCount <= 0) {
        this._activeGenCount = 0;
        this.state.isGenerating = false;
        this._submitted = false;
        this._updateGenerateButton();
        this._setCameraLabelGenerating(false);
        this._setControlsDisabled(false);
      }
      // Luôn clear callback của generation này
      this.execution._onSubmittedCallback = null;
      // Update quota display after generation
      this._updateQuotaDisplay();
    }
  }

  _setCameraLabelGenerating(isGenerating) {
    const label = this.container.querySelector('#anglesCameraLabel');
    if (label) label.classList.toggle('is-generating', isGenerating);
    // Camera cube icon glow on orbit canvas area
    const container3d = this.container.querySelector('.angles-3d-container');
    if (container3d) container3d.classList.toggle('is-generating', isGenerating);
  }

  /**
   * Add a skeleton loading card to the results grid
   */
  _addLoadingCard(ratio) {
    const grid = this.container.querySelector('#anglesResultsGrid');
    const emptyState = this.container.querySelector('#anglesEmptyState');
    if (!grid) return;
    emptyState?.classList.add('hidden');

    const cssRatio = this._ratioToCss(ratio);
    const card = document.createElement('div');
    card.className = 'angles-result-card angles-loading-card';
    card.innerHTML = `
      <div class="angles-result-thumb" style="aspect-ratio: ${cssRatio}">
        <div class="angles-result-skeleton">
          <svg class="angles-spinner" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
          </svg>
          <span>${window.I18n?.t('angles.creatingCard') || 'Đang tạo...'}</span>
        </div>
      </div>
    `;
    grid.appendChild(card);
  }

  /**
   * Xóa loading cards
   * @param {number} count - Số lượng cards cần xóa (mặc định 1, -1 = tất cả)
   */
  _removeLoadingCards(count = 1) {
    const grid = this.container.querySelector('#anglesResultsGrid');
    if (!grid) return;
    const loadingCards = grid.querySelectorAll('.angles-loading-card');
    if (count === -1) {
      // Xóa tất cả
      loadingCards.forEach(el => el.remove());
    } else {
      // Chỉ xóa số lượng cần thiết (từ đầu - FIFO)
      for (let i = 0; i < Math.min(count, loadingCards.length); i++) {
        loadingCards[i].remove();
      }
    }
  }

  /**
   * Convert ratio name to CSS aspect-ratio value
   */
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
      'Vuông': '1'
    };
    return map[ratio] || '1';
  }

  async _retryThumbnails(fileIds, entries) {
    const maxRetries = 5;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        if (!window.MessageBridge) break;
        const scan = await window.MessageBridge.scanFlowImages();
        const images = scan?.images || [];
        let updated = false;
        for (const entry of entries) {
          if (entry.thumbnail_url) continue;
          const match = images.find(img => img.fileId === entry.file_id);
          if (match?.thumbnail) {
            entry.thumbnail_url = match.thumbnail;
            // Also update in this.state.results
            const stateEntry = this.state.results.find(r => r.file_id === entry.file_id);
            if (stateEntry) stateEntry.thumbnail_url = match.thumbnail;
            updated = true;
          }
        }
        if (updated) {
          this._renderResults();
          this._currentResults = this.state.results;
          // Update storage
          new Promise(resolve => {
            chrome.storage.local.set({ af_angles_results: this.state.results }, resolve);
          }).catch(function (_e) { globalThis.SEOSONA_swallow?.('AngleEditor#_retryThumbnails', _e); });
        }
        // Stop retrying if all thumbnails found
        if (entries.every(e => e.thumbnail_url)) break;
      } catch (e) {
        console.warn('[AngleEditor] Retry thumbnail scan failed:', e.message);
      }
    }
  }

  /**
   * @deprecated DISABLED - gây bug capture nhầm tiles khi Flow fail/retry
   * Giữ lại code để tham khảo, nhưng KHÔNG được gọi
   */
  async _fallbackScanResults() {
    // Fallback: scan Flow images and show any that aren't already in results
    try {
      if (!window.MessageBridge) return;
      const scan = await window.MessageBridge.scanFlowImages();
      const existingIds = new Set(this.state.results.map(r => r.file_id));
      // CRITICAL: exclude current ref image to avoid capturing it as a result
      if (this.state.refImageId) {
        existingIds.add(this.state.refImageId);
      }
      // CRITICAL: exclude tiles that existed BEFORE generation started (baseline)
      // This prevents capturing nearby tiles during retry flow
      const baselineSet = this.execution?._lastBaselineTileIds;
      if (baselineSet && baselineSet.size > 0) {
        for (const id of baselineSet) {
          existingIds.add(id);
        }
      }
      const newImages = (scan?.images || []).filter(img => !existingIds.has(img.fileId));
      if (newImages.length > 0) {
        console.log('[AngleEditor] Fallback scan tìm thấy', newImages.length, 'ảnh mới');
        const genDefaults = await this.execution?._getGenDefaults();
        const fallbackRatio = this.state.preset?.default_settings?.ratio
          || this._presetDefaults?.ratio || genDefaults?.ratio || '';
        const entries = newImages.slice(0, 4).map(img => ({
          file_id: img.fileId,
          rotation: this.state.rotation,
          tilt: this.state.tilt,
          zoom: this.state.zoom,
          angle_label: this.execution?._buildAngleLabel(this.state) || '',
          thumbnail_url: img.thumbnail || '',
          ratio: fallbackRatio,
          preset_id: this.state.preset?.id || 0,
          preset_name: this.state.preset?.name || '',
          created_at: new Date().toISOString()
        }));
        this.state.results = [...this.state.results, ...entries];
        this._renderResults();
        this._currentResults = this.state.results;
        // Persist
        new Promise(resolve => {
          chrome.storage.local.set({ af_angles_results: this.state.results }, resolve);
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('AngleEditor#_fallbackScanResults', _e); });
      }
    } catch (e) {
      console.warn('[AngleEditor] Fallback scan failed:', e.message);
    }
  }

  // ===== Results =====

  _renderResults() {
    const grid = this.container.querySelector('#anglesResultsGrid');
    const emptyState = this.container.querySelector('#anglesEmptyState');

    if (this.state.results.length === 0) {
      // Preserve loading cards khi không có results
      const hasLoadingCards = grid?.querySelector('.angles-loading-card');
      if (!hasLoadingCards) {
        emptyState?.classList.remove('hidden');
        if (grid) grid.innerHTML = '';
      }
      return;
    }

    emptyState?.classList.add('hidden');
    if (this.execution && grid) {
      // CRITICAL: Preserve loading cards trước khi render
      const loadingCards = Array.from(grid.querySelectorAll('.angles-loading-card'));

      this.execution.renderResultsGrid(this.state.results, grid);

      // Re-append loading cards sau khi render results
      for (const card of loadingCards) {
        grid.appendChild(card);
      }

      // Bind download buttons
      grid.querySelectorAll('.angles-result-download').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const fileId = btn.dataset.fileId;
          const card = btn.closest('.angles-result-card');
          const label = card?.querySelector('.angles-result-label')?.textContent || '';
          this.execution.downloadImage(fileId, label);
        });
      });
    }
  }

  async _clearResults() {
    if (this.execution) {
      await this.execution.clearResults();
    }
    this.state.results = [];
    this._renderResults();
    console.log('[AngleEditor] Kết quả đã xóa');
  }

  async _downloadAll() {
    if (this.state.results.length === 0) return;
    if (this.execution) {
      await this.execution.downloadAll(this.state.results);
    }
  }

  // ===== Persistence =====

  async _loadSavedResults() {
    // Defer to allow execution to initialize
    setTimeout(async () => {
      try {
        if (this.execution) {
          this.state.results = await this.execution.loadSavedResults();
        } else {
          const stored = await new Promise(resolve => {
            chrome.storage.local.get(['af_angles_results'], result => resolve(result));
          });
          this.state.results = stored.af_angles_results || [];
        }
        this._renderResults();
        this._currentResults = this.state.results;
      } catch (err) {
        console.warn('[AngleEditor] Lỗi tải kết quả đã lưu:', err);
      }
    }, 100);
  }
}

// Export for use in angles-editor-init.js
window.AngleEditor = AngleEditor;
