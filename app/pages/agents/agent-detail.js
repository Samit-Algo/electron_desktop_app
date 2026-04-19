import { navigate } from '../../core/router.js';
import { toast } from '../../core/toast.js';
import { api } from '../../core/api.js';
/**
 * agent-detail.js
 * Fetches agent config and events; renders overview, config, events.
 * Supports Stop, Pause, and Resume actions aligned with the state machine.
 */

'use strict';

var EVENTS_PAGE_SIZE = 50;
var EVENTS_MAX_LIMIT = 200;

// ---------------------------------------------------------------------------
// Status helpers (mirrors agents-list.js)
// ---------------------------------------------------------------------------

var STATUS = {
  MONITORING: 'Monitoring',
  SCHEDULED:  'Scheduled',
  SLEEPING:   'Sleeping',
  PAUSED:     'Paused',
  COMPLETED:  'Completed',
  INACTIVE:   'Inactive',
  ERROR:      'Error'
};

function normalizeStatus(raw) {
  if (!raw) return '';
  var map = {
    'RUNNING': STATUS.MONITORING, 'running': STATUS.MONITORING,
    'ACTIVE':  STATUS.MONITORING, 'active':  STATUS.MONITORING,
    'PENDING': STATUS.SCHEDULED,  'pending': STATUS.SCHEDULED,
    'scheduled': STATUS.SCHEDULED, 'SCHEDULED': STATUS.SCHEDULED,
    'completed': STATUS.COMPLETED, 'COMPLETED': STATUS.COMPLETED,
    'cancelled': STATUS.INACTIVE,  'CANCELLED': STATUS.INACTIVE
  };
  return map[raw] || raw;
}

function statusBadgeClass(rawStatus) {
  var s = normalizeStatus(rawStatus);
  switch (s) {
    case STATUS.MONITORING: return 'agent-status-monitoring';
    case STATUS.SCHEDULED:  return 'agent-status-scheduled';
    case STATUS.SLEEPING:   return 'agent-status-sleeping';
    case STATUS.PAUSED:     return 'agent-status-paused';
    case STATUS.COMPLETED:  return 'agent-status-completed';
    case STATUS.INACTIVE:   return 'agent-status-inactive';
    case STATUS.ERROR:      return 'agent-status-error';
    default:                return 'agent-status-default';
  }
}

function statusLabel(rawStatus) {
  var s = normalizeStatus(rawStatus);
  var icons = {
    'Monitoring': '🟢', 'Scheduled': '🕐', 'Sleeping': '🌙',
    'Paused': '⏸', 'Completed': '✅', 'Inactive': '⚫', 'Error': '🔴'
  };
  return (icons[s] || '') + ' ' + (s || rawStatus || '—');
}

function isPausable(status) {
  var s = normalizeStatus(status);
  return s === STATUS.MONITORING || s === STATUS.SCHEDULED || s === STATUS.SLEEPING;
}

function isResumable(status) {
  return normalizeStatus(status) === STATUS.PAUSED;
}

function isStoppable(status) {
  var s = normalizeStatus(status);
  return s === STATUS.MONITORING || s === STATUS.SCHEDULED ||
         s === STATUS.SLEEPING   || s === STATUS.PAUSED;
}

// ---------------------------------------------------------------------------
// URL / API helpers
// ---------------------------------------------------------------------------

function getAgentIdFromUrl() {
  try {
    var params = new URLSearchParams(window.location.search);
    return params.get('agent') || params.get('id') || '';
  } catch (e) { return ''; }
}

function apiRequest(path, opts) {
  if (api && typeof api.request === 'function') {
    return api.request(path, opts || {});
  }
  return Promise.reject(new Error('API not available'));
}

function fetchAgentConfig(agentId) {
  return apiRequest('/api/v1/agents/list').then(function (list) {
    var agents = Array.isArray(list) ? list : [];
    for (var i = 0; i < agents.length; i++) {
      if (agents[i].id === agentId) return agents[i];
    }
    return null;
  });
}

