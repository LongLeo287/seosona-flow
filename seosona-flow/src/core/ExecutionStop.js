/**
 * ExecutionStop — "Force Stop All" (nút Stop nặng) DÙNG CHUNG.
 * Extract VERBATIM từ ExecutionTracker._handleStop — giữ NGUYÊN logic dừng + quota/token
 * (bug 2 = refund toàn bộ, bug 54 = quên cancelAll). Tham số hoá `pipelineMode`.
 *
 * Dùng bởi: nút "Dừng tất cả" ở footer sidebar (sau khi bỏ tracker sidebar, đây là đường
 * dừng độc lập tab Flow — chạy trong context sidebar nên hoạt động dù tab Flow stale/đóng).
 */
(function (root) {
  root.ExecutionStop = {
    /**
     * Dừng TẤT CẢ tác vụ (task/workflow/pipeline) + abort chat/grok/flow + rollback quota.
     * @param {{pipelineMode?: boolean}} [opts]
     */
    forceStopAll(opts) {
      const pipelineMode = !!(opts && opts.pipelineMode);
      console.log('[ExecutionStop] forceStopAll called, pipelineMode=', pipelineMode);

      // 1. Global stop flags cho task/workflow
      root._taskShouldStop = true;
      root._taskBatchStopped = true;

      // 2. Stop workflow executor
      if (root.workflowExecutor && root.workflowExecutor.isRunning) {
        root.workflowExecutor.shouldStop = true;
        root.workflowExecutor.isRunning = false;
      }

      // 2b. Clear cross-context af_running_workflow flag (tránh stuck khi await hang)
      try { root.WorkflowExecutor && root.WorkflowExecutor.clearCrossContextRunning && root.WorkflowExecutor.clearCrossContextRunning(); } catch (e) { /* ignore */ }

      // 3. KHÔNG cancel main task token ở đây (bug 2 fix). Vẫn cleanup để cancelAll idempotent.
      root._currentTaskExecutionToken = null;

      // 3b. Bug 54: cancel TẤT CẢ active tokens → server rollback quota.
      if (root.ExecutionGate && root.ExecutionGate.cancelAll) {
        const p = root.ExecutionGate.cancelAll();
        if (p && p.catch) p.catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionStop#forceStopAll', _e); });
      }

      // 4. Stop Flow content script
      if (root.MessageBridge) root.MessageBridge.stopExecution().catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionStop#forceStopAll', _e); });

      // 5. Abort Grok session
      if (root.GrokSession && root.GrokSession.getTabInfo) {
        root.GrokSession.getTabInfo().then((info) => {
          if (info && info.tabId) root.MessageBridge && root.MessageBridge.grokAbort(info.tabId).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionStop#forceStopAll', _e); });
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionStop#forceStopAll', _e); });
      }

      // 6. Abort ChatGPT session
      if (root.ChatGPTSession && root.ChatGPTSession.getTabInfo) {
        root.ChatGPTSession.getTabInfo().then((info) => {
          if (info && info.tabId) root.MessageBridge && root.MessageBridge.chatgptAbort(info.tabId).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionStop#forceStopAll', _e); });
        }).catch(function (_e) { globalThis.SEOSONA_swallow?.('ExecutionStop#forceStopAll', _e); });
      }

      // 7. Pipeline mode: dừng qua PromptQueue
      if (pipelineMode && root.PromptQueue) {
        const queue = root.PromptQueue.getInstance();
        if (queue) queue.stopAll();
      }

      // 8. Legacy mode: dừng qua ExecutionLock
      if (root.ExecutionLock) root.ExecutionLock.stopCurrent();

      // 9. Emit stop event
      root.eventBus && root.eventBus.emit('execution:force_stopped');

      // 10. Notify
      root.showNotification && root.showNotification(
        (root.I18n && root.I18n.t && root.I18n.t('exec.forceStopped')) || 'Đã dừng tất cả tác vụ',
        'warning', 2000
      );

      console.log('[ExecutionStop] forceStopAll completed');
    }
  };
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this));
