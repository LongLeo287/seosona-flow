/**
 * ExecutionTracker — Inline progress bar nằm trên footer của sidePanel
 *
 * Dual mode support:
 * - Legacy mode (Pipeline OFF): nhận data từ ExecutionLock + execution:tracker_update
 * - Pipeline mode (Pipeline ON): nhận data từ PromptQueue snapshot (queue:state_changed)
 *
 * State machine:
 *   [hidden] ──lock_acquired|pipeline_start──> [visible]
 *   [visible] ──complete/error──> [completing] (auto-hide 3s)
 *   [completing] ──3s | click──> [hidden]
 *   [any] ──lock_released|pipeline_empty──> [hidden]
 */
class ExecutionTracker {
  static _instance = null;

  static init() {
    if (!this._instance) {
      this._instance = new ExecutionTracker();
    }
    return this._instance;
  }

  static getInstance() {
    return this._instance;
  }

  constructor() {
    this._state = 'hidden'; // hidden | visible | completing
    this._data = null;
    this._startTime = null;
    this._errorCount = 0;
    this._completionTimer = null;
    this._elapsedTimer = null;
    this._pipelineMode = false;

    this._createDOM();
    this._bindEvents();
  }

  // ---------------------------------------------------------------------------
  // DOM — Compact inline bar
  // ---------------------------------------------------------------------------

