'use strict';
import { api } from '../../core/api.js';

const REFRESH_MS = 4000;

let refreshTimer = null;
let openedAgentId = null;   // non-null while the detail view is open

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function formatTime(value) {
  if (!value) return '—';
  try {
    const date = new Date(value);
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return String(value); }
}

function stateBadge(runState) {
  if (runState === 'running') {
    return '<span class="reports-state reports-state-live"><span class="reports-live-dot"></span> LIVE</span>';
  }
  return '<span class="reports-state reports-state-stopped">STOPPED</span>';
}

function typeMeta(reportType, targetClass) {
  if (reportType === 'box_count') return { icon: 'fa-box', label: `Box counter` };
  const cls = (targetClass || 'object');
  return { icon: cls === 'person' ? 'fa-person-walking' : 'fa-shapes', label: `${cls} counter` };
}

// ── Cards grid ───────────────────────────────────────────────────────────────

function renderCards(reports) {
  const grid = document.getElementById('reports-grid');
  const empty = document.getElementById('reports-empty');
  if (!grid || !empty) return;
  empty.classList.toggle('d-none', reports.length > 0);
  grid.innerHTML = reports.map(report => {
    const meta = typeMeta(report.report_type, report.target_class);
    return `
    <div class="col-12 col-sm-6 col-lg-4 col-xxl-3">
      <div class="reports-card ${report.run_state === 'running' ? 'is-live' : ''}" data-report-agent="${escapeHtml(report.agent_id)}" role="button">
        <div class="d-flex align-items-start justify-content-between mb-2">
          <div class="d-flex align-items-center gap-2">
            <span class="reports-card-icon"><i class="fa-solid ${meta.icon}"></i></span>
            <div>
              <div class="reports-card-title">${escapeHtml(report.agent_name || report.agent_id)}</div>
              <div class="reports-card-sub">${escapeHtml(meta.label)}${report.camera_id ? ' · ' + escapeHtml(report.camera_id) : ''}</div>
            </div>
          </div>
          ${stateBadge(report.run_state)}
        </div>
        <div class="reports-card-numbers">
          <div><div class="reports-number reports-number-in">${report.entry_count}</div><div class="reports-number-label">IN</div></div>
          <div><div class="reports-number reports-number-out">${report.exit_count}</div><div class="reports-number-label">OUT</div></div>
          <div><div class="reports-number">${report.net_count}</div><div class="reports-number-label">NET</div></div>
          <div><div class="reports-number reports-number-standby">${report.standby_count}</div><div class="reports-number-label">INSIDE</div></div>
        </div>
        <div class="reports-card-footer">
          <span><i class="fa-solid fa-play me-1"></i>${formatTime(report.start_time)}</span>
          <span>${report.run_state === 'running'
            ? `<i class="fa-solid fa-bolt me-1"></i>last: ${formatTime(report.last_event_at)}`
            : `<i class="fa-solid fa-stop me-1"></i>${formatTime(report.end_time)}`}</span>
        </div>
      </div>
    </div>`;
  }).join('');
}

async function refreshCards() {
  try {
    const response = await api.get('/api/v1/count-reports');
    renderCards(response.reports || []);
  } catch (error) {
    console.warn('[Reports] list fetch failed', error);
  }
}

// ── Detail view ──────────────────────────────────────────────────────────────

