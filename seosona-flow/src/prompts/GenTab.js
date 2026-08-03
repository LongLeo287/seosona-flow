/**
 * GenTab - Tab 1 (Prompts) UI logic
 * Handles prompt input, generation settings, file management, and templates
 * Extracted from content.js bindSidebarEvents()
 */
class GenTab {

  // ─── State ──────────────────────────────────────────────
  // thumbnailCache / fileNameCache delegate tới MediaRegistry singleton
  // Giữ getter/setter để backward-compatible với 150+ references dùng GenTab.thumbnailCache[id]
  static get thumbnailCache() { return window.MediaRegistry ? MediaRegistry._thumbnails : (GenTab._thumbnailCacheFallback || (GenTab._thumbnailCacheFallback = {})); }
  static set thumbnailCache(val) { if (window.MediaRegistry) MediaRegistry._thumbnails = val; else GenTab._thumbnailCacheFallback = val; }
  static get fileNameCache() { return window.MediaRegistry ? MediaRegistry._fileNames : (GenTab._fileNameCacheFallback || (GenTab._fileNameCacheFallback = {})); }
  static set fileNameCache(val) { if (window.MediaRegistry) MediaRegistry._fileNames = val; else GenTab._fileNameCacheFallback = val; }
  static selectedFilesForUpload = [];
  static _previewBlobUrls = [];
  static addonPrompts = [];     // Q1.6: Cached addon prompts from API
  static runMode = 'parallel'; // 'sequential' | 'parallel' - chế độ chạy prompts
  static refImageMode = 'all'; // S4: 'all' | 'mention' | 'sequential' | 'none' - chế độ ref images
  static _refModeLocked = false; // Khoá đổi ref-mode khi đang upload ref images
  static REF_LIMIT_VIDEO = 3;   // Video Ingredients: tối đa 3 ref images
  static REF_LIMIT_IMAGE = 10;  // Image: tối đa 10 ref images
  static refImageNames = {};    // S5: { file_id: name } mapping cho @mention
  static _settingsCache = null;
  static _perPromptFrameData = []; // Per-prompt frame pairs: [{ frame1, frame2, frame1Thumb, frame2Thumb }, ...]
  static _perPromptFrameUploadKeys = new Map(); // Map<uploadKey, { promptIndex, frameNum }>

  // ─── DOM References (populated in init) ─────────────────
  static promptsArea = null;
  static multiPromptCheck = null;
  static quantitySelect = null;
  static delayBetweenInput = null;
  static promptCountSpan = null;
  static fileIdsInput = null;
  static genTypeSelect = null;
  static aspectRatioSelect = null;
  static imageModelContainer = null;
  static videoModelContainer = null;
  static imageModelSelect = null;
  static videoModelSelect = null;
  static chatgptModelSelect = null;
  static videoInputTypeContainer = null;
  static videoInputTypeSelect = null;
  static flowVideoDurationContainer = null;
  static flowVideoDurationSelect = null;
  static _voicePicker = null; // VoicePicker instance — lazy init khi user vào video mode + model supports_voice
  static _characterPicker = null; // CharacterPicker instance — lazy init khi provider=flow + model supports_character (cả image+video)
  static refImagesSection = null;
  static startBtn = null;
  static _savedBtnLabel = null;
  static stopBtn = null;
  static pauseBtn = null;
  static genRunningControls = null;
  static genBtnRow = null;
  static inputTimeoutInput = null;
  static fileIdThumbnails = null;
  static videoFramesSection = null;
  static genRunModeBtn = null; // Toggle button cho chế độ chạy
  static refImageModeSelect = null; // S4: Ref image mode dropdown
  static mentionHelper = null; // S4: Mention helper bar
  static mentionHelperTags = null; // S4: Tags container
  static saveToAlbumBtn = null; // S6: Save to album button

  // Debounced saveState (created in init)
  static saveState = null;

  /**
   * Initialize Tab 1 - called after sidebar HTML is injected
   */
  static _getSettings() {
    return new Promise((resolve) => {
      if (GenTab._settingsCache) {
        resolve(GenTab._settingsCache);
        return;
      }
      chrome.storage.local.get(['af_settings'], (res) => {
        GenTab._settingsCache = res.af_settings || {};
        resolve(GenTab._settingsCache);
      });
    });
  }

  /**
   * Helper: Hiện notification đỏ cho các provider errors (ChatGPT/Grok/Flow).
   * Dùng để test và debug error detection patterns từ admin settings.
   * @param {string} provider - 'chatgpt' | 'grok' | 'flow'
   * @param {string} errorCode - RATE_LIMIT, CONTENT_BLOCKED, IMAGE_GEN_FAILED, TEXT_ONLY, NETWORK, SUBSCRIPTION_REQUIRED...
   * @param {string} [message] - Optional error message từ provider
   */
  static _showProviderErrorNotification(provider, errorCode, message = '') {
    if (typeof window.showNotification !== 'function') return;

    const providerName = provider === 'chatgpt' ? 'ChatGPT' : (provider === 'grok' ? 'Grok' : 'Flow');
    const t = window.I18n?.t?.bind(window.I18n) || ((k) => null);

    // Map error codes → i18n keys
    const errorKeyMap = {
      RATE_LIMIT: 'rateLimit',
      CONTENT_BLOCKED: 'contentBlocked',
      IMAGE_GEN_FAILED: 'imageGenFailed',
      TEXT_ONLY: 'textOnly',
      NETWORK: 'network',
      SUBSCRIPTION_REQUIRED: 'subscriptionRequired',
      LIMIT_ALERT: 'limitAlert',
      TIMEOUT: 'timeout',
      CHALLENGE_TIMEOUT: 'challengeTimeout',
    };

    // Fallback messages (Vietnamese default)
    const fallbackMessages = {
      RATE_LIMIT: 'Đã hết lượt tạo ảnh. Vui lòng thử lại sau.',
      CONTENT_BLOCKED: 'Nội dung bị chặn do vi phạm chính sách.',
      IMAGE_GEN_FAILED: 'Không thể tạo ảnh. Vui lòng thử lại.',
      TEXT_ONLY: 'Chỉ nhận được text thay vì ảnh.',
      NETWORK: 'Lỗi kết nối mạng.',
      SUBSCRIPTION_REQUIRED: 'Cần đăng ký gói trả phí để sử dụng.',
      LIMIT_ALERT: 'Đã hết quota tạo ảnh miễn phí.',
      TIMEOUT: 'Hết thời gian chờ phản hồi.',
      CHALLENGE_TIMEOUT: 'Cần xác minh captcha. Vui lòng mở tab và xác minh.',
    };

    const i18nKey = errorKeyMap[errorCode];
    const i18nMsg = i18nKey ? t(`errors.${i18nKey}`) : null;
    const baseMsg = i18nMsg || fallbackMessages[errorCode] || errorCode;
    const displayMsg = `${providerName}: ${baseMsg}`;

    // Show notification đỏ (error type)
    window.showNotification(displayMsg, 'error', 5000);

    // Emit event để các module khác có thể listen
    if (window.eventBus) {
      window.eventBus.emit('provider:error', { provider, errorCode, message: displayMsg });
    }

    console.warn(`[GenTab] Provider error: ${provider} - ${errorCode}`, message);
  }

  static init() {
    console.log('[SEOSONA Flow] GenTab.init()');

    // Expose showProviderError globally để WorkflowExecutor/TaskList có thể dùng
    window.showProviderError = GenTab._showProviderErrorNotification.bind(GenTab);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.af_settings) {
        GenTab._settingsCache = changes.af_settings.newValue || {};
      }
    });

    // ─── Get all DOM references ───────────────────────────
    GenTab.promptsArea = document.getElementById('promptsArea');
    GenTab.multiPromptCheck = document.getElementById('multiPromptCheck');
    GenTab.quantitySelect = document.getElementById('quantitySelect');
    // Apply quantity range (min/max) từ provider_configs.flow.api_config.quantity_range
    // SSE provider:api_config_updated key='quantity_range' re-apply runtime.
    try { GenTab.updateQuantityOptions(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab', _); }
    // Bind +/- buttons (TaskModal pattern)
    try { GenTab._bindQuantityButtons(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab', _); }
    // Settings now in separate window (settings.html) - use storageSettings
    GenTab.delayBetweenInput = null; // Legacy - removed from sidebar
    GenTab.promptCountSpan = document.getElementById('promptCount');

    GenTab.fileIdsInput = document.getElementById('fileIds');
    GenTab.genTypeSelect = document.getElementById('genType');
    GenTab.aspectRatioSelect = document.getElementById('aspectRatio');
    GenTab.imageModelContainer = document.getElementById('imageModelContainer');
    GenTab.videoModelContainer = document.getElementById('videoModelContainer');
    GenTab.imageModelSelect = document.getElementById('imageModel');
    GenTab.videoModelSelect = document.getElementById('videoModel');
    GenTab.chatgptModelSelect = document.getElementById('chatgptModel');
    // Bug 31 fix (2026-05-19): Populate model dropdowns từ ModelRegistry (admin tweakable)
    // thay vì hardcoded HTML options. SSE provider:models_updated re-call hàm này.
    try { GenTab.updateModelOptions(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab', _); }
    GenTab.videoInputTypeContainer = document.getElementById('videoInputTypeContainer');
    GenTab.videoInputTypeSelect = document.getElementById('videoInputType');
    GenTab.flowVideoDurationContainer = document.getElementById('flowVideoDurationContainer');
    GenTab.flowVideoDurationSelect = document.getElementById('flowVideoDuration');
    // Populate Flow video duration options from server
    try { GenTab.updateFlowVideoDurationOptions(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab', _); }
    GenTab.refImagesSection = document.getElementById('refImagesSection');

    GenTab.startBtn = document.getElementById('startBtn');
    GenTab.stopBtn = document.getElementById('stopBtn');
    GenTab.pauseBtn = document.getElementById('pauseBtn');
    GenTab.genRunningControls = document.getElementById('genRunningControls');
    GenTab.genBtnRow = document.getElementById('genBtnRow');

    GenTab.inputTimeoutInput = null; // Legacy - removed from sidebar, use storageSettings

    GenTab.fileIdThumbnails = document.getElementById('refImagesPreview');
    GenTab.videoFramesSection = document.getElementById('videoFramesSection');

    // Q1.6: Addon Prompts / Phong Cách
    GenTab.addonPromptSelect = document.getElementById('addonPromptSelect');

    // Run mode toggle button
    GenTab.genRunModeBtn = document.getElementById('genRunModeBtn');

    // S4: Ref image mode
    GenTab.refImageModeSelect = document.getElementById('refImageMode');
    GenTab.mentionHelper = document.getElementById('mentionHelper');
    GenTab.mentionHelperTags = document.getElementById('mentionHelperTags');

    // S6: Save to album
    GenTab.saveToAlbumBtn = document.getElementById('saveToAlbumBtn');

    // ─── Debounced saveState ──────────────────────────────
    GenTab.saveState = debounce(GenTab._saveStateImmediate, 500);

    // ─── ExecutionLock: hiện banner khi tác vụ khác đang chạy ───
    if (window.eventBus) {
      window.eventBus.on('execution:lock_changed', (state) => {
        GenTab._updateLockBanner(state);
      });

      // S2.5: Re-render khi upload bắt đầu (hiển thị spinner)
      // Disable generate button khi đang upload ref images
      window.eventBus.on('upload:started', () => {
        GenTab.renderFileIdThumbnails();
        GenTab._updateGenBtnUploadState();
      });
      // S2.5: Sync upload key → real tile_id khi upload hoàn thành
      window.eventBus.on('upload:completed', (data) => {
        if (!data?.key || !data?.tile_id) return;
        GenTab._syncUploadKeyToTileId(data);
        GenTab._handleFrameUploadCompleted(data);
        GenTab._handlePerPromptFrameUploadCompleted(data);
        GenTab._updateGenBtnUploadState();
      });
      window.eventBus.on('upload:failed', (data) => {
        GenTab.renderFileIdThumbnails();
        GenTab._handleFrameUploadFailed(data);
        GenTab._handlePerPromptFrameUploadFailed(data);
        GenTab._updateGenBtnUploadState();
      });
      window.eventBus.on('upload:cancelled', (data) => {
        GenTab.renderFileIdThumbnails();
        GenTab._handleFrameUploadFailed(data);
        GenTab._handlePerPromptFrameUploadFailed(data);
        GenTab._updateGenBtnUploadState();
      });
      // Re-render khi upload chuyển sang pending (tab inactive)
      // → hiển thị thumbnail + "Local" badge thay vì spinner
      window.eventBus.on('upload:pending', () => {
        GenTab.renderFileIdThumbnails();
        GenTab._updateGenBtnUploadState();
      });
    }

    // ─── MutationObserver for thumbnails ──────────────────
    GenTab._thumbObserver = new MutationObserver(debounce(GenTab.checkMissingThumbnails, 1000));
    GenTab._thumbObserver.observe(document.body, { childList: true, subtree: true });

    // ─── fileIdsInput handler ─────────────────────────────
    if (GenTab.fileIdsInput) {
      GenTab.fileIdsInput.addEventListener('input', () => {
        GenTab.saveState();
        GenTab.renderFileIdThumbnails();
        // S4: Refresh mention helper when files change
        if (GenTab.refImageMode === 'mention') {
          GenTab._refreshMentionHelper();
        }
      });
    }

    // ─── Run Mode Toggle (Sequential/Parallel) ─────────────────────
    if (GenTab.genRunModeBtn) {
      GenTab.genRunModeBtn.addEventListener('click', () => {
        GenTab._toggleRunMode();
      });
      // Sync UI với runMode hiện tại ngay khi init (trước loadState có thể override)
      GenTab._updateRunModeUI();
    }

    // ─── S4: Ref Image Mode Handler ─────────────────────────────────
    if (GenTab.refImageModeSelect) {
      GenTab.refImageModeSelect.addEventListener('change', () => {
        GenTab.refImageMode = GenTab.refImageModeSelect.value;
        GenTab._updateRefModeUI();
        // Re-render thumbnails để cập nhật ref limit scale theo mode (sequential dùng N×policy)
        try { GenTab.renderFileIdThumbnails(); } catch (e) { globalThis.SEOSONA_swallow?.('GenTab', e); }
        // UX (2026-05-02): Hide mention dropdown khi user đổi mode khỏi 'mention'.
        if (GenTab.refImageMode !== 'mention') {
          try { GenTab._hideAutocomplete?.(); } catch (e) { globalThis.SEOSONA_swallow?.('GenTab', e); }
        }
        GenTab.saveState();
      });
    }

    // Re-render ref limit khi user gõ thêm prompts (sequential + multi → limit theo N_prompts)
    if (GenTab.promptsArea) {
      const onPromptsChange = () => {
        if (GenTab.multiPromptCheck?.checked && GenTab.refImageMode === 'sequential') {
          try { GenTab.renderFileIdThumbnails(); } catch (e) { globalThis.SEOSONA_swallow?.('GenTab#onPromptsChange', e); }
        }
      };
      GenTab.promptsArea.addEventListener('input', onPromptsChange);
      GenTab.promptsArea.addEventListener('paste', () => setTimeout(onPromptsChange, 10));
    }
    // Multi-prompt toggle change → refresh limit
    if (GenTab.multiPromptCheck) {
      GenTab.multiPromptCheck.addEventListener('change', () => {
        try { GenTab.renderFileIdThumbnails(); } catch (e) { globalThis.SEOSONA_swallow?.('GenTab#onPromptsChange', e); }
      });
    }

    // ─── S6: Save to Album Handler ────────────────────────────────
    if (GenTab.saveToAlbumBtn) {
      GenTab.saveToAlbumBtn.addEventListener('click', () => {
        GenTab._saveRefImagesToAlbum();
      });
    }

    // ─── Ref Quick Tabs (Album, Gallery, Search) ────────────────────
    GenTab._bindRefQuickTabs();

    // ─── T-1.4: Auto-download toggle + resolution select + subfolder ───
    const genTabAutoDownload = document.getElementById('genTabAutoDownload');
    const genTabDownloadRes = document.getElementById('genTabDownloadResolution');
    const genTabVideoDownloadRes = document.getElementById('genTabVideoDownloadResolution');
    const genTabDownloadResWrap = document.getElementById('genTabDownloadResWrap');
    const genTabVideoDownloadResWrap = document.getElementById('genTabVideoDownloadResWrap');
    const genTabSubFolder = document.getElementById('genTabSubFolder');
    if (genTabAutoDownload && genTabDownloadRes) {
      // Show/hide subfolder + resolution based on toggle AND genType
      // Exposed as static method so loadState can call it after restoring toggle state
      GenTab._syncDownloadVisibility = () => {
        const toggle = document.getElementById('genTabAutoDownload');
        const subFolderWrap = document.getElementById('genTabSubFolderWrap');
        const resWrap = document.getElementById('genTabDownloadResWrap');
        const videoResWrap = document.getElementById('genTabVideoDownloadResWrap');
        const isVideo = GenTab.genTypeSelect?.value === 'Video';
        // Provider check: ChatGPT/Grok URL CDN cố định → KHÔNG có chọn resolution
        const providerKey = document.getElementById('genProvider')?.value || 'flow';
        const isChatGPT = providerKey === 'chatgpt';
        const isGrok = providerKey === 'grok';

        if (toggle?.checked) {
          // Subfolder vẫn dùng được cho mọi provider (download vào filesystem)
          if (subFolderWrap) subFolderWrap.classList.remove('hidden');
          if (isChatGPT || isGrok) {
            // ChatGPT/Grok: ẩn cả 2 resolution wraps bất kể genType
            if (resWrap) resWrap.classList.add('hidden');
            if (videoResWrap) videoResWrap.classList.add('hidden');
          } else if (isVideo) {
            if (resWrap) resWrap.classList.add('hidden');
            if (videoResWrap) videoResWrap.classList.remove('hidden');
          } else {
            if (resWrap) resWrap.classList.remove('hidden');
            if (videoResWrap) videoResWrap.classList.add('hidden');
          }
        } else {
          if (subFolderWrap) subFolderWrap.classList.add('hidden');
          if (resWrap) resWrap.classList.add('hidden');
          if (videoResWrap) videoResWrap.classList.add('hidden');
        }
      };
      const syncResVisibility = GenTab._syncDownloadVisibility;
      // Bug 30 fix: Populate dropdown options từ PCM (server admin tweak được).
      // Fallback inline khi PCM chưa load. SSE `provider:api_config_updated`
      // key=download_resolutions sẽ re-call hàm này khi admin update.
      try { GenTab.updateDownloadResolutionOptions(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#_syncDownloadVisibility', _); }
      // Load default resolution from settings (helper)
      const loadDefaultResolution = () => {
        GenTab._getSettings().then((settings) => {
          if (settings.downloadResolution && !genTabDownloadRes.dataset.userSet) {
            genTabDownloadRes.value = settings.downloadResolution;
          }
          if (settings.videoDownloadResolution && genTabVideoDownloadRes && !genTabVideoDownloadRes.dataset.userSet) {
            genTabVideoDownloadRes.value = settings.videoDownloadResolution;
          }
        });
      };
      genTabAutoDownload.addEventListener('change', () => {
        syncResVisibility();
        // Khi bật toggle, load default resolution từ settings
        if (genTabAutoDownload.checked) {
          loadDefaultResolution();
        }
        GenTab.saveState();
      });
      genTabDownloadRes.addEventListener('change', () => {
        genTabDownloadRes.dataset.userSet = '1';
        GenTab.saveState();
      });
      if (genTabVideoDownloadRes) {
        genTabVideoDownloadRes.addEventListener('change', () => {
          genTabVideoDownloadRes.dataset.userSet = '1';
          GenTab.saveState();
        });
      }
      if (genTabSubFolder) {
        genTabSubFolder.addEventListener('change', () => GenTab.saveState());
      }
      loadDefaultResolution();
      // Sync initial visibility
      syncResVisibility();
      // Re-sync when genType changes
      if (GenTab.genTypeSelect) {
        GenTab.genTypeSelect.addEventListener('change', syncResVisibility);
      }
    }

    // ─── ImagePickerModal integration + drag-drop ─────────────────────
    const openImagePickerBtn = document.getElementById('openImagePickerBtn');
    if (openImagePickerBtn) {
      openImagePickerBtn.addEventListener('click', () => {
        const existingIds = (GenTab.fileIdsInput?.value || '').split(',').map(s => s.trim()).filter(Boolean);
        if (window.imagePickerModal) {
          // CG-5.5: Inject options ChatGPT (hideFlowTilePicker) khi provider=chatgpt
          const cgOpts = GenTab._imagePickerModalOptions || {};
          // Post-audit fix: resolve maxSelections theo ref_mode + provider + mediaType.
          // GenTab.getRefLimit() xử lý đầy đủ: mention=Infinity, sequential=N_prompts, all/none=provider_limit.
          const refLimit = GenTab.getRefLimit();
          // ref_mode=none → disable picker (không cho chọn)
          if (GenTab.refImageMode === 'none') {
            console.log('[GenTab] ref_mode=none, picker disabled');
            return;
          }
          // Detect current model + mode + duration để pass cho noRefSupportContext (banner suggestion).
          const _gtCurrentProvider = (GenTab.providerSelect?.value || 'flow').toLowerCase();
          const _gtIsVideo = GenTab.genTypeSelect?.value === 'Video';
          const _gtModelValue = _gtIsVideo
            ? (GenTab.videoModelSelect?.value || '')
            : (GenTab.imageModelSelect?.value || '');
          const _gtMediaType = _gtIsVideo ? 'video' : 'image';
          const _gtInputType = _gtIsVideo ? (GenTab.videoInputTypeSelect?.value || 'Ingredients') : undefined;
          const _gtDuration = _gtIsVideo ? (GenTab.flowVideoDurationSelect?.value || undefined) : undefined;
          // 2026-05-31: multi-cap {image, video, total} cho Flow per-model (vd Omni Flash 7/1/7).
          const _gtCaps = (_gtCurrentProvider === 'flow' && typeof ImagePickerModal !== 'undefined'
              && ImagePickerModal.resolveCapsMulti)
            ? ImagePickerModal.resolveCapsMulti({
                provider: 'flow', mode: _gtMediaType,
                isFrames: _gtInputType === 'Frames',
                modelValue: _gtModelValue, duration: _gtDuration,
              })
            : { image: null, video: 0, total: null };
          // existingFileTypes: lookup từ GenTab.refMediaTypes → modal multi-cap count đúng video.
          const _gtExistingTypes = {};
          for (const id of existingIds) {
            if (GenTab.refMediaTypes?.[id] === 'video') _gtExistingTypes[id] = 'video';
          }
          window.imagePickerModal.open({
            existingFileIds: existingIds,
            existingFileTypes: _gtExistingTypes,
            mediaFilter: 'image',
            // 2026-05-27: model Flow có supports_ref_video (vd Omni Flash) → cho phép chọn + upload video.
            allowVideo: _gtCurrentProvider === 'flow'
              && window.ProviderRegistry?.get?.('flow')?.supportsRefVideo?.(_gtModelValue) === true,
            hideFlowTilePicker: cgOpts.hideFlowTilePicker || false,
            // refLimit === 0 → model không hỗ trợ ref (vd Veo Quality + Ingredients, Lite/Fast + duration<8s).
            maxSelections: refLimit === Infinity ? null : refLimit,
            maxImageSelections: refLimit === Infinity ? null : refLimit,
            maxVideoSelections: _gtCaps.video || 0,
            maxTotalSelections: _gtCaps.total,
            noRefSupportContext: refLimit === 0 ? {
              provider: _gtCurrentProvider,
              modelValue: _gtModelValue,
              mediaType: _gtMediaType,
              inputType: _gtInputType,
              duration: _gtDuration,
            } : null,
            onConfirm: async (images) => {
              if (!GenTab.fileIdsInput) return;
              const existingIds = GenTab.fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
              const newIds = [];
              if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();

              // Tách album images ra xử lý async
              const albumImages = images.filter(img => img.source === 'album');
              const otherImages = images.filter(img => img.source !== 'album');

              for (const img of otherImages) {
                if (img.source === 'upload' && img.file) {
                  const key = img.fileId || `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                  // Giữ tên gốc (bỏ đuôi) — đồng bộ với path drag/drop, tránh fallback 'img_N'.
                  const _baseName = String(img.name || img.file_name || img.file?.name || '').replace(/\.[^/.]+$/, '');
                  // Set memory ngay lập tức để renderFileIdThumbnails có thể đọc
                  window.pendingUploadFiles.set(key, { file: img.file, thumbnail: img.thumbnail, name: _baseName || undefined });
                  if (_baseName) GenTab.refImageNames[key] = _baseName;
                  // LAZY UPLOAD: Không upload ngay. sidePanel luôn mở khi làm việc với GenTab,
                  // pendingUploadFiles Map tồn tại trong session. Flow sẽ upload khi submit.
                  // ChatGPT/Grok lấy blob trực tiếp từ pendingUploadFiles → base64.
                  newIds.push(key);
                  // 2026-05-27: track media type (ref_video) để detect has_ref_video → force duration.
                  GenTab.refMediaTypes = GenTab.refMediaTypes || {};
                  GenTab.refMediaTypes[key] = img.type || 'image';
                  GenTab.refVideoUrls = GenTab.refVideoUrls || {};
                  if (img.video_url) GenTab.refVideoUrls[key] = img.video_url;
                } else if (img.fileId) {
                  newIds.push(img.fileId);
                  // FIX: Cache file_name và thumbnail cho Flow images để resolve được sau page reload
                  // file_name là UUID persistent, dùng để map old tile_id → new tile_id trong reuploadMissingFiles
                  if (img.file_name) {
                    GenTab.fileNameCache[img.fileId] = img.file_name;
                  }
                  if (img.thumbnail) {
                    GenTab.thumbnailCache[img.fileId] = img.thumbnail;
                  }
                  GenTab.refMediaTypes = GenTab.refMediaTypes || {};
                  GenTab.refMediaTypes[img.fileId] = img.type || 'image';
                  GenTab.refVideoUrls = GenTab.refVideoUrls || {};
                  if (img.video_url) GenTab.refVideoUrls[img.fileId] = img.video_url;
                }
              }

              // Xử lý album images qua prepareAlbumImageForRef
              if (albumImages.length > 0 && window.ImagePickerModal?.prepareAlbumImageForRef) {
                for (const img of albumImages) {
                  try {
                    const prepared = await window.ImagePickerModal.prepareAlbumImageForRef(img);
                    if (!prepared) continue;
                    const key = prepared.key;

                    // Cache thumbnail: ưu tiên thumbnail_url (CDN, persistent),
                    // fallback load mới từ IndexedDB (vì blob URL modal sẽ bị revoke)
                    if (img.thumbnail_url) {
                      GenTab.thumbnailCache[key] = img.thumbnail_url;
                    } else if (img.album_image_id && window.ImageStore) {
                      // Load blob URL mới từ IndexedDB (modal blob URL sẽ bị revoke khi close)
                      try {
                        const blobUrl = await window.ImageStore.getThumbnail(img.album_image_id);
                        if (blobUrl) GenTab.thumbnailCache[key] = blobUrl;
                      } catch (e) { /* ignore */ }
                    } else if (img.thumbnail) {
                      // Fallback: dùng thumbnail từ modal (có thể blob URL, sẽ bị revoke)
                      GenTab.thumbnailCache[key] = img.thumbnail;
                    }

                    if (prepared.file_name) {
                      GenTab.fileNameCache[key] = prepared.file_name;
                    }

                    // Giữ tên album image
                    if (img.name) {
                      GenTab.refImageNames[key] = img.name;
                    }

                    newIds.push(key);

                    // LAZY UPLOAD: Không upload ngay khi chọn ảnh album.
                    // ChatGPT/Grok sẽ lấy blob trực tiếp từ pendingUploadFiles → base64.
                    // Flow sẽ upload khi submit (uploadPendingFiles trong WorkflowExecutor).
                    // Giữ blob trong pendingUploadFiles để cả 2 path có thể dùng.
                  } catch (err) {
                    console.error('[GenTab] Lỗi chuẩn bị ảnh album:', err);
                  }
                }
              }

              const mergedIds = [...new Set([...existingIds, ...newIds])];
              GenTab.fileIdsInput.value = mergedIds.join(', ');
              GenTab.fileIdsInput.dispatchEvent(new Event('input', { bubbles: true }));

              // S5: Generate default names for new images (chỉ cho ảnh chưa có tên)
              const existingCount = Object.keys(GenTab.refImageNames).length;
              let nameIdx = 0;
              newIds.forEach((id) => {
                if (!GenTab.refImageNames[id]) {
                  nameIdx++;
                  GenTab.refImageNames[id] = `image_${existingCount + nameIdx}`;
                }
              });

              GenTab.renderFileIdThumbnails();
              // S4: Refresh mention helper
              if (GenTab.refImageMode === 'mention') {
                GenTab._refreshMentionHelper();
              }
            }
          });
        }
      });

      // Drag-drop files onto the button
      openImagePickerBtn.addEventListener('dragover', (e) => {
        e.preventDefault();
        openImagePickerBtn.classList.add('drag-over');
      });
      openImagePickerBtn.addEventListener('dragleave', () => {
        openImagePickerBtn.classList.remove('drag-over');
      });
      openImagePickerBtn.addEventListener('drop', (e) => {
        e.preventDefault();
        openImagePickerBtn.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length > 0) {
          GenTab._handleDroppedFiles(files);
        }
      });
    }

    // ─── Q2.5: Screen Capture buttons (toolbar + header) ──────
    const screenCaptureBtn = document.getElementById('screenCaptureBtn');
    const headerCaptureBtn = document.getElementById('headerCaptureBtn');

    // Helper function for screen capture
    const handleScreenCapture = async (triggerBtn) => {
      if (!window.ScreenCapture) {
        window.customDialog?.alert(window.I18n?.t('gen.screenshotNotReady') || 'Tính năng chụp màn hình chưa sẵn sàng.', { type: 'warning' });
        return;
      }

      // Show loading state
      if (triggerBtn) {
        triggerBtn.disabled = true;
        triggerBtn.classList.add('btn-loading');
      }

      // Notify user to select capture area
      window.showNotification?.(window.I18n?.t('gen.captureSelectArea') || 'Hãy chọn vùng cần chụp ở bên trái', 'success', 3000);

      try {
        const result = await window.ScreenCapture.startCapture();

        if (result.success && result.uploadId) {
          // Add uploadId to fileIds input
          if (GenTab.fileIdsInput) {
            const existingIds = GenTab.fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
            if (!existingIds.includes(result.uploadId)) {
              existingIds.push(result.uploadId);
              GenTab.fileIdsInput.value = existingIds.join(', ');
              GenTab.fileIdsInput.dispatchEvent(new Event('input', { bubbles: true }));
            }
          }
          // S11: Save capture name to refImageNames
          if (result.captureName) {
            GenTab.refImageNames[result.uploadId] = result.captureName;
          }
          GenTab.renderFileIdThumbnails();
          GenTab.saveState();
          console.log('[GenTab] Đã thêm ảnh capture:', result.uploadId, 'Tên:', result.captureName);
        } else if (result.cancelled) {
          // User cancelled - no action needed
        } else if (result.error) {
          window.customDialog?.alert(result.error, { title: window.I18n?.t('gen.screenshotError') || 'Lỗi chụp màn hình', type: 'error' });
        }
      } finally {
        if (triggerBtn) {
          triggerBtn.disabled = false;
          triggerBtn.classList.remove('btn-loading');
        }
      }
    };

    // Bind both capture buttons
    if (screenCaptureBtn) {
      screenCaptureBtn.addEventListener('click', () => handleScreenCapture(screenCaptureBtn));
    }
    if (headerCaptureBtn) {
      headerCaptureBtn.addEventListener('click', () => handleScreenCapture(headerCaptureBtn));
    }

    // ─── Công cụ mở bằng cửa sổ popup riêng ─────────────────────────────────
    // Trước đây mỗi công cụ tự lặp lại đúng khối try/catch 3 tầng này. Gom lại một chỗ:
    // thêm công cụ mới chỉ cần thêm một dòng, và sửa cách mở thì sửa đúng một nơi.
    const _openToolWindow = (page, w, h) => {
      const url = chrome.runtime.getURL(page);
      // Popup riêng (giống workflow editor), KHÔNG phải tab trình duyệt.
      try {
        chrome.windows.create({ url, type: 'popup', width: w, height: h });
      } catch (_) {
        try { chrome.tabs.create({ url }); }
        catch (__) { try { window.open(url, '_blank'); } catch (___) { globalThis.SEOSONA_swallow?.('GenTab#_openToolWindow', ___); } }
      }
    };
    // Cùng một công cụ có thể có NHIỀU điểm vào (thẻ trong tab Tools + nút cũ ở header).
    // Bind theo danh sách id để không nơi nào bị bỏ sót khi đổi bố cục.
    // Mở công cụ NGAY TRONG sidebar. Cửa sổ rời chỉ còn là tuỳ chọn (nút ⧉) cho ai cần màn
    // rộng để soi ảnh — không còn là đường mặc định.
    const _openInPanel = (page, title, w, h) => {
      const panel = document.getElementById('toolPanel');
      const frame = document.getElementById('toolPanelFrame');
      const grid = document.querySelector('#tab-tools .tools-grid');
      if (!panel || !frame || !grid) { _openToolWindow(page, w, h); return; }   // thiếu khung → đường cũ
      frame.src = chrome.runtime.getURL(page);
      document.getElementById('toolPanelTitle').textContent = title;
      panel.style.display = 'flex'; grid.style.display = 'none';
      const pop = document.getElementById('toolPanelPop');
      if (pop) pop.onclick = () => { _closePanel(); _openToolWindow(page, w, h); };
    };
    const _closePanel = () => {
      const panel = document.getElementById('toolPanel');
      const frame = document.getElementById('toolPanelFrame');
      const grid = document.querySelector('#tab-tools .tools-grid');
      if (!panel) return;
      panel.style.display = 'none';
      if (grid) grid.style.display = '';
      if (frame) frame.src = 'about:blank';   // giải phóng: công cụ video ngốn bộ nhớ
    };
    document.getElementById('toolPanelBack')?.addEventListener('click', _closePanel);

    const _bindTool = (ids, page, w, h, title) => {
      ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        // Nút ở HEADER vẫn bật cửa sổ rời (thói quen cũ); thẻ trong tab Tools thì mở panel.
        const inPanel = title && id.indexOf('tools') === 0;
        el.addEventListener('click', () => (inPanel ? _openInPanel(page, title, w, h) : _openToolWindow(page, w, h)));
      });
    };

    // Xoá watermark — nhà chính giờ là thẻ trong tab Tools; nút header giữ để khỏi phá
    // thói quen của người đang dùng.
    _bindTool(['headerWatermarkBtn', 'toolsWatermarkBtn'], 'pages/watermark-tool.html', 960, 760, 'Xoá watermark');
    _bindTool(['toolsMetadataBtn'], 'pages/metadata-tool.html', 900, 760, 'Dọn metadata');
    _bindTool(['toolsTextOverlayBtn'], 'pages/text-overlay-tool.html', 1020, 780, 'Chữ lên ảnh');
    _bindTool(['toolsStyleAnchorBtn'], 'pages/style-anchor-tool.html', 980, 760, 'Neo phong cách');

    // Chẩn đoán selector — mở khi web đổi giao diện để xem chỗ nào gãy + vá nóng.
    // Công cụ dev, giữ ở header (không đưa vào tab Tools của người dùng cuối).
    _bindTool(['headerSelectorDoctorBtn'], 'pages/selector-doctor.html', 980, 760);
    // Hai nút header dưới đây trùng công cụ đã có thẻ trong tab Tools — giữ lại để
    // không phá thói quen của người đang dùng, nhưng dùng CHUNG một đường mở.
    _bindTool(['headerTextOverlayBtn'], 'pages/text-overlay-tool.html', 1020, 780);
    _bindTool(['headerStyleAnchorBtn'], 'pages/style-anchor-tool.html', 960, 760);

    // ─── Motion Recipes preview tool ──────────────────────────
    // Motion Recipes: đã BỎ khỏi header — nội dung (camera move/chuyển động) đã nằm trong bộ
    // video-prompt scaffold (category "🎬 Video Prompting", mục Camera move) nên nút này trùng lặp.
    // Module + trang pages/motion-preview.html vẫn còn, mở trực tiếp bằng URL nếu cần tra cứu.

    // ─── Prompt Assistant button ───────────────────────────
    const chatAIBtn = document.getElementById('chatAIBtn');
    if (chatAIBtn) {
      chatAIBtn.addEventListener('click', () => {
        const Modal = window.PromptAssistantModal || window.ChatAIModal;
        if (Modal) Modal.open();
      });
    }

    // ─── Import .txt file ─────────────────────────────────
    const importTxtBtn = document.getElementById('importTxtBtn');
    const importTxtFile = document.getElementById('importTxtFile');
    if (importTxtBtn && importTxtFile) {
      importTxtBtn.addEventListener('click', () => importTxtFile.click());
      importTxtFile.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          GenTab.importTxtFile(file);
          importTxtFile.value = ''; // Reset cho phép chọn lại cùng file
        }
      });
    }

    // Prompt Merge (Pillar B): mở modal ghép bảng CSV → prompt hàng loạt
    const promptMergeBtn = document.getElementById('promptMergeBtn');
    if (promptMergeBtn) {
      promptMergeBtn.addEventListener('click', () => window.PromptMerge?.open());
    }

    // ─── Drag-drop .txt onto promptsArea ──────────────────
    if (GenTab.promptsArea) {
      GenTab.promptsArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        GenTab.promptsArea.classList.add('drag-over');
      });
      GenTab.promptsArea.addEventListener('dragleave', () => {
        GenTab.promptsArea.classList.remove('drag-over');
      });
      GenTab.promptsArea.addEventListener('drop', (e) => {
        e.preventDefault();
        GenTab.promptsArea.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files);
        const txtFile = files.find(f => f.name.endsWith('.txt') || f.name.endsWith('.csv'));
        if (txtFile) {
          GenTab.importTxtFile(txtFile);
        }
      });
    }

    // ─── Frame picker bindings (Tab 1 - Video+Frames) ────
    GenTab.bindFramePicker(1);
    GenTab.bindFramePicker(2);

    // ─── GenType UI toggle ────────────────────────────────
    if (GenTab.genTypeSelect) {
      GenTab.genTypeSelect.addEventListener('change', GenTab.updateGenTypeUI);
      // Initialize ratio options based on current type
      GenTab.updateRatioOptions();
    }

    // ─── GenType Toggle Buttons (Image/Video) ─────────────
    const genTypeToggle = document.getElementById('genTypeToggle');
    if (genTypeToggle) {
      genTypeToggle.querySelectorAll('.gen-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const value = btn.dataset.value;
          // Update button states
          genTypeToggle.querySelectorAll('.gen-type-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          // Sync with hidden select
          if (GenTab.genTypeSelect) {
            GenTab.genTypeSelect.value = value;
            GenTab.genTypeSelect.dispatchEvent(new Event('change'));
          }
        });
      });
    }
    if (GenTab.videoInputTypeSelect) {
      GenTab.videoInputTypeSelect.addEventListener('change', () => {
        GenTab.updateRefImagesVisibility();
        GenTab.renderFileIdThumbnails(); // Re-render to update ref limit grayscale
      });
    }

    // ─── Frame Pick Buttons (Video Frames mode) ───────────
    GenTab._initFramePickButtons();

    // ─── Prompt count ─────────────────────────────────────
    if (GenTab.promptsArea) {
      GenTab.promptsArea.addEventListener('input', GenTab.updatePromptCount);
      // Debounced: update per-prompt frame mode when prompt count changes
      GenTab._debouncedUpdateFrameMode = debounce(() => GenTab._updateFrameMode(), 500);
      GenTab.promptsArea.addEventListener('input', GenTab._debouncedUpdateFrameMode);
    }
    if (GenTab.quantitySelect) {
      GenTab.quantitySelect.addEventListener('change', GenTab.updatePromptCount);
      // Persist user choice vào af_settings để reload restore (Fix: dropdown reset về 1 mỗi reload)
      GenTab.quantitySelect.addEventListener('change', () => {
        try {
          chrome.storage.local.get(['af_settings'], (res) => {
            const s = res.af_settings || {};
            s.defaultFlowQuantity = GenTab.quantitySelect.value;
            chrome.storage.local.set({ af_settings: s });
          });
        } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#handleScreenCapture', _); }
      });
    }
    if (GenTab.multiPromptCheck) {
      GenTab.multiPromptCheck.addEventListener('change', () => {
        GenTab.updatePromptCount();
        const isMulti = GenTab.multiPromptCheck.checked;
        const hint = document.getElementById('multiPromptHint');
        if (hint) hint.classList.toggle('hidden', !isMulti);
        // Show/hide run mode button (only relevant for multi-prompt AND Flow provider)
        // ChatGPT/Grok luôn chạy tuần tự nên không cần hiển thị
        GenTab._updateRunModeVisibility();
        // Re-render thumbnails and update UI
        GenTab.renderFileIdThumbnails();
        GenTab._updateRefModeUI();
        // Switch between global/per-prompt frame modes
        GenTab._updateFrameMode();
      });
    }

    // ─── Load saved state (prompt text + UI state) ─────────────────────────────────
    // Migration: presets → seosona_gentab_state
    chrome.storage.local.get(['seosona_gentab_state', 'presets'], (res) => {
      let state = res.seosona_gentab_state;
      if (!state && res.presets) {
        state = res.presets;
        chrome.storage.local.set({ seosona_gentab_state: state });
        chrome.storage.local.remove('presets');
      }
      if (state) {
        GenTab.loadState(state);
        GenTab.updatePromptCount();
      }
      // Override settings fields từ StorageSettings (settings-popup là source of truth)
      GenTab._applyStorageSettings();
    });

    // ─── Q1.6: Load addon prompts ───────────────────────────
    GenTab._loadAddonPrompts();

    // ─── Initialize addon prompt custom dropdown ─────────────
    GenTab._initAddonPromptDropdown();

    // ─── Q1.9: Bind addon select change to saveState ────────
    if (GenTab.addonPromptSelect) {
      GenTab.addonPromptSelect.addEventListener('change', () => {
        GenTab._updateAddonPromptTrigger();
        GenTab.saveState();
      });
    }

    // ─── T-2: Confirm modal handlers ──────────────────────
    GenTab._initConfirmModal();

    // ─── Prompt Search + Save row ────────────────────────
    GenTab._initPromptSearchRow();

    // ─── startBtn click handler ───────────────────────────
    if (GenTab.startBtn) GenTab.startBtn.addEventListener('click', async () => {
      const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;

      // CRITICAL — guard chống click trùng khi ChatGPT/Grok đang gen.
      // Trước fix: button.disabled set SAU _showConfirmModal → user click submit lần 2
      // trong lúc đang gen → modal reconfirm xuất hiện → submit chồng chéo.
      // Check flag _providerSubmitRunning đầu handler để block sớm.
      if (GenTab._providerSubmitRunning) {
        if (window.showNotification) {
          window.showNotification(t('gen.alreadyRunning') || 'Đang tạo, vui lòng chờ...', 'warning', 2000);
        }
        return;
      }
      // Audit fix (double-submit): set the busy flag SYNCHRONOUSLY right after the
      // guard, before any await (the confirm modal await previously let two fast
      // clicks both pass the guard). Every early-return path below resets it via
      // _abortSubmitGuard(); provider branches reset it in their own finally.
      GenTab._providerSubmitRunning = true;
      const _abortSubmitGuard = () => { GenTab._providerSubmitRunning = false; };

      const baseText = GenTab.promptsArea.value.trim();
      if (!baseText) {
        if (window.customDialog) window.customDialog.alert(t('gen.noPromptWarning'), { title: t('gen.noPromptTitle'), type: 'warning' });
        _abortSubmitGuard();
        return;
      }

      // Count prompts for confirm modal
      let promptCount = 1;
      if (GenTab.multiPromptCheck && GenTab.multiPromptCheck.checked) {
        promptCount = baseText.split(/\n\s*\n/).map(b => b.trim()).filter(b => b.length > 0).length;
      }

      // Batch limit check: giới hạn số prompt trong 1 lần submit multi-prompt
      if (promptCount > 1 && window.featureGate) {
        const batchCheck = window.featureGate.checkPromptBatchLimit(promptCount);
        if (!batchCheck.allowed) {
          const limitText = batchCheck.limit === -1 ? '∞' : batchCheck.limit;
          window.showNotification?.(
            window.I18n?.t?.('gen.batchLimitExceeded', { count: promptCount, limit: limitText }) ||
              window.I18n?.t?.('genNotifyExtra.batchLimitExceededFallback', { count: promptCount, limit: limitText }) ||
              `Gói của bạn giới hạn ${limitText} prompt/batch. Bạn đang có ${promptCount} prompt. Nâng cấp để tăng giới hạn.`,
            'warning'
          );
          _abortSubmitGuard();
          return;
        }
      }

      // T-2: Show confirm modal + activate provider tab song song (fire-and-forget).
      // User yêu cầu: khi submit gen của provider nào thì active tab provider đó NGAY TỪ
      // bước reconfirm modal (đỡ delay khi confirm xong, tab provider đã sẵn sàng).
      // - flow → activateFlowTabForExecution
      // - chatgpt → ChatGPTSession.ensureReady + ensureTabActive
      // - grok → GrokSession.ensureReady + ensureTabActive
      const _submitProviderKey = (document.getElementById('genProvider')?.value) || 'flow';
      try { GenTab._ensureProviderTab(_submitProviderKey); } catch (_) { /* fire-and-forget */ }

      const confirmed = await GenTab._showConfirmModal(promptCount);
      if (!confirmed) { _abortSubmitGuard(); return; }

      // Manual Enter mode: SEOSONA Flow điền prompt + ref nhưng KHÔNG tự submit — user tự nhấn Enter.
      // Confirm trả `{ confirmed, manualSubmitMode }` khi user chọn Manual (chỉ Flow).
      const _manualSubmitMode = (typeof confirmed === 'object' && confirmed?.manualSubmitMode === true);

      // Reload Flow page nếu user check "Reload Flow trước khi chạy" trong modal.
      // Confirm trả `{ confirmed: true, reloadFlow: true }` thay vì `true` khi user opt-in.
      if (typeof confirmed === 'object' && confirmed?.reloadFlow) {
        // UI feedback: đổi button text + disable
        const _reloadBtnSpan = GenTab.startBtn?.querySelector('span') || null;
        const _savedReloadBtnText = _reloadBtnSpan?.textContent;
        if (_reloadBtnSpan) {
          _reloadBtnSpan.textContent = window.I18n?.t('gen.reloadingFlow') || 'Đang reload Flow...';
        }
        GenTab.startBtn.disabled = true;
        GenTab.startBtn.style.opacity = '0.7';

        try {
          if (typeof sendLog === 'function') sendLog('Đang reload Flow page...', 'info');
          if (typeof window.showNotification === 'function') {
            window.showNotification(
              window.I18n?.t('gen.reloadingFlowWait') || 'Đang reload Flow, vui lòng chờ...',
              'info', 3000
            );
          }

          if (window.PromptQueue?.getInstance?.()?.forceReloadAndStabilize) {
            // PromptQueue path: sử dụng forceReloadAndStabilize với proper wait
            const reloadOk = await window.PromptQueue.getInstance().forceReloadAndStabilize('user-pre-submit');
            if (!reloadOk) {
              // Pipeline busy hoặc timeout - cảnh báo nhưng vẫn tiếp tục
              if (typeof sendLog === 'function') sendLog('Reload Flow không thành công (busy/timeout), tiếp tục...', 'warn');
              if (typeof window.showNotification === 'function') {
                window.showNotification(
                  window.I18n?.t('genNotifyExtra.reloadFlowFailed') || 'Reload Flow không thành công, tiếp tục submit...',
                  'warning', 3000
                );
              }
            } else {
              if (typeof sendLog === 'function') sendLog('Đã reload Flow page, editor sẵn sàng', 'info');
              if (typeof window.showNotification === 'function') {
                window.showNotification(
                  window.I18n?.t('gen.flowReloaded') || 'Flow page reloaded, ready!',
                  'success', 2000
                );
              }
            }
          } else if (window.MessageBridge) {
            // Fallback path: reload + poll chờ editor ready (max 30s)
            await window.MessageBridge.sendToContentScript('autoReloadFlow', {});

            // CRITICAL: Chờ page thực sự reload trước khi poll
            // Nếu poll ngay → OLD content script vẫn alive → false positive "ready"
            await new Promise(r => setTimeout(r, 2000));

            // Poll chờ editor ready
            const maxWait = 30000;
            const pollInterval = 500;
            const startTime = Date.now();
            let editorReady = false;

            while (Date.now() - startTime < maxWait) {
              await new Promise(r => setTimeout(r, pollInterval));
              try {
                const state = await window.MessageBridge.sendToContentScript('getEditor', {});
                if (state?.exists && state?.hasSlateState) {
                  editorReady = true;
                  break;
                }
              } catch (e) {
                // Content script chưa sẵn sàng sau reload, tiếp tục poll
              }
            }

            if (editorReady) {
              // Extra settle time cho React/Slate + images load
              await new Promise(r => setTimeout(r, 3000));
              if (typeof sendLog === 'function') sendLog('Đã reload Flow page, editor sẵn sàng', 'info');
              if (typeof window.showNotification === 'function') {
                window.showNotification(
                  window.I18n?.t('gen.flowReloaded') || 'Flow page reloaded, ready!',
                  'success', 2000
                );
              }
            } else {
              if (typeof sendLog === 'function') sendLog('Reload timeout, tiếp tục submit...', 'warn');
              if (typeof window.showNotification === 'function') {
                window.showNotification('Reload timeout, continuing submit...', 'warning', 3000);
              }
            }
          }
        } catch (e) {
          console.warn('[GenTab] Reload Flow trước submit fail (degrade):', e.message);
          if (typeof sendLog === 'function') sendLog('Reload thất bại, tiếp tục submit...', 'warn');
        } finally {
          // Restore button text sau khi reload xong (dù success hay fail)
          if (_reloadBtnSpan && typeof _savedReloadBtnText === 'string') {
            _reloadBtnSpan.textContent = _savedReloadBtnText;
          }
          GenTab.startBtn.style.opacity = '';
          // Không enable button ở đây - để code tiếp theo xử lý
        }
      }

      // GP-6.3 / GP-6.4: Check global quota warning/exhausted trước khi chạy
      if (window.featureGate) {
        const quotaCheck = window.featureGate.checkGlobalQuotaWarning('Generate');
        // GP-6.4: Nếu đã hết quota, dừng lại (dialog đã hiển thị bởi FeatureGate)
        if (quotaCheck.exhausted) {
          _abortSubmitGuard();
          return;
        }
        // GP-6.3: Nếu quota <10%, toast warning đã hiển thị, cho phép tiếp tục
      }

      // ExecutionLock: kiểm tra xem có tác vụ khác đang chạy không
      // Pipeline mode: không cần lock (PromptQueue orchestrate nội bộ)
      const _isPipelineMode = window.PromptQueue && PromptQueue.isEnabled();

      // Early check: Legacy mode - kiểm tra isRunning từ content.js TRƯỚC khi làm việc nặng.
      // Tránh chạy qua ExecutionGate, correctFileIds, reuploadMissingFiles nếu đã đang chạy.
      // CRITICAL: Chỉ check cho provider=flow. content.js là Flow content script — không
      // liên quan tới ChatGPT/Grok. Check sai cho non-Flow → block submit không lý do.
      const _earlyProviderCheck = (document.getElementById('genProvider')?.value) || 'flow';
      if (!_isPipelineMode && window.MessageBridge && _earlyProviderCheck === 'flow') {
        try {
          const runState = await window.MessageBridge.sendToContentScript('getRunningState', {});
          if (runState?.isRunning) {
            // Show modal ngay, không cần làm việc nặng
            const crowIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px;color:#a855f7;"><path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3"/><path d="M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/></svg>`;
            if (window.customDialog) {
              window.customDialog.alert(
                `<div style="line-height:1.6">${window.I18n?.t('gen.pipelineQueueHint', { icon: crowIcon }) || `Hãy bật mode <strong>${crowIcon}Pipeline Queue</strong> để chạy nhiều tác vụ cùng lúc.<br><br><span style="color:var(--muted-foreground);font-size:0.9em;">Hướng dẫn: Cài đặt → Nâng cao → Pipeline Queue</span>`}</div>`,
                {
                  title: window.I18n?.t('msg.flowBusy') || 'Google Flow đang bận',
                  type: 'info',
                  html: true,
                  buttons: [
                    { label: window.I18n?.t('common.close') || 'Đóng', primary: false, action: () => {} },
                    {
                      label: window.I18n?.t('header.settings') || 'Cài đặt',
                      primary: true,
                      action: () => {
                        chrome.runtime.sendMessage({ action: 'openSettings' });
                      }
                    }
                  ]
                }
              );
            }
            _abortSubmitGuard();
            return;
          }
        } catch (e) {
          // Fallback: content script chưa load xong, tiếp tục như bình thường
          console.warn('[GenTab] getRunningState check failed:', e.message);
        }
      }

      if (!_isPipelineMode && window.ExecutionLock && ExecutionLock.isBlockedBy('prompts')) {
        const shouldStop = await ExecutionLock.showBlockedDialog('prompts');
        if (!shouldStop) { _abortSubmitGuard(); return; }
        await ExecutionLock.stopCurrent();
      }
      if (!_isPipelineMode && window.ExecutionLock) ExecutionLock.acquire('prompts', 'Prompt batch');

      // Provider tab activation đã được fire ở bước reconfirm modal (line ~679 _ensureProviderTab).
      // Tới đây tab provider đã sẵn sàng — không cần re-activate.

      // SP-2.3: ExecutionGate - xin phep server truoc khi chay
      let _executionToken = null;
      if (window.ExecutionGate) {
        try {
          // Bug fix 2026-05-22: pass provider để backend ALSO deduct chatgpt/grok/gemini_run_max.
          // Trước fix: action='generate' chỉ deduct gen_run_max → chatgpt_run_max không enforce.
          const _currentProvider = document.getElementById('genProvider')?.value || 'flow';
          const gate = await ExecutionGate.request('generate', promptCount, { owner: 'prompts', label: 'Auto Gen', provider: _currentProvider });
          if (!gate.allowed) {
            // [Fix C 2026-06-10] Pass onRetry callback cho OFFLINE_CACHE_STALE case →
            // user click "Thử lại" → re-trigger startBtn click → re-run generate flow.
            // Other deny reasons (QUOTA_EXCEEDED, FEATURE_LOCKED, ...) callback ignored (dialog không render retry btn).
            ExecutionGate.showDeniedDialog(gate, 'Generate', () => {
              // Re-dispatch click event programmatic. Button enabled lại trước nên click fire OK.
              try { GenTab.startBtn?.click(); } catch (e) { console.warn('[GenTab] retry click failed:', e?.message); }
            });
            GenTab.startBtn.disabled = false;
            GenTab._providerSubmitRunning = false;
            if (window.ExecutionLock) ExecutionLock.release('prompts');
            return;
          }
          _executionToken = gate.token;
          GenTab._currentExecutionToken = _executionToken;
        } catch (e) {
          if (window.QuotaErrorHandler?.handleIfQuotaError(e, 'Generate')) {
            console.warn('[GenTab] ExecutionGate denied:', e.code || e.reason);
            GenTab.startBtn.disabled = false;
            GenTab._providerSubmitRunning = false;
            if (window.ExecutionLock) ExecutionLock.release('prompts');
            return;
          }
          // Bug fix 2026-05-22: fail-closed — block submit khi ExecutionGate.request throw
          // unhandled exception. Trước fix: proceed bypass quota → user gen vượt limit khi
          // server timeout/network error. ExecutionGate internal đã có _fallbackCheck (cache
          // local fail-closed) — nếu outer catch fire có nghĩa là unexpected error.
          console.error('[GenTab] ExecutionGate request failed, blocking submit:', e.message);
          window.showNotification?.(
            window.I18n?.t?.('gen.executionGateError') || 'Không thể kiểm tra quota. Vui lòng thử lại.',
            'error', 4000
          );
          GenTab.startBtn.disabled = false;
          GenTab._providerSubmitRunning = false;
          if (window.ExecutionLock) ExecutionLock.release('prompts');
          return;
        }
      }

      // Feature: Multi-prompt (split by blank line)
      let baseLines = [baseText];
      if (GenTab.multiPromptCheck && GenTab.multiPromptCheck.checked) {
        baseLines = baseText.split(/\n\s*\n/).map(block => block.trim()).filter(b => b.length > 0);
      }

      // Quantity: số lượng ảnh mỗi lần tạo (x1, x2, x3, x4 trong Flow menu)
      const quantity = parseInt(GenTab.quantitySelect?.value) || 1;
      // Phase 2c+: Server-Only — ExecutionConfig source of truth.
      const delayBetweenMs = (window.ExecutionConfig?.safeGetDelayBetweenPromptsSec?.() ?? 5) * 1000;

      let fileIds = GenTab.fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
      const genType = GenTab.genTypeSelect.value;
      const aspectRatio = GenTab.aspectRatioSelect.value;
      const modelName = genType === 'Image' ? GenTab.imageModelSelect.value : GenTab.videoModelSelect.value;

      // CG-5.4: Branch theo provider — nếu chatgpt thì rẽ nhánh _submitViaChatGPT
      // G-4.5: Branch theo provider — nếu grok thì rẽ nhánh _submitViaGrok
      const providerKey = (document.getElementById('genProvider')?.value) || 'flow';
      if (providerKey === 'grok') {
        // Defensive feature gate check — chống bypass UI (DevTools manipulation force genProvider=grok)
        const canGrok = !!(window.featureGate?.canUse?.('grok_enabled'));
        if (!canGrok) {
          try {
            window.featureGate?.showLoginPrompt?.(
              window.I18n?.t?.('gen.grokProviderLockedMsg') || 'Grok yêu cầu gói Pro để sử dụng.'
            );
          } catch (_) { /* noop */ }
          // Reset state để button không kẹt loading + giải phóng lock
          try { GenTab.startBtn.disabled = false; } catch (e) { console.warn('[GenTab] Khong mo lai duoc nut Start -> nut co the ket loading:', e && e.message); }
          GenTab._providerSubmitRunning = false;
          try { GenTab._resetRunningControls(); } catch (e) { console.warn('[GenTab] Reset control that bai -> UI co the ket trang thai dang chay:', e && e.message); }
          if (window.ExecutionLock) {
            try { ExecutionLock.release('prompts'); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#action', _); }
          }
          // Rollback execution token nếu đã request
          if (window.ExecutionGate && _executionToken) {
            try { ExecutionGate.cancel(_executionToken); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#action', _); }
            GenTab._currentExecutionToken = null;
          }
          return;
        }
        // Check grok_run_max quota (per-provider quota)
        const grokQuota = window.featureGate?.checkQuota?.('grok_run_max');
        if (grokQuota && !grokQuota.allowed) {
          const limitText = grokQuota.limit === 'unlimited' ? '∞' : grokQuota.limit;
          window.showNotification?.(
            window.I18n?.t?.('gen.providerQuotaExhausted', { provider: 'Grok', used: grokQuota.used, limit: limitText }) ||
              window.I18n?.t?.('genNotifyExtra.grokQuotaExhausted', { used: grokQuota.used, limit: limitText }) ||
              `Đã hết ${grokQuota.used}/${limitText} lượt Grok hôm nay.`,
            'warning'
          );
          try { GenTab.startBtn.disabled = false; } catch (e) { console.warn('[GenTab] Khong mo lai duoc nut Start -> nut co the ket loading:', e && e.message); }
          GenTab._providerSubmitRunning = false;
          try { GenTab._resetRunningControls(); } catch (e) { console.warn('[GenTab] Reset control that bai -> UI co the ket trang thai dang chay:', e && e.message); }
          if (window.ExecutionLock) { try { ExecutionLock.release('prompts'); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#action', _); } }
          if (window.ExecutionGate && _executionToken) {
            try { ExecutionGate.cancel(_executionToken); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#action', _); }
            GenTab._currentExecutionToken = null;
          }
          return;
        }
        try {
          // Lấy settings hiện tại để truyền autoClose, defaults...
          const settingsObj = await new Promise(resolve => {
            chrome.storage.local.get(['af_settings'], res => resolve(res.af_settings || {}));
          });

          // Multi-prompt split
          let grokPrompts = [baseText];
          if (GenTab.multiPromptCheck && GenTab.multiPromptCheck.checked) {
            grokPrompts = baseText.split(/\n\s*\n/).map(b => b.trim()).filter(b => b.length > 0);
          }
          if (grokPrompts.length === 0) {
            sendLog('Grok: không có prompt hợp lệ', 'warn');
            GenTab.startBtn.disabled = false;
            GenTab._providerSubmitRunning = false;
            if (window.ExecutionLock) ExecutionLock.release('prompts');
            return;
          }
          // Q1.8 parity [port 1.1.59]: nối addon/style prompt vào cuối mỗi prompt — nhánh Flow (~1591)
          // đã làm nhưng nhánh Grok bị SÓT → style không áp cho gen Grok. Dùng \n\n (chat prompt dài).
          {
            const _grokAddon = GenTab._getSelectedAddonPrompt();
            if (_grokAddon && _grokAddon.content) grokPrompts = grokPrompts.map(p => `${p}\n\n${_grokAddon.content}`);
          }

          // Reset stop flag
          GenTab._grokStopRequested = false;
          // Set provider running flag (giống ChatGPT pattern)
          GenTab._providerSubmitRunning = true;

          GenTab.startBtn.disabled = true;
          if (GenTab.genBtnRow) GenTab.genBtnRow.classList.add('is-running');
          if (GenTab.genRunningControls) GenTab.genRunningControls.classList.remove('hidden');

          const grokResult = await GenTab._submitViaGrok({
            prompts: grokPrompts,
            fileIds,
            settings: { ratio: aspectRatio, quantity, genType },
            settingsObj,
            executionToken: _executionToken
          });

          // ExecutionGate complete
          if (window.ExecutionGate && _executionToken) {
            const status = (grokResult.completed > 0 && grokResult.failed === 0) ? 'success'
                         : (grokResult.completed === 0 ? 'failed' : 'success');
            ExecutionGate.complete(_executionToken, status);
            GenTab._currentExecutionToken = null;
          }

          // Track usage: grok_run_max + prompt_submit_max
          if (grokResult.completed > 0 && window.featureGate) {
            window.featureGate.recordGrokRun(grokResult.completed);
            window.featureGate.recordPromptSubmit(grokResult.completed, 'grok');
          }

          sendLog(`Grok hoàn tất: ${grokResult.completed} thành công, ${grokResult.failed} thất bại${grokResult.stopped ? ' (đã dừng)' : ''}`, 'info');

          // Show failed prompts section + modal (giống Flow)
          if (grokResult.failedPrompts && grokResult.failedPrompts.length > 0) {
            GenTab._showFailedPrompts(grokResult.failedPrompts);
            GenTab._showFailedPromptsSummaryModal(
              grokResult.failedPrompts,
              grokPrompts.length,
              grokResult.completed
            );
          }

          GenTab._providerSubmitRunning = false;
          GenTab._resetRunningControls();
          if (window.ExecutionLock) ExecutionLock.release('prompts');
        } catch (err) {
          console.error('[GenTab] Grok submit error:', err);
          sendLog('Grok lỗi: ' + (err.message || err), 'error');
          if (window.ExecutionGate && _executionToken) {
            ExecutionGate.complete(_executionToken, 'failed', { error: err.message || String(err) });
            GenTab._currentExecutionToken = null;
          }
          GenTab._providerSubmitRunning = false;
          GenTab._resetRunningControls();
          if (window.ExecutionLock) ExecutionLock.release('prompts');
        }
        return;
      }
      if (providerKey === 'chatgpt') {
        // Defensive feature gate check — chống bypass UI (DevTools manipulation force genProvider=chatgpt)
        // Auth-aware: logged-in → upgrade modal; anonymous → login prompt
        const canChatGPT = !!(window.featureGate?.canUse?.('chatgpt_enabled'));
        if (!canChatGPT) {
          try {
            window.featureGate?.showLoginPrompt?.(
              window.I18n?.t?.('gen.providerLockedMsg') || 'ChatGPT yêu cầu gói Pro để sử dụng.'
            );
          } catch (_) { /* noop */ }
          // Reset state để button không kẹt loading + giải phóng lock
          try { GenTab.startBtn.disabled = false; } catch (e) { console.warn('[GenTab] Khong mo lai duoc nut Start -> nut co the ket loading:', e && e.message); }
          GenTab._providerSubmitRunning = false;
          try { GenTab._resetRunningControls(); } catch (e) { console.warn('[GenTab] Reset control that bai -> UI co the ket trang thai dang chay:', e && e.message); }
          if (window.ExecutionLock) {
            try { ExecutionLock.release('prompts'); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#action', _); }
          }
          // Rollback execution token nếu đã request
          if (window.ExecutionGate && _executionToken) {
            try { ExecutionGate.cancel(_executionToken); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#action', _); }
            GenTab._currentExecutionToken = null;
          }
          return; // Block submit
        }
        // Check chatgpt_run_max quota (per-provider quota)
        const chatgptQuota = window.featureGate?.checkQuota?.('chatgpt_run_max');
        if (chatgptQuota && !chatgptQuota.allowed) {
          const limitText = chatgptQuota.limit === 'unlimited' ? '∞' : chatgptQuota.limit;
          window.showNotification?.(
            window.I18n?.t?.('gen.providerQuotaExhausted', { provider: 'ChatGPT', used: chatgptQuota.used, limit: limitText }) ||
              window.I18n?.t?.('genNotifyExtra.chatgptQuotaExhausted', { used: chatgptQuota.used, limit: limitText }) ||
              `Đã hết ${chatgptQuota.used}/${limitText} lượt ChatGPT hôm nay.`,
            'warning'
          );
          try { GenTab.startBtn.disabled = false; } catch (e) { console.warn('[GenTab] Khong mo lai duoc nut Start -> nut co the ket loading:', e && e.message); }
          GenTab._providerSubmitRunning = false;
          try { GenTab._resetRunningControls(); } catch (e) { console.warn('[GenTab] Reset control that bai -> UI co the ket trang thai dang chay:', e && e.message); }
          if (window.ExecutionLock) { try { ExecutionLock.release('prompts'); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#action', _); } }
          if (window.ExecutionGate && _executionToken) {
            try { ExecutionGate.cancel(_executionToken); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#action', _); }
            GenTab._currentExecutionToken = null;
          }
          return;
        }
        try {
          // Lấy settings hiện tại để truyền autoClose, fallbackPrefix...
          const settingsObj = await new Promise(resolve => {
            chrome.storage.local.get(['af_settings'], res => resolve(res.af_settings || {}));
          });

          // Multi-prompt split
          let chatgptPrompts = [baseText];
          if (GenTab.multiPromptCheck && GenTab.multiPromptCheck.checked) {
            chatgptPrompts = baseText.split(/\n\s*\n/).map(b => b.trim()).filter(b => b.length > 0);
          }
          if (chatgptPrompts.length === 0) {
            sendLog('ChatGPT: không có prompt hợp lệ', 'warn');
            GenTab.startBtn.disabled = false;
            GenTab._providerSubmitRunning = false;
            if (window.ExecutionLock) ExecutionLock.release('prompts');
            return;
          }
          // Q1.8 parity [port 1.1.59]: nối addon/style prompt vào cuối mỗi prompt — nhánh ChatGPT bị SÓT.
          {
            const _cgAddon = GenTab._getSelectedAddonPrompt();
            if (_cgAddon && _cgAddon.content) chatgptPrompts = chatgptPrompts.map(p => `${p}\n\n${_cgAddon.content}`);
          }

          // Reset stop flag
          GenTab._chatgptStopRequested = false;
          // Set provider running flag → _updateGenBtnUploadState giữ button disabled
          // suốt thời gian gen (Pipeline ON không acquire ExecutionLock cho non-Flow).
          GenTab._providerSubmitRunning = true;

          GenTab.startBtn.disabled = true;
          if (GenTab.genBtnRow) GenTab.genBtnRow.classList.add('is-running');
          if (GenTab.genRunningControls) GenTab.genRunningControls.classList.remove('hidden');

          const cgResult = await GenTab._submitViaChatGPT({
            prompts: chatgptPrompts,
            fileIds,
            settings: { ratio: aspectRatio, model: GenTab.chatgptModelSelect?.value || null },
            settingsObj,
            executionToken: _executionToken
          });

          // ExecutionGate complete (success/failed dựa trên kết quả)
          if (window.ExecutionGate && _executionToken) {
            const status = (cgResult.completed > 0 && cgResult.failed === 0) ? 'success'
                         : (cgResult.completed === 0 ? 'failed' : 'success');
            ExecutionGate.complete(_executionToken, status);
            GenTab._currentExecutionToken = null;
          }

          // Track usage: chatgpt_run_max + prompt_submit_max
          if (cgResult.completed > 0 && window.featureGate) {
            window.featureGate.recordChatGPTRun(cgResult.completed);
            window.featureGate.recordPromptSubmit(cgResult.completed, 'chatgpt');
          }

          sendLog(`ChatGPT hoàn tất: ${cgResult.completed} thành công, ${cgResult.failed} thất bại${cgResult.stopped ? ' (đã dừng)' : ''}`, 'info');

          // Show failed prompts section + modal (giống Flow)
          if (cgResult.failedPrompts && cgResult.failedPrompts.length > 0) {
            GenTab._showFailedPrompts(cgResult.failedPrompts);
            GenTab._showFailedPromptsSummaryModal(
              cgResult.failedPrompts,
              chatgptPrompts.length,
              cgResult.completed
            );
          }

          GenTab._providerSubmitRunning = false;
          GenTab._resetRunningControls();
          if (window.ExecutionLock) ExecutionLock.release('prompts');
        } catch (err) {
          console.error('[GenTab] ChatGPT submit error:', err);
          sendLog('ChatGPT lỗi: ' + (err.message || err), 'error');
          if (window.ExecutionGate && _executionToken) {
            ExecutionGate.complete(_executionToken, 'failed', { error: err.message || String(err) });
            GenTab._currentExecutionToken = null;
          }
          GenTab._providerSubmitRunning = false;
          GenTab._resetRunningControls();
          if (window.ExecutionLock) ExecutionLock.release('prompts');
        }
        return;
      }

      // Audit fix (double-submit): from here the Flow path is protected by
      // ExecutionLock (acquired above) + startBtn.disabled, so release the
      // synchronous submit guard that only needed to cover the confirm-modal
      // await window. (grok/chatgpt branches returned before reaching here and
      // manage the flag in their own finally.)
      GenTab._providerSubmitRunning = false;

      // Flow path — defensive feature gate check cho gen_enabled
      // Tương tự pattern ChatGPT/Grok: chống bypass UI (DevTools manipulation)
      const canFlow = !!(window.featureGate?.canUse?.('gen_enabled'));
      if (!canFlow) {
        // Feature locked — show upgrade prompt
        if (true) {
          // Logged in but plan doesn't include Flow
          const shouldUpgrade = await window.customDialog?.confirm?.(
            window.I18n?.t?.('gen.flowProviderLockedMsg') || 'Google Flow yêu cầu gói phù hợp để sử dụng. Nâng cấp để mở khóa.',
            {
              title: window.I18n?.t?.('gen.providerLocked') || 'Tính năng bị khóa',
              type: 'warning',
              confirmText: window.I18n?.t?.('common.upgrade') || 'Nâng cấp',
              cancelText: window.I18n?.t?.('common.later') || 'Để sau',
            }
          );
          if (shouldUpgrade) {
            chrome.runtime.sendMessage({ action: 'showUpgradeModal' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('GenTab#action', _e); });
          }
        } else {
          // Not logged in
          window.featureGate?.showLoginPrompt?.(
            window.I18n?.t?.('gen.flowProviderLockedMsg') || 'Google Flow yêu cầu đăng nhập và gói phù hợp để sử dụng.'
          );
        }
        try { GenTab.startBtn.disabled = false; } catch (e) { console.warn('[GenTab] Khong mo lai duoc nut Start -> nut co the ket loading:', e && e.message); }
        if (window.ExecutionLock) ExecutionLock.release('prompts');
        return;
      }

      // Fix flicker zoom 2026-06-22: arm zoom session 0.3 (transient, KHÔNG hold) TRƯỚC ref-prep
      // (correctFileIds + reuploadMissingFiles scan) → mọi ensureFlowTilesLoaded in-session 0.3, bỏ
      // multi-pass zoom in/out. KHÔNG end ở GenTab (submitJob fire-and-forget, gen chạy async) → để
      // PromptQueue _checkAllDone (non-force, refs==0 vì transient) restore khi gen xong. Error-trước-submit
      // (hiếm) → session tự lành ở lần gen kế (PQ end refs==0 restore). Await để armed trước scan đầu.
      if (window.MessageBridge?.sendToContentScript) {
        try { await window.MessageBridge.sendToContentScript('beginFlowZoomSession', { factor: 0.3 }); } catch (e) { /* non-blocking */ }
      }

      // [Fix 2026-06-10] Pre-call ensureFlowTilesLoaded TRƯỚC Tầng 1-3 correctFileIds —
      // đồng bộ WorkflowExecutor Fix D2 (line 2978, 2026-06-05). Khi user Flow library
      // >50 tiles + ref images nằm xa (chưa lazy-loaded vào DOM):
      //   - Trước: correctFileIds MISS (tile chưa trong DOM) → fall to reuploadMissingFiles
      //     → trigger force zoom + recheck (1 round-trip extra ~500ms-1s)
      //   - Sau: pre-call default heuristic → DOM có ref tiles → correctFileIds match ngay
      // Chỉ call nếu có Flow tile ids thật (filter upload_xxx pending để tránh waste).
      const _nonPendingIds = fileIds.filter(id => !id.startsWith('upload_'));
      if (_nonPendingIds.length > 0 && window.MessageBridge?.sendToContentScript) {
        try {
          await window.MessageBridge.sendToContentScript('ensureFlowTilesLoaded');
        } catch (e) {
          console.warn('[GenTab] Pre-call ensureFlowTilesLoaded failed (non-blocking):', e?.message || e);
        }
      }

      // Correct stale tile IDs using file_name/thumbnail cache (5-tầng correction)
      // Note: correctStaleFileIds tự wait cho selector config ready, không cần prepareFlowForScan
      if (fileIds.length > 0 && typeof window.correctFileIds === 'function') {
        const hasThumbs = Object.keys(GenTab.thumbnailCache).length > 0;
        const hasFileNames = Object.keys(GenTab.fileNameCache).length > 0;
        if (hasThumbs || hasFileNames) {
          const { correctedIds, changed } = await window.correctFileIds(
            fileIds.join(', '),
            GenTab.thumbnailCache,
            GenTab.fileNameCache
          );
          if (changed) {
            const newIds = correctedIds.split(',').map(s => s.trim()).filter(Boolean);
            // Transfer refImageNames + thumbnailCache + fileNameCache từ old → new keys
            for (let k = 0; k < fileIds.length; k++) {
              const oldId = fileIds[k];
              const newId = newIds[k];
              if (oldId && newId && oldId !== newId) {
                if (GenTab.refImageNames[oldId]) {
                  GenTab.refImageNames[newId] = GenTab.refImageNames[oldId];
                  delete GenTab.refImageNames[oldId];
                }
                if (GenTab.thumbnailCache[oldId]) {
                  GenTab.thumbnailCache[newId] = GenTab.thumbnailCache[oldId];
                  delete GenTab.thumbnailCache[oldId];
                }
                if (GenTab.fileNameCache[oldId]) {
                  GenTab.fileNameCache[newId] = GenTab.fileNameCache[oldId];
                  delete GenTab.fileNameCache[oldId];
                }
              }
            }
            console.log('[GenTab] Ref IDs corrected:', fileIds.join(', '), '->', correctedIds);
            fileIds = newIds;
            // Update UI
            GenTab.fileIdsInput.value = correctedIds;
            GenTab.renderFileIdThumbnails();
            GenTab.saveState();
          }
        }
      }

      // Tầng 4-5: reuploadMissingFiles cho IDs vẫn còn missing sau correctFileIds
      // Note: reuploadMissingFiles đã tự transfer GenTab metadata (refImageNames, thumbnailCache, fileNameCache)
      // khi re-upload thành công. Ở đây chỉ cần detect dropped IDs và update UI.
      if (fileIds.length > 0 && typeof window.reuploadMissingFiles === 'function') {
        // Detect missing IDs TRƯỚC khi reupload để hiển thị loading UX
        let preReuploadMissing = [];
        try {
          const nonPending = fileIds.filter(id => !id.startsWith('upload_'));
          if (nonPending.length > 0 && window.MessageBridge) {
            const check = await window.MessageBridge.checkTilesExist(nonPending);
            preReuploadMissing = check?.missing || [];
          }
        } catch (e) {
          console.warn('[GenTab] Pre-reupload check failed:', e.message);
        }

        // Nếu có ảnh cần reupload → disable button + hiệu ứng loading
        if (preReuploadMissing.length > 0) {
          GenTab.startBtn.disabled = true;
          GenTab._savedBtnText = GenTab.startBtn.textContent;
          GenTab.startBtn.textContent = window.I18n?.t('gen.reloadingImages') || 'Đang tải lại ảnh...';
          GenTab.startBtn.style.opacity = '0.6';

          // Thêm CSS uploading effect lên ref thumbnails đang reupload.
          // Phải target ĐÚNG .ref-thumb (mention mode: cả .ref-item lẫn .ref-thumb đều có
          // data-ref-id → query trần trả .ref-item → CSS `> div:first-child` ép .ref-thumb
          // width:100% → ảnh phình full-width. Dùng `.ref-thumb[...]` để khoá đúng phần tử).
          for (const missingId of preReuploadMissing) {
            const thumbEl = GenTab.fileIdThumbnails?.querySelector(`.ref-thumb[data-ref-id="${missingId}"]`);
            if (thumbEl) thumbEl.classList.add('ref-thumb-reuploading');
          }
        }

        const fileIdsBefore = [...fileIds];
        const fileIdsStr = fileIds.join(', ');
        // CRITICAL: Truyền file_names map để check file_name trước (tránh reupload không cần thiết)
        const updated = await window.reuploadMissingFiles(fileIdsStr, GenTab.thumbnailCache || {}, null, GenTab.fileNameCache || {});
        if (updated !== fileIdsStr) {
          const newIds = updated.split(',').map(s => s.trim()).filter(Boolean);
          console.log('[GenTab] Ref IDs after reupload:', fileIdsStr, '->', updated);
          fileIds = newIds;
          GenTab.fileIdsInput.value = updated;
          GenTab.renderFileIdThumbnails();
          GenTab.saveState();
        }

        // Detect truly dropped IDs (reupload failed → count decreased)
        // reuploadMissingFiles REPLACES old IDs with new tile IDs (same count),
        // and REMOVES IDs it can't recover (count decreases).
        // So: count decrease = truly dropped, ID change = normal reupload replacement.
        if (fileIds.length < fileIdsBefore.length) {
          // Find which old IDs were removed (not present in new list AND not replaced)
          const droppedIds = fileIdsBefore.filter(id => !fileIds.includes(id));

          // Build display info BEFORE cleanup (metadata still exists for dropped IDs)
          const droppedNames = droppedIds.map(id => {
            const name = GenTab.refImageNames?.[id];
            const fileName = GenTab.fileNameCache?.[id];
            return name || (fileName ? fileName.substring(0, 12) : id.substring(0, 12));
          });

          // Cleanup: remove dropped images from album + GenTab caches
          for (const id of droppedIds) {
            GenTab._removeFailedAlbumImage(id);
            if (GenTab.refImageNames) delete GenTab.refImageNames[id];
            if (GenTab.thumbnailCache) delete GenTab.thumbnailCache[id];
            if (GenTab.fileNameCache) delete GenTab.fileNameCache[id];
          }
          GenTab.renderFileIdThumbnails();
          GenTab.saveState();

          // Show modal to notify user — stop execution so user can re-select
          const listText = droppedNames.map(n => `  - ${n}`).join('\n');
          await window.customDialog?.alert(
            window.I18n?.t('gen.refImageUnavailable', { count: droppedIds.length, list: listText }) || `${droppedIds.length} ảnh tham chiếu không còn tồn tại trên Flow và không thể khôi phục:\n\n${listText}\n\nẢnh đã được xóa khỏi album. Vui lòng chọn ảnh khác.`,
            { title: window.I18n?.t('gen.refImageUnavailableTitle') || 'Ảnh tham chiếu không khả dụng', type: 'warning' }
          );

          // Restore button text trước khi return
          if (GenTab._savedBtnText) {
            GenTab.startBtn.textContent = GenTab._savedBtnText;
            GenTab._savedBtnText = null;
          }
          GenTab.startBtn.style.opacity = '';
          GenTab.startBtn.disabled = false;
          return;
        }

        // Xóa CSS reuploading effect sau khi reupload hoàn thành
        if (preReuploadMissing.length > 0) {
          const reuploadingEls = GenTab.fileIdThumbnails?.querySelectorAll('.ref-thumb-reuploading');
          if (reuploadingEls) reuploadingEls.forEach(el => el.classList.remove('ref-thumb-reuploading'));
          // Restore button text (giữ disabled vì sắp generate)
          if (GenTab._savedBtnText) {
            GenTab.startBtn.textContent = GenTab._savedBtnText;
            GenTab._savedBtnText = null;
          }
          GenTab.startBtn.style.opacity = '';
        }
      }

      // Mỗi prompt chỉ submit 1 lần, quantity quyết định số ảnh mỗi lần (via Flow x1/x2/x3/x4)
      let finalPrompts = baseLines;

      if (finalPrompts.length === 0) return;

      // Q1.8: Inject addon prompt text vào cuối mỗi prompt
      const selectedAddon = GenTab._getSelectedAddonPrompt();
      if (selectedAddon && selectedAddon.content) {
        finalPrompts = finalPrompts.map(prompt => `${prompt}, ${selectedAddon.content}`);
      }

      // Show running controls, shrink generate button
      const isMultiPrompt = finalPrompts.length > 1;

      if (_isPipelineMode) {
        // Pipeline mode: KHÔNG add is-running (CSS block pointer-events) — user có
        // thể queue thêm jobs khi pipeline đang chạy. Chỉ show pause/stop cho
        // multi-prompt. startBtn re-enable ngay sau submitJob (line ~1587).
        GenTab.startBtn.disabled = true; // Tạm disable trong lúc submit
        if (isMultiPrompt) {
          if (GenTab.genRunningControls) GenTab.genRunningControls.classList.remove('hidden');
          if (GenTab.pauseBtn) {
            GenTab.pauseBtn.classList.remove('paused');
            GenTab.pauseBtn.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>`;
            GenTab.pauseBtn.dataset.paused = 'false';
          }
        }
      } else {
        // Legacy mode: disable startBtn, show running controls
        GenTab.startBtn.disabled = true;
        if (GenTab.genBtnRow) {
          GenTab.genBtnRow.classList.add('is-running');
        }
        if (GenTab.genRunningControls) {
          GenTab.genRunningControls.classList.remove('hidden');
        }
        if (GenTab.pauseBtn) {
          GenTab.pauseBtn.classList.remove('paused');
          GenTab.pauseBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <rect x="6" y="4" width="4" height="16"></rect>
              <rect x="14" y="4" width="4" height="16"></rect>
            </svg>`;
          GenTab.pauseBtn.dataset.paused = 'false';
        }
      }

      // UA-3.4: Theo doi bat dau generation
      window.UsageSync?.trackEvent('gen_start', { prompt_count: finalPrompts.length, has_ref: fileIds.length > 0, pipeline: !!_isPipelineMode });

      // Emit tracker started event
      if (window.eventBus) {
        window.eventBus.emit('execution:tracker_update', {
          owner: 'prompts',
          label: 'Auto Gen',
          phase: 'started',
          current: 0,
          total: finalPrompts.length,
          promptText: finalPrompts[0] || ''
        });
      }

      // Reset log container
      const logContainer = document.getElementById('logContainer');
      if (logContainer) logContainer.innerHTML = '';

      // Collect frame file IDs for Video+Frames mode
      const videoInputType = GenTab.videoInputTypeSelect ? GenTab.videoInputTypeSelect.value : '';
      const isVideoFrames = genType === 'Video' && videoInputType === 'Frames';
      let frameFileIds = null;
      if (isVideoFrames) {
        const isMultiPrompt = GenTab.multiPromptCheck?.checked;
        const promptCount = GenTab._getPromptCount();

        if (isMultiPrompt && promptCount > 1 && GenTab._perPromptFrameData.length > 0) {
          // Per-prompt frame pairs: array format [{ frame1, frame2 }, ...]
          frameFileIds = [];
          for (let fi = 0; fi < promptCount; fi++) {
            const ppData = GenTab._perPromptFrameData[fi];
            frameFileIds.push({
              frame1: ppData?.frame1 || '',
              frame2: ppData?.frame2 || ''
            });
          }
        } else {
          // Legacy single pair: object format { frame1, frame2 }
          const f1 = document.getElementById('genTabFrame1FileId');
          const f2 = document.getElementById('genTabFrame2FileId');
          frameFileIds = {
            frame1: f1 ? f1.value.trim() : '',
            frame2: f2 ? f2.value.trim() : ''
          };
        }
      }

      // S4: Handle mention mode - process @mentions in prompts
      const refImageMode = GenTab.refImageMode;
      let mentionProcessed = null;

      if (refImageMode === 'mention' && window.MentionParser) {
        // Register current ref images to registry
        const refImagesWithNames = GenTab._getCurrentRefImagesWithNames();
        console.log('[GenTab] @mention: refImagesWithNames =', refImagesWithNames);
        if (window.imageNameRegistry) {
          window.imageNameRegistry.registerFromRefImages(refImagesWithNames);
          console.log('[GenTab] @mention: registry names =', window.imageNameRegistry.getAvailableNames());
        }

        // Process prompts to resolve @mentions
        mentionProcessed = window.MentionParser.processMultiPrompts(finalPrompts);
        console.log('[GenTab] @mention: BEFORE upload, mentionProcessed =', JSON.stringify(mentionProcessed, (k, v) => {
          if (k === 'file' || k === 'blob') return '[File/Blob]';
          return v;
        }, 2));

        // Check for unresolved mentions
        const unresolvedPrompts = mentionProcessed.filter(p => p.hasUnresolvedMentions);
        if (unresolvedPrompts.length > 0) {
          const unresolvedNames = unresolvedPrompts.flatMap(p =>
            p.mentions.filter(m => !m.found).map(m => '@' + m.mention.imageName)
          );
          const uniqueNames = [...new Set(unresolvedNames)];
          sendLog(window.I18n?.t('gen.mentionWarning', { names: uniqueNames.join(', ') }) || `Cảnh báo: Không tìm thấy ảnh cho ${uniqueNames.join(', ')}`, 'warn');
        }

        // Phase S2.6.4: Upload pending images với batch resolution
        if (window.MentionParser.uploadPendingImagesBatch) {
          await window.MentionParser.uploadPendingImagesBatch(mentionProcessed);
        } else {
          await window.MentionParser.uploadPendingImages(mentionProcessed);
        }

        console.log('[GenTab] @mention: AFTER upload, mentionProcessed =', JSON.stringify(mentionProcessed, (k, v) => {
          if (k === 'file' || k === 'blob') return '[File/Blob]';
          return v;
        }, 2));

        // Update UI: replace upload_xxx keys with new tile IDs in fileIds and UI
        const uploadedRefImages = mentionProcessed.flatMap(p => p.refImages || []);
        for (const ref of uploadedRefImages) {
          if (ref._pendingUploadKey && ref.file_id && !ref.file_id.startsWith('upload_')) {
            const oldKey = ref._pendingUploadKey;
            const newId = ref.file_id;
            // Update fileIds array
            const idx = fileIds.indexOf(oldKey);
            if (idx !== -1) {
              fileIds[idx] = newId;
            }
            // Transfer refImageNames
            if (GenTab.refImageNames[oldKey]) {
              GenTab.refImageNames[newId] = GenTab.refImageNames[oldKey];
              delete GenTab.refImageNames[oldKey];
            }
            // Transfer thumbnailCache
            if (GenTab.thumbnailCache[oldKey]) {
              GenTab.thumbnailCache[newId] = GenTab.thumbnailCache[oldKey];
              delete GenTab.thumbnailCache[oldKey];
            }
            // Cleanup pendingUploadFiles
            window.pendingUploadFiles?.delete(oldKey);
            console.log(`[GenTab] @mention: UI updated ${oldKey.substring(0, 15)}... → ${newId.substring(0, 20)}...`);
          }
        }
        // Update input and re-render
        if (GenTab.fileIdsInput) {
          GenTab.fileIdsInput.value = fileIds.join(', ');
          GenTab.renderFileIdThumbnails();
        }

        // Check for images needing re-selection (WeakRef GC'd)
        const needReselect = mentionProcessed.flatMap(p =>
          (p.refImages || []).filter(ref => ref._needReselect).map(ref => ref.name)
        );
        if (needReselect.length > 0) {
          const uniqueNames = [...new Set(needReselect)];
          sendLog(window.I18n?.t('gen.mentionReselect', { names: uniqueNames.join(', ') }) || `Cảnh báo: Ảnh "${uniqueNames.join(', ')}" không còn khả dụng, vui lòng chọn lại`, 'warn');
          // Show re-select prompt via CustomDialog
          if (window.customDialog) {
            window.customDialog.alert(
              window.I18n?.t('gen.mentionReselectDialog', { list: uniqueNames.map(n => '• @' + n).join('\n') }) || `Một số ảnh không còn khả dụng:\n${uniqueNames.map(n => '• @' + n).join('\n')}\n\nVui lòng mở Album và chọn lại ảnh.`,
              window.I18n?.t('gen.mentionReselectTitle') || 'Cần chọn lại ảnh'
            );
          }
        }
      }

      // Ref-per-prompt: mỗi prompt dùng 1 ảnh tham chiếu tương ứng (sequential mode)
      const refPerPrompt = refImageMode === 'sequential' && GenTab.multiPromptCheck?.checked;

      // Parallel mode: submit all prompts without waiting for tiles
      // FIX (2026-05-14): Single prompt (multi-prompt OFF) luôn dùng parallel mode.
      const isMultiPromptEnabled = GenTab.multiPromptCheck?.checked;
      const isParallelMode = !isMultiPromptEnabled || GenTab.runMode === 'parallel';
      console.log('[GenTab] Submit mode check: multiPrompt=', isMultiPromptEnabled, 'runMode=', GenTab.runMode, 'isParallelMode=', isParallelMode);

      // Auto-download toggle + resolution (pass qua payload vì content script không access được sidePanel DOM)
      // Check feature gate: nếu không có quyền, force autoDownload = false
      const canUseAutoDownload = window.featureGate?.canUse('auto_download') ?? false;
      const autoDownloadToggle = document.getElementById('genTabAutoDownload');
      const autoDownload = canUseAutoDownload && (autoDownloadToggle?.checked || false);
      const downloadResolution = document.getElementById('genTabDownloadResolution')?.value || '1k';
      const videoDownloadResolution = document.getElementById('genTabVideoDownloadResolution')?.value || '1080p';
      let flowVideoDuration = GenTab.flowVideoDurationSelect?.value || null;
      // Model constraint override (2026-05-22): vd Veo 3.1 Lite/Fast Ingredients + ref → ép 8s.
      // Schema server-side: provider_models.config.duration_overrides[]. Áp dụng cho GenTab Flow
      // path tương tự WorkflowExecutor — extension cũ KHÔNG có rule này → user gen ra video không ref.
      if (flowVideoDuration && genType === 'Video' && fileIds.length > 0) {
        const flowAdapter = window.ProviderRegistry?.get?.('flow');
        // 2026-05-27: detect ref VIDEO (vd Omni Flash + ref video → force 10s).
        const _gtHasRefVideo = fileIds.some(id => GenTab.refMediaTypes?.[id] === 'video');
        const forced = flowAdapter?.getDurationOverride?.({
          modelValue: modelName,
          hasRef: true,
          hasRefVideo: _gtHasRefVideo,
          inputType: 'Ingredients', // GenTab Flow Video luôn Ingredients (Frames có UI riêng)
        });
        if (forced && forced !== flowVideoDuration) {
          sendLog(`[Model Constraint] Duration ép ${flowVideoDuration} → ${forced} (${modelName} + ref image). Đổi UI để khớp.`, 'warn');
          flowVideoDuration = forced;
          // Update UI dropdown để user thấy giá trị thực sự được gửi
          if (GenTab.flowVideoDurationSelect) {
            try { GenTab.flowVideoDurationSelect.value = forced; } catch (_) { /* noop */ }
          }
        }
      }
      const genSubFolder = document.getElementById('genTabSubFolder')?.value?.trim() || null;

      // Apply ref limit: Video Ingredients → 3, Image → 10
      const refLimit = GenTab.getRefLimit();
      if (fileIds.length > refLimit) {
        sendLog(window.I18n?.t('gen.refExceedLimitLog', { count: fileIds.length, limit: refLimit }) || `Ref images vượt giới hạn (${fileIds.length}/${refLimit}), chỉ gửi ${refLimit} ảnh đầu tiên`, 'warn');
        fileIds = fileIds.slice(0, refLimit);
      }

      // Model constraint: strip ref images nếu model KHÔNG hỗ trợ.
      // Schema: supports_ref_images=false (global) hoặc ref_support_overrides (conditional per input_type/duration).
      // Note: duration đã có thể auto-bump 8s ở trên (duration_overrides + has_ref=true) → check sau bump.
      if (fileIds.length > 0) {
        const _flowAdapter = window.ProviderRegistry?.get?.('flow');
        if (_flowAdapter?.supportsRefImages) {
          const _gtInputTypeStrip = genType === 'Video'
            ? (GenTab.videoInputTypeSelect?.value || 'Ingredients')
            : undefined;
          const _gtDurationStrip = genType === 'Video' ? (flowVideoDuration || undefined) : undefined;
          if (!_flowAdapter.supportsRefImages(modelName, { inputType: _gtInputTypeStrip, duration: _gtDurationStrip })) {
            const _ctxStr = _gtInputTypeStrip ? ` (${_gtInputTypeStrip}${_gtDurationStrip ? ', ' + _gtDurationStrip : ''})` : '';
            sendLog(window.I18n?.t('gen.modelNoRefSupport', { model: modelName, count: fileIds.length }) || `[Model Constraint] Model "${modelName}"${_ctxStr} KHÔNG hỗ trợ ref images — bỏ qua ${fileIds.length} ảnh`, 'warn');
            fileIds = [];
          }
        }
      }

      // Build payload based on ref image mode
      let payloadFileIds = isVideoFrames ? [] : fileIds;
      let payloadPrompts = finalPrompts;

      if (refImageMode === 'mention' && mentionProcessed) {
        // Mention mode: each prompt may have different ref images
        // GIỮ NGUYÊN @mention_name trong prompt (dùng originalPrompt thay vì cleanedPrompt)
        payloadPrompts = mentionProcessed.map(p => p.originalPrompt);
        // fileIds will be set per-prompt in content.js based on mentionData
      } else if (refImageMode === 'none') {
        // No ref images mode
        payloadFileIds = [];
      }
      // 'all' mode: use all fileIds for every prompt (default behavior)
      // 'sequential' mode: refPerPrompt=true, content.js will pick one per prompt

      // Truyền inputTimeout qua payload - content.js không có access DOM sidebar
      const inputTimeoutMs = window.storageSettings?.getSettings()?.inputTimeout || 1200;

      // Flow Voice Selector — compose voice payload từ dropdown (chỉ Flow video + model supports_voice)
      let voicePayload = null;
      try {
        const voiceSlug = document.getElementById('genVideoVoiceSelect')?.value || '';
        if (voiceSlug && genType === 'Video') {
          const voiceObj = window.VoiceRegistry?.findBySlug?.(voiceSlug);
          if (voiceObj?.search_value) {
            voicePayload = { slug: voiceObj.slug, search_value: voiceObj.search_value };
          }
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#action', _); }

      // Flow Character Selector — compose character payload (Flow image+video, KHÔNG gate genType)
      let characterPayload = null;
      try {
        const charSlug = document.getElementById('genCharacterSelect')?.value || '';
        if (charSlug) {
          const charObj = window.CharacterRegistry?.findBySlug?.(charSlug);
          if (charObj?.search_value) {
            characterPayload = { slug: charObj.slug, search_value: charObj.search_value };
          }
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#action', _); }

      const payload = {
        prompts: payloadPrompts,
        delayBetweenMs,
        inputTimeoutMs,  // [Fix] Truyền inputTimeout để content.js dùng cho delay calculations
        fileIds: payloadFileIds,
        fileNameMap: GenTab.fileNameCache || {},  // file_name mapping cho fallback lookup
        genType,
        aspectRatio,
        modelName,
        frameFileIds,
        refPerPrompt,
        quantity,  // Số lượng ảnh mỗi lần tạo (1-4, click x1/x2/x3/x4 trong Flow menu)
        noTileWait: isParallelMode,  // Song song: bỏ qua chờ tiles giữa các prompt
        autoDownload,  // Tự động tải xuống sau khi tạo
        downloadResolution,  // T-1: Chất lượng ảnh tải về (1k/2k)
        videoDownloadResolution,  // Chất lượng video tải về (720p/1080p)
        flowVideoDuration,  // Flow video duration (4s/6s/8s/10s) - only for video mode
        refImageMode,  // S4: 'all' | 'mention' | 'sequential' | 'none'
        mentionData: refImageMode === 'mention' ? mentionProcessed : null,  // S4: Processed mention data
        taskName: genSubFolder,  // Subfolder cho auto-download
        voice: voicePayload, // Flow Voice Selector — { slug, search_value } hoặc null
        character: characterPayload, // Flow Character Selector — { slug, search_value } hoặc null
      };

      // Log mode info (chỉ hiện khi multi-prompt ON vì single prompt luôn parallel)
      if (isMultiPromptEnabled) {
        if (isParallelMode) {
          sendLog(window.I18n?.t('gen.modeParallelLog') || 'Chế độ Song song: submit liên tục, không chờ kết quả từng prompt', 'info');
        } else {
          sendLog('Chế độ Tuần tự: chờ kết quả từng prompt trước khi submit tiếp', 'info');
        }
      }
      if (refImageMode === 'all') {
        sendLog(window.I18n?.t('gen.modeAllLog') || 'Chế độ Tất cả ảnh: dùng tất cả ảnh cho mỗi prompt', 'info');
      } else if (refImageMode === 'mention') {
        sendLog(window.I18n?.t('gen.modeMentionLog') || 'Chế độ @Mention: mỗi prompt dùng ảnh được @mention', 'info');
      } else if (refImageMode === 'sequential') {
        sendLog(window.I18n?.t('gen.modeSequentialLog') || 'Chế độ Theo Thứ Tự: mỗi prompt dùng 1 ảnh theo index', 'info');
      } else if (refImageMode === 'none') {
        sendLog(window.I18n?.t('gen.modeNoneLog') || 'Chế độ Không dùng ảnh: không dùng ảnh tham chiếu', 'info');
      }

      // sidePanel context: upload pending files TRƯỚC khi gửi đến content script
      // content.js không có access đến pendingUploadFiles Map (nằm trong sidePanel context)
      // Upload cho TẤT CẢ modes (kể cả mention) để resolve upload_xxx → real tile_id
      // MentionParser xử lý @mention riêng, nhưng pending files vẫn cần upload trước
      console.log('[GenTab] Pre-upload check: fileIds=', payload.fileIds);
      console.log('[GenTab] pendingUploadFiles keys:', window.pendingUploadFiles ? [...window.pendingUploadFiles.keys()] : 'NOT_INIT');
      console.log('[GenTab] MessageBridge:', !!window.MessageBridge, 'uploadPendingFiles:', typeof window.uploadPendingFiles);
      if (window.MessageBridge && typeof window.uploadPendingFiles === 'function') {
        const pendingIds = payload.fileIds.filter(id => id.startsWith('upload_'));
        console.log('[GenTab] pendingIds to upload:', pendingIds);
        if (pendingIds.length > 0) {
          // Thêm CSS uploading effect lên ref thumbnails đang upload (gradient sweep
          // animation). uploadPendingFiles() đi qua MessageBridge.uploadFilesToFlow trực
          // tiếp, KHÔNG qua ImmediateUploader → _uploading map không được set →
          // isUploading() return false → render không tự add class. Phải set thủ công
          // (giống pattern ref-thumb-reuploading line ~1060 cho missing files).
          for (const pid of pendingIds) {
            // Target ĐÚNG .ref-thumb — mention mode .ref-item cũng có data-ref-id, query trần
            // trả .ref-item → CSS ép width:100% → ảnh phình full-width (bug mention-only).
            const thumbEl = GenTab.fileIdThumbnails?.querySelector(`.ref-thumb[data-ref-id="${pid}"]`);
            if (thumbEl) thumbEl.classList.add('ref-thumb-uploading');
          }
          // Rename gen button label → "Đang upload ảnh..." (chỉ đổi text trong <span>,
          // KHÔNG dùng textContent trên button vì sẽ wipe SVG icon)
          const _btnLabelSpan = GenTab.startBtn?.querySelector('span') || null;
          const _savedBtnLabel = _btnLabelSpan?.textContent;
          if (_btnLabelSpan) {
            _btnLabelSpan.textContent = window.I18n?.t('gen.uploadingImages') || 'Đang upload ảnh...';
          }
          // Khoá ref-mode select khi đang upload: đổi mode lúc này → renderFileIdThumbnails
          // re-tạo DOM, mất class .ref-thumb-uploading (pre-upload không track qua ImmediateUploader
          // nên isUploading()=false → không re-apply) → user không biết ảnh nào đang upload.
          GenTab._setRefModeUploadLock(true);
          try {
            sendLog(window.I18n?.t('gen.uploadingRefImages', { count: pendingIds.length }) || `Đang upload ${pendingIds.length} ảnh tham chiếu lên Flow...`, 'info');
            const originalFileIds = [...payload.fileIds]; // Backup trước khi upload
            const uploaded = await window.uploadPendingFiles(payload.fileIds.join(', '));
            const uploadedIds = uploaded.split(',').map(s => s.trim()).filter(Boolean);

            // BUG FIX: Chỉ update UI nếu upload thành công (có ít nhất 1 real tile_id)
            // Nếu upload fail → uploadPendingFiles trả về empty hoặc chỉ có upload_xxx
            // → KHÔNG update GenTab.fileIdsInput để giữ nguyên pending IDs
            const hasRealTileId = uploadedIds.some(id => !id.startsWith('upload_'));
            if (hasRealTileId) {
              payload.fileIds = uploadedIds;
              // Cập nhật UI (renderFileIdThumbnails sẽ tự thay thế thumbnails — class
              // ref-thumb-uploading bị xóa cùng vì element được tạo lại)
              if (GenTab.fileIdsInput) {
                GenTab.fileIdsInput.value = payload.fileIds.join(', ');
                GenTab.renderFileIdThumbnails();
              }
            } else {
              // Upload fail → giữ nguyên pending IDs, báo lỗi và dừng
              sendLog(window.I18n?.t('gen.uploadRefFailed') || 'Upload ảnh tham chiếu thất bại — Flow chưa sẵn sàng hoặc upload bị lỗi', 'error');
              GenTab.startBtn.disabled = false;
              return;
            }

            // Kiểm tra upload thất bại: pending IDs bị mất (filtered out) → payload mất ref image
            const remainingPending = payload.fileIds.filter(id => id.startsWith('upload_'));
            const uploadedCount = pendingIds.length - remainingPending.length;
            const successCount = payload.fileIds.filter(id => !id.startsWith('upload_')).length;
            if (uploadedCount > 0 && successCount === 0 && payload.fileIds.length === 0) {
              // Restore original IDs vì upload failed
              payload.fileIds = originalFileIds;
              sendLog(window.I18n?.t('gen.uploadRefFailed') || 'Upload ảnh tham chiếu thất bại — không có ảnh nào được upload thành công', 'error');
              GenTab.startBtn.disabled = false;
              return;
            }
          } catch (err) {
            sendLog((window.I18n?.t('gen.uploadRefError') || 'Lỗi upload ảnh tham chiếu') + ': ' + (err.message || err), 'error');
            GenTab.startBtn.disabled = false;
            return; // Dừng submit khi upload exception
          } finally {
            // Mở khoá ref-mode select (finally chạy mọi nhánh: success/early-return/catch).
            GenTab._setRefModeUploadLock(false);
            // Cleanup uploading class trên các thumbnail còn lại (nếu render không clear hết)
            const uploadingEls = GenTab.fileIdThumbnails?.querySelectorAll('.ref-thumb-uploading');
            if (uploadingEls) uploadingEls.forEach(el => el.classList.remove('ref-thumb-uploading'));
            // Restore gen button label về như cũ (Generate / Tạo bằng ChatGPT / etc.)
            if (_btnLabelSpan && typeof _savedBtnLabel === 'string') {
              _btnLabelSpan.textContent = _savedBtnLabel;
            }
          }
        }
      }

      // Upload pending files cho video frames (tương tự ref images ở trên)
      if (window.MessageBridge && typeof window.uploadPendingFiles === 'function' && payload.frameFileIds) {
        const framePendingIds = [];
        // Collect all pending frame IDs
        if (Array.isArray(payload.frameFileIds)) {
          // Per-prompt frame pairs
          payload.frameFileIds.forEach(fp => {
            if (fp?.frame1?.startsWith('upload_')) framePendingIds.push(fp.frame1);
            if (fp?.frame2?.startsWith('upload_')) framePendingIds.push(fp.frame2);
          });
        } else {
          // Legacy single pair
          if (payload.frameFileIds.frame1?.startsWith('upload_')) framePendingIds.push(payload.frameFileIds.frame1);
          if (payload.frameFileIds.frame2?.startsWith('upload_')) framePendingIds.push(payload.frameFileIds.frame2);
        }
        const uniqueFramePending = [...new Set(framePendingIds)];
        if (uniqueFramePending.length > 0) {
          try {
            sendLog(`Đang upload ${uniqueFramePending.length} video frames lên Flow...`, 'info');
            const uploadedFrames = await window.uploadPendingFiles(uniqueFramePending.join(', '));
            const uploadedArr = uploadedFrames.split(',').map(s => s.trim()).filter(Boolean);
            // Build mapping old → new
            const frameMapping = {};
            for (let i = 0; i < uniqueFramePending.length && i < uploadedArr.length; i++) {
              if (uniqueFramePending[i] !== uploadedArr[i]) {
                frameMapping[uniqueFramePending[i]] = uploadedArr[i];
              }
            }
            // Apply mapping to payload.frameFileIds
            if (Object.keys(frameMapping).length > 0) {
              if (Array.isArray(payload.frameFileIds)) {
                payload.frameFileIds = payload.frameFileIds.map(fp => ({
                  ...fp,
                  frame1: frameMapping[fp.frame1] || fp.frame1,
                  frame2: frameMapping[fp.frame2] || fp.frame2,
                }));
              } else {
                if (frameMapping[payload.frameFileIds.frame1]) {
                  payload.frameFileIds.frame1 = frameMapping[payload.frameFileIds.frame1];
                }
                if (frameMapping[payload.frameFileIds.frame2]) {
                  payload.frameFileIds.frame2 = frameMapping[payload.frameFileIds.frame2];
                }
              }
            }
          } catch (err) {
            sendLog('Lỗi upload video frames: ' + (err.message || err), 'error');
          }
        }
      }

      // Chuyển sang pipeline PromptQueue nếu bật
      if (window.PromptQueue && PromptQueue.isEnabled()) {
        // Build refFileIds: include frame IDs for video frames mode
        let pipelineRefFileIds = payload.fileIds || [];
        let refFileIdsPerPrompt = null;
        const isVideoFrames = !!payload.frameFileIds;
        if (isVideoFrames) {
          if (Array.isArray(payload.frameFileIds)) {
            // Per-prompt frame pairs: build refFileIdsPerPrompt with 2 frames each
            const frameIds = new Set();
            payload.frameFileIds.forEach(fp => {
              if (fp?.frame1) frameIds.add(fp.frame1);
              if (fp?.frame2) frameIds.add(fp.frame2);
            });
            pipelineRefFileIds = [...frameIds];
            // Build per-prompt ref file IDs from frame pairs
            refFileIdsPerPrompt = payload.frameFileIds.map(fp => {
              const ids = [];
              if (fp?.frame1) ids.push(fp.frame1);
              if (fp?.frame2) ids.push(fp.frame2);
              return ids;
            });
          } else {
            // Legacy single pair: frame1 và frame2 là ref images for all prompts
            const frameIds = [];
            if (payload.frameFileIds.frame1) frameIds.push(payload.frameFileIds.frame1);
            if (payload.frameFileIds.frame2) frameIds.push(payload.frameFileIds.frame2);
            pipelineRefFileIds = frameIds;
          }
        }

        // Build refFileIdsPerPrompt cho sequential và mention mode
        // (chỉ khi chưa được set bởi video frames logic ở trên)
        if (!refFileIdsPerPrompt && payload.refImageMode === 'sequential' && payload.fileIds?.length > 0) {
          // Mỗi prompt dùng 1 ảnh theo index: [[fid0], [fid1], ...]
          refFileIdsPerPrompt = payload.prompts.map((_, i) => {
            const fid = payload.fileIds[i % payload.fileIds.length];
            return fid ? [fid] : [];
          });
        } else if (!refFileIdsPerPrompt && payload.refImageMode === 'mention' && payload.mentionData) {
          // Mention mode: mỗi prompt dùng ảnh từ @mention resolved data
          refFileIdsPerPrompt = payload.mentionData.map(md =>
            (md?.refImages || []).filter(ref => ref.file_id).map(ref => ref.file_id)
          );
        }

        // Build refFileNames map từ MediaRegistry/fileNameCache cho TẤT CẢ ref ids (gồm cả per-prompt frames).
        // Cần thiết cho tier2 fallback addFileToPrompt sau reload Flow — tile_id session-specific
        // bị wipe, fileName UUID Flow persistent giúp resolve tile_id MỚI qua extractFileName scan DOM.
        const _refFileNamesForJob = {};
        for (const fid of (pipelineRefFileIds || [])) {
          if (GenTab.fileNameCache?.[fid]) _refFileNamesForJob[fid] = GenTab.fileNameCache[fid];
        }
        if (Array.isArray(refFileIdsPerPrompt)) {
          for (const arr of refFileIdsPerPrompt) {
            for (const fid of (arr || [])) {
              if (GenTab.fileNameCache?.[fid] && !_refFileNamesForJob[fid]) {
                _refFileNamesForJob[fid] = GenTab.fileNameCache[fid];
              }
            }
          }
        }

        // Option C: nếu ĐANG có item chờ user nhấn Enter (manual-wait) → batch mới vào hàng đợi, chạy SAU.
        // Detect TRƯỚC submitJob (job mới chưa có WAITING_USER). Thông báo để user không tưởng gen mới chưa chạy.
        const _pqInst = window.PromptQueue?.getInstance?.();
        const _hasManualWait = !!(_pqInst?._jobs && Array.from(_pqInst._jobs.values()).some(
          j => j.isActive && j.items?.some(it => it.state === 'WAITING_USER')));

        PromptQueue.getInstance().submitJob({
          owner: 'prompts',
          label: 'Auto Gen',
          prompts: payload.prompts,
          settings: {
            genType: payload.genType,
            ratio: payload.aspectRatio,
            model: payload.modelName,
            isFrames: isVideoFrames,
            quantity: payload.quantity || 1,
            flowVideoDuration: payload.flowVideoDuration || null,
            manualSubmitMode: _manualSubmitMode,  // Manual Enter mode — user tự nhấn Enter submit
          },
          refFileIds: pipelineRefFileIds,
          refFileNames: _refFileNamesForJob,
          refImageMode: isVideoFrames ? (Array.isArray(payload.frameFileIds) ? 'sequential' : 'all') : (payload.refImageMode || 'all'),
          refFileIdsPerPrompt,
          mentionData: payload.mentionData || null,
          autoDownload: payload.autoDownload,
          // Truyền cả 2 fields riêng — PromptQueue isVideo tự chọn _videoDownloadResolution.
          // Trước smart map vào 1 field downloadResolution → PromptQueue line 659 đọc _videoDownloadResolution
          // → undefined → fallback DOM/720p → bug 1080p config nhưng download 720p.
          downloadResolution: payload.downloadResolution || null,
          videoDownloadResolution: payload.videoDownloadResolution || null,
          taskName: payload.taskName || null,  // Subfolder cho auto-download
          // Flow Voice Selector — forward voice payload từ GenTab dropdown
          voice: payload.voice || null,
          character: payload.character || null,
          // BUG FIX (2026-05-02): Pipeline mode mặc định submit rapid serial (concurrent monitoring),
          // nhưng user toggle "Tuần tự" expect per-prompt sync (đợi prompt N done trước khi
          // submit prompt N+1). Truyền sequentialMode để EditorExecutor._runLoop wait
          // active TileMonitors before dequeue next item.
          // FIX (2026-05-14): Single prompt (multi-prompt OFF) luôn dùng parallel mode.
          // Chỉ multi-prompt ON mới respect user's runMode toggle.
          sequentialMode: (() => {
            const isMultiPromptEnabled = GenTab.multiPromptCheck?.checked;
            const seq = isMultiPromptEnabled && GenTab.runMode === 'sequential';
            console.log('[GenTab] Pipeline submit: multiPrompt=', isMultiPromptEnabled, 'runMode=', GenTab.runMode, 'sequentialMode=', seq);
            return seq;
          })(),
          _executionToken, // Pass token to PromptQueue — PromptQueue handles complete/cancel
        }).then(result => {
          sendLog(`Pipeline hoàn tất: ${result.completed} thành công, ${result.failed} thất bại${result.stopped ? ' (đã dừng)' : ''}`, 'info');
          // UA-3.4: Theo doi hoan thanh generation
          window.UsageSync?.trackEvent('gen_complete', { success_count: result.completed || 0, fail_count: result.failed || 0 });
          // ExecutionGate complete/cancel đã được PromptQueue handle — không double-complete
          GenTab._currentExecutionToken = null;
          // Emit tracker completed
          if (window.eventBus) {
            window.eventBus.emit('execution:tracker_update', {
              owner: 'prompts', phase: result.failed > 0 ? 'error' : 'completed',
              current: payload.prompts?.length || 0,
              total: payload.prompts?.length || 0,
              errorCount: result.failed || 0
            });
            // Save to generation history — include result thumbnails from pipeline
            const pipelineThumbnails = result.resultThumbnails || {};
            const pipelineResultIds = result.resultTileIds || [];
            const historyThumbs = Object.values(pipelineThumbnails);
            window.eventBus.emit('prompt:completed', {
              prompt: payload.prompts?.join('\n\n') || '',
              media_type: payload.genType || 'image',
              model: payload.modelName || '',
              ratio: payload.aspectRatio || '',
              // Phase Analytics-3: Pipeline batch path — N prompt × quantity ảnh/prompt
              prompt_count: payload.prompts?.length || 1,
              quantity: parseInt(payload.quantity) || 1,
              ref_file_ids: (payload.fileIds || []).join(', '),
              result_file_ids: pipelineResultIds.join(', '),
              result_thumbnails: historyThumbs.length > 0 ? historyThumbs : [],
              result_file_names: Object.fromEntries(
                Object.entries(pipelineThumbnails).filter(([, v]) => v?.file_name).map(([k, v]) => [k, v.file_name])
              ),
              source: 'gen',
              submit_mode: _manualSubmitMode ? 'manual' : 'auto', // Phân biệt nguồn gen (admin)
              provider: 'flow', // SS-Phase G: pipeline GenTab path luôn là Flow
              // Track fail theo SỐ ẢNH THỰC TẾ (không chỉ result.failed — pipeline có thể báo failed=0
              // nhưng ra 0 tile → không thể coi là "thành công"):
              //   0 ảnh → failed | có ảnh + có prompt fail → partial | có ảnh, không fail → success.
              status: (pipelineResultIds.length === 0 && historyThumbs.length === 0)
                ? 'failed'
                : (result.failed > 0 ? 'partial' : 'success'),
              error_reason: (pipelineResultIds.length === 0 && historyThumbs.length === 0)
                ? (result.reason || 'Không tạo được ảnh/video nào')
                : (result.failed > 0 ? (result.reason || `${result.failed} prompt thất bại`) : null),
              project_id: window._currentProjectId || null,
              auto_download: !!payload.autoDownload
            });
            // Emit generation:complete for NotificationManager
            window.eventBus.emit('generation:complete', {
              message: result.failed > 0
                ? (window.I18n?.t?.('notification.browser.generationCompleteMediaFailed', { completed: result.completed || 0, failed: result.failed }) || `Hoàn tất ${result.completed} ảnh/video, ${result.failed} thất bại`)
                : (window.I18n?.t?.('notification.browser.generationCompleteMedia', { completed: result.completed || 0 }) || `Hoàn tất ${result.completed} ảnh/video`),
              prompt: payload.prompts?.[0] || '',
              resultCount: result.completed || 0,
              failedCount: result.failed || 0
            });
          }

          // Show failed prompts modal nếu có lỗi (Pipeline mode)
          if (result.failedPrompts && result.failedPrompts.length > 0) {
            GenTab._showFailedPrompts(result.failedPrompts);
            GenTab._showFailedPromptsSummaryModal(
              result.failedPrompts,
              payload.prompts?.length || result.failedPrompts.length,
              result.completed || 0
            );
          }

          // Chỉ reset running controls khi không còn active prompts jobs trong pipeline
          const remainingJobs = PromptQueue.getInstance().getJobsByOwner('prompts');
          if (remainingJobs.length === 0) {
            GenTab._resetRunningControls();
          }
        }).catch(err => {
          sendLog('Pipeline lỗi: ' + (err.message || err), 'error');
          GenTab._currentExecutionToken = null;
          if (window.eventBus) {
            window.eventBus.emit('execution:tracker_update', {
              owner: 'prompts', phase: 'error'
            });
            // Ghi record FAIL lên admin/generations — trước đây hard error (reCAPTCHA 403, DOM,
            // abort, network) rơi vào .catch → KHÔNG emit prompt:completed → fail không lên admin.
            window.eventBus.emit('prompt:completed', {
              prompt: payload.prompts?.join('\n\n') || '',
              media_type: payload.genType || 'image',
              model: payload.modelName || '',
              ratio: payload.aspectRatio || '',
              prompt_count: payload.prompts?.length || 1,
              quantity: parseInt(payload.quantity) || 1,
              ref_file_ids: (payload.fileIds || []).join(', '),
              result_file_ids: '',
              source: 'gen',
              submit_mode: _manualSubmitMode ? 'manual' : 'auto', // Phân biệt nguồn gen (admin)
              provider: 'flow',
              status: 'failed',
              error_reason: String(err?.message || err || 'Pipeline error').slice(0, 1000),
              project_id: window._currentProjectId || null,
              auto_download: !!payload.autoDownload
            });
          }
          const remainingJobs = PromptQueue.getInstance().getJobsByOwner('prompts');
          if (remainingJobs.length === 0) {
            GenTab._resetRunningControls();
          }
        });

        // Pipeline mode: re-enable startBtn ngay — user có thể queue thêm jobs
        GenTab.startBtn.disabled = false;

        // Option C: đang chờ user nhấn Enter (manual) mà thêm batch → toast rõ batch mới vào hàng đợi.
        if (_hasManualWait) {
          const _n = payload.prompts?.length || 1;
          window.showNotification?.(
            (window.I18n?.t?.('gen.addedToQueueManual', { count: _n }))
              || `Đã thêm ${_n} prompt vào hàng đợi — sẽ chạy sau khi bạn nhấn Enter cho prompt hiện tại.`,
            'info', 4500
          );
        }
        // Kết thúc sớm — pipeline xử lý phần còn lại
        return;
      }
      // Fallback: dùng MessageBridge hoặc runAutoPrompt trực tiếp (hành vi cũ)
      else if (window.MessageBridge) {
        window.MessageBridge.runAutoPrompt(payload).then(result => {
          if (result?.blocked) {
            sendLog('Google Flow đang bận xử lý. Hãy thử dừng và chạy lại.', 'warn');
            // Show modal hướng dẫn bật Pipeline Queue
            if (window.customDialog) {
              const crowIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;margin-right:4px;color:#a855f7;"><path d="M16 7h.01"/><path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20"/><path d="m20 7 2 .5-2 .5"/><path d="M10 18v3"/><path d="M14 17.75V21"/><path d="M7 18a6 6 0 0 0 3.84-10.61"/></svg>`;
              window.customDialog.alert(
                `<div style="line-height:1.6">${window.I18n?.t('gen.pipelineQueueHint', { icon: crowIcon }) || `Hãy bật mode <strong>${crowIcon}Pipeline Queue</strong> để chạy nhiều tác vụ cùng lúc.<br><br><span style="color:var(--muted-foreground);font-size:0.9em;">Hướng dẫn: Cài đặt → Nâng cao → Pipeline Queue</span>`}</div>`,
                {
                  title: window.I18n?.t('msg.flowBusy') || 'Google Flow đang bận',
                  type: 'info',
                  html: true,
                  buttons: [
                    { label: window.I18n?.t('common.close') || 'Đóng', primary: false, action: () => {} },
                    {
                      label: window.I18n?.t('header.settings') || 'Cài đặt',
                      primary: true,
                      action: () => {
                        chrome.runtime.sendMessage({ action: 'openSettings' });
                      }
                    }
                  ]
                }
              );
            }
          }
          // SP-2.3: ExecutionGate complete
          if (window.ExecutionGate && _executionToken) {
            ExecutionGate.complete(_executionToken, 'success');
            GenTab._currentExecutionToken = null;
          }
          // Track usage: gen_run_max (Flow) + prompt_submit_max
          const flowPromptCount = payload.prompts?.length || 0;
          if (flowPromptCount > 0 && window.featureGate) {
            window.featureGate.recordGenRun();
            window.featureGate.recordPromptSubmit(flowPromptCount, 'flow');
          }
          // UA-3.4: Theo doi hoan thanh generation (legacy mode)
          window.UsageSync?.trackEvent('gen_complete', { success_count: payload.prompts?.length || 0, fail_count: 0 });
          // SS-Phase F: flow_prompt_total tracking moved to content.js:5564 (per-prompt in loop).
          // REMOVED legacy batch tracking here to prevent DOUBLE COUNTING bug:
          // content.js đã track mỗi prompt submit → không cần track lại ở callback.
          // Emit tracker completed
          if (window.eventBus) {
            window.eventBus.emit('execution:tracker_update', {
              owner: 'prompts', phase: 'completed',
              current: payload.prompts?.length || 0,
              total: payload.prompts?.length || 0
            });
            // Save to generation history — build thumbnails from cache for legacy mode
            const legacyResultIds = result?.resultTileIds || [];
            const legacyThumbs = legacyResultIds.map(tid => ({
              thumbnail: GenTab.thumbnailCache?.[tid] || '',
              type: (payload.genType || 'image').toLowerCase() === 'video' ? 'video' : 'image',
              file_name: GenTab.fileNameCache?.[tid] || ''
            })).filter(t => t.thumbnail);
            window.eventBus.emit('prompt:completed', {
              prompt: payload.prompts?.join('\n\n') || '',
              media_type: payload.genType || 'image',
              model: payload.modelName || '',
              ratio: payload.aspectRatio || '',
              // Phase Analytics-3: Legacy Flow batch — N prompt × quantity
              prompt_count: payload.prompts?.length || 1,
              quantity: parseInt(payload.quantity) || 1,
              ref_file_ids: (payload.fileIds || []).join(', '),
              result_file_ids: legacyResultIds.join(', '),
              result_thumbnails: legacyThumbs,
              result_file_names: Object.fromEntries(
                legacyResultIds.filter(tid => GenTab.fileNameCache?.[tid]).map(tid => [tid, GenTab.fileNameCache[tid]])
              ),
              source: 'gen',
              submit_mode: 'auto', // Legacy runAutoPrompt luôn auto-submit (manual mode chỉ chạy qua pipeline)
              provider: 'flow', // SS-Phase G: legacy GenTab Flow path
              project_id: window._currentProjectId || null,
              auto_download: !!payload.autoDownload
            });
            // Emit generation:complete for NotificationManager
            const _promptCount = payload.prompts?.length || 0;
            window.eventBus.emit('generation:complete', {
              message: window.I18n?.t?.('notification.browser.generationCompletePrompts', { count: _promptCount }) || `Hoàn tất ${_promptCount} prompt(s)`,
              prompt: payload.prompts?.[0] || '',
              resultCount: legacyResultIds.length || _promptCount
            });
          }
          // Restore buttons khi hoàn tất
          GenTab._resetRunningControls();
          if (window.ExecutionLock) ExecutionLock.release('prompts');
        }).catch(err => {
          sendLog('Lỗi kết nối content script: ' + (err.message || err), 'error');
          // SP-2.3: ExecutionGate complete (failed)
          if (window.ExecutionGate && _executionToken) {
            ExecutionGate.complete(_executionToken, 'failed', { error: err.message || String(err) });
            GenTab._currentExecutionToken = null;
          }
          // Emit tracker error
          if (window.eventBus) {
            window.eventBus.emit('execution:tracker_update', {
              owner: 'prompts', phase: 'error'
            });
          }
          GenTab._resetRunningControls();
          if (window.ExecutionLock) ExecutionLock.release('prompts');
        });
      } else if (typeof runAutoPrompt === 'function') {
        // content script context (fallback)
        runAutoPrompt(payload);
      } else {
        sendLog('Không thể kết nối đến Google Flow. Hãy mở labs.google/fx trước.', 'error');
        // SP-2.3: ExecutionGate cancel (no connection)
        if (window.ExecutionGate && _executionToken) {
          ExecutionGate.cancel(_executionToken);
          GenTab._currentExecutionToken = null;
        }
        GenTab._resetRunningControls();
        if (window.ExecutionLock) ExecutionLock.release('prompts');
      }
    });

    // ─── Upload to Flow ───────────────────────────────────
    if (document.getElementById('triggerUploadBtn')) {
      document.getElementById('triggerUploadBtn').addEventListener('click', () => {
        document.getElementById('imageUploadInput').click();
      });
    }

    if (document.getElementById('imageUploadInput')) {
      document.getElementById('imageUploadInput').addEventListener('change', async (e) => {
        // Append newly selected files, loại bỏ file trùng tên (tránh preview lặp)
        const newFiles = Array.from(e.target.files);
        const existingNames = new Set(GenTab.selectedFilesForUpload.map(f => f.name));
        const uniqueNewFiles = newFiles.filter(f => !existingNames.has(f.name));
        GenTab.selectedFilesForUpload = [...GenTab.selectedFilesForUpload, ...uniqueNewFiles];
        e.target.value = ''; // Reset input to allow re-selecting the same file

        GenTab.renderUploadPreview();
      });
    }

    if (document.getElementById('executeUploadBtn')) {
      document.getElementById('executeUploadBtn').addEventListener('click', async () => {
        if (GenTab.selectedFilesForUpload.length === 0) return;
        const previewContainer = document.getElementById('imagePreviewContainer');
        if (previewContainer) previewContainer.classList.add('uploading');
        const newIds = await GenTab.performFlowImageUpload(GenTab.selectedFilesForUpload, document.getElementById('executeUploadBtn'));
        if (previewContainer) previewContainer.classList.remove('uploading');
        if (newIds && newIds.length > 0) {
          const currentIds = GenTab.fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
          const merged = [...currentIds, ...newIds];
          if (GenTab.fileIdsInput) GenTab.fileIdsInput.value = merged.join(', ');
          GenTab.saveState();

          // Reset input
          const uploadInput = document.getElementById('imageUploadInput');
          if (uploadInput) uploadInput.value = '';
          GenTab.selectedFilesForUpload = [];
          GenTab.renderUploadPreview();
        }
      });
    }

    // ─── stopBtn handler ──────────────────────────────────
    if (GenTab.stopBtn) GenTab.stopBtn.addEventListener('click', () => {
      shouldStop = true;
      const isPipelineStop = window.PromptQueue && PromptQueue.isEnabled();
      // SP-2.8: ExecutionGate cancel on stop
      // Pipeline mode: PromptQueue.stopJob() sẽ cancel token — không double-cancel
      if (!isPipelineStop && window.ExecutionGate && GenTab._currentExecutionToken) {
        ExecutionGate.cancel(GenTab._currentExecutionToken);
      }
      GenTab._currentExecutionToken = null;
      // Pipeline mode: stop active jobs qua PromptQueue
      if (isPipelineStop) {
        const activeJobs = PromptQueue.getInstance().getJobsByOwner('prompts');
        for (const job of activeJobs) {
          PromptQueue.getInstance().stopJob(job.id);
        }
      }
      // Legacy mode: stop qua MessageBridge
      if (window.MessageBridge) {
        window.MessageBridge.stopExecution().catch(function (_e) { globalThis.SEOSONA_swallow?.('GenTab#action', _e); });
      }
      // Emit tracker completed (stopped)
      if (window.eventBus) {
        window.eventBus.emit('execution:tracker_update', {
          owner: 'prompts', phase: 'completed'
        });
      }
      GenTab._resetRunningControls();
      // Legacy mode only: release lock (pipeline mode không acquire lock)
      if (!isPipelineStop && window.ExecutionLock) ExecutionLock.release('prompts');
    });

    // ─── pauseBtn handler ─────────────────────────────────
    if (GenTab.pauseBtn) GenTab.pauseBtn.addEventListener('click', () => {
      const isPausedNow = GenTab.pauseBtn.dataset.paused === 'true';
      if (isPausedNow) {
        // Resume
        isPaused = false;
        // Pipeline mode: resume qua PromptQueue
        if (window.PromptQueue && PromptQueue.isEnabled()) {
          const activeJobs = PromptQueue.getInstance().getJobsByOwner('prompts');
          for (const job of activeJobs) {
            PromptQueue.getInstance().resumeJob(job.id);
          }
        }
        // Legacy mode: resume qua MessageBridge
        if (typeof MessageBridge !== 'undefined') MessageBridge.resumeExecution().catch(function (_e) { globalThis.SEOSONA_swallow?.('GenTab#action', _e); });
        GenTab.pauseBtn.classList.remove('paused');
        GenTab.pauseBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>`;
        GenTab.pauseBtn.title = window.I18n?.t('genNotifyExtra.pauseTitle') || 'Tạm dừng';
        GenTab.pauseBtn.dataset.paused = 'false';
        // Emit tracker resume
        if (window.eventBus) {
          window.eventBus.emit('execution:tracker_update', { owner: 'prompts', phase: 'prompt_submitting' });
        }
      } else {
        // Pause
        isPaused = true;
        // Pipeline mode: pause qua PromptQueue
        if (window.PromptQueue && PromptQueue.isEnabled()) {
          const activeJobs = PromptQueue.getInstance().getJobsByOwner('prompts');
          for (const job of activeJobs) {
            PromptQueue.getInstance().pauseJob(job.id);
          }
        }
        // Legacy mode: pause qua MessageBridge
        if (typeof MessageBridge !== 'undefined') MessageBridge.pauseExecution().catch(function (_e) { globalThis.SEOSONA_swallow?.('GenTab#action', _e); });
        GenTab.pauseBtn.classList.add('paused');
        GenTab.pauseBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>`;
        GenTab.pauseBtn.title = window.I18n?.t('genNotifyExtra.resumeTitle') || 'Tiếp tục';
        GenTab.pauseBtn.dataset.paused = 'true';
        // Emit tracker paused
        if (window.eventBus) {
          window.eventBus.emit('execution:tracker_update', { owner: 'prompts', phase: 'paused' });
        }
      }
    });

    // ─── Failed prompts panel ──────────────────────────────
    const clearFailedBtn = document.getElementById('clearFailedPromptsBtn');
    if (clearFailedBtn) {
      clearFailedBtn.addEventListener('click', () => {
        GenTab._clearFailedPrompts();
      });
    }

    const retryFailedBtn = document.getElementById('retryFailedPromptsBtn');
    if (retryFailedBtn) {
      retryFailedBtn.addEventListener('click', () => {
        GenTab._retryFailedPrompts();
      });
    }

    // Listen for execution progress and completion
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'promptProgress') {
        // Emit tracker progress (FloatingTracker on Flow page handles display)
        if (window.eventBus) {
          window.eventBus.emit('execution:tracker_update', {
            owner: 'prompts',
            label: 'Auto Gen',
            phase: 'prompt_submitting',
            current: msg.current,
            total: msg.total
          });
        }
        // Re-enable gen button khi đã submit hết tất cả prompts (CHỈ Flow path).
        // SKIP nếu ChatGPT/Grok đang submit — promptProgress từ content.js (Flow) có thể fire
        // do stale Flow execution không liên quan, sẽ enable button mid-gen của ChatGPT/Grok.
        if (msg.current >= msg.total && !GenTab._providerSubmitRunning) {
          GenTab._resetRunningControls();
        }
      }
      if (msg.action === 'promptExecutionComplete') {
        // Emit tracker completed
        if (window.eventBus) {
          window.eventBus.emit('execution:tracker_update', {
            owner: 'prompts',
            phase: msg.failedCount > 0 ? 'error' : 'completed',
            current: msg.completedCount || 0,
            total: msg.totalCount || 0,
            errorCount: msg.failedCount || 0
          });
        }
        // Reset buttons (SKIP nếu ChatGPT/Grok đang submit — Flow message từ content.js)
        if (!GenTab._providerSubmitRunning) {
          GenTab._resetRunningControls();
        }

        // Show failed prompts if any
        if (msg.failedPrompts && msg.failedPrompts.length > 0) {
          GenTab._showFailedPrompts(msg.failedPrompts);
          // Show summary modal với option retry
          GenTab._showFailedPromptsSummaryModal(
            msg.failedPrompts,
            msg.totalCount || msg.failedPrompts.length,
            msg.completedCount || 0
          );
        }
      }
    });

    // ─── Expose globals ───────────────────────────────────
    window.performFlowImageUpload = GenTab.performFlowImageUpload;
    window.renderFileIdThumbnails = GenTab.renderFileIdThumbnails;

    // CG-5: Khởi tạo provider selector (Flow / ChatGPT)
    try {
      GenTab._initProviderSelector();
    } catch (err) {
      console.warn('[GenTab] _initProviderSelector failed:', err);
    }

    console.log('[SEOSONA Flow] GenTab initialized');
  }

  // ============================================================
  // CG-5: ChatGPT Provider Integration
  // ============================================================

  /**
   * CG-5.1 + CG-5.2: Khởi tạo provider selector (Flow / ChatGPT).
   * - Bind change event trên #genProvider
   * - Restore provider từ StorageSettings.defaultProvider
   * - Emit event 'provider:changed' qua eventBus
   * - Trigger _renderByProvider để toggle UI
   */
  static _initProviderSelector() {
    // Provider selector dạng tab pill (CG-5 redesign): 2 button + hidden input #genProvider
    const tabsRoot = document.getElementById('genProviderTabs');
    const sel = document.getElementById('genProvider');
    if (!sel || !tabsRoot) return;

    GenTab.providerSelect = sel;
    GenTab.providerTabs = tabsRoot;

    const setActive = (providerKey) => {
      sel.value = providerKey;
      const tabs = tabsRoot.querySelectorAll('.provider-tab');
      let activeCount = 0;
      tabs.forEach((btn) => {
        const isActive = btn.dataset.provider === providerKey;
        btn.classList.toggle('provider-tab--active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        if (isActive) activeCount++;
      });
      // Bug fix 2026-05-22: Force browser repaint khi extension UI không focus.
      // Chrome defer paint cho backgrounded contexts (sidePanel/popup khi user nhìn tab khác).
      // → setActive set class nhưng visual không update cho đến khi user focus UI.
      // Workaround: force reflow + RAF để schedule paint ngay.
      void tabsRoot.offsetHeight;
      requestAnimationFrame(() => { void tabsRoot.offsetHeight; });
      // 2026-05-25: DEBUG_SET_ACTIVE log gate behind window.DEBUG (mặc định off production)
      if (window.DEBUG) {
        console.log(`[DEBUG_SET_ACTIVE] setActive('${providerKey}') → sel.value=${sel.value}, tabs found=${tabs.length}, active count=${activeCount}, active provider=${[...tabs].find(t => t.classList.contains('provider-tab--active'))?.dataset?.provider}`);
      }
    };

    // Restore từ af_settings.defaultProvider; fallback 'flow' nếu adapter chưa có
    chrome.storage.local.get(['af_settings'], (res) => {
      const settings = res.af_settings || {};
      let initial = settings.defaultProvider || 'flow';
      // 2026-05-25: DEBUG_DEFAULT_PROVIDER log gate behind window.DEBUG
      if (window.DEBUG) console.log('[DEBUG_DEFAULT_PROVIDER] storage.defaultProvider =', settings.defaultProvider, '→ initial =', initial);
      try {
        if (window.ProviderRegistry && typeof ProviderRegistry.get === 'function') {
          const adapterExists = !!ProviderRegistry.get(initial);
          if (window.DEBUG) console.log('[DEBUG_DEFAULT_PROVIDER] ProviderRegistry.get("' + initial + '") =', adapterExists ? 'OK' : 'MISSING');
          if (!adapterExists) initial = 'flow';
        } else if (window.DEBUG) {
          console.warn('[DEBUG_DEFAULT_PROVIDER] ProviderRegistry not loaded yet → keep initial =', initial);
        }
      } catch (e) {
        if (window.DEBUG) console.warn('[DEBUG_DEFAULT_PROVIDER] ProviderRegistry check throw:', e?.message);
        initial = 'flow';
      }

      // [FIX 2026-07-09] Validate initial provider CÓ pill thật trong DOM. ProviderRegistry.get()
      // trả Flow-fallback cho key lạ → không bắt được gemini/claude. Gemini/Claude đã gỡ khỏi tab
      // Gen (text-only) → nếu defaultProvider cũ = gemini/claude → fallback flow, tránh kẹt (không
      // pill active + submit rơi xuống Flow âm thầm).
      try {
        const domProviders = Array.from(document.querySelectorAll('#genProviderTabs .provider-tab[data-provider]')).map(b => b.dataset.provider);
        if (domProviders.length && !domProviders.includes(initial)) {
          if (window.DEBUG) console.log('[GenTab] initial provider "' + initial + '" không có pill → fallback flow');
          initial = 'flow';
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#setActive', _); }

      // Check if initial provider is locked, auto-switch to an unlocked one
      const initialGate = GenTab._resolveProviderGate(initial, 'gen');
      if (window.DEBUG) console.log('[DEBUG_DEFAULT_PROVIDER] gate(' + initial + ') =', initialGate);
      if (initialGate?.locked && initialGate.reason === 'feature') {
        // Try to find an unlocked provider. Source of truth: DOM provider tabs.
        const providers = Array.from(document.querySelectorAll('#genProviderTabs .provider-tab[data-provider]'))
          .map((btn) => btn.dataset.provider)
          .filter(Boolean);
        let foundUnlocked = null;
        for (const p of providers) {
          const gate = GenTab._resolveProviderGate(p, 'gen');
          if (!gate?.locked || gate.reason !== 'feature') {
            foundUnlocked = p;
            break;
          }
        }
        if (foundUnlocked && foundUnlocked !== initial) {
          console.log(`[GenTab] Initial provider "${initial}" is locked, switching to "${foundUnlocked}"`);
          initial = foundUnlocked;
        }
      }

      // Restore Grok video field defaults từ af_settings (form-level, độc lập với provider)
      const grokDurEl = document.getElementById('grokDuration');
      if (grokDurEl && settings.grokDefaultDuration) grokDurEl.value = settings.grokDefaultDuration;
      const grokResEl = document.getElementById('grokResolution');
      if (grokResEl && settings.grokDefaultResolution) grokResEl.value = settings.grokDefaultResolution;
      // Restore Grok image quality default (Speed/Quality)
      const grokQualEl = document.getElementById('grokImageQuality');
      if (grokQualEl && settings.grokDefaultImageQuality) grokQualEl.value = settings.grokDefaultImageQuality;
      if (window.DEBUG) console.log('[DEBUG_DEFAULT_PROVIDER] FINAL active provider →', initial);
      setActive(initial);
      GenTab._renderByProvider(initial);
      // Update run mode button visibility based on initial provider
      GenTab._updateRunModeVisibility();
      // Bug fix 2026-05-22: Auto-check duplicate tabs cho current provider sau khi sidebar load.
      // Silent toast mode (interactive=false) tránh modal block init UX. Modal interactive
      // sẽ fire khi user click switch tab / execute (qua _ensureProviderTab + WorkflowExecutor).
      setTimeout(() => GenTab._checkDuplicateProviderTabs(initial, { interactive: false }), 1000);

      // Bug fix 2026-05-22: GenTab init chạy TRƯỚC FeatureGate init + TRƯỚC StorageSettings load server
      // → ChatGPT/Grok bị mặc định "locked" (fg.canUse undefined) → auto-switch về Flow.
      // → af_settings.defaultProvider có thể là 'flow' (defaults) chưa merged server data.
      // Re-eval CHỈ chạy 1 lần đầu tiên gate unlock (init-mode). Sau đó stop để KHÔNG override user click.
      // Bug fix 2026-05-22: trước đây re-eval fire mỗi `featuregate:refreshed` (window-focus) → force user
      // về defaultProvider dù user đã click Flow → annoying.
      if (!GenTab._providerReEvalBound) {
        GenTab._providerReEvalBound = true;
        GenTab._providerReEvalDone = false; // đặt true sau lần re-eval đầu (1 lần duy nhất)
        const reEvalProvider = (triggerName) => {
          if (GenTab._providerReEvalDone) return; // user đã interact hoặc re-eval xong → skip
          chrome.storage.local.get(['af_settings'], (res2) => {
            const desired = res2.af_settings?.defaultProvider;
            const current = sel.value;
            if (!desired || desired === current) {
              GenTab._providerReEvalDone = true; // settings match → init mode kết thúc
              return;
            }
            const gate = GenTab._resolveProviderGate(desired, 'gen');
            if (gate?.locked) return; // vẫn locked → giữ current, đợi gate unlock
            console.log(`[GenTab] Provider re-eval (${triggerName}): ${current} → ${desired}`);
            setActive(desired);
            GenTab._renderByProvider(desired);
            GenTab._updateRunModeVisibility();
            GenTab._providerReEvalDone = true; // đã re-eval thành công → init mode kết thúc
          });
        };
        window.eventBus?.on?.('featuregate:refreshed', () => reEvalProvider('featuregate:refreshed'));
        window.eventBus?.on?.('storageSettings:loaded', () => reEvalProvider('storageSettings:loaded'));

        // Bug fix 2026-05-23: User explicit save Settings → defaultProvider phải override
        // GenTab tab ngay (KHÔNG bị block bởi _providerReEvalDone flag từ window-focus re-eval).
        // chrome.storage.onChanged fire khi af_settings update từ settings window.
        try {
          chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes.af_settings) return;
            const oldVal = changes.af_settings.oldValue?.defaultProvider;
            const newVal = changes.af_settings.newValue?.defaultProvider;
            if (!newVal || newVal === oldVal) return; // defaultProvider không đổi → skip
            if (newVal === sel.value) return; // đã đúng → skip
            const gate = GenTab._resolveProviderGate(newVal, 'gen');
            if (gate?.locked) {
              console.log(`[GenTab] User save defaultProvider=${newVal} nhưng đang locked → skip switch`);
              return;
            }
            console.log(`[GenTab] User save defaultProvider: ${sel.value} → ${newVal} (force switch)`);
            setActive(newVal);
            GenTab._renderByProvider(newVal);
            GenTab._updateRunModeVisibility();
            // KHÔNG reset _providerReEvalDone — flag chỉ kiểm soát init re-eval window-focus.
          });
        } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _); }
      }
    });

    // Click handler cho mỗi tab pill
    tabsRoot.querySelectorAll('.provider-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const providerKey = btn.dataset.provider || 'flow';

        // SS-Phase E: Unified gate intercept dùng _resolveProviderGate.
        // Cover cả 2 trường hợp lock:
        //   - reason='feature' (chatgpt_enabled/grok_enabled): logged-in → upgrade, anonymous → login
        //   - reason='quota' (gen_run_max/chatgpt_run_max/grok_run_max hết): luôn open upgrade
        //     (vì user có thể logged-in OR anonymous đều cần nâng cấp/đăng ký để tăng quota)
        const gate = GenTab._resolveProviderGate(providerKey, 'gen');
        if (gate.locked) {
          if (gate.reason === 'feature') {
            try { window.featureGate?.showLoginPrompt?.(gate.tooltip); } catch (_e) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _e); }
          } else if (gate.reason === 'quota') {
            // Quota exhausted → show login/upgrade prompt (fallback path).
            if (window.featureGate?.showLoginPrompt) {
              try { window.featureGate.showLoginPrompt(gate.tooltip); } catch (_e) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _e); }
            }
          }
          return; // KHÔNG switch provider
        }

        if (sel.value === providerKey) return;  // không đổi → skip

        // Bug fix 2026-05-22: user chủ động click tab → khoá auto re-eval để KHÔNG override sau này.
        GenTab._providerReEvalDone = true;

        // G-4.4: Lưu ratio hiện tại vào settings của provider TRƯỚC khi đổi
        // - Flow: aspectRatio
        // - ChatGPT: chatgptDefaultRatio
        // - Grok: grokDefaultRatio
        const currentProvider = sel.value;
        const currentRatio = GenTab.aspectRatioSelect?.value;
        if (currentRatio) {
          chrome.storage.local.get(['af_settings'], (res) => {
            const settings = res.af_settings || {};
            if (currentProvider === 'chatgpt') {
              settings.chatgptDefaultRatio = currentRatio;
            } else if (currentProvider === 'grok') {
              settings.grokDefaultRatio = currentRatio;
            } else {
              settings.aspectRatio = currentRatio;
            }
            chrome.storage.local.set({ af_settings: settings });
          });
        }

        setActive(providerKey);
        if (window.eventBus) {
          window.eventBus.emit('provider:changed', { provider: providerKey });
        }
        GenTab._renderByProvider(providerKey);
        // Update run mode button visibility (hide for ChatGPT/Grok)
        GenTab._updateRunModeVisibility();

        // Post-audit fix: re-render ref thumbnails để update ref-thumb-exceeded grayscale
        // theo provider mới (Flow 10/3 vs ChatGPT/Grok 4). Trước fix: switch provider
        // không refresh → 5 ref images ChatGPT vẫn không grayscale (vì render với Flow's limit cũ).
        try { GenTab.renderFileIdThumbnails(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _); }

        // G: Auto-open provider tab URL nếu chưa mở (fire-and-forget — không block UI).
        // ChatGPT → chatgpt.com, Grok → grok.com. activate=false để không steal focus
        // sidePanel; user thấy tab mở ngầm và sẵn sàng cho submit.
        GenTab._ensureProviderTab(providerKey);
      });
    });

    // CG-5 polish: Refresh feature gate state on init + subscribe events
    GenTab._refreshProviderPillsGate();
    if (window.eventBus && !GenTab._providerGateBound) {
      GenTab._providerGateBound = true;
      window.eventBus.on('featuregate:refreshed', () => GenTab._refreshProviderPillsGate());
      window.eventBus.on('auth:login', () => GenTab._refreshProviderPillsGate());
      window.eventBus.on('auth:logout', () => GenTab._refreshProviderPillsGate());
      // SS-Phase E: Refresh khi quota usage thay đổi (sau prompt:completed / quota:warning / exhausted)
      window.eventBus.on('prompt:completed', () => GenTab._refreshProviderPillsGate());
      window.eventBus.on('featuregate:quota_warning', () => GenTab._refreshProviderPillsGate());
      window.eventBus.on('featuregate:quota_exhausted', () => GenTab._refreshProviderPillsGate());
      // i18n change: re-render submit button label (gen.generate*) + ref count text
      // (gen.refCountZero/Images/Max). Các text này set explicit qua textContent, không
      // tự động update qua data-i18n attribute.
      window.eventBus.on('i18n:changed', () => {
        const currentProvider = document.getElementById('genProvider')?.value || 'flow';
        try { GenTab._renderByProvider(currentProvider); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _); }
        try { GenTab.renderFileIdThumbnails(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _); }
      });
      // Admin update ratios / download_resolutions / max_ref_images / quantity_range qua /admin/providers → re-render
      window.eventBus.on('provider:api_config_updated', ({ provider, key }) => {
        try {
          // max_ref_images: re-render thumbnails để update ref-thumb-exceeded (mọi provider)
          if (key === 'max_ref_images') {
            GenTab.renderFileIdThumbnails();
            return;
          }
          // Chỉ re-render provider ĐANG chọn — tránh update config provider khác ghi đè UI hiện tại
          // (bug: grok SSE update → ghi đè ratio/duration của flow, và ngược lại).
          const current = document.getElementById('genProvider')?.value || 'flow';
          if (provider !== current) return;
          if (provider === 'flow') {
            if (key === 'ratios') GenTab.updateRatioOptions();
            else if (key === 'download_resolutions') GenTab.updateDownloadResolutionOptions();
            else if (key === 'quantity_range') GenTab.updateQuantityOptions();
            else if (key === 'video_durations') GenTab.updateFlowVideoDurationOptions();
          } else {
            // Grok/ChatGPT/Gemini: adapter._capabilitiesCache invalidate qua adapter listener (cùng
            // event). defer 1 tick để chắc invalidation (sync listener) chạy xong → caps fresh.
            setTimeout(() => {
              try {
                // Re-check: user có thể đã switch provider trong tick → tránh render provider cũ đè lên.
                if ((document.getElementById('genProvider')?.value || 'flow') !== current) return;
                GenTab._renderByProvider(current);
                if (current === 'grok') GenTab.updateGrokVideoDurationOptions();
              } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _); }
            }, 0);
          }
        } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _); }
      });
      // Bug 31 fix: Admin add/remove/rename model qua /admin/provider-models → re-render
      window.eventBus.on('provider:models_updated', () => {
        try { GenTab.updateModelOptions(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _); }
        // Re-apply picker visibility — lúc init ModelRegistry chưa load → supports_* false → ẩn;
        // khi models về phải re-check (đặc biệt character hiện ở image mode mặc định).
        try { GenTab._applyVoicePickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _); }
        try { GenTab._applyCharacterPickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _); }
      });

      // Fix (2026-05-14): Re-render khi PCM initial fetch xong (ratios, download_resolutions, quantity_range)
      // Trước fix: GenTab.init() chạy trước khi PCM fetch xong → render với _DEFAULTS
      window.eventBus.on('provider:api_configs_loaded', () => {
        try {
          // Re-render provider ĐANG chọn (không flow-hardcoded — bug: khi ở grok, full refetch
          // (_updateFromVersion emit event này) ghi đè ratio/duration grok bằng flow).
          const current = document.getElementById('genProvider')?.value || 'flow';
          if (current === 'flow') {
            GenTab.updateRatioOptions();
            GenTab.updateDownloadResolutionOptions();
            GenTab.updateQuantityOptions();
            GenTab.updateFlowVideoDurationOptions();
          } else {
            // defer 1 tick: adapter._capabilitiesCache invalidate (sync listener cùng event) chạy
            // trước → _renderByProvider đọc caps fresh (ratio pills không stale).
            setTimeout(() => {
              try {
                if ((document.getElementById('genProvider')?.value || 'flow') !== current) return;
                GenTab._renderByProvider(current);
                if (current === 'grok') GenTab.updateGrokVideoDurationOptions();
              } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _); }
            }, 0);
          }
        } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _); }
      });

      // Per-prompt success notification cho Flow (từ PromptQueue)
      window.eventBus.on('prompt:single_completed', ({ index, total, provider }) => {
        if (provider === 'flow' && typeof sendLog === 'function') {
          sendLog(`Flow prompt ${index}/${total} ✓`, 'success');
        }
      });

      // ProviderMeta: backend provider status update → show/hide tabs, update names
      window.eventBus.on('provider:updated', () => {
        GenTab._updateProviderTabsFromMeta();
      });

      // ProviderMeta: initial data loaded → update tabs with names from backend
      window.eventBus.on('provider:meta_loaded', () => {
        console.log('[GenTab] provider:meta_loaded event received');
        GenTab._updateProviderTabsFromMeta();
      });
    }

    // Defer 1 frame để chắc chắn featureGate đã load entitlements
    setTimeout(() => GenTab._refreshProviderPillsGate(), 0);

    // ProviderMeta: initial update (fallback if event missed)
    setTimeout(() => GenTab._updateProviderTabsFromMeta(), 500);

    // Bind event handlers for all-providers-locked overlay
    GenTab._bindAllLockedOverlay();
  }

  static _bindAllLockedOverlay() {
    const overlay = document.getElementById('genAllLockedOverlay');
    if (!overlay || overlay._boundHandlers) return;
    overlay._boundHandlers = true;

    const loginBtn = overlay.querySelector('#genAllLockedLoginBtn');
    const upgradeBtn = overlay.querySelector('#genAllLockedUpgradeBtn');

    if (loginBtn) {
      loginBtn.addEventListener('click', () => {
        if (window.featureGate?.showLoginPrompt) {
          window.featureGate.showLoginPrompt();
        }
      });
    }
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', () => {
        /* upgrade modal removed — local-first */
      });
    }
  }

  /**
   * G: Đảm bảo provider tab URL đã mở + activate khi user click chọn provider.
   * Caller (click handler) đã guard `if (sel.value === providerKey) return` →
   * function này chỉ chạy khi provider thực sự CHANGE → luôn activate URL tab.
   * - chatgpt → ensureReady + ensureTabActive (force activate, bypass 60s cache)
   * - grok    → ensureReady + ensureTabActive (force activate, bypass 60s cache)
   * - flow    → activateFlowTabForExecution
   * CRITICAL: ensureReady() có 60s cache → cache hit RETURN ngay không activate.
   * Phải gọi ensureTabActive() SAU ensureReady để force activate cho mọi switch
   * (vd: Grok→Flow→Grok within 60s, lần 2 phải activate Grok tab).
   */
  static _ensureProviderTab(providerKey) {
    try {
      GenTab._checkDuplicateProviderTabs(providerKey);

      if (providerKey === 'chatgpt' && window.ChatGPTSession?.ensureReady) {
        window.ChatGPTSession.ensureReady({ createIfMissing: true, activate: true })
          .then(() => window.ChatGPTSession.ensureTabActive?.())
          .catch(err => console.warn('[GenTab] ChatGPT activate failed:', err?.message || err));
      } else if (providerKey === 'grok' && window.GrokSession?.ensureReady) {
        window.GrokSession.ensureReady({ createIfMissing: true, activate: true })
          .then(() => window.GrokSession.ensureTabActive?.())
          .catch(err => console.warn('[GenTab] Grok activate failed:', err?.message || err));
      } else if (providerKey === 'gemini' && window.GeminiSession?.ensureReady) {
        window.GeminiSession.ensureReady({ createIfMissing: true, activate: true })
          .then(() => window.GeminiSession.ensureTabActive?.())
          .catch(err => console.warn('[GenTab] Gemini activate failed:', err?.message || err));
      } else if (providerKey === 'claude' && window.ClaudeSession?.ensureReady) {
        window.ClaudeSession.ensureReady({ createIfMissing: true, activate: true })
          .then(() => window.ClaudeSession.ensureTabActive?.())
          .catch(err => console.warn('[GenTab] Claude activate failed:', err?.message || err));
      } else if (providerKey === 'flow') {
        try { chrome.runtime.sendMessage({ action: 'activateFlowTabForExecution' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _e); }); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#reEvalProvider', _); }
      }
    } catch (err) {
      console.warn('[GenTab] _ensureProviderTab error:', err?.message || err);
    }
  }

  /**
   * G: Check duplicate tabs cùng 1 provider URL. Nếu user mở 2+ tab cùng URL
   * (vd 2 tab chatgpt.com), session manager không biết tab nào dùng → behavior
   * không xác định. Show warning + offer "Đóng tabs thừa" action.
   *
   * Modes:
   *  - interactive=true (default): customDialog modal với button "Đóng tabs thừa"
   *    → confirm → trigger backend closeExtraProviderTabs (giữ tabs[0], close rest)
   *  - interactive=false: toast notification 6s (silent awareness)
   *
   * Dedup: tránh fire modal liên tục cho cùng provider trong 30s (flag _dupCheckPending).
   */
  static _checkDuplicateProviderTabs(providerKey, options = {}) {
    if (!chrome?.runtime?.sendMessage) return;
    const { interactive = true } = options;
    // Dedup theo provider — tránh modal duplicate khi multiple triggers fire trong ngắn hạn
    GenTab._dupCheckPending = GenTab._dupCheckPending || {};
    if (GenTab._dupCheckPending[providerKey]) return;
    try {
      chrome.runtime.sendMessage({ action: 'queryProviderTabs', provider: providerKey }, (resp) => {
        if (chrome.runtime.lastError) return;
        const count = resp?.count || 0;
        if (count <= 1) return;
        const providerName = providerKey === 'chatgpt' ? 'ChatGPT' : (providerKey === 'grok' ? 'Grok' : (providerKey === 'gemini' ? 'Gemini' : 'Flow'));
        const msg = (window.I18n?.t?.('gen.duplicateProviderTabs', { provider: providerName, count }))
          || `Phát hiện ${count} tab ${providerName} đang mở. Vui lòng đóng bớt để extension hoạt động ổn định.`;
        if (interactive && window.customDialog?.confirm) {
          GenTab._dupCheckPending[providerKey] = true;
          window.customDialog.confirm(msg, {
            title: window.I18n?.t?.('gen.duplicateTabsTitle') || 'Phát hiện tab trùng lặp',
            type: 'warning',
            confirmText: window.I18n?.t?.('gen.closeExtraTabs') || 'Đóng tabs thừa',
            cancelText: window.I18n?.t?.('common.ignore') || 'Bỏ qua',
          }).then((shouldClose) => {
            setTimeout(() => { delete GenTab._dupCheckPending[providerKey]; }, 30000);
            if (shouldClose) {
              chrome.runtime.sendMessage({ action: 'closeExtraProviderTabs', provider: providerKey }, (closeResp) => {
                if (closeResp?.ok && closeResp.closed > 0) {
                  window.showNotification?.(
                    (window.I18n?.t?.('gen.extraTabsClosed', { count: closeResp.closed }) || `Đã đóng ${closeResp.closed} tab thừa.`),
                    'success', 3000
                  );
                }
              });
            }
          });
        } else if (typeof window.showNotification === 'function') {
          window.showNotification(msg, 'warning', 6000);
        } else {
          console.warn(`[GenTab] ${msg}`);
        }
      });
    } catch (_) { /* noop */ }
  }

  /**
   * CG-5 polish: Refresh disabled state + lock icon trên provider pills theo feature gate.
   * Idempotent — gọi nhiều lần OK (check exists trước khi append/remove).
   */
  /**
   * SS-Phase E: Resolve gate state cho 1 provider tab.
   * Trả về { locked, reason: 'feature'|'quota'|null, tooltip }.
   *
   * Logic:
   *   1. Check feature gate (chatgpt_enabled / grok_enabled). Lock với tooltip "Pro plan required".
   *   2. Nếu feature OK, check action quota cho provider tương ứng:
   *      - flow:    gen_run_max
   *      - chatgpt: chatgpt_run_max
   *      - grok:    grok_run_max
   *      Lock với tooltip "Đã hết X/Y lượt hôm nay. Nâng cấp để tiếp tục."
   *
   * @param {string} provider 'flow' | 'chatgpt' | 'grok'
   * @param {string} context  'gen' | 'task' (Task dùng tasks_run_max thay cho gen_run_max — xem audit note)
   */
  static _resolveProviderGate(provider, context = 'gen') {
    const fg = window.featureGate;
    if (!fg) return { locked: false, reason: null, tooltip: '' };

    // Step 1: Feature lock check — check provider_enabled cho từng provider
    // Flow: gen_enabled, ChatGPT: chatgpt_enabled, Grok: grok_enabled
    if (provider === 'flow' && !fg.canUse?.('gen_enabled')) {
      return {
        locked: true,
        reason: 'feature',
        tooltip: window.I18n?.t?.('gen.flowProviderLockedHint') || 'Google Flow yêu cầu gói phù hợp.',
      };
    }
    if (provider === 'chatgpt' && !fg.canUse?.('chatgpt_enabled')) {
      return {
        locked: true,
        reason: 'feature',
        tooltip: window.I18n?.t?.('gen.providerLockedHint') || 'ChatGPT yêu cầu gói Pro.',
      };
    }
    if (provider === 'grok' && !fg.canUse?.('grok_enabled')) {
      return {
        locked: true,
        reason: 'feature',
        tooltip: window.I18n?.t?.('gen.grokProviderLockedHint') || 'Grok yêu cầu gói Pro.',
      };
    }

    // Step 2: Quota check theo provider + context
    // Map provider → quota key. Task path dùng tasks_run_max chung (per-provider quota
    // chatgpt_run_max/grok_run_max KHÔNG decrement cho task — outer task_run gate cover).
    const quotaKey = (() => {
      if (context === 'task') return 'tasks_run_max';
      if (provider === 'flow') return 'gen_run_max';
      if (provider === 'chatgpt') return 'chatgpt_run_max';
      if (provider === 'grok') return 'grok_run_max';
      return null;
    })();
    if (!quotaKey) return { locked: false, reason: null, tooltip: '' };

    const q = fg.checkQuota?.(quotaKey);
    if (!q) return { locked: false, reason: null, tooltip: '' };
    if (q.allowed) return { locked: false, reason: null, tooltip: '' };

    // Quota exhausted
    const limitText = q.limit === 'unlimited' ? '∞' : q.limit;
    const providerLabel = provider === 'chatgpt' ? 'ChatGPT' : (provider === 'grok' ? 'Grok' : 'Flow');
    const tooltip = (window.I18n?.t?.('gen.providerQuotaExhausted', {
      provider: providerLabel, used: q.used, limit: limitText,
    })) || `Đã hết ${q.used}/${limitText} lượt ${providerLabel} hôm nay.`;

    return { locked: true, reason: 'quota', tooltip, used: q.used, limit: q.limit };
  }

  static _refreshProviderPillsGate() {
    const tabs = document.querySelectorAll('#genProviderTabs .provider-tab');
    if (!tabs.length) return;

    const applyLock = (tab, gate) => {
      const locked = !!gate.locked;
      tab.classList.toggle('provider-tab-locked', locked);
      // CRITICAL: KHÔNG set tab.disabled — disabled button browser KHÔNG fire click event
      // → click handler upgrade modal/login prompt không chạy. Dùng aria-disabled (visual +
      // screen reader) + CSS .provider-tab-locked styling. Click handler tự intercept.
      tab.disabled = false;
      if (locked) {
        tab.setAttribute('aria-disabled', 'true');
        tab.setAttribute('data-tooltip', gate.tooltip);
        tab.title = gate.tooltip;
        tab.setAttribute('data-lock-reason', gate.reason || '');
      } else {
        tab.removeAttribute('aria-disabled');
        tab.removeAttribute('data-tooltip');
        tab.removeAttribute('data-lock-reason');
        tab.title = '';
      }
      // Crown icon vàng — chung cho cả feature lock + quota exhausted
      let lockIcon = tab.querySelector('.provider-tab-lock');
      if (locked && !lockIcon) {
        lockIcon = document.createElement('span');
        lockIcon.className = 'provider-tab-lock';
        lockIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="#eab308" style="margin-left:4px;vertical-align:-1px;"><path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"/></svg>';
        tab.appendChild(lockIcon);
      } else if (!locked && lockIcon) {
        lockIcon.remove();
      }
    };

    const gates = {};
    tabs.forEach((tab) => {
      const provider = tab.dataset.provider;
      const gate = GenTab._resolveProviderGate(provider, 'gen');
      gates[provider] = gate;
      applyLock(tab, gate);
    });

    // Check if ALL providers are locked (feature-locked, not quota).
    // Source of truth: gates đã populate từ DOM tabs ở loop trên (line 2752).
    const allLocked = Object.keys(gates).length > 0 && Object.keys(gates).every((p) => {
      const g = gates[p];
      return g?.locked && g.reason === 'feature';
    });

    // Show/hide all-providers-locked overlay
    const overlay = document.getElementById('genAllLockedOverlay');
    if (overlay) {
      const isLoggedIn = !!(true);
      overlay.classList.toggle('hidden', !allLocked);
      const loginBtn = overlay.querySelector('#genAllLockedLoginBtn');
      const upgradeBtn = overlay.querySelector('#genAllLockedUpgradeBtn');
      if (loginBtn && upgradeBtn) {
        loginBtn.classList.toggle('hidden', isLoggedIn);
        upgradeBtn.classList.toggle('hidden', !isLoggedIn);
      }
    }

    // Force-switch nếu user đang ở provider mà mất quyền (downgrade/logout/quota hết).
    // Chỉ force-switch khi reason='feature' (mất quyền vĩnh viễn theo plan), KHÔNG force-switch
    // khi reason='quota' (chỉ hết hôm nay — user vẫn có thể chờ reset hoặc nâng cấp). Quota
    // exhausted vẫn lock submit nhưng giữ provider để user thấy crown + tooltip rõ ràng.
    // Skip if all providers are locked — nowhere to switch to.
    if (!allLocked) {
      try {
        const sel = document.getElementById('genProvider');
        const currentProvider = sel?.value;
        const currentGate = gates[currentProvider];

        // Nếu provider hiện tại bị lock feature → tìm provider không bị lock để switch.
        // Source of truth: gates populate từ DOM (line 2752).
        if (currentGate?.locked && currentGate.reason === 'feature') {
          const providers = Object.keys(gates);
          let targetProvider = null;

          for (const p of providers) {
            if (p === currentProvider) continue;
            const gate = gates[p];
            if (!gate?.locked || gate.reason !== 'feature') {
              targetProvider = p;
              break;
            }
          }

          if (targetProvider) {
            sel.value = targetProvider;
            document.querySelectorAll('#genProviderTabs .provider-tab').forEach((t) => {
              const isTarget = t.dataset.provider === targetProvider;
              t.classList.toggle('provider-tab--active', isTarget);
              t.setAttribute('aria-selected', String(isTarget));
            });
            if (window.eventBus) {
              try { window.eventBus.emit('provider:changed', { provider: targetProvider }); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#applyLock', _); }
            }
            if (typeof GenTab._renderByProvider === 'function') {
              try { GenTab._renderByProvider(targetProvider); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#applyLock', _); }
            }
            if (typeof window.showNotification === 'function') {
              try {
                const fromName = window.ProviderMeta?.getName?.(currentProvider) || currentProvider;
                const toName = window.ProviderMeta?.getName?.(targetProvider) || targetProvider;
                const msg = window.I18n?.t?.('gen.autoSwitchProvider', { from: fromName, to: toName })
                  || window.I18n?.t?.('genNotifyExtra.autoSwitchProviderFallback', { from: fromName, to: toName })
                  || `Đã chuyển sang ${toName} do mất quyền ${fromName}`;
                window.showNotification(msg, 'warning', 2500);
              } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#applyLock', _); }
            }
          }
        }
      } catch (_) { /* noop */ }
    }
  }

  /**
   * Update provider tabs based on ProviderMeta (backend provider status).
   * - Hide tabs where provider.status !== 'active'
   * - Update name span if backend has custom name
   * - SEPARATE from FeatureGate (crown UI) which controls user access
   */
  static _updateProviderTabsFromMeta() {
    const tabs = document.querySelectorAll('#genProviderTabs .provider-tab');
    if (!tabs.length) return;

    const PM = window.ProviderMeta;
    if (!PM) {
      console.log('[GenTab] _updateProviderTabsFromMeta: ProviderMeta not available');
      return;
    }

    const allProviders = PM.getAll();
    // 2026-05-25: Idempotency check — skip update nếu data signature unchanged.
    // Trước fix: event provider:meta_loaded fire 3-4 lần lúc init → re-render cùng data → DOM thrash + log spam.
    // Signature includes slug + name + isActive + hasServerIcon — bắt cả icon toggle qua admin update.
    const signature = allProviders.map(p =>
      `${p.slug}:${p.name}:${PM.isActive(p.slug)}:${PM.hasServerIcon?.(p.slug) ? '1' : '0'}`
    ).sort().join('|');
    if (this._lastProvidersSignature === signature) {
      return; // No change, skip render
    }
    this._lastProvidersSignature = signature;
    console.log('[GenTab] _updateProviderTabsFromMeta: providers=', allProviders.map(p => `${p.slug}:${p.name}`));

    tabs.forEach((tab) => {
      const slug = tab.dataset.provider;
      if (!slug) return;

      // Visibility: hide if provider not active (backend status control)
      const isActive = PM.isActive(slug);
      const status = PM.getStatus(slug);
      console.log(`[GenTab] Tab ${slug}: status=${status}, isActive=${isActive}, display=${isActive ? 'show' : 'hide'}`);
      tab.style.display = isActive ? '' : 'none';

      // Update name span (if backend has custom name)
      const nameSpan = tab.querySelector('span[data-i18n]') || tab.querySelector('span:not(.provider-tab-lock)');
      if (nameSpan) {
        const provider = PM.getSync(slug);
        if (provider?.name) {
          console.log(`[GenTab] Updating tab ${slug} name: ${nameSpan.textContent} → ${provider.name}`);
          nameSpan.textContent = provider.name;
        }
      }

      // Update icon only if server has custom icon (not empty/fallback)
      const iconEl = tab.querySelector('.provider-tab-icon');
      if (iconEl && PM.hasServerIcon(slug)) {
        const newIcon = PM.getIcon(slug);
        if (newIcon && newIcon.trim().startsWith('<svg')) {
          // Parse new icon and replace
          const temp = document.createElement('div');
          temp.innerHTML = newIcon;
          const newSvg = temp.querySelector('svg');
          if (newSvg) {
            newSvg.classList.add('provider-tab-icon');
            newSvg.setAttribute('width', '14');
            newSvg.setAttribute('height', '14');
            iconEl.replaceWith(newSvg);
          }
        }
      }
    });

    // If current provider is hidden, auto-switch to first visible provider
    const sel = document.getElementById('genProvider');
    if (sel) {
      const currentSlug = sel.value;
      if (!PM.isActive(currentSlug)) {
        const visibleTab = Array.from(tabs).find((t) => {
          const s = t.dataset.provider;
          return s && PM.isActive(s);
        });
        if (visibleTab) {
          const newSlug = visibleTab.dataset.provider;
          sel.value = newSlug;
          tabs.forEach((t) => {
            const isTarget = t.dataset.provider === newSlug;
            t.classList.toggle('provider-tab--active', isTarget);
            t.setAttribute('aria-selected', String(isTarget));
          });
          window.eventBus?.emit('provider:changed', { provider: newSlug });
          GenTab._renderByProvider(newSlug);
          const oldName = PM.getName(currentSlug) || currentSlug;
          const newName = PM.getName(newSlug) || newSlug;
          window.showNotification?.(
            window.I18n?.t('taskNotify.providerSuspendedSwitch', { from: oldName, to: newName }) ||
              `${oldName} tạm ngưng — đã chuyển sang ${newName}`,
            'warning', 2500
          );
        }
      }
    }
  }

  /**
   * CG-5.2: Toggle UI controls dựa trên adapter capabilities.
   * - Hide/show genTypeTabs, modelSelect, quantitySection
   * - Re-render ratio pills theo supportedRatios + uiMap
   * - Cap maxRefImages
   * - Set ref picker mode
   * - Update submit button label
   */
  static _renderByProvider(providerKey) {
    if (!window.ProviderRegistry || typeof ProviderRegistry.get !== 'function') {
      console.warn('[GenTab] ProviderRegistry chưa sẵn sàng — skip _renderByProvider');
      return;
    }
    const adapter = ProviderRegistry.get(providerKey);
    if (!adapter || !adapter.capabilities) {
      console.warn('[GenTab] Adapter không tồn tại:', providerKey);
      return;
    }
    const caps = adapter.capabilities;
    const isChatGPT = providerKey === 'chatgpt';
    const isGrok = providerKey === 'grok';

    // Gen type tabs LUÔN HIỂN THỊ — kể cả ChatGPT (chỉ image) để user nhận diện loại media.
    // ChatGPT: ẩn Video (chưa hỗ trợ), force Image active.
    // Grok: hỗ trợ cả Image và Video → giữ visible cả 2.
    // Flow: show cả 2 button (toggle tự nhiên).
    GenTab._toggleEl('#genTypeTabs', true);
    const videoBtn = document.querySelector('#genTypeToggle .gen-type-btn[data-value="Video"]');
    const imageBtn = document.querySelector('#genTypeToggle .gen-type-btn[data-value="Image"]');
    if (videoBtn) videoBtn.style.display = isChatGPT ? 'none' : '';
    if (isChatGPT) {
      // Force Image mode khi switch sang ChatGPT
      if (imageBtn && !imageBtn.classList.contains('active')) {
        imageBtn.classList.add('active');
        if (videoBtn) videoBtn.classList.remove('active');
        const genTypeSel = document.getElementById('genType');
        if (genTypeSel && genTypeSel.value !== 'Image') {
          genTypeSel.value = 'Image';
          genTypeSel.dispatchEvent(new Event('change'));
        }
      }
    }

    // Bug fix 2026-06-03: Flow-only containers (image/video model + input type + voice) phải
    // refresh theo CẢ provider + genType khi switch provider. Trước fix: `_renderByProvider`
    // chỉ toggle imageModelContainer theo provider (không theo genType), không touch
    // videoModelContainer/videoInputType/voice → switch Grok Video→Flow giữ imageModel,
    // ẩn videoModel; switch Flow Video→ChatGPT/Grok giữ voice picker.
    const isFlowVideoMode = providerKey === 'flow' && (document.getElementById('genType')?.value === 'Video');
    const isFlowImageMode = providerKey === 'flow' && (document.getElementById('genType')?.value !== 'Video');
    GenTab._toggleEl('#imageModelContainer', isFlowImageMode);
    GenTab._toggleEl('#videoModelContainer', isFlowVideoMode);
    GenTab._toggleEl('#videoInputTypeContainer', isFlowVideoMode);
    if (!isFlowVideoMode) GenTab._toggleEl('#videoFramesSection', false);
    // ChatGPT model (Instant/Thinking — GPT-5.5) chỉ hiện khi provider='chatgpt'
    const isGemini = providerKey === 'gemini';
    const isClaude = providerKey === 'claude';
    GenTab._toggleEl('#chatgptModelContainer', isChatGPT);
    GenTab._toggleEl('#geminiModelContainer', isGemini);
    GenTab._toggleEl('#claudeModelContainer', isClaude);
    // Khôi phục value model từ af_settings.chatgptModel (đồng bộ pattern chatgptDefaultRatio).
    if (isChatGPT && GenTab.chatgptModelSelect) {
      chrome.storage.local.get(['af_settings'], (res) => {
        const def = res.af_settings?.chatgptModel || 'Instant';
        if ([...GenTab.chatgptModelSelect.options].some(o => o.value === def)) {
          GenTab.chatgptModelSelect.value = def;
        }
      });
    }

    // G: Grok video fields (duration + resolution) + image quality — toggle theo mode.
    // - Video mode: show duration + resolution
    // - Image mode: show imageQuality (Speed/Quality, Grok update 2026-04)
    const syncGrokModeFields = () => {
      const isGrokVideo = isGrok && (document.getElementById('genType')?.value === 'Video');
      const isGrokImage = isGrok && (document.getElementById('genType')?.value !== 'Video');
      GenTab._toggleEl('#grokDurationContainer', isGrokVideo);
      GenTab._toggleEl('#grokResolutionContainer', isGrokVideo);
      GenTab._toggleEl('#grokImageQualityContainer', isGrokImage);
    };
    syncGrokModeFields();
    // Server-Only: populate grok duration options từ config (sidebar.html chỉ có 6s/10s tĩnh).
    if (isGrok) GenTab.updateGrokVideoDurationOptions();
    // Bind 1 lần qua flag tĩnh (idempotent across re-renders)
    if (!GenTab._grokVideoFieldsBound) {
      const genTypeSel = document.getElementById('genType');
      genTypeSel?.addEventListener('change', () => {
        const curProvider = document.getElementById('genProvider')?.value || 'flow';
        const curIsGrok = curProvider === 'grok';
        const curIsVideo = document.getElementById('genType')?.value === 'Video';
        GenTab._toggleEl('#grokDurationContainer', curIsGrok && curIsVideo);
        GenTab._toggleEl('#grokResolutionContainer', curIsGrok && curIsVideo);
        GenTab._toggleEl('#grokImageQualityContainer', curIsGrok && !curIsVideo);
      });
      GenTab._grokVideoFieldsBound = true;
    }

    // Flow video duration — toggle theo mode + update options theo model
    const syncFlowVideoFields = () => {
      const isFlowVideo = providerKey === 'flow' && (document.getElementById('genType')?.value === 'Video');
      GenTab._toggleEl('#flowVideoDurationContainer', isFlowVideo);
      if (isFlowVideo) {
        GenTab.updateFlowVideoDurationOptions();
        GenTab._applyFramesSupport();
      }
    };
    syncFlowVideoFields();
    // Bug fix 2026-06-03: refresh voice picker visibility KHÔNG chỉ qua updateGenTypeUI
    // (chỉ chạy khi genType change). Switch provider giữ genType=Video → cần ẩn voice
    // khi provider→chatgpt/grok, hiện khi provider→flow (nếu model.supports_voice).
    try { GenTab._applyVoicePickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#syncFlowVideoFields', _); }
    try { GenTab._applyCharacterPickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#syncFlowVideoFields', _); }
    if (!GenTab._flowVideoFieldsBound) {
      const genTypeSel = document.getElementById('genType');
      genTypeSel?.addEventListener('change', () => {
        const curProvider = document.getElementById('genProvider')?.value || 'flow';
        const curIsFlow = curProvider === 'flow';
        const curIsVideo = document.getElementById('genType')?.value === 'Video';
        GenTab._toggleEl('#flowVideoDurationContainer', curIsFlow && curIsVideo);
        if (curIsFlow && curIsVideo) {
          GenTab.updateFlowVideoDurationOptions();
        }
      });
      // Update duration options when video model changes + re-validate ref support + re-render ref limit indicator
      GenTab.videoModelSelect?.addEventListener('change', () => {
        GenTab.updateFlowVideoDurationOptions();
        GenTab._validateRefSupportAfterChange('model');
        GenTab._applyFramesSupport(); // ẩn option Frames nếu model mới không hỗ trợ
        GenTab._applyVoicePickerVisibility(); // Flow Voice: show/hide theo model.config.supports_voice
        GenTab._applyCharacterPickerVisibility(); // Flow Character: show/hide theo model.config.supports_character
        // 2026-05-22: re-render thumbnails để update ref-thumb-exceeded — refLimit có thể đổi
        // theo model/duration (smart fallback supportsRefImages, model-specific config tương lai).
        try { GenTab.renderFileIdThumbnails(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#syncFlowVideoFields', _); }
      });
      // Duration / input type / media type change → re-check ref support (vd Lite/Fast 4s/6s block ref)
      GenTab.flowVideoDurationSelect?.addEventListener('change', () => {
        GenTab._validateRefSupportAfterChange('duration');
        try { GenTab.renderFileIdThumbnails(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#syncFlowVideoFields', _); }
      });
      GenTab.videoInputTypeSelect?.addEventListener('change', () => {
        GenTab._validateRefSupportAfterChange('input_type');
        // Note: listener khác ở line 689 đã call renderFileIdThumbnails — duplicate call OK (idempotent).
      });
      GenTab._flowVideoFieldsBound = true;
    }

    // Quantity section: chỉ Flow hỗ trợ quantity; ChatGPT + Grok đều KHÔNG hỗ trợ.
    GenTab._toggleEl('#quantitySection', providerKey === 'flow');

    // ChatGPT: toggle "Xóa tin nhắn sau khi gen thành công"
    GenTab._toggleEl('#chatgptDeleteAfterGenContainer', isChatGPT);
    if (isChatGPT) {
      const deleteToggle = document.getElementById('genChatgptDeleteAfterGen');
      if (deleteToggle) {
        // Re-read value mỗi lần render — sync với af_settings (settings popup save sẽ reflect ngay).
        // Bug fix 2026-05-22: trước đây chỉ read 1 lần (flag _chatgptDeleteToggleBound) → settings popup update không phản ánh.
        chrome.storage.local.get(['af_settings'], (res) => {
          deleteToggle.checked = !!(res.af_settings?.chatgptDeleteAfterGen);
        });
        // Bind change listener 1 lần duy nhất (idempotent qua flag).
        if (!GenTab._chatgptDeleteToggleBound) {
          GenTab._chatgptDeleteToggleBound = true;
          deleteToggle.addEventListener('change', () => {
            chrome.storage.local.get(['af_settings'], (res) => {
              const settings = res.af_settings || {};
              settings.chatgptDeleteAfterGen = deleteToggle.checked;
              chrome.storage.local.set({ af_settings: settings });
            });
          });
        }
      }
    }
    // Filter quantity options chỉ áp dụng cho Flow (Grok không có quantity)
    if (providerKey === 'flow') {
      try {
        const qtySelect = document.getElementById('quantitySelect');
        if (qtySelect) {
          const supportedQty = Array.isArray(caps.supportedQuantities) && caps.supportedQuantities.length > 0
            ? caps.supportedQuantities
            : [1, 2, 3, 4]; // Flow default
          Array.from(qtySelect.options).forEach(opt => {
            const v = parseInt(opt.value, 10);
            opt.hidden = !supportedQty.includes(v);
          });
          // Nếu current value không còn trong supported list → reset về giá trị đầu
          if (!supportedQty.includes(parseInt(qtySelect.value, 10))) {
            qtySelect.value = String(supportedQty[0]);
          }
        }
      } catch (_e) { /* noop */ }
    }

    // Ratio section: re-render theo adapter
    if (caps.supportsRatio !== false && Array.isArray(caps.supportedRatios) && caps.supportedRatios.length > 0) {
      GenTab._toggleEl('#ratioSection', true);
      GenTab._renderRatioPills(caps.supportedRatios, caps.ratioUiMap || {}, providerKey);
    } else {
      // Mặc định Flow giữ ratio cũ (16:9, 9:16 ...)
      GenTab._toggleEl('#ratioSection', true);
    }

    // Cap maxRefImages
    if (typeof caps.maxRefImages === 'number') {
      GenTab._chatgptMaxRefImages = caps.maxRefImages;
    } else {
      GenTab._chatgptMaxRefImages = null;
    }

    // Ref picker mode: GIỮ tab Flow ngay cả khi chatgpt — user yêu cầu rollback CG-5.5
    // (Cho phép upload ảnh từ Flow làm ref ChatGPT). _setRefPickerMode('all') = full 3 tab.
    GenTab._setRefPickerMode('all');

    // Resolution picker delegate hoàn toàn cho _syncDownloadVisibility
    // (đã wire đúng logic provider + genType + autoDownload toggle).
    if (typeof GenTab._syncDownloadVisibility === 'function') {
      GenTab._syncDownloadVisibility();
    }

    // Update submit button label
    if (GenTab.startBtn) {
      const labelSpan = GenTab.startBtn.querySelector('span') || GenTab.startBtn;
      if (isGrok) {
        labelSpan.textContent = window.I18n?.t('gen.generateGrok') || 'Generate via Grok';
      } else if (isChatGPT) {
        labelSpan.textContent = window.I18n?.t('gen.generateChatGPT') || 'Generate via ChatGPT';
      } else {
        // Khôi phục label gốc — generate text được set ở nhiều nơi, để text mặc định
        labelSpan.textContent = window.I18n?.t('gen.generate') || 'Generate';
      }
    }

    // ChatGPT/Grok: ẩn run mode UI (parallel/sequential) — chỉ 1 tab/1 editor → luôn sequential.
    // Force runMode = 'sequential' để _submitViaChatGPT/_submitViaGrok loop tuần tự không bị chặn bởi parallel state cũ.
    // Dùng SHARED _savedRunModeBeforeProvider để tránh state collision khi switch chatgpt → grok → flow.
    const runModeRow = document.querySelector('.gen-run-mode-row');
    if (runModeRow) {
      if (isChatGPT || isGrok) {
        runModeRow.classList.add('hidden');
        // Lưu state trước khi override để restore khi user switch về Flow
        if (GenTab._savedRunModeBeforeProvider === undefined) {
          GenTab._savedRunModeBeforeProvider = GenTab.runMode;
        }
        GenTab.runMode = 'sequential';
        GenTab._updateRunModeUI(); // Sync UI
      } else {
        // Restore state cũ khi user switch về Flow
        if (GenTab._savedRunModeBeforeProvider !== undefined) {
          GenTab.runMode = GenTab._savedRunModeBeforeProvider;
          GenTab._savedRunModeBeforeProvider = undefined;
          GenTab._updateRunModeUI(); // Sync UI
        }
        // Show lại runModeRow nếu đang ở multi-prompt mode
        const isMulti = GenTab.multiPromptCheck?.checked;
        runModeRow.classList.toggle('hidden', !isMulti);
        if (isMulti) {
          GenTab._updateRunModeUI();
        }
      }
    }

    // Status badge "Ready" đã bỏ theo yêu cầu UX — provider tab pill tự reflect selection.
  }

  /**
   * CG-5.2: Re-render ratio pills (select options) cho aspectRatio select.
   * GenTab dùng <select> cho ratio, không phải pills — re-render options là đủ.
   * @param {string[]} supportedRatios - VD ['story','portrait','square','landscape','widescreen']
   * @param {object} uiMap - Map key -> display text, VD { story: '9:16', portrait: '3:4', ... }
   * @param {string} providerKey - Để biết là 'flow' hay 'chatgpt'
   */
  static _renderRatioPills(supportedRatios, uiMap, providerKey) {
    const sel = GenTab.aspectRatioSelect;
    if (!sel) return;

    // Lưu giá trị hiện tại (nếu có) để khôi phục sau khi re-render
    const currentValue = sel.value;

    // Flow: KHÔNG động vào (giữ nguyên options cũ vì hàm khác xử lý theo genType)
    if (providerKey === 'flow') {
      // Restore Flow options nếu trước đó đã bị overwrite bởi ChatGPT/Grok
      const lastProvider = sel.dataset.cg5Provider;
      if (lastProvider === 'chatgpt' || lastProvider === 'grok') {
        // Dùng updateRatioOptions() để load từ ProviderConfigManager (admin tweakable)
        GenTab.updateRatioOptions();
        sel.dataset.cg5Provider = 'flow';

        // Restore Flow ratio từ settings (nếu user đã từng dùng Flow)
        chrome.storage.local.get(['af_settings'], (res) => {
          const settings = res.af_settings || {};
          const flowRatio = settings.aspectRatio;
          // Server returns [{value, ui_name}] — extract value strings for validation
          const rawRatios = window.ProviderConfigManager?.safeGetRatiosSync?.('flow', 'image')
            || ['16:9', '4:3', '1:1', '3:4', '9:16'];
          const validFlowRatios = rawRatios.map(r => typeof r === 'string' ? r : (r.value || r));
          if (flowRatio && validFlowRatios.includes(flowRatio)) {
            sel.value = flowRatio;
          }
        });
      }
      return;
    }

    // ChatGPT/Grok: re-render options từ supportedRatios + uiMap
    // Thêm icon prefix unicode để dễ nhận biết (giống TaskModal)
    // story=9:16 (▮ dọc nhỏ), portrait=3:4 (▯ dọc), square=1:1 (□ vuông),
    // landscape=4:3 (▭ ngang), widescreen=16:9 (▬ ngang rộng)
    const iconMap = {
      story: '▮', portrait: '▯', square: '□', landscape: '▭', widescreen: '▬',
    };
    sel.dataset.cg5Provider = providerKey; // 'chatgpt' hoặc 'grok'
    sel.innerHTML = '';
    for (const ratio of supportedRatios) {
      const display = uiMap[ratio] || ratio;
      const icon = iconMap[ratio] || '';
      const opt = document.createElement('option');
      opt.value = ratio;
      opt.textContent = icon ? `${icon} ${display}` : display;
      sel.appendChild(opt);
    }

    // Khôi phục value: ưu tiên currentValue (nếu nằm trong supportedRatios),
    // fallback về settings.{provider}DefaultRatio, fallback về phần tử đầu
    chrome.storage.local.get(['af_settings'], (res) => {
      const settings = res.af_settings || {};
      const settingKey = providerKey === 'grok' ? 'grokDefaultRatio' : 'chatgptDefaultRatio';
      const fallbackDefault = providerKey === 'grok' ? 'widescreen' : 'story';
      const defaultRatio = settings[settingKey] || supportedRatios[0] || fallbackDefault;
      if (supportedRatios.includes(currentValue)) {
        sel.value = currentValue;
      } else if (supportedRatios.includes(defaultRatio)) {
        sel.value = defaultRatio;
      } else {
        sel.value = supportedRatios[0];
      }
    });
  }

  /**
   * CG-5: Helper toggle element visibility (dùng class 'hidden').
   */
  static _toggleEl(selector, visible) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return;
    if (visible) {
      el.classList.remove('hidden');
      el.style.display = '';
    } else {
      el.classList.add('hidden');
    }
  }

  /**
   * CG-5.5: Đặt mode cho ref picker.
   * - 'upload-only': chỉ Album + Upload, ẩn tab Flow
   * - 'all': hiện đủ 3 tab (default)
   */
  static _setRefPickerMode(mode) {
    GenTab._refPickerMode = mode;
    // Truyền options khi mở ImagePickerModal — sẽ được dùng ở openImagePickerBtn click handler
    GenTab._imagePickerModalOptions = mode === 'upload-only'
      ? { hideFlowTilePicker: true }
      : null;
  }

  /**
   * CG-5.1: Update provider status badge.
   * - Flow: ẩn badge
   * - ChatGPT: kiểm tra ChatGPTSession.ensureReady (lazy — không tạo tab nếu chưa có)
   */
  static async _updateProviderStatus(providerKey) {
    const badge = GenTab.providerStatusBadge;
    if (!badge) return;

    if (providerKey !== 'chatgpt') {
      // Flow: ẩn badge
      badge.classList.remove('is-visible', 'is-info', 'is-warning', 'is-success', 'is-blocked');
      badge.textContent = '';
      return;
    }

    // ChatGPT: hiển thị badge mặc định "info" trước, sau đó cập nhật theo trạng thái
    badge.classList.add('is-visible');
    badge.classList.remove('is-success', 'is-warning', 'is-blocked', 'is-info');
    badge.classList.add('is-info');
    badge.textContent = '...';

    if (!window.ChatGPTSession) {
      badge.classList.remove('is-info');
      badge.classList.add('is-warning');
      badge.textContent = window.I18n?.t('gen.providerStatusLogin') || 'Chưa đăng nhập';
      return;
    }

    try {
      const result = await window.ChatGPTSession.ensureReady({ createIfMissing: false, activate: false });
      badge.classList.remove('is-info', 'is-warning', 'is-blocked', 'is-success');
      if (result?.ready) {
        badge.classList.add('is-success');
        badge.textContent = window.I18n?.t('gen.providerStatusReady') || 'Ready';
      } else if (result?.error === 'NOT_LOGGED_IN' || result?.error === 'NO_TAB') {
        badge.classList.add('is-warning');
        badge.textContent = window.I18n?.t('gen.providerStatusLogin') || 'Not logged in';
      } else {
        badge.classList.add('is-blocked');
        badge.textContent = window.I18n?.t('gen.providerStatusBlocked') || 'Blocked';
      }
    } catch (err) {
      console.warn('[GenTab] _updateProviderStatus error:', err);
      badge.classList.remove('is-info', 'is-success');
      badge.classList.add('is-warning');
      badge.textContent = window.I18n?.t('gen.providerStatusLogin') || 'Chưa đăng nhập';
    }
  }

  /**
   * Fix 7: Build filename cho download ảnh ChatGPT.
   * Tái sử dụng template tokens [Date], [Project], [Prompt], [Index].
   * @param {string} template - VD '[Date]_[Project]_[Prompt]_[Index]'
   * @param {string} project - Tên project hiện tại
   * @param {string} prompt - Prompt text
   * @param {number} promptIdx - Index của prompt (1-based)
   * @param {number} urlIdx - Index ảnh trong prompt (1-based, ChatGPT thường 1)
   * @param {string} subFolder - Subfolder name (optional, từ #genTabSubFolder GenTab)
   * @param {string|null} taskName - Task name (null cho gen tab)
   * @param {string} [downloadFolder] - Root download folder (từ settings.downloadFolder)
   * @returns {string} '{downloadFolder}/[subFolder/][task/]filename.png'
   */
  static _buildChatGPTFilename(template, project, prompt, promptIdx, urlIdx, subFolder, taskName, downloadFolder) {
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, '-');

    // Strip diacritics + non-ASCII (U+0300 to U+036F = combining diacritical marks)
    const toAscii = (s) => (s || '').replace(/[đĐ]/g, c => c === 'đ' ? 'd' : 'D')
      .normalize('NFD').replace(/[̀-ͯ]/g, '');

    const safeProject = toAscii(project || 'flow').substring(0, 30).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safePrompt = toAscii(prompt || 'chatgpt').substring(0, 40).replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeIndex = String((promptIdx - 1) * 10 + urlIdx).padStart(3, '0');

    let filename = (template || '[Date]_[Prompt]_[Index]')
      .replace(/\[Date\]/gi, date)
      .replace(/\[Time\]/gi, time)
      .replace(/\[Project\]/gi, safeProject)
      .replace(/\[Prompt\]/gi, safePrompt)
      .replace(/\[Index\]/gi, safeIndex);

    filename = filename.replace(/_+/g, '_').replace(/^_|_$/g, '');
    if (!filename) filename = 'chatgpt_' + Date.now();

    // CRITICAL: Read root folder từ settings (af_settings.downloadFolder), fallback 'flow-output'.
    // Trước đó hardcode 'flow-output' → user setting downloadFolder bị ignore cho ChatGPT/Grok.
    const safeRootFolder = toAscii(downloadFolder || 'flow-output').replace(/[^a-zA-Z0-9_-]/g, '_') || 'flow-output';

    // [Bug fix 2026-06-10] Dedupe subFolder/taskName trùng baseFolder → tránh duplicate path
    // (vd user nhập subFolder = 'seosonaflow_output' = downloadFolder setting → path
    // 'seosonaflow_output/seosonaflow_output/file.png' fail zsh "no such file or directory").
    let baseFolder = safeRootFolder;
    if (subFolder) {
      const safeSub = toAscii(subFolder).replace(/[^a-zA-Z0-9_-]/g, '_');
      if (safeSub.toLowerCase() !== safeRootFolder.toLowerCase()) {
        baseFolder = `${safeRootFolder}/${safeSub}`;
      } else {
        console.warn('[GenTab] _buildChatGPTFilename: subFolder trùng downloadFolder, skip duplicate layer:', safeRootFolder);
      }
    }

    if (taskName) {
      const safeTaskName = toAscii(taskName).substring(0, 30).replace(/[^a-zA-Z0-9_-]/g, '_');
      // Compare với LAST segment của baseFolder (vì baseFolder có thể đã có subFolder nested)
      const lastSeg = baseFolder.split('/').pop() || '';
      if (safeTaskName.toLowerCase() === lastSeg.toLowerCase()) {
        console.warn('[GenTab] _buildChatGPTFilename: taskName trùng last folder layer, skip duplicate:', lastSeg);
        return `${baseFolder}/${filename}.png`;
      }
      return `${baseFolder}/${safeTaskName}/${filename}.png`;
    }
    return `${baseFolder}/${filename}.png`;
  }

  /**
   * CG-5.4 + CG-5.6: Submit prompts qua ChatGPT adapter (sequential per prompt).
   * Caller chịu trách nhiệm: validate prompts, ExecutionGate (đã làm ở handler chính),
   * download local sau khi nhận imageUrls.
   *
   * @param {object} params - { prompts, fileIds, settings, settingsObj, executionToken }
   * @returns {Promise<{completed:number, failed:number, stopped:boolean, urls:string[]}>}
   */
  // ─── Rich FloatingTracker bridge cho ChatGPT/Grok (single source of truth = sidebar, giống Flow) ───
  // ChatGPT/Grok chạy loop trực tiếp (không qua PromptQueue) → build trackerData đúng shape PromptQueue
  // rồi broadcast 'pq:trackerUpdate' tới tab provider → content script render rich multi-prompt (updateFromQueue).
  static _buildChatTrackerData(label, prompts, states, startedAt, isRunning) {
    const completed = states.filter(s => s === 'COMPLETED').length;
    const failed = states.filter(s => s === 'FAILED').length;
    const total = prompts.length;
    const status = isRunning ? 'running' : (completed > 0 ? 'completed' : 'stopped');
    return {
      isRunning, completed, total,
      elapsed: startedAt ? (Date.now() - startedAt) : 0,
      jobs: [{
        id: 'chat-gen', owner: 'prompts', label, status,
        completed, failed, total, startedAt,
        items: prompts.map((p, i) => ({
          id: 'p' + i, promptIndex: i, promptText: p,
          state: states[i] || 'PENDING', retryCount: 0, submittedAt: null, completedAt: null,
        })).slice(-15),
      }],
    };
  }

  static _broadcastChatTracker(provider, data) {
    if (!chrome?.tabs?.query) return;
    const patterns = provider === 'grok'
      ? ['https://grok.com/*', 'https://*.grok.com/*']
      : ['https://chatgpt.com/*', 'https://chat.openai.com/*'];
    patterns.forEach(pat => {
      try {
        chrome.tabs.query({ url: pat }, (tabs) => {
          if (chrome.runtime.lastError || !tabs) return;
          tabs.forEach(t => {
            try { chrome.tabs.sendMessage(t.id, { action: 'pq:trackerUpdate', data }, () => { void chrome.runtime.lastError; }); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#toAscii', _); }
          });
        });
      } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#toAscii', _); }
    });
  }

  static async _submitViaChatGPT(params) {
    const prompts = params.prompts || [];
    const fileIds = params.fileIds || [];
    const settings = params.settings || {};
    const settingsObj = params.settingsObj || {};

    if (!window.ProviderRegistry) {
      throw new Error('ProviderRegistry chưa sẵn sàng');
    }
    const adapter = ProviderRegistry.get('chatgpt');
    if (!adapter) {
      throw new Error('ChatGPT adapter chưa được đăng ký');
    }

    // 1. ensureReady (sẽ tạo tab + check login). Nếu fail → emit chatgpt:login_required và return
    try {
      const ready = await adapter.ensureReady();
      if (!ready?.ready) {
        if (window.eventBus) {
          window.eventBus.emit('chatgpt:login_required', { error: ready?.error || 'NOT_LOGGED_IN' });
        }
        return { completed: 0, failed: prompts.length, stopped: false, urls: [] };
      }
    } catch (err) {
      console.error('[GenTab] ChatGPT ensureReady failed:', err);
      if (window.eventBus) {
        window.eventBus.emit('chatgpt:login_required', { error: err?.message });
      }
      return { completed: 0, failed: prompts.length, stopped: false, urls: [] };
    }

    // [Fix 2026-06-10] Sequential mode đã được support: loop per-prompt + ChatGPTAdapter.submit
    // nhận refFileIds riêng mỗi call. Trước fix: block reject force về 'all' — không cần thiết.
    // Mapping: prompt[i] dùng ref[i % refs.length] (cycle nếu prompts > refs, đồng bộ Flow line 1987).

    // 3. Resolve refs: ChatGPT chỉ chấp nhận pre-resolved object array với { base64, name, type }.
    //    GenTab giữ refs dạng tile_id → cần fetch thumbnail URL và convert → base64.
    //    Cap maxRefImages: mode 'all' → cap TRƯỚC fetch tiết kiệm network.
    //    Mode 'mention' → resolve TẤT CẢ refs (no cap) vì filter @mention per-prompt
    //    sẽ tự bound dưới maxRef. Tránh case mentioned image bị truncate trước filter.
    //    Mode 'sequential' → resolve TẤT CẢ refs (mỗi prompt chỉ dùng 1 ref → per-prompt
    //    luôn < maxRef, tổng refs có thể > maxRef nhưng OK).
    const maxRef = adapter.capabilities?.maxRefImages || 4;
    const isMentionMode = GenTab.refImageMode === 'mention';
    const isSequentialMode = GenTab.refImageMode === 'sequential';
    // [Fix 2026-06-11] 'none' mode: skip resolve refs entirely — đồng bộ Flow line 1781 (payloadFileIds=[])
    const isNoneMode = GenTab.refImageMode === 'none';
    const fileIdsToResolve = isNoneMode ? []
      : (isMentionMode || isSequentialMode) ? fileIds
      : fileIds.slice(0, maxRef);
    if (!isMentionMode && !isSequentialMode && !isNoneMode && fileIds.length > maxRef) {
      sendLog(`ChatGPT: vượt giới hạn ${maxRef} ảnh ref — chỉ gửi ${maxRef} ảnh đầu`, 'warn');
    }

    const refImagesCapped = [];
    const fidByResolvedIndex = []; // track fid theo index để mention filter map đúng
    for (const fid of fileIdsToResolve) {
      const fileName = GenTab.fileNameCache?.[fid] || `${fid}.png`;

      // LAZY UPLOAD: Nếu là pending upload (upload_xxx), lấy blob trực tiếp từ memory
      // → Không cần upload Flow → không cần fetch Flow URL
      if (fid.startsWith('upload_') && window.pendingUploadFiles?.has(fid)) {
        const pendingData = window.pendingUploadFiles.get(fid);
        const file = pendingData?.file;
        if (file) {
          try {
            // Dùng FileReader để tránh call stack overflow với file lớn
            const base64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result;
                const base64Part = dataUrl.split(',')[1];
                resolve(base64Part);
              };
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            });
            refImagesCapped.push({ base64, name: fileName, type: file.type || 'image/png' });
            fidByResolvedIndex.push(fid);
            console.log('[GenTab] ChatGPT: resolved ref từ pendingUploadFiles:', fid);
            continue;
          } catch (err) {
            console.warn('[GenTab] ChatGPT: lỗi convert pending file → base64:', fid, err.message);
          }
        }
      }

      // Fallback: Fetch từ thumbnail URL (cho tile_id đã có trên Flow)
      const thumb = GenTab.thumbnailCache?.[fid];
      if (!thumb) {
        console.warn('[GenTab] ChatGPT: skip ref ID không có thumbnail:', fid);
        continue;
      }
      try {
        const fetchResp = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'fetchBlob', url: thumb }, (r) => resolve(r));
        });
        if (fetchResp?.success && fetchResp.base64) {
          const m = fetchResp.base64.match(/^data:(.+?);base64,(.+)$/);
          if (m) {
            refImagesCapped.push({ base64: m[2], name: fileName, type: m[1] });
          } else {
            refImagesCapped.push({ base64: fetchResp.base64, name: fileName, type: 'image/png' });
          }
          fidByResolvedIndex.push(fid);
        } else {
          console.warn('[GenTab] ChatGPT: fetch ref blob thất bại:', fid, fetchResp?.error);
        }
      } catch (err) {
        console.warn('[GenTab] ChatGPT: lỗi fetch ref blob:', fid, err.message);
      }
    }

    // Mention mode pre-build: nameToFid map (lowercase slug → file_id)
    let mentionNameToFid = null;
    if (isMentionMode) {
      mentionNameToFid = {};
      for (const fid of fileIdsToResolve) {
        const slug = GenTab.refImageNames?.[fid];
        if (slug) mentionNameToFid[String(slug).toLowerCase()] = fid;
      }
    }

    // 4. Đọc settings cho timing giữa prompts
    // Phase 2c+: Server-Only — ExecutionConfig source of truth.
    const delayBetweenMs = (window.ExecutionConfig?.safeGetDelayBetweenPromptsSec?.() ?? 5) * 1000;
    const autoCloseTab = !!settingsObj.chatgptAutoClose;
    const deleteAfterGen = !!settingsObj.chatgptDeleteAfterGen;

    // Fix 7: đọc auto-download setting (af_settings.autoDownload + feature gate)
    // CG-7: ChatGPT CDN URL có signature TTL — fetch ngay khi nhận, không cache cross-run
    const autoDownloadToggle = document.getElementById('genTabAutoDownload');
    const autoDownloadEnabled = !!(autoDownloadToggle?.checked) && !!(window.featureGate?.canUse?.('auto_download'));
    const downloadSubFolder = (document.getElementById('genTabSubFolder')?.value || '').trim();
    // Fix 2026-05-22: settingsObj = af_settings raw → key đúng là `fileNameTemplate`
    // (legacy `downloadTemplate` luôn undefined → fallback default, ignore user setting).
    const downloadTemplate = settingsObj.fileNameTemplate || '[Date]_[Project]_[Prompt]_[Index]';
    const projectName = window._currentProjectName || 'flow';

    // 5. Loop từng prompt (sequential)
    let completed = 0;
    let failed = 0;
    let stopped = false;
    const allUrls = [];
    const failedPrompts = []; // Track failed prompts for retry modal

    // Tracker started
    if (window.eventBus) {
      // CRITICAL — emit lock_changed TRƯỚC tracker_update (giống Grok pattern).
      // Reset _pipelineMode flag stale từ session pipeline trước → tracker_update mới được apply.
      window.eventBus.emit('execution:lock_changed', {
        locked: true,
        owner: 'prompts',
        label: 'ChatGPT Gen',
      });
      window.eventBus.emit('execution:tracker_update', {
        owner: 'prompts',
        label: 'ChatGPT Gen',
        phase: 'started',
        current: 0,
        total: prompts.length,
        promptText: prompts[0] || ''
      });
    }

    // Rich tracker (giống Flow): states/closure broadcast pq:trackerUpdate → content script render multi-prompt.
    const _trkStates = prompts.map(() => 'PENDING');
    const _trkStart = Date.now();
    const _trk = (running) => GenTab._broadcastChatTracker('chatgpt', GenTab._buildChatTrackerData('ChatGPT Gen', prompts, _trkStates, _trkStart, running));
    _trk(true);

    for (let i = 0; i < prompts.length; i++) {
      // Kiểm tra stop flag (nếu có)
      if (GenTab._chatgptStopRequested) {
        stopped = true;
        break;
      }

      const prompt = prompts[i];
      if (window.eventBus) {
        window.eventBus.emit('execution:tracker_update', {
          owner: 'prompts',
          phase: 'prompt_submitting',
          current: i + 1,
          total: prompts.length,
          promptText: prompt
        });
      }
      _trkStates[i] = 'SUBMITTING'; _trk(true);

      try {
        // User pref pattern: caller settings → af_settings user pref → hardcoded last resort (Tier 3).
        // chatgptDefaultRatio + chatgptFallbackPrefix là user setting (settings-page DEFAULTS), không phải provider config.
        const _resolvedRatio = settings.ratio || settingsObj.chatgptDefaultRatio || 'story';
        const _resolvedPrefix = settingsObj.chatgptFallbackPrefix || 'Generate an image of: ';
        if (!settings.ratio && !settingsObj.chatgptDefaultRatio) {
          console.debug('[Tier3] ChatGPT submit: ratio source empty, hardcoded fallback "story"');
        }
        if (!settingsObj.chatgptFallbackPrefix) {
          console.debug('[Tier3] ChatGPT submit: chatgptFallbackPrefix empty, hardcoded fallback');
        }
        // Mention mode: filter refs theo @mention trong prompt hiện tại + cap maxRef.
        // Sequential mode: prompt[i] dùng ref[i % refs.length] (cycle nếu prompts > refs).
        // [Fix 2026-06-10] Add sequential branch — đồng bộ Flow pattern line 1987 (cycle modulo).
        let refsForThisPrompt = refImagesCapped;
        if (isMentionMode && mentionNameToFid) {
          const mentions = prompt.match(/@([\p{L}\p{N}_]+)/gu) || [];
          const matchedFids = new Set();
          for (const m of mentions) {
            const name = m.substring(1).toLowerCase();
            const fid = mentionNameToFid[name];
            if (fid) matchedFids.add(fid);
          }
          refsForThisPrompt = refImagesCapped.filter((_, idx) => matchedFids.has(fidByResolvedIndex[idx]));
          if (refsForThisPrompt.length > maxRef) {
            sendLog(`ChatGPT prompt ${i + 1}: ${refsForThisPrompt.length} mention vượt cap ${maxRef} — chỉ gửi ${maxRef} đầu`, 'warn');
            refsForThisPrompt = refsForThisPrompt.slice(0, maxRef);
          }
        } else if (isSequentialMode && refImagesCapped.length > 0) {
          // Sequential: prompt[i] dùng ref[i % refs.length] (cycle).
          // Vd 3 refs + 5 prompts → prompt 1=ref1, 2=ref2, 3=ref3, 4=ref1, 5=ref2.
          const refIdx = i % refImagesCapped.length;
          refsForThisPrompt = [refImagesCapped[refIdx]];
          console.log(`[GenTab] ChatGPT sequential: prompt ${i + 1}/${prompts.length} → ref index ${refIdx} (cycle modulo)`);
        }

        const result = await adapter.submit({
          prompt,
          refFileIds: refsForThisPrompt,
          settings: {
            ratio: _resolvedRatio,
            imageMode: true,
            fallbackPrefix: _resolvedPrefix,
            model: settings.model || settingsObj.chatgptModel || null, // Instant | Thinking
          },
          taskName: null
        });

        if (result?.success && Array.isArray(result.imageUrls) && result.imageUrls.length > 0) {
          completed += 1;
          allUrls.push(...result.imageUrls);
          _trkStates[i] = 'COMPLETED'; _trk(true);

          // Fix 7: Auto-download nếu setting bật.
          // ChatGPT URL CDN (estuary/content?id=file_xxx) có signature TTL ~vài giờ
          // → MUST fetch ngay khi detect, KHÔNG cache cross-run.
          if (autoDownloadEnabled && result.tabId) {
            for (let urlIdx = 0; urlIdx < result.imageUrls.length; urlIdx++) {
              const url = result.imageUrls[urlIdx];
              try {
                // Fetch CDN qua background.js (cookie session ChatGPT) → base64
                const fetchResp = await window.MessageBridge?.chatGPTFetchImage?.(url, result.tabId);
                if (fetchResp?.success && fetchResp.base64) {
                  // base64 đã là full data URL — convert → blob URL để chrome.downloads dùng
                  const blob = await (await fetch(fetchResp.base64)).blob();
                  const blobUrl = URL.createObjectURL(blob);
                  const filename = GenTab._buildChatGPTFilename(
                    downloadTemplate, projectName, prompt,
                    i + 1, urlIdx + 1,
                    downloadSubFolder, null,
                    settingsObj.downloadFolder // ← root folder từ user settings
                  );
                  // waitForComplete: đợi download ghi xong disk nếu deleteAfterGen enabled
                  const _dlUrl = await (window.scrubbedDownloadUrl?.(blobUrl) ?? blobUrl);
                  const dlResp = await new Promise((resolve) => {
                    chrome.runtime.sendMessage(
                      { action: 'chromeDownload', url: _dlUrl, filename, waitForComplete: deleteAfterGen },
                      (r) => resolve(r)
                    );
                  });
                  // Revoke blob URL sau khi download complete (hoặc sau 30s nếu không waitForComplete)
                  setTimeout(() => URL.revokeObjectURL(blobUrl), deleteAfterGen ? 5000 : 30000);
                  if (!dlResp?.success) {
                    sendLog(`ChatGPT download fail: ${dlResp?.error || 'unknown'}`, 'warn');
                  }
                } else {
                  sendLog(`ChatGPT fetchImage fail: ${fetchResp?.error || 'unknown'}`, 'warn');
                }
              } catch (dlErr) {
                console.warn('[GenTab] ChatGPT auto-download error:', dlErr);
              }
            }
          }

          if (window.eventBus) {
            window.eventBus.emit('prompt:completed', {
              prompt,
              media_type: 'image',
              // Model thật của chatgpt (Instant/Thinking) thay vì hardcode tên provider 'chatgpt'
              // → admin/generations hiển thị đúng model. provider='chatgpt' đã tách riêng bên dưới.
              model: GenTab.chatgptModelSelect?.value || 'chatgpt',
              ratio: settings.ratio || 'story',
              // Phase Analytics-3: ChatGPT loop từng prompt riêng → mỗi record là 1 prompt × 1 ảnh
              prompt_count: 1,
              quantity: result.imageUrls?.length || 1,
              ref_file_ids: fileIds.join(', '),
              result_file_ids: '',
              result_thumbnails: result.imageUrls.map(u => ({ thumbnail: u, type: 'image', file_name: '' })),
              result_file_names: {},
              source: 'gen', // SS-Phase G: source = module submit (gen tab), KHÔNG phải provider
              provider: 'chatgpt', // SS-Phase G: provider tách riêng
              project_id: window._currentProjectId || null,
              auto_download: !!autoDownloadEnabled
            });
          }

          // 2026-05-16: Notification cho từng prompt thành công
          sendLog(`ChatGPT prompt ${i + 1}/${prompts.length} ✓`, 'success');

          // 2026-05-16: Delete message after successful generation if setting enabled
          // Download đã waitForComplete nên không cần delay thêm
          if (deleteAfterGen && window.ChatGPTSession) {
            try {
              const deleteResp = await window.ChatGPTSession.deleteLastMessage();
              if (deleteResp?.success) {
                sendLog(`Đã xóa tin nhắn prompt ${i + 1}`, 'info');
              } else {
                console.warn('[GenTab] ChatGPT: xóa tin nhắn thất bại:', deleteResp?.error);
              }
            } catch (delErr) {
              console.warn('[GenTab] ChatGPT: lỗi khi xóa tin nhắn:', delErr.message);
            }
          }
        } else {
          failed += 1;
          _trkStates[i] = 'FAILED'; _trk(true);
          const errCode = result?.error || 'UNKNOWN';
          sendLog(`ChatGPT prompt ${i + 1} thất bại: ${errCode} - ${result?.message || 'unknown'}`, 'warn');

          // Track failed prompt for retry modal
          failedPrompts.push({ index: i, prompt, error: errCode });

          // Hiện notification đỏ cho các error types quan trọng
          if (['RATE_LIMIT', 'CONTENT_BLOCKED', 'IMAGE_GEN_FAILED', 'TEXT_ONLY', 'NETWORK', 'TIMEOUT', 'LIMIT_ALERT', 'CHALLENGE_TIMEOUT'].includes(errCode)) {
            GenTab._showProviderErrorNotification('chatgpt', errCode, result?.message);
          }

          // LIMIT_ALERT / RATE_LIMIT: ChatGPT đã hết quota image gen → break loop
          if (errCode === 'LIMIT_ALERT' || errCode === 'RATE_LIMIT') {
            sendLog('ChatGPT đã hết lượt tạo ảnh — dừng các prompt còn lại', 'error');
            stopped = true;
            // Track remaining prompts as failed
            for (let j = i + 1; j < prompts.length; j++) {
              failedPrompts.push({ index: j, prompt: prompts[j], error: errCode });
            }
            failed += (prompts.length - i - 1);
            break;
          }

          // CONTENT_BLOCKED: có thể retry 1 lần nhưng nếu vẫn fail thì dừng
          if (errCode === 'CONTENT_BLOCKED') {
            sendLog('ChatGPT: Nội dung bị chặn — prompt này bị skip', 'error');
            // Không break, tiếp tục prompt tiếp theo
          }
        }
      } catch (err) {
        failed += 1;
        _trkStates[i] = 'FAILED'; _trk(true);
        console.error('[GenTab] ChatGPT submit error:', err);
        sendLog(`ChatGPT prompt ${i + 1} lỗi: ${err.message || err}`, 'error');
        // Track failed prompt for retry modal
        failedPrompts.push({ index: i, prompt, error: err.message || 'EXCEPTION' });
      }

      // Delay giữa prompts (trừ prompt cuối)
      if (i < prompts.length - 1 && delayBetweenMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenMs));
      }
    }

    // 6. Auto-close tab nếu setting bật
    if (autoCloseTab && window.ChatGPTSession) {
      try {
        window.ChatGPTSession.closeTab();
      } catch (err) {
        console.warn('[GenTab] ChatGPT closeTab failed:', err);
      }
    }

    // Rich tracker: mark remaining (nếu stop) → CANCELLED + broadcast final (isRunning false → content auto-hide).
    if (stopped) { for (let k = 0; k < _trkStates.length; k++) if (_trkStates[k] === 'PENDING') _trkStates[k] = 'CANCELLED'; }
    _trk(false);

    // Tracker completed
    if (window.eventBus) {
      window.eventBus.emit('execution:tracker_update', {
        owner: 'prompts',
        phase: 'completed',
        current: prompts.length,
        total: prompts.length
      });
      // Release lock → ExecutionTracker tự hide qua _showCompletion → ẩn sau 3s
      window.eventBus.emit('execution:lock_changed', {
        locked: false,
        owner: 'prompts',
      });
      window.eventBus.emit('generation:complete', {
        message: window.I18n?.t?.('notification.browser.generationCompleteProvider', { provider: 'ChatGPT', completed, failed }) || `Hoàn tất ChatGPT: ${completed} thành công, ${failed} thất bại`,
        prompt: prompts[0] || '',
        resultCount: completed,
        failedCount: failed
      });
    }

    return { completed, failed, stopped, urls: allUrls, failedPrompts };
  }

  /**
   * G-4.6: Submit prompts qua Grok adapter (sequential per prompt — Grok không parallel được).
   * Mirror _submitViaChatGPT pattern. Khác biệt:
   *   - Dùng ProviderRegistry.get('grok')
   *   - Auto-download qua MessageBridge.grokFetchImage (Grok CDN có signature TTL)
   *   - Hỗ trợ video mode (settings.genType=Video)
   *   - Quantity 1/2/4 (Grok hỗ trợ quantity)
   *
   * @param {object} params - { prompts, fileIds, settings, settingsObj, executionToken }
   * @returns {Promise<{completed:number, failed:number, stopped:boolean, urls:string[]}>}
   */
  static async _submitViaGrok(params) {
    const prompts = params.prompts || [];
    const fileIds = params.fileIds || [];
    const settings = params.settings || {};
    const settingsObj = params.settingsObj || {};

    if (!window.ProviderRegistry) {
      throw new Error('ProviderRegistry chưa sẵn sàng');
    }
    const adapter = ProviderRegistry.get('grok');
    if (!adapter) {
      throw new Error('Grok adapter chưa được đăng ký');
    }

    // 1. ensureReady (sẽ tạo tab + check login). Nếu fail → emit grok:login_required và return
    try {
      const ready = await adapter.ensureReady();
      if (!ready?.ready) {
        if (window.eventBus) {
          window.eventBus.emit('grok:login_required', { error: ready?.error || 'NOT_LOGGED_IN' });
        }
        sendLog(`Grok: ${ready?.error || 'không sẵn sàng'}`, 'error');
        return { completed: 0, failed: prompts.length, stopped: false, urls: [] };
      }
    } catch (err) {
      console.error('[GenTab] Grok ensureReady failed:', err);
      if (window.eventBus) {
        window.eventBus.emit('grok:login_required', { error: err?.message });
      }
      return { completed: 0, failed: prompts.length, stopped: false, urls: [] };
    }

    // [Fix 2026-06-11] Block legacy "Grok không hỗ trợ sequential" đã bỏ.
    // Lý do: Tasks Grok (`_executeTaskViaGrok`) đã hỗ trợ sequential cycle modulo từ 2026-06-11
    // và GrokAdapter.submit() chấp nhận refFileIds khác nhau per-call. Block force-sequential→all
    // gây inconsistency giữa GenTab vs Tasks và làm user không test được sequential mode.

    // 3. Resolve refs: tile_id → base64 qua fetchBlob (giống pattern ChatGPT).
    //    Cap maxRefImages: mode 'all' → cap TRƯỚC fetch tiết kiệm network.
    //    Mode 'mention' → resolve TẤT CẢ refs (no cap) vì filter @mention per-prompt
    //    sẽ tự bound dưới maxRef. Tránh case mentioned image ở cuối danh sách bị
    //    truncate trước khi filter.
    //    Mode 'sequential' → resolve TẤT CẢ refs (mỗi prompt chỉ dùng 1 ref → per-prompt
    //    luôn < maxRef, tổng refs có thể > maxRef nhưng OK). [Fix 2026-06-11]
    //    Mode 'none' → KHÔNG resolve refs. [Fix 2026-06-11]
    const maxRef = adapter.capabilities?.maxRefImages || 4;
    const isMentionMode = GenTab.refImageMode === 'mention';
    const isSequentialMode = GenTab.refImageMode === 'sequential';
    const isNoneMode = GenTab.refImageMode === 'none';
    const fileIdsToResolve = isNoneMode ? []
      : (isMentionMode || isSequentialMode) ? fileIds
      : fileIds.slice(0, maxRef);
    if (!isMentionMode && !isSequentialMode && !isNoneMode && fileIds.length > maxRef) {
      sendLog(`Grok: vượt giới hạn ${maxRef} ảnh ref — chỉ gửi ${maxRef} ảnh đầu`, 'warn');
    }

    const refImagesResolved = [];
    const fidByResolvedIndex = []; // track fid theo index để mention filter map đúng
    for (const fid of fileIdsToResolve) {
      if (!fid) continue;
      const fileName = GenTab.fileNameCache?.[fid] || `${fid}.png`;

      // LAZY UPLOAD: Nếu là pending upload (upload_xxx), lấy blob trực tiếp từ memory
      if (fid.startsWith('upload_') && window.pendingUploadFiles?.has(fid)) {
        const pendingData = window.pendingUploadFiles.get(fid);
        const file = pendingData?.file;
        if (file) {
          try {
            // Dùng FileReader để tránh call stack overflow với file lớn
            const base64 = await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const dataUrl = reader.result;
                const base64Part = dataUrl.split(',')[1];
                resolve(base64Part);
              };
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(file);
            });
            refImagesResolved.push({ base64, name: fileName, type: file.type || 'image/png' });
            fidByResolvedIndex.push(fid);
            console.log('[GenTab] Grok: resolved ref từ pendingUploadFiles:', fid);
            continue;
          } catch (err) {
            console.warn('[GenTab] Grok: lỗi convert pending file → base64:', fid, err.message);
          }
        }
      }

      // Fallback: Fetch từ thumbnail URL (cho tile_id đã có trên Flow)
      const thumb = GenTab.thumbnailCache?.[fid];
      if (!thumb) {
        console.warn('[GenTab] Grok: skip ref ID không có thumbnail:', fid);
        continue;
      }
      try {
        const fetchResp = await new Promise((resolve) => {
          chrome.runtime.sendMessage({ action: 'fetchBlob', url: thumb }, (r) => resolve(r));
        });
        if (fetchResp?.success && fetchResp.base64) {
          const m = fetchResp.base64.match(/^data:(.+?);base64,(.+)$/);
          if (m) {
            refImagesResolved.push({ base64: m[2], name: fileName, type: m[1] });
          } else {
            refImagesResolved.push({ base64: fetchResp.base64, name: fileName, type: 'image/png' });
          }
          fidByResolvedIndex.push(fid);
        } else {
          console.warn('[GenTab] Grok: fetch ref blob thất bại:', fid, fetchResp?.error);
        }
      } catch (err) {
        console.warn('[GenTab] Grok: lỗi fetch ref blob:', fid, err.message);
      }
    }

    // Mention mode pre-build: nameToFid map (lowercase slug → file_id)
    let mentionNameToFid = null;
    if (isMentionMode) {
      mentionNameToFid = {};
      for (const fid of fileIdsToResolve) {
        const slug = GenTab.refImageNames?.[fid];
        if (slug) mentionNameToFid[String(slug).toLowerCase()] = fid;
      }
    }

    // 4. Resolve Grok-specific settings từ params + settingsObj defaults
    const grokRatio = settings.ratio || settingsObj.grokDefaultRatio || 'widescreen';
    const grokQuantity = settings.quantity || 1;
    const grokMode = settings.genType === 'Video'
      ? 'video'
      : (settingsObj.grokDefaultMode || 'image');
    // Đọc duration + resolution từ form fields (visible khi genType=Video).
    // Fallback về settingsObj defaults nếu form fields không có (graceful degradation).
    const grokDurationFormEl = document.getElementById('grokDuration');
    const grokResolutionFormEl = document.getElementById('grokResolution');
    const grokDuration = grokDurationFormEl?.value || settingsObj.grokDefaultDuration || '6s';
    const grokResolution = grokResolutionFormEl?.value || settingsObj.grokDefaultResolution || '720p';
    // Image quality (Grok update 2026-04): Speed/Quality. Đọc từ form GenTab nếu có,
    // fallback settingsObj default. Chỉ áp dụng khi mode=image.
    const grokImageQualityFormEl = document.getElementById('grokImageQuality');
    const grokImageQuality = grokImageQualityFormEl?.value || settingsObj.grokDefaultImageQuality || 'speed';

    // 5. Đọc timing + auto-download settings
    // Phase 2c+: Server-Only — ExecutionConfig source of truth.
    const delayBetweenMs = (window.ExecutionConfig?.safeGetDelayBetweenPromptsSec?.() ?? 5) * 1000;
    const autoCloseTab = !!settingsObj.grokAutoClose;

    const autoDownloadToggle = document.getElementById('genTabAutoDownload');
    const autoDownloadEnabled = !!(autoDownloadToggle?.checked) && !!(window.featureGate?.canUse?.('auto_download'));
    const downloadSubFolder = (document.getElementById('genTabSubFolder')?.value || '').trim();
    // Fix 2026-05-22: settingsObj = af_settings raw → key đúng là `fileNameTemplate`
    // (legacy `downloadTemplate` luôn undefined → fallback default, ignore user setting).
    const downloadTemplate = settingsObj.fileNameTemplate || '[Date]_[Project]_[Prompt]_[Index]';
    const projectName = window._currentProjectName || 'flow';

    // 6. Loop từng prompt (sequential — Grok 1 tab, không parallel)
    let completed = 0;
    let failed = 0;
    let stopped = false;
    const allUrls = [];
    const failedPrompts = [];

    if (window.eventBus) {
      // CRITICAL — emit lock_changed TRƯỚC tracker_update để force ExecutionTracker show.
      // Pipeline mode flag (_pipelineMode=true từ session pipeline trước) sẽ bị reset bởi
      // listener khi nhận lock_changed với owner='prompts' (line 131-133 ExecutionTracker.js).
      // Nếu skip step này → tracker_update bị ignore khi pipelineMode=true → user không thấy footer.
      window.eventBus.emit('execution:lock_changed', {
        locked: true,
        owner: 'prompts',
        label: 'Grok Gen',
      });
      window.eventBus.emit('execution:tracker_update', {
        owner: 'prompts',
        label: 'Grok Gen',
        phase: 'started',
        current: 0,
        total: prompts.length,
        promptText: prompts[0] || ''
      });
    }

    // Rich tracker (giống Flow): states/closure broadcast pq:trackerUpdate → content script render multi-prompt.
    const _trkStates = prompts.map(() => 'PENDING');
    const _trkStart = Date.now();
    const _trk = (running) => GenTab._broadcastChatTracker('grok', GenTab._buildChatTrackerData('Grok Gen', prompts, _trkStates, _trkStart, running));
    _trk(true);

    for (let i = 0; i < prompts.length; i++) {
      if (GenTab._grokStopRequested) {
        stopped = true;
        break;
      }

      const prompt = prompts[i];
      if (window.eventBus) {
        window.eventBus.emit('execution:tracker_update', {
          owner: 'prompts',
          phase: 'prompt_submitting',
          current: i + 1,
          total: prompts.length,
          promptText: prompt
        });
      }
      _trkStates[i] = 'SUBMITTING'; _trk(true);

      sendLog(`Grok ${i + 1}/${prompts.length}: ${prompt.substring(0, 50)}...`, 'info');

      // Mention mode: filter refs theo @mention trong prompt hiện tại + cap maxRef.
      // Sequential mode: prompt[i] dùng ref[i % refs.length] (cycle nếu prompts > refs).
      // None mode: refImagesResolved đã = [] từ resolve → default fallback work.
      // [Fix 2026-06-11] Add sequential branch — đồng bộ ChatGPT line 3880-3886.
      let refsForThisPrompt = refImagesResolved;
      if (isMentionMode && mentionNameToFid) {
        const mentions = prompt.match(/@([\p{L}\p{N}_]+)/gu) || [];
        const matchedFids = new Set();
        for (const m of mentions) {
          const name = m.substring(1).toLowerCase();
          const fid = mentionNameToFid[name];
          if (fid) matchedFids.add(fid);
        }
        refsForThisPrompt = refImagesResolved.filter((_, idx) => matchedFids.has(fidByResolvedIndex[idx]));
        if (refsForThisPrompt.length > maxRef) {
          sendLog(`Grok prompt ${i + 1}: ${refsForThisPrompt.length} mention vượt cap ${maxRef} — chỉ gửi ${maxRef} đầu`, 'warn');
          refsForThisPrompt = refsForThisPrompt.slice(0, maxRef);
        }
      } else if (isSequentialMode && refImagesResolved.length > 0) {
        // Sequential: prompt[i] dùng ref[i % refs.length] (cycle).
        // Vd 3 refs + 5 prompts → prompt 1=ref1, 2=ref2, 3=ref3, 4=ref1, 5=ref2.
        const refIdx = i % refImagesResolved.length;
        refsForThisPrompt = [refImagesResolved[refIdx]];
        console.log(`[GenTab] Grok sequential: prompt ${i + 1}/${prompts.length} → ref index ${refIdx} (cycle modulo)`);
      }

      try {
        const result = await adapter.submit({
          prompt,
          refFileIds: refsForThisPrompt,
          settings: {
            mode: grokMode,
            ratio: grokRatio,
            // Grok KHÔNG có quantity — không truyền vào adapter
            duration: grokDuration,
            resolution: grokResolution,
            imageQuality: grokImageQuality,
            timeout: 180000,
          },
          taskName: null,
        });

        if (result?.success && Array.isArray(result.mediaUrls) && result.mediaUrls.length > 0) {
          completed += 1;
          sendLog(`Grok prompt ${i + 1}/${prompts.length} ✓`, 'success');
          allUrls.push(...result.mediaUrls);
          _trkStates[i] = 'COMPLETED'; _trk(true);

          // Auto-download: ưu tiên `fetchedMedia` (base64 pre-fetched trong content script — Option C
          // 2026-06-03, tránh race với redirect /saved). Fallback grokFetchImage cho backward-compat
          // nếu handler cũ không trả fetchedMedia.
          if (autoDownloadEnabled) {
            for (let urlIdx = 0; urlIdx < result.mediaUrls.length; urlIdx++) {
              const url = result.mediaUrls[urlIdx];
              try {
                // Filename build TRƯỚC fetch — dùng chung cho blob-download (Tier 1/2) lẫn
                // direct-URL-download (Tier 3), không phụ thuộc kết quả fetch.
                const ext = (result.mediaType === 'video' || grokMode === 'video') ? 'mp4' : 'png';
                let filename = GenTab._buildChatGPTFilename(
                  downloadTemplate, projectName, prompt,
                  i + 1, urlIdx + 1,
                  downloadSubFolder, null,
                  settingsObj.downloadFolder // ← root folder từ user settings
                );
                if (ext !== 'png') {
                  filename = filename.replace(/\.png$/i, `.${ext}`);
                }

                // 3-tier download (helper chung): Tier 1 prefetch → Tier 2 grokFetchImage → Tier 3 direct URL.
                const _pre = result.fetchedMedia?.find(f => f.url === url)?.base64 || null;
                const dl = (await window.MessageBridge?.grokDownloadMedia?.(url, result.tabId, filename, _pre))
                  || { success: false, tier: 0, error: 'MessageBridge unavailable' };
                if (!dl.success) sendLog(`Grok download fail (Tier ${dl.tier}): ${dl.error || 'unknown'}`, 'warn');
                else if (dl.tier === 3) sendLog(`Grok download OK (Tier 3 direct URL)`, 'success');
              } catch (dlErr) {
                console.warn('[GenTab] Grok auto-download error:', dlErr);
              }
            }
          }

          if (window.eventBus) {
            window.eventBus.emit('prompt:completed', {
              prompt,
              media_type: (result.mediaType === 'video' || grokMode === 'video') ? 'video' : 'image',
              model: 'grok',
              ratio: grokRatio,
              // Phase Analytics-3: Grok loop từng prompt → mỗi record là 1 prompt × N ảnh (1/2/4 image, 1 video)
              prompt_count: 1,
              quantity: result.mediaUrls?.length || 1,
              ref_file_ids: fileIds.join(', '),
              result_file_ids: '',
              result_thumbnails: result.mediaUrls.map(u => ({
                thumbnail: u,
                type: (result.mediaType === 'video' || grokMode === 'video') ? 'video' : 'image',
                file_name: ''
              })),
              result_file_names: {},
              source: 'gen', // SS-Phase G: source = module (gen tab), provider tách riêng
              provider: 'grok',
              project_id: window._currentProjectId || null,
              auto_download: !!autoDownloadEnabled
            });
          }
        } else {
          failed += 1;
          _trkStates[i] = 'FAILED'; _trk(true);
          const errCode = result?.error || 'UNKNOWN';
          sendLog(`Grok prompt ${i + 1}: ${errCode} - ${result?.message || 'failed'}`, 'error');
          failedPrompts.push({ index: i, prompt, error: errCode });

          // Hiện notification đỏ cho các error types quan trọng
          if (['RATE_LIMIT', 'CONTENT_BLOCKED', 'IMAGE_GEN_FAILED', 'TEXT_ONLY', 'NETWORK', 'TIMEOUT', 'SUBSCRIPTION_REQUIRED', 'CHALLENGE_TIMEOUT'].includes(errCode)) {
            GenTab._showProviderErrorNotification('grok', errCode, result?.message);
          }

          // SUBSCRIPTION_REQUIRED: stop loop
          if (errCode === 'SUBSCRIPTION_REQUIRED') {
            if (window.eventBus) {
              window.eventBus.emit('grok:subscription_required', { error: errCode, message: result?.message });
            }
            stopped = true;
            failed += (prompts.length - i - 1);
            // Track remaining prompts as failed
            for (let j = i + 1; j < prompts.length; j++) {
              failedPrompts.push({ index: j, prompt: prompts[j], error: 'SUBSCRIPTION_REQUIRED' });
            }
            break;
          }

          // RATE_LIMIT: stop loop
          if (errCode === 'RATE_LIMIT') {
            sendLog('Grok đã hết lượt — dừng các prompt còn lại', 'error');
            stopped = true;
            failed += (prompts.length - i - 1);
            // Track remaining prompts as failed
            for (let j = i + 1; j < prompts.length; j++) {
              failedPrompts.push({ index: j, prompt: prompts[j], error: 'RATE_LIMIT' });
            }
            break;
          }
        }
      } catch (err) {
        failed += 1;
        _trkStates[i] = 'FAILED'; _trk(true);
        console.error('[GenTab] Grok submit error:', err);
        sendLog(`Grok prompt ${i + 1} exception: ${err?.message || err}`, 'error');
        failedPrompts.push({ index: i, prompt, error: err?.message || 'EXCEPTION' });
      }

      // Delay anti rate-limit giữa prompts (trừ prompt cuối)
      if (i < prompts.length - 1 && delayBetweenMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenMs));
      }
    }

    // 7. Auto-close tab nếu setting bật
    if (autoCloseTab && window.GrokSession) {
      try {
        await window.GrokSession.closeTab();
      } catch (err) {
        console.warn('[GenTab] Grok closeTab failed:', err);
      }
    }

    // Rich tracker: mark remaining (nếu stop) → CANCELLED + broadcast final (isRunning false → content auto-hide).
    if (stopped) { for (let k = 0; k < _trkStates.length; k++) if (_trkStates[k] === 'PENDING') _trkStates[k] = 'CANCELLED'; }
    _trk(false);

    // Tracker completed
    if (window.eventBus) {
      window.eventBus.emit('execution:tracker_update', {
        owner: 'prompts',
        phase: 'completed',
        current: prompts.length,
        total: prompts.length
      });
      // Release lock → ExecutionTracker tự hide qua _showCompletion → ẩn sau 3s
      window.eventBus.emit('execution:lock_changed', {
        locked: false,
        owner: 'prompts',
      });
      window.eventBus.emit('generation:complete', {
        message: window.I18n?.t?.('notification.browser.generationCompleteProvider', { provider: 'Grok', completed, failed }) || `Hoàn tất Grok: ${completed} thành công, ${failed} thất bại`,
        prompt: prompts[0] || '',
        resultCount: completed,
        failedCount: failed
      });
    }

    return { completed, failed, stopped, urls: allUrls, failedPrompts };
  }


  static _destroyThumbObserver() {
    if (GenTab._thumbObserver) {
      GenTab._thumbObserver.disconnect();
      GenTab._thumbObserver = null;
    }
  }

  // ─── MutationObserver callback ────────────────────────────
  static checkMissingThumbnails() {
    if (!GenTab.fileIdThumbnails) return;
    const missingThumbs = GenTab.fileIdThumbnails.querySelectorAll('div[data-missing-id]');
    if (missingThumbs.length === 0) return;

    let needSave = false;
    missingThumbs.forEach(container => {
      const id = container.getAttribute('data-missing-id');
      const tileNode = document.querySelector(`div[data-tile-id="${id}"]`);
      if (tileNode) {
        let thumbSrc = '';
        const imgEl = tileNode.querySelector('img');
        thumbSrc = imgEl ? imgEl.src : '';
        if (!thumbSrc) {
          const vidEl = tileNode.querySelector('video');
          if (vidEl) thumbSrc = vidEl.poster || '';
        }
        if (thumbSrc) {
          GenTab.thumbnailCache[id] = thumbSrc;
          needSave = true;
        }
      }
    });

    if (needSave) {
      GenTab.saveState();
      GenTab.renderFileIdThumbnails();
    }
  }

  // ─── Reset Running Controls ─────────────────────────────────
  static _resetRunningControls() {
    if (GenTab.startBtn) {
      GenTab.startBtn.disabled = false;
    }
    if (GenTab.genBtnRow) {
      GenTab.genBtnRow.classList.remove('is-running');
    }
    if (GenTab.genRunningControls) {
      GenTab.genRunningControls.classList.add('hidden');
    }
    // Re-check upload state (có thể vẫn đang upload ref images)
    GenTab._updateGenBtnUploadState();
  }

  // ─── Update Generate Button based on Upload State ─────────────
  static _updateGenBtnUploadState() {
    if (!GenTab.startBtn) return;

    const hasUploading = window.ImmediateUploader?.hasAnyUploading?.() || false;
    // CRITICAL — provider submit running flag (ChatGPT/Grok). Khi Pipeline ON, ExecutionLock
    // KHÔNG acquire cho non-Flow providers → isBlockedBy() = false → button bị enable lại
    // mid-gen khi upload event fire. Flag này giữ button disabled đến khi submit hoàn tất.
    const isProviderRunning = !!GenTab._providerSubmitRunning;

    const btnLabelSpan = GenTab.startBtn.querySelector('span');

    if (hasUploading || isProviderRunning) {
      GenTab.startBtn.disabled = true;
      GenTab.startBtn.title = isProviderRunning
        ? (window.I18n?.t('gen.generating') || 'Đang tạo...')
        : (window.I18n?.t('gen.uploadingRefTitle') || 'Uploading ref images...');
      // Change button text while uploading
      if (hasUploading && btnLabelSpan && !isProviderRunning) {
        if (!GenTab._savedBtnLabel) {
          GenTab._savedBtnLabel = btnLabelSpan.textContent;
        }
        btnLabelSpan.textContent = window.I18n?.t('gen.uploadingImages') || 'Đang upload...';
      }
    } else {
      // Chỉ enable nếu không bị lock bởi execution khác
      const isLocked = window.ExecutionLock?.isBlockedBy?.('prompts');
      if (!isLocked) {
        GenTab.startBtn.disabled = false;
        GenTab.startBtn.title = '';
      }
      // Restore button text after upload complete
      if (btnLabelSpan && GenTab._savedBtnLabel) {
        btnLabelSpan.textContent = GenTab._savedBtnLabel;
        GenTab._savedBtnLabel = null;
      }
    }

    // Update upload button state
    GenTab._updateUploadBtnState(hasUploading);
  }

  // ─── Update Upload Button Uploading State ─────────────
  static _updateUploadBtnState(isUploading) {
    const uploadBtn = document.getElementById('openImagePickerBtn');
    if (!uploadBtn) return;

    if (isUploading) {
      uploadBtn.classList.add('uploading');
    } else {
      uploadBtn.classList.remove('uploading');
    }
  }

  // ─── Failed Prompts Panel ─────────────────────────────────
  static _failedPromptsList = [];

  // Port 1.1.58: strip addon-prompt đã ghép lúc submit (`${prompt}, ${addon.content}` — line ~1593)
  // khỏi prompt lưu ở item.prompt → retry chỉ nạp lại PROMPT GỐC, không nối addon LẦN 2 (trùng).
  // Quét cả addon đang chọn + mọi addon cache (phòng user đổi addon giữa submit/retry).
  static _stripAddon(p) {
    if (typeof p !== 'string') return p;
    const contents = [];
    const sel = GenTab._getSelectedAddonPrompt?.();
    if (sel?.content) contents.push(sel.content);
    for (const a of (GenTab.addonPrompts || [])) {
      if (a?.content && !contents.includes(a.content)) contents.push(a.content);
    }
    for (const c of contents) {
      const suffix = `, ${c}`;
      if (p.endsWith(suffix)) return p.slice(0, -suffix.length);
    }
    return p;
  }

  static _showFailedPrompts(failedList) {
    const section = document.getElementById('failedPromptsSection');
    const list = document.getElementById('failedPromptsList');
    const countEl = document.getElementById('failedPromptsCount');
    if (!section || !list) return;

    // Store failed prompts for retry
    GenTab._failedPromptsList = failedList;

    section.classList.remove('hidden');
    if (countEl) countEl.textContent = failedList.length;

    list.innerHTML = failedList.map((item, i) => `
      <div class="failed-prompt-item">
        <div class="failed-prompt-info">
          <span class="failed-prompt-index">#${item.index + 1}</span>
          <span class="failed-prompt-error">${GenTab._escapeHtml(item.error)}</span>
        </div>
        <div class="failed-prompt-text">${GenTab._escapeHtml(item.prompt)}</div>
        <button class="btn btn-secondary btn-sm failed-prompt-copy" data-prompt="${GenTab._escapeAttr(item.prompt)}" data-tooltip="Sao chép prompt" aria-label="Sao chép prompt">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
        </button>
      </div>
    `).join('');

    // Bind copy buttons
    list.querySelectorAll('.failed-prompt-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = btn.dataset.prompt;
        navigator.clipboard.writeText(prompt).then(() => {
          btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
          setTimeout(() => {
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
          }, 1500);
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('GenTab#t', _e); });
      });
    });
  }

  static _clearFailedPrompts() {
    const section = document.getElementById('failedPromptsSection');
    const list = document.getElementById('failedPromptsList');
    if (section) section.classList.add('hidden');
    if (list) list.innerHTML = '';
    GenTab._failedPromptsList = [];
    if (typeof MessageBridge !== 'undefined') MessageBridge.clearFailedPrompts().catch(function (_e) { globalThis.SEOSONA_swallow?.('GenTab#t', _e); });
  }

  /**
   * Retry all failed prompts - insert them into textarea and enable multi-prompt mode
   */
  static _retryFailedPrompts() {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    const failedList = GenTab._failedPromptsList || [];

    if (failedList.length === 0) {
      window.showNotification?.(t('gen.noFailedPrompts', 'Không có prompt lỗi để chạy lại'), 'info');
      return;
    }

    // Get unique prompts (in case same prompt failed multiple times)
    const uniquePrompts = [...new Set(failedList.map(item => GenTab._stripAddon(item.prompt)))];

    // Get textarea
    const textarea = GenTab.promptsArea || document.getElementById('promptsArea');
    if (!textarea) {
      console.error('[GenTab] Prompt textarea not found');
      return;
    }

    // If multiple prompts, enable multi-prompt mode
    if (uniquePrompts.length > 1) {
      const multiPromptCheck = document.getElementById('multiPromptCheck');
      if (multiPromptCheck && !multiPromptCheck.checked) {
        multiPromptCheck.checked = true;
        multiPromptCheck.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // Show hint if exists
      const multiPromptHint = document.getElementById('multiPromptHint');
      if (multiPromptHint) {
        multiPromptHint.classList.remove('hidden');
      }
    }

    // Join prompts with empty line separator
    const promptText = uniquePrompts.join('\n\n');

    // Insert into textarea
    textarea.value = promptText;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    // Auto-resize textarea
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 300) + 'px';

    // Clear failed prompts panel
    GenTab._clearFailedPrompts();

    // Scroll to textarea
    textarea.scrollIntoView({ behavior: 'smooth', block: 'center' });
    textarea.focus();

    // Show notification
    const msg = uniquePrompts.length > 1
      ? t('gen.failedPromptsInserted', `Đã chèn ${uniquePrompts.length} prompt lỗi vào ô nhập. Bấm Generate để chạy lại.`)
      : t('gen.failedPromptInserted', 'Đã chèn prompt lỗi vào ô nhập. Bấm Generate để chạy lại.');
    window.showNotification?.(msg.replace('${count}', uniquePrompts.length), 'success');
  }

  /**
   * Show summary modal after execution completes with failed prompts
   */
  static async _showFailedPromptsSummaryModal(failedList, totalCount, completedCount) {
    const t = (key, fallback) => window.I18n?.t(key) || fallback;

    if (!failedList || failedList.length === 0) return;
    if (!window.customDialog) return;

    const failedCount = failedList.length;
    const uniquePrompts = [...new Set(failedList.map(item => GenTab._stripAddon(item.prompt)))];

    const message = t('gen.executionSummary', `Hoàn thành: ${completedCount}/${totalCount}\nThất bại: ${failedCount} prompt`)
      .replace('${completed}', completedCount)
      .replace('${total}', totalCount)
      .replace('${failed}', failedCount);

    const confirmed = await window.customDialog.confirm(
      message + '\n\n' + t('gen.retryFailedQuestion', 'Bạn có muốn chạy lại các prompt bị lỗi không?'),
      {
        title: t('gen.executionComplete', 'Hoàn thành'),
        type: failedCount > 0 ? 'warning' : 'success',
        confirmText: t('gen.retryFailed', 'Chạy lại'),
        cancelText: t('common.close', 'Đóng')
      }
    );

    if (confirmed) {
      GenTab._retryFailedPrompts();
    }
  }

  /**
   * Hiển thị popup gợi ý upgrade khi user không có quyền auto-retry
   * Thông tin plan/feature lấy từ FeatureGate (API), không hardcode
   */
  static async _showRetryUpsell(failCount) {
    if (!failCount || failCount <= 0) return;

    // Chỉ hiện khi user KHÔNG có quyền retry
    const fg = window.featureGate;
    if (!fg) return;
    const canRetry = fg.canUse('retry_on_fail');
    if (canRetry) return;

    // Lấy thông tin plan từ FeatureGate (đã cache từ API)
    const planName = fg.plan?.name || 'Free';

    if (!window.customDialog) return;

    const confirmed = await window.customDialog.confirm(
      window.I18n?.t('genNotifyExtra.retryUpsellMsg', { count: failCount, plan: planName }) ||
        (`${failCount} prompt bị lỗi trong lần chạy vừa rồi.\n\n` +
        `Gói "${planName}" hiện tại chưa bao gồm tính năng Auto Retry.\n` +
        `Nâng cấp để tự động thử lại các prompt bị lỗi.`),
      {
        title: window.I18n?.t('genNotifyExtra.retryUpsellTitle') || 'Auto Retry',
        type: 'info',
        confirmText: window.I18n?.t('common.upgrade') || 'Nâng cấp',
        cancelText: window.I18n?.t('genNotifyExtra.retryUpsellLater') || 'Để sau'
      }
    );

    if (confirmed) {
      // Mở settings/upgrade
      chrome.runtime.sendMessage({ action: 'openSettings' });
    }
  }

  static _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  static _escapeAttr(text) {
    return String(text || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;');
  }

  /**
   * S2.5: Sync upload_xxx key → real tile_id sau khi ImmediateUploader hoàn thành
   * @param {Object} data - {key, tile_id, file_name, thumbnail_url}
   */
  static _syncUploadKeyToTileId(data) {
    const { key, tile_id, file_name, thumbnail_url } = data;
    if (!key || !tile_id) return;

    // 1. Swap trong fileIdsInput.value
    if (GenTab.fileIdsInput) {
      const ids = GenTab.fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
      const idx = ids.indexOf(key);
      if (idx !== -1) {
        ids[idx] = tile_id;
        GenTab.fileIdsInput.value = ids.join(', ');
      }
    }

    // 2. Transfer thumbnailCache
    if (GenTab.thumbnailCache[key]) {
      GenTab.thumbnailCache[tile_id] = GenTab.thumbnailCache[key];
      delete GenTab.thumbnailCache[key];
    }
    // Update thumbnail from upload result nếu có
    if (thumbnail_url) {
      GenTab.thumbnailCache[tile_id] = thumbnail_url;
    }

    // 3. Transfer fileNameCache
    if (file_name) {
      GenTab.fileNameCache[tile_id] = file_name;
    }
    delete GenTab.fileNameCache[key];

    // 4. Transfer refImageNames
    if (GenTab.refImageNames[key]) {
      GenTab.refImageNames[tile_id] = GenTab.refImageNames[key];
      delete GenTab.refImageNames[key];
    }

    // 5. Cleanup pendingUploadFiles
    window.pendingUploadFiles?.delete(key);

    // Cleanup ImmediateUploader results (tranh memory leak)
    if (window.ImmediateUploader) {
      ImmediateUploader._results.delete(key);
      ImmediateUploader._fileRefs.delete(key);
    }

    // 6. Cache trong TileCache
    if (window.TileCache) {
      if (file_name) window.TileCache.set(file_name, tile_id);
      if (thumbnail_url) window.TileCache.set(thumbnail_url, tile_id);
    }

    // 7. Re-render + save
    GenTab.renderFileIdThumbnails();
    GenTab.saveState();

    console.log(`[GenTab] Synced upload key → tile_id: ${key.substring(0, 15)}... → ${tile_id.substring(0, 15)}...`);
  }

  // ─── Thêm ref image dạng upload (lazy) — public API cho Prompt Assistant ───
  // items: [{ file: File, thumbnail?, type? }]. Mirror nhánh 'upload' của picker onConfirm.
  // Trả số ảnh đã thêm.
  static addUploadRefImages(items) {
    if (!GenTab.fileIdsInput || !Array.isArray(items) || !items.length) return 0;
    if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
    const existingIds = GenTab.fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const newIds = [];
    for (const it of items) {
      if (!it || !it.file) continue;
      const key = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
      window.pendingUploadFiles.set(key, { file: it.file, thumbnail: it.thumbnail });
      newIds.push(key);
      GenTab.refMediaTypes = GenTab.refMediaTypes || {};
      GenTab.refMediaTypes[key] = (it.type && String(it.type).startsWith('video')) ? 'video' : 'image';
    }
    if (!newIds.length) return 0;
    const merged = [...new Set([...existingIds, ...newIds])];
    GenTab.fileIdsInput.value = merged.join(', ');
    GenTab.fileIdsInput.dispatchEvent(new Event('input', { bubbles: true }));
    const existingCount = Object.keys(GenTab.refImageNames || {}).length;
    let idx = 0;
    GenTab.refImageNames = GenTab.refImageNames || {};
    newIds.forEach((id) => { if (!GenTab.refImageNames[id]) { idx++; GenTab.refImageNames[id] = `image_${existingCount + idx}`; } });
    try { GenTab.renderFileIdThumbnails(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#t', _); }
    return newIds.length;
  }

  // Nạp 1 tile ảnh (Flow/album) vào ref-images rồi (mặc định) chuyển sang tab Gen.
  // Tier-1 C-2: gom mutation ref-image vào GenTab — tab khác gọi API này thay vì thọc thẳng
  // vào GenTab.thumbnailCache/fileIdsInput. Body bê NGUYÊN VĂN từ PhotosTab._useFlowImage +
  // AlbumList (behavior-preserving). switchToGen=false nếu chỉ muốn nạp không đổi tab.
  static addRefTile(tile, { switchToGen = true } = {}) {
    if (!tile || !tile.id) return;
    if (!GenTab.thumbnailCache) GenTab.thumbnailCache = {};
    if (tile.thumbnail) GenTab.thumbnailCache[tile.id] = tile.thumbnail;
    if (GenTab.fileIdsInput) {
      const current = GenTab.fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
      if (!current.includes(tile.id)) {
        current.push(tile.id);
        GenTab.fileIdsInput.value = current.join(', ');
        GenTab.fileIdsInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    GenTab.renderFileIdThumbnails();
    GenTab.saveState();
    if (switchToGen) window.SidebarManager?.switchTo?.('tab-gen');
  }

  // Ghi metadata ref-image (thumbnail/fileName/name) vào cache của GenTab qua API.
  // Tier-1 C-2: thay cho việc tab khác ghi thẳng GenTab.thumbnailCache/fileNameCache/refImageNames.
  // LUÔN init cả 3 cache trước (khớp init vô điều kiện ở code cũ), rồi chỉ set giá trị truthy →
  // gọi setRefImageMeta(id, meta) vô điều kiện = tương đương NGUYÊN VĂN block cũ.
  static setRefImageMeta(id, { thumbnail, fileName, name } = {}) {
    GenTab.thumbnailCache = GenTab.thumbnailCache || {};
    GenTab.fileNameCache = GenTab.fileNameCache || {};
    GenTab.refImageNames = GenTab.refImageNames || {};
    if (!id) return;
    if (thumbnail) GenTab.thumbnailCache[id] = thumbnail;
    if (fileName) GenTab.fileNameCache[id] = fileName;
    if (name) GenTab.refImageNames[id] = name;
  }

  // Xoá metadata ref-image (thumbnail+fileName) cho danh sách id — dùng khi clear ref images.
  // Tier-1 C-2: thay cho việc tab khác delete thẳng GenTab.thumbnailCache/fileNameCache[id].
  static clearRefImageMeta(ids) {
    if (!Array.isArray(ids)) return;
    for (const id of ids) {
      if (GenTab.thumbnailCache) delete GenTab.thumbnailCache[id];
      if (GenTab.fileNameCache) delete GenTab.fileNameCache[id];
    }
  }

  // Dời tên @mention (refImageNames) từ oldKey (temp upload key) sang newKey (tile_id thật) khi
  // upload xong. Tier-1 C-2: thay cho FileUploader/ImmediateUploader remap thẳng refImageNames.
  // Guard truthy khớp `if (refImageNames?.[oldKey])` cũ. Trả oldName để caller log (nếu cần).
  static remapRefImageName(oldKey, newKey) {
    const names = GenTab.refImageNames;
    if (!names || !oldKey || !newKey) return null;
    const oldName = names[oldKey];
    if (oldName) {
      names[newKey] = oldName;
      delete names[oldKey];
      return oldName;
    }
    return null;
  }

  // ─── Render preview thumbnails cho File IDs ───────────────
  static renderFileIdThumbnails() {
    if (!GenTab.fileIdsInput || !GenTab.fileIdThumbnails) return;

    const currentIds = GenTab.fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const countEl = document.getElementById('refImagesCount');

    if (currentIds.length === 0) {
      GenTab.fileIdThumbnails.innerHTML = '';
      const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;
      if (countEl) { countEl.textContent = t('gen.refCountZero'); countEl.classList.add('hidden'); }
      // Ẩn save-album button khi không còn ref_img (early return path).
      // _renderFileIdThumbnailsInner toggle button cho path có images, path này phải ẩn riêng.
      const albumBtn = document.getElementById('saveToAlbumBtn');
      if (albumBtn) albumBtn.classList.add('hidden');
      return;
    }

    // Check if any non-cached, non-pending IDs need remote fetch (sidePanel can't access Flow DOM)
    const needsRemote = currentIds.some(id => {
      if (id.startsWith('upload_')) return false;
      if (GenTab.thumbnailCache[id]) return false;
      return document.querySelectorAll(`[data-tile-id="${id}"]`).length === 0;
    });

    if (needsRemote && typeof MessageBridge !== 'undefined') {
      MessageBridge.scanFlowImages().then(result => {
        const images = result?.images || result || [];
        for (const img of images) {
          if (img.fileId && img.thumbnail && !GenTab.thumbnailCache[img.fileId]) {
            GenTab.thumbnailCache[img.fileId] = img.thumbnail;
          }
          // Capture file_name (UUID) for tile ID correction after reload
          if (img.fileId && img.file_name && !GenTab.fileNameCache[img.fileId]) {
            GenTab.fileNameCache[img.fileId] = img.file_name;
          }
        }
        GenTab._renderFileIdThumbnailsInner(currentIds, countEl);
      }).catch(() => {
        GenTab._renderFileIdThumbnailsInner(currentIds, countEl);
      });
      return;
    }

    GenTab._renderFileIdThumbnailsInner(currentIds, countEl);
  }

  static _renderFileIdThumbnailsInner(currentIds, countEl) {
    GenTab.fileIdThumbnails.innerHTML = '';
    GenTab.fileIdThumbnails.className = 'ref-grid';
    let uiChangedCache = false;

    // S11.2: Cleanup orphan names - keep only names for current file IDs
    const currentIdSet = new Set(currentIds);
    Object.keys(GenTab.refImageNames).forEach(fileId => {
      if (!currentIdSet.has(fileId)) {
        delete GenTab.refImageNames[fileId];
      }
    });

    const isMentionMode = GenTab.refImageMode === 'mention';
    const isSequentialMode = GenTab.refImageMode === 'sequential';
    const refLimit = GenTab.getRefLimit();

    currentIds.forEach((id, index) => {
      const isExceeded = index >= refLimit;
      let thumbSrc = GenTab.thumbnailCache[id] || '';
      const isPending = id.startsWith('upload_');

      // Ảnh pending: lấy thumbnail từ cache
      if (!thumbSrc && isPending) {
        const pending = window.pendingUploadFiles?.get(id);
        if (pending?.thumbnail) thumbSrc = pending.thumbnail;
      }

      if (!thumbSrc && !isPending) {
        const tileNodes = document.querySelectorAll(`[data-tile-id="${id}"]`);
        for (const tileNode of tileNodes) {
          const imgEl = tileNode.querySelector('img');
          if (imgEl?.src) { thumbSrc = imgEl.src; break; }
          const vidEl = tileNode.querySelector('video');
          if (vidEl?.poster) { thumbSrc = vidEl.poster; break; }
        }
        if (thumbSrc) {
          GenTab.thumbnailCache[id] = thumbSrc;
          uiChangedCache = true;
        }
      }

      // Get/set name for this image - check pending upload name as fallback
      let name = GenTab.refImageNames[id];
      if (!name && isPending) {
        const pending = window.pendingUploadFiles?.get(id);
        if (pending?.name) {
          name = pending.name;
        }
      }
      if (!name) {
        name = `img_${index + 1}`;
      }
      // Always update refImageNames to ensure sync
      GenTab.refImageNames[id] = name;

      // Create wrapper for mention mode (includes name below)
      let itemEl;
      if (isMentionMode) {
        itemEl = document.createElement('div');
        itemEl.className = 'ref-item';
        itemEl.dataset.refId = id;
      }

      // Create thumbnail
      const isUploading = isPending && window.ImmediateUploader?.isUploading(id);
      const thumbContainer = document.createElement('div');
      thumbContainer.className = `ref-thumb ${isPending ? 'ref-thumb-pending' : ''} ${isUploading ? 'ref-thumb-uploading' : ''} ${isExceeded ? 'ref-thumb-exceeded' : ''}`;
      thumbContainer.dataset.refId = id;
      thumbContainer.dataset.index = String(index + 1);

      if (isExceeded) {
        thumbContainer.title = `Vượt giới hạn (tối đa ${refLimit} ảnh) — sẽ không được gửi kèm prompt`;
      } else if (isMentionMode) {
        thumbContainer.title = `Click để sửa tên`;
        thumbContainer.style.cursor = 'pointer';
        thumbContainer.addEventListener('click', (e) => {
          if (e.target.classList.contains('ref-thumb-remove')) return;
          GenTab._editRefImageName(id, GenTab.refImageNames[id] || name);
        });
      } else {
        thumbContainer.title = isPending ? `Local: ${id}` : `Ảnh ${index + 1}`;
      }

      // Inner wrapper — chứa img + pending badge để pseudo ::before/::after của
      // .ref-thumb-uploading > div:first-child áp dụng đúng (cùng pattern workflow.css)
      const innerWrap = document.createElement('div');
      innerWrap.className = 'ref-thumb-inner';
      thumbContainer.appendChild(innerWrap);

      // Thumbnail render: video tile → <video preload=metadata> (Flow URL trả mp4,
      // <img> ko render được). Image tile → <img>.
      const isVideoRef = GenTab.refMediaTypes?.[id] === 'video';
      const refVideoUrl = GenTab.refVideoUrls?.[id] || '';
      if (isVideoRef && refVideoUrl) {
        const video = document.createElement('video');
        video.src = refVideoUrl;
        video.muted = true;
        video.preload = 'metadata';
        video.playsInline = true;
        video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;background:#0c1320;';
        video.addEventListener('loadedmetadata', () => { try { video.currentTime = 0.1; } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#t', _); } }, { once: true });
        innerWrap.appendChild(video);
      } else if (thumbSrc) {
        const img = document.createElement('img');
        img.src = thumbSrc;
        img.alt = '';
        innerWrap.appendChild(img);
      } else {
        thumbContainer.setAttribute('data-missing-id', id);
        const placeholder = document.createElement('span');
        placeholder.textContent = index + 1;
        placeholder.style.cssText = 'font-size: 14px; color: var(--muted-foreground);';
        innerWrap.appendChild(placeholder);
      }

      // Pending badge (CSS ẩn khi uploading)
      if (isPending) {
        const badge = document.createElement('div');
        badge.className = 'ref-thumb-badge';
        badge.textContent = 'Local';
        innerWrap.appendChild(badge);
      }

      // Remove button (CSS ẩn khi uploading)
      const removeBtn = document.createElement('div');
      removeBtn.className = 'ref-thumb-remove';
      removeBtn.title = 'Xóa ảnh';
      removeBtn.textContent = '\u00D7';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        GenTab._removeRefImage(id);
      });
      thumbContainer.appendChild(removeBtn);

      // Save to album button (chỉ hiển thị cho ảnh đã upload, không phải pending)
      if (!isPending) {
        const saveBtn = document.createElement('div');
        saveBtn.className = 'ref-thumb-save';
        saveBtn.title = window.I18n?.t('imagePicker.saveToAlbum') || 'Lưu vào album';
        saveBtn.innerHTML = `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`;
        saveBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          GenTab._saveRefImageToAlbum(id, thumbSrc);
        });
        thumbContainer.appendChild(saveBtn);
      }

      // Mention mode: add name label below thumbnail
      if (isMentionMode) {
        itemEl.appendChild(thumbContainer);

        const nameLabel = document.createElement('div');
        nameLabel.className = 'ref-item-name';
        nameLabel.dataset.fileId = id;
        nameLabel.textContent = name;
        nameLabel.title = 'Click để sửa';
        nameLabel.addEventListener('click', () => {
          GenTab._editRefImageName(id, GenTab.refImageNames[id] || name);
        });
        itemEl.appendChild(nameLabel);

        GenTab.fileIdThumbnails.appendChild(itemEl);
      } else {
        GenTab.fileIdThumbnails.appendChild(thumbContainer);
      }
    });

    // Update count (show limit warning if exceeded)
    const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;
    if (countEl) {
      if (currentIds.length > refLimit) {
        countEl.textContent = t('gen.refCountMax', { count: currentIds.length, max: refLimit });
        countEl.classList.remove('hidden');
        countEl.classList.add('ref-count-exceeded');
      } else {
        countEl.textContent = t('gen.refCountImages', { count: currentIds.length });
        countEl.classList.toggle('hidden', currentIds.length === 0);
        countEl.classList.remove('ref-count-exceeded');
      }
    }

    // Update drag hint visibility (toolbar always visible for quick tabs)
    const dragHint = document.getElementById('refImagesDragHint');
    const ratioCount = document.getElementById('refRatioCount');

    // Show drag hint when >= 2 images and mode supports reordering
    if (dragHint) {
      const mode = GenTab.refImageMode;
      const showDragHint = (mode === 'sequential' || mode === 'all') && currentIds.length >= 2;
      dragHint.classList.toggle('hidden', !showDragHint);

      // Update ratio count for sequential mode
      if (ratioCount && mode === 'sequential' && GenTab.multiPromptCheck?.checked) {
        const prompts = GenTab.promptsArea?.value?.split(/\n\s*\n/).filter(p => p.trim()) || [];
        const promptCount = prompts.length;
        const imageCount = currentIds.length;
        ratioCount.textContent = t('gen.refRatio', { images: imageCount, prompts: promptCount });
        ratioCount.classList.remove('match', 'mismatch');
        ratioCount.classList.add(imageCount === promptCount ? 'match' : 'mismatch');
      } else if (ratioCount) {
        ratioCount.textContent = '';
      }
    }

    // Enable drag-drop reordering
    GenTab._enableThumbnailDragDrop();

    // Show save to album button when has images
    const albumBtn = document.getElementById('saveToAlbumBtn');
    if (albumBtn) {
      albumBtn.classList.toggle('hidden', currentIds.length === 0);
    }

    if (uiChangedCache) GenTab.saveState();
  }

  // ─── Drag-drop to reorder thumbnails ────────────────────────
  static _enableThumbnailDragDrop() {
    // Get draggable items - either .ref-item (mention mode) or .ref-thumb (standard)
    const items = GenTab.fileIdThumbnails?.querySelectorAll('.ref-item, .ref-grid > .ref-thumb');
    if (!items?.length) return;

    items.forEach(item => {
      const refId = item.dataset.refId || item.querySelector('.ref-thumb')?.dataset.refId;
      if (!refId) return;

      item.draggable = true;
      item.style.cursor = 'grab';

      item.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', refId);
        item.classList.add('dragging');
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = GenTab.fileIdThumbnails.querySelector('.dragging');
        if (dragging && item !== dragging) {
          item.classList.add('drag-over');
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        const draggedId = e.dataTransfer.getData('text/plain');
        const targetId = refId;
        if (draggedId && targetId && draggedId !== targetId) {
          GenTab._reorderFileIds(draggedId, targetId);
        }
      });
    });
  }

  static _reorderFileIds(draggedId, targetId) {
    const ids = GenTab.fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const draggedIdx = ids.indexOf(draggedId);
    const targetIdx = ids.indexOf(targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    // Remove dragged and insert at target position
    ids.splice(draggedIdx, 1);
    ids.splice(targetIdx, 0, draggedId);

    GenTab.fileIdsInput.value = ids.join(', ');

    // Keep existing names - do NOT renumber
    // User names are preserved as-is when reordering

    GenTab.renderFileIdThumbnails();
    GenTab._refreshMentionHelper();
    GenTab.saveState();
  }

  // ─── Handle dropped files ────────────────────────────────
  static async _handleDroppedFiles(files) {
    if (!GenTab.fileIdsInput) return;
    if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();

    const existingIds = GenTab.fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const newIds = [];

    for (const file of files) {
      const key = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

      // Create thumbnail
      const thumbnail = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });

      // Store in memory — giữ tên gốc BỎ ĐUÔI (.jpg/.png) để đồng bộ với MediaModal.
      const _baseName = file.name.replace(/\.[^/.]+$/, '');
      window.pendingUploadFiles.set(key, { file, thumbnail, name: _baseName });
      GenTab.refImageNames[key] = _baseName;

      // LAZY UPLOAD: Không upload ngay. Flow sẽ upload khi submit.
      newIds.push(key);
    }

    const mergedIds = [...existingIds, ...newIds];
    GenTab.fileIdsInput.value = mergedIds.join(', ');
    GenTab.fileIdsInput.dispatchEvent(new Event('input', { bubbles: true }));
    GenTab.renderFileIdThumbnails();
  }

  // ─── Frame picker binding ─────────────────────────────────
  static bindFramePicker(frameNum) {
    const pickBtn = document.getElementById(`genTabFrame${frameNum}PickBtn`);
    const fileIdInput = document.getElementById(`genTabFrame${frameNum}FileId`);
    const previewEl = document.getElementById(`genTabFrame${frameNum}Preview`);
    if (!pickBtn) return;

    pickBtn.addEventListener('click', () => {
      const existingIds = (fileIdInput?.value || '').split(',').filter(Boolean);
      if (window.imagePickerModal) {
        window.imagePickerModal.open({
          existingFileIds: existingIds,
          mediaFilter: 'image',
          // Post-audit fix: single image setter (fileIdInput.value = 1 string) → singleSelect
          singleSelect: true,
          onConfirm: (images) => {
            if (images.length > 0) {
              const img = images[0];
              // Cache ảnh upload local (memory)
              if (img.source === 'upload' && img.file) {
                const key = img.fileId || `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
                window.pendingUploadFiles.set(key, { file: img.file, thumbnail: img.thumbnail });
                // LAZY UPLOAD: Không upload ngay. Flow sẽ upload khi submit.
                img.fileId = key;
              }
              // FIX: Cache file_name và thumbnail cho Flow images
              if (img.source === 'flow' && img.fileId) {
                if (img.file_name) GenTab.fileNameCache[img.fileId] = img.file_name;
                if (img.thumbnail) GenTab.thumbnailCache[img.fileId] = img.thumbnail;
              }
              if (fileIdInput) fileIdInput.value = img.fileId || '';
              if (previewEl) {
                const thumbSrc = img.thumbnail || window.pendingUploadFiles?.get(img.fileId)?.thumbnail || '';
                previewEl.innerHTML = `<div class="ref-thumb">${thumbSrc ? `<img src="${thumbSrc}" alt="frame ${frameNum}" />` : `<span>${(img.fileId || '').substring(0, 12)}</span>`}</div>`;
              }
            }
            GenTab.saveState();
          }
        });
      }
    });
  }

  /**
   * UI 2026-05-27: ẩn option "Frames" trong #videoInputType nếu model hiện tại set
   * config.supports_frames=false. Đồng thời ép về 'Ingredients' nếu đang chọn Frames.
   */
  static _applyFramesSupport() {
    const sel = GenTab.videoInputTypeSelect;
    if (!sel) return;
    const flowAdapter = window.ProviderRegistry?.get?.('flow');
    const modelValue = GenTab.videoModelSelect?.value || '';
    const supports = typeof flowAdapter?.supportsFrames === 'function'
      ? flowAdapter.supportsFrames(modelValue) : true;
    const framesOpt = sel.querySelector('option[value="Frames"]');
    if (framesOpt) {
      framesOpt.hidden = !supports;
      framesOpt.disabled = !supports;
    }
    if (!supports && sel.value === 'Frames') {
      sel.value = 'Ingredients';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  /**
   * Flow Voice Selector — show/hide voice picker theo model.config.supports_voice.
   * Reset value="" khi model không support voice (tránh submit voice cho model image-only).
   */
  static _applyVoicePickerVisibility() {
    const container = document.getElementById('genVideoVoiceContainer');
    if (!container) return;

    const providerKey = document.getElementById('genProvider')?.value || 'flow';
    const genType = GenTab.genTypeSelect?.value;
    if (providerKey !== 'flow' || genType !== 'Video') {
      container.classList.add('hidden');
      return;
    }

    const modelValue = GenTab.videoModelSelect?.value || '';
    const modelObj = window.ModelRegistry?.findModel?.('flow', modelValue);
    const supportsVoice = !!(modelObj?.config?.supports_voice === true);

    if (supportsVoice) {
      container.classList.remove('hidden');
      GenTab._initVoicePickerIfNeeded();
    } else {
      container.classList.add('hidden');
      // Reset value khi switch sang model không support voice
      const hiddenSel = document.getElementById('genVideoVoiceSelect');
      if (hiddenSel && hiddenSel.value) {
        hiddenSel.value = '';
        GenTab._voicePicker?._updateTrigger();
        GenTab.saveState?.();
      }
    }
  }

  /**
   * Lazy init voice picker — chỉ khi user vào video mode với model supports_voice.
   * Uses VoiceSelectModal (full-screen overlay) thay vì inline popup.
   */
  static _initVoicePickerIfNeeded() {
    if (GenTab._voicePicker || !window.VoicePicker) return;

    const triggerEl = document.getElementById('genVideoVoiceTrigger');
    const thumbEl = document.getElementById('genVideoVoiceTriggerThumb');
    const labelEl = document.getElementById('genVideoVoiceLabel');
    const hiddenSelectEl = document.getElementById('genVideoVoiceSelect');
    if (!triggerEl) return;

    GenTab._voicePicker = new window.VoicePicker({
      triggerEl,
      thumbEl,
      labelEl,
      hiddenSelectEl,
      providerSlug: 'flow',
      getSelected: () => hiddenSelectEl?.value || '',
      onChange: (slug) => {
        if (hiddenSelectEl) hiddenSelectEl.value = slug || '';
        GenTab.saveState?.();
      },
    });
    GenTab._voicePicker.init();

    chrome.storage.local.get(['seosona_gentab_state'], (res) => {
      const savedSlug = res?.seosona_gentab_state?.selectedVoiceSlug;
      if (savedSlug && hiddenSelectEl) {
        hiddenSelectEl.value = savedSlug;
        GenTab._voicePicker._updateTrigger();
      }
    });
  }

  /**
   * Flow Character Selector — show/hide theo provider=flow + model.config.supports_character.
   * KHÁC voice: hiện cả Image LẪN Video (không gate genType). Reset value khi model không support.
   */
  static _applyCharacterPickerVisibility() {
    const container = document.getElementById('genCharacterContainer');
    if (!container) return;

    const providerKey = document.getElementById('genProvider')?.value || 'flow';
    if (providerKey !== 'flow') {
      container.classList.add('hidden');
      return;
    }

    const genType = GenTab.genTypeSelect?.value;
    const modelValue = genType === 'Image'
      ? (GenTab.imageModelSelect?.value || '')
      : (GenTab.videoModelSelect?.value || '');
    const modelObj = window.ModelRegistry?.findModel?.('flow', modelValue);
    const supportsChar = !!(modelObj?.config?.supports_character === true);

    if (supportsChar) {
      container.classList.remove('hidden');
      GenTab._initCharacterPickerIfNeeded();
    } else {
      container.classList.add('hidden');
      const hiddenSel = document.getElementById('genCharacterSelect');
      if (hiddenSel && hiddenSel.value) {
        hiddenSel.value = '';
        GenTab._characterPicker?._updateTrigger();
        GenTab.saveState?.();
      }
    }
  }

  /** Lazy init character picker — chỉ khi provider=flow + model supports_character. */
  static _initCharacterPickerIfNeeded() {
    if (GenTab._characterPicker || !window.CharacterPicker) return;

    const triggerEl = document.getElementById('genCharacterTrigger');
    const thumbEl = document.getElementById('genCharacterTriggerThumb');
    const labelEl = document.getElementById('genCharacterLabel');
    const hiddenSelectEl = document.getElementById('genCharacterSelect');
    if (!triggerEl) return;

    GenTab._characterPicker = new window.CharacterPicker({
      triggerEl,
      thumbEl,
      labelEl,
      hiddenSelectEl,
      getSelected: () => hiddenSelectEl?.value || '',
      onChange: (slug) => {
        if (hiddenSelectEl) hiddenSelectEl.value = slug || '';
        GenTab.saveState?.();
      },
    });
    GenTab._characterPicker.init();

    chrome.storage.local.get(['seosona_gentab_state'], (res) => {
      const savedSlug = res?.seosona_gentab_state?.selectedCharacterSlug;
      if (savedSlug && hiddenSelectEl) {
        hiddenSelectEl.value = savedSlug;
        GenTab._characterPicker._updateTrigger();
      }
    });
  }

  // ─── GenType UI toggle ────────────────────────────────────
  static updateGenTypeUI() {
    // Provider check: nếu không phải Flow → delegate cho _renderByProvider để giữ
    // settings của provider hiện tại (ChatGPT/Grok có ratio + model + quantity riêng).
    // KHÔNG show imageModelContainer/videoModelContainer (Flow-only) hay overwrite ratio options.
    const providerKey = document.getElementById('genProvider')?.value || 'flow';
    if (providerKey !== 'flow') {
      try { GenTab._renderByProvider(providerKey); } catch (_e) { globalThis.SEOSONA_swallow?.('GenTab#onChange', _e); }
      GenTab.updateRefImagesVisibility();
      GenTab.renderFileIdThumbnails();
      return;
    }

    const isVideo = GenTab.genTypeSelect.value === 'Video';
    if (isVideo) {
      GenTab.imageModelContainer.classList.add('hidden');
      GenTab.videoModelContainer.classList.remove('hidden');
      if (GenTab.videoInputTypeContainer) GenTab.videoInputTypeContainer.classList.remove('hidden');
      GenTab._applyFramesSupport(); // ẩn option Frames nếu model không hỗ trợ
      GenTab._applyVoicePickerVisibility(); // Flow Voice — show/hide theo model.config.supports_voice
    } else {
      GenTab.imageModelContainer.classList.remove('hidden');
      GenTab.videoModelContainer.classList.add('hidden');
      if (GenTab.videoInputTypeContainer) GenTab.videoInputTypeContainer.classList.add('hidden');
      // Voice picker chỉ cho video → ẩn khi image mode
      const vcEl = document.getElementById('genVideoVoiceContainer');
      if (vcEl) vcEl.classList.add('hidden');
    }
    // Flow Character — show/hide cho CẢ 2 mode (image+video) → gọi NGOÀI if/else, sau cả 2 nhánh.
    try { GenTab._applyCharacterPickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#onChange', _); }
    // 2026-05-22: toggle wrap break để Video mode → settings row riêng (Model + InputType + Duration
    // trên hàng đầu, Ratio + Quantity + Style xuống dòng dưới). Image mode giữ 1 hàng compact.
    const compactBar = document.getElementById('genCompactBar');
    if (compactBar) compactBar.dataset.genMode = isVideo ? 'video' : 'image';
    GenTab.updateRefImagesVisibility();
    // Update ratio options based on type (Video: 16:9/9:16, Image: all 5)
    GenTab.updateRatioOptions();
    // Re-render thumbnails to update ref limit grayscale state
    GenTab.renderFileIdThumbnails();
  }

  static _ratioIcon(value) {
    const v = String(value || '').trim();
    if (v === '16:9') return '▬';
    if (v === '4:3' || v === '3:2') return '▭';
    if (v === '1:1') return '□';
    if (v === '3:4' || v === '2:3') return '▯';
    if (v === '9:16') return '▮';
    return '◇';
  }

  /**
   * Update ratio select options based on current genType.
   * Source of truth: ProviderConfigManager.getRatiosSync('flow', mode) → admin tweakable.
   * Fallback inline khi PCM chưa load (first run): image 5 ratios, video 2 ratios.
   */
  static updateRatioOptions() {
    if (!GenTab.aspectRatioSelect) return;

    const isVideo = GenTab.genTypeSelect?.value === 'Video';
    const currentValue = GenTab.aspectRatioSelect.value;

    const mode = isVideo ? 'video' : 'image';
    const fallback = isVideo ? ['16:9', '9:16'] : ['1:1', '9:16', '16:9', '4:3', '3:4'];
    const ratios = (window.ProviderConfigManager?.safeGetRatiosSync?.('flow', mode)) || fallback;

    // Server returns [{value, ui_name}], fallback is ['16:9', ...] — normalize to {value, label}
    const options = ratios.map(r => {
      const val = typeof r === 'string' ? r : (r.value || r);
      return { value: val, label: `${GenTab._ratioIcon(val)} ${val}` };
    });

    // Rebuild options
    GenTab.aspectRatioSelect.innerHTML = options.map(opt =>
      `<option value="${opt.value}">${opt.label || opt.value || ''}</option>`
    ).join('');

    // Also update confirm modal ratio select
    const confirmRatio = document.getElementById('confirmAspectRatio');
    if (confirmRatio) {
      confirmRatio.innerHTML = GenTab.aspectRatioSelect.innerHTML;
    }

    // Restore value if still valid, else use default from settings
    const validValues = options.map(o => o.value);
    if (validValues.includes(currentValue)) {
      GenTab.aspectRatioSelect.value = currentValue;
      if (confirmRatio) confirmRatio.value = currentValue;
    } else {
      // Get default from settings
      chrome.storage.local.get(['af_settings'], (res) => {
        const settings = res.af_settings || {};
        const defaultRatio = isVideo
          ? (settings.defaultVideoRatio || '16:9')
          : (settings.defaultImageRatio || '16:9');
        GenTab.aspectRatioSelect.value = defaultRatio;
        if (confirmRatio) confirmRatio.value = defaultRatio;
      });
    }
  }

  /**
   * Bug 31 fix (2026-05-19): Populate model dropdowns (imageModel, videoModel) từ
   * ModelRegistry. Gọi khi init + khi SSE provider:models_updated fire.
   *
   * Label rút gọn cho video: "Veo 3.1 - Fast" → "Veo 3.1 Fast" (UI compact).
   */
  static updateModelOptions() {
    const fillSelect = (selectEl, mediaType) => {
      if (!selectEl || !window.ModelRegistry?.getModelsSync) return;
      const models = window.ModelRegistry.getModelsSync('flow', mediaType);
      if (!Array.isArray(models) || models.length === 0) return; // giữ hardcoded fallback
      const prevValue = selectEl.value;
      selectEl.innerHTML = '';
      for (const m of models) {
        const opt = document.createElement('option');
        opt.value = m.value || m.name;
        // Compact display: "Veo 3.1 - Fast" → "Veo 3.1 Fast"
        opt.textContent = (m.name || '').replace(/^Veo 3\.1 - /, 'Veo 3.1 ');
        selectEl.appendChild(opt);
      }
      if (prevValue && [...selectEl.options].some(o => o.value === prevValue)) {
        selectEl.value = prevValue;
      }
    };
    fillSelect(GenTab.imageModelSelect, 'image');
    fillSelect(GenTab.videoModelSelect, 'video');

    // ChatGPT models (Instant/Thinking — GPT-5.5) từ ModelRegistry('chatgpt','image').
    if (GenTab.chatgptModelSelect && window.ModelRegistry?.getModelsSync) {
      const cgModels = window.ModelRegistry.getModelsSync('chatgpt', 'image');
      if (Array.isArray(cgModels) && cgModels.length > 0) {
        const prev = GenTab.chatgptModelSelect.value;
        GenTab.chatgptModelSelect.innerHTML = '';
        for (const m of cgModels) {
          const opt = document.createElement('option');
          opt.value = m.value || m.name;
          opt.textContent = m.name || m.value;
          GenTab.chatgptModelSelect.appendChild(opt);
        }
        if (prev && [...GenTab.chatgptModelSelect.options].some(o => o.value === prev)) {
          GenTab.chatgptModelSelect.value = prev;
        }
      }
    }

    // Auto-update duration options when video model changes
    GenTab.updateFlowVideoDurationOptions();
    // Sau khi model selects đã render + set value → re-apply picker visibility. Điểm này chạy
    // CẢ lúc init (GenTab.init L173) LẪN khi models load (provider:models_updated) → character
    // hiện đúng ngay lúc mở (image mode default), không cần switch genType. updateGenTypeUI KHÔNG
    // gọi lúc init nên không thể dựa vào đó.
    try { GenTab._applyVoicePickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#fillSelect', _); }
    try { GenTab._applyCharacterPickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#fillSelect', _); }
  }

  /**
   * Populate Flow video duration dropdown based on selected video model's duration_tier.
   * Model.config.duration_tier → lookup video_durations[tier] from PCM.
   * Called on init + when videoModel changes + SSE api_config_updated.
   */
  static updateFlowVideoDurationOptions() {
    const selectEl = GenTab.flowVideoDurationSelect;
    if (!selectEl) return;

    // Get current video model to determine duration_tier
    const currentModel = GenTab.videoModelSelect?.value || '';
    let tier = 'default';

    // Lookup model config from ModelRegistry
    try {
      const models = window.ModelRegistry?.safeGetModelsSync?.('flow', 'video') || [];
      const modelObj = models.find(m => m.value === currentModel || m.name === currentModel);
      if (modelObj?.config?.duration_tier) {
        tier = modelObj.config.duration_tier;
      }
    } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#fillSelect', _); }

    // Get durations from PCM
    const durations = window.ProviderConfigManager?.safeGetVideoDurationsSync?.('flow', tier) || [];
    if (durations.length === 0) {
      // Server-Only: hide dropdown if no config
      if (GenTab.flowVideoDurationContainer) {
        GenTab.flowVideoDurationContainer.classList.add('hidden');
      }
      return;
    }

    const prevValue = selectEl.value;
    selectEl.innerHTML = '';
    for (const d of durations) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      selectEl.appendChild(opt);
    }

    // Restore previous value or default to first
    if (prevValue && durations.includes(prevValue)) {
      selectEl.value = prevValue;
    } else if (durations.length > 0) {
      // Default to middle option (6s typically)
      const defaultIdx = durations.indexOf('6s');
      selectEl.value = defaultIdx >= 0 ? durations[defaultIdx] : durations[0];
    }
  }

  /**
   * Populate Grok video duration dropdown (#grokDuration) từ PCM supported_durations('grok').
   * Trước fix: options hardcode trong sidebar.html (6s/10s) → admin thêm '15s' vào api_config KHÔNG
   * hiện ở UI. Server-Only: render từ config. Gọi khi _renderByProvider('grok') + SSE grok update.
   */
  static updateGrokVideoDurationOptions() {
    const selectEl = document.getElementById('grokDuration');
    if (!selectEl) return;
    let durations = [];
    try { durations = window.ProviderConfigManager?.getSupportedDurationsSync?.('grok') || []; }
    catch (_) { return; } // ConfigRequiredError (cache chưa load) → giữ options hiện tại, tránh xoá trắng
    if (durations.length === 0) return;

    const prevValue = selectEl.value;
    selectEl.innerHTML = '';
    for (const d of durations) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      selectEl.appendChild(opt);
    }
    if (prevValue && durations.includes(prevValue)) {
      selectEl.value = prevValue;
    } else {
      chrome.storage.local.get(['af_settings'], (res) => {
        const def = res.af_settings?.grokDefaultDuration || durations[0];
        selectEl.value = durations.includes(def) ? def : durations[0];
      });
    }
  }

  /**
   * Bug 30 fix (2026-05-19): Re-populate download resolution dropdowns trong GenTab
   * từ PCM `provider_configs.api_config.download_resolutions`. Gọi khi init + khi
   * SSE `provider:api_config_updated` key=download_resolutions fire.
   *
   * Pattern giống `settings-page.js._fillDownloadResolutionSelect`.
   */
  static updateDownloadResolutionOptions() {
    const fillSelect = (selectEl, mode) => {
      if (!selectEl) return;
      const fallback = mode === 'video'
        ? [{ value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }, { value: '4k', label: '4K (Ultra)' }]
        : [{ value: '1k', label: '1K' }, { value: '2k', label: '2K (Pro)' }, { value: '4k', label: '4K (Ultra)' }];
      const options = window.ProviderConfigManager?.getDownloadResolutionsSync?.('flow', mode);
      const list = (Array.isArray(options) && options.length > 0) ? options : fallback;
      const prevValue = selectEl.value;
      selectEl.innerHTML = '';
      for (const r of list) {
        const opt = document.createElement('option');
        opt.value = r.value;
        // Bug 36 fix: UI display dùng `label`. `menu_label` chỉ cho Flow web DOM matching.
        opt.textContent = r.label || r.menu_label || r.value;
        selectEl.appendChild(opt);
      }
      // Full-size thật (không có trong config Flow) — chỉ cho ảnh. Native menu dùng 4K, fallback fetch =s0.
      if (mode !== 'video' && ![...selectEl.options].some(o => o.value === 'original')) {
        const opt = document.createElement('option');
        opt.value = 'original';
        opt.textContent = window.I18n?.t('gen.resOriginal') || 'Gốc (Full size)';
        selectEl.appendChild(opt);
      }
      if (prevValue && [...selectEl.options].some(o => o.value === prevValue)) {
        selectEl.value = prevValue;
      }
    };
    fillSelect(document.getElementById('genTabDownloadResolution'),      'image');
    fillSelect(document.getElementById('genTabVideoDownloadResolution'), 'video');
  }

  /**
   * Apply quantity_range (min/max) từ provider_configs.flow.api_config.quantity_range
   * vào input + restore last user pick từ af_settings.defaultFlowQuantity.
   *
   * UI: +/- buttons + number input (matching TaskModal pattern).
   * SSE `provider:api_config_updated` key='quantity_range' → re-apply runtime.
   *
   * Restore order:
   *   1. In-session current value nếu vẫn trong range mới
   *   2. af_settings.defaultFlowQuantity (persisted user pick — async)
   *   3. min của range (fallback)
   */
  static updateQuantityOptions() {
    const inputEl = GenTab.quantitySelect || document.getElementById('quantitySelect');
    if (!inputEl) return;
    const range = window.ProviderConfigManager?.safeGetQuantityRangeSync?.('flow');
    const min = range?.min ?? 1;
    const max = range?.max ?? 4;
    inputEl.min = String(min);
    inputEl.max = String(max);

    const inRange = (v) => {
      const n = parseInt(v, 10);
      return Number.isInteger(n) && n >= min && n <= max;
    };

    // Step 1: in-session value vẫn valid
    const currentVal = parseInt(inputEl.value, 10);
    if (inRange(currentVal)) {
      // already valid — keep it
    } else {
      // Out-of-range → clamp về min trước, sau đó async restore
      inputEl.value = String(min);
    }

    // Step 2: async restore last user pick từ storage
    try {
      chrome.storage.local.get(['af_settings'], (res) => {
        const saved = res?.af_settings?.defaultFlowQuantity;
        if (saved && inRange(saved)) {
          inputEl.value = String(saved);
        }
      });
    } catch (_) { /* fallback already set to min */ }
  }

  /**
   * Bind +/- button handlers cho GenTab quantity input (matching TaskModal pattern).
   * Gọi từ init() sau khi DOM refs ready.
   */
  static _bindQuantityButtons() {
    const inputEl = GenTab.quantitySelect || document.getElementById('quantitySelect');
    if (!inputEl) return;
    const getMinMax = () => {
      const range = window.ProviderConfigManager?.safeGetQuantityRangeSync?.('flow');
      return { min: range?.min ?? 1, max: range?.max ?? 4 };
    };
    const minusBtn = document.getElementById('genQtyMinus');
    const plusBtn = document.getElementById('genQtyPlus');
    minusBtn?.addEventListener('click', () => {
      const { min } = getMinMax();
      const val = parseInt(inputEl.value, 10) || min;
      if (val > min) {
        inputEl.value = String(val - 1);
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    plusBtn?.addEventListener('click', () => {
      const { max, min } = getMinMax();
      const val = parseInt(inputEl.value, 10) || min;
      if (val < max) {
        inputEl.value = String(val + 1);
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  /**
   * Ref image limit theo genType + ref_mode + multi_prompt:
   *  - mention: KHÔNG limit (user manual @ ref vào prompt) → return Infinity
   *  - Multi + sequential: limit = N_prompts (1 ảnh / prompt, KHÔNG × policy)
   *  - Single OR mode='all'/'none': limit = policy_per_prompt (Video Ingredients=3, Image=10)
   */
  /**
   * 2026-05-22: Sau khi user đổi model/duration/input_type → re-check ref support.
   * Nếu model+context mới không support ref (vd Lite/Fast + duration=4s) + đã có ref →
   * strip refs khỏi UI + toast warning.
   */
  static _validateRefSupportAfterChange(reason) {
    const isVideo = GenTab.genTypeSelect?.value === 'Video';
    if (!isVideo) return;
    const provider = (GenTab.providerSelect?.value || 'flow').toLowerCase();
    if (provider !== 'flow') return;

    const fileIdsRaw = GenTab.fileIdsInput?.value || '';
    const currentIds = fileIdsRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (currentIds.length === 0) return; // không có ref → không cần check

    const adapter = window.ProviderRegistry?.get?.('flow');
    if (!adapter?.supportsRefImages) return;

    const modelValue = GenTab.videoModelSelect?.value || '';
    const inputType = GenTab.videoInputTypeSelect?.value || 'Ingredients';
    const duration = GenTab.flowVideoDurationSelect?.value || undefined;
    const supported = adapter.supportsRefImages(modelValue, { inputType, duration });
    if (supported) return; // vẫn support → giữ nguyên

    // Strip refs + warn user
    GenTab.fileIdsInput.value = '';
    GenTab.fileIdsInput.dispatchEvent(new Event('input', { bubbles: true }));
    const msg = window.I18n?.t?.('gen.refStrippedAfterChange', { model: modelValue, count: currentIds.length, reason })
      || `Đổi ${reason} → model "${modelValue}" (${inputType}${duration ? ', ' + duration : ''}) không hỗ trợ ref → đã bỏ ${currentIds.length} ảnh ref.`;
    if (window.SEOSONANotify?.warning) window.SEOSONANotify.warning(msg);
    else if (window.showNotification) window.showNotification(msg, 'warning');
    console.warn('[GenTab][Model Constraint]', msg);
  }

  static getRefLimit() {
    const refMode = GenTab.refImageMode;
    // Mention: user pick ảnh qua @name trong prompt → không cap
    if (refMode === 'mention') return Infinity;

    const isVideo = GenTab.genTypeSelect?.value === 'Video';
    const isFrames = GenTab.videoInputTypeSelect?.value === 'Frames';

    // Post-audit fix: resolve theo provider hiện tại (Flow=10/3, ChatGPT=4, Grok=4 per-mode).
    // Trước fix: hardcode REF_LIMIT_* (Flow constants) → ChatGPT/Grok dùng nhầm limit 10.
    // 2026-05-22: pass modelValue + duration để detect rule "block ref khi duration ≠ 8s" (Veo Lite/Fast).
    const provider = (GenTab.providerSelect?.value || 'flow').toLowerCase();
    const mode = isVideo ? 'video' : 'image';
    const modelValueForRef = isVideo
      ? (GenTab.videoModelSelect?.value || '')
      : (GenTab.imageModelSelect?.value || '');
    const durationForRef = isVideo ? (GenTab.flowVideoDurationSelect?.value || undefined) : undefined;
    const resolved = (typeof ImagePickerModal !== 'undefined' && ImagePickerModal.resolveMaxSelections)
      ? ImagePickerModal.resolveMaxSelections({ provider, mode, isFrames, modelValue: modelValueForRef, duration: durationForRef })
      : null;
    // 0 = model không hỗ trợ ref → block (giữ 0 nguyên, không fallback)
    if (resolved === 0) return 0;
    // Fallback PER-PROVIDER (không dùng Flow constants cho non-flow khi resolved=null).
    let perPromptPolicy;
    if (typeof resolved === 'number' && resolved > 0) {
      perPromptPolicy = resolved;
    } else if (provider === 'chatgpt' || provider === 'grok' || provider === 'gemini') {
      perPromptPolicy = 4;
    } else {
      perPromptPolicy = (isVideo && !isFrames) ? GenTab.REF_LIMIT_VIDEO : GenTab.REF_LIMIT_IMAGE;
    }

    // Multi + sequential: 1 ảnh / prompt → limit = N_prompts
    const isMulti = GenTab.multiPromptCheck?.checked;
    if (isMulti && refMode === 'sequential') {
      return GenTab._countPrompts?.() || 1;
    }
    return perPromptPolicy;
  }

  /**
   * Đếm số prompt hiện tại trong textarea (split bằng dòng trống) — dùng cho ref limit scaling.
   */
  static _countPrompts() {
    const txt = GenTab.promptsArea?.value || '';
    if (!txt.trim()) return 1;
    const blocks = txt.split(/\n\s*\n/).map(b => b.trim()).filter(b => b.length > 0);
    return Math.max(1, blocks.length);
  }

  static updateRefImagesVisibility() {
    // Provider check: ChatGPT/Grok KHÔNG có Frame mode (chỉ ref_img). Frame chỉ áp dụng cho Flow.
    // Grok video dùng cùng ref_img như image mode → luôn show refImagesSection, ẩn videoFramesSection.
    const providerKey = document.getElementById('genProvider')?.value || 'flow';
    if (providerKey !== 'flow') {
      if (GenTab.refImagesSection) GenTab.refImagesSection.classList.remove('hidden');
      if (GenTab.videoFramesSection) GenTab.videoFramesSection.classList.add('hidden');
      return;
    }

    const isVideo = GenTab.genTypeSelect?.value === 'Video';
    const isFrames = GenTab.videoInputTypeSelect?.value === 'Frames';

    if (isVideo && isFrames) {
      // Video+Frames: ẩn ref images, hiện frame config
      if (GenTab.refImagesSection) GenTab.refImagesSection.classList.add('hidden');
      if (GenTab.videoFramesSection) GenTab.videoFramesSection.classList.remove('hidden');
      // Switch between global and per-prompt frame modes
      GenTab._updateFrameMode();
    } else if (isVideo) {
      // Video+Ingredients: hiện ref images (giống Image), ẩn frame config
      if (GenTab.refImagesSection) GenTab.refImagesSection.classList.remove('hidden');
      if (GenTab.videoFramesSection) GenTab.videoFramesSection.classList.add('hidden');
    } else {
      // Image: hiện ref images, ẩn frame config
      if (GenTab.refImagesSection) GenTab.refImagesSection.classList.remove('hidden');
      if (GenTab.videoFramesSection) GenTab.videoFramesSection.classList.add('hidden');
    }
  }

  /**
   * Switch between global frame pair (single-prompt) and per-prompt frame pairs (multi-prompt)
   */
  static _updateFrameMode() {
    const globalConfig = document.getElementById('globalFrameConfig');
    const perPromptContainer = document.getElementById('perPromptFramesContainer');
    if (!globalConfig || !perPromptContainer) return;

    const isMultiPrompt = GenTab.multiPromptCheck?.checked;
    const promptCount = GenTab._getPromptCount();

    if (isMultiPrompt && promptCount > 1) {
      // Multi-prompt: show per-prompt frame pairs
      globalConfig.classList.add('hidden');
      perPromptContainer.classList.remove('hidden');
      GenTab._renderPerPromptFrames(promptCount);
    } else {
      // Single-prompt: show global frame pair
      globalConfig.classList.remove('hidden');
      perPromptContainer.classList.add('hidden');
    }
  }

  /**
   * Get prompt count from textarea (for per-prompt frame pairs)
   */
  static _getPromptCount() {
    const text = GenTab.promptsArea?.value?.trim() || '';
    if (!text) return 0;
    if (!GenTab.multiPromptCheck?.checked) return 1;
    return text.split(/\n\s*\n/).filter(p => p.trim()).length;
  }

  /**
   * Get prompt preview text (first 40 chars of each prompt)
   */
  static _getPromptPreviews() {
    const text = GenTab.promptsArea?.value?.trim() || '';
    if (!text) return [];
    const prompts = GenTab.multiPromptCheck?.checked
      ? text.split(/\n\s*\n/).filter(p => p.trim())
      : [text];
    return prompts.map(p => p.trim().substring(0, 40).replace(/\n/g, ' '));
  }

  /**
   * Render per-prompt frame pairs dynamically
   */
  static _renderPerPromptFrames(promptCount) {
    const container = document.getElementById('perPromptFramesContainer');
    if (!container) return;

    const previews = GenTab._getPromptPreviews();

    // Ensure _perPromptFrameData has correct length (preserve existing data)
    while (GenTab._perPromptFrameData.length < promptCount) {
      GenTab._perPromptFrameData.push({ frame1: '', frame2: '', frame1Thumb: '', frame2Thumb: '' });
    }
    // Don't shrink — keep extra data in case user re-adds prompts

    const startIconSvg = '<svg class="frame-slot-icon" viewBox="0 0 11 10" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5L8.9 7.5C9.46005 7.5 9.74008 7.5 9.95399 7.39101C10.1422 7.29513 10.2951 7.14215 10.391 6.95399C10.5 6.74008 10.5 6.46005 10.5 5.9V4.1C10.5 3.53995 10.5 3.25992 10.391 3.04601C10.2951 2.85785 10.1422 2.70487 9.95399 2.60899C9.74008 2.5 9.46005 2.5 8.9 2.5L5 2.5M3 7.5H2.1C1.53995 7.5 1.25992 7.5 1.04601 7.39101C0.857847 7.29513 0.704867 7.14215 0.608994 6.95399C0.5 6.74008 0.5 6.46005 0.5 5.9V4.1C0.5 3.53995 0.5 3.25992 0.608994 3.04601C0.704867 2.85785 0.857847 2.70487 1.04601 2.60899C1.25992 2.5 1.53995 2.5 2.1 2.5H3M3 0.5L3 9.5M1.75 9.5L4.25 9.5M1.75 0.499996L4.25 0.5"/></svg>';
    const endIconSvg = '<svg class="frame-slot-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5H2.6C2.03995 3.5 1.75992 3.5 1.54601 3.60899C1.35785 3.70487 1.20487 3.85785 1.10899 4.04601C1 4.25992 1 4.53995 1 5.1V6.9C1 7.46005 1 7.74008 1.10899 7.95399C1.20487 8.14215 1.35785 8.29513 1.54601 8.39101C1.75992 8.5 2.03995 8.5 2.6 8.5H6.5M8.5 3.5H9.4C9.96005 3.5 10.2401 3.5 10.454 3.60899C10.6422 3.70487 10.7951 3.85785 10.891 4.04601C11 4.25992 11 4.53995 11 5.1V6.9C11 7.46005 11 7.74008 10.891 7.95399C10.7951 8.14215 10.6422 8.29513 10.454 8.39101C10.2401 8.5 9.96005 8.5 9.4 8.5H8.5M8.5 10.5L8.5 1.5M9.75 1.5L7.25 1.5M9.75 10.5L7.25 10.5"/></svg>';
    const dropzoneSvg = '<svg class="frame-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>';

    let html = '';
    for (let idx = 0; idx < promptCount; idx++) {
      const data = GenTab._perPromptFrameData[idx];
      const preview = previews[idx] || '';
      html += `
        <div class="per-prompt-frame-pair" data-prompt-index="${idx}">
          <div class="per-prompt-frame-header">
            <span class="per-prompt-frame-index">${idx + 1}</span>
            <span class="per-prompt-frame-prompt-preview" title="${this._escapeHtml(preview)}">${this._escapeHtml(preview)}</span>
          </div>
          <div class="per-prompt-frame-slots">
            <div class="frame-slot" data-prompt-idx="${idx}" data-frame-num="1">
              <div class="frame-slot-header">${startIconSvg}<span class="frame-slot-label">${window.I18n?.t('gen.frameStart') || 'Start'}</span></div>
              <div class="frame-slot-body" id="ppFrame_${idx}_1_body">
                ${data.frame1 ? GenTab._buildFrameThumbHtml(idx, 1, data.frame1, data.frame1Thumb) : `<div class="frame-dropzone" data-pp-pick="${idx}_1">${dropzoneSvg}<span class="frame-dropzone-text">${window.I18n?.t('gen.addFrame') || 'Add'}</span></div>`}
              </div>
            </div>
            <div class="frame-slot" data-prompt-idx="${idx}" data-frame-num="2">
              <div class="frame-slot-header">${endIconSvg}<span class="frame-slot-label">${window.I18n?.t('gen.frameEnd') || 'End'}</span></div>
              <div class="frame-slot-body" id="ppFrame_${idx}_2_body">
                ${data.frame2 ? GenTab._buildFrameThumbHtml(idx, 2, data.frame2, data.frame2Thumb) : `<div class="frame-dropzone" data-pp-pick="${idx}_2">${dropzoneSvg}<span class="frame-dropzone-text">${window.I18n?.t('gen.addFrame') || 'Add'}</span></div>`}
              </div>
            </div>
          </div>
        </div>`;
    }
    container.innerHTML = html;

    // Bind click events via delegation (remove first to prevent duplicates)
    container.removeEventListener('click', GenTab._handlePerPromptFrameClick);
    container.addEventListener('click', GenTab._handlePerPromptFrameClick);
  }

  static _escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  static _buildFrameThumbHtml(promptIdx, frameNum, fileId, thumbnail) {
    const isPending = fileId.startsWith('upload_');
    const isUploading = isPending && window.ImmediateUploader?.isUploading(fileId);
    const thumbSrc = thumbnail || GenTab.thumbnailCache?.[fileId] || window.pendingUploadFiles?.get(fileId)?.thumbnail || '';
    return `
      <div class="frame-thumb-wrap ${isUploading ? 'uploading' : ''}" data-file-id="${fileId}" data-pp-pick="${promptIdx}_${frameNum}">
        ${thumbSrc
          ? `<img src="${thumbSrc}" alt="Frame ${frameNum}" />`
          : `<div class="frame-thumb-fallback">${fileId.substring(0, 12)}</div>`
        }
        <div class="ref-thumb-remove" data-pp-remove="${promptIdx}_${frameNum}" data-tooltip="Xóa" aria-label="Xóa">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </div>
      </div>`;
  }

  /**
   * Delegated click handler for per-prompt frame pairs
   */
  static _handlePerPromptFrameClick(e) {
    // Remove button
    const removeBtn = e.target.closest('[data-pp-remove]');
    if (removeBtn) {
      e.stopPropagation();
      const [idx, fnum] = removeBtn.dataset.ppRemove.split('_').map(Number);
      GenTab._setPerPromptFrame(idx, fnum, '', '');
      return;
    }

    // Pick button (dropzone or thumbnail click)
    const pickEl = e.target.closest('[data-pp-pick]');
    if (pickEl) {
      const [idx, fnum] = pickEl.dataset.ppPick.split('_').map(Number);
      GenTab._openPerPromptFramePicker(idx, fnum);
    }
  }

  /**
   * Open ImagePickerModal for a per-prompt frame slot
   */
  static _openPerPromptFramePicker(promptIdx, frameNum) {
    if (!window.imagePickerModal) return;
    const data = GenTab._perPromptFrameData[promptIdx];
    if (!data) return;

    const existingId = frameNum === 1 ? data.frame1 : data.frame2;

    window.imagePickerModal.open({
      existingFileIds: existingId ? [existingId] : [],
      singleSelect: true,
      mediaFilter: 'image',
      onConfirm: async (images) => {
        if (images.length > 0) {
          const img = images[0];

          // Handle local upload
          if (img.source === 'upload' && img.file) {
            const key = img.fileId || `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
            window.pendingUploadFiles.set(key, { file: img.file, thumbnail: img.thumbnail });

            // LAZY UPLOAD: Không upload ngay. Flow sẽ upload khi submit.
            // Track upload key
            GenTab._perPromptFrameUploadKeys.set(key, { promptIndex: promptIdx, frameNum });
            img.fileId = key;
          } else if (img.source === 'album' && window.ImagePickerModal?.prepareAlbumImageForRef) {
            // Album image: xử lý qua prepareAlbumImageForRef (giống image mode)
            try {
              const prepared = await window.ImagePickerModal.prepareAlbumImageForRef(img);
              if (prepared) {
                const key = prepared.key;

                // Cache thumbnail
                if (!GenTab.thumbnailCache) GenTab.thumbnailCache = {};
                if (img.thumbnail_url) {
                  GenTab.thumbnailCache[key] = img.thumbnail_url;
                } else if (img.album_image_id && window.ImageStore) {
                  try {
                    const blobUrl = await window.ImageStore.getThumbnail(img.album_image_id);
                    if (blobUrl) GenTab.thumbnailCache[key] = blobUrl;
                  } catch (e) { /* ignore */ }
                } else if (img.thumbnail) {
                  GenTab.thumbnailCache[key] = img.thumbnail;
                }

                // Cache file_name
                if (prepared.file_name) {
                  if (!GenTab.fileNameCache) GenTab.fileNameCache = {};
                  GenTab.fileNameCache[key] = prepared.file_name;
                }

                // LAZY UPLOAD: Không upload ngay. Flow sẽ upload khi submit.
                if (key.startsWith('upload_')) {
                  // Track upload key cho per-prompt frame
                  GenTab._perPromptFrameUploadKeys.set(key, { promptIndex: promptIdx, frameNum });
                }

                img.fileId = key;
                img.thumbnail = GenTab.thumbnailCache[key] || img.thumbnail;
              }
            } catch (err) {
              console.error('[GenTab] Lỗi chuẩn bị ảnh album cho per-prompt frame:', err);
            }
          } else {
            // Cache file_name và thumbnail for cross-project tracking (Flow images)
            if (img.fileId && img.file_name) {
              if (!GenTab.fileNameCache) GenTab.fileNameCache = {};
              GenTab.fileNameCache[img.fileId] = img.file_name;
            }
            if (img.fileId && img.thumbnail) {
              if (!GenTab.thumbnailCache) GenTab.thumbnailCache = {};
              GenTab.thumbnailCache[img.fileId] = img.thumbnail;
            }
          }

          GenTab._setPerPromptFrame(promptIdx, frameNum, img.fileId, img.thumbnail);
        }
      }
    });
  }

  /**
   * Set per-prompt frame image
   */
  static _setPerPromptFrame(promptIdx, frameNum, fileId, thumbnail) {
    // Ensure data array is long enough
    while (GenTab._perPromptFrameData.length <= promptIdx) {
      GenTab._perPromptFrameData.push({ frame1: '', frame2: '', frame1Thumb: '', frame2Thumb: '' });
    }

    const data = GenTab._perPromptFrameData[promptIdx];
    if (frameNum === 1) {
      data.frame1 = fileId || '';
      data.frame1Thumb = thumbnail || '';
    } else {
      data.frame2 = fileId || '';
      data.frame2Thumb = thumbnail || '';
    }

    // Cache thumbnail
    if (fileId && thumbnail) {
      if (!GenTab.thumbnailCache) GenTab.thumbnailCache = {};
      GenTab.thumbnailCache[fileId] = thumbnail;
    }

    // Re-render the specific slot
    const body = document.getElementById(`ppFrame_${promptIdx}_${frameNum}_body`);
    const slot = body?.closest('.frame-slot');
    if (body) {
      if (fileId) {
        slot?.classList.add('has-image');
        body.innerHTML = GenTab._buildFrameThumbHtml(promptIdx, frameNum, fileId, thumbnail);
      } else {
        slot?.classList.remove('has-image');
        const dropzoneSvg = '<svg class="frame-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>';
        body.innerHTML = `<div class="frame-dropzone" data-pp-pick="${promptIdx}_${frameNum}">${dropzoneSvg}<span class="frame-dropzone-text">${window.I18n?.t('gen.addFrame') || 'Add'}</span></div>`;
      }
    }

    GenTab.saveState?.();
  }

  /**
   * Handle upload:completed for per-prompt frame uploads
   */
  static _handlePerPromptFrameUploadCompleted(data) {
    if (!data?.key || !data?.tile_id) return;
    if (!GenTab._perPromptFrameUploadKeys.has(data.key)) return;

    const { promptIndex, frameNum } = GenTab._perPromptFrameUploadKeys.get(data.key);
    GenTab._perPromptFrameUploadKeys.delete(data.key);

    // Update data
    const frameData = GenTab._perPromptFrameData[promptIndex];
    if (!frameData) return;

    const prop = frameNum === 1 ? 'frame1' : 'frame2';
    const thumbProp = frameNum === 1 ? 'frame1Thumb' : 'frame2Thumb';

    if (frameData[prop] === data.key) {
      frameData[prop] = data.tile_id;
    }

    // Transfer caches
    if (GenTab.thumbnailCache?.[data.key]) {
      GenTab.thumbnailCache[data.tile_id] = GenTab.thumbnailCache[data.key];
      delete GenTab.thumbnailCache[data.key];
    }
    if (data.thumbnail_url) {
      if (!GenTab.thumbnailCache) GenTab.thumbnailCache = {};
      GenTab.thumbnailCache[data.tile_id] = data.thumbnail_url;
      frameData[thumbProp] = data.thumbnail_url;
    }
    if (data.file_name) {
      if (!GenTab.fileNameCache) GenTab.fileNameCache = {};
      GenTab.fileNameCache[data.tile_id] = data.file_name;
    }

    // Cleanup
    window.pendingUploadFiles?.delete(data.key);
    if (window.ImmediateUploader) ImmediateUploader.clearResult?.(data.key);

    // Re-render
    const thumb = GenTab.thumbnailCache?.[data.tile_id] || data.thumbnail_url || '';
    GenTab._setPerPromptFrame(promptIndex, frameNum, data.tile_id, thumb);
  }

  /**
   * Handle upload:failed for per-prompt frame uploads
   */
  static _handlePerPromptFrameUploadFailed(data) {
    if (!data?.key) return;
    if (!GenTab._perPromptFrameUploadKeys.has(data.key)) return;

    const { promptIndex, frameNum } = GenTab._perPromptFrameUploadKeys.get(data.key);
    GenTab._perPromptFrameUploadKeys.delete(data.key);

    // Re-render to remove loading state
    const frameData = GenTab._perPromptFrameData[promptIndex];
    if (frameData) {
      const prop = frameNum === 1 ? 'frame1' : 'frame2';
      const thumbProp = frameNum === 1 ? 'frame1Thumb' : 'frame2Thumb';
      GenTab._setPerPromptFrame(promptIndex, frameNum, frameData[prop], frameData[thumbProp]);
    }
  }

  // ─── Frame Pick Buttons (Video Frames mode) ────────────────
  static _initFramePickButtons() {
    const frame1PickBtn = document.getElementById('genTabFrame1PickBtn');
    const frame2PickBtn = document.getElementById('genTabFrame2PickBtn');

    // Frame 1 pick
    if (frame1PickBtn) {
      frame1PickBtn.addEventListener('click', () => {
        GenTab._openFramePicker(1);
      });
    }

    // Frame 2 pick
    if (frame2PickBtn) {
      frame2PickBtn.addEventListener('click', () => {
        GenTab._openFramePicker(2);
      });
    }
  }

  /**
   * Mở ImagePickerModal cho frame, xử lý cả Flow image và local upload
   */
  static _openFramePicker(frameNum) {
    if (!window.imagePickerModal) return;
    const existingId = document.getElementById(`genTabFrame${frameNum}FileId`)?.value?.trim() || '';
    window.imagePickerModal.open({
      existingFileIds: existingId ? [existingId] : [],
      singleSelect: true,
      mediaFilter: 'image',
      onConfirm: async (images) => {
        if (images.length > 0) {
          const img = images[0];

          // Local upload: tạo key, lưu vào memory
          if (img.source === 'upload' && img.file) {
            const key = img.fileId || `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
            window.pendingUploadFiles.set(key, { file: img.file, thumbnail: img.thumbnail });

            // LAZY UPLOAD: Không upload ngay. Flow sẽ upload khi submit.
            // Track upload key cho frame
            if (!GenTab._frameUploadKeys) GenTab._frameUploadKeys = new Map();
            GenTab._frameUploadKeys.set(key, frameNum);

            img.fileId = key;
          } else if (img.source === 'album' && window.ImagePickerModal?.prepareAlbumImageForRef) {
            // Album image: xử lý qua prepareAlbumImageForRef (giống image mode)
            try {
              const prepared = await window.ImagePickerModal.prepareAlbumImageForRef(img);
              if (prepared) {
                const key = prepared.key;

                // Cache thumbnail
                if (!GenTab.thumbnailCache) GenTab.thumbnailCache = {};
                if (img.thumbnail_url) {
                  GenTab.thumbnailCache[key] = img.thumbnail_url;
                } else if (img.album_image_id && window.ImageStore) {
                  try {
                    const blobUrl = await window.ImageStore.getThumbnail(img.album_image_id);
                    if (blobUrl) GenTab.thumbnailCache[key] = blobUrl;
                  } catch (e) { /* ignore */ }
                } else if (img.thumbnail) {
                  GenTab.thumbnailCache[key] = img.thumbnail;
                }

                // Cache file_name
                if (prepared.file_name) {
                  if (!GenTab.fileNameCache) GenTab.fileNameCache = {};
                  GenTab.fileNameCache[key] = prepared.file_name;
                }

                // LAZY UPLOAD: Không upload ngay. Flow sẽ upload khi submit.
                if (key.startsWith('upload_')) {
                  // Track upload key cho frame
                  if (!GenTab._frameUploadKeys) GenTab._frameUploadKeys = new Map();
                  GenTab._frameUploadKeys.set(key, frameNum);
                }

                img.fileId = key;
                img.thumbnail = GenTab.thumbnailCache[key] || img.thumbnail;
              }
            } catch (err) {
              console.error('[GenTab] Lỗi chuẩn bị ảnh album cho frame:', err);
            }
          } else {
            // Flow image: cache file_name và thumbnail cho cross-project tracking
            if (img.fileId && img.file_name) {
              if (!GenTab.fileNameCache) GenTab.fileNameCache = {};
              GenTab.fileNameCache[img.fileId] = img.file_name;
            }
            if (img.fileId && img.thumbnail) {
              if (!GenTab.thumbnailCache) GenTab.thumbnailCache = {};
              GenTab.thumbnailCache[img.fileId] = img.thumbnail;
            }
          }

          GenTab._setFrameImage(frameNum, img.fileId, img.thumbnail);
        }
      }
    });
  }

  /**
   * Xử lý upload:completed cho frame uploads — sync upload key → tile_id
   */
  static _handleFrameUploadCompleted(data) {
    if (!data?.key || !data?.tile_id) return;
    if (!GenTab._frameUploadKeys?.has(data.key)) return;

    const frameNum = GenTab._frameUploadKeys.get(data.key);
    GenTab._frameUploadKeys.delete(data.key);

    // Swap upload key → real tile_id trong hidden input
    const input = document.getElementById(`genTabFrame${frameNum}FileId`);
    if (input && input.value === data.key) {
      input.value = data.tile_id;
    }

    // Transfer thumbnail cache
    if (GenTab.thumbnailCache?.[data.key]) {
      GenTab.thumbnailCache[data.tile_id] = GenTab.thumbnailCache[data.key];
      delete GenTab.thumbnailCache[data.key];
    }
    if (data.thumbnail_url) {
      if (!GenTab.thumbnailCache) GenTab.thumbnailCache = {};
      GenTab.thumbnailCache[data.tile_id] = data.thumbnail_url;
    }

    // Track file_name
    if (data.file_name) {
      if (!GenTab.fileNameCache) GenTab.fileNameCache = {};
      GenTab.fileNameCache[data.tile_id] = data.file_name;
    }

    // Cleanup
    window.pendingUploadFiles?.delete(data.key);
    if (window.ImmediateUploader) ImmediateUploader.clearResult?.(data.key);

    // Re-render frame preview với tile_id mới (xóa loading animation)
    const thumb = GenTab.thumbnailCache?.[data.tile_id] || data.thumbnail_url || '';
    GenTab._setFrameImage(frameNum, data.tile_id, thumb);
  }

  /**
   * Xử lý upload:failed cho frame uploads — xóa loading animation
   */
  static _handleFrameUploadFailed(data) {
    if (!data?.key) return;
    if (!GenTab._frameUploadKeys?.has(data.key)) return;

    const frameNum = GenTab._frameUploadKeys.get(data.key);
    GenTab._frameUploadKeys.delete(data.key);

    // Re-render để xóa loading state
    const fileId = document.getElementById(`genTabFrame${frameNum}FileId`)?.value?.trim() || '';
    if (fileId) {
      GenTab._setFrameImage(frameNum, fileId, GenTab.thumbnailCache?.[fileId] || '');
    }
  }

  /**
   * Set frame image with thumbnail + remove button
   * @param {number} frameNum - 1 or 2
   * @param {string} fileId - Tile ID or upload key
   * @param {string} thumbnail - Thumbnail URL or base64
   */
  static _setFrameImage(frameNum, fileId, thumbnail) {
    const input = document.getElementById(`genTabFrame${frameNum}FileId`);
    const body = document.getElementById(`genTabFrame${frameNum}Body`);
    const slot = document.getElementById(`genTabFrame${frameNum}Slot`);

    if (input) input.value = fileId || '';

    // Cache thumbnail vào thumbnailCache để persist qua reload
    if (fileId && thumbnail) {
      if (!GenTab.thumbnailCache) GenTab.thumbnailCache = {};
      GenTab.thumbnailCache[fileId] = thumbnail;
    }

    if (body) {
      if (fileId) {
        const isPending = fileId.startsWith('upload_');
        const isUploading = isPending && window.ImmediateUploader?.isUploading(fileId);
        const thumbSrc = thumbnail || GenTab.thumbnailCache?.[fileId] || window.pendingUploadFiles?.get(fileId)?.thumbnail || '';

        slot?.classList.add('has-image');
        body.innerHTML = `
          <div class="frame-thumb-wrap ${isUploading ? 'uploading' : ''}" data-file-id="${fileId}">
            ${thumbSrc
              ? `<img src="${thumbSrc}" alt="Frame ${frameNum}" />`
              : `<div class="frame-thumb-fallback">${fileId.substring(0, 12)}</div>`
            }
            <div class="ref-thumb-remove" data-tooltip="Xóa" aria-label="Xóa">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </div>
          </div>`;
        // Remove button
        body.querySelector('.ref-thumb-remove')?.addEventListener('click', (e) => {
          e.stopPropagation();
          if (isPending && window.ImmediateUploader) ImmediateUploader.cancel(fileId);
          GenTab._frameUploadKeys?.delete(fileId);
          GenTab._setFrameImage(frameNum, '', '');
        });
        // Click thumbnail to re-pick
        body.querySelector('.frame-thumb-wrap')?.addEventListener('click', (e) => {
          if (e.target.closest('.ref-thumb-remove')) return;
          GenTab._openFramePicker(frameNum);
        });
      } else {
        slot?.classList.remove('has-image');
        body.innerHTML = `
          <div class="frame-dropzone" id="genTabFrame${frameNum}PickBtn">
            <svg class="frame-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
            <span class="frame-dropzone-text">${window.I18n?.t('gen.selectImage') || 'Select image'}</span>
          </div>`;
        // Re-bind click on new dropzone
        body.querySelector('.frame-dropzone')?.addEventListener('click', () => {
          GenTab._openFramePicker(frameNum);
        });
      }
    }

    GenTab.saveState();
  }

  /**
   * Render frame previews from saved state (called during loadState)
   */
  static _renderFramePreviews() {
    const frame1Id = document.getElementById('genTabFrame1FileId')?.value?.trim() || '';
    const frame2Id = document.getElementById('genTabFrame2FileId')?.value?.trim() || '';

    // Try to get thumbnails from cache
    const thumb1 = GenTab.thumbnailCache?.[frame1Id] || null;
    const thumb2 = GenTab.thumbnailCache?.[frame2Id] || null;

    if (frame1Id) {
      GenTab._setFrameImage(1, frame1Id, thumb1);
    }
    if (frame2Id) {
      GenTab._setFrameImage(2, frame2Id, thumb2);
    }
  }

  // ─── Prompt count ─────────────────────────────────────────
  static updatePromptCount() {
    const text = GenTab.promptsArea.value.trim();
    if (!text) {
      // Xoá trắng ô → RESET multi-prompt về tắt. Tránh chế độ multi (tự bật từ import .txt / retry
      // prompt lỗi trước đó) còn sót lại rồi CẮT OAN prompt mới gõ theo dòng trống. Batch action tự
      // bật lại khi cần. Fix "prompt bị tách sai" (2026-07-11).
      if (GenTab.multiPromptCheck && GenTab.multiPromptCheck.checked) {
        GenTab.multiPromptCheck.checked = false;
        try { GenTab.multiPromptCheck.dispatchEvent(new Event('change', { bubbles: true })); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#onConfirm', _); }
      }
      GenTab.promptCountSpan.textContent = '0';
      // Update ratio count display
      GenTab._updateRefModeUI();
      return;
    }

    let baseLinesCount = 1;
    if (GenTab.multiPromptCheck && GenTab.multiPromptCheck.checked) {
      baseLinesCount = text.split(/\n\s*\n/).map(b => b.trim()).filter(b => b.length > 0).length;
    }

    // Hiển thị số prompt và quantity (số ảnh mỗi lần)
    const quantity = parseInt(GenTab.quantitySelect?.value) || 1;
    const totalImages = baseLinesCount * quantity;
    const promptsHtml = `<span class="gen-count-num">${baseLinesCount}</span>`;
    const imagesHtml = `<span class="gen-count-num">${totalImages}</span>`;
    const countSummary = window.I18n?.t('gen.countSummary', { prompts: promptsHtml, images: imagesHtml });
    GenTab.promptCountSpan.innerHTML = (countSummary && !countSummary.includes('gen.countSummary'))
      ? countSummary
      : `${promptsHtml} prompt → ${imagesHtml} output(s)`;

    // Update ratio count display
    GenTab._updateRefModeUI();
  }

  // ─── Update ref images count (sequential mode) ──────────
  // NOTE: Disabled - now using ratioCount in _updateRefModeUI() instead
  static _updateRefImagesCount() {
    // Hide the old count element (replaced by ratioCount)
    const countEl = document.getElementById('refImagesCount');
    if (countEl) {
      countEl.classList.add('hidden');
    }
  }

  // ─── Import .txt file ──────────────────────────────────────
  /**
   * Đọc file .txt/.csv, tách theo dòng, lọc dòng trống và comment (#),
   * ghép bằng 2 dòng trống (multi-prompt separator), append vào promptsArea.
   */
  static importTxtFile(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      const lines = content
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));

      if (lines.length === 0) {
        console.log('[SEOSONA Flow] File trống hoặc chỉ chứa comment');
        if (window.customDialog) {
          window.customDialog.alert(
            window.I18n?.t('genNotify.uploadEmptyFile') || 'File trống hoặc chỉ chứa dòng comment (#).',
            { title: window.I18n?.t('genNotify.uploadEmptyTitle') || 'Không có prompt', type: 'warning' }
          );
        }
        return;
      }

      // Ghép các dòng bằng double newline (multi-prompt separator)
      const importedText = lines.join('\n\n');

      // Append vào promptsArea (thêm separator nếu đã có nội dung)
      const currentText = GenTab.promptsArea.value.trim();
      if (currentText.length > 0) {
        GenTab.promptsArea.value = currentText + '\n\n' + importedText;
      } else {
        GenTab.promptsArea.value = importedText;
      }

      // Tự bật multi-prompt nếu có nhiều hơn 1 prompt
      if (lines.length > 1 && GenTab.multiPromptCheck && !GenTab.multiPromptCheck.checked) {
        GenTab.multiPromptCheck.checked = true;
        GenTab.multiPromptCheck.dispatchEvent(new Event('change'));
      }

      GenTab.updatePromptCount();
      GenTab.saveState();
      console.log(`[SEOSONA Flow] Đã import ${lines.length} prompt(s) từ file "${file.name}"`);
      sendLog(`Đã import ${lines.length} prompt(s) từ file "${file.name}"`, 'success');
      window.showNotification?.(
        window.I18n?.t('genNotifyExtra.promptsImported', { count: lines.length }) || `Đã nhập ${lines.length} prompt`,
        'success'
      );
    };

    reader.onerror = () => {
      console.error('[SEOSONA Flow] Lỗi đọc file:', reader.error);
      if (window.customDialog) {
        window.customDialog.alert(
          window.I18n?.t('genNotify.fileReadFailed') || 'Không thể đọc file. Vui lòng thử lại.',
          { title: window.I18n?.t('genNotify.fileReadFailedTitle') || 'Lỗi đọc file', type: 'error' }
        );
      }
    };

    reader.readAsText(file, 'UTF-8');
  }

  // ─── Load state from storage ──────────────────────────────
  static loadState(state) {
    // Restore prompt text only
    // fileIds + refImageNames: KHÔNG restore — tile IDs thay đổi sau reload, thumbnails mất
    if (GenTab.promptsArea) {
      // KHÔNG load prompt từ global state nữa để tránh ám chữ.
      // GenTab.promptsArea.value = state.prompts || '';
      GenTab.promptsArea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Restore UI state (user's last selection on GenTab)
    if (state.videoInputType && GenTab.videoInputTypeSelect) {
      GenTab.videoInputTypeSelect.value = state.videoInputType;
    } else if (GenTab.videoInputTypeSelect) {
      // 2026-05-29: Fresh session — đọc default từ StorageSettings (admin tune qua /admin/default-settings)
      const _vitDefault = window.storageSettings?.get?.('defaultVideoInputType');
      if (_vitDefault === 'Ingredients' || _vitDefault === 'Frames') {
        GenTab.videoInputTypeSelect.value = _vitDefault;
      }
    }

    // af_settings WINS state cho genType/ratio/imageModel/videoModel — Settings popup là source of truth.
    // State cũ chỉ wins khi af_settings không có key tương ứng (legacy users chưa từng mở Settings popup).
    // Lý do: state lưu mỗi lần submit nên stale; user đổi Settings phải apply ngay sau reload.
    // GenTab aspectRatioSelect dùng NUMERIC ('16:9','4:3','1:1','3:4','9:16').
    const _afSettings = window.storageSettings?.getSettings() || {};
    // Map legacy VN ratio → numeric cho fallback (StorageSettings.defaultRatio = 'Dọc').
    const _ratioVnToNumeric = { 'Ngang': '16:9', 'Dọc': '9:16', 'Vuông': '1:1' };
    const _legacyRatioNumeric = _ratioVnToNumeric[_afSettings.defaultRatio] || _afSettings.defaultRatio;

    // genType: af_settings wins state
    const _effectiveGenType = _afSettings.defaultGenType || state.genType;
    if (_effectiveGenType && GenTab.genTypeSelect) {
      GenTab.genTypeSelect.value = _effectiveGenType;
      GenTab.genTypeSelect.dispatchEvent(new Event('change'));
      const genTypeToggle = document.getElementById('genTypeToggle');
      if (genTypeToggle) {
        genTypeToggle.querySelectorAll('.gen-type-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.value === _effectiveGenType);
        });
      }
    }

    // ratio: af_settings wins state. Ưu tiên key numeric (defaultImageRatio/defaultVideoRatio), fallback legacy VN.
    const _isVideoGen = _effectiveGenType === 'Video';
    const _afEffectiveRatio = _isVideoGen
      ? (_afSettings.defaultVideoRatio || _legacyRatioNumeric)
      : (_afSettings.defaultImageRatio || _legacyRatioNumeric);
    const _effectiveRatio = _afEffectiveRatio || state.aspectRatio;
    if (_effectiveRatio && GenTab.aspectRatioSelect) GenTab.aspectRatioSelect.value = _effectiveRatio;

    // model: af_settings wins state
    const _effectiveImageModel = _afSettings.defaultImageModel || state.imageModel;
    if (_effectiveImageModel && GenTab.imageModelSelect) GenTab.imageModelSelect.value = _effectiveImageModel;

    const _effectiveVideoModel = _afSettings.defaultVideoModel || state.videoModel;
    if (_effectiveVideoModel && GenTab.videoModelSelect) GenTab.videoModelSelect.value = _effectiveVideoModel;

    // Multi-prompt default OFF
    if (GenTab.multiPromptCheck) GenTab.multiPromptCheck.checked = false;
    const runModeRow = document.querySelector('.gen-run-mode-row');
    if (runModeRow) runModeRow.classList.add('hidden');
    const multiPromptHint = document.getElementById('multiPromptHint');
    if (multiPromptHint) multiPromptHint.classList.add('hidden');

    // Restore run mode — default 'parallel' (design default)
    // BUG FIX: ChatGPT/Grok force sequential → saved to state → stuck on sequential.
    // Always default to 'parallel' since that's the intended default behavior.
    GenTab.runMode = 'parallel';
    GenTab._updateRunModeUI();

    // S5: refImageNames KHÔNG restore — không dùng lại được sau reload
    // GenTab.refImageNames = {} (default từ class definition)

    // S5.1: Cleanup orphan names — skip vì không restore refImageNames
    const currentFileIds = (GenTab.fileIdsInput?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const currentFileIdSet = new Set(currentFileIds);
    let hasOrphans = false;
    Object.keys(GenTab.refImageNames).forEach(fileId => {
      if (!currentFileIdSet.has(fileId)) {
        console.log('[GenTab] Removing orphan name:', fileId, GenTab.refImageNames[fileId]);
        delete GenTab.refImageNames[fileId];
        hasOrphans = true;
      }
    });
    // Save immediately if orphans were removed to prevent them from persisting
    if (hasOrphans) {
      GenTab.saveState();
    }

    // S4: Restore ref image mode
    GenTab.refImageMode = state.refImageMode || 'all';
    if (GenTab.refImageModeSelect) {
      GenTab.refImageModeSelect.value = GenTab.refImageMode;
    }
    GenTab._updateRefModeUI();

    // Flow Voice Selector — restore saved slug + apply visibility
    if (state.selectedVoiceSlug) {
      const hiddenSel = document.getElementById('genVideoVoiceSelect');
      if (hiddenSel) hiddenSel.value = state.selectedVoiceSlug;
    }
    if (state.selectedCharacterSlug) {
      const hiddenSelC = document.getElementById('genCharacterSelect');
      if (hiddenSelC) hiddenSelC.value = state.selectedCharacterSlug;
    }
    try { GenTab._applyVoicePickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#onerror', _); }
    try { GenTab._applyCharacterPickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#onerror', _); }

    // Restore frame file IDs and render previews with thumbnails
    const frame1Input = document.getElementById('genTabFrame1FileId');
    const frame2Input = document.getElementById('genTabFrame2FileId');
    if (state.frame1FileId && frame1Input) {
      frame1Input.value = state.frame1FileId;
    }
    if (state.frame2FileId && frame2Input) {
      frame2Input.value = state.frame2FileId;
    }
    // Render frame previews with thumbnails from cache
    GenTab._renderFramePreviews();

    // Restore per-prompt frame data
    if (state.perPromptFrameData && Array.isArray(state.perPromptFrameData)) {
      GenTab._perPromptFrameData = state.perPromptFrameData;
    }
    // Update frame mode after restoring state
    GenTab._updateFrameMode();

    // Restore auto-download toggle + resolution
    // af_settings wins when state doesn't have value (giống logic genType/ratio/model)
    const autoDownloadToggle = document.getElementById('genTabAutoDownload');
    if (autoDownloadToggle) {
      // Ưu tiên: state có giá trị → dùng state, không → dùng af_settings default
      const effectiveAutoDownload = state.autoDownload !== undefined
        ? state.autoDownload
        : (_afSettings.autoDownload || false);
      autoDownloadToggle.checked = effectiveAutoDownload;
    }
    const genTabDownloadRes = document.getElementById('genTabDownloadResolution');
    if (genTabDownloadRes) {
      // Ưu tiên: state có giá trị → dùng state, không → dùng af_settings default
      const effectiveDownloadRes = state.downloadResolution || _afSettings.downloadResolution || '1k';
      genTabDownloadRes.value = effectiveDownloadRes;
      if (state.downloadResolution) {
        genTabDownloadRes.dataset.userSet = '1';
      }
    }
    // Restore video download resolution
    const genTabVideoDownloadRes = document.getElementById('genTabVideoDownloadResolution');
    if (genTabVideoDownloadRes) {
      // Ưu tiên: state có giá trị → dùng state, không → dùng af_settings default
      const effectiveVideoDownloadRes = state.videoDownloadResolution || _afSettings.videoDownloadResolution || '1080p';
      genTabVideoDownloadRes.value = effectiveVideoDownloadRes;
      if (state.videoDownloadResolution) {
        genTabVideoDownloadRes.dataset.userSet = '1';
      }
    }
    // Restore subfolder
    const genTabSubFolder = document.getElementById('genTabSubFolder');
    if (genTabSubFolder && state.genSubFolder) {
      genTabSubFolder.value = state.genSubFolder;
    }
    // Sync visibility using single source of truth (fixes toggle ON but controls hidden bug)
    if (GenTab._syncDownloadVisibility) {
      GenTab._syncDownloadVisibility();
    }
    // Fallback for edge case where _syncDownloadVisibility not yet initialized
    const genTabDownloadResWrap2 = document.getElementById('genTabDownloadResWrap');
    const genTabVideoDownloadResWrap2 = document.getElementById('genTabVideoDownloadResWrap');
    if (!GenTab._syncDownloadVisibility) {
      const isVideo = GenTab.genTypeSelect?.value === 'Video';
      const genTabSubFolder2 = document.getElementById('genTabSubFolder');
      if (autoDownloadToggle?.checked) {
        if (genTabSubFolder2) genTabSubFolder2.classList.remove('hidden');
        if (genTabDownloadResWrap2) genTabDownloadResWrap2.classList.toggle('hidden', isVideo);
        if (genTabVideoDownloadResWrap2) genTabVideoDownloadResWrap2.classList.toggle('hidden', !isVideo);
      } else {
        if (genTabSubFolder2) genTabSubFolder2.classList.add('hidden');
        if (genTabDownloadResWrap2) genTabDownloadResWrap2.classList.add('hidden');
        if (genTabVideoDownloadResWrap2) genTabVideoDownloadResWrap2.classList.add('hidden');
      }
    }

    // Q1.9: KHÔNG khôi phục style (addon prompt) ngầm nữa (2026-07-11). Trước đây style đã chọn được
    // lưu + tự áp lại → nối "cinematic, 8k…" vào MỌI prompt mà user không thấy (dropdown ẩn) → tưởng
    // extension làm sai nội dung. Giờ mỗi phiên style về RỖNG; user chủ động chọn lại nếu muốn.

    // Gọi render thumbnail nếu có fileIds
    if (typeof GenTab.renderFileIdThumbnails === 'function') setTimeout(GenTab.renderFileIdThumbnails, 200);
  }

  // ─── ExecutionLock UI banner ──────────────────────────────
  static _updateLockBanner(state) {
    const bannerId = 'executionLockBanner';
    let banner = document.getElementById(bannerId);

    // Pipeline mode bật → không block bất kỳ tab nào (PromptQueue orchestrate đồng thời)
    const isPipelineOn = window.PromptQueue && PromptQueue.isEnabled();
    if (!state.locked || state.owner === 'prompts' || state.owner === 'queue' || isPipelineOn) {
      if (banner) banner.remove();
      if (GenTab.startBtn) GenTab.startBtn.disabled = false;
      return;
    }

    // Đang bị block bởi tác vụ khác
    if (GenTab.startBtn) GenTab.startBtn.disabled = true;

    if (!banner) {
      banner = document.createElement('div');
      banner.id = bannerId;
      banner.className = 'execution-lock-banner';
      // Chèn trước startBtn
      const startBtnParent = GenTab.startBtn?.parentElement;
      if (startBtnParent) {
        startBtnParent.insertBefore(banner, GenTab.startBtn);
      }
    }

    banner.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span>Đang chạy: ${state.label || state.owner}</span>
    `;
  }

  // ─── Q1.6: Addon Prompts (Phong Cách) ───────────────────────
  // Strict Server-Only: backend AddonPromptSeeder seed ~30 items (multi-category).
  // Khi API fail và cache empty → empty array, UI render placeholder "Chưa có style".

  // Cache TTL: 24 hours
  static _ADDON_CACHE_TTL = 24 * 60 * 60 * 1000;

  /**
   * Load addon prompts from cache or API
   */
  static async _loadAddonPrompts() {
    // Try cache first
    const cached = await GenTab._getAddonPromptsFromCache();
    if (cached) {
      GenTab.addonPrompts = cached;
      GenTab._renderAddonPromptSelect();
      // Refresh in background after cache hit
      GenTab._fetchAddonPromptsFromApi().catch(function (_e) { globalThis.SEOSONA_swallow?.('GenTab#onerror', _e); });
      return;
    }

    // No cache or expired, fetch from API
    const fetched = await GenTab._fetchAddonPromptsFromApi();
    if (fetched) {
      GenTab.addonPrompts = fetched;
    } else {
      // Strict Server-Only: API fail và cache empty → empty list, UI placeholder.
      console.debug('[Tier3] Addon prompts API fail và cache empty — render empty list');
      GenTab.addonPrompts = [];
    }
    GenTab._renderAddonPromptSelect();
  }

  /**
   * Get cached addon prompts if valid
   */
  static async _getAddonPromptsFromCache() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['af_addon_prompts'], (result) => {
        const cached = result.af_addon_prompts;
        if (!cached || !cached.data || !cached.timestamp) {
          resolve(null);
          return;
        }

        const age = Date.now() - cached.timestamp;
        if (age > GenTab._ADDON_CACHE_TTL) {
          resolve(null);
          return;
        }

        resolve(cached.data);
      });
    });
  }

  /**
   * Fetch addon prompts from backend API via background.js proxy
   */
  static async _fetchAddonPromptsFromApi() {
    // Local mode: fallback to default list
    if (self.SEOSONA_LOCAL_MODE !== false) {
      return window.SEOSONA_STYLES || [];
    }
    return new Promise((resolve) => {
      // Get auth token if available
      chrome.storage.local.get(['af_auth'], (authResult) => {
        const token = authResult.af_auth?.token || null;

        chrome.runtime.sendMessage({
          action: 'apiRequest',
          method: 'GET',
          endpoint: 'addon-prompts',
          token: token
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('[SEOSONA Flow] Addon prompts API error:', chrome.runtime.lastError.message);
            resolve(null);
            return;
          }

          if (response?.success && Array.isArray(response.data)) {
            // Save to cache
            chrome.storage.local.set({
              af_addon_prompts: {
                data: response.data,
                timestamp: Date.now()
              }
            });
            resolve(response.data);
          } else {
            console.warn('[SEOSONA Flow] Addon prompts API failed:', response?.error?.message);
            resolve(null);
          }
        });
      });
    });
  }

  /**
   * Render addon prompts into select dropdown and custom popup
   */
  static _renderAddonPromptSelect() {
    if (!GenTab.addonPromptSelect) return;

    // Build options HTML for hidden select (compatibility)
    let html = '<option value="">Phong cách</option>';
    for (const addon of GenTab.addonPrompts) {
      const id = addon.id;
      const name = addon.name || 'Không tên';
      html += `<option value="${id}">${name}</option>`;
    }
    GenTab.addonPromptSelect.innerHTML = html;

    // Render custom dropdown list
    GenTab._renderAddonPromptList();

    // KHÔNG khôi phục style đã lưu (2026-07-11) — style về RỖNG mỗi phiên để không âm thầm nối vào
    // mọi prompt. User tự chọn lại nếu muốn. (Xem lý do ở _restoreState.)
  }

  /**
   * Render addon prompt list items in custom dropdown
   */
  static _renderAddonPromptList(filter = '') {
    const listEl = document.getElementById('addonPromptList');
    if (!listEl) return;

    const searchTerm = filter.toLowerCase().trim();
    const selectedId = GenTab.addonPromptSelect?.value || '';

    let html = `
      <div class="addon-prompt-item none-option${!selectedId ? ' selected' : ''}" data-id="">
        <span class="addon-prompt-name">Không chọn phong cách</span>
      </div>
    `;

    const filtered = searchTerm
      ? GenTab.addonPrompts.filter(a => (a.name || '').toLowerCase().includes(searchTerm))
      : GenTab.addonPrompts;

    if (filtered.length === 0 && searchTerm) {
      html += '<div class="addon-prompt-empty">Không tìm thấy phong cách</div>';
    } else {
      for (const addon of filtered) {
        const id = addon.id;
        const name = addon.name || 'Không tên';
        const image = addon.thumbnail_url || '';
        const isSelected = String(id) === String(selectedId);

        const thumbHtml = image
          ? `<img class="addon-prompt-thumb" src="${image}" alt="${name}" loading="lazy" />`
          : `<div class="addon-prompt-thumb-placeholder">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"></path>
              </svg>
            </div>`;

        html += `
          <div class="addon-prompt-item${isSelected ? ' selected' : ''}" data-id="${id}">
            ${thumbHtml}
            <div class="addon-prompt-info">
              <div class="addon-prompt-name">${name}</div>
            </div>
          </div>
        `;
      }
    }

    listEl.innerHTML = html;

    // Add click handlers
    listEl.querySelectorAll('.addon-prompt-item').forEach(item => {
      item.addEventListener('click', () => {
        const id = item.dataset.id;
        GenTab._selectAddonPrompt(id);
      });
    });
  }

  /**
   * Select an addon prompt from custom dropdown
   */
  static _selectAddonPrompt(id) {
    // Update hidden select
    if (GenTab.addonPromptSelect) {
      GenTab.addonPromptSelect.value = id;
    }

    // Update trigger button label
    GenTab._updateAddonPromptTrigger();

    // Close popup
    GenTab._closeAddonPromptPopup();

    // Re-render list to update selected state
    GenTab._renderAddonPromptList();

    // Save state
    GenTab.saveState();
  }

  /**
   * Update addon prompt trigger button label
   */
  static _updateAddonPromptTrigger() {
    const trigger = document.getElementById('addonPromptTrigger');
    const label = trigger?.querySelector('.addon-prompt-label');
    if (!trigger || !label) return;

    const selectedId = GenTab.addonPromptSelect?.value || '';
    if (!selectedId) {
      label.textContent = window.I18n?.t('genNotify.styleLabel') || 'Phong cách';
      trigger.classList.remove('has-value');
    } else {
      const addon = GenTab.addonPrompts.find(a => String(a.id) === String(selectedId));
      label.textContent = addon?.name || window.I18n?.t('genNotify.styleLabel') || 'Phong cách';
      trigger.classList.add('has-value');
    }
  }

  /**
   * Close addon prompt popup
   */
  static _closeAddonPromptPopup() {
    const dropdown = document.getElementById('addonPromptDropdown');
    const popup = document.getElementById('addonPromptPopup');
    const searchInput = document.getElementById('addonPromptSearch');

    if (dropdown) dropdown.classList.remove('open');
    if (popup) popup.classList.add('hidden');
    if (searchInput) searchInput.value = '';
  }

  /**
   * Initialize addon prompt dropdown events
   * Now uses StyleSelectModal instead of inline popup
   */
  static _initAddonPromptDropdown() {
    const trigger = document.getElementById('addonPromptTrigger');
    if (!trigger) return;

    // Open modal on trigger click
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      GenTab._openStyleSelectModal();
    });
  }

  /**
   * Open StyleSelectModal for addon prompt selection
   */
  static _openStyleSelectModal() {
    if (!window.StyleSelectModal) {
      console.warn('[GenTab] StyleSelectModal not loaded');
      return;
    }

    window.StyleSelectModal.show({
      addons: GenTab.addonPrompts,
      selectedId: GenTab.addonPromptSelect?.value || null,
      onSelect: (addon) => {
        GenTab._selectAddonPrompt(addon?.id || '');
      }
    });
  }

  /**
   * Get selected addon prompt object
   */
  static _getSelectedAddonPrompt() {
    if (!GenTab.addonPromptSelect) return null;
    const selectedId = GenTab.addonPromptSelect.value;
    if (!selectedId) return null;
    return GenTab.addonPrompts.find(a => String(a.id) === String(selectedId)) || null;
  }

  /**
   * Toggle run mode between sequential and parallel
   */
  static _toggleRunMode() {
    const isParallel = GenTab.runMode === 'parallel';
    GenTab.runMode = isParallel ? 'sequential' : 'parallel';
    console.log('[GenTab] Toggle runMode:', isParallel ? 'parallel→sequential' : 'sequential→parallel', 'new value:', GenTab.runMode);
    GenTab._updateRunModeUI();
    GenTab.saveState();
  }

  /**
   * Update run mode button UI based on current state
   */
  static _updateRunModeUI() {
    const btn = GenTab.genRunModeBtn;
    if (!btn) {
      console.log('[GenTab] _updateRunModeUI: btn not found');
      return;
    }

    const isParallel = GenTab.runMode === 'parallel';
    console.log('[GenTab] _updateRunModeUI: runMode=', GenTab.runMode, 'isParallel=', isParallel);
    const label = btn.querySelector('.gen-run-mode-label');
    const svg = btn.querySelector('svg');

    if (label) {
      label.textContent = isParallel
        ? (window.I18n?.t('gen.parallelLabel') || 'Song song')
        : (window.I18n?.t('gen.sequentialLabel') || 'Tuần tự');
    }
    btn.title = isParallel
      ? (window.I18n?.t('gen.parallelTitle') || 'Chế độ chạy: Song song (không chờ kết quả giữa các prompt)')
      : (window.I18n?.t('gen.sequentialTitle') || 'Chế độ chạy: Tuần tự (chờ kết quả từng prompt)');

    // Update icon: parallel = 3 lines, sequential = checklist
    if (svg) {
      if (isParallel) {
        // Song Song: three horizontal lines
        svg.innerHTML = `
          <line x1="4" y1="6" x2="20" y2="6"></line>
          <line x1="4" y1="12" x2="20" y2="12"></line>
          <line x1="4" y1="18" x2="20" y2="18"></line>
        `;
      } else {
        // Tuần Tự: checklist with checkmarks
        svg.innerHTML = `
          <line x1="10" y1="6" x2="21" y2="6"></line>
          <line x1="10" y1="12" x2="21" y2="12"></line>
          <line x1="10" y1="18" x2="21" y2="18"></line>
          <polyline points="3 6 4 7 6 5"></polyline>
          <polyline points="3 12 4 13 6 11"></polyline>
          <polyline points="3 18 4 19 6 17"></polyline>
        `;
      }
    }

    // Toggle active class for parallel mode
    btn.classList.toggle('active', isParallel);
  }

  /**
   * Update run mode button visibility based on provider and multi-prompt mode
   * Only show for Flow provider + multi-prompt mode (ChatGPT/Grok luôn chạy tuần tự)
   */
  static _updateRunModeVisibility() {
    const runModeRow = document.querySelector('.gen-run-mode-row');
    if (!runModeRow) return;

    const isMulti = GenTab.multiPromptCheck?.checked;
    const provider = GenTab.providerSelect?.value || 'flow';
    const isFlow = provider === 'flow';
    const showRunMode = isMulti && isFlow;

    runModeRow.classList.toggle('hidden', !showRunMode);
    // Update button styling when showing
    if (showRunMode) {
      GenTab._updateRunModeUI();
    }
  }

  /**
   * Cleanup unavailable upload_ refs from fileIds
   * Called after PendingUploadStore.restore() to remove stale uploads
   */
  static cleanupUnavailableUploads() {
    if (!GenTab.fileIdsInput) return;

    const currentIds = GenTab.fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    if (currentIds.length === 0) return;

    // Filter out upload_ IDs that are not in pendingUploadFiles
    const validIds = currentIds.filter(id => {
      if (!id.startsWith('upload_')) return true; // Keep non-upload IDs (tile IDs)

      // Check if upload exists in memory (restored from IndexedDB)
      const exists = window.pendingUploadFiles?.has(id);
      if (!exists) {
        console.log('[GenTab] Removing unavailable upload ref:', id);
      }
      return exists;
    });

    // Update if any IDs were removed
    if (validIds.length !== currentIds.length) {
      const removed = currentIds.length - validIds.length;
      GenTab.fileIdsInput.value = validIds.join(', ');
      GenTab.saveState();
      GenTab.renderFileIdThumbnails();
      console.log(`[GenTab] Removed ${removed} unavailable upload ref(s)`);
    }
  }

  /**
   * Apply settings từ StorageSettings (settings-popup) vào GenTab UI.
   * StorageSettings là source of truth cho: timing, download settings.
   * presets lưu UI state (genType, ratio, model — user's last selection trên GenTab).
   */
  static _applyStorageSettings() {
    const s = window.storageSettings?.getSettings?.();
    if (!s) return;

    // Timing settings now read directly from storageSettings when needed
    // (inputTimeout, delayBetweenPrompts inputs removed from sidebar)

    // GenType (Image/Video) - Settings popup is source of truth
    if (s.defaultGenType && GenTab.genTypeSelect) {
      GenTab.genTypeSelect.value = s.defaultGenType;
      GenTab.genTypeSelect.dispatchEvent(new Event('change'));
      const genTypeToggle = document.getElementById('genTypeToggle');
      if (genTypeToggle) {
        genTypeToggle.querySelectorAll('.gen-type-btn').forEach(btn => {
          btn.classList.toggle('active', btn.dataset.value === s.defaultGenType);
        });
      }
    }

    // Ratio - Settings popup is source of truth
    const isVideo = GenTab.genTypeSelect?.value === 'Video';
    const effectiveRatio = isVideo ? s.defaultVideoRatio : s.defaultImageRatio;
    if (effectiveRatio && GenTab.aspectRatioSelect) {
      GenTab.aspectRatioSelect.value = effectiveRatio;
    }

    // Model - Settings popup is source of truth
    if (s.defaultImageModel && GenTab.imageModelSelect) {
      GenTab.imageModelSelect.value = s.defaultImageModel;
    }
    if (s.defaultVideoModel && GenTab.videoModelSelect) {
      GenTab.videoModelSelect.value = s.defaultVideoModel;
    }

    // Download
    const autoDownloadToggle = document.getElementById('genTabAutoDownload');
    if (autoDownloadToggle && s.autoDownload !== undefined) {
      autoDownloadToggle.checked = s.autoDownload || false;
    }

    // Sync download visibility
    if (GenTab._syncDownloadVisibility) GenTab._syncDownloadVisibility();
  }

  // ─── Save state to storage ────────────────────────────────
  static _saveStateImmediate() {
    // presets chỉ lưu prompt text + UI state nhỏ
    // Settings (model, ratio, timing, download) đọc từ StorageSettings (af_settings)
    // KHÔNG lưu: thumbnailCache, fileNameCache, fileIds, refImageNames
    // (session-only — không restore được sau extension reload vì tile IDs thay đổi)
    const state = {
      // prompts: GenTab.promptsArea.value, // KHÔNG LƯU NỮA để ô nhập liệu luôn trắng khi khởi động lại

      // fileIds: KHÔNG lưu — tile IDs thay đổi sau reload, thumbnails mất
      // UI state (user đang chọn gì trên GenTab)
      genType: GenTab.genTypeSelect.value,
      aspectRatio: GenTab.aspectRatioSelect ? GenTab.aspectRatioSelect.value : '16:9',
      imageModel: GenTab.imageModelSelect ? GenTab.imageModelSelect.value : '',
      videoModel: GenTab.videoModelSelect ? GenTab.videoModelSelect.value : '',
      videoInputType: GenTab.videoInputTypeSelect ? GenTab.videoInputTypeSelect.value : 'Frames',
      // Run mode toggle (parallel / sequential).
      // BUG FIX (2026-05-02): trước đây không persist → loadState fallback default 'parallel'
      // → user toggle sequential nhưng sau reload extension lại revert về parallel.
      runMode: GenTab.runMode || 'parallel',
      // Ref image state
      refImageMode: GenTab.refImageMode || 'all',
      // refImageNames: KHÔNG lưu — không dùng lại được sau reload
      // Addon prompt
      selectedAddonPromptId: GenTab.addonPromptSelect ? GenTab.addonPromptSelect.value : '',
      // Flow Voice Selector
      selectedVoiceSlug: document.getElementById('genVideoVoiceSelect')?.value || '',
      selectedCharacterSlug: document.getElementById('genCharacterSelect')?.value || '',
      // Download subfolder (user-entered)
      genSubFolder: document.getElementById('genTabSubFolder')?.value || 'seosonaflow-01',
    };
    chrome.storage.local.set({ seosona_gentab_state: state });
  }

  // ─── Upload preview render ────────────────────────────────
  static renderUploadPreview() {
    const previewContainer = document.getElementById('imagePreviewContainer');
    const executeBtn = document.getElementById('executeUploadBtn');

    if (!previewContainer || !executeBtn) return;

    GenTab._previewBlobUrls.forEach(url => {
      try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ }
    });
    GenTab._previewBlobUrls = [];

    previewContainer.innerHTML = '';

    if (GenTab.selectedFilesForUpload.length === 0) {
      executeBtn.classList.add('hidden');
      return;
    }

    executeBtn.classList.remove('hidden');

    GenTab.selectedFilesForUpload.forEach((file, index) => {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = 'position: relative; display: inline-block; margin-right: 5px; margin-bottom: 5px; overflow: hidden; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2);';

      const img = document.createElement('img');
      const blobUrl = URL.createObjectURL(file);
      GenTab._previewBlobUrls.push(blobUrl);
      img.src = blobUrl;
      img.style.width = '40px';
      img.style.height = '40px';
      img.style.objectFit = 'cover';
      img.style.display = 'block';
      img.title = file.name;

      const removeBtn = document.createElement('div');
      removeBtn.innerHTML = '×';
      removeBtn.className = 'img-remove-btn';
      removeBtn.style.cssText = `
                position: absolute; top: 0; right: 0; background: rgba(0,0,0,0.6); color: white;
                width: 14px; height: 14px; display: flex; align-items: center; justify-content: center;
                font-size: 10px; cursor: pointer; border-bottom-left-radius: 4px; font-weight: bold;
            `;

      removeBtn.addEventListener('click', () => {
        GenTab.selectedFilesForUpload.splice(index, 1); // Bỏ file tại vị trí
        GenTab.renderUploadPreview(); // Vẽ lại ui
      });

      wrapper.appendChild(img);
      wrapper.appendChild(removeBtn);
      previewContainer.appendChild(wrapper);
    });
  }

  // ─── isTileError ──────────────────────────────────────────
  // Hàm kiểm tra xem Tile có thực sự bị lỗi không (bỏ qua các Template lỗi ẩn của Google)
  // LƯU Ý: Tile đang processing cũng chứa sẵn template lỗi (delete_forever, "Không thành công")
  //         nhưng bị ẩn bởi opacity: 0 trên ancestor div. Phải luôn check visibility!
  static isTileError(tileEl) {
    if (!tileEl) return false;

    // Check 1: Nút delete_forever VISIBLE (không bị ẩn bởi opacity: 0 ở ancestor)
    // Fail tile: delete_forever nằm trong div có opacity: 1
    // Processing tile: delete_forever nằm trong div có opacity: 0 → bỏ qua
    const hasVisibleDeleteBtn = Array.from(tileEl.querySelectorAll('button')).some(btn => {
      const icon = btn.querySelector('i');
      if (!icon || icon.textContent.trim() !== 'delete_forever') return false;
      const isHidden = !!btn.closest('[style*="opacity: 0"]');
      return !isHidden;
    });
    if (hasVisibleDeleteBtn) return true;

    // Check 2: Text lỗi "Không thành công" với data-state="open" và không bị ẩn
    const tileText = tileEl.textContent || '';
    if (tileText.includes('Không thành công')) {
      const errorNodes = Array.from(tileEl.querySelectorAll('div, span')).filter(el => el.textContent.trim() === 'Không thành công');
      for (let node of errorNodes) {
        const closestStateSpan = node.closest('span[data-state]');
        const isStateOpen = closestStateSpan && closestStateSpan.getAttribute('data-state') === 'open';
        const isHiddenOpacity = !!node.closest('[style*="opacity: 0"]');

        if (isStateOpen && !isHiddenOpacity) {
          return true;
        }
      }
    }

    // Check 3: Icon warning VISIBLE (không bị ẩn) — backup check
    const warningIcons = Array.from(tileEl.querySelectorAll('i')).filter(i => i.textContent.trim() === 'warning');
    for (let icon of warningIcons) {
      const isHidden = !!icon.closest('[style*="opacity: 0"]');
      if (!isHidden) {
        // Có icon warning visible + không có img/video = tile lỗi
        const hasMedia = tileEl.querySelector('img[src*="media"], video');
        if (!hasMedia) return true;
      }
    }

    return false;
  }

  // ─── deleteFailedTile ─────────────────────────────────────
  // Hàm bấm nút Xoá trên tile bị fail để dọn dẹp UI
  static async deleteFailedTile(tileId) {
    try {
      const tileEl = document.querySelector(`div[data-tile-id="${tileId}"]`);
      if (!tileEl) return;

      // Tìm nút delete_forever bên trong tile
      const deleteBtn = Array.from(tileEl.querySelectorAll('button')).find(btn => {
        const icon = btn.querySelector('i');
        return icon && icon.textContent.trim() === 'delete_forever';
      });

      if (deleteBtn) {
        deleteBtn.click();
        sendLog(`Đã bấm Xoá tile lỗi ${tileId}`, 'info');
        await sleep(1000); // Chờ UI gỡ tile
      } else {
        sendLog(`Không tìm thấy nút Xoá trên tile ${tileId}`, 'warn');
      }
    } catch(e) {
      sendLog(`Lỗi khi xoá tile: ${e.message}`, 'warn');
    }
  }

  // ─── Core Upload Logic ────────────────────────────────────
  static async performFlowImageUpload(filesArray, executeBtnElement) {
    sendLog(`Đang giả lập tải lên ${filesArray.length} ảnh...`, 'info');

    executeBtnElement.innerHTML = '<span>...</span> Đang tải...';
    executeBtnElement.disabled = true;

    // Strict Server-Only: tile selector từ content.js helper (window._getTileSelectorString).
    const _tileSel = window._getTileSelectorString?.() || '[data-tile-id]';
    const existingTiles = Array.from(document.querySelectorAll(_tileSel)).map(el => el.getAttribute('data-tile-id'));

    try {
      const dataTransfer = new DataTransfer();
      filesArray.forEach(file => dataTransfer.items.add(file));

      const flowInputs = Array.from(document.querySelectorAll('input[type="file"]'));
      if (flowInputs.length === 0) {
        if (window.customDialog) window.customDialog.alert(
          window.I18n?.t('genNotify.uploadButtonNotFound') || 'Không tìm thấy nút Upload nội bộ của Flow. Giao diện có thể đã đổi.',
          { title: window.I18n?.t('genNotify.uploadFailedTitle') || 'Lỗi Upload', type: 'error' }
        );
        executeBtnElement.innerHTML = `<span>Upload</span> ${window.I18n?.t('genNotify.uploadFlow') || 'Upload lên Flow'}`;
        executeBtnElement.disabled = false;
        return null;
      }

      let injected = false;
      // Tiêm vào tất cả input để đảm bảo React bắt được Event
      for (let input of flowInputs) {
        try {
          input.files = dataTransfer.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
          injected = true;
        } catch (e) { globalThis.SEOSONA_swallow?.('GenTab#onSelect', e); }
      }
      if (!injected) throw new Error('Không thể ghi đè file vào hệ thống Input');
      sendLog('Bypass hoàn tất. Đang ra lệnh React Upload Component chạy...', 'info');

    } catch (err) {
      if (window.customDialog) window.customDialog.alert(
        window.I18n?.t('genNotifyExtra.uploadDragFailed', { error: err.message }) || `Lỗi khi mô phỏng thao tác kéo thả File: ${err.message}.`,
        { title: window.I18n?.t('genNotify.uploadFailedTitle') || 'Lỗi Upload', type: 'error' }
      );
      executeBtnElement.innerHTML = `<span>Upload</span> ${window.I18n?.t('genNotifyExtra.uploadFlowLabel') || 'Upload lên Flow'}`;
      executeBtnElement.disabled = false;
      return null;
    }

    let newlyAddedIds = [];
    let waitTime = 0;
    const maxWait = 120000; // Tối đa 2 phút đợi upload

    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    while(waitTime < maxWait) {
      await sleep(2000);
      waitTime += 2000;

      const currentTiles = Array.from(document.querySelectorAll(_tileSel));
      const newTilesElements = currentTiles.filter(t => !existingTiles.includes(t.getAttribute('data-tile-id')));

      if (newTilesElements.length > 0) {
        let allUploaded = true;
        for (let t of newTilesElements) {
          const hasMedia = t.querySelector('img, video');
          const hasError = GenTab.isTileError(t);
          const isProcessing = t.textContent.includes('%') || t.textContent.toLowerCase().includes('đang');

          if (!hasError && (!hasMedia || isProcessing)) {
            allUploaded = false;
            break;
          }
        }

        if (allUploaded) {
          newlyAddedIds = newTilesElements.map(t => t.getAttribute('data-tile-id'));
          break;
        }
      }
    }

    newlyAddedIds = [...new Set(newlyAddedIds)];

    // Lọc bỏ ID đúp sinh ra do inject nhiều thẻ input
    if (newlyAddedIds.length > filesArray.length) {
      newlyAddedIds = newlyAddedIds.slice(0, filesArray.length);
    }

    if (newlyAddedIds.length > 0) {
      sendLog(`Lấy thành công ${newlyAddedIds.length} file ID(s) mới!`, 'success');
    } else {
      sendLog('Không tìm thấy file ID mới nào. Vui lòng thử lại.', 'warn');
    }

    executeBtnElement.innerHTML = '<span>Upload</span> Upload lên Flow';
    executeBtnElement.disabled = false;
    executeBtnElement.classList.add('hidden');

    if (typeof GenTab.renderFileIdThumbnails === 'function') {
      GenTab.renderFileIdThumbnails();
    }
    return newlyAddedIds;
  }

  // ═══════════════════════════════════════════════════════════════
  // S4: @Mention Mode
  // ═══════════════════════════════════════════════════════════════

  /**
   * S4.1: Update UI based on ref image mode
   * Modes: 'all' | 'mention' | 'sequential' | 'none'
   */
  // Khoá/mở ref-mode select khi đang upload ref images (tránh re-render mất trạng thái uploading).
  static _setRefModeUploadLock(locked) {
    GenTab._refModeLocked = !!locked;
    const sel = GenTab.refImageModeSelect;
    if (!sel) return;
    sel.disabled = !!locked;
    const wrap = sel.closest('.ref-mode-select');
    if (wrap) {
      wrap.classList.toggle('ref-mode-locked', !!locked);
      wrap.title = locked
        ? (window.I18n?.t('gen.refModeLockedUploading') || 'Đang upload ảnh — không thể đổi chế độ')
        : (window.I18n?.t('gen.refModeTitle') || 'Cách dùng ảnh tham chiếu');
    }
  }

  static _updateRefModeUI() {
    const mode = GenTab.refImageMode;
    const mentionHelper = GenTab.mentionHelper;
    const dragHint = document.getElementById('refImagesDragHint');
    const dragHintText = document.getElementById('refDragHintText');
    const ratioCount = document.getElementById('refRatioCount');

    // Mode 'none' → ẩn toàn bộ UI upload/select + preview thumbnails (giữ ref-mode-select để user đổi mode)
    const refSection = document.getElementById('refImagesSection');
    if (refSection) {
      refSection.classList.toggle('ref-mode-disabled', mode === 'none');
    }

    // Ẩn/hiện mention helper (chỉ cho mention mode + có ref images)
    // Bug fix: KHÔNG show "Image name:" label khi 0 ref images — _refreshMentionHelper sẽ
    // toggle hidden chính xác dựa trên currentIds.length
    if (mentionHelper) {
      if (mode !== 'mention') {
        mentionHelper.classList.add('hidden');
      } else {
        // mode === 'mention' → delegate to _refreshMentionHelper để check empty state
        GenTab._refreshMentionHelper();
        // S4.6: Khởi tạo autocomplete
        GenTab._initAutocomplete();
      }
    }

    // Ẩn/hiện ref limit hint (chỉ cho mention mode)
    const refLimitHint = document.getElementById('refLimitHint');
    const refLimitHintText = document.getElementById('refLimitHintText');
    if (refLimitHint && refLimitHintText) {
      if (mode === 'mention') {
        // Lấy max_ref_images từ provider
        const provider = (GenTab.providerSelect?.value || 'flow').toLowerCase();
        const isVideo = GenTab.genTypeSelect?.value === 'Video';
        const isFrames = GenTab.videoInputTypeSelect?.value === 'Frames';
        const resolvedMode = isVideo ? 'video' : 'image';
        const maxRef = (typeof ImagePickerModal !== 'undefined' && ImagePickerModal.resolveMaxSelections)
          ? ImagePickerModal.resolveMaxSelections({ provider, mode: resolvedMode, isFrames })
          : null;
        const limitText = maxRef ? maxRef : '?';
        refLimitHintText.textContent = window.I18n?.t?.('gen.refLimitHint', { max: limitText })
          || `Max ${limitText} ref images per prompt. Use @image_name in prompt.`;
        refLimitHint.classList.remove('hidden');
      } else {
        refLimitHint.classList.add('hidden');
      }
    }

    // Drag hint visibility: show when >= 2 images and mode supports reordering
    // (Toolbar always visible for quick tabs Album/Gallery/Search)
    const currentIds = GenTab.fileIdsInput?.value?.split(',').map(s => s.trim()).filter(Boolean) || [];
    const hasImages = currentIds.length > 0;

    if (dragHint) {
      const showDragHint = (mode === 'sequential' || mode === 'all') && hasImages && currentIds.length >= 2;
      dragHint.classList.toggle('hidden', !showDragHint);

      // Update drag hint text
      if (dragHintText) {
        dragHintText.textContent = window.I18n?.t('gen.dragToSort') || 'Drag to sort';
      }
    }

    // Update ratio count (independent of dragHint - shows with >= 1 image)
    // Stats is now outside dragHint in HTML, so can show independently
    if (ratioCount) {
      if (mode === 'sequential' && GenTab.multiPromptCheck?.checked && hasImages) {
        const prompts = GenTab.promptsArea?.value?.split(/\n\s*\n/).filter(p => p.trim()) || [];
        const promptCount = prompts.length;
        const imageCount = currentIds.length;
        const diff = imageCount - promptCount;

        ratioCount.classList.remove('match', 'mismatch', 'excess-images', 'excess-prompts');

        if (diff === 0) {
          // Match: green
          ratioCount.innerHTML = `<span class="count-images">${imageCount} ảnh</span> / <span class="count-prompts">${promptCount} prompt</span>`;
          ratioCount.classList.add('match');
        } else if (diff > 0) {
          // Excess images: red
          ratioCount.innerHTML = `<span class="count-images">${imageCount} ảnh</span> / <span class="count-prompts">${promptCount} prompt</span> <span class="count-excess">(dư ${diff} ảnh)</span>`;
          ratioCount.classList.add('excess-images');
        } else {
          // Excess prompts (shortage of images): red
          ratioCount.innerHTML = `<span class="count-images">${imageCount} ảnh</span> / <span class="count-prompts">${promptCount} prompt</span> <span class="count-shortage">(thiếu ${-diff} ảnh)</span>`;
          ratioCount.classList.add('excess-prompts');
        }
      } else {
        ratioCount.innerHTML = '';
      }
    }

    // Re-render thumbnails với tên (cho mention mode) hoặc số thứ tự (cho sequential)
    GenTab.renderFileIdThumbnails();
  }

  /**
   * Bind ref quick tabs (Album, Gallery, Search) click events
   * Switches to Photos tab and activates the corresponding subtab
   */
  static _bindRefQuickTabs() {
    // Support both old structure (refQuickTabs > .ref-quick-pill) and new structure (refSearchBtn)
    const pills = Array.from(document.querySelectorAll('#refQuickTabs .ref-quick-pill, #refSearchBtn'));
    if (!pills.length) return;

    pills.forEach(pill => {
      pill.addEventListener('click', () => {
        const target = pill.dataset.target; // 'photos-album', 'photos-flow-images', 'photos-search'
        if (!target) return;

        // Switch to Photos tab (Tier-1 Part C: router API)
        window.SidebarManager?.switchTo?.('tab-photos');

        // Activate the subtab after a short delay (wait for tab switch)
        setTimeout(() => {
          if (window.PhotosTab) {
            window.PhotosTab._activateSubtab(target);
          }
        }, 50);
      });
    });

    // Bind "Find References" button
    GenTab._bindFindRefsBtn();
  }

  /**
   * Smart Keyword Extraction: Extract keywords from prompt text
   * and push them to the Search tab
   */
  static _bindFindRefsBtn() {
    const btn = document.getElementById('refFindRefsBtn');
    if (!btn) return;

    btn.addEventListener('click', () => {
      const promptText = GenTab.promptsArea?.value?.trim();
      if (!promptText) {
        if (window.customDialog) {
          window.customDialog.alert(
            window.I18n?.t('gen.noPromptForKeywords') || 'Vui lòng nhập Prompt trước để trích xuất từ khóa tìm mẫu.',
            { type: 'warning' }
          );
        }
        GenTab.promptsArea?.focus();
        return;
      }

      // Extract keywords from prompt
      const keywords = GenTab._extractKeywords(promptText);
      if (!keywords) {
        if (window.customDialog) {
          window.customDialog.alert(
            window.I18n?.t('gen.noKeywordsFound') || 'Không trích xuất được từ khóa có nghĩa từ Prompt hiện tại.',
            { type: 'info' }
          );
        }
        return;
      }

      // Switch to Photos tab → Search subtab (Tier-1 Part C: router API)
      window.SidebarManager?.switchTo?.('tab-photos');

      setTimeout(() => {
        // Activate search subtab
        if (window.PhotosTab) {
          window.PhotosTab._activateSubtab('photos-search');
        }

        // Fill the search input with extracted keywords
        setTimeout(() => {
          const searchInput = document.getElementById('photosSearchInput');
          if (searchInput) {
            searchInput.value = keywords;
            searchInput.focus();
            // Dispatch input event so any listeners pick up the change
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }, 100);
      }, 50);

      console.log('[GenTab] Extracted keywords from prompt:', keywords);
    });
  }

  /**
   * Extract meaningful search keywords from a prompt string.
   * Uses client-side heuristics (no AI needed).
   * @param {string} text - The prompt text
   * @returns {string|null} - Extracted keywords or null
   */
  static _extractKeywords(text) {
    // Noise words to remove (common English + prompt modifiers)
    const NOISE_WORDS = new Set([
      // English articles & prepositions
      'a', 'an', 'the', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
      'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after',
      'above', 'below', 'between', 'under', 'over', 'out', 'off', 'down',
      'and', 'or', 'but', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither',
      'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
      'has', 'have', 'had', 'do', 'does', 'did',
      'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'can', 'could',
      'that', 'which', 'who', 'whom', 'whose', 'this', 'these', 'those',
      'it', 'its', 'i', 'me', 'my', 'we', 'us', 'our', 'you', 'your',
      'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their',
      'what', 'where', 'when', 'why', 'how', 'all', 'each', 'every',
      'any', 'few', 'more', 'most', 'some', 'no', 'such', 'very',
      'just', 'also', 'as', 'like', 'than', 'too', 'only',
      // AI/Image generation modifiers (not useful for image search)
      '4k', '8k', 'hd', 'uhd', 'fhd', '1080p', '2k', '16k',
      'cinematic', 'photorealistic', 'hyperrealistic', 'ultrarealistic',
      'realistic', 'detailed', 'intricate', 'sharp', 'crisp',
      'ultra', 'highly', 'extremely', 'incredibly', 'amazingly',
      'masterpiece', 'best quality', 'high quality', 'professional',
      'trending', 'artstation', 'deviantart', 'behance',
      'octane render', 'unreal engine', 'ray tracing', 'ray traced',
      'volumetric', 'subsurface', 'scattering', 'ambient', 'occlusion',
      'render', 'rendered', 'rendering', 'cgi', '3d',
      'illustration', 'digital art', 'concept art', 'fan art',
      'photography', 'photo', 'photograph', 'shot', 'capture',
      'style', 'aesthetic', 'vibe', 'mood', 'tone', 'look', 'feel',
      'beautiful', 'stunning', 'gorgeous', 'breathtaking', 'magnificent',
      'dramatic', 'epic', 'majestic', 'elegant', 'graceful',
      'create', 'generate', 'make', 'draw', 'paint', 'design',
      'imagine', 'visualize', 'depict', 'show', 'portray',
      'please', 'image', 'picture', 'scene', 'video', 'animation',
      'prompt', 'negative', 'positive', 'weight', 'steps', 'cfg',
      'seed', 'sampler', 'model', 'lora', 'embedding',
      // Vietnamese noise
      'một', 'của', 'và', 'với', 'trong', 'trên', 'dưới', 'cho', 'từ',
      'là', 'có', 'được', 'không', 'này', 'đó', 'các', 'những', 'bạn',
      'tôi', 'hãy', 'vẽ', 'tạo', 'làm', 'ảnh', 'hình', 'bức',
      'rất', 'cực', 'siêu', 'đẹp', 'chất', 'lượng', 'cao'
    ]);

    // Step 1: Clean text - remove special characters but keep meaningful words
    let cleaned = text
      .replace(/\[.*?\]/g, ' ')         // Remove [bracketed content] (like negative prompts)
      .replace(/\(.*?:\s*[\d.]+\)/g, ' ') // Remove (weighted:1.5) syntax
      .replace(/--\w+\s+\S+/g, ' ')     // Remove --param value pairs
      .replace(/https?:\/\/\S+/g, ' ')  // Remove URLs
      .replace(/[^a-zA-ZÀ-ỹ0-9\s]/g, ' ') // Keep letters, numbers, spaces
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    // Step 2: Split into words and filter
    const words = cleaned.split(' ').filter(w => 
      w.length > 1 && !NOISE_WORDS.has(w) && !/^\d+$/.test(w)
    );

    // Step 3: Deduplicate while preserving order
    const seen = new Set();
    const unique = [];
    for (const w of words) {
      if (!seen.has(w)) {
        seen.add(w);
        unique.push(w);
      }
    }

    // Step 4: Take first 5 meaningful words (avoid overly long queries)
    const result = unique.slice(0, 5).join(' ');
    return result || null;
  }

  /**
   * S4.2/S4.5: Refresh mention helper tags
   * Only show names for file IDs that currently exist in ref_images
   */
  static _refreshMentionHelper() {
    if (!GenTab.mentionHelperTags) return;

    // Bug fix 2026-05-26: bar "Image name" CHỈ hiển thị ở mode 'mention'. Các caller
    // reorder (_reorderFileIds) + remove (_removeRefImage) gọi hàm này VÔ ĐIỀU KIỆN →
    // trước fix, khi mode='all'/'sequential'/'none' bar bị hiện lại sau reorder/remove.
    // Guard ở đây cover mọi caller (thay vì gate rải rác từng nơi).
    if (GenTab.refImageMode !== 'mention') {
      GenTab.mentionHelperTags.innerHTML = '';
      GenTab.mentionHelper?.classList.add('hidden');
      return;
    }

    // Get current file IDs from input
    const currentIds = GenTab.fileIdsInput?.value
      ? GenTab.fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // Build {id, name, thumbnail} pairs để render thumbnail bên trái name
    const items = currentIds
      .map(id => ({ id, name: GenTab.refImageNames[id], thumbnail: GenTab.thumbnailCache?.[id] || '' }))
      .filter(item => item.name);

    // Bug fix: ẩn ENTIRE mentionHelper bar khi 0 ref images
    // (trước fix: chỉ clear inner tags, parent vẫn show "Image name:" label trống)
    if (currentIds.length === 0) {
      GenTab.mentionHelperTags.innerHTML = '';
      GenTab.mentionHelper?.classList.add('hidden');
      return;
    }

    // Có ref images → show parent helper
    GenTab.mentionHelper?.classList.remove('hidden');

    // Có ref images nhưng chưa có tên → hiện hint
    if (items.length === 0) {
      GenTab.mentionHelperTags.innerHTML = '<span style="color: var(--muted-foreground); font-size: 11px;">Chưa có tên ảnh. Nhấn nút sửa để đặt tên.</span>';
      return;
    }

    const escapeAttr = (s) => String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    // Audit fix: escape the visible @name (untrusted ref name) for the text node
    // too — data-name was escaped but the span content wasn't.
    const escapeHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    GenTab.mentionHelperTags.innerHTML = items.map(({ name, thumbnail }) => {
      const thumbHtml = thumbnail
        ? `<img class="mention-tag-thumb" src="${escapeAttr(thumbnail)}" alt="" />`
        : '';
      return `<button class="mention-tag" data-name="${escapeAttr(name)}">${thumbHtml}<span>@${escapeHtml(name)}</span></button>`;
    }).join('');

    // Bind click events
    GenTab.mentionHelperTags.querySelectorAll('.mention-tag').forEach(tag => {
      tag.addEventListener('click', () => {
        GenTab._insertMentionAtCursor(tag.dataset.name);
      });
    });
  }

  /**
   * S4.3: Insert @mention at cursor position
   */
  static _insertMentionAtCursor(name) {
    const textarea = GenTab.promptsArea;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const mention = `@${name} `;

    textarea.value = text.slice(0, start) + mention + text.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + mention.length;
    textarea.focus();

    // Trigger input event để update prompt count
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    // S4.6: Hide autocomplete
    GenTab._hideAutocomplete();
  }

  // ═══════════════════════════════════════════════════════════════
  // S4.6: Autocomplete Dropdown
  // ═══════════════════════════════════════════════════════════════

  /**
   * S4.6: Khởi tạo autocomplete listener cho textarea
   */
  static _initAutocomplete() {
    const textarea = GenTab.promptsArea;
    if (!textarea || textarea._autocompleteInit) return;

    textarea._autocompleteInit = true;

    // Tạo dropdown container
    let dropdown = document.getElementById('mentionAutocompleteDropdown');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = 'mentionAutocompleteDropdown';
      dropdown.className = 'mention-autocomplete-dropdown';
      dropdown.style.display = 'none';
      document.body.appendChild(dropdown);
    }
    GenTab._autocompleteDropdown = dropdown;
    GenTab._autocompleteIndex = -1;

    // Lắng nghe input
    textarea.addEventListener('input', () => GenTab._handleAutocompleteInput());
    textarea.addEventListener('keydown', (e) => GenTab._handleAutocompleteKeydown(e));
    textarea.addEventListener('blur', () => {
      setTimeout(() => GenTab._hideAutocomplete(), 150);
    });
  }

  static _autocompleteDebounceTimer = null;
  static _lastFilterKey = null;

  /**
   * S4.6: Xử lý input để detect @mention typing (debounced 150ms)
   */
  static _handleAutocompleteInput() {
    if (GenTab.refImageMode !== 'mention') {
      GenTab._hideAutocomplete();
      return;
    }

    if (GenTab._autocompleteDebounceTimer) {
      clearTimeout(GenTab._autocompleteDebounceTimer);
    }

    GenTab._autocompleteDebounceTimer = setTimeout(() => {
      GenTab._autocompleteDebounceTimer = null;
      GenTab._doAutocompleteFilter();
    }, 150);
  }

  static _doAutocompleteFilter() {
    const textarea = GenTab.promptsArea;
    if (!textarea) return;

    // UX guard (2026-05-02): Mention dropdown CHỈ work khi ref_image_mode === 'mention'.
    // Đồng bộ với TaskModal — mode khác (all/sequential/none) gõ @ không trigger dropdown.
    if (GenTab.refImageMode !== 'mention') {
      GenTab._hideAutocomplete();
      GenTab._lastFilterKey = null;
      return;
    }

    const cursorPos = textarea.selectionStart;
    const text = textarea.value.slice(0, cursorPos);

    const atMatch = text.match(/@([a-zA-Z0-9_]*)$/);
    if (!atMatch) {
      GenTab._hideAutocomplete();
      GenTab._lastFilterKey = null;
      return;
    }

    const query = atMatch[1].toLowerCase();
    const atPos = cursorPos - atMatch[0].length;

    const currentIds = GenTab.fileIdsInput?.value
      ? GenTab.fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // Build entries với thumbnail cho dropdown — chỉ ID hiện tại trong fileIds input.
    // BUG FIX (2026-05-02): Thêm thumbnail bên trái name khớp UI design.
    const seenNames = new Set();
    const entries = [];
    for (const id of currentIds) {
      const name = GenTab.refImageNames[id];
      if (!name || seenNames.has(name)) continue;
      if (!name.toLowerCase().includes(query)) continue;
      seenNames.add(name);
      const thumb = GenTab.thumbnailCache?.[id] || null;
      entries.push({ name, fileId: id, thumb });
    }

    if (entries.length === 0) {
      GenTab._hideAutocomplete();
      GenTab._lastFilterKey = null;
      return;
    }

    const filterKey = query + '|' + entries.map(e => e.name).join(',');
    if (filterKey === GenTab._lastFilterKey) return;
    GenTab._lastFilterKey = filterKey;

    GenTab._showAutocomplete(entries, atPos, query.length + 1);
  }

  /**
   * Mirror div technique: tạo div ẩn copy styles textarea, insert text tới caret + marker span.
   * Trả về tọa độ viewport của caret (left/top/bottom/lineHeight).
   */
  static _getTextareaCaretCoords(textarea) {
    const rect = textarea.getBoundingClientRect();
    const style = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2 || 16;

    const mirror = document.createElement('div');
    const props = [
      'boxSizing', 'width', 'height', 'overflowX', 'overflowY',
      'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderStyle',
      'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
      'fontStyle', 'fontVariant', 'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust',
      'lineHeight', 'fontFamily',
      'textAlign', 'textTransform', 'textIndent', 'textDecoration',
      'letterSpacing', 'wordSpacing', 'tabSize', 'MozTabSize',
    ];
    for (const p of props) mirror.style[p] = style[p];
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordWrap = 'break-word';
    mirror.style.top = '0';
    mirror.style.left = '-9999px';

    const caretIdx = textarea.selectionStart;
    const before = textarea.value.substring(0, caretIdx);
    mirror.textContent = before;
    const marker = document.createElement('span');
    marker.textContent = '​';
    mirror.appendChild(marker);

    document.body.appendChild(mirror);
    const markerRect = marker.getBoundingClientRect();
    const mirrorRect = mirror.getBoundingClientRect();
    const offsetTop = markerRect.top - mirrorRect.top;
    const offsetLeft = markerRect.left - mirrorRect.left;
    document.body.removeChild(mirror);

    const left = rect.left + offsetLeft - textarea.scrollLeft;
    const top = rect.top + offsetTop - textarea.scrollTop;
    return { left, top, bottom: top + lineHeight, lineHeight };
  }

  /**
   * S4.6: Hiển thị dropdown
   */
  static _showAutocomplete(entries, atPos, replaceLength) {
    const dropdown = GenTab._autocompleteDropdown;
    if (!dropdown) return;

    GenTab._autocompleteAtPos = atPos;
    GenTab._autocompleteReplaceLength = replaceLength;
    GenTab._autocompleteIndex = 0;

    // BUG FIX (2026-05-02): Accept entries object {name, thumb} thay vì plain names array,
    // render thumbnail bên trái @name khớp UI design.
    const escapeAttr = (s) => String(s).replace(/"/g, '&quot;').replace(/&/g, '&amp;');
    const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    dropdown.innerHTML = entries.slice(0, 8).map((entry, i) => {
      // Backward compat: nếu caller truyền plain string array (legacy) → wrap thành entry
      const item = typeof entry === 'string' ? { name: entry, thumb: null } : entry;
      const thumbHtml = item.thumb
        ? `<img class="mention-autocomplete-thumb" src="${escapeAttr(item.thumb)}" alt="" />`
        : '<span class="mention-autocomplete-thumb mention-autocomplete-thumb-placeholder"></span>';
      return `<div class="mention-autocomplete-item ${i === 0 ? 'selected' : ''}" data-name="${escapeAttr(item.name)}">${thumbHtml}<span class="mention-autocomplete-name">@${escapeHtml(item.name)}</span></div>`;
    }).join('');

    // Position dropdown ngay BÊN DƯỚI caret (giống Twitter/Slack/Discord mention)
    // thay vì dưới full textarea. Dùng "mirror div" technique compute caret coords.
    const textarea = GenTab.promptsArea;
    const rect = textarea.getBoundingClientRect();
    const caret = GenTab._getTextareaCaretCoords(textarea);
    const dropdownMaxHeight = 200;
    const spaceBelow = window.innerHeight - caret.bottom;
    const placeAbove = spaceBelow < dropdownMaxHeight && caret.top > dropdownMaxHeight;
    const dropdownWidth = 240;
    const left = Math.max(rect.left, Math.min(caret.left, rect.right - dropdownWidth));

    dropdown.style.display = 'block';
    dropdown.style.position = 'fixed';
    dropdown.style.left = `${left}px`;
    dropdown.style.top = placeAbove
      ? `${caret.top - dropdownMaxHeight - 4}px`
      : `${caret.bottom + 2}px`;
    dropdown.style.width = `${dropdownWidth}px`;
    dropdown.style.minWidth = `${dropdownWidth}px`;
    dropdown.style.zIndex = '10000010';

    // Bind click
    dropdown.querySelectorAll('.mention-autocomplete-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        GenTab._selectAutocompleteItem(item.dataset.name);
      });
    });
  }

  /**
   * S4.6: Ẩn dropdown
   */
  static _hideAutocomplete() {
    const dropdown = GenTab._autocompleteDropdown;
    if (dropdown) {
      dropdown.style.display = 'none';
    }
    GenTab._autocompleteIndex = -1;
    GenTab._lastFilterKey = null;
  }

  /**
   * S4.6: Xử lý phím điều hướng trong dropdown
   */
  static _handleAutocompleteKeydown(e) {
    const dropdown = GenTab._autocompleteDropdown;
    if (!dropdown || dropdown.style.display === 'none') return;

    const items = dropdown.querySelectorAll('.mention-autocomplete-item');
    if (items.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      GenTab._autocompleteIndex = Math.min(GenTab._autocompleteIndex + 1, items.length - 1);
      GenTab._updateAutocompleteSelection(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      GenTab._autocompleteIndex = Math.max(GenTab._autocompleteIndex - 1, 0);
      GenTab._updateAutocompleteSelection(items);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (GenTab._autocompleteIndex >= 0) {
        e.preventDefault();
        const selectedItem = items[GenTab._autocompleteIndex];
        if (selectedItem) {
          GenTab._selectAutocompleteItem(selectedItem.dataset.name);
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      GenTab._hideAutocomplete();
    }
  }

  /**
   * S4.6: Update selection highlight
   */
  static _updateAutocompleteSelection(items) {
    items.forEach((item, i) => {
      item.classList.toggle('selected', i === GenTab._autocompleteIndex);
    });
  }

  /**
   * S4.6: Chọn item từ dropdown
   */
  static _selectAutocompleteItem(name) {
    const textarea = GenTab.promptsArea;
    if (!textarea) return;

    const atPos = GenTab._autocompleteAtPos;
    const replaceLen = GenTab._autocompleteReplaceLength;
    const text = textarea.value;

    // Thay thế @xxx bằng @name và thêm space
    const newText = text.slice(0, atPos) + `@${name} ` + text.slice(atPos + replaceLen);
    textarea.value = newText;

    // Đặt cursor sau mention
    const newCursorPos = atPos + name.length + 2;  // @name + space
    textarea.selectionStart = textarea.selectionEnd = newCursorPos;
    textarea.focus();

    // Trigger input event
    textarea.dispatchEvent(new Event('input', { bubbles: true }));

    GenTab._hideAutocomplete();
  }

  /**
   * Get current ref images with names for processing
   */
  static _getCurrentRefImagesWithNames() {
    const ids = (GenTab.fileIdsInput?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    return ids.map((id, index) => {
      const name = GenTab.refImageNames[id] || `image_${index + 1}`;
      return {
        file_id: id,
        name: name,
        thumbnail_url: GenTab.thumbnailCache[id] || null,
        file_name: GenTab.fileNameCache[id] || null,
        type: id.startsWith('upload_') ? 'upload' : 'flow'
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // S5: Ref Image Name Editing
  // ═══════════════════════════════════════════════════════════════

  /**
   * Remove ref image
   */
  static _removeRefImage(id) {
    let newIds = GenTab.fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    newIds = newIds.filter(v => v !== id);
    GenTab.fileIdsInput.value = newIds.join(', ');

    delete GenTab.thumbnailCache[id];
    delete GenTab.fileNameCache[id];
    delete GenTab.refImageNames[id];
    // S2.5: Cancel upload đang chạy + cleanup pending
    if (id.startsWith('upload_')) {
      if (window.ImmediateUploader) ImmediateUploader.cancel(id);
      else window.pendingUploadFiles?.delete(id);
    }

    GenTab.renderFileIdThumbnails();
    GenTab._refreshMentionHelper();
    try {
      GenTab.fileIdsInput.dispatchEvent(new Event('input', { bubbles: true }));
      GenTab.saveState();
    } catch (e) { globalThis.SEOSONA_swallow?.('GenTab#escapeHtml', e); }
  }

  /**
   * Lưu ref image vào album
   * Hiện modal chọn album, check trùng file_id trước khi thêm
   */
  static async _saveRefImageToAlbum(fileId, thumbnailUrl) {
    if (!window.AlbumStore || !window.ImageStore) {
      window.customDialog?.alert(window.I18n?.t('albumNotify.notReady') || 'Album chưa sẵn sàng.', { type: 'warning' });
      return;
    }

    try {
      const albums = await window.AlbumStore.getAlbums();
      if (!albums || albums.length === 0) {
        const shouldCreate = await window.customDialog?.confirm(
          window.I18n?.t('imagePicker.noAlbumCreatePrompt') || 'Chưa có album nào. Bạn có muốn tạo album mới?',
          { title: window.I18n?.t('imagePicker.saveToAlbum') || 'Lưu vào album', type: 'info' }
        );
        if (shouldCreate && window.AlbumCreateModal) {
          window.AlbumCreateModal.show(() => {
            // Sau khi tạo xong, mở lại modal chọn album
            GenTab._saveRefImageToAlbum(fileId, thumbnailUrl);
          });
        }
        return;
      }

      // Tạo modal chọn album
      const overlay = document.createElement('div');
      overlay.className = 'album-modal-overlay';
      const saveToAlbumTitle = window.I18n?.t('imagePicker.saveToAlbum') || 'Lưu vào album';
      overlay.innerHTML = `
        <div class="album-modal" style="max-width: 360px;">
          <div class="album-modal-header">
            <div class="album-modal-title">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
                <polyline points="17 21 17 13 7 13 7 21"></polyline>
                <polyline points="7 3 7 8 15 8"></polyline>
              </svg>
              ${saveToAlbumTitle}
            </div>
            <button class="album-modal-close" id="saveAlbumModalClose">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="album-modal-body" style="max-height: 300px; overflow-y: auto;">
            <div class="album-save-list">
              ${albums.map(a => `
                <div class="album-save-item" data-album-id="${a.id}" data-album-name="${a.name}">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                  <span>${a.name}</span>
                  <span class="album-save-item-count">${(a.image_ids || []).length} ảnh</span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);

      const closeModal = () => {
        overlay.remove();
        document.removeEventListener('keydown', escHandler);
      };

      const escHandler = (e) => {
        if (e.key === 'Escape') closeModal();
      };
      document.addEventListener('keydown', escHandler);

      // Close button
      overlay.querySelector('#saveAlbumModalClose')?.addEventListener('click', closeModal);
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeModal();
      });

      // Chan mouse events
      ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(evt => {
        overlay.addEventListener(evt, (e) => e.stopPropagation());
      });

      // Click album item
      overlay.querySelectorAll('.album-save-item').forEach(item => {
        item.addEventListener('click', async () => {
          const albumId = item.dataset.albumId;
          const albumName = item.dataset.albumName;
          closeModal();

          try {
            // Check trùng file_id trong album
            const existingImages = await window.ImageStore.getAlbumImages(albumId);
            const isDuplicate = existingImages.some(img => img.file_id === fileId);
            if (isDuplicate) {
              window.customDialog?.alert(
                window.I18n?.t('albumNotify.duplicateImage', { album: albumName }) || `Ảnh này đã có trong album "${albumName}".`,
                { title: window.I18n?.t('albumNotify.duplicateImageTitle') || 'Trùng ảnh', type: 'info' }
              );
              return;
            }

            // Sanitize tên + dedup
            const usedNames = new Set(existingImages.map(i => i.name).filter(Boolean));
            let baseName = (GenTab.refImageNames[fileId] || 'image').toLowerCase().replace(/[^a-z0-9_]/g, '_');
            let finalName = baseName;
            let counter = 1;
            while (usedNames.has(finalName)) {
              finalName = `${baseName}_${counter}`;
              counter++;
            }

            const fileName = GenTab.fileNameCache[fileId] || null;

            const imageData = {
              name: finalName,
              type: 'flow',
              file_id: fileId,
              file_name: fileName,
              thumbnail_url: thumbnailUrl || null
            };

            // Fetch thumbnail blob before saving
            let thumbnailBlob = null;
            if (thumbnailUrl) {
              try {
                // Try fetching from CDN URL via background.js (bypass CORS)
                const fetchResult = await new Promise(resolve => {
                  chrome.runtime.sendMessage(
                    { action: 'fetchBlob', url: thumbnailUrl.split('=')[0], expectImage: true },
                    r => resolve(r)
                  );
                });
                if (fetchResult?.success && fetchResult.base64) {
                  const binary = atob(fetchResult.base64);
                  const bytes = new Uint8Array(binary.length);
                  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                  thumbnailBlob = new Blob([bytes], { type: fetchResult.contentType || 'image/jpeg' });
                }
              } catch (e) {
                console.warn('[GenTab] Failed to fetch thumbnail blob for album save:', e);
              }
            }

            await window.ImageStore.addImage(albumId, imageData, thumbnailBlob, null);
            window.customDialog?.alert(
              window.I18n?.t('albumNotify.saveImageSuccess', { album: albumName }) || `Đã lưu ảnh vào album "${albumName}".`,
              { title: window.I18n?.t('albumNotify.saveImageSuccessTitle') || 'Thành công', type: 'success' }
            );
          } catch (err) {
            console.error('[GenTab] Lỗi lưu ảnh vào album:', err);
            window.customDialog?.alert(window.I18n?.t('albumNotify.saveImageFailed') || 'Không thể lưu ảnh. Vui lòng thử lại.', { type: 'error' });
          }
        });
      });
    } catch (err) {
      console.error('[GenTab] Lỗi mở modal lưu album:', err);
    }
  }

  /**
   * Remove failed album image from IndexedDB (scan by file_id)
   * Gọi khi reuploadMissingFiles fail → ảnh không còn khả dụng
   */
  static async _removeFailedAlbumImage(fileId) {
    if (!window.AlbumStore || !window.ImageStore) return;
    try {
      const albums = await window.AlbumStore.getAlbums();
      for (const album of albums) {
        const images = await window.ImageStore.getAlbumImages(album.id);
        const found = images.find(img => img.file_id === fileId);
        if (found) {
          await window.ImageStore.deleteImage(found.id);
          console.log('[GenTab] Removed failed album image:', found.id, 'file_id:', fileId);
          // Refresh album UI nếu đang mở
          window.eventBus?.emit('album:refresh');
          return;
        }
      }
    } catch (err) {
      console.warn('[GenTab] Failed to remove album image:', err.message);
    }
  }

  /**
   * Edit ref image name (popup)
   */
  static _editRefImageName(fileId, currentName) {
    const thumbEl = document.querySelector(`.ref-thumb[data-ref-id="${fileId}"]`);
    if (!thumbEl) return;

    // Remove any existing popup
    const existingPopup = document.querySelector('.ref-image-name-popup');
    const existingBackdrop = document.querySelector('.ref-image-name-popup-backdrop');
    if (existingPopup) existingPopup.remove();
    if (existingBackdrop) existingBackdrop.remove();

    // Get position of thumbnail element
    const rect = thumbEl.getBoundingClientRect();

    // Create backdrop
    const backdrop = document.createElement('div');
    backdrop.className = 'ref-image-name-popup-backdrop';

    // Create popup
    const popup = document.createElement('div');
    popup.className = 'ref-image-name-popup';

    // Position popup below the thumbnail
    popup.style.left = `${Math.max(8, rect.left)}px`;
    popup.style.top = `${rect.bottom + 8}px`;

    // Title
    const title = document.createElement('div');
    title.className = 'ref-image-name-popup-title';
    title.textContent = window.I18n?.t('gen.imageNameMention') || 'Image name (for @mention)';
    popup.appendChild(title);

    // Input wrapper
    const inputWrap = document.createElement('div');
    inputWrap.className = 'ref-image-name-input-wrap';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ref-image-name-input';
    input.value = currentName;
    input.placeholder = 'a-z, 0-9, _';
    inputWrap.appendChild(input);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'ref-image-name-save';
    saveBtn.title = 'Lưu';
    saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    inputWrap.appendChild(saveBtn);

    popup.appendChild(inputWrap);

    // Add to body
    document.body.appendChild(backdrop);
    document.body.appendChild(popup);

    // Focus input
    setTimeout(() => {
      input.focus();
      input.select();
    }, 10);

    const close = () => {
      popup.remove();
      backdrop.remove();
    };

    const save = () => {
      let newName = input.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
      if (!newName) newName = `image_${Date.now() % 10000}`;

      // Validate unique name
      if (GenTab._validateUniqueName(newName, fileId)) {
        // Update state
        GenTab.refImageNames[fileId] = newName;

        // Update registry (nếu có)
        if (window.imageNameRegistry) {
          window.imageNameRegistry.register(newName, {
            file_id: fileId,
            thumbnail_url: GenTab.thumbnailCache[fileId],
            type: fileId.startsWith('upload_') ? 'upload' : 'flow'
          });
        }

        // Update thumbnail data-name attribute
        thumbEl.dataset.name = newName;
        thumbEl.title = `@${newName} - Click để sửa tên`;

        // Update the name label below thumbnail
        const itemEl = thumbEl.closest('.ref-item');
        if (itemEl) {
          const nameLabel = itemEl.querySelector('.ref-item-name');
          if (nameLabel) {
            nameLabel.textContent = newName;
          }
        }

        // Refresh helper
        GenTab._refreshMentionHelper();
        GenTab.saveState();
        close();
      } else {
        // Name trùng - hiện warning
        input.style.borderColor = 'var(--destructive)';
        input.focus();
      }
    };

    backdrop.addEventListener('click', close);

    saveBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      save();
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        save();
      }
      if (e.key === 'Escape') {
        close();
      }
    });
  }

  /**
   * Validate unique name (không trùng với fileId khác)
   */
  static _validateUniqueName(name, excludeFileId) {
    for (const [fid, n] of Object.entries(GenTab.refImageNames)) {
      if (fid !== excludeFileId && n === name) {
        return false;
      }
    }
    return true;
  }

  // ═══════════════════════════════════════════════════════════════
  // S6: Save to Album
  // ═══════════════════════════════════════════════════════════════

  /**
   * S6.2-S6.4: Save ref images to new album
   */
  static async _saveRefImagesToAlbum() {
    const refImages = GenTab._getCurrentRefImagesWithNames();

    if (refImages.length === 0) {
      if (window.customDialog) {
        window.customDialog.alert(window.I18n?.t('gen.noRefImagesToSave') || 'Chưa có ảnh tham chiếu nào để lưu.', { type: 'warning' });
      }
      return;
    }

    // Prompt for album name
    let albumName;
    if (window.customDialog) {
      albumName = await window.customDialog.prompt(window.I18n?.t('gen.enterAlbumName') || 'Nhập tên album:', {
        title: window.I18n?.t('albums.createAlbum') || 'Tạo album mới',
        placeholder: window.I18n?.t('gen.albumNamePlaceholder') || 'VD: Nhân vật chính',
        confirmText: window.I18n?.t('common.create') || 'Tạo',
        cancelText: window.I18n?.t('common.cancel') || 'Hủy'
      });
    } else {
      albumName = prompt(window.I18n?.t('gen.enterAlbumName') || 'Nhập tên album:');
    }

    if (!albumName || !albumName.trim()) return;
    albumName = albumName.trim();

    try {
      // Create album
      if (!window.AlbumStore) {
        throw new Error('AlbumStore chưa sẵn sàng');
      }

      const album = await window.AlbumStore.createAlbum(albumName);

      // Add images to album
      for (const img of refImages) {
        if (window.ImageStore) {
          // Lấy thumbnail blob từ cache nếu có
          let thumbBlob = null;
          let fullBlob = null;

          // Thử lấy blob từ pending uploads
          if (img.file_id.startsWith('upload_') && window.pendingUploadFiles) {
            const pending = window.pendingUploadFiles.get(img.file_id);
            if (pending?.file) {
              fullBlob = pending.file;
              // Tạo thumbnail từ file
              try {
                thumbBlob = await ImageStore.compressThumbnail(pending.file);
              } catch (e) {
                console.warn('[GenTab] Không thể tạo thumbnail:', e);
              }
            }
          }

          // Fallback: fetch thumbnail blob from CDN URL if no blob yet
          if (!thumbBlob && img.thumbnail_url) {
            try {
              const fetchResult = await new Promise(resolve => {
                chrome.runtime.sendMessage(
                  { action: 'fetchBlob', url: img.thumbnail_url.split('=')[0], expectImage: true },
                  r => resolve(r)
                );
              });
              if (fetchResult?.success && fetchResult.base64) {
                const binary = atob(fetchResult.base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                thumbBlob = new Blob([bytes], { type: fetchResult.contentType || 'image/jpeg' });
              }
            } catch (e) {
              console.warn('[GenTab] Failed to fetch thumbnail blob for batch album save:', e);
            }
          }

          await window.ImageStore.addImage(album.id, {
            name: img.name,
            type: img.type,
            file_id: img.file_id,
            file_name: img.file_name,
            thumbnail_url: img.thumbnail_url
          }, thumbBlob, fullBlob);
        }
      }

      // Success message
      if (window.customDialog) {
        window.customDialog.alert(
          window.I18n?.t('albumNotify.createAlbumSuccess', { album: albumName, count: refImages.length }) ||
            `Đã tạo album "${albumName}" với ${refImages.length} ảnh.`,
          { title: window.I18n?.t('albumNotify.saveImageSuccessTitle') || 'Thành công', type: 'success' }
        );
      }

      // Emit event để refresh album list nếu đang mở
      if (window.eventBus) {
        window.eventBus.emit('album:created', { album, imageCount: refImages.length });
      }

    } catch (err) {
      console.error('[GenTab] Lỗi tạo album:', err);
      if (window.customDialog) {
        window.customDialog.alert(
          window.I18n?.t('albumNotify.createAlbumFailed', { error: err.message }) || `Không thể tạo album: ${err.message}`,
          { title: window.I18n?.t('albumNotify.createAlbumFailedTitle') || 'Lỗi', type: 'error' }
        );
      }
    }
  }

  // ─── T-2: Confirm Modal ──────────────────────────────────────
  static _initConfirmModal() {
    const overlay = document.getElementById('confirmRunOverlay');
    const cancelBtn = document.getElementById('confirmRunCancel');
    const closeBtn = document.getElementById('confirmRunClose');
    if (!overlay) return;

    const hide = () => {
      overlay.classList.add('hidden');
      // Clear provider status polling timer
      if (GenTab._confirmStatusPollTimer) {
        clearInterval(GenTab._confirmStatusPollTimer);
        GenTab._confirmStatusPollTimer = null;
      }
      if (GenTab._confirmReject) GenTab._confirmReject();
      GenTab._confirmResolve = null;
      GenTab._confirmReject = null;
    };

    cancelBtn?.addEventListener('click', hide);
    closeBtn?.addEventListener('click', hide);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) hide();
    });

    // Bind +/- buttons cho confirmQuantity (range từ PCM quantity_range)
    const confirmQtyInput = document.getElementById('confirmQuantity');
    const _confGetRange = () => {
      const r = window.ProviderConfigManager?.safeGetQuantityRangeSync?.('flow');
      return { min: r?.min ?? 1, max: r?.max ?? 4 };
    };
    document.getElementById('confirmQtyMinus')?.addEventListener('click', () => {
      const { min } = _confGetRange();
      const val = parseInt(confirmQtyInput?.value, 10) || min;
      if (val > min && confirmQtyInput) confirmQtyInput.value = String(val - 1);
    });
    document.getElementById('confirmQtyPlus')?.addEventListener('click', () => {
      const { max, min } = _confGetRange();
      const val = parseInt(confirmQtyInput?.value, 10) || min;
      if (val < max && confirmQtyInput) confirmQtyInput.value = String(val + 1);
    });

    document.getElementById('confirmRunSubmit')?.addEventListener('click', () => {
      // Apply confirm modal values back to main UI
      const confirmRatio = document.getElementById('confirmAspectRatio');
      const confirmQty = document.getElementById('confirmQuantity');
      const confirmRes = document.getElementById('confirmDownloadRes');

      // Detect provider hiện tại — quantity + downloadRes chỉ áp dụng cho Flow.
      // ChatGPT/Grok có hide qty/res rows trong modal (xem _showConfirmModal).
      // KHÔNG được overwrite genTabAutoDownload với confirmRes.value khi modal hide field này
      // → user setting autodownload sẽ bị vô tình tắt.
      const _curProvider = (document.getElementById('genProvider')?.value) || 'flow';
      const isFlowProvider = _curProvider === 'flow';

      if (confirmRatio && GenTab.aspectRatioSelect) {
        GenTab.aspectRatioSelect.value = confirmRatio.value;
      }
      if (isFlowProvider && confirmQty && GenTab.quantitySelect) {
        GenTab.quantitySelect.value = confirmQty.value;
      }
      // Apply download resolution + toggle CHỈ cho Flow (ChatGPT/Grok hide field này)
      if (isFlowProvider && confirmRes) {
        const autoDownloadToggle = document.getElementById('genTabAutoDownload');
        const isVideo = GenTab.genTypeSelect?.value === 'Video';
        const genTabDownloadRes = document.getElementById('genTabDownloadResolution');
        const genTabVideoDownloadRes = document.getElementById('genTabVideoDownloadResolution');
        if (confirmRes.value) {
          if (autoDownloadToggle) autoDownloadToggle.checked = true;
          if (isVideo) {
            if (genTabVideoDownloadRes) genTabVideoDownloadRes.value = confirmRes.value;
          } else {
            if (genTabDownloadRes) genTabDownloadRes.value = confirmRes.value;
          }
        } else {
          if (autoDownloadToggle) autoDownloadToggle.checked = false;
        }
        // Single source of truth for visibility
        if (GenTab._syncDownloadVisibility) GenTab._syncDownloadVisibility();
      }

      overlay.classList.add('hidden');
      if (GenTab._confirmResolve) GenTab._confirmResolve(true);
      GenTab._confirmResolve = null;
      GenTab._confirmReject = null;
    });
  }

  static _showConfirmModal(promptCount) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('confirmRunOverlay');
      if (!overlay) { resolve(true); return; }

      // Populate with current values
      const confirmRatio = document.getElementById('confirmAspectRatio');
      const confirmQty = document.getElementById('confirmQuantity');
      const confirmRes = document.getElementById('confirmDownloadRes');
      const confirmCount = document.getElementById('confirmPromptCount');

      if (confirmCount) confirmCount.textContent = promptCount;

      // Fix 9 + G: Provider-specific modal UI cho cả 3 providers (Flow/ChatGPT/Grok).
      // ChatGPT + Grok: ẩn quantity + download resolution (1 ảnh/lượt + CDN URL fixed).
      // Ratio render từ adapter.capabilities (avoid hardcode — mỗi provider có ratio map khác).
      const providerKey = document.getElementById('genProvider')?.value || 'flow';
      const isChatGPT = providerKey === 'chatgpt';
      const isGrok = providerKey === 'grok';
      const isFlow = !isChatGPT && !isGrok;

      // Provider status row: hiển thị cho ChatGPT/Grok, ẩn cho Flow
      const providerStatusRow = document.getElementById('confirmProviderStatus');
      const providerLabelEl = document.getElementById('confirmProviderLabel');
      const providerBadge = document.getElementById('confirmProviderBadge');

      // Clear any existing poll timer
      if (GenTab._confirmStatusPollTimer) {
        clearInterval(GenTab._confirmStatusPollTimer);
        GenTab._confirmStatusPollTimer = null;
      }

      if (providerStatusRow) {
        if (isChatGPT || isGrok) {
          providerStatusRow.classList.remove('hidden');
          if (providerLabelEl) providerLabelEl.textContent = isChatGPT ? 'ChatGPT' : 'Grok';

          // SVG icons for provider status
          const iconSpinner = `<svg class="badge-icon badge-icon-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
          const iconCheck = `<svg class="badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
          const iconWarning = `<svg class="badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

          const Session = isChatGPT ? window.ChatGPTSession : window.GrokSession;
          let lastStatus = null; // Track để tránh update UI không cần thiết

          // Icon cho Cloudflare (shield icon)
          const iconCloudflare = `<svg class="badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

          // Function kiểm tra status và update badge
          const checkAndUpdateStatus = async () => {
            if (!providerBadge) return;
            // Modal đã đóng? Stop polling
            if (overlay.classList.contains('hidden')) {
              if (GenTab._confirmStatusPollTimer) {
                clearInterval(GenTab._confirmStatusPollTimer);
                GenTab._confirmStatusPollTimer = null;
              }
              return;
            }

            try {
              let newStatus = 'warning';
              let statusText = window.I18n?.t('gen.providerStatusLogin') || 'Chưa đăng nhập';
              let statusIcon = iconWarning;

              if (isGrok && Session?.checkStatus) {
                // Grok: dùng checkStatus để detect cả Cloudflare challenge
                const status = await Session.checkStatus();
                if (status.loggedIn && !status.cloudflareChallenge) {
                  newStatus = 'ready';
                } else if (status.cloudflareChallenge) {
                  newStatus = 'cloudflare';
                  statusText = window.I18n?.t('gen.providerStatusCloudflare') || 'Chờ Cloudflare...';
                  statusIcon = iconCloudflare;
                }
              } else if (Session?.ensureReady) {
                // ChatGPT: dùng ensureReady với silent=true để KHÔNG emit chatgpt:login_required event
                // (badge trong reconfirm modal đã hiển thị status, KHÔNG cần dialog "Mở tab" pop spam mỗi 3s polling).
                // [Bug 62 fix 2026-05-24]
                const result = await Session.ensureReady({ createIfMissing: false, activate: false, silent: true });
                if (result?.ready) newStatus = 'ready';
              }

              if (newStatus === lastStatus) return; // Không đổi, skip update
              lastStatus = newStatus;

              if (newStatus === 'ready') {
                providerBadge.className = 'confirm-run-provider-badge is-ready';
                providerBadge.innerHTML = `${iconCheck}<span class="badge-text">${window.I18n?.t('gen.providerStatusReady') || 'Ready'}</span>`;
                // Đã ready → stop polling
                if (GenTab._confirmStatusPollTimer) {
                  clearInterval(GenTab._confirmStatusPollTimer);
                  GenTab._confirmStatusPollTimer = null;
                }
              } else if (newStatus === 'cloudflare') {
                providerBadge.className = 'confirm-run-provider-badge is-warning';
                providerBadge.innerHTML = `${statusIcon}<span class="badge-text">${statusText}</span>`;
              } else {
                providerBadge.className = 'confirm-run-provider-badge is-warning';
                providerBadge.innerHTML = `${iconWarning}<span class="badge-text">${statusText}</span>`;
              }
            } catch {
              if (lastStatus === 'warning') return;
              lastStatus = 'warning';
              providerBadge.className = 'confirm-run-provider-badge is-warning';
              providerBadge.innerHTML = `${iconWarning}<span class="badge-text">${window.I18n?.t('gen.providerStatusLogin') || 'Chưa đăng nhập'}</span>`;
            }
          };

          // Reset badge to checking state
          if (providerBadge) {
            providerBadge.className = 'confirm-run-provider-badge is-checking';
            providerBadge.innerHTML = `${iconSpinner}<span class="badge-text">${window.I18n?.t('gen.providerStatusChecking') || 'Đang kiểm tra...'}</span>`;
          }

          // Initial check
          checkAndUpdateStatus();

          // Poll every 3s để recheck (user có thể login trong lúc modal đang mở)
          GenTab._confirmStatusPollTimer = setInterval(checkAndUpdateStatus, 3000);

        } else {
          providerStatusRow.classList.add('hidden');
        }
      }

      // Hide quantity + download resolution rows cho ChatGPT/Grok (chỉ show ratio)
      const qtyField = confirmQty?.closest('.confirm-run-field');
      const resField = confirmRes?.closest('.confirm-run-field');
      const hideQtyRes = isChatGPT || isGrok;
      if (qtyField) qtyField.style.display = hideQtyRes ? 'none' : '';
      if (resField) resField.style.display = hideQtyRes ? 'none' : '';

      // Re-populate ratio options theo provider — đọc capabilities từ ProviderRegistry để
      // tránh hardcode. Grok ratio UI khác ChatGPT (2:3/3:2 vs 3:4/4:3).
      if (confirmRatio) {
        if (isChatGPT || isGrok) {
          const adapter = window.ProviderRegistry?.get?.(providerKey);
          // Fallback hardcode (khác giữa ChatGPT vs Grok)
          const fallbackRatios = ['story', 'portrait', 'square', 'landscape', 'widescreen'];
          const fallbackUiMap = isGrok
            ? { story: '9:16', portrait: '2:3', square: '1:1', landscape: '3:2', widescreen: '16:9' }
            : { story: '9:16', portrait: '3:4', square: '1:1', landscape: '4:3', widescreen: '16:9' };
          const supportedRatios = adapter?.capabilities?.supportedRatios || fallbackRatios;
          const ratioUiMap = adapter?.capabilities?.ratioUiMap || fallbackUiMap;
          const iconMap = { story: '▮', portrait: '▯', square: '□', landscape: '▭', widescreen: '▬' };
          confirmRatio.innerHTML = supportedRatios.map(k =>
            `<option value="${k}">${iconMap[k] || ''} ${ratioUiMap[k] || k}</option>`
          ).join('');
          // Sync với GenTab aspectRatio (đã có ratio đúng do _renderRatioPills)
          if (GenTab.aspectRatioSelect && supportedRatios.includes(GenTab.aspectRatioSelect.value)) {
            confirmRatio.value = GenTab.aspectRatioSelect.value;
          } else {
            // Fallback default per provider
            confirmRatio.value = isGrok ? 'widescreen' : 'story';
          }
        } else {
          // Flow — clone options từ GenTab.aspectRatioSelect (đã filter theo genType:
          // Image=5 ratios, Video=2 ratios). Trước fix: hardcode 5 options → user ở Video mode
          // pick ratio không hợp lệ trong modal (3:4/4:3/1:1) → OK → GenTab.aspectRatioSelect.value
          // = invalid → <select> hiển thị empty → "mất ratio".
          if (GenTab.aspectRatioSelect) {
            confirmRatio.innerHTML = GenTab.aspectRatioSelect.innerHTML;
            confirmRatio.value = GenTab.aspectRatioSelect.value;
          } else {
            // Fallback nếu aspectRatioSelect chưa init
            confirmRatio.innerHTML = `
              <option value="16:9">▬ 16:9</option>
              <option value="4:3">▭ 4:3</option>
              <option value="1:1">□ 1:1</option>
              <option value="3:4">▯ 3:4</option>
              <option value="9:16">▮ 9:16</option>
            `;
          }
        }
      }

      if (isFlow) {
        if (confirmQty && GenTab.quantitySelect) {
          // Apply range từ PCM (admin tweak qua /admin/providers → SSE auto-refresh khi modal mở lại)
          const _confQRange = window.ProviderConfigManager?.safeGetQuantityRangeSync?.('flow');
          confirmQty.min = String(_confQRange?.min ?? 1);
          confirmQty.max = String(_confQRange?.max ?? 4);
          confirmQty.value = GenTab.quantitySelect.value || String(_confQRange?.min ?? 1);
        }

        // Sync download resolution — populate options based on genType
        const autoDownloadToggle = document.getElementById('genTabAutoDownload');
        const isVideo = GenTab.genTypeSelect?.value === 'Video';
        if (confirmRes) {
          const noText = window.I18n?.t('common.no') || 'No';
          if (isVideo) {
            confirmRes.innerHTML = `<option value="">${noText}</option><option value="720p">720p</option><option value="1080p">1080p</option><option value="4k">4K (Ultra)</option>`;
          } else {
            confirmRes.innerHTML = `<option value="">${noText}</option><option value="1k">1K</option><option value="2k">2K (Pro)</option><option value="4k">4K (Ultra)</option>`;
          }
          if (autoDownloadToggle?.checked) {
            const sourceSelect = isVideo
              ? document.getElementById('genTabVideoDownloadResolution')
              : document.getElementById('genTabDownloadResolution');
            confirmRes.value = sourceSelect?.value || (isVideo ? '1080p' : '1k');
          } else {
            confirmRes.value = '';
          }
        }
      }

      // Reload row: ĐÃ ẨN HẲN khỏi UI (user request) — không hiện checkbox reload Flow nữa.
      // Giữ element trong DOM để backward-compat logic, nhưng luôn hidden + unchecked → wantReload luôn false.
      const reloadRow = document.getElementById('confirmReloadRow');
      const reloadCheckbox = document.getElementById('confirmReloadFlow');
      if (reloadRow) reloadRow.classList.add('hidden');
      if (reloadCheckbox) reloadCheckbox.checked = false;

      // Submit mode switch (segmented Auto / Manual Enter): CHỈ provider Flow. Khởi tạo theo setting
      // manualSubmitMode (default false → auto). Khi chọn Manual → ẩn hẳn reload zone (reload không hợp manual).
      const submitModeRow = document.getElementById('confirmSubmitModeRow');
      const submitModeSwitch = document.getElementById('confirmSubmitModeSwitch');
      const submitModeHint = document.getElementById('confirmSubmitModeHint');
      if (submitModeRow) {
        submitModeRow.classList.toggle('hidden', !isFlow);
        if (isFlow && submitModeSwitch) {
          const t = (k) => window.I18n?.t?.(k);
          const defaultManual = !!window.storageSettings?.getSettings?.().manualSubmitMode;
          const btns = submitModeSwitch.querySelectorAll('.confirm-submitmode-btn');
          // Localize tooltip (SmartTooltip [data-tooltip]) — I18n.applyTranslations KHÔNG xử lý data-tooltip.
          // Giữ nguyên fallback HTML (vi) nếu key thiếu (server chưa sync).
          btns.forEach(b => {
            const tip = t(b.dataset.value === 'manual' ? 'dialog.runSubmitModeManualTooltip' : 'dialog.runSubmitModeAutoTooltip');
            if (tip) b.setAttribute('data-tooltip', tip);
          });
          const applyMode = (mode) => {
            btns.forEach(b => {
              const on = b.dataset.value === mode;
              b.classList.toggle('is-active', on);
              b.setAttribute('aria-selected', on ? 'true' : 'false');
            });
            // Hint đổi theo mode (manual → cảnh báo vàng về hạn chế bot detection)
            if (submitModeHint) {
              if (mode === 'manual') {
                submitModeHint.textContent = t('dialog.runSubmitModeManualHint')
                  || 'Bạn tự nhấn Enter cho mỗi prompt — thao tác thật giúp hạn chế Google Flow phát hiện bot.';
                submitModeHint.classList.add('is-manual');
              } else {
                submitModeHint.textContent = t('dialog.runSubmitModeAutoHint')
                  || 'SEOSONA Flow tự động submit sau khi điền prompt + ref.';
                submitModeHint.classList.remove('is-manual');
              }
            }
          };
          btns.forEach(b => {
            b.onclick = () => {
              applyMode(b.dataset.value);
              // Auto-persist: đổi switch = lưu luôn default user setting (manualSubmitMode) → sync DB.
              // CHỈ khi user click (không phải init) → tránh ghi lại giá trị mỗi lần mở modal.
              try { window.storageSettings?.set?.('manualSubmitMode', b.dataset.value === 'manual'); } catch (_) { globalThis.SEOSONA_swallow?.('GenTab#onclick', _); }
            };
          });
          applyMode(defaultManual ? 'manual' : 'auto'); // init — KHÔNG persist
        }
      }

      // Run mode row: chỉ hiện khi multi-prompt mode (promptCount > 1) VÀ provider là Flow
      // ChatGPT/Grok luôn chạy tuần tự nên không cần hiển thị
      const runModeRow = document.getElementById('confirmRunModeRow');
      const runModeSelect = document.getElementById('confirmRunMode');
      const isMultiPrompt = promptCount > 1;
      const showRunMode = isMultiPrompt && isFlow;
      if (runModeRow) {
        runModeRow.classList.toggle('hidden', !showRunMode);
      }
      if (runModeSelect && showRunMode) {
        runModeSelect.value = GenTab.runMode || 'parallel';
        // Sync genRunModeBtn ngay khi user đổi select trong modal
        runModeSelect.onchange = () => {
          GenTab.runMode = runModeSelect.value;
          GenTab._updateRunModeUI();
        };
      }

      GenTab._confirmResolve = (val) => {
        // Capture submit mode (Auto / Manual Enter) — CHỈ Flow. Manual = user tự nhấn Enter.
        const submitMode = (isFlow && submitModeSwitch)
          ? (submitModeSwitch.querySelector('.confirm-submitmode-btn.is-active')?.dataset.value || 'auto')
          : 'auto';
        const manualSubmitMode = submitMode === 'manual';
        // Capture reload state khi user confirm
        // Chỉ tính wantReload khi reload row VISIBLE (isFlow) và checkbox checked, và mode=auto
        const reloadRowVisible = reloadRow && !reloadRow.classList.contains('hidden');
        const wantReload = !manualSubmitMode && !!(reloadRowVisible && reloadCheckbox && !reloadCheckbox.disabled && reloadCheckbox.checked);
        // Capture run mode khi user confirm (multi-prompt + Flow only)
        if (runModeSelect && showRunMode) {
          GenTab.runMode = runModeSelect.value;
          GenTab._updateRunModeUI();
        }
        // Trả object khi có reload HOẶC manual; nếu không giữ backward-compat trả val (true).
        if (wantReload || manualSubmitMode) {
          resolve({ confirmed: true, reloadFlow: wantReload, manualSubmitMode });
        } else {
          resolve(val);
        }
      };
      GenTab._confirmReject = () => resolve(false);
      overlay.classList.remove('hidden');
    });
  }

  // ─── Prompt Search Modal ───────────────────────────────────
  static _psmState = {
    activeTab: 'my',       // 'my' | 'template'
    myPrompts: [],
    myFiltered: [],
    myQuery: '',
    myDisplayCount: 15,
    templates: [],
    tplQuery: '',
    tplPage: 1,
    tplTotalPages: 1,
    tplLoading: false,
    tplDisplayCount: 15,
  };

  static _initPromptSearchRow() {
    const searchBtn = document.getElementById('promptSearchBtn');
    const saveBtn = document.getElementById('promptSaveBtn');

    if (searchBtn) {
      searchBtn.addEventListener('click', () => GenTab._openPromptSearchModal());
    }
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        // Check quota trước khi mở save dialog
        if (window.featureGate) {
          const canCreate = await window.featureGate.canCreateSnippetAsync();
          if (!canCreate) {
            const isLoggedIn = true;
            if (!isLoggedIn) {
              window.featureGate.showLoginPrompt(
                window.I18n?.t('templates.requireLoginToSave') || 'Lưu prompt yêu cầu đăng nhập'
              );
            } else {
              // Hiển thị dialog với nút upgrade
              const snippetsMax = window.featureGate.entitlements?.snippets_max ?? 3;
              await window.customDialog?.confirm(
                window.I18n?.t('snippets.quotaReachedDetail', { max: snippetsMax }) ||
                  `Bạn đã đạt giới hạn ${snippetsMax} prompt cho gói hiện tại. Nâng cấp để lưu không giới hạn.`,
                {
                  title: window.I18n?.t('featuregate.featureLockedTitle') || 'Tính năng bị khóa',
                  type: 'warning',
                  confirmText: window.I18n?.t('common.upgrade') || 'Nâng cấp',
                  cancelText: window.I18n?.t('common.close') || 'Đóng',
                  onConfirm: () => {
                    window.eventBus?.emit('open:upgrade_modal');
                  }
                }
              );
            }
            return;
          }
        }
        // Mở save dialog từ MyPromptsTab, pre-fill nội dung hiện tại
        const content = GenTab.promptsArea?.value?.trim() || '';
        if (window.MyPromptsTab) {
          window.MyPromptsTab._showSaveDialog(content ? { title: '', content: content, category: '' } : null);
        }
      });
    }
  }

  static _openPromptSearchModal() {
    // Reset state
    const s = GenTab._psmState;
    s.activeTab = 'my';
    s.myQuery = '';
    s.myDisplayCount = 15;
    s.tplQuery = '';
    s.tplPage = 1;
    s.tplTotalPages = 1;
    s.tplDisplayCount = 15;
    s.templates = [];

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'prompt-search-overlay';
    const t = (key, fallback) => window.I18n?.t(key) || fallback;
    overlay.innerHTML = `
      <div class="prompt-search-modal">
        <div class="psm-header">
          <button class="psm-tab active" data-psm-tab="my">${t('templates.myPrompts', 'Prompt của tôi')}</button>
          <button class="psm-tab" data-psm-tab="template">${t('templates.template', 'Mẫu')}</button>
          <button class="psm-close" data-tooltip="${t('common.close', 'Đóng')}" aria-label="${t('common.close', 'Đóng')}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
        <div class="psm-search-wrap">
          <svg class="psm-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input class="psm-search-input" id="psmSearchInput" type="text" placeholder="${t('templates.searchPrompt', 'Tìm prompt...')}" autocomplete="off" />
        </div>
        <div class="psm-list" id="psmList"></div>
      </div>
    `;

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) GenTab._closePromptSearchModal();
    });

    // Close button
    overlay.querySelector('.psm-close').addEventListener('click', () => GenTab._closePromptSearchModal());

    // Tab switching
    overlay.querySelectorAll('.psm-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        overlay.querySelectorAll('.psm-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        s.activeTab = tab.dataset.psmTab;
        const input = overlay.querySelector('#psmSearchInput');
        if (input) {
          input.value = s.activeTab === 'my' ? s.myQuery : s.tplQuery;
          input.placeholder = s.activeTab === 'my' ? (window.I18n?.t('templates.searchMyPrompts') || 'Tìm trong prompt của tôi...') : (window.I18n?.t('templates.searchTemplate') || 'Tìm template...');
        }
        // Load templates on first switch to template tab
        if (s.activeTab === 'template' && s.templates.length === 0 && !s.tplLoading) {
          GenTab._psmLoadTemplates();
        } else {
          GenTab._psmRenderList();
        }
      });
    });

    // Search input
    let searchTimer = null;
    const searchInput = overlay.querySelector('#psmSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          if (s.activeTab === 'my') {
            s.myQuery = searchInput.value.trim().toLowerCase();
            s.myDisplayCount = 15;
            GenTab._psmFilterMyPrompts();
          } else {
            s.tplQuery = searchInput.value.trim();
            s.tplPage = 1;
            s.tplDisplayCount = 15;
            s.templates = [];
            GenTab._psmLoadTemplates();
          }
        }, 300);
      });
    }

    // Lazy scroll
    const listEl = overlay.querySelector('#psmList');
    if (listEl) {
      listEl.addEventListener('scroll', () => {
        const threshold = 60;
        if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - threshold) {
          if (s.activeTab === 'my') {
            if (s.myDisplayCount < s.myFiltered.length) {
              s.myDisplayCount += 15;
              GenTab._psmRenderList();
            }
          } else {
            if (s.tplDisplayCount < s.templates.length) {
              s.tplDisplayCount += 15;
              GenTab._psmRenderList();
            } else if (s.tplPage < s.tplTotalPages && !s.tplLoading) {
              s.tplPage++;
              GenTab._psmLoadTemplates(true);
            }
          }
        }
      });
    }

    // Escape key
    const escHandler = (e) => {
      if (e.key === 'Escape') GenTab._closePromptSearchModal();
    };
    document.addEventListener('keydown', escHandler);
    overlay._escHandler = escHandler;

    // Stop events from propagating to parent
    ['mousedown', 'mouseup', 'pointerdown', 'pointerup'].forEach(evt => {
      overlay.addEventListener(evt, (e) => e.stopPropagation());
    });

    document.body.appendChild(overlay);
    GenTab._psmOverlay = overlay;

    // Load initial data
    GenTab._psmLoadMyPrompts();

    // Focus search
    searchInput?.focus();
  }

  static _closePromptSearchModal() {
    const overlay = GenTab._psmOverlay;
    if (!overlay) return;
    if (overlay._escHandler) {
      document.removeEventListener('keydown', overlay._escHandler);
    }
    overlay.remove();
    GenTab._psmOverlay = null;
  }

  // ─── My Prompts tab ────────────────────────────────────
  static async _psmLoadMyPrompts() {
    const s = GenTab._psmState;
    try {
      if (window.userPromptsManager) {
        await window.userPromptsManager.loadPrompts();
        const result = window.userPromptsManager.getPrompts();
        s.myPrompts = Array.isArray(result) ? result : [];
      } else {
        s.myPrompts = [];
      }
    } catch (err) {
      console.warn('[GenTab] PSM: Loi tai my prompts:', err.message);
      s.myPrompts = [];
    }
    GenTab._psmFilterMyPrompts();
  }

  static _psmFilterMyPrompts() {
    const s = GenTab._psmState;
    if (!s.myQuery) {
      s.myFiltered = s.myPrompts.slice();
    } else {
      const q = s.myQuery;
      s.myFiltered = s.myPrompts.filter(p => {
        const title = (p.title || '').toLowerCase();
        const content = (p.content || '').toLowerCase();
        const cat = (p.category || '').toLowerCase();
        return title.includes(q) || content.includes(q) || cat.includes(q);
      });
    }
    GenTab._psmRenderList();
  }

  // ─── Templates tab ─────────────────────────────────────
  static async _psmLoadTemplates(append = false) {
    const s = GenTab._psmState;
    if (s.tplLoading) return;
    // Local/offline: thư viện community-templates cần backend → hiện rỗng ngay (không throw
    // LOCAL_MODE + warn mỗi lần mở). Kho snippet local vẫn hoạt động ở tab khác.
    if (self.SEOSONA_LOCAL_MODE !== false) {
      s.templates = [];
      s.tplTotalPages = 1;
      s.tplLoading = false;
      GenTab._psmRenderList();
      return;
    }
    s.tplLoading = true;

    if (!append) {
      GenTab._psmRenderLoading();
    }

    try {
      const params = new URLSearchParams();
      params.append('page', s.tplPage);
      params.append('per_page', '15');
      if (s.tplQuery) params.append('search', s.tplQuery);

      const endpoint = 'templates?' + params.toString();
      const response = await GenTab._psmApiCall('GET', endpoint);

      const newItems = Array.isArray(response) ? response : (Array.isArray(response?.data) ? response.data : []);
      s.tplTotalPages = response.meta?.last_page || 1;

      if (append) {
        s.templates = s.templates.concat(newItems);
      } else {
        s.templates = newItems;
      }
    } catch (err) {
      console.warn('[GenTab] PSM: Loi tai templates:', err.message);
      if (!append) s.templates = [];
    }

    s.tplLoading = false;
    GenTab._psmRenderList();
  }

  static async _psmApiCall(method, endpoint, data = null) {
    // [FIX 2026-07-09] Gate hỏng: auto-transform biến `if(authManager && isLoggedIn())` thành
    // `if(true && true)` → luôn gọi ApiClient.request → throw LOCAL_MODE offline. PSM community
    // templates cần backend → local mode reject rõ ràng thay vì ném LOCAL_MODE khó hiểu.
    if (self.SEOSONA_LOCAL_MODE !== false) {
      return Promise.reject(new Error('LOCAL_MODE: PSM community templates cần backend'));
    }
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'apiRequest',
        method,
        endpoint,
        data
      }, (resp) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (resp?.success) {
          if (resp.meta) {
            resolve({ data: resp.data, meta: resp.meta });
          } else {
            resolve(resp.data);
          }
        } else {
          reject(new Error(resp?.error?.message || 'Loi API'));
        }
      });
    });
  }

  // ─── Render ────────────────────────────────────────────
  static _psmRenderLoading() {
    const list = GenTab._psmOverlay?.querySelector('#psmList');
    if (!list) return;
    list.innerHTML = `
      <div class="psm-loading">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>
        <span>Đang tải...</span>
      </div>
    `;
  }

  static _psmRenderList() {
    const list = GenTab._psmOverlay?.querySelector('#psmList');
    if (!list) return;

    const s = GenTab._psmState;

    if (s.activeTab === 'my') {
      GenTab._psmRenderMyList(list);
    } else {
      GenTab._psmRenderTplList(list);
    }
  }

  static _psmRenderMyList(list) {
    const s = GenTab._psmState;
    const items = s.myFiltered.slice(0, s.myDisplayCount);

    if (items.length === 0) {
      list.innerHTML = `
        <div class="psm-empty">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>
          </svg>
          <span>${s.myQuery ? (window.I18n?.t('templates.noMatchingPrompts') || 'Không tìm thấy prompt phù hợp.') : (window.I18n?.t('templates.noPromptsYet') || 'Chưa có prompt nào.')}</span>
        </div>
      `;
      return;
    }

    let html = items.map(p => {
      const title = GenTab._psmEsc(p.title || 'Khong co tieu de');
      const content = GenTab._psmEsc(p.content || '');
      const preview = content.length > 80 ? content.substring(0, 80) + '...' : content;
      const catBadge = p.category ? `<span class="psm-item-badge">${GenTab._psmEsc(p.category)}</span>` : '';
      const hasVars = (p.content || '').match(/\{\{(\w+)\}\}/);
      const varBadge = hasVars ? '<span class="psm-item-badge">{{var}}</span>' : '';

      return `<div class="psm-item" data-psm-id="${GenTab._psmEscAttr(p.id)}">
        <div class="psm-item-info">
          <div class="psm-item-title">${title}</div>
          <div class="psm-item-content">${preview}</div>
          ${(catBadge || varBadge) ? `<div class="psm-item-meta">${catBadge}${varBadge}</div>` : ''}
        </div>
        <button class="psm-item-use" data-psm-action="use-my" data-psm-id="${GenTab._psmEscAttr(p.id)}" data-tooltip="Dùng prompt này" aria-label="Dùng prompt này">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
        </button>
      </div>`;
    }).join('');

    if (s.myDisplayCount < s.myFiltered.length) {
      html += '<div class="psm-load-more"><span class="psm-load-more-text">' + (window.I18n?.t('templates.scrollToLoadMore') || 'Cuộn xuống để tải thêm...') + '</span></div>';
    }

    list.innerHTML = html;

    // Bind click on "use" button only
    list.querySelectorAll('button[data-psm-action="use-my"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.psmId;
        GenTab._psmUseMyPrompt(id);
      });
    });
  }

  static _psmRenderTplList(list) {
    const s = GenTab._psmState;
    const items = s.templates.slice(0, s.tplDisplayCount);

    if (s.tplLoading && items.length === 0) return; // loading indicator already shown

    if (items.length === 0) {
      list.innerHTML = `
        <div class="psm-empty">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/>
          </svg>
          <span>${s.tplQuery ? 'Không tìm thấy template phù hợp.' : 'Không có template nào.'}</span>
        </div>
      `;
      return;
    }

    let html = items.map(t => {
      const title = GenTab._psmEsc(t.title || t.name || 'Template');
      const content = GenTab._psmEsc(t.content || t.prompt_content || '');
      const preview = content.length > 80 ? content.substring(0, 80) + '...' : content;
      const catName = t.category?.name || '';
      const catBadge = catName ? `<span class="psm-item-badge">${GenTab._psmEsc(catName)}</span>` : '';
      const mediaType = t.media_type === 'video' ? '<span class="psm-item-badge">Video</span>' : '';

      return `<div class="psm-item" data-psm-id="${GenTab._psmEscAttr(t.id)}">
        <div class="psm-item-info">
          <div class="psm-item-title">${title}</div>
          <div class="psm-item-content">${preview}</div>
          ${(catBadge || mediaType) ? `<div class="psm-item-meta">${catBadge}${mediaType}</div>` : ''}
        </div>
        <button class="psm-item-use" data-psm-action="use-tpl" data-psm-id="${GenTab._psmEscAttr(t.id)}" data-tooltip="Dùng template này" aria-label="Dùng template này">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>
        </button>
      </div>`;
    }).join('');

    const hasMore = s.tplDisplayCount < s.templates.length || s.tplPage < s.tplTotalPages;
    if (hasMore) {
      html += '<div class="psm-load-more"><span class="psm-load-more-text">' + (window.I18n?.t('templates.scrollToLoadMore') || 'Cuộn xuống để tải thêm...') + '</span></div>';
    }

    list.innerHTML = html;

    // Bind click on "use" button only
    list.querySelectorAll('button[data-psm-action="use-tpl"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = btn.dataset.psmId;
        GenTab._psmUseTemplate(id);
      });
    });
  }

  // ─── Use actions ───────────────────────────────────────
  static _psmUseMyPrompt(id) {
    const s = GenTab._psmState;
    const prompt = s.myPrompts.find(p => String(p.id) === String(id));
    if (!prompt) return;

    const content = prompt.content || '';
    const variables = content.match(/\{\{(\w+)\}\}/g);

    // Close modal first
    GenTab._closePromptSearchModal();

    if (variables && variables.length > 0) {
      // Show variable dialog via MyPromptsTab
      if (window.MyPromptsTab) {
        window.MyPromptsTab._showVariableDialog(prompt);
      }
      return;
    }

    // Fill prompt directly
    GenTab._psmFillPrompt(content);
  }

  static async _psmUseTemplate(templateId) {
    GenTab._closePromptSearchModal();

    try {
      // Goi API de track usage + lay chi tiet
      const response = await GenTab._psmApiCall('POST', `templates/${templateId}/use`);
      const template = response.data || response;

      const promptContent = template.content || template.prompt_content || '';
      if (promptContent) {
        GenTab._psmFillPrompt(promptContent);
      }

      // Ap dung settings neu co
      if (template.settings) {
        const settings = typeof template.settings === 'string'
          ? JSON.parse(template.settings) : template.settings;

        if (settings.gen_type && GenTab.genTypeSelect) {
          GenTab.genTypeSelect.value = settings.gen_type;
          GenTab.genTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (settings.aspect_ratio && GenTab.aspectRatioSelect) {
          GenTab.aspectRatioSelect.value = settings.aspect_ratio;
        }
        if (settings.model) {
          const modelSelect = settings.gen_type === 'video'
            ? GenTab.videoModelSelect : GenTab.imageModelSelect;
          if (modelSelect) modelSelect.value = settings.model;
        }
      }
    } catch (err) {
      console.warn('[GenTab] PSM: Loi su dung template:', err.message);
      // Fallback: tim trong cache local
      const s = GenTab._psmState;
      const tpl = s.templates.find(t => String(t.id) === String(templateId));
      if (tpl) {
        const content = tpl.content || tpl.prompt_content || '';
        if (content) GenTab._psmFillPrompt(content);
      }
    }
  }

  static _psmFillPrompt(content) {
    if (!GenTab.promptsArea) return;
    GenTab.promptsArea.value = content;
    GenTab.promptsArea.dispatchEvent(new Event('input', { bubbles: true }));
    GenTab.promptsArea.focus();
    window.showNotification?.(window.I18n?.t('genNotifyExtra.promptInserted') || 'Đã chèn prompt', 'success', 1500);
  }

  // ─── Helpers ───────────────────────────────────────────
  static _psmEsc(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  static _psmEscAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Show a brief toast notification for capture
   * @param {string} message
   */
  static _showCaptureNotification(message) {
    // Remove existing
    const existing = document.getElementById('captureToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'captureToast';
    toast.className = 'capture-toast';
    toast.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
        <circle cx="12" cy="13" r="4"></circle>
      </svg>
      <span>${message}</span>
    `;
    document.body.appendChild(toast);

    // Auto remove after 3s
    setTimeout(() => {
      toast.classList.add('capture-toast--hide');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
}

window.GenTab = GenTab;
