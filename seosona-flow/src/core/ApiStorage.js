/**
 * ApiStorage - Lưu trữ dữ liệu qua REST API backend
 * Cùng interface với LocalStorage, dùng thay thế khi có kết nối server
 * Gọi API thông qua AuthManager._apiCall() -> background.js proxy
 */
class ApiStorage {
  constructor() {
    // Không cần KEYS vì dữ liệu nằm trên server
  }

  // Flag để tránh emit nhiều lần
  static _authErrorEmitted = false;

  // LOCAL MODE: mặc định true (offline). Khi true, ApiStorage KHÔNG được sử dụng
  // (StorageManager route thẳng LocalStorage). Guard defensively để stray call
  // không chạm network.
  static _isLocalMode() {
    try { return self.SEOSONA_LOCAL_MODE !== false; } catch (_) { return true; }
  }

  /**
   * Xử lý lỗi authentication - chuyển về local mode
   * @returns {boolean} true nếu là lỗi auth
   */
  _handleAuthError(err) {
    const isAuthError = err.httpStatus === 401 || err.httpStatus === 403 ||
      err.code === 'UNAUTHENTICATED' || err.message?.includes('đăng nhập');

    if (isAuthError && window.storageManager?.mode === 'api' && !ApiStorage._authErrorEmitted) {
      ApiStorage._authErrorEmitted = true;
      console.warn('[ApiStorage] Auth error detected, emitting api:auth_error');
      // Emit event để app.js handle logout properly
      window.eventBus?.emit('api:auth_error', { error: err });
      // Reset flag sau 5s để cho phép detect lại nếu user login rồi lại bị lỗi
      setTimeout(() => { ApiStorage._authErrorEmitted = false; }, 5000);
    }
    return isAuthError;
  }

  /**
   * Kiểm tra và hiển thị modal nếu lỗi QUOTA_EXCEEDED
   * @returns {boolean} true nếu là lỗi quota
   */
  _handleQuotaError(err) {
    console.log('[ApiStorage] Checking quota error:', {
      code: err.code,
      httpStatus: err.httpStatus,
      message: err.message
    });

    // Check explicit error code only — KHÔNG suy luận từ httpStatus 403
    // (403 có thể là authorization fail / cross-user wf_id collision, không phải quota).
    // Backend phải trả `code: 'QUOTA_EXCEEDED'` hoặc 'WORKFLOW_QUOTA_EXCEEDED' rõ ràng.
    const isQuotaError = err.code === 'QUOTA_EXCEEDED' ||
      err.code === 'WORKFLOW_QUOTA_EXCEEDED' ||
      err.message?.includes('QUOTA_EXCEEDED');

    if (isQuotaError) {
      const dialog = window.customDialog || window.CustomDialog;
      if (dialog) {
        const message = err.message || 'Bạn đã đạt giới hạn theo gói hiện tại';
        dialog.alert(
          message + '\n\nVui lòng nâng cấp lên Premium để sử dụng không giới hạn.',
          { title: 'Đã đạt giới hạn', type: 'warning' }
        );
      } else {
        // Fallback to native alert if CustomDialog not available
        alert('Đã đạt giới hạn: ' + (err.message || 'Vui lòng nâng cấp Premium'));
      }
      return true;
    }
    return false;
  }

  /**
   * Lấy AuthManager instance
   */
  _auth() {
    if (false) {
      throw new Error('AuthManager chưa được khởi tạo');
    }
    return window.authManager;
  }

