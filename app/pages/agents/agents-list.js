import { navigate } from '../../core/router.js';
import { api } from '../../core/api.js';
/**
 * agents-list.js
 * Grid loading, rendering, search and filter logic for the Agents Board.
 */

import { bindCreateAgentModal } from './agent-create-modal.js';

'use strict';

// ---------------------------------------------------------------------------
// Status helpers
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

function getStatusDisplay(rawStatus) {
  var s = normalizeStatus(rawStatus);
  switch (s) {
    case STATUS.MONITORING: return { icon: '🟢', label: 'Monitoring',  badgeClass: 'agent-status-monitoring' };
    case STATUS.SCHEDULED:  return { icon: '🕐', label: 'Scheduled',   badgeClass: 'agent-status-scheduled' };
    case STATUS.SLEEPING:   return { icon: '🌙', label: 'Sleeping',    badgeClass: 'agent-status-sleeping' };
    case STATUS.PAUSED:     return { icon: '⏸',  label: 'Paused',      badgeClass: 'agent-status-paused' };
    case STATUS.COMPLETED:  return { icon: '✅',  label: 'Completed',   badgeClass: 'agent-status-completed' };
    case STATUS.INACTIVE:   return { icon: '⚫',  label: 'Inactive',    badgeClass: 'agent-status-inactive' };
    case STATUS.ERROR:      return { icon: '🔴', label: 'Error',       badgeClass: 'agent-status-error' };
    default:                return { icon: '',    label: rawStatus || '—', badgeClass: 'agent-status-default' };
  }
}

function isPausable(agent) {
  var s = normalizeStatus(agent.status);
  return s === STATUS.MONITORING || s === STATUS.SCHEDULED || s === STATUS.SLEEPING;
}

function isResumable(agent) {
  return normalizeStatus(agent.status) === STATUS.PAUSED;
}

