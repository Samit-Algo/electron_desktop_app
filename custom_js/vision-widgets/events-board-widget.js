/**
 * VisionEventsBoardWidget - Reusable events board component.
 * Use anywhere: events-board.html, camera-detail.html, dashboard, etc.
 *
 * Usage:
 *   const widget = VisionEventsBoardWidget.mount('#my-container', {
 *     cameraId: 'cam-1',      // Filter to this camera only (optional)
 *     severityFilter: 'all',  // all | Critical | Warning | Info | Resolved
 *     dateRange: 'all',       // today | yesterday | all
 *     compact: false,         // Compact card layout
 *     maxItems: 50,
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
    root.VisionEventsBoardWidget = factory();
  }
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  function escapeHtml(s) {
    return String(s || '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function inferSeverity(label) {
    const t = String(label || '').toLowerCase();
    if (t.includes('weapon') || t.includes('fire') || t.includes('fall') || t.includes('intrusion')) return 'Critical';
    if (t.includes('violation') || t.includes('restricted') || t.includes('collision') || t.includes('alert')) return 'Warning';
    return 'Info';
  }

  function severityBadgeClass(sev) {
    if (sev === 'Critical') return 'badge-phoenix-danger';
    if (sev === 'Warning') return 'badge-phoenix-warning';
    return 'badge-phoenix-info';
  }

  function timeAgo(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (!Number.isFinite(d.getTime())) return '';
    const diff = Math.max(0, Date.now() - d.getTime());
    const sec = Math.floor(diff / 1000);
    if (sec < 60) return sec + 's';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h';
    return Math.floor(hr / 24) + 'd';
  }

  function buildEventDetailUrl(ev) {
    const params = new URLSearchParams();
    if (ev.eventId) params.set('event_id', ev.eventId);
    if (ev.event_id) params.set('event_id', ev.event_id);
    return 'event-detail.html?' + params.toString();
  }

  var PAGE_SIZE = 20;

  function createWidget(containerEl, options) {
    const opts = options || {};
    let state = {
      cameraId: opts.cameraId || null,
      severityFilter: opts.severityFilter || 'all',
      dateRange: opts.dateRange || 'all',
      compact: !!opts.compact,
      maxItems: opts.maxItems || 50,
      showFilters: opts.showFilters !== false,
      showHeader: opts.showHeader !== false,
      layout: opts.layout || 'grid',
      events: [],
      currentSkip: 0,
      totalEvents: 0,
      isLoadingMore: false,
      imageCache: new Map(),
      container: containerEl,
      isMounted: true
    };

    const uniqueId = 'vision-events-widget-' + Math.random().toString(36).slice(2, 9);
    const gridId = uniqueId + '-grid';
    const countId = uniqueId + '-count';
    const rangeId = uniqueId + '-range';
    const severityId = uniqueId + '-severity';

    function renderFilters() {
      if (!state.showFilters) return '';
      return `
        <div class="row justify-content-between align-items-end mb-3 g-2">
          <div class="col-12 col-sm-auto">
            <ul class="nav nav-links mx-n2 vision-events-severity-tabs" data-widget="${uniqueId}">
              <li class="nav-item"><a class="nav-link px-2 py-1 active" data-severity="all" href="#">All</a></li>
              <li class="nav-item"><a class="nav-link px-2 py-1" data-severity="Critical" href="#">Critical</a></li>
              <li class="nav-item"><a class="nav-link px-2 py-1" data-severity="Warning" href="#">Warning</a></li>
              <li class="nav-item"><a class="nav-link px-2 py-1" data-severity="Info" href="#">Info</a></li>
              <li class="nav-item"><a class="nav-link px-2 py-1" data-severity="Resolved" href="#">Resolved</a></li>
            </ul>
          </div>
          <div class="col-12 col-sm-auto">
            <select class="form-select form-select-sm" id="${rangeId}" style="width: auto;">
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="all" ${state.dateRange === 'all' ? 'selected' : ''}>All</option>
            </select>
          </div>
        </div>
      `;
    }

    function filterEvents(events) {
      let out = events.slice();
      if (state.cameraId) {
        out = out.filter(function (e) {
          const cid = (e.camera_id || e.cameraId || '').toString();
          return cid === state.cameraId;
        });
      }
      if (state.severityFilter && state.severityFilter !== 'all') {
        out = out.filter(function (e) { return (e.severity || inferSeverity(e.label)) === state.severityFilter; });
      }
      return out.slice(0, state.maxItems);
    }

    function renderLoadMoreButton() {
      var loadMoreId = uniqueId + '-load-more';
      var existing = state.container.querySelector('#' + loadMoreId);
      var hasMore = state.events.length < state.totalEvents;
      if (!hasMore) {
        if (existing) existing.remove();
        return;
      }
      if (existing) return; // already rendered
      var btn = document.createElement('div');
      btn.id = loadMoreId;
      btn.className = state.layout === 'horizontal' ? 'vision-events-load-more-horizontal' : 'col-12 text-center mt-2';
      btn.innerHTML = '<button class="btn btn-phoenix-secondary btn-sm vision-events-load-more-btn" type="button">Load more</button>';
      btn.querySelector('button').addEventListener('click', function () { loadMore(); });
      var grid = state.container.querySelector('#' + gridId);
      if (grid && grid.parentNode) grid.parentNode.insertBefore(btn, grid.nextSibling);
    }

    function loadMore() {
      if (state.isLoadingMore || !state.isMounted) return;
      state.isLoadingMore = true;
      var btn = state.container.querySelector('.vision-events-load-more-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
      var nextSkip = state.currentSkip + PAGE_SIZE;
      var callApi = function (withCamera) {
        return window.visionAPI.listEvents(state.dateRange || 'all', PAGE_SIZE, nextSkip, withCamera ? state.cameraId : null);
      };
      callApi(true).catch(function () { return callApi(false); })
        .then(function (res) {
          var items = Array.isArray(res && res.items) ? res.items : [];
          var newEvents = items.map(function (it) {
            return {
              event_id: it.id, eventId: it.id,
              label: it.label || 'Event',
              timestamp: it.event_ts || it.received_at,
              event_ts: it.event_ts || it.received_at,
              received_at: it.received_at,
              camera_id: (it.camera_id || '').toString(),
              cameraId: (it.camera_id || '').toString(),
              agent_name: it.agent_name, agentName: it.agent_name,
              severity: inferSeverity(it.label),
              thumbDataUrl: null, thumbObjectUrl: null
            };
          });
          if (state.cameraId) {
            newEvents = newEvents.filter(function (e) {
              return (e.camera_id || e.cameraId || '') === state.cameraId;
            });
          }
          state.currentSkip = nextSkip;
          state.events = state.events.concat(newEvents);
          return Promise.all(newEvents.map(ensureEventImage)).then(function () { return newEvents; });
        })
        .then(function (newEvents) {
          appendEvents(newEvents);
          var loadMoreEl = state.container.querySelector('#' + uniqueId + '-load-more');
          if (loadMoreEl) loadMoreEl.remove();
          renderLoadMoreButton();
        })
        .catch(function () {
          if (btn) { btn.disabled = false; btn.textContent = 'Load more'; }
        })
        .finally(function () { state.isLoadingMore = false; });
    }

    function appendEvents(newEvents) {
      var grid = state.container.querySelector('#' + gridId);
      if (!grid) return;
      var filtered = newEvents.filter(function (ev) {
        if (state.severityFilter && state.severityFilter !== 'all') {
          return (ev.severity || inferSeverity(ev.label)) === state.severityFilter;
        }
        return true;
      });
      var height = state.compact ? '170px' : '236px';
      var padding = state.compact ? 'p-3' : 'p-4';
      var isHorizontal = state.layout === 'horizontal';
      var cardStyle = isHorizontal ? 'width: 100%; height: ' + height + '; min-width: 0;' : '';
      var colClass = isHorizontal ? '' : 'col-12 col-sm-6 col-md-4 col-xxl-3';
      var html = filtered.map(function (ev) {
        var sev = ev.severity || inferSeverity(ev.label);
        var badgeCls = severityBadgeClass(sev);
        var ago = timeAgo(ev.event_ts || ev.received_at || ev.timestamp);
        var cam = escapeHtml(ev.camera_id || ev.cameraId || '');
        var href = buildEventDetailUrl(ev);
        var thumb = ev.thumb_object_url || ev.thumbObjectUrl || ev.thumb_data_url || ev.thumbDataUrl || null;
        return (
          (colClass ? '<div class="' + colClass + '">' : '') +
          '<div class="btn-reveal-trigger position-relative rounded-2 overflow-hidden ' + padding + '"' + (cardStyle ? ' style="' + cardStyle + '"' : ' style="height: ' + height + ';"') + '>' +
          (thumb ? '<img src="' + escapeHtml(thumb) + '" alt="" class="w-100 h-100 position-absolute top-0 start-0" style="object-fit: cover;">' : '<div class="w-100 h-100 position-absolute top-0 start-0 bg-body-secondary"></div>') +
          '<div class="w-100 h-100 position-absolute top-0 start-0" style="background: linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%);"></div>' +
          '<div class="position-relative h-100 d-flex flex-column justify-content-between">' +
          '<div class="d-flex justify-content-between align-items-center"><span class="badge badge-phoenix fs-10 ' + badgeCls + '" data-bs-theme="light">' + escapeHtml(sev) + '</span></div>' +
          '<div><h' + (state.compact ? '4' : '3') + ' class="text-white fw-bold line-clamp-2 mb-1">' + escapeHtml(ev.label || 'Event') + '</h' + (state.compact ? '4' : '3') + '>' +
          '<p class="text-white text-opacity-75 fs-9 mb-0">' + (cam ? 'Camera ' + cam : 'Camera') + '</p>' +
          '<div class="d-flex align-items-center mt-2"><span class="fa-solid fa-video text-white text-opacity-75 me-2 fs-10"></span>' +
          '<span class="text-white text-opacity-75 fs-9">' + (cam ? 'Camera ' + cam : 'Camera') + '</span>' +
          '<span class="text-white text-opacity-50 mx-2">•</span><span class="text-white text-opacity-75 fs-9">' + (ago || '') + '</span></div></div></div>' +
          '<a class="stretched-link" href="' + escapeHtml(href) + '"></a></div>' +
          (colClass ? '</div>' : '')
        );
      }).join('');
      grid.insertAdjacentHTML('beforeend', html);
    }

    function renderEvents(events) {
      const filtered = filterEvents(events);
      const countEl = state.container.querySelector('#' + countId);
      if (countEl) countEl.textContent = String(state.totalEvents || filtered.length);

      const grid = state.container.querySelector('#' + gridId);
      if (!grid) return;

      if (filtered.length === 0) {
        var emptyHtml = state.layout === 'horizontal'
          ? '<div class="vision-events-grid-message"><p class="text-body-tertiary mb-0">No events found' + (state.cameraId ? ' for this camera.' : '.') + '</p></div>'
          : '<div class="col-12"><p class="text-body-tertiary mb-0">No events found' + (state.cameraId ? ' for this camera.' : '.') + '</p></div>';
        grid.innerHTML = emptyHtml;
        return;
      }

      const height = state.compact ? '170px' : '236px';
      const padding = state.compact ? 'p-3' : 'p-4';
      const isHorizontal = state.layout === 'horizontal';
      /* Horizontal: fill responsive CSS grid (see .vision-events-horizontal-grid); avoid fixed 280px + scroll. */
      const cardStyle = isHorizontal ? 'width: 100%; height: ' + height + '; min-width: 0;' : '';
      const colClass = isHorizontal ? '' : 'col-12 col-sm-6 col-md-4 col-xxl-3';
      grid.innerHTML = filtered.map(function (ev) {
        const sev = ev.severity || inferSeverity(ev.label);
        const badgeCls = severityBadgeClass(sev);
        const ago = timeAgo(ev.event_ts || ev.received_at || ev.timestamp);
        const cam = escapeHtml(ev.camera_id || ev.cameraId || '');
        const href = buildEventDetailUrl(ev);
        const thumb = ev.thumb_object_url || ev.thumbObjectUrl || ev.thumb_data_url || ev.thumbDataUrl || null;
        return (
          (colClass ? '<div class="' + colClass + '">' : '') +
          '<div class="btn-reveal-trigger position-relative rounded-2 overflow-hidden ' + padding + '"' + (cardStyle ? ' style="' + cardStyle + '"' : ' style="height: ' + height + ';"') + '>' +
          (thumb ? '<img src="' + escapeHtml(thumb) + '" alt="" class="w-100 h-100 position-absolute top-0 start-0" style="object-fit: cover;">' : '<div class="w-100 h-100 position-absolute top-0 start-0 bg-body-secondary"></div>') +
          '<div class="w-100 h-100 position-absolute top-0 start-0" style="background: linear-gradient(180deg, rgba(0,0,0,0) 35%, rgba(0,0,0,0.55) 100%);"></div>' +
          '<div class="position-relative h-100 d-flex flex-column justify-content-between">' +
          '<div class="d-flex justify-content-between align-items-center"><span class="badge badge-phoenix fs-10 ' + badgeCls + '" data-bs-theme="light">' + escapeHtml(sev) + '</span></div>' +
          '<div><h' + (state.compact ? '4' : '3') + ' class="text-white fw-bold line-clamp-2 mb-1">' + escapeHtml(ev.label || 'Event') + '</h' + (state.compact ? '4' : '3') + '>' +
          '<p class="text-white text-opacity-75 fs-9 mb-0">' + (cam ? 'Camera ' + cam : 'Camera') + '</p>' +
          '<div class="d-flex align-items-center mt-2"><span class="fa-solid fa-video text-white text-opacity-75 me-2 fs-10"></span>' +
          '<span class="text-white text-opacity-75 fs-9">' + (cam ? 'Camera ' + cam : 'Camera') + '</span>' +
          '<span class="text-white text-opacity-50 mx-2">•</span><span class="text-white text-opacity-75 fs-9">' + (ago || '') + '</span></div></div></div>' +
          '<a class="stretched-link" href="' + escapeHtml(href) + '"></a></div>' +
          (colClass ? '</div>' : '')
        );
      }).join('');
      renderLoadMoreButton();
    }

    function ensureEventImage(ev) {
      if (ev.thumbObjectUrl || ev.thumbDataUrl) return Promise.resolve();
      if (!ev.event_id && !ev.eventId) return Promise.resolve();
      if (!window.visionAPI || typeof window.visionAPI.fetchEventImageObjectUrl !== 'function') return Promise.resolve();
      var id = ev.event_id || ev.eventId;
      if (state.imageCache.has(id)) {
        ev.thumbObjectUrl = state.imageCache.get(id);
        return Promise.resolve();
      }
      return window.visionAPI.fetchEventImageObjectUrl(id)
        .then(function (url) {
          state.imageCache.set(id, url);
          ev.thumbObjectUrl = url;
        })
        .catch(function () {});
    }

    function refresh() {
      if (!state.isMounted || !state.container) return Promise.resolve();
      var grid = state.container.querySelector('#' + gridId);
      var loadingHtml = state.layout === 'horizontal'
        ? '<div class="vision-events-grid-message"><p class="text-body-tertiary mb-0">Loading…</p></div>'
        : '<div class="col-12"><p class="text-body-tertiary mb-0">Loading…</p></div>';
      if (grid) grid.innerHTML = loadingHtml;

      if (!window.visionAPI || typeof window.visionAPI.listEvents !== 'function') {
        if (grid) {
          grid.innerHTML = state.layout === 'horizontal'
            ? '<div class="vision-events-grid-message"><p class="text-body-tertiary mb-0">API not available.</p></div>'
            : '<div class="col-12"><p class="text-body-tertiary mb-0">API not available.</p></div>';
        }
        return Promise.resolve();
      }
      if (typeof window.visionAPI.isAuthenticated === 'function' && !window.visionAPI.isAuthenticated()) {
        if (grid) {
          grid.innerHTML = state.layout === 'horizontal'
            ? '<div class="vision-events-grid-message"><p class="text-body-tertiary mb-0">Login required.</p></div>'
            : '<div class="col-12"><p class="text-body-tertiary mb-0">Login required.</p></div>';
        }
        return Promise.resolve();
      }

      // Reset pagination state on full refresh
      state.currentSkip = 0;
      state.totalEvents = 0;
      state.isLoadingMore = false;

      var cameraIdParam = state.cameraId || null;
      var callApi = function (withCamera) {
        return window.visionAPI.listEvents(state.dateRange || 'all', PAGE_SIZE, 0, withCamera ? cameraIdParam : null);
      };
      return callApi(true).catch(function () { return callApi(false); })
        .then(function (res) {
          var items = Array.isArray(res && res.items) ? res.items : [];
          state.totalEvents = (res && res.total != null) ? res.total : items.length;
          state.currentSkip = items.length;
          state.events = items.map(function (it) {
            return {
              event_id: it.id,
              eventId: it.id,
              label: it.label || 'Event',
              timestamp: it.event_ts || it.received_at,
              event_ts: it.event_ts || it.received_at,
              received_at: it.received_at,
              camera_id: (it.camera_id || '').toString(),
              cameraId: (it.camera_id || '').toString(),
              agent_name: it.agent_name,
              agentName: it.agent_name,
              severity: inferSeverity(it.label),
              thumbDataUrl: null,
              thumbObjectUrl: null
            };
          });
          if (state.cameraId) {
            state.events = state.events.filter(function (e) {
              return (e.camera_id || e.cameraId || '') === state.cameraId;
            });
          }
          return Promise.all(state.events.map(ensureEventImage));
        })
        .then(function () {
          renderEvents(state.events);
        })
        .catch(function (err) {
          if (grid) {
            var errHtml = '<p class="text-danger mb-0">' + escapeHtml(err.message || 'Failed to load events') + '</p>';
            grid.innerHTML = state.layout === 'horizontal'
              ? '<div class="vision-events-grid-message">' + errHtml + '</div>'
              : '<div class="col-12">' + errHtml + '</div>';
          }
        });
    }

    function ensureHorizontalGridStylesOnce() {
      var sid = 'vision-events-horizontal-grid-styles-v2';
      var legacy = document.getElementById('vision-events-horizontal-grid-styles');
      if (legacy) legacy.remove();
      if (document.getElementById(sid)) return;
      var style = document.createElement('style');
      style.id = sid;
      style.textContent =
        /* ~20rem min: fewer columns on medium widths → avoids 4+1 orphan rows when 5 items */
        '.vision-events-widget .vision-events-horizontal-grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr));}' +
        '.vision-events-widget .vision-events-grid-message{grid-column:1/-1;min-width:0;}';
      document.head.appendChild(style);
    }

    function bindFilters() {
      var rangeEl = state.container.querySelector('#' + rangeId);
      if (rangeEl) {
        rangeEl.value = state.dateRange || 'all';
        rangeEl.addEventListener('change', function () {
          state.dateRange = this.value;
          refresh();
        });
      }

      state.container.querySelectorAll('.vision-events-severity-tabs[data-widget="' + uniqueId + '"] .nav-link').forEach(function (link) {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          state.container.querySelectorAll('.vision-events-severity-tabs .nav-link').forEach(function (l) { l.classList.remove('active'); });
          this.classList.add('active');
          state.severityFilter = this.getAttribute('data-severity') || 'all';
          renderEvents(state.events);
        });
      });
    }

    function mount() {
      if (state.layout === 'horizontal') ensureHorizontalGridStylesOnce();
      var title = state.cameraId ? 'Events for this camera' : 'Events';
      var gridClasses = state.layout === 'horizontal'
        ? 'vision-events-horizontal-grid'
        : 'row g-3 mb-3';
      var headerHtml = state.showHeader
        ? ('<div class="row gx-6 gy-3 mb-2 align-items-center"><div class="col-auto">' +
          '<h3 class="mb-0 fs-6">' + escapeHtml(title) + '<span class="fw-normal text-body-tertiary ms-2">(<span id="' + countId + '">0</span>)</span></h3></div></div>')
        : '';
      var loadingHtml = state.layout === 'horizontal'
        ? '<div class="vision-events-grid-message"><p class="text-body-tertiary mb-0">Loading…</p></div>'
        : '<div class="col-12"><p class="text-body-tertiary mb-0">Loading…</p></div>';
      state.container.innerHTML =
        '<div class="vision-events-widget">' +
        headerHtml +
        renderFilters() +
        '<div class="' + gridClasses + '" id="' + gridId + '">' +
        loadingHtml +
        '</div></div>';
      bindFilters();
      refresh();
      return { refresh: refresh, setFilters: setFilters, destroy: destroy };
    }

    function setFilters(filters) {
      if (filters.cameraId !== undefined) state.cameraId = filters.cameraId || null;
      if (filters.severityFilter !== undefined) state.severityFilter = filters.severityFilter || 'all';
      if (filters.dateRange !== undefined) state.dateRange = filters.dateRange || 'all';
      renderEvents(state.events);
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
      if (!el) throw new Error('VisionEventsBoardWidget: container not found');
      return createWidget(el, options).mount();
    },
    create: createWidget
  };
});
