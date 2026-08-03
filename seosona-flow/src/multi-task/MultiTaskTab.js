/**
 * MultiTaskTab - Controller chinh cho Tab 2: Multi Task
 */
class MultiTaskTab {
  constructor(container) {
    this.container = container;
    this.taskList = null;
    this.taskModal = null;
    this.isInitialized = false;
  }

  async init() {
    if (this.isInitialized) return;

    console.log('[MultiTaskTab] Initializing...');

    // Initialize storage if needed
    if (window.storageManager && !window.storageManager.storage) {
      await window.storageManager.init();
    }

    // Create TaskList component
    const listContainer = this.container.querySelector('#taskListSection') || this.container;
    this.taskList = new TaskList(listContainer);
    listContainer.__taskList = this.taskList;

    // Create TaskModal (singleton)
    if (!window.taskModal) {
      window.taskModal = new TaskModal();
    }
    this.taskModal = window.taskModal;

    // Module-blocked-overlay được quản lý bởi app.js refreshModuleOverlays()

    this.isInitialized = true;
    console.log('[MultiTaskTab] Initialized');
  }

  destroy() {
    // Cleanup if needed
    this.isInitialized = false;
  }
}

// Export
window.MultiTaskTab = MultiTaskTab;
