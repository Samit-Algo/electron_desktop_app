/**
 * Agents Board – Loads and renders agents list.
 * Supports the new state-machine statuses:
 *   Monitoring | Scheduled | Sleeping | Paused | Completed | Inactive | Error
 * Cards show Stop + Pause buttons for Monitoring agents.
 * Cards show Resume button for Paused agents.
 */
(function () {
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
    // Normalise legacy uppercase values to new Title Case
    var map = {
      'RUNNING': STATUS.MONITORING,
      'running': STATUS.MONITORING,
      'ACTIVE':  STATUS.MONITORING,
      'active':  STATUS.MONITORING,
      'PENDING': STATUS.SCHEDULED,
      'pending': STATUS.SCHEDULED,
      'scheduled': STATUS.SCHEDULED,
      'SCHEDULED': STATUS.SCHEDULED,
      'completed': STATUS.COMPLETED,
      'COMPLETED': STATUS.COMPLETED,
      'cancelled': STATUS.INACTIVE,
      'CANCELLED': STATUS.INACTIVE
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

  function isMonitoring(agent) {
    var s = normalizeStatus(agent.status);
    return s === STATUS.MONITORING;
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
    return (
      s === STATUS.MONITORING ||
      s === STATUS.SCHEDULED  ||
      s === STATUS.SLEEPING   ||
      s === STATUS.PAUSED
    );
  }

  // ---------------------------------------------------------------------------
  // API helpers
  // ---------------------------------------------------------------------------

  function apiRequest(path, opts) {
    if (window.visionAPI && typeof window.visionAPI.request === 'function') {
      return window.visionAPI.request(path, opts || {});
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
      var camera   = params.get('camera')    || '';
      var ruleType = params.get('ruleType')  || '';
      var st       = params.get('status')    || '';
      var date     = params.get('date')      || '';
      var q        = params.get('q')         || '';
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
    var nowMs         = Date.now();
    var todayStart    = new Date(new Date().toDateString()).getTime();
    var yesterdayStart = todayStart - 86400000;
    var last7Start    = todayStart - 7 * 86400000;
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
      btns +=
        '<button type="button" class="btn btn-phoenix-success btn-sm resume-agent-btn ms-1" ' +
        'data-agent-id="' + id + '">Resume</button>';
    }
    if (isPausable(agent)) {
      btns +=
        '<button type="button" class="btn btn-phoenix-warning btn-sm pause-agent-btn ms-1" ' +
        'data-agent-id="' + id + '">Pause</button>';
    }
    if (isStoppable(agent)) {
      btns +=
        '<button type="button" class="btn btn-phoenix-danger btn-sm stop-agent-btn ms-1" ' +
        'data-agent-id="' + id + '">Stop</button>';
    }
    return btns;
  }

  function renderAgents(agents, filterState) {
    var grid    = document.getElementById('vision-agents-board-grid');
    var countEl = document.getElementById('vision-agents-count');
    if (!grid || !countEl) return;

    var state    = filterState || getFilterState();
    var q        = (state.search    || '').toLowerCase().trim();
    var camera   = (state.camera    || '').trim();
    var ruleType = (state.ruleType  || '').trim();
    var stFilter = (state.status    || '').trim();
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
        var statusInfo   = getStatusDisplay(agent.status);
        var actionBtns   = buildActionButtons(agent);
        var durationStr  = formatDuration(agent.start_time, agent.end_time);

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
    // Stop
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

    // Pause
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

    // Resume
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

    // Card click → detail page
    grid.querySelectorAll('[data-agent-card]').forEach(function (card) {
      function goToDetail(e) {
        if (e) e.preventDefault();
        var id = card.getAttribute('data-agent-id');
        if (!id) return;
        var href = buildDetailUrl(id);
        if (window.visionaiSpa && typeof window.visionaiSpa.navigate === 'function') {
          window.visionaiSpa.navigate(href).catch(function () { window.location.href = href; });
        } else {
          window.location.href = href;
        }
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

  var cachedAgents   = [];
  var searchBound    = false;
  var filtersBound   = false;

  function populateFilterOptions(agents) {
    var cameraEl = document.getElementById('vision-filter-camera');
    var ruleEl   = document.getElementById('vision-filter-rule-type');
    var statusEl = document.getElementById('vision-filter-status');
    if (!cameraEl || !ruleEl || !statusEl) return;

    var cameraMap  = {};
    var ruleTypes  = [];
    var statuses   = [];
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

    if (cameraIds.indexOf(saveCam) >= 0)  cameraEl.value = saveCam;
    if (ruleTypes.indexOf(saveRule) >= 0) ruleEl.value   = saveRule;
    if (statuses.indexOf(saveStatus) >= 0) statusEl.value = saveStatus;
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
  // Rule metadata (mirrors vision_rule_knowledge_base.json)
  // ---------------------------------------------------------------------------

  var RULE_META = [
    {
      id: 'class_presence', name: 'Presence Detection', icon: '👤',
      desc: 'Alert when a person, vehicle, or object appears in view',
      needsClass: true,
      classes: ['person', 'car', 'bicycle', 'truck', 'bus'],
      needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false,
      needsZone: false, zoneType: null, zoneDesc: ''
    },
    {
      id: 'weapon_detection', name: 'Weapon Detection', icon: '🔫',
      desc: 'Alert when a weapon (gun or knife) is detected',
      needsClass: false, needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false,
      needsZone: false, zoneType: null, zoneDesc: ''
    },
    {
      id: 'sleep_detection', name: 'Sleep Detection', icon: '💤',
      desc: 'Alert when a person is detected sleeping or lying down',
      needsClass: false, needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false,
      needsZone: false, zoneType: null, zoneDesc: ''
    },
    {
      id: 'class_count', name: 'Object Counter', icon: '🔢',
      desc: 'Count people or vehicles crossing a line',
      needsClass: true,
      classes: ['person', 'car', 'truck', 'bicycle', 'bus', 'motorcycle'],
      needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false,
      needsZone: true, zoneType: 'line',
      zoneDesc: 'Draw exactly 2 points to create a counting line. Objects whose centre crosses this line will be counted.'
    },
    {
      id: 'box_count', name: 'Box Counter', icon: '📦',
      desc: 'Count boxes and packages crossing a boundary',
      needsClass: false, fixedClass: 'box',
      needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false,
      needsZone: true, zoneType: 'line',
      zoneDesc: 'Draw exactly 2 points to create a counting line. Boxes whose centre crosses this line will be counted.'
    },
    {
      id: 'restricted_zone', name: 'Restricted Zone', icon: '🚧',
      desc: 'Alert when a person or vehicle enters a restricted area',
      needsClass: true,
      classes: ['person', 'car', 'truck', 'bicycle', 'motorcycle'],
      needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false,
      needsZone: true, zoneType: 'polygon',
      zoneDesc: 'Draw a polygon (min 3 points) to define the restricted area. Click to add points; click the first point or press Save to close.'
    },
    {
      id: 'wall_climb_detection', name: 'Wall Climb Detection', icon: '🧗',
      desc: 'Alert when someone climbs a wall or fence',
      needsClass: false, fixedClass: 'person',
      needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false,
      needsZone: true, zoneType: 'polygon',
      zoneDesc: 'Draw a polygon (min 3 points) around the wall or fence boundary.'
    },
    {
      id: 'fall_detection', name: 'Fall Detection', icon: '🚨',
      desc: 'Alert when a person falls down',
      needsClass: false, needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false,
      needsZone: false, zoneType: null, zoneDesc: ''
    },
    {
      id: 'fire_detection', name: 'Fire Detection', icon: '🔥',
      desc: 'Alert when fire, flame, or smoke is detected in view',
      needsClass: false, needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false,
      needsZone: false, zoneType: null, zoneDesc: ''
    },
    {
      id: 'face_detection', name: 'Face / Person ID', icon: '🪪',
      desc: 'Alert when a specific person from the gallery is seen',
      needsClass: false, needsWatchNames: true, needsIdleThreshold: false, needsAbsenceThreshold: false,
      needsZone: false, zoneType: null, zoneDesc: ''
    },
    {
      id: 'loom_machine_state', name: 'Machine Idle Alert', icon: '⚙️',
      desc: 'Alert when a machine has been idle longer than a threshold',
      needsClass: false, needsWatchNames: false, needsIdleThreshold: true, needsAbsenceThreshold: false,
      needsZone: true, zoneType: 'polygon',
      zoneDesc: 'Draw a polygon around the moving parts of the machine. The system measures motion inside this area.'
    },
    {
      id: 'person_near_machine', name: 'Person Near Machine', icon: '👷',
      desc: 'Alert when no operator is near a machine for too long',
      needsClass: false, needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: true,
      needsZone: true, zoneType: 'polygon',
      zoneDesc: 'Draw a polygon around the machine zone. The system monitors whether a person is present inside.'
    }
  ];

  // ---------------------------------------------------------------------------
  // Zone canvas state (module-level, reset on each modal open)
  // ---------------------------------------------------------------------------

  var _zone = {
    points: [],          // [{x,y}] in canvas pixels
    mode: 'polygon',     // 'polygon' | 'line'
    imgEl: null,
    imgW: 640,
    imgH: 360,
    savedCoords: null,   // [[x_norm, y_norm], ...]
    savedType: null,
    mousePt: null
  };

  function _zoneReset(mode) {
    _zone.points = [];
    _zone.mode = mode || 'polygon';
    _zone.imgEl = null;
    _zone.imgW = 640;
    _zone.imgH = 360;
    _zone.savedCoords = null;
    _zone.savedType = null;
    _zone.mousePt = null;
  }

  function _zoneDraw() {
    var canvas = document.getElementById('ca-zone-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (_zone.imgEl) {
      ctx.drawImage(_zone.imgEl, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    var pts = _zone.points;
    if (pts.length === 0 && !_zone.mousePt) return;

    // Lines between points
    if (pts.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (_zone.mode === 'polygon' && pts.length >= 3) ctx.lineTo(pts[0].x, pts[0].y);
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (_zone.mode === 'polygon' && pts.length >= 3) {
        ctx.fillStyle = 'rgba(34,211,238,.15)';
        ctx.fill();
      }
    }

    // Preview line from last point to mouse
    if (_zone.mousePt && pts.length > 0) {
      var last = pts[pts.length - 1];
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(_zone.mousePt.x, _zone.mousePt.y);
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Point circles
    pts.forEach(function (pt, idx) {
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, idx === 0 ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = idx === 0 ? '#22c55e' : '#22d3ee';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }

  function _zoneIsNearFirst(px, py) {
    if (_zone.points.length < 3) return false;
    var f = _zone.points[0];
    var dx = px - f.x, dy = py - f.y;
    return Math.sqrt(dx * dx + dy * dy) < 14;
  }

  function _zoneNormalize() {
    var W = _zone.imgW, H = _zone.imgH;
    return _zone.points.map(function (pt) {
      return [
        Math.round(pt.x / W * 1000) / 1000,
        Math.round(pt.y / H * 1000) / 1000
      ];
    });
  }

  function _zoneUpdateHint() {
    var hintEl = document.getElementById('ca-zone-hint');
    var undoBtn = document.getElementById('ca-zone-undo-btn');
    var clearBtn = document.getElementById('ca-zone-clear-btn');
    var n = _zone.points.length;
    var hint = '';
    if (_zone.mode === 'line') {
      if (n === 0) hint = 'Click to place the first endpoint of the counting line.';
      else if (n === 1) hint = 'Click to place the second endpoint.';
      else hint = 'Counting line ready. You may clear and redraw.';
    } else {
      if (n === 0) hint = 'Click to start drawing the polygon.';
      else if (n < 3) hint = 'Add at least ' + (3 - n) + ' more point' + (3 - n > 1 ? 's' : '') + '.';
      else hint = n + ' points — click the first point (green) to close, or click "Save Zone" above.';
    }
    if (hintEl) hintEl.textContent = hint;
    var hasPoints = n > 0;
    if (undoBtn) undoBtn.disabled = !hasPoints;
    if (clearBtn) clearBtn.disabled = !hasPoints;
  }

  function _zoneCanFinish() {
    var n = _zone.points.length;
    return (_zone.mode === 'polygon' && n >= 3) ||
           (_zone.mode === 'line' && n === 2);
  }

  function _zoneSaveAndMark() {
    if (!_zoneCanFinish()) return false;
    _zone.savedCoords = _zoneNormalize();
    _zone.savedType = _zone.mode === 'line' ? 'line' : 'polygon';
    var ind = document.getElementById('ca-zone-saved-indicator');
    if (ind) ind.classList.remove('d-none');
    var createBtn = document.getElementById('ca-create-btn');
    if (createBtn) createBtn.disabled = false;
    return true;
  }

  function _zoneBindCanvas(mode) {
    var canvas = document.getElementById('ca-zone-canvas');
    if (!canvas) return;

    // Remove previous listeners by cloning
    var fresh = canvas.cloneNode(true);
    canvas.parentNode.replaceChild(fresh, canvas);
    canvas = fresh;

    _zoneReset(mode);
    canvas.style.cursor = 'crosshair';

    canvas.addEventListener('mousemove', function (e) {
      var rect = canvas.getBoundingClientRect();
      var sx = canvas.width / rect.width;
      var sy = canvas.height / rect.height;
      _zone.mousePt = { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
      _zoneDraw();
    });

    canvas.addEventListener('mouseleave', function () {
      _zone.mousePt = null;
      _zoneDraw();
    });

    canvas.addEventListener('click', function (e) {
      var rect = canvas.getBoundingClientRect();
      var sx = canvas.width / rect.width;
      var sy = canvas.height / rect.height;
      var px = (e.clientX - rect.left) * sx;
      var py = (e.clientY - rect.top) * sy;

      // Polygon: click near first point to close
      if (_zone.mode === 'polygon' && _zoneIsNearFirst(px, py)) {
        _zoneSaveAndMark();
        _zoneUpdateHint();
        _zoneDraw();
        return;
      }

      // Line: auto-complete after 2nd point
      if (_zone.mode === 'line' && _zone.points.length >= 2) return;

      _zone.points.push({ x: px, y: py });

      if (_zone.mode === 'line' && _zone.points.length === 2) {
        _zoneSaveAndMark();
      }

      _zoneUpdateHint();
      _zoneDraw();
    });

    canvas.addEventListener('touchstart', function (e) {
      e.preventDefault();
      var t = e.touches[0];
      var rect = canvas.getBoundingClientRect();
      var sx = canvas.width / rect.width;
      var sy = canvas.height / rect.height;
      var px = (t.clientX - rect.left) * sx;
      var py = (t.clientY - rect.top) * sy;

      if (_zone.mode === 'polygon' && _zoneIsNearFirst(px, py)) {
        _zoneSaveAndMark(); _zoneUpdateHint(); _zoneDraw(); return;
      }
      if (_zone.mode === 'line' && _zone.points.length >= 2) return;
      _zone.points.push({ x: px, y: py });
      if (_zone.mode === 'line' && _zone.points.length === 2) _zoneSaveAndMark();
      _zoneUpdateHint(); _zoneDraw();
    }, { passive: false });

    _zoneDraw();
    _zoneUpdateHint();
  }

  function _zoneLoadSnapshot(cameraId, mode, retryBtn) {
    var canvas = document.getElementById('ca-zone-canvas');
    var loadingEl = document.getElementById('ca-zone-loading');
    var errorEl = document.getElementById('ca-zone-error');
    var errorMsgEl = document.getElementById('ca-zone-error-msg');
    if (!canvas) return;

    if (loadingEl) loadingEl.classList.remove('d-none');
    if (errorEl) errorEl.classList.add('d-none');

    _zoneBindCanvas(mode);

    apiRequest('/api/v1/cameras/' + encodeURIComponent(cameraId) + '/snapshot')
      .then(function (data) {
        if (loadingEl) loadingEl.classList.add('d-none');
        var b64 = data && data.frame_base64;
        if (!b64) { throw new Error('No frame data returned.'); }
        var img = new window.Image();
        img.onload = function () {
          canvas = document.getElementById('ca-zone-canvas');
          if (!canvas) return;
          // Resize canvas to image dimensions
          canvas.width = img.naturalWidth || 640;
          canvas.height = img.naturalHeight || 360;
          _zone.imgEl = img;
          _zone.imgW = canvas.width;
          _zone.imgH = canvas.height;
          _zoneDraw();
        };
        img.onerror = function () {
          if (loadingEl) loadingEl.classList.add('d-none');
          if (errorEl) errorEl.classList.remove('d-none');
          if (errorMsgEl) errorMsgEl.textContent = 'Could not render camera frame.';
        };
        img.src = 'data:image/jpeg;base64,' + b64;
      })
      .catch(function (err) {
        if (loadingEl) loadingEl.classList.add('d-none');
        if (errorEl) errorEl.classList.remove('d-none');
        if (errorMsgEl) errorMsgEl.textContent = (err && err.message) || 'Failed to load camera frame.';
      });
  }

  // ---------------------------------------------------------------------------
  // Create Agent Modal
  // ---------------------------------------------------------------------------

  function bindCreateAgentModal() {
    var openBtn  = document.getElementById('vision-agents-create-btn');
    var modalEl  = document.getElementById('vision-create-agent-modal');
    if (!openBtn || !modalEl) return;

    // ── local state ──────────────────────────────────────────────────────────
    var currentStep   = 1;
    var selectedRuleId = null;
    var ruleMeta      = null;   // RULE_META entry for selectedRuleId
    var totalSteps    = 2;      // updated when zone rule selected

    // ── refs ─────────────────────────────────────────────────────────────────
    function el(id) { return document.getElementById(id); }

    // ── helpers ──────────────────────────────────────────────────────────────

    function toISOUTC(dtLocalValue) {
      // datetime-local gives "YYYY-MM-DDTHH:MM" — treat as UTC
      if (!dtLocalValue) return null;
      var v = dtLocalValue.trim();
      if (v.length === 16) v += ':00';
      if (!v.endsWith('Z') && !v.includes('+')) v += '+00:00';
      return v;
    }

    function showError(msg) {
      var alertEl = el('ca-error-alert');
      var msgEl   = el('ca-error-msg');
      if (!alertEl || !msgEl) return;
      msgEl.textContent = msg || 'An error occurred.';
      alertEl.classList.remove('d-none');
    }

    function hideError() {
      var alertEl = el('ca-error-alert');
      if (alertEl) alertEl.classList.add('d-none');
    }

    function updateStepPills(step) {
      var p1 = el('ca-pill-1'), p2 = el('ca-pill-2'), p3 = el('ca-pill-3');
      var sep = el('ca-pill-sep-3');
      var activeCls = 'bg-primary', idleCls = 'bg-secondary';
      if (!p1) return;
      p1.className = p1.className.replace(activeCls, idleCls).replace(idleCls, idleCls);
      p2.className = p2.className.replace(activeCls, idleCls).replace(idleCls, idleCls);
      if (p3) p3.className = p3.className.replace(activeCls, idleCls).replace(idleCls, idleCls);

      var active = step === 1 ? p1 : step === 2 ? p2 : p3;
      if (active) {
        active.className = active.className.replace(idleCls, activeCls);
      }

      // Show/hide step 3 pill
      if (totalSteps === 3) {
        if (p3) p3.style.display = '';
        if (sep) sep.style.display = '';
      } else {
        if (p3) p3.style.display = 'none';
        if (sep) sep.style.display = 'none';
      }
    }

    function showStep(step) {
      currentStep = step;
      ['ca-step-1-content', 'ca-step-2-content', 'ca-step-3-content'].forEach(function (id, idx) {
        var d = el(id);
        if (d) d.classList.toggle('d-none', idx + 1 !== step);
      });

      var backBtn   = el('ca-back-btn');
      var cancelBtn = el('ca-cancel-btn');
      var nextBtn   = el('ca-next-btn');
      var zoneBtn   = el('ca-zone-btn');
      var createBtn = el('ca-create-btn');

      // Reset footer buttons visibility
      if (backBtn)   backBtn.classList.toggle('d-none', step === 1);
      if (cancelBtn) cancelBtn.classList.toggle('d-none', false);
      if (nextBtn)   nextBtn.classList.toggle('d-none', step !== 1);
      if (zoneBtn)   zoneBtn.classList.toggle('d-none', !(step === 2 && totalSteps === 3));
      if (createBtn) createBtn.classList.toggle('d-none', !(step === 2 && totalSteps === 2) && !(step === 3));

      updateStepPills(step);

      // Step-specific init
      if (step === 1) {
        if (nextBtn) nextBtn.disabled = !selectedRuleId;
      }
      if (step === 2) {
        loadCamerasIfNeeded();
        validateStep2Fields();
      }
      if (step === 3) {
        var camId = el('ca-camera') && el('ca-camera').value;
        if (camId && ruleMeta) {
          // Show zone indicator as not-saved until user draws
          var ind = el('ca-zone-saved-indicator');
          if (ind) ind.classList.add('d-none');
          if (createBtn) createBtn.disabled = true;
          _zoneLoadSnapshot(camId, ruleMeta.zoneType === 'line' ? 'line' : 'polygon',
                            el('ca-zone-retry-btn'));
          if (el('ca-zone-instruction')) {
            el('ca-zone-instruction').textContent =
              ruleMeta.zoneType === 'line'
                ? 'Draw a counting line on the camera frame below.'
                : 'Draw the monitoring zone on the camera frame below.';
          }
          if (el('ca-zone-subinstruction')) {
            el('ca-zone-subinstruction').textContent = ruleMeta.zoneDesc || '';
          }
        }
      }

      hideError();
    }

    // ── Camera loading ────────────────────────────────────────────────────────

    var camerasLoaded = false;

    function loadCamerasIfNeeded() {
      if (camerasLoaded) return;
      var camSel = el('ca-camera');
      if (!camSel) return;
      camSel.innerHTML = '<option value="">— Loading cameras… —</option>';
      apiRequest('/api/v1/cameras/list')
        .then(function (cameras) {
          camerasLoaded = true;
          if (!Array.isArray(cameras) || cameras.length === 0) {
            camSel.innerHTML = '<option value="">No cameras available</option>';
            return;
          }
          camSel.innerHTML = '<option value="">Select camera…</option>';
          cameras.forEach(function (c) {
            var opt = document.createElement('option');
            opt.value = c.id || c.camera_id || '';
            opt.textContent = c.name || c.camera_name || opt.value;
            camSel.appendChild(opt);
          });
        })
        .catch(function () {
          camSel.innerHTML = '<option value="">Failed to load cameras</option>';
        });
    }

    // ── Rule-specific field visibility ────────────────────────────────────────

    function applyRuleFields(rule) {
      if (!rule) return;

      // Class selector
      var classGrp = el('ca-class-group');
      var classSel = el('ca-class');
      if (rule.needsClass && rule.classes && rule.classes.length) {
        classGrp.classList.remove('d-none');
        classSel.innerHTML = '<option value="">Select class…</option>';
        rule.classes.forEach(function (c) {
          var opt = document.createElement('option');
          opt.value = c;
          opt.textContent = c.charAt(0).toUpperCase() + c.slice(1);
          classSel.appendChild(opt);
        });
      } else {
        classGrp.classList.add('d-none');
      }

      // Fixed class (hidden input via rule.fixedClass — set on submit)
      var watchGrp = el('ca-watch-names-group');
      if (watchGrp) watchGrp.classList.toggle('d-none', !rule.needsWatchNames);

      var idleGrp = el('ca-idle-threshold-group');
      if (idleGrp) idleGrp.classList.toggle('d-none', !rule.needsIdleThreshold);

      var absenceGrp = el('ca-absence-threshold-group');
      if (absenceGrp) absenceGrp.classList.toggle('d-none', !rule.needsAbsenceThreshold);
    }

    // ── Step 2 validation ─────────────────────────────────────────────────────

    function validateStep2Fields() {
      if (!ruleMeta) return;
      var ok = true;

      var camVal = el('ca-camera') && el('ca-camera').value;
      if (!camVal) ok = false;

      if (ruleMeta.needsClass) {
        var cv = el('ca-class') && el('ca-class').value;
        if (!cv) ok = false;
      }
      if (ruleMeta.needsWatchNames) {
        var wv = el('ca-watch-names') && el('ca-watch-names').value.trim();
        if (!wv) ok = false;
      }
      if (ruleMeta.needsIdleThreshold) {
        var iv = el('ca-idle-threshold') && parseFloat(el('ca-idle-threshold').value);
        if (!iv || iv < 1) ok = false;
      }
      if (ruleMeta.needsAbsenceThreshold) {
        var av = el('ca-absence-threshold') && parseFloat(el('ca-absence-threshold').value);
        if (!av || av < 1) ok = false;
      }

      var st = el('ca-start-time') && el('ca-start-time').value;
      var et = el('ca-end-time') && el('ca-end-time').value;
      if (!st || !et) ok = false;

      var isPatrol = document.querySelector('input[name="ca-run-mode"]:checked');
      if (isPatrol && isPatrol.value === 'patrol') {
        var im = el('ca-interval-minutes') && parseFloat(el('ca-interval-minutes').value);
        var cd = el('ca-check-duration') && parseFloat(el('ca-check-duration').value);
        if (!im || im < 1 || !cd || cd < 1) ok = false;
      }

      // Enable/disable the correct button
      var zoneBtn   = el('ca-zone-btn');
      var createBtn = el('ca-create-btn');
      if (totalSteps === 3) {
        if (zoneBtn) zoneBtn.disabled = !ok;
      } else {
        if (createBtn) createBtn.disabled = !ok;
      }
    }

    // ── Build request body ────────────────────────────────────────────────────

    function buildRequestBody() {
      var runMode = document.querySelector('input[name="ca-run-mode"]:checked');
      runMode = runMode ? runMode.value : 'continuous';

      var body = {
        rule_id:    selectedRuleId,
        name:       (el('ca-name') && el('ca-name').value.trim()) || null,
        camera_id:  el('ca-camera') && el('ca-camera').value || null,
        run_mode:   runMode,
        start_time: toISOUTC(el('ca-start-time') && el('ca-start-time').value),
        end_time:   toISOUTC(el('ca-end-time') && el('ca-end-time').value)
      };

      if (ruleMeta.needsClass) {
        body.detect_class = el('ca-class') && el('ca-class').value || null;
      } else if (ruleMeta.fixedClass) {
        body.detect_class = ruleMeta.fixedClass;
      }

      if (ruleMeta.needsWatchNames) {
        var raw = el('ca-watch-names') && el('ca-watch-names').value || '';
        body.watch_names = raw.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      }
      if (ruleMeta.needsIdleThreshold) {
        body.idle_threshold_minutes = parseFloat(el('ca-idle-threshold').value) || null;
      }
      if (ruleMeta.needsAbsenceThreshold) {
        body.absence_threshold_minutes = parseFloat(el('ca-absence-threshold').value) || null;
      }
      if (runMode === 'patrol') {
        body.interval_minutes     = parseFloat(el('ca-interval-minutes').value) || null;
        body.check_duration_seconds = parseFloat(el('ca-check-duration').value) || null;
      }

      // Zone
      if (ruleMeta.needsZone && _zone.savedCoords && _zone.savedCoords.length) {
        body.zone = { type: _zone.savedType, coordinates: _zone.savedCoords };
      }

      return body;
    }

    // ── Submit ────────────────────────────────────────────────────────────────

    function submitCreateAgent() {
      hideError();
      var createBtn = el('ca-create-btn');
      var spinner   = el('ca-create-spinner');
      var textEl    = el('ca-create-text');
      if (createBtn) createBtn.disabled = true;
      if (spinner) spinner.classList.remove('d-none');
      if (textEl) textEl.textContent = 'Creating…';

      var body = buildRequestBody();

      apiRequest('/api/v1/agents/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(function () {
          // Close modal and reload
          if (typeof bootstrap !== 'undefined') {
            var modal = bootstrap.Modal.getInstance(modalEl);
            if (modal) modal.hide();
          }
          if (typeof window.VisionToast !== 'undefined' && window.VisionToast.success) {
            window.VisionToast.success('Agent created successfully.');
          }
          setTimeout(loadAgents, 600);
        })
        .catch(function (err) {
          if (createBtn) createBtn.disabled = false;
          if (spinner) spinner.classList.add('d-none');
          if (textEl) textEl.textContent = 'Create Agent';
          showError((err && err.message) || 'Failed to create agent. Please try again.');
        });
    }

    // ── Rule card rendering ───────────────────────────────────────────────────

    function renderRuleCards() {
      var grid = el('ca-rule-grid');
      if (!grid) return;
      var html = '';
      RULE_META.forEach(function (rule) {
        html +=
          '<div class="col-6 col-sm-4 col-md-3">' +
          '<div class="ca-rule-card h-100" data-rule-id="' + escapeHtml(rule.id) + '">' +
          '<div class="ca-rule-icon mb-1">' + rule.icon + '</div>' +
          '<div class="ca-rule-name">' + escapeHtml(rule.name) + '</div>' +
          '<div class="ca-rule-desc mt-1">' + escapeHtml(rule.desc) + '</div>' +
          '</div></div>';
      });
      grid.innerHTML = html;

      grid.querySelectorAll('.ca-rule-card').forEach(function (card) {
        card.addEventListener('click', function () {
          grid.querySelectorAll('.ca-rule-card').forEach(function (c) { c.classList.remove('selected'); });
          card.classList.add('selected');
          selectedRuleId = card.getAttribute('data-rule-id');
          ruleMeta = RULE_META.find(function (r) { return r.id === selectedRuleId; }) || null;
          totalSteps = (ruleMeta && ruleMeta.needsZone) ? 3 : 2;
          var nextBtn = el('ca-next-btn');
          if (nextBtn) nextBtn.disabled = false;
        });
      });
    }

    // ── Full reset (on modal open / close) ────────────────────────────────────

    function resetModal() {
      currentStep    = 1;
      selectedRuleId = null;
      ruleMeta       = null;
      totalSteps     = 2;
      camerasLoaded  = false;
      _zoneReset('polygon');

      // Clear fields
      ['ca-name', 'ca-watch-names', 'ca-idle-threshold', 'ca-absence-threshold',
       'ca-interval-minutes', 'ca-check-duration'].forEach(function (id) {
        var f = el(id); if (f) f.value = '';
      });
      var startEl = el('ca-start-time'), endEl = el('ca-end-time');
      if (startEl) startEl.value = '';
      if (endEl) endEl.value = '';
      var contRadio = el('ca-run-continuous');
      if (contRadio) contRadio.checked = true;
      var patrolGrp = el('ca-patrol-group');
      if (patrolGrp) patrolGrp.classList.add('d-none');

      // Deselect all rule cards
      var grid = el('ca-rule-grid');
      if (grid) grid.querySelectorAll('.ca-rule-card').forEach(function (c) { c.classList.remove('selected'); });

      hideError();
      updateStepPills(1);
    }

    // ── Wire up: open button ──────────────────────────────────────────────────

    openBtn.addEventListener('click', function () {
      resetModal();
      renderRuleCards();
      showStep(1);
      if (typeof bootstrap !== 'undefined') {
        bootstrap.Modal.getOrCreateInstance(modalEl).show();
      }
    });

    // ── Wire up: close / cancel ───────────────────────────────────────────────

    function closeModal() {
      if (typeof bootstrap !== 'undefined') {
        var m = bootstrap.Modal.getInstance(modalEl);
        if (m) m.hide();
      }
    }

    var closeBtn  = el('ca-close-btn');
    var cancelBtn = el('ca-cancel-btn');
    if (closeBtn)  closeBtn.addEventListener('click', closeModal);
    if (cancelBtn) cancelBtn.addEventListener('click', closeModal);

    // ── Wire up: step navigation ──────────────────────────────────────────────

    var nextBtn = el('ca-next-btn');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        if (currentStep === 1 && selectedRuleId) {
          // Populate step 2
          var chip  = el('ca-selected-rule-chip');
          var icon  = el('ca-chip-icon');
          var name  = el('ca-chip-name');
          var desc  = el('ca-chip-desc');
          var title = el('ca-modal-title');
          if (chip && ruleMeta) {
            if (icon) icon.textContent = ruleMeta.icon;
            if (name) name.textContent = ruleMeta.name;
            if (desc) desc.textContent = ruleMeta.desc;
          }
          if (title) title.textContent = 'Configure Agent';
          applyRuleFields(ruleMeta);
          showStep(2);
        }
      });
    }

    var backBtn = el('ca-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        if (currentStep === 2) {
          var title = el('ca-modal-title');
          if (title) title.textContent = 'Create Agent';
          showStep(1);
        } else if (currentStep === 3) {
          var title2 = el('ca-modal-title');
          if (title2) title2.textContent = 'Configure Agent';
          showStep(2);
        }
      });
    }

    var zoneBtn = el('ca-zone-btn');
    if (zoneBtn) {
      zoneBtn.addEventListener('click', function () {
        if (currentStep === 2) {
          var title = el('ca-modal-title');
          if (title) title.textContent = 'Draw Zone';
          showStep(3);
        }
      });
    }

    // ── Wire up: create button ────────────────────────────────────────────────

    var createBtn = el('ca-create-btn');
    if (createBtn) createBtn.addEventListener('click', submitCreateAgent);

    // ── Wire up: "Change rule" chip button ────────────────────────────────────

    var changeRuleBtn = el('ca-change-rule-btn');
    if (changeRuleBtn) {
      changeRuleBtn.addEventListener('click', function () {
        var title = el('ca-modal-title');
        if (title) title.textContent = 'Create Agent';
        showStep(1);
      });
    }

    // ── Wire up: run mode toggle ──────────────────────────────────────────────

    modalEl.querySelectorAll('input[name="ca-run-mode"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        var patrolGrp = el('ca-patrol-group');
        if (patrolGrp) patrolGrp.classList.toggle('d-none', radio.value !== 'patrol');
        validateStep2Fields();
      });
    });

    // ── Wire up: step 2 field change → live validate ──────────────────────────

    ['ca-camera', 'ca-class', 'ca-watch-names', 'ca-idle-threshold',
     'ca-absence-threshold', 'ca-start-time', 'ca-end-time',
     'ca-interval-minutes', 'ca-check-duration'].forEach(function (id) {
      var f = el(id);
      if (f) f.addEventListener('change', validateStep2Fields);
      if (f && f.tagName === 'INPUT') f.addEventListener('input', validateStep2Fields);
    });

    // ── Wire up: zone undo / clear / retry ───────────────────────────────────

    var undoBtn = el('ca-zone-undo-btn');
    if (undoBtn) {
      undoBtn.addEventListener('click', function () {
        if (_zone.points.length > 0) {
          _zone.points.pop();
          _zone.savedCoords = null;
          _zone.savedType = null;
          var ind = el('ca-zone-saved-indicator');
          if (ind) ind.classList.add('d-none');
          var cb = el('ca-create-btn');
          if (cb) cb.disabled = true;
          _zoneDraw();
          _zoneUpdateHint();
        }
      });
    }

    var clearBtn = el('ca-zone-clear-btn');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        _zone.points = [];
        _zone.savedCoords = null;
        _zone.savedType = null;
        var ind = el('ca-zone-saved-indicator');
        if (ind) ind.classList.add('d-none');
        var cb = el('ca-create-btn');
        if (cb) cb.disabled = true;
        _zoneDraw();
        _zoneUpdateHint();
      });
    }

    var retryBtn = el('ca-zone-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', function () {
        var camId = el('ca-camera') && el('ca-camera').value;
        if (camId && ruleMeta) {
          _zoneLoadSnapshot(camId, ruleMeta.zoneType === 'line' ? 'line' : 'polygon', retryBtn);
        }
      });
    }

    // ── Wire up: error dismiss ────────────────────────────────────────────────

    var dismissBtn = el('ca-error-dismiss');
    if (dismissBtn) dismissBtn.addEventListener('click', hideError);

    // ── Wire up: "Save Zone" (polygon close via button when ≥3 pts) ───────────
    // The user closes the polygon by clicking the first point, but we also allow
    // them to close it by pressing the Create Agent button. So on step 3, if zone
    // is not yet saved but is closeable, we auto-save on Create click.
    // (handled inside submitCreateAgent → buildRequestBody checks _zone.savedCoords)

    // ── Auto-close polygon when Create Agent is clicked on step 3 ─────────────
    if (createBtn) {
      createBtn.addEventListener('click', function () {
        // If on step 3, polygon not yet saved but has ≥3 pts → auto-close
        if (currentStep === 3 && !_zone.savedCoords && _zone.mode === 'polygon' && _zone.points.length >= 3) {
          _zoneSaveAndMark();
        }
      }, true); // capture phase so it runs before submitCreateAgent
    }

  } // end bindCreateAgentModal

  function boot() {
    var grid = document.getElementById('vision-agents-board-grid');
    if (!grid) return;
    searchBound  = false;
    filtersBound = false;
    bindSearchOnce();
    bindFilters();
    bindCreateAgentModal();
    loadAgents();
  }

  boot();
  document.addEventListener('DOMContentLoaded', boot);
  window.addEventListener('vision:spa:navigated', boot);
})();
