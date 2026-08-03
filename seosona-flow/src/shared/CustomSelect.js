/**
 * CustomSelect - Replaces native <select> elements with a premium custom UI.
 * Handles styling, option rendering, and state sync with the original select.
 */

class CustomSelect {
  static initAll(selector = '.select-group select') {
    const selects = document.querySelectorAll(selector);
    selects.forEach(select => {
      if (select.dataset.customSelectInitialized) return;
      new CustomSelect(select);
    });
    
    // Close dropdowns when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.seosona-custom-select')) {
        document.querySelectorAll('.seosona-select-dropdown').forEach(dropdown => {
          dropdown.classList.add('hidden');
        });
        document.querySelectorAll('.seosona-select-overlay').forEach(overlay => {
          overlay.classList.remove('is-open');
        });
      }
    });
  }

  constructor(selectElement) {
    this.select = selectElement;
    this.select.dataset.customSelectInitialized = "true";
    this.wrapper = this.select.closest('.select-group') || this.select.parentElement;
    
    this.buildUI();
    this.bindEvents();
    this.updateValue();
  }

  buildUI() {
    // Hide the native select's text but keep it in DOM for spacing and accessibility
    this.select.style.opacity = '0';
    this.select.style.color = 'transparent';
    
    // Create the custom container
    this.container = document.createElement('div');
    this.container.className = 'seosona-custom-select';
    
    // Create the click overlay & text display
    this.overlay = document.createElement('div');
    this.overlay.className = 'seosona-select-overlay';
    this.overlay.tabIndex = 0;
    
    this.textDisplay = document.createElement('div');
    this.textDisplay.className = 'seosona-select-text';
    
    // Copy padding from native select to perfectly align text, accounting for flexbox offsets
    this.wrapper.style.position = 'relative'; // Ensure wrapper is offsetParent BEFORE getting offsets
    const computedStyle = window.getComputedStyle(this.select);
    
    // The native select might be pushed right by a flex icon (e.g. premium-select-wrapper).
    // So the actual left padding from the wrapper's left edge is offsetLeft + paddingLeft.
    const actualPaddingLeft = this.select.offsetLeft + parseFloat(computedStyle.paddingLeft || 0);
    const actualPaddingTop = this.select.offsetTop + parseFloat(computedStyle.paddingTop || 0);
    
    this.textDisplay.style.paddingLeft = `${actualPaddingLeft}px`;
    this.textDisplay.style.paddingRight = computedStyle.paddingRight;
    this.textDisplay.style.paddingTop = `${actualPaddingTop}px`;
    this.textDisplay.style.paddingBottom = computedStyle.paddingBottom;
    
    this.overlay.appendChild(this.textDisplay);
    
    // Create dropdown menu
    this.dropdown = document.createElement('div');
    this.dropdown.className = 'seosona-select-dropdown hidden';
    
    this.renderOptions();
    
    this.container.appendChild(this.overlay);
    document.body.appendChild(this.dropdown);
    
    // Insert into DOM inside the wrapper
    this.wrapper.appendChild(this.container);
  }

  renderOptions() {
    this.dropdown.innerHTML = '';
    const options = Array.from(this.select.options);
    
    options.forEach(option => {
      const optDiv = document.createElement('div');
      optDiv.className = 'seosona-select-option';
      if (option.selected) optDiv.classList.add('selected');
      if (option.disabled) optDiv.classList.add('disabled');
      
      optDiv.dataset.value = option.value;
      optDiv.textContent = option.textContent;
      
      optDiv.addEventListener('click', (e) => {
        e.stopPropagation();
        if (option.disabled) return;
        
        this.select.value = option.value;
        this.updateValue();
        this.close();
        
        // Dispatch change event for external listeners
        this.select.dispatchEvent(new Event('change', { bubbles: true }));
      });
      
      this.dropdown.appendChild(optDiv);
    });
  }

  bindEvents() {
    this.overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggle();
    });
    
    this.overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.toggle();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });

    // Listen to programmatic changes on the native select
    this.select.addEventListener('change', () => {
      this.updateValue();
    });
    
    // Monitor DOM mutations (in case options are added/removed dynamically)
    const observer = new MutationObserver(() => {
      this.renderOptions();
      this.updateValue();
    });
    observer.observe(this.select, { childList: true, subtree: true });
  }

  updateValue() {
    const selectedOption = this.select.options[this.select.selectedIndex];
    if (selectedOption) {
      this.textDisplay.textContent = selectedOption.textContent;
    } else {
      this.textDisplay.textContent = '';
    }
    
    // Update active class in dropdown
    const options = this.dropdown.querySelectorAll('.seosona-select-option');
    options.forEach(opt => {
      if (opt.dataset.value === this.select.value) {
        opt.classList.add('selected');
      } else {
        opt.classList.remove('selected');
      }
    });
  }

  toggle() {
    const isOpen = !this.dropdown.classList.contains('hidden');
    // Close all other dropdowns first
    document.querySelectorAll('.seosona-select-dropdown').forEach(dropdown => {
      dropdown.classList.add('hidden');
    });
    document.querySelectorAll('.seosona-select-overlay').forEach(overlay => {
      overlay.classList.remove('is-open');
    });
    
    if (!isOpen) {
      this.open();
    }
  }

  open() {
    // Calculate position
    const rect = this.container.getBoundingClientRect();
    this.dropdown.style.top = `${rect.bottom + window.scrollY + 4}px`;
    this.dropdown.style.left = `${rect.left + window.scrollX}px`;
    this.dropdown.style.minWidth = `${rect.width}px`;
    // Optionally constrain max-width if needed
    
    this.dropdown.classList.remove('hidden');
    this.overlay.classList.add('is-open');
  }

  close() {
    this.dropdown.classList.add('hidden');
    this.overlay.classList.remove('is-open');
  }
}

// Close on scroll to prevent detached floating dropdowns
window.addEventListener('scroll', () => {
  document.querySelectorAll('.seosona-select-dropdown:not(.hidden)').forEach(dropdown => {
    dropdown.classList.add('hidden');
  });
  document.querySelectorAll('.seosona-select-overlay.is-open').forEach(overlay => {
    overlay.classList.remove('is-open');
  });
}, true);

window.CustomSelect = CustomSelect;
