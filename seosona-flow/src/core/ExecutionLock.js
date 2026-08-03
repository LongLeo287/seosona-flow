/**
 * ExecutionLock - Quản lý quyền truy cập Google Flow
 *
 * Tại mỗi thời điểm chỉ có 1 tác vụ được sử dụng Flow editor.
 * Các tác vụ khác phải chờ hoặc yêu cầu dừng tác vụ hiện tại.
 *
 * Owner types: 'prompts' | 'task' | 'workflow' | 'angles' | 'effects' | 'queue'
 */
class ExecutionLock {
  static _owner = null;    // 'prompts' | 'task' | 'workflow' | 'angles' | 'queue' | null
  static _label = '';      // Tên hiển thị: "Task: Tạo ảnh SP" | "Workflow: Banner"
  static _lockedAt = null; // Timestamp

  // ===== C1 fix: cross-context lease (storage-lease-with-TTL) =====
  // Lock static per-page KHÔNG khoá được liên-context (side panel + popup workflow/angles là các
  // JS context riêng, không share static). Thêm 1 lease record trong chrome.storage.local với
  // { owner, label, contextId, lockedAt } + TTL: holder crash (không release) → lease hết hạn →
  // context khác acquire được. Ngoài ra back bằng navigator.locks khi có (best-effort, non-blocking).
  static LEASE_KEY = 'seosona_exec_lease';
  static LEASE_TTL_MS = 5 * 60 * 1000; // 5 phút — dài hơn 1 chu kỳ submit, đủ để crash auto-release
  static WEBLOCK_NAME = 'seosona-exec-lock';
  static _remoteLease = null;   // Cached mirror của lease từ context khác (cập nhật qua broadcast + storage)
  static _webLockRelease = null; // fn để release navigator.locks (nếu đang giữ)

  /**
   * Lấy trạng thái lock hiện tại
   */
  static getState() {
    return {
      locked: this._owner !== null,
      owner: this._owner,
      label: this._label,
      lockedAt: this._lockedAt
    };
  }

  /**
   * C1: Kiểm tra có lease còn hiệu lực từ context KHÁC không (dựa cached mirror + TTL).
   * @returns {object|null} lease record nếu còn hiệu lực từ context khác, ngược lại null
   */
  static _foreignLeaseActive() {
    const lease = this._remoteLease;
    if (!lease) return null;
    if (lease.contextId === this._contextId) return null; // lease của chính mình → bỏ qua
    // Hết hạn (holder crash / quên release) → coi như free
    if (!lease.lockedAt || (Date.now() - lease.lockedAt) > this.LEASE_TTL_MS) return null;
    return lease;
  }

  /**
   * C1: Ghi lease record (best-effort, không block acquire flow đồng bộ).
   */
  static _writeLease() {
    const lease = {
      owner: this._owner,
      label: this._label,
      contextId: this._contextId,
      lockedAt: this._lockedAt || Date.now(),
    };
    this._remoteLease = lease; // mirror local ngay
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try { chrome.storage.local.set({ [ExecutionLock.LEASE_KEY]: lease }); } catch (_) { globalThis.SEOSONA_swallow?.('ExecutionLock', _); }
    }
    // Best-effort: giữ navigator.locks (giải phóng khi release/forceRelease qua _webLockRelease).
    if (typeof navigator !== 'undefined' && navigator.locks?.request && !this._webLockRelease) {
      try {
        navigator.locks.request(this.WEBLOCK_NAME, { ifAvailable: true }, (lock) => {
          if (!lock) return; // context khác đang giữ — chấp nhận (storage-lease là nguồn sự thật chính)
          return new Promise((resolve) => { this._webLockRelease = resolve; });
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionLock', _e); });
      } catch (_) { globalThis.SEOSONA_swallow?.('ExecutionLock', _); }
    }
  }

  /**
   * C1: Xoá lease record khi release (chỉ khi lease thuộc context này).
   */
  static _clearLease() {
    if (this._remoteLease?.contextId === this._contextId) this._remoteLease = null;
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      // Chỉ remove nếu lease trong storage là của mình (tránh stomp lease context khác vừa claim)
      try {
        chrome.storage.local.get([ExecutionLock.LEASE_KEY], (res) => {
          const lease = res?.[ExecutionLock.LEASE_KEY];
          if (!lease || lease.contextId === this._contextId) {
            try { chrome.storage.local.remove(ExecutionLock.LEASE_KEY); } catch (_) { globalThis.SEOSONA_swallow?.('ExecutionLock', _); }
          }
        });
      } catch (_) { globalThis.SEOSONA_swallow?.('ExecutionLock', _); }
    }
    if (this._webLockRelease) { try { this._webLockRelease(); } catch (_) { globalThis.SEOSONA_swallow?.('ExecutionLock', _); } this._webLockRelease = null; }
  }

