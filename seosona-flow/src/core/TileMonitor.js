/**
 * TileMonitor — Theo dõi đồng thời nhiều tiles sau khi submit
 * Nhận QueueItems ở trạng thái SUBMITTED từ EditorExecutor
 * Monitor concurrent, giới hạn bởi maxConcurrent setting
 */
class TileMonitor {
  constructor() {
    this._activeMonitors = new Map(); // itemId -> { promise, item, abortController }
    this._maxConcurrent = 8;
    // Phase L: Centralized timeout from SystemConfig
    // Phase 3 fix: Use safeGetTimeout to avoid ConfigRequiredError during init
    this._timeout = window.SystemConfig?.safeGetTimeout?.('image_timeout_ms') || 300000;
    this._maxRetries = 2;
    this._queue = null;               // Reference đến PromptQueue
    this._onItemCompleted = null;     // Callback khi item hoàn thành
    this._onTilesReady = null;        // Callback khi tiles sẵn sàng tải xuống
    this._claimedTileIds = new Map(); // Map<tileId, { jobId, itemId, claimedAt }> — per-job tracking
    this._completedCount = 0;
    this._failedCount = 0;
    // 2026-06-04: Stagnation tracker. _lastClaimAt = timestamp lần cuối BẤT KỲ item nào claim
    // được tile. Dùng để detect Flow rate-limit sớm: nếu activeCount > 0 nhưng không claim mới
    // suốt N giây → Flow stuck → trigger reload sớm (không đợi MAX_TIMEOUT 5min).
    this._lastClaimAt = 0;
  }

  /**
   * Thiết lập dependencies (inject từ PromptQueue)
   */
  setup({ queue, onItemCompleted, onTilesReady }) {
    this._queue = queue;
    this._onItemCompleted = onItemCompleted;
    this._onTilesReady = onTilesReady;
  }

  /**
   * Emit per-item status cho QueueMonitor render badge realtime.
   * Phase enum: 'monitoring' | 'fail_detected' | 'click_retry' | 'wait_retry'
   *           | 'tier2_reload' | 'tier2_wait' | 'tier2_resubmit' | 'completed' | 'failed' | 'partial_fail'
   */
  _emitItemStatus(item, phase, extra = {}) {
    if (!item || !window.eventBus) return;
    window.eventBus.emit('item:status', {
      itemId: item.id,
      jobId: item.jobId,
      phase,
      attempt: extra.attempt || 0,
      maxRetries: this._maxRetries,
      successCount: extra.successCount || (item.resultTileIds?.length || 0),
      failedCount: extra.failedCount || 0,
      text: extra.text || '',
      timestamp: Date.now(),
    });
  }

  /**
   * Cập nhật settings
   */
  updateSettings({ maxMonitor, timeout, maxRetries }) {
    if (maxMonitor !== undefined) this._maxConcurrent = maxMonitor;
    if (timeout !== undefined) this._timeout = timeout * 1000;
    if (maxRetries !== undefined) this._maxRetries = maxRetries;
  }

  /**
   * Bắt đầu theo dõi 1 item đã submit
   * Tự động chờ slot nếu đã đạt giới hạn đồng thời
   */
  async monitor(item) {
    // Chờ slot nếu đã đầy (timeout 200s để tránh deadlock)
    const slotTimeout = this._timeout + 20000; // timeout + 20s buffer
    while (this._activeMonitors.size >= this._maxConcurrent) {
      const monitors = Array.from(this._activeMonitors.values()).map(m => m.promise);
      if (monitors.length === 0) break; // Safety: không có promise nào để chờ
      await Promise.race([
        ...monitors,
        new Promise(r => setTimeout(r, slotTimeout)),
      ]);
    }

    item.state = QueueItem.STATE.MONITORING;
    // Cold-start stagnation: nếu pipeline vừa empty → có monitor mới, reset _lastClaimAt để tránh
    // false-positive stagnant từ batch trước. Watchdog đếm từ thời điểm này.
    if (this._activeMonitors.size === 0) {
      this._lastClaimAt = Date.now();
    }
    const abortController = new AbortController();
    const promise = this._monitorItem(item, abortController.signal);
    this._activeMonitors.set(item.id, { promise, item, abortController });

    promise.finally(() => {
      this._activeMonitors.delete(item.id);
    });
  }

