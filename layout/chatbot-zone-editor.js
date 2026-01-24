/**
 * Zone Editor Module for Chatbot
 * 
 * Provides polygon/line drawing on camera snapshots for defining
 * monitoring zones and counting lines in the chatbot interface.
 * 
 * Features:
 * - Fetches camera snapshot from backend
 * - Interactive polygon/line drawing on canvas
 * - Normalized coordinates (0-1 range) for backend compatibility
 * - Undo/Clear/Save controls
 * - Error handling with user-friendly messages
 */

(function () {
  'use strict';

  // ============================================================
  // UTILITY FUNCTIONS (self-contained, no dependency injection)
  // ============================================================

  /**
   * Escape HTML special characters to prevent XSS
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Generate a unique ID for editor instances
   * @returns {string} Unique ID
   */
  function generateEditorId() {
    return `zone_editor_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  // ============================================================
  // MODULE STATE
  // ============================================================

  // Cached DOM references (set via init)
  let cachedMessagesEl = null;
  let sendTextMessageFn = null;

  // ============================================================
  // DOM HELPERS
  // ============================================================

  /**
   * Get the messages container element, refreshing reference if needed
   * @returns {HTMLElement|null}
   */
  function getMessagesEl() {
    if (cachedMessagesEl && cachedMessagesEl.isConnected) {
      return cachedMessagesEl;
    }
    
    const chatbotOffcanvas = document.getElementById('chatbot-offcanvas');
    const freshMessagesEl = chatbotOffcanvas?.querySelector?.('.chat-messages');
    
    if (freshMessagesEl) {
      cachedMessagesEl = freshMessagesEl;
      console.log('[ZoneEditor] Refreshed messagesEl reference');
    }
    
    return cachedMessagesEl;
  }

  /**
   * Find the assistant bubble element by pending ID
   * @param {string} pendingId - The pending message ID
   * @returns {{node: HTMLElement|null, bubble: HTMLElement|null}}
   */
  function findAssistantBubble(pendingId) {
    const messagesEl = getMessagesEl();
    if (!messagesEl) {
      return { node: null, bubble: null };
    }
    
    // Primary: find by data attribute
    let node = messagesEl.querySelector(`[data-chatbot-pending="${pendingId}"]`);
    let bubble = node?.querySelector?.('.ai-message-transparent, .markdown-content, div');
    
    if (bubble) {
      return { node, bubble };
    }
    
    // Fallback: find last assistant message
    const allAssistant = messagesEl.querySelectorAll('.d-flex.flex-column.align-items-start');
    if (allAssistant.length > 0) {
      const lastMsg = allAssistant[allAssistant.length - 1];
      const lastBubble = lastMsg.querySelector('.ai-message-transparent, .markdown-content, div');
      if (lastBubble) {
        console.log('[ZoneEditor] Using fallback: last assistant message');
        return { node: lastMsg, bubble: lastBubble };
      }
    }
    
    return { node: null, bubble: null };
  }

  // ============================================================
  // SNAPSHOT FETCHING
  // ============================================================

  /**
   * Fetch camera snapshot from backend
   * @param {string} cameraId - Camera ID
   * @param {string|null} snapshotUrl - Optional snapshot URL from backend
   * @returns {Promise<{imageUrl: string, width: number, height: number}>}
   */
  async function fetchCameraSnapshot(cameraId, snapshotUrl = null) {
    if (!window.visionAPI) {
      throw new Error('API service not available. Please refresh the page.');
    }

    // Build the URL
    const url = snapshotUrl || `/api/v1/cameras/${encodeURIComponent(cameraId)}/snapshot`;
    
    console.log('[ZoneEditor] Fetching snapshot:', url);

    try {
      // Use the API service method
      const data = await window.visionAPI.getCameraSnapshotFromUrl(url);
      
      if (!data?.frame_base64) {
        throw new Error('No image data in response');
      }

      // Convert base64 to blob URL
      let base64String = data.frame_base64;
      if (base64String.includes(',')) {
        base64String = base64String.split(',')[1];
      }

      // Validate base64
          const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
          if (!base64Regex.test(base64String)) {
        throw new Error('Invalid image data format');
          }
          
      // Decode and create blob
          const binaryString = atob(base64String);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          
          const blob = new Blob([bytes], { type: 'image/jpeg' });
          if (blob.size === 0) {
        throw new Error('Empty image data');
      }

      const imageUrl = URL.createObjectURL(blob);
      
      console.log('[ZoneEditor] Snapshot loaded:', {
        width: data.width,
        height: data.height,
        blobSize: blob.size
      });

      return {
        imageUrl,
        width: data.width || null,
        height: data.height || null
      };

    } catch (error) {
      console.error('[ZoneEditor] Snapshot fetch error:', error);
      
      // Check for common error types
      const errorMsg = error?.message || 'Failed to load camera snapshot';
      if (errorMsg.includes('404') || errorMsg.includes('No frame') || errorMsg.includes('not found')) {
        throw new Error('Camera is not streaming. Please start the camera stream first.');
      }
      if (errorMsg.includes('401') || errorMsg.includes('unauthorized')) {
        throw new Error('Authentication failed. Please log in again.');
      }
      
      throw new Error(errorMsg);
    }
  }

  // ============================================================
  // ZONE EDITOR UI BUILDER
  // ============================================================

  /**
   * Create the zone editor HTML structure
   * @param {string} editorId - Unique editor ID
   * @param {string} cameraId - Camera ID
   * @param {string} mode - 'polygon' or 'line'
   * @returns {HTMLElement}
   */
  function createZoneEditorElement(editorId, cameraId, mode) {
    const isLineMode = mode === 'line';
    
    const container = document.createElement('div');
    container.className = 'zone-editor';
    container.setAttribute('data-zone-editor', editorId);
    container.setAttribute('data-zone-mode', mode);
    
    const title = isLineMode ? 'Draw Counting Line' : 'Draw Monitoring Zone';
    const hint = isLineMode
      ? 'Click to set start point, then click again to set end point.'
      : 'Click to add polygon points. Use "Undo" to remove last point. Save needs at least 3 points.';
    
    container.innerHTML = `
      <div class="zone-editor__header">
        <div class="zone-editor__title">${title}</div>
        <div class="text-body-tertiary fs-10">
          Camera: <span class="font-monospace">${escapeHtml(cameraId)}</span>
        </div>
      </div>
      <div class="zone-editor__body">
        <div class="zone-editor__status" data-zone-status>
          <div class="d-flex align-items-center gap-2">
            <span class="spinner-border spinner-border-sm text-primary"></span>
            <span>Loading camera snapshot...</span>
          </div>
        </div>
        <div class="zone-editor__canvas-wrap d-none" data-canvas-wrap>
          <img class="zone-editor__img" alt="Camera snapshot" data-zone-img />
          <canvas class="zone-editor__canvas" data-zone-canvas></canvas>
        </div>
        <div class="zone-editor__hint d-none" data-zone-hint>${hint}</div>
        <div class="zone-editor__actions d-none" data-zone-actions>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-zone-undo>
            <span class="fas fa-undo me-1"></span>Undo
          </button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-zone-clear>
            <span class="fas fa-trash-alt me-1"></span>Clear
          </button>
          <button type="button" class="btn btn-sm btn-primary" data-zone-save>
            <span class="fas fa-check me-1"></span>Save ${isLineMode ? 'Line' : 'Zone'}
          </button>
        </div>
          </div>
        `;

    return container;
  }

  /**
   * Show error state in zone editor
   * @param {HTMLElement} container - Zone editor container
   * @param {string} message - Error message
   * @param {boolean} isWarning - Whether to show as warning (yellow) vs error (red)
   */
  function showEditorError(container, message, isWarning = false) {
    const statusEl = container.querySelector('[data-zone-status]');
    if (!statusEl) return;
    
    const colorClass = isWarning ? 'text-warning' : 'text-danger';
    const icon = isWarning ? 'fa-exclamation-triangle' : 'fa-times-circle';
    
    statusEl.innerHTML = `
      <div class="${colorClass}">
        <span class="fas ${icon} me-2"></span>
        ${escapeHtml(message)}
      </div>
    `;
    statusEl.classList.remove('d-none');
  }

  /**
   * Show the drawing canvas and hide loading state
   * @param {HTMLElement} container - Zone editor container
   */
  function showDrawingCanvas(container) {
    const statusEl = container.querySelector('[data-zone-status]');
    const canvasWrap = container.querySelector('[data-canvas-wrap]');
    const hint = container.querySelector('[data-zone-hint]');
    const actions = container.querySelector('[data-zone-actions]');
    
    if (statusEl) statusEl.classList.add('d-none');
    if (canvasWrap) canvasWrap.classList.remove('d-none');
    if (hint) hint.classList.remove('d-none');
    if (actions) actions.classList.remove('d-none');
  }

  // ============================================================
  // POLYGON/LINE DRAWING LOGIC
  // ============================================================

  /**
   * Initialize the drawing canvas and event handlers
   * @param {HTMLElement} container - Zone editor container
   * @param {string} mode - 'polygon' or 'line'
   * @param {string} cameraId - Camera ID
   * @param {number|null} imageWidth - Original image width
   * @param {number|null} imageHeight - Original image height
   */
  function initializeDrawingCanvas(container, mode, cameraId, imageWidth, imageHeight) {
    const imgEl = container.querySelector('[data-zone-img]');
    const canvasEl = container.querySelector('[data-zone-canvas]');
    const btnUndo = container.querySelector('[data-zone-undo]');
    const btnClear = container.querySelector('[data-zone-clear]');
    const btnSave = container.querySelector('[data-zone-save]');
    const statusEl = container.querySelector('[data-zone-status]');
    
    if (!canvasEl || !imgEl) {
      console.error('[ZoneEditor] Canvas or image element not found');
      return;
    }

    const isLineMode = mode === 'line';
    const points = [];
    let isDisabled = false;

    /**
     * Resize canvas to match image display size
     */
    function resizeCanvas() {
      if (!imgEl.naturalWidth || !imgEl.naturalHeight) return;
      
      const rect = imgEl.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      
      if (canvasEl.width !== w) canvasEl.width = w;
      if (canvasEl.height !== h) canvasEl.height = h;
      
      draw();
    }

    /**
     * Draw the current polygon/line on canvas
     */
    function draw() {
      const ctx = canvasEl.getContext('2d');
      if (!ctx) return;
      
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

      // Draw shape
      if (isLineMode) {
        if (points.length === 2) {
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          ctx.lineTo(points[1].x, points[1].y);
          ctx.strokeStyle = 'rgba(42, 123, 228, 0.95)';
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      } else {
        if (points.length >= 2) {
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 1; i < points.length; i++) {
            ctx.lineTo(points[i].x, points[i].y);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(42, 123, 228, 0.20)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(42, 123, 228, 0.95)';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Draw points
      ctx.fillStyle = 'rgba(42, 123, 228, 1)';
      for (const p of points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
        
        // White border for visibility
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    /**
     * Get click position relative to canvas
     * @param {MouseEvent} ev
     * @returns {{x: number, y: number}}
     */
    function getClickPoint(ev) {
      const rect = canvasEl.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      return {
        x: Math.max(0, Math.min(rect.width, x)),
        y: Math.max(0, Math.min(rect.height, y))
      };
    }

    /**
     * Convert points to normalized coordinates (0-1 range)
     * @returns {Array<[number, number]>|null}
     */
    function getNormalizedCoordinates() {
      const w = canvasEl.width;
      const h = canvasEl.height;
      if (w <= 0 || h <= 0) return null;
      
      return points.map(p => [
        Math.max(0, Math.min(1, p.x / w)),
        Math.max(0, Math.min(1, p.y / h))
      ]);
    }

    /**
     * Enable/disable the editor controls
     * @param {boolean} disabled
     */
    function setDisabled(disabled) {
      isDisabled = disabled;
      [btnUndo, btnClear, btnSave].forEach(btn => {
        if (btn) btn.disabled = disabled;
      });
      canvasEl.style.pointerEvents = disabled ? 'none' : 'auto';
    }

    /**
     * Show temporary status message
     * @param {string} message
     * @param {string} type - 'error', 'warning', 'success'
     */
    function showStatus(message, type = 'error') {
      if (!statusEl) return;
      
      const colors = {
        error: 'text-danger',
        warning: 'text-warning',
        success: 'text-success'
      };
      
      statusEl.innerHTML = `<span class="${colors[type] || colors.error}">${escapeHtml(message)}</span>`;
      statusEl.classList.remove('d-none');
      
      if (type !== 'error') {
        setTimeout(() => {
          statusEl.classList.add('d-none');
        }, 3000);
      }
    }

    // ============================================================
    // EVENT HANDLERS
    // ============================================================

    // Canvas click - add point
    canvasEl.addEventListener('click', (ev) => {
      if (isDisabled) return;
      ev.preventDefault();
      ev.stopPropagation();
      
      if (isLineMode) {
        if (points.length >= 2) {
          // Replace second point
          points[1] = getClickPoint(ev);
        } else {
          points.push(getClickPoint(ev));
        }
      } else {
        points.push(getClickPoint(ev));
      }
      
      draw();
    });

    // Undo button
    btnUndo?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      points.pop();
      draw();
    });

    // Clear button
    btnClear?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      points.length = 0;
      draw();
    });

    // Save button
    btnSave?.addEventListener('click', async (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      
      // Validate points
      if (isLineMode) {
        if (points.length !== 2) {
          showStatus('Please draw exactly 2 points (start and end).', 'warning');
          return;
        }
      } else {
        if (points.length < 3) {
          showStatus('Please draw at least 3 points for a polygon.', 'warning');
          return;
        }
      }

      const coords = getNormalizedCoordinates();
      if (!coords) {
        showStatus('Failed to calculate coordinates. Please try again.', 'error');
        return;
      }

      // Build zone data payload
      const zoneData = {
        zone: {
          type: mode,
          coordinates: coords
        },
        image: {
          width: imageWidth || imgEl.naturalWidth || null,
          height: imageHeight || imgEl.naturalHeight || null
        },
        camera_id: cameraId
      };

      console.log('[ZoneEditor] Saving zone:', zoneData);
      console.log('[ZoneEditor] Checking sendTextMessageFn:', {
        exists: !!sendTextMessageFn,
        type: typeof sendTextMessageFn,
        isFunction: typeof sendTextMessageFn === 'function'
      });

      // Disable editor and send message
      setDisabled(true);
      
      try {
        const confirmMessage = isLineMode 
          ? 'Counting line selected. Please continue.'
          : 'Zone selected. Please continue.';
        
        if (sendTextMessageFn && typeof sendTextMessageFn === 'function') {
          console.log('[ZoneEditor] ✅ Calling sendTextMessage with:', confirmMessage);
          await sendTextMessageFn(confirmMessage, { zoneData });
          console.log('[ZoneEditor] ✅ sendTextMessage call completed');
        } else {
          console.error('[ZoneEditor] ❌ sendTextMessage function not available!', {
            sendTextMessageFn: sendTextMessageFn,
            type: typeof sendTextMessageFn,
            windowChatbotZoneEditor: typeof window.ChatbotZoneEditor
          });
          showStatus('Could not send zone data. Please try again.', 'error');
          setDisabled(false);
        }
      } catch (err) {
        console.error('[ZoneEditor] ❌ Error sending zone:', err);
        showStatus('Failed to save zone. Please try again.', 'error');
        setDisabled(false);
      }
    });

    // Image load handler
    imgEl.addEventListener('load', () => {
      console.log('[ZoneEditor] Image loaded successfully');
      requestAnimationFrame(() => {
        resizeCanvas();
        requestAnimationFrame(resizeCanvas);
      });
    });

    // Image error handler
    imgEl.addEventListener('error', () => {
      console.error('[ZoneEditor] Image failed to load');
      showEditorError(container, 'Failed to display camera image. Please try again.');
    });

    // Window resize handler
    const resizeHandler = () => requestAnimationFrame(resizeCanvas);
    window.addEventListener('resize', resizeHandler, { passive: true });

    // Initial resize after short delay
    setTimeout(resizeCanvas, 100);
    setTimeout(resizeCanvas, 500);
  }

  // ============================================================
  // MAIN API
  // ============================================================

  /**
   * Open zone editor in an assistant message bubble
   * @param {string} pendingId - Pending message ID
   * @param {string} cameraId - Camera ID
   * @param {string} zoneMode - 'polygon' or 'line'
   * @param {string|null} snapshotUrl - Optional snapshot URL
   */
  async function openZoneEditorInBubble(pendingId, cameraId, zoneMode = 'polygon', snapshotUrl = null) {
    console.log('[ZoneEditor] openZoneEditorInBubble called:', {
      pendingId,
      cameraId,
      zoneMode,
      snapshotUrl
    });

    // Validate inputs
    if (!cameraId) {
      console.error('[ZoneEditor] No camera ID provided');
        return;
      }

    // Find the assistant bubble
    let bubble = null;
    let attempts = 0;
    const maxAttempts = 30;

    while (!bubble && attempts < maxAttempts) {
      const result = findAssistantBubble(pendingId);
      bubble = result.bubble;
      
      if (!bubble) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (!bubble) {
      console.error('[ZoneEditor] Could not find assistant bubble for:', pendingId);
      // Fallback: create standalone editor
      await createStandaloneEditor(cameraId, zoneMode, snapshotUrl);
      return;
    }

    // Check if editor already exists
    const editorId = generateEditorId();
    const existingEditor = bubble.querySelector('[data-zone-editor]');
    if (existingEditor) {
      console.log('[ZoneEditor] Editor already exists in bubble');
      return;
    }

    // Create and append editor
    const mode = zoneMode === 'line' ? 'line' : 'polygon';
    const editorEl = createZoneEditorElement(editorId, cameraId, mode);
    bubble.appendChild(editorEl);

    // Scroll to editor
    const messagesEl = getMessagesEl();
    if (messagesEl) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // Load snapshot and initialize canvas
    try {
      const snapshot = await fetchCameraSnapshot(cameraId, snapshotUrl);
      
      // Set image source
      const imgEl = editorEl.querySelector('[data-zone-img]');
      if (imgEl) {
        imgEl.src = snapshot.imageUrl;
      }

      // Show canvas and initialize drawing
      showDrawingCanvas(editorEl);
      initializeDrawingCanvas(editorEl, mode, cameraId, snapshot.width, snapshot.height);
      
      console.log('[ZoneEditor] Zone editor initialized successfully');
      
    } catch (error) {
      console.error('[ZoneEditor] Failed to initialize:', error);
      
      const isStreamingError = error.message?.includes('not streaming') || 
                               error.message?.includes('start the camera');
      showEditorError(editorEl, error.message, isStreamingError);
    }
  }

  /**
   * Create a standalone zone editor when bubble lookup fails
   * @param {string} cameraId - Camera ID
   * @param {string} zoneMode - 'polygon' or 'line'
   * @param {string|null} snapshotUrl - Optional snapshot URL
   */
  async function createStandaloneEditor(cameraId, zoneMode, snapshotUrl) {
    console.log('[ZoneEditor] Creating standalone editor');
    
    const messagesEl = getMessagesEl();
    if (!messagesEl) {
      console.error('[ZoneEditor] Cannot create standalone editor: no messages container');
      return;
    }
    
    // Create container
    const wrapper = document.createElement('div');
    wrapper.className = 'd-flex flex-column align-items-start mt-3';
    
    const bubble = document.createElement('div');
    bubble.className = 'ai-message-transparent fs-9 text-body-emphasis';
    bubble.style.width = '100%';
    wrapper.appendChild(bubble);
    
    messagesEl.appendChild(wrapper);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Create and add editor
    const editorId = generateEditorId();
    const mode = zoneMode === 'line' ? 'line' : 'polygon';
    const editorEl = createZoneEditorElement(editorId, cameraId, mode);
    bubble.appendChild(editorEl);

    // Load snapshot and initialize
    try {
      const snapshot = await fetchCameraSnapshot(cameraId, snapshotUrl);
      
      const imgEl = editorEl.querySelector('[data-zone-img]');
      if (imgEl) {
        imgEl.src = snapshot.imageUrl;
      }

      showDrawingCanvas(editorEl);
      initializeDrawingCanvas(editorEl, mode, cameraId, snapshot.width, snapshot.height);
      
    } catch (error) {
      const isStreamingError = error.message?.includes('not streaming');
      showEditorError(editorEl, error.message, isStreamingError);
    }
  }

  /**
   * Initialize the zone editor module
   * @param {Object} deps - Dependencies
   * @param {HTMLElement} deps.messagesEl - Messages container element
   * @param {Function} deps.sendTextMessage - Function to send chat messages
   */
  function init(deps) {
    console.log('[ZoneEditor] init() called with deps:', {
      hasMessagesEl: !!deps?.messagesEl,
      hasSendTextMessage: !!deps?.sendTextMessage,
      sendTextMessageType: typeof deps?.sendTextMessage
    });
    
    if (deps?.messagesEl) {
      cachedMessagesEl = deps.messagesEl;
    }
    
    if (deps?.sendTextMessage && typeof deps.sendTextMessage === 'function') {
      sendTextMessageFn = deps.sendTextMessage;
      console.log('[ZoneEditor] ✅ sendTextMessage function stored successfully');
    } else {
      console.error('[ZoneEditor] ❌ sendTextMessage function NOT provided or invalid!', {
        provided: !!deps?.sendTextMessage,
        type: typeof deps?.sendTextMessage
      });
    }
    
    console.log('[ZoneEditor] Module initialized. sendTextMessageFn is now:', typeof sendTextMessageFn);
  }

  // ============================================================
  // EXPORT
  // ============================================================

  window.ChatbotZoneEditor = {
    init,
    openZoneEditorInBubble
  };

  // Check for pending dependencies (if core loaded before this module)
  if (window.ChatbotZoneEditorPendingDeps) {
    console.log('[ZoneEditor] ⚠️ Found pending dependencies, initializing now');
    init(window.ChatbotZoneEditorPendingDeps);
    delete window.ChatbotZoneEditorPendingDeps;
  } else {
    console.log('[ZoneEditor] ℹ️ No pending dependencies found (will wait for explicit init call)');
  }

})();

