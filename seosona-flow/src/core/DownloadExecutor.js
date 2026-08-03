/**
 * DownloadExecutor — Tải xuống tuần tự các tiles đã hoàn thành
 * Serial vì context menu của Google Flow chỉ mở được 1 cái tại 1 thời điểm
 */
class DownloadExecutor {
  constructor() {
    this._queue = [];        // [{ tileId, fileName, resolution, jobId, promptText, flowFileId }]
    this._isRunning = false;
    this._shouldStop = false;
    this._completedCount = 0;
    this._currentFile = null;  // File đang tải (cho hiển thị)
    this._getJob = null;       // Function reference để lấy Job object
    this._downloadedTileIds = new Set(); // Deduplication: track tiles đã download
    this._inProgressTileIds = new Set(); // Deduplication: track tiles đang download (race condition fix)
    this._stoppedJobs = new Set();       // Track cancelled job IDs for in-flight abort
  }

  /**
   * Thiết lập function lấy Job (inject từ PromptQueue)
   */
  setJobGetter(fn) {
    this._getJob = fn;
  }

  /**
   * Thêm tiles vào hàng đợi tải xuống
   * @param {Array} tiles - Danh sách tiles cần tải
   */
  enqueue(tiles) {
    // Deduplication: filter out tiles đã download hoặc đang trong queue
    const existingInQueue = new Set(this._queue.map(t => t.tileId));
    const newTiles = tiles.filter(t => {
      if (this._downloadedTileIds.has(t.tileId)) {
        console.log('[DownloadExecutor] Skip tile đã download:', t.tileId.substring(0, 20));
        return false;
      }
      if (this._inProgressTileIds.has(t.tileId)) {
        console.log('[DownloadExecutor] Skip tile đang download:', t.tileId.substring(0, 20));
        return false;
      }
      if (existingInQueue.has(t.tileId)) {
        console.log('[DownloadExecutor] Skip tile đã trong queue:', t.tileId.substring(0, 20));
        return false;
      }
      return true;
    });

    if (newTiles.length > 0) {
      this._queue.push(...newTiles);
      if (!this._isRunning) {
        this._run();
      }
    }
  }

  /**
   * Vòng lặp tải xuống chính — xử lý từng tile một
   */
  async _run() {
    this._isRunning = true;
    this._shouldStop = false;

    while (this._queue.length > 0 && !this._shouldStop) {
      const tile = this._queue.shift();

      // Bỏ qua nếu job đã bị cancel
      if (this._stoppedJobs.has(tile.jobId)) continue;

      // Bỏ qua nếu job đã dừng
      if (this._getJob) {
        const job = this._getJob(tile.jobId);
        if (!job || job.state === 'stopped') continue;

        // Chờ nếu job bị tạm dừng (chỉ prompts hỗ trợ pause)
        while (job.state === 'paused' && !this._shouldStop) {
          await new Promise(r => setTimeout(r, 300));
        }
        // Kiểm tra lại sau khi resume (có thể đã stop trong lúc pause)
        if (this._shouldStop || job.state === 'stopped') continue;
      }

      // Heartbeat re-activate Flow tab TRƯỚC download — context menu DOM cần tab active, tab nền
      // throttle → download kẹt. Throttle 8s shared (MessageBridge) → no spam; background no-op
      // nếu đã active. Fire-and-forget.
      window.MessageBridge?.heartbeatActivateFlowTab?.();

      // Mark tile đang download (dedup race condition fix)
      this._inProgressTileIds.add(tile.tileId);

      try {
        this._currentFile = tile.promptText || tile.tileId;

        // Gọi MessageBridge để tải xuống qua context menu của Flow (timeout 30s)
        const downloadPromise = MessageBridge.sendToContentScript('downloadTileMedia', {
          tileId: tile.tileId,
          promptText: tile.promptText,
          taskName: tile.taskName || null,
          fileName: tile.fileName,
          flowFileId: tile.flowFileId || null,
          resolution: tile.resolution || null,
        });
        // Timeout 45s: _waitForTileMediaReady (10s) + right-click menu (5s) + download (30s buffer)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Download timeout')), 45000)
        );
        const resp = await Promise.race([downloadPromise, timeoutPromise]);

        // Chỉ mark downloaded nếu response thành công (không undefined, không error)
        if (!resp || resp?.error) {
          console.warn('[DownloadExecutor] Download failed:', tile.tileId, resp?.error || 'no response');
          // [FIX 2026-07-09] Re-enqueue có giới hạn (2 lần) — trước đây fail 1 lần là MẤT file luôn
          // (hiccup context-menu/tab-throttle thoáng qua). Đẩy về cuối queue để thử lại sau.
          this._requeueOnFail(tile);
        } else {
          this._downloadedTileIds.add(tile.tileId);
          this._completedCount++;
        }
        // Nghỉ ngắn giữa các lượt tải để tránh xung đột context menu
        await new Promise(r => setTimeout(r, 200));
      } catch (err) {
        console.error('[DownloadExecutor] Lỗi tải xuống:', err.message);
        this._requeueOnFail(tile);
      } finally {
        this._inProgressTileIds.delete(tile.tileId);
        this._currentFile = null;
      }
    }

    this._isRunning = false;
  }

  /**
   * Re-enqueue tile lỗi tối đa 2 lần (2026-07-09). Đẩy về CUỐI queue để thử lại sau các tile khác,
   * tránh mất file do hiccup thoáng qua. Bỏ qua nếu đã hết lượt hoặc job đã dừng.
   */
  _requeueOnFail(tile) {
    if (!tile || this._shouldStop) return;
    if (this._stoppedJobs?.has(tile.jobId)) return;
    tile._attempts = (tile._attempts || 0) + 1;
    if (tile._attempts > 2) {
      console.warn('[DownloadExecutor] Hết lượt retry, bỏ tile:', tile.tileId);
      return;
    }
    this._inProgressTileIds.delete(tile.tileId);
    this._queue.push(tile);
    console.log(`[DownloadExecutor] Re-enqueue tile ${tile.tileId} (lần ${tile._attempts}/2)`);
  }

  /**
   * Hủy tất cả downloads thuộc 1 job cụ thể
   */
  cancelJob(jobId) {
    this._queue = this._queue.filter(t => t.jobId !== jobId);
    this._stoppedJobs.add(jobId);  // Track stopped jobs for in-flight abort
  }

  /**
   * Dừng hoàn toàn executor
   */
  stop() {
    this._shouldStop = true;
    this._queue = [];
  }

  /**
   * Reset bộ đếm
   */
  reset() {
    this._completedCount = 0;
    this._currentFile = null;
    this._downloadedTileIds.clear(); // Clear deduplication set for new session
    this._inProgressTileIds.clear(); // Clear in-progress tracking
    this._stoppedJobs.clear();       // Clear stopped jobs tracking
  }

  // --- Getters cho UI ---

  get state() {
    if (!this._isRunning) return 'idle';
    return 'downloading';
  }

  get queueLength() {
    return this._queue.length;
  }

  get completedCount() {
    return this._completedCount;
  }

  get currentFile() {
    return this._currentFile;
  }
}
