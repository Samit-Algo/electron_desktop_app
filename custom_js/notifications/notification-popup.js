/**
 * Notification Popup
 * ===================
 * Handles native OS desktop notification popups.
 *
 * These are the small notification boxes that appear in the corner
 * of your screen (Windows Action Center, macOS notification center, etc.)
 * even when the app window is not focused.
 *
 * This uses the browser's built-in "Web Notification API":
 *   https://developer.mozilla.org/en-US/docs/Web/API/Notifications_API
 *
 * What this file does:
 *   - Asks the user for permission to show OS popups
 *   - Shows a popup for each new notification (with rate limiting)
 *   - Updates the Settings page "OS Notifications" status badge and button
 *   - Respects the user's setting to disable OS popups
 *
 * Load order: FOURTH (after notification-constants.js, normalizer, ui)
 */

window.VisionNotificationPopup = (function ($) {
  'use strict';

  var Constants = window.VisionNotificationConstants;

  // Tracks when we last showed an OS popup — prevents spamming
  var lastPopupShownAtMs = 0;

  // Whether the user wants OS popups (loaded from their preferences)
  var userHasEnabledOsPopups = true;

  // ─────────────────────────────────────────────
  // Helper: get the app favicon URL to use as the popup icon
  // ─────────────────────────────────────────────
  function getAppIconUrl() {
    try {
      var faviconLink = document.querySelector('link[rel="icon"]');
      if (faviconLink && faviconLink.href) return faviconLink.href;
      return new URL('../assets/img/favicons/favicon-32x32.png', window.location.href).href;
    } catch (error) {
      return '';
    }
  }

  // ─────────────────────────────────────────────
  // Check if the browser supports the Notification API
  // Returns true/false
  // ─────────────────────────────────────────────
  function isBrowserNotificationSupported() {
    return 'Notification' in window;
  }

  // ─────────────────────────────────────────────
  // Get the current permission state
  // Returns: "granted" | "denied" | "default" | "unsupported"
  // ─────────────────────────────────────────────
  function getPermissionStatus() {
    if (!isBrowserNotificationSupported()) return 'unsupported';
    return Notification.permission;
  }

  // ─────────────────────────────────────────────
  // Silently request permission on page load
  // (This is "best-effort" — browser may ignore it without user gesture)
  // ─────────────────────────────────────────────
  function requestPermissionSilently() {
    if (!isBrowserNotificationSupported()) return;
    if (Notification.permission === 'default') {
      try {
        Notification.requestPermission().then(function () {}).catch(function () {});
      } catch (error) {
        // Ignore — older browser API version
      }
    }
  }

  // ─────────────────────────────────────────────
  // Request permission when the user clicks a button
  // (Must be triggered by a user action like a click)
  // ─────────────────────────────────────────────
  function requestPermissionOnUserClick() {
    if (!isBrowserNotificationSupported()) {
      console.warn('[NotificationPopup] Web Notification API not supported in this browser');
      return;
    }

    if (Notification.permission !== 'default') {
      console.log('[NotificationPopup] Permission already', Notification.permission);
      return;
    }

    try {
      Notification.requestPermission().then(function (permissionResult) {
        console.log('[NotificationPopup] Permission result:', permissionResult);

        if (permissionResult === 'granted') {
          // Show a success toast if VisionToast is available
          var toastService = window.toastService || window.VisionToast;
          if (toastService && typeof toastService.success === 'function') {
            try { toastService.success('Desktop notifications enabled'); } catch (e) {}
          }

          // Tell the rest of the app permission changed
          window.dispatchEvent(new CustomEvent('vision:notification-permission-changed', {
            detail: { permission: permissionResult }
          }));
        }

      }).catch(function (requestError) {
        console.warn('[NotificationPopup] Permission request failed:', requestError);
      });
    } catch (error) {
      console.warn('[NotificationPopup] requestPermission exception:', error);
    }
  }

  // ─────────────────────────────────────────────
  // Show a native OS popup notification
  //
  // Rate limited: won't show more than one every 1.5 seconds
  // Also skips if user disabled OS popups in Settings
  // ─────────────────────────────────────────────
  function showPopup(notification) {
    if (!isBrowserNotificationSupported()) return;
    if (Notification.permission !== 'granted') return;
    if (!userHasEnabledOsPopups) return;

    // Rate limiting — prevent popup spam
    var currentTimeMs = Date.now();
    if (currentTimeMs - lastPopupShownAtMs < Constants.OS_POPUP_RATE_LIMIT_MS) return;
    lastPopupShownAtMs = currentTimeMs;

    var popupTitle  = notification.severity + ': ' + notification.title;
    var popupBody   = '';

    if (notification.cameraId) {
      popupBody = 'Camera ' + notification.cameraId;
    } else if (notification.notificationType === Constants.NOTIFICATION_TYPE.REPORT_READY) {
      popupBody = notification.body || 'Report is ready';
    } else {
      popupBody = notification.body || '';
    }

    var isSilent = (notification.severity === Constants.SEVERITY.INFO);
    var appIconUrl = getAppIconUrl();

    var popupOptions = {
      body   : popupBody,
      silent : isSilent,
    };
    if (appIconUrl) popupOptions.icon = appIconUrl;

    try {
      var nativePopup = new Notification(popupTitle, popupOptions);

      // When user clicks the popup, navigate to the relevant page
      nativePopup.onclick = function () {
        try { window.focus(); } catch (error) {}
        var destinationUrl = window.VisionNotificationNormalizer.getNotificationHref(notification);
        try {
          if (destinationUrl && destinationUrl !== '#') {
            window.location.href = destinationUrl;
          }
        } catch (navigationError) {}
      };
    } catch (popupError) {
      console.warn('[NotificationPopup] OS popup failed:', popupError);
    }
  }

  // ─────────────────────────────────────────────
  // Update the OS notification status badge and button
  // on the Settings → Notifications page
  // ─────────────────────────────────────────────
  function updateSettingsPageStatus() {
    var $statusBadge  = $('#osNotifStatus');
    var $enableButton = $('#btnEnableOsNotifications');
    if ($statusBadge.length === 0) return;

    var currentPermission = getPermissionStatus();

    if (currentPermission === 'unsupported') {
      $statusBadge.text('Not supported').attr('class', 'badge badge-phoenix fs-10 mb-2 badge-phoenix-secondary');
      $enableButton.hide();

    } else if (currentPermission === 'granted') {
      $statusBadge.text('Enabled').attr('class', 'badge badge-phoenix fs-10 mb-2 badge-phoenix-success');
      $enableButton
        .html('<span class="fas fa-check me-1"></span>Enabled')
        .prop('disabled', true)
        .removeClass('btn-phoenix-primary').addClass('btn-phoenix-success')
        .show();

    } else {
      // "denied" or "default" — not yet enabled
      $statusBadge.text('Disabled').attr('class', 'badge badge-phoenix fs-10 mb-2 badge-phoenix-warning');
      $enableButton
        .html('<span class="fas fa-bell me-1"></span>Enable')
        .prop('disabled', false)
        .removeClass('btn-phoenix-success').addClass('btn-phoenix-primary')
        .show();
    }
  }

  // ─────────────────────────────────────────────
  // Wire up the Settings page "Enable" button
  // Runs once per page load (guards against double-binding)
  // ─────────────────────────────────────────────
  function bindSettingsPageButton() {
    var $enableButton = $('#btnEnableOsNotifications');
    if ($enableButton.length === 0) return;
    if ($enableButton.data('vision-bound') === true) return;

    $enableButton.data('vision-bound', true);
    $enableButton.on('click', function () {
      requestPermissionOnUserClick();

      // Re-check status after permission dialog closes
      $(window).one('vision:notification-permission-changed', function () {
        updateSettingsPageStatus();
      });
      setTimeout(updateSettingsPageStatus, 1000);
    });
  }

  // ─────────────────────────────────────────────
  // Wire up the bell icon to request permission on click
  // (first-time users see the permission dialog when they click the bell)
  // ─────────────────────────────────────────────
  function bindBellIconButton() {
    var $bellButton = $('#vision-notif-bell');
    if ($bellButton.length === 0) return;
    if ($bellButton.data('vision-bell-bound') === true) return;

    $bellButton.data('vision-bell-bound', true);
    $bellButton.on('click', requestPermissionOnUserClick);
  }

  // ─────────────────────────────────────────────
  // Update the user's OS popup preference
  // Called when user changes the toggle in Settings
  // ─────────────────────────────────────────────
  function setUserPreference(isEnabled) {
    userHasEnabledOsPopups = (isEnabled !== false);
  }

  // ─────────────────────────────────────────────
  // Public API
  // ─────────────────────────────────────────────
  return {
    requestPermissionSilently : requestPermissionSilently,
    requestPermissionOnUserClick: requestPermissionOnUserClick,
    showPopup                 : showPopup,
    getPermissionStatus       : getPermissionStatus,
    isBrowserNotificationSupported: isBrowserNotificationSupported,
    updateSettingsPageStatus  : updateSettingsPageStatus,
    bindSettingsPageButton    : bindSettingsPageButton,
    bindBellIconButton        : bindBellIconButton,
    setUserPreference         : setUserPreference,
  };

})(window.jQuery || window.$);
