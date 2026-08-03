/**
 * Job - Nhóm logic các QueueItems từ 1 nguồn
 * Mỗi job đại diện cho 1 hành động từ GenTab, TaskList, Workflow, Angles, hoặc Telegram
 */
class Job {
  constructor({ owner, label }) {
    this.id = crypto.randomUUID();
    this.owner = owner;           // 'prompts' | 'task' | 'workflow' | 'angles' | 'telegram'
    this.label = label;           // "Run All Tasks" | "Auto Gen" | "Workflow: ..."
    this.state = 'running';       // running | paused | stopped | completed
    this.items = [];              // Các QueueItem thuộc job này
    this.completedCount = 0;
    this.failedCount = 0;
    this.totalExpected = 0;       // Tổng prompts dự kiến
    this.createdAt = Date.now();
    this.settings = null;         // { genType, ratio, model, quantity }
    this.sequentialMode = false;  // Per-job sequential mode flag (wait TileMonitor before next submit)

    // Dành riêng cho chạy hàng loạt Task
    this.taskBatch = null;        // { tasks: [], currentIdx: 0, mode, settingsPerTask }

    // Nội bộ
    this._resolve = null;         // Promise resolve khi job hoàn tất
    this._resolved = false;       // Guard chống resolve 2 lần
  }

  /** Kiểm tra job đang hoạt động (running hoặc paused) */
  get isActive() {
    return this.state === 'running' || this.state === 'paused';
  }

  /** Kiểm tra job đã kết thúc (completed hoặc stopped) */
  get isDone() {
    return this.state === 'completed' || this.state === 'stopped';
  }

  /** Phần trăm tiến độ (0-100) */
  get progress() {
    if (this.totalExpected === 0) return 0;
    return Math.round((this.completedCount / this.totalExpected) * 100);
  }

  /** Thời gian đã trôi qua kể từ khi tạo job (ms) */
  get elapsed() {
    return Date.now() - this.createdAt;
  }
}