  /**
   * Thử acquire lock. Trả về true nếu thành công.
   * @param {string} owner - 'prompts' | 'task' | 'workflow'
   * @param {string} label - Tên hiển thị cho UI
   * @returns {boolean}
   */
  static acquire(owner, label = '') {
    // Pipeline mode bật → cho phép nhiều source hoạt động đồng thời (không exclusive).
    // Check TRƯỚC foreign-lease vì queue orchestrate xen kẽ, không cần mutual exclusion.
    const pipelineOn = !!(window.PromptQueue && PromptQueue.isEnabled());

    if (this._owner === null) {
      // C1: local free — nhưng context KHÁC có thể đang giữ lease (side panel vs popup).
      // Nếu lease còn hiệu lực từ context khác và không phải pipeline mode → từ chối.
      if (!pipelineOn) {
        const foreign = this._foreignLeaseActive();
        if (foreign && foreign.owner && foreign.owner !== owner) {
          console.warn('[ExecutionLock] acquire denied — foreign lease active:', foreign.owner, foreign.label);
          return false;
        }
      }
      this._owner = owner;
      this._label = label;
      this._lockedAt = Date.now();
      this._writeLease(); // C1: publish lease cho context khác thấy
      this._emitChange();
      return true;
    }

    // Cùng owner type → cho phép (ví dụ: task batch chạy nhiều tasks)
    if (this._owner === owner) {
      this._label = label;
      this._lockedAt = Date.now(); // refresh lease timestamp (renew TTL)
      this._writeLease();
      return true;
    }

    // Pipeline mode bật → cho phép nhiều source hoạt động đồng thời
    // PromptQueue orchestrate xen kẽ prompts, không cần exclusive lock
    if (pipelineOn) {
      return true;
    }

    return false;
  }

  /**
   * Giải phóng lock
   * @param {string} owner - Chỉ owner hiện tại mới được release
   */
  static release(owner) {
    if (this._owner === owner) {
      this._owner = null;
      this._label = '';
      this._lockedAt = null;
      this._clearLease(); // C1: xoá lease record
      this._emitChange();
    }
  }

  /**
   * Force release (dùng khi stop tác vụ đang chạy)
   */
  static forceRelease() {
    this._owner = null;
    this._label = '';
    this._lockedAt = null;
    this._clearLease(); // C1: xoá lease record
    this._emitChange();
  }

  /**
   * Kiểm tra có bị lock bởi owner khác không
   * @param {string} owner - Owner muốn kiểm tra
   * @returns {boolean} true nếu đang bị block
   */
  static isBlockedBy(owner) {
    // Pipeline mode bật → không block, cho phép enqueue vào queue
    if (window.PromptQueue && PromptQueue.isEnabled()) {
      return false;
    }
    // Pipeline đang chạy (owner='queue') → không chặn các owner khác enqueue
    if (this._owner === 'queue') return false;
    return this._owner !== null && this._owner !== owner;
  }

  /**
   * Kiểm tra có đang ở chế độ pipeline queue không
   */
  static isQueueMode() {
    return this._owner === 'queue';
  }