function renderDetail(detail) {
  const title = document.getElementById('reports-detail-title');
  const state = document.getElementById('reports-detail-state');
  const stats = document.getElementById('reports-detail-stats');
  if (title) title.textContent = detail.agent_name || detail.agent_id;
  if (state) state.innerHTML = stateBadge(detail.run_state);

  const tiles = [
    { label: 'Entries (IN)', value: detail.entry_count, cls: 'reports-number-in', icon: 'fa-arrow-right-to-bracket' },
    { label: 'Exits (OUT)', value: detail.exit_count, cls: 'reports-number-out', icon: 'fa-arrow-right-from-bracket' },
    { label: 'Net', value: detail.net_count, cls: '', icon: 'fa-equals' },
    { label: 'Currently inside', value: detail.standby_count, cls: 'reports-number-standby', icon: 'fa-users' },
  ];
  if (stats) {
    stats.innerHTML = tiles.map(tile => `
      <div class="col-6 col-lg-3">
        <div class="reports-panel reports-stat-tile">
          <div class="reports-stat-icon"><i class="fa-solid ${tile.icon}"></i></div>
          <div>
            <div class="reports-number ${tile.cls}">${tile.value}</div>
            <div class="reports-number-label">${tile.label}</div>
          </div>
        </div>
      </div>`).join('')
      + `
      <div class="col-12">
        <div class="reports-period">
          <i class="fa-solid fa-calendar me-2"></i>
          ${formatTime(detail.start_time)} &rarr; ${detail.run_state === 'running' ? 'now (running)' : formatTime(detail.end_time)}
          &nbsp;·&nbsp; counting <strong>${escapeHtml(detail.target_class || 'objects')}</strong>
        </div>
      </div>`;
  }

  const hourlyBody = document.getElementById('reports-hourly-body');
  if (hourlyBody) {
    hourlyBody.innerHTML = (detail.hourly || []).map(bucket => `
      <tr><td>${escapeHtml(bucket.hour)}</td>
      <td class="text-end reports-number-in">${bucket.entries}</td>
      <td class="text-end reports-number-out">${bucket.exits}</td></tr>`).join('')
      || '<tr><td colspan="3" class="text-body-tertiary">No crossings yet.</td></tr>';
  }

  const eventsBody = document.getElementById('reports-events-body');
  const eventsCount = document.getElementById('reports-events-count');
  if (eventsCount) eventsCount.textContent = detail.event_count || 0;
  if (eventsBody) {
    eventsBody.innerHTML = (detail.timeline || []).map(event => `
      <tr>
        <td>${formatTime(event.timestamp)}</td>
        <td>${event.event_type === 'entry'
          ? '<span class="reports-pill reports-pill-in">IN</span>'
          : '<span class="reports-pill reports-pill-out">OUT</span>'}</td>
        <td class="text-end">#${event.track_id ?? '—'}</td>
        <td class="text-end">${event.entry_count}</td>
        <td class="text-end">${event.exit_count}</td>
        <td class="text-end">${event.standby_count}</td>
      </tr>`).join('')
      || '<tr><td colspan="6" class="text-body-tertiary">No crossing events in this session yet.</td></tr>';
  }
}

async function refreshDetail() {
  if (!openedAgentId) return;
  try {
    const detail = await api.get(`/api/v1/count-reports/${encodeURIComponent(openedAgentId)}`);
    renderDetail(detail);
  } catch (error) {
    console.warn('[Reports] detail fetch failed', error);
  }
}

function showDetail(agentId) {
  openedAgentId = agentId;
  document.getElementById('reports-grid-view')?.classList.add('d-none');
  document.getElementById('reports-detail-view')?.classList.remove('d-none');
  refreshDetail();
}

function showGrid() {
  openedAgentId = null;
  document.getElementById('reports-detail-view')?.classList.add('d-none');
  document.getElementById('reports-grid-view')?.classList.remove('d-none');
  refreshCards();
}

// ── Polling + wiring ─────────────────────────────────────────────────────────

function refreshCurrentView() {
  // Page left the DOM (SPA navigation) — stop polling.
  if (!document.querySelector('.reports-page')) { stopPolling(); return; }
  if (openedAgentId) refreshDetail(); else refreshCards();
}

function startPolling() {
  stopPolling();
  refreshTimer = setInterval(refreshCurrentView, REFRESH_MS);
}

function stopPolling() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

function wire() {
  const root = document.querySelector('.reports-page');
  if (!root || root.dataset.reportsWired === '1') return;
  root.dataset.reportsWired = '1';

  root.addEventListener('click', (event) => {
    const card = event.target.closest('[data-report-agent]');
    if (card) { showDetail(card.getAttribute('data-report-agent')); return; }
    if (event.target.closest('#reports-back-btn')) { showGrid(); }
  });

  window.__visionaiPageCleanup = function () { stopPolling(); };
}

export async function boot() {
  wire();
  await refreshCards();
  startPolling();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { boot(); });
} else {
  boot();
}
