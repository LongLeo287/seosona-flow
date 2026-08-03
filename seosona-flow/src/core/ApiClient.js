class ApiClient {
  /**
   * Universal fetch client for interacting with the backend.
   * Replaces the old AuthManager._apiCall method.
   *
   * @param {string} method HTTP Method (GET, POST, PUT, DELETE)
   * @param {string} endpoint API Endpoint (e.g., 'templates')
   * @param {Object} data Optional payload body
   * @returns {Promise<any>} JSON response data
   */
  static async request(method, endpoint, data = null) {
    // LOCAL MODE (mặc định): KHÔNG gọi backend. Ném lỗi nhanh 'LOCAL_MODE' để mọi caller
    // rơi vào nhánh catch → local fallback sẵn có (không chờ timeout, không "Failed to fetch").
    // Các module config/registry/storage đã tự trả default cục bộ TRƯỚC khi tới đây.
    if ((typeof self !== 'undefined' ? self : window).SEOSONA_LOCAL_MODE !== false) {
      const err = new Error('LOCAL_MODE: backend disabled');
      err.code = 'LOCAL_MODE';
      err.isLocalMode = true;
      throw err;
    }
    try {
      // Use ApiBaseConfig if available, else fallback to localhost
      const baseUrl = typeof window.ApiBaseConfig !== 'undefined' 
        ? await window.ApiBaseConfig.get() 
        : 'http://localhost:8080/api/v1';

      // Trim leading slashes from endpoint
      const cleanEndpoint = endpoint.replace(/^\/+/, '');
      const url = `${baseUrl}/${cleanEndpoint}`;

      const options = {
        method: method.toUpperCase(),
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };

      if (data && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method)) {
        options.body = JSON.stringify(data);
      }

      const response = await fetch(url, options);

      if (!response.ok) {
        let errorMsg = `HTTP Error ${response.status}`;
        try {
          const errorJson = await response.json();
          if (errorJson.message) errorMsg = errorJson.message;
        } catch (_) { globalThis.SEOSONA_swallow?.('ApiClient', _); }
        throw new Error(errorMsg);
      }

      // Read response
      const json = await response.json();
      
      // Mimic old structure: if the API returned {success: true, data: ...}, unwrap it.
      // If there's meta, return both to support pagination.
      if (json && typeof json === 'object') {
        if (json.meta !== undefined) {
          return { data: json.data || json, meta: json.meta };
        }
        if (json.data !== undefined) {
          return json.data;
        }
      }
      return json;

    } catch (err) {
      console.error(`[ApiClient] API Request failed (${method} ${endpoint}):`, err);
      throw err;
    }
  }
}

// Make it globally available for legacy modules
window.ApiClient = ApiClient;
