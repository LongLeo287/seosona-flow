/**
 * QueueMonitor — Sub-tab trong Logs hiển thị chi tiết Pipeline Queue
 *
 * Dirty Flag + Direct DOM Refs + RAF Batching pattern:
 * - Mỗi job/item tạo DOM 1 lần, update chỉ khi data thay đổi
 * - requestAnimationFrame batch tất cả renders
 * - Chỉ render khi sub-tab đang active
 */
class QueueMonitor {
  static _instance = null;

  static init() {
    if (!this._instance) {
      this._instance = new QueueMonitor();
    }
    return this._instance;
  }

  static getInstance() {
    return this._instance;
  }

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  static OWNER_COLORS = {
    prompts:  { bg: '#3b82f6', label: 'Gen' },
    task:     { bg: '#f97316', label: 'Task' },
    workflow: { bg: '#a855f7', label: 'Flow' },
    angles:   { bg: '#ec4899', label: 'Angles' },
    telegram: { bg: '#06b6d4', label: 'Telegram' },
    download: { bg: '#06b6d4', label: 'Download' },
  };

  static DOWNLOAD_STATES = {
    PENDING:     { icon: '\u25CB', colorClass: 'seosonaflow-queue-state--muted',  get label() { return window.I18n?.t('queue.downloadPending') || 'Chờ tải'; } },
    DOWNLOADING: { icon: '\u2B07', colorClass: 'seosonaflow-queue-state--blue',   get label() { return window.I18n?.t('queue.downloadActive') || 'Đang tải'; } },
    COMPLETED:   { icon: '\u2713', colorClass: 'seosonaflow-queue-state--green',  get label() { return window.I18n?.t('queue.downloadCompleted') || 'Xong'; } },
    FAILED:      { icon: '\u2717', colorClass: 'seosonaflow-queue-state--red',    get label() { return window.I18n?.t('queue.downloadFailed') || 'Lỗi'; } },
  };

  // Realtime phase labels từ TileMonitor (override item.state khi có phase active)
  static PHASE_LABELS = {
    monitoring:     { colorClass: 'seosonaflow-queue-state--yellow', get label() { return window.I18n?.t('queue.phaseMonitoring')   || 'Chờ kết quả'; } },
    fail_detected:  { colorClass: 'seosonaflow-queue-state--red',    get label() { return window.I18n?.t('queue.phaseFailDetected')|| 'Phát hiện fail'; } },
    click_retry:    { colorClass: 'seosonaflow-queue-state--orange', get label() { return window.I18n?.t('queue.phaseClickRetry')  || 'Đang click retry'; } },
    wait_retry:     { colorClass: 'seosonaflow-queue-state--orange', get label() { return window.I18n?.t('queue.phaseWaitRetry')   || 'Đã click, chờ tile'; } },
    retry_skipped:  { colorClass: 'seosonaflow-queue-state--muted',  get label() { return window.I18n?.t('queue.phaseRetrySkipped')|| 'Bỏ qua click (đã click trước)'; } },
    tier2_reload:   { colorClass: 'seosonaflow-queue-state--purple', get label() { return window.I18n?.t('queue.phaseTier2Reload') || 'Reload Flow'; } },
    tier2_resubmit: { colorClass: 'seosonaflow-queue-state--purple', get label() { return window.I18n?.t('queue.phaseTier2Resubmit')|| 'Submit lại'; } },
    // ChatGPT/Grok generation phases (from WorkflowExecutor)
    prompt_enhancing:   { colorClass: 'seosonaflow-queue-state--blue',   get label() { return window.I18n?.t('exec.enhancingPrompt')   || 'Cải tiến prompt...'; } },
    chatgpt_generating: { colorClass: 'seosonaflow-queue-state--blue',   get label() { return window.I18n?.t('exec.chatgptGenerating') || 'ChatGPT generating...'; } },
    grok_generating:    { colorClass: 'seosonaflow-queue-state--blue',   get label() { return window.I18n?.t('exec.grokGenerating')    || 'Grok generating...'; } },
    completed:      { colorClass: 'seosonaflow-queue-state--green',  get label() { return window.I18n?.t('queue.itemCompleted')    || 'Hoàn tất'; } },
    failed:         { colorClass: 'seosonaflow-queue-state--red',    get label() { return window.I18n?.t('queue.itemFailed')       || 'Lỗi'; } },
    partial_fail:   { colorClass: 'seosonaflow-queue-state--yellow', get label() { return window.I18n?.t('queue.itemPartialFail')  || 'Một phần lỗi'; } },
  };

