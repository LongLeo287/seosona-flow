// Boot angles editor in standalone window mode
(async function() {
  'use strict';

  // Wait for DOM
  await new Promise(r => document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', r) : r());

  // Init EventBus
  if (!window.eventBus && typeof EventBus !== 'undefined') {
    window.eventBus = new EventBus();
  }

  // Initialize i18n
  if (window.I18n) {
    await window.I18n.init();
    window.I18n.applyTranslations(document.body);
  }

  // Wait for StorageSettings to load settings (auto-init runs on script load)
  // Cần cho PromptQueue.isEnabled() hoạt động đúng
  if (window.storageSettings) {
    await window.storageSettings.loadAndApply();
    console.log('[AngleEditor] StorageSettings ready, queueEnabled:', window.storageSettings.getSettings()?.queueEnabled);
  }

  // Background fetch ChatGPT + Grok error patterns (admin-tunable) — không block init
  try { window.ChatGPTConfig?.fetchInBackground?.(); } catch (e) { /* ignore */ }
  try { window.GrokConfig?.fetchInBackground?.(); } catch (e) { /* ignore */ }

  // Init AuthManager (must be before StorageManager)
  if (window.AuthManager && !window.authManager) {
    window.authManager = new AuthManager();
  }
  if (window.authManager) {
    await window.authManager.init();
    console.log('[AngleEditor] AuthManager ready, logged in:', window.authManager.isLoggedIn());
  }

  // Bug 20+21 fix: Connect SSE in follower mode để nhận admin update events
  if (window.SseClient && window.authManager?.isLoggedIn()) {
    try {
      await window.SseClient.connect();
      console.log('[AngleEditor] SseClient connected (follower mode expected)');
    } catch (e) {
      console.warn('[AngleEditor] SseClient connect failed:', e?.message);
    }
  }

  // Initialize RequestCoalescer for popup window coordination
  // Popup windows delegate GET requests to sidePanel to avoid duplicate API calls
  if (window.RequestCoalescer) {
    window.RequestCoalescer.init();
    console.log('[AngleEditor] RequestCoalescer ready, isLeader:', window.RequestCoalescer.isLeader());
  }

  // Init StorageManager
  if (window.storageManager) {
    await window.storageManager.init();
    console.log('[AngleEditor] StorageManager mode:', window.storageManager.getMode());
  }

  // Restore PendingUploadStore (IndexedDB persistence)
  if (window.PendingUploadStore) {
    await PendingUploadStore.restore();
    await PendingUploadStore.restoreCache();
    await PendingUploadStore.restoreLightweight();
    console.log('[AngleEditor] PendingUploadStore restored');
  }

  // Init FeatureGate (cần cho quota check)
  if (window.FeatureGate && !window.featureGate) {
    window.featureGate = new FeatureGate();
  }
  if (window.featureGate && typeof window.featureGate.refreshAsync === 'function') {
    try {
      await window.featureGate.refreshAsync();
      console.log('[AngleEditor] FeatureGate ready, plan:', window.featureGate.plan?.slug);
    } catch (e) {
      console.warn('[AngleEditor] FeatureGate refresh failed, using cached:', e.message);
    }
  }

  // Restore SystemConfig from storage (for show_upgrade_ui, etc.)
  if (window.SystemConfig) {
    await SystemConfig.restoreFromStorage();
    SystemConfig.applyToUI();
    console.log('[AngleEditor] SystemConfig restored, show_upgrade_ui:', SystemConfig.getBool('show_upgrade_ui'));
  }

  // Bug 38 fix (2026-05-19): Fetch PCM api_configs trước khi render UI (ratios, download_resolutions).
  try {
    if (window.ProviderConfigManager?._fetchApiConfigs) {
      await window.ProviderConfigManager._fetchApiConfigs();
      console.log('[AngleEditor] PCM api_configs fetched');
    }
  } catch (e) {
    console.warn('[AngleEditor] PCM api_configs fetch failed:', e?.message);
  }

  // Khôi phục project context từ sidePanel
  try {
    const stored = await new Promise(resolve => {
      chrome.storage.local.get(['_pendingAnglesProject'], result => resolve(result));
    });
    if (stored._pendingAnglesProject) {
      window._currentProjectId = stored._pendingAnglesProject.projectId || null;
      window._currentProjectName = stored._pendingAnglesProject.projectName || null;
      chrome.storage.local.remove('_pendingAnglesProject');
      console.log('[AngleEditor] Project context:', window._currentProjectId);
    }
  } catch (e) { globalThis.SEOSONA_swallow?.('angles-editor-init', e); }

  // Entitlements sync + i18n sync (cross-window via storage)
  // Popup window có eventBus riêng, không nhận featuregate:refreshed từ sidePanel
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      // Locale changes
      if (changes.af_locale && window.I18n) {
        window.I18n.setLocale(changes.af_locale.newValue, false);
        window.I18n.applyTranslations(document.body);
      }
      // Entitlements changes
      if (changes.af_entitlements && window.featureGate) {
        const newData = changes.af_entitlements.newValue;
        if (newData?.entitlements) {
          window.featureGate.entitlements = newData.entitlements;
          window.featureGate.plan = newData.plan || window.featureGate.plan;
        }
        window.eventBus?.emit('featuregate:refreshed', {
          plan: newData?.plan,
          entitlements: newData?.entitlements
        });
        console.log('[AngleEditor] Entitlements updated from storage, plan:', newData?.plan?.slug);
      }
    }
  });

  // ===== Global Quota Events (GP-6) =====
  // Popup window có eventBus riêng, cần listen quota:warning và quota:exhausted
  if (window.eventBus) {
    // GP-6.3: Toast warning khi global quota còn <10%
    window.eventBus.on('quota:warning', (data) => {
      const remaining = data?.remaining ?? 0;
      const limit = data?.limit ?? 0;
      console.log('[AngleEditor] Quota warning:', remaining, '/', limit, 'remaining');
      window.customDialog?.alert(
        window.I18n?.t('gate.quotaWarningMsg', { remaining, limit }) || `Còn ${remaining}/${limit} lượt prompt hôm nay. Nâng cấp để không giới hạn.`,
        { title: window.I18n?.t('gate.quotaWarningTitle') || 'Sắp hết lượt prompt', type: 'warning' }
      );
    });

    // GP-6.4: Dialog khi global quota đã hết (exhausted)
    window.eventBus.on('quota:exhausted', (data) => {
      const limit = data?.limit ?? 0;
      const module = data?.module || 'Angles';
      console.log('[AngleEditor] Quota exhausted:', limit, 'limit for', module);

      if (window.customDialog) {
        const showUpgrade = window.SystemConfig?.getBool('show_upgrade_ui') !== false;
        const contactUrl = window.SystemConfig?.get('upgrade_contact_url', '');

        const buttons = [
          { label: window.I18n?.t('gate.close') || 'Đóng', primary: false, action: () => {} }
        ];

        if (showUpgrade) {
          buttons.push({
            label: window.I18n?.t('gate.upgradeNow') || 'Nâng cấp ngay',
            primary: true,
            action: () => {
              chrome.runtime.sendMessage({ action: 'showUpgradeModal' }).catch(function (_e) { globalThis.SEOSONA_swallow?.('angles-editor-init#action', _e); });
            }
          });
        } else if (contactUrl) {
          buttons.push({
            label: window.I18n?.t('gate.contact') || 'Liên hệ',
            primary: true,
            action: () => { window.open(contactUrl, '_blank'); }
          });
        }

        const exhaustedMsg = window.I18n?.t('gate.quotaExhaustedMsg', { limit }) || `Bạn đã sử dụng hết <strong>${limit} lượt prompt</strong> hôm nay.`;
        const upgradeDesc = showUpgrade
          ? (window.I18n?.t('gate.upgradeForUnlimited') || 'Nâng cấp lên gói Premium để nhận không giới hạn lượt prompt mỗi ngày và nhiều tính năng khác.')
          : (window.I18n?.t('gate.contactAdminUpgrade') || 'Vui lòng liên hệ admin để nâng cấp gói.');

        window.customDialog.alert(
          `<div style="line-height:1.6">
            <p>${exhaustedMsg}</p>
            <p style="margin-top:12px;color:var(--muted-foreground)">${upgradeDesc}</p>
          </div>`,
          { title: window.I18n?.t('gate.quotaExhaustedTitle') || 'Đã hết lượt prompt hôm nay', type: 'warning', html: true, buttons }
        );
      }
    });
  }

  // Create AngleEditor instance
  const editor = new AngleEditor(document.body);
  window.anglesEditor = editor;

  console.log('[AngleEditor] Initialized');
})();
