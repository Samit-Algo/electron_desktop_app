import { navigate } from '../../core/router.js';
import { api } from '../../core/api.js';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const API_BASE = (typeof window !== 'undefined' && window.VISION_API_BASE)
  ? window.VISION_API_BASE
  : 'http://127.0.0.1:8000';

// Active WebSocket connections: workflowId → WebSocket
const _wsSockets = {};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function getCurrentUser() {
  const userStr = localStorage.getItem('visionai_user');
  if (userStr) {
    try {
      const user = JSON.parse(userStr);
      return user.name || user.full_name || user.username || user.email || 'Unknown User';
    } catch {
      return userStr;
    }
  }
  return 'Unknown User';
}

function getAuthToken() {
  return localStorage.getItem('visionai_token') || '';
}

function generateWorkflowDefaults() {
  const randomNum = Math.floor(100 + Math.random() * 900);
  return {
    name: `watch-dog-${randomNum}`,
    description: 'New Watch Dog created via Watch Dog designer'
  };
}

function navigateTo(href) {
  navigate(href).catch?.(() => { window.location.href = href; });
}

// ─────────────────────────────────────────────────────────────────────────────
// Status badge helpers
// ─────────────────────────────────────────────────────────────────────────────
function _overallBadge(overallStatus) {
  const map = {
    running:   ['bg-success',   'Running'],
    scheduled: ['bg-info text-dark', 'Scheduled'],
    completed: ['bg-secondary', 'Completed'],
    paused:    ['bg-warning text-dark', 'Paused'],
    stopping:  ['bg-warning text-dark', 'Stopping'],
    inactive:  ['bg-secondary', 'Inactive'],
    unknown:   ['bg-secondary', 'Unknown'],
  };
  const [cls, label] = map[overallStatus] || map.unknown;
  return `<span class="badge fs-9 ${cls}">${label}</span>`;
}

