import { navigate } from '../../core/router.js';
import { api } from '../../core/api.js';
'use strict';

const GRID_KEY = 'visionai.dashboard.liveCameraGrid.v1';
const STATS_POLL_MS = 120000;
let statsPollTimer = null;

const livePlayers = new Map();
let cameraData = [];

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
    const hasCamStatus = camList.some(c => c.status != null || c.is_online != null || c.live != null);
    let online = camList.filter(c => c.status === 'online' || c.is_online === true || c.live === true).length;
    if (!hasCamStatus && totalCams > 0) online = totalCams;
    const offline = hasCamStatus ? Math.max(0, totalCams - online) : 0;

    setText('vision-stat-cameras-total', String(totalCams));
    setText('vision-stat-cameras-online-badge', `${online} online`);
    setText('vision-stat-cameras-offline', `${offline} offline`);

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

async function ensureWsFmp4Player() {
  if (window.createWsFmp4Player) return;
  await loadScriptOnce('/app/utils/ws-fmp4-player.js');
}

function safeJsonParse(v) {
  try { return JSON.parse(v); } catch { return null; }
}

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
  tile.innerHTML = `
    <div class="grid-stack-item-content">
      <div class="card h-100 camera-tile" data-camera-id="${camera.id}" data-tile-id="${tileId}">
        <div class="card-header bg-body-emphasis p-2 d-flex justify-content-between align-items-center gap-2 camera-drag-surface">
          <div class="d-flex align-items-center gap-2 min-w-0 flex-grow-1">
            <span class="fa-solid fa-grip-vertical text-body-tertiary camera-drag-handle flex-shrink-0" title="Drag"></span>
            <span class="fa-solid fa-video text-primary fs-9 flex-shrink-0"></span>
            <span class="fw-semibold fs-9 camera-name" title="${displayName}">${displayName}</span>
          </div>
          <div class="d-flex align-items-center gap-2">
            <span class="badge badge-phoenix badge-phoenix-secondary fs-10 camera-status" id="status-${tileId}">Loading...</span>
          </div>
        </div>
        <div class="card-body p-0 position-relative camera-body">
          <video class="camera-video" id="video-${tileId}" autoplay muted playsinline></video>
          <div class="position-absolute top-50 start-50 translate-middle" id="loading-${tileId}">
            <div class="spinner-border text-light" role="status">
              <span class="visually-hidden">Loading stream...</span>
            </div>
          </div>
          <div class="position-absolute bottom-0 start-0 m-2">
            <span class="badge bg-dark bg-opacity-75 text-white fs-9 camera-overlay" id="overlay-${tileId}" style="display: none;">
              <span class="fa-solid fa-eye me-1"></span><span class="overlay-text">Live</span>
            </span>
          </div>
        </div>
      </div>
    </div>`;
  return tile;
}

async function initLivePlayer(camera, videoEl, tileId = null) {
  const streamId = tileId || camera.id;
  if (!window.createWsFmp4Player) { updateCameraStatus(streamId, 'error', 'Player missing'); return null; }
  if (!api || !api.isAuthenticated()) { updateCameraStatus(streamId, 'error', 'Not logged in'); return null; }

  const existing = livePlayers.get(streamId);
  if (existing && typeof existing.destroy === 'function') existing.destroy();

  updateCameraStatus(streamId, 'loading', 'Connecting...');
  let wsUrl = null;
  try { wsUrl = api.getLiveWsURL(camera.id); }
  catch (e) { updateCameraStatus(streamId, 'error', 'Auth Error'); hideLoading(streamId); return null; }

  const mimeCodec = api.getLiveMimeCodec();
  const player = window.createWsFmp4Player({
    videoEl, wsUrl, mimeCodec, bufferSeconds: 15,
    onState: (ev) => {
      if (!ev || !ev.state) return;
      if (ev.state === 'connecting') { updateCameraStatus(streamId, 'loading', 'Connecting...'); return; }
      if (ev.state === 'ws-open') { updateCameraStatus(streamId, 'loading', 'Starting...'); showOverlay(streamId, 'Live'); return; }
      if (ev.state === 'first-append') {
        hideLoading(streamId);
        updateCameraStatus(streamId, 'live', 'Live');
        try { if (videoEl && videoEl.paused) videoEl.play().catch(() => {}); } catch {}
        return;
      }
      if (ev.state === 'stalled') { updateCameraStatus(streamId, 'loading', 'Stalled...'); return; }
      if (ev.state === 'append-error' || ev.state === 'error') { updateCameraStatus(streamId, 'error', 'Stream Error'); hideLoading(streamId); return; }
    }
  });
  livePlayers.set(streamId, player);
  return player;
}

function updateCameraStatus(tileId, status, text) {
  const statusEl = document.getElementById(`status-${tileId}`);
  if (!statusEl) return;
  statusEl.className = 'badge badge-phoenix fs-10';
  if (status === 'live') statusEl.classList.add('badge-phoenix-success');
  else if (status === 'error' || status === 'offline') statusEl.classList.add('badge-phoenix-warning');
  else statusEl.classList.add('badge-phoenix-secondary');
  statusEl.textContent = text;
}

