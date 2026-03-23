/**
 * Toast Notification Service
 * Reusable toast component for all alerts/notifications
 * Based on Phoenix UI Bootstrap Toast component
 */
(function() {
  'use strict';

  // Toast container - create once, reuse for all toasts
  let toastContainer = null;

  /**
   * Get or create toast container
   */
  function getToastContainer() {
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.className = 'toast-container position-fixed end-0 p-3';
      toastContainer.style.zIndex = '1055';
      toastContainer.style.top = '60px'; /* Below top bar (50px) to avoid overlapping window controls */
      toastContainer.setAttribute('aria-live', 'polite');
      toastContainer.setAttribute('aria-atomic', 'true');
      document.body.appendChild(toastContainer);
    }
    return toastContainer;
  }

  /**
   * Show toast notification
   * @param {string} message - Toast message
   * @param {string} type - Toast type: 'success', 'error', 'warning', 'info'
   * @param {object} options - Additional options
   */
  function showToast(message, type = 'info', options = {}) {
    const container = getToastContainer();
    const toastId = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Toast type configurations
    const typeConfig = {
      success: {
        bgClass: 'bg-success',
        icon: 'fa-check-circle',
        title: 'Success'
      },
      error: {
        bgClass: 'bg-danger',
        icon: 'fa-exclamation-circle',
        title: 'Error'
      },
      warning: {
        bgClass: 'bg-warning',
        icon: 'fa-exclamation-triangle',
        title: 'Warning'
      },
      info: {
        bgClass: 'bg-info',
        icon: 'fa-info-circle',
        title: 'Info'
      }
    };

    const config = typeConfig[type] || typeConfig.info;
    const autohide = options.autohide !== false; // Default true
    const delay = options.delay || 5000;

    const timeStr = new Date().toLocaleTimeString();
    const toastHTML = `
      <div class="toast vision-toast-card" 
           id="${toastId}" 
           role="alert" 
           aria-live="assertive" 
           aria-atomic="true"
           data-bs-autohide="${autohide}"
           data-bs-delay="${delay}">
        <div class="toast-header ${config.bgClass} text-white d-flex align-items-center">
          <span class="fas ${config.icon} me-2 flex-shrink-0"></span>
          <strong class="me-auto text-truncate">${options.title || config.title}</strong>
          <small class="text-white text-opacity-75 flex-shrink-0 ms-1">${timeStr}</small>
          <button class="btn btn-link btn-sm p-0 ms-2 flex-shrink-0 text-white text-decoration-none" type="button" data-bs-dismiss="toast" aria-label="Close">
            <span class="fas fa-times"></span>
          </button>
        </div>
        <div class="toast-body">
          ${message}
        </div>
      </div>
    `;

    // Create toast element
    const toastElement = document.createElement('div');
    toastElement.innerHTML = toastHTML;
    const toast = toastElement.firstElementChild;

    // Add to container
    container.appendChild(toast);

    // Wait for Bootstrap to be available
    if (typeof bootstrap === 'undefined') {
      console.warn('Bootstrap not loaded yet, showing toast without animation');
      toast.classList.add('show');
      
      // Auto remove after delay
      if (autohide) {
        setTimeout(() => {
          toast.remove();
        }, delay);
      }
    } else {
      // Initialize Bootstrap toast
      const bsToast = new bootstrap.Toast(toast, {
        autohide: autohide,
        delay: delay
      });

      // Show toast
      bsToast.show();

      // Remove from DOM after hiding
      toast.addEventListener('hidden.bs.toast', () => {
        toast.remove();
      });
    }

    return toast;
  }

  /**
   * Convenience methods for different toast types
   */
  window.VisionToast = {
    success: (message, options) => showToast(message, 'success', options),
    error: (message, options) => showToast(message, 'error', options),
    warning: (message, options) => showToast(message, 'warning', options),
    info: (message, options) => showToast(message, 'info', options),
    show: showToast
  };
})();

