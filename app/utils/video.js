function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Create a live fMP4-over-WebSocket player using MediaSource Extensions.
 *
 * @param {object} opts
 * @param {HTMLVideoElement} opts.videoEl
 * @param {string}           opts.wsUrl
 * @param {string}           opts.mimeCodec  e.g. 'video/mp4; codecs="avc1.4D0032"'
 * @param {number}           [opts.bufferSeconds=15]
 * @param {function}         [opts.onState]  called with { state, ...extra }
 * @returns {{ destroy: Function, getState: Function }}
 */
export function createWsFmp4Player({ videoEl, wsUrl, mimeCodec, bufferSeconds = 15, onState } = {}) {
  if (!videoEl)   throw new Error('videoEl is required');
  if (!wsUrl)     throw new Error('wsUrl is required');
  if (!mimeCodec) throw new Error('mimeCodec is required');

  let destroyed = false;
  let ws = null;
  let mediaSource = null;
  let sourceBuffer = null;
  let objectUrl = null;
  let queue = [];
  let isFirstAppend = true;
  let reconnectAttempt = 0;
  let lastMessageAt = 0;

  const emit = (state, extra = {}) => {
    try { if (typeof onState === 'function') onState({ state, ...extra }); } catch { /* ignore */ }
  };

  const clearQueue = () => { queue = []; };

  const safeCloseWs = () => {
    try { if (ws) ws.close(); } catch { /* ignore */ }
    ws = null;
  };

  const cleanupMedia = () => {
    try {
      if (sourceBuffer && mediaSource && mediaSource.readyState === 'open') {
        try { mediaSource.endOfStream(); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    sourceBuffer = null;
    mediaSource = null;
    try { if (objectUrl) URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
    objectUrl = null;
  };

  const trimBuffer = () => {
    try {
      if (!sourceBuffer || sourceBuffer.updating) return;
      if (!videoEl.buffered || videoEl.buffered.length === 0) return;
      const start = videoEl.buffered.start(0);
      const end   = videoEl.buffered.end(videoEl.buffered.length - 1);
      const keep  = Math.max(5, Number(bufferSeconds) || 15);
      const removeEnd = end - keep;
      if (removeEnd > start + 1) sourceBuffer.remove(start, removeEnd);
    } catch { /* ignore */ }
  };

  const tryAppend = () => {
    if (destroyed || !sourceBuffer || sourceBuffer.updating || queue.length === 0) return;
    const chunk = queue.shift();
    try {
      sourceBuffer.appendBuffer(chunk);
      if (isFirstAppend) { isFirstAppend = false; emit('first-append'); }
    } catch (e) {
      emit('append-error', { error: String(e) });
      destroy();
    }
  };

  const onUpdateEnd = () => { trimBuffer(); tryAppend(); };

  const setupMse = () => {
    if (destroyed) return;
    if (!('MediaSource' in window)) { emit('error', { error: 'MediaSource not supported' }); return; }
    if (!MediaSource.isTypeSupported(mimeCodec)) { emit('error', { error: `Unsupported mimeCodec: ${mimeCodec}` }); return; }

    mediaSource = new MediaSource();
    objectUrl   = URL.createObjectURL(mediaSource);
    videoEl.src = objectUrl;

    mediaSource.addEventListener('sourceopen', () => {
      if (destroyed) return;
      try {
        sourceBuffer = mediaSource.addSourceBuffer(mimeCodec);
        sourceBuffer.mode = 'segments';
        sourceBuffer.addEventListener('updateend', onUpdateEnd);
        emit('mse-ready');
        tryAppend();
      } catch (e) {
        emit('error', { error: `Failed to create SourceBuffer: ${String(e)}` });
        destroy();
      }
    });
  };

  const connectWsOnce = () => {
    if (destroyed) return;
    safeCloseWs();
    clearQueue();
    isFirstAppend = true;
    lastMessageAt = 0;
    emit('connecting', { wsUrl });

    ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => { reconnectAttempt = 0; emit('ws-open'); };

    ws.onmessage = (event) => {
      if (destroyed || !event.data) return;
      lastMessageAt = Date.now();
      if (queue.length > 200) { queue.splice(0, queue.length - 50); emit('drop', { reason: 'queue-overflow' }); }
      try { queue.push(new Uint8Array(event.data)); tryAppend(); }
      catch (e) { emit('error', { error: `Bad WS data: ${String(e)}` }); }
    };

    ws.onerror = () => emit('ws-error');

    ws.onclose = async () => {
      if (destroyed) return;
      emit('ws-close');
      reconnectAttempt += 1;
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempt - 1), 15000);
      await sleep(delay);
      if (!destroyed) connectWsOnce();
    };
  };

  const healthTimer = setInterval(() => {
    if (destroyed) return;
    if (ws && ws.readyState === WebSocket.OPEN && lastMessageAt) {
      const idleMs = Date.now() - lastMessageAt;
      if (idleMs > 5000) emit('stalled', { idleMs });
    }
  }, 2000);

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    try { clearInterval(healthTimer); } catch { /* ignore */ }
    try { if (sourceBuffer) sourceBuffer.removeEventListener('updateend', onUpdateEnd); } catch { /* ignore */ }
    safeCloseWs();
    cleanupMedia();
    clearQueue();
    emit('destroyed');
  };

  setupMse();
  connectWsOnce();

  return {
    destroy,
    getState: () => ({ wsReadyState: ws ? ws.readyState : null, queuedChunks: queue.length }),
  };
}
