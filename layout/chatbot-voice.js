/**
 * CHATBOT VOICE MODULE
 * ====================
 *
 * HOW IT WORKS (beginner-friendly overview)
 * ------------------------------------------
 * 1. User taps the mic button  → openVoiceSession() is called
 * 2. We open a WebSocket to the backend and start the microphone
 * 3. Mic audio is captured via AudioWorklet, downsampled to 16 kHz,
 *    converted to PCM16 LE and sent as binary WebSocket frames
 * 4. Backend VAD (Silero) detects when the user starts/stops speaking
 * 5. Events from the server drive the UI:
 *      speech_start  → show user bubble with "Listening…"
 *      partial_stt   → update bubble with live transcription while speaking
 *      speech_end    → switch to "Processing…"
 *      final_stt     → replace bubble text with accurate transcription
 *      llm_token     → stream AI response tokens into assistant bubble
 *      tts_chunk     → accumulate binary audio chunks
 *      tts_done      → play accumulated audio
 *      interrupted   → user spoke over AI; stop audio, reset to listening
 *      done          → turn complete; stay connected for next utterance
 * 6. User taps mic again → closeVoiceSession() closes WS and mic
 *
 * Fallback: if the WebSocket endpoint is unavailable, the module
 * automatically falls back to the legacy MediaRecorder + SSE path.
 */
