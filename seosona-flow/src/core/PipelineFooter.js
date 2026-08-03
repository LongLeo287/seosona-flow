/**
 * PipelineFooter — Inline progress bar cho Pipeline Queue mode
 *
 * Hiển thị trên footer sidePanel khi Pipeline đang chạy.
 * Cho phép user stop/pause từ sidePanel mà không cần tương tác Flow DOM
 * (tránh bị ExecutionBlocker chặn).
 *
 * Tương tự ExecutionTracker nhưng cho Pipeline mode.
 * ExecutionTracker chỉ hiện khi Pipeline OFF (legacy mode).
 * PipelineFooter chỉ hiện khi Pipeline ON.
 */
class PipelineFooter {
  static _instance = null;

  static init() {
    if (!this._instance) {
      this._instance = new PipelineFooter();
    }
    return this._instance;
  }

  static getInstance() {
    return this._instance;
  }

  constructor() {
    this._state = 'hidden'; // hidden | visible | completing
    this._snapshot = null;
    this._externalSnapshot = null;
    this._completionTimer = null;
    this._elapsedTimer = null;

    this._createDOM();
    this._bindEvents();
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  _createDOM() {
    this._el = document.createElement('div');
    this._el.className = 'seosonaflow-pipeline-footer seosonaflow-pipeline-footer--hidden';
    this._el.innerHTML = `
      <div class="seosonaflow-pipeline-footer__bar">
        <div class="seosonaflow-pipeline-footer__progress-fill"></div>
        <div class="seosonaflow-pipeline-footer__content">
          <span class="seosonaflow-pipeline-footer__icon">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </span>
          <span class="seosonaflow-pipeline-footer__label">Pipeline</span>
          <span class="seosonaflow-pipeline-footer__counter"></span>
          <span class="seosonaflow-pipeline-footer__elapsed"></span>
          <span class="seosonaflow-pipeline-footer__retry-status"></span>
          <div class="seosonaflow-pipeline-footer__actions">
            <button class="seosonaflow-pipeline-footer__btn seosonaflow-pipeline-footer__btn--stop-all" title="${window.I18n?.t('pipeline.stopAll') || 'Dừng tất cả'}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2"></rect>
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div class="seosonaflow-pipeline-footer__jobs"></div>
    `;

    // Insert trước footer
    const footer = document.getElementById('appFooter');
    if (footer && footer.parentNode) {
      footer.parentNode.insertBefore(this._el, footer);
    } else {
      document.body.appendChild(this._el);
    }

    // Cache elements
    this._progressFill = this._el.querySelector('.seosonaflow-pipeline-footer__progress-fill');
    this._labelEl = this._el.querySelector('.seosonaflow-pipeline-footer__label');
    this._counterEl = this._el.querySelector('.seosonaflow-pipeline-footer__counter');
    this._elapsedEl = this._el.querySelector('.seosonaflow-pipeline-footer__elapsed');
    this._retryStatusEl = this._el.querySelector('.seosonaflow-pipeline-footer__retry-status');
    this._jobsEl = this._el.querySelector('.seosonaflow-pipeline-footer__jobs');
    this._stopAllBtn = this._el.querySelector('.seosonaflow-pipeline-footer__btn--stop-all');
    this._retryTimer = null;

    // Bind stop all
    this._stopAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._sendAction('pq:stopAll');
    });

    // Toggle jobs expand
    this._el.querySelector('.seosonaflow-pipeline-footer__bar').addEventListener('click', (e) => {
      if (e.target.closest('.seosonaflow-pipeline-footer__btn')) return;
      if (this._state === 'completing') {
        this._hide();
        return;
      }
      this._jobsEl.classList.toggle('seosonaflow-pipeline-footer__jobs--expanded');
    });
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  _bindEvents() {
    if (!window.eventBus) return;

    // Local pipeline state
    window.eventBus.on('queue:state_changed', (snapshot) => {
      this._snapshot = snapshot;
      this._onStateChanged();
    });

    // External pipeline state (from popup windows)
    window.eventBus.on('queue:external_state', (snapshot) => {
      this._externalSnapshot = snapshot;
      this._externalTimestamp = Date.now();
      this._onStateChanged();
    });

    // Retry status events (from TileMonitor or content.js)
    window.eventBus.on('retry:status', (data) => {
      this._showRetryStatus(data?.text || data?.message);
    });

    // Force stopped — hide immediately
    window.eventBus.on('execution:force_stopped', () => {
      if (this._state !== 'hidden') this._hide();
    });

    // Port 1.1.49: captcha/human-check → lưu reason để hiện ở label khi paused (thay tên job chung).
    window.eventBus.on('execution:captcha_detected', () => {
      this._pauseReason = window.I18n?.t('pipeline.pausedCaptcha') || 'Google tạm chặn — chờ rồi nhấn ▶ để tiếp tục';
    });
    window.eventBus.on('execution:captcha_resolved', () => { this._pauseReason = null; });

    // Listen for messages from content.js (Legacy mode)
    chrome.runtime.onMessage?.addListener((msg) => {
      if (msg?.action === 'retry:status' && msg?.text) {
        this._showRetryStatus(msg.text);
      }
    });
  }

