/**
 * WorkflowTab - Controller chính cho Tab 4: SEOSONA Flow
 */
class WorkflowTab {
  constructor(container) {
    this.container = container;
    this.workflowList = null;
    this.workflowTemplateList = null;
    this.isInitialized = false;
    // [Phase 7] Default khớp landing thật = 'workflows' (My Spaces). Trước để 'templates' → error-fallback
    // (app.js) + init-catch load nhầm Templates thay vì My Spaces. init() vẫn _switchSubtab('workflows').
    this._currentSubtab = 'workflows';
  }

  async init() {
    if (this.isInitialized) return;

    console.log('[WorkflowTab] Initializing...');

    // Initialize storage if needed
    if (window.storageManager && !window.storageManager.storage) {
      await window.storageManager.init();
    }

    // Render sub-tabs UI
    this._renderSubtabs();

    // Create WorkflowList component
    const workflowContent = this.container.querySelector('[data-content="workflows"]');
    const listSection = workflowContent || this.container.querySelector('#workflowListSection') || this.container;
    this.workflowList = new WorkflowList(listSection);
    // [Phase 0 — vá phantom global] app.js:7978/7990 + WorkflowTemplateList.js:1478/1501 đọc
    // `window.workflowList` nhưng trước đây KHÔNG nơi nào gán → luôn undefined → chỉ chạy nhờ
    // fallback tình cờ (subtab .click() + eventBus). Expose để các read-site đó chạy đúng path chính.
    try { window.workflowList = this.workflowList; } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowTab#init', _); }

    // Bind sub-tab events
    this._bindSubtabEvents();

    // Listen for events
    if (window.eventBus) {
      window.eventBus.on('workflow:open_editor', (data) => {
        this.openEditor(data.mode, data.workflow);
      });

      // Listen for workflow run
      window.eventBus.on('workflow:run', (data) => {
        this.runWorkflow(data.workflow, data.manualSubmitMode);
      });

      // [Phase 3 — copy-isolation] KHÔNG còn auto-switch My Spaces→Flows khi chạy. Model mới: Flows chỉ
      // hiện BẢN COPY (flow_kind='flow'); chạy bản GỐC ở My Spaces thì bản gốc KHÔNG có trong Flows →
      // nhảy sang sẽ thấy trống. My Spaces giờ hiện tiến trình tại chỗ (Phase 1) nên không cần nhảy.
      // (Giữ listener rỗng để tương thích emitter cũ ở WorkflowList; có thể gỡ hẳn ở Phase 7.)
      window.eventBus.on('workflow:run_started', () => { /* no-op: xem ghi chú trên */ });

      // Listen for execution events to update UI.
      // [API SPAM FIX — Phase 3.1] Dùng _debouncedLoadWorkflows (1s coalesce) để tránh
      // cascade: 5-node workflow trigger execution:progress × 5 + node:completed × 5 +
      // execution:completed × 1 = 11 events → trước fix gọi loadWorkflows 11 lần →
      // sau fix coalesce thành 1 call sau 1s.
      // [Phase 1] started/completed = MEMBERSHIP đổi (idle→running card xuất hiện ở Flows; xong →
      // đổi trạng thái) → cho phép 1 lần refresh (coalesced). progress = tick THƯỜNG XUYÊN → KHÔNG
      // full-reload nữa (trước đây mỗi tick gọi _debouncedLoadWorkflows + rebuild toàn Flows pane
      // mỗi 500ms → giật + kích lại rerender ẩn bar). Giờ patch TARGETED từng card.
      window.eventBus.on('execution:started', () => {
        this.workflowList?._debouncedLoadWorkflows?.() || this.workflowList?.loadWorkflows();
        this._refreshFlowsIfActive();
      });
      window.eventBus.on('execution:progress', (data) => {
        // My Spaces tự patch qua listener riêng trong WorkflowList. Ở đây chỉ patch Flows card.
        this._patchFlowsCard(data);
      });
      window.eventBus.on('execution:completed', async (data) => {
        // Record trial run usage AFTER workflow completes successfully (not error/stopped)
        if (!data?.error && !data?.stopped && window.featureGate) {
          await window.featureGate.recordPendingWorkflowRun();
        }
        this.workflowList?._debouncedLoadWorkflows?.() || this.workflowList?.loadWorkflows();
        this._refreshFlowsIfActive();
      });

      // Listen for workflow reset (can come from popup editor)
      window.eventBus.on('workflow:reset', () => {
        this.workflowList?._debouncedLoadWorkflows?.() || this.workflowList?.loadWorkflows();
      });

      // Re-apply feature gate khi entitlements được load/refresh
      window.eventBus.on('featuregate:refreshed', () => {
        this._applySubtabFeatureGate(this._currentSubtab);
      });

      // Listen for node completed to update list immediately
      window.eventBus.on('node:completed', () => {
        this.workflowList?._debouncedLoadWorkflows?.() || this.workflowList?.loadWorkflows();
      });

      // Listen for subtab switch (e.g., from template import)
      window.eventBus.on('workflow:subtab_changed', (data) => {
        const subtab = data?.subtab;
        if (subtab && subtab !== this._currentSubtab) {
          this._switchSubtab(subtab);
        }
      });

      // Listen for workflow imported (refresh list)
      window.eventBus.on('workflow:imported', () => {
        this.workflowList?.loadWorkflows();
      });

      // [MCP] Workflow tạo từ AI agent (Claude) qua backend → refresh list để user thấy ngay.
      // create_workflow đi thẳng backend (không qua extension) nên cần SSE này để UI cập nhật.
      window.eventBus.on('sse:workflows_updated', (data) => {
        this.workflowList?._debouncedLoadWorkflows?.() || this.workflowList?.loadWorkflows?.();
        // Toast thoáng qua khi AI tạo/sửa workflow (backend gửi field `toast`). KHÔNG ghi
        // notification-center DB (info ephemeral → tránh rác). update_node KHÔNG gửi `toast`.
        if (data?.toast) window.showNotification?.(data.toast, 'info', 5000);
      });

      // [Creator Page] Cửa sổ template-editor (riêng) update community template → refresh subtab
      // "Template của tôi" nếu đang mở (badge trạng thái pending mới sau khi sửa nội dung).
      try {
        chrome.runtime.onMessage.addListener((msg) => {
          if (msg?.action === 'creatorTemplateUpdated' && this._currentSubtab === 'mytemplates') {
            this._loadMyTemplates();
          }
        });
      } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowTab#init', _); }
    }

    // Module-blocked-overlay được quản lý bởi app.js refreshModuleOverlays()

    // Landing = "My Spaces" (data-subtab 'workflows' = WorkflowList quản lý workflow). Luôn mở My Spaces
    // khi vào tab Spaces — có workflow thì hiện danh sách, chưa có thì hiện empty-state (CTA Tạo/Xem mẫu).
    try {
      this._switchSubtab('workflows');
    } catch (e) {
      console.warn('[WorkflowTab] Error landing on My Spaces:', e?.message);
      this._loadWorkflowTemplateList();
    }

    this.isInitialized = true;
    console.log('[WorkflowTab] Initialized');
  }