  static ITEM_STATES = {
    PENDING:       { icon: '\u25CB', colorClass: 'seosonaflow-queue-state--muted',   get label() { return window.I18n?.t('queue.itemPending') || 'Chờ'; } },
    SUBMITTING:    { icon: '\u25B6', colorClass: 'seosonaflow-queue-state--blue',    get label() { return window.I18n?.t('queue.itemSubmitting') || 'Đang gửi'; } },
    SUBMITTED:     { icon: '\u25C9', colorClass: 'seosonaflow-queue-state--blue-l',  get label() { return window.I18n?.t('queue.itemSubmitted') || 'Đã gửi'; } },
    MONITORING:    { icon: '\u231B', colorClass: 'seosonaflow-queue-state--yellow',  get label() { return window.I18n?.t('queue.itemMonitoring') || 'Chờ kết quả'; } },
    RETRY_SUBMIT:  { icon: '\u21BB', colorClass: 'seosonaflow-queue-state--orange',  get label() { return window.I18n?.t('queue.itemRetry') || 'Thử lại'; } },
    COMPLETED:     { icon: '\u2713', colorClass: 'seosonaflow-queue-state--green',   get label() { return window.I18n?.t('queue.itemCompleted') || 'Hoàn tất'; } },
    PARTIAL_FAIL:  { icon: '\u26A0', colorClass: 'seosonaflow-queue-state--yellow',  get label() { return window.I18n?.t('queue.itemPartialFail') || 'Một phần lỗi'; } },
    FAILED:        { icon: '\u2717', colorClass: 'seosonaflow-queue-state--red',     get label() { return window.I18n?.t('queue.itemFailed') || 'Lỗi'; } },
    CANCELLED:     { icon: '\u2298', colorClass: 'seosonaflow-queue-state--muted',   get label() { return window.I18n?.t('queue.itemCancelled') || 'Hủy'; } },
  };

  constructor() {
    this._container = document.getElementById('queueMonitorContent');
    this._isVisible = false;
    this._snapshot = null;
    this._rafId = null;
    this._dirty = false;

    // DOM refs cache — persistent elements
    this._jobElements = new Map();  // jobId → { el, headerEl, bodyEl, itemEls: Map, ... }
    this._statusCardsEl = null;
    this._emptyStateEl = null;
    this._jobsContainerEl = null;
    this._downloadSectionEl = null; // Download section container
    this._downloadItemEls = new Map(); // tileId → { el, ... }

    // UI history: cache completed/stopped jobs để không mất khi PromptQueue._clearCompletedJobs()
    this._completedJobsCache = new Map(); // jobId → job snapshot (max 20)

    // Cache download history từ external snapshot (không mất khi TTL expire)
    this._cachedDownloadHistory = []; // max 20 items

    // External jobs từ popup windows (workflow, angles) via chrome.runtime broadcast
    this._externalSnapshot = null;
    this._externalTimestamp = 0;

    // Per-item realtime status từ TileMonitor (phase: monitoring/fail_detected/click_retry/...)
    // Map<itemId, { phase, attempt, maxRetries, successCount, failedCount, text, timestamp }>
    this._itemStatus = new Map();

    // Create structure
    this._createDOM();

    // Listen to queue events
    this._bindEvents();
  }

  // ---------------------------------------------------------------------------
  // DOM Creation (once)
  // ---------------------------------------------------------------------------

