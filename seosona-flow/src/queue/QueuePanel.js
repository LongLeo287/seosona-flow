/**
 * QueuePanel - UI panel hiển thị và quản lý batch queue
 * Drag-to-reorder, play/pause/stop controls, progress display
 */

(function() {
  'use strict';

  class QueuePanel {
    constructor(container) {
      this.container = container;
      this._dragState = null;
      this._boundHandlers = {};
      this.init();
    }

    init() {
      this.render();
      this.bindEvents();
    }

    render() {
      this.container.innerHTML = this._template();
      this._listEl = this.container.querySelector('.seosonaflow-queue-list');
      this._retryFailedBtn = this.container.querySelector('#queueRetryFailedBtn');
      this._emptyEl = this.container.querySelector('.seosonaflow-queue-empty');
      this._progressEl = this.container.querySelector('.seosonaflow-queue-progress');
      this._progressText = this.container.querySelector('.seosonaflow-queue-progress-text');
      this._progressBar = this.container.querySelector('.seosonaflow-queue-progress-bar-fill');
      this._updateList();
    }

    _template() {
      return `
        <div class="seosonaflow-queue-panel">
          <div class="seosonaflow-queue-header">
            <div class="seosonaflow-queue-header-title">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="8" y1="6" x2="21" y2="6"></line>
                <line x1="8" y1="12" x2="21" y2="12"></line>
                <line x1="8" y1="18" x2="21" y2="18"></line>
                <line x1="3" y1="6" x2="3.01" y2="6"></line>
                <line x1="3" y1="12" x2="3.01" y2="12"></line>
                <line x1="3" y1="18" x2="3.01" y2="18"></line>
              </svg>
              <span>${window.I18n?.t('queue.title') || 'Hàng đợi'}</span>
            </div>
            <div class="seosonaflow-queue-controls">
              <button class="seosonaflow-queue-ctrl-btn seosonaflow-queue-autoretry-btn" id="queueAutoRetryBtn" title="${window.I18n?.t('queue.autoRetryTip') || 'Tự động thử lại mục lỗi'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 2v6h-6"></path><path d="M3 12a9 9 0 0 1 15-6.7L21 8"></path><path d="M3 22v-6h6"></path><path d="M21 12a9 9 0 0 1-15 6.7L3 16"></path>
                </svg>
              </button>
              <button class="seosonaflow-queue-ctrl-btn seosonaflow-queue-schedule-btn" id="queueScheduleBtn" title="${window.I18n?.t('queue.scheduleTip') || 'Hẹn giờ chạy'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><polyline points="12 7 12 12 15 14"></polyline></svg>
              </button>
              <button class="seosonaflow-queue-ctrl-btn seosonaflow-queue-retryfailed-btn hidden" id="queueRetryFailedBtn" title="${window.I18n?.t('queue.retryFailed') || 'Chạy lại các mục lỗi'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="23 4 23 10 17 10"></polyline>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                </svg>
                <span class="seosonaflow-queue-retryfailed-count"></span>
              </button>
              <button class="seosonaflow-queue-ctrl-btn" id="queuePlayPauseBtn" title="${window.I18n?.t('queue.playPause') || 'Chạy / Tạm dừng'}">
                <svg class="seosonaflow-queue-icon-play" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                <svg class="seosonaflow-queue-icon-pause hidden" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <rect x="6" y="4" width="4" height="16"></rect>
                  <rect x="14" y="4" width="4" height="16"></rect>
                </svg>
              </button>
              <button class="seosonaflow-queue-ctrl-btn" id="queueStopBtn" title="${window.I18n?.t('common.stop') || 'Dừng'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                  <rect x="4" y="4" width="16" height="16" rx="2"></rect>
                </svg>
              </button>
              <button class="seosonaflow-queue-ctrl-btn" id="queueClearBtn" title="${window.I18n?.t('queue.clearAll') || 'Xóa tất cả'}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"></polyline>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                </svg>
              </button>
            </div>
          </div>
          <div class="seosonaflow-queue-progress hidden">
            <span class="seosonaflow-queue-progress-text"></span>
            <div class="seosonaflow-queue-progress-bar">
              <div class="seosonaflow-queue-progress-bar-fill" style="width: 0%"></div>
            </div>
          </div>
          <div class="seosonaflow-queue-list"></div>
          <div class="seosonaflow-queue-empty">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.3">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="9" y1="9" x2="15" y2="15"></line>
              <line x1="15" y1="9" x2="9" y2="15"></line>
            </svg>
            <span>${window.I18n?.t('queue.empty') || 'Chưa có tác vụ nào trong hàng đợi'}</span>
          </div>
        </div>
      `;
    }

    bindEvents() {
      const playPauseBtn = this.container.querySelector('#queuePlayPauseBtn');
      const stopBtn = this.container.querySelector('#queueStopBtn');
      const clearBtn = this.container.querySelector('#queueClearBtn');

      if (playPauseBtn) {
        playPauseBtn.addEventListener('click', () => this._handlePlayPause());
      }
      if (stopBtn) {
        stopBtn.addEventListener('click', () => {
          if (window.batchQueue) window.batchQueue.stop();
        });
      }
      if (clearBtn) {
        clearBtn.addEventListener('click', async () => {
          if (!window.batchQueue || !window.batchQueue.queue.length) return;
          // Xác nhận trước khi xóa toàn bộ (tránh mất hàng đợi do bấm nhầm).
          const n = window.batchQueue.queue.length;
          const ok = window.customDialog
            ? await window.customDialog.confirm(
                (window.I18n?.t('queue.clearAllConfirm', { count: n }) || `Xóa toàn bộ ${n} mục trong hàng đợi?`),
                { title: window.I18n?.t('queue.clearAll') || 'Xóa tất cả', type: 'warning', confirmText: window.I18n?.t('common.delete') || 'Xóa', cancelText: window.I18n?.t('common.cancel') || 'Hủy' })
            : confirm(window.I18n?.t('queue.clearAllConfirm', { count: n }) || `Xóa toàn bộ ${n} mục?`);
          if (ok && window.batchQueue) window.batchQueue.clear();
        });
      }
      if (this._retryFailedBtn) {
        this._retryFailedBtn.addEventListener('click', () => {
          if (!window.batchQueue) return;
          const n = window.batchQueue.retryFailed();
          if (n > 0) window.showNotification?.(window.I18n?.t('queue.retryingFailed', { count: n }) || `Đang chạy lại ${n} mục lỗi…`, 'info', 2500);
        });
      }

      // Auto-retry toggle (B8)
      const autoRetryBtn = this.container.querySelector('#queueAutoRetryBtn');
      if (autoRetryBtn) {
        autoRetryBtn.addEventListener('click', () => {
          if (!window.batchQueue) return;
          const on = !window.batchQueue.autoRetry;
          window.batchQueue.setAutoRetry(on, window.batchQueue.autoRetryMax);
          this._updateAutoRetryBtn();
          window.showNotification?.(on
            ? (window.I18n?.t('queue.autoRetryOn', { max: window.batchQueue.autoRetryMax }) || `Tự thử lại: BẬT (tối đa ${window.batchQueue.autoRetryMax} lần)`)
            : (window.I18n?.t('queue.autoRetryOff') || 'Tự thử lại: TẮT'), 'info', 2000);
        });
        this._updateAutoRetryBtn();
      }

      // Schedule popup (B8)
      const scheduleBtn = this.container.querySelector('#queueScheduleBtn');
      if (scheduleBtn) {
        scheduleBtn.addEventListener('click', (e) => { e.stopPropagation(); this._toggleSchedulePopup(scheduleBtn); });
      }
      // Countdown tick cho lịch hẹn
      this._scheduleTick = setInterval(() => this._updateScheduleChip(), 1000);

      // Listen queue events
      this._boundHandlers.onChange = () => this._updateList();
      this._boundHandlers.onStarted = () => this._updateControls(true, false);
      this._boundHandlers.onPaused = () => this._updateControls(true, true);
      this._boundHandlers.onResumed = () => this._updateControls(true, false);
      this._boundHandlers.onStopped = () => this._updateControls(false, false);
      this._boundHandlers.onComplete = () => this._updateControls(false, false);
      this._boundHandlers.onItemComplete = (data) => this._updateProgress(data);

      window.eventBus.on('queue:changed', this._boundHandlers.onChange);
      window.eventBus.on('queue:started', this._boundHandlers.onStarted);
      window.eventBus.on('queue:paused', this._boundHandlers.onPaused);
      window.eventBus.on('queue:resumed', this._boundHandlers.onResumed);
      window.eventBus.on('queue:stopped', this._boundHandlers.onStopped);
      window.eventBus.on('queue:complete', this._boundHandlers.onComplete);
      window.eventBus.on('queue:item-complete', this._boundHandlers.onItemComplete);
    }

    _handlePlayPause() {
      if (!window.batchQueue) return;
      const bq = window.batchQueue;

      if (!bq.isRunning) {
        bq.start();
      } else if (bq.isPaused) {
        bq.resume();
      } else {
        bq.pause();
      }
    }

    _updateControls(isRunning, isPaused) {
      const playIcon = this.container.querySelector('.seosonaflow-queue-icon-play');
      const pauseIcon = this.container.querySelector('.seosonaflow-queue-icon-pause');

      if (isRunning && !isPaused) {
        playIcon.classList.add('hidden');
        pauseIcon.classList.remove('hidden');
      } else {
        playIcon.classList.remove('hidden');
        pauseIcon.classList.add('hidden');
      }

      if (!isRunning) {
        this._progressEl.classList.add('hidden');
      }
    }

    _updateProgress(data) {
      if (!data) return;
      this._progressEl.classList.remove('hidden');
      const completed = data.completed || 0;
      const total = data.total || 1;
      this._progressText.textContent = window.I18n?.t('queue.running', { completed, total }) || `Đang chạy ${completed}/${total}`;
      const pct = Math.round((completed / total) * 100);
      this._progressBar.style.width = pct + '%';
    }

    _updateList() {
      if (!window.batchQueue) return;
      const queue = window.batchQueue.queue;

      if (queue.length === 0) {
        this._listEl.classList.add('hidden');
        this._emptyEl.classList.remove('hidden');
        this._progressEl.classList.add('hidden');
        if (this._retryFailedBtn) this._retryFailedBtn.classList.add('hidden');
        return;
      }

      this._listEl.classList.remove('hidden');
      this._emptyEl.classList.add('hidden');

      // Update progress if running
      if (window.batchQueue.isRunning) {
        const status = window.batchQueue.getStatus();
        this._updateProgress({ completed: status.completed, total: status.total });
      }

      this._listEl.innerHTML = queue.map((item, index) => `
        <div class="seosonaflow-queue-item ${item.status === 'running' ? 'seosonaflow-queue-item--running' : ''} ${item.status === 'completed' ? 'seosonaflow-queue-item--completed' : ''} ${item.status === 'failed' ? 'seosonaflow-queue-item--failed' : ''}"
             data-index="${index}" draggable="true">
          <div class="seosonaflow-queue-item__drag">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" stroke="none">
              <circle cx="9" cy="5" r="2"></circle><circle cx="15" cy="5" r="2"></circle>
              <circle cx="9" cy="12" r="2"></circle><circle cx="15" cy="12" r="2"></circle>
              <circle cx="9" cy="19" r="2"></circle><circle cx="15" cy="19" r="2"></circle>
            </svg>
          </div>
          <div class="seosonaflow-queue-item__icon">
            ${this._getTypeIcon(item.type)}
          </div>
          <div class="seosonaflow-queue-item__info">
            <span class="seosonaflow-queue-item__name">${this._escapeHtml(item.name)}</span>
            ${item.priority > 0 ? `<span class="seosonaflow-queue-item__priority">P${item.priority}</span>` : ''}
          </div>
          <div class="seosonaflow-queue-item__status" ${item.status === 'failed' && item.error ? `title="${this._escapeAttr(item.error)}"` : ''}>
            ${this._getStatusIcon(item.status)}
          </div>
          ${item.status === 'failed' ? `<button class="seosonaflow-queue-item__retry" data-retry-index="${index}" title="${window.I18n?.t('queue.retryItem') || 'Chạy lại mục này'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </button>` : ''}
          <button class="seosonaflow-queue-item__delete" data-delete-index="${index}" title="${window.I18n?.t('common.delete') || 'Xóa'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      `).join('');

      // Bind delete buttons
      this._listEl.querySelectorAll('.seosonaflow-queue-item__delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.deleteIndex);
          if (window.batchQueue) window.batchQueue.remove(idx);
        });
      });

      // Bind per-item retry buttons (chỉ hiện trên item failed)
      this._listEl.querySelectorAll('.seosonaflow-queue-item__retry').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const idx = parseInt(btn.dataset.retryIndex);
          if (window.batchQueue) window.batchQueue.retryItem(idx);
        });
      });

      // Cập nhật nút "Retry tất cả lỗi" ở header
      this._updateRetryFailedBtn();

      // Bind drag events
      this._bindDragEvents();
    }

    _updateRetryFailedBtn() {
      if (!this._retryFailedBtn || !window.batchQueue) return;
      const n = window.batchQueue.getFailedCount?.() || 0;
      const countEl = this._retryFailedBtn.querySelector('.seosonaflow-queue-retryfailed-count');
      if (n > 0) {
        this._retryFailedBtn.classList.remove('hidden');
        if (countEl) countEl.textContent = n > 1 ? String(n) : '';
      } else {
        this._retryFailedBtn.classList.add('hidden');
      }
    }

    _updateAutoRetryBtn() {
      const btn = this.container.querySelector('#queueAutoRetryBtn');
      if (btn && window.batchQueue) btn.classList.toggle('active', !!window.batchQueue.autoRetry);
    }

    // [FIX 2026-07-09] Gỡ popup + document listener cùng lúc — tránh rò listener khi đóng bằng
    // toggle/option-click (trước đây chỉ remove popup, listener document tích lũy).
    _closeSchedPopupNow() {
      const p = this.container.querySelector('.seosonaflow-queue-schedule-popup');
      if (p) p.remove();
      if (this._closeSchedPopup) { document.removeEventListener('click', this._closeSchedPopup); this._closeSchedPopup = null; }
    }

    _toggleSchedulePopup(anchor) {
      // Đóng nếu đang mở
      if (this.container.querySelector('.seosonaflow-queue-schedule-popup')) { this._closeSchedPopupNow(); return; }
      if (!window.batchQueue) return;
      const t = (k, d) => window.I18n?.t(k) || d;
      const scheduled = window.batchQueue.getScheduledAt?.();
      const opts = [
        { m: 15, label: t('queue.sched15', 'Sau 15 phút') },
        { m: 30, label: t('queue.sched30', 'Sau 30 phút') },
        { m: 60, label: t('queue.sched1h', 'Sau 1 giờ') },
        { m: 120, label: t('queue.sched2h', 'Sau 2 giờ') },
      ];
      const pop = document.createElement('div');
      pop.className = 'seosonaflow-queue-schedule-popup';
      pop.innerHTML =
        `<div class="sqsp-note">${t('queue.schedNote', 'Sidebar phải mở tới lúc chạy')}</div>` +
        opts.map(o => `<button class="sqsp-opt" data-min="${o.m}">${o.label}</button>`).join('') +
        (scheduled ? `<button class="sqsp-opt sqsp-cancel" data-min="0">${t('queue.schedCancel', 'Hủy hẹn giờ')}</button>` : '');
      pop.addEventListener('click', (e) => e.stopPropagation());
      pop.querySelectorAll('.sqsp-opt').forEach(b => {
        b.addEventListener('click', () => {
          const min = parseInt(b.dataset.min);
          if (min === 0) {
            window.batchQueue.cancelSchedule();
            window.showNotification?.(t('queue.schedCancelled', 'Đã hủy hẹn giờ'), 'info', 2000);
          } else {
            if (!window.batchQueue.queue.some(i => i.status === 'pending')) {
              window.showNotification?.(t('queue.schedNoPending', 'Hàng đợi không có mục nào chờ chạy'), 'warning', 2500);
            } else {
              window.batchQueue.scheduleStart(min * 60000);
              window.showNotification?.(t('queue.schedSet', { min }) || `Đã hẹn chạy sau ${min} phút`, 'success', 2500);
            }
          }
          this._closeSchedPopupNow();
          this._updateScheduleChip();
        });
      });
      anchor.parentElement.style.position = anchor.parentElement.style.position || 'relative';
      anchor.parentElement.appendChild(pop);
      // click ra ngoài để đóng
      setTimeout(() => {
        this._closeSchedPopup = () => { pop.remove(); document.removeEventListener('click', this._closeSchedPopup); };
        document.addEventListener('click', this._closeSchedPopup);
      }, 0);
    }

    _updateScheduleChip() {
      if (!window.batchQueue) return;
      const at = window.batchQueue.getScheduledAt?.();
      let chip = this.container.querySelector('.seosonaflow-queue-sched-chip');
      const btn = this.container.querySelector('#queueScheduleBtn');
      if (btn) btn.classList.toggle('active', at != null);
      if (!at) { if (chip) chip.remove(); return; }
      const remain = Math.max(0, at - Date.now());
      const mm = Math.floor(remain / 60000);
      const ss = Math.floor((remain % 60000) / 1000);
      const label = `${mm}:${String(ss).padStart(2, '0')}`;
      if (!chip) {
        chip = document.createElement('div');
        chip.className = 'seosonaflow-queue-sched-chip';
        const prog = this.container.querySelector('.seosonaflow-queue-progress');
        (prog?.parentElement || this.container).insertBefore(chip, prog);
      }
      chip.textContent = '⏱ ' + (window.I18n?.t('queue.schedRunIn', { time: label }) || `Chạy sau ${label}`);
    }

    _bindDragEvents() {
      const items = this._listEl.querySelectorAll('.seosonaflow-queue-item');
      items.forEach(item => {
        item.addEventListener('dragstart', (e) => {
          this._dragState = { fromIndex: parseInt(item.dataset.index) };
          item.classList.add('seosonaflow-queue-item--dragging');
          e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          item.classList.add('seosonaflow-queue-item--drag-over');
        });

        item.addEventListener('dragleave', () => {
          item.classList.remove('seosonaflow-queue-item--drag-over');
        });

        item.addEventListener('drop', (e) => {
          e.preventDefault();
          item.classList.remove('seosonaflow-queue-item--drag-over');
          if (this._dragState) {
            const toIndex = parseInt(item.dataset.index);
            if (window.batchQueue) {
              window.batchQueue.reorder(this._dragState.fromIndex, toIndex);
            }
          }
        });

        item.addEventListener('dragend', () => {
          item.classList.remove('seosonaflow-queue-item--dragging');
          this._dragState = null;
        });
      });
    }

    _getTypeIcon(type) {
      switch (type) {
        case 'prompt':
          return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a3 3 0 0 0 -3 3v12a3 3 0 0 0 3 3"></path><path d="M6 3a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3"></path><path d="M13 7h7a1 1 0 0 1 1 1v8a1 1 0 0 1 -1 1h-7"></path><path d="M5 7h-1a1 1 0 0 0 -1 1v8a1 1 0 0 0 1 1h1"></path><path d="M17 12h.01"></path><path d="M13 12h.01"></path></svg>';
        case 'task':
          return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 11l3 3L22 4"></path><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path></svg>';
        case 'workflow':
          return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="18" r="3"></circle><circle cx="6" cy="6" r="3"></circle><path d="M13 6h3a2 2 0 0 1 2 2v7"></path><path d="M6 9v12"></path></svg>';
        default:
          return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle></svg>';
      }
    }

    _getStatusIcon(status) {
      switch (status) {
        case 'running':
          return '<span class="seosonaflow-queue-item__spinner"></span>';
        case 'completed':
          return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        case 'failed':
          return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--destructive)" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
        default:
          return '';
      }
    }

    _escapeHtml(str) {
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    // Escape cho giá trị attribute (title="…") — bao gồm dấu ngoặc kép.
    _escapeAttr(str) {
      return String(str == null ? '' : str)
        .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
        .replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    destroy() {
      if (this._scheduleTick) { clearInterval(this._scheduleTick); this._scheduleTick = null; }
      if (this._closeSchedPopup) { document.removeEventListener('click', this._closeSchedPopup); this._closeSchedPopup = null; }
      // Cleanup event listeners
      if (this._boundHandlers.onChange) {
        window.eventBus.off('queue:changed', this._boundHandlers.onChange);
        window.eventBus.off('queue:started', this._boundHandlers.onStarted);
        window.eventBus.off('queue:paused', this._boundHandlers.onPaused);
        window.eventBus.off('queue:resumed', this._boundHandlers.onResumed);
        window.eventBus.off('queue:stopped', this._boundHandlers.onStopped);
        window.eventBus.off('queue:complete', this._boundHandlers.onComplete);
        window.eventBus.off('queue:item-complete', this._boundHandlers.onItemComplete);
      }
      this.container.innerHTML = '';
    }
  }

  window.QueuePanel = QueuePanel;
})();
