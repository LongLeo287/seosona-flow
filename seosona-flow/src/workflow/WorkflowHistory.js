/**
 * WorkflowHistory — Snapshot-based undo/redo cho workflow editor.
 *
 * Strategy:
 *   - Mỗi action (create/delete/move/connect/edit) → push snapshot toàn bộ workflow
 *     (nodes + edges + positions + form data) lên undoStack.
 *   - Snapshot là JSON serialize từ DiagramCanvas.exportWorkflow() — đủ data để restore hoàn toàn.
 *   - Debounce 400ms cho rapid changes (drag move) để gộp thành 1 entry.
 *   - Max 50 entries (memory cost ~ 50 * 100KB = 5MB worst case).
 *
 * Integration:
 *   - WorkflowEditor đăng ký events từ DiagramCanvas → call scheduleSnapshot/takeSnapshot.
 *   - Keyboard: Ctrl/Cmd+Z = undo, Ctrl/Cmd+Shift+Z hoặc Ctrl+Y = redo.
 *   - Skip khi target là input/textarea (cho phép native undo trong text fields).
 */
class WorkflowHistory {
  constructor(editor) {
    this.editor = editor; // WorkflowEditor instance
    this._undoStack = [];
    this._redoStack = [];
    this._maxSize = 40; // U6: giảm 50→40 + strip base64 thumbnails (bên dưới) để giảm memory
    this._lastSnapshot = null; // String, để compare diff
    this._debounceTimer = null;
    this._suppressing = false; // Block snapshot khi đang restore
  }

  // U6: xoá base64 (data:) thumbnails khỏi snapshot undo/redo (nặng, không cần — restore lấy lại từ cache).
  // exportWorkflow trả object MỚI mỗi lần nên mutate an toàn; nhưng ref_thumbnails/result_thumbnails có thể
  // là REFERENCE tới node data live → cleanMap chỉ ĐỌC + trả object mới (không mutate map gốc).
  _stripHeavyThumbnails(data) {
    try {
      const nodes = data?.nodes;
      if (!Array.isArray(nodes)) return data;
      const cleanMap = (o) => {
        if (!o || typeof o !== 'object') return o;
        const out = {};
        for (const k of Object.keys(o)) {
          out[k] = (typeof o[k] === 'string' && o[k].startsWith('data:')) ? '' : o[k];
        }
        return out;
      };
      const stripStr = (v) => (typeof v === 'string' && v.startsWith('data:')) ? '' : v;
      for (const n of nodes) {
        if (!n || typeof n !== 'object') continue;
        if (n.ref_thumbnails) n.ref_thumbnails = cleanMap(n.ref_thumbnails);
        if (n.result_thumbnails) n.result_thumbnails = cleanMap(n.result_thumbnails);
        n.frame_1_thumbnail = stripStr(n.frame_1_thumbnail);
        n.frame_2_thumbnail = stripStr(n.frame_2_thumbnail);
      }
    } catch (_) { /* best-effort */ }
    return data;
  }

  /**
   * Take snapshot ngay (no debounce). Dùng cho discrete actions (delete, connect, ...).
   * Skip nếu state không đổi từ snapshot trước.
   */
  takeSnapshot(label = 'change') {
    if (this._suppressing) return;
    if (!this.editor?.diagramCanvas?.editor) return;
    let data;
    try {
      data = this.editor.diagramCanvas.exportWorkflow();
    } catch (e) {
      console.warn('[WorkflowHistory] exportWorkflow failed:', e);
      return;
    }
    if (!data) return;
    // U6: strip base64 (data:) thumbnails khỏi snapshot — chúng nặng (paste ảnh) và KHÔNG cần cho
    // undo/redo (restore re-render lấy thumbnail từ cache theo file_id). Giữ URL http.
    this._stripHeavyThumbnails(data);
    const snapshot = JSON.stringify(data);
    if (snapshot === this._lastSnapshot) return; // No change
    this._undoStack.push({ label, data: snapshot, timestamp: Date.now() });
    if (this._undoStack.length > this._maxSize) this._undoStack.shift();
    this._redoStack = [];
    this._lastSnapshot = snapshot;
  }

  /**
   * Schedule debounced snapshot. Dùng cho continuous actions (drag move, typing).
   * Multiple calls trong delay window → chỉ 1 snapshot final state.
   */
  scheduleSnapshot(label = 'change', delay = 400) {
    if (this._suppressing) return;
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this.takeSnapshot(label);
      this._debounceTimer = null;
    }, delay);
  }

  /**
   * Flush pending debounced snapshot ngay (vd: trước khi undo/save).
   */
  flushPending() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
      this.takeSnapshot('flush');
    }
  }

  canUndo() {
    return this._undoStack.length >= 2;
  }

  canRedo() {
    return this._redoStack.length > 0;
  }

  /**
   * Undo: pop current → push to redo → restore previous.
   * Cần ít nhất 2 entries (1 = initial state, 2+ = có change để undo).
   */
  undo() {
    this.flushPending();
    if (!this.canUndo()) return null;
    const current = this._undoStack.pop();
    this._redoStack.push(current);
    if (this._redoStack.length > this._maxSize) this._redoStack.shift();
    const prev = this._undoStack[this._undoStack.length - 1];
    this._lastSnapshot = prev.data;
    this._restore(prev.data);
    return prev;
  }

  /**
   * Redo: pop redoStack → push to undo → restore.
   */
  redo() {
    this.flushPending();
    if (!this.canRedo()) return null;
    const next = this._redoStack.pop();
    this._undoStack.push(next);
    this._lastSnapshot = next.data;
    this._restore(next.data);
    return next;
  }

  /**
   * Reset toàn bộ history (vd: load workflow mới).
   */
  reset() {
    this._undoStack = [];
    this._redoStack = [];
    this._lastSnapshot = null;
    if (this._debounceTimer) clearTimeout(this._debounceTimer);
    this._debounceTimer = null;
  }

  /**
   * Restore workflow từ snapshot JSON.
   * Suppress events trong khi restore để tránh recursive snapshot.
   */
  _restore(snapshotJson) {
    let data;
    try {
      data = JSON.parse(snapshotJson);
    } catch (e) {
      console.error('[WorkflowHistory] parse snapshot failed:', e);
      return;
    }
    this._suppressing = true;
    try {
      this.editor._restoreFromHistorySnapshot(data);
    } catch (e) {
      console.error('[WorkflowHistory] restore failed:', e);
    } finally {
      // Port 1.1.49 (U8): unsuppress bám theo FRAME re-render thực tế thay vì 100ms cố định.
      // _restoreFromHistorySnapshot re-bind trong 1 rAF + loadWorkflow emit node/edge:created SYNC
      // → double rAF + buffer 50ms đảm bảo qua hết re-render/re-bind rồi mới mở snapshot. Tránh
      // event deferred lọt qua sau khi _suppressing=false → push snapshot thừa → CLEAR redo (mất redo).
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setTimeout(() => { this._suppressing = false; }, 50);
      }));
    }
  }
}

window.WorkflowHistory = WorkflowHistory;
