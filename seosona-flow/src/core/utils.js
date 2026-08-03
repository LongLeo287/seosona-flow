// Shared utilities for sidePanel context
// These functions were previously only in content.js

function debounce(fn, delay) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Execution state (sidePanel mirrors content script state via MessageBridge)
let isRunning = false;
let shouldStop = false;

function sendLog(msg, level = 'info') {
  console.log(`[SEOSONA Flow] ${msg}`);
  const logContainer = document.getElementById('logContainer');
  if (logContainer) {
    const div = document.createElement('div');
    div.className = `log-entry ${level}`;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logContainer.appendChild(div);
    logContainer.scrollTop = logContainer.scrollHeight;
  }
  const logTabBtn = document.querySelector('.seosonaflow-tab[data-tab="tab-logs"]');
  if (logTabBtn && !logTabBtn.classList.contains('active')) {
    logTabBtn.classList.add('has-new');
  }
}

// @deprecated PQ-11: sendProgress removed — progress consolidated into FloatingTracker
function sendProgress() {}

// @deprecated PQ-11: globalProgressBar removed — progress consolidated into FloatingTracker
// Kept as no-ops for backward compatibility
function updateGlobalProgress() {}
function completeGlobalProgress() {}
function resetGlobalProgress() {}