  async openEditor(mode = 'create', workflow = null) {
    // Open workflow editor in a separate window, truyền project context
    console.log('[WorkflowTab] openEditor called, mode:', mode, 'wfId:', workflow?.wf_id);

    // Gate: Flow project phải SẴN SÀNG (đã mở project + KHÔNG ở trang lỗi/đã xoá).
    // Không mở editor khi project chưa sẵn sàng → mở modal chọn project ở sidebar.
    try {
      const ready = await window.ProjectHelper?.isFlowProjectReady?.();
      if (!ready) {
        console.warn('[WorkflowTab] openEditor bị chặn — Flow project chưa sẵn sàng (chưa mở project / project lỗi/đã xoá)');
        if (typeof window.showNotification === 'function') {
          window.showNotification(window.I18n?.t('workflow.projectNotReady') || 'Flow project chưa sẵn sàng. Hãy mở/chọn một project rồi thử lại.', 'warning');
        }
        if (typeof window._showProjectSelectOverlay === 'function') {
          window._showProjectSelectOverlay(true); // guideIfNoTab: user chủ động mở editor → hướng dẫn nếu chưa có Flow tab
        } else {
          window.ProjectHelper?.warnNoProjectForUpload?.(null);
        }
        return;
      }
    } catch (e) {
      // Lỗi check readiness → fail-open (tránh chặn oan khi ProjectHelper/background lỗi tạm thời)
      console.warn('[WorkflowTab] openEditor readiness check failed, fail-open:', e?.message);
    }

    chrome.runtime.sendMessage({
      action: 'openWorkflowEditor',
      data: {
        mode,
        workflow,
        projectId: window._currentProjectId || null,
        projectName: window._currentProjectName || null
      }
    }, (response) => {
      console.log('[WorkflowTab] openWorkflowEditor response:', response);
      // Background re-gate chặn (edge case race/fail-open sidebar) → báo + mở modal chọn project.
      if (response && response.ok === false && response.error === 'PROJECT_NOT_READY') {
        console.warn('[WorkflowTab] editor bị chặn ở background re-gate — Flow project chưa sẵn sàng');
        if (typeof window.showNotification === 'function') {
          window.showNotification(window.I18n?.t('workflow.projectNotReady') || 'Flow project chưa sẵn sàng. Hãy mở/chọn một project rồi thử lại.', 'warning');
        }
        if (typeof window._showProjectSelectOverlay === 'function') window._showProjectSelectOverlay(true);
      }
    });
  }

  async runWorkflow(workflow, manualSubmitMode = undefined) {
    if (!workflow?.wf_id) return;

    // Check run limit for workflow (applies to both anonymous and logged-in users)
    if (window.featureGate) {
      const quota = await window.featureGate.checkQuotaAsync('workflows_run_max');
      if (!quota.allowed) {
        const isLoggedIn = window.authManager?.isLoggedIn();
        if (isLoggedIn) {
          const limitText = quota.limit === 'unlimited' ? (window.I18n?.t('common.unlimited') || 'Unlimited') : `${quota.limit} ${window.I18n?.t('workflow.runsPerDay') || 'runs/day'}`;
          const shouldUpgrade = await window.customDialog?.confirm(
            window.I18n?.t('workflow.runQuotaExhausted', { limitText, used: quota.used }) || `Workflow runs exhausted today.\n\nLimit: ${limitText}\nUsed: ${quota.used} runs\n\nUpgrade plan to increase limit.`,
            { title: window.I18n?.t('workflow.runQuotaTitle') || 'Workflow runs exhausted', confirmText: window.I18n?.t('common.upgrade') || 'Upgrade', cancelText: window.I18n?.t('common.later') || 'Later' }
          );
          /* upgrade modal removed — local-first; confirm is now informational only */
          void shouldUpgrade;
        } else {
          window.featureGate.showLoginPrompt(window.I18n?.t('workflow.trialRunExhausted') || 'You have used all workflow runs in trial.');
        }
        return;
      }

      // GP-6.3 / GP-6.4: Check global quota warning/exhausted
      const quotaCheck = window.featureGate.checkGlobalQuotaWarning('Workflow');
      if (quotaCheck.exhausted) {
        return; // Dialog đã hiển thị bởi FeatureGate
      }
    }

    // Check if already running (local executor)
    if (window.workflowExecutor?.isRunning) {
      window.customDialog.alert(window.I18n?.t('workflow.alreadyRunning') || 'Another workflow is currently running. Please wait or stop it first.', { type: 'warning' });
      return;
    }

    // Cross-context check: verify no workflow is running in popup editor.
    // Gap 2 fix: dùng helper TTL-aware (auto-clear nếu flag stale >30 phút).
    try {
      const running = await window.WorkflowExecutor?.getCrossContextRunning?.();
      if (running?.wf_id) {
        const runningName = running.wf_name || 'Workflow';
        window.customDialog.alert(
          window.I18n?.t('workflow.anotherRunningCrossContext', { name: runningName }) ||
          `"${runningName}" đang chạy ở cửa sổ khác. Vui lòng đợi hoặc dừng trước.`,
          { type: 'warning' }
        );
        return;
      }
    } catch (e) {
      console.warn('[WorkflowTab] Cross-context running check failed:', e.message);
    }

    // Kiểm tra có node nào đã completed chưa → hỏi resume hay chạy lại
    const fullWorkflow = await window.storageManager?.getWorkflow(workflow.wf_id);
    const hasCompleted = fullWorkflow?.nodes?.some(n => n.status === 'completed');

    if (hasCompleted) {
      const choice = await window.customDialog.confirmResumeOrRerun(
        window.I18n?.t('workflow.resumeOrRerun', { name: workflow.wf_name }) || `Workflow "${workflow.wf_name}" có node đã hoàn thành.\nBấm "Tiếp tục" để chạy từ node chưa xong, hoặc "Chạy lại" để reset.`,
        { title: window.I18n?.t('workflow.resumeOrRerunTitle') || 'Tiếp tục hay chạy lại?' }
      );
      if (choice === null) return; // Hủy / X / ESC → không chạy gì
      if (choice === 'rerun') {
        // Chạy lại từ đầu → reset
        await window.workflowExecutor.reset(workflow.wf_id);
      }
    }

    console.log('[WorkflowTab] Running workflow:', workflow.wf_id);

    // Set flag to record trial run AFTER workflow completes successfully
    if (window.featureGate) {
      window.featureGate.setPendingWorkflowRun();
    }

    try {
      // Phase 5: truyền Manual Submit mode qua opts (set trong execute try → chống leak automated trigger).
      const result = await window.workflowExecutor.execute(workflow.wf_id, { manualSubmitMode: manualSubmitMode === true });
      // [Audit Bug 9 follow-up 2026-06-22] execute() return false khi pre-flight fail
      // (gate denied, plan fetch fail, ExecutionGate abort). Cần show toast để casual user
      // thấy ngay vì error chỉ ở log panel — không có alert.
      if (result === false) {
        console.warn('[WorkflowTab] Workflow execution aborted before start');
        const msg = window.I18n?.t('workflow.executionAborted')
          || 'Không thể khởi chạy workflow. Vui lòng kiểm tra log để biết chi tiết.';
        if (window.showNotification) {
          window.showNotification(msg, 'error');
        }
      }
    } catch (error) {
      console.error('[WorkflowTab] Workflow execution failed:', error);
      window.customDialog.alert((window.I18n?.t('workflow.executionError') || 'Lỗi khi chạy workflow') + ': ' + error.message, { type: 'error' });
    }
  }

