/**
 * BatchQueue - Queue system cho batch tasks auto-run tuần tự
 * Xếp hàng prompts, tasks, workflows và chạy lần lượt
 */

(function() {
  'use strict';

  class BatchQueue {
    constructor() {
      this.queue = [];
      this.isRunning = false;
      this.isPaused = false;
      this.currentIndex = -1;
      this._completedCount = 0;
      // M8 fix: guard chống double-run item đang chạy (resume() re-execute item hiện tại).
      this._executing = false;
      // Auto-retry (B8): tự thử lại item lỗi với backoff. Tắt mặc định (opt-in).
      this.autoRetry = false;
      // Lấy trần retry + độ giãn từ api_rate_limits (config đã có sẵn nhưng trước đây
      // KHÔNG ai đọc). Hằng số cũ 2 lần / 3s gấp gáp hơn nhiều so với 5 lần / 10s mà
      // chính config khai — và chạy gấp là đường ngắn nhất tới UNUSUAL_ACTIVITY.
      const _lim = window.ProviderConfigManager?.getRateLimitsSync?.('flow') || {};
      this.autoRetryMax = _lim.maxRetries || 5;
      this.autoRetryDelay = _lim.baseBackoffMs || 10000;
      this._rateLimits = _lim;
      this._bindFlowErrorClassifier();
      this._loadAutoRetryConfig();
      // Scheduled start (B8): timer id + thời điểm hẹn.
      this._scheduleTimer = null;
      this._scheduledAt = null;
    }

    /**
     * TileMonitor phân loại lỗi Flow rồi phát `flow:error_classified` trên eventBus —
     * category KHÔNG đi kèm Error object ném lên đây. Nên ghi lại lần phân loại gần
     * nhất và dùng nó khi item hỏng.
     *
     * CONSUME-ONCE + hạn 90s: cùng cách content.js xử `_lastFlowGenError`. Nếu giữ mãi
     * thì một lần captcha ở item #3 sẽ làm item #7 (hỏng vì lý do khác) bị gắn nhầm là
     * captcha rồi tạm dừng oan cả hàng đợi.
     */
    _bindFlowErrorClassifier() {
      if (this._flowErrBound) return;
      this._flowErrBound = true;
      this._lastFlowErr = null;
      window.eventBus?.on?.('flow:error_classified', (d) => {
        if (d?.category) this._lastFlowErr = { category: d.category, ts: Date.now() };
      });
    }

    _recentFlowCategory() {
      const e = this._lastFlowErr;
      if (!e) return null;
      if (Date.now() - e.ts > 90000) { this._lastFlowErr = null; return null; }
      this._lastFlowErr = null; // consume-once
      return e.category;
    }

    // Đọc cấu hình auto-retry từ af_settings (persist qua Settings). Best-effort.
    async _loadAutoRetryConfig() {
      try {
        const res = await new Promise(r => chrome.storage.local.get(['af_settings'], r));
        const s = res?.af_settings || {};
        if (typeof s.queueAutoRetry === 'boolean') this.autoRetry = s.queueAutoRetry;
        if (Number.isFinite(s.queueAutoRetryMax)) this.autoRetryMax = s.queueAutoRetryMax;
      } catch (_) { globalThis.SEOSONA_swallow?.('BatchQueue#_loadAutoRetryConfig', _); }
    }

    setAutoRetry(enabled, max) {
      this.autoRetry = !!enabled;
      if (Number.isFinite(max)) this.autoRetryMax = Math.max(0, Math.min(5, max));
      try {
        chrome.storage.local.get(['af_settings'], (res) => {
          const s = res?.af_settings || {};
          s.queueAutoRetry = this.autoRetry;
          s.queueAutoRetryMax = this.autoRetryMax;
          chrome.storage.local.set({ af_settings: s });
        });
      } catch (_) { globalThis.SEOSONA_swallow?.('BatchQueue#setAutoRetry', _); }
      window.eventBus?.emit('queue:changed', { queue: this.queue });
    }

    /**
     * Hẹn giờ chạy queue (B8). delayMs = số ms tới khi start. Hủy hẹn cũ nếu có.
     * Lưu ý: chạy trong context sidebar (batch cần DOM automation) → sidebar phải MỞ tới lúc chạy.
     * Trả thời điểm sẽ chạy (epoch ms) hoặc null nếu hủy.
     */
    scheduleStart(delayMs) {
      this.cancelSchedule();
      if (!delayMs || delayMs <= 0) return null;
      this._scheduledAt = Date.now() + delayMs;
      this._scheduleTimer = setTimeout(() => {
        this._scheduleTimer = null;
        this._scheduledAt = null;
        window.eventBus?.emit('queue:schedule-fired', {});
        if (this.queue.some(i => i.status === 'pending')) this.start();
      }, delayMs);
      window.eventBus?.emit('queue:scheduled', { at: this._scheduledAt });
      return this._scheduledAt;
    }

    cancelSchedule() {
      if (this._scheduleTimer) { clearTimeout(this._scheduleTimer); this._scheduleTimer = null; }
      const had = this._scheduledAt != null;
      this._scheduledAt = null;
      if (had) window.eventBus?.emit('queue:scheduled', { at: null });
    }

    getScheduledAt() { return this._scheduledAt; }

    /**
     * Thêm item vào queue
     * @param {Object} item - { type: 'prompt'|'task'|'workflow', data: any, priority: number, name: string }
     */
    add(item) {
      const queueItem = {
        id: Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        type: item.type || 'prompt',
        data: item.data,
        priority: item.priority || 0,
        name: item.name || this._getDefaultName(item),
        status: 'pending', // pending | running | completed | failed
        addedAt: Date.now(),
      };

      this.queue.push(queueItem);

      // M8 fix: re-sort toàn bộ khi đang chạy làm lệch currentIndex → item đã chạy có thể bị
      // đẩy về sau currentIndex và chạy lại, hoặc item đang chạy bị dịch chỗ. Khi đang chạy, chỉ
      // sort phần SAU item hiện tại (đã/đang xử lý giữ nguyên vị trí); track item đang chạy theo id.
      if (this.isRunning && this.currentIndex >= 0 && this.currentIndex < this.queue.length) {
        const runningId = this.queue[this.currentIndex]?.id;
        const head = this.queue.slice(0, this.currentIndex + 1); // đã xử lý + đang chạy: bất biến
        const tail = this.queue.slice(this.currentIndex + 1);
        tail.sort((a, b) => b.priority - a.priority);
        this.queue = head.concat(tail);
        // Re-sync currentIndex theo id (phòng trường hợp head thay đổi kích thước bất ngờ)
        if (runningId) {
          const idx = this.queue.findIndex(it => it.id === runningId);
          if (idx !== -1) this.currentIndex = idx;
        }
      } else {
        // Sort by priority (higher first)
        this.queue.sort((a, b) => b.priority - a.priority);
      }

      window.eventBus.emit('queue:changed', { queue: this.queue });
      console.log('[SEOSONA Flow] Queue: added item', queueItem.name);
      return queueItem;
    }

    /**
     * Xóa item khỏi queue theo index
     */
    remove(index) {
      if (index < 0 || index >= this.queue.length) return;

      // Không cho xóa item đang chạy
      if (this.isRunning && index === this.currentIndex) {
        console.log('[SEOSONA Flow] Queue: cannot remove running item');
        return;
      }

      const removed = this.queue.splice(index, 1)[0];

      // Adjust currentIndex if needed
      if (this.isRunning && index < this.currentIndex) {
        this.currentIndex--;
      }

      window.eventBus.emit('queue:changed', { queue: this.queue });
      console.log('[SEOSONA Flow] Queue: removed item', removed.name);
    }

    /**
     * Di chuyển item trong queue
     */
    reorder(fromIndex, toIndex) {
      if (fromIndex < 0 || fromIndex >= this.queue.length) return;
      if (toIndex < 0 || toIndex >= this.queue.length) return;
      if (fromIndex === toIndex) return;

      // [FIX 2026-07-09] Nếu đang chạy, chốt id item đang chạy TRƯỚC khi splice để re-sync currentIndex
      // sau (tránh skip/double-run item khi user kéo ngang qua con trỏ đang chạy).
      const runningId = (this.isRunning && this.currentIndex >= 0 && this.currentIndex < this.queue.length)
        ? this.queue[this.currentIndex]?.id : null;

      const item = this.queue.splice(fromIndex, 1)[0];
      this.queue.splice(toIndex, 0, item);

      if (runningId) {
        const idx = this.queue.findIndex(it => it.id === runningId);
        if (idx !== -1) this.currentIndex = idx;
      }
      window.eventBus.emit('queue:changed', { queue: this.queue });
    }

    /**
     * Bắt đầu chạy queue tuần tự
     */
    async start() {
      if (this.isRunning) {
        console.log('[SEOSONA Flow] Queue: already running');
        return;
      }
      if (this.queue.length === 0) {
        console.log('[SEOSONA Flow] Queue: empty, nothing to run');
        return;
      }

      this.isRunning = true;
      this.isPaused = false;
      this.currentIndex = 0;
      this._completedCount = 0;

      window.eventBus.emit('queue:started', {
        total: this.queue.length,
      });
      console.log('[SEOSONA Flow] Queue: started, total items:', this.queue.length);

      await this._runNext();
    }

    /**
     * Tạm dừng (chờ item hiện tại xong rồi dừng)
     */
    pause() {
      if (!this.isRunning || this.isPaused) return;
      this.isPaused = true;
      window.eventBus.emit('queue:paused', {
        currentIndex: this.currentIndex,
        total: this.queue.length,
      });
      console.log('[SEOSONA Flow] Queue: paused');
    }

    /**
     * Tiếp tục sau khi pause
     */
    async resume() {
      if (!this.isRunning || !this.isPaused) return;
      this.isPaused = false;
      window.eventBus.emit('queue:resumed', {
        currentIndex: this.currentIndex,
        total: this.queue.length,
      });
      console.log('[SEOSONA Flow] Queue: resumed');
      await this._runNext();
    }

    /**
     * Dừng hoàn toàn và clear queue
     */
    stop() {
      this.isRunning = false;
      this.isPaused = false;
      this.currentIndex = -1;

      // Reset all pending items
      this.queue.forEach(item => {
        if (item.status === 'pending' || item.status === 'running') {
          item.status = 'pending';
        }
      });

      window.eventBus.emit('queue:stopped', {});
      window.eventBus.emit('queue:changed', { queue: this.queue });
      console.log('[SEOSONA Flow] Queue: stopped');
    }

    /**
     * Retry 1 item đã 'failed' (2026-07-09). Reset về 'pending' + clear error rồi chạy lại từ đầu
     * (guard skip-completed trong _runNext đảm bảo chỉ item pending được chạy). No-op nếu item
     * không tồn tại / không phải 'failed'.
     */
    retryItem(index) {
      const item = this.queue[index];
      if (!item || item.status !== 'failed') return false;
      item.status = 'pending';
      delete item.error;
      window.eventBus.emit('queue:changed', { queue: this.queue });
      this._resumePending();
      return true;
    }

    /**
     * Retry TẤT CẢ item đang 'failed'. Reset hết về 'pending' rồi chạy lại.
     * Trả số item được đưa lại hàng đợi.
     */
    retryFailed() {
      const failed = this.queue.filter(i => i.status === 'failed');
      if (!failed.length) return 0;
      failed.forEach(i => { i.status = 'pending'; delete i.error; });
      window.eventBus.emit('queue:changed', { queue: this.queue });
      this._resumePending();
      return failed.length;
    }

    /**
     * Bơm lại loop chạy các item 'pending' còn lại mà KHÔNG reset completed count / không gen lại
     * completed (nhờ guard trong _runNext). Dùng chung cho retryItem/retryFailed.
     */
    _resumePending() {
      if (this.isRunning) return; // đang chạy → item pending sẽ được _runNext nhặt tự nhiên
      if (!this.queue.some(i => i.status === 'pending')) return;
      // Giữ đúng số đã hoàn thành để progress bar không nhảy lùi.
      this._completedCount = this.queue.filter(i => i.status === 'completed').length;
      this.isRunning = true;
      this.isPaused = false;
      this.currentIndex = 0;
      window.eventBus.emit('queue:started', { total: this.queue.length });
      this._runNext();
    }

    /**
     * Số item đang failed (cho UI hiện nút "Retry tất cả").
     */
    getFailedCount() {
      return this.queue.filter(i => i.status === 'failed').length;
    }

    /**
     * Xóa toàn bộ queue
     */
    clear() {
      this.stop();
      this.queue = [];
      this._completedCount = 0;
      window.eventBus.emit('queue:changed', { queue: this.queue });
      console.log('[SEOSONA Flow] Queue: cleared');
    }

    /**
     * Chạy item tiếp theo trong queue
     */
    async _runNext() {
      if (!this.isRunning || this.isPaused) return;
      // M8 fix: nếu 1 item đang execute (vd resume() gọi trong khi item hiện tại chưa xong await),
      // KHÔNG khởi động execute lần 2 cho cùng item → chống double-run. _runNext sẽ được gọi lại
      // tự nhiên khi item hiện tại hoàn thành (cuối vòng lặp bên dưới).
      if (this._executing) return;
      if (this.currentIndex >= this.queue.length) {
        // [FIX 2026-07-09] Trước khi kết thúc: nếu còn item 'pending' (vd user retryItem/retryFailed
        // GIỮA lúc chạy, item đó nằm SAU con trỏ hiện tại), quay lại chạy tiếp thay vì kết thúc.
        // Guard skip-completed đảm bảo item đã xong không bị gen lại.
        const firstPending = this.queue.findIndex(i => i.status === 'pending');
        if (firstPending !== -1) {
          this.currentIndex = firstPending;
          return this._runNext();
        }
        // Hoàn thành toàn bộ queue
        this.isRunning = false;
        this.currentIndex = -1;
        window.eventBus.emit('queue:complete', {
          completed: this._completedCount,
          total: this.queue.length,
        });
        console.log('[SEOSONA Flow] Queue: all items completed');
        return;
      }

      const item = this.queue[this.currentIndex];
      // Retry path: item đã 'completed' → bỏ qua, KHÔNG chạy lại (retryFailed reset failed→pending
      // rồi chạy từ index 0; guard này đảm bảo completed không bị gen lại + không double-count).
      if (item.status === 'completed') {
        this.currentIndex++;
        return this._runNext();
      }
      item.status = 'running';
      window.eventBus.emit('queue:item-start', {
        item,
        index: this.currentIndex,
        total: this.queue.length,
      });
      window.eventBus.emit('queue:changed', { queue: this.queue });

      this._executing = true;
      let autoRetrying = false;
      try {
        await this._executeItem(item);
        item.status = 'completed';
        item._retryCount = item._retryCount || 0;
        this._completedCount++;
      } catch (err) {
        item.status = 'failed';
        item.error = err.message;
        console.error('[SEOSONA Flow] Queue: item failed', item.name, err);
        // Phân loại theo LOẠI LỖI trước khi quyết định. Trước đây mọi lỗi đều đi chung
        // một nhánh retry → rớt mạng thì đốt oan ngân sách, còn bị Google gắn cờ thì
        // càng thử càng nặng. Xem FAILURE_CLASS trong RetryPolicy.
        const RP = window.SEOSONA_RetryPolicy;
        const verdict = RP?.classifyFailure
          ? RP.classifyFailure(err?.category || err?.reason || err?.code || this._recentFlowCategory())
          : { action: 'retry', counts: true };
        item.errorCategory = verdict.category;

        if (verdict.action === 'halt') {
          // Google gắn cờ phiên. TẠM DỪNG chứ không stop(): giữ nguyên vị trí để người
          // dùng giải captcha trong tab Flow rồi bấm tiếp, khỏi mất các item còn lại.
          console.warn('[SEOSONA Flow] Queue: TẠM DỪNG — phiên bị gắn cờ (' + verdict.category + ')');
          this.pause();
          window.eventBus.emit('queue:halted', { item, reason: verdict.category, message: err?.message || '' });
        } else if (verdict.action !== 'terminal'
                   && this.autoRetry && this.isRunning
                   // 'requeue' KHÔNG tiêu ngân sách retry — chỉ 'retry' mới bị chặn bởi trần.
                   && (!verdict.counts || (item._retryCount || 0) < (this.autoRetryMax || 0))) {
          if (verdict.counts) item._retryCount = (item._retryCount || 0) + 1;
          item._requeueCount = (item._requeueCount || 0) + 1;
          // Chặn vòng lặp vô tận khi lỗi 'requeue' cứ lặp mãi (ref hỏng thật, tab chết).
          if (!verdict.counts && item._requeueCount > 10) {
            console.warn('[SEOSONA Flow] Queue: bỏ cuộc sau 10 lần xếp lại —', item.name);
          } else {
            const attempt = verdict.counts ? item._retryCount : 1;
            const wait = RP?.backoffFromLimits
              ? RP.backoffFromLimits(attempt, this._rateLimits)
              : (this.autoRetryDelay || 10000);
            console.warn(`[SEOSONA Flow] Queue: ${verdict.action} ${item.name} (${verdict.category}, lần ${attempt}) sau ${Math.round(wait / 1000)}s`);
            item.status = 'pending';
            item.error = null;
            autoRetrying = true;
            window.eventBus.emit('queue:changed', { queue: this.queue });
            window.eventBus.emit('queue:item-retry', { item, index: this.currentIndex, attempt, max: this.autoRetryMax, category: verdict.category, action: verdict.action });
            await new Promise(r => setTimeout(r, wait));
          }
        }
      } finally {
        this._executing = false;
      }

      // Auto-retry: chạy lại CÙNG index (không advance) nếu vẫn đang chạy.
      if (autoRetrying && this.isRunning && !this.isPaused) {
        return this._runNext();
      }

      window.eventBus.emit('queue:item-complete', {
        item,
        index: this.currentIndex,
        total: this.queue.length,
        completed: this._completedCount,
      });
      window.eventBus.emit('queue:changed', { queue: this.queue });

      this.currentIndex++;
      await this._runNext();
    }

    /**
     * Thực thi 1 item dựa trên type
     */
    async _executeItem(item) {
      switch (item.type) {
        case 'prompt':
          return await this._runPrompt(item.data);
        case 'task':
          return await this._runTask(item.data);
        case 'workflow':
          return await this._runWorkflow(item.data);
        default:
          throw new Error('Unknown queue item type: ' + item.type);
      }
    }

    /**
     * Chạy prompt qua runAutoPrompt
     */
    async _runPrompt(data) {
      if (typeof window.runAutoPrompt !== 'function') {
        throw new Error('runAutoPrompt is not available');
      }
      // Phase 2c+: Server-Only — delayBetweenPrompts từ ExecutionConfig, KHÔNG fallback af_settings.
      // inputTimeout vẫn là user setting hợp lệ (không nằm trong 16 deprecated keys).
      const settings = window.storageSettings?.getSettings?.() || {};
      const delayBetweenSec = window.ExecutionConfig?.safeGetDelayBetweenPromptsSec?.() ?? 5;
      const payload = {
        ...data,
        delayBetweenMs: data.delayBetweenMs ?? delayBetweenSec * 1000,
        inputTimeoutMs: data.inputTimeoutMs ?? (settings.inputTimeout || 1200),
      };
      await window.runAutoPrompt(payload);
    }

    /**
     * Chạy task execution
     */
    async _runTask(data) {
      // Task data chứa taskId hoặc full task object
      if (typeof window.runAutoPrompt !== 'function') {
        throw new Error('runAutoPrompt is not available');
      }

      // Phase 2c+: Server-Only — delayBetweenPrompts từ ExecutionConfig, KHÔNG fallback af_settings.
      // inputTimeout vẫn là user setting hợp lệ (không nằm trong 16 deprecated keys).
      const settings = window.storageSettings?.getSettings?.() || {};
      const delayBetweenSec = window.ExecutionConfig?.safeGetDelayBetweenPromptsSec?.() ?? 5;
      const payload = {
        prompts: data.prompts || [data.prompt || data.content],
        genType: data.media_type || data.genType || 'Image',
        aspectRatio: data.ratio || data.aspectRatio || '',
        modelName: data.model || data.modelName || '',
        delayBetweenMs: delayBetweenSec * 1000,
        inputTimeoutMs: settings.inputTimeout || 1200,
      };

      await window.runAutoPrompt(payload);
    }

    /**
     * Chạy workflow qua WorkflowExecutor
     */
    async _runWorkflow(data) {
      if (!window.workflowExecutor) {
        throw new Error('WorkflowExecutor is not available');
      }
      const workflowId = data.wf_id || data.id || data;
      await window.workflowExecutor.execute(workflowId);
    }

    /**
     * Lấy tên mặc định cho item
     */
    _getDefaultName(item) {
      switch (item.type) {
        case 'prompt':
          if (item.data && item.data.prompts && item.data.prompts[0]) {
            return item.data.prompts[0].substring(0, 40) + '...';
          }
          return 'Prompt';
        case 'task':
          return (item.data && item.data.name) || 'Task';
        case 'workflow':
          return (item.data && item.data.wf_name) || 'Workflow';
        default:
          return 'Item';
      }
    }

    /**
     * Lấy trạng thái queue
     */
    getStatus() {
      return {
        total: this.queue.length,
        completed: this._completedCount,
        isRunning: this.isRunning,
        isPaused: this.isPaused,
        currentIndex: this.currentIndex,
        queue: this.queue,
      };
    }
  }

  // Singleton
  window.batchQueue = new BatchQueue();
})();
