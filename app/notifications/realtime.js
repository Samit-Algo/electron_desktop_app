import { toast } from '../core/toast.js';
import { api } from '../core/api.js';
/**
 * Realtime Notifications Integration (Vision AI)
 * - Connects to backend notifications websocket via api.connectWebSocket
 * - Handles all backend notification types: event, camera_offline, report_ready
 * - Uses VisionNotificationDisplay for unified normalization and rendering
 * - Updates topbar dropdown, dashboard Latest Events, Events Board
 * - Shows native notifications (best-effort) in Electron via Web Notification API
 */
(function () {
  'use strict';

  // Layout-loader reinjects and re-executes layout scripts on SPA navigation.
  if (window.__visionNotificationsRealtimeLoaded) return;
  window.__visionNotificationsRealtimeLoaded = true;

  var Display = window.VisionNotificationDisplay;
  if (!Display) {
    console.warn('[VisionNotifications] VisionNotificationDisplay not loaded');
    return;
  }

  var MAX_EVENTS = 100;
  var NOTIFICATION_TYPE = Display.NOTIFICATION_TYPE;

  var state = {
    connected: false,
    connecting: false,
    ws: null,
    unread: 0,
    /** @type {Array<any>} */
    events: [],
    /** @type {Set<string>} */
    seenIds: new Set(),
    clearedDummyList: false,
    /** @type {Map<string, string>} */
    imageObjectUrlByEventId: new Map(),
    /** @type {Set<string>} */
    imageFetchInFlight: new Set(),
    eventsUiBound: false,
    /** User preference: show OS popup notifications (default true) */
    osPopupEnabled: true,
  };

  function safeJsonParse(v) {
    try { return JSON.parse(v); } catch { return null; }
  }

  function getEventThumbUrl(ev) {
    return ev.thumbDataUrl || ev.thumbObjectUrl || null;
  }

  async function ensureEventImageLoaded(ev) {
    if (!ev || ev.notificationType !== NOTIFICATION_TYPE.EVENT) return;
    if (getEventThumbUrl(ev)) return;
    if (!ev.eventId) return;
    if (!api || typeof api.fetchEventImageObjectUrl !== 'function') return;

    var key = String(ev.eventId);
    if (state.imageObjectUrlByEventId.has(key)) {
      ev.thumbObjectUrl = state.imageObjectUrlByEventId.get(key);
      return;
    }
    if (state.imageFetchInFlight.has(key)) return;
    state.imageFetchInFlight.add(key);

    try {
      var objUrl = await api.fetchEventImageObjectUrl(ev.eventId);
      state.imageObjectUrlByEventId.set(key, objUrl);
      ev.thumbObjectUrl = objUrl;
    } catch {
      // ignore
    } finally {
      state.imageFetchInFlight.delete(key);
    }
  }

  var lastNativeNotificationTime = 0;
  var NATIVE_NOTIF_RATE_LIMIT_MS = 1500;

  function ensureNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
      try { Notification.requestPermission().then(function() {}).catch(function() {}); } catch {}
    }
  }

  /** Request permission on user gesture (required by browsers). Call when user clicks bell. */
  function requestNotificationPermissionOnUserGesture() {
    console.log('[VisionNotifications] requestPermission: Notification in window=', 'Notification' in window);
    if (!('Notification' in window)) {
      console.warn('[VisionNotifications] Notification API not available');
      return;
    }
    console.log('[VisionNotifications] requestPermission: current permission=', Notification.permission);
    if (Notification.permission !== 'default') {
      console.log('[VisionNotifications] Permission already', Notification.permission);
      return;
    }
    try {
      console.log('[VisionNotifications] Calling Notification.requestPermission()');
      Notification.requestPermission().then(function(perm) {
        console.log('[VisionNotifications] requestPermission result:', perm);
        if (perm === 'granted') {
          var toast = toast || toast;
          if (toast && typeof toast.success === 'function') {
            try { toast.success('Desktop notifications enabled'); } catch {}
          }
          window.dispatchEvent(new CustomEvent('vision:notification-permission-changed', { detail: { permission: perm } }));
        }
      }).catch(function(err) {
        console.warn('[VisionNotifications] requestPermission error:', err);
      });
    } catch (e) {
      console.warn('[VisionNotifications] requestPermission exception:', e);
    }
  }

  function getNotificationIconUrl() {
    try {
      var link = document.querySelector('link[rel="icon"]');
      if (link && link.href) return link.href;
      return new URL('../assets/img/favicons/favicon-32x32.png', window.location.href).href;
    } catch (e) { return ''; }
  }

  function showNativeNotification(n) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!state.osPopupEnabled) return;  // User disabled OS popups in settings

    var now = Date.now();
    if (now - lastNativeNotificationTime < NATIVE_NOTIF_RATE_LIMIT_MS) return;
    lastNativeNotificationTime = now;

    var title = n.severity + ': ' + n.title;
    var body = n.cameraId ? 'Camera ' + n.cameraId : (n.body || '');
    if (!body && n.notificationType === Display.NOTIFICATION_TYPE.REPORT_READY) body = n.body || 'Report ready';
    var silent = n.severity === 'Info';
    var icon = getNotificationIconUrl();
    var opts = { body: body, silent: silent };
    if (icon) opts.icon = icon;

    try {
      var nat = new Notification(title, opts);
      nat.onclick = function() {
        try { window.focus(); } catch {}
        var url = Display.getNotificationHref(n);
        try { if (url && url !== '#') window.location.href = url; } catch {}
      };
    } catch (e) {
      console.warn('[VisionNotifications] OS notification failed:', e);
    }
  }

  function updateTopbar() {
    var badge = document.getElementById('vision-notif-badge');
    if (badge) {
      badge.textContent = String(state.unread);
      if (state.unread > 0) badge.classList.remove('d-none');
      else badge.classList.add('d-none');
    }
    if (window.electronAPI && typeof window.electronAPI.setBadgeCount === 'function') {
      try { window.electronAPI.setBadgeCount(state.unread); } catch (e) {}
    }
  }

  function clearDummyNotificationsIfNeeded(listEl) {
    if (!listEl || state.clearedDummyList) return;
    listEl.innerHTML = '';
    state.clearedDummyList = true;
  }

  function updateTopbarThumb(n) {
    if (!n || n.notificationType !== NOTIFICATION_TYPE.EVENT || !n.eventId) return;
    var listEl = document.getElementById('vision-notif-list');
    if (!listEl) return;
    var key = String(n.eventId);
    var card = listEl.querySelector('.notification-card[data-vision-notif-id="' + CSS.escape(key) + '"]');
    if (!card) return;
    var thumb = getEventThumbUrl(n);
    if (!thumb) return;
    var img = card.querySelector('img[data-vision-notif-thumb="' + CSS.escape(key) + '"]');
    var fb = card.querySelector('[data-vision-notif-thumb-fallback="' + CSS.escape(key) + '"]');
    try {
      if (img) { img.src = thumb; img.style.display = 'block'; }
      if (fb) fb.style.display = 'none';
    } catch {}
  }

  function pushTopbar(n) {
    var listEl = document.getElementById('vision-notif-list');
    if (!listEl) return;
    clearDummyNotificationsIfNeeded(listEl);
    var item = Display.renderTopbarCard(n);
    listEl.prepend(item);
  }

  function updateLatestEventsSection() {
    var container = document.getElementById('vision-latest-events');
    if (!container) return;
    var latest = state.events.slice(0, 4);
    container.innerHTML = latest.map(function(n) {
      var thumb = getEventThumbUrl(n);
      return '<div class="flex-shrink-0" style="width: 280px;">' + Display.renderEventCard(n, thumb, { compact: true }) + '</div>';
    }).join('');
  }

  function renderEventsBoardFromState() {
    var grid = document.getElementById('vision-events-board-grid');
    if (!grid) return;
    var countEl = document.getElementById('vision-events-count');
    if (countEl) countEl.textContent = String(state.events.length);
    grid.innerHTML = state.events.map(function(n) {
      var thumb = getEventThumbUrl(n);
      return '<div class="col-12 col-sm-6 col-md-4 col-xxl-3">' + Display.renderEventCard(n, thumb) + '</div>';
    }).join('');
  }

  function apiEventToNormalized(it) {
    var payload = {
      type: 'event_notification',
      event_id: it.id,
      event: { label: it.label || 'Event', timestamp: it.event_ts || it.received_at },
      agent: { camera_id: it.camera_id || '', agent_name: it.agent_name || '' },
      received_at: it.event_ts || it.received_at
    };
    return Display.normalizeNotification(payload);
  }

  async function refreshDashboardLatestFromApi() {
    var container = document.getElementById('vision-latest-events');
    if (!container) return;
    if (!api || typeof api.listEvents !== 'function') return;
    if (typeof api.isAuthenticated === 'function' && !api.isAuthenticated()) return;
    try {
      var res = await api.listEvents('today', 5, 0);
      var items = Array.isArray(res && res.items) ? res.items : [];
      state.events = items.map(function(it) { return apiEventToNormalized(it); }).filter(Boolean);
      await Promise.all(state.events.map(function(e) { return ensureEventImageLoaded(e); }));
      updateLatestEventsSection();
    } catch {}
  }

  async function refreshEventsBoardFromApi(range) {
    var grid = document.getElementById('vision-events-board-grid');
    if (!grid) return;
    if (!api || typeof api.listEvents !== 'function') return;
    if (typeof api.isAuthenticated === 'function' && !api.isAuthenticated()) return;
    try {
      var res = await api.listEvents(range || 'all', 200, 0);
      var items = Array.isArray(res && res.items) ? res.items : [];
      var countEl = document.getElementById('vision-events-count');
      if (countEl) countEl.textContent = String((res && res.total) != null ? res.total : items.length);
      state.events = items.map(function(it) { return apiEventToNormalized(it); }).filter(Boolean);
      await Promise.all(state.events.map(function(e) { return ensureEventImageLoaded(e); }));
      renderEventsBoardFromState();
    } catch {}
  }

  function bindEventsBoardFilterOnce() {
    var sel = document.getElementById('vision-events-range');
    if (!sel) return;
    if (sel.getAttribute('data-vision-bound') === 'true') return;
    sel.setAttribute('data-vision-bound', 'true');
    sel.addEventListener('change', function() {
      refreshEventsBoardFromApi(sel.value);
    });
  }

  function markAllRead() {
    state.unread = 0;
    updateTopbar();
    var listEl = document.getElementById('vision-notif-list');
    if (listEl) {
      var cards = listEl.querySelectorAll('.notification-card.unread');
      for (var i = 0; i < cards.length; i++) {
        cards[i].classList.remove('unread');
        cards[i].classList.add('read');
      }
    }
  }

  function getDedupKey(n) {
    return n.eventId || n.notificationId || (n.notificationType + '-' + n.timestamp + '-' + n.title);
  }

  function handleEventNotification(payload) {
    var n = Display.normalizeNotification(payload);
    if (!n) return;
    var key = getDedupKey(n);
    if (state.seenIds.has(key)) return;
    state.seenIds.add(key);

    state.events.unshift(n);
    if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;

    state.unread += 1;
    updateTopbar();
    pushTopbar(n);
    ensureEventImageLoaded(n).then(function() { updateTopbarThumb(n); }).catch(function() {});
    refreshDashboardLatestFromApi();
    var sel = document.getElementById('vision-events-range');
    refreshEventsBoardFromApi(sel ? sel.value : 'all');
    showNativeNotification(n);

    window.dispatchEvent(new CustomEvent('vision:event-notification', { detail: n }));
    window.dispatchEvent(new CustomEvent('vision:event-notification-raw', { detail: payload }));
  }

  function handleSystemNotification(payload) {
    var n = Display.normalizeNotification(payload);
    if (!n) return;
    var key = getDedupKey(n);
    if (state.seenIds.has(key)) return;
    state.seenIds.add(key);

    state.events.unshift(n);
    if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;

    state.unread += 1;
    updateTopbar();
    pushTopbar(n);
    updateLatestEventsSection();
    renderEventsBoardFromState();
    showNativeNotification(n);

    window.dispatchEvent(new CustomEvent('vision:notification', { detail: n }));
  }

  function onWsMessage(msg) {
    var payload = msg && typeof msg === 'object' ? msg : safeJsonParse(msg);
    if (!payload) return;
    if (payload.type === 'connection_established') return;
    if (payload.type === 'event_notification') {
      handleEventNotification(payload);
      return;
    }
    if (payload.type === 'notification') {
      handleSystemNotification(payload);
      return;
    }
  }

  function refreshOsPopupPreference() {
    if (!api || typeof api.getNotificationPreferences !== 'function') return;
    api.getNotificationPreferences().then(function(p) {
      var ch = p && p.channels || {};
      var osCfg = ch.os_popup || {};
      state.osPopupEnabled = osCfg.enabled !== false;
    }).catch(function() { state.osPopupEnabled = true; });
  }

  function connectIfReady() {
    if (state.connected || state.connecting) return;
    if (!api || typeof api.isAuthenticated !== 'function') return;
    if (!api.isAuthenticated()) return;

    ensureNotificationPermission();
    refreshOsPopupPreference();

    state.connecting = true;
    try {
      state.ws = api.connectWebSocket(onWsMessage, () => {});
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
    try { if (state.ws && state.ws.close) state.ws.close(); } catch {}
    state.ws = null;
    state.unread = 0;
    state.events = [];
    state.seenIds.clear();
    state.clearedDummyList = false;
    updateTopbar();
  }

  function initUiHandlers() {
    var markBtn = document.getElementById('vision-notif-mark-read');
    if (markBtn && markBtn.getAttribute('data-vision-mark-bound') !== 'true') {
      markBtn.setAttribute('data-vision-mark-bound', 'true');
      markBtn.addEventListener('click', markAllRead);
    }
    var bellBtn = document.getElementById('vision-notif-bell');
    if (bellBtn && bellBtn.getAttribute('data-vision-bell-bound') !== 'true') {
      bellBtn.setAttribute('data-vision-bell-bound', 'true');
      bellBtn.addEventListener('click', requestNotificationPermissionOnUserGesture);
    }
  }

  function updateOsNotifStatus() {
    var el = document.getElementById('osNotifStatus');
    var btn = document.getElementById('btnEnableOsNotifications');
    if (!el) return;
    var perm = ('Notification' in window) ? Notification.permission : 'unsupported';
    if (perm === 'unsupported') {
      el.textContent = 'Not supported';
      el.className = 'badge badge-phoenix fs-10 mb-2 badge-phoenix-secondary';
      if (btn) { btn.style.display = 'none'; }
    } else if (perm === 'granted') {
      el.textContent = 'Enabled';
      el.className = 'badge badge-phoenix fs-10 mb-2 badge-phoenix-success';
      if (btn) {
        btn.innerHTML = '<span class="fas fa-check me-1"></span>Enabled';
        btn.disabled = true;
        btn.classList.remove('btn-phoenix-primary');
        btn.classList.add('btn-phoenix-success');
        btn.style.display = '';
      }
    } else {
      el.textContent = 'Disabled';
      el.className = 'badge badge-phoenix fs-10 mb-2 badge-phoenix-warning';
      if (btn) {
        btn.innerHTML = '<span class="fas fa-bell me-1"></span>Enable';
        btn.disabled = false;
        btn.classList.remove('btn-phoenix-success');
        btn.classList.add('btn-phoenix-primary');
        btn.style.display = '';
      }
    }
  }

  function initOsNotifSettingsUi() {
    var el = document.getElementById('osNotifStatus');
    var btn = document.getElementById('btnEnableOsNotifications');
    if (!el && !btn) return;
    console.log('[VisionNotifications] initOsNotifSettingsUi: osNotifStatus=', !!el, 'btn=', !!btn);
    updateOsNotifStatus();
    if (btn && btn.getAttribute('data-vision-os-notif-bound') !== 'true') {
      btn.setAttribute('data-vision-os-notif-bound', 'true');
      btn.addEventListener('click', function() {
        console.log('[VisionNotifications] Enable button clicked');
        requestNotificationPermissionOnUserGesture();
        window.addEventListener('vision:notification-permission-changed', function handler() {
          window.removeEventListener('vision:notification-permission-changed', handler);
          updateOsNotifStatus();
        });
        setTimeout(updateOsNotifStatus, 1000);
      });
    }
  }

  // Init (SPA-safe): layout-loader may inject this script after DOMContentLoaded.
  // So we run once immediately and keep a small retry loop.
  // Events API is only called when authenticated to avoid 401s before login.
  function boot() {
    console.log('[VisionNotifications] boot');
    initUiHandlers();
    initOsNotifSettingsUi();
    if (api && api.isAuthenticated && api.isAuthenticated()) {
      refreshOsPopupPreference();
    }
    connectIfReady();
    updateTopbar();
    bindEventsBoardFilterOnce();
    if (api && typeof api.isAuthenticated === 'function' && api.isAuthenticated()) {
      refreshDashboardLatestFromApi();
      var sel = document.getElementById('vision-events-range');
      refreshEventsBoardFromApi(sel ? sel.value : 'all');
    }
  }

  boot();

  document.addEventListener('DOMContentLoaded', function () {
    boot();
  });

  window.addEventListener('authStateChanged', function (event) {
    if (event && event.detail && event.detail.loggedIn) {
      connectIfReady();
      refreshDashboardLatestFromApi();
      var sel = document.getElementById('vision-events-range');
      refreshEventsBoardFromApi(sel ? sel.value : 'all');
    } else {
      disconnect();
    }
  });

  // SPA navigation hook (layout-loader dispatches this)
  window.addEventListener('vision:spa:navigated', function () {
    boot();
  });

  window.addEventListener('vision:notification-prefs-updated', function (e) {
    if (e && e.detail && e.detail.channels) {
      var osCfg = e.detail.channels.os_popup || {};
      state.osPopupEnabled = osCfg.enabled !== false;
    }
  });

  var retryTimer = setInterval(function() {
    if (state.connected) {
      clearInterval(retryTimer);
      return;
    }
    boot();
  }, 1500);

  window.__visionNotifications = {
    getState: function() { return { unread: state.unread, events: state.events.slice() }; },
    markAllRead: markAllRead,
    requestPermission: requestNotificationPermissionOnUserGesture,
    getPermission: function() { return ('Notification' in window) ? Notification.permission : 'unsupported'; },
    updateOsNotifStatus: updateOsNotifStatus,
  };
})();
