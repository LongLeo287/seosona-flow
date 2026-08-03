/**
 * EffectsExecution — Handles execution logic for Image Effects Editor.
 * Communicates with Google Flow via MessageBridge.
 */
class EffectsExecution {
  constructor(editor) {
    this.editor = editor;
    this._onSubmittedCallback = null;
    this._shouldStop = false;
  }

  stop() {
    this._shouldStop = true;
  }

  /**
   * Convert ratio to Flow format (Vietnamese)
   */
  _ratioToFlow(ratio) {
    const map = {
      '9:16': 'Dọc',
      '16:9': 'Ngang',
      '1:1': 'Vuông',
      'Dọc': 'Dọc',
      'Ngang': 'Ngang',
      'Vuông': 'Vuông'
    };
    return map[ratio] || ratio;
  }

  /**
   * Run generation with effect
   * @param {Object} params - { refImageId, refFileName, prompt, model, ratio, effectName }
   * @returns {Promise<{thumbnails: Array}>}
   */
  async runGeneration(params) {
    let { refImageId, refFileName, prompt, model, ratio, effectName } = params;

    console.log('[EffectsExecution] Starting generation:', { effectName, model, ratio });

    // GP-6.3 / GP-6.4: Check global quota warning/exhausted
    if (window.featureGate) {
      const quotaCheck = window.featureGate.checkGlobalQuotaWarning('Effects');
      if (quotaCheck.exhausted) {
        throw new Error(window.I18n?.t('effects.errorQuotaExhausted') || 'Đã hết lượt prompt hôm nay');
      }
    }

    // UA-3.4: Theo doi bat dau effects generation
    window.UsageSync?.trackEvent('effects_start', { effect_id: params.effectName || null });

    // Acquire ExecutionLock
    if (window.ExecutionLock) {
      if (ExecutionLock.isBlockedBy('effects')) {
        const shouldStop = await ExecutionLock.showBlockedDialog('effects');
        if (!shouldStop) return null;
        await ExecutionLock.stopCurrent();
      }
      const acquired = ExecutionLock.acquire('effects', effectName || 'Image Effect');
      if (!acquired) {
        throw new Error(window.I18n?.t('effects.errorFlowBusy') || 'Không thể khởi chạy, Google Flow đang bận');
      }
    }

    // Activate Flow tab when execution starts (popup windows need this)
    try {
      await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }, () => resolve());
      });
    } catch (e) {
      console.warn('[EffectsExecution] ensureFlowTabActive failed:', e.message);
    }

    // SP-2.7: ExecutionGate - xin phep server truoc khi chay effects
    this._currentExecutionToken = null;
    if (window.ExecutionGate) {
      try {
        const gate = await ExecutionGate.request('effects_run', 1, { owner: 'effects', label: effectName || 'Image Effect' });
        if (!gate.allowed) {
          if (window.ExecutionLock) ExecutionLock.release('effects');
          ExecutionGate.showDeniedDialog(gate, 'Effects');
          const errMsg = gate.reason === 'QUOTA_EXCEEDED'
            ? (window.I18n?.t('effects.errorQuotaExceededModule') || 'Đã hết lượt sử dụng Effects hôm nay')
            : gate.reason === 'MODULE_DISABLED' || gate.reason === 'FEATURE_LOCKED'
              ? (window.I18n?.t('effects.errorFeatureLocked') || 'Tính năng Effects bị khóa cho gói hiện tại')
              : (window.I18n?.t('effects.errorNotAllowed') || 'Không được phép chạy Effects');
          throw new Error(errMsg);
        }
        this._currentExecutionToken = gate.token;
      } catch (e) {
        const isQuotaByCode = window.QuotaErrorHandler?.isQuotaError(e);
        const isQuotaByMessage = e.message?.includes('hết lượt') || e.message?.includes('bị khóa') || e.message?.includes('Không được phép');
        if (isQuotaByCode || isQuotaByMessage) {
          if (isQuotaByCode && !isQuotaByMessage) {
            window.QuotaErrorHandler?.showDialog(e, 'Effects');
          }
          if (window.ExecutionLock) ExecutionLock.release('effects');
          throw e;
        }
        console.error('[EffectsExecution] ExecutionGate request failed, proceeding:', e.message);
      }
    }

    // Emit tracker started (cross-window broadcast)
    if (window.ExecutionLock) {
      ExecutionLock.broadcastTracker({
        owner: 'effects', label: effectName || 'Image Effect',
        phase: 'started', current: 0, total: 1,
        promptText: prompt?.substring(0, 60) || ''
      });
    }

    try {
      // Resolve upload_ keys (album STALE images chưa upload xong)
      if (refImageId && refImageId.startsWith('upload_') && typeof window.uploadPendingFiles === 'function') {
        console.log('[EffectsExecution] Resolving upload_ key:', refImageId);
        const uploaded = await window.uploadPendingFiles(refImageId);
        if (uploaded && uploaded !== refImageId) {
          refImageId = uploaded.split(',').map(s => s.trim()).filter(Boolean)[0] || refImageId;
          // Capture file_name từ cache nếu có
          if (window.GenTab?.fileNameCache?.[refImageId]) {
            refFileName = window.GenTab.fileNameCache[refImageId];
          }
        }
        if (refImageId.startsWith('upload_')) {
          throw new Error(window.I18n?.t('effects.errorUploadRef') || 'Không thể upload ảnh tham chiếu lên Flow. Vui lòng thử lại.');
        }
      }

      // Re-upload nếu tile không còn trên page
      // CRITICAL: Kiểm tra file_name (persistent) trước khi quyết định reupload
      // tile_id có thể thay đổi sau DOM re-render, nhưng file_name không đổi
      if (refImageId && !refImageId.startsWith('upload_') && typeof window.reuploadMissingFiles === 'function') {
        // Nếu có refFileName, check bằng file_name trước (more reliable)
        if (refFileName && window.MessageBridge) {
          try {
            const fnCheck = await window.MessageBridge.checkFilesExist([refFileName]);
            if (fnCheck?.existing?.includes(refFileName)) {
              // file_name vẫn còn trên page → tìm tile_id mới
              const found = await window.MessageBridge.findTileByFileName(refFileName);
              if (found?.tileId) {
                console.log('[EffectsExecution] Found tile by file_name:', refFileName, '→', found.tileId);
                refImageId = found.tileId; // Update tile_id mới
                // Skip reuploadMissingFiles vì ảnh vẫn còn trên Flow
              }
            } else {
              // file_name không còn → cần reupload
              console.log('[EffectsExecution] file_name not found on page, will reupload:', refFileName);
              const refThumbnail = this.editor?.state?.refThumbnail;
              const thumbnailMap = refThumbnail ? { [refImageId]: refThumbnail } : {};
              // Truyền file_names map để reuploadMissingFiles có thể double-check
              const fileNamesMap = refFileName ? { [refImageId]: refFileName } : {};
              const updated = await window.reuploadMissingFiles(refImageId, thumbnailMap, null, fileNamesMap);
              if (updated && updated !== refImageId) {
                refImageId = updated.split(',').map(s => s.trim()).filter(Boolean)[0] || refImageId;
              }
              const afterId = (updated || '').trim();
              if (!afterId) {
                throw new Error(window.I18n?.t('effects.errorRefNotFound') || 'Ảnh tham chiếu không tìm thấy và không thể khôi phục. Vui lòng chọn lại ảnh.');
              }
            }
          } catch (err) {
            console.warn('[EffectsExecution] file_name check failed, fallback to tile check:', err.message);
            // Fallback to original logic
            const refThumbnail = this.editor?.state?.refThumbnail;
            const thumbnailMap = refThumbnail ? { [refImageId]: refThumbnail } : {};
            // Truyền file_names map để reuploadMissingFiles có thể double-check
            const fileNamesMap = refFileName ? { [refImageId]: refFileName } : {};
            const updated = await window.reuploadMissingFiles(refImageId, thumbnailMap, null, fileNamesMap);
            if (updated && updated !== refImageId) {
              refImageId = updated.split(',').map(s => s.trim()).filter(Boolean)[0] || refImageId;
            }
          }
        } else {
          // Không có refFileName → dùng logic cũ (tile_id check)
          const refThumbnail = this.editor?.state?.refThumbnail;
          const thumbnailMap = refThumbnail ? { [refImageId]: refThumbnail } : {};
          // Không có file_name để truyền, reuploadMissingFiles sẽ chỉ dùng tile_id check
          const updated = await window.reuploadMissingFiles(refImageId, thumbnailMap, null, null);
          if (updated && updated !== refImageId) {
            refImageId = updated.split(',').map(s => s.trim()).filter(Boolean)[0] || refImageId;
          }
          const afterId = (updated || '').trim();
          if (!afterId) {
            throw new Error(window.I18n?.t('effects.errorRefNotFound') || 'Ảnh tham chiếu không tìm thấy và không thể khôi phục. Vui lòng chọn lại ảnh.');
          }
        }
      }

      // Update params with resolved ID
      params = { ...params, refImageId, refFileName };

      // Check if PromptQueue is enabled
      let result;
      const isPipeline = window.PromptQueue?.isEnabled?.();
      if (isPipeline) {
        result = await this._runViaPipeline(params);
        // ExecutionGate complete/cancel đã được PromptQueue handle — không double-complete
        this._currentExecutionToken = null;
      } else {
        result = await this._runDirect(params);
        // SP-2.7: ExecutionGate complete (direct mode only)
        if (window.ExecutionGate && this._currentExecutionToken) {
          ExecutionGate.complete(this._currentExecutionToken, 'success');
          this._currentExecutionToken = null;
        }
      }

      // Emit tracker completed (cross-window broadcast)
      if (window.ExecutionLock) {
        ExecutionLock.broadcastTracker({
          owner: 'effects', phase: 'completed', current: 1, total: 1
        });
      }

      return result;
    } catch (err) {
      console.error('[EffectsExecution] Generation failed:', err);
      // SP-2.7: ExecutionGate complete (failed) — chỉ khi direct mode (pipeline tự handle)
      if (window.ExecutionGate && this._currentExecutionToken) {
        ExecutionGate.complete(this._currentExecutionToken, 'failed', { error: err.message || String(err) });
        this._currentExecutionToken = null;
      }
      // Emit tracker error (cross-window broadcast)
      if (window.ExecutionLock) {
        ExecutionLock.broadcastTracker({
          owner: 'effects', phase: 'error'
        });
      }
      throw err;
    } finally {
      if (window.ExecutionLock) {
        ExecutionLock.release('effects');
      }
    }
  }

  /**
   * Run via PromptQueue pipeline
   */
  async _runViaPipeline(params) {
    const { refImageId, refFileName, prompt, model, ratio, effectName } = params;

    const queue = window.PromptQueue.getInstance();

    // Fire submitted callback early to unlock UI
    if (this._onSubmittedCallback) {
      setTimeout(() => this._onSubmittedCallback(), 100);
    }

    const result = await queue.submitJob({
      owner: 'effects',
      label: `Effect: ${effectName}`,
      prompts: [prompt],
      settings: {
        genType: 'Image',
        ratio: ratio === 'Giữ nguyên' ? null : this._ratioToFlow(ratio),
        model: model,
        quantity: 1
      },
      refFileIds: refImageId ? [refImageId] : [],
      taskName: 'effects',
      _executionToken: this._currentExecutionToken, // Pass token to PromptQueue
      refFileNames: refFileName ? { [refImageId]: refFileName } : {},
      refImageMode: 'all'
    });

    // Extract thumbnails from result (PromptQueue returns resultThumbnails in resolve)
    const thumbnails = [];
    if (result.completed > 0 && result.resultThumbnails && Object.keys(result.resultThumbnails).length > 0) {
      // resultThumbnails is object: { tileId: { thumbnail, type, file_name } }
      for (const [tileId, info] of Object.entries(result.resultThumbnails)) {
        thumbnails.push({
          thumbnail: info.thumbnail || info,
          tileId: tileId,
          file_name: info.file_name
        });
      }
    } else if (result.completed > 0 && result.resultTileIds?.length > 0) {
      // Fallback: nếu resultThumbnails rỗng nhưng có resultTileIds, query từ DOM
      console.log('[EffectsExecution] Fallback: fetching thumbnails from resultTileIds');
      const thumbResult = await window.MessageBridge?.getThumbnailsByIds(result.resultTileIds);
      if (thumbResult?.results) {
        for (const [tileId, info] of Object.entries(thumbResult.results)) {
          thumbnails.push({
            thumbnail: info.thumbnail || '',
            tileId: tileId,
            file_name: info.file_name
          });
        }
      }
    }

    return { thumbnails };
  }

  /**
   * Run directly via MessageBridge (legacy mode)
   */
  async _runDirect(params) {
    const { refImageId, refFileName, prompt, model, ratio, effectName } = params;

    // Build payload for runAutoPrompt (flat keys — content.js destructure top-level)
    // [Fix] Truyền timing settings cho content.js
    const settings = window.storageSettings?.getSettings?.() || {};
    const payload = {
      prompts: [prompt],
      genType: 'Image',
      aspectRatio: ratio === 'Giữ nguyên' ? null : this._ratioToFlow(ratio),
      modelName: model,
      quantity: 1,
      fileIds: refImageId ? [refImageId] : [],
      fileIdMap: refFileName ? { [refImageId]: refFileName } : {},
      refImageMode: 'all',
      delayBetweenMs: (window.ExecutionConfig?.safeGetDelayBetweenPromptsSec?.() ?? 5) * 1000,
      inputTimeoutMs: settings.inputTimeout || 1200,
      _owner: 'effects',
      _label: `Effect: ${effectName}`
    };

    // Fire submitted callback
    if (this._onSubmittedCallback) {
      setTimeout(() => this._onSubmittedCallback(), 100);
    }

    // Send to content script
    const result = await window.MessageBridge?.runAutoPrompt(payload);

    // Extract thumbnails from resultTileIds
    // runAutoPrompt trả về { resultTileIds: [...] }, KHÔNG trả về results
    const thumbnails = [];
    if (result?.resultTileIds?.length > 0) {
      // Gọi getThumbnailsByIds để lấy thumbnail data từ tiles
      const thumbResult = await window.MessageBridge?.getThumbnailsByIds(result.resultTileIds);
      if (thumbResult?.results) {
        for (const [tileId, info] of Object.entries(thumbResult.results)) {
          thumbnails.push({
            thumbnail: info.thumbnail || '',
            tileId: tileId,
            file_name: info.file_name
          });
        }
      }
    }

    return { thumbnails };
  }

  /**
   * Download image by tile ID (with resolution modal)
   */
  async downloadImage(tileId, fileName) {
    if (!tileId) return;

    try {
      if (window.DownloadHelper) {
        DownloadHelper.showModal({
          tileId,
          fileName: fileName || null,
          promptText: 'effects',
          taskName: 'effects'
        });
      } else if (window.MessageBridge) {
        await window.MessageBridge.sendToContentScript('downloadTileMedia', {
          tileId,
          promptText: 'effects',
          taskName: 'effects',
          fileName,
          resolution: '1k'
        });
      }
    } catch (err) {
      console.error('[EffectsExecution] Download failed:', err);
    }
  }

  /**
   * Add file to prompt (upload ref image to Flow)
   */
  async addFileToPrompt(fileId, fileName) {
    if (!fileId) return false;

    try {
      const result = await window.MessageBridge?.sendToContentScript('addFileToPrompt', {
        fileId,
        fileName
      });
      return result?.success;
    } catch (err) {
      console.error('[EffectsExecution] Add file failed:', err);
      return false;
    }
  }
}

// Export
window.EffectsExecution = EffectsExecution;
