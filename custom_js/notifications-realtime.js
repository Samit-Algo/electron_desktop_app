/**
 * Realtime Notifications Integration (Vision AI)
 * - Connects to backend notifications websocket via window.visionAPI.connectWebSocket
 * - Updates existing Phoenix topbar notification dropdown
 * - Updates dashboard "Latest Events" and Events Board when those pages are active
 * - Shows native notifications (best-effort) in Electron via Web Notification API
 */
(function () {
  'use strict';

  // Layout-loader reinjects and re-executes layout scripts on SPA navigation.
  // Guard to prevent multiple websocket connections / duplicated event listeners.
  if (window.__visionNotificationsRealtimeLoaded) return;
  window.__visionNotificationsRealtimeLoaded = true;

  const MAX_EVENTS = 100;
  const IMAGE_FETCH_TIMEOUT_MS = 8000;

  const state = {
    connected: false,
    connecting: false,
    ws: null,
    unread: 0,
    /** @type {Array<any>} */
    events: [],
    /** @type {Set<string>} */
    seenEventIds: new Set(),
    clearedDummyList: false,
    /** @type {Map<string, string>} */
    imageObjectUrlByEventId: new Map(),
    /** @type {Set<string>} */
    imageFetchInFlight: new Set(),
    /** @type {boolean} */
    eventsUiBound: false
  };

  function nowMs() { return Date.now(); }

  function safeJsonParse(v) {
    try { return JSON.parse(v); } catch { return null; }
  }

  function coerceIso(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return null;
    return d;
  }

  function timeAgo(ts) {
    const d = coerceIso(ts);
    if (!d) return '';
    const diff = Math.max(0, nowMs() - d.getTime());
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr}h`;
    const day = Math.floor(hr / 24);
    return `${day}d`;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // Very simple severity mapping until backend provides severity explicitly
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

  function normalizeEvent(payload) {
    const eventId = payload?.event_id || null;
    const sessionId = payload?.session_id || payload?.metadata?.session_id || null;
    const label = payload?.event?.label || 'Event';
    const timestamp = payload?.event?.timestamp || payload?.received_at || null;
    const cameraId = payload?.agent?.camera_id || payload?.agent?.cameraId || '';
    const agentName = payload?.agent?.agent_name || payload?.agent?.agentName || '';
    const imageBase64 = payload?.frame?.image_base64 || null; // optional (we usually send null)
    const format = payload?.frame?.format || 'jpeg';
    const sev = inferSeverity(label);

    const thumbDataUrl = imageBase64 ? `data:image/${format};base64,${imageBase64}` : null;

    return {
      eventId,
      sessionId,
      label,
      timestamp,
      cameraId,
      agentName,
      severity: sev,
      thumbDataUrl,
      /** @type {string|null} */
      thumbObjectUrl: null
    };
  }

  function getEventThumbUrl(ev) {
    return ev.thumbDataUrl || ev.thumbObjectUrl || null;
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...(options || {}), signal: controller.signal });
      return res;
    } finally {
      clearTimeout(t);
    }
  }

  async function ensureEventImageLoaded(ev) {
    if (!ev || getEventThumbUrl(ev)) return;
    if (!ev.eventId) return;
    if (!window.visionAPI || typeof window.visionAPI.fetchEventImageObjectUrl !== 'function') return;

    const key = String(ev.eventId);
    if (state.imageObjectUrlByEventId.has(key)) {
      ev.thumbObjectUrl = state.imageObjectUrlByEventId.get(key);
      return;
    }
    if (state.imageFetchInFlight.has(key)) return;
    state.imageFetchInFlight.add(key);

    try {
      const objUrl = await window.visionAPI.fetchEventImageObjectUrl(ev.eventId);
      state.imageObjectUrlByEventId.set(key, objUrl);
      ev.thumbObjectUrl = objUrl;
    } catch {
      // ignore image failures (event still shows)
    } finally {
      state.imageFetchInFlight.delete(key);
    }
  }

  function ensureNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      try { Notification.requestPermission().catch?.(() => {}); } catch {}
    }
  }

  function showNativeNotification(ev) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    const title = `${ev.severity}: ${ev.label}`;
    const body = `${ev.cameraId ? `Camera ${ev.cameraId}` : 'Camera'}${ev.agentName ? ` • ${ev.agentName}` : ''}`;
    try {
      const n = new Notification(title, { body, silent: false });
      n.onclick = () => {
        // Best effort: navigate to event details
        const url = buildEventDetailUrl(ev);
        try { window.location.href = url; } catch {}
      };
    } catch {}
  }

  function buildEventDetailUrl(ev) {
    const params = new URLSearchParams();
    if (ev.eventId) params.set('event_id', ev.eventId);
    return `../pages/event-detail.html?${params.toString()}`;
  }

  function updateTopbar() {
    const badge = document.getElementById('vision-notif-badge');
    if (badge) {
      badge.textContent = String(state.unread);
      if (state.unread > 0) badge.classList.remove('d-none');
      else badge.classList.add('d-none');
    }
  }

  function clearDummyNotificationsIfNeeded(listEl) {
    if (!listEl || state.clearedDummyList) return;
    // The shipped layout includes placeholder Phoenix demo notifications.
    // Once we receive first real event, we clear them and only show realtime.
    listEl.innerHTML = '';
    state.clearedDummyList = true;
  }

  function renderTopbarItem(ev) {
    const href = buildEventDetailUrl(ev);
    const ago = timeAgo(ev.timestamp);
    const title = escapeHtml(ev.label);
    const cam = escapeHtml(ev.cameraId || '');
    const sev = escapeHtml(ev.severity || 'Info');
    const badgeCls = severityBadgeClass(ev.severity);
    const timeLine = ev.timestamp ? escapeHtml(new Date(ev.timestamp).toLocaleString()) : '';
    const avatarLetter = escapeHtml((ev.label || 'E').trim().charAt(0).toUpperCase());

    // Keep structure close to existing Phoenix notification-card
    const wrapper = document.createElement('div');
    wrapper.className = 'px-2 px-sm-3 py-3 notification-card position-relative unread border-bottom';
    wrapper.innerHTML = `
      <div class="d-flex align-items-center justify-content-between position-relative">
        <div class="d-flex">
          <div class="avatar avatar-m status-online me-3">
            <div class="avatar-name rounded-circle"><span>${avatarLetter}</span></div>
          </div>
          <div class="flex-1 me-sm-3">
            <div class="d-flex align-items-center gap-2">
              <h4 class="fs-9 text-body-emphasis mb-0">${title}</h4>
              <span class="badge badge-phoenix fs-10 ${badgeCls}" data-bs-theme="light">${sev}</span>
            </div>
            <p class="fs-9 text-body-highlight mb-2 mb-sm-2 fw-normal">
              Event detected${cam ? ` • Camera ${cam}` : ''}${ago ? `<span class="ms-2 text-body-quaternary text-opacity-75 fw-bold fs-10">${ago}</span>` : ''}
            </p>
            ${timeLine ? `<p class="text-body-secondary fs-9 mb-0"><span class="me-1 fas fa-clock"></span>${timeLine}</p>` : ''}
          </div>
        </div>
      </div>
      <a class="stretched-link" href="${href}"></a>
    `;
    return wrapper;
  }

  function pushTopbar(ev) {
    const listEl = document.getElementById('vision-notif-list');
    if (!listEl) return;
    clearDummyNotificationsIfNeeded(listEl);
    const item = renderTopbarItem(ev);
    listEl.prepend(item);
  }

  function updateLatestEventsSection() {
    const container = document.getElementById('vision-latest-events');
    if (!container) return;

    // Replace contents with latest 4 events
    const latest = state.events.slice(0, 4);
    container.innerHTML = latest.map(ev => {
      const sev = ev.severity;
      const badgeCls = severityBadgeClass(sev);
      const ago = timeAgo(ev.timestamp);
      const cam = escapeHtml(ev.cameraId || '');
      const href = buildEventDetailUrl(ev);
      const thumb = getEventThumbUrl(ev);
      return `
        <div class="btn-reveal-trigger position-relative rounded-2 overflow-hidden p-3 flex-shrink-0" style="width: 280px; height: 170px;">
          ${thumb ? `<img src="${thumb}" alt="" class="w-100 h-100 position-absolute top-0 start-0" style="object-fit: cover;">` : `<div class="w-100 h-100 position-absolute top-0 start-0 bg-body-secondary"></div>`}
          <div class="w-100 h-100 position-absolute top-0 start-0" style="background: linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%);"></div>
          <div class="position-relative h-100 d-flex flex-column justify-content-between">
            <div class="d-flex justify-content-between align-items-center">
              <span class="badge badge-phoenix fs-10 ${badgeCls}" data-bs-theme="light">${escapeHtml(sev)}</span>
            </div>
            <div>
              <h4 class="text-white fw-bold line-clamp-2 mb-1">${escapeHtml(ev.label)}</h4>
              <p class="text-white text-opacity-75 fs-9 mb-0">${cam ? `Camera ${cam}` : 'Camera'}</p>
              <div class="d-flex align-items-center mt-2">
                <span class="fa-solid fa-video text-white text-opacity-75 me-2 fs-10"></span>
                <span class="text-white text-opacity-75 fs-9">${cam ? `Camera ${cam}` : 'Camera'}</span>
                <span class="text-white text-opacity-50 mx-2">•</span>
                <span class="text-white text-opacity-75 fs-9">${ago || ''}</span>
              </div>
            </div>
          </div>
          <a class="stretched-link" href="${href}"></a>
        </div>
      `;
    }).join('');
  }

  function renderEventsBoardFromState() {
    const grid = document.getElementById('vision-events-board-grid');
    if (!grid) return;
    const countEl = document.getElementById('vision-events-count');
    if (countEl) countEl.textContent = String(state.events.length);

    grid.innerHTML = state.events.map(ev => {
      const sev = ev.severity;
      const badgeCls = severityBadgeClass(sev);
      const ago = timeAgo(ev.timestamp);
      const cam = escapeHtml(ev.cameraId || '');
      const href = buildEventDetailUrl(ev);
      const thumb = getEventThumbUrl(ev);
      return `
        <div class="col-12 col-sm-6 col-md-4 col-xxl-3">
          <div class="btn-reveal-trigger position-relative rounded-2 overflow-hidden p-4" style="height: 236px;">
            ${thumb ? `<img src="${thumb}" alt="" class="w-100 h-100 position-absolute top-0 start-0" style="object-fit: cover;">` : `<div class="w-100 h-100 position-absolute top-0 start-0 bg-body-secondary"></div>`}
            <div class="w-100 h-100 position-absolute top-0 start-0" style="background: linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%);"></div>
            <div class="position-relative h-100 d-flex flex-column justify-content-between">
              <div class="d-flex justify-content-between align-items-center">
                <span class="badge badge-phoenix fs-10 ${badgeCls}" data-bs-theme="light">${escapeHtml(sev)}</span>
              </div>
              <div>
                <h3 class="text-white fw-bold line-clamp-2 mb-1">${escapeHtml(ev.label)}</h3>
                <p class="text-white text-opacity-75 fs-9 mb-0">${cam ? `Camera ${cam}` : 'Camera'}</p>
                <div class="d-flex align-items-center mt-2">
                  <span class="fa-solid fa-video text-white text-opacity-75 me-2 fs-10"></span>
                  <span class="text-white text-opacity-75 fs-9">${cam ? `Camera ${cam}` : 'Camera'}</span>
                  <span class="text-white text-opacity-50 mx-2">•</span>
                  <span class="text-white text-opacity-75 fs-9">${ago || ''}</span>
                </div>
              </div>
            </div>
            <a class="stretched-link" href="${href}"></a>
          </div>
        </div>
      `;
    }).join('');
  }

  async function refreshDashboardLatestFromApi() {
    const container = document.getElementById('vision-latest-events');
    if (!container) return;
    if (!window.visionAPI || typeof window.visionAPI.listEvents !== 'function') return;
    try {
      const res = await window.visionAPI.listEvents('today', 5, 0);
      const items = Array.isArray(res?.items) ? res.items : [];
      // Map to local event objects
      state.events = items.map(it => ({
        eventId: it.id,
        sessionId: it.session_id || null,
        label: it.label || 'Event',
        timestamp: it.event_ts || it.received_at || null,
        cameraId: it.camera_id || '',
        agentName: it.agent_name || '',
        severity: inferSeverity(it.label),
        thumbDataUrl: null,
        thumbObjectUrl: null
      }));
      // Load images async
      await Promise.all(state.events.map(e => ensureEventImageLoaded(e)));
      updateLatestEventsSection();
    } catch {}
  }

  async function refreshEventsBoardFromApi(range) {
    const grid = document.getElementById('vision-events-board-grid');
    if (!grid) return;
    if (!window.visionAPI || typeof window.visionAPI.listEvents !== 'function') return;
    try {
      const res = await window.visionAPI.listEvents(range || 'all', 200, 0);
      const items = Array.isArray(res?.items) ? res.items : [];
      const countEl = document.getElementById('vision-events-count');
      if (countEl) countEl.textContent = String(res?.total ?? items.length ?? 0);
      state.events = items.map(it => ({
        eventId: it.id,
        sessionId: it.session_id || null,
        label: it.label || 'Event',
        timestamp: it.event_ts || it.received_at || null,
        cameraId: it.camera_id || '',
        agentName: it.agent_name || '',
        severity: inferSeverity(it.label),
        thumbDataUrl: null,
        thumbObjectUrl: null
      }));
      await Promise.all(state.events.map(e => ensureEventImageLoaded(e)));
      renderEventsBoardFromState();
    } catch {}
  }

  function bindEventsBoardFilterOnce() {
    const sel = document.getElementById('vision-events-range');
    if (!sel) return;
    if (sel.getAttribute('data-vision-bound') === 'true') return;
    sel.setAttribute('data-vision-bound', 'true');
    sel.addEventListener('change', () => {
      refreshEventsBoardFromApi(sel.value);
    });
  }

  function markAllRead() {
    state.unread = 0;
    updateTopbar();
    // Remove unread class visually
    const listEl = document.getElementById('vision-notif-list');
    if (listEl) {
      listEl.querySelectorAll?.('.notification-card.unread')?.forEach(el => {
        el.classList.remove('unread');
        el.classList.add('read');
      });
    }
  }

  function handleEventNotification(payload) {
    const ev = normalizeEvent(payload);
    if (!ev.eventId) return;
    if (state.seenEventIds.has(ev.eventId)) return;
    state.seenEventIds.add(ev.eventId);

    state.events.unshift(ev);
    if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;

    state.unread += 1;
    updateTopbar();
    pushTopbar(ev);
    // Refresh UI from DB-backed APIs so navigation/reload is always correct
    refreshDashboardLatestFromApi();
    const sel = document.getElementById('vision-events-range');
    refreshEventsBoardFromApi(sel?.value || 'all');
    showNativeNotification(ev);

    window.dispatchEvent(new CustomEvent('vision:event-notification', { detail: ev }));
  }

  function onWsMessage(msg) {
    const payload = msg && typeof msg === 'object' ? msg : safeJsonParse(msg);
    if (!payload) return;
    if (payload.type === 'connection_established') return;
    if (payload.type === 'event_notification') {
      handleEventNotification(payload);
    }
  }

  function connectIfReady() {
    if (state.connected || state.connecting) return;
    if (!window.visionAPI || typeof window.visionAPI.isAuthenticated !== 'function') return;
    if (!window.visionAPI.isAuthenticated()) return;

    ensureNotificationPermission();

    state.connecting = true;
    try {
      state.ws = window.visionAPI.connectWebSocket(onWsMessage, () => {});
      state.connected = true;
    } catch (e) {
      // ignore; will retry on next authStateChanged
    } finally {
      state.connecting = false;
    }
  }

  function disconnect() {
    state.connected = false;
    state.connecting = false;
    try { state.ws?.close?.(); } catch {}
    state.ws = null;
    state.unread = 0;
    state.events = [];
    state.seenEventIds.clear();
    state.clearedDummyList = false;
    updateTopbar();
  }

  function initUiHandlers() {
    const markBtn = document.getElementById('vision-notif-mark-read');
    if (markBtn) markBtn.addEventListener('click', markAllRead);
  }

  // Init (SPA-safe): layout-loader may inject this script after DOMContentLoaded.
  // So we run once immediately and keep a small retry loop.
  function boot() {
    initUiHandlers();
    connectIfReady();
    updateTopbar();
    bindEventsBoardFilterOnce();
    refreshDashboardLatestFromApi();
    const sel = document.getElementById('vision-events-range');
    refreshEventsBoardFromApi(sel?.value || 'all');
  }

  boot();

  document.addEventListener('DOMContentLoaded', function () {
    boot();
  });

  window.addEventListener('authStateChanged', function (event) {
    if (event?.detail?.loggedIn) connectIfReady();
    else disconnect();
  });

  // SPA navigation hook (layout-loader dispatches this)
  window.addEventListener('vision:spa:navigated', function () {
    boot();
  });

  // Retry loop: ensures we connect even if auth/layout timing is odd.
  // Stops after connected.
  const retryTimer = setInterval(() => {
    if (state.connected) {
      clearInterval(retryTimer);
      return;
    }
    boot();
  }, 1500);

  // Expose for debugging
  window.__visionNotifications = {
    getState: () => ({ unread: state.unread, events: state.events.slice() }),
    markAllRead,
  };
})();

