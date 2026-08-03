/**
 * M1: Module-level async lock (chained-promise mutex) serializing every
 * `af_pending_sync` read-modify-write across all StorageManager instances in
 * this context. Concurrent appends previously did get→mutate→set independently
 * and clobbered each other (last-write-wins → lost pending records). All four
 * mutators run their critical section through `_pendingSyncLock`.
 * Note: this only serializes within a single JS context; true cross-context
 * (multi-tab) atomicity would need navigator.locks or a background writer.
 */
let _pendingSyncMutex = Promise.resolve();
function _withPendingSyncLock(fn) {
  const run = _pendingSyncMutex.then(fn, fn);
  // Keep the chain alive even if fn rejects (swallow here; callers log).
  _pendingSyncMutex = run.catch(function (_e) { globalThis.SEOSONA_swallow?.('StorageManager#_withPendingSyncLock', _e); });
  return run;
}

/**
 * StorageManager - Quản lý storage với hỗ trợ LocalStore và API
 * Auto-detect: Đã đăng nhập → API mode, chưa đăng nhập → Local mode
 */
class StorageManager {
  static PENDING_SYNC_KEY = 'af_pending_sync';

  // LOCAL MODE: mặc định true (offline). Khi true → mọi persistence đi thẳng local
  // (chrome.storage + IndexedDB), KHÔNG gọi server, KHÔNG enqueue pending-sync.
  static _isLocalMode() {
    try { return self.SEOSONA_LOCAL_MODE !== false; } catch (_) { return true; }
  }

  constructor() {
    this.storage = null;
    this.mode = 'local';  // 'local' | 'api'
    this.listeners = [];
    this._migrationInProgress = false;  // Mutex for migration
    this._syncInProgress = false;  // Mutex for pending sync
  }

  // Khởi tạo
  async init() {
    // LOCAL MODE: bỏ qua hoàn toàn server — luôn dùng LocalStorage, không sync pending.
    if (StorageManager._isLocalMode()) {
      this.mode = 'local';
      this.storage = new LocalStorage();
      console.log('[StorageManager] LOCAL MODE — persistence local-only (no server, no pending-sync)');
      return this;
    }

    // Tự động chọn mode: đăng nhập → API, chưa → local
    if (true && window.ApiStorage) {
      this.mode = 'api';
      this.storage = new ApiStorage();
      // Sync pending items khi init với API mode (non-blocking)
      this._syncPendingWorkflows().catch(e => {
        console.warn('[StorageManager] Background workflow sync failed:', e.message);
      });
      this._syncPendingTasks().catch(e => {
        console.warn('[StorageManager] Background task sync failed:', e.message);
      });
    } else {
      this.mode = 'local';
      this.storage = new LocalStorage();
    }

    console.log('[StorageManager] Khởi tạo với mode:', this.mode);
    return this;
  }

  // Chuyển sang API mode (khi user đăng nhập)
  async switchToApi() {
    // LOCAL MODE: không có server → giữ nguyên local, không switch.
    if (StorageManager._isLocalMode()) {
      console.log('[StorageManager] LOCAL MODE — switchToApi ignored (staying local)');
      return { success: true, mode: 'local' };
    }
    if (!true) {
      throw new Error('Bạn cần đăng nhập để sử dụng chế độ đồng bộ API');
    }
    if (!window.ApiStorage) {
      throw new Error('Module ApiStorage chưa được tải');
    }

    // Switch to API mode — server is always source of truth
    this.mode = 'api';
    this.storage = new ApiStorage();
    this.notify('mode_changed', { mode: 'api' });

    this._pendingMigrationCheck = false;
    this._migrationChecked = {};

    // CRITICAL: Sync pending items TRƯỚC KHI clear local data
    // Đây là data user đã tạo/edit khi API fail, cần được sync lên server
    try {
      const wfResult = await this._syncPendingWorkflows();
      const taskResult = await this._syncPendingTasks();
      if (wfResult.synced > 0 || taskResult.synced > 0) {
        console.log('[StorageManager] Synced', wfResult.synced, 'workflows and', taskResult.synced, 'tasks before clearing local');
      }
    } catch (e) {
      console.warn('[StorageManager] Pending sync failed (will retry later):', e.message);
      // Không throw - tiếp tục flow, sync sẽ retry lần sau
    }

    // Bug E privacy fix: Clear local cache (tasks + workflows) sau switchToApi.
    // Lý do: nếu cùng browser profile có 2 user khác nhau login lần lượt:
    //   User A login → switchToApi → server data A; user A logout → quay lại local thấy data trước login
    //   User B cùng máy login → switchToApi → server data B; local data anonymous của lần trước vẫn còn
    //   User B logout → switchToLocal → thấy data lẫn lộn → privacy leak
    // → Clear local tasks + workflows ngay sau khi switch sang API mode.
    // CHÚ Ý: Chỉ clear local data SAU KHI đã sync pending workflows thành công.
    // Nếu sync fail, pending items vẫn còn trong af_pending_sync để retry lần sau.
    // KHÔNG clear af_settings (preferences) / af_user_prompts (snippets) — giữ UX.
    try {
      const local = new LocalStorage();
      await local.clearTasks();
      await local.clearWorkflows();
      console.log('[StorageManager] Privacy: cleared local tasks + workflows after switchToApi');
    } catch (e) {
      console.warn('[StorageManager] Clear local cache failed (non-fatal):', e.message);
    }

    return { success: true, mode: 'api' };
  }

