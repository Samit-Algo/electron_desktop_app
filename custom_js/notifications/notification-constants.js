/**
 * Notification Constants
 * ======================
 * All shared constants for the notification system.
 *
 * Think of this file as a dictionary of fixed values.
 * Other files import from here so we never have to repeat
 * the same string like "camera_offline" in multiple places.
 *
 * Load order: FIRST (before all other notification files)
 */

window.VisionNotificationConstants = (function () {
  'use strict';

  // ─────────────────────────────────────────────
  // Notification Types
  // Must match backend: infrastructure/notifications/models.py
  // ─────────────────────────────────────────────
  var NOTIFICATION_TYPE = Object.freeze({
    EVENT          : 'event',           // AI detection (weapon, fall, fire, etc.)
    CAMERA_OFFLINE : 'camera_offline',  // Camera went offline
    REPORT_READY   : 'report_ready',    // Scheduled report is ready to download
  });

  // ─────────────────────────────────────────────
  // Severity Levels
  // Must match backend severity strings (lowercased from backend)
  // ─────────────────────────────────────────────
  var SEVERITY = Object.freeze({
    CRITICAL : 'Critical',  // Life safety: weapon, fire, fall, intrusion
    WARNING  : 'Warning',   // Policy violation: restricted zone, collision
    INFO     : 'Info',      // Informational: general detection
    RESOLVED : 'Resolved',  // Acknowledged / cleared (when backend sends it)
  });

  // ─────────────────────────────────────────────
  // Keywords that tell us an event is critical
  // Used when the backend doesn't include severity in the payload
  // ─────────────────────────────────────────────
  var CRITICAL_KEYWORDS = ['weapon', 'fire', 'fall', 'intrusion'];
  var WARNING_KEYWORDS  = ['violation', 'restricted', 'collision', 'alert'];

  // ─────────────────────────────────────────────
  // Icons for each notification type (Font Awesome 6 class names)
  // ─────────────────────────────────────────────
  var ICON = Object.freeze({
    EVENT          : 'fa-video',
    CAMERA_OFFLINE : 'fa-video-slash',
    REPORT_READY   : 'fa-file-excel',
    DEFAULT        : 'fa-bell',
  });

  // ─────────────────────────────────────────────
  // Icon color class for each severity level
  // ─────────────────────────────────────────────
  var ICON_COLOR = Object.freeze({
    CRITICAL : 'text-danger',
    WARNING  : 'text-warning',
    INFO     : 'text-body-secondary',
  });

  // ─────────────────────────────────────────────
  // Badge CSS class for each severity level (Phoenix theme)
  // ─────────────────────────────────────────────
  var BADGE_CLASS = Object.freeze({
    Critical : 'badge-phoenix-danger',
    Warning  : 'badge-phoenix-warning',
    Info     : 'badge-phoenix-info',
    Resolved : 'badge-phoenix-secondary',
  });

  // ─────────────────────────────────────────────
  // WebSocket message type strings sent by the backend
  // ─────────────────────────────────────────────
  var WS_MESSAGE_TYPE = Object.freeze({
    EVENT_NOTIFICATION   : 'event_notification',  // From Kafka consumer (rich event + image)
    SYSTEM_NOTIFICATION  : 'notification',         // From WebSocketChannel (camera_offline, report_ready)
    CONNECTION_CONFIRMED : 'connection_established',
  });

  // ─────────────────────────────────────────────
  // How many notifications to keep in memory
  // Older ones are dropped to save RAM
  // ─────────────────────────────────────────────
  var MAX_NOTIFICATIONS_IN_MEMORY = 100;

  // ─────────────────────────────────────────────
  // Minimum milliseconds between OS native popups
  // (prevents spamming the user with popups)
  // ─────────────────────────────────────────────
  var OS_POPUP_RATE_LIMIT_MS = 1500;

  // ─────────────────────────────────────────────
  // How often to retry connecting (when not yet authenticated)
  // ─────────────────────────────────────────────
  var RETRY_CONNECT_INTERVAL_MS = 1500;

  // ─────────────────────────────────────────────
  // Public API — what other files can use
  // ─────────────────────────────────────────────
  return {
    NOTIFICATION_TYPE          : NOTIFICATION_TYPE,
    SEVERITY                   : SEVERITY,
    CRITICAL_KEYWORDS          : CRITICAL_KEYWORDS,
    WARNING_KEYWORDS           : WARNING_KEYWORDS,
    ICON                       : ICON,
    ICON_COLOR                 : ICON_COLOR,
    BADGE_CLASS                : BADGE_CLASS,
    WS_MESSAGE_TYPE            : WS_MESSAGE_TYPE,
    MAX_NOTIFICATIONS_IN_MEMORY: MAX_NOTIFICATIONS_IN_MEMORY,
    OS_POPUP_RATE_LIMIT_MS     : OS_POPUP_RATE_LIMIT_MS,
    RETRY_CONNECT_INTERVAL_MS  : RETRY_CONNECT_INTERVAL_MS,
  };
})();
