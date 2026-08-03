// Boot script for sidePanel — loaded as external file to comply with CSP
document.addEventListener('DOMContentLoaded', () => {
  if (window.SidebarManager) {
    SidebarManager.init();
  }
});
