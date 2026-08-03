/**
 * EditorExecutor — Thực thi tuần tự các prompt trên Google Flow editor
 * Dequeue QueueItems theo priority rồi FIFO, submit từng cái một
 * Tự động chuyển settings khi items từ các job khác nhau
 */
class EditorExecutor {
  constructor() {
    this._queue = null;          // Tham chiếu đến PromptQueue (inject sau)
    this._isRunning = false;
    this._shouldStop = false;
    this._isPaused = false;
    this._currentItem = null;
    this._processedCount = 0;
    this._lastSettings = null;   // Cache settings đã áp dụng cuối cùng
    this._onItemSubmitted = null; // Callback khi item đã submit xong
    this._onItemCompleted = null; // Callback khi item fail cuối cùng (không retry nữa)
    this._hasActiveMonitoring = null;  // Callback: () => boolean — TileMonitor còn active?
    this._onRunLoopFinished = null;    // Callback: () => void — khi _runLoop kết thúc
    this._isDownloading = false; // Track trạng thái đang download

    // Cài đặt chống ban (đọc từ UI)
    this._batchSize = 4;
    this._restMin = 5000;        // ms
    this._restMax = 15000;       // ms

    // Flow Voice Selector — dedup tracking để skip re-select khi voice giống lần trước
    this._lastVoiceKey = null;
    // Flow Character Selector — dedup tracking (độc lập voice)
    this._lastCharacterKey = null;
  }

  /** Getter: đang download hay không */
  get isDownloading() {
    return this._isDownloading;
  }

  /**
   * Thiết lập dependencies (inject từ PromptQueue)
   */
  setup({ queue, onItemSubmitted, onItemCompleted, hasActiveMonitoring, onRunLoopFinished }) {
    this._queue = queue;
    this._onItemSubmitted = onItemSubmitted;
    this._onItemCompleted = onItemCompleted || null;
    this._hasActiveMonitoring = hasActiveMonitoring || null;
    this._onRunLoopFinished = onRunLoopFinished || null;
  }

  /**
   * Cập nhật cài đặt batch từ UI
   */
  updateSettings({ batchSize, restMin, restMax }) {
    if (batchSize !== undefined) this._batchSize = batchSize;
    if (restMin !== undefined) this._restMin = restMin * 1000;
    if (restMax !== undefined) this._restMax = restMax * 1000;
  }

  /**
   * Bắt đầu vòng lặp xử lý — chỉ gọi khi chưa chạy
   */
  start() {
    if (this._isRunning) return;
    this._shouldStop = false;
    this._runLoop();
  }

