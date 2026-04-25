import { toast } from '../../core/toast.js';
import { api } from '../../core/api.js';
/**
 * CHATBOT CORE MODULE (ES Module)
 */

import {
  init as initVoice,
  isVoiceAssistantActive,
  getIsTextStreaming,
  setTextStreaming,
  startVoiceRecording,
  stopVoiceAssistantCompletely,
  syncSendButtonVisual,
} from './voice.js';

import {
  init as initMarkdown,
  ensureMarkdownDeps,
  replaceAssistantPending as markdownReplaceAssistantPending,
  updateAssistantPendingText as markdownUpdateAssistantPendingText,
} from './markdown.js';

import { renderContentBlocksInBubble } from './attachments.js';
import { init as initZoneEditor, openZoneEditorInBubble } from './zone-editor.js';
import { init as initFlowDiagram, renderFlowDiagram } from './flow-diagram.js';

// Hoisted so initChatbotTabs and other init functions can assign to it before the export declaration
export const ChatbotCore = {
  setVideoPath(path) {
    if (!this._getActive || !this._getMode) return;
    const active = this._getActive();
    if (active) active.mode[this._getMode()].videoPath = path ? String(path).trim() || null : null;
  },
  setCameraId(id) {
    if (!this._getActive || !this._getMode) return;
    const active = this._getActive();
    if (active) active.mode[this._getMode()].cameraId = id ? String(id).trim() || null : null;
  },
  _getActive: null,
  _getMode: null,
};

window.ChatbotCore = ChatbotCore;

// ============================================================================
// SECTION 1: PATH & SCRIPT LOADING HELPERS
// ============================================================================

function loadScriptOnce(scriptUrl) {
  return new Promise((resolve, reject) => {
    try {
      const existing = document.querySelector(`script[src="${scriptUrl}"]`);
      if (existing) return resolve();
      const scriptEl = document.createElement('script');
      scriptEl.src = scriptUrl;
      scriptEl.defer = true;
      scriptEl.onload = () => resolve();
      scriptEl.onerror = () => reject(new Error(`Failed to load script: ${scriptUrl}`));
      document.head.appendChild(scriptEl);
    } catch (e) { reject(e); }
  });
}

function ensureReteFlowRenderer() {
  if (window.reteFlowRenderer && window.flowTransforms) return Promise.resolve();
  const transformsSrc = new URL('/app/layout/chatbot/flow-transforms.js', window.location.origin).toString();
  const rendererSrc = new URL('/app/layout/chatbot/rete-flow-renderer.js', window.location.origin).toString();
  return loadScriptOnce(transformsSrc).then(() => loadScriptOnce(rendererSrc)).catch(() => {});
}

let layoutSettling = false;

// ============================================================================
// SECTION 2: LAYOUT & RESIZE
// ============================================================================

function initChatbotLayout() {
  const chatbotOffcanvas = document.getElementById('chatbot-offcanvas');
  const viewportElement = document.querySelector('.viewport-scrolls');
  const contentElement = document.querySelector('.content');
  const appRootElement = document.getElementById('app-root');
  if (!chatbotOffcanvas || !appRootElement) return;

  const DEFAULT_CHATBOT_WIDTH = 400;
  const MIN_CHATBOT_WIDTH = 400;
  const MAX_CHATBOT_WIDTH = 1200;
  const EXPAND_AT = 420;
  const COLLAPSE_AT = 380;
  let expandedState = false;

  function getChatbotWidth() {
    const saved = localStorage.getItem('chatbotWidth');
    return saved ? parseInt(saved, 10) : DEFAULT_CHATBOT_WIDTH;
  }

  function setChatbotWidth(width) {
    width = Math.max(MIN_CHATBOT_WIDTH, Math.min(MAX_CHATBOT_WIDTH, width));
    chatbotOffcanvas.style.width = width + 'px';
    appRootElement.style.setProperty('--chatbot-width', width + 'px');
    const excess = Math.max(0, width - DEFAULT_CHATBOT_WIDTH);
    appRootElement.style.setProperty('--chatbot-excess', excess + 'px');
    localStorage.setItem('chatbotWidth', width.toString());
    updateLayoutBehavior(width);
  }

  function updateLayoutBehavior(chatbotWidth) {
    if (!contentElement) return;
    if (!expandedState && chatbotWidth >= EXPAND_AT) expandedState = true;
    else if (expandedState && chatbotWidth <= COLLAPSE_AT) expandedState = false;
    if (expandedState) {
      appRootElement.classList.add('chatbot-open', 'chatbot-expanded');
      if (viewportElement) viewportElement.classList.add('chatbot-expanded');
      contentElement.classList.add('chatbot-expanded');
    } else {
      appRootElement.classList.add('chatbot-open');
      appRootElement.classList.remove('chatbot-expanded');
      if (viewportElement) viewportElement.classList.remove('chatbot-expanded');
      contentElement.style.minWidth = '';
      contentElement.classList.remove('chatbot-expanded');
    }
  }

  function updateLayoutState(isOpen) {
    if (isOpen) {
      const w = getChatbotWidth();
      expandedState = w > DEFAULT_CHATBOT_WIDTH;
      setChatbotWidth(w);
    } else {
      expandedState = false;
      appRootElement.classList.remove('chatbot-open', 'chatbot-expanded');
      appRootElement.style.setProperty('--chatbot-width', '0px');
      appRootElement.style.setProperty('--chatbot-excess', '0px');
      if (viewportElement) viewportElement.classList.remove('chatbot-expanded');
      if (contentElement) { contentElement.classList.remove('chatbot-expanded'); contentElement.style.minWidth = ''; }
    }
  }

  function initChatbotResize() {
    const resizeHandle = document.getElementById('chatbot-resize-handle');
    if (!resizeHandle) return;
    let isResizing = false, startX = 0, startWidth = 0;
    resizeHandle.addEventListener('mousedown', function (e) {
      if (!chatbotOffcanvas.classList.contains('show')) return;
      isResizing = true; startX = e.clientX;
      startWidth = parseInt(window.getComputedStyle(chatbotOffcanvas).width, 10);
      document.body.classList.add('chatbot-resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault(); e.stopPropagation();
    });
    document.addEventListener('mousemove', function (e) {
      if (!isResizing) return;
      const isRTL = document.documentElement.getAttribute('dir') === 'rtl';
      let deltaX = isRTL ? (e.clientX - startX) : (startX - e.clientX);
      let rawWidth = startWidth + deltaX;
      if (rawWidth < 250) {
        isResizing = false;
        document.body.classList.remove('chatbot-resizing');
        document.body.style.cursor = ''; document.body.style.userSelect = '';
        const bsOffcanvas = bootstrap.Offcanvas.getInstance(chatbotOffcanvas);
        if (bsOffcanvas) bsOffcanvas.hide();
        return;
      }
      if (rawWidth < MIN_CHATBOT_WIDTH) rawWidth = MIN_CHATBOT_WIDTH;
      setChatbotWidth(rawWidth); e.preventDefault();
    });
    document.addEventListener('mouseup', function () {
      if (!isResizing) return;
      isResizing = false;
      document.body.classList.remove('chatbot-resizing');
      document.body.style.cursor = ''; document.body.style.userSelect = '';
      layoutSettling = true;
      requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => {
        layoutSettling = false;
        document.dispatchEvent(new Event('chatbot:layout-settled'));
      })));
    });
    resizeHandle.addEventListener('selectstart', e => { e.preventDefault(); return false; });
    resizeHandle.addEventListener('dragstart', e => { e.preventDefault(); return false; });
  }

  const initialWidth = getChatbotWidth();
  chatbotOffcanvas.style.width = initialWidth + 'px';
  appRootElement.style.setProperty('--chatbot-width', initialWidth + 'px');
  appRootElement.style.setProperty('--chatbot-excess', Math.max(0, initialWidth - DEFAULT_CHATBOT_WIDTH) + 'px');

  chatbotOffcanvas.addEventListener('show.bs.offcanvas', () => { setChatbotWidth(getChatbotWidth()); updateLayoutState(true); localStorage.setItem('chatbotOpen', 'true'); });
  chatbotOffcanvas.addEventListener('shown.bs.offcanvas', () => { setChatbotWidth(getChatbotWidth()); localStorage.setItem('chatbotOpen', 'true'); });
  chatbotOffcanvas.addEventListener('hide.bs.offcanvas', function (e) {
    if (window.innerWidth <= 991) {
      const active = document.activeElement;
      if (active && chatbotOffcanvas.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) { e.preventDefault(); return; }
    }
    updateLayoutState(false); localStorage.setItem('chatbotOpen', 'false');
  });
  chatbotOffcanvas.addEventListener('hidden.bs.offcanvas', () => { updateLayoutState(false); localStorage.setItem('chatbotOpen', 'false'); });

  if (chatbotOffcanvas.classList.contains('show')) {
    const w = getChatbotWidth();
    chatbotOffcanvas.style.width = w + 'px';
    updateLayoutBehavior(w); updateLayoutState(true);
  }
  initChatbotResize();
}