  // Chuyển về local mode (khi user đăng xuất)
  switchToLocal() {
    this.mode = 'local';
    this.storage = new LocalStorage();
    this._pendingMigrationCheck = false;
    this.notify('mode_changed', { mode: 'local' });

    return { success: true, mode: 'local' };
  }

  /**
   * Check if local has data that server doesn't, and ask user to sync.
   * Called lazily when user accesses tasks/workflows tabs.
   *
   * IMPORTANT: Only prompt sync if user created data while NOT logged in.
   * If server already has data, server is source of truth - clear local cache.
   *
   * @param {'tasks'|'workflows'} dataType
   */
  async checkAndPromptMigration(dataType) {
    // [DISABLED] Tính năng đồng bộ dữ liệu local → server đã bị bỏ.
    // Lý do: Sau khi login, user dùng data từ server (API mode). Local data
    // từ lúc chưa login giữ nguyên trong chrome.storage nhưng KHÔNG auto-prompt
    // đồng bộ, tránh confusion + tránh sync ngược data không cần thiết.
    // Nếu muốn khôi phục tính năng này, xóa early-return dưới đây.
    return;

    // eslint-disable-next-line no-unreachable
    if (!this._pendingMigrationCheck || this.mode !== 'api') return;
    if (this._migrationChecked?.[dataType]) return;
    // Mutex: prevent concurrent migration checks
    if (this._migrationInProgress) return;
    this._migrationInProgress = true;

    this._migrationChecked = this._migrationChecked || {};
    this._migrationChecked[dataType] = true;

    const localStorage = new LocalStorage();
    const apiStorage = this.storage;

    try {
      if (dataType === 'tasks') {
        const localResult = await localStorage.getTasks();
        const localTasks = localResult.data || [];
        if (localTasks.length === 0) return;

        const serverResult = await apiStorage.getTasks();
        const serverTasks = serverResult.data || [];

        // If server has data, it's the source of truth — clear local cache
        if (serverTasks.length > 0) {
          console.log('[StorageManager] Server has tasks, clearing local cache');
          await localStorage.clearTasks();
          return;
        }

        // Server is empty but local has data — prompt to sync
        const confirmed = await this._askMigration('tasks', localTasks.length);
        if (confirmed) {
          for (const task of localTasks) {
            try { await apiStorage.saveTask(task); } catch (e) {
              console.warn('[StorageManager] Migrate task failed:', task.task_id, e.message);
            }
          }
          console.log('[StorageManager] Migrated', localTasks.length, 'tasks to server');
          this.notify('task_saved', {});
        }
        // Clear local after migration attempt (whether confirmed or not)
        await localStorage.clearTasks();

      } else if (dataType === 'workflows') {
        const localResult = await localStorage.getWorkflows();
        const localWorkflows = localResult.data || [];
        if (localWorkflows.length === 0) return;

        const serverResult = await apiStorage.getWorkflows();
        const serverWorkflows = serverResult.data || [];

        // If server has data, it's the source of truth — clear local cache
        if (serverWorkflows.length > 0) {
          console.log('[StorageManager] Server has workflows, clearing local cache');
          await localStorage.clearWorkflows();
          return;
        }

        // Server is empty but local has data — prompt to sync
        const confirmed = await this._askMigration('workflows', localWorkflows.length);
        if (confirmed) {
          for (const wf of localWorkflows) {
            try {
              const fullWf = await localStorage.getWorkflow(wf.wf_id);
              await apiStorage.saveWorkflowFull(fullWf, fullWf.nodes || [], fullWf.edges || []);
            } catch (e) {
              console.warn('[StorageManager] Migrate workflow failed:', wf.wf_id, e.message);
            }
          }
          console.log('[StorageManager] Migrated', localWorkflows.length, 'workflows to server');
          this.notify('workflow_full_saved', {});
        }
        // Clear local after migration attempt (whether confirmed or not)
        await localStorage.clearWorkflows();
      }
    } catch (e) {
      console.error('[StorageManager] Migration check error:', e);
    } finally {
      this._migrationInProgress = false;  // Release mutex
    }
  }

