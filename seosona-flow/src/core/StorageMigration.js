/**
 * StorageMigration - Phase 2/2b storage cleanup and migration.
 *
 * Tasks:
 * 1. Remove deprecated keys (af_validation_rules, etc.)
 * 2. Mark deprecated execution fields in af_settings (Phase 2b)
 *
 * Server-Only Architecture: Some keys moved to server, local cache only.
 */
class StorageMigration {
  // LOCAL MODE: mặc định true (offline). Local migrations vẫn chạy bình thường;
  // chỉ bỏ qua các bước liên quan server-synced keys.
  static _isLocalMode() {
    try { return self.SEOSONA_LOCAL_MODE !== false; } catch (_) { return true; }
  }

  // Keys deprecated in Phase 2 - can be safely removed
  static DEPRECATED_KEYS = [
    'af_validation_rules', // Server fetch mandatory (ValidationRules.js)
  ];

  // Keys that are server-synced - local is cache only
  static SERVER_SYNCED_KEYS = [
    'af_daily_stats',      // UsageSync already syncs to server
    'seosona_provider_configs', // ProviderConfigManager cache
    'af_execution_config', // ExecutionConfig cache (Phase 2c)
  ];

  // Phase 2b: Deprecated execution fields in af_settings
  // These are now server-controlled via ExecutionConfig
  static DEPRECATED_SETTINGS_FIELDS = [
    // Workflow execution (now in ExecutionConfig.getWorkflowConfig())
    'execDelayNodes',
    'execMaxRetries',
    'execTimeout',
    'execOnError',
    // Timing (now in ExecutionConfig.getTimingConfig())
    'delayBetweenPrompts',
    // Queue (now in ExecutionConfig.getQueueConfig())
    'queueBatchSize',
    'queueMaxMonitor',
    'queueRestMin',
    'queueRestMax',
    // FAR (now in ExecutionConfig.getFlowRecoveryConfig())
    'flowSessionRefreshEnabled',
    'flowSessionRefreshIntervalMin',
    'flowAutoRecoveryEnabled',
    'flowConsecutiveFailThreshold',
    'flowBackoffBaseSec',
    'flowBackoffMaxSec',
    'flowBackoffJitterPercent',
    // K.4 (2026-05-29): Dead legacy keys — 0 UI, 0 consumer trong extension
    'parallelThreads',
    'chatgptPrepandPrefix', // typo legacy, actual = chatgptFallbackPrefix
    'sidebarPosition',
    'sidebarWidth',
  ];

  /**
   * Run migration on extension startup.
   * Safe to run multiple times (idempotent).
   */
  static async run() {
    console.log('[StorageMigration] Starting Phase 2/2b migration...');

    // 1. Remove deprecated keys
    await this.removeDeprecatedKeys();

    // 2. Verify server sync keys (just log, don't remove)
    // LOCAL MODE: không có server → bỏ qua bước verify server-synced keys.
    if (!this._isLocalMode()) {
      await this.verifyServerSyncKeys();
    }

    // 3. Phase 2b: Clean deprecated execution fields from af_settings
    await this.cleanDeprecatedSettingsFields();

    console.log('[StorageMigration] Phase 2/2b migration complete');
  }

  /**
   * Remove deprecated keys from chrome.storage.local.
   */
  static async removeDeprecatedKeys() {
    try {
      const existing = await chrome.storage.local.get(this.DEPRECATED_KEYS);
      const keysToRemove = Object.keys(existing).filter(k => existing[k] !== undefined);

      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
        console.log('[StorageMigration] Removed deprecated keys:', keysToRemove);
      } else {
        console.log('[StorageMigration] No deprecated keys to remove');
      }
    } catch (e) {
      console.warn('[StorageMigration] Error removing deprecated keys:', e.message);
    }
  }

  /**
   * Verify server-synced keys exist (logging only).
   */
  static async verifyServerSyncKeys() {
    try {
      const existing = await chrome.storage.local.get(this.SERVER_SYNCED_KEYS);
      for (const key of this.SERVER_SYNCED_KEYS) {
        if (existing[key]) {
          console.log(`[StorageMigration] Server-synced key "${key}" exists (cache)`);
        }
      }
    } catch (e) {
      console.warn('[StorageMigration] Error verifying server sync keys:', e.message);
    }
  }

  /**
   * Phase 2b: Clean deprecated execution fields from af_settings.
   * These fields are now server-controlled via ExecutionConfig.
   * Removing them prevents confusion and ensures server values are used.
   */
  static async cleanDeprecatedSettingsFields() {
    try {
      const data = await chrome.storage.local.get(['af_settings']);
      if (!data.af_settings) {
        console.log('[StorageMigration] No af_settings to clean');
        return;
      }

      const settings = { ...data.af_settings };
      let cleaned = 0;
      const cleanedFields = [];

      for (const field of this.DEPRECATED_SETTINGS_FIELDS) {
        if (settings[field] !== undefined) {
          cleanedFields.push(`${field}=${settings[field]}`);
          delete settings[field];
          cleaned++;
        }
      }

      if (cleaned > 0) {
        await chrome.storage.local.set({ af_settings: settings });
        console.log(`[StorageMigration] ✓ Cleaned ${cleaned} deprecated fields from af_settings:`);
        cleanedFields.forEach(f => console.log(`  - ${f}`));
      } else {
        console.log('[StorageMigration] ✓ No deprecated fields to clean (already clean)');
      }

      // Phase 2c Test: Log remaining settings keys for verification
      const remainingKeys = Object.keys(settings).sort();
      console.log('[StorageMigration] Remaining af_settings keys:', remainingKeys.length);
      if (remainingKeys.length <= 30) {
        console.log('  ', remainingKeys.join(', '));
      }
    } catch (e) {
      console.warn('[StorageMigration] Error cleaning deprecated fields:', e.message);
    }
  }

  /**
   * Future: Migrate af_settings → af_user_prefs.
   * Currently NOT needed because we're keeping af_settings key name.
   * This is here for documentation and future use.
   */
  static async migrateSettingsKey() {
    try {
      const data = await chrome.storage.local.get(['af_settings', 'af_user_prefs']);

      // Already migrated or nothing to migrate
      if (data.af_user_prefs || !data.af_settings) {
        console.log('[StorageMigration] Settings key already migrated or empty');
        return;
      }

      // Copy af_settings → af_user_prefs
      await chrome.storage.local.set({ af_user_prefs: data.af_settings });

      // Remove old key
      await chrome.storage.local.remove(['af_settings']);

      console.log('[StorageMigration] Migrated af_settings → af_user_prefs');
    } catch (e) {
      console.warn('[StorageMigration] Error migrating settings key:', e.message);
    }
  }

  /**
   * Get storage usage stats for debugging.
   */
  static async getStorageStats() {
    try {
      const all = await chrome.storage.local.get(null);
      const keys = Object.keys(all);
      const sizes = {};

      for (const key of keys) {
        const json = JSON.stringify(all[key]);
        sizes[key] = json.length;
      }

      // Sort by size descending
      const sorted = Object.entries(sizes).sort((a, b) => b[1] - a[1]);

      console.log('[StorageMigration] Storage stats:');
      for (const [key, size] of sorted.slice(0, 10)) {
        console.log(`  ${key}: ${(size / 1024).toFixed(1)} KB`);
      }

      return sizes;
    } catch (e) {
      console.warn('[StorageMigration] Error getting storage stats:', e.message);
      return {};
    }
  }
}

// Export
window.StorageMigration = StorageMigration;
