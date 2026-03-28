/**
 * Cameras List - Shows all cameras as cards (no live video). Click opens camera detail page.
 * Create Camera modal: collect name, stream_url, location, tags and call create API.
 * Same pattern as agents-board: runs on vision:spa:navigated and when #vision-cameras-list-grid exists.
 */
(function () {
  'use strict';

  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  function resetCreateCameraModal() {
    var nameEl = document.getElementById('cc-name');
    var streamUrlEl = document.getElementById('cc-stream-url');
    var areaEl = document.getElementById('cc-location-area');
    var zoneEl = document.getElementById('cc-location-zone');
    var tagsEl = document.getElementById('cc-tags');
    var nameErr = document.getElementById('cc-name-error');
    var streamErr = document.getElementById('cc-stream-url-error');
    var alertEl = document.getElementById('cc-error-alert');
    if (nameEl) nameEl.value = '';
    if (streamUrlEl) streamUrlEl.value = '';
    if (areaEl) areaEl.value = '';
    if (zoneEl) zoneEl.value = '';
    if (tagsEl) tagsEl.value = '';
    if (nameErr) { nameErr.classList.add('d-none'); nameErr.textContent = ''; }
    if (streamErr) { streamErr.classList.add('d-none'); streamErr.textContent = ''; }
    if (alertEl) {
      alertEl.classList.add('d-none');
      var m = document.getElementById('cc-error-msg');
      if (m) m.textContent = '';
    }
  }

  function showCreateCameraError(msg) {
    var alertEl = document.getElementById('cc-error-alert');
    var msgEl = document.getElementById('cc-error-msg');
    if (alertEl && msgEl) {
      msgEl.textContent = msg || 'An error occurred.';
      alertEl.classList.remove('d-none');
    }
  }

  function hideCreateCameraError() {
    var alertEl = document.getElementById('cc-error-alert');
    if (alertEl) alertEl.classList.add('d-none');
  }

  function setCreateButtonLoading(loading) {
    var btn = document.getElementById('cc-create-btn');
    var text = document.getElementById('cc-create-text');
    var spinner = document.getElementById('cc-create-spinner');
    if (!btn) return;
    btn.disabled = loading;
    if (text) text.textContent = loading ? 'Creating…' : 'Create Camera';
    if (spinner) spinner.classList.toggle('d-none', !loading);
  }

  function openCreateCameraModal() {
    resetCreateCameraModal();
    var modalEl = document.getElementById('vision-create-camera-modal');
    if (!modalEl || typeof bootstrap === 'undefined') return;
    var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
  }

  function loadCameras() {
    var grid = document.getElementById('vision-cameras-list-grid');
    var countEl = document.getElementById('vision-cameras-count');
    if (!grid) return;
    if (countEl) countEl.textContent = '0';
    grid.innerHTML = '<div class="vision-cameras-grid-message"><p class="text-body-tertiary mb-0">Loading…</p></div>';

    if (!window.visionAPI || typeof window.visionAPI.listCameras !== 'function') {
      grid.innerHTML = '<div class="vision-cameras-grid-message"><p class="text-danger mb-0">API not available.</p></div>';
      return;
    }
    if (typeof window.visionAPI.isAuthenticated === 'function' && !window.visionAPI.isAuthenticated()) {
      grid.innerHTML = '<div class="vision-cameras-grid-message"><p class="text-danger mb-0">Please sign in to view cameras.</p></div>';
      return;
    }

    window.visionAPI.listCameras()
      .then(function (cameras) {
        var list = Array.isArray(cameras) ? cameras : [];
        if (countEl) countEl.textContent = String(list.length);
        if (list.length === 0) {
          grid.innerHTML = '<div class="vision-cameras-grid-message"><p class="text-body-tertiary mb-0">No cameras found.</p></div>';
          return;
        }
        grid.innerHTML = list.map(function (cam) {
          var rawId = cam.id || '';
          var idAttr = rawId.replace(/"/g, '&quot;');
          var name = (cam.name || cam.id || 'Unnamed').replace(/</g, '&lt;').replace(/>/g, '&gt;');
          var idLine = cam.id ? String(cam.id) : '';
          var idLineHtml = idLine.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          var titleName = escapeAttr(cam.name || cam.id || 'Unnamed');
          var titleId = escapeAttr(idLine);
          var ariaOpen = escapeAttr('Open camera: ' + (cam.name || cam.id || ''));
          var href = 'camera-detail.html?camera=' + encodeURIComponent(cam.id || '');
          /* Same visual pattern as dashboard Latest Events (compact horizontal tile). */
          return (
            '<div class="min-w-0">' +
            '  <div class="btn-reveal-trigger position-relative rounded-2 overflow-hidden vision-camera-tile-card p-3" style="width:100%;height:170px;min-width:0;">' +
            '    <div class="w-100 h-100 position-absolute top-0 start-0 bg-body-secondary"></div>' +
            '    <div class="w-100 h-100 position-absolute top-0 start-0" style="background: linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%);"></div>' +
            '    <div class="position-relative h-100 d-flex flex-column justify-content-between">' +
            '      <div class="d-flex justify-content-between align-items-center">' +
            '        <span class="badge badge-phoenix badge-phoenix-success fs-10" data-bs-theme="light">Camera</span>' +
            '      </div>' +
            '      <div class="min-w-0">' +
            '        <h4 class="text-white fw-bold line-clamp-2 mb-1" title="' + titleName + '">' + name + '</h4>' +
            '        <div class="d-flex align-items-center mt-2 min-w-0">' +
            '          <span class="fa-solid fa-video text-white text-opacity-75 me-2 fs-10 flex-shrink-0" aria-hidden="true"></span>' +
            '          <span class="text-white text-opacity-75 fs-9 text-truncate" title="' + titleId + '">' + (idLineHtml || '—') + '</span>' +
            '        </div>' +
            '      </div>' +
            '    </div>' +
            '    <a class="stretched-link" href="' + href + '" data-vision-camera-id="' + idAttr + '" aria-label="' + ariaOpen + '"></a>' +
            '  </div>' +
            '</div>'
          );
        }).join('');

        grid.querySelectorAll('a[data-vision-camera-id].stretched-link').forEach(function (link) {
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
        grid.innerHTML = '<div class="vision-cameras-grid-message"><p class="text-danger mb-0">' + (err.message || 'Failed to load cameras') + '</p></div>';
      });
  }

  function setupCreateCameraModal() {
    var modalCreateBtn = document.getElementById('cc-create-btn');
    var errorDismiss = document.getElementById('cc-error-dismiss');
    var modalEl = document.getElementById('vision-create-camera-modal');

    // Use event delegation for Create button (works when navigating via SPA - button may not exist when script first runs)
    if (!document.body.hasAttribute('data-vision-cameras-create-bound')) {
      document.body.setAttribute('data-vision-cameras-create-bound', 'true');
      document.body.addEventListener('click', function (e) {
        var btn = e.target && e.target.closest ? e.target.closest('#vision-cameras-create-btn') : null;
        if (btn) {
          e.preventDefault();
          openCreateCameraModal();
        }
      });
    }

    if (errorDismiss && !errorDismiss.hasAttribute('data-cc-bound')) {
      errorDismiss.setAttribute('data-cc-bound', 'true');
      errorDismiss.addEventListener('click', function () {
        hideCreateCameraError();
      });
    }

    if (modalCreateBtn && !modalCreateBtn.hasAttribute('data-cc-bound')) {
      modalCreateBtn.setAttribute('data-cc-bound', 'true');
      modalCreateBtn.addEventListener('click', function () {
        var nameEl = document.getElementById('cc-name');
        var streamUrlEl = document.getElementById('cc-stream-url');
        var areaEl = document.getElementById('cc-location-area');
        var zoneEl = document.getElementById('cc-location-zone');
        var tagsEl = document.getElementById('cc-tags');
        var nameErr = document.getElementById('cc-name-error');
        var streamErr = document.getElementById('cc-stream-url-error');

        var name = nameEl ? nameEl.value.trim() : '';
        var streamUrl = streamUrlEl ? streamUrlEl.value.trim() : '';
        var area = areaEl ? areaEl.value.trim() : '';
        var zone = zoneEl ? zoneEl.value.trim() : '';
        var tagsStr = tagsEl ? tagsEl.value.trim() : '';

        if (nameErr) { nameErr.classList.add('d-none'); nameErr.textContent = ''; }
        if (streamErr) { streamErr.classList.add('d-none'); streamErr.textContent = ''; }
        hideCreateCameraError();

        var hasError = false;
        if (!name) {
          if (nameErr) { nameErr.textContent = 'Camera name is required.'; nameErr.classList.remove('d-none'); }
          hasError = true;
        }
        if (!streamUrl) {
          if (streamErr) { streamErr.textContent = 'Stream URL is required.'; streamErr.classList.remove('d-none'); }
          hasError = true;
        }
        if (hasError) return;

        if (!window.visionAPI || typeof window.visionAPI.createCamera !== 'function') {
          showCreateCameraError('API not available.');
          return;
        }
        if (typeof window.visionAPI.isAuthenticated === 'function' && !window.visionAPI.isAuthenticated()) {
          showCreateCameraError('Please sign in to create a camera.');
          return;
        }

        var metadata = null;
        if (area || zone || tagsStr) {
          metadata = {};
          if (area || zone) {
            metadata.location = {};
            if (area) metadata.location.area = area;
            if (zone) metadata.location.zone = zone;
          }
          if (tagsStr) {
            metadata.tags = tagsStr.split(',').map(function (t) { return t.trim(); }).filter(Boolean);
          }
        }

        setCreateButtonLoading(true);
        window.visionAPI.createCamera({
          name: name,
          stream_url: streamUrl,
          metadata: metadata || undefined
        })
          .then(function (camera) {
            setCreateButtonLoading(false);
            if (typeof bootstrap !== 'undefined' && modalEl) {
              var modal = bootstrap.Modal.getInstance(modalEl);
              if (modal) modal.hide();
            }
            loadCameras();
            var toast = window.toastService || window.VisionToast;
            if (toast && typeof toast.success === 'function') {
              toast.success('Camera created successfully.');
            } else {
              alert('Camera created successfully.');
            }
          })
          .catch(function (err) {
            setCreateButtonLoading(false);
            showCreateCameraError(err.message || 'Failed to create camera.');
          });
      });
    }
  }

  function boot() {
    var grid = document.getElementById('vision-cameras-list-grid');
    if (grid) loadCameras();
    setupCreateCameraModal();
  }

  boot();
  document.addEventListener('DOMContentLoaded', boot);
  window.addEventListener('vision:spa:navigated', boot);
})();
