/**
 * WorkflowList - Hiển thị danh sách workflows
 */
class WorkflowList {
  constructor(container) {
    this.container = container;
    this.workflows = [];
    this._opening = false;
    this._editingWfId = null;
    this._filterProjectId = null; // Y-2: null = show all
    this._projectNames = {};
    this._searchQuery = ''; // Search query
    this.isRunningAll = false;
    this.shouldStopAll = false;
    this._pendingWfIds = new Set(); // Track workflows queued to run
    this._stoppedWfIds = new Set(); // Track recently stopped workflows để force status='pending' khi re-render
    // Server-side pagination
    this._pageSize = 20;
    this._currentPage = 1;
    this._lastPage = 1;
    this._total = 0;
    this._loading = false;
    this._loadPending = false; // Queue reload request while loading
    this._loadDebounceTimer = null; // Debounce timer for rapid events
    this._sharedWorkflows = []; // Workflows được chia sẻ với user
    this._isCloningWorkflow = false; // Lock để tránh duplicate click khi clone
    this._isDuplicatingShared = false; // Lock để tránh duplicate click khi duplicate từ shared

    this.init();
  }

  async init() {
    // Load _stoppedWfIds từ storage (survive page refresh)
    try {
      const stored = await chrome.storage.local.get('af_stopped_wfids');
      if (stored.af_stopped_wfids?.length) {
        this._stoppedWfIds = new Set(stored.af_stopped_wfids);
        console.log('[WorkflowList] Restored _stoppedWfIds from storage:', this._stoppedWfIds.size);
      }
    } catch (e) { /* ignore */ }

    await this.loadWorkflows();
    await this.loadSharedWorkflows();
    this.bindGlobalEvents();
    this._bindToolbarEvents();
    // [Audit Bug 7 fix 2026-06-22] Replay execution events queued by background while sidepanel closed.
    this._replayQueuedExecutionEvents();
  }

  /**
   * [Audit Bug 7 fix 2026-06-22] Đọc + dispatch execution events backup từ chrome.storage.session
   * (do background.js queue khi sidepanel chưa mở). Drain queue sau replay.
   * Acceptable lag: events ≤ 50, dispatch trong cùng tick → UI catch-up gần như instant.
   */
  async _replayQueuedExecutionEvents() {
    try {
      const sessionStore = chrome.storage?.session;
      if (!sessionStore) return; // Service worker context cũ hoặc browser không support
      const res = await new Promise(resolve => sessionStore.get(['af_execution_event_queue'], resolve));
      const queue = Array.isArray(res?.af_execution_event_queue) ? res.af_execution_event_queue : [];
      if (queue.length === 0) return;
      console.log(`[WorkflowList] Replaying ${queue.length} queued execution events`);
      for (const msg of queue) {
        if (msg?.event && window.eventBus) {
          try { window.eventBus.emit(msg.event, msg.data || {}); } catch (_) { /* skip */ }
        }
      }
      // Drain queue sau replay
      await new Promise(resolve => sessionStore.remove(['af_execution_event_queue'], resolve));
    } catch (e) {
      console.warn('[WorkflowList] Replay queue failed:', e.message);
    }
  }

  bindGlobalEvents() {
    if (window.eventBus) {
      // [API SPAM FIX — Phase 6] Single workflow update thay vì reload all list.
      // Events có wfId → chỉ update workflow đó. Events không có wfId → fallback debounced reload.
      window.eventBus.on('storage:workflow_saved', (data) => {
        const wfId = data?.wfId || data?.wf_id || data?.workflow?.wf_id;
        this._lastSaveTime = Date.now();
        if (wfId) {
          this._debouncedUpdateSingleWorkflow(wfId);
        } else {
          this._debouncedLoadWorkflows();
        }
      });
      window.eventBus.on('storage:workflow_full_saved', (data) => {
        const wfId = data?.wfId || data?.wf_id || data?.workflow?.wf_id;
        this._lastSaveTime = Date.now();
        if (wfId) {
          this._debouncedUpdateSingleWorkflow(wfId);
        } else {
          this._debouncedLoadWorkflows();
        }
      });
      // 2026-05-25: Fix delete không refresh list.
      // Trước fix: chỉ gọi _debouncedLoadWorkflows() → bị block bởi cooldown logic
      // (line 1065: BLOCKED loadWorkflows khi _executionCooldown=true + _lastUpdatedWfId).
      // User vừa run workflow Y → delete workflow X → reload bị block → X vẫn hiển thị.
      // Sau fix: optimistic removal local + clear stale refs + force re-render ngay.
      window.eventBus.on('storage:workflow_deleted', (data) => {
        const wfId = data?.wfId;
        if (wfId && Array.isArray(this.workflows)) {
          // Optimistic: remove deleted workflow khỏi local list
          this.workflows = this.workflows.filter(w => w.wf_id !== wfId);
          // Clear stale refs để cooldown logic không trigger single-update cho workflow đã xóa
          if (this._lastUpdatedWfId === wfId) this._lastUpdatedWfId = null;
          this._stoppedWfIds?.delete(wfId);
          // Re-render ngay với data đã filter
          try { this.render(); } catch (e) { /* ignore */ }
        }
        // Trigger reload để sync pagination + fresh count (sẽ skip nếu cooldown active, OK vì local đã update)
        this._debouncedLoadWorkflows();
      });
      window.eventBus.on('workflow:status_updated', (data) => {
        const wfId = data?.wfId || data?.wf_id || data?.workflow?.wf_id;
        if (wfId) {
          this._debouncedUpdateSingleWorkflow(wfId);
        } else {
          this._debouncedLoadWorkflows();
        }
      });
      // K.14 (2026-05-29): Sidebar self emit `workflow:reset` (line 3029) sau khi user click
      // reset card. Runtime listener (line 308) skip self-message (`_originSidebar=true`) →
      // sidebar không tự update card via cross-context path. CẦN listener local riêng để
      // update card color/status sau reset.
      window.eventBus.on('workflow:reset', (data) => {
        const wfId = data?.workflowId || data?.wfId || data?.wf_id;
        if (!wfId) return;
        // Reset card running state về idle + reload single workflow để fetch fresh status='pending'.
        this._updateCardRunningState(wfId, false, 'pending');
        this._debouncedUpdateSingleWorkflow(wfId);
      });
      // [API SPAM FIX — Phase 6] Track running workflow để các events không có wfId có thể dùng
      window.eventBus.on('execution:started', (data) => {
        const wfId = data?.workflow?.wf_id || data?.wfId;
        console.log('[WorkflowList] execution:started received:', wfId, data);
        if (wfId) {
          this._lastUpdatedWfId = wfId;
          // Clear stopped flag khi workflow chạy lại
          this._stoppedWfIds?.delete(wfId);
          // [Phase 1] Gỡ trạng thái "đang chuẩn bị" — running tiếp quản.
          try { clearTimeout(this._preparingTimers?.[wfId]); this._setCardPreparing(wfId, false); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowList#bindGlobalEvents', _); }
          // Update card to running state
          this._updateCardRunningState(wfId, true);
        }
      });
      window.eventBus.on('execution:completed', (data) => {
        // Fallback to _lastUpdatedWfId nếu event không có wfId (broadcast từ popup)
        const wfId = data?.workflow?.wf_id || data?.wfId || this._lastUpdatedWfId;
        console.log('[WorkflowList] execution:completed received:', wfId);
        // Final update cho workflow vừa xong
        if (wfId) {
          // [rebuild] Màu viền theo mức độ kết quả (như màu noti): stopped→pending, error→failed (đỏ),
          // có bỏ qua node→warning (cam), sạch→completed (xanh lá).
          const _st = data?.stopped ? 'pending' : (data?.error ? 'failed' : (data?.warning ? 'warning' : 'completed'));
          // FIX (status tồn đọng): 'completed' VÀ 'warning' đều = "đã chạy xong" (warning = xong nhưng bỏ
          // qua node, KHÔNG phải lỗi) → hiện màu trong SESSION vừa chạy, mở lại panel → về "Chờ" (auto-reset).
          // Chỉ 'failed' (lỗi thật) mới persist. Trước đây warning persist như failed → đọng mãi = sai.
          if (_st === 'completed' || _st === 'warning') (this._finishedThisSession = this._finishedThisSession || new Set()).add(wfId);
          this._updateCardRunningState(wfId, false, _st);
          this._debouncedUpdateSingleWorkflow(wfId);
        }
        // Cooldown: skip full reload trong 5s sau execution (nhiều events cùng fire)
        this._executionCooldown = true;
        setTimeout(() => {
          this._executionCooldown = false;
          // Check nếu có pending load request (từ workflowEditorClosed trong cooldown)
          if (this._pendingLoadAfterCooldown) {
            this._pendingLoadAfterCooldown = false;
            console.log('[WorkflowList] Cooldown ended, executing pending loadWorkflows');
            this.loadWorkflows();
          }
        }, 5000);
        // Clear tracking sau 2s (cho phép các events trễ vẫn dùng được)
        setTimeout(() => { this._lastUpdatedWfId = null; }, 2000);
      });
      // [Phase 1] Listen progress → patch progress bar (không API call).
      // Route theo wfId chắc chắn: data.wfId → node.wf_id → _lastUpdatedWfId (fallback cũ).
      // QUAN TRỌNG: đẩy progress_completed/progress_total vào MẢNG in-mem để Flows overlay đọc
      // được (trước đây chỉ patch DOM My Spaces → Flows đứng im rồi nhảy 100%).
      window.eventBus.on('execution:progress', (data) => {
        const { total, completed } = data || {};
        const wfId = data?.wfId || data?.current?.wf_id || this._lastUpdatedWfId;
        if (!wfId) return;
        const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
        const wf = this.workflows.find(w => w.wf_id === wfId);
        if (wf) {
          wf.progress_completed = completed;
          wf.progress_total = total;
          if (wf.status !== 'running') wf.status = 'running';
        }
        this._updateCardProgress(wfId, percent);
      });
      // SSE listener để refresh khi share được chấp nhận
      window.eventBus.on('workflow:share_accepted', () => this.loadSharedWorkflows());
      // Recipient từ chối share → sharer cần re-load shared list (clear pending state)
      window.eventBus.on('workflow:share_rejected', () => {
        try { this.loadSharedWorkflows(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowList#bindGlobalEvents', _); }
        if (window.SeosonaNotify?.info) {
          window.SeosonaNotify.info(window.I18n?.t('workflow.shareRejected') || 'Người nhận đã từ chối share');
        }
      });
      // Sharer revoke access → recipient mất quyền, refresh shared list
      window.eventBus.on('workflow:share_revoked', () => {
        try { this.loadSharedWorkflows(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowList#bindGlobalEvents', _); }
        if (window.SeosonaNotify?.warning) {
          window.SeosonaNotify.warning(window.I18n?.t('workflow.shareRevoked') || 'Quyền share đã bị thu hồi');
        }
      });
      // Handler khi user accept share từ NotificationModal và đã clone workflow
      window.eventBus.on('workflow:shared_accepted', async (data) => {
        if (data?.copied && data?.workflow?.wf_id) {
          await this.loadWorkflows();
          // Switch to My Workflows tab
          const workflowsTab = document.querySelector('[data-subtab="workflows"]');
          if (workflowsTab) workflowsTab.click();
          // Auto-open the cloned workflow
          setTimeout(() => {
            if (this._openWorkflow) {
              this._openWorkflow(data.workflow.wf_id);
            }
          }, 300);
        } else {
          // Only accepted without copy - refresh shared list
          this.loadSharedWorkflows();
        }
      });
    }

    // Detect workflow data changes from other contexts (popup editor window).
    // [API SPAM FIX — Phase 6] Nếu có workflow đang chạy (tracked via _lastUpdatedWfId),
    // chỉ update workflow đó. Nếu không, full refresh (vd: user edit trong editor khác).
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && (changes.af_workflows || changes.af_nodes)) {
        // Nếu đang có workflow execution, single update
        if (this._lastUpdatedWfId && window.workflowExecutor?.isRunning) {
          this._debouncedUpdateSingleWorkflow(this._lastUpdatedWfId);
        } else {
          this._debouncedLoadWorkflows();
        }
      }
    });

    // U-4.3: Re-render khi chuyển project
    if (window.eventBus) {
      // Bug fix 2026-05-28: switch project → list PHẢI follow sang project mới. Trước: chỉ
      // loadWorkflows() re-fetch all nhưng _filterProjectId (filter hiển thị) KHÔNG đổi → list
      // giữ nguyên view cũ → "không refresh". Fix: set _filterProjectId theo project vừa switch
      // → render ngay (view đổi tức thì dù executor-guard chặn loadWorkflows) + refresh data nền.
      window.eventBus.on('project:changed', (data) => {
        if (data && data.projectId !== undefined) {
          this._filterProjectId = data.projectId || null;
          try { this.renderWorkflowList(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowList#bindGlobalEvents', _); }
        }
        this.loadWorkflows();
        // 2026-06-05: Auto-open workflow editor sau Edit cross-project switch.
        // Edit handler set _pendingOpenAfterSwitch = { wfId, projectId, ts }. Khi project:changed
        // fire với matching projectId → call _openWorkflow để open editor luôn.
        // Delay 500ms cho loadWorkflows kịp fetch fresh data + render.
        const pending = this._pendingOpenAfterSwitch;
        if (pending && data?.projectId === pending.projectId) {
          this._pendingOpenAfterSwitch = null;
          console.log('[WorkflowList] Auto-open workflow after project switch:', pending.wfId);
          setTimeout(() => this._openWorkflow(pending.wfId, null), 500);
        }
      });
      // Reload workflows khi user login (data từ server)
      window.eventBus.on('auth:login', () => this.loadWorkflows());
      // CRITICAL: auth:login fire TRƯỚC switchToApi() → loadWorkflows chạy trong
      // local mode (đã wipe sau reinstall) → empty. Listen mode_changed để reload
      // KHI storage thực sự switch sang api → fetch từ server.
      window.eventBus.on('storage:mode_changed', (data) => {
        if (data?.mode === 'api') this.loadWorkflows();
      });
      // Re-render khi đổi ngôn ngữ (chỉ gọi render() một lần vì renderWorkflowList đã gọi render)
      window.eventBus.on('i18n:changed', () => {
        this.renderWorkflowList();
        // Cũng re-render shared tab nếu đang hiển thị
        const sharedTabContent = document.querySelector('[data-content="shared"]');
        if (sharedTabContent && !sharedTabContent.classList.contains('hidden')) {
          this.renderSharedTab(sharedTabContent);
        }
      });
      // Reload shared workflows khi user login (data từ server cho user mới)
      window.eventBus.on('auth:login', () => this.loadSharedWorkflows());
      // Clear shared workflows khi user logout
      window.eventBus.on('auth:logout', () => {
        this._sharedWorkflows = [];
        this._updateSharedTabBadge();
        const sharedTabContent = document.querySelector('[data-content="shared"]');
        if (sharedTabContent) this.renderSharedTab(sharedTabContent);
      });
    }

    // Listen for execution status updates and editor close from other contexts.
    // [API SPAM FIX — Phase 6] Single workflow update khi có wfId, fallback reload khi không có.
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.action === 'executionStatusUpdate') {
        const wfId = msg.wfId || msg.workflowId;
        if (wfId) {
          this._debouncedUpdateSingleWorkflow(wfId);
        } else {
          this._debouncedLoadWorkflows();
        }
      }
      if (msg.action === 'workflowSaved') {
        const wfId = msg.wfId || msg.workflowId;
        this._lastSaveTime = Date.now();
        if (wfId) {
          this._debouncedUpdateSingleWorkflow(wfId);
        } else {
          this._debouncedLoadWorkflows();
        }
      }
      if (msg.action === 'workflowEditorClosed') {
        // 2026-05-25 BUG FIX: User mở menu 3-chấm + click share trong window 1s sau editor close
        // → _debouncedLoadWorkflows render replace innerHTML → share-btn listener mất →
        // click share không hiện modal. Document-level close-dropdown listener still active →
        // close menu silently → user thấy "ko response".
        // Fix: single-workflow update đủ sync data (status/updated_at). Skip full reload.
        const wfIdToUpdate = this._editingWfId || msg.wfId || this._lastUpdatedWfId;
        this._editingWfId = null;
        // Editor đóng → bỏ trạng thái "đang sửa" → enable lại nút Delete (canDelete phụ thuộc isEditing).
        // Gọi NGAY (đồng bộ) cho cả 2 nhánh, kể cả recentSave-return + surgical update (không đụng menu).
        this._refreshCardEditingState(wfIdToUpdate);
        const recentSave = this._lastSaveTime && (Date.now() - this._lastSaveTime) < 2000;
        if (recentSave) {
          console.log('[WorkflowList] Skip editor close refresh — recent save already handled');
          return;
        }
        // Single-workflow update (no innerHTML replace → preserves dropdown listeners)
        if (wfIdToUpdate) {
          this._debouncedUpdateSingleWorkflow(wfIdToUpdate);
        }
        // Nếu đang trong cooldown, schedule load sau khi cooldown hết (legacy fallback)
        if (this._executionCooldown) {
          console.log('[WorkflowList] workflowEditorClosed during cooldown, scheduling load after cooldown');
          this._pendingLoadAfterCooldown = true;
        }
      }
      // Handle workflow execution events relayed from popup editor window
      if (msg.action === 'workflowExecutionEvent') {
        const { event, data } = msg;
        // Anti-loopback 1: skip nếu message có tag `_originSidebar` (do chính sidebar gửi đi,
        // bounce-back về self → tránh double reload). Popup editor không gắn tag này.
        if (msg._originSidebar) {
          return;
        }
        // Anti-loopback 2: skip nếu message do background relay (gắn `_bg_relayed: true`).
        // Bug fix 2026-05-25: Chrome auto-broadcast `chrome.runtime.sendMessage` tới mọi
        // extension context → sidebar đã nhận BẢN GỐC từ sender (popup). Background re-send
        // chỉ để probe receiver (promise resolve/reject), nhưng vô tình duplicate event
        // → listener fire 2 lần. Tag `_bg_relayed` để skip duplicate.
        if (msg._bg_relayed) {
          return;
        }
        // Emit to local eventBus for WorkflowTab listeners
        if (window.eventBus) {
          window.eventBus.emit(event, data);
        }
        // Handle remote stop from other context
        if (event === 'execution:stop') {
          console.log('[WorkflowList] Remote stop received, data:', data);
          if (window.workflowExecutor) {
            window.workflowExecutor.handleRemoteStop?.();
          }
          // Update card UI ngay lập tức
          const stopWfId = data?.wf_id || data?.workflow?.wf_id || this._lastUpdatedWfId;
          if (stopWfId) {
            this._updateCardRunningState(stopWfId, false, 'pending');
          }
        }
        // [API SPAM FIX — Phase 6] Extract wfId từ event data và single update
        if (['execution:started', 'execution:completed', 'workflow:reset', 'node:completed', 'execution:stop'].includes(event)) {
          const wfId = data?.workflow?.wf_id || data?.workflowId || data?.wfId;
          if (wfId) {
            this._debouncedUpdateSingleWorkflow(wfId);
          } else if (this._lastUpdatedWfId) {
            // Fallback: dùng wfId từ event gần nhất
            this._debouncedUpdateSingleWorkflow(this._lastUpdatedWfId);
          } else {
            this._debouncedLoadWorkflows();
          }
        }
      }
    });
  }

  /**
   * [API SPAM FIX — Phase 3.1] Debounce loadWorkflows 1s — coalesce nhiều listener
   * cùng react execution:completed / workflowSaved / executionStatusUpdate.
   * Tránh cascade gây 429 từ backend.
   */
  _debouncedLoadWorkflows() {
    // [API SPAM FIX — Phase 6] Skip full reload khi workflow đang chạy hoặc vừa xong
    // Chỉ single update cho workflow đang/vừa chạy, tránh giật UI và API spam
    if ((window.workflowExecutor?.isRunning || this._executionCooldown) && this._lastUpdatedWfId) {
      console.log('[WorkflowList] Skip loadWorkflows - executor running or cooldown, use single update instead');
      // CRITICAL: Clear pending timer để tránh fire sau khi executor xong
      if (this._loadCoalesceTimer) {
        clearTimeout(this._loadCoalesceTimer);
        this._loadCoalesceTimer = null;
      }
      this._debouncedUpdateSingleWorkflow(this._lastUpdatedWfId);
      return;
    }

    if (this._loadCoalesceTimer) clearTimeout(this._loadCoalesceTimer);
    this._loadCoalesceTimer = setTimeout(() => {
      this._loadCoalesceTimer = null;
      // Double check: executor có thể đã bắt đầu chạy hoặc đang cooldown
      if ((window.workflowExecutor?.isRunning || this._executionCooldown) && this._lastUpdatedWfId) {
        console.log('[WorkflowList] Skip loadWorkflows in timer - executor running or cooldown');
        return;
      }
      this.loadWorkflows();
    }, 1000);
  }

  /**
   * [API SPAM FIX — Phase 6] Update chỉ 1 workflow trong list thay vì reload all.
   * Giảm đáng kể API calls khi workflow đang chạy (mỗi node save → chỉ 1 GET thay vì GET all).
   * Ưu tiên: executor data > partialData > fetch từ server
   * @param {string} wfId - Workflow ID cần update
   * @param {object} [partialData] - Optional partial data để merge (nếu đã có sẵn, skip fetch)
   */
  async _updateSingleWorkflowInList(wfId, partialData = null) {
    if (!wfId) return;

    try {
      let updatedWorkflow = partialData;

      // Ưu tiên 1: Lấy status từ executor đang chạy (không cần API call)
      // CRITICAL: Chỉ dùng 'running' nếu executor thực sự đang chạy và chưa bị stop
      if (window.workflowExecutor?.currentWorkflow?.wf_id === wfId &&
          window.workflowExecutor.isRunning && !window.workflowExecutor.shouldStop) {
        const execWf = window.workflowExecutor.currentWorkflow;
        updatedWorkflow = {
          wf_id: wfId,
          status: execWf.status || 'running',
          // [Phase 1] Lấy luôn progress live từ executor → mảng in-mem có progress → Flows overlay
          // + _rerenderSingleWorkflowCard hiển thị đúng % (không còn stuck 0 rồi nhảy 100).
          progress_completed: execWf.progress_completed,
          progress_total: execWf.progress_total,
        };
      }

      // Nếu không có partialData, fetch từ server
      if (!updatedWorkflow) {
        updatedWorkflow = await window.storageManager?.getWorkflow(wfId);
      }

      if (!updatedWorkflow) return;

      // CRITICAL: Nếu executor đã stop nhưng server vẫn trả 'running', override thành 'pending'
      // Tránh race condition khi server chưa kịp cập nhật status sau khi user stop
      if (window.workflowExecutor?.shouldStop &&
          window.workflowExecutor?.currentWorkflow?.wf_id === wfId &&
          updatedWorkflow.status === 'running') {
        updatedWorkflow.status = 'pending';
      }

      // Tìm và update trong array
      const index = this.workflows.findIndex(w => w.wf_id === wfId);
      if (index >= 0) {
        // Merge data mới vào workflow hiện tại (giữ lại fields không có trong response)
        this.workflows[index] = { ...this.workflows[index], ...updatedWorkflow };
        // Re-render chỉ card này
        this._rerenderSingleWorkflowCard(wfId);
      } else if (updatedWorkflow.wf_id) {
        // Workflow mới tạo chưa có trong list → unshift + render lại để hiển thị
        this.workflows.unshift(updatedWorkflow);
        this.renderWorkflowList();
      }
    } catch (e) {
      console.warn('[WorkflowList] _updateSingleWorkflowInList failed:', wfId, e.message);
    }
  }

  /**
   * Cập nhật nút Delete (enable/disable) theo trạng thái đang-sửa/đang-chạy — gọi khi đóng editor.
   * canDelete = !isRunning && !isEditing (xem render card). Surgical, không re-render menu → giữ listener.
   * @param {string} wfId
   */
  _refreshCardEditingState(wfId) {
    if (!wfId) return;
    const card = this.container?.querySelector(`.workflow-card[data-wf-id="${wfId}"]`);
    if (!card) return;
    const wf = this.workflows.find(w => w.wf_id === wfId);
    const isRunning = wf?.status === 'running' && !this._stoppedWfIds?.has(wfId);
    const isEditing = this._editingWfId === wfId;
    const canDelete = !isRunning && !isEditing;
    const deleteBtn = card.querySelector('.delete-btn');
    if (deleteBtn) deleteBtn.disabled = !canDelete;
  }

  /**
   * Update in-place 1 workflow card trong DOM (không replace toàn bộ để giữ event bindings).
   * Chỉ update các elements thay đổi: status badge, progress, timestamps.
   * @param {string} wfId
   */
  _rerenderSingleWorkflowCard(wfId) {
    const workflow = this.workflows.find(w => w.wf_id === wfId);
    if (!workflow) return;

    const card = this.container.querySelector(`.workflow-card[data-wf-id="${wfId}"]`);
    if (!card) return;

    // Update status class trên card (không có prefix "status-", CSS dùng .workflow-card.completed etc.)
    card.classList.remove('pending', 'running', 'completed', 'failed', 'paused', 'idle', 'warning');
    if (workflow.status) {
      card.classList.add(workflow.status);
    }

    // [Editor close sync] Toggle .editing class theo _editingWfId hiện tại.
    // Bug: editor đóng → _editingWfId=null nhưng card vẫn giữ class 'editing'
    // → CSS border lime + "Editing" text persist dù workflow đã exit edit mode.
    const isEditing = this._editingWfId === wfId;
    card.classList.toggle('editing', isEditing);

    // Update trạng thái theo markup MỚI (.wf-status-dot + .wf-status-text). KHÔNG rebuild
    // .workflow-card-meta (rebuild sẽ phá status-dot/text/node-count của card mới → hiện "0 nodes"
    // + mất chấm trạng thái). Node-count giữ nguyên; class 'editing' đã toggle ở trên (CSS lo hiển thị).
    if (workflow.status) {
      const statusDot = card.querySelector('.wf-status-dot');
      if (statusDot) statusDot.className = `wf-status-dot ${workflow.status}`;
      const statusText = card.querySelector('.wf-status-text');
      if (statusText) statusText.textContent = WorkflowList._renderStatusLabel(workflow.status);
    }

    // Update progress bar nếu có
    const progressBarFill = card.querySelector('.workflow-card-progress-bar-fill') ||
                            card.querySelector('.workflow-card-inline-progress-bar');
    const progressBarContainer = card.querySelector('.workflow-card-progress-bar') ||
                                  card.querySelector('.workflow-card-inline-progress');
    // [Phase 1 — GỐC nhấp nháy] Trước đây check `workflow.progress` (field KHÔNG BAO GIỜ được set)
    // → luôn rơi vào else → ẨN bar, đánh nhau với _updateCardProgress (hiện bar) → nhấp nháy/reset.
    // Giờ tính % từ progress_completed/progress_total (nguồn thật) và KHÔNG ẩn bar khi đang running.
    if (workflow.status === 'running') {
      const pct = (workflow.progress_total > 0)
        ? Math.round((workflow.progress_completed || 0) / workflow.progress_total * 100)
        : 0;
      if (progressBarFill) progressBarFill.style.width = `${pct}%`;
      if (progressBarContainer) {
        progressBarContainer.classList.remove('hidden');
        progressBarContainer.style.display = '';
      }
    } else {
      if (progressBarContainer) progressBarContainer.classList.add('hidden');
    }

    // Update Run/Stop button visibility
    const runBtn = card.querySelector('.run-btn');
    const stopBtn = card.querySelector('.stop-btn');
    const runningBtns = card.querySelector('.wf-running-buttons');
    const dropdownMenu = card.querySelector('.seosonaflow-dot-menu');
    const toggleBtn = card.querySelector('.wf-toggle-btn');
    if (workflow.status === 'running') {
      runBtn?.classList.add('hidden');
      stopBtn?.classList.remove('hidden');
      if (runningBtns) runningBtns.style.display = 'flex';
      if (dropdownMenu) dropdownMenu.style.display = 'none';
      if (toggleBtn) toggleBtn.style.display = 'none';
    } else {
      runBtn?.classList.remove('hidden');
      stopBtn?.classList.add('hidden');
      if (runningBtns) runningBtns.style.display = 'none';
      if (dropdownMenu) dropdownMenu.style.display = '';
      if (toggleBtn) toggleBtn.style.display = '';
    }

    // [Editor save sync] Update wf_name (user đổi tên trên editor → sidebar reflect ngay)
    const nameEl = card.querySelector('.workflow-card-name');
    if (nameEl) {
      const displayName = workflow.wf_name || (window.I18n?.t('workflow.unnamed') || 'Workflow không tên');
      if (nameEl.textContent !== displayName) {
        nameEl.textContent = displayName;
      }
    }

    // [rebuild] Sync toggle "chọn cho Chạy tất cả" (class on/off + title). KHÔNG còn làm mờ card
    // (wf-disabled) — toggle là CHECKBOX chọn card, KHÔNG vô hiệu workflow (vẫn chạy lẻ bình thường).
    const isEnabled = workflow.enabled !== false;
    if (toggleBtn) {
      const wantClass = isEnabled ? 'on' : 'off';
      const dropClass = isEnabled ? 'off' : 'on';
      if (!toggleBtn.classList.contains(wantClass)) {
        toggleBtn.classList.remove(dropClass);
        toggleBtn.classList.add(wantClass);
        toggleBtn.title = isEnabled
          ? 'Đang chọn — sẽ chạy khi bấm Chạy tất cả (bỏ chọn không ảnh hưởng chạy lẻ)'
          : 'Chưa chọn — bỏ qua khi Chạy tất cả (vẫn chạy lẻ được)';
      }
    }

    // [Editor save sync] Update updated_at relative time (chỉ thay text bên trong svg+text container)
    const lastEditEl = card.querySelector('.workflow-card-last-edit');
    if (lastEditEl && workflow.updated_at) {
      const timeText = this._formatRelativeTime(workflow.updated_at);
      // Last text node trong element = relative time (sau SVG)
      const lastNode = lastEditEl.lastChild;
      if (lastNode && lastNode.nodeType === Node.TEXT_NODE && lastNode.textContent !== timeText) {
        lastNode.textContent = timeText;
      }
    }
  }

  /**
   * Bind event listeners cho single workflow card.
   * Dùng khi cần rebind events sau khi innerHTML bị thay đổi.
   * @param {HTMLElement} card - Card element
   */
  _bindSingleCardEvents(card) {
    if (!card) return;
    const wfId = card.dataset.wfId;
    if (!wfId) return;

    const listContainer = this.container.querySelector('.workflow-list');

    // Toggle enabled
    const toggleBtn = card.querySelector('.wf-toggle-btn');
    if (toggleBtn && !toggleBtn._bound) {
      toggleBtn._bound = true;
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wf = this.workflows.find(w => w.wf_id === wfId);
        const isAdminView = wf?._is_admin_view || (wf?.user?.id && wf.user.id !== window.authManager?.user?.id);
        if (isAdminView) return;
        this.toggleWorkflowEnabled(wfId);
      });
    }

