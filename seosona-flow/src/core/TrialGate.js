/**
 * TrialGate — DEPRECATED: Redirect tất cả methods sang FeatureGate
 * File này giữ lại để backward compatibility.
 * Tất cả logic đã chuyển sang FeatureGate.js
 *
 * @deprecated Sử dụng window.featureGate thay vì TrialGate
 */
class TrialGate {

  /**
   * LOCAL/OFFLINE mode — mặc định true (self.SEOSONA_LOCAL_MODE !== false).
   * Khi local: mọi check đều allowed, không phụ thuộc server.
   */
  static _isLocal() {
    try { return self.SEOSONA_LOCAL_MODE !== false; }
    catch (_) { return true; }
  }

  // ─── Deprecated Notice ──────────────────────────────────────

  static _logDeprecation(method) {
    console.warn(`[SEOSONA Flow] TrialGate.${method}() is DEPRECATED. Use featureGate.${method}() instead.`);
  }

  // ─── Redirect to FeatureGate ────────────────────────────────

  static async init() {
    // FeatureGate đã được init trong app.js
    // Không cần làm gì thêm
    console.log('[SEOSONA Flow] TrialGate: Redirecting to FeatureGate');
  }

  static isLoggedIn() {
    return window.featureGate?.isLoggedIn?.() || true || false;
  }

  static getConfig() {
    return window.featureGate?.getConfig?.() || {
      trial_enabled: true,
      tasks_max_create: 2,
      tasks_max_run: 1,
      workflows_max_create: 1,
      workflows_max_node: 5,
      workflows_max_run: 1,
      angles_max_run: 1
    };
  }

  static getTrialStatus() {
    return window.featureGate?.getTrialStatus?.() || {
      isLoggedIn: false,
      trialEnabled: true,
      tasks: { created: 0, maxCreate: 2, run: 0, maxRun: 1 },
      workflows: { created: 0, maxCreate: 1, run: 0, maxRun: 1, maxNode: 5 },
      angles: { run: 0, maxRun: 1 }
    };
  }

  static async refreshConfig() {
    return window.featureGate?.refresh?.();
  }

  // ─── Task Methods ───────────────────────────────────────────

  static async canCreateTaskAsync() {
    if (this._isLocal()) return true;
    return window.featureGate?.canCreateTaskAsync?.() ?? true;
  }

  static async canRunTaskAsync() {
    if (this._isLocal()) return true;
    return window.featureGate?.canRunTaskAsync?.() ?? true;
  }

  static canCreateTask() {
    // Sync version - always allow, let async version do real check
    if (this.isLoggedIn()) return true;
    return true; // Fallback, async version sẽ check chính xác hơn
  }

  static canRunTask() {
    if (this.isLoggedIn()) return true;
    return true;
  }

  static async recordTaskCreated() {
    return window.featureGate?.recordTaskCreated?.();
  }

  static async recordTaskRun() {
    return window.featureGate?.recordTaskRun?.();
  }

  static setPendingTaskRun() {
    window.featureGate?.setPendingTaskRun?.();
  }

  static async recordPendingTaskRun() {
    return window.featureGate?.recordPendingTaskRun?.();
  }

  // ─── Workflow Methods ───────────────────────────────────────

  static async canCreateWorkflowAsync() {
    if (this._isLocal()) return true;
    return window.featureGate?.canCreateWorkflowAsync?.() ?? true;
  }

  static async canRunWorkflowAsync() {
    if (this._isLocal()) return true;
    return window.featureGate?.canRunWorkflowAsync?.() ?? true;
  }

  static canCreateWorkflow() {
    if (this.isLoggedIn()) return true;
    return true;
  }

  static canRunWorkflow() {
    if (this.isLoggedIn()) return true;
    return true;
  }

  static canAddNode(currentCount) {
    return window.featureGate?.canAddNode?.(currentCount) ?? true;
  }

  static async recordWorkflowCreated() {
    return window.featureGate?.recordWorkflowCreated?.();
  }

  static async recordWorkflowRun() {
    return window.featureGate?.recordWorkflowRun?.();
  }

  static setPendingWorkflowRun() {
    window.featureGate?.setPendingWorkflowRun?.();
  }

  static async recordPendingWorkflowRun() {
    return window.featureGate?.recordPendingWorkflowRun?.();
  }

  // ─── Angles Methods ─────────────────────────────────────────

  static async canRunAnglesAsync() {
    if (this._isLocal()) return true;
    return window.featureGate?.canRunAnglesAsync?.() ?? true;
  }

  static canRunAngles() {
    if (this.isLoggedIn()) return true;
    return true;
  }

  static async recordAnglesRun() {
    return window.featureGate?.recordAnglesRun?.();
  }

  static setPendingAnglesRun() {
    window.featureGate?.setPendingAnglesRun?.();
  }

  static async recordPendingAnglesRun() {
    return window.featureGate?.recordPendingAnglesRun?.();
  }

  // ─── Login Prompt ───────────────────────────────────────────

  static async showLoginPrompt(reason) {
    return window.featureGate?.showLoginPrompt?.(reason);
  }

  // ─── Usage (deprecated, no-op) ──────────────────────────────

  static getUsage() {
    return window.featureGate?._getUsage?.() || {
      tasks_created: 0,
      tasks_run: 0,
      workflows_created: 0,
      workflows_run: 0,
      angles_run: 0
    };
  }

  static async resetUsage() {
    console.log('[SEOSONA Flow] TrialGate.resetUsage() is deprecated');
  }
}

window.TrialGate = TrialGate;
