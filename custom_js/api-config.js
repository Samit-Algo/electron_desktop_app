/**
 * API Configuration - Backend URL for Electron desktop app
 * Override VISION_API_BASE by setting window.VISION_API_BASE before this script loads.
  * Override WORKFLOW_CHAT_API_BASE for the Watch Dog workflow chat agent.
 *
 * Optional workflow chat (pages/workflow-editor.html), set on window before load if needed:
 * - WORKFLOW_CHAT_VERBOSE (boolean) — send verbose: true on POST /api/workflow/generate
 * - WORKFLOW_CHAT_INCLUDE_PREVIOUS (boolean) — also send previous_workflow / previous_plan (SPA mode; default uses session_id only)
 * - WORKFLOW_CHAT_SEND_HISTORY (boolean) — send conversation_history from client turns
 */
(function() {
  'use strict';

  var apiBase = 'https://api.samitweb.xyz';
  var jetsonBase = 'http://127.0.0.1:8001';
  // By default, workflow chat is served from the same API base as the rest of the app.
  var workflowChatBase = apiBase;

  if (typeof window !== 'undefined') {
    if (window.VISION_API_BASE) {
      apiBase = window.VISION_API_BASE;
    }
    // Keep workflow chat base in sync unless explicitly overridden.
    workflowChatBase = apiBase;
    if (window.WORKFLOW_CHAT_API_BASE) {
      workflowChatBase = window.WORKFLOW_CHAT_API_BASE;
    }
    window.VISION_API_BASE = apiBase;
    window.VISION_JETSON_BASE = jetsonBase;
    window.WORKFLOW_CHAT_API_BASE = workflowChatBase;
  }
})();
