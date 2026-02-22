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
    
    if (freshMessagesEl) cachedMessagesEl = freshMessagesEl;
    
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
      if (lastBubble) return { node: lastMsg, bubble: lastBubble };
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

      return {
        imageUrl,
        width: data.width || null,
        height: data.height || null
      };

    } catch (error) {
      const errorMsg = error?.message || 'Failed to load camera snapshot';
      if (errorMsg.includes('401') || errorMsg.includes('unauthorized')) {
        throw new Error('Authentication failed. Please log in again.');
      }
      if (errorMsg.includes('404') || errorMsg.includes('No frame') || errorMsg.includes('not found') ||
          errorMsg.includes('offline') || errorMsg.includes('unreachable') || errorMsg.includes('503')) {
        throw new Error('Camera is offline or unreachable. Please check the connection and try again.');
      }

      throw new Error(errorMsg);
    }
  }

  // ============================================================
  // ZONE DRAW BUBBLE (image + Draw button; drawing happens in modal)
  // ============================================================

  /**
   * Create the bubble content: image, hover hint "Click Draw to draw a zone", and Draw button.
   * Clicking Draw opens the zone editor in a centered modal.
   * @param {string} editorId - Unique ID
   * @param {string} cameraId - Camera ID
   * @param {string} mode - 'polygon' or 'line'
   * @returns {HTMLElement}
   */
  function createZoneDrawBubbleElement(editorId, cameraId, mode) {
    const container = document.createElement('div');
    container.className = 'zone-draw-bubble';
    container.setAttribute('data-zone-draw-bubble', editorId);
    container.setAttribute('data-zone-mode', mode);
    container.setAttribute('data-camera-id', cameraId);

    container.innerHTML = `
      <div class="zone-draw-bubble__status" data-zone-draw-status>
        <div class="d-flex align-items-center gap-2">
          <span class="spinner-border spinner-border-sm text-primary"></span>
          <span>Loading camera snapshot...</span>
        </div>
      </div>
      <div class="zone-draw-bubble__content d-none" data-zone-draw-content>
        <div class="zone-draw-bubble__img-wrap" data-zone-draw-img-wrap>
          <img class="zone-draw-bubble__img" alt="Camera snapshot" data-zone-draw-img />
          <div class="zone-draw-bubble__hint" data-zone-draw-hint>Click Draw to draw a zone</div>
        </div>
        <button type="button" class="btn btn-sm btn-primary mt-2" data-zone-draw-btn>
          <span class="fas fa-draw-polygon me-1"></span>Draw
        </button>
      </div>
    `;
    return container;
  }

  /**
   * Show error in zone-draw-bubble (e.g. snapshot failed)
   * @param {HTMLElement} container - zone-draw-bubble container
   * @param {string} message - Error message
   * @param {function|null} onRetry - Optional retry callback
   */
  function showZoneDrawBubbleError(container, message, onRetry = null) {
    const statusEl = container.querySelector('[data-zone-draw-status]');
    if (!statusEl) return;
    statusEl.innerHTML = `
      <div class="text-danger d-flex flex-column gap-2">
        <div><span class="fas fa-times-circle me-2"></span>${escapeHtml(message)}</div>
        ${onRetry ? '<button type="button" class="btn btn-sm btn-outline-primary align-self-start" data-zone-draw-retry><span class="fas fa-redo me-1"></span>Retry</button>' : ''}
      </div>
    `;
    const retryBtn = statusEl.querySelector('[data-zone-draw-retry]');
    if (retryBtn && typeof onRetry === 'function') {
      retryBtn.addEventListener('click', function () {
        retryBtn.disabled = true;
        retryBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Retrying...';
        onRetry().catch(() => {
          retryBtn.disabled = false;
          retryBtn.innerHTML = '<span class="fas fa-redo me-1"></span>Retry';
        });
      });
    }
  }

  /**
   * Get or create the zone editor modal (centered, appended to body)
   * @returns {{ modalEl: HTMLElement, bodyEl: HTMLElement, show: function, hide: function }}
   */
  function getOrCreateZoneEditorModal() {
    const id = 'zone-editor-modal';
    let modalEl = document.getElementById(id);
    if (modalEl) {
      const bodyEl = modalEl.querySelector('.zone-editor-modal__body');
      const bsModal = window.bootstrap?.Modal?.getOrCreateInstance?.(modalEl);
      return {
        modalEl,
        bodyEl: bodyEl || modalEl.querySelector('.modal-body'),
        show: () => bsModal?.show?.(),
        hide: () => bsModal?.hide?.()
      };
    }

    modalEl = document.createElement('div');
    modalEl.className = 'modal fade';
    modalEl.id = id;
    modalEl.setAttribute('tabindex', '-1');
    modalEl.setAttribute('aria-labelledby', id + '-label');
    modalEl.setAttribute('aria-hidden', 'true');
    const isLineMode = false; // title set when we open
    modalEl.innerHTML = `
      <div class="modal-dialog modal-dialog-centered zone-editor-modal__dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="${id}-label" data-zone-modal-title>Draw Monitoring Zone</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
          </div>
          <div class="modal-body zone-editor-modal__body"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modalEl);
    const bodyEl = modalEl.querySelector('.zone-editor-modal__body');
    const bsModal = window.bootstrap ? new window.bootstrap.Modal(modalEl) : null;
    if (bsModal) {
      modalEl.addEventListener('hidden.bs.modal', function () {
        bsModal.dispose();
      });
    }
    return {
      modalEl,
      bodyEl,
      show: () => bsModal?.show?.(),
      hide: () => bsModal?.hide?.()
    };
  }

  /**
   * Open the zone editor inside the centered modal. Image and canvas load here so drawing is stable.
   * @param {Object} snapshot - { imageUrl, width, height }
   * @param {string} cameraId - Camera ID
   * @param {string} mode - 'polygon' or 'line'
   * @param {function|null} saveWithResumeFn - On save (HITL) callback
   */
  function openModalWithZoneEditor(snapshot, cameraId, mode, saveWithResumeFn) {
    const modal = getOrCreateZoneEditorModal();
    if (!modal.bodyEl) return;

    const editorId = generateEditorId();
    const isLineMode = mode === 'line';
    const titleEl = modal.modalEl.querySelector('[data-zone-modal-title]');
    if (titleEl) titleEl.textContent = isLineMode ? 'Draw Counting Line' : 'Draw Monitoring Zone';

    modal.bodyEl.innerHTML = '';
    const editorEl = createZoneEditorElement(editorId, cameraId, mode, saveWithResumeFn);
    editorEl._onSaveDone = () => modal.hide();

    modal.bodyEl.appendChild(editorEl);

    showDrawingCanvas(editorEl);
    const imgEl = editorEl.querySelector('[data-zone-img]');
    if (imgEl) imgEl.src = snapshot.imageUrl;
    initializeDrawingCanvas(editorEl, mode, cameraId, snapshot.width, snapshot.height);

    modal.show();
  }

  // ============================================================
  // ZONE EDITOR UI BUILDER (used inside modal)
  // ============================================================

  /**
   * Create the zone editor HTML structure
   * @param {string} editorId - Unique editor ID
   * @param {string} cameraId - Camera ID
   * @param {string} mode - 'polygon' or 'line'
   * @param {function|null} saveWithResumeFn - If set, on Save call this with zoneData (for HITL resume) instead of sendTextMessage
   * @returns {HTMLElement}
   */
  function createZoneEditorElement(editorId, cameraId, mode, saveWithResumeFn = null) {
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

    if (saveWithResumeFn) container._saveWithResumeFn = saveWithResumeFn;
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
   * Show error state with Retry button (for camera offline / snapshot fetch failure)
   * @param {HTMLElement} container - Zone editor container
   * @param {string} message - Error message (e.g. "Camera is offline or unreachable.")
   * @param {function(): Promise<void>} onRetry - Async function to call when Retry is clicked
   */
  function showEditorErrorWithRetry(container, message, onRetry) {
    const statusEl = container.querySelector('[data-zone-status]');
    if (!statusEl) return;

    const userMsg = message || 'Camera is offline or unreachable. Please check the connection and try again.';

    statusEl.innerHTML = `
      <div class="text-danger d-flex flex-column gap-2">
        <div>
          <span class="fas fa-times-circle me-2"></span>
          ${escapeHtml(userMsg)}
        </div>
        <button type="button" class="btn btn-sm btn-outline-primary align-self-start" data-zone-retry>
          <span class="fas fa-redo me-1"></span>Retry
        </button>
      </div>
    `;
    statusEl.classList.remove('d-none');

    const retryBtn = statusEl.querySelector('[data-zone-retry]');
    if (retryBtn && typeof onRetry === 'function') {
      retryBtn.addEventListener('click', async function () {
        retryBtn.disabled = true;
        retryBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Retrying...';
        try {
          await onRetry();
        } catch (err) {
          retryBtn.disabled = false;
          retryBtn.innerHTML = '<span class="fas fa-redo me-1"></span>Retry';
          showEditorErrorWithRetry(container, err?.message || userMsg, onRetry);
        }
      });
    }
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
    if (canvasWrap) {
      canvasWrap.classList.remove('d-none');
      canvasWrap.style.display = 'block';
      canvasWrap.style.visibility = 'visible';
      canvasWrap.style.minHeight = '220px';
    }
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
    const saveWithResumeFn = container._saveWithResumeFn || null;
    const imgEl = container.querySelector('[data-zone-img]');
    const canvasEl = container.querySelector('[data-zone-canvas]');
    const btnUndo = container.querySelector('[data-zone-undo]');
    const btnClear = container.querySelector('[data-zone-clear]');
    const btnSave = container.querySelector('[data-zone-save]');
    const statusEl = container.querySelector('[data-zone-status]');
    
    if (!canvasEl || !imgEl) return;

    const isLineMode = mode === 'line';
    const points = [];
    let isDisabled = false;

    /**
     * Resize canvas to match image display size.
     * When chat width (or any container) changes, canvas must stay in sync or click coords are wrong.
     * Scales existing points so dots stay in the same visual place after resize.
     */
    function resizeCanvas() {
      if (!imgEl.naturalWidth || !imgEl.naturalHeight) return;
      
      const rect = imgEl.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      
      const oldW = canvasEl.width;
      const oldH = canvasEl.height;
      const sizeChanged = (oldW !== w || oldH !== h);
      
      if (sizeChanged && oldW > 0 && oldH > 0) {
        points.length = 0;
      }
      
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

      // Disable editor and send message
      setDisabled(true);
      
      try {
        if (saveWithResumeFn && typeof saveWithResumeFn === 'function') {
          await saveWithResumeFn(zoneData);
        } else {
          const confirmMessage = isLineMode
            ? 'Counting line selected. Please continue.'
            : 'Zone selected. Please continue.';
          if (sendTextMessageFn && typeof sendTextMessageFn === 'function') {
            await sendTextMessageFn(confirmMessage, { zoneData });
          } else {
            showStatus('Could not send zone data. Please try again.', 'error');
            setDisabled(false);
            return;
          }
        }
        if (container._onSaveDone && typeof container._onSaveDone === 'function') {
          container._onSaveDone();
        }
      } catch (err) {
        showStatus('Failed to save zone. Please try again.', 'error');
        setDisabled(false);
      }
    });

    // Image load handler — must be attached before setting img.src so we never miss the event
    // (when snapshot is cached, load can fire immediately; attaching after set src would miss it)
    function onImageReady() {
      if (!imgEl.naturalWidth || !imgEl.naturalHeight) return;
      const canvasWrap = container.querySelector('[data-canvas-wrap]');
      if (canvasWrap) canvasWrap.style.minHeight = '';
      requestAnimationFrame(() => {
        resizeCanvas();
        requestAnimationFrame(resizeCanvas);
      });
    }
    imgEl.addEventListener('load', onImageReady);

    imgEl.addEventListener('error', function () {
      showEditorError(container, 'Failed to display camera image. Please try again.');
    });

    // Window resize handler
    const resizeHandler = () => requestAnimationFrame(resizeCanvas);
    window.addEventListener('resize', resizeHandler, { passive: true });

    // When modal or container is resized, ResizeObserver fires: we clear points and redraw (fresh canvas).
    let resizeObserver = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        points.length = 0;
        requestAnimationFrame(resizeCanvas);
      });
      resizeObserver.observe(imgEl);
    }

    // Initial resize after short delay (layout may not be ready yet)
    setTimeout(resizeCanvas, 100);
    setTimeout(resizeCanvas, 500);
  }

  // ============================================================
  // MAIN API
  // ============================================================

  /**
   * Open zone draw UI in an assistant message bubble: image + hover hint + Draw button.
   * Clicking Draw opens the zone editor in a centered modal (stable, no layout issues).
   * @param {string} pendingId - Pending message ID
   * @param {string} cameraId - Camera ID
   * @param {string} zoneMode - 'polygon' or 'line'
   * @param {string|null} snapshotUrl - Optional snapshot URL
   * @param {{ saveWithResume?: function }|null} options - Optional. saveWithResume(zoneData) used for HITL resume instead of sendTextMessage
   */
  async function openZoneEditorInBubble(pendingId, cameraId, zoneMode = 'polygon', snapshotUrl = null, options = null) {
    const saveWithResumeFn = (options && options.saveWithResume) ? options.saveWithResume : null;

    if (!cameraId) return;

    // Find the assistant bubble
    let bubble = null;
    let attempts = 0;
    const maxAttempts = 30;

    while (!bubble && attempts < maxAttempts) {
      const result = findAssistantBubble(pendingId);
      bubble = result.bubble;
      
      if (!bubble) {
        attempts++;
        await new Promise(function (resolve) { setTimeout(resolve, 100); });
      }
    }

    if (!bubble) {
      await createStandaloneEditor(cameraId, zoneMode, snapshotUrl, saveWithResumeFn);
      return;
    }

    // Remove existing draw bubble so second open gets a fresh one (new fetch, working Draw button)
    const existingDrawBubble = bubble.querySelector('[data-zone-draw-bubble]');
    if (existingDrawBubble) existingDrawBubble.remove();

    const editorId = generateEditorId();
    const mode = zoneMode === 'line' ? 'line' : 'polygon';
    const drawBubbleEl = createZoneDrawBubbleElement(editorId, cameraId, mode);
    bubble.appendChild(drawBubbleEl);

    const messagesContainer = getMessagesEl();
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
    drawBubbleEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    const statusEl = drawBubbleEl.querySelector('[data-zone-draw-status]');
    const contentEl = drawBubbleEl.querySelector('[data-zone-draw-content]');
    const imgEl = drawBubbleEl.querySelector('[data-zone-draw-img]');
    const drawBtn = drawBubbleEl.querySelector('[data-zone-draw-btn]');

    const loadAndShow = async () => {
      const snapshot = await fetchCameraSnapshot(cameraId, snapshotUrl);
      if (statusEl) statusEl.classList.add('d-none');
      if (contentEl) contentEl.classList.remove('d-none');
      if (imgEl) imgEl.src = snapshot.imageUrl;
      drawBubbleEl._snapshot = snapshot;
      drawBtn.onclick = function () {
        if (drawBubbleEl._snapshot) {
          openModalWithZoneEditor(drawBubbleEl._snapshot, cameraId, mode, saveWithResumeFn);
        }
      };
    };

    try {
      await loadAndShow();
    } catch (error) {
      const isOffline = error.message?.includes('offline') || error.message?.includes('unreachable') ||
                       error.message?.includes('not streaming') || error.message?.includes('503');
      showZoneDrawBubbleError(drawBubbleEl, error.message, isOffline ? loadAndShow : null);
    }
  }

  /**
   * Create a standalone zone-draw bubble when bubble lookup fails (same image + Draw → modal flow)
   * @param {string} cameraId - Camera ID
   * @param {string} zoneMode - 'polygon' or 'line'
   * @param {string|null} snapshotUrl - Optional snapshot URL
   * @param {function|null} saveWithResumeFn - Optional HITL save callback
   */
  async function createStandaloneEditor(cameraId, zoneMode, snapshotUrl, saveWithResumeFn = null) {
    const messagesContainer = getMessagesEl();
    if (!messagesContainer) return;

    const mode = zoneMode === 'line' ? 'line' : 'polygon';
    const editorId = generateEditorId();
    const drawBubbleEl = createZoneDrawBubbleElement(editorId, cameraId, mode);

    const wrapper = document.createElement('div');
    wrapper.className = 'd-flex flex-column align-items-start mt-3';
    const bubble = document.createElement('div');
    bubble.className = 'ai-message-transparent fs-9 text-body-emphasis';
    bubble.style.width = '100%';
    wrapper.appendChild(bubble);
    bubble.appendChild(drawBubbleEl);
    messagesContainer.appendChild(wrapper);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    const statusEl = drawBubbleEl.querySelector('[data-zone-draw-status]');
    const contentEl = drawBubbleEl.querySelector('[data-zone-draw-content]');
    const imgEl = drawBubbleEl.querySelector('[data-zone-draw-img]');
    const drawBtn = drawBubbleEl.querySelector('[data-zone-draw-btn]');

    const loadAndShow = async () => {
      const snapshot = await fetchCameraSnapshot(cameraId, snapshotUrl);
      if (statusEl) statusEl.classList.add('d-none');
      if (contentEl) contentEl.classList.remove('d-none');
      if (imgEl) imgEl.src = snapshot.imageUrl;
      drawBubbleEl._snapshot = snapshot;
      drawBtn.onclick = function () {
        if (drawBubbleEl._snapshot) {
          openModalWithZoneEditor(drawBubbleEl._snapshot, cameraId, mode, saveWithResumeFn);
        }
      };
    };

    try {
      await loadAndShow();
    } catch (error) {
      const isOffline = error.message?.includes('offline') || error.message?.includes('unreachable') ||
                       error.message?.includes('not streaming') || error.message?.includes('503');
      showZoneDrawBubbleError(drawBubbleEl, error.message, isOffline ? loadAndShow : null);
    }
  }

  /**
   * Initialize the zone editor module
   * @param {Object} deps - Dependencies
   * @param {HTMLElement} deps.messagesEl - Messages container element
   * @param {Function} deps.sendTextMessage - Function to send chat messages
   */
  function init(deps) {
    if (deps?.messagesEl) cachedMessagesEl = deps.messagesEl;
    if (deps?.sendTextMessage && typeof deps.sendTextMessage === 'function') {
      sendTextMessageFn = deps.sendTextMessage;
    }
  }

  // ============================================================
  // EXPORT
  // ============================================================

  window.ChatbotZoneEditor = {
    init,
    openZoneEditorInBubble
  };

  if (window.ChatbotZoneEditorPendingDeps) {
    init(window.ChatbotZoneEditorPendingDeps);
    delete window.ChatbotZoneEditorPendingDeps;
  }

})();