  /**
   * Vòng lặp chính — dequeue và xử lý submit + download tuần tự
   * Unified Queue: submit items ưu tiên trước, download khi không còn submit
   */
  async _runLoop() {
    this._isRunning = true;
    let batchCount = 0;

    // Reset content.js shouldStop flag - fix bug shouldStop từ lần stop trước abort insertText
    try {
      await MessageBridge.sendToContentScript('resetStop', {});
    } catch (_) { globalThis.SEOSONA_swallow?.('EditorExecutor#_runLoop', _); }

    // Cache settings once at start (from storageSettings, no DOM dependency)
    const settings = window.storageSettings?.getSettings() || {};
    this._cachedInputTimeout = settings.inputTimeout || 1200;
    this._cachedRandomDelayMin = (settings.randomDelayMin ?? 3) * 1000;
    this._cachedRandomDelayMax = (settings.randomDelayMax ?? 10) * 1000;

    // Max idle poll: thoát sau 90s không có work mới (tránh poll vô hạn)
    // 90s — cho phép TileMonitor chạy lâu hơn trước khi thoát
    // _ensureRunning sẽ restart khi downloads arrive sau đó
    let idleSince = 0;
    const MAX_IDLE_POLL_MS = 90000;

    while (!this._shouldStop) {
      // Kiểm tra tạm dừng (job pause OR force reload đang chạy)
      // _forceReloadPromise truthy → PromptQueue đang reload Flow tab → không dequeue/submit
      // tới khi reload xong. Ngăn race: idle gate pass → external code enqueue item →
      // EditorExecutor dequeue + submit → reload kill DOM mid-submit.
      while (this._queue?._forceReloadPromise && !this._shouldStop) {
        await this._sleep(200);
      }
      if (this._shouldStop) break;

      // Port 1.1.58: Pause → CHỈ chặn submit prompt MỚI, VẪN drain download queue để tile đang gen
      // (in-flight) tải xong ngay cả khi paused. TileMonitor vẫn monitor khi paused → tile complete →
      // enqueue download → xử ở đây. `continue` giữ loop sống suốt pause (không rơi idle-break).
      if (this._isPaused) {
        const pausedDl = this._queue?.dequeueNextDownload?.();
        if (pausedDl) {
          idleSince = 0;
          await this._processDownload(pausedDl);
        } else {
          await this._sleep(200);
        }
        continue;
      }

      // FAR-3.2: Pre-submit DOM gate — respect Flow's concurrent-generation cap.
      // Cap = TileMonitor._maxConcurrent (= queueMaxMonitor user setting).
      // Nếu pending tiles >= cap → wait drain. Plan Section 3.3.2.
      if (this._queue?._shouldWaitForPendingDrain) {
        try {
          const shouldWait = await this._queue._shouldWaitForPendingDrain();
          if (shouldWait) {
            await this._sleep(2000);
            continue;
          }
        } catch (e) {
          // Gate check fail → không block, tiếp tục bình thường
        }
      }

      // Chunk Mode (2026-07-26): PAUSE submit nếu đang drain chờ chunk reload.
      // CRITICAL: chỉ skip submit, KHÔNG skip download. Nếu skip cả 2 → deadlock vì
      // waitForDownloadsEmpty wait forever (loop bị block, downloads không drain).
      // BUG FIX 2026-06-05: trước đó `continue` ở top loop blocked both submit + download.
      const chunkDraining = !!this._queue?._chunkDraining;

      // 1. Ưu tiên submit items (skip nếu đang chunk drain)
      const item = chunkDraining ? null : this._queue?.dequeueNext();
      if (item) {
        idleSince = 0; // Reset idle timer khi có work
        await this._processItem(item);
        batchCount++;

        // BUG FIX (2026-05-02): Sequential mode — đợi TileMonitor xong item vừa submit
        // trước khi dequeue next. User toggle "Tuần tự" expect per-prompt sync.
        // Default Pipeline = parallel (concurrent monitor). Flag được lưu per-job
        // (không global) để tránh conflict khi multiple jobs submit đồng thời.
        const itemJob = this._queue?.getJob(item.jobId);
        if (itemJob?.sequentialMode) {
          let waited = 0;
          const SEQ_WAIT_LOG_INTERVAL = 5000;  // log mỗi 5s để user biết đang đợi
          let lastLogAt = Date.now();
          while (this._queue?._tileMonitor?.activeCount > 0 && !this._shouldStop) {
            await this._sleep(500);
            waited += 500;
            if (Date.now() - lastLogAt > SEQ_WAIT_LOG_INTERVAL) {
              console.log(`[EditorExecutor] Sequential mode: đợi ${this._queue._tileMonitor.activeCount} active TileMonitor (${Math.round(waited/1000)}s)`);
              lastLogAt = Date.now();
            }
          }
        }

        // Auto-reload check giữa các items (trước khi dequeue item tiếp)
        if (this._queue?._checkAndPerformReload) {
          try {
            const didReload = await this._queue._checkAndPerformReload();
            if (didReload) {
              // Reset cached settings vì DOM đã bị tạo lại
              this._lastSettings = null;
              // Re-cache DOM settings sau reload
              this._cachedInputTimeout = this._getInputTimeout();
              const reloadSettings = window.storageSettings?.getSettings() || {};
              this._cachedRandomDelayMin = (reloadSettings.randomDelayMin ?? 3) * 1000;
              this._cachedRandomDelayMax = (reloadSettings.randomDelayMax ?? 10) * 1000;
            }
          } catch (reloadErr) {
            console.warn('[EditorExecutor] Auto-reload check failed:', reloadErr.message);
          }
        }

        // Nghỉ giữa các batch (chống ban) — apply cho mọi item (workflow + GenTab + Task).
        // K.12 revert (2026-05-29): KHÔNG skip cho workflow. Anti-ban delay đáng giữ — root
        // cause parallel không chạy là `queue_max_monitor` block, không phải delay này.
        if (batchCount >= this._batchSize && this._queue?.hasItems()) {
          const rest = this._randomBetween(this._restMin, this._restMax);
          await this._sleep(rest);
          batchCount = 0;
        } else if (this._queue?.hasItems()) {
          // Delay ngẫu nhiên giữa các prompt trong cùng batch
          await this._sleep(this._getRandomDelay());
        }
        continue;
      }

      // 2. Không còn submit items → xử lý download queue
      const dlItem = this._queue?.dequeueNextDownload?.();
      if (dlItem) {
        idleSince = 0; // Reset idle timer khi có work
        await this._processDownload(dlItem);
        continue;
      }

      // 3. Không còn gì → kiểm tra TileMonitor
      if (this._hasActiveMonitoring?.()) {
        // Bắt đầu đếm idle nếu chưa
        if (idleSince === 0) {
          idleSince = Date.now();
        } else if (Date.now() - idleSince > MAX_IDLE_POLL_MS) {
          // Kiểm tra nếu TileMonitor vẫn còn monitors đang chạy — không thoát nếu có
          const hasActiveMonitors = this._queue?._tileMonitor?.activeCount > 0;
          if (!hasActiveMonitors) {
            // FIX: Check download queue lần cuối trước khi break
            // TileMonitor có thể đã enqueue downloads ngay trước khi deactivate
            const finalDlCheck = this._queue?.dequeueNextDownload?.();
            if (finalDlCheck) {
              idleSince = 0;
              await this._processDownload(finalDlCheck);
              continue;
            }
            break;
          }
          // Reset idle timer nếu monitors vẫn đang active
          idleSince = Date.now();
        }
        await this._sleep(500);
        continue;
      }
      // FIX: Check download queue lần cuối trước khi break
      // (TileMonitor vừa finish và đã enqueue downloads)
      const lastDlCheck = this._queue?.dequeueNextDownload?.();
      if (lastDlCheck) {
        idleSince = 0;
        await this._processDownload(lastDlCheck);
        continue;
      }
      break;
    }

    this._isRunning = false;
    this._currentItem = null;
    // M8 fix: resolve pending stop() waiters — _runLoop đã thực sự thoát.
    if (this._stopResolvers && this._stopResolvers.length) {
      const resolvers = this._stopResolvers;
      this._stopResolvers = [];
      for (const r of resolvers) { try { r(); } catch (_) { globalThis.SEOSONA_swallow?.('EditorExecutor#_runLoop', _); } }
    }
    if (this._onRunLoopFinished) this._onRunLoopFinished();
  }