    // 3-dot menu
    const dotMenu = card.querySelector('.seosonaflow-dot-menu');
    if (dotMenu) {
      const menuBtn = dotMenu.querySelector('.seosonaflow-dot-menu-btn');
      const dropdown = dotMenu.querySelector('.seosonaflow-dropdown-menu');
      if (menuBtn && !menuBtn._bound) {
        menuBtn._bound = true;
        menuBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          console.log('[WorkflowList] Menu button clicked:', wfId, 'dropdown:', dropdown, 'wasHidden:', dropdown?.classList.contains('hidden'));
          const wasHidden = dropdown?.classList.contains('hidden');
          this._closeAllDropdowns(listContainer);
          if (dropdown && wasHidden) {
            dropdown.classList.remove('hidden');
            this._positionDropdown(menuBtn, dropdown);
            setTimeout(() => {
              document.addEventListener('click', () => this._closeAllDropdowns(listContainer), { once: true });
            }, 0);
          }
        });
      }
    }

    // Edit button
    const editBtn = card.querySelector('.edit-btn');
    if (editBtn && !editBtn._bound) {
      editBtn._bound = true;
      editBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        // [Audit 2026-07-07] Workflow web mode (admin bật) → sửa workflow trên WEB spaces (popup) thay
        // vì editor extension. getBoolReady: fallback storage khi _cache chưa load (fix click đầu sai mode).
        if (await (window.SystemConfig?.getBoolReady?.('workflow_web_mode'))) {
          chrome.runtime.sendMessage({ action: 'openWebSpaces', wfId }, (resp) => {
            void chrome.runtime.lastError;
            if (!resp?.ok) window.showNotification?.(window.I18n?.t('workflow.openWebFailed') || 'Không mở được editor web', 'error');
          });
          return;
        }
        const wf = this.workflows.find(w => w.wf_id === wfId);
        const isAdminView = wf?._is_admin_view || (wf?.user?.id && wf.user.id !== window.authManager?.user?.id);
        if (wf && !isAdminView && window.ProjectHelper && !window.ProjectHelper.isCurrentProject(wf)) {
          // 2026-06-05: Edit cross-project — modal hiện "Mở project" (rõ intent edit) +
          // auto-open workflow editor sau khi project context ready (project:changed event).
          const action = await window.ProjectHelper.showCrossProjectWarning(wf, 'workflow', {
            confirmTextKey: 'project.openProject',
            confirmTextFallback: 'Mở project',
          });
          if (action === 'switch') {
            // Track pending auto-open: project:changed listener sẽ check + _openWorkflow.
            // TTL 30s để tránh stale state nếu user cancel navigation / Flow tab close.
            const pending = { wfId, projectId: wf.project_id, ts: Date.now() };
            this._pendingOpenAfterSwitch = pending;
            setTimeout(() => {
              if (this._pendingOpenAfterSwitch === pending) {
                console.log('[WorkflowList] Pending auto-open expired (30s):', wfId);
                this._pendingOpenAfterSwitch = null;
              }
            }, 30000);
            window.ProjectHelper.navigateToProject(wf.project_id);
          }
          return;
        }
        this._openWorkflow(wfId, card);
      });
    }

    // Copy/Clone button
    const copyBtn = card.querySelector('.copy-btn');
    if (copyBtn && !copyBtn._bound) {
      copyBtn._bound = true;
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this.cloneWorkflow(wfId);
      });
    }

    // [Phase 3] "Đưa vào Flows" — copy độc lập sang Flows (flow_kind='flow').
    const toFlowsBtn = card.querySelector('.to-flows-btn');
    if (toFlowsBtn && !toFlowsBtn._bound) {
      toFlowsBtn._bound = true;
      toFlowsBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        await this._addToFlows(wfId);
      });
    }

    // Run button
    const runBtn = card.querySelector('.run-btn');
    if (runBtn && !runBtn._bound) {
      runBtn._bound = true;
      runBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        const wf = this.workflows.find(w => w.wf_id === wfId);
        const isAdminView = wf?._is_admin_view || (wf?.user?.id && wf.user.id !== window.authManager?.user?.id);
        if (wf && !isAdminView && window.ProjectHelper && !window.ProjectHelper.isCurrentProject(wf)) {
          const action = await window.ProjectHelper.showCrossProjectWarning(wf, 'workflow');
          if (action === 'switch') window.ProjectHelper.navigateToProject(wf.project_id);
          return;
        }
        this.runWorkflow(wfId);
        // Cross-link (spec Spaces): chạy từ "My Spaces" → đẩy user sang tab "Flows" để theo dõi.
        try { window.eventBus?.emit('workflow:run_started', { wfId }); } catch (e) { console.warn('[WorkflowList] Khong phat duoc workflow:run_started -> the/tab co the khong doi sang trang thai dang chay:', e && e.message); }
      });
    }

    // Stop button
    const stopBtn = card.querySelector('.stop-btn');
    if (stopBtn && !stopBtn._bound) {
      stopBtn._bound = true;
      stopBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wf = this.workflows.find(w => w.wf_id === wfId);
        const isAdminView = wf?._is_admin_view || (wf?.user?.id && wf.user.id !== window.authManager?.user?.id);
        if (isAdminView) return;
        this.stopWorkflow(wfId);
      });
    }

    // Reset button
    const resetBtn = card.querySelector('.reset-btn');
    if (resetBtn && !resetBtn._bound) {
      resetBtn._bound = true;
      resetBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        const wf = this.workflows.find(w => w.wf_id === wfId);
        const isAdminView = wf?._is_admin_view || (wf?.user?.id && wf.user.id !== window.authManager?.user?.id);
        if (isAdminView) return;
        this.resetWorkflow(wfId);
      });
    }

    // Export button
    const exportBtn = card.querySelector('.export-btn');
    if (exportBtn && !exportBtn._bound) {
      exportBtn._bound = true;
      exportBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this.exportWorkflow(wfId);
      });
    }

    // Delete button
    const deleteBtn = card.querySelector('.delete-btn');
    if (deleteBtn && !deleteBtn._bound) {
      deleteBtn._bound = true;
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this.deleteWorkflow(wfId);
      });
    }

    // [Affiliate Creator Page] "Xuất bản làm Template" — chỉ affiliate active (reveal async).
    const publishBtn = card.querySelector('.publish-template-btn');
    if (publishBtn && !publishBtn._bound) {
      publishBtn._bound = true;
      publishBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this.publishAsTemplate(wfId);
      });
      if (window.CreatorTemplatePublish?.isEligible) {
        window.CreatorTemplatePublish.isEligible().then((ok) => {
          if (ok) publishBtn.classList.remove('hidden');
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowList#_bindSingleCardEvents', _e); });
      }
    }

    // Share button — bind Ở ĐÂY luôn (không chỉ trong render() bulk) để khi mở editor xong
    // (_openWorkflow restore actions innerHTML → gọi _bindSingleCardEvents) share không mất listener.
    const shareBtn = card.querySelector('.share-btn');
    if (shareBtn && !shareBtn._bound) {
      shareBtn._bound = true;
      shareBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this.handleShare(wfId);
      });
    }
  }

  /**
   * [Affiliate Creator Page] Load full workflow data → mở CreatorTemplatePublish (gửi duyệt).
   */
  async publishAsTemplate(wfId) {
    if (!window.CreatorTemplatePublish) {
      window.showNotification?.(window.I18n?.t('creator.publish.moduleNotReady') || 'Module xuất bản chưa sẵn sàng', 'error');
      return;
    }
    try {
      const workflow = await window.storageManager?.getWorkflow(wfId);
      if (!workflow || !(workflow.nodes || []).length) {
        window.showNotification?.(window.I18n?.t('workflow.noWorkflowData') || 'Không có dữ liệu workflow', 'error');
        return;
      }
      // Chỉ xuất bản workflow CỦA MÌNH — không phải workflow đang xem (shared/admin view).
      if (workflow._is_shared_view || workflow._is_admin_view) {
        window.showNotification?.(window.I18n?.t('creator.publish.ownOnly') || 'Chỉ có thể xuất bản workflow của bạn.', 'error');
        return;
      }
      await window.CreatorTemplatePublish.show({
        wf_name: workflow.wf_name || 'Workflow Template',
        description: workflow.description || '',
        nodes: workflow.nodes || [],
        edges: workflow.edges || [],
        settings: workflow.settings || {},
      });
    } catch (e) {
      console.error('[WorkflowList] publishAsTemplate error:', e);
      window.showNotification?.((window.I18n?.t('creator.publish.error') || 'Không thể xuất bản template') + ': ' + e.message, 'error');
    }
  }


  /**
   * [API SPAM FIX — Phase 6] Update card progress bar (không cần API call)
   * @param {string} wfId
   * @param {number} percent - 0-100
   */
  _updateCardProgress(wfId, percent) {
    console.log('[WorkflowList] _updateCardProgress:', wfId, percent + '%');
    const card = this.container.querySelector(`.workflow-card[data-wf-id="${wfId}"]`);
    if (!card) {
      console.warn('[WorkflowList] Card not found for progress update:', wfId);
      return;
    }

    // [rebuild] ĐÃ BỎ thanh progress (thanh cam ở đáy + thanh xanh) — line Gemini chạy quanh viền đã
    // báo "đang chạy" + chữ "%" bên dưới đã cho biết tiến độ chính xác → thanh thừa + lệch tông (cam đá
    // với Gemini, dễ nhầm cam-cảnh-báo). Dọn luôn thanh cũ nếu còn sót trên card (từ render trước).
    card.querySelector('.workflow-card-inline-progress')?.remove();
    card.querySelector('.workflow-card-progress')?.remove();

    // [Phase 1] Cập nhật "%" theo markup MỚI (.wf-status-dot • .wf-node-count • .wf-progress-text).
    // Trước đây parse regex `^\d+ nodes` — markup đổi (bắt đầu bằng nhãn trạng thái) → không bao giờ
    // khớp → % không cập nhật. Giờ tìm/tạo .wf-progress-text và set trực tiếp.
    const metaEl = card.querySelector('.workflow-card-meta');
    if (metaEl) {
      let pctEl = metaEl.querySelector('.wf-progress-text');
      if (!pctEl) {
        const divider = document.createElement('span');
        divider.className = 'wf-meta-divider';
        divider.textContent = '•';
        pctEl = document.createElement('span');
        pctEl.className = 'wf-progress-text';
        metaEl.appendChild(divider);
        metaEl.appendChild(pctEl);
      }
      pctEl.textContent = `${percent}%`;
    }
  }

  /**
   * [Phase 1 — optimistic UI] Đánh dấu card "đang chuẩn bị chạy" NGAY khi bấm Run (trước các bước
   * async: getWorkflow → project gate → preflight modal) để phản hồi tức thì (hết cảm giác đơ).
   * Tự phục hồi: execution:started gỡ (chuyển sang running); nếu run bị huỷ/chặn → safety-timer gỡ.
   * @param {string} wfId
   * @param {boolean} on
   */
  _setCardPreparing(wfId, on) {
    const card = this.container?.querySelector(`.workflow-card[data-wf-id="${wfId}"]`);
    if (!card) return;
    card.classList.toggle('wf-preparing', !!on);
    const runBtn = card.querySelector('.wf-btn-run') || card.querySelector('.run-btn');
    if (runBtn) runBtn.disabled = !!on;
  }

  /**
   * [API SPAM FIX — Phase 6] Update card running/completed state (không cần API call)
   * @param {string} wfId
   * @param {boolean} isRunning
   * @param {string} [finalStatus] - 'completed', 'failed', etc. (khi isRunning=false)
   */
  _updateCardRunningState(wfId, isRunning, finalStatus = null) {
    const card = this.container.querySelector(`.workflow-card[data-wf-id="${wfId}"]`);
    if (!card) {
      // Workflow card không có trong DOM hiện tại (vd: workflow ở trang khác trong pagination).
      // Defer update qua `_debouncedUpdateSingleWorkflow` — sẽ fetch lại workflow data + tự
      // re-render card nếu visible. Log lite (debug only) thay vì warn vì đây là kịch bản hợp lệ.
      if (this._verboseLog) console.debug('[WorkflowList] Card not in DOM (likely off-page), defer update:', wfId);
      this._debouncedUpdateSingleWorkflow?.(wfId);
      return;
    }
    if (this._verboseLog) console.debug('[WorkflowList] _updateCardRunningState:', wfId, isRunning, finalStatus);

    // Update status class trên card (không có prefix "status-", CSS dùng .workflow-card.completed etc.)
    card.classList.remove('pending', 'running', 'completed', 'failed', 'paused', 'idle', 'warning');
    const newStatus = isRunning ? 'running' : (finalStatus || 'pending');
    card.classList.add(newStatus);

    // Update modern status dot and text
    const statusDot = card.querySelector('.wf-status-dot');
    if (statusDot) {
      statusDot.className = `wf-status-dot ${newStatus}`;
    }
    const statusText = card.querySelector('.wf-status-text');
    if (statusText) {
      statusText.textContent = WorkflowList._renderStatusLabel(newStatus);
    }
    // [rebuild] Đã BỎ thanh progress — line Gemini chạy quanh viền + chữ "%" đã đủ. Chỉ dọn thanh cũ.
    card.querySelector('.workflow-card-name-row')?.querySelector('.workflow-card-inline-progress')?.remove();
    card.querySelector('.workflow-card-progress')?.remove();

    // Run/Stop buttons logic for modern actions
    const dropdownMenu = card.querySelector('.seosonaflow-dot-menu');
    const runBtn = card.querySelector('.wf-btn-run');
    let stopBtn = card.querySelector('.stop-btn');
    const actionsDiv = card.querySelector('.workflow-card-actions');

    if (isRunning) {
      if (dropdownMenu) dropdownMenu.style.display = 'none';
      if (runBtn) runBtn.style.display = 'none';

      // Tạo stop button nếu chưa có
      if (!stopBtn && actionsDiv) {
        stopBtn = document.createElement('button');
        stopBtn.className = 'btn btn-secondary btn-sm btn-warning stop-btn';
        stopBtn.title = window.I18n?.t('common.stop') || 'Dừng';
        stopBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="6" y="6" width="12" height="12"></rect>
          </svg>
        `;
        actionsDiv.appendChild(stopBtn);
        
        stopBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const wf = this.workflows.find(w => w.wf_id === wfId);
          const isAdminView = wf?._is_admin_view || (wf?.user?.id && wf.user.id !== window.authManager?.user?.id);
          if (isAdminView) return;
          this.stopWorkflow(wfId);
        });
      } else if (stopBtn) {
        stopBtn.style.display = 'flex';
      }
    } else {
      // Khi không còn chạy
      if (dropdownMenu) dropdownMenu.style.display = 'block';
      if (runBtn) runBtn.style.display = 'flex';
      if (stopBtn) stopBtn.style.display = 'none';
    }

    // [rebuild] ĐÃ BỎ thanh progress (line Gemini chạy quanh viền + chữ "%" đã đủ) — chỉ dọn thanh cũ nếu còn.
    card.querySelector('.workflow-card-progress')?.remove();
    card.querySelector('.workflow-card-inline-progress')?.remove();
    if (!isRunning) {
      // Hide running buttons container
      const runningBtns = card.querySelector('.wf-running-buttons');
      if (runningBtns) runningBtns.style.display = 'none';

      // Restore dropdown menu
      if (dropdownMenu) dropdownMenu.style.display = '';
      runBtn?.classList.remove('hidden');
      if (stopBtn && !stopBtn.closest('.wf-running-buttons')) {
        stopBtn.classList.add('hidden');
      }

      // Restore toggle button khi không running
      const toggleBtn = card.querySelector('.wf-toggle-btn');
      if (toggleBtn) toggleBtn.style.display = '';

      // Hide progress bars when done
      const progressContainer = card.querySelector('.workflow-card-progress');
      if (progressContainer) progressContainer.classList.add('hidden');
      const inlineProgress = card.querySelector('.workflow-card-inline-progress');
      if (inlineProgress) inlineProgress.style.display = 'none';

      // [Phase 1] Gỡ "%" khỏi meta khi dừng chạy — markup mới: xoá .wf-progress-text + divider
      // liền trước nó (do _updateCardProgress chèn). Không rebuild innerHTML (giữ status-dot/node-count).
      const metaEl = card.querySelector('.workflow-card-meta');
      if (metaEl) {
        const pctEl = metaEl.querySelector('.wf-progress-text');
        if (pctEl) {
          const prev = pctEl.previousElementSibling;
          if (prev && prev.classList.contains('wf-meta-divider')) prev.remove();
          pctEl.remove();
        }
      }
    }
  }

  /**
   * Debounced update single workflow - coalesce multiple updates cho cùng wfId
   * @param {string} wfId
   */
  _debouncedUpdateSingleWorkflow(wfId) {
    if (!wfId) return;
    console.log('[WorkflowList] _debouncedUpdateSingleWorkflow called:', wfId);
    // Track running workflow để các event không có wfId có thể dùng
    this._lastUpdatedWfId = wfId;

    const key = `_updateTimer_${wfId}`;
    if (this[key]) clearTimeout(this[key]);
    this[key] = setTimeout(() => {
      this[key] = null;
      this._updateSingleWorkflowInList(wfId);
    }, 500);
  }

  _bindToolbarEvents() {
    // Search toggle
    // [GỠ A2] #wfSearchToggle/#wfSearchRow/#wfSearchClose không tồn tại trong sidebar.html (search luôn
    // hiện, không collapse) → 2 nhánh toggle/close dead. Chỉ giữ #wfSearchInput (live).
    const searchInput = this.container.querySelector('#wfSearchInput');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this._searchQuery = e.target.value.toLowerCase();
        this._currentPage = 1; // reset pagination
        this.render();
      });
    }

    // Create workflow handler
    // Luôn fetch async từ server để có entitlements mới nhất theo user plan
    const handleCreate = async () => {
      // [Audit 2026-07-07] Workflow web mode ON → tạo mới trên WEB spaces popup thay vì editor extension.
      if (await (window.SystemConfig?.getBoolReady?.('workflow_web_mode'))) {
        chrome.runtime.sendMessage({ action: 'openWebSpaces', createNew: true }, (resp) => {
          void chrome.runtime.lastError;
          if (!resp?.ok) window.showNotification?.(window.I18n?.t('workflow.openWebFailed') || 'Không mở được editor web', 'error');
        });
        return;
      }
      if (window.featureGate) {
        const canCreate = await window.featureGate.canCreateWorkflowAsync();
        if (!canCreate) {
          const isLoggedIn = window.authManager?.isLoggedIn();
          if (!isLoggedIn) {
            window.featureGate.showLoginPrompt(
              window.I18n?.t('workflow.requireLoginToCreate') || 'Tạo workflow yêu cầu đăng nhập'
            );
          } else {
            const quota = window.featureGate.checkQuota('workflows_max');
            console.log('[WorkflowList] Workflow quota exceeded:', quota);
            const shouldUpgrade = await window.customDialog?.confirm(
              window.I18n?.t('workflow.quotaLimitReached', { limit: quota.limit, used: quota.used }) || `Gói của bạn giới hạn tối đa ${quota.limit} workflow. Bạn đã có ${quota.used} workflow. Nâng cấp Premium để tạo không giới hạn.`,
              { title: window.I18n?.t('workflow.quotaLimitTitle') || 'Limit reached', type: 'warning', confirmText: window.I18n?.t('common.upgrade') || 'Upgrade', cancelText: window.I18n?.t('common.later') || 'Later' }
            );
            /* upgrade modal removed — local-first; confirm is now informational only */
            void shouldUpgrade;
          }
          return;
        }
      }
      if (window.eventBus) window.eventBus.emit('workflow:open_editor', { mode: 'create' });
    };

    // Single merged Create Button + 2 Options Dropdown.
    // FIX A1: #wfCreateMenuWrapper (createBtn+dropdown+options) sống ở DOCUMENT-level (sibling của
    // #tab-spaces), KHÔNG trong this.container (=pane workflows) → this.container.querySelector trả
    // null → nút "+" & option Manual/AI không bind. Dùng document.getElementById (giống WorkflowAgentModal).
    const createBtn = document.getElementById('createWorkflowBtn');
    const createFirstBtn = this.container.querySelector('#createFirstWorkflowBtn');
    const createDropdown = document.getElementById('wfCreateDropdown');
    const optManual = document.getElementById('optCreateManual');
    const optAi = document.getElementById('optCreateAi');

    if (createBtn && createDropdown) {
      createBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        createDropdown.classList.toggle('hidden');
      });
      document.addEventListener('click', (e) => {
        if (!createDropdown.contains(e.target) && e.target !== createBtn) {
          createDropdown.classList.add('hidden');
        }
      });
    } else {
      createBtn?.addEventListener('click', handleCreate);
    }

    optManual?.addEventListener('click', (e) => {
      e.stopPropagation();
      createDropdown?.classList.add('hidden');
      handleCreate();
    });

    optAi?.addEventListener('click', (e) => {
      e.stopPropagation();
      createDropdown?.classList.add('hidden');
      if (window.WorkflowAgentModal?.open) {
        window.WorkflowAgentModal.open();
      }
    });

    createFirstBtn?.addEventListener('click', handleCreate);

    // Empty-state CTA phụ: "Xem mẫu có sẵn" → chuyển sang subtab Templates (click nút subtab).
    const browseTplBtn = this.container.querySelector('#browseTemplatesFromEmpty');
    browseTplBtn?.addEventListener('click', () => {
      const tab = document.querySelector('.seosonaflow-workflow-subtab[data-subtab="templates"]');
      if (tab) tab.click();
      else window.eventBus?.emit('workflow:subtab_changed', { subtab: 'templates' });
    });

    // Refresh button
    const refreshBtn = this.container.querySelector('#refreshWorkflowsBtn');
    refreshBtn?.addEventListener('click', () => {
      // 2026-05-25: User-initiated refresh — force show loading + force render + spin animation
      refreshBtn.classList.add('spinning');
      Promise.resolve(this.loadWorkflows(false, { forceShowLoading: true, forceRender: true }))
        .finally(() => setTimeout(() => refreshBtn.classList.remove('spinning'), 500));
    });

    // Run All button
    const runAllBtn = this.container.querySelector('#runAllWorkflowsBtn');
    runAllBtn?.addEventListener('click', () => {
      if (this.isRunningAll) {
        this.stopAllWorkflows();
      } else {
        this.runAllWorkflows();
      }
    });

    // Import button
    const importBtn = this.container.querySelector('#importWorkflowBtn');
    importBtn?.addEventListener('click', () => this._handleImportClick());
  }

  async loadWorkflows(append = false, options = {}) {
    // Seed workflow mẫu đóng gói (local mode, chạy 1 lần) trước khi đọc danh sách local.
    if (!append) { try { await window.seedBundledWorkflows?.(); } catch (_) { /* ignore */ } }
    // 2026-05-25: options.forceShowLoading — manual refresh button passes true để show
    // skeleton ngay (kể cả khi data có thể unchanged).
    // options.forceRender — bypass signature-skip → user thấy refresh feedback rõ.
    const { forceShowLoading = false, forceRender = false } = options;

    // [API SPAM FIX — Phase 6] Block full reload khi workflow đang chạy hoặc vừa xong (cooldown)
    // Tránh giật UI và API spam - chỉ cho phép single update
    if ((window.workflowExecutor?.isRunning || this._executionCooldown) && this._lastUpdatedWfId && !append) {
      console.log('[WorkflowList] BLOCKED loadWorkflows - executor running or cooldown');
      return;
    }

    // Debounce: if already loading, queue a reload after current finishes
    if (this._loading) {
      this._loadPending = true;
      return;
    }
    // Debounce rapid calls (e.g., multiple events firing in quick succession)
    if (this._loadDebounceTimer) {
      clearTimeout(this._loadDebounceTimer);
    }
    this._loadDebounceTimer = setTimeout(() => {
      this._loadDebounceTimer = null;
    }, 100);

    this._loading = true;
    this._loadPending = false;

    try {
      // 2026-05-25: Show skeleton ở 2 case:
      //   1. Initial load (chưa render lần nào — `_lastRenderSignature` empty)
      //   2. forceShowLoading = true (user manual refresh — cần feedback rõ)
      // Trước fix: showLoading chạy mọi lần → 2nd call (event-driven) replace list với skeleton →
      // signature-skip render → skeleton stuck forever.
      if (!append) {
        if (!this._lastRenderSignature || forceShowLoading) this.showLoading();
        this._currentPage = 1;
      }

      // CRITICAL: Defensive guard — nếu user đã login mà storage vẫn ở local mode
      if (window.authManager?.isLoggedIn() && window.storageManager?.getMode?.() === 'local') {
        try { await window.storageManager.switchToApi(); }
        catch (e) { console.warn('[WorkflowList] switchToApi failed:', e.message); }
      }

      if (window.storageManager) {
        const page = append ? this._currentPage + 1 : 1;
        const result = await window.storageManager.getWorkflows({
          page,
          per_page: this._pageSize,
          platform: 'flow'
        });

        const newWorkflows = (result.data || []).filter(w => !w.platform || w.platform === 'flow');

        if (append) {
          this.workflows = [...this.workflows, ...newWorkflows];
        } else {
          this.workflows = newWorkflows;
        }

        // [FIX status tồn đọng] Auto-reset trạng thái "đã chạy xong" CŨ → "Chờ" khi mở lại panel.
        // Áp cho CẢ 'completed' (xanh) LẪN 'warning' (cam — bỏ qua node, KHÔNG phải lỗi): card chạy xong
        // TRONG session này (_finishedThisSession) giữ màu; từ session TRƯỚC (đọc storage) → "Chờ" + đưa
        // lại vào Chạy-tất-cả. 'failed' (lỗi thật) KHÔNG reset. Giữ last_run_at. In-memory → không ghi storage.
        this._finishedThisSession = this._finishedThisSession || new Set();
        this.workflows.forEach(w => {
          // completed/warning/paused = "đã chạy xong / đã dừng" (KHÔNG phải lỗi) → về 'idle' khi mở lại
          // panel (trừ cái vừa chạy trong session). CHỈ 'failed' persist. Đồng bộ: mọi non-error đều reset.
          if ((w.status === 'completed' || w.status === 'warning' || w.status === 'paused')
              && !this._finishedThisSession.has(w.wf_id)) w.status = 'idle';
        });

        // [Phase 0] Gắn node-count thật (đếm af_nodes) → khớp Flows, hết bug "0 node".
        await this._attachNodeCounts();

        // Update pagination state
        this._currentPage = result.meta?.current_page || page;
        this._lastPage = result.meta?.last_page || 1;
        this._total = result.meta?.total || this.workflows.length;

        // 2026-05-25: Signature-based render skip — tránh DOM thrash + log spam khi nhiều events
        // (login/OAuth/tab switch/SSE) trigger loadWorkflows liên tiếp với cùng data.
        // Signature gồm: total + per-workflow (id, name, updated_at, status). Đủ bắt change thực sự
        // mà skip noise. Skip render KHÔNG ảnh hưởng pagination state (đã update bên trên).
        const newSignature = `${this._total}:${this._currentPage}/${this._lastPage}:` +
          this.workflows.map(w => `${w.wf_id}|${w.name || w.wf_name}|${w.updated_at || ''}|${w.status || ''}`).join(',');
        // 2026-05-25: forceRender bypass signature-skip — manual refresh button.
        // Đảm bảo user click refresh thấy list re-render (kể cả data unchanged).
        if (!append && !forceRender && this._lastRenderSignature === newSignature) {
          // Same data → skip render + log. Cập nhật _lastLoadTime để track tần suất nếu cần debug.
          this._lastLoadTime = Date.now();
        } else {
          this._lastRenderSignature = newSignature;
          console.log('[WorkflowList] Loaded page', this._currentPage, '/', this._lastPage, '- total:', this._total);
          await this._cacheProjectNames();
          // Query which workflow is being edited
          try {
            const resp = await chrome.runtime.sendMessage({ action: 'getEditingWorkflowId' });
            this._editingWfId = resp?.editingWorkflowId || null;
          } catch (e) {
            this._editingWfId = null;
          }
          this.renderWorkflowList();
        }
      }
    } catch (error) {
      // [API SPAM FIX — Phase 2.1] 429 → giữ data cũ + show banner + auto-retry sau cooldown.
      // Tránh xóa danh sách khiến user thấy empty UI khi backend rate limit.
      if (error?.code === 'RATE_LIMITED' || error?.httpStatus === 429) {
        const retryAfter = Number(error.retryAfter) || 60;
        console.warn('[WorkflowList] Rate limited, giữ data cũ, retry sau', retryAfter, 's');
        this._showRateLimitBanner(retryAfter);
        // Vẫn render data cũ (không xóa)
        this.renderWorkflowList();
      } else {
        console.error('[WorkflowList] Load failed:', error);
        this.showError(window.I18n?.t('workflow.loadFailed') || 'Không thể tải danh sách workflows');
      }
    } finally {
      this._loading = false;
      // Process pending reload request (queued while this load was running)
      if (this._loadPending) {
        this._loadPending = false;
        setTimeout(() => this.loadWorkflows(), 50);
      }
    }
  }

  /**
   * [API SPAM FIX — Phase 2.1] Hiển thị banner cảnh báo rate-limited + auto-retry sau cooldown.
   * Banner countdown realtime giúp user biết khi nào tự reload.
   * @param {number} retryAfter - Cooldown seconds
   */
  _showRateLimitBanner(retryAfter) {
    let banner = this.container.querySelector('.wf-rate-limit-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'wf-rate-limit-banner';
      // Insert ngay sau toolbar (đầu danh sách)
      const listSection = this.container.querySelector('#workflowListSection') || this.container;
      listSection.prepend(banner);
    }
    banner.style.display = 'flex';

    const clockIcon = `<svg class="wf-rate-limit-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
    const tBase = window.I18n?.t?.('workflow.rateLimitedBanner') || 'Gói của bạn đang bị giới hạn. Tự động thử lại sau {seconds}s...';
    let remaining = retryAfter;
    const update = () => {
      const text = tBase.replace('{seconds}', `<span class="wf-rate-limit-countdown">${remaining}</span>`);
      banner.innerHTML = `${clockIcon}<span class="wf-rate-limit-text">${text}</span>`;
    };
    update();

    // Clear timer cũ nếu có
    if (this._rateLimitTimer) clearInterval(this._rateLimitTimer);
    if (this._rateLimitRetryTimer) clearTimeout(this._rateLimitRetryTimer);

    this._rateLimitTimer = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(this._rateLimitTimer);
        this._rateLimitTimer = null;
        banner.style.display = 'none';
      } else {
        update();
      }
    }, 1000);

    // Auto-retry sau cooldown
    this._rateLimitRetryTimer = setTimeout(() => {
      this._rateLimitRetryTimer = null;
      this.loadWorkflows();
    }, retryAfter * 1000);
  }

  /**
   * Load workflows được chia sẻ với user hiện tại
   * GET /v1/workflows/shared-with-me
   */
  async loadSharedWorkflows() {
    // LOCAL mode: workflow chia sẻ cộng đồng cần backend → rỗng, không fetch.
    if (self.SEOSONA_LOCAL_MODE !== false) {
      this._sharedWorkflows = [];
      return;
    }
    // Chỉ load khi user đã đăng nhập
    if (!window.authManager?.isLoggedIn()) {
      this._sharedWorkflows = [];
      return;
    }

    try {
      const baseUrl = window.ApiBaseConfig.get();
      const token = await window.authManager.getToken();

      const response = await fetch(`${baseUrl}/workflows/shared-with-me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Extension-Id': chrome.runtime.id,
        }
      });

      if (!response.ok) {
        // Silent fail for 404 (feature not deployed yet)
        this._sharedWorkflows = [];
        return;
      }

      const json = await response.json();

      // Parse defensive — handle cả 3 shape có thể có:
      //   1. { success, data: { workflows: [flat_wf] } }              ← shape mới (BE đã update)
      //   2. { success, data: [share_record_with_nested_workflow] }   ← shape cũ
      //   3. [flat_wf]                                                  ← shape rất cũ (legacy)
      let items = [];
      if (Array.isArray(json)) {
        items = json;
      } else if (Array.isArray(json?.data?.workflows)) {
        items = json.data.workflows;
      } else if (Array.isArray(json?.workflows)) {
        items = json.workflows;
      } else if (Array.isArray(json?.data)) {
        items = json.data;
      }

      this._sharedWorkflows = items.map(item => {
        // Nếu là share record (có nested workflow) → flatten
        const wf = item.workflow || item;
        return {
          ...wf,
          _is_shared_view: true,
          _share_id: item._share_id || item.id,
          sharer_name: item._sharer_name || item.sharer?.name || item.sharer_name,
          sharer_email: item._sharer_email || item.sharer?.email,
          shared_at: item._shared_at || item.accepted_at || item.shared_at,
        };
      });

      if (this._sharedWorkflows.length > 0) {
        console.log('[WorkflowList] Loaded', this._sharedWorkflows.length, 'shared workflows');
      }
      // Update badge count + nếu user đang ở tab "Shared" → re-render content
      this._updateSharedTabBadge();
      const rootContainer = this.container.closest('#tab-spaces') || document;
      const sharedContent = rootContainer.querySelector('[data-content="shared"]');
      if (sharedContent && sharedContent.style.display !== 'none') {
        this.renderSharedTab(sharedContent);
      }
    } catch (error) {
      console.warn('[WorkflowList] loadSharedWorkflows failed:', error.message);
      this._sharedWorkflows = [];
      this._updateSharedTabBadge();
    }
  }

  async render() {
    const listContainer = this.container.querySelector('#workflowList');
    const emptyState = this.container.querySelector('#workflowEmptyState');

    // Update Run All button visibility (event listener bound once in _bindToolbarEvents)
    const runAllBtn = this.container.querySelector('#runAllWorkflowsBtn');
    if (runAllBtn) {
      runAllBtn.classList.toggle('hidden', this.workflows.length === 0);
    }

    if (!listContainer) return;

    // Inline project select in toolbar
    const inlineSelect = this.container.querySelector('#wfProjectSelectInline');

    // [QĐ-3 gộp Flows→My Spaces] My Spaces giờ hiện TẤT CẢ workflow (cả bản flow_kind==='flow').
    // Subtab "Flows" tách rời đã ẩn để hết cảnh 1 tab trống khó hiểu (Flows chỉ lọc flow_kind='flow',
    // đa số user có 0 → trống). Trước đây: filter(w => w.flow_kind !== 'flow').
    const spaceWorkflows = this.workflows.slice();

    // Y-2: Apply project filter
    let displayWorkflows = spaceWorkflows;
    if (this._filterProjectId) {
      if (this._filterProjectId === '__legacy__') {
        displayWorkflows = spaceWorkflows.filter(w => !w.project_id);
      } else {
        displayWorkflows = spaceWorkflows.filter(w => w.project_id === this._filterProjectId);
      }
    }

    // Apply search filter (search by name or ID)
    if (this._searchQuery) {
      displayWorkflows = displayWorkflows.filter(w =>
        w.wf_name?.toLowerCase().includes(this._searchQuery) ||
        w.wf_id?.toLowerCase().includes(this._searchQuery)
      );
    }

    if (spaceWorkflows.length === 0) {
      listContainer.innerHTML = '';
      listContainer.classList.add('hidden');
      if (inlineSelect) inlineSelect.classList.add('hidden');
      emptyState?.classList.remove('hidden');
      return;
    }

    if (displayWorkflows.length === 0) {
      listContainer.innerHTML = this._searchQuery
        ? `<div class="workflow-empty-state"><p>${window.I18n?.t('workflow.notFound') || 'Không tìm thấy workflow'}</p></div>`
        : '';
      listContainer.classList.toggle('hidden', !this._searchQuery);
      if (!this._searchQuery) emptyState?.classList.remove('hidden');
      // Still show filter so user can switch back
      await this._renderProjectFilter();
      return;
    }

    emptyState?.classList.add('hidden');
    listContainer.classList.remove('hidden');

    // Phase 2: Migration banner — đếm legacy items (project_id=null) trong toàn bộ list
    // (không chỉ visible page) để show prompt ngay nếu user có legacy items.
    // Admin mode: chỉ đếm workflows của chính mình (không phải của users khác)
    const currentUserId = window.authManager?.user?.id;
    const legacyWorkflows = this.workflows.filter(w => {
      if (w.project_id) return false; // Đã có project
      // Nếu workflow có user info (admin mode) → chỉ đếm của mình
      if (w.user?.id && currentUserId) return w.user.id === currentUserId;
      return true; // User thường (không có user field) → đếm hết
    });
    const migrationBanner = window.ProjectHelper?.renderMigrationBanner?.(legacyWorkflows.length, 'workflow') || '';

    // Server-side pagination — hiển thị tất cả workflows đã load
    const visibleWorkflows = displayWorkflows;
    const hasMore = this._currentPage < this._lastPage;
    const remaining = this._total - this.workflows.length;

    // Y-2: If showing all and ProjectHelper available, group by project
    if (!this._filterProjectId && window.ProjectHelper) {
      const grouped = await window.ProjectHelper.sortByProjectGroup(visibleWorkflows, window._currentProjectId);
      let html = migrationBanner;
      for (const entry of grouped) {
        if (entry.type === 'header') {
          html += window.ProjectHelper.renderGroupHeader(entry.projectName, entry.count, entry.isCurrent);
        } else {
          html += this.renderWorkflowCard(entry.item);
        }
      }
      listContainer.innerHTML = html;
    } else {
      // Specific filter or no ProjectHelper — MỚI/VỪA SỬA lên đầu (đồng bộ path nhóm-project,
      // rebuild My Spaces). Ưu tiên updated_at → created_at → timestamp trong wf_id. DESC.
      const _timeOf = (x) => {
        const t = x.updated_at || x.created_at;
        if (t) { const ms = new Date(t).getTime(); if (!isNaN(ms)) return ms; }
        return parseInt((x.wf_id || '').replace('wf_', '')) || 0;
      };
      const sorted = [...visibleWorkflows].sort((a, b) => _timeOf(b) - _timeOf(a));
      listContainer.innerHTML = migrationBanner + sorted.map(wf => this.renderWorkflowCard(wf)).join('');
    }

    // Bind migration banner click (Gán / Bỏ qua)
    listContainer.querySelector('.legacy-migrate-banner[data-type="workflow"]')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('.legacy-migrate-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'skip') {
        sessionStorage.setItem('legacy_migrate_workflow_dismissed', '1');
        this.render();
      } else if (action === 'assign') {
        const count = await window.ProjectHelper.migrateLegacyItems(legacyWorkflows, 'workflow');
        if (count > 0) {
          window.showNotification?.(
            (window.I18n?.t('project.migrateSuccess', { count }) || `Đã gán ${count} item vào project hiện tại`),
            'success', 2500
          );
          await this.loadWorkflows();
        }
      }
    });

    // Append load-more button nếu còn pages chưa load
    if (hasMore) {
      const loadMoreLabel = window.I18n?.t('common.loadMore') || 'Tải thêm';
      listContainer.insertAdjacentHTML('beforeend', `
        <div class="seosonaflow-load-more-row">
          <button class="seosonaflow-load-more-btn" id="wfLoadMoreBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            ${loadMoreLabel}
            <span class="seosonaflow-load-more-count">${this.workflows.length} / ${this._total}</span>
          </button>
        </div>
      `);
      listContainer.querySelector('#wfLoadMoreBtn')?.addEventListener('click', () => {
        if (!this._loading) {
          this.loadWorkflows(true); // Load next page from server
        }
      });
    }

    // Y-2: Render project filter toolbar
    await this._renderProjectFilter();

    // Bind card events
    listContainer.querySelectorAll('.workflow-card').forEach(card => {
      const wfId = card.dataset.wfId;

      // Toggle enabled (skip for admin view)
      const toggleBtn = card.querySelector('.wf-toggle-btn');
      if (toggleBtn) {
        toggleBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const wf = this.workflows.find(w => w.wf_id === wfId);
          const isAdminView = wf?._is_admin_view || (wf?.user?.id && wf.user.id !== window.authManager?.user?.id);
          if (isAdminView) return;
          this.toggleWorkflowEnabled(wfId);
        });
      }

      // 3-dot menu
      const dotMenu = card.querySelector('.seosonaflow-dot-menu');
      if (dotMenu) {
        const menuBtn = dotMenu.querySelector('.seosonaflow-dot-menu-btn');
        const dropdown = dotMenu.querySelector('.seosonaflow-dropdown-menu');
        menuBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          console.log('[WorkflowList] Menu button clicked:', wfId, 'dropdown:', dropdown, 'wasHidden:', dropdown?.classList.contains('hidden'));
          const wasHidden = dropdown?.classList.contains('hidden');
          this._closeAllDropdowns(listContainer);
          if (dropdown && wasHidden) {
            dropdown.classList.remove('hidden');
            this._positionDropdown(menuBtn, dropdown);
            // Close on outside click
            setTimeout(() => {
              document.addEventListener('click', () => this._closeAllDropdowns(listContainer), { once: true });
            }, 0);
          }
        });
      }

      // 2026-06-05: Bỏ open-project-btn handler — button đã removed khỏi render (line 2046).
      // Edit button handler tự detect cross-project + show modal "Mở project" → navigate +
      // auto-open editor sau project:changed.

      // Y-4: Edit button with cross-project guard (skip for admin view)
      // 2026-06-05: Cross-project Edit flow — modal "Mở project" + auto-open editor sau switch.
      // Đồng bộ với Edit handler ở _bindCard line 631-662.
      const editBtn = card.querySelector('.edit-btn');
      editBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        const wf = this.workflows.find(w => w.wf_id === wfId);
        // Skip cross-project warning for admin view (viewing other user's workflows)
        const isAdminView = wf?._is_admin_view || (wf?.user?.id && wf.user.id !== window.authManager?.user?.id);
        if (wf && !isAdminView && window.ProjectHelper && !window.ProjectHelper.isCurrentProject(wf)) {
          const action = await window.ProjectHelper.showCrossProjectWarning(wf, 'workflow', {
            confirmTextKey: 'project.openProject',
            confirmTextFallback: 'Mở project',
          });
          if (action === 'switch') {
            // Track pending auto-open: project:changed listener sẽ check + _openWorkflow.
            const pending = { wfId, projectId: wf.project_id, ts: Date.now() };
            this._pendingOpenAfterSwitch = pending;
            setTimeout(() => {
              if (this._pendingOpenAfterSwitch === pending) {
                console.log('[WorkflowList] Pending auto-open expired (30s):', wfId);
                this._pendingOpenAfterSwitch = null;
              }
            }, 30000);
            window.ProjectHelper.navigateToProject(wf.project_id);
          }
          return;
        }
        this._openWorkflow(wfId, card);
      });

      // Copy/Clone button
      const copyBtn = card.querySelector('.copy-btn');
      copyBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this.cloneWorkflow(wfId);
      });

      // [Phase 3] "Đưa vào Flows" — copy độc lập sang Flows.
      const toFlowsBtn = card.querySelector('.to-flows-btn');
      toFlowsBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        await this._addToFlows(wfId);
      });

      // Y-4: Run button with cross-project guard (skip for admin view)
      const runBtn = card.querySelector('.run-btn');
      runBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        const wf = this.workflows.find(w => w.wf_id === wfId);
        // Skip cross-project warning for admin view (viewing other user's workflows)
        const isAdminView = wf?._is_admin_view || (wf?.user?.id && wf.user.id !== window.authManager?.user?.id);
        if (wf && !isAdminView && window.ProjectHelper && !window.ProjectHelper.isCurrentProject(wf)) {
          const action = await window.ProjectHelper.showCrossProjectWarning(wf, 'workflow');
          if (action === 'switch') window.ProjectHelper.navigateToProject(wf.project_id);
          return;
        }
        this.runWorkflow(wfId);
        // Cross-link Spaces: báo Spaces tab tự chuyển sang "Flows" để theo dõi (đồng bộ path surgical 719-721).
        try { window.eventBus?.emit('workflow:run_started', { wfId }); } catch (e) { console.warn('[WorkflowList] Khong phat duoc workflow:run_started -> the/tab co the khong doi sang trang thai dang chay:', e && e.message); }
      });

      // Stop button (skip for admin view)
      const stopBtn = card.querySelector('.stop-btn');
      stopBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        const wf = this.workflows.find(w => w.wf_id === wfId);
        const isAdminView = wf?._is_admin_view || (wf?.user?.id && wf.user.id !== window.authManager?.user?.id);
        if (isAdminView) return;
        this.stopWorkflow(wfId);
      });

      // Reset button (skip for admin view)
      const resetBtn = card.querySelector('.reset-btn');
      resetBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        const wf = this.workflows.find(w => w.wf_id === wfId);
        const isAdminView = wf?._is_admin_view || (wf?.user?.id && wf.user.id !== window.authManager?.user?.id);
        if (isAdminView) return;
        this.resetWorkflow(wfId);
      });

      // Export button
      const exportBtn = card.querySelector('.export-btn');
      exportBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this.exportWorkflow(wfId);
      });

      // Delete button
      const deleteBtn = card.querySelector('.delete-btn');
      deleteBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this.deleteWorkflow(wfId);
      });
    });

    // Close dropdowns handled per-menu-open (in menuBtn click handler)

    // Bind share button cho owned workflows
    listContainer.querySelectorAll('.share-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wfId = btn.closest('.workflow-card')?.dataset.wfId;
        if (wfId) {
          this._closeAllDropdowns(listContainer);
          this.handleShare(wfId);
        }
      });
    });

    // [Affiliate Creator Page] Bind + reveal "Xuất bản làm Template" trong full render.
    // (Trước fix: chỉ bind/reveal trong _bindSingleCardEvents → full render/refresh → publish kẹt 'hidden'.)
    listContainer.querySelectorAll('.publish-template-btn').forEach(btn => {
      if (btn._bound) return; // tránh double-bind khi render lại chồng _bindSingleCardEvents
      btn._bound = true;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const wfId = btn.closest('.workflow-card')?.dataset.wfId;
        if (wfId) {
          this._closeAllDropdowns(listContainer);
          this.publishAsTemplate(wfId);
        }
      });
    });
    if (window.CreatorTemplatePublish?.isEligible) {
      window.CreatorTemplatePublish.isEligible().then((ok) => {
        if (ok) listContainer.querySelectorAll('.publish-template-btn').forEach(b => b.classList.remove('hidden'));
      }).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowList#renderWorkflowList', _e); });
    }
  }

  /**
   * Render lại workflow list. Shared workflows hiện ở tab riêng (Shared with me) —
   * KHÔNG render section trong tab Workflows nữa.
   */
  renderWorkflowList() {
    this.render();
    // Update badge count cho tab Shared
    this._updateSharedTabBadge();
  }

  /**
   * Cập nhật badge số lượng trên tab "Shared with me"
   */
  _updateSharedTabBadge() {
    // Search trong root container của WorkflowTab (parent của #workflowList)
    const rootContainer = this.container.closest('#tab-spaces') || document;
    const badge = rootContainer.querySelector('[data-shared-count]');
    if (!badge) return;
    const count = this._sharedWorkflows?.length || 0;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  /**
   * Render full shared workflows list trong tab "Shared with me".
   * Style giống workflow list của user (card full width).
   * @param {HTMLElement} container - Tab content container ([data-content="shared"])
   */
  renderSharedTab(container) {
    if (!container) return;
    const t = (key, params) => window.I18n?.t(key, params) || key;
    this._updateSharedTabBadge();

    if (!this._sharedWorkflows || this._sharedWorkflows.length === 0) {
      container.innerHTML = `
        <div class="workflow-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
          <p>${t('workflow.sharedEmpty', 'Chưa có workflow nào được chia sẻ với bạn')}</p>
        </div>
      `;
      return;
    }

    // Render danh sách full width — dùng same `_renderSharedWorkflowCard` đã có
    const cards = this._sharedWorkflows.map(wf => this._renderSharedWorkflowCard(wf)).join('');
    container.innerHTML = `
      <div class="workflow-list-container" style="overflow-y: auto; flex: 1; padding: 8px;">
        <div class="workflow-list">${cards}</div>
      </div>
    `;

    // Bind events cho cards
    const listEl = container.querySelector('.workflow-list');
    if (listEl) this._bindSharedCardEvents(listEl);
  }


  /**
   * Render card cho shared workflow
   */
  _renderSharedWorkflowCard(workflow) {
    // Shared workflow → chỉ status icon hiển thị 'completed', card parent giữ neutral
    // (KHÔNG thêm class 'completed' vào .workflow-card để tránh styling completed cho cả card)
    const statusClass = 'completed';
    const nodeCount = workflow.nodes?.length ?? workflow.nodes_count ?? 0;
    const sharerName = workflow.sharer_name || workflow.shared_by_name || 'Người dùng';
    const sharedTime = this._formatSharedTime(workflow.shared_at);

    return `
      <div class="workflow-card" data-wf-id="${workflow.wf_id}" data-shared="true">
        <div style="display: flex; align-items: center; flex: 1; min-width: 0; gap: 10px;">
          <span class="workflow-card-status ${statusClass}" data-tooltip="${WorkflowList._renderStatusLabel(statusClass)}">${WorkflowList._renderStatusIcon(statusClass)}</span>
          <div class="workflow-card-info">
            <div class="workflow-card-name-row">
              <span class="workflow-card-name">${this.escapeHtml(workflow.wf_name || workflow.name || workflow.workflow_name || (window.I18n?.t('workflow.unnamed') || 'Workflow không tên'))}</span>
            </div>
            <div class="workflow-card-meta">
              <span class="wf-node-count">${nodeCount} nodes</span> <span class="wf-meta-divider">•</span> ${window.I18n?.t('workflow.fromSharer', { name: this.escapeHtml(sharerName) }) || `Từ ${this.escapeHtml(sharerName)}`}
            </div>
            ${sharedTime ? `<div class="workflow-card-meta" style="opacity: 0.7; font-size: 11px;">${window.I18n?.t('workflow.acceptedAt', 'Đã nhận')} ${sharedTime}</div>` : ''}
          </div>
        </div>
        <div class="workflow-card-actions">
          <button class="btn btn-secondary btn-sm view-shared-quick-btn" title="${window.I18n?.t('workflow.view') || 'Xem'}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
              <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          <div class="seosonaflow-dot-menu" data-wf-id="${workflow.wf_id}">
            <button class="btn btn-secondary btn-sm seosonaflow-dot-menu-btn" title="Menu">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
              </svg>
            </button>
            <div class="seosonaflow-dropdown-menu hidden">
              <button class="seosonaflow-dropdown-item view-shared-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                ${window.I18n?.t('workflow.view') || 'Xem'}
              </button>
              <button class="seosonaflow-dropdown-item duplicate-shared-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                ${window.I18n?.t('workflow.useWorkflow') || 'Use Workflow'}
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Bind events cho shared workflow cards
   */
  _bindSharedCardEvents(listContainer) {
    // Class `.shared-workflow-card` đã bỏ khỏi markup (card render giống workflow thường).
    // Dùng selector `.workflow-card[data-shared="true"]` để target đúng shared cards.
    const sharedCards = listContainer.querySelectorAll('.workflow-card[data-shared="true"]');

    sharedCards.forEach(card => {
      const wfId = card.dataset.wfId;

      // 3-dot menu
      const dotMenu = card.querySelector('.seosonaflow-dot-menu');
      if (dotMenu) {
        const menuBtn = dotMenu.querySelector('.seosonaflow-dot-menu-btn');
        const dropdown = dotMenu.querySelector('.seosonaflow-dropdown-menu');
        menuBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          const wasHidden = dropdown?.classList.contains('hidden');
          this._closeAllDropdowns(listContainer);
          if (dropdown && wasHidden) {
            dropdown.classList.remove('hidden');
            this._positionDropdown(menuBtn, dropdown);
            setTimeout(() => {
              document.addEventListener('click', () => this._closeAllDropdowns(listContainer), { once: true });
            }, 0);
          }
        });
      }

      // View button (in dropdown)
      const viewBtn = card.querySelector('.view-shared-btn');
      viewBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this._viewSharedWorkflow(wfId);
      });

      // Quick view button (icon bên trái menu 3 chấm)
      const viewQuickBtn = card.querySelector('.view-shared-quick-btn');
      viewQuickBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this._viewSharedWorkflow(wfId);
      });

      // Duplicate button
      const duplicateBtn = card.querySelector('.duplicate-shared-btn');
      duplicateBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this.handleDuplicateFromShared(wfId);
      });
    });
  }

  /**
   * View shared workflow (read-only)
   */
  async _viewSharedWorkflow(wfId) {
    const workflow = this._sharedWorkflows.find(w => w.wf_id === wfId);
    if (!workflow) return;

    // [Lite preview] Route sang template-preview.html SIÊU NHẸ (như template) thay vì editor đầy đủ 82
    // script → tránh GPU tích lũy khi mở nhiều lần. kind='shared' → nút Use gửi cloneSharedWorkflow
    // (POST shared-workflows/{wf_id}/clone) thay vì cloneWorkflowTemplate.
    try {
      chrome.runtime.sendMessage({ action: 'openWorkflowTemplatePreview', template: workflow, kind: 'shared' }, () => void chrome.runtime.lastError);
    } catch (e) {
      console.error('[WorkflowList] open lite shared preview failed:', e?.message);
    }
  }


  /**
   * [Phase 0 — nguồn sự thật node-count] Trả về số node THẬT của workflow.
   * Ưu tiên `_nodeCount` (đếm từ af_nodes trong loadWorkflows — CÙNG nguồn với Flows launcher
   * → 2 tab luôn khớp), fallback nodes.length / nodes_count. KHÔNG dùng progress_total.
   */
  _getNodeCount(workflow) {
    if (!workflow) return 0;
    if (typeof workflow._nodeCount === 'number') return workflow._nodeCount;
    return (workflow.nodes?.length ?? workflow.nodes_count ?? 0);
  }

  /**
   * [Phase 0] Đọc af_nodes 1 lần, đếm node theo wf_id, gắn `_nodeCount` cho mỗi workflow in-mem.
   * Đây là cùng nguồn Flows dùng (WorkflowTab.nodeCountOf) → My Spaces & Flows hiển thị khớp.
   * Chỉ set khi af_nodes có wf_id đó (workflow 0-node không nằm trong af_nodes → fallback tự lo).
   */
  async _attachNodeCounts() {
    try {
      const store = await new Promise((resolve) => {
        try { chrome.storage.local.get(['af_nodes'], (r) => resolve(r || {})); }
        catch (_) { resolve({}); }
      });
      const nodes = Array.isArray(store.af_nodes) ? store.af_nodes : [];
      if (!nodes.length) return;
      const counts = new Map();
      for (const n of nodes) {
        const id = n && n.wf_id;
        if (!id) continue;
        counts.set(id, (counts.get(id) || 0) + 1);
      }
      for (const w of this.workflows) {
        const id = w && w.wf_id;
        if (id && counts.has(id)) w._nodeCount = counts.get(id);
      }
    } catch (_) { /* ignore — _getNodeCount fallback nodes_count/nodes.length */ }
  }

  renderWorkflowCard(workflow) {
    // Force status='pending' nếu workflow vừa được stop (tránh server data stale)
    const isInStoppedSet = this._stoppedWfIds?.has(workflow.wf_id);
    if (isInStoppedSet) {
      console.log('[WorkflowList] renderWorkflowCard: forcing pending for stopped workflow:', workflow.wf_id);
    }
    const statusClass = isInStoppedSet ? 'pending' : (workflow.status || 'idle');
    // [Phase 0] node-count = số node THẬT (đếm af_nodes, cùng nguồn với Flows), KHÔNG dùng
    // progress_total (field lúc chạy → clone/never-run hiện "0 node" sai + lệch Flows).
    const nodeCount = this._getNodeCount(workflow);
    const completedCount = workflow.progress_completed || 0;
    // Mẫu số % vẫn ưu tiên progress_total (tổng node của lần chạy hiện tại), fallback nodeCount.
    const progressTotal = workflow.progress_total || nodeCount;
    const progress = progressTotal > 0 ? Math.round((completedCount / progressTotal) * 100) : 0;
    const isEditing = this._editingWfId === workflow.wf_id;
    const isRunning = workflow.status === 'running' && !this._stoppedWfIds?.has(workflow.wf_id);
    const isEnabled = workflow.enabled !== false;
    const canDelete = !isRunning && !isEditing;

    // Y-2: Project label
    const isCurrent = window.ProjectHelper?.isCurrentProject(workflow) !== false;
    const projectLabel = workflow.project_id && !this._filterProjectId
      ? (window.ProjectHelper?.renderProjectLabel(workflow.project_id, this._projectNames[workflow.project_id] || '', isCurrent) || '')
      : '';
    const crossProjectClass = !isCurrent ? 'cross-project' : '';

    // [Admin mode] Hiển thị owner khi workflow thuộc user khác
    // Check bằng user_id (luôn có) hoặc user.id (chỉ admin mode mới load)
    const currentUserId = window.authManager?.user?.id;
    const workflowOwnerId = workflow.user_id || workflow.user?.id;
    const isAdminViewing = !!(workflowOwnerId && currentUserId && workflowOwnerId !== currentUserId);
    const ownerHtml = isAdminViewing && workflow.user
      ? `<div class="workflow-card-owner" title="${window.I18n?.t('workflow.owner') || 'Chủ sở hữu'}: ${this.escapeHtml(workflow.user.email || '')}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>${this.escapeHtml(workflow.user.name || workflow.user.email || 'User ' + workflow.user.id)}</div>`
      : (isAdminViewing ? `<div class="workflow-card-owner"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>User #${workflowOwnerId}</div>` : '');

    // Last run time / Last edit time
    const lastRunHtml = workflow.last_run_at
      ? `<div class="workflow-card-last-run" title="${window.I18n?.t('workflow.lastRun') || 'Lần chạy gần nhất'}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>${this._formatRelativeTime(workflow.last_run_at)}</div>`
      : '';
    const lastEditHtml = workflow.updated_at
      ? `<div class="workflow-card-last-edit" title="${window.I18n?.t('workflow.lastEdit') || 'Chỉnh sửa gần nhất'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><path d="M9.624 2.34a10.5 10.5 0 0 1 7.195.518A10.46 10.46 0 0 1 21.982 7.9a10.5 10.5 0 0 1 .697 7.172c-.62 2.402-2.08 4.5-4.1 5.935a10.48 10.48 0 0 1-6.963 1.891 10.52 10.52 0 0 1-6.533-3.039 1 1 0 0 1 1.414-1.414 8.52 8.52 0 0 0 5.288 2.46 8.48 8.48 0 0 0 5.636-1.528 8.52 8.52 0 0 0 3.321-4.805 8.5 8.5 0 0 0-.564-5.807v-.002A8.46 8.46 0 0 0 16 4.684a8.5 8.5 0 0 0-5.825-.422A8.53 8.53 0 0 0 5.45 7.699h-.001a8.6 8.6 0 0 0-1.377 3.66l.51-.61a1 1 0 0 1 1.535 1.282l-2.18 2.61a1 1 0 0 1-1.536-.001l-2.17-2.61a1 1 0 0 1 1.537-1.28l.318.383a10.6 10.6 0 0 1 1.703-4.548v-.002A10.53 10.53 0 0 1 9.625 2.34"></path><path d="M12 8.401a1 1 0 0 1 1 1v3.55l2.535 1.606a1 1 0 0 1-1.07 1.689l-3-1.9a1 1 0 0 1-.465-.845V9.4a1 1 0 0 1 1-1"></path></g></svg>${this._formatRelativeTime(workflow.updated_at)}</div>`
      : '';

    const isPending = this._pendingWfIds?.has(workflow.wf_id) && !isRunning;
    const runningClass = isRunning ? 'running' : (isPending ? 'pending' : '');

    // Shared users avatars (nếu có)
    const sharesHtml = this._renderSharedUsersAvatars(workflow.shares || []);

    // Xác định nội dung cho nút Open/Edit
    const openText = isAdminViewing ? (window.I18n?.t('common.view') || 'Xem') : (window.I18n?.t('common.open') || 'Mở');
    
    return `
      <div class="workflow-card ${statusClass} ${runningClass} ${isEditing ? 'editing' : ''} ${crossProjectClass}" data-wf-id="${workflow.wf_id}">
        <div style="display: flex; align-items: center; flex: 1; min-width: 0;">
          ${!isAdminViewing ? `<button class="wf-toggle-btn ${isEnabled ? 'on' : ''}" title="${isEnabled ? 'Đang chọn — sẽ chạy khi bấm \'Chạy tất cả\'. Bỏ chọn không ảnh hưởng chạy lẻ.' : 'Chưa chọn — bỏ qua khi \'Chạy tất cả\' (vẫn chạy lẻ bằng nút ▶ được).'}" aria-label="chọn workflow cho Chạy tất cả"><span class="wf-toggle-track"><span class="wf-toggle-thumb"></span></span></button>` : ''}
          <div class="workflow-card-info">
            <div class="workflow-card-name-row">
              <span class="workflow-card-name">${this.escapeHtml(workflow.wf_name || workflow.name || workflow.workflow_name || (window.I18n?.t('workflow.unnamed') || 'Workflow không tên'))}</span>
            </div>
            <div class="workflow-card-meta">
              <span class="wf-status-group"><span class="wf-status-dot ${statusClass}"></span><span class="wf-status-text">${WorkflowList._renderStatusLabel(statusClass)}</span><span class="wf-meta-divider">•</span></span>
              <span class="wf-node-count">${nodeCount} node</span>
              ${isRunning ? `<span class="wf-meta-divider">•</span><span class="wf-progress-text">${progress}%</span>` : ''}
            </div>
          </div>
        </div>
        <div class="workflow-card-actions wf-modern-actions">
          ${isRunning ? `
            <button class="btn btn-secondary btn-sm edit-btn wf-btn-open" title="${window.I18n?.t('workflow.viewStatus') || 'Xem trạng thái'}">
              ${openText}
            </button>
            ${!isAdminViewing ? `
            <button class="btn btn-secondary btn-sm btn-warning stop-btn" title="${window.I18n?.t('common.stop') || 'Dừng'}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="6" y="6" width="12" height="12"></rect>
              </svg>
            </button>
            ` : ''}
          ` : `
            <button class="btn btn-secondary btn-sm edit-btn wf-btn-open" title="${openText}">
              ${openText}
            </button>
            ${!isAdminViewing ? `
            <button class="btn btn-primary btn-sm run-btn wf-btn-run" title="${window.I18n?.t('common.run') || 'Chạy'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg> Chạy
            </button>
            ` : ''}
            <div class="seosonaflow-dot-menu" data-wf-id="${workflow.wf_id}">
              <button class="btn btn-secondary btn-sm seosonaflow-dot-menu-btn wf-btn-menu" title="Menu">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="5" r="1.5"></circle>
                  <circle cx="12" cy="12" r="1.5"></circle>
                  <circle cx="12" cy="19" r="1.5"></circle>
                </svg>
              </button>
              <div class="seosonaflow-dropdown-menu hidden">
                ${!isAdminViewing ? `
                <button class="seosonaflow-dropdown-item reset-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>
                  ${window.I18n?.t('common.reset') || 'Reset'}
                </button>
                ` : ''}
                ${!isAdminViewing && window.authManager?.isLoggedIn() && !workflow._is_shared_view ? `
                <button class="seosonaflow-dropdown-item share-btn ${!window.featureGate?.canUse('workflow_share_enabled') ? 'seosonaflow-dropdown-item--locked' : ''}">
                  <span class="wf-dropdown-icon-wrap">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                    ${!window.featureGate?.canUse('workflow_share_enabled') ? `<svg class="wf-dropdown-lock-badge" width="9" height="9" viewBox="0 0 24 24" fill="var(--warning, #f59e0b)" stroke="var(--warning, #f59e0b)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none"></path></svg>` : ''}
                  </span>
                  ${window.I18n?.t('common.share') || 'Share'}
                </button>
                ` : ''}
                ${!isAdminViewing ? `
                <button class="seosonaflow-dropdown-item copy-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  ${window.I18n?.t('workflow.duplicate') || 'Duplicate'}
                </button>
                ` : ''}
                ${!isAdminViewing ? `
                <button class="seosonaflow-dropdown-item to-flows-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M6 15V9a3 3 0 0 1 3-3h6"></path><polyline points="13 3 16 6 13 9"></polyline></svg>
                  ${window.I18n?.t('workflow.addToFlows') || 'Đưa vào Flows'}
                </button>
                ` : ''}
                <button class="seosonaflow-dropdown-item export-btn ${!window.featureGate?.canUse('workflow_export') ? 'seosonaflow-dropdown-item--locked' : ''}">
                  <span class="wf-dropdown-icon-wrap">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    ${!window.featureGate?.canUse('workflow_export') ? `<svg class="wf-dropdown-lock-badge" width="9" height="9" viewBox="0 0 24 24" fill="var(--warning, #f59e0b)" stroke="var(--warning, #f59e0b)" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none"></path></svg>` : ''}
                  </span>
                  ${window.I18n?.t('common.export') || 'Export'}
                </button>
                ${!isAdminViewing ? `
                <button class="seosonaflow-dropdown-item publish-template-btn hidden">
                  <svg fill="currentColor" width="16" height="16" viewBox="0 -1.5 35 35" version="1.1" xmlns="http://www.w3.org/2000/svg"><path d="M29.426 15.535c0 0 0.649-8.743-7.361-9.74-6.865-0.701-8.955 5.679-8.955 5.679s-2.067-1.988-4.872-0.364c-2.511 1.55-2.067 4.388-2.067 4.388s-5.576 1.084-5.576 6.768c0.124 5.677 6.054 5.734 6.054 5.734h9.351v-6h-3l5-5 5 5h-3v6h8.467c0 0 5.52 0.006 6.295-5.395 0.369-5.906-5.336-7.070-5.336-7.070z"></path></svg>
                  ${window.I18n?.t('creator.publish.menuItem') || 'Xuất bản làm Template'}
                </button>
                ` : ''}
                ${!isAdminViewing ? `
                <button class="seosonaflow-dropdown-item delete-btn seosonaflow-dropdown-danger" ${!canDelete ? 'disabled' : ''}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  ${window.I18n?.t('common.delete') || 'Delete'}
                </button>
                ` : ''}
              </div>
            </div>
          `}
        </div>
        ${isRunning ? `
          <div class="workflow-card-progress">
            <div class="workflow-card-progress-bar">
              <div class="workflow-card-progress-bar-fill" style="width: ${progress}%"></div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  async _openWorkflow(wfId, cardEl) {
    console.log('[WorkflowList] _openWorkflow called:', wfId, 'already opening:', this._opening);
    if (this._opening) {
      console.log('[WorkflowList] _openWorkflow BLOCKED - already opening');
      return;
    }
    this._opening = true;

    // Show loading spinner on card
    if (cardEl) {
      cardEl.classList.add('opening');
      const actionsEl = cardEl.querySelector('.workflow-card-actions');
      if (actionsEl) {
        actionsEl.dataset.prevHtml = actionsEl.innerHTML;
        actionsEl.innerHTML = `<div class="seosonaflow-loading-spinner" style="width:18px;height:18px;"></div>`;
      }
    }

    try {
      let workflow = this.workflows.find(w => w.wf_id === wfId);
      const listWorkflow = workflow; // Keep reference to list data
      console.log('[WorkflowList] StorageManager mode:', window.storageManager?.getMode());

      // Check if this is admin viewing another user's workflow BEFORE fetching
      const currentUserId = window.authManager?.user?.id;
      const workflowOwnerId = workflow?.user_id || workflow?.user?.id;
      const isAdminViewFromList = !!(workflowOwnerId && currentUserId && workflowOwnerId !== currentUserId);
      console.log('[WorkflowList] Admin view check from list:', { workflowOwnerId, currentUserId, isAdminViewFromList });

      if (window.storageManager) {
        try {
          const freshWorkflow = await window.storageManager.getWorkflow(wfId);
          if (freshWorkflow) {
            workflow = freshWorkflow;
            console.log('[WorkflowList] Got fresh workflow from API, nodes:', workflow?.nodes?.length, '_is_admin_view:', workflow?._is_admin_view);
          }
        } catch (fetchErr) {
          console.warn('[WorkflowList] Failed to fetch workflow:', fetchErr.message);
          // Use list data as fallback
        }
      }
      console.log('[WorkflowList] Opening workflow:', workflow?.wf_name, 'nodes:', workflow?.nodes?.map(n => ({ id: n.node_id, name: n.node_name, pos_x: n.pos_x, pos_y: n.pos_y })));

      if (window.eventBus) {
        // Check admin view: explicit flag from API OR user_id mismatch
        const isAdminView = workflow?._is_admin_view || isAdminViewFromList;
        const mode = isAdminView ? 'admin_preview' : 'edit';
        console.log('[WorkflowList] Opening editor with mode:', mode, 'isAdminView:', isAdminView);
        window.eventBus.emit('workflow:open_editor', { mode, workflow });
      }
    } catch (e) {
      console.error('[WorkflowList] Failed to load workflow:', e);
    } finally {
      // Re-enable after short delay (window creation takes a moment)
      setTimeout(() => {
        console.log('[WorkflowList] _openWorkflow finally block executing for', wfId);
        this._opening = false;
        if (cardEl) {
          cardEl.classList.remove('opening');
          const actionsEl = cardEl.querySelector('.workflow-card-actions');
          console.log('[WorkflowList] Finally: actionsEl exists:', !!actionsEl, 'prevHtml exists:', !!actionsEl?.dataset.prevHtml);

          if (actionsEl?.dataset.prevHtml) {
            // Luôn restore prevHtml để có structure đúng (dropdown menu, buttons)
            actionsEl.innerHTML = actionsEl.dataset.prevHtml;
            delete actionsEl.dataset.prevHtml;

            // CRITICAL: Luôn rebind events cho dropdown menu (innerHTML replace xóa hết listeners)
            // Cần bind ngay cả khi workflow running vì khi complete sẽ show lại dropdown
            this._bindSingleCardEvents(cardEl);

            // Check nếu workflow đang running → trigger update để set đúng UI state
            const isWorkflowRunning = window.workflowExecutor?.isRunning &&
                                       window.workflowExecutor?.currentWorkflow?.wf_id === wfId;
            console.log('[WorkflowList] Finally: isWorkflowRunning:', isWorkflowRunning,
              'executor.isRunning:', window.workflowExecutor?.isRunning,
              'currentWorkflow.wf_id:', window.workflowExecutor?.currentWorkflow?.wf_id,
              'target wfId:', wfId);
            if (isWorkflowRunning) {
              this._updateCardRunningState(wfId, true);
            }
          }
        } else {
          console.log('[WorkflowList] Finally: cardEl is null/undefined');
        }
        // loadWorkflows có thể bị block do cooldown, nhưng events đã được rebind ở trên
        this.loadWorkflows();
      }, 1500);
    }
  }

  async toggleWorkflowEnabled(wfId) {
    const wf = this.workflows.find(w => w.wf_id === wfId);
    if (!wf) return;
    const prev = wf.enabled;
    wf.enabled = wf.enabled === false ? true : false;
    // Update UI immediately regardless of save result
    this.render();
    try {
      if (window.storageManager) await window.storageManager.saveWorkflow(wf);
      // [Phase 2] Phản hồi rõ khi bật/tắt.
      const msg = wf.enabled === false
        ? 'Đã bỏ chọn — sẽ KHÔNG chạy khi bấm Chạy tất cả (vẫn chạy lẻ được)'
        : 'Đã chọn — sẽ chạy khi bấm Chạy tất cả';
      try { window.showNotification?.(msg, 'info', 1800); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowList#toggleWorkflowEnabled', _); }
    } catch (e) {
      console.error('[WorkflowList] Toggle enabled failed:', e);
      // [Phase 2] Lưu lỗi → REVERT optimistic (tránh UI lệch storage) + báo lỗi.
      wf.enabled = prev;
      this.render();
      try { window.showNotification?.(window.I18n?.t('workflow.toggleFailed') || 'Không lưu được trạng thái', 'error', 2500); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowList#toggleWorkflowEnabled', _); }
    }
  }

  /**
   * Pre-flight check: Kiểm tra các provider tabs đã sẵn sàng chưa trước khi run workflow.
   * @param {Object} workflow - Workflow object với nodes
   * @returns {Promise<{ready: boolean, providers: Object}>}
   */
  async _preflightCheck(workflow) {
    const I = window.I18n;
    const nodes = workflow.nodes || [];
    // [Bug 67 fix 2026-05-24] Đồng nhất provider name với WorkflowEditor — dùng ProviderMeta
    // (server config "Google Flow"/"ChatGPT"/"Grok"/"Gemini") thay vì hardcode "Flow".
    const PM = window.ProviderMeta;
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
        // AI Agent rename (2026-05-30): schema flat top-level — `node.use_ai` + `node.provider`.
        providersUsed.add(node.provider || 'chatgpt');
      }
    }
    console.log('[WorkflowList] _preflightCheck: providers used:', [...providersUsed]);

    if (providersUsed.size === 0) {
      console.log('[WorkflowList] _preflightCheck: no providers, returning ready');
      return { ready: true, providers: {} };
    }

    // Helper: check provider status (with actual login verification)
    const checkProviderStatus = async (provider) => {
      try {
        if (provider === 'flow') {
          const resp = await new Promise(resolve => {
            chrome.runtime.sendMessage({ action: 'checkFlowTabOpen' }, r => resolve(r));
          });
          return { ready: !!resp?.isOpen, tabId: resp?.tabId };
        } else if (provider === 'chatgpt') {
          // Use ensureReady with createIfMissing=false to just check status
          // [Bug 62 fix 2026-05-24] silent: true cho checkProviderStatus — UI hiển thị status, KHÔNG cần dialog
          if (!window.ChatGPTSession?.ensureReady) return { ready: false };
          const result = await window.ChatGPTSession.ensureReady({ createIfMissing: false, activate: false, silent: true }).catch(() => ({ ready: false }));
          return { ready: result?.ready === true, tabId: result?.tabId, error: result?.error };
        } else if (provider === 'grok') {
          // [Bug 62 fix 2026-05-24] silent: true cho checkProviderStatus — UI hiển thị status, KHÔNG cần dialog
          if (!window.GrokSession?.ensureReady) return { ready: false };
          const result = await window.GrokSession.ensureReady({ createIfMissing: false, activate: false, silent: true }).catch(() => ({ ready: false }));
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
    console.log('[WorkflowList] _preflightCheck: initial status:', providerStatus);

    // Preflight selector (SelectorHealth): phát hiện Google đổi UI TRƯỚC khi submit, thay vì fail
    // giữa chừng và tốn quota. Thuần bổ sung — chỉ gắn metadata + log, KHÔNG đổi luồng chạy.
    // Phân cấp severity nằm trong SelectorHealth: chỉ 'blocking' mới đáng chặn (canRun=false).
    if (providersUsed.has('flow')) {
      try {
        const health = window.MessageBridge?.sendToContentScript
          ? await window.MessageBridge.sendToContentScript('selector:healthCheck', {}, 4000).catch(() => null)
          : null;
        if (health && health.checked > 0) {
          providerStatus.flow = { ...(providerStatus.flow || {}), selectorHealth: health };
          if (!health.ok) console.warn('[WorkflowList] selector preflight:\n' + health.summary);
        }
      } catch (_) { /* chẩn đoán không được phá luồng chạy */ }
    }

    // Check not ready providers (for activation attempt)
    const notReady = Object.entries(providerStatus).filter(([_, v]) => !v.ready);
    // [UX Improvement] Always show modal to let user confirm before running
    // (user yêu cầu giữ modal để xem provider status trước khi confirm).
    console.log('[WorkflowList] _preflightCheck: not ready providers:', notReady.map(([p]) => p));

    // Try to activate tabs for not-ready providers (fire-and-forget)
    console.log('[WorkflowList] _preflightCheck: activating providers:', notReady.map(([p]) => p));
    for (const [provider] of notReady) {
      if (provider === 'flow') {
        // Flow: try to activate existing tab or open new one
        chrome.runtime.sendMessage({ action: 'ensureFlowTabActive' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowList#checkProviderStatus', _e); });
      } else if (provider === 'chatgpt' && window.ChatGPTSession?.ensureReady) {
        window.ChatGPTSession.ensureReady().catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowList#checkProviderStatus', _e); });
      } else if (provider === 'grok' && window.GrokSession?.ensureReady) {
        window.GrokSession.ensureReady().catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowList#checkProviderStatus', _e); });
      }
    }

    // Show modal with real-time status polling (same as WorkflowEditor)
    console.log('[WorkflowList] _preflightCheck: showing provider status modal');
    // Phase 5 (Manual Submit): switch Auto/Manual CHỈ khi có node generate Flow (submit thật, không
    // phải image node upload ref). Init theo setting manualSubmitMode.
    const hasFlow = nodes.some(n => n.enabled !== false && (n.node_type || n.class) === 'generate');
    let _submitModeManual = hasFlow && !!window.storageSettings?.getSettings?.().manualSubmitMode;
    const _t = (k, fb) => (I?.t?.(k) || fb);
    const submitModeHtml = hasFlow ? `
            <div class="confirm-run-submitmode-row" id="wfListPreflightSubmitModeRow" style="margin-top:12px; display:flex; flex-direction:column; gap:6px;">
              <span class="confirm-run-submitmode-title" style="font-size:11px; font-weight:600; color:var(--muted-foreground,#8b8b92);">${_t('dialog.runSubmitModeLabel', 'Chế độ submit')}</span>
              <div class="confirm-submitmode-switch" id="wfListPreflightSubmitModeSwitch" role="tablist">
                <button type="button" class="confirm-submitmode-btn" data-value="auto" role="tab" data-tooltip="${_t('dialog.runSubmitModeAutoTooltip', 'SEOSONA Flow tự động nhấn submit sau khi điền prompt + ref (nhanh, nhưng Flow dễ nhận diện hành vi tự động khi chạy liên tục).')}" data-tooltip-placement="top" data-tooltip-align="auto">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  <span>${_t('dialog.runSubmitModeAuto', 'Tự động submit')}</span>
                </button>
                <button type="button" class="confirm-submitmode-btn" data-value="manual" role="tab" data-tooltip="${_t('dialog.runSubmitModeManualTooltip', 'SEOSONA Flow điền prompt + ảnh, bạn tự Enter/Click Submit cho từng prompt. Thao tác giúp hạn chế Google Flow cảnh báo lỗi hành vi bất thường.')}" data-tooltip-placement="top" data-tooltip-align="auto">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11V6a2 2 0 0 1 4 0v5"/><path d="M13 7a2 2 0 0 1 4 0v6"/><path d="M17 9a2 2 0 0 1 4 0v5a7 7 0 0 1-7 7h-2a7 7 0 0 1-6.3-3.9L3 17a2 2 0 0 1 3.4-2l1.6 2"/></svg>
                  <span>${_t('dialog.runSubmitModeManual', 'Tự nhấn Enter')}</span>
                </button>
              </div>
              <span class="confirm-run-submitmode-hint" id="wfListPreflightSubmitModeHint"></span>
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
            <div class="confirm-run-provider-status" id="wfListPreflightStatus"></div>${submitModeHtml}
          </div>
          <div class="confirm-run-footer">
            <button class="btn btn-secondary" id="wfListPreflightCancel">${I?.t('common.cancel') || 'Hủy'}</button>
            <button class="btn btn-primary" id="wfListPreflightRun">${I?.t('workflow.preflightContinue') || 'Chạy'}</button>
          </div>
        </div>
      `;
      // Append to sidebar container or document body
      const container = this.container?.closest('.seosonaflow-sidebar') || document.body;
      container.appendChild(overlay);
      setTimeout(() => overlay.classList.add('visible'), 10);

      // Wire submit mode switch (chỉ khi có Flow). Auto-persist manualSubmitMode khi user click.
      if (hasFlow) {
        const smSwitch = overlay.querySelector('#wfListPreflightSubmitModeSwitch');
        const smHint = overlay.querySelector('#wfListPreflightSubmitModeHint');
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
            try { window.storageSettings?.set?.('manualSubmitMode', _submitModeManual); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowList#onclick', _); }
          };
        });
        applyMode(_submitModeManual ? 'manual' : 'auto'); // init — KHÔNG persist
      }

      const statusEl = overlay.querySelector('#wfListPreflightStatus');
      // Port 1.1.49: delegated click — badge provider chưa-ready → mở/activate tab provider.
      // Delegation trên statusEl (parent) sống qua re-render innerHTML mỗi lần poll.
      statusEl.addEventListener('click', (e) => {
        const link = e.target.closest('.badge-open-link[data-open-provider]');
        if (!link) return;
        e.preventDefault();
        e.stopPropagation();
        const provider = link.dataset.openProvider;
        if (provider) {
          try { chrome.runtime.sendMessage({ action: 'openProviderTab', provider }, () => { void chrome.runtime.lastError; }); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowList#onclick', _); }
        }
      });
      let pollTimer = null;
      let allReady = false;

      const renderStatus = () => {
        let html = '';
        // [Bug 66 fix 2026-05-24] Trước: chỉ 2 states (Ready/Checking) → khi NOT_LOGGED_IN kẹt "Checking".
        // Sau: phân biệt ready / not_logged_in / cloudflare / no_tab / initial checking (chưa response).
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
            // Has response, not ready — show specific error reason
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
          // st undefined → keep initial Checking (chưa response từ background)
          // Port 1.1.49: logo brand provider + link "mở tab" clickable khi chưa ready.
          const _logo = window.ProviderBrandIcons?.get?.(provider) || '';
          const _logoHtml = _logo ? `<span class="badge-provider-logo" style="display:inline-flex;width:13px;height:13px;vertical-align:-2px;margin-right:3px;">${_logo}</span>` : '';
          const _isNotReady = !!(st && st.ready === false);
          const _statusHtml = _isNotReady
            ? `<span class="badge-open-link" data-open-provider="${provider}" style="cursor:pointer;text-decoration:underline;" title="${_t('workflow.openProviderTab', 'Mở tab provider')}">${statusText} ↗</span>`
            : statusText;
          html += `<div class="confirm-run-provider-badge ${badgeClass}">
            <span class="badge-provider">${iconSvg} ${_logoHtml}${label}</span>
            <span class="badge-status">${_statusHtml}</span>
          </div>`;
        }
        statusEl.innerHTML = html;

        // Check if all ready now
        allReady = [...providersUsed].every(p => providerStatus[p]?.ready);

        // Update button text based on ready state
        const runBtn = overlay.querySelector('#wfListPreflightRun');
        if (runBtn) {
          runBtn.textContent = allReady
            ? (I?.t('common.run') || 'Run')
            : (I?.t('workflow.runAnyway') || 'Run Anyway');
        }
      };

      // K.8: idempotent guard chặn double-click race (same fix WorkflowEditor).
      let done = false;

      const pollStatus = async () => {
        for (const provider of providersUsed) {
          if (!providerStatus[provider]?.ready) {
            providerStatus[provider] = await checkProviderStatus(provider);
          }
        }
        renderStatus();

        if (allReady && pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
          // Phase 5: KHÔNG auto-resolve khi có Flow — giữ modal để user chọn submit mode + bấm Run.
          // (Không Flow → giữ auto-resolve cũ để nhanh.)
          if (!done && !hasFlow) {
            done = true;
            cleanup();
            resolve({ ready: true, providers: providerStatus, manualSubmitMode: false });
          }
        }
      };

      renderStatus();
      pollTimer = setInterval(pollStatus, 2000);

      const cleanup = () => {
        if (pollTimer) clearInterval(pollTimer);
        overlay.classList.remove('visible');
        overlay.style.display = 'none';
        setTimeout(() => overlay.remove(), 200);
      };

      overlay.querySelector('#wfListPreflightCancel').addEventListener('click', () => {
        if (done) return;
        done = true;
        console.log('[WorkflowList] _preflightCheck: user cancelled');
        cleanup();
        resolve({ ready: false, providers: providerStatus, skipped: true, manualSubmitMode: false });
      });

      overlay.querySelector('#wfListPreflightRun').addEventListener('click', (e) => {
        if (done) return;
        done = true;
        e.currentTarget.disabled = true;
        e.currentTarget.style.opacity = '0.5';
        console.log('[WorkflowList] _preflightCheck: user clicked Run');
        cleanup();
        resolve({ ready: true, providers: providerStatus, manualSubmitMode: hasFlow ? _submitModeManual : false });
      });
    });
  }

  /**
   * [Cost-gate] Ước lượng + báo trước số lần sinh / thời gian trước khi chạy (học super-video-maker).
   * Non-blocking (chỉ notification info/warning), guarded no-op nếu CostEstimator chưa load.
   */
  _showRunCostPreview(workflow) {
    const CE = window.CostEstimator || (typeof self !== 'undefined' && self.CostEstimator);
    if (!CE || !CE.estimate || !CE.planFromNodes) return;
    const est = CE.estimate(CE.planFromNodes(workflow.nodes));
    if (!est || est.totalGenerations <= 0) return;
    const heavy = (est.notes || []).some((x) => /NẶNG/.test(x));
    const msg = CE.format ? CE.format(est) : `Sắp sinh ${est.totalGenerations} ảnh/clip (~${est.estMinutes} phút)`;
    try { window.showNotification?.(msg, heavy ? 'warning' : 'info', heavy ? 4000 : 2500); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowList#_showRunCostPreview', _); }
  }

  async runWorkflow(wfId) {
    // [API SPAM FIX — Phase 6] Track wfId sớm để skip loadWorkflows trong khi chạy
    this._lastUpdatedWfId = wfId;

    // [Phase 1] Optimistic: hiện "đang chuẩn bị" NGAY (trước preflight async) → phản hồi tức thì.
    // Safety: nếu 12s sau vẫn chưa thực sự chạy (user huỷ preflight / gate chặn) → tự gỡ.
    try {
      this._setCardPreparing(wfId, true);
      this._preparingTimers = this._preparingTimers || {};
      clearTimeout(this._preparingTimers[wfId]);
      this._preparingTimers[wfId] = setTimeout(() => {
        const running = window.workflowExecutor?.currentWorkflow?.wf_id === wfId && window.workflowExecutor?.isRunning;
        if (!running) this._setCardPreparing(wfId, false);
      }, 12000);
    } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowList#runWorkflow', _); }

    // Load workflow đầy đủ với nodes/edges (this.workflows chỉ có metadata, không có nodes)
    // Cần nodes để lấy telegram_chat_id và các field khác
    const workflow = await window.storageManager?.getWorkflow(wfId);
    if (!workflow) return;

    // Gate project: chỉ chạy khi Flow đang ở ĐÚNG project của workflow (đồng bộ MCP run_workflow).
    // Tránh chạy nhầm project khác / project đã xoá → báo user tự mở đúng project.
    try {
      const gate = await window.ProjectHelper?.checkWorkflowProjectGate?.(workflow);
      if (gate && !gate.ok) {
        const where = gate.expectedName
          ? `"${gate.expectedName}"`
          : (window.I18n?.t('workflow.thisProject') || 'project của workflow');
        const msg = gate.code === 'WRONG_PROJECT'
          ? (window.I18n?.t('workflow.runWrongProject', { project: where })
             || `Workflow thuộc ${where}. Hãy mở đúng project đó trong Google Flow rồi chạy lại.`)
          : (window.I18n?.t('workflow.runProjectNotReady')
             || 'Project của workflow đang lỗi hoặc đã xoá. Hãy mở/chọn lại project hợp lệ rồi thử lại.');
        await window.customDialog?.alert(msg, {
          title: window.I18n?.t('workflow.wrongProjectTitle') || 'Sai project',
          type: 'warning',
        });
        return;
      }
    } catch (e) {
      console.warn('[WorkflowList] checkWorkflowProjectGate failed, fail-open:', e?.message);
    }

    // [Cost-gate] Xem trước chi phí gen (non-blocking info) — CostEstimator, guarded no-op nếu chưa load.
    try { this._showRunCostPreview(workflow); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowList#runWorkflow', _); }

    // Debug: log nodes enabled status
    console.log('[WorkflowList] runWorkflow nodes enabled status:', workflow.nodes?.map(n => ({
      node_id: n.node_id,
      node_name: n.node_name,
      node_type: n.node_type,
      enabled: n.enabled
    })));

    // Pre-flight check: kiểm tra provider tabs sẵn sàng
    const preflight = await this._preflightCheck(workflow);
    if (!preflight.ready) {
      console.log('[WorkflowList] runWorkflow aborted - preflight check failed or user cancelled');
      return;
    }

    // Phase 5: truyền manualSubmitMode qua event → WorkflowTab.runWorkflow nhận + truyền opts vào execute
    // (KHÔNG pre-set instance var ở đây → tránh leak nếu WorkflowTab bail trước execute vì quota/isRunning).
    if (window.eventBus) {
      window.eventBus.emit('workflow:run', { workflow, manualSubmitMode: preflight.manualSubmitMode === true });
    }
  }

  async runAllWorkflows() {
    if (this.workflows.length === 0) return;

    // Check run limit for workflow (applies to both anonymous and logged-in users)
    if (window.featureGate) {
      const quota = await window.featureGate.checkQuotaAsync('workflows_run_max');
      if (!quota.allowed) {
        const isLoggedIn = window.authManager?.isLoggedIn();
        if (isLoggedIn) {
          const limitText = quota.limit === 'unlimited' ? (window.I18n?.t('common.unlimited') || 'Không giới hạn') : `${quota.limit} ${window.I18n?.t('workflow.runsPerDay') || 'lượt/ngày'}`;
          const shouldUpgrade = await window.customDialog?.confirm(
            window.I18n?.t('workflow.runQuotaExhausted', { limitText, used: quota.used }) || `Đã hết lượt sử dụng Workflow hôm nay.\n\nGiới hạn: ${limitText}\nĐã dùng: ${quota.used} lượt\n\nNâng cấp gói để tăng giới hạn.`,
            { title: window.I18n?.t('workflow.runQuotaTitle') || 'Workflow runs exhausted', confirmText: window.I18n?.t('common.upgrade') || 'Upgrade', cancelText: window.I18n?.t('common.later') || 'Later' }
          );
          /* upgrade modal removed — local-first; confirm is now informational only */
          void shouldUpgrade;
        } else {
          window.featureGate.showLoginPrompt(window.I18n?.t('workflow.trialRunExhausted') || 'Bạn đã sử dụng hết lượt chạy workflow trong bản dùng thử.');
        }
        return;
      }
    }

    // Y-4: Filter: enabled + not completed + current project only
    const runnableWorkflows = this.workflows.filter(wf =>
      wf.enabled !== false &&
      wf.status !== 'completed' &&
      (!window.ProjectHelper || window.ProjectHelper.isCurrentProject(wf))
    );
    const disabledCount = this.workflows.filter(wf => wf.enabled === false).length;
    const doneCount = this.workflows.filter(wf => wf.enabled !== false && wf.status === 'completed').length;

    if (runnableWorkflows.length === 0) {
      await window.customDialog.alert(
        window.I18n?.t('workflow.noRunnableWorkflows') || 'Không có workflow nào để chạy. Kiểm tra lại trạng thái bật/tắt và đã hoàn thành.',
        { title: window.I18n?.t('workflow.noRunnableTitle') || 'Không có workflow để chạy' }
      );
      return;
    }

    let message = window.I18n?.t('workflow.runAllConfirm', { count: runnableWorkflows.length }) || `Chạy tuần tự ${runnableWorkflows.length} workflows?`;
    const notes = [];
    if (disabledCount > 0) notes.push(window.I18n?.t('workflow.disabledSkipped', { count: disabledCount }) || `${disabledCount} workflow đang tắt sẽ bị bỏ qua`);
    if (doneCount > 0) notes.push(window.I18n?.t('workflow.completedSkipped', { count: doneCount }) || `${doneCount} workflow đã hoàn thành sẽ bị bỏ qua. Cần reset trước nếu muốn chạy lại`);
    if (notes.length > 0) message += '\n\n' + notes.join('. ') + '.';

    const ok = await window.customDialog.confirm(message, { title: window.I18n?.t('workflow.runAll') || 'Chạy tất cả' });
    if (!ok) return;

    // Set flag to record trial run AFTER workflow completes successfully
    if (window.featureGate) {
      window.featureGate.setPendingWorkflowRun();
    }

    // Set running state + update button to Stop
    this.shouldStopAll = false;
    this._setRunAllButtonRunning();
    this._showBatchProgress(runnableWorkflows.length);

    // Mark all runnable workflows as pending (yellow border, dimmed)
    this._pendingWfIds = new Set(runnableWorkflows.map(w => w.wf_id));
    this.render();

    let current = 0;
    for (const workflow of runnableWorkflows) {
      if (this.shouldStopAll || window.workflowExecutor?.shouldStop) break;

      current++;
      // Remove from pending as it starts running (workflow executor sets status='running')
      this._pendingWfIds.delete(workflow.wf_id);
      this._updateBatchProgress(current, runnableWorkflows.length);

      try {
        if (window.workflowExecutor) {
          await window.workflowExecutor.execute(workflow.wf_id);
        }
      } catch (error) {
        console.error('[WorkflowList] Run all - workflow failed:', workflow.wf_id, error);
      }
    }

    // Reset button and hide progress bar
    this._resetRunAllButton();
  }

  async stopWorkflow(wfId) {
    console.log('[WorkflowList] stopWorkflow called:', wfId, 'isRunning:', window.workflowExecutor?.isRunning);

    // Track stopped workflow để force status='pending' khi re-render
    // Persist to storage để survive page refresh
    this._stoppedWfIds.add(wfId);
    console.log('[WorkflowList] Added to _stoppedWfIds:', wfId, 'set size:', this._stoppedWfIds.size);
    try {
      chrome.storage.local.set({ af_stopped_wfids: [...this._stoppedWfIds] });
    } catch (e) { /* ignore */ }
    // Clear sau 30s (đủ để server sync + user thấy)
    setTimeout(() => {
      this._stoppedWfIds.delete(wfId);
      console.log('[WorkflowList] Removed from _stoppedWfIds:', wfId);
      try {
        chrome.storage.local.set({ af_stopped_wfids: [...this._stoppedWfIds] });
      } catch (e) { /* ignore */ }
    }, 30000);

    // Update UI ngay lập tức
    this._updateCardRunningState(wfId, false, 'pending');

    if (window.workflowExecutor?.isRunning) {
      // Local executor đang chạy → stop trực tiếp
      console.log('[WorkflowList] Stopping local executor');
      window.workflowExecutor.stop();

      // Force timeout: nếu sau 3s vẫn running → force kill
      setTimeout(() => {
        if (window.workflowExecutor?.isRunning) {
          console.warn('[WorkflowList] Force stopping stuck workflow');
          window.workflowExecutor.shouldStop = true;
          window.workflowExecutor.isRunning = false;
          window.MessageBridge?.stopExecution?.().catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowList#stopWorkflow', _e); });
          if (window.ExecutionLock) ExecutionLock.forceRelease();
          this.loadWorkflows();
        }
      }, 3000);
    } else {
      // Local executor không chạy → có thể workflow đang chạy ở context khác (popup)
      // Hoặc workflow có status='running' stale từ lần chạy trước (crash/extension reload)
      console.log('[WorkflowList] Broadcasting stop to other contexts');
      try {
        chrome.runtime.sendMessage({
          action: 'workflowExecutionEvent',
          event: 'execution:stop',
          data: { wf_id: wfId }
        });
      } catch (e) {
        console.warn('[WorkflowList] Broadcast stop failed:', e.message);
      }
      // Also try MessageBridge stopExecution
      window.MessageBridge?.stopExecution?.().catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowList#_setRunAllButtonRunning', _e); });

      // FIX: Update server status về 'pending' cho workflow không chạy locally
      // Handles case: server có status='running' stale từ crash/extension reload
      if (window.storageManager) {
        console.log('[WorkflowList] Updating stale workflow status to pending:', wfId);
        window.storageManager.saveWorkflow({
          wf_id: wfId,
          status: 'pending',
          updated_at: new Date().toISOString()
        }).catch(e => console.warn('[WorkflowList] Failed to update workflow status:', e.message));
      }
    }
  }

  // ─── Run All Button State Methods ────────────────────────

  _setRunAllButtonRunning() {
    const btn = this.container.querySelector('#runAllWorkflowsBtn');
    if (!btn) return;
    this.isRunningAll = true;
    btn.classList.add('btn-stop');
    btn.title = window.I18n?.t('workflow.stopAll') || 'Dừng tất cả';
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="6" width="12" height="12"></rect>
      </svg>
      <span>${window.I18n?.t('workflow.stop') || 'Dừng'}</span>
    `;
  }

  _resetRunAllButton() {
    const btn = this.container.querySelector('#runAllWorkflowsBtn');
    if (!btn) return;
    this.isRunningAll = false;
    this.shouldStopAll = false;
    this._pendingWfIds.clear();
    btn.classList.remove('btn-stop');
    btn.disabled = false;
    btn.title = window.I18n?.t('workflow.runAll') || 'Chạy tất cả';
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      <span>${window.I18n?.t('workflow.runAll') || 'Chạy tất cả'}</span>
    `;
    // Hide progress bar
    this._hideBatchProgress();
  }

  stopAllWorkflows() {
    this.shouldStopAll = true;
    this._pendingWfIds.clear();
    // Stop current workflow execution
    if (window.workflowExecutor?.isRunning) {
      window.workflowExecutor.stop();
    }
    // Update button to "Stopping..."
    const btn = this.container.querySelector('#runAllWorkflowsBtn');
    if (btn) {
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="6" y="6" width="12" height="12"></rect>
        </svg>
        <span>${window.I18n?.t('workflow.stopping') || 'Stopping...'}</span>
      `;
      btn.disabled = true;
    }
  }

  // ─── Progress Bar Methods ────────────────────────────────

  _showBatchProgress(total) {
    const progressEl = this.container.querySelector('#wfBatchProgress');
    if (!progressEl) return;
    progressEl.classList.remove('hidden');
    this._batchTotal = total;
    this._batchCurrent = 0;
    this._updateBatchProgress(0, total);
  }

  _updateBatchProgress(current, total) {
    const labelEl = this.container.querySelector('#wfBatchProgressLabel');
    const countEl = this.container.querySelector('#wfBatchProgressCount');
    const fillEl = this.container.querySelector('#wfBatchProgressFill');

    if (labelEl) {
      labelEl.textContent = window.I18n?.t('workflow.runningWorkflows') || 'Running workflows...';
    }
    if (countEl) {
      countEl.textContent = `${current}/${total}`;
    }
    if (fillEl) {
      const percent = total > 0 ? (current / total) * 100 : 0;
      fillEl.style.width = `${percent}%`;
    }
  }

  _hideBatchProgress() {
    const progressEl = this.container.querySelector('#wfBatchProgress');
    if (progressEl) {
      progressEl.classList.add('hidden');
    }
  }

  _closeAllDropdowns(container) {
    // Dropdown đã PORTAL ra document.body khi mở → phải tìm toàn document (không chỉ trong container).
    document.querySelectorAll('.seosonaflow-dropdown-menu').forEach(d => {
      d.classList.add('hidden');
      // Trả dropdown về đúng chỗ trong card (để re-render/handler item không lạc).
      if (d._sfOriginParent) {
        try {
          if (d._sfOriginNext && d._sfOriginNext.parentElement === d._sfOriginParent) {
            d._sfOriginParent.insertBefore(d, d._sfOriginNext);
          } else {
            d._sfOriginParent.appendChild(d);
          }
        } catch (_) { /* card đã bị gỡ khi re-render — bỏ qua */ }
        d._sfOriginParent = null; d._sfOriginNext = null;
      }
    });
    container?.querySelectorAll('.workflow-card.wf-menu-open').forEach(c => c.classList.remove('wf-menu-open'));
  }

  _positionDropdown(triggerEl, dropdown) {
    // PORTAL: chuyển dropdown ra thẳng <body> khi mở → tách khỏi MỌI CSS của card
    // (opacity:0 lúc không hover, transform hover, overflow:hidden). body không có transform nên
    // position:fixed neo đúng viewport. Trả về card cũ khi đóng (_closeAllDropdowns).
    const rect = triggerEl.getBoundingClientRect();  // đo TRƯỚC khi dời (toạ độ viewport, ổn định)
    const _card = triggerEl.closest('.workflow-card');
    if (_card) _card.classList.add('wf-menu-open');
    if (dropdown.parentElement !== document.body) {
      dropdown._sfOriginParent = dropdown.parentElement;
      dropdown._sfOriginNext = dropdown.nextSibling;
      document.body.appendChild(dropdown);
    }
    dropdown.style.opacity = '1';  // chống mọi opacity kế thừa còn sót
    const dropdownHeight = dropdown.offsetHeight || 150;
    const dropdownWidth = dropdown.offsetWidth || 140;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    // Horizontal: right-align with trigger, but ensure it fits in viewport
    const rightEdge = viewportWidth - rect.right;
    if (rect.right - dropdownWidth < 4) {
      // Not enough space on left, align to left edge
      dropdown.style.left = '4px';
      dropdown.style.right = 'auto';
    } else {
      dropdown.style.right = Math.max(4, rightEdge) + 'px';
      dropdown.style.left = 'auto';
    }

    // Vertical: prefer upward; if not enough space, open downward
    if (rect.top > dropdownHeight + 8) {
      dropdown.style.bottom = (viewportHeight - rect.top + 4) + 'px';
      dropdown.style.top = 'auto';
    } else {
      dropdown.style.top = (rect.bottom + 4) + 'px';
      dropdown.style.bottom = 'auto';
    }
  }

  async cloneWorkflow(wfId) {
    // Lock để tránh duplicate click
    if (this._isCloningWorkflow) {
      console.log('[WorkflowList] Clone already in progress, ignoring duplicate click');
      return;
    }

    try {
      this._isCloningWorkflow = true;

      if (!window.storageManager) return;

      // Check quota (async để đảm bảo data mới nhất từ server theo user plan)
      if (window.featureGate) {
        const canCreate = await window.featureGate.canCreateWorkflowAsync();
        if (!canCreate) {
          const isLoggedIn = window.authManager?.isLoggedIn();
          if (!isLoggedIn) {
            window.featureGate.showLoginPrompt(
              window.I18n?.t('workflow.requireLoginToClone') || 'Nhân bản workflow yêu cầu đăng nhập'
            );
          } else {
            const quota = window.featureGate.checkQuota('workflows_max');
            const shouldUpgrade = await window.customDialog?.confirm(
              window.I18n?.t('workflow.cloneQuotaExhausted', { limit: quota.limit, used: quota.used }) || `Gói của bạn giới hạn tối đa ${quota.limit} workflow. Bạn đã có ${quota.used} workflow. Nâng cấp Premium để nhân bản không giới hạn.`,
              { title: window.I18n?.t('workflow.quotaReached') || 'Limit reached', type: 'warning', confirmText: window.I18n?.t('common.upgrade') || 'Upgrade', cancelText: window.I18n?.t('common.later') || 'Later' }
            );
            /* upgrade modal removed — local-first; confirm is now informational only */
            void shouldUpgrade;
          }
          return;
        }
      }

      // Fix B: chặn clone khi chưa có Flow project sẵn sàng (chưa mở Flow / homepage / project lỗi)
      // → tránh tạo workflow "chết" không chạy được. Hiện modal hướng dẫn mở Flow + tạo project.
      if (window.ProjectHelper && !(await window.ProjectHelper.ensureProjectOrGuide())) {
        return;
      }

      window.showNotification?.(window.I18n?.t('workflow.duplicating') || 'Duplicating workflow...', 'success', 1500);

      const workflow = await window.storageManager.getWorkflow(wfId);
      if (!workflow) return;

      // Y-5: Cross-project safe clone
      const isCurrent = window.ProjectHelper?.isCurrentProject(workflow) !== false;

      if (!isCurrent && window.ProjectHelper) {
        const confirmed = await window.ProjectHelper.showCloneConfirmation('workflow');
        if (!confirmed) return;

        // Use ProjectHelper for cross-project clone (resets media)
        const result = window.ProjectHelper.cloneWorkflowCrossProject(workflow, workflow.nodes || [], workflow.edges || []);
        result.workflow.sort_order = this.workflows.length || 0;
        // Uniquify wf_name vs current project workflows (page hiện tại — limitation paginated)
        result.workflow.wf_name = window.ProjectHelper.uniquifyName(
          result.workflow.wf_name,
          this.workflows.map(w => w.wf_name)
        );
        await window.storageManager.saveWorkflowFull(result.workflow, result.nodes, result.edges);
      } else {
        // Same project clone — existing logic
        // UUID + timestamp tránh collision khi clone+create cùng millisecond.
        const newWfId = window.IdGenerator ? window.IdGenerator.next('wf') : `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const nodeIdMap = {};

        // Clone nodes with new IDs.
        // Reset toàn bộ result/runtime fields — kết quả thuộc workflow gốc, clone phải start fresh.
        // Status 'pending' đồng nhất với DiagramCanvas.exportWorkflow default.
        const newNodes = (workflow.nodes || []).map((node, i) => {
          const newNodeId = window.IdGenerator ? window.IdGenerator.next('node') : `node_${Date.now()}_${i}`;
          nodeIdMap[node.node_id] = newNodeId;
          return {
            ...node,
            node_id: newNodeId,
            wf_id: newWfId,
            status: 'pending',
            result_file_ids: '',
            result_thumbnails: {},
            result_file_names: {},
            result_provider_urls: {},
            result_text: '',
            result_source: null,
            error_message: '',
            executed_at: null
          };
        });

        // Remap frame source node IDs sang new node IDs
        for (const cloned of newNodes) {
          if (cloned.frame_1_source && cloned.frame_1_source !== 'manual' && cloned.frame_1_source !== '') {
            cloned.frame_1_source = nodeIdMap[cloned.frame_1_source] || cloned.frame_1_source;
          }
          if (cloned.frame_2_source && cloned.frame_2_source !== 'manual' && cloned.frame_2_source !== '') {
            cloned.frame_2_source = nodeIdMap[cloned.frame_2_source] || cloned.frame_2_source;
          }
        }

        // Clone edges with remapped node IDs
        const newEdges = (workflow.edges || []).map(edge => ({
          ...edge,
          edge_id: window.IdGenerator ? window.IdGenerator.next('edge') : `edge_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          wf_id: newWfId,
          source_node_id: nodeIdMap[edge.source_node_id] || edge.source_node_id,
          target_node_id: nodeIdMap[edge.target_node_id] || edge.target_node_id
        }));

        // Uniquify vs current page workflows (limitation: paginated — không catch trùng cross-page)
        const baseName = (workflow.wf_name || 'Workflow') + ' ' + (window.I18n?.t('project.copySuffix') || '(copy)');
        const uniqueName = window.ProjectHelper?.uniquifyName(baseName, this.workflows.map(w => w.wf_name)) || baseName;
        const newWorkflow = {
          ...workflow,
          wf_id: newWfId,
          wf_name: uniqueName,
          status: 'idle',
          progress_completed: 0,
          progress_total: 0,
          current_node_id: null,
          sort_order: (this.workflows.length || 0)
        };
        delete newWorkflow.nodes;
        delete newWorkflow.edges;

        await window.storageManager.saveWorkflowFull(newWorkflow, newNodes, newEdges);
      }
      // Record usage for anonymous users (server không track)
      if (window.featureGate && !window.authManager?.isLoggedIn()) {
        await window.featureGate.recordWorkflowCreated();
      }
      // Refresh featureGate to update workflow count
      if (window.featureGate) {
        window.featureGate.refresh({ force: true }).catch(e => console.warn('[WorkflowList] FeatureGate refresh failed:', e));
      }
      await this.loadWorkflows();
      window.showNotification?.(window.I18n?.t('workflow.duplicateSuccess') || 'Workflow đã nhân bản', 'success');
    } catch (e) {
      console.error('[WorkflowList] Clone failed:', e);

      // Check if it's a quota error - ApiStorage already shows modal, just log
      if (e.code === 'QUOTA_EXCEEDED' || e.message?.includes('giới hạn')) {
        // Quota error modal already shown by ApiStorage._handleQuotaError
        return;
      }

      // REQUIRES_LOGIN error - show login prompt (defensive, normally caught by canCreateWorkflowAsync)
      if (e.message === 'REQUIRES_LOGIN') {
        window.featureGate?.showLoginPrompt(
          window.I18n?.t('workflow.requireLoginToClone') || 'Nhân bản workflow yêu cầu đăng nhập'
        );
        return;
      }

      window.customDialog?.alert((window.I18n?.t('workflow.duplicateFailed') || 'Không thể nhân bản workflow') + ': ' + e.message, { type: 'error' });
    } finally {
      this._isCloningWorkflow = false;
    }
  }

  /**
   * [Phase 3 — copy-isolation] Deep-copy 1 workflow thành RECORD MỚI (wf_id/node_id/edge_id mới,
   * reset runtime), gắn thêm meta (vd flow_kind='flow'/'space', source_wf_id). Bản copy ĐỘC LẬP →
   * sửa/xóa/chạy KHÔNG ảnh hưởng bản gốc (cốt lõi My Spaces↔Flows). Trả về wf_id mới (null nếu lỗi).
   * Dùng lại pattern deep-copy của cloneWorkflow (đã audit: fresh id + remap frame/edge + reset result),
   * nhưng KHÔNG gate quota/project (copy nội bộ) và trả wf_id để caller tag/điều hướng.
   */
  async copyWorkflowRecord(wfId, extraMeta = {}) {
    try {
      const sm = window.storageManager;
      if (!sm?.getWorkflow || !sm?.saveWorkflowFull) return null;
      const src = await sm.getWorkflow(wfId);
      if (!src) return null;
      const newWfId = window.IdGenerator ? window.IdGenerator.next('wf') : `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const nodeIdMap = {};
      const newNodes = (src.nodes || []).map((node, i) => {
        const nid = window.IdGenerator ? window.IdGenerator.next('node') : `node_${Date.now()}_${i}`;
        nodeIdMap[node.node_id] = nid;
        return {
          ...node, node_id: nid, wf_id: newWfId, status: 'pending',
          result_file_ids: '', result_thumbnails: {}, result_file_names: {}, result_provider_urls: {},
          result_text: '', result_source: null, error_message: '', executed_at: null
        };
      });
      for (const c of newNodes) {
        if (c.frame_1_source && c.frame_1_source !== 'manual' && c.frame_1_source !== '') c.frame_1_source = nodeIdMap[c.frame_1_source] || c.frame_1_source;
        if (c.frame_2_source && c.frame_2_source !== 'manual' && c.frame_2_source !== '') c.frame_2_source = nodeIdMap[c.frame_2_source] || c.frame_2_source;
      }
      const newEdges = (src.edges || []).map((edge) => ({
        ...edge,
        edge_id: window.IdGenerator ? window.IdGenerator.next('edge') : `edge_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        wf_id: newWfId,
        source_node_id: nodeIdMap[edge.source_node_id] || edge.source_node_id,
        target_node_id: nodeIdMap[edge.target_node_id] || edge.target_node_id
      }));
      const meta = {
        ...src, wf_id: newWfId, status: 'idle', progress_completed: 0, progress_total: 0, current_node_id: null,
        ...extraMeta
      };
      delete meta.nodes; delete meta.edges;
      await sm.saveWorkflowFull(meta, newNodes, newEdges);
      return newWfId;
    } catch (e) { console.warn('[WorkflowList] copyWorkflowRecord fail:', e?.message); return null; }
  }

  /**
   * [Phase 3] "Đưa vào Flows" từ My Spaces — tạo BẢN COPY độc lập trong Flows (flow_kind='flow',
   * source_wf_id=gốc). Dedup: nếu đã có copy cho gốc này thì không tạo trùng, chỉ chuyển tab. Bản gốc
   * ở My Spaces giữ nguyên; mọi sửa/xóa/chạy bản Flows sau này không đụng gốc.
   */
  async _addToFlows(wfId) {
    try {
      if (!wfId) return;
      const existing = this.workflows.find(w => w.flow_kind === 'flow' && w.source_wf_id === wfId);
      if (existing) {
        window.showNotification?.(window.I18n?.t('workflow.alreadyInFlows') || 'Đã có trong Flows', 'info', 2000);
      } else {
        const newId = await this.copyWorkflowRecord(wfId, { flow_kind: 'flow', source_wf_id: wfId });
        if (!newId) {
          window.showNotification?.(window.I18n?.t('workflow.addToFlowsFailed') || 'Không thể đưa vào Flows', 'error', 2500);
          return;
        }
        window.showNotification?.(window.I18n?.t('workflow.addedToFlows') || 'Đã đưa vào Flows', 'success', 2000);
        await this.loadWorkflows();
      }
      // Chuyển sang tab Flows để user thấy bản vừa đưa vào.
      try { window.eventBus?.emit('workflow:subtab_changed', { subtab: 'mytemplates' }); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowList#_addToFlows', _); }
    } catch (e) { console.warn('[WorkflowList] _addToFlows fail:', e?.message); }
  }

  // Render project filter as inline select in toolbar
  async _renderProjectFilter() {
    const select = this.container.querySelector('#wfProjectSelectInline');
    if (!select) return;

    // Get unique project IDs from workflows
    const projectIds = new Set();
    const counts = {};
    for (const w of this.workflows) {
      const pid = w.project_id || '__legacy__';
      projectIds.add(pid);
      counts[pid] = (counts[pid] || 0) + 1;
    }

    // Hide when no workflows
    if (this.workflows.length === 0) {
      select.classList.add('hidden');
      return;
    }

    select.classList.remove('hidden');

    const projects = await window.ProjectHelper?.getProjectList() || {};

    // Dynamic truncation length based on available panel width
    const panelWidth = this.container?.clientWidth || window.innerWidth || 350;
    const dynamicMaxLen = Math.max(16, Math.floor((panelWidth - 90) / 9));

    const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;
    const trunc = (str, maxLen = dynamicMaxLen) => (str && str.length > maxLen) ? str.substring(0, maxLen - 1) + '…' : str;

    let options = `<option value="">${t('project.filterAll', { count: this.workflows.length })}</option>`;

    // Current project first
    if (window._currentProjectId && projectIds.has(window._currentProjectId)) {
      const rawName = projects[window._currentProjectId]?.name || window._currentProjectName || t('project.current');
      const name = trunc(rawName);
      const count = counts[window._currentProjectId] || 0;
      options += `<option value="${window._currentProjectId}" ${this._filterProjectId === window._currentProjectId ? 'selected' : ''}>${this.escapeHtml(name)} (${count})</option>`;
    }

    // Other projects
    for (const pid of projectIds) {
      if (pid === window._currentProjectId || pid === '__legacy__') continue;
      const rawName = projects[pid]?.name || pid.substring(0, 8);
      const name = trunc(rawName);
      const count = counts[pid] || 0;
      options += `<option value="${pid}" ${this._filterProjectId === pid ? 'selected' : ''}>${this.escapeHtml(name)} (${count})</option>`;
    }

    // Legacy items
    if (counts['__legacy__']) {
      options += `<option value="__legacy__" ${this._filterProjectId === '__legacy__' ? 'selected' : ''}>${t('project.legacy')} (${counts['__legacy__']})</option>`;
    }

    select.innerHTML = options;

    // Bind change & resize listener
    if (!select._wfListBound) {
      select._wfListBound = true;
      select.addEventListener('change', (e) => {
        this._filterProjectId = e.target.value || null;
        this._currentPage = 1; // reset pagination
        this.render();
      });
      window.addEventListener('resize', () => {
        clearTimeout(select._resizeTimer);
        select._resizeTimer = setTimeout(() => this._renderProjectFilter(), 200);
      });
    }
  }

  // Y-2: Cache project names for labels
  async _cacheProjectNames() {
    // Collect unique project_ids từ workflows
    const workflowProjectIds = this.workflows
      .map(w => w.project_id)
      .filter(pid => pid);

    // Ensure project names available (fetch từ API nếu missing)
    if (workflowProjectIds.length > 0 && window.ProjectHelper?.ensureProjectNames) {
      await window.ProjectHelper.ensureProjectNames(workflowProjectIds);
    }

    const projects = await window.ProjectHelper?.getProjectList() || {};
    this._projectNames = {};
    for (const [pid, info] of Object.entries(projects)) {
      this._projectNames[pid] = info.name;
    }
  }

  // Format relative time for last run
  _formatRelativeTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return window.I18n?.t('common.justNow') || 'Vừa xong';
    if (minutes < 60) return window.I18n?.t('albums.minutesAgo', { count: minutes, n: minutes }) || `${minutes} phút trước`;
    if (hours < 24) return window.I18n?.t('albums.hoursAgo', { count: hours, n: hours }) || `${hours} giờ trước`;
    if (days < 7) return window.I18n?.t('albums.daysAgo', { count: days, n: days }) || `${days} ngày trước`;
    const localeMap = { vi: 'vi-VN', en: 'en-US' };
    const locale = localeMap[window.I18n?.getLocale?.()] || 'vi-VN';
    return date.toLocaleDateString(locale);
  }


  async deleteWorkflow(wfId) {
    const wf = this.workflows.find(w => w.wf_id === wfId);
    const wfName = wf?.name || wf?.wf_name || 'Workflow';

    const ok = await window.customDialog.confirmDangerous(
      window.I18n?.t('workflow.deleteConfirmShort') || 'Xóa vĩnh viễn workflow này?',
      {
        title: window.I18n?.t('workflow.delete') || 'Xóa workflow',
        itemName: wfName
      }
    );
    if (!ok) return;

    try {
      if (window.storageManager) {
        await window.storageManager.deleteWorkflow(wfId);
      }
      // v1.1 paste image feature: cascade delete pasted blobs cho workflow này
      try {
        await window.PendingUploadStore?.deletePasteBlobsForWorkflow?.(wfId);
      } catch (e) { /* ignore */ }
      window.showNotification?.(window.I18n?.t('workflow.deleteSuccess') || 'Workflow đã xóa', 'success');
      // Refresh featureGate to update workflow count
      if (window.featureGate) {
        window.featureGate.refresh({ force: true }).catch(e => console.warn('[WorkflowList] FeatureGate refresh failed:', e));
      }
      // Gap 3 fix: notify popup editor đang mở wf_id này → editor đóng + warn user.
      // Trước đây editor không biết → user save sẽ tạo lại / 404 confusing.
      try {
        chrome.runtime.sendMessage({ action: 'workflowDeleted', wfId });
      } catch (e) { /* ignore */ }
    } catch (error) {
      console.error('[WorkflowList] Delete failed:', error);
      window.showNotification?.(window.I18n?.t('workflow.deleteFailed') || 'Không thể xóa workflow', 'error');
    }
  }

  async resetWorkflow(wfId) {
    const wf = this.workflows.find(w => w.wf_id === wfId);
    if (!wf) return;

    // Force stop executor nếu đang running
    if (window.workflowExecutor?.isRunning) {
      const forceOk = await window.customDialog.confirm(
        window.I18n?.t('workflowNotify.forceStopConfirm') || 'Workflow đang chạy. Force stop và reset?',
        { title: 'Force Reset', type: 'warning', confirmText: 'Force Reset', cancelText: window.I18n?.t('common.cancel') || 'Hủy' }
      );
      if (!forceOk) return;
      try {
        window.workflowExecutor.shouldStop = true;
        window.workflowExecutor.isRunning = false;
        window.MessageBridge?.stopExecution?.().catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowList#resetWorkflow', _e); });
        if (window.ExecutionLock) ExecutionLock.forceRelease();
      } catch (e) { /* ignore */ }
    } else {
      const ok = await window.customDialog.confirm(
        window.I18n?.t('workflow.resetConfirm') || 'Reset workflow này? Trạng thái và kết quả sẽ bị xóa.',
        { title: window.I18n?.t('workflow.reset') || 'Reset workflow' }
      );
      if (!ok) return;
    }

    try {
      if (window.storageManager) {
        await window.storageManager.resetWorkflow(wfId);
      }
      // Local eventBus emit → WorkflowTab listener → `_debouncedLoadWorkflows()` (1s coalesced reload)
      window.eventBus?.emit('workflow:reset', { workflowId: wfId });
      chrome.storage.local.remove('af_running_workflow');
      try {
        // Cross-context broadcast (popup editor cùng wf cần biết để refresh). Tag
        // `_originSidebar: true` để chính sidebar runtime handler skip → tránh self-loopback
        // gây double reload (Path C → Path B duplicate).
        chrome.runtime.sendMessage({
          action: 'workflowExecutionEvent',
          event: 'workflow:reset',
          data: { workflowId: wfId },
          _originSidebar: true,
        });
      } catch (e) { /* ignore */ }
      window.showNotification?.(window.I18n?.t('workflow.resetSuccess') || 'Workflow đã reset', 'success');
      // Bỏ `this.loadWorkflows()` immediate — redundant với Path B (eventBus → debounced reload).
      // Trước fix: reset → 2 reload (immediate + debounced 1s).
    } catch (error) {
      console.error('[WorkflowList] Reset failed:', error);
      window.showNotification?.(window.I18n?.t('workflow.resetFailed') || 'Không thể reset workflow', 'error');
    }
  }

  /**
   * Export workflow to JSON file
   */
  async exportWorkflow(wfId) {
    // Feature gate check
    if (!window.featureGate?.canUse('workflow_export')) {
      const label = window.featureGate?.getCrownLabel?.('workflow_export') || 'Premium';
      window.showNotification?.(
        window.I18n?.t('workflow.exportLocked') || `Export workflow: ${label}`,
        'warning'
      );
      return;
    }

    try {
      // Load workflow with nodes từ storage (path khác WorkflowEditor.exportWorkflow đọc Drawflow live)
      let workflow = this.workflows.find(w => w.wf_id === wfId);
      if (window.storageManager) {
        workflow = await window.storageManager.getWorkflow(wfId) || workflow;
      }

      if (!workflow) {
        window.showNotification?.(window.I18n?.t('workflow.noWorkflowToExport') || 'Không tìm thấy workflow', 'error');
        return;
      }

      // Build + download via shared helper (đồng nhất với WorkflowEditor.exportWorkflow path)
      const exportData = window.WorkflowExportHelper.buildExportData(
        workflow.wf_name,
        workflow.description,
        workflow,
        workflow.nodes || [],
        workflow.edges || []
      );
      const filename = window.WorkflowExportHelper.buildExportFilename(workflow.wf_name);
      window.WorkflowExportHelper.downloadJson(exportData, filename);

      window.showNotification?.(window.I18n?.t('workflow.exportSuccess') || 'Workflow đã xuất thành công', 'success');
      console.log('[WorkflowList] Workflow exported:', filename);
    } catch (error) {
      console.error('[WorkflowList] Export failed:', error);
      window.showNotification?.(window.I18n?.t('workflow.exportFailed') || 'Xuất workflow thất bại', 'error');
    }
  }


  showLoading() {
    const listContainer = this.container.querySelector('#workflowList');
    if (listContainer) {
      listContainer.innerHTML = this._renderSkeletons(4);
    }
  }

  _renderSkeletons(count = 4) {
    const skeletons = [];
    // Match real workflow card: [○] status + name (line 1) + nodes meta (line 2) + date (line 3) + toggle + ⋮
    for (let i = 0; i < count; i++) {
      skeletons.push(`
        <div class="workflow-card skeleton">
          <span class="skeleton-status skeleton-circle skeleton-base"></span>
          <div class="skeleton-info">
            <div class="skeleton-text" style="width: ${55 + Math.random() * 30}%; height: 14px;"></div>
            <div class="skeleton-text short" style="width: ${22 + Math.random() * 12}%; height: 11px;"></div>
            <div class="skeleton-text xs" style="width: ${18 + Math.random() * 10}%; height: 10px;"></div>
          </div>
          <div class="skeleton-actions">
            <div class="skeleton-btn skeleton-base" style="width: 32px; height: 18px; border-radius: 10px;"></div>
            <div class="skeleton-btn skeleton-base" style="width: 18px; height: 18px;"></div>
          </div>
        </div>
      `);
    }
    return skeletons.join('');
  }

  showSharedLoadingSkeleton(container) {
    if (!container) return;
    container.innerHTML = `
      <div class="workflow-list-container" style="overflow-y: auto; flex: 1; padding: 8px;">
        <div class="workflow-list">${this._renderSkeletons(3)}</div>
      </div>
    `;
  }

  showError(message) {
    const listContainer = this.container.querySelector('#workflowList');
    if (listContainer) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <p style="color: var(--destructive);">${message}</p>
        </div>
      `;
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    // textContent→innerHTML does NOT escape quotes; escape them so the result
    // is also safe inside title="..." / other double/single-quoted attributes.
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ===== IMPORT WORKFLOW FROM FILE (WT-15.1-15.6) =====

  /**
   * WT-15.2: File picker
   */
  _handleImportClick() {
    // Feature gate check
    if (!window.featureGate?.canUse('workflow_import')) {
      const label = window.featureGate?.getCrownLabel?.('workflow_import') || 'Premium';
      window.showNotification?.(
        window.I18n?.t('workflow.importLocked') || `Import workflow: ${label}`,
        'warning'
      );
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (file) {
        this._processImportFile(file);
      }
    };
    input.click();
  }

  /**
   * WT-15.3: Validate JSON structure
   */
  _validateImportData(data) {
    const errors = [];
    const t = (key, params) => window.I18n?.t(key, params) || key;

    // Defense-in-depth (import path is untrusted JSON):
    // 1) Reject prototype-pollution keys anywhere in the object graph.
    // 2) Clamp string fields (node_name/prompt/note_text/slug/name) to a max length.
    const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];
    const MAX_STRING_LEN = 20000;
    const CLAMPED_FIELDS = new Set(['node_name', 'prompt', 'note_text', 'slug', 'name']);
    const guardObject = (obj, depth) => {
      if (!obj || typeof obj !== 'object' || depth > 12) return;
      for (const key of Object.keys(obj)) {
        if (DANGEROUS_KEYS.includes(key) && Object.prototype.hasOwnProperty.call(obj, key)) {
          errors.push(t('workflow.importUnsafeKey', { key }) || `File import chứa khóa không hợp lệ: ${key}`);
          continue;
        }
        const val = obj[key];
        if (typeof val === 'string' && CLAMPED_FIELDS.has(key) && val.length > MAX_STRING_LEN) {
          obj[key] = val.slice(0, MAX_STRING_LEN);
        } else if (val && typeof val === 'object') {
          guardObject(val, depth + 1);
        }
      }
    };
    if (data && typeof data === 'object') guardObject(data, 0);

    // Version check
    if (data.version !== '1.0') {
      errors.push(t('workflow.importVersionNotSupported') || 'Phiên bản không hỗ trợ');
    }

    // Type check
    if (data.type !== 'workflow') {
      errors.push(t('workflow.importTypeInvalid') || 'Loại file không đúng');
    }

    // Workflow object
    if (!data.workflow) {
      errors.push(t('workflow.importMissingData') || 'Thiếu dữ liệu workflow');
      return { valid: false, errors };
    }

    // Name
    if (!data.workflow.name || data.workflow.name.length > 100) {
      errors.push(t('workflow.importNameInvalid') || 'Tên workflow không hợp lệ');
    }

    // Nodes array
    if (!Array.isArray(data.workflow.nodes)) {
      errors.push(t('workflow.importMissingNodes') || 'Thiếu danh sách nodes');
    } else {
      // Bug fix: whitelist trước thiếu các node types mới (Phase CG/G/WK-1).
      // → User export workflow có ChatGPT/Grok/Prompt → import bị reject "type không hợp lệ".
      // Bao gồm cả legacy types (transform/condition/merge/output) để import workflow cũ.
      const validTypes = [
        'start', 'generate', 'download', 'delay', 'telegram',
        'note', 'image',
        // Phase 1 — Node Reference System
        'text',
        // Text Extract node (2026-05-29)
        'text_extract',
        // Phase CG (ChatGPT)
        'chatgpt',
        // Phase G (Grok)
        'grok',
        // Phase CG-8 (Prompt enhance)
        'prompt',
        // Legacy (workflow cũ)
        'transform', 'condition', 'merge', 'output',
      ];
      data.workflow.nodes.forEach((node, i) => {
        if (!node.node_id || !node.node_type) {
          errors.push(t('workflow.importNodeMissingIdType', { index: i + 1 }) || `Node ${i + 1} thiếu id hoặc type`);
        }
        if (node.node_type && !validTypes.includes(node.node_type)) {
          errors.push(t('workflow.importNodeTypeInvalid', { index: i + 1, type: node.node_type }) || `Node ${i + 1} có type không hợp lệ: ${node.node_type}`);
        }
      });
    }

    // Edges array
    if (!Array.isArray(data.workflow.edges)) {
      errors.push(t('workflow.importMissingEdges') || 'Thiếu danh sách edges');
    } else if (Array.isArray(data.workflow.nodes)) {
      // Orphan edge check — edge phải tham chiếu node_id tồn tại trong nodes.
      // Drawflow.addConnection fail silently nếu node ID không có → workflow load mất connection.
      const nodeIds = new Set(data.workflow.nodes.map(n => n.node_id).filter(Boolean));
      data.workflow.edges.forEach((edge, i) => {
        const srcId = edge.source_node_id || edge.source_node;
        const tgtId = edge.target_node_id || edge.target_node;
        if (srcId && !nodeIds.has(srcId)) {
          errors.push(t('workflow.importEdgeOrphan', { index: i + 1, side: 'source', id: srcId })
            || `Edge ${i + 1}: source node "${srcId}" không tồn tại`);
        }
        if (tgtId && !nodeIds.has(tgtId)) {
          errors.push(t('workflow.importEdgeOrphan', { index: i + 1, side: 'target', id: tgtId })
            || `Edge ${i + 1}: target node "${tgtId}" không tồn tại`);
        }
      });
    }

    // Bug fix: Quota check workflows_nodes_max — chống bypass qua import JSON.
    // User edit JSON manually thêm nodes vượt quota → trước fix: import OK + save OK.
    // Giờ: reject với UI dialog rõ ràng + suggest upgrade.
    if (Array.isArray(data.workflow.nodes) && window.featureGate) {
      try {
        const quota = window.featureGate.checkQuota('workflows_nodes_max');
        const limit = quota?.limit;
        if (limit !== 'unlimited' && limit !== '-1' && limit > 0 && data.workflow.nodes.length > limit) {
          errors.push(
            t('workflow.importNodeQuotaExceeded', { count: data.workflow.nodes.length, limit })
            || `Gói của bạn giới hạn tối đa ${limit} nodes/workflow.\n\nWorkflow import: ${data.workflow.nodes.length} nodes\nGiới hạn gói: ${limit} nodes\n\nNâng cấp Premium để import workflow này.`
          );
        }
      } catch (e) { /* graceful: skip nếu featureGate chưa ready */ }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * WT-15.4: Convert URLs → trigger re-upload
   */
  _convertImportedNodes(nodes) {
    const nodeIdMap = {};

    const result = nodes.map(node => {
      const converted = { ...node };

      // Generate new node_id để tránh conflict
      const newNodeId = window.IdGenerator ? window.IdGenerator.next('node') : ('node_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9));
      nodeIdMap[node.node_id] = newNodeId;
      converted.node_id = newNodeId;

      // Convert ref_images array → ref_thumbnails format (triggers re-upload)
      console.log('[Import] Node:', node.node_id, 'ref_images:', node.ref_images);

      if (node.ref_images && node.ref_images.length > 0) {
        const importKeys = [];
        converted.ref_thumbnails = {};
        converted.ref_file_names = {};

        node.ref_images.forEach((img, idx) => {
          // Include random suffix to avoid key collision between nodes processed in same millisecond
          const key = `upload_import_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 5)}`;
          importKeys.push(key);
          // 2026-05-31: preserve type + video_url cho video tiles (export mới có 2 fields này)
          // → restore object format {thumbnail, type:'video', video_url} cho ref_thumbnails →
          // _restoreNodeStates đọc đúng → render <video> thay <img> broken.
          const hasVideoMeta = img.type === 'video' || img.video_url;
          if (hasVideoMeta) {
            converted.ref_thumbnails[key] = {
              thumbnail: img.thumbnail || img.url || '',
              type: img.type || 'video',
              ...(img.video_url && { video_url: img.video_url }),
            };
          } else {
            converted.ref_thumbnails[key] = img.thumbnail || img.url;
          }
          if (img.file_name) {
            converted.ref_file_names[key] = img.file_name;
          }
          console.log('[Import] Created key:', key, 'thumbnail:', converted.ref_thumbnails[key]);
        });

        // CRITICAL: ref_file_ids phải chứa các keys để editor biết hiển thị thumbnails nào
        converted.ref_file_ids = importKeys.join(', ');
        console.log('[Import] Final ref_file_ids:', converted.ref_file_ids);
        console.log('[Import] Final ref_thumbnails:', converted.ref_thumbnails);
      }

      // Frame metadata: prefer flat format (current export — frame_X_file_name + frame_X_thumbnail),
      // fallback nested (legacy/admin templates — node.frame_X.thumbnail/file_name).
      // ALWAYS reset frame_X_file_id (tile_id session-specific từ project export → cross-project leak).
      // Defensive: reset bất kể JSON có frame data hay không, bao gồm cả edge case JSON sửa thủ công.
      [1, 2].forEach(n => {
        if (node[`frame_${n}_file_id`]) converted[`frame_${n}_file_id`] = '';
        const flatFileName = node[`frame_${n}_file_name`];
        const flatThumbnail = node[`frame_${n}_thumbnail`];
        const nested = node[`frame_${n}`];
        if (flatFileName) converted[`frame_${n}_file_name`] = flatFileName;
        else if (nested?.file_name) converted[`frame_${n}_file_name`] = nested.file_name;
        if (flatThumbnail) converted[`frame_${n}_thumbnail`] = flatThumbnail;
        else if (nested?.thumbnail) converted[`frame_${n}_thumbnail`] = nested.thumbnail;
      });

      return { converted, nodeIdMap };
    }).reduce((acc, { converted, nodeIdMap: map }) => {
      acc.nodes.push(converted);
      Object.assign(acc.nodeIdMap, map);
      return acc;
    }, { nodes: [], nodeIdMap: {} });

    // Pass 2: remap frame_X_source upstream node IDs sang new IDs.
    // 'manual'/'' giữ nguyên — chỉ remap khi source là old node_id của upstream node.
    // Pattern đồng bộ với clone (ProjectHelper.cloneWorkflowCrossProject + WorkflowList.cloneWorkflow).
    for (const cloned of result.nodes) {
      if (cloned.frame_1_source && cloned.frame_1_source !== 'manual' && cloned.frame_1_source !== '') {
        cloned.frame_1_source = result.nodeIdMap[cloned.frame_1_source] || cloned.frame_1_source;
      }
      if (cloned.frame_2_source && cloned.frame_2_source !== 'manual' && cloned.frame_2_source !== '') {
        cloned.frame_2_source = result.nodeIdMap[cloned.frame_2_source] || cloned.frame_2_source;
      }
    }
    return result;
  }

  /**
   * WT-15.6: Handle duplicate names
   */
  _getUniqueName(baseName) {
    const existing = this.workflows.map(w => w.wf_name);
    let name = baseName;
    let counter = 1;

    while (existing.includes(name)) {
      name = `${baseName} (${counter})`;
      counter++;
    }

    return name;
  }

  /**
   * WT-15.5: Save imported workflow
   */
  async _saveImportedWorkflow(importData) {
    const t = (key, params) => window.I18n?.t(key, params) || key;

    // Convert nodes and build new ID mapping
    const { nodes: convertedNodes, nodeIdMap } = this._convertImportedNodes(importData.workflow.nodes);

    // AI Agent rename (2026-05-30) + missing-defaults heal: import JSON có thể là v1.1.5 export
    // chỉ có legacy fields (enhance) hoặc missing required defaults (video_input_type, etc).
    // Fire normalize cho từng node trước khi save → backfill use_ai/ai_fallback/ai_delete_after_run
    // (1-way migrate legacy→new) + safe defaults cho missing video_input_type/grok_mode/use_fallback_prefix.
    // Backend WorkflowDataHealer cũng heal lần 2, nhưng client heal sớm tránh round-trip lỗi.
    convertedNodes.forEach(n => {
      try { window.NodeTemplates?.normalizeNodeData?.(n); } catch (_) { /* ignore */ }
    });

    // Convert edges with remapped node IDs (support both old and new format)
    const convertedEdges = (importData.workflow.edges || []).map(e => {
      // Support both old format (source_node) and new format (source_node_id)
      const oldSourceId = e.source_node_id || e.source_node;
      const oldTargetId = e.target_node_id || e.target_node;

      // 2026-05-31: smart data_type — infer từ source node nếu file cũ không có,
      // text/prompt/text_extract → 'text', còn lại → 'image'.
      let inferredDataType = e.data_type;
      if (!inferredDataType) {
        const srcNode = importData.workflow.nodes?.find(n => n.node_id === oldSourceId);
        const srcType = srcNode?.node_type;
        inferredDataType = ['text', 'text_extract', 'prompt'].includes(srcType) ? 'text' : 'image';
      }
      return {
        edge_id: window.IdGenerator ? window.IdGenerator.next('edge') : ('edge_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5)),
        source_node_id: nodeIdMap[oldSourceId] || oldSourceId,
        source_handle: e.source_handle || e.source_output || 'output_1',
        // Phase WK-1 typed multi-port — bug fix: preserve source_port + target_port từ file.
        // Nếu file export cũ (no port info) → null → DiagramCanvas auto-infer port[0] sang.
        source_port: e.source_port || null,
        target_node_id: nodeIdMap[oldTargetId] || oldTargetId,
        target_handle: e.target_handle || e.target_input || 'input_1',
        target_port: e.target_port || null,
        data_type: inferredDataType
      };
    });

    console.log('[WorkflowList] Converted edges:', convertedEdges.length, convertedEdges.slice(0, 2));

    // Map settings JSON keys → workflow storage field names.
    // Bug fix: export ghi 'parallel' nhưng storage dùng 'parallel_execution' (xem
    // WorkflowEditor.js:756 + WorkflowExecutor.js:233). Spread thẳng sẽ mất giá trị.
    const importedSettings = importData.workflow.settings || {};
    const mappedSettings = {};
    if ('parallel' in importedSettings) mappedSettings.parallel_execution = importedSettings.parallel;
    if ('parallel_execution' in importedSettings) mappedSettings.parallel_execution = importedSettings.parallel_execution;
    if ('quantity' in importedSettings) mappedSettings.quantity = importedSettings.quantity;
    if ('delay_between_nodes' in importedSettings) mappedSettings.delay_between_nodes = importedSettings.delay_between_nodes;
    if ('timeout_per_node' in importedSettings) mappedSettings.timeout_per_node = importedSettings.timeout_per_node;
    if ('retry_on_error' in importedSettings) mappedSettings.retry_on_error = importedSettings.retry_on_error;
    if ('stop_on_error' in importedSettings) mappedSettings.stop_on_error = importedSettings.stop_on_error;

    const workflow = {
      // UUID + timestamp tránh collision khi rapid import.
      wf_id: window.IdGenerator ? window.IdGenerator.next('wf') : ('wf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)),
      wf_name: this._getUniqueName(importData.workflow.name),
      wf_description: importData.workflow.description || '',
      ...mappedSettings,
      project_id: window._currentProjectId || null,
      status: 'idle',
      enabled: true,
      progress_completed: 0,
      progress_total: convertedNodes.length,
      current_node_id: null,
      // sort_order: KHÔNG dùng để sắp danh sách này — danh sách workflow sắp theo THỜI GIAN
      // (mới nhất trước), là lựa chọn có chủ ý. Trường vẫn được ghi vì wf-framework
      // (operations.js) sắp TEMPLATE theo category_id rồi sort_order; giữ để hai bên cùng
      // một hình dạng dữ liệu. Đổi sang sắp thủ công thì sửa chỗ SẮP, không phải chỗ này.
      sort_order: this.workflows.length || 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Add wf_id to nodes and edges.
    // Reset đầy đủ result/runtime fields — JSON file có thể chứa data của workflow đã chạy.
    // GIỮ result_provider_urls (intentional design line 6055-6057 — TTL ngắn cho re-download).
    // Status 'pending' đồng nhất với DiagramCanvas init + clone pattern.
    const nodesWithWfId = convertedNodes.map(n => ({
      ...n,
      wf_id: workflow.wf_id,
      status: 'pending',
      result_file_ids: '',
      result_thumbnails: {},
      result_file_names: {},
      result_text: '',
      result_source: null,
      error_message: '',
      executed_at: null
    }));

    const edgesWithWfId = convertedEdges.map(e => ({
      ...e,
      wf_id: workflow.wf_id
    }));

    // Save using existing storage pattern
    if (window.storageManager) {
      await window.storageManager.saveWorkflowFull(workflow, nodesWithWfId, edgesWithWfId);
    }

    return workflow;
  }

  /**
   * Full import flow (WT-15.1-15.6)
   */
  async _processImportFile(file) {
    const t = (key, params) => window.I18n?.t(key, params) || key;
    const dialog = window.customDialog || window.CustomDialog;

    try {
      // 1. Read file
      const text = await file.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (parseErr) {
        dialog?.alert(t('workflow.importFileError') || 'Lỗi đọc file: File JSON không hợp lệ', { type: 'error' });
        return;
      }

      // 2. Validate
      const validation = this._validateImportData(data);
      if (!validation.valid) {
        // Check if error is quota-related (node limit exceeded)
        const isQuotaError = validation.errors.some(err =>
          err.includes('node') && (err.includes('giới hạn') || err.includes('limit') || err.includes('quota'))
        );

        if (isQuotaError) {
          // Show upgrade dialog for quota errors
          const shouldUpgrade = await dialog?.confirm(
            validation.errors.join('\n'),
            {
              title: t('workflow.importQuotaTitle') || 'Vượt giới hạn gói',
              type: 'warning',
              confirmText: t('common.upgrade') || 'Nâng cấp',
              cancelText: t('common.cancel') || 'Hủy'
            }
          );
          /* upgrade modal removed — local-first; confirm is now informational only */
          void shouldUpgrade;
        } else {
          // Show regular error dialog for other validation errors
          dialog?.alert(
            validation.errors.join('\n'),
            {
              title: t('workflow.importErrorTitle') || 'Không thể import',
              type: 'error'
            }
          );
        }
        return;
      }

      // 3. Check quota (async để đảm bảo data mới nhất từ server theo user plan)
      if (window.featureGate) {
        const canCreate = await window.featureGate.canCreateWorkflowAsync();
        if (!canCreate) {
          const isLoggedIn = window.authManager?.isLoggedIn();
          if (!isLoggedIn) {
            window.featureGate.showLoginPrompt(
              t('workflow.requireLoginToImport') || 'Import workflow yêu cầu đăng nhập'
            );
          } else {
            const quota = window.featureGate.checkQuota('workflows_max');
            const shouldUpgrade = await dialog?.confirm(
              t('workflow.quotaLimitReached', { limit: quota.limit, used: quota.used }) ||
              `Gói của bạn giới hạn tối đa ${quota.limit} workflow. Bạn đã có ${quota.used} workflow. Nâng cấp Premium để tạo không giới hạn.`,
              {
                title: t('workflow.quotaLimitTitle') || 'Limit reached',
                type: 'warning',
                confirmText: t('common.upgrade') || 'Nâng cấp',
                cancelText: t('common.later') || 'Later'
              }
            );
            /* upgrade modal removed — local-first; confirm is now informational only */
            void shouldUpgrade;
          }
          return;
        }
      }

      // Fix B: chặn import khi chưa có Flow project sẵn sàng → tránh tạo workflow "chết" (bind
      // project_id null ở _saveImportedWorkflow). Đặt sau quota, trước save. ensureProjectOrGuide
      // sync projectId live về cache trước khi _saveImportedWorkflow đọc window._currentProjectId.
      if (window.ProjectHelper && !(await window.ProjectHelper.ensureProjectOrGuide())) {
        return;
      }

      // 4. Debug log import data
      this._debugImportData(data);

      // 5. Save
      const workflow = await this._saveImportedWorkflow(data);
      if (!workflow || !workflow.wf_id) {
        throw new Error(window.I18n?.t('workflowNotify.importSaveFailed') || 'Không thể lưu workflow - dữ liệu không hợp lệ');
      }
      console.log('[WorkflowList] Workflow saved:', workflow.wf_id, workflow.wf_name);

      // 6. Record usage for anonymous users (server không track)
      if (window.featureGate && !window.authManager?.isLoggedIn()) {
        await window.featureGate.recordWorkflowCreated();
      }

      // 7. Refresh featureGate to update workflow count
      if (window.featureGate) {
        window.featureGate.refresh({ force: true }).catch(e => console.warn('[WorkflowList] FeatureGate refresh failed:', e));
      }

      // 8. Refresh list
      await this.loadWorkflows();

      // 8. Show success
      dialog?.alert(
        t('workflow.importSuccess', { name: workflow.wf_name }) || `Đã nhập workflow "${workflow.wf_name}"`,
        { type: 'success' }
      );

      // 9. Emit event
      window.eventBus?.emit('workflow:imported', { workflowId: workflow.wf_id });

    } catch (err) {
      console.error('[WorkflowList] Import error:', err);

      // Check if it's a quota error - ApiStorage already shows modal
      if (err.code === 'QUOTA_EXCEEDED' || err.message?.includes('giới hạn')) {
        return;
      }

      // REQUIRES_LOGIN error - show login prompt (defensive, normally caught by canCreateWorkflowAsync)
      if (err.message === 'REQUIRES_LOGIN') {
        window.featureGate?.showLoginPrompt(
          t('workflow.requireLoginToImport') || 'Import workflow yêu cầu đăng nhập'
        );
        return;
      }

      dialog?.alert(
        (t('workflow.importFileError') || 'Lỗi import workflow') + ':\n' + (err.message || 'Lỗi không xác định'),
        { type: 'error', title: t('common.error') || 'Lỗi' }
      );
    }
  }

  /**
   * Debug: Log import data structure
   */
  _debugImportData(data) {
    console.log('[WorkflowList] Import data structure:', {
      version: data.version,
      type: data.type,
      hasWorkflow: !!data.workflow,
      workflowName: data.workflow?.name,
      nodesCount: data.workflow?.nodes?.length || 0,
      edgesCount: data.workflow?.edges?.length || 0,
      edgesSample: data.workflow?.edges?.slice(0, 2)
    });
  }

  /**
   * Trả SVG icon theo status: idle/running/completed/error.
   * Running icon có class .status-icon-spin → CSS spin đồng bộ với gen-running-spin.
   */
  static _renderStatusIcon(status) {
    const s = status || 'idle';
    const stroke = 'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"';
    if (s === 'running') {
      return `<svg class="status-icon-spin" width="14" height="14" viewBox="0 0 24 24" ${stroke}><path d="M21 12a9 9 0 1 1-6.219-8.56"></path></svg>`;
    }
    if (s === 'completed') {
      return `<svg width="14" height="14" viewBox="0 0 24 24" ${stroke}><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    }
    if (s === 'error' || s === 'failed') {
      return `<svg width="14" height="14" viewBox="0 0 24 24" ${stroke}><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
    }
    return `<svg width="14" height="14" viewBox="0 0 24 24" ${stroke}><circle cx="12" cy="12" r="9"></circle></svg>`;
  }

  /** Trả localized label cho tooltip status. Dùng namespace workflow.* */
  static _renderStatusLabel(status) {
    const I = window.I18n;
    const s = status || 'idle';
    if (s === 'running') return I?.t('workflow.statusRunning') || 'Running';
    if (s === 'completed') return I?.t('workflow.statusCompleted') || 'Hoàn thành';
    if (s === 'error' || s === 'failed') return I?.t('workflow.statusFailed') || 'Failed';
    if (s === 'warning') return I?.t('workflow.statusWarning') || 'Bỏ qua node — thiếu input';
    if (s === 'pending') return I?.t('workflow.statusPending') || 'Pending';
    // idle: dùng common.idle hoặc fallback
    return I?.t('workflow.statusIdle') || I?.t('workflow.statusPending') || 'Ready';
  }

  /**
   * Render avatars của users được share workflow
   * @param {Array} shares - Danh sách share records với recipient info
   * @returns {string} HTML avatars
   */
  _renderSharedUsersAvatars(shares) {
    if (!shares || shares.length === 0) return '';

    // Chỉ lấy shares đã accepted và có recipient
    const acceptedShares = shares.filter(s => s.status === 'accepted' && s.recipient);
    if (acceptedShares.length === 0) return '';

    const maxShow = 3;
    const displayShares = acceptedShares.slice(0, maxShow);
    const extraCount = acceptedShares.length - maxShow;

    let avatarsHtml = displayShares.map(share => {
      const name = share.recipient.name || share.recipient.email || 'User';
      const initial = name.charAt(0).toUpperCase();
      const email = share.recipient.email || '';
      const tooltip = `${this.escapeHtml(name)}${email ? ` (${this.escapeHtml(email)})` : ''}`;

      return `<span class="wf-share-avatar" title="${tooltip}" data-tooltip="${tooltip}">${initial}</span>`;
    }).join('');

    if (extraCount > 0) {
      avatarsHtml += `<span class="wf-share-avatar wf-share-avatar-more" title="+${extraCount} người khác">+${extraCount}</span>`;
    }

    return `<div class="wf-share-avatars">${avatarsHtml}</div>`;
  }

  // ===== SHARE WORKFLOW METHODS =====

  /**
   * Mở modal chia sẻ workflow
   * @param {string} wfId - ID của workflow cần chia sẻ
   */
  handleShare(wfId) {
    const workflow = this.workflows.find(w => w.wf_id === wfId);
    if (!workflow) {
      console.error('[WorkflowList] Workflow not found for sharing:', wfId);
      return;
    }

    // Chỉ cho phép chia sẻ workflow user sở hữu
    if (workflow._is_shared_view) {
      window.showNotification?.(
        window.I18n?.t('workflow.cannotShareShared') || 'Không thể chia sẻ workflow được chia sẻ với bạn',
        'warning'
      );
      return;
    }

    // Offline: chia sẻ workflow cần backend + tài khoản người nhận → chặn sớm với thông báo rõ,
    // thay vì mở modal cho user gõ email rồi mới fail generic "Không thể chia sẻ".
    if (self.SEOSONA_LOCAL_MODE !== false) {
      window.showNotification?.(window.I18n?.t('workflow.shareRequiresOnline') || 'Chia sẻ workflow cần tài khoản online — không khả dụng ở chế độ local.', 'info', 4000);
      return;
    }

    // Check feature gate
    if (window.featureGate && !window.featureGate.canUse('workflow_share_enabled')) {
      window.featureGate.showModuleBlockedDialog('workflow_share');
      return;
    }

    // Mở ShareWorkflowModal
    if (window.ShareWorkflowModal) {
      window.ShareWorkflowModal.show(wfId);
    } else {
      console.error('[WorkflowList] ShareWorkflowModal not available');
      window.showNotification?.(
        window.I18n?.t('workflow.shareModalNotAvailable') || 'Chức năng chia sẻ chưa sẵn sàng',
        'error'
      );
    }
  }

  /**
   * Modal xác nhận clone shared workflow — UI GIỐNG _showUseTemplateConfirmation của template
   * (reuse CSS .wf-confirm-modal). Trả Promise<boolean>.
   */
  _showSharedCloneConfirmation(workflow) {
    return new Promise((resolve) => {
      // I18n.t trả về KEY khi thiếu key → check v !== k để fallback đúng (key mới chưa sync DB).
      const t = (k, fb) => { const v = window.I18n?.t?.(k); return (v && v !== k) ? v : fb; };
      const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const name = workflow.wf_name || workflow.name || t('workflow.unnamed', 'Workflow');
      const nodeCount = (workflow.nodes || []).length;
      const html = `
        <div class="wf-confirm-modal-overlay" id="useSharedConfirmModal">
          <div class="wf-confirm-modal">
            <div class="wf-confirm-header">
              <h3 class="wf-confirm-title">${t('workflow.useSharedTitle', 'Dùng workflow')}</h3>
              <button class="wf-confirm-close-btn" data-action="cancel" title="${t('common.close', 'Đóng')}">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="wf-confirm-body">
              <div class="wf-confirm-template-info">
                <div class="wf-confirm-details">
                  <h4 class="wf-confirm-name">${esc(name)}</h4>
                  <div class="wf-confirm-meta">
                    <span class="wf-confirm-nodes">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M9 6h6a3 3 0 0 1 3 3v6"/></svg>
                      ${nodeCount} ${t('workflow.nodes', 'nodes')}
                    </span>
                  </div>
                </div>
              </div>
              <div class="wf-confirm-message">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                <span>${t('workflow.useSharedMessage', 'Workflow sẽ được lưu thành bản mới trong tài khoản của bạn. Bạn có thể chỉnh sửa thoải mái.')}</span>
              </div>
            </div>
            <div class="wf-confirm-footer">
              <button class="wf-confirm-cancel-btn" data-action="cancel">${t('common.cancel', 'Hủy')}</button>
              <button class="wf-confirm-use-btn" data-action="confirm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
                ${t('workflow.useTemplate', 'Sử dụng')}
              </button>
            </div>
          </div>
        </div>`;
      document.querySelectorAll('#useSharedConfirmModal').forEach(el => el.remove());
      const container = document.createElement('div');
      container.innerHTML = html;
      document.body.appendChild(container);
      const modal = container.querySelector('#useSharedConfirmModal');
      const onKey = (e) => { if (e.key === 'Escape') handle('cancel'); };
      const handle = (action) => { document.removeEventListener('keydown', onKey); container.remove(); resolve(action === 'confirm'); };
      if (!modal) { container.remove(); resolve(false); return; }
      modal.addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]')?.dataset?.action;
        if (action) handle(action);
        else if (e.target === modal) handle('cancel'); // click nền đóng
      });
      document.addEventListener('keydown', onKey);
    });
  }

  /**
   * Clone workflow từ shared workflow về tài khoản của mình
   * POST /v1/shared-workflows/{wf_id}/clone
   * @param {string} wfId - ID của shared workflow cần clone
   */
  async handleDuplicateFromShared(wfId, workflowObj = null) {
    // Lock để tránh duplicate click
    if (this._isDuplicatingShared) {
      console.log('[WorkflowList] Duplicate from shared already in progress, ignoring duplicate click');
      return;
    }

    // workflowObj truyền từ lite preview → KHÔNG phụ thuộc _sharedWorkflows đã load (fallback find).
    const workflow = workflowObj || this._sharedWorkflows.find(w => w.wf_id === wfId);
    if (!workflow) {
      console.error('[WorkflowList] Shared workflow not found:', wfId);
      window.showNotification?.(window.I18n?.t('workflow.sharedNotFound') || 'Không tìm thấy workflow được chia sẻ', 'error');
      return;
    }

    // Offline: shared-workflow (người khác share) là feature server — clone qua API cần auth/quota.
    // Thông báo rõ thay vì login-prompt không thể thỏa. (loadSharedWorkflows=[] offline nên path này
    // hiếm khi tới; gate ở đây phòng khi vào từ preview kind='shared'.)
    if (self.SEOSONA_LOCAL_MODE !== false) {
      window.showNotification?.(window.I18n?.t('workflow.sharedRequiresOnline') || 'Nhân bản workflow được chia sẻ cần tài khoản online — không khả dụng ở chế độ local.', 'info', 4000);
      return;
    }

    // Modal xác nhận (giống "Use template" của template clone).
    const confirmed = await this._showSharedCloneConfirmation(workflow);
    if (!confirmed) return;

    this._isDuplicatingShared = true;

    try {
      // Yêu cầu đăng nhập (function này gọi API cần auth token)
      if (!window.authManager?.isLoggedIn()) {
        window.featureGate?.showLoginPrompt(
          window.I18n?.t('workflow.requireLoginToClone') || 'Nhân bản workflow yêu cầu đăng nhập'
        );
        return;
      }

      // Check quota (async để đảm bảo data mới nhất từ server)
      if (window.featureGate) {
        const canCreate = await window.featureGate.canCreateWorkflowAsync();
        if (!canCreate) {
          const quota = window.featureGate.checkQuota('workflows_max');
          const shouldUpgrade = await window.customDialog?.confirm(
            window.I18n?.t('workflow.cloneQuotaExhausted', { limit: quota.limit, used: quota.used }) ||
              `Gói của bạn giới hạn tối đa ${quota.limit} workflow. Bạn đã có ${quota.used} workflow. Nâng cấp Premium để nhân bản không giới hạn.`,
            {
              title: window.I18n?.t('workflow.quotaReached') || 'Limit reached',
              type: 'warning',
              confirmText: window.I18n?.t('common.upgrade') || 'Upgrade',
              cancelText: window.I18n?.t('common.later') || 'Later'
            }
          );
          if (shouldUpgrade) {
            try { chrome.runtime.sendMessage({ action: 'showUpgradeModal' }); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowList#handleDuplicateFromShared', e); }
          }
          return;
        }
      }

      // Fix B: chặn clone shared workflow khi chưa có Flow project sẵn sàng → tránh tạo workflow
      // "chết" (bind project_id null ở body POST bên dưới). Đặt sau quota, trước fetch.
      // ensureProjectOrGuide sync projectId live về window._currentProjectId trước khi build body.
      if (window.ProjectHelper && !(await window.ProjectHelper.ensureProjectOrGuide())) {
        return; // finally release _isDuplicatingShared
      }

      window.showNotification?.(
        window.I18n?.t('workflow.duplicatingShared') || 'Saving workflow...',
        'success',
        2000
      );

      const baseUrl = window.ApiBaseConfig.get();
      const token = await window.authManager.getToken();

      const response = await fetch(`${baseUrl}/shared-workflows/${wfId}/clone`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Extension-Id': chrome.runtime.id,
        },
        // Gán vào project hiện tại (như template clone) → tránh "Workflow chưa gán project".
        body: JSON.stringify({ project_id: window._currentProjectId || null }),
      });

      const json = await response.json().catch(() => ({}));

      if (!response.ok) {
        // Backend trả: { success: false, error: { code, message, data } }
        const errCode = json?.error?.code || json?.code;
        const errMsg = json?.error?.message || json?.message || `HTTP ${response.status}`;

        // QUOTA_EXCEEDED, FEATURE_DISABLED → modal có nút Upgrade
        if (errCode === 'QUOTA_EXCEEDED' || errCode === 'FEATURE_DISABLED') {
          const shouldUpgrade = await window.customDialog?.confirm(errMsg, {
            title: window.I18n?.t('workflow.quotaReached') || 'Limit reached',
            type: 'warning',
            confirmText: window.I18n?.t('common.upgrade') || 'Upgrade',
            cancelText: window.I18n?.t('common.later') || 'Later',
          });
          /* upgrade modal removed — local-first; confirm is now informational only */
          void shouldUpgrade;
          return;
        }

        // Lỗi khác — toast
        window.showNotification?.(
          (window.I18n?.t('workflow.duplicateSharedFailed') || 'Không thể nhân bản workflow') + ': ' + errMsg,
          'error'
        );
        return;
      }

      const data = json.data || json;
      console.log('[WorkflowList] Duplicated shared workflow:', data);

      window.showNotification?.(
        window.I18n?.t('workflow.duplicateSharedSuccess') || 'Workflow duplicated successfully',
        'success'
      );

      // Refresh danh sách workflows
      await this.loadWorkflows();

      // Refresh featureGate để update quota
      if (window.featureGate) {
        window.featureGate.refresh({ force: true }).catch(e => console.warn('[WorkflowList] FeatureGate refresh failed:', e));
      }

      // Switch to My Workflows tab
      const workflowsTab = document.querySelector('[data-subtab="workflows"]');
      if (workflowsTab) {
        workflowsTab.click();
      }

      // Auto-open the newly cloned workflow
      const newWorkflow = data.workflow || data;
      if (newWorkflow?.wf_id) {
        setTimeout(() => {
          if (this._openWorkflow) {
            this._openWorkflow(newWorkflow.wf_id);
          } else if (window.eventBus) {
            window.eventBus.emit('workflow:open_editor', { mode: 'edit', workflow: newWorkflow });
          }
        }, 300);
      }

    } catch (error) {
      console.error('[WorkflowList] Duplicate from shared failed:', error);
      window.showNotification?.(
        (window.I18n?.t('workflow.duplicateSharedFailed') || 'Không thể nhân bản workflow') + ': ' + error.message,
        'error'
      );
    } finally {
      this._isDuplicatingShared = false;
    }
  }

  /**
   * Format thời gian shared thành relative time
   * @param {string} dateStr - ISO date string
   * @returns {string} Formatted time string
   */
  _formatSharedTime(dateStr) {
    if (!dateStr) return '';

    const normalized = (typeof dateStr === 'string' && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(dateStr))
      ? dateStr.replace(' ', 'T') + 'Z'
      : dateStr;
    const date = new Date(normalized);
    const now = new Date();
    const diffMs = now - date;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    const t = (key, fallback) => window.I18n?.t(key) || fallback;

    if (diffSec < 60) {
      return t('notification.time.justNow', 'Vừa xong');
    } else if (diffMin < 60) {
      return `${diffMin} ${t('notification.time.minutesAgo', 'phút trước')}`;
    } else if (diffHour < 24) {
      return `${diffHour} ${t('notification.time.hoursAgo', 'giờ trước')}`;
    } else if (diffDay < 7) {
      return `${diffDay} ${t('notification.time.daysAgo', 'ngày trước')}`;
    } else {
      const day = date.getDate().toString().padStart(2, '0');
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const year = date.getFullYear();
      return `${day}/${month}/${year}`;
    }
  }
}

// Export
window.WorkflowList = WorkflowList;