  destroy() {
    this.isInitialized = false;
  }

  /**
   * Render sub-tabs UI (Workflows / Templates)
   */
  _renderSubtabs() {
    const t = (key) => window.I18n?.t(key) || key;

    // Check if sub-tabs already exist
    if (this.container.querySelector('.seosonaflow-workflow-subtabs')) {
      return;
    }

    // Get existing workflowListSection from DOM
    const existingSection = this.container.querySelector('#workflowListSection');

    // Create sub-tabs HTML (with icons matching prompts-subtab style)
    const subtabsHtml = `
      <div class="seosonaflow-workflow-subtabs">
        <button class="seosonaflow-workflow-subtab" data-subtab="templates" style="order:3">
          <svg width="18" height="18" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" data-testid="center-icon"><path d="M4.918 6.763c0-.943.764-1.707 1.707-1.707h2.463c.943 0 1.707.764 1.707 1.707v2.463c0 .943-.764 1.707-1.707 1.707H6.625a1.707 1.707 0 0 1-1.707-1.707zm1.708-.244a.244.244 0 0 0-.244.244v2.463c0 .135.109.244.244.244h2.463a.244.244 0 0 0 .244-.244V6.763a.244.244 0 0 0-.244-.244zm0 6.547c-.943 0-1.707.764-1.707 1.707v2.463c0 .943.764 1.707 1.707 1.707h2.463c.943 0 1.707-.764 1.707-1.707v-2.463c0-.943-.764-1.707-1.707-1.707zm-.244 1.708c0-.135.109-.244.244-.244h2.463c.135 0 .244.109.244.244v2.463a.244.244 0 0 1-.244.244H6.626a.244.244 0 0 1-.244-.244zm6.276-8.487c0-.404.328-.732.732-.732h4.878a.732.732 0 0 1 0 1.464H13.39a.73.73 0 0 1-.732-.732m.732 7.279a.732.732 0 0 0 0 1.464h4.878a.732.732 0 0 0 0-1.464zm-.732-3.864c0-.404.328-.732.732-.732h4.878a.732.732 0 0 1 0 1.464H13.39a.73.73 0 0 1-.732-.732m.732 7.279a.732.732 0 0 0 0 1.464h4.878a.732.732 0 0 0 0-1.464z"></path><path d="M2.004 6.634A4.634 4.634 0 0 1 6.638 2H17.37a4.634 4.634 0 0 1 4.634 4.634v10.732A4.634 4.634 0 0 1 17.37 22H6.638a4.634 4.634 0 0 1-4.634-4.634zm4.634-3.171a3.17 3.17 0 0 0-3.171 3.171v10.732a3.17 3.17 0 0 0 3.17 3.171H17.37a3.17 3.17 0 0 0 3.17-3.171V6.634a3.17 3.17 0 0 0-3.17-3.171z"></path></svg>
          <span>${t('workflow.subtabTemplates')}</span>
        </button>
        <!-- HOÁN VAI (2026-07-22): data-subtab='workflows' (WorkflowList quản lý đầy đủ) = "My Spaces".
             Giữ khoá 'workflows' để không gãy 26+ ref; chỉ đổi nhãn+icon+order. Icon card (spaces). -->
        <button class="seosonaflow-workflow-subtab active" data-subtab="workflows" style="order:1">
          <svg width="15" height="15" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M13.5 6.188h-9c-1.813 0-2.812.999-2.812 2.812v5.25c0 1.814.999 2.813 2.812 2.813h9c1.813 0 2.813-1 2.813-2.813V9c0-1.814-1-2.812-2.813-2.812m1.688 8.062c0 1.183-.505 1.688-1.688 1.688h-9c-1.183 0-1.687-.505-1.687-1.688V9c0-1.183.504-1.687 1.687-1.687h9c1.183 0 1.688.504 1.688 1.687zM3.938 4.5c0-.31.251-.562.562-.562h9a.563.563 0 0 1 0 1.124h-9a.563.563 0 0 1-.562-.562m1.5-2.25c0-.31.252-.562.562-.562h6a.563.563 0 0 1 0 1.125H6a.563.563 0 0 1-.562-.563m5.792 8.336L8.869 9.141a1.27 1.27 0 0 0-1.93 1.08v2.809c0 .464.24.877.647 1.104a1.27 1.27 0 0 0 1.283-.025l2.36-1.444a1.21 1.21 0 0 0 .584-1.04 1.21 1.21 0 0 0-.583-1.039m-.588 1.118L8.28 13.15a.14.14 0 0 1-.146.003.14.14 0 0 1-.072-.123v-2.81c0-.067.04-.104.072-.123a.14.14 0 0 1 .072-.02q.033 0 .074.023l2.361 1.446h.001q.045.028.045.078a.09.09 0 0 1-.046.08"></path></svg>
          <span>${t('workflow.subtabMyTemplates') || 'My Spaces'}</span>
        </button>
        <!-- data-subtab='mytemplates' = "Flows". ẨN (QĐ-3): đã gộp vào My Spaces (hiện tất cả workflow)
             → bỏ subtab tách rời để hết tab trống khó hiểu. Giữ DOM+logic để không gãy ref, chỉ ẩn nút. -->
        <button class="seosonaflow-workflow-subtab hidden" data-subtab="mytemplates" style="order:2; display:none">
          <svg fill="currentColor" width="14" height="14" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M7.5,15.5h-5a1,1,0,0,0-1,1v5a1,1,0,0,0,1,1h5a1,1,0,0,0,1-1V20H12a1,1,0,0,0,0-2H8.5V16.5A1,1,0,0,0,7.5,15.5Zm-1,5h-3v-3h3ZM4,8.858V13a1,1,0,0,0,2,0V8.858a4,4,0,1,0-2,0ZM5,3A2,2,0,1,1,3,5,2,2,0,0,1,5,3ZM20,15.142V12a1,1,0,0,0-2,0v3.142a4,4,0,1,0,2,0ZM19,21a2,2,0,1,1,2-2A2,2,0,0,1,19,21ZM16.5,8.5h5a1,1,0,0,0,1-1v-5a1,1,0,0,0-1-1h-5a1,1,0,0,0-1,1V4H12a1,1,0,0,0,0,2h3.5V7.5A1,1,0,0,0,16.5,8.5Zm1-5h3v3h-3Z"></path></svg>
          <span>${t('workflow.subtabWorkflows') || 'Flows'}</span>
        </button>
        <button class="seosonaflow-workflow-subtab" data-subtab="shared" style="order:4">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
            <polyline points="16 6 12 2 8 6"/>
            <line x1="12" y1="2" x2="12" y2="15"/>
          </svg>
          <span>${t('workflow.subtabShared')}</span>
          <span class="seosonaflow-workflow-subtab-badge" data-shared-count style="display: none;">0</span>
        </button>
      </div>
      <div class="seosonaflow-workflow-content" data-content="templates" style="display: none; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;">
        <!-- WorkflowTemplateList content - lazy loaded -->
      </div>
      <div class="seosonaflow-workflow-content" data-content="workflows" style="display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;">
        <!-- WorkflowList content will be moved here -->
      </div>
      <div class="seosonaflow-workflow-content" data-content="shared" style="display: none; flex-direction: column; flex: 1; min-height: 0; overflow: hidden;">
        <!-- Shared workflows list — render bởi WorkflowList.renderSharedTab() -->
      </div>
      <div class="seosonaflow-workflow-content" data-content="mytemplates" style="display: none; flex-direction: column; flex: 1; min-height: 0; overflow: auto;">
        <!-- [Affiliate Creator Page] Template của tôi — render bởi MyTemplatesList.renderInto() -->
      </div>
    `;

    // Insert at the beginning of the container
    this.container.insertAdjacentHTML('afterbegin', subtabsHtml);

    // Move existing workflowListSection into the workflows content container
    if (existingSection) {
      const workflowsContent = this.container.querySelector('[data-content="workflows"]');
      if (workflowsContent) {
        workflowsContent.appendChild(existingSection);
      }
    }
  }

