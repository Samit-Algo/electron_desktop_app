import { api } from '../../core/api.js';

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inferSeverity(label) {
  const t = String(label || '').toLowerCase();
  if (t.includes('weapon') || t.includes('fire') || t.includes('fall') || t.includes('intrusion')) return 'Critical';
  if (t.includes('violation') || t.includes('restricted') || t.includes('collision') || t.includes('alert')) return 'Warning';
  return 'Info';
}

// Normalize the API severity (which may be any case, e.g. "CRITICAL") to the
// canonical title-case value the rest of the page compares against. Falls back
// to inferring from the label — mirrors the dashboard's eventSeverity().
function canonicalSeverity(it) {
  const s = String(it.severity || '').toLowerCase();
  if (s === 'critical') return 'Critical';
  if (s === 'warning') return 'Warning';
  if (s === 'info') return 'Info';
  return inferSeverity(it.label);
}

function severityBadgeClass(sev) {
  if (sev === 'Critical') return 'badge-phoenix-danger';
  if (sev === 'Warning') return 'badge-phoenix-warning';
  return 'badge-phoenix-info';
}

// Bright, high-contrast title colour per severity (readable over any image).
function severityTextColor(sev) {
  if (sev === 'Critical') return '#ff6b6b';
  if (sev === 'Warning') return '#ffc35a';
  return '#5cc8ff';
}

function cameraNameFor(camId) {
  const id = String(camId || '');
  if (!id) return '';
  return state.cameraNames[id] || id;
}

function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.max(0, Date.now() - new Date(ts).getTime());
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return sec + 's';
  const min = Math.floor(sec / 60);
  if (min < 60) return min + 'm';
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + 'h';
  return Math.floor(hr / 24) + 'd';
}

const state = {
  allEvents: [],
  imageCache: new Map(),
  cameraNames: {},      // camera_id -> friendly name
  severityFilter: 'all',
  cameraFilter: '',
  search: '',
  range: 'all',
};

function setEventsLoading(isLoading) {
  const grid = document.getElementById('vision-events-board-grid');
  if (grid) grid.setAttribute('data-loading', isLoading ? 'true' : 'false');
}