  /**
   * Hiển thị dialog khi bị block
   * @param {string} requestingOwner - Owner đang muốn chạy
   * @returns {Promise<boolean>} true nếu user chọn "Dừng & chạy mới"
   */
  static async showBlockedDialog(requestingOwner) {
    const ownerLabels = {
      prompts: 'Prompt',
      task: 'Task',
      workflow: 'Workflow',
      angles: 'Angles',
      effects: 'Effects',
      queue: 'Queue'
    };

    const currentLabel = this._label || ownerLabels[this._owner] || this._owner;
    const requestLabel = ownerLabels[requestingOwner] || requestingOwner;

    if (!window.customDialog) {
      console.warn('[ExecutionLock] customDialog chưa sẵn sàng');
      return false;
    }

    const result = await window.customDialog.confirm(
      window.I18n?.t('exec.flowBusyMessage', { label: currentLabel }) || `Đang chạy: ${currentLabel}\n\nBạn cần dừng tác vụ hiện tại trước khi chạy ${requestLabel}.`,
      {
        title: window.I18n?.t('msg.flowBusy') || 'Google Flow đang bận',
        confirmText: window.I18n?.t('exec.stopAndContinue') || 'Dừng và chạy mới',
        cancelText: window.I18n?.t('common.cancel') || 'Hủy'
      }
    );

    return result;
  }

  /**
   * Dừng tác vụ hiện tại
   * @returns {Promise<boolean>} true nếu dừng thành công
   */
  static async stopCurrent() {
    if (!this._owner) return true;

    const owner = this._owner;

    try {
      if (owner === 'prompts') {
        // Dừng prompt execution
        if (window.MessageBridge) {
          await MessageBridge.stopExecution().catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionLock', _e); });
        }
      } else if (owner === 'task') {
        // Dừng task execution
        window._taskShouldStop = true;
        window._taskBatchStopped = true;
        if (window.MessageBridge) {
          await MessageBridge.stopExecution().catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionLock', _e); });
        }
        if (window.eventBus) {
          window.eventBus.emit('tasks:stop_all');
        }
      } else if (owner === 'workflow') {
        // Dừng workflow execution
        if (window.workflowExecutor) {
          await window.workflowExecutor.stop();
        }
      } else if (owner === 'angles') {
        // Dừng angles execution
        if (window.angleExecution) {
          window.angleExecution.stop();
        }
        if (window.MessageBridge) {
          await MessageBridge.stopExecution().catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionLock', _e); });
        }
      } else if (owner === 'effects') {
        // Dừng effects execution
        if (window.effectsExecution) {
          window.effectsExecution.stop();
        }
        if (window.MessageBridge) {
          await MessageBridge.stopExecution().catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionLock', _e); });
        }
      } else if (owner === 'queue') {
        // Dừng toàn bộ pipeline queue
        window.eventBus?.emit('queue:stop_all');
      }

      // M9 fix: đừng force-release mù sau 500ms. Poll cờ isRunning của executor tương ứng (ack đã
      // dừng) tới khi tác vụ thực sự unwind, với timeout tổng 3s để không kẹt vĩnh viễn.
      // Trước fix: 500ms rồi forceRelease → tác vụ tiếp theo giành lock trong khi chuỗi async cũ chưa
      // unwind → gõ vào Flow đè lên nhau → prompt/ref sai.
      await this._waitForStopAck(owner, 3000);
      this.forceRelease();
      return true;
    } catch (err) {
      console.error('[ExecutionLock] Lỗi khi dừng tác vụ:', err);
      this.forceRelease();
      return true;
    }
  }

