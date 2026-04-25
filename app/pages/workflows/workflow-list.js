import { navigate } from '../../core/router.js';
import { api } from '../../core/api.js';

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

function generateWorkflowDefaults() {
  const randomNum = Math.floor(100 + Math.random() * 900);
  return {
    name: `watch-dog-${randomNum}`,
    description: 'New Watch Dog created via Watch Dog designer'
  };
}

async function loadWorkflow() {
  try {
    const result = await api.get('/api/v1/workflows/');
    const workflows = result.workflows || result;
    displayWorkflows(Array.isArray(workflows) ? workflows : []);
  } catch (err) {
    console.error('[WorkflowList] loadWorkflow error:', err);
    const tbody = document.getElementById('WorkflowTableBody');
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger py-4">Failed to load Watch Dogs: ${err.message}</td></tr>`;
    }
  }
}

function displayWorkflows(data) {
  const tbody = document.getElementById('WorkflowTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  window.currentWorkflowData = data;

  const totalEl = document.getElementById('totalAssetCount');
  if (totalEl) totalEl.textContent = `(${data.length} Watch Dogs)`;

  if (data.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center text-body-tertiary py-4">No Watch Dogs found</td></tr>';
    return;
  }

  data.forEach(workflow => {
    const workflowId = workflow.id || 'N/A';
    const flowName = workflow.name || 'Unnamed Watch Dog';
    const description = workflow.description || '-';
    const isActive = workflow.is_active !== false;
    const status = isActive ? 'Active' : 'Inactive';
    const createdAt = workflow.created_at ? new Date(workflow.created_at).toLocaleDateString() : '-';

    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="align-middle ps-0">
        <h6 class="mb-1"><strong>${flowName}</strong></h6>
      </td>
      <td class="align-middle ps-0">
        <span class="text-body-secondary">${description}</span>
      </td>
      <td class="align-middle ps-0">
        <span class="badge fs-9 ${isActive ? 'bg-success' : 'bg-danger'}">${status}</span>
      </td>
      <td class="align-middle ps-0">
        <span class="text-body-secondary">${createdAt}</span>
      </td>
      <td class="align-middle text-center">
        <div class="d-flex justify-content-center gap-2">
          <button class="btn btn-secondary btn-sm px-3" data-action="edit" data-workflow-id="${workflowId}">
            <i class="fas fa-edit me-1"></i>Edit
          </button>
          <button class="btn btn-danger btn-sm px-3" data-action="delete" data-workflow-id="${workflowId}">
            <i class="fas fa-trash me-1"></i>Delete
          </button>
        </div>
      </td>`;
    tbody.appendChild(row);
  });

  tbody.addEventListener('click', function (e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const workflowId = btn.getAttribute('data-workflow-id');
    const action = btn.getAttribute('data-action');
    if (action === 'delete') deleteWorkflow(workflowId);
    else if (action === 'edit') editWorkflow(workflowId);
  }, { once: true });
}

function navigateTo(href) {
  navigate(href).catch?.(() => { window.location.href = href; });
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
  try {
    await api.delete(`/api/v1/workflows/${workflowId}`);
    loadWorkflow();
  } catch (err) {
    console.error('[WorkflowList] deleteWorkflow error:', err);
    alert('Failed to delete Watch Dog: ' + err.message);
  }
}

export function boot() {
  const modal = document.getElementById('addWorkflowModal');
  const workflowForm = document.getElementById('workflowForm');

  if (modal && window.bootstrap?.Modal) {
    const modalInstance = window.bootstrap.Modal.getOrCreateInstance(modal);

    modal.addEventListener('shown.bs.modal', function () {
      const defaults = generateWorkflowDefaults();
      const nameInput = modal.querySelector('#workflowName');
      const descInput = modal.querySelector('#workflowDescription');
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

      const nameInput = document.getElementById('workflowName');
      const descInput = document.getElementById('workflowDescription');
      const name = nameInput?.value.trim();
      const description = descInput?.value.trim();

      workflowForm.classList.remove('was-validated');
      let isValid = true;

      if (!name) { nameInput?.classList.add('is-invalid'); isValid = false; }
      else { nameInput?.classList.remove('is-invalid'); nameInput?.classList.add('is-valid'); }

      if (!description) { descInput?.classList.add('is-invalid'); isValid = false; }
      else { descInput?.classList.remove('is-invalid'); descInput?.classList.add('is-valid'); }

      workflowForm.classList.add('was-validated');

      if (!isValid) return;

      const modalInstance = window.bootstrap?.Modal.getInstance(modal);
      modalInstance?.hide();

      const params = new URLSearchParams({ name, owner: getCurrentUser(), description });
      navigateTo(`workflow-editor.html?${params.toString()}`);
    });
  }

  loadWorkflow();
}