  /**
   * Xử lý 1 QueueItem: settings → ref images → clear → insert → submit
   */
  async _processItem(item) {
    const job = this._queue?.getJob(item.jobId);

    // Bỏ qua nếu job đã dừng hoặc bị hủy
    if (!job || job.state === 'stopped') {
      item.state = QueueItem.STATE.CANCELLED;
      return;
    }

    // Chờ nếu job bị tạm dừng (tối đa 5 phút)
    const pauseStart = Date.now();
    const MAX_PAUSE_WAIT = 300000; // 5 minutes
    while (job.state === 'paused' && !this._shouldStop && (Date.now() - pauseStart) < MAX_PAUSE_WAIT) {
      await this._sleep(200);
    }
    if (this._shouldStop || job.state === 'stopped') {
      item.state = QueueItem.STATE.CANCELLED;
      return;
    }
    // M18 fix: sau khi pause-wait TIMEOUT (5 phút), trước đây chỉ check `stopped` → nếu job VẪN
    // 'paused' (user để pause lâu), code submit anyway → gen ngoài ý muốn. Re-check paused: nếu còn
    // paused → KHÔNG submit; requeue item để chờ resume xử lý sau (không cancel, không mất prompt).
    if (job.state === 'paused') {
      console.warn(`[EditorExecutor] Pause wait timeout (5min) but job still paused — requeue item (không submit)`);
      item.state = QueueItem.STATE.PENDING;
      this._queue?.enqueue?.(item);
      return;
    }

    this._currentItem = item;
    item.state = QueueItem.STATE.SUBMITTING;
    item.submittedAt = Date.now();

    try {
      // Nice-to-have anti-bot (2026): đảm bảo Flow là active-tab TRƯỚC khi thao tác DOM mỗi prompt.
      // Google bot-detect khi submit lúc tab nền (visibility hidden). job-start đã activate 1 lần,
      // nhưng user có thể switch tab giữa batch → re-assert per-submit. Best-effort, KHÔNG block submit
      // nếu lỗi/không có Flow tab. KHÔNG focus window (chấp nhận giới hạn window-nền). Handler tự
      // conditional `if(!active)` → không activate thừa. Serial queue → không race tabs.update.
      try {
        const _actRes = await new Promise((r) => chrome.runtime.sendMessage(
          { action: 'activateFlowTabForExecution', tabId: window._targetFlowTabId || null }, (res) => r(res)));
        console.log(`[EditorExecutor] anti-bot: assert Flow active-tab per-prompt → ${_actRes?.ok ? `ok (tab ${_actRes.tabId})` : 'no Flow tab / skip'}`);
      } catch (_) { globalThis.SEOSONA_swallow?.('EditorExecutor#_processItem', _); }

      // Manual mode: đảm bảo ExecutionBlocker overlay UP cho FILL phase (add ref/prompt) — chặn user thao
      // tác nhầm khi SEOSONA Flow đang điền. Wait phase (Step 8) sẽ suspend. Item trước skip để overlay DOWN
      // (resume không re-show) → item này re-show cho fill của nó. Wait phase suspend lại sau.
      if (item.settings?.manualSubmitMode) {
        try { await MessageBridge.sendToContentScript('pq:showBlocker', {}); } catch (_) { globalThis.SEOSONA_swallow?.('EditorExecutor#_processItem', _); }
      }

      // 2026-05-30 REORDER bug fix: applySettings PHẢI chạy SAU khi add ref images.
      // Lý do: Flow render duration option dựa trên ref type (vd ref=video → KHÔNG có
      // duration dropdown → applySettings(duration=...) fail).
      // ORDER: prepareFlowForGen → voice → removeRefs → addRefs → applySettings → clearEditor → insertText → submit.

      // Check pause/stop trước (chưa thay đổi editor)
      if (this._shouldAbortItem(item)) return;

      // 2026-06-02: Step 0 — đóng chat panel + Agent OFF + wait editor ready TRƯỚC mọi action.
      // Lý do: nếu chat panel/Agent UI vẫn chiếm composer area, removeRefs/addRefs/clearEditor
      // sẽ thao tác trên DOM sai (panel header thay vì composer) → ref images add sai chỗ hoặc
      // mất khi panel đóng. prepareFlowForGen guarantee editor ready trước khi tiếp tục.
      try {
        console.log('[EditorExecutor] Step 0: prepareFlowForGen (close chat panel + Agent OFF + wait editor)');
        const prepResult = await MessageBridge.prepareFlowForGen();
        if (prepResult?.actioned) {
          console.log(`[EditorExecutor] Step 0 actioned (editor ready in ${prepResult.editorReadyMs || 0}ms)`);
        }
      } catch (e) {
        console.warn('[EditorExecutor] Step 0 prepareFlowForGen failed (non-blocking):', e.message);
      }

      if (this._shouldAbortItem(item)) return;

      // CLEAR PHASE (2026-06-25): clear MỌI thành phần cũ TRƯỚC khi add. removeExistingRefImages
      // nay clear cả ref + character + voice (cùng row, cùng cancel icon) — chạy đầu để tránh
      // bug "added-then-removed" (clear ref xoá nhầm character/voice vừa add). Phải trước voice/character.
      console.log(`[EditorExecutor] Step 1: clear all prompt chips (ref + character + voice)`);
      await MessageBridge.removeExistingRefImages();
      await this._sleep(200); // Settle delay — DOM update sau khi clear

      // 1.5 Flow Voice Selector — ADD voice mỗi prompt. Clear phase (Step 1) đã xoá voice cũ →
      // KHÔNG dedup "unchanged" nữa (sẽ mất voice ở prompt 2+). Chỉ skip nếu voice notfound
      // (tránh retry vô ích — user cần Resync trong Settings).
      const voicePayload = item.settings?.voice;
      if (voicePayload && voicePayload.search_value) {
        const voiceKey = `${voicePayload.slug || voicePayload.search_value}`;
        if (this._lastVoiceKey === voiceKey + ':notfound') {
          console.log(`[EditorExecutor] Step 1.5: voice "${voiceKey}" đã đánh dấu notfound — skip`);
        } else {
          try {
            console.log(`[EditorExecutor] Step 1.5: selectFlowVoice → ${voicePayload.search_value}`);
            const r = await MessageBridge.selectFlowVoice(voicePayload);
            if (r?.error === 'voice_not_found') {
              console.warn(`[EditorExecutor] Voice "${voicePayload.search_value}" not found in Flow menu — submit without voice`);
              this._lastVoiceKey = voiceKey + ':notfound';
            }
          } catch (e) {
            console.warn(`[EditorExecutor] selectFlowVoice failed (non-blocking):`, e.message);
          }
        }
      }

      // 1.6 Flow Character Selector — ADD character mỗi prompt (độc lập voice, cả image+video).
      // Clear phase (Step 1) đã xoá character cũ → KHÔNG dedup "unchanged". Chỉ skip notfound.
      const characterPayload = item.settings?.character;
      if (characterPayload && characterPayload.search_value) {
        const charKey = `${characterPayload.slug || characterPayload.search_value}`;
        if (this._lastCharacterKey === charKey + ':notfound') {
          console.log(`[EditorExecutor] Step 1.6: character "${charKey}" đã đánh dấu notfound — skip`);
        } else {
          try {
            console.log(`[EditorExecutor] Step 1.6: selectFlowCharacter → ${characterPayload.search_value}`);
            const r = await MessageBridge.selectFlowCharacter(characterPayload);
            if (r?.error === 'character_not_found') {
              console.warn(`[EditorExecutor] Character "${characterPayload.search_value}" not found in Flow menu — submit without character`);
              this._lastCharacterKey = charKey + ':notfound';
            }
          } catch (e) {
            console.warn(`[EditorExecutor] selectFlowCharacter failed (non-blocking):`, e.message);
          }
        }
      }

      // ADD PHASE: ref images đã được clear ở Step 1 (clear phase đầu). Chỉ ADD mới (nếu có).
      if (item.refFileIds?.length > 0) {
        console.log(`[EditorExecutor] Step 2: addRefImages, refFileIds: ${item.refFileIds?.length || 0}`);
        // Xây dựng fileNameMap từ item.refFileNames (direct) + mentionData (fallback)
        const fileNameMap = { ...(item.refFileNames || {}) };
        // Merge mentionData.refImages nếu có (cho @mention mode)
        if (item.mentionData?.refImages) {
          for (const ref of item.mentionData.refImages) {
            if (ref.file_id && ref.file_name && !fileNameMap[ref.file_id]) {
              fileNameMap[ref.file_id] = ref.file_name;
            }
          }
        }
        const addResult = await MessageBridge.addRefImages(item.refFileIds, fileNameMap);
        console.log(`[EditorExecutor] Step 3 result:`, addResult?.success ? 'OK' : 'FAILED', addResult?.failedIds || []);
        // BUG FIX: Check kết quả addRefImages - nếu fail thì KHÔNG tiếp tục submit
        // addRefImages fail thường do tile chưa ready (processing) → submit sẽ crash Flow
        if (!addResult?.success) {
          console.error('[EditorExecutor] addRefImages failed:', addResult?.failedIds, '- aborting item');
          item.state = QueueItem.STATE.FAILED;
          item.error = `Không thể thêm ${addResult?.failedIds?.length || 'một số'} ảnh tham chiếu vào prompt (ảnh chưa sẵn sàng hoặc không tìm thấy)`;
          item.completedAt = Date.now();
          // BUG FIX 2026-05-26: PHẢI notify pipeline (giống nhánh fail cuối trong catch) —
          // trước đó chỉ _emitStateChanged + return → WorkflowExecutor chờ item completion
          // mãi → workflow TREO ("reload Flow xong không làm gì nữa"). _onItemCompleted để
          // job resolve (node failed) → executor tiếp tục/dừng gọn.
          this._queue?._emitStateChanged?.();
          if (this._onItemCompleted) {
            this._onItemCompleted(item);
          }
          return;
        }
      } else {
        console.log(`[EditorExecutor] Step 3: skip addRefImages (no refFileIds)`);
      }

      // Check pause/stop sau khi thêm ref images, trước khi apply settings + insert text
      if (this._shouldAbortItem(item)) return;

      // 3.5: 2026-05-30 REORDER — applySettings SAU khi add refs (TRƯỚC clearEditor + insertText).
      // Lý do: Flow render UI duration option dựa trên ref type. Vd ref=video → KHÔNG có
      // duration dropdown → applySettings(duration) fail nếu chạy trước add ref.
      // _maybeApplySettings idempotent (skip nếu match _lastSettings cache).
      console.log(`[EditorExecutor] Step 3.5: applySettings (after addRefs for correct UI context)`);
      await this._maybeApplySettings(item);

      if (this._shouldAbortItem(item)) return;

      // 4. Xóa nội dung editor hiện tại
      console.log(`[EditorExecutor] Step 4: clearEditor`);
      await MessageBridge.clearEditor();
      await this._sleep(this._getClearEditorDelay());

      // 5. Nhập text prompt vào editor
      console.log(`[EditorExecutor] Step 5: insertText, len: ${item.prompt?.length || 0}`);
      await MessageBridge.insertText(item.prompt);
      await this._sleep(this._getSubmitDelay());

      // Check pause/stop sau khi insert text, trước khi submit
      // Lưu ý: editor đã có text — nếu abort ở đây, editor sẽ bị "bẩn"
      // Cleanup: xóa editor text để không ảnh hưởng lần submit sau
      if (this._shouldAbortItem(item)) {
        // Cleanup editor bẩn
        try { await MessageBridge.clearEditor(); } catch (_) { globalThis.SEOSONA_swallow?.('EditorExecutor#_processItem', _); }
        return;
      }

      // 6. Xác minh Slate model đã nhận text chưa
      console.log(`[EditorExecutor] Step 6: verifySlateModel`);
      const verify = await MessageBridge.verifySlateModel();
      if (!verify?.hasContent) {
        console.log(`[EditorExecutor] Step 6: Slate empty, retry insertText`);
        // Clear editor trước khi retry để tránh duplicate text
        await MessageBridge.clearEditor();
        await this._sleep(this._getClearEditorDelay());
        await MessageBridge.insertText(item.prompt);
        await this._sleep(500);
      }

      // 7. Chụp snapshot tile IDs trước khi submit (baseline cho TileMonitor)
      console.log(`[EditorExecutor] Step 7: getPreTileSnapshot`);
      // SEOSONA tile ownership: reset TRƯỚC snapshot. Item retry (enqueue lại CÙNG object)
      // mang _ownTileIds của lần submit trước; nếu _processItem throw giữa chừng, giá trị cũ còn
      // lại → TileMonitor chặn nhầm tile mới. null = TileMonitor dùng logic cũ.
      item._ownTileIds = null;
      const snapshot = await MessageBridge.getPreTileSnapshot();
      item.preTileIds = snapshot.preTileIds;
      item.preFileNames = snapshot.preFileNames;
      console.log(`[EditorExecutor] Step 7: preTileIds count: ${snapshot.preTileIds?.length || 0}`);

      // 8. Submit — AUTO: SEOSONA Flow tự clickSubmit. MANUAL: user tự nhấn Enter (skip clickSubmit).
      if (item.settings?.manualSubmitMode) {
        console.log('[EditorExecutor] Step 8: MANUAL mode — chờ user nhấn Enter (skip clickSubmit)');
        const ok = await this._waitUserEnterSubmit(item);
        if (!ok) {
          // User bỏ qua / timeout / abort → CANCELLED (KHÔNG phải FAILED). Skip là hành động chủ đích
          // của user, KHÔNG phải gen fail → _onItemCompleted không đếm failedCount, không log flow_fail,
          // không tăng _consecutiveFailCount → tránh trigger consecutive-fail reload (skip 2 lần = reload).
          item.state = QueueItem.STATE.CANCELLED;
          item.completedAt = Date.now();
          if (this._onItemCompleted) this._onItemCompleted(item);
          return;
        }
        // User đã submit (editor-clear + tile-appear detect). KHÔNG cần _getAfterSubmitDelay — tile đã có.
        console.log('[EditorExecutor] Step 8: MANUAL submit detected DONE');
      } else {
        // AUTO: Click nút submit — ĐIỂM KHÔNG THỂ ABORT. Sau click, phải chờ Flow xử lý xong.
        console.log(`[EditorExecutor] Step 8: clickSubmit`);
        await MessageBridge.clickSubmit();
        await this._sleep(this._getAfterSubmitDelay());
        console.log(`[EditorExecutor] Step 8: clickSubmit DONE`);
      }

      // 8b. SEOSONA tile ownership: chốt tile CỦA CHÍNH ITEM NÀY. Vẫn trong vòng tuần tự của
      // start() nên KHÔNG item nào submit xen giữa → tile mới xuất hiện = chắc chắn do submit này
      // sinh ra (Flow render placeholder ngay với đúng tile_id sẽ thành kết quả). Chỉ tin khi bắt
      // ĐỦ quantity; thiếu (render trễ hơn delay) → null → TileMonitor giữ logic cũ.
      try {
        const postSnap = await MessageBridge.getPreTileSnapshot();
        const preSet = new Set(item.preTileIds || []);
        const own = (postSnap?.preTileIds || []).filter(id => !preSet.has(id));
        const qty = parseInt(item.settings?.quantity) || 1;
        item._ownTileIds = own.length >= qty ? own : null;
        console.log(`[EditorExecutor] Step 8b: ownTileIds=${own.length}/${qty} → ${item._ownTileIds ? 'CHỐT' : 'bỏ qua (dùng logic cũ)'}`);
      } catch (e) {
        item._ownTileIds = null;
        console.warn('[EditorExecutor] Step 8b: snapshot lỗi → dùng logic cũ:', e?.message || e);
      }

      // 9. Gán submitOrder (thứ tự submit) cho TileMonitor phân phối tiles deterministic
      item._submitOrder = ++EditorExecutor._submitCounter;

      // 10. Chuyển trạng thái → TileMonitor sẽ theo dõi kết quả
      item.state = QueueItem.STATE.SUBMITTED;
      this._processedCount++;

      // Track flow_prompt_total — mỗi QueueItem = 1 Flow prompt
      EditorExecutor._incrementDailyStat('flow_prompt_total');

      // Thông báo cho TileMonitor nhận item đã submit
      if (this._onItemSubmitted) {
        this._onItemSubmitted(item);
      }

    } catch (err) {
      console.error('[EditorExecutor] Lỗi xử lý item:', err.message);
      item.error = err.message;

      // Thử lại nếu chưa vượt quá số lần cho phép
      if (item.retrySubmitCount < 1) {
        item.retrySubmitCount++;
        item.state = QueueItem.STATE.PENDING;
        item.priority = 100; // Ưu tiên cao cho lần thử lại
        this._queue?.enqueue(item);
      } else {
        item.state = QueueItem.STATE.FAILED;
        item.completedAt = Date.now();
        // Thông báo queue để cập nhật job completion
        if (this._onItemCompleted) {
          this._onItemCompleted(item);
        }
      }
    } finally {
      this._currentItem = null;
    }
  }

