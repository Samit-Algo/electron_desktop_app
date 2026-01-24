// Core chatbot logic - handles layout, tabs, messaging, and module initialization

(function () {
  'use strict';

  // Generate root-relative vendor path for script loading
  function vendorPath(relFromVendors) {
    return new URL('/vendors/' + relFromVendors, window.location.origin).toString();
  }

  // Load external script once, preventing duplicate loads
  function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
      try {
        const existing = document.querySelector(`script[src="${src}"]`);
        if (existing) return resolve();
        const scriptEl = document.createElement('script');
        scriptEl.src = src;
        scriptEl.defer = true;
        scriptEl.onload = () => resolve();
        scriptEl.onerror = () => reject(new Error(`Failed to load script: ${src}`));
        document.head.appendChild(scriptEl);
      } catch (e) {
        reject(e);
      }
    });
  }

  // Delegate markdown dependencies loading to ChatbotMarkdown module
  function ensureMarkdownDeps() {
    if (window.ChatbotMarkdown && typeof window.ChatbotMarkdown.ensureMarkdownDeps === 'function') {
      return window.ChatbotMarkdown.ensureMarkdownDeps();
    }
    return Promise.resolve();
  }

  // Load Rete.js flow diagram renderer scripts on-demand
  function ensureReteFlowRenderer() {
    if (window.reteFlowRenderer && window.flowTransforms) return Promise.resolve();
    const transformsSrc = new URL('/custom_js/flow-transforms.js', window.location.origin).toString();
    const rendererSrc = new URL('/custom_js/rete-flow-renderer.js', window.location.origin).toString();
    return loadScriptOnce(transformsSrc)
      .then(() => loadScriptOnce(rendererSrc))
      .catch((e) => {
        console.warn('Rete flow renderer load failed:', e);
      });
  }

  // Global flag to prevent chart resizing during layout transitions
  let layoutSettling = false;

  // Initialize chatbot panel layout, resize handle, and grid integration
  function initChatbotPush() {
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

    chatbotOffcanvas.addEventListener('hide.bs.offcanvas', function () {
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

  // Initialize textarea autosize and send button state management
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

  // Initialize chat tabs, messaging, and module integration
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

    // Store initial empty template for new tabs
    const initialTemplate = messagesEl.innerHTML;

    const MODES = /** @type {const} */ (['general', 'agent']);

    // Tab management state
    let tabCounter = 0;
    const emptyModeState = () => ({ sessionId: null, html: initialTemplate, started: false });
    const tabs = [];
    let activeId = null;

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

    // Switch between general and agent modes
    function setMode(nextMode) {
      const mode = nextMode === 'agent' ? 'agent' : 'general';
      const prev = getMode();
      const active = getActive();
      if (!active) {
        chatbotOffcanvas.dataset.chatbotMode = mode;
        if (modeLabel) modeLabel.textContent = mode === 'agent' ? 'Agent' : 'General';
        return;
      }

      // Save current mode's HTML before switching
      active.mode[prev].html = messagesEl.innerHTML;

      chatbotOffcanvas.dataset.chatbotMode = mode;
      if (modeLabel) modeLabel.textContent = mode === 'agent' ? 'Agent' : 'General';

      // Load new mode's HTML for this tab
      messagesEl.innerHTML = active.mode[mode].html || initialTemplate;
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
      messagesEl.innerHTML = target.mode[mode].html || initialTemplate;
      renderTabs();
    }

    // Create a new chat tab
    function createTab(title) {
      saveActiveHtml();
      tabCounter += 1;
      const id = `chat_tab_${Date.now()}_${tabCounter}`;
      tabs.push({
        id,
        title: title || `New chat ${tabCounter}`,
        mode: {
          general: emptyModeState(),
          agent: emptyModeState()
        }
      });
      activeId = id;
      renderTabs();
      messagesEl.innerHTML = initialTemplate;
    }

    // Close a tab (always keeps at least one tab open)
    function closeTab(id) {
      if (tabs.length <= 1) {
        // Reset the only remaining tab
        const only = tabs[0];
        only.title = 'New chat 1';
        only.mode.general = emptyModeState();
        only.mode.agent = emptyModeState();
        activeId = only.id;
        messagesEl.innerHTML = initialTemplate;
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
      messagesEl.innerHTML = next.mode[mode].html || initialTemplate;
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
                  <button type="button" title="Edit" onclick="console.log('Edit clicked')">
                    <span class="far fa-edit"></span>
                  </button>
                  <button type="button" title="Copy" onclick="navigator.clipboard.writeText(this.closest('.user-message-wrapper').querySelector('.user-message').textContent.trim()).then(() => console.log('Copied'))">
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

    // Create pending assistant message bubble and return its ID
    function appendAssistantPending() {
      const id = `pending_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      messagesEl.insertAdjacentHTML(
        'beforeend',
        `
            <div class="d-flex flex-column align-items-start mt-3" data-chatbot-pending="${id}">
              <div class="ai-message-transparent fs-9 text-body-emphasis markdown-content">
                ...
              </div>
            </div>
          `
      );
      return id;
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
    async function openZoneEditorInBubble(pendingId, cameraId, zoneMode = 'polygon', snapshotUrl = null) {
      if (window.ChatbotZoneEditor && typeof ChatbotZoneEditor.openZoneEditorInBubble === 'function') {
        return ChatbotZoneEditor.openZoneEditorInBubble(pendingId, cameraId, zoneMode, snapshotUrl);
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

      try {
        // Demo mode commands for testing without backend
        const DEMO_KEY = 'chatbot_demo_mode';
        const lower = trimmed.toLowerCase();

        if (lower === 'demo on' || lower === '/demo on') {
          localStorage.setItem(DEMO_KEY, 'true');
          replaceAssistantPending(pendingId, '**Demo mode enabled** (backend calls are disabled). Type `demo off` to exit.');
          state.html = messagesEl.innerHTML;
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return;
        }
        if (lower === 'demo off' || lower === '/demo off') {
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

        let acc = '';
        let finalPayload = null;
        let sawError = false;

        const zoneData = options?.zoneData || null;
        // Get appropriate stream based on mode (agent vs general)
        const stream = (mode === 'agent')
          ? window.visionAPI.chatWithAgentStream(trimmed, state.sessionId, null, zoneData, state._abortController.signal)
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

          if (evName === 'token') {
            // Accumulate streaming text tokens with micro-batching
            const delta = data?.delta != null ? String(data.delta) : '';
            if (delta) {
              acc += delta;
              const boundary = /[\s.,!?;:\n]/.test(delta);
              const now = Date.now();
              const last = state._lastStreamUiFlushTs || 0;
              const shouldFlush = boundary || (now - last) > 200;
              if (shouldFlush) {
                state._lastStreamUiFlushTs = now;

                // Auto-scroll only if user is near bottom
                const distanceFromBottom = messagesEl.scrollHeight - (messagesEl.scrollTop + messagesEl.clientHeight);
                const shouldAutoScroll = distanceFromBottom < 60;

                updateAssistantPendingText(pendingId, acc);
                state.html = messagesEl.innerHTML;
                if (shouldAutoScroll) {
                  messagesEl.scrollTop = messagesEl.scrollHeight;
                }
              }
            }
            continue;
          }

          if (evName === 'error') {
            sawError = true;
            continue;
          }

          if (evName === 'done') {
            finalPayload = data;
            break;
          }
        }

        // Flush any remaining text
        if (acc) {
          updateAssistantPendingText(pendingId, acc);
        }

        // Process final response
        const answer = finalPayload?.response ?? acc ?? '';
        const nextSessionId = finalPayload?.session_id ?? null;
        if (nextSessionId) state.sessionId = nextSessionId;

        const isError = (finalPayload?.status === 'error') || sawError;
        replaceAssistantPending(pendingId, answer || '(empty response)', isError);

        // Render flow diagram if present in response
        if (!isError && finalPayload?.flow_diagram_data) {
          await renderFlowDiagram(pendingId, finalPayload.flow_diagram_data);
        }

        // Handle zone editor UI for agent mode if needed
        if (!isError && mode === 'agent') {
          const resolvedCameraId = finalPayload?.camera_id || null;
          if (resolvedCameraId) {
            state.cameraId = resolvedCameraId;
          }

          const needsZoneUi = !!(finalPayload?.awaiting_zone_input || finalPayload?.zone_required);
          
          // Fallback: detect if assistant is asking user to draw polygon/zone by checking response text
          const answerLower = (answer || '').toLowerCase();
          const drawKeywords = ['draw', 'polygon', 'zone', 'area', 'restricted zone', 'counting line'];
          const mentionsDrawing = drawKeywords.some(keyword => answerLower.includes(keyword));
          
          // Also check if response mentions "camera frame" or similar
          const mentionsFrame = answerLower.includes('camera frame') || answerLower.includes('frame') || answerLower.includes('snapshot');
          
          const shouldShowZoneEditor = needsZoneUi || (mentionsDrawing && mentionsFrame && resolvedCameraId);
          
          console.log('[ChatbotCore] Zone UI check:', {
            needsZoneUi,
            resolvedCameraId,
            awaiting_zone_input: finalPayload?.awaiting_zone_input,
            zone_required: finalPayload?.zone_required,
            frame_snapshot_url: finalPayload?.frame_snapshot_url,
            zone_type: finalPayload?.zone_type || finalPayload?.zone_mode,
            mentionsDrawing,
            mentionsFrame,
            shouldShowZoneEditor
          });
          
          if (shouldShowZoneEditor && resolvedCameraId) {
            // Determine zone mode from backend response (defaults to 'polygon' for backward compatibility)
            // Backend can specify: 'line' for counting line, 'polygon' for restricted zone, or omit for default
            const zoneMode = finalPayload?.zone_type || finalPayload?.zone_mode || 'polygon';
            // Use frame_snapshot_url if provided, otherwise fall back to camera ID
            const snapshotUrl = finalPayload?.frame_snapshot_url || null;
            console.log('[ChatbotCore] Opening zone editor:', {
              pendingId,
              cameraId: resolvedCameraId,
              zoneMode,
              snapshotUrl
            });
            try {
              await openZoneEditorInBubble(pendingId, resolvedCameraId, zoneMode, snapshotUrl);
              console.log('[ChatbotCore] Zone editor opened successfully');
            } catch (err) {
              console.error('[ChatbotCore] Error opening zone editor:', err);
              // Show user-friendly error message in chat
              const errorMsg = `⚠️ Failed to load zone editor. Please check console for details. Camera ID: ${resolvedCameraId}`;
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
          } else if (shouldShowZoneEditor && !resolvedCameraId) {
            console.warn('[ChatbotCore] Zone UI needed but camera_id is missing. Response:', {
              needsZoneUi,
              mentionsDrawing,
              mentionsFrame
            });
            const helpMsg = '⚠️ Zone editor requires a camera ID. Please provide the camera ID in your message.';
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
        // Handle abort errors gracefully (expected when user cancels)
        if (err && (err.name === 'AbortError' || String(err).includes('AbortError'))) {
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
          const s = active.mode[mode];
          try { s._abortController?.abort?.(); } catch (_) { }
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
      messagesEl.innerHTML = initialTemplate;
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

    // Initialize mode label and create first tab
    chatbotOffcanvas.dataset.chatbotMode = chatbotOffcanvas.dataset.chatbotMode || 'general';
    if (modeLabel) modeLabel.textContent = getMode() === 'agent' ? 'Agent' : 'General';

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
    console.log('[ChatbotCore] About to initialize zone editor');
    console.log('[ChatbotCore] window.ChatbotZoneEditor exists?', !!window.ChatbotZoneEditor);
    console.log('[ChatbotCore] sendTextMessage type:', typeof sendTextMessage);
    
    if (window.ChatbotZoneEditor && typeof ChatbotZoneEditor.init === 'function') {
      console.log('[ChatbotCore] ✅ Calling ChatbotZoneEditor.init()');
      ChatbotZoneEditor.init({
        messagesEl,
        sendTextMessage,
        escapeHtml
      });
      console.log('[ChatbotCore] ✅ ChatbotZoneEditor.init() completed');
    } else {
      console.warn('[ChatbotCore] ⚠️ ChatbotZoneEditor not loaded yet, saving deps for later');
      // Zone editor will load after this - save dependencies for it to pick up
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

    createTab('New chat 1');
  }

  // Initialize keyboard shortcut (Ctrl+L / Cmd+L to toggle chatbot)
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

  // Initialize all chatbot functionality when DOM and Bootstrap are ready
  function initAll() {
    initChatbotPush();
    initChatbotComposer();
    initChatbotTabs();
    initChatbotKeyboardShortcut();
  }

  // Wait for DOM and Bootstrap to be ready before initializing
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
