/**
 * CHATBOT CORE MODULE
 * ====================
 * This is the main controller for the chatbot. It coordinates everything.
 *
 * WHAT IT DOES (simple flow):
 * 1. LAYOUT  - Resizes the chat panel, handles open/close
 * 2. TABS    - Creates/switches chat tabs (like browser tabs)
 * 3. COMPOSER - Text input, send/voice button, Enter key
 * 4. MESSAGES - Sends user text, shows AI response, handles streaming
 * 5. DELEGATES - Calls other modules for markdown, zones, flow charts, voice
 *
 * Other modules it uses: ChatbotMarkdown, ChatbotZoneEditor, ChatbotFlowDiagram, ChatbotVoice
 */
(function () {
  'use strict';

  // ============================================================================
  // SECTION 1: PATH & SCRIPT LOADING HELPERS
  // ============================================================================

  /** Build full URL for a file inside /vendors/ folder */
  function getVendorScriptPath(pathFromVendors) {
    return new URL('/vendors/' + pathFromVendors, window.location.origin).toString();
  }

  /** Load a script by URL. Does nothing if already loaded. */
  function loadScriptOnce(scriptUrl) {
    return new Promise((resolve, reject) => {
      try {
        const existing = document.querySelector(`script[src="${scriptUrl}"]`);
        if (existing) return resolve();
        const scriptEl = document.createElement('script');
        scriptEl.src = scriptUrl;
        scriptEl.defer = true;
        scriptEl.onload = () => resolve();
        scriptEl.onerror = () => reject(new Error(`Failed to load script: ${scriptUrl}`));
        document.head.appendChild(scriptEl);
      } catch (e) {
        reject(e);
      }
    });
  }

  /** Ask ChatbotMarkdown module to load its libraries (marked, DOMPurify) */
  function ensureMarkdownDeps() {
    if (window.ChatbotMarkdown && typeof window.ChatbotMarkdown.ensureMarkdownDeps === 'function') {
      return window.ChatbotMarkdown.ensureMarkdownDeps();
    }
    return Promise.resolve();
  }

  /** Load scripts needed for flow diagrams (Rete.js style) */
  function ensureReteFlowRenderer() {
    if (window.reteFlowRenderer && window.flowTransforms) return Promise.resolve();
    const transformsSrc = new URL('/custom_js/flow-transforms.js', window.location.origin).toString();
    const rendererSrc = new URL('/custom_js/rete-flow-renderer.js', window.location.origin).toString();
    return loadScriptOnce(transformsSrc)
      .then(() => loadScriptOnce(rendererSrc))
      .catch(function () {});
  }

  /** Flag: true while layout is changing (blocks chart resize to avoid bugs) */
  let layoutSettling = false;

  // ============================================================================
  // SECTION 2: LAYOUT & RESIZE (chat panel width, open/close, drag handle)
  // ============================================================================

  /** Set up the chatbot panel: width, resize handle, open/close behavior */
  function initChatbotLayout() {
    const chatbotOffcanvas = document.getElementById('chatbot-offcanvas');
    const viewportElement = document.querySelector('.viewport-scrolls');
    const contentElement = document.querySelector('.content');
    const appRootElement = document.getElementById('app-root');

    if (!chatbotOffcanvas || !appRootElement) return;

    // Chatbot width constants
    const DEFAULT_CHATBOT_WIDTH = 400;
    const MIN_CHATBOT_WIDTH = 400;
    const MAX_CHATBOT_WIDTH = 1200;

    // Hysteresis thresholds to prevent flip-flopping during resize
    const EXPAND_AT = 420;
    const COLLAPSE_AT = 380;
    let expandedState = false;

    // Retrieve saved chatbot width from localStorage or use default
    function getChatbotWidth() {
      const saved = localStorage.getItem('chatbotWidth');
      return saved ? parseInt(saved, 10) : DEFAULT_CHATBOT_WIDTH;
    }

    // Persist chatbot width to localStorage
    function saveChatbotWidth(width) {
      localStorage.setItem('chatbotWidth', width.toString());
    }

    // Update chatbot width, CSS variables, and layout behavior
    function setChatbotWidth(width) {
      width = Math.max(MIN_CHATBOT_WIDTH, Math.min(MAX_CHATBOT_WIDTH, width));
      chatbotOffcanvas.style.width = width + 'px';
      appRootElement.style.setProperty('--chatbot-width', width + 'px');
      const excess = Math.max(0, width - DEFAULT_CHATBOT_WIDTH);
      appRootElement.style.setProperty('--chatbot-excess', excess + 'px');
      saveChatbotWidth(width);
      updateLayoutBehavior(width);
    }

    // Update layout classes based on chatbot width (expanded vs default mode)
    function updateLayoutBehavior(chatbotWidth) {
      if (!contentElement) return;

      // Update expanded state with hysteresis to prevent flickering
      if (!expandedState && chatbotWidth >= EXPAND_AT) {
        expandedState = true;
      } else if (expandedState && chatbotWidth <= COLLAPSE_AT) {
        expandedState = false;
      }

      if (expandedState) {
        // Expanded mode: viewport scrolls horizontally, content width stays stable
        appRootElement.classList.add('chatbot-open', 'chatbot-expanded');
        if (viewportElement) viewportElement.classList.add('chatbot-expanded');
        contentElement.classList.add('chatbot-expanded');
      } else {
        // Default mode: grid handles sizing automatically
        appRootElement.classList.add('chatbot-open');
        appRootElement.classList.remove('chatbot-expanded');
        if (viewportElement) viewportElement.classList.remove('chatbot-expanded');
        contentElement.style.minWidth = '';
        contentElement.classList.remove('chatbot-expanded');
      }
    }

    // Update layout state when chatbot opens/closes
    function updateLayoutState(isOpen) {
      if (isOpen) {
        const currentWidth = getChatbotWidth();
        expandedState = currentWidth > DEFAULT_CHATBOT_WIDTH;
        setChatbotWidth(currentWidth);
      } else {
        expandedState = false;
        appRootElement.classList.remove('chatbot-open', 'chatbot-expanded');
        appRootElement.style.setProperty('--chatbot-width', '0px');
        appRootElement.style.setProperty('--chatbot-excess', '0px');
        if (viewportElement) viewportElement.classList.remove('chatbot-expanded');
        if (contentElement) {
          contentElement.classList.remove('chatbot-expanded');
          contentElement.style.minWidth = '';
        }
      }
    }

    // Initialize drag-to-resize functionality for chatbot panel
    function initChatbotResize() {
      const resizeHandle = document.getElementById('chatbot-resize-handle');
      if (!resizeHandle || !chatbotOffcanvas) return;

      let isResizing = false;
      let startX = 0;
      let startWidth = 0;

      // Detect RTL layout direction
      function getIsRTL() {
        return document.documentElement.getAttribute('dir') === 'rtl';
      }

      // Start resize on mousedown
      resizeHandle.addEventListener('mousedown', function (e) {
        if (!chatbotOffcanvas.classList.contains('show')) return;
        isResizing = true;
        startX = e.clientX;
        startWidth = parseInt(window.getComputedStyle(chatbotOffcanvas).width, 10);
        document.body.classList.add('chatbot-resizing');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
        e.stopPropagation();
      });

      // Update width during mouse move
      document.addEventListener('mousemove', function (e) {
        if (!isResizing) return;
        const isRTL = getIsRTL();
        // Invert deltaX for right-side offcanvas (dragging left increases width)
        let deltaX = isRTL ? (e.clientX - startX) : (startX - e.clientX);
        let rawWidth = startWidth + deltaX;

        // Snap close if dragged below threshold
        const CLOSE_THRESHOLD = 250;
        if (rawWidth < CLOSE_THRESHOLD) {
          isResizing = false;
          document.body.classList.remove('chatbot-resizing');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';
          const bsOffcanvas = bootstrap.Offcanvas.getInstance(chatbotOffcanvas);
          if (bsOffcanvas) bsOffcanvas.hide();
          return;
        }

        // Clamp to minimum width for visual feedback
        if (rawWidth < MIN_CHATBOT_WIDTH) {
          rawWidth = MIN_CHATBOT_WIDTH;
        }

        setChatbotWidth(rawWidth);
        e.preventDefault();
      });

      // Clean up on mouseup and dispatch layout-settled event for charts
      document.addEventListener('mouseup', function () {
        if (isResizing) {
          isResizing = false;
          document.body.classList.remove('chatbot-resizing');
          document.body.style.cursor = '';
          document.body.style.userSelect = '';

          // Block chart resizing during CSS transition to prevent invalid dimensions
          layoutSettling = true;
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                layoutSettling = false;
                document.dispatchEvent(new Event('chatbot:layout-settled'));
              });
            });
          });
        }
      });

      // Prevent text selection and drag during resize
      resizeHandle.addEventListener('selectstart', function (e) {
        e.preventDefault();
        return false;
      });
      resizeHandle.addEventListener('dragstart', function (e) {
        e.preventDefault();
        return false;
      });
    }

    // Initialize width from localStorage before any show events
    const initialWidth = getChatbotWidth();
    chatbotOffcanvas.style.width = initialWidth + 'px';
    appRootElement.style.setProperty('--chatbot-width', initialWidth + 'px');
    const excess = Math.max(0, initialWidth - DEFAULT_CHATBOT_WIDTH);
    appRootElement.style.setProperty('--chatbot-excess', excess + 'px');

    // Handle Bootstrap offcanvas show/hide events
    chatbotOffcanvas.addEventListener('show.bs.offcanvas', function (e) {
      const savedWidth = getChatbotWidth();
      setChatbotWidth(savedWidth);
      updateLayoutState(true);
      localStorage.setItem('chatbotOpen', 'true');
    });

    chatbotOffcanvas.addEventListener('shown.bs.offcanvas', function () {
      const savedWidth = getChatbotWidth();
      setChatbotWidth(savedWidth);
      localStorage.setItem('chatbotOpen', 'true');
    });

    chatbotOffcanvas.addEventListener('hide.bs.offcanvas', function (e) {
      if (window.innerWidth <= 991) {
        var active = document.activeElement;
        if (active && chatbotOffcanvas.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
          e.preventDefault();
          return;
        }
      }
      updateLayoutState(false);
      localStorage.setItem('chatbotOpen', 'false');
    });

    chatbotOffcanvas.addEventListener('hidden.bs.offcanvas', function () {
      updateLayoutState(false);
      localStorage.setItem('chatbotOpen', 'false');
    });

    // Handle case where chatbot is already shown on page load
    if (chatbotOffcanvas.classList.contains('show')) {
      const savedWidth = getChatbotWidth();
      chatbotOffcanvas.style.width = savedWidth + 'px';
      updateLayoutBehavior(savedWidth);
      updateLayoutState(true);
    }

    initChatbotResize();
  }

  // ============================================================================
  // SECTION 3: COMPOSER (text input, auto-resize, send/voice button states)
  // ============================================================================

  /** Set up the text input: auto-resize, Enter to send, send/voice button switching */
  function initChatbotComposer() {
    const textarea = document.getElementById('chatbot-input');
    const sendBtn = document.querySelector('#chatbot-offcanvas .send-btn');
    if (!textarea) return;

    // Auto-resize textarea to fit content (max 4 lines)
    function autosize() {
      textarea.style.height = 'auto';
      const cs = window.getComputedStyle(textarea);
      const lh = parseFloat(cs.lineHeight);
      const lineHeight = Number.isFinite(lh) ? lh : 16;
      const pt = parseFloat(cs.paddingTop) || 0;
      const pb = parseFloat(cs.paddingBottom) || 0;
      const max = (lineHeight * 4) + pt + pb;
      const next = Math.min(textarea.scrollHeight, max);
      textarea.style.height = next + 'px';
    }

    // Update send button visual state (voice/send/stop icons)
    function updateButtonState() {
      if (!sendBtn) return;
      // Don't override if button is in special state (handled by voice module)
      if (sendBtn.classList.contains('recording') || sendBtn.classList.contains('streaming')) {
        return;
      }
      const hasText = textarea.value.trim().length > 0;
      const voiceIcon = sendBtn.querySelector('.voice-icon');
      const sendIcon = sendBtn.querySelector('.send-icon');
      const stopIcon = sendBtn.querySelector('.stop-icon');

      if (hasText) {
        // Show send button when textarea has content
        sendBtn.classList.remove('voice-assistant-state');
        sendBtn.setAttribute('aria-label', 'Send Message');
        sendBtn.setAttribute('title', 'Send');
        if (voiceIcon) voiceIcon.style.display = 'none';
        if (sendIcon) sendIcon.style.display = 'flex';
        if (stopIcon) stopIcon.style.display = 'none';
      } else {
        // Show voice assistant button when textarea is empty
        sendBtn.classList.add('voice-assistant-state');
        sendBtn.setAttribute('aria-label', 'Voice Assistant');
        sendBtn.setAttribute('title', 'Voice Assistant');
        if (voiceIcon) voiceIcon.style.display = 'flex';
        if (sendIcon) sendIcon.style.display = 'none';
        if (stopIcon) stopIcon.style.display = 'none';
      }
    }

    // Update button state and textarea size on input
    textarea.addEventListener('input', function () {
      autosize();
      updateButtonState();
    });
    autosize();
    updateButtonState();

    // Enter key sends message, Shift+Enter creates newline
    textarea.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      if (e.shiftKey) return;
      e.preventDefault();
      if (textarea.value.trim().length > 0 && sendBtn) {
        sendBtn.click();
      }
    });
  }

  // ============================================================================
  // SECTION 4: TABS & MESSAGING (tabs, send message, stream response, HITL)
  // ============================================================================

  /** Set up tabs, message sending, streaming, approval cards, zone editor */
  function initChatbotTabs() {
    const chatbotOffcanvas = document.getElementById('chatbot-offcanvas');
    const tabsEl = document.getElementById('chatbot-tabs');
    const newTabBtn = document.getElementById('chatbot-new-tab');
    const messagesEl = chatbotOffcanvas?.querySelector?.('.chat-messages');
    const textarea = document.getElementById('chatbot-input');
    const sendBtn = chatbotOffcanvas?.querySelector?.('.send-btn');
    const modeLabel = document.getElementById('chatbot-mode-label');
    const voiceBtn = document.getElementById('chatbot-voice-btn');

    if (!chatbotOffcanvas || !tabsEl || !messagesEl) return;

    // Preload markdown and flow renderer dependencies
    ensureMarkdownDeps();
    ensureReteFlowRenderer();

    // Get display name for welcome message (visionAPI.user or #user-name or fallback)
    function getChatbotUsername() {
      const u = window.visionAPI?.user;
      if (u && (u.full_name || u.email)) return u.full_name || u.email;
      const el = document.getElementById('user-name');
      if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
      return 'User';
    }

    // Build welcome message HTML (shown in center until first message is sent)
    function getWelcomeHtml() {
      const name = getChatbotUsername();
      const greeting = getTimeBasedGreeting();
      return (
        '<div class="chatbot-welcome-wrap" data-chatbot-welcome>'
        + '<p class="chatbot-welcome-msg">'
        + '<span class="chatbot-welcome-icon fas fa-asterisk" aria-hidden="true"></span>'
        + escapeHtml(greeting + ', ' + name)
        + '</p></div>'
      );
    }

    function getTimeBasedGreeting() {
      const h = new Date().getHours();
      if (h < 12) return 'Good morning';
      if (h < 17) return 'Good afternoon';
      return 'Good evening';
    }

    // Initial content for new/empty tab (welcome only; cleared on first send)
    function getInitialTemplate() {
      return getWelcomeHtml();
    }

    const MODES = /** @type {const} */ (['general', 'agent']);

    // Tab management state
    let tabCounter = 0;
    const emptyModeState = () => ({ sessionId: null, html: getInitialTemplate(), started: false, cameraId: null, videoPath: null, attachedVideoFilename: null });
    const tabs = [];
    let activeId = null;
    let thinkingToProcessingTimer = null;

    // Escape HTML to prevent XSS
    function escapeHtml(s) {
      return String(s)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    // Get currently active tab
    function getActive() {
      return tabs.find(t => t.id === activeId) || null;
    }

    // Get current chat mode (general or agent)
    function getMode() {
      const m = chatbotOffcanvas.dataset.chatbotMode;
      return m === 'agent' ? 'agent' : 'general';
    }

    // Update mode dropdown label and icon in chat footer: show one of two icons (Plan = infinity, Ask & Task = message)
    function updateModeUI() {
      const mode = getMode();
      const isPlan = mode === 'agent';
      if (modeLabel) modeLabel.textContent = isPlan ? 'Plan' : 'Ask & Task';
      var planIcon = document.getElementById('chatbot-mode-icon-plan');
      var askIcon = document.getElementById('chatbot-mode-icon-ask');
      if (planIcon) planIcon.style.display = isPlan ? '' : 'none';
      if (askIcon) askIcon.style.display = isPlan ? 'none' : '';
    }

    // Switch between general and agent modes
    function setMode(nextMode) {
      const mode = nextMode === 'agent' ? 'agent' : 'general';
      const prev = getMode();
      const active = getActive();
      if (!active) {
        chatbotOffcanvas.dataset.chatbotMode = mode;
        updateModeUI();
        return;
      }

      // Save current mode's HTML before switching
      active.mode[prev].html = messagesEl.innerHTML;

      chatbotOffcanvas.dataset.chatbotMode = mode;
      updateModeUI();

      // Load new mode's HTML for this tab
      messagesEl.innerHTML = active.mode[mode].html || getInitialTemplate();

      if (typeof updateUploadVideoButtonVisibility === 'function') updateUploadVideoButtonVisibility();
      if (typeof updateAttachedVideoIndicator === 'function') updateAttachedVideoIndicator();
    }

    // Save current tab's HTML to state
    function saveActiveHtml() {
      const active = getActive();
      if (!active) return;
      const mode = getMode();
      active.mode[mode].html = messagesEl.innerHTML;
    }

    // Render tab buttons in the tab list
    function renderTabs() {
      tabsEl.innerHTML = tabs
        .map(t => {
          const isActive = t.id === activeId;
          return `
              <li class="nav-item" role="presentation" data-chatbot-tab="${t.id}">
                <button class="nav-link ${isActive ? 'active' : ''} pe-2"
                        type="button"
                        role="tab"
                        aria-selected="${isActive ? 'true' : 'false'}"
                        data-chatbot-tab-btn="${t.id}">
                  <span class="text-truncate d-inline-block chatbot-tab-name">${escapeHtml(t.title)}</span>
                  <span class="chatbot-tab-close ms-2 text-body-tertiary"
                        role="button"
                        tabindex="0"
                        aria-label="Close tab"
                        data-chatbot-tab-close="${t.id}">
                    <span class="fas fa-times"></span>
                  </span>
                </button>
              </li>
            `;
        })
        .join('');
    }

    // Switch to a different tab
    function showTab(id) {
      const target = tabs.find(t => t.id === id);
      if (!target) return;
      saveActiveHtml();
      activeId = id;
      const mode = getMode();
      messagesEl.innerHTML = target.mode[mode].html || getInitialTemplate();
      renderTabs();
      if (typeof updateAttachedVideoIndicator === 'function') updateAttachedVideoIndicator();
    }

    // Create a new chat tab
    function createTab(title) {
      saveActiveHtml();
      tabCounter += 1;
      const id = `chat_tab_${Date.now()}_${tabCounter}`;
      tabs.push({
        id,
        title: title || `Agent ${tabCounter}`,
        mode: {
          general: emptyModeState(),
          agent: emptyModeState()
        }
      });
      activeId = id;
      renderTabs();
      messagesEl.innerHTML = getInitialTemplate();
    }

    // Close a tab (always keeps at least one tab open)
    function closeTab(id) {
      if (tabs.length <= 1) {
        // Reset the only remaining tab
        const only = tabs[0];
        only.title = 'Agent 1';
        only.mode.general = emptyModeState();
        only.mode.agent = emptyModeState();
        activeId = only.id;
        messagesEl.innerHTML = getInitialTemplate();
        renderTabs();
        return;
      }

      const idx = tabs.findIndex(t => t.id === id);
      if (idx === -1) return;

      const wasActive = activeId === id;
      tabs.splice(idx, 1);

      if (!wasActive) {
        renderTabs();
        return;
      }

      // Switch to previous tab if closed tab was active
      const next = tabs[Math.max(0, idx - 1)];
      activeId = next.id;
      const mode = getMode();
      messagesEl.innerHTML = next.mode[mode].html || getInitialTemplate();
      renderTabs();
    }

    // Append user message bubble to chat
    function appendUserBubble(text) {
      const trimmed = (text || '').trim();
      if (!trimmed) return false;
      messagesEl.insertAdjacentHTML(
        'beforeend',
        `
            <div class="d-flex justify-content-end mt-3">
              <div class="user-message-wrapper d-flex flex-column align-items-end">
                <div class="user-message">
                  ${escapeHtml(trimmed)}
                </div>
                <div class="user-message-actions">
                  <button type="button" title="Edit" aria-label="Edit message">
                    <span class="far fa-edit"></span>
                  </button>
                  <button type="button" title="Copy" aria-label="Copy message" data-copy-user-message>
                    <span class="far fa-copy"></span>
                  </button>
                </div>
              </div>
            </div>
          `
      );
      return true;
    }

    // Replace the text content of the last user bubble
    function replaceLastUserBubbleText(newText) {
      const trimmed = (newText || '').trim();
      if (!trimmed) return false;

      // Find the last user message wrapper
      const userWrappers = messagesEl.querySelectorAll('.user-message-wrapper');
      if (userWrappers.length === 0) return false;

      const lastWrapper = userWrappers[userWrappers.length - 1];
      const messageEl = lastWrapper.querySelector('.user-message');
      if (!messageEl) return false;

      // Replace text content
      messageEl.textContent = trimmed;
      return true;
    }

    // Delegate flow diagram rendering to ChatbotFlowDiagram module
    async function renderFlowDiagram(pendingId, flowDiagramData) {
      if (window.ChatbotFlowDiagram && typeof ChatbotFlowDiagram.renderFlowDiagram === 'function') {
        return ChatbotFlowDiagram.renderFlowDiagram(pendingId, flowDiagramData);
      }
    }

    // Create pending assistant message bubble and return its ID (ChatGPT-style: one pulsing dot + thinking/processing text)
    function appendAssistantPending() {
      const id = `pending_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      messagesEl.insertAdjacentHTML(
        'beforeend',
        `
            <div class="d-flex flex-column align-items-start mt-3" data-chatbot-pending="${id}">
              <div class="ai-message-transparent fs-9 text-body-emphasis markdown-content">
                <div class="chatbot-thinking-indicator">
                  <span class="chatbot-thinking-dot" aria-hidden="true"></span>
                  <span class="chatbot-thinking-text"><span class="chatbot-thinking-label">Thinking...</span></span>
                </div>
              </div>
            </div>
          `
      );
      // After a longer "Thinking..." period, switch to "Processing..." once and stay there until backend responds
      const THINKING_DURATION_MS = 4000;
      thinkingToProcessingTimer = window.setTimeout(function () {
        thinkingToProcessingTimer = null;
        switchPendingToProcessing(id);
      }, THINKING_DURATION_MS);
      return id;
    }

    // Switch the pending bubble label from "Thinking..." to "Processing..." (no repeat; stays until response replaces it)
    function switchPendingToProcessing(pendingId) {
      const node = messagesEl?.querySelector?.(`[data-chatbot-pending="${pendingId}"]`);
      if (!node) return;
      const label = node.querySelector?.('.chatbot-thinking-label');
      if (label) label.textContent = 'Processing...';
    }

    // Human-in-the-loop: show approval card (config summary + Approve / Reject), then send resume on button click
    // Renders config as key-value rows (no scroll); uses Phoenix theme components for theme + RTL support
    function formatConfigValue(val) {
      if (val === null) return '—';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    }
    function renderApprovalCardInBubble(pendingId, approvalData, state) {
      const bubble = messagesEl?.querySelector?.(`[data-chatbot-pending="${pendingId}"]`);
      if (!bubble) return;
      const inner = bubble.querySelector?.('.markdown-content') || bubble.querySelector?.('div');
      if (!inner) return;
      const summary = approvalData?.summary || {};
      const ruleId = summary.rule_id || '—';
      const config = summary.agent_rule_config || {};
      const configEntries = typeof config === 'object' && config !== null ? Object.entries(config) : [];

      // Config field icon map for common keys
      const fieldIconMap = {
        fps: 'fa-gauge-high', confidence: 'fa-sliders', run_mode: 'fa-rotate',
        alert_cooldown_seconds: 'fa-bell-slash', confidence_threshold: 'fa-filter',
        confirm_frames: 'fa-film', detectable_classes: 'fa-tags',
        camera_id: 'fa-video', start_time: 'fa-clock', end_time: 'fa-clock-rotate-left',
        model: 'fa-microchip', zone: 'fa-draw-polygon', fps_limit: 'fa-gauge',
        interval_minutes: 'fa-timer', check_duration_seconds: 'fa-stopwatch',
      };

      const configRowsHtml = configEntries.length
        ? configEntries.map(function (kv) {
            const k = escapeHtml(String(kv[0]));
            const v = escapeHtml(formatConfigValue(kv[1]));
            const icon = fieldIconMap[kv[0]] || 'fa-circle-dot';
            return `
              <div class="chatbot-approval-config-row">
                <span class="chatbot-approval-config-icon"><i class="fa-solid ${icon}"></i></span>
                <span class="chatbot-approval-config-key">${k}</span>
                <span class="chatbot-approval-config-val">${v}</span>
              </div>`;
          }).join('')
        : `<div class="chatbot-approval-config-empty">${escapeHtml(typeof config === 'object' ? 'No configuration' : formatConfigValue(config))}</div>`;

      inner.innerHTML = `
        <div class="chatbot-approval-card">
          <div class="chatbot-approval-header">
            <span class="chatbot-approval-header-icon"><i class="fa-solid fa-shield-halved"></i></span>
            <div class="chatbot-approval-header-text">
              <span class="chatbot-approval-title">Save agent configuration?</span>
              <span class="chatbot-approval-subtitle">Review and confirm before the agent starts</span>
            </div>
          </div>
          <div class="chatbot-approval-body">
            <div class="chatbot-approval-rule-row">
              <span class="chatbot-approval-section-label"><i class="fa-solid fa-tag me-1"></i>Rule</span>
              <span class="chatbot-approval-rule-badge">${escapeHtml(ruleId)}</span>
            </div>
            <div class="chatbot-approval-section-label mt-2 mb-1"><i class="fa-solid fa-gear me-1"></i>Configuration</div>
            <div class="chatbot-approval-config-grid">${configRowsHtml}</div>
          </div>
          <div class="chatbot-approval-footer">
            <button type="button" class="chatbot-approval-btn chatbot-approval-btn-reject chatbot-reject-btn" data-chatbot-pending-id="${escapeHtml(pendingId)}">
              <i class="fa-solid fa-xmark"></i>Reject
            </button>
            <button type="button" class="chatbot-approval-btn chatbot-approval-btn-approve chatbot-approve-btn" data-chatbot-pending-id="${escapeHtml(pendingId)}">
              <i class="fa-solid fa-check"></i>Approve
            </button>
          </div>
        </div>
      `;
      // Buttons are handled via delegated click on messagesEl (see below) so they work even if DOM is re-rendered
    }

    async function sendResumeAndHandleStream(pendingId, sessionId, resume, state) {
      const bubble = messagesEl?.querySelector?.(`[data-chatbot-pending="${pendingId}"]`);
      if (!bubble || !sessionId) return;
      const inner = bubble.querySelector?.('.markdown-content') || bubble.querySelector?.('div');
      if (inner) inner.innerHTML = '<p class="mb-0">Saving...</p>';
      state.html = messagesEl.innerHTML;
      try {
        const stream = window.visionAPI.chatWithAgentStream('', sessionId, null, null, null, resume, state._abortController?.signal);
        let finalPayload = null;
        let pendingApprovalData = null;
        let pendingZoneInputData = null;
        for await (const evt of stream) {
          const evName = evt?.event || 'message';
          const data = evt?.data;
          if (evName === 'meta' && data?.session_id) state.sessionId = data.session_id;
          if (evName === 'pending_approval') pendingApprovalData = data || null;
          if (evName === 'pending_zone_input') pendingZoneInputData = data || null;
          if (evName === 'done') finalPayload = data;
        }
        if (pendingApprovalData && getMode() === 'agent') {
          renderApprovalCardInBubble(pendingId, pendingApprovalData, state);
          state.html = messagesEl.innerHTML;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return;
        }
        const zonePayload = pendingZoneInputData || finalPayload?.pending_zone_input;
        if (zonePayload && getMode() === 'agent') {
          const cameraId = zonePayload?.camera_id || state.cameraId;
          const snapshotUrl = zonePayload?.frame_snapshot_url || null;
          const zoneMode = zonePayload?.zone_type || 'polygon';
          if (cameraId) {
            try {
              await openZoneEditorInBubble(pendingId, cameraId, zoneMode, snapshotUrl, {
                saveWithResume: (zoneData) => sendZoneResumeAndHandleStream(pendingId, state.sessionId, zoneData, state)
              });
            } catch (err) {
              console.error('[Chatbot] Zone editor error:', err);
              replaceAssistantPending(pendingId, 'Zone editor failed. Please try again.', true);
            }
          } else {
            replaceAssistantPending(pendingId, 'Zone requested but camera ID is missing.', true);
          }
          state.html = messagesEl.innerHTML;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return;
        }
        const content = finalPayload?.message?.content;
        const isError = finalPayload?.status === 'error';
        if (content && Array.isArray(content) && content.length > 0 && window.ChatbotAttachments && typeof window.ChatbotAttachments.renderContentBlocksInBubble === 'function') {
          await ChatbotAttachments.renderContentBlocksInBubble(pendingId, content, isError);
        } else {
          const answer = content?.find(b => b && b.type === 'text')?.text ?? 'Done.';
          replaceAssistantPending(pendingId, answer, isError);
        }
        if (!isError && finalPayload?.flow_diagram_data) {
          await renderFlowDiagram(pendingId, finalPayload.flow_diagram_data);
        }
      } catch (err) {
        const msg = err?.message ? String(err.message) : 'Request failed.';
        replaceAssistantPending(pendingId, msg, true);
      }
      state.html = messagesEl.innerHTML;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    async function sendZoneResumeAndHandleStream(pendingId, sessionId, zoneData, state) {
      const bubble = messagesEl?.querySelector?.(`[data-chatbot-pending="${pendingId}"]`);
      if (!bubble || !sessionId) return;
      const inner = bubble.querySelector?.('.markdown-content') || bubble.querySelector?.('.zone-editor')?.closest?.('.ai-message-transparent');
      const target = inner || bubble.querySelector?.('div');
      if (target) target.innerHTML = '<p class="mb-0">Applying zone...</p>';
      state.html = messagesEl.innerHTML;
      try {
        const resume = { decisions: [{ type: 'approve', zone: zoneData }] };
        const stream = window.visionAPI.chatWithAgentStream('', sessionId, null, null, null, resume, state._abortController?.signal);
        let finalPayload = null;
        let acc = '';
        let pendingApprovalData = null;
        let pendingZoneInputData = null;
        for await (const evt of stream) {
          const evName = evt?.event || 'message';
          const data = evt?.data;
          if (evName === 'meta' && data?.session_id) state.sessionId = data.session_id;
          if (evName === 'token' && data?.delta) {
            acc += String(data.delta);
            updateAssistantPendingText(pendingId, acc);
            state.html = messagesEl.innerHTML;
          }
          if (evName === 'pending_approval') pendingApprovalData = data || null;
          if (evName === 'pending_zone_input') pendingZoneInputData = data || null;
          if (evName === 'done') finalPayload = data;
        }
        if (pendingApprovalData && getMode() === 'agent') {
          renderApprovalCardInBubble(pendingId, pendingApprovalData, state);
          state.html = messagesEl.innerHTML;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return;
        }
        const zonePayload = pendingZoneInputData || finalPayload?.pending_zone_input;
        if (zonePayload && getMode() === 'agent') {
          const cameraId = zonePayload?.camera_id || state.cameraId;
          const snapshotUrl = zonePayload?.frame_snapshot_url || null;
          const zoneMode = zonePayload?.zone_type || 'polygon';
          if (cameraId) {
            try {
              await openZoneEditorInBubble(pendingId, cameraId, zoneMode, snapshotUrl, {
                saveWithResume: (zd) => sendZoneResumeAndHandleStream(pendingId, state.sessionId, zd, state)
              });
            } catch (err) {
              console.error('[Chatbot] Zone editor error:', err);
              replaceAssistantPending(pendingId, 'Zone editor failed. Please try again.', true);
            }
          } else {
            replaceAssistantPending(pendingId, 'Zone requested but camera ID is missing.', true);
          }
          state.html = messagesEl.innerHTML;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return;
        }
        const content = finalPayload?.message?.content;
        const isError = finalPayload?.status === 'error';
        if (content && Array.isArray(content) && content.length > 0 && window.ChatbotAttachments && typeof window.ChatbotAttachments.renderContentBlocksInBubble === 'function') {
          await ChatbotAttachments.renderContentBlocksInBubble(pendingId, content, isError);
        } else {
          const answer = content?.find(b => b && b.type === 'text')?.text ?? acc ?? 'Done.';
          replaceAssistantPending(pendingId, answer, isError);
        }
        if (!isError && finalPayload?.flow_diagram_data) {
          await renderFlowDiagram(pendingId, finalPayload.flow_diagram_data);
        }
      } catch (err) {
        const msg = err?.message ? String(err.message) : 'Request failed.';
        replaceAssistantPending(pendingId, msg, true);
      }
      state.html = messagesEl.innerHTML;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // Delegate final markdown rendering to ChatbotMarkdown module
    function replaceAssistantPending(pendingId, text, isError = false) {
      if (window.ChatbotMarkdown && typeof window.ChatbotMarkdown.replaceAssistantPending === 'function') {
        return window.ChatbotMarkdown.replaceAssistantPending(pendingId, text, isError);
      }
    }

    // Delegate streaming markdown rendering to ChatbotMarkdown module
    function safeMarkdownForStreaming(text) {
      if (window.ChatbotMarkdown && typeof window.ChatbotMarkdown.safeMarkdownForStreaming === 'function') {
        return window.ChatbotMarkdown.safeMarkdownForStreaming(text);
      }
      return String(text || '');
    }

    // Delegate streaming text updates to ChatbotMarkdown module
    function updateAssistantPendingText(pendingId, text) {
      if (window.ChatbotMarkdown && typeof window.ChatbotMarkdown.updateAssistantPendingText === 'function') {
        return window.ChatbotMarkdown.updateAssistantPendingText(pendingId, text);
      }
    }

    // Delegate zone editor opening to ChatbotZoneEditor module
    async function openZoneEditorInBubble(pendingId, cameraId, zoneMode = 'polygon', snapshotUrl = null, options = null) {
      if (window.ChatbotZoneEditor && typeof ChatbotZoneEditor.openZoneEditorInBubble === 'function') {
        return ChatbotZoneEditor.openZoneEditorInBubble(pendingId, cameraId, zoneMode, snapshotUrl, options);
      }
    }

    // Send text message to backend and handle streaming response
    async function sendTextMessage(text, options = {}) {
      const trimmed = (text || '').trim();
      if (!trimmed) return;

      if (!window.visionAPI || typeof window.visionAPI.isAuthenticated !== 'function') {
        return;
      }

      const active = getActive();
      if (!active) return;

      const mode = getMode();
      const state = active.mode[mode];

      // Clear initial template on first message
      if (!state.started) {
        state.started = true;
        messagesEl.innerHTML = '';
      }

      // Add user message and create pending assistant response
      const ok = appendUserBubble(trimmed);
      if (!ok) return;
      const pendingId = appendAssistantPending();
      saveActiveHtml();
      messagesEl.scrollTop = messagesEl.scrollHeight;

      /** Accumulated response text from streaming tokens */
      let accumulatedText = '';
      try {
        // Demo mode commands for testing without backend
        const DEMO_KEY = 'chatbot_demo_mode';
        const lower = trimmed.toLowerCase();

        if (lower === 'demo on' || lower === '/demo on') {
          if (thinkingToProcessingTimer) {
            clearTimeout(thinkingToProcessingTimer);
            thinkingToProcessingTimer = null;
          }
          localStorage.setItem(DEMO_KEY, 'true');
          replaceAssistantPending(pendingId, '**Demo mode enabled** (backend calls are disabled). Type `demo off` to exit.');
          state.html = messagesEl.innerHTML;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return;
        }
        if (lower === 'demo off' || lower === '/demo off') {
          if (thinkingToProcessingTimer) {
            clearTimeout(thinkingToProcessingTimer);
            thinkingToProcessingTimer = null;
          }
          localStorage.setItem(DEMO_KEY, 'false');
          replaceAssistantPending(pendingId, '**Demo mode disabled** (backend calls are enabled again).');
          state.html = messagesEl.innerHTML;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return;
        }

        const demoEnabled = localStorage.getItem(DEMO_KEY) === 'true';
        if (demoEnabled) {
          replaceAssistantPending(pendingId, `**Demo mode** is ON. Backend calls are disabled.\n\nYou said: \`${escapeHtml(trimmed)}\``);
          state.html = messagesEl.innerHTML;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return;
        }

        if (!window.visionAPI.isAuthenticated()) {
          throw new Error('Please login first.');
        }

        // Cancel any in-flight stream for this tab+mode
        try { state._abortController?.abort?.(); } catch (_) { }
        state._abortController = new AbortController();

        let finalPayload = null;
        let sawError = false;
        let pendingApprovalData = null;
        let pendingZoneInputData = null;

        const zoneData = options?.zoneData || null;
        const cameraIdForRequest = state.cameraId || null;
        const videoPathForRequest = state.videoPath || null;
        const stream = (mode === 'agent')
          ? window.visionAPI.chatWithAgentStream(trimmed, state.sessionId, cameraIdForRequest, zoneData, videoPathForRequest, null, state._abortController.signal)
          : window.visionAPI.generalChatStream(trimmed, state.sessionId, state._abortController.signal);

        // Mark text streaming active for voice module
        if (window.ChatbotVoice) {
          window.ChatbotVoice.setTextStreaming(true);
          window.ChatbotVoice.syncSendButtonVisual();
        }

        // Process streaming events
        for await (const evt of stream) {
          const evName = evt?.event || 'message';
          const data = evt?.data;

          if (evName === 'meta') {
            // Update session ID from meta event
            const sid = data?.session_id || null;
            if (sid) state.sessionId = sid;
            continue;
          }

          if (evName === 'start') {
            // Optional: message_id for this turn (general chat new API)
            continue;
          }

          if (evName === 'token') {
            // Cancel "Thinking..." -> "Processing..." timer once backend has responded
            if (thinkingToProcessingTimer) {
              clearTimeout(thinkingToProcessingTimer);
              thinkingToProcessingTimer = null;
            }
            // General Chat: do NOT render during tokens. Only render on done (structured blocks).
            // Agent mode: show streaming text for typing effect.
            const delta = data?.delta != null ? String(data.delta) : '';
            if (delta) {
              accumulatedText += delta;
              if (mode === 'agent') {
                const boundary = /[\s.,!?;:\n]/.test(delta);
                const now = Date.now();
                const last = state._lastStreamUiFlushTs || 0;
                const shouldFlush = boundary || (now - last) > 200;
                if (shouldFlush) {
                  state._lastStreamUiFlushTs = now;

                  // Auto-scroll only if user is near bottom
                  const distanceFromBottom = messagesEl.scrollHeight - (messagesEl.scrollTop + messagesEl.clientHeight);
                  const shouldAutoScroll = distanceFromBottom < 60;

                  updateAssistantPendingText(pendingId, accumulatedText);
                  state.html = messagesEl.innerHTML;
                  if (shouldAutoScroll) {
                    messagesEl.scrollTop = messagesEl.scrollHeight;
                  }
                }
              }
            }
            continue;
          }

          if (evName === 'pending_approval') {
            pendingApprovalData = data || null;
            continue;
          }

          if (evName === 'pending_zone_input') {
            pendingZoneInputData = data || null;
            continue;
          }

          if (evName === 'error') {
            sawError = true;
            continue;
          }

          if (evName === 'block') {
            // New API: optional block events (we use final message.content on done)
            continue;
          }

          if (evName === 'done') {
            finalPayload = data;
            break;
          }
        }

        // Flush any remaining text only when we won't replace with content blocks
        // (otherwise a scheduled RAF would overwrite the bubble after renderContentBlocksInBubble)
        const message = finalPayload?.message;
        const content = message?.content;
        const evidence = message?.evidence;
        console.log('[Chatbot] backend blocks:', { content, evidence, session_id: finalPayload?.session_id, status: finalPayload?.status });
        const hasContent = content && Array.isArray(content) && content.length > 0;
        const hasEvidence = evidence && Array.isArray(evidence) && evidence.length > 0;
        const willUseContentBlocks = hasContent || hasEvidence;
        if (accumulatedText && !willUseContentBlocks) {
          updateAssistantPendingText(pendingId, accumulatedText);
        }

        // Process final response
        const nextSessionId = finalPayload?.session_id ?? null;
        if (nextSessionId) state.sessionId = nextSessionId;

        const approvalPayload = pendingApprovalData || finalPayload?.pending_approval;
        if (approvalPayload && mode === 'agent') {
          renderApprovalCardInBubble(pendingId, approvalPayload, state);
          state.html = messagesEl.innerHTML;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return;
        }

        const zoneInputPayload = pendingZoneInputData || finalPayload?.pending_zone_input;
        if (zoneInputPayload && mode === 'agent') {
          const cameraId = zoneInputPayload?.camera_id || state.cameraId;
          const snapshotUrl = zoneInputPayload?.frame_snapshot_url || null;
          const zoneMode = zoneInputPayload?.zone_type || 'polygon';
          if (cameraId) {
            try {
              await openZoneEditorInBubble(pendingId, cameraId, zoneMode, snapshotUrl, {
                saveWithResume: (zoneData) => sendZoneResumeAndHandleStream(pendingId, state.sessionId, zoneData, state)
              });
            } catch (err) {
              console.error('[Chatbot] Zone editor error:', err);
              replaceAssistantPending(pendingId, 'Zone editor failed. Please try again.', true);
            }
          } else {
            replaceAssistantPending(pendingId, 'Zone requested but camera ID is missing.', true);
          }
          state.html = messagesEl.innerHTML;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return;
        }

        const isError = (finalPayload?.status === 'error') || sawError;
        if (willUseContentBlocks) {
          if (window.ChatbotAttachments && typeof window.ChatbotAttachments.renderContentBlocksInBubble === 'function') {
            await ChatbotAttachments.renderContentBlocksInBubble(pendingId, content || [], isError, evidence);
          } else {
            const textBlock = (content || []).find(b => b && (b.type === 'text' || b.type === 'markdown'));
            const fallbackText = (textBlock && (textBlock.value ?? textBlock.text)) || accumulatedText || '(empty response)';
            replaceAssistantPending(pendingId, fallbackText, isError);
          }
        } else {
          const answer = accumulatedText || '(empty response)';
          replaceAssistantPending(pendingId, answer, isError);
        }

        // Render flow diagram if present in response (agent mode)
        if (!isError && finalPayload?.flow_diagram_data) {
          await renderFlowDiagram(pendingId, finalPayload.flow_diagram_data);
        }

        // Handle zone editor UI for agent mode as needed
        if (!isError && mode === 'agent') {
          const resolvedCameraId = finalPayload?.camera_id || null;
          if (resolvedCameraId) {
            state.cameraId = resolvedCameraId;
          }
          // Use response camera_id first, then session state (so zone editor works even if backend missed one turn)
          const effectiveCameraId = resolvedCameraId || state.cameraId || null;

          const needsZoneUi = !!(finalPayload?.awaiting_zone_input || finalPayload?.zone_required);
          const shouldShowZoneEditor = needsZoneUi;

          if (shouldShowZoneEditor && effectiveCameraId) {
            // Determine zone mode from backend response (defaults to 'polygon' for backward compatibility)
            // Backend can specify: 'line' (counting line), 'polygon' (restricted zone), 'motion_rois' (machine idle ROIs), or omit for default
            const zoneMode = finalPayload?.zone_type || finalPayload?.zone_mode || 'polygon';
            const snapshotUrl = finalPayload?.frame_snapshot_url || null;
            try {
              await openZoneEditorInBubble(pendingId, effectiveCameraId, zoneMode, snapshotUrl);
            } catch (err) {
              // Show user-friendly error message in chat
              const errorMsg = `⚠️ Failed to load zone editor. Please check console for details. Camera ID: ${effectiveCameraId}`;
              const errorBubble = messagesEl?.querySelector?.(`[data-chatbot-pending="${pendingId}"]`);
              if (errorBubble) {
                const bubbleDiv = errorBubble.querySelector?.('div');
                if (bubbleDiv) {
                  const errorDiv = document.createElement('div');
                  errorDiv.className = 'text-danger mt-2 fs-9';
                  errorDiv.textContent = errorMsg;
                  bubbleDiv.appendChild(errorDiv);
                }
              }
            }
          } else if (shouldShowZoneEditor && !effectiveCameraId) {
            const helpMsg = '⚠️ Zone editor needs a camera. Please provide the camera name or camera ID in your message (e.g. "TEST", "Front Gate", or CAM-xxx).';
            const helpBubble = messagesEl?.querySelector?.(`[data-chatbot-pending="${pendingId}"]`);
            if (helpBubble) {
              const bubbleDiv = helpBubble.querySelector?.('div');
              if (bubbleDiv) {
                const helpDiv = document.createElement('div');
                helpDiv.className = 'text-warning mt-2 fs-9';
                helpDiv.textContent = helpMsg;
                bubbleDiv.appendChild(helpDiv);
              }
            }
          }
        }

        state.html = messagesEl.innerHTML;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      } catch (err) {
        if (thinkingToProcessingTimer) {
          clearTimeout(thinkingToProcessingTimer);
          thinkingToProcessingTimer = null;
        }
        // Handle abort errors gracefully (expected when user cancels)
        if (err && (err.name === 'AbortError' || String(err).includes('AbortError'))) {
          const stoppedText = accumulatedText && accumulatedText.trim() ? accumulatedText.trim() : '_Stopped_';
          replaceAssistantPending(pendingId, stoppedText, false);
          state.html = messagesEl.innerHTML;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return;
        }
        const msg = err?.message ? String(err.message) : 'Chat request failed.';
        replaceAssistantPending(pendingId, msg, true);
        state.html = messagesEl.innerHTML;
        messagesEl.scrollTop = messagesEl.scrollHeight;
      } finally {
        // Reset text streaming state
        if (window.ChatbotVoice) {
          window.ChatbotVoice.setTextStreaming(false);
          window.ChatbotVoice.syncSendButtonVisual();
        }
      }
    }

    // Approve/Reject (delegated) and copy message to clipboard (delegated: user and AI messages)
    messagesEl.addEventListener('click', function (e) {
      const approveBtn = e.target.closest?.('.chatbot-approve-btn');
      if (approveBtn) {
        e.preventDefault();
        const pendingId = approveBtn.getAttribute('data-chatbot-pending-id');
        const active = getActive();
        const state = active?.mode[getMode()];
        if (pendingId && state?.sessionId) {
          sendResumeAndHandleStream(pendingId, state.sessionId, { decisions: [{ type: 'approve' }] }, state);
        }
        return;
      }
      const rejectBtn = e.target.closest?.('.chatbot-reject-btn');
      if (rejectBtn) {
        e.preventDefault();
        const pendingId = rejectBtn.getAttribute('data-chatbot-pending-id');
        const active = getActive();
        const state = active?.mode[getMode()];
        if (pendingId && state?.sessionId) {
          sendResumeAndHandleStream(pendingId, state.sessionId, { decisions: [{ type: 'reject' }] }, state);
        }
        return;
      }
      const copyUser = e.target.closest?.('[data-copy-user-message]');
      if (copyUser) {
        const wrapper = copyUser.closest?.('.user-message-wrapper');
        const msgEl = wrapper?.querySelector?.('.user-message');
        if (msgEl && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(msgEl.textContent.trim()).catch(function () {});
        }
        return;
      }
      const copyAi = e.target.closest?.('[data-copy-ai-message]');
      if (copyAi) {
        const bubble = copyAi.closest?.('.d-flex')?.querySelector?.('.ai-message-transparent, .markdown-content');
        if (bubble && navigator.clipboard?.writeText) {
          navigator.clipboard.writeText(bubble.textContent.trim()).catch(function () {});
        }
      }
    });

    // Handle tab click events (switch tab or close tab)
    tabsEl.addEventListener('click', (e) => {
      const closeEl = e.target.closest?.('[data-chatbot-tab-close]');
      if (closeEl) {
        e.stopPropagation();
        const id = closeEl.getAttribute('data-chatbot-tab-close');
        if (id) closeTab(id);
        return;
      }

      const tabBtn = e.target.closest?.('[data-chatbot-tab-btn]');
      if (tabBtn) {
        const id = tabBtn.getAttribute('data-chatbot-tab-btn');
        if (id) showTab(id);
      }
    });

    // Create new tab on new tab button click
    newTabBtn?.addEventListener('click', () => createTab());

    // Handle send button click (text send, voice toggle, or stop streaming)
    sendBtn?.addEventListener('click', async () => {
      if (!textarea) return;

      // Priority 1: Stop streaming if text is currently streaming
      if (window.ChatbotVoice?.isTextStreaming?.()) {
        const active = getActive();
        if (active) {
          const mode = getMode();
          const chatState = active.mode[mode];
          try { chatState._abortController?.abort?.(); } catch (_) { }
        }
        window.ChatbotVoice.setTextStreaming(false);
        window.ChatbotVoice.syncSendButtonVisual();
        return;
      }

      const hasText = textarea.value.trim().length > 0;

      if (!hasText) {
        // Voice assistant mode: toggle recording or stop completely
        try {
          const voiceActive = window.ChatbotVoice?.isVoiceAssistantActive?.();
          if (!voiceActive) {
            await window.ChatbotVoice.startVoiceRecording();
          } else {
            await window.ChatbotVoice.stopVoiceAssistantCompletely();
          }
        } catch (err) {
          if (sendBtn) sendBtn.classList.remove('recording');
          window.ChatbotVoice?.stopVoiceAssistantCompletely?.().catch?.(() => { });
          const active = getActive();
          if (active) {
            appendAssistantPending();
            const lastPending = messagesEl.querySelector?.('[data-chatbot-pending]');
            if (lastPending) {
              const bubble = lastPending.querySelector?.('div');
              if (bubble) {
                bubble.textContent = err?.message ? String(err.message) : 'Voice failed.';
                bubble.classList.remove('bg-body-secondary');
                bubble.classList.add('bg-danger', 'text-white');
              }
            }
            active.mode.general.html = messagesEl.innerHTML;
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        }
      } else {
        // Text mode: send message
        const text = textarea.value;
        textarea.value = '';
        textarea.dispatchEvent(new Event('input'));
        sendTextMessage(text);
      }
    });

    // Handle clear chat action
    document.addEventListener('click', (e) => {
      const el = e.target.closest?.('[data-chatbot-action="clear"]');
      if (!el) return;
      e.preventDefault();
      const active = getActive();
      if (!active) return;
      const mode = getMode();
      active.mode[mode] = emptyModeState();
      messagesEl.innerHTML = getInitialTemplate();
      saveActiveHtml();
    });

    // Handle mode switch (general/agent)
    document.addEventListener('click', (e) => {
      const el = e.target.closest?.('[data-chatbot-mode]');
      if (!el) return;
      e.preventDefault();
      const mode = el.getAttribute('data-chatbot-mode');
      if (!mode) return;
      setMode(mode);
    });

    // ----- Upload video (Agent mode: create agent for this video) -----
    const uploadVideoBtn = document.getElementById('chatbot-upload-video-btn');
    const videoUploadInput = document.getElementById('chatbot-video-upload');
    const attachedVideoIndicator = document.getElementById('chatbot-attached-video-indicator');
    const attachedVideoLabel = attachedVideoIndicator?.querySelector?.('.chatbot-attached-video-label');
    const attachedVideoClearBtn = document.getElementById('chatbot-attached-video-clear');

    function updateUploadVideoButtonVisibility() {
      if (!uploadVideoBtn) return;
      uploadVideoBtn.style.display = getMode() === 'agent' ? '' : 'none';
    }

    function updateAttachedVideoIndicator() {
      if (!attachedVideoIndicator || !attachedVideoLabel) return;
      const active = getActive();
      const mode = getMode();
      const path = active?.mode?.[mode]?.videoPath;
      const name = active?.mode?.[mode]?.attachedVideoFilename;
      if (path && getMode() === 'agent') {
        attachedVideoLabel.textContent = name ? `Video attached: ${name}` : 'Video attached';
        attachedVideoIndicator.classList.remove('d-none');
        attachedVideoIndicator.classList.add('d-flex');
      } else {
        attachedVideoIndicator.classList.add('d-none');
        attachedVideoIndicator.classList.remove('d-flex');
      }
    }

    if (uploadVideoBtn && videoUploadInput) {
      uploadVideoBtn.addEventListener('click', function () {
        if (getMode() !== 'agent') return;
        videoUploadInput.value = '';
        videoUploadInput.click();
      });
      videoUploadInput.addEventListener('change', async function () {
        const file = this.files?.[0];
        if (!file || getMode() !== 'agent') return;
        if (!window.visionAPI || typeof window.visionAPI.uploadVideo !== 'function') return;
        const active = getActive();
        const mode = getMode();
        if (!active) return;
        try {
          uploadVideoBtn.setAttribute('aria-busy', 'true');
          uploadVideoBtn.querySelector('.fa-video')?.classList?.add('fa-spin');
          const data = await window.visionAPI.uploadVideo(file);
          if (data && data.video_path) {
            active.mode[mode].videoPath = data.video_path;
            active.mode[mode].attachedVideoFilename = data.filename || file.name;
            if (window.ChatbotCore && typeof window.ChatbotCore.setVideoPath === 'function') {
              window.ChatbotCore.setVideoPath(data.video_path);
            }
            updateAttachedVideoIndicator();
          }
        } catch (err) {
          if (typeof window.toastService !== 'undefined' && window.toastService.error) {
            window.toastService.error(err.message || 'Video upload failed');
          } else {
            alert(err.message || 'Video upload failed');
          }
        } finally {
          uploadVideoBtn.removeAttribute('aria-busy');
          uploadVideoBtn.querySelector('.fa-video')?.classList?.remove('fa-spin');
          this.value = '';
        }
      });
    }

    if (attachedVideoClearBtn) {
      attachedVideoClearBtn.addEventListener('click', function () {
        const active = getActive();
        const mode = getMode();
        if (active) {
          active.mode[mode].videoPath = null;
          active.mode[mode].attachedVideoFilename = null;
          if (window.ChatbotCore && typeof window.ChatbotCore.setVideoPath === 'function') {
            window.ChatbotCore.setVideoPath(null);
          }
          updateAttachedVideoIndicator();
        }
      });
    }

    // Optional: drag-and-drop video on messages area (Agent mode)
    if (messagesEl) {
      messagesEl.addEventListener('dragover', function (e) {
        if (getMode() !== 'agent') return;
        const hasVideo = Array.from(e.dataTransfer?.types || []).some(t => t === 'Files');
        if (hasVideo) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          messagesEl.classList.add('chatbot-drag-over');
        }
      });
      messagesEl.addEventListener('dragleave', function () {
        messagesEl.classList.remove('chatbot-drag-over');
      });
      messagesEl.addEventListener('drop', async function (e) {
        e.preventDefault();
        messagesEl.classList.remove('chatbot-drag-over');
        if (getMode() !== 'agent') return;
        const file = e.dataTransfer?.files?.[0];
        if (!file || !file.type.startsWith('video/')) return;
        if (!window.visionAPI || typeof window.visionAPI.uploadVideo !== 'function') return;
        const active = getActive();
        const mode = getMode();
        if (!active) return;
        try {
          const data = await window.visionAPI.uploadVideo(file);
          if (data && data.video_path) {
            active.mode[mode].videoPath = data.video_path;
            active.mode[mode].attachedVideoFilename = data.filename || file.name;
            if (window.ChatbotCore && typeof window.ChatbotCore.setVideoPath === 'function') {
              window.ChatbotCore.setVideoPath(data.video_path);
            }
            updateAttachedVideoIndicator();
            if (window.toastService && window.toastService.success) {
              window.toastService.success('Video attached');
            }
          }
        } catch (err) {
          if (typeof window.toastService !== 'undefined' && window.toastService.error) {
            window.toastService.error(err.message || 'Video upload failed');
          } else {
            alert(err.message || 'Video upload failed');
          }
        }
      });
    }

    // Initialize mode label/icon and create first tab
    chatbotOffcanvas.dataset.chatbotMode = chatbotOffcanvas.dataset.chatbotMode || 'general';
    updateModeUI();

    // Initialize voice module with dependencies
    const voiceDeps = {
      getActive,
      getMode,
      messagesEl,
      appendUserBubble,
      replaceLastUserBubbleText,
      appendAssistantPending,
      replaceAssistantPending,
      updateAssistantPendingText,
      saveActiveHtml,
      chatbotOffcanvas,
      sendBtn,
      voiceBtn
    };
    if (window.ChatbotVoice && typeof ChatbotVoice.init === 'function') {
      ChatbotVoice.init(voiceDeps);
    } else {
      window.ChatbotVoicePendingDeps = voiceDeps;
    }

    // Initialize zone editor module with dependencies
    if (window.ChatbotZoneEditor && typeof ChatbotZoneEditor.init === 'function') {
      ChatbotZoneEditor.init({
        messagesEl,
        sendTextMessage,
        escapeHtml
      });
    } else {
      window.ChatbotZoneEditorPendingDeps = {
        messagesEl,
        sendTextMessage,
        escapeHtml
      };
    }

    // Initialize flow diagram module with dependencies
    const flowDiagramDeps = {
      messagesEl,
      ensureReteFlowRenderer
    };
    if (window.ChatbotFlowDiagram && typeof ChatbotFlowDiagram.init === 'function') {
      ChatbotFlowDiagram.init(flowDiagramDeps);
    } else {
      window.ChatbotFlowDiagramPendingDeps = flowDiagramDeps;
    }

    // Initialize markdown module with dependencies
    const markdownDeps = {
      messagesEl,
      escapeHtml
    };
    if (window.ChatbotMarkdown && typeof ChatbotMarkdown.init === 'function') {
      ChatbotMarkdown.init(markdownDeps);
    } else {
      window.ChatbotMarkdownPendingDeps = markdownDeps;
    }

    createTab('Agent 1');
    updateUploadVideoButtonVisibility();
    updateAttachedVideoIndicator();

    // Expose helpers so pages can open Agentwith a video file (no camera_id)
    window.ChatbotCore = {
      setVideoPath: function (path) {
        const active = getActive();
        if (active) {
          const m = getMode();
          active.mode[m].videoPath = path ? String(path).trim() || null : null;
        }
      },
      setCameraId: function (id) {
        const active = getActive();
        if (active) {
          const m = getMode();
          active.mode[m].cameraId = id ? String(id).trim() || null : null;
        }
      }
    };
  }

  // ============================================================================
  // SECTION 5: FIND PERSON MODAL (upload reference photos for face recognition)
  // ============================================================================

  /** Set up the Find Person modal: upload photos, select from gallery */
  function initFindPersonModal() {
    const findPersonBtn = document.getElementById('chatbot-find-person-btn');
    const modalEl = document.getElementById('find-person-modal');
    const formEl = document.getElementById('find-person-form');
    const nameInput = document.getElementById('find-person-name');
    const existingSelect = document.getElementById('find-person-existing');
    const fileInput = document.getElementById('find-person-file');
    const submitBtn = document.getElementById('find-person-submit-btn');

    if (!findPersonBtn || !modalEl || !formEl || !submitBtn) return;

    let galleryLoaded = false;

    async function loadPersonGalleryIntoSelect() {
      if (!existingSelect || !window.visionAPI || typeof window.visionAPI.getPersonGalleryList !== 'function') return;
      if (galleryLoaded && existingSelect.options.length > 1) return;
      existingSelect.innerHTML = '';
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = 'Select a person from the list (optional)';
      existingSelect.appendChild(placeholder);
      try {
        const people = await window.visionAPI.getPersonGalleryList();
        if (!Array.isArray(people) || people.length === 0) {
          const opt = document.createElement('option');
          opt.value = '';
          opt.textContent = 'No persons found in gallery yet';
          existingSelect.appendChild(opt);
          return;
        }
        people
          .slice()
          .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
          .forEach(function (person) {
            const opt = document.createElement('option');
            opt.value = person.name || '';
            opt.textContent = person.name || '(unnamed)';
            existingSelect.appendChild(opt);
          });
        galleryLoaded = true;
      } catch (err) {
        if (window.VisionToast && typeof window.VisionToast.error === 'function') {
          window.VisionToast.error(err.message || 'Failed to load person list.');
        }
      }
    }

    findPersonBtn.addEventListener('click', function () {
      if (typeof bootstrap === 'undefined') return;
      const modal = new bootstrap.Modal(modalEl);
      modal.show();
      if (nameInput) nameInput.value = '';
      if (fileInput) fileInput.value = '';
      if (existingSelect) existingSelect.value = '';
      loadPersonGalleryIntoSelect();
    });

    if (existingSelect) {
      existingSelect.addEventListener('change', function () {
        const selectedName = existingSelect.value || '';
        if (selectedName && nameInput) nameInput.value = selectedName;
      });
    }

    submitBtn.addEventListener('click', function () {
      var name = nameInput ? nameInput.value.trim() : '';
      var files = fileInput && fileInput.files ? fileInput.files : [];
      var minPhotos = 4;
      if (!name) {
        if (window.VisionToast) window.VisionToast.warning('Please enter the person\'s name.');
        if (nameInput) nameInput.focus();
        return;
      }
      if (files.length < minPhotos) {
        if (window.VisionToast) window.VisionToast.warning('Please select at least ' + minPhotos + ' photos for accurate recognition.');
        if (fileInput) fileInput.focus();
        return;
      }
      if (!window.visionAPI) {
        if (window.VisionToast) window.VisionToast.error('API service not available.');
        return;
      }

      var btnText = submitBtn.querySelector('.find-person-btn-text');
      var spinner = submitBtn.querySelector('.find-person-spinner');
      if (btnText) btnText.classList.add('d-none');
      if (spinner) spinner.classList.remove('d-none');
      submitBtn.disabled = true;

      window.visionAPI.uploadReferencePhotos(name, files)
        .then(function (res) {
          if (window.VisionToast) {
            window.VisionToast.success((res.image_count || files.length) + ' photos uploaded for ' + name + '. You can now create an agent like "alert me when ' + name + ' appears on camera 1".');
          }
          if (typeof bootstrap !== 'undefined') {
            var modalInstance = bootstrap.Modal.getInstance(modalEl);
            if (modalInstance) modalInstance.hide();
          }
          if (formEl) formEl.reset();
        })
        .catch(function (err) {
          if (window.VisionToast) {
            window.VisionToast.error(err.message || 'Upload failed.');
          }
        })
        .finally(function () {
          if (btnText) btnText.classList.remove('d-none');
          if (spinner) spinner.classList.add('d-none');
          submitBtn.disabled = false;
        });
    });
  }

  // ============================================================================
  // SECTION 6: KEYBOARD SHORTCUT (Ctrl+L / Cmd+L toggles chatbot)
  // ============================================================================

  /** Listen for Ctrl+L / Cmd+L to open/close chatbot */
  function initChatbotKeyboardShortcut() {
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'l' && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        const chatbotOffcanvas = document.getElementById('chatbot-offcanvas');
        if (!chatbotOffcanvas || typeof bootstrap === 'undefined') return;

        const offcanvasInstance = bootstrap.Offcanvas.getInstance(chatbotOffcanvas);
        if (offcanvasInstance) {
          offcanvasInstance.toggle();
        } else {
          const newInstance = new bootstrap.Offcanvas(chatbotOffcanvas);
          newInstance.show();
        }
      }
    });
  }

  // ============================================================================
  // SECTION 7: STARTUP (runs when page is ready)
  // ============================================================================

  /** Run all init functions in order */
  function initAll() {
    initChatbotLayout();
    initChatbotComposer();
    initChatbotTabs();
    initFindPersonModal();
    initChatbotKeyboardShortcut();
  }

  /** Wait for page to load, then run initAll. If Bootstrap is late, retry after 100ms. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      if (typeof bootstrap !== 'undefined') {
        initAll();
      } else {
        setTimeout(function () {
          if (typeof bootstrap !== 'undefined') {
            initAll();
          }
        }, 100);
      }
    });
  } else {
    if (typeof bootstrap !== 'undefined') {
      initAll();
    } else {
      setTimeout(function () {
        if (typeof bootstrap !== 'undefined') {
          initAll();
        }
      }, 100);
    }
  }
})();