  /**
   * Hiển thị retry status text (tự động ẩn sau 3 giây)
   */
  _showRetryStatus(text) {
    if (!this._retryStatusEl || this._state === 'hidden') return;

    this._retryStatusEl.textContent = text || '';
    this._retryStatusEl.classList.add('seosonaflow-pipeline-footer__retry-status--visible');

    // Clear timer cũ
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
    }

    // Tự động ẩn sau 3 giây
    this._retryTimer = setTimeout(() => {
      this._retryStatusEl.classList.remove('seosonaflow-pipeline-footer__retry-status--visible');
      this._retryStatusEl.textContent = '';
    }, 3000);
  }

  _onStateChanged() {
    const snap = this._getActiveSnapshot();
    if (!snap) {
      if (this._state === 'visible') {
        this._showCompletion();
      }
      return;
    }

    const jobs = snap.jobs || [];
    const hasActive = jobs.some(j => j.status === 'running' || j.status === 'paused');

    if (hasActive) {
      if (this._state === 'hidden') {
        this._show();
      }
      this._render(snap);
    } else if (jobs.length > 0 && this._state === 'visible') {
      // All completed
      this._render(snap);
      this._showCompletion();
    } else if (this._state !== 'hidden') {
      this._hide();
    }
  }

  _getActiveSnapshot() {
    // Local snapshot takes priority
    if (this._snapshot && this._snapshot.jobs && this._snapshot.jobs.length > 0) {
      return this._snapshot;
    }
    // External snapshot (from popup windows)
    if (this._externalSnapshot && this._externalTimestamp > Date.now() - 30000 &&
        this._externalSnapshot.jobs && this._externalSnapshot.jobs.length > 0) {
      return this._externalSnapshot;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // State Machine
  // ---------------------------------------------------------------------------

  _show() {
    this._state = 'visible';
    this._el.className = 'seosonaflow-pipeline-footer';
    this._el.removeAttribute('data-state');
    this._startElapsedTimer();
    if (this._completionTimer) {
      clearTimeout(this._completionTimer);
      this._completionTimer = null;
    }
  }

  _hide() {
    this._state = 'hidden';
    this._el.className = 'seosonaflow-pipeline-footer seosonaflow-pipeline-footer--hidden';
    this._el.removeAttribute('data-state');
    this._jobsEl.classList.remove('seosonaflow-pipeline-footer__jobs--expanded');
    this._jobsEl.innerHTML = '';
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
      this._retryStatusEl.classList.remove('seosonaflow-pipeline-footer__retry-status--visible');
    }
  }

  _showCompletion() {
    this._state = 'completing';
    this._stopElapsedTimer();
    this._el.setAttribute('data-state', 'done');
    this._progressFill.style.width = '100%';
    this._labelEl.textContent = window.I18n?.t('pipeline.complete') || 'Hoàn tất';
    this._stopAllBtn.style.display = 'none';
    this._jobsEl.classList.remove('seosonaflow-pipeline-footer__jobs--expanded');
    this._jobsEl.innerHTML = '';

    this._completionTimer = setTimeout(() => this._hide(), 3000);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  _render(snap) {
    if (!snap || this._state !== 'visible') return;

    const jobs = snap.jobs || [];
    let completed = 0, total = 0, failed = 0;
    const activeJobs = [];

    for (const j of jobs) {
      // _buildSnapshot dùng completedCount/totalExpected/failedCount (canonical, giống QueueMonitor).
      // Trước đọc nhầm j.completed/j.total → undefined → luôn 0/0. Fallback giữ tương thích nếu
      // snapshot format khác. (Fix 2026-06-25 — KHÔNG thêm emit/subscribe, chỉ sửa đọc field.)
      completed += (j.completedCount ?? j.completed ?? 0);
      total += (j.totalExpected ?? j.total ?? 0);
      failed += (j.failedCount ?? j.failed ?? 0);
      if (j.status === 'running' || j.status === 'paused') {
        activeJobs.push(j);
      }
    }

    const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
    const hasPaused = activeJobs.some(j => j.status === 'paused');

    // State
    this._el.setAttribute('data-state', hasPaused ? 'paused' : 'running');

    // Progress
    this._progressFill.style.width = `${pct}%`;

    // Label — Port 1.1.49: paused + reason captcha → hiện reason thay tên job.
    if (hasPaused && this._pauseReason) {
      this._labelEl.textContent = this._pauseReason;
    } else if (activeJobs.length === 1) {
      this._labelEl.textContent = activeJobs[0].label || activeJobs[0].owner || 'Pipeline';
    } else {
      this._labelEl.textContent = `Pipeline (${activeJobs.length} ${window.I18n?.t('pipeline.tasks') || 'tác vụ'})`;
    }
    if (!hasPaused) this._pauseReason = null; // hết paused → xóa reason cũ

    // Counter
    let counterText = `${completed}/${total}`;
    if (failed > 0) counterText += ` \u2022 ${failed} ${window.I18n?.t('pipeline.errors') || 'lỗi'}`;
    this._counterEl.textContent = counterText;

    // Elapsed
    const elapsed = snap.elapsed || (snap.pipeline?.startedAt ? Date.now() - snap.pipeline.startedAt : 0);
    this._elapsedEl.textContent = this._formatTime(elapsed);

    // Stop button visible
    this._stopAllBtn.style.display = '';

    // Jobs detail (expandable section)
    this._renderJobs(activeJobs);
  }

  _renderJobs(jobs) {
    if (!this._jobsEl.classList.contains('seosonaflow-pipeline-footer__jobs--expanded')) return;

    const ownerColors = {
      prompts: '#3b82f6', task: '#f97316', workflow: '#a855f7',
      angles: '#ec4899', telegram: '#06b6d4', effects: '#22d3ee'
    };

    let html = '';
    for (const j of jobs) {
      const color = ownerColors[j.owner] || '#6b7280';
      const _jc = j.completedCount ?? j.completed ?? 0;
      const _jt = j.totalExpected ?? j.total ?? 0;
      const jPct = _jt > 0 ? Math.round((_jc / _jt) * 100) : 0;
      const isPaused = j.status === 'paused';

      html += `<div class="seosonaflow-pipeline-footer__job">`;
      html += `<span class="seosonaflow-pipeline-footer__job-dot" style="background:${color};${!isPaused ? 'box-shadow:0 0 4px ' + color + ';' : ''}"></span>`;
      html += `<span class="seosonaflow-pipeline-footer__job-label">${this._escHtml(j.label || j.owner)}</span>`;
      html += `<span class="seosonaflow-pipeline-footer__job-pct">${jPct}%</span>`;

      // Per-job actions
      if (j.owner === 'prompts' && isPaused) {
        html += `<button class="seosonaflow-pipeline-footer__job-btn seosonaflow-pipeline-footer__job-btn--resume" data-action="resume" data-job-id="${j.id}" title="${window.I18n?.t('pipeline.resume') || 'Tiếp tục'}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="8,6 18,12 8,18"/></svg>
        </button>`;
      } else if (j.owner === 'prompts' && j.status === 'running') {
        html += `<button class="seosonaflow-pipeline-footer__job-btn seosonaflow-pipeline-footer__job-btn--pause" data-action="pause" data-job-id="${j.id}" title="${window.I18n?.t('pipeline.pause') || 'Tạm dừng'}">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="6" width="3" height="12" rx="1"/><rect x="14" y="6" width="3" height="12" rx="1"/></svg>
        </button>`;
      }

      html += `<button class="seosonaflow-pipeline-footer__job-btn seosonaflow-pipeline-footer__job-btn--stop" data-action="stop" data-job-id="${j.id}" title="${window.I18n?.t('pipeline.stop') || 'Dừng'}">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>
      </button>`;

      html += `</div>`;
    }

    this._jobsEl.innerHTML = html;

    // Bind per-job action buttons
    this._jobsEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.getAttribute('data-action');
        const jobId = btn.getAttribute('data-job-id');
        if (action === 'stop') this._sendAction('pq:stopJob', { jobId });
        else if (action === 'pause') this._sendAction('pq:pauseJob', { jobId });
        else if (action === 'resume') this._sendAction('pq:resumeJob', { jobId });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  _sendAction(action, data) {
    // PromptQueue có thể nằm ở local hoặc popup window
    // Luôn relay qua chrome.runtime.sendMessage
    const pq = window.PromptQueue?.getInstance();

    if (action === 'pq:stopAll') {
      if (pq) pq.stopAll();
      // Cũng relay cho popup windows
      chrome.runtime.sendMessage({ action: 'pq:stopAll' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('PipelineFooter#_sendAction', _e); });
      return;
    }

    if (data?.jobId) {
      if (pq) {
        if (action === 'pq:stopJob') pq.stopJob(data.jobId);
        else if (action === 'pq:pauseJob') pq.pauseJob(data.jobId);
        else if (action === 'pq:resumeJob') pq.resumeJob(data.jobId);
      }
      // Relay cho popup windows
      chrome.runtime.sendMessage(Object.assign({ action }, data)).catch(function (_e) { globalThis.SEOSONA_swallow?.('PipelineFooter#_sendAction', _e); });
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  _formatTime(ms) {
    if (!ms || ms < 0) return '';
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m < 10 ? '0' : ''}${m}:${sec < 10 ? '0' : ''}${sec}`;
  }

  _escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  _startElapsedTimer() {
    this._stopElapsedTimer();
    this._elapsedTimer = setInterval(() => {
      if (this._state === 'visible') {
        const snap = this._getActiveSnapshot();
        if (snap) {
          const elapsed = snap.elapsed || 0;
          this._elapsedEl.textContent = this._formatTime(elapsed);
        }
      }
    }, 1000);
  }

  _stopElapsedTimer() {
    if (this._elapsedTimer) {
      clearInterval(this._elapsedTimer);
      this._elapsedTimer = null;
    }
  }
}

window.PipelineFooter = PipelineFooter;