  /**
   * Show confirmation dialog asking user if they want to sync local data
   */
  async _askMigration(type, count) {
    const typeLabel = type === 'tasks' ? 'Task' : 'Workflow';
    const dialog = window.customDialog || window.CustomDialog;
    if (!dialog) return false;

    return dialog.confirm(
      `Phát hiện ${count} ${typeLabel} trong bộ nhớ cục bộ chưa được đồng bộ lên server. Bạn có muốn đồng bộ không?`,
      {
        title: 'Đồng bộ dữ liệu',
        type: 'info',
        confirmText: 'Đồng bộ',
        cancelText: 'Bỏ qua'
      }
    );
  }

  // Đảm bảo storage đã init
  async _ensureInit() {
    if (this._ready) return;
    if (this._initPromise) return this._initPromise;
    this._initPromise = this.init();
    await this._initPromise;
    this._ready = true;
    this._initPromise = null;
  }

  // ===== TASKS (Tab 2) =====
  async getTasks(options = {}) { await this._ensureInit(); return this.storage.getTasks(options); }
  async getTask(taskId) { await this._ensureInit(); return this.storage.getTask(taskId); }

  /**
   * Save task - Server-first với fallback to local
   * [Option C] Local chỉ là buffer khi API fail (network error)
   * Quota/Feature errors KHÔNG fallback - throw để UI hiển thị lỗi
   */
  async saveTask(task) {
    await this._ensureInit();

    // LOCAL MODE: lưu thẳng local, không server, không pending-sync.
    if (StorageManager._isLocalMode()) {
      const result = await this.storage.saveTask(task);
      this.notify('task_saved', result);
      return result;
    }

    // Nếu đang ở local mode (anonymous), không cho tạo mới
    // Anonymous phải login để tạo task
    if (this.mode === 'local') {
      throw new Error('REQUIRES_LOGIN');
    }

    let result;
    try {
      result = await this.storage.saveTask(task);
    } catch (err) {
      console.log('[StorageManager] saveTask error:', {
        code: err.code,
        message: err.message,
        httpStatus: err.httpStatus
      });

      // Don't fallback for quota/feature errors - re-throw
      const isQuotaError = err.code === 'QUOTA_EXCEEDED' ||
        err.code === 'FEATURE_DISABLED' ||
        err.httpStatus === 403 ||
        err.message?.includes('giới hạn') ||
        err.message?.includes('QUOTA');

      if (isQuotaError) {
        console.log('[StorageManager] Quota/feature error, re-throwing');
        throw err;
      }

      // Network/5xx errors: fallback to local storage
      const isNetworkError = !err.httpStatus ||
        err.httpStatus >= 500 ||
        err.message?.includes('network') ||
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('timeout') ||
        err._isConnectionError;

      if (isNetworkError && this.mode === 'api') {
        console.warn('[StorageManager] API saveTask failed (network), saving to local:', err.message);
        const local = new LocalStorage();
        result = await local.saveTask(task);
        // Track as pending sync
        await this._trackPendingSyncTask(task.task_id, task.updated_at || Date.now());
        // Notify user
        this._notifyLocalFallback(err.message);
      } else {
        throw err;
      }
    }

    this.notify('task_saved', result);
    return result;
  }

  async deleteTask(taskId) {
    await this._ensureInit();
    const result = await this.storage.deleteTask(taskId);
    // Clear from pending sync if exists
    await this._clearPendingSyncTask(taskId);
    this.notify('task_deleted', { taskId });
    return result;
  }

  async updateTaskStatus(taskId, status, fileIds, extra = null) {
    await this._ensureInit();
    const result = await this.storage.updateTaskStatus(taskId, status, fileIds, extra);
    this.notify('task_status_updated', { taskId, status, fileIds });
    return result;
  }

