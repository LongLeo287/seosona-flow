/**
 * ServerHealthCheck - SEOSONA Flow (Offline Mode)
 *
 * Extension chạy hoàn toàn offline. Luôn trả về healthy.
 */
class ServerHealthCheck {
  static async check(forceRefresh = false) {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: always healthy, no backend */ return true; }
    return true;
  }

  static showOfflineOverlay() {
    // No-op: offline overlay disabled
  }

  static hideOfflineOverlay() {
    const overlay = document.getElementById('seosonaflow-offline-overlay');
    if (overlay) overlay.classList.add('hidden');
  }

  static async checkAndBlock() {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: always healthy, never block */ this.hideOfflineOverlay(); return true; }
    this.hideOfflineOverlay();
    return true;
  }

  static reset() {
    // No-op
  }
}

window.ServerHealthCheck = ServerHealthCheck;
