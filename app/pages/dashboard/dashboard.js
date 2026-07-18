import { navigate } from '../../core/router.js';
import { api } from '../../core/api.js';
'use strict';

const GRID_KEY = 'visionai.dashboard.liveCameraGrid.v1';
const STATS_POLL_MS = 120000;
// Snapshot refresh interval — matches backend health-check cadence
const SNAPSHOT_POLL_MS = 60000;

let statsPollTimer = null;
let snapshotPollTimer = null;
let cameraData = [];

// ── Loading state helpers ─────────────────────────────────────────────────────

function setStatsLoading(isLoading) {
  const el = document.getElementById('vision-dashboard-stats');
  if (el) el.setAttribute('data-loading', isLoading ? 'true' : 'false');
}

function setEventsLoading(isLoading) {
  const el = document.getElementById('vision-latest-events');
  if (el) el.setAttribute('data-loading', isLoading ? 'true' : 'false');
}

function setCamerasLoading(isLoading) {
  const el = document.getElementById('live-camera-grid');
  if (el) el.setAttribute('data-loading', isLoading ? 'true' : 'false');
}

// ── Event severity helpers ────────────────────────────────────────────────────

function inferSeverityFromLabel(label) {
  const t = String(label || '').toLowerCase();
  if (t.includes('weapon') || t.includes('fire') || t.includes('fall') || t.includes('intrusion')) return 'Critical';
  if (t.includes('violation') || t.includes('restricted') || t.includes('collision') || t.includes('alert')) return 'Warning';
  return 'Info';
}

function eventSeverity(it) {
  const s = String(it.severity || '').toLowerCase();
  if (s === 'critical') return 'Critical';
  if (s === 'warning') return 'Warning';
  if (s === 'info') return 'Info';
  return inferSeverityFromLabel(it.label);
}

// ── Stats polling ─────────────────────────────────────────────────────────────

function stopDashboardStatsPolling() {
  if (statsPollTimer) { clearInterval(statsPollTimer); statsPollTimer = null; }
}

function startDashboardStatsPolling() {
  stopDashboardStatsPolling();
  refreshDashboardStats();
  statsPollTimer = setInterval(refreshDashboardStats, STATS_POLL_MS);
}

async function refreshDashboardStats() {
  if (!api || typeof api.isAuthenticated !== 'function' || !api.isAuthenticated()) return;

  const setText = (id, s) => { const el = document.getElementById(id); if (el) el.textContent = s; };

  try {
    const agentsPromise = typeof api.request === 'function'
      ? api.request('/api/v1/agents').catch(() => [])
      : Promise.resolve([]);

    const EVENT_LIMIT = 200;
    const weekEnd = new Date();
    const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
    const weekRange = { startTs: weekStart.toISOString(), endTs: weekEnd.toISOString() };

    const [cameras, agentsRes, todayRes, weekRes] = await Promise.all([
      api.listCameras().catch(() => []),
      agentsPromise,
      api.listEvents('today', EVENT_LIMIT, 0).catch(() => ({ total: 0, items: [] })),
      api.listEvents('all', EVENT_LIMIT, 0, null, weekRange).catch(() => ({ total: 0, items: [] }))
    ]);

    const camList = Array.isArray(cameras) ? cameras : [];
    const totalCams = camList.length;
    const online = camList.filter(c => c.status === 'live').length;
    const offline = camList.filter(c => String(c.status || '').toLowerCase() === 'offline').length;
    const reconnecting = camList.filter(c => {
      const s = String(c.status || '').toLowerCase();
      return s === 'reconnecting' || s === 'error';
    }).length;

    setText('vision-stat-cameras-total', String(totalCams));
    setText('vision-stat-cameras-online-badge', `${online} online`);
    setText('vision-stat-cameras-offline', reconnecting > 0 ? `${offline} offline • ${reconnecting} reconnecting` : `${offline} offline`);

    const agents = Array.isArray(agentsRes) ? agentsRes : [];
    const mon = agents.filter(a => String(a.status || '').toLowerCase() === 'monitoring').length;
    const others = Math.max(0, agents.length - mon);
    setText('vision-stat-agents-monitoring', String(mon));
    setText('vision-stat-agents-total-badge', `${agents.length} total`);
    setText('vision-stat-agents-sub', others === 0 ? 'All monitoring' : others === 1 ? '1 other status' : `${others} other statuses`);

    const todayItems = Array.isArray(todayRes && todayRes.items) ? todayRes.items : [];
    const todayTotal = typeof todayRes.total === 'number' && !Number.isNaN(todayRes.total) ? todayRes.total : todayItems.length;
    let crit = 0; let warn = 0;
    for (const it of todayItems) {
      const sev = eventSeverity(it);
      if (sev === 'Critical') crit++;
      else if (sev === 'Warning') warn++;
    }
    setText('vision-stat-incidents-total', String(todayTotal));
    setText('vision-stat-incidents-critical', crit > 0 ? `${crit} critical` : 'No critical');
    const warnLine = todayItems.length < todayTotal
      ? `${warn} warnings · severity from latest ${todayItems.length} rows`
      : `${warn} warnings`;
    setText('vision-stat-incidents-warning', warnLine);

    const weekItems = Array.isArray(weekRes && weekRes.items) ? weekRes.items : [];
    const weekTotal = typeof weekRes.total === 'number' && !Number.isNaN(weekRes.total) ? weekRes.total : weekItems.length;
    setText('vision-stat-events-week', String(weekTotal));
    setText('vision-stat-events-today-badge', `${todayTotal} today`);
    setStatsLoading(false);
  } catch (e) {
    console.warn('[dashboard stats]', e);
    setStatsLoading(false);
  }
}