  // ===== WORKFLOWS (Tab 4) =====
  async getWorkflows(options = {}) { await this._ensureInit(); return this.storage.getWorkflows(options); }
  async getWorkflow(wfId) {
    await this._ensureInit();
    let result = null;
    let apiError = null;

    try {
      result = await this.storage.getWorkflow(wfId);
    } catch (err) {
      apiError = err;
      console.warn('[StorageManager] API getWorkflow error:', err.message);
    }

    // Fallback to local storage if:
    // 1. API returned null (not found on server)
    // 2. API threw error (network/connection issue)
    if (!result && this.mode === 'api') {
      console.warn('[StorageManager] Fallback to local storage for workflow:', wfId);
      const local = new LocalStorage();
      const localResult = await local.getWorkflow(wfId);

      if (localResult) {
        // Found in local, warn user if there was an API error
        if (apiError?._isConnectionError) {
          console.warn('[StorageManager] Using cached local data due to connection error');
        }
        return localResult;
      }

      // Neither API nor local has the workflow
      if (apiError?._isConnectionError) {
        // Connection error + not in local = throw with friendly message
        const friendlyError = new Error('Không thể tải workflow do lỗi kết nối. Vui lòng kiểm tra mạng và thử lại.');
        friendlyError.code = 'CONNECTION_ERROR';
        throw friendlyError;
      }
      // Workflow truly doesn't exist
      return null;
    }

    return result;
  }
  /**
   * Save workflow - Server-first với fallback to local
   * [Option C] Local chỉ là buffer khi API fail (network error)
   * Quota/Feature errors KHÔNG fallback - throw để UI hiển thị lỗi
   */
  async saveWorkflow(workflow) {
    await this._ensureInit();

    // LOCAL MODE: lưu thẳng local, không server, không pending-sync.
    if (StorageManager._isLocalMode()) {
      const result = await this.storage.saveWorkflow(workflow);
      this.notify('workflow_saved', result);
      return result;
    }

    // Nếu đang ở local mode (anonymous), không cho tạo mới
    if (this.mode === 'local') {
      throw new Error('REQUIRES_LOGIN');
    }

    let result;
    try {
      result = await this.storage.saveWorkflow(workflow);
      // API save OK → xoá pending sync cũ (chống stale local đè server — xem saveWorkflowFull).
      await this._clearPendingSync(workflow.wf_id);
    } catch (err) {
      console.log('[StorageManager] saveWorkflow error:', {
        code: err.code,
        message: err.message,
        httpStatus: err.httpStatus
      });

      // Don't fallback for quota/feature errors - re-throw
      const isQuotaError = err.code === 'QUOTA_EXCEEDED' ||
        err.code === 'FEATURE_DISABLED' ||
        err.httpStatus === 403 ||
        err.message?.includes('giới hạn') ||
        err.message?.includes('QUOTA');

      if (isQuotaError) {
        console.log('[StorageManager] Quota/feature error, re-throwing');
        throw err;
      }

      // Network/5xx errors: fallback to local storage
      const isNetworkError = !err.httpStatus ||
        err.httpStatus >= 500 ||
        err.message?.includes('network') ||
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('timeout') ||
        err._isConnectionError;

      if (isNetworkError && this.mode === 'api') {
        console.warn('[StorageManager] API saveWorkflow failed (network), saving to local:', err.message);
        const local = new LocalStorage();
        result = await local.saveWorkflow(workflow);
        // Track as pending sync
        await this._trackPendingSync(workflow.wf_id, workflow.updated_at || Date.now());
        // Notify user
        this._notifyLocalFallback(err.message);
      } else {
        throw err;
      }
    }

    this.notify('workflow_saved', result);
    return result;
  }
  async deleteWorkflow(wfId) {
    await this._ensureInit();
    const result = await this.storage.deleteWorkflow(wfId);
    this.notify('workflow_deleted', { wfId });
    return result;
  }

  // ===== NODES (Tab 4) =====
  async getNodes(wfId) { await this._ensureInit(); return this.storage.getNodes(wfId); }
  async saveNode(wfId, node) {
    await this._ensureInit();
    const result = await this.storage.saveNode(wfId, node);
    this.notify('node_saved', { wfId, node: result });
    return result;
  }
  async deleteNode(wfId, nodeId) {
    await this._ensureInit();
    const result = await this.storage.deleteNode(wfId, nodeId);
    this.notify('node_deleted', { wfId, nodeId });
    return result;
  }
  async updateNodeStatus(wfId, nodeId, data) {
    await this._ensureInit();
    const result = await this.storage.updateNodeStatus(wfId, nodeId, data);
    this.notify('node_status_updated', { wfId, nodeId, data });
    return result;
  }

  // ===== EDGES (Tab 4) =====
  async getEdges(wfId) { await this._ensureInit(); return this.storage.getEdges(wfId); }
  async saveEdge(wfId, edge) {
    await this._ensureInit();
    const result = await this.storage.saveEdge(wfId, edge);
    this.notify('edge_saved', { wfId, edge: result });
    return result;
  }
  async deleteEdge(wfId, edgeId) {
    await this._ensureInit();
    const result = await this.storage.deleteEdge(wfId, edgeId);
    this.notify('edge_deleted', { wfId, edgeId });
    return result;
  }

