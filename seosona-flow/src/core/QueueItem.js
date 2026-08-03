/**
 * QueueItem - 1 prompt cần submit vào Google Flow editor
 * Máy trạng thái: PENDING -> SUBMITTING -> SUBMITTED -> MONITORING -> COMPLETED/FAILED
 */
class QueueItem {
  // Hằng số trạng thái
  static STATE = {
    PENDING: 'PENDING',
    SUBMITTING: 'SUBMITTING',
    WAITING_USER: 'WAITING_USER',   // Manual Enter mode: SEOSONA Flow đã điền prompt+ref, chờ user nhấn Enter
    SUBMITTED: 'SUBMITTED',
    MONITORING: 'MONITORING',
    RETRY_SUBMIT: 'RETRY_SUBMIT',
    COMPLETED: 'COMPLETED',
    PARTIAL_FAIL: 'PARTIAL_FAIL',
    FAILED: 'FAILED',
    CANCELLED: 'CANCELLED',
  };

  constructor({ jobId, prompt, promptIndex, settings, refFileIds, refFileNames, refImageMode, mentionData, priority }) {
    this.id = crypto.randomUUID();
    this.jobId = jobId;
    this.state = QueueItem.STATE.PENDING;
    this.prompt = prompt;
    this.promptIndex = promptIndex || 0;  // Vị trí trong danh sách prompts (bắt đầu từ 0)
    this.promptText = prompt?.substring(0, 80) || '';  // Rút gọn để hiển thị
    this.settings = settings;       // { genType, ratio, model, quantity }
    this.refFileIds = refFileIds || [];
    this.refFileNames = refFileNames || {};  // Map { fileId: file_name } cho cross-project validation
    this.refImageMode = refImageMode || 'none';
    this.mentionData = mentionData || null;
    this.priority = priority || 0;  // Cao hơn = xử lý trước (retry = 100)

    // Được gán sau khi submit thành công
    this.preTileIds = null;
    this.preFileNames = null;
    // SEOSONA tile ownership: tile do CHÍNH item này sinh ra — EditorExecutor chốt ngay
    // sau submit (vùng tuần tự) bằng snapshot delta. TileMonitor dùng làm chặn-TRÊN bổ sung
    // cho cơ chế per-item _claimedTileIds sẵn có. null = không chốt được → giữ logic cũ.
    this._ownTileIds = null;
    this.resultTileIds = [];
    this.resultThumbnails = {};

    // Theo dõi thử lại
    this.retrySubmitCount = 0;
    this.error = null;
    this.tileId = null;          // Tile ID đầu tiên (để hiển thị)

    // Theo dõi Task (cho chế độ Run All Tasks)
    this._taskIdx = null;
    this._taskId = null;

    // Thời gian
    this.createdAt = Date.now();
    this.submittedAt = null;
    this.completedAt = null;
  }

  /** Kiểm tra trạng thái kết thúc (không thể chuyển tiếp nữa) */
  get isTerminal() {
    return [
      QueueItem.STATE.COMPLETED,
      QueueItem.STATE.PARTIAL_FAIL,
      QueueItem.STATE.FAILED,
      QueueItem.STATE.CANCELLED,
    ].includes(this.state);
  }

  /** Kiểm tra đang trong quá trình xử lý */
  get isActive() {
    return [
      QueueItem.STATE.SUBMITTING,
      QueueItem.STATE.SUBMITTED,
      QueueItem.STATE.MONITORING,
      QueueItem.STATE.RETRY_SUBMIT,
    ].includes(this.state);
  }
}