  /**
   * Bind click events for sub-tab buttons
   */
  _bindSubtabEvents() {
    const subtabBtns = this.container.querySelectorAll('.seosonaflow-workflow-subtab');
    subtabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const subtab = btn.dataset.subtab;
        if (!subtab) return;

        if (subtab === this._currentSubtab) {
          // Click on current tab → refresh data only
          this._refreshCurrentSubtab(subtab);
        } else {
          // Click on different tab → switch tab (which also loads data)
          this._switchSubtab(subtab);
        }
      });
    });
  }

  /**
   * Refresh data của current subtab khi click lại vào tab đang active
   * @param {string} subtab - 'workflows', 'templates', or 'shared'
   */
  _refreshCurrentSubtab(subtab) {
    console.log('[WorkflowTab] Refreshing current subtab:', subtab);

    // Check feature gate trước khi refresh
    const blocked = this._applySubtabFeatureGate(subtab);
    if (blocked) return;

    if (subtab === 'workflows') {
      // 2026-05-25: Dùng _debouncedLoadWorkflows để coalesce rapid tab switch.
      // Trước fix: user toggle templates/workflows nhanh → mỗi switch fire loadWorkflows ngay → 4-5 API call dư thừa.
      // Sau fix: 1s debounce coalesce thành 1 call sau khi user dừng switch.
      (this.workflowList?._debouncedLoadWorkflows?.() || this.workflowList?.loadWorkflows?.());
    } else if (subtab === 'templates') {
      this.workflowTemplateList?.loadTemplates?.();
    } else if (subtab === 'shared') {
      // Refresh Shared: load XONG rồi repaint (đồng bộ nhánh switch — trước chỉ load, UI không cập nhật).
      const sharedContent = this.container.querySelector('[data-content="shared"]');
      if (sharedContent && this.workflowList?.loadSharedWorkflows) {
        Promise.resolve(this.workflowList.loadSharedWorkflows())
          .then(() => this.workflowList.renderSharedTab?.(sharedContent)).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowTab#_refreshCurrentSubtab', _e); });
      }
    } else if (subtab === 'mytemplates') {
      this._loadMyTemplates();
    }
  }

  /**
   * Switch between Workflows and Templates sub-tabs
   * @param {string} subtab - 'workflows' or 'templates'
   */
  _switchSubtab(subtab) {
    console.log('[WorkflowTab] Switching to subtab:', subtab);

    // Toggle active class on buttons
    const subtabBtns = this.container.querySelectorAll('.seosonaflow-workflow-subtab');
    subtabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.subtab === subtab);
    });

    // Toggle display on content containers
    const contentPanes = this.container.querySelectorAll('.seosonaflow-workflow-content');
    contentPanes.forEach(pane => {
      const isActive = pane.dataset.content === subtab;
      pane.style.display = isActive ? 'flex' : 'none';
      if (isActive) {
        pane.style.flexDirection = 'column';
        pane.style.flex = '1';
        pane.style.minHeight = '0';
        pane.style.overflow = 'hidden';
      }
    });

    this._currentSubtab = subtab;

    // Emit event for other components to react
    if (window.eventBus) {
      window.eventBus.emit('workflow:subtab_changed', { subtab });
    }

    // Apply feature gate cho sub-tab — render overlay nếu user không có quyền.
    // Nếu blocked → KHÔNG load data (tránh gọi API thừa).
    const blocked = this._applySubtabFeatureGate(subtab);
    if (blocked) return;

    // Reload data của tab tương ứng mỗi lần switch để đảm bảo data mới nhất
    if (subtab === 'workflows') {
      this.workflowList?.loadWorkflows?.();
    } else if (subtab === 'templates') {
      // Lazy load lần đầu, sau đó reload mỗi lần switch
      if (!this.workflowTemplateList) {
        this._loadWorkflowTemplateList();
      } else {
        this.workflowTemplateList._loadTemplates?.(false);
      }
    } else if (subtab === 'shared') {
      const sharedContent = this.container.querySelector('[data-content="shared"]');
      if (sharedContent && this.workflowList) {
        // Show skeleton while loading
        this.workflowList.showSharedLoadingSkeleton(sharedContent);
        this.workflowList.loadSharedWorkflows().then(() => {
          this.workflowList.renderSharedTab(sharedContent);
        });
      }
    } else if (subtab === 'mytemplates') {
      this._loadMyTemplates();
    }
  }

  /**
   * Re-render Flows (debounced) khi có event thực thi — để tiến độ/trạng thái cập nhật live.
   * Chỉ khi tab Flows đang mở (tránh render thừa). ~500ms coalesce nhiều event progress.
   */
  _refreshFlowsIfActive() {
    if (this._currentSubtab !== 'mytemplates') return;
    clearTimeout(this._flowsRefreshTimer);
    this._flowsRefreshTimer = setTimeout(() => {
      if (this._currentSubtab !== 'mytemplates') return;
      const pane = this.container.querySelector('[data-content="mytemplates"]');
      // Tránh nhảy con trỏ / đóng menu: bỏ qua refresh khi user đang gõ ô tìm hoặc menu ⋯ đang mở.
      if (pane) {
        const si = pane.querySelector('.sf-search-input');
        if (si && si === document.activeElement) return;
        if (pane.querySelector('.ms-space-menu:not(.hidden)')) return;
      }
      try { this._loadMyTemplates(); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowTab#_refreshFlowsIfActive', _); }
    }, 500);
  }

  /**
   * [Phase 4] Nhãn trạng thái Flows — DÙNG CHUNG key i18n với My Spaces (_renderStatusLabel) →
   * cùng trạng thái = cùng chữ ở mọi tab, đổi locale EN/VI đồng bộ (hết hardcode tiếng Việt).
   */
  _flowStatusLabel(status) {
    const I = window.I18n;
    const s = status || 'idle';
    const map = {
      idle: () => I?.t('workflow.statusIdle') || 'Sẵn sàng',
      running: () => I?.t('workflow.statusRunning') || 'Đang chạy',
      completed: () => I?.t('workflow.statusCompleted') || 'Hoàn tất',
      failed: () => I?.t('workflow.statusFailed') || 'Lỗi',
      error: () => I?.t('workflow.statusFailed') || 'Lỗi',
      stopped: () => I?.t('workflow.statusStopped') || 'Đã dừng',
      pending: () => I?.t('workflow.statusPending') || 'Chờ',
    };
    return (map[s] || (() => s))();
  }

  /**
   * [Phase 1] Patch TARGETED 1 card Flows theo tick execution:progress — cập nhật nhãn trạng thái,
   * %, thanh progress tại chỗ; KHÔNG rebuild toàn pane (hết giật + hết đánh nhau rerender).
   * Nếu card chưa tồn tại (idle→running lần đầu → chưa nằm trong danh sách Flows) → fallback 1 lần
   * refresh để card xuất hiện; các tick sau patch tại chỗ.
   */
  _patchFlowsCard(data) {
    if (this._currentSubtab !== 'mytemplates') return;
    const wfId = data?.wfId || data?.current?.wf_id;
    if (!wfId) return;
    const pane = this.container.querySelector('[data-content="mytemplates"]');
    if (!pane) return;
    let card = null;
    try { card = pane.querySelector(`.ms-space-card[data-wf-id="${CSS.escape(String(wfId))}"]`); } catch (_) { card = null; }
    if (!card) { this._refreshFlowsIfActive(); return; }
    const total = Number(data?.total) || 0;
    const completed = Number(data?.completed) || 0;
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    // status → running (đổi class ms-status-*)
    card.className = card.className.replace(/\bms-status-[\w-]+/g, '').replace(/\s+/g, ' ').trim() + ' ms-status-running';
    const label = card.querySelector('.ms-space-status-label');
    if (label) label.textContent = this._flowStatusLabel('running');
    const sep = card.querySelector('.ms-space-pct-sep');
    if (sep) sep.style.display = '';
    const pctEl = card.querySelector('.ms-space-pct');
    if (pctEl) pctEl.textContent = `${pct}%`;
    const prog = card.querySelector('.ms-space-progress');
    if (prog) prog.style.display = '';
    const bar = card.querySelector('.ms-space-progress-bar');
    if (bar) bar.style.width = `${pct}%`;
  }

  /**
   * [Phase 5] Chạy tuần tự 1 danh sách workflow ở Flows — await executor.execute từng cái (mirror
   * My Spaces runAllWorkflows, bỏ preflight per-item để không chồng modal). Cờ _flowsRunningAll chặn
   * double-trigger; dừng nếu executor.shouldStop.
   */
  async _flowsRunAllSequential(items) {
    if (this._flowsRunningAll) return;
    this._flowsRunningAll = true;
    const t = (k, fb) => window.I18n?.t(k) || fb;
    let ran = 0;
    try {
      for (const w of items) {
        const id = w && (w.wf_id || w.id);
        if (!id) continue;
        if (window.workflowExecutor?.shouldStop) break;
        try {
          if (window.workflowExecutor?.execute) { await window.workflowExecutor.execute(id); ran++; }
        } catch (e) { console.warn('[Flows] run-all item fail:', id, e?.message); }
      }
      try { window.showNotification?.(t('workflow.runAllDone', 'Đã chạy xong') + (ran ? ` (${ran})` : ''), 'success', 2500); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowTab#t', _); }
    } finally {
      this._flowsRunningAll = false;
    }
  }

  /**
   * "Flows" (data-subtab `mytemplates`) — NƠI CHẠY workflow: danh sách workflow ở chế độ chạy,
   * hiện tên (wf_name) + số node ĐÚNG (đếm từ af_nodes) + trạng thái + tiến độ; Chạy/Dừng/Mở tại chỗ.
   * Local-first, tái dùng workflowList.runWorkflow/stopWorkflow/_openWorkflow — KHÔNG engine mới.
   */
  _loadMyTemplates() {
    const pane = this.container.querySelector('[data-content="mytemplates"]');
    if (!pane) return;
    const t = (k, fb) => window.I18n?.t(k) || fb;
    const esc = (s) => { const d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; };

    // [Phase 4] Nhãn filter status = i18n (dùng chung _flowStatusLabel → đồng bộ locale + My Spaces).
    const STATUS = {
      idle: this._flowStatusLabel('idle'),
      running: this._flowStatusLabel('running'),
      completed: this._flowStatusLabel('completed'),
      failed: this._flowStatusLabel('failed'),
      stopped: this._flowStatusLabel('stopped'),
      pending: this._flowStatusLabel('pending'),
    };
    const nodeCountOf = (w, countByWf) => {
      const id = w.wf_id || w.id;
      if (Array.isArray(w.nodes) && w.nodes.length) return w.nodes.length;
      if (countByWf && countByWf[id] != null) return countByWf[id];
      return w.progress_total || 0;
    };

    const cardHtml = (w, countByWf) => {
      const id = esc(w.wf_id || w.id || '');
      const name = esc(w.wf_name || w.name || w.workflow_name || t('workflow.unnamed', 'Workflow không tên'));
      const nodeCount = nodeCountOf(w, countByWf);
      const status = w.status || 'idle';
      const isRunning = status === 'running';
      const total = w.progress_total || nodeCount || 0;
      const done = w.progress_completed || 0;
      const pct = isRunning && total > 0 ? Math.round((done / total) * 100) : (status === 'completed' ? 100 : 0);
      const statusLabel = this._flowStatusLabel(status);
      // [Phase 1] Meta dùng span target được (.ms-space-status-label / .ms-space-pct) + progress bar
      // LUÔN tồn tại (ẩn khi không chạy) → _patchFlowsCard cập nhật tại chỗ, KHÔNG rebuild toàn pane.
      return `
        <div class="ms-space-card ms-status-${esc(status)}" data-wf-id="${id}" data-node-count="${nodeCount}">
          <div class="ms-space-info">
            <div class="ms-space-name" title="${name}">${name}</div>
            <div class="ms-space-meta"><span class="ms-space-status-dot"></span><span class="ms-space-status-label">${esc(statusLabel)}</span> · <span class="ms-space-nodecount">${nodeCount}</span> node<span class="ms-space-pct-sep"${isRunning ? '' : ' style="display:none"'}> · <span class="ms-space-pct">${pct}%</span></span></div>
            <div class="ms-space-progress"${isRunning ? '' : ' style="display:none"'}><div class="ms-space-progress-bar" style="width:${pct}%"></div></div>
          </div>
          <div class="ms-space-actions">
            ${isRunning
              ? `<button class="ms-space-stop" data-wf-id="${id}">■ ${t('workflow.stopBtn', 'Dừng')}</button>`
              : `<button class="ms-space-run" data-wf-id="${id}">▶ ${t('workflow.runBtn', 'Chạy')}</button>`}
            <div class="ms-space-menu-wrap">
              <button class="ms-space-menu-btn" data-wf-id="${id}" title="${esc(t('common.more', 'Thêm'))}" aria-label="Menu">⋯</button>
              <div class="ms-space-menu hidden">
                <button class="ms-space-open" data-wf-id="${id}">${t('common.open', 'Mở')}</button>
                <button class="ms-space-clone" data-wf-id="${id}">${t('workflow.duplicate', 'Nhân bản')}</button>
                <button class="ms-space-tospaces" data-wf-id="${id}">${esc(t('workflow.toMySpaces', 'Lưu về My Spaces'))}</button>
                <button class="ms-space-delete ms-menu-danger" data-wf-id="${id}">${t('common.delete', 'Xóa')}</button>
              </div>
            </div>
          </div>
        </div>`;
    };

    const render = (wfs, countByWf) => {
      const list = Array.isArray(wfs) ? wfs : [];
      const q0 = this._flowsSearchQuery || '';
      const s0 = this._flowsStatusFilter || '';
      // Filter kết hợp search + status (đồng bộ pattern Templates: search-box + select).
      const applyFilter = (arr) => arr.filter((w) => {
        const okText = !(this._flowsSearchQuery) || String(w.wf_name || w.name || w.workflow_name || '').toLowerCase().includes(this._flowsSearchQuery);
        const okStatus = !(this._flowsStatusFilter) || (w.status || 'idle') === this._flowsStatusFilter;
        // [Phase 3 — copy-isolation] Flows = tập CURATED: chỉ hiện BẢN COPY độc lập (flow_kind==='flow')
        // tạo qua "Đưa vào Flows". Bản gốc ở My Spaces (flow_kind!=='flow') KHÔNG hiện ở đây → sửa/xóa/
        // chạy bản Flows hoàn toàn tách khỏi My Spaces.
        const okKind = w.flow_kind === 'flow';
        return okText && okStatus && okKind;
      });
      const emptyMatch = `<div class="ms-spaces-empty">${t('workflow.mySpacesNoMatch', 'Không có workflow khớp.')}</div>`;

      // Toolbar GIỐNG HỆT Templates (wf-template-search-row + wf-search-input + wf-category-select + count-badge).
      pane.innerHTML = `
        <div class="ms-spaces">
          <div class="wf-template-search-row sf-toolbar">
            <div class="sf-search-box">
              <svg class="sf-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input type="text" class="sf-search-input" value="${esc(q0)}" placeholder="${esc(t('workflow.mySpacesSearch', 'Tìm workflow…'))}">
            </div>
            <button class="btn btn-secondary btn-sm btn-toolbar-icon sf-reload-btn" data-i18n-title="workflow.reload" title="Tải lại">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            </button>
            <select class="sf-filter-select compact-select">
              <option value=""${!s0 ? ' selected' : ''}>${t('workflow.allStatuses', 'Tất cả')}</option>
              <option value="running"${s0 === 'running' ? ' selected' : ''}>${STATUS.running}</option>
              <option value="idle"${s0 === 'idle' ? ' selected' : ''}>${STATUS.idle}</option>
              <option value="completed"${s0 === 'completed' ? ' selected' : ''}>${STATUS.completed}</option>
              <option value="failed"${s0 === 'failed' ? ' selected' : ''}>${STATUS.failed}</option>
              <option value="stopped"${s0 === 'stopped' ? ' selected' : ''}>${STATUS.stopped}</option>
            </select>
            <div class="sf-spacer"></div>
            <div class="wf-template-count-badge"></div>
            ${list.length ? `
            <label class="sf-runall-toggle" title="${esc(t('workflow.runAllToggle', 'Bật để cho phép Chạy tất cả'))}">
              <input type="checkbox" class="sf-runall-check"${this._flowsRunAllEnabled ? ' checked' : ''}>
              <span class="sf-runall-slider"></span>
            </label>
            <button class="ms-spaces-run-all"${this._flowsRunAllEnabled ? '' : ' disabled'}><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg><span class="btn-text-runall">${t('workflow.runAll', 'Chạy tất cả')}</span></button>` : ''}
          </div>
          ${!list.length
            ? `<div class="ms-spaces-empty">${t('workflow.flowsEmpty', 'Chưa có workflow. Dùng một mẫu ở Templates hoặc tạo ở My Spaces, rồi bấm Chạy.')}</div>`
            : `<div class="ms-spaces-grid"></div>`}
        </div>`;

      const badge = pane.querySelector('.wf-template-count-badge');
      const updateGrid = () => {
        const grid = pane.querySelector('.ms-spaces-grid');
        if (!grid) { if (badge) badge.innerHTML = `<strong>0</strong> workflow`; return; }
        const f = applyFilter(list);
        grid.innerHTML = f.length ? f.map((w) => cardHtml(w, countByWf)).join('') : emptyMatch;
        if (badge) badge.innerHTML = `<strong>${f.length}</strong> workflow`;
      };
      updateGrid();

      const searchInput = pane.querySelector('.sf-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          this._flowsSearchQuery = (e.target.value || '').toLowerCase().trim();
          updateGrid();
        });
        if (q0) { try { searchInput.focus(); searchInput.setSelectionRange(q0.length, q0.length); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowTab#updateGrid', _); } }
      }
      const statusSelect = pane.querySelector('.sf-filter-select');
      if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
          this._flowsStatusFilter = e.target.value || '';
          updateGrid();
        });
      }

      const notify = (m, ty) => { try { window.showNotification?.(m, ty || 'success', 2000); } catch (_) { globalThis.SEOSONA_swallow?.('WorkflowTab#notify', _); } };

      const reloadBtn = pane.querySelector('.sf-reload-btn');
      if (reloadBtn) {
        reloadBtn.addEventListener('click', () => {
          // [Phase 2] Reload có phản hồi: nạp lại danh sách + re-render Flows + toast.
          Promise.resolve(this.workflowList?.loadWorkflows?.()).then(() => this._loadMyTemplates()).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowTab#onclick', _e); });
          notify(t('workflow.reloaded', 'Đã tải lại'), 'info');
        });
      }
      const closeMenus = () => pane.querySelectorAll('.ms-space-menu').forEach((m) => m.classList.add('hidden'));

      pane.onclick = (e) => {
        const menuBtn = e.target.closest('.ms-space-menu-btn');
        if (menuBtn) {
          // Toggle ⋯ menu của card này, đóng các menu khác.
          const menu = menuBtn.parentElement?.querySelector('.ms-space-menu');
          const willOpen = menu && menu.classList.contains('hidden');
          closeMenus();
          if (willOpen) menu.classList.remove('hidden');
          return;
        }
        closeMenus(); // click bất kỳ chỗ khác → đóng menu đang mở

        const openBtn = e.target.closest('.ms-space-open');
        const cloneBtn = e.target.closest('.ms-space-clone');
        const toSpacesBtn = e.target.closest('.ms-space-tospaces');
        const delBtn = e.target.closest('.ms-space-delete');
        const runBtn = e.target.closest('.ms-space-run');
        const stopBtn = e.target.closest('.ms-space-stop');
        const runAllBtn = e.target.closest('.ms-spaces-run-all');
        if (openBtn) {
          const id = openBtn.dataset.wfId;
          if (id && this.workflowList?._openWorkflow) {
            notify(t('workflow.opening', 'Đang mở…'), 'info'); // [Phase 2] phản hồi ngay (editor mở ở cửa sổ riêng)
            this.workflowList._openWorkflow(id);
          }
        } else if (cloneBtn) {
          const id = cloneBtn.dataset.wfId;
          if (id && this.workflowList?.cloneWorkflow) {
            Promise.resolve(this.workflowList.cloneWorkflow(id))
              .then(() => { notify(t('workflow.duplicated', 'Đã nhân bản')); return this.workflowList?.loadWorkflows?.(); })
              .then(() => this._loadMyTemplates()).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowTab#onclick', _e); });
          }
        } else if (toSpacesBtn) {
          // [Phase 3 — copy-isolation] "Đưa về My Spaces" = COPY bản Flows thành record MỚI ở My Spaces
          // (flow_kind='space'). GIỮ bản Flows (không xoá) → dùng làm template cá nhân. Bản mới độc lập.
          const id = toSpacesBtn.dataset.wfId;
          if (id && this.workflowList?.copyWorkflowRecord) {
            this.workflowList.copyWorkflowRecord(id, { flow_kind: 'space', source_wf_id: null })
              .then((newId) => { if (newId) notify(t('workflow.savedToMySpaces', 'Đã lưu về My Spaces')); return this.workflowList?.loadWorkflows?.(); })
              .then(() => this._loadMyTemplates()).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowTab#onclick', _e); });
          }
        } else if (delBtn) {
          const id = delBtn.dataset.wfId;
          if (id && this.workflowList?.deleteWorkflow) {
            Promise.resolve(this.workflowList.deleteWorkflow(id)).then(() => this._loadMyTemplates()).catch(function (_e) { globalThis.SEOSONA_swallow?.('WorkflowTab#onclick', _e); });
          }
        } else if (runBtn) {
          const id = runBtn.dataset.wfId;
          if (!id) return;
          // [Phase 2] "Đang chuẩn bị…" (chính xác hơn "Đang chạy…" vì còn qua preflight; nếu user
          // huỷ preflight thì không hiểu nhầm là đã chạy). Trạng thái running thật do event cập nhật.
          notify(t('workflow.preparingRun', 'Đang chuẩn bị chạy…'), 'info');
          if (this.workflowList?.runWorkflow) this.workflowList.runWorkflow(id);
          else if (window.workflowExecutor?.execute) window.workflowExecutor.execute(id);
        } else if (stopBtn) {
          const id = stopBtn.dataset.wfId;
          if (id && this.workflowList?.stopWorkflow) { this.workflowList.stopWorkflow(id); notify(t('workflow.stopping', 'Đang dừng…'), 'info'); }
        } else if (runAllBtn) {
          if (!this._flowsRunAllEnabled) { notify(t('workflow.runAllDisabled', 'Bật công tắc "Chạy tất cả" trước.'), 'warning'); return; }
          // [Phase 5] Chạy các item ĐANG HIỆN ở Flows (đã qua filter) — TUẦN TỰ (mirror My Spaces
          // runAllWorkflows). Trước đây forEach song song → mỗi runWorkflow mở 1 preflight modal →
          // N modal chồng + executor.isRunning guard reject hết trừ cái đầu. Giờ await execute từng cái.
          const items = applyFilter(list).filter((w) => (w.status || 'idle') !== 'running');
          if (!items.length) { notify(t('workflow.mySpacesNoMatch', 'Không có workflow để chạy.'), 'info'); return; }
          if (this._flowsRunningAll) { notify(t('workflow.runningAll', 'Đang chạy tất cả…'), 'info'); return; }
          notify(t('workflow.runningAll', 'Đang chạy tất cả…'));
          this._flowsRunAllSequential(items);
        }
      };

      // Toggle on/off cho "Chạy tất cả" (mặc định off — tránh chạy nhầm hàng loạt).
      const runAllToggle = pane.querySelector('.sf-runall-check');
      if (runAllToggle) {
        runAllToggle.addEventListener('change', (ev) => {
          this._flowsRunAllEnabled = !!ev.target.checked;
          const btn = pane.querySelector('.ms-spaces-run-all');
          if (btn) btn.disabled = !this._flowsRunAllEnabled;
        });
      }

      // Đóng ⋯ menu khi click NGOÀI pane Flows. Gỡ listener cũ trước khi gắn → không rò rỉ qua re-render.
      if (this._flowsDocClick) document.removeEventListener('click', this._flowsDocClick);
      this._flowsDocClick = (ev) => {
        if (pane && !pane.contains(ev.target)) pane.querySelectorAll('.ms-space-menu').forEach((m) => m.classList.add('hidden'));
      };
      document.addEventListener('click', this._flowsDocClick);
    };

    // FIX E2: base = storage af_workflows (ĐẦY ĐỦ — in-mem WorkflowList bị phân trang 20/trang nên
    // >20 workflow sẽ desync). Overlay status/progress LIVE từ in-mem theo wf_id. + af_nodes để ĐẾM NODE.
    const inMem = Array.isArray(this.workflowList?.workflows) ? this.workflowList.workflows : [];
    const liveById = {};
    inMem.forEach((w) => { const id = w && (w.wf_id || w.id); if (id) liveById[id] = w; });
    const overlay = (arr) => arr.map((w) => {
      const id = w && (w.wf_id || w.id); const live = id && liveById[id];
      return live ? Object.assign({}, w, { status: live.status, progress_total: live.progress_total, progress_completed: live.progress_completed }) : w;
    });
    try {
      chrome.storage.local.get(['af_workflows', 'af_nodes'], (st) => {
        const stored = Array.isArray(st.af_workflows) ? st.af_workflows : [];
        const wfs = overlay(stored.length ? stored : inMem);
        const nodes = Array.isArray(st.af_nodes) ? st.af_nodes : [];
        const countByWf = {};
        nodes.forEach((n) => { const id = n && n.wf_id; if (id) countByWf[id] = (countByWf[id] || 0) + 1; });
        render(wfs, countByWf);
      });
    } catch (_) { render(inMem, {}); }
  }

  /**
   * Render overlay block tab nếu user không có quyền sub-tab tương ứng.
   * Map:
   *   - tab "workflows" + "shared" → workflows_enabled
   *   - tab "templates" → workflow_templates_enabled
   *
   * Guest → overlay với button Login.
   * Logged-in plan thấp → overlay với button Upgrade.
   *
   * @param {string} subtab
   * @returns {boolean} true nếu đã render overlay (sub-tab bị block)
   */
  _applySubtabFeatureGate(subtab) {
    // [Affiliate Creator Page] "Template của tôi" gate bằng affiliate active (subtab chỉ hiện khi
    // eligible) — KHÔNG gate theo feature workflows_enabled.
    if (subtab === 'mytemplates') return false;
    const featureKey = (subtab === 'templates')
      ? 'workflow_templates_enabled'
      : 'workflows_enabled';
    const fg = window.featureGate;
    const pane = this.container.querySelector(`[data-content="${subtab}"]`);
    if (!pane) return false;

    // Xóa overlay cũ nếu có
    const oldOverlay = pane.querySelector('.wf-subtab-blocked-overlay');
    if (oldOverlay) oldOverlay.remove();

    if (!fg || fg.canUse(featureKey)) {
      pane.classList.remove('wf-subtab-blocked');
      return false; // allowed
    }

    // Render overlay
    const isLoggedIn = !!window.authManager?.isLoggedIn?.();
    const t = (key, fallback) => window.I18n?.t(key) || fallback;

    const moduleNameMap = {
      workflows_enabled: t('workflow.title', 'Workflow'),
      workflow_templates_enabled: t('workflow.subtabTemplates', 'Templates'),
    };
    const moduleName = moduleNameMap[featureKey] || 'Tính năng';

    const title = isLoggedIn
      ? t('featuregate.featureLockedTitle', 'Tính năng bị khóa')
      : t('featuregate.loginRequiredTitle', 'Yêu cầu đăng nhập');

    const message = isLoggedIn
      ? t('featuregate.featureLockedPaid', `Gói hiện tại của bạn không bao gồm ${moduleName}. Vui lòng nâng cấp để sử dụng.`)
          .replace('{module}', moduleName)
      : t('featuregate.loginRequiredFeature', `Tính năng ${moduleName} yêu cầu đăng nhập.`)
          .replace('{module}', moduleName);

    const ctaLabel = isLoggedIn
      ? t('common.upgrade', 'Nâng cấp')
      : t('auth.login', 'Đăng nhập');

    pane.classList.add('wf-subtab-blocked');
    const ctaBtnClass = isLoggedIn ? 'wf-subtab-blocked-cta wf-subtab-blocked-cta--upgrade' : 'wf-subtab-blocked-cta';
    const overlayHtml = `
      <div class="wf-subtab-blocked-overlay">
        <div class="wf-subtab-blocked-card">
          <svg class="wf-subtab-blocked-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <h3 class="wf-subtab-blocked-title">${this._escapeHtml(title)}</h3>
          <p class="wf-subtab-blocked-msg">${this._escapeHtml(message)}</p>
          <button class="${ctaBtnClass}" data-action="${isLoggedIn ? 'upgrade' : 'login'}">
            ${this._escapeHtml(ctaLabel)}
          </button>
        </div>
      </div>
    `;
    pane.insertAdjacentHTML('afterbegin', overlayHtml);

    // Bind CTA click
    const ctaBtn = pane.querySelector('.wf-subtab-blocked-cta');
    ctaBtn?.addEventListener('click', () => {
      if (isLoggedIn) {
        try { chrome.runtime.sendMessage({ action: 'showUpgradeModal' }); } catch (e) { globalThis.SEOSONA_swallow?.('WorkflowTab#t', e); }
      }
      // not-logged-in branch removed — loginOverlay no longer exists (local-first)
    });

    return true; // blocked
  }

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = String(str ?? '');
    return div.innerHTML;
  }

  /**
   * Lazy load WorkflowTemplateList component
   */
  _loadWorkflowTemplateList() {
    const templatesContent = this.container.querySelector('[data-content="templates"]');
    if (!templatesContent) return;

    // [Phase 7] Guard idempotent: đã có instance → chỉ reload data, KHÔNG new lại (mỗi lần new đăng ký
    // thêm listener i18n/auth/featuregate không được gỡ → rò rỉ + fire trùng). Chặn double-construct.
    if (this.workflowTemplateList) {
      this.workflowTemplateList._loadTemplates?.(false);
      return;
    }

    // Check if WorkflowTemplateList class exists (sẽ được implement sau)
    if (typeof window.WorkflowTemplateList === 'function') {
      this.workflowTemplateList = new window.WorkflowTemplateList(templatesContent);
      window.workflowTemplateList = this.workflowTemplateList;
      console.log('[WorkflowTab] WorkflowTemplateList loaded');
    } else {
      // Placeholder message when WorkflowTemplateList is not yet implemented
      templatesContent.innerHTML = `
        <div class="workflow-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/>
            <rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/>
            <rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
          <p>${window.I18n?.t('workflow.templatesComingSoon') || 'Workflow Templates sẽ sớm ra mắt'}</p>
        </div>
      `;
    }
  }
}

// Export
window.WorkflowTab = WorkflowTab;
