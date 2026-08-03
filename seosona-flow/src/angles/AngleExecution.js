/**
 * AngleExecution - Xử lý thực thi prompt và quản lý kết quả cho Angles feature
 *
 * Standalone class, AngleEditor khởi tạo: this.execution = new AngleExecution(this);
 * Sử dụng MessageBridge để giao tiếp với content script trên Google Flow.
 */
class AngleExecution {
  constructor(editor) {
    this.editor = editor;
    this._tileCache = editor._tileCache || new Map();
    this._isRunning = false;
    this._shouldStop = false;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _log(...args) {
    console.log('[AngleEditor]', ...args);
  }

  async _getGenDefaults() {
    if (this._genDefaults) return this._genDefaults;
    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['af_settings'], r => resolve(r.af_settings || {}));
      });
      this._genDefaults = {
        genType: result.defaultGenType || 'Image',
        ratio: result.defaultRatio || '9:16',
        // Strict Server-Only: user pref → ModelRegistry → null.
        imageModel: result.defaultImageModel || window.ModelRegistry?.getDefault('flow', 'image') || null,
        videoModel: result.defaultVideoModel || window.ModelRegistry?.getDefault('flow', 'video') || null
      };
    } catch (e) {
      this._genDefaults = {
        genType: 'Image', ratio: '9:16',
        imageModel: window.ModelRegistry?.getDefault('flow', 'image') || null,
        videoModel: window.ModelRegistry?.getDefault('flow', 'video') || null
      };
    }
    if (!this._genDefaults.imageModel) console.debug('[Tier3] AngleExecution._getGenDefaults: flow.image default model cache miss');
    if (!this._genDefaults.videoModel) console.debug('[Tier3] AngleExecution._getGenDefaults: flow.video default model cache miss');
    return this._genDefaults;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _getSettingMs(key, fallback) {
    const s = window.storageSettings?.getSettings() || {};
    return s[key] || fallback;
  }

  /**
   * Lấy download resolution từ settings (image default '1k')
   * Fallback đến StorageSettings cho popup windows (angles-editor.html)
   */
  _getDownloadResolution() {
    // DOM element (sidePanel) → StorageSettings cache (popup window) → default
    const el = document.getElementById('genTabDownloadResolution');
    if (el?.value) return el.value;
    const s = window.storageSettings?.getSettings?.() || {};
    return s.downloadResolution || '1k';
  }

  // ---------------------------------------------------------------------------
  // L4: Execution
  // ---------------------------------------------------------------------------

  /**
   * Main execution flow - tạo ảnh từ angle state
   * @param {Object} state - { rotation, tilt, zoom, preset, refImageId }
   * @returns {Promise<{fileIds: string[], duration: number}>}
   */
  async runGeneration(state) {
    const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;

    // 1. Validate
    if (!state.refImageId) {
      throw new Error(t('angles.errorNoRefImage'));
    }
    if (!state.preset || !state.preset.base_prompt) {
      throw new Error(t('angles.errorNoPreset'));
    }
    if (this._isRunning) {
      throw new Error(t('angles.errorRunning'));
    }

    // GP-6.3 / GP-6.4: Check global quota warning/exhausted
    if (window.featureGate) {
      const quotaCheck = window.featureGate.checkGlobalQuotaWarning('Angles');
      if (quotaCheck.exhausted) {
        throw new Error(t('angles.errorQuotaExhausted'));
      }
    }

    // UA-3.4: Theo doi bat dau angles generation
    window.UsageSync?.trackEvent('angles_start', { preset_id: state.preset?.id });

    // 2. Check ExecutionLock
    if (window.ExecutionLock) {
      if (ExecutionLock.isBlockedBy('angles')) {
        const shouldStop = await ExecutionLock.showBlockedDialog('angles');
        if (!shouldStop) return null;
        await ExecutionLock.stopCurrent();
      }
      const acquired = ExecutionLock.acquire('angles', 'Angles generation');
      if (!acquired) {
        throw new Error(t('angles.errorFlowBusy'));
      }
    }

    // Activate Flow tab when execution starts (popup windows need this)
    try {
      await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }, () => resolve());
      });
    } catch (e) {
      console.warn('[AngleExecution] ensureFlowTabActive failed:', e.message);
    }

    this._isRunning = true;
    this._shouldStop = false;
    this._currentExecutionToken = null;
    const startTime = Date.now();

    // SP-2.6: ExecutionGate - xin phep server truoc khi chay angles
    if (window.ExecutionGate) {
      try {
        const gate = await ExecutionGate.request('angles_run', 1, { owner: 'angles', label: 'Angles' });
        if (!gate.allowed) {
          this._isRunning = false;
          if (window.ExecutionLock) ExecutionLock.release('angles');
          ExecutionGate.showDeniedDialog(gate, 'Angles');
          const errMsg = gate.reason === 'QUOTA_EXCEEDED'
            ? t('angles.errorQuotaExceededModule')
            : gate.reason === 'MODULE_DISABLED' || gate.reason === 'FEATURE_LOCKED'
              ? t('angles.errorFeatureLocked')
              : t('angles.errorNotAllowed');
          throw new Error(errMsg);
        }
        this._currentExecutionToken = gate.token;
      } catch (e) {
        const isQuotaByCode = window.QuotaErrorHandler?.isQuotaError(e);
        const isQuotaByMessage = e.message?.includes('hết lượt') || e.message?.includes('bị khóa') || e.message?.includes('Không được phép');
        if (isQuotaByCode || isQuotaByMessage) {
          if (isQuotaByCode && !isQuotaByMessage) {
            window.QuotaErrorHandler?.showDialog(e, 'Angles');
          }
          this._isRunning = false;
          if (window.ExecutionLock) ExecutionLock.release('angles');
          throw e;
        }
        console.error('[AngleExecution] ExecutionGate request failed, proceeding:', e.message);
      }
    }

    // Chuyển sang pipeline PromptQueue nếu bật
    if (window.PromptQueue && PromptQueue.isEnabled()) {
      try {
        const builtPrompt = this._buildPrompt(state);
        if (!builtPrompt) {
          throw new Error(window.I18n?.t('angles.errorBuildPrompt') || 'Không thể tạo prompt từ preset và thông số góc');
        }
        const genDefaults = await this._getGenDefaults();
        const submitPromise = PromptQueue.getInstance().submitJob({
          owner: 'angles',
          label: 'Angles',
          prompts: [builtPrompt],
          settings: {
            genType: state.preset.media_type || genDefaults.genType,
            ratio: state.ratio || state.preset.ratio || genDefaults.ratio,
            model: state.model || state.preset.model || genDefaults.imageModel,
            quantity: 1,
          },
          refFileIds: state.refImageId ? [state.refImageId] : [],
          refFileNames: state.refFileName ? { [state.refImageId]: state.refFileName } : {},
          taskName: 'angles',
          _executionToken: this._currentExecutionToken, // Pass token to PromptQueue
        });

        // Fire callback ngay sau khi job đã enqueue (unlock controls cho user)
        // Pipeline sẽ tự submit prompt, không cần giữ controls locked
        if (typeof this._onSubmittedCallback === 'function') {
          try { this._onSubmittedCallback(); } catch (e) { /* ignore */ }
        }

        // Allow user to start another generation immediately after submit
        // (không cần chờ kết quả trả về - giống non-pipeline mode)
        this._isRunning = false;

        const result = await submitPromise;
        this._log(`Pipeline Angles hoàn tất: ${result.completed} thành công, ${result.failed} thất bại`);

        // Extract result data từ pipeline
        const resultTileIds = result.resultTileIds || [];
        const resultThumbnails = {};
        if (result.resultThumbnails) {
          for (const [tid, info] of Object.entries(result.resultThumbnails)) {
            if (info?.thumbnail) resultThumbnails[tid] = info.thumbnail;
          }
        }

        // Scan thêm từ DOM nếu thumbnails còn thiếu
        if (resultTileIds.length > 0 && window.MessageBridge) {
          const missingTiles = resultTileIds.filter(id => !resultThumbnails[id]);
          if (missingTiles.length > 0) {
            try {
              const scanResult = await MessageBridge.getThumbnailsByIds(missingTiles);
              const results = scanResult?.results || {};
              for (const tid of missingTiles) {
                if (results[tid]?.thumbnail) resultThumbnails[tid] = results[tid].thumbnail;
              }
            } catch (e) {
              console.warn('[AngleExecution] Scan thumbnails failed:', e.message);
            }
          }
        }

        // ExecutionGate complete/cancel đã được PromptQueue handle — không double-complete
        this._currentExecutionToken = null;

        return {
          fileIds: resultTileIds,
          duration: Date.now() - startTime,
          thumbnails: resultThumbnails,
        };
      } catch (err) {
        this._log('Pipeline Angles lỗi:', err.message || err);
        // ExecutionGate complete/cancel đã được PromptQueue handle — không double-complete
        this._currentExecutionToken = null;
        throw err;
      } finally {
        this._isRunning = false;
        if (window.ExecutionLock) {
          ExecutionLock.release('angles');
        }
      }
    }

    // Emit tracker started (cross-window broadcast)
    if (window.ExecutionLock) {
      ExecutionLock.broadcastTracker({
        owner: 'angles', label: 'Angles',
        phase: 'started', current: 0, total: 1,
        promptText: state.preset?.base_prompt?.substring(0, 60) || ''
      });
    }

    try {
      // 3. Ref image: đã upload sẵn khi chọn ảnh, chỉ fallback nếu vẫn còn upload_
      let refImageId = state.refImageId;
      if (refImageId.startsWith('upload_') && typeof window.uploadPendingFiles === 'function') {
        this._log('Ảnh chưa upload xong, thử upload lại...');
        const uploaded = await window.uploadPendingFiles(refImageId);
        if (uploaded && uploaded !== refImageId) {
          refImageId = uploaded.split(',').map(s => s.trim()).filter(Boolean)[0] || refImageId;
          // Update editor state with real ID
          if (this.editor) this.editor.state.refImageId = refImageId;
        }
        if (refImageId.startsWith('upload_')) {
          throw new Error(window.I18n?.t('angles.errorUploadRef') || 'Không thể upload ảnh tham chiếu lên Flow. Vui lòng thử lại.');
        }
      }

      // 3b. Re-upload nếu tile không còn trên page
      // CRITICAL: Kiểm tra file_name (persistent) trước khi quyết định reupload
      // tile_id có thể thay đổi sau DOM re-render, nhưng file_name không đổi
      if (refImageId && !refImageId.startsWith('upload_') && typeof window.reuploadMissingFiles === 'function') {
        const refFileName = this.editor?.state?.refFileName || null;
        // Nếu có refFileName, check bằng file_name trước (more reliable)
        if (refFileName && window.MessageBridge) {
          try {
            const fnCheck = await window.MessageBridge.checkFilesExist([refFileName]);
            if (fnCheck?.existing?.includes(refFileName)) {
              // file_name vẫn còn trên page → tìm tile_id mới
              const found = await window.MessageBridge.findTileByFileName(refFileName);
              if (found?.tileId) {
                console.log('[AngleExecution] Found tile by file_name:', refFileName, '→', found.tileId);
                refImageId = found.tileId; // Update tile_id mới
                if (this.editor) this.editor.state.refImageId = refImageId;
                // Skip reuploadMissingFiles vì ảnh vẫn còn trên Flow
              }
            } else {
              // file_name không còn → cần reupload
              console.log('[AngleExecution] file_name not found on page, will reupload:', refFileName);
              const thumbMap = {};
              if (this.editor?.state?.refThumbnail) thumbMap[refImageId] = this.editor.state.refThumbnail;
              // Truyền file_names map để reuploadMissingFiles có thể double-check
              const fileNamesMap = refFileName ? { [refImageId]: refFileName } : {};
              const updated = await window.reuploadMissingFiles(refImageId, thumbMap, null, fileNamesMap);
              if (updated && updated !== refImageId) {
                refImageId = updated.split(',').map(s => s.trim()).filter(Boolean)[0] || refImageId;
                if (this.editor) this.editor.state.refImageId = refImageId;
              }
              const afterId = (updated || '').trim();
              if (!afterId) {
                throw new Error(window.I18n?.t('angles.errorRefNotFound') || 'Ảnh tham chiếu không tìm thấy và không thể khôi phục. Vui lòng chọn lại ảnh.');
              }
            }
          } catch (err) {
            console.warn('[AngleExecution] file_name check failed, fallback to tile check:', err.message);
            // Fallback to original logic
            const thumbMap = {};
            if (this.editor?.state?.refThumbnail) thumbMap[refImageId] = this.editor.state.refThumbnail;
            // Truyền file_names map để reuploadMissingFiles có thể double-check
            const fileNamesMap = refFileName ? { [refImageId]: refFileName } : {};
            const updated = await window.reuploadMissingFiles(refImageId, thumbMap, null, fileNamesMap);
            if (updated && updated !== refImageId) {
              refImageId = updated.split(',').map(s => s.trim()).filter(Boolean)[0] || refImageId;
              if (this.editor) this.editor.state.refImageId = refImageId;
            }
          }
        } else {
          // Không có refFileName → dùng logic cũ (tile_id check)
          const thumbMap = {};
          if (this.editor?.state?.refThumbnail) thumbMap[refImageId] = this.editor.state.refThumbnail;
          // Không có file_name để truyền, reuploadMissingFiles sẽ chỉ dùng tile_id check
          const updated = await window.reuploadMissingFiles(refImageId, thumbMap, null, null);
          if (updated && updated !== refImageId) {
            refImageId = updated.split(',').map(s => s.trim()).filter(Boolean)[0] || refImageId;
            if (this.editor) this.editor.state.refImageId = refImageId;
          }
          const afterId = (updated || '').trim();
          if (!afterId) {
            throw new Error(window.I18n?.t('angles.errorRefNotFound') || 'Ảnh tham chiếu không tìm thấy và không thể khôi phục. Vui lòng chọn lại ảnh.');
          }
        }
      }

      // 4. Build prompt từ angle state
      const prompt = this._buildPrompt(state);
      if (!prompt) {
        throw new Error(window.I18n?.t('angles.errorBuildPrompt') || 'Không thể tạo prompt từ preset và thông số góc');
      }
      this._log('Built prompt:', prompt.substring(0, 80) + '...');

      // 5. Build settings: user selection > preset > user defaults
      const genDefaults = await this._getGenDefaults();
      const settings = {
        media_type: state.preset.media_type || genDefaults.genType,
        ratio: state.ratio || state.preset.ratio || genDefaults.ratio,
        model: state.model || state.preset.model || genDefaults.imageModel
      };

      // 6. Execute trên Google Flow
      const refFileName = this.editor?.state?.refFileName || null;
      const result = await this._executeOnFlow(prompt, refImageId, settings, null, refFileName);

      // Legacy mode: gọi callback SAU khi có kết quả (không phải ngay sau submit)
      // Điều này ngăn user submit nhiều lần trước khi Flow xử lý xong
      if (typeof this._onSubmittedCallback === 'function') {
        try { this._onSubmittedCallback(); } catch (_) { globalThis.SEOSONA_swallow?.('AngleExecution#t', _); }
      }

      const duration = Date.now() - startTime;
      const fileIds = result?.tiles || result?.fileIds || [];
      const thumbnails = result?.thumbnails || {}; // file_name đã capture trong _executeOnFlow

      this._log(`Generation hoàn thành: ${fileIds.length} file, ${Math.round(duration / 1000)}s`);

      // Emit tracker completed (cross-window broadcast)
      if (window.ExecutionLock) {
        ExecutionLock.broadcastTracker({
          owner: 'angles', phase: 'completed', current: 1, total: 1
        });
      }

      // SP-2.6: ExecutionGate complete (direct success)
      if (window.ExecutionGate && this._currentExecutionToken) {
        ExecutionGate.complete(this._currentExecutionToken, 'success');
        this._currentExecutionToken = null;
      }

      // Results will be saved by the caller (AngleEditor._runGeneration)
      return { fileIds, duration, thumbnails };

    } catch (err) {
      // Audit fix: defensively clear the running flag at the top of the catch so
      // an unexpected throw before the finally can never wedge the executor as
      // "running". The finally below also resets it (belt-and-suspenders).
      this._isRunning = false;
      this._log('Generation thất bại:', err.message || err);
      // Legacy mode: unlock controls khi có lỗi
      if (typeof this._onSubmittedCallback === 'function') {
        try { this._onSubmittedCallback(); } catch (_) { globalThis.SEOSONA_swallow?.('AngleExecution#t', _); }
      }
      // SP-2.6: ExecutionGate complete (direct failed)
      if (window.ExecutionGate && this._currentExecutionToken) {
        ExecutionGate.complete(this._currentExecutionToken, 'failed', { error: err.message || String(err) });
        this._currentExecutionToken = null;
      }
      // Emit tracker error (cross-window broadcast)
      if (window.ExecutionLock) {
        ExecutionLock.broadcastTracker({
          owner: 'angles', phase: 'error'
        });
      }
      throw err;

    } finally {
      this._isRunning = false;
      if (window.ExecutionLock) {
        ExecutionLock.release('angles');
      }
    }
  }

  /**
   * Dừng generation đang chạy
   */
  stop() {
    this._shouldStop = true;
    // SP-2.8: ExecutionGate cancel on angles stop
    // Pipeline mode: PromptQueue.stopJob() sẽ cancel token — không double-cancel
    const isPipeline = window.PromptQueue && PromptQueue.isEnabled();
    if (!isPipeline && window.ExecutionGate && this._currentExecutionToken) {
      ExecutionGate.cancel(this._currentExecutionToken);
    }
    this._currentExecutionToken = null;
    if (window.MessageBridge) {
      window.MessageBridge.stopExecution().catch(function (_e) { globalThis.SEOSONA_swallow?.('AngleExecution#stop', _e); });
    }
  }

  /**
   * Trạng thái đang chạy
   */
  get isRunning() {
    return this._isRunning;
  }

  // ---------------------------------------------------------------------------
  // Prompt Building
  // ---------------------------------------------------------------------------

  /**
   * Build prompt từ angle parameters + preset
   * Thay thế {angle_modifier}, {tilt_modifier}, {zoom_modifier} trong base_prompt
   */
  _buildPrompt(state) {
    const preset = state.preset;
    if (!preset?.base_prompt) return '';

    const modifiers = preset.angle_modifiers || {};
    const rotationMod = this._findNearestKey(state.rotation, modifiers.rotation_keywords || {});
    const tiltMod = this._findNearestKey(state.tilt, modifiers.tilt_keywords || {});
    const zoomMod = this._findNearestKey(state.zoom, modifiers.zoom_keywords || {});

    let prompt = preset.base_prompt;
    prompt = prompt.replace('{angle_modifier}', rotationMod);
    prompt = prompt.replace('{tilt_modifier}', tiltMod);
    prompt = prompt.replace('{zoom_modifier}', zoomMod);

    // Xóa placeholder chưa được thay thế
    prompt = prompt.replace(/\{angle_modifier\}/g, '');
    prompt = prompt.replace(/\{tilt_modifier\}/g, '');
    prompt = prompt.replace(/\{zoom_modifier\}/g, '');

    return prompt.trim();
  }

  /**
   * Tìm key gần nhất trong angle_modifiers map
   * @param {number} value - Giá trị góc hiện tại
   * @param {Object} keysMap - { "0": "front view", "90": "side view", ... }
   * @returns {string} Modifier text tương ứng
   */
  _findNearestKey(value, keysMap) {
    if (!keysMap || Object.keys(keysMap).length === 0) return '';
    const keys = Object.keys(keysMap).map(Number);
    let nearest = keys[0];
    let minDiff = Math.abs(value - nearest);
    for (const key of keys) {
      const diff = Math.abs(value - key);
      if (diff < minDiff) {
        minDiff = diff;
        nearest = key;
      }
    }
    return keysMap[String(nearest)] || '';
  }

  // ---------------------------------------------------------------------------
  // Flow Execution (via MessageBridge)
  // ---------------------------------------------------------------------------

  /**
   * Thực thi trên Google Flow: apply settings, clear, add ref, insert prompt, submit, wait
   * @param {string} prompt - Prompt text đã build
   * @param {string} refImageId - File ID ảnh tham chiếu (tile ID trên Flow)
   * @param {Object} settings - { media_type, ratio, model }
   * @returns {Promise<{tiles: string[]}>}
   */
  async _executeOnFlow(prompt, refImageId, settings, onSubmitted, refFileName) {
    if (!window.MessageBridge) {
      throw new Error(window.I18n?.t('angles.errorNoBridge') || 'MessageBridge chưa sẵn sàng, vui lòng mở tab Google Flow');
    }

    // Đọc timing settings — derived từ inputTimeout
    const inputTimeout = this._getSettingMs('inputTimeout', 1200);
    const clearEditorDelay = Math.round(inputTimeout * 0.4);
    const submitDelay = Math.round(inputTimeout * 0.5);
    const afterSubmitDelay = Math.round(inputTimeout * 0.8);

    // 1. Lấy tile IDs hiện tại (trước generation)
    if (this._shouldStop) throw new Error(window.I18n?.t('angles.stoppedByUser') || 'Đã dừng bởi người dùng');

    // 2026-05-30 REORDER: applySettings PHẢI chạy SAU khi add ref images.
    // Lý do: Flow render UI option (ratio/duration/...) dựa theo ref type. Vd ref=video
    // → ko có duration dropdown. Sync với EditorExecutor + WorkflowExecutor pattern.
    // ORDER: prepareFlowForGen → removeRefs → clearEditor → addRefs → applySettings → insertText → submit.

    // 2026-06-02: Step 0 — đóng chat panel + Agent OFF + wait editor ready TRƯỚC mọi action.
    if (window.MessageBridge?.prepareFlowForGen) {
      try {
        this._log('Step 0: prepareFlowForGen (close chat panel + Agent OFF + wait editor)');
        const prep = await window.MessageBridge.prepareFlowForGen();
        if (prep?.actioned) {
          this._log(`Step 0 actioned (editor ready in ${prep.editorReadyMs || 0}ms)`);
        }
      } catch (e) {
        this._log('Step 0 prepareFlowForGen failed (non-blocking): ' + e.message);
      }
    }

    if (this._shouldStop) throw new Error(window.I18n?.t('angles.stoppedByUser') || 'Đã dừng bởi người dùng');

    // 2. Xóa ref images cũ TRƯỚC khi add ref mới.
    // clearEditor() chỉ xóa text Slate, KHÔNG xóa ref image thumbnails.
    this._log('Removing existing ref images...');
    await window.MessageBridge.removeExistingRefImages();
    await this._sleep(200);

    // 3. Clear editor
    await window.MessageBridge.clearEditor();
    await this._sleep(clearEditorDelay);

    // 4. Add reference image (with file_name for cross-project safety)
    if (refImageId) {
      this._log('Adding ref image:', refImageId);
      await window.MessageBridge.addFileToPrompt(refImageId, refFileName || null);
      await this._sleep(inputTimeout);
    }

    if (this._shouldStop) throw new Error(window.I18n?.t('angles.stoppedByUser') || 'Đã dừng bởi người dùng');

    // 4.5. Apply settings AFTER refs (cho Flow render UI đúng theo ref type)
    this._log('Applying settings:', settings);
    await window.MessageBridge.applySettings(
      settings.media_type,
      settings.ratio,
      settings.model,
      false, // isFrames = false cho Angles
      1,     // quantity = 1
      null   // flowVideoDuration = null (Angles chỉ dùng image)
    );
    await this._sleep(inputTimeout);

    if (this._shouldStop) throw new Error(window.I18n?.t('angles.stoppedByUser') || 'Đã dừng bởi người dùng');

    // 5. Insert prompt text
    this._log('Inserting prompt...');
    await window.MessageBridge.insertText(prompt);

    // Chờ Slate editor xử lý xong (derived: inputTimeout * 2)
    await this._sleep(submitDelay);

    if (this._shouldStop) throw new Error(window.I18n?.t('angles.stoppedByUser') || 'Đã dừng bởi người dùng');

    // Capture tile IDs + file_names NGAY TRƯỚC submit (sau khi add refs + insert prompt xong)
    const preTileResult = await window.MessageBridge.getCurrentTileIds();
    const preTileIds = preTileResult?.tileIds || [];
    const preFileNames = preTileResult?.fileNames || [];
    this._log(`Tile hiện tại: ${preTileIds.length}`);
    // Store baseline for fallback scan to exclude pre-existing tiles
    this._lastBaselineTileIds = new Set(preTileIds);

    // 6. Click submit (retry loop cho submit button)
    const maxSubmitWait = 10000;
    const submitStart = Date.now();
    let submitted = false;
    while (Date.now() - submitStart < maxSubmitWait) {
      const result = await window.MessageBridge.clickSubmit();
      if (result?.success) {
        submitted = true;
        this._log('Submit clicked');
        break;
      }
      this._log('Submit chưa sẵn sàng, thử lại...');
      await this._sleep(500);
    }
    if (!submitted) {
      throw new Error(window.I18n?.t('angles.errorSubmitNotFound') || 'Nút Submit không tìm thấy hoặc bị vô hiệu hóa sau 10s');
    }

    // Legacy mode: KHÔNG gọi onSubmitted callback ở đây
    // Giữ controls locked cho đến khi có kết quả để tránh user submit nhiều lần
    // Callback sẽ được gọi trong runGeneration sau khi hoàn tất
    // (Pipeline mode đã gọi callback riêng ở trên, nên không ảnh hưởng)

    await this._sleep(afterSubmitDelay);

    // 7. Wait for new tiles (timeout 120s, retry if empty)
    this._log('Đã submit, chờ kết quả...');
    let newTiles = [];
    let thumbnails = {}; // Capture từ waitForNewTiles để tránh scan lại
    const maxTileRetries = 2;
    for (let attempt = 0; attempt <= maxTileRetries; attempt++) {
      const tileResult = await window.MessageBridge.waitForNewTiles(preTileIds, attempt === 0 ? 120000 : 15000, { preFileNames: preFileNames });

      if (tileResult?.failed) {
        const err = new Error(window.I18n?.t('angles.errorFlowFailed') || 'Flow thông báo không thành công. Prompt có thể vi phạm chính sách nội dung hoặc hệ thống đang quá tải.');
        err.isFlowFailure = true;
        throw err;
      }

      newTiles = tileResult?.tiles || [];
      thumbnails = tileResult?.thumbnails || {};
      if (newTiles.length > 0) break;

      if (attempt < maxTileRetries) {
        this._log(`Không phát hiện tile mới, thử lại (${attempt + 1}/${maxTileRetries})...`);
        await this._sleep(2000);
      }
    }

    this._log(`Nhận ${newTiles.length} tile mới`);
    return { tiles: newTiles, thumbnails };
  }

  // ---------------------------------------------------------------------------
  // L5: Results Management
  // ---------------------------------------------------------------------------

  /**
   * Lưu kết quả generation vào chrome.storage.local
   * @param {Object} result - { fileIds: string[] }
   * @param {Object} angleState - { rotation, tilt, zoom, preset }
   * @returns {Promise<Object[]>} Danh sách entries đã lưu
   */
  async saveResult(result, angleState) {
    const fileIds = result?.fileIds || [];
    if (fileIds.length === 0) return [];

    // Ưu tiên dùng thumbnails đã capture từ runGeneration (có file_name)
    let thumbnails = {};
    let fileNameMap = {};
    const capturedThumbs = result?.thumbnails || {};

    for (const id of fileIds) {
      const info = capturedThumbs[id];
      if (info?.thumbnail) thumbnails[id] = info.thumbnail;
      if (info?.file_name) fileNameMap[id] = info.file_name;
    }

    // Fallback: scan nếu thiếu data
    const missingIds = fileIds.filter(id => !thumbnails[id] && !fileNameMap[id]);
    if (missingIds.length > 0) {
      try {
        if (window.MessageBridge) {
          const scan = await window.MessageBridge.scanFlowImages();
          for (const img of (scan?.images || [])) {
            if (missingIds.includes(img.fileId)) {
              if (!thumbnails[img.fileId]) thumbnails[img.fileId] = img.thumbnail;
              if (img.file_name && !fileNameMap[img.fileId]) fileNameMap[img.fileId] = img.file_name;
            }
          }
        }
      } catch (e) {
        this._log('Scan thumbnails failed:', e.message);
      }
    }

    const entries = fileIds.map(id => ({
      file_id: id,
      rotation: angleState.rotation,
      tilt: angleState.tilt,
      zoom: angleState.zoom,
      angle_label: this._buildAngleLabel(angleState),
      thumbnail_url: thumbnails[id] || '',
      file_name: fileNameMap[id] || '',
      ratio: result.ratio || '',
      preset_id: angleState.preset?.id || 0,
      preset_name: angleState.preset?.name || '',
      project_id: window._currentProjectId || null,
      created_at: new Date().toISOString()
    }));

    // Load existing + append
    const stored = await this._loadStoredResults();
    const merged = [...stored, ...entries];
    await new Promise(resolve => {
      chrome.storage.local.set({ af_angles_results: merged }, resolve);
    });

    this._log(`Đã lưu ${entries.length} kết quả (tổng: ${merged.length})`);
    return entries;
  }

  /**
   * Tạo nhãn góc dễ đọc từ angle state
   * @param {Object} state - { rotation, tilt, zoom }
   * @returns {string} Ví dụ: "Phải 45°, Trên 30°"
   */
  _buildAngleLabel(state) {
    const rotLabel = state.rotation === 0
      ? (window.I18n?.t('angles.labelFront') || 'Trước')
      : state.rotation > 0
        ? (window.I18n?.t('angles.labelRight', { degree: state.rotation }) || `Phải ${state.rotation}°`)
        : (window.I18n?.t('angles.labelLeft', { degree: Math.abs(state.rotation) }) || `Trái ${Math.abs(state.rotation)}°`);

    const tiltLabel = state.tilt === 0
      ? (window.I18n?.t('angles.labelEyeLevel') || 'Ngang tầm mắt')
      : state.tilt > 0
        ? (window.I18n?.t('angles.labelAbove', { degree: state.tilt }) || `Trên ${state.tilt}°`)
        : (window.I18n?.t('angles.labelBelow', { degree: Math.abs(state.tilt) }) || `Dưới ${Math.abs(state.tilt)}°`);

    let label = `${rotLabel}, ${tiltLabel}`;

    // Thêm zoom nếu khác mặc định (1.0)
    if (state.zoom !== undefined && state.zoom !== 0) {
      label += `, ${window.I18n?.t('angles.labelZoom', { level: state.zoom }) || `Zoom ${state.zoom}x`}`;
    }

    return label;
  }

  /**
   * Load kết quả đã lưu + validate với Flow (xóa tile không còn)
   * @returns {Promise<Object[]>}
   */
  async loadSavedResults() {
    const results = await this._loadStoredResults();
    if (results.length === 0) return [];

    // Scan Flow để kiểm tra tile nào còn tồn tại
    try {
      if (window.MessageBridge) {
        const scan = await window.MessageBridge.scanFlowImages();
        const existingIds = new Set((scan?.images || []).map(i => i.fileId));

        // Lọc chỉ giữ tile còn tồn tại, cập nhật thumbnail mới
        const valid = results.filter(r => existingIds.has(r.file_id));
        for (const r of valid) {
          const img = (scan?.images || []).find(i => i.fileId === r.file_id);
          if (img?.thumbnail) r.thumbnail_url = img.thumbnail;
        }

        // Lưu lại danh sách đã clean
        if (valid.length !== results.length) {
          this._log(`Đã xóa ${results.length - valid.length} tile không còn tồn tại`);
          await new Promise(resolve => {
            chrome.storage.local.set({ af_angles_results: valid }, resolve);
          });
        }

        return valid;
      }
    } catch (e) {
      this._log('Scan validation failed:', e.message);
    }

    // Trả về tất cả nếu scan thất bại
    return results;
  }

  /**
   * Load raw results từ chrome.storage.local
   * @returns {Promise<Object[]>}
   */
  async _loadStoredResults() {
    return new Promise(resolve => {
      chrome.storage.local.get(['af_angles_results'], result => {
        resolve(result.af_angles_results || []);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Results Grid Rendering
  // ---------------------------------------------------------------------------

  /**
   * Render results grid vào container DOM
   * @param {Object[]} results - Danh sách result entries
   * @param {HTMLElement} container - Container element cho grid
   */
  renderResultsGrid(results, container) {
    const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;
    if (!container) return;

    if (results.length === 0) {
      container.innerHTML = `
        <div class="angles-results-empty">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21 15 16 10 5 21"/>
          </svg>
          <span>${t('angles.noResults')}</span>
        </div>
      `;
      return;
    }

    container.innerHTML = results.map((r, i) => {
      const cssRatio = this._ratioToCss(r.ratio);
      const thumbStyle = cssRatio !== '1' ? ` style="aspect-ratio: ${cssRatio}"` : '';
      return `
      <div class="angles-result-card" data-file-id="${this._escapeAttr(r.file_id)}" data-index="${i}">
        <div class="angles-result-thumb"${thumbStyle}>
          ${r.thumbnail_url
            ? `<img src="${this._escapeAttr(r.thumbnail_url)}" alt="${this._escapeAttr(r.angle_label)}" loading="lazy" />`
            : `<div class="angles-result-placeholder">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                  <circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
              </div>`
          }
        </div>
        <div class="angles-result-overlay">
          <span class="angles-result-label">${this._escapeHtml(r.angle_label || '')}</span>
          <div class="angles-result-actions">
            <button class="angles-result-download" data-file-id="${this._escapeAttr(r.file_id)}" title="${t('common.download')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
            </button>
            <button class="angles-result-delete" data-file-id="${this._escapeAttr(r.file_id)}" data-index="${i}" title="${t('common.delete')}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          </div>
        </div>
      </div>`;
    }).join('');

    // Bind download buttons
    this._bindResultEvents(container);
  }

  /**
   * Bind event listeners cho result cards
   */
  _bindResultEvents(container) {
    // Download buttons
    const downloadBtns = container.querySelectorAll('.angles-result-download');
    for (const btn of downloadBtns) {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const fileId = btn.dataset.fileId;
        const card = btn.closest('.angles-result-card');
        const index = card ? parseInt(card.dataset.index, 10) : 0;
        const results = this.editor?._currentResults || [];
        const label = results[index]?.angle_label || `angle_${index}`;
        const fileName = results[index]?.file_name || null;
        await this.downloadImage(fileId, label, fileName);
      });
    }

    // Delete buttons
    const deleteBtns = container.querySelectorAll('.angles-result-delete');
    for (const btn of deleteBtns) {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const index = parseInt(btn.dataset.index, 10);
        await this.deleteResult(index);
      });
    }

    // Thumbnail error handler: thử scan lại thumbnails
    const images = container.querySelectorAll('.angles-result-thumb img');
    for (const img of images) {
      img.addEventListener('error', () => {
        if (img.dataset.retried) return;
        img.dataset.retried = 'true';
        // Thay bằng placeholder
        const parent = img.parentElement;
        if (parent) {
          parent.innerHTML = `
            <div class="angles-result-placeholder">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </div>
          `;
        }
      });
    }
  }

  /**
   * Xóa một result theo index
   * @param {number} index - Index của result cần xóa
   */
  async deleteResult(index) {
    const results = this.editor?._currentResults || [];
    if (index < 0 || index >= results.length) return;

    // Xóa item khỏi array
    results.splice(index, 1);
    this.editor._currentResults = results;

    // Lưu vào storage
    await new Promise(resolve => {
      chrome.storage.local.set({ af_angles_results: results }, resolve);
    });

    // Re-render grid
    const container = document.querySelector('.angles-results-grid');
    if (container) {
      this.renderResultsGrid(container, results);
    }

    this._log('Đã xóa result tại index:', index);
  }

  // ---------------------------------------------------------------------------
  // Download
  // ---------------------------------------------------------------------------

  /**
   * Download ảnh đơn lẻ qua MessageBridge
   * @param {string} fileId - Tile file ID
   * @param {string} label - Label cho tên file
   */
  async downloadImage(fileId, label, fileName) {
    try {
      // Use DownloadHelper modal for single image download (resolution selection)
      if (window.DownloadHelper) {
        DownloadHelper.showModal({
          tileId: fileId,
          fileName: fileName || null,
          promptText: label || 'angles',
          taskName: 'angles'
        });
        this._log('Download modal opened:', fileId);
      } else if (window.MessageBridge) {
        const safeName = (window.DownloadHelper?.toAscii?.(label) || label || 'angles').replace(/[^a-zA-Z0-9_\-]/g, '_');
        // Lấy resolution từ settings
        const resolution = this._getDownloadResolution();
        await window.MessageBridge.downloadTileMedia(fileId, `angles_${safeName}`, 'angles', fileName, resolution);
        this._log('Downloaded:', fileId);
      } else {
        this._log('MessageBridge không khả dụng, không thể tải xuống');
      }
    } catch (e) {
      this._log('Download failed:', e.message || e);
    }
  }

  /**
   * Download tất cả kết quả (tuần tự, delay giữa mỗi file)
   * @param {Object[]} results - Danh sách result entries
   */
  async downloadAll(results) {
    if (!results || results.length === 0) return;

    this._log(`Bắt đầu tải ${results.length} file...`);
    let downloaded = 0;

    for (const r of results) {
      try {
        // Batch download: direct without modal (bypass DownloadHelper)
        if (window.MessageBridge) {
          const safeName = (window.DownloadHelper?.toAscii?.(r.angle_label) || r.angle_label || `angle_${downloaded}`).replace(/[^a-zA-Z0-9_\-]/g, '_');
          const resolution = this._getDownloadResolution();
          await window.MessageBridge.downloadTileMedia(r.file_id, `angles_${safeName}`, 'angles', r.file_name || null, resolution);
          this._log('Downloaded:', r.file_id);
        }
        downloaded++;
        // Delay giữa các file để tránh quá tải
        if (downloaded < results.length) {
          await this._sleep(500);
        }
      } catch (e) {
        this._log(`Download thất bại cho ${r.file_id}:`, e.message);
      }
    }

    this._log(`Đã tải ${downloaded}/${results.length} file`);
  }

  // ---------------------------------------------------------------------------
  // Clear Results
  // ---------------------------------------------------------------------------

  /**
   * Xóa tất cả kết quả (có xác nhận qua CustomDialog)
   * @returns {Promise<boolean>} true nếu đã xóa
   */
  async clearResults() {
    // Xác nhận trước khi xóa
    if (window.customDialog) {
      const confirmed = await window.customDialog.confirm(
        window.I18n?.t('angles.clearConfirmMsg') || 'Bạn có chắc muốn xóa tất cả kết quả Angles? Thao tác này không thể hoàn tác.',
        {
          title: window.I18n?.t('angles.clearConfirmTitle') || 'Xóa kết quả Angles',
          confirmText: window.I18n?.t('common.deleteAll') || 'Xóa tất cả',
          cancelText: window.I18n?.t('common.cancel') || 'Hủy'
        }
      );
      if (!confirmed) return false;
    }

    await new Promise(resolve => {
      chrome.storage.local.remove(['af_angles_results'], resolve);
    });

    this._log('Đã xóa tất cả kết quả Angles');
    return true;
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Escape HTML entities
   */
  _escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Escape cho HTML attributes
   */
  _escapeAttr(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
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
}

window.AngleExecution = AngleExecution;