  // ===== BULK =====
  /**
   * Save workflow with nodes and edges - Server-first với fallback
   * [Option C] Anonymous không được tạo workflow locally
   */
  async saveWorkflowFull(workflow, nodes, edges) {
    await this._ensureInit();

    // Defensive: ensure all nodes have required fields to prevent validation errors
    const sanitizedNodes = (nodes || []).map(n => ({
      ...n,
      node_name: n.node_name || n.label || n.node_type || 'Node'
    }));

    // LOCAL MODE: lưu thẳng local (workflow + nodes + edges), không server, không pending-sync.
    if (StorageManager._isLocalMode()) {
      const result = await this.storage.saveWorkflowFull(workflow, sanitizedNodes, edges);
      this.notify('workflow_full_saved', result);
      return result;
    }

    // Nếu đang ở local mode (anonymous), không cho tạo mới
    if (this.mode === 'local') {
      throw new Error('REQUIRES_LOGIN');
    }

    let result;
    try {
      result = await this.storage.saveWorkflowFull(workflow, sanitizedNodes, edges);
      // API save thành công → server có state MỚI NHẤT. Xóa pending sync cũ (nếu có) để background
      // _syncPendingWorkflows KHÔNG đẩy local snapshot CŨ đè lên server → chống data loss (vd 35→7
      // nodes): trước đó 1 lần flaky-save fallback local (pending SET), sau đó save server OK nhiều
      // lần nhưng pending không được xoá → sync nền đẩy snapshot local cũ đè mất node mới tạo.
      await this._clearPendingSync(workflow.wf_id);
    } catch (err) {
      console.log('[StorageManager] saveWorkflowFull error:', {
        code: err.code,
        message: err.message,
        httpStatus: err.httpStatus
      });

      // Don't fallback for quota errors - re-throw so UI can show proper error
      const isQuotaError = err.code === 'QUOTA_EXCEEDED' ||
        err.httpStatus === 403 ||
        err.message?.includes('giới hạn') ||
        err.message?.includes('QUOTA');

      if (isQuotaError) {
        console.log('[StorageManager] Quota error detected, re-throwing');
        throw err;
      }

      // Only fallback to local for network errors (same logic as saveWorkflow/saveTask)
      const isNetworkError = err.code === 'NETWORK_ERROR' ||
        err.message?.includes('network') ||
        err.message?.includes('Failed to fetch') ||
        err.message?.includes('timeout') ||
        err._isConnectionError;

      if (isNetworkError && this.mode === 'api') {
        console.warn('[StorageManager] API saveWorkflowFull failed (network), saving to local:', err.message);
        const local = new LocalStorage();
        result = await local.saveWorkflowFull(workflow, nodes, edges);
        // Track this workflow as pending sync
        await this._trackPendingSync(workflow.wf_id, workflow.updated_at || Date.now());
        // Notify user that data was saved locally due to server error
        this._notifyLocalFallback(err.message);
      } else {
        throw err;
      }
    }
    this.notify('workflow_full_saved', result);
    return result;
  }

  async resetWorkflow(wfId) {
    await this._ensureInit();
    const result = await this.storage.resetWorkflow(wfId);
    this.notify('workflow_reset', { wfId });
    return result;
  }

  // Event system
  subscribe(callback) {
    this.listeners.push(callback);
    return () => {
      this.listeners = this.listeners.filter(l => l !== callback);
    };
  }

  notify(event, data) {
    this.listeners.forEach(cb => cb(event, data));
    if (window.eventBus) {
      window.eventBus.emit(`storage:${event}`, data);
    }
  }

  /**
   * Notify user when data is saved locally due to server error
   * @param {string} errorMsg - Original error message for logging
   */
  _notifyLocalFallback(errorMsg) {
    console.warn('[StorageManager] Local fallback notification:', errorMsg);
    // Lazy get t() function - I18n may not be ready at module load time
    const t = (key) => window.I18n?.t?.(key) || window.t?.(key) || null;
    const dialog = window.customDialog || window.CustomDialog;
    if (dialog) {
      dialog.alert(
        t('storage.savedLocallyWarning') || 'Đã lưu vào bộ nhớ cục bộ do lỗi kết nối server. Dữ liệu sẽ được đồng bộ khi kết nối lại.',
        { title: t('common.warning') || 'Cảnh báo', type: 'warning' }
      );
    }
    // Also emit event for UI components that want to show inline notification
    if (window.eventBus) {
      window.eventBus.emit('storage:local_fallback', { errorMsg });
    }
  }

  // ===== PENDING SYNC MECHANISM =====

