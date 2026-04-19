/**
 * Notification Normalizer
 * ========================
 * Converts raw WebSocket messages from the backend into clean,
 * easy-to-use notification objects.
 *
 * WHY this file exists:
 *   The backend sends TWO different message formats:
 *     1. { type: "event_notification" }  → from Kafka (AI detections with images)
 *     2. { type: "notification" }        → from WebSocketChannel (system alerts)
 *
 *   This file converts BOTH into one standard "display notification" object
 *   so the rest of the app doesn't need to know about the two formats.
 *
 * Output format (every notification becomes this):
 *   {
 *     notificationType : "event" | "camera_offline" | "report_ready"
 *     notificationId   : string (unique ID for deduplication)
 *     eventId          : string | null  (MongoDB event ID)
 *     sessionId        : string | null
 *     title            : string         (main display text)
 *     body             : string         (secondary description)
 *     severity         : "Critical" | "Warning" | "Info"
 *     timestamp        : string (ISO date)
 *     cameraId         : string
 *     agentName        : string
 *     thumbnailDataUrl : string | null  (base64 image for event cards)
 *     thumbnailObjectUrl : string | null  (blob URL loaded from API later)
 *     icon             : string (Font Awesome class like "fa-video")
 *     iconColorClass   : string (CSS class like "text-danger")
 *   }
 *
 * Load order: SECOND (after constants.js)
 */

