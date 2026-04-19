/**
 * WS fMP4 Player (MediaSource + WebSocket)
 *
 * Backend sends fragmented MP4 (fMP4) bytes over WebSocket.
 * This player appends those bytes into an MSE SourceBuffer.
 *
 * Usage:
 *   const player = createWsFmp4Player({
 *     videoEl,
 *     wsUrl: "ws://host/api/v1/streams/<camera_id>/live/ws?token=...",
 *     mimeCodec: 'video/mp4; codecs="avc1.4D0032"',
 *     onState: (s) => console.log(s)
 *   });
 *   // later: player.destroy()
 */

(() => {
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function now() {
    return Date.now();
  }

  function createWsFmp4Player({ videoEl, wsUrl, mimeCodec, bufferSeconds = 15, onState } = {}) {
    if (!videoEl) throw new Error("videoEl is required");
    if (!wsUrl) throw new Error("wsUrl is required");
    if (!mimeCodec) throw new Error("mimeCodec is required");

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
      try {
        if (typeof onState === "function") onState({ state, ...extra });
      } catch {
        // ignore
      }
    };

    const clearQueue = () => {
      queue = [];
    };

    const safeCloseWs = () => {
      try {
        if (ws) ws.close();
      } catch {
        // ignore
      }
      ws = null;
    };

    const cleanupMedia = () => {
      try {
        if (sourceBuffer && mediaSource) {
          try {
            if (mediaSource.readyState === "open") mediaSource.endOfStream();
          } catch {
            // ignore
          }
        }
      } catch {
        // ignore
      }

      sourceBuffer = null;
      mediaSource = null;

      try {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      } catch {
        // ignore
      }
      objectUrl = null;
    };

    const trimBuffer = () => {
      // Keep a small rolling window to reduce memory usage/latency.
      // This is live-only playback (no DVR).
      try {
        if (!sourceBuffer || sourceBuffer.updating) return;
        if (!videoEl || !videoEl.buffered || videoEl.buffered.length === 0) return;

        const start = videoEl.buffered.start(0);
        const end = videoEl.buffered.end(videoEl.buffered.length - 1);

        // Keep last N seconds (defaults to 15)
        const keep = Math.max(5, Number(bufferSeconds) || 15);
        const removeEnd = end - keep;
        if (removeEnd > start + 1) {
          sourceBuffer.remove(start, removeEnd);
        }
      } catch {
        // ignore
      }
    };

    const tryAppend = () => {
      if (destroyed) return;
      if (!sourceBuffer) return;
      if (sourceBuffer.updating) return;
      if (queue.length === 0) return;

      const chunk = queue.shift();
      try {
        sourceBuffer.appendBuffer(chunk);
        if (isFirstAppend) {
          isFirstAppend = false;
          emit("first-append");
        }
      } catch (e) {
        emit("append-error", { error: String(e) });
        // Reset pipeline on append failures (common if codec mismatch or bad fragments)
        destroy();
      }
    };

    const onUpdateEnd = () => {
      trimBuffer();
      tryAppend();
    };

    const setupMse = () => {
      if (destroyed) return;
      if (!("MediaSource" in window)) {
        emit("error", { error: "MediaSource not supported" });
        return;
      }
      if (!MediaSource.isTypeSupported(mimeCodec)) {
        emit("error", { error: `Unsupported mimeCodec: ${mimeCodec}` });
        return;
      }

      mediaSource = new MediaSource();
      objectUrl = URL.createObjectURL(mediaSource);
      videoEl.src = objectUrl;

      mediaSource.addEventListener("sourceopen", () => {
        if (destroyed) return;
        try {
          sourceBuffer = mediaSource.addSourceBuffer(mimeCodec);
          sourceBuffer.mode = "segments";
          sourceBuffer.addEventListener("updateend", onUpdateEnd);
          emit("mse-ready");
          tryAppend();
        } catch (e) {
          emit("error", { error: `Failed to create SourceBuffer: ${String(e)}` });
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

      emit("connecting", { wsUrl });
      ws = new WebSocket(wsUrl);
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        reconnectAttempt = 0;
        emit("ws-open");
      };

      ws.onmessage = (event) => {
        if (destroyed) return;
        if (!event.data) return;
        lastMessageAt = now();

        // Cap queue to avoid memory blowup on slow append.
        // For live view, dropping is acceptable.
        if (queue.length > 200) {
          queue.splice(0, queue.length - 50);
          emit("drop", { reason: "queue-overflow" });
        }

        try {
          const u8 = new Uint8Array(event.data);
          queue.push(u8);
          tryAppend();
        } catch (e) {
          emit("error", { error: `Bad WS data: ${String(e)}` });
        }
      };

      ws.onerror = () => {
        // onclose will handle reconnect
        emit("ws-error");
      };

      ws.onclose = async () => {
        if (destroyed) return;
        emit("ws-close");

        // Reconnect with exponential backoff
        reconnectAttempt += 1;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempt - 1), 15000);
        await sleep(delay);
        if (destroyed) return;
        connectWsOnce();
      };
    };

    const healthTimer = setInterval(() => {
      if (destroyed) return;
      // If we opened WS but receive no bytes for a while, surface it for UI.
      if (ws && ws.readyState === WebSocket.OPEN) {
        const idleMs = lastMessageAt ? now() - lastMessageAt : null;
        if (idleMs !== null && idleMs > 5000) {
          emit("stalled", { idleMs });
        }
      }
    }, 2000);

    const destroy = () => {
      if (destroyed) return;
      destroyed = true;
      try {
        clearInterval(healthTimer);
      } catch {
        // ignore
      }
      try {
        if (sourceBuffer) sourceBuffer.removeEventListener("updateend", onUpdateEnd);
      } catch {
        // ignore
      }
      safeCloseWs();
      cleanupMedia();
      clearQueue();
      emit("destroyed");
    };

    // Bootstrap
    setupMse();
    connectWsOnce();

    return {
      destroy,
      getState: () => ({
        wsReadyState: ws ? ws.readyState : null,
        queuedChunks: queue.length,
      }),
    };
  }

  window.createWsFmp4Player = createWsFmp4Player;
})();

