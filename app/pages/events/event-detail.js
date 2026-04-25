import { api } from '../../core/api.js';
import { navigate } from '../../core/router.js';
'use strict';

function escapeHtml(s) {
  return String(s || '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

async function loadEventData() {
  const stateUrl = history.state && history.state.url ? history.state.url : window.location.href;
  const urlParams = new URLSearchParams(new URL(stateUrl, window.location.href).search);
  const eventId = urlParams.get('event_id') || urlParams.get('id');
  if (!eventId) {
    const el = document.getElementById('event-title');
    if (el) el.textContent = 'No event ID provided';
    return;
  }

  try {
    const ev = await api.getEvent(eventId);

    const title = ev?.label || 'Event';
    const cameraIdStr = ev?.camera_id ? String(ev.camera_id) : '';
    const dt = ev?.event_ts ? new Date(ev.event_ts) : (ev?.received_at ? new Date(ev.received_at) : null);
    const sev = String(ev?.severity || 'info').toLowerCase();
    const sevText = sev.charAt(0).toUpperCase() + sev.slice(1);
    const sevColor = sev === 'critical' ? 'danger' : (sev === 'warning' ? 'warning' : 'info');
    const badgeClass = `badge-phoenix-${sevColor}`;

    // Try to fetch camera name
    let cameraName = cameraIdStr ? `Camera ${cameraIdStr}` : 'Camera';
    if (cameraIdStr) {
      try {
        const cam = await api.getCamera(cameraIdStr);
        if (cam?.name) cameraName = cam.name;
      } catch (_) {}
    }

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    const setHtml = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };
    const show = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'block'; };
    const hide = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
    const setClass = (id, cls) => { const el = document.getElementById(id); if (el) el.className = `badge badge-phoenix ${cls} fs-9 px-3 py-2`; };

    set('event-title', title);
    set('event-camera', cameraName);
    set('event-location', cameraName);
    set('event-datetime', dt && !isNaN(dt.getTime()) ? dt.toLocaleString() : '');
    set('event-id', ev?.id || eventId);
    set('camera-name', cameraName);
    set('event-timestamp', dt && !isNaN(dt.getTime()) ? dt.toLocaleTimeString() : '');
    set('severity-badge', sevText);
    setHtml('event-type-badge', `<span class="fa-solid fa-triangle-exclamation me-2"></span>${escapeHtml(title)}`);
    setHtml('status-badge', `<span class="fa-solid fa-circle me-2"></span>Active - ${escapeHtml(sevText)}`);
    setClass('event-type-badge', badgeClass);
    setClass('severity-badge', badgeClass);
    setClass('status-badge', badgeClass);

    // Description
    const desc = ev?.metadata?.description || '';
    if (desc) { set('event-description', desc); show('event-description-section'); }
    else hide('event-description-section');

    // Detection details
    const detailsEl = document.getElementById('detection-details');
    const detailsSection = document.getElementById('detection-details-section');
    if (detailsEl && ev?.metadata) {
      const meta = ev.metadata;
      const details = [];
      if (meta.video_timestamp) details.push(`<li><strong>Video Timestamp:</strong> ${escapeHtml(String(meta.video_timestamp))}</li>`);
      if (meta.session_id) details.push(`<li><strong>Session ID:</strong> ${escapeHtml(String(meta.session_id))}</li>`);
      const ruleReport = meta.detections?.rule_report || meta.report || null;
      if (ruleReport && typeof ruleReport === 'object') {
        if (ruleReport.weapon_type) details.push(`<li><strong>Weapon Type:</strong> ${escapeHtml(String(ruleReport.weapon_type))}</li>`);
        if (ruleReport.confidence != null) {
          const conf = typeof ruleReport.confidence === 'number'
            ? (ruleReport.confidence * 100).toFixed(1) + '%'
            : String(ruleReport.confidence);
          details.push(`<li><strong>Confidence:</strong> ${escapeHtml(conf)}</li>`);
        }
        if (ruleReport.vlm_description) details.push(`<li><strong>VLM Description:</strong> ${escapeHtml(String(ruleReport.vlm_description))}</li>`);
      }
      if (details.length > 0) { detailsEl.innerHTML = details.join(''); if (detailsSection) detailsSection.style.display = 'block'; }
      else if (detailsSection) detailsSection.style.display = 'none';
    }

    // AI Agent
    if (ev?.agent_name) {
      set('agent-response-title', `Agent "${ev.agent_name}" Triggered`);
      set('agent-response-text', ev?.metadata?.agent_response || `Event detected by agent: ${ev.agent_name}`);
      show('ai-agent-section');
    } else hide('ai-agent-section');

    // Statistics
    const statsEl = document.getElementById('event-statistics');
    const statsSection = document.getElementById('event-statistics-section');
    if (statsEl && ev?.metadata) {
      const stats = [];
      if (ev.metadata.detection_time != null) stats.push({ label: 'Detection Time', value: `${ev.metadata.detection_time}s` });
      if (ev.metadata.response_time != null) stats.push({ label: 'Response Time', value: `${ev.metadata.response_time}s` });
      if (ev.metadata.confidence != null) stats.push({ label: 'Confidence', value: `${ev.metadata.confidence}%` });
      if (stats.length > 0) {
        statsEl.innerHTML = stats.map((s, i) =>
          (i > 0 ? '<div class="my-3 mx-2 mx-sm-3 border-start"></div>' : '') +
          `<div class="${i === 0 ? 'me-3' : i === stats.length - 1 ? 'ms-3' : 'mx-3'}">` +
          `<p class="mb-2 text-body-secondary">${escapeHtml(s.label)}</p>` +
          `<h3 class="text-body-secondary fs-8">${escapeHtml(s.value)}</h3></div>`
        ).join('');
        if (statsSection) statsSection.style.display = 'block';
      } else if (statsSection) statsSection.style.display = 'none';
    }

    // Priority / Assigned
    const priorityBadge = document.getElementById('priority-badge');
    if (ev?.metadata?.priority && priorityBadge) { priorityBadge.textContent = ev.metadata.priority; show('priority-section'); }
    const assignedEl = document.getElementById('assigned-to');
    if (ev?.metadata?.assigned_to && assignedEl) { assignedEl.textContent = ev.metadata.assigned_to; show('assigned-section'); }

    // Zone coverage
    const zoneBadgesEl = document.getElementById('zone-badges');
    if (zoneBadgesEl && Array.isArray(ev?.metadata?.zones) && ev.metadata.zones.length > 0) {
      zoneBadgesEl.innerHTML = ev.metadata.zones.map(z => `<span class="badge badge-phoenix badge-phoenix-info fs-10">${escapeHtml(String(z))}</span>`).join('');
      show('zone-coverage-section');
    }

    // View Live Feed button
    const liveFeedBtn = document.getElementById('view-live-feed-btn');
    if (liveFeedBtn && cameraIdStr) {
      liveFeedBtn.style.display = 'block';
      liveFeedBtn.onclick = () => navigate(`/app/pages/cameras/camera-detail.html?camera=${encodeURIComponent(cameraIdStr)}`);
    }

    // Thumbnail image (top)
    const imgEl = document.getElementById('event-image');
    if (imgEl && ev?.has_image && typeof api.fetchEventImageObjectUrl === 'function') {
      try {
        imgEl.src = await api.fetchEventImageObjectUrl(eventId);
        imgEl.style.display = 'block';
      } catch (_) {}
    }

    // Evidence video
    const videoSection = document.getElementById('evidence-video-section');
    const videoEl = document.getElementById('evidence-video');
    const videoLoading = document.getElementById('video-loading');
    const videoError = document.getElementById('video-error');
    if (videoSection && videoEl && ev?.metadata) {
      const videoPath = ev.metadata.video_path ||
        (Array.isArray(ev.metadata.video_paths) && ev.metadata.video_paths.length > 0 ? ev.metadata.video_paths[0] : null);
      if (videoPath && typeof api.fetchEventVideoObjectUrl === 'function') {
        videoSection.style.display = 'block';
        videoLoading.style.display = 'block';
        videoEl.style.display = 'none';
        videoError.style.display = 'none';
        try {
          const videoUrl = await api.fetchEventVideoObjectUrl(videoPath);
          videoEl.onerror = () => {
            videoEl.style.display = 'none';
            videoLoading.style.display = 'none';
            videoError.style.display = 'block';
            videoError.innerHTML = '<p class="text-danger">Failed to load evidence video</p>';
          };
          videoEl.oncanplay = () => { videoLoading.style.display = 'none'; videoEl.style.display = 'block'; };
          videoEl.src = videoUrl;
          window.__eventDetailVideoUrl = videoUrl;
        } catch (err) {
          videoEl.style.display = 'none';
          videoLoading.style.display = 'none';
          videoError.style.display = 'block';
          videoError.innerHTML = `<p class="text-danger">Failed to load video: ${escapeHtml(err.message)}</p>`;
        }
      } else {
        hide('evidence-video-section');
      }
    }

    // Full size image (bottom)
    const fullImgEl = document.getElementById('full-event-image');
    const fullImgSection = document.getElementById('full-image-section');
    if (fullImgEl && fullImgSection && ev?.has_image && typeof api.fetchEventImageObjectUrl === 'function') {
      try {
        fullImgEl.src = await api.fetchEventImageObjectUrl(eventId);
        fullImgEl.style.display = 'block';
        fullImgEl.onload = () => { fullImgSection.style.display = 'block'; };
        fullImgEl.onerror = () => { fullImgSection.style.display = 'none'; };
      } catch (_) { fullImgSection.style.display = 'none'; }
    }

    if (typeof feather !== 'undefined') feather.replace();

  } catch (err) {
    const el = document.getElementById('event-title');
    if (el) el.textContent = 'Error loading event: ' + (err.message || 'Unknown error');
  }
}

export async function boot() {
  if (!document.getElementById('event-title')) return;

  // Revoke any previous video object URL on re-navigation
  if (window.__eventDetailVideoUrl) {
    try { URL.revokeObjectURL(window.__eventDetailVideoUrl); } catch (_) {}
    window.__eventDetailVideoUrl = null;
  }

  let tries = 0;
  (function checkAuth() {
    if (!document.getElementById('event-title')) return;
    if (api && api.isAuthenticated()) {
      loadEventData();
    } else if (++tries < 50) {
      setTimeout(checkAuth, 100);
    } else {
      const el = document.getElementById('event-title');
      if (el) el.textContent = 'Please login to view event';
    }
  })();
}
