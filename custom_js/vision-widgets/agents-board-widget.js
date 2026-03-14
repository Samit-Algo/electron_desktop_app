/**
 * VisionAgentsBoardWidget - Reusable agents board component.
 * Use anywhere: agents-board.html, camera-detail.html, etc.
 *
 * Usage:
 *   const widget = VisionAgentsBoardWidget.mount('#my-container', {
 *     cameraId: 'cam-1',       // Filter to this camera only (uses listAgentsByCamera)
 *     statusFilter: '',        // Monitoring | Scheduled | etc. or '' for all
 *     ruleTypeFilter: '',       // Rule type filter
 *     compact: false,           // Compact card layout
 *     showCreateButton: false,  // Show Create Agent button (only on full agents-board)
 *     showFilters: true
 *   });
 *   widget.refresh();
 *   widget.setFilters({ cameraId: 'cam-2' });
 *   widget.destroy();
 */
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else {
    root.VisionAgentsBoardWidget = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var STATUS = {
    MONITORING: 'Monitoring',
    SCHEDULED: 'Scheduled',
    SLEEPING: 'Sleeping',
    PAUSED: 'Paused',
    COMPLETED: 'Completed',
    INACTIVE: 'Inactive',
    ERROR: 'Error'
  };

  function normalizeStatus(raw) {
    if (!raw) return '';
    var map = {
      'RUNNING': STATUS.MONITORING, 'running': STATUS.MONITORING,
      'ACTIVE': STATUS.MONITORING, 'active': STATUS.MONITORING,
      'PENDING': STATUS.SCHEDULED, 'pending': STATUS.SCHEDULED,
      'scheduled': STATUS.SCHEDULED, 'SCHEDULED': STATUS.SCHEDULED,
      'completed': STATUS.COMPLETED, 'COMPLETED': STATUS.COMPLETED,
      'cancelled': STATUS.INACTIVE, 'CANCELLED': STATUS.INACTIVE
    };
    return map[raw] || raw;
  }

  function getStatusDisplay(rawStatus) {
    var s = normalizeStatus(rawStatus);
    var tbl = {
      'Monitoring': { icon: '🟢', label: 'Monitoring', badgeClass: 'agent-status-monitoring' },
      'Scheduled': { icon: '🕐', label: 'Scheduled', badgeClass: 'agent-status-scheduled' },
      'Sleeping': { icon: '🌙', label: 'Sleeping', badgeClass: 'agent-status-sleeping' },
      'Paused': { icon: '⏸', label: 'Paused', badgeClass: 'agent-status-paused' },
      'Completed': { icon: '✅', label: 'Completed', badgeClass: 'agent-status-completed' },
      'Inactive': { icon: '⚫', label: 'Inactive', badgeClass: 'agent-status-inactive' },
      'Error': { icon: '🔴', label: 'Error', badgeClass: 'agent-status-error' }
    };
    return tbl[s] || { icon: '', label: rawStatus || '—', badgeClass: 'agent-status-default' };
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
    return String(model).replace(/\.(pt|onnx)$/i, '').replace(/^\w/, function (c) { return c.toUpperCase(); });
  }

  function formatDuration(startTime, endTime) {
    if (!startTime || !endTime) return null;
    var start = new Date(startTime).getTime();
    var end = new Date(endTime).getTime();
    if (isNaN(start) || isNaN(end) || end <= start) return null;
    var ms = end - start, sec = Math.floor(ms / 1000), min = Math.floor(sec / 60), hour = Math.floor(min / 60);
    if (hour >= 1) return hour === 1 ? '1h' : hour + 'h';
    if (min >= 1) return min === 1 ? '1 min' : min + ' min';
    return sec <= 0 ? null : (sec + 's');
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function buildDetailUrl(agentId, opts) {
    var params = new URLSearchParams(window.location.search);
    params.set('agent', agentId);
    if (opts && opts.cameraId) params.set('camera', opts.cameraId);
    return 'agent-detail.html?' + params.toString();
  }

  function createWidget(containerEl, options) {
    var opts = options || {};
    var state = {
      cameraId: opts.cameraId || null,
      statusFilter: opts.statusFilter || '',
      ruleTypeFilter: opts.ruleTypeFilter || '',
      compact: !!opts.compact,
      showCreateButton: !!opts.showCreateButton,
      showFilters: opts.showFilters !== false,
      agents: [],
      container: containerEl,
      isMounted: true
    };

    var uniqueId = 'vision-agents-widget-' + Math.random().toString(36).slice(2, 9);
    var gridId = uniqueId + '-grid';
    var countId = uniqueId + '-count';

    function filterAgents(agents) {
      var out = agents.slice();
      if (state.cameraId) {
        out = out.filter(function (a) { return (a.camera_id || '') === state.cameraId; });
      }
      if (state.statusFilter) {
        var st = state.statusFilter.toLowerCase();
        out = out.filter(function (a) { return normalizeStatus(a.status).toLowerCase() === st; });
      }
      if (state.ruleTypeFilter) {
        out = out.filter(function (a) { return getRuleGroupLabel(a) === state.ruleTypeFilter; });
      }
      return out;
    }

    function buildCardHtml(agent) {
      var statusInfo = getStatusDisplay(agent.status);
      var durationStr = formatDuration(agent.start_time, agent.end_time);
      var chips = [];
      if (agent.run_mode) chips.push('<span class="agent-chip">' + escapeHtml(agent.run_mode) + '</span>');
      if (agent.fps != null) chips.push('<span class="agent-chip">' + escapeHtml(agent.fps) + ' FPS</span>');
      chips.push('<span class="agent-chip">' + escapeHtml(formatModel(agent.model)) + '</span>');
      if (durationStr) chips.push('<span class="agent-chip">' + escapeHtml(durationStr) + '</span>');
      var chipsHtml = chips.join(' ');
      var cameraLine = agent.camera_id ? ('Camera: ' + escapeHtml(agent.camera_name || agent.camera_id)) : (agent.video_path ? 'Video file' : '—');
      var ruleText = getRuleDisplayText(agent);
      var detailUrl = buildDetailUrl(agent.id, { cameraId: state.cameraId });

      return (
        '<div class="col-12 col-sm-6 col-xl-4">' +
        '<div class="card agent-card agent-insight-card h-100" data-agent-id="' + escapeHtml(agent.id || '') + '" data-agent-card>' +
        '  <div class="card-body">' +
        '    <div class="d-flex align-items-start justify-content-between gap-2">' +
        '      <div class="flex-grow-1 min-w-0">' +
        '        <div class="agent-card-row-1">' +
        '          <h6 class="agent-card-name mb-0 text-truncate">' + escapeHtml(agent.name || 'Unnamed') + '</h6>' +
        '          <span class="badge agent-status-badge ' + statusInfo.badgeClass + '">' + statusInfo.icon + ' ' + escapeHtml(statusInfo.label) + '</span>' +
        '        </div>' +
        '        <p class="agent-card-camera small text-body-tertiary mb-1 mt-1">' + cameraLine + '</p>' +
        '        <div class="agent-card-chips mb-1">' + chipsHtml + '</div>' +
        '        <p class="agent-card-rule small text-body-secondary mb-0">Rule: ' + escapeHtml(ruleText) + '</p>' +
        '        <a href="' + escapeHtml(detailUrl) + '" class="agent-view-details small text-primary text-decoration-none mt-1 d-inline-block">View details →</a>' +
        '      </div>' +
        '    </div>' +
        '  </div>' +
        '</div>' +
        '</div>'
      );
    }

    function renderAgents(agents) {
      var filtered = filterAgents(agents);
      var countEl = state.container.querySelector('#' + countId);
      if (countEl) countEl.textContent = String(filtered.length);

      var grid = state.container.querySelector('#' + gridId);
      if (!grid) return;

      if (filtered.length === 0) {
        grid.innerHTML = '<div class="col-12"><p class="text-body-tertiary mb-0">No agents found' +
          (state.cameraId ? ' for this camera.' : '.') + '</p></div>';
        return;
      }

      var groups = {};
      filtered.forEach(function (a) {
        var key = getRuleGroupLabel(a);
        if (!groups[key]) groups[key] = [];
        groups[key].push(a);
      });
      var groupOrder = Object.keys(groups).sort();
      var html = [];
      groupOrder.forEach(function (groupLabel) {
        var sectionIcon = groupLabel.indexOf('Person') >= 0 ? '👤' : groupLabel.indexOf('Weapon') >= 0 ? '🔫' : groupLabel.indexOf('Restricted') >= 0 ? '🚧' : '🤖';
        html.push('<div class="col-12 agents-group-header mt-2 mb-1"><span class="agents-group-title">' + sectionIcon + ' ' + escapeHtml(groupLabel) + ' <span class="agents-group-count">(' + groups[groupLabel].length + ')</span></span></div>');
        groups[groupLabel].forEach(function (agent) {
          html.push(buildCardHtml(agent));
        });
      });
      grid.innerHTML = html.join('');
      bindCardClicks(grid);
    }

    function bindCardClicks(grid) {
      if (!grid) return;
      grid.querySelectorAll('[data-agent-card]').forEach(function (card) {
        card.addEventListener('click', function (e) {
          if (e.target.closest('a')) return;
          var id = card.getAttribute('data-agent-id');
          if (!id) return;
          e.preventDefault();
          var href = buildDetailUrl(id, { cameraId: state.cameraId });
          if (window.visionaiSpa && typeof window.visionaiSpa.navigate === 'function') {
            window.visionaiSpa.navigate(href).catch(function () { window.location.href = href; });
          } else {
            window.location.href = href;
          }
        });
      });
    }

    function refresh() {
      if (!state.isMounted || !state.container) return Promise.resolve();
      var grid = state.container.querySelector('#' + gridId);
      if (grid) grid.innerHTML = '<div class="col-12"><p class="text-body-tertiary mb-0">Loading…</p></div>';

      if (!window.visionAPI) {
        if (grid) grid.innerHTML = '<div class="col-12"><p class="text-body-tertiary mb-0">API not available.</p></div>';
        return Promise.resolve();
      }
      if (typeof window.visionAPI.isAuthenticated === 'function' && !window.visionAPI.isAuthenticated()) {
        if (grid) grid.innerHTML = '<div class="col-12"><p class="text-body-tertiary mb-0">Login required.</p></div>';
        return Promise.resolve();
      }

      var promise;
      if (state.cameraId && typeof window.visionAPI.listAgentsByCamera === 'function') {
        promise = window.visionAPI.listAgentsByCamera(state.cameraId);
      } else if (typeof window.visionAPI.request === 'function') {
        promise = window.visionAPI.request('/api/v1/agents/list');
      } else {
        if (grid) grid.innerHTML = '<div class="col-12"><p class="text-body-tertiary mb-0">API not available.</p></div>';
        return Promise.resolve();
      }

      return promise
        .then(function (agents) {
          state.agents = Array.isArray(agents) ? agents : [];
          renderAgents(state.agents);
        })
        .catch(function (err) {
          if (grid) grid.innerHTML = '<div class="col-12"><p class="text-danger mb-0">' + escapeHtml(err.message || 'Failed to load agents') + '</p></div>';
        });
    }

    function renderFilters() {
      if (!state.showFilters) return '';
      var statuses = ['', 'Monitoring', 'Scheduled', 'Sleeping', 'Paused', 'Completed', 'Inactive', 'Error'];
      var opts = statuses.map(function (s) {
        var label = s || 'All statuses';
        var info = s ? getStatusDisplay(s) : { icon: '', label: 'All statuses' };
        return '<option value="' + escapeHtml(s) + '"' + (state.statusFilter === s ? ' selected' : '') + '>' + (info.icon ? info.icon + ' ' : '') + escapeHtml(label) + '</option>';
      }).join('');
      return (
        '<div class="row g-2 mb-3 align-items-center">' +
        '  <div class="col-auto"><label class="form-label small mb-0 text-body-tertiary">Status</label>' +
        '  <select class="form-select form-select-sm vision-agents-status-filter" data-widget="' + uniqueId + '" style="min-width:8rem"><option value="">All statuses</option>' + opts + '</select></div>' +
        '</div>'
      );
    }

    function bindFilters() {
      state.container.querySelectorAll('.vision-agents-status-filter[data-widget="' + uniqueId + '"]').forEach(function (sel) {
        sel.addEventListener('change', function () {
          state.statusFilter = this.value || '';
          renderAgents(state.agents);
        });
      });
    }

    function mount() {
      var title = state.cameraId ? 'Agents for this camera' : 'Agents';
      state.container.innerHTML =
        '<div class="vision-agents-widget">' +
        '  <div class="row gx-6 gy-3 mb-2 align-items-center">' +
        '    <div class="col-auto">' +
        '      <h3 class="mb-0 fs-6">' + escapeHtml(title) + '<span class="fw-normal text-body-tertiary ms-2">(<span id="' + countId + '">0</span>)</span></h3>' +
        '    </div>' +
        '  </div>' +
        renderFilters() +
        '  <div class="row g-3 mb-3" id="' + gridId + '">' +
        '    <div class="col-12"><p class="text-body-tertiary mb-0">Loading…</p></div>' +
        '  </div>' +
        '</div>';
      bindFilters();
      refresh();
      return { refresh: refresh, setFilters: setFilters, destroy: destroy };
    }

    function setFilters(filters) {
      if (filters.cameraId !== undefined) state.cameraId = filters.cameraId || null;
      if (filters.statusFilter !== undefined) state.statusFilter = filters.statusFilter || '';
      if (filters.ruleTypeFilter !== undefined) state.ruleTypeFilter = filters.ruleTypeFilter || '';
      renderAgents(state.agents);
    }

    function destroy() {
      state.isMounted = false;
      state.container.innerHTML = '';
    }

    return {
      refresh: refresh,
      setFilters: setFilters,
      destroy: destroy,
      mount: mount,
      _state: function () { return state; }
    };
  }

  return {
    mount: function (container, options) {
      var el = typeof container === 'string' ? document.querySelector(container) : container;
      if (!el) throw new Error('VisionAgentsBoardWidget: container not found');
      return createWidget(el, options).mount();
    },
    create: createWidget
  };
});