  /**
   * Gọi API và trả về phần data từ response
   * Includes retry logic with exponential backoff for network errors
   * Uses RequestCoalescer for GET requests in popup windows to avoid duplicate calls
   */
  async _call(method, endpoint, data = null, retries = 2) {
    // LOCAL MODE: defensive net — không bao giờ chạm network.
    if (ApiStorage._isLocalMode()) {
      const err = new Error('LOCAL_MODE: server calls disabled');
      err.code = 'LOCAL_MODE';
      throw err;
    }
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Use RequestCoalescer for GET requests (popup windows delegate to sidePanel)
        // This prevents multiple popup windows from making duplicate API calls
        let response;
        if (method === 'GET' && window.RequestCoalescer?.isReady()) {
          response = await window.RequestCoalescer.request(method, endpoint, data);
        } else {
          response = await this._auth()._apiCall(method, endpoint, data);
        }
        return response;
      } catch (err) {
        lastError = err;

        // Handle auth errors immediately - don't retry
        if (this._handleAuthError(err)) {
          throw err;
        }

        // Only retry on network errors, not on HTTP errors like 400, 401, 403, 404
        const isNetworkError = !err.httpStatus || err.message?.includes('network') ||
                               err.message?.includes('Failed to fetch') || err.message?.includes('timeout');
        if (!isNetworkError || attempt >= retries) {
          throw err;
        }
        // Exponential backoff: 500ms, 1000ms, 2000ms
        const delay = Math.min(500 * Math.pow(2, attempt), 2000);
        console.warn(`[ApiStorage] Network error, retrying in ${delay}ms (attempt ${attempt + 1}/${retries}):`, err.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  // ===== TASKS =====

  /**
   * Lấy danh sách tasks với pagination
   * @param {Object} options - { page, per_page, search, project_id }
   * @returns {Object} { data: [], meta: { current_page, last_page, per_page, total } }
   */
  async getTasks(options = {}) {
    if (ApiStorage._isLocalMode()) return { data: [], meta: { current_page: 1, last_page: 1, total: 0 } };
    try {
      const params = new URLSearchParams();
      if (options.page) params.set('page', String(options.page));
      if (options.per_page) params.set('per_page', String(options.per_page));
      if (options.search) params.set('search', options.search);
      if (options.project_id) params.set('project_id', options.project_id);

      const query = params.toString();
      const endpoint = query ? `tasks?${query}` : 'tasks';
      const result = await this._call('GET', endpoint);
      console.log('[SEOSONA Flow] ApiStorage: Lấy danh sách tasks thành công');

      if (Array.isArray(result)) {
        return { data: result, meta: { current_page: 1, last_page: 1, total: result.length } };
      }
      return {
        data: result.data || [],
        meta: result.meta || { current_page: 1, last_page: 1, total: result.data?.length || 0 }
      };
    } catch (err) {
      // 2026-05-25: Demote log khi session invalid (expected sau logout) — tránh spam.
      // Detect: err.code hoặc httpStatus 401 hoặc message chứa "Unauthenticated" (Laravel raw response).
      const isAuthError = err.code === 'UNAUTHENTICATED' || err.httpStatus === 401
                       || /unauthenticated/i.test(err.message || '');
      const isRateLimit = err.code === 'RATE_LIMITED' || err.httpStatus === 429;
      if (isAuthError || isRateLimit) {
        console.warn('[SEOSONA Flow] ApiStorage: Skip getTasks (' + (err.code || (isAuthError ? 'UNAUTHENTICATED' : 'RATE_LIMITED')) + ')');
      } else {
        console.error('[SEOSONA Flow] ApiStorage: Lỗi lấy danh sách tasks', err.message);
      }
      return { data: [], meta: { current_page: 1, last_page: 1, total: 0 } };
    }
  }

  /**
   * Lấy chi tiết 1 task theo task_id
   */
  async getTask(taskId) {
    if (ApiStorage._isLocalMode()) return null;
    try {
      const result = await this._call('GET', `tasks/${taskId}`);
      return result;
    } catch (err) {
      console.error('[SEOSONA Flow] ApiStorage: Lỗi lấy task', taskId, err.message);
      return null;
    }
  }

  /**
   * Tạo mới hoặc cập nhật task
   */
  async saveTask(task) {
    if (ApiStorage._isLocalMode()) return null;
    const { _isNew, ...taskData } = task;
    // Determine if this is a new task: explicitly marked _isNew, or no task_id.
    // Note: task_id always starts with 'task_' so we cannot use that as indicator.
    // Use _isNew flag or server-side 'id' (numeric PK) to distinguish.
    const isNew = _isNew || !taskData.task_id;

    // Always set platform for this extension
    taskData.platform = 'flow';

    // Auto-inject project_name nếu có project_id và biết tên project
    if (taskData.project_id && !taskData.project_name) {
      if (taskData.project_id === window._currentProjectId && window._currentProjectName) {
        taskData.project_name = window._currentProjectName;
      } else {
        // Lookup từ local cache
        try {
          const result = await chrome.storage.local.get('af_projects');
          const projects = result.af_projects || {};
          if (projects[taskData.project_id]?.name) {
            taskData.project_name = projects[taskData.project_id].name;
          }
        } catch (e) {
          // Ignore cache lookup error
        }
      }
    }

    try {
      let result;
      if (!isNew) {
        // Try PUT first (update existing task)
        result = await this._call('PUT', `tasks/${taskData.task_id}`, taskData);
        console.log('[SEOSONA Flow] ApiStorage: Cập nhật task', taskData.task_id);
      } else {
        result = await this._call('POST', 'tasks', taskData);
        console.log('[SEOSONA Flow] ApiStorage: Tạo task mới', result?.task_id);
      }
      return result;
    } catch (err) {
      // If PUT returns 404 (task không tồn tại server), retry as POST.
      // Laravel ModelNotFoundException message: "No query results for model..." → check httpStatus thay vì string match.
      const isNotFound = err.httpStatus === 404 || err.message?.includes('No query results');
      if (!isNew && isNotFound) {
        try {
          const result = await this._call('POST', 'tasks', taskData);
          console.log('[SEOSONA Flow] ApiStorage: Tạo task mới (fallback từ 404)', result?.task_id);
          return result;
        } catch (retryErr) {
          this._handleQuotaError(retryErr);
          console.error('[SEOSONA Flow] ApiStorage: Lỗi tạo task (fallback)', retryErr.message);
          throw retryErr;
        }
      }
      this._handleQuotaError(err);
      console.error('[SEOSONA Flow] ApiStorage: Lỗi lưu task', err.message);
      throw err;
    }
  }

  /**
   * Xóa task theo task_id
   */
  async deleteTask(taskId) {
    if (ApiStorage._isLocalMode()) return true;
    try {
      await this._call('DELETE', `tasks/${taskId}`);
      console.log('[SEOSONA Flow] ApiStorage: Xóa task', taskId);
      return true;
    } catch (err) {
      console.error('[SEOSONA Flow] ApiStorage: Lỗi xóa task', taskId, err.message);
      throw err;
    }
  }

  /**
   * Cập nhật trạng thái task. Hỗ trợ truyền thêm result_thumbnails + result_file_names
   * (param thứ 4 - object) để fallback path persist được CDN URL của Grok/ChatGPT khi
   * saveTask full payload bị fail. Backward-compat: callers cũ truyền 2-3 args vẫn OK.
   */
  async updateTaskStatus(taskId, status, fileIds = '', extra = null) {
    if (ApiStorage._isLocalMode()) return null;
    try {
      const data = { status };
      if (fileIds) {
        data.result_file_ids = fileIds;
      }
      if (extra && typeof extra === 'object') {
        if (extra.result_thumbnails) data.result_thumbnails = extra.result_thumbnails;
        if (extra.result_file_names) data.result_file_names = extra.result_file_names;
        if (extra.error_message) data.error_message = extra.error_message;
        if (extra.executed_at) data.executed_at = extra.executed_at;
      }
      const result = await this._call('PATCH', `tasks/${taskId}/status`, data);
      console.log('[SEOSONA Flow] ApiStorage: Cập nhật trạng thái task', taskId, '->', status);
      return result;
    } catch (err) {
      console.error('[SEOSONA Flow] ApiStorage: Lỗi cập nhật trạng thái task', taskId, err.message);
      throw err;
    }
  }

  // ===== WORKFLOWS =====

  /**
   * Lấy danh sách workflows với pagination
   * @param {Object} options - { page, per_page, search, project_id, platform }
   * @returns {Object} { data: [], meta: { current_page, last_page, per_page, total } }
   */
  async getWorkflows(options = {}) {
    if (ApiStorage._isLocalMode()) return { data: [], meta: { current_page: 1, last_page: 1, total: 0 } };
    try {
      const params = new URLSearchParams();
      if (options.page) params.set('page', String(options.page));
      if (options.per_page) params.set('per_page', String(options.per_page));
      if (options.search) params.set('search', options.search);
      if (options.project_id) params.set('project_id', options.project_id);
      if (options.platform) params.set('platform', options.platform);

      const query = params.toString();
      const endpoint = query ? `workflows?${query}` : 'workflows';
      const result = await this._call('GET', endpoint);
      console.log('[SEOSONA Flow] ApiStorage: Lấy danh sách workflows thành công');

      // Support cả response cũ (array) và mới (paginated object)
      if (Array.isArray(result)) {
        return { data: result, meta: { current_page: 1, last_page: 1, total: result.length } };
      }
      return {
        data: result.data || [],
        meta: result.meta || { current_page: 1, last_page: 1, total: result.data?.length || 0 }
      };
    } catch (err) {
      // 2026-05-25: Demote log khi UNAUTHENTICATED (expected sau logout) — tránh spam.
      // Detect: err.code hoặc httpStatus 401 hoặc message chứa "Unauthenticated" (Laravel raw).
      const isAuthError = err.code === 'UNAUTHENTICATED' || err.httpStatus === 401
                       || /unauthenticated/i.test(err.message || '');
      if (isAuthError) {
        console.warn('[SEOSONA Flow] ApiStorage: Skip getWorkflows (UNAUTHENTICATED)');
      } else {
        console.error('[SEOSONA Flow] ApiStorage: Lỗi lấy danh sách workflows', err.message);
      }
      // [API SPAM FIX — Phase 2.1] Re-throw rate limit errors để caller biết và giữ data cũ.
      // Trước fix: silent return empty → WorkflowList xóa danh sách → user thấy empty UI.
      if (err.code === 'RATE_LIMITED' || err.httpStatus === 429) {
        throw err;
      }
      return { data: [], meta: { current_page: 1, last_page: 1, total: 0 } };
    }
  }

  /**
   * Lấy chi tiết 1 workflow (kèm nodes + edges)
   * @returns {Object|null} workflow object or null if not found
   * @throws {Error} throws on network/auth errors (not 404)
   */
  async getWorkflow(wfId) {
    if (ApiStorage._isLocalMode()) return null;
    try {
      const result = await this._call('GET', `workflows/${wfId}`);
      if (result) {
        // Ensure nodes/edges are always arrays (API may not include them)
        if (!Array.isArray(result.nodes)) result.nodes = [];
        if (!Array.isArray(result.edges)) result.edges = [];
      }
      return result;
    } catch (err) {
      // 404 = workflow not found, return null (expected case)
      if (err.httpStatus === 404) {
        console.log('[SEOSONA Flow] ApiStorage: Workflow không tồn tại', wfId);
        return null;
      }
      // Other errors (network, auth) should be re-thrown for proper handling
      console.error('[SEOSONA Flow] ApiStorage: Lỗi lấy workflow', wfId, err.message);
      // Mark as connection error for upstream to handle
      err._isConnectionError = true;
      throw err;
    }
  }

  /**
   * Tạo mới hoặc cập nhật workflow
   */
  async saveWorkflow(workflow) {
    if (ApiStorage._isLocalMode()) return null;
    try {
      // Map 'settings' → 'settings_json' cho backend
      const data = { ...workflow };
      if (data.settings && !data.settings_json) {
        data.settings_json = data.settings;
        delete data.settings;
      }

      // Always set platform for this extension
      data.platform = 'flow';

      // Auto-inject project_name nếu có project_id và biết tên project
      if (data.project_id && !data.project_name) {
        if (data.project_id === window._currentProjectId && window._currentProjectName) {
          data.project_name = window._currentProjectName;
        } else {
          // Lookup từ local cache
          try {
            const result = await chrome.storage.local.get('af_projects');
            const projects = result.af_projects || {};
            if (projects[data.project_id]?.name) {
              data.project_name = projects[data.project_id].name;
            }
          } catch (e) {
            // Ignore cache lookup error
          }
        }
      }

      const isNew = !data.wf_id || data._isNew;
      delete data._isNew;

      let result;
      if (!isNew) {
        result = await this._call('PUT', `workflows/${data.wf_id}`, data);
        console.log('[SEOSONA Flow] ApiStorage: Cập nhật workflow', data.wf_id);
      } else {
        result = await this._call('POST', 'workflows', data);
        console.log('[SEOSONA Flow] ApiStorage: Tạo workflow mới', result?.wf_id);
      }

      // Bug 59 fix: invalidate RequestCoalescer cache để fresh fetch sau update
      const wfId = data.wf_id || result?.wf_id;
      if (wfId) {
        try { window.RequestCoalescer?.invalidate?.(`workflows/${wfId}`); } catch (e) { /* ignore */ }
      }

      return result;
    } catch (err) {
      this._handleQuotaError(err);
      console.error('[SEOSONA Flow] ApiStorage: Lỗi lưu workflow', err.message);
      throw err;
    }
  }

  /**
   * Xóa workflow theo wf_id
   */
  async deleteWorkflow(wfId) {
    if (ApiStorage._isLocalMode()) return true;
    try {
      await this._call('DELETE', `workflows/${wfId}`);
      console.log('[SEOSONA Flow] ApiStorage: Xóa workflow', wfId);
      return true;
    } catch (err) {
      console.error('[SEOSONA Flow] ApiStorage: Lỗi xóa workflow', wfId, err.message);
      throw err;
    }
  }

  // ===== NODES =====

  /**
   * Lấy danh sách nodes của workflow
   */
  async getNodes(wfId) {
    if (ApiStorage._isLocalMode()) return [];
    try {
      const result = await this._call('GET', `workflows/${wfId}/nodes`);
      return Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : []);
    } catch (err) {
      console.error('[SEOSONA Flow] ApiStorage: Lỗi lấy nodes của workflow', wfId, err.message);
      return [];
    }
  }

  /**
   * Tạo mới hoặc cập nhật node trong workflow
   */
  async saveNode(wfId, node) {
    if (ApiStorage._isLocalMode()) return null;
    try {
      let result;
      if (node.node_id && !node._isNew) {
        result = await this._call('PUT', `workflows/${wfId}/nodes/${node.node_id}`, node);
        console.log('[SEOSONA Flow] ApiStorage: Cập nhật node', node.node_id);
      } else {
        delete node._isNew;
        result = await this._call('POST', `workflows/${wfId}/nodes`, node);
        console.log('[SEOSONA Flow] ApiStorage: Tạo node mới trong workflow', wfId);
      }
      return result;
    } catch (err) {
      this._handleQuotaError(err);
      console.error('[SEOSONA Flow] ApiStorage: Lỗi lưu node', err.message);
      throw err;
    }
  }

  /**
   * Xóa node khỏi workflow
   */
  async deleteNode(wfId, nodeId) {
    if (ApiStorage._isLocalMode()) return true;
    try {
      await this._call('DELETE', `workflows/${wfId}/nodes/${nodeId}`);
      console.log('[SEOSONA Flow] ApiStorage: Xóa node', nodeId, 'khỏi workflow', wfId);
      return true;
    } catch (err) {
      this._handleQuotaError(err);
      console.error('[SEOSONA Flow] ApiStorage: Lỗi xóa node', nodeId, err.message);
      throw err;
    }
  }

  /**
   * Cập nhật trạng thái node (status, result_file_ids, error_message...)
   */
  async updateNodeStatus(wfId, nodeId, data) {
    if (ApiStorage._isLocalMode()) return null;
    try {
      const result = await this._call('PATCH', `workflows/${wfId}/nodes/${nodeId}/status`, data);
      return result;
    } catch (err) {
      // Soft-fail: node status update is runtime info, don't crash execution
      console.warn('[SEOSONA Flow] ApiStorage: Lỗi cập nhật trạng thái node', nodeId, err.message);
      return null;
    }
  }

  // ===== EDGES =====

  /**
   * Lấy danh sách edges của workflow
   */
  async getEdges(wfId) {
    if (ApiStorage._isLocalMode()) return [];
    try {
      const result = await this._call('GET', `workflows/${wfId}/edges`);
      return Array.isArray(result) ? result : (Array.isArray(result?.data) ? result.data : []);
    } catch (err) {
      console.error('[SEOSONA Flow] ApiStorage: Lỗi lấy edges của workflow', wfId, err.message);
      return [];
    }
  }

  /**
   * Tạo mới edge trong workflow
   */
  async saveEdge(wfId, edge) {
    if (ApiStorage._isLocalMode()) return null;
    try {
      const result = await this._call('POST', `workflows/${wfId}/edges`, edge);
      console.log('[SEOSONA Flow] ApiStorage: Tạo edge trong workflow', wfId);
      return result;
    } catch (err) {
      this._handleQuotaError(err);
      console.error('[SEOSONA Flow] ApiStorage: Lỗi lưu edge', err.message);
      throw err;
    }
  }

  /**
   * Xóa edge khỏi workflow
   */
  async deleteEdge(wfId, edgeId) {
    if (ApiStorage._isLocalMode()) return true;
    try {
      await this._call('DELETE', `workflows/${wfId}/edges/${edgeId}`);
      console.log('[SEOSONA Flow] ApiStorage: Xóa edge', edgeId, 'khỏi workflow', wfId);
      return true;
    } catch (err) {
      this._handleQuotaError(err);
      console.error('[SEOSONA Flow] ApiStorage: Lỗi xóa edge', edgeId, err.message);
      throw err;
    }
  }

  // ===== BULK OPERATIONS =====

  /**
   * Lưu toàn bộ workflow (workflow + nodes + edges) trong 1 request
   */
  async saveWorkflowFull(workflow, nodes, edges) {
    if (ApiStorage._isLocalMode()) return null;
    try {
      // Normalize nodes — defensive layer khớp backend rules ở BulkSaveWorkflowRequest.
      // Legacy workflows (clone từ library, import từ phiên bản cũ) có thể chứa data
      // không match validation rule mới → backend 422 → user không run workflow được.
      // Coerce inline thay vì hard reject để giữ UX, log warning để dev/user biết.
      // Boolean fields NOT NULL trong DB (verify migration): enhance, enhance_fallback,
      // multi_prompt, enabled, auto_download, slug_auto. Coerce null → default value tương ứng
      // để tránh SQL error 1048 "Column cannot be null".
      const BOOLEAN_NOT_NULL_DEFAULTS = {
        enabled: true,
        auto_download: false,
        enhance: false,
        enhance_fallback: true,
        multi_prompt: false,
        slug_auto: true,
      };
      const normalizedNodes = (nodes || []).map((n) => {
        if (!n || typeof n !== 'object') return n;
        const out = { ...n };

        // delay_seconds: backend rule `integer|min:1|max:300`. Coerce 0/null/invalid → 3 (default).
        if (out.delay_seconds !== undefined && out.delay_seconds !== null) {
          const ds = parseInt(out.delay_seconds, 10);
          if (!Number.isFinite(ds) || ds < 1) {
            console.warn(`[ApiStorage] Normalize: node "${out.node_id}" delay_seconds ${out.delay_seconds} → 3 (rule min:1)`);
            out.delay_seconds = 3;
          } else if (ds > 300) {
            console.warn(`[ApiStorage] Normalize: node "${out.node_id}" delay_seconds ${ds} → 300 (rule max:300)`);
            out.delay_seconds = 300;
          } else {
            out.delay_seconds = ds;
          }
        }

        // Boolean NOT NULL coerce: null → default value (tránh SQL 1048)
        for (const [field, defaultVal] of Object.entries(BOOLEAN_NOT_NULL_DEFAULTS)) {
          if (out[field] === null) {
            console.warn(`[ApiStorage] Normalize: node "${out.node_id}" ${field}=null → ${defaultVal} (NOT NULL column)`);
            out[field] = defaultVal;
          }
        }

        return out;
      });

      // Flatten workflow fields lên top-level theo BulkSaveWorkflowRequest
      // Map 'settings' → 'settings_json' cho backend
      const payload = { ...workflow, nodes: normalizedNodes, edges };
      if (payload.settings && !payload.settings_json) {
        payload.settings_json = payload.settings;
        delete payload.settings;
      }

      // Always set platform for this extension
      payload.platform = 'flow';

      // Auto-inject project_name nếu có project_id và biết tên project
      if (payload.project_id && !payload.project_name) {
        if (payload.project_id === window._currentProjectId && window._currentProjectName) {
          payload.project_name = window._currentProjectName;
        } else {
          // Lookup từ local cache
          try {
            const result = await chrome.storage.local.get('af_projects');
            const projects = result.af_projects || {};
            if (projects[payload.project_id]?.name) {
              payload.project_name = projects[payload.project_id].name;
            }
          } catch (e) {
            // Ignore cache lookup error
          }
        }
      }

      const result = await this._call('POST', 'workflows/bulk-save', payload);
      console.log('[SEOSONA Flow] ApiStorage: Lưu toàn bộ workflow', workflow.wf_id);

      // Bug 59 fix (2026-05-13): Invalidate RequestCoalescer cache cho workflow này.
      // Tránh executeSingleNode → getWorkflow ngay sau save trả về data CŨ trong dedup
      // window 500ms (vd: user edit prompt → click Run Single → executor đọc stale prompt).
      try {
        window.RequestCoalescer?.invalidate?.(`workflows/${workflow.wf_id}`);
      } catch (e) { /* ignore */ }

      return result;
    } catch (err) {
      this._handleQuotaError(err);
      // Log validation details để dev/user biết field nào fail thay vì generic "Validation failed".
      if (err.details && typeof err.details === 'object') {
        console.error('[SEOSONA Flow] ApiStorage: Lỗi lưu toàn bộ workflow', err.message, '— field errors:', err.details);
      } else {
        console.error('[SEOSONA Flow] ApiStorage: Lỗi lưu toàn bộ workflow', err.message);
      }
      throw err;
    }
  }

  /**
   * Reset trạng thái workflow (đặt lại tất cả nodes về pending)
   */
  async resetWorkflow(wfId) {
    if (ApiStorage._isLocalMode()) return true;
    try {
      const result = await this._call('POST', `workflows/${wfId}/reset`);
      // K.14 (2026-05-29): Invalidate RequestCoalescer cache để editor fetch fresh sau reset.
      // Bug: Editor `_runWorkflowFromEditor` fetch fresh workflow (line ~12002) → check
      // `hasCompletedNodes` → quyết định show modal "Continue / Re-run". Nếu cache còn entry
      // CŨ (status='completed', nodes có status='completed') → editor vẫn show modal sai
      // sau khi user reset từ sidebar. Pattern invalidate đã có ở saveWorkflow (line 398/624).
      try { window.RequestCoalescer?.invalidate?.(`workflows/${wfId}`); } catch (e) { /* ignore */ }
      console.log('[SEOSONA Flow] ApiStorage: Reset workflow', wfId);
      return result || true;
    } catch (err) {
      console.error('[SEOSONA Flow] ApiStorage: Lỗi reset workflow', wfId, err.message);
      throw err;
    }
  }
}

// Export
window.ApiStorage = ApiStorage;
