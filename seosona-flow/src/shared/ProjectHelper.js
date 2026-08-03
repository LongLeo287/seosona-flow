/**
 * ProjectHelper — Shared utilities for cross-project operations
 */
(function() {
  'use strict';

  const ProjectHelper = {
    /**
     * Check if item belongs to current project context.
     * - No project_id → legacy/orphan: always allow (backward-compat, không có project context để compare)
     * - Item HAS project_id nhưng KHÔNG có window._currentProjectId → cross-project
     *   (user phải mở Flow tab hoặc dùng cross-project warning để switch/clone)
     * - Match: item.project_id === window._currentProjectId
     */
    isCurrentProject(item) {
      if (!item.project_id) return true;
      // CRITICAL: Khi user chưa có project context (sidebar mở mà không có Flow tab),
      // workflow có project_id phải treat là cross-project — không cho edit trực tiếp,
      // tránh chỉnh sửa nhầm dữ liệu thuộc project khác.
      if (!window._currentProjectId) return false;
      return item.project_id === window._currentProjectId;
    },

    /**
     * Gate chạy workflow theo project — CHỈ cho chạy khi Flow đang ở ĐÚNG project của workflow.
     * Dùng chung MCP run_workflow + UI single run. Các case còn lại trả lỗi rõ (không tự navigate).
     *  - wf không gắn project_id → project-agnostic, chạy đâu cũng được.
     *  - wf có project_id nhưng KHÔNG ở đúng project (chưa mở Flow / homepage / project khác) → WRONG_PROJECT.
     *  - Đúng project nhưng project lỗi/đã xoá (isFlowProjectReady=false) → PROJECT_NOT_READY.
     * @returns {Promise<{ok:boolean, code?:string, expectedProjectId?:string, expectedName?:string}>}
     */
    async checkWorkflowProjectGate(wf) {
      if (!wf?.project_id) return { ok: true };
      if (!this.isCurrentProject(wf)) {
        let name = wf.project_name || null;
        if (!name) { try { name = await this.getProjectName(wf.project_id); } catch (_) { globalThis.SEOSONA_swallow?.('ProjectHelper#checkWorkflowProjectGate', _); } }
        return { ok: false, code: 'WRONG_PROJECT', expectedProjectId: wf.project_id, expectedName: name };
      }
      try {
        const ready = await this.isFlowProjectReady();
        if (ready === false) return { ok: false, code: 'PROJECT_NOT_READY', expectedProjectId: wf.project_id };
      } catch (_) { globalThis.SEOSONA_swallow?.('ProjectHelper#checkWorkflowProjectGate', _); }
      return { ok: true };
    },

    /**
     * Append " 2", " 3"... vào baseName cho đến khi không trùng existingNames.
     * Nếu baseName đã có suffix " N" → tăng N tiếp.
     *
     * Pattern đồng bộ DiagramCanvas._uniquifyNodeName: clone "X (bản sao)" 2 lần →
     * "X (bản sao)" + "X (bản sao) 2". Limitation: existingNames thường chỉ chứa
     * page hiện tại (paginated list), nên có thể không catch trùng với pages khác.
     */
    uniquifyName(baseName, existingNames) {
      if (!baseName) return baseName;
      const existing = new Set(Array.isArray(existingNames) ? existingNames.filter(Boolean) : []);
      if (!existing.has(baseName)) return baseName;
      const m = baseName.match(/^(.+?)\s+(\d+)$/);
      const root = m ? m[1] : baseName;
      let counter = m ? (parseInt(m[2], 10) + 1) : 2;
      let candidate = `${root} ${counter}`;
      // Safety cap tránh infinite loop nếu data corrupt
      const MAX = 100000;
      while (existing.has(candidate)) {
        counter++;
        if (counter > MAX) {
          console.warn('[ProjectHelper] uniquifyName overflow, fallback to timestamp suffix');
          return `${root} ${Date.now()}`;
        }
        candidate = `${root} ${counter}`;
      }
      return candidate;
    },

    /**
     * Get project name from af_projects cache
     */
    async getProjectName(projectId) {
      if (!projectId) return window.I18n?.t('project.shared') || 'Chung';
      try {
        const result = await chrome.storage.local.get('af_projects');
        const projects = result.af_projects || {};
        return projects[projectId]?.name || projectId.substring(0, 8);
      } catch (e) {
        return projectId.substring(0, 8);
      }
    },

    /**
     * Get all known projects from af_projects cache + API fallback
     */
    async getProjectList() {
      try {
        const result = await chrome.storage.local.get('af_projects');
        let projects = result.af_projects || {};

        // Nếu cache rỗng hoặc có unknown project_ids, fetch từ API
        if (Object.keys(projects).length === 0 && true) {
          projects = await this.fetchProjectNamesFromApi() || {};
        }

        return projects;
      } catch (e) {
        return {};
      }
    },

    /**
     * Fetch project names từ backend API và merge vào local cache
     */
    async fetchProjectNamesFromApi() {
      // Local/offline: project names phục vụ từ cache local af_projects — không gọi backend.
      if (self.SEOSONA_LOCAL_MODE !== false) return null;

      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'apiRequest',
            method: 'GET',
            endpoint: 'projects/names',
            token: window.authManager?.token
          }, (resp) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(resp);
          });
        });

        if (response?.success && response.data) {
          // Merge với local cache
          const result = await chrome.storage.local.get('af_projects');
          const localProjects = result.af_projects || {};

          for (const [pid, info] of Object.entries(response.data)) {
            if (!localProjects[pid] || !localProjects[pid].name) {
              localProjects[pid] = {
                ...localProjects[pid],
                name: info.name,
                last_accessed: info.last_accessed_at ? new Date(info.last_accessed_at).getTime() : Date.now()
              };
            }
          }

          await chrome.storage.local.set({ af_projects: localProjects });
          return localProjects;
        }
      } catch (e) {
        console.warn('[ProjectHelper] fetchProjectNamesFromApi error:', e.message);
      }
      return null;
    },

    /**
     * Sync current project lên backend
     */
    async syncCurrentProject() {
      if (!window._currentProjectId || !window._currentProjectName) return;
      // Local/offline: project lưu local, không sync backend.
      if (self.SEOSONA_LOCAL_MODE !== false) return;

      try {
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'apiRequest',
            method: 'POST',
            endpoint: 'projects/sync',
            token: window.authManager?.token,
            data: {
              project_id: window._currentProjectId,
              project_name: window._currentProjectName
            }
          }, (resp) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(resp);
          });
        });
      } catch (e) {
        console.warn('[ProjectHelper] syncCurrentProject error:', e.message);
      }
    },

    /**
     * Ensure project names are available for given project IDs
     * Fetch từ API nếu local cache thiếu
     */
    async ensureProjectNames(projectIds) {
      if (!projectIds?.length) return;

      const result = await chrome.storage.local.get('af_projects');
      const projects = result.af_projects || {};

      const missing = projectIds.filter(pid => pid && !projects[pid]?.name);
      if (missing.length > 0) {
        await this.fetchProjectNamesFromApi();
      }
    },

    /**
     * Sort + group items by project
     * Current project first, then alphabetical, finally "Chung" (no project_id)
     */
    async sortByProjectGroup(items, currentProjectId) {
      const projects = await this.getProjectList();

      // Group items
      const currentItems = [];
      const otherGroups = {}; // { projectId: items[] }
      const legacyItems = []; // no project_id

      for (const item of items) {
        if (!item.project_id) {
          legacyItems.push(item);
        } else if (item.project_id === currentProjectId) {
          currentItems.push(item);
        } else {
          if (!otherGroups[item.project_id]) otherGroups[item.project_id] = [];
          otherGroups[item.project_id].push(item);
        }
      }

      // Sort other groups by project name alphabetically
      const sortedOtherKeys = Object.keys(otherGroups).sort((a, b) => {
        const nameA = projects[a]?.name || a;
        const nameB = projects[b]?.name || b;
        return nameA.localeCompare(nameB);
      });

      // Sort helper: MỚI / VỪA SỬA lên đầu (rebuild My Spaces — user chọn "mới nhất lên đầu").
      // Ưu tiên updated_at (vừa sửa) → created_at → timestamp trong id (wf_<ts>/task_<ts>). DESC.
      const _timeOf = (x) => {
        const t = x.updated_at || x.created_at;
        if (t) { const ms = new Date(t).getTime(); if (!isNaN(ms)) return ms; }
        const id = x.wf_id || x.task_id || '';
        return parseInt(id.replace(/^(wf_|task_)/, '')) || 0;
      };
      const sortByCreatedAt = (arr) => arr.sort((a, b) => _timeOf(b) - _timeOf(a));

      // Build grouped result
      const result = [];

      if (currentItems.length > 0) {
        const name = projects[currentProjectId]?.name || window._currentProjectName || (window.I18n?.t('project.currentProject') || 'Project hiện tại');
        result.push({ type: 'header', projectId: currentProjectId, projectName: name, count: currentItems.length, isCurrent: true });
        // Sort items by created_at within group
        result.push(...sortByCreatedAt(currentItems).map(item => ({ type: 'item', item })));
      }

      for (const pid of sortedOtherKeys) {
        const name = projects[pid]?.name || pid.substring(0, 8);
        result.push({ type: 'header', projectId: pid, projectName: name, count: otherGroups[pid].length, isCurrent: false });
        // Sort items by created_at within group
        result.push(...sortByCreatedAt(otherGroups[pid]).map(item => ({ type: 'item', item })));
      }

      if (legacyItems.length > 0) {
        result.push({ type: 'header', projectId: null, projectName: window.I18n?.t('project.shared') || 'Chung', count: legacyItems.length, isCurrent: false });
        // Sort items by created_at within group
        result.push(...sortByCreatedAt(legacyItems).map(item => ({ type: 'item', item })));
      }

      return result;
    },

    /**
     * Get unique project IDs from items list
     */
    getUniqueProjectIds(items) {
      const ids = new Set();
      for (const item of items) {
        if (item.project_id) ids.add(item.project_id);
      }
      return [...ids];
    },

    /**
     * Phase 2 (Flow-centric model): Migrate legacy items (project_id=null) sang
     * current Flow project. Batch update via storageManager.
     * @param {Array} legacyItems — items với project_id=null/undefined
     * @param {'task'|'workflow'} type
     * @returns {number} số items đã migrate (0 nếu skip / fail)
     */
    async migrateLegacyItems(legacyItems, type) {
      if (!legacyItems?.length || !window._currentProjectId || !window.storageManager) return 0;
      const projectId = window._currentProjectId;
      let count = 0;
      for (const item of legacyItems) {
        try {
          const updated = { ...item, project_id: projectId };
          if (type === 'task') {
            await window.storageManager.saveTask(updated);
          } else if (type === 'workflow') {
            await window.storageManager.saveWorkflow(updated);
          }
          count++;
        } catch (e) {
          console.warn(`[ProjectHelper] Migrate ${type} ${item.task_id || item.wf_id} failed:`, e.message);
        }
      }
      return count;
    },

    /**
     * Render migration banner HTML — hiển thị khi list có legacy items (project_id=null).
     * User click "Gán" → migrate, click "Bỏ qua" → dismiss session.
     * @param {number} count — số items legacy
     * @param {'task'|'workflow'} type
     * @returns {string} HTML
     */
    renderMigrationBanner(count, type) {
      if (!count || !window._currentProjectId) return '';
      const dismissKey = `legacy_migrate_${type}_dismissed`;
      if (sessionStorage.getItem(dismissKey)) return '';
      const I = window.I18n;
      const typeLabel = type === 'task'
        ? (I?.t('tasks.title') || 'task')
        : (I?.t('workflow.title') || 'workflow');
      const projName = window._currentProjectName || (I?.t('project.currentProject') || 'project hiện tại');
      const msg = (I?.t('project.migrateLegacyMsg', { count, type: typeLabel, project: projName })
        || `${count} ${typeLabel} chưa gán project. Gán vào "${projName}"?`);
      const btnAssign = I?.t('project.migrateAssign') || 'Gán tất cả';
      const btnSkip = I?.t('project.migrateSkip') || 'Bỏ qua';
      return `<div class="legacy-migrate-banner" data-type="${type}">
        <div class="legacy-migrate-banner-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        </div>
        <div class="legacy-migrate-banner-text">${msg}</div>
        <button class="legacy-migrate-btn legacy-migrate-btn-skip" data-action="skip">${btnSkip}</button>
        <button class="legacy-migrate-btn legacy-migrate-btn-assign" data-action="assign">${btnAssign}</button>
      </div>`;
    },

    /**
     * Show cross-project warning modal
     * Returns 'switch' if user wants to switch, null if cancelled
     * @param {Object} item
     * @param {'task'|'workflow'} itemType
     * @param {Object} [options]
     * @param {string} [options.confirmTextKey] — i18n key override cho confirm button
     *        (vd 'project.openProject' cho Edit flow → "Mở project")
     * @param {string} [options.confirmTextFallback] — fallback text nếu i18n miss
     */
    async showCrossProjectWarning(item, itemType = 'task', options = {}) {
      const projectName = await this.getProjectName(item.project_id);
      const typeLabel = itemType === 'task' ? 'Task' : 'Workflow';

      const confirmKey = options.confirmTextKey || 'project.crossProjectConfirm';
      const confirmFallback = options.confirmTextFallback || 'Chuyển project';

      const result = await window.customDialog?.confirm(
        window.I18n?.t('project.crossProjectMsg', { type: typeLabel, name: projectName }) ||
          `${typeLabel} này thuộc project "${projectName}".\nBạn cần nhân bản / chuyển sang project gốc để chỉnh sửa hoặc chạy.`,
        {
          title: window.I18n?.t('project.crossProjectTitle') || 'Khác project',
          type: 'warning',
          confirmText: window.I18n?.t(confirmKey) || confirmFallback,
          cancelText: window.I18n?.t('project.crossProjectCancel') || 'Đóng'
        }
      );

      if (result) {
        return 'switch';
      }
      return null;
    },

    /**
     * Navigate to a specific Flow project.
     * Bug fix 2026-06-04: Trước fix emit eventBus 'project:navigate' nhưng KHÔNG có listener
     * → button "Chuyển project" trong cross-project warning modal không có gì xảy ra.
     * Đúng pattern (giống app.js dropdown line 757-761): chrome.runtime.sendMessage tới
     * background handler 'navigateToProject' (background.js:3146) — update Flow tab URL +
     * focus window. Sau khi tab navigate, `_requestProjectContext` ở app.js sẽ tự fetch +
     * emit 'project:changed' → các tab reload data.
     */
    navigateToProject(projectId) {
      if (!projectId) return;
      const flowBase = window.ProviderConfigManager?.getBaseUrlSync?.('flow');
      if (!flowBase) {
        console.warn('[ProjectHelper] navigateToProject: Flow base URL missing — skip switch');
        return;
      }
      try {
        chrome.runtime.sendMessage({
          action: 'navigateToProject',
          url: `${flowBase}/project/${projectId}`,
          projectId,
        });
      } catch (e) {
        console.warn('[ProjectHelper] navigateToProject failed:', e?.message);
      }
    },

    /**
     * Kiểm tra LIVE có Flow project active không (query Flow tab qua background).
     * KHÔNG tin `window._currentProjectId` (có thể stale khi user đổi tab sang homepage
     * mà sidebar chưa kịp đồng bộ projectContext).
     * @returns {Promise<boolean>}
     */
    async hasActiveProject() {
      return await new Promise(resolve => {
        try {
          chrome.runtime.sendMessage({ action: 'getFlowProjectContext' }, (resp) => {
            resolve(!chrome.runtime.lastError && !!(resp && resp.projectId));
          });
        } catch (_) { resolve(false); }
      });
    },

    /**
     * Kiểm tra LIVE Flow project đã SẴN SÀNG chưa: có project active VÀ KHÔNG ở trạng thái
     * lỗi/đã xoá (URL còn /project/{id} nhưng trang render "Đã xảy ra lỗi" — projectError=true).
     * Dùng để gate mở workflow editor (không mở khi project chưa sẵn sàng).
     * @returns {Promise<boolean>}
     */
    async isFlowProjectReady() {
      return await new Promise(resolve => {
        try {
          chrome.runtime.sendMessage({ action: 'getFlowProjectContext' }, (resp) => {
            if (chrome.runtime.lastError || !resp) return resolve(false);
            resolve(!!resp.projectId && resp.projectError !== true);
          });
        } catch (_) { resolve(false); }
      });
    },

    /**
     * Modal cảnh báo "chưa có Flow project active" (cho upload ref ảnh) + nút đi tới project / mở Flow.
     * Dedupe: chỉ 1 modal tại 1 thời điểm (tránh batch upload bung nhiều modal).
     * @param {string|null} navTarget - project_id để đi tới; null → mở Flow homepage để user chọn/tạo.
     */
    async warnNoProjectForUpload(navTarget = null, customMessage = null) {
      if (this._noProjectModalOpen) return;
      this._noProjectModalOpen = true;
      const target = navTarget || window._currentProjectId || null;
      const confirmText = target
        ? (window.I18n?.t('workflow.goToProject') || 'Đi tới project')
        : (window.I18n?.t('workflow.goToFlow') || 'Mở Flow');
      let go = false;
      try {
        go = window.customDialog
          ? await window.customDialog.confirm(
              customMessage || window.I18n?.t('workflow.noProjectUpload') || 'Bạn đang ở trang chủ Google Flow (chưa mở project nào). Upload ảnh tham chiếu cần 1 project đang mở — hãy mở/tạo project rồi thử lại.',
              {
                title: window.I18n?.t('workflow.noProjectTitle') || 'Chưa có project Flow',
                type: 'warning',
                confirmText,
                cancelText: window.I18n?.t('common.close') || 'Đóng',
              }
            )
          : false;
      } finally { this._noProjectModalOpen = false; }
      if (go) {
        if (target) {
          this.navigateToProject(target);
        } else {
          const fb = window.ProviderConfigManager?.getBaseUrlSync?.('flow');
          if (fb) { try { chrome.runtime.sendMessage({ action: 'navigateToProject', url: fb }); } catch (_) { globalThis.SEOSONA_swallow?.('ProjectHelper#warnNoProjectForUpload', _); } }
        }
      }
    },

    /**
     * Guidance khi user CHƯA có Flow project sẵn sàng (chưa mở Flow / homepage / project lỗi).
     * Hiện modal "chưa có project + nút Mở Flow" với message ngữ cảnh workflow. Không chặn cứng —
     * caller quyết định. Dùng cho: modal select-project abort (no Flow tab) + clone/use template.
     * @returns {Promise<boolean>} true nếu project ĐÃ sẵn sàng; false nếu chưa (đã show guidance).
     */
    async ensureProjectOrGuide(customMessage = null) {
      // Query LIVE context 1 lần: vừa check ready, vừa lấy projectId để SYNC cache.
      // Chống TOCTOU: gate pass (live ready) nhưng window._currentProjectId stale/null → bind site
      // (import/shared/template clone dùng `window._currentProjectId || null`) tạo workflow với
      // project_id null → "chết". Sync ở đây đảm bảo bind dùng đúng projectId live.
      let ctx = null;
      try {
        ctx = await new Promise(resolve => {
          try {
            chrome.runtime.sendMessage({ action: 'getFlowProjectContext' }, (resp) => {
              resolve(chrome.runtime.lastError ? null : resp);
            });
          } catch (_) { resolve(null); }
        });
      } catch (_) { ctx = null; }

      const ready = !!(ctx && ctx.projectId && ctx.projectError !== true);
      if (ready) {
        if (window._currentProjectId !== ctx.projectId) {
          window._currentProjectId = ctx.projectId;
          if (ctx.tabId) window._targetFlowTabId = ctx.tabId; // execution targeting (setter auto-persist)
        }
        return true;
      }
      const msg = customMessage || window.I18n?.t('workflow.noProjectForWorkflow')
        || 'Bạn chưa mở Google Flow hoặc chưa vào 1 project. Workflow cần 1 Flow project đang mở để chạy — hãy mở Flow rồi tạo/chọn 1 project.';
      this.warnNoProjectForUpload(null, msg); // non-blocking: hiện modal hướng dẫn (nút "Mở Flow")
      return false;
    },

    /**
     * Show cross-project clone confirmation
     * Returns true if user confirms clone
     */
    async showCloneConfirmation(itemType = 'task') {
      return window.customDialog?.confirm(
        window.I18n?.t('project.cloneDescription') || 'Sao chép sẽ giữ lại cấu trúc và prompt, nhưng xóa ảnh tham chiếu và kết quả (do thuộc project khác).',
        {
          title: window.I18n?.t('project.cloneTitle') || 'Sao chép từ project khác',
          type: 'warning',
          confirmText: window.I18n?.t('project.clone') || 'Sao chép',
          cancelText: window.I18n?.t('common.cancel') || 'Hủy'
        }
      );
    },

    /**
     * Clone task with cross-project media reset
     */
    cloneTaskCrossProject(task) {
      const cloned = JSON.parse(JSON.stringify(task));
      cloned.task_id = window.IdGenerator ? window.IdGenerator.next('task') : `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      cloned.project_id = window._currentProjectId || null;
      cloned.task_name = (cloned.task_name || 'Task') + ' ' + (window.I18n?.t('project.copySuffix') || '(copy)');
      cloned.status = 'pending';

      // Smart Clone: giữ ref metadata (file_names + thumbnails) để reupload pipeline tự xử lý
      // Chỉ xóa tile_ids (session-specific, không hợp lệ cross-project)
      // ref_file_names (UUID) + ref_thumbnails (CDN URL) → reuploadMissingFiles dùng để fetch + upload lại
      cloned.ref_file_ids = '';
      // GIỮ: cloned.ref_file_names — file_name UUIDs, globally unique
      // GIỮ: cloned.ref_thumbnails — CDN URLs, accessible cùng Google account

      // Reset results (kết quả thuộc project cũ, không cần giữ)
      cloned.result_file_ids = '';
      cloned.result_thumbnails = {};
      cloned.result_file_names = {};
      cloned.error_message = '';
      cloned.executed_at = null;

      // Smart Clone frames: giữ file_name + thumbnail cho reupload, xóa tile_id
      if (cloned.frame_1_file_id) {
        // Giữ frame_1_file_name + frame_1_thumbnail (nếu có), xóa tile_id
        cloned.frame_1_file_id = '';
      }
      if (cloned.frame_2_file_id) {
        cloned.frame_2_file_id = '';
      }
      // GIỮ: frame_1_file_name, frame_1_thumbnail, frame_2_file_name, frame_2_thumbnail

      // Reset pending upload keys
      if (cloned.pending_upload_keys) cloned.pending_upload_keys = [];

      return cloned;
    },

    /**
     * Clone workflow with cross-project media reset
     */
    cloneWorkflowCrossProject(workflow, nodes = [], edges = []) {
      // UUID + timestamp tránh collision khi concurrent clone.
      const newWfId = window.IdGenerator ? window.IdGenerator.next('wf') : `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const nodeIdMap = {};

      // Clone nodes with new IDs + reset media.
      // Status 'pending' đồng nhất với DiagramCanvas.exportWorkflow default.
      const newNodes = nodes.map((node, i) => {
        const newNodeId = window.IdGenerator ? window.IdGenerator.next('node') : `node_${Date.now()}_${i}`;
        nodeIdMap[node.node_id] = newNodeId;
        const cloned = {
          ...JSON.parse(JSON.stringify(node)),
          node_id: newNodeId,
          wf_id: newWfId,
          status: 'pending',
          result_file_ids: '',
          error_message: '',
          executed_at: null
        };
        // Smart Clone: giữ ref metadata (file_names + thumbnails) để reupload pipeline tự xử lý
        // Chỉ xóa tile_ids (session-specific), GIỮ file_names (UUID) + thumbnails (CDN URL)
        cloned.ref_file_ids = '';
        // GIỮ: cloned.ref_file_names — file_name UUIDs cho reupload
        // GIỮ: cloned.ref_thumbnails — CDN URLs cho UI preview + reupload source

        // Reset results (thuộc project cũ) — đầy đủ để tránh hiển thị thumbnails ảo
        cloned.result_thumbnails = {};
        cloned.result_file_names = {};
        cloned.result_provider_urls = {};
        cloned.result_text = '';
        cloned.result_source = null;

        // Smart Clone frames: giữ metadata cho reupload, xóa tile_ids cho TẤT CẢ cases.
        // frame_X_source: '' (trống), 'manual', hoặc node_id (upstream node).
        // - manual case: tile_id session-specific từ project cũ → xóa, dùng file_name UUID + thumbnail CDN cho 5-tier correction
        // - upstream case: file_id sẽ được resolve runtime từ output upstream node mới → xóa tile cũ tránh leak project
        if (cloned.frame_1_file_id) cloned.frame_1_file_id = '';
        if (cloned.frame_2_file_id) cloned.frame_2_file_id = '';
        // GIỮ: frame_1_file_name, frame_1_thumbnail, frame_2_file_name, frame_2_thumbnail
        // frame_X_source pointing to upstream nodes sẽ được remap sau khi nodeIdMap hoàn chỉnh

        return cloned;
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
      const newEdges = edges.map(edge => ({
        ...edge,
        edge_id: window.IdGenerator ? window.IdGenerator.next('edge') : `edge_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        wf_id: newWfId,
        source_node_id: nodeIdMap[edge.source_node_id] || edge.source_node_id,
        target_node_id: nodeIdMap[edge.target_node_id] || edge.target_node_id
      }));

      const newWorkflow = {
        ...JSON.parse(JSON.stringify(workflow)),
        wf_id: newWfId,
        wf_name: (workflow.wf_name || 'Workflow') + ' ' + (window.I18n?.t('project.copySuffix') || '(copy)'),
        project_id: window._currentProjectId || null,
        status: 'idle',
        progress_completed: 0,
        progress_total: 0,
        current_node_id: null
      };
      delete newWorkflow.nodes;
      delete newWorkflow.edges;

      return { workflow: newWorkflow, nodes: newNodes, edges: newEdges };
    },

    /**
     * Render project filter toolbar HTML
     */
    async renderFilterToolbar(items, currentFilter, containerId) {
      const projects = await this.getProjectList();
      const projectIds = this.getUniqueProjectIds(items);

      // Count items per project
      const counts = {};
      for (const item of items) {
        const pid = item.project_id || '__legacy__';
        counts[pid] = (counts[pid] || 0) + 1;
      }

      const t = (key, params) => window.I18n ? window.I18n.t(key, params) : key;
      let pills = `<button class="project-filter-pill ${!currentFilter ? 'active' : ''}" data-project-filter="">${t('project.filterAll', { count: items.length })}</button>`;

      // Current project first
      if (window._currentProjectId && projectIds.includes(window._currentProjectId)) {
        const name = projects[window._currentProjectId]?.name || window._currentProjectName || t('project.current');
        const count = counts[window._currentProjectId] || 0;
        pills += `<button class="project-filter-pill ${currentFilter === window._currentProjectId ? 'active' : ''}" data-project-filter="${window._currentProjectId}">${this._escapeHtml(name)} (${count})</button>`;
      }

      // Other projects
      for (const pid of projectIds) {
        if (pid === window._currentProjectId) continue;
        const name = projects[pid]?.name || pid.substring(0, 8);
        const count = counts[pid] || 0;
        pills += `<button class="project-filter-pill ${currentFilter === pid ? 'active' : ''}" data-project-filter="${pid}">${this._escapeHtml(name)} (${count})</button>`;
      }

      // Legacy items
      if (counts['__legacy__']) {
        pills += `<button class="project-filter-pill ${currentFilter === '__legacy__' ? 'active' : ''}" data-project-filter="__legacy__">${t('project.shared')} (${counts['__legacy__']})</button>`;
      }

      return `<div class="project-filter-toolbar" id="${containerId}">${pills}</div>`;
    },

    /**
     * Render group header HTML
     */
    renderGroupHeader(projectName, count, isCurrent) {
      return `<div class="project-group-header ${isCurrent ? 'current' : ''}">
        <span class="project-group-name">${this._escapeHtml(projectName)}</span>
        <span class="project-group-count">${count}</span>
        ${isCurrent ? '<span class="project-group-badge">' + (window.I18n?.t('common.current') || 'hiện tại') + '</span>' : ''}
      </div>`;
    },

    /**
     * Render project label for card
     */
    renderProjectLabel(projectId, projectName, isCurrent) {
      if (!projectId && !projectName) return '';
      const name = projectName || projectId?.substring(0, 8) || '';
      return `<div class="item-project-label ${isCurrent ? 'current' : ''}">${this._escapeHtml(name)}</div>`;
    },

    _escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    }
  };

  window.ProjectHelper = ProjectHelper;
})();