  _createDOM() {
    if (!this._container) return;

    this._container.innerHTML = '';

    // Status cards row
    this._statusCardsEl = document.createElement('div');
    this._statusCardsEl.className = 'seosonaflow-queue-status-cards';
    this._statusCardsEl.innerHTML = `
      <div class="seosonaflow-queue-status-card" data-executor="editor">
        <div class="seosonaflow-queue-status-card__icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 0 0 -3 3v12a3 3 0 0 0 3 3"></path><path d="M6 3a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3"></path><path d="M13 7h7a1 1 0 0 1 1 1v8a1 1 0 0 1 -1 1h-7"></path><path d="M5 7h-1a1 1 0 0 0 -1 1v8a1 1 0 0 0 1 1h1"></path><path d="M17 12h.01"></path><path d="M13 12h.01"></path></svg>
        </div>
        <div class="seosonaflow-queue-status-card__info">
          <span class="seosonaflow-queue-status-card__label">Editor</span>
          <span class="seosonaflow-queue-status-card__value" data-field="editor-state">-</span>
        </div>
      </div>
      <div class="seosonaflow-queue-status-card" data-executor="tiles">
        <div class="seosonaflow-queue-status-card__icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect></svg>
        </div>
        <div class="seosonaflow-queue-status-card__info">
          <span class="seosonaflow-queue-status-card__label">Tiles</span>
          <span class="seosonaflow-queue-status-card__value" data-field="tiles-state">-</span>
        </div>
      </div>
      <div class="seosonaflow-queue-status-card" data-executor="download">
        <div class="seosonaflow-queue-status-card__icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
        </div>
        <div class="seosonaflow-queue-status-card__info">
          <span class="seosonaflow-queue-status-card__label">Download</span>
          <span class="seosonaflow-queue-status-card__value" data-field="download-state">-</span>
        </div>
      </div>
    `;
    this._container.appendChild(this._statusCardsEl);

    // Cache status card value refs
    this._editorStateEl = this._statusCardsEl.querySelector('[data-field="editor-state"]');
    this._tilesStateEl = this._statusCardsEl.querySelector('[data-field="tiles-state"]');
    this._downloadStateEl = this._statusCardsEl.querySelector('[data-field="download-state"]');

    // Jobs container
    this._jobsContainerEl = document.createElement('div');
    this._jobsContainerEl.className = 'seosonaflow-queue-jobs';
    this._container.appendChild(this._jobsContainerEl);

    // Download section
    this._downloadSectionEl = document.createElement('div');
    this._downloadSectionEl.className = 'seosonaflow-queue-job seosonaflow-queue-download-section';
    this._downloadSectionEl.style.display = 'none';
    this._downloadSectionEl.innerHTML = `
      <div class="seosonaflow-queue-job__header">
        <span class="seosonaflow-queue-job__owner-dot" style="background:#06b6d4"></span>
        <span class="seosonaflow-queue-job__label">Auto Download</span>
        <span class="seosonaflow-queue-job__badge seosonaflow-queue-job__badge--running"></span>
        <span class="seosonaflow-queue-job__counter"></span>
        <span class="seosonaflow-queue-job__elapsed"></span>
        <button class="seosonaflow-queue-job__toggle" title="${window.I18n?.t('queue.expand') || 'Mở rộng'} / ${window.I18n?.t('queue.collapse') || 'Thu nhỏ'}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>
      <div class="seosonaflow-queue-job__progress">
        <div class="seosonaflow-queue-job__progress-fill" style="background:#06b6d4"></div>
      </div>
      <div class="seosonaflow-queue-job__body">
        <div class="seosonaflow-queue-items seosonaflow-queue-download-items"></div>
      </div>
    `;
    // Toggle accordion
    const dlHeader = this._downloadSectionEl.querySelector('.seosonaflow-queue-job__header');
    dlHeader.addEventListener('click', () => {
      this._downloadSectionEl.classList.toggle('seosonaflow-queue-job--expanded');
    });
    this._container.appendChild(this._downloadSectionEl);

    // Cache download section refs
    this._dlBadgeEl = this._downloadSectionEl.querySelector('.seosonaflow-queue-job__badge');
    this._dlCounterEl = this._downloadSectionEl.querySelector('.seosonaflow-queue-job__counter');
    this._dlProgressFill = this._downloadSectionEl.querySelector('.seosonaflow-queue-job__progress-fill');
    this._dlItemsEl = this._downloadSectionEl.querySelector('.seosonaflow-queue-download-items');

    // Empty state
    this._emptyStateEl = document.createElement('div');
    this._emptyStateEl.className = 'queue-empty-hero';
    this._emptyStateEl.innerHTML = `
      <div class="wf-empty-hero-icon">
        <div class="wf-empty-glow"></div>
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          <line x1="3" y1="9" x2="21" y2="9"></line>
          <line x1="9" y1="21" x2="9" y2="9"></line>
        </svg>
      </div>
      <h3 class="workflow-empty-title">Hàng Đợi Xử Lý Tự Động</h3>
      <p class="workflow-empty-subtitle">Các tác vụ sinh ảnh, video và tải xuống sẽ tự động xếp hàng và thực thi tại đây.</p>
      <div class="wf-empty-pills">
        <span class="wf-empty-pill">⚡ Tải Xuất Tự Động</span>
        <span class="wf-empty-pill">🔄 Khôi Phục Lỗi</span>
        <span class="wf-empty-pill">📊 Theo Dõi Tiến Trình</span>
      </div>
    `;
    this._container.appendChild(this._emptyStateEl);
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  _bindEvents() {
    if (!window.eventBus) return;

    window.eventBus.on('queue:state_changed', (snapshot) => {
      this._snapshot = snapshot;
      this._dirty = true;
      this._scheduleRender();
    });

    // Nhận external state từ popup windows (workflow, angles)
    window.eventBus.on('queue:external_state', (snapshot) => {
      this._externalSnapshot = snapshot;
      this._externalTimestamp = Date.now();
      this._dirty = true;
      this._scheduleRender();
    });

    // Per-item realtime status từ TileMonitor (retry phases, tier2 fallback, ...)
    window.eventBus.on('item:status', (data) => {
      if (!data?.itemId) return;
      this._itemStatus.set(data.itemId, data);
      this._dirty = true;
      this._scheduleRender();

      // Auto-cleanup terminal phases sau 60s (giữ UX hiển thị final state)
      if (['completed', 'failed', 'partial_fail'].includes(data.phase)) {
        setTimeout(() => {
          const cur = this._itemStatus.get(data.itemId);
          if (cur && cur.timestamp === data.timestamp) {
            this._itemStatus.delete(data.itemId);
          }
        }, 60000);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Visibility
  // ---------------------------------------------------------------------------

  setVisible(visible) {
    this._isVisible = visible;
    if (visible && this._dirty) {
      this._scheduleRender();
    }

    // Start/stop elapsed timer
    if (visible) {
      this._startElapsedTimer();
    } else {
      this._stopElapsedTimer();
    }
  }

  _startElapsedTimer() {
    if (this._elapsedInterval) return;
    this._elapsedInterval = setInterval(() => {
      // Check cả external snapshot cho jobs từ popup windows
      const localJobs = this._snapshot?.jobs || [];
      const externalJobs = (this._externalSnapshot && this._externalTimestamp > Date.now() - 30000)
        ? this._externalSnapshot.jobs || [] : [];
      const jobs = localJobs.length > 0 ? localJobs : externalJobs;
      if (jobs.length === 0) return;
      for (const job of jobs) {
        const isActive = job.status === 'running' || job.status === 'paused';
        if (!isActive || !job.startedAt) continue;
        const refs = this._jobElements.get(job.id);
        if (refs && refs.elapsedEl) {
          refs.elapsedEl.textContent = this._formatTime(Date.now() - job.startedAt);
        }
      }
    }, 1000);
  }

  _stopElapsedTimer() {
    if (this._elapsedInterval) {
      clearInterval(this._elapsedInterval);
      this._elapsedInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // RAF Batching
  // ---------------------------------------------------------------------------

  _scheduleRender() {
    if (!this._isVisible || this._rafId) return;
    this._rafId = requestAnimationFrame(() => {
      this._rafId = null;
      this._render();
    });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  _render() {
    // Check external snapshot nếu local snapshot null (jobs từ popup windows)
    const hasExternalJobs = this._externalSnapshot && this._externalTimestamp > Date.now() - 30000 &&
                            this._externalSnapshot.jobs?.length > 0;

    if (!this._container || (!this._snapshot && !hasExternalJobs)) {
      this._showEmpty(true);
      return;
    }
    this._dirty = false;

    // Fallback to minimal snapshot nếu chỉ có external jobs
    // Sử dụng external snapshot's pipeline info nếu local không có
    const localSnap = this._snapshot;
    const extSnap = hasExternalJobs ? this._externalSnapshot : null;
    const snap = localSnap || { jobs: [], pipeline: extSnap?.pipeline || { editor: {}, tileMonitor: {}, download: {} } };

    // Update status cards (prefer external pipeline info khi local trống)
    const pipelineInfo = (localSnap?.pipeline?.editor?.state) ? localSnap.pipeline : (extSnap?.pipeline || {});
    this._updateStatusCards(pipelineInfo);

    // Merge external jobs từ popup windows (workflow, angles)
    // External snapshot expire sau 30 giây (tránh hiển thị stale data khi popup đóng)
    let externalJobs = [];
    if (this._externalSnapshot && this._externalTimestamp > Date.now() - 30000) {
      externalJobs = this._externalSnapshot.jobs || [];
    } else {
      this._externalSnapshot = null; // Clear expired
    }

    // Merge: local snapshot jobs + external jobs (ưu tiên local nếu trùng id)
    const localJobs = snap.jobs || [];
    const localJobIds = new Set(localJobs.map(j => j.id));
    const mergedSnapshotJobs = [
      ...localJobs,
      ...externalJobs.filter(j => !localJobIds.has(j.id)),
    ];

    // Merge: snapshot jobs (live) + cached completed jobs (history)
    const snapshotJobs = mergedSnapshotJobs;
    const snapshotJobIds = new Set(snapshotJobs.map(j => j.id));

    // Pipeline hoàn toàn rỗng (không còn job nào) → clear cache history
    if (snapshotJobs.length === 0 && this._completedJobsCache.size > 0) {
      this._completedJobsCache.clear();
      this._cachedDownloadHistory = []; // Clear download cache cùng lúc
      // Clear realtime phase status cũng (tránh memory leak)
      this._itemStatus.clear();
    }

    // Cache completed/stopped jobs trước khi chúng bị xóa khỏi snapshot
    for (const job of snapshotJobs) {
      if (job.status === 'completed' || job.status === 'stopped') {
        this._completedJobsCache.set(job.id, job);
      }
    }

    // Trim cache nếu quá 20 entries (xóa cũ nhất)
    if (this._completedJobsCache.size > 20) {
      const entries = Array.from(this._completedJobsCache.entries());
      const toRemove = entries.slice(0, entries.length - 20);
      for (const [id] of toRemove) this._completedJobsCache.delete(id);
    }

    // Build merged list: snapshot jobs + cached completed (không trùng)
    const jobs = [...snapshotJobs];
    for (const [cachedId, cachedJob] of this._completedJobsCache) {
      if (!snapshotJobIds.has(cachedId)) {
        jobs.push(cachedJob);
      }
    }

    if (jobs.length === 0) {
      this._showEmpty(true);
      this._jobsContainerEl.innerHTML = '';
      this._jobElements.clear();
      return;
    }

    this._showEmpty(false);

    // Track which jobs still exist (live + cached)
    const currentJobIds = new Set(jobs.map(j => j.id));

    // Remove stale job elements
    for (const [jobId, refs] of this._jobElements) {
      if (!currentJobIds.has(jobId)) {
        refs.el.remove();
        this._jobElements.delete(jobId);
      }
    }

    // Create/update job elements
    jobs.forEach((job, idx) => {
      let refs = this._jobElements.get(job.id);
      if (!refs) {
        refs = this._createJobElement(job);
        this._jobElements.set(job.id, refs);
        this._jobsContainerEl.appendChild(refs.el);
      }
      this._updateJobElement(refs, job);
    });

    // Build merged download data (local + external + cache)
    const downloadData = this._buildMergedDownloadData(snap.pipeline?.download, extSnap?.pipeline?.download);

    // Render download section
    this._renderDownloadSection(downloadData);
  }

  /**
   * Merge download data từ local snapshot, external snapshot, và cache
   * Cache completed downloads để không mất khi external TTL expire
   */
  _buildMergedDownloadData(localDl, extDl) {
    // Lấy source chính (prefer local nếu có data)
    const primary = (localDl?.queueLength > 0 || localDl?.completedCount > 0) ? localDl : extDl;
    if (!primary && this._cachedDownloadHistory.length === 0) return null;

    // Cache completed downloads từ cả local và external
    const allItems = [
      ...(localDl?.items || []),
      ...(extDl?.items || []),
    ];
    for (const item of allItems) {
      if (item.state === 'COMPLETED' || item.state === 'FAILED') {
        // Dedup by tileId
        if (!this._cachedDownloadHistory.some(h => h.tileId === item.tileId)) {
          this._cachedDownloadHistory.push(item);
        }
      }
    }
    // Trim cache (max 20)
    if (this._cachedDownloadHistory.length > 20) {
      this._cachedDownloadHistory = this._cachedDownloadHistory.slice(-20);
    }

    // Merge items: pending + current + history (cache)
    const pendingItems = allItems.filter(i => i.state === 'PENDING' || !i.state);
    const currentItem = allItems.find(i => i.state === 'DOWNLOADING');
    const mergedItems = [
      ...pendingItems.slice(0, 10),
      ...(currentItem ? [currentItem] : []),
      ...this._cachedDownloadHistory.slice(-10),
    ];

    return {
      state: primary?.state || (this._cachedDownloadHistory.length > 0 ? 'idle' : 'idle'),
      queueLength: (localDl?.queueLength || 0) + (extDl?.queueLength || 0),
      completedCount: Math.max(localDl?.completedCount || 0, extDl?.completedCount || 0, this._cachedDownloadHistory.length),
      items: mergedItems,
    };
  }

  // ---------------------------------------------------------------------------
  // Status Cards
  // ---------------------------------------------------------------------------

  _updateStatusCards(pipeline) {
    if (!pipeline) return;

    // Editor
    const editorText = this._executorStateText(pipeline.editor.state);
    const editorExtra = pipeline.editor.processedCount > 0
      ? ` (${pipeline.editor.processedCount})`
      : '';
    this._editorStateEl.textContent = editorText + editorExtra;

    // Tiles
    const active = pipeline.tileMonitor.activeCount || 0;
    const completed = pipeline.tileMonitor.completedCount || 0;
    const failed = pipeline.tileMonitor.failedCount || 0;
    this._tilesStateEl.textContent = window.I18n?.t('queue.activeCount', { active, completed, failed }) || `${active} đang / ${completed} xong / ${failed} lỗi`;

    // Download
    const dlText = this._executorStateText(pipeline.download.state);
    const dlExtra = pipeline.download.completedCount > 0
      ? ` (${pipeline.download.completedCount})`
      : '';
    this._downloadStateEl.textContent = dlText + dlExtra;
  }

  _executorStateText(state) {
    const map = {
      idle: window.I18n?.t('queue.executorIdle') || 'Ready',
      running: window.I18n?.t('exec.running') || 'Running',
      paused: window.I18n?.t('common.pause') || 'Paused',
      stopped: window.I18n?.t('common.stop') || 'Stopped',
      queued: window.I18n?.t('queue.downloadPending') || 'Queued',
      downloading: window.I18n?.t('queue.executorDownloading') || 'Downloading...',
    };
    return map[state] || state || '-';
  }

  // ---------------------------------------------------------------------------
  // Download Section
  // ---------------------------------------------------------------------------

  _renderDownloadSection(downloadData) {
    if (!this._downloadSectionEl) return;

    const items = downloadData?.items || [];
    const queueLen = downloadData?.queueLength || 0;
    const completedCount = downloadData?.completedCount || 0;
    const hasContent = items.length > 0 || completedCount > 0;

    // Ẩn/hiện section
    this._downloadSectionEl.style.display = hasContent ? '' : 'none';
    if (!hasContent) return;

    // Badge
    const stateText = this._executorStateText(downloadData.state);
    if (this._dlBadgeEl.textContent !== stateText) {
      this._dlBadgeEl.textContent = stateText;
      this._dlBadgeEl.className = 'seosonaflow-queue-job__badge seosonaflow-queue-job__badge--' +
        (downloadData.state === 'downloading' ? 'running' : downloadData.state === 'idle' ? 'completed' : 'running');
    }

    // Counter
    const total = completedCount + queueLen;
    const counterText = total > 0 ? `${completedCount}/${total}` : '';
    if (this._dlCounterEl.textContent !== counterText) {
      this._dlCounterEl.textContent = counterText;
    }

    // Progress bar
    const pct = total > 0 ? Math.round((completedCount / total) * 100) : 0;
    this._dlProgressFill.style.width = `${pct}%`;

    // Items — only render if expanded
    if (!this._downloadSectionEl.classList.contains('seosonaflow-queue-job--expanded')) return;

    // Track current item keys
    const currentKeys = new Set(items.map(d => d.tileId));

    // Remove stale
    for (const [tid, ref] of this._downloadItemEls) {
      if (!currentKeys.has(tid)) {
        ref.el.remove();
        this._downloadItemEls.delete(tid);
      }
    }

    // Create/update
    for (const dlItem of items) {
      let ref = this._downloadItemEls.get(dlItem.tileId);
      if (!ref) {
        ref = this._createDownloadItemRow(dlItem);
        this._downloadItemEls.set(dlItem.tileId, ref);
        this._dlItemsEl.appendChild(ref.el);
      }
      this._updateDownloadItemRow(ref, dlItem);
    }
  }

  _createDownloadItemRow(dlItem) {
    const el = document.createElement('div');
    el.className = 'seosonaflow-queue-item';

    el.innerHTML = `
      <span class="seosonaflow-queue-item__icon"></span>
      <span class="seosonaflow-queue-item__prompt"></span>
      <span class="seosonaflow-queue-item__state"></span>
    `;

    return {
      el,
      iconEl: el.querySelector('.seosonaflow-queue-item__icon'),
      promptEl: el.querySelector('.seosonaflow-queue-item__prompt'),
      stateEl: el.querySelector('.seosonaflow-queue-item__state'),
      _lastState: null,
    };
  }

  _updateDownloadItemRow(ref, dlItem) {
    if (ref._lastState === dlItem.state) return;
    ref._lastState = dlItem.state;

    const stateInfo = QueueMonitor.DOWNLOAD_STATES[dlItem.state] || QueueMonitor.DOWNLOAD_STATES.PENDING;

    ref.iconEl.textContent = stateInfo.icon;
    ref.iconEl.className = `seosonaflow-queue-item__icon ${stateInfo.colorClass}`;

    const promptText = dlItem.promptText || dlItem.tileId || '';
    const truncated = promptText.length > 50 ? promptText.substring(0, 50) + '...' : promptText;
    ref.promptEl.textContent = truncated;
    ref.promptEl.title = promptText;

    ref.stateEl.textContent = stateInfo.label;
    ref.stateEl.className = `seosonaflow-queue-item__state ${stateInfo.colorClass}`;

    const isActive = dlItem.state === 'DOWNLOADING';
    ref.el.classList.toggle('seosonaflow-queue-item--active', isActive);
  }

  // ---------------------------------------------------------------------------
  // Job Element Creation
  // ---------------------------------------------------------------------------

  _createJobElement(job) {
    const el = document.createElement('div');
    el.className = 'seosonaflow-queue-job';

    const ownerInfo = QueueMonitor.OWNER_COLORS[job.owner] || { bg: '#6b7280', label: job.owner };

    // Header
    const headerEl = document.createElement('div');
    headerEl.className = 'seosonaflow-queue-job__header';
    headerEl.innerHTML = `
      <span class="seosonaflow-queue-job__owner-dot" style="background:${ownerInfo.bg}"></span>
      <span class="seosonaflow-queue-job__label"></span>
      <span class="seosonaflow-queue-job__badge"></span>
      <span class="seosonaflow-queue-job__counter"></span>
      <span class="seosonaflow-queue-job__elapsed"></span>
      <button class="seosonaflow-queue-job__pause" title="${window.I18n?.t('common.pause') || 'Tạm dừng'}" style="display:none;">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="6" width="3" height="12" rx="1"/><rect x="14" y="6" width="3" height="12" rx="1"/></svg>
      </button>
      <button class="seosonaflow-queue-job__stop" title="${window.I18n?.t('common.stop') || 'Dừng'}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
      </button>
      <button class="seosonaflow-queue-job__toggle" title="${window.I18n?.t('queue.expand') || 'Mở rộng'} / ${window.I18n?.t('queue.collapse') || 'Thu nhỏ'}">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
    `;
    el.appendChild(headerEl);

    // Per-job control buttons
    const pauseBtn = headerEl.querySelector('.seosonaflow-queue-job__pause');
    const stopBtn = headerEl.querySelector('.seosonaflow-queue-job__stop');

    pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const queue = window.PromptQueue?.getInstance?.();
      if (!queue) return;
      // Toggle pause/resume based on current badge state
      if (refs._lastStatus === 'paused') {
        queue.resumeJob(job.id);
      } else {
        queue.pauseJob(job.id);
      }
    });

    stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const queue = window.PromptQueue?.getInstance?.();
      if (queue) queue.stopJob(job.id);
    });

    // Progress bar
    const progressEl = document.createElement('div');
    progressEl.className = 'seosonaflow-queue-job__progress';
    progressEl.innerHTML = '<div class="seosonaflow-queue-job__progress-fill"></div>';
    el.appendChild(progressEl);

    // Body (collapsible)
    const bodyEl = document.createElement('div');
    bodyEl.className = 'seosonaflow-queue-job__body';
    el.appendChild(bodyEl);

    // Item table container
    const itemsEl = document.createElement('div');
    itemsEl.className = 'seosonaflow-queue-items';
    bodyEl.appendChild(itemsEl);

    // Toggle accordion
    let expanded = false;
    headerEl.addEventListener('click', () => {
      expanded = !expanded;
      el.classList.toggle('seosonaflow-queue-job--expanded', expanded);
    });

    const refs = {
      el,
      headerEl,
      bodyEl,
      progressEl,
      progressFill: progressEl.querySelector('.seosonaflow-queue-job__progress-fill'),
      labelEl: headerEl.querySelector('.seosonaflow-queue-job__label'),
      badgeEl: headerEl.querySelector('.seosonaflow-queue-job__badge'),
      counterEl: headerEl.querySelector('.seosonaflow-queue-job__counter'),
      elapsedEl: headerEl.querySelector('.seosonaflow-queue-job__elapsed'),
      pauseBtn: headerEl.querySelector('.seosonaflow-queue-job__pause'),
      stopBtn: headerEl.querySelector('.seosonaflow-queue-job__stop'),
      itemsEl,
      itemEls: new Map(),
      _lastStatus: null,
      _lastPct: -1,
    };

    return refs;
  }

  // ---------------------------------------------------------------------------
  // Job Element Update
  // ---------------------------------------------------------------------------

  _updateJobElement(refs, job) {
    const ownerInfo = QueueMonitor.OWNER_COLORS[job.owner] || { bg: '#6b7280', label: job.owner };
    const isDone = job.status === 'completed' || job.status === 'stopped';
    const isActive = job.status === 'running' || job.status === 'paused';

    // Check if any items are in RETRY_SUBMIT state
    const hasRetrying = isActive && job.items?.some(it => it.state === 'RETRY_SUBMIT');
    // Derive effective status for display
    const effectiveStatus = hasRetrying ? 'retrying' : job.status;

    // Label
    const label = job.label || ownerInfo.label;
    if (refs.labelEl.textContent !== label) {
      refs.labelEl.textContent = label;
    }

    // Badge (status) - use effectiveStatus for display
    if (refs._lastStatus !== effectiveStatus) {
      refs._lastStatus = effectiveStatus;
      const statusText = this._jobStatusText(effectiveStatus);
      refs.badgeEl.textContent = statusText;
      refs.badgeEl.className = 'seosonaflow-queue-job__badge seosonaflow-queue-job__badge--' + effectiveStatus;

      // Update pause button icon & visibility (match FloatingTracker style)
      if (refs.pauseBtn) {
        // Pause only for 'prompts' owner
        refs.pauseBtn.style.display = (isActive && job.owner === 'prompts') ? '' : 'none';
        if (job.status === 'paused') {
          refs.pauseBtn.title = window.I18n?.t('common.resume') || 'Tiếp tục';
          refs.pauseBtn.className = 'seosonaflow-queue-job__pause seosonaflow-queue-job__pause--resume';
          refs.pauseBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="8,6 18,12 8,18"/></svg>';
        } else {
          refs.pauseBtn.title = window.I18n?.t('common.pause') || 'Tạm dừng';
          refs.pauseBtn.className = 'seosonaflow-queue-job__pause';
          refs.pauseBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="6" width="3" height="12" rx="1"/><rect x="14" y="6" width="3" height="12" rx="1"/></svg>';
        }
      }

      // Stop button visibility
      if (refs.stopBtn) {
        refs.stopBtn.style.display = isActive ? '' : 'none';
      }
    }

    // Counter (with failed count)
    const completed = job.completedCount || 0;
    const failed = job.failedCount || 0;
    const total = job.totalExpected || 0;
    let counterText = total > 0 ? `${completed}/${total}` : '';
    if (failed > 0) counterText += ` (${window.I18n?.t('queue.errorCount', { count: failed }) || failed + ' lỗi'})`;
    if (refs.counterEl.textContent !== counterText) {
      refs.counterEl.textContent = counterText;
    }

    // Elapsed time
    if (refs.elapsedEl && job.startedAt) {
      refs.elapsedEl.textContent = this._formatTime(Date.now() - job.startedAt);
    }

    // Progress bar
    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    if (refs._lastPct !== pct) {
      refs._lastPct = pct;
      refs.progressFill.style.width = `${pct}%`;
      refs.progressFill.style.background = ownerInfo.bg;
    }

    // Items — only update if body is visible (expanded)
    if (refs.el.classList.contains('seosonaflow-queue-job--expanded')) {
      this._updateJobItems(refs, job.items || []);
    }
  }

  _jobStatusText(status) {
    const map = {
      running: window.I18n?.t('exec.running') || 'Đang chạy',
      retrying: window.I18n?.t('exec.retrying') || 'Đang thử lại...',
      paused: window.I18n?.t('exec.paused') || 'Tạm dừng',
      stopped: window.I18n?.t('exec.stopped') || 'Đã dừng',
      completed: window.I18n?.t('exec.completed') || 'Hoàn thành',
    };
    return map[status] || status || '';
  }

  // ---------------------------------------------------------------------------
  // Item Rows
  // ---------------------------------------------------------------------------

  _updateJobItems(refs, items) {
    const currentIds = new Set(items.map(it => it.id));

    // Remove stale items
    for (const [itemId, itemRef] of refs.itemEls) {
      if (!currentIds.has(itemId)) {
        itemRef.el.remove();
        refs.itemEls.delete(itemId);
      }
    }

    // Create/update items
    items.forEach((item) => {
      let itemRef = refs.itemEls.get(item.id);
      if (!itemRef) {
        itemRef = this._createItemRow(item);
        refs.itemEls.set(item.id, itemRef);
        refs.itemsEl.appendChild(itemRef.el);
      }
      this._updateItemRow(itemRef, item);
    });
  }

  _createItemRow(item) {
    const el = document.createElement('div');
    el.className = 'seosonaflow-queue-item';

    el.innerHTML = `
      <span class="seosonaflow-queue-item__icon"></span>
      <span class="seosonaflow-queue-item__index"></span>
      <span class="seosonaflow-queue-item__prompt"></span>
      <span class="seosonaflow-queue-item__retry"></span>
      <span class="seosonaflow-queue-item__time"></span>
      <span class="seosonaflow-queue-item__state"></span>
    `;

    return {
      el,
      iconEl: el.querySelector('.seosonaflow-queue-item__icon'),
      indexEl: el.querySelector('.seosonaflow-queue-item__index'),
      promptEl: el.querySelector('.seosonaflow-queue-item__prompt'),
      retryEl: el.querySelector('.seosonaflow-queue-item__retry'),
      timeEl: el.querySelector('.seosonaflow-queue-item__time'),
      stateEl: el.querySelector('.seosonaflow-queue-item__state'),
      _lastState: null,
      _lastRetry: -1,
    };
  }

  _updateItemRow(ref, item) {
    // Lookup realtime phase từ TileMonitor (nếu có) — override state cho non-terminal
    const phaseStatus = this._itemStatus?.get(item.id);
    const phaseInfo = phaseStatus ? QueueMonitor.PHASE_LABELS[phaseStatus.phase] : null;
    const isTerminalState = ['COMPLETED', 'FAILED', 'PARTIAL_FAIL', 'CANCELLED'].includes(item.state);

    // Cache key bao gồm phase + attempt để re-render khi phase thay đổi
    const phaseKey = phaseStatus
      ? `${phaseStatus.phase}:${phaseStatus.attempt || 0}:${phaseStatus.successCount || 0}:${phaseStatus.failedCount || 0}`
      : '';
    const stateChanged = ref._lastState !== item.state;
    const retryChanged = ref._lastRetry !== (item.retryCount || 0);
    const phaseChanged = ref._lastPhaseKey !== phaseKey;

    if (!stateChanged && !retryChanged && !phaseChanged && ref._lastPrompt === item.promptText) return;
    ref._lastState = item.state;
    ref._lastPrompt = item.promptText;
    ref._lastRetry = item.retryCount || 0;
    ref._lastPhaseKey = phaseKey;

    const stateInfo = QueueMonitor.ITEM_STATES[item.state] || QueueMonitor.ITEM_STATES.PENDING;

    // Phase ưu tiên hơn state khi item chưa terminal HOẶC phase đã terminal (completed/failed/partial_fail)
    const useDisplay = (phaseInfo && (!isTerminalState || ['completed', 'failed', 'partial_fail'].includes(phaseStatus?.phase)))
      ? phaseInfo
      : stateInfo;

    // Icon — giữ icon từ ITEM_STATES (vì PHASE_LABELS không define icon)
    ref.iconEl.textContent = stateInfo.icon;
    ref.iconEl.className = `seosonaflow-queue-item__icon ${useDisplay.colorClass}`;

    // Index
    ref.indexEl.textContent = `#${(item.promptIndex ?? 0) + 1}`;

    // Prompt
    const promptText = item.promptText || '';
    const truncated = promptText.length > 50 ? promptText.substring(0, 50) + '...' : promptText;
    ref.promptEl.textContent = truncated;
    ref.promptEl.title = promptText;

    // Retry badge — bao gồm attempt từ phase (vd "click retry 1/2") + success/fail count
    if (phaseStatus && ['click_retry', 'wait_retry'].includes(phaseStatus.phase) && phaseStatus.attempt > 0) {
      ref.retryEl.textContent = `${phaseStatus.attempt}/${phaseStatus.maxRetries || 0}`;
      ref.retryEl.className = 'seosonaflow-queue-item__retry seosonaflow-queue-state--orange';
      ref.retryEl.title = phaseStatus.text || '';
    } else if (item.retryCount > 0) {
      ref.retryEl.textContent = `x${item.retryCount}`;
      ref.retryEl.className = 'seosonaflow-queue-item__retry seosonaflow-queue-state--orange';
      ref.retryEl.title = '';
    } else if (phaseStatus && phaseStatus.failedCount > 0 && phaseStatus.successCount > 0) {
      ref.retryEl.textContent = `${phaseStatus.successCount}✓ ${phaseStatus.failedCount}✗`;
      ref.retryEl.className = 'seosonaflow-queue-item__retry seosonaflow-queue-state--yellow';
      ref.retryEl.title = '';
    } else {
      ref.retryEl.textContent = '';
      ref.retryEl.className = 'seosonaflow-queue-item__retry';
      ref.retryEl.title = '';
    }

    // Time: submittedAt → completedAt duration, or elapsed since submit
    if (item.completedAt && item.submittedAt) {
      ref.timeEl.textContent = this._formatTime(item.completedAt - item.submittedAt);
    } else if (item.submittedAt) {
      ref.timeEl.textContent = this._formatTime(Date.now() - item.submittedAt);
    } else {
      ref.timeEl.textContent = '';
    }

    // State label — ưu tiên phase label
    ref.stateEl.textContent = useDisplay.label;
    ref.stateEl.className = `seosonaflow-queue-item__state ${useDisplay.colorClass}`;

    // Active pulse — bao gồm cả phase active (chưa terminal)
    const phaseActive = phaseStatus && ['monitoring', 'fail_detected', 'click_retry', 'wait_retry', 'retry_skipped', 'tier2_reload', 'tier2_resubmit'].includes(phaseStatus.phase);
    const isActive = item.state === 'SUBMITTING' || item.state === 'MONITORING' || item.state === 'RETRY_SUBMIT' || phaseActive;
    ref.el.classList.toggle('seosonaflow-queue-item--active', isActive);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _formatTime(ms) {
    if (!ms || ms < 0) return '';
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }

  // ---------------------------------------------------------------------------
  // Empty State
  // ---------------------------------------------------------------------------

  _showEmpty(show) {
    if (this._emptyStateEl) {
      this._emptyStateEl.style.display = show ? '' : 'none';
    }
    if (this._jobsContainerEl) {
      this._jobsContainerEl.style.display = show ? 'none' : '';
    }
  }
}

window.QueueMonitor = QueueMonitor;
