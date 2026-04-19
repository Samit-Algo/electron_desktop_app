import { api } from '../../core/api.js';
/**
 * agent-zone-editor.js
 * Canvas zone drawing tool — polygon and line modes.
 * Exports: zoneState, zoneReset, zoneDraw, zoneBindCanvas, zoneLoadSnapshot
 */

function apiRequest(path, opts) {
  if (api && typeof api.request === 'function') {
    return api.request(path, opts || {});
  }
  return Promise.reject(new Error('API service not available.'));
}

export var zoneState = {
  points: [],
  mode: 'polygon',
  imgEl: null,
  imgW: 640,
  imgH: 360,
  savedCoords: null,
  savedType: null,
  mousePt: null
};

export function zoneReset(mode) {
  zoneState.points = [];
  zoneState.mode = mode || 'polygon';
  zoneState.imgEl = null;
  zoneState.imgW = 640;
  zoneState.imgH = 360;
  zoneState.savedCoords = null;
  zoneState.savedType = null;
  zoneState.mousePt = null;
}

export function zoneDraw() {
  var canvas = document.getElementById('ca-zone-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (zoneState.imgEl) {
    ctx.drawImage(zoneState.imgEl, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  var pts = zoneState.points;
  if (pts.length === 0 && !zoneState.mousePt) return;

  if (pts.length >= 2) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (zoneState.mode === 'polygon' && pts.length >= 3) ctx.lineTo(pts[0].x, pts[0].y);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.stroke();
    if (zoneState.mode === 'polygon' && pts.length >= 3) {
      ctx.fillStyle = 'rgba(34,211,238,.15)';
      ctx.fill();
    }
  }

  if (zoneState.mousePt && pts.length > 0) {
    var last = pts[pts.length - 1];
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(zoneState.mousePt.x, zoneState.mousePt.y);
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = 'rgba(255,255,255,.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  pts.forEach(function (pt, idx) {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, idx === 0 ? 7 : 5, 0, Math.PI * 2);
    ctx.fillStyle = idx === 0 ? '#22c55e' : '#22d3ee';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function zoneIsNearFirst(px, py) {
  if (zoneState.points.length < 3) return false;
  var f = zoneState.points[0];
  var dx = px - f.x, dy = py - f.y;
  return Math.sqrt(dx * dx + dy * dy) < 14;
}

function zoneNormalize() {
  var W = zoneState.imgW, H = zoneState.imgH;
  return zoneState.points.map(function (pt) {
    return [
      Math.round(pt.x / W * 1000) / 1000,
      Math.round(pt.y / H * 1000) / 1000
    ];
  });
}

export function zoneUpdateHint() {
  var hintEl = document.getElementById('ca-zone-hint');
  var undoBtn = document.getElementById('ca-zone-undo-btn');
  var clearBtn = document.getElementById('ca-zone-clear-btn');
  var n = zoneState.points.length;
  var hint = '';
  if (zoneState.mode === 'line') {
    if (n === 0) hint = 'Click to place the first endpoint of the counting line.';
    else if (n === 1) hint = 'Click to place the second endpoint.';
    else hint = 'Counting line ready. You may clear and redraw.';
  } else {
    if (n === 0) hint = 'Click to start drawing the polygon.';
    else if (n < 3) hint = 'Add at least ' + (3 - n) + ' more point' + (3 - n > 1 ? 's' : '') + '.';
    else hint = n + ' points — click the first point (green) to close, or click "Save Zone" above.';
  }
  if (hintEl) hintEl.textContent = hint;
  var hasPoints = n > 0;
  if (undoBtn) undoBtn.disabled = !hasPoints;
  if (clearBtn) clearBtn.disabled = !hasPoints;
}

export function zoneCanFinish() {
  var n = zoneState.points.length;
  return (zoneState.mode === 'polygon' && n >= 3) ||
         (zoneState.mode === 'line' && n === 2);
}

export function zoneSaveAndMark() {
  if (!zoneCanFinish()) return false;
  zoneState.savedCoords = zoneNormalize();
  zoneState.savedType = zoneState.mode === 'line' ? 'line' : 'polygon';
  var ind = document.getElementById('ca-zone-saved-indicator');
  if (ind) ind.classList.remove('d-none');
  var createBtn = document.getElementById('ca-create-btn');
  if (createBtn) createBtn.disabled = false;
  return true;
}

export function zoneBindCanvas(mode) {
  var canvas = document.getElementById('ca-zone-canvas');
  if (!canvas) return;

  var fresh = canvas.cloneNode(true);
  canvas.parentNode.replaceChild(fresh, canvas);
  canvas = fresh;

  zoneReset(mode);
  canvas.style.cursor = 'crosshair';

  canvas.addEventListener('mousemove', function (e) {
    var rect = canvas.getBoundingClientRect();
    var sx = canvas.width / rect.width;
    var sy = canvas.height / rect.height;
    zoneState.mousePt = { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
    zoneDraw();
  });

  canvas.addEventListener('mouseleave', function () {
    zoneState.mousePt = null;
    zoneDraw();
  });

  canvas.addEventListener('click', function (e) {
    var rect = canvas.getBoundingClientRect();
    var sx = canvas.width / rect.width;
    var sy = canvas.height / rect.height;
    var px = (e.clientX - rect.left) * sx;
    var py = (e.clientY - rect.top) * sy;

    if (zoneState.mode === 'polygon' && zoneIsNearFirst(px, py)) {
      zoneSaveAndMark();
      zoneUpdateHint();
      zoneDraw();
      return;
    }

    if (zoneState.mode === 'line' && zoneState.points.length >= 2) return;

    zoneState.points.push({ x: px, y: py });

    if (zoneState.mode === 'line' && zoneState.points.length === 2) {
      zoneSaveAndMark();
    }

    zoneUpdateHint();
    zoneDraw();
  });

  canvas.addEventListener('touchstart', function (e) {
    e.preventDefault();
    var t = e.touches[0];
    var rect = canvas.getBoundingClientRect();
    var sx = canvas.width / rect.width;
    var sy = canvas.height / rect.height;
    var px = (t.clientX - rect.left) * sx;
    var py = (t.clientY - rect.top) * sy;

    if (zoneState.mode === 'polygon' && zoneIsNearFirst(px, py)) {
      zoneSaveAndMark(); zoneUpdateHint(); zoneDraw(); return;
    }
    if (zoneState.mode === 'line' && zoneState.points.length >= 2) return;
    zoneState.points.push({ x: px, y: py });
    if (zoneState.mode === 'line' && zoneState.points.length === 2) zoneSaveAndMark();
    zoneUpdateHint(); zoneDraw();
  }, { passive: false });

  zoneDraw();
  zoneUpdateHint();
}

export function zoneLoadSnapshot(cameraId, mode) {
  var canvas = document.getElementById('ca-zone-canvas');
  var loadingEl = document.getElementById('ca-zone-loading');
  var errorEl = document.getElementById('ca-zone-error');
  var errorMsgEl = document.getElementById('ca-zone-error-msg');
  if (!canvas) return;

  if (loadingEl) loadingEl.classList.remove('d-none');
  if (errorEl) errorEl.classList.add('d-none');

  zoneBindCanvas(mode);

  apiRequest('/api/v1/cameras/' + encodeURIComponent(cameraId) + '/snapshot')
    .then(function (data) {
      if (loadingEl) loadingEl.classList.add('d-none');
      var b64 = data && data.frame_base64;
      if (!b64) { throw new Error('No frame data returned.'); }
      var img = new window.Image();
      img.onload = function () {
        canvas = document.getElementById('ca-zone-canvas');
        if (!canvas) return;
        canvas.width = img.naturalWidth || 640;
        canvas.height = img.naturalHeight || 360;
        zoneState.imgEl = img;
        zoneState.imgW = canvas.width;
        zoneState.imgH = canvas.height;
        zoneDraw();
      };
      img.onerror = function () {
        if (loadingEl) loadingEl.classList.add('d-none');
        if (errorEl) errorEl.classList.remove('d-none');
        if (errorMsgEl) errorMsgEl.textContent = 'Could not render camera frame.';
      };
      img.src = 'data:image/jpeg;base64,' + b64;
    })
    .catch(function (err) {
      if (loadingEl) loadingEl.classList.add('d-none');
      if (errorEl) errorEl.classList.remove('d-none');
      if (errorMsgEl) errorMsgEl.textContent = (err && err.message) || 'Failed to load camera frame.';
    });
}
