/**
 * Cameras List - Shows all cameras as cards (no live video). Click opens camera detail page.
 * Same pattern as agents-board: runs on vision:spa:navigated and when #vision-cameras-list-grid exists.
 */
(function () {
  'use strict';

  function loadCameras() {
    var grid = document.getElementById('vision-cameras-list-grid');
    var countEl = document.getElementById('vision-cameras-count');
    if (!grid) return;
    if (countEl) countEl.textContent = '0';
    grid.innerHTML = '<div class="col-12"><p class="text-body-tertiary mb-0">Loading…</p></div>';

    if (!window.visionAPI || typeof window.visionAPI.listCameras !== 'function') {
      grid.innerHTML = '<div class="col-12"><p class="text-danger mb-0">API not available.</p></div>';
      return;
    }
    if (typeof window.visionAPI.isAuthenticated === 'function' && !window.visionAPI.isAuthenticated()) {
      grid.innerHTML = '<div class="col-12"><p class="text-danger mb-0">Please sign in to view cameras.</p></div>';
      return;
    }

    window.visionAPI.listCameras()
      .then(function (cameras) {
        var list = Array.isArray(cameras) ? cameras : [];
        if (countEl) countEl.textContent = String(list.length);
        if (list.length === 0) {
          grid.innerHTML = '<div class="col-12"><p class="text-body-tertiary mb-0">No cameras found.</p></div>';
          return;
        }
        grid.innerHTML = list.map(function (cam) {
          var id = (cam.id || '').replace(/"/g, '&quot;');
          var name = (cam.name || cam.id || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          var href = 'camera-detail.html?camera=' + encodeURIComponent(cam.id || '');
          return (
            '<div class="col-12 col-sm-6 col-md-4 col-xl-3">' +
            '  <a class="card vision-camera-card h-100 text-decoration-none text-body" href="' + href + '" data-vision-camera-id="' + id + '">' +
            '    <div class="card-body d-flex align-items-center">' +
            '      <span class="fa-solid fa-video text-body-tertiary me-3 fs-4"></span>' +
            '      <div class="flex-grow-1 min-w-0">' +
            '        <h5 class="mb-0 text-truncate">' + name + '</h5>' +
            '        <p class="mb-0 fs-9 text-body-tertiary">' + (cam.id ? String(cam.id) : '') + '</p>' +
            '      </div>' +
            '      <span class="fas fa-pen text-body-tertiary fs-9" title="Open camera detail"></span>' +
            '    </div>' +
            '  </a>' +
            '</div>'
          );
        }).join('');

        grid.querySelectorAll('a[data-vision-camera-id]').forEach(function (link) {
          link.addEventListener('click', function (e) {
            var href = this.getAttribute('href');
            if (!href) return;
            if (window.visionaiSpa && typeof window.visionaiSpa.navigate === 'function') {
              e.preventDefault();
              window.visionaiSpa.navigate(href).catch(function () { window.location.href = href; });
            }
          });
        });
      })
      .catch(function (err) {
        if (countEl) countEl.textContent = '0';
        grid.innerHTML = '<div class="col-12"><p class="text-danger mb-0">' + (err.message || 'Failed to load cameras') + '</p></div>';
      });
  }

  function boot() {
    var grid = document.getElementById('vision-cameras-list-grid');
    if (!grid) return;
    loadCameras();
  }

  boot();
  document.addEventListener('DOMContentLoaded', boot);
  window.addEventListener('vision:spa:navigated', boot);
})();