// ============================================================================
// SECTION 3: COMPOSER
// ============================================================================

function initChatbotComposer() {
  const textarea = document.getElementById('chatbot-input');
  const sendBtn = document.querySelector('#chatbot-offcanvas .send-btn');
  if (!textarea) return;

  function autosize() {
    textarea.style.height = 'auto';
    const cs = window.getComputedStyle(textarea);
    const lh = parseFloat(cs.lineHeight);
    const lineHeight = Number.isFinite(lh) ? lh : 16;
    const pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    textarea.style.height = Math.min(textarea.scrollHeight, lineHeight * 4 + pt + pb) + 'px';
  }

  function updateButtonState() {
    if (!sendBtn) return;
    if (sendBtn.classList.contains('recording') || sendBtn.classList.contains('streaming')) return;
    const hasText = textarea.value.trim().length > 0;
    const voiceIcon = sendBtn.querySelector('.voice-icon');
    const sendIcon = sendBtn.querySelector('.send-icon');
    const stopIcon = sendBtn.querySelector('.stop-icon');
    if (hasText) {
      sendBtn.classList.remove('voice-assistant-state');
      sendBtn.setAttribute('aria-label', 'Send Message'); sendBtn.setAttribute('title', 'Send');
      if (voiceIcon) voiceIcon.style.display = 'none';
      if (sendIcon) sendIcon.style.display = 'flex';
      if (stopIcon) stopIcon.style.display = 'none';
    } else {
      sendBtn.classList.add('voice-assistant-state');
      sendBtn.setAttribute('aria-label', 'Voice Assistant'); sendBtn.setAttribute('title', 'Voice Assistant');
      if (voiceIcon) voiceIcon.style.display = 'flex';
      if (sendIcon) sendIcon.style.display = 'none';
      if (stopIcon) stopIcon.style.display = 'none';
    }
  }

  textarea.addEventListener('input', () => { autosize(); updateButtonState(); });
  autosize(); updateButtonState();
  textarea.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    if (textarea.value.trim().length > 0 && sendBtn) sendBtn.click();
  });
}

// ============================================================================
// SECTION 4: TABS & MESSAGING
// ============================================================================