  _createDOM() {
    this._el = document.createElement('div');
    this._el.className = 'seosonaflow-exec-tracker seosonaflow-exec-tracker--hidden';
    this._el.innerHTML = `
      <div class="seosonaflow-exec-tracker__bar">
        <div class="seosonaflow-exec-tracker__progress-fill"></div>
        <div class="seosonaflow-exec-tracker__content">
          <span class="seosonaflow-exec-tracker__icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </span>
          <span class="seosonaflow-exec-tracker__label"></span>
          <span class="seosonaflow-exec-tracker__phase"></span>
          <span class="seosonaflow-exec-tracker__counter"></span>
          <span class="seosonaflow-exec-tracker__elapsed"></span>
          <span class="seosonaflow-exec-tracker__retry-status"></span>
          <span class="seosonaflow-exec-tracker__error-badge seosonaflow-exec-tracker__error-badge--hidden">0</span>
          <div class="seosonaflow-exec-tracker__actions">
            <button class="seosonaflow-exec-tracker__btn seosonaflow-exec-tracker__btn--pause" title="${window.I18n?.t('common.pause') || 'Tạm dừng'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <rect x="6" y="4" width="4" height="16"></rect>
                <rect x="14" y="4" width="4" height="16"></rect>
              </svg>
            </button>
            <button class="seosonaflow-exec-tracker__btn seosonaflow-exec-tracker__btn--stop" title="${window.I18n?.t('common.stop') || 'Dừng'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2"></rect>
              </svg>
            </button>
          </div>
        </div>
      </div>
    `;

    // Insert trước footer (inline, không float)
    const footer = document.getElementById('appFooter');
    if (footer && footer.parentNode) {
      footer.parentNode.insertBefore(this._el, footer);
    } else {
      // Fallback: append vào body (sẽ không xảy ra nếu sidebar load đúng)
      document.body.appendChild(this._el);
    }

    // Cache elements
    this._progressFill = this._el.querySelector('.seosonaflow-exec-tracker__progress-fill');
    this._labelEl = this._el.querySelector('.seosonaflow-exec-tracker__label');
    this._phaseEl = this._el.querySelector('.seosonaflow-exec-tracker__phase');
    this._counterEl = this._el.querySelector('.seosonaflow-exec-tracker__counter');
    this._elapsedEl = this._el.querySelector('.seosonaflow-exec-tracker__elapsed');
    this._errorBadge = this._el.querySelector('.seosonaflow-exec-tracker__error-badge');
    this._iconEl = this._el.querySelector('.seosonaflow-exec-tracker__icon');
    this._pauseBtn = this._el.querySelector('.seosonaflow-exec-tracker__btn--pause');
    this._stopBtn = this._el.querySelector('.seosonaflow-exec-tracker__btn--stop');
    this._actionsEl = this._el.querySelector('.seosonaflow-exec-tracker__actions');
    this._retryStatusEl = this._el.querySelector('.seosonaflow-exec-tracker__retry-status');
    this._retryTimer = null;

    // Bind control events
    this._pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._handlePause();
    });
    this._stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._handleStop();
    });

    // Click completing bar to dismiss
    this._el.addEventListener('click', () => {
      if (this._state === 'completing') this._hide();
    });
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  _bindEvents() {
    if (!window.eventBus) return;

    // Lock changes → show/hide
    window.eventBus.on('execution:lock_changed', (state) => {
      console.log('[ExecutionTracker] lock_changed:', state, 'pipelineMode:', this._pipelineMode, 'state:', this._state);
      // Reset pipelineMode khi nhận lock từ legacy modes (không phải queue)
      // Tránh stale pipelineMode từ session trước block hiển thị
      if (state.owner && state.owner !== 'queue') {
        this._pipelineMode = false;
      }
      if (state.locked && this._state === 'hidden') {
        this._show(state);
      } else if (!state.locked && this._state !== 'hidden') {
        if (this._state !== 'completing') {
          this._showCompletion();
        }
      }
    });

    // Tracker updates (legacy mode only)
    window.eventBus.on('execution:tracker_update', (data) => {
      console.log('[ExecutionTracker] tracker_update:', data, 'pipelineMode:', this._pipelineMode);
      if (this._pipelineMode) return;
      this._onUpdate(data);
    });

    // Pipeline mode → PipelineFooter handles this, ExecutionTracker chỉ hide
    window.eventBus.on('queue:state_changed', (snapshot) => {
      if (!this._isPipelineEnabled()) return;
      this._pipelineMode = true;
      // PipelineFooter đã hiển thị progress, ExecutionTracker chỉ cần hide
      if (this._state !== 'hidden') this._hide();
    });

    // Nhận external snapshot từ popup windows (workflow, angles)
    window.eventBus.on('queue:external_state', (snapshot) => {
      if (!this._isPipelineEnabled()) return;
      this._pipelineMode = true;
      // PipelineFooter đã hiển thị progress, ExecutionTracker chỉ cần hide
      if (this._state !== 'hidden') this._hide();
    });

    // Retry status events (from content.js via eventBus relay)
    window.eventBus.on('retry:status', (data) => {
      this._showRetryStatus(data?.text || data?.message);
    });

    // Force stopped — hide immediately
    window.eventBus.on('execution:force_stopped', () => {
      if (this._state !== 'hidden') this._hide();
    });

    // Port 1.1.49: Captcha/human-check → lưu lý do pause để hiện ở phase text khi paused
    // (thay "Tạm dừng" chung → user biết vì sao dừng + cần bấm ▶ Tiếp tục sau khi qua captcha).
    window.eventBus.on('execution:captcha_detected', () => {
      this._pauseReason = window.I18n?.t('exec.pausedCaptcha') || 'Google tạm chặn — nhấn ▶ để tiếp tục';
    });
    window.eventBus.on('execution:captcha_resolved', () => { this._pauseReason = null; });

    // Listen for messages from content.js (Legacy mode)
    chrome.runtime.onMessage?.addListener((msg) => {
      if (msg?.action === 'retry:status' && msg?.text) {
        this._showRetryStatus(msg.text);
      }
    });
  }

  _isPipelineEnabled() {
    return window.PromptQueue && typeof window.PromptQueue.isEnabled === 'function' && window.PromptQueue.isEnabled();
  }

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------

  _show(lockState) {
    console.log('[ExecutionTracker] _show called:', lockState, 'pipelineMode:', this._pipelineMode);
    if (this._pipelineMode) return; // Legacy mode chỉ khi pipeline OFF

    this._data = {
      owner: lockState.owner,
      label: lockState.label || this._ownerLabel(lockState.owner),
      phase: 'started',
      current: 0,
      total: 0
    };
    this._startTime = Date.now();
    this._errorCount = 0;

    this._startElapsedTimer();
    this._state = 'visible';
    this._el.className = 'seosonaflow-exec-tracker';
    this._el.removeAttribute('data-state');

    this._render();
  }

  _hide() {
    this._state = 'hidden';
    this._el.className = 'seosonaflow-exec-tracker seosonaflow-exec-tracker--hidden';
    this._el.removeAttribute('data-state');
    this._data = null;
    this._pipelineMode = false;
    this._stopElapsedTimer();
    if (this._completionTimer) {
      clearTimeout(this._completionTimer);
      this._completionTimer = null;
    }
    // Clear retry status
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
    if (this._retryStatusEl) {
      this._retryStatusEl.textContent = '';
      this._retryStatusEl.classList.remove('seosonaflow-exec-tracker__retry-status--visible');
    }
  }

  /**
   * Hiển thị retry status text (tự động ẩn sau 3 giây)
   */
  _showRetryStatus(text) {
    if (!this._retryStatusEl || this._state === 'hidden') return;

    this._retryStatusEl.textContent = text || '';
    this._retryStatusEl.classList.add('seosonaflow-exec-tracker__retry-status--visible');

    // Clear timer cũ
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
    }

    // Tự động ẩn sau 3 giây
    this._retryTimer = setTimeout(() => {
      this._retryStatusEl.classList.remove('seosonaflow-exec-tracker__retry-status--visible');
      this._retryStatusEl.textContent = '';
    }, 3000);
  }

  _showCompletion() {
    this._stopElapsedTimer();
    this._state = 'completing';

    const elapsed = this._formatTime(Date.now() - (this._startTime || Date.now()));
    const current = this._data?.current || 0;
    const total = this._data?.total || current;
    const isError = this._data?.phase === 'error';

    this._el.className = 'seosonaflow-exec-tracker';
    this._el.setAttribute('data-state', isError ? 'error' : 'done');

    // Ẩn progress fill
    this._progressFill.style.width = isError ? '100%' : '100%';

    // Icon
    this._iconEl.innerHTML = isError
      ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
      : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';

    this._labelEl.textContent = isError ? (window.I18n?.t('common.error') || 'Lỗi') : (window.I18n?.t('exec.completed') || 'Hoàn tất');
    this._phaseEl.textContent = '';
    this._counterEl.textContent = `${current}/${total}`;
    this._elapsedEl.textContent = elapsed;
    this._errorBadge.classList.add('seosonaflow-exec-tracker__error-badge--hidden');
    this._actionsEl.style.display = 'none';

    this._completionTimer = setTimeout(() => this._hide(), 3000);
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------

  _onUpdate(data) {
    // Late init: nếu chưa có _data nhưng lock đang active, tự show
    if (!this._data) {
      const lockState = window.ExecutionLock?.getState();
      if (lockState?.locked && this._state === 'hidden') {
        this._show(lockState);
      }
      if (!this._data) return; // Vẫn không có data → skip
    }

    // Track errors
    if (data.errorCount !== undefined) this._errorCount = data.errorCount;
    if (data.phase === 'error') this._errorCount++;

    // Merge data
    this._data = { ...this._data, ...data };

    // Bug fix: trước fix, phase='completed' fire showCompletion (3s auto-hide) trước khi
    // ExecutionLock thực sự release → user thấy "tracker ẩn luôn ko đợi đến khi xong".
    // Ví dụ: Task ChatGPT/Grok gen xong, emit phase='completed' nhưng lock chỉ release
    // sau khi persist + emit task:status_changed (vài chục ms→vài giây). Giờ chỉ trigger
    // showCompletion khi LOCK đã release HOẶC không tồn tại lock — đảm bảo tracker hold
    // đến khi task thực sự kết thúc. Lock release sẽ tự fire showCompletion qua handler
    // execution:lock_changed (line 134-140).
    if (data.phase === 'completed' || data.phase === 'error') {
      // Bug fix: Clear stale Grok genProgress khi phase chuyển 'completed'/'error'.
      // Grok content script emit grok:gen_progress mỗi % change NHƯNG không clear khi
      // gen xong → tracker stuck với genProgress=75 từ broadcast cũ → hiển thị
      // "Generating Grok 75%" thay vì "Hoàn tất".
      this._data.genProgress = null;
      this._data.genElapsed = null;
      this._data.genMode = null;

      const lockState = window.ExecutionLock?.getState();
      if (!lockState?.locked) {
        this._showCompletion();
        return;
      }
      // Lock vẫn active → render với data 'completed' nhưng KHÔNG transition state.
      // Khi lock release sau đó → execution:lock_changed handler fire showCompletion.
      this._render();
      return;
    }

    // Late show (nếu hidden nhưng có data)
    if (this._state === 'hidden') {
      const lockState = window.ExecutionLock?.getState();
      if (lockState?.locked) this._show(lockState);
    }

    this._render();
  }

  // ---------------------------------------------------------------------------
  // Render — Single compact bar
  // ---------------------------------------------------------------------------

  _render() {
    if (!this._data || this._state !== 'visible') return;

    const d = this._data;
    // Progress fill: ưu tiên Grok genProgress (0-100) nếu có, fallback current/total
    const hasGenProgress = typeof d.genProgress === 'number' && d.genProgress >= 0;
    const pct = hasGenProgress
      ? Math.min(100, Math.max(0, d.genProgress))
      : (d.total > 0 ? Math.round((d.current / d.total) * 100) : 0);

    // State attribute cho CSS (running, paused)
    this._el.setAttribute('data-state', d.phase === 'paused' ? 'paused' : 'running');

    // Progress fill width
    this._progressFill.style.width = `${pct}%`;

    // Icon (bolt)
    this._iconEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';

    // Label — giữ nguyên context của lock (prompts/task/workflow) — không override.
    // Grok progress chỉ thay đổi phase text "Generating XX%", label giữ "Task: ABC"/"Workflow: XYZ".
    const label = d.taskBatch
      ? `${d.label} — Task ${d.taskBatch.current}/${d.taskBatch.total}`
      : (d.label || this._ownerLabel(d.owner));
    this._labelEl.textContent = label;

    // Phase text — Grok genProgress hiển thị "Generating XX% (45s)"
    // hoặc "Generating Grok Video XX% (45s)" với genMode để phân biệt provider.
    let phaseText;
    if (hasGenProgress) {
      const elapsedTxt = typeof d.genElapsed === 'number' ? ` (${d.genElapsed}s)` : '';
      const modeText = d.genMode === 'video' ? ' Grok Video' : (d.genMode === 'image' ? ' Grok' : '');
      phaseText = `${window.I18n?.t('exec.generating') || 'Generating'}${modeText} ${d.genProgress}%${elapsedTxt}`;
    } else {
      phaseText = this._phaseText(d.phase);
    }
    if (d.retryInfo) phaseText = `${window.I18n?.t('common.retry') || 'Thử lại'} ${d.retryInfo.attempt}/${d.retryInfo.maxRetries}`;
    // Port 1.1.49: paused + có reason captcha → hiện reason thay "Tạm dừng". Hết paused → xóa.
    if (d.phase === 'paused' && this._pauseReason) phaseText = this._pauseReason;
    else if (d.phase !== 'paused') this._pauseReason = null;
    this._phaseEl.textContent = phaseText;

    // Counter
    this._counterEl.textContent = d.total > 0 ? `${d.current}/${d.total}` : '';

    // Error badge
    if (this._errorCount > 0) {
      this._errorBadge.textContent = this._errorCount;
      this._errorBadge.classList.remove('seosonaflow-exec-tracker__error-badge--hidden');
    } else {
      this._errorBadge.classList.add('seosonaflow-exec-tracker__error-badge--hidden');
    }

    // Pause button: chỉ cho prompts owner
    if (d.owner === 'prompts') {
      this._pauseBtn.style.display = '';
      const isPaused = d.phase === 'paused';
      this._pauseBtn.title = isPaused ? (window.I18n?.t('common.resume') || 'Tiếp tục') : (window.I18n?.t('common.pause') || 'Tạm dừng');
      this._pauseBtn.innerHTML = isPaused
        ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>'
        : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>';
    } else {
      this._pauseBtn.style.display = 'none';
    }

    // Actions visible
    this._actionsEl.style.display = '';
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  _handlePause() {
    if (!this._data || this._data.owner !== 'prompts') return;

    // Pipeline mode: pause/resume qua PromptQueue
    if (this._pipelineMode && window.PromptQueue) {
      const queue = window.PromptQueue.getInstance();
      if (queue) {
        const promptsJobs = queue.getJobsByOwner('prompts');
        if (promptsJobs && promptsJobs.length > 0) {
          const job = promptsJobs[0];
          if (job.state === 'paused') {
            queue.resumeJob(job.id);
            this._data.phase = 'prompt_submitting';
          } else {
            queue.pauseJob(job.id);
            this._data.phase = 'paused';
          }
          this._render();
          return;
        }
      }
    }

    // Legacy mode: click pauseBtn
    const pauseBtn = document.getElementById('pauseBtn');
    if (pauseBtn) {
      pauseBtn.click();
      const isPaused = pauseBtn.dataset.paused === 'true';
      this._data.phase = isPaused ? 'paused' : 'prompt_submitting';
      this._render();
    }
  }

  _handleStop() {
    console.log('[ExecutionTracker] _handleStop called, forcing stop all...');

    // 1. Set global stop flags cho task/workflow
    window._taskShouldStop = true;
    window._taskBatchStopped = true;

    // 2. Stop workflow executor nếu đang chạy
    if (window.workflowExecutor?.isRunning) {
      window.workflowExecutor.shouldStop = true;
      window.workflowExecutor.isRunning = false;
    }

    // 2b. Clear cross-context af_running_workflow flag.
    // Lý do: nếu await trong execute() đang stuck (network hang, content script
    // không response) → finally không chạy ngay → flag stuck → context khác vẫn
    // bị block dialog "đang chạy". Force Stop = user consent dừng tất cả → clear
    // unconditional (không cần wf_id match).
    try {
      window.WorkflowExecutor?.clearCrossContextRunning?.();
    } catch (e) { /* ignore */ }

    // 3. Bug 2 fix (2026-05-17): KHÔNG cancel/complete main task token ở đây.
    //    Outer caller (task:run handler hoặc batch handler) sẽ:
    //      - Đọc actualSuccess từ taskResult sau khi loop break do flag _taskShouldStop
    //      - Gọi complete('partial', { successful_count }) với số đúng phạm vi (single-task vs batch)
    //    Trước fix: cancel ngay → server refund TOÀN BỘ kể cả khi đã có 1+ prompt success → user "free" prompt.
    //    Lý do delegate: ExecutionTracker không biết token là single-task hay batch (cùng biến
    //    _currentTaskExecutionToken). Single dùng _currentTaskSuccessCount (per-task), batch
    //    cần total successful tasks — chỉ outer mới biết scope đúng.
    //
    //    NHƯNG: vẫn cleanup _currentTaskExecutionToken = null tại _handleStop để Bug 54 cancelAll
    //    không re-cancel (idempotent guarded nhưng giữ semantic rõ).
    window._currentTaskExecutionToken = null;

    // Bug 54 fix (2026-05-13): Cancel TẤT CẢ active tokens — bao gồm workflow
    // per-node tokens (chatgpt_run, grok_run, generate) mà _currentTaskExecutionToken
    // không trỏ tới. Server rollback quota để user không bị tính lượt cho gen bị dừng.
    if (window.ExecutionGate?.cancelAll) {
      window.ExecutionGate.cancelAll().catch?.(() => {});
    }

    // 4. Stop Flow content script
    if (window.MessageBridge) {
      window.MessageBridge.stopExecution().catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionTracker#_handleStop', _e); });
    }

    // 5. Abort Grok session nếu đang chạy
    if (window.GrokSession?.getTabInfo) {
      window.GrokSession.getTabInfo().then(grokInfo => {
        if (grokInfo?.tabId) {
          window.MessageBridge?.grokAbort(grokInfo.tabId).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionTracker#_handleStop', _e); });
        }
      }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionTracker#_handleStop', _e); });
    }

    // 6. Abort ChatGPT session nếu đang chạy
    if (window.ChatGPTSession?.getTabInfo) {
      window.ChatGPTSession.getTabInfo().then(chatgptInfo => {
        if (chatgptInfo?.tabId) {
          window.MessageBridge?.chatgptAbort(chatgptInfo.tabId).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionTracker#_handleStop', _e); });
        }
      }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionTracker#_handleStop', _e); });
    }

    // 7. Pipeline mode: dừng qua PromptQueue
    if (this._pipelineMode && window.PromptQueue) {
      const queue = window.PromptQueue.getInstance();
      if (queue) {
        queue.stopAll();
      }
    }

    // 8. Legacy mode: dừng qua ExecutionLock
    if (window.ExecutionLock) {
      ExecutionLock.stopCurrent();
    }

    // 9. Emit stop event để các component khác có thể react
    window.eventBus?.emit('execution:force_stopped');

    // 10. Show notification
    window.showNotification?.(
      window.I18n?.t('exec.forceStopped') || 'Đã dừng tất cả tác vụ',
      'warning',
      2000
    );

    // 11. Hide tracker immediately — không chờ lock release event (có 500ms delay)
    this._hide();

    console.log('[ExecutionTracker] Force stop completed');
  }

  // ---------------------------------------------------------------------------
  // Timer
  // ---------------------------------------------------------------------------

  _startElapsedTimer() {
    this._stopElapsedTimer();
    this._elapsedTimer = setInterval(() => {
      if (this._startTime && this._elapsedEl) {
        this._elapsedEl.textContent = this._formatTime(Date.now() - this._startTime);
      }
    }, 1000);
  }

  _stopElapsedTimer() {
    if (this._elapsedTimer) {
      clearInterval(this._elapsedTimer);
      this._elapsedTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _ownerLabel(owner) {
    const map = { prompts: 'Auto Gen', task: 'Task', workflow: 'Workflow', angles: 'Angles', telegram: 'Telegram' };
    return map[owner] || owner || '';
  }

  _phaseText(phase) {
    const map = {
      started: window.I18n?.t('exec.starting') || 'Khởi tạo...',
      prompt_submitting: window.I18n?.t('exec.submitting') || 'Nhập prompt...',
      prompt_enhancing: window.I18n?.t('exec.enhancingPrompt') || 'Cải tiến prompt...',
      chatgpt_generating: window.I18n?.t('exec.chatgptGenerating') || 'ChatGPT generating...',
      grok_generating: window.I18n?.t('exec.grokGenerating') || 'Grok generating...',
      waiting_tiles: window.I18n?.t('exec.waitingResults') || 'Chờ kết quả...',
      retry: window.I18n?.t('exec.retrying') || 'Thử lại...',
      download: window.I18n?.t('common.download') || 'Tải xuống...',
      paused: window.I18n?.t('common.pause') || 'Tạm dừng',
      completed: window.I18n?.t('exec.completed') || 'Hoàn tất',
      error: window.I18n?.t('common.error') || 'Lỗi'
    };
    return map[phase] || phase || '';
  }

  _formatTime(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${min}:${String(sec).padStart(2, '0')}`;
  }
}

window.ExecutionTracker = ExecutionTracker;
