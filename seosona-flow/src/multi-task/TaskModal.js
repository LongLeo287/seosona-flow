/**
 * TaskModal - Modal de them/sua task
 */
// Helper for i18n - TaskModal dùng nhiều translation keys
const t = (key, params) => window.I18n?.t(key, params) || key;

class TaskModal {
  constructor() {
    this.mode = 'create';
    this.task = null;
    this.overlay = null;
    this.uploadedImages = [];
    this._lastMentionSelectTime = 0;

    this.bindGlobalEvents();
  }

  bindGlobalEvents() {
    if (window.eventBus) {
      window.eventBus.on('task:open_modal', (data) => {
        console.log('[TaskModal] Received task:open_modal event, mode:', data.mode, 'task:', data.task?.task_id || 'null');
        this.open(data.mode, data.task);
      });

      // SSE listener: update provider tabs visibility when status changes
      window.eventBus.on('provider:updated', () => {
        this._updateProviderVisibility();
      });
      window.eventBus.on('provider:meta_loaded', () => {
        this._updateProviderVisibility();
      });
    }
  }

  /**
   * Update provider tabs visibility based on ProviderMeta status.
   * Called when SSE provider_updated event is received.
   */
  _updateProviderVisibility() {
    if (!this.overlay) return; // Modal not open
    const providerTabs = this.overlay.querySelector('#taskProviderTabs');
    if (!providerTabs) return;

    const PM = window.ProviderMeta;
    if (!PM) return;

    const tabs = providerTabs.querySelectorAll('.provider-tab[data-provider]');
    tabs.forEach((tab) => {
      const slug = tab.dataset.provider;
      if (!slug) return;

      const isActive = PM.isActive(slug);
      const status = PM.getStatus(slug);
      console.log(`[TaskModal] Tab ${slug}: status=${status}, isActive=${isActive}`);
      tab.style.display = isActive ? '' : 'none';

      // Update name if changed
      const nameSpan = tab.querySelector('span');
      if (nameSpan) {
        const name = PM.getName(slug);
        if (name && nameSpan.textContent !== name) {
          nameSpan.textContent = name;
        }
      }

      // Update icon only if server has custom icon (not empty/fallback)
      const iconEl = tab.querySelector('.provider-tab-icon');
      if (iconEl && PM.hasServerIcon(slug)) {
        const newIcon = PM.getIcon(slug);
        if (newIcon && newIcon.trim().startsWith('<svg')) {
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

    // If current provider is hidden, switch to first visible
    const providerHidden = this.overlay.querySelector('#taskProvider');
    if (providerHidden) {
      const currentSlug = providerHidden.value;
      if (!PM.isActive(currentSlug)) {
        const visibleTab = Array.from(tabs).find(t => {
          const s = t.dataset.provider;
          return s && PM.isActive(s);
        });
        if (visibleTab) {
          const newSlug = visibleTab.dataset.provider;
          providerHidden.value = newSlug;
          tabs.forEach(t => {
            const isTarget = t.dataset.provider === newSlug;
            t.classList.toggle('provider-tab--active', isTarget);
            t.setAttribute('aria-selected', String(isTarget));
          });
          this._onProviderChange(newSlug);
          // Show notification
          const oldName = PM.getName(currentSlug);
          const newName = PM.getName(newSlug);
          window.showNotification?.(
            window.I18n?.t('taskNotify.providerSuspendedSwitch', { from: oldName, to: newName }) ||
              `${oldName} tạm ngưng — đã chuyển sang ${newName}`,
            'warning', 2500
          );
        }
      }
    }
  }

  async open(mode = 'create', task = null) {
    console.log('[TaskModal] open() called, mode:', mode, 'task:', task?.task_id || 'null',
      mode === 'edit' ? { multi_prompt: task?.multi_prompt, ref_image_mode: task?.ref_image_mode, ref_image_names: task?.ref_image_names, addon_prompt_id: task?.addon_prompt_id } : '');
    this.mode = mode;
    this.task = task;
    this.uploadedImages = [];
    this._missingRefWarned = false;
    this._crossProjectWarned = false;
    this._crossProjectRefIds = [];
    // S2.5: Track upload keys t\u1EA1o trong modal n\u00E0y \u0111\u1EC3 cleanup khi cancel
    this._modalUploadKeys = new Set();

    // New feature state — set sync trước snapshot để _isFormDirty() không bị false positive
    this._selectedAddonPromptId = (mode === 'edit' && task?.addon_prompt_id) ? task.addon_prompt_id : null;
    this._addonPrompts = [];
    this._templates = [];
    this._mentionDropdown = null;
    this._mentionNames = [];
    this._mentionIndex = -1;
    this._mentionStart = 0;
    this._multiPromptEnabled = (mode === 'edit' && task?.multi_prompt) || false;
    this._refImageNames = (mode === 'edit' && task?.ref_image_names) ? { ...task.ref_image_names } : {};
    // Per-prompt frame data for Video+Frames multi-prompt
    this._taskPerPromptFrameData = [];
    this._taskPerPromptFrameUploadKeys = new Map();
    if (mode === 'edit' && task?.frame_pairs && Array.isArray(task.frame_pairs)) {
      this._taskPerPromptFrameData = task.frame_pairs.map(fp => ({
        frame1: fp.frame1 || '', frame2: fp.frame2 || '',
        frame1Thumb: fp.frame1Thumb || '', frame2Thumb: fp.frame2Thumb || ''
      }));
    }

    if (mode === 'edit' && !task) {
      console.error('[TaskModal] Edit mode but no task data provided');
      return;
    }

    // Load af_settings (user defaults) trước render() để form mới (create mode)
    // dùng đúng default model/ratio/genType từ Settings thay vì hardcode 'Nano Banana Pro'/Ngang/quantity=1.
    // Edit mode KHÔNG override this.task.X — chỉ dùng af_settings cho create mode (xem render()).
    try {
      this._afSettings = await new Promise(resolve => {
        try {
          chrome.storage.local.get(['af_settings'], r => resolve(r?.af_settings || {}));
        } catch (e) {
          resolve({});
        }
      });
    } catch (e) {
      this._afSettings = {};
    }

    try {
      console.log('[TaskModal] Calling render()...');
      this.render();
      console.log('[TaskModal] Calling bindEvents()...');
      this.bindEvents();
      // Capture snapshot sau khi form đã render xong (cho dirty check)
      this._formSnapshot = this._captureFormSnapshot();
      console.log('[TaskModal] Modal opened successfully, overlay in DOM:', !!document.body.contains(this.overlay));
    } catch (error) {
      console.error('[TaskModal] Failed to open modal:', error, error.stack);
    }

    // S2.5: Listen for upload events — PHẢI đặt SAU render() vì render() gọi _forceClose() xóa handlers cũ
    this._uploadStartedHandler = () => {
      this._renderTaskRefPreview();
      this._updateButtonState();
    };
    this._uploadCompletedHandler = (data) => {
      console.log('[TaskModal] upload:completed received:', data?.key?.substring(0, 15), 'tile_id:', data?.tile_id?.substring(0, 15), 'tracked:', this._modalUploadKeys?.has(data?.key));
      // Handle per-prompt frame uploads
      this._handleTaskPerPromptFrameUploadCompleted(data);
      if (!data?.key || !data?.tile_id) {
        this._renderTaskRefPreview();
        this._updateButtonState();
        return;
      }
      if (!this._modalUploadKeys?.has(data.key)) {
        this._renderTaskRefPreview();
        this._updateButtonState();
        return;
      }
      try {
        this._syncUploadKeyToTileId(data);
      } catch (err) {
        console.error('[TaskModal] _syncUploadKeyToTileId error:', err);
        this._renderTaskRefPreview();
      }
      this._updateButtonState();
    };
    this._uploadFailedHandler = (data) => {
      console.log('[TaskModal] upload:failed received:', data?.key?.substring(0, 15), 'tracked:', this._modalUploadKeys?.has(data?.key));
      // Luôn re-render để xóa CSS uploading (isUploading đã false sau finally block)
      this._renderTaskRefPreview();
      // Re-render frame previews nếu upload key là frame (global + per-prompt)
      this._reRenderFrameUploading();
      this._handleTaskPerPromptFrameUploadFailed(data);
      this._updateButtonState();
    };
    window.eventBus?.on('upload:started', this._uploadStartedHandler);
    window.eventBus?.on('upload:completed', this._uploadCompletedHandler);
    window.eventBus?.on('upload:failed', this._uploadFailedHandler);

    // Admin update ratios / download_resolutions → re-render dropdowns.
    // Flow: dùng _updateRatioOptions / _updateDownloadResolutionOptions.
    // ChatGPT/Grok: re-call _renderTaskFormByProvider để adapter capabilities (PCM-backed
    // getters) re-feed dropdown ở line 3300/3385.
    this._ratiosUpdatedHandler = ({ provider, key }) => {
      if (!this.overlay) return;
      const currentProvider = this.overlay.querySelector('#taskProvider')?.value;
      try {
        if (key === 'ratios') {
          if (provider === 'flow') {
            this._updateRatioOptions();
          } else if ((provider === 'chatgpt' || provider === 'grok') && provider === currentProvider) {
            this._renderTaskFormByProvider(currentProvider);
          }
        } else if (key === 'download_resolutions' && provider === 'flow') {
          this._updateDownloadResolutionOptions();
        }
      } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#_ratiosUpdatedHandler', _); }
    };
    window.eventBus?.on('provider:api_config_updated', this._ratiosUpdatedHandler);

    // Bug 33 fix (2026-05-19): Admin add/remove/rename model qua /admin/provider-models →
    // re-render task form để model dropdowns đọc fresh data từ ModelRegistry.
    this._modelsUpdatedHandler = () => {
      if (!this.overlay) return;
      const currentProvider = this.overlay.querySelector('#taskProvider')?.value || 'flow';
      try { this._renderTaskFormByProvider(currentProvider); } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#_modelsUpdatedHandler', _); }
    };
    window.eventBus?.on('provider:models_updated', this._modelsUpdatedHandler);

    // Fix (2026-05-14): Re-render khi PCM initial fetch xong (ratios, download_resolutions)
    // Trước fix: TaskModal render trước khi PCM fetch xong → dùng _DEFAULTS
    this._apiConfigsLoadedHandler = () => {
      if (!this.overlay) return;
      try {
        this._updateRatioOptions();
        this._updateDownloadResolutionOptions();
      } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#_apiConfigsLoadedHandler', _); }
    };
    window.eventBus?.on('provider:api_configs_loaded', this._apiConfigsLoadedHandler);
  }

  /**
   * Capture trạng thái form hiện tại — track tất cả fields user có thể edit
   * để dirty-check phát hiện chính xác và warning unsaved changes.
   */
  _captureFormSnapshot() {
    if (!this.overlay) return '';
    // Tracked fields: tất cả input/select user có thể thay đổi
    const fields = [
      '#taskName', '#taskPrompt', '#taskModel', '#taskRatio', '#taskQuantity',
      '#taskFileIds', '#taskMediaType', '#taskRefImageMode', '#taskProvider',
      // Video-specific
      '#taskVideoModel', '#taskVideoInputType',
      '#taskFrame1FileId', '#taskFrame2FileId',
      // Download
      '#taskDownloadResolution', '#taskVideoDownloadResolution',
      // Grok-specific
      '#taskGrokMode', '#taskGrokDuration', '#taskGrokResolution', '#taskGrokImageQuality',
    ];
    const multiPrompt = this.overlay.querySelector('#taskMultiPromptCheck')?.checked ? '1' : '0';
    const enabled = this.overlay.querySelector('#taskEnabled')?.checked ? '1' : '0';
    const autoDownload = this.overlay.querySelector('#taskAutoDownload')?.checked ? '1' : '0';
    // Map fields user-edited vào string để compare
    const refNamesJson = JSON.stringify(this._refImageNames || {});
    const perPromptFramesJson = JSON.stringify(this._taskPerPromptFrameData || {});
    return fields.map(sel => this.overlay.querySelector(sel)?.value || '').join('|')
      + '|' + multiPrompt + '|' + enabled + '|' + autoDownload
      + '|' + refNamesJson + '|' + perPromptFramesJson;
  }

  /**
   * Check form có thay đổi so với snapshot
   */
  _isFormDirty() {
    if (!this._formSnapshot) return false;
    const current = this._captureFormSnapshot();
    if (current !== this._formSnapshot) {
      // Debug: tìm field nào thay đổi
      const snapFields = this._formSnapshot.split('|');
      const curFields = current.split('|');
      const labels = [
        'taskName', 'taskPrompt', 'taskModel', 'taskRatio', 'taskQuantity',
        'taskFileIds', 'taskMediaType', 'taskRefImageMode', 'taskProvider',
        'taskVideoModel', 'taskVideoInputType', 'taskFrame1FileId', 'taskFrame2FileId',
        'taskDownloadResolution', 'taskVideoDownloadResolution',
        'taskGrokMode', 'taskGrokDuration', 'taskGrokResolution', 'taskGrokImageQuality',
        'multiPrompt', 'enabled', 'autoDownload', 'refImageNames', 'perPromptFrames',
      ];
      const diffs = [];
      for (let i = 0; i < labels.length; i++) {
        if (snapFields[i] !== curFields[i]) {
          diffs.push(`${labels[i]}: "${(snapFields[i] || '').substring(0, 30)}" → "${(curFields[i] || '').substring(0, 30)}"`);
        }
      }
      console.log('[TaskModal] _isFormDirty: TRUE — changed fields:', diffs.join(', '));
      return true;
    }
    return false;
  }

  /**
   * Check nếu có upload đang chạy trong modal
   * @returns {number}
   */
  _countActiveUploads() {
    if (!this._modalUploadKeys?.size || !window.ImmediateUploader) return 0;
    let count = 0;
    for (const key of this._modalUploadKeys) {
      if (ImmediateUploader.isUploading(key)) count++;
    }
    return count;
  }

  /**
   * Disable/enable nút Hủy + Lưu khi đang upload ảnh.
   * Đồng thời rename text save button thành "Uploading..." để user biết đang upload,
   * trả về text gốc (Save/Update) khi upload xong.
   */
  _updateButtonState() {
    const isUploading = this._countActiveUploads() > 0;
    const saveBtn = this.overlay?.querySelector('#saveTaskBtn');
    const cancelBtn = this.overlay?.querySelector('#cancelModalBtn');
    if (saveBtn) {
      saveBtn.disabled = isUploading;
      // Cache original text 1 lần khi modal mở (text gốc Save/Update theo mode)
      if (!saveBtn.dataset.originalText) {
        saveBtn.dataset.originalText = saveBtn.textContent.trim();
      }
      const I = window.I18n;
      if (isUploading) {
        saveBtn.textContent = I?.t('tasks.uploadingBtn') || 'Uploading...';
      } else {
        saveBtn.textContent = saveBtn.dataset.originalText;
      }
    }
    if (cancelBtn) cancelBtn.disabled = isUploading;
  }

  async close() {
    // Block close khi save in-flight — tránh _forceClose cancel uploads + abort save mid-way
    if (this._isSaving) {
      const I = window.I18n;
      window.customDialog?.alert(
        I?.t('tasks.savingInProgress') || 'Đang lưu task, vui lòng đợi...',
        { title: I?.t('tasks.saving') || 'Đang lưu', type: 'info' }
      );
      return;
    }

    // S2.5: Check uploads đang chạy → confirm trước khi đóng
    const activeCount = this._countActiveUploads();
    if (activeCount > 0) {
      const confirmed = await window.customDialog?.confirm(
        t('tasks.uploadingWarning', { count: activeCount }),
        { title: t('tasks.uploadingTitle'), type: 'warning', confirmText: t('tasks.closeAndCancel'), cancelText: t('tasks.continueUpload') }
      );
      if (!confirmed) return;
    }
    // Check unsaved changes
    else if (this._isFormDirty()) {
      const confirmed = await window.customDialog?.confirm(
        t('tasks.unsavedMsg'),
        { title: t('tasks.unsavedTitle'), type: 'warning', confirmText: t('tasks.discardChanges'), cancelText: t('tasks.goBack') }
      );
      if (!confirmed) return;
    }
    this._forceClose();
  }

  /**
   * Đóng modal không cần confirm (dùng nội bộ khi re-render/save)
   */
  _forceClose() {
    // S2.5: Cleanup upload event listeners
    if (this._uploadStartedHandler) {
      window.eventBus?.off('upload:started', this._uploadStartedHandler);
      this._uploadStartedHandler = null;
    }
    if (this._uploadCompletedHandler) {
      window.eventBus?.off('upload:completed', this._uploadCompletedHandler);
      this._uploadCompletedHandler = null;
    }
    if (this._uploadFailedHandler) {
      window.eventBus?.off('upload:failed', this._uploadFailedHandler);
      this._uploadFailedHandler = null;
    }
    if (this._ratiosUpdatedHandler) {
      window.eventBus?.off('provider:api_config_updated', this._ratiosUpdatedHandler);
      this._ratiosUpdatedHandler = null;
    }
    if (this._modelsUpdatedHandler) {
      window.eventBus?.off('provider:models_updated', this._modelsUpdatedHandler);
      this._modelsUpdatedHandler = null;
    }

    // S2.5: Cancel tất cả uploads đang chạy từ modal này
    if (this._modalUploadKeys?.size > 0) {
      if (window.ImmediateUploader) {
        ImmediateUploader.cancelAll(this._modalUploadKeys);
      } else {
        for (const key of this._modalUploadKeys) {
          window.pendingUploadFiles?.delete(key);
        }
      }
      this._modalUploadKeys.clear();
    }

    // Cleanup mention dropdown
    if (this._mentionDropdown) {
      this._mentionDropdown.style.display = 'none';
    }

    // Cleanup featuregate listener
    if (this._featuregateHandler) {
      window.eventBus?.off('featuregate:refreshed', this._featuregateHandler);
      window.eventBus?.off('prompt:completed', this._featuregateHandler);
      window.eventBus?.off('featuregate:quota_warning', this._featuregateHandler);
      window.eventBus?.off('featuregate:quota_exhausted', this._featuregateHandler);
      this._featuregateHandler = null;
    }

    if (this.overlay) {
      this.overlay.remove();
      this.overlay = null;
    }
  }

  render() {
    // Remove existing modal (không cần confirm khi re-render)
    this._forceClose();

    const isEdit = this.mode === 'edit' && this.task;

    // Compute effective defaults từ user af_settings cho create mode.
    // Edit mode dùng this.task.X (không override với af_settings).
    // af_settings keys (numeric): defaultImageRatio, defaultVideoRatio, defaultGenType,
    //                             defaultImageModel, defaultVideoModel.
    // Legacy: defaultRatio (VN: 'Dọc'|'Ngang'|'Vuông') — fallback only.
    const _afs = this._afSettings || {};
    const effectiveMediaType = isEdit
      ? (this.task.media_type || 'Image')
      : (_afs.defaultGenType || 'Image');
    // Strict Server-Only: ModelRegistry từ backend, cache miss → null + Tier3 warn.
    const _defaultImageModel = window.ModelRegistry?.safeGetDefault('flow', 'image') || null;
    const _defaultVideoModel = window.ModelRegistry?.safeGetDefault('flow', 'video') || null;
    if (!_defaultImageModel) console.debug('[Tier3] TaskModal render: flow.image default model cache miss');
    if (!_defaultVideoModel) console.debug('[Tier3] TaskModal render: flow.video default model cache miss');
    const effectiveImageModel = isEdit
      ? (this.task.model || _defaultImageModel)
      : (_afs.defaultImageModel || _defaultImageModel);
    const effectiveVideoModel = isEdit
      ? (this.task.model || _defaultVideoModel)
      : (_afs.defaultVideoModel || _defaultVideoModel);
    // ChatGPT model (Instant/Thinking — GPT-5.5): edit → task.model, else default setting → 'Instant'.
    const effectiveChatgptModel = (isEdit && this.task.provider === 'chatgpt' && this.task.model)
      ? this.task.model
      : (_afs.chatgptModel || 'Instant');

    // taskRatio select dùng NUMERIC format ('16:9','4:3','1:1','3:4','9:16').
    // Map legacy VN ratio → numeric cho fallback.
    const _ratioVnToNumeric = { 'Ngang': '16:9', 'Dọc': '9:16', 'Vuông': '1:1' };
    const _legacyNumeric = _ratioVnToNumeric[_afs.defaultRatio] || _afs.defaultRatio;
    const isVideoMode = effectiveMediaType === 'Video';
    // Ưu tiên key numeric mới (Settings popup), fallback legacy VN.
    const _userDefaultRatioNumeric = isVideoMode
      ? (_afs.defaultVideoRatio || _legacyNumeric || '16:9')
      : (_afs.defaultImageRatio || _legacyNumeric || '16:9');
    // Video chỉ hỗ trợ '16:9'/'9:16' — cap fallback.
    const _validVideoRatiosNumeric = ['16:9', '9:16'];
    const effectiveRatioRaw = isEdit
      ? (this.task.ratio || '16:9')
      : (isVideoMode && !_validVideoRatiosNumeric.includes(_userDefaultRatioNumeric)
          ? '16:9'
          : _userDefaultRatioNumeric);
    // Edit mode: task.ratio có thể đã lưu format VN cũ → convert sang numeric.
    const effectiveRatio = _ratioVnToNumeric[effectiveRatioRaw] || effectiveRatioRaw;
    const effectiveQuantity = isEdit ? (this.task.quantity || 1) : 1;
    // 2026-05-29: video_input_type default từ StorageSettings (admin tune qua /admin/default-settings)
    const _vitDefault = window.storageSettings?.get?.('defaultVideoInputType');
    const _vitSafeDefault = (_vitDefault === 'Ingredients' || _vitDefault === 'Frames') ? _vitDefault : 'Frames';
    const effectiveVideoInputType = isEdit
      ? (this.task.video_input_type || _vitSafeDefault)
      : _vitSafeDefault;
    // Flow video duration - lookup tier from model config
    let effectiveVideoDurationTier = 'default';
    try {
      const models = window.ModelRegistry?.safeGetModelsSync?.('flow', 'video') || [];
      const modelObj = models.find(m => m.value === effectiveVideoModel || m.name === effectiveVideoModel);
      if (modelObj?.config?.duration_tier) effectiveVideoDurationTier = modelObj.config.duration_tier;
    } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#render', _); }
    const videoDurations = window.ProviderConfigManager?.safeGetVideoDurationsSync?.('flow', effectiveVideoDurationTier) || ['4s', '6s', '8s'];
    const effectiveVideoDuration = isEdit
      ? (this.task.video_duration || '6s')
      : '6s';
    // Grok video durations từ config (Server-Only) — trước fix hardcode 6s/10s trong template → admin
    // thêm '15s' vào api_config KHÔNG hiện. getSupportedDurationsSync throw nếu cache chưa load → giữ default.
    let grokDurations = ['6s', '10s'];
    try {
      const g = window.ProviderConfigManager?.getSupportedDurationsSync?.('grok');
      if (Array.isArray(g) && g.length) grokDurations = g;
    } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#render', _); }
    const effectiveGrokDuration = isEdit ? (this.task.grok_duration || grokDurations[0]) : grokDurations[0];

    this.overlay = document.createElement('div');
    this.overlay.className = 'task-modal-overlay';
    this.overlay.innerHTML = `
      <div class="task-modal">
        <div class="task-modal-header">
          <h3 class="task-modal-title">${isEdit ? t('tasks.editTitle') : t('tasks.createTitle')}</h3>
          <div class="task-modal-header-right">
            <label class="toolbar-toggle compact" for="taskEnabled" title="${t('tasks.enabledTooltip')}">
              <input type="checkbox" id="taskEnabled" ${!isEdit || this.task.enabled !== false ? 'checked' : ''} />
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>
            <button class="task-modal-close" id="closeModalBtn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
        <div class="task-modal-body">
          ${(() => {
            // Check if all providers are locked (create mode only)
            const _canFlow = !!(window.featureGate?.canUse('gen_enabled'));
            const _canChatGPT = !!(window.featureGate?.canUse('chatgpt_enabled'));
            const _canGrok = !!(window.featureGate?.canUse('grok_enabled'));
            const _allProvidersLocked = !isEdit && !_canFlow && !_canChatGPT && !_canGrok;

            if (_allProvidersLocked) {
              const _isLoggedIn = !!(true);
              const _showUpgrade = window.SystemConfig?.getBool('show_upgrade_ui') !== false;
              const _contactUrl = window.SystemConfig?.get('upgrade_contact_url', '');
              let _actionBtn = '';
              if (!_isLoggedIn) {
                _actionBtn = `<button class="module-blocked-btn" id="taskAllLockedLoginBtn">${t('auth.login') || 'Đăng nhập'}</button>`;
              } else if (_showUpgrade) {
                _actionBtn = `<button class="module-blocked-btn module-blocked-btn-upgrade" id="taskAllLockedUpgradeBtn">${t('common.upgrade') || 'Nâng cấp'}</button>`;
              } else if (_contactUrl) {
                _actionBtn = `<button class="module-blocked-btn" id="taskAllLockedContactBtn">${t('overlay.contact') || 'Liên hệ'}</button>`;
              }
              return `
              <div class="module-blocked-overlay task-all-locked-overlay">
                <div class="module-blocked-content">
                  <div class="module-blocked-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                  </div>
                  <h3 class="module-blocked-title">${_isLoggedIn ? (t('tasks.allProvidersLocked') || 'Tất cả providers đều bị khóa') : (t('overlay.requiresLogin') || 'Yêu cầu đăng nhập')}</h3>
                  <p class="module-blocked-desc">${_isLoggedIn
                    ? (t('tasks.allProvidersLockedDesc') || 'Gói hiện tại không bao gồm quyền sử dụng bất kỳ provider nào. Nâng cấp để tạo task.')
                    : (t('tasks.loginToCreateTask') || 'Đăng nhập để tạo và quản lý tasks.')
                  }</p>
                  <div class="module-blocked-actions">${_actionBtn}</div>
                </div>
              </div>`;
            }
            return '';
          })()}
          ${isEdit ? `
          <div class="task-modal-tabs">
            <button class="task-modal-tab active" data-tab="config">${t('tasks.configTab')}</button>
            <button class="task-modal-tab" data-tab="results">${t('tasks.resultsTab')}</button>
          </div>
          ` : ''}
          <div class="task-modal-tab-content${(() => {
            const _canFlow = !!(window.featureGate?.canUse('gen_enabled'));
            const _canChatGPT = !!(window.featureGate?.canUse('chatgpt_enabled'));
            const _canGrok = !!(window.featureGate?.canUse('grok_enabled'));
            return (!isEdit && !_canFlow && !_canChatGPT && !_canGrok) ? ' hidden' : '';
          })()}" id="taskConfigTab">
          <div class="form-group">
            <label for="taskName">${t('tasks.taskNameLabel')}</label>
            <div class="input-group">
              <input type="text" id="taskName" placeholder="${t('tasks.namePlaceholder')}" value="${isEdit ? this.escapeAttr(this.task.task_name) : ''}" />
            </div>
          </div>

          <div class="form-group">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
              <div style="display:flex;align-items:center;gap:6px;">
                <label for="taskPrompt" style="margin:0;">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;">
                    <path d="M12 3a3 3 0 0 0 -3 3v12a3 3 0 0 0 3 3"></path><path d="M6 3a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3"></path><path d="M13 7h7a1 1 0 0 1 1 1v8a1 1 0 0 1 -1 1h-7"></path><path d="M5 7h-1a1 1 0 0 0 -1 1v8a1 1 0 0 0 1 1h1"></path><path d="M17 12h.01"></path><path d="M13 12h.01"></path>
                  </svg>
                  ${t('tasks.promptLabel')}
                </label>
                <button class="prompt-icon-btn" id="taskPromptSaveBtn" title="${t('tasks.savePromptTitle')}">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M21 11.0975V16.0909C21 19.1875 21 20.7358 20.2659 21.4123C19.9158 21.735 19.4739 21.9377 19.0031 21.9915C18.016 22.1045 16.8633 21.0849 14.5578 19.0458C13.5388 18.1445 13.0292 17.6938 12.4397 17.5751C12.1494 17.5166 11.8506 17.5166 11.5603 17.5751C10.9708 17.6938 10.4612 18.1445 9.44216 19.0458C7.13673 21.0849 5.98402 22.1045 4.99692 21.9915C4.52615 21.9377 4.08421 21.735 3.73411 21.4123C3 20.7358 3 19.1875 3 16.0909V11.0975C3 6.80891 3 4.6646 4.31802 3.3323C5.63604 2 7.75736 2 12 2C16.2426 2 18.364 2 19.682 3.3323C21 4.6646 21 6.80891 21 11.0975ZM8.25 6C8.25 5.58579 8.58579 5.25 9 5.25H15C15.4142 5.25 15.75 5.58579 15.75 6C15.75 6.41421 15.4142 6.75 15 6.75H9C8.58579 6.75 8.25 6.41421 8.25 6Z" fill="currentColor"/>
                  </svg>
                </button>
              </div>
              <label class="toolbar-toggle" for="taskMultiPromptCheck" style="margin:0;">
                <input type="checkbox" id="taskMultiPromptCheck" ${isEdit && this.task.multi_prompt ? 'checked' : ''} />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
                <span class="toggle-label">${t('tasks.multiPromptLabel')}</span>
              </label>
            </div>
            <div class="prompt-editor-wrapper">
              <textarea id="taskPrompt" placeholder="${t('tasks.promptPlaceholder')}" style="height: 100px;">${isEdit ? this.escapeHtml(this.task.prompt) : ''}</textarea>
              <button class="prompt-search-icon-btn" id="taskPromptSearchBtn" title="${t('tasks.searchPromptTitle')}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
              </button>
              <div class="multi-prompt-hint hidden" id="taskMultiPromptHint">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span>${t('tasks.multiPromptHint')}</span>
              </div>
            </div>
            <div class="prompt-count-row">
              <div class="section-header" style="margin:0;"><label style="margin:0;font-size:11px;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;">
                  <line x1="4" y1="21" x2="4" y2="14"></line><line x1="4" y1="10" x2="4" y2="3"></line>
                  <line x1="12" y1="21" x2="12" y2="12"></line><line x1="12" y1="8" x2="12" y2="3"></line>
                  <line x1="20" y1="21" x2="20" y2="16"></line><line x1="20" y1="12" x2="20" y2="3"></line>
                  <line x1="1" y1="14" x2="7" y2="14"></line><line x1="9" y1="8" x2="15" y2="8"></line>
                  <line x1="17" y1="16" x2="23" y2="16"></line>
                </svg>
                ${t('tasks.settingsLabel')}
              </label></div>
              <div class="prompt-count" style="margin-left:auto;">
                <span id="taskPromptCount">0</span>
              </div>
            </div>
          </div>

          <!-- Provider selector — row riêng (tách khỏi gen-compact-bar) để pills hiển thị rõ ràng -->
          <div class="task-provider-row">
            ${(() => {
              const canUseFlow = !!(window.featureGate?.canUse('gen_enabled'));
              const canUseChatGPT = !!(window.featureGate?.canUse('chatgpt_enabled'));
              const canUseGrok = !!(window.featureGate?.canUse('grok_enabled'));
              // ProviderMeta status (backend visibility control) - separate from FeatureGate
              const PM = window.ProviderMeta;
              const flowActive = PM?.isActive?.('flow') ?? true;
              const chatgptActive = PM?.isActive?.('chatgpt') ?? true;
              const grokActive = PM?.isActive?.('grok') ?? true;

              // Auto-switch: chọn provider không bị lock
              // Edit mode: honor task.provider (kể cả locked để user thấy)
              // Create mode: sử dụng defaultProvider từ settings, fallback nếu locked
              let currentProvider;
              if (isEdit) {
                currentProvider = this.task?.provider || 'flow';
              } else {
                // Create mode: ưu tiên defaultProvider từ settings
                const defaultProvider = this._afSettings?.defaultProvider || 'flow';
                // Check both FeatureGate (user access) AND ProviderMeta (backend status)
                const canUseDefault = (defaultProvider === 'flow' && canUseFlow && flowActive) ||
                                      (defaultProvider === 'chatgpt' && canUseChatGPT && chatgptActive) ||
                                      (defaultProvider === 'grok' && canUseGrok && grokActive);
                if (canUseDefault) {
                  currentProvider = defaultProvider;
                } else {
                  // Fallback: chọn provider đầu tiên khả dụng (cả access + active)
                  if (canUseFlow && flowActive) currentProvider = 'flow';
                  else if (canUseChatGPT && chatgptActive) currentProvider = 'chatgpt';
                  else if (canUseGrok && grokActive) currentProvider = 'grok';
                  else currentProvider = 'flow'; // all locked/inactive, will show overlay
                }
              }
              const flowTooltipText = t('tasks.flowProviderLockedHint') || 'Google Flow yêu cầu gói phù hợp.';
              const tooltipText = t('tasks.providerLockedHint') || 'ChatGPT yêu cầu gói Pro.';
              const grokTooltipText = t('tasks.grokProviderLockedHint') || 'Grok yêu cầu gói Pro.';
              // Brand icons
              const flowIcon = `<svg class="provider-tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>`;
              const chatgptIcon = `<svg class="provider-tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>`;
              const grokIcon = `<svg class="provider-tab-icon" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>`;
              const flowCrownIcon = !canUseFlow
                ? `<span class="provider-tab-lock"><svg width="12" height="12" viewBox="0 0 24 24" fill="#eab308" style="margin-left:4px;vertical-align:-1px;"><path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"/></svg></span>`
                : '';
              const crownIcon = !canUseChatGPT
                ? `<span class="provider-tab-lock"><svg width="12" height="12" viewBox="0 0 24 24" fill="#eab308" style="margin-left:4px;vertical-align:-1px;"><path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"/></svg></span>`
                : '';
              const grokCrownIcon = !canUseGrok
                ? `<span class="provider-tab-lock"><svg width="12" height="12" viewBox="0 0 24 24" fill="#eab308" style="margin-left:4px;vertical-align:-1px;"><path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"/></svg></span>`
                : '';
              // Provider names from ProviderMeta (fallback to i18n)
              const flowName = PM?.getName?.('flow') || t('gen.providerFlow') || 'Google Flow';
              const chatgptName = PM?.getName?.('chatgpt') || t('gen.providerChatGPT') || 'ChatGPT';
              const grokName = PM?.getName?.('grok') || t('gen.providerGrok') || 'Grok';
              return `
            <div class="provider-tabs" id="taskProviderTabs" role="tablist">
              <button type="button" class="provider-tab ${currentProvider === 'flow' ? 'provider-tab--active' : ''}${!canUseFlow ? ' provider-tab-locked' : ''}" data-provider="flow" role="tab" aria-selected="${currentProvider === 'flow' ? 'true' : 'false'}" ${!canUseFlow ? `aria-disabled="true" data-tooltip="${flowTooltipText}" title="${flowTooltipText}"` : ''} ${!flowActive ? 'style="display:none"' : ''}>
                ${flowIcon}<span>${flowName}</span>${flowCrownIcon}
              </button>
              <button type="button" class="provider-tab ${currentProvider === 'chatgpt' ? 'provider-tab--active' : ''}${!canUseChatGPT ? ' provider-tab-locked' : ''}" data-provider="chatgpt" role="tab" aria-selected="${currentProvider === 'chatgpt' ? 'true' : 'false'}" ${!canUseChatGPT ? `aria-disabled="true" data-tooltip="${tooltipText}" title="${tooltipText}"` : ''} ${!chatgptActive ? 'style="display:none"' : ''}>
                ${chatgptIcon}<span>${chatgptName}</span>${crownIcon}
              </button>
              <button type="button" class="provider-tab ${currentProvider === 'grok' ? 'provider-tab--active' : ''}${!canUseGrok ? ' provider-tab-locked' : ''}" data-provider="grok" role="tab" aria-selected="${currentProvider === 'grok' ? 'true' : 'false'}" ${!canUseGrok ? `aria-disabled="true" data-tooltip="${grokTooltipText}" title="${grokTooltipText}"` : ''} ${!grokActive ? 'style="display:none"' : ''}>
                ${grokIcon}<span>${grokName}</span>${grokCrownIcon}
              </button>
              <input type="hidden" id="taskProvider" value="${currentProvider}" />
            </div>
              `;
            })()}
          </div>

          ${(() => {
            // Initial mode toggle value:
            // - Grok edit: derive từ task.grok_mode (image/video)
            // - Edit khác: dùng task.media_type (Image/Video)
            // - Create mode: dùng effectiveMediaType (đã derive từ af_settings.defaultGenType)
            const isGrokEdit = isEdit && this.task.provider === 'grok';
            const tmt = isGrokEdit
              ? (this.task.grok_mode === 'video' ? 'Video' : 'Image')
              : (isEdit
                  ? (this.task.media_type === 'Video' ? 'Video' : 'Image')
                  : (effectiveMediaType === 'Video' ? 'Video' : 'Image'));
            return `
          <div class="gen-compact-bar" id="taskGenCompactBar" data-gen-mode="${tmt === 'Video' ? 'video' : 'image'}">
            <div class="gen-compact-item" id="taskMediaTypeGroup">
              <div class="task-media-toggle" id="taskMediaTypeToggle" role="tablist" aria-label="${t('tasks.modeLabel') || 'Chế độ'}">
                <button type="button" class="task-media-btn${tmt === 'Image' ? ' active' : ''}" data-mode="Image" data-tooltip="${t('tasks.imageType')}" aria-label="${t('tasks.imageType')}" role="tab">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                </button>
                <button type="button" class="task-media-btn${tmt === 'Video' ? ' active' : ''}" data-mode="Video" data-tooltip="${t('tasks.videoType')}" aria-label="${t('tasks.videoType')}" role="tab">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 8-6 4 6 4V8Z"/><rect x="2" y="6" width="14" height="12" rx="2" ry="2"/></svg>
                </button>
                <input type="hidden" id="taskMediaType" value="${tmt}" />
              </div>
            </div>
            <div class="gen-compact-item" id="taskImageModelGroup">`;
          })()}
              <div class="input-group select-group compact-select">
                <select id="taskModel">
                  ${(window.ModelRegistry?.safeGetModelsSync('flow', 'image') || []).map(m => `<option value="${this.escapeAttr(m.value)}" ${effectiveImageModel === m.value ? 'selected' : ''}>${this.escapeHtml(m.name)}</option>`).join('')}
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>
            <div class="gen-compact-item hidden" id="taskVideoModelGroup">
              <div class="input-group select-group compact-select">
                <select id="taskVideoModel">
                  ${(window.ModelRegistry?.safeGetModelsSync('flow', 'video') || []).map(m => `<option value="${this.escapeAttr(m.value)}" ${effectiveVideoModel === m.value ? 'selected' : ''}>${this.escapeHtml(m.name.replace(/^Veo 3\.1 - /, 'Veo 3.1 '))}</option>`).join('')}
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>
            <!-- Voice + Character moved xuống sau qty (line riêng) — xem #taskQuantityGroup. -->
            <!-- ChatGPT model (Instant/Thinking — GPT-5.5) — chỉ hiện khi provider='chatgpt' -->
            <div class="gen-compact-item hidden" id="taskChatgptModelGroup">
              <div class="input-group select-group compact-select">
                <select id="taskChatgptModel">
                  ${(window.ModelRegistry?.safeGetModelsSync('chatgpt', 'image') || [{ value: 'Instant', name: 'Instant' }, { value: 'Thinking', name: 'Thinking' }]).map(m => `<option value="${this.escapeAttr(m.value || m.name)}" ${effectiveChatgptModel === (m.value || m.name) ? 'selected' : ''}>${this.escapeHtml(m.name || m.value)}</option>`).join('')}
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>
            <!-- Wrap break — active khi data-gen-mode="video": tất cả setting SAU Model xuống dòng. -->
            <div class="gen-compact-break gen-compact-break--video" aria-hidden="true"></div>
            <div class="gen-compact-item hidden" id="taskVideoInputTypeRow">
              <div class="input-group select-group compact-select">
                <select id="taskVideoInputType">
                  <option value="Frames" ${effectiveVideoInputType === 'Frames' ? 'selected' : ''}>Frames</option>
                  <option value="Ingredients" ${effectiveVideoInputType === 'Ingredients' ? 'selected' : ''}>Ingredients</option>
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>
            <div class="gen-compact-item hidden" id="taskVideoDurationGroup">
              <div class="input-group select-group compact-select">
                <select id="taskVideoDuration" title="${window.I18n?.t('tasks.videoDuration') || 'Thời lượng video'}">
                  ${videoDurations.map(d => `<option value="${d}" ${effectiveVideoDuration === d ? 'selected' : ''}>${d}</option>`).join('')}
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>
            <div class="gen-compact-item" id="taskRatioGroup">
              <div class="input-group select-group compact-select">
                <select id="taskRatio">
                  <option value="16:9" ${effectiveRatio === '16:9' ? 'selected' : ''}>▬ 16:9</option>
                  <option value="4:3" ${effectiveRatio === '4:3' ? 'selected' : ''}>▭ 4:3</option>
                  <option value="1:1" ${effectiveRatio === '1:1' ? 'selected' : ''}>□ 1:1</option>
                  <option value="3:4" ${effectiveRatio === '3:4' ? 'selected' : ''}>▯ 3:4</option>
                  <option value="9:16" ${effectiveRatio === '9:16' ? 'selected' : ''}>▮ 9:16</option>
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>
            <div class="gen-compact-item" id="taskQuantityGroup">
              <div class="input-group compact-qty">
                <button class="compact-qty-btn" id="taskQtyMinus" type="button">-</button>
                <input type="number" id="taskQuantity" min="${window.ProviderConfigManager?.safeGetQuantityRangeSync?.('flow')?.min ?? 1}" max="${window.ProviderConfigManager?.safeGetQuantityRangeSync?.('flow')?.max ?? 4}" value="${effectiveQuantity}" />
                <button class="compact-qty-btn" id="taskQtyPlus" type="button">+</button>
              </div>
            </div>
            <!-- Break LUÔN active → Character/Voice xuống 1 line riêng (đồng bộ GenTab) -->
            <div class="gen-compact-break gen-compact-break--always" aria-hidden="true"></div>
            <!-- Flow Character Selector — line riêng (provider=flow, cả image+video) -->
            <div class="gen-compact-item hidden" id="taskCharacterPickerGroup">
              <button type="button" class="voice-picker-trigger" id="taskCharacterTrigger" data-i18n-title="character.pickerTitle" title="Chọn nhân vật">
                <span class="voice-picker-trigger-thumb-svg" id="taskCharacterTriggerThumb">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <circle cx="12" cy="8" r="4"></circle>
                    <path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"></path>
                  </svg>
                </span>
                <span class="voice-picker-label" id="taskCharacterLabel" data-i18n="character.none">Character</span>
                <svg class="voice-picker-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              <input type="hidden" id="taskCharacterSlug" value="${this.escapeAttr(this.task?.character_slug || '')}" />
              <input type="hidden" id="taskCharacterSearchValue" value="${this.escapeAttr(this.task?.character_search_value || '')}" />
            </div>
            <!-- Flow Voice Selector — line riêng (provider=flow + Video + supports_voice) -->
            <div class="gen-compact-item hidden" id="taskVoicePickerGroup">
              <button type="button" class="voice-picker-trigger" id="taskVoiceTrigger" data-i18n-title="voice.pickerTitle" title="Choose voice">
                <span class="voice-picker-trigger-thumb-svg" id="taskVoiceTriggerThumb">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                    <line x1="12" y1="19" x2="12" y2="23"></line>
                    <line x1="8" y1="23" x2="16" y2="23"></line>
                  </svg>
                </span>
                <span class="voice-picker-label" id="taskVoiceLabel" data-i18n="voice.random">Random voice</span>
                <svg class="voice-picker-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </button>
              <input type="hidden" id="taskVoiceSlug" value="${this.escapeAttr(this.task?.voice_slug || '')}" />
              <input type="hidden" id="taskVoiceSearchValue" value="${this.escapeAttr(this.task?.voice_search_value || '')}" />
            </div>
            <!-- G-5.3: Grok mode select (image/video) — chỉ hiển thị khi provider='grok' -->
            <div class="gen-compact-item hidden" id="taskGrokModeGroup">
              <div class="input-group select-group compact-select">
                <select id="taskGrokMode" title="Grok mode">
                  <option value="image" ${isEdit && this.task.grok_mode === 'image' ? 'selected' : (!isEdit ? 'selected' : '')}>Image</option>
                  <option value="video" ${isEdit && this.task.grok_mode === 'video' ? 'selected' : ''}>Video</option>
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>
            <!-- ChatGPT: toggle xóa tin nhắn sau khi gen thành công — chỉ hiển thị khi provider='chatgpt' -->
            <div class="gen-compact-item hidden" id="taskChatgptDeleteAfterGenGroup">
              <label class="gen-compact-toggle" title="${window.I18n?.t('settings.chatgptDeleteAfterGen') || 'Delete message after successful generation'}">
                <input type="checkbox" id="taskChatgptDeleteAfterGen" ${isEdit && this.task.chatgpt_delete_after_gen ? 'checked' : ''} />
                <span class="gen-compact-toggle-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                  </svg>
                </span>
                <span class="gen-compact-toggle-label">${window.I18n?.t('gen.deleteAfterGen') || 'Delete after gen'}</span>
              </label>
            </div>
            <!-- G-5.3: Grok video duration — chỉ hiển thị khi provider='grok' && mode='video' -->
            <div class="gen-compact-item hidden" id="taskGrokDurationGroup">
              <div class="input-group select-group compact-select">
                <select id="taskGrokDuration" title="Video duration">
                  ${grokDurations.map(d => `<option value="${d}" ${effectiveGrokDuration === d ? 'selected' : ''}>${d}</option>`).join('')}
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>
            <!-- G-5.3: Grok video resolution — chỉ hiển thị khi provider='grok' && mode='video' -->
            <div class="gen-compact-item hidden" id="taskGrokResolutionGroup">
              <div class="input-group select-group compact-select">
                <select id="taskGrokResolution" title="Video resolution">
                  <option value="480p" ${isEdit && this.task.grok_resolution === '480p' ? 'selected' : ''}>480p</option>
                  <option value="720p" ${isEdit && this.task.grok_resolution === '720p' ? 'selected' : (!isEdit ? 'selected' : '')}>720p</option>
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>
            <!-- Grok image quality (Grok update 2026-04) — chỉ hiển thị khi provider='grok' && mode='image' -->
            <div class="gen-compact-item hidden" id="taskGrokImageQualityGroup">
              <div class="input-group select-group compact-select">
                <select id="taskGrokImageQuality" title="Image quality">
                  <option value="speed" ${isEdit && this.task.grok_image_quality === 'speed' ? 'selected' : (!isEdit ? 'selected' : '')} data-i18n="grok.imageQualitySpeed">Nhanh</option>
                  <option value="quality" ${isEdit && this.task.grok_image_quality === 'quality' ? 'selected' : ''} data-i18n="grok.imageQualityQuality">Chất lượng</option>
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>
            <!-- Fix 3: Đã bỏ addon_prompt UI khỏi TaskModal.
                 Lý do: User yêu cầu đơn giản hoá form Task — phong cách (addon prompt) chỉ
                 dùng ở GenTab. KHÔNG xóa backend endpoint /api/v1/addon-prompts vì GenTab
                 vẫn dùng. Field addon_prompt_id/text trong taskData vẫn được preserve nếu
                 task cũ đã có (xem save()) để backward-compat. -->
          </div>

          <div class="form-group" id="taskRefImagesGroup">
            <!-- Section header — đồng bộ gen_tab: label + ref_mode select -->
            <div class="section-header section-header--with-select" style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:6px;">
              <label style="margin:0;font-size:11px;display:flex;align-items:center;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                ${t('tasks.refImages')}
              </label>
              <div class="input-group select-group compact-select ref-mode-select" title="${t('tasks.refModeTitle')}">
                <svg class="ref-mode-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="8.5" cy="8.5" r="1.5"></circle>
                  <polyline points="21 15 16 10 5 21"></polyline>
                </svg>
                <select id="taskRefImageMode" title="${t('tasks.refModeTitle')}">
                  <option value="all"${isEdit && this.task.ref_image_mode === 'all' ? ' selected' : ''}>${t('tasks.refModeAll')}</option>
                  <option value="mention"${isEdit && this.task.ref_image_mode === 'mention' ? ' selected' : ''}>${t('tasks.refModeMention')}</option>
                  <option value="sequential"${isEdit && this.task.ref_image_mode === 'sequential' ? ' selected' : ''}>${t('tasks.refModeSequential')}</option>
                  <option value="none"${isEdit && this.task.ref_image_mode === 'none' ? ' selected' : ''}>${t('tasks.refModeNone')}</option>
                </select>
                <svg class="select-arrow" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
            </div>

            <!-- Ref toolbar Actions — full-width upload + screen capture (đồng bộ gen_tab) -->
            <div class="ref-toolbar" id="taskRefToolbarActions">
              <div class="ref-toolbar-actions ref-toolbar-actions--full">
                <button type="button" class="ref-btn-upload ref-btn-upload--wide" id="taskOpenImagePickerBtn">
                  <svg class="ref-btn-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M15 8h.01"></path>
                    <path d="M12.5 21h-6.5a3 3 0 0 1 -3 -3v-12a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v6.5"></path>
                    <path d="M3 16l5 -5c.928 -.893 2.072 -.893 3 0l3.5 3.5"></path>
                    <path d="M14 14l1 -1c.679 -.653 1.473 -.829 2.214 -.526"></path>
                    <path d="M19 22v-6"></path>
                    <path d="M22 19l-3 -3l-3 3"></path>
                  </svg>
                  <span class="ref-btn-text">${t('gen.selectUploadImage')}</span>
                </button>
                <button type="button" class="ref-btn-capture ref-tooltip-right" id="taskScreenCaptureBtn" title="${t('tasks.screenCapture')}">
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="12" cy="12" r="4" stroke="#fff" fill="#fff" stroke-width="1.5"></circle>
                    <path d="M22 12C22 16.714 22 19.0711 20.5355 20.5355C19.0711 22 16.714 22 12 22C7.28595 22 4.92893 22 3.46447 20.5355C2 19.0711 2 16.714 2 12C2 7.28595 2 4.92893 3.46447 3.46447C4.92893 2 7.28595 2 12 2C16.714 2 19.0711 2 20.5355 3.46447C21.5093 4.43821 21.8356 5.80655 21.9449 8" stroke="#fff" stroke-width="1.5" stroke-linecap="round"></path>
                  </svg>
                </button>
              </div>
            </div>

            <div id="taskRefImagesPreview" class="ref-grid"></div>
            <div class="ref-drag-hint hidden" id="taskRefDragHint">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="5 9 2 12 5 15"></polyline>
                <polyline points="9 5 12 2 15 5"></polyline>
                <polyline points="15 19 12 22 9 19"></polyline>
                <polyline points="19 9 22 12 19 15"></polyline>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <line x1="12" y1="2" x2="12" y2="22"></line>
              </svg>
              <span>${t('tasks.dragToReorder')}</span>
            </div>
            <input type="hidden" id="taskFileIds" value="${isEdit ? this.escapeAttr(this.task.ref_file_ids) : ''}" />
          </div>

          <div class="ref-mention-bar hidden" id="taskMentionHelper">
            <span class="ref-mention-label">${t('tasks.imageName')}:</span>
            <div class="ref-mention-tags" id="taskMentionHelperTags"></div>
          </div>

          <!-- Hint: max ref images per prompt (visible in mention mode) -->
          <div class="ref-limit-hint hidden" id="taskRefLimitHint">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="16" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12.01" y2="8"></line>
            </svg>
            <span id="taskRefLimitHintText"></span>
          </div>

          <div class="form-group hidden" id="taskFramesGroup">
            <label style="margin:0 0 6px 0;font-size:11px;display:flex;align-items:center;">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align: -2px; margin-right: 4px;">
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
                <line x1="7" y1="2" x2="7" y2="22"></line>
                <line x1="17" y1="2" x2="17" y2="22"></line>
                <line x1="2" y1="12" x2="22" y2="12"></line>
                <line x1="2" y1="7" x2="7" y2="7"></line>
                <line x1="2" y1="17" x2="7" y2="17"></line>
                <line x1="17" y1="7" x2="22" y2="7"></line>
                <line x1="17" y1="17" x2="22" y2="17"></line>
              </svg>
              ${t('tasks.videoFrames')}
            </label>
            <!-- Single-prompt: global frame pair -->
            <div id="taskGlobalFrameConfig" class="frame-config">
              <div class="frame-slot" id="taskFrame1Slot">
                <div class="frame-slot-header">
                  <svg class="frame-slot-icon" viewBox="0 0 11 10" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5L8.9 7.5C9.46005 7.5 9.74008 7.5 9.95399 7.39101C10.1422 7.29513 10.2951 7.14215 10.391 6.95399C10.5 6.74008 10.5 6.46005 10.5 5.9V4.1C10.5 3.53995 10.5 3.25992 10.391 3.04601C10.2951 2.85785 10.1422 2.70487 9.95399 2.60899C9.74008 2.5 9.46005 2.5 8.9 2.5L5 2.5M3 7.5H2.1C1.53995 7.5 1.25992 7.5 1.04601 7.39101C0.857847 7.29513 0.704867 7.14215 0.608994 6.95399C0.5 6.74008 0.5 6.46005 0.5 5.9V4.1C0.5 3.53995 0.5 3.25992 0.608994 3.04601C0.704867 2.85785 0.857847 2.70487 1.04601 2.60899C1.25992 2.5 1.53995 2.5 2.1 2.5H3M3 0.5L3 9.5M1.75 9.5L4.25 9.5M1.75 0.499996L4.25 0.5"/></svg>
                  <span class="frame-slot-label">${t('tasks.frameStart')}</span>
                </div>
                <div class="frame-slot-body" id="taskFrame1Body">
                  <div class="frame-dropzone" id="taskFrame1PickBtn">
                    <svg class="frame-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                    <span class="frame-dropzone-text">${window.I18n?.t('gen.addFrame') || 'Add'}</span>
                  </div>
                </div>
                <input type="hidden" id="taskFrame1FileId" value="${isEdit ? this.escapeAttr(this.task.frame_1_file_id || '') : ''}" />
              </div>
              <div class="frame-slot" id="taskFrame2Slot">
                <div class="frame-slot-header">
                  <svg class="frame-slot-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5H2.6C2.03995 3.5 1.75992 3.5 1.54601 3.60899C1.35785 3.70487 1.20487 3.85785 1.10899 4.04601C1 4.25992 1 4.53995 1 5.1V6.9C1 7.46005 1 7.74008 1.10899 7.95399C1.20487 8.14215 1.35785 8.29513 1.54601 8.39101C1.75992 8.5 2.03995 8.5 2.6 8.5H6.5M8.5 3.5H9.4C9.96005 3.5 10.2401 3.5 10.454 3.60899C10.6422 3.70487 10.7951 3.85785 10.891 4.04601C11 4.25992 11 4.53995 11 5.1V6.9C11 7.46005 11 7.74008 10.891 7.95399C10.7951 8.14215 10.6422 8.29513 10.454 8.39101C10.2401 8.5 9.96005 8.5 9.4 8.5H8.5M8.5 10.5L8.5 1.5M9.75 1.5L7.25 1.5M9.75 10.5L7.25 10.5"/></svg>
                  <span class="frame-slot-label">${t('tasks.frameEnd')}</span>
                </div>
                <div class="frame-slot-body" id="taskFrame2Body">
                  <div class="frame-dropzone" id="taskFrame2PickBtn">
                    <svg class="frame-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                    <span class="frame-dropzone-text">${window.I18n?.t('gen.addFrame') || 'Add'}</span>
                  </div>
                </div>
                <input type="hidden" id="taskFrame2FileId" value="${isEdit ? this.escapeAttr(this.task.frame_2_file_id || '') : ''}" />
              </div>
            </div>
            <!-- Multi-prompt: per-prompt frame pairs (rendered dynamically) -->
            <div id="taskPerPromptFramesContainer" class="hidden"></div>
          </div>


          <div class="form-group">
            <div class="auto-download-row">
              ${(() => {
                // Get auto_download settings: edit mode uses task values, create mode uses af_settings defaults
                const autoDownloadOn = isEdit ? this.task.auto_download : (this._afSettings?.autoDownload || false);
                const dlRes = isEdit ? (this.task.download_resolution || '1k') : (this._afSettings?.downloadResolution || '1k');
                const videoDlRes = isEdit ? (this.task.video_download_resolution || '720p') : (this._afSettings?.videoDownloadResolution || '720p');
                const mediaType = isEdit ? this.task.media_type : 'Image';
                const canUseAutoDownload = window.featureGate?.canUse('auto_download');
                return `
              <label class="toolbar-toggle${!canUseAutoDownload ? ' feature-disabled' : ''}" for="taskAutoDownload" ${!canUseAutoDownload ? `title="${t('tasks.premiumRequired')}"` : ''}>
                <input type="checkbox" id="taskAutoDownload" ${autoDownloadOn ? 'checked' : ''} ${!canUseAutoDownload ? 'disabled' : ''} />
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
                <span class="toggle-label">${t('tasks.autoDownloadLabel')}</span>
              </label>
              ${!canUseAutoDownload ? window.featureGate.renderCrownSpan('auto_download') : ''}
              <span class="dl-res-select-wrap${!autoDownloadOn || mediaType === 'Video' ? ' hidden' : ''}" id="taskDownloadResWrap">
                <svg class="dl-res-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                <select id="taskDownloadResolution" class="pill-select pill-select-sm" title="${t('tasks.downloadQuality')}">
                  ${(window.ProviderConfigManager?.getDownloadResolutionsSync?.('flow', 'image') || [
                    { value: '1k', label: '1K' },
                    { value: '2k', label: '2K (Pro)' },
                    { value: '4k', label: '4K (Ultra)' },
                  ]).map(r => `<option value="${r.value}"${dlRes === r.value ? ' selected' : ''}>${r.label || r.value}</option>`).join('')}
                </select>
              </span>
              <span class="dl-res-select-wrap${!autoDownloadOn || mediaType !== 'Video' ? ' hidden' : ''}" id="taskVideoDownloadResWrap">
                <svg class="dl-res-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                <select id="taskVideoDownloadResolution" class="pill-select pill-select-sm" title="${t('tasks.downloadVideoQuality')}">
                  ${(window.ProviderConfigManager?.getDownloadResolutionsSync?.('flow', 'video') || [
                    { value: '720p', label: '720p' },
                    { value: '1080p', label: '1080p' },
                    { value: '4k', label: '4K (Ultra)' },
                  ]).map(r => `<option value="${r.value}"${videoDlRes === r.value ? ' selected' : ''}>${r.label || r.value}</option>`).join('')}
                </select>
              </span>
                `;
              })()}
            </div>
          </div>
        </div>
        ${isEdit ? `
          <div class="task-modal-tab-content hidden" id="taskResultsTab">
            ${this._renderResultsTab()}
          </div>
        ` : ''}
        </div>
        <div class="task-modal-footer">
          <button class="btn btn-secondary" id="cancelModalBtn">${t('tasks.cancelBtn')}</button>
          <button class="btn btn-primary" id="saveTaskBtn">${isEdit ? t('tasks.updateBtn') : t('tasks.createBtn')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.overlay);
  }

  bindEvents() {
    if (!this.overlay) return;

    // All providers locked overlay buttons
    const allLockedLoginBtn = this.overlay.querySelector('#taskAllLockedLoginBtn');
    const allLockedUpgradeBtn = this.overlay.querySelector('#taskAllLockedUpgradeBtn');
    const allLockedContactBtn = this.overlay.querySelector('#taskAllLockedContactBtn');

    allLockedLoginBtn?.addEventListener('click', () => {
      this.close();
      chrome.runtime.sendMessage({ action: 'openSettings' });
    });

    allLockedUpgradeBtn?.addEventListener('click', () => {
      /* upgrade modal removed — local-first */
    });

    allLockedContactBtn?.addEventListener('click', () => {
      const contactUrl = window.SystemConfig?.get('upgrade_contact_url', '');
      if (contactUrl) window.open(contactUrl, '_blank');
    });

    // Close buttons
    const closeBtn = this.overlay.querySelector('#closeModalBtn');
    const cancelBtn = this.overlay.querySelector('#cancelModalBtn');

    closeBtn?.addEventListener('click', () => this.close());
    cancelBtn?.addEventListener('click', () => this.close());

    // Click outside to close
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        // Skip if mention autocomplete was just selected — slow click (>50ms hold) causes
        // dropdown to hide before mouseup, making click event target the overlay
        if (Date.now() - (this._lastMentionSelectTime || 0) < 300) return;
        this.close();
      }
    });

    // Save button
    const saveBtn = this.overlay.querySelector('#saveTaskBtn');
    saveBtn?.addEventListener('click', () => this.save());

    // Media type toggle
    const mediaTypeSelect = this.overlay.querySelector('#taskMediaType');
    const imageModelGroup = this.overlay.querySelector('#taskImageModelGroup');
    const videoModelGroup = this.overlay.querySelector('#taskVideoModelGroup');
    const videoInputTypeRow = this.overlay.querySelector('#taskVideoInputTypeRow');
    const videoDurationGroup = this.overlay.querySelector('#taskVideoDurationGroup');
    const refImagesGroup = this.overlay.querySelector('#taskRefImagesGroup');
    const videoInputTypeSelect = this.overlay.querySelector('#taskVideoInputType');
    const videoModelSelect = this.overlay.querySelector('#taskVideoModel');
    const videoDurationSelect = this.overlay.querySelector('#taskVideoDuration');

    const framesGroup = this.overlay.querySelector('#taskFramesGroup');

    // Update video duration options based on model's duration_tier
    const updateTaskVideoDurationOptions = () => {
      if (!videoDurationSelect) return;
      const currentModel = videoModelSelect?.value || '';
      let tier = 'default';
      try {
        const models = window.ModelRegistry?.safeGetModelsSync?.('flow', 'video') || [];
        const modelObj = models.find(m => m.value === currentModel || m.name === currentModel);
        if (modelObj?.config?.duration_tier) tier = modelObj.config.duration_tier;
      } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#updateTaskVideoDurationOptions', _); }
      const durations = window.ProviderConfigManager?.safeGetVideoDurationsSync?.('flow', tier) || [];
      if (durations.length === 0) return;
      const prevValue = videoDurationSelect.value;
      videoDurationSelect.innerHTML = durations.map(d => `<option value="${d}">${d}</option>`).join('');
      if (prevValue && durations.includes(prevValue)) {
        videoDurationSelect.value = prevValue;
      } else {
        const defaultIdx = durations.indexOf('6s');
        videoDurationSelect.value = defaultIdx >= 0 ? durations[defaultIdx] : durations[0];
      }
    };
    videoModelSelect?.addEventListener('change', () => {
      updateTaskVideoDurationOptions();
      this._applyTaskFramesSupport(); // ẩn option Frames nếu model mới không hỗ trợ
      try { this._applyTaskVoicePickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#updateTaskVideoDurationOptions', _); }
      try { this._applyTaskCharacterPickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#updateTaskVideoDurationOptions', _); }
      // 2026-05-22: re-render ref preview để update ref-thumb-exceeded — refLimit có thể đổi
      // theo model (smart fallback supportsRefImages + per-model max_ref tương lai).
      try { this._renderTaskRefPreview(); } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#updateTaskVideoDurationOptions', _); }
    });
    videoDurationSelect?.addEventListener('change', () => {
      // 2026-05-22: duration change → ref support có thể đổi (vd Lite/Fast strict 4s/6s block).
      try { this._renderTaskRefPreview(); } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#updateTaskVideoDurationOptions', _); }
    });

    const updateTaskMediaUI = () => {
      const isVideo = mediaTypeSelect?.value === 'Video';
      imageModelGroup?.classList.toggle('hidden', isVideo);
      videoModelGroup?.classList.toggle('hidden', !isVideo);
      videoInputTypeRow?.classList.toggle('hidden', !isVideo);
      videoDurationGroup?.classList.toggle('hidden', !isVideo);
      // Flow Voice Selector — show/hide theo media_type + model.config.supports_voice
      try { this._applyTaskVoicePickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#updateTaskMediaUI', _); }
      try { this._applyTaskCharacterPickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#updateTaskMediaUI', _); }
      // 2026-05-28: _applyTaskFramesSupport CÓ THỂ ép videoInputType từ Frames → Ingredients
      // (vd Omni Flash supports_frames=false). Phải gọi TRƯỚC khi capture isFrames để ifElse
      // dưới đọc value đã được force-update. Trước fix: isFrames captured early = stale →
      // ifElse re-show framesGroup, undo việc hide do dispatch change handler thực hiện.
      if (isVideo) this._applyTaskFramesSupport();
      const isFrames = isVideo && videoInputTypeSelect?.value === 'Frames';
      // 2026-05-22: toggle wrap break để Video mode break trước ratio (đồng bộ GenTab).
      const compactBar = this.overlay?.querySelector('#taskGenCompactBar');
      if (compactBar) compactBar.dataset.genMode = isVideo ? 'video' : 'image';

      if (isFrames) {
        // Video+Frames: show frames config, hide ref images
        refImagesGroup?.classList.add('hidden');
        framesGroup?.classList.remove('hidden');
      } else if (isVideo) {
        // Video+Ingredients (hoặc model không support frames): show ref images, hide frames
        refImagesGroup?.classList.remove('hidden');
        framesGroup?.classList.add('hidden');
      } else {
        // Image: show ref images, hide frames
        refImagesGroup?.classList.remove('hidden');
        framesGroup?.classList.add('hidden');
      }
    };

    // Mode toggle (Image/Video icon button — class `.task-media-toggle` riêng cho TaskModal,
    // KHÔNG dùng chung `.node-form-mode-toggle` với workflow node để tránh coupling).
    // Dispatch 'change' trên hidden input để các handler hiện hữu (#taskMediaType change) tiếp tục hoạt động.
    const taskMediaTypeToggle = this.overlay.querySelector('#taskMediaTypeToggle');
    const syncMediaTypeToggleUI = () => {
      if (!taskMediaTypeToggle) return;
      const val = mediaTypeSelect?.value || 'Image';
      taskMediaTypeToggle.querySelectorAll('.task-media-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === val);
      });
    };

    mediaTypeSelect?.addEventListener('change', () => {
      syncMediaTypeToggleUI(); // sync toggle UI khi value thay đổi (cả programmatic + click)
      updateTaskMediaUI();
      this._updateRatioOptions();
      this._renderTaskRefPreview(); // Re-render to update ref limit grayscale
      // Re-apply provider-specific overrides cho non-Flow providers — updateTaskMediaUI
      // có thể unhide imageModelGroup/videoModelGroup mà ChatGPT/Grok cần ẩn.
      const currentProvider = this.overlay?.querySelector('#taskProvider')?.value;
      if (currentProvider === 'grok' || currentProvider === 'chatgpt') {
        this._renderTaskFormByProvider(currentProvider);
      }
    });

    if (taskMediaTypeToggle && mediaTypeSelect) {
      taskMediaTypeToggle.querySelectorAll('.task-media-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const mode = btn.dataset.mode;
          if (!mode || mediaTypeSelect.value === mode) return;
          mediaTypeSelect.value = mode;
          mediaTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });
      });
    }

    // CG-6.2 + Fix 6: Provider selector tab pill — re-render form theo provider (Flow vs ChatGPT)
    // Đồng bộ với GenTab CG-5 (sidebar.html provider-tabs). Hidden input #taskProvider giữ value
    // để code legacy (save(), _renderTaskFormByProvider) vẫn hoạt động.
    const providerHidden = this.overlay.querySelector('#taskProvider');
    const providerTabs = this.overlay.querySelector('#taskProviderTabs');
    if (providerTabs && providerHidden) {
      const setActiveProvider = (providerKey) => {
        providerHidden.value = providerKey;
        providerTabs.querySelectorAll('.provider-tab').forEach((btn) => {
          const isActive = btn.dataset.provider === providerKey;
          btn.classList.toggle('provider-tab--active', isActive);
          btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
      };
      providerTabs.querySelectorAll('.provider-tab').forEach((btn) => {
        btn.addEventListener('click', () => {
          const providerKey = btn.dataset.provider || 'flow';
          if (providerHidden.value === providerKey) return;

          // SS-Phase E: Unified gate intercept — feature lock OR tasks_run_max quota exhausted.
          const gate = this._resolveTaskProviderGate?.(providerKey) || { locked: false };
          if (gate.locked) {
            if (gate.reason === 'feature') {
              window.featureGate?.showLoginPrompt(gate.tooltip);
            } else if (gate.reason === 'quota') {
              if (window.featureGate?.showLoginPrompt) {
                window.featureGate.showLoginPrompt(gate.tooltip);
              }
            }
            return;
          }

          // Fix 5g (persist ratio per provider): lưu ratio hiện tại vào key tương ứng
          // trước khi đổi provider — Flow dùng 'ratio' (Dọc/Ngang/16:9), ChatGPT dùng
          // 'chatgpt_ratio' (story/portrait...). Khi switch back → restore.
          // G-5.4: Grok dùng 'grok_ratio' (5 keys giống ChatGPT) — cache riêng.
          const currentProvider = providerHidden.value;
          const ratioSel = this.overlay.querySelector('#taskRatio');
          const mediaSel = this.overlay.querySelector('#taskMediaType');
          if (ratioSel?.value) {
            if (currentProvider === 'chatgpt') {
              this._chatgptRatioCache = ratioSel.value;
            } else if (currentProvider === 'grok') {
              this._grokRatioCache = ratioSel.value;
            } else {
              this._flowRatioCache = ratioSel.value;
            }
          }
          // G-5.7: Cache mediaType per provider để restore khi switch back.
          // Bug fix: switch grok (Video) → chatgpt → grok thì mất Video mode (ChatGPT branch
          // ép mediaType='Image'). Cache lúc rời provider, restore lúc quay lại.
          // ChatGPT bỏ qua cache (luôn Image, không user-controlled).
          if (mediaSel?.value) {
            if (currentProvider === 'grok') {
              this._grokMediaTypeCache = mediaSel.value;
            } else if (currentProvider === 'flow') {
              this._flowMediaTypeCache = mediaSel.value;
            }
          }
          setActiveProvider(providerKey);
          this._renderTaskFormByProvider(providerKey);
          // Restore ratio cũ (nếu có) để user thấy lựa chọn trước đó của provider này
          if (providerKey === 'chatgpt' && this._chatgptRatioCache && ratioSel) {
            const opt = Array.from(ratioSel.options || []).find(o => o.value === this._chatgptRatioCache);
            if (opt) ratioSel.value = this._chatgptRatioCache;
          } else if (providerKey === 'grok' && this._grokRatioCache && ratioSel) {
            const opt = Array.from(ratioSel.options || []).find(o => o.value === this._grokRatioCache);
            if (opt) ratioSel.value = this._grokRatioCache;
          } else if (providerKey === 'flow' && this._flowRatioCache && ratioSel) {
            const opt = Array.from(ratioSel.options || []).find(o => o.value === this._flowRatioCache);
            if (opt) ratioSel.value = this._flowRatioCache;
          }
          // G-5.7: Restore mediaType khi switch back về Grok/Flow.
          // Priority: cache (user-modified trong session) > task.grok_mode (edit mode db) > giữ nguyên.
          if (providerKey === 'grok' && mediaSel) {
            const desiredMode = this._grokMediaTypeCache
              || (this.mode === 'edit' && this.task?.provider === 'grok' && this.task?.grok_mode === 'video' ? 'Video' : null)
              || (this.mode === 'edit' && this.task?.provider === 'grok' && this.task?.grok_mode === 'image' ? 'Image' : null);
            if (desiredMode && mediaSel.value !== desiredMode) {
              mediaSel.value = desiredMode;
              mediaSel.dispatchEvent(new Event('change', { bubbles: true }));
            }
          } else if (providerKey === 'flow' && mediaSel && this._flowMediaTypeCache) {
            if (mediaSel.value !== this._flowMediaTypeCache) {
              mediaSel.value = this._flowMediaTypeCache;
              mediaSel.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }

          // Post-audit fix: re-render ref preview để update ref-thumb-exceeded grayscale
          // theo provider mới (Flow 10/3 vs ChatGPT/Grok 4). Trước fix: nếu mediaType
          // không đổi giữa providers (Flow Image → ChatGPT Image) → media dispatch không
          // fire → _renderTaskRefPreview không trigger → grayscale stale.
          try { this._renderTaskRefPreview(); } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#setActiveProvider', _); }

          // G: Auto-open provider tab URL nếu chưa mở (fire-and-forget — không block UI).
          // ChatGPT → chatgpt.com, Grok → grok.com. activate=false để không steal focus
          // task modal. Logic shared với GenTab pattern.
          this._ensureProviderTab(providerKey);
        });
      });
      // Áp dụng state ban đầu (load mode hoặc default 'flow')
      this._renderTaskFormByProvider(providerHidden.value || 'flow');
    }

    // T-1.5 + Fix 2 + G-5.6: Auto-download toggle → show/hide resolution select based on
    // media type AND provider. ChatGPT/Grok URL CDN cố định — không có 1k/2k/720p/1080p
    // tương tự Flow → ẩn cả 2 wraps. Đồng bộ với GenTab Grok branch (sidebar).
    const taskAutoDownload = this.overlay.querySelector('#taskAutoDownload');
    const taskDownloadResWrap = this.overlay.querySelector('#taskDownloadResWrap');
    const taskVideoDownloadResWrap = this.overlay.querySelector('#taskVideoDownloadResWrap');
    const updateDownloadResolutionVisibility = () => {
      const isAutoDownload = taskAutoDownload?.checked;
      const isVideo = mediaTypeSelect?.value === 'Video';
      const providerVal = this.overlay?.querySelector('#taskProvider')?.value || 'flow';
      const isChatGPT = providerVal === 'chatgpt';
      const isGrok = providerVal === 'grok';
      if (taskDownloadResWrap) {
        taskDownloadResWrap.classList.toggle('hidden', !isAutoDownload || isVideo || isChatGPT || isGrok);
      }
      if (taskVideoDownloadResWrap) {
        taskVideoDownloadResWrap.classList.toggle('hidden', !isAutoDownload || !isVideo || isChatGPT || isGrok);
      }
    };
    taskAutoDownload?.addEventListener('change', updateDownloadResolutionVisibility);
    // Also update resolution visibility when media type changes
    mediaTypeSelect?.addEventListener('change', updateDownloadResolutionVisibility);
    videoInputTypeSelect?.addEventListener('change', () => {
      updateTaskMediaUI();
      this._updateTaskFrameMode();
      this._renderTaskRefPreview(); // Re-render to update ref limit grayscale
    });

    // Apply initial state
    updateTaskMediaUI();
    this._updateRatioOptions();

    // Bug fix (edit Grok task): updateTaskMediaUI() vừa unhide imageModelGroup theo isVideo,
    // override lệnh hide từ _renderTaskFormByProvider('grok') ở line 897. Re-apply provider-specific
    // overrides để ẩn lại model/quantity cho ChatGPT/Grok. Trước fix: edit task Grok thấy "Nano Banana Pro"
    // dropdown của Flow.
    const initialProvider = providerHidden?.value;
    if (initialProvider === 'grok' || initialProvider === 'chatgpt') {
      this._renderTaskFormByProvider(initialProvider);
    }

    // Image picker modal
    const openPickerBtn = this.overlay.querySelector('#taskOpenImagePickerBtn');
    openPickerBtn?.addEventListener('click', () => {
      const existingIds = (this.overlay?.querySelector('#taskFileIds')?.value || '').split(',').filter(Boolean);
      if (window.imagePickerModal) {
        // Post-audit fix: resolve maxSelections theo ref_mode + provider + media_type.
        // _getTaskRefLimit() xử lý đầy đủ: mention=Infinity, sequential=N_prompts, all/none=provider_limit.
        const refMode = this.overlay?.querySelector('#taskRefImageMode')?.value || 'all';
        // ref_mode=none → disable picker (không cho chọn)
        if (refMode === 'none') {
          console.log('[TaskModal] ref_mode=none, picker disabled');
          return;
        }
        const refLimit = this._getTaskRefLimit();
        // 2026-05-22: refLimit=0 → model không hỗ trợ ref (vd Veo Quality + Ingredients) → banner block.
        const _tmProvider = (this.task?.provider || this.overlay?.querySelector('#taskProvider')?.value || 'flow').toLowerCase();
        const _tmMediaTypeRaw = this.overlay?.querySelector('#taskMediaType')?.value || 'Image';
        const _tmIsVideo = _tmMediaTypeRaw === 'Video';
        const _tmVideoInput = this.overlay?.querySelector('#taskVideoInputType')?.value || 'Ingredients';
        const _tmModelValue = this.task?.model
          || this.overlay?.querySelector('#taskVideoModel')?.value
          || this.overlay?.querySelector('#taskImageModel')?.value
          || '';
        const _tmDuration = this.task?.video_duration
          || this.overlay?.querySelector('#taskVideoDuration')?.value
          || undefined;
        // 2026-05-31: multi-cap {image, video, total} cho Flow per-model (vd Omni Flash 7/1/7).
        const _tmCaps = (_tmProvider === 'flow' && typeof ImagePickerModal !== 'undefined'
            && ImagePickerModal.resolveCapsMulti)
          ? ImagePickerModal.resolveCapsMulti({
              provider: 'flow', mode: _tmIsVideo ? 'video' : 'image',
              isFrames: _tmIsVideo && _tmVideoInput === 'Frames',
              modelValue: _tmModelValue, duration: _tmDuration,
            })
          : { image: null, video: 0, total: null };
        // existingFileTypes: lookup từ _taskTileCache + task.ref_thumbnails (object format).
        const _tmExistingTypes = {};
        for (const id of existingIds) {
          const cache = this._taskTileCache?.[id];
          if (cache?.type === 'video') { _tmExistingTypes[id] = 'video'; continue; }
          const sv = this.task?.ref_thumbnails?.[id];
          if (sv && typeof sv === 'object' && sv.type === 'video') _tmExistingTypes[id] = 'video';
        }
        window.imagePickerModal.open({
          existingFileIds: existingIds,
          existingFileTypes: _tmExistingTypes,
          mediaFilter: 'image',
          // 2026-05-27: model Flow có supports_ref_video (vd Omni Flash) → cho phép chọn + upload video.
          allowVideo: _tmProvider === 'flow'
            && window.ProviderRegistry?.get?.('flow')?.supportsRefVideo?.(_tmModelValue) === true,
          maxSelections: refLimit === Infinity ? null : refLimit,
          maxImageSelections: refLimit === Infinity ? null : refLimit,
          maxVideoSelections: _tmCaps.video || 0,
          maxTotalSelections: _tmCaps.total,
          noRefSupportContext: refLimit === 0 ? {
            provider: _tmProvider,
            modelValue: _tmModelValue,
            mediaType: _tmIsVideo ? 'video' : 'image',
            inputType: _tmIsVideo ? _tmVideoInput : undefined,
            duration: _tmDuration,
          } : null,
          onConfirm: (images) => this.handleImagePickerConfirm(images)
        });
      }
    });

    // Drag-drop files onto button (đồng bộ pattern GenTab line ~512-528).
    // KHÁC GenTab: TaskModal upload ngay qua ImmediateUploader (không lazy như GenTab)
    // → giữ logic immediate upload sẵn có của TaskModal.
    if (openPickerBtn) {
      openPickerBtn.addEventListener('dragover', (e) => {
        e.preventDefault();
        openPickerBtn.classList.add('drag-over');
      });
      openPickerBtn.addEventListener('dragleave', () => {
        openPickerBtn.classList.remove('drag-over');
      });
      openPickerBtn.addEventListener('drop', (e) => {
        e.preventDefault();
        openPickerBtn.classList.remove('drag-over');
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length > 0) {
          this._handleDroppedFiles(files);
        }
      });
    }

    // Quantity +/- buttons — range từ provider_configs.flow.api_config.quantity_range
    // (admin tweak min/max realtime qua SSE provider:api_config_updated → modal được re-render).
    const qtyInput = this.overlay.querySelector('#taskQuantity');
    const _qRange = window.ProviderConfigManager?.safeGetQuantityRangeSync?.('flow');
    const _qMin = _qRange?.min ?? 1;
    const _qMax = _qRange?.max ?? 4;
    this.overlay.querySelector('#taskQtyMinus')?.addEventListener('click', () => {
      const val = parseInt(qtyInput.value) || _qMin;
      if (val > _qMin) qtyInput.value = val - 1;
    });
    this.overlay.querySelector('#taskQtyPlus')?.addEventListener('click', () => {
      const val = parseInt(qtyInput.value) || _qMin;
      if (val < _qMax) qtyInput.value = val + 1;
    });

    // Ref Image Mode change handler
    const isEdit = this.mode === 'edit' && this.task;
    const refModeSelect = this.overlay.querySelector('#taskRefImageMode');
    if (refModeSelect) {
      if (isEdit && this.task.ref_image_mode) {
        refModeSelect.value = this.task.ref_image_mode;
      }
      refModeSelect.addEventListener('change', () => {
        this._updateRefModeUI();
        this._updatePromptCount();
        // UX (2026-05-02): Khi user đổi ref_mode khỏi 'mention', hide dropdown đang hiện.
        if (refModeSelect.value !== 'mention') {
          this._hideMentionDropdown();
        }
      });
      this._updateRefModeUI();
    }

    // Screen Capture button
    const captureBtn = this.overlay.querySelector('#taskScreenCaptureBtn');
    if (captureBtn) {
      captureBtn.addEventListener('click', async () => {
        if (!window.ScreenCapture) {
          window.customDialog?.alert(t('tasks.captureNotReady'), { type: 'warning' });
          return;
        }
        captureBtn.disabled = true;
        captureBtn.classList.add('btn-loading');
        try {
          const result = await window.ScreenCapture.startCapture();
          if (result?.success && result.uploadId) {
            const uploadKey = result.uploadId;
            const fileIdsInput = this.overlay?.querySelector('#taskFileIds');
            if (fileIdsInput) {
              const existingIds = fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
              existingIds.push(uploadKey);
              fileIdsInput.value = existingIds.join(', ');
            }
            // Track upload key để upload:completed handler sync tile_id
            this._modalUploadKeys?.add(uploadKey);
            // Cache thumbnail nếu có (từ pendingUploadFiles hoặc result)
            const pending = window.pendingUploadFiles?.get(uploadKey);
            if (pending?.thumbnail) {
              if (!this._taskTileCache) this._taskTileCache = {};
              this._taskTileCache[uploadKey] = { thumbnail: pending.thumbnail, file_name: '' };
            }
            // Auto-set name from capture if provided
            if (result.captureName && uploadKey) {
              this._refImageNames[uploadKey] = result.captureName;
            }
            this._renderTaskRefPreview();
            this._refreshMentionHelper();
            this._updateDragHint();
            this._updateButtonState();
          } else if (result?.error) {
            console.warn('[TaskModal] ScreenCapture failed:', result.error);
          }
        } catch (err) {
          console.warn('[TaskModal] ScreenCapture error:', err.message);
          window.customDialog?.alert(t('tasks.captureFailed') + (err.message || t('common.error')), { type: 'warning' });
        } finally {
          captureBtn.disabled = false;
          captureBtn.classList.remove('btn-loading');
        }
      });
    }

    // Multi-prompt toggle
    const multiPromptCheck = this.overlay.querySelector('#taskMultiPromptCheck');
    const multiPromptHint = this.overlay.querySelector('#taskMultiPromptHint');
    if (multiPromptCheck) {
      this._multiPromptEnabled = multiPromptCheck.checked;
      if (this._multiPromptEnabled && multiPromptHint) multiPromptHint.classList.remove('hidden');
      multiPromptCheck.addEventListener('change', () => {
        this._multiPromptEnabled = multiPromptCheck.checked;
        if (multiPromptHint) multiPromptHint.classList.toggle('hidden', !this._multiPromptEnabled);
        this._updatePromptCount();
        this._renderTaskRefPreview();
        this._updateTaskFrameMode();
      });
    }

    // Prompt input → update count + debounced frame mode update
    // BUG-T4 FIX: Bind cả 'input' và 'paste' event để cập nhật realtime khi paste nhiều prompts
    const taskPromptArea = this.overlay.querySelector('#taskPrompt');
    if (taskPromptArea) {
      const updatePromptHandler = () => {
        this._updatePromptCount();
        // Multi-prompt + sequential: ref limit scale theo N_prompts → re-render thumbnails (đồng bộ GenTab)
        const isMulti = !!this.overlay?.querySelector('#taskMultiPromptCheck')?.checked;
        const refMode = this.overlay?.querySelector('#taskRefImageMode')?.value || 'all';
        if (isMulti && refMode === 'sequential') {
          try { this._renderTaskRefPreview(); } catch (e) { globalThis.SEOSONA_swallow?.('TaskModal#updatePromptHandler', e); }
        }
      };
      taskPromptArea.addEventListener('input', updatePromptHandler);
      taskPromptArea.addEventListener('paste', () => {
        // Delay nhỏ để DOM cập nhật sau paste
        setTimeout(updatePromptHandler, 10);
      });
      // Debounced: update per-prompt frame mode when prompt count changes
      let _frameDebounceTimer = null;
      const frameUpdateHandler = () => {
        clearTimeout(_frameDebounceTimer);
        _frameDebounceTimer = setTimeout(() => this._updateTaskFrameMode(), 500);
      };
      taskPromptArea.addEventListener('input', frameUpdateHandler);
      taskPromptArea.addEventListener('paste', () => setTimeout(frameUpdateHandler, 10));
      this._updatePromptCount();
    }

    // Search & Save prompt buttons
    const promptSearchBtn = this.overlay.querySelector('#taskPromptSearchBtn');
    const promptSaveBtn = this.overlay.querySelector('#taskPromptSaveBtn');
    if (promptSearchBtn) {
      promptSearchBtn.addEventListener('click', () => {
        if (window.GenTab?._openPromptSearchModal) {
          const taskArea = this.overlay?.querySelector('#taskPrompt');
          const origFill = GenTab._psmFillPrompt;
          // Override fill to target TaskModal's textarea (survives close→fill order)
          GenTab._psmFillPrompt = function(content) {
            if (taskArea && taskArea.isConnected) {
              taskArea.value = content;
              taskArea.dispatchEvent(new Event('input', { bubbles: true }));
              taskArea.focus();
              window.showNotification?.(t('tasks.promptInserted'), 'success', 1500);
            } else {
              origFill(content);
            }
            GenTab._psmFillPrompt = origFill;
          };
          GenTab._openPromptSearchModal();
        }
      });
    }
    if (promptSaveBtn) {
      promptSaveBtn.addEventListener('click', () => {
        const content = this.overlay?.querySelector('#taskPrompt')?.value?.trim() || '';
        if (window.MyPromptsTab) {
          window.MyPromptsTab._showSaveDialog(content ? { title: '', content: content, category: '' } : null);
        }
      });
    }

    // Quantity change → update prompt count
    const quantityInput = this.overlay.querySelector('#taskQuantity');
    if (quantityInput) {
      quantityInput.addEventListener('input', () => this._updatePromptCount());
    }

    // Fix 3: Đã bỏ Addon Prompts UI — không gọi _initTaskAddonPrompts() nữa.
    // Backward-compat: task cũ có addon_prompt_id sẽ vẫn được giữ trong save() (field preserve),
    // nhưng user không thể đổi nữa. Helper methods _initTaskAddonPrompts/_openTaskStyleSelectModal/
    // _renderAddonPromptList/_updateAddonTriggerLabel/_getSelectedAddonPrompt được giữ trong file
    // để tránh lỗi nếu code khác gọi (defensive). Chúng KHÔNG được kích hoạt vì DOM trigger đã bỏ.

    // @Mention autocomplete on prompt textarea
    this._initMentionAutocomplete();

    // Frame picker buttons (global pair)
    this._bindTaskFramePicker(1);
    this._bindTaskFramePicker(2);

    // Per-prompt frame mode: show global or per-prompt based on multi-prompt state
    this._updateTaskFrameMode();

    // Render existing ref images preview when editing
    if (this.mode === 'edit' && this.task?.ref_file_ids) {
      this._renderExistingRefPreview(this.task.ref_file_ids);
    }

    // Results tab (edit mode only)
    if (this.mode === 'edit') {
      this._bindResultsTab();
    }

    // ESC to close
    const escHandler = (e) => {
      if (e.key === 'Escape') {
        this.close();
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);

    // Listen for featuregate changes to update auto-download toggle + provider gate
    // SS-Phase E: Cũng refresh khi quota change (prompt:completed sau task chạy xong)
    // để crown icon tasks_run_max appear/disappear realtime trong modal đang mở.
    this._featuregateHandler = () => {
      this._updateAutoDownloadToggle();
      this._refreshProviderSelectGate();
    };
    window.eventBus?.on('featuregate:refreshed', this._featuregateHandler);
    window.eventBus?.on('prompt:completed', this._featuregateHandler);
    window.eventBus?.on('featuregate:quota_warning', this._featuregateHandler);
    window.eventBus?.on('featuregate:quota_exhausted', this._featuregateHandler);
  }

  /**
   * CG-Audit: Refresh ChatGPT provider tab pill state khi entitlements thay đổi.
   * Idempotent — gọi nhiều lần OK. Nếu user vừa upgrade Pro, unlock pill;
   * nếu vừa downgrade, lock + force chuyển sang flow.
   */
  /**
   * SS-Phase E: Resolve gate state cho 1 provider tab trong TaskModal context.
   * KHÁC GenTab: Task path dùng `tasks_run_max` chung cho mọi provider (audit note —
   * task ChatGPT/Grok runs KHÔNG decrement chatgpt_run_max/grok_run_max vì outer
   * task_run gate đã cover quota). Crown chỉ dựa trên feature flag + tasks_run_max.
   */
  _resolveTaskProviderGate(provider) {
    const fg = window.featureGate;
    if (!fg) return { locked: false, reason: null, tooltip: '' };

    // Step 1: Feature lock (gen_enabled / chatgpt_enabled / grok_enabled).
    if (provider === 'flow' && !fg.canUse?.('gen_enabled')) {
      return {
        locked: true,
        reason: 'feature',
        tooltip: t('tasks.flowProviderLockedHint') || 'Google Flow yêu cầu gói phù hợp.',
      };
    }
    if (provider === 'chatgpt' && !fg.canUse?.('chatgpt_enabled')) {
      return {
        locked: true,
        reason: 'feature',
        tooltip: t('tasks.providerLockedHint') || 'ChatGPT yêu cầu gói Pro.',
      };
    }
    if (provider === 'grok' && !fg.canUse?.('grok_enabled')) {
      return {
        locked: true,
        reason: 'feature',
        tooltip: t('tasks.grokProviderLockedHint') || 'Grok yêu cầu gói Pro.',
      };
    }

    // Step 2: tasks_run_max quota — shared cho cả 3 provider.
    const q = fg.checkQuota?.('tasks_run_max');
    if (q && !q.allowed) {
      const limitText = q.limit === 'unlimited' ? '∞' : q.limit;
      const tooltip = (window.I18n?.t?.('tasks.quotaExhaustedHint', { used: q.used, limit: limitText }))
        || (window.I18n?.t?.('taskNotify.quotaExhaustedTooltip', { used: q.used, limit: limitText }))
        || `Đã hết ${q.used}/${limitText} lượt task hôm nay. Nâng cấp để tăng quota.`;
      return { locked: true, reason: 'quota', tooltip };
    }

    return { locked: false, reason: null, tooltip: '' };
  }

  _refreshProviderSelectGate() {
    if (!this.overlay) return;
    const providerTabs = this.overlay.querySelector('#taskProviderTabs');
    const providerHidden = this.overlay.querySelector('#taskProvider');
    if (!providerTabs || !providerHidden) return;

    // Cleanup legacy hint paragraph nếu còn từ render trước
    const lockedHint = this.overlay.querySelector('.task-provider-locked-hint');
    if (lockedHint) lockedHint.remove();

    // Source of truth: DOM tabs. Thêm provider mới chỉ cần update HTML render template.
    const allProviders = Array.from(providerTabs.querySelectorAll('.provider-tab[data-provider]'))
      .map((btn) => btn.dataset.provider)
      .filter(Boolean);
    const gates = {};

    allProviders.forEach((provider) => {
      const btn = providerTabs.querySelector(`.provider-tab[data-provider="${provider}"]`);
      if (!btn) return;
      const gate = this._resolveTaskProviderGate(provider);
      gates[provider] = gate;

      const span = btn.querySelector('span');
      const baseLabel = provider === 'flow'
        ? (t('gen.providerFlow') || 'Flow')
        : (provider === 'chatgpt' ? (t('gen.providerChatGPT') || 'ChatGPT') : (t('gen.providerGrok') || 'Grok'));
      if (span) span.textContent = baseLabel;

      let lockIcon = btn.querySelector('.provider-tab-lock');
      if (gate.locked) {
        btn.classList.add('provider-tab-locked');
        btn.setAttribute('aria-disabled', 'true');
        btn.setAttribute('title', gate.tooltip);
        btn.setAttribute('data-tooltip', gate.tooltip);
        btn.setAttribute('data-lock-reason', gate.reason || '');
        if (!lockIcon) {
          lockIcon = document.createElement('span');
          lockIcon.className = 'provider-tab-lock';
          lockIcon.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="#eab308" style="margin-left:4px;vertical-align:-1px;"><path d="M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z"/></svg>';
          btn.appendChild(lockIcon);
        }
      } else {
        btn.classList.remove('provider-tab-locked');
        btn.removeAttribute('aria-disabled');
        btn.removeAttribute('title');
        btn.removeAttribute('data-tooltip');
        btn.removeAttribute('data-lock-reason');
        if (lockIcon) lockIcon.remove();
      }
    });

    // Force chuyển sang flow CHỈ khi current provider mất quyền (reason='feature').
    // KHÔNG force-switch khi reason='quota' (chỉ hết hôm nay — giữ provider để user thấy crown
    // + tooltip rõ ràng, click vào để mở upgrade modal).
    const currentProvider = providerHidden.value;
    const currentGate = gates[currentProvider];
    if (currentGate?.locked && currentGate.reason === 'feature' && currentProvider !== 'flow') {
      providerHidden.value = 'flow';
      providerTabs.querySelectorAll('.provider-tab').forEach((b) => {
        const isActive = b.dataset.provider === 'flow';
        b.classList.toggle('provider-tab--active', isActive);
        b.setAttribute('aria-selected', isActive ? 'true' : 'false');
      });
      if (typeof this._renderTaskFormByProvider === 'function') {
        this._renderTaskFormByProvider('flow');
      }
    }
  }

  /**
   * Update auto-download toggle based on plan features
   */
  _updateAutoDownloadToggle() {
    const toggle = this.overlay?.querySelector('#taskAutoDownload');
    const label = toggle?.closest('.toolbar-toggle');
    const resWrap = this.overlay?.querySelector('#taskDownloadResWrap');
    const videoResWrap = this.overlay?.querySelector('#taskVideoDownloadResWrap');
    if (!toggle || !label) return;

    const canUse = window.featureGate?.canUse('auto_download') ?? false;

    if (canUse) {
      toggle.disabled = false;
      label.classList.remove('feature-disabled');
      label.removeAttribute('title');
      (label.querySelector('.premium-crown') || label.parentElement?.querySelector('.premium-crown'))?.remove();
    } else {
      toggle.disabled = true;
      toggle.checked = false;
      label.classList.add('feature-disabled');
      label.setAttribute('title', t('tasks.premiumRequired'));
      // Add crown icon
      if (typeof window._ensurePremiumCrown === 'function') {
        window._ensurePremiumCrown(label);
      }
      // Hide resolution wrappers khi disabled
      resWrap?.classList.add('hidden');
      videoResWrap?.classList.add('hidden');
    }
  }

  _renderExistingRefPreview(refFileIds) {
    if (!refFileIds) return;
    // Reuse shared render method with remove buttons
    this._renderTaskRefPreview();
  }

  _bindTaskFramePicker(frameNum) {
    const dropzone = this.overlay?.querySelector(`#taskFrame${frameNum}PickBtn`);
    if (!dropzone) return;
    dropzone.addEventListener('click', () => this._openTaskFramePicker(frameNum));

    // Render existing frame preview on edit
    if (this.mode === 'edit' && this.task) {
      const fieldName = frameNum === 1 ? 'frame_1_file_id' : 'frame_2_file_id';
      const fieldThumb = frameNum === 1 ? 'frame_1_thumbnail' : 'frame_2_thumbnail';
      const fileId = this.task[fieldName];
      const thumbnail = this.task[fieldThumb] || this._taskTileCache?.[fileId]?.thumbnail || null;
      if (fileId) {
        this._setTaskFrameImage(frameNum, fileId, thumbnail);
      }
    }
  }

  _openTaskFramePicker(frameNum) {
    const fileIdInput = this.overlay?.querySelector(`#taskFrame${frameNum}FileId`);
    const existingId = (fileIdInput?.value || '').trim();
    if (window.imagePickerModal) {
      window.imagePickerModal.open({
        existingFileIds: existingId ? [existingId] : [],
        singleSelect: true,
        mediaFilter: 'image',
        onConfirm: async (images) => {
          if (images.length > 0) {
            const img = images[0];
            if (img.source === 'upload' && img.file) {
              const key = img.fileId || `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
              if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
              window.pendingUploadFiles.set(key, { file: img.file, thumbnail: img.thumbnail });
              if (!this._taskTileCache) this._taskTileCache = {};
              this._taskTileCache[key] = { thumbnail: img.thumbnail, file_name: '' };
              if (window.ImmediateUploader) {
                ImmediateUploader.upload(img.file, img.thumbnail, { key }).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskModal#onConfirm', _e); });
              } else if (window.PendingUploadStore) {
                PendingUploadStore.saveLightweight(key, { thumbnail: img.thumbnail, fileName: img.file.name, fileSize: img.file.size, fileType: img.file.type });
              }
              img.fileId = key;
              this._modalUploadKeys?.add(key);
            } else if (img.source === 'album' && window.ImagePickerModal?.prepareAlbumImageForRef) {
              // Album image: xử lý qua prepareAlbumImageForRef
              try {
                const prepared = await window.ImagePickerModal.prepareAlbumImageForRef(img);
                if (prepared) {
                  const key = prepared.key;
                  if (!this._taskTileCache) this._taskTileCache = {};

                  // Cache thumbnail
                  let thumb = img.thumbnail;
                  if (img.thumbnail_url) {
                    thumb = img.thumbnail_url;
                  } else if (img.album_image_id && window.ImageStore) {
                    try {
                      const blobUrl = await window.ImageStore.getThumbnail(img.album_image_id);
                      if (blobUrl) thumb = blobUrl;
                    } catch (e) { /* ignore */ }
                  }
                  this._taskTileCache[key] = { thumbnail: thumb, file_name: prepared.file_name || '' };

                  // Upload ngay nếu là STALE image
                  if (key.startsWith('upload_')) {
                    const pendingFile = window.pendingUploadFiles?.get(key)?.file;
                    if (pendingFile && window.ImmediateUploader) {
                      ImmediateUploader.upload(pendingFile, img.thumbnail, { key }).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskModal#_setTaskFrameImage', _e); });
                    }
                    this._modalUploadKeys?.add(key);
                  }

                  img.fileId = key;
                  img.thumbnail = thumb;
                }
              } catch (err) {
                console.error('[TaskModal] Lỗi chuẩn bị ảnh album cho frame:', err);
              }
            } else {
              if (!this._taskTileCache) this._taskTileCache = {};
              if (img.fileId && img.thumbnail) {
                this._taskTileCache[img.fileId] = { thumbnail: img.thumbnail, file_name: img.file_name || '' };
              }
            }
            this._setTaskFrameImage(frameNum, img.fileId, img.thumbnail);
          }
        }
      });
    }
  }

  /**
   * Set task frame image with thumbnail + remove button
   */
  _setTaskFrameImage(frameNum, fileId, thumbnail) {
    const input = this.overlay?.querySelector(`#taskFrame${frameNum}FileId`);
    const body = this.overlay?.querySelector(`#taskFrame${frameNum}Body`);
    const slot = this.overlay?.querySelector(`#taskFrame${frameNum}Slot`);

    if (input) input.value = fileId || '';

    if (body) {
      if (fileId) {
        const isPending = fileId.startsWith('upload_');
        const isUploading = isPending && window.ImmediateUploader?.isUploading(fileId);
        const thumbSrc = thumbnail || window.pendingUploadFiles?.get(fileId)?.thumbnail || this._taskTileCache?.[fileId]?.thumbnail || '';
        slot?.classList.add('has-image');
        body.innerHTML = `
          <div class="frame-thumb-wrap ${isUploading ? 'uploading' : ''}" data-file-id="${this.escapeAttr(fileId)}">
            ${thumbSrc
              ? `<img src="${thumbSrc}" alt="Frame ${frameNum}" />`
              : `<div class="frame-thumb-fallback">${(fileId || '').substring(0, 12)}</div>`
            }
            <div class="ref-thumb-remove" title="${t('tasks.removeTitle')}">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </div>
          </div>
        `;
        // Bind remove button
        const removeBtn = body.querySelector('.ref-thumb-remove');
        if (removeBtn) {
          removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isPending && window.ImmediateUploader) {
              ImmediateUploader.cancel(fileId);
            }
            this._modalUploadKeys?.delete(fileId);
            this._setTaskFrameImage(frameNum, '', '');
          });
        }
        // Click thumbnail to re-pick
        const thumbWrap = body.querySelector('.frame-thumb-wrap');
        if (thumbWrap && !isUploading) {
          thumbWrap.addEventListener('click', (e) => {
            if (e.target.closest('.ref-thumb-remove')) return;
            this._openTaskFramePicker(frameNum);
          });
        }
      } else {
        slot?.classList.remove('has-image');
        body.innerHTML = `
          <div class="frame-dropzone" id="taskFrame${frameNum}PickBtn">
            <svg class="frame-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
            <span class="frame-dropzone-text">${window.I18n?.t('gen.addFrame') || 'Add'}</span>
          </div>
        `;
        // Re-bind click on dropzone
        const dropzone = body.querySelector('.frame-dropzone');
        if (dropzone) {
          dropzone.addEventListener('click', () => this._openTaskFramePicker(frameNum));
        }
      }
    }
  }

  /**
   * Re-render frame previews khi upload state thay đổi (xóa/thêm loading animation)
   */
  _reRenderFrameUploading() {
    for (const fNum of [1, 2]) {
      const frameInput = this.overlay?.querySelector(`#taskFrame${fNum}FileId`);
      const fid = frameInput?.value?.trim();
      if (fid && fid.startsWith('upload_')) {
        const thumb = this._taskTileCache?.[fid]?.thumbnail || window.pendingUploadFiles?.get(fid)?.thumbnail || '';
        this._setTaskFrameImage(fNum, fid, thumb);
      }
    }
  }

  // ========== Per-Prompt Frame Pairs (Video+Frames multi-prompt) ==========

  /**
   * Switch between global frame config and per-prompt frame pairs
   * based on multi-prompt state + Video+Frames mode
   */
  _updateTaskFrameMode() {
    const globalConfig = this.overlay?.querySelector('#taskGlobalFrameConfig');
    const perPromptContainer = this.overlay?.querySelector('#taskPerPromptFramesContainer');
    if (!globalConfig || !perPromptContainer) return;

    const isMultiPrompt = this._multiPromptEnabled;
    const mediaType = this.overlay?.querySelector('#taskMediaType')?.value;
    const videoInputType = this.overlay?.querySelector('#taskVideoInputType')?.value;
    const isVideoFrames = mediaType === 'Video' && videoInputType === 'Frames';

    if (!isVideoFrames) {
      // Not Video+Frames: always show global (hidden by taskFramesGroup anyway)
      globalConfig.classList.remove('hidden');
      perPromptContainer.classList.add('hidden');
      return;
    }

    const promptCount = this._getTaskPromptCount();

    if (isMultiPrompt && promptCount > 1) {
      globalConfig.classList.add('hidden');
      perPromptContainer.classList.remove('hidden');
      this._renderTaskPerPromptFrames(promptCount);
    } else {
      globalConfig.classList.remove('hidden');
      perPromptContainer.classList.add('hidden');
    }
  }

  /**
   * Get prompt count from task modal textarea
   */
  _getTaskPromptCount() {
    const promptArea = this.overlay?.querySelector('#taskPrompt');
    const text = promptArea?.value?.trim() || '';
    if (!text) return 0;
    if (!this._multiPromptEnabled) return 1;
    return TaskModal._splitMultiPrompt(text).length;
  }

  /**
   * Split multi-prompt text với escape decode.
   *
   * Quy ước escape: user gõ `\\n\\n` (4 chars: backslash-n-backslash-n) trong textarea
   * → coi là 1 blank line GIỮA cùng 1 prompt (KHÔNG phải separator).
   * Separator giữa các prompts vẫn là blank line (\n\s*\n) thực sự trong textarea.
   *
   * Ví dụ:
   *   "Scene 1.\\n\\nThe scene continues.\n\nScene 2."
   *   → split bằng \n\s*\n → 2 prompts:
   *      [0] "Scene 1.\\n\\nThe scene continues."
   *      [1] "Scene 2."
   *   → decode \\n → \n → final:
   *      [0] "Scene 1.\n\nThe scene continues." (giữ blank line trong cùng prompt)
   *      [1] "Scene 2."
   */
  static _splitMultiPrompt(text) {
    if (!text) return [];
    return text.split(/\n\s*\n/)
      .map(b => b.trim().replace(/\\n/g, '\n'))
      .filter(b => b.length > 0);
  }

  /**
   * Get prompt previews (first 40 chars each)
   */
  _getTaskPromptPreviews() {
    const promptArea = this.overlay?.querySelector('#taskPrompt');
    const text = promptArea?.value?.trim() || '';
    if (!text) return [];
    const prompts = this._multiPromptEnabled
      ? TaskModal._splitMultiPrompt(text)
      : [text];
    return prompts.map(p => p.trim().substring(0, 40).replace(/\n/g, ' '));
  }

  /**
   * Render per-prompt frame pairs dynamically
   */
  _renderTaskPerPromptFrames(promptCount) {
    const container = this.overlay?.querySelector('#taskPerPromptFramesContainer');
    if (!container) return;

    const previews = this._getTaskPromptPreviews();

    // Ensure data array has correct length
    while (this._taskPerPromptFrameData.length < promptCount) {
      this._taskPerPromptFrameData.push({ frame1: '', frame2: '', frame1Thumb: '', frame2Thumb: '' });
    }

    const startIconSvg = '<svg class="frame-slot-icon" viewBox="0 0 11 10" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7.5L8.9 7.5C9.46005 7.5 9.74008 7.5 9.95399 7.39101C10.1422 7.29513 10.2951 7.14215 10.391 6.95399C10.5 6.74008 10.5 6.46005 10.5 5.9V4.1C10.5 3.53995 10.5 3.25992 10.391 3.04601C10.2951 2.85785 10.1422 2.70487 9.95399 2.60899C9.74008 2.5 9.46005 2.5 8.9 2.5L5 2.5M3 7.5H2.1C1.53995 7.5 1.25992 7.5 1.04601 7.39101C0.857847 7.29513 0.704867 7.14215 0.608994 6.95399C0.5 6.74008 0.5 6.46005 0.5 5.9V4.1C0.5 3.53995 0.5 3.25992 0.608994 3.04601C0.704867 2.85785 0.857847 2.70487 1.04601 2.60899C1.25992 2.5 1.53995 2.5 2.1 2.5H3M3 0.5L3 9.5M1.75 9.5L4.25 9.5M1.75 0.499996L4.25 0.5"/></svg>';
    const endIconSvg = '<svg class="frame-slot-icon" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 3.5H2.6C2.03995 3.5 1.75992 3.5 1.54601 3.60899C1.35785 3.70487 1.20487 3.85785 1.10899 4.04601C1 4.25992 1 4.53995 1 5.1V6.9C1 7.46005 1 7.74008 1.10899 7.95399C1.20487 8.14215 1.35785 8.29513 1.54601 8.39101C1.75992 8.5 2.03995 8.5 2.6 8.5H6.5M8.5 3.5H9.4C9.96005 3.5 10.2401 3.5 10.454 3.60899C10.6422 3.70487 10.7951 3.85785 10.891 4.04601C11 4.25992 11 4.53995 11 5.1V6.9C11 7.46005 11 7.74008 10.891 7.95399C10.7951 8.14215 10.6422 8.29513 10.454 8.39101C10.2401 8.5 9.96005 8.5 9.4 8.5H8.5M8.5 10.5L8.5 1.5M9.75 1.5L7.25 1.5M9.75 10.5L7.25 10.5"/></svg>';
    const dropzoneSvg = '<svg class="frame-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>';

    let html = '';
    for (let idx = 0; idx < promptCount; idx++) {
      const data = this._taskPerPromptFrameData[idx];
      const preview = previews[idx] || '';
      html += `
        <div class="per-prompt-frame-pair" data-prompt-index="${idx}">
          <div class="per-prompt-frame-header">
            <span class="per-prompt-frame-index">${idx + 1}</span>
            <span class="per-prompt-frame-prompt-preview" title="${this.escapeAttr(preview)}">${this.escapeAttr(preview)}</span>
          </div>
          <div class="per-prompt-frame-slots">
            <div class="frame-slot" data-prompt-idx="${idx}" data-frame-num="1">
              <div class="frame-slot-header">${startIconSvg}<span class="frame-slot-label">${t('tasks.frameStart')}</span></div>
              <div class="frame-slot-body" id="taskPpFrame_${idx}_1_body">
                ${data.frame1 ? this._buildTaskFrameThumbHtml(idx, 1, data.frame1, data.frame1Thumb) : `<div class="frame-dropzone" data-tpp-pick="${idx}_1">${dropzoneSvg}<span class="frame-dropzone-text">${window.I18n?.t('gen.addFrame') || 'Add'}</span></div>`}
              </div>
            </div>
            <div class="frame-slot" data-prompt-idx="${idx}" data-frame-num="2">
              <div class="frame-slot-header">${endIconSvg}<span class="frame-slot-label">${t('tasks.frameEnd')}</span></div>
              <div class="frame-slot-body" id="taskPpFrame_${idx}_2_body">
                ${data.frame2 ? this._buildTaskFrameThumbHtml(idx, 2, data.frame2, data.frame2Thumb) : `<div class="frame-dropzone" data-tpp-pick="${idx}_2">${dropzoneSvg}<span class="frame-dropzone-text">${window.I18n?.t('gen.addFrame') || 'Add'}</span></div>`}
              </div>
            </div>
          </div>
        </div>`;
    }
    container.innerHTML = html;

    // Event delegation for per-prompt frame clicks
    container.removeEventListener('click', this._taskPerPromptFrameClickHandler);
    this._taskPerPromptFrameClickHandler = (e) => this._handleTaskPerPromptFrameClick(e);
    container.addEventListener('click', this._taskPerPromptFrameClickHandler);
  }

  /**
   * Build thumbnail HTML for per-prompt frame slot
   */
  _buildTaskFrameThumbHtml(promptIdx, frameNum, fileId, thumbnail) {
    const isPending = fileId.startsWith('upload_');
    const isUploading = isPending && window.ImmediateUploader?.isUploading(fileId);
    const thumbSrc = thumbnail || this._taskTileCache?.[fileId]?.thumbnail || window.pendingUploadFiles?.get(fileId)?.thumbnail || '';
    return `
      <div class="frame-thumb-wrap ${isUploading ? 'uploading' : ''}" data-file-id="${this.escapeAttr(fileId)}" data-tpp-pick="${promptIdx}_${frameNum}">
        ${thumbSrc
          ? `<img src="${thumbSrc}" alt="Frame ${frameNum}" />`
          : `<div class="frame-thumb-fallback">${(fileId || '').substring(0, 12)}</div>`
        }
        <div class="ref-thumb-remove" data-tpp-remove="${promptIdx}_${frameNum}" title="${t('tasks.removeTitle')}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
            <line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </div>
      </div>`;
  }

  /**
   * Delegated click handler for task per-prompt frame pairs
   */
  _handleTaskPerPromptFrameClick(e) {
    const removeBtn = e.target.closest('[data-tpp-remove]');
    if (removeBtn) {
      e.stopPropagation();
      const [idx, fnum] = removeBtn.dataset.tppRemove.split('_').map(Number);
      this._setTaskPerPromptFrame(idx, fnum, '', '');
      return;
    }

    const pickEl = e.target.closest('[data-tpp-pick]');
    if (pickEl) {
      const [idx, fnum] = pickEl.dataset.tppPick.split('_').map(Number);
      this._openTaskPerPromptFramePicker(idx, fnum);
    }
  }

  /**
   * Open ImagePickerModal for a task per-prompt frame slot
   */
  _openTaskPerPromptFramePicker(promptIdx, frameNum) {
    if (!window.imagePickerModal) return;
    const data = this._taskPerPromptFrameData[promptIdx];
    if (!data) return;

    const existingId = frameNum === 1 ? data.frame1 : data.frame2;

    window.imagePickerModal.open({
      existingFileIds: existingId ? [existingId] : [],
      singleSelect: true,
      mediaFilter: 'image',
      onConfirm: async (images) => {
        if (images.length > 0) {
          const img = images[0];

          if (img.source === 'upload' && img.file) {
            const key = img.fileId || `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
            window.pendingUploadFiles.set(key, { file: img.file, thumbnail: img.thumbnail });
            if (!this._taskTileCache) this._taskTileCache = {};
            this._taskTileCache[key] = { thumbnail: img.thumbnail, file_name: '' };
            if (window.ImmediateUploader) {
              ImmediateUploader.upload(img.file, img.thumbnail, { key }).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskModal#onConfirm', _e); });
            }
            this._taskPerPromptFrameUploadKeys.set(key, { promptIndex: promptIdx, frameNum });
            this._modalUploadKeys?.add(key);
            img.fileId = key;
          } else if (img.source === 'album' && window.ImagePickerModal?.prepareAlbumImageForRef) {
            // Album image: xử lý qua prepareAlbumImageForRef
            try {
              const prepared = await window.ImagePickerModal.prepareAlbumImageForRef(img);
              if (prepared) {
                const key = prepared.key;
                if (!this._taskTileCache) this._taskTileCache = {};

                // Cache thumbnail
                let thumb = img.thumbnail;
                if (img.thumbnail_url) {
                  thumb = img.thumbnail_url;
                } else if (img.album_image_id && window.ImageStore) {
                  try {
                    const blobUrl = await window.ImageStore.getThumbnail(img.album_image_id);
                    if (blobUrl) thumb = blobUrl;
                  } catch (e) { /* ignore */ }
                }
                this._taskTileCache[key] = { thumbnail: thumb, file_name: prepared.file_name || '' };

                // Upload ngay nếu là STALE image
                if (key.startsWith('upload_')) {
                  const pendingFile = window.pendingUploadFiles?.get(key)?.file;
                  if (pendingFile && window.ImmediateUploader) {
                    ImmediateUploader.upload(pendingFile, img.thumbnail, { key }).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskModal#_setTaskPerPromptFrame', _e); });
                  }
                  this._taskPerPromptFrameUploadKeys.set(key, { promptIndex: promptIdx, frameNum });
                  this._modalUploadKeys?.add(key);
                }

                img.fileId = key;
                img.thumbnail = thumb;
              }
            } catch (err) {
              console.error('[TaskModal] Lỗi chuẩn bị ảnh album cho per-prompt frame:', err);
            }
          } else {
            if (!this._taskTileCache) this._taskTileCache = {};
            if (img.fileId && img.thumbnail) {
              this._taskTileCache[img.fileId] = { thumbnail: img.thumbnail, file_name: img.file_name || '' };
            }
          }

          this._setTaskPerPromptFrame(promptIdx, frameNum, img.fileId, img.thumbnail);
        }
      }
    });
  }

  /**
   * Set per-prompt frame image in task modal
   */
  _setTaskPerPromptFrame(promptIdx, frameNum, fileId, thumbnail) {
    while (this._taskPerPromptFrameData.length <= promptIdx) {
      this._taskPerPromptFrameData.push({ frame1: '', frame2: '', frame1Thumb: '', frame2Thumb: '' });
    }

    const data = this._taskPerPromptFrameData[promptIdx];
    if (frameNum === 1) {
      data.frame1 = fileId || '';
      data.frame1Thumb = thumbnail || '';
    } else {
      data.frame2 = fileId || '';
      data.frame2Thumb = thumbnail || '';
    }

    // Cache thumbnail
    if (fileId && thumbnail) {
      if (!this._taskTileCache) this._taskTileCache = {};
      this._taskTileCache[fileId] = { ...(this._taskTileCache[fileId] || {}), thumbnail };
    }

    // Re-render the specific slot
    const body = this.overlay?.querySelector(`#taskPpFrame_${promptIdx}_${frameNum}_body`);
    if (body) {
      if (fileId) {
        body.innerHTML = this._buildTaskFrameThumbHtml(promptIdx, frameNum, fileId, thumbnail);
      } else {
        const dropzoneSvg = '<svg class="frame-dropzone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"></rect><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>';
        body.innerHTML = `<div class="frame-dropzone" data-tpp-pick="${promptIdx}_${frameNum}">${dropzoneSvg}<span class="frame-dropzone-text">${window.I18n?.t('gen.addFrame') || 'Add'}</span></div>`;
      }
    }
  }

  /**
   * Handle upload:completed for task per-prompt frame uploads
   */
  _handleTaskPerPromptFrameUploadCompleted(data) {
    if (!data?.key || !data?.tile_id) return;
    if (!this._taskPerPromptFrameUploadKeys.has(data.key)) return;

    const { promptIndex, frameNum } = this._taskPerPromptFrameUploadKeys.get(data.key);
    this._taskPerPromptFrameUploadKeys.delete(data.key);

    const frameData = this._taskPerPromptFrameData[promptIndex];
    if (!frameData) return;

    const prop = frameNum === 1 ? 'frame1' : 'frame2';
    const thumbProp = frameNum === 1 ? 'frame1Thumb' : 'frame2Thumb';

    if (frameData[prop] === data.key) {
      frameData[prop] = data.tile_id;
    }

    // Transfer caches
    if (!this._taskTileCache) this._taskTileCache = {};
    if (this._taskTileCache[data.key]) {
      this._taskTileCache[data.tile_id] = this._taskTileCache[data.key];
      delete this._taskTileCache[data.key];
    }
    if (data.thumbnail_url) {
      this._taskTileCache[data.tile_id] = { ...(this._taskTileCache[data.tile_id] || {}), thumbnail: data.thumbnail_url };
      frameData[thumbProp] = data.thumbnail_url;
    }
    if (data.file_name) {
      this._taskTileCache[data.tile_id] = { ...(this._taskTileCache[data.tile_id] || {}), file_name: data.file_name };
    }

    // Cleanup
    window.pendingUploadFiles?.delete(data.key);
    if (window.ImmediateUploader) ImmediateUploader.clearResult?.(data.key);

    // Re-render
    const thumb = this._taskTileCache[data.tile_id]?.thumbnail || data.thumbnail_url || '';
    this._setTaskPerPromptFrame(promptIndex, frameNum, data.tile_id, thumb);
  }

  /**
   * Handle upload:failed for task per-prompt frame uploads
   */
  _handleTaskPerPromptFrameUploadFailed(data) {
    if (!data?.key) return;
    if (!this._taskPerPromptFrameUploadKeys.has(data.key)) return;

    const { promptIndex, frameNum } = this._taskPerPromptFrameUploadKeys.get(data.key);
    this._taskPerPromptFrameUploadKeys.delete(data.key);

    const frameData = this._taskPerPromptFrameData[promptIndex];
    if (frameData) {
      const prop = frameNum === 1 ? 'frame1' : 'frame2';
      const thumbProp = frameNum === 1 ? 'frame1Thumb' : 'frame2Thumb';
      this._setTaskPerPromptFrame(promptIndex, frameNum, frameData[prop], frameData[thumbProp]);
    }
  }

  /**
   * Build frame_pairs array for saving (multi-prompt Video+Frames)
   * Returns array of { frame1, frame2, frame1Thumb, frame2Thumb, frame1FileName, frame2FileName } or null
   */
  _buildFramePairsForSave(mediaType, videoInputType, isMultiPrompt, prompts) {
    const isVideoFrames = mediaType === 'Video' && videoInputType === 'Frames';
    if (!isVideoFrames || !isMultiPrompt || !prompts || prompts.length <= 1) return null;
    if (this._taskPerPromptFrameData.length === 0) return null;

    const pairs = [];
    for (let i = 0; i < prompts.length; i++) {
      const data = this._taskPerPromptFrameData[i] || { frame1: '', frame2: '', frame1Thumb: '', frame2Thumb: '' };
      const getInfo = (fid) => {
        if (!fid) return { thumbnail: '', file_name: '' };
        const cached = this._taskTileCache?.[fid];
        return {
          thumbnail: data[fid === data.frame1 ? 'frame1Thumb' : 'frame2Thumb'] || cached?.thumbnail || '',
          file_name: cached?.file_name || ''
        };
      };
      const f1Info = getInfo(data.frame1);
      const f2Info = getInfo(data.frame2);
      pairs.push({
        frame1: data.frame1 || '',
        frame2: data.frame2 || '',
        frame1Thumb: f1Info.thumbnail,
        frame2Thumb: f2Info.thumbnail,
        frame1FileName: f1Info.file_name,
        frame2FileName: f2Info.file_name
      });
    }
    return pairs;
  }

  async handleImagePickerConfirm(images) {
    const fileIdsInput = this.overlay?.querySelector('#taskFileIds');
    if (!fileIdsInput) return;

    const existingIds = fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);

    // Tách ảnh Flow (đã có tile ID) và ảnh upload (cache file, chờ run mới upload)
    const flowImages = images.filter(img => img.source === 'flow' || img.source === 'existing');
    const uploadImages = images.filter(img => img.source === 'upload' && img.file);

    const newIds = flowImages.map(img => img.fileId).filter(Boolean);

    // Cache thumbnail cho Flow images (giống GenTab pattern)
    if (!this._taskTileCache) this._taskTileCache = {};
    for (const img of flowImages) {
      if (!img.fileId) continue;
      if (img.thumbnail || img.video_url) {
        this._taskTileCache[img.fileId] = {
          thumbnail: img.thumbnail || '',
          file_name: img.file_name || '',
          type: img.type || 'image',
          ...(img.video_url && { video_url: img.video_url }),
        };
      }
    }

    // Xử lý ảnh album (ALIVE/STALE)
    const albumImages = images.filter(img => img.source === 'album');
    if (albumImages.length > 0) {
      for (const img of albumImages) {
        try {
          const prepared = await ImagePickerModal.prepareAlbumImageForRef(img);
          if (!prepared) continue;
          const key = prepared.key;
          // Cache thumbnail vào _taskTileCache
          this._taskTileCache[key] = {
            thumbnail: img.thumbnail,
            file_name: prepared.file_name || '',
            type: img.type || 'image'
          };
          // Giữ tên đã lưu từ album (không ghi đè bằng default img_{})
          if (img.name) {
            this._refImageNames[key] = img.name;
          }
          newIds.push(key);
          // STALE: fire ImmediateUploader
          if (key.startsWith('upload_')) {
            const pendingFile = window.pendingUploadFiles?.get(key)?.file;
            if (pendingFile && window.ImmediateUploader) {
              ImmediateUploader.upload(pendingFile, img.thumbnail, { key }).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskModal#handleImagePickerConfirm', _e); });
            }
            this._modalUploadKeys?.add(key);
          }
        } catch (err) {
          console.error('[TaskModal] Lỗi chuẩn bị ảnh album:', err);
        }
      }
    }

    // Cache ảnh upload local - set memory TRƯỚC (sync), persist IndexedDB sau (async)
    if (uploadImages.length > 0) {
      if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
      for (const img of uploadImages) {
        const key = img.fileId || `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        // Set memory ngay để _renderTaskRefPreview có thể đọc thumbnail
        window.pendingUploadFiles.set(key, { file: img.file, thumbnail: img.thumbnail });
        // Cache thumbnail vào _taskTileCache (persistent qua upload lifecycle)
        this._taskTileCache[key] = { thumbnail: img.thumbnail, file_name: '', type: img.type || 'image' };
        // S2: Upload ngay nếu Flow tab mở, hoặc lưu lightweight pending
        if (window.ImmediateUploader) {
          ImmediateUploader.upload(img.file, img.thumbnail, { key }).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskModal#handleImagePickerConfirm', _e); });
        } else if (window.PendingUploadStore) {
          PendingUploadStore.saveLightweight(key, { thumbnail: img.thumbnail, fileName: img.file.name, fileSize: img.file.size, fileType: img.file.type });
        }
        newIds.push(key);
        this._modalUploadKeys?.add(key);
      }
    }

    const mergedIds = [...new Set([...existingIds, ...newIds])];
    fileIdsInput.value = mergedIds.join(', ');

    // Auto-assign default names cho ảnh mới chưa có tên (mention mode)
    for (let i = 0; i < newIds.length; i++) {
      const id = newIds[i];
      if (!this._refImageNames[id] && !this.task?.ref_image_names?.[id]) {
        const idx = mergedIds.indexOf(id) + 1;
        this._refImageNames[id] = `img_${idx}`;
      }
    }

    this._renderTaskRefPreview();
    this._refreshMentionHelper();
    this._updateDragHint();
    this._updateButtonState();
  }

  /**
   * Xử lý file drop trực tiếp lên select_ref_img button (đồng bộ pattern GenTab._handleDroppedFiles).
   *
   * KHÁC GenTab: TaskModal KHÔNG lazy upload — gọi ImmediateUploader.upload() ngay
   * giống handleImagePickerConfirm path. Lý do: TaskModal cần tile_id thật trước khi run task,
   * không như GenTab cho phép lazy upload tới lúc submit.
   *
   * @param {File[]} files - Array of image File objects
   */
  async _handleDroppedFiles(files) {
    const fileIdsInput = this.overlay?.querySelector('#taskFileIds');
    if (!fileIdsInput) return;
    if (!window.pendingUploadFiles) window.pendingUploadFiles = new Map();
    if (!this._taskTileCache) this._taskTileCache = {};

    const existingIds = fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const newIds = [];

    for (const file of files) {
      const key = `upload_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

      // Generate thumbnail từ file blob (data URL — đồng bộ GenTab pattern)
      const thumbnail = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve('');
        reader.readAsDataURL(file);
      });

      // Cache memory + thumbnail (sync để _renderTaskRefPreview đọc ngay)
      window.pendingUploadFiles.set(key, { file, thumbnail, name: file.name });
      this._taskTileCache[key] = { thumbnail, file_name: '' };

      // Upload NGAY (không lazy) — đồng bộ logic immediate upload TaskModal
      if (window.ImmediateUploader) {
        ImmediateUploader.upload(file, thumbnail, { key }).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskModal#onerror', _e); });
      } else if (window.PendingUploadStore) {
        PendingUploadStore.saveLightweight(key, {
          thumbnail,
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
        });
      }

      newIds.push(key);
      this._modalUploadKeys?.add(key);
    }

    const mergedIds = [...new Set([...existingIds, ...newIds])];
    fileIdsInput.value = mergedIds.join(', ');

    // Auto-assign default name (mention mode) — đồng bộ handleImagePickerConfirm
    for (const id of newIds) {
      if (!this._refImageNames[id]) {
        const idx = mergedIds.indexOf(id) + 1;
        this._refImageNames[id] = `img_${idx}`;
      }
    }

    this._renderTaskRefPreview();
    this._refreshMentionHelper();
    this._updateDragHint();
    this._updateButtonState();
  }

  /**
   * S2.5: Sync upload_xxx key → real tile_id sau khi ImmediateUploader upload xong
   * @param {Object} data - {key, tile_id, file_name, thumbnail_url}
   */
  _syncUploadKeyToTileId(data) {
    const { key, tile_id, file_name, thumbnail_url } = data;
    const fileIdsInput = this.overlay?.querySelector('#taskFileIds');
    if (fileIdsInput) {
      const ids = fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
      const idx = ids.indexOf(key);
      if (idx !== -1) {
        ids[idx] = tile_id;
        fileIdsInput.value = ids.join(', ');
      }
    }
    // Remove from tracking
    this._modalUploadKeys.delete(key);
    // Transfer thumbnail cache: upload_key → tile_id (giống GenTab pattern)
    if (!this._taskTileCache) this._taskTileCache = {};
    if (this._taskTileCache[key]) {
      this._taskTileCache[tile_id] = this._taskTileCache[key];
      delete this._taskTileCache[key];
    }
    // Override bằng thumbnail_url từ Flow nếu có (chính xác hơn data URL)
    if (thumbnail_url) {
      this._taskTileCache[tile_id] = { thumbnail: thumbnail_url, file_name: file_name || '' };
    }
    // Đảm bảo file_name được cập nhật
    if (file_name && this._taskTileCache[tile_id]) {
      this._taskTileCache[tile_id].file_name = file_name;
    }
    // Cleanup pendingUploadFiles
    window.pendingUploadFiles?.delete(key);
    // Cleanup ImmediateUploader results (tránh memory leak)
    if (window.ImmediateUploader) {
      ImmediateUploader._results.delete(key);
      ImmediateUploader._fileRefs.delete(key);
    }
    // Cache trong TileCache
    if (window.TileCache) {
      if (file_name) window.TileCache.set(file_name, tile_id);
      if (thumbnail_url) window.TileCache.set(thumbnail_url, tile_id);
    }
    // Fix A: Ghi vào MediaRegistry (giống GenTab._syncUploadKeyToTileId line 3370-3383)
    // ImmediateUploader không tự ghi MediaRegistry → Task save+run dùng task.ref_file_names
    // (truyền vào content.js fileNameMap) bị thiếu entry → addFileToPrompt fallback by
    // file_name fail khi tile_id thay đổi/cross-project → ref local upload không attach.
    if (window.MediaRegistry) {
      if (thumbnail_url) MediaRegistry.setThumb(tile_id, thumbnail_url);
      if (file_name) MediaRegistry.setFileName(tile_id, file_name);
      MediaRegistry.deleteThumb?.(key);
      MediaRegistry.deleteFileName?.(key);
    }
    // Transfer ref image name from upload key to tile_id
    if (this._refImageNames[key]) {
      this._refImageNames[tile_id] = this._refImageNames[key];
      delete this._refImageNames[key];
    }
    // Sync frame file ID inputs nếu upload key match
    for (const fNum of [1, 2]) {
      const frameInput = this.overlay?.querySelector(`#taskFrame${fNum}FileId`);
      if (frameInput && frameInput.value === key) {
        frameInput.value = tile_id;
        // Re-render frame preview với tile_id mới (xóa loading)
        const thumb = thumbnail_url || this._taskTileCache?.[tile_id]?.thumbnail || '';
        this._setTaskFrameImage(fNum, tile_id, thumb);
      }
    }

    // Re-render preview
    this._renderTaskRefPreview();
    // Recapture snapshot — upload ID thay đổi tự động, không phải user change
    this._formSnapshot = this._captureFormSnapshot();
    console.log(`[TaskModal] Synced upload key → tile_id: ${key.substring(0, 15)}... → ${tile_id.substring(0, 15)}...`);
  }

  /**
   * UI 2026-05-27: ẩn option "Frames" trong #taskVideoInputType nếu video model hiện tại
   * set config.supports_frames=false. Ép về 'Ingredients' nếu đang chọn Frames.
   * Đồng bộ với GenTab._applyFramesSupport + WorkflowEditor node settings.
   */
  _applyTaskFramesSupport() {
    const sel = this.overlay?.querySelector('#taskVideoInputType');
    if (!sel) return;
    const flowAdapter = window.ProviderRegistry?.get?.('flow');
    const modelValue = this.overlay?.querySelector('#taskVideoModel')?.value || '';
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
   * Flow Voice Selector — show/hide voice picker theo provider=flow + Video + model.config.supports_voice.
   * Init picker lazy khi support voice. Reset value khi switch sang model không support.
   */
  _applyTaskVoicePickerVisibility() {
    const group = this.overlay?.querySelector('#taskVoicePickerGroup');
    if (!group) return;

    const provider = this.overlay?.querySelector('#taskProvider')?.value || 'flow';
    const mediaType = this.overlay?.querySelector('#taskMediaType')?.value || 'Image';
    if (provider !== 'flow' || mediaType !== 'Video') {
      group.classList.add('hidden');
      return;
    }

    const modelValue = this.overlay?.querySelector('#taskVideoModel')?.value || '';
    const modelObj = window.ModelRegistry?.findModel?.('flow', modelValue);
    const supportsVoice = !!(modelObj?.config?.supports_voice === true);

    if (supportsVoice) {
      group.classList.remove('hidden');
      this._initTaskVoicePickerIfNeeded();
    } else {
      group.classList.add('hidden');
      const slugInput = this.overlay?.querySelector('#taskVoiceSlug');
      const searchInput = this.overlay?.querySelector('#taskVoiceSearchValue');
      if (slugInput?.value || searchInput?.value) {
        if (slugInput) slugInput.value = '';
        if (searchInput) searchInput.value = '';
        if (this._taskVoicePicker) this._taskVoicePicker._updateTrigger();
      }
    }
  }

  _initTaskVoicePickerIfNeeded() {
    if (this._taskVoicePicker || !window.VoicePicker) return;

    const triggerEl = this.overlay?.querySelector('#taskVoiceTrigger');
    if (!triggerEl) return;

    this._taskVoicePicker = new window.VoicePicker({
      triggerEl,
      thumbEl: this.overlay?.querySelector('#taskVoiceTriggerThumb'),
      labelEl: this.overlay?.querySelector('#taskVoiceLabel'),
      hiddenSelectEl: this.overlay?.querySelector('#taskVoiceSlug'),
      providerSlug: 'flow',
      getSelected: () => this.overlay?.querySelector('#taskVoiceSlug')?.value || '',
      onChange: (slug, voiceObj) => {
        const slugInput = this.overlay?.querySelector('#taskVoiceSlug');
        const searchInput = this.overlay?.querySelector('#taskVoiceSearchValue');
        if (slugInput) slugInput.value = slug || '';
        if (searchInput) searchInput.value = voiceObj?.search_value || '';
      },
    });
    this._taskVoicePicker.init();
  }

  /** Flow Character — show/hide theo provider=flow + supports_character (cả image+video). */
  _applyTaskCharacterPickerVisibility() {
    const group = this.overlay?.querySelector('#taskCharacterPickerGroup');
    if (!group) return;

    const provider = this.overlay?.querySelector('#taskProvider')?.value || 'flow';
    if (provider !== 'flow') {
      group.classList.add('hidden');
      return;
    }

    const mediaType = this.overlay?.querySelector('#taskMediaType')?.value || 'Image';
    const modelValue = mediaType === 'Video'
      ? (this.overlay?.querySelector('#taskVideoModel')?.value || '')
      : (this.overlay?.querySelector('#taskModel')?.value || '');
    const modelObj = window.ModelRegistry?.findModel?.('flow', modelValue);
    const supportsChar = !!(modelObj?.config?.supports_character === true);

    if (supportsChar) {
      group.classList.remove('hidden');
      this._initTaskCharacterPickerIfNeeded();
    } else {
      group.classList.add('hidden');
      const slugInput = this.overlay?.querySelector('#taskCharacterSlug');
      const searchInput = this.overlay?.querySelector('#taskCharacterSearchValue');
      if (slugInput?.value || searchInput?.value) {
        if (slugInput) slugInput.value = '';
        if (searchInput) searchInput.value = '';
        if (this._taskCharacterPicker) this._taskCharacterPicker._updateTrigger();
      }
    }
  }

  _initTaskCharacterPickerIfNeeded() {
    if (this._taskCharacterPicker || !window.CharacterPicker) return;

    const triggerEl = this.overlay?.querySelector('#taskCharacterTrigger');
    if (!triggerEl) return;

    this._taskCharacterPicker = new window.CharacterPicker({
      triggerEl,
      thumbEl: this.overlay?.querySelector('#taskCharacterTriggerThumb'),
      labelEl: this.overlay?.querySelector('#taskCharacterLabel'),
      hiddenSelectEl: this.overlay?.querySelector('#taskCharacterSlug'),
      getSelected: () => this.overlay?.querySelector('#taskCharacterSlug')?.value || '',
      onChange: (slug, charObj) => {
        const slugInput = this.overlay?.querySelector('#taskCharacterSlug');
        const searchInput = this.overlay?.querySelector('#taskCharacterSearchValue');
        if (slugInput) slugInput.value = slug || '';
        if (searchInput) searchInput.value = charObj?.search_value || '';
      },
    });
    this._taskCharacterPicker.init();
  }

  _renderTaskRefPreview() {
    const fileIdsInput = this.overlay?.querySelector('#taskFileIds');
    const previewEl = this.overlay?.querySelector('#taskRefImagesPreview');
    if (!fileIdsInput || !previewEl) return;

    const ids = fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);

    if (ids.length === 0) {
      previewEl.innerHTML = '';
      return;
    }

    // Get saved ref_file_names from task for cross-project validation
    const savedFileNames = this.task?.ref_file_names || {};
    const savedThumbs = this.task?.ref_thumbnails || {};

    // Check if we need remote scan for cross-project validation
    const needsRemoteScan = ids.some(id => {
      if (id.startsWith('upload_')) return false;
      const cached = this._taskTileCache?.[id];
      // Need remote if: no cache, or cache has no file_name, or task has no ref_file_names (old task)
      if (!cached || !cached.file_name || Object.keys(savedFileNames).length === 0) return true;
      return false;
    });

    if (needsRemoteScan && typeof MessageBridge !== 'undefined') {
      if (!this._taskTileCache) this._taskTileCache = {};
      const remoteIds = ids.filter(id => !id.startsWith('upload_'));

      // Render ngay với cache hiện tại (tránh gradient sweep kẹt khi chờ MessageBridge)
      this._renderTaskRefPreviewInner(ids, fileIdsInput, previewEl);

      // Save OLD cache state BEFORE MessageBridge updates it (for cross-project comparison)
      const oldCacheState = {};
      for (const id of remoteIds) {
        if (savedFileNames[id] || savedThumbs[id]) {
          oldCacheState[id] = { file_name: savedFileNames[id], thumbnail: savedThumbs[id] };
        }
      }

      MessageBridge.getThumbnailsByIds(remoteIds).then(result => {
        const results = result?.results || {};
        const crossProjectIds = [];

        const hasBaseline = Object.keys(savedFileNames).length > 0;
        for (const [fid, info] of Object.entries(results)) {
          const oldState = oldCacheState[fid];
          // Cross-project detection: CHỈ dùng file_name (UUID, persistent)
          // KHÔNG dùng thumbnail URL (khác params giữa upload result vs DOM → false positive)
          // CHỈ check khi có baseline (savedFileNames từ lần save trước)
          if (oldState && info && hasBaseline) {
            const oldFileName = oldState.file_name;
            const newFileName = info.file_name;

            if (oldFileName && newFileName && oldFileName !== newFileName) {
              crossProjectIds.push(fid);
            }
          }
          // Update cache with new data + cross-project flag
          this._taskTileCache[fid] = {
            thumbnail: info?.thumbnail || '',
            file_name: info?.file_name || '',
            _crossProject: crossProjectIds.includes(fid)
          };
        }

        this._crossProjectRefIds = crossProjectIds;
        this._renderTaskRefPreviewInner(ids, fileIdsInput, previewEl);
      }).catch(() => {
        this._renderTaskRefPreviewInner(ids, fileIdsInput, previewEl);
      });
      return;
    }

    this._renderTaskRefPreviewInner(ids, fileIdsInput, previewEl);
  }

  _getTaskRefLimit() {
    const refMode = this.overlay?.querySelector('#taskRefImageMode')?.value || 'all';
    // Mention: user @ ref vào prompt manually → không cap
    if (refMode === 'mention') return Infinity;

    const mediaType = this.overlay?.querySelector('#taskMediaType')?.value || 'Image';
    const videoInputType = this.overlay?.querySelector('#taskVideoInputType')?.value || 'Frames';
    const isVideo = mediaType === 'Video';
    const isFrames = isVideo && videoInputType === 'Frames';

    // Post-audit fix: resolve theo task.provider (Flow=10/3, ChatGPT=4, Grok=4 per-mode).
    // Trước fix: hardcode GenTab.REF_LIMIT_* (Flow constants) → ChatGPT/Grok task không grayscale.
    // 2026-05-22: pass modelValue để detect supports_ref_images=false (vd Veo Quality + Ingredients).
    const provider = (this.task?.provider || this.overlay?.querySelector('#taskProvider')?.value || 'flow').toLowerCase();
    const grokMode = (this.task?.grok_mode || mediaType).toLowerCase();
    const resolvedMode = provider === 'grok' ? grokMode : (isVideo ? 'video' : 'image');
    const modelValue = this.task?.model
      || this.overlay?.querySelector('#taskVideoModel')?.value
      || this.overlay?.querySelector('#taskImageModel')?.value
      || '';
    const taskDuration = this.task?.video_duration
      || this.overlay?.querySelector('#taskVideoDuration')?.value
      || undefined;
    const resolved = (typeof ImagePickerModal !== 'undefined' && ImagePickerModal.resolveMaxSelections)
      ? ImagePickerModal.resolveMaxSelections({ provider, mode: resolvedMode, isFrames, modelValue, duration: taskDuration })
      : null;
    // 0 = model không hỗ trợ ref → block (return 0, KHÔNG fallback).
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

    // Multi + sequential: 1 ảnh / prompt → limit = N_prompts (đồng bộ với GenTab)
    const isMulti = !!this.overlay?.querySelector('#taskMultiPromptCheck')?.checked;
    if (isMulti && refMode === 'sequential') {
      return this._countTaskPrompts();
    }
    return perPromptPolicy;
  }

  /**
   * Đếm số prompts trong textarea task — split bằng dòng trống (đồng bộ với GenTab._countPrompts).
   */
  _countTaskPrompts() {
    const txt = this.overlay?.querySelector('#taskPrompt')?.value || '';
    if (!txt.trim()) return 1;
    const blocks = TaskModal._splitMultiPrompt(txt);
    return Math.max(1, blocks.length);
  }

  _renderTaskRefPreviewInner(ids, fileIdsInput, previewEl) {
    const missingIds = [];
    const crossProjectIds = this._crossProjectRefIds || [];
    const refMode = this.overlay?.querySelector('#taskRefImageMode')?.value || 'all';
    const isMentionMode = refMode === 'mention';
    const refLimit = this._getTaskRefLimit();

    previewEl.innerHTML = ids.map((id, idx) => {
      let thumbSrc = '';
      let cachedType = '';
      let cachedVideoUrl = '';
      const isPending = id.startsWith('upload_');
      const isCrossProject = crossProjectIds.includes(id);

      const pending = window.pendingUploadFiles?.get(id);
      if (pending?.thumbnail) {
        thumbSrc = pending.thumbnail;
      } else if (this._taskTileCache?.[id]) {
        // Cache now stores object {thumbnail, file_name, type, video_url, _crossProject}
        const cached = this._taskTileCache[id];
        if (typeof cached === 'string') {
          thumbSrc = cached;
        } else {
          thumbSrc = cached.thumbnail || '';
          cachedType = cached.type || '';
          cachedVideoUrl = cached.video_url || '';
        }
      } else {
        // Fallback to saved thumbnails from task — object {thumbnail, type, video_url} hoặc string
        const savedThumbs = this.task?.ref_thumbnails || {};
        if (savedThumbs[id]) {
          const sv = savedThumbs[id];
          if (typeof sv === 'string') {
            thumbSrc = sv;
          } else {
            thumbSrc = sv.thumbnail || '';
            cachedType = sv.type || '';
            cachedVideoUrl = sv.video_url || '';
          }
        }
      }

      if (!thumbSrc && !cachedVideoUrl && !isPending) missingIds.push(id);

      // S2.5: Check upload trạng thái
      const isUploading = isPending && window.ImmediateUploader?.isUploading(id);
      const isExceeded = idx >= refLimit;

      // Build CSS classes for thumb
      const thumbClasses = ['ref-thumb'];
      if (isPending) thumbClasses.push('ref-thumb-pending');
      if (isUploading) thumbClasses.push('ref-thumb-uploading');
      if (isCrossProject) thumbClasses.push('ref-thumb-cross-project');
      if (isExceeded) thumbClasses.push('ref-thumb-exceeded');

      // Cross-project: show warning icon + sweep animation (CSS hides img)
      const crossProjectIcon = isCrossProject ? `
        <svg class="cross-project-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
          <line x1="12" y1="9" x2="12" y2="13"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>` : '';

      const exceededTitle = isExceeded ? ` title="${t('tasks.refExceeded', { max: refLimit })}"` : '';
      // Video tile → <video preload=metadata>, Flow URL trả mp4 bytes nên <img> ko render được.
      const isVideoTile = cachedType === 'video';
      const mediaHtml = (isVideoTile && cachedVideoUrl)
        ? `<video src="${cachedVideoUrl}" class="ref-video-preview" muted playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block;background:#0c1320;"></video>`
        : (thumbSrc ? `<img src="${thumbSrc}" alt="ref" />` : `<span>${id.substring(0, 12)}</span>`);
      const thumbHtml = `
        <div class="${thumbClasses.join(' ')}" data-ref-id="${this.escapeAttr(id)}"${exceededTitle}>
          <div class="ref-thumb-inner">
            ${mediaHtml}
            ${crossProjectIcon}
            ${isPending ? '<div class="ref-thumb-badge">Local</div>' : ''}
            ${isCrossProject ? `<div class="ref-thumb-badge ref-thumb-badge-warning">${t('tasks.wrongProject')}</div>` : ''}
          </div>
          <div class="ref-thumb-remove" title="${t('common.delete')}">×</div>
        </div>`;

      // Mention mode: wrap in .ref-item with name label
      if (isMentionMode) {
        let name = this._refImageNames[id] || this.task?.ref_image_names?.[id] || '';
        if (!name) {
          name = `img_${idx + 1}`;
          // Persist fallback name so click handler and save() can find it
          this._refImageNames[id] = name;
        }
        return `
          <div class="ref-item" data-ref-id="${this.escapeAttr(id)}" draggable="true">
            <div class="ref-item-drag-handle" title="${t('tasks.dragHandle')}">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="4" r="2"/><circle cx="16" cy="4" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="20" r="2"/><circle cx="16" cy="20" r="2"/></svg>
            </div>
            ${thumbHtml}
            <div class="ref-item-name" data-ref-id="${this.escapeAttr(id)}" title="${t('tasks.clickToRename')}">@${this.escapeHtml(name)}</div>
          </div>`;
      }

      return thumbHtml;
    }).join('');

    // Seek video preview về first frame (0.1s) → show static frame thay vì black
    previewEl.querySelectorAll('.ref-video-preview').forEach(video => {
      if (video._loadBound) return;
      video._loadBound = true;
      video.addEventListener('loadedmetadata', () => { try { video.currentTime = 0.1; } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#_renderTaskRefPreviewInner', _); } }, { once: true });
    });

    // Reactive video detect: <img> load fail = URL là video tile (Flow URL trả mp4 bytes) →
    // swap sang <video> + heal cache để render sau dùng <video> trực tiếp.
    previewEl.querySelectorAll('.ref-thumb img').forEach(img => {
      if (img._errBound) return;
      img._errBound = true;
      img.addEventListener('error', () => {
        const refThumb = img.closest('[data-ref-id]');
        const tileId = refThumb?.dataset.refId;
        const url = img.src;
        if (!tileId || !url) return;
        const video = document.createElement('video');
        video.src = url;
        video.muted = true; video.playsInline = true; video.preload = 'metadata';
        video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;background:#0c1320;';
        video.addEventListener('loadedmetadata', () => { try { video.currentTime = 0.1; } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#_renderTaskRefPreviewInner', _); } }, { once: true });
        img.parentNode?.replaceChild(video, img);
        if (!this._taskTileCache) this._taskTileCache = {};
        const existing = this._taskTileCache[tileId];
        const base = (existing && typeof existing === 'object') ? existing : { thumbnail: typeof existing === 'string' ? existing : '' };
        this._taskTileCache[tileId] = { ...base, type: 'video', video_url: url };
      }, { once: true });
    });

    // Warn user about cross-project collision (only once per modal open)
    if (crossProjectIds.length > 0 && !this._crossProjectWarned) {
      this._crossProjectWarned = true;
      window.customDialog?.alert(
        t('tasks.crossProjectMsg', { count: crossProjectIds.length }),
        { title: t('tasks.crossProjectTitle'), type: 'warning' }
      );
    }

    // Inform user about missing ref images — sẽ tự reupload khi chạy (only once per modal open)
    if (missingIds.length > 0 && !this._missingRefWarned) {
      this._missingRefWarned = true;
      window.customDialog?.alert(
        t('tasks.missingRefMsg', { count: missingIds.length }),
        { title: t('tasks.missingRefTitle'), type: 'info' }
      );
    }

    // Bind remove buttons
    previewEl.querySelectorAll('.ref-thumb-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const thumb = btn.closest('.ref-thumb');
        const removeId = thumb?.dataset.refId || btn.closest('.ref-item')?.dataset.refId;
        if (removeId && fileIdsInput) {
          const currentIds = fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
          fileIdsInput.value = currentIds.filter(id => id !== removeId).join(', ');
          if (removeId.startsWith('upload_')) {
            if (window.ImmediateUploader) ImmediateUploader.cancel(removeId);
            else window.pendingUploadFiles?.delete(removeId);
            this._modalUploadKeys?.delete(removeId);
          }
          delete this._refImageNames[removeId];
          this._renderTaskRefPreview();
          this._refreshMentionHelper();
          this._updateDragHint();
        }
      });
    });

    // Mention mode: bind name editing on click
    if (isMentionMode) {
      previewEl.querySelectorAll('.ref-item-name').forEach(nameEl => {
        nameEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const fileId = nameEl.dataset.refId;
          // Get name from _refImageNames (populated during render), fallback to DOM text
          const domName = nameEl.textContent?.replace(/^@/, '').trim() || '';
          const currentName = this._refImageNames[fileId] || this.task?.ref_image_names?.[fileId] || domName;
          this._editRefImageName(fileId, currentName);
        });
      });
      // Also click on thumbnail in mention mode opens name edit
      previewEl.querySelectorAll('.ref-item .ref-thumb').forEach(thumbEl => {
        thumbEl.addEventListener('click', (e) => {
          if (e.target.closest('.ref-thumb-remove')) return;
          e.stopPropagation();
          const fileId = thumbEl.dataset.refId;
          const nameEl = thumbEl.closest('.ref-item')?.querySelector('.ref-item-name');
          const domName = nameEl?.textContent?.replace(/^@/, '').trim() || '';
          const currentName = this._refImageNames[fileId] || this.task?.ref_image_names?.[fileId] || domName;
          this._editRefImageName(fileId, currentName);
        });
      });
    }

    // Enable drag-drop reorder
    this._enableRefDragDrop();
    this._updateDragHint();

    // Update prompt count to reflect ref image changes
    this._updatePromptCount();
  }

  // ========== Multi-Prompt Count ==========

  _updatePromptCount() {
    const countEl = this.overlay?.querySelector('#taskPromptCount');
    const promptArea = this.overlay?.querySelector('#taskPrompt');
    if (!countEl || !promptArea) return;

    const text = promptArea.value.trim();
    if (!text) {
      countEl.textContent = '0';
      countEl.classList.remove('prompt-count-warning');
      return;
    }

    const quantity = parseInt(this.overlay?.querySelector('#taskQuantity')?.value) || 1;
    const refFileIds = (this.overlay?.querySelector('#taskFileIds')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const refCount = refFileIds.length;
    const refMode = this.overlay?.querySelector('#taskRefImageMode')?.value || 'all';
    const refLimit = this._getTaskRefLimit();
    const isRefExceeded = refCount > refLimit;

    if (this._multiPromptEnabled) {
      const promptCount = TaskModal._splitMultiPrompt(text).length;
      const totalImages = promptCount * quantity;

      // Check mismatch khi sequential mode: cần prompt count = ref count
      const isSequential = refMode === 'sequential';
      const hasMismatch = isSequential && refCount > 0 && promptCount !== refCount;

      if (hasMismatch) {
        // Show warning with red text
        const promptClass = promptCount < refCount ? 'prompt-count-short' : '';
        const refClass = refCount < promptCount ? 'prompt-count-short' : '';
        countEl.innerHTML = `<span class="${promptClass}"><span class="gen-count-num">${promptCount}</span> prompt</span> | <span class="${refClass}"><span class="gen-count-num">${refCount}</span> ${t('gen.refLabel')}</span> → <span class="gen-count-num">${totalImages}</span> ${t('gen.imageUnit')}`;
        countEl.classList.add('prompt-count-warning');
      } else if (isRefExceeded) {
        countEl.innerHTML = `<span class="gen-count-num">${promptCount}</span> prompt | <span class="gen-count-num">${refCount}</span> ${t('gen.refLabel')} (${t('gen.maxLabel')} ${refLimit}) → <span class="gen-count-num">${totalImages}</span> ${t('gen.imageUnit')}`;
        countEl.classList.add('ref-count-exceeded');
        countEl.classList.remove('prompt-count-warning');
      } else {
        countEl.innerHTML = refCount > 0
          ? `<span class="gen-count-num">${promptCount}</span> prompt | <span class="gen-count-num">${refCount}</span> ${t('gen.refLabel')} → <span class="gen-count-num">${totalImages}</span> ${t('gen.imageUnit')}`
          : `<span class="gen-count-num">${promptCount}</span> prompt → <span class="gen-count-num">${totalImages}</span> ${t('gen.imageUnit')}`;
        countEl.classList.remove('prompt-count-warning');
        countEl.classList.remove('ref-count-exceeded');
      }
    } else {
      if (isRefExceeded) {
        countEl.innerHTML = `<span class="gen-count-num">${refCount}</span> ${t('gen.refLabel')} (${t('gen.maxLabel')} ${refLimit}) → <span class="gen-count-num">${quantity}</span> ${t('gen.imageUnit')}`;
        countEl.classList.add('ref-count-exceeded');
      } else {
        countEl.innerHTML = refCount > 0
          ? `<span class="gen-count-num">${refCount}</span> ${t('gen.refLabel')} → <span class="gen-count-num">${quantity}</span> ${t('gen.imageUnit')}`
          : `<span class="gen-count-num">${quantity}</span> ${t('gen.imageUnit')}`;
        countEl.classList.remove('ref-count-exceeded');
      }
      countEl.classList.remove('prompt-count-warning');
    }
  }

  // ========== Ref Image Name Editing ==========

  _editRefImageName(fileId, currentName) {
    const thumbEl = this.overlay?.querySelector(`.ref-thumb[data-ref-id="${fileId}"]`);
    if (!thumbEl) return;

    // Remove any existing popup (search in both overlay and body)
    document.querySelectorAll('.ref-image-name-popup, .ref-image-name-popup-backdrop').forEach(el => el.remove());

    const rect = thumbEl.getBoundingClientRect();
    const overlayRect = this.overlay.getBoundingClientRect();

    // Create backdrop — inside overlay so z-index works
    const backdrop = document.createElement('div');
    backdrop.className = 'ref-image-name-popup-backdrop';
    backdrop.style.zIndex = '10000010';

    // Create popup — inside overlay with higher z-index than modal overlay
    const popup = document.createElement('div');
    popup.className = 'ref-image-name-popup';
    popup.style.zIndex = '10000011';
    popup.style.left = `${Math.max(8, rect.left)}px`;
    popup.style.top = `${rect.bottom + 8}px`;

    const title = document.createElement('div');
    title.className = 'ref-image-name-popup-title';
    title.textContent = t('tasks.imageNameMention');
    popup.appendChild(title);

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
    saveBtn.title = t('common.save');
    saveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    inputWrap.appendChild(saveBtn);

    popup.appendChild(inputWrap);

    // Append to document.body with z-index higher than modal overlay (10000001)
    document.body.appendChild(backdrop);
    document.body.appendChild(popup);

    input.focus();
    input.select();

    const doSave = () => {
      const newName = input.value.trim().replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 50);
      if (newName) {
        this._refImageNames[fileId] = newName;
        // Update name label in DOM
        const nameEl = this.overlay?.querySelector(`.ref-item-name[data-ref-id="${fileId}"]`);
        if (nameEl) nameEl.textContent = `@${newName}`;
        this._refreshMentionHelper();
      }
      cleanup();
    };

    const cleanup = () => {
      popup.remove();
      backdrop.remove();
    };

    saveBtn.addEventListener('click', doSave);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doSave();
      if (e.key === 'Escape') {
        e.stopPropagation(); // Prevent ESC from closing task modal
        cleanup();
      }
    });
    backdrop.addEventListener('click', cleanup);
  }

  // ========== Drag-Drop Ref Images ==========

  _enableRefDragDrop() {
    const previewEl = this.overlay?.querySelector('#taskRefImagesPreview');
    if (!previewEl) return;

    const items = previewEl.querySelectorAll('.ref-item, .ref-grid > .ref-thumb');
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
        const dragging = previewEl.querySelector('.dragging');
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
          this._reorderRefIds(draggedId, targetId);
        }
      });
    });
  }

  _reorderRefIds(draggedId, targetId) {
    const fileIdsInput = this.overlay?.querySelector('#taskFileIds');
    if (!fileIdsInput) return;

    const ids = fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean);
    const draggedIdx = ids.indexOf(draggedId);
    const targetIdx = ids.indexOf(targetId);
    if (draggedIdx === -1 || targetIdx === -1) return;

    ids.splice(draggedIdx, 1);
    ids.splice(targetIdx, 0, draggedId);

    fileIdsInput.value = ids.join(', ');
    this._renderTaskRefPreview();
    this._refreshMentionHelper();
  }

  _updateDragHint() {
    const hintEl = this.overlay?.querySelector('#taskRefDragHint');
    if (!hintEl) return;
    const fileIdsInput = this.overlay?.querySelector('#taskFileIds');
    const ids = (fileIdsInput?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    const refMode = this.overlay?.querySelector('#taskRefImageMode')?.value || 'all';
    const showHint = ids.length >= 2 && refMode === 'sequential';
    hintEl.classList.toggle('hidden', !showHint);
  }

  async save() {
    // Save lock — ngăn double-click tạo duplicate task
    if (this._isSaving) {
      console.log('[TaskModal] save() ignored — already saving');
      return;
    }
    this._isSaving = true;
    // Disable save button visual feedback
    const saveBtn = this.overlay?.querySelector('#saveTaskBtn');
    if (saveBtn) saveBtn.disabled = true;

    try {
      return await this._doSave();
    } finally {
      this._isSaving = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  async _doSave() {
    // Block save khi task đang running để tránh state corruption mid-execution
    if (this.mode === 'edit' && this.task?.status === 'running') {
      const I = window.I18n;
      window.customDialog?.alert(
        I?.t('tasks.cannotEditRunning') || 'Không thể lưu task đang chạy. Vui lòng dừng task trước.',
        { title: I?.t('tasks.taskRunning') || 'Task đang chạy', type: 'warning' }
      );
      return;
    }

    // Check task limit (only on create mode)
    // Luôn fetch async từ server để có entitlements mới nhất theo user plan
    if (this.mode === 'create' && window.featureGate) {
      const canCreate = await window.featureGate.canCreateTaskAsync();
      if (!canCreate) {
        const isLoggedIn = true;
        if (!isLoggedIn) {
          window.featureGate.showLoginPrompt(
            t('tasks.requireLoginToCreate') || 'Tạo task yêu cầu đăng nhập'
          );
        } else {
          const quota = window.featureGate.checkQuota('tasks_max');
          const dialog = window.customDialog || window.CustomDialog;
          if (dialog) {
            dialog.alert(
              t('tasks.quotaLimitMsg', { limit: quota.limit, used: quota.used }),
              { title: t('tasks.quotaLimitTitle'), type: 'warning' }
            );
          }
        }
        return;
      }
    }

    const taskName = this.overlay?.querySelector('#taskName')?.value?.trim();
    const prompt = this.overlay?.querySelector('#taskPrompt')?.value?.trim();
    // CG-6.1 + G-5.5: Provider field — default 'flow' nếu chưa có. Accept 'chatgpt' và 'grok'.
    const providerRaw = this.overlay?.querySelector('#taskProvider')?.value;
    const provider = (providerRaw === 'chatgpt' || providerRaw === 'grok' || providerRaw === 'flow') ? providerRaw : 'flow';

    // CG-Audit: Defensive feature gate check — chặn save khi user bypass UI
    // (vd. mở DevTools enable disabled tab, hoặc plan vừa downgrade trước khi modal đóng).
    // Auth-aware: logged-in free → upgrade modal; anonymous → login prompt
    if (provider === 'flow') {
      const canFlow = !!(window.featureGate?.canUse('gen_enabled'));
      if (!canFlow) {
        window.featureGate?.showLoginPrompt(
          t('tasks.flowProviderLockedMsg') || 'Google Flow yêu cầu gói phù hợp để sử dụng task này.'
        );
        return; // Không save
      }
    }
    if (provider === 'chatgpt') {
      const canChatGPT = !!(window.featureGate?.canUse('chatgpt_enabled'));
      if (!canChatGPT) {
        window.featureGate?.showLoginPrompt(
          t('tasks.providerLockedMsg') || 'ChatGPT yêu cầu gói Pro để sử dụng task này.'
        );
        return; // Không save
      }
    }
    // G-5.5: Defensive feature gate check cho Grok (mirror ChatGPT)
    if (provider === 'grok') {
      const canGrok = !!(window.featureGate?.canUse('grok_enabled'));
      if (!canGrok) {
        window.featureGate?.showLoginPrompt(
          t('tasks.grokProviderLockedMsg') || 'Grok yêu cầu gói Pro để sử dụng task này.'
        );
        return; // Không save
      }
    }

    const mediaType = this.overlay?.querySelector('#taskMediaType')?.value;
    const ratio = this.overlay?.querySelector('#taskRatio')?.value;
    // Strict Server-Only: ModelRegistry server-driven default, cache miss → null (caller xử lý).
    const model = mediaType === 'Video'
      ? (this.overlay?.querySelector('#taskVideoModel')?.value || window.ModelRegistry?.safeGetDefault('flow', 'video') || null)
      : (this.overlay?.querySelector('#taskModel')?.value || window.ModelRegistry?.safeGetDefault('flow', 'image') || null);
    if (!model) console.debug('[Tier3] TaskModal save: model resolve null (UI dropdown empty + cache miss)');
    const videoInputType = this.overlay?.querySelector('#taskVideoInputType')?.value || 'Frames';
    const quantity = parseInt(this.overlay?.querySelector('#taskQuantity')?.value) || 1;
    let fileIds = this.overlay?.querySelector('#taskFileIds')?.value?.trim();
    // Enforce ref image limit
    if (fileIds) {
      const refLimit = this._getTaskRefLimit();
      const fileIdArr = fileIds.split(',').map(s => s.trim()).filter(Boolean);
      if (fileIdArr.length > refLimit) {
        console.log(`[TaskModal] Ref images vượt giới hạn (${fileIdArr.length}/${refLimit}), chỉ lưu ${refLimit} ảnh đầu tiên`);
        fileIds = fileIdArr.slice(0, refLimit).join(', ');
      }
    }
    const taskEnabled = this.overlay?.querySelector('#taskEnabled')?.checked !== false;
    const autoDownload = this.overlay?.querySelector('#taskAutoDownload')?.checked;
    const downloadResolution = this.overlay?.querySelector('#taskDownloadResolution')?.value || '1k';
    const videoDownloadResolution = this.overlay?.querySelector('#taskVideoDownloadResolution')?.value || '720p';

    if (!prompt) {
      window.customDialog.alert(t('tasks.promptRequired'), { type: 'warning' });
      return;
    }

    const frame1FileId = this.overlay?.querySelector('#taskFrame1FileId')?.value?.trim() || '';
    const frame2FileId = this.overlay?.querySelector('#taskFrame2FileId')?.value?.trim() || '';

    // Multi-prompt: split by blank lines
    const isMultiPrompt = this.overlay?.querySelector('#taskMultiPromptCheck')?.checked || false;
    let prompts = null;
    if (isMultiPrompt) {
      prompts = TaskModal._splitMultiPrompt(prompt);
    }

    // Ref image names (mention mode)
    const refImageNames = Object.keys(this._refImageNames).length > 0
      ? { ...(this.task?.ref_image_names || {}), ...this._refImageNames }
      : (this.mode === 'edit' ? (this.task?.ref_image_names || null) : null);

    // G-5.5: Đọc Grok-specific fields từ form (chỉ áp dụng khi provider='grok').
    // grok_mode được derive từ taskMediaType (icon toggle) — đồng bộ với GenTab pattern.
    const grokModeFromToggle = mediaType === 'Video' ? 'video' : 'image';
    const grokDuration = this.overlay?.querySelector('#taskGrokDuration')?.value || '6s';
    const grokResolution = this.overlay?.querySelector('#taskGrokResolution')?.value || '720p';
    // Image quality (Grok update 2026-04): 'speed' | 'quality'. Chỉ áp dụng khi mode=image.
    const grokImageQuality = this.overlay?.querySelector('#taskGrokImageQuality')?.value || 'speed';
    // ChatGPT: xóa tin nhắn sau khi gen thành công
    const chatgptDeleteAfterGen = this.overlay?.querySelector('#taskChatgptDeleteAfterGen')?.checked || false;

    // Phase 1 (Flow-centric model): MỌI task (kể cả ChatGPT/Grok) gắn với Flow project.
    // Lý do: stream result đều bridge sang Flow → Flow là context bắt buộc.
    // - Edit: preserve project_id cũ (kể cả null cho legacy items chưa migrate)
    // - Create: gán current Flow project. Extension đã enforce qua _showProjectSelectOverlay
    //   ở app.js init → user không vào extension được khi không có Flow project.
    // Auto-migrate: task legacy (project_id=null) → save lại tự gán current project.
    const preservedProjectId = (this.mode === 'edit' && this.task?.project_id !== undefined)
      ? this.task.project_id
      : (window._currentProjectId || null);
    const isLegacyShared = preservedProjectId === null;
    const computedProjectId = isLegacyShared
      ? (window._currentProjectId || null)
      : preservedProjectId;

    // ChatGPT có model picker (Instant/Thinking — GPT-5.5) → persist task.model.
    // Grok không có model picker → null (tránh data pollution).
    const persistedModel = (provider === 'chatgpt')
      ? (this.overlay?.querySelector('#taskChatgptModel')?.value || 'Instant')
      : (provider === 'grok') ? null : model;

    const taskData = {
      _isNew: this.mode === 'create',
      task_id: this.mode === 'edit' ? this.task.task_id : (window.IdGenerator ? window.IdGenerator.next('task') : `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
      task_name: taskName || `Task ${window.I18n?.formatDateTime?.(new Date()) || new Date().toLocaleString()}`,
      // CG-6.1 + G-5.5: provider để phân biệt task chạy trên Flow vs ChatGPT vs Grok
      provider,
      prompt,
      multi_prompt: isMultiPrompt,
      prompts: prompts,
      media_type: mediaType,
      ratio,
      model: persistedModel,
      // Grok không hỗ trợ quantity → luôn 1
      quantity: provider === 'grok' ? 1 : quantity,
      video_input_type: mediaType === 'Video' ? videoInputType : null,
      video_duration: mediaType === 'Video' ? (this.overlay.querySelector('#taskVideoDuration')?.value || '6s') : null,
      // Flow Voice Selector — chỉ persist khi provider=flow + Video + model.config.supports_voice
      // (visibility logic đã reset value khi model không support — đọc trực tiếp hidden input)
      voice_slug: (provider === 'flow' && mediaType === 'Video')
        ? (this.overlay.querySelector('#taskVoiceSlug')?.value || null)
        : null,
      voice_search_value: (provider === 'flow' && mediaType === 'Video')
        ? (this.overlay.querySelector('#taskVoiceSearchValue')?.value || null)
        : null,
      // Flow Character Selector — persist khi provider=flow (cả image+video; visibility reset value khi không support)
      character_slug: (provider === 'flow')
        ? (this.overlay.querySelector('#taskCharacterSlug')?.value || null)
        : null,
      character_search_value: (provider === 'flow')
        ? (this.overlay.querySelector('#taskCharacterSearchValue')?.value || null)
        : null,
      ref_file_ids: fileIds,
      frame_1_file_id: mediaType === 'Video' && videoInputType === 'Frames' ? frame1FileId : null,
      frame_2_file_id: mediaType === 'Video' && videoInputType === 'Frames' ? frame2FileId : null,
      frame_pairs: this._buildFramePairsForSave(mediaType, videoInputType, isMultiPrompt, prompts),
      auto_download: autoDownload,
      download_resolution: downloadResolution,
      video_download_resolution: videoDownloadResolution,
      ref_image_mode: this.overlay.querySelector('#taskRefImageMode')?.value || 'all',
      ref_image_names: refImageNames,
      // Fix 3: UI bỏ rồi — preserve giá trị cũ nếu là edit mode, không gán mới.
      addon_prompt_id: (this.mode === 'edit' && this.task?.addon_prompt_id) ? this.task.addon_prompt_id : null,
      addon_prompt_text: (this.mode === 'edit' && this.task?.addon_prompt_text) ? this.task.addon_prompt_text : null,
      enabled: taskEnabled,
      status: this.mode === 'edit' ? this.task.status : 'pending',
      result_file_ids: this.mode === 'edit' ? this.task.result_file_ids : '',
      result_thumbnails: this.mode === 'edit' ? (this.task.result_thumbnails || {}) : {},
      error_message: this.mode === 'edit' ? this.task.error_message : '',
      // Option A: ChatGPT/Grok task không thuộc Flow project — luôn save project_id=null.
      // Flow task: preserve project_id khi edit, hoặc gán current khi create.
      project_id: computedProjectId,
      platform: 'flow',
    };

    // G-5.5: Grok-specific fields — chỉ thêm khi provider='grok' (tránh pollute Flow/ChatGPT tasks)
    if (provider === 'grok') {
      taskData.grok_mode = grokModeFromToggle;
      taskData.grok_duration = grokDuration;
      taskData.grok_resolution = grokResolution;
      // Image quality (Grok update 2026-04) — chỉ relevant khi mode=image
      taskData.grok_image_quality = grokImageQuality;
    }

    // ChatGPT-specific fields
    if (provider === 'chatgpt') {
      taskData.chatgpt_delete_after_gen = chatgptDeleteAfterGen;
    }

    // Capture ref image thumbnails for persistence across reloads
    // Phase R: ref_file_names (UUIDs) will be scanned async via MessageBridge
    if (fileIds) {
      const refThumbs = {};
      const refIds = fileIds.split(',').map(s => s.trim()).filter(Boolean);
      for (const id of refIds) {
        const pending = window.pendingUploadFiles?.get(id);
        if (pending?.thumbnail) { refThumbs[id] = pending.thumbnail; continue; }
        // Check _taskTileCache (populated by _syncUploadKeyToTileId and MessageBridge)
        const cached = this._taskTileCache?.[id];
        if (cached) {
          const thumbUrl = typeof cached === 'string' ? cached : cached.thumbnail;
          if (thumbUrl) {
            // 2026-05-27: ref video → persist object {thumbnail, type:'video'} để has_ref_video
            // detect được sau reload (force duration 10s khi task submit).
            refThumbs[id] = (typeof cached === 'object' && cached.type === 'video')
              ? { thumbnail: thumbUrl, type: 'video' } : thumbUrl;
            continue;
          }
        }
      }
      if (Object.keys(refThumbs).length > 0) {
        taskData.ref_thumbnails = { ...(this.mode === 'edit' ? (this.task.ref_thumbnails || {}) : {}), ...refThumbs };
      } else if (this.mode === 'edit') {
        taskData.ref_thumbnails = this.task.ref_thumbnails || {};
      }
      // Build ref_file_names from _taskTileCache (populated by _syncUploadKeyToTileId)
      // CRITICAL: Nếu chỉ preserve từ task cũ, file_names từ upload mới sẽ bị mất
      const refFileNames = {};
      for (const id of refIds) {
        const cached = this._taskTileCache?.[id];
        if (cached?.file_name) {
          refFileNames[id] = cached.file_name;
        }
      }
      if (Object.keys(refFileNames).length > 0) {
        taskData.ref_file_names = { ...(this.mode === 'edit' ? (this.task.ref_file_names || {}) : {}), ...refFileNames };
      } else if (this.mode === 'edit' && this.task.ref_file_names) {
        taskData.ref_file_names = this.task.ref_file_names;
      }
    }

    // Capture frame thumbnails + file_names for persistence across reloads
    const frame1Id = taskData.frame_1_file_id;
    const frame2Id = taskData.frame_2_file_id;
    if (frame1Id || frame2Id) {
      const getFrameInfo = (fid) => {
        if (!fid) return { thumbnail: null, file_name: null };
        const pending = window.pendingUploadFiles?.get(fid);
        const cached = this._taskTileCache?.[fid];
        const cachedObj = cached ? (typeof cached === 'string' ? { thumbnail: cached } : cached) : {};
        return {
          thumbnail: pending?.thumbnail || cachedObj.thumbnail || null,
          file_name: cachedObj.file_name || null
        };
      };
      if (frame1Id) {
        const info = getFrameInfo(frame1Id);
        taskData.frame_1_thumbnail = info.thumbnail || (this.mode === 'edit' ? this.task.frame_1_thumbnail : null) || null;
        taskData.frame_1_file_name = info.file_name || (this.mode === 'edit' ? this.task.frame_1_file_name : null) || null;
      }
      if (frame2Id) {
        const info = getFrameInfo(frame2Id);
        taskData.frame_2_thumbnail = info.thumbnail || (this.mode === 'edit' ? this.task.frame_2_thumbnail : null) || null;
        taskData.frame_2_file_name = info.file_name || (this.mode === 'edit' ? this.task.frame_2_file_name : null) || null;
      }
    }

    console.log('[TaskModal] save() taskData:', {
      multi_prompt: taskData.multi_prompt,
      ref_image_mode: taskData.ref_image_mode,
      ref_image_names: taskData.ref_image_names,
      addon_prompt_id: taskData.addon_prompt_id
    });

    try {
      if (window.storageManager) {
        await window.storageManager.saveTask(taskData);
        // Emit event để TaskList cập nhật
        window.eventBus?.emit('storage:task_saved', { taskId: taskData.task_id, task_id: taskData.task_id });
      }
      if (this.mode === 'create') {
        // Trial gate: ghi nhận tạo task (chỉ cho not-logged-in users)
        // IMPORTANT: Must await to ensure usage is recorded before next action
        if (window.featureGate && !true) {
          await window.featureGate.recordTaskCreated();
        }
        // Refresh featureGate to update task count for next create
        if (window.featureGate) {
          window.featureGate.refresh({ force: true }).catch(e => console.warn('[TaskModal] FeatureGate refresh failed:', e));
        }
      }
      // Phase R: Async scan ref_file_names (UUIDs) via MessageBridge for 5-tier correction
      this._scanRefFileNames(taskData.task_id, fileIds);
      // Proactive blob caching: cache ref image blobs vào PendingUploadStore
      // để reuploadMissingFiles Tầng 1-2 có thể recover khi image bị xóa khỏi Flow
      this._cacheRefImageBlobs(taskData).catch(e =>
        console.warn('[TaskModal] Proactive blob caching failed:', e.message)
      );
      // S2.5: Upload keys đã được lưu vào task — không cancel khi đóng modal
      this._modalUploadKeys?.clear();
      this._forceClose();
      window.showNotification?.(this.mode === 'edit' ? t('tasks.taskUpdated') : t('tasks.taskCreated'), 'success');
    } catch (error) {
      console.error('[TaskModal] Save failed:', error);

      // Quota error modal already shown by ApiStorage._handleQuotaError
      if (error.code === 'QUOTA_EXCEEDED' || error.message?.includes('giới hạn')) {
        return;
      }

      // REQUIRES_LOGIN error - show login prompt (defensive, normally caught by canCreateTaskAsync)
      if (error.message === 'REQUIRES_LOGIN') {
        window.featureGate?.showLoginPrompt(
          t('tasks.requireLoginToCreate') || 'Tạo task yêu cầu đăng nhập'
        );
        return;
      }

      window.customDialog.alert(t('tasks.saveFailed') + error.message, { type: 'error' });
    }
  }

  /**
   * G: Đảm bảo provider tab URL đã mở + activate khi user click chọn provider trong TaskModal.
   * Caller (click handler) đã guard `if (providerHidden.value === providerKey) return` →
   * function này chỉ chạy khi provider thực sự CHANGE → luôn activate URL tab.
   * CRITICAL: ensureReady() có 60s cache → cache hit RETURN ngay không activate.
   * Phải gọi ensureTabActive() SAU ensureReady để force activate cho mọi switch.
   */
  _ensureProviderTab(providerKey) {
    try {
      this._checkDuplicateProviderTabs(providerKey);

      if (providerKey === 'chatgpt' && window.ChatGPTSession?.ensureReady) {
        window.ChatGPTSession.ensureReady({ createIfMissing: true, activate: true })
          .then(() => window.ChatGPTSession.ensureTabActive?.())
          .catch(err => console.warn('[TaskModal] ChatGPT activate failed:', err?.message || err));
      } else if (providerKey === 'grok' && window.GrokSession?.ensureReady) {
        window.GrokSession.ensureReady({ createIfMissing: true, activate: true })
          .then(() => window.GrokSession.ensureTabActive?.())
          .catch(err => console.warn('[TaskModal] Grok activate failed:', err?.message || err));
      } else if (providerKey === 'flow') {
        try { chrome.runtime.sendMessage({ action: 'activateFlowTabForExecution' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskModal#_checkDuplicateProviderTabs', _e); }); } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#_ensureProviderTab', _); }
      }
    } catch (err) {
      console.warn('[TaskModal] _ensureProviderTab error:', err?.message || err);
    }
  }

  /**
   * G: Check duplicate tabs cùng 1 provider URL → cảnh báo + offer close action.
   * Refactor 2026-05-22: customDialog modal với button "Đóng tabs thừa".
   */
  _checkDuplicateProviderTabs(providerKey, options = {}) {
    if (!chrome?.runtime?.sendMessage) return;
    const { interactive = true } = options;
    TaskModal._dupCheckPending = TaskModal._dupCheckPending || {};
    if (TaskModal._dupCheckPending[providerKey]) return;
    try {
      chrome.runtime.sendMessage({ action: 'queryProviderTabs', provider: providerKey }, (resp) => {
        if (chrome.runtime.lastError) return;
        const count = resp?.count || 0;
        if (count <= 1) return;
        const providerName = providerKey === 'chatgpt' ? 'ChatGPT' : (providerKey === 'grok' ? 'Grok' : (providerKey === 'gemini' ? 'Gemini' : 'Flow'));
        const msg = (window.I18n?.t?.('gen.duplicateProviderTabs', { provider: providerName, count }))
          || `Phát hiện ${count} tab ${providerName} đang mở. Vui lòng đóng bớt để extension hoạt động ổn định.`;
        if (interactive && window.customDialog?.confirm) {
          TaskModal._dupCheckPending[providerKey] = true;
          window.customDialog.confirm(msg, {
            title: window.I18n?.t?.('gen.duplicateTabsTitle') || 'Phát hiện tab trùng lặp',
            type: 'warning',
            confirmText: window.I18n?.t?.('gen.closeExtraTabs') || 'Đóng tabs thừa',
            cancelText: window.I18n?.t?.('common.ignore') || 'Bỏ qua',
          }).then((shouldClose) => {
            setTimeout(() => { delete TaskModal._dupCheckPending[providerKey]; }, 30000);
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
          console.warn(`[TaskModal] ${msg}`);
        }
      });
    } catch (_) { /* noop */ }
  }

  /**
   * CG-6.2: Render lại form theo provider (Flow vs ChatGPT).
   *
   * - Flow: giữ nguyên các fields hiện có (media_type, model, ratio 5 options, quantity).
   * - ChatGPT: ẩn media_type, model, video_input_type, quantity. Ratio render
   *   lại với 5 options theo capabilities của ChatGPTAdapter.
   *
   * Tận dụng `window.ProviderRegistry.get('chatgpt').capabilities` thay vì
   * hardcode để dễ maintain. Nếu ProviderRegistry chưa load → fallback hardcode.
   */
  _renderTaskFormByProvider(providerKey) {
    const isChatGPT = providerKey === 'chatgpt';
    const isGrok = providerKey === 'grok';
    // Đánh dấu provider lên bar → CSS tắt gen-compact-break (--always/--video) cho grok/chatgpt.
    // Break chỉ cần cho flow (tách Character/Voice/Style xuống line riêng); grok/chatgpt không có
    // các field đó nên break làm settings bị đẩy xuống hàng thừa.
    const _bar = this.overlay?.querySelector('#taskGenCompactBar');
    if (_bar) _bar.dataset.provider = providerKey;

    const mediaTypeGroup = this.overlay?.querySelector('#taskMediaTypeGroup');
    const imageModelGroup = this.overlay?.querySelector('#taskImageModelGroup');
    const videoModelGroup = this.overlay?.querySelector('#taskVideoModelGroup');
    const videoInputTypeRow = this.overlay?.querySelector('#taskVideoInputTypeRow');
    const videoDurationGroup = this.overlay?.querySelector('#taskVideoDurationGroup');
    const quantityGroup = this.overlay?.querySelector('#taskQuantityGroup');
    const ratioSelect = this.overlay?.querySelector('#taskRatio');
    const ratioGroup = this.overlay?.querySelector('#taskRatioGroup');
    const framesGroup = this.overlay?.querySelector('#taskFramesGroup');
    // G-5.3: Grok-specific groups
    const grokModeGroup = this.overlay?.querySelector('#taskGrokModeGroup');
    const grokDurationGroup = this.overlay?.querySelector('#taskGrokDurationGroup');
    const grokResolutionGroup = this.overlay?.querySelector('#taskGrokResolutionGroup');
    const grokImageQualityGroup = this.overlay?.querySelector('#taskGrokImageQualityGroup');
    const grokModeSelect = this.overlay?.querySelector('#taskGrokMode');

    // Fix 2: Sync visibility resolution wraps theo provider + auto_download + media type.
    // ChatGPT/Grok: ẩn cả 2 wraps (URL CDN cố định, không có 1k/2k/720p/1080p tương tự Flow).
    // Flow + image: chỉ taskDownloadResWrap (1k/2k/4k).
    // Flow + video: chỉ taskVideoDownloadResWrap (720p/1080p/4k).
    // auto_download OFF: ẩn cả 2.
    const syncDownloadResVisibility = () => {
      const autoDownload = this.overlay?.querySelector('#taskAutoDownload')?.checked;
      const isVideo = (this.overlay?.querySelector('#taskMediaType')?.value === 'Video');
      const resWrap = this.overlay?.querySelector('#taskDownloadResWrap');
      const videoResWrap = this.overlay?.querySelector('#taskVideoDownloadResWrap');
      if (!autoDownload || isChatGPT || isGrok) {
        resWrap?.classList.add('hidden');
        videoResWrap?.classList.add('hidden');
      } else if (isVideo) {
        resWrap?.classList.add('hidden');
        videoResWrap?.classList.remove('hidden');
      } else {
        resWrap?.classList.remove('hidden');
        videoResWrap?.classList.add('hidden');
      }
    };

    // Reference Video button trong icon toggle (cần để hide cho ChatGPT)
    const mediaToggleVideoBtn = this.overlay?.querySelector('#taskMediaTypeToggle .task-media-btn[data-mode="Video"]');
    const mediaToggleImageBtn = this.overlay?.querySelector('#taskMediaTypeToggle .task-media-btn[data-mode="Image"]');

    // ChatGPT delete after gen toggle
    const chatgptDeleteGroup = this.overlay?.querySelector('#taskChatgptDeleteAfterGenGroup');

    if (isChatGPT) {
      // ChatGPT: show icon mode toggle (giống GenTab) — chỉ ẩn Video button (ChatGPT chỉ tạo ảnh).
      mediaTypeGroup?.classList.remove('hidden');
      if (mediaToggleVideoBtn) mediaToggleVideoBtn.style.display = 'none';
      if (mediaToggleImageBtn) mediaToggleImageBtn.style.display = '';
      imageModelGroup?.classList.add('hidden');
      videoModelGroup?.classList.add('hidden');
      this.overlay?.querySelector('#taskChatgptModelGroup')?.classList.remove('hidden'); // model Instant/Thinking
      videoInputTypeRow?.classList.add('hidden');
      videoDurationGroup?.classList.add('hidden');
      quantityGroup?.classList.add('hidden');
      framesGroup?.classList.add('hidden');
      // Grok-only fields ẩn cho ChatGPT
      grokModeGroup?.classList.add('hidden');
      grokDurationGroup?.classList.add('hidden');
      grokResolutionGroup?.classList.add('hidden');
      grokImageQualityGroup?.classList.add('hidden');
      // ChatGPT delete toggle: hiển thị + load default từ af_settings nếu create mode
      chatgptDeleteGroup?.classList.remove('hidden');
      if (this.mode !== 'edit' && !this.overlay._chatgptDeleteDefaultLoaded) {
        this.overlay._chatgptDeleteDefaultLoaded = true;
        const deleteToggle = this.overlay.querySelector('#taskChatgptDeleteAfterGen');
        if (deleteToggle) {
          chrome.storage.local.get(['af_settings'], (res) => {
            deleteToggle.checked = !!(res.af_settings?.chatgptDeleteAfterGen);
          });
        }
      }

      // Force media_type = Image (ChatGPT chỉ tạo ảnh)
      const mediaTypeSelect = this.overlay?.querySelector('#taskMediaType');
      if (mediaTypeSelect && mediaTypeSelect.value !== 'Image') {
        mediaTypeSelect.value = 'Image';
        mediaTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // Re-render ratio options theo ChatGPTAdapter capabilities (5 options).
      if (ratioSelect && ratioGroup) {
        ratioGroup.classList.remove('hidden');
        // Lấy capabilities từ ProviderRegistry (fallback hardcode nếu thiếu)
        const adapter = window.ProviderRegistry?.get?.('chatgpt');
        const supportedRatios = adapter?.capabilities?.supportedRatios || ['story', 'portrait', 'square', 'landscape', 'widescreen'];
        const ratioUiMap = adapter?.capabilities?.ratioUiMap || {
          story: '9:16', portrait: '3:4', square: '1:1', landscape: '4:3', widescreen: '16:9',
        };
        // Icon prefix tương ứng (hỗ trợ user dễ nhận biết)
        const iconMap = {
          story: '▮', portrait: '▯', square: '□', landscape: '▭', widescreen: '▬',
        };
        const currentValue = ratioSelect.value;
        ratioSelect.innerHTML = supportedRatios.map((key) => {
          const label = `${iconMap[key] || ''} ${ratioUiMap[key] || key}`.trim();
          return `<option value="${key}">${label}</option>`;
        }).join('');
        // Priority: currentValue (nếu hợp lệ) > task.ratio (edit mode) > af_settings.chatgptDefaultRatio > 'story'.
        // Async load af_settings để đọc default ratio user đã set ở Settings popup.
        if (supportedRatios.includes(currentValue)) {
          ratioSelect.value = currentValue;
        } else if (this.mode === 'edit' && supportedRatios.includes(this.task?.ratio)) {
          ratioSelect.value = this.task.ratio;
        } else {
          // Tạm set default fallback rồi async override từ af_settings
          ratioSelect.value = 'story';
          chrome.storage.local.get(['af_settings'], (res) => {
            const settings = res.af_settings || {};
            const userDefault = settings.chatgptDefaultRatio;
            if (userDefault && supportedRatios.includes(userDefault) && ratioSelect.value === 'story') {
              ratioSelect.value = userDefault;
            }
          });
        }
      }
    } else if (isGrok) {
      // G-5.3: Grok branch — Show icon mode toggle (giống GenTab + ChatGPT pattern).
      // Grok hỗ trợ cả Image và Video → giữ visible cả 2 button. mediaType lưu trong
      // task.media_type để cho user nhận diện; grok_mode được derive từ mediaType khi save.
      // Hide model, video_input_type, frames, quantity. Show ratio (5 Grok keys),
      // grok_duration + grok_resolution khi mode=video.
      mediaTypeGroup?.classList.remove('hidden');
      if (mediaToggleVideoBtn) mediaToggleVideoBtn.style.display = '';
      if (mediaToggleImageBtn) mediaToggleImageBtn.style.display = '';
      imageModelGroup?.classList.add('hidden');
      videoModelGroup?.classList.add('hidden');
      videoInputTypeRow?.classList.add('hidden');
      videoDurationGroup?.classList.add('hidden');
      framesGroup?.classList.add('hidden');
      // Grok video chỉ dùng ref_img — KHÔNG có frame_1/frame_2 như Flow.
      // updateTaskMediaUI có thể ẩn refImagesGroup khi Video+Frames mode → ép visible cho Grok.
      const refImagesGroupGrok = this.overlay?.querySelector('#taskRefImagesGroup');
      refImagesGroupGrok?.classList.remove('hidden');
      // Grok không có quantity → ẩn group
      quantityGroup?.classList.add('hidden');
      // Grok đã dùng icon toggle thay select → ẩn select group
      grokModeGroup?.classList.add('hidden');
      // ChatGPT delete toggle: ẩn cho Grok
      chatgptDeleteGroup?.classList.add('hidden');
      this.overlay?.querySelector('#taskChatgptModelGroup')?.classList.add('hidden');

      // Sync taskMediaType với task.grok_mode CHỈ trên FIRST render (initial open).
      // Bug fix: trước fix block này chạy MỖI LẦN _renderTaskFormByProvider được gọi,
      // bao gồm sau khi user click toggle Image/Video (vì change event re-trigger handler này) →
      // revert mediaType về task.grok_mode cũ → user click Video không thấy gì thay đổi.
      // render() đã set initial value từ tmt = task.grok_mode, nên block này thực ra không cần
      // cho initial — nhưng giữ để safety net cho switch provider Flow → Grok.
      const mediaTypeSelect = this.overlay?.querySelector('#taskMediaType');
      if (mediaTypeSelect && this.mode === 'edit' && this.task?.provider === 'grok' && !this.overlay._grokInitialSyncDone) {
        this.overlay._grokInitialSyncDone = true;
        const desiredMode = this.task.grok_mode === 'video' ? 'Video' : 'Image';
        if (mediaTypeSelect.value !== desiredMode) {
          mediaTypeSelect.value = desiredMode;
          mediaTypeSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      // Sync hidden grokMode select với taskMediaType (giữ backward-compat cho save() cũ
      // nếu có code đọc grokMode select)
      const grokModeHidden = this.overlay?.querySelector('#taskGrokMode');
      if (grokModeHidden && mediaTypeSelect) {
        grokModeHidden.value = mediaTypeSelect.value === 'Video' ? 'video' : 'image';
      }

      // Force quantity = 1 (Grok không hỗ trợ quantity)
      const qtyInput = this.overlay?.querySelector('#taskQuantity');
      if (qtyInput) qtyInput.value = '1';

      // Re-render ratio options theo GrokAdapter capabilities (5 options).
      // Grok ratios: 2:3 / 3:2 / 1:1 / 9:16 / 16:9 (KHÔNG dùng 3:4/4:3 như ChatGPT).
      if (ratioSelect && ratioGroup) {
        ratioGroup.classList.remove('hidden');
        const adapter = window.ProviderRegistry?.get?.('grok');
        const supportedRatios = adapter?.capabilities?.supportedRatios || ['portrait', 'landscape', 'square', 'story', 'widescreen'];
        const ratioUiMap = adapter?.capabilities?.ratioUiMap || {
          story: '9:16', portrait: '2:3', square: '1:1', landscape: '3:2', widescreen: '16:9',
        };
        const iconMap = {
          story: '▮', portrait: '▯', square: '□', landscape: '▭', widescreen: '▬',
        };
        const currentValue = ratioSelect.value;
        ratioSelect.innerHTML = supportedRatios.map((key) => {
          const label = `${iconMap[key] || ''} ${ratioUiMap[key] || key}`.trim();
          return `<option value="${key}">${label}</option>`;
        }).join('');
        // Priority: currentValue > task.ratio (edit mode) > af_settings.grokDefaultRatio > 'widescreen'.
        // Async load af_settings để đọc default ratio user đã set ở Settings popup.
        if (supportedRatios.includes(currentValue)) {
          ratioSelect.value = currentValue;
        } else if (this.mode === 'edit' && supportedRatios.includes(this.task?.ratio)) {
          ratioSelect.value = this.task.ratio;
        } else {
          ratioSelect.value = 'widescreen';
          chrome.storage.local.get(['af_settings'], (res) => {
            const settings = res.af_settings || {};
            const userDefault = settings.grokDefaultRatio;
            if (userDefault && supportedRatios.includes(userDefault) && ratioSelect.value === 'widescreen') {
              ratioSelect.value = userDefault;
            }
          });
        }
      }

      // Toggle grok_duration + grok_resolution dựa trên taskMediaType (icon toggle).
      // Listener bind 1 lần qua flag `_grokVideoToggleBound` trên overlay.
      const syncGrokVideoVisibility = () => {
        const provider = this.overlay?.querySelector('#taskProvider')?.value;
        if (provider !== 'grok') return; // Chỉ apply khi provider=grok
        const mtSel = this.overlay?.querySelector('#taskMediaType');
        const isVideoMode = mtSel?.value === 'Video';
        if (isVideoMode) {
          grokDurationGroup?.classList.remove('hidden');
          grokResolutionGroup?.classList.remove('hidden');
          grokImageQualityGroup?.classList.add('hidden');
        } else {
          grokDurationGroup?.classList.add('hidden');
          grokResolutionGroup?.classList.add('hidden');
          // Image mode: show quality (Speed/Quality)
          grokImageQualityGroup?.classList.remove('hidden');
        }
        // Sync hidden grokMode select để save() cũ vẫn lấy đúng value
        const grokModeHidden = this.overlay?.querySelector('#taskGrokMode');
        if (grokModeHidden && mtSel) {
          grokModeHidden.value = isVideoMode ? 'video' : 'image';
        }
      };
      syncGrokVideoVisibility();
      // Bind taskMediaType change → sync grok video fields (idempotent qua overlay flag)
      const mtSelBind = this.overlay?.querySelector('#taskMediaType');
      if (mtSelBind && !this.overlay._grokVideoToggleBound) {
        mtSelBind.addEventListener('change', syncGrokVideoVisibility);
        this.overlay._grokVideoToggleBound = true;
      }
    } else {
      // Flow: hiện đầy đủ fields, re-render ratio theo media_type hiện tại.
      // Restore Video button trong icon toggle (có thể đã bị ẩn bởi ChatGPT branch).
      mediaTypeGroup?.classList.remove('hidden');
      if (mediaToggleVideoBtn) mediaToggleVideoBtn.style.display = '';
      if (mediaToggleImageBtn) mediaToggleImageBtn.style.display = '';
      quantityGroup?.classList.remove('hidden');
      ratioGroup?.classList.remove('hidden');
      // Grok-only fields ẩn khi switch về Flow
      grokModeGroup?.classList.add('hidden');
      grokDurationGroup?.classList.add('hidden');
      grokResolutionGroup?.classList.add('hidden');
      grokImageQualityGroup?.classList.add('hidden');
      // ChatGPT delete toggle: ẩn cho Flow
      chatgptDeleteGroup?.classList.add('hidden');
      this.overlay?.querySelector('#taskChatgptModelGroup')?.classList.add('hidden');
      // Khôi phục state media (image/video) qua updateTaskMediaUI logic — gọi gián tiếp qua change event
      // bằng cách trigger change để re-apply visibility
      const mediaTypeSelect = this.overlay?.querySelector('#taskMediaType');
      if (mediaTypeSelect) mediaTypeSelect.dispatchEvent(new Event('change'));
      // Re-render ratio options Flow standard (image/video)
      this._updateRatioOptions();
    }

    // Fix 2: Sync resolution wraps sau khi đã update fields.
    syncDownloadResVisibility();

    // Flow Voice Selector — re-apply visibility theo provider mới (hide cho chatgpt/grok)
    try { this._applyTaskVoicePickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#syncGrokVideoVisibility', _); }
    try { this._applyTaskCharacterPickerVisibility(); } catch (_) { globalThis.SEOSONA_swallow?.('TaskModal#syncGrokVideoVisibility', _); }
  }

  /**
   * Update ratio options based on media type
   * Video: only 16:9 and 9:16
   * Image: all 5 ratios
   */
  _updateRatioOptions() {
    const ratioSelect = this.overlay?.querySelector('#taskRatio');
    const mediaTypeSelect = this.overlay?.querySelector('#taskMediaType');
    if (!ratioSelect) return;

    // Skip cho ChatGPT/Grok — ratio options của 2 provider này dùng KEY khác
    // (story/portrait/square/landscape/widescreen) và được render bởi _renderTaskFormByProvider.
    // Trước fix: hàm này re-render NUMERIC options + async fallback override ratio key của Grok
    // → mất data ratio khi mở edit task Grok (vd 'widescreen' → reset về first Grok option).
    const provider = this.overlay?.querySelector('#taskProvider')?.value;
    if (provider === 'chatgpt' || provider === 'grok') return;

    const isVideo = mediaTypeSelect?.value === 'Video';
    const currentValue = ratioSelect.value;

    // Source of truth: ProviderConfigManager.getRatiosSync('flow', mode) — admin tweakable.
    const mode = isVideo ? 'video' : 'image';
    const fallback = isVideo ? ['16:9', '9:16'] : ['1:1', '9:16', '16:9', '4:3', '3:4'];
    const ratios = (window.ProviderConfigManager?.safeGetRatiosSync('flow', mode)) || fallback;

    const _icon = (v) => {
      const s = String(v || '').trim();
      if (s === '16:9') return '▬';
      if (s === '4:3' || s === '3:2') return '▭';
      if (s === '1:1') return '□';
      if (s === '3:4' || s === '2:3') return '▯';
      if (s === '9:16') return '▮';
      return '◇';
    };

    // Server returns [{value, ui_name}] — normalize to string values
    const options = ratios.map(r => {
      const value = typeof r === 'string' ? r : (r.value || r);
      return { value, label: `${_icon(value)} ${value}` };
    });
    ratioSelect.innerHTML = options.map(opt =>
      `<option value="${opt.value}">${opt.label}</option>`
    ).join('');

    // Restore value if valid, else fallback to default ratio from settings
    const validValues = options.map(o => o.value);
    if (validValues.includes(currentValue)) {
      ratioSelect.value = currentValue;
    } else {
      // Fallback to default ratio from settings
      chrome.storage.local.get(['af_settings'], (res) => {
        const settings = res.af_settings || {};
        const defaultRatio = isVideo
          ? (settings.defaultVideoRatio || '16:9')
          : (settings.defaultImageRatio || '16:9');
        ratioSelect.value = defaultRatio;
      });
    }
  }

  /**
   * Bug 30 fix (2026-05-19): Re-populate download resolution dropdowns trong TaskModal
   * từ PCM `provider_configs.api_config.download_resolutions`. Gọi khi SSE
   * `provider:api_config_updated` key=download_resolutions fire.
   *
   * Pattern giống `GenTab.updateDownloadResolutionOptions()`.
   */
  _updateDownloadResolutionOptions() {
    if (!this.overlay) return;
    const fillSelect = (selectEl, mode) => {
      if (!selectEl) return;
      // Bug 36 fix (2026-05-19): UI display dùng `label`, fallback `menu_label`/`value`.
      // `menu_label` CHỈ dùng cho Flow web DOM menu matching (content.js downloadViaFlowMenu).
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
        opt.textContent = r.label || r.menu_label || r.value;
        selectEl.appendChild(opt);
      }
      // Full-size thật (không có trong config) — chỉ cho ảnh.
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
    fillSelect(this.overlay.querySelector('#taskDownloadResolution'),      'image');
    fillSelect(this.overlay.querySelector('#taskVideoDownloadResolution'), 'video');
  }

  /**
   * Async scan ref_file_names (UUIDs) via MessageBridge
   * Phase R: Enables 5-tier correction for ref images
   */
  async _scanRefFileNames(taskId, fileIdsStr) {
    if (!fileIdsStr || !taskId) return;
    const refIds = fileIdsStr.split(',').map(s => s.trim()).filter(Boolean);
    const idsToScan = refIds.filter(id => !id.startsWith('upload_'));
    if (idsToScan.length === 0) return;

    try {
      if (typeof MessageBridge === 'undefined') return;
      const scanResult = await MessageBridge.getThumbnailsByIds(idsToScan);
      const results = scanResult?.results || {};
      const fileNameMap = {};
      const thumbMap = {};

      for (const [fid, info] of Object.entries(results)) {
        if (info?.file_name) fileNameMap[fid] = info.file_name;
        if (info?.thumbnail) thumbMap[fid] = info.thumbnail;
      }

      if (Object.keys(fileNameMap).length > 0 || Object.keys(thumbMap).length > 0) {
        // Load current task and update
        if (window.storageManager) {
          const task = await window.storageManager.getTask(taskId);
          if (task) {
            if (Object.keys(fileNameMap).length > 0) {
              task.ref_file_names = { ...(task.ref_file_names || {}), ...fileNameMap };
            }
            if (Object.keys(thumbMap).length > 0) {
              task.ref_thumbnails = { ...(task.ref_thumbnails || {}), ...thumbMap };
            }
            await window.storageManager.saveTask(task);
            console.log('[TaskModal] Scanned ref_file_names:', Object.keys(fileNameMap).length, 'UUIDs');
          }
        }
      }
    } catch (e) {
      console.warn('[TaskModal] _scanRefFileNames error:', e);
    }
  }

  /**
   * Proactive blob caching — fetch ref image blobs và cache vào PendingUploadStore
   * để reuploadMissingFiles Tầng 1-2 có thể recover khi image bị xóa khỏi Flow.
   * Fire-and-forget, không block UI.
   */
  async _cacheRefImageBlobs(taskData) {
    if (!window.PendingUploadStore || !taskData.ref_file_ids) return;
    const refIds = (taskData.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (refIds.length === 0) return;

    const thumbs = taskData.ref_thumbnails || {};
    for (const id of refIds) {
      // Skip nếu đã có trong uploadedFileCache (đã cache từ upload gần đây)
      if (window.uploadedFileCache?.has(id)) continue;
      // Skip upload_ keys (chưa upload xong)
      if (id.startsWith('upload_')) continue;

      const thumbUrl = thumbs[id] || MediaRegistry?.getThumb(id);
      if (!thumbUrl || typeof thumbUrl !== 'string' || !thumbUrl.startsWith('http')) continue;

      try {
        const fetchUrl = thumbUrl.includes('lh3.') || thumbUrl.includes('googleusercontent.com')
          ? thumbUrl.split('=')[0]
          : thumbUrl;

        let resp;
        const _mp = window._getMediaUrlPattern?.() || 'getMediaUrlRedirect';
        if (fetchUrl.includes(_mp)) {
          resp = await window.MessageBridge?.sendToContentScript('fetchImageAsBase64', { url: fetchUrl });
          if (!resp?.success) {
            resp = await new Promise((resolve, reject) => {
              chrome.runtime.sendMessage({ action: 'fetchBlob', url: fetchUrl, expectImage: true }, (r) => {
                if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
                resolve(r);
              });
            });
          }
        } else {
          resp = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: 'fetchBlob', url: fetchUrl, expectImage: true }, (r) => {
              if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
              resolve(r);
            });
          });
        }

        if (resp?.success && resp.base64) {
          const binary = atob(resp.base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const contentType = resp.contentType || 'image/png';
          const blob = new Blob([bytes], { type: contentType });
          const file = new File([blob], `ref_${id.substring(0, 8)}.png`, { type: contentType });
          await PendingUploadStore.cacheUploaded(id, file);
          console.log(`[TaskModal] Proactive cached blob for ref ${id.substring(0, 8)}`);
        }
      } catch (e) {
        // Không block — fire-and-forget
        console.warn(`[TaskModal] Failed to cache blob for ref ${id.substring(0, 8)}:`, e.message);
      }
    }
  }

  _renderResultsTab() {
    if (!this.task) return `<p style="color: var(--muted-foreground); font-size: 12px;">${t('tasks.noData')}</p>`;

    const fileIds = (this.task.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    const hasResults = fileIds.length > 0;
    // Portrait: 9:16, 3:4, Dọc. Landscape: 16:9, 4:3, Ngang. Square: 1:1
    const isPortrait = ['9:16', '3:4', 'Dọc'].includes(this.task.ratio);
    const isLandscape = ['16:9', '4:3', 'Ngang'].includes(this.task.ratio);
    const ratioClass = isPortrait ? 'ratio-portrait' : isLandscape ? 'ratio-landscape' : '';
    const statusText = this.task.status === 'completed' ? t('tasks.statusCompleted') :
      this.task.status === 'failed' ? t('tasks.statusFailed') :
      this.task.status === 'running' ? t('tasks.statusRunning') : t('tasks.statusPending');
    const statusClass = this.task.status || 'pending';

    // Provider-specific download UX:
    // - Flow: chọn resolution (1k/2k/4k or 720p/1080p/4k) qua modal
    // - ChatGPT/Grok: download CDN URL trực tiếp, quality fixed → hint "Original"
    const isExternal = this._isExternalProvider();
    const downloadAllLabel = isExternal
      ? `${t('tasks.downloadAll')} <span class="task-result-quality-hint">(${t('tasks.originalQuality') || 'Original'})</span>`
      : t('tasks.downloadAll');

    let resultsHtml = '';
    if (hasResults) {
      resultsHtml = `
        <div class="task-result-header">
          <span class="task-result-status ${statusClass}">${statusText}</span>
          <button class="btn btn-secondary btn-sm" id="downloadAllResultsBtn">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
            ${downloadAllLabel}
          </button>
        </div>
        <div class="task-result-grid">
          ${fileIds.map(id => `
            <div class="task-result-item ${ratioClass}" data-file-id="${this.escapeAttr(id)}">
              <div class="task-result-thumb" data-result-id="${this.escapeAttr(id)}">
                <div class="task-result-placeholder">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
                </div>
              </div>
              <button class="task-result-download-btn" data-file-id="${this.escapeAttr(id)}" title="${t('tasks.downloadTitle')}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
              </button>
            </div>
          `).join('')}
        </div>`;
    } else {
      resultsHtml = `
        <div class="task-result-header">
          <span class="task-result-status ${statusClass}">${statusText}</span>
        </div>
        <div class="task-result-empty">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.3"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <p>${t('tasks.noResults')}</p>
        </div>`;
    }

    // Logs section
    const errorLog = this.task.error_message || '';
    const logsHtml = `
      <div class="task-result-logs">
        <div class="task-result-logs-header">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg>
          ${t('tasks.logsLabel')}
        </div>
        <div class="task-result-logs-body">
          ${errorLog ? `<div class="task-log-entry task-log-error">${this.escapeHtml(errorLog)}</div>` : `<div class="task-log-empty">${t('tasks.noLogs')}</div>`}
        </div>
      </div>`;

    return resultsHtml + logsHtml;
  }

  _bindResultsTab() {
    if (!this.overlay || !this.task) return;

    // Tab switching
    this.overlay.querySelectorAll('.task-modal-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this.overlay.querySelectorAll('.task-modal-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const tabName = tab.dataset.tab;
        const configTab = this.overlay.querySelector('#taskConfigTab');
        const resultsTab = this.overlay.querySelector('#taskResultsTab');
        if (tabName === 'config') {
          configTab?.classList.remove('hidden');
          resultsTab?.classList.add('hidden');
        } else {
          configTab?.classList.add('hidden');
          resultsTab?.classList.remove('hidden');
          this._loadResultThumbnails();
        }
      });
    });

    // Detect video task for download resolution
    const isVideoTask = this.task?.media_type === 'Video' || this.task?.gen_type === 'Video';
    const dlMediaType = isVideoTask ? 'video' : 'image';

    // Download all button — uses DownloadHelper.showModal() per item
    const downloadAllBtn = this.overlay.querySelector('#downloadAllResultsBtn');
    downloadAllBtn?.addEventListener('click', async () => {
      const fileIds = (this.task.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      if (fileIds.length === 0) return;
      const fileNames = this.task.result_file_names || {};

      // External provider (ChatGPT/Grok): download trực tiếp từ CDN URL trong result_thumbnails
      if (this._isExternalProvider()) {
        const savedThumbs = this.task.result_thumbnails || {};
        let okCount = 0, failCount = 0;
        for (let idx = 0; idx < fileIds.length; idx++) {
          const id = fileIds[idx];
          const thumbObj = savedThumbs[id];
          const url = (typeof thumbObj === 'object' && thumbObj?.thumbnail) ? thumbObj.thumbnail : (typeof thumbObj === 'string' ? thumbObj : '');
          if (!url) { failCount++; continue; }
          const isVid = (typeof thumbObj === 'object' && thumbObj?.type === 'video') || isVideoTask;
          const ext = isVid ? 'mp4' : 'png';
          const filename = await this._buildExternalFilename(this.task.prompt, idx + 1, ext);
          const ok = await this._downloadExternalUrl(url, filename);
          if (ok) okCount++; else failCount++;
        }
        const I = window.I18n;
        if (okCount > 0 && failCount === 0) {
          window.showNotification?.(
            I?.t('download.batchSuccess', { count: okCount }) || `Đã tải ${okCount} file`,
            'success', 2000);
        } else if (okCount > 0 && failCount > 0) {
          window.showNotification?.(
            I?.t('download.batchPartial', { ok: okCount, fail: failCount }) || `Tải được ${okCount} file, ${failCount} file lỗi`,
            'warning', 4000);
        } else if (failCount > 0) {
          // Tất cả fail — likely CDN URL expired (ChatGPT/Grok URL có expire 30-60 phút)
          window.showNotification?.(
            I?.t('tasks.downloadExpiredAll') || 'Không tải được file nào — URL CDN có thể đã hết hạn. Hãy chạy lại task để lấy URL mới.',
            'error', 5000);
        }
        return;
      }

      // Flow path (default): show modal chọn resolution
      // - Single file → showModal (per-item)
      // - Multiple files → showBatchModal (chọn 1 resolution → apply tất cả)
      if (window.DownloadHelper) {
        if (fileIds.length === 1) {
          DownloadHelper.showModal({
            tileId: fileIds[0],
            fileName: fileNames[fileIds[0]] || null,
            promptText: this.task.prompt || this.task.task_name || 'task',
            taskName: this.task.task_name || null,
            index: 1,
            mediaType: dlMediaType
          });
        } else {
          DownloadHelper.showBatchModal({
            tileIds: fileIds,
            fileNames: fileNames,
            promptText: this.task.prompt || this.task.task_name || 'task',
            taskName: this.task.task_name || null,
            mediaType: dlMediaType,
          });
        }
      }
    });

    // Per-item download buttons — use DownloadHelper.showModal()
    this.overlay.querySelectorAll('.task-result-download-btn').forEach((btn, idx) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const fileId = btn.dataset.fileId;
        if (!fileId) return;

        // External provider (ChatGPT/Grok): download trực tiếp CDN URL
        if (this._isExternalProvider()) {
          const savedThumbs = this.task.result_thumbnails || {};
          const thumbObj = savedThumbs[fileId];
          const url = (typeof thumbObj === 'object' && thumbObj?.thumbnail) ? thumbObj.thumbnail : (typeof thumbObj === 'string' ? thumbObj : '');
          if (!url) {
            window.showNotification?.(window.I18n?.t('tasks.downloadExpiredMsg') || 'URL không tồn tại — chạy lại task', 'error');
            return;
          }
          const isVid = (typeof thumbObj === 'object' && thumbObj?.type === 'video') || isVideoTask;
          const ext = isVid ? 'mp4' : 'png';
          const filename = await this._buildExternalFilename(this.task.prompt, idx + 1, ext);
          const ok = await this._downloadExternalUrl(url, filename);
          const I = window.I18n;
          if (ok) {
            window.showNotification?.(
              I?.t('download.downloading') || 'Đang tải xuống...',
              'success', 1500);
          }
          return;
        }

        // Flow path (default)
        const fileNames = this.task.result_file_names || {};
        const fileName = fileNames[fileId] || null;
        if (window.DownloadHelper) {
          DownloadHelper.showModal({
            tileId: fileId,
            fileName: fileName,
            promptText: this.task.prompt || this.task.task_name || 'task',
            taskName: this.task.task_name || null,
            index: idx + 1,
            mediaType: dlMediaType
          });
        } else if (window.MessageBridge) {
          const resolution = isVideoTask
            ? (this.task.video_download_resolution || '720p')
            : (this.task.download_resolution || '1k');
          window.MessageBridge.downloadTileMedia(fileId, null, this.task.task_name || 'task', fileName, resolution).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskModal#_downloadExternalUrl', _e); });
        }
      });
    });
  }

  /**
   * Detect task có dùng external provider (ChatGPT/Grok) không.
   * Synthetic ID `cg_xxx` / `grok_xxx` không tồn tại trong Flow DOM nên KHÔNG được
   * gọi Flow API (`getThumbnailsByIds`, `downloadTileMedia`) — sẽ fail silently
   * và xóa data nhầm.
   */
  _isExternalProvider() {
    const p = this.task?.provider;
    return p === 'chatgpt' || p === 'grok';
  }

  /**
   * Download CDN URL của ChatGPT/Grok task result.
   * Synthetic ID không hợp lệ với Flow downloadTileMedia → phải fetch URL → blob →
   * chrome.downloads. Ưu tiên fetch qua session tab (cookie auth) để bypass signature.
   *
   * @param {string} url - URL CDN (chatgpt-cdn / assets.grok.com)
   * @param {string} filename - Tên file đích (đầy đủ path subfolder/filename.ext)
   * @returns {Promise<boolean>} true nếu download started thành công
   */
  async _downloadExternalUrl(url, filename) {
    if (!url || !filename) return false;
    const provider = this.task?.provider;
    let resp = null;

    // 1. Ưu tiên fetch qua session tab (cookie + signature đầy đủ)
    try {
      if (provider === 'grok' && window.GrokSession?.getTabInfo && window.MessageBridge?.grokFetchImage) {
        const info = await window.GrokSession.getTabInfo();
        if (info?.tabId) resp = await window.MessageBridge.grokFetchImage(url, info.tabId).catch(() => null);
      } else if (provider === 'chatgpt' && window.ChatGPTSession?.getTabInfo && window.MessageBridge?.chatGPTFetchImage) {
        const info = await window.ChatGPTSession.getTabInfo();
        if (info?.tabId) resp = await window.MessageBridge.chatGPTFetchImage(url, info.tabId).catch(() => null);
      }
    } catch (_) { resp = null; }

    // 2. Fallback: background.js fetchBlob (bypass CORS — không có cookie session)
    if (!resp?.success || !resp.base64) {
      resp = await new Promise(r => {
        chrome.runtime.sendMessage({ action: 'fetchBlob', url }, r);
      }).catch(() => null);
    }

    if (!resp?.success || !resp.base64) {
      // Tier 3: fetch fail (grok video mp4 CORS net::ERR_FAILED / HTTP2) → download URL TRỰC TIẾP qua
      // chrome.downloads. Browser download manager fetch native (gửi cookie + bypass CORS); áp cho cả
      // grok lẫn chatgpt. onDeterminingFilename apply rename vì byExtensionId === chrome.runtime.id.
      const _t3Url = await (window.scrubbedDownloadUrl?.(url) ?? url);
      const _t3 = await new Promise((resolve) => {
        try { chrome.runtime.sendMessage({ action: 'chromeDownload', url: _t3Url, filename }, (r) => resolve(r)); }
        catch (e) { resolve({ success: false, error: e.message }); }
      });
      if (_t3?.success) return true;
      window.showNotification?.(
        window.I18n?.t('tasks.downloadExpiredMsg') || 'Không tải được file. URL có thể hết hạn — chạy lại task để cập nhật.',
        'error'
      );
      return false;
    }

    // 3. Convert base64 → blob → blobUrl → chrome.downloads
    try {
      const blob = await (await fetch(resp.base64)).blob();
      const blobUrl = URL.createObjectURL(blob);
      const _dlUrl = await (window.scrubbedDownloadUrl?.(blobUrl) ?? blobUrl);
      await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: 'chromeDownload', url: _dlUrl, filename }, () => resolve());
      });
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
      return true;
    } catch (err) {
      console.warn('[TaskModal] _downloadExternalUrl convert error:', err);
      return false;
    }
  }

  /**
   * Build filename theo template settings.
   * Reuse helper GenTab._buildChatGPTFilename nếu có, fallback simple format.
   */
  async _buildExternalFilename(prompt, urlIdx, ext) {
    const _dlSet = await window.DownloadHelper.getSettings();
    const folder = _dlSet.folder;
    const template = _dlSet.template;
    const taskName = this.task?.task_name || null;

    if (window.GenTab?._buildChatGPTFilename) {
      let fname = window.GenTab._buildChatGPTFilename(
        template,
        window._currentProjectName || 'flow',
        prompt || this.task?.prompt || this.task?.task_name || 'task',
        1, urlIdx, '', taskName, folder
      );
      // Replace extension nếu helper trả PNG default mà task là video
      if (ext === 'mp4' && fname.endsWith('.png')) {
        fname = fname.replace(/\.png$/i, '.mp4');
      }
      return fname;
    }
    // Fallback simple
    const subfolder = taskName ? `${taskName}/` : '';
    return `${folder}/${subfolder}result_${Date.now()}_${urlIdx}.${ext}`;
  }

  _loadResultThumbnails() {
    if (!this.overlay) return;

    const thumbs = this.overlay.querySelectorAll('.task-result-thumb[data-result-id]');
    if (thumbs.length === 0) return;

    const savedThumbs = this.task?.result_thumbnails || {};
    const missingIds = [];
    const expiredFileIds = [];
    const isExternal = this._isExternalProvider();

    // Detect video task — external provider có thể có type='video' trong thumbnail object
    const isVideoTask = this.task?.media_type === 'Video' || this.task?.gen_type === 'Video';

    // Render từ saved thumbnails trước, collect missing
    thumbs.forEach(el => {
      const fileId = el.dataset.resultId;
      const thumbRaw = savedThumbs[fileId];
      const thumbUrl = (typeof thumbRaw === 'object' && thumbRaw?.thumbnail) ? thumbRaw.thumbnail : (typeof thumbRaw === 'string' ? thumbRaw : '');
      const isVideo = (typeof thumbRaw === 'object' && thumbRaw?.type === 'video') || isVideoTask;
      if (thumbUrl) {
        el.innerHTML = '';
        if (isVideo) {
          const video = document.createElement('video');
          video.src = thumbUrl;
          video.muted = true;
          video.loop = true;
          video.autoplay = true;
          video.playsInline = true;
          video.onerror = () => {
            // External provider (ChatGPT/Grok): URL CDN có signature TTL hết hạn → render
            // placeholder "Hết hạn", KHÔNG xóa khỏi storage, KHÔNG gọi Flow API.
            if (isExternal) {
              this._renderExpiredPlaceholder(el);
              return;
            }
            expiredFileIds.push(fileId);
            el.dataset.expired = 'true';
            this._refreshExpiredThumbnails(expiredFileIds);
          };
          el.appendChild(video);
        } else {
          const img = document.createElement('img');
          img.alt = 'result';
          img.src = thumbUrl;
          img.onerror = () => {
            if (isExternal) {
              this._renderExpiredPlaceholder(el);
              return;
            }
            expiredFileIds.push(fileId);
            el.dataset.expired = 'true';
            this._refreshExpiredThumbnails(expiredFileIds);
          };
          el.appendChild(img);
        }
      } else {
        missingIds.push(fileId);
        // Show loading shimmer
        el.innerHTML = '<div class="task-result-shimmer"></div>';
      }
    });

    // External provider: synthetic ID (cg_xxx/grok_xxx) không tồn tại trong Flow DOM →
    // SKIP `getThumbnailsByIds` (Flow-only API). Render placeholder cho các missing thumb.
    if (isExternal && missingIds.length > 0) {
      thumbs.forEach(el => {
        if (missingIds.includes(el.dataset.resultId)) {
          this._renderExpiredPlaceholder(el);
        }
      });
      return;
    }

    // Fetch missing thumbnails trực tiếp theo file IDs (chỉ Flow path)
    if (missingIds.length > 0 && typeof MessageBridge !== 'undefined') {
      MessageBridge.getThumbnailsByIds(missingIds).then(result => {
        const results = result?.results || {};
        const newThumbs = { ...savedThumbs };
        let changed = false;

        thumbs.forEach(el => {
          const fileId = el.dataset.resultId;
          if (!missingIds.includes(fileId)) return;
          const info = results[fileId];
          if (info?.thumbnail) {
            el.innerHTML = `<img src="${this.safeThumbSrc(info.thumbnail)}" alt="result" />`;
            newThumbs[fileId] = info.thumbnail;
            changed = true;
          } else {
            el.innerHTML = '<div class="task-result-placeholder"><span style="font-size:10px;opacity:.5">N/A</span></div>';
          }
        });

        if (changed && this.task) {
          this.task.result_thumbnails = newThumbs;
          if (window.storageManager) {
            window.storageManager.saveTask(this.task).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskModal#_refreshExpiredThumbnails', _e); });
          }
        }
      }).catch(() => {
        // Fallback: remove shimmer
        thumbs.forEach(el => {
          if (el.querySelector('.task-result-shimmer')) {
            el.innerHTML = '<div class="task-result-placeholder"><span style="font-size:10px;opacity:.5">N/A</span></div>';
          }
        });
      });
    }
  }

  /**
   * Render placeholder "URL hết hạn" cho external provider (ChatGPT/Grok).
   * Khác placeholder "N/A" — KHÔNG xóa thumbnail khỏi storage, gợi ý user chạy lại task.
   */
  _renderExpiredPlaceholder(el) {
    if (!el) return;
    el.innerHTML = `
      <div class="task-result-placeholder" style="display:flex;flex-direction:column;align-items:center;gap:4px;font-size:10px;opacity:.6;text-align:center;padding:8px;">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span>URL hết hạn</span>
        <span style="opacity:.5;font-size:9px;">Chạy lại task để tải</span>
      </div>`;
  }

  /**
   * Re-scan Flow khi phát hiện thumbnail URLs hết hạn
   * Debounce để gộp nhiều onerror thành 1 lần scan
   */
  _refreshExpiredThumbnails(expiredFileIds) {
    // External provider (ChatGPT/Grok): synthetic ID không tồn tại trong Flow DOM →
    // SKIP toàn bộ refresh logic. Caller đã render placeholder qua _renderExpiredPlaceholder.
    if (this._isExternalProvider()) return;
    if (this._refreshTimer) clearTimeout(this._refreshTimer);
    this._refreshTimer = setTimeout(() => {
      if (!this.overlay || typeof MessageBridge === 'undefined') return;
      const fileIdsToRefresh = [...new Set(expiredFileIds)];
      expiredFileIds.length = 0;

      // Show shimmer on expired thumbs
      this.overlay.querySelectorAll('.task-result-thumb[data-expired="true"]').forEach(el => {
        el.innerHTML = '<div class="task-result-shimmer"></div>';
      });

      MessageBridge.getThumbnailsByIds(fileIdsToRefresh).then(result => {
        const results = result?.results || {};
        const newThumbs = { ...(this.task?.result_thumbnails || {}) };
        let changed = false;

        this.overlay.querySelectorAll('.task-result-thumb[data-expired="true"]').forEach(el => {
          const fileId = el.dataset.resultId;
          const info = results[fileId];
          if (info?.thumbnail) {
            el.innerHTML = `<img src="${this.safeThumbSrc(info.thumbnail)}" alt="result" />`;
            el.removeAttribute('data-expired');
            newThumbs[fileId] = info.thumbnail;
            changed = true;
          } else {
            el.innerHTML = '<div class="task-result-placeholder"><span style="font-size:10px;opacity:.5">N/A</span></div>';
            el.removeAttribute('data-expired');
            delete newThumbs[fileId];
            changed = true;
          }
        });

        if (changed && this.task) {
          this.task.result_thumbnails = newThumbs;
          if (window.storageManager) {
            window.storageManager.saveTask(this.task).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskModal#_initTaskAddonPrompts', _e); });
          }
        }
      }).catch(() => {
        this.overlay?.querySelectorAll('.task-result-thumb[data-expired="true"]').forEach(el => {
          el.innerHTML = '<div class="task-result-placeholder"><span style="font-size:10px;opacity:.5">N/A</span></div>';
          el.removeAttribute('data-expired');
        });
      });
    }, 500);
  }

  // ========== Addon Prompts ==========

  async _initTaskAddonPrompts() {
    // TTL 1h — admin update addon-prompts không có SSE event, dùng TTL fallback
    const TTL_MS = 60 * 60 * 1000;
    let addons = [];
    // Local/offline: endpoint 'addon-prompts' không tồn tại → dùng style bundled sẵn
    // (giống GenTab._fetchAddonPromptsFromApi). Không có gate này thì list style rỗng offline.
    if (self.SEOSONA_LOCAL_MODE !== false) {
      this._addonPrompts = window.SEOSONA_STYLES || [];
      this._renderAddonPromptList();
      if (this.task?.addon_prompt_id) {
        this._selectedAddonPromptId = this.task.addon_prompt_id;
        this._updateAddonTriggerLabel();
      }
      const t = this.overlay?.querySelector('#taskAddonPromptTrigger');
      if (t) {
        t.addEventListener('click', (e) => {
          e.stopPropagation();
          this._openTaskStyleSelectModal?.();
        });
      }
      return;
    }
    try {
      const cached = await new Promise(resolve => {
        chrome.storage.local.get(['af_addon_prompts'], r => resolve(r.af_addon_prompts));
      });
      const isFresh = cached?.data && cached?.timestamp && (Date.now() - cached.timestamp) < TTL_MS;
      if (isFresh) {
        addons = cached.data;
      } else {
        const resp = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: 'apiRequest', method: 'GET', endpoint: 'addon-prompts' }, resolve);
        });
        if (resp?.success && Array.isArray(resp.data)) {
          addons = resp.data;
          chrome.storage.local.set({ af_addon_prompts: { data: addons, timestamp: Date.now() } });
        } else if (cached?.data) {
          addons = cached.data;
        }
      }
    } catch (e) {
      console.warn('[TaskModal] Load addon prompts failed:', e);
    }
    this._addonPrompts = addons;

    this._renderAddonPromptList();

    // Restore saved selection
    if (this.task?.addon_prompt_id) {
      this._selectedAddonPromptId = this.task.addon_prompt_id;
      this._updateAddonTriggerLabel();
    }

    // Use StyleSelectModal instead of inline popup
    const trigger = this.overlay?.querySelector('#taskAddonPromptTrigger');
    if (trigger) {
      trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openTaskStyleSelectModal();
      });
    }
  }

  /**
   * Open StyleSelectModal for addon prompt selection
   */
  _openTaskStyleSelectModal() {
    if (!window.StyleSelectModal) {
      console.warn('[TaskModal] StyleSelectModal not loaded');
      return;
    }

    window.StyleSelectModal.show({
      addons: this._addonPrompts || [],
      selectedId: this._selectedAddonPromptId || null,
      onSelect: (addon) => {
        this._selectedAddonPromptId = addon?.id ? String(addon.id) : null;
        this._updateAddonTriggerLabel();
      }
    });
  }

  _renderAddonPromptList(filter = '') {
    const list = this.overlay?.querySelector('#taskAddonPromptList');
    if (!list) return;

    const filterLower = filter.toLowerCase();
    let html = `<div class="addon-prompt-item none-option ${!this._selectedAddonPromptId ? 'selected' : ''}" data-id="">
      <span class="addon-prompt-name">${t('tasks.noStyleSelected')}</span>
    </div>`;

    for (const addon of (this._addonPrompts || [])) {
      if (filterLower && !(addon.name || '').toLowerCase().includes(filterLower)) continue;
      const isSelected = this._selectedAddonPromptId === String(addon.id);
      const thumb = addon.thumbnail_url
        ? `<img class="addon-prompt-thumb" src="${this.escapeAttr(addon.thumbnail_url)}" alt="${this.escapeAttr(addon.name)}" loading="lazy" />`
        : `<div class="addon-prompt-thumb-placeholder"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454z"></path></svg></div>`;
      html += `<div class="addon-prompt-item ${isSelected ? 'selected' : ''}" data-id="${addon.id}">
        ${thumb}
        <div class="addon-prompt-info"><div class="addon-prompt-name">${this.escapeHtml(addon.name || t('tasks.noStyleName'))}</div></div>
      </div>`;
    }
    list.innerHTML = html;

    list.querySelectorAll('.addon-prompt-item').forEach(item => {
      item.addEventListener('click', () => {
        this._selectedAddonPromptId = item.dataset.id || null;
        this._updateAddonTriggerLabel();
        list.querySelectorAll('.addon-prompt-item').forEach(i => i.classList.remove('selected'));
        item.classList.add('selected');
        this.overlay?.querySelector('#taskAddonPromptPopup')?.classList.add('hidden');
      });
    });
  }

  _updateAddonTriggerLabel() {
    const label = this.overlay?.querySelector('#taskAddonPromptTrigger .addon-prompt-label');
    if (!label) return;
    if (this._selectedAddonPromptId) {
      const addon = (this._addonPrompts || []).find(a => String(a.id) === String(this._selectedAddonPromptId));
      label.textContent = addon?.name || t('tasks.styleLabel');
    } else {
      label.textContent = t('tasks.styleLabel');
    }
  }

  _getSelectedAddonPrompt() {
    if (!this._selectedAddonPromptId) return null;
    return (this._addonPrompts || []).find(a => String(a.id) === String(this._selectedAddonPromptId)) || null;
  }

  // ========== @Mention Autocomplete ==========

  _initMentionAutocomplete() {
    const textarea = this.overlay?.querySelector('#taskPrompt');
    if (!textarea) return;

    let dropdown = this.overlay?.querySelector('#taskMentionAutocomplete');
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.id = 'taskMentionAutocomplete';
      dropdown.className = 'mention-autocomplete-dropdown';
      dropdown.style.display = 'none';
      // Append to overlay (not modal-body) so scroll doesn't clip it
      this.overlay.appendChild(dropdown);
    }
    // Block tất cả mouse/click events trên dropdown để không propagate lên overlay
    ['mousedown', 'mouseup', 'click', 'pointerdown', 'pointerup'].forEach(evt => {
      dropdown.addEventListener(evt, (e) => e.stopPropagation());
    });

    this._mentionDropdown = dropdown;
    this._mentionIndex = -1;

    textarea.addEventListener('input', () => this._handleMentionInput(textarea));
    textarea.addEventListener('keydown', (e) => this._handleMentionKeydown(e, textarea));
    // Hide dropdown on modal body scroll (fixed position won't follow)
    this.overlay.querySelector('.task-modal-body')?.addEventListener('scroll', () => this._hideMentionDropdown());
    textarea.addEventListener('blur', () => {
      setTimeout(() => this._hideMentionDropdown(), 150);
    });
  }

  _handleMentionInput(textarea) {
    // UX guard (2026-05-02): Mention dropdown CHỈ work khi user chọn ref_image_mode = 'mention'.
    // Các mode khác (all/sequential/none) gõ @ không trigger dropdown để tránh confuse.
    const refMode = this.overlay?.querySelector('#taskRefImageMode')?.value || 'all';
    if (refMode !== 'mention') { this._hideMentionDropdown(); return; }

    const text = textarea.value;
    const pos = textarea.selectionStart;
    const beforeCursor = text.substring(0, pos);
    const match = beforeCursor.match(/@([a-zA-Z0-9_]*)$/);

    if (!match) { this._hideMentionDropdown(); return; }

    const query = match[1].toLowerCase();

    // BUG FIX (2026-05-02): Trước đây gom ALL values từ `_refImageNames` +
    // `task.ref_image_names` mà KHÔNG filter theo current ref_file_ids → names của
    // ref images đã xóa vẫn hiện trong dropdown (vd task chỉ có 2 ref nhưng dropdown
    // show 5 names). Fix: filter theo current taskFileIds (giống GenTab pattern).
    const fileIdsInput = this.overlay?.querySelector('#taskFileIds');
    const currentIds = fileIdsInput?.value
      ? fileIdsInput.value.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // Resolve name cho mỗi current ID: ưu tiên _refImageNames (in-memory, có thể vừa edit),
    // fallback task.ref_image_names (saved trong DB).
    // Build entries [name, fileId, thumbnail] để render dropdown với thumbnail bên trái.
    const savedNames = this.task?.ref_image_names || {};
    const seenNames = new Set();
    const entries = [];
    for (const fid of currentIds) {
      const name = this._refImageNames?.[fid] || savedNames[fid];
      if (!name || seenNames.has(name)) continue;
      if (!name.toLowerCase().includes(query)) continue;
      seenNames.add(name);
      // Thumbnail: ưu tiên _taskTileCache (current session), fallback task.ref_thumbnails (saved)
      const cached = this._taskTileCache?.[fid];
      const cachedThumb = (cached && typeof cached === 'object') ? cached.thumbnail : (typeof cached === 'string' ? cached : null);
      const savedThumb = this.task?.ref_thumbnails?.[fid];
      const thumb = cachedThumb || savedThumb || null;
      entries.push({ name, fileId: fid, thumb });
      if (entries.length >= 8) break;
    }

    if (entries.length === 0) { this._hideMentionDropdown(); return; }

    this._mentionIndex = 0;
    this._mentionNames = entries.map(e => e.name);
    this._mentionStart = pos - match[1].length - 1;

    const dropdown = this._mentionDropdown;
    if (!dropdown) return;
    dropdown.innerHTML = entries.map((entry, i) => {
      const thumbHtml = entry.thumb
        ? `<img class="mention-autocomplete-thumb" src="${this.escapeAttr(entry.thumb)}" alt="" />`
        : '<span class="mention-autocomplete-thumb mention-autocomplete-thumb-placeholder"></span>';
      return `<div class="mention-autocomplete-item ${i === 0 ? 'selected' : ''}" data-name="${this.escapeAttr(entry.name)}">${thumbHtml}<span class="mention-autocomplete-name">@${this.escapeHtml(entry.name)}</span></div>`;
    }).join('');
    dropdown.style.display = 'block';

    // UX (2026-05-02): Position dropdown ngay BÊN DƯỚI caret (giống Twitter/Slack/Discord
    // mention) thay vì dưới full textarea. Dùng "mirror div" technique compute caret
    // coords trong textarea.
    const caret = TaskModal._getTextareaCaretCoords(textarea);
    const taRect = textarea.getBoundingClientRect();
    // Ưu tiên đặt bên dưới caret. Nếu sẽ vượt viewport bottom → đặt phía trên caret.
    const dropdownMaxHeight = 200;
    const spaceBelow = window.innerHeight - caret.bottom;
    const placeAbove = spaceBelow < dropdownMaxHeight && caret.top > dropdownMaxHeight;
    // Clamp left bên trong textarea bounds (tránh overflow ngang khi caret gần mép phải)
    const dropdownWidth = 240;
    let left = Math.max(taRect.left, Math.min(caret.left, taRect.right - dropdownWidth));
    dropdown.style.position = 'fixed';
    dropdown.style.left = `${left}px`;
    dropdown.style.top = placeAbove
      ? `${caret.top - dropdownMaxHeight - 4}px`
      : `${caret.bottom + 2}px`;
    dropdown.style.width = `${dropdownWidth}px`;
    dropdown.style.minWidth = `${dropdownWidth}px`;
    dropdown.style.zIndex = '10000010';

    dropdown.querySelectorAll('.mention-autocomplete-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._selectMention(textarea, item.dataset.name);
      });
    });
  }

  _handleMentionKeydown(e, textarea) {
    const dropdown = this._mentionDropdown;
    if (!dropdown || dropdown.style.display === 'none') return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._mentionIndex = Math.min(this._mentionIndex + 1, (this._mentionNames?.length || 1) - 1);
      this._updateMentionSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._mentionIndex = Math.max(this._mentionIndex - 1, 0);
      this._updateMentionSelection();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (this._mentionNames?.length > 0) {
        e.preventDefault();
        this._selectMention(textarea, this._mentionNames[this._mentionIndex]);
      }
    } else if (e.key === 'Escape') {
      e.stopPropagation(); // Prevent ESC from closing modal when dropdown visible
      this._hideMentionDropdown();
    }
  }

  _updateMentionSelection() {
    this._mentionDropdown?.querySelectorAll('.mention-autocomplete-item').forEach((item, i) => {
      item.classList.toggle('selected', i === this._mentionIndex);
    });
  }

  _selectMention(textarea, name) {
    const text = textarea.value;
    const before = text.substring(0, this._mentionStart);
    const after = text.substring(textarea.selectionStart);
    textarea.value = `${before}@${name} ${after}`;
    textarea.selectionStart = textarea.selectionEnd = this._mentionStart + name.length + 2;
    textarea.focus();
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    // Recapture snapshot — mention insert is auto-assist, not user manual edit
    this._formSnapshot = this._captureFormSnapshot();
    // Track mention selection time — slow click (>50ms hold) causes dropdown to hide
    // before mouseup, making click event target the overlay instead of dropdown
    this._lastMentionSelectTime = Date.now();
    // Delay hide để click event kết thúc trên dropdown (không click-through xuống overlay)
    setTimeout(() => this._hideMentionDropdown(), 50);
  }

  _hideMentionDropdown() {
    if (this._mentionDropdown) this._mentionDropdown.style.display = 'none';
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

  // ========== Ref Mode UI ==========

  _updateRefModeUI() {
    const modeSelect = this.overlay?.querySelector('#taskRefImageMode');
    const mentionHelper = this.overlay?.querySelector('#taskMentionHelper');
    if (!modeSelect) return;

    const mode = modeSelect.value;

    // Fix 1: mode='none' → ẩn toàn bộ UI ref (toolbar, preview, count, mention)
    // Đồng bộ với GenTab `.ref-mode-disabled`. Container = #taskRefImagesGroup.
    const refImagesGroup = this.overlay?.querySelector('#taskRefImagesGroup');
    if (refImagesGroup) {
      refImagesGroup.classList.toggle('task-ref-mode-disabled', mode === 'none');
    }
    // Mention helper container nằm NGOÀI group → toggle riêng
    if (mentionHelper) {
      mentionHelper.classList.toggle('hidden', mode !== 'mention' || mode === 'none');
    }
    if (mode === 'mention') {
      this._refreshMentionHelper();
    }

    // Ẩn/hiện ref limit hint (chỉ cho mention mode)
    const refLimitHint = this.overlay?.querySelector('#taskRefLimitHint');
    const refLimitHintText = this.overlay?.querySelector('#taskRefLimitHintText');
    if (refLimitHint && refLimitHintText) {
      if (mode === 'mention') {
        // Lấy max_ref_images từ provider
        const provider = (this.task?.provider || this.overlay?.querySelector('#taskProvider')?.value || 'flow').toLowerCase();
        const mediaType = this.overlay?.querySelector('#taskMediaType')?.value || 'Image';
        const grokMode = (this.task?.grok_mode || mediaType).toLowerCase();
        const resolvedMode = provider === 'grok' ? grokMode : mediaType.toLowerCase();
        const isFrames = resolvedMode === 'video' && String(this.task?.video_input_type || '').toLowerCase() === 'frames';
        const _hintModel = this.task?.model
          || this.overlay?.querySelector('#taskVideoModel')?.value
          || this.overlay?.querySelector('#taskImageModel')?.value
          || '';
        const maxRef = (typeof ImagePickerModal !== 'undefined' && ImagePickerModal.resolveMaxSelections)
          ? ImagePickerModal.resolveMaxSelections({ provider, mode: resolvedMode, isFrames, modelValue: _hintModel })
          : null;
        // maxRef === 0 → model không hỗ trợ ref → hiển thị '0' rõ ràng, không "?"
        const limitText = (maxRef === 0) ? '0' : (maxRef || '?');
        refLimitHintText.textContent = window.I18n?.t?.('gen.refLimitHint', { max: limitText })
          || `Max ${limitText} ref images per prompt. Use @image_name in prompt.`;
        refLimitHint.classList.remove('hidden');
      } else {
        refLimitHint.classList.add('hidden');
      }
    }

    // Re-render preview to toggle mention mode name labels
    this._renderTaskRefPreview();
    this._updateDragHint();
  }

  _refreshMentionHelper() {
    const tagsContainer = this.overlay?.querySelector('#taskMentionHelperTags');
    if (!tagsContainer) return;

    const fileIdsInput = this.overlay?.querySelector('#taskFileIds');
    const ids = (fileIdsInput?.value || '').split(',').map(s => s.trim()).filter(Boolean);

    let html = '';
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const pending = window.pendingUploadFiles?.get(id);
      const name = this._refImageNames[id] || this.task?.ref_image_names?.[id] || pending?.mentionName || this._taskTileCache?.[id]?.mentionName || `img_${i + 1}`;
      // Lookup thumbnail: pending upload → task tile cache → GenTab cache (cross-module)
      const thumbnail = pending?.thumbnail
        || this._taskTileCache?.[id]?.thumbnail
        || window.GenTab?.thumbnailCache?.[id]
        || '';
      const thumbHtml = thumbnail
        ? `<img class="ref-mention-tag-thumb" src="${this.escapeAttr(thumbnail)}" alt="" />`
        : '';
      html += `<span class="ref-mention-tag" data-name="${this.escapeAttr(name)}">${thumbHtml}<span>@${this.escapeHtml(name)}</span></span>`;
    }
    tagsContainer.innerHTML = html || `<span style="opacity:0.5;font-size:11px;">${t('tasks.noImages')}</span>`;

    // Bind click to insert @name at cursor
    tagsContainer.querySelectorAll('.ref-mention-tag').forEach(tag => {
      tag.style.cursor = 'pointer';
      tag.addEventListener('click', () => {
        const name = tag.dataset.name;
        if (!name) return;
        const textarea = this.overlay?.querySelector('#taskPrompt');
        if (!textarea) return;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const mention = `@${name} `;
        textarea.value = text.substring(0, start) + mention + text.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + mention.length;
        textarea.focus();
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  escapeAttr(text) {
    return String(text || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /**
   * Validate a thumbnail URL: only allow http(s), data:image/, or blob: schemes.
   * Returns the attr-escaped URL if valid, else '' (renders a broken/no image
   * instead of injecting an arbitrary src). Prevents markup/CSS injection via
   * server-supplied thumbnail strings.
   */
  safeThumbSrc(url) {
    const s = String(url || '').trim();
    if (!/^(https?:|data:image\/|blob:)/i.test(s)) return '';
    return this.escapeAttr(s);
  }
}

// Export
window.TaskModal = TaskModal;