  /**
   * Track a workflow as pending sync (called when API save fails and fallback to local)
   * @param {string} wfId - Workflow ID
   * @param {number} updatedAt - Timestamp when workflow was updated
   */
  async _trackPendingSync(wfId, updatedAt) {
    // LOCAL MODE: không có server để sync → không enqueue pending-sync.
    if (StorageManager._isLocalMode()) return;
    // M1: serialize the whole get→mutate→set under the module mutex.
    return _withPendingSyncLock(async () => {
      try {
        const userId = 'local_user' || ({ id: 'local_user', name: 'Local User', plan_slug: 'pro' })?.id || 'unknown';
        const data = await this._getPendingSyncData();

        // Check if already tracked (avoid duplicates)
        const existingIdx = data.workflows.findIndex(w => w.wf_id === wfId);
        const item = {
          wf_id: wfId,
          updated_at: updatedAt,
          user_id: userId,
          created_at: Date.now()
        };

        if (existingIdx >= 0) {
          // Update existing entry with newer timestamp
          if (updatedAt > data.workflows[existingIdx].updated_at) {
            data.workflows[existingIdx] = item;
          }
        } else {
          data.workflows.push(item);
        }

        await chrome.storage.local.set({ [StorageManager.PENDING_SYNC_KEY]: data });
        console.log('[StorageManager] Tracked pending sync for workflow:', wfId);

        // Emit event for UI indicator
        if (window.eventBus) {
          window.eventBus.emit('storage:pending_sync_changed', { count: data.workflows.length });
        }
      } catch (e) {
        console.error('[StorageManager] Failed to track pending sync:', e.message);
      }
    });
  }

  /**
   * Get pending sync data from storage
   * @returns {Object} { workflows: [...], tasks: [...] }
   */
  async _getPendingSyncData() {
    return new Promise(resolve => {
      chrome.storage.local.get([StorageManager.PENDING_SYNC_KEY], result => {
        const data = result[StorageManager.PENDING_SYNC_KEY] || {};
        resolve({
          workflows: data.workflows || [],
          tasks: data.tasks || []
        });
      });
    });
  }

  /**
   * Clear a workflow from pending sync (called after successful sync)
   * @param {string} wfId - Workflow ID to clear
   */
  async _clearPendingSync(wfId) {
    // M1: serialize under the module mutex.
    return _withPendingSyncLock(async () => {
      try {
        const data = await this._getPendingSyncData();
        data.workflows = data.workflows.filter(w => w.wf_id !== wfId);
        await chrome.storage.local.set({ [StorageManager.PENDING_SYNC_KEY]: data });
        console.log('[StorageManager] Cleared pending sync for workflow:', wfId);

        this._emitPendingSyncChanged(data);
      } catch (e) {
        console.error('[StorageManager] Failed to clear pending sync:', e.message);
      }
    });
  }

  /**
   * Track a task as pending sync (called when API save fails)
   * @param {string} taskId - Task ID
   * @param {number} updatedAt - Timestamp when task was updated
   */
  async _trackPendingSyncTask(taskId, updatedAt) {
    // LOCAL MODE: không có server để sync → không enqueue pending-sync.
    if (StorageManager._isLocalMode()) return;
    // M1: serialize under the module mutex.
    return _withPendingSyncLock(async () => {
      try {
        const userId = 'local_user' || ({ id: 'local_user', name: 'Local User', plan_slug: 'pro' })?.id || 'unknown';
        const data = await this._getPendingSyncData();

        const existingIdx = data.tasks.findIndex(t => t.task_id === taskId);
        const item = {
          task_id: taskId,
          updated_at: updatedAt,
          user_id: userId,
          created_at: Date.now()
        };

        if (existingIdx >= 0) {
          if (updatedAt > data.tasks[existingIdx].updated_at) {
            data.tasks[existingIdx] = item;
          }
        } else {
          data.tasks.push(item);
        }

        await chrome.storage.local.set({ [StorageManager.PENDING_SYNC_KEY]: data });
        console.log('[StorageManager] Tracked pending sync for task:', taskId);

        this._emitPendingSyncChanged(data);
      } catch (e) {
        console.error('[StorageManager] Failed to track pending sync for task:', e.message);
      }
    });
  }

  /**
   * Clear a task from pending sync (called after successful sync)
   * @param {string} taskId - Task ID to clear
   */
  async _clearPendingSyncTask(taskId) {
    // M1: serialize under the module mutex.
    return _withPendingSyncLock(async () => {
      try {
        const data = await this._getPendingSyncData();
        data.tasks = data.tasks.filter(t => t.task_id !== taskId);
        await chrome.storage.local.set({ [StorageManager.PENDING_SYNC_KEY]: data });
        console.log('[StorageManager] Cleared pending sync for task:', taskId);

        this._emitPendingSyncChanged(data);
      } catch (e) {
        console.error('[StorageManager] Failed to clear pending sync for task:', e.message);
      }
    });
  }

