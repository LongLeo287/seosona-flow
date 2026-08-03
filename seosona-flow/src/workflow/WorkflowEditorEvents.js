/**
 * WorkflowEditorEvents — tách từ WorkflowEditor.js (đợt 4).
 *
 * Cụm GẮN SỰ KIỆN của trình sửa workflow: sự kiện toàn cục (beforeunload, message,
 * storage…), sự kiện trong overlay, listener upload, và phím tắt.
 * Augment prototype nên hành vi KHÔNG đổi. PHẢI nạp SAU WorkflowEditor.js.
 */
(function (root) {
  'use strict';
  var WE = root.WorkflowEditor;
  if (!WE || !WE.prototype) {
    console.error('[WorkflowEditorEvents] WorkflowEditor chưa nạp — phải đặt script này SAU WorkflowEditor.js');
    return;
  }
  Object.assign(WE.prototype, {
  bindGlobalEvents() {
    // S2.5: beforeunload — cảnh báo khi đóng popup window mà có thay đổi chưa lưu hoặc upload đang chạy
    // Read-only mode KHÔNG cảnh báo (workflow không thể edit nên không có "unsaved changes")
    // "Opened to view running" mode KHÔNG cảnh báo (user mở từ sidebar để xem status, không edit)
    this._beforeUnloadHandler = (e) => {
      if (this.isReadOnly()) return;
      // Skip warning nếu editor được mở để xem workflow đang chạy (từ sidebar view button)
      // KHÔNG skip nếu user run workflow từ chính editor (có thể có unsaved changes trước khi run)
      if (this._openedToViewRunning) return;
      const activeCount = this._countActiveFormUploads();
      // Chrome CHẶN + cảnh báo "Blocked attempt to show a 'beforeunload'…" nếu trang CHƯA từng có
      // user gesture (sticky activation). Chỉ set returnValue khi đã có tương tác thật → hết warning,
      // mà vẫn cảnh báo unsaved khi user thực sự đang edit. (userActivation không hỗ trợ → coi như có.)
      const hadGesture = (typeof navigator !== 'undefined' && navigator.userActivation)
        ? navigator.userActivation.hasBeenActive : true;
      if ((activeCount > 0 || this._hasUnsavedChanges) && hadGesture) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', this._beforeUnloadHandler);

    if (window.eventBus) {
      // Store handler references for cleanup in _forceClose()
      this._ebHandlers = {};
      // Phase enhancement: Click select node KHÔNG auto-mở form (chỉ select highlight).
      // User click gear icon trong hover toolbar → mới mở form qua 'node:open_settings' event.
      this._ebHandlers['node:selected'] = (data) => {
        this.selectedNodeId = data.nodeId;
        // UI 2026-05-27: highlight connection của node đang select (đổi màu bright theo type).
        try { this._setNodeConnectionsSelected(data.nodeId); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        // Reset form dirty flag (đảm bảo state clean)
        try { this._missingRefWarned = false; } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
      };
      this._ebHandlers['node:open_settings'] = (data) => this._handleNodeSelected(data.nodeId);
      this._ebHandlers['node:unselected'] = () => this._handleNodeUnselected();
      window.eventBus.on('node:selected', this._ebHandlers['node:selected']);
      window.eventBus.on('node:unselected', this._ebHandlers['node:unselected']);
      window.eventBus.on('node:open_settings', this._ebHandlers['node:open_settings']);

      this._ebHandlers['edge:created'] = (data) => {
        this._hasUnsavedChanges = true;
        this.handleEdgeCreated(data.connection, data.sourcePort, data.targetPort);
        // Phase WK-1.5.3: refresh warning badges sau khi connection thay đổi
        try { this._scheduleRefreshNodeWarningBadges(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        try { this._refreshAllPromptSourceBadges(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        // Phase WK-1.2 enhancement: update data-port-empty cho UI hint
        try { this._updatePortEmptyState(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        // Update ref_mode visibility when connection count changes
        try { this._updateRefModeVisibility(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
      };
      this._ebHandlers['edge:removed'] = (data) => {
        this._hasUnsavedChanges = true;
        this.handleEdgeRemoved(data.connection);
        try { this._scheduleRefreshNodeWarningBadges(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        try { this._refreshAllPromptSourceBadges(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        try { this._updatePortEmptyState(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        // Update ref_mode visibility when connection count changes
        try { this._updateRefModeVisibility(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
      };
      this._ebHandlers['node:removed'] = (data) => {
        this._hasUnsavedChanges = true;
        this.handleNodeRemoved(data.nodeId);
        // CRITICAL: Drawflow KHÔNG cleanup connection refs trong inputs/outputs của peer nodes
        // khi xóa node → A.outputs.output_1.connections vẫn trỏ tới B (đã xóa) → port hiển thị
        // "có link" nhưng click không mở picker. Tự cleanup dead refs từ peer nodes.
        try { this._cleanupDeadConnectionRefs(data.nodeId); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        try { this._scheduleRefreshNodeWarningBadges(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        try { this._refreshAllPromptSourceBadges(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        try { this._updatePortEmptyState(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
      };
      this._ebHandlers['node:moved'] = () => {
        this._hasUnsavedChanges = true;
        // Re-apply connection-active class cho mọi node đang running — defensive fix nếu
        // Drawflow updateConnectionNodes có side effect làm mất class CSS.
        try { this._reapplyRunningConnections(); } catch (e) { /* ignore */ }
      };
      window.eventBus.on('edge:created', this._ebHandlers['edge:created']);
      window.eventBus.on('edge:removed', this._ebHandlers['edge:removed']);
      window.eventBus.on('node:removed', this._ebHandlers['node:removed']);
      window.eventBus.on('node:moved', this._ebHandlers['node:moved']);

      // Phase WK-1.6.3: workflow cũ load lên → DiagramCanvas tự động migrate edges
      // → mark hasUnsavedChanges để user save sẽ persist port info vào storage/backend
      this._ebHandlers['workflow:edges_migrated'] = (data) => {
        this._hasUnsavedChanges = true;
        console.log(`[WorkflowEditor] ${data?.count || 0} legacy edges migrated to typed ports`);
      };
      window.eventBus.on('workflow:edges_migrated', this._ebHandlers['workflow:edges_migrated']);

      // WK-1.7.frame-sync: DiagramCanvas connect/disconnect frame_X port →
      // node.data thay đổi → re-render dropdown form nếu đang mở form node đó.
      this._ebHandlers['node:data_changed'] = (data) => {
        this._hasUnsavedChanges = true;
        try { this._refreshFrameDropdownsForNode(data?.drawflowId, data?.changedFields); } catch (e) { /* ignore */ }
      };
      window.eventBus.on('node:data_changed', this._ebHandlers['node:data_changed']);

      // Inline rename node (pencil ở header thumbnail-node) → DiagramCanvas đã update canvas data,
      // ở đây debounced full-save (bulk-save persist node_name — updateStatus KHÔNG whitelist field này).
      this._ebHandlers['node:renamed'] = (data) => {
        this._hasUnsavedChanges = true;
        if (this.isTemplateMode) return; // template mode: lưu khi user bấm Save
        if (this._inlineSaveTimer) clearTimeout(this._inlineSaveTimer);
        this._inlineSaveTimer = setTimeout(async () => {
          this._inlineSaveTimer = null;
          if (this._isSaving) {
            const t0 = Date.now();
            while (this._isSaving && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 100));
          }
          try { await this.saveWorkflow(); }
          catch (e) { console.warn('[WorkflowEditor] Rename save failed:', e?.message); }
        }, 800);
      };
      window.eventBus.on('node:renamed', this._ebHandlers['node:renamed']);

      // Generic persist request (vd zoom node) → debounced full save. Persist cho cả workflow
      // lẫn template (_triggerSaveWorkflowDebounced tự xử lý template mode) → sync template/shared/community.
      this._ebHandlers['node:request_save'] = () => {
        this._hasUnsavedChanges = true;
        try { this._triggerSaveWorkflowDebounced?.(); } catch (e) { /* ignore */ }
      };
      window.eventBus.on('node:request_save', this._ebHandlers['node:request_save']);

      // Right-click vùng trống diagram → mở context menu mirror toolbar.
      this._ebHandlers['canvas:contextmenu'] = (data) => {
        this._showCanvasContextMenu(data?.clientX || 0, data?.clientY || 0, data?.canvasX, data?.canvasY);
      };
      window.eventBus.on('canvas:contextmenu', this._ebHandlers['canvas:contextmenu']);

      // Issue 3 fix: DiagramCanvas yêu cầu persist frame sync data ngay
      // (avoid lost data khi user đóng editor mà chưa Save).
      this._ebHandlers['frame:sync_persist_request'] = async (data) => {
        try {
          // Template mode: KHÔNG persist vì workflow chưa tồn tại trong DB
          if (this.isTemplateMode) {
            this._hasUnsavedChanges = true;
            return;
          }
          const wfId = this.workflow?.wf_id;
          const nodeId = data?.nodeId;
          const frameData = data?.frameData;
          if (!wfId || !nodeId || !frameData) return;
          if (!window.storageManager?.updateNodeStatus) return;
          await window.storageManager.updateNodeStatus(wfId, nodeId, frameData);
        } catch (e) {
          console.warn('[WorkflowEditor] Failed to persist frame sync:', e?.message);
        }
      };
      window.eventBus.on('frame:sync_persist_request', this._ebHandlers['frame:sync_persist_request']);

      // Execution events - realtime node status
      this._ebHandlers['node:started'] = (data) => {
        console.log(`[WorkflowEditor] node:started event received: nodeId=${data.node?.node_id}, nodeType=${data.node?.node_type}`);
        this._syncDrawflowNodeData(data.node?.node_id, { status: 'running' });
        this._updateNodeStatusUI(data.node?.node_id, 'running');
        this._disableFormIfSelectedNode(data.node?.node_id, true);
        this._refreshResultTabIfSelected(data.node?.node_id, 'running');
        // Prompt + text_extract: clear old result preview khi re-run.
        // 2026-05-31: thêm text_extract — _clearPromptNodeResultPreview xóa cả 2 (selector
        // `.df-ai-output-container` match cả prompt và extract output).
        if (data.node?.node_type === 'prompt' || data.node?.node_type === 'text_extract') {
          this._clearPromptNodeResultPreview(data.node.node_id);
        }
      };
      window.eventBus.on('node:started', this._ebHandlers['node:started']);
      this._ebHandlers['node:submitted'] = (data) => this._updateNodeLoadingText(data.node?.node_id, window.I18n?.t('workflow.waitingForResult') || 'Waiting for results...');
      window.eventBus.on('node:submitted', this._ebHandlers['node:submitted']);
      // 2026-05-25: phase text update cho generate/chatgpt/grok (submitting → generating → downloading → uploading)
      this._ebHandlers['node:phase'] = (data) => {
        const phase = data?.phase;
        const nodeId = data?.nodeId;
        if (!phase || !nodeId) return;
        const i18nKey = `node.phase.${phase}`;
        const fallback = { submitting: 'Đang gửi prompt...', generating: 'Đang gen ảnh/video...', downloading: 'Đang tải kết quả...', uploading: 'Đang upload ảnh lên Flow...' }[phase] || 'Đang xử lý...';
        const text = window.I18n?.t(i18nKey) || fallback;
        this._updateNodeLoadingText(nodeId, text);
      };
      window.eventBus.on('node:phase', this._ebHandlers['node:phase']);
      this._ebHandlers['node:completed'] = async (data) => {
        // Guard: ignore events that arrive after workflow reset (race condition fix)
        if (this._resetInProgress) return;

        const fileIdsStr = data.result?.fileIds ? data.result.fileIds.join(',') : '';
        const nodeId = data.node?.node_id;
        console.log(`[WorkflowEditor] node:completed event: nodeId=${nodeId}, nodeType=${data.node?.node_type}, fileIds=${fileIdsStr.substring(0, 50)}`);
        const syncData = { status: 'completed', result_file_ids: fileIdsStr };
        // Sync media_type/gen_type for video detection in download
        if (data.node?.media_type) syncData.media_type = data.node.media_type;
        if (data.node?.gen_type) syncData.gen_type = data.node.gen_type;
        // Phase CG-8 — Prompt node: sync result_text vào drawflow data để
        // downstream node trong cùng session đọc được mà không cần reload từ DB.
        if (typeof data.node?.result_text === 'string') syncData.result_text = data.node.result_text;
        if (typeof data.node?.result_source === 'string') syncData.result_source = data.node.result_source;
        // Dual URL — sync result_provider_urls (ChatGPT/Grok) → Result tab hiển thị nút
        // "Tải bản gốc". Trước fix: drawflow data thiếu field này → providerCount=0 → nút ẩn.
        if (data.node?.result_provider_urls && typeof data.node.result_provider_urls === 'object'
            && Object.keys(data.node.result_provider_urls).length > 0) {
          syncData.result_provider_urls = { ...data.node.result_provider_urls };
        }
        this._syncDrawflowNodeData(nodeId, syncData);
        this._updateNodeStatusUI(nodeId, 'completed');
        this._showNodePreview(nodeId, data.result?.fileIds);
        // Bug fix: sau khi run xong, ref preview thumbnail ở bottom node card có thể mất
        // (innerHTML re-render hoặc state sync). Re-render từ ref_file_ids của node hiện tại.
        // ChatGPT/Grok/Generate đều có ref input → đảm bảo persist sau run.
        try {
          const dfNode = this.diagramCanvas?.editor?.getNodeFromId?.(this._findDrawflowId(nodeId));
          const nodeType = dfNode?.data?.node_type || dfNode?.class;
          if (['generate', 'chatgpt', 'grok'].includes(nodeType)) {
            const refIdsStr = dfNode?.data?.ref_file_ids || '';
            const refIds = refIdsStr.split(',').map((s) => s.trim()).filter(Boolean);
            if (refIds.length > 0 && typeof this._showNodeRefPreview === 'function') {
              this._showNodeRefPreview(nodeId, refIds);
            }
          }
          // Prompt node: update result preview in diagram after AI run completes.
          // 2026-05-31 fix: dùng use_ai (key mới) thay vì enhance (legacy) — sau AI Agent rename
          // node.use_ai là source of truth, data.enhance có thể stale/undefined.
          if (nodeType === 'prompt' && dfNode?.data?.use_ai) {
            this._updatePromptNodeResultPreview(nodeId, dfNode.data);
          }
          // 2026-05-31: text_extract node — render extracted text trên card (parity prompt node).
          if (nodeType === 'text_extract') {
            this._updateExtractNodeResultPreview(nodeId, dfNode.data);
          }
        } catch (e) { /* ignore */ }
        this._refreshResultTabIfSelected(nodeId, 'completed', data.result?.fileIds);
        this._disableFormIfSelectedNode(nodeId, false);
        this._updateDownloadButton();
        this._updateResetSingleNodeButton();
        this._updateHoverToolbarDownload(nodeId, data.result?.fileIds);

        // Persist thumbnails + file_names từ result (đã capture sẵn trong waitForNewTiles)
        const resultThumbs = data.result?.thumbnails || {};
        if (Object.keys(resultThumbs).length > 0) {
          const thumbMap = {};
          const fileNameMap = {};
          for (const [fid, info] of Object.entries(resultThumbs)) {
            if (info?.thumbnail) {
              const type = info.type || 'image';
              // Persist type + video_url for video detection and playback after reload (Bug 51 fix)
              thumbMap[fid] = type === 'video'
                ? { thumbnail: info.thumbnail, type: 'video', ...(info.video_url && { video_url: info.video_url }) }
                : info.thumbnail;
              this._tileCacheSet(fid, { thumbnail: info.thumbnail, type, ...(info.video_url && { video_url: info.video_url }) });
            }
            if (info?.file_name) {
              fileNameMap[fid] = info.file_name;
            }
          }
          if (Object.keys(thumbMap).length > 0) {
            this._persistNodeThumbnails(nodeId, thumbMap);
            console.log('[SEOSONA Flow] Persisted', Object.keys(thumbMap).length, 'result thumbnails for', nodeId);
          }
          if (Object.keys(fileNameMap).length > 0) {
            this._persistNodeFileNames(nodeId, fileNameMap);
            // Also sync to drawflow data for download access
            this._syncDrawflowNodeData(nodeId, { result_file_names: { ...fileNameMap } });
            console.log('[SEOSONA Flow] Persisted', Object.keys(fileNameMap).length, 'result file_names for', nodeId);
          }
        }
        // Also persist file_names from result.fileNames (extracted separately by WorkflowExecutor)
        const resultFileNames = data.result?.fileNames || {};
        if (Object.keys(resultFileNames).length > 0) {
          this._persistNodeFileNames(nodeId, resultFileNames);
          this._syncDrawflowNodeData(nodeId, { result_file_names: { ...resultFileNames } });
        }

        let fallbackThumbMap = null;
        if (Object.keys(resultThumbs).length === 0 && data.result?.fileIds?.length > 0 && typeof MessageBridge !== 'undefined') {
          // Fallback: scan nếu thumbnails không có sẵn trong result
          try {
            const scanResult = await MessageBridge.getThumbnailsByIds(data.result.fileIds);
            const results = scanResult?.results || {};
            const thumbMap = {};
            for (const [fid, info] of Object.entries(results)) {
              if (info?.thumbnail) {
                const type = info.type || 'image';
                // Bug 51 fix: Include video_url for video playback
                thumbMap[fid] = type === 'video'
                  ? { thumbnail: info.thumbnail, type: 'video', ...(info.video_url && { video_url: info.video_url }) }
                  : info.thumbnail;
                this._tileCacheSet(fid, { thumbnail: info.thumbnail, type, ...(info.video_url && { video_url: info.video_url }) });
              }
            }
            if (Object.keys(thumbMap).length > 0) {
              this._persistNodeThumbnails(nodeId, thumbMap);
              fallbackThumbMap = thumbMap;
              console.log('[SEOSONA Flow] Persisted (fallback)', Object.keys(thumbMap).length, 'thumbnails for', nodeId);
            }
          } catch (e) {
            console.warn('[SEOSONA Flow] Fallback scan thumbnails failed:', e.message);
          }
        }

        // [API SPAM FIX — Phase 1.3] Bỏ auto-save toàn workflow (`this.saveWorkflow()`) sau
        // node:completed. WorkflowExecutor `_updateNodeStatus(completed, ...)` đã PATCH node
        // với result_file_ids + result_thumbnails + result_file_names + result_provider_urls
        // qua extra param (line ~856, 1078 WorkflowExecutor.js). Backend đã có data đầy đủ.
        // Final workflow state persist qua _updateWorkflowStatus('completed') ở cuối execute().
        // Reduces ~5 PUT calls per 5-node workflow.
        //
        // EDGE CASE — fallback scan thumbnails (line ~350-368): nếu result.thumbnails empty
        // và scan tìm thấy thumbnails mới → cần PATCH delta để backend nhận. Tránh PUT toàn
        // workflow chỉ vì 1 thumbnail update.
        if (fallbackThumbMap && window.storageManager && this.workflow?.wf_id) {
          window.storageManager.updateNodeStatus(this.workflow.wf_id, nodeId, {
            result_thumbnails: fallbackThumbMap,
          }).catch((err) => console.warn('[SEOSONA Flow] Persist fallback thumbnails failed:', err?.message));
        }
      };
      window.eventBus.on('node:completed', this._ebHandlers['node:completed']);
      this._ebHandlers['node:failed'] = (data) => {
        if (this._resetInProgress) return;
        this._syncDrawflowNodeData(data.node?.node_id, { status: 'failed', error_message: data.error?.message || '' });
        this._updateNodeStatusUI(data.node?.node_id, 'failed');
        this._refreshResultTabIfSelected(data.node?.node_id, 'failed', null, data.error?.message);
        this._disableFormIfSelectedNode(data.node?.node_id, false);
        this._updateResetSingleNodeButton();
        // [API SPAM FIX — Phase 1.3] Bỏ auto-save sau node:failed. WorkflowExecutor
        // _updateNodeStatus('failed', null, errorMessage) đã PATCH node với error_message
        // (line ~936, 1157). Auto-save trùng lặp → bỏ.
      };
      window.eventBus.on('node:failed', this._ebHandlers['node:failed']);
      this._ebHandlers['node:warning'] = (data) => {
        this._updateNodeStatusUI(data.node?.node_id, 'skipped');
        this._addLogEntry(`${data.node?.node_name}: ${data.message}`, 'warn');
      };
      window.eventBus.on('node:warning', this._ebHandlers['node:warning']);
      this._ebHandlers['execution:log'] = (data) => {
        // Chi tiết log từ executor: cài đặt, ref images, prompt, kết quả
        const nodeName = this._getNodeNameById(data.nodeId);
        const prefix = nodeName ? `${nodeName}: ` : '';
        this._addLogEntry(`${prefix}${data.message}`, data.type || 'info');
      };
      window.eventBus.on('execution:log', this._ebHandlers['execution:log']);
      // Upload xong → replace upload_xxx bằng real file IDs trong Drawflow + node form
      this._ebHandlers['node:ref_replaced'] = async (data) => {
        const { nodeId, newRefIds, refFileNames, refThumbnails, resultFileIds, resultFileNames, resultThumbnails } = data;
        if (!nodeId || (!newRefIds && !resultFileIds)) return;

        // Sync ref_file_ids + ref_file_names + ref_thumbnails vào Drawflow (để persist khi save)
        const syncData = {};
        if (newRefIds) {
          syncData.ref_file_ids = newRefIds;
          if (refFileNames && Object.keys(refFileNames).length > 0) syncData.ref_file_names = refFileNames;
          if (refThumbnails && Object.keys(refThumbnails).length > 0) syncData.ref_thumbnails = refThumbnails;
        }
        // Fix recurring-reupload 2026-06-22: sync result_* khi upstream correction (lúc execution) đổi
        // result_file_ids. Nếu không sync → canvas giữ id cũ → saveWorkflowFull revert → reupload lặp mỗi run.
        if (resultFileIds) {
          syncData.result_file_ids = resultFileIds;
          if (resultFileNames && Object.keys(resultFileNames).length > 0) syncData.result_file_names = resultFileNames;
          if (resultThumbnails && Object.keys(resultThumbnails).length > 0) syncData.result_thumbnails = resultThumbnails;
        }
        this._syncDrawflowNodeData(nodeId, syncData);

        // Phần ref-preview/scan/form chỉ áp dụng khi có newRefIds (image/mention source).
        // Upstream result-only (generate/chatgpt/grok) đã sync result_* xong → bỏ qua phần ref.
        if (!newRefIds) return;

        // Scan ref thumbnails trực tiếp theo file IDs (bổ sung cho refThumbnails từ executor)
        const refIds = newRefIds.split(',').map(s => s.trim()).filter(Boolean);

        // Cache thumbnails từ executor data trước (đồng bộ, không cần async scan)
        if (refThumbnails) {
          for (const [fid, thumb] of Object.entries(refThumbnails)) {
            if (thumb) this._tileCacheSet(fid, { thumbnail: thumb, type: 'image' });
          }
          this._persistRefThumbnailsMap(nodeId, refThumbnails);
        }

        // Async scan bổ sung (cập nhật thumbnail mới nhất từ DOM)
        if (refIds.length > 0 && typeof MessageBridge !== 'undefined') {
          try {
            const scanResult = await MessageBridge.getThumbnailsByIds(refIds);
            const results = scanResult?.results || {};
            const thumbMap = {};
            for (const [fid, info] of Object.entries(results)) {
              if (info?.thumbnail) {
                thumbMap[fid] = info.thumbnail;
                this._tileCacheSet(fid, { thumbnail: info.thumbnail, type: 'image' });
              }
            }
            if (Object.keys(thumbMap).length > 0) {
              this._persistRefThumbnailsMap(nodeId, thumbMap);
            }
          } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        }
        // Update node form nếu đang mở node này
        if (this.selectedNodeId) {
          const selectedNode = this.diagramCanvas?.editor?.getNodeFromId(this.selectedNodeId);
          if (selectedNode?.data?.node_id === nodeId) {
            const fileIdsInput = this.overlay?.querySelector('#nodeRefFileIds');
            if (fileIdsInput) {
              fileIdsInput.value = newRefIds;
              // Re-render ref preview với IDs mới
              const containerSel = selectedNode.class === 'image' ? '#imageNodeRefPreview' : '#nodeRefImagesPreview';
              this._renderNodeRefPreview(newRefIds, containerSel);
            }
          }
        }
        // Update ref preview trên canvas
        this._showNodeRefPreview(nodeId, refIds);
      };
      window.eventBus.on('node:ref_replaced', this._ebHandlers['node:ref_replaced']);

      this._ebHandlers['execution:progress'] = (data) => this._updateProgressUI(data);
      this._ebHandlers['execution:started'] = () => this._onExecutionStarted();
      this._ebHandlers['execution:completed'] = async (data) => this._onExecutionCompleted(data);
      window.eventBus.on('execution:progress', this._ebHandlers['execution:progress']);
      window.eventBus.on('execution:started', this._ebHandlers['execution:started']);
      window.eventBus.on('execution:completed', this._ebHandlers['execution:completed']);

      this._ebHandlers['workflow:reset'] = () => {
        if (window.workflowExecutor) {
          window.workflowExecutor.isRunning = false;
          window.workflowExecutor.shouldStop = true;
          window.workflowExecutor.currentWorkflow = null;
        }
        this._syncExecutionUI();
      };
      window.eventBus.on('workflow:reset', this._ebHandlers['workflow:reset']);

      // Render preview cho node vừa copy
      this._ebHandlers['node:duplicated'] = (data) => {
        const { drawflowId, data: nodeData } = data;
        const nodeId = nodeData?.node_id;
        if (!nodeId) return;
        // Render result preview (canvas)
        const resultIds = (nodeData.result_file_ids || '').split(',').filter(Boolean);
        if (resultIds.length > 0) {
          this._showNodePreview(nodeId, resultIds);
        }
        // Render ref preview — branch ĐÚNG theo node_type (image → preview chính, generate/etc → strip).
        // Bug cũ: dùng _showNodeRefPreview cho CẢ image → ảnh ref image node vào sai container → trống.
        try { this._renderNodeRefPreviewFromData(nodeData); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', _); }
        // Phase WK-1.5.3: refresh warning badges sau khi duplicate
        try { this._scheduleRefreshNodeWarningBadges(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        try { this._refreshAllPromptSourceBadges(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        try { this._updatePortEmptyState(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        try { this._bindInlineSettingPills(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
      };
      window.eventBus.on('node:duplicated', this._ebHandlers['node:duplicated']);

      // v1.1 Node clipboard: nhận event từ DiagramCanvas right-click "Copy node" action
      this._ebHandlers['node:copy_to_clipboard'] = (data) => {
        try { this._copyNodeToClipboard(data?.nodeId); } catch (err) {
          console.warn('[WorkflowEditor] copy node to clipboard failed:', err?.message);
        }
      };
      window.eventBus.on('node:copy_to_clipboard', this._ebHandlers['node:copy_to_clipboard']);

      // Multi-select context menu: copy/delete cả nhóm (từ DiagramCanvas right-click trên node trong nhóm)
      this._ebHandlers['nodes:copy_multi'] = (data) => {
        try { if (Array.isArray(data?.ids) && data.ids.length) this._copySelectedNodesToClipboard(data.ids); }
        catch (err) { console.warn('[WorkflowEditor] copy multi failed:', err?.message); }
      };
      window.eventBus.on('nodes:copy_multi', this._ebHandlers['nodes:copy_multi']);
      this._ebHandlers['nodes:delete_multi'] = (data) => {
        try { if (Array.isArray(data?.ids) && data.ids.length) this._deleteMultiSelectedNodes(data.ids); }
        catch (err) { console.warn('[WorkflowEditor] delete multi failed:', err?.message); }
      };
      window.eventBus.on('nodes:delete_multi', this._ebHandlers['nodes:delete_multi']);

      // Bind gear icon + inline pills cho node mới được Drawflow tạo
      // (reliable hơn rAF sau addNode vì fires sau khi Drawflow render xong DOM)
      this._ebHandlers['node:created'] = (data) => {
        try { this._bindInlineSettingPills(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        try { this._updatePortEmptyState(); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
        // Image node fit-content size → cần re-route connections mỗi khi
        // ảnh thay đổi (replace ref, reset, image load async). ResizeObserver
        // tự fire khi node card resize → schedule connection refresh.
        try { this._attachImageNodeResizeObserver(data?.drawflowId); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_beforeUnloadHandler', e); }
      };
      window.eventBus.on('node:created', this._ebHandlers['node:created']);

      // Sync toggle from canvas to node form
      this._ebHandlers['node:toggled'] = (data) => {
        if (this.selectedNodeId === String(data.nodeId)) {
          const checkbox = this.overlay?.querySelector('#nodeEnabled');
          if (checkbox) checkbox.checked = data.enabled;
        }
      };
      window.eventBus.on('node:toggled', this._ebHandlers['node:toggled']);

      // Listen for featuregate changes to update auto_download toggle in node form + quota display
      this._ebHandlers['featuregate:refreshed'] = () => {
        this._updateNodeFeatureToggles();
        this._updateQuotaDisplay();
        // Bug 30 fix: Targeted DOM patch cho toolbar export/share lock state khi entitlements thay đổi.
        try { this._updateToolbarLockStates(); } catch (e) { /* noop */ }
        // Targeted DOM patch cho gate banner — KHÔNG re-render full form (giữ user input chưa save)
        if (this.selectedNodeId) {
          try {
            const drawflowId = (this._findDrawflowId && this._findDrawflowId(this.selectedNodeId)) || this.selectedNodeId;
            const node = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
            const type = node?.class || node?.data?.node_type;
            if (type === 'chatgpt' || type === 'prompt') {
              try { this._patchNodeFormGateBanners(type); } catch (e) { /* noop */ }
            }
          } catch (e) { /* noop */ }
        }
      };
      window.eventBus.on('featuregate:refreshed', this._ebHandlers['featuregate:refreshed']);

      // Admin update workflow node types qua /admin/workflow-node-types → re-render UI
      this._ebHandlers['node_types:refreshed'] = async (data) => {
        console.log('[WorkflowEditor] node_types:refreshed handler fire', data);
        try {
          // Force re-fetch types từ backend (SseClient đã clear cache)
          await window.NodeTemplates?.fetchFromServer?.();
          // Re-render node settings form nếu đang mở
          if (this.selectedNodeId && this.overlay && !this.overlay.classList.contains('hidden')) {
            this._handleNodeSelected(this.selectedNodeId);
          }
          // Reset node picker nếu đang mở
          this._hideNodePicker?.();
          if (window.SeosonaNotify?.info) {
            window.SeosonaNotify.info(window.I18n?.t('workflow.nodeTypesRefreshed') || 'Đã cập nhật node types');
          }
        } catch (e) {
          console.warn('[WorkflowEditor] node_types:refreshed handler error:', e?.message);
        }
      };
      window.eventBus.on('node_types:refreshed', this._ebHandlers['node_types:refreshed']);
      console.log('[WorkflowEditor] Bound node_types:refreshed listener');

      // Bug 32 fix (2026-05-19): Admin update provider ratios / download_resolutions →
      // re-render node settings form đang mở (nếu node có dropdown affected).
      // Supports: flow, chatgpt, grok
      this._ebHandlers['provider:api_config_updated'] = ({ provider, key, type, value }) => {
        console.log(`[WorkflowEditor] provider:api_config_updated received:`, { provider, key, type, value: value ? 'present' : 'empty' });
        // Only handle relevant providers
        if (!['flow', 'chatgpt', 'grok'].includes(provider)) {
          console.log(`[WorkflowEditor] provider:api_config_updated - skip provider ${provider}`);
          return;
        }
        // Only handle relevant config keys
        if (key !== 'ratios' && key !== 'download_resolutions' && key !== 'quantity_range') {
          console.log(`[WorkflowEditor] provider:api_config_updated - skip key ${key}`);
          return;
        }
        if (!this.selectedNodeId || !this.overlay) {
          console.log(`[WorkflowEditor] provider:api_config_updated - no selected node or overlay`);
          return;
        }
        if (this.overlay.classList.contains('hidden')) {
          console.log(`[WorkflowEditor] provider:api_config_updated - overlay hidden`);
          return;
        }
        console.log(`[WorkflowEditor] provider:api_config_updated - will re-render ${provider}.${key}`);
        try {
          // Re-render settings form để dropdowns + qty buttons đọc fresh PCM data
          this._handleNodeSelected(this.selectedNodeId);
        } catch (e) {
          console.warn('[WorkflowEditor] provider:api_config_updated handler error:', e?.message);
        }
      };
      window.eventBus.on('provider:api_config_updated', this._ebHandlers['provider:api_config_updated']);

      // Bug 32 fix: Admin add/remove/rename model qua /admin/provider-models →
      // re-render settings form (Download node model dropdowns).
      this._ebHandlers['provider:models_updated'] = () => {
        if (!this.selectedNodeId || !this.overlay) return;
        if (this.overlay.classList.contains('hidden')) return;
        try {
          this._handleNodeSelected(this.selectedNodeId);
        } catch (e) {
          console.warn('[WorkflowEditor] provider:models_updated handler error:', e?.message);
        }
      };
      window.eventBus.on('provider:models_updated', this._ebHandlers['provider:models_updated']);

      // Bug 41 fix (2026-05-13): Admin tweak quantity_min/max qua /admin/validation-rules →
      // re-render settings form (Flow generate quantity input + inline dropdown range).
      this._ebHandlers['validation_rules:updated'] = () => {
        if (!this.selectedNodeId || !this.overlay) return;
        if (this.overlay.classList.contains('hidden')) return;
        try {
          this._handleNodeSelected(this.selectedNodeId);
        } catch (e) {
          console.warn('[WorkflowEditor] validation_rules:updated handler error:', e?.message);
        }
      };
      window.eventBus.on('validation_rules:updated', this._ebHandlers['validation_rules:updated']);

      // Bug 42c fix (2026-05-13): Initial PCM fetch arrived sau khi right sidebar đã render
      // với stale defaults → re-render selected node để ratios/download_resolutions hiện đúng.
      this._ebHandlers['provider:api_configs_loaded'] = () => {
        if (!this.selectedNodeId || !this.overlay) return;
        if (this.overlay.classList.contains('hidden')) return;
        try {
          this._handleNodeSelected(this.selectedNodeId);
        } catch (e) {
          console.warn('[WorkflowEditor] provider:api_configs_loaded handler error:', e?.message);
        }
      };
      window.eventBus.on('provider:api_configs_loaded', this._ebHandlers['provider:api_configs_loaded']);

      // Provider metadata (name) updated via SSE → update labels in settings form + node headers
      this._ebHandlers['provider:updated'] = (data) => {
        console.log('[WorkflowEditor] provider:updated event received:', data);
        this._updateProviderLabels();
        // Re-render settings form if open (to update names)
        if (this.selectedNodeId && this.overlay && !this.overlay.classList.contains('hidden')) {
          console.log('[WorkflowEditor] Re-rendering selected node settings');
          try {
            this._handleNodeSelected(this.selectedNodeId);
          } catch (e) {
            console.warn('[WorkflowEditor] provider:updated handler error:', e?.message);
          }
        }
      };
      window.eventBus.on('provider:updated', this._ebHandlers['provider:updated']);
      window.eventBus.on('provider:meta_loaded', this._ebHandlers['provider:updated']);
      console.log('[WorkflowEditor] Bound provider:updated + provider:meta_loaded listeners');

      console.log('[WorkflowEditor] Bound provider:api_config_updated + provider:models_updated + validation_rules:updated + provider:api_configs_loaded + provider:updated listeners');
    }
  },

  bindEvents() {
    if (!this.overlay) return;

    // Close buttons
    const closeBtn = this.overlay.querySelector('#closeEditorBtn');
    closeBtn?.addEventListener('click', () => this.close());

    // Save workflow hoặc update template (EWT-6.2) hoặc tạo template mới (EWT-10)
    const saveBtn = this.overlay.querySelector('#saveWorkflowBtn');
    saveBtn?.addEventListener('click', () => {
      if (this.isTemplateMode) {
        if (this.templateId) {
          // Cập nhật template đã tồn tại
          this._updateTemplate();
        } else {
          // Tạo template mới
          this._createTemplate();
        }
      } else {
        this.saveWorkflow();
      }
    });

    // Upgrade button — gửi message đến sidebar mở upgrade modal (popup window không có
    // window.openUpgradeModal trực tiếp, phải relay qua background → sidePanel).
    const upgradeBtn = this.overlay.querySelector('#wfUpgradeBtn');
    upgradeBtn?.addEventListener('click', () => {
      try { chrome.runtime.sendMessage({ action: 'showUpgradeModal' }); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#bindEvents', _); }
    });

    // Save as Template button (admin only) - EWT-5.1
    const saveAsTemplateBtn = this.overlay.querySelector('#wfSaveAsTemplateBtn');
    saveAsTemplateBtn?.addEventListener('click', () => this._saveAsTemplate());

    // [Affiliate Creator Page] Nút "Xuất bản Template" (affiliate active). Reveal async sau khi
    // verify eligibility (gate authoritative trong modal). Reuse workflowData builder của _saveAsTemplate.
    const publishTemplateBtn = this.overlay.querySelector('#wfPublishTemplateBtn');
    if (publishTemplateBtn && window.CreatorTemplatePublish) {
      publishTemplateBtn.addEventListener('click', () => this._publishCommunityTemplate());
      window.CreatorTemplatePublish.isEligible().then((ok) => {
        if (ok) publishTemplateBtn.classList.remove('hidden');
      }).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#bindEvents', _e); });
    }

    // Capture diagram (template edit mode, admin only) — chụp ảnh canvas → upload làm diagram_url
    const captureDiagramBtn = this.overlay.querySelector('#wfCaptureDiagramBtn');
    console.log('[WorkflowEditor] Bind capture btn:', !!captureDiagramBtn, 'isTemplateMode:', this.isTemplateMode, 'templateId:', this.templateId);
    captureDiagramBtn?.addEventListener('click', () => {
      console.log('[WorkflowEditor] Capture btn CLICKED');
      this._captureDiagramAndUpload();
    });

    // Edit Template button (admin only, chỉ hiện trong template preview readonly mode)
    const editTemplateBtn = this.overlay.querySelector('#wfEditTemplateBtn');
    editTemplateBtn?.addEventListener('click', () => this._editTemplateFromPreview());

    // Share button in header
    const shareHeaderBtn = this.overlay.querySelector('#shareWorkflowHeaderBtn');
    shareHeaderBtn?.addEventListener('click', () => this._shareWorkflow());

    // Sync header name → workflow object (và templateData nếu trong template mode)
    const nameInput = this.overlay.querySelector('#workflowName');
    nameInput?.addEventListener('input', () => {
      // Read-only mode: không cho phép edit name
      if (this.isReadOnly()) return;
      this.workflow.wf_name = nameInput.value || this.workflow.wf_name;
      // EWT-14: Đồng bộ với templateData nếu đang ở template mode
      if (this.isTemplateMode && this.templateData) {
        this.templateData.name = nameInput.value || this.templateData.name;
      }
    });

    // Workflow enabled toggle
    const enabledToggle = this.overlay.querySelector('#workflowEnabledToggle');
    enabledToggle?.addEventListener('click', () => {
      if (this.isReadOnly()) return; // Defensive: read-only không cho toggle
      this.workflow.enabled = this.workflow.enabled === false ? true : false;
      enabledToggle.classList.toggle('on', this.workflow.enabled !== false);
      enabledToggle.classList.toggle('off', this.workflow.enabled === false);
      enabledToggle.title = this.workflow.enabled !== false ? (window.I18n?.t('workflow.workflowOn') || 'Workflow đang bật') : (window.I18n?.t('workflow.workflowOff') || 'Workflow đang tắt');
    });

    // Node form close
    const closeFormBtn = this.overlay.querySelector('#closeNodeFormBtn');
    closeFormBtn?.addEventListener('click', () => this.hideNodeForm());

    // Save node
    const saveNodeBtn = this.overlay.querySelector('#saveNodeBtn');
    saveNodeBtn?.addEventListener('click', () => this.saveNode());

    // Close form (footer button)
    const closeFormBtn2 = this.overlay.querySelector('#closeNodeFormBtn2');
    closeFormBtn2?.addEventListener('click', () => this.hideNodeForm());

    // Node form tabs
    const nodeFormTabs = this.overlay.querySelector('#nodeFormTabs');
    nodeFormTabs?.addEventListener('click', (e) => {
      const tab = e.target.closest('.node-form-tab');
      if (!tab) return;
      const tabName = tab.dataset.tab;
      nodeFormTabs.querySelectorAll('.node-form-tab').forEach(t => t.classList.toggle('active', t === tab));
      const configBody = this.overlay.querySelector('#nodeFormBody');
      const resultBody = this.overlay.querySelector('#nodeResultBody');
      const footer = this.overlay.querySelector('#nodeFormFooter');
      const helpBody = this.overlay.querySelector('#nodeHelpBody');
      // Hide all tabs first
      configBody?.classList.add('hidden');
      resultBody?.classList.add('hidden');
      helpBody?.classList.add('hidden');
      footer?.classList.add('hidden');
      // Show selected tab
      if (tabName === 'config') {
        configBody?.classList.remove('hidden');
        footer?.classList.remove('hidden');
      } else if (tabName === 'help') {
        helpBody?.classList.remove('hidden');
      } else {
        resultBody?.classList.remove('hidden');
      }
    });

    // Run/Stop single node
    const runSingleNodeBtn = this.overlay.querySelector('#runSingleNodeBtn');
    runSingleNodeBtn?.addEventListener('click', () => {
      if (window.workflowExecutor?.isRunning) {
        window.workflowExecutor.stop();
      } else if (this.selectedNodeId) {
        this._runSingleNode(this.selectedNodeId);
      }
    });

    // Download node result files
    const downloadNodeBtn = this.overlay.querySelector('#downloadNodeBtn');
    downloadNodeBtn?.addEventListener('click', () => this._downloadNodeFiles());

    // Reset single node (header button)
    const resetSingleNodeBtn = this.overlay.querySelector('#resetSingleNodeBtn');
    resetSingleNodeBtn?.addEventListener('click', () => {
      if (this.selectedNodeId) this._resetSingleNode(this.selectedNodeId);
    });

    // Reset single node (footer button)
    const resetNodeFooterBtn = this.overlay.querySelector('#resetNodeFooterBtn');
    resetNodeFooterBtn?.addEventListener('click', () => {
      if (this.selectedNodeId) this._resetSingleNode(this.selectedNodeId);
    });

    // Delete node
    const deleteNodeBtn = this.overlay.querySelector('#deleteNodeBtn');
    deleteNodeBtn?.addEventListener('click', () => this.deleteNode());

    // Phase: toggle enabled (icon button trong node-form-header)
    const toggleEnabledBtn = this.overlay.querySelector('#toggleEnabledBtn');
    toggleEnabledBtn?.addEventListener('click', () => {
      if (this.isReadOnly()) return; // Read-only — không cho phép modify enable state
      const checkbox = this.overlay?.querySelector('#nodeEnabled');
      if (!checkbox) return;
      checkbox.checked = !checkbox.checked;
      this._syncEnabledToggleVisual();
    });

    // Node form panel resize handle
    this._bindNodeFormResize();

    // Duplicate banner button — phân biệt template preview vs shared workflow
    const duplicateSharedBtn = this.overlay.querySelector('#wfDuplicateSharedBtn');
    duplicateSharedBtn?.addEventListener('click', () => this._handleReadOnlyDuplicate());

    // Duplicate HEADER button (read-only mode)
    const duplicateHeaderBtn = this.overlay.querySelector('#duplicateSharedHeaderBtn');
    duplicateHeaderBtn?.addEventListener('click', () => this._handleReadOnlyDuplicate());

    // Run/Stop workflow in editor
    const toggleLogBtn = this.overlay.querySelector('#toggleLogPanelBtn');

    const resetInEditorBtn = this.overlay.querySelector('#resetWorkflowInEditorBtn');

    resetInEditorBtn?.addEventListener('click', () => this._resetWorkflowFromEditor());
    toggleLogBtn?.addEventListener('click', () => {
      const body = this.overlay?.querySelector('#executionLogBody');
      body?.classList.toggle('collapsed');
      const icon = toggleLogBtn.querySelector('svg');
      if (icon) {
        const isCollapsed = body?.classList.contains('collapsed');
        icon.innerHTML = isCollapsed
          ? '<polyline points="6 9 12 15 18 9"></polyline>'
          : '<polyline points="6 15 12 9 18 15"></polyline>';
      }
    });

    // Node run button (event delegation on diagram container)
    const diagramContainer = this.overlay.querySelector('#diagramContainer');

    // 2026-05-27: Chỉ NÚT zoom (giữa thumb) mở media viewer; phần thumb ngoài nút vẫn drag node.
    // mousedown trên nút → stop để KHÔNG trigger Drawflow drag. Ngoài nút → bỏ qua (cho drag).
    diagramContainer?.addEventListener('mousedown', (e) => {
      if (!e.target?.closest?.('.df-preview-zoom')) return;
      e.stopPropagation();
    }, true);  // capture phase — chặn trước khi Drawflow drag handler nhận
    diagramContainer?.addEventListener('click', (e) => {
      const zoom = e.target?.closest?.('.df-preview-zoom');
      if (!zoom) return;
      const thumb = zoom.closest('.df-preview-thumb[data-media-src]');
      if (!thumb || thumb.classList.contains('df-preview-thumb--uploading') ||
          thumb.classList.contains('df-preview-thumb--upload-failed')) return;
      e.stopPropagation();
      this._showMediaViewer({
        src: thumb.dataset.mediaSrc,
        type: thumb.dataset.mediaType,
        poster: thumb.dataset.mediaPoster,
      });
    });

    diagramContainer?.addEventListener('click', (e) => {
      const runBtn = e.target.closest('.df-node-run-btn');
      if (!runBtn) return;
      e.stopPropagation();

      // Không cho chạy node nếu workflow chưa được save
      if (this.mode === 'create') {
        window.customDialog?.alert(window.I18n?.t('workflow.saveBeforeRun') || 'Vui lòng lưu workflow trước khi chạy node.', { type: 'warning' });
        return;
      }

      // Find the drawflow node ID
      const drawflowNode = runBtn.closest('.drawflow-node');
      if (!drawflowNode) return;
      const drawflowId = drawflowNode.id?.replace('node-', '');
      if (!drawflowId) return;

      // Get node data from drawflow
      const nodeData = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
      if (!nodeData?.data?.node_id) return;

      // Check node có đủ dữ liệu để chạy
      // Bug fix: Ưu tiên node.data.node_type (original) over node.class (có thể bị corrupt)
      const nodeTypeVal = nodeData?.data?.node_type || nodeData?.class || 'generate';
      if (['generate', 'chatgpt', 'grok'].includes(nodeTypeVal)) {
        const promptCheck = this._checkNodeHasPrompt(drawflowId, nodeData);
        if (!promptCheck.ok) {
          window.customDialog?.alert(promptCheck.message, { type: 'warning' });
          return;
        }
      }

      this._runSingleNode(drawflowId);
    });

    // Track mouse position on diagram canvas for smart node placement
    // When user presses 'N' or clicks toolbar add-node, node spawns near mouse instead of center
    // IMPORTANT: Convert pixel coords → canvas coords (accounting for zoom/pan)
    diagramContainer?.addEventListener('mousemove', (e) => {
      const rect = diagramContainer.getBoundingClientRect();
      const pixelX = e.clientX - rect.left;
      const pixelY = e.clientY - rect.top;
      // Convert to canvas coords: world = (pixel - pan) / zoom
      const editor = this.diagramCanvas?.editor;
      const zoom = editor?.zoom || 1;
      const panX = editor?.canvas_x || 0;
      const panY = editor?.canvas_y || 0;
      this._lastMouseCanvasPos = {
        x: (pixelX - panX) / zoom,
        y: (pixelY - panY) / zoom,
      };
    });
    diagramContainer?.addEventListener('mouseleave', () => {
      // Clear position when mouse leaves canvas - fallback to center
      this._lastMouseCanvasPos = null;
    });

    // UI 2026-05-27: Đóng node form khi click RA NGOÀI .diagram-canvas (bổ sung cho .drawflow
    // empty-click ở DiagramCanvas) — click header/vùng trống cũng đóng. Giữ mở khi click sidebar,
    // trong canvas (node-select/empty đã handle), hoặc controls nổi (toolbar/zoom/legend).
    // Popup (img picker, inline dropdown) render ở document.body → không bubble tới overlay → an toàn.
    this.overlay.addEventListener('click', (e) => {
      const formPanel = this.overlay?.querySelector('#nodeFormPanel');
      if (!formPanel || formPanel.classList.contains('hidden')) return;
      const t = e.target;
      if (!t || typeof t.closest !== 'function') return;
      // Bug fix 2026-05-27: bỏ qua nếu target đã bị DETACH khỏi DOM trong lúc click (vd chọn item
      // mention autocomplete → hideDropdown() xóa innerHTML → item detached → closest() trả null →
      // tưởng nhầm "click ngoài" → đóng form + modal not-saved oan). Element detached → không phải
      // click ngoài thật sự.
      if (!t.isConnected) return;
      // Giữ mở khi click: sidebar (đang thao tác), node (select / mở settings node khác), connection/
      // port (tương tác canvas). MỌI vùng khác (canvas trống, header, toolbar, zoom, legend) → đóng.
      if (t.closest('#nodeFormPanel, .drawflow-node, .connection, .point')) return;
      this._handleNodeUnselected();
    });

    // Left toolbar actions — delegate to _dispatchToolbarAction (cũng dùng cho
    // canvas right-click context menu).
    // Bind cả main toolbar + bottom toolbar (log/export/share tách xuống dưới).
    this.overlay.querySelectorAll('.seosonaflow-wf-toolbar').forEach(toolbar => {
      toolbar.addEventListener('click', (e) => {
        const btn = e.target.closest('.seosonaflow-wf-tool-btn');
        if (!btn) return;
        this._dispatchToolbarAction(btn.dataset.action);
      });
    });

    // Branch event from hover toolbar / context menu — tạo node mới + auto-connect.
    //
    // Logic dùng portContext flow (giống empty output port click):
    //   1. Build portContext cho first output port của source node (vd 'media' cho generate)
    //   2. Picker hiển thị filter theo port compat (chỉ types accept input tương thích)
    //   3. _calculateSpawnPosition đọc canvas coords (đã trừ zoom/pan) → vị trí chuẩn gần parent
    //   4. _autoConnectFromPortContext connect đúng port type (không cứng output_1 → input_1)
    //
    // Trước fix: posX/posY là pixel container coords nhưng `addNode(type, posX, posY)` expect
    // canvas coords → khi zoom ≠ 1 → node spawn xa parent (ví dụ zoom 0.5 → node cách 2x).
    window.eventBus?.on('node:branch', (data) => {
      if (!this.diagramCanvas) return;
      const editor = this.diagramCanvas.editor;
      const node = editor?.getNodeFromId(data.sourceNodeId);
      const containerEl = this.overlay?.querySelector('#diagramContainer');
      const nodeEl = this.overlay?.querySelector(`#node-${data.sourceNodeId}`);
      if (!node || !containerEl || !nodeEl) return;

      // Resolve first output port của source — cần để build portContext
      // Bug fix: Ưu tiên node.data.node_type (original) over node.class (có thể bị corrupt)
      const sourceType = node.data?.node_type || node.class;
      const sourcePorts = window.NodeTemplates?.getNodePorts?.(sourceType, node.data || {})
        || { in: [], out: [] };
      const firstOut = sourcePorts.out?.[0];
      if (!firstOut) {
        // Source không có output (vd note node) → không thể branch
        window.showNotification?.(
          window.I18n?.t('workflow.cannotBranchNoOutput') || 'Node này không có output để tạo nhánh',
          'warning', 2000
        );
        return;
      }

      const containerRect = containerEl.getBoundingClientRect();
      const nodeRect = nodeEl.getBoundingClientRect();
      // Picker UI position (pixel coords): bên phải node, gap 20px
      const posX = (nodeRect.right - containerRect.left) + 20;
      const posY = (nodeRect.top - containerRect.top);

      // Build portContext giống như click empty output port → spawn position chuẩn + auto-connect đúng
      const portContext = {
        side: 'out',
        portType: firstOut.type,
        portName: firstOut.name,
        portLabel: firstOut.label || firstOut.name,
        portIndex: 1,
        sourceNodeDrawflowId: data.sourceNodeId,
      };
      this._showNodePicker(posX, posY, null, portContext);
    });

    // Reset single node từ hover toolbar / context menu
    window.eventBus?.on('node:reset_single', (data) => {
      if (!data?.nodeId) return;
      this._resetSingleNode(data.nodeId);
    });

    // Force stop từ context menu node (right-click) — dừng thực thi đang chạy (single node hoặc workflow).
    window.eventBus?.on('node:force_stop', () => {
      this._forceStopExecution();
    });

    // Run single node from hover toolbar
    window.eventBus?.on('node:run_single', (data) => {
      if (!data.nodeId) return;
      const drawflowId = data.nodeId;
      const nodeData = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
      if (!nodeData?.data?.node_id) return;
      // Bug fix: Ưu tiên node.data.node_type (original) over node.class (có thể bị corrupt)
      const nodeType = nodeData?.data?.node_type || nodeData?.class || 'generate';
      if (['generate', 'chatgpt', 'grok'].includes(nodeType)) {
        const promptCheck = this._checkNodeHasPrompt(drawflowId, nodeData);
        if (!promptCheck.ok) {
          window.customDialog?.alert(promptCheck.message, { type: 'warning' });
          return;
        }
      }
      if (this.mode === 'create') {
        window.customDialog?.alert(window.I18n?.t('workflow.saveBeforeRun') || 'Vui lòng lưu workflow trước khi chạy node.', { type: 'warning' });
        return;
      }
      this._runSingleNode(drawflowId);
    });

    // Port 1.1.58 NOTE_GROUP_RUN: chạy chỉ node bên trong khung note.
    window.eventBus?.on('node:run_group', (data) => {
      if (!data || !Array.isArray(data.nodeIds)) return;
      this._runNoteGroup(data.noteId, data.nodeIds);
    });

    // Download node files from hover toolbar.
    // Option A (2026-05-26): gộp về _downloadNodeFiles (đường chuẩn) thay vì handler riêng cũ.
    // Handler cũ chỉ gọi downloadTileMedia(4 args) → bỏ qua download_resolution/videoResolution
    // của node + fail âm thầm với chatgpt/grok (synthetic ID không có tile Flow). _downloadNodeFiles
    // xử lý đúng: resolution theo node config, video res, và tải bản gốc provider cho chatgpt/grok.
    // Auto-pick source: có result_provider_urls (chatgpt/grok) → 'original'; else (Flow gen) → 'flow'.
    window.eventBus?.on('node:download', (data) => {
      if (!data.nodeId) return;
      // source='original' tự fallback sang Flow khi không có URL gốc khả dụng → robust mọi
      // node type: chatgpt/grok ưu tiên bản gốc (hoặc Flow tile bridged nếu URL hết hạn),
      // gen Flow → rơi thẳng xuống Flow modal. Không cần đoán source theo provider URL.
      this._downloadNodeFiles({ source: 'original', nodeId: data.nodeId });
    });

    // Keyboard shortcuts
    this._bindKeyboardShortcuts();

    // v1.1 paste image feature + palette drag/drop. Trước fix: method
    // `setupPaletteDragDrop` declare nhưng không gọi → paste/drop handlers
    // không bound → Cmd+V không hoạt động trong workflow editor.
    this.setupPaletteDragDrop();

    // v1.1 paste image feature: workflow-wide upload listeners để update node
    // diagram preview (spinner / replace tempId / failed indicator) khi paste
    // image upload completes. KHÔNG depend form open — form-specific listeners
    // ở `_attachFormUploadListeners` chỉ trigger khi user mở node form.
    this._bindWorkflowUploadListeners();
  },

  /**
   * v1.1 paste image feature: listen workflow-wide upload events để re-render
   * node diagram preview thumbnails khi upload start/complete/fail.
   */
  _bindWorkflowUploadListeners() {
    if (this._workflowUploadListenersBound) return;
    this._workflowUploadListenersBound = true;
    this._failedPasteUploadKeys = this._failedPasteUploadKeys || new Set();

    this._wfUploadStartedHandler = (data) => {
      if (!data?.key) return;
      // Spinner sẽ apply trong _renderNodePreviewInner → trigger re-render
      this._refreshNodesContainingKey(data.key);
    };
    this._wfUploadCompletedHandler = (data) => {
      if (!data?.key) return;
      this._failedPasteUploadKeys?.delete(data.key);
      try {
        if (data.tile_id) this._syncUploadKeyToAllNodes(data);
      } catch (err) {
        console.warn('[WorkflowEditor] sync upload key failed:', err?.message);
      }
      // Re-render với tile_id mới (key cũ đã được replace bởi _syncUploadKeyToAllNodes)
      this._refreshNodesContainingKey(data.tile_id || data.key);
      // 2026-05-25 Option B auto-save: sau khi tempId → real tile_id sync, persist
      // workflow để diagram state khớp backend (tránh "show in diagram nhưng chưa save" mismatch).
      // _deferredThumbnailSave có debounce 2s + skip nếu workflow running.
      try { this._deferredThumbnailSave?.(); } catch (e) { /* ignore */ }
    };
    this._wfUploadFailedHandler = (data) => {
      if (!data?.key) return;
      this._failedPasteUploadKeys?.add(data.key);
      this._refreshNodesContainingKey(data.key);
    };

    window.eventBus?.on('upload:started', this._wfUploadStartedHandler);
    window.eventBus?.on('upload:completed', this._wfUploadCompletedHandler);
    window.eventBus?.on('upload:failed', this._wfUploadFailedHandler);
  },

  // === Keyboard Shortcuts ===

  _bindKeyboardShortcuts() {
    this._keyHandler = (e) => {
      if (!this.overlay) return;

      // Ctrl+S / Cmd+S → save workflow. Catch BEFORE input/textarea exemption →
      // user có thể save dù đang focus inline prompt textarea / form input.
      // Always preventDefault → tránh browser "Save Page As" dialog.
      // Debounce 800ms để coalesce spam Ctrl+S liên tiếp (mỗi save trigger ~1s+ API
      // call → user spam Ctrl+S sẽ stack save calls + race condition).
      const isModS = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && !e.shiftKey && !e.altKey;
      if (isModS) {
        e.preventDefault();
        e.stopPropagation();
        if (this.isReadOnly()) return; // read-only: chỉ block browser dialog
        this._triggerSaveWorkflowDebounced();
        return;
      }

      // Don't capture if typing in input/textarea
      if (e.target.matches('input, textarea, [contenteditable]')) {
        // But allow Escape in node picker input
        if (e.key === 'Escape' && this._nodePicker) {
          this._hideNodePicker();
          return;
        }
        return;
      }

      if (e.key === 'Escape') {
        // Bug fix 2026-06-03: ESC KHÔNG đóng editor (chỉ close button đóng). Chỉ đóng
        // inner popup/form đang mở. Trước: ESC ở document-level → close() editor luôn.
        if (this._nodePicker) {
          this._hideNodePicker();
        } else if (this.selectedNodeId) {
          this.hideNodeForm();
        }
        return;
      }
      // Read-only mode: chỉ cho phép Escape (đã handle ở trên) + F (fit screen — không modify)
      // Block tất cả shortcut có thể modify workflow.
      const readOnly = this.isReadOnly();

      if ((e.key === 'n' || e.key === 'N') && !readOnly) {
        e.preventDefault();
        // Smart placement: spawn node near mouse position instead of center
        const rect = this.overlay.querySelector('#diagramContainer')?.getBoundingClientRect();
        const fallbackX = rect ? rect.width / 2 : 200;
        const fallbackY = rect ? rect.height / 2 : 200;
        const posX = this._lastMouseCanvasPos?.x ?? fallbackX;
        const posY = this._lastMouseCanvasPos?.y ?? fallbackY;
        this._showNodePicker(posX, posY);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !readOnly) {
        // 2026-06-03: ưu tiên multi-select batch delete (Shift+drag zone). Nếu có ≥1 node
        // trong _multiSelected → batch delete. Else → single node delete (selectedNodeId).
        const multiIds = this.diagramCanvas?._multiSelected;
        if (multiIds && multiIds.size > 0) {
          // Bug fix 2026-06-03: stopImmediatePropagation chặn Drawflow library internal Delete
          // handler (lib/drawflow.min.js) — drawflow xóa `node_selected` (1 node) ngay
          // synchronously. Nếu không chặn: drawflow xóa 1 + my batch xóa n → total n+1, nhưng
          // async confirm dialog có thể abort batch (user cancel) → chỉ còn 1 node bị drawflow
          // xóa mất. preventDefault không đủ — drawflow handler vẫn fire vì là JS listener khác.
          e.preventDefault();
          e.stopImmediatePropagation();
          // Bug fix 2026-06-03: merge `selectedNodeId` (drawflow's last-clicked node) vào batch
          // nếu chưa có. Lý do: user thường click node A (drawflow select A) RỒI shift+click B
          // → _multiSelected={B} (chỉ B), nhưng UX intent là xóa cả A+B. Trước fix: dialog báo
          // "Xóa 1 node" → user phàn nàn shift+click không cộng dồn đúng.
          const idsSet = new Set([...multiIds].map(String));
          if (this.selectedNodeId && !idsSet.has(String(this.selectedNodeId))) {
            idsSet.add(String(this.selectedNodeId));
          }
          this._deleteMultiSelectedNodes([...idsSet]);
          return;
        }
        if (this.selectedNodeId) {
          // Bug fix 2026-06-03: stopImmediatePropagation chặn Drawflow internal Delete handler
          // (xóa node_selected sync → conflict + double delete với removeNode bên dưới).
          e.preventDefault();
          e.stopImmediatePropagation();
          // Cancel active uploads trước khi xóa node
          if (this._formUploadKeys?.size > 0 && window.ImmediateUploader) {
            for (const key of this._formUploadKeys) {
              ImmediateUploader.cancel(key);
            }
          }
          this.diagramCanvas?.removeNode(this.selectedNodeId);
          this._formUploadKeys?.clear();
          // [Gap H 2026-06-05] Node deleted → skipDirtySave defense
          this.hideNodeForm({ skipDirtySave: true });
        }
      }
      if (e.key === 'f' || e.key === 'F') {
        // Fit to screen — không modify workflow → cho phép cả ở read-only
        e.preventDefault();
        this.diagramCanvas?.fitToScreen?.();
      }
      if (e.ctrlKey && e.key === 'Enter' && !readOnly) {
        e.preventDefault();
        this._runWorkflowFromEditor();
      }
      // Ctrl+S đã handle ở đầu keyHandler (catch cả khi focus input/textarea).

      // v1.1 Node clipboard: Ctrl+C / Cmd+C copy selected node
      const isMod = e.metaKey || e.ctrlKey;
      const lowerKey = e.key.toLowerCase();

      // [Bug fix 2026-05-31] Skip node-clipboard shortcuts (Ctrl+C/D/V) khi focus đang ở
      // trong right sidebar form panel — user đang edit settings, KHÔNG muốn intercept
      // native copy/paste text. Đặc biệt với Ctrl+C: user click vào label/help text trong
      // form rồi select → focus rơi vào span/div (không match guard input/textarea ở trên)
      // → trigger copy node sai mong đợi. Cũng skip khi có text selection trong document
      // (user đang highlight text muốn copy).
      const formPanel = this.overlay?.querySelector('#nodeFormPanel');
      const focusInForm = formPanel && !formPanel.classList.contains('hidden') && formPanel.contains(e.target);
      const hasTextSelection = (() => {
        try {
          const sel = window.getSelection?.();
          return sel && sel.toString().length > 0;
        } catch (_) { return false; }
      })();

      if (isMod && lowerKey === 'c' && !readOnly && !e.shiftKey && !e.altKey) {
        // Skip copy-node nếu user đang edit form HOẶC đang select text — để native copy fire
        if (focusInForm || hasTextSelection) return;
        // 2026-06-23: ưu tiên multi-select. Merge selectedNodeId (drawflow last-clicked) giống
        // batch delete — user click A rồi shift+click B → _multiSelected={B} nhưng intent là A+B.
        const multiIds = this.diagramCanvas?._multiSelected;
        if (multiIds && multiIds.size > 0) {
          e.preventDefault();
          const idsSet = new Set([...multiIds].map(String));
          if (this.selectedNodeId && !idsSet.has(String(this.selectedNodeId))) idsSet.add(String(this.selectedNodeId));
          if (idsSet.size > 1) this._copySelectedNodesToClipboard([...idsSet]);
          else this._copyNodeToClipboard([...idsSet][0]); // 1 node → slot single (giữ toast tên node)
        } else if (this.selectedNodeId) {
          e.preventDefault();
          this._copyNodeToClipboard(this.selectedNodeId);
        }
      }
      // v1.1 Ctrl+D / Cmd+D duplicate selected node (parity với menu shortcut ⌘D)
      if (isMod && lowerKey === 'd' && !readOnly && !e.shiftKey && !e.altKey) {
        // Skip nếu focus trong form — browser default Ctrl+D (bookmark) ít quan trọng,
        // nhưng tránh duplicate node bất ngờ khi user đang focus settings panel.
        if (focusInForm) return;
        if (this.selectedNodeId) {
          e.preventDefault();
          const drawflowId = this._findDrawflowId(this.selectedNodeId);
          if (drawflowId) {
            const newId = this.diagramCanvas?.duplicateNode?.(drawflowId);
            if (newId) {
              const newNode = this.diagramCanvas?.editor?.getNodeFromId(newId);
              if (newNode?.data) {
                window.eventBus?.emit('node:duplicated', { drawflowId: newId, data: newNode.data, sourceDrawflowId: drawflowId });
              }
              this._hasUnsavedChanges = true;
            }
          }
        }
      }
      // v1.1 Ctrl+V / Cmd+V paste node (ưu tiên hơn paste image clipboard).
      // Paste image vẫn hoạt động qua `_bindCanvasPasteHandler` (paste event) khi
      // _nodeClipboard rỗng — handler đó tự check.
      if (isMod && lowerKey === 'v' && !readOnly && !e.shiftKey && !e.altKey) {
        // Skip paste-node nếu focus trong form — user đang paste text vào textarea/input
        if (focusInForm) return;
        const clip = this._nodeClipboard;
        if (clip?.nodes?.length || clip?.data) {
          // Bug fix: KHÔNG preventDefault ở keydown — sẽ chặn paste event → không paste được ảnh local
          // sau khi copy node. Để paste event (_bindCanvasPasteHandler) quyết: có ẢNH → paste ảnh,
          // không → paste node. Fallback: paste event không fire (~80ms) thì paste node ở đây.
          const _pasteReqAt = Date.now();
          this._pendingNodePasteAt = _pasteReqAt;
          setTimeout(() => {
            if (this._pendingNodePasteAt !== _pasteReqAt) return;   // có request paste mới hơn
            if ((this._pasteHandledAt || 0) >= _pasteReqAt) return; // paste event đã xử lý → thôi
            this._pendingNodePasteAt = 0;
            if (clip?.nodes?.length) this._pasteNodesFromClipboard();
            else if (clip?.data) this._pasteNodeFromClipboard();
          }, 80);
        }
      }
    };
    // Bug fix 2026-06-03: capture=true → my keyHandler fire TRƯỚC Drawflow library internal
    // keydown handler. Cho phép stopImmediatePropagation chặn Drawflow Delete xóa 1 node
    // độc lập khi multi-select có nhiều node (xem `if (e.key === 'Delete' ...)` ở trên).
    document.addEventListener('keydown', this._keyHandler, true);
  }
  });
})(typeof window !== 'undefined' ? window : this);