(function () {
  'use strict';

  // ==========================================================================
  // SECTION 1 — STATE & CONSTANTS
  // ==========================================================================

  /** Voice assistant lifecycle states */
  const VOICE_STATE = {
    IDLE:       'idle',       // mic is off, WS is closed
    LISTENING:  'listening',  // mic is on, waiting for user to speak
    PROCESSING: 'processing', // utterance captured, STT→LLM→TTS running
    SPEAKING:   'speaking',   // AI is playing TTS audio
    ERROR:      'error',
  };

  let voiceState = VOICE_STATE.IDLE;

  // Prevent re-opening the session immediately after AI finishes speaking
  let lastSpeakingEndedAt = 0;
  const SPEAKING_COOLDOWN_MS = 250;

  /**
   * Mic constraints for all voice capture paths. Echo cancellation is
   * critical on mobile: speaker output must not be re-captured as “user speech”
   * (false VAD / self barge-in). Desktop often masks this via hardware/OS AEC.
   */
  const VOICE_MIC_CONSTRAINTS = {
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  };

  // ── WebSocket + microphone ─────────────────────────────────────────────────
  /** @type {WebSocket|null} */
  let voiceWs = null;
  /** @type {AudioContext|null} */
  let micAudioCtx = null;
  /** @type {AudioWorkletNode|null} */
  let micWorkletNode = null;
  /** @type {MediaStreamAudioSourceNode|null} */
  let micSourceNode = null;
  /** @type {MediaStream|null} */
  let micStream = null;
  let nativeSampleRate = 48000;

  // ── TTS playback ───────────────────────────────────────────────────────────
  /** @type {HTMLAudioElement|null} */
  let speakingAudio = null;
  /** Accumulated binary TTS chunks (ArrayBuffer[]) for the current utterance */
  let ttsAudioChunks = [];

  // ── Per-utterance UI tracking ──────────────────────────────────────────────
  let pendingAssistantId = null;  // ID of the assistant "pending" bubble
  let fullLLMText = '';           // accumulated LLM text for the current turn

  // ── Orb animation (visual feedback) ───────────────────────────────────────
  let orbAudioCtx = null;
  let orbAnalyser = null;
  let orbAnalyserData = null;
  let orbAnimFrame = null;

  // ── Legacy MediaRecorder fallback state ───────────────────────────────────
  let isVoiceRecording = false;
  let isTextStreaming = false;
  let legacyRecorder = null;
  let legacyChunks = [];
  let legacyStream = null;

  // ── Dependencies injected by chatbot-core.js ───────────────────────────────
  let getActive = null;
  let getMode = null;
  let messagesEl = null;
  let appendUserBubble = null;
  let replaceLastUserBubbleText = null;
  let appendAssistantPending = null;
  let replaceAssistantPending = null;
  let updateAssistantPendingText = null;
  let saveActiveHtml = null;
  let chatbotOffcanvas = null;
  let sendBtn = null;
  let voiceBtn = null;

  // ==========================================================================
  // SECTION 2 — VOICE STATE MACHINE & UI SYNC
  // ==========================================================================

  /** Transition to a new voice state and update all related UI. */
  function setVoiceState(next) {
    if (!Object.values(VOICE_STATE).includes(next)) return;
    if (voiceState === next) return;

    const prev = voiceState;
    voiceState = next;

    if (next === VOICE_STATE.IDLE) hideVoiceUI();
    else showVoiceUI();

    if (prev === VOICE_STATE.SPEAKING && next !== VOICE_STATE.SPEAKING) {
      lastSpeakingEndedAt = performance.now();
    }

    updateVoiceStatusLabel(next);
    syncSendButtonVisual();
  }

  function updateVoiceStatusLabel(state) {
    const el = document.getElementById('voice-status-label');
    if (!el) return;
    const labels = {
      [VOICE_STATE.LISTENING]:  'Listening…',
      [VOICE_STATE.PROCESSING]: 'Processing…',
      [VOICE_STATE.SPEAKING]:   'Speaking…',
      [VOICE_STATE.ERROR]:      'Something went wrong',
    };
    const text = labels[state] || '';
    el.textContent = text;
    el.style.opacity = text ? '1' : '0';
  }

  function showVoiceUI() {
    const overlay = chatbotOffcanvas?.querySelector?.('#voice-ui-overlay');
    const wrap = messagesEl?.closest?.('.chat-messages-wrap');
    wrap?.classList?.add('voice-ui-active');
    if (overlay) { overlay.classList.remove('d-none'); overlay.setAttribute('aria-hidden', 'false'); }
  }

  function hideVoiceUI() {
    const overlay = chatbotOffcanvas?.querySelector?.('#voice-ui-overlay');
    const wrap = messagesEl?.closest?.('.chat-messages-wrap');
    wrap?.classList?.remove('voice-ui-active');
    overlay?.classList?.add('d-none');
    overlay?.setAttribute('aria-hidden', 'true');
  }

  function syncSendButtonVisual() {
    const textareaEl = document.getElementById('chatbot-input');
    const btn = sendBtn || document.querySelector('#chatbot-offcanvas .send-btn');
    if (!textareaEl || !btn) return;

    const hasText = textareaEl.value.trim().length > 0;
    const voiceIcon = btn.querySelector('.voice-icon');
    const sendIcon  = btn.querySelector('.send-icon');
    const stopIcon  = btn.querySelector('.stop-icon');

    btn.classList.remove('streaming', 'recording');

    if (isTextStreaming) {
      btn.classList.remove('voice-assistant-state');
      btn.classList.add('streaming');
      btn.setAttribute('aria-label', 'Stop response');
      if (voiceIcon) voiceIcon.style.display = 'none';
      if (sendIcon)  sendIcon.style.display  = 'none';
      if (stopIcon)  stopIcon.style.display  = 'flex';
      return;
    }

    if (voiceState !== VOICE_STATE.IDLE) {
      btn.classList.add('recording');
      btn.classList.remove('voice-assistant-state');
      btn.setAttribute('aria-label', 'Stop voice assistant');
      if (voiceIcon) voiceIcon.style.display = 'flex';
      if (sendIcon)  sendIcon.style.display  = 'none';
      if (stopIcon)  stopIcon.style.display  = 'none';
      return;
    }

    if (hasText) {
      btn.classList.remove('voice-assistant-state');
      btn.setAttribute('aria-label', 'Send Message');
      if (voiceIcon) voiceIcon.style.display = 'none';
      if (sendIcon)  sendIcon.style.display  = 'flex';
      if (stopIcon)  stopIcon.style.display  = 'none';
    } else {
      btn.classList.add('voice-assistant-state');
      btn.setAttribute('aria-label', 'Voice Assistant');
      if (voiceIcon) voiceIcon.style.display = 'flex';
      if (sendIcon)  sendIcon.style.display  = 'none';
      if (stopIcon)  stopIcon.style.display  = 'none';
    }
  }

  // ==========================================================================
  // SECTION 3 — ORB ANIMATION (visual audio-reactive feedback)
  // ==========================================================================

  /**
   * Start animating the voice orb in reaction to a MediaStream (mic input).
   * Orb pulses and glows based on the RMS energy of the audio signal.
   */
  function startOrbFromStream(stream) {
    _stopOrb();
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;
      orbAudioCtx = new AudioContextCtor();
      orbAnalyser = orbAudioCtx.createAnalyser();
      orbAnalyser.fftSize = 1024;
      orbAnalyser.smoothingTimeConstant = 0.85;
      orbAudioCtx.createMediaStreamSource(stream).connect(orbAnalyser);
      orbAnalyserData = new Uint8Array(orbAnalyser.fftSize);
      _runOrbFrame();
    } catch (_) { _stopOrb(); }
  }

  /**
   * Start animating the orb in reaction to an HTMLAudioElement (TTS playback).
   * Must connect through the AudioContext destination so audio plays through.
   */
  function startOrbFromAudioElement(audioElement) {
    _stopOrb();
    try {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;
      orbAudioCtx = new AudioContextCtor();
      orbAnalyser = orbAudioCtx.createAnalyser();
      orbAnalyser.fftSize = 1024;
      orbAnalyser.smoothingTimeConstant = 0.85;
      const src = orbAudioCtx.createMediaElementSource(audioElement);
      src.connect(orbAnalyser);
      orbAnalyser.connect(orbAudioCtx.destination); // required so audio plays
      orbAnalyserData = new Uint8Array(orbAnalyser.fftSize);
      _runOrbFrame();
    } catch (_) { _stopOrb(); }
  }

  function _runOrbFrame() {
    if (!orbAnalyser || !orbAnalyserData) return;
    orbAnalyser.getByteTimeDomainData(orbAnalyserData);

    let sumSq = 0;
    for (let i = 0; i < orbAnalyserData.length; i++) {
      const v = (orbAnalyserData[i] - 128) / 128;
      sumSq += v * v;
    }
    const rms = Math.sqrt(sumSq / orbAnalyserData.length);
    const gate = 0.015, span = 0.14;
    const n = Math.pow(Math.max(0, Math.min(1, (rms - gate) / span)), 0.25);

    const orbEl = document.getElementById('voice-orb');
    const c = orbEl?.closest?.('.orb-container') || orbEl;
    if (c?.style) {
      c.style.transform = `scale(${(1 + n * 0.55).toFixed(3)})`;
      const glowA = (0.25 + n * 0.75).toFixed(2);
      c.style.filter =
        `drop-shadow(0 0 10px rgba(255, 62, 28, ${glowA})) ` +
        `drop-shadow(0 0 10px rgba(28, 140, 255, ${glowA}))`;
      c.style.setProperty('--aura', n.toFixed(3));
      c.style.setProperty('--auraScale', (1 + n * 0.10).toFixed(3));
    }

    orbAnimFrame = requestAnimationFrame(_runOrbFrame);
  }

  function _stopOrb() {
    if (orbAnimFrame) { cancelAnimationFrame(orbAnimFrame); orbAnimFrame = null; }
    orbAnalyserData = null; orbAnalyser = null;
    try {
      const orbEl = document.getElementById('voice-orb');
      const c = orbEl?.closest?.('.orb-container') || orbEl;
      if (c?.style) { c.style.transform = ''; c.style.filter = ''; }
    } catch (_) { }
    try { orbAudioCtx?.close?.(); } catch (_) { }
    orbAudioCtx = null;
  }

  // ==========================================================================
  // SECTION 4 — PCM AUDIO HELPERS
  // ==========================================================================

  /**
   * Downsample a Float32Array from `fromRate` to `toRate` Hz using linear
   * interpolation. Used to convert 48 kHz mic audio to 16 kHz for the backend.
   */
  function _downsample(float32, fromRate, toRate) {
    if (fromRate === toRate) return float32;
    const ratio = fromRate / toRate;
    const out = new Float32Array(Math.floor(float32.length / ratio));
    for (let i = 0; i < out.length; i++) {
      const srcIdx = i * ratio;
      const lo = Math.floor(srcIdx);
      const hi = Math.min(lo + 1, float32.length - 1);
      const frac = srcIdx - lo;
      out[i] = float32[lo] * (1 - frac) + float32[hi] * frac;
    }
    return out;
  }

  /**
   * Convert a Float32Array in the range [-1, 1] to a PCM16 LE ArrayBuffer.
   * This is the format the backend expects (16-bit signed integers, little-endian).
   */
  function _float32ToPcm16(float32) {
    const buf = new ArrayBuffer(float32.length * 2);
    const view = new DataView(buf);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true /* little-endian */);
    }
    return buf;
  }

  // ==========================================================================
  // SECTION 5 — WEBSOCKET SESSION
  // ==========================================================================

  /**
   * AudioWorklet source code (injected as an inline Blob — no separate file needed).
   *
   * The worklet runs in a dedicated audio thread. It accumulates 128-sample blocks
   * until it has ~85 ms of audio, then posts the raw Float32 buffer to the main
   * thread via postMessage. The main thread downsamples and sends over the WS.
   */
  const _WORKLET_SOURCE = `
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._TARGET = 4096; // ~85 ms at 48 kHz before flushing
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    this._buf.push(new Float32Array(ch)); // copy — buffer is recycled after this call
    let total = this._buf.reduce((s, a) => s + a.length, 0);
    if (total >= this._TARGET) {
      const out = new Float32Array(total);
      let offset = 0;
      for (const b of this._buf) { out.set(b, offset); offset += b.length; }
      this.port.postMessage(out.buffer, [out.buffer]); // transfer ownership
      this._buf = [];
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCaptureProcessor);
`;

  /** Build the WebSocket URL using the global visionAPI singleton. */
  function _buildWsUrl() {
    const api = window.visionAPI;
    if (!api?.token) throw new Error('Not authenticated');
    const wsBase = api.baseURL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    return `${wsBase}/api/v1/general-chat/voice-stream?token=${encodeURIComponent(api.token)}`;
  }

  /** Stop microphone capture and close the AudioContext. */
  function _stopMic() {
    if (micWorkletNode) {
      try { micWorkletNode.port.onmessage = null; micWorkletNode.disconnect(); } catch (_) { }
      micWorkletNode = null;
    }
    if (micSourceNode) { try { micSourceNode.disconnect(); } catch (_) { } micSourceNode = null; }
    if (micAudioCtx)   { try { micAudioCtx.close(); }        catch (_) { } micAudioCtx = null; }
    if (micStream)     { try { micStream.getTracks().forEach(t => t.stop()); } catch (_) { } micStream = null; }
  }

  /** Close the WebSocket cleanly (no automatic reconnect). */
  function _closeWs() {
    if (!voiceWs) return;
    try {
      voiceWs.onopen = voiceWs.onmessage = voiceWs.onerror = voiceWs.onclose = null;
      if (voiceWs.readyState <= WebSocket.OPEN) voiceWs.close(1000, 'Session ended');
    } catch (_) { }
    voiceWs = null;
  }

  /** Initialise user + assistant bubbles when speech_start fires. */
  function _initUtteranceBubbles() {
    const ss = _getSessionState();
    if (!ss) return;
    if (!ss.state.started) { ss.state.started = true; if (messagesEl) messagesEl.innerHTML = ''; }
    appendUserBubble?.('[Listening…]');
    pendingAssistantId = appendAssistantPending?.();
    fullLLMText = '';
    ttsAudioChunks = [];
    saveActiveHtml?.();
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /** Play the accumulated TTS audio chunks as a single WAV blob. */
  function _playTtsAudio() {
    if (!ttsAudioChunks.length) {
      setVoiceState(VOICE_STATE.LISTENING);
      return;
    }
    const blob = new Blob(ttsAudioChunks.map(b => new Uint8Array(b)), { type: 'audio/wav' });
    ttsAudioChunks = [];
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    speakingAudio = audio;

    audio.play()
      .then(() => {
        setVoiceState(VOICE_STATE.SPEAKING);
        startOrbFromAudioElement(audio);
      })
      .catch(() => {
        speakingAudio = null;
        URL.revokeObjectURL(url);
        setVoiceState(VOICE_STATE.LISTENING);
      });

    audio.onended = () => {
      URL.revokeObjectURL(url);
      speakingAudio = null;
      _stopOrb();
      lastSpeakingEndedAt = performance.now();
      setVoiceState(VOICE_STATE.LISTENING); // WS stays open — wait for next utterance
    };
  }

  /**
   * Open the WebSocket and start the microphone AudioWorklet.
   * Resolves when the server sends the first "ready" event.
   */
  async function _openWsSession(sessionState) {
    const { state } = sessionState;

    // ── Start microphone ────────────────────────────────────────────────────
    micStream = await navigator.mediaDevices.getUserMedia(VOICE_MIC_CONSTRAINTS);
    startOrbFromStream(micStream);

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    micAudioCtx = new AudioContextCtor();
    nativeSampleRate = micAudioCtx.sampleRate;

    // Load the inline worklet via a temporary Blob URL (no extra file required).
    const workletBlob = new Blob([_WORKLET_SOURCE], { type: 'application/javascript' });
    const workletUrl = URL.createObjectURL(workletBlob);
    await micAudioCtx.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    micSourceNode = micAudioCtx.createMediaStreamSource(micStream);
    micWorkletNode = new AudioWorkletNode(micAudioCtx, 'pcm-capture');

    // Worklet posts ~85 ms Float32 chunks → downsample → PCM16 → send over WS
    micWorkletNode.port.onmessage = (ev) => {
      if (!voiceWs || voiceWs.readyState !== WebSocket.OPEN) return;
      const float32   = new Float32Array(ev.data);
      const resampled = _downsample(float32, nativeSampleRate, 16000);
      voiceWs.send(_float32ToPcm16(resampled));
    };
    micSourceNode.connect(micWorkletNode);
    // Note: AudioWorkletNode does not need to connect to destination to process audio.

    // ── Open WebSocket ──────────────────────────────────────────────────────
    return new Promise((resolve, reject) => {
      let wsUrl;
      try { wsUrl = _buildWsUrl(); }
      catch (err) { _stopMic(); reject(err); return; }

      voiceWs = new WebSocket(wsUrl);
      voiceWs.binaryType = 'arraybuffer';

      voiceWs.onopen = () => {
        // Send start control with optional session_id for conversation continuity.
        voiceWs.send(JSON.stringify({ type: 'start', session_id: state.sessionId || null }));
        resolve();
      };

      voiceWs.onerror = () => {
        _stopMic();
        reject(new Error('WebSocket connection failed'));
      };

      voiceWs.onclose = () => {
        // Unexpected close (server restarted, network drop, etc.)
        if (voiceState !== VOICE_STATE.IDLE) {
          stopVoiceAssistantCompletely().catch(() => { });
        }
      };

      // ── Handle server events ────────────────────────────────────────────
      voiceWs.onmessage = (ev) => {
        // Binary frame → TTS audio chunk; accumulate for playback on tts_done.
        if (ev.data instanceof ArrayBuffer) {
          ttsAudioChunks.push(ev.data);
          return;
        }

        let msg;
        try { msg = JSON.parse(ev.data); } catch (_) { return; }
        const t = msg.type;

        if (t === 'ready') {
          // Server acknowledged the connection — show listening state.
          setVoiceState(VOICE_STATE.LISTENING);
        }

        else if (t === 'interrupted') {
          // Barge-in: user started speaking while AI was playing TTS.
          // Stop audio immediately and reset to listening.
          if (speakingAudio) { try { speakingAudio.pause(); } catch (_) { } speakingAudio = null; }
          _stopOrb();
          ttsAudioChunks = [];
          pendingAssistantId = null;
          fullLLMText = '';
          setVoiceState(VOICE_STATE.LISTENING);
        }

        else if (t === 'speech_start') {
          // VAD detected speech — show user bubble immediately.
          _initUtteranceBubbles();
        }

        else if (t === 'partial_stt') {
          // Live transcription tick while user is still speaking.
          // Update the user bubble in-place (no new bubble created).
          if (msg.text && replaceLastUserBubbleText) {
            replaceLastUserBubbleText(msg.text);
            if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        }

        else if (t === 'speech_end') {
          // Utterance captured — STT→LLM→TTS pipeline is now running.
          setVoiceState(VOICE_STATE.PROCESSING);
          if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
        }

        else if (t === 'final_stt') {
          // Accurate transcription arrived — replace the partial text.
          if (msg.text && replaceLastUserBubbleText) {
            replaceLastUserBubbleText(msg.text);
            saveActiveHtml?.();
            if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
          }
        }

        else if (t === 'llm_token') {
          // Stream AI response tokens into the assistant bubble.
          if (msg.delta) {
            fullLLMText += msg.delta;
            if (pendingAssistantId != null) {
              if (updateAssistantPendingText) updateAssistantPendingText(pendingAssistantId, fullLLMText);
              else if (replaceAssistantPending) replaceAssistantPending(pendingAssistantId, fullLLMText);
            }
          }
        }

        else if (t === 'llm_done') {
          // Full LLM response arrived — finalise the assistant bubble.
          if (msg.text) {
            fullLLMText = msg.text;
            if (pendingAssistantId != null && replaceAssistantPending) {
              replaceAssistantPending(pendingAssistantId, fullLLMText);
              saveActiveHtml?.();
              if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
            }
          }
        }

        else if (t === 'tts_start') {
          ttsAudioChunks = []; // reset accumulator (binary frames follow)
        }

        else if (t === 'tts_done') {
          // All TTS chunks received — play them.
          _playTtsAudio();
        }

        else if (t === 'done') {
          // Turn complete. Save session_id for conversation continuity.
          const ss = _getSessionState();
          if (ss && msg.session_id) ss.state.sessionId = msg.session_id;
          if (messagesEl && ss) ss.state.html = messagesEl.innerHTML;
        }

        else if (t === 'error') {
          const errMsg = msg.message || 'Voice error';
          if (pendingAssistantId != null && replaceAssistantPending) {
            replaceAssistantPending(pendingAssistantId, `**Error:** ${errMsg}`, true);
            saveActiveHtml?.();
          }
          // Stay in LISTENING — user can speak again without restarting the session.
          setVoiceState(VOICE_STATE.LISTENING);
          pendingAssistantId = null;
          fullLLMText = '';
          ttsAudioChunks = [];
        }
      };
    });
  }

  // ==========================================================================
  // SECTION 6 — PUBLIC LIFECYCLE API
  // ==========================================================================

  /**
   * Start the voice assistant: opens WS, starts mic, begins streaming.
   * Falls back to the legacy MediaRecorder + SSE path if WS is unavailable.
   */
  async function startVoiceRecording() {
    if (performance.now() - lastSpeakingEndedAt < SPEAKING_COOLDOWN_MS) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone not supported.');
    if (!window.visionAPI?.isAuthenticated?.()) throw new Error('Please login first.');

    // Try the WebSocket path first.
    try {
      setVoiceState(VOICE_STATE.LISTENING);
      const ss = _getSessionState();
      if (!ss) throw new Error('No active chat session');
      await _openWsSession(ss);
      return; // success — setVoiceState(LISTENING) will fire on 'ready' event
    } catch (wsErr) {
      console.warn('[Voice] WS failed, falling back to SSE:', wsErr.message);
      _stopMic();
      _closeWs();
    }

    // ── Fallback: legacy MediaRecorder + SSE ──────────────────────────────
    const stream = await navigator.mediaDevices.getUserMedia(VOICE_MIC_CONSTRAINTS);
    legacyStream = stream;
    legacyChunks = [];
    legacyRecorder = new MediaRecorder(stream);
    legacyRecorder.ondataavailable = (ev) => { if (ev.data?.size > 0) legacyChunks.push(ev.data); };
    legacyRecorder.onstop = () => stream.getTracks().forEach(t => t.stop());
    legacyRecorder.start();
    isVoiceRecording = true;
    setVoiceState(VOICE_STATE.LISTENING);
    startOrbFromStream(stream);
  }

  /**
   * Signal end-of-turn to the backend.
   *
   * WebSocket path: sends a {"type":"stop"} control message (server will
   * force-end the current utterance and run the pipeline).
   *
   * Legacy path: stops the MediaRecorder and POSTs the blob to the SSE endpoint.
   */
  async function stopVoiceRecordingAndSend() {
    // WS path — just tell the backend to end the turn.
    if (voiceWs && voiceWs.readyState === WebSocket.OPEN) {
      voiceWs.send(JSON.stringify({ type: 'stop' }));
      return;
    }

    // Legacy MediaRecorder + SSE fallback.
    if (!legacyRecorder || !getActive || !getMode || !messagesEl) return;
    const active = getActive();
    if (!active || !window.visionAPI?.isAuthenticated?.()) return;

    const mode  = getMode();
    const state = active.mode[mode];
    if (!state.started) { state.started = true; messagesEl.innerHTML = ''; }

    await new Promise(resolve => {
      legacyRecorder.addEventListener('stop', resolve, { once: true });
      legacyRecorder.stop();
    });
    _stopOrb();
    setVoiceState(VOICE_STATE.PROCESSING);

    isVoiceRecording = false;
    legacyStream = null;

    const blob = new Blob(legacyChunks, { type: 'audio/webm' });
    const file = new File([blob], 'voice.webm', { type: 'audio/webm' });

    appendUserBubble?.('[Voice message]');
    const lpid = appendAssistantPending?.();
    saveActiveHtml?.();
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;

    let finalSessionId = state.sessionId;
    const legacyAudioChunks = [];
    let legacyLLMText = '';

    try {
      await window.visionAPI.voiceChatStream(file, state.sessionId, (eventType, data) => {
        if (eventType === 'stt_result' && data.text) {
          replaceLastUserBubbleText?.(data.text);
          saveActiveHtml?.();
          if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        if (eventType === 'llm_token' && data.delta) {
          legacyLLMText += data.delta;
          if (updateAssistantPendingText) updateAssistantPendingText(lpid, legacyLLMText);
          else if (replaceAssistantPending) replaceAssistantPending(lpid, legacyLLMText);
        }
        if (eventType === 'llm_done' && data.text) {
          legacyLLMText = data.text;
          replaceAssistantPending?.(lpid, legacyLLMText);
          saveActiveHtml?.();
          if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        if (eventType === 'tts_chunk' && data.audio) {
          try { legacyAudioChunks.push(Uint8Array.from(atob(data.audio), c => c.charCodeAt(0))); } catch (_) { }
        }
        if (eventType === 'done' && data.session_id) finalSessionId = data.session_id;
      });

      if (finalSessionId) state.sessionId = finalSessionId;
      state.html = messagesEl.innerHTML;
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;

      if (legacyAudioChunks.length) {
        const url = URL.createObjectURL(new Blob(legacyAudioChunks, { type: 'audio/wav' }));
        const audio = new Audio(url);
        speakingAudio = audio;
        audio.play()
          .then(() => { setVoiceState(VOICE_STATE.SPEAKING); startOrbFromAudioElement(audio); })
          .catch(() => { speakingAudio = null; URL.revokeObjectURL(url); setVoiceState(VOICE_STATE.LISTENING); });
        audio.onended = () => { URL.revokeObjectURL(url); speakingAudio = null; _stopOrb(); setVoiceState(VOICE_STATE.LISTENING); };
      } else {
        setVoiceState(VOICE_STATE.LISTENING);
      }
    } catch (err) {
      replaceAssistantPending?.(lpid, `**Error:** ${err.message || 'Voice chat failed'}`, true);
      saveActiveHtml?.();
      setVoiceState(VOICE_STATE.LISTENING);
    }
    syncSendButtonVisual();
  }

  /** Stop everything and reset to IDLE. Called when the user taps the mic button to end the session. */
  async function stopVoiceAssistantCompletely() {
    // Stop TTS playback.
    if (speakingAudio) { try { speakingAudio.pause(); } catch (_) { } speakingAudio = null; }

    // Close WS and mic.
    _closeWs();
    _stopMic();
    _stopOrb();

    // Legacy recorder teardown.
    if (legacyRecorder) {
      try { legacyRecorder.ondataavailable = legacyRecorder.onstop = null; legacyRecorder.stop(); } catch (_) { }
      legacyRecorder = null;
    }
    legacyChunks = [];
    isVoiceRecording = false;
    if (legacyStream) { try { legacyStream.getTracks().forEach(t => t.stop()); } catch (_) { } legacyStream = null; }

    ttsAudioChunks = [];
    pendingAssistantId = null;
    fullLLMText = '';

    setVoiceState(VOICE_STATE.IDLE);
  }

  // ==========================================================================
  // SECTION 7 — LEGACY VOICE BUTTON (small mic icon, non-streaming fallback)
  // ==========================================================================

  /**
   * Wires the standalone voice button (small mic icon in the toolbar) to the
   * non-streaming voiceChat API endpoint. This is separate from the main voice
   * assistant and is kept for backwards compatibility.
   */
  function _initLegacyVoiceBtn() {
    if (!voiceBtn || !getActive || !getMode || !messagesEl || !appendUserBubble || !appendAssistantPending || !saveActiveHtml) return;

    let recorder = null, chunks = [], recording = false;

    async function start() {
      const stream = await navigator.mediaDevices.getUserMedia(VOICE_MIC_CONSTRAINTS);
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = ev => { if (ev.data?.size > 0) chunks.push(ev.data); };
      recorder.onstop = () => stream.getTracks().forEach(t => t.stop());
      recorder.start();
      recording = true;
      voiceBtn.classList.add('text-danger');
    }

    async function stopAndSend() {
      if (!recorder) return;
      const active = getActive();
      if (!active || !window.visionAPI?.isAuthenticated?.()) return;
      const mode = getMode(), state = active.mode[mode];
      if (!state.started) { state.started = true; messagesEl.innerHTML = ''; }

      await new Promise(resolve => recorder.addEventListener('stop', resolve, { once: true }));
      recorder.stop();
      recording = false;
      voiceBtn.classList.remove('text-danger');

      const file = new File([new Blob(chunks, { type: 'audio/webm' })], 'voice.webm', { type: 'audio/webm' });
      const pid = appendAssistantPending();
      appendUserBubble('[Voice message]');
      saveActiveHtml();
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;

      const result = await window.visionAPI.voiceChat(file, state.sessionId);
      if (result?.sessionId) state.sessionId = result.sessionId;
      replaceAssistantPending?.(pid, result?.textResponse || '(voice response)');
      state.html = messagesEl.innerHTML;
      if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;

      if (result?.audioBlob) {
        const url = URL.createObjectURL(result.audioBlob);
        const audio = new Audio(url);
        audio.play().catch(() => { });
        audio.onended = () => URL.revokeObjectURL(url);
      }
    }

    voiceBtn.addEventListener('click', async () => {
      try { if (!recording) await start(); else await stopAndSend(); }
      catch (_) { recording = false; voiceBtn.classList.remove('text-danger'); }
    });
  }

  // ==========================================================================
  // SECTION 8 — HELPERS
  // ==========================================================================

  /** Get the active session state object from chatbot-core. */
  function _getSessionState() {
    if (!getActive || !getMode) return null;
    const active = getActive();
    if (!active) return null;
    const mode = getMode();
    return { active, mode, state: active.mode[mode] };
  }

  // ==========================================================================
  // SECTION 9 — INIT & PUBLIC API
  // ==========================================================================

  function init(deps) {
    getActive               = deps.getActive;
    getMode                 = deps.getMode;
    messagesEl              = deps.messagesEl;
    appendUserBubble        = deps.appendUserBubble;
    replaceLastUserBubbleText = deps.replaceLastUserBubbleText;
    appendAssistantPending  = deps.appendAssistantPending;
    replaceAssistantPending = deps.replaceAssistantPending;
    updateAssistantPendingText = deps.updateAssistantPendingText;
    saveActiveHtml          = deps.saveActiveHtml;
    chatbotOffcanvas        = deps.chatbotOffcanvas;
    sendBtn                 = deps.sendBtn;
    voiceBtn                = deps.voiceBtn;
    if (voiceBtn) _initLegacyVoiceBtn();
  }

  /** Public API exposed on window.ChatbotVoice */
  window.ChatbotVoice = {
    init,
    isVoiceAssistantActive:  () => voiceState !== VOICE_STATE.IDLE,
    isTextStreaming:         () => !!isTextStreaming,
    setTextStreaming:        (flag) => { isTextStreaming = !!flag; },
    startVoiceRecording,
    stopVoiceRecordingAndSend,
    stopVoiceAssistantCompletely,
    syncSendButtonVisual,
    getVoiceState:           () => voiceState,
  };

  // If chatbot-core already called init() before this script loaded, apply deps now.
  if (window.ChatbotVoicePendingDeps) {
    try { init(window.ChatbotVoicePendingDeps); } catch (_) { }
    window.ChatbotVoicePendingDeps = null;
  }
})();
