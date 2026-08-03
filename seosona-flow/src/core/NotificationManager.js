/**
 * NotificationManager - Notification system cho extension
 * Browser notifications, sound, badge, webhook
 */
(function() {
  'use strict';

  class NotificationManager {
    static _initialized = false;
    static _audioContext = null;
    static _webhookUrl = null;
    static _cachedNotifyOnComplete = true;
    static _cachedNotifySound = false;

    static async init() {
      if (NotificationManager._initialized) return;
      NotificationManager._initialized = true;

      // chrome.notifications API không cần request permission
      // (đã khai báo trong manifest.json)

      // Load notification settings from storage
      await NotificationManager._loadNotificationSettings();

      // Load webhook URL from user settings
      NotificationManager._loadWebhookUrl();

      // Listen for events
      NotificationManager._bindEvents();

      // Listen for settings changes
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.af_settings) {
          NotificationManager._loadNotificationSettings();
        }
      });

      console.log('[SEOSONA Flow] NotificationManager đã khởi tạo');
    }

    /**
     * Send notification (browser + sound + badge)
     */
    static notify(title, body, options = {}) {
      const settings = NotificationManager._getSettings();

      // Browser notification via chrome.notifications API (background.js)
      if (settings.browserNotification) {
        try {
          chrome.runtime.sendMessage({
            action: 'showNotification',
            title,
            body,
            // notifId ổn định (vd server notification) → background dùng để dedup multi-tab.
            notifId: options.notifId || null,
          }, () => {
            if (chrome.runtime.lastError) { /* noop */ }
          });
        } catch (e) {
          console.warn('[SEOSONA Flow] Browser notification failed:', e);
        }
      }

      // Sound notification
      if (settings.sound) {
        NotificationManager._playBeep();
      }

      // Badge
      NotificationManager._setBadge('!');

      // Auto-clear badge after 5 seconds
      setTimeout(() => {
        NotificationManager._setBadge('');
      }, 5000);
    }

    /**
     * Hiển thị browser notification cho in-app server notification (order paid, hoa hồng,
     * duyệt template, workflow shared...). Gate cùng setting `notifyOnComplete` (browserNotification)
     * GIỐNG notification lúc gen xong. notifId ổn định theo notification.id → dedup multi-tab
     * (chrome.notifications.create cùng id → replace, không stack). KHÔNG set action badge ở đây
     * (NotificationBell đã quản unread count riêng).
     */
    static notifyServerNotification(notification) {
      if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no server notifications */ return; }
      if (!notification) return;
      const settings = NotificationManager._getSettings();
      if (!settings.browserNotification) return; // tôn trọng setting (giống gen xong)

      const title = notification.title || 'SEOSONA Flow';
      const body = notification.body || notification.message || '';
      const notifId = 'srv-' + (notification.id || Date.now());
      try {
        chrome.runtime.sendMessage({ action: 'showNotification', title, body, notifId }, () => {
          if (chrome.runtime.lastError) { /* noop */ }
        });
      } catch (e) {
        console.warn('[SEOSONA Flow] Server browser notification failed:', e);
      }
      if (settings.sound) NotificationManager._playBeep();
    }

    /**
     * In-app toast proxy → window.showNotification (app.js, toast top-center sidebar).
     * Trước đây method này KHÔNG tồn tại → caller (vd ChatGPTSession fallback-prefix toast) có
     * `typeof === 'function'` guard nên không crash, nhưng toast KHÔNG bao giờ hiện. Proxy chuẩn hoá.
     * No-op nếu context không có window.showNotification (vd content script) — guard ?..
     * @param {string} message
     * @param {'success'|'error'|'info'|'warning'} type
     * @param {number} [duration] ms
     */
    static showToast(message, type = 'info', duration) {
      try { window.showNotification?.(message, type, duration); } catch (e) { /* noop */ }
    }

    /**
     * Play a short beep using AudioContext oscillator
     */
    static _playBeep() {
      try {
        const ctx = NotificationManager._audioContext || new (window.AudioContext || window.webkitAudioContext)();
        NotificationManager._audioContext = ctx;

        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
        gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.3);
      } catch (e) {
        console.warn('[SEOSONA Flow] Sound notification failed:', e);
      }
    }

    /**
     * Update extension badge via background.js
     */
    static _setBadge(text) {
      try {
        chrome.runtime.sendMessage({ action: 'setBadge', text }, () => {
          // Ignore errors (e.g., background not available)
          if (chrome.runtime.lastError) { /* noop */ }
        });
      } catch (e) {
        // Ignore
      }
    }

    /**
     * Get notification settings from user preferences (cached from last storage read)
     */
    static _getSettings() {
      return {
        browserNotification: NotificationManager._cachedNotifyOnComplete ?? true,
        sound: NotificationManager._cachedNotifySound ?? false,
      };
    }

    /**
     * Load notification settings from storage
     */
    static async _loadNotificationSettings() {
      try {
        const result = await new Promise(resolve => {
          chrome.storage.local.get(['af_settings'], r => resolve(r.af_settings || {}));
        });
        NotificationManager._cachedNotifyOnComplete = result.notifyOnComplete ?? true;
        NotificationManager._cachedNotifySound = result.notifySound ?? false;
      } catch (e) {
        console.warn('[SEOSONA Flow] Failed to load notification settings:', e);
      }
    }

    /**
     * Load webhook URL from user settings API
     */
    static async _loadWebhookUrl() {
      if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend */ return; }
      if (false || !true) return;

      try {
        const result = await ApiClient.request('GET', 'webhook-settings');
        if (result && result.webhook_url) {
          NotificationManager._webhookUrl = result.webhook_url;
        }
      } catch (e) {
        // Webhook not configured, ignore
      }
    }

    /**
     * Send webhook notification
     */
    static async _sendWebhook(eventType, data) {
      if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend webhook */ return; }
      if (!NotificationManager._webhookUrl) return;

      try {
        chrome.runtime.sendMessage({
          action: 'sendWebhook',
          url: NotificationManager._webhookUrl,
          data: {
            event: eventType,
            timestamp: new Date().toISOString(),
            ...data,
          }
        }, () => {
          if (chrome.runtime.lastError) { /* noop */ }
        });
      } catch (e) {
        console.warn('[SEOSONA Flow] Webhook send failed:', e);
      }
    }

    // Rate limit state for Telegram notifications
    static _telegramLastSent = 0;
    static _telegramMinInterval = 3000; // Min 3 seconds between notifications
    static _telegramQueue = [];
    static _telegramProcessing = false;

    /**
     * Send Telegram notification on completion
     * Fire-and-forget: does not block UI, silently catches errors
     * Rate limited to prevent "Too many requests" errors
     */
    static async _sendTelegramNotify(eventType, data) {
      if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend telegram */ return; }
      // Check setting
      try {
        const res = await new Promise(resolve => {
          chrome.storage.local.get(['af_settings'], r => resolve(r.af_settings || {}));
        });
        if (!res.notifyTelegram) return;
      } catch (e) {
        return;
      }

      // Check logged in
      if (false || !true) return;

      // Queue the notification
      this._telegramQueue.push({ eventType, data });
      this._processTelegramQueue();
    }

    /**
     * Process Telegram notification queue with rate limiting
     */
    static async _processTelegramQueue() {
      if (this._telegramProcessing || this._telegramQueue.length === 0) return;
      this._telegramProcessing = true;

      while (this._telegramQueue.length > 0) {
        const now = Date.now();
        const timeSinceLast = now - this._telegramLastSent;

        // Wait if too soon
        if (timeSinceLast < this._telegramMinInterval) {
          await new Promise(r => setTimeout(r, this._telegramMinInterval - timeSinceLast));
        }

        const { eventType, data } = this._telegramQueue.shift();

        // Send to backend
        try {
          await ApiClient.request('POST', 'telegram/notify-completion', {
            event_type: eventType,
            label: data?.label || data?.taskName || data?.workflowName || '',
            completed_count: data?.completedCount || data?.resultCount || 0,
            failed_count: data?.failedCount || 0,
          });
          this._telegramLastSent = Date.now();
        } catch (e) {
          // If rate limited, wait longer and retry
          if (/too many|rate limit|429/i.test(e.message)) {
            console.warn('[SEOSONA Flow] Telegram rate limited, waiting 10s...');
            await new Promise(r => setTimeout(r, 10000));
            // Re-queue the failed notification
            this._telegramQueue.unshift({ eventType, data });
          } else {
            console.warn('[SEOSONA Flow] Telegram notify failed:', e.message);
          }
        }
      }

      this._telegramProcessing = false;
    }

    /**
     * Bind EventBus listeners for generation/task/workflow completion
     */
    static _bindEvents() {
      if (!window.eventBus) return;

      // Helper: i18n với fallback Việt — đồng bộ pattern các nơi khác
      const t = (key, fallback) => window.I18n?.t?.(key) || fallback;

      window.eventBus.on('generation:complete', (data) => {
        NotificationManager.notify(
          t('notification.browser.generationCompleteTitle', 'Tạo xong!'),
          data?.message || t('notification.browser.generationCompleteBody', 'Quá trình tạo ảnh/video đã hoàn tất.'),
          { tag: 'generation-complete' }
        );
        NotificationManager._sendWebhook('generation:complete', {
          prompt: data?.prompt || '',
          resultCount: data?.resultCount || 0,
        });
        NotificationManager._sendTelegramNotify('generation', data);
      });

      window.eventBus.on('task:complete', (data) => {
        NotificationManager.notify(
          t('notification.browser.taskCompleteTitle', 'Task hoàn tất!'),
          data?.taskName || t('notification.browser.taskCompleteBody', 'Task đã chạy xong.'),
          { tag: 'task-complete' }
        );
        NotificationManager._sendWebhook('task:complete', {
          taskId: data?.taskId || '',
          taskName: data?.taskName || '',
        });
        NotificationManager._sendTelegramNotify('task', data);
      });

      window.eventBus.on('workflow:complete', (data) => {
        NotificationManager.notify(
          t('notification.browser.workflowCompleteTitle', 'Workflow hoàn tất!'),
          data?.workflowName || t('notification.browser.workflowCompleteBody', 'Workflow đã chạy xong.'),
          { tag: 'workflow-complete' }
        );
        NotificationManager._sendWebhook('workflow:complete', {
          workflowId: data?.workflowId || '',
          workflowName: data?.workflowName || '',
        });
        NotificationManager._sendTelegramNotify('workflow', data);
      });

      // Reload webhook URL on login
      window.eventBus.on('auth:login', () => {
        NotificationManager._loadWebhookUrl();
      });

      window.eventBus.on('auth:logout', () => {
        NotificationManager._webhookUrl = null;
      });
    }
  }

  window.NotificationManager = NotificationManager;
})();
