import { api } from '../../core/api.js';
/**
 * CHATBOT ZONE EDITOR MODULE (ES Module)
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

function generateEditorId() {
  return `zone_editor_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

let cachedMessagesEl = null;
let sendTextMessageFn = null;

function getMessagesEl() {
  if (cachedMessagesEl && cachedMessagesEl.isConnected) return cachedMessagesEl;
  const chatbotOffcanvas = document.getElementById('chatbot-offcanvas');
  const freshMessagesEl = chatbotOffcanvas?.querySelector?.('.chat-messages');
  if (freshMessagesEl) cachedMessagesEl = freshMessagesEl;
  return cachedMessagesEl;
}

function findAssistantBubble(pendingId) {
  const messagesEl = getMessagesEl();
  if (!messagesEl) return { node: null, bubble: null };

  let node = messagesEl.querySelector(`[data-chatbot-pending="${pendingId}"]`);
  let bubble = node?.querySelector?.('.ai-message-transparent, .markdown-content, div');
  if (bubble) return { node, bubble };

  const allAssistant = messagesEl.querySelectorAll('.d-flex.flex-column.align-items-start');
  if (allAssistant.length > 0) {
    const lastMsg = allAssistant[allAssistant.length - 1];
    const lastBubble = lastMsg.querySelector('.ai-message-transparent, .markdown-content, div');
    if (lastBubble) return { node: lastMsg, bubble: lastBubble };
  }

  return { node: null, bubble: null };
}

async function fetchCameraSnapshot(cameraId, snapshotUrl = null) {
  if (!api) throw new Error('API service not available. Please refresh the page.');

  const url = snapshotUrl || `/api/v1/cameras/${encodeURIComponent(cameraId)}/snapshot`;

  try {
    const data = await api.getCameraSnapshotFromUrl(url);
    if (!data?.frame_base64) throw new Error('No image data in response');

    let base64String = data.frame_base64;
    if (base64String.includes(',')) base64String = base64String.split(',')[1];

    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(base64String)) throw new Error('Invalid image data format');

    const binaryString = atob(base64String);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

    const blob = new Blob([bytes], { type: 'image/jpeg' });
    if (blob.size === 0) throw new Error('Empty image data');

    const imageUrl = URL.createObjectURL(blob);
    return { imageUrl, width: data.width || null, height: data.height || null };
  } catch (error) {
    const errorMsg = error?.message || 'Failed to load camera snapshot';
    if (errorMsg.includes('401') || errorMsg.includes('unauthorized')) throw new Error('Authentication failed. Please log in again.');
    if (errorMsg.includes('404') || errorMsg.includes('No frame') || errorMsg.includes('not found') ||
        errorMsg.includes('offline') || errorMsg.includes('unreachable') || errorMsg.includes('503')) {
      throw new Error('Camera is offline or unreachable. Please check the connection and try again.');
    }
    throw new Error(errorMsg);
  }
}

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
      <div class="zone-draw-bubble__img-wrap" data-zone-draw-img-wrap style="cursor:pointer;">
        <img class="zone-draw-bubble__img" alt="Camera snapshot" data-zone-draw-img draggable="false" />
        <div class="zone-draw-bubble__hint" data-zone-draw-hint>Click to draw a zone</div>
      </div>
      <button type="button" class="btn btn-sm btn-primary mt-2" data-zone-draw-btn>
        <span class="fas fa-draw-polygon me-1"></span>Draw
      </button>
    </div>
  `;
  return container;
}

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

function getOrCreateZoneEditorModal() {
  const id = 'zone-editor-modal';
  let modalEl = document.getElementById(id);

  if (!modalEl) {
    modalEl = document.createElement('div');
    modalEl.className = 'modal fade';
    modalEl.id = id;
    modalEl.setAttribute('tabindex', '-1');
    modalEl.setAttribute('aria-labelledby', id + '-label');
    modalEl.setAttribute('aria-hidden', 'true');
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
  }

  const bodyEl = modalEl.querySelector('.zone-editor-modal__body');
  const bsModal = window.bootstrap?.Modal?.getOrCreateInstance?.(modalEl, {
    backdrop: true, keyboard: true, focus: true
  });

  return {
    modalEl,
    bodyEl: bodyEl || modalEl.querySelector('.modal-body'),
    show: () => bsModal?.show?.(),
    hide: () => bsModal?.hide?.()
  };
}

function openModalWithZoneEditor(snapshot, cameraId, mode, saveWithResumeFn) {
  const modal = getOrCreateZoneEditorModal();
  if (!modal.bodyEl) return;

  const isLineMode = mode === 'line';

  function setupAndShow() {
    const editorId = generateEditorId();
    const titleEl = modal.modalEl.querySelector('[data-zone-modal-title]');
    if (titleEl) titleEl.textContent = isLineMode ? 'Draw Counting Line' : 'Draw Monitoring Zone';

    modal.bodyEl.innerHTML = '';
    const editorEl = createZoneEditorElement(editorId, cameraId, mode, saveWithResumeFn);
    editorEl._onSaveDone = () => modal.hide();

    modal.bodyEl.appendChild(editorEl);
    showDrawingCanvas(editorEl);
    initializeDrawingCanvas(editorEl, mode, cameraId, snapshot.width, snapshot.height);
    const imgEl = editorEl.querySelector('[data-zone-img]');
    if (imgEl) imgEl.src = snapshot.imageUrl;

    modal.show();
  }

  const bsInstance = window.bootstrap?.Modal?.getInstance?.(modal.modalEl);
  const isTransitioning = bsInstance?._isTransitioning ?? false;
  const isStillShown = modal.modalEl.classList.contains('show');

  if (isTransitioning || isStillShown) {
    modal.modalEl.addEventListener('hidden.bs.modal', function waitHide() {
      modal.modalEl.removeEventListener('hidden.bs.modal', waitHide);
      setupAndShow();
    });
    if (isStillShown) modal.hide();
  } else {
    setupAndShow();
  }
}

function createZoneEditorElement(editorId, cameraId, mode, saveWithResumeFn = null) {
  const isLineMode = mode === 'line';
  const isRoiMode = mode === 'motion_rois';

  let title = isLineMode ? 'Draw Counting Line' : 'Draw Monitoring Zone';
  let hint = isLineMode
    ? 'Click to set start point, then click again to set end point.'
    : 'Click to add polygon points. Use "Undo" to remove last point. Save needs at least 3 points.';
  let saveLabel = isLineMode ? 'Line' : 'Zone';

  if (isRoiMode) {
    title = 'Draw Motion ROIs (one per machine)';
    hint = 'Draw a polygon around each machine (like restricted zone). Click to add points. Use "Complete this ROI" when done with one machine, then draw the next. Save when all machines are marked.';
    saveLabel = 'ROIs';
  }

  var actionsHtml = '<button type="button" class="btn btn-sm btn-outline-secondary" data-zone-undo><span class="fas fa-undo me-1"></span>Undo</button>' +
    '<button type="button" class="btn btn-sm btn-outline-secondary" data-zone-clear><span class="fas fa-trash-alt me-1"></span>Clear</button>';
  if (isRoiMode) {
    actionsHtml += '<button type="button" class="btn btn-sm btn-outline-primary" data-zone-complete-roi><span class="fas fa-plus-circle me-1"></span>Complete this ROI</button>';
  }
  actionsHtml += '<button type="button" class="btn btn-sm btn-primary" data-zone-save><span class="fas fa-check me-1"></span>Save ' + saveLabel + '</button>';

  const container = document.createElement('div');
  container.className = 'zone-editor';
  container.setAttribute('data-zone-editor', editorId);
  container.setAttribute('data-zone-mode', mode);
  container.innerHTML = `
    <div class="zone-editor__header">
      <div class="zone-editor__title">${title}</div>
      <div class="text-body-tertiary fs-10">Camera: <span class="font-monospace">${escapeHtml(cameraId)}</span></div>
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
      <div class="zone-editor__actions d-none" data-zone-actions>${actionsHtml}</div>
    </div>
  `;

  if (saveWithResumeFn) container._saveWithResumeFn = saveWithResumeFn;
  return container;
}

function showEditorError(container, message, isWarning = false) {
  const statusEl = container.querySelector('[data-zone-status]');
  if (!statusEl) return;
  const colorClass = isWarning ? 'text-warning' : 'text-danger';
  const icon = isWarning ? 'fa-exclamation-triangle' : 'fa-times-circle';
  statusEl.innerHTML = `<div class="${colorClass}"><span class="fas ${icon} me-2"></span>${escapeHtml(message)}</div>`;
  statusEl.classList.remove('d-none');
}

function showEditorErrorWithRetry(container, message, onRetry) {
  const statusEl = container.querySelector('[data-zone-status]');
  if (!statusEl) return;
  const userMsg = message || 'Camera is offline or unreachable. Please check the connection and try again.';
  statusEl.innerHTML = `
    <div class="text-danger d-flex flex-column gap-2">
      <div><span class="fas fa-times-circle me-2"></span>${escapeHtml(userMsg)}</div>
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

function initializeDrawingCanvasMotionRois(container, canvasEl, imgEl, btnUndo, btnClear, btnSave, statusEl, cameraId, imageWidth, imageHeight, saveWithResumeFn) {
  var polygons = [];
  var currentPolygon = [];
  var isDisabled = false;
  var btnCompleteRoi = container.querySelector('[data-zone-complete-roi]');

  function getClickPoint(ev) {
    var rect = canvasEl.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, ev.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, ev.clientY - rect.top))
    };
  }

  function setDisabled(disabled) {
    isDisabled = disabled;
    [btnUndo, btnClear, btnSave, btnCompleteRoi].forEach(function (btn) { if (btn) btn.disabled = disabled; });
    canvasEl.style.pointerEvents = disabled ? 'none' : 'auto';
  }

  function showStatus(message, type) {
    if (!statusEl) return;
    var colors = { error: 'text-danger', warning: 'text-warning', success: 'text-success' };
    statusEl.innerHTML = '<span class="' + (colors[type] || colors.error) + '">' + escapeHtml(message) + '</span>';
    statusEl.classList.remove('d-none');
    if (type !== 'error') setTimeout(function () { statusEl.classList.add('d-none'); }, 3000);
  }

  function resizeCanvas() {
    if (!imgEl.naturalWidth || !imgEl.naturalHeight) return;
    var rect = imgEl.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width));
    var h = Math.max(1, Math.round(rect.height));
    var oldW = canvasEl.width;
    var oldH = canvasEl.height;
    var sizeChanged = (oldW !== w || oldH !== h);
    if (sizeChanged && oldW > 0 && oldH > 0 && (polygons.length > 0 || currentPolygon.length > 0)) {
      var scaleX = w / oldW;
      var scaleY = h / oldH;
      polygons.forEach(function (pts) { pts.forEach(function (p) { p.x *= scaleX; p.y *= scaleY; }); });
      currentPolygon.forEach(function (p) { p.x *= scaleX; p.y *= scaleY; });
    }
    if (canvasEl.width !== w) canvasEl.width = w;
    if (canvasEl.height !== h) canvasEl.height = h;
    draw();
  }

  function draw() {
    var ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    var strokeStyle = 'rgba(42, 123, 228, 0.95)';
    var fillStyle = 'rgba(42, 123, 228, 0.20)';

    function drawPolygon(pts) {
      if (pts.length < 2) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
      ctx.fillStyle = fillStyle;
      ctx.fill();
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    polygons.forEach(drawPolygon);
    drawPolygon(currentPolygon);

    ctx.fillStyle = 'rgba(42, 123, 228, 1)';
    currentPolygon.forEach(function (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  function polygonToBoundingBox(pts) {
    if (pts.length === 0) return null;
    var x1 = pts[0].x, y1 = pts[0].y, x2 = pts[0].x, y2 = pts[0].y;
    pts.forEach(function (p) {
      if (p.x < x1) x1 = p.x; if (p.x > x2) x2 = p.x;
      if (p.y < y1) y1 = p.y; if (p.y > y2) y2 = p.y;
    });
    return { x1, y1, x2, y2 };
  }

  canvasEl.addEventListener('click', function (ev) {
    if (isDisabled) return;
    ev.preventDefault(); ev.stopPropagation();
    currentPolygon.push(getClickPoint(ev));
    draw();
  });

  btnUndo && btnUndo.addEventListener('click', function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    if (currentPolygon.length > 0) currentPolygon.pop();
    else if (polygons.length > 0) polygons.pop();
    draw();
  });

  btnClear && btnClear.addEventListener('click', function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    polygons = []; currentPolygon = [];
    draw();
  });

  btnCompleteRoi && btnCompleteRoi.addEventListener('click', function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    if (currentPolygon.length < 3) { showStatus('Add at least 3 points for this ROI, then click "Complete this ROI".', 'warning'); return; }
    polygons.push(currentPolygon.slice());
    currentPolygon = [];
    showStatus('ROI added. Draw the next machine or click Save.', 'success');
    draw();
  });

  btnSave && btnSave.addEventListener('click', async function (ev) {
    ev.preventDefault(); ev.stopPropagation();
    var allPolygons = polygons.slice();
    if (currentPolygon.length >= 3) allPolygons.push(currentPolygon.slice());
    if (allPolygons.length < 1) { showStatus('Draw at least one polygon (one per machine). Use "Complete this ROI" after each, then Save.', 'warning'); return; }

    var iw = imageWidth || imgEl.naturalWidth || 0;
    var ih = imageHeight || imgEl.naturalHeight || 0;
    if (!iw || !ih) { showStatus('Image dimensions unknown. Please try again.', 'error'); return; }
    var cw = canvasEl.width, ch = canvasEl.height;
    if (cw <= 0 || ch <= 0) { showStatus('Canvas not ready. Please try again.', 'error'); return; }

    var looms = allPolygons.map(function (pts, i) {
      var box = polygonToBoundingBox(pts);
      var ix1 = Math.max(0, Math.min(iw, Math.round((box.x1 / cw) * iw)));
      var iy1 = Math.max(0, Math.min(ih, Math.round((box.y1 / ch) * ih)));
      var ix2 = Math.max(0, Math.min(iw, Math.round((box.x2 / cw) * iw)));
      var iy2 = Math.max(0, Math.min(ih, Math.round((box.y2 / ch) * ih)));
      if (ix2 <= ix1) ix2 = ix1 + 1;
      if (iy2 <= iy1) iy2 = iy1 + 1;
      return { loom_id: 'loom-' + String(i + 1).padStart(2, '0'), name: 'Machine ' + (i + 1), motion_roi: [ix1, iy1, ix2, iy2] };
    });

    var zoneData = { zone: { type: 'motion_rois', looms }, image: { width: iw, height: ih }, camera_id: cameraId };
    console.log('[ZoneEditor] Saving motion_rois zone (polygon → bbox):', zoneData);
    setDisabled(true);
    try {
      if (saveWithResumeFn && typeof saveWithResumeFn === 'function') {
        await saveWithResumeFn(zoneData);
      } else if (sendTextMessageFn && typeof sendTextMessageFn === 'function') {
        await sendTextMessageFn('Motion ROIs selected (' + looms.length + ' machine(s)). Please continue.', { zoneData });
      } else {
        showStatus('Could not send zone data. Please try again.', 'error');
        setDisabled(false);
      }
    } catch (err) {
      console.error('[ZoneEditor] Error sending motion_rois zone:', err);
      showStatus('Failed to save. Please try again.', 'error');
      setDisabled(false);
    }
  });

  imgEl.addEventListener('load', function () {
    var canvasWrap = container.querySelector('[data-canvas-wrap]');
    if (canvasWrap) canvasWrap.style.minHeight = '';
    requestAnimationFrame(resizeCanvas);
    requestAnimationFrame(resizeCanvas);
  });
  imgEl.addEventListener('error', function () { showEditorError(container, 'Failed to display camera image. Please try again.'); });
  window.addEventListener('resize', function () { requestAnimationFrame(resizeCanvas); }, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    var ro = new ResizeObserver(function () { requestAnimationFrame(resizeCanvas); });
    ro.observe(imgEl);
  }
  setTimeout(resizeCanvas, 100);
  setTimeout(resizeCanvas, 500);
}

function initializeDrawingCanvas(container, mode, cameraId, imageWidth, imageHeight) {
  const saveWithResumeFn = container._saveWithResumeFn || null;
  const imgEl = container.querySelector('[data-zone-img]');
  const canvasEl = container.querySelector('[data-zone-canvas]');
  const btnUndo = container.querySelector('[data-zone-undo]');
  const btnClear = container.querySelector('[data-zone-clear]');
  const btnSave = container.querySelector('[data-zone-save]');
  const statusEl = container.querySelector('[data-zone-status]');

  if (!canvasEl || !imgEl) return;

  if (mode === 'motion_rois') {
    initializeDrawingCanvasMotionRois(container, canvasEl, imgEl, btnUndo, btnClear, btnSave, statusEl, cameraId, imageWidth, imageHeight, saveWithResumeFn);
    return;
  }

  const isLineMode = mode === 'line';
  const points = [];
  let isDisabled = false;

  function resizeCanvas() {
    if (!imgEl.naturalWidth || !imgEl.naturalHeight) return;
    const rect = imgEl.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    const oldW = canvasEl.width, oldH = canvasEl.height;
    if ((oldW !== w || oldH !== h) && oldW > 0 && oldH > 0) points.length = 0;
    if (canvasEl.width !== w) canvasEl.width = w;
    if (canvasEl.height !== h) canvasEl.height = h;
    draw();
  }

  function draw() {
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
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
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
        ctx.fillStyle = 'rgba(42, 123, 228, 0.20)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(42, 123, 228, 0.95)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(42, 123, 228, 1)';
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  function getClickPoint(ev) {
    const rect = canvasEl.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, ev.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, ev.clientY - rect.top))
    };
  }

  function getNormalizedCoordinates() {
    const w = canvasEl.width, h = canvasEl.height;
    if (w <= 0 || h <= 0) return null;
    return points.map(p => [Math.max(0, Math.min(1, p.x / w)), Math.max(0, Math.min(1, p.y / h))]);
  }

  function setDisabled(disabled) {
    isDisabled = disabled;
    [btnUndo, btnClear, btnSave].forEach(btn => { if (btn) btn.disabled = disabled; });
    canvasEl.style.pointerEvents = disabled ? 'none' : 'auto';
  }

  function showStatus(message, type = 'error') {
    if (!statusEl) return;
    const colors = { error: 'text-danger', warning: 'text-warning', success: 'text-success' };
    statusEl.innerHTML = `<span class="${colors[type] || colors.error}">${escapeHtml(message)}</span>`;
    statusEl.classList.remove('d-none');
    if (type !== 'error') setTimeout(() => { statusEl.classList.add('d-none'); }, 3000);
  }

  canvasEl.addEventListener('click', (ev) => {
    if (isDisabled) return;
    ev.preventDefault(); ev.stopPropagation();
    if (isLineMode) {
      if (points.length >= 2) points[1] = getClickPoint(ev);
      else points.push(getClickPoint(ev));
    } else {
      points.push(getClickPoint(ev));
    }
    draw();
  });

  btnUndo?.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); points.pop(); draw(); });
  btnClear?.addEventListener('click', (ev) => { ev.preventDefault(); ev.stopPropagation(); points.length = 0; draw(); });

  btnSave?.addEventListener('click', async (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    if (isLineMode) {
      if (points.length !== 2) { showStatus('Please draw exactly 2 points (start and end).', 'warning'); return; }
    } else {
      if (points.length < 3) { showStatus('Please draw at least 3 points for a polygon.', 'warning'); return; }
    }
    const coords = getNormalizedCoordinates();
    if (!coords) { showStatus('Failed to calculate coordinates. Please try again.', 'error'); return; }

    const zoneData = {
      zone: { type: mode, coordinates: coords },
      image: { width: imageWidth || imgEl.naturalWidth || null, height: imageHeight || imgEl.naturalHeight || null },
      camera_id: cameraId
    };

    setDisabled(true);
    try {
      if (saveWithResumeFn && typeof saveWithResumeFn === 'function') {
        await saveWithResumeFn(zoneData);
      } else {
        const confirmMessage = isLineMode ? 'Counting line selected. Please continue.' : 'Zone selected. Please continue.';
        if (sendTextMessageFn && typeof sendTextMessageFn === 'function') {
          await sendTextMessageFn(confirmMessage, { zoneData });
        } else {
          showStatus('Could not send zone data. Please try again.', 'error');
          setDisabled(false);
          return;
        }
      }
      if (container._onSaveDone && typeof container._onSaveDone === 'function') container._onSaveDone();
    } catch (err) {
      showStatus('Failed to save zone. Please try again.', 'error');
      setDisabled(false);
    }
  });

  function onImageReady() {
    if (!imgEl.naturalWidth || !imgEl.naturalHeight) return;
    const canvasWrap = container.querySelector('[data-canvas-wrap]');
    if (canvasWrap) canvasWrap.style.minHeight = '';
    requestAnimationFrame(() => { resizeCanvas(); requestAnimationFrame(resizeCanvas); });
  }
  imgEl.addEventListener('load', onImageReady);
  imgEl.addEventListener('error', function () { showEditorError(container, 'Failed to display camera image. Please try again.'); });

  window.addEventListener('resize', () => requestAnimationFrame(resizeCanvas), { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    const resizeObserver = new ResizeObserver(() => { points.length = 0; requestAnimationFrame(resizeCanvas); });
    resizeObserver.observe(imgEl);
  }
  setTimeout(resizeCanvas, 100);
  setTimeout(resizeCanvas, 500);
}

export async function openZoneEditorInBubble(pendingId, cameraId, zoneMode = 'polygon', snapshotUrl = null, options = null) {
  const saveWithResumeFn = (options && options.saveWithResume) ? options.saveWithResume : null;
  if (!cameraId) return;

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

  const existingDrawBubble = bubble.querySelector('[data-zone-draw-bubble]');
  if (existingDrawBubble) existingDrawBubble.remove();
  const existingZoneEditor = bubble.querySelector('.zone-editor[data-zone-editor]');
  if (existingZoneEditor) existingZoneEditor.remove();

  const mode = zoneMode === 'line' ? 'line' : (zoneMode === 'motion_rois' ? 'motion_rois' : 'polygon');
  const editorId = generateEditorId();
  const drawBubbleEl = createZoneDrawBubbleElement(editorId, cameraId, mode);
  bubble.appendChild(drawBubbleEl);

  const messagesContainer = getMessagesEl();
  if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
  drawBubbleEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

  const statusEl = drawBubbleEl.querySelector('[data-zone-draw-status]');
  const contentEl = drawBubbleEl.querySelector('[data-zone-draw-content]');
  const imgEl = drawBubbleEl.querySelector('[data-zone-draw-img]');
  const imgWrap = drawBubbleEl.querySelector('[data-zone-draw-img-wrap]');
  const drawBtn = drawBubbleEl.querySelector('[data-zone-draw-btn]');

  function openEditorIfReady() {
    if (drawBubbleEl._snapshot) openModalWithZoneEditor(drawBubbleEl._snapshot, cameraId, mode, saveWithResumeFn);
  }

  const loadAndShow = async () => {
    const snapshot = await fetchCameraSnapshot(cameraId, snapshotUrl);
    if (statusEl) statusEl.classList.add('d-none');
    if (contentEl) contentEl.classList.remove('d-none');
    if (imgEl) imgEl.src = snapshot.imageUrl;
    drawBubbleEl._snapshot = snapshot;
    drawBtn.onclick = openEditorIfReady;
    if (imgWrap && !imgWrap._zoneClickBound) {
      imgWrap._zoneClickBound = true;
      imgWrap.addEventListener('click', openEditorIfReady);
    }
  };

  try {
    await loadAndShow();
  } catch (error) {
    const isOffline = error.message?.includes('offline') || error.message?.includes('unreachable') ||
                     error.message?.includes('not streaming') || error.message?.includes('503');
    showZoneDrawBubbleError(drawBubbleEl, error.message, isOffline ? loadAndShow : null);
  }
}

async function createStandaloneEditor(cameraId, zoneMode, snapshotUrl, saveWithResumeFn = null) {
  const messagesContainer = getMessagesEl();
  if (!messagesContainer) return;

  const mode = zoneMode === 'line' ? 'line' : (zoneMode === 'motion_rois' ? 'motion_rois' : 'polygon');
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
  const imgWrap = drawBubbleEl.querySelector('[data-zone-draw-img-wrap]');
  const drawBtn = drawBubbleEl.querySelector('[data-zone-draw-btn]');

  function openEditorIfReady() {
    if (drawBubbleEl._snapshot) openModalWithZoneEditor(drawBubbleEl._snapshot, cameraId, mode, saveWithResumeFn);
  }

  const loadAndShow = async () => {
    const snapshot = await fetchCameraSnapshot(cameraId, snapshotUrl);
    if (statusEl) statusEl.classList.add('d-none');
    if (contentEl) contentEl.classList.remove('d-none');
    if (imgEl) imgEl.src = snapshot.imageUrl;
    drawBubbleEl._snapshot = snapshot;
    drawBtn.onclick = openEditorIfReady;
    if (imgWrap && !imgWrap._zoneClickBound) {
      imgWrap._zoneClickBound = true;
      imgWrap.addEventListener('click', openEditorIfReady);
    }
  };

  try {
    await loadAndShow();
  } catch (error) {
    const isOffline = error.message?.includes('offline') || error.message?.includes('unreachable') ||
                     error.message?.includes('not streaming') || error.message?.includes('503');
    showZoneDrawBubbleError(drawBubbleEl, error.message, isOffline ? loadAndShow : null);
  }
}

export function init(deps) {
  if (deps?.messagesEl) cachedMessagesEl = deps.messagesEl;
  if (deps?.sendTextMessage && typeof deps.sendTextMessage === 'function') sendTextMessageFn = deps.sendTextMessage;
}
