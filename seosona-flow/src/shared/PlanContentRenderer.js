/**
 * PlanContentRenderer
 * Render plan features từ JSON content
 * Dùng cho upgrade modal trong extension sidebar
 */
class PlanContentRenderer {
  /**
   * Escape HTML special chars (& < > " ') for safe innerHTML interpolation.
   * Plan content can come from server/AI JSON → must be escaped before render.
   * @param {*} str
   * @returns {string}
   */
  static _escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /** Whitelist of allowed badge color suffixes (used in `badge-<color>` class). */
  static _BADGE_COLORS = ['green', 'blue', 'purple', 'orange', 'red', 'gold', 'gray'];

  /**
   * Parse plan content (JSON hoặc plain text)
   * @param {string|null} content - Plan content
   * @returns {Object|null} Parsed content
   */
  static parse(content) {
    if (!content) return null;

    // Handle object (already parsed by API response)
    if (typeof content === 'object') {
      return content;
    }

    // Handle string
    try {
      return JSON.parse(content);
    } catch {
      // Try to fix malformed JSON with single quotes (PHP-style)
      try {
        // Replace single quotes with double quotes for JSON compatibility
        // This handles content saved with wrong format like: {'features': [...]}
        const fixed = String(content)
          .replace(/'/g, '"')  // Replace all single quotes with double quotes
          .replace(/(\w+):/g, '"$1":');  // Ensure keys are quoted
        return JSON.parse(fixed);
      } catch {
        // Legacy: plain text format (newline separated)
        return {
          features: [{
            title: '',
            items: String(content).split('\n').filter(s => s.trim())
          }]
        };
      }
    }
  }

  /**
   * Get SVG path for icon
   * @param {string} icon - Icon name
   * @returns {string} SVG path data
   */
  static getIconPath(icon) {
    const iconPaths = {
      check: 'M5 13l4 4L19 7',
      crown: 'M5 16L3 5L8.5 10L12 4L15.5 10L21 5L19 16H5ZM19 19C19 19.6 18.6 20 18 20H6C5.4 20 5 19.6 5 19V18H19V19Z',
      infinity: 'M18.6 6.62c-1.44 0-2.8.56-3.77 1.53L12 10.66 10.48 12h.01L7.8 14.39c-.64.64-1.49.99-2.4.99-1.87 0-3.39-1.51-3.39-3.38S3.53 8.62 5.4 8.62c.91 0 1.76.35 2.44 1.03l1.13 1 1.51-1.34L9.22 8.2A5.37 5.37 0 0 0 5.4 6.62C2.42 6.62 0 9.04 0 12s2.42 5.38 5.4 5.38c1.44 0 2.8-.56 3.77-1.53l2.83-2.5.01.01L13.52 12h-.01l2.69-2.39c.64-.64 1.49-.99 2.4-.99 1.87 0 3.39 1.51 3.39 3.38s-1.52 3.38-3.39 3.38c-.9 0-1.76-.35-2.44-1.03l-1.14-1.01-1.51 1.34 1.27 1.12a5.386 5.386 0 0 0 3.82 1.57c2.98 0 5.4-2.41 5.4-5.38s-2.42-5.37-5.4-5.37z',
      zap: 'M13 2L3 14h9l-1 8 10-12h-9l1-8z',
      shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
      star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'
    };
    return iconPaths[icon] || iconPaths.check;
  }

  /**
   * Get icon color CSS class
   * @param {string} icon - Icon name
   * @returns {string} CSS class
   */
  static getIconColorClass(icon) {
    const colorMap = {
      crown: 'plan-icon-crown',
      infinity: 'plan-icon-infinity',
      zap: 'plan-icon-zap',
      shield: 'plan-icon-shield',
      star: 'plan-icon-star'
    };
    return colorMap[icon] || 'plan-icon-check';
  }

  /**
   * Render plan features to HTML
   * @param {string|null} content - Plan content (JSON or plain text)
   * @param {Object} options - Render options
   * @returns {string} HTML string
   */
  static render(content, options = {}) {
    const parsed = this.parse(content);
    if (!parsed || !parsed.features) return '';

    const { variant = 'dark' } = options;

    let html = `<div class="plan-feature-list ${variant}">`;

    for (const group of parsed.features) {
      html += '<div class="plan-feature-group">';

      // Group header (if title exists)
      if (group.title) {
        const iconPath = this.getIconPath(group.icon);
        const iconClass = this.getIconColorClass(group.icon);

        html += `
          <div class="plan-feature-group-header">
            <span class="plan-feature-icon ${iconClass}">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="${iconPath}" />
              </svg>
            </span>
            <span class="plan-feature-title">${this._escapeHtml(group.title)}</span>
            ${group.badge ? `<span class="plan-feature-badge${group.badgeColor && this._BADGE_COLORS.includes(group.badgeColor) ? ' badge-' + group.badgeColor : ''}">${this._escapeHtml(group.badge)}</span>` : ''}
          </div>`;
      }

      // Feature items
      if (group.items && group.items.length) {
        html += '<ul class="plan-feature-items">';
        for (const item of group.items) {
          const text = typeof item === 'string' ? item : item.text;
          const included = typeof item === 'string' ? true : item.included !== false;
          const highlight = typeof item === 'string' ? false : !!item.highlight;
          const itemClass = `plan-feature-item${!included ? ' plan-item-excluded' : ''}${highlight ? ' plan-item-highlight' : ''}`;

          if (included) {
            html += `
              <li class="${itemClass}">
                <svg class="plan-item-check" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>${this._escapeHtml(text)}</span>
              </li>`;
          } else {
            html += `
              <li class="${itemClass}">
                <svg class="plan-item-x" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                <span>${this._escapeHtml(text)}</span>
              </li>`;
          }
        }
        html += '</ul>';
      }

      html += '</div>';
    }

    html += '</div>';
    return html;
  }
}

// Export for use in extension
window.PlanContentRenderer = PlanContentRenderer;