  /**
   * Theo dõi 1 item — chờ tiles hoàn thành hoặc thất bại
   * @param {AbortSignal} [abortSignal] - Signal để abort sớm khi job bị stop
   */
  async _monitorItem(item, abortSignal) {
    const job = this._queue?.getJob(item.jobId);

    // Kiểm tra job còn hoạt động không
    if (!job || job.state === 'stopped') {
      item.state = QueueItem.STATE.CANCELLED;
      return;
    }

    try {
      this._emitItemStatus(item, 'monitoring');

      // Gọi MessageBridge để chờ tiles mới xuất hiện (có abort signal)
      const result = await this._waitForTiles(item, abortSignal);

      // Kiểm tra lại trạng thái job (có thể đã dừng trong lúc chờ)
      if (item.state === QueueItem.STATE.CANCELLED || job.state === 'stopped') {
        return;
      }

      const expectedQuantity = parseInt(item.settings?.quantity) || 1;
      const earlyClaimedSet = new Set(item._earlyClaimedTiles || []);

      // === MRC-3.4.4: Xử lý kết quả từ _waitForTiles ===
      // _waitForTiles() đã dùng _waitClaimedTilesComplete, trả về successTids/failedTids trực tiếp
      // khi có early claimed tiles. Fallback result cũ vẫn cần xử lý.

      let successTids = result?.successTids || [];
      let failedTids = result?.failedTids || [];

      // Nếu _waitForTiles đã phân loại (có successTids/failedTids) → dùng trực tiếp
      // Nếu không (fallback path) → phải tự phân loại
      if (successTids.length === 0 && failedTids.length === 0 && result?.tiles?.length > 0) {
        // FALLBACK: result từ waitForNewTiles (flow cũ), cần claim và phân loại

        if (earlyClaimedSet.size > 0) {
          // Ưu tiên tiles đã early claimed
          // 2026-06-04 Phase 1 fix extension: strict per-item ownership thay vì same-job.
          // Bug pre-fix: item B trong batch B nhìn thấy tile A đã claim → filter same-job
          // → KEEP → claim chồng → silent dup (xem [[Bug 59]] log "48 prompts → 39 ảnh").
          result.tiles = result.tiles.filter(tid => {
            if (earlyClaimedSet.has(tid)) return true;
            const claimed = this._claimedTileIds.get(tid);
            return !claimed || claimed.itemId === item.id;
          });

          if (result.tiles.length > expectedQuantity) {
            result.tiles.sort((a, b) => {
              const aEarly = earlyClaimedSet.has(a) ? 0 : 1;
              const bEarly = earlyClaimedSet.has(b) ? 0 : 1;
              return aEarly - bEarly;
            });
            result.tiles = result.tiles.slice(0, expectedQuantity);
          }

          console.log(`[TileMonitor] Using ${earlyClaimedSet.size} early claimed tile(s) for item ${item.id.substring(0, 8)}`);
        } else {
          // Không có early claim → dùng submitOrder-based
          const waitStart = Date.now();
          while (Date.now() - waitStart < 5000) {
            const hasEarlier = [...this._activeMonitors.values()].some(
              m => m.item._submitOrder && item._submitOrder &&
                   m.item._submitOrder < item._submitOrder &&
                   m.item !== item &&
                   (m.item.state === 'MONITORING' || m.item.state === 'SUBMITTED')
            );
            if (!hasEarlier) break;
            await this._sleep(300);
          }

          // SEOSONA tile ownership: chặn-TRÊN bằng tile item tự chốt (positive-ID) TRƯỚC filter
          // per-item bên dưới. Nếu _ownTileIds null → no-op → giữ nguyên logic cũ.
          result.tiles = TileMonitor._filterToOwnTiles(result.tiles, item._ownTileIds);

          // 2026-06-04 Phase 1 fix extension: strict per-item ownership (xem comment line 130).
          result.tiles = result.tiles.filter(tid => {
            const claimed = this._claimedTileIds.get(tid);
            return !claimed || claimed.itemId === item.id;
          });

          if (result.tiles.length > expectedQuantity) {
            // [Bug fix 2026-05-10 Gap 6] slice(0, N) thay slice(-N) — same pattern Phase 3 fix.
            //   waitForNewTiles return tiles theo DOM order. Flow render newest tile ở TOP DOM
            //   (verified Phase 3 evidence — position top-left). slice(-N) lấy oldest = sai.
            //   slice(0, N) lấy newest = tile mới gen của user vừa submit.
            result.tiles = result.tiles.slice(0, expectedQuantity);
          }

          for (const tid of result.tiles) {
            this._claimedTileIds.set(tid, {
              jobId: item.jobId,
              itemId: item.id,
              claimedAt: Date.now()
            });
          }
          if (result.tiles.length > 0) {
            item._claimedCount = (item._claimedCount || 0) + result.tiles.length;
            this._lastClaimAt = Date.now();
          }
        }

        // Phân loại tiles theo status
        for (const tid of result.tiles) {
          const status = await this._detectTileStatus(tid);
          if (status === 'failed') {
            failedTids.push(tid);
          } else {
            successTids.push(tid);
          }
        }
      }

      // Xử lý trường hợp không có tiles
      if (successTids.length === 0 && failedTids.length === 0) {
        if (earlyClaimedSet.size > 0) {
          // Có early claimed tiles nhưng completion timeout
          console.log(`[TileMonitor] Completion timeout nhưng có ${earlyClaimedSet.size} early claimed tile(s)`);
          // Classify early claimed tiles
          for (const tid of earlyClaimedSet) {
            const status = await this._detectTileStatus(tid);
            if (status === 'failed') {
              failedTids.push(tid);
            } else if (status === 'success') {
              successTids.push(tid);
            }
          }
        }

        // Vẫn không có gì sau classify
        if (successTids.length === 0 && failedTids.length === 0) {
          // [FLOW_RECAPTCHA_403] Case 0-TILE là biểu hiện chính của reCAPTCHA 403 ÂM THẦM: gen API
          // trả 403 → Flow KHÔNG tạo tile. Query lỗi API (interceptor slate-bridge) TRƯỚC resubmit —
          // captcha/quota/policy → rẽ nhánh (KHÔNG resubmit mù = tăng tín hiệu bot).
          try {
            const errState = await MessageBridge.sendToContentScript('getFlowErrorState', {});
            const category = errState?.state?.category || null;
            const text = errState?.state?.text || '';
            if (category === 'captcha' || category === 'quota' || category === 'policy') {
              console.warn(`[TileMonitor] 0-tile + Flow error ${category}. "${text}"`);
              this._handleClassifiedFlowError(item, category, text);
              return;
            }
          } catch (e) { /* query lỗi → degrade: resubmit như cũ */ }
          // Bug fix 2026-06-08: Item stuck không claim được tile (Flow rate-limit/lỗi) →
          // thử Tier 2 resubmit trước khi mark FAILED. Trước fix: mark FAILED trực tiếp,
          // không vào _handleFailedTiles → KHÔNG retry, KHÔNG resubmit → user mất prompt.
          // Sau fix: dùng chung budget retrySubmitCount với EditorExecutor catch path →
          // tổng tối đa 1 lần resubmit, không loop.
          if (item.retrySubmitCount < 1) {
            console.warn(`[TileMonitor] Không phát hiện tiles mới cho item ${item.id.substring(0, 8)} → Tier 2 resubmit`);
            this._emitItemStatus(item, 'tier2_resubmit', { failedCount: 0 });
            this._requestFallbackSubmit(item);
            return;
          }
          item.state = QueueItem.STATE.FAILED;
          item.error = 'Không phát hiện tiles mới (đã resubmit 1 lần)';
          item.completedAt = Date.now();
          this._failedCount++;
          this._onItemCompleted?.(item);
          return;
        }
      }

      // Cập nhật thumbnails: chỉ giữ tiles đã claim
      if (result?.thumbnails) {
        const keptSet = new Set([...successTids, ...failedTids]);
        for (const tid of Object.keys(result.thumbnails)) {
          if (!keptSet.has(tid)) {
            delete result.thumbnails[tid];
          }
        }
      }

      console.log(`[TileMonitor] _monitorItem classified: ${successTids.length} success, ${failedTids.length} failed for item ${item.id.substring(0, 8)}`);

      if (failedTids.length === 0) {
        // Tất cả tiles thành công
        item.state = QueueItem.STATE.COMPLETED;
        item.resultTileIds = successTids;
        item.resultThumbnails = result?.thumbnails || {};
        item.tileId = successTids[0] || null;
        item.completedAt = Date.now();
        this._completedCount++;

        this._emitItemStatus(item, 'completed', { successCount: successTids.length });

        // CRITICAL: Gọi _onTilesReady TRƯỚC _onItemCompleted
        // Lý do: _onItemCompleted trigger _checkJobDone() kiểm tra hasPendingDownloads
        if (successTids.length > 0) {
          console.log(`[TileMonitor] Calling _onTilesReady with ${successTids.length} tiles:`, successTids.map(t => t.substring(0, 8)));
          this._onTilesReady?.(item, successTids);
        }

        // Rồi mới trigger job completion check
        this._onItemCompleted?.(item);
      } else {
        // Có tiles thất bại — xử lý retry
        this._emitItemStatus(item, 'fail_detected', {
          successCount: successTids.length,
          failedCount: failedTids.length,
        });
        await this._handleFailedTiles(item, result || {}, successTids, failedTids);
      }

    } catch (err) {
      // AbortError = job bị stop, không phải lỗi thật
      if (err.name === 'AbortError') {
        if (item.state !== QueueItem.STATE.CANCELLED) {
          item.state = QueueItem.STATE.CANCELLED;
        }
        return;
      }

      console.error('[TileMonitor] Lỗi theo dõi item:', err.message);
      item.state = QueueItem.STATE.FAILED;
      item.error = err.message;
      item.completedAt = Date.now();
      this._failedCount++;
      this._onItemCompleted?.(item);
    }
  }

  /**
   * MRC-3.4.3: Chờ tile MỚI xuất hiện trên DOM và claim ngay
   * Giải quyết race condition khi nhiều items cùng submit gần nhau
   * Sử dụng scanNewTiles handler để detect và claim tiles atomic
   *
   * @param {string[]} preTileIds - Baseline tile IDs trước khi submit
   * @param {number} timeoutMs - Timeout chờ tile xuất hiện (ms)
   * @param {AbortSignal} [abortSignal] - Signal để abort sớm
   * @param {number} expectedQuantity - Số tiles mong đợi (để limit claim)
   * @returns {Promise<{tile_id: string}[]>} - Array of {tile_id} objects đã claim
   */
  async _waitTileAppearance(preTileIds, timeoutMs, abortSignal, expectedQuantity = 1, preFileNames = null) {
    const startTime = Date.now();
    const pollInterval = 300; // Poll nhanh hơn (300ms) để bắt kịp tile xuất hiện
    let bestTiles = []; // Track tiles tốt nhất đã thấy

    while (Date.now() - startTime < timeoutMs) {
      // Check abort signal
      if (abortSignal?.aborted) {
        return bestTiles.length > 0 ? bestTiles : [];
      }

      try {
        // Sử dụng scanNewTiles handler để detect tiles mới
        // FIX MRC-3.4: key phải khớp với content.js handler (excludeTileIds, không phải baselineTileIds)
        // [Bug fix 2026-05-10] Truyền preFileNames để filter tiles cũ virtualize lại
        const response = await MessageBridge.sendToContentScript('scanNewTiles', {
          excludeTileIds: preTileIds || [],
          excludeFileNames: preFileNames ? Array.from(preFileNames) : []
        });

        if (response?.success && response.tiles?.length > 0) {
          bestTiles = response.tiles;

          // Đủ số lượng mong đợi → return ngay
          if (bestTiles.length >= expectedQuantity) {
            console.log(`[TileMonitor] Early detect: ${bestTiles.length}/${expectedQuantity} tile(s) sau ${Date.now() - startTime}ms`);
            return bestTiles;
          }

          // Chưa đủ → tiếp tục poll, chờ thêm tiles xuất hiện
          // (Google Flow có thể tạo tiles không đồng thời)
        }
      } catch (err) {
        console.warn('[TileMonitor] _waitTileAppearance poll error:', err.message);
      }

      await this._sleep(pollInterval);
    }

    // Timeout — trả về bao nhiêu tiles đã thấy (có thể < expectedQuantity)
    if (bestTiles.length > 0) {
      console.log(`[TileMonitor] _waitTileAppearance timeout, trả về ${bestTiles.length}/${expectedQuantity} tile(s) đã phát hiện`);
      return bestTiles;
    }

    console.log(`[TileMonitor] _waitTileAppearance timeout sau ${timeoutMs}ms, không phát hiện tile mới`);
    return [];
  }

