/**
 * Notification UI
 * ================
 * Updates everything the USER SEES using jQuery.
 *
 * This file ONLY handles the DOM (HTML on the page).
 * It does NOT handle WebSocket connections or data logic.
 *
 * What this file manages:
 *   - The bell badge number in the top bar
 *   - The notification dropdown list (bell icon cards)
 *   - The "Latest Events" section on the Dashboard
 *   - The Events Board grid
 *   - The Electron taskbar badge count
 *
 * jQuery used here so DOM updates are short and readable.
 * Example: $('#vision-notif-badge').text(count) instead of
 *           document.getElementById('vision-notif-badge').textContent = count
 *
 * Load order: THIRD (after notification-constants.js and notification-normalizer.js)
 */

window.VisionNotificationUI = (function ($) {
  'use strict';

  var Constants  = window.VisionNotificationConstants;
  var Normalizer = window.VisionNotificationNormalizer;

  // ─────────────────────────────────────────────
  // Helper: Build the severity badge HTML snippet
  // Returns: '<span class="badge ...">Critical</span>'
  // ─────────────────────────────────────────────
  function buildSeverityBadgeHtml(severity) {
    var badgeClass = Constants.BADGE_CLASS[severity] || 'badge-phoenix-info';
    return (
      '<span class="badge badge-phoenix fs-10 ' + badgeClass + '" data-bs-theme="light">' +
        Normalizer.escapeHtml(severity) +
      '</span>'
    );
  }

  // ─────────────────────────────────────────────
  // Helper: Build the small avatar HTML for the dropdown card
  // Events get an initial letter; system alerts get an icon
  // ─────────────────────────────────────────────
  function buildAvatarHtml(notification) {
    if (notification.notificationType === Constants.NOTIFICATION_TYPE.EVENT) {
      var initialLetter = (notification.title || 'N').trim().charAt(0).toUpperCase();
      return (
        '<div class="avatar avatar-m status-online me-3">' +
          '<div class="avatar-name rounded-circle">' +
            '<span>' + Normalizer.escapeHtml(initialLetter) + '</span>' +
          '</div>' +
        '</div>'
      );
    }

    // System notification (camera_offline, report_ready, etc.)
    return (
      '<div class="avatar avatar-m status-online me-3">' +
        '<div class="avatar-name rounded-circle bg-body-secondary d-flex align-items-center justify-content-center">' +
          '<i class="fa-solid ' + (notification.icon || 'fa-bell') + ' ' + (notification.iconColorClass || '') + '"></i>' +
        '</div>' +
      '</div>'
    );
  }

  // ─────────────────────────────────────────────
  // Build a single card for the bell dropdown list
  // Returns a jQuery element (not a string)
  //
  // Card shows: avatar | title + severity badge | timestamp | thumbnail
  // ─────────────────────────────────────────────
  function buildDropdownCard(notification) {
    var thumbnailUrl    = notification.thumbnailDataUrl || notification.thumbnailObjectUrl || null;
    var destinationHref = Normalizer.getNotificationHref(notification);
    var timeAgoText     = Normalizer.timeAgo(notification.timestamp);
    var fullTimestamp   = notification.timestamp
      ? Normalizer.escapeHtml(new Date(notification.timestamp).toLocaleString())
      : '';
    var notifKey = Normalizer.escapeHtml(notification.notificationId || notification.eventId || '');

    // Subtitle line: explains what the notification is about
    var subtitleText;
    if (notification.notificationType === Constants.NOTIFICATION_TYPE.CAMERA_OFFLINE) {
      subtitleText = 'Camera offline' + (notification.cameraId ? ' &bull; ' + Normalizer.escapeHtml(notification.cameraId) : '');
    } else if (notification.notificationType === Constants.NOTIFICATION_TYPE.REPORT_READY) {
      subtitleText = 'Report ready';
    } else {
      subtitleText = 'Event detected' + (notification.cameraId ? ' &bull; Camera ' + Normalizer.escapeHtml(notification.cameraId) : '');
    }

    // Thumbnail (only for events)
    var thumbnailHtml = '';
    if (notification.notificationType === Constants.NOTIFICATION_TYPE.EVENT) {
      thumbnailHtml = (
        '<div class="ms-3 flex-shrink-0">' +
          '<div class="rounded-2 overflow-hidden bg-body-secondary" style="width:84px;height:56px;position:relative;border:1px solid rgba(0,0,0,0.06);">' +
            '<img data-vision-thumb-id="' + notifKey + '" ' +
                 'src="' + (thumbnailUrl ? Normalizer.escapeHtml(thumbnailUrl) : '') + '" ' +
                 'alt="" style="width:100%;height:100%;object-fit:cover;display:' + (thumbnailUrl ? 'block' : 'none') + ';">' +
            '<div data-vision-thumb-fallback="' + notifKey + '" ' +
                 'class="d-flex align-items-center justify-content-center text-body-secondary" ' +
                 'style="width:100%;height:100%;display:' + (thumbnailUrl ? 'none' : 'flex') + ';">' +
              '<span class="fa-solid fa-image"></span>' +
            '</div>' +
          '</div>' +
        '</div>'
      );
    }

    // Build the full card element using jQuery
    var $card = $('<div>')
      .addClass('px-2 px-sm-3 py-3 notification-card position-relative unread border-bottom border-translucent');

    if (notifKey) {
      $card.attr('data-vision-notif-id', notifKey);
    }

    $card.html(
      '<div class="d-flex align-items-center justify-content-between position-relative">' +
        '<div class="d-flex align-items-center">' +
          buildAvatarHtml(notification) +
          '<div class="flex-1 me-sm-3">' +
            '<div class="d-flex align-items-center gap-2">' +
              '<h4 class="fs-9 text-body-emphasis mb-0">' + Normalizer.escapeHtml(notification.title) + '</h4>' +
              buildSeverityBadgeHtml(notification.severity) +
            '</div>' +
            '<p class="fs-9 text-body-highlight mb-2 fw-normal">' +
              subtitleText +
              (timeAgoText ? '<span class="ms-2 text-body-quaternary text-opacity-75 fw-bold fs-10">' + timeAgoText + '</span>' : '') +
            '</p>' +
            (fullTimestamp ? '<p class="text-body-secondary fs-9 mb-0"><span class="me-1 fas fa-clock"></span>' + fullTimestamp + '</p>' : '') +
          '</div>' +
        '</div>' +
        thumbnailHtml +
      '</div>' +
      '<a class="stretched-link" href="' + Normalizer.escapeHtml(destinationHref) + '"></a>'
    );

    return $card;
  }

  // ─────────────────────────────────────────────
  // Build a full-bleed event card for the Events Board grid
  // and the Dashboard "Latest Events" section
  //
  // Card shows: background image | severity badge | title | subtitle | icon + time
  // ─────────────────────────────────────────────
  function buildEventCard(notification, thumbnailUrl, options) {
    options = options || {};
    var isCompact   = options.compact === true;
    var cardHeight  = isCompact ? '170px' : '236px';
    var paddingClass = isCompact ? 'p-3' : 'p-4';
    var destinationHref = Normalizer.getNotificationHref(notification);
    var timeAgoText = Normalizer.timeAgo(notification.timestamp);

    // Subtitle shows camera ID, or a type-specific label
    var subtitleText;
    if (notification.cameraId) {
      subtitleText = 'Camera ' + Normalizer.escapeHtml(notification.cameraId);
    } else if (notification.notificationType === Constants.NOTIFICATION_TYPE.CAMERA_OFFLINE) {
      subtitleText = 'Camera Offline';
    } else if (notification.notificationType === Constants.NOTIFICATION_TYPE.REPORT_READY) {
      subtitleText = 'Report';
    } else {
      subtitleText = 'Event';
    }

    // Background: either the event thumbnail or a grey placeholder
    var backgroundHtml = thumbnailUrl
      ? '<img src="' + Normalizer.escapeHtml(thumbnailUrl) + '" alt="" class="w-100 h-100 position-absolute top-0 start-0" style="object-fit:cover;">'
      : '<div class="w-100 h-100 position-absolute top-0 start-0 bg-body-secondary"></div>';

    return (
      '<div class="btn-reveal-trigger position-relative rounded-2 overflow-hidden ' + paddingClass + '" style="height:' + cardHeight + ';">' +
        backgroundHtml +
        '<div class="w-100 h-100 position-absolute top-0 start-0" ' +
             'style="background: linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%);"></div>' +
        '<div class="position-relative h-100 d-flex flex-column justify-content-between">' +
          '<div class="d-flex justify-content-between align-items-center">' +
            buildSeverityBadgeHtml(notification.severity) +
          '</div>' +
          '<div>' +
            '<h3 class="text-white fw-bold line-clamp-2 mb-1">' + Normalizer.escapeHtml(notification.title) + '</h3>' +
            '<p class="text-white text-opacity-75 fs-9 mb-0">' + subtitleText + '</p>' +
            '<div class="d-flex align-items-center mt-2">' +
              '<span class="fa-solid ' + (notification.icon || 'fa-video') + ' text-white text-opacity-75 me-2 fs-10"></span>' +
              '<span class="text-white text-opacity-75 fs-9">' + (timeAgoText || '') + '</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<a class="stretched-link" href="' + Normalizer.escapeHtml(destinationHref) + '"></a>' +
      '</div>'
    );
  }

  // ─────────────────────────────────────────────
  // Update the red badge number on the bell icon
  // Shows number when unread > 0, hides when 0
  // ─────────────────────────────────────────────
  function updateBellBadge(unreadCount) {
    var $badge = $('#vision-notif-badge');
    if ($badge.length === 0) return;

    $badge.text(String(unreadCount));
    if (unreadCount > 0) {
      $badge.removeClass('d-none');
    } else {
      $badge.addClass('d-none');
    }
  }

  // ─────────────────────────────────────────────
  // Update the Electron taskbar / dock badge
  // (Shows the number on the app icon in the OS taskbar)
  // ─────────────────────────────────────────────
  function updateElectronBadge(unreadCount) {
    if (window.electronAPI && typeof window.electronAPI.setBadgeCount === 'function') {
      try {
        window.electronAPI.setBadgeCount(unreadCount);
      } catch (error) {
        // Ignore — not all Electron versions support badge counts
      }
    }
  }

  // ─────────────────────────────────────────────
  // Add a new notification card to the TOP of the dropdown list
  // Also clears the "No notifications yet" placeholder on first call
  // ─────────────────────────────────────────────
  function prependCardToDropdown(notification) {
    var $list = $('#vision-notif-list');
    if ($list.length === 0) return;

    // Remove the "No notifications yet" placeholder the first time
    $('#vision-notif-empty').remove();

    var $card = buildDropdownCard(notification);
    $list.prepend($card);
  }

  // ─────────────────────────────────────────────
  // When the thumbnail image is loaded later from the API,
  // update the existing card in the dropdown to show it
  // ─────────────────────────────────────────────
  function updateDropdownCardThumbnail(notificationId, thumbnailUrl) {
    if (!notificationId || !thumbnailUrl) return;

    var escapedId = CSS.escape(String(notificationId));
    var $image    = $('[data-vision-thumb-id="' + escapedId + '"]');
    var $fallback = $('[data-vision-thumb-fallback="' + escapedId + '"]');

    if ($image.length > 0) {
      $image.attr('src', thumbnailUrl).show();
    }
    if ($fallback.length > 0) {
      $fallback.hide();
    }
  }

  // ─────────────────────────────────────────────
  // Mark all dropdown cards as "read" (grey them out)
  // and reset the bell badge to 0
  // ─────────────────────────────────────────────
  function markAllDropdownCardsAsRead() {
    $('#vision-notif-list .notification-card.unread')
      .removeClass('unread')
      .addClass('read');
  }

  // ─────────────────────────────────────────────
  // Update the "Latest Events" section on the Dashboard
  // Shows the 4 most recent events as compact cards in a row
  // ─────────────────────────────────────────────
  function renderLatestEventsSection(notificationsList) {
    var $container = $('#vision-latest-events');
    if ($container.length === 0) return;

    var latestFour = notificationsList.slice(0, 4);

    var cardsHtml = latestFour.map(function (notification) {
      var thumbnailUrl = notification.thumbnailDataUrl || notification.thumbnailObjectUrl || null;
      var cardHtml = buildEventCard(notification, thumbnailUrl, { compact: true });
      return '<div class="flex-shrink-0" style="width: 280px;">' + cardHtml + '</div>';
    }).join('');

    $container.html(cardsHtml);
  }

  // ─────────────────────────────────────────────
  // Update the full Events Board grid
  // Shows all events as large cards in a responsive grid
  // ─────────────────────────────────────────────
  function renderEventsBoardGrid(notificationsList) {
    var $grid = $('#vision-events-board-grid');
    if ($grid.length === 0) return;

    // Update the count display (filtered rows)
    $('#vision-events-count').text(String(notificationsList.length));

    var cardsHtml = notificationsList.map(function (notification) {
      var thumbnailUrl = notification.thumbnailDataUrl || notification.thumbnailObjectUrl || null;
      var cardHtml = buildEventCard(notification, thumbnailUrl, { compact: false });
      return '<div class="col-12 col-sm-6 col-md-4 col-xxl-3">' + cardHtml + '</div>';
    }).join('');

    $grid.html(cardsHtml);
  }

  /**
   * Update severity tab counts on Events Board (after camera + search + timeline scope, before severity tab).
   * counts: { all, Critical, Warning, Info, Resolved }
   */
  function updateEventsBoardSeverityTabCounts(counts) {
    var c = counts || {};
    var map = [
      ['all', 'vision-events-cnt-all'],
      ['Critical', 'vision-events-cnt-critical'],
      ['Warning', 'vision-events-cnt-warning'],
      ['Info', 'vision-events-cnt-info'],
      ['Resolved', 'vision-events-cnt-resolved'],
    ];
    map.forEach(function (pair) {
      var key = pair[0];
      var id = pair[1];
      var n = c[key];
      if (n === undefined || n === null) n = 0;
      var $el = $('#' + id);
      if ($el.length) $el.text(String(n));
    });
  }

  // ─────────────────────────────────────────────
  // Wire up the "Mark all as read" button click handler
  // Runs once (guards against double-binding on SPA navigation)
  // ─────────────────────────────────────────────
  function bindMarkAllReadButton(onClickCallback) {
    var $button = $('#vision-notif-mark-read');
    if ($button.length === 0) return;
    if ($button.data('vision-bound') === true) return;

    $button.data('vision-bound', true);
    $button.on('click', function () {
      markAllDropdownCardsAsRead();
      if (typeof onClickCallback === 'function') {
        onClickCallback();
      }
    });
  }

  // ─────────────────────────────────────────────
  // Wire up the Events Board date range dropdown filter (legacy id: vision-events-range)
  // ─────────────────────────────────────────────
  function bindEventsBoardFilter(onChangeCallback) {
    var $filterSelect = $('#vision-events-range');
    if ($filterSelect.length === 0) return;
    if ($filterSelect.data('vision-bound') === true) return;

    $filterSelect.data('vision-bound', true);
    $filterSelect.on('change', function () {
      if (typeof onChangeCallback === 'function') {
        onChangeCallback($filterSelect.val());
      }
    });
  }

  /** Latest handler for delegated Events Board filter events (updated each hub boot; single document delegation). */
  var eventsBoardFilterHandler = null;
  var eventsBoardSearchTimer = null;

  (function installEventsBoardFilterDelegationOnce() {
    if (window.__visionEventsBoardDelegationInstalled) return;
    window.__visionEventsBoardDelegationInstalled = true;

    $(document).on('change.visionEventsBoard', '#vision-events-timeline', function () {
      if (typeof eventsBoardFilterHandler === 'function') eventsBoardFilterHandler({ source: 'timeline' });
    });
    $(document).on('change.visionEventsBoard', '#vision-events-filter-camera', function () {
      if (typeof eventsBoardFilterHandler === 'function') eventsBoardFilterHandler({ source: 'camera' });
    });
    $(document).on('input.visionEventsBoard', '#vision-events-search', function () {
      clearTimeout(eventsBoardSearchTimer);
      eventsBoardSearchTimer = setTimeout(function () {
        if (typeof eventsBoardFilterHandler === 'function') eventsBoardFilterHandler({ source: 'search' });
      }, 180);
    });
    $(document).on('click.visionEventsBoard', '#vision-events-severity-tabs .nav-link[data-severity]', function (e) {
      e.preventDefault();
      var $t = $(this);
      $('#vision-events-severity-tabs .nav-link').removeClass('active');
      $t.addClass('active');
      if (typeof eventsBoardFilterHandler === 'function') eventsBoardFilterHandler({ source: 'severity' });
    });
    $(document).on('click.visionEventsBoard', '#vision-events-filters-clear', function () {
      if (typeof eventsBoardFilterHandler === 'function') eventsBoardFilterHandler({ source: 'clear' });
    });
  })();

  /**
   * Wire Events Board filters: timeline, camera, search, severity tabs, clear.
   * onAction({ source: 'timeline'|'camera'|'search'|'severity'|'clear' })
   */
  function bindEventsBoardFilters(onAction) {
    if ($('#vision-events-board-grid').length === 0) return;
    eventsBoardFilterHandler = onAction;
  }

  // ─────────────────────────────────────────────
  // Public API — functions other files can call
  // ─────────────────────────────────────────────
  var publicAPI = {
    updateBellBadge              : updateBellBadge,
    updateElectronBadge          : updateElectronBadge,
    prependCardToDropdown        : prependCardToDropdown,
    updateDropdownCardThumbnail  : updateDropdownCardThumbnail,
    markAllDropdownCardsAsRead   : markAllDropdownCardsAsRead,
    renderLatestEventsSection    : renderLatestEventsSection,
    renderEventsBoardGrid        : renderEventsBoardGrid,
    updateEventsBoardSeverityTabCounts: updateEventsBoardSeverityTabCounts,
    bindMarkAllReadButton        : bindMarkAllReadButton,
    bindEventsBoardFilter        : bindEventsBoardFilter,
    bindEventsBoardFilters       : bindEventsBoardFilters,
    buildEventCard               : buildEventCard,
    buildDropdownCard            : buildDropdownCard,
  };

  // Also patch the backward-compat shim in VisionNotificationDisplay
  if (window.VisionNotificationDisplay) {
    window.VisionNotificationDisplay.renderTopbarCard = buildDropdownCard;
    window.VisionNotificationDisplay.renderEventCard  = buildEventCard;
  }

  return publicAPI;

})(window.jQuery || window.$);
