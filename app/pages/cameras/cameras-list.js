import { api } from '../../core/api.js';
import { navigate } from '../../core/router.js';

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function setCamerasLoading(isLoading) {
  const grid = document.getElementById('vision-cameras-list-grid');
  if (grid) grid.setAttribute('data-loading', isLoading ? 'true' : 'false');
}

function renderCamerasSkeleton() {
  const grid = document.getElementById('vision-cameras-list-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="vision-cameras-skeleton-grid" id="vision-cameras-skeleton-grid">' +
    '<div class="vision-cameras-skeleton-card"></div>' +
    '<div class="vision-cameras-skeleton-card"></div>' +
    '<div class="vision-cameras-skeleton-card"></div>' +
    '<div class="vision-cameras-skeleton-card"></div>' +
    '<div class="vision-cameras-skeleton-card"></div>' +
    '<div class="vision-cameras-skeleton-card"></div>' +
    '<div class="vision-cameras-skeleton-card"></div>' +
    '<div class="vision-cameras-skeleton-card"></div>' +
    '<div class="vision-cameras-skeleton-card"></div>' +
    '<div class="vision-cameras-skeleton-card"></div>' +
    '<div class="vision-cameras-skeleton-card"></div>' +
    '<div class="vision-cameras-skeleton-card"></div>' +
    '</div>';
}

function loadCameras() {
  const grid = document.getElementById('vision-cameras-list-grid');
  const countEl = document.getElementById('vision-cameras-count');
  if (!grid) return;
  setCamerasLoading(true);
  if (countEl) countEl.textContent = '0';
  renderCamerasSkeleton();

  if (!api.isAuthenticated()) {
    grid.innerHTML = '<div class="vision-cameras-grid-message"><p class="text-danger mb-0">Please sign in to view cameras.</p></div>';
    setCamerasLoading(false);
    return;
  }

  api.listCameras()
    .then(async cameras => {
      const list = Array.isArray(cameras) ? cameras : [];
      if (countEl) countEl.textContent = String(list.length);
      if (list.length === 0) {
        grid.innerHTML = '<div class="vision-cameras-grid-message"><p class="text-body-tertiary mb-0">No cameras found.</p></div>';
        setCamerasLoading(false);
        return;
      }

      // Fetch previews for all cameras in parallel (non-blocking — failures are safe)
      const previews = await Promise.allSettled(
        list.map(cam => api.getCameraPreview(cam.id).catch(() => null))
      );
      const previewMap = new Map();
      previews.forEach((result, i) => {
        if (result.status === 'fulfilled' && result.value) {
          previewMap.set(list[i].id, result.value);
        }
      });

      grid.innerHTML = list.map(cam => {
        const name    = escapeHtml(cam.name || cam.id || 'Unnamed');
        const idText  = escapeHtml(cam.id || '');
        const href    = `/app/pages/cameras/camera-detail.html?camera=${encodeURIComponent(cam.id || '')}`;
        const preview = previewMap.get(cam.id);
        const reason  = escapeHtml(cam.status_reason || '');

        // Status badge
        const normalizeStatus = (s) => {
          const v = String(s || '').toLowerCase();
          return v === 'error' ? 'reconnecting' : v;
        };
        const status = normalizeStatus(preview?.status || cam.status || 'unknown');
        let statusClass = 'badge-phoenix-secondary';
        let statusLabel = 'Unknown';
        let statusDot   = '';
        if (status === 'live') {
          statusClass = 'badge-phoenix-success';
          statusLabel = 'Live Preview';
          statusDot   = '<span class="dashboard-live-dot me-1"></span>';
        } else if (status === 'offline') {
          statusClass = 'badge-phoenix-danger';
          statusLabel = 'Offline';
        } else if (status === 'reconnecting') {
          statusClass = 'badge-phoenix-warning';
          statusLabel = 'Reconnecting';
        }

        // Snapshot image (inline base64 so no extra request)
        const hasImage = !!(preview?.frame_base64);
        const imgStyle = hasImage ? '' : 'display:none;';
        const imgSrc   = hasImage ? `data:image/jpeg;base64,${preview.frame_base64}` : '';

        // Placeholder icon when no image
        const placeholderStyle = hasImage ? 'display:none;' : '';

        return `<div class="min-w-0">
          <div class="btn-reveal-trigger position-relative rounded-2 overflow-hidden vision-camera-tile-card" style="width:100%;height:170px;min-width:0;">

            <!-- Dark fallback background -->
            <div class="w-100 h-100 position-absolute top-0 start-0" style="background:#111;"></div>

            <!-- Snapshot image fills the card like an event card -->
            <img
              class="w-100 h-100 position-absolute top-0 start-0"
              style="object-fit:cover;${imgStyle}"
              src="${imgSrc}"
              alt=""
            />

            <!-- Placeholder (no image) -->
            <div
              class="w-100 h-100 position-absolute top-0 start-0 d-flex flex-column align-items-center justify-content-center gap-1"
              style="color:#555;${placeholderStyle}"
            >
              <span class="fa-solid fa-video-slash" style="font-size:1.4rem;"></span>
              <span class="fs-10">${reason || (status === 'offline' ? 'Camera offline' : status === 'reconnecting' ? 'Reconnecting…' : 'No preview')}</span>
            </div>

            <!-- Gradient overlay for text readability -->
            <div class="w-100 h-100 position-absolute top-0 start-0" style="background:linear-gradient(180deg,rgba(0,0,0,0.5) 0%,rgba(0,0,0,0) 40%,rgba(0,0,0,0) 55%,rgba(0,0,0,0.65) 100%);"></div>

            <!-- Content layer -->
            <div class="position-relative h-100 d-flex flex-column justify-content-between p-3">
              <div class="d-flex justify-content-between align-items-start">
                <span class="badge badge-phoenix ${statusClass} fs-10" data-bs-theme="light" title="${reason}">${statusDot}${statusLabel}</span>
              </div>
              <div class="min-w-0">
                <h4 class="text-white fw-bold line-clamp-2 mb-1">${name}</h4>
                <div class="d-flex align-items-center min-w-0">
                  <span class="fa-solid fa-video text-white text-opacity-75 me-2 fs-10 flex-shrink-0"></span>
                  <span class="text-white text-opacity-75 fs-9 text-truncate">${idText || '—'}</span>
                </div>
                ${reason ? `<div class="text-white text-opacity-75 fs-10 text-truncate mt-1" title="${reason}">${reason}</div>` : ''}
              </div>
            </div>

            <a class="stretched-link" href="${href}" data-vision-camera-id="${escapeHtml(cam.id || '')}" aria-label="Open camera: ${name}"></a>
          </div>
        </div>`;
      }).join('');

      grid.querySelectorAll('a[data-vision-camera-id]').forEach(link => {
        link.addEventListener('click', e => {
          e.preventDefault();
          navigate(link.getAttribute('href')).catch(() => { window.location.href = link.getAttribute('href'); });
        });
      });
      setCamerasLoading(false);
    })
    .catch(err => {
      if (countEl) countEl.textContent = '0';
      grid.innerHTML = `<div class="vision-cameras-grid-message"><p class="text-danger mb-0">${escapeHtml(err.message || 'Failed to load cameras')}</p></div>`;
      setCamerasLoading(false);
    });
}

function openCreateCameraModal() {
  const modalEl = document.getElementById('vision-create-camera-modal');
  if (!modalEl || typeof bootstrap === 'undefined') return;
  ['cc-name', 'cc-stream-url', 'cc-location-area', 'cc-location-zone', 'cc-tags'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['cc-name-error', 'cc-stream-url-error'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.classList.add('d-none'); el.textContent = ''; }
  });
  const alertEl = document.getElementById('cc-error-alert');
  if (alertEl) { alertEl.classList.add('d-none'); const m = document.getElementById('cc-error-msg'); if (m) m.textContent = ''; }
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function setupCreateCameraModal() {
  if (document.body.getAttribute('data-vision-cameras-create-bound') === 'true') return;
  document.body.setAttribute('data-vision-cameras-create-bound', 'true');

  document.body.addEventListener('click', e => {
    if (e.target?.closest('#vision-cameras-create-btn')) { e.preventDefault(); openCreateCameraModal(); }
    if (e.target?.closest('#cc-error-dismiss')) { document.getElementById('cc-error-alert')?.classList.add('d-none'); }
  });

  const createBtn = document.getElementById('cc-create-btn');
  if (createBtn && !createBtn.getAttribute('data-cc-bound')) {
    createBtn.setAttribute('data-cc-bound', 'true');
    createBtn.addEventListener('click', async () => {
      const name = document.getElementById('cc-name')?.value.trim() || '';
      const streamUrl = document.getElementById('cc-stream-url')?.value.trim() || '';
      const area = document.getElementById('cc-location-area')?.value.trim() || '';
      const zone = document.getElementById('cc-location-zone')?.value.trim() || '';
      const tagsStr = document.getElementById('cc-tags')?.value.trim() || '';
      let hasError = false;
      const nameErr = document.getElementById('cc-name-error');
      const streamErr = document.getElementById('cc-stream-url-error');
      if (nameErr) { nameErr.classList.add('d-none'); nameErr.textContent = ''; }
      if (streamErr) { streamErr.classList.add('d-none'); streamErr.textContent = ''; }
      if (!name) { if (nameErr) { nameErr.textContent = 'Camera name is required.'; nameErr.classList.remove('d-none'); } hasError = true; }
      if (!streamUrl) { if (streamErr) { streamErr.textContent = 'Stream URL is required.'; streamErr.classList.remove('d-none'); } hasError = true; }
      if (hasError) return;
      const btn = document.getElementById('cc-create-btn');
      const text = document.getElementById('cc-create-text');
      const spinner = document.getElementById('cc-create-spinner');
      if (btn) btn.disabled = true;
      if (text) text.textContent = 'Creating…';
      if (spinner) spinner.classList.remove('d-none');
      try {
        const metadata = (area || zone || tagsStr) ? {
          ...(area || zone ? { location: { ...(area ? { area } : {}), ...(zone ? { zone } : {}) } } : {}),
          ...(tagsStr ? { tags: tagsStr.split(',').map(t => t.trim()).filter(Boolean) } : {}),
        } : undefined;
        await api.createCamera({ name, stream_url: streamUrl, metadata });
        bootstrap.Modal.getInstance(document.getElementById('vision-create-camera-modal'))?.hide();
        loadCameras();
      } catch (err) {
        const alertEl = document.getElementById('cc-error-alert');
        const msgEl = document.getElementById('cc-error-msg');
        if (alertEl && msgEl) { msgEl.textContent = err.message || 'Failed to create camera.'; alertEl.classList.remove('d-none'); }
      } finally {
        if (btn) btn.disabled = false;
        if (text) text.textContent = 'Create Camera';
        if (spinner) spinner.classList.add('d-none');
      }
    });
  }
}

function boot() {
  if (document.getElementById('vision-cameras-list-grid')) loadCameras();
  setupCreateCameraModal();
}

boot();
window.addEventListener('vision:spa:navigated', boot);
