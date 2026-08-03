/**
 * IdGenerator — Helper chung sinh unique ID cho mọi entity (node, edge, workflow, task, ...).
 *
 * Format: `${prefix}_${timestamp_ms}_${uuid_short}`
 *   - timestamp_ms: Date.now() — 13 chữ số, dễ debug + sort theo thời gian tạo
 *   - uuid_short: 8 ký tự đầu của crypto.randomUUID() — ~4 tỷ tổ hợp, zero collision trong cùng ms
 *
 * Ví dụ: node_1731398421523_a3f2c8b1
 *
 * Fallback: nếu môi trường không có crypto.randomUUID (rất hiếm, chỉ legacy browsers),
 * fallback về Math.random với entropy cao hơn.
 */
const IdGenerator = {
  /**
   * Sinh unique ID với prefix.
   * @param {string} prefix - Ví dụ: 'node', 'edge', 'wf', 'task'
   * @returns {string} - `${prefix}_${ts}_${rand}`
   */
  next(prefix) {
    const ts = Date.now();
    const rand = this._shortUuid();
    return `${prefix}_${ts}_${rand}`;
  },

  /**
   * Sinh 8-char unique segment (UUID prefix nếu available, fallback Math.random).
   * Không bao gồm prefix/timestamp — dùng khi cần short id riêng.
   */
  _shortUuid() {
    try {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID().split('-')[0]; // 8 hex chars
      }
    } catch (e) { /* fallback below */ }
    // Fallback: 8-char random base36 (~2.8 tỷ tổ hợp)
    return Math.random().toString(36).substring(2, 10).padEnd(8, '0');
  },
};

window.IdGenerator = IdGenerator;