  /**
   * M9: Poll cờ running của executor cho owner cho tới khi ack stopped hoặc hết timeout.
   * @param {string} owner
   * @param {number} timeoutMs - timeout tổng (mặc định 3s)
   * @returns {Promise<boolean>} true nếu ack stopped, false nếu timeout
   */
  static async _waitForStopAck(owner, timeoutMs = 3000) {
    // Hàm trả về true khi executor tương ứng đã dừng (không còn running).
    const isStopped = () => {
      switch (owner) {
        case 'workflow':
          return !window.workflowExecutor || window.workflowExecutor.isRunning === false;
        case 'angles':
          // angleExecution có thể expose isRunning; nếu không → coi như đã stop (best-effort).
          return !window.angleExecution || window.angleExecution.isRunning !== true;
        case 'effects':
          return !window.effectsExecution || window.effectsExecution.isRunning !== true;
        case 'task':
          // Task dùng global flags (đã set ở nhánh 'task' phía trên) — ack qua _taskBatchStopped.
          return window._taskBatchStopped === true;
        case 'queue':
          // Pipeline: EditorExecutor không còn chạy.
          return !window.PromptQueue?.getInstance?.()?._editorExecutor?.isRunning;
        case 'prompts':
        default:
          // prompts dừng qua MessageBridge.stopExecution (không có cờ đồng bộ rõ) → best-effort poll ngắn.
          return false;
      }
    };
    const start = Date.now();
    // Poll tối thiểu 1 lần; đảm bảo có 1 khoảng nghỉ nhỏ để chuỗi async unwind.
    while (Date.now() - start < timeoutMs) {
      if (isStopped()) {
        // Grace nhỏ để callback/finally cuối cùng chạy xong.
        await new Promise(r => setTimeout(r, 100));
        return true;
      }
      await new Promise(r => setTimeout(r, 150));
    }
    console.warn(`[ExecutionLock] _waitForStopAck timeout (${timeoutMs}ms) cho owner=${owner} — force-release anyway`);
    return false;
  }

  /**
   * Broadcast tracker update cross-window
   * Gọi từ popup windows (angles, effects, workflow) để sidePanel nhận
   */
  static broadcastTracker(data) {
    if (window.eventBus) {
      window.eventBus.emit('execution:tracker_update', data);
    }
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        action: 'execution:tracker_broadcast',
        data,
        _originId: this._contextId,
      }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionLock#isStopped', _e); });
    }
  }

  /**
   * Emit event khi trạng thái thay đổi
   * Broadcast cross-window qua chrome.runtime.sendMessage
   */
  static _emitChange() {
    const state = this.getState();
    if (window.eventBus) {
      window.eventBus.emit('execution:lock_changed', state);
    }
    // Broadcast đến các window khác (sidePanel ↔ popup windows)
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        action: 'execution:lock_broadcast',
        state,
        _originId: this._contextId,
      }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionLock#isStopped', _e); });
    }
  }
}

// Unique context ID per browser context (sidebar, popup window, etc).
// Background relay broadcasts đến TẤT CẢ contexts kể cả sender → self-echo.
// Receiver dùng _originId để filter: nếu broadcast từ chính mình → skip local re-emit
// (vì local eventBus đã emit ngay trong _emitChange/broadcastTracker rồi).
ExecutionLock._contextId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

// ===== C1: đồng bộ lease mirror cross-context qua chrome.storage.onChanged =====
// storage.onChanged là kênh cross-context tin cậy (mọi extension context nhận cùng event).
// _remoteLease luôn phản ánh lease mới nhất → acquire() (đồng bộ) check được TTL mà không cần await.
(function _initExecutionLockLease() {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  // Load lease hiện có lúc khởi động (context mở sau khi context khác đã giữ lock).
  try {
    chrome.storage.local.get([ExecutionLock.LEASE_KEY], (res) => {
      const lease = res?.[ExecutionLock.LEASE_KEY];
      if (lease && lease.contextId !== ExecutionLock._contextId) {
        ExecutionLock._remoteLease = lease;
      }
    });
  } catch (_) { globalThis.SEOSONA_swallow?.('ExecutionLock#_initExecutionLockLease', _); }
  // Theo dõi thay đổi lease từ context khác.
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes[ExecutionLock.LEASE_KEY]) return;
      const newLease = changes[ExecutionLock.LEASE_KEY].newValue || null;
      // Bỏ qua thay đổi do chính mình ghi (đã mirror local trong _writeLease/_clearLease).
      if (newLease && newLease.contextId === ExecutionLock._contextId) return;
      ExecutionLock._remoteLease = newLease;
    });
  } catch (_) { globalThis.SEOSONA_swallow?.('ExecutionLock#_initExecutionLockLease', _); }
})();

window.ExecutionLock = ExecutionLock;