  /**
   * MRC-3.4.4 + CONTINUOUS CLAIM FIX: Chờ tiles xuất hiện + claim liên tục + poll completion
   *
   * FIX: Khi quantity > 1, Google Flow có thể tạo tiles KHÔNG đồng thời.
   * Giải pháp: Unified loop claim tiles liên tục cho đến khi đủ hoặc settle.
   *
   * @param {Object} item - QueueItem cần theo dõi
   * @param {AbortSignal} [abortSignal] - Signal để abort
   * @returns {Promise<{tiles: string[], thumbnails: Object, failed?: boolean}>}
   */
  async _waitForTiles(item, abortSignal) {
    const expectedQuantity = parseInt(item.settings?.quantity) || 1;
    const claimedTileIds = [];

    // === CONFIG ===
    const INITIAL_WAIT = 3000;      // 3s chờ tile đầu tiên xuất hiện
    const BASE_SETTLE_DELAY = 3000; // 3s cơ bản cho settle
    const PER_TILE_SETTLE = 5000;   // +5s cho mỗi tile còn thiếu (Google Flow tạo tiles async)
    const POLL_INTERVAL = 400;      // Poll mỗi 400ms
    // Phase L: Use instance timeout with SystemConfig fallback
    const MAX_TIMEOUT = this._timeout || window.SystemConfig?.getTimeout('image_timeout_ms') || 300000;

    const startTime = Date.now();
    let lastClaimTime = 0;          // Timestamp lần claim gần nhất
    let hasAnyTile = false;         // Đã có ít nhất 1 tile chưa

    console.log(`[TileMonitor] Starting continuous claim for item ${item.id.substring(0, 8)}, expectedQuantity=${expectedQuantity}`);

    // === PHASE 2 fix 2026-06-03: Wait earlier items claim trước (submit order respect) ===
    // Bug: parallel mode + multi-prompt + silent fail prompt N → item N+1 scan trước item N,
    // claim tile của prompt N → filename mapping shift (vd "01-08" thay vì "02-09").
    // Fix: bounded wait 5s cho items có _submitOrder < N hoàn thành claim hoặc fail.
    // Bounded để tránh deadlock nếu earlier item stuck. Pattern reference: fallback path line 145-155.
    if (item._submitOrder) {
      const ORDER_WAIT_TIMEOUT = 5000;
      const orderWaitStart = Date.now();
      while (Date.now() - orderWaitStart < ORDER_WAIT_TIMEOUT) {
        if (abortSignal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const hasEarlierActive = [...this._activeMonitors.values()].some(m => {
          if (m.item === item) return false;
          if (!m.item._submitOrder || m.item._submitOrder >= item._submitOrder) return false;
          // Earlier item còn MONITORING/SUBMITTED + chưa claim đủ quantity
          const earlierState = m.item.state;
          const earlierQty = parseInt(m.item.settings?.quantity) || 1;
          const earlierClaimed = (m.item._earlyClaimedTiles?.length || 0);
          return (earlierState === QueueItem.STATE.MONITORING || earlierState === QueueItem.STATE.SUBMITTED)
                 && earlierClaimed < earlierQty;
        });
        if (!hasEarlierActive) break;
        await this._sleep(300);
      }
      const orderWaitElapsed = Date.now() - orderWaitStart;
      if (orderWaitElapsed > 100) {
        console.log(`[TileMonitor] Item ${item.id.substring(0, 8)} waited ${orderWaitElapsed}ms cho earlier items (_submitOrder ${item._submitOrder})`);
      }
    }

    // === UNIFIED CLAIM + POLL LOOP ===
    while (Date.now() - startTime < MAX_TIMEOUT) {
      // Heartbeat re-activate Flow tab — tab nền throttle DOM → detect tile-xong chậm/kẹt.
      // Throttle 8s shared trong MessageBridge → gọi mỗi poll vẫn chỉ gửi 1 lần/8s (no spam),
      // background no-op nếu tab đã active (no churn). Fire-and-forget, không block poll.
      window.MessageBridge?.heartbeatActivateFlowTab?.();
      // Check abort signal
      if (abortSignal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      // Check job state
      const job = this._queue?.getJob(item.jobId);
      if (!job || job.state === 'stopped') {
        throw new DOMException('Aborted', 'AbortError');
      }

      // Stagnation false-positive guard (PHASE 1 — chờ claim tile ĐẦU). Video gen tile đầu có thể
      // > 60s (Flow video timeout tới 7 phút) → trước khi claim, _lastClaimAt giữ timestamp item
      // TRƯỚC → Stagnation watchdog (60s) fire reload NHẦM giữa lúc gen → kill in-flight → fail 0 tile.
      // Bug 59 chỉ heartbeat ở PHASE 2 (processing > 0). Mở rộng: nếu DOM CÒN tile đang gen (pending)
      // → Flow ĐANG chạy, KHÔNG stuck → heartbeat _lastClaimAt. Pending=0 (Flow rate-limit thật) →
      // KHÔNG heartbeat → watchdog vẫn fire đúng. Throttle 15s (watchdog poll 15s / threshold 60s).
      const _nowTick = Date.now();
      if (claimedTileIds.length < expectedQuantity
          && (!this._lastPendingHeartbeat || (_nowTick - this._lastPendingHeartbeat) > 15000)) {
        this._lastPendingHeartbeat = _nowTick;
        try {
          const _pc = (await MessageBridge.sendToContentScript('getPendingTileCount', {
            excludeClaimedTileIds: [...this._claimedTileIds.keys()],
          }))?.count || 0;
          if (_pc > 0) this._lastClaimAt = Date.now();
        } catch (_) { /* best-effort — miss → watchdog xử lý như cũ */ }
      }

      try {
        // === STEP 1: Scan tiles mới và claim ===
        // [Bug fix 2026-05-10] Pass preFileNames để filter tiles cũ Flow virtualize lại với tile_id MỚI.
        //   Trước fix: excludeFileNames=[] → scanNewTiles chỉ filter tile_id → khi Flow lazy-load tiles cũ
        //   với tile_id mới → trông "new" → claim sai → download tile có sẵn.
        //   Sau fix: file_name (UUID persistent) trong baseline → filter chính xác bất kể tile_id.
        const alreadyClaimed = [...claimedTileIds, ...(item.preTileIds || [])];
        const response = await MessageBridge.sendToContentScript('scanNewTiles', {
          excludeTileIds: alreadyClaimed,
          excludeFileNames: Array.from(item.preFileNames || [])
        });

        if (response?.success && response.tiles?.length > 0) {
          // Có tiles mới chưa claim
          const remaining = expectedQuantity - claimedTileIds.length;

          if (remaining > 0) {
            // [REVERT v2 Phase 4-5] Bỏ state field detection vì không reliable.
            //   Take FIRST N tiles từ scan result. Flow render newest gen ở TOP DOM order.
            //   Phase 1 fix (excludeFileNames) vẫn active — filter tiles cũ.
            const tilesToClaim = response.tiles.length > remaining
              ? response.tiles.slice(0, remaining)
              : response.tiles;

            for (const tileObj of tilesToClaim) {
              const tid = typeof tileObj === 'string' ? tileObj : tileObj.tile_id;
              if (!tid) continue;

              // FIX: Skip duplicate trong local claimedTileIds array
              if (claimedTileIds.includes(tid)) continue;

              // 2026-06-03 Phase 1 fix: chỉ allow re-claim cho CÙNG item (idempotent).
              // Trước: `existing.jobId === item.jobId` cho phép same-job overwrite → 2 items
              // trong multi-prompt cùng claim 1 tile khi silent fail (filename mapping shift).
              // Sau: `existing.itemId === item.id` → strict per-item, mỗi tile chỉ thuộc 1 item.
              const existing = this._claimedTileIds.get(tid);
              if (!existing || existing.itemId === item.id) {
                this._claimedTileIds.set(tid, {
                  jobId: item.jobId,
                  itemId: item.id,
                  claimedAt: Date.now()
                });
                claimedTileIds.push(tid);
                lastClaimTime = Date.now();
                hasAnyTile = true;
                // Track real-time để UI phân biệt "đang gen" vs "chờ Flow" + stagnation detection
                item._claimedCount = claimedTileIds.length;
                this._lastClaimAt = Date.now();
                console.log(`[TileMonitor] Claimed tile ${tid.substring(0, 8)} (${claimedTileIds.length}/${expectedQuantity}) for item ${item.id.substring(0, 8)}`);
              }
            }
          }
        }

        // === STEP 2: Check completion conditions ===
        const elapsed = Date.now() - startTime;
        const timeSinceLastClaim = lastClaimTime > 0 ? (Date.now() - lastClaimTime) : elapsed;

        // Condition 1: Đủ tiles → exit loop, proceed to completion polling
        if (claimedTileIds.length >= expectedQuantity) {
          console.log(`[TileMonitor] Got all ${expectedQuantity} tile(s) for item ${item.id.substring(0, 8)} in ${elapsed}ms`);
          break;
        }

        // Condition 2: Settle - đã qua initial wait + có tiles + không có tile mới trong dynamic settle delay
        // Dynamic: chờ lâu hơn nếu còn thiếu nhiều tiles (Google Flow tạo tiles async)
        const missingTiles = expectedQuantity - claimedTileIds.length;
        const dynamicSettleDelay = BASE_SETTLE_DELAY + (missingTiles * PER_TILE_SETTLE);
        if (elapsed > INITIAL_WAIT && hasAnyTile && timeSinceLastClaim > dynamicSettleDelay) {
          // Bug fix 2026-06-07: DOM-gen heartbeat trước khi break — nếu DOM còn tile gen
          // orphan (chưa-ai-claim) thì tile sắp về cho item này → KHÔNG break, reset timer
          // và continue claim. Pattern y hệt _waitClaimedTilesComplete (line 1029-1058).
          // Trigger thực tế: video gen chậm (Veo Quality ~15-30s/tile) + quantity > 1 →
          // settle delay (3+missing*5)s không đủ → trước fix break sớm với M<N tiles →
          // item COMPLETED thiếu tile silent (user nhận thiếu, không biết).
          let pending = 0;
          if (claimedTileIds.length < expectedQuantity) {
            try {
              pending = (await MessageBridge.sendToContentScript('getPendingTileCount', {
                excludeClaimedTileIds: [...this._claimedTileIds.keys()],
              }))?.count || 0;
            } catch (_) { /* heartbeat best-effort, default 0 → break */ }
          }
          if (pending > 0 && claimedTileIds.length < expectedQuantity) {
            // DOM còn tile gen orphan → continue claim. Reset timer để cấp thêm
            // 1 dynamicSettleDelay window cho tile mới xuất hiện trên DOM.
            lastClaimTime = Date.now();
            console.log(`[TileMonitor] Settle hit nhưng DOM còn ${pending} tile gen orphan → continue claim cho item ${item.id.substring(0, 8)}`);
          } else {
            if (claimedTileIds.length < expectedQuantity) {
              console.warn(`[TileMonitor] ⚠️ INCOMPLETE: settled với ${claimedTileIds.length}/${expectedQuantity} tile(s) cho item ${item.id.substring(0, 8)} — DOM hết pending gen sau ${dynamicSettleDelay}ms.`);
            } else {
              console.log(`[TileMonitor] Settled với ${claimedTileIds.length}/${expectedQuantity} tile(s) cho item ${item.id.substring(0, 8)} (no new tiles in ${dynamicSettleDelay}ms)`);
            }
            break;
          }
        }

        // Condition 3: Initial wait passed + no tiles → keep waiting (Google Flow có thể chậm)
        // Không break, tiếp tục poll

      } catch (err) {
        if (err.name === 'AbortError') throw err;
        console.warn('[TileMonitor] Continuous claim poll error:', err.message);
      }

      await this._sleep(POLL_INTERVAL);
    }

    // Lưu tiles đã claim để _monitorItem sử dụng
    item._earlyClaimedTiles = [...claimedTileIds];

    // === PHASE 2: WAIT FOR COMPLETION — Poll tiles đã claim đến khi settle ===
    if (claimedTileIds.length > 0) {
      console.log(`[TileMonitor] Waiting for ${claimedTileIds.length} claimed tile(s) to complete:`, claimedTileIds.map(t => t.substring(0, 8)));

      const remainingTimeout = Math.max(MAX_TIMEOUT - (Date.now() - startTime), 30000);
      // Truyền item → _waitClaimedTilesComplete dùng preTileIds/preFileNames re-scan tile gen mới
      // khi tile claim bị Flow đổi ID (DOM-gen heartbeat, tránh fail sớm video đang gen).
      const completionResult = await this._waitClaimedTilesComplete(
        claimedTileIds,
        remainingTimeout,
        item,
        abortSignal
      );

      console.log(`[TileMonitor] _waitForTiles returning: ${completionResult.success.length} success, ${completionResult.failed.length} failed`);

      // Chuyển đổi format để tương thích với code cũ
      const allTiles = [...completionResult.success, ...completionResult.failed];
      return {
        tiles: allTiles,
        thumbnails: completionResult.thumbnails,
        failed: completionResult.failed.length > 0,
        successTids: completionResult.success,
        failedTids: completionResult.failed
      };
    }

    // === FALLBACK: Không có tiles nào được claim → dùng flow cũ ===
    console.log(`[TileMonitor] No tiles claimed, falling back to waitForNewTiles for item ${item.id.substring(0, 8)}`);

    const tilePromise = MessageBridge.waitForNewTiles(
      item.preTileIds,
      this._timeout,
      {
        captureFileNames: true,
        preFileNames: item.preFileNames,
      }
    );

    // Nếu không có abort signal, chạy bình thường
    if (!abortSignal) return tilePromise;

    // Race: tile result vs abort
    return Promise.race([
      tilePromise,
      new Promise((_, reject) => {
        if (abortSignal.aborted) {
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        abortSignal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
      }),
    ]);
  }

  /**
   * MRC-3.4.5: Xử lý tiles thất bại — Tier 1: Button retry với per-item tracking
   * Sau button retry, claim tiles mới và dùng _waitClaimedTilesComplete
   *
   * @param {Object} result - Kết quả từ _waitForTiles
   * @param {string[]} successTids - Tiles đã xác nhận thành công (classified bởi _monitorItem)
   * @param {string[]} failedTids - Tiles đã xác nhận thất bại (classified bởi _monitorItem)
   */
  // Phân loại lỗi Flow cho 1 tile. tileCategory (reason tile tự phân loại) ưu tiên hơn state.category
  // (toast/widget global, transient) — reason tile authoritative hơn cho lỗi hard-stop (captcha/quota/policy).
  async _classifyFlowFailure(tileId) {
    try {
      const errState = await MessageBridge.sendToContentScript('getFlowErrorState', { tileId });
      const category = errState?.tileCategory || errState?.state?.category || null;
      const text = (errState?.tileCategory ? errState?.tileReason : errState?.state?.text)
        || errState?.tileReason || errState?.state?.text || '';
      return { category, text };
    } catch (e) {
      // Query lỗi → fail-safe: coi như transient (không chặn nhầm lỗi retry được).
      console.warn('[TileMonitor] getFlowErrorState failed (degrade → retry như cũ):', e.message);
      return { category: null, text: '' };
    }
  }

  async _handleFailedTiles(item, result, successTids, failedTids) {
    // Tiles đã được claim bởi _monitorItem (đồng bộ, trước khi vào đây)
    // Không cần claim lại

    // Track tất cả tiles thuộc item này (gốc + retry) để exclude đúng
    const itemOwnTileIds = [...(result.tiles || [])];

    // Merge thumbnails từ result vào item
    if (!item.resultThumbnails) item.resultThumbnails = {};
    if (result.thumbnails) {
      Object.assign(item.resultThumbnails, result.thumbnails);
    }

    // Tải xuống tiles thành công ngay (TRƯỚC _onItemCompleted)
    if (successTids.length > 0) {
      if (!item.resultTileIds) item.resultTileIds = [];
      item.resultTileIds.push(...successTids);
      this._onTilesReady?.(item, successTids);
    }

    // Tier 1: Click nút "Thử lại" trên tiles thất bại, loop maxRetries lần
    let remainingFailed = [...failedTids];
    let totalRetrySucceeded = 0;

    // [FLOW_RECAPTCHA_403 Phase 3] Phân loại lỗi TRƯỚC khi retry — captcha/quota/policy KHÔNG retry
    // (cùng prompt fail lại + spam = tăng tín hiệu bot). Query content script: recaptcha widget +
    // toast + reason của fail tile đầu tiên.
    if (remainingFailed.length > 0) {
      const { category, text } = await this._classifyFlowFailure(remainingFailed[0]);
      if (category === 'captcha' || category === 'quota' || category === 'policy') {
        console.warn(`[TileMonitor] Flow error classified: ${category} — skip retry. "${text}"`);
        this._handleClassifiedFlowError(item, category, text, remainingFailed[0]);
        return;
      }
      // rate_limit: KHÔNG skip retry cứng (backoff do PromptQueue xử ở submit path) — chỉ báo.
      if (category === 'rate_limit') {
        console.warn(`[TileMonitor] Flow rate-limited: "${text}" — retry vẫn chạy (PromptQueue backoff).`);
        window.eventBus?.emit('flow:error_classified', { category, text, jobId: item.jobId, itemId: item.id });
      }
    }

    if (remainingFailed.length > 0 && this._maxRetries > 0) {
      for (let attempt = 1; attempt <= this._maxRetries && remainingFailed.length > 0; attempt++) {
        // Kiểm tra job có bị dừng trong lúc retry không
        const retryJob = this._queue?.getJob(item.jobId);
        if (!retryJob || retryJob.state === 'stopped' || item.state === QueueItem.STATE.CANCELLED) {
          break;
        }

        // Emit retry status cho UI
        window.eventBus?.emit('retry:status', { text: `Click Retry (${attempt}/${this._maxRetries})` });
        this._emitItemStatus(item, 'click_retry', {
          attempt,
          successCount: successTids.length + totalRetrySucceeded,
          failedCount: remainingFailed.length,
        });

        // Click retry buttons và lấy baseline tiles mới tạo
        const retryResult = await this._retryViaButton(remainingFailed, itemOwnTileIds);

        // Emit phase chính xác dựa trên clickedCount:
        // - clickedCount > 0 → đã click thật, đang chờ tile mới complete
        // - clickedCount === 0 → skip click (tile đã click trước hoặc button không tìm thấy)
        const clickedCount = retryResult?.clickedCount || 0;
        const phaseAfterCall = clickedCount > 0 ? 'wait_retry' : 'retry_skipped';
        this._emitItemStatus(item, phaseAfterCall, {
          attempt,
          successCount: successTids.length + totalRetrySucceeded,
          failedCount: remainingFailed.length,
          text: clickedCount > 0
            ? `Đã click ${clickedCount}, chờ tile`
            : `Skip click (đã click trước)`,
        });

        if (retryResult?.newTileIds?.length > 0) {
          // Claim retry tiles ngay lập tức
          const retryClaimedTileIds = [];
          for (const tid of retryResult.newTileIds) {
            // 2026-06-04 Phase 1 fix extension: retry tile claim phải strict per-item.
            // Parallel mode multi-item cùng click retry button có thể overlap tile mới.
            const existing = this._claimedTileIds.get(tid);
            if (!existing || existing.itemId === item.id) {
              this._claimedTileIds.set(tid, {
                jobId: item.jobId,
                itemId: item.id,
                claimedAt: Date.now()
              });
              retryClaimedTileIds.push(tid);
              itemOwnTileIds.push(tid); // Track cho lần retry tiếp
            }
          }

          // Chờ retry tiles hoàn thành bằng _waitClaimedTilesComplete
          if (retryClaimedTileIds.length > 0) {
            const retryCompletion = await this._waitClaimedTilesComplete(
              retryClaimedTileIds,
              60000 // 60s timeout cho mỗi retry round
            );

            // Merge results
            if (retryCompletion.success.length > 0) {
              item.resultTileIds.push(...retryCompletion.success);
              Object.assign(item.resultThumbnails, retryCompletion.thumbnails);
              this._onTilesReady?.(item, retryCompletion.success);
              totalRetrySucceeded += retryCompletion.success.length;
            }

            // Cập nhật remaining failed cho lần retry tiếp
            remainingFailed = retryCompletion.failed;
          }
        } else if (retryResult?.succeeded?.length > 0) {
          // Fallback cho legacy retryViaButton format
          // Claim tiles trước — strict per-item ownership (xem line 491-497/694-704). Trước fix:
          // set không check ownership → có thể "steal" tile đã claim của item khác trong parallel
          // mode → duplicate/missing result.
          for (const tid of retryResult.succeeded) {
            const existing = this._claimedTileIds.get(tid);
            if (!existing || existing.itemId === item.id) {
              this._claimedTileIds.set(tid, {
                jobId: item.jobId,
                itemId: item.id,
                claimedAt: Date.now()
              });
              itemOwnTileIds.push(tid);
            }
          }

          // FIX: Fetch thumbnails cho legacy retry tiles (giống NEW path)
          // Dùng _waitClaimedTilesComplete để lấy thumbnail info
          const legacyCompletion = await this._waitClaimedTilesComplete(
            retryResult.succeeded,
            30000 // 30s timeout - tiles đã success nên sẽ return nhanh
          );

          // Merge thumbnails vào item
          if (legacyCompletion.success.length > 0) {
            item.resultTileIds.push(...legacyCompletion.success);
            Object.assign(item.resultThumbnails, legacyCompletion.thumbnails);
            this._onTilesReady?.(item, legacyCompletion.success);
            totalRetrySucceeded += legacyCompletion.success.length;
          }

          // Cập nhật remaining failed (include tiles bị fail trong completion check)
          remainingFailed = [
            ...(retryResult?.stillFailed || []),
            ...legacyCompletion.failed
          ];
        } else {
          // Retry KHÔNG tạo tiles mới (timeout hoặc click fail). Giữ nguyên remainingFailed
          // cho attempt tiếp theo — KHÔNG dùng `retryResult.stillFailed || remainingFailed` vì
          // `[]` (empty array) is truthy → drop list → loop exit sớm sau attempt 1 →
          // bypass attempt 2/2 → vào Tier 2 luôn (bug user observe).
          // Chỉ override nếu stillFailed có entries (signal thực sự "đã settle ở những tile này").
          if (Array.isArray(retryResult?.stillFailed) && retryResult.stillFailed.length > 0) {
            remainingFailed = retryResult.stillFailed;
          }
          // else: keep remainingFailed cũ → retry attempt 2 chạy được.
        }

        // [GAP A fix] Re-classify SAU MỖI round retry: captcha/quota/policy có thể XUẤT HIỆN giữa chừng
        // (fail đầu transient qua cửa pre-check, nhưng round retry bị Google flag "hoạt động bất thường").
        // Không re-check → vòng click "Thử lại" tiếp + Tier 2 resubmit = spam đúng thứ classify sinh ra
        // để tránh. Gặp hard-stop giữa vòng → dừng ngay (chặn cả Tier 1 kế lẫn Tier 2 vì return).
        if (remainingFailed.length > 0) {
          const { category, text } = await this._classifyFlowFailure(remainingFailed[0]);
          if (category === 'captcha' || category === 'quota' || category === 'policy') {
            console.warn(`[TileMonitor] Retry round ${attempt}: Flow error ${category} xuất hiện giữa chừng → dừng retry. "${text}"`);
            this._handleClassifiedFlowError(item, category, text, remainingFailed[0]);
            return;
          }
        }

        // Tất cả đã thành công → dừng retry
        if (remainingFailed.length === 0) break;
      }

      // Kiểm tra job trước khi Tier 2 fallback submit
      const fallbackJob = this._queue?.getJob(item.jobId);
      if (!fallbackJob || fallbackJob.state === 'stopped' || item.state === QueueItem.STATE.CANCELLED) {
        // Job đã bị dừng — không fallback submit, kết thúc ngay
        if (item.state !== QueueItem.STATE.CANCELLED) {
          item.state = QueueItem.STATE.CANCELLED;
        }
        return;
      }

      // Tier 2: Fallback submit CHỈ khi 0 success từ cả original + retry
      // (KHÔNG check remainingFailed.length > 0 — content.js retryFailedTilesViaButton
      // có thể trả [] cho cả succeeded + stillFailed khi click retry OK nhưng Flow chậm
      // tạo tile mới trong timeout. Trường hợp đó remainingFailed=[] sai nghĩa là "đã xong"
      // → skip Tier 2 sai. Đúng: dùng totalSucceeded === 0 làm discriminator duy nhất —
      // nếu không có tile nào success suốt original + Tier 1 retry → cần fallback resubmit.)
      const totalSucceeded = successTids.length + totalRetrySucceeded;
      if (totalSucceeded === 0 && this._maxRetries > 0) {
        // Reload Flow page TRƯỚC fallback submit để reset editor state.
        // Lý do: Tier 1 button retry hết maxRetries vẫn fail thường ngụ ý Slate editor /
        // React state corrupted (DOM stale, event listener leak, memory pressure). Reload
        // hoàn toàn → chờ editor ready → Tier 2 fallback có DOM sạch để submit lại.
        // Job stop check: nếu user dừng giữa reload → KHÔNG fallback submit nữa.
        if (this._queue?.forceReloadAndStabilize) {
          window.eventBus?.emit('retry:status', { text: 'Reload Flow page...' });
          this._emitItemStatus(item, 'tier2_reload', { failedCount: remainingFailed.length });
          // BUG FIX 2026-06-05 (R1): Capture return value để biết reload có thực sự xảy ra không.
          // forceReloadAndStabilize có thể return false vì: cooldown 90s, suppress active, pipeline busy.
          // Trước: continue resubmit dù reload bị skip → DOM/Slate vẫn corrupted → resubmit cũng fail.
          // Sau: wait up to 30s (honor abort) để DOM tự ổn định, rồi mới resubmit.
          let reloaded = false;
          try {
            reloaded = await this._queue.forceReloadAndStabilize('tier2-fallback');
          } catch (e) {
            console.warn('[TileMonitor] forceReload before fallback failed (degrade):', e.message);
          }

          // Re-check job state sau reload (user có thể đã stop)
          const postReloadJob = this._queue?.getJob(item.jobId);
          if (!postReloadJob || postReloadJob.state === 'stopped' || item.state === QueueItem.STATE.CANCELLED) {
            if (item.state !== QueueItem.STATE.CANCELLED) {
              item.state = QueueItem.STATE.CANCELLED;
            }
            return;
          }

          // R1: Nếu reload bị skip (cooldown/busy) → wait up to 30s với abort check
          // mỗi 1s. Tránh resubmit ngay khi Slate có thể vẫn corrupted.
          if (!reloaded) {
            console.warn('[TileMonitor] Tier 2 reload skipped → wait up to 30s cho DOM tự ổn định (honor abort)');
            this._emitItemStatus(item, 'tier2_wait', { failedCount: remainingFailed.length });
            for (let i = 0; i < 30; i++) {
              await this._sleep(1000);
              // Bug fix 2026-06-08: heartbeat _lastClaimAt mỗi giây để Stagnation Watchdog
              // KHÔNG fire reload chen ngang trong khi Tier 2 đang đợi DOM ổn định. Trước
              // fix: 30s wait không heartbeat → watchdog đếm 60s ngưỡng → fire reload sai →
              // log spam + race với Tier 2 resubmit.
              this._lastClaimAt = Date.now();
              // Honor job stop / item cancel mỗi giây
              const waitJob = this._queue?.getJob(item.jobId);
              if (!waitJob || waitJob.state === 'stopped' || item.state === QueueItem.STATE.CANCELLED) {
                if (item.state !== QueueItem.STATE.CANCELLED) {
                  item.state = QueueItem.STATE.CANCELLED;
                }
                return;
              }
            }
          }
        }

        // Emit retry status cho UI
        window.eventBus?.emit('retry:status', { text: 'Gửi lại Prompt' });
        this._emitItemStatus(item, 'tier2_resubmit', { failedCount: remainingFailed.length });
        this._requestFallbackSubmit(item);
        return;
      }
    }

    // Kết thúc: COMPLETED, PARTIAL_FAIL, hoặc FAILED
    const remainingFailedCount = remainingFailed.length;
    if (item.resultTileIds && item.resultTileIds.length > 0) {
      item.state = remainingFailedCount > 0 ? QueueItem.STATE.PARTIAL_FAIL : QueueItem.STATE.COMPLETED;
      item.tileId = item.resultTileIds[0] || null;
      this._completedCount++;
      this._emitItemStatus(item, remainingFailedCount > 0 ? 'partial_fail' : 'completed', {
        successCount: item.resultTileIds.length,
        failedCount: remainingFailedCount,
      });
    } else {
      item.state = QueueItem.STATE.FAILED;
      this._failedCount++;
      this._emitItemStatus(item, 'failed', { failedCount: remainingFailedCount || failedTids.length });
    }

    item.completedAt = Date.now();
    this._onItemCompleted?.(item);
  }

  /**
   * Tier 1: Click nút retry trên tiles thất bại (không cần editor)
   * Dùng MessageBridge.sendToContentScript để giao tiếp với content.js
   */
  async _retryViaButton(failedTids, itemOwnTileIds) {
    try {
      // Truyền excludeTileIds = tiles claimed bởi items KHÁC (không include item đang retry)
      // Lý do: retry tạo tile MỚI (Flow UUID), nhưng waitForNewTiles có thể bắt nhầm
      // tiles mới từ items khác đang submit đồng thời
      const ownTileSet = new Set(itemOwnTileIds || []);
      const excludeTileIds = Array.from(this._claimedTileIds.keys()).filter(tid => !ownTileSet.has(tid));
      const resp = await MessageBridge.sendToContentScript('retryFailedTilesViaButton', {
        failedTileIds: failedTids,
        timeout: this._timeout,
        excludeTileIds,
      });
      return resp || { succeeded: [], stillFailed: failedTids };
    } catch (err) {
      console.warn('[TileMonitor] Retry via button thất bại:', err.message);
      return { succeeded: [], stillFailed: failedTids };
    }
  }

  /**
   * Kiểm tra trạng thái của 1 tile qua content.js
   */
  async _detectTileStatus(tileId) {
    try {
      const resp = await MessageBridge.sendToContentScript('detectTileStatus', { tileId });
      return resp?.status || 'failed';
    } catch (err) {
      console.warn('[TileMonitor] Không thể kiểm tra trạng thái tile:', err.message);
      return 'failed';
    }
  }

  /**
   * Tier 2: Yêu cầu submit lại — đưa item về hàng đợi EditorExecutor
   * Chỉ cho phép retry submit tối đa 1 lần để tránh nhân chéo retry budget
   */
  /**
   * [FLOW_RECAPTCHA_403 Phase 3] Rẽ nhánh xử lý lỗi Flow đã phân loại (captcha/quota/policy).
   *  - captcha + job pausable (owner 'prompts'): keep-OK (tile success đã xử trước) + RE-ENQUEUE item
   *    (resubmit sau resume, KHÔNG tốn retry budget) → PromptQueue pause CẢ queue. Multi-prompt:
   *    prompt OK giữ nguyên, prompt captcha resubmit khi user giải xong.
   *  - captcha + workflow/task: mark FAILED + complete → WorkflowExecutor listener halt (shouldStop),
   *    user rerun-resume node lỗi.
   *  - quota/policy: mark FAILED + complete (KHÔNG resubmit — quota vô ích, policy cùng prompt fail lại).
   * Emit 'flow:error_classified' TRƯỚC (PromptQueue pause đồng bộ) → re-enqueue rơi vào queue đã pause.
   */
  _handleClassifiedFlowError(item, category, text, tileId) {
    item.flowErrorCategory = category;
    item.flowErrorText = text;
    const job = this._queue?.getJob?.(item.jobId);
    const pausable = !!(job && job.owner === 'prompts');
    // Emit đồng bộ → PromptQueue._handleFlowError pause job NGAY (trước khi re-enqueue).
    window.eventBus?.emit('flow:error_classified', {
      category, text, jobId: item.jobId, itemId: item.id, tileId: tileId || null, pausable,
    });
    if (category === 'captcha' && pausable) {
      // Re-enqueue để resubmit sau resume. Job đã paused → EditorExecutor không dequeue tới khi resume.
      item.state = QueueItem.STATE.PENDING;
      item.priority = 100; // ưu tiên cao khi resume
      item.error = null;
      item.flowErrorCategory = null; // Port 1.1.58: clear category → fail sau resume không mang category stale (đồng bộ FAR-2)
      this._queue?.enqueue?.(item);
      return;
    }
    // captcha (workflow/task) hoặc quota/policy → fail item (executor halt / báo user).
    item.state = QueueItem.STATE.FAILED;
    item.error = text || category;
    item.completedAt = Date.now();
    this._failedCount++;
    this._onItemCompleted?.(item);
  }

  _requestFallbackSubmit(item) {
    // Chỉ cho phép fallback submit nếu chưa vượt budget (thống nhất với EditorExecutor: < 1)
    if (item.retrySubmitCount < 1) {
      item.retrySubmitCount++;
      item.state = QueueItem.STATE.RETRY_SUBMIT;
      item.priority = 100; // Ưu tiên cao cho retry
      this._queue?.enqueue(item);
    } else {
      item.state = QueueItem.STATE.FAILED;
      item.completedAt = Date.now();
      this._failedCount++;
      this._onItemCompleted?.(item);
    }
  }

  /**
   * Hủy tất cả monitors thuộc 1 job
   * Không abort waitForNewTiles (tiles đang gen trên Flow)
   * Chỉ đánh dấu cancelled -> khi monitor xong sẽ bỏ qua
   */
  abortJob(jobId) {
    const toRemove = [];
    for (const [itemId, monitor] of this._activeMonitors) {
      if (monitor.item.jobId === jobId) {
        monitor.item.state = QueueItem.STATE.CANCELLED;
        // Abort waitForNewTiles sớm (không chờ hết timeout 180s)
        monitor.abortController?.abort();
        toRemove.push(itemId);
      }
    }
    // Giải phóng slot ngay
    for (const id of toRemove) {
      this._activeMonitors.delete(id);
    }
  }

  /**
   * Dừng tất cả monitors
   */
  stopAll() {
    for (const [, monitor] of this._activeMonitors) {
      monitor.item.state = QueueItem.STATE.CANCELLED;
      // Abort tất cả waitForNewTiles đang chạy
      monitor.abortController?.abort();
    }
    // Giải phóng tất cả slots ngay lập tức
    this._activeMonitors.clear();
  }

  /**
   * Clear claimed tiles map (cần thiết khi pipeline rỗng để giải phóng memory).
   * KHÔNG reset _completedCount/_failedCount — counter dùng cho display, giữ
   * cumulative đến khi user submit job mới hoặc reload extension. Reset counter
   * sớm khiến QueueMonitor TILES "0 active / 0 done / 0 failed" trong khi user
   * vẫn thấy items COMPLETED trong list → contradictory UX.
   */
  reset() {
    this._claimedTileIds.clear();
  }

  /**
   * Reset counter về 0 — gọi khi user submit job MỚI (clean slate cho session mới).
   */
  resetCounters() {
    this._completedCount = 0;
    this._failedCount = 0;
  }

  /**
   * Helper: Sleep async
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * MRC-3.4.2: Chờ các tiles đã claim hoàn thành (success hoặc failed)
   * KHÔNG chờ tiles khác, CHỈ poll tiles trong claimedTileIds
   *
   * @param {string[]} claimedTileIds - Tiles đã claim cho item này
   * @param {number} timeoutMs - Timeout (default 180s)
   * @returns {Promise<{success: string[], failed: string[], thumbnails: Object}>}
   */
  async _waitClaimedTilesComplete(claimedTileIds, timeoutMs = 180000, item = null, abortSignal = null) {
    const startTime = Date.now();
    const pollInterval = 500;  // Poll mỗi 500ms
    // Bug fix 2026-05-28: tile video placeholder claim sớm bị Flow ĐỔI ID khi gen thật bắt đầu →
    // ID cũ not_found → fail SỚM dù video VẪN đang gen (user thấy gen chạy nhưng GenTab báo fail).
    // DOM-gen HEARTBEAT thay timeout cứng: trước khi finalize fail, check getPendingTileCount
    // (page còn tile gen?). Còn gen → re-scan tile mới + swap vào watch (KHÔNG fail) + GIA HẠN deadline.
    // Chỉ finalize fail khi page HẾT gen + grace. Abs cap = safety chống treo.
    const GEN_GRACE_MS = 12000;                          // page hết gen → chờ 12s mới finalize fail
    const MAX_READOPT = 6;                               // giới hạn swap ID stale (tránh loop)
    const ABS_CAP_MS = Math.max(timeoutMs, 1200000);     // hard cap 20 phút (an toàn)
    const GEN_EXTEND_MS = 60000;                         // còn gen → gia hạn deadline 60s rolling
    const ITEM_STUCK_MS = 60000;                         // tile 'not_found' (biến mất/ID-swap) + không successor >60s → fail
    // [Cách 2 — 2026-06-27] Tile fail RÕ ('failed' = warning tại chỗ, definitive): Flow KHÔNG auto-recovery
    // (xác nhận log: status='failed' suốt 61s, re-adopt rawTiles=0). Chờ 60s là lãng phí → grace ngắn 8s
    // (đủ cho re-adopt scan vài vòng phòng video ID-swap hiếm) rồi finalize → Tier retry/reload xử lý.
    const FAILED_DEFINITIVE_GRACE_MS = 8000;             // tile 'failed' rõ + không successor >8s → fail nhanh

    let watchIds = [...new Set(claimedTileIds)];
    const successSet = new Set();
    const thumbnails = {};
    let lastGenActiveAt = Date.now();
    // Khác lastGenActiveAt (cập nhật cả khi GLOBAL/orphan pending>0): lastItemActiveAt CHỈ cập nhật khi
    // tile CỦA ITEM NÀY active (processing watched tile / re-adopt thành công). Dùng để phân biệt "gen
    // của item này còn sống" vs "pending là gen của node KHÁC" → tránh đứng im chờ gen node khác.
    let lastItemActiveAt = Date.now();
    let reAdoptCount = 0;
    let deadline = startTime + timeoutMs;

    while (Date.now() < deadline && Date.now() - startTime < ABS_CAP_MS) {
      // Heartbeat re-activate Flow tab (throttle 8s shared) — tab nền throttle → poll status kẹt.
      window.MessageBridge?.heartbeatActivateFlowTab?.();
      // Check abort signal (từ item's per-item AbortController trong _activeMonitors) + job-stopped
      // state. Trước fix: check this._abortController (không bao giờ được gán) → Stop không abort được
      // Phase-2 completion polling → re-focus Flow tab tới 20 phút.
      if (abortSignal?.aborted) {
        throw new Error('Aborted');
      }
      if (item) {
        const _job = this._queue?.getJob(item.jobId);
        if (!_job || _job.state === 'stopped' || item.state === QueueItem.STATE.CANCELLED) {
          throw new Error('Aborted');
        }
      }

      // Poll status của các tiles đang watch
      const response = await MessageBridge.sendToContentScript('getTileStatuses', {
        tileIds: watchIds
      });

      if (!response?.success || !response.statuses) {
        await this._sleep(pollInterval);
        continue;
      }

      const statuses = response.statuses;
      const failedNow = [];
      const processing = [];

      for (const tileId of watchIds) {
        // Đã success → GIỮ (kết quả đã chốt + thumbnail đã lưu). Tránh DOM virtualize (scroll) khiến
        // tile success đọc lại 'not_found' → bị đẩy sang failed → TRÙNG ở cả success lẫn failed.
        if (successSet.has(tileId)) continue;
        const info = statuses[tileId];
        if (info?.status === 'success') {
          successSet.add(tileId);
          thumbnails[tileId] = {
            thumbnail: info.thumbnail,
            type: info.type,
            file_name: info.file_name,
            ...(info.video_url && { video_url: info.video_url })  // Include video_url for video tiles
          };
        } else if (!info || info.status === 'not_found' || info.status === 'failed') {
          failedNow.push(tileId);
        } else {
          processing.push(tileId);  // 'processing'
        }
      }

      // Còn tiles đang processing → tiếp tục poll. Gia hạn deadline CHỈ cho main path (item != null);
      // retry/legacy path (item=null) giữ timeout BOUNDED (60s/30s) — không extend tránh chờ lê thê.
      if (processing.length > 0) {
        lastGenActiveAt = Date.now();
        lastItemActiveAt = Date.now(); // tile CỦA ITEM NÀY đang gen → còn sống
        if (item) deadline = Math.max(deadline, Date.now() + GEN_EXTEND_MS);
        // BUG FIX 2026-06-05: Heartbeat _lastClaimAt khi item đang processing để Stagnation
        // Watchdog (60s threshold) KHÔNG fire false-positive trong khi item đang chờ Flow gen.
        // Trước fix: item claim xong → chờ 60s+ cho Flow gen → watchdog tưởng pipeline stuck
        // → fire forceReload → kill in-flight item → Tier 2 resubmit → DUPLICATE GEN.
        this._lastClaimAt = Date.now();
        await this._sleep(pollInterval);
        continue;
      }

      // Watch tiles settle, KHÔNG còn fail → done
      if (failedNow.length === 0) {
        console.log(`[TileMonitor] _waitClaimedTilesComplete done: ${successSet.size} success, 0 failed`);
        return { success: [...successSet], failed: [], thumbnails };
      }

      // Retry/legacy path (item=null): KHÔNG dùng heartbeat/re-adopt (tile retry freshly claimed,
      // không kỳ vọng đổi ID) → finalize fail ngay khi settle, giữ hành vi bounded cũ.
      if (!item) {
        console.log(`[TileMonitor] _waitClaimedTilesComplete done: ${successSet.size} success, ${failedNow.length} failed (no-heartbeat path)`);
        return { success: [...successSet], failed: failedNow, thumbnails };
      }

      // Main path có fail → DOM-gen heartbeat.
      // LỚP 1: đếm CHỈ tile gen CHƯA-AI-CLAIM (loại _claimedTileIds) → monitor A không "kẹt chờ"
      // gen của B (tile B đã claim → không tính), chỉ "sống" khi có gen orphan = replacement của A.
      let pending = 0;
      try {
        pending = (await MessageBridge.sendToContentScript('getPendingTileCount', {
          excludeClaimedTileIds: [...this._claimedTileIds.keys()],
        }))?.count || 0;
      } catch (_) { /* heartbeat best-effort */ }

      if (pending > 0) {
        // [Fix 2026-08] pending>0 nhưng có thể là gen của NODE KHÁC (orphan). Nếu tile của ITEM NÀY đã
        // chết + KHÔNG có successor (re-adopt) suốt grace → finalize fail, KHÔNG chờ vô tận trên gen
        // node khác (→ "đứng im" tới MAX_TIMEOUT). Item gen valid → watched tile 'processing' →
        // lastItemActiveAt tươi → KHÔNG dính nhánh này.
        //
        // [Cách 2] Threshold ĐỘNG theo loại chết:
        //   - Tile fail RÕ ('failed' = warning tại chỗ, definitive) → Flow không auto-recovery →
        //     grace ngắn 8s (cắt 60s lãng phí).
        //   - Tile 'not_found'/vanished (có thể video ID-swap) → giữ 60s cho re-adopt safety.
        // Mix (vài tile failed + vài not_found) → dùng 60s an toàn (.every).
        const allExplicitFailed = failedNow.length > 0
          && failedNow.every(t => statuses[t]?.status === 'failed');
        const stuckThreshold = allExplicitFailed ? FAILED_DEFINITIVE_GRACE_MS : ITEM_STUCK_MS;
        if (Date.now() - lastItemActiveAt > stuckThreshold) {
          const _fs = failedNow.map(t => `${t.substring(0, 10)}=${statuses[t]?.status || 'no-info'}`).join(',');
          console.warn(`[TileMonitor] Item ${item.id.substring(0, 8)} tile chết + không successor ${Math.round((Date.now() - lastItemActiveAt) / 1000)}s (pending=${pending} gen node khác, grace=${stuckThreshold / 1000}s ${allExplicitFailed ? 'fail-rõ' : 'not_found'}) → finalize fail | failStatus[${_fs}]`);
          return { success: [...successSet], failed: failedNow, thumbnails };
        }
        lastGenActiveAt = Date.now();
        deadline = Math.max(deadline, Date.now() + GEN_EXTEND_MS);

        // LỚP 2 (chống cướp tile): chỉ re-adopt khi KHÔNG có monitor submit TRƯỚC đang active
        // (mình là gen sớm nhất → tile orphan thuộc về mình theo FIFO). Monitor sau nhường —
        // tránh giành tile của nhau khi nhiều gen đổi ID cùng lúc (Flow không gắn nhãn tile/submit).
        // Cùng heuristic _submitOrder với fallback path (_monitorItem) để nhất quán.
        const hasEarlierActive = [...this._activeMonitors.values()].some(
          m => m.item !== item && m.item._submitOrder && item._submitOrder
            && m.item._submitOrder < item._submitOrder
            && (m.item.state === QueueItem.STATE.MONITORING || m.item.state === QueueItem.STATE.SUBMITTED)
        );

        // Tile đã claim bị Flow đổi ID (video) → re-scan tile gen mới, swap vào watch (giữ success).
        if (item && !hasEarlierActive && reAdoptCount < MAX_READOPT) {
          try {
            const scan = await MessageBridge.sendToContentScript('scanNewTiles', {
              excludeTileIds: [...watchIds, ...successSet, ...(item.preTileIds || [])],
              excludeFileNames: Array.from(item.preFileNames || []),
            });

            // [Bug fix 2026-06-11] Filter scan results theo expected media_type.
            // Trước fix: re-adopt grab BẤT KỲ tile mới (workflow Video gen có thể nhầm grab
            // Image tile workflow khác đang gen song song) → mask gen failure as success →
            // KHÔNG trigger Tier retry → user thấy node Video "completed" với thumbnail Image.
            // Sau fix: chỉ adopt tile khớp expected type, KHÔNG có match → skip adopt → grace
            // + finalize fail → trigger Tier retry như user mong đợi.
            //
            // Source expected type (multi-fallback):
            //   1. item.settings?.genType ('Image'/'Video') — workflow + gentab caller
            //   2. item._isVideo flag (true → Video) — Tasks Flow legacy path (PromptQueue:940)
            //   3. undefined → enforceType=false, skip filter (backward compat)
            //
            // Tile media_type 'unknown' (line 7738 content.js) → trust pass-through (legacy
            // fallback) tránh false-negative khi DOM detection chưa chắc chắn.
            const _genType = (item.settings?.genType || (item._isVideo ? 'Video' : '')).toString().toLowerCase();
            const enforceType = _genType === 'image' || _genType === 'video';

            const fresh = (scan?.tiles || [])
              .filter(t => {
                if (!enforceType) return true;
                const tType = (typeof t === 'object' && t.media_type) ? t.media_type : 'unknown';
                if (tType === 'unknown') return true; // unknown → trust (DOM detect fallback)
                return tType === _genType;
              })
              .map(t => (typeof t === 'string' ? t : t.tile_id))
              .filter(id => id && !successSet.has(id))
              // CONCURRENCY-SAFE: chỉ adopt tile CHƯA bị item KHÁC claim → tránh 2 monitor (batch/
              // nhiều prompt chạy song song) cướp tile của nhau. Tile owned bởi item này thì OK.
              .filter(id => {
                const owner = this._claimedTileIds.get(id);
                return !owner || owner.itemId === item.id;
              });
            if (fresh.length > 0) {
              reAdoptCount++;
              const adopt = fresh.slice(0, Math.max(failedNow.length, 1));
              // Claim tile mới cho item này (ghi _claimedTileIds) → monitor khác sẽ skip.
              for (const tid of adopt) {
                this._claimedTileIds.set(tid, { jobId: item.jobId, itemId: item.id, claimedAt: Date.now() });
              }
              watchIds = [...successSet, ...adopt];
              lastItemActiveAt = Date.now(); // nhặt được successor CỦA ITEM NÀY → còn sống
              console.log(`[TileMonitor] Re-adopt: claimed tile stale (Flow đổi ID), page còn gen (pending=${pending}) → claim+watch ${adopt.map(t => t.substring(0, 8)).join(',')}`);
              await this._sleep(pollInterval);
              continue;
            }
          } catch (_) { /* re-scan best-effort */ }
        }
        // Còn gen nhưng (chưa thấy tile mới | nhường monitor submit trước) → chờ tiếp.
        // KHÔNG fail (heartbeat alive), KHÔNG cướp tile của monitor khác.
        await this._sleep(pollInterval);
        continue;
      }

      // Page HẾT gen. Grace: nếu vừa mới còn gen → chờ thêm (tile có thể vừa swap/render).
      if (Date.now() - lastGenActiveAt < GEN_GRACE_MS) {
        await this._sleep(pollInterval);
        continue;
      }

      // Finalize: page hết gen + grace qua → fail thật.
      console.log(`[TileMonitor] _waitClaimedTilesComplete done: ${successSet.size} success, ${failedNow.length} failed (page hết gen)`);
      return { success: [...successSet], failed: failedNow, thumbnails };
    }

    // Timeout (abs cap / hết gia hạn) → get final status, treat processing as failed
    console.warn('[TileMonitor] _waitClaimedTilesComplete timeout, treating processing as failed');
    const finalResponse = await MessageBridge.sendToContentScript('getTileStatuses', {
      tileIds: watchIds
    });

    const failed = [];
    for (const tileId of watchIds) {
      if (successSet.has(tileId)) continue;  // đã success → giữ, không đẩy sang failed (tránh trùng)
      const info = finalResponse?.statuses?.[tileId];
      if (info?.status === 'success') {
        successSet.add(tileId);
        thumbnails[tileId] = {
          thumbnail: info.thumbnail,
          type: info.type,
          file_name: info.file_name,
          ...(info.video_url && { video_url: info.video_url })  // Include video_url for video tiles
        };
      } else {
        failed.push(tileId);
      }
    }

    return { success: [...successSet], failed, thumbnails };
  }

  // --- Getters cho UI ---

  get activeCount() {
    return this._activeMonitors.size;
  }

  /**
   * Số items đã claim ít nhất 1 tile = đang gen thật trên Flow page.
   * Khác activeCount: activeCount đếm cả items chờ tile xuất hiện (Flow chưa render).
   */
  get claimingCount() {
    let count = 0;
    for (const m of this._activeMonitors.values()) {
      if ((m.item._claimedCount || 0) > 0) count++;
    }
    return count;
  }

  /**
   * Số items đang chờ Flow render tile (chưa claim được tile nào).
   * Cao bất thường = Flow rate-limit hoặc page lỗi.
   */
  get waitingCount() {
    return Math.max(0, this._activeMonitors.size - this.claimingCount);
  }

  /**
   * Pipeline stagnant = active monitors > 0 nhưng không claim được tile mới
   * suốt N giây. Signal Flow rate-limit/page broken → trigger reload sớm.
   * @param {number} thresholdMs - Ngưỡng coi là stagnant (default 60s)
   */
  isStagnant(thresholdMs = 60000) {
    if (this._activeMonitors.size === 0) return false;
    if (this._lastClaimAt === 0) return false; // chưa từng claim → batch mới bắt đầu, không phải stagnant
    return (Date.now() - this._lastClaimAt) > thresholdMs;
  }

  get completedCount() {
    return this._completedCount;
  }

  get failedCount() {
    return this._failedCount;
  }

  // SEOSONA tile ownership: chặn-TRÊN bổ sung. Chỉ giữ tile nằm trong tập item TỰ CHỐT
  // (_ownTileIds — snapshot delta ngay sau submit). Thu hẹp, KHÔNG bao giờ nới rộng; ownTileIds
  // rỗng/null (render trễ / snapshot lỗi) → trả nguyên vẹn để giữ hành vi cũ. Pure + deterministic.
  static _filterToOwnTiles(tiles, ownTileIds) {
    if (!ownTileIds || !ownTileIds.length) return tiles;
    const own = new Set(ownTileIds);
    return (tiles || []).filter(t => own.has(typeof t === 'string' ? t : (t && t.tile_id)));
  }
}

// Expose cho các script cùng page (bare name vẫn hoạt động) + để test được static helper.
if (typeof self !== 'undefined') self.TileMonitor = TileMonitor;
