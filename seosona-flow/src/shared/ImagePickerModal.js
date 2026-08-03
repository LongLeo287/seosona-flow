/**
 * ImagePickerModal - Modal chọn ảnh tham chiếu
 * Dùng chung cho Tab 1 (Prompts) và Tab 2 (Multi Task)
 *
 * 3 tabs:
 *   1. Ảnh trên Flow - Scan ảnh đang có trên Google Flow page
 *   2. Album - Chọn từ album đã lưu (AlbumStore + ImageStore)
 *   3. Upload - Upload từ máy tính
 *
 * Callback trả về danh sách ảnh đã chọn [{fileId, thumbnail, source}]
 */

(function() {
  'use strict';

  const DEBUG = false;
  function log(...args) {
    if (DEBUG) console.log('[ImagePickerModal]', ...args);
  }

  class ImagePickerModal {
    constructor() {
      this.overlay = null;
      this.activeTab = 'flow'; // 'flow' | 'album' | 'upload'
      this.flowImages = [];
      this.uploadedImages = [];
      this.albumData = []; // [{album, images, statuses}]
      this.selectedImages = new Map(); // fileId/key -> {fileId, thumbnail, source, ...}
      this.onConfirm = null;
      this.existingFileIds = []; // File IDs đã được chọn trước đó
    }

    /**
     * Post-audit fix: Resolve maxSelections theo (provider, mode, isFrames).
     * Lookup adapter.capabilities qua ProviderRegistry → ưu tiên getMaxRefImages() per-mode (Flow),
     * fallback capabilities.maxRefImages, fallback null (unlimited).
     *
     * 2026-05-22: Thêm modelValue param. Nếu model có
     * `provider_models.config.supports_ref_images = false` → return 0 (model không hỗ trợ ref).
     * Caller (ImagePickerModal.open) treat 0 → render banner block selection.
     *
     * @param {object} ctx
     * @param {string} ctx.provider - 'flow' | 'chatgpt' | 'grok' | 'gemini' (case-insensitive)
     * @param {string} [ctx.mode] - 'image' | 'video' (cho Flow per-mode)
     * @param {boolean} [ctx.isFrames] - true khi Flow video Frames mode (default 3 ingredients)
     * @param {string} [ctx.modelValue] - vd 'veo-3.1-quality' — nếu model.config.supports_ref_images=false
     *   hoặc ref_support_overrides[ match input_type/duration ] → return 0
     * @param {string} [ctx.duration] - vd '4s' | '6s' | '8s' — match `when.duration`/`when.duration_in` trong rules
     * @returns {number|null} max count, 0 = model không hỗ trợ ref, null = unlimited/không xác định
     */
    static resolveMaxSelections({ provider, mode = 'image', isFrames = false, modelValue = null, duration = undefined } = {}) {
      if (!provider) return null;
      const slug = String(provider).toLowerCase();

      // Lookup adapter qua ProviderRegistry
      const adapter = (typeof ProviderRegistry !== 'undefined' && ProviderRegistry.get)
        ? ProviderRegistry.get(slug)
        : null;
      if (!adapter?.capabilities) return null;

      // Model-level constraint: nếu model.config.supports_ref_images=false (hoặc conditional rule
      // matched: vd Veo Quality + Ingredients, hoặc Veo Lite/Fast + duration!=8s) → block (return 0).
      if (modelValue && typeof adapter.supportsRefImages === 'function') {
        try {
          const _ctx = {
            inputType: mode === 'video' ? (isFrames ? 'Frames' : 'Ingredients') : undefined,
            duration,
          };
          if (!adapter.supportsRefImages(modelValue, _ctx)) return 0;
        } catch (_) { /* fallthrough — graceful */ }
      }

      // Flow per-mode: dùng method nếu adapter có (FlowAdapter.getMaxRefImages).
      // 2026-05-28: pass modelValue → per-model max_ref_images override (vd Veo Lite=3, Omni Flash=7).
      // Khi adapter trả 0 → return 0 (model không hỗ trợ ref) → banner block, KHÔNG fallback static cap.
      if (typeof adapter.getMaxRefImages === 'function') {
        try {
          const max = adapter.getMaxRefImages({ mode, isFrames, modelValue });
          if (typeof max === 'number') return max > 0 ? max : 0;
        } catch (_) { /* fallthrough */ }
      }

      // Fallback static capabilities.maxRefImages
      const max = adapter.capabilities.maxRefImages;
      return (typeof max === 'number' && max > 0) ? max : null;
    }

    /**
     * Resolve multi-caps {image, video, total} cho selection enforcement riêng image vs video.
     * Vd Omni Flash: {image:7, video:1, total:7} → user pick max 1 video + tổng 7 ref.
     *
     * @returns {{image:number|null, video:number, total:number|null}}
     */
    static resolveCapsMulti({ provider, mode = 'image', isFrames = false, modelValue = null, duration = undefined } = {}) {
      const imageCap = this.resolveMaxSelections({ provider, mode, isFrames, modelValue, duration });
      let videoCap = 0;
      let totalCap = null;
      const adapter = (typeof ProviderRegistry !== 'undefined' && ProviderRegistry.get)
        ? ProviderRegistry.get(String(provider || '').toLowerCase()) : null;
      if (adapter) {
        if (typeof adapter.getMaxRefVideos === 'function') {
          try { videoCap = adapter.getMaxRefVideos(modelValue) || 0; } catch (_) { globalThis.SEOSONA_swallow?.('ImagePickerModal#constructor', _); }
        }
        if (typeof adapter.getMaxRefImagesTotal === 'function') {
          try { totalCap = adapter.getMaxRefImagesTotal(modelValue); } catch (_) { globalThis.SEOSONA_swallow?.('ImagePickerModal#constructor', _); }
        }
      }
      return { image: imageCap, video: videoCap, total: totalCap };
    }

    /**
     * Mở modal
     * @param {Object} options
     * @param {Function} options.onConfirm - Callback khi xác nhận, nhận mảng images
     * @param {string[]} options.existingFileIds - File IDs đã có (để pre-select)
     * @param {boolean} options.singleSelect - Chỉ cho chọn 1 ảnh (radio mode)
     */
    open(options = {}) {
      this.onConfirm = options.onConfirm || null;
      this.existingFileIds = options.existingFileIds || [];
      // 2026-05-31: existingFileTypes {[id]: 'video'|'image'} — caller pass để pre-select
      // biết type, _countSelectionsByType count đúng. Nếu thiếu → default 'image' (legacy).
      this.existingFileTypes = options.existingFileTypes || {};
      this.singleSelect = options.singleSelect || false;
      this.mediaFilter = options.mediaFilter || null; // 'image' | 'video' | null (all)
      // 2026-05-27: ref_video model (vd Omni Flash) → cho phép chọn + upload CẢ video.
      // allowVideo=true: bỏ filter chỉ-ảnh (show image + video) + file input accept thêm video/*.
      this.allowVideo = options.allowVideo || false;
      if (this.allowVideo && this.mediaFilter === 'image') {
        this.mediaFilter = null; // show cả image lẫn video
      }
      // CG-5.5: ChatGPT provider — ẩn tab "Ảnh trên Flow", chỉ giữ Album + Upload
      this.hideFlowTilePicker = options.hideFlowTilePicker || false;
      // Post-audit fix: cap số ảnh chọn theo provider capabilities.
      // null = unlimited. 0 = model không hỗ trợ ref (vd Veo 3.1 Quality) → render banner block selection.
      // Có thể truyền trực tiếp hoặc resolve qua ImagePickerModal.resolveMaxSelections({ modelValue }).
      if (options.maxSelections === 0) {
        this.maxSelections = 0;
      } else if (typeof options.maxSelections === 'number' && options.maxSelections > 0) {
        this.maxSelections = options.maxSelections;
      } else {
        this.maxSelections = null;
      }
      // 2026-05-31: multi-cap enforcement {image, video, total} — vd Omni Flash {7,1,7}.
      // maxImageSelections cũng dùng làm fallback cho maxSelections (legacy alias).
      this.maxImageSelections = (typeof options.maxImageSelections === 'number')
        ? options.maxImageSelections
        : this.maxSelections; // backward compat
      this.maxVideoSelections = (typeof options.maxVideoSelections === 'number')
        ? options.maxVideoSelections
        : 0; // default: không cho video nếu caller không pass
      this.maxTotalSelections = (typeof options.maxTotalSelections === 'number')
        ? options.maxTotalSelections
        : null;
      // Optional context cho banner khi maxSelections=0 (model không support ref).
      this.noRefSupportContext = options.noRefSupportContext || null; // { provider, modelValue }
      this.uploadedImages = [];
      this.albumData = [];
      this._albumBlobUrls = []; // Track blob URLs for cleanup
      this.selectedImages = new Map();
      this._confirming = false; // Reset double-click guard
      this._visibleCount = 20; // Lazy load: show first 20, load more on scroll
      this._visibleAlbumCount = 3; // Lazy load: show first 3 albums
      this._collapsedAlbums = this._collapsedAlbums || new Set(); // Preserve collapsed state
      this._needsFullRerender = false;

      // Pre-select existing (skip nếu maxSelections=0 — model không hỗ trợ ref → confirm-empty = clear refs)
      if (this.maxSelections !== 0) {
        this.existingFileIds.forEach(fid => {
          const id = fid.trim();
          if (!id) return;
          // Type lookup: caller-supplied existingFileTypes > 'image' default
          // → _countSelectionsByType count đúng cho multi-cap enforcement.
          const knownType = this.existingFileTypes[id] === 'video' ? 'video' : 'image';
          this.selectedImages.set(id, {
            fileId: id,
            thumbnail: null,
            source: 'existing',
            type: knownType,
          });
        });
      }

      this.render();
      this.bindEvents();
      this.updateSelectedCount(); // Update count ngay sau render với existingFileIds

      // Reset loading flag and generate new session ID to cancel stale loads
      this._isLoadingAlbums = false;
      this._loadSessionId = Date.now();

      // Default tab là Album → load albums ngay
      this._loadAlbums();

      // Flow tab: dùng cache nếu có, lazy scan khi chuyển sang tab flow
      if (ImagePickerModal._cachedFlowImages && ImagePickerModal._cachedFlowImages.length > 0) {
        this.flowImages = ImagePickerModal._cachedFlowImages;
        const filtered = this._getFilteredFlowImages();
        const countEl = this.overlay?.querySelector('#flowImageCount');
        if (countEl) countEl.textContent = filtered.length;
      }
    }

    close() {
      if (this._escHandler) {
        document.removeEventListener('keydown', this._escHandler);
        this._escHandler = null;
      }
      // [Bug fix 2026-06-06] KHÔNG revoke `_albumBlobUrls` ở đây.
      // Lý do: URL trong `_albumBlobUrls` đến từ `ImageStore.getThumbnail(imageId)` (line 1523)
      // → URL được track bởi BlobUrlManager + cache trong ThumbnailCache (shared cross-component).
      // Revoke ở modal close sẽ kill URL đang được dùng bởi:
      //   - ThumbnailCache (cache hit lần sau trả URL revoked)
      //   - GenTab.thumbnailCache (vừa set trong onConfirm với URL same)
      // → Thumbnail album local KHÔNG hiển thị sau khi modal đóng.
      // Lifecycle URL đã được BlobUrlManager auto cleanup (5 min stale URLs).
      // Chỉ clear reference list (memory cleanup), không revoke URL.
      if (this._albumBlobUrls) {
        this._albumBlobUrls = [];
      }
      if (this.overlay) {
        this.overlay.remove();
        this.overlay = null;
      }
    }

    render() {
      this.close();

      this.overlay = document.createElement('div');
      this.overlay.className = 'imgpicker-overlay';
      this.overlay.innerHTML = `
        <div class="imgpicker-modal">
          <div class="imgpicker-header">
            <h3 class="imgpicker-title">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <polyline points="21 15 16 10 5 21"></polyline>
              </svg>
              ${window.I18n?.t('imagePicker.selectRefImages') || 'Chọn ảnh tham chiếu'}
            </h3>
            <button class="imgpicker-close" id="imgpickerClose">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          ${this.maxSelections === 0 ? this._renderNoRefBanner() : ''}

          <div class="imgpicker-tabs">
            <button class="imgpicker-tab active" data-tab="album">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              Album
              <span class="imgpicker-tab-count" id="albumImageCount">0</span>
            </button>
            <button class="imgpicker-tab" data-tab="flow">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="7" height="7"></rect>
                <rect x="14" y="3" width="7" height="7"></rect>
                <rect x="3" y="14" width="7" height="7"></rect>
                <rect x="14" y="14" width="7" height="7"></rect>
              </svg>
              ${window.I18n?.t('imagePicker.flow') || 'Ảnh trên Flow'}
              <span class="imgpicker-tab-count" id="flowImageCount">0</span>
            </button>
            <button class="imgpicker-tab" data-tab="upload">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="17 8 12 3 7 8"></polyline>
                <line x1="12" y1="3" x2="12" y2="15"></line>
              </svg>
              Upload
              <span class="imgpicker-tab-count" id="uploadImageCount">0</span>
            </button>
          </div>

          <div class="imgpicker-content">
            <!-- Album Tab -->
            <div class="imgpicker-pane active" id="paneAlbum">
              <div class="imgpicker-album-container" id="albumContainer">
                <div class="imgpicker-loading">${window.I18n?.t('imagePicker.loadingAlbums') || 'Đang tải album...'}</div>
              </div>
            </div>

            <!-- Flow Images Tab -->
            <div class="imgpicker-pane" id="paneFlow">
              <div class="imgpicker-toolbar">
                <button class="btn btn-secondary btn-sm" id="scanFlowBtn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10"></polyline>
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                  </svg>
                  ${window.I18n?.t('imagePicker.rescan') || 'Quét lại'}
                </button>
                <span class="imgpicker-hint" id="flowScanStatus">${window.I18n?.t('imagePicker.scanning') || 'Đang quét...'}</span>
              </div>
              <div class="imgpicker-grid" id="flowImageGrid">
                <!-- Flow images loaded here -->
              </div>
            </div>

            <!-- Upload Tab -->
            <div class="imgpicker-pane" id="paneUpload">
              <div class="imgpicker-drop-zone" id="imgpickerDropZone">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M15 8h.01"></path>
                  <path d="M12.5 21h-6.5a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v6.5"></path>
                  <path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l3.5 3.5"></path>
                  <path d="M14 14l1 -1c.679 -.653 1.473 -.829 2.214 -.526"></path>
                  <path d="M19 22v-6"></path>
                  <path d="M22 19l-3 -3l-3 3"></path>
                </svg>
                <p>${window.I18n?.t('imagePicker.dragDropHere') || 'Kéo thả ảnh vào đây'}</p>
                <span>${window.I18n?.t('imagePicker.orText') || 'hoặc'}</span>
                <button class="btn btn-secondary btn-sm" id="imgpickerBrowseBtn" type="button">${window.I18n?.t('imagePicker.orSelectFromComputer') || 'Chọn từ máy tính'}</button>
                <input type="file" id="imgpickerFileInput" multiple accept="${this.allowVideo ? 'image/*,video/*' : 'image/*'}" style="display:none;" />
              </div>
              <div class="imgpicker-grid" id="uploadImageGrid">
                <!-- Uploaded images here -->
              </div>
            </div>
          </div>

          <div class="imgpicker-footer">
            <div class="imgpicker-selected-info" id="imgpickerSelectedInfo">
              ${window.I18n?.t('imagePicker.selectedCount', { count: '<span id="selectedCount">0</span>' }) || '<span id="selectedCount">0</span> ảnh đã chọn'}
            </div>
            <div class="imgpicker-footer-actions">
              <button class="btn btn-secondary" id="imgpickerCancelBtn">${window.I18n?.t('imagePicker.cancel') || 'Hủy'}</button>
              <button class="btn btn-primary" id="imgpickerConfirmBtn">${window.I18n?.t('imagePicker.confirm') || 'Xác nhận'}</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(this.overlay);
    }

    bindEvents() {
      if (!this.overlay) return;

      // Close
      this.overlay.querySelector('#imgpickerClose')?.addEventListener('click', () => this.close());
      this.overlay.querySelector('#imgpickerCancelBtn')?.addEventListener('click', () => this.close());
      this.overlay.addEventListener('click', (e) => {
        if (e.target === this.overlay) this.close();
      });

      // ESC
      this._escHandler = (e) => {
        if (e.key === 'Escape') this.close();
      };
      document.addEventListener('keydown', this._escHandler);

      // CG-5.5: Ẩn tab "Ảnh trên Flow" khi provider=chatgpt (hideFlowTilePicker=true)
      if (this.hideFlowTilePicker) {
        const flowTab = this.overlay.querySelector('.imgpicker-tab[data-tab="flow"]');
        if (flowTab) flowTab.style.display = 'none';
        const flowPane = this.overlay.querySelector('#paneFlow');
        if (flowPane) flowPane.style.display = 'none';
      }

      // Tab switching
      this.overlay.querySelectorAll('.imgpicker-tab').forEach(tab => {
        tab.addEventListener('click', () => {
          const tabId = tab.dataset.tab;
          // CG-5.5: chặn không cho click vào flow tab khi đã ẩn
          if (this.hideFlowTilePicker && tabId === 'flow') return;
          this.switchTab(tabId);
        });
      });

      // Scan button
      this.overlay.querySelector('#scanFlowBtn')?.addEventListener('click', () => this.scanFlowImages());

      // Upload - browse
      const browseBtn = this.overlay.querySelector('#imgpickerBrowseBtn');
      const fileInput = this.overlay.querySelector('#imgpickerFileInput');
      log('bindEvents: browseBtn=', !!browseBtn, 'fileInput=', !!fileInput);
      if (browseBtn && fileInput) {
        browseBtn.addEventListener('click', () => {
          log('browseBtn clicked, calling fileInput.click()');
          fileInput.click();
        });
        fileInput.addEventListener('change', (e) => {
          log('fileInput change, files:', e.target.files.length);
          this.handleUpload(Array.from(e.target.files));
          fileInput.value = '';
        });
      }

      // Upload - drag & drop
      const dropZone = this.overlay.querySelector('#imgpickerDropZone');
      dropZone?.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
      });
      dropZone?.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
      });
      dropZone?.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        const files = Array.from(e.dataTransfer.files).filter(f =>
          f.type.startsWith('image/') || (this.allowVideo && f.type.startsWith('video/')));
        this.handleUpload(files);
      });
      // Click bất kỳ chỗ nào trên drop zone (trừ button "Chọn từ máy tính") → mở file dialog
      // Browse button đã có handler riêng (line ~263), tránh double-trigger qua e.target.closest
      dropZone?.addEventListener('click', (e) => {
        if (e.target.closest('#imgpickerBrowseBtn')) return;
        if (fileInput) fileInput.click();
      });

      // Confirm
      this.overlay.querySelector('#imgpickerConfirmBtn')?.addEventListener('click', () => {
        this.confirm();
      });
    }

    switchTab(tabId) {
      this.activeTab = tabId;
      const tabs = this.overlay?.querySelectorAll('.imgpicker-tab');
      const panes = this.overlay?.querySelectorAll('.imgpicker-pane');

      const paneMap = { flow: 'paneFlow', album: 'paneAlbum', upload: 'paneUpload' };
      tabs?.forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
      panes?.forEach(p => {
        p.classList.toggle('active', p.id === paneMap[tabId]);
      });

      // Lazy-load: album data khi chuyển sang tab album lần đầu
      if (tabId === 'album' && this.albumData.length === 0) {
        this._loadAlbums();
      }
      // Lazy-load: flow images khi chuyển sang tab flow lần đầu
      if (tabId === 'flow' && this.flowImages.length === 0) {
        this.scanFlowImages();
      } else if (tabId === 'flow' && this.flowImages.length > 0) {
        // Đã có cache → render grid + background refresh
        this._renderFlowGrid();
        this._backgroundScan();
      }
    }

    // ===== Flow Images =====

    async scanFlowImages() {
      const statusEl = this.overlay?.querySelector('#flowScanStatus');
      const gridEl = this.overlay?.querySelector('#flowImageGrid');
      const countEl = this.overlay?.querySelector('#flowImageCount');
      if (!gridEl) return;

      if (statusEl) statusEl.textContent = window.I18n?.t('imagePicker.activatingTab') || 'Đang kích hoạt tab...';
      // Show skeleton placeholders while scanning
      gridEl.innerHTML = Array.from({ length: 12 }, () => '<div class="imgpicker-skeleton"></div>').join('');

      // Ensure Flow tab is active before scanning (Chrome throttles inactive tabs)
      try {
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'ensureFlowTabReady' }, () => resolve());
        });
        // Small delay for tab to fully activate
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        log('ensureFlowTabReady failed:', err.message);
      }

      if (statusEl) statusEl.textContent = window.I18n?.t('imagePicker.scanning') || 'Đang quét...';

      // Retry scan tối đa 2 lần (đôi khi content script chưa sẵn sàng)
      const MAX_RETRIES = 2;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          if (window.MessageBridge) {
            const result = await MessageBridge.scanFlowImages();
            this.flowImages = result?.images || [];
          } else {
            this.flowImages = this._scanPageImages();
          }
        } catch (err) {
          log('Scan attempt', attempt + 1, 'failed:', err.message);
          this.flowImages = this._scanPageImages();
        }

        if (this.flowImages.length > 0 || attempt >= MAX_RETRIES) break;
        // Chờ 1s trước khi retry (tiles có thể đang load)
        if (statusEl) statusEl.textContent = window.I18n?.t('imagePicker.waitingImages') || 'Đang chờ ảnh tải...';
        await new Promise(r => setTimeout(r, 1000));
      }

      log('Found', this.flowImages.length, 'images on Flow');

      const filtered = this._getFilteredFlowImages();
      if (countEl) countEl.textContent = filtered.length;

      if (filtered.length === 0) {
        const noFoundKey = this.mediaFilter === 'video' ? 'imagePicker.noVideosFound' : 'imagePicker.noImagesFound';
        const noFoundFallback = this.mediaFilter === 'video' ? 'Không tìm thấy video nào trên trang Flow' : 'Không tìm thấy ảnh nào trên trang Flow';
        gridEl.innerHTML = `<div class="imgpicker-empty">${window.I18n?.t(noFoundKey) || noFoundFallback}</div>`;
        const mediaType = this.mediaFilter === 'video' ? 'video' : (window.I18n?.t('common.images') || 'ảnh');
        if (statusEl) statusEl.textContent = window.I18n?.t('imagePicker.noMedia', { type: mediaType }) || `Không có ${mediaType}`;
        return;
      }

      if (statusEl) statusEl.textContent = window.I18n?.t('imagePicker.foundImages', { count: filtered.length }) || `Tìm thấy ${filtered.length} ảnh`;
      // Cache for instant re-open
      ImagePickerModal._cachedFlowImages = this.flowImages;
      this._visibleCount = 20;
      this._deepScanned = false; // Fix D: cho phép deep-scan lại sau mỗi lần quét nông mới
      this._renderFlowGrid();
    }

    async _backgroundScan() {
      try {
        // Ensure Flow tab is active before scanning
        await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'ensureFlowTabReady' }, () => resolve());
        });
        await new Promise(r => setTimeout(r, 200));

        let images = [];
        if (window.MessageBridge) {
          const result = await MessageBridge.scanFlowImages();
          images = result?.images || [];
        } else {
          images = this._scanPageImages();
        }
        if (images.length > 0) {
          this.flowImages = images;
          ImagePickerModal._cachedFlowImages = images;
          const filtered = this._getFilteredFlowImages();
          const countEl = this.overlay?.querySelector('#flowImageCount');
          if (countEl) countEl.textContent = filtered.length;
          const statusEl = this.overlay?.querySelector('#flowScanStatus');
          if (statusEl) statusEl.textContent = window.I18n?.t('imagePicker.foundImages', { count: filtered.length }) || `Tìm thấy ${filtered.length} ảnh`;
          this._visibleCount = 20;
          this._deepScanned = false; // Fix D: reset cho phép deep-scan sau quét nông
          this._needsFullRerender = true;
          this._renderFlowGrid();
        }
      } catch (e) {
        log('Background scan failed:', e.message);
      }
    }

    _scanPageImages() {
      const images = [];
      const seenIds = new Set();

      // Scan tiles trên Google Flow page (Strict Server-Only: từ content.js helper).
      // Flow dùng div[data-tile-id="fe_id_UUID"] cho mỗi generation.
      const tileSelector = window._getTileSelectorString?.() || '[data-tile-id]';
      const tiles = document.querySelectorAll(tileSelector);
      tiles.forEach(tile => {
        const tileId = tile.dataset.tileId;
        if (!tileId || seenIds.has(tileId)) return;

        // Tìm ảnh/video trong tile
        const img = tile.querySelector('img');
        const video = tile.querySelector('video');

        // Chỉ lấy ảnh generated (alt="Hình ảnh được tạo") hoặc video
        if (img && img.src && !img.src.includes('chrome-extension')) {
          seenIds.add(tileId);
          images.push({
            fileId: tileId,
            thumbnail: img.src,
            source: 'flow',
            type: 'image'
          });
        } else if (video && video.src) {
          seenIds.add(tileId);
          // 2026-05-30 bug fix: video.src là URL .mp4/.webm → KHÔNG render được trong <img>.
          // Chỉ dùng poster (image URL). Nếu video KHÔNG có poster → thumbnail='' → render
          // dùng video icon placeholder fallback ở UI render layer.
          images.push({
            fileId: tileId,
            thumbnail: video.poster || '',
            source: 'flow',
            type: 'video'
          });
        }
      });

      if (images.length === 0) {
        const _mp = window._getMediaUrlPattern?.() || 'getMediaUrlRedirect';
        const allImgs = document.querySelectorAll(`img[src*="${_mp}"], img[src*="lh3"], img[src*="googleusercontent"]`);
        allImgs.forEach((img, i) => {
          const src = img.src;
          if (!src || src.includes('chrome-extension') || img.naturalWidth < 50) return;

          const parentTile = img.closest(tileSelector);
          const fileId = parentTile?.dataset?.tileId || `flow_img_${i}`;
          if (seenIds.has(fileId)) return;
          seenIds.add(fileId);

          images.push({
            fileId,
            thumbnail: src,
            source: 'flow',
            type: 'image'
          });
        });
      }

      return images;
    }

    _renderChunked(items, container) {
      const CHUNK_SIZE = 5;
      let offset = 0;
      const startIndex = container.querySelectorAll('.imgpicker-item').length;

      const renderNextChunk = () => {
        if (offset >= items.length) {
          this._bindGridEvents(container, 'flow', startIndex);
          this._bindImageLoadEvents(container);
          return;
        }
        const chunk = items.slice(offset, offset + CHUNK_SIZE);
        const fragment = document.createDocumentFragment();
        const temp = document.createElement('div');
        temp.innerHTML = chunk.map(img => this._createImageItemHTML(img)).join('');
        while (temp.firstChild) fragment.appendChild(temp.firstChild);
        container.appendChild(fragment);
        // Bind load events cho chunk vừa append (không chờ đến cuối)
        this._bindImageLoadEvents(container);
        offset += CHUNK_SIZE;
        requestAnimationFrame(renderNextChunk);
      };

      requestAnimationFrame(renderNextChunk);
    }

    _getFilteredFlowImages() {
      if (!this.mediaFilter) return this.flowImages;
      return this.flowImages.filter(img => img.type === this.mediaFilter);
    }

    _renderFlowGrid() {
      const gridEl = this.overlay?.querySelector('#flowImageGrid');
      if (!gridEl) return;

      const filtered = this._getFilteredFlowImages();
      const renderedCount = gridEl.querySelectorAll('.imgpicker-item').length;
      const targetCount = Math.min(this._visibleCount, filtered.length);

      if (renderedCount === 0 || this._needsFullRerender) {
        this._needsFullRerender = false;
        gridEl.innerHTML = '';
        const visible = filtered.slice(0, targetCount);
        this._renderChunked(visible, gridEl);
      } else if (targetCount > renderedCount) {
        const loadMoreEl = gridEl.querySelector('#imgpickerLoadMore');
        if (loadMoreEl) loadMoreEl.remove();

        const newItems = filtered.slice(renderedCount, targetCount);
        const fragment = document.createDocumentFragment();
        const temp = document.createElement('div');
        temp.innerHTML = newItems.map(img => this._createImageItemHTML(img)).join('');
        while (temp.firstChild) fragment.appendChild(temp.firstChild);
        gridEl.appendChild(fragment);
        this._bindGridEvents(gridEl, 'flow', renderedCount);
        this._bindImageLoadEvents(gridEl);
      }

      // Update load-more button
      const existingLoadMore = gridEl.querySelector('#imgpickerLoadMore');
      if (existingLoadMore) existingLoadMore.remove();

      const hasMore = filtered.length > targetCount;
      if (hasMore) {
        const remaining = filtered.length - targetCount;
        gridEl.insertAdjacentHTML('beforeend',
          `<div class="imgpicker-load-more" id="imgpickerLoadMore">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="16"></line>
              <line x1="8" y1="12" x2="16" y2="12"></line>
            </svg>
            <span>${window.I18n?.t('imagePicker.viewMore', { count: remaining }) || `Xem thêm ${remaining} ảnh`}</span>
            <svg class="imgpicker-load-more-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>`
        );
        gridEl.querySelector('#imgpickerLoadMore')?.addEventListener('click', () => {
          this._visibleCount += 20;
          this._renderFlowGrid();
        });
      } else if (!this._deepScanned && !this._deepScanning) {
        // Fix D: đã hiện hết ảnh ĐÃ quét (260 đầu) → nút quét sâu toàn bộ Flow (scroll page).
        gridEl.insertAdjacentHTML('beforeend',
          `<div class="imgpicker-load-more" id="imgpickerDeepScan">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            <span>${window.I18n?.t('imagePicker.deepScan') || 'Quét thêm ảnh ở cuối Flow'}</span>
          </div>`
        );
        gridEl.querySelector('#imgpickerDeepScan')?.addEventListener('click', () => this._deepScanFlow());
      }

      // Scroll-based lazy load (throttled)
      const pane = this.overlay?.querySelector('#paneFlow');
      if (pane && !pane._scrollBound) {
        pane._scrollBound = true;
        let scrollTimer = null;
        pane.addEventListener('scroll', () => {
          if (scrollTimer) return; // Throttle: skip if pending
          scrollTimer = setTimeout(() => {
            scrollTimer = null;
            const { scrollTop, scrollHeight, clientHeight } = pane;
            if (scrollTop + clientHeight < scrollHeight - 100) return; // chưa tới cuối
            if (this._visibleCount < this.flowImages.length) {
              this._visibleCount += 20;
              this._renderFlowGrid();
            } else if (!this._deepScanned && !this._deepScanning) {
              // Tới cuối + đã hết ảnh quét nông → tự deep-scan 1 lần (on-demand)
              this._deepScanFlow();
            }
          }, 150);
        });
      }
    }

    /**
     * Fix D (2026-06-15): deep-scan toàn bộ Flow library — scroll Flow page + tích luỹ tile.
     * On-demand: gọi khi user cuộn tới cuối hoặc bấm nút. Chạy 1 lần / phiên scan (_deepScanned).
     */
    async _deepScanFlow() {
      if (this._deepScanning || this._deepScanned || !window.MessageBridge) return;
      this._deepScanning = true;
      const gridEl = this.overlay?.querySelector('#flowImageGrid');
      const statusEl = this.overlay?.querySelector('#flowScanStatus');
      const btnSpan = gridEl?.querySelector('#imgpickerDeepScan span');
      const scanningTxt = window.I18n?.t('imagePicker.deepScanning') || 'Đang quét toàn bộ Flow...';
      if (btnSpan) btnSpan.textContent = scanningTxt;
      if (statusEl) statusEl.textContent = scanningTxt;
      try {
        await new Promise((resolve) => { chrome.runtime.sendMessage({ action: 'ensureFlowTabReady' }, () => resolve()); });
        await new Promise(r => setTimeout(r, 200));
        const result = await MessageBridge.scanFlowImages(true);
        const images = result?.images || [];
        if (images.length > (this.flowImages?.length || 0)) {
          this.flowImages = images;
          ImagePickerModal._cachedFlowImages = images;
        }
        this._deepScanned = true;
        this._visibleCount += 20;
        this._needsFullRerender = true;
        this._renderFlowGrid();
        const filtered = this._getFilteredFlowImages();
        const countEl = this.overlay?.querySelector('#flowImageCount');
        if (countEl) countEl.textContent = filtered.length;
        if (statusEl) statusEl.textContent = window.I18n?.t('imagePicker.foundImages', { count: filtered.length }) || `Tìm thấy ${filtered.length} ảnh`;
      } catch (e) {
        log('Deep scan failed:', e.message);
        this._deepScanned = true; // tránh lặp vô hạn khi lỗi
        if (statusEl) statusEl.textContent = window.I18n?.t('imagePicker.scanError') || 'Lỗi quét';
      } finally {
        this._deepScanning = false;
      }
    }

    /**
     * Generate HTML for a single image grid item
     * @private
     */
    _createImageItemHTML(img) {
      const isSelected = this.selectedImages.has(img.fileId);
      const isExisting = this.existingFileIds.includes(img.fileId);
      // Video tile: dùng <video preload=metadata muted playsinline>. Flow URL
      // `getMediaUrlRedirect` trả mp4 bytes cho video → <img> KHÔNG render được.
      const isVideo = img.type === 'video';
      const videoUrl = img.video_url || '';
      const mediaHtml = (isVideo && videoUrl)
        ? `<video src="${this._safeMediaUrl(videoUrl)}" class="imgpicker-video-preview" muted playsinline preload="metadata" aria-label="Video"></video>`
        : `<img src="${this._safeMediaUrl(img.thumbnail)}" alt="Flow image" loading="lazy" />`;
      return `
        <div class="imgpicker-item ${(isVideo && videoUrl) ? '' : 'imgpicker-item--loading'} ${isSelected ? 'selected' : ''} ${isExisting ? 'imgpicker-item--existing' : ''}" data-file-id="${this._escapeHtml(img.fileId)}" data-source="flow">
          ${mediaHtml}
          <div class="imgpicker-item-overlay">
            <div class="imgpicker-item-check">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </div>
          </div>
          ${isVideo ? '<div class="imgpicker-item-badge">Video</div>' : ''}
          <div class="imgpicker-item-id">${this._escapeHtml(img.fileId.substring(0, 12))}...</div>
        </div>
      `;
    }

    /**
     * Bind load/error events cho img elements trong container
     * Thay thế inline onload/onerror (bị CSP block trong Chrome Extension MV3)
     */
    _bindImageLoadEvents(container) {
      const items = container.querySelectorAll('.imgpicker-item--loading');
      for (const item of items) {
        const img = item.querySelector('img');
        if (!img || img._loadBound) continue;
        img._loadBound = true;
        img.addEventListener('load', () => {
          item.classList.remove('imgpicker-item--loading');
          item.classList.add('imgpicker-item--loaded');
        });
        img.addEventListener('error', () => {
          item.classList.remove('imgpicker-item--loading');
        });
        // Ảnh đã cached (complete trước khi bind) → xử lý ngay
        if (img.complete && img.naturalWidth > 0) {
          item.classList.remove('imgpicker-item--loading');
          item.classList.add('imgpicker-item--loaded');
        }
      }
      // Video preview: seek về first frame (0.1s) sau khi metadata load → show static frame
      const videos = container.querySelectorAll('.imgpicker-video-preview');
      for (const video of videos) {
        if (video._loadBound) continue;
        video._loadBound = true;
        video.addEventListener('loadedmetadata', () => { try { video.currentTime = 0.1; } catch (_) { globalThis.SEOSONA_swallow?.('ImagePickerModal#_bindImageLoadEvents', _); } }, { once: true });
      }
    }

    // ===== Upload Images =====

    /**
     * Tạo thumbnail nén từ File object qua canvas
     * Resize max 200px, output JPEG quality 0.7
     * Giảm từ ~6MB base64 xuống ~10-30KB
     */
    _createThumbnail(file, maxSize = 200) {
      // Video file: <img> không load được → capture 1 frame qua <video> + canvas.
      if (file.type?.startsWith('video/')) return this._createVideoThumbnail(file, maxSize);
      return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        let timer = setTimeout(() => {
          timer = null;
          URL.revokeObjectURL(url);
          resolve(null);
        }, 10000);
        img.onload = () => {
          if (!timer) return;
          clearTimeout(timer);
          const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);

          const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
          URL.revokeObjectURL(url);
          resolve(thumbnail);
        };
        img.onerror = () => {
          if (!timer) return;
          clearTimeout(timer);
          URL.revokeObjectURL(url);
          resolve(null);
        };
        img.src = url;
      });
    }

    /**
     * Tạo thumbnail từ video File: seek ~0.1s lấy frame đầu (tránh frame đen),
     * vẽ ra canvas → JPEG dataURL. Trả null nếu lỗi/timeout (caller skip file đó).
     */
    _createVideoThumbnail(file, maxSize = 200) {
      return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'metadata';
        let done = false;
        const timer = setTimeout(() => finish(null), 10000);
        const finish = (result) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          URL.revokeObjectURL(url);
          resolve(result);
        };
        const capture = () => {
          try {
            const vw = video.videoWidth, vh = video.videoHeight;
            if (!vw || !vh) return finish(null);
            const scale = Math.min(maxSize / vw, maxSize / vh, 1);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(vw * scale);
            canvas.height = Math.round(vh * scale);
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
            finish(canvas.toDataURL('image/jpeg', 0.7));
          } catch (e) {
            finish(null);
          }
        };
        video.onloadeddata = () => {
          try { video.currentTime = Math.min(0.1, video.duration || 0.1); }
          catch (e) { capture(); }
        };
        video.onseeked = capture;
        video.onerror = () => finish(null);
        video.src = url;
      });
    }

    async handleUpload(files) {
      log('handleUpload called with', files.length, 'files');
      for (const file of files) {
        const key = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const thumbnail = await this._createThumbnail(file);

        if (!thumbnail) {
          log('Failed to create thumbnail for', file.name);
          continue;
        }

        const imgData = {
          key,
          file,
          thumbnail,
          source: 'upload',
          file_name: file.name,
          type: file.type?.startsWith('video/') ? 'video' : 'image'
        };
        this.uploadedImages.push(imgData);

        // Single select: clear previous selections
        if (this.singleSelect) {
          this.selectedImages.clear();
          this.overlay?.querySelectorAll('.imgpicker-item.selected').forEach(el => {
            el.classList.remove('selected');
          });
        }

        // Post-audit fix: skip auto-select nếu đã đạt maxSelections (upload vẫn vào grid nhưng không auto-select).
        if (!this.singleSelect && this.maxSelections !== null
            && this.selectedImages.size >= this.maxSelections) {
          if (this.maxSelections === 0) this._showNoRefSupportWarning();
          else this._showMaxReachedWarning();
          this._renderUploadGrid();
          const countEl = this.overlay?.querySelector('#uploadImageCount');
          if (countEl) countEl.textContent = this.uploadedImages.length;
          continue;
        }

        // Auto-select uploaded images
        // Giữ tên gốc (bỏ đuôi .jpg/.png) để đồng bộ với path drag/drop GenTab.
        this.selectedImages.set(key, {
          fileId: key,
          thumbnail,
          source: 'upload',
          file,
          type: imgData.type,
          file_name: file.name,
          name: file.name.replace(/\.[^/.]+$/, '')
        });

        this._renderUploadGrid();
        this.updateSelectedCount();

        const countEl = this.overlay?.querySelector('#uploadImageCount');
        if (countEl) countEl.textContent = this.uploadedImages.length;
      }
    }

    _renderUploadGrid() {
      const gridEl = this.overlay?.querySelector('#uploadImageGrid');
      if (!gridEl) return;

      gridEl.innerHTML = this.uploadedImages.map(img => {
        const isSelected = this.selectedImages.has(img.key);
        return `
          <div class="imgpicker-item ${isSelected ? 'selected' : ''}" data-file-id="${this._escapeHtml(img.key)}" data-source="upload">
            <img src="${this._safeMediaUrl(img.thumbnail)}" alt="${this._escapeHtml(img.file_name)}" />
            <div class="imgpicker-item-overlay">
              <div class="imgpicker-item-check">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
            </div>
            <button class="imgpicker-item-remove" data-key="${img.key}">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
            ${img.type === 'video' ? '<div class="imgpicker-item-badge">Video</div>' : ''}
            <div class="imgpicker-item-id">${this._escapeHtml(img.file_name.substring(0, 15))}</div>
          </div>
        `;
      }).join('');

      this._bindGridEvents(gridEl, 'upload');

      // Bind remove buttons
      gridEl.querySelectorAll('.imgpicker-item-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const key = btn.dataset.key;
          this.uploadedImages = this.uploadedImages.filter(img => img.key !== key);
          this.selectedImages.delete(key);
          this._renderUploadGrid();
          this.updateSelectedCount();
          const countEl = this.overlay?.querySelector('#uploadImageCount');
          if (countEl) countEl.textContent = this.uploadedImages.length;
        });
      });
    }

    // ===== Shared =====

    /**
     * Bind grid events - uses event delegation for robustness
     * Events are bound to the grid container, not individual items
     * This ensures clicks work even for slowly-loading images
     */
    _bindGridEvents(gridEl, source, startIndex = 0) {
      // Use event delegation - only bind once per grid
      const delegationKey = `_delegated_${source}`;
      if (gridEl[delegationKey]) return;
      gridEl[delegationKey] = true;

      gridEl.addEventListener('click', (e) => {
        const item = e.target.closest('.imgpicker-item');
        if (!item) return;

        // Skip if clicking remove button (upload tab)
        if (e.target.closest('.imgpicker-item-remove')) return;

        const fileId = item.dataset.fileId;
        const itemSource = item.dataset.source || source;

        if (this.selectedImages.has(fileId)) {
          this.selectedImages.delete(fileId);
          item.classList.remove('selected');
        } else {
          // Single select mode: deselect all others first
          if (this.singleSelect) {
            this.selectedImages.clear();
            this.overlay?.querySelectorAll('.imgpicker-item.selected').forEach(el => {
              el.classList.remove('selected');
            });
          }

          // Post-audit fix: enforce maxSelections (total alias) — không cho chọn quá limit
          if (!this.singleSelect && this.maxSelections !== null
              && this.selectedImages.size >= this.maxSelections) {
            if (this.maxSelections === 0) this._showNoRefSupportWarning();
            else this._showMaxReachedWarning();
            return;
          }
          // 2026-05-31: multi-cap enforcement riêng image vs video.
          // Detect type của item đang pick từ flowImages.type hoặc upload file type.
          let _pickType = 'image';
          if (itemSource === 'flow') {
            const _fi = this.flowImages.find(i => i.fileId === fileId);
            if (_fi?.type === 'video') _pickType = 'video';
          } else if (itemSource === 'upload') {
            const _up = this.uploadedImages.find(i => i.key === fileId);
            if (_up?.type === 'video' || (_up?.file?.type || '').startsWith('video/')) _pickType = 'video';
          }
          if (!this.singleSelect) {
            const _counts = this._countSelectionsByType();
            if (_pickType === 'video' && typeof this.maxVideoSelections === 'number'
                && _counts.video >= this.maxVideoSelections) {
              this._showMaxReachedWarning(`Tối đa ${this.maxVideoSelections} video ref`);
              return;
            }
            if (_pickType === 'image' && typeof this.maxImageSelections === 'number'
                && this.maxImageSelections !== null && _counts.image >= this.maxImageSelections) {
              this._showMaxReachedWarning(`Tối đa ${this.maxImageSelections} image ref`);
              return;
            }
            if (typeof this.maxTotalSelections === 'number'
                && (_counts.image + _counts.video) >= this.maxTotalSelections) {
              this._showMaxReachedWarning(`Tối đa ${this.maxTotalSelections} ref tổng`);
              return;
            }
          }

          // Find full data
          let imgData;
          if (itemSource === 'flow') {
            imgData = this.flowImages.find(i => i.fileId === fileId);
          } else if (itemSource === 'album') {
            // Tìm album image data
            const albumImgId = item.dataset.albumImageId;
            const status = item.dataset.status || 'stale';
            for (const entry of this.albumData) {
              const found = entry.images.find(i => (i.file_id || i.id) === fileId || i.id === albumImgId);
              if (found) {
                // Lấy thumbnail: ưu tiên thumbnail_url (CDN), fallback DOM img src (blob URL từ IndexedDB)
                let thumbSrc = found.thumbnail_url || null;
                if (!thumbSrc) {
                  const imgEl = item.querySelector('img');
                  if (imgEl && imgEl.src) thumbSrc = imgEl.src;
                }
                imgData = {
                  fileId: found.file_id || found.id,
                  thumbnail: thumbSrc,
                  source: 'album',
                  file_name: found.file_name || null,
                  thumbnail_url: found.thumbnail_url || null,
                  blob_key: found.blob_key || null,
                  album_image_id: found.id,
                  name: found.name || null,
                  _status: status
                };
                break;
              }
            }
          } else {
            const uploaded = this.uploadedImages.find(i => i.key === fileId);
            imgData = uploaded ? {
              fileId: uploaded.key,
              thumbnail: uploaded.thumbnail,
              source: 'upload',
              file: uploaded.file,
              type: uploaded.type || 'image'
            } : null;
          }

          if (imgData) {
            this.selectedImages.set(fileId, imgData);
            item.classList.add('selected');
          }
        }

        this.updateSelectedCount();
      });
    }

    updateSelectedCount() {
      const countEl = this.overlay?.querySelector('#selectedCount');
      if (countEl) {
        // Post-audit fix: hiển thị "X / Y" khi có maxSelections
        countEl.textContent = this.maxSelections !== null
          ? `${this.selectedImages.size} / ${this.maxSelections}`
          : this.selectedImages.size;
      }

      // Visual feedback: dim non-selected items khi đã đạt max
      if (this.maxSelections !== null && !this.singleSelect) {
        const reached = this.selectedImages.size >= this.maxSelections;
        this.overlay?.querySelectorAll('.imgpicker-item').forEach(el => {
          if (!el.classList.contains('selected')) {
            el.classList.toggle('imgpicker-item--disabled', reached);
          }
        });
      }
    }

    /**
     * Post-audit fix: hiển thị warning khi user cố chọn quá maxSelections.
     * Dùng SEOSONANotify nếu available, fallback console.
     */
    _showMaxReachedWarning(customMsg = null) {
      let msg = customMsg;
      if (!msg) {
        const max = this.maxSelections;
        const translated = window.I18n?.t('imagePicker.maxReached', { max });
        const isValidTranslation = translated && translated !== 'imagePicker.maxReached';
        msg = isValidTranslation
          ? translated
          : `Đã đạt giới hạn ${max} ảnh tham chiếu. Bỏ chọn ảnh khác trước khi chọn thêm.`;
      }
      if (window.SEOSONANotify?.warning) {
        window.SEOSONANotify.warning(msg);
      } else if (window.showNotification) {
        window.showNotification(msg, 'warning');
      } else {
        console.warn('[ImagePickerModal]', msg);
      }
    }

    /**
     * 2026-05-31: Đếm selectedImages theo type (image/video) cho multi-cap enforcement.
     */
    _countSelectionsByType() {
      let image = 0, video = 0;
      for (const data of this.selectedImages.values()) {
        if (data?.type === 'video' || (data?.file?.type || '').startsWith('video/')) video++;
        else image++;
      }
      return { image, video };
    }

    /**
     * 2026-05-22: Render banner HTML khi model không hỗ trợ ref images.
     * 2 dòng: header (model name) + hint (gợi ý switch model — DỰA TRÊN ModelRegistry actual).
     * I18n: dùng key DB nếu có, fallback locale-aware string cứng.
     *
     * Suggestion DYNAMIC: query ModelRegistry + adapter.supportsRefImages cho cùng media_type,
     * exclude current model, list models có supportsRefImages=true. KHÔNG hardcode "Lite/Fast".
     */
    _renderNoRefBanner() {
      const model = this.noRefSupportContext?.modelValue || '';
      const provider = String(this.noRefSupportContext?.provider || '').toLowerCase();
      const mediaType = this.noRefSupportContext?.mediaType || 'video'; // 'image' | 'video'
      const inputType = this.noRefSupportContext?.inputType; // 'Ingredients' | 'Frames' | undefined
      const locale = window.I18n?._currentLocale || 'vi';

      // Helper: i18n.t() returns key string khi miss → check khác key.
      const tt = (k, params) => {
        const v = window.I18n?.t?.(k, params);
        return (v && v !== k) ? v : null;
      };

      // Primary message
      const FALLBACK_HEADER = {
        vi: `Model "${model}" không hỗ trợ ảnh tham chiếu.`,
        en: `Model "${model}" does not support reference images.`,


      };
      const header = tt('imagePicker.modelNoRefSupport', { model }) || FALLBACK_HEADER[locale] || FALLBACK_HEADER.vi;

      // Dynamic suggestion: query ModelRegistry cho models cùng provider+media_type, filter supportsRefImages.
      const adapter = window.ProviderRegistry?.get?.(provider);
      const allModels = window.ModelRegistry?.safeGetModelsSync?.(provider, mediaType) || [];
      const supportingModels = allModels
        .filter(m => m && m.value && m.value !== model)
        .filter(m => {
          if (!adapter?.supportsRefImages) return true; // không có method → assume support
          try { return adapter.supportsRefImages(m.value, { inputType }); } catch (_) { return false; }
        })
        .map(m => (m.name || m.value).replace(/^Veo 3\.1 - /, 'Veo 3.1 ')); // friendly display

      // Build hint
      const FALLBACK_GENERIC = {
        vi: '→ Đổi model khác để dùng ref images.',
        en: '→ Switch model to use reference images.',


      };

      let hint;
      if (supportingModels.length === 0) {
        hint = tt('imagePicker.modelNoRefSupportSwitchGeneric') || FALLBACK_GENERIC[locale] || FALLBACK_GENERIC.vi;
      } else {
        const joiner = { vi: ' hoặc ', en: ' or ' }[locale] || ' hoặc ';
        const listText = supportingModels.join(joiner);
        const tail = {
          vi: ' để dùng ref.',
          en: ' to use refs.',


        }[locale] || ' để dùng ref.';
        hint = `→ ${listText}${tail}`;
      }

      return `
        <div class="imgpicker-banner imgpicker-banner--warning" id="imgpickerNoRefBanner">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div class="imgpicker-banner-body">
            <div class="imgpicker-banner-header">${this._escapeHtml(header)}</div>
            <div class="imgpicker-banner-hint">${this._escapeHtml(hint)}</div>
          </div>
        </div>
      `;
    }

    /**
     * 2026-05-22: Warning khi model không hỗ trợ ref images
     * (vd Veo 3.1 Quality, schema provider_models.config.supports_ref_images=false).
     */
    _showNoRefSupportWarning() {
      const model = this.noRefSupportContext?.modelValue || '';
      const locale = window.I18n?._currentLocale || 'vi';
      const FALLBACK = {
        vi: `Model "${model}" không hỗ trợ ảnh tham chiếu.`,
        en: `Model "${model}" does not support reference images.`,


      };
      const translated = window.I18n?.t?.('imagePicker.modelNoRefSupport', { model });
      const isValid = translated && translated !== 'imagePicker.modelNoRefSupport';
      const msg = isValid ? translated : (FALLBACK[locale] || FALLBACK.vi);
      if (window.SEOSONANotify?.warning) {
        window.SEOSONANotify.warning(msg);
      } else if (window.showNotification) {
        window.showNotification(msg, 'warning');
      } else {
        console.warn('[ImagePickerModal]', msg);
      }
    }

    confirm() {
      // Guard: prevent double-click
      if (this._confirming) return;
      this._confirming = true;

      const selected = Array.from(this.selectedImages.values());
      log('Confirmed', selected.length, 'images');

      if (this.onConfirm) {
        this.onConfirm(selected);
      }

      this.close();
    }

    // ===== Album Images =====

    async _loadAlbums() {
      // Guard: prevent concurrent calls (race condition)
      if (this._isLoadingAlbums) return;
      this._isLoadingAlbums = true;

      // Capture session ID to detect stale loads (modal reopened during async operations)
      const loadSessionId = this._loadSessionId;

      const container = this.overlay?.querySelector('#albumContainer');
      if (!container) {
        this._isLoadingAlbums = false;
        return;
      }

      container.innerHTML = `<div class="imgpicker-loading">${window.I18n?.t('imagePicker.loadingAlbums') || 'Đang tải album...'}</div>`;

      try {
        if (!window.AlbumStore || !window.ImageStore) {
          container.innerHTML = `<div class="imgpicker-empty">${window.I18n?.t('imagePicker.albumNotReady') || 'Album chưa sẵn sàng'}</div>`;
          this._isLoadingAlbums = false;
          return;
        }

        const albums = await window.AlbumStore.getAlbums();

        // Abort if modal was reopened (session changed)
        if (loadSessionId !== this._loadSessionId) {
          log('_loadAlbums aborted: session changed');
          return;
        }

        if (!albums || albums.length === 0) {
          container.innerHTML = `<div class="imgpicker-empty">${window.I18n?.t('imagePicker.noAlbumsAvailable') || 'Chưa có album nào'}</div>`;
          const countEl = this.overlay?.querySelector('#albumImageCount');
          if (countEl) countEl.textContent = '0';
          this._isLoadingAlbums = false;
          return;
        }

        // Load images cho từng album
        this.albumData = [];
        let totalImages = 0;
        for (const album of albums) {
          // Abort if modal was reopened
          if (loadSessionId !== this._loadSessionId) {
            log('_loadAlbums aborted mid-loop: session changed');
            return;
          }

          const images = await window.ImageStore.getAlbumImages(album.id);
          if (!images || images.length === 0) continue;

          // Batch check status
          const statuses = {};
          for (const img of images) {
            if (window.AlbumList && typeof window.AlbumList._checkImageStatus === 'function') {
              statuses[img.id] = await window.AlbumList._checkImageStatus(img);
            } else {
              // Standalone windows: check qua MessageBridge (tương tự AlbumList._checkImageStatus)
              statuses[img.id] = await this._checkAlbumImageStatus(img);
            }
          }

          this.albumData.push({ album, images, statuses });
          totalImages += images.length;
        }

        // Final abort check before render
        if (loadSessionId !== this._loadSessionId) {
          log('_loadAlbums aborted before render: session changed');
          return;
        }

        const countEl = this.overlay?.querySelector('#albumImageCount');
        if (countEl) countEl.textContent = totalImages;

        if (this.albumData.length === 0) {
          container.innerHTML = `<div class="imgpicker-empty">${window.I18n?.t('imagePicker.noImagesInAlbum') || 'Không có ảnh trong album này'}</div>`;
          this._isLoadingAlbums = false;
          return;
        }

        this._renderAlbumGrid();
        this._isLoadingAlbums = false;
      } catch (err) {
        log('Load albums error:', err.message);
        container.innerHTML = `<div class="imgpicker-empty">${window.I18n?.t('imagePicker.albumLoadError') || 'Không thể tải album'}</div>`;
        this._isLoadingAlbums = false;
      }
    }

    _renderAlbumGrid() {
      const container = this.overlay?.querySelector('#albumContainer');
      if (!container) return;

      container.innerHTML = '';

      // Lazy load: show first N albums, load more on click
      const ALBUMS_PER_PAGE = 3;
      if (!this._visibleAlbumCount) this._visibleAlbumCount = ALBUMS_PER_PAGE;

      // Dedup: remove duplicate albums by id (race condition safety)
      const seenAlbumIds = new Set();
      const dedupedAlbumData = this.albumData.filter(({ album }) => {
        if (seenAlbumIds.has(album.id)) return false;
        seenAlbumIds.add(album.id);
        return true;
      });

      const visibleAlbumData = dedupedAlbumData.filter(({ images, statuses }) => {
        return images.some(img => statuses[img.id] !== 'dead');
      });

      const albumsToShow = visibleAlbumData.slice(0, this._visibleAlbumCount);
      const hasMoreAlbums = visibleAlbumData.length > this._visibleAlbumCount;

      for (const { album, images, statuses } of albumsToShow) {
        // Filter: không hiện DEAD images
        const visibleImages = images.filter(img => statuses[img.id] !== 'dead');
        if (visibleImages.length === 0) continue;

        const section = document.createElement('div');
        section.className = 'imgpicker-album-section';
        section.dataset.albumId = album.id;

        // Restore collapsed state
        if (this._collapsedAlbums?.has(album.id)) {
          section.classList.add('collapsed');
        }

        // Album header with chevron toggle
        const header = document.createElement('div');
        header.className = 'imgpicker-album-header';

        const isCollapsed = this._collapsedAlbums?.has(album.id);
        const chevronSvg = `<div class="imgpicker-album-chevron"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></div>`;

        const titleHtml = `
          ${chevronSvg}
          <div class="imgpicker-album-info">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            <span class="imgpicker-album-name">${this._escapeHtml(album.name)}</span>
            <span class="imgpicker-album-count">${visibleImages.length}</span>
          </div>
        `;

        // Nút "Bỏ chọn" + "Chọn tất cả" chỉ hiện khi multiSelect
        const deselectText = window.I18n?.t('imagePicker.deselectAll') || 'Bỏ chọn';
        const selectAllText = window.I18n?.t('imagePicker.selectAll') || 'Chọn tất cả';
        const useBtn = this.singleSelect ? '' :
          `<button class="imgpicker-album-deselect-btn" data-album-id="${album.id}">${deselectText}</button>` +
          `<button class="imgpicker-album-use-btn" data-album-id="${album.id}">${selectAllText}</button>`;

        header.innerHTML = titleHtml + useBtn;
        section.appendChild(header);

        // Toggle collapse on header click
        header.addEventListener('click', (e) => {
          // Don't toggle when clicking action buttons
          if (e.target.closest('.imgpicker-album-use-btn') || e.target.closest('.imgpicker-album-deselect-btn')) return;
          if (!this._collapsedAlbums) this._collapsedAlbums = new Set();
          if (this._collapsedAlbums.has(album.id)) {
            this._collapsedAlbums.delete(album.id);
            section.classList.remove('collapsed');
          } else {
            this._collapsedAlbums.add(album.id);
            section.classList.add('collapsed');
          }
        });

        // Image grid
        const grid = document.createElement('div');
        grid.className = 'imgpicker-grid imgpicker-album-grid';

        for (const img of visibleImages) {
          const status = statuses[img.id];
          const isSelected = this.selectedImages.has(img.file_id || img.id);
          const statusClass = status === 'stale' ? ' imgpicker-album-item--stale' : '';

          // Thumbnail: dùng thumbnail_url nếu có, fallback placeholder
          const thumbSrc = img.thumbnail_url || '';

          const itemEl = document.createElement('div');
          itemEl.className = `imgpicker-item${statusClass}${isSelected ? ' selected' : ''}`;
          itemEl.dataset.fileId = img.file_id || img.id;
          itemEl.dataset.source = 'album';
          itemEl.dataset.albumImageId = img.id;
          itemEl.dataset.status = status;
          itemEl.innerHTML = `
            ${thumbSrc ? `<img src="${this._safeMediaUrl(thumbSrc)}" alt="${this._escapeHtml(img.name || '')}" loading="lazy" />` :
              '<div class="imgpicker-album-placeholder"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg></div>'}
            <div class="imgpicker-item-overlay">
              <div class="imgpicker-item-check">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </div>
            </div>
            ${status === 'stale' ? `<div class="imgpicker-album-stale-badge" title="${window.I18n?.t('imagePicker.staleImageTitle') || 'Ảnh từ project khác'}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg></div>` : ''}
            <div class="imgpicker-item-id">${this._escapeHtml((img.name || img.id || '').substring(0, 15))}</div>
          `;

          // Load thumbnail from IndexedDB if no thumbnail_url
          if (!thumbSrc && window.ImageStore) {
            this._loadAlbumThumbnail(itemEl, img.id);
          }

          grid.appendChild(itemEl);
        }

        section.appendChild(grid);
        container.appendChild(section);

        // Bind events cho grid
        this._bindGridEvents(grid, 'album');

        // Bind "Bỏ chọn" button
        const deselectBtnEl = header.querySelector('.imgpicker-album-deselect-btn');
        if (deselectBtnEl) {
          deselectBtnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this._deselectAllAlbumImages(album.id);
          });
        }

        // Bind "Chọn tất cả" button
        const useBtnEl = header.querySelector('.imgpicker-album-use-btn');
        if (useBtnEl) {
          useBtnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            this._selectAllAlbumImages(album.id);
          });
        }
      }

      // Album "Load more" button
      if (hasMoreAlbums) {
        const remaining = visibleAlbumData.length - this._visibleAlbumCount;
        const loadMoreEl = document.createElement('div');
        loadMoreEl.className = 'imgpicker-album-load-more';
        loadMoreEl.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          </svg>
          <span>${window.I18n?.t('imagePicker.viewMoreAlbums', { count: remaining }) || `Xem thêm ${remaining} album`}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        `;
        loadMoreEl.addEventListener('click', () => {
          this._visibleAlbumCount += ALBUMS_PER_PAGE;
          this._renderAlbumGrid();
        });
        container.appendChild(loadMoreEl);
      }
    }

    async _loadAlbumThumbnail(itemEl, imageId) {
      try {
        const blobUrl = await window.ImageStore.getThumbnail(imageId);
        if (blobUrl && itemEl.isConnected) {
          const placeholder = itemEl.querySelector('.imgpicker-album-placeholder');
          if (placeholder) {
            const img = document.createElement('img');
            img.src = blobUrl;
            img.alt = '';
            img.loading = 'lazy';
            placeholder.replaceWith(img);
          }
          this._albumBlobUrls.push(blobUrl);
        }
      } catch (e) {
        log('Load thumbnail failed:', imageId, e.message);
      }
    }

    _selectAllAlbumImages(albumId) {
      const albumEntry = this.albumData.find(a => a.album.id === albumId);
      if (!albumEntry) return;

      for (const img of albumEntry.images) {
        const status = albumEntry.statuses[img.id];
        if (status === 'dead') continue;

        const key = img.file_id || img.id;
        if (this.selectedImages.has(key)) continue; // Đã chọn rồi

        // Lấy thumbnail: ưu tiên thumbnail_url (CDN), fallback DOM img (blob URL)
        let thumbSrc = img.thumbnail_url || null;
        if (!thumbSrc) {
          const itemEl = this.overlay?.querySelector(`.imgpicker-item[data-album-image-id="${img.id}"]`);
          const imgEl = itemEl?.querySelector('img');
          if (imgEl && imgEl.src) thumbSrc = imgEl.src;
        }

        this.selectedImages.set(key, {
          fileId: key,
          thumbnail: thumbSrc,
          source: 'album',
          file_name: img.file_name || null,
          thumbnail_url: img.thumbnail_url || null,
          blob_key: img.blob_key || null,
          album_image_id: img.id,
          name: img.name || null,
          _status: status
        });
      }

      // Update UI
      this._renderAlbumGrid();
      this.updateSelectedCount();
    }

    _deselectAllAlbumImages(albumId) {
      const albumEntry = this.albumData.find(a => a.album.id === albumId);
      if (!albumEntry) return;

      for (const img of albumEntry.images) {
        const key = img.file_id || img.id;
        this.selectedImages.delete(key);
      }

      // Update UI
      this._renderAlbumGrid();
      this.updateSelectedCount();
    }

    /**
     * Check album image status khi AlbumList không được load (standalone windows)
     * Logic tương tự AlbumList._checkImageStatus
     * @returns {'alive'|'stale'|'dead'}
     */
    async _checkAlbumImageStatus(image) {
      try {
        if (!image) return 'dead';

        // Step 1+2: chỉ check Flow DOM khi có file_id/file_name.
        // KHÔNG early-return 'dead' khi !file_id — local upload có file_id=null nhưng
        // vẫn recoverable từ blob_key (xem step 3.5). Bug cũ early-return ở đây làm ảnh
        // local upload bị mark dead → bị filter khỏi ImagePicker + auto-delete trong
        // _addImagesToAlbum (AlbumList.js:562).
        if (window.MessageBridge && image.file_id) {
          try {
            const tileCheck = await window.MessageBridge.checkTilesExist([image.file_id]);
            if (tileCheck?.existing?.includes(image.file_id)) return 'alive';
          } catch (e) { /* ignore */ }

          // Check file_name trên DOM
          if (image.file_name) {
            try {
              const fnCheck = await window.MessageBridge.checkFilesExist([image.file_name]);
              if (fnCheck?.existing?.includes(image.file_name)) return 'alive';
            } catch (e) { /* ignore */ }
          }
        }

        // Có thumbnail_url (CDN) → STALE (recoverable via reupload)
        if (image.thumbnail_url && image.thumbnail_url.startsWith('http')) return 'stale';

        // Có blob trong IndexedDB → STALE (local upload/capture, reupload-able)
        // Dùng hasBlob() để check tồn tại blob entry — robust hơn getFullBlob khi
        // thumbnail_blob null nhưng medium_blob còn (xem ImageStore.addImage tier fallback).
        if (image.blob_key && window.ImageStore) {
          try {
            const hasBlob = typeof window.ImageStore.hasBlob === 'function'
              ? await window.ImageStore.hasBlob(image.id)
              : !!(await window.ImageStore.getFullBlob(image.id));
            if (hasBlob) return 'stale';
          } catch (e) { /* ignore */ }
        }

        return 'dead';
      } catch (e) {
        log('_checkAlbumImageStatus error:', e.message);
        return 'alive'; // Don't delete on error
      }
    }

    /**
     * Chuẩn bị album image cho ref — xử lý ALIVE/STALE
     * Tái sử dụng logic từ AlbumList._prepareImageForGenTab nhưng không phụ thuộc GenTab
     * @param {Object} imgData - Selected image data (from selectedImages Map)
     * @returns {{key: string, file_name: string|null, thumbnail_url: string|null}}
     */
    static async prepareAlbumImageForRef(imgData) {
      const fileId = imgData.fileId;
      const status = imgData._status || 'stale';

      // ALIVE + có file_id: dùng trực tiếp
      if (status === 'alive' && fileId) {
        return { key: fileId, file_name: imgData.file_name, thumbnail_url: imgData.thumbnail_url };
      }

      // STALE hoặc không có file_id (local upload/capture): fetch blob → upload key
      let file = null;
      try {
        // Tier 1: IndexedDB blob
        if (window.ImageStore && imgData.album_image_id) {
          const blob = await window.ImageStore.getFullBlob(imgData.album_image_id);
          if (blob) {
            file = new File([blob], `album_${(imgData.album_image_id || '').substring(0, 8)}.png`, { type: blob.type || 'image/png' });
          }
        }

        // Tier 2: CDN fetch (chỉ khi có HTTP URL)
        if (!file && imgData.thumbnail_url && imgData.thumbnail_url.startsWith('http')) {
          const fetchUrl = (imgData.thumbnail_url.includes('lh3.') || imgData.thumbnail_url.includes('googleusercontent.com'))
            ? imgData.thumbnail_url.split('=')[0]
            : imgData.thumbnail_url;

          const resp = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'fetchBlob', url: fetchUrl, expectImage: true }, (r) => {
              if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
              resolve(r);
            });
          });
          if (resp?.success && resp.base64) {
            const binary = atob(resp.base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const blob = new Blob([bytes], { type: 'image/png' });
            file = new File([blob], `album_${(imgData.album_image_id || '').substring(0, 8)}.png`, { type: 'image/png' });
          }
        }
        // Tier 3: IndexedDB thumbnail (khi full_blob và CDN đều không có — local upload/capture Phase S2.5)
        if (!file && window.ImageStore && imgData.album_image_id) {
          const thumbUrl = await window.ImageStore.getThumbnail(imgData.album_image_id);
          if (thumbUrl && typeof thumbUrl === 'string' && thumbUrl.startsWith('blob:')) {
            try {
              const thumbResp = await fetch(thumbUrl);
              const thumbBlob = await thumbResp.blob();
              if (thumbBlob && thumbBlob.size > 0) {
                file = new File([thumbBlob], `album_${(imgData.album_image_id || '').substring(0, 8)}.png`, { type: thumbBlob.type || 'image/png' });
              }
            } catch (e) { /* ignore */ }
          }
        }
      } catch (err) {
        log('prepareAlbumImageForRef blob fetch error:', err.message);
      }

      if (!file) {
        // Không lấy được blob — nếu có file_id thì fallback (reuploadMissingFiles xử lý)
        if (fileId) {
          return { key: fileId, file_name: imgData.file_name, thumbnail_url: imgData.thumbnail_url };
        }
        // Không có file_id + không có blob → thực sự không dùng được
        log('prepareAlbumImageForRef: no file_id and no blob for', imgData.album_image_id);
        return null;
      }

      // Tạo upload key
      const uploadKey = 'upload_album_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

      // Store file cho upload — lấy thumbnail từ imgData.thumbnail hoặc thumbnail_url
      const thumbForPending = imgData.thumbnail || imgData.thumbnail_url || null;
      if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
      window.pendingUploadFiles.set(uploadKey, { file, thumbnail: thumbForPending });

      // Cache metadata trong GenTab (Tier-1 C-2: qua API — set thumbnail/fileName nếu truthy)
      const thumbForCache = imgData.thumbnail || imgData.thumbnail_url;
      window.GenTab?.setRefImageMeta(uploadKey, { thumbnail: thumbForCache, fileName: imgData.file_name });

      return { key: uploadKey, file_name: imgData.file_name, thumbnail_url: imgData.thumbnail_url };
    }

    _escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      // textContent→innerHTML does NOT escape quotes; escape them so the result
      // is also safe inside src="..." / alt="..." / other quoted attributes.
      return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * Quote-safe media URL for src="...". Validates scheme
     * (http/https/data:image/blob) and drops anything else. Flow DOM-scraped
     * values are untrusted.
     */
    _safeMediaUrl(url) {
      const s = String(url || '');
      if (!/^(https?:|data:image\/|blob:)/i.test(s)) return '';
      return this._escapeHtml(s);
    }
  }

  // Singleton
  window.ImagePickerModal = ImagePickerModal;
  window.imagePickerModal = new ImagePickerModal();

})();
