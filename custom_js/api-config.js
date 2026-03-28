/**
 * API Configuration - Backend URL for Electron desktop app
 * Override VISION_API_BASE by setting window.VISION_API_BASE before this script loads.
 */
(function() {
  'use strict';

  var apiBase = 'https://api.samitweb.xyz';
  var jetsonBase = 'http://127.0.0.1:8001';

  if (typeof window !== 'undefined') {
    if (window.VISION_API_BASE) {
      apiBase = window.VISION_API_BASE;
    }
    window.VISION_API_BASE = apiBase;
    window.VISION_JETSON_BASE = jetsonBase;
  }
})();