function isStoppable(agent) {
  var s = normalizeStatus(agent.status);
  return s === STATUS.MONITORING || s === STATUS.SCHEDULED ||
         s === STATUS.SLEEPING   || s === STATUS.PAUSED;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function apiRequest(path, opts) {
  if (api && typeof api.request === 'function') {
    return api.request(path, opts || {});
  }
  return Promise.reject(new Error('API service not available.'));
}

function listAgents() {
  return apiRequest('/api/v1/agents/list');
}

function stopAgent(agentId) {
  return apiRequest('/api/v1/agents/stop/' + encodeURIComponent(agentId), { method: 'POST' });
}

function pauseAgent(agentId) {
  return apiRequest('/api/v1/agents/pause/' + encodeURIComponent(agentId), { method: 'POST' });
}

function resumeAgent(agentId) {
  return apiRequest('/api/v1/agents/resume/' + encodeURIComponent(agentId), { method: 'POST' });
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function formatDuration(startTime, endTime) {
  if (!startTime || !endTime) return null;
  var start = new Date(startTime).getTime();
  var end   = new Date(endTime).getTime();
  if (isNaN(start) || isNaN(end) || end <= start) return null;
  var ms   = end - start;
  var sec  = Math.floor(ms / 1000);
  var min  = Math.floor(sec / 60);
  var hour = Math.floor(min / 60);
  if (hour >= 1) return hour === 1 ? '1h' : hour + 'h';
  if (min  >= 1) return min  === 1 ? '1 min' : min + ' min';
  return sec <= 0 ? null : (sec + 's');
}

function getRuleGroupLabel(agent) {
  var r = agent.rules && agent.rules[0];
  if (!r) return 'Other';
  if (r.label) return r.label;
  if (r.type === 'class_presence' && r.class) return (r.class.charAt(0).toUpperCase() + r.class.slice(1)) + ' Detection';
  if (r.type) return r.type.replace(/_/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  return 'Other';
}

function getRuleDisplayText(agent) {
  var r = agent.rules && agent.rules[0];
  if (!r) return '—';
  if (r.label) return r.label;
  if (r.type === 'class_presence' && r.class) return 'Person presence detection';
  return (r.type || '').replace(/_/g, ' ');
}

function formatModel(model) {
  if (!model) return '—';
  var name = String(model).replace(/\.(pt|onnx)$/i, '');
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

function getFilterState() {
  var searchEl = document.getElementById('vision-agents-search');
  var cameraEl = document.getElementById('vision-filter-camera');
  var ruleEl   = document.getElementById('vision-filter-rule-type');
  var statusEl = document.getElementById('vision-filter-status');
  var dateEl   = document.getElementById('vision-filter-date');
  return {
    search:    searchEl ? searchEl.value : '',
    camera:    cameraEl ? cameraEl.value : '',
    ruleType:  ruleEl   ? ruleEl.value   : '',
    status:    statusEl ? statusEl.value : '',
    quickDate: dateEl   ? dateEl.value   : ''
  };
}

function buildDetailUrl(agentId) {
  var state  = getFilterState();
  var params = new URLSearchParams();
  params.set('agent', agentId);
  if (state.camera)    params.set('camera',    state.camera);
  if (state.ruleType)  params.set('ruleType',  state.ruleType);
  if (state.status)    params.set('status',    state.status);
  if (state.quickDate) params.set('date',      state.quickDate);
  if (state.search)    params.set('q',         state.search);
  return 'agent-detail.html?' + params.toString();
}

function applyFiltersFromUrl() {
  try {
    var params   = new URLSearchParams(window.location.search);
    var camera   = params.get('camera')   || '';
    var ruleType = params.get('ruleType') || '';
    var st       = params.get('status')   || '';
    var date     = params.get('date')     || '';
    var q        = params.get('q')        || '';
    var cameraEl = document.getElementById('vision-filter-camera');
    var ruleEl   = document.getElementById('vision-filter-rule-type');
    var statusEl = document.getElementById('vision-filter-status');
    var dateEl   = document.getElementById('vision-filter-date');
    var searchEl = document.getElementById('vision-agents-search');
    if (cameraEl && camera)   cameraEl.value = camera;
    if (ruleEl   && ruleType) ruleEl.value   = ruleType;
    if (statusEl && st)       statusEl.value = st;
    if (dateEl   && date)     dateEl.value   = date;
    if (searchEl)             searchEl.value = q;
  } catch (e) { /* ignore */ }
}

function isAgentInDateRange(agent, quickDate) {
  if (!quickDate) return true;
  var dateStr = agent.created_at || agent.start_time;
  if (!dateStr) return false;
  var d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  var todayStart     = new Date(new Date().toDateString()).getTime();
  var yesterdayStart = todayStart - 86400000;
  var last7Start     = todayStart - 7 * 86400000;
  var t = d.getTime();
  if (quickDate === 'today')     return t >= todayStart;
  if (quickDate === 'yesterday') return t >= yesterdayStart && t < todayStart;
  if (quickDate === 'last7')     return t >= last7Start;
  return true;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function buildActionButtons(agent) {
  var id = escapeHtml(agent.id || '');
  var btns = '';
  if (isResumable(agent)) {
    btns += '<button type="button" class="btn btn-phoenix-success btn-sm resume-agent-btn ms-1" data-agent-id="' + id + '">Resume</button>';
  }
  if (isPausable(agent)) {
    btns += '<button type="button" class="btn btn-phoenix-warning btn-sm pause-agent-btn ms-1" data-agent-id="' + id + '">Pause</button>';
  }
  if (isStoppable(agent)) {
    btns += '<button type="button" class="btn btn-phoenix-danger btn-sm stop-agent-btn ms-1" data-agent-id="' + id + '">Stop</button>';
  }
  return btns;
}

function renderAgents(agents, filterState) {
  var grid    = document.getElementById('vision-agents-board-grid');
  var countEl = document.getElementById('vision-agents-count');
  if (!grid || !countEl) return;

  var state     = filterState || getFilterState();
  var q         = (state.search    || '').toLowerCase().trim();
  var camera    = (state.camera    || '').trim();
  var ruleType  = (state.ruleType  || '').trim();
  var stFilter  = (state.status    || '').trim();
  var quickDate = (state.quickDate || '').trim();

  var filtered = agents.filter(function (a) {
    if (camera   && (a.camera_id || '') !== camera) return false;
    if (ruleType && getRuleGroupLabel(a) !== ruleType) return false;
    if (stFilter) {
      var norm = normalizeStatus(a.status);
      if (norm.toLowerCase() !== stFilter.toLowerCase()) return false;
    }
    if (!isAgentInDateRange(a, quickDate)) return false;
    if (q) {
      var ruleLabel = getRuleGroupLabel(a);
      var match =
        (a.name        || '').toLowerCase().indexOf(q) >= 0 ||
        (a.camera_id   || '').toLowerCase().indexOf(q) >= 0 ||
        (a.camera_name || '').toLowerCase().indexOf(q) >= 0 ||
        normalizeStatus(a.status).toLowerCase().indexOf(q) >= 0 ||
        ruleLabel.toLowerCase().indexOf(q) >= 0 ||
        (getRuleDisplayText(a) || '').toLowerCase().indexOf(q) >= 0;
      if (!match) return false;
    }
    return true;
  });

  countEl.textContent = String(filtered.length);

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="col-12"><p class="text-body-tertiary mb-0">No agents found.</p></div>';
    return;
  }

  var groups = {};
  filtered.forEach(function (agent) {
    var key = getRuleGroupLabel(agent);
    if (!groups[key]) groups[key] = [];
    groups[key].push(agent);
  });
  var groupOrder = Object.keys(groups).sort();

  var html = [];
  groupOrder.forEach(function (groupLabel) {
    var groupAgents = groups[groupLabel];
    var count = groupAgents.length;
    var sectionIcon =
      groupLabel.indexOf('Person')     >= 0 ? '👤' :
      groupLabel.indexOf('Weapon')     >= 0 ? '🔫' :
      groupLabel.indexOf('Restricted') >= 0 ? '🚧' : '🤖';

    html.push(
      '<div class="col-12 agents-group-header mt-2 mb-1">' +
      '<span class="agents-group-title">' + sectionIcon + ' ' +
      escapeHtml(groupLabel) +
      ' <span class="agents-group-count">(' + count + ')</span></span>' +
      '</div>'
    );

    groupAgents.forEach(function (agent) {
      var statusInfo  = getStatusDisplay(agent.status);
      var actionBtns  = buildActionButtons(agent);
      var durationStr = formatDuration(agent.start_time, agent.end_time);

      var chips = [];
      if (agent.run_mode) chips.push('<span class="agent-chip">' + escapeHtml(agent.run_mode) + '</span>');
      if (agent.fps != null) chips.push('<span class="agent-chip">' + escapeHtml(agent.fps) + ' FPS</span>');
      chips.push('<span class="agent-chip">' + escapeHtml(formatModel(agent.model)) + '</span>');
      if (durationStr) chips.push('<span class="agent-chip">' + escapeHtml(durationStr) + '</span>');

      var chipsHtml  = chips.join(' ');
      var cameraLine = agent.camera_id
        ? ('Camera: ' + escapeHtml(agent.camera_name || agent.camera_id))
        : (agent.video_path ? 'Video file' : '—');
      var ruleText = getRuleDisplayText(agent);

      html.push(
        '<div class="col-12 col-sm-6 col-xl-4">' +
        '<div class="card agent-card agent-insight-card h-100" ' +
        '  data-agent-id="' + escapeHtml(agent.id || '') + '" data-agent-card>' +
        '  <div class="card-body">' +
        '    <div class="d-flex align-items-start justify-content-between gap-2">' +
        '      <div class="flex-grow-1 min-w-0">' +
        '        <div class="agent-card-row-1">' +
        '          <h6 class="agent-card-name mb-0 text-truncate">' + escapeHtml(agent.name || 'Unnamed') + '</h6>' +
        '          <span class="badge agent-status-badge ' + statusInfo.badgeClass + '">' +
        statusInfo.icon + ' ' + escapeHtml(statusInfo.label) +
        '          </span>' +
        '        </div>' +
        '        <p class="agent-card-camera small text-body-tertiary mb-1 mt-1">' + cameraLine + '</p>' +
        '        <div class="agent-card-chips mb-1">' + chipsHtml + '</div>' +
        '        <p class="agent-card-rule small text-body-secondary mb-0">Rule: ' + escapeHtml(ruleText) + '</p>' +
        '        <a href="#" class="agent-view-details small text-primary text-decoration-none mt-1 d-inline-block">View details →</a>' +
        '      </div>' +
        '      <div class="flex-shrink-0 d-flex flex-column gap-1 align-items-end">' + actionBtns + '</div>' +
        '    </div>' +
        '  </div>' +
        '</div>' +
        '</div>'
      );
    });
  });

  grid.innerHTML = html.join('');
  bindCardButtons(grid);
}

// ---------------------------------------------------------------------------
// Button event binding
// ---------------------------------------------------------------------------

function bindCardButtons(grid) {
  grid.querySelectorAll('.stop-agent-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var id = this.getAttribute('data-agent-id');
      if (!id) return;
      if (!confirm('Stop this agent? It will be set to Inactive.')) return;
      this.disabled = true;
      this.textContent = 'Stopping…';
      stopAgent(id)
        .then(function () { setTimeout(loadAgents, 800); })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Stop';
          alert(err.message || 'Failed to stop agent');
        });
    });
  });

  grid.querySelectorAll('.pause-agent-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var id = this.getAttribute('data-agent-id');
      if (!id) return;
      this.disabled = true;
      this.textContent = 'Pausing…';
      pauseAgent(id)
        .then(function () { setTimeout(loadAgents, 800); })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Pause';
          alert(err.message || 'Failed to pause agent');
        });
    });
  });

  grid.querySelectorAll('.resume-agent-btn').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var id = this.getAttribute('data-agent-id');
      if (!id) return;
      this.disabled = true;
      this.textContent = 'Resuming…';
      resumeAgent(id)
        .then(function () { setTimeout(loadAgents, 800); })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = 'Resume';
          alert(err.message || 'Failed to resume agent');
        });
    });
  });

  grid.querySelectorAll('[data-agent-card]').forEach(function (card) {
    function goToDetail(e) {
      if (e) e.preventDefault();
      var id = card.getAttribute('data-agent-id');
      if (!id) return;
      var href = buildDetailUrl(id);
      navigate(href).catch(function () { window.location.href = href; });
    }
    card.addEventListener('click', function (e) {
      if (e.target.closest('.stop-agent-btn') ||
          e.target.closest('.pause-agent-btn') ||
          e.target.closest('.resume-agent-btn')) return;
      goToDetail(e);
    });
    var viewLink = card.querySelector('.agent-view-details');
    if (viewLink) viewLink.addEventListener('click', goToDetail);
  });
}

