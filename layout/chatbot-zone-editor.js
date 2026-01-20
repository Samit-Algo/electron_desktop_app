// Zone editor (snapshot + polygon) extracted from chatbot.html without logic changes.

(function () {
  'use strict';

  // Injected dependencies from chatbot.html
  let messagesEl = null;
  let sendTextMessage = null;
  let escapeHtml = null;

  function getAssistantBubbleEl(pendingId) {
    const node = messagesEl?.querySelector?.(`[data-chatbot-pending="${pendingId}"]`);
    const bubble = node?.querySelector?.('div');
    return { node, bubble };
  }

  async function openZoneEditorInBubble(pendingId, cameraId) {
    const { bubble } = getAssistantBubbleEl(pendingId);
    if (!bubble) return;

    // Avoid duplicating editor for same message
    const existing = bubble.querySelector?.(`[data-zone-editor="${pendingId}"]`);
    if (existing) return;

    const host = document.createElement('div');
    host.className = 'zone-editor';
    host.setAttribute('data-zone-editor', pendingId);
    host.innerHTML = `
          <div class="zone-editor__header">
            <div class="zone-editor__title">Draw monitoring zone</div>
            <div class="text-body-tertiary fs-10">Camera: <span class="font-monospace">${escapeHtml(cameraId || '—')}</span></div>
          </div>
          <div class="zone-editor__body">
            <div class="text-body-tertiary fs-9" data-zone-status>Loading snapshot…</div>
          </div>
        `;
    bubble.appendChild(host);

    const statusEl = host.querySelector('[data-zone-status]');
    const bodyEl = host.querySelector('.zone-editor__body');

    if (!cameraId) {
      if (statusEl) statusEl.textContent = 'Camera is not selected yet. Please provide a camera first.';
      return;
    }

    let blob = null;
    try {
      blob = await window.visionAPI.getCameraSnapshot(cameraId);
    } catch (e) {
      if (statusEl) statusEl.textContent = e?.message ? String(e.message) : 'Failed to load snapshot.';
      return;
    }

    const url = URL.createObjectURL(blob);

    // Editor UI
    bodyEl.innerHTML = `
          <div class="zone-editor__canvas-wrap">
            <img class="zone-editor__img" alt="Camera snapshot" />
            <canvas class="zone-editor__canvas"></canvas>
          </div>
          <div class="zone-editor__hint">Click to add polygon points. Use “Undo” to remove last point. Save needs at least 3 points.</div>
          <div class="zone-editor__actions">
            <button type="button" class="btn btn-sm btn-outline-secondary" data-zone-undo>Undo</button>
            <button type="button" class="btn btn-sm btn-outline-secondary" data-zone-clear>Clear</button>
            <button type="button" class="btn btn-sm btn-primary" data-zone-save>Save zone</button>
          </div>
        `;

    const imgEl = bodyEl.querySelector('.zone-editor__img');
    const canvasEl = bodyEl.querySelector('.zone-editor__canvas');
    const btnUndo = bodyEl.querySelector('[data-zone-undo]');
    const btnClear = bodyEl.querySelector('[data-zone-clear]');
    const btnSave = bodyEl.querySelector('[data-zone-save]');

    /** @type {{x:number,y:number}[]} */
    const points = [];

    function resizeCanvasToImage() {
      if (!imgEl || !canvasEl) return;
      // Wait for image to have natural dimensions
      if (!imgEl.naturalWidth || !imgEl.naturalHeight) return;
      const rect = imgEl.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (w <= 0 || h <= 0) return; // Skip if container not laid out yet
      if (canvasEl.width !== w) canvasEl.width = w;
      if (canvasEl.height !== h) canvasEl.height = h;
      // Force a redraw after resize
      draw();
    }

    function draw() {
      if (!canvasEl) return;
      const ctx = canvasEl.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

      // Polygon fill
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

      // Points
      ctx.fillStyle = 'rgba(42, 123, 228, 1)';
      for (const p of points) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function getClickPoint(ev) {
      const rect = canvasEl.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      return { x: Math.max(0, Math.min(rect.width, x)), y: Math.max(0, Math.min(rect.height, y)) };
    }

    function disableEditor(disabled) {
      [btnUndo, btnClear, btnSave].forEach(b => {
        if (!b) return;
        b.disabled = !!disabled;
      });
      if (canvasEl) canvasEl.style.pointerEvents = disabled ? 'none' : 'auto';
    }

    function pointsToImageCoords() {
      const rect = imgEl.getBoundingClientRect();
      const imgW = imgEl.naturalWidth || 0;
      const imgH = imgEl.naturalHeight || 0;
      if (!imgW || !imgH || !rect.width || !rect.height) return null;
      const sx = imgW / rect.width;
      const sy = imgH / rect.height;
      return points.map(p => [Math.round(p.x * sx), Math.round(p.y * sy)]);
    }

    canvasEl.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (!canvasEl) return;
      points.push(getClickPoint(ev));
      draw();
    });

    btnUndo?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      points.pop();
      draw();
    });

    btnClear?.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      points.length = 0;
      draw();
    });

    btnSave?.addEventListener('click', async () => {
      if (points.length < 3) return;
      const coords = pointsToImageCoords();
      if (!coords) return;
      const zoneData = {
        zone: {
          type: 'polygon',
          coordinates: coords,
        },
        image: {
          width: imgEl.naturalWidth || null,
          height: imgEl.naturalHeight || null,
        },
        camera_id: cameraId,
      };

      disableEditor(true);
      try {
        // NOTE: Do NOT pass cameraIdOverride. Agent already has camera_id in state (extracted from user earlier).
        // zone_data contains camera_id as metadata only, not as a separate field to update state.
        await sendTextMessage('Zone selected. Please continue.', { zoneData });
        // Safe cleanup: revoke snapshot URL after zone is submitted.
        // (Revoking on img "load" can cause the image to disappear on some Chromium/Electron repaints.)
        try { URL.revokeObjectURL(url); } catch (_) { }
      } finally {
        // Keep UI disabled; user can draw again only after assistant asks again
      }
    });

    imgEl.addEventListener('load', () => {
      // Use requestAnimationFrame to ensure layout is complete before sizing canvas
      requestAnimationFrame(() => {
        resizeCanvasToImage();
        // Second RAF to catch any delayed layout changes
        requestAnimationFrame(resizeCanvasToImage);
      });
      // NOTE: Do NOT revoke the blob URL here; it can make the image disappear
      // later (e.g., after clicking) in some Chromium/Electron environments.
    }, { once: true });

    imgEl.src = url;
    // Best-effort: keep canvas in sync on window resize
    const resizeHandler = () => requestAnimationFrame(resizeCanvasToImage);
    window.addEventListener('resize', resizeHandler, { passive: true });
    // Initial size attempts (in case image is cached and loads instantly)
    setTimeout(() => requestAnimationFrame(resizeCanvasToImage), 0);
    setTimeout(() => requestAnimationFrame(resizeCanvasToImage), 100);
  }

  function init(deps) {
    messagesEl = deps.messagesEl;
    sendTextMessage = deps.sendTextMessage;
    escapeHtml = deps.escapeHtml;
  }

  window.ChatbotZoneEditor = {
    init: init,
    openZoneEditorInBubble: openZoneEditorInBubble
  };
})();

