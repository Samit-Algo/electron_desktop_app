import { toast } from '../../core/toast.js';
import { api } from '../../core/api.js';
'use strict';

function init() {
  document.body.classList.add('chat-page-no-scroll');
  window.__visionaiPageCleanup = function () {
    document.body.classList.remove('chat-page-no-scroll');
  };

  var mediaContainer = document.getElementById('chat-media-cards');
  var mediaEmpty = document.getElementById('chat-media-empty');
  var messagesEl = document.getElementById('chat-messages');
  var attachInput = document.getElementById('chat-attach-input');
  var attachBtn = document.getElementById('chat-attach-btn');
  var chatInput = document.getElementById('chat-input');
  var sendBtn = document.getElementById('chat-send-btn');
  if (!mediaContainer || !messagesEl || !attachInput || !attachBtn || !chatInput || !sendBtn) return;

  function autosizeInput() {
    var cs = window.getComputedStyle(chatInput);
    var lh = parseFloat(cs.lineHeight);
    var lineHeight = Number.isFinite(lh) ? lh : 16;
    var pt = parseFloat(cs.paddingTop) || 0;
    var pb = parseFloat(cs.paddingBottom) || 0;
    var minH = lineHeight + pt + pb;
    if (minH < 24) minH = 24;
    chatInput.style.height = '0px';
    var next = Math.min(Math.max(chatInput.scrollHeight, minH), 200);
    chatInput.style.height = next + 'px';
  }

  var mediaCount = 0;
  var currentVideoId = localStorage.getItem('visionai_chat_video_id') || null;
  var currentVideoMeta = null;
  var pendingVideoFile = null;
  var pendingVideoName = null;
  var pendingLibraryVideo = null;
  var CHAT_SELECTION_KEY = 'visionai_chat_selected_video_meta';
  var CHAT_PENDING_KEY = 'visionai_pending_chat_video';

  var attachPreview = document.getElementById('chat-attached-preview');
  var attachRemoveBtn = document.getElementById('chat-attached-remove');

  function setCurrentVideo(videoId, meta) {
    currentVideoId = videoId || null;
    if (currentVideoId) localStorage.setItem('visionai_chat_video_id', currentVideoId);
    else localStorage.removeItem('visionai_chat_video_id');
    if (meta && typeof meta === 'object') {
      currentVideoMeta = meta;
      localStorage.setItem(CHAT_SELECTION_KEY, JSON.stringify(meta));
    } else if (meta === null) {
      currentVideoMeta = null;
      localStorage.removeItem(CHAT_SELECTION_KEY);
    }
  }

  function notifyError(message) {
    if (toast && typeof toast.error === 'function') toast.error(message);
    else alert(message);
  }

  function ensureStaticVideoApi() {
    if (!api) return false;
    return typeof api.staticVideoUpload === 'function' &&
           typeof api.staticVideoAsk === 'function' &&
           typeof api.fetchEventVideoObjectUrl === 'function';
  }

  function parseJsonSafe(v) {
    if (!v) return null;
    try { return JSON.parse(v); } catch (_) { return null; }
  }

  async function renderSelectedLibraryVideoCard(meta) {
    if (!meta || !meta.video_id || !meta.video_path || !mediaContainer) return;
    var existing = mediaContainer.querySelector('[data-video-id="' + String(meta.video_id) + '"]');
    if (existing) return;
    if (mediaEmpty) mediaEmpty.style.display = 'none';
    var url = null;
    try { url = await api.fetchEventVideoObjectUrl(meta.video_path); } catch (_) {}
    mediaCount++;
    var card = document.createElement('div');
    card.className = 'card chat-media-card mb-2 position-relative';
    card.setAttribute('data-media-id', mediaCount);
    card.setAttribute('data-video-id', String(meta.video_id));
    card.innerHTML =
      '<div class="card-body p-2 position-relative">' +
        '<video class="rounded-top" controls preload="metadata" style="width:100%;height:220px;object-fit:contain;background:#000;" ' + (url ? ('src="' + url + '"') : '') + '></video>' +
        '<p class="mb-0 mt-1 fs-10 text-body text-truncate" title="' + String(meta.filename || 'Selected video').replace(/"/g, '&quot;') + '">' + (meta.filename || 'Selected video') + '</p>' +
        '<span class="badge badge-phoenix badge-phoenix-info fs-10">Selected from library</span>' +
      '</div>';
    mediaContainer.prepend(card);
  }

  function consumePendingSelectedVideo() {
    var pending = parseJsonSafe(localStorage.getItem(CHAT_PENDING_KEY));
    if (pending && pending.video_id) { localStorage.removeItem(CHAT_PENDING_KEY); return pending; }
    var selected = parseJsonSafe(localStorage.getItem(CHAT_SELECTION_KEY));
    if (selected && selected.video_id) { setCurrentVideo(String(selected.video_id), selected); return null; }
    return null;
  }

  function addMediaCard(media, withProgress) {
    if (!media) return null;
    mediaCount++;
    if (mediaEmpty) mediaEmpty.style.display = 'none';
    var isVideo = !!media.isVideo;
    var name = media.name || 'Upload ' + mediaCount;
    var card = document.createElement('div');
    card.className = 'card chat-media-card mb-2 position-relative';
    card.setAttribute('data-media-id', mediaCount);
    var thumb = isVideo
      ? '<video class="rounded-top" controls preload="metadata" style="width:100%;height:220px;object-fit:contain;background:#000;" src="' + (media.videoUrl || '#') + '"></video>'
      : '<img src="' + (media.imageUrl || '#') + '" class="rounded-top" style="width:100%;height:180px;object-fit:contain;" alt="" />';
    var overlayHtml = withProgress
      ? '<div class="chat-media-progress-overlay rounded"><div class="chat-media-progress-bar"><div class="fill"></div></div><span class="chat-media-progress-label">Uploading & analyzing...</span></div>'
      : '';
    card.innerHTML =
      '<div class="card-body p-2 position-relative">' + thumb +
      '<p class="mb-0 mt-1 fs-10 text-body text-truncate" title="' + name.replace(/"/g, '&quot;') + '">' + name + '</p>' +
      '<span class="badge badge-phoenix badge-phoenix-secondary fs-10">' + (isVideo ? 'Video' : 'Image') + '</span>' +
      overlayHtml + '</div>';
    mediaContainer.appendChild(card);
    return card;
  }

  function removeProgressOverlay(card) {
    if (!card) return;
    card.classList.add('chat-media-done');
    var overlay = card.querySelector('.chat-media-progress-overlay');
    if (overlay) setTimeout(function () { overlay.remove(); card.classList.remove('chat-media-done'); }, 550);
  }

  function addChatMessage(text, isUser) {
    var div = document.createElement('div');
    if (isUser) {
      var escaped = text ? String(text).replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
      div.className = 'd-flex justify-content-end mt-3';
      div.innerHTML = '<div class="user-message-wrapper d-flex flex-column align-items-end"><div class="user-message">' + escaped + '</div></div>';
    } else {
      div.className = 'd-flex flex-column align-items-start mt-3';
      var raw = text ? String(text) : '';
      var html = raw;
      if (window.marked && window.DOMPurify && typeof window.marked.parse === 'function') {
        try {
          var allowedTags = ['p','br','strong','em','u','s','code','ul','ol','li','h1','h2','h3','h4','h5','h6','blockquote','a','hr','div'];
          html = window.DOMPurify.sanitize(window.marked.parse(raw), { ALLOWED_TAGS: allowedTags, ALLOWED_ATTR: ['href','title','target','rel'], KEEP_CONTENT: true });
        } catch (e) {
          html = raw.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
        }
      } else {
        html = raw.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
      }
      div.innerHTML = '<div class="ai-message-transparent fs-9 text-body-emphasis markdown-content">' + html + '</div>';
    }
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function showAttachPreview(filename) {
    if (!attachPreview) return;
    var fn = attachPreview.querySelector('.chat-attached-filename');
    if (fn) fn.textContent = filename || 'Video';
    attachPreview.classList.remove('d-none');
    attachPreview.classList.add('d-flex');
  }

  function hideAttachPreview() {
    if (!attachPreview) return;
    attachPreview.classList.add('d-none');
    attachPreview.classList.remove('d-flex');
  }

  attachBtn.addEventListener('click', function () { attachInput.click(); });

  if (attachRemoveBtn) {
    attachRemoveBtn.addEventListener('click', function () {
      pendingVideoFile = null;
      pendingVideoName = null;
      pendingLibraryVideo = null;
      localStorage.removeItem(CHAT_PENDING_KEY);
      hideAttachPreview();
    });
  }

  attachInput.addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    pendingLibraryVideo = null;
    localStorage.removeItem(CHAT_PENDING_KEY);
    if (!ensureStaticVideoApi()) { notifyError('API client not ready. Please refresh the page.'); return; }
    var isVideo = file.type.startsWith('video/');
    if (!isVideo) { addMediaCard({ isVideo: false, name: file.name, imageUrl: URL.createObjectURL(file) }); return; }
    pendingVideoFile = file;
    pendingVideoName = file.name;
    showAttachPreview(file.name);
  });

  chatInput.addEventListener('input', autosizeInput);
  chatInput.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    if (e.shiftKey) return;
    e.preventDefault();
    if (chatInput.value.trim().length > 0 || pendingVideoFile) sendBtn.click();
  });
  autosizeInput();

  sendBtn.addEventListener('click', async function () {
    var text = (chatInput.value || '').trim();
    if (!text && !pendingVideoFile && !pendingLibraryVideo) return;
    if (!ensureStaticVideoApi()) { notifyError('API client not ready. Please refresh the page.'); return; }

    if (pendingVideoFile) {
      var question = text || null;
      var file = pendingVideoFile;
      var fileName = pendingVideoName || file.name;
      pendingVideoFile = null; pendingVideoName = null;
      chatInput.value = ''; hideAttachPreview(); autosizeInput();
      var card = addMediaCard({ isVideo: true, name: fileName, videoUrl: URL.createObjectURL(file) }, true);
      if (question) addChatMessage(question, true);
      try {
        var result = await api.staticVideoUpload(file, question);
        var videoId = result && result.video_id ? result.video_id : null;
        if (!videoId) throw new Error('No video_id returned from upload.');
        setCurrentVideo(videoId, null);
        removeProgressOverlay(card);
        var res = await api.staticVideoAsk(videoId, question && String(question).trim() ? question : 'Summarize this video.');
        addChatMessage(res && res.answer ? res.answer : 'No answer returned.', false);
      } catch (err) {
        notifyError((err && err.message) ? err.message : 'Video upload failed.');
        if (card && card.parentNode) card.remove();
        if (mediaContainer && mediaContainer.querySelectorAll('.chat-media-card').length === 0 && mediaEmpty) mediaEmpty.style.display = 'block';
      }
      return;
    }

    if (pendingLibraryVideo) {
      var selected = pendingLibraryVideo;
      var questionForLibrary = text || null;
      pendingLibraryVideo = null;
      localStorage.removeItem(CHAT_PENDING_KEY);
      chatInput.value = ''; hideAttachPreview(); autosizeInput();
      var selectedVideoUrl = '#';
      try { if (selected.video_path) selectedVideoUrl = await api.fetchEventVideoObjectUrl(selected.video_path); } catch (_) {}
      var selectedCard = addMediaCard({ isVideo: true, name: selected.filename || 'Selected video', videoUrl: selectedVideoUrl }, true);
      setCurrentVideo(String(selected.video_id), selected);
      if (questionForLibrary) addChatMessage(questionForLibrary, true);
      try {
        var libraryAskRes = await api.staticVideoAsk(String(selected.video_id), questionForLibrary || 'Summarize this video.');
        removeProgressOverlay(selectedCard);
        addChatMessage(libraryAskRes && libraryAskRes.answer ? libraryAskRes.answer : 'No answer returned.', false);
      } catch (err) {
        notifyError((err && err.message) ? err.message : 'Video analysis failed.');
        if (selectedCard && selectedCard.parentNode) selectedCard.remove();
        if (mediaContainer && mediaContainer.querySelectorAll('.chat-media-card').length === 0 && mediaEmpty) mediaEmpty.style.display = 'block';
      }
      return;
    }

    chatInput.value = ''; autosizeInput();
    if (!currentVideoId) { notifyError('Upload a video first, then ask questions.'); return; }
    addChatMessage(text, true);
    try {
      var response = await api.staticVideoAsk(currentVideoId, text);
      addChatMessage(response && response.answer ? response.answer : 'No answer returned.', false);
    } catch (err) {
      addChatMessage((err && err.message) ? err.message : 'Ask failed.', false);
    }
  });

  var selectedMeta = consumePendingSelectedVideo();
  if (selectedMeta && selectedMeta.video_id) {
    pendingLibraryVideo = selectedMeta;
    showAttachPreview(selectedMeta.filename || 'Selected video');
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  setTimeout(init, 0);
}