// ── Script/CSS loaders ────────────────────────────────────────────────────────

function loadCssOnce(href) {
  if ([...document.styleSheets].some(s => s.href === href)) return;
  if (document.querySelector(`link[data-gridstack="true"][href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  link.setAttribute('data-gridstack', 'true');
  document.head.appendChild(link);
}

function loadScriptOnce(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-gridstack="true"][src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.defer = true;
    s.onload = resolve;
    s.onerror = reject;
    s.setAttribute('data-gridstack', 'true');
    document.head.appendChild(s);
  });
}

async function ensureGridStack() {
  if (window.GridStack) return;
  loadCssOnce('/vendors/gridstack/gridstack.min.css');
  await loadScriptOnce('/vendors/gridstack/gridstack-all.js');
}

function safeJsonParse(v) {
  try { return JSON.parse(v); } catch { return null; }
}

// ── Status badge ──────────────────────────────────────────────────────────────

/**
 * Update the status badge on a camera tile.
 *
 * States:
 *   'live-preview' – camera reachable, snapshot loaded → green blinking dot + "Live Preview"
 *   'offline'      – camera unreachable                → red  + "Offline"
 *   'reconnecting' – temporary unreachable             → amber + "Reconnecting"
 *   'loading'      – waiting for first preview fetch   → grey + "Loading…"
 *   'unknown'      – no status info                    → grey + "Unknown"
 */
function updateCameraStatus(tileId, state) {
  const el = document.getElementById(`status-${tileId}`);
  if (!el) return;
  el.className = 'badge badge-phoenix fs-10';
  el.title = '';

  switch (state) {
    case 'live-preview':
      el.classList.add('badge-phoenix-success');
      el.innerHTML = '<span class="dashboard-live-dot me-1"></span>Live Preview';
      break;
    case 'offline':
      el.classList.add('badge-phoenix-danger');
      el.textContent = 'Offline';
      break;
    case 'reconnecting':
      el.classList.add('badge-phoenix-warning');
      el.textContent = 'Reconnecting';
      break;
    default:
      el.classList.add('badge-phoenix-secondary');
      el.textContent = state === 'loading' ? 'Loading…' : 'Unknown';
  }
}

// ── Tile HTML ─────────────────────────────────────────────────────────────────

function createCameraTile(camera, index) {
  const tile = document.createElement('div');
  tile.className = 'grid-stack-item';
  const tileId = camera.id;
  tile.setAttribute('gs-id', tileId);
  const cols = 4;
  tile.setAttribute('gs-x', (index % cols) * 3);
  tile.setAttribute('gs-y', Math.floor(index / cols) * 4);
  tile.setAttribute('gs-w', '3');
  tile.setAttribute('gs-h', '4');
  const displayName = camera.name || 'Camera';

  const initialStatus = String(camera.status || '').toLowerCase();
  const isOfflineLike = initialStatus === 'offline' || initialStatus === 'reconnecting' || initialStatus === 'error';
  const placeholderHidden = isOfflineLike ? '' : ' is-hidden';
  const placeholderText = initialStatus === 'offline'
    ? 'Camera offline'
    : (initialStatus === 'reconnecting' || initialStatus === 'error')
      ? 'Reconnecting…'
      : '';

  tile.innerHTML = `
    <div class="grid-stack-item-content">
      <div class="card h-100 camera-tile" data-camera-id="${camera.id}" data-tile-id="${tileId}" style="cursor:pointer;">
        <div class="card-header bg-body-emphasis p-2 d-flex justify-content-between align-items-center gap-2 camera-drag-surface">
          <div class="d-flex align-items-center gap-2 min-w-0 flex-grow-1">
            <span class="fa-solid fa-grip-vertical text-body-tertiary camera-drag-handle flex-shrink-0" title="Drag"></span>
            <span class="fa-solid fa-video text-primary fs-9 flex-shrink-0"></span>
            <span class="fw-semibold fs-9 camera-name text-truncate" title="${displayName}">${displayName}</span>
          </div>
          <div class="d-flex align-items-center gap-2 flex-shrink-0">
            <span class="badge badge-phoenix badge-phoenix-secondary fs-10" id="status-${tileId}">Loading…</span>
          </div>
        </div>
        <div class="card-body p-0 position-relative camera-body overflow-hidden" style="background:#111;">

          <!-- Snapshot preview image (fills tile like an event card) -->
          <img
            id="snapshot-${tileId}"
            class="position-absolute top-0 start-0 w-100 h-100"
            style="object-fit:contain;object-position:center center;display:none;"
            alt=""
          />

          <!-- Placeholder shown only when camera is offline / reconnecting.
               Uses local .camera-placeholder (no !important) so JS can toggle .is-hidden. -->
          <div
            id="placeholder-${tileId}"
            class="position-absolute top-0 start-0 w-100 h-100 camera-placeholder${placeholderHidden}"
            style="color:#555;"
          >
            <span class="fa-solid fa-video-slash" style="font-size:1.6rem;"></span>
            <span class="fs-10 text-center px-3" id="placeholder-text-${tileId}">${placeholderText}</span>
          </div>

          <!-- Dark gradient overlay so badge is always readable over the image -->
          <div
            class="position-absolute top-0 start-0 w-100 h-100 pointer-events-none"
            style="background:linear-gradient(180deg,rgba(0,0,0,0.35) 0%,rgba(0,0,0,0) 40%,rgba(0,0,0,0) 60%,rgba(0,0,0,0.55) 100%);display:none;"
            id="gradient-${tileId}"
          ></div>

          <!-- Bottom-left: snapshot timestamp -->
          <div class="position-absolute bottom-0 start-0 m-2" id="ts-badge-${tileId}" style="display:none;">
            <span class="badge bg-dark bg-opacity-75 text-white fs-10" id="ts-text-${tileId}"></span>
          </div>

        </div>
      </div>
    </div>`;
  return tile;
}

// ── Snapshot / preview polling ────────────────────────────────────────────────

/**
 * Format a snapshot ISO timestamp into a human-friendly "time ago" string.
 * Uses full, easy-to-read words and rolls up into days/weeks/months/years
 * once the gap grows beyond an hour. e.g. "just now", "5 mins ago",
 * "2 hours ago", "3 days ago".
 */
function formatSnapshotAge(isoTs) {
  if (!isoTs) return '';
  try {
    const diffMs = Date.now() - new Date(isoTs).getTime();
    const secs = Math.floor(diffMs / 1000);
    if (secs < 60) return 'just now';
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins} ${mins === 1 ? 'min' : 'mins'} ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    if (days < 30) {
      const weeks = Math.floor(days / 7);
      return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
    }
    if (days < 365) {
      const months = Math.floor(days / 30);
      return `${months} ${months === 1 ? 'month' : 'months'} ago`;
    }
    const years = Math.floor(days / 365);
    return `${years} ${years === 1 ? 'year' : 'years'} ago`;
  } catch {
    return '';
  }
}

function resolveCameraStatus(previewStatus, backendStatus) {
  const normalize = (s) => {
    const v = String(s || '').toLowerCase();
    if (v === 'error') return 'reconnecting';
    return v;
  };
  const p = normalize(previewStatus);
  const b = normalize(backendStatus);

  // Backend camera health should win for hard states.
  if (b === 'offline' || b === 'reconnecting') return b;
  if (p === 'offline' || p === 'reconnecting') return p;
  if (p === 'live' || b === 'live') return 'live';
  return p || b || 'unknown';
}

async function refreshCameraPreview(camera) {
  const id = camera.id;
  try {
    const preview = await api.getCameraPreview(id);
    const status = resolveCameraStatus(preview?.status, camera?.status);

    const snapshotEl  = document.getElementById(`snapshot-${id}`);
    const placeholder = document.getElementById(`placeholder-${id}`);
    const placeholderText = document.getElementById(`placeholder-text-${id}`);
    const gradientEl  = document.getElementById(`gradient-${id}`);
    const tsBadge     = document.getElementById(`ts-badge-${id}`);
    const tsText      = document.getElementById(`ts-text-${id}`);

    if (preview.frame_base64) {
      // Show the snapshot image
      if (snapshotEl) {
        snapshotEl.src = `data:image/jpeg;base64,${preview.frame_base64}`;
        snapshotEl.style.display = '';
      }
      if (placeholder) placeholder.classList.add('is-hidden');
      if (gradientEl)  gradientEl.style.display = '';

      // Timestamp badge
      const age = formatSnapshotAge(preview.timestamp);
      if (tsBadge) tsBadge.style.display = '';
      if (tsText)  tsText.textContent = age ? `Updated ${age}` : 'Preview';

      updateCameraStatus(
        id,
        status === 'live'
          ? 'live-preview'
          : status === 'offline'
            ? 'offline'
            : status === 'reconnecting'
              ? 'reconnecting'
              : 'unknown'
      );
    } else {
      // No frame — only show placeholder for offline/reconnecting cameras.
      // A live camera without a frame yet should stay clean (no icon/text).
      if (snapshotEl)  snapshotEl.style.display = 'none';
      if (gradientEl)  gradientEl.style.display = 'none';
      if (tsBadge)     tsBadge.style.display = 'none';

      const isLive = status === 'live';
      if (placeholder) placeholder.classList.toggle('is-hidden', isLive);

      if (!isLive && placeholderText) {
        placeholderText.textContent =
          (status === 'offline' ? 'Camera offline'
          : status === 'reconnecting' ? 'Reconnecting…'
          : 'No preview available');
      }

      updateCameraStatus(
        id,
        status === 'live' ? 'live-preview'
        : status === 'offline' ? 'offline'
        : status === 'reconnecting' ? 'reconnecting'
        : 'unknown'
      );
    }
  } catch (err) {
    console.warn(`[Dashboard] preview fetch failed for camera ${id}:`, err);
    updateCameraStatus(id, 'unknown');
  }
}

async function refreshAllPreviews() {
  if (!api || !api.isAuthenticated()) return;

  // Keep dashboard tile status aligned with backend camera health, not only preview endpoint.
  try {
    const latest = await api.listCameras();
    if (Array.isArray(latest) && latest.length > 0) {
      const byId = new Map(latest.map(c => [String(c.id), c]));
      cameraData = cameraData.map(cam => {
        const fresh = byId.get(String(cam.id));
        return fresh ? { ...cam, ...fresh } : cam;
      });
    }
  } catch {}

  await Promise.allSettled(cameraData.map(cam => refreshCameraPreview(cam)));
}

function stopSnapshotPolling() {
  if (snapshotPollTimer) { clearInterval(snapshotPollTimer); snapshotPollTimer = null; }
}

function startSnapshotPolling() {
  stopSnapshotPolling();
  snapshotPollTimer = setInterval(refreshAllPreviews, SNAPSHOT_POLL_MS);
}

// ── Camera grid ───────────────────────────────────────────────────────────────

async function loadCameras() {
  if (!api || !api.isAuthenticated()) return;
  setCamerasLoading(true);
  try {
    const cameras = await api.listCameras();
    cameraData = cameras;
    const gridEl   = document.getElementById('live-camera-grid');
    const loadingEl = document.getElementById('camera-loading');
    if (loadingEl) loadingEl.remove();

    if (!cameras || cameras.length === 0) {
      gridEl.innerHTML = '<div class="d-flex justify-content-center align-items-center p-5"><p class="text-body-tertiary">No cameras found</p></div>';
      setCamerasLoading(false);
      return;
    }

    gridEl.innerHTML = '';
    gridEl.dataset.gridstackInited = 'false';
    if (window.GridStack && gridEl.gridstack) gridEl.gridstack.destroy(false);

    cameras.forEach((camera, index) => { gridEl.appendChild(createCameraTile(camera, index)); });
    initCameraGrid();

    // Fetch previews immediately, then start polling
    await refreshAllPreviews();
    startSnapshotPolling();

    setCamerasLoading(false);
  } catch (error) {
    const gridEl   = document.getElementById('live-camera-grid');
    const loadingEl = document.getElementById('camera-loading');
    if (loadingEl) loadingEl.remove();
    gridEl.innerHTML = `<div class="d-flex justify-content-center align-items-center p-5"><p class="text-danger">Error loading cameras: ${error.message}</p></div>`;
    setCamerasLoading(false);
  }
}

function initCameraGrid() {
  const gridEl = document.getElementById('live-camera-grid');
  if (!gridEl || !window.GridStack) return false;
  if (gridEl.dataset.gridstackInited === 'true') return true;
  gridEl.dataset.gridstackInited = 'true';

  const grid = GridStack.init({
    column: 12, cellHeight: 80, margin: 8, animate: true,
    draggable: { handle: '.camera-drag-surface' },
    resizable: { handles: 'all' }
  }, gridEl);

  let isGridInteracting = false;
  grid.on('dragstart resizestart', () => { isGridInteracting = true; });
  grid.on('dragstop resizestop',   () => { setTimeout(() => { isGridInteracting = false; }, 0); });

  // Single click → navigate directly to camera detail page
  gridEl.addEventListener('click', (e) => {
    if (isGridInteracting) return;
    if (e.target.closest('button')) return;
    if (e.target.closest('.ui-resizable-handle')) return;
    if (e.target.closest('.camera-drag-surface') || e.target.closest('.camera-drag-handle')) return;
    const card  = e.target.closest?.('.camera-tile');
    const camId = card?.getAttribute('data-camera-id');
    if (!camId) return;
    const href = `/app/pages/cameras/camera-detail.html?camera=${encodeURIComponent(camId)}`;
    navigate(href).catch?.(() => { window.location.href = href; });
  });

  const saved    = safeJsonParse(localStorage.getItem(GRID_KEY));
  const defaultW = 3, defaultH = 4, cols = 4;

  if (cameraData.length > 0) {
    const savedById = new Map();
    if (Array.isArray(saved) && saved.length) {
      saved.forEach(item => { if (item && item.id) savedById.set(item.id, item); });
    }
    let maxY = -1;
    const fullLayout = cameraData.map(cam => {
      const existing = savedById.get(cam.id);
      if (existing && typeof existing.x === 'number' && typeof existing.y === 'number') {
        const bottom = (existing.y || 0) + (existing.h || defaultH);
        if (bottom > maxY) maxY = bottom;
        return { id: cam.id, x: existing.x, y: existing.y, w: existing.w ?? defaultW, h: existing.h ?? defaultH };
      }
      return { id: cam.id, x: 0, y: 0, w: defaultW, h: defaultH };
    });
    let newIdx = 0;
    fullLayout.forEach((item, i) => {
      if (!savedById.has(cameraData[i].id)) {
        const startY = maxY < 0 ? 0 : maxY;
        item.x = (newIdx % cols) * 3;
        item.y = startY + Math.floor(newIdx / cols) * defaultH;
        item.w = defaultW; item.h = defaultH;
        newIdx++;
      }
    });
    grid.load(fullLayout);
  }

  function saveLayout() {
    const layout = grid.engine.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
    localStorage.setItem(GRID_KEY, JSON.stringify(layout));
  }
  grid.on('change', saveLayout);

  const resetBtn = document.getElementById('reset-camera-layout');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      localStorage.removeItem(GRID_KEY);
      const defaultLayout = cameraData.map((cam, idx) => ({
        id: cam.id, x: (idx % cols) * 3, y: Math.floor(idx / cols) * 4, w: 3, h: 4
      }));
      grid.load(defaultLayout);
    });
  }
  return true;
}

// ── Events widget ─────────────────────────────────────────────────────────────

let latestEventsWidget = null;
function onEventNotification() { if (latestEventsWidget && latestEventsWidget.refresh) latestEventsWidget.refresh(); }

function mountLatestEventsWidget() {
  const container = document.getElementById('vision-latest-events');
  if (!container) return;
  if (latestEventsWidget) { try { latestEventsWidget.destroy(); } catch {} latestEventsWidget = null; }
  if (typeof window.VisionEventsBoardWidget !== 'undefined' && window.VisionEventsBoardWidget.mount) {
    latestEventsWidget = window.VisionEventsBoardWidget.mount(container, {
      dateRange: 'all', maxItems: 5, compact: true, showFilters: false, showHeader: false, layout: 'horizontal'
    });
    window.addEventListener('vision:event-notification', onEventNotification);
    setEventsLoading(false);
  } else {
    setEventsLoading(false);
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

function cleanup() {
  stopDashboardStatsPolling();
  stopSnapshotPolling();
  window.removeEventListener('vision:event-notification', onEventNotification);
  if (latestEventsWidget && latestEventsWidget.destroy) {
    try { latestEventsWidget.destroy(); } catch {}
    latestEventsWidget = null;
  }
}

window.addEventListener('beforeunload', cleanup);

// ── Boot ──────────────────────────────────────────────────────────────────────

export async function boot() {
  if (!document.getElementById('live-camera-grid')) return;

  stopDashboardStatsPolling();
  cleanup();
  setStatsLoading(true);
  setEventsLoading(true);
  setCamerasLoading(true);

  window.__visionaiPageCleanup = cleanup;

  mountLatestEventsWidget();

  await ensureGridStack();

  let tries = 0;
  const maxTries = 50;
  (function checkAuth() {
    if (!document.getElementById('live-camera-grid')) return;
    if (api && api.isAuthenticated()) {
      loadCameras();
      startDashboardStatsPolling();
    } else if (++tries < maxTries) {
      setTimeout(checkAuth, 100);
    } else {
      const gridEl   = document.getElementById('live-camera-grid');
      const loadingEl = document.getElementById('camera-loading');
      if (loadingEl) loadingEl.remove();
      if (gridEl) gridEl.innerHTML = '<div class="d-flex justify-content-center align-items-center p-5"><p class="text-body-tertiary">Please login to view cameras</p></div>';
      setCamerasLoading(false);
      setStatsLoading(false);
      setEventsLoading(false);
    }
  })();
}

window.addEventListener('authStateChanged', (event) => {
  if (!document.getElementById('live-camera-grid')) return;
  if (event.detail.loggedIn) {
    setStatsLoading(true);
    setCamerasLoading(true);
    loadCameras();
    startDashboardStatsPolling();
  } else {
    cleanup();
    setStatsLoading(false);
    setCamerasLoading(false);
    setEventsLoading(false);
    const gridEl = document.getElementById('live-camera-grid');
    if (gridEl) gridEl.innerHTML = '<div class="d-flex justify-content-center align-items-center p-5"><p class="text-body-tertiary">Please login to view cameras</p></div>';
  }
});