  /**
   * Emit pending sync changed event
   */
  _emitPendingSyncChanged(data) {
    if (window.eventBus) {
      window.eventBus.emit('storage:pending_sync_changed', {
        workflowCount: data.workflows.length,
        taskCount: data.tasks.length,
        count: data.workflows.length + data.tasks.length
      });
    }
  }

  /**
   * Get count of pending sync items (for UI indicator)
   * @returns {Object} { workflows, tasks, total }
   */
  async getPendingSyncCount() {
    const data = await this._getPendingSyncData();
    return {
      workflows: data.workflows.length,
      tasks: data.tasks.length,
      total: data.workflows.length + data.tasks.length
    };
  }

  /**
   * Manual trigger sync (can be called from UI)
   * @returns {Object} { synced, failed, skipped }
   */
  async syncPendingNow() {
    // LOCAL MODE: không có server → no-op.
    if (StorageManager._isLocalMode()) {
      return { synced: 0, failed: 0, skipped: 0 };
    }
    if (this.mode !== 'api') {
      console.warn('[StorageManager] Cannot sync: not in API mode');
      return { synced: 0, failed: 0, skipped: 0, error: 'NOT_API_MODE' };
    }

    // Sync both workflows and tasks
    const workflowResult = await this._syncPendingWorkflows();
    const taskResult = await this._syncPendingTasks();

    return {
      synced: workflowResult.synced + taskResult.synced,
      failed: workflowResult.failed + taskResult.failed,
      skipped: workflowResult.skipped + taskResult.skipped
    };
  }

  /**
   * Sync all pending tasks to server
   * @returns {Object} { synced: number, failed: number, skipped: number }
   */
  async _syncPendingTasks() {
    const result = { synced: 0, failed: 0, skipped: 0 };

    // LOCAL MODE: không có server → no-op.
    if (StorageManager._isLocalMode()) return result;

    try {
      if (this.mode !== 'api' || !this.storage) {
        return result;
      }

      const currentUserId = 'local_user' || ({ id: 'local_user', name: 'Local User', plan_slug: 'pro' })?.id;
      if (!currentUserId) {
        return result;
      }

      const data = await this._getPendingSyncData();
      const pendingTasks = data.tasks.filter(t => t.user_id === currentUserId || t.user_id === 'unknown');

      if (pendingTasks.length === 0) {
        return result;
      }

      console.log('[StorageManager] Syncing', pendingTasks.length, 'pending tasks');

      const local = new LocalStorage();

      for (const pending of pendingTasks) {
        try {
          // Get full task data from local
          const localTask = await local.getTask(pending.task_id);
          if (!localTask) {
            // Task was deleted locally, clear from pending
            await this._clearPendingSyncTask(pending.task_id);
            result.skipped++;
            continue;
          }

          // Try to sync to server
          await this.storage.saveTask(localTask);
          console.log('[StorageManager] Synced task:', pending.task_id);

          // Clear from pending and local
          await this._clearPendingSyncTask(pending.task_id);
          await local.deleteTask(pending.task_id);
          result.synced++;

        } catch (err) {
          console.error('[StorageManager] Failed to sync task:', pending.task_id, err.message);
          // If quota error, don't retry
          if (err.code === 'QUOTA_EXCEEDED' || err.httpStatus === 403) {
            await this._clearPendingSyncTask(pending.task_id);
            await local.deleteTask(pending.task_id);
            result.skipped++;
          } else {
            result.failed++;
          }
        }
      }

      console.log('[StorageManager] Task sync complete:', result);
    } catch (e) {
      console.error('[StorageManager] Task sync error:', e.message);
    }

    return result;
  }