  /**
   * Manual Enter mode: SEOSONA Flow đã điền prompt + ref (Steps 1-7). KHÔNG tự submit.
   * Focus Flow tab → hiện banner xanh → chờ user tự nhấn Enter. Detect submit qua
   * editor-clear + tile-appear (content.js handler 'waitUserSubmit', baseline = item.preTileIds).
   * @returns {Promise<boolean>} true = user đã submit; false = skip/timeout/abort.
   */
  async _waitUserEnterSubmit(item) {
    const idx = (item.promptIndex ?? 0) + 1;
    const total = this._queue?.getJob(item.jobId)?.totalExpected || 1;

    // Set status item → FloatingTracker hiện "Chờ Enter"
    item.state = QueueItem.STATE.WAITING_USER;
    try { this._queue?._emitStateChanged?.(); } catch (_) { globalThis.SEOSONA_swallow?.('EditorExecutor#_waitUserEnterSubmit', _); }

    // Focus Flow tab lên foreground để user THẤY editor + nhấn Enter (reuse cơ chế có sẵn).
    // activateFlowTabForExecution tự no-op nếu tab đã active (không churn focus).
    try {
      await new Promise((r) => chrome.runtime.sendMessage(
        { action: 'activateFlowTabForExecution', tabId: window._targetFlowTabId || null, focusWindow: true },
        () => { void chrome.runtime.lastError; r(); }));
    } catch (_) { globalThis.SEOSONA_swallow?.('EditorExecutor#_waitUserEnterSubmit', _); }

    // content.js: hiện banner xanh + poll editor-clear + tile-appear.
    // excludeTileIds = item.preTileIds (baseline đã chụp ở Step 7 — KHÔNG chụp lại).
    let waitDone = false;
    const waitPromise = MessageBridge.sendToContentScript('waitUserSubmit', {
      expectedPrompt: item.prompt,
      excludeTileIds: item.preTileIds || [],
      promptIndex: idx,
      total,
      refCount: item.refFileIds?.length || 0,
      timeoutMs: 0, // 0 = chờ VÔ HẠN (user chủ động nhấn Enter khi nào cũng được)
    }).then((r) => { waitDone = true; return r; })
      .catch((err) => { waitDone = true; console.warn('[EditorExecutor] waitUserSubmit error:', err?.message); return null; });

    // Abort-watcher: user Dừng job (stopJob/stopAll → EditorExecutor.stop() → _shouldStop=true) khi đang
    // chờ Enter → gửi cancelWaitUserSubmit để content.js thoát loop + ẩn banner. content.js sẽ trả
    // { submitted:false, reason:'ABORTED' } → waitPromise resolve.
    // Check CẢ _shouldStop (stopAll) LẪN item.state===CANCELLED (stopJob — item-specific, không bị
    // start() reset _shouldStop=false khi restart cho jobs khác → tránh race bỏ sót abort).
    const _isAborting = () => this._shouldStop || item.state === QueueItem.STATE.CANCELLED;
    const abortWatcher = (async () => {
      while (!_isAborting() && !waitDone) { await this._sleep(300); }
      if (!waitDone && _isAborting()) {
        try { await MessageBridge.sendToContentScript('cancelWaitUserSubmit', {}); } catch (_) { globalThis.SEOSONA_swallow?.('EditorExecutor#abortWatcher', _); }
      }
    })();

    const res = await waitPromise;
    try { await abortWatcher; } catch (_) { globalThis.SEOSONA_swallow?.('EditorExecutor#abortWatcher', _); }
    if (res && res.submitted !== true && res.reason) {
      item.error = 'Manual submit: ' + res.reason;
    }
    // Phase 5 focus-back: node workflow submit xong → đưa cửa sổ workflow editor popup lên foreground.
    // Background focus workflowWindowId nếu còn mở; chạy từ sidebar → id null → no-op.
    if (res?.submitted === true) {
      const job = this._queue?.getJob(item.jobId);
      if (job?.owner === 'workflow') {
        try {
          chrome.runtime.sendMessage({ action: 'focusWorkflowWindow' }, () => { void chrome.runtime.lastError; });
        } catch (_) { globalThis.SEOSONA_swallow?.('EditorExecutor#abortWatcher', _); }
      }
    }
    return res?.submitted === true;
  }

