/**
 * GenerationHistory - Tự động lưu lịch sử generation sau mỗi lần chạy prompt
 * Lưu qua API (nếu đã đăng nhập) hoặc chrome.storage.local (fallback)
 *
 * BATCHING: Records được buffer và flush định kỳ để tránh burst API calls
 * - Flush mỗi 10 giây hoặc khi buffer đạt 10 records
 * - Records gửi tuần tự với 100ms delay giữa mỗi request
 */
(function() {
  'use strict';

  const MAX_LOCAL_RECORDS = 200;
  const BATCH_FLUSH_INTERVAL = 10000;  // 10 seconds
  const BATCH_MAX_SIZE = 10;           // Max records before force flush
  const BATCH_REQUEST_DELAY = 100;     // 100ms delay between API calls

  class GenerationHistory {
    constructor() {
      this.isInitialized = false;
      this._buffer = [];          // Pending records to flush
      this._flushTimer = null;    // Timer for periodic flush
      this._flushing = false;     // Mutex to prevent concurrent flush
    }

    async init() {
      if (this.isInitialized) return;
      this.isInitialized = true;
      this._setupAutoSave();
      this._setupFlushOnUnload();
      console.log('[SEOSONA Flow] GenerationHistory đã sẵn sàng (batching enabled)');
    }

    // ─── Flush on page unload ─────────────────────────────────
    _setupFlushOnUnload() {
      window.addEventListener('beforeunload', () => {
        if (this._buffer.length > 0) {
          // Sync flush using sendBeacon (fire-and-forget)
          this._flushSync();
        }
      });
    }

    // ─── Auto-save hooks ──────────────────────────────────────

    _setupAutoSave() {
      if (!window.eventBus) return;

      // Task completion (Tab 2 Multi Task, Tab 3 Workflow)
      window.eventBus.on('task:status_changed', async (data) => {
        // Ghi cả completed LẪN failed (trước đây chỉ completed → task fail không lên admin).
        if (data.status === 'completed' || data.status === 'failed') {
          await this.saveFromTask(data);
        }
      });

      // Manual prompt completion (Tab 1)
      window.eventBus.on('prompt:completed', async (data) => {
        await this.saveRecord(data);
      });
    }

    // ─── Convert task data to history record ──────────────────

    async saveFromTask(taskData) {
      const record = {
        prompt: taskData.prompt || '',
        media_type: taskData.media_type || taskData.genType || 'image',
        model: taskData.model || '',
        ratio: taskData.ratio || taskData.aspectRatio || '',
        // Phase Analytics-3: prompt_count + quantity → admin phân biệt được
        // multi-prompt batch vs single multi-paragraph prompt
        prompt_count: taskData.prompt_count || null,
        quantity: taskData.quantity || null,
        ref_file_ids: taskData.ref_file_ids || taskData.fileIds || '',
        result_file_ids: taskData.result_file_ids || '',
        result_thumbnails: taskData.result_thumbnails || [],
        result_file_names: taskData.result_file_names || {},
        source: taskData.source || 'task',
        source_id: taskData.task_id || taskData.source_id || '',
        status: taskData.status === 'failed' ? 'failed' : 'success', // completed → 'success' (backend enum)
        error_reason: taskData.error_reason || taskData.error || null,
        // SS-Phase G: Provider tracking — fallback 'flow' khi task legacy chưa có provider field.
        provider: taskData.provider || 'flow',
        project_id: taskData.project_id || window._currentProjectId || null,
        auto_download: !!taskData.auto_download
      };
      await this.saveRecord(record);
    }

    // ─── Save a history record (buffered) ──────────────────────

    async saveRecord(record) {
      // Validate: prompt is required
      if (!record.prompt && !record.result_file_ids) return;

      // [FIX 2026-07-09] Local mode: LƯU THẲNG vào af_history (không buffer/không thử server).
      // Trước: auto-transform biến `if(!isLoggedIn)` → `if(!true)` → path local CHẾT → record đi
      // vòng buffer → ApiClient.request throw LOCAL_MODE → catch → _saveLocal (chạy được nhưng trễ,
      // phí, và có thể MẤT record chưa flush khi page unload vì _flushSync đã gate no-op local).
      if (self.SEOSONA_LOCAL_MODE !== false) {
        await this._saveLocal(record);
        return;
      }

      // Build payload
      const payload = {
        prompt: record.prompt || '',
        media_type: record.media_type || 'image',
        model: record.model || '',
        ratio: record.ratio || '',
        prompt_count: (record.prompt_count && record.prompt_count >= 1) ? record.prompt_count : null,
        quantity: (record.quantity && record.quantity >= 1) ? record.quantity : null,
        ref_file_ids: record.ref_file_ids || '',
        result_file_ids: record.result_file_ids || '',
        result_thumbnails: record.result_thumbnails || [],
        result_file_names: record.result_file_names || {},
        source: record.source || 'manual',
        // Submit mode (Flow Gen tab): 'auto' (mặc định) | 'manual' (user tự nhấn Enter). Phân biệt nguồn gen ở admin.
        submit_mode: record.submit_mode === 'manual' ? 'manual' : 'auto',
        source_id: record.source_id || '',
        // Track fail: 'success' | 'partial' | 'failed'. Mặc định success (extension emit success không set).
        status: record.status || 'success',
        error_reason: record.error_reason || null,
        provider: record.provider || 'flow',
        project_id: record.project_id || window._currentProjectId || null,
        auto_download: !!record.auto_download
      };

      // Add to buffer
      this._buffer.push(payload);
      console.log('[SEOSONA Flow] History record buffered, queue size:', this._buffer.length);

      // Start flush timer if not already running
      if (!this._flushTimer) {
        this._flushTimer = setTimeout(() => {
          this._flushTimer = null;
          this._flushBuffer();
        }, BATCH_FLUSH_INTERVAL);
      }

      // Force flush if buffer is full
      if (this._buffer.length >= BATCH_MAX_SIZE) {
        clearTimeout(this._flushTimer);
        this._flushTimer = null;
        this._flushBuffer();
      }
    }

    // ─── Flush buffer to server ───────────────────────────────

    async _flushBuffer() {
      if (this._flushing || this._buffer.length === 0) return;

      this._flushing = true;
      const toFlush = [...this._buffer];
      this._buffer = [];

      console.log('[SEOSONA Flow] Flushing', toFlush.length, 'history records');

      for (let i = 0; i < toFlush.length; i++) {
        const payload = toFlush[i];
        try {
          await ApiClient.request('POST', 'history', payload);
        } catch (e) {
          console.warn('[SEOSONA Flow] History flush failed, saving to local:', e.message);
          await this._saveLocal(payload);
        }

        // Delay between requests (except last one)
        if (i < toFlush.length - 1) {
          await new Promise(r => setTimeout(r, BATCH_REQUEST_DELAY));
        }
      }

      this._flushing = false;
      console.log('[SEOSONA Flow] History flush completed');
    }

    // ─── Sync flush on page unload (fire-and-forget) ──────────

    _flushSync() {
      if (this._buffer.length === 0) return;

      // Local/offline: đây là buffer đồng bộ history LÊN SERVER (sendBeacon). Không có server →
      // nhánh no-token chỉ ghi vào 'af_history_pending' mà KHÔNG ai đọc lại (data mồ côi, cap 50).
      // History hiển thị đã lưu độc lập ở 'af_history' (chrome.storage.local). Bỏ qua để không
      // tích data thừa + không gọi sendBeacon vô ích.
      if (self.SEOSONA_LOCAL_MODE !== false) { this._buffer = []; return; }

      const toFlush = [...this._buffer];
      this._buffer = [];

      // Use sendBeacon for reliable delivery on unload
      // Note: sendBeacon has 64KB limit, so we send one at a time
      const baseUrl = window.ApiBaseConfig.get();
      const token = window.authManager?.token;

      if (!token) {
        // Can't send to server, save to local storage synchronously
        toFlush.forEach(payload => {
          try {
            const result = JSON.parse(localStorage.getItem('af_history_pending') || '[]');
            result.push(payload);
            localStorage.setItem('af_history_pending', JSON.stringify(result.slice(-50)));
          } catch (_) { globalThis.SEOSONA_swallow?.('GenerationHistory#_flushSync', _); }
        });
        return;
      }

      toFlush.forEach(payload => {
        try {
          const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
          navigator.sendBeacon(
            `${baseUrl}/history?_token=${encodeURIComponent(token)}`,
            blob
          );
        } catch (_) { globalThis.SEOSONA_swallow?.('GenerationHistory#_flushSync', _); }
      });
    }

    // ─── Query history ────────────────────────────────────────

    async getHistory(page = 1, perPage = 20, isFavorite = null) {
      // Local mode: use local storage directly, skip server + "Tải lịch sử thất bại" warn.
      if ((self.SEOSONA_LOCAL_MODE !== false) || !true) {
        return this._getLocal(page, perPage, isFavorite);
      }

      try {
        let endpoint = `history?page=${page}&per_page=${perPage}`;
        if (isFavorite !== null) {
          endpoint += `&is_favorite=${isFavorite ? 1 : 0}`;
        }
        // [Show all] Bỏ filter project_id — UI hiển thị toàn bộ lịch sử cross-project
        const response = await ApiClient.request('GET', endpoint);
        return {
          data: Array.isArray(response?.data) ? response.data : [],
          meta: response.meta || { current_page: page, total: 0, per_page: perPage }
        };
      } catch (e) {
        console.warn('[SEOSONA Flow] Tải lịch sử thất bại:', e.message);
        return this._getLocal(page, perPage, isFavorite);
      }
    }

    // ─── Toggle favorite ──────────────────────────────────────

    async toggleFavorite(id) {
      // Local record
      if (String(id).startsWith('local_')) {
        return this._toggleLocalFavorite(id);
      }

      if (!true) {
        return this._toggleLocalFavorite(id);
      }

      try {
        const response = await ApiClient.request('PATCH', `history/${id}/favorite`);
        return response;
      } catch (e) {
        console.warn('[SEOSONA Flow] Toggle favorite thất bại:', e.message);
        return null;
      }
    }

    // ─── Delete record ────────────────────────────────────────

    async deleteRecord(id) {
      // Local record
      if (String(id).startsWith('local_')) {
        return this._deleteLocal(id);
      }

      if (!true) {
        return this._deleteLocal(id);
      }

      try {
        await ApiClient.request('DELETE', `history/${id}`);
        return true;
      } catch (e) {
        console.warn('[SEOSONA Flow] Xóa lịch sử thất bại:', e.message);
        return false;
      }
    }

    // ─── Local storage fallback ───────────────────────────────

    async _saveLocal(record) {
      try {
        const result = await new Promise(r => chrome.storage.local.get(['af_history'], r));
        const history = result.af_history || [];
        // Suffix random tránh trùng id khi multi-prompt/batch lưu cùng millisecond — trước đây
        // `local_${Date.now()}` trùng → xóa 1 record xóa nhầm cả cụm cùng timestamp.
        record.id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        record.created_at = new Date().toISOString();
        record.is_favorite = false;
        if (!record.project_id) record.project_id = window._currentProjectId || null;
        history.unshift(record);
        if (history.length > MAX_LOCAL_RECORDS) history.length = MAX_LOCAL_RECORDS;
        await new Promise(r => chrome.storage.local.set({ af_history: history }, r));
      } catch (e) {
        console.error('[SEOSONA Flow] Lưu local thất bại:', e.message);
      }
    }

    async _getLocal(page, perPage, isFavorite = null) {
      try {
        const result = await new Promise(r => chrome.storage.local.get(['af_history'], r));
        let history = result.af_history || [];

        // [Show all] Bỏ filter project_id — UI hiển thị toàn bộ lịch sử cross-project

        if (isFavorite !== null) {
          history = history.filter(h => !!h.is_favorite === isFavorite);
        }

        const start = (page - 1) * perPage;
        return {
          data: history.slice(start, start + perPage),
          meta: {
            current_page: page,
            total: history.length,
            per_page: perPage,
            last_page: Math.ceil(history.length / perPage) || 1
          }
        };
      } catch (e) {
        console.error('[SEOSONA Flow] Đọc local thất bại:', e.message);
        return { data: [], meta: { current_page: 1, total: 0, per_page: perPage, last_page: 1 } };
      }
    }

    async _toggleLocalFavorite(id) {
      try {
        const result = await new Promise(r => chrome.storage.local.get(['af_history'], r));
        const history = result.af_history || [];
        const record = history.find(h => h.id === id);
        if (record) {
          record.is_favorite = !record.is_favorite;
          await new Promise(r => chrome.storage.local.set({ af_history: history }, r));
          return { is_favorite: record.is_favorite };
        }
        return null;
      } catch (e) {
        console.error('[SEOSONA Flow] Toggle local favorite thất bại:', e.message);
        return null;
      }
    }

    async _deleteLocal(id) {
      try {
        const result = await new Promise(r => chrome.storage.local.get(['af_history'], r));
        let history = result.af_history || [];
        history = history.filter(h => h.id !== id);
        await new Promise(r => chrome.storage.local.set({ af_history: history }, r));
        return true;
      } catch (e) {
        console.error('[SEOSONA Flow] Xóa local thất bại:', e.message);
        return false;
      }
    }
  }

  window.generationHistory = new GenerationHistory();
  window.GenerationHistory = GenerationHistory;
})();