function hideLoading(tileId) {
  const el = document.getElementById(`loading-${tileId}`);
  if (el) el.style.display = 'none';
}

function showOverlay(tileId, text) {
  const el = document.getElementById(`overlay-${tileId}`);
  if (el) { const t = el.querySelector('.overlay-text'); if (t) t.textContent = text; el.style.display = 'block'; }
}

async function loadCameras() {
  if (!api || !api.isAuthenticated()) return;
  setCamerasLoading(true);
  try {
    const cameras = await api.listCameras();
    cameraData = cameras;
    const gridEl = document.getElementById('live-camera-grid');
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
    for (const camera of cameras) {
      const videoEl = document.getElementById(`video-${camera.id}`);
      if (videoEl) { const player = await initLivePlayer(camera, videoEl); if (player) livePlayers.set(camera.id, player); }
    }
    setCamerasLoading(false);
  } catch (error) {
    const gridEl = document.getElementById('live-camera-grid');
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
  grid.on('dragstop resizestop', () => { setTimeout(() => { isGridInteracting = false; }, 0); });

  gridEl.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    const body = e.target.closest?.('.camera-body');
    if (!body || isGridInteracting) return;
    const card = body.closest?.('.camera-tile');
    const camId = card?.getAttribute('data-camera-id');
    if (!camId) return;
    const href = `/app/pages/cameras/camera-detail.html?camera=${encodeURIComponent(camId)}`;
    navigate(href).catch?.(() => { window.location.href = href; });
  });

  function saveLayout() {
    const layout = grid.engine.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, w: n.w, h: n.h }));
    localStorage.setItem(GRID_KEY, JSON.stringify(layout));
  }

  const saved = safeJsonParse(localStorage.getItem(GRID_KEY));
  const defaultW = 3, defaultH = 4, cols = 4;
  if (cameraData.length > 0) {
    const savedById = new Map();
    if (Array.isArray(saved) && saved.length) saved.forEach(item => { if (item && item.id) savedById.set(item.id, item); });
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

  grid.on('change', saveLayout);

  const resetBtn = document.getElementById('reset-camera-layout');
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      localStorage.removeItem(GRID_KEY);
      const defaultLayout = cameraData.map((cam, idx) => ({
        id: cam.id, x: (idx % cols) * 3, y: Math.floor(idx / cols) * 4, w: 3, h: 4
      }));
      grid.load(defaultLayout);
    });
  }
  return true;
}

let latestEventsWidget = null;
function onEventNotification() { if (latestEventsWidget && latestEventsWidget.refresh) latestEventsWidget.refresh(); }

function mountLatestEventsWidget() {
  const container = document.getElementById('vision-latest-events');
  console.log('[Dashboard] mountLatestEventsWidget: container=', !!container, 'VisionEventsBoardWidget=', typeof window.VisionEventsBoardWidget);
  if (!container) return;
  if (latestEventsWidget) { try { latestEventsWidget.destroy(); } catch (e) {} latestEventsWidget = null; }
  if (typeof window.VisionEventsBoardWidget !== 'undefined' && window.VisionEventsBoardWidget.mount) {
    latestEventsWidget = window.VisionEventsBoardWidget.mount(container, {
      dateRange: 'all', maxItems: 5, compact: true, showFilters: false, showHeader: false, layout: 'horizontal'
    });
    window.addEventListener('vision:event-notification', onEventNotification);
    console.log('[Dashboard] events widget mounted successfully');
    setEventsLoading(false);
  } else {
    console.error('[Dashboard] VisionEventsBoardWidget not available!');
    setEventsLoading(false);
  }
}

function stopCameraStreams() {
  stopDashboardStatsPolling();
  livePlayers.forEach(player => { if (player && typeof player.destroy === 'function') player.destroy(); });
  livePlayers.clear();
}

function cleanupPlayers() {
  stopCameraStreams();
  window.removeEventListener('vision:event-notification', onEventNotification);
  if (latestEventsWidget && latestEventsWidget.destroy) { try { latestEventsWidget.destroy(); } catch (e) {} latestEventsWidget = null; }
}

window.addEventListener('beforeunload', cleanupPlayers);

export async function boot() {
  if (!document.getElementById('live-camera-grid')) return;

  stopDashboardStatsPolling();
  cleanupPlayers();
  setStatsLoading(true);
  setEventsLoading(true);
  setCamerasLoading(true);

  // Re-register cleanup so the router can call it on next navigation away
  window.__visionaiPageCleanup = cleanupPlayers;

  // Mount events widget immediately (same as old code) — widget has its own auth check
  mountLatestEventsWidget();

  await ensureGridStack();
  await ensureWsFmp4Player();

  // Wait for API auth to be ready
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
      const gridEl = document.getElementById('live-camera-grid');
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
    stopCameraStreams();
    setStatsLoading(false);
    setCamerasLoading(false);
    setEventsLoading(false);
    const gridEl = document.getElementById('live-camera-grid');
    if (gridEl) gridEl.innerHTML = '<div class="d-flex justify-content-center align-items-center p-5"><p class="text-body-tertiary">Please login to view cameras</p></div>';
  }
});
