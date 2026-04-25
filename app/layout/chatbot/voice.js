import { api } from '../../core/api.js';
/**
 * CHATBOT VOICE MODULE (ES Module)
 */

const VOICE_STATE = {
  IDLE:       'idle',
  LISTENING:  'listening',
  PROCESSING: 'processing',
  SPEAKING:   'speaking',
  ERROR:      'error',
};

let voiceState = VOICE_STATE.IDLE;
let lastSpeakingEndedAt = 0;
const SPEAKING_COOLDOWN_MS = 250;

const VOICE_MIC_CONSTRAINTS = {
  audio: {
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};

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

/** @type {HTMLAudioElement|null} */
let speakingAudio = null;
let ttsAudioChunks = [];

let pendingAssistantId = null;
let fullLLMText = '';

let orbAudioCtx = null;
let orbAnalyser = null;
let orbAnalyserData = null;
let orbAnimFrame = null;

let isVoiceRecording = false;
let isTextStreaming = false;
let legacyRecorder = null;
let legacyChunks = [];
let legacyStream = null;

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

export function syncSendButtonVisual() {
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
// SECTION 3 — ORB ANIMATION
// ==========================================================================

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
    orbAnalyser.connect(orbAudioCtx.destination);
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

function _float32ToPcm16(float32) {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return buf;
}

// ==========================================================================
// SECTION 5 — WEBSOCKET SESSION
// ==========================================================================

const _WORKLET_SOURCE = `
class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = [];
    this._TARGET = 4096;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    this._buf.push(new Float32Array(ch));
    let total = this._buf.reduce((s, a) => s + a.length, 0);
    if (total >= this._TARGET) {
      const out = new Float32Array(total);
      let offset = 0;
      for (const b of this._buf) { out.set(b, offset); offset += b.length; }
      this.port.postMessage(out.buffer, [out.buffer]);
      this._buf = [];
    }
    return true;
  }
}
registerProcessor('pcm-capture', PCMCaptureProcessor);
`;

function _buildWsUrl() {
  if (!api?.token) throw new Error('Not authenticated');
  const wsBase = api.baseURL.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
  return `${wsBase}/api/v1/general-chat/voice-stream?token=${encodeURIComponent(api.token)}`;
}

function _stopMic() {
  if (micWorkletNode) {
    try { micWorkletNode.port.onmessage = null; micWorkletNode.disconnect(); } catch (_) { }
    micWorkletNode = null;
  }
  if (micSourceNode) { try { micSourceNode.disconnect(); } catch (_) { } micSourceNode = null; }
  if (micAudioCtx)   { try { micAudioCtx.close(); }        catch (_) { } micAudioCtx = null; }
  if (micStream)     { try { micStream.getTracks().forEach(t => t.stop()); } catch (_) { } micStream = null; }
}

function _closeWs() {
  if (!voiceWs) return;
  try {
    voiceWs.onopen = voiceWs.onmessage = voiceWs.onerror = voiceWs.onclose = null;
    if (voiceWs.readyState <= WebSocket.OPEN) voiceWs.close(1000, 'Session ended');
  } catch (_) { }
  voiceWs = null;
}

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
    setVoiceState(VOICE_STATE.LISTENING);
  };
}

