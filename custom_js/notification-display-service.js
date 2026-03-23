/**
 * Notification Display Service
 * ============================
 * Unified frontend service for displaying notifications.
 * Aligns with backend notification types: event, camera_offline, report_ready.
 * Normalizes both WebSocket payload formats into a single display model.
 */
(function () {
  'use strict';

  if (window.__visionNotificationDisplayServiceLoaded) return;
  window.__visionNotificationDisplayServiceLoaded = true;

  // Backend notification types (matches vision-backend/app/infrastructure/notifications/models.py)
  const NOTIFICATION_TYPE = {
    EVENT: 'event',
    CAMERA_OFFLINE: 'camera_offline',
    REPORT_READY: 'report_ready',
  };

  // Severity (backend uses: info | warning | critical)
  const SEVERITY = {
    CRITICAL: 'Critical',
    WARNING: 'Warning',
    INFO: 'Info',
  };

  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  /**
   * Infer severity from event label (for event_notification which may not include severity).
   */
  function inferSeverityFromLabel(label) {
    const t = String(label || '').toLowerCase();
    if (t.includes('weapon') || t.includes('fire') || t.includes('fall') || t.includes('intrusion')) return SEVERITY.CRITICAL;
    if (t.includes('violation') || t.includes('restricted') || t.includes('collision') || t.includes('alert')) return SEVERITY.WARNING;
    return SEVERITY.INFO;
  }

  /**
   * Normalize backend severity string to display format.
   */
  function normalizeSeverity(sev) {
    if (!sev) return SEVERITY.INFO;
    const s = String(sev).toLowerCase();
    if (s === 'critical') return SEVERITY.CRITICAL;
    if (s === 'warning') return SEVERITY.WARNING;
    return SEVERITY.INFO;
  }

  /**
   * Normalize raw WebSocket payload to unified display model.
   * Supports:
   * - type: "event_notification" (from Kafka -> WebSocket)
   * - type: "notification" (from WebSocketChannel: camera_offline, report_ready)
   */
  function normalizeNotification(payload) {
    if (!payload || typeof payload !== 'object') return null;

    // Format 1: event_notification (Kafka consumer -> format_event_notification)
    if (payload.type === 'event_notification') {
      const eventInfo = payload.event || {};
      const agentInfo = payload.agent || {};
      const label = eventInfo.label || 'Event';
      return {
        notificationType: NOTIFICATION_TYPE.EVENT,
        notificationId: payload.event_id || payload.notification_id || null,
        eventId: payload.event_id,
        sessionId: payload.session_id || payload.metadata?.session_id || null,
        title: label,
        body: label,
        label: label,
        severity: inferSeverityFromLabel(label),
        timestamp: payload.event?.timestamp || payload.received_at || null,
        cameraId: agentInfo.camera_id || agentInfo.cameraId || '',
        agentName: agentInfo.agent_name || agentInfo.agentName || '',
        thumbDataUrl: payload.frame?.image_base64
          ? `data:image/${payload.frame.format || 'jpeg'};base64,${payload.frame.image_base64}`
          : null,
        thumbObjectUrl: null,
        icon: 'fa-video',
        iconClass: 'text-primary',
      };
    }

    // Format 2: notification (WebSocketChannel - camera_offline, report_ready)
    if (payload.type === 'notification') {
      const p = payload.payload || {};
      const notifType = payload.notification_type || 'info';
      const sev = normalizeSeverity(payload.severity);

      let icon = 'fa-bell';
      let iconClass = 'text-body-secondary';
      if (sev === SEVERITY.CRITICAL) {
        icon = 'fa-triangle-exclamation';
        iconClass = 'text-danger';
      } else if (sev === SEVERITY.WARNING) {
        icon = 'fa-circle-exclamation';
        iconClass = 'text-warning';
      }

      if (notifType === NOTIFICATION_TYPE.CAMERA_OFFLINE) {
        icon = 'fa-video-slash';
        iconClass = 'text-warning';
      } else if (notifType === NOTIFICATION_TYPE.REPORT_READY) {
        icon = 'fa-file-excel';
        iconClass = 'text-success';
      }

      return {
        notificationType: notifType,
        notificationId: payload.notification_id || null,
        eventId: null,
        sessionId: null,
        title: payload.title || 'Notification',
        body: payload.body || '',
        label: payload.title || payload.body || 'Notification',
        severity: sev,
        timestamp: payload.received_at || null,
        cameraId: p.camera_id || '',
        agentName: '',
        thumbDataUrl: null,
        thumbObjectUrl: null,
        icon: icon,
        iconClass: iconClass,
        payload: p,
      };
    }

    return null;
  }

  function getSeverityBadgeClass(severity) {
    if (severity === SEVERITY.CRITICAL) return 'badge-phoenix-danger';
    if (severity === SEVERITY.WARNING) return 'badge-phoenix-warning';
    return 'badge-phoenix-info';
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '';
    const diff = Math.max(0, Date.now() - d.getTime());
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return sec + 's';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h';
    return Math.floor(hr / 24) + 'd';
  }

  function buildEventDetailUrl(n) {
    const params = new URLSearchParams();
    if (n.eventId) params.set('event_id', n.eventId);
    return '../pages/event-detail.html?' + params.toString();
  }

  function buildCameraDetailUrl(cameraId) {
    if (!cameraId) return '#';
    return '../pages/camera-detail.html?camera=' + encodeURIComponent(cameraId);
  }

  /**
   * Build href for notification click (event -> event-detail, camera_offline -> camera-detail).
   */
  function getNotificationHref(n) {
    if (n.notificationType === NOTIFICATION_TYPE.EVENT && n.eventId) {
      return buildEventDetailUrl(n);
    }
    if (n.notificationType === NOTIFICATION_TYPE.CAMERA_OFFLINE && n.cameraId) {
      return buildCameraDetailUrl(n.cameraId);
    }
    if (n.notificationType === NOTIFICATION_TYPE.REPORT_READY) {
      return '../pages/dashboard.html'; // Report is emailed; no in-app detail page
    }
    return buildEventDetailUrl(n);
  }

  /**
   * Render a topbar notification card (dropdown item).
   */
  function renderTopbarCard(n, options) {
    options = options || {};
    const thumb = n.thumbDataUrl || n.thumbObjectUrl || null;
    const href = getNotificationHref(n);
    const ago = timeAgo(n.timestamp);
    const badgeCls = getSeverityBadgeClass(n.severity);
    const timeLine = n.timestamp ? escapeHtml(new Date(n.timestamp).toLocaleString()) : '';
    const eventKey = escapeHtml(n.notificationId || n.eventId || '');
    const avatarLetter = (n.label || 'N').trim().charAt(0).toUpperCase();
    const icon = n.icon || 'fa-bell';
    const iconClass = n.iconClass || 'text-body-secondary';

    const wrapper = document.createElement('div');
    wrapper.className = 'px-2 px-sm-3 py-3 notification-card position-relative unread border-bottom border-translucent';
    if (eventKey) wrapper.setAttribute('data-vision-notif-id', eventKey);

    var avatarHtml =
      n.notificationType === NOTIFICATION_TYPE.EVENT
        ? '<div class="avatar avatar-m status-online me-3"><div class="avatar-name rounded-circle"><span>' + escapeHtml(avatarLetter) + '</span></div></div>'
        : '<div class="avatar avatar-m status-online me-3"><div class="avatar-name rounded-circle bg-body-secondary d-flex align-items-center justify-content-center"><i class="fa-solid ' + icon + ' ' + iconClass + '"></i></div></div>';

    wrapper.innerHTML =
      '<div class="d-flex align-items-center justify-content-between position-relative">' +
      '  <div class="d-flex align-items-center">' +
      avatarHtml +
      '    <div class="flex-1 me-sm-3">' +
      '      <div class="d-flex align-items-center gap-2">' +
      '        <h4 class="fs-9 text-body-emphasis mb-0">' +
      escapeHtml(n.title) +
      '</h4>' +
      '        <span class="badge badge-phoenix fs-10 ' +
      badgeCls +
      '" data-bs-theme="light">' +
      escapeHtml(n.severity) +
      '</span>' +
      '      </div>' +
      '      <p class="fs-9 text-body-highlight mb-2 mb-sm-2 fw-normal">' +
      (n.notificationType === NOTIFICATION_TYPE.CAMERA_OFFLINE
        ? 'Camera offline' + (n.cameraId ? ' • ' + escapeHtml(n.cameraId) : '')
        : n.notificationType === NOTIFICATION_TYPE.REPORT_READY
          ? 'Report ready'
          : 'Event detected' + (n.cameraId ? ' • Camera ' + escapeHtml(n.cameraId) : '')) +
      (ago ? '<span class="ms-2 text-body-quaternary text-opacity-75 fw-bold fs-10">' + ago + '</span>' : '') +
      '</p>' +
      (timeLine ? '<p class="text-body-secondary fs-9 mb-0"><span class="me-1 fas fa-clock"></span>' + timeLine + '</p>' : '') +
      '    </div>' +
      '  </div>' +
      (n.notificationType === NOTIFICATION_TYPE.EVENT
        ? '  <div class="ms-3 flex-shrink-0">' +
          '    <div class="rounded-2 overflow-hidden bg-body-secondary" style="width:84px;height:56px;position:relative;border:1px solid rgba(0,0,0,0.06);">' +
          '      <img data-vision-notif-thumb="' + eventKey + '" src="' + (thumb ? escapeHtml(thumb) : '') + '" alt="" style="width:100%;height:100%;object-fit:cover;display:' + (thumb ? 'block' : 'none') + ';">' +
          '      <div data-vision-notif-thumb-fallback="' + eventKey + '" class="d-flex align-items-center justify-content-center text-body-secondary" style="width:100%;height:100%;display:' + (thumb ? 'none' : 'flex') + ';">' +
          '        <span class="fa-solid fa-image"></span>' +
          '      </div>' +
          '    </div>' +
          '  </div>'
        : '') +
      '</div>' +
      '<a class="stretched-link" href="' +
      escapeHtml(href) +
      '"></a>';

    return wrapper;
  }

  /**
   * Render a dashboard/events-board card.
   * @param {Object} n - Normalized notification
   * @param {string|null} thumb - Thumbnail URL
   * @param {Object} opts - { compact: boolean } - compact = 280x170 for dashboard latest
   */
  function renderEventCard(n, thumb, opts) {
    opts = opts || {};
    var badgeCls = getSeverityBadgeClass(n.severity);
    var ago = timeAgo(n.timestamp);
    var href = getNotificationHref(n);
    var style = opts.compact ? 'height: 170px;' : 'height: 236px;';
    var padding = opts.compact ? 'p-3' : 'p-4';
    var subTitle = n.cameraId ? 'Camera ' + escapeHtml(n.cameraId) : n.notificationType === NOTIFICATION_TYPE.CAMERA_OFFLINE ? 'Camera Offline' : n.notificationType === NOTIFICATION_TYPE.REPORT_READY ? 'Report' : 'Event';

    return (
      '<div class="btn-reveal-trigger position-relative rounded-2 overflow-hidden ' + padding + '" style="' + style + '">' +
      (thumb
        ? '<img src="' + escapeHtml(thumb) + '" alt="" class="w-100 h-100 position-absolute top-0 start-0" style="object-fit: cover;">'
        : '<div class="w-100 h-100 position-absolute top-0 start-0 bg-body-secondary"></div>') +
      '<div class="w-100 h-100 position-absolute top-0 start-0" style="background: linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%);"></div>' +
      '<div class="position-relative h-100 d-flex flex-column justify-content-between">' +
      '  <div class="d-flex justify-content-between align-items-center">' +
      '    <span class="badge badge-phoenix fs-10 ' + badgeCls + '" data-bs-theme="light">' + escapeHtml(n.severity) + '</span>' +
      '  </div>' +
      '  <div>' +
      '    <h3 class="text-white fw-bold line-clamp-2 mb-1">' + escapeHtml(n.title) + '</h3>' +
      '    <p class="text-white text-opacity-75 fs-9 mb-0">' + subTitle + '</p>' +
      '    <div class="d-flex align-items-center mt-2">' +
      '      <span class="fa-solid ' + (n.icon || 'fa-video') + ' text-white text-opacity-75 me-2 fs-10"></span>' +
      '      <span class="text-white text-opacity-75 fs-9">' + (ago || '') + '</span>' +
      '    </div>' +
      '  </div>' +
      '</div>' +
      '<a class="stretched-link" href="' + escapeHtml(href) + '"></a>' +
      '</div>'
    );
  }

  window.VisionNotificationDisplay = {
    NOTIFICATION_TYPE: Object.freeze(NOTIFICATION_TYPE),
    SEVERITY: Object.freeze(SEVERITY),
    normalizeNotification: normalizeNotification,
    getSeverityBadgeClass: getSeverityBadgeClass,
    timeAgo: timeAgo,
    getNotificationHref: getNotificationHref,
    renderTopbarCard: renderTopbarCard,
    renderEventCard: renderEventCard,
    inferSeverityFromLabel: inferSeverityFromLabel,
    escapeHtml: escapeHtml,
  };
})();
