/**
 * Toast notification system
 * Usage: window.showToast('Message here', 'success' | 'error' | 'info')
 */
(function() {
  // Create container on load
  let container = null;

  function ensureContainer() {
    if (container && document.body.contains(container)) return container;
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
    return container;
  }

  window.showToast = function(message, type) {
    type = type || 'info';
    const c = ensureContainer();

    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;

    const icon = type === 'success' ? '\u2713'
               : type === 'error'   ? '\u2717'
               :                      '\u2139';

    toast.innerHTML =
      '<span class="toast-icon">' + icon + '</span>' +
      '<span class="toast-msg">' + message + '</span>' +
      '<button class="toast-close" onclick="this.parentElement.remove()">&times;</button>';

    c.appendChild(toast);

    // Trigger entrance animation on next frame
    requestAnimationFrame(function() {
      toast.classList.add('toast-visible');
    });

    // Auto-dismiss after 3s
    setTimeout(function() {
      toast.classList.remove('toast-visible');
      toast.classList.add('toast-exit');
      setTimeout(function() {
        if (toast.parentElement) toast.remove();
      }, 300);
    }, 3000);
  };
})();