function initChatbotTabs() {
  const chatbotOffcanvas = document.getElementById('chatbot-offcanvas');
  const tabsEl = document.getElementById('chatbot-tabs');
  const newTabBtn = document.getElementById('chatbot-new-tab');
  const messagesEl = chatbotOffcanvas?.querySelector?.('.chat-messages');
  const textarea = document.getElementById('chatbot-input');
  const sendBtn = chatbotOffcanvas?.querySelector?.('.send-btn');
  const modeLabel = document.getElementById('chatbot-mode-label');
  const voiceBtn = document.getElementById('chatbot-voice-btn');
  if (!chatbotOffcanvas || !tabsEl || !messagesEl) return;

  ensureMarkdownDeps();
  ensureReteFlowRenderer();

  function escapeHtml(s) {
    return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }

  function getTimeBasedGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function getChatbotUsername() {
    const u = api?.user;
    if (u && (u.full_name || u.email)) return u.full_name || u.email;
    const el = document.getElementById('user-name');
    if (el && el.textContent && el.textContent.trim()) return el.textContent.trim();
    return 'User';
  }

  function getWelcomeHtml() {
    return '<div class="chatbot-welcome-wrap" data-chatbot-welcome><p class="chatbot-welcome-msg"><span class="chatbot-welcome-icon fas fa-asterisk" aria-hidden="true"></span>' + escapeHtml(getTimeBasedGreeting() + ', ' + getChatbotUsername()) + '</p></div>';
  }

  const emptyModeState = () => ({ sessionId: null, html: getWelcomeHtml(), started: false, cameraId: null, videoPath: null, attachedVideoFilename: null });

  let tabCounter = 0;
  const tabs = [];
  let activeId = null;
  let thinkingToProcessingTimer = null;

  function getActive() { return tabs.find(t => t.id === activeId) || null; }
  function getMode() { return chatbotOffcanvas.dataset.chatbotMode === 'agent' ? 'agent' : 'general'; }

  // Expose to ChatbotCore for external callers
  ChatbotCore._getActive = getActive;
  ChatbotCore._getMode = getMode;

  function updateModeUI() {
    const isPlan = getMode() === 'agent';
    if (modeLabel) modeLabel.textContent = isPlan ? 'Plan' : 'Ask & Task';
    const planIcon = document.getElementById('chatbot-mode-icon-plan');
    const askIcon = document.getElementById('chatbot-mode-icon-ask');
    if (planIcon) planIcon.style.display = isPlan ? '' : 'none';
    if (askIcon) askIcon.style.display = isPlan ? 'none' : '';
  }

  function saveActiveHtml() {
    const active = getActive();
    if (!active) return;
    active.mode[getMode()].html = messagesEl.innerHTML;
  }

  function renderTabs() {
    tabsEl.innerHTML = tabs.map(t => {
      const isActive = t.id === activeId;
      return `<li class="nav-item" role="presentation" data-chatbot-tab="${t.id}"><button class="nav-link ${isActive?'active':''} pe-2" type="button" role="tab" aria-selected="${isActive}" data-chatbot-tab-btn="${t.id}"><span class="text-truncate d-inline-block chatbot-tab-name">${escapeHtml(t.title)}</span><span class="chatbot-tab-close ms-2 text-body-tertiary" role="button" tabindex="0" aria-label="Close tab" data-chatbot-tab-close="${t.id}"><span class="fas fa-times"></span></span></button></li>`;
    }).join('');
  }

  function showTab(id) {
    const target = tabs.find(t => t.id === id);
    if (!target) return;
    saveActiveHtml(); activeId = id;
    messagesEl.innerHTML = target.mode[getMode()].html || getWelcomeHtml();
    renderTabs();
    updateAttachedVideoIndicator?.();
  }

  function createTab(title) {
    saveActiveHtml(); tabCounter += 1;
    const id = `chat_tab_${Date.now()}_${tabCounter}`;
    tabs.push({ id, title: title || `Agent ${tabCounter}`, mode: { general: emptyModeState(), agent: emptyModeState() } });
    activeId = id; renderTabs();
    messagesEl.innerHTML = getWelcomeHtml();
  }

  function closeTab(id) {
    if (tabs.length <= 1) {
      const only = tabs[0];
      only.title = 'Agent 1'; only.mode.general = emptyModeState(); only.mode.agent = emptyModeState();
      activeId = only.id; messagesEl.innerHTML = getWelcomeHtml(); renderTabs(); return;
    }
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const wasActive = activeId === id;
    tabs.splice(idx, 1);
    if (!wasActive) { renderTabs(); return; }
    const next = tabs[Math.max(0, idx - 1)];
    activeId = next.id;
    messagesEl.innerHTML = next.mode[getMode()].html || getWelcomeHtml();
    renderTabs();
  }

  function appendUserBubble(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return false;
    messagesEl.insertAdjacentHTML('beforeend', `<div class="d-flex justify-content-end mt-3"><div class="user-message-wrapper d-flex flex-column align-items-end"><div class="user-message">${escapeHtml(trimmed)}</div><div class="user-message-actions"><button type="button" title="Edit" aria-label="Edit message"><span class="far fa-edit"></span></button><button type="button" title="Copy" aria-label="Copy message" data-copy-user-message><span class="far fa-copy"></span></button></div></div></div>`);
    return true;
  }

  function replaceLastUserBubbleText(newText) {
    const trimmed = (newText || '').trim();
    if (!trimmed) return false;
    const wrappers = messagesEl.querySelectorAll('.user-message-wrapper');
    if (!wrappers.length) return false;
    const msgEl = wrappers[wrappers.length - 1].querySelector('.user-message');
    if (!msgEl) return false;
    msgEl.textContent = trimmed; return true;
  }

  function appendAssistantPending() {
    const id = `pending_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    messagesEl.insertAdjacentHTML('beforeend', `<div class="d-flex flex-column align-items-start mt-3" data-chatbot-pending="${id}"><div class="ai-message-transparent fs-9 text-body-emphasis markdown-content"><div class="chatbot-thinking-indicator"><span class="chatbot-thinking-dot" aria-hidden="true"></span><span class="chatbot-thinking-text"><span class="chatbot-thinking-label">Thinking...</span></span></div></div></div>`);
    thinkingToProcessingTimer = window.setTimeout(() => {
      thinkingToProcessingTimer = null;
      const node = messagesEl?.querySelector(`[data-chatbot-pending="${id}"]`);
      const label = node?.querySelector('.chatbot-thinking-label');
      if (label) label.textContent = 'Processing...';
    }, 4000);
    return id;
  }

  function replaceAssistantPending(pendingId, text, isError = false) {
    return markdownReplaceAssistantPending(pendingId, text, isError);
  }

  function updateAssistantPendingText(pendingId, text) {
    return markdownUpdateAssistantPendingText(pendingId, text);
  }

  function formatConfigValue(val) {
    if (val === null) return '—';
    if (typeof val === 'object') return JSON.stringify(val);
    return String(val);
  }

  function renderApprovalCardInBubble(pendingId, approvalData, state) {
    const bubble = messagesEl?.querySelector(`[data-chatbot-pending="${pendingId}"]`);
    if (!bubble) return;
    const inner = bubble.querySelector('.markdown-content') || bubble.querySelector('div');
    if (!inner) return;
    const summary = approvalData?.summary || {};
    const ruleId = summary.rule_id || '—';
    const config = summary.agent_rule_config || {};
    const configEntries = typeof config === 'object' && config !== null ? Object.entries(config) : [];
    const fieldIconMap = { fps:'fa-gauge-high', confidence:'fa-sliders', run_mode:'fa-rotate', alert_cooldown_seconds:'fa-bell-slash', confidence_threshold:'fa-filter', confirm_frames:'fa-film', detectable_classes:'fa-tags', camera_id:'fa-video', start_time:'fa-clock', end_time:'fa-clock-rotate-left', model:'fa-microchip', zone:'fa-draw-polygon', fps_limit:'fa-gauge', interval_minutes:'fa-timer', check_duration_seconds:'fa-stopwatch' };
    const configRowsHtml = configEntries.length
      ? configEntries.map(([k, v]) => `<div class="chatbot-approval-config-row"><span class="chatbot-approval-config-icon"><i class="fa-solid ${fieldIconMap[k]||'fa-circle-dot'}"></i></span><span class="chatbot-approval-config-key">${escapeHtml(k)}</span><span class="chatbot-approval-config-val">${escapeHtml(formatConfigValue(v))}</span></div>`).join('')
      : `<div class="chatbot-approval-config-empty">${escapeHtml(typeof config==='object'?'No configuration':formatConfigValue(config))}</div>`;
    inner.innerHTML = `<div class="chatbot-approval-card"><div class="chatbot-approval-header"><span class="chatbot-approval-header-icon"><i class="fa-solid fa-shield-halved"></i></span><div class="chatbot-approval-header-text"><span class="chatbot-approval-title">Save agent configuration?</span><span class="chatbot-approval-subtitle">Review and confirm before the agent starts</span></div></div><div class="chatbot-approval-body"><div class="chatbot-approval-rule-row"><span class="chatbot-approval-section-label"><i class="fa-solid fa-tag me-1"></i>Rule</span><span class="chatbot-approval-rule-badge">${escapeHtml(ruleId)}</span></div><div class="chatbot-approval-section-label mt-2 mb-1"><i class="fa-solid fa-gear me-1"></i>Configuration</div><div class="chatbot-approval-config-grid">${configRowsHtml}</div></div><div class="chatbot-approval-footer"><button type="button" class="chatbot-approval-btn chatbot-approval-btn-reject chatbot-reject-btn" data-chatbot-pending-id="${escapeHtml(pendingId)}"><i class="fa-solid fa-xmark"></i>Reject</button><button type="button" class="chatbot-approval-btn chatbot-approval-btn-approve chatbot-approve-btn" data-chatbot-pending-id="${escapeHtml(pendingId)}"><i class="fa-solid fa-check"></i>Approve</button></div></div>`;
  }

  async function sendResumeAndHandleStream(pendingId, sessionId, resume, state) {
    const bubble = messagesEl?.querySelector(`[data-chatbot-pending="${pendingId}"]`);
    if (!bubble || !sessionId) return;
    const inner = bubble.querySelector('.markdown-content') || bubble.querySelector('div');
    if (inner) inner.innerHTML = '<p class="mb-0">Saving...</p>';
    state.html = messagesEl.innerHTML;
    try {
      const stream = api.chatWithAgentStream('', sessionId, null, null, null, resume, state._abortController?.signal);
      let finalPayload = null, pendingApprovalData = null, pendingZoneInputData = null;
      for await (const evt of stream) {
        const evName = evt?.event || 'message', data = evt?.data;
        if (evName === 'meta' && data?.session_id) state.sessionId = data.session_id;
        if (evName === 'pending_approval') pendingApprovalData = data || null;
        if (evName === 'pending_zone_input') pendingZoneInputData = data || null;
        if (evName === 'done') finalPayload = data;
      }
      if (pendingApprovalData && getMode() === 'agent') { renderApprovalCardInBubble(pendingId, pendingApprovalData, state); state.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight; return; }
      const zonePayload = pendingZoneInputData || finalPayload?.pending_zone_input;
      if (zonePayload && getMode() === 'agent') {
        const cameraId = zonePayload?.camera_id || state.cameraId, snapshotUrl = zonePayload?.frame_snapshot_url || null, zoneMode = zonePayload?.zone_type || 'polygon';
        if (cameraId) { try { await openZoneEditorInBubble(pendingId, cameraId, zoneMode, snapshotUrl, { saveWithResume: (zd) => sendZoneResumeAndHandleStream(pendingId, state.sessionId, zd, state) }); } catch (err) { console.error('[Chatbot] Zone editor error:', err); replaceAssistantPending(pendingId, 'Zone editor failed. Please try again.', true); } }
        else replaceAssistantPending(pendingId, 'Zone requested but camera ID is missing.', true);
        state.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight; return;
      }
      const content = finalPayload?.message?.content, isError = finalPayload?.status === 'error';
      if (content && Array.isArray(content) && content.length > 0) await renderContentBlocksInBubble(pendingId, content, isError);
      else replaceAssistantPending(pendingId, content?.find(b => b?.type==='text')?.text ?? 'Done.', isError);
      if (!isError && finalPayload?.flow_diagram_data) await renderFlowDiagram(pendingId, finalPayload.flow_diagram_data);
    } catch (err) { replaceAssistantPending(pendingId, err?.message ? String(err.message) : 'Request failed.', true); }
    state.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function sendZoneResumeAndHandleStream(pendingId, sessionId, zoneData, state) {
    const bubble = messagesEl?.querySelector(`[data-chatbot-pending="${pendingId}"]`);
    if (!bubble || !sessionId) return;
    const target = bubble.querySelector('.markdown-content') || bubble.querySelector('.zone-editor')?.closest('.ai-message-transparent') || bubble.querySelector('div');
    if (target) target.innerHTML = '<p class="mb-0">Applying zone...</p>';
    state.html = messagesEl.innerHTML;
    try {
      const resume = { decisions: [{ type: 'approve', zone: zoneData }] };
      const stream = api.chatWithAgentStream('', sessionId, null, null, null, resume, state._abortController?.signal);
      let finalPayload = null, acc = '', pendingApprovalData = null, pendingZoneInputData = null;
      for await (const evt of stream) {
        const evName = evt?.event || 'message', data = evt?.data;
        if (evName === 'meta' && data?.session_id) state.sessionId = data.session_id;
        if (evName === 'token' && data?.delta) { acc += String(data.delta); updateAssistantPendingText(pendingId, acc); state.html = messagesEl.innerHTML; }
        if (evName === 'pending_approval') pendingApprovalData = data || null;
        if (evName === 'pending_zone_input') pendingZoneInputData = data || null;
        if (evName === 'done') finalPayload = data;
      }
      if (pendingApprovalData && getMode() === 'agent') { renderApprovalCardInBubble(pendingId, pendingApprovalData, state); state.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight; return; }
      const zonePayload = pendingZoneInputData || finalPayload?.pending_zone_input;
      if (zonePayload && getMode() === 'agent') {
        const cameraId = zonePayload?.camera_id || state.cameraId, snapshotUrl = zonePayload?.frame_snapshot_url || null, zoneMode = zonePayload?.zone_type || 'polygon';
        if (cameraId) { try { await openZoneEditorInBubble(pendingId, cameraId, zoneMode, snapshotUrl, { saveWithResume: (zd) => sendZoneResumeAndHandleStream(pendingId, state.sessionId, zd, state) }); } catch (err) { console.error('[Chatbot] Zone editor error:', err); replaceAssistantPending(pendingId, 'Zone editor failed. Please try again.', true); } }
        else replaceAssistantPending(pendingId, 'Zone requested but camera ID is missing.', true);
        state.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight; return;
      }
      const content = finalPayload?.message?.content, isError = finalPayload?.status === 'error';
      if (content && Array.isArray(content) && content.length > 0) await renderContentBlocksInBubble(pendingId, content, isError);
      else replaceAssistantPending(pendingId, content?.find(b => b?.type==='text')?.text ?? acc ?? 'Done.', isError);
      if (!isError && finalPayload?.flow_diagram_data) await renderFlowDiagram(pendingId, finalPayload.flow_diagram_data);
    } catch (err) { replaceAssistantPending(pendingId, err?.message ? String(err.message) : 'Request failed.', true); }
    state.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  async function sendTextMessage(text, options = {}) {
    const trimmed = (text || '').trim();
    if (!trimmed || !api || typeof api.isAuthenticated !== 'function') return;
    const active = getActive();
    if (!active) return;
    const mode = getMode(), state = active.mode[mode];
    if (!state.started) { state.started = true; messagesEl.innerHTML = ''; }
    const ok = appendUserBubble(trimmed);
    if (!ok) return;
    const pendingId = appendAssistantPending();
    saveActiveHtml(); messagesEl.scrollTop = messagesEl.scrollHeight;

    let accumulatedText = '';
    try {
      const DEMO_KEY = 'chatbot_demo_mode', lower = trimmed.toLowerCase();
      if (lower === 'demo on' || lower === '/demo on') { if (thinkingToProcessingTimer) { clearTimeout(thinkingToProcessingTimer); thinkingToProcessingTimer = null; } localStorage.setItem(DEMO_KEY, 'true'); replaceAssistantPending(pendingId, '**Demo mode enabled** (backend calls are disabled). Type `demo off` to exit.'); state.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight; return; }
      if (lower === 'demo off' || lower === '/demo off') { if (thinkingToProcessingTimer) { clearTimeout(thinkingToProcessingTimer); thinkingToProcessingTimer = null; } localStorage.setItem(DEMO_KEY, 'false'); replaceAssistantPending(pendingId, '**Demo mode disabled** (backend calls are enabled again).'); state.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight; return; }
      if (localStorage.getItem(DEMO_KEY) === 'true') { replaceAssistantPending(pendingId, `**Demo mode** is ON. Backend calls are disabled.\n\nYou said: \`${escapeHtml(trimmed)}\``); state.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight; return; }
      if (!api.isAuthenticated()) throw new Error('Please login first.');

      try { state._abortController?.abort?.(); } catch (_) { }
      state._abortController = new AbortController();
      let finalPayload = null, sawError = false, pendingApprovalData = null, pendingZoneInputData = null;
      const stream = (mode === 'agent')
        ? api.chatWithAgentStream(trimmed, state.sessionId, state.cameraId || null, options?.zoneData || null, state.videoPath || null, null, state._abortController.signal)
        : api.generalChatStream(trimmed, state.sessionId, state._abortController.signal);

      setTextStreaming(true); syncSendButtonVisual();

      for await (const evt of stream) {
        const evName = evt?.event || 'message', data = evt?.data;
        if (evName === 'meta') { if (data?.session_id) state.sessionId = data.session_id; continue; }
        if (evName === 'start') continue;
        if (evName === 'token') {
          if (thinkingToProcessingTimer) { clearTimeout(thinkingToProcessingTimer); thinkingToProcessingTimer = null; }
          const delta = data?.delta != null ? String(data.delta) : '';
          if (delta) {
            accumulatedText += delta;
            if (mode === 'agent') {
              const boundary = /[\s.,!?;:\n]/.test(delta), now = Date.now(), last = state._lastStreamUiFlushTs || 0;
              if (boundary || (now - last) > 200) {
                state._lastStreamUiFlushTs = now;
                const distanceFromBottom = messagesEl.scrollHeight - (messagesEl.scrollTop + messagesEl.clientHeight);
                updateAssistantPendingText(pendingId, accumulatedText); state.html = messagesEl.innerHTML;
                if (distanceFromBottom < 60) messagesEl.scrollTop = messagesEl.scrollHeight;
              }
            }
          }
          continue;
        }
        if (evName === 'pending_approval') { pendingApprovalData = data || null; continue; }
        if (evName === 'pending_zone_input') { pendingZoneInputData = data || null; continue; }
        if (evName === 'error') { sawError = true; continue; }
        if (evName === 'block') continue;
        if (evName === 'done') { finalPayload = data; break; }
      }

      const message = finalPayload?.message, content = message?.content, evidence = message?.evidence;
      console.log('[Chatbot] backend blocks:', { content, evidence, session_id: finalPayload?.session_id, status: finalPayload?.status });
      const hasContent = content && Array.isArray(content) && content.length > 0;
      const hasEvidence = evidence && Array.isArray(evidence) && evidence.length > 0;
      const willUseContentBlocks = hasContent || hasEvidence;
      if (accumulatedText && !willUseContentBlocks) updateAssistantPendingText(pendingId, accumulatedText);
      if (finalPayload?.session_id) state.sessionId = finalPayload.session_id;

      const approvalPayload = pendingApprovalData || finalPayload?.pending_approval;
      if (approvalPayload && mode === 'agent') { renderApprovalCardInBubble(pendingId, approvalPayload, state); state.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight; return; }

      const zoneInputPayload = pendingZoneInputData || finalPayload?.pending_zone_input;
      if (zoneInputPayload && mode === 'agent') {
        const cameraId = zoneInputPayload?.camera_id || state.cameraId, snapshotUrl = zoneInputPayload?.frame_snapshot_url || null, zoneMode = zoneInputPayload?.zone_type || 'polygon';
        if (cameraId) { try { await openZoneEditorInBubble(pendingId, cameraId, zoneMode, snapshotUrl, { saveWithResume: (zd) => sendZoneResumeAndHandleStream(pendingId, state.sessionId, zd, state) }); } catch (err) { console.error('[Chatbot] Zone editor error:', err); replaceAssistantPending(pendingId, 'Zone editor failed. Please try again.', true); } }
        else replaceAssistantPending(pendingId, 'Zone requested but camera ID is missing.', true);
        state.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight; return;
      }

      const isError = (finalPayload?.status === 'error') || sawError;
      if (willUseContentBlocks) {
        await renderContentBlocksInBubble(pendingId, content || [], isError, evidence);
      } else {
        replaceAssistantPending(pendingId, accumulatedText || '(empty response)', isError);
      }
      if (!isError && finalPayload?.flow_diagram_data) await renderFlowDiagram(pendingId, finalPayload.flow_diagram_data);

      if (!isError && mode === 'agent') {
        const resolvedCameraId = finalPayload?.camera_id || null;
        if (resolvedCameraId) state.cameraId = resolvedCameraId;
        const effectiveCameraId = resolvedCameraId || state.cameraId || null;
        const shouldShowZoneEditor = !!(finalPayload?.awaiting_zone_input || finalPayload?.zone_required);
        if (shouldShowZoneEditor && effectiveCameraId) {
          try { await openZoneEditorInBubble(pendingId, effectiveCameraId, finalPayload?.zone_type || finalPayload?.zone_mode || 'polygon', finalPayload?.frame_snapshot_url || null); }
          catch (err) {
            const errorBubble = messagesEl?.querySelector(`[data-chatbot-pending="${pendingId}"]`);
            const bubbleDiv = errorBubble?.querySelector('div');
            if (bubbleDiv) { const d = document.createElement('div'); d.className = 'text-danger mt-2 fs-9'; d.textContent = `⚠️ Failed to load zone editor. Camera ID: ${effectiveCameraId}`; bubbleDiv.appendChild(d); }
          }
        } else if (shouldShowZoneEditor) {
          const helpBubble = messagesEl?.querySelector(`[data-chatbot-pending="${pendingId}"]`);
          const bubbleDiv = helpBubble?.querySelector('div');
          if (bubbleDiv) { const d = document.createElement('div'); d.className = 'text-warning mt-2 fs-9'; d.textContent = '⚠️ Zone editor needs a camera. Please provide the camera name or camera ID in your message.'; bubbleDiv.appendChild(d); }
        }
      }

      state.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight;
    } catch (err) {
      if (thinkingToProcessingTimer) { clearTimeout(thinkingToProcessingTimer); thinkingToProcessingTimer = null; }
      if (err && (err.name === 'AbortError' || String(err).includes('AbortError'))) {
        replaceAssistantPending(pendingId, accumulatedText?.trim() || '_Stopped_', false);
        state.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight; return;
      }
      replaceAssistantPending(pendingId, err?.message ? String(err.message) : 'Chat request failed.', true);
      state.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight;
    } finally {
      setTextStreaming(false); syncSendButtonVisual();
    }
  }

  // Delegated click handler for approve/reject/copy
  messagesEl.addEventListener('click', function (e) {
    const approveBtn = e.target.closest?.('.chatbot-approve-btn');
    if (approveBtn) { e.preventDefault(); const pid = approveBtn.getAttribute('data-chatbot-pending-id'); const active = getActive(); const state = active?.mode[getMode()]; if (pid && state?.sessionId) sendResumeAndHandleStream(pid, state.sessionId, { decisions: [{ type: 'approve' }] }, state); return; }
    const rejectBtn = e.target.closest?.('.chatbot-reject-btn');
    if (rejectBtn) { e.preventDefault(); const pid = rejectBtn.getAttribute('data-chatbot-pending-id'); const active = getActive(); const state = active?.mode[getMode()]; if (pid && state?.sessionId) sendResumeAndHandleStream(pid, state.sessionId, { decisions: [{ type: 'reject' }] }, state); return; }
    const copyUser = e.target.closest?.('[data-copy-user-message]');
    if (copyUser) { const msgEl = copyUser.closest?.('.user-message-wrapper')?.querySelector?.('.user-message'); if (msgEl && navigator.clipboard?.writeText) navigator.clipboard.writeText(msgEl.textContent.trim()).catch(() => {}); return; }
    const copyAi = e.target.closest?.('[data-copy-ai-message]');
    if (copyAi) { const bubble = copyAi.closest?.('.d-flex')?.querySelector?.('.ai-message-transparent, .markdown-content'); if (bubble && navigator.clipboard?.writeText) navigator.clipboard.writeText(bubble.textContent.trim()).catch(() => {}); }
  });

  tabsEl.addEventListener('click', (e) => {
    const closeEl = e.target.closest?.('[data-chatbot-tab-close]');
    if (closeEl) { e.stopPropagation(); const id = closeEl.getAttribute('data-chatbot-tab-close'); if (id) closeTab(id); return; }
    const tabBtn = e.target.closest?.('[data-chatbot-tab-btn]');
    if (tabBtn) { const id = tabBtn.getAttribute('data-chatbot-tab-btn'); if (id) showTab(id); }
  });

  newTabBtn?.addEventListener('click', () => createTab());

  sendBtn?.addEventListener('click', async () => {
    if (!textarea) return;
    if (getIsTextStreaming()) {
      const active = getActive();
      if (active) { try { active.mode[getMode()]._abortController?.abort?.(); } catch (_) { } }
      setTextStreaming(false); syncSendButtonVisual(); return;
    }
    const hasText = textarea.value.trim().length > 0;
    if (!hasText) {
      try {
        if (!isVoiceAssistantActive()) await startVoiceRecording();
        else await stopVoiceAssistantCompletely();
      } catch (err) {
        if (sendBtn) sendBtn.classList.remove('recording');
        stopVoiceAssistantCompletely().catch(() => {});
        const active = getActive();
        if (active) {
          appendAssistantPending();
          const lastPending = messagesEl.querySelector?.('[data-chatbot-pending]');
          if (lastPending) { const bubble = lastPending.querySelector?.('div'); if (bubble) { bubble.textContent = err?.message ? String(err.message) : 'Voice failed.'; bubble.classList.remove('bg-body-secondary'); bubble.classList.add('bg-danger', 'text-white'); } }
          active.mode.general.html = messagesEl.innerHTML; messagesEl.scrollTop = messagesEl.scrollHeight;
        }
      }
    } else {
      const text = textarea.value;
      textarea.value = ''; textarea.dispatchEvent(new Event('input'));
      sendTextMessage(text);
    }
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-chatbot-action="clear"]');
    if (!el) return; e.preventDefault();
    const active = getActive(); if (!active) return;
    const mode = getMode(); active.mode[mode] = emptyModeState();
    messagesEl.innerHTML = getWelcomeHtml(); saveActiveHtml();
  });

  document.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-chatbot-mode]');
    if (!el) return; e.preventDefault();
    const nextMode = el.getAttribute('data-chatbot-mode'); if (!nextMode) return;
    const prev = getMode(), active = getActive();
    if (active) active.mode[prev].html = messagesEl.innerHTML;
    chatbotOffcanvas.dataset.chatbotMode = nextMode === 'agent' ? 'agent' : 'general';
    updateModeUI();
    if (active) messagesEl.innerHTML = active.mode[getMode()].html || getWelcomeHtml();
    updateUploadVideoButtonVisibility?.(); updateAttachedVideoIndicator?.();
  });

  // ----- Upload video -----
  const uploadVideoBtn = document.getElementById('chatbot-upload-video-btn');
  const videoUploadInput = document.getElementById('chatbot-video-upload');
  const attachedVideoIndicator = document.getElementById('chatbot-attached-video-indicator');
  const attachedVideoLabel = attachedVideoIndicator?.querySelector?.('.chatbot-attached-video-label');
  const attachedVideoClearBtn = document.getElementById('chatbot-attached-video-clear');

  function updateUploadVideoButtonVisibility() {
    if (uploadVideoBtn) uploadVideoBtn.style.display = getMode() === 'agent' ? '' : 'none';
  }

  function updateAttachedVideoIndicator() {
    if (!attachedVideoIndicator || !attachedVideoLabel) return;
    const active = getActive(), mode = getMode();
    const path = active?.mode?.[mode]?.videoPath, name = active?.mode?.[mode]?.attachedVideoFilename;
    if (path && mode === 'agent') {
      attachedVideoLabel.textContent = name ? `Video attached: ${name}` : 'Video attached';
      attachedVideoIndicator.classList.remove('d-none'); attachedVideoIndicator.classList.add('d-flex');
    } else {
      attachedVideoIndicator.classList.add('d-none'); attachedVideoIndicator.classList.remove('d-flex');
    }
  }

  if (uploadVideoBtn && videoUploadInput) {
    uploadVideoBtn.addEventListener('click', function () { if (getMode() !== 'agent') return; videoUploadInput.value = ''; videoUploadInput.click(); });
    videoUploadInput.addEventListener('change', async function () {
      const file = this.files?.[0]; if (!file || getMode() !== 'agent') return;
      if (!api?.uploadVideo) return;
      const active = getActive(), mode = getMode(); if (!active) return;
      try {
        uploadVideoBtn.setAttribute('aria-busy', 'true'); uploadVideoBtn.querySelector('.fa-video')?.classList?.add('fa-spin');
        const data = await api.uploadVideo(file);
        if (data?.video_path) { active.mode[mode].videoPath = data.video_path; active.mode[mode].attachedVideoFilename = data.filename || file.name; ChatbotCore.setVideoPath(data.video_path); updateAttachedVideoIndicator(); }
      } catch (err) { toast?.error ? toast.error(err.message || 'Video upload failed') : alert(err.message || 'Video upload failed'); }
      finally { uploadVideoBtn.removeAttribute('aria-busy'); uploadVideoBtn.querySelector('.fa-video')?.classList?.remove('fa-spin'); this.value = ''; }
    });
  }

  if (attachedVideoClearBtn) {
    attachedVideoClearBtn.addEventListener('click', function () {
      const active = getActive(), mode = getMode();
      if (active) { active.mode[mode].videoPath = null; active.mode[mode].attachedVideoFilename = null; ChatbotCore.setVideoPath(null); updateAttachedVideoIndicator(); }
    });
  }

  if (messagesEl) {
    messagesEl.addEventListener('dragover', function (e) {
      if (getMode() !== 'agent') return;
      if (Array.from(e.dataTransfer?.types||[]).some(t=>t==='Files')) { e.preventDefault(); e.dataTransfer.dropEffect='copy'; messagesEl.classList.add('chatbot-drag-over'); }
    });
    messagesEl.addEventListener('dragleave', () => messagesEl.classList.remove('chatbot-drag-over'));
    messagesEl.addEventListener('drop', async function (e) {
      e.preventDefault(); messagesEl.classList.remove('chatbot-drag-over');
      if (getMode() !== 'agent') return;
      const file = e.dataTransfer?.files?.[0]; if (!file || !file.type.startsWith('video/') || !api?.uploadVideo) return;
      const active = getActive(), mode = getMode(); if (!active) return;
      try {
        const data = await api.uploadVideo(file);
        if (data?.video_path) { active.mode[mode].videoPath = data.video_path; active.mode[mode].attachedVideoFilename = data.filename || file.name; ChatbotCore.setVideoPath(data.video_path); updateAttachedVideoIndicator(); toast?.success?.('Video attached'); }
      } catch (err) { toast?.error ? toast.error(err.message||'Video upload failed') : alert(err.message||'Video upload failed'); }
    });
  }

  chatbotOffcanvas.dataset.chatbotMode = chatbotOffcanvas.dataset.chatbotMode || 'general';
  updateModeUI();

  initVoice({ getActive, getMode, messagesEl, appendUserBubble, replaceLastUserBubbleText, appendAssistantPending, replaceAssistantPending, updateAssistantPendingText, saveActiveHtml, chatbotOffcanvas, sendBtn, voiceBtn });
  initZoneEditor({ messagesEl, sendTextMessage, escapeHtml });
  initFlowDiagram({ messagesEl, ensureReteFlowRenderer });
  initMarkdown({ messagesEl, escapeHtml });

  createTab('Agent 1');
  updateUploadVideoButtonVisibility();
  updateAttachedVideoIndicator();
}

