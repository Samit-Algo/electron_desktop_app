// ChatGPT-style voice assistant module - handles voice recording, playback, and UI animations

(function () {
  'use strict';

  // Voice assistant state machine
  const VOICE_STATE = {
    IDLE: 'idle',
    LISTENING: 'listening',
    PROCESSING: 'processing',
    SPEAKING: 'speaking',
    ERROR: 'error'
  };

  // Core voice state variables
  let voiceState = VOICE_STATE.IDLE;
  let lastSpeakingEndedAt = 0;

  // Silence detection state for auto-stop during listening
  let listeningHasHeardSpeech = false;
  let utteranceSilenceMs = 0;
  let lastUserVoiceActivityTs = 0;

  // Recording state
  let isVoiceRecording = false;
  let isTextStreaming = false;
  let voiceRecorder = null;
  let voiceChunks = [];
  let voiceStream = null;

  // Audio-reactive orb animation state
  let audioCtx = null;
  let analyser = null;
  let analyserData = null;
  let analyserRaf = null;

  // Assistant speaking audio and barge-in detection
  let speakingAudio = null;
  const SPEAKING_COOLDOWN_MS = 250;
  let bargeStream = null;
  let bargeCtx = null;
  let bargeAnalyser = null;
  let bargeData = null;
  let bargeRaf = null;
  let bargeSpeechMs = 0;

  // Module dependencies injected from chatbot-core.js
  let getActive = null;
  let getMode = null;
  let messagesEl = null;
  let appendUserBubble = null;
  let appendAssistantPending = null;
  let replaceAssistantPending = null;
  let saveActiveHtml = null;
  let chatbotOffcanvas = null;
  let sendBtn = null;
  let voiceBtn = null;

  // Update voice status label text based on current state
  function updateVoiceStatusLabel(state) {
    const labelEl = document.getElementById('voice-status-label');
    if (!labelEl) return;
    let text = '';
    if (state === VOICE_STATE.LISTENING) text = 'Listening…';
    else if (state === VOICE_STATE.PROCESSING) text = 'Processing…';
    else if (state === VOICE_STATE.SPEAKING) text = 'Speaking…';
    else if (state === VOICE_STATE.ERROR) text = 'Something went wrong';
    labelEl.textContent = text;
    labelEl.style.opacity = text ? '1' : '0';
  }

  // Check if voice assistant is currently active (not idle)
  function isVoiceAssistantActive() {
    return voiceState !== VOICE_STATE.IDLE;
  }

  // Sync send button visual state based on text input, voice state, and streaming state
  function syncSendButtonVisual() {
    const textareaEl = document.getElementById('chatbot-input');
    const btn = sendBtn || document.querySelector('#chatbot-offcanvas .send-btn');
    if (!textareaEl || !btn) return;

    const hasText = textareaEl.value.trim().length > 0;
    const voiceIcon = btn.querySelector('.voice-icon');
    const sendIcon = btn.querySelector('.send-icon');
    const stopIcon = btn.querySelector('.stop-icon');

    btn.classList.remove('streaming', 'recording');

    const voiceActive = isVoiceAssistantActive();

    // Priority 1: Show stop button if text is streaming
    if (isTextStreaming) {
      btn.classList.remove('voice-assistant-state');
      btn.classList.add('streaming');
      btn.setAttribute('aria-label', 'Stop response');
      btn.setAttribute('title', 'Stop response');
      if (voiceIcon) voiceIcon.style.display = 'none';
      if (sendIcon) sendIcon.style.display = 'none';
      if (stopIcon) stopIcon.style.display = 'flex';
      return;
    }

    // Priority 2: Show recording state if voice is active
    if (voiceActive) {
      btn.classList.add('recording');
      btn.classList.remove('voice-assistant-state');
      btn.setAttribute('aria-label', 'Stop voice assistant');
      btn.setAttribute('title', 'Stop voice assistant');
      if (voiceIcon) voiceIcon.style.display = 'flex';
      if (sendIcon) sendIcon.style.display = 'none';
      if (stopIcon) stopIcon.style.display = 'none';
      return;
    }

    // Priority 3: Show send button if textarea has text, otherwise show voice button
    const showSend = hasText;
    if (showSend) {
      btn.classList.remove('voice-assistant-state');
      btn.setAttribute('aria-label', 'Send Message');
      btn.setAttribute('title', 'Send');
      if (voiceIcon) voiceIcon.style.display = 'none';
      if (sendIcon) sendIcon.style.display = 'flex';
      if (stopIcon) stopIcon.style.display = 'none';
    } else {
      btn.classList.add('voice-assistant-state');
      btn.setAttribute('aria-label', 'Voice Assistant');
      btn.setAttribute('title', 'Voice Assistant');
      if (voiceIcon) voiceIcon.style.display = 'flex';
      if (sendIcon) sendIcon.style.display = 'none';
      if (stopIcon) stopIcon.style.display = 'none';
    }
  }

  // Show voice UI overlay with animated orb
  function showVoiceUI() {
    if (!messagesEl) return;
    const overlay = chatbotOffcanvas?.querySelector?.('#voice-ui-overlay');
    const wrap = messagesEl.closest?.('.chat-messages-wrap');
    if (wrap) wrap.classList.add('voice-ui-active');
    if (overlay) {
      overlay.classList.remove('d-none');
      overlay.setAttribute('aria-hidden', 'false');
    }
  }

  // Hide voice UI overlay
  function hideVoiceUI() {
    if (!messagesEl) return;
    const overlay = chatbotOffcanvas?.querySelector?.('#voice-ui-overlay');
    const wrap = messagesEl.closest?.('.chat-messages-wrap');
    wrap?.classList?.remove?.('voice-ui-active');
    overlay?.classList?.add?.('d-none');
    overlay?.setAttribute?.('aria-hidden', 'true');
  }

  // Update voice state and trigger UI updates
  function setVoiceState(next) {
    if (!Object.values(VOICE_STATE).includes(next)) return;
    if (voiceState === next) return;

    const prev = voiceState;
    voiceState = next;

    // Show/hide UI overlay based on state
    if (next === VOICE_STATE.IDLE) hideVoiceUI();
    else showVoiceUI();

    // Reset silence detection when leaving listening state
    if (prev === VOICE_STATE.LISTENING && next !== VOICE_STATE.LISTENING) {
      listeningHasHeardSpeech = false;
      utteranceSilenceMs = 0;
      lastUserVoiceActivityTs = 0;
    }

    // Track when speaking ends for cooldown period
    if (prev === VOICE_STATE.SPEAKING && next === VOICE_STATE.IDLE) {
      lastSpeakingEndedAt = performance.now();
    }

    // Start/stop barge-in detector when entering/leaving speaking state
    if (prev !== VOICE_STATE.SPEAKING && next === VOICE_STATE.SPEAKING) {
      startBargeInDetector();
    } else if (prev === VOICE_STATE.SPEAKING && next !== VOICE_STATE.SPEAKING) {
      stopBargeInDetector();
    }

    updateVoiceStatusLabel(next);
    syncSendButtonVisual();
  }

  // Start audio-reactive orb animation from microphone stream
  function startOrbAudioReactive(stream) {
    try {
      stopOrbAudioReactive();

      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;

      // Create audio context and analyser for real-time audio analysis
      audioCtx = new AudioContextCtor();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.85;

      const src = audioCtx.createMediaStreamSource(stream);
      src.connect(analyser);

      analyserData = new Uint8Array(analyser.fftSize);

      const orbEl = document.getElementById('voice-orb');
      const orbContainer = orbEl?.closest?.('.orb-container') || orbEl;
      const baseScale = 1;
      const maxExtraScale = 0.55;
      let rot = 0;
      let lastTs = performance.now();

      // Animation frame loop: analyze audio and update orb visual properties
      function frame() {
        if (!analyser || !analyserData) return;
        const nowTs = performance.now();
        const dt = nowTs - lastTs;
        lastTs = nowTs;
        analyser.getByteTimeDomainData(analyserData);

        // Calculate RMS (root mean square) for audio energy
        let sumSq = 0;
        for (let i = 0; i < analyserData.length; i++) {
          const v = (analyserData[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / analyserData.length);

        // Normalize audio level to 0-1 range with gate and span
        const gate = 0.015;
        const span = 0.14;
        const raw = Math.max(0, Math.min(1, (rms - gate) / span));
        const n = Math.pow(raw, 0.25);

        // Update orb scale, glow, and rotation based on audio level
        const s = baseScale + (n * maxExtraScale);
        if (orbContainer?.style) {
          orbContainer.style.transform = `scale(${s.toFixed(3)})`;
          const glowA = (0.25 + n * 0.75).toFixed(2);
          orbContainer.style.filter =
            `drop-shadow(0 0 10px rgba(255, 62, 28, ${glowA})) ` +
            `drop-shadow(0 0 10px rgba(28, 140, 255, ${glowA}))`;

          rot += (0.6 + n * 3.2);
          orbContainer.style.setProperty('--aura', n.toFixed(3));
          orbContainer.style.setProperty('--auraScale', (1 + n * 0.10).toFixed(3));
          orbContainer.style.setProperty('--auraRot', `${rot.toFixed(1)}deg`);
        }

        // During listening: detect speech and silence for auto-stop
        if (voiceState === VOICE_STATE.LISTENING) {
          const speechThreshold = 0.18;
          const nowMs = nowTs;

          if (n > speechThreshold) {
            // Speech detected: reset silence timer
            listeningHasHeardSpeech = true;
            utteranceSilenceMs = 0;
            lastUserVoiceActivityTs = nowMs;
          } else if (listeningHasHeardSpeech) {
            // Silence after speech: accumulate silence time
            utteranceSilenceMs += dt;
            const UTTERANCE_SILENCE_LIMIT_MS = 1200;
            if (utteranceSilenceMs >= UTTERANCE_SILENCE_LIMIT_MS) {
              // Auto-stop after 1.2s of silence
              listeningHasHeardSpeech = false;
              utteranceSilenceMs = 0;
              if (voiceState === VOICE_STATE.LISTENING) {
                stopVoiceRecordingAndSend().catch(() => { });
              }
            }
          }

          // Auto-stop if no activity for 30 seconds
          if (lastUserVoiceActivityTs) {
            const SESSION_IDLE_LIMIT_MS = 30000;
            if ((nowMs - lastUserVoiceActivityTs) >= SESSION_IDLE_LIMIT_MS) {
              lastUserVoiceActivityTs = 0;
              listeningHasHeardSpeech = false;
              utteranceSilenceMs = 0;
              if (isVoiceAssistantActive()) {
                stopVoiceAssistantCompletely().catch(() => { });
              }
            }
          }
        }

        analyserRaf = requestAnimationFrame(frame);
      }

      analyserRaf = requestAnimationFrame(frame);
    } catch (_) {
      stopOrbAudioReactive();
    }
  }

  // Start audio-reactive orb animation from audio element (for assistant speaking)
  function startOrbAudioReactiveFromAudioElement(audioElement) {
    try {
      stopOrbAudioReactive();

      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;

      audioCtx = new AudioContextCtor();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.85;

      const src = audioCtx.createMediaElementSource(audioElement);
      src.connect(analyser);
      analyser.connect(audioCtx.destination);

      analyserData = new Uint8Array(analyser.fftSize);

      const orbEl = document.getElementById('voice-orb');
      const orbContainer = orbEl?.closest?.('.orb-container') || orbEl;
      const baseScale = 1;
      const maxExtraScale = 0.55;
      let rot = 0;
      let lastTs = performance.now();

      // Animation frame loop: analyze audio and update orb visual properties
      function frame() {
        if (!analyser || !analyserData) return;
        const nowTs = performance.now();
        lastTs = nowTs;
        analyser.getByteTimeDomainData(analyserData);

        // Calculate RMS for audio energy
        let sumSq = 0;
        for (let i = 0; i < analyserData.length; i++) {
          const v = (analyserData[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / analyserData.length);

        // Normalize audio level
        const gate = 0.015;
        const span = 0.14;
        const raw = Math.max(0, Math.min(1, (rms - gate) / span));
        const n = Math.pow(raw, 0.25);

        // Update orb visual properties
        const s = baseScale + (n * maxExtraScale);
        if (orbContainer?.style) {
          orbContainer.style.transform = `scale(${s.toFixed(3)})`;
          const glowA = (0.25 + n * 0.75).toFixed(2);
          orbContainer.style.filter =
            `drop-shadow(0 0 10px rgba(255, 62, 28, ${glowA})) ` +
            `drop-shadow(0 0 10px rgba(28, 140, 255, ${glowA}))`;

          rot += (0.6 + n * 3.2);
          orbContainer.style.setProperty('--aura', n.toFixed(3));
          orbContainer.style.setProperty('--auraScale', (1 + n * 0.10).toFixed(3));
          orbContainer.style.setProperty('--auraRot', `${rot.toFixed(1)}deg`);
        }

        // Continue animation only while speaking
        if (voiceState === VOICE_STATE.SPEAKING) {
          analyserRaf = requestAnimationFrame(frame);
        }
      }

      analyserRaf = requestAnimationFrame(frame);
    } catch (_) {
      stopOrbAudioReactive();
    }
  }

  // Stop audio-reactive orb animation and clean up audio context
  function stopOrbAudioReactive() {
    try {
      if (analyserRaf) cancelAnimationFrame(analyserRaf);
    } catch (_) { }
    analyserRaf = null;
    analyserData = null;
    analyser = null;

    // Reset orb visual properties
    try {
      const orbEl = document.getElementById('voice-orb');
      const orbContainer = orbEl?.closest?.('.orb-container') || orbEl;
      if (orbContainer?.style) {
        orbContainer.style.transform = '';
        orbContainer.style.filter = '';
      }
    } catch (_) { }

    // Close audio context
    try {
      audioCtx?.close?.();
    } catch (_) { }
    audioCtx = null;
  }

  // Start barge-in detector to allow user to interrupt assistant speaking
  function startBargeInDetector() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    if (bargeRaf || bargeCtx || bargeStream) return;

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      bargeStream = stream;
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;
      bargeCtx = new AudioContextCtor();
      bargeAnalyser = bargeCtx.createAnalyser();
      bargeAnalyser.fftSize = 1024;
      const src = bargeCtx.createMediaStreamSource(stream);
      src.connect(bargeAnalyser);
      bargeData = new Uint8Array(bargeAnalyser.fftSize);
      bargeSpeechMs = 0;
      let lastTs = performance.now();

      // Monitor microphone for sustained speech to trigger barge-in
      function frame() {
        if (!bargeAnalyser || !bargeData) return;
        if (voiceState !== VOICE_STATE.SPEAKING) return;

        bargeAnalyser.getByteTimeDomainData(bargeData);
        let sumSq = 0;
        for (let i = 0; i < bargeData.length; i++) {
          const v = (bargeData[i] - 128) / 128;
          sumSq += v * v;
        }
        const rms = Math.sqrt(sumSq / bargeData.length);

        const nowTs = performance.now();
        const dt = nowTs - lastTs;
        lastTs = nowTs;

        // Accumulate speech duration if above threshold
        const gate = 0.03;
        if (rms > gate) bargeSpeechMs += dt;
        else bargeSpeechMs = 0;

        // Trigger barge-in if speech detected for 230ms
        const BARGE_IN_MS = 230;
        if (bargeSpeechMs >= BARGE_IN_MS) {
          try {
            if (speakingAudio) {
              speakingAudio.pause();
              speakingAudio.currentTime = 0;
            }
          } catch (_) { }
          speakingAudio = null;
          stopBargeInDetector();
          setVoiceState(VOICE_STATE.IDLE);
          startVoiceRecording().catch(() => { });
          return;
        }

        bargeRaf = requestAnimationFrame(frame);
      }

      bargeRaf = requestAnimationFrame(frame);
    }).catch(() => { });
  }

  // Stop barge-in detector and clean up resources
  function stopBargeInDetector() {
    try {
      if (bargeRaf) cancelAnimationFrame(bargeRaf);
    } catch (_) { }
    bargeRaf = null;
    bargeData = null;
    bargeAnalyser = null;
    if (bargeCtx) {
      try { bargeCtx.close(); } catch (_) { }
    }
    bargeCtx = null;
    if (bargeStream) {
      try { bargeStream.getTracks().forEach(t => t.stop()); } catch (_) { }
    }
    bargeStream = null;
    bargeSpeechMs = 0;
  }

  // Completely stop voice assistant and clean up all resources
  async function stopVoiceAssistantCompletely() {
    try {
      if (voiceRecorder) {
        try {
          voiceRecorder.ondataavailable = null;
          voiceRecorder.onstop = null;
          voiceRecorder.stop();
        } catch (_) { }
      }
    } catch (_) { }
    voiceRecorder = null;
    voiceChunks = [];
    isVoiceRecording = false;

    // Stop microphone stream
    if (voiceStream) {
      try { voiceStream.getTracks().forEach(t => t.stop()); } catch (_) { }
    }
    voiceStream = null;

    stopOrbAudioReactive();

    // Stop speaking audio if playing
    try {
      if (speakingAudio) {
        speakingAudio.pause();
        speakingAudio.currentTime = 0;
      }
    } catch (_) { }
    speakingAudio = null;

    stopBargeInDetector();

    setVoiceState(VOICE_STATE.IDLE);
  }

  // Start voice recording with microphone access
  async function startVoiceRecording() {
    // Cooldown period after speaking to prevent accidental retriggers
    const now = performance.now();
    if (now - lastSpeakingEndedAt < SPEAKING_COOLDOWN_MS) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Microphone not supported.');
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceStream = stream;
    voiceChunks = [];
    voiceRecorder = new MediaRecorder(stream);
    voiceRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) voiceChunks.push(ev.data);
    };
    voiceRecorder.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
    };
    voiceRecorder.start();
    isVoiceRecording = true;
    listeningHasHeardSpeech = false;
    utteranceSilenceMs = 0;
    lastUserVoiceActivityTs = 0;
    setVoiceState(VOICE_STATE.LISTENING);
    startOrbAudioReactive(stream);
  }

  // Stop recording and send audio to backend for processing
  async function stopVoiceRecordingAndSend() {
    if (!voiceRecorder || !getActive || !getMode || !messagesEl || !appendUserBubble || !appendAssistantPending || !saveActiveHtml) return;
    const active = getActive();
    if (!active) return;
    if (!window.visionAPI?.isAuthenticated?.()) throw new Error('Please login first.');

    const mode = getMode();
    const state = active.mode[mode];

    // Clear initial template on first message
    if (!state.started) {
      state.started = true;
      messagesEl.innerHTML = '';
    }

    // Stop recorder and wait for stop event
    const stopped = new Promise(resolve => {
      voiceRecorder.addEventListener('stop', resolve, { once: true });
    });
    voiceRecorder.stop();
    stopOrbAudioReactive();
    setVoiceState(VOICE_STATE.PROCESSING);
    await stopped;

    isVoiceRecording = false;
    voiceStream = null;

    // Create audio file from recorded chunks
    const blob = new Blob(voiceChunks, { type: 'audio/webm' });
    const file = new File([blob], 'voice.webm', { type: 'audio/webm' });

    // Add user message bubble and pending assistant response
    appendUserBubble('[Voice message]');
    const pendingId = appendAssistantPending();
    saveActiveHtml();
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Send audio to backend and get response
    const result = await window.visionAPI.voiceChat(file, state.sessionId);
    if (result?.sessionId) state.sessionId = result.sessionId;
    const textResp = result?.textResponse || '(voice response)';
    if (replaceAssistantPending) replaceAssistantPending(pendingId, textResp);
    state.html = messagesEl.innerHTML;
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Play audio response if available, then auto-start listening again
    try {
      if (result?.audioBlob) {
        const url = URL.createObjectURL(result.audioBlob);
        const audio = new Audio(url);
        speakingAudio = audio;
        audio.play().then(() => {
          setVoiceState(VOICE_STATE.SPEAKING);
          startOrbAudioReactiveFromAudioElement(audio);
        }).catch(() => {
          speakingAudio = null;
          URL.revokeObjectURL(url);
          setVoiceState(VOICE_STATE.IDLE);
        });
        audio.onended = () => {
          URL.revokeObjectURL(url);
          speakingAudio = null;
          stopOrbAudioReactive();
          setVoiceState(VOICE_STATE.IDLE);
          // Auto-start listening for next user input
          startVoiceRecording().catch(() => { });
        };
      } else {
        setVoiceState(VOICE_STATE.IDLE);
      }
    } catch {
      setVoiceState(VOICE_STATE.IDLE);
    }
    syncSendButtonVisual();
  }

  // Legacy voice button handler (small mic button) - simpler implementation
  function initLegacyVoiceBtn() {
    if (!voiceBtn || !getActive || !getMode || !messagesEl || !appendUserBubble || !appendAssistantPending || !saveActiveHtml) return;
    let recorder = null;
    let chunks = [];
    let recording = false;

    // Start recording with legacy button
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone not supported.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
      };
      recorder.start();
      recording = true;
      voiceBtn.classList.add('text-danger');
    }

    // Stop recording and send audio
    async function stopAndSend() {
      if (!recorder) return;
      const active = getActive();
      if (!active) return;
      if (!window.visionAPI?.isAuthenticated?.()) throw new Error('Please login first.');

      const mode = getMode();
      const state = active.mode[mode];
      if (!state.started) {
        state.started = true;
        messagesEl.innerHTML = '';
      }

      const stopped = new Promise(resolve => {
        recorder.addEventListener('stop', resolve, { once: true });
      });
      recorder.stop();
      await stopped;

      recording = false;
      voiceBtn.classList.remove('text-danger');

      const blob = new Blob(chunks, { type: 'audio/webm' });
      const file = new File([blob], 'voice.webm', { type: 'audio/webm' });

      appendUserBubble('[Voice message]');
      const pendingId = appendAssistantPending();
      saveActiveHtml();
      messagesEl.scrollTop = messagesEl.scrollHeight;

      const result = await window.visionAPI.voiceChat(file, state.sessionId);
      if (result?.sessionId) state.sessionId = result.sessionId;
      const textResp = result?.textResponse || '(voice response)';
      if (replaceAssistantPending) replaceAssistantPending(pendingId, textResp);
      state.html = messagesEl.innerHTML;
      messagesEl.scrollTop = messagesEl.scrollHeight;

      // Play audio response if available
      try {
        if (result?.audioBlob) {
          const url = URL.createObjectURL(result.audioBlob);
          const audio = new Audio(url);
          audio.play().catch(() => { });
          audio.onended = () => URL.revokeObjectURL(url);
        }
      } catch { }
    }

    // Toggle recording on button click
    voiceBtn.addEventListener('click', async () => {
      try {
        if (!recording) await start();
        else await stopAndSend();
      } catch (err) {
        recording = false;
        voiceBtn.classList.remove('text-danger');
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
    });
  }

  // Initialize module with dependencies from chatbot-core.js
  function init(deps) {
    getActive = deps.getActive;
    getMode = deps.getMode;
    messagesEl = deps.messagesEl;
    appendUserBubble = deps.appendUserBubble;
    appendAssistantPending = deps.appendAssistantPending;
    replaceAssistantPending = deps.replaceAssistantPending;
    saveActiveHtml = deps.saveActiveHtml;
    chatbotOffcanvas = deps.chatbotOffcanvas;
    sendBtn = deps.sendBtn;
    voiceBtn = deps.voiceBtn;

    // Initialize legacy voice button if present
    if (voiceBtn) initLegacyVoiceBtn();
  }

  // Expose public API
  window.ChatbotVoice = {
    init,
    isVoiceAssistantActive,
    isTextStreaming: () => !!isTextStreaming,
    setTextStreaming(flag) { isTextStreaming = !!flag; },
    startVoiceRecording,
    stopVoiceRecordingAndSend,
    stopVoiceAssistantCompletely,
    syncSendButtonVisual,
    getVoiceState: () => voiceState
  };

  // Auto-initialize if dependencies were stashed before module loaded
  if (window.ChatbotVoicePendingDeps) {
    try {
      init(window.ChatbotVoicePendingDeps);
    } catch (e) {
      console.warn('[ChatbotVoice] Init failed:', e);
    }
    window.ChatbotVoicePendingDeps = null;
  }
})();