window.VisionNotificationNormalizer = (function () {
  'use strict';

  var Constants = window.VisionNotificationConstants;

  // ─────────────────────────────────────────────
  // Helper: safely escape HTML to prevent XSS
  // ─────────────────────────────────────────────
  function escapeHtml(inputString) {
    return String(inputString)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ─────────────────────────────────────────────
  // Helper: guess severity from the event label text
  // Used when the backend doesn't send a severity field
  // ─────────────────────────────────────────────
  function inferSeverityFromLabel(labelText) {
    var lowerLabel = String(labelText || '').toLowerCase();
    if (lowerLabel.indexOf('resolved') !== -1) return Constants.SEVERITY.RESOLVED;

    var isCritical = Constants.CRITICAL_KEYWORDS.some(function (keyword) {
      return lowerLabel.indexOf(keyword) !== -1;
    });
    if (isCritical) return Constants.SEVERITY.CRITICAL;

    var isWarning = Constants.WARNING_KEYWORDS.some(function (keyword) {
      return lowerLabel.indexOf(keyword) !== -1;
    });
    if (isWarning) return Constants.SEVERITY.WARNING;

    return Constants.SEVERITY.INFO;
  }

  // ─────────────────────────────────────────────
  // Helper: normalize severity string from backend
  // Backend sends "critical", "warning", "info" (lowercase)
  // We display as "Critical", "Warning", "Info" (capitalized)
  // ─────────────────────────────────────────────
  function normalizeSeverity(severityString) {
    if (!severityString) return Constants.SEVERITY.INFO;

    var lowercase = String(severityString).toLowerCase();
    if (lowercase === 'critical') return Constants.SEVERITY.CRITICAL;
    if (lowercase === 'warning')  return Constants.SEVERITY.WARNING;
    if (lowercase === 'resolved') return Constants.SEVERITY.RESOLVED;
    return Constants.SEVERITY.INFO;
  }

  // ─────────────────────────────────────────────
  // Helper: how long ago was this timestamp?
  // Returns a short string like "5m", "2h", "3d"
  // ─────────────────────────────────────────────
  function timeAgo(isoTimestamp) {
    if (!isoTimestamp) return '';

    var parsedDate = new Date(isoTimestamp);
    if (!isFinite(parsedDate.getTime())) return '';

    var millisecondsDifference = Math.max(0, Date.now() - parsedDate.getTime());
    var totalSeconds = Math.floor(millisecondsDifference / 1000);

    if (totalSeconds < 60)            return totalSeconds + 's';
    var totalMinutes = Math.floor(totalSeconds / 60);
    if (totalMinutes < 60)            return totalMinutes + 'm';
    var totalHours = Math.floor(totalMinutes / 60);
    if (totalHours < 24)              return totalHours + 'h';
    return Math.floor(totalHours / 24) + 'd';
  }

  // ─────────────────────────────────────────────
  // Helper: build a URL to the event detail page
  // ─────────────────────────────────────────────
  function buildEventDetailUrl(eventId) {
    var urlParams = new URLSearchParams();
    if (eventId) urlParams.set('event_id', eventId);
    return '../pages/event-detail.html?' + urlParams.toString();
  }

  // ─────────────────────────────────────────────
  // Helper: build a URL to the camera detail page
  // ─────────────────────────────────────────────
  function buildCameraDetailUrl(cameraId) {
    if (!cameraId) return '#';
    return '../pages/camera-detail.html?camera=' + encodeURIComponent(cameraId);
  }

  // ─────────────────────────────────────────────
  // Get the click destination URL for a notification
  // ─────────────────────────────────────────────
  function getNotificationHref(notification) {
    if (notification.notificationType === Constants.NOTIFICATION_TYPE.EVENT && notification.eventId) {
      return buildEventDetailUrl(notification.eventId);
    }
    if (notification.notificationType === Constants.NOTIFICATION_TYPE.CAMERA_OFFLINE && notification.cameraId) {
      return buildCameraDetailUrl(notification.cameraId);
    }
    if (notification.notificationType === Constants.NOTIFICATION_TYPE.REPORT_READY) {
      return '../pages/dashboard.html';
    }
    return buildEventDetailUrl(notification.eventId);
  }

  // ─────────────────────────────────────────────
  // Normalize Format 1: "event_notification"
  // Sent by the Kafka/NATS consumer when a camera detects something.
  // Has rich data: image, agent info, camera info.
  // ─────────────────────────────────────────────
  function normalizeEventNotification(rawPayload) {
    var eventInfo = rawPayload.event  || {};
    var agentInfo = rawPayload.agent  || {};
    var frameInfo = rawPayload.frame  || {};
    var label     = eventInfo.label   || 'Event';
    var severity  = eventInfo.severity
      ? normalizeSeverity(eventInfo.severity)
      : inferSeverityFromLabel(label);

    var thumbnailDataUrl = null;
    if (frameInfo.image_base64) {
      var imageFormat = frameInfo.format || 'jpeg';
      thumbnailDataUrl = 'data:image/' + imageFormat + ';base64,' + frameInfo.image_base64;
    }

    return {
      notificationType   : Constants.NOTIFICATION_TYPE.EVENT,
      notificationId     : rawPayload.event_id || rawPayload.notification_id || null,
      eventId            : rawPayload.event_id || null,
      sessionId          : rawPayload.session_id || (rawPayload.metadata && rawPayload.metadata.session_id) || null,
      title              : label,
      body               : label,
      severity           : severity,
      timestamp          : eventInfo.timestamp || rawPayload.received_at || null,
      cameraId           : agentInfo.camera_id  || agentInfo.cameraId    || '',
      agentName          : agentInfo.agent_name || agentInfo.agentName   || '',
      thumbnailDataUrl   : thumbnailDataUrl,
      thumbnailObjectUrl : null,
      icon               : Constants.ICON.EVENT,
      iconColorClass     : Constants.ICON_COLOR.INFO,
    };
  }

  // ─────────────────────────────────────────────
  // Normalize Format 2: "notification"
  // Sent by WebSocketChannel for system alerts:
  //   camera_offline → camera went offline
  //   report_ready   → scheduled report is ready
  // ─────────────────────────────────────────────
  function normalizeSystemNotification(rawPayload) {
    var innerPayload   = rawPayload.payload       || {};
    var notifType      = rawPayload.notification_type || 'info';
    var severity       = normalizeSeverity(rawPayload.severity);

    // Choose icon and color based on type and severity
    var iconName       = Constants.ICON.DEFAULT;
    var iconColorClass = Constants.ICON_COLOR.INFO;

    if (severity === Constants.SEVERITY.CRITICAL) {
      iconName       = 'fa-triangle-exclamation';
      iconColorClass = Constants.ICON_COLOR.CRITICAL;
    } else if (severity === Constants.SEVERITY.WARNING) {
      iconName       = 'fa-circle-exclamation';
      iconColorClass = Constants.ICON_COLOR.WARNING;
    }

    // Override icon for specific notification types
    if (notifType === Constants.NOTIFICATION_TYPE.CAMERA_OFFLINE) {
      iconName       = Constants.ICON.CAMERA_OFFLINE;
      iconColorClass = Constants.ICON_COLOR.WARNING;
    } else if (notifType === Constants.NOTIFICATION_TYPE.REPORT_READY) {
      iconName       = Constants.ICON.REPORT_READY;
      iconColorClass = 'text-success';
    }

    return {
      notificationType   : notifType,
      notificationId     : rawPayload.notification_id || null,
      eventId            : null,
      sessionId          : null,
      title              : rawPayload.title || 'Notification',
      body               : rawPayload.body  || '',
      severity           : severity,
      timestamp          : rawPayload.received_at || null,
      cameraId           : innerPayload.camera_id  || '',
      agentName          : '',
      thumbnailDataUrl   : null,
      thumbnailObjectUrl : null,
      icon               : iconName,
      iconColorClass     : iconColorClass,
      extraPayload       : innerPayload,
    };
  }

  // ─────────────────────────────────────────────
  // Main function: normalize ANY raw WebSocket payload
  // Detects the format and calls the right normalizer
  // ─────────────────────────────────────────────
  function normalizeNotification(rawPayload) {
    if (!rawPayload || typeof rawPayload !== 'object') return null;

    if (rawPayload.type === Constants.WS_MESSAGE_TYPE.EVENT_NOTIFICATION) {
      return normalizeEventNotification(rawPayload);
    }

    if (rawPayload.type === Constants.WS_MESSAGE_TYPE.SYSTEM_NOTIFICATION) {
      return normalizeSystemNotification(rawPayload);
    }

    return null;
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────
  return {
    normalizeNotification     : normalizeNotification,
    normalizeSeverity         : normalizeSeverity,
    inferSeverityFromLabel    : inferSeverityFromLabel,
    getNotificationHref       : getNotificationHref,
    timeAgo                   : timeAgo,
    escapeHtml                : escapeHtml,
    buildEventDetailUrl       : buildEventDetailUrl,
    buildCameraDetailUrl      : buildCameraDetailUrl,
  };
})();

// ─────────────────────────────────────────────
// Backward compatibility shim
// Old code uses window.VisionNotificationDisplay — keep working
// ─────────────────────────────────────────────
window.VisionNotificationDisplay = (function () {
  var Normalizer  = window.VisionNotificationNormalizer;
  var Constants   = window.VisionNotificationConstants;

  return {
    NOTIFICATION_TYPE     : Constants.NOTIFICATION_TYPE,
    SEVERITY              : Constants.SEVERITY,
    normalizeNotification : Normalizer.normalizeNotification,
    getSeverityBadgeClass : function (severity) { return Constants.BADGE_CLASS[severity] || 'badge-phoenix-info'; },
    timeAgo               : Normalizer.timeAgo,
    getNotificationHref   : Normalizer.getNotificationHref,
    escapeHtml            : Normalizer.escapeHtml,
    inferSeverityFromLabel: Normalizer.inferSeverityFromLabel,

    // These will be filled in by ui.js (same file split)
    renderTopbarCard : null,
    renderEventCard  : null,
  };
})();