// ============================================================================
// SECTION 5: FIND PERSON MODAL
// ============================================================================

function initFindPersonModal() {
  const findPersonBtn = document.getElementById('chatbot-find-person-btn');
  const modalEl = document.getElementById('find-person-modal');
  const formEl = document.getElementById('find-person-form');
  const nameInput = document.getElementById('find-person-name');
  const existingSelect = document.getElementById('find-person-existing');
  const fileInput = document.getElementById('find-person-file');
  const submitBtn = document.getElementById('find-person-submit-btn');
  if (!findPersonBtn || !modalEl || !formEl || !submitBtn) return;

  let galleryLoaded = false;

  async function loadPersonGalleryIntoSelect() {
    if (!existingSelect || typeof api?.getPersonGalleryList !== 'function') return;
    if (galleryLoaded && existingSelect.options.length > 1) return;
    existingSelect.innerHTML = '';
    const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Select a person from the list (optional)'; existingSelect.appendChild(placeholder);
    try {
      const people = await api.getPersonGalleryList();
      if (!Array.isArray(people) || !people.length) { const opt = document.createElement('option'); opt.value=''; opt.textContent='No persons found in gallery yet'; existingSelect.appendChild(opt); return; }
      people.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))).forEach(person => { const opt=document.createElement('option'); opt.value=person.name||''; opt.textContent=person.name||'(unnamed)'; existingSelect.appendChild(opt); });
      galleryLoaded = true;
    } catch (err) { toast?.error?.(err.message || 'Failed to load person list.'); }
  }

  findPersonBtn.addEventListener('click', function () {
    if (typeof bootstrap === 'undefined') return;
    new bootstrap.Modal(modalEl).show();
    if (nameInput) nameInput.value = ''; if (fileInput) fileInput.value = ''; if (existingSelect) existingSelect.value = '';
    loadPersonGalleryIntoSelect();
  });

  existingSelect?.addEventListener('change', function () { if (existingSelect.value && nameInput) nameInput.value = existingSelect.value; });

  submitBtn.addEventListener('click', function () {
    const name = nameInput?.value.trim() || '', files = fileInput?.files || [], minPhotos = 4;
    if (!name) { toast?.warning?.("Please enter the person's name."); nameInput?.focus(); return; }
    if (files.length < minPhotos) { toast?.warning?.('Please select at least ' + minPhotos + ' photos for accurate recognition.'); fileInput?.focus(); return; }
    if (!api) { toast?.error?.('API service not available.'); return; }
    const btnText = submitBtn.querySelector('.find-person-btn-text'), spinner = submitBtn.querySelector('.find-person-spinner');
    if (btnText) btnText.classList.add('d-none'); if (spinner) spinner.classList.remove('d-none'); submitBtn.disabled = true;
    api.uploadReferencePhotos(name, files)
      .then(res => { toast?.success?.((res.image_count||files.length)+' photos uploaded for '+name+'. You can now create an agent like "alert me when '+name+' appears on camera 1".'); if (typeof bootstrap!=='undefined') bootstrap.Modal.getInstance(modalEl)?.hide(); if (formEl) formEl.reset(); })
      .catch(err => toast?.error?.(err.message||'Upload failed.'))
      .finally(() => { if (btnText) btnText.classList.remove('d-none'); if (spinner) spinner.classList.add('d-none'); submitBtn.disabled=false; });
  });
}

// ============================================================================
// SECTION 6: KEYBOARD SHORTCUT
// ============================================================================

function initChatbotKeyboardShortcut() {
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'l' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      const chatbotOffcanvas = document.getElementById('chatbot-offcanvas');
      if (!chatbotOffcanvas || typeof bootstrap === 'undefined') return;
      const inst = bootstrap.Offcanvas.getInstance(chatbotOffcanvas);
      if (inst) inst.toggle(); else new bootstrap.Offcanvas(chatbotOffcanvas).show();
    }
  });
}

// ============================================================================
// SECTION 7: STARTUP
// ============================================================================

function initAll() {
  initChatbotLayout();
  initChatbotComposer();
  initChatbotTabs();
  initFindPersonModal();
  initChatbotKeyboardShortcut();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    if (typeof bootstrap !== 'undefined') initAll();
    else setTimeout(() => { if (typeof bootstrap !== 'undefined') initAll(); }, 100);
  });
} else {
  if (typeof bootstrap !== 'undefined') initAll();
  else setTimeout(() => { if (typeof bootstrap !== 'undefined') initAll(); }, 100);
}

