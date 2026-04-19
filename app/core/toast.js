let toastContainer = null;

function getToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container position-fixed end-0 p-3';
    toastContainer.style.zIndex = '1055';
    toastContainer.style.top = '60px';
    toastContainer.setAttribute('aria-live', 'polite');
    toastContainer.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

const TYPE_CONFIG = {
  success: { bgClass: 'bg-success', icon: 'fa-check-circle',        title: 'Success' },
  error:   { bgClass: 'bg-danger',  icon: 'fa-exclamation-circle',  title: 'Error'   },
  warning: { bgClass: 'bg-warning', icon: 'fa-exclamation-triangle', title: 'Warning' },
  info:    { bgClass: 'bg-info',    icon: 'fa-info-circle',          title: 'Info'    },
};

export function showToast(message, type = 'info', options = {}) {
  const container = getToastContainer();
  const toastId = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const config = TYPE_CONFIG[type] || TYPE_CONFIG.info;
  const autohide = options.autohide !== false;
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
      <div class="toast-body">${message}</div>
    </div>`;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = toastHTML;
  const toast = wrapper.firstElementChild;
  container.appendChild(toast);

  if (typeof bootstrap === 'undefined') {
    toast.classList.add('show');
    if (autohide) setTimeout(() => toast.remove(), delay);
  } else {
    const bsToast = new bootstrap.Toast(toast, { autohide, delay });
    bsToast.show();
    toast.addEventListener('hidden.bs.toast', () => toast.remove());
  }

  return toast;
}

export const toast = {
  success: (message, options) => showToast(message, 'success', options),
  error:   (message, options) => showToast(message, 'error',   options),
  warning: (message, options) => showToast(message, 'warning', options),
  info:    (message, options) => showToast(message, 'info',    options),
  show: showToast,
};
