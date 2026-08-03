/**
 * AIProviderAdapter - Abstract base class cho mọi AI provider adapter.
 *
 * Mục đích:
 * - Cung cấp interface thống nhất cho các provider (Flow, ChatGPT, Gemini...).
 * - Subclass override các method abstract: ensureReady, submit, uploadRef.
 * - Capabilities object mô tả tính năng provider hỗ trợ (ratio, video, ref...).
 * - featureKey + executionAction để wire vào FeatureGate / ExecutionGate.
 *
 * Lưu ý:
 * - Không tạo instance trực tiếp class này — luôn extend.
 * - isEnabled() fallback true khi featureGate chưa load (an toàn cho bootstrap).
 */
class AIProviderAdapter {
  constructor() {
    // Khoá định danh provider, ví dụ 'flow', 'chatgpt', 'gemini'.
    this.key = '';
    // Tên hiển thị cho UI.
    this.displayName = '';
    // FeatureGate key để check user có quyền dùng provider này không.
    this.featureKey = '';
    // ExecutionGate action key (vd: 'generate', 'chatgpt_run', 'gemini_run').
    this.executionAction = '';

    // Phase 6 Bug O (2026-06-03): XÓA _defaultCapabilities hardcoded.
    // Strict Server-Only — subclass override `get capabilities()` đọc từ PCM.
  }

  /**
   * Phase 6 Bug O: Strict Server-Only — subclass override để đọc từ PCM safeGet*.
   * Base class trả empty object (zero capabilities) khi subclass quên override.
   */
  get capabilities() {
    return {
      supportsRatio: false,
      supportsQuantity: false,
      supportsVideo: false,
      supportsRefImage: false,
      supportsAutoDownload: false,
      supportsHumanized: false,
      maxRefImages: 0,
    };
  }

  /**
   * Đảm bảo provider sẵn sàng nhận request (tab mở, session login, etc.).
   * Trả về { ready: boolean, error?, tabId? }.
   */
  async ensureReady() {
    throw new Error('AIProviderAdapter.ensureReady is abstract');
  }

  /**
   * Submit prompt tới provider và đợi kết quả.
   * Params shape phụ thuộc subclass — tham khảo doc của từng adapter.
   */
  async submit(/* params */) {
    throw new Error('AIProviderAdapter.submit is abstract');
  }

  /**
   * Upload reference image để dùng làm input (vd: upload tới Flow,
   * convert sang base64 cho ChatGPT...).
   */
  async uploadRef(/* file */) {
    throw new Error('AIProviderAdapter.uploadRef is abstract');
  }

  /**
   * Optional: huỷ submit đang chạy. Mặc định no-op.
   */
  async cancel() {
    // Subclass tuỳ chọn override.
  }

  /**
   * Optional: lấy system prompt prefix nếu provider cần (ví dụ ChatGPT
   * fallback "Generate an image of:" khi image mode không kích hoạt được).
   */
  async getPromptPrefix() {
    return '';
  }

  /**
   * Kiểm tra user có quyền dùng provider không (qua FeatureGate).
   * Fallback true nếu featureGate chưa load để tránh chặn bootstrap.
   */
  isEnabled() {
    if (!window.featureGate) return true;
    try {
      return !!window.featureGate.canUse(this.featureKey);
    } catch (e) {
      console.warn('[AIProviderAdapter] isEnabled error:', e?.message || e);
      return false;
    }
  }
}

window.AIProviderAdapter = AIProviderAdapter;
