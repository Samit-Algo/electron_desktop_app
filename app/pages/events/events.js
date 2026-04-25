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

function severityBadgeClass(sev) {
  if (sev === 'Critical') return 'badge-phoenix-danger';
  if (sev === 'Warning') return 'badge-phoenix-warning';
  return 'badge-phoenix-info';
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
    severity: it.severity || inferSeverity(it.label),
    thumbObjectUrl: null,
  };
}

function filtered() {
  return state.allEvents.filter(ev => {
    if (state.cameraFilter && ev.camera_id !== state.cameraFilter) return false;
    if (state.severityFilter !== 'all' && ev.severity !== state.severityFilter) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      if (!ev.label.toLowerCase().includes(q) && !ev.camera_id.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function updateCounts(events) {
  const setText = (id, n) => { const el = document.getElementById(id); if (el) el.textContent = n; };
  setText('vision-events-count', events.length);
  setText('vision-events-cnt-all', events.length);
  setText('vision-events-cnt-critical', events.filter(e => e.severity === 'Critical').length);
  setText('vision-events-cnt-warning', events.filter(e => e.severity === 'Warning').length);
  setText('vision-events-cnt-info', events.filter(e => e.severity === 'Info').length);
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
    const ago = timeAgo(ev.event_ts);
    const cam = escapeHtml(ev.camera_id);
    const thumb = ev.thumbObjectUrl;
    const params = new URLSearchParams();
    if (ev.event_id) params.set('event_id', ev.event_id);
    const href = '/app/pages/events/event-detail.html?' + params.toString();
    return `<div class="col-12 col-sm-6 col-md-4 col-xxl-3">
      <div class="btn-reveal-trigger position-relative rounded-2 overflow-hidden p-4" style="height:236px;">
        ${thumb ? `<img src="${escapeHtml(thumb)}" alt="" class="w-100 h-100 position-absolute top-0 start-0" style="object-fit:cover;">` : '<div class="w-100 h-100 position-absolute top-0 start-0 bg-body-secondary"></div>'}
        <div class="w-100 h-100 position-absolute top-0 start-0" style="background:linear-gradient(180deg,rgba(0,0,0,0) 35%,rgba(0,0,0,0.55) 100%);"></div>
        <div class="position-relative h-100 d-flex flex-column justify-content-between">
          <div><span class="badge badge-phoenix fs-10 ${badgeCls}" data-bs-theme="light">${escapeHtml(sev)}</span></div>
          <div>
            <h4 class="text-white fw-bold line-clamp-2 mb-1">${escapeHtml(ev.label)}</h4>
            <div class="d-flex align-items-center mt-2">
              <span class="fa-solid fa-video text-white text-opacity-75 me-2 fs-10"></span>
              <span class="text-white text-opacity-75 fs-9 text-truncate">${cam || '—'}</span>
              ${ago ? `<span class="text-white text-opacity-50 mx-2">•</span><span class="text-white text-opacity-75 fs-9">${ago}</span>` : ''}
            </div>
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
    const res = await api.listEvents(state.range, 200, 0);
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

function populateCameraFilter(events) {
  const sel = document.getElementById('vision-events-filter-camera');
  if (!sel) return;
  const cameras = [...new Set(events.map(e => e.camera_id).filter(Boolean))].sort();
  const current = sel.value;
  sel.innerHTML = '<option value="">All cameras</option>' + cameras.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
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
    document.querySelectorAll('#vision-events-severity-tabs .nav-link').forEach(l => l.classList.remove('active'));
    document.querySelector('#vision-events-severity-tabs [data-severity="all"]')?.classList.add('active');
    loadEvents();
  });

  document.getElementById('vision-events-severity-tabs')?.addEventListener('click', e => {
    const link = e.target.closest('[data-severity]');
    if (!link) return;
    e.preventDefault();
    document.querySelectorAll('#vision-events-severity-tabs .nav-link').forEach(l => l.classList.remove('active'));
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