function renderEventsSkeleton() {
  const grid = document.getElementById('vision-events-board-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="col-12"><div class="vision-events-skeleton-grid" id="vision-events-skeleton-grid">' +
    '<div class="vision-events-skeleton-card"></div>' +
    '<div class="vision-events-skeleton-card"></div>' +
    '<div class="vision-events-skeleton-card"></div>' +
    '<div class="vision-events-skeleton-card"></div>' +
    '<div class="vision-events-skeleton-card"></div>' +
    '<div class="vision-events-skeleton-card"></div>' +
    '<div class="vision-events-skeleton-card"></div>' +
    '<div class="vision-events-skeleton-card"></div>' +
    '<div class="vision-events-skeleton-card"></div>' +
    '<div class="vision-events-skeleton-card"></div>' +
    '<div class="vision-events-skeleton-card"></div>' +
    '<div class="vision-events-skeleton-card"></div>' +
    '</div></div>';
}

function normalizeEvent(it) {
  return {
    event_id: it.id || it.event_id || '',
    label: it.label || 'Event',
    event_ts: it.event_ts || it.received_at || it.timestamp || null,
    camera_id: String(it.camera_id || ''),
    severity: canonicalSeverity(it),
    thumbObjectUrl: null,
  };
}

function filtered() {
  const sevFilter = String(state.severityFilter || 'all').toLowerCase();
  return state.allEvents.filter(ev => {
    if (state.cameraFilter && ev.camera_id !== state.cameraFilter) return false;
    if (sevFilter !== 'all' && String(ev.severity).toLowerCase() !== sevFilter) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      if (!ev.label.toLowerCase().includes(q) && !ev.camera_id.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function updateCounts(events) {
  const setText = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  // Header count reflects the current (filtered) view…
  setText('vision-events-count', events.length);
  // …but the severity tab counts always reflect the full set, so they don't
  // collapse to 0 when a severity filter is active.
  const all = state.allEvents || [];
  setText('vision-events-cnt-all', all.length);
  setText('vision-events-cnt-critical', all.filter(e => e.severity === 'Critical').length);
  setText('vision-events-cnt-warning', all.filter(e => e.severity === 'Warning').length);
  setText('vision-events-cnt-info', all.filter(e => e.severity === 'Info').length);
}

function renderGrid(events) {
  const grid = document.getElementById('vision-events-board-grid');
  if (!grid) return;
  updateCounts(events);
  if (events.length === 0) {
    grid.innerHTML = '<div class="col-12"><p class="text-body-tertiary mb-0">No events found.</p></div>';
    return;
  }
  grid.innerHTML = events.map(ev => {
    const sev = ev.severity;
    const badgeCls = severityBadgeClass(sev);
    const titleColor = severityTextColor(sev);
    const ago = timeAgo(ev.event_ts);
    const camName = escapeHtml(cameraNameFor(ev.camera_id));
    const thumb = ev.thumbObjectUrl;
    const shadow = 'text-shadow:0 1px 4px rgba(0,0,0,.95);';
    const params = new URLSearchParams();
    if (ev.event_id) params.set('event_id', ev.event_id);
    const href = '/app/pages/events/event-detail.html?' + params.toString();
    return `<div class="col-12 col-sm-6 col-md-4 col-xxl-3">
      <div class="btn-reveal-trigger vision-event-card position-relative rounded-2 overflow-hidden p-4" style="height:236px;">
        ${thumb ? `<img src="${escapeHtml(thumb)}" alt="" class="w-100 h-100 position-absolute top-0 start-0" style="object-fit:cover;">` : '<div class="w-100 h-100 position-absolute top-0 start-0 bg-body-secondary"></div>'}
        <div class="w-100 h-100 position-absolute top-0 start-0" style="background:linear-gradient(180deg,rgba(0,0,0,0.45) 0%,rgba(0,0,0,0) 35%,rgba(0,0,0,0.8) 100%);"></div>
        <div class="position-relative h-100 d-flex flex-column justify-content-between">
          <div class="d-flex justify-content-between align-items-start gap-2">
            <span class="badge badge-phoenix fs-10 ${badgeCls}" data-bs-theme="light">${escapeHtml(sev)}</span>
            ${camName ? `<span class="badge fs-10 text-truncate" style="max-width:60%;background:rgba(0,0,0,.55);color:#fff;">${camName}</span>` : ''}
          </div>
          <div class="d-flex justify-content-between align-items-end gap-2">
            <span class="fw-bold fs-9 text-truncate" style="color:${titleColor};${shadow}">${escapeHtml(ev.label)}</span>
            <span class="d-flex align-items-center flex-shrink-0 text-white fs-10" style="${shadow}"><span class="fa-solid fa-clock me-1"></span>${ago || 'Just now'}</span>
          </div>
        </div>
        <a class="stretched-link" href="${href}"></a>
      </div>
    </div>`;
  }).join('');
}

async function loadThumbnail(ev) {
  if (!ev.event_id || ev.thumbObjectUrl) return;
  if (state.imageCache.has(ev.event_id)) { ev.thumbObjectUrl = state.imageCache.get(ev.event_id); return; }
  try {
    const url = await api.fetchEventImageObjectUrl(ev.event_id);
    state.imageCache.set(ev.event_id, url);
    ev.thumbObjectUrl = url;
  } catch (_) {}
}

async function loadEvents() {
  const grid = document.getElementById('vision-events-board-grid');
  if (!grid) return;
  setEventsLoading(true);
  renderEventsSkeleton();
  if (!api.isAuthenticated()) {
    grid.innerHTML = '<div class="col-12"><p class="text-danger mb-0">Please sign in to view events.</p></div>';
    setEventsLoading(false);
    return;
  }
  try {
    const [res] = await Promise.all([
      api.listEvents(state.range, 200, 0),
      loadCameraNames(),
    ]);
    const items = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
    state.allEvents = items.map(normalizeEvent);

    // Populate camera filter dropdown
    populateCameraFilter(state.allEvents);

    // Load thumbnails then render
    await Promise.all(state.allEvents.slice(0, 50).map(loadThumbnail));
    renderGrid(filtered());
    setEventsLoading(false);
  } catch (err) {
    grid.innerHTML = `<div class="col-12"><p class="text-danger mb-0">${escapeHtml(err.message || 'Failed to load events')}</p></div>`;
    setEventsLoading(false);
  }
}

// Fetch the camera list once and build an id -> friendly-name map.
async function loadCameraNames() {
  if (typeof api.listCameras !== 'function') return;
  try {
    const cams = await api.listCameras();
    const list = Array.isArray(cams) ? cams : (cams && Array.isArray(cams.items) ? cams.items : []);
    list.forEach(c => { if (c && c.id != null) state.cameraNames[String(c.id)] = c.name || String(c.id); });
  } catch (_) {}
}

function populateCameraFilter(events) {
  const sel = document.getElementById('vision-events-filter-camera');
  if (!sel) return;
  const cameras = [...new Set(events.map(e => e.camera_id).filter(Boolean))].sort();
  const current = sel.value;
  sel.innerHTML = '<option value="">All cameras</option>' + cameras.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(cameraNameFor(c))}</option>`).join('');
  if (cameras.includes(current)) sel.value = current;
}

function bindControls() {
  document.getElementById('vision-events-timeline')?.addEventListener('change', function () {
    state.range = this.value;
    loadEvents();
  });

  document.getElementById('vision-events-filter-camera')?.addEventListener('change', function () {
    state.cameraFilter = this.value;
    renderGrid(filtered());
  });

  document.getElementById('vision-events-search')?.addEventListener('input', function () {
    state.search = this.value.trim();
    renderGrid(filtered());
  });

  document.getElementById('vision-events-filters-clear')?.addEventListener('click', () => {
    state.cameraFilter = '';
    state.severityFilter = 'all';
    state.search = '';
    state.range = 'all';
    const timeline = document.getElementById('vision-events-timeline');
    if (timeline) timeline.value = 'all';
    const camFilter = document.getElementById('vision-events-filter-camera');
    if (camFilter) camFilter.value = '';
    const search = document.getElementById('vision-events-search');
    if (search) search.value = '';
    document.querySelectorAll('#vision-events-severity-tabs .events-sev-btn').forEach(l => l.classList.remove('active'));
    document.querySelector('#vision-events-severity-tabs [data-severity="all"]')?.classList.add('active');
    loadEvents();
  });

  document.getElementById('vision-events-severity-tabs')?.addEventListener('click', e => {
    const link = e.target.closest('[data-severity]');
    if (!link) return;
    e.preventDefault();
    document.querySelectorAll('#vision-events-severity-tabs .events-sev-btn').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
    state.severityFilter = link.dataset.severity || 'all';
    renderGrid(filtered());
  });
}

export function boot() {
  if (!document.getElementById('vision-events-board-grid')) return;
  setEventsLoading(true);
  state.severityFilter = 'all';
  state.cameraFilter = '';
  state.search = '';
  state.range = 'all';
  bindControls();
  let tries = 0;
  (function checkAuth() {
    if (!document.getElementById('vision-events-board-grid')) return;
    if (api && api.isAuthenticated()) {
      loadEvents();
    } else if (++tries < 50) {
      setTimeout(checkAuth, 100);
    } else {
      loadEvents();
    }
  })();
}
