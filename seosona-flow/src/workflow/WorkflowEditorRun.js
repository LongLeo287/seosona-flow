/**
 * WorkflowEditorRun — tách từ WorkflowEditor.js (đợt 3).
 *
 * Cụm CHẠY workflow ngay trong cửa sổ editor: chạy nhóm note, chạy 1 node,
 * preflight trước khi chạy, chạy cả workflow, và reset kết quả.
 * Augment prototype nên hành vi KHÔNG đổi. PHẢI nạp SAU WorkflowEditor.js.
 */
(function (root) {
  'use strict';
  var WE = root.WorkflowEditor;
  if (!WE || !WE.prototype) {
    console.error('[WorkflowEditorRun] WorkflowEditor chưa nạp — phải đặt script này SAU WorkflowEditor.js');
    return;
  }
  Object.assign(WE.prototype, {
  // === Execution UI Methods ===

  // Port 1.1.58 NOTE_GROUP_RUN: chạy CHỈ các node nằm trong khung note (nodeIds = actual node_id từ
  // DiagramCanvas.getNodeIdsInNote). Đã STRIP block featureGate/quota/upgrade (local mode). Giữ core:
  // persist form → save → lọc group enabled → preflight (scoped group) → refcheck → execute(onlyNodeIds).
  async _runNoteGroup(noteId, nodeIds) {
    if (this.isTemplateMode) return;
    if (this.isReadOnly && this.isReadOnly()) return;
    if (!this.workflow?.wf_id) {
      window.customDialog?.alert(window.I18n?.t('workflow.saveBeforeRun') || 'Vui lòng lưu workflow trước khi chạy node.', { type: 'warning' });
      return;
    }
    if (this._isRunPendingGroup) return;
    this._isRunPendingGroup = true;
    try {
      await this._persistOpenNodeFormIfDirty();
      const saveSuccess = await this.saveWorkflow({ skipIfClean: true });
      if (!saveSuccess) { this._isRunPendingGroup = false; return; }

      const wanted = new Set((nodeIds || []).map(String));
      const groupNodes = this._getAllNodeData().filter(n => n && wanted.has(String(n.node_id)) && n.enabled !== false);
      if (!groupNodes.length) {
        window.customDialog?.alert(window.I18n?.t('workflow.noteGroupEmpty') || 'Note này không bọc node nào để chạy.', { type: 'warning' });
        this._isRunPendingGroup = false;
        return;
      }

      // Preflight CHỈ node group (provider scoped: group Flow không bật tab ChatGPT/Grok thừa).
      const preflight = await this._preflightCheck(groupNodes);
      if (!preflight.ready) { this._isRunPendingGroup = false; return; }

      const missingCheck = await this._checkRefFilesExist(groupNodes);
      if (missingCheck) {
        await window.customDialog.alert(missingCheck, { type: 'warning', title: window.I18n?.t('workflow.missingRefTitle') || 'Thiếu ảnh tham chiếu' });
        this._isRunPendingGroup = false;
        return;
      }

      this._formUploadKeys?.clear();
      await this.hideNodeForm();

      const logPanel = this.overlay?.querySelector('#executionLogPanel');
      logPanel?.classList.remove('hidden');
      this._addLogEntry((window.I18n?.t('workflow.runningNoteGroup', { count: groupNodes.length }) || `Chạy nhóm note (${groupNodes.length} node)...`), 'info');

      // ensureFlowTabActive nếu group có Flow node.
      const flowNodeTypes = ['generate', 'download', 'image', 'telegram', 'delay'];
      if (groupNodes.some(n => flowNodeTypes.includes(n.node_type || n.type))) {
        try { await new Promise(r => chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }, () => r())); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_runNoteGroup', _); }
      }

      const onlyNodeIds = groupNodes.map(n => String(n.node_id));
      this._isRunPendingGroup = false; // execute fire-and-forget
      window.workflowExecutor.execute(this.workflow.wf_id, { onlyNodeIds, manualSubmitMode: preflight.manualSubmitMode === true }).catch((err) => {
        if (err?.code === 'CROSS_CONTEXT_RUNNING') {
          window.customDialog?.alert(err.message, { type: 'warning' });
        } else {
          console.error('[WorkflowEditor] run note group execute() failed:', err);
        }
      });
    } catch (e) {
      console.error('[WorkflowEditor] _runNoteGroup error:', e);
      this._isRunPendingGroup = false;
    }
  },

  async _runSingleNode(drawflowId) {
    // EWT-6: Template mode không hỗ trợ execution
    if (this.isTemplateMode) return;
    // Read-only mode: không cho phép run
    if (this.isReadOnly()) return;
    if (!this.workflow?.wf_id || !drawflowId) return;

    // Resolve actual node_id from Drawflow internal ID
    const node = this.diagramCanvas?.editor?.getNodeFromId(drawflowId);
    const actualNodeId = node?.data?.node_id;
    if (!actualNodeId) {
      console.error('[SEOSONA Flow] Cannot resolve node_id from drawflow ID:', drawflowId);
      return;
    }

    // [Fix double-modal 2026-06-11] Guard chống double-call. Đồng bộ pattern `_runWorkflowFromEditor`
    // (line ~12151) — handler `.df-node-run-btn` click / `node:run_single` event có thể fire 2 lần
    // (event bubble + emitter trùng) → _runSingleNode chạy parallel 2 instances → mỗi instance gọi
    // _preflightCheck → 2 modal stack chồng DOM → user click Run lần 1 đóng modal trên cùng + submit
    // OK, modal dưới vẫn còn → user tưởng modal không mất → phải click Run lần 2.
    // Flag riêng `_isRunPendingSingle` (KHÔNG dùng `_isRunPending` của _runWorkflowFromEditor) để
    // tránh block: user có thể chạy single node trong khi workflow đang chạy.
    if (this._isRunPendingSingle) {
      console.log('[WorkflowEditor] _runSingleNode skipped - already pending');
      return;
    }
    this._isRunPendingSingle = true;

    try {
    // 2026-06-03 (Option B): Persist pending changes trước khi run.
    // Pass drawflowId của node user run → helper chỉ apply form nếu form đang mở
    // CHÍNH node user run (tránh apply form của node khác → validation throw).
    await this._persistOpenNodeFormIfDirty(drawflowId);

    // Check run limit for workflow (applies to both anonymous and logged-in users)
    if (window.featureGate) {
      const quota = await this._safeCheckQuotaAsync('workflows_run_max');
      console.log('[WorkflowEditor] _runSingleNode workflows_run_max quota check:', quota);
      if (!quota.allowed) {
        const isLoggedIn = window.authManager?.isLoggedIn();
        if (isLoggedIn) {
          const limitText = quota.limit === 'unlimited' ? (window.I18n?.t('common.unlimited') || 'Unlimited') : `${quota.limit} ${window.I18n?.t('workflow.runsPerDay') || 'runs/day'}`;
          const shouldUpgrade = await window.customDialog?.confirm(
            window.I18n?.t('workflow.quotaExhaustedToday', { limit: limitText, used: quota.used }) || `Workflow runs exhausted today.\n\nLimit: ${limitText}\nUsed: ${quota.used} runs\n\nUpgrade to increase limit.`,
            { title: window.I18n?.t('workflow.noMoreRuns') || 'Workflow runs exhausted', confirmText: window.I18n?.t('common.upgrade') || 'Upgrade', cancelText: window.I18n?.t('common.later') || 'Later' }
          );
          if (shouldUpgrade) {
            this._openUpgradeModal();
          }
        } else {
          window.featureGate.showLoginPrompt(window.I18n?.t('workflow.trialRunLimit') || 'Bạn đã sử dụng hết lượt chạy workflow trong bản dùng thử.');
        }
        return;
      }

      // GP-6.3 / GP-6.4: Check global quota warning/exhausted
      const quotaCheck = window.featureGate.checkGlobalQuotaWarning('Workflow');
      if (quotaCheck.exhausted) {
        return; // Dialog đã hiển thị bởi FeatureGate
      }
    }

    if (window.workflowExecutor?.isRunning) {
      const forceStop = await window.customDialog.confirm(
        window.I18n?.t('workflow.anotherRunningForceStop') ||
        'Có workflow đang chạy trong context này. Bạn có muốn force stop để chạy workflow mới?',
        {
          type: 'warning',
          title: window.I18n?.t('workflow.anotherRunningTitle') || 'Workflow đang chạy',
          confirmText: window.I18n?.t('workflow.forceStop') || 'Force Stop',
          cancelText: window.I18n?.t('common.cancel') || 'Hủy'
        }
      );
      if (forceStop) {
        window.workflowExecutor.shouldStop = true;
        window.workflowExecutor.isRunning = false;
        await window.WorkflowExecutor?.clearCrossContextRunning?.();
        console.log('[WorkflowEditor] Force stopped local running workflow');
      } else {
        this._isRunPending = false;
        return;
      }
    }

    // Cross-context check: verify no workflow is running in sidebar/other popup.
    // Gap 2 fix: dùng helper TTL-aware (auto-clear nếu flag stale >30 phút).
    try {
      const running = await window.WorkflowExecutor?.getCrossContextRunning?.();
      if (running?.wf_id) {
        const runningName = running.wf_name || 'Workflow';
        const forceStop = await window.customDialog.confirm(
          window.I18n?.t('workflow.anotherRunningCrossContextForceStop', { name: runningName }) ||
          `"${runningName}" đang chạy ở cửa sổ khác. Bạn có muốn force stop để chạy workflow mới?`,
          {
            type: 'warning',
            title: window.I18n?.t('workflow.anotherRunningTitle') || 'Workflow đang chạy',
            confirmText: window.I18n?.t('workflow.forceStop') || 'Force Stop',
            cancelText: window.I18n?.t('common.cancel') || 'Hủy'
          }
        );
        if (forceStop) {
          await window.WorkflowExecutor?.clearCrossContextRunning?.();
          console.log('[WorkflowEditor] Force stopped cross-context running workflow:', runningName);
        } else {
          return;
        }
      }
    } catch (e) {
      console.warn('[WorkflowEditor] Cross-context running check failed:', e.message);
    }

    // Check ref_file_ids exist on Flow before running
    const refBefore = node?.data?.ref_file_ids;
    const missingCheck = await this._checkRefFilesExist([node?.data]);
    if (missingCheck) {
      await window.customDialog.alert(missingCheck, { type: 'warning', title: window.I18n?.t('workflow.missingRefTitle') || 'Thiếu ảnh tham chiếu' });
      return;
    }

    // Bug fix: Sync data của node có form đang mở TRƯỚC KHI save workflow.
    // Case: user mở form Image Node, thay đổi ảnh, click vào Google Flow Node (chỉ select),
    // rồi click Run. Form vẫn hiển thị content của Image Node, nhưng selectedNodeId = Google Flow.
    // Nếu không sync data của Image Node, ảnh cũ sẽ được save và sử dụng.
    const formPanel = this.overlay?.querySelector('#nodeFormPanel');
    const isFormOpen = formPanel && !formPanel.classList.contains('hidden');
    if (isFormOpen && this._formNodeId) {
      // Sync data cho node có form đang mở (có thể khác với node đang run)
      const formNode = this.diagramCanvas?.editor?.getNodeFromId(this._formNodeId);
      if (formNode) {
        // Sync reuploaded ref_file_ids vào DOM form input (tránh _applyNodeFormData overwrite)
        if (String(this._formNodeId) === String(drawflowId)) {
          if (node?.data?.ref_file_ids && node.data.ref_file_ids !== refBefore) {
            const refInput = this.overlay?.querySelector('#nodeRefFileIds');
            if (refInput) refInput.value = node.data.ref_file_ids;
          }
        }
        this._applyNodeFormData(this._formNodeId);
      }
    }
    // Ẩn node form panel để không che canvas (force — đang chạy node)
    this._formUploadKeys?.clear();
    await this.hideNodeForm();

    // Wait for any concurrent save to finish before starting our save
    if (this._isSaving) {
      const waitStart = Date.now();
      while (this._isSaving && Date.now() - waitStart < 5000) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Save workflow trước (skipIfClean: bỏ full-save thừa khi không có thay đổi — tránh 429
    // khi Run → cancel preflight → Run lại). Node đã saved trước đó vẫn nằm trong this.workflow.
    await this.saveWorkflow({ skipIfClean: true });

    // Verify the node exists in saved workflow before executing
    if (!this.workflow?.nodes?.find(n => n.node_id === actualNodeId)) {
      console.error('[SEOSONA Flow] Node not found in saved workflow after save:', actualNodeId);
      const errLogPanel = this.overlay?.querySelector('#executionLogPanel');
      errLogPanel?.classList.remove('hidden');
      this._addLogEntry(window.I18n?.t('workflow.nodeNotFoundAfterSave') || 'Lỗi: Không tìm thấy node sau khi lưu. Hãy lưu workflow và thử lại.', 'error');
      return;
    }

    // Preflight check for single node — show modal with provider status
    const nodeData = this.workflow?.nodes?.find(n => n.node_id === actualNodeId);
    let _preflightManual = false;
    if (nodeData) {
      const preflight = await this._preflightCheck([nodeData]);
      if (!preflight.ready && preflight.skipped) {
        return;
      }
      _preflightManual = preflight.manualSubmitMode === true;
    }

    // Hiện log panel
    const logPanel = this.overlay?.querySelector('#executionLogPanel');
    logPanel?.classList.remove('hidden');

    this._addLogEntry(window.I18n?.t('workflow.rerunningNode') || 'Chạy lại node...', 'info');

    // Reset node status về pending trước khi chạy (soft-fail ok)
    try {
      if (window.storageManager) {
        await window.storageManager.updateNodeStatus(this.workflow.wf_id, actualNodeId, { status: 'pending', result_file_ids: '' });
      }
    } catch (e) {
      console.warn('[SEOSONA Flow] Reset node status failed (non-critical):', e.message);
    }

    // Chạy lại node này thì kết quả MỌI node phía sau không còn đúng nữa — phải xoá,
    // nếu không chế độ resume sẽ bỏ qua chúng (status='completed') và workflow báo
    // "xong" trong khi video vẫn dựng từ ảnh cũ. Sai âm thầm, tốn credit.
    try {
      const cleared = this.executor?.invalidateDownstream?.(actualNodeId, this.workflow) || [];
      if (cleared.length) {
        this._addLogEntry(`Đã xoá kết quả ${cleared.length} node phía sau để chạy lại cho khớp.`, 'warn');
        cleared.forEach((id) => { try { this._updateNodeStatusUI?.(id, 'pending'); } catch (_e) { globalThis.SEOSONA_swallow?.('WorkflowEditorRun#_runSingleNode', _e); } });
        await this.saveWorkflow({ skipIfClean: false });
      }
    } catch (e) {
      console.warn('[SEOSONA Flow] invalidateDownstream failed (non-critical):', e.message);
    }

    // Set flag to record usage AFTER node completes successfully
    if (window.featureGate) {
      window.featureGate.setPendingWorkflowRun();
    }

    // Ensure Flow tab is active before execution (popup windows need this)
    try {
      await new Promise(resolve => {
        chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }, () => resolve());
      });
    } catch (e) {
      console.warn('[WorkflowEditor] ensureFlowTabActive failed:', e.message);
    }

    // Execute single node
    try {
      await window.workflowExecutor.executeSingleNode(this.workflow.wf_id, actualNodeId, { manualSubmitMode: _preflightManual });
    } catch (error) {
      this._addLogEntry(window.I18n?.t('workflow.errorPrefix', { message: error.message }) || `Lỗi: ${error.message}`, 'error');
    }
    } finally {
      // [Fix double-modal 2026-06-11] CRITICAL — reset flag mọi exit path (success/error/early return).
      // Tránh stuck pending state nếu function throw bất ngờ → user không bao giờ run được nữa.
      this._isRunPendingSingle = false;
    }
  },

  /**
   * Pre-flight check: Kiểm tra các provider tabs đã sẵn sàng chưa trước khi run workflow.
   * Tự động activate tab và poll status nếu chưa ready.
   * @param {Array} nodes - Array of node data
   * @returns {Promise<{ready: boolean, providers: Object}>}
   */
  /**
   * Cổng chặn ảnh tham chiếu: node gen nào lấy ref từ upstream mà upstream CHƯA có
   * kết quả thì chặn TRƯỚC khi gửi request.
   *
   * Không có cổng này thì Flow vẫn gen — chỉ là gen thiếu ref, ra sai nhân vật/sai
   * bối cảnh, và ta chỉ biết sau khi đã đốt credit. Bắt ở đây rẻ hơn hẳn.
   *
   * Chỉ xét node ĐANG CHẠY LẦN NÀY (`nodes`): nếu upstream cũng nằm trong danh sách
   * thì nó sẽ chạy trước và tự có kết quả — không được báo thiếu.
   * @returns {{name:string, from:string}[]} danh sách thiếu
   */
  _findMissingRefs(nodes) {
    const wf = this.workflow;
    if (!wf?.nodes || !wf?.edges) return [];
    const REF_PORTS = ['input_1', 'image', 'ref', 'reference'];
    const willRun = new Set(nodes.filter((n) => n.enabled !== false).map((n) => n.node_id));
    const byId = new Map(wf.nodes.map((n) => [n.node_id, n]));
    const hasResult = (n) => !!(n && (n.result_file_ids || n.result_thumbnails || n.result_text));
    const missing = [];
    for (const node of nodes) {
      if (node.enabled === false) continue;
      const t = node.node_type || node.class;
      if (t !== 'generate' && t !== 'image') continue;
      for (const e of wf.edges) {
        if (e.target_node_id !== node.node_id) continue;
        if (!REF_PORTS.includes(e.target_port || 'input_1')) continue;
        const src = byId.get(e.source_node_id);
        if (!src || src.enabled === false) continue;
        // Upstream cũng chạy trong lượt này → nó sẽ có kết quả trước, không tính thiếu.
        if (willRun.has(src.node_id)) continue;
        if (!hasResult(src)) {
          missing.push({ name: node.node_name || node.node_id, from: src.node_name || src.node_id });
        }
      }
    }
    return missing;
  },

  async _preflightCheck(nodes) {
    const I = window.I18n;
    const PM = window.ProviderMeta;

    // Chặn TRƯỚC mọi kiểm tra provider: thiếu ref thì có mở tab Flow cũng vô nghĩa.
    const missingRefs = this._findMissingRefs(nodes);
    if (missingRefs.length) {
      const lines = missingRefs.slice(0, 6).map((m) => `• "${m.name}" cần ảnh từ "${m.from}"`).join('\n');
      const more = missingRefs.length > 6 ? `\n… và ${missingRefs.length - 6} node nữa` : '';
      const msg = `Thiếu ảnh tham chiếu — dừng trước khi gửi để khỏi tốn credit:\n\n${lines}${more}\n\nChạy các node nguồn trước, hoặc chạy cả workflow.`;
      console.warn('[WorkflowEditor] preflight CHẶN — thiếu ref:', missingRefs);
      try {
        await window.customDialog?.alert?.(msg, I?.t?.('workflow.missingRefTitle') || 'Thiếu ảnh tham chiếu');
      } catch (_e) { globalThis.SEOSONA_swallow?.('WorkflowEditorRun#_preflightCheck', _e); }
      return { ready: false, skipped: true, reason: 'MISSING_REFS', missingRefs };
    }
    const providerLabels = {
      flow: PM?.getName?.('flow') || 'Flow',
      chatgpt: PM?.getName?.('chatgpt') || 'ChatGPT',
      grok: PM?.getName?.('grok') || 'Grok',
      gemini: PM?.getName?.('gemini') || 'Gemini',
    };

    // Extract unique providers từ enabled nodes
    const providersUsed = new Set();
    for (const node of nodes) {
      if (node.enabled === false) continue;
      const nodeType = node.node_type || node.class;
      if (nodeType === 'image' || nodeType === 'generate') {
        providersUsed.add('flow');
      } else if (nodeType === 'chatgpt') {
        // [Bug 65 fix v2 2026-05-24] Schema flat top-level — `node.provider` (KHÔNG nested data)
        providersUsed.add(node.provider || 'chatgpt');
      } else if (nodeType === 'grok') {
        providersUsed.add('grok');
      } else if (nodeType === 'prompt' && node.use_ai === true) {
        // AI Agent rename (2026-05-30): schema flat top-level — KHÔNG có nested `node.data`.
        // Verified runtime: node.use_ai (boolean) + node.provider ('chatgpt'|'gemini').
        providersUsed.add(node.provider || 'chatgpt');
      }
    }
    console.log('[WorkflowEditor] _preflightCheck: providers used:', [...providersUsed]);

    if (providersUsed.size === 0) {
      console.log('[WorkflowEditor] _preflightCheck: no providers, returning ready');
      return { ready: true, providers: {} };
    }

    // Helper: check provider status
    const checkProviderStatus = async (provider) => {
      try {
        if (provider === 'flow') {
          const resp = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: 'checkFlowTabOpen' }, r => resolve(r));
          });
          return { ready: !!resp?.isOpen, tabId: resp?.tabId };
        } else if (provider === 'chatgpt') {
          // Use ensureReady with createIfMissing=false to just check status
          // [Bug 62 fix 2026-05-24] silent: true skip emit chatgpt:login_required event — status check
          // UI hiển thị trực tiếp, KHÔNG cần dialog "Mở tab" pop spam.
          if (!window.ChatGPTSession?.ensureReady) return { ready: false };
          const result = await window.ChatGPTSession.ensureReady({ createIfMissing: false, activate: false, silent: true }).catch(() => ({ ready: false }));
          return { ready: result?.ready === true, tabId: result?.tabId, error: result?.error };
        } else if (provider === 'grok') {
          // [Bug 62 fix 2026-05-24] silent: true cho preflight status check
          if (!window.GrokSession?.ensureReady) return { ready: false };
          const result = await window.GrokSession.ensureReady({ createIfMissing: false, activate: false, silent: true }).catch(() => ({ ready: false }));
          return { ready: result?.ready === true, tabId: result?.tabId, error: result?.error };
        } else if (provider === 'gemini') {
          if (!window.GeminiSession?.ensureReady) return { ready: false };
          const result = await window.GeminiSession.ensureReady({ createIfMissing: false, activate: false }).catch(() => ({ ready: false }));
          return { ready: result?.ready === true, tabId: result?.tabId, error: result?.error };
        }
        return { ready: false };
      } catch (err) {
        return { ready: false, error: err.message };
      }
    };

    // Initial check
    const providerStatus = {};
    for (const provider of providersUsed) {
      providerStatus[provider] = await checkProviderStatus(provider);
    }
    console.log('[WorkflowEditor] _preflightCheck: initial status:', providerStatus);

    // Check not ready providers (for activation attempt)
    const notReady = Object.entries(providerStatus).filter(([_, v]) => !v.ready);
    // [UX Improvement] Always show modal to let user confirm before running
    // (user yêu cầu giữ modal để xem provider status trước khi confirm).
    // Bug "modal stuck" đã fix riêng qua: cleanup `style.display='none'` ngay +
    // idempotent flag `done` ngăn double-click trigger execute 2 lần.
    console.log('[WorkflowEditor] _preflightCheck: not ready providers:', notReady.map(([p]) => p));

    // Try to activate tabs for not-ready providers (fire-and-forget)
    console.log('[WorkflowEditor] _preflightCheck: activating providers:', notReady.map(([p]) => p));
    for (const [provider] of notReady) {
      if (provider === 'flow') {
        // Flow: try to activate existing tab or open new one
        chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#renderStatus', _e); });
      } else if (provider === 'chatgpt' && window.ChatGPTSession?.ensureReady) {
        window.ChatGPTSession.ensureReady().catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#renderStatus', _e); });
      } else if (provider === 'grok' && window.GrokSession?.ensureReady) {
        window.GrokSession.ensureReady().catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#renderStatus', _e); });
      } else if (provider === 'gemini' && window.GeminiSession?.ensureReady) {
        window.GeminiSession.ensureReady().catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#renderStatus', _e); });
      }
    }

    // Show modal with real-time status polling
    console.log('[WorkflowEditor] _preflightCheck: showing provider status modal');
    // Phase 5 (Manual Submit): switch Auto/Manual CHỈ hiện khi có node generate Flow (node submit thật —
    // image node chỉ upload ref, không submit). Init theo setting manualSubmitMode (default false → auto).
    // Reuse CSS .confirm-submitmode-* (sidebar.css).
    const hasFlow = nodes.some(n => n.enabled !== false && (n.node_type || n.class) === 'generate');
    let _submitModeManual = hasFlow && !!window.storageSettings?.getSettings?.().manualSubmitMode;
    const _t = (k, fb) => (I?.t?.(k) || fb);
    const submitModeHtml = hasFlow ? `
            <div class="confirm-run-submitmode-row" id="wfPreflightSubmitModeRow" style="margin-top:12px; display:flex; flex-direction:column; gap:6px;">
              <span class="confirm-run-submitmode-title" style="font-size:11px; font-weight:600; color:var(--muted-foreground,#8b8b92);">${_t('dialog.runSubmitModeLabel', 'Chế độ submit')}</span>
              <div class="confirm-submitmode-switch" id="wfPreflightSubmitModeSwitch" role="tablist">
                <button type="button" class="confirm-submitmode-btn" data-value="auto" role="tab" data-tooltip="${_t('dialog.runSubmitModeAutoTooltip', 'SEOSONA Flow tự động nhấn submit sau khi điền prompt + ref (nhanh, nhưng Flow dễ nhận diện hành vi tự động khi chạy liên tục).')}" data-tooltip-placement="top" data-tooltip-align="auto">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  <span>${_t('dialog.runSubmitModeAuto', 'Tự động submit')}</span>
                </button>
                <button type="button" class="confirm-submitmode-btn" data-value="manual" role="tab" data-tooltip="${_t('dialog.runSubmitModeManualTooltip', 'SEOSONA Flow điền prompt + ảnh, bạn tự Enter/Click Submit cho từng prompt. Thao tác giúp hạn chế Google Flow cảnh báo lỗi hành vi bất thường.')}" data-tooltip-placement="top" data-tooltip-align="auto">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V6a2 2 0 0 1 4 0v5"/><path d="M13 7a2 2 0 0 1 4 0v6"/><path d="M17 9a2 2 0 0 1 4 0v5a7 7 0 0 1-7 7h-2a7 7 0 0 1-6.3-3.9L3 17a2 2 0 0 1 3.4-2l1.6 2"/></svg>
                  <span>${_t('dialog.runSubmitModeManual', 'Tự nhấn Enter')}</span>
                </button>
              </div>
              <span class="confirm-run-submitmode-hint" id="wfPreflightSubmitModeHint"></span>
            </div>` : '';
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-run-overlay';
      overlay.innerHTML = `
        <div class="confirm-run-modal" style="min-width: 320px;">
          <div class="confirm-run-header">
            <span class="confirm-run-title">${I?.t('workflow.preflightTitle') || 'AI Provider Status'}</span>
          </div>
          <div class="confirm-run-body">
            <div class="confirm-run-provider-status" id="wfPreflightStatus"></div>${submitModeHtml}
          </div>
          <div class="confirm-run-footer">
            <button class="btn btn-secondary" id="wfPreflightCancel">${I?.t('common.cancel') || 'Hủy'}</button>
            <button class="btn btn-primary" id="wfPreflightRun">${I?.t('workflow.preflightContinue') || 'Chạy'}</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
      setTimeout(() => overlay.classList.add('visible'), 10);

      // Wire submit mode switch (chỉ khi có Flow). Auto-persist manualSubmitMode khi user click.
      if (hasFlow) {
        const smSwitch = overlay.querySelector('#wfPreflightSubmitModeSwitch');
        const smHint = overlay.querySelector('#wfPreflightSubmitModeHint');
        const smBtns = smSwitch ? smSwitch.querySelectorAll('.confirm-submitmode-btn') : [];
        const applyMode = (mode) => {
          smBtns.forEach(b => {
            const on = b.dataset.value === mode;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
          });
          if (smHint) {
            if (mode === 'manual') {
              smHint.textContent = _t('dialog.runSubmitModeManualHint', 'Bạn tự nhấn Enter cho mỗi prompt — thao tác thật giúp hạn chế Google Flow phát hiện bot.');
              smHint.classList.add('is-manual');
            } else {
              smHint.textContent = _t('dialog.runSubmitModeAutoHint', 'SEOSONA Flow tự động submit sau khi điền prompt + ref.');
              smHint.classList.remove('is-manual');
            }
          }
        };
        smBtns.forEach(b => {
          b.onclick = () => {
            _submitModeManual = b.dataset.value === 'manual';
            applyMode(b.dataset.value);
            // Auto-persist default user setting (đồng bộ GenTab) — CHỈ khi user click, không phải init.
            try { window.storageSettings?.set?.('manualSubmitMode', _submitModeManual); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowEditor#onclick', _); }
          };
        });
        applyMode(_submitModeManual ? 'manual' : 'auto'); // init — KHÔNG persist
      }

      const statusEl = overlay.querySelector('#wfPreflightStatus');
      let pollTimer = null;
      let allReady = false;

      const renderStatus = () => {
        let html = '';
        // [Bug 66 fix 2026-05-24] Phân biệt states: ready / not_logged_in / cloudflare / no_tab / checking
        const iconCheck = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#19d07b" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        const iconSpin = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path></svg>';
        const iconWarn = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
        for (const provider of providersUsed) {
          const st = providerStatus[provider];
          const label = providerLabels[provider] || provider;
          let iconSvg = iconSpin;
          let statusText = I?.t('common.checking') || 'Checking...';
          let badgeClass = 'is-checking';
          if (st?.ready) {
            iconSvg = iconCheck;
            statusText = I?.t('common.ready') || 'Ready';
            badgeClass = 'is-ready';
          } else if (st && st.ready === false) {
            iconSvg = iconWarn;
            badgeClass = 'is-warning';
            if (st.error === 'NOT_LOGGED_IN') {
              statusText = I?.t('gen.providerStatusLogin') || 'Chưa đăng nhập';
            } else if (st.error === 'NO_TAB' || st.error === 'EDITOR_NOT_FOUND') {
              statusText = I?.t('workflow.providerNoTab') || 'Chưa mở tab';
            } else if (st.cloudflareChallenge || st.error === 'CLOUDFLARE') {
              statusText = I?.t('gen.providerStatusCloudflare') || 'Chờ Cloudflare...';
            } else {
              statusText = I?.t('gen.providerStatusLogin') || 'Chưa sẵn sàng';
            }
          }
          html += `<div class="confirm-run-provider-badge ${badgeClass}">
            <span class="badge-provider">${iconSvg} ${label}</span>
            <span class="badge-status">${statusText}</span>
          </div>`;
        }
        statusEl.innerHTML = html;

        // Check if all ready now
        allReady = [...providersUsed].every(p => providerStatus[p]?.ready);

        // Update button text based on ready state
        const runBtn = overlay.querySelector('#wfPreflightRun');
        if (runBtn) {
          runBtn.textContent = allReady
            ? (I?.t('common.run') || 'Run')
            : (I?.t('workflow.runAnyway') || 'Run Anyway');
        }
      };

      // K.8 (2026-05-29): idempotent guard chặn double-click race.
      // CSS .confirm-run-overlay không có transition/.visible style → cleanup
      // remove('visible') no-op → modal visual stuck 200ms → user click button
      // lần 2 trong window này. Flag `done` ngăn cleanup chạy 2 lần + ngăn
      // duplicate resolve.
      let done = false;

      const pollStatus = async () => {
        for (const provider of providersUsed) {
          if (!providerStatus[provider]?.ready) {
            providerStatus[provider] = await checkProviderStatus(provider);
          }
        }
        renderStatus();

        // 2026-05-31 fix: BỎ K.8 auto-resolve. Trước: khi tất cả providers ready (poll detect)
        // → modal tự đóng + tự resolve(ready) → user bị "tự click Run" không kịp xác nhận.
        // User bug report: "modal reconfirm xuất hiện, chưa click run đã tự click tự chạy luôn".
        // Sau fix: chỉ stop polling khi all ready để tiết kiệm CPU, GIỮ modal — đợi user click
        // "Run" thực sự. Icon ✅ next to provider name đã đủ visual feedback.
        if (allReady && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };

      renderStatus();
      pollTimer = setInterval(pollStatus, 2000);

      const cleanup = () => {
        if (pollTimer) clearInterval(pollTimer);
        // K.8: hide ngay bằng inline style (CSS .visible chưa khai báo style → remove no-op).
        overlay.classList.remove('visible');
        overlay.style.display = 'none';
        setTimeout(() => overlay.remove(), 200);
      };

      overlay.querySelector('#wfPreflightCancel').addEventListener('click', () => {
        if (done) return;
        done = true;
        console.log('[WorkflowEditor] _preflightCheck: user cancelled');
        cleanup();
        resolve({ ready: false, providers: providerStatus, skipped: true, manualSubmitMode: false });
      });

      overlay.querySelector('#wfPreflightRun').addEventListener('click', (e) => {
        if (done) return;
        done = true;
        // Disable button + visual feedback ngăn double-click.
        e.currentTarget.disabled = true;
        e.currentTarget.style.opacity = '0.5';
        console.log('[WorkflowEditor] _preflightCheck: user clicked Run');
        cleanup();
        resolve({ ready: true, providers: providerStatus, manualSubmitMode: hasFlow ? _submitModeManual : false });
      });
    });
  },

  async _runWorkflowFromEditor() {
    // EWT-6: Template mode không hỗ trợ execution
    if (this.isTemplateMode) return;
    // Read-only mode: không cho phép run
    if (this.isReadOnly()) return;
    if (!this.workflow?.wf_id) return;
    // Guard: prevent duplicate concurrent runs
    if (this._isRunPending) {
      console.log('[WorkflowEditor] _runWorkflowFromEditor skipped - already pending');
      return;
    }
    this._isRunPending = true;

    // CRITICAL — bọc try/finally để reset _isRunPending mọi exit path (đồng bộ _runSingleNode:13690).
    // Trước: reset thủ công ở 13 return → await nào throw (save/preflight/checkRef) → flag kẹt true
    // vĩnh viễn → click Run "skipped - already pending" (đơ), phải đóng/mở lại editor mới chạy.
    try {
    // Check run limit for workflow (applies to both anonymous and logged-in users)
    if (window.featureGate) {
      const quota = await this._safeCheckQuotaAsync('workflows_run_max');
      console.log('[WorkflowEditor] workflows_run_max quota check:', quota);
      if (!quota.allowed) {
        const isLoggedIn = window.authManager?.isLoggedIn();
        if (isLoggedIn) {
          const limitText = quota.limit === 'unlimited' ? (window.I18n?.t('common.unlimited') || 'Unlimited') : `${quota.limit} ${window.I18n?.t('workflow.runsPerDay') || 'runs/day'}`;
          const shouldUpgrade = await window.customDialog?.confirm(
            window.I18n?.t('workflow.quotaExhaustedToday', { limit: limitText, used: quota.used }) || `Workflow runs exhausted today.\n\nLimit: ${limitText}\nUsed: ${quota.used} runs\n\nUpgrade to increase limit.`,
            { title: window.I18n?.t('workflow.noMoreRuns') || 'Workflow runs exhausted', confirmText: window.I18n?.t('common.upgrade') || 'Upgrade', cancelText: window.I18n?.t('common.later') || 'Later' }
          );
          if (shouldUpgrade) {
            this._openUpgradeModal();
          }
        } else {
          window.featureGate.showLoginPrompt(window.I18n?.t('workflow.trialRunLimit') || 'Bạn đã sử dụng hết lượt chạy workflow trong bản dùng thử.');
        }
        this._isRunPending = false;
        return;
      }

      // GP-6.3 / GP-6.4: Check global quota warning/exhausted
      const quotaCheck = window.featureGate.checkGlobalQuotaWarning('Workflow');
      if (quotaCheck.exhausted) {
        this._isRunPending = false;
        return; // Dialog đã hiển thị bởi FeatureGate
      }
    }

    if (window.workflowExecutor?.isRunning) {
      const forceStop = await window.customDialog.confirm(
        window.I18n?.t('workflow.anotherRunningForceStop') ||
        'Có workflow đang chạy trong context này. Bạn có muốn force stop để chạy workflow mới?',
        {
          type: 'warning',
          title: window.I18n?.t('workflow.anotherRunningTitle') || 'Workflow đang chạy',
          confirmText: window.I18n?.t('workflow.forceStop') || 'Force Stop',
          cancelText: window.I18n?.t('common.cancel') || 'Hủy'
        }
      );
      if (forceStop) {
        window.workflowExecutor.shouldStop = true;
        window.workflowExecutor.isRunning = false;
        await window.WorkflowExecutor?.clearCrossContextRunning?.();
        console.log('[WorkflowEditor] Force stopped local running workflow');
      } else {
        this._isRunPending = false;
        return;
      }
    }

    // Cross-context check: verify no workflow is running in sidebar/other popup.
    // Gap 2 fix: dùng helper TTL-aware (auto-clear nếu flag stale >30 phút).
    try {
      const running = await window.WorkflowExecutor?.getCrossContextRunning?.();
      if (running?.wf_id) {
        const runningName = running.wf_name || 'Workflow';
        const forceStop = await window.customDialog.confirm(
          window.I18n?.t('workflow.anotherRunningCrossContextForceStop', { name: runningName }) ||
          `"${runningName}" đang chạy ở cửa sổ khác. Bạn có muốn force stop để chạy workflow mới?`,
          {
            type: 'warning',
            title: window.I18n?.t('workflow.anotherRunningTitle') || 'Workflow đang chạy',
            confirmText: window.I18n?.t('workflow.forceStop') || 'Force Stop',
            cancelText: window.I18n?.t('common.cancel') || 'Hủy'
          }
        );
        if (forceStop) {
          await window.WorkflowExecutor?.clearCrossContextRunning?.();
          console.log('[WorkflowEditor] Force stopped cross-context running workflow:', runningName);
        } else {
          this._isRunPending = false;
          return;
        }
      }
    } catch (e) {
      console.warn('[WorkflowEditor] Cross-context running check failed:', e.message);
    }

    // Check if workflow has completed nodes → ask resume or rerun (consistent with sidebar)
    // Fetch fresh data from storage to avoid stale check (workflow may have been run/reset from other context)
    let hasCompletedNodes = false;
    try {
      const freshWorkflow = await window.storageManager?.getWorkflow(this.workflow.wf_id);
      hasCompletedNodes = (freshWorkflow?.nodes || []).some(n => n.status === 'completed');
    } catch (e) {
      // Fallback to local data if storage fetch fails
      hasCompletedNodes = (this.workflow?.nodes || []).some(n => n.status === 'completed');
    }
    if (hasCompletedNodes) {
      // K.17 (2026-05-29): 3-button modal (Continue / Re-run / Cancel). Phase 5 (2026-07-08): dùng
      // customDialog.confirmResumeOrRerun (thêm close icon X + dismiss ESC/overlay = Hủy). Trả 'resume'|'rerun'|null.
      const choice = await window.customDialog.confirmResumeOrRerun(
        window.I18n?.t('workflow.resumeOrRerun', { name: this.workflow.wf_name }) ||
        `Workflow "${this.workflow.wf_name}" có node đã hoàn thành.\nBấm "Tiếp tục" để chạy từ node chưa xong, "Chạy lại" để reset, hoặc "Hủy" để đóng.`,
        { title: window.I18n?.t('workflow.resumeOrRerunTitle') || 'Tiếp tục hay chạy lại?' }
      );
      if (choice === null) {
        // User abort (Hủy / X / ESC) — không reset, không continue
        this._isRunPending = false;
        return;
      }
      if (choice === 'rerun') {
        // Rerun from beginning → reset workflow
        await this._resetWorkflowFromEditor();
        // Don't continue - user will need to click Run again after reset
        this._isRunPending = false;
        return;
      }
      // choice === 'resume' → fallthrough chạy từ node chưa xong
    }

    // Check for empty workflow (no executable nodes)
    const allNodeData = this._getAllNodeData();
    const executableNodes = allNodeData.filter(n => n.node_type !== 'start' && n.node_type !== 'note');
    if (executableNodes.length === 0) {
      window.customDialog?.alert(
        window.I18n?.t('workflow.noExecutableNodes') || 'Workflow chưa có node nào để chạy.',
        { type: 'warning', title: window.I18n?.t('workflow.cannotRun') || 'Không thể chạy' }
      );
      this._isRunPending = false;
      return;
    }

    // Pre-flight check: kiểm tra provider tabs sẵn sàng
    console.log('[WorkflowEditor] _runWorkflowFromEditor: starting preflight check...');
    const preflight = await this._preflightCheck(allNodeData);
    console.log('[WorkflowEditor] _runWorkflowFromEditor: preflight result:', preflight);
    if (!preflight.ready) {
      console.log('[WorkflowEditor] _runWorkflowFromEditor aborted - preflight check failed or user cancelled');
      this._isRunPending = false;
      return;
    }

    // Phase 4 Task 4.2: Pre-execution mention validation
    const mentionValidation = this._validateAllMentions(allNodeData);
    if (mentionValidation.errors.length > 0) {
      const errorList = mentionValidation.errors.map(e => `• ${e.nodeName}: ${e.message}`).join('\n');
      await window.customDialog.alert(
        `${window.I18n?.t('workflow.mentionValidationFailed') || 'Mention validation failed'}:\n\n${errorList}`,
        { type: 'error', title: window.I18n?.t('workflow.cannotRun') || 'Không thể chạy' }
      );
      this._isRunPending = false;
      return;
    }
    if (mentionValidation.warnings.length > 0) {
      const warningList = mentionValidation.warnings.map(w => `• ${w.nodeName}: ${w.message}`).join('\n');
      const continueAnyway = await window.customDialog.confirm(
        `${window.I18n?.t('workflow.mentionWarnings') || 'Có cảnh báo về mentions'}:\n\n${warningList}\n\n${window.I18n?.t('workflow.continueAnyway') || 'Vẫn tiếp tục?'}`,
        { type: 'warning', title: window.I18n?.t('workflow.mentionWarningTitle') || 'Cảnh báo Mention', confirmText: window.I18n?.t('workflow.runAnyway') || 'Vẫn chạy' }
      );
      if (!continueAnyway) {
        this._isRunPending = false;
        return;
      }
    }

    // Check ref_file_ids exist on Flow before running
    const missingCheck = await this._checkRefFilesExist(allNodeData);
    if (missingCheck) {
      await window.customDialog.alert(missingCheck, { type: 'warning', title: window.I18n?.t('workflow.missingRefTitle') || 'Thiếu ảnh tham chiếu' });
      this._isRunPending = false;
      return;
    }

    // Ẩn node form panel (force — đang chạy workflow)
    this._formUploadKeys?.clear();
    await this.hideNodeForm();

    // Wait for any concurrent save to finish before starting our save
    if (this._isSaving) {
      const waitStart = Date.now();
      while (this._isSaving && Date.now() - waitStart < 5000) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Save workflow before running - MUST succeed before execution.
    // skipIfClean: bỏ full-save thừa khi không có thay đổi (server đã current) — giảm 429.
    console.log('[WorkflowEditor] _runWorkflowFromEditor: saving workflow...');
    const saveSuccess = await this.saveWorkflow({ skipIfClean: true });
    console.log('[WorkflowEditor] _runWorkflowFromEditor: save result:', saveSuccess);
    if (!saveSuccess) {
      console.log('[WorkflowEditor] _runWorkflowFromEditor aborted - save failed');
      this._isRunPending = false;
      return;
    }

    // Set flag to record trial run AFTER workflow completes successfully
    if (window.featureGate) {
      window.featureGate.setPendingWorkflowRun();
    }

    // Check xem workflow có node sử dụng Flow provider không
    // Flow nodes: generate, download, image, telegram, delay
    const flowNodeTypes = ['generate', 'download', 'image', 'telegram', 'delay'];
    const hasFlowNodes = (this.workflow?.nodes || []).some(n =>
      flowNodeTypes.includes(n.node_type || n.type)
    );

    // Ensure Flow tab is active before execution (popup windows need this)
    // Chỉ cần khi có Flow nodes
    if (hasFlowNodes) {
      try {
        await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }, () => resolve());
        });
      } catch (e) {
        console.warn('[WorkflowEditor] ensureFlowTabActive failed:', e.message);
      }
    }

    // Start execution (resume: skip completed nodes)
    console.log('[WorkflowEditor] _runWorkflowFromEditor: calling workflowExecutor.execute...', this.workflow.wf_id);
    this._addLogEntry(window.I18n?.t('workflow.startingWorkflow') || 'Bắt đầu chạy workflow...', 'info');
    // Reset pending flag - execution started
    this._isRunPending = false;
    // Gap 1 fix: execute() giờ throw CROSS_CONTEXT_RUNNING nếu lose race với context khác
    // (cũ chỉ silent overwrite flag → 2 contexts chạy song song). Catch để alert user.
    // Phase 5: truyền Manual Submit mode qua opts (set trong execute try → chống leak automated).
    window.workflowExecutor.execute(this.workflow.wf_id, { manualSubmitMode: preflight.manualSubmitMode === true }).catch((err) => {
      if (err?.code === 'CROSS_CONTEXT_RUNNING') {
        window.customDialog?.alert(err.message, { type: 'warning' });
      } else {
        console.error('[WorkflowEditor] execute() failed:', err);
        this._addLogEntry((window.I18n?.t('workflow.errorPrefix', { message: err.message }) || `Lỗi: ${err.message}`), 'error');
      }
    });
    } finally {
      // execute() là fire-and-forget (không await) → finally chạy ngay sau khi launch; flag=false
      // đúng như reset thủ công ở 14174. Đảm bảo mọi throw path (save/preflight/checkRef) cũng reset.
      this._isRunPending = false;
    }
  },

  async _resetWorkflowFromEditor() {
    // EWT-6: Template mode không hỗ trợ execution/reset
    if (this.isTemplateMode) return;
    // Read-only mode: không cho phép reset
    if (this.isReadOnly()) return;
    if (!this.workflow?.wf_id) return;

    // Check if any workflow is running (local or cross-context).
    // Gap 2 fix: dùng helper TTL-aware (auto-clear nếu flag stale >30 phút).
    const isLocalRunning = window.workflowExecutor?.isRunning;
    let isCrossContextRunning = false;
    try {
      const running = await window.WorkflowExecutor?.getCrossContextRunning?.();
      isCrossContextRunning = !!running?.wf_id;
    } catch (e) { /* ignore */ }

    if (isLocalRunning || isCrossContextRunning) {
      const forceReset = await window.customDialog.confirm(
        window.I18n?.t('workflow.forceResetConfirm') || 'Workflow đang chạy. Force stop và reset?',
        { type: 'warning', confirmText: 'Force Reset', cancelText: window.I18n?.t('common.cancel') || 'Hủy' }
      );
      if (!forceReset) return;
      try {
        // Use stop() with broadcast to notify all contexts
        if (window.workflowExecutor?.stop) {
          window.workflowExecutor.stop(true); // broadcast = true
        } else {
          // Fallback if executor not available
          window.workflowExecutor.shouldStop = true;
          window.workflowExecutor.isRunning = false;
        }
        // Clear cross-context running flag
        chrome.storage.local.remove('af_running_workflow');
        window.MessageBridge?.stopExecution?.().catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_updateNodeStatusUI', _e); });
      } catch (e) { /* ignore */ }
      this.overlay?.classList.remove('wf-executing');
      const toolbarStopBtn = this.overlay?.querySelector('.seosonaflow-wf-tool-btn[data-action="stop-workflow"]');
      toolbarStopBtn?.classList.add('hidden');
    }

    const confirmed = await window.customDialog.confirm(
      window.I18n?.t('workflow.resetConfirm') || 'Reset workflow sẽ xóa toàn bộ kết quả và trạng thái của các node. Bạn có chắc chắn?',
      { type: 'warning', confirmText: 'Reset', cancelText: window.I18n?.t('common.cancel') || 'Hủy' }
    );
    if (!confirmed) return;

    // Set reset guard — block stale node:completed/failed events during reset
    this._resetInProgress = true;

    try {
      // Cancel deferred save timer to prevent stale data re-persistence
      if (this._deferredSaveTimer) {
        clearTimeout(this._deferredSaveTimer);
        this._deferredSaveTimer = null;
        this._updatePlayButtonState();
      }

      // Force close node form to avoid stale data save
      // [Gap H 2026-06-05] Comment cũ ngụ ý discard intent → skipDirtySave
      await this.hideNodeForm({ skipUploadCheck: true, skipDirtySave: true });

      await window.workflowExecutor.reset(this.workflow.wf_id);

      // Clear _tileCache entries từ result (giữ lại ref thumbnails)
      this._clearResultTileCache();

      // Cancel background thumbnail scans that could re-populate cache
      this._clearBgScanTimers();

      // Reload canvas để reset UI status + clear previews
      const reloaded = await window.storageManager.getWorkflow(this.workflow.wf_id);
      if (reloaded) {
        this.workflow = reloaded;
        this.workflow.status = 'idle'; // Memory-only flag (UI hiện Run button)

        // CRITICAL: KHÔNG gọi saveWorkflowFull(status='idle') — backend đã có state đúng sau reset.
        // Bug cũ: save lại làm overwrite post-reset state khi 'idle' không khớp validation,
        // hoặc race condition giữa Drawflow data export và backend reset state.

        // Sync Drawflow internal data với reset state TRƯỚC khi loadWorkflow để đảm bảo:
        // - Click Play ngay sau Reset → exportWorkflow đọc Drawflow data đã pending
        // - Tránh saveWorkflow() trước Play overwrite post-reset state với stale 'completed'
        const editor = this.diagramCanvas?.editor;
        if (editor) {
          const homeData = editor.drawflow?.drawflow?.Home?.data || {};
          for (const [drawflowId, dfNode] of Object.entries(homeData)) {
            if (!dfNode?.data) continue;
            dfNode.data.status = 'pending';
            dfNode.data.result_file_ids = '';
            dfNode.data.result_thumbnails = null;
            dfNode.data.result_file_names = null;
            dfNode.data.error_message = '';
            dfNode.data.executed_at = null;
            // 2026-05-31: prompt + text_extract đều có result_text output cần clear khi reset.
            if (dfNode.data.node_type === 'prompt' || dfNode.data.node_type === 'text_extract') {
              dfNode.data.result_text = '';
              dfNode.data.result_source = '';
            }
            try { editor.updateNodeDataFromId(drawflowId, dfNode.data); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_resetWorkflowFromEditor', e); }
          }
        }

        this.diagramCanvas?.loadWorkflow(reloaded);
        // Restore ref image previews (ref_file_ids vẫn còn sau reset)
        this._restoreNodeStates();
      }

      // Hiện lại nút Chạy
      this._showRunButton();
      this._addLogEntry(window.I18n?.t('workflow.resetSuccess') || 'Workflow đã được reset.', 'info');

      // Emit events to update list
      window.eventBus?.emit('storage:workflow_saved', { wfId: this.workflow.wf_id });
      try {
        chrome.runtime.sendMessage({ action: 'workflowSaved', wfId: this.workflow.wf_id });
      } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowEditor#_resetWorkflowFromEditor', e); }
    } finally {
      this._resetInProgress = false;
      // Defensive: đảm bảo save button + reset button enabled lại sau reset.
      // Trước fix: nếu user click Save rồi click Reset trong race window → _isSaving có thể stuck → button disabled.
      this._isSaving = false;
      const saveBtn = this.overlay?.querySelector('#saveWorkflowBtn');
      const resetBtn = this.overlay?.querySelector('#resetWorkflowInEditorBtn');
      if (saveBtn) {
        saveBtn.disabled = false;
        if (saveBtn.innerHTML.includes('seosonaflow-loading-spinner')) {
          // Restore button text based on mode
          if (this.isTemplateMode) {
            saveBtn.textContent = this.templateId
              ? (window.I18n?.t('workflow.updateTemplate') || 'Cập nhật Template')
              : (window.I18n?.t('workflow.saveTemplateBtn') || 'Lưu Template');
          } else {
            saveBtn.textContent = this.mode === 'create'
              ? (window.I18n?.t('workflow.createBtn') || 'Tạo mới')
              : (window.I18n?.t('workflow.saveBtn') || 'Lưu');
          }
        }
      }
      if (resetBtn) resetBtn.disabled = false;
      this._updatePlayButtonState();
    }
  }
  });
})(typeof window !== 'undefined' ? window : this);