  /**
   * Áp dụng settings chỉ khi khác với lần cuối
   * Tiết kiệm ~1.8s mỗi lần không cần chuyển đổi
   *
   * CRITICAL: KHÔNG cache genType vì user có thể thay đổi Flow thủ công.
   * Nếu user đang ở Video mode, gửi /image → cache nghĩ đã là Image → skip → BUG!
   * Luôn gọi applySettings khi genType được chỉ định để đảm bảo đúng mode.
   */
  async _maybeApplySettings(item) {
    const needed = item.settings;
    if (!needed) return;

    console.log(`[EditorExecutor] _maybeApplySettings: needed.isFrames=${needed.isFrames}, needed.genType=${needed.genType}`);
    console.log(`[EditorExecutor] _lastSettings:`, this._lastSettings);

    // CRITICAL: Luôn apply nếu genType được chỉ định
    // User có thể tự thay đổi Flow mode, cache không thể detect được
    const mustApplyGenType = !!needed.genType;

    // Chỉ skip nếu:
    // 1. Không cần apply genType (không có genType trong settings)
    // 2. VÀ tất cả settings khác giống nhau
    if (!mustApplyGenType &&
        this._lastSettings &&
        this._lastSettings.ratio === needed.ratio &&
        this._lastSettings.model === needed.model &&
        this._lastSettings.isFrames === (needed.isFrames || false) &&
        this._lastSettings.quantity === needed.quantity &&
        this._lastSettings.flowVideoDuration === (needed.flowVideoDuration || null)) {
      console.log(`[EditorExecutor] Settings unchanged (no genType), skipping applySettings`);
      return; // Settings giống nhau — bỏ qua
    }

    // Gọi MessageBridge với đúng chữ ký hàm
    console.log(`[EditorExecutor] Calling applySettings: genType=${needed.genType}, ratio=${needed.ratio}, model=${needed.model}, isFrames=${needed.isFrames}, quantity=${needed.quantity}, flowVideoDuration=${needed.flowVideoDuration}`);
    await MessageBridge.applySettings(
      needed.genType,
      needed.ratio,
      needed.model,
      needed.isFrames || false,
      needed.quantity || 1,
      needed.flowVideoDuration || null
    );
    // Normalize trước khi cache để tránh undefined !== false khi so sánh lần sau
    // NOTE: Cache vẫn lưu genType để log, nhưng KHÔNG dùng để so sánh skip
    this._lastSettings = {
      genType: needed.genType,
      ratio: needed.ratio,
      model: needed.model,
      isFrames: needed.isFrames || false,
      quantity: needed.quantity || 1,
      flowVideoDuration: needed.flowVideoDuration || null,
    };
  }