function _agentStatusDot(status) {
  const map = {
    Monitoring:  '#22c55e',
    Scheduled:   '#38bdf8',
    Sleeping:    '#94a3b8',
    Completed:   '#6b7280',
    Cancelled:   '#6b7280',
    Paused:      '#fbbf24',
    Error:       '#ef4444',
  };
  const color = map[status] || '#94a3b8';
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:4px;"></span>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Action buttons — rendered based on current overall status
// ─────────────────────────────────────────────────────────────────────────────
function _actionButtons(workflowId, overallStatus) {
  const id = workflowId;
  const running  = overallStatus === 'running';
  const paused   = overallStatus === 'paused';
  const inactive = ['inactive', 'completed', 'unknown'].includes(overallStatus);

  const runBtn = `
    <button class="btn btn-success btn-sm px-2" data-action="run" data-workflow-id="${id}" title="Run">
      <i class="fas fa-play me-1"></i>Run
    </button>`;

  const pauseBtn = running ? `
    <button class="btn btn-warning btn-sm px-2" data-action="pause" data-workflow-id="${id}" title="Pause">
      <i class="fas fa-pause me-1"></i>Pause
    </button>` : '';

  const resumeBtn = paused ? `
    <button class="btn btn-info btn-sm px-2" data-action="resume" data-workflow-id="${id}" title="Resume">
      <i class="fas fa-play me-1"></i>Resume
    </button>` : '';

  const stopBtn = (!inactive) ? `
    <button class="btn btn-danger btn-sm px-2" data-action="stop" data-workflow-id="${id}" title="Stop">
      <i class="fas fa-stop me-1"></i>Stop
    </button>` : '';

  const editBtn = `
    <button class="btn btn-secondary btn-sm px-2" data-action="edit" data-workflow-id="${id}" title="Edit design">
      <i class="fas fa-edit me-1"></i>Edit
    </button>`;

  const deleteBtn = `
    <button class="btn btn-outline-danger btn-sm px-2" data-action="delete" data-workflow-id="${id}" title="Delete">
      <i class="fas fa-trash"></i>
    </button>`;

  // Show Run when inactive; hide Run when running or paused (use resume instead)
  const showRun = inactive;

  return `<div class="d-flex justify-content-center gap-1 flex-wrap">
    ${showRun ? runBtn : ''}
    ${pauseBtn}
    ${resumeBtn}
    ${stopBtn}
    ${editBtn}
    ${deleteBtn}
  </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent sub-rows (expandable)
// ─────────────────────────────────────────────────────────────────────────────
function _agentRows(agents, workflowId) {
  if (!agents || agents.length === 0) return '';
  return agents.map(a => `
    <tr class="wf-agent-row" data-parent-workflow="${workflowId}" style="background:rgba(0,0,0,.03);">
      <td class="ps-4 py-1" colspan="2">
        <span style="font-size:11px;color:var(--bs-secondary-color,#6c757d);">
          ${_agentStatusDot(a.status)}${a.name || 'Agent'}&nbsp;·&nbsp;cam: <code style="font-size:10px;">${a.camera_id || '—'}</code>
          ${a.rule_type ? `&nbsp;·&nbsp;<span class="badge bg-dark" style="font-size:9px;">${a.rule_type}</span>` : ''}
        </span>
      </td>
      <td class="py-1" colspan="3">
        <span class="badge ${a.status === 'Monitoring' ? 'bg-success' : a.status === 'Error' ? 'bg-danger' : 'bg-secondary'}" style="font-size:9px;">${a.status || '—'}</span>
        ${a.status === 'Paused' ? '<span class="badge bg-warning text-dark ms-1" style="font-size:9px;">Paused</span>' : ''}
      </td>
    </tr>`).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Load and render
// ─────────────────────────────────────────────────────────────────────────────
async function loadWorkflow() {
  try {
    const result = await api.get('/api/v1/workflows/');
    const workflows = result.workflows || result;
    const list = Array.isArray(workflows) ? workflows : [];
    window.currentWorkflowData = list;
    // Fetch live status for each workflow in parallel
    const statuses = await Promise.allSettled(
      list.map(w => api.get(`/api/v1/workflows/${w.id}/status`))
    );
    const statusMap = {};
    list.forEach((w, i) => {
      const r = statuses[i];
      statusMap[w.id] = r.status === 'fulfilled' ? r.value : { status: 'inactive', agents: [] };
    });
    displayWorkflows(list, statusMap);
    // Subscribe WS for each workflow
    list.forEach(w => _connectWorkflowWs(w.id));
  } catch (err) {
    console.error('[WorkflowList] loadWorkflow error:', err);
    const tbody = document.getElementById('WorkflowTableBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Failed to load Watch Dogs: ${err.message}</td></tr>`;
    }
  }
}

