import { navigate } from '../../core/router.js';
import { toast } from '../../core/toast.js';
import { api } from '../../core/api.js';
'use strict';

var CHAT_SELECTION_KEY = 'visionai_chat_selected_video_meta';
var CHAT_PENDING_KEY = 'visionai_pending_chat_video';
var CHAT_VIDEO_ID_KEY = 'visionai_chat_video_id';

function formatDate(iso) {
  if (!iso) return 'Unknown date';
  try {
    var d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Unknown date';
    return d.toLocaleString();
  } catch (_) { return 'Unknown date'; }
}

function notifyError(message) {
  if (toast && typeof toast.error === 'function') toast.error(message);
  else alert(message);
}

function notifySuccess(message) {
  if (toast && typeof toast.success === 'function') toast.success(message);
}

function saveVideoForChat(video) {
  if (!video || !video.video_id) return;
  var payload = {
    video_id: video.video_id,
    filename: video.filename || 'Video',
    video_path: video.video_path || null,
    created_at: video.created_at || null
  };
  localStorage.setItem(CHAT_VIDEO_ID_KEY, String(video.video_id));
  localStorage.setItem(CHAT_SELECTION_KEY, JSON.stringify(payload));
  localStorage.setItem(CHAT_PENDING_KEY, JSON.stringify(payload));
}

function navigateToChat() {
  var href = 'chat.html';
  navigate(href).catch(function () { window.location.href = href; });
}

function renderLibrary(videos) {
  var grid = document.getElementById('library-grid');
  var emptyCard = document.getElementById('library-empty-card');
  if (!grid || !emptyCard) return;
  grid.innerHTML = '';

  if (!Array.isArray(videos) || videos.length === 0) { emptyCard.classList.remove('d-none'); return; }
  emptyCard.classList.add('d-none');

  videos.forEach(function (video) {
    var col = document.createElement('div');
    col.className = 'col-12 col-md-6 col-xl-4';
    col.innerHTML =
      '<div class="card h-100 library-video-card" data-video-id="' + String(video.video_id || '') + '">' +
        '<div class="card-body d-flex flex-column gap-2">' +
          '<video class="library-video-thumb" controls preload="metadata"></video>' +
          '<div class="d-flex align-items-center justify-content-between gap-2">' +
            '<p class="mb-0 fw-semibold fs-9 text-body text-truncate" title="' + String(video.filename || '').replace(/"/g, '&quot;') + '">' + (video.filename || 'Video') + '</p>' +
            '<span class="badge badge-phoenix badge-phoenix-secondary fs-10">Video</span>' +
          '</div>' +
          '<p class="mb-2 text-body-tertiary fs-10 text-truncate">Uploaded: ' + formatDate(video.created_at) + '</p>' +
          '<div class="d-flex gap-2 mt-auto">' +
            '<button type="button" class="btn btn-phoenix-primary btn-sm w-100 library-use-btn">Analyze in Chat</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    var videoEl = col.querySelector('video');
    var useBtn = col.querySelector('.library-use-btn');

    useBtn.addEventListener('click', function () {
      saveVideoForChat(video);
      notifySuccess('Video selected. Opening chat...');
      navigateToChat();
    });

    if (video.video_path && api && typeof api.fetchEventVideoObjectUrl === 'function') {
      api.fetchEventVideoObjectUrl(video.video_path)
        .then(function (url) { if (url && videoEl) videoEl.src = url; })
        .catch(function () {});
    }

    grid.appendChild(col);
  });
}

async function loadLibrary() {
  if (!api || typeof api.listStaticVideos !== 'function') {
    notifyError('API client not ready. Please refresh.');
    return;
  }
  var grid = document.getElementById('library-grid');
  if (grid) {
    grid.innerHTML =
      '<div class="col-12"><div class="card"><div class="card-body text-center py-5">' +
      '<div class="spinner-border text-primary" role="status"><span class="visually-hidden">Loading...</span></div>' +
      '</div></div></div>';
  }
  try {
    var res = await api.listStaticVideos();
    renderLibrary(res && Array.isArray(res.videos) ? res.videos : []);
  } catch (err) {
    notifyError((err && err.message) ? err.message : 'Failed to load library.');
    if (grid) grid.innerHTML = '';
  }
}

function init() {
  var refreshBtn = document.getElementById('library-refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', loadLibrary);
  loadLibrary();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  setTimeout(init, 0);
}