// ---------------------------------------------------------------------------
// Filter population
// ---------------------------------------------------------------------------

var cachedAgents = [];
var searchBound  = false;
var filtersBound = false;

function populateFilterOptions(agents) {
  var cameraEl = document.getElementById('vision-filter-camera');
  var ruleEl   = document.getElementById('vision-filter-rule-type');
  var statusEl = document.getElementById('vision-filter-status');
  if (!cameraEl || !ruleEl || !statusEl) return;

  var cameraMap = {};
  var ruleTypes = [];
  var statuses  = [];
  agents.forEach(function (a) {
    if (a.camera_id && !cameraMap[a.camera_id]) cameraMap[a.camera_id] = a.camera_name || a.camera_id;
    var rl = getRuleGroupLabel(a);
    if (rl && ruleTypes.indexOf(rl) < 0) ruleTypes.push(rl);
    var st = normalizeStatus(a.status);
    if (st && statuses.indexOf(st) < 0) statuses.push(st);
  });
  var cameraIds = Object.keys(cameraMap).sort();
  ruleTypes.sort();
  statuses.sort();

  var saveCam    = cameraEl.value;
  var saveRule   = ruleEl.value;
  var saveStatus = statusEl.value;

  cameraEl.innerHTML = '<option value="">All cameras</option>' +
    cameraIds.map(function (c) {
      return '<option value="' + escapeHtml(c) + '">' + escapeHtml(cameraMap[c]) + '</option>';
    }).join('');
  ruleEl.innerHTML = '<option value="">All types</option>' +
    ruleTypes.map(function (r) {
      return '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + '</option>';
    }).join('');
  statusEl.innerHTML = '<option value="">All statuses</option>' +
    statuses.map(function (s) {
      var info = getStatusDisplay(s);
      return '<option value="' + escapeHtml(s) + '">' + info.icon + ' ' + escapeHtml(info.label) + '</option>';
    }).join('');

  if (cameraIds.indexOf(saveCam) >= 0)    cameraEl.value = saveCam;
  if (ruleTypes.indexOf(saveRule) >= 0)   ruleEl.value   = saveRule;
  if (statuses.indexOf(saveStatus) >= 0)  statusEl.value = saveStatus;
}