function displayWorkflows(data, statusMap = {}) {
  const tbody = document.getElementById('WorkflowTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  window.currentWorkflowData = data;

  const totalEl = document.getElementById('totalAssetCount');
  if (totalEl) totalEl.textContent = `(${data.length} Watch Dogs)`;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-body-tertiary py-4">No Watch Dogs found</td></tr>';
    return;
  }

  data.forEach(workflow => {
    const wid         = workflow.id || 'N/A';
    const flowName    = workflow.name || 'Unnamed Watch Dog';
    const description = workflow.description || '—';
    const createdAt   = workflow.created_at ? new Date(workflow.created_at).toLocaleDateString() : '—';
    const liveStatus  = statusMap[wid] || { status: 'inactive', agents: [] };
    const overall     = liveStatus.status || 'inactive';
    const agents      = liveStatus.agents || [];

    const row = document.createElement('tr');
    row.setAttribute('data-workflow-id', wid);
    row.innerHTML = `
      <td class="align-middle ps-0">
        <h6 class="mb-0 d-flex align-items-center gap-2">
          <strong>${flowName}</strong>
          <button class="btn btn-link btn-sm p-0 text-muted wf-expand-btn" data-workflow-id="${wid}" title="Toggle agents" style="font-size:11px;">
            <i class="fas fa-chevron-down"></i>
          </button>
        </h6>
      </td>
      <td class="align-middle ps-0"><span class="text-body-secondary">${description}</span></td>
      <td class="align-middle ps-0" id="wf-status-${wid}">${_overallBadge(overall)}</td>
      <td class="align-middle ps-0"><span class="text-body-secondary">${createdAt}</span></td>
      <td class="align-middle text-center" id="wf-actions-${wid}">${_actionButtons(wid, overall)}</td>`;
    tbody.appendChild(row);

    // Agent sub-rows (hidden by default)
    if (agents.length > 0) {
      const agentContainer = document.createElement('tr');
      agentContainer.setAttribute('data-agents-for', wid);
      agentContainer.style.display = 'none';
      agentContainer.innerHTML = `<td colspan="5" class="p-0">
        <table class="table table-sm mb-0" style="background:rgba(0,0,0,.02);">
          <tbody>${_agentRows(agents, wid)}</tbody>
        </table>
      </td>`;
      tbody.appendChild(agentContainer);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// WebSocket per workflow — live status updates
// ─────────────────────────────────────────────────────────────────────────────
function _connectWorkflowWs(workflowId) {
  // Close existing socket for this workflow if any
  if (_wsSockets[workflowId]) {
    try { _wsSockets[workflowId].close(); } catch (_) {}
    delete _wsSockets[workflowId];
  }

  const token  = getAuthToken();
  const wsBase = API_BASE.replace(/^http/, 'ws');
  const url    = `${wsBase}/api/v1/workflows/${workflowId}/ws?token=${encodeURIComponent(token)}`;

  let ws;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    console.warn('[WF-WS] Cannot connect for workflow', workflowId, e);
    return;
  }

  _wsSockets[workflowId] = ws;

  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    if (msg.type !== 'workflow_event') return;
    _applyWorkflowEvent(workflowId, msg);
  };

  ws.onclose = () => {
    delete _wsSockets[workflowId];
  };

  ws.onerror = () => {
    // Silent — will reconnect on next page load
  };
}

function _applyWorkflowEvent(workflowId, msg) {
  const overall  = msg.status || 'inactive';
  const agents   = msg.agents || [];

  // Update status badge
  const statusCell = document.getElementById(`wf-status-${workflowId}`);
  if (statusCell) statusCell.innerHTML = _overallBadge(overall);

  // Update action buttons
  const actionsCell = document.getElementById(`wf-actions-${workflowId}`);
  if (actionsCell) actionsCell.innerHTML = _actionButtons(workflowId, overall);

  // Update agent sub-rows
  const agentRow = document.querySelector(`tr[data-agents-for="${workflowId}"]`);
  if (agentRow && agents.length > 0) {
    agentRow.innerHTML = `<td colspan="5" class="p-0">
      <table class="table table-sm mb-0" style="background:rgba(0,0,0,.02);">
        <tbody>${_agentRows(agents, workflowId)}</tbody>
      </table>
    </td>`;
  } else if (agents.length > 0) {
    // Insert agent row after the workflow row if it doesn't exist yet
    const workflowRow = document.querySelector(`tr[data-workflow-id="${workflowId}"]`);
    if (workflowRow) {
      const tr = document.createElement('tr');
      tr.setAttribute('data-agents-for', workflowId);
      tr.style.display = 'none';
      tr.innerHTML = `<td colspan="5" class="p-0">
        <table class="table table-sm mb-0" style="background:rgba(0,0,0,.02);">
          <tbody>${_agentRows(agents, workflowId)}</tbody>
        </table>
      </td>`;
      workflowRow.insertAdjacentElement('afterend', tr);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────
async function runWorkflow(workflowId) {
  const btn = document.querySelector(`button[data-action="run"][data-workflow-id="${workflowId}"]`);
  const origHtml = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Starting…'; }

  try {
    const result = await api.post(`/api/v1/workflows/${workflowId}/execute`);
    const agents = result.agents_started || 0;
    // Connect WS to receive live events
    _connectWorkflowWs(workflowId);

    // Update status badge immediately to "running"
    const statusCell = document.getElementById(`wf-status-${workflowId}`);
    if (statusCell) statusCell.innerHTML = _overallBadge('running');
    const actionsCell = document.getElementById(`wf-actions-${workflowId}`);
    if (actionsCell) actionsCell.innerHTML = _actionButtons(workflowId, 'running');

    if (agents === 0 && result.status !== 'running') {
      _showToast('Watch Dog started — no agents created. Check workflow design.', 'warning');
    } else {
      _showToast(`Watch Dog started — ${agents} agent(s) launching within ~5s`, 'success');
    }
  } catch (err) {
    console.error('[WorkflowList] runWorkflow error:', err);
    _showToast('Failed to run Watch Dog: ' + (err.message || 'Unknown error'), 'danger');
  } finally {
    if (btn && origHtml) { btn.disabled = false; btn.innerHTML = origHtml; }
  }
}

async function stopWorkflow(workflowId) {
  if (!confirm('Stop this Watch Dog?')) return;
  try {
    await api.post(`/api/v1/workflows/${workflowId}/stop`);
    _showToast('Stop signal sent — workers will terminate within ~5s', 'warning');
    const statusCell = document.getElementById(`wf-status-${workflowId}`);
    if (statusCell) statusCell.innerHTML = _overallBadge('stopping');
    const actionsCell = document.getElementById(`wf-actions-${workflowId}`);
    if (actionsCell) actionsCell.innerHTML = _actionButtons(workflowId, 'stopping');
  } catch (err) {
    _showToast('Failed to stop: ' + (err.message || 'Unknown error'), 'danger');
  }
}

async function pauseWorkflow(workflowId) {
  try {
    const result = await api.post(`/api/v1/workflows/${workflowId}/pause`);
    _showToast(result.message || 'Pause signal sent', 'warning');
    const statusCell = document.getElementById(`wf-status-${workflowId}`);
    if (statusCell) statusCell.innerHTML = _overallBadge('paused');
    const actionsCell = document.getElementById(`wf-actions-${workflowId}`);
    if (actionsCell) actionsCell.innerHTML = _actionButtons(workflowId, 'paused');
  } catch (err) {
    _showToast('Failed to pause: ' + (err.message || 'Unknown error'), 'danger');
  }
}

async function resumeWorkflow(workflowId) {
  try {
    const result = await api.post(`/api/v1/workflows/${workflowId}/resume`);
    _showToast(result.message || 'Resume signal sent', 'success');
    const statusCell = document.getElementById(`wf-status-${workflowId}`);
    if (statusCell) statusCell.innerHTML = _overallBadge('running');
    const actionsCell = document.getElementById(`wf-actions-${workflowId}`);
    if (actionsCell) actionsCell.innerHTML = _actionButtons(workflowId, 'running');
  } catch (err) {
    _showToast('Failed to resume: ' + (err.message || 'Unknown error'), 'danger');
  }
}

function editWorkflow(workflowId) {
  const workflowData = window.currentWorkflowData?.find(w => w.id === workflowId);
  let target = 'workflow-editor.html';
  if (workflowData) {
    const params = new URLSearchParams({
      workflow_id: workflowId,
      name: workflowData.name || '',
      description: workflowData.description || ''
    });
    target += `?${params.toString()}`;
  } else {
    target += `?workflow_id=${encodeURIComponent(workflowId)}`;
  }
  navigateTo(target);
}

async function deleteWorkflow(workflowId) {
  if (!confirm('Delete this Watch Dog?')) return;
  // Close WS before deleting
  if (_wsSockets[workflowId]) {
    try { _wsSockets[workflowId].close(); } catch (_) {}
    delete _wsSockets[workflowId];
  }
  try {
    await api.delete(`/api/v1/workflows/${workflowId}`);
    loadWorkflow();
  } catch (err) {
    _showToast('Failed to delete: ' + err.message, 'danger');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast helper (falls back to alert if toast.js unavailable)
// ─────────────────────────────────────────────────────────────────────────────
function _showToast(message, type = 'info') {
  try {
    // Try global toast if available
    if (window.toast) {
      window.toast[type === 'danger' ? 'error' : type]?.(message) || window.toast.info?.(message);
      return;
    }
  } catch (_) {}
  // Fallback: Bootstrap toast injected into DOM
  const containerId = 'wf-toast-container';
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    container.className = 'toast-container position-fixed bottom-0 end-0 p-3';
    container.style.zIndex = '9999';
    document.body.appendChild(container);
  }
  const bgMap = { success: 'bg-success', warning: 'bg-warning text-dark', danger: 'bg-danger', info: 'bg-info text-dark' };
  const bg = bgMap[type] || 'bg-secondary';
  const id = `toast-${Date.now()}`;
  const html = `<div id="${id}" class="toast align-items-center ${bg} border-0" role="alert" aria-live="assertive" aria-atomic="true">
    <div class="d-flex"><div class="toast-body">${message}</div>
    <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>
  </div>`;
  container.insertAdjacentHTML('beforeend', html);
  const toastEl = document.getElementById(id);
  const bsToast = window.bootstrap?.Toast ? new window.bootstrap.Toast(toastEl, { delay: 4000 }) : null;
  if (bsToast) bsToast.show();
  else toastEl.style.display = 'block';
  toastEl.addEventListener('hidden.bs.toast', () => toastEl.remove());
}

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────
export function boot() {
  const tbody = document.getElementById('WorkflowTableBody');

  if (tbody) {
    tbody.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-action]');
      if (btn) {
        const workflowId = btn.getAttribute('data-workflow-id');
        const action     = btn.getAttribute('data-action');
        if (action === 'run')    runWorkflow(workflowId);
        else if (action === 'stop')   stopWorkflow(workflowId);
        else if (action === 'pause')  pauseWorkflow(workflowId);
        else if (action === 'resume') resumeWorkflow(workflowId);
        else if (action === 'edit')   editWorkflow(workflowId);
        else if (action === 'delete') deleteWorkflow(workflowId);
        return;
      }
      // Expand/collapse agent rows
      const expandBtn = e.target.closest('.wf-expand-btn');
      if (expandBtn) {
        const wid = expandBtn.getAttribute('data-workflow-id');
        const agentRow = document.querySelector(`tr[data-agents-for="${wid}"]`);
        if (agentRow) {
          const visible = agentRow.style.display !== 'none';
          agentRow.style.display = visible ? 'none' : '';
          const icon = expandBtn.querySelector('i');
          if (icon) icon.className = visible ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
        }
      }
    });
  }

  const modal = document.getElementById('addWorkflowModal');
  const workflowForm = document.getElementById('workflowForm');

  if (modal && window.bootstrap?.Modal) {
    const modalInstance = window.bootstrap.Modal.getOrCreateInstance(modal);

    modal.addEventListener('shown.bs.modal', function () {
      const defaults   = generateWorkflowDefaults();
      const nameInput  = modal.querySelector('#workflowName');
      const descInput  = modal.querySelector('#workflowDescription');
      if (nameInput && !nameInput.value.trim()) nameInput.value = defaults.name;
      if (descInput && !descInput.value.trim()) descInput.value = defaults.description;
      nameInput?.focus();
    });

    modal.addEventListener('hidden.bs.modal', function () {
      if (workflowForm) {
        workflowForm.reset();
        workflowForm.classList.remove('was-validated');
        workflowForm.querySelectorAll('.form-control').forEach(el => {
          el.classList.remove('is-valid', 'is-invalid');
        });
      }
    });
  }

  if (workflowForm && modal) {
    workflowForm.addEventListener('submit', function (e) {
      e.preventDefault();
      e.stopPropagation();

      const nameInput  = document.getElementById('workflowName');
      const descInput  = document.getElementById('workflowDescription');
      const name        = nameInput?.value.trim();
      const description = descInput?.value.trim();

      workflowForm.classList.remove('was-validated');
      let isValid = true;

      if (!name)        { nameInput?.classList.add('is-invalid'); isValid = false; }
      else              { nameInput?.classList.remove('is-invalid'); nameInput?.classList.add('is-valid'); }
      if (!description) { descInput?.classList.add('is-invalid'); isValid = false; }
      else              { descInput?.classList.remove('is-invalid'); descInput?.classList.add('is-valid'); }

      workflowForm.classList.add('was-validated');
      if (!isValid) return;

      window.bootstrap?.Modal.getInstance(modal)?.hide();
      const params = new URLSearchParams({ name, owner: getCurrentUser(), description });
      navigateTo(`workflow-editor.html?${params.toString()}`);
    });
  }

  loadWorkflow();
}
