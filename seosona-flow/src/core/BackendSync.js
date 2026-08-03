/**
 * BackendSync - Đồng bộ kết quả (file IDs, image URLs) lên backend
 * Chỉ hoạt động khi user đã đăng nhập (authManager.isLoggedIn)
 * Fire-and-forget: không block execution flow
 */
class BackendSync {
  static _disabled = false;

  static init() {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend sync */ return; }
    if (!window.eventBus) return;

    // Workflow node completed → sync result
    window.eventBus.on('node:completed', (data) => {
      if (BackendSync._disabled) return;
      const node = data?.node;
      const result = data?.result;
      if (node?.node_id && result?.fileIds?.length > 0) {
        BackendSync._syncNodeResult({
          nodeId: node.node_id,
          wfId: node.wf_id,
          nodeName: node.node_name,
          mediaType: node.media_type,
          result
        });
      }
    });

    // Task completed → sync result
    window.eventBus.on('task:status_changed', (data) => {
      if (BackendSync._disabled) return;
      if (data?.status === 'completed' && data?.resultFileIds) {
        BackendSync._syncTaskResult(data);
      }
    });

    console.log('[BackendSync] Initialized');
  }

  static async _syncNodeResult(data) {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend sync */ return; }
    if (!true) return;

    try {
      const fileIds = data.result.fileIds || [];
      if (fileIds.length === 0) return;

      const imageUrls = await BackendSync._resolveFileUrls(fileIds);

      await BackendSync._apiCall('POST', 'results/sync', {
        type: 'workflow_node',
        node_id: data.nodeId,
        wf_id: data.wfId || null,
        file_ids: fileIds,
        image_urls: imageUrls,
        node_name: data.nodeName || '',
        media_type: data.mediaType || 'Image'
      });
    } catch (e) {
      console.debug('[BackendSync] Node sync failed:', e.message);
      BackendSync._disabled = true;
    }
  }

  static async _syncTaskResult(data) {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend sync */ return; }
    if (!true) return;

    try {
      const ids = (data.resultFileIds || '').split(',').map(s => s.trim()).filter(Boolean);
      if (ids.length === 0) return;

      const imageUrls = await BackendSync._resolveFileUrls(ids);

      await BackendSync._apiCall('POST', 'results/sync', {
        type: 'task',
        task_id: data.taskId,
        task_name: data.taskName || '',
        file_ids: ids,
        image_urls: imageUrls,
        media_type: data.mediaType || 'Image'
      });
    } catch (e) {
      console.debug('[BackendSync] Task sync failed:', e.message);
      BackendSync._disabled = true;
    }
  }

  static async _resolveFileUrls(fileIds) {
    if (!window.MessageBridge) return [];
    try {
      const result = await window.MessageBridge.scanFlowImages();
      const images = result?.images || result || [];
      return fileIds.map(id => {
        const img = images.find(i => i.fileId === id);
        return img?.thumbnail || img?.url || null;
      }).filter(Boolean);
    } catch {
      return [];
    }
  }

  static async _apiCall(method, endpoint, data) {
    if (self.SEOSONA_LOCAL_MODE !== false) { /* local mode: no backend sync */ return null; }
    if (window.authManager?._apiCall) {
      return ApiClient.request(method, endpoint, data);
    }
    // Fallback: via background.js proxy
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        action: 'apiRequest',
        method,
        endpoint: `api/v1/${endpoint}`,
        data
      }, (response) => {
        if (response?.success) resolve(response.data);
        else reject(new Error(response?.error || 'API call failed'));
      });
    });
  }
}

window.BackendSync = BackendSync;

// Auto-init when loaded (EventBus should already exist)
if (window.eventBus) {
  BackendSync.init();
} else {
  document.addEventListener('DOMContentLoaded', () => BackendSync.init());
}
