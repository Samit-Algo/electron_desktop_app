/**
 * Notification Hub
 * =================
 * The MAIN COORDINATOR for the entire notification system.
 *
 * Think of this file as the "boss" that connects everything together:
 *   1. Opens the WebSocket connection to the backend
 *   2. Receives incoming messages
 *   3. Normalizes the data  (via notification-normalizer.js)
 *   4. Updates the UI       (via notification-ui.js)
 *   5. Shows OS popups      (via notification-popup.js)
 *   6. Tells other parts of the app about new events
 *
 * HOW NOTIFICATIONS FLOW (from backend to screen):
 * ─────────────────────────────────────────────────
 *  Backend FastAPI  →  WebSocket  →  onWebSocketMessage()
 *    ↓
 *  normalizeNotification()        ← clean up the raw data
 *    ↓
 *  deduplicateAndStore()          ← don't show the same event twice
 *    ↓
 *  updateBellBadge()              ← update the red number on the bell icon
 *  prependCardToDropdown()        ← add card to the bell dropdown
 *  showOsPopup()                  ← show native desktop notification
 *  refreshDashboardFromApi()      ← update dashboard latest events
 *  refreshEventsBoardFromApi()    ← update events board grid
 *  dispatchCustomEvent()          ← tell other JS files about the new event
 *
 * Load order: LAST (after all other notification files)
 */