  /**
   * Kiểm tra nếu item cần abort (job stopped hoặc pipeline stopped)
   * Gọi giữa các bước trong _processItem để giảm "thời gian không thể dừng"
   * @returns {boolean} true nếu đã abort item
   */
  _shouldAbortItem(item) {
    // Pipeline stopped
    if (this._shouldStop) {
      item.state = QueueItem.STATE.CANCELLED;
      this._currentItem = null;
      return true;
    }

    // Job stopped
    const job = this._queue?.getJob(item.jobId);
    if (!job || job.state === 'stopped') {
      item.state = QueueItem.STATE.CANCELLED;
      this._currentItem = null;
      return true;
    }

    return false;
  }

  /**
   * Xử lý 1 download item: gọi content.js downloadTileMedia
   * Chạy tuần tự trong cùng pipeline với submit → không xung đột context menu
   */
  async _processDownload(dlItem) {
    this._isDownloading = true;
    console.log(`[EditorExecutor] _processDownload: tileId=${dlItem.tileId?.substring(0, 20)}, fileName=${dlItem.fileName?.substring(0, 12) || 'null'}, index=${dlItem.index || 'null'}`);

    // Track download item cho UI
    this._queue?.setCurrentDownload?.({
      tileId: dlItem.tileId,
      promptText: dlItem.promptText,
      state: 'DOWNLOADING',
      jobId: dlItem.jobId,
    });

    try {
      // Timeout 45s: _waitForTileMediaReady (10s) + right-click menu (5s) + download (30s buffer)
      const downloadPromise = MessageBridge.sendToContentScript('downloadTileMedia', {
        tileId: dlItem.tileId,
        promptText: dlItem.promptText,
        taskName: dlItem.taskName || null,
        fileName: dlItem.fileName,
        flowFileId: dlItem.flowFileId || null,
        resolution: dlItem.resolution || null,
        index: dlItem.index || null, // FIX: Truyền index để tránh filename collision
      });
      // Port 1.1.58: video phân giải cao chờ Google process lâu → timeout riêng 300s (ảnh giữ 45s).
      // Detect defensive: cờ isVideo/_isVideo trên dlItem HOẶC đuôi file video. Hardcode 45s cũ làm
      // mất file video hợp lệ >45s.
      const _isVideoDl = !!(dlItem.isVideo || dlItem._isVideo) || /\.(mp4|webm|mov|m4v)$/i.test(dlItem.fileName || '');
      const _dlTimeoutMs = _isVideoDl ? 300000 : 45000;
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Download timeout')), _dlTimeoutMs)
      );
      const resp = await Promise.race([downloadPromise, timeoutPromise]);

      if (!resp || resp?.error) {
        console.warn('[EditorExecutor] Download failed:', dlItem.tileId, resp?.error || 'no response');
        this._queue?.markDownloadFailed?.(dlItem.tileId, resp?.error || 'no response');
      } else {
        this._queue?.markDownloadCompleted?.(dlItem.tileId);
      }

      // Settle delay giữa các downloads
      await this._sleep(200);
    } catch (err) {
      console.error('[EditorExecutor] Download error:', err.message);
      this._queue?.markDownloadFailed?.(dlItem.tileId, err.message);
    } finally {
      this._isDownloading = false;
    }
  }

  // --- Timing helpers (tính từ inputTimeout) ---

  _getInputTimeout() {
    return window.storageSettings?.getSettings()?.inputTimeout || 1200;
  }

  _getClearEditorDelay() {
    const timeout = this._cachedInputTimeout ?? this._getInputTimeout();
    return Math.round(timeout * 0.4);
  }

  _getSubmitDelay() {
    const timeout = this._cachedInputTimeout ?? this._getInputTimeout();
    return Math.round(timeout * 0.5);
  }

  _getAfterSubmitDelay() {
    const timeout = this._cachedInputTimeout ?? this._getInputTimeout();
    return Math.round(timeout * 0.8);
  }

  _getRandomDelay() {
    if (this._cachedRandomDelayMin == null || this._cachedRandomDelayMax == null) {
      const settings = window.storageSettings?.getSettings() || {};
      this._cachedRandomDelayMin = (settings.randomDelayMin ?? 3) * 1000;
      this._cachedRandomDelayMax = (settings.randomDelayMax ?? 10) * 1000;
    }
    return this._randomBetween(this._cachedRandomDelayMin, this._cachedRandomDelayMax);
  }

  _randomBetween(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  _sleep(ms) {
    return new Promise(resolve => {
      this._sleepResolve = resolve;
      this._sleepTimer = setTimeout(() => {
        this._sleepResolve = null;
        resolve();
      }, ms);
    });
  }

  _interruptSleep() {
    if (this._sleepTimer) {
      clearTimeout(this._sleepTimer);
      this._sleepTimer = null;
    }
    if (this._sleepResolve) {
      this._sleepResolve();
      this._sleepResolve = null;
    }
  }

  // --- Điều khiển thực thi ---

  pause() {
    this._isPaused = true;
  }

  resume() {
    this._isPaused = false;
  }

  /**
   * Dừng vòng lặp. M8 fix: trả về Promise resolve khi _runLoop đã THỰC SỰ thoát,
   * để caller (PromptQueue.stopJob) await trước khi start() lại — tránh reset _shouldStop=false
   * trước khi loop parked quan sát cờ → spin _runLoop thứ hai (dequeue đôi).
   * @returns {Promise<void>}
   */
  stop() {
    this._shouldStop = true;
    this._isPaused = false;
    this._interruptSleep();
    // Nếu loop không chạy → đã thoát rồi, resolve ngay.
    if (!this._isRunning) return Promise.resolve();
    if (!this._stopResolvers) this._stopResolvers = [];
    return new Promise(resolve => { this._stopResolvers.push(resolve); });
  }

  /**
   * Đặt lại trạng thái cho lần chạy mới
   */
  reset() {
    this._processedCount = 0;
    this._lastSettings = null;
    this._currentItem = null;
  }

  // --- Getters cho UI ---

  get state() {
    if (!this._isRunning) return 'idle';
    if (this._isPaused) return 'paused';
    if (this._currentItem) return 'submitting';
    return 'running';
  }

  get currentItem() {
    return this._currentItem;
  }

  get processedCount() {
    return this._processedCount;
  }

  get isRunning() {
    return this._isRunning;
  }

  /**
   * Increment daily stat counter — cho settings-popup display
   * Track tất cả usage locally bất kể plan (giống content.js _incrementDailyStat)
   */
  // Bộ đếm thứ tự submit — dùng cho TileMonitor claiming theo submitOrder
  static _submitCounter = 0;

  static _incrementDailyStat(key, amount = 1) {
    // Serialize qua promise chain để tránh race condition khi nhiều submits gọi
    // increment liên tiếp trong vài ms — chrome.storage.local.get/set KHÔNG atomic, race
    // window get → modify → set khiến counter mất count khi concurrent access.
    EditorExecutor._statQueue = (EditorExecutor._statQueue || Promise.resolve()).then(async () => {
      const today = new Date().toISOString().slice(0, 10);
      const currentUserId = ({ id: 'local_user', name: 'Local User', plan_slug: 'pro' })?.id || null;
      const res = await new Promise(resolve => chrome.storage.local.get(['af_daily_stats'], resolve));
      const stats = res.af_daily_stats || {};
      // Reset if new day OR different user
      if (stats._date !== today || stats._user_id !== currentUserId) {
        stats._date = today;
        stats._user_id = currentUserId;
        // Provider-specific prompts
        stats.flow_prompt_total = 0;
        stats.chatgpt_prompt_total = 0;
        stats.gemini_prompt_total = 0;
        stats.grok_prompt_total = 0;
        // Provider-specific failures
        stats.flow_fail = 0;
        stats.chatgpt_fail = 0;
        stats.gemini_fail = 0;
        stats.grok_fail = 0;
        // Common stats
        stats.task_run = 0;
        stats.workflow_run = 0;
        stats.angles_run = 0;
      }
      stats[key] = (stats[key] || 0) + amount;
      await new Promise(resolve => chrome.storage.local.set({ af_daily_stats: stats }, resolve));
    }).catch(err => {
      console.warn('[EditorExecutor] _incrementDailyStat error:', err.message);
    });
  }
}
