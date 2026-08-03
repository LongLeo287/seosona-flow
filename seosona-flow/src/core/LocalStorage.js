/**
 * LocalStorage - Lưu trữ dữ liệu trong chrome.storage.local
 */
class LocalStorage {
  constructor() {
    this.KEYS = {
      SETTINGS: 'af_settings',
      TASKS: 'af_tasks',
      WORKFLOWS: 'af_workflows',
      NODES: 'af_nodes',
      EDGES: 'af_edges'
    };
    this._queue = Promise.resolve();
  }

  _serialize(fn) {
    // [Persistence Phase 6] Mutex 2 lớp:
    //  (1) in-context promise-chain (this._queue) — serialize trong CÙNG context.
    //  (2) navigator.locks 'af_storage_write' — serialize CROSS-CONTEXT (editor popup ↔ sidebar cùng
    //      origin ghi chung af_workflows/af_nodes). Trước đây chỉ có (1) → 2 context race read-modify-write
    //      → mất update. Lock auto-release khi fn settle (resolve/reject) → không deadlock. Fallback chạy
    //      thẳng nếu môi trường không có navigator.locks (test/node).
    const withCrossCtxLock = () => {
      if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
        try { return navigator.locks.request('af_storage_write', { mode: 'exclusive' }, () => fn()); }
        catch (_) { return fn(); }
      }
      return fn();
    };
    this._queue = this._queue.then(withCrossCtxLock).catch(err => {
      console.error('[LocalStorage] Serialization error:', err.message);
      throw err;
    });
    return this._queue;
  }

  // Helper methods
  async _get(key) {
    return new Promise(resolve => {
      chrome.storage.local.get([key], result => {
        resolve(result[key] || (key === this.KEYS.SETTINGS ? {} : []));
      });
    });
  }

  async _set(key, value) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set({ [key]: value }, () => {
        if (chrome.runtime.lastError) {
          console.error('[LocalStorage] _set ERROR for key:', key, chrome.runtime.lastError.message);
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      });
    });
  }

  // ===== TASKS (Tab 2) =====
  async _getTasksRaw() {
    const tasks = await this._get(this.KEYS.TASKS);
    // CG-6.5: Backward-compat — default provider='flow' cho task cũ chưa có field này.
    if (Array.isArray(tasks)) {
      for (const t of tasks) {
        if (t && !t.provider) t.provider = 'flow';
      }
    }
    return tasks || [];
  }

  async getTasks(options = {}) {
    const data = await this._getTasksRaw();
    // Return same format as ApiStorage for compatibility
    return { data, meta: { current_page: 1, last_page: 1, total: data.length } };
  }

  async getTask(taskId) {
    const tasks = await this._getTasksRaw();
    return tasks.find(t => t.task_id === taskId);
  }

  async saveTask(task) {
    return this._serialize(async () => {
      const tasks = await this._getTasksRaw();
      const index = tasks.findIndex(t => t.task_id === task.task_id);

      task.updated_at = Date.now();
      if (index >= 0) {
        tasks[index] = task;
      } else {
        task.created_at = Date.now();
        task.task_id = task.task_id || (window.IdGenerator ? window.IdGenerator.next('task') : `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
        tasks.push(task);
      }

      await this._set(this.KEYS.TASKS, tasks);
      return task;
    });
  }

  async deleteTask(taskId) {
    return this._serialize(async () => {
      const tasks = await this._getTasksRaw();
      const filtered = tasks.filter(t => t.task_id !== taskId);
      await this._set(this.KEYS.TASKS, filtered);
      return true;
    });
  }

  async updateTaskStatus(taskId, status, fileIds = '', extra = null) {
    const task = await this.getTask(taskId);
    if (task) {
      task.status = status;
      if (fileIds) task.result_file_ids = fileIds;
      // Bug fix: trước fix LocalStorage chỉ nhận 3 args → fallback path từ executor Grok/ChatGPT
      // truyền `extra={result_thumbnails, result_file_names, error_message, executed_at}` bị
      // silently drop → tab Result trống dù task hoàn thành. Mirror ApiStorage signature 4-arg.
      if (extra && typeof extra === 'object') {
        if (extra.result_thumbnails) {
          task.result_thumbnails = { ...(task.result_thumbnails || {}), ...extra.result_thumbnails };
        }
        if (extra.result_file_names) {
          task.result_file_names = { ...(task.result_file_names || {}), ...extra.result_file_names };
        }
        if (extra.error_message !== undefined) task.error_message = extra.error_message;
        if (extra.executed_at !== undefined) task.executed_at = extra.executed_at;
      }
      if (status === 'completed' || status === 'failed' || status === 'skipped') {
        task.executed_at = task.executed_at || Date.now();
      }
      await this.saveTask(task);
    }
    return task;
  }

  async clearTasks() {
    return this._serialize(async () => {
      await this._set(this.KEYS.TASKS, []);
      console.log('[LocalStorage] Tasks cleared');
    });
  }

  // ===== WORKFLOWS (Tab 4) =====
  async _getWorkflowsRaw() {
    const workflows = await this._get(this.KEYS.WORKFLOWS);
    return workflows || [];
  }

  async getWorkflows(options = {}) {
    const data = await this._getWorkflowsRaw();
    return { data, meta: { current_page: 1, last_page: 1, total: data.length } };
  }

  async getWorkflow(wfId) {
    const workflows = await this._getWorkflowsRaw();
    const workflow = workflows.find(w => w.wf_id === wfId);
    if (workflow) {
      workflow.nodes = await this.getNodes(wfId);
      workflow.edges = await this.getEdges(wfId);
    }
    return workflow;
  }

  async saveWorkflow(workflow) {
    return this._serialize(async () => {
      const workflows = await this._getWorkflowsRaw();
      const index = workflows.findIndex(w => w.wf_id === workflow.wf_id);

      workflow.updated_at = Date.now();
      if (index >= 0) {
        const existing = workflows[index];
        workflows[index] = { ...existing, ...workflow };
      } else {
        workflow.created_at = Date.now();
        workflow.wf_id = workflow.wf_id || (window.IdGenerator ? window.IdGenerator.next('wf') : `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
        workflows.push(workflow);
      }

      await this._set(this.KEYS.WORKFLOWS, workflows);
      return workflow;
    });
  }

  async deleteWorkflow(wfId) {
    return this._serialize(async () => {
      const workflows = await this._getWorkflowsRaw();
      const filtered = workflows.filter(w => w.wf_id !== wfId);
      await this._set(this.KEYS.WORKFLOWS, filtered);

      const nodes = await this._get(this.KEYS.NODES);
      const filteredNodes = nodes.filter(n => n.wf_id !== wfId);
      await this._set(this.KEYS.NODES, filteredNodes);

      const edges = await this._get(this.KEYS.EDGES);
      const filteredEdges = edges.filter(e => e.wf_id !== wfId);
      await this._set(this.KEYS.EDGES, filteredEdges);

      return true;
    });
  }

  async clearWorkflows() {
    return this._serialize(async () => {
      await this._set(this.KEYS.WORKFLOWS, []);
      await this._set(this.KEYS.NODES, []);
      await this._set(this.KEYS.EDGES, []);
      console.log('[LocalStorage] Workflows, nodes, and edges cleared');
    });
  }

  // ===== NODES =====
  async getNodes(wfId) {
    const nodes = await this._get(this.KEYS.NODES);
    return nodes.filter(n => n.wf_id === wfId);
  }

  async saveNode(wfId, node) {
    return this._serialize(async () => {
      const nodes = await this._get(this.KEYS.NODES);
      node.wf_id = wfId;
      const index = nodes.findIndex(n => n.node_id === node.node_id && n.wf_id === wfId);

      if (index >= 0) {
        nodes[index] = node;
      } else {
        node.node_id = node.node_id || (window.IdGenerator ? window.IdGenerator.next('node') : `node_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`);
        nodes.push(node);
      }

      await this._set(this.KEYS.NODES, nodes);
      return node;
    });
  }

  async deleteNode(wfId, nodeId) {
    return this._serialize(async () => {
      const nodes = await this._get(this.KEYS.NODES);
      const filtered = nodes.filter(n => !(n.wf_id === wfId && n.node_id === nodeId));
      await this._set(this.KEYS.NODES, filtered);

      const edges = await this._get(this.KEYS.EDGES);
      const filteredEdges = edges.filter(e =>
        !(e.wf_id === wfId && (e.source_node_id === nodeId || e.target_node_id === nodeId))
      );
      await this._set(this.KEYS.EDGES, filteredEdges);

      return true;
    });
  }

  async updateNodeStatus(wfId, nodeId, data) {
    return this._serialize(async () => {
      const nodes = await this._get(this.KEYS.NODES);
      const node = nodes.find(n => n.wf_id === wfId && n.node_id === nodeId);
      if (node) {
        Object.assign(node, data);
        await this._set(this.KEYS.NODES, nodes);
      }
      return node;
    });
  }

  // ===== EDGES =====
  async getEdges(wfId) {
    const edges = await this._get(this.KEYS.EDGES);
    return edges.filter(e => e.wf_id === wfId);
  }

  async saveEdge(wfId, edge) {
    return this._serialize(async () => {
      const edges = await this._get(this.KEYS.EDGES);
      edge.wf_id = wfId;
      // Bug fix (data loss): include port info trong edge_id để multi-port edges giữa cùng 2 nodes
      // không bị overwrite khi save (đồng bộ với DiagramCanvas.exportWorkflow fix).
      edge.edge_id = edge.edge_id
        || `edge_${edge.source_node_id}_${edge.source_handle || 'output_1'}_${edge.target_node_id}_${edge.target_handle || 'input_1'}`;

      const index = edges.findIndex(e => e.edge_id === edge.edge_id && e.wf_id === wfId);
      if (index >= 0) {
        edges[index] = edge;
      } else {
        edges.push(edge);
      }

      await this._set(this.KEYS.EDGES, edges);
      return edge;
    });
  }

  async deleteEdge(wfId, edgeId) {
    return this._serialize(async () => {
      const edges = await this._get(this.KEYS.EDGES);
      const filtered = edges.filter(e => !(e.wf_id === wfId && e.edge_id === edgeId));
      await this._set(this.KEYS.EDGES, filtered);
      return true;
    });
  }

  // ===== BULK OPERATIONS =====
  async saveWorkflowFull(workflow, nodes, edges) {
    return this._serialize(async () => {
      const workflows = await this._getWorkflowsRaw();
      const index = workflows.findIndex(w => w.wf_id === workflow.wf_id);
      workflow.updated_at = Date.now();
      if (index >= 0) {
        const existing = workflows[index];
        workflows[index] = { ...existing, ...workflow };
      } else {
        workflow.created_at = Date.now();
        workflow.wf_id = workflow.wf_id || (window.IdGenerator ? window.IdGenerator.next('wf') : `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
        workflows.push(workflow);
      }
      await this._set(this.KEYS.WORKFLOWS, workflows);

      console.log('[LocalStorage] saveWorkflowFull nodes:', nodes.map(n => ({ id: n.node_id, name: n.node_name, pos_x: n.pos_x, pos_y: n.pos_y })));

      const allNodes = await this._get(this.KEYS.NODES);
      const otherNodes = allNodes.filter(n => n.wf_id !== workflow.wf_id);
      const newNodes = nodes.map(n => ({ ...n, wf_id: workflow.wf_id }));
      await this._set(this.KEYS.NODES, [...otherNodes, ...newNodes]);

      const allEdges = await this._get(this.KEYS.EDGES);
      const otherEdges = allEdges.filter(e => e.wf_id !== workflow.wf_id);
      const newEdges = edges.map(e => ({ ...e, wf_id: workflow.wf_id }));
      await this._set(this.KEYS.EDGES, [...otherEdges, ...newEdges]);

      return { workflow, nodes: newNodes, edges: newEdges };
    });
  }

  async resetWorkflow(wfId) {
    return this._serialize(async () => {
      const nodes = await this._get(this.KEYS.NODES);
      nodes.forEach(n => {
        if (n.wf_id === wfId) {
          n.status = 'pending';
          n.result_file_ids = '';
          n.result_thumbnails = null;
          n.result_file_names = null;
          n.error_message = '';
          n.executed_at = null;
        }
      });
      await this._set(this.KEYS.NODES, nodes);

      const workflow = await this.getWorkflow(wfId);
      if (workflow) {
        workflow.status = 'idle';
        workflow.progress_completed = 0;
        workflow.current_node_id = null;
        await this.saveWorkflow(workflow);
      }
      return true;
    });
  }
}

// Export
window.LocalStorage = LocalStorage;