async function _openWsSession(sessionState) {
  const { state } = sessionState;

  micStream = await navigator.mediaDevices.getUserMedia(VOICE_MIC_CONSTRAINTS);
  startOrbFromStream(micStream);

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  micAudioCtx = new AudioContextCtor();
  nativeSampleRate = micAudioCtx.sampleRate;

  const workletBlob = new Blob([_WORKLET_SOURCE], { type: 'application/javascript' });
  const workletUrl = URL.createObjectURL(workletBlob);
  await micAudioCtx.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);

  micSourceNode = micAudioCtx.createMediaStreamSource(micStream);
  micWorkletNode = new AudioWorkletNode(micAudioCtx, 'pcm-capture');

  micWorkletNode.port.onmessage = (ev) => {
    if (!voiceWs || voiceWs.readyState !== WebSocket.OPEN) return;
    const float32   = new Float32Array(ev.data);
    const resampled = _downsample(float32, nativeSampleRate, 16000);
    voiceWs.send(_float32ToPcm16(resampled));
  };
  micSourceNode.connect(micWorkletNode);

  return new Promise((resolve, reject) => {
    let wsUrl;
    try { wsUrl = _buildWsUrl(); }
    catch (err) { _stopMic(); reject(err); return; }

    voiceWs = new WebSocket(wsUrl);
    voiceWs.binaryType = 'arraybuffer';

    voiceWs.onopen = () => {
      voiceWs.send(JSON.stringify({ type: 'start', session_id: state.sessionId || null }));
      resolve();
    };

    voiceWs.onerror = () => {
      _stopMic();
      reject(new Error('WebSocket connection failed'));
    };

    voiceWs.onclose = () => {
      if (voiceState !== VOICE_STATE.IDLE) {
        stopVoiceAssistantCompletely().catch(() => { });
      }
    };

    voiceWs.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        ttsAudioChunks.push(ev.data);
        return;
      }

      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      const t = msg.type;

      if (t === 'ready') {
        setVoiceState(VOICE_STATE.LISTENING);
      }

      else if (t === 'interrupted') {
        if (speakingAudio) { try { speakingAudio.pause(); } catch (_) { } speakingAudio = null; }
        _stopOrb();
        ttsAudioChunks = [];
        pendingAssistantId = null;
        fullLLMText = '';
        setVoiceState(VOICE_STATE.LISTENING);
      }

      else if (t === 'speech_start') {
        _initUtteranceBubbles();
      }

      else if (t === 'partial_stt') {
        if (msg.text && replaceLastUserBubbleText) {
          replaceLastUserBubbleText(msg.text);
          if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }

      else if (t === 'speech_end') {
        setVoiceState(VOICE_STATE.PROCESSING);
        if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      else if (t === 'final_stt') {
        if (msg.text && replaceLastUserBubbleText) {
          replaceLastUserBubbleText(msg.text);
          saveActiveHtml?.();
          if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }

      else if (t === 'llm_token') {
        if (msg.delta) {
          fullLLMText += msg.delta;
          if (pendingAssistantId != null) {
            if (updateAssistantPendingText) updateAssistantPendingText(pendingAssistantId, fullLLMText);
            else if (replaceAssistantPending) replaceAssistantPending(pendingAssistantId, fullLLMText);
          }
        }
      }

      else if (t === 'llm_done') {
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
        ttsAudioChunks = [];
      }

      else if (t === 'tts_done') {
        _playTtsAudio();
      }

      else if (t === 'done') {
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

export async function startVoiceRecording() {
  if (performance.now() - lastSpeakingEndedAt < SPEAKING_COOLDOWN_MS) return;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone not supported.');
  if (!api?.isAuthenticated?.()) throw new Error('Please login first.');

  if (typeof window.__workflowWatchdogVoiceRelease === 'function') {
    try { window.__workflowWatchdogVoiceRelease(); } catch (_) { }
  }

  try {
    setVoiceState(VOICE_STATE.LISTENING);
    const ss = _getSessionState();
    if (!ss) throw new Error('No active chat session');
    await _openWsSession(ss);
    return;
  } catch (wsErr) {
    console.warn('[Voice] WS failed, falling back to SSE:', wsErr.message);
    _stopMic();
    _closeWs();
  }

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

export async function stopVoiceRecordingAndSend() {
  if (voiceWs && voiceWs.readyState === WebSocket.OPEN) {
    voiceWs.send(JSON.stringify({ type: 'stop' }));
    return;
  }

  if (!legacyRecorder || !getActive || !getMode || !messagesEl) return;
  const active = getActive();
  if (!active || !api?.isAuthenticated?.()) return;

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
    await api.voiceChatStream(file, state.sessionId, (eventType, data) => {
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

export async function stopVoiceAssistantCompletely() {
  if (speakingAudio) { try { speakingAudio.pause(); } catch (_) { } speakingAudio = null; }

  _closeWs();
  _stopMic();
  _stopOrb();

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
// SECTION 7 — LEGACY VOICE BUTTON
// ==========================================================================

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
    if (!active || !api?.isAuthenticated?.()) return;
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

    const result = await api.voiceChat(file, state.sessionId);
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

export function init(deps) {
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

export const isVoiceAssistantActive = () => voiceState !== VOICE_STATE.IDLE;
export const getIsTextStreaming = () => !!isTextStreaming;
export function setTextStreaming(flag) { isTextStreaming = !!flag; }
export const getVoiceState = () => voiceState;