function fetchAgentEvents(agentId, limit, skip) {
  var q = '?limit=' + Math.min(Math.max(limit || EVENTS_PAGE_SIZE, 1), EVENTS_MAX_LIMIT) +
          '&skip=' + (skip || 0);
  return apiRequest('/api/v1/agents/' + encodeURIComponent(agentId) + '/events' + q);
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '—';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderOverview(agent) {
  var idEl          = document.getElementById('vision-agent-detail-id');
  var nameEl        = document.getElementById('vision-agent-detail-name');
  var statusEl      = document.getElementById('vision-agent-detail-status');
  var sourceValueEl = document.getElementById('vision-agent-detail-source-value');
  var createdEl     = document.getElementById('vision-agent-detail-created');

  if (idEl) idEl.textContent = agent.id || '—';
  if (nameEl) nameEl.textContent = agent.name || '—';
  if (statusEl) {
    var cls   = statusBadgeClass(agent.status);
    var label = statusLabel(agent.status);
    statusEl.innerHTML = '<span class="badge ' + cls + '">' + escapeHtml(label) + '</span>';
  }
  if (sourceValueEl) {
    if (agent.video_path) sourceValueEl.textContent = 'Video file';
    else if (agent.camera_id) {
      sourceValueEl.textContent = agent.camera_name
        ? (agent.camera_name + ' (' + agent.camera_id + ')')
        : agent.camera_id;
    } else {
      sourceValueEl.textContent = '—';
    }
  }
  if (createdEl) createdEl.textContent = formatDate(agent.created_at);
}

function renderFullConfig(agent) {
  var wrap = document.getElementById('vision-agent-config-content');
  if (!wrap) return;

  var rows = [
    { label: 'Camera ID',          value: agent.camera_id || '—' },
    { label: 'Model',              value: agent.model },
    { label: 'FPS',                value: agent.fps != null ? agent.fps : '—' },
    { label: 'Run mode',           value: agent.run_mode || '—' },
    { label: 'Interval (min)',     value: agent.interval_minutes != null ? agent.interval_minutes : '—' },
    { label: 'Check duration (s)', value: agent.check_duration_seconds != null ? agent.check_duration_seconds : '—' },
    { label: 'Start time',         value: formatDate(agent.start_time) },
    { label: 'End time',           value: formatDate(agent.end_time) },
    { label: 'Zone',               value: agent.zone != null ? agent.zone : '—' },
    { label: 'Requires zone',      value: agent.requires_zone != null ? (agent.requires_zone ? 'Yes' : 'No') : '—' }
  ];

  var rulesHtml = '';
  if (agent.rules && agent.rules.length) {
    rulesHtml =
      '<dt class="col-sm-3 text-body-tertiary">Rules</dt>' +
      '<dd class="col-sm-9"><pre class="mb-0 small bg-body-highlight p-2 rounded">' +
      escapeHtml(JSON.stringify(agent.rules, null, 2)) + '</pre></dd>';
  }

  var html = '<dl class="row mb-0 agent-detail-config-table">';
  rows.forEach(function (r) {
    html += '<dt class="col-sm-3">' + escapeHtml(r.label) +
            '</dt><dd class="col-sm-9">' + escapeHtml(r.value) + '</dd>';
  });
  html += rulesHtml + '</dl>';
  wrap.innerHTML = html;
}

function updateActionButtons(agent) {
  var stopBtn   = document.getElementById('vision-agent-detail-stop');
  var pauseBtn  = document.getElementById('vision-agent-detail-pause');
  var resumeBtn = document.getElementById('vision-agent-detail-resume');

  if (stopBtn) {
    stopBtn.disabled = !isStoppable(agent.status);
    stopBtn.classList.toggle('d-none', false);
  }
  if (pauseBtn) {
    pauseBtn.disabled = !isPausable(agent.status);
    pauseBtn.classList.toggle('d-none', isResumable(agent.status));
  }
  if (resumeBtn) {
    resumeBtn.disabled = !isResumable(agent.status);
    resumeBtn.classList.toggle('d-none', !isResumable(agent.status));
  }
}

function loadEventImagesWithAuth(container) {
  if (!container || !api || typeof api.fetchEventImageObjectUrl !== 'function') return;
  container.querySelectorAll('.agent-detail-event-card[data-event-id]').forEach(function (card) {
    var eventId = card.getAttribute('data-event-id');
    if (!eventId) return;
    var link = card.querySelector('.event-image-link');
    var img  = card.querySelector('.event-image-img');
    if (!link || !img) return;
    api.fetchEventImageObjectUrl(eventId)
      .then(function (url) {
        link.href = url;
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener');
        img.src = url;
      })
      .catch(function () { img.alt = 'Image unavailable'; });
  });
}

function renderEvents(data, append) {
  var wrap         = document.getElementById('vision-agent-events-content');
  var countEl      = document.getElementById('vision-agent-events-count');
  var loadMoreWrap = document.getElementById('vision-agent-events-load-more-wrap');
  if (!wrap) return;

  var total = data.total || 0;
  var items = data.items || [];
  if (countEl) countEl.textContent = total;

  if (!append) wrap.innerHTML = '';

  if (items.length === 0 && !append) {
    wrap.innerHTML = '<p class="text-body-tertiary mb-0">No events for this agent.</p>';
    if (loadMoreWrap) loadMoreWrap.classList.add('d-none');
    return;
  }

  items.forEach(function (ev) {
    var severityClass = (ev.severity || 'info') === 'error' ? 'danger' :
                        (ev.severity === 'warning' ? 'warning' : 'info');
    var imgHtml = ev.has_image && ev.id
      ? '<a href="#" class="d-block mb-2 event-image-link" target="_blank" rel="noopener">' +
        '<img class="agent-detail-event-img event-image-img" alt="Event" loading="lazy" /></a>'
      : '';
    var videoHtml = '';
    if (ev.video_chunks && ev.video_chunks.length) {
      videoHtml = '<div class="mt-2"><span class="small text-body-tertiary">Video:</span> ';
      ev.video_chunks.forEach(function (chunk, i) {
        if (chunk.video_url) {
          videoHtml += '<a href="' + escapeHtml(chunk.video_url) +
            '" target="_blank" rel="noopener" class="small me-2">Chunk ' +
            (chunk.chunk_number != null ? chunk.chunk_number : i) + '</a>';
        }
      });
      videoHtml += '</div>';
    }
    var card = document.createElement('div');
    card.className = 'card agent-detail-event-card mb-2';
    if (ev.has_image && ev.id) card.setAttribute('data-event-id', ev.id);
    card.innerHTML =
      '<div class="card-body py-2">' +
      imgHtml +
      '<div class="d-flex align-items-center flex-wrap gap-2 mb-1">' +
      '<span class="badge bg-' + severityClass + '">' + escapeHtml(ev.label || 'Event') + '</span>' +
      '<span class="small text-body-tertiary">' + escapeHtml(formatDate(ev.event_ts)) + '</span>' +
      '</div>' +
      (ev.camera_id ? '<p class="small mb-0 text-body-secondary">Camera: ' + escapeHtml(ev.camera_id) + '</p>' : '') +
      videoHtml +
      '</div>';
    wrap.appendChild(card);
  });

  loadEventImagesWithAuth(wrap);

  var currentCount = wrap.querySelectorAll('.agent-detail-event-card').length;
  if (loadMoreWrap && total > currentCount && items.length === EVENTS_PAGE_SIZE) {
    loadMoreWrap.classList.remove('d-none');
  } else if (loadMoreWrap) {
    loadMoreWrap.classList.add('d-none');
  }
}

function setLoading(loading) {
  var subtitle      = document.getElementById('vision-agent-detail-subtitle');
  var configContent = document.getElementById('vision-agent-config-content');
  var eventsContent = document.getElementById('vision-agent-events-content');
  if (subtitle)      subtitle.textContent = loading ? 'Loading…' : '';
  if (configContent && loading) configContent.innerHTML = '<p class="text-body-tertiary mb-0">Loading…</p>';
  if (eventsContent && loading) eventsContent.innerHTML = '<p class="text-body-tertiary mb-0">Loading events…</p>';
}

function setError(message) {
  var subtitle      = document.getElementById('vision-agent-detail-subtitle');
  var configContent = document.getElementById('vision-agent-config-content');
  var eventsContent = document.getElementById('vision-agent-events-content');
  if (subtitle)      subtitle.textContent = message || 'Error loading agent';
  if (configContent) configContent.innerHTML = '<p class="text-danger mb-0">' + escapeHtml(message || 'Failed to load configuration.') + '</p>';
  if (eventsContent) eventsContent.innerHTML = '<p class="text-danger mb-0">' + escapeHtml(message || 'Failed to load events.') + '</p>';
}

function loadEventsPage(agentId, skip, append, onDone) {
  fetchAgentEvents(agentId, EVENTS_PAGE_SIZE, skip)
    .then(function (data) {
      renderEvents(data, append);
      if (onDone) onDone(data);
    })
    .catch(function (err) {
      var eventsContent = document.getElementById('vision-agent-events-content');
      if (eventsContent && !append) {
        eventsContent.innerHTML = '<p class="text-danger mb-0">' +
          escapeHtml(err.message || 'Failed to load events.') + '</p>';
      }
      if (onDone) onDone(null);
    });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  var titleEl  = document.getElementById('vision-agent-detail-title');
  var backLink = document.getElementById('vision-agent-detail-back');
  var agentId  = getAgentIdFromUrl();

  var backParams = new URLSearchParams(window.location.search);
  backParams.delete('agent');
  backParams.delete('id');
  var agentsBoardHref = 'agents-board.html' + (backParams.toString() ? '?' + backParams.toString() : '');
  if (backLink) {
    backLink.setAttribute('href', agentsBoardHref);
    backLink.addEventListener('click', function (e) {
      e.preventDefault();
      navigate(agentsBoardHref).catch(function () { window.location.href = agentsBoardHref; });
    });
  }
  var breadcrumbAgents = document.getElementById('vision-agent-detail-breadcrumb-agents');
  if (breadcrumbAgents) breadcrumbAgents.setAttribute('href', agentsBoardHref);

  if (!agentId) {
    if (titleEl) titleEl.textContent = 'Agent Details';
    var subtitle = document.getElementById('vision-agent-detail-subtitle');
    if (subtitle) subtitle.textContent = 'No agent selected';
    setError('No agent ID in URL. Use ?agent=<id>');
    return;
  }

  if (titleEl) titleEl.textContent = 'Agent: ' + agentId;
  setLoading(true);

  fetchAgentConfig(agentId)
    .then(function (agent) {
      setLoading(false);
      if (!agent) {
        setError('Agent not found or you don\'t have access.');
        return;
      }
      var subtitle = document.getElementById('vision-agent-detail-subtitle');
      if (subtitle) {
        subtitle.textContent = agent.name
          ? (agent.name + ' · ' + (agent.camera_id || '—'))
          : '';
      }

      renderOverview(agent);
      renderFullConfig(agent);
      updateActionButtons(agent);

      loadEventsPage(agentId, 0, false, function () {
        var loadMoreBtn = document.getElementById('vision-agent-events-load-more');
        var eventsSkip  = EVENTS_PAGE_SIZE;
        if (loadMoreBtn) {
          loadMoreBtn.onclick = function () {
            loadMoreBtn.disabled = true;
            loadEventsPage(agentId, eventsSkip, true, function () {
              loadMoreBtn.disabled = false;
              eventsSkip += EVENTS_PAGE_SIZE;
            });
          };
        }
      });
    })
    .catch(function (err) {
      setLoading(false);
      setError(err.message || 'Failed to load agent.');
    });

  // --- Stop button ---
  var stopBtn = document.getElementById('vision-agent-detail-stop');
  if (stopBtn) {
    stopBtn.addEventListener('click', function () {
      if (!agentId) return;
      if (!confirm('Stop this agent? It will be set to Inactive.')) return;
      stopBtn.disabled = true;
      apiRequest('/api/v1/agents/stop/' + encodeURIComponent(agentId), { method: 'POST' })
        .then(function () {
          if (toast && toast.success) {
            toast.success('Agent stopped.');
          }
          setTimeout(boot, 800);
        })
        .catch(function (err) {
          stopBtn.disabled = false;
          alert(err.message || 'Failed to stop agent');
        });
    });
  }

  // --- Pause button ---
  var pauseBtn = document.getElementById('vision-agent-detail-pause');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', function () {
      if (!agentId) return;
      pauseBtn.disabled = true;
      apiRequest('/api/v1/agents/pause/' + encodeURIComponent(agentId), { method: 'POST' })
        .then(function () {
          if (toast && toast.success) {
            toast.success('Agent paused.');
          }
          setTimeout(boot, 800);
        })
        .catch(function (err) {
          pauseBtn.disabled = false;
          alert(err.message || 'Failed to pause agent');
        });
    });
  }

  // --- Resume button ---
  var resumeBtn = document.getElementById('vision-agent-detail-resume');
  if (resumeBtn) {
    resumeBtn.addEventListener('click', function () {
      if (!agentId) return;
      resumeBtn.disabled = true;
      apiRequest('/api/v1/agents/resume/' + encodeURIComponent(agentId), { method: 'POST' })
        .then(function () {
          if (toast && toast.success) {
            toast.success('Agent resumed.');
          }
          setTimeout(boot, 800);
        })
        .catch(function (err) {
          resumeBtn.disabled = false;
          alert(err.message || 'Failed to resume agent');
        });
    });
  }
}

boot();
document.addEventListener('DOMContentLoaded', boot);
window.addEventListener('vision:spa:navigated', boot);