  /**
   * Sync all pending workflows to server
   * Called on:
   *   1. init() with API mode
   *   2. switchToApi() before clearing local data
   *
   * Logic đảm bảo không duplicate/ghi đè nhầm:
   *   - Chỉ sync pending items của CURRENT user
   *   - So sánh updated_at: local mới hơn server → sync lên
   *   - Server mới hơn hoặc bằng → skip (server là source of truth)
   *   - Sync thành công → clear pending item + clear local workflow data
   *
   * @returns {Object} { synced: number, failed: number, skipped: number }
   */
  async _syncPendingWorkflows() {
    // LOCAL MODE: không có server → no-op.
    if (StorageManager._isLocalMode()) return { synced: 0, failed: 0, skipped: 0 };
    // Mutex: prevent concurrent syncs
    if (this._syncInProgress) {
      console.log('[StorageManager] Sync already in progress, skipping');
      return { synced: 0, failed: 0, skipped: 0 };
    }
    this._syncInProgress = true;

    const result = { synced: 0, failed: 0, skipped: 0 };

    try {
      // Must be in API mode
      if (this.mode !== 'api' || !this.storage) {
        console.log('[StorageManager] Not in API mode, skipping sync');
        return result;
      }

      const currentUserId = 'local_user' || ({ id: 'local_user', name: 'Local User', plan_slug: 'pro' })?.id;
      if (!currentUserId) {
        console.log('[StorageManager] No current user, skipping sync');
        return result;
      }

      const pendingData = await this._getPendingSyncData();
      const pendingWorkflows = pendingData.workflows || [];

      if (pendingWorkflows.length === 0) {
        return result;
      }

      console.log('[StorageManager] Found', pendingWorkflows.length, 'pending workflows to sync');

      const local = new LocalStorage();

      for (const pending of pendingWorkflows) {
        // Only sync items for current user (privacy: don't sync other user's data)
        if (pending.user_id !== currentUserId && pending.user_id !== 'unknown') {
          console.log('[StorageManager] Skipping pending sync for different user:', pending.wf_id);
          result.skipped++;
          // Clear this item since it belongs to different user
          await this._clearPendingSync(pending.wf_id);
          continue;
        }

        try {
          // Get local workflow data
          const localWorkflow = await local.getWorkflow(pending.wf_id);
          if (!localWorkflow) {
            console.warn('[StorageManager] Pending workflow not found in local:', pending.wf_id);
            await this._clearPendingSync(pending.wf_id);
            result.skipped++;
            continue;
          }

          // Check if server has this workflow
          let serverWorkflow = null;
          try {
            serverWorkflow = await this.storage.getWorkflow(pending.wf_id);
          } catch (e) {
            // If connection error, stop sync (will retry later)
            if (e._isConnectionError) {
              console.warn('[StorageManager] Connection error during sync, will retry later');
              result.failed++;
              continue;
            }
            // 404 or other error = workflow doesn't exist on server
          }

          // Conflict resolution: compare updated_at
          // M1 NOTE: this trusts client-supplied `updated_at` timestamps, which can
          // be stale or clock-skewed. A server-authoritative version/etag compared
          // via If-Match would be more robust; left as-is to avoid a protocol change.
          const localUpdatedAt = localWorkflow.updated_at || pending.updated_at || 0;
          const serverUpdatedAt = serverWorkflow?.updated_at || 0;

          if (serverWorkflow && serverUpdatedAt >= localUpdatedAt) {
            // Server has same or newer version → skip (server is source of truth)
            console.log('[StorageManager] Server has newer version, skipping:', pending.wf_id,
              'server:', serverUpdatedAt, 'local:', localUpdatedAt);
            await this._clearPendingSync(pending.wf_id);
            result.skipped++;
            continue;
          }

          // Local is newer or server doesn't have it → sync to server
          console.log('[StorageManager] Syncing workflow to server:', pending.wf_id,
            'local:', localUpdatedAt, 'server:', serverUpdatedAt || 'N/A');

          // Safety check: warn if syncing workflow with 0 nodes (might be stale data)
          const nodes = localWorkflow.nodes || [];
          const edges = localWorkflow.edges || [];
          if (nodes.length === 0 && serverWorkflow?.nodes?.length > 0) {
            console.warn('[StorageManager] Local workflow has 0 nodes but server has',
              serverWorkflow.nodes.length, '- skipping to prevent data loss');
            await this._clearPendingSync(pending.wf_id);
            result.skipped++;
            continue;
          }

          await this.storage.saveWorkflowFull(localWorkflow, nodes, edges);

          // Sync successful → clear pending item
          await this._clearPendingSync(pending.wf_id);
          result.synced++;

          console.log('[StorageManager] Successfully synced workflow:', pending.wf_id);

        } catch (e) {
          console.error('[StorageManager] Failed to sync workflow:', pending.wf_id, e.message);
          result.failed++;
          // Don't clear pending item - will retry next time
        }
      }

      // Notify if any synced
      if (result.synced > 0) {
        this.notify('pending_sync_completed', result);
        if (window.eventBus) {
          window.eventBus.emit('storage:pending_sync_completed', result);
        }
      }

      console.log('[StorageManager] Sync completed:', result);
      return result;

    } finally {
      this._syncInProgress = false;
    }
  }

  // Getter
  getMode() {
    return this.mode;
  }
}

// Singleton
window.storageManager = new StorageManager();
