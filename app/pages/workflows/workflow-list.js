import { navigate } from '../../core/router.js';
(function () {
  'use strict';

  const API_BASE = (typeof window !== 'undefined' && window.VISION_API_BASE) ? window.VISION_API_BASE : 'https://api.samitweb.xyz';

  // Helper to get auth token - uses same key as api-service.js (visionai_token)
  function getAuthToken() {
    return localStorage.getItem('visionai_token') || '';
  }

  // Helper to get logged-in user info from localStorage
  function getCurrentUser() {
    const userStr = localStorage.getItem('visionai_user') || localStorage.getItem('user') || localStorage.getItem('currentUser');
    if (userStr) {
      try {
        const user = JSON.parse(userStr);
        return user.name || user.full_name || user.username || user.email || 'Unknown User';
      } catch {
        return userStr; // If stored as plain string
      }
    }
    return 'Unknown User';
  }

  // Generate default Watch Dog values
  function generateWorkflowDefaults() {
    const randomNum = Math.floor(100 + Math.random() * 900); // Random 3-digit number (100-999)
    const defaultName = `watch-dog-${randomNum}`;
    const defaultDescription = 'New Watch Dog created via Watch Dog designer';
    return { name: defaultName, description: defaultDescription };
  }

  async function loadWorkflow() {
    try {
      const token = getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const res = await fetch(API_BASE + '/api/v1/workflows/', {
        method: 'GET',
        headers: headers,
      });
      
      if (res.status === 401) {
        console.error('Authentication required. Please login again.');
        alert('Session expired. Please login again.');
        return;
      }
      
      const result = await res.json();

      if (res.ok) {
        console.log(result);
        // API returns { workflows: [...] } not a plain array
        const workflows = result.workflows || result;
        displayWorkflows(workflows);
      } else {
        console.error(result);
        alert('Failed to load Watch Dogs: ' + (result.detail || 'Unknown error'));
      }
    } catch (err) {
      console.error(err);
      alert('Error loading Watch Dogs');
    }
  }

  function displayWorkflows(data) {
    const tbody = document.getElementById("WorkflowTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    // Store workflow data globally for editWorkflow function
    window.currentWorkflowData = data;

    // Update total count
    const totalCount = data.length || 0;
    const totalEl = document.getElementById("totalAssetCount");
    if (totalEl) {
      totalEl.textContent = `(${totalCount} Watch Dogs)`;
    }

    data.forEach(workflow => {
      const workflowId = workflow.id || 'N/A';
      const flowName = workflow.name || 'Unnamed Watch Dog';
      const description = workflow.description || '-';
      const isActive = workflow.is_active !== false;
      const status = isActive ? 'Active' : 'Inactive';
      const createdAt = workflow.created_at ? new Date(workflow.created_at).toLocaleDateString() : '-';

      const row = document.createElement("tr");
      row.innerHTML = `
        <td class="align-middle ps-0">
          <div class="d-flex align-items-center">
            <div>
              <h6 class="mb-1">
                <strong>${flowName}</strong>
              </h6>
            </div>
          </div>
        </td>
        <td class="align-middle ps-0">
          <span class="text-body-secondary">${description}</span>
        </td>
        <td class="align-middle ps-0">
          <span class="badge fs-9 ${status === 'Active' ? 'bg-success' : 'bg-danger'}">${status}</span>
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
        </td>
      `;
      tbody.appendChild(row);
    });

    // Delegate click handlers for action buttons
    tbody.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const workflowId = btn.getAttribute('data-workflow-id');
      const action = btn.getAttribute('data-action');
      if (!workflowId || !action) return;

      if (action === 'delete') {
        deleteWorkflow(workflowId);
      } else if (action === 'edit') {
        editWorkflow(workflowId);
      }
    }, { once: true });
  }

  function navigateTo(href) {
    if (!href) return;
    navigate(href).catch?.(() => {
      window.location.href = href;
    });
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
      const token = getAuthToken();
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      
      const response = await fetch(`${API_BASE}/api/v1/workflows/${workflowId}`, {
        method: 'DELETE',
        headers: headers,
      });

      if (response.status === 401) {
        alert('Session expired. Please login again.');
        return;
      }

      if (response.ok) {
        console.log('Watch Dog deleted:', workflowId);
        loadWorkflow();
        alert('Watch Dog deleted successfully');
      } else {
        const result = await response.json();
        console.error(result);
        alert('Failed to delete Watch Dog: ' + (result.detail || 'Unknown error'));
      }
    } catch (err) {
      console.error(err);
      alert('Error deleting Watch Dog');
    }
  }

  function initWorkflowList() {
    console.log('[WorkflowList] initWorkflowList called. readyState=', document.readyState);
    const workflowForm = document.getElementById('workflowForm');
    const modal = document.getElementById('addWorkflowModal');
    const addBtn = document.getElementById('btnAddWorkflow');
    const workflowNameInput = document.getElementById('workflowName');

    if (workflowNameInput) {
      workflowNameInput.addEventListener('keydown', (e) => {
        console.log('[WorkflowList] workflowName keydown:', e.key, 'valueBefore=', workflowNameInput.value);
      });
    }

    document.addEventListener('keydown', (e) => {
      console.log('[WorkflowList] document keydown:', e.key, 'target=', e.target && e.target.tagName, 'id=', e.target && e.target.id);
    }, { once: false });

    if (addBtn) {
      addBtn.addEventListener('click', () => {
        console.log('[WorkflowList] Add Workflow button clicked');
      });
    }

    // Ensure modal is initialized early and focus works reliably in SPA layout
    if (modal && window.bootstrap && window.bootstrap.Modal) {
      console.log('[WorkflowList] Initializing Bootstrap modal for addWorkflowModal');
      setTimeout(() => {
        const modalInstance = window.bootstrap.Modal.getOrCreateInstance(modal);
        console.log('[WorkflowList] Modal instance ready:', !!modalInstance);
        modal.addEventListener('shown.bs.modal', function () {
          console.log('[WorkflowList] shown.bs.modal fired for addWorkflowModal');
          const input = modal.querySelector('#workflowName');
          console.log('[WorkflowList] Found workflowName input:', !!input);
          if (input) {
            input.focus();
            console.log('[WorkflowList] Focus set to workflowName. activeElement=', document.activeElement && document.activeElement.id);
          } else {
            console.log('[WorkflowList] No input to focus');
          }
        });
      }, 100);
    } else {
      console.log('[WorkflowList] Modal or Bootstrap not available at init time', {
        hasModal: !!modal,
        hasBootstrap: !!window.bootstrap,
        hasBootstrapModal: !!(window.bootstrap && window.bootstrap.Modal)
      });
    }

    if (workflowForm && modal) {
      workflowForm.addEventListener('submit', function (event) {
        event.preventDefault();
        event.stopPropagation();

        const workflowNameInput = document.getElementById('workflowName');
        const workflowDescriptionInput = document.getElementById('workflowDescription');

        const workflowName = workflowNameInput.value.trim();
        const workflowDescription = workflowDescriptionInput.value.trim();
        const workflowCreatedBy = getCurrentUser();

        let isValid = true;

        workflowForm.classList.remove('was-validated');

        if (!workflowName) {
          workflowNameInput.classList.add('is-invalid');
          isValid = false;
        } else {
          workflowNameInput.classList.remove('is-invalid');
          workflowNameInput.classList.add('is-valid');
        }

        if (!workflowDescription) {
          workflowDescriptionInput.classList.add('is-invalid');
          isValid = false;
        } else {
          workflowDescriptionInput.classList.remove('is-invalid');
          workflowDescriptionInput.classList.add('is-valid');
        }

        workflowForm.classList.add('was-validated');

        if (isValid) {
          const params = new URLSearchParams({
            name: workflowName,
            owner: workflowCreatedBy,
            description: workflowDescription
          });

          const modalInstance = bootstrap.Modal.getInstance(modal);
          if (modalInstance) {
            modalInstance.hide();
          }

          navigateTo(`workflow-editor.html?${params.toString()}`);
        } else {
          console.log('Form validation failed');
        }
      });

      modal.addEventListener('hidden.bs.modal', function () {
        workflowForm.reset();
        workflowForm.classList.remove('was-validated');

        const inputs = workflowForm.querySelectorAll('.form-control');
        inputs.forEach(input => {
          input.classList.remove('is-valid', 'is-invalid');
        });
      });

      // Set default values when modal is shown
      modal.addEventListener('shown.bs.modal', function () {
        const defaults = generateWorkflowDefaults();
        const workflowNameInput = document.getElementById('workflowName');
        const workflowDescriptionInput = document.getElementById('workflowDescription');
        
        if (workflowNameInput && !workflowNameInput.value.trim()) {
          workflowNameInput.value = defaults.name;
        }
        if (workflowDescriptionInput && !workflowDescriptionInput.value.trim()) {
          workflowDescriptionInput.value = defaults.description;
        }
      });
    }

    loadWorkflow();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWorkflowList);
  } else {
    setTimeout(initWorkflowList, 0);
  }
})();
    