function bindFilters() {
  if (filtersBound) return;
  var cameraEl = document.getElementById('vision-filter-camera');
  var ruleEl   = document.getElementById('vision-filter-rule-type');
  var statusEl = document.getElementById('vision-filter-status');
  var dateEl   = document.getElementById('vision-filter-date');
  var clearBtn = document.getElementById('vision-filters-clear');
  if (!cameraEl && !ruleEl && !statusEl && !dateEl) return;
  filtersBound = true;

  function applyFilters() {
    renderAgents(cachedAgents, getFilterState());
  }

  if (cameraEl) cameraEl.addEventListener('change', applyFilters);
  if (ruleEl)   ruleEl.addEventListener('change',   applyFilters);
  if (statusEl) statusEl.addEventListener('change',  applyFilters);
  if (dateEl)   dateEl.addEventListener('change',    applyFilters);
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      if (cameraEl) cameraEl.value = '';
      if (ruleEl)   ruleEl.value   = '';
      if (statusEl) statusEl.value = '';
      if (dateEl)   dateEl.value   = '';
      var searchEl = document.getElementById('vision-agents-search');
      if (searchEl) searchEl.value = '';
      applyFilters();
    });
  }
}

function loadAgents() {
  var grid = document.getElementById('vision-agents-board-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="col-12"><p class="text-body-tertiary mb-0">Loading…</p></div>';
  listAgents()
    .then(function (agents) {
      cachedAgents = Array.isArray(agents) ? agents : [];
      populateFilterOptions(cachedAgents);
      applyFiltersFromUrl();
      renderAgents(cachedAgents, getFilterState());
    })
    .catch(function (err) {
      cachedAgents = [];
      var el = document.getElementById('vision-agents-count');
      if (el) el.textContent = '0';
      if (grid) grid.innerHTML = '<div class="col-12"><p class="text-danger mb-0">' + escapeHtml(err.message || 'Failed to load agents') + '</p></div>';
    });
}

function bindSearchOnce() {
  var searchEl = document.getElementById('vision-agents-search');
  if (!searchEl || searchBound) return;
  searchBound = true;
  var timeout;
  searchEl.addEventListener('input', function () {
    clearTimeout(timeout);
    timeout = setTimeout(function () {
      renderAgents(cachedAgents, getFilterState());
    }, 150);
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function boot() {
  var grid = document.getElementById('vision-agents-board-grid');
  if (!grid) return;
  searchBound  = false;
  filtersBound = false;
  bindSearchOnce();
  bindFilters();
  bindCreateAgentModal(loadAgents);
  loadAgents();
}

boot();
document.addEventListener('DOMContentLoaded', boot);
window.addEventListener('vision:spa:navigated', boot);