(function ($) {
  'use strict';

  // Guard against being loaded twice (SPA navigation re-runs layout scripts)
  if (window.__visionNotificationHubLoaded) return;
  window.__visionNotificationHubLoaded = true;

  // ─────────────────────────────────────────────
  // Module dependencies
  // ─────────────────────────────────────────────
  var Constants  = window.VisionNotificationConstants;
  var Normalizer = window.VisionNotificationNormalizer;
  var UI         = window.VisionNotificationUI;
  var Popup      = window.VisionNotificationPopup;

  if (!Constants || !Normalizer || !UI || !Popup) {
    console.error('[NotificationHub] One or more required modules not loaded. Check script order.');
    return;
  }

  // ─────────────────────────────────────────────
  // State: everything the Hub tracks at runtime
  // ─────────────────────────────────────────────
  var state = {
    isConnected    : false,
    isConnecting   : false,
    webSocketHandle: null,    // returned by visionAPI.connectWebSocket()
    unreadCount    : 0,
    notificationsList : [],   // Array of normalized notification objects
    seenNotificationIds : new Set(), // Set of string IDs we've already processed
    hasRemovedEmptyPlaceholder: false,

    // Cache of thumbnail blob URLs (so we don't re-fetch from API)
    thumbnailCacheByEventId : new Map(),
    // Set of event IDs currently being fetched (avoid duplicate requests)
    thumbnailFetchInProgress: new Set(),
  };

  // ─────────────────────────────────────────────
  // Helper: get a unique deduplication key for a notification
  // Prevents the same event showing up twice
  // ─────────────────────────────────────────────
  function getDeduplicationKey(notification) {
    return (
      notification.notificationId ||
      notification.eventId ||
      (notification.notificationType + '-' + notification.timestamp + '-' + notification.title)
    );
  }

  // ─────────────────────────────────────────────
  // Helper: get whatever thumbnail URL we have for an event
  // ─────────────────────────────────────────────
  function getThumbnailUrl(notification) {
    return notification.thumbnailDataUrl || notification.thumbnailObjectUrl || null;
  }

  // ─────────────────────────────────────────────
  // Fetch a thumbnail from the API for an event
  // and update the notification card once loaded
  // ─────────────────────────────────────────────
  async function loadThumbnailFromApi(notification) {
    if (!notification || notification.notificationType !== Constants.NOTIFICATION_TYPE.EVENT) return;
    if (getThumbnailUrl(notification)) return; // Already have it
    if (!notification.eventId) return;
    if (!window.visionAPI || typeof window.visionAPI.fetchEventImageObjectUrl !== 'function') return;

    var eventIdKey = String(notification.eventId);

    // Use cached result if already fetched
    if (state.thumbnailCacheByEventId.has(eventIdKey)) {
      notification.thumbnailObjectUrl = state.thumbnailCacheByEventId.get(eventIdKey);
      return;
    }

    // Skip if a fetch is already in progress for this event
    if (state.thumbnailFetchInProgress.has(eventIdKey)) return;
    state.thumbnailFetchInProgress.add(eventIdKey);

    try {
      var objectUrl = await window.visionAPI.fetchEventImageObjectUrl(notification.eventId);
      state.thumbnailCacheByEventId.set(eventIdKey, objectUrl);
      notification.thumbnailObjectUrl = objectUrl;
    } catch (error) {
      // Thumbnail not available — silently ignore
    } finally {
      state.thumbnailFetchInProgress.delete(eventIdKey);
    }
  }

  // ─────────────────────────────────────────────
  // Convert a raw API event object (from listEvents) into a notification
  // This is different from a WebSocket payload — it's from the REST API
  // ─────────────────────────────────────────────
  function convertApiEventToNotification(apiEventItem) {
    var wsStylePayload = {
      type     : Constants.WS_MESSAGE_TYPE.EVENT_NOTIFICATION,
      event_id : apiEventItem.id,
      event    : {
        label     : apiEventItem.label     || 'Event',
        timestamp : apiEventItem.event_ts  || apiEventItem.received_at,
      },
      agent    : {
        camera_id  : apiEventItem.camera_id  || '',
        agent_name : apiEventItem.agent_name || '',
      },
      received_at: apiEventItem.event_ts || apiEventItem.received_at,
    };
    return Normalizer.normalizeNotification(wsStylePayload);
  }

  // ─────────────────────────────────────────────
  // Load and render the "Latest Events" section on the Dashboard
  // Makes a REST API call — only runs when logged in
  // ─────────────────────────────────────────────
  async function refreshDashboardFromApi() {
    if ($('#vision-latest-events').length === 0) return;
    if (!window.visionAPI || typeof window.visionAPI.listEvents !== 'function') return;
    if (window.visionAPI.isAuthenticated && !window.visionAPI.isAuthenticated()) return;

    try {
      var apiResponse = await window.visionAPI.listEvents('today', 5, 0);
      var eventItems  = Array.isArray(apiResponse && apiResponse.items) ? apiResponse.items : [];

      var notificationsList = eventItems
        .map(convertApiEventToNotification)
        .filter(Boolean);

      // Load thumbnails in parallel before rendering
      await Promise.all(notificationsList.map(loadThumbnailFromApi));

      state.notificationsList = notificationsList;
      UI.renderLatestEventsSection(notificationsList);
    } catch (error) {
      // API call failed — silently ignore (user might not be on dashboard page)
    }
  }

  // ─────────────────────────────────────────────
  // Load and render the Events Board grid
  // range: 'today' | 'week' | 'month' | 'all'
  // ─────────────────────────────────────────────
  async function refreshEventsBoardFromApi(dateRange) {
    if ($('#vision-events-board-grid').length === 0) return;
    if (!window.visionAPI || typeof window.visionAPI.listEvents !== 'function') return;
    if (window.visionAPI.isAuthenticated && !window.visionAPI.isAuthenticated()) return;

    try {
      var apiResponse = await window.visionAPI.listEvents(dateRange || 'all', 200, 0);
      var eventItems  = Array.isArray(apiResponse && apiResponse.items) ? apiResponse.items : [];

      // Update the counter with the true total from the server
      var totalCount = (apiResponse && apiResponse.total != null) ? apiResponse.total : eventItems.length;
      $('#vision-events-count').text(String(totalCount));

      var notificationsList = eventItems
        .map(convertApiEventToNotification)
        .filter(Boolean);

      await Promise.all(notificationsList.map(loadThumbnailFromApi));

      state.notificationsList = notificationsList;
      UI.renderEventsBoardGrid(notificationsList);
    } catch (error) {
      // Silently ignore — user might not be on the events board page
    }
  }

  // ─────────────────────────────────────────────
  // Process an incoming AI detection event
  // Called when backend sends: { type: "event_notification", ... }
  // ─────────────────────────────────────────────
  function handleEventNotification(rawPayload) {
    var notification = Normalizer.normalizeNotification(rawPayload);
    if (!notification) return;

    // Deduplication: ignore events we've already seen
    var deduplicationKey = getDeduplicationKey(notification);
    if (state.seenNotificationIds.has(deduplicationKey)) return;
    state.seenNotificationIds.add(deduplicationKey);

    // Store in memory (newest first, cap at max)
    state.notificationsList.unshift(notification);
    if (state.notificationsList.length > Constants.MAX_NOTIFICATIONS_IN_MEMORY) {
      state.notificationsList.length = Constants.MAX_NOTIFICATIONS_IN_MEMORY;
    }

    // Update the UI
    state.unreadCount += 1;
    UI.updateBellBadge(state.unreadCount);
    UI.updateElectronBadge(state.unreadCount);
    UI.prependCardToDropdown(notification);
    Popup.showPopup(notification);

    // Try to load thumbnail, then update the card once ready
    loadThumbnailFromApi(notification).then(function () {
      var thumbnailUrl = getThumbnailUrl(notification);
      if (thumbnailUrl && notification.notificationId) {
        UI.updateDropdownCardThumbnail(notification.notificationId, thumbnailUrl);
      }
    }).catch(function () {});

    // Refresh dashboard and events board from the server API
    refreshDashboardFromApi();
    var currentDateRange = $('#vision-events-range').val() || 'all';
    refreshEventsBoardFromApi(currentDateRange);

    // Tell other parts of the app about this event
    window.dispatchEvent(new CustomEvent('vision:event-notification', { detail: notification }));
    window.dispatchEvent(new CustomEvent('vision:event-notification-raw', { detail: rawPayload }));
  }

  // ─────────────────────────────────────────────
  // Process an incoming system notification
  // Called when backend sends: { type: "notification", notification_type: "camera_offline" | "report_ready" }
  // ─────────────────────────────────────────────
  function handleSystemNotification(rawPayload) {
    var notification = Normalizer.normalizeNotification(rawPayload);
    if (!notification) return;

    var deduplicationKey = getDeduplicationKey(notification);
    if (state.seenNotificationIds.has(deduplicationKey)) return;
    state.seenNotificationIds.add(deduplicationKey);

    state.notificationsList.unshift(notification);
    if (state.notificationsList.length > Constants.MAX_NOTIFICATIONS_IN_MEMORY) {
      state.notificationsList.length = Constants.MAX_NOTIFICATIONS_IN_MEMORY;
    }

    state.unreadCount += 1;
    UI.updateBellBadge(state.unreadCount);
    UI.updateElectronBadge(state.unreadCount);
    UI.prependCardToDropdown(notification);
    UI.renderLatestEventsSection(state.notificationsList);
    UI.renderEventsBoardGrid(state.notificationsList);
    Popup.showPopup(notification);

    window.dispatchEvent(new CustomEvent('vision:notification', { detail: notification }));
  }

  // ─────────────────────────────────────────────
  // Router: called for every message from the WebSocket
  // Routes to the correct handler based on message type
  // ─────────────────────────────────────────────
  function onWebSocketMessage(incomingMessage) {
    // Handle both raw string (JSON) and already-parsed object
    var rawPayload = (incomingMessage && typeof incomingMessage === 'object')
      ? incomingMessage
      : (() => { try { return JSON.parse(incomingMessage); } catch { return null; } })();

    if (!rawPayload) return;

    if (rawPayload.type === Constants.WS_MESSAGE_TYPE.CONNECTION_CONFIRMED) return; // Ignore handshake
    if (rawPayload.type === Constants.WS_MESSAGE_TYPE.EVENT_NOTIFICATION)   { handleEventNotification(rawPayload); return; }
    if (rawPayload.type === Constants.WS_MESSAGE_TYPE.SYSTEM_NOTIFICATION)  { handleSystemNotification(rawPayload); return; }
  }

  // ─────────────────────────────────────────────
  // Load the user's OS popup preference from the backend API
  // ─────────────────────────────────────────────
  function loadOsPopupPreference() {
    if (!window.visionAPI || typeof window.visionAPI.getNotificationPreferences !== 'function') return;

    window.visionAPI.getNotificationPreferences().then(function (preferences) {
      var channelsConfig = (preferences && preferences.channels) || {};
      var osPopupConfig  = channelsConfig.os_popup || {};
      Popup.setUserPreference(osPopupConfig.enabled !== false);
    }).catch(function () {
      Popup.setUserPreference(true); // Default: enabled
    });
  }

  // ─────────────────────────────────────────────
  // Connect to the backend WebSocket
  // Only connects when the user is logged in
  // ─────────────────────────────────────────────
  function connectToWebSocket() {
    if (state.isConnected || state.isConnecting) return;
    if (!window.visionAPI || typeof window.visionAPI.isAuthenticated !== 'function') return;
    if (!window.visionAPI.isAuthenticated()) return;

    Popup.requestPermissionSilently();
    loadOsPopupPreference();

    state.isConnecting = true;
    try {
      state.webSocketHandle = window.visionAPI.connectWebSocket(onWebSocketMessage, function () {});
      state.isConnected     = true;
    } catch (connectionError) {
      // Will retry on next authStateChanged or retry timer
    } finally {
      state.isConnecting = false;
    }
  }

  // ─────────────────────────────────────────────
  // Disconnect from the WebSocket and reset all state
  // Called when the user logs out
  // ─────────────────────────────────────────────
  function disconnectFromWebSocket() {
    state.isConnected  = false;
    state.isConnecting = false;

    try {
      if (state.webSocketHandle && state.webSocketHandle.close) {
        state.webSocketHandle.close();
      }
    } catch (error) {}

    state.webSocketHandle      = null;
    state.unreadCount          = 0;
    state.notificationsList    = [];
    state.seenNotificationIds.clear();
    state.hasRemovedEmptyPlaceholder = false;

    UI.updateBellBadge(0);
    UI.updateElectronBadge(0);
  }

  // ─────────────────────────────────────────────
  // Reset unread count to 0 (called when user clicks "Mark all read")
  // ─────────────────────────────────────────────
  function markAllAsRead() {
    state.unreadCount = 0;
    UI.updateBellBadge(0);
    UI.updateElectronBadge(0);
    UI.markAllDropdownCardsAsRead();
  }

  // ─────────────────────────────────────────────
  // Initialize all UI elements on the current page
  // Safe to call multiple times (each binding guards against double-binding)
  // ─────────────────────────────────────────────
  function initializePageUI() {
    UI.bindMarkAllReadButton(markAllAsRead);
    UI.bindEventsBoardFilter(refreshEventsBoardFromApi);
    Popup.bindBellIconButton();
    Popup.bindSettingsPageButton();
    Popup.updateSettingsPageStatus();
  }

  // ─────────────────────────────────────────────
  // Boot: initialize everything and start connecting
  // Called on page load and on every SPA navigation
  // ─────────────────────────────────────────────
  function boot() {
    initializePageUI();
    connectToWebSocket();
    UI.updateBellBadge(state.unreadCount);

    // Load initial data from API when logged in
    var isLoggedIn = window.visionAPI
      && typeof window.visionAPI.isAuthenticated === 'function'
      && window.visionAPI.isAuthenticated();

    if (isLoggedIn) {
      if (window.visionAPI) loadOsPopupPreference();
      refreshDashboardFromApi();
      var currentDateRange = $('#vision-events-range').val() || 'all';
      refreshEventsBoardFromApi(currentDateRange);
    }
  }

  // ─────────────────────────────────────────────
  // Event listeners — react to app-level events
  // ─────────────────────────────────────────────

  // User logged in or out
  $(window).on('authStateChanged', function (event) {
    var userLoggedIn = event.originalEvent
      ? (event.originalEvent.detail && event.originalEvent.detail.loggedIn)
      : (event.detail && event.detail.loggedIn);

    if (userLoggedIn) {
      connectToWebSocket();
      refreshDashboardFromApi();
      var currentDateRange = $('#vision-events-range').val() || 'all';
      refreshEventsBoardFromApi(currentDateRange);
    } else {
      disconnectFromWebSocket();
    }
  });

  // SPA page navigation — re-run init for the new page
  $(window).on('vision:spa:navigated', function () {
    boot();
  });

  // User changed notification preferences in Settings
  $(window).on('vision:notification-prefs-updated', function (event) {
    var updatedPreferences = event.originalEvent ? event.originalEvent.detail : event.detail;
    if (updatedPreferences && updatedPreferences.channels) {
      var osPopupConfig = updatedPreferences.channels.os_popup || {};
      Popup.setUserPreference(osPopupConfig.enabled !== false);
    }
  });

  // ─────────────────────────────────────────────
  // Retry timer: keeps trying to connect every 1.5 seconds
  // until the WebSocket is established (e.g. user just logged in)
  // ─────────────────────────────────────────────
  var retryTimer = setInterval(function () {
    if (state.isConnected) {
      clearInterval(retryTimer);
      return;
    }
    connectToWebSocket();
  }, Constants.RETRY_CONNECT_INTERVAL_MS);

  // ─────────────────────────────────────────────
  // Run boot() now and also after DOM is ready
  // (layout-loader may inject this script mid-load)
  // ─────────────────────────────────────────────
  boot();
  $(document).ready(function () {
    boot();
  });

  // ─────────────────────────────────────────────
  // Public API
  // Other parts of the app can call these
  // ─────────────────────────────────────────────
  window.__visionNotifications = {
    getState: function () {
      return {
        unread     : state.unreadCount,
        events     : state.notificationsList.slice(),
        isConnected: state.isConnected,
      };
    },
    markAllRead     : markAllAsRead,
    requestPermission: Popup.requestPermissionOnUserClick,
    getPermission   : Popup.getPermissionStatus,
    updateOsNotifStatus: Popup.updateSettingsPageStatus,
  };

})(window.jQuery || window.$);
