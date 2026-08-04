/**
 * TaskList - Hiển thị danh sách tasks
 */
class TaskList {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    this.tasks = [];
    this.selectedTasks = new Set();
    this.searchQuery = '';
    this.runMode = 'parallel'; // 'parallel' | 'sequential'
    this.isRunningAll = false;
    this.shouldStopAll = false;
    this._filterProjectId = null; // null = show all, '__legacy__' = no project_id
    this._projectNames = {};
    // Server-side pagination
    this._pageSize = 20;
    this._currentPage = 1;
    this._lastPage = 1;
    this._total = 0;
    this._loading = false;
    // [API SPAM FIX] Tracking để tránh full reload khi đang chạy tasks
    this._lastUpdatedTaskId = null;
    this._executionCooldown = false;

    this.init();
  }

  init() {
    this.render();
    this.bindEvents();
    this._setupEventDelegation();
    this._initialLoad = true;
    this.loadTasks();

    // Listen for task status changes from executor
    if (window.eventBus) {
      window.eventBus.on('task:status_changed', async (data) => {
        // Record trial run usage AFTER first task completes successfully
        if (data.status === 'completed' && window.featureGate) {
          await window.featureGate.recordPendingTaskRun();
        }

        // [API SPAM FIX] Thay vì loadTasks() full reload, merge event data vào cache và single update
        if (data.taskId && Array.isArray(this.tasks)) {
          this._lastUpdatedTaskId = data.taskId;
          const taskIdx = this.tasks.findIndex(t => t.task_id === data.taskId);
          if (taskIdx >= 0) {
            const cached = this.tasks[taskIdx];
            // Override status từ event (source of truth)
            if (data.status) {
              cached.status = data.status;
            }
            // Restore result_file_ids nếu event có
            if (data.result_file_ids) {
              cached.result_file_ids = data.result_file_ids;
            }
            // Restore result_thumbnails — convert array → object map nếu cần
            if (Array.isArray(data.result_thumbnails) && data.result_thumbnails.length > 0) {
              const thumbsMap = {};
              const ids = (data.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
              ids.forEach((id, idx) => {
                if (data.result_thumbnails[idx]) {
                  thumbsMap[id] = data.result_thumbnails[idx];
                }
              });
              if (Object.keys(thumbsMap).length > 0) {
                cached.result_thumbnails = thumbsMap;
              }
            }
            // Update card UI trực tiếp (không full reload)
            this._updateCardRunningState(data.taskId, data.status === 'running', data.status);
            this._debouncedUpdateSingleTask(data.taskId);
          } else {
            // Task không có trong cache, dùng debounced load
            this._debouncedLoadTasks();
          }
        } else {
          // Fallback nếu không có taskId
          this._debouncedLoadTasks();
        }
      });
      // Pipeline task progress: update progress bar on card without full reload
      window.eventBus.on('task:progress', (data) => {
        if (data.taskId) this._lastUpdatedTaskId = data.taskId;
        this._updateTaskProgress(data.taskId, data.completed, data.total);
      });
      window.eventBus.on('tasks:batch_complete', () => {
        this._resetRunAllButton();
        // [API SPAM FIX] Cooldown 5s sau batch complete để skip full reload từ events trễ
        this._executionCooldown = true;
        setTimeout(() => { this._executionCooldown = false; }, 5000);
        // Clear tracking sau 2s
        setTimeout(() => { this._lastUpdatedTaskId = null; }, 2000);
      });
      // Re-enable button sớm khi tất cả tasks đã submit (parallel mode)
      window.eventBus.on('tasks:all_submitted', () => {
        this._resetRunAllButton();
      });
      // ExecutionLock: disable run buttons khi tác vụ khác đang chạy
      window.eventBus.on('execution:lock_changed', (state) => {
        this._updateLockState(state);
      });
      // U-4.2: Re-render khi chuyển project
      window.eventBus.on('project:changed', () => {
        this.loadTasks();
      });
      // Reload tasks khi user login (data từ server)
      window.eventBus.on('auth:login', () => {
        this.loadTasks();
      });
      // Clear tasks khi user logout
      window.eventBus.on('auth:logout', () => {
        this.tasks = [];
        this._currentPage = 1;
        this.render();
        this.bindEvents();
        this._setupEventDelegation();
        this.renderTaskList();
      });
      // CRITICAL: auth:login fire TRƯỚC switchToApi() → loadTasks chạy trong
      // local mode (đã wipe sau reinstall) → empty. Listen mode_changed để reload
      // KHI storage thực sự switch sang api → fetch từ server.
      window.eventBus.on('storage:mode_changed', (data) => {
        if (data?.mode === 'api') this.loadTasks();
      });
      // Re-render khi đổi ngôn ngữ
      window.eventBus.on('i18n:changed', () => {
        this.render();
        this.bindEvents();
        this._setupEventDelegation();
        this.renderTaskList();
      });
      // Listen for storage events (bind once in init, not in bindEvents to avoid duplicates)
      // [API SPAM FIX] Dùng single update thay full reload khi có taskId
      window.eventBus.on('storage:task_saved', (data) => {
        const taskId = data?.taskId || data?.task_id;
        if (taskId) {
          this._debouncedUpdateSingleTask(taskId);
        } else {
          this._debouncedLoadTasks();
        }
      });
      window.eventBus.on('storage:task_deleted', () => this._debouncedLoadTasks());
    }
  }

  async loadTasks(append = false) {
    // [API SPAM FIX] Block full reload khi đang chạy tasks hoặc trong cooldown period
    // Tránh giật UI và API spam - chỉ cho phép single update
    if ((this.isRunningAll || this._executionCooldown) && this._lastUpdatedTaskId && !append) {
      console.log('[TaskList] BLOCKED loadTasks - running or cooldown');
      return;
    }

    if (this._loading) return;
    this._loading = true;

    try {
      // Show skeleton only on initial load
      if (!append) {
        this.showLoading();
        this._currentPage = 1;
      }

      // Defensive guard cho race condition auth:login → switchToApi
      if (true && window.storageManager?.getMode?.() === 'local') {
        try { await window.storageManager.switchToApi(); }
        catch (e) { console.warn('[TaskList] switchToApi failed:', e.message); }
      }

      if (window.storageManager) {
        const page = append ? this._currentPage + 1 : 1;
        const result = await window.storageManager.getTasks({
          page,
          per_page: this._pageSize
        });

        const newTasks = (Array.isArray(result?.data) ? result.data : []).filter(t => !t.platform || t.platform === 'flow');

        if (append) {
          this.tasks = [...this.tasks, ...newTasks];
        } else {
          this.tasks = newTasks;
        }

        // Update pagination state
        this._currentPage = result.meta?.current_page || page;
        this._lastPage = result.meta?.last_page || 1;
        this._total = result.meta?.total || this.tasks.length;

        console.log('[TaskList] Loaded page', this._currentPage, '/', this._lastPage, '- total:', this._total);
        await this._cacheProjectNames();

        // Reset stuck 'running' tasks chỉ khi khởi tạo lần đầu.
        // CHỈ reset nếu task đã ở status running > 15 phút (likely stuck do crash).
        // Nếu task đang chạy thật ở device khác → updated_at sẽ còn fresh → không reset oan.
        if (this._initialLoad && !append) {
          this._initialLoad = false;
          const STUCK_THRESHOLD_MS = 15 * 60 * 1000; // 15 phút
          const now = Date.now();
          for (const task of this.tasks) {
            if (task.status !== 'running') continue;
            const updatedAt = task.updated_at ? new Date(task.updated_at).getTime() : 0;
            const ageMs = updatedAt > 0 ? (now - updatedAt) : Infinity;
            if (ageMs >= STUCK_THRESHOLD_MS) {
              console.log('[TaskList] Reset stuck task', task.task_id, `(running for ${Math.round(ageMs/60000)} min)`);
              task.status = 'pending';
              await window.storageManager.updateTaskStatus(task.task_id, 'pending').catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskList#loadTasks', _e); });
            } else {
              console.log('[TaskList] Skip reset task', task.task_id, `(running ${Math.round(ageMs/60000)} min < 15 min threshold)`);
            }
          }
        }
      }

      this.renderTaskList();
      this._checkBatchComplete();
    } catch (error) {
      console.error('[TaskList] Load failed:', error);
      this.showError(window.I18n?.t('tasks.loadFailed') || 'Không thể tải danh sách tasks');
    } finally {
      this._loading = false;
    }
  }

  /**
   * [API SPAM FIX] Debounced loadTasks - coalesce nhiều events
   */
  _debouncedLoadTasks() {
    // Skip full reload khi đang chạy hoặc cooldown
    if ((this.isRunningAll || this._executionCooldown) && this._lastUpdatedTaskId) {
      console.log('[TaskList] Skip loadTasks - running or cooldown, use single update instead');
      if (this._loadCoalesceTimer) {
        clearTimeout(this._loadCoalesceTimer);
        this._loadCoalesceTimer = null;
      }
      this._debouncedUpdateSingleTask(this._lastUpdatedTaskId);
      return;
    }

    if (this._loadCoalesceTimer) clearTimeout(this._loadCoalesceTimer);
    this._loadCoalesceTimer = setTimeout(() => {
      this._loadCoalesceTimer = null;
      // Double check
      if ((this.isRunningAll || this._executionCooldown) && this._lastUpdatedTaskId) {
        console.log('[TaskList] Skip loadTasks in timer - running or cooldown');
        return;
      }
      this.loadTasks();
    }, 1000);
  }

  /**
   * [API SPAM FIX] Debounced single task update - coalesce multiple updates cho cùng taskId
   * @param {string} taskId
   */
  _debouncedUpdateSingleTask(taskId) {
    if (!taskId) return;
    console.log('[TaskList] _debouncedUpdateSingleTask called:', taskId);
    this._lastUpdatedTaskId = taskId;

    const key = `_updateTimer_${taskId}`;
    if (this[key]) clearTimeout(this[key]);
    this[key] = setTimeout(() => {
      this[key] = null;
      this._updateSingleTaskInList(taskId);
    }, 500);
  }

  /**
   * [API SPAM FIX] Update chỉ 1 task trong list thay vì reload all
   * @param {string} taskId
   */
  async _updateSingleTaskInList(taskId) {
    if (!taskId) return;

    try {
      // Luôn fetch fresh data từ server (không dùng cache vì có thể stale sau edit)
      let task = null;
      if (window.storageManager) {
        try {
          task = await window.storageManager.getTask(taskId);
          if (task) {
            // Update cache với fresh data
            const existingIdx = this.tasks.findIndex(t => t.task_id === taskId);
            if (existingIdx >= 0) {
              this.tasks[existingIdx] = task;
            } else {
              // Task mới, thêm vào đầu cache
              this.tasks.unshift(task);
            }
          }
        } catch (e) {
          console.warn('[TaskList] Fetch single task failed:', e.message);
          // Fallback: dùng cached data nếu fetch fail
          task = this.tasks.find(t => t.task_id === taskId);
        }
      }

      if (!task) return;

      // Tìm card element và update. Nếu task mới chưa có DOM card → render lại list.
      const cardEl = this._listContainer?.querySelector(`.task-card[data-task-id="${taskId}"]`);
      if (cardEl) {
        this._updateCard(cardEl, task);
      } else {
        this.renderTaskList();
      }
    } catch (error) {
      console.warn('[TaskList] _updateSingleTaskInList failed:', error.message);
    }
  }

  /**
   * [API SPAM FIX] Update card running state (similar to WorkflowList)
   * @param {string} taskId
   * @param {boolean} isRunning
   * @param {string} [finalStatus]
   */
  _updateCardRunningState(taskId, isRunning, finalStatus = null) {
    const cardEl = this._listContainer?.querySelector(`.task-card[data-task-id="${taskId}"]`);
    if (!cardEl) {
      console.warn('[TaskList] Card not found for taskId:', taskId);
      return;
    }

    // Update status class
    cardEl.classList.remove('pending', 'running', 'completed', 'failed', 'skipped');
    const newStatus = isRunning ? 'running' : (finalStatus || 'pending');
    cardEl.classList.add(newStatus);

    // Disable checkbox khi running
    const checkbox = cardEl.querySelector('.task-card-checkbox input');
    if (checkbox) {
      checkbox.disabled = isRunning;
    }

    // Update status badge
    const statusDot = cardEl.querySelector('.task-card-status');
    if (statusDot) {
      const lbl = TaskList._renderStatusLabel(newStatus);
      statusDot.className = `task-card-status ${newStatus}`;
      statusDot.innerHTML = TaskList._renderStatusIcon(newStatus);
      statusDot.setAttribute('title', lbl);
      statusDot.setAttribute('aria-label', lbl);
    }

    // Handle inline progress bar
    const nameRow = cardEl.querySelector('.task-card-name-row');
    const existingProgress = cardEl.querySelector('.task-card-inline-progress');

    if (isRunning && !existingProgress && nameRow) {
      const progressEl = document.createElement('span');
      progressEl.className = 'task-card-inline-progress indeterminate';
      progressEl.innerHTML = '<span class="task-card-inline-progress-bar"></span>';
      nameRow.appendChild(progressEl);
    } else if (!isRunning && existingProgress) {
      existingProgress.remove();
    }

    // Update action buttons: swap dropdown menu <-> stop button
    const actionsEl = cardEl.querySelector('.task-card-actions');
    if (actionsEl) {
      const hadRunning = !!actionsEl.querySelector('.run-btn.btn-warning');
      if (hadRunning !== isRunning) {
        // Tìm task để re-render buttons
        const task = this.tasks.find(t => t.task_id === taskId);
        if (task) {
          // Cập nhật status trong task object
          task.status = newStatus;
          const newHtml = this.renderTaskCard(task);
          const temp = document.createElement('div');
          temp.innerHTML = newHtml;
          const newCard = temp.firstElementChild;
          if (newCard) {
            const newActions = newCard.querySelector('.task-card-actions');
            if (newActions) actionsEl.innerHTML = newActions.innerHTML;
          }
        }
      }
    }
  }

  render() {
    // Preserve auth-gate-overlay (destroyed by innerHTML replacement)
    const authGate = this.container.querySelector('.auth-gate-overlay');
    this.container.innerHTML = `
      <div class="task-toolbar sf-toolbar">
        <div class="sf-search-box">
          <svg class="sf-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" id="taskSearchInput" class="sf-search-input" placeholder="${I18n.t('tasks.search') || 'Tìm kiếm...'}">
        </div>
        <button class="btn btn-secondary btn-sm btn-toolbar-icon" id="refreshTasksBtn" title="${I18n.t('common.reload')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
        </button>
        <select class="task-project-select-inline hidden sf-filter-select compact-select" id="taskProjectSelectInline" title="${I18n.t('workflow.filterByProject')}"></select>
        <div class="sf-spacer"></div>
        <button class="btn btn-primary btn-sm btn-icon-text btn-add-short ms-spaces-run-all" id="addTaskBtn" title="${I18n.t('tasks.addTask')}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"></line>
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
          <span class="btn-text-runall">${I18n.t('tasks.add') || '+ Thêm'}</span>
        </button>
      </div>
      <div class="task-batch-progress hidden" id="taskBatchProgress">
        <div class="batch-progress-info">
          <span class="batch-progress-label" id="taskBatchProgressLabel">${I18n.t('tasks.runningTasks')}</span>
          <span class="batch-progress-count" id="taskBatchProgressCount">0/0</span>
        </div>
        <div class="batch-progress-bar">
          <div class="batch-progress-fill" id="taskBatchProgressFill"></div>
        </div>
      </div>
      <div class="batch-actions hidden" id="batchActions">
        <span class="batch-actions-count"><span id="selectedCount">0</span> ${I18n.t('tasks.selected')}</span>
        <button class="btn btn-secondary btn-sm" id="runSelectedBtn">${I18n.t('common.run')}</button>
        <button class="btn btn-secondary btn-sm btn-danger" id="deleteSelectedBtn">${I18n.t('common.delete')}</button>
      </div>
      <div class="task-list" id="taskListContainer">
        <div class="task-empty-hero">
          <div class="wf-empty-hero-icon">
            <div class="wf-empty-glow"></div>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"></path>
              <rect x="9" y="3" width="6" height="4" rx="2"></rect>
              <path d="m9 14 2 2 4-4"></path>
            </svg>
          </div>
          <h3 class="workflow-empty-title">Tự Động Hóa Chạy Đa Nhiệm (Multi-Task)</h3>
          <p class="workflow-empty-subtitle">Lên lịch và thực thi hàng loạt tác vụ AI cùng lúc một cách tự động và tối ưu hiệu suất.</p>
          <div class="wf-empty-pills">
            <span class="wf-empty-pill">⚡ Chạy Song Song (Parallel)</span>
            <span class="wf-empty-pill">📊 Theo Dõi Tiến Độ</span>
            <span class="wf-empty-pill">🔄 Khôi Phục Tự Động</span>
          </div>
          <div class="workflow-empty-actions">
            <button class="wf-empty-primary-btn" id="addFirstTaskBtn">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
              <span>${I18n.t('tasks.addFirstTask')}</span>
            </button>
          </div>
        </div>
      </div>
    `;
    if (authGate) this.container.prepend(authGate);
  }

  /**
   * Check quota/permission before opening task modal
   * Used by both header button and empty state button
   * Luôn fetch async từ server để có entitlements mới nhất theo user plan
   */
  async _checkAndOpenTaskModal() {
    if (window.featureGate) {
      // Async check để đảm bảo data mới nhất từ server
      const canCreate = await window.featureGate.canCreateTaskAsync();
      if (!canCreate) {
        const isLoggedIn = true;
        if (!isLoggedIn) {
          // Anonymous user + plan không cho phép → yêu cầu login
          window.featureGate.showLoginPrompt(
            window.I18n?.t('tasks.requireLoginToCreate') || 'Tạo task yêu cầu đăng nhập'
          );
        } else {
          // Logged-in user + hết quota → show upgrade
          const quota = window.featureGate.checkQuota('tasks_max');
          console.log('[TaskList] Task quota exceeded:', quota);
          const shouldUpgrade = await window.customDialog?.confirm(
            window.I18n?.t('tasks.quotaLimitMsg', { limit: quota.limit, used: quota.used }) || `Gói của bạn giới hạn tối đa ${quota.limit} task. Bạn đã có ${quota.used} task. Nâng cấp Premium để tạo không giới hạn.`,
            { title: window.I18n?.t('tasks.quotaLimitTitle') || 'Đã đạt giới hạn', type: 'warning', confirmText: window.I18n?.t('common.upgrade') || 'Nâng cấp', cancelText: window.I18n?.t('common.later') || 'Để sau' }
          );
          /* upgrade modal removed — local-first; confirm is now informational only */
          void shouldUpgrade;
        }
        return;
      }
    }

    if (window.eventBus) window.eventBus.emit('task:open_modal', { mode: 'create' });
  }

  bindEvents() {
    // Search toggle
    const searchToggle = this.container.querySelector('#taskSearchToggle');
    const searchRow = this.container.querySelector('#taskSearchRow');
    const searchInput = this.container.querySelector('#taskSearchInput');
    const searchClose = this.container.querySelector('#taskSearchClose');

    if (searchToggle && searchRow) {
      searchToggle.addEventListener('click', () => {
        const isHidden = searchRow.classList.contains('hidden');
        searchRow.classList.toggle('hidden');
        if (isHidden && searchInput) {
          searchInput.focus();
        }
      });
    }

    if (searchClose && searchRow) {
      searchClose.addEventListener('click', () => {
        searchRow.classList.add('hidden');
        if (searchInput) {
          searchInput.value = '';
        }
        this.searchQuery = '';
        this._currentPage = 1; // reset pagination
        this.renderTaskList();
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase();
        this._currentPage = 1; // reset pagination
        this.renderTaskList();
      });
    }

    // Refresh button
    const refreshBtn = this.container.querySelector('#refreshTasksBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => this.loadTasks());
    }

    // Add task buttons - use shared method for quota check
    const addTaskBtn = this.container.querySelector('#addTaskBtn');
    const addFirstTaskBtn = this.container.querySelector('#addFirstTaskBtn');

    if (addTaskBtn) addTaskBtn.addEventListener('click', () => this._checkAndOpenTaskModal());
    if (addFirstTaskBtn) addFirstTaskBtn.addEventListener('click', () => this._checkAndOpenTaskModal());

    // Run Mode toggle
    const runModeBtn = this.container.querySelector('#taskRunModeBtn');
    if (runModeBtn) {
      runModeBtn.addEventListener('click', () => this.toggleRunMode());
    }

    // Run All / Stop button
    const runAllBtn = this.container.querySelector('#runAllTasksBtn');
    if (runAllBtn) {
      runAllBtn.addEventListener('click', () => {
        if (this.isRunningAll) {
          this.stopAllTasks();
        } else {
          this.runAllTasks();
        }
      });
    }

    // Batch actions
    const runSelectedBtn = this.container.querySelector('#runSelectedBtn');
    const deleteSelectedBtn = this.container.querySelector('#deleteSelectedBtn');

    if (runSelectedBtn) {
      runSelectedBtn.addEventListener('click', () => this.runSelected());
    }
    if (deleteSelectedBtn) {
      deleteSelectedBtn.addEventListener('click', () => this.deleteSelected());
    }

  }

  async renderTaskList() {
    const container = this.container.querySelector('#taskListContainer');
    if (!container) return;

    // Show/hide Run All + Run Mode buttons when tasks exist
    const runAllBtn = this.container.querySelector('#runAllTasksBtn');
    const runModeBtn = this.container.querySelector('#taskRunModeBtn');
    if (runAllBtn) {
      runAllBtn.classList.toggle('hidden', this.tasks.length === 0);
    }
    if (runModeBtn) {
      runModeBtn.classList.toggle('hidden', this.tasks.length === 0);
      // Force sequential khi có task ChatGPT (1 tab/1 editor) hoặc multi-prompt task
      // Disable toggle + hint tooltip — tránh user click chuyển parallel rồi thắc mắc tại sao chạy tuần tự
      const enabled = this.tasks.filter(t => t.enabled);
      const hasChatGPT = enabled.some(t => (t.provider || 'flow') === 'chatgpt');
      // G-5.7b: Detect Grok tasks → force sequential (mirror ChatGPT pattern)
      const hasGrok = enabled.some(t => (t.provider || 'flow') === 'grok');
      const providerSet = new Set(enabled.map(t => t.provider || 'flow'));
      const hasMixed = providerSet.size > 1;
      const hasMultiPrompt = enabled.some(t => t.multi_prompt && t.prompts?.length > 1);
      const forceSeq = hasChatGPT || hasGrok || hasMixed || hasMultiPrompt;
      if (forceSeq) {
        if (this.runMode !== 'sequential') {
          this._savedRunModeBeforeForce = this.runMode;
          this.runMode = 'sequential';
          this.updateRunModeButton?.();
        }
        runModeBtn.disabled = true;
        runModeBtn.classList.add('disabled');
        // G-5.7b: Reason key priority — ChatGPT > Grok > Mixed > MultiPrompt
        const reasonKey = hasChatGPT
          ? 'tasks.forceSeqChatGPT'
          : hasGrok ? 'tasks.forceSeqGrok'
          : hasMixed ? 'tasks.forceSeqMixed' : 'tasks.forceSeqMultiPrompt';
        const reasonText = hasChatGPT
          ? (window.I18n?.t(reasonKey) || 'ChatGPT chỉ chạy tuần tự (1 tab/1 editor)')
          : hasGrok ? (window.I18n?.t(reasonKey) || 'Grok chỉ chạy tuần tự (1 tab/1 editor + redirect flow)')
          : hasMixed ? (window.I18n?.t(reasonKey) || 'Mixed providers — tuần tự để tránh xung đột tab')
          : (window.I18n?.t(reasonKey) || 'Có task multi-prompt — tự động tuần tự');
        runModeBtn.title = reasonText;
        runModeBtn.setAttribute('data-tooltip', reasonText);
      } else {
        runModeBtn.disabled = false;
        runModeBtn.classList.remove('disabled');
        if (this._savedRunModeBeforeForce !== undefined) {
          this.runMode = this._savedRunModeBeforeForce;
          this._savedRunModeBeforeForce = undefined;
          this.updateRunModeButton?.();
        }
      }
    }

    // Restore run all button state nếu đang chạy batch
    if (this.isRunningAll && runAllBtn) {
      this._setRunAllButtonRunning();
    }

    // Y-1: Render project filter toolbar
    await this._renderProjectFilter();

    // Y-1: Apply project filter
    let filteredTasks = this.tasks;
    if (this._filterProjectId) {
      if (this._filterProjectId === '__legacy__') {
        filteredTasks = this.tasks.filter(t => !t.project_id);
      } else {
        filteredTasks = this.tasks.filter(t => t.project_id === this._filterProjectId);
      }
    }

    // Apply search filter
    if (this.searchQuery) {
      filteredTasks = filteredTasks.filter(t =>
        t.task_name?.toLowerCase().includes(this.searchQuery) ||
        t.prompt?.toLowerCase().includes(this.searchQuery)
      );
    }

    if (filteredTasks.length === 0) {
      container.innerHTML = `
        <div class="task-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"></path>
            <rect x="9" y="3" width="6" height="4" rx="2"></rect>
          </svg>
          <p>${this.searchQuery ? (window.I18n?.t('tasks.noSearchResult') || 'Không tìm thấy task') : I18n.t('tasks.noTasks')}</p>
          ${!this.searchQuery ? `<button class="btn btn-primary btn-sm" id="addFirstTaskBtn">${I18n.t('tasks.addFirstTask')}</button>` : ''}
        </div>
      `;
      // Bind event for empty state button
      container.querySelector('#addFirstTaskBtn')?.addEventListener('click', () => this._checkAndOpenTaskModal());
      return;
    }

    // Phase 2: Migration banner — đếm legacy tasks (project_id=null) trong toàn bộ list
    // Chỉ đếm tasks của chính user hiện tại (phòng trường hợp admin mode sau này)
    const currentUserId = ({ id: 'local_user', name: 'Local User', plan_slug: 'pro' })?.id;
    const legacyTasks = this.tasks.filter(t => {
      if (t.project_id) return false;
      if (t.user?.id && currentUserId) return t.user.id === currentUserId;
      return true;
    });
    const migrationBanner = window.ProjectHelper?.renderMigrationBanner?.(legacyTasks.length, 'task') || '';

    // Server-side pagination — hiển thị tất cả tasks đã load
    const visibleTasks = filteredTasks;
    const hasMore = this._currentPage < this._lastPage;
    const remaining = this._total - this.tasks.length;

    // Build ordered list of items to render (headers + task cards)
    let renderItems = [];
    // Migration banner ở top (key cố định để KHÔNG re-render khi pagination/filter)
    if (migrationBanner) {
      renderItems.push({ type: 'header', html: migrationBanner, key: '__migrate_banner__' });
    }
    if (!this._filterProjectId && window.ProjectHelper) {
      const grouped = await window.ProjectHelper.sortByProjectGroup(visibleTasks, window._currentProjectId);
      for (const entry of grouped) {
        if (entry.type === 'header') {
          renderItems.push({ type: 'header', html: window.ProjectHelper.renderGroupHeader(entry.projectName, entry.count, entry.isCurrent), key: `header_${entry.projectName}` });
        } else {
          renderItems.push({ type: 'task', task: entry.item, key: entry.item.task_id });
        }
      }
    } else {
      visibleTasks.sort((a, b) => {
        if (a.sort_order !== undefined && b.sort_order !== undefined) return a.sort_order - b.sort_order;
        if (a.sort_order !== undefined) return -1;
        if (b.sort_order !== undefined) return 1;
        return (b.created_at || 0) - (a.created_at || 0);
      });
      for (const task of visibleTasks) {
        renderItems.push({ type: 'task', task, key: task.task_id });
      }
    }

    // Append load-more row item nếu còn pages chưa load
    if (hasMore) {
      const loadMoreLabel = window.I18n?.t('common.loadMore') || 'Tải thêm';
      const loadMoreHtml = `
        <div class="seosonaflow-load-more-row">
          <button class="seosonaflow-load-more-btn" id="taskLoadMoreBtn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            ${loadMoreLabel}
            <span class="seosonaflow-load-more-count">${this.tasks.length} / ${this._total}</span>
          </button>
        </div>`;
      renderItems.push({ type: 'header', html: loadMoreHtml, key: `__loadmore_${this._currentPage}_${this._lastPage}` });
    }

    this._renderIncremental(container, renderItems);

    // Bind load-more handler (re-bind sau mỗi render vì element re-created)
    container.querySelector('#taskLoadMoreBtn')?.addEventListener('click', () => {
      if (!this._loading) {
        this.loadTasks(true); // Load next page from server
      }
    });

    // Bind migration banner (Gán / Bỏ qua)
    container.querySelector('.legacy-migrate-banner[data-type="task"]')?.addEventListener('click', async (e) => {
      const btn = e.target.closest('.legacy-migrate-btn');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'skip') {
        sessionStorage.setItem('legacy_migrate_task_dismissed', '1');
        this.renderTaskList();
      } else if (action === 'assign') {
        const count = await window.ProjectHelper.migrateLegacyItems(legacyTasks, 'task');
        if (count > 0) {
          window.showNotification?.(
            (window.I18n?.t('project.migrateSuccess', { count }) || `Đã gán ${count} item vào project hiện tại`),
            'success', 2500
          );
          await this.loadTasks();
        }
      }
    });

    this._loadRefThumbnails(container);
    this._handleExpiredResultThumbnails(container);
  }

  /**
   * Y-1: Render project filter as inline select (giống WorkflowList)
   */
  async _renderProjectFilter() {
    const select = this.container.querySelector('#taskProjectSelectInline');
    if (!select) return;

    if (this.tasks.length === 0) {
      select.classList.add('hidden');
      return;
    }

    // Collect unique project IDs + counts
    const counts = {};
    for (const t of this.tasks) {
      const pid = t.project_id || '__legacy__';
      counts[pid] = (counts[pid] || 0) + 1;
    }
    const projectIds = new Set(Object.keys(counts));

    select.classList.remove('hidden');

    const projects = await window.ProjectHelper?.getProjectList() || {};
    
    // Dynamic truncation length based on available panel width
    const panelWidth = this.container?.clientWidth || window.innerWidth || 350;
    const dynamicMaxLen = Math.max(16, Math.floor((panelWidth - 90) / 9));

    const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;
    const trunc = (str, maxLen = dynamicMaxLen) => (str && str.length > maxLen) ? str.substring(0, maxLen - 1) + '…' : str;

    let options = `<option value="">${t('project.filterAll', { count: this.tasks.length })}</option>`;

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

    // Bind change listener — gắn trên ELEMENT nên guard trên element là ĐÚNG (listener chết theo element).
    if (!select._taskListBound) {
      select._taskListBound = true;
      select.addEventListener('change', (e) => {
        this._filterProjectId = e.target.value || null;
        this._currentPage = 1; // reset pagination
        this.renderTaskList();
      });
    }

    // Bind resize listener — gắn trên WINDOW nên guard phải trên INSTANCE, KHÔNG phải element:
    // #taskProjectSelectInline được dựng lại mỗi lần render (template literal, ~line 402) → guard-trên-
    // element reset theo, trong khi listener cũ trên window KHÔNG chết theo element → cộng dồn mỗi render.
    if (!this._resizeBound) {
      this._resizeBound = true;
      window.addEventListener('resize', () => {
        clearTimeout(this._resizeTimer);
        this._resizeTimer = setTimeout(() => this._renderProjectFilter(), 200);
      });
    }
  }

  _renderIncremental(container, renderItems) {
    const desiredKeys = renderItems.map(item => item.key);
    const existingEls = {};
    for (const child of [...container.children]) {
      const key = child.dataset?.taskId || child.dataset?.headerKey;
      if (key) existingEls[key] = child;
    }

    const existingKeys = Object.keys(existingEls);
    const keysMatch = existingKeys.length === desiredKeys.length &&
      existingKeys.every((k, i) => k === desiredKeys[i]);

    if (keysMatch) {
      for (const item of renderItems) {
        if (item.type === 'task') {
          this._updateCard(existingEls[item.key], item.task);
        }
      }
      return;
    }

    const desiredSet = new Set(desiredKeys);
    for (const [key, el] of Object.entries(existingEls)) {
      if (!desiredSet.has(key)) el.remove();
    }

    const fragment = document.createDocumentFragment();
    const reusable = {};
    for (const child of [...container.children]) {
      const key = child.dataset?.taskId || child.dataset?.headerKey;
      if (key) reusable[key] = child;
    }

    container.innerHTML = '';

    for (const item of renderItems) {
      if (item.type === 'task' && reusable[item.key]) {
        this._updateCard(reusable[item.key], item.task);
        fragment.appendChild(reusable[item.key]);
      } else if (item.type === 'header' && reusable[item.key]) {
        fragment.appendChild(reusable[item.key]);
      } else {
        const temp = document.createElement('div');
        if (item.type === 'task') {
          temp.innerHTML = this.renderTaskCard(item.task);
        } else {
          temp.innerHTML = item.html;
          const headerEl = temp.firstElementChild;
          if (headerEl) headerEl.dataset.headerKey = item.key;
        }
        while (temp.firstChild) fragment.appendChild(temp.firstChild);
      }
    }

    container.appendChild(fragment);
  }

  _updateCard(cardEl, task) {
    if (!cardEl || !task) return;

    const isSelected = this.selectedTasks.has(task.task_id);
    const statusClass = task.status || 'pending';
    const isRunning = task.status === 'running';
    const isEnabled = task.enabled !== false;
    const isCurrent = window.ProjectHelper ? window.ProjectHelper.isCurrentProject(task) : true;

    cardEl.className = `task-card ${statusClass} ${isSelected ? 'selected' : ''} ${!isEnabled ? 'task-disabled' : ''} ${!isCurrent ? 'cross-project' : ''}`;

    const checkbox = cardEl.querySelector('.task-card-checkbox input');
    if (checkbox) {
      checkbox.checked = isSelected;
      checkbox.disabled = isRunning;
    }

    const statusDot = cardEl.querySelector('.task-card-status');
    if (statusDot) {
      const lbl = TaskList._renderStatusLabel(statusClass);
      statusDot.className = `task-card-status ${statusClass}`;
      statusDot.innerHTML = TaskList._renderStatusIcon(statusClass);
      statusDot.setAttribute('title', lbl);
      statusDot.setAttribute('aria-label', lbl);
    }

    const nameEl = cardEl.querySelector('.task-card-name');
    if (nameEl) {
      nameEl.textContent = task.task_name || (window.I18n?.t('tasks.noName') || 'Không có tên');
    }

    // Inline progress bar: add/remove based on running state
    const nameRow = cardEl.querySelector('.task-card-name-row');
    const existingProgress = cardEl.querySelector('.task-card-inline-progress');
    if (isRunning && !existingProgress && nameRow) {
      const progressEl = document.createElement('span');
      progressEl.className = 'task-card-inline-progress indeterminate';
      progressEl.innerHTML = '<span class="task-card-inline-progress-bar"></span>';
      nameRow.appendChild(progressEl);
    } else if (!isRunning && existingProgress) {
      existingProgress.remove();
    }

    const toggleBtn = cardEl.querySelector('.task-toggle-btn');
    if (toggleBtn) {
      toggleBtn.className = `task-toggle-btn ${isEnabled ? 'on' : 'off'}`;
      toggleBtn.title = isEnabled ? (window.I18n?.t('tasks.disableTask') || 'Tắt task') : (window.I18n?.t('tasks.enableTask') || 'Bật task');
    }

    const promptEl = cardEl.querySelector('.task-card-prompt');
    if (promptEl) promptEl.textContent = task.prompt || '';

    // Update refs, meta, results sections bằng cách re-render từ task data mới
    const newHtml = this.renderTaskCard(task);
    const temp = document.createElement('div');
    temp.innerHTML = newHtml;
    const newCard = temp.firstElementChild;
    if (newCard) {
      // Update meta section (ratio, quantity, model, etc.)
      const oldMeta = cardEl.querySelector('.task-card-meta');
      const newMeta = newCard.querySelector('.task-card-meta');
      if (oldMeta && newMeta) {
        oldMeta.innerHTML = newMeta.innerHTML;
      }

      // Update provider badge + media type badge trong name row
      const oldNameRow = cardEl.querySelector('.task-card-name-row');
      const newNameRow = newCard.querySelector('.task-card-name-row');
      if (oldNameRow && newNameRow) {
        const oldProviderBadge = oldNameRow.querySelector('.task-provider-badge');
        const newProviderBadge = newNameRow.querySelector('.task-provider-badge');
        if (oldProviderBadge && newProviderBadge) {
          oldProviderBadge.outerHTML = newProviderBadge.outerHTML;
        } else if (!oldProviderBadge && newProviderBadge) {
          oldNameRow.querySelector('.task-card-name')?.insertAdjacentElement('afterend', newProviderBadge.cloneNode(true));
        } else if (oldProviderBadge && !newProviderBadge) {
          oldProviderBadge.remove();
        }

        const oldMediaBadge = oldNameRow.querySelector('.task-media-badge');
        const newMediaBadge = newNameRow.querySelector('.task-media-badge');
        if (oldMediaBadge && newMediaBadge) {
          oldMediaBadge.outerHTML = newMediaBadge.outerHTML;
        } else if (!oldMediaBadge && newMediaBadge) {
          const afterEl = oldNameRow.querySelector('.task-provider-badge') || oldNameRow.querySelector('.task-card-name');
          afterEl?.insertAdjacentElement('afterend', newMediaBadge.cloneNode(true));
        } else if (oldMediaBadge && !newMediaBadge) {
          oldMediaBadge.remove();
        }
      }

      // Update refs section
      const oldRefs = cardEl.querySelector('.task-card-refs');
      const newRefs = newCard.querySelector('.task-card-refs');
      if (oldRefs && newRefs) {
        oldRefs.innerHTML = newRefs.innerHTML;
      } else if (oldRefs && !newRefs) {
        oldRefs.remove();
      } else if (!oldRefs && newRefs) {
        const metaEl = cardEl.querySelector('.task-card-meta');
        if (metaEl) metaEl.insertAdjacentElement('afterend', newRefs.cloneNode(true));
      }

      // Update arrow + results section (clear old, add new)
      const oldArrow = cardEl.querySelector('.task-card-arrow');
      const newArrow = newCard.querySelector('.task-card-arrow');
      const oldResults = cardEl.querySelector('.task-card-results');
      const newResults = newCard.querySelector('.task-card-results');

      // Handle arrow: add/remove based on new state
      if (!oldArrow && newArrow) {
        const refsEl = cardEl.querySelector('.task-card-refs');
        if (refsEl) refsEl.insertAdjacentElement('afterend', newArrow.cloneNode(true));
      } else if (oldArrow && !newArrow) {
        oldArrow.remove();
      }

      // Handle results
      if (oldResults && newResults) {
        oldResults.innerHTML = newResults.innerHTML;
      } else if (oldResults && !newResults) {
        oldResults.remove();
      } else if (!oldResults && newResults) {
        const arrowEl = cardEl.querySelector('.task-card-arrow');
        const refsEl = cardEl.querySelector('.task-card-refs');
        const insertAfter = arrowEl || refsEl || cardEl.querySelector('.task-card-meta');
        if (insertAfter) insertAfter.insertAdjacentElement('afterend', newResults.cloneNode(true));
      }

      // Update actions section
      const actionsEl = cardEl.querySelector('.task-card-actions');
      const newActions = newCard.querySelector('.task-card-actions');
      if (actionsEl && newActions) {
        const hadRunning = !!actionsEl.querySelector('.run-btn.btn-warning');
        if (hadRunning !== isRunning) {
          actionsEl.innerHTML = newActions.innerHTML;
        }
      }
    }
  }

  /** Update inline progress bar on a running task card (pipeline mode) */
  _updateTaskProgress(taskId, completed, total) {
    const cardEl = this._listContainer?.querySelector(`.task-card[data-task-id="${taskId}"]`);
    if (!cardEl) return;
    const progressEl = cardEl.querySelector('.task-card-inline-progress');
    const fillEl = cardEl.querySelector('.task-card-inline-progress-bar');
    if (!fillEl) return;
    // Switch from indeterminate to determinate mode
    if (progressEl) progressEl.classList.remove('indeterminate');
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    fillEl.style.width = `${pct}%`;
  }

  _setupEventDelegation() {
    const listContainer = this.container.querySelector('#taskListContainer');
    if (!listContainer) return;
    this._listContainer = listContainer;

    listContainer.addEventListener('click', (e) => {
      const target = e.target;

      const card = target.closest('.task-card');
      if (!card) {
        const addFirstBtn = target.closest('#addFirstTaskBtn');
        if (addFirstBtn) {
          // Check quota before opening modal (same as header button)
          this._checkAndOpenTaskModal();
        }
        return;
      }
      const taskId = card.dataset.taskId;
      if (!taskId) return;

      if (target.closest('.task-card-checkbox') && !target.matches('input[type="checkbox"]')) {
        const checkbox = card.querySelector('.task-card-checkbox input');
        if (checkbox) {
          checkbox.checked = !checkbox.checked;
          e.stopPropagation();
          this.toggleSelect(taskId, checkbox.checked);
        }
        return;
      }

      if (target.closest('.task-toggle-btn')) {
        e.stopPropagation();
        this.toggleTaskEnabled(taskId);
        return;
      }

      if (target.closest('.seosonaflow-dot-menu-btn')) {
        e.stopPropagation();
        const dotMenu = target.closest('.seosonaflow-dot-menu');
        const dropdown = dotMenu?.querySelector('.seosonaflow-dropdown-menu');
        const menuBtn = dotMenu?.querySelector('.seosonaflow-dot-menu-btn');
        if (!dropdown || !menuBtn) return;
        const wasHidden = dropdown.classList.contains('hidden');
        this._closeAllDropdowns(listContainer);
        if (wasHidden) {
          dropdown.classList.remove('hidden');
          this._positionDropdown(menuBtn, dropdown);
          setTimeout(() => {
            document.addEventListener('click', () => this._closeAllDropdowns(listContainer), { once: true });
          }, 0);
        }
        return;
      }

      if (target.closest('.edit-btn') || target.closest('.task-card-name')) {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this._handleEditClick(taskId);
        return;
      }

      if (target.closest('.copy-btn')) {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this.cloneTask(taskId);
        return;
      }

      if (target.closest('.download-btn')) {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this.downloadTaskFiles(taskId);
        return;
      }

      if (target.closest('.run-btn')) {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        // Audit fix (double-submit): disable the run button SYNCHRONOUSLY on click
        // so a rapid second click can't fire another run before status flips to
        // 'running'. Only guard NEW runs; leave it clickable when acting as Stop.
        const _runBtn = target.closest('.run-btn');
        const _task = this.tasks.find(t => t.task_id === taskId);
        if (_runBtn && _task && _task.status !== 'running' && !this._pendingRunIds?.has(taskId)) {
          _runBtn.disabled = true;
          _runBtn.style.pointerEvents = 'none';
          // Safety re-enable in case runTask returns without a re-render
          setTimeout(() => { try { _runBtn.disabled = false; _runBtn.style.pointerEvents = ''; } catch (_) { globalThis.SEOSONA_swallow?.('TaskList#_setupEventDelegation', _); } }, 5000);
        }
        this.runTask(taskId);
        return;
      }

      if (target.closest('.reset-btn')) {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this.resetTask(taskId);
        return;
      }

      if (target.closest('.delete-btn')) {
        e.stopPropagation();
        this._closeAllDropdowns(listContainer);
        this.deleteTask(taskId);
        return;
      }
    });

    listContainer.addEventListener('change', (e) => {
      const checkbox = e.target.closest('.task-card-checkbox input');
      if (!checkbox) return;
      const card = checkbox.closest('.task-card');
      if (!card) return;
      const taskId = card.dataset.taskId;
      if (taskId) {
        e.stopPropagation();
        this.toggleSelect(taskId, checkbox.checked);
      }
    });

    listContainer.addEventListener('mousedown', (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle) return;
      const card = handle.closest('.task-card');
      if (card) card.setAttribute('draggable', 'true');
    });

    listContainer.addEventListener('touchstart', (e) => {
      const handle = e.target.closest('.drag-handle');
      if (!handle) return;
      const card = handle.closest('.task-card');
      if (card) card.setAttribute('draggable', 'true');
    }, { passive: true });

    listContainer.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.task-card');
      if (!card) return;
      card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.taskId);
    });

    listContainer.addEventListener('dragend', (e) => {
      const card = e.target.closest('.task-card');
      if (!card) return;
      card.setAttribute('draggable', 'false');
      card.classList.remove('dragging');
      listContainer.querySelectorAll('.task-card').forEach(c => c.classList.remove('drag-over'));
    });

    listContainer.addEventListener('dragover', (e) => {
      const card = e.target.closest('.task-card');
      if (!card) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const dragging = listContainer.querySelector('.dragging');
      if (dragging && dragging !== card) {
        card.classList.add('drag-over');
      }
    });

    listContainer.addEventListener('dragleave', (e) => {
      const card = e.target.closest('.task-card');
      if (card) card.classList.remove('drag-over');
    });

    listContainer.addEventListener('drop', (e) => {
      const card = e.target.closest('.task-card');
      if (!card) return;
      e.preventDefault();
      card.classList.remove('drag-over');
      const fromId = e.dataTransfer.getData('text/plain');
      const toId = card.dataset.taskId;
      if (fromId && fromId !== toId) {
        this._reorderTasks(fromId, toId, listContainer);
      }
    });
  }

  async _handleEditClick(taskId) {
    const task = this.tasks.find(t => t.task_id === taskId);
    if (!task) return;
    if (task && window.ProjectHelper && !window.ProjectHelper.isCurrentProject(task)) {
      const action = await window.ProjectHelper.showCrossProjectWarning(task, 'task');
      if (action === 'switch') {
        window.ProjectHelper.navigateToProject(task.project_id);
      }
      return;
    }
    if (window.eventBus) window.eventBus.emit('task:open_modal', { mode: 'edit', task });
  }

  /**
   * Y-7: Cache project names for labels
   */
  async _cacheProjectNames() {
    if (!window.ProjectHelper) return;
    try {
      const projects = await window.ProjectHelper.getProjectList();
      this._projectNames = {};
      for (const [pid, info] of Object.entries(projects)) {
        this._projectNames[pid] = info.name;
      }
    } catch (e) {
      console.warn('[TaskList] Cache project names failed:', e);
    }
  }


  async _reorderTasks(fromId, toId, container) {
    const cards = [...container.querySelectorAll('.task-card')];
    const orderedIds = cards.map(c => c.dataset.taskId);
    const fromIdx = orderedIds.indexOf(fromId);
    const toIdx = orderedIds.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;

    orderedIds.splice(fromIdx, 1);
    orderedIds.splice(toIdx, 0, fromId);

    for (let i = 0; i < orderedIds.length; i++) {
      const task = this.tasks.find(t => t.task_id === orderedIds[i]);
      if (task) task.sort_order = i;
    }

    if (window.storageManager) {
      try {
        for (const task of this.tasks) {
          await window.storageManager.saveTask(task);
        }
      } catch (e) {
        console.error('[TaskList] Reorder save failed:', e);
      }
    }

    this.renderTaskList();
  }

  _closeAllDropdowns(container) {
    container?.querySelectorAll('.seosonaflow-dropdown-menu').forEach(d => {
      d.classList.add('hidden');
    });
  }

  _positionDropdown(triggerEl, dropdown) {
    const rect = triggerEl.getBoundingClientRect();
    const dropdownHeight = dropdown.offsetHeight || 150;
    const dropdownWidth = dropdown.offsetWidth || 140;
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;

    const rightEdge = viewportWidth - rect.right;
    if (rect.right - dropdownWidth < 4) {
      dropdown.style.left = '4px';
      dropdown.style.right = 'auto';
    } else {
      dropdown.style.right = Math.max(4, rightEdge) + 'px';
      dropdown.style.left = 'auto';
    }

    if (rect.top > dropdownHeight + 8) {
      dropdown.style.bottom = (viewportHeight - rect.top + 4) + 'px';
      dropdown.style.top = 'auto';
    } else {
      dropdown.style.top = (rect.bottom + 4) + 'px';
      dropdown.style.bottom = 'auto';
    }
  }

  async cloneTask(taskId) {
    // Prevent concurrent clones
    if (this._isCloning) return;
    this._isCloning = true;

    try {
      await this._doCloneTask(taskId);
    } finally {
      this._isCloning = false;
    }
  }

  async _doCloneTask(taskId) {
    const task = this.tasks.find(t => t.task_id === taskId);
    if (!task) return;

    // Check quota (async để đảm bảo data mới nhất từ server theo user plan)
    if (window.featureGate) {
      const canCreate = await window.featureGate.canCreateTaskAsync();
      if (!canCreate) {
        const isLoggedIn = true;
        if (!isLoggedIn) {
          window.featureGate.showLoginPrompt(
            window.I18n?.t('tasks.requireLoginToClone') || 'Nhân bản task yêu cầu đăng nhập'
          );
        } else {
          const quota = window.featureGate.checkQuota('tasks_max');
          const shouldUpgrade = await window.customDialog?.confirm(
            window.I18n?.t('tasks.quotaCloneMsg', { limit: quota.limit, used: quota.used }) || `Gói của bạn giới hạn tối đa ${quota.limit} task. Bạn đã có ${quota.used} task. Nâng cấp Premium để nhân bản không giới hạn.`,
            { title: window.I18n?.t('tasks.quotaLimitTitle') || 'Đã đạt giới hạn', type: 'warning', confirmText: window.I18n?.t('common.upgrade') || 'Nâng cấp', cancelText: window.I18n?.t('common.later') || 'Để sau' }
          );
          /* upgrade modal removed — local-first; confirm is now informational only */
          void shouldUpgrade;
        }
        return;
      }
    }

    // Y-5: Cross-project clone check
    const isCurrent = window.ProjectHelper ? window.ProjectHelper.isCurrentProject(task) : true;
    let newTask;

    if (!isCurrent && window.ProjectHelper) {
      // Cross-project: show confirmation, then clone with media reset
      const confirmed = await window.ProjectHelper.showCloneConfirmation('task');
      if (!confirmed) return;
      newTask = window.ProjectHelper.cloneTaskCrossProject(task);
      // Uniquify task_name vs current project tasks (page hiện tại)
      newTask.task_name = window.ProjectHelper.uniquifyName(
        newTask.task_name,
        this.tasks.map(t => t.task_name)
      );
    } else {
      // Same project: normal clone — i18n suffix + uniquify
      const baseName = (task.task_name || 'Task') + ' ' + (window.I18n?.t('project.copySuffix') || '(copy)');
      const uniqueName = window.ProjectHelper?.uniquifyName(baseName, this.tasks.map(t => t.task_name)) || baseName;
      newTask = {
        ...JSON.parse(JSON.stringify(task)),
        task_id: window.IdGenerator ? window.IdGenerator.next('task') : `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        task_name: uniqueName,
        status: 'pending',
        result_file_ids: '',
        result_thumbnails: {},
        error_message: ''
      };
    }

    try {
      if (window.storageManager) {
        await window.storageManager.saveTask(newTask);
      }
      // Record usage for anonymous users (server không track)
      if (window.featureGate && !true) {
        await window.featureGate.recordTaskCreated();
      }
      // Refresh featureGate to update task count
      if (window.featureGate) {
        window.featureGate.refresh({ force: true }).catch(e => console.warn('[TaskList] FeatureGate refresh failed:', e));
      }
      await this.loadTasks();
      window.showNotification?.(window.I18n?.t('tasks.cloned') || 'Task đã nhân bản', 'success');
    } catch (e) {
      console.error('[TaskList] Clone failed:', e);

      // Check if it's a quota error - ApiStorage already shows modal
      if (e.code === 'QUOTA_EXCEEDED' || e.message?.includes('giới hạn')) {
        return;
      }

      window.customDialog?.alert((window.I18n?.t('tasks.cloneFailed') || 'Không thể nhân bản task: ') + e.message, { type: 'error' });
    }
  }

  async downloadTaskFiles(taskId) {
    const task = this.tasks.find(t => t.task_id === taskId);
    if (!task?.result_file_ids) return;

    // Manual download KHÔNG check `auto_download` feature gate.
    // `auto_download` là gate cho TỰ ĐỘNG download (sau khi gen xong).
    // Manual click "Download" trong menu → user explicit action, luôn cho phép.

    // BUG-T1 FIX: Thêm || '' để tránh crash khi result_file_ids không phải string
    const fileIds = (task.result_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (fileIds.length === 0) return;
    const fileNames = task.result_file_names || {};

    // Detect video task → dùng video resolution
    const isVideoTask = task.media_type === 'Video' || task.gen_type === 'Video';

    // External provider (ChatGPT/Grok): synthetic ID không hợp lệ với Flow downloadTileMedia.
    // Download trực tiếp từ CDN URL trong result_thumbnails qua chrome.downloads.
    const provider = task.provider || 'flow';
    const isExternal = provider === 'chatgpt' || provider === 'grok';

    if (isExternal) {
      const savedThumbs = task.result_thumbnails || {};
      const _dlSet = await window.DownloadHelper.getSettings();
      const folder = _dlSet.folder;
      const template = _dlSet.template;

      let successCount = 0;
      let failCount = 0;

      for (let idx = 0; idx < fileIds.length; idx++) {
        const fid = fileIds[idx];
        const thumbObj = savedThumbs[fid];
        const url = (typeof thumbObj === 'object' && thumbObj?.thumbnail) ? thumbObj.thumbnail : (typeof thumbObj === 'string' ? thumbObj : '');
        if (!url) {
          failCount++;
          console.warn('[TaskList] External download: missing URL for', fid);
          continue;
        }
        const isVid = (typeof thumbObj === 'object' && thumbObj?.type === 'video') || isVideoTask;
        const ext = isVid ? 'mp4' : 'png';

        // Build filename qua GenTab helper (subfolder = task_name)
        let filename = window.GenTab?._buildChatGPTFilename?.(
          template, window._currentProjectName || 'flow',
          task.prompt || task.task_name || 'task', 1, idx + 1, '',
          task.task_name, folder
        ) || `${folder}/${task.task_name || 'task'}/result_${Date.now()}_${idx}.${ext}`;
        if (isVid && filename.endsWith('.png')) filename = filename.replace(/\.png$/i, '.mp4');

        // Fetch URL → blob → chrome.downloads
        try {
          let resp = null;
          if (provider === 'grok' && window.GrokSession?.getTabInfo && window.MessageBridge?.grokFetchImage) {
            const info = await window.GrokSession.getTabInfo();
            if (info?.tabId) resp = await window.MessageBridge.grokFetchImage(url, info.tabId).catch(() => null);
          } else if (provider === 'chatgpt' && window.ChatGPTSession?.getTabInfo && window.MessageBridge?.chatGPTFetchImage) {
            const info = await window.ChatGPTSession.getTabInfo();
            if (info?.tabId) resp = await window.MessageBridge.chatGPTFetchImage(url, info.tabId).catch(() => null);
          }
          // Fallback: fetchBlob qua background.js (KHÔNG có cookie session)
          if (!resp?.success || !resp.base64) {
            resp = await new Promise(r => chrome.runtime.sendMessage({ action: 'fetchBlob', url }, r)).catch(() => null);
          }
          if (!resp?.success || !resp.base64) {
            // Tier 3: fetch fail (grok video mp4 CORS / HTTP2) → download URL TRỰC TIẾP qua chrome.downloads
            // (browser manager: cookie + bypass CORS). Áp cho cả grok lẫn chatgpt.
            const _t3Url = await (window.scrubbedDownloadUrl?.(url) ?? url);
            const _t3 = await new Promise((resolve) => {
              try { chrome.runtime.sendMessage({ action: 'chromeDownload', url: _t3Url, filename }, (r) => resolve(r)); }
              catch (e) { resolve({ success: false, error: e.message }); }
            });
            if (_t3?.success) { successCount++; continue; }
            failCount++;
            console.warn('[TaskList] External download fetch failed:', fid, '— URL có thể hết hạn (CDN signature TTL)');
            continue;
          }
          const blob = await (await fetch(resp.base64)).blob();
          const blobUrl = URL.createObjectURL(blob);
          const _dlUrl = await (window.scrubbedDownloadUrl?.(blobUrl) ?? blobUrl);
          await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'chromeDownload', url: _dlUrl, filename }, () => resolve());
          });
          setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
          successCount++;
        } catch (e) {
          failCount++;
          console.error('[TaskList] External download error:', fid, e);
        }
      }

      // User feedback notification
      if (successCount > 0 && failCount === 0) {
        window.showNotification?.(
          window.I18n?.t('tasks.downloadStarted', { count: successCount }) || `Đã tải ${successCount} file`,
          'success', 2000
        );
      } else if (successCount > 0 && failCount > 0) {
        window.showNotification?.(
          window.I18n?.t('taskNotify.downloadPartial', { ok: successCount, fail: failCount }) ||
            `Tải được ${successCount} file, ${failCount} file lỗi (URL có thể hết hạn — chạy lại task để cập nhật)`,
          'warning', 4000
        );
      } else {
        window.showNotification?.(
          window.I18n?.t('tasks.downloadExpiredMsg') || 'Không tải được file. URL có thể hết hạn — chạy lại task để cập nhật.',
          'error', 4000
        );
      }
      return;
    }

    // Flow path (default)
    const resolution = isVideoTask
      ? (task.video_download_resolution || (globalThis.DownloadPrefs?.DEFAULTS.video || '720p'))
      : (task.download_resolution || (globalThis.DownloadPrefs?.DEFAULTS.image || '1k'));

    for (const fileId of fileIds) {
      try {
        if (window.MessageBridge) {
          const fileName = fileNames[fileId] || null;
          await window.MessageBridge.downloadTileMedia(fileId, null, task.task_name || 'task', fileName, resolution);
        }
      } catch (e) {
        console.error('[TaskList] Download failed:', fileId, e);
      }
    }
  }

  renderTaskCard(task) {
    const isSelected = this.selectedTasks.has(task.task_id);
    const statusClass = task.status || 'pending';
    const isRunning = task.status === 'running';
    const isEnabled = task.enabled !== false;

    const runBtnIcon = isRunning
      ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <rect x="6" y="6" width="12" height="12"></rect>
         </svg>`
      : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
           <polygon points="5 3 19 12 5 21 5 3"></polygon>
         </svg>`;

    // Inline progress bar (short bar next to task name, like workflow)
    const inlineProgressHtml = isRunning
      ? '<span class="task-card-inline-progress indeterminate"><span class="task-card-inline-progress-bar"></span></span>'
      : '';

    // Ref image previews (small thumbnails from ref_file_ids)
    // Cross-project safe: prioritize saved thumbnails, avoid DOM query without validation
    let refPreviewHtml = '';
    if (task.ref_file_ids) {
      const refIds = (task.ref_file_ids || '').split(',').map(s => s.trim()).filter(Boolean);
      if (refIds.length > 0) {
        const savedRefThumbs = task.ref_thumbnails || {};
        const savedFileNames = task.ref_file_names || {};
        const thumbs = refIds.slice(0, 3).map(id => {
          let thumbSrc = '';
          let isCrossProject = false;
          const pending = window.pendingUploadFiles?.get(id);
          if (pending?.thumbnail) {
            thumbSrc = pending.thumbnail;
          } else if (savedRefThumbs[id]) {
            // Prefer saved thumbnails (persistent across sessions)
            thumbSrc = savedRefThumbs[id];
          } else if (this._refTileCache?.[id]) {
            const cached = this._refTileCache[id];
            thumbSrc = typeof cached === 'string' ? cached : cached.thumbnail;
            // Check cross-project if we have saved file_name
            if (savedFileNames[id] && cached.file_name && savedFileNames[id] !== cached.file_name) {
              isCrossProject = true;
            }
          }
          // Skip DOM query - it's unsafe for cross-project. Use saved thumbnails only.
          if (isCrossProject) {
            // Cross-project: show gradient sweep animation with warning icon
            return `<div class="task-ref-thumb task-ref-thumb-cross-project" title="${window.I18n?.t('tasks.crossProjectWarning') || 'Sai project - ảnh thuộc project khác'}">
              <svg class="cross-project-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
            </div>`;
          }
          return thumbSrc
            ? `<img class="task-ref-thumb" src="${thumbSrc}" alt="ref" />`
            : `<div class="task-ref-thumb task-ref-thumb-placeholder" data-file-id="${id}"><div class="task-thumb-shimmer"></div></div>`;
        }).join('');
        const moreCount = refIds.length > 3 ? `<div class="task-ref-thumb task-ref-thumb-more">+${refIds.length - 3}</div>` : '';
        refPreviewHtml = `<div class="task-card-refs">${thumbs}${moreCount}</div>`;
      }
    }

    // Result image previews (completed tasks - show generated images)
    // Cross-project safe: use saved thumbnails with file_name validation
    let resultPreviewHtml = '';
    if (task.status === 'completed' && task.result_file_ids) {
      const resultIds = task.result_file_ids.split(',').map(s => s.trim()).filter(Boolean);
      const savedThumbs = task.result_thumbnails || {};
      const savedFileNames = task.result_file_names || {};
      if (resultIds.length > 0) {
        const thumbs = resultIds.slice(0, 3).map(id => {
          const thumbRaw = savedThumbs[id] || '';
          const thumbSrc = (typeof thumbRaw === 'object' && thumbRaw?.thumbnail) ? thumbRaw.thumbnail : (typeof thumbRaw === 'string' ? thumbRaw : '');
          let isCrossProject = false;
          // Check cross-project: if we have cached current state, compare file_names
          if (this._resultTileCache?.[id] && savedFileNames[id]) {
            const cached = this._resultTileCache[id];
            if (cached.file_name && savedFileNames[id] !== cached.file_name) {
              isCrossProject = true;
            }
          }
          if (isCrossProject) {
            // Cross-project: show gradient sweep animation with warning icon
            return `<div class="task-ref-thumb task-result-thumb-card task-ref-thumb-cross-project" title="${window.I18n?.t('tasks.crossProjectWarning') || 'Sai project - ảnh thuộc project khác'}">
              <svg class="cross-project-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                <line x1="12" y1="9" x2="12" y2="13"></line>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
            </div>`;
          }
          // Detect video: check result_thumbnails type field or task media_type
          const thumbInfo = savedThumbs[id];
          const isVideoResult = (typeof thumbInfo === 'object' && thumbInfo?.type === 'video')
            || task.media_type === 'Video' || task.gen_type === 'Video';
          return thumbSrc
            ? (isVideoResult
              ? `<video class="task-ref-thumb task-result-thumb-card" src="${thumbSrc}" muted loop autoplay playsinline></video>`
              : `<img class="task-ref-thumb task-result-thumb-card" src="${thumbSrc}" alt="result" />`)
            : `<div class="task-ref-thumb task-ref-thumb-placeholder" data-file-id="${id}"><div class="task-thumb-shimmer"></div></div>`;
        }).join('');
        const moreCount = resultIds.length > 3 ? `<div class="task-ref-thumb task-ref-thumb-more">+${resultIds.length - 3}</div>` : '';
        resultPreviewHtml = `<div class="task-card-refs task-card-results">${thumbs}${moreCount}</div>`;
      }
    }

    // Y-1: Project label for card
    const isCurrent = window.ProjectHelper ? window.ProjectHelper.isCurrentProject(task) : true;
    const projectName = task.project_id ? (this._projectNames?.[task.project_id] || '') : '';
    const projectLabel = task.project_id && !this._filterProjectId && window.ProjectHelper
      ? window.ProjectHelper.renderProjectLabel(task.project_id, projectName, isCurrent)
      : '';
    const crossProjectClass = !isCurrent ? 'cross-project' : '';

    const statusIcon = TaskList._renderStatusIcon(statusClass);
    const statusLabel = TaskList._renderStatusLabel(statusClass);
    // Last run time — dùng task.executed_at (set khi task hoàn tất completed/failed/skipped)
    const lastRunHtml = task.executed_at
      ? `<div class="task-card-last-run" title="${window.I18n?.t('tasks.lastRun') || 'Lần chạy gần nhất'}"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>${this._formatRelativeTime(task.executed_at)}</div>`
      : '';
    // Last edit time — dùng task.updated_at với icon ReverseTimeArrow
    const lastEditHtml = task.updated_at
      ? `<div class="task-card-last-edit" title="${window.I18n?.t('tasks.lastEdit') || 'Chỉnh sửa gần nhất'}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g fill="currentColor"><path d="M9.624 2.34a10.5 10.5 0 0 1 7.195.518A10.46 10.46 0 0 1 21.982 7.9a10.5 10.5 0 0 1 .697 7.172c-.62 2.402-2.08 4.5-4.1 5.935a10.48 10.48 0 0 1-6.963 1.891 10.52 10.52 0 0 1-6.533-3.039 1 1 0 0 1 1.414-1.414 8.52 8.52 0 0 0 5.288 2.46 8.48 8.48 0 0 0 5.636-1.528 8.52 8.52 0 0 0 3.321-4.805 8.5 8.5 0 0 0-.564-5.807v-.002A8.46 8.46 0 0 0 16 4.684a8.5 8.5 0 0 0-5.825-.422A8.53 8.53 0 0 0 5.45 7.699h-.001a8.6 8.6 0 0 0-1.377 3.66l.51-.61a1 1 0 0 1 1.535 1.282l-2.18 2.61a1 1 0 0 1-1.536-.001l-2.17-2.61a1 1 0 0 1 1.537-1.28l.318.383a10.6 10.6 0 0 1 1.703-4.548v-.002A10.53 10.53 0 0 1 9.625 2.34"></path><path d="M12 8.401a1 1 0 0 1 1 1v3.55l2.535 1.606a1 1 0 0 1-1.07 1.689l-3-1.9a1 1 0 0 1-.465-.845V9.4a1 1 0 0 1 1-1"></path></g></svg>${this._formatRelativeTime(task.updated_at)}</div>`
      : '';
    // Media type badge — đồng bộ style với history-item-badge (icon + text)
    // Resolve mode theo provider: Grok dùng grok_mode, các provider khác dùng media_type
    const mediaTypeBadgeHtml = (() => {
      const provider = task.provider || 'flow';
      let mode = 'image';
      if (provider === 'grok') {
        mode = (task.grok_mode === 'video') ? 'video' : 'image';
      } else if (provider === 'chatgpt') {
        mode = 'image'; // ChatGPT image only
      } else {
        mode = (task.media_type === 'Video') ? 'video' : 'image';
      }
      const mediaIcon = mode === 'video'
        ? '<svg class="task-media-badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>'
        : '<svg class="task-media-badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
      return `<span class="task-media-badge task-media-badge-${mode}">${mediaIcon}${mode}</span>`;
    })();

    // Provider badge — đồng bộ style với history-item-provider (icon thật từ provider logos)
    const providerBadgeHtml = (() => {
      const provider = task.provider || 'flow';
      if (provider === 'chatgpt') {
        const cgIcon = '<svg class="task-provider-badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/></svg>';
        return `<span class="task-provider-badge task-provider-badge-chatgpt" title="ChatGPT">${cgIcon}ChatGPT</span>`;
      }
      if (provider === 'grok') {
        const grokIcon = '<svg class="task-provider-badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd"><path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815"/></svg>';
        return `<span class="task-provider-badge task-provider-badge-grok" title="Grok">${grokIcon}Grok</span>`;
      }
      const flowIcon = '<svg class="task-provider-badge-icon" width="12" height="12" viewBox="0 0 24 24"><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="#3186FF"/></svg>';
      return `<span class="task-provider-badge task-provider-badge-flow" title="Google Flow">${flowIcon}Flow</span>`;
    })();

    return `
      <div class="task-card ${statusClass} ${isSelected ? 'selected' : ''} ${!isEnabled ? 'task-disabled' : ''} ${crossProjectClass}" data-task-id="${task.task_id}">
        <div class="drag-handle" title="${window.I18n?.t('tasks.dragHandle') || 'Kéo để sắp xếp'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="4" r="2"/><circle cx="16" cy="4" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="8" cy="20" r="2"/><circle cx="16" cy="20" r="2"/></svg>
        </div>
        <div class="task-card-checkbox">
          <input type="checkbox" ${isSelected ? 'checked' : ''} ${task.status === 'running' ? 'disabled' : ''} />
        </div>
        <span class="task-card-status ${statusClass}" data-tooltip="${statusLabel}" aria-label="${statusLabel}">${statusIcon}</span>
        <div class="task-card-info">
          <div class="task-card-name-row">
            <span class="task-card-name">${this.escapeHtml(task.task_name || (window.I18n?.t('tasks.noName') || 'Không có tên'))}</span>
            ${providerBadgeHtml}
            ${mediaTypeBadgeHtml}
            ${inlineProgressHtml}
          </div>
          <div class="task-card-prompt">${this.escapeHtml(task.prompt || '')}</div>
          <div class="task-card-meta">
            ${(() => {
              // Bug 2 fix: render setting fields phù hợp theo provider (Flow/ChatGPT/Grok).
              // Trước luôn hiển thị Flow-style (media_type/model/quantity) cho mọi task.
              const _p = task.provider || 'flow';
              const ratioMap = { story: '9:16', portrait: '3:4', square: '1:1', landscape: '4:3', widescreen: '16:9' };
              const _fmtRatio = (k) => ratioMap[k] || k || '';
              // Icon mapping match dropdown ở sidebar.html settings.
              // Accept cả numeric ('16:9') lẫn key chatgpt/grok ('widescreen', 'story', ...).
              const _ratioIcon = (ratio) => {
                const numeric = ratioMap[ratio] || ratio;
                if (numeric === '16:9') return '▬';   // ▬ wide horizontal
                if (numeric === '4:3') return '▭';    // ▭ landscape
                if (numeric === '1:1') return '□';    // □ square
                if (numeric === '3:4') return '▯';    // ▯ portrait
                if (numeric === '9:16') return '▮';   // ▮ vertical tall
                return '';
              };

              // Note: media type (Image/Video) \u0111\u00E3 hi\u1EC3n th\u1ECB \u1EDF badge ph\u00EDa tr\u00EAn (task-media-badge)
              // \u2192 meta row ch\u1EC9 hi\u1EC7n ratio/extras/quantity, kh\u00F4ng l\u1EB7p l\u1EA1i mode.
              if (_p === 'grok') {
                const isVideo = task.grok_mode === 'video';
                const ratio = task.ratio || 'widescreen';
                const ratioLabel = _fmtRatio(ratio);
                const ratioIcon = _ratioIcon(ratio);
                const extras = [];
                if (isVideo) {
                  if (task.grok_duration) extras.push(task.grok_duration);
                  if (task.grok_resolution) extras.push(task.grok_resolution);
                } else {
                  // Lu\u00F4n hi\u1EC3n th\u1ECB image quality (k\u1EC3 c\u1EA3 'speed') \u0111\u1EC3 user th\u1EA5y \u0111\u00FAng setting \u0111ang ch\u1ECDn
                  if (task.grok_image_quality) extras.push(task.grok_image_quality);
                }
                const qtyHtml = (task.quantity && task.quantity > 1) ? `<span>x${task.quantity}</span>` : '';
                const extrasHtml = extras.length ? `<span>${extras.join(' \u00B7 ')}</span>` : '';
                return `<span>${ratioIcon} ${ratioLabel}</span>${extrasHtml}${qtyHtml}`;
              }
              if (_p === 'chatgpt') {
                const ratio = task.ratio || 'story';
                const ratioLabel = _fmtRatio(ratio);
                const ratioIcon = _ratioIcon(ratio);
                return `<span>${ratioIcon} ${ratioLabel}</span>`;
              }
              // Flow (default) — giữ nguyên hành vi cũ
              // Flow ratio icon \u1EDF b\u00EAn tr\u00E1i ratio number (\u0111\u1ED3ng b\u1ED9 v\u1EDBi ChatGPT/Grok)
              const flowRatio = task.ratio || '16:9';
              const flowRatioIcon = _ratioIcon(flowRatio);
              // Strict Server-Only: task.model (user save) → ModelRegistry (server) → empty (UI placeholder).
              return `<span>${task.model || window.ModelRegistry?.safeGetDefault('flow', 'image') || ''}</span><span>${flowRatioIcon} ${flowRatio}</span><span>x${task.quantity || 1}</span>`;
            })()}
            ${refPreviewHtml}
            ${refPreviewHtml && resultPreviewHtml ? '<span class="task-card-arrow"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg></span>' : ''}
            ${resultPreviewHtml}
          </div>
          ${lastRunHtml || lastEditHtml}
        </div>
        <div class="task-card-actions">
          <button class="task-toggle-btn ${isEnabled ? 'on' : 'off'}" title="${isEnabled ? (window.I18n?.t('tasks.disableTask') || 'Tắt task') : (window.I18n?.t('tasks.enableTask') || 'Bật task')}">
            <span class="task-toggle-track"><span class="task-toggle-thumb"></span></span>
          </button>
          ${isRunning ? `
            <button class="btn btn-secondary btn-sm btn-warning run-btn" title="${window.I18n?.t('common.stop') || 'Dừng'}">
              ${runBtnIcon}
            </button>
          ` : `
            <div class="seosonaflow-dot-menu" data-task-id="${task.task_id}">
              <button class="btn btn-secondary btn-sm seosonaflow-dot-menu-btn" title="Menu">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="5" r="1"></circle>
                  <circle cx="12" cy="12" r="1"></circle>
                  <circle cx="12" cy="19" r="1"></circle>
                </svg>
              </button>
              <div class="seosonaflow-dropdown-menu hidden">
                <button class="seosonaflow-dropdown-item edit-btn">
                  <svg width="14" height="14" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15.75 15.7502H9.75002M1.875 16.1252L6.03695 14.5245C6.30316 14.4221 6.43626 14.3709 6.56079 14.3041C6.6714 14.2447 6.77685 14.1761 6.87603 14.0992C6.98769 14.0125 7.08853 13.9117 7.29021 13.71L15.75 5.25023C16.5784 4.4218 16.5784 3.07865 15.75 2.25023C14.9216 1.4218 13.5784 1.4218 12.75 2.25022L4.29021 10.71C4.08853 10.9117 3.98769 11.0125 3.90104 11.1242C3.82408 11.2234 3.75555 11.3288 3.69618 11.4394C3.62933 11.564 3.57814 11.6971 3.47575 11.9633L1.875 16.1252ZM1.875 16.1252L3.41859 12.1119C3.52905 11.8248 3.58428 11.6812 3.67901 11.6154C3.76179 11.5579 3.86423 11.5362 3.96322 11.5551C4.0765 11.5767 4.18529 11.6855 4.40286 11.9031L6.09718 13.5974C6.31475 13.815 6.42354 13.9237 6.44517 14.037C6.46408 14.136 6.44234 14.2385 6.38486 14.3212C6.31908 14.416 6.17549 14.4712 5.8883 14.5817L1.875 16.1252Z"/></svg>
                  ${I18n.t('common.edit') || 'Edit'}
                </button>
                <button class="seosonaflow-dropdown-item run-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                  ${task.status === 'completed' ? I18n.t('tasks.rerun') : I18n.t('common.run')}
                </button>
                <button class="seosonaflow-dropdown-item reset-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>
                  ${I18n.t('tasks.reset') || 'Reset'}
                </button>
                ${task.result_file_ids ? `
                <button class="seosonaflow-dropdown-item download-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  ${I18n.t('common.download') || 'Download'}
                </button>
                ` : ''}
                <button class="seosonaflow-dropdown-item copy-btn">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                  ${I18n.t('tasks.duplicate') || 'Duplicate'}
                </button>
                <button class="seosonaflow-dropdown-item delete-btn seosonaflow-dropdown-danger" ${isRunning ? 'disabled' : ''}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                  ${I18n.t('common.delete') || 'Delete'}
                </button>
              </div>
            </div>
          `}
        </div>
      </div>
    `;
  }

  toggleSelect(taskId, selected) {
    if (selected) {
      this.selectedTasks.add(taskId);
    } else {
      this.selectedTasks.delete(taskId);
    }
    this.updateBatchActions();
  }

  updateBatchActions() {
    const batchActions = this.container.querySelector('#batchActions');
    const selectedCount = this.container.querySelector('#selectedCount');

    if (this.selectedTasks.size > 0) {
      batchActions?.classList.remove('hidden');
      if (selectedCount) selectedCount.textContent = this.selectedTasks.size;
    } else {
      batchActions?.classList.add('hidden');
    }
  }

  async runTask(taskId) {
    const task = this.tasks.find(t => t.task_id === taskId);
    if (!task) return;

    // Double-click guard: track in-flight run requests per task
    // Tránh user click "Run" rapid 2 lần → spawn 2 execution trước khi status flip 'running'
    if (!this._pendingRunIds) this._pendingRunIds = new Set();
    // Chỉ guard khi click run NEW (status không phải running). Nếu đang running → cho phép click stop.
    if (task.status !== 'running' && this._pendingRunIds.has(taskId)) {
      console.log('[TaskList] runTask ignored — already pending for', taskId);
      return;
    }
    if (task.status !== 'running') {
      this._pendingRunIds.add(taskId);
      // Auto-clear sau 5s phòng case status không flip do error
      setTimeout(() => this._pendingRunIds?.delete(taskId), 5000);
    }

    // Y-4: Cross-project guard
    if (window.ProjectHelper && !window.ProjectHelper.isCurrentProject(task)) {
      const action = await window.ProjectHelper.showCrossProjectWarning(task, 'task');
      if (action === 'switch') {
        window.ProjectHelper.navigateToProject(task.project_id);
      }
      return;
    }

    // Nếu task đang chạy → dừng
    if (task.status === 'running') {
      window._taskShouldStop = true;
      // SP-2.8: ExecutionGate cancel on task stop
      if (window.ExecutionGate && window._currentTaskExecutionToken) {
        window.ExecutionGate.cancel(window._currentTaskExecutionToken);
        window._currentTaskExecutionToken = null;
      }
      // Propagate stop signal — route theo provider để abort đúng content script.
      // Trước fix: chỉ stopExecution() (Flow) → Grok task stuck cho đến watchdog poll 500ms
      // hoặc adapter timeout. Giờ gọi grokAbort() ngay khi user click Stop.
      if (window.MessageBridge) {
        const provider = task.provider || 'flow';
        if (provider === 'grok' && window.GrokSession?.getTabInfo) {
          window.GrokSession.getTabInfo().then(info => {
            if (info?.tabId) MessageBridge.grokAbort(info.tabId).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskList#runTask', _e); });
          }).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskList#runTask', _e); });
        } else {
          // Flow / ChatGPT path — content.js stop signal
          MessageBridge.stopExecution().catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskList#runTask', _e); });
        }
      }

      // Force reset task status nếu stuck (sau reload extension, không có execution thực)
      // Đợi 1s cho stop signal propagate, nếu status vẫn running → force reset
      setTimeout(async () => {
        const currentTask = this.tasks.find(t => t.task_id === taskId);
        if (currentTask && currentTask.status === 'running') {
          console.log('[TaskList] Force reset stuck task:', taskId);
          currentTask.status = 'pending';
          try {
            await window.storageManager?.updateTaskStatus(taskId, 'pending');
          } catch (e) {
            console.warn('[TaskList] Failed to reset task status:', e.message);
          }
          // Update UI
          this._updateCardRunningState(taskId, false, 'pending');
        }
      }, 1000);

      return;
    }

    // Check run limit for task (applies to both anonymous and logged-in users)
    if (window.featureGate) {
      const quota = await window.featureGate.checkQuotaAsync('tasks_run_max');
      if (!quota.allowed) {
        const isLoggedIn = true;
        if (isLoggedIn) {
          const limitText = quota.limit === 'unlimited' ? (window.I18n?.t('tasks.runQuotaUnlimited') || 'Không giới hạn') : `${quota.limit} lượt/ngày`;
          window.customDialog?.alert(
            window.I18n?.t('tasks.runQuotaMsg', { limit: limitText, used: quota.used }) || `Đã hết lượt sử dụng Task hôm nay.\n\nGiới hạn: ${limitText}\nĐã dùng: ${quota.used} lượt\n\nNâng cấp gói để tăng giới hạn.`,
            { title: window.I18n?.t('tasks.runQuotaTitle') || 'Hết lượt Task' }
          );
        } else {
          window.featureGate.showLoginPrompt(window.I18n?.t('tasks.trialExhaustedRun') || 'Bạn đã sử dụng hết lượt chạy task trong bản dùng thử.');
        }
        return;
      }

      // GP-6.3 / GP-6.4: Check global quota warning/exhausted
      const quotaCheck = window.featureGate.checkGlobalQuotaWarning('Task');
      if (quotaCheck.exhausted) {
        return; // Dialog đã hiển thị bởi FeatureGate
      }

      // Set flag to record run AFTER task completes successfully
      window.featureGate.setPendingTaskRun();
    }

    // Fire-and-forget: Activate provider tab SONG SONG với modal (không await)
    // Tab sẽ sẵn sàng khi user confirm xong
    const provider = task.provider || 'flow';
    const providerLabel = { flow: 'Flow', chatgpt: 'ChatGPT', grok: 'Grok' }[provider] || provider;
    const I = window.I18n;

    try {
      if (provider === 'chatgpt' && window.ChatGPTSession) {
        window.ChatGPTSession.ensureReady({ createIfMissing: true, activate: true }).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskList#runTask', _e); });
      } else if (provider === 'grok' && window.GrokSession) {
        window.GrokSession.ensureReady({ createIfMissing: true, activate: true }).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskList#runTask', _e); });
      } else if (provider === 'flow') {
        chrome.runtime.sendMessage({ action: 'ensureFlowTabReady' }).catch?.(() => {});
      }
    } catch (_) { /* fire-and-forget */ }

    // Bug fix 2026-05-22: check duplicate provider tabs TRƯỚC khi show reconfirm modal.
    // Multi-tab cùng provider URL → session manager confused (dùng tabs[0]) → stale + RAM waste.
    // Fire-and-forget interactive modal (user có thể đóng tabs thừa hoặc ignore + tiếp tục).
    if (window.GenTab?._checkDuplicateProviderTabs) {
      try {
        window.GenTab._checkDuplicateProviderTabs(provider, { interactive: true });
      } catch (e) { console.warn('[TaskList] duplicate tab check failed:', e?.message || e); }
    }

    // Show custom confirm modal với provider status display + polling
    const confirmed = await TaskList._showTaskConfirmModal(task, provider, providerLabel);
    if (!confirmed) {
      this._pendingRunIds?.delete(taskId);
      return;
    }

    // Full check sau confirm: đảm bảo provider thực sự ready + login OK
    try {
      if (provider === 'chatgpt' && window.ChatGPTSession) {
        const result = await window.ChatGPTSession.ensureReady({ createIfMissing: true, activate: true });
        if (!result?.ready) {
          window.showNotification?.(I?.t('tasks.providerNotReady', { provider: 'ChatGPT' }) || 'ChatGPT chưa sẵn sàng. Vui lòng đăng nhập.', 'warning', 3000);
          this._pendingRunIds?.delete(taskId);
          return;
        }
        if (result?.tabId) {
          chrome.tabs.update(result.tabId, { active: true });
        }
      } else if (provider === 'grok' && window.GrokSession) {
        const result = await window.GrokSession.ensureReady({ createIfMissing: true, activate: true });
        if (!result?.ready) {
          window.showNotification?.(I?.t('tasks.providerNotReady', { provider: 'Grok' }) || 'Grok chưa sẵn sàng. Vui lòng đăng nhập.', 'warning', 3000);
          this._pendingRunIds?.delete(taskId);
          return;
        }
        if (result?.tabId) {
          chrome.tabs.update(result.tabId, { active: true });
        }
      } else if (provider === 'flow' && window.MessageBridge) {
        // Flow: activate via background (đã fire-and-forget, giờ chỉ cần activate lại)
        chrome.runtime.sendMessage({ action: 'ensureFlowTabReady' }, (resp) => {
          if (resp?.tabId) chrome.tabs.update(resp.tabId, { active: true });
        });
      }
    } catch (tabErr) {
      console.warn('[TaskList] Activate provider tab failed:', tabErr.message);
      window.showNotification?.(I?.t('tasks.providerActivateFailed') || 'Không thể kích hoạt provider tab', 'error', 3000);
      this._pendingRunIds?.delete(taskId);
      return;
    }

    // Auto-reset completed task before re-running - clear results để merge không bị duplicate
    if (task.status === 'completed') {
      task.status = 'pending';
      task.result_file_ids = '';
      task.result_thumbnails = {};
      task.result_file_names = {};
      task.error_message = '';
      if (window.storageManager) {
        try {
          await window.storageManager.saveTask(task);
          // Đợi một chút để đảm bảo server đã persist trước khi execution fetch
          await new Promise(r => setTimeout(r, 100));
        } catch (e) {
          console.warn('[TaskList] Reset task before re-run failed:', e.message);
        }
      }
    }

    window.showNotification?.(I?.t('tasks.running', { name: task.task_name || 'Task' }) || `Đang chạy: ${task.task_name || 'Task'}`, 'success', 2000);
    if (window.eventBus) {
      // Audit fix (stuck-state): if the task:run listener throws synchronously,
      // the task could otherwise be left mid-flight forever. Mark it failed and
      // release the pending guard so the UI recovers instead of staying 'running'.
      try {
        window.eventBus.emit('task:run', { task });
      } catch (emitErr) {
        console.error('[TaskList] task:run emit threw:', emitErr);
        task.status = 'failed';
        task.error_message = emitErr?.message || String(emitErr);
        this._pendingRunIds?.delete(taskId);
        if (window.storageManager) {
          try { await window.storageManager.saveTask(task); } catch (_) { globalThis.SEOSONA_swallow?.('TaskList#runTask', _); }
        }
        try { this.render?.(); } catch (_) { globalThis.SEOSONA_swallow?.('TaskList#runTask', _); }
        window.showNotification?.(I?.t('tasks.runFailed') || 'Chạy task thất bại', 'error', 3000);
      }
    }
  }

  async resetTask(taskId) {
    const task = this.tasks.find(t => t.task_id === taskId);
    if (!task) return;

    task.status = 'pending';
    task.result_file_ids = '';
    task.result_thumbnails = {};
    task.result_file_names = {};
    task.error_message = '';
    try {
      if (window.storageManager) {
        await window.storageManager.saveTask(task);
      }
      this.renderTaskList();
      window.showNotification?.(window.I18n?.t('tasks.taskReset') || 'Task đã reset', 'success', 1500);
    } catch (e) {
      console.error('[TaskList] Reset failed:', e);
    }
  }

  async toggleTaskEnabled(taskId) {
    const task = this.tasks.find(t => t.task_id === taskId);
    if (!task) return;
    task.enabled = task.enabled === false ? true : false;
    const cardEl = this._listContainer?.querySelector(`.task-card[data-task-id="${taskId}"]`);
    if (cardEl) {
      this._updateCard(cardEl, task);
    } else {
      this.renderTaskList();
    }
    try {
      if (window.storageManager) await window.storageManager.saveTask(task);
    } catch (e) {
      console.error('[TaskList] Toggle enabled failed:', e);
    }
  }

  toggleRunMode() {
    this.runMode = this.runMode === 'parallel' ? 'sequential' : 'parallel';
    const btn = this.container.querySelector('#taskRunModeBtn');
    if (!btn) return;

    const label = btn.querySelector('.task-run-mode-label');
    const isSequential = this.runMode === 'sequential';

    btn.classList.toggle('active', isSequential);
    btn.title = isSequential
      ? (window.I18n?.t('tasks.runModeSequentialTitle') || 'Chế độ chạy: Tuần tự')
      : (window.I18n?.t('tasks.runModeParallelTitle') || 'Chế độ chạy: Song song');

    if (label) {
      label.textContent = isSequential
        ? (window.I18n?.t('tasks.sequential') || 'Tuần tự')
        : (window.I18n?.t('tasks.parallel') || 'Song song');
    }

    // Update icon
    const svg = btn.querySelector('svg');
    if (svg) {
      if (isSequential) {
        // Sequential icon: numbered list
        svg.innerHTML = '<line x1="10" y1="6" x2="21" y2="6"></line><line x1="10" y1="12" x2="21" y2="12"></line><line x1="10" y1="18" x2="21" y2="18"></line><polyline points="3 6 4 7 6 5"></polyline><polyline points="3 12 4 13 6 11"></polyline><polyline points="3 18 4 19 6 17"></polyline>';
      } else {
        // Parallel icon: three horizontal lines
        svg.innerHTML = '<line x1="4" y1="6" x2="20" y2="6"></line><line x1="4" y1="12" x2="20" y2="12"></line><line x1="4" y1="18" x2="20" y2="18"></line>';
      }
    }
  }

  _setRunAllButtonRunning() {
    const btn = this.container.querySelector('#runAllTasksBtn');
    if (!btn) return;
    this.isRunningAll = true;
    btn.classList.add('btn-stop');
    btn.title = window.I18n?.t('tasks.stopAll') || 'Dừng tất cả';
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="6" y="6" width="12" height="12"></rect>
      </svg>
      ${window.I18n?.t('tasks.stop') || 'Dừng'}
    `;
  }

  _resetRunAllButton() {
    const btn = this.container.querySelector('#runAllTasksBtn');
    if (!btn) return;
    this.isRunningAll = false;
    this.shouldStopAll = false;
    btn.classList.remove('btn-stop');
    btn.disabled = false;
    btn.title = window.I18n?.t('tasks.runAll') || 'Chạy tất cả';
    btn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polygon points="5 3 19 12 5 21 5 3"></polygon>
      </svg>
      ${window.I18n?.t('tasks.runAll') || 'Chạy tất cả'}
    `;
    // Hide progress bar
    this._hideBatchProgress();
  }

  // ─── Progress Bar Methods ────────────────────────────────

  _showBatchProgress(total) {
    const progressEl = this.container.querySelector('#taskBatchProgress');
    if (!progressEl) return;
    progressEl.classList.remove('hidden');
    this._batchTotal = total;
    this._batchCurrent = 0;
    this._updateBatchProgress(0, total);
  }

  _updateBatchProgress(current, total) {
    const labelEl = this.container.querySelector('#taskBatchProgressLabel');
    const countEl = this.container.querySelector('#taskBatchProgressCount');
    const fillEl = this.container.querySelector('#taskBatchProgressFill');

    if (labelEl) {
      labelEl.textContent = window.I18n?.t('tasks.runningTasks') || 'Đang chạy tasks...';
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
    const progressEl = this.container.querySelector('#taskBatchProgress');
    if (progressEl) {
      progressEl.classList.add('hidden');
    }
  }

  _checkBatchComplete() {
    if (!this.isRunningAll) return;
    // Check if any task is still running
    const hasRunning = this.tasks.some(t => t.status === 'running');
    if (!hasRunning) {
      this._resetRunAllButton();
    }
  }

  stopAllTasks() {
    this.shouldStopAll = true;
    window._taskBatchStopped = true;
    window._taskShouldStop = true;

    // SP-2.8: ExecutionGate cancel on batch stop
    if (window.ExecutionGate && window._currentTaskExecutionToken) {
      window.ExecutionGate.cancel(window._currentTaskExecutionToken);
      window._currentTaskExecutionToken = null;
    }

    // Pipeline mode: stop jobs by owner 'task'
    if (window.PromptQueue && PromptQueue.isEnabled()) {
      const queue = PromptQueue.getInstance();
      const taskJobs = queue.getJobsByOwner('task') || [];
      for (const job of taskJobs) {
        queue.stopJob(job.id);
      }
    }

    // Legacy mode: propagate stop to content.js + Grok content script.
    // Bug fix: trước đây chỉ stop Flow → Grok task tiếp tục sau khi user click Stop All.
    if (window.MessageBridge) {
      MessageBridge.stopExecution().catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskList#stopAllTasks', _e); });
      // Abort Grok content script nếu có Grok session active
      if (window.GrokSession?.getTabInfo) {
        window.GrokSession.getTabInfo().then(info => {
          if (info?.tabId) MessageBridge.grokAbort(info.tabId).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskList#stopAllTasks', _e); });
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskList#stopAllTasks', _e); });
      }
    }
    if (window.eventBus) {
      window.eventBus.emit('tasks:stop_all');
    }
    // Đổi nút thành "Đang dừng..." rồi đợi tasks thực sự dừng
    const btn = this.container.querySelector('#runAllTasksBtn');
    if (btn) {
      btn.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="6" y="6" width="12" height="12"></rect>
        </svg>
        ${window.I18n?.t('tasks.stoppingAll') || 'Đang dừng...'}
      `;
      btn.disabled = true;
    }
    // Button sẽ reset khi _checkBatchComplete phát hiện không còn task running
    // hoặc khi tasks:batch_complete event fire
  }

  async runAllTasks() {
    if (this.tasks.length === 0) return;

    // Double-click guard: ngăn user click "Run All" 2 lần liên tiếp → spawn 2 batch
    if (this._isRunningAllInFlight) {
      console.log('[TaskList] runAllTasks ignored — already in-flight');
      return;
    }
    this._isRunningAllInFlight = true;
    // Auto-clear nếu chưa kịp tới batch start (vd user cancel ở confirm dialog)
    const _clearGuard = () => { this._isRunningAllInFlight = false; };
    setTimeout(_clearGuard, 30000); // 30s safety timeout

    try {
      return await this._runAllTasksImpl(_clearGuard);
    } finally {
      _clearGuard();
    }
  }

  async _runAllTasksImpl(_clearGuard) {
    // Trial gate: giới hạn chạy task (async to ensure fresh data)
    if (window.featureGate) {
      const quota = await window.featureGate.checkQuotaAsync('tasks_run_max');
      if (!quota.allowed) {
        const isLoggedIn = true;
        if (isLoggedIn) {
          const limitText = quota.limit === 'unlimited' ? (window.I18n?.t('tasks.runQuotaUnlimited') || 'Không giới hạn') : `${quota.limit} lượt/ngày`;
          window.customDialog?.alert(
            window.I18n?.t('tasks.runQuotaMsg', { limit: limitText, used: quota.used }) || `Đã hết lượt sử dụng Task hôm nay.\n\nGiới hạn: ${limitText}\nĐã dùng: ${quota.used} lượt\n\nNâng cấp gói để tăng giới hạn.`,
            { title: window.I18n?.t('tasks.runQuotaTitle') || 'Hết lượt Task' }
          );
        } else {
          window.featureGate.showLoginPrompt(window.I18n?.t('tasks.trialExhaustedRun') || 'Bạn đã sử dụng hết lượt chạy task trong bản dùng thử.');
        }
        return;
      }

      // GP-6.3 / GP-6.4: Check global quota warning/exhausted
      const quotaCheck = window.featureGate.checkGlobalQuotaWarning('Task');
      if (quotaCheck.exhausted) {
        return; // Dialog đã hiển thị bởi FeatureGate
      }
    }

    // Y-4: Only run tasks from current project
    const currentProjectTasks = window.ProjectHelper
      ? this.tasks.filter(t => window.ProjectHelper.isCurrentProject(t))
      : this.tasks;
    const enabledTasks = currentProjectTasks.filter(t => t.enabled !== false && t.status !== 'completed');

    // GP-6.5: Calculate total prompts for global quota check (multi-prompt tasks count multiple)
    const totalPrompts = enabledTasks.reduce((sum, t) => {
      return sum + ((t.multi_prompt && t.prompts?.length > 1) ? t.prompts.length : 1);
    }, 0);
    if (window.featureGate) {
      const globalRemaining = window.featureGate.getGlobalRemaining?.() ?? Infinity;
      if (globalRemaining !== Infinity && totalPrompts > globalRemaining) {
        await window.customDialog?.alert(
          window.I18n?.t('taskNotify.quotaInsufficient', { need: totalPrompts, remaining: globalRemaining }) ||
            `Cần ${totalPrompts} lượt prompt nhưng chỉ còn ${globalRemaining} lượt. Vui lòng giảm số task hoặc nâng cấp.`,
          { type: 'warning', title: window.I18n?.t('taskNotify.quotaInsufficientTitle') || 'Không đủ quota' }
        );
        return;
      }

      // Batch limit check: kiểm tra từng multi-prompt task có vượt quá limit không
      const batchLimit = window.featureGate.getPromptBatchLimit?.() ?? 4;
      if (batchLimit !== -1) {
        const overLimitTasks = enabledTasks.filter(t =>
          t.multi_prompt && t.prompts?.length > batchLimit
        );
        if (overLimitTasks.length > 0) {
          const taskNames = overLimitTasks.map(t => `"${t.name}"`).slice(0, 3).join(', ');
          const moreCount = overLimitTasks.length - 3;
          const moreText = moreCount > 0
            ? (window.I18n?.t?.('tasks.batchLimitMoreTasks', { count: moreCount }) || ` (và ${moreCount} task khác)`)
            : '';
          await window.customDialog?.alert(
            window.I18n?.t?.('tasks.batchLimitExceeded', { limit: batchLimit, tasks: taskNames + moreText }) ||
            (window.I18n?.t?.('taskNotify.batchLimitExceededFallback', { limit: batchLimit, tasks: taskNames + moreText }) ||
              `Gói của bạn giới hạn ${batchLimit} prompt/batch.\n\nCác task vượt giới hạn:\n${taskNames}${moreText}\n\nGiảm số prompt hoặc nâng cấp để tăng giới hạn.`),
            { type: 'warning', title: window.I18n?.t?.('tasks.batchLimitTitle') || 'Vượt giới hạn gói' }
          );
          return;
        }
      }
    }
    const disabledCount = currentProjectTasks.filter(t => t.enabled === false).length;
    const doneCount = currentProjectTasks.filter(t => t.enabled !== false && t.status === 'completed').length;

    if (enabledTasks.length === 0) {
      await window.customDialog.alert(
        window.I18n?.t('tasks.noTasksToRun') || 'Không có task nào để chạy. Kiểm tra lại trạng thái bật/tắt và đã hoàn thành.',
        { title: window.I18n?.t('tasks.noTasksToRunTitle') || 'Không có task để chạy' }
      );
      return;
    }

    // CG-6.4 + G-5.7: Force sequential khi có:
    //  - multi-prompt task (Flow chỉ có 1 editor, parallel sẽ xung đột)
    //  - mixed provider trong batch (Flow + ChatGPT/Grok chạy parallel sẽ tranh tab)
    //  - bất kỳ ChatGPT task nào (ChatGPT chỉ có 1 tab/editor → không parallel được)
    //  - bất kỳ Grok task nào (Grok 1 tab + redirect flow → không parallel được)
    const hasMultiPrompt = enabledTasks.some(t => t.multi_prompt && t.prompts && t.prompts.length > 1);
    const providerSet = new Set(enabledTasks.map(t => t.provider || 'flow'));
    const hasMixedProvider = providerSet.size > 1;
    const hasChatGPT = providerSet.has('chatgpt');
    const hasGrok = providerSet.has('grok');
    const forceSequential = hasMultiPrompt || hasMixedProvider || hasChatGPT || hasGrok;
    const effectiveMode = (forceSequential && this.runMode === 'parallel') ? 'sequential' : this.runMode;

    if (forceSequential && this.runMode === 'parallel') {
      console.log('[TaskList] Forcing sequential mode:', { hasMultiPrompt, hasMixedProvider, hasChatGPT, hasGrok });
    }

    const modeLabel = effectiveMode === 'sequential' ? (window.I18n?.t('tasks.modeSequential') || 'tuần tự') : (window.I18n?.t('tasks.modeParallel') || 'song song');
    let message = window.I18n?.t('tasks.runConfirmMsg', { mode: modeLabel, count: enabledTasks.length }) || `Chạy ${modeLabel} ${enabledTasks.length} tasks?`;
    const notes = [];
    if (hasMultiPrompt && this.runMode === 'parallel') {
      notes.push(window.I18n?.t('tasks.hasMultiPromptNote') || 'Có task multi-prompt, tự động chuyển sang tuần tự');
    }
    // G-5.7: Grok-specific note (chỉ hiện khi không có ChatGPT/mixed/multi-prompt)
    if (hasGrok && this.runMode === 'parallel' && !hasMultiPrompt && !hasMixedProvider && !hasChatGPT) {
      notes.push(window.I18n?.t('tasks.hasGrokNote') || 'Có task Grok, tự động chuyển sang tuần tự');
    }
    if ((hasMixedProvider || hasChatGPT) && this.runMode === 'parallel' && !hasMultiPrompt) {
      notes.push(window.I18n?.t('tasks.hasChatGPTNote') || 'Có task ChatGPT (hoặc mixed provider), tự động chuyển sang tuần tự');
    }
    if (disabledCount > 0) notes.push(window.I18n?.t('tasks.disabledSkipNote', { count: disabledCount }) || `${disabledCount} task đang tắt sẽ bị bỏ qua`);
    if (doneCount > 0) notes.push(window.I18n?.t('tasks.doneSkipNote', { count: doneCount }) || `${doneCount} task đã hoàn thành sẽ bị bỏ qua`);
    if (notes.length > 0) message += '\n\n' + notes.join('. ') + '.';

    // Show 3-button modal khi tasks Flow-only + pipeline rỗng → cho phép user reload Flow
    // page trước khi chạy (refresh DOM/session để giảm fail trong fail-prone hour).
    // Else: 2-button confirm bình thường.
    const allFlow = !hasChatGPT && !hasGrok && !hasMixedProvider;
    const pq = window.PromptQueue?.getInstance?.();
    const activeJobs = pq?._jobs ? Array.from(pq._jobs.values()).filter(j => j.isActive).length : 0;
    const pipelineEmpty = activeJobs === 0;
    const showReloadOption = allFlow && pipelineEmpty;

    let userAction = 'cancel'; // 'cancel' | 'run' | 'reload-then-run'
    if (showReloadOption) {
      await new Promise(resolve => {
        window.customDialog.alert(message, {
          title: window.I18n?.t('tasks.runConfirmTitle') || 'Chạy tất cả',
          type: 'warning',
          buttons: [
            { label: window.I18n?.t('common.cancel') || 'Hủy', primary: false, action: () => { userAction = 'cancel'; resolve(); } },
            { label: window.I18n?.t('tasks.reloadThenRun') || 'Reload Flow + Chạy', primary: false, action: () => { userAction = 'reload-then-run'; resolve(); } },
            { label: window.I18n?.t('common.run') || 'Chạy', primary: true, action: () => { userAction = 'run'; resolve(); } },
          ],
        });
      });
    } else {
      const ok = await window.customDialog.confirm(message, { title: window.I18n?.t('tasks.runConfirmTitle') || 'Chạy tất cả' });
      userAction = ok ? 'run' : 'cancel';
    }
    if (userAction === 'cancel') return;

    // Reload Flow page nếu user chọn "Reload + Chạy"
    if (userAction === 'reload-then-run') {
      try {
        if (window.PromptQueue?.getInstance?.()?.forceReloadAndStabilize) {
          await window.PromptQueue.getInstance().forceReloadAndStabilize('user-pre-task-batch');
        } else if (window.MessageBridge) {
          await window.MessageBridge.sendToContentScript('autoReloadFlow', {});
          await new Promise(r => setTimeout(r, 3000));
        }
        console.log('[TaskList] Đã reload Flow page trước khi chạy task batch');
      } catch (e) {
        console.warn('[TaskList] Reload Flow trước task batch fail (degrade):', e.message);
      }
    }

    // Set flag to record trial run AFTER first task completes successfully
    // (not before, to avoid counting failed/cancelled runs)
    if (window.featureGate) {
      window.featureGate.setPendingTaskRun();
    }

    // Set running state + update button to Stop
    this.shouldStopAll = false;
    window._taskBatchStopped = false;
    this._setRunAllButtonRunning();
    this._showBatchProgress(enabledTasks.length);

    // Reset result data trước khi batch run để tránh append lẫn lộn kết quả cũ + mới.
    // Áp dụng cho TẤT CẢ enabledTasks (kể cả failed/pending có result_file_ids cũ từ lần chạy trước).
    for (const task of enabledTasks) {
      task.status = 'pending';
      task.result_file_ids = '';
      task.result_thumbnails = {};
      task.result_file_names = {};
      task.error_message = '';
      try {
        if (window.storageManager) {
          await window.storageManager.saveTask(task);
        }
      } catch (e) {
        console.warn('[TaskList] runAllTasks reset save failed:', e);
      }
    }
    this.renderTaskList();

    if (effectiveMode === 'sequential') {
      // Tuần tự: chạy từng task, chờ hoàn thành rồi mới chạy task tiếp theo
      let current = 0;
      for (const task of enabledTasks) {
        if (this.shouldStopAll || window._taskBatchStopped) break;
        current++;
        this._updateBatchProgress(current, enabledTasks.length);
        await this._runSingleTaskAndWait(task);
      }
      this._resetRunAllButton();
    } else {
      // Song song: gửi tất cả prompts liên tục (không chờ tile result giữa các task)
      // Google Flow sẽ xếp hàng xử lý, kết quả xuất hiện song song
      if (window.eventBus) {
        window.eventBus.emit('tasks:run_batch', { tasks: enabledTasks, mode: 'parallel' });
      }
    }
  }

  async _runSingleTaskAndWait(task) {
    return new Promise((resolve) => {
      const taskId = task.task_id;

      const timeoutId = setTimeout(() => {
        cleanup();
        resolve();
      }, 180000); // 3 minutes max per task

      const onStatusChanged = (data) => {
        if (data.taskId !== taskId) return;
        if (['completed', 'failed'].includes(data.status)) {
          cleanup();
          resolve();
        }
      };

      const onStopAll = () => {
        cleanup();
        resolve();
      };

      const cleanup = () => {
        clearTimeout(timeoutId);
        if (window.eventBus) {
          window.eventBus.off('task:status_changed', onStatusChanged);
          window.eventBus.off('tasks:stop_all', onStopAll);
        }
      };

      if (window.eventBus) {
        window.eventBus.on('task:status_changed', onStatusChanged);
        window.eventBus.on('tasks:stop_all', onStopAll);
        window.eventBus.emit('task:run', { task });
      } else {
        resolve();
      }
    });
  }

  async runSelected() {
    const tasksToRun = this.tasks.filter(t => this.selectedTasks.has(t.task_id));
    if (window.eventBus) {
      window.eventBus.emit('tasks:run_batch', { tasks: tasksToRun });
    }
  }

  async deleteTask(taskId) {
    const task = this.tasks.find(t => t.task_id === taskId);
    const taskName = task?.name || task?.prompt?.substring(0, 50) || 'Task';

    // Block delete khi task đang running để tránh orphan execution
    if (task?.status === 'running') {
      const I = window.I18n;
      window.customDialog?.alert(
        I?.t('tasks.cannotDeleteRunning') || 'Không thể xóa task đang chạy. Vui lòng dừng task trước.',
        { title: I?.t('tasks.taskRunning') || 'Task đang chạy', type: 'warning' }
      );
      return;
    }

    const ok = await window.customDialog.confirmDangerous(
      window.I18n?.t('tasks.deleteConfirmShort') || 'Xóa vĩnh viễn task này?',
      {
        title: window.I18n?.t('tasks.deleteConfirmTitle') || 'Xóa task',
        itemName: taskName
      }
    );
    if (!ok) return;

    try {
      if (window.storageManager) {
        await window.storageManager.deleteTask(taskId);
      }
      await this.loadTasks();
      window.showNotification?.(window.I18n?.t('tasks.deleted') || 'Task đã xóa', 'success');
      // Refresh featureGate to update task count
      if (window.featureGate) {
        window.featureGate.refresh({ force: true }).catch(e => console.warn('[TaskList] FeatureGate refresh failed:', e));
      }
    } catch (error) {
      console.error('[TaskList] Delete failed:', error);
      window.showNotification?.(window.I18n?.t('tasks.deleteFailed') || 'Không thể xóa task', 'error');
    }
  }

  async deleteSelected() {
    // Filter out running tasks — không cho xóa task đang chạy (tránh orphan execution)
    const runningTaskIds = [...this.selectedTasks].filter(id => {
      const task = this.tasks.find(t => t.task_id === id);
      return task?.status === 'running';
    });
    const deletableIds = [...this.selectedTasks].filter(id => !runningTaskIds.includes(id));
    const count = deletableIds.length;
    const I = window.I18n;

    if (deletableIds.length === 0) {
      window.customDialog?.alert(
        I?.t('tasks.allSelectedRunning') || 'Tất cả task đã chọn đang chạy — không thể xóa.',
        { title: I?.t('tasks.taskRunning') || 'Task đang chạy', type: 'warning' }
      );
      return;
    }

    let confirmMsg = I?.t('tasks.deleteSelectedShort') || `Xóa vĩnh viễn ${count} task đã chọn?`;
    if (runningTaskIds.length > 0) {
      const skipNote = I?.t('tasks.skipRunningNote', { count: runningTaskIds.length })
        || `(${runningTaskIds.length} task đang chạy sẽ bị bỏ qua)`;
      confirmMsg = `${confirmMsg}\n\n${skipNote}`;
    }

    const ok = await window.customDialog.confirmDangerous(confirmMsg, {
      title: I?.t('tasks.deleteSelectedTitle') || 'Xóa tasks',
      itemName: `${count} tasks`,
    });
    if (!ok) return;

    try {
      for (const taskId of deletableIds) {
        if (window.storageManager) {
          await window.storageManager.deleteTask(taskId);
        }
      }
      // Chỉ clear deletable, giữ lại running tasks vẫn select
      for (const id of deletableIds) this.selectedTasks.delete(id);
      await this.loadTasks();
      window.showNotification?.(window.I18n?.t('tasks.deletedCount', { count }) || `Đã xóa ${count} task`, 'success');
      // Refresh featureGate to update task count
      if (window.featureGate) {
        window.featureGate.refresh({ force: true }).catch(e => console.warn('[TaskList] FeatureGate refresh failed:', e));
      }
    } catch (error) {
      console.error('[TaskList] Batch delete failed:', error);
      window.showNotification?.(window.I18n?.t('tasks.deleteSelectedFailed') || 'Không thể xóa tasks', 'error');
    }
  }

  showLoading() {
    const container = this.container.querySelector('#taskListContainer');
    if (container) {
      container.innerHTML = this._renderSkeletons(5);
    }
  }

  _renderSkeletons(count = 5) {
    const skeletons = [];
    // Match real task card: drag + checkbox + status + name+badges + prompt(2 lines) + meta(provider+ratio+x1+thumbs) + timestamp + toggle + ⋮
    for (let i = 0; i < count; i++) {
      const promptLine2Width = 60 + Math.random() * 25;
      skeletons.push(`
        <div class="task-card skeleton">
          <div class="skeleton-base" style="width: 6px; height: 24px; border-radius: 2px; flex-shrink: 0; opacity: 0.4;"></div>
          <div class="skeleton-checkbox skeleton-base" style="width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0;"></div>
          <span class="skeleton-status skeleton-circle skeleton-base" style="width: 14px; height: 14px; flex-shrink: 0;"></span>
          <div class="skeleton-info" style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px;">
            <div style="display: flex; align-items: center; gap: 6px;">
              <div class="skeleton-name skeleton-base" style="width: ${30 + Math.random() * 25}%; height: 13px;"></div>
              <div class="skeleton-base" style="width: 36px; height: 14px; border-radius: 8px;"></div>
              <div class="skeleton-base" style="width: 42px; height: 14px; border-radius: 8px;"></div>
            </div>
            <div class="skeleton-prompt skeleton-base" style="width: ${78 + Math.random() * 20}%; height: 11px;"></div>
            <div class="skeleton-prompt skeleton-base" style="width: ${promptLine2Width}%; height: 11px;"></div>
            <div style="display: flex; align-items: center; gap: 6px; margin-top: 2px;">
              <div class="skeleton-base" style="width: 50px; height: 10px;"></div>
              <div class="skeleton-base" style="width: 22px; height: 10px;"></div>
              <div class="skeleton-base" style="width: 14px; height: 10px;"></div>
              <div class="skeleton-base" style="width: 18px; height: 18px; border-radius: 3px; margin-left: 4px;"></div>
              <div class="skeleton-base" style="width: 18px; height: 18px; border-radius: 3px;"></div>
              <div class="skeleton-base" style="width: 18px; height: 18px; border-radius: 3px;"></div>
            </div>
            <div class="skeleton-base" style="width: ${28 + Math.random() * 12}%; height: 9px; margin-top: 1px;"></div>
          </div>
          <div class="skeleton-actions" style="display: flex; gap: 4px; align-items: center; flex-shrink: 0;">
            <div class="skeleton-btn skeleton-base" style="width: 32px; height: 18px; border-radius: 10px;"></div>
            <div class="skeleton-btn skeleton-base" style="width: 18px; height: 18px;"></div>
          </div>
        </div>
      `);
    }
    return skeletons.join('');
  }

  showError(message) {
    const container = this.container.querySelector('#taskListContainer');
    if (container) {
      container.innerHTML = `
        <div class="task-empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p style="color: var(--destructive);">${message}</p>
          <button class="btn btn-secondary btn-sm" onclick="this.closest('.task-list').parentElement.__taskList?.loadTasks()">${window.I18n?.t('common.retry') || 'Thử lại'}</button>
        </div>
      `;
    }
  }

  /**
   * Load thumbnails cho ref images qua MessageBridge (sidePanel không có DOM tiles)
   */
  _loadRefThumbnails(container) {
    if (!this._refTileCache) this._refTileCache = {};

    const placeholders = container.querySelectorAll('.task-ref-thumb-placeholder');
    if (placeholders.length === 0) return;

    // Render từ cache + thu thập IDs cần fetch
    const missingIds = [];
    placeholders.forEach(el => {
      const fileId = el.dataset?.fileId;
      if (!fileId) return;

      if (this._refTileCache[fileId]) {
        el.outerHTML = `<img class="task-ref-thumb" src="${this._refTileCache[fileId]}" alt="ref" />`;
      } else {
        missingIds.push(fileId);
      }
    });

    if (missingIds.length === 0 || typeof MessageBridge === 'undefined') return;

    const uniqueIds = [...new Set(missingIds)];
    MessageBridge.getThumbnailsByIds(uniqueIds).then(scanResult => {
      const results = scanResult?.results || {};
      for (const [fid, info] of Object.entries(results)) {
        if (info?.thumbnail) {
          this._refTileCache[fid] = info.thumbnail;
        }
      }
      // Re-render placeholders
      container.querySelectorAll('.task-ref-thumb-placeholder').forEach(el => {
        const fileId = el.dataset?.fileId;
        if (fileId && this._refTileCache[fileId]) {
          el.outerHTML = `<img class="task-ref-thumb" src="${this._refTileCache[fileId]}" alt="ref" />`;
        }
      });
    }).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskList#_updateLockState', _e); });
  }

  /**
   * ExecutionLock: disable/enable run buttons dựa trên trạng thái lock
   */
  _updateLockState(state) {
    const runAllBtn = this.container.querySelector('#runAllTasksBtn');
    // Pipeline mode bật → không block bất kỳ tab nào (PromptQueue orchestrate đồng thời)
    const isPipelineOn = window.PromptQueue && PromptQueue.isEnabled();
    const isBlocked = state.locked && state.owner !== 'task' && state.owner !== 'queue' && !isPipelineOn;

    if (runAllBtn && !this.isRunningAll) {
      runAllBtn.disabled = isBlocked;
      runAllBtn.title = isBlocked
        ? (window.I18n?.t('tasks.running', { name: state.label || state.owner }) || `Đang chạy: ${state.label || state.owner}`)
        : (window.I18n?.t('tasks.runAll') || 'Chạy tất cả');
    }

    const runModeBtn = this.container?.querySelector('#taskRunModeBtn');
    if (runModeBtn) {
      runModeBtn.disabled = isBlocked || this.isRunningAll;
    }

    // Banner
    const bannerId = 'taskLockBanner';
    let banner = this.container.querySelector(`#${bannerId}`);

    if (!isBlocked) {
      if (banner) banner.remove();
      return;
    }

    if (!banner) {
      banner = document.createElement('div');
      banner.id = bannerId;
      banner.className = 'execution-lock-banner';
      const listContainer = this.container.querySelector('#taskListContainer');
      if (listContainer) {
        listContainer.parentElement.insertBefore(banner, listContainer);
      }
    }
    banner.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span>${window.I18n?.t('tasks.running', { name: state.label || state.owner }) || `Đang chạy: ${state.label || state.owner}`}</span>
    `;
  }

  /**
   * Detect expired result thumbnail URLs trên task cards → re-scan Flow → update
   */
  _handleExpiredResultThumbnails(container) {
    const resultImgs = container.querySelectorAll('.task-result-thumb-card');
    if (resultImgs.length === 0) return;

    const expiredTaskIds = new Set();

    resultImgs.forEach(img => {
      img.onerror = () => {
        const card = img.closest('.task-card');
        if (card?.dataset.taskId) expiredTaskIds.add(card.dataset.taskId);
        img.style.display = 'none';

        // Debounce: gộp nhiều onerror thành 1 lần scan
        if (this._expiredTimer) clearTimeout(this._expiredTimer);
        this._expiredTimer = setTimeout(() => {
          this._rescanExpiredResults([...expiredTaskIds]);
          expiredTaskIds.clear();
        }, 500);
      };
    });
  }

  _rescanExpiredResults(taskIds) {
    if (typeof MessageBridge === 'undefined' || taskIds.length === 0) return;

    // Thu thập tất cả file IDs cần quét từ các task bị expired
    const allFileIds = new Set();
    for (const taskId of taskIds) {
      const task = this.tasks.find(t => t.task_id === taskId);
      if (!task?.result_file_ids) continue;
      const resultIds = task.result_file_ids.split(',').map(s => s.trim()).filter(Boolean);
      for (const id of resultIds) {
        if (!id.startsWith('upload_')) allFileIds.add(id);
      }
    }
    if (allFileIds.size === 0) return;

    MessageBridge.getThumbnailsByIds([...allFileIds]).then(result => {
      const results = result?.results || {};
      if (Object.keys(results).length === 0) return;

      for (const taskId of taskIds) {
        const task = this.tasks.find(t => t.task_id === taskId);
        if (!task?.result_file_ids) continue;

        const resultIds = task.result_file_ids.split(',').map(s => s.trim()).filter(Boolean);
        const newThumbs = { ...(task.result_thumbnails || {}) };
        let changed = false;

        for (const fileId of resultIds) {
          const info = results[fileId];
          if (info?.thumbnail) {
            const existingThumb = typeof newThumbs[fileId] === 'object' ? newThumbs[fileId]?.thumbnail : newThumbs[fileId];
            if (existingThumb !== info.thumbnail) {
              // Preserve type field for video detection
              if (info.type === 'video') {
                newThumbs[fileId] = { thumbnail: info.thumbnail, type: 'video', file_name: info.file_name || '' };
              } else {
                newThumbs[fileId] = info.thumbnail;
              }
              changed = true;
            }
          }
        }

        if (changed) {
          task.result_thumbnails = newThumbs;
          if (window.storageManager) {
            window.storageManager.saveTask(task).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskList#escapeHtml', _e); });
          }
        }
      }

      // Re-render cards with fresh thumbnails
      this.renderTaskList();
    }).catch(function (_e) { globalThis.SEOSONA_swallow?.('TaskList#escapeHtml', _e); });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  /** Format relative time (vừa xong / X phút trước / X giờ trước / X ngày trước / dd/mm/yyyy) */
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
    if (minutes < 60) return window.I18n?.t('albums.minutesAgo', { count: minutes }) || `${minutes} phút trước`;
    if (hours < 24) return window.I18n?.t('albums.hoursAgo', { count: hours }) || `${hours} giờ trước`;
    if (days < 7) return window.I18n?.t('albums.daysAgo', { count: days }) || `${days} ngày trước`;
    const localeMap = { vi: 'vi-VN', en: 'en-US' };
    const locale = localeMap[window.I18n?.getLocale?.()] || 'vi-VN';
    return date.toLocaleDateString(locale);
  }

  /**
   * Trả SVG icon theo status: idle/pending/running/completed/error/failed.
   * Running icon có class .status-icon-spin → CSS spin animation đồng bộ với gen-running-spin.
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
    // idle/pending: empty circle
    return `<svg width="14" height="14" viewBox="0 0 24 24" ${stroke}><circle cx="12" cy="12" r="9"></circle></svg>`;
  }

  /** Trả localized label cho tooltip status. Dùng namespace tasks.* */
  static _renderStatusLabel(status) {
    const I = window.I18n;
    const s = status || 'idle';
    if (s === 'running') return I?.t('tasks.statusRunning') || 'Đang chạy';
    if (s === 'completed') return I?.t('tasks.statusCompleted') || 'Hoàn thành';
    if (s === 'error' || s === 'failed') return I?.t('tasks.statusFailed') || 'Thất bại';
    return I?.t('tasks.statusPending') || 'Chờ chạy';
  }

  /**
   * Show Task confirm modal với provider status display + polling.
   * Hiển thị settings read-only (không edit).
   * @param {Object} task - Task object
   * @param {string} provider - 'flow'|'chatgpt'|'grok'
   * @param {string} providerLabel - Display name
   * @returns {Promise<boolean>}
   */
  static _showTaskConfirmModal(task, provider, providerLabel) {
    return new Promise((resolve) => {
      const overlay = document.getElementById('taskConfirmRunOverlay');
      if (!overlay) {
        resolve(true);
        return;
      }

      const I = window.I18n;
      const isChatGPT = provider === 'chatgpt';
      const isGrok = provider === 'grok';
      const isFlow = !isChatGPT && !isGrok;
      const taskName = task.task_name || 'Task';

      // Populate task name
      const nameEl = document.getElementById('taskConfirmName');
      if (nameEl) nameEl.textContent = taskName;

      // Settings display elements (read-only text)
      const ratioEl = document.getElementById('taskConfirmRatio');
      const qtyEl = document.getElementById('taskConfirmQuantity');
      const downloadResEl = document.getElementById('taskConfirmDownloadRes');
      const ratioRow = document.getElementById('taskConfirmRatioRow');
      const qtyRow = document.getElementById('taskConfirmQuantityRow');
      const downloadRow = document.getElementById('taskConfirmDownloadRow');

      // Ratio icon + label mapping
      const ratioMap = { story: '9:16', portrait: '3:4', square: '1:1', landscape: '4:3', widescreen: '16:9' };
      const grokRatioMap = { story: '9:16', portrait: '2:3', square: '1:1', landscape: '3:2', widescreen: '16:9' };
      const iconMap = { '16:9': '▬', '4:3': '▭', '1:1': '□', '3:4': '▯', '9:16': '▮', '2:3': '▯', '3:2': '▭' };
      const getIcon = (r) => iconMap[r] || iconMap[ratioMap[r]] || iconMap[grokRatioMap[r]] || '';

      // Hide quantity + download rows cho ChatGPT/Grok (chỉ show ratio)
      const hideQtyRes = isChatGPT || isGrok;
      if (qtyRow) qtyRow.classList.toggle('hidden', hideQtyRes);
      if (downloadRow) downloadRow.classList.add('hidden');

      // Populate ratio display
      if (ratioEl) {
        const ratio = task.ratio || '16:9';
        const displayRatio = isGrok ? (grokRatioMap[ratio] || ratio) : (ratioMap[ratio] || ratio);
        ratioEl.textContent = `${getIcon(displayRatio)} ${displayRatio}`;
      }

      // Populate quantity cho Flow
      if (qtyEl && isFlow) {
        qtyEl.textContent = `x${task.quantity || 1}`;
      }

      // Provider status row
      const providerStatusRow = document.getElementById('taskConfirmProviderStatus');
      const providerLabelEl = document.getElementById('taskConfirmProviderLabel');
      const providerBadge = document.getElementById('taskConfirmProviderBadge');

      // Clear any existing poll timer
      if (TaskList._taskConfirmStatusPollTimer) {
        clearInterval(TaskList._taskConfirmStatusPollTimer);
        TaskList._taskConfirmStatusPollTimer = null;
      }

      // SVG icons for provider status
      const iconSpinner = `<svg class="badge-icon badge-icon-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>`;
      const iconCheck = `<svg class="badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`;
      const iconWarning = `<svg class="badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
      const iconCloudflare = `<svg class="badge-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

      if (providerStatusRow) {
        if (isChatGPT || isGrok) {
          providerStatusRow.classList.remove('hidden');
          if (providerLabelEl) providerLabelEl.textContent = providerLabel;

          const Session = isChatGPT ? window.ChatGPTSession : window.GrokSession;
          let lastStatus = null;

          const checkAndUpdateStatus = async () => {
            if (!providerBadge) return;
            if (overlay.classList.contains('hidden')) {
              if (TaskList._taskConfirmStatusPollTimer) {
                clearInterval(TaskList._taskConfirmStatusPollTimer);
                TaskList._taskConfirmStatusPollTimer = null;
              }
              return;
            }

            try {
              let newStatus = 'warning';
              let statusText = I?.t('gen.providerStatusLogin') || 'Chưa đăng nhập';
              let statusIcon = iconWarning;

              if (isGrok && Session?.checkStatus) {
                const status = await Session.checkStatus();
                if (status.loggedIn && !status.cloudflareChallenge) {
                  newStatus = 'ready';
                } else if (status.cloudflareChallenge) {
                  newStatus = 'cloudflare';
                  statusText = I?.t('gen.providerStatusCloudflare') || 'Chờ Cloudflare...';
                  statusIcon = iconCloudflare;
                }
              } else if (Session?.ensureReady) {
                // [Bug 62 fix 2026-05-24] silent: true cho task reconfirm modal polling
                // (mirror GenTab fix) — KHÔNG emit chatgpt:login_required event spam.
                const result = await Session.ensureReady({ createIfMissing: false, activate: false, silent: true });
                if (result?.ready) newStatus = 'ready';
              }

              if (newStatus === lastStatus) return;
              lastStatus = newStatus;

              if (newStatus === 'ready') {
                providerBadge.className = 'confirm-run-provider-badge is-ready';
                providerBadge.innerHTML = `${iconCheck}<span class="badge-text">${I?.t('gen.providerStatusReady') || 'Ready'}</span>`;
                if (TaskList._taskConfirmStatusPollTimer) {
                  clearInterval(TaskList._taskConfirmStatusPollTimer);
                  TaskList._taskConfirmStatusPollTimer = null;
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
              providerBadge.innerHTML = `${iconWarning}<span class="badge-text">${I?.t('gen.providerStatusLogin') || 'Chưa đăng nhập'}</span>`;
            }
          };

          // Reset badge to checking state
          if (providerBadge) {
            providerBadge.className = 'confirm-run-provider-badge is-checking';
            providerBadge.innerHTML = `${iconSpinner}<span class="badge-text">${I?.t('gen.providerStatusChecking') || 'Đang kiểm tra...'}</span>`;
          }

          checkAndUpdateStatus();
          TaskList._taskConfirmStatusPollTimer = setInterval(checkAndUpdateStatus, 3000);
        } else {
          // Flow: ẩn provider status (không cần check login)
          providerStatusRow.classList.add('hidden');
        }
      }

      // Show overlay
      overlay.classList.remove('hidden');

      // Cleanup function
      const cleanup = () => {
        overlay.classList.add('hidden');
        if (TaskList._taskConfirmStatusPollTimer) {
          clearInterval(TaskList._taskConfirmStatusPollTimer);
          TaskList._taskConfirmStatusPollTimer = null;
        }
        submitBtn?.removeEventListener('click', onSubmit);
        cancelBtn?.removeEventListener('click', onCancel);
        closeBtn?.removeEventListener('click', onCancel);
        document.removeEventListener('keydown', onKeydown);
      };

      const onSubmit = () => {
        cleanup();
        resolve(true);
      };

      const onCancel = () => {
        cleanup();
        resolve(false);
      };

      const onKeydown = (e) => {
        if (e.key === 'Escape') onCancel();
        else if (e.key === 'Enter') onSubmit();
      };

      const submitBtn = document.getElementById('taskConfirmSubmit');
      const cancelBtn = document.getElementById('taskConfirmCancel');
      const closeBtn = document.getElementById('taskConfirmClose');

      submitBtn?.addEventListener('click', onSubmit);
      cancelBtn?.addEventListener('click', onCancel);
      closeBtn?.addEventListener('click', onCancel);
      document.addEventListener('keydown', onKeydown);

      submitBtn?.focus();
    });
  }
}

// Export
window.TaskList = TaskList;
