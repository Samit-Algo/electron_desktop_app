import { navigate } from '../../core/router.js';
import { api } from '../../core/api.js';
import { toast } from '../../core/toast.js';

const DRAWFLOW_SRC = 'https://cdn.jsdelivr.net/npm/drawflow@0.0.47/dist/drawflow.min.js';

  function ensureDrawflow() {
    return new Promise((resolve, reject) => {
      if (typeof window.Drawflow !== 'undefined') {
        resolve();
        return;
      }
      const existing = document.querySelector('script[data-drawflow="true"]');
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Failed to load Drawflow')));
        return;
      }
      const s = document.createElement('script');
      s.src = DRAWFLOW_SRC;
      s.defer = true;
      s.setAttribute('data-drawflow', 'true');
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load Drawflow'));
      document.head.appendChild(s);
    });
  }

  function navigateTo(href) {
    if (!href) return;
    navigate(href).catch?.(() => { window.location.href = href; });
  }

  window.toggleSection = function(header) {
    const section = header.closest('.wf-section');
    section.classList.toggle('expanded');
  };

  window.togglePasswordVisibility = function(icon) {
    const wrapper = icon.closest('.lf-input-wrapper');
    const input = wrapper.querySelector('input');
    const eyeIcon = wrapper.querySelector('.fa-eye');
    const eyeSlashIcon = wrapper.querySelector('.fa-eye-slash');
    if (input.type === 'password') {
      input.type = 'text';
      if (eyeIcon) eyeIcon.style.display = 'none';
      if (eyeSlashIcon) eyeSlashIcon.style.display = 'inline';
    } else {
      input.type = 'password';
      if (eyeIcon) eyeIcon.style.display = 'inline';
      if (eyeSlashIcon) eyeSlashIcon.style.display = 'none';
    }
  };

  function getAuthToken() {
    return localStorage.getItem('visionai_token') || '';
  }

  const API_BASE = (typeof window !== 'undefined' && window.VISION_API_BASE) ? window.VISION_API_BASE : 'http://127.0.0.1:8000';
  const WORKFLOW_CHAT_API_BASE = API_BASE;
let wfEditorInitInFlight = false;

  async function initWorkflowEditor() {
    const container = document.getElementById('drawflow');
    if (!container) return;
    if (wfEditorInitInFlight) return;
    wfEditorInitInFlight = true;
    try {
      await ensureDrawflow();
    } catch (e) {
      wfEditorInitInFlight = false;
      console.error('Drawflow failed to load', e);
      toast.error('Watch Dog editor engine failed to load. Please check your network connection.');
      return;
    }

    const _wsu = window.history.state && window.history.state.url ? window.history.state.url : window.location.href;
    const urlParams = new URLSearchParams(new URL(_wsu, window.location.origin).search);
    // These are mutable — after each save that creates a new ID we update them
    // so the next save (e.g. Run button) deactivates the correct workflow and
    // never accidentally deactivates a workflow it just created.
    let editWorkflowId = urlParams.get('workflow_id');
    const workflowName = urlParams.get('name') || '';
    const workflowOwner = urlParams.get('owner') || '';
    const workflowDescription = urlParams.get('description') || '';
    let isEditMode = !!editWorkflowId;

    const nameInput = document.getElementById('workflow-name-input');
    if (nameInput && workflowName) {
      nameInput.value = workflowName;
    }
    const zoomInBtn = document.getElementById('btn-zoom-in');
    const zoomOutBtn = document.getElementById('btn-zoom-out');
    const zoomResetBtn = document.getElementById('btn-zoom-reset');
    const clearBtn = document.getElementById('btn-clear');
    const exportBtn = document.getElementById('btn-export');
    const newBtn = document.getElementById('btn-new');
    const saveBtn = document.getElementById('btn-save');
    const backBtn = document.getElementById('btn-workflow-back');
    const importBtn = document.getElementById('btn-import');
    const importFile = document.getElementById('file-import');
    const componentsSidebar = document.getElementById('wf-components-sidebar');
    const componentsSidebarBody = document.getElementById('wf-components-sidebar-body');
    const componentsResizer = document.getElementById('wf-components-resizer');
    const componentsToggleBtn = document.getElementById('wf-components-toggle');
    const designerRootEl = document.querySelector('.workflow-designer');
    const COMPONENTS_WIDTH_MIN = 180;
    const COMPONENTS_WIDTH_MAX = 360;
    const COMPONENTS_WIDTH_STORAGE_KEY = 'visionai.workflow.componentsSidebarWidth.v1';

    if (backBtn) {
      backBtn.addEventListener('click', () => navigateTo('workflow-list.html'));
    }

    function clampSidebarWidth(v) {
      return Math.max(COMPONENTS_WIDTH_MIN, Math.min(COMPONENTS_WIDTH_MAX, v));
    }

    function setComponentsSidebarWidth(px) {
      const clamped = clampSidebarWidth(px);
      if (designerRootEl) {
        designerRootEl.style.setProperty('--wf-components-sidebar-width', clamped + 'px');
      }
      try { localStorage.setItem(COMPONENTS_WIDTH_STORAGE_KEY, String(clamped)); } catch (_) {}
    }

    function updateComponentsToggleButtonState() {
      if (!componentsSidebar || !componentsToggleBtn || !designerRootEl) return;
      const icon = componentsToggleBtn.querySelector('i');
      const collapsed = designerRootEl.classList.contains('wf-components-collapsed');
      if (icon) icon.className = collapsed ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up';
      componentsToggleBtn.title = collapsed ? 'Expand Components' : 'Collapse Components';
      componentsToggleBtn.setAttribute('aria-label', componentsToggleBtn.title);
      componentsToggleBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }

    function toggleComponentsSidebar() {
      if (!componentsSidebar || !componentsSidebarBody || !designerRootEl) return;
      const nextCollapsed = !designerRootEl.classList.contains('wf-components-collapsed');
      designerRootEl.classList.toggle('wf-components-collapsed', nextCollapsed);
      componentsSidebar.classList.toggle('is-collapsed', nextCollapsed);
      updateComponentsToggleButtonState();
    }

    if (componentsToggleBtn) componentsToggleBtn.addEventListener('click', toggleComponentsSidebar);
    updateComponentsToggleButtonState();

    try {
      const stored = parseInt(localStorage.getItem(COMPONENTS_WIDTH_STORAGE_KEY) || '', 10);
      if (Number.isFinite(stored)) setComponentsSidebarWidth(stored);
    } catch (_) {}

    if (componentsResizer && designerRootEl) {
      let isResizing = false;
      let startX = 0;
      let startWidth = 0;

      function stopResize() {
        if (!isResizing) return;
        isResizing = false;
        componentsResizer.classList.remove('is-dragging');
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      }

      function onPointerMove(e) {
        if (!isResizing) return;
        const next = startWidth + (e.clientX - startX);
        setComponentsSidebarWidth(next);
      }

      function onPointerUp() {
        stopResize();
      }

      componentsResizer.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (designerRootEl && designerRootEl.classList.contains('wf-components-collapsed')) return;
        const rootStyles = getComputedStyle(designerRootEl);
        const current = parseInt(rootStyles.getPropertyValue('--wf-components-sidebar-width'), 10) || 220;
        isResizing = true;
        startX = e.clientX;
        startWidth = current;
        componentsResizer.classList.add('is-dragging');
        document.body.style.userSelect = 'none';
        componentsResizer.setPointerCapture?.(e.pointerId);
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });
    }

    const NODE_COMPATIBILITY = {
      start: ['camera'],
      camera: ['class_detection_agent', 'class_detection_zone_agent', 'object_count_agent', 'person_behaviour_agent', 'vlm_agent'],
      class_detection_agent: ['notification', 'alarm_notification', 'iot_action', 'report', 'vlm_agent'],
      class_detection_zone_agent: ['notification', 'alarm_notification', 'iot_action', 'report', 'vlm_agent'],
      object_count_agent: ['notification', 'alarm_notification', 'iot_action', 'report', 'vlm_agent'],
      person_behaviour_agent: ['notification', 'alarm_notification', 'iot_action', 'report', 'vlm_agent'],
      vlm_agent: ['notification', 'alarm_notification', 'iot_action', 'report', 'end'],
      notification: ['end', 'report'],
      alarm_notification: ['end', 'report'],
      iot_action: ['end', 'report'],
      report: ['end', 'notification', 'alarm_notification'],
      end: []
    };

    const RULE_META = [
      { id: 'class_presence', name: 'Object Presence Detection', needsClass: true, classes: ['person', 'car', 'bicycle', 'truck', 'bus'], needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false, needsZone: false, zoneType: null, zoneDesc: '' },
      { id: 'weapon_detection', name: 'Weapon Detection', needsClass: false, needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false, needsZone: false, zoneType: null, zoneDesc: '' },
      { id: 'sleep_detection', name: 'Sleep Detection', needsClass: false, needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false, needsZone: false, zoneType: null, zoneDesc: '' },
      { id: 'class_count', name: 'Object Counter', needsClass: true, classes: ['person', 'car', 'truck', 'bicycle', 'bus', 'motorcycle'], needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false, needsZone: true, zoneType: 'line', zoneDesc: 'Draw 2 points for counting line.' },
      { id: 'box_count', name: 'Box Counter', needsClass: false, fixedClass: 'box', needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false, needsZone: true, zoneType: 'line', zoneDesc: 'Draw 2 points for counting line.' },
      { id: 'restricted_zone', name: 'Restricted Zone', needsClass: true, classes: ['person', 'car', 'truck', 'bicycle', 'motorcycle'], needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false, needsZone: true, zoneType: 'polygon', zoneDesc: 'Draw polygon (min 3 points).' },
      { id: 'wall_climb_detection', name: 'Wall Climb Detection', needsClass: false, fixedClass: 'person', needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false, needsZone: true, zoneType: 'polygon', zoneDesc: 'Draw polygon around wall/fence.' },
      { id: 'fall_detection', name: 'Fall Detection', needsClass: false, needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false, needsZone: false, zoneType: null, zoneDesc: '' },
      { id: 'fire_detection', name: 'Fire Detection', needsClass: false, needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: false, needsZone: false, zoneType: null, zoneDesc: '' },
      { id: 'face_detection', name: 'Face / Person ID', needsClass: false, needsWatchNames: true, needsIdleThreshold: false, needsAbsenceThreshold: false, needsZone: false, zoneType: null, zoneDesc: '' },
      { id: 'loom_machine_state', name: 'Machine Idle Alert', needsClass: false, needsWatchNames: false, needsIdleThreshold: true, needsAbsenceThreshold: false, needsZone: true, zoneType: 'roi', zoneDesc: 'Click two corners to draw a bounding box (ROI) around the machine.' },
      { id: 'person_near_machine', name: 'Person Near Machine', needsClass: false, needsWatchNames: false, needsIdleThreshold: false, needsAbsenceThreshold: true, needsZone: true, zoneType: 'polygon', zoneDesc: 'Draw polygon around machine zone.' }
    ];

    const NODE_DEFINITIONS = {
      start: {
        name: 'start',
        label: 'Start',
        category: 'start',
        inputs: 0,
        outputs: 1,
        icon: 'fa-circle-play',
        fields: [
          { key: 'label', type: 'text', label: 'Node label', default: 'Start' },
          { key: 'description', type: 'textarea', label: 'Description', placeholder: 'Describe the purpose of this Watch Dog entry point.' },
          { key: 'schedule_type', type: 'select', label: 'Schedule', options: ['always', 'daily', 'weekly', 'once'], default: 'always' },
          { key: 'start_time', type: 'text', label: 'Start', default: '' },
          { key: 'end_time', type: 'text', label: 'End', default: '' },
          { key: 'active_days', type: 'text', label: 'Active days', default: '' },
          { key: 'run_mode', type: 'select', label: 'Run Mode', options: ['continuous', 'patrol'], default: 'continuous' },
          { key: 'interval_minutes', type: 'number', label: 'Interval (min)', default: 10 },
          { key: 'check_duration_seconds', type: 'number', label: 'Check duration (sec)', default: 30 }
        ]
      },
      camera: {
        name: 'camera',
        label: 'Camera',
        category: 'activity',
        inputs: 1,
        outputs: 1,
        icon: 'fa-video',
        fields: [
          { key: 'label', type: 'text', label: 'Node label', default: 'Camera' },
          { key: 'camera_ids', type: 'camera_select', label: 'Camera', placeholder: 'Select camera' }
        ]
      },
      class_detection_agent: {
        name: 'class_detection_agent',
        label: 'Object Detection Agent',
        category: 'activity',
        inputs: 1,
        outputs: 1,
        icon: 'fa-eye',
        fields: [
          { key: 'agent_name', type: 'text', label: 'Agent Name', default: '' },
          { key: 'rule_id', type: 'select', label: 'Rule Type', options: ['class_presence', 'fire_detection', 'weapon_detection', 'face_detection'], default: 'class_presence' },
          { key: 'model_name', type: 'select', label: 'Model', options: ['fire_detection.pt','yolov8n.pt', 'yolov8m.pt', 'yolov8s.pt'], default: 'yolov8m.pt' },
          { key: 'fps', type: 'number', label: 'FPS', default: 5 },
          { key: 'confidence_threshold', type: 'number', label: 'Confidence Threshold', default: 0.5 },
          { key: 'alert_cooldown_seconds', type: 'number', label: 'Alert Cooldown (seconds)', default: 10 }
        ]
      },
      person_behaviour_agent: {
        name: 'person_behaviour_agent',
        label: 'Person Behaviour Agent',
        category: 'activity',
        inputs: 1,
        outputs: 1,
        icon: 'fa-person-falling',
        fields: [
          { key: 'agent_name', type: 'text', label: 'Agent Name', default: '' },
          { key: 'rule_id', type: 'select', label: 'Rule Type', options: ['fall_detection', 'sleep_detection'], default: 'fall_detection' },
          { key: 'model_name', type: 'select', label: 'Model', options: ['yolov8m-pose.pt','yolov8n-pose.pt'], default: 'yolov8m-pose.pt' },
          { key: 'fps', type: 'number', label: 'FPS', default: 5 },
          { key: 'confidence_threshold', type: 'number', label: 'Confidence Threshold', default: 0.5 },
          { key: 'alert_cooldown_seconds', type: 'number', label: 'Alert Cooldown (seconds)', default: 10 }
        ]
      },
      class_detection_zone_agent: {
        name: 'class_detection_zone_agent',
        label: 'Class Detection Agent with Zone',
        category: 'activity',
        inputs: 1,
        outputs: 1,
        icon: 'fa-draw-polygon',
        fields: [
          { key: 'agent_name', type: 'text', label: 'Agent Name', default: '' },
          { key: 'rule_id', type: 'select', label: 'Rule Type', options: ['restricted_zone', 'wall_climb_detection', 'person_near_machine', 'loom_machine_state'], default: 'restricted_zone' },
          { key: 'model_name', type: 'select', label: 'Model', options: ['yolov8n.pt', 'yolov8m.pt'], default: 'yolov8m.pt' },
          { key: 'fps', type: 'number', label: 'FPS', default: 5 },
          { key: 'confidence_threshold', type: 'number', label: 'Confidence Threshold', default: 0.5 },
          { key: 'alert_cooldown_seconds', type: 'number', label: 'Alert Cooldown (seconds)', default: 10 },
          { key: 'zone_configured', type: 'hidden', label: '', default: false }
        ]
      },
      object_count_agent: {
        name: 'object_count_agent',
        label: 'Object Count Agent',
        category: 'activity',
        inputs: 1,
        outputs: 1,
        icon: 'fa-list-ol',
        fields: [
          { key: 'agent_name', type: 'text', label: 'Agent Name', default: '' },
          { key: 'rule_id', type: 'select', label: 'Rule Type', options: ['class_count', 'box_count'], default: 'class_count' },
          { key: 'model_name', type: 'select', label: 'Model', options: ['yolov8n.pt','yolov8m.pt', 'box_detection.pt'], default: 'yolov8m.pt' },
          { key: 'fps', type: 'number', label: 'FPS', default: 5 },
          { key: 'confidence_threshold', type: 'number', label: 'Confidence Threshold', default: 0.5 },
          { key: 'alert_cooldown_seconds', type: 'number', label: 'Alert Cooldown (seconds)', default: 10 },
          { key: 'zone_configured', type: 'hidden', label: '', default: false }
        ]
      },
      notification: {
        name: 'notification',
        label: 'Notification',
        category: 'activity',
        inputs: 1,
        outputs: 1,
        icon: 'fa-envelope',
        fields: [
          { key: 'label',      type: 'text',   label: 'Node label', default: 'Notification' },
          // Channels that actually exist in the backend:
          //   email       → sends to the recipient email addresses below
          //   in_app      → WebSocket popup in the browser dashboard (no recipients needed)
          //   mobile_push → FCM push to the user's registered mobile devices (no recipients needed)
          // All three can be enabled at once — tick the ones you want.
          { key: 'channel_email',       type: 'checkbox', label: 'Email',         default: true  },
          { key: 'channel_in_app',      type: 'checkbox', label: 'In-App (dashboard popup)', default: true  },
          { key: 'channel_mobile_push', type: 'checkbox', label: 'Mobile Push (FCM)',  default: false },
          // Recipients are only needed when Email is ticked
          { key: 'recipients', type: 'text', label: 'Email recipients', placeholder: 'comma-separated, e.g. ops@company.com, mgr@company.com', showIf: { field: 'channel_email', value: true } },
          { key: 'subject',    type: 'text', label: 'Subject',  placeholder: 'e.g. Motion detected on {{camera_name}}' },
          { key: 'message',    type: 'textarea', label: 'Message body', placeholder: 'Alert details. Use {{camera_name}}, {{class_name}}, {{timestamp}} as placeholders.' }
        ]
      },
      alarm_notification: {
        name: 'alarm_notification',
        label: 'Alarm Notification',
        category: 'activity',
        inputs: 1,
        outputs: 1,
        icon: 'fa-bell-exclamation',
        fields: [
          { key: 'label',       type: 'text',     label: 'Node label',   default: 'Alarm' },
          { key: 'alarm_level', type: 'readonly',  label: 'Alarm level',  value: 'critical' },
          { key: 'sound',       type: 'readonly',  label: 'Alert sound',  value: 'siren' },
          { key: 'vibration',   type: 'readonly',  label: 'Vibration',    value: 'on' }
        ]
      },
      iot_action: {
        name: 'iot_action',
        label: 'IoT Action',
        category: 'activity',
        inputs: 1,
        outputs: 1,
        icon: 'fa-plug-circle-bolt',
        fields: [
          { key: 'label', type: 'text', label: 'Node label', default: 'IoT Action' },
          { key: 'devices', type: 'iot_devices', label: 'Devices' }
        ]
      },
      // ── UPDATED REPORT NODE ────────────────────────────────────────────────
      // Changes from previous version:
      //   1. report_schedule now includes "every_n_minutes" and "once"
      //   2. end_of_day_time field added (shown only when schedule = end_of_day)
      //   3. interval_minutes field added (shown only when schedule = every_n_minutes)
      //   4. Removed the old "include_hours" field (replaced by interval_minutes)
      //   5. Both new fields use showIf for conditional visibility
      report: {
        name: 'report',
        label: 'Report Node',
        category: 'activity',
        inputs: 1,
        outputs: 1,
        icon: 'fa-file-lines',
        fields: [
          { key: 'label', type: 'text', label: 'Node label', default: 'Report' },
          {
            key: 'report_type',
            type: 'select',
            label: 'Report Type',
            options: ['events', 'counting', 'agents', 'cameras', 'system'],
            default: 'events'
          },
          {
            key: 'report_schedule',
            type: 'select',
            label: 'Schedule',
            options: ['end_of_day', 'hourly', 'every_n_minutes', 'once', 'manual'],
            default: 'end_of_day'
          },
          {
            key: 'end_of_day_time',
            type: 'text',
            label: 'Report time (HH:MM UTC)',
            default: '23:55',
            placeholder: 'e.g. 18:00 for 6 PM UTC',
            showIf: { field: 'report_schedule', value: 'end_of_day' }
          },
          {
            key: 'interval_minutes',
            type: 'number',
            label: 'Interval (minutes)',
            default: 60,
            placeholder: 'e.g. 30 for every 30 min',
            showIf: { field: 'report_schedule', value: 'every_n_minutes' }
          },
          {
            key: 'recipients',
            type: 'text',
            label: 'Recipients',
            placeholder: 'ops@company.com, admin@company.com'
          },
          {
            key: 'notes',
            type: 'textarea',
            label: 'Notes',
            placeholder: 'Optional notes about this report'
          }
        ]
      },
      vlm_agent: {
        name: 'vlm_agent',
        label: 'VLM Confirmation Agent',
        category: 'activity',
        inputs: 1,
        outputs: 1,
        icon: 'fa-brain',
        fields: [
          { key: 'agent_name', type: 'text', label: 'Agent Name', default: '' },
          { key: 'prompt', type: 'textarea', label: 'VLM Prompt', default: 'Analyze the image and confirm if the detection is valid.' },
          { key: 'model_name', type: 'select', label: 'VLM Model', options: ['gpt-4o', 'gpt-4o-mini', 'claude-3-5-sonnet', 'gemini-pro'], default: 'gpt-4o' },
          { key: 'confidence_threshold', type: 'number', label: 'Confidence Threshold', default: 0.7 },
          { key: 'timeout_seconds', type: 'number', label: 'Timeout (seconds)', default: 30 },
          { key: 'retry_count', type: 'number', label: 'Retry Count', default: 2 }
        ]
      },
      end: {
        name: 'end',
        label: 'End',
        category: 'end',
        inputs: 1,
        outputs: 0,
        icon: 'fa-flag-checkered',
        fields: [
          { key: 'label', type: 'text', label: 'Node label', default: 'End' },
          { key: 'result_summary', type: 'textarea', label: 'Expected outcome', placeholder: 'Describe what it means for this Watch Dog to complete successfully.' }
        ]
      }
    };

    function createNodeContentHtml(def, data, nodeId) {
      const title = (data && data.__label) || def.label;
      const fieldsHtml = (def.fields || []).map((field, index) => {
        return renderInlineField(field, data[field.key], index, def.name);
      }).join('');

      let bodyContent = fieldsHtml;
      if (def.name === 'class_detection_agent' || def.name === 'class_detection_zone_agent' || def.name === 'object_count_agent' || def.name === 'person_behaviour_agent') {
        bodyContent = renderAgentSections(data, nodeId, def.name);
      } else if (def.name === 'camera') {
        bodyContent = renderCameraSections(data, nodeId);
      } else if (def.name === 'start') {
        bodyContent = renderStartSections(data, nodeId);
      } else if (def.name === 'iot_action') {
        bodyContent = renderIoTActionSections(data, nodeId);
      }

      return `
        <div class="lf-card" data-node-id="${nodeId || ''}" data-wf-type="${def.name}" data-wf-category="${def.category}">
          <div class="lf-card-header d-flex align-items-center justify-content-between">
            <div class="lf-title d-flex align-items-center">
              <span class="lf-header-icon d-flex align-items-center justify-content-center"><i class="fa-solid ${def.icon}" aria-hidden="true"></i></span>
              <span class="lf-title-text">${title}</span>
            </div>
          </div>
          <div class="lf-card-body d-flex flex-column gap-2">
            ${bodyContent}
          </div>
        </div>
      `;
    }

    function renderAgentSections(data, nodeId, agentType) {
      const safe = (v) => (v === undefined || v === null) ? '' : String(v).replace(/"/g, '&quot;');
      const agentName = data.agent_name || '';
      const modelName = data.model_name || 'yolov8m.pt';
      const fps = data.fps || 5;
      const confidenceThreshold = data.confidence_threshold || 0.5;
      const alertCooldown = data.alert_cooldown_seconds || 10;

      let ruleOptions = [];
      let needsZone = false;
      let zoneType = 'polygon';
      let zoneDesc = '';
      let needsClass = false;
      let classOptions = [];

      if (agentType === 'class_detection_agent') {
        ruleOptions = [
          { id: 'class_presence',   name: 'Object Presence Detection' },
          { id: 'fire_detection',   name: 'Fire Detection' },
          { id: 'weapon_detection', name: 'Weapon Detection' },
          { id: 'face_detection',   name: 'Face Recognition' }
        ];
        needsClass = ((data.rule_id || 'class_presence') === 'class_presence');
        classOptions = ['person', 'car', 'truck', 'bicycle', 'bus', 'motorcycle'];
      } else if (agentType === 'person_behaviour_agent') {
        ruleOptions = [
          { id: 'fall_detection',  name: 'Fall Detection' },
          { id: 'sleep_detection', name: 'Sleep Detection' }
        ];
        needsClass = false;
        classOptions = [];
      } else if (agentType === 'class_detection_zone_agent') {
        ruleOptions = [
          { id: 'restricted_zone',      name: 'Restricted Zone Detection' },
          { id: 'wall_climb_detection', name: 'Wall Climb Detection' },
          { id: 'person_near_machine',  name: 'Person Near Machine Detection' },
          { id: 'loom_machine_state',   name: 'Machine Idle State Detection' }
        ];
        needsZone = true;
        var _zdMeta = RULE_META.find(function(r){ return r.id === (data.rule_id || 'restricted_zone'); });
        zoneType = (_zdMeta && _zdMeta.zoneType) || 'polygon';
        zoneDesc = (_zdMeta && _zdMeta.zoneDesc) || 'Draw zone for configuration.';
        needsClass = (data.rule_id === 'restricted_zone');
        classOptions = ['person', 'car', 'truck', 'bicycle', 'motorcycle'];
      } else if (agentType === 'object_count_agent') {
        ruleOptions = [
          { id: 'class_count', name: 'Object Counter' },
          { id: 'box_count',   name: 'Box Counter' }
        ];
        needsZone = true;
        zoneType = 'line';
        zoneDesc = 'Draw 2 points for counting line.';
        needsClass = (data.rule_id === 'class_count');
        classOptions = ['person', 'car', 'truck', 'bicycle', 'bus', 'motorcycle'];
      }

      const ruleId = data.rule_id || (ruleOptions[0] && ruleOptions[0].id) || '';
      const hasZone = !!(
        (data.zones && data.zones.length > 0) ||
        (data.zone && data.zone.coordinates && data.zone.coordinates.length)
      );
      const zoneCount = (data.zones && data.zones.length) || (hasZone ? 1 : 0);

      const ruleSelectOptions = ruleOptions.map(function (r) {
        return '<option value="' + r.id + '"' + (ruleId === r.id ? ' selected' : '') + '>' + r.name + '</option>';
      }).join('');

      let ruleSpecificHtml = '';
      if (needsClass) {
        const currentClass = data.detect_class || classOptions[0];
        if (!data.detect_class && classOptions.length && nodeId && editor.drawflow.drawflow.Home.data[nodeId]) {
          editor.drawflow.drawflow.Home.data[nodeId].data.detect_class = classOptions[0];
          data.detect_class = classOptions[0];
        }
        const classOpts = classOptions.map(function (c) {
          const label = c.charAt(0).toUpperCase() + c.slice(1);
          return '<option value="' + c + '"' + (currentClass === c ? ' selected' : '') + '>' + label + '</option>';
        }).join('');
        ruleSpecificHtml += '<div class="d-flex align-items-start gap-2"><span class="lf-section-indicator cyan"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Detect Class</div><div class="lf-input-wrapper"><select class="lf-node-input w-100 form-select form-select-sm" data-field="detect_class" data-node-id="' + (nodeId || '') + '">' + classOpts + '</select></div></div></div></div>';
      }

      // Add idle threshold input for loom_machine_state
      if (ruleId === 'loom_machine_state') {
        const idleThreshold = data.idle_threshold_minutes || 15;
        ruleSpecificHtml += '<div class="d-flex align-items-start gap-2"><span class="lf-section-indicator blue"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Idle Threshold (minutes)</div><div class="lf-input-wrapper"><input type="number" class="lf-node-input w-100 form-control form-control-sm" data-field="idle_threshold_minutes" data-node-id="' + (nodeId || '') + '" value="' + idleThreshold + '" step="1" min="1" max="1440" /></div></div></div></div>';
      }

      // Add absence threshold input for person_near_machine
      if (ruleId === 'person_near_machine') {
        const absenceThreshold = data.absence_threshold_minutes || 5;
        ruleSpecificHtml += '<div class="d-flex align-items-start gap-2"><span class="lf-section-indicator blue"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Absence Threshold (minutes)</div><div class="lf-input-wrapper"><input type="number" class="lf-node-input w-100 form-control form-control-sm" data-field="absence_threshold_minutes" data-node-id="' + (nodeId || '') + '" value="' + absenceThreshold + '" step="1" min="1" max="1440" /></div></div></div></div>';
      }

      let zoneHtml = '';
      if (needsZone) {
        zoneHtml = '<div class="d-flex align-items-start gap-2"><span class="lf-section-indicator cyan"></span><div class="flex-grow-1 min-w-0"><div class="mb-1">' +
          '<button type="button" class="btn btn-sm w-100 wf-draw-zone-btn" style="border:1px dashed var(--lf-input-border);background:var(--lf-input-bg);color:var(--lf-card-color);font-size:11px;" data-node-id="' + (nodeId || '') + '" data-zone-type="' + zoneType + '" data-zone-index="">' +
          '<i class="fa-solid fa-draw-polygon me-1"></i>' + (hasZone ? 'Edit zone 1' : 'Draw zone') + '</button>' +
          (hasZone ? ' <span class="small text-success ms-1"><i class="fa-solid fa-check"></i> ' + zoneCount + ' zone(s)</span>' : '') +
          '</div>' +
          (hasZone ? '<div class="mt-1"><button type="button" class="btn btn-sm wf-add-zone-btn" style="border:1px dashed var(--lf-input-border);background:var(--lf-input-bg);color:var(--lf-card-color);font-size:10px;width:100%;" data-node-id="' + (nodeId || '') + '" data-zone-type="' + zoneType + '"><i class="fa-solid fa-plus me-1"></i>Add another zone</button></div>' : '') +
          '</div></div>';
      }

      let zoneDescHtml = '';
      if (needsZone && zoneDesc) {
        zoneDescHtml = '<div class="d-flex align-items-start gap-2"><span class="lf-section-indicator purple"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="small text-muted" style="font-size: 10px; color: var(--lf-placeholder-color);">' + zoneDesc + '</div></div></div></div>';
      }

      const nodeDef = NODE_DEFINITIONS[agentType];
      const modelField = nodeDef && nodeDef.fields ? nodeDef.fields.find(f => f.key === 'model_name') : null;
      const modelOptions = modelField && modelField.options ? modelField.options : ['yolov8n.pt', 'yolov8m.pt'];
      const defaultModel = modelField && modelField.default ? modelField.default : 'yolov8m.pt';
      const currentModel = modelName || defaultModel;

      // Check if KB data is loaded (model from KB is read-only)
      const isKbLoaded = data.kb_loaded === true;
      const kbModelName = data.kb_model_name || currentModel;

      // Build model HTML - read-only display if from KB, otherwise dropdown
      let modelHtml = '';
      if (isKbLoaded && kbModelName) {
        // Read-only display for KB-loaded model
        modelHtml = '<div class="d-flex align-items-start gap-2"><span class="lf-section-indicator purple"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Model <small class="text-muted">(from KB)</small></div><div class="lf-input-wrapper"><input type="text" class="w-100 form-control form-control-sm" value="' + safe(kbModelName) + '" disabled readonly style="background: var(--lf-input-bg); opacity: 0.8; cursor: not-allowed;" /><input type="hidden" class="lf-node-input" data-field="model_name" data-node-id="' + (nodeId || '') + '" value="' + safe(kbModelName) + '" /></div></div></div></div>';
      } else {
        // Editable dropdown for non-KB or legacy nodes
        const modelSelectOptions = modelOptions.map(function(opt) {
          return '<option value="' + opt + '"' + (currentModel === opt ? ' selected' : '') + '>' + opt + '</option>';
        }).join('');
        modelHtml = '<div class="d-flex align-items-start gap-2"><span class="lf-section-indicator purple"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Model</div><div class="lf-input-wrapper"><select class="lf-node-input w-100 form-select form-select-sm" data-field="model_name" data-node-id="' + (nodeId || '') + '">' + modelSelectOptions + '</select></div></div></div></div>';
      }

      return '<div class="d-flex align-items-start gap-2"><span class="lf-section-indicator purple"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Agent Name</div><div class="lf-input-wrapper"><input type="text" class="lf-node-input w-100 form-control form-control-sm" data-field="agent_name" data-node-id="' + (nodeId || '') + '" placeholder="Optional" value="' + safe(agentName) + '" /></div></div></div></div>' +
        '<div class="d-flex align-items-start gap-2"><span class="lf-section-indicator cyan"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Rule Type</div><div class="lf-input-wrapper"><select class="lf-node-input w-100 form-select form-select-sm lf-agent-rule-select" data-field="rule_id" data-node-id="' + (nodeId || '') + '">' + ruleSelectOptions + '</select></div></div></div></div>' +
        ruleSpecificHtml +
        zoneDescHtml +
        zoneHtml +
        modelHtml +
        '<div class="d-flex align-items-start gap-2"><span class="lf-section-indicator cyan"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">FPS</div><div class="lf-input-wrapper"><input type="number" class="lf-node-input w-100 form-control form-control-sm" data-field="fps" data-node-id="' + (nodeId || '') + '" value="' + safe(fps) + '" step="1" min="1" max="60" /></div></div></div></div>' +
        '<div class="d-flex align-items-start gap-2"><span class="lf-section-indicator purple"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Confidence</div><div class="lf-input-wrapper"><input type="number" class="lf-node-input w-100 form-control form-control-sm" data-field="confidence_threshold" data-node-id="' + (nodeId || '') + '" value="' + safe(confidenceThreshold) + '" step="0.1" min="0" max="1" /></div></div></div></div>' +
        '<div class="d-flex align-items-start gap-2"><span class="lf-section-indicator cyan"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Alert cooldown (s)</div><div class="lf-input-wrapper"><input type="number" class="lf-node-input w-100 form-control form-control-sm" data-field="alert_cooldown_seconds" data-node-id="' + (nodeId || '') + '" value="' + safe(alertCooldown) + '" step="1" min="0" /></div></div></div></div>';
    }

    let cameraListCache = null;
    let cameraListFetchPromise = null;
    let kbRuleCache = {};

    async function fetchCameraList() {
      if (cameraListCache) return cameraListCache;
      if (cameraListFetchPromise) return cameraListFetchPromise;
      cameraListFetchPromise = (async () => {
        try {
          const token = getAuthToken();
          const headers = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;
          const response = await fetch(API_BASE + '/api/v1/cameras', { method: 'GET', headers });
          if (response.status === 401) { console.error('Authentication required for camera list'); return []; }
          if (!response.ok) throw new Error(`Failed to fetch cameras: ${response.status}`);
          const cameras = await response.json();
          cameraListCache = cameras;
          return cameras;
        } catch (error) {
          console.error('Error fetching camera list:', error);
          return [];
        } finally {
          cameraListFetchPromise = null;
        }
      })();
      return cameraListFetchPromise;
    }

    // Fetch rule configuration from Knowledge Base
    async function fetchRuleConfig(ruleId) {
      if (kbRuleCache[ruleId]) return kbRuleCache[ruleId];
      try {
        const token = getAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const response = await fetch(`${API_BASE}/api/v1/workflows/rules/${ruleId}`, { method: 'GET', headers });
        if (response.status === 401) { console.error('Authentication required for KB rule'); return null; }
        if (response.status === 404) { console.warn(`Rule '${ruleId}' not found in KB`); return null; }
        if (!response.ok) throw new Error(`Failed to fetch rule config: ${response.status}`);
        const ruleConfig = await response.json();
        kbRuleCache[ruleId] = ruleConfig;
        return ruleConfig;
      } catch (error) {
        console.error('Error fetching rule config from KB:', error);
        return null;
      }
    }

    function renderCameraSections(data, nodeId) {
      const safe = (v) => (v === undefined || v === null) ? '' : String(v).replace(/"/g, '&quot;');
      const cameraIds = data.camera_ids || '';
      const frameRate = data.frame_rate || 25;
      const label = data.label || 'Camera';
      return `
        <div class="d-flex align-items-start gap-2">
          <span class="lf-section-indicator purple"></span>
          <div class="flex-grow-1 min-w-0">
            <div class="mb-1">
              <div class="lf-field-label d-flex align-items-center gap-1 mb-1"><span>Node label</span></div>
              <div class="lf-input-wrapper position-relative">
                <input type="text" class="lf-node-input w-100 form-control form-control-sm" data-field="label" data-node-id="${nodeId || ''}" value="${safe(label)}" />
              </div>
            </div>
          </div>
        </div>
        <div class="d-flex align-items-start gap-2">
          <span class="lf-section-indicator cyan"></span>
          <div class="flex-grow-1 min-w-0">
            <div class="mb-1">
              <div class="lf-field-label d-flex align-items-center gap-1 mb-1"><span>Camera</span></div>
              <div class="lf-input-wrapper position-relative camera-dropdown-wrapper" data-node-id="${nodeId || ''}">
                <select class="lf-node-input w-100 form-select form-select-sm camera-select"
                        data-field="camera_ids"
                        data-node-id="${nodeId || ''}"
                        data-current-value="${safe(cameraIds)}">
                  <option value="">Loading cameras...</option>
                </select>
              </div>
            </div>
          </div>
        </div>
        <div class="d-flex align-items-start gap-2">
          <span class="lf-section-indicator cyan"></span>
          <div class="flex-grow-1 min-w-0">
            <div class="mb-1">
              <div class="lf-field-label d-flex align-items-center gap-1 mb-1"><span>Frame rate (fps)</span></div>
              <div class="lf-input-wrapper position-relative">
                <input type="number" class="lf-node-input w-100 form-control form-control-sm" data-field="frame_rate" data-node-id="${nodeId || ''}" value="${safe(frameRate)}" step="1" min="1" max="60" />
              </div>
            </div>
          </div>
        </div>
        <div class="camera-preview-panel" data-node-id="${nodeId || ''}">
          <div class="camera-preview-inner camera-preview--empty">
            <i class="fa-solid fa-camera camera-preview-icon"></i>
            <span class="camera-preview-hint">Select a camera to preview</span>
          </div>
        </div>
      `;
    }

    async function fetchAndShowCameraPreview(nodeId, cameraId) {
      const panel = document.querySelector(`.camera-preview-panel[data-node-id="${nodeId}"]`);
      if (!panel) return;

      if (!cameraId) {
        panel.innerHTML = `
          <div class="camera-preview-inner camera-preview--empty">
            <i class="fa-solid fa-camera camera-preview-icon"></i>
            <span class="camera-preview-hint">Select a camera to preview</span>
          </div>`;
        return;
      }

      panel.innerHTML = `
        <div class="camera-preview-inner camera-preview--loading">
          <div class="camera-preview-spinner"></div>
          <span class="camera-preview-hint">Loading preview…</span>
        </div>`;

      try {
        const result = await api.getCameraPreview(cameraId);
        const status = (result && result.status) ? result.status.toLowerCase() : 'unknown';
        const frame = result && result.frame_base64;
        const tsRaw = result && result.timestamp;
        let tsDate = null;
        if (tsRaw) {
          const asNum = Number(tsRaw);
          tsDate = isNaN(asNum) ? new Date(tsRaw) : new Date(asNum * 1000);
          if (isNaN(tsDate.getTime())) tsDate = null;
        }
        const ts = tsDate ? tsDate.toLocaleTimeString() : null;

        if (frame) {
          const isOnline = status === 'online' || status === 'active' || status === 'streaming';
          panel.innerHTML = `
            <div class="camera-preview-inner camera-preview--live">
              <div class="camera-preview-img-wrap">
                <img class="camera-preview-img" src="data:image/jpeg;base64,${frame}" alt="Camera preview" draggable="false" />
                <div class="camera-preview-badge camera-preview-badge--${isOnline ? 'online' : 'offline'}">
                  <span class="camera-preview-dot"></span>
                  ${isOnline ? 'Live' : status.charAt(0).toUpperCase() + status.slice(1)}
                </div>
                ${ts ? `<div class="camera-preview-ts">${ts}</div>` : ''}
              </div>
            </div>`;
        } else {
          const isOffline = status === 'offline' || status === 'disconnected' || status === 'error';
          panel.innerHTML = `
            <div class="camera-preview-inner camera-preview--offline">
              <i class="fa-solid fa-video-slash camera-preview-icon camera-preview-icon--offline"></i>
              <span class="camera-preview-status camera-preview-status--${isOffline ? 'offline' : 'warn'}">
                <span class="camera-preview-dot camera-preview-dot--${isOffline ? 'offline' : 'warn'}"></span>
                ${status.charAt(0).toUpperCase() + status.slice(1)}
              </span>
              <span class="camera-preview-hint">No frame available</span>
            </div>`;
        }
      } catch (err) {
        panel.innerHTML = `
          <div class="camera-preview-inner camera-preview--offline">
            <i class="fa-solid fa-triangle-exclamation camera-preview-icon camera-preview-icon--offline"></i>
            <span class="camera-preview-status camera-preview-status--offline">
              <span class="camera-preview-dot camera-preview-dot--offline"></span>
              Offline
            </span>
            <span class="camera-preview-hint">Could not reach camera</span>
          </div>`;
      }
    }

    function renderIoTActionSections(data, nodeId) {
      const safe = (v) => (v === undefined || v === null) ? '' : String(v).replace(/"/g, '&quot;');
      const label = data.label || 'IoT Action';
      const devices = Array.isArray(data.devices) ? data.devices : [];

      // Build a placeholder row per already-saved device (filled in by populateIoTDeviceRows later)
      const savedRows = devices.map((d, i) => `
        <div class="iot-device-row mb-2 p-2 rounded position-relative" style="background: var(--lf-input-bg); border: 1px solid var(--wf-canvas-border);" data-row-index="${i}">
          <button type="button" class="btn btn-sm btn-outline-danger iot-remove-row-btn position-absolute" data-row="${i}" data-node-id="${nodeId || ''}" style="top:4px;right:4px;padding:1px 5px;font-size:10px;line-height:1.2;" title="Remove">×</button>
          <div class="lf-field-label mb-1" style="font-size:9px;">Device</div>
          <select class="lf-node-input w-100 form-select form-select-sm iot-device-select mb-2"
                  data-field="device_id" data-row="${i}" data-node-id="${nodeId || ''}"
                  data-current-value="${safe(d.device_id)}">
            <option value="">Loading devices…</option>
          </select>
          <div class="lf-field-label mb-1" style="font-size:9px;">Device action</div>
          <select class="lf-node-input w-100 form-select form-select-sm iot-command-select mb-2" data-field="command" data-row="${i}" data-node-id="${nodeId || ''}">
            <option value="ON" ${d.command !== 'OFF' ? 'selected' : ''}>ON</option>
            <option value="OFF" ${d.command === 'OFF' ? 'selected' : ''}>OFF</option>
          </select>
          <div class="lf-field-label mb-1" style="font-size:9px;">Auto-reset time (seconds, 0 = none)</div>
          <input type="number" class="lf-node-input w-100 form-control form-control-sm iot-reset-input" data-field="auto_reset_seconds" data-row="${i}" data-node-id="${nodeId || ''}" placeholder="0" value="${safe(d.auto_reset_seconds ?? 0)}" min="0" />
        </div>
      `).join('');

      return `
        <div class="d-flex align-items-start gap-2">
          <span class="lf-section-indicator purple"></span>
          <div class="flex-grow-1 min-w-0">
            <div class="mb-1">
              <div class="lf-field-label mb-1">Node label</div>
              <div class="lf-input-wrapper">
                <input type="text" class="lf-node-input w-100 form-control form-control-sm" data-field="label" data-node-id="${nodeId || ''}" value="${safe(label)}" />
              </div>
            </div>
          </div>
        </div>
        <div class="d-flex align-items-start gap-2">
          <span class="lf-section-indicator cyan"></span>
          <div class="flex-grow-1 min-w-0">
            <div class="mb-1">
              <div class="lf-field-label mb-1 d-flex justify-content-between align-items-center">
                <span>Devices</span>
                <button type="button" class="btn btn-sm btn-outline-secondary iot-add-device-btn" data-node-id="${nodeId || ''}" style="padding: 1px 6px; font-size: 11px;">+ Add</button>
              </div>
              <div class="iot-device-list" data-node-id="${nodeId || ''}">
                ${savedRows || '<div class="text-muted small py-1">No devices added yet.</div>'}
              </div>
            </div>
          </div>
        </div>
        <div class="d-flex align-items-start gap-2">
          <span class="lf-section-indicator purple"></span>
          <div class="flex-grow-1 min-w-0 small text-muted" style="font-size:10px; padding-top: 2px;">
            Ch = relay channel &nbsp;|&nbsp; Reset(s) = auto-OFF delay (0 = none)
          </div>
        </div>
      `;
    }

    async function fetchIoTDeviceList() {
      try {
        const res = await fetch('/api/v1/workflows/iot-devices', {
          headers: { 'Authorization': `Bearer ${localStorage.getItem('access_token') || ''}` }
        });
        if (!res.ok) return [];
        const json = await res.json();
        return json.devices || [];
      } catch (e) {
        console.warn('[IoTAction] Could not fetch devices:', e);
        return [];
      }
    }

    async function populateIoTDeviceRows(nodeId) {
      const devices = await fetchIoTDeviceList();
      const nodeEl = document.getElementById('node-' + nodeId);
      if (!nodeEl) return;

      nodeEl.querySelectorAll('.iot-device-select').forEach(select => {
        const currentValue = select.getAttribute('data-current-value') || '';
        select.innerHTML = '<option value="">Select device…</option>';
        if (devices.length === 0) {
          select.innerHTML = '<option value="">No devices registered</option>';
          return;
        }
        devices.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.device_id;
          opt.textContent = `${d.name || d.device_id} (${d.type})`;
          if (currentValue === d.device_id) opt.selected = true;
          select.appendChild(opt);
        });
      });
    }

    function addIoTDeviceRow(nodeId) {
      const listEl = document.querySelector(`.iot-device-list[data-node-id="${nodeId}"]`);
      if (!listEl) return;

      // Remove "no devices" placeholder if present
      const placeholder = listEl.querySelector('.text-muted');
      if (placeholder) placeholder.remove();

      const rowIndex = listEl.querySelectorAll('.iot-device-row').length;
      const rowHtml = `
        <div class="iot-device-row mb-2 p-2 rounded position-relative" style="background: var(--lf-input-bg); border: 1px solid var(--wf-canvas-border);" data-row-index="${rowIndex}">
          <button type="button" class="btn btn-sm btn-outline-danger iot-remove-row-btn position-absolute" data-row="${rowIndex}" data-node-id="${nodeId}" style="top:4px;right:4px;padding:1px 5px;font-size:10px;line-height:1.2;" title="Remove">×</button>
          <div class="lf-field-label mb-1" style="font-size:9px;">Device</div>
          <select class="lf-node-input w-100 form-select form-select-sm iot-device-select mb-2"
                  data-field="device_id" data-row="${rowIndex}" data-node-id="${nodeId}"
                  data-current-value="">
            <option value="">Loading devices…</option>
          </select>
          <div class="lf-field-label mb-1" style="font-size:9px;">Device action</div>
          <select class="lf-node-input w-100 form-select form-select-sm iot-command-select mb-2" data-field="command" data-row="${rowIndex}" data-node-id="${nodeId}">
            <option value="ON" selected>ON</option>
            <option value="OFF">OFF</option>
          </select>
          <div class="lf-field-label mb-1" style="font-size:9px;">Auto-reset time (seconds, 0 = none)</div>
          <input type="number" class="lf-node-input w-100 form-control form-control-sm iot-reset-input" data-field="auto_reset_seconds" data-row="${rowIndex}" data-node-id="${nodeId}" placeholder="0" value="0" min="0" />
        </div>
      `;
      listEl.insertAdjacentHTML('beforeend', rowHtml);

      // Populate the new row's device select
      fetchIoTDeviceList().then(devices => {
        const newSelect = listEl.querySelector(`.iot-device-row[data-row-index="${rowIndex}"] .iot-device-select`);
        if (!newSelect) return;
        newSelect.innerHTML = '<option value="">Select device…</option>';
        devices.forEach(d => {
          const opt = document.createElement('option');
          opt.value = d.device_id;
          opt.textContent = `${d.name || d.device_id} (${d.type})`;
          newSelect.appendChild(opt);
        });
      });

      syncIoTDevicesField(nodeId);
    }

    function syncIoTDevicesField(nodeId) {
      // Read all device rows from the DOM and write back to Drawflow node data
      const nodeEl = document.getElementById('node-' + nodeId);
      if (!nodeEl) return;
      const rows = nodeEl.querySelectorAll('.iot-device-row');
      const devices = [];
      rows.forEach(row => {
        const deviceId = row.querySelector('.iot-device-select')?.value || '';
        if (!deviceId) return;
        devices.push({
          device_id:          deviceId,
          command:            row.querySelector('.iot-command-select')?.value || 'ON',
          auto_reset_seconds: parseInt(row.querySelector('.iot-reset-input')?.value || '0', 10),
        });
      });
      if (editor && editor.drawflow.drawflow.Home.data[nodeId]) {
        editor.drawflow.drawflow.Home.data[nodeId].data.devices = devices;
      }
    }

    // Delegate click/change events for IoT device rows
    function _iotClickHandler(e) {
      // Add device button
      const addBtn = e.target.closest('.iot-add-device-btn');
      if (addBtn) { addIoTDeviceRow(addBtn.dataset.nodeId); return; }

      // Remove row button
      const removeBtn = e.target.closest('.iot-remove-row-btn');
      if (removeBtn) {
        const row = removeBtn.closest('.iot-device-row');
        const nId = removeBtn.dataset.nodeId;
        if (row) { row.remove(); syncIoTDevicesField(nId); }
        return;
      }
    }
    document.addEventListener('click', _iotClickHandler);

    function _iotChangeHandler(e) {
      const el = e.target;
      if (el.matches('.iot-device-select, .iot-command-select, .iot-reset-input')) {
        const nId = el.dataset.nodeId;
        if (nId) syncIoTDevicesField(nId);
      }
    }
    document.addEventListener('change', _iotChangeHandler, true);

    function renderStartSections(data, nodeId) {
      const safe = (v) => (v === undefined || v === null) ? '' : String(v).replace(/"/g, '&quot;');
      const label = data.label || 'Start';
      const description = data.description || '';
      const scheduleType = data.schedule_type || 'always';
      const startTime = data.start_time || '';
      const endTime = data.end_time || '';
      const activeDaysStr = data.active_days || '';
      const runMode = data.run_mode || 'continuous';
      const intervalMinutes = data.interval_minutes ?? 10;
      const checkDuration = data.check_duration_seconds ?? 30;
      const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
      const activeSet = new Set((typeof activeDaysStr === 'string' ? activeDaysStr.split(',') : []).map(s => s.trim()).filter(Boolean));
      const dayChecks = DAYS.map(d => '<div class="form-check form-check-inline m-0"><input class="form-check-input lf-node-input" type="checkbox" data-field="active_days" data-node-id="' + (nodeId || '') + '" data-day="' + d + '" id="wf-day-' + (nodeId || '') + '-' + d + '"' + (activeSet.has(d) ? ' checked' : '') + '><label class="form-check-label small" for="wf-day-' + (nodeId || '') + '-' + d + '">' + d.charAt(0).toUpperCase() + d.slice(1, 3) + '</label></div>').join('');

      return `
        <div class="d-flex align-items-start gap-2"><span class="lf-section-indicator purple"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Label</div><div class="lf-input-wrapper"><input type="text" class="lf-node-input w-100 form-control form-control-sm" data-field="label" data-node-id="${nodeId || ''}" value="${safe(label)}" /></div></div></div></div>
        <div class="d-flex align-items-start gap-2"><span class="lf-section-indicator cyan"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Description</div><div class="lf-input-wrapper"><textarea class="lf-node-input w-100 form-control form-control-sm" data-field="description" data-node-id="${nodeId || ''}" placeholder="Describe the purpose of this workflow entry point.">${safe(description)}</textarea></div></div></div></div>
        <div class="d-flex align-items-start gap-2"><span class="lf-section-indicator purple"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Schedule</div><div class="lf-input-wrapper"><select class="lf-node-input w-100 form-select form-select-sm lf-start-schedule-select" data-field="schedule_type" data-node-id="${nodeId || ''}"><option value="always" ${scheduleType === 'always' ? 'selected' : ''}>Always</option><option value="daily" ${scheduleType === 'daily' ? 'selected' : ''}>Daily</option><option value="weekly" ${scheduleType === 'weekly' ? 'selected' : ''}>Weekly</option><option value="once" ${scheduleType === 'once' ? 'selected' : ''}>Once</option></select></div></div></div></div>
        <div class="d-flex align-items-start gap-2 wf-sched-once-group ${scheduleType !== 'once' ? 'wf-sched-hidden' : ''}"><span class="lf-section-indicator purple"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">From (datetime)</div><div class="lf-input-wrapper"><input type="datetime-local" class="lf-node-input w-100 form-control form-control-sm" data-field="start_time" data-node-id="${nodeId || ''}" value="${safe(startTime)}" /></div></div></div></div>
        <div class="d-flex align-items-start gap-2 wf-sched-once-group ${scheduleType !== 'once' ? 'wf-sched-hidden' : ''}"><span class="lf-section-indicator cyan"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Until (datetime)</div><div class="lf-input-wrapper"><input type="datetime-local" class="lf-node-input w-100 form-control form-control-sm" data-field="end_time" data-node-id="${nodeId || ''}" value="${safe(endTime)}" /></div></div></div></div>
        <div class="d-flex align-items-start gap-2 wf-sched-tod-group ${scheduleType !== 'daily' && scheduleType !== 'weekly' ? 'wf-sched-hidden' : ''}"><span class="lf-section-indicator purple"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">From (time)</div><div class="lf-input-wrapper"><input type="time" class="lf-node-input w-100 form-control form-control-sm" data-field="start_time" data-node-id="${nodeId || ''}" value="${safe(startTime)}" /></div></div></div></div>
        <div class="d-flex align-items-start gap-2 wf-sched-tod-group ${scheduleType !== 'daily' && scheduleType !== 'weekly' ? 'wf-sched-hidden' : ''}"><span class="lf-section-indicator cyan"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Until (time)</div><div class="lf-input-wrapper"><input type="time" class="lf-node-input w-100 form-control form-control-sm" data-field="end_time" data-node-id="${nodeId || ''}" value="${safe(endTime)}" /></div></div></div></div>
        <div class="d-flex align-items-start gap-2 wf-sched-days-group ${scheduleType !== 'weekly' ? 'wf-sched-hidden' : ''}"><span class="lf-section-indicator purple"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Active days</div><div class="d-flex flex-wrap gap-1">${dayChecks}</div></div></div></div>
        <div class="d-flex align-items-start gap-2"><span class="lf-section-indicator cyan"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Run mode</div><div class="lf-input-wrapper"><select class="lf-node-input w-100 form-select form-select-sm" data-field="run_mode" data-node-id="${nodeId || ''}"><option value="continuous" ${runMode === 'continuous' ? 'selected' : ''}>Continuous</option><option value="patrol" ${runMode === 'patrol' ? 'selected' : ''}>Patrol</option></select></div></div></div></div>
        <div class="d-flex align-items-start gap-2 wf-sched-patrol-group ${runMode !== 'patrol' ? 'wf-sched-hidden' : ''}"><span class="lf-section-indicator purple"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Interval (min)</div><div class="lf-input-wrapper"><input type="number" class="lf-node-input w-100 form-control form-control-sm" data-field="interval_minutes" data-node-id="${nodeId || ''}" min="1" max="1440" value="${safe(intervalMinutes)}" /></div></div></div></div>
        <div class="d-flex align-items-start gap-2 wf-sched-patrol-group ${runMode !== 'patrol' ? 'wf-sched-hidden' : ''}"><span class="lf-section-indicator cyan"></span><div class="flex-grow-1 min-w-0"><div class="mb-1"><div class="lf-field-label mb-1">Check duration (sec)</div><div class="lf-input-wrapper"><input type="number" class="lf-node-input w-100 form-control form-control-sm" data-field="check_duration_seconds" data-node-id="${nodeId || ''}" min="1" max="86400" value="${safe(checkDuration)}" /></div></div></div></div>
      `;
    }

    async function populateCameraDropdowns() {
      const cameras = await fetchCameraList();
      document.querySelectorAll('.camera-select').forEach(select => {
        const nodeId = select.getAttribute('data-node-id');
        let node = null;
        try { node = editor && nodeId && editor.getNodeFromId(nodeId); } catch (_) {};
        const currentValue = (node && node.data && node.data.camera_ids != null) ? String(node.data.camera_ids).split(',')[0].trim() : (select.getAttribute('data-current-value') || '').split(',')[0].trim();
        select.innerHTML = '';
        if (cameras.length === 0) {
          const option = document.createElement('option');
          option.value = '';
          option.textContent = 'No cameras available';
          select.appendChild(option);
        } else {
          const placeholder = document.createElement('option');
          placeholder.value = '';
          placeholder.textContent = 'Select a camera...';
          select.appendChild(placeholder);
          cameras.forEach(camera => {
            const option = document.createElement('option');
            option.value = camera.id;
            option.textContent = camera.name || camera.id;
            if (currentValue === camera.id) option.selected = true;
            select.appendChild(option);
          });
        }
        // Load preview for any pre-selected camera (saved workflow)
        if (nodeId && currentValue) fetchAndShowCameraPreview(nodeId, currentValue);
      });
    }

    function populateAllIoTDeviceRows() {
      const data = editor?.drawflow?.drawflow?.Home?.data || {};
      Object.keys(data).forEach(nodeId => {
        if (data[nodeId]?.name === 'iot_action') populateIoTDeviceRows(nodeId);
      });
    }

    // ── renderInlineField ────────────────────────────────────────────────────
    // UPDATED: supports field.showIf = { field: 'key', value: 'matchValue' }
    // When showIf is defined, the wrapper div gets data-show-if-field and
    // data-show-if-value attributes, and starts hidden.
    // The document 'change' listener (below) shows/hides it live.
    // applyShowIfRules() restores correct visibility when loading saved data.
    function renderInlineField(field, value, index, nodeName) {
      const safe = (v) => (v === undefined || v === null) ? '' : String(v).replace(/"/g, '&quot;');
      const indicatorColor = index % 2 === 0 ? 'purple' : 'cyan';

      let inputHtml = '';
      const placeholder = field.placeholder || '';

      switch (field.type) {
        case 'text':
        case 'date':
        case 'time':
          inputHtml = `<input type="${field.type}" class="lf-node-input w-100 form-control form-control-sm" data-field="${field.key}" placeholder="${placeholder}" value="${safe(value)}" />`;
          break;
        case 'number':
          inputHtml = `<input type="number" class="lf-node-input w-100 form-control form-control-sm" data-field="${field.key}" placeholder="${placeholder}" value="${safe(value)}" step="any" />`;
          break;
        case 'select':
          const options = (field.options || []).map(opt =>
            `<option value="${opt}" ${String(value) === String(opt) ? 'selected' : ''}>${opt}</option>`
          ).join('');
          inputHtml = `<select class="lf-node-input w-100 form-select form-select-sm" data-field="${field.key}">${options}</select>`;
          break;
        case 'camera_select':
          return '';
        case 'iot_devices':
          return '';
        case 'textarea':
          inputHtml = `<textarea class="lf-node-input w-100 form-control form-control-sm" data-field="${field.key}" placeholder="${placeholder}">${safe(value)}</textarea>`;
          break;
        case 'readonly':
          inputHtml = `<input type="text" class="lf-readonly-input w-100 form-control form-control-sm" value="${safe(field.value || value)}" disabled />`;
          break;
        case 'checkbox': {
          // value can be boolean true/false or string "true"/"false" (from saved JSON)
          const isChecked = (value === true || value === 'true')
            ? 'checked'
            : (value === false || value === 'false' ? '' : (field.default ? 'checked' : ''));
          // Checkbox renders inline with its label — no separate label div needed
          inputHtml = `
            <div class="form-check form-switch mb-0">
              <input class="form-check-input lf-node-input" type="checkbox" role="switch"
                     data-field="${field.key}" id="wf-chk-${field.key}-${safe(value)}"
                     ${isChecked} />
              <label class="form-check-label small" for="wf-chk-${field.key}-${safe(value)}"
                     style="color:var(--lf-label-color);">${field.label || field.key}</label>
            </div>`;
          // Checkbox has its own label — skip the outer label div
          return `
            <div class="d-flex align-items-start gap-2" style="padding:2px 0;">
              <span class="lf-section-indicator ${indicatorColor}"></span>
              <div class="flex-grow-1 min-w-0 pt-1">${inputHtml}</div>
            </div>`;
        }
        default:
          inputHtml = `<input type="text" class="lf-node-input w-100 form-control form-control-sm" data-field="${field.key}" placeholder="${placeholder}" value="${safe(value)}" />`;
      }

      // showIf: conditional visibility — supports string and boolean match values
      const hasShowIf = field.showIf && field.showIf.field;
      const showIfVal  = hasShowIf ? String(field.showIf.value) : '';
      const showIfAttrs = hasShowIf
        ? `data-show-if-field="${field.showIf.field}" data-show-if-value="${showIfVal}"`
        : '';
      // Start hidden if showIf is defined; applyShowIfRules() will reveal if matched
      const hiddenStyle = hasShowIf ? 'display:none;' : '';

      return `
        <div class="d-flex align-items-start gap-2" ${showIfAttrs} style="${hiddenStyle}">
          <span class="lf-section-indicator ${indicatorColor}"></span>
          <div class="flex-grow-1 min-w-0">
            <div class="mb-1">
              <div class="lf-field-label d-flex align-items-center gap-1 mb-1">
                <span>${field.label || field.key}</span>
                ${field.help ? `<i class="fa-regular fa-circle-question" title="${field.help}"></i>` : ''}
              </div>
              <div class="lf-input-wrapper position-relative">
                ${inputHtml}
              </div>
            </div>
          </div>
        </div>
      `;
    }

    // ── showIf live change listener ──────────────────────────────────────────
    // Listens for changes on any .lf-node-input select/input.
    // When the changed field matches a sibling's data-show-if-field, that
    // sibling is shown or hidden depending on whether values match.
    function _showIfChangeHandler(e) {
      const input = e.target;
      if (!input.matches('.lf-node-input')) return;

      const changedFieldKey = input.dataset.field;
      const changedValue    = input.value;

      // Walk up to the drawflow node container
      const nodeEl = input.closest('.drawflow-node');
      if (!nodeEl) return;

      // Show/hide any conditional field wrappers that depend on this field.
      // For checkboxes the trigger value is "true"/"false" based on .checked.
      const triggerValue = input.type === 'checkbox' ? String(input.checked) : changedValue;
      nodeEl.querySelectorAll('[data-show-if-field]').forEach(wrapper => {
        if (wrapper.dataset.showIfField === changedFieldKey) {
          wrapper.style.display = (triggerValue === wrapper.dataset.showIfValue) ? '' : 'none';
        }
      });

      // Camera preview: refresh when camera selection changes
      if (changedFieldKey === 'camera_ids') {
        const nodeId = input.dataset.nodeId;
        if (nodeId) fetchAndShowCameraPreview(nodeId, changedValue);
      }
    }
    document.addEventListener('change', _showIfChangeHandler);

    // ── applyShowIfRules ─────────────────────────────────────────────────────
    // Call this after node HTML is inserted into the DOM (new node drop or
    // workflow load) so that saved values are applied and fields are shown
    // or hidden correctly without requiring user interaction.
    function applyShowIfRules(nodeEl) {
      if (!nodeEl) return;
      nodeEl.querySelectorAll('.lf-node-input').forEach(input => {
        const fieldKey = input.dataset.field;
        if (!fieldKey) return;
        // Use checked state for checkboxes so boolean showIf works correctly
        const value = input.type === 'checkbox' ? String(input.checked) : input.value;
        nodeEl.querySelectorAll('[data-show-if-field="' + fieldKey + '"]').forEach(wrapper => {
          wrapper.style.display = (value === wrapper.dataset.showIfValue) ? '' : 'none';
        });
      });
    }

    function initialDataFor(def) {
      const data = {};
      (def.fields || []).forEach(f => {
        if (f.default !== undefined) data[f.key] = f.default;
      });
      data.__label = def.label;
      return data;
    }

    function areNodesCompatible(sourceNodeKey, targetNodeKey) {
      const compatibleNodes = NODE_COMPATIBILITY[sourceNodeKey] || [];
      return compatibleNodes.includes(targetNodeKey);
    }

    function updateNodeCompatibility(selectedNodeKey) {
      const allNodes = document.querySelectorAll('.wf-section-item[data-node-key]');
      if (!selectedNodeKey) {
        allNodes.forEach(node => { node.classList.remove('compatible', 'incompatible'); node.classList.add('neutral'); });
        return;
      }
      const compatibleNodes = NODE_COMPATIBILITY[selectedNodeKey] || [];
      allNodes.forEach(node => {
        const nodeKey = node.getAttribute('data-node-key');
        node.classList.remove('compatible', 'incompatible', 'neutral');
        if (nodeKey === selectedNodeKey) node.classList.add('neutral');
        else if (compatibleNodes.includes(nodeKey)) node.classList.add('compatible');
        else node.classList.add('incompatible');
      });
    }

    function resetPortsVisibility() {
      document.querySelectorAll('.drawflow-node .input, .drawflow-node .output').forEach(el => {
        el.classList.remove('hidden-port');
      });
    }

    function showOnlyApplicablePorts(sourceNodeKey) {
      if (!sourceNodeKey) { resetPortsVisibility(); return; }
      const compatibleTargets = new Set(NODE_COMPATIBILITY[sourceNodeKey] || []);
      const data = editor?.drawflow?.drawflow?.Home?.data || {};
      Object.keys(data).forEach(id => {
        const dfNode = data[id];
        const nodeEl = document.querySelector(`#node-${id}`);
        if (!nodeEl) return;
        const inputs = nodeEl.querySelectorAll('.input');
        const outputs = nodeEl.querySelectorAll('.output');
        const nodeKey = dfNode?.name;
        if (nodeKey === sourceNodeKey) {
          inputs.forEach(i => i.classList.add('hidden-port'));
          outputs.forEach(o => o.classList.remove('hidden-port'));
          return;
        }
        if (compatibleTargets.has(nodeKey)) {
          inputs.forEach(i => i.classList.remove('hidden-port'));
          outputs.forEach(o => o.classList.add('hidden-port'));
        } else {
          inputs.forEach(i => i.classList.add('hidden-port'));
          outputs.forEach(o => o.classList.add('hidden-port'));
        }
      });
    }

    function resetNodeCompatibility() { updateNodeCompatibility(null); }

    function getNodeKeyFromCanvasNode(nodeId) {
      const node = editor.getNodeFromId(nodeId);
      return node ? node.name : null;
    }

    function getConnectedCameraId(nodeId) {
      const data = editor.drawflow.drawflow.Home.data;
      const node = data[nodeId];
      if (!node || !node.inputs) return null;
      for (const key of Object.keys(node.inputs)) {
        const conns = node.inputs[key].connections || [];
        if (conns.length > 0) {
          const sourceId = conns[0].node;
          const source = data[sourceId];
          if (source && source.name === 'camera' && source.data) {
            const ids = source.data.camera_ids;
            if (typeof ids === 'string') { const first = ids.split(',')[0].trim(); return first || null; }
            return ids || null;
          }
        }
      }
      return null;
    }

    function getUpstreamSchedulerId(nodeId) {
      const data = editor.drawflow.drawflow.Home.data;
      for (const id of Object.keys(data)) { if (data[id].name === 'start') return id; }
      return null;
    }

    function getUpstreamNodeId(nodeId) {
      const data = editor?.drawflow?.drawflow?.Home?.data || {};
      const node = data[nodeId];
      if (!node || !node.inputs) return null;
      for (const key of Object.keys(node.inputs)) {
        const conns = node.inputs[key].connections || [];
        if (conns.length > 0) return conns[0].node;
      }
      return null;
    }

    function updateNotificationNodesForSchedule() {
      const data = editor?.drawflow?.drawflow?.Home?.data || {};
      Object.keys(data).forEach(function (id) {
        const node = data[id];
        if (node.name !== 'notification') return;
        const nodeEl = document.getElementById('node-' + id);
        if (!nodeEl) return;
        const schedulerId = getUpstreamSchedulerId(id);
        const scheduler = schedulerId && data[schedulerId] ? data[schedulerId] : null;
        const scheduleType = scheduler && scheduler.data ? (scheduler.data.schedule_type || 'always') : 'always';
        if (scheduleType === 'always') nodeEl.classList.add('wf-no-end');
        else nodeEl.classList.remove('wf-no-end');
      });
      Object.keys(data).forEach(function (id) {
        const node = data[id];
        if (node.name !== 'end') return;
        const nodeEl = document.getElementById('node-' + id);
        if (!nodeEl) return;
        const sourceId = getUpstreamNodeId(id);
        const source = sourceId && data[sourceId] ? data[sourceId] : null;
        if (source && source.name === 'notification') {
          const schedulerId = getUpstreamSchedulerId(sourceId);
          const scheduler = schedulerId && data[schedulerId] ? data[schedulerId] : null;
          const scheduleType = scheduler && scheduler.data ? (scheduler.data.schedule_type || 'always') : 'always';
          if (scheduleType === 'always') nodeEl.classList.add('wf-end-unused');
          else nodeEl.classList.remove('wf-end-unused');
        } else {
          nodeEl.classList.remove('wf-end-unused');
        }
      });
    }

    function hasUnusedEndNode() {
      const data = editor?.drawflow?.drawflow?.Home?.data || {};
      for (const id of Object.keys(data)) {
        const node = data[id];
        if (node.name !== 'end') continue;
        const sourceId = getUpstreamNodeId(id);
        const source = sourceId && data[sourceId] ? data[sourceId] : null;
        if (source && source.name === 'notification') {
          const schedulerId = getUpstreamSchedulerId(sourceId);
          const scheduler = schedulerId && data[schedulerId] ? data[schedulerId] : null;
          const scheduleType = scheduler && scheduler.data ? (scheduler.data.schedule_type || 'always') : 'always';
          if (scheduleType === 'always') return true;
        }
      }
      return false;
    }

    function validateConnection(sourceNodeId, targetNodeId) {
      const sourceNodeKey = getNodeKeyFromCanvasNode(sourceNodeId);
      const targetNodeKey = getNodeKeyFromCanvasNode(targetNodeId);
      if (!sourceNodeKey || !targetNodeKey) return false;
      if (sourceNodeKey === 'notification' && targetNodeKey === 'end') {
        const schedulerId = getUpstreamSchedulerId(sourceNodeId);
        const data = editor?.drawflow?.drawflow?.Home?.data || {};
        const scheduler = schedulerId && data[schedulerId] ? data[schedulerId] : null;
        const scheduleType = scheduler && scheduler.data ? (scheduler.data.schedule_type || 'always') : 'always';
        if (scheduleType === 'always') return false;
      }
      return areNodesCompatible(sourceNodeKey, targetNodeKey);
    }

    function getBindEvent(exportedFlow) {
      if (!exportedFlow || !exportedFlow.drawflow || !exportedFlow.drawflow.Home || !exportedFlow.drawflow.Home.data) return null;
      const startNodeId = exportedFlow?.meta?.start_node;
      if (startNodeId) {
        const startNode = exportedFlow.drawflow.Home.data[startNodeId];
        if (startNode) {
          const cat = NODE_DEFINITIONS[startNode.name]?.category;
          if (cat === 'trigger') return startNode.name;
          if (cat === 'start') {
            const outs = startNode.outputs || {};
            for (const key of Object.keys(outs)) {
              const conns = outs[key]?.connections || [];
              if (conns.length > 0) {
                const nextId = conns[0].node;
                const next = exportedFlow.drawflow.Home.data[nextId];
                if (next) return next.name;
              }
            }
          }
        }
      }
      const nodes = exportedFlow.drawflow.Home.data;
      let fallbackFirstRoot = null;
      for (const id of Object.keys(nodes)) {
        const n = nodes[id];
        const inputs = n.inputs || {};
        let incoming = 0;
        for (const key of Object.keys(inputs)) { incoming += (inputs[key]?.connections || []).length; }
        if (incoming === 0) {
          if (!fallbackFirstRoot) fallbackFirstRoot = n;
          const cat = NODE_DEFINITIONS[n.name]?.category;
          if (cat === 'start') {
            const outs = n.outputs || {};
            for (const ok of Object.keys(outs)) {
              const conns = outs[ok]?.connections || [];
              if (conns.length > 0) {
                const nextId = conns[0].node;
                const next = nodes[nextId];
                if (next) return next.name;
              }
            }
          }
          if (cat === 'trigger') return n.name;
        }
      }
      if (fallbackFirstRoot) return fallbackFirstRoot.name;
      return null;
    }

    function findStartNodeId(exportedFlow) {
      try {
        const nodes = exportedFlow?.drawflow?.Home?.data || {};
        for (const id of Object.keys(nodes)) {
          const n = nodes[id];
          if (NODE_DEFINITIONS[n.name]?.category === 'start') return id;
        }
      } catch (e) { }
      return undefined;
    }

    function prepareWorkflowData(flowData) {
      flowData.meta = flowData.meta || {};
      const maybeStartId = findStartNodeId(flowData);
      if (maybeStartId) flowData.meta.start_node = maybeStartId;
      flowData.meta.edges = extractActualEdges(flowData);
      flowData.meta.nodes = extractNodeMetadata(flowData);
      return flowData;
    }

    function extractActualEdges(exportedFlow) {
      const edges = [];
      try {
        const nodes = exportedFlow?.drawflow?.Home?.data || {};
        for (const nodeId of Object.keys(nodes)) {
          const node = nodes[nodeId];
          if (node.outputs) {
            for (const outputKey of Object.keys(node.outputs)) {
              const output = node.outputs[outputKey];
              if (output.connections && Array.isArray(output.connections)) {
                for (const conn of output.connections) { edges.push([nodeId, conn.node]); }
              }
            }
          }
        }
      } catch (e) { console.error('Error extracting edges:', e); }
      return edges;
    }

    function extractNodeMetadata(exportedFlow) {
      const nodeMetadata = {};
      try {
        const nodes = exportedFlow?.drawflow?.Home?.data || {};
        for (const nodeId of Object.keys(nodes)) {
          const node = nodes[nodeId];
          nodeMetadata[nodeId] = { name: node.name, original_name: node.name, props: node.data || {} };
        }
      } catch (e) { console.error('Error extracting node metadata:', e); }
      return nodeMetadata;
    }

    const editor = new Drawflow(container);
    editor.reroute = true;
    editor.start();

    let dragNodeKey = null;
    let selectedNodeForConnection = null;

    // ── Node hint tooltip (body-level div, escapes sidebar overflow:hidden) ──
    const _tt = document.createElement('div');
    _tt.id = 'wf-node-tooltip';
    document.body.appendChild(_tt);
    let _ttTimer = null;

    function showNodeTooltip(el, hint) {
      clearTimeout(_ttTimer);
      _tt.textContent = hint;
      _tt.classList.remove('visible');
      const rect = el.getBoundingClientRect();
      // Position to the right of the sidebar item; flip left if no room
      const gap = 10;
      let left = rect.right + gap;
      const ttWidth = 220;
      if (left + ttWidth > window.innerWidth - 8) {
        left = rect.left - ttWidth - gap;
      }
      let top = rect.top + rect.height / 2;
      _tt.style.left = Math.max(8, left) + 'px';
      _tt.style.top = top + 'px';
      _tt.style.transform = 'translateY(-50%)';
      // Small delay before showing so fast mouse passes don't flash
      _ttTimer = setTimeout(function () { _tt.classList.add('visible'); }, 180);
    }

    function hideNodeTooltip() {
      clearTimeout(_ttTimer);
      _tt.classList.remove('visible');
    }

    document.querySelectorAll('.wf-section-item[draggable="true"]').forEach(el => {
      el.addEventListener('dragstart', ev => {
        dragNodeKey = el.getAttribute('data-node-key');
        ev.dataTransfer.setData('node', dragNodeKey);
        hideNodeTooltip();
      });
      el.addEventListener('click', () => {
        const nodeKey = el.getAttribute('data-node-key');
        if (selectedNodeForConnection === nodeKey) {
          selectedNodeForConnection = null;
          resetNodeCompatibility();
        } else {
          selectedNodeForConnection = nodeKey;
          updateNodeCompatibility(nodeKey);
        }
      });
      const hint = el.getAttribute('data-node-hint');
      if (hint) {
        el.addEventListener('mouseenter', function () { showNodeTooltip(el, hint); });
        el.addEventListener('mouseleave', hideNodeTooltip);
        el.addEventListener('mousemove', function (e) {
          // Keep tooltip near cursor vertically when hovering
          let left = e.clientX + 14;
          const ttWidth = 220;
          if (left + ttWidth > window.innerWidth - 8) left = e.clientX - ttWidth - 14;
          _tt.style.left = Math.max(8, left) + 'px';
          _tt.style.top = e.clientY + 'px';
          _tt.style.transform = 'translateY(-50%)';
        });
      }
    });

    function hasStartNode() {
      const data = editor?.drawflow?.drawflow?.Home?.data || {};
      return Object.values(data).some(node => node && node.name === 'start');
    }

    function addDefaultStartNode() {
      if (hasStartNode()) return;
      const def = NODE_DEFINITIONS['start'];
      const data = initialDataFor(def);
      const html = createNodeContentHtml(def, data);
      editor.addNode('start', def.inputs, def.outputs, 40, 120, 'start', data, html);
    }

    // ── Sidebar search filter ─────────────────────────────────────────────────
    const sidebarSearch = document.getElementById('wf-sidebar-search');
    if (sidebarSearch) {
      sidebarSearch.addEventListener('input', function () {
        const q = this.value.trim().toLowerCase();
        document.querySelectorAll('#wf-sidebar-node-list .wf-section-item[data-node-key]').forEach(function (el) {
          if (!q) {
            el.removeAttribute('data-hidden');
            return;
          }
          const key = (el.getAttribute('data-node-key') || '').toLowerCase();
          const label = (el.textContent || '').toLowerCase();
          const hint = (el.getAttribute('data-node-hint') || '').toLowerCase();
          const match = key.includes(q) || label.includes(q) || hint.includes(q);
          el.setAttribute('data-hidden', match ? 'false' : 'true');
        });
        // Hide empty section headers
        document.querySelectorAll('#wf-sidebar-node-list .wf-section').forEach(function (sec) {
          const visible = sec.querySelectorAll('.wf-section-item:not([data-hidden="true"])').length > 0;
          sec.style.display = visible ? '' : 'none';
        });
      });
    }

    container.addEventListener('dragover', ev => ev.preventDefault());

    container.addEventListener('drop', ev => {
      ev.preventDefault();
      const key = ev.dataTransfer.getData('node') || dragNodeKey;
      if (!key || !NODE_DEFINITIONS[key]) return;
      // Prevent adding multiple Start Nodes
      if (key === 'start' && hasStartNode()) {
        toast.warning('A Start Node already exists. Only one Start Node is allowed per workflow.');
        return;
      }
      const def = NODE_DEFINITIONS[key];

      // --- Accurate drop-position calculation ---
      // Use Drawflow's transformed precanvas as coordinate source. This keeps
      // drop placement accurate under pan/zoom and any parent layout offsets.
      const zoom = editor.zoom != null ? editor.zoom : 1;
      let posX;
      let posY;
      if (editor.precanvas) {
        const preRect = editor.precanvas.getBoundingClientRect();
        posX = (ev.clientX - preRect.left) / zoom;
        posY = (ev.clientY - preRect.top) / zoom;
      } else {
        const canvasRect = container.getBoundingClientRect();
        const relX = ev.clientX - canvasRect.left;
        const relY = ev.clientY - canvasRect.top;
        const canvasX = editor.canvas_x != null ? editor.canvas_x : 0;
        const canvasY = editor.canvas_y != null ? editor.canvas_y : 0;
        posX = (relX - canvasX) / zoom;
        posY = (relY - canvasY) / zoom;
      }

      const data = initialDataFor(def);
      const html = createNodeContentHtml(def, data);
      editor.addNode(key, def.inputs, def.outputs, posX, posY, key, data, html);
      resetNodeCompatibility();
      selectedNodeForConnection = null;
    });

    function refreshAgentNodeHtml(nodeId) {
      const node = editor.getNodeFromId(nodeId);
      if (!node) return;
      const agentTypes = ['class_detection_agent', 'class_detection_zone_agent', 'object_count_agent', 'person_behaviour_agent'];
      if (!agentTypes.includes(node.name)) return;
      const data = node.data || {};
      const def = NODE_DEFINITIONS[node.name];
      const html = createNodeContentHtml(def, data, nodeId);
      const contentNode = document.querySelector('#node-' + nodeId + ' .drawflow_content_node');
      if (contentNode) {
        contentNode.innerHTML = html;
        if (editor.drawflow.drawflow.Home.data[nodeId]) editor.drawflow.drawflow.Home.data[nodeId].html = html;
      }
      const nodeElement = document.getElementById('node-' + nodeId);
      if (nodeElement) nodeElement.removeAttribute('data-input-handlers');
      setupNodeInputHandlers(nodeId);
    }

    function updateSchedulerVisibility(card, data) {
      if (!card) return;
      var st = (data && data.schedule_type) || 'always';
      var rm = (data && data.run_mode) || 'continuous';
      card.querySelectorAll('.wf-sched-once-group').forEach(el => el.classList.toggle('wf-sched-hidden', st !== 'once'));
      card.querySelectorAll('.wf-sched-tod-group').forEach(el => el.classList.toggle('wf-sched-hidden', st !== 'daily' && st !== 'weekly'));
      card.querySelectorAll('.wf-sched-days-group').forEach(el => el.classList.toggle('wf-sched-hidden', st !== 'weekly'));
      card.querySelectorAll('.wf-sched-patrol-group').forEach(el => el.classList.toggle('wf-sched-hidden', rm !== 'patrol'));
    }

    function setupNodeInputHandlers(nodeId) {
      const nodeElement = document.getElementById(`node-${nodeId}`);
      if (!nodeElement) return;
      if (nodeElement.getAttribute('data-input-handlers') === 'true') return;
      const contentNode = nodeElement.querySelector('.drawflow_content_node');
      if (!contentNode) return;

      contentNode.addEventListener('input', function(e) {
        const target = e.target;
        if (target.classList.contains('lf-node-input')) {
          const fieldKey = target.getAttribute('data-field');
          const value = target.value;
          const node = editor.getNodeFromId(nodeId);
          if (node && node.data) {
            node.data[fieldKey] = value;
            editor.drawflow.drawflow.Home.data[nodeId].data[fieldKey] = value;
          }
        }
      });

      contentNode.addEventListener('change', function(e) {
        const target = e.target;
        if (target.classList.contains('lf-node-input')) {
          const fieldKey = target.getAttribute('data-field');
          let value;
          if (target.type === 'checkbox') {
            const node = editor.getNodeFromId(nodeId);
            const day = target.getAttribute('data-day');
            if (fieldKey === 'active_days' && day && node && node.data) {
              // Special case: active_days uses comma-separated string
              const current = (node.data.active_days || '').split(',').map(s => s.trim()).filter(Boolean);
              const set = new Set(current);
              if (target.checked) set.add(day); else set.delete(day);
              value = Array.from(set).join(',');
              node.data.active_days = value;
              if (editor.drawflow.drawflow.Home.data[nodeId]) editor.drawflow.drawflow.Home.data[nodeId].data.active_days = value;
            } else if (node && node.data) {
              // General checkbox: save as boolean true/false
              const boolVal = target.checked;
              node.data[fieldKey] = boolVal;
              if (editor.drawflow.drawflow.Home.data[nodeId]) editor.drawflow.drawflow.Home.data[nodeId].data[fieldKey] = boolVal;
            }
            return;
          }
          if (target.hasAttribute('multiple')) {
            value = Array.from(target.selectedOptions).map(opt => opt.value).join(',');
          } else {
            value = target.value;
          }
          const node = editor.getNodeFromId(nodeId);
          if (node && node.data) {
            node.data[fieldKey] = value;
            editor.drawflow.drawflow.Home.data[nodeId].data[fieldKey] = value;
          }
          var card = contentNode.querySelector && contentNode.querySelector('.lf-card') || contentNode;
          if (card && node && node.name === 'start' && (fieldKey === 'schedule_type' || fieldKey === 'run_mode')) {
            updateSchedulerVisibility(card, node.data);
            updateNotificationNodesForSchedule();
          }
          const agentTypes = ['class_detection_agent', 'class_detection_zone_agent', 'object_count_agent', 'person_behaviour_agent'];
          if (card && node && agentTypes.includes(node.name) && fieldKey === 'rule_id') {
            // Fetch rule config from KB and auto-populate fields
            const selectedRuleId = value;
            if (selectedRuleId) {
              fetchRuleConfig(selectedRuleId).then(ruleConfig => {
                if (ruleConfig) {
                  // Auto-populate fields from KB defaults
                  node.data.agent_name = ruleConfig.rule_name || '';
                  node.data.model_name = ruleConfig.model_name;
                  node.data.kb_model_name = ruleConfig.model_name;
                  node.data.fps = ruleConfig.fps;
                  node.data.confidence_threshold = ruleConfig.confidence_threshold;
                  node.data.alert_cooldown_seconds = ruleConfig.alert_cooldown_seconds;
                  node.data.kb_loaded = true;
                  
                  // Update drawflow internal data
                  if (editor.drawflow.drawflow.Home.data[nodeId]) {
                    editor.drawflow.drawflow.Home.data[nodeId].data.agent_name = ruleConfig.rule_name || '';
                    editor.drawflow.drawflow.Home.data[nodeId].data.model_name = ruleConfig.model_name;
                    editor.drawflow.drawflow.Home.data[nodeId].data.kb_model_name = ruleConfig.model_name;
                    editor.drawflow.drawflow.Home.data[nodeId].data.fps = ruleConfig.fps;
                    editor.drawflow.drawflow.Home.data[nodeId].data.confidence_threshold = ruleConfig.confidence_threshold;
                    editor.drawflow.drawflow.Home.data[nodeId].data.alert_cooldown_seconds = ruleConfig.alert_cooldown_seconds;
                    editor.drawflow.drawflow.Home.data[nodeId].data.kb_loaded = true;
                  }
                  
                  console.log(`[KB] Loaded rule ${selectedRuleId}: model=${ruleConfig.model_name}, fps=${ruleConfig.fps}, confidence=${ruleConfig.confidence_threshold}`);
                  
                  // Refresh node HTML to show new values and read-only model
                  refreshAgentNodeHtml(nodeId);
                } else {
                  // If rule not in KB, mark as not KB-loaded (legacy behavior)
                  node.data.kb_loaded = false;
                  refreshAgentNodeHtml(nodeId);
                }
              });
            } else {
              refreshAgentNodeHtml(nodeId);
            }
          }
        }
      });

      contentNode.addEventListener('mousedown', function(e) {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
          e.stopPropagation();
        }
      });

      var node = editor.getNodeFromId(nodeId);
      if (node && node.name === 'start') {
        var card = contentNode.querySelector && contentNode.querySelector('.lf-card') || contentNode;
        updateSchedulerVisibility(card, node.data || {});
      }

      // Apply showIf rules based on current saved data (e.g. loaded workflows)
      applyShowIfRules(nodeElement);

      nodeElement.setAttribute('data-input-handlers', 'true');
    }

    function setupAllNodeInputHandlers() {
      const allNodes = document.querySelectorAll('.drawflow-node[id^="node-"]');
      allNodes.forEach(nodeElement => {
        const nodeId = nodeElement.id.replace('node-', '');
        if (nodeId) setupNodeInputHandlers(nodeId);
      });
    }

    // Regenerate node HTML after import to reflect saved data values.
    // Drawflow's import() inserts raw HTML directly (bypasses our addNode override),
    // so nodes rendered during import have nodeId='' placeholders — this pass fixes them.
    // We do NOT strip data-input-handlers here; setupAllNodeInputHandlers is called
    // after this and its guard prevents duplicate handler attachment.
    function refreshAllNodeHtml() {
      const data = editor?.drawflow?.drawflow?.Home?.data || {};
      Object.keys(data).forEach(nodeId => {
        const node = data[nodeId];
        if (!node) return;
        const nodeDef = NODE_DEFINITIONS[node.name];
        if (!nodeDef) return;
        const nodeElement = document.getElementById(`node-${nodeId}`);
        if (!nodeElement) return;
        // Regenerate HTML with the real nodeId so data-node-id attrs are correct
        const updatedHtml = createNodeContentHtml(nodeDef, node.data || {}, nodeId);
        const contentNode = nodeElement.querySelector('.drawflow_content_node');
        if (contentNode) {
          contentNode.innerHTML = updatedHtml;
          node.html = updatedHtml;
        }
        // Add category class if missing
        if (!nodeElement.classList.contains(`node-cat-${nodeDef.category}`)) {
          nodeElement.classList.add(`node-cat-${nodeDef.category}`);
        }
        // Remove handler guard so setupAllNodeInputHandlers re-attaches on the fresh HTML
        nodeElement.removeAttribute('data-input-handlers');
      });
    }

    const originalAddNode = editor.addNode;
    editor.addNode = function (name, inputs, outputs, posX, posY, className, data, html, typenode) {
      const nodeId = originalAddNode.call(this, name, inputs, outputs, posX, posY, className, data, html, typenode);
      const nodeDef = NODE_DEFINITIONS[name];
      const nodeElement = document.getElementById(`node-${nodeId}`);
      if (nodeDef && nodeElement) {
        nodeElement.classList.add(`node-cat-${nodeDef.category}`);
        const updatedHtml = createNodeContentHtml(nodeDef, data, nodeId);
        const contentNode = nodeElement.querySelector('.drawflow_content_node');
        if (contentNode) contentNode.innerHTML = updatedHtml;
        if (editor.drawflow.drawflow.Home.data[nodeId]) editor.drawflow.drawflow.Home.data[nodeId].html = updatedHtml;
      }
      setupNodeInputHandlers(nodeId);
      if (name === 'notification') updateNotificationNodesForSchedule();
      if (name === 'camera') {
        const attemptPopulate = (attempt = 1) => {
          const selects = document.querySelectorAll('.camera-select');
          if (selects.length > 0) populateCameraDropdowns();
          else if (attempt < 10) setTimeout(() => attemptPopulate(attempt + 1), 100);
        };
        attemptPopulate();
      }
      if (name === 'iot_action') {
        const attemptIoT = (attempt = 1) => {
          const listEl = document.querySelector(`.iot-device-list[data-node-id="${nodeId}"]`);
          if (listEl) populateIoTDeviceRows(nodeId);
          else if (attempt < 10) setTimeout(() => attemptIoT(attempt + 1), 100);
        };
        attemptIoT();
      }
      return nodeId;
    };

    editor.on('connectionStart', function (connection) {
      const sourceNodeKey = getNodeKeyFromCanvasNode(connection.output_id);
      if (sourceNodeKey) { updateNodeCompatibility(sourceNodeKey); showOnlyApplicablePorts(sourceNodeKey); }
    });

    editor.on('connectionCancel', function () { resetNodeCompatibility(); resetPortsVisibility(); });

    editor.on('connectionCreated', function (connection) {
      resetNodeCompatibility();
      resetPortsVisibility();
      const isValid = validateConnection(connection.output_id, connection.input_id);
      if (!isValid) {
        // Remove the connection first, then show the alert in a microtask so
        // Drawflow finishes its DOM update before the blocking alert freezes the
        // browser — this also ensures ports are fully reset before the alert.
        editor.removeSingleConnection(connection.output_id, connection.input_id, connection.output_class, connection.input_class);
        resetPortsVisibility(); // re-apply after removeSingleConnection
        const sourceNode = editor.getNodeFromId(connection.output_id);
        const targetNode = editor.getNodeFromId(connection.input_id);
        const sourceDef = NODE_DEFINITIONS[sourceNode.name];
        const targetDef = NODE_DEFINITIONS[targetNode.name];
        var msg = sourceNode.name === 'notification' && targetNode.name === 'end'
          ? 'When the Start node schedule is set to "Always", the Notification node does not connect to End. Change the schedule to Daily, Weekly, or Once to add an End node.'
          : `Invalid connection: "${sourceDef.label}" cannot connect to "${targetDef.label}". Please check the node compatibility rules.`;
        setTimeout(function () { toast.warning(msg); }, 0);
      } else {
        updateNotificationNodesForSchedule();
      }
    });

    // Force connection styles on all SVG paths - animated
    // Skip while chat is building the graph — otherwise this overwrites stroke-dashoffset / animation
    // and breaks animateConnectionLineDrawIn (wf-flow fights the draw-in transition).
    /** Drawflow 0.0.47 renders each edge as svg.connection > path.main-path under the inner .drawflow div — not nested inside a wrapper SVG. Do not use the first .drawflow svg (often a node icon). */
    function getDrawflowConnectionMainPaths() {
      const root = document.getElementById('drawflow');
      if (!root) return [];
      return root.querySelectorAll('svg.connection path.main-path');
    }

    function forceConnectionStyles() {
      const canvasCol = document.querySelector('.wf-canvas-column');
      if (canvasCol && canvasCol.classList.contains('wf-canvas--gen-animating')) {
        console.log('[WF-chat] forceConnectionStyles: SKIP (wf-canvas--gen-animating)');
        return;
      }
      const paths = getDrawflowConnectionMainPaths();
      console.log('[WF-chat] forceConnectionStyles: applying wf-flow to', paths.length, 'path(s)');
      paths.forEach((path, i) => {
        if (path.classList.contains('wf-gen-conn-dots')) {
          console.log('[WF-chat] forceConnectionStyles: skip path', i, '(wf-gen-conn-dots)');
          return;
        }
        path.style.stroke = '#6366f1';
        path.style.strokeWidth = '2px';
        path.style.strokeDasharray = '8 4';
        path.style.strokeLinecap = 'round';
        path.style.fill = 'none';
        path.style.animation = 'wf-flow 1.5s linear infinite';
      });
    }

    // Apply styles whenever connections change
    editor.on('connectionCreated', forceConnectionStyles);
    editor.on('connectionRemoved', forceConnectionStyles);
    editor.on('import', forceConnectionStyles);
    
    // Initial application
    setTimeout(forceConnectionStyles, 100);

    editor.on('nodeSelected', function (id) {
      const nodeKey = getNodeKeyFromCanvasNode(id);
      if (nodeKey) { updateNodeCompatibility(nodeKey); showOnlyApplicablePorts(nodeKey); }
    });

    editor.on('nodeUnselected', function () { resetNodeCompatibility(); resetPortsVisibility(); });

    var zoneForNodeId = null;
    var zoneEditIndex = null; // null = new zone, number = editing existing index
    var wfZoneState = { points: [], mode: 'polygon', imgEl: null, imgW: 640, imgH: 360, savedCoords: null, savedType: null, mousePt: null };

    function wfZoneReset(mode) {
      wfZoneState.points = []; wfZoneState.mode = mode || 'polygon'; wfZoneState.imgEl = null;
      wfZoneState.imgW = 640; wfZoneState.imgH = 360; wfZoneState.savedCoords = null; wfZoneState.savedType = null; wfZoneState.mousePt = null;
    }

    function wfZoneDraw() {
      var canvas = document.getElementById('wf-zone-canvas');
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (wfZoneState.imgEl) ctx.drawImage(wfZoneState.imgEl, 0, 0, canvas.width, canvas.height);
      else { ctx.fillStyle = '#0f172a'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
      var pts = wfZoneState.points;

      if (wfZoneState.mode === 'roi') {
        // ROI mode: draw bounding box from 2 corner points
        if (pts.length === 1 && wfZoneState.mousePt) {
          var p0 = pts[0], pm = wfZoneState.mousePt;
          ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
          ctx.setLineDash([5,5]);
          ctx.strokeRect(p0.x, p0.y, pm.x - p0.x, pm.y - p0.y);
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(34,211,238,.1)';
          ctx.fillRect(p0.x, p0.y, pm.x - p0.x, pm.y - p0.y);
        } else if (pts.length === 2) {
          var x1 = Math.min(pts[0].x, pts[1].x), y1 = Math.min(pts[0].y, pts[1].y);
          var x2 = Math.max(pts[0].x, pts[1].x), y2 = Math.max(pts[0].y, pts[1].y);
          ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2;
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.fillStyle = 'rgba(34,211,238,.15)';
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        }
        pts.forEach(function(pt, idx) {
          ctx.beginPath(); ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
          ctx.fillStyle = idx === 0 ? '#22c55e' : '#f59e0b'; ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        });
      } else {
        // Polygon / line mode
        if (pts.length >= 2) {
          ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
          for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          if (wfZoneState.mode === 'polygon' && pts.length >= 3) ctx.lineTo(pts[0].x, pts[0].y);
          ctx.strokeStyle = '#22d3ee'; ctx.lineWidth = 2; ctx.stroke();
          if (wfZoneState.mode === 'polygon' && pts.length >= 3) { ctx.fillStyle = 'rgba(34,211,238,.15)'; ctx.fill(); }
        }
        if (wfZoneState.mousePt && pts.length > 0) {
          var last = pts[pts.length - 1];
          ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(wfZoneState.mousePt.x, wfZoneState.mousePt.y);
          ctx.setLineDash([5, 5]); ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.stroke(); ctx.setLineDash([]);
        }
        pts.forEach(function (pt, idx) {
          ctx.beginPath(); ctx.arc(pt.x, pt.y, idx === 0 ? 7 : 5, 0, Math.PI * 2);
          ctx.fillStyle = idx === 0 ? '#22c55e' : '#22d3ee'; ctx.fill();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        });
      }
    }

    function wfZoneNormalize() {
      var W = wfZoneState.imgW, H = wfZoneState.imgH;
      if (wfZoneState.mode === 'roi' && wfZoneState.points.length === 2) {
        // Normalise ROI as 4-corner polygon so backend can compute bounding box generically
        var pts = wfZoneState.points;
        var x1 = Math.min(pts[0].x, pts[1].x) / W, y1 = Math.min(pts[0].y, pts[1].y) / H;
        var x2 = Math.max(pts[0].x, pts[1].x) / W, y2 = Math.max(pts[0].y, pts[1].y) / H;
        return [
          [Math.round(x1*1000)/1000, Math.round(y1*1000)/1000],
          [Math.round(x2*1000)/1000, Math.round(y1*1000)/1000],
          [Math.round(x2*1000)/1000, Math.round(y2*1000)/1000],
          [Math.round(x1*1000)/1000, Math.round(y2*1000)/1000],
        ];
      }
      return wfZoneState.points.map(pt => [Math.round(pt.x / W * 1000) / 1000, Math.round(pt.y / H * 1000) / 1000]);
    }

    function wfZoneCanFinish() {
      var n = wfZoneState.points.length;
      if (wfZoneState.mode === 'roi')     return n === 2;
      if (wfZoneState.mode === 'line')    return n === 2;
      if (wfZoneState.mode === 'polygon') return n >= 3;
      return false;
    }

    function wfZoneIsNearFirst(px, py) {
      if (wfZoneState.points.length < 3) return false;
      var f = wfZoneState.points[0];
      return Math.sqrt((px - f.x) * (px - f.x) + (py - f.y) * (py - f.y)) < 14;
    }

    function wfZoneUpdateHint() {
      var hintEl = document.getElementById('wf-zone-hint');
      var undoBtn = document.getElementById('wf-zone-undo');
      var clearBtn = document.getElementById('wf-zone-clear');
      var n = wfZoneState.points.length;
      var hint;
      if (wfZoneState.mode === 'roi') {
        hint = n === 0 ? 'Click first corner.' : n === 1 ? 'Click opposite corner.' : 'ROI ready. Click Save.';
      } else if (wfZoneState.mode === 'line') {
        hint = n === 0 ? 'Click first point.' : n === 1 ? 'Click second point.' : 'Line ready.';
      } else {
        hint = n < 3 ? 'Add ' + (3 - n) + ' more point(s).' : 'Click first point (green) to close or Save.';
      }
      if (hintEl) hintEl.textContent = hint;
      if (undoBtn) undoBtn.disabled = n === 0;
      if (clearBtn) clearBtn.disabled = n === 0;
    }

    function wfZoneBindCanvas() {
      var canvas = document.getElementById('wf-zone-canvas');
      if (!canvas) return;
      var fresh = canvas.cloneNode(true);
      canvas.parentNode.replaceChild(fresh, canvas);
      canvas = fresh;
      canvas.style.cursor = 'crosshair';
      function getPt(e) {
        var rect = canvas.getBoundingClientRect();
        var sx = canvas.width / rect.width, sy = canvas.height / rect.height;
        return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
      }
      canvas.addEventListener('mousemove', function (e) { wfZoneState.mousePt = getPt(e); wfZoneDraw(); });
      canvas.addEventListener('mouseleave', function () { wfZoneState.mousePt = null; wfZoneDraw(); });
      canvas.addEventListener('click', function (e) {
        var pt = getPt(e);
        if (wfZoneState.mode === 'roi') {
          if (wfZoneState.points.length >= 2) return; // done
          wfZoneState.points.push(pt);
          wfZoneUpdateHint(); wfZoneDraw(); return;
        }
        if (wfZoneState.mode === 'polygon' && wfZoneIsNearFirst(pt.x, pt.y)) { wfZoneUpdateHint(); wfZoneDraw(); return; }
        if (wfZoneState.mode === 'line' && wfZoneState.points.length >= 2) return;
        wfZoneState.points.push(pt);
        if (wfZoneState.mode === 'line' && wfZoneState.points.length === 2) { wfZoneUpdateHint(); wfZoneDraw(); return; }
        wfZoneUpdateHint(); wfZoneDraw();
      });
      wfZoneDraw(); wfZoneUpdateHint();
    }

    function wfZoneLoadSnapshot(cameraId, onDone) {
      var loadingEl = document.getElementById('wf-zone-loading');
      var errorEl = document.getElementById('wf-zone-error');
      var errorMsgEl = document.getElementById('wf-zone-error-msg');
      if (loadingEl) loadingEl.classList.remove('d-none');
      if (errorEl) errorEl.classList.add('d-none');
      api.getCameraPreview(cameraId)
        .then(function (data) {
          if (loadingEl) loadingEl.classList.add('d-none');
          var b64 = data && data.frame_base64;
          if (!b64) throw new Error('No frame available — camera may be offline');
          var img = new Image();
          img.onload = function () {
            var canvas = document.getElementById('wf-zone-canvas');
            if (!canvas) return;
            canvas.width = img.naturalWidth || 640; canvas.height = img.naturalHeight || 360;
            wfZoneState.imgEl = img; wfZoneState.imgW = canvas.width; wfZoneState.imgH = canvas.height;
            wfZoneBindCanvas(); if (onDone) onDone();
          };
          img.src = 'data:image/jpeg;base64,' + b64;
        })
        .catch(function (err) {
          if (loadingEl) loadingEl.classList.add('d-none');
          if (errorEl) errorEl.classList.remove('d-none');
          if (errorMsgEl) errorMsgEl.textContent = (err && err.message) || 'Failed to load frame';
        });
    }

    function openZoneModal(nodeId, zoneType, editIndex) {
      var cameraId = getConnectedCameraId(nodeId);
      if (!cameraId) { toast.warning('Connect this Agent node to a Camera node first, and set the camera in that node.'); return; }
      zoneForNodeId = nodeId;
      zoneEditIndex = (typeof editIndex === 'number') ? editIndex : null;
      var ruleMeta = RULE_META.find(function (r) {
        var node = editor.getNodeFromId(nodeId);
        return node && node.data && node.data.rule_id === r.id;
      });
      var desc = (ruleMeta && ruleMeta.zoneDesc) || (zoneType === 'line' ? 'Draw 2 points for the line.' : zoneType === 'roi' ? 'Click two corners to define ROI.' : 'Draw polygon (min 3 points).');
      document.getElementById('wf-zone-desc').textContent = desc + (zoneEditIndex !== null ? ' (Editing zone ' + (zoneEditIndex + 1) + ')' : '');
      wfZoneReset(zoneType || 'polygon');

      // If editing existing zone, pre-populate points
      if (zoneEditIndex !== null) {
        var node = editor.getNodeFromId(nodeId);
        var existingZones = (node && node.data && node.data.zones) || [];
        var existingZone = existingZones[zoneEditIndex];
        if (existingZone && existingZone.coordinates) {
          // Points will be restored after image loads
          wfZoneState.savedCoords = existingZone.coordinates;
          wfZoneState.savedType   = existingZone.type || zoneType;
        }
      }

      var modalEl = document.getElementById('wf-zone-modal');
      if (typeof bootstrap !== 'undefined') bootstrap.Modal.getOrCreateInstance(modalEl).show();
      wfZoneLoadSnapshot(cameraId, function () {
        // Restore pre-existing zone points onto the loaded canvas
        if (wfZoneState.savedCoords && wfZoneState.savedCoords.length) {
          var W = wfZoneState.imgW, H = wfZoneState.imgH;
          wfZoneState.points = wfZoneState.savedCoords.map(function(p) {
            return { x: p[0] * W, y: p[1] * H };
          });
          wfZoneUpdateHint(); wfZoneDraw();
        }
      });
    }

    container.addEventListener('click', function (ev) {
      var btn = ev.target.closest('.wf-draw-zone-btn');
      if (btn) {
        ev.preventDefault(); ev.stopPropagation();
        var idx = btn.getAttribute('data-zone-index');
        openZoneModal(btn.getAttribute('data-node-id'), btn.getAttribute('data-zone-type') || 'polygon', idx !== null && idx !== '' ? parseInt(idx, 10) : null);
      }
      var addBtn = ev.target.closest('.wf-add-zone-btn');
      if (addBtn) {
        ev.preventDefault(); ev.stopPropagation();
        openZoneModal(addBtn.getAttribute('data-node-id'), addBtn.getAttribute('data-zone-type') || 'polygon', null);
      }
    });

    var wfZoneModalEl = document.getElementById('wf-zone-modal');
    if (wfZoneModalEl) {
      wfZoneModalEl.querySelector('#wf-zone-save').addEventListener('click', function () {
        if (!wfZoneCanFinish() || !zoneForNodeId) return;
        var node = editor.getNodeFromId(zoneForNodeId);
        if (node && node.data) {
          // Determine the saved type label
          var savedType = wfZoneState.mode === 'line' ? 'line' : wfZoneState.mode === 'roi' ? 'roi' : 'polygon';
          var newZone = { type: savedType, coordinates: wfZoneNormalize() };

          // Ensure zones[] array exists
          if (!node.data.zones) node.data.zones = [];

          if (zoneEditIndex !== null && zoneEditIndex < node.data.zones.length) {
            // Editing an existing zone — replace in place
            node.data.zones[zoneEditIndex] = newZone;
          } else {
            // Adding a new zone
            node.data.zones.push(newZone);
          }

          // Keep node.data.zone (legacy single-zone field) in sync with first zone
          node.data.zone = node.data.zones[0];

          // Persist into Drawflow's internal data store
          if (editor.drawflow.drawflow.Home.data[zoneForNodeId]) {
            editor.drawflow.drawflow.Home.data[zoneForNodeId].data.zones = node.data.zones;
            editor.drawflow.drawflow.Home.data[zoneForNodeId].data.zone  = node.data.zone;
          }
        }
        if (typeof bootstrap !== 'undefined') { var m = bootstrap.Modal.getInstance(wfZoneModalEl); if (m) m.hide(); }
        refreshAgentNodeHtml(zoneForNodeId);
        zoneForNodeId = null;
        zoneEditIndex = null;
      });
      wfZoneModalEl.querySelector('#wf-zone-undo').addEventListener('click', function () {
        if (wfZoneState.points.length > 0) { wfZoneState.points.pop(); wfZoneUpdateHint(); wfZoneDraw(); }
      });
      wfZoneModalEl.querySelector('#wf-zone-clear').addEventListener('click', function () {
        wfZoneState.points = []; wfZoneUpdateHint(); wfZoneDraw();
      });
    }

    zoomInBtn.addEventListener('click', () => editor.zoom_in());
    zoomOutBtn.addEventListener('click', () => editor.zoom_out());

    function isAppSidebarHidden() {
      return !!mainShell && mainShell.classList.contains('wf-hide-app-sidebar');
    }

    function updateFullscreenButtonState() {
      const icon = zoomResetBtn ? zoomResetBtn.querySelector('i') : null;
      const isFullscreen = isAppSidebarHidden();
      if (!zoomResetBtn || !icon) return;
      icon.className = isFullscreen ? 'fa-solid fa-compress' : 'fa-solid fa-expand';
      zoomResetBtn.title = isFullscreen ? 'Show Main Sidebar' : 'Hide Main Sidebar';
      zoomResetBtn.setAttribute('aria-label', zoomResetBtn.title);
    }

    async function toggleEditorFullscreen() {
      if (!mainShell) return;
      mainShell.classList.toggle('wf-hide-app-sidebar');
      updateFullscreenButtonState();
    }

    const mainShell = document.querySelector('main.main');
    zoomResetBtn.addEventListener('click', toggleEditorFullscreen);
    updateFullscreenButtonState();

    container.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (e.deltaY < 0) editor.zoom_in();
      else if (e.deltaY > 0) editor.zoom_out();
    }, { passive: false });

    clearBtn.addEventListener('click', () => { editor.clear(); addDefaultStartNode(); });

    exportBtn.addEventListener('click', () => {
      const data = editor.export();
      prepareWorkflowData(data);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'workflow.json'; a.click();
      URL.revokeObjectURL(url);
    });

    newBtn.addEventListener('click', () => { editor.clear(); addDefaultStartNode(); });

    // Prevent double-save races (save button spam, run triggering save while save is in flight)
    let _isSaving = false;

    async function saveWorkflowToBackend() {
      if (_isSaving) return null;
      if (hasUnusedEndNode()) {
        toast.warning('Cannot save: the Start node schedule is set to "Always" but an End node is still connected. Remove the End node (or change the schedule to Daily, Weekly, or Once) and try again.');
        return null;
      }
      _isSaving = true;
      try {
        const exportedFlow = editor.export();
        prepareWorkflowData(exportedFlow);
        const bindEvent = getBindEvent(exportedFlow) || "Unbound";
        const nameInput = document.getElementById('workflow-name-input');
        const currentName = nameInput ? nameInput.value.trim() : '';
        const payload = {
          name: currentName || workflowName || 'Unnamed Workflow',
          description: window.currentWorkflowDescription || workflowDescription || '',
          drawflow_data: exportedFlow,
          bind_to_event: bindEvent,
        };

        const token = getAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;

        let res, result;

        if (isEditMode && editWorkflowId) {
          // ── EDIT MODE: update existing workflow in-place via PUT ─────────────
          // Never deactivate-then-create — that generates a new ID every save
          // and breaks the WebSocket / execute connection to the original workflow.
          console.log('[Save] Updating existing Watch Dog:', editWorkflowId);
          res = await fetch(`${API_BASE}/api/v1/workflows/${editWorkflowId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload),
          });
          if (res.status === 401) { toast.error('Session expired. Please login again.'); return null; }
          result = await res.json();
          if (!res.ok) {
            toast.error('Failed to update Watch Dog: ' + (result.detail || 'Unknown error'));
            console.error('[Save] Update error:', result);
            return null;
          }
          console.log('[Save] Watch Dog updated:', result);
        } else {
          // ── CREATE MODE: first save, POST to create a brand-new workflow ─────
          if (workflowOwner) payload.created_by_name = workflowOwner;
          console.log('[Save] Creating new Watch Dog');
          res = await fetch(`${API_BASE}/api/v1/workflows/`, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
          });
          if (res.status === 401) { toast.error('Session expired. Please login again.'); return null; }
          result = await res.json();
          if (!res.ok) {
            toast.error('Failed to save Watch Dog: ' + (result.detail || 'Unknown error'));
            console.error('[Save] Create error:', result);
            return null;
          }
          console.log('[Save] Watch Dog created:', result);

          // Switch to edit mode so every subsequent save is a PUT, not another POST
          if (result.id) {
            editWorkflowId = result.id;
            isEditMode = true;
            try {
              const newUrl = new URL(window.location.href);
              newUrl.searchParams.set('workflow_id', result.id);
              newUrl.searchParams.set('name', result.name || '');
              window.history.replaceState(window.history.state, '', newUrl.toString());
            } catch (_) {}
          }
        }

        return result;
      } finally {
        _isSaving = false;
      }
    }

    saveBtn.addEventListener('click', async () => {
      if (_isSaving) return;
      try {
        saveBtn.disabled = true;
        const result = await saveWorkflowToBackend();
        if (!result) return;
        toast.success('Watch Dog saved successfully!');
        // Stay on the editor — no redirect to list
      } catch (err) {
        console.error('[Save] Unexpected error:', err);
        toast.error('Error while saving Watch Dog.');
      } finally {
        saveBtn.disabled = false;
      }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // EXECUTION ENGINE — n8n-style real-time node flow
    // ═══════════════════════════════════════════════════════════════════════

    let _execWs     = null;
    let _activeWfId = null;   // workflow id currently being run/watched
    const _seenExecEventUids = new Set();

    // ── Execution log ────────────────────────────────────────────────────────
    const _LOG_HEIGHT_KEY = 'visionai.workflow.execLogHeight.v1';
    const _LOG_HEIGHT_MIN = 80;
    const _LOG_HEIGHT_DEFAULT = 160;

    function _setLogHeight(px) {
      var h = Math.max(_LOG_HEIGHT_MIN, px);
      var root = document.querySelector('.workflow-designer') || designerRootEl;
      if (root) root.style.setProperty('--wf-exec-log-height', h + 'px');
      try { localStorage.setItem(_LOG_HEIGHT_KEY, String(h)); } catch (_) {}
    }

    function _isLogOpen() {
      if (!designerRootEl) return false;
      var h = parseInt(designerRootEl.style.getPropertyValue('--wf-exec-log-height') || '0', 10);
      return h > 0;
    }
    function _execLogOpen(forceHeight) {
      // forceHeight lets the Run button always open to at least the default,
      // ignoring a previously-saved 0 (user closed it last time).
      var saved = parseInt(localStorage.getItem(_LOG_HEIGHT_KEY) || '', 10);
      var h = forceHeight
        ? Math.max(forceHeight, _LOG_HEIGHT_DEFAULT)
        : (Number.isFinite(saved) && saved > 0 ? saved : _LOG_HEIGHT_DEFAULT);
      // Re-query the designer root in case the DOM was re-rendered since init
      var root = document.querySelector('.workflow-designer') || designerRootEl;
      if (root) root.style.setProperty('--wf-exec-log-height', h + 'px');
      try { localStorage.setItem(_LOG_HEIGHT_KEY, String(h)); } catch (_) {}
      var btn = document.getElementById('btn-exec-log-toggle');
      if (btn) btn.classList.add('is-active');
    }
    function _execLogClose() {
      if (designerRootEl) designerRootEl.style.setProperty('--wf-exec-log-height', '0px');
      if (_execWs) { try { _execWs.close(); } catch (_) {} _execWs = null; }
      var btn = document.getElementById('btn-exec-log-toggle');
      if (btn) btn.classList.remove('is-active');
    }
    function _execLogToggle() {
      if (_isLogOpen()) _execLogClose(); else _execLogOpen();
    }
    function _execLogClear() { const b = document.getElementById('wf-exec-log-body'); if (b) b.innerHTML = ''; }

    // Wire toolbar toggle button
    document.getElementById('btn-exec-log-toggle')?.addEventListener('click', _execLogToggle);

    // Top-drag resize for exec log
    (function () {
      var handle = document.getElementById('wf-exec-log-resize-handle');
      if (!handle || !designerRootEl) return;
      var dragging = false;
      function stopDrag() {
        if (!dragging) return;
        dragging = false;
        handle.classList.remove('is-dragging');
        document.body.style.userSelect = '';
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      }
      function onMove(e) {
        if (!dragging) return;
        var panel = document.getElementById('wf-exec-log-panel');
        if (!panel) return;
        var rect = panel.getBoundingClientRect();
        // Height = bottom of panel minus pointer Y
        var newH = rect.bottom - e.clientY;
        _setLogHeight(newH);
      }
      function onUp() { stopDrag(); }
      handle.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        dragging = true;
        handle.classList.add('is-dragging');
        document.body.style.userSelect = 'none';
        handle.setPointerCapture?.(e.pointerId);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      });
    })();

    function _escHtml(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    // ── Structured exec-log append ────────────────────────────────────────────
    // Renders a row with: timestamp | tag pill | message text | elapsed chip
    function _execLogAppend(text, type = 'info', opts) {
      // opts: { tag?: string, tagClass?: string, elapsed?: string, html?: boolean }
      const body = document.getElementById('wf-exec-log-body');
      if (!body) return;
      const colorMap = {
        info:    '#94a3b8', success: '#22c55e', error:   '#ef4444',
        warning: '#fbbf24', running: '#38bdf8', paused:  '#fbbf24',
      };
      const color = colorMap[type] || colorMap.info;
      const ts    = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const tag   = opts && opts.tag       ? opts.tag      : '';
      const tagCls= opts && opts.tagClass  ? opts.tagClass : 'wf-log-tag--system';
      const elapsed = opts && opts.elapsed ? opts.elapsed  : '';
      const useHtml = opts && opts.html;

      const line = document.createElement('div');
      line.className = 'wf-exec-log-line';
      const msgContent = useHtml ? text : _escHtml(text);
      line.innerHTML = [
        `<span class="wf-log-ts">${ts}</span>`,
        tag ? `<span class="wf-log-tag ${tagCls}">${_escHtml(tag)}</span>` : '',
        `<span class="wf-log-msg" style="color:${color};">${msgContent}</span>`,
        elapsed ? `<span class="wf-log-elapsed">${_escHtml(elapsed)}</span>` : '',
      ].join('');
      body.appendChild(line);
      body.scrollTop = body.scrollHeight;
    }

    // ── Topbar button state ───────────────────────────────────────────────────
    function _updateTopbarButtons(overallStatus) {
      const runBtn    = document.getElementById('btn-run-workflow');
      const stopBtn   = document.getElementById('btn-stop-workflow');
      const pauseBtn  = document.getElementById('btn-pause-workflow');
      const resumeBtn = document.getElementById('btn-resume-workflow');
      const isRunning = overallStatus === 'running';
      const isPaused  = overallStatus === 'paused';
      const isDone    = ['inactive','completed','cancelled','stopped','error','unknown'].includes(overallStatus);

      if (runBtn) {
        runBtn.disabled = !isDone;
        runBtn.innerHTML = isDone
          ? '<i class="fa-solid fa-play"></i><span>Run Watch Dog</span>'
          : '<i class="fa-solid fa-circle-dot"></i><span>Running…</span>';
      }
      if (stopBtn)   stopBtn.style.display   = !isDone    ? '' : 'none';
      if (pauseBtn)  pauseBtn.style.display  = isRunning  ? '' : 'none';
      if (resumeBtn) resumeBtn.style.display = isPaused   ? '' : 'none';
    }

    // ═══════════════════════════════════════════════════════════════════════
    // n8n-style LIVE NODE STATUS SYSTEM
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Three visual layers per node:
    //
    //   1. STATUS BADGE  (.wf-n8n-badge)
    //      A small circle in the top-right corner.
    //      Shows a spinner while running, a ✓ when done, ✗ on error, etc.
    //      Set by  _setNodeStatus(nodeId, status).
    //
    //   2. EVENT FLASH  (.wf-event-flash)
    //      A brief green glow pulse added when the node processes something
    //      (detection fired, notification sent).  Auto-removed after 700 ms.
    //      Triggered by  _flashNodeEvent(nodeId).
    //
    //   3. EVENT COUNT BADGE  (.wf-event-count-badge)
    //      A small pill at the bottom of the node showing "N events".
    //      Increments every time a detection fires on that agent node.
    //      Managed by  _incrementNodeEventCount(nodeId).
    //
    // ═══════════════════════════════════════════════════════════════════════

    const _NODE_STATUS_BADGE_CLASS   = 'wf-n8n-badge';
    const _NODE_EVENT_COUNT_CLASS    = 'wf-event-count-badge';
    const _NODE_ELAPSED_CHIP_CLASS   = 'wf-node-elapsed-chip';
    const _NODE_ERROR_CALLOUT_CLASS  = 'wf-node-error-callout';

    // Internal counter map: drawflowNodeId → number of detection events seen
    const _nodeEventCounts = {};

    // Node start-time map for elapsed calculation: drawflowNodeId → Date
    const _nodeStartTimes = {};

    // ── Helper: get or create the status badge overlay ───────────────────────
    function _getOrCreateStatusBadge(nodeEl) {
      let badge = nodeEl.querySelector('.' + _NODE_STATUS_BADGE_CLASS);
      if (!badge) {
        badge = document.createElement('div');
        badge.className = _NODE_STATUS_BADGE_CLASS;
        nodeEl.appendChild(badge);
      }
      return badge;
    }

    // ── Helper: get or create the event count badge ──────────────────────────
    function _getOrCreateEventCountBadge(nodeEl) {
      let badge = nodeEl.querySelector('.' + _NODE_EVENT_COUNT_CLASS);
      if (!badge) {
        badge = document.createElement('div');
        badge.className = _NODE_EVENT_COUNT_CLASS;
        nodeEl.appendChild(badge);
      }
      return badge;
    }

    // ── Helper: get or create elapsed-time chip ───────────────────────────────
    function _getOrCreateElapsedChip(nodeEl) {
      let chip = nodeEl.querySelector('.' + _NODE_ELAPSED_CHIP_CLASS);
      if (!chip) {
        chip = document.createElement('div');
        chip.className = _NODE_ELAPSED_CHIP_CLASS;
        nodeEl.appendChild(chip);
      }
      return chip;
    }

    // ── Helper: inject (or replace) inline error callout inside node card ─────
    function _setNodeErrorCallout(drawflowNodeId, errorText) {
      if (!drawflowNodeId || !errorText) return;
      const nodeEl = document.getElementById('node-' + drawflowNodeId);
      if (!nodeEl) return;
      // Remove any existing callout first
      nodeEl.querySelectorAll('.' + _NODE_ERROR_CALLOUT_CLASS).forEach(el => el.remove());
      const callout = document.createElement('div');
      callout.className = _NODE_ERROR_CALLOUT_CLASS;
      callout.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i><span>${_escHtml(errorText)}</span>`;
      // Append inside the card body if it exists, else inside the node element
      const cardBody = nodeEl.querySelector('.lf-card-body');
      (cardBody || nodeEl).appendChild(callout);
    }

    // ── Canvas-level success / error / stopped banner ─────────────────────────
    // Shown at top-center of the canvas, auto-dismissed after 8 s (success)
    // or left until manually closed (error).
    let _canvasBannerTimer = null;

    function _showCanvasBanner(type, title, sub) {
      // type: 'success' | 'error' | 'stopped'
      const canvas = document.getElementById('drawflow');
      if (!canvas) return;

      // Remove existing banner
      canvas.querySelectorAll('.wf-canvas-banner').forEach(el => el.remove());
      if (_canvasBannerTimer) { clearTimeout(_canvasBannerTimer); _canvasBannerTimer = null; }

      const iconMap = { success: 'fa-circle-check', error: 'fa-circle-xmark', stopped: 'fa-stop-circle' };
      const banner = document.createElement('div');
      banner.className = `wf-canvas-banner wf-canvas-banner--${type}`;
      banner.innerHTML = `
        <i class="fa-solid ${iconMap[type] || 'fa-info-circle'} wf-canvas-banner__icon"></i>
        <div class="wf-canvas-banner__text">
          <div class="wf-canvas-banner__title">${_escHtml(title)}</div>
          ${sub ? `<div class="wf-canvas-banner__sub">${_escHtml(sub)}</div>` : ''}
        </div>
        <button class="wf-canvas-banner__close" title="Dismiss"><i class="fa-solid fa-xmark"></i></button>
      `;
      banner.querySelector('.wf-canvas-banner__close').addEventListener('click', () => banner.remove());
      canvas.appendChild(banner);

      // Auto-dismiss success after 8 s; keep error until user closes
      if (type === 'success' || type === 'stopped') {
        _canvasBannerTimer = setTimeout(() => banner.remove(), 8000);
      }
    }

    function _dismissCanvasBanner() {
      const canvas = document.getElementById('drawflow');
      if (canvas) canvas.querySelectorAll('.wf-canvas-banner').forEach(el => el.remove());
      if (_canvasBannerTimer) { clearTimeout(_canvasBannerTimer); _canvasBannerTimer = null; }
    }

    // ── Execution progress bar helpers ────────────────────────────────────────
    function _getOrCreateProgressBar() {
      const canvas = document.getElementById('drawflow');
      if (!canvas) return null;
      let bar = canvas.querySelector('.wf-exec-progress-bar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'wf-exec-progress-bar';
        canvas.appendChild(bar);
      }
      return bar;
    }

    function _progressStart() {
      const bar = _getOrCreateProgressBar();
      if (!bar) return;
      bar.classList.remove('is-done', 'is-error', 'is-indeterminate');
      bar.style.width = '0%';
      bar.style.opacity = '1';
      // Small delay then go indeterminate — feels like real progress
      setTimeout(() => bar.classList.add('is-indeterminate'), 30);
    }

    function _progressDone(isError) {
      const bar = _getOrCreateProgressBar();
      if (!bar) return;
      bar.classList.remove('is-indeterminate');
      bar.classList.add(isError ? 'is-error' : 'is-done');
      // The CSS transition fades it out; remove from DOM after fade
      setTimeout(() => bar && bar.remove(), 900);
    }

    // ── Live-edge management: persistent animated edges while monitoring ───────
    // _liveEdgeNodeIds: set of drawflowNodeIds whose outgoing edges are "live"
    const _liveEdgeNodeIds = new Set();

    function _setEdgeLive(drawflowNodeId, live) {
      if (!drawflowNodeId) return;
      if (live) {
        _liveEdgeNodeIds.add(drawflowNodeId);
        _getEdgesFromNode(drawflowNodeId).forEach(path => path.classList.add('wf-edge--live'));
      } else {
        _liveEdgeNodeIds.delete(drawflowNodeId);
        _getEdgesFromNode(drawflowNodeId).forEach(path => path.classList.remove('wf-edge--live'));
      }
    }

    function _clearAllLiveEdges() {
      document.querySelectorAll('.wf-edge--live').forEach(p => p.classList.remove('wf-edge--live'));
      _liveEdgeNodeIds.clear();
    }

    // ── Set the persistent status of a node (running / done / error / etc.) ──
    function _setNodeStatus(drawflowNodeId, status, opts) {
      // opts: { errorText?: string }
      if (!drawflowNodeId) return;
      const el = document.getElementById('node-' + drawflowNodeId);
      if (!el) return;
      const s = (status || '').toLowerCase();

      // Track node start time for elapsed calculation
      if (s === 'running' || s === 'monitoring') {
        if (!_nodeStartTimes[drawflowNodeId]) _nodeStartTimes[drawflowNodeId] = Date.now();
      }

      // Remove all existing state classes before adding the new one
      el.classList.remove(
        'wf-node--idle', 'wf-node--running', 'wf-node--done',
        'wf-node--error', 'wf-node--paused', 'wf-node--stopped'
      );

      const badge = _getOrCreateStatusBadge(el);

      const statusConfig = {
        running:    { cls: 'wf-node--running', html: '<span class="wf-badge-spin"></span>', tip: 'Running…'   },
        completed:  { cls: 'wf-node--done',    html: '<i class="fa-solid fa-check"></i>',  tip: 'Completed'  },
        error:      { cls: 'wf-node--error',   html: '<i class="fa-solid fa-xmark"></i>',  tip: 'Error'      },
        paused:     { cls: 'wf-node--paused',  html: '<i class="fa-solid fa-pause"></i>',  tip: 'Paused'     },
        stopped:    { cls: 'wf-node--stopped', html: '<i class="fa-solid fa-stop"></i>',   tip: 'Stopped'    },
        cancelled:  { cls: 'wf-node--stopped', html: '<i class="fa-solid fa-stop"></i>',   tip: 'Cancelled'  },
        monitoring: { cls: 'wf-node--running', html: '<span class="wf-badge-spin"></span>', tip: 'Monitoring' },
        scheduled:  { cls: 'wf-node--paused',  html: '<i class="fa-solid fa-clock"></i>',  tip: 'Scheduled'  },
      };

      const cfg = statusConfig[s] || null;
      if (cfg) {
        el.classList.add(cfg.cls);
        badge.innerHTML     = cfg.html;
        badge.title         = cfg.tip;
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }

      // Show elapsed time chip when a node finishes (completed / error / stopped)
      if ((s === 'completed' || s === 'error' || s === 'stopped' || s === 'cancelled') && _nodeStartTimes[drawflowNodeId]) {
        const ms      = Date.now() - _nodeStartTimes[drawflowNodeId];
        const elapsed = ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
        const chip    = _getOrCreateElapsedChip(el);
        chip.textContent = elapsed;
        delete _nodeStartTimes[drawflowNodeId];
      }

      // Inline error callout inside the card body
      if (s === 'error' && opts && opts.errorText) {
        _setNodeErrorCallout(drawflowNodeId, opts.errorText);
      } else if (s !== 'error') {
        // Clear any previous error callout when status changes away from error
        el.querySelectorAll('.' + _NODE_ERROR_CALLOUT_CLASS).forEach(c => c.remove());
      }
    }

    // ── Flash a node briefly (used for detection events, notification sends) ─
    // Adds the CSS flash animation class, then removes it after the animation
    // finishes.  Does NOT change the node's persistent status.
    function _flashNodeEvent(drawflowNodeId) {
      if (!drawflowNodeId) return;
      const el = document.getElementById('node-' + drawflowNodeId);
      if (!el) return;

      // Remove and re-add the class so it restarts the animation if it is
      // already running (rapid back-to-back detections).
      el.classList.remove('wf-event-flash');
      // Force a reflow so the browser registers the removal before re-adding
      void el.offsetWidth;
      el.classList.add('wf-event-flash');
      setTimeout(() => el.classList.remove('wf-event-flash'), 700);
    }

    // ── Increment the event count badge on an agent node ─────────────────────
    // Called every time a "detection_event" fires on this node.
    // Shows a small "N events" pill at the bottom of the card.
    function _incrementNodeEventCount(drawflowNodeId) {
      if (!drawflowNodeId) return;
      const el = document.getElementById('node-' + drawflowNodeId);
      if (!el) return;

      // Update the in-memory counter
      _nodeEventCounts[drawflowNodeId] = (_nodeEventCounts[drawflowNodeId] || 0) + 1;
      const count = _nodeEventCounts[drawflowNodeId];

      const badge = _getOrCreateEventCountBadge(el);
      badge.textContent = count === 1 ? '1 event' : `${count} events`;

      // Animate the bump (CSS handles the scale keyframe)
      badge.classList.remove('wf-count-bump');
      void badge.offsetWidth;  // force reflow to restart animation
      badge.classList.add('wf-count-bump');
    }

    // ── Reset every node back to its idle (no-status) state ──────────────────
    function _resetAllNodeStatus() {
      document.querySelectorAll('.drawflow-node').forEach(el => {
        el.classList.remove(
          'wf-node--idle', 'wf-node--running', 'wf-node--done',
          'wf-node--error', 'wf-node--paused', 'wf-node--stopped', 'wf-event-flash'
        );
        const statusBadge = el.querySelector('.' + _NODE_STATUS_BADGE_CLASS);
        if (statusBadge) statusBadge.style.display = 'none';
        el.querySelector('.' + _NODE_EVENT_COUNT_CLASS)?.remove();
        el.querySelector('.' + _NODE_ELAPSED_CHIP_CLASS)?.remove();
        el.querySelectorAll('.' + _NODE_ERROR_CALLOUT_CLASS).forEach(c => c.remove());
      });
      Object.keys(_nodeEventCounts).forEach(k => delete _nodeEventCounts[k]);
      Object.keys(_nodeStartTimes).forEach(k => delete _nodeStartTimes[k]);
      // Clear dedup set so re-runs don't silently drop events from previous run
      _seenExecEventUids.clear();
      _clearAllEdgeAnimations();
      _clearAllLiveEdges();
      _dismissCanvasBanner();
    }

    // ── Animated edge helpers ─────────────────────────────────────────────────
    // Drawflow renders connections as:
    //   <div class="connection node_out_node-1 node_in_node-3">
    //     <svg><path class="main-path" /></svg>
    //   </div>
    // We add .wf-edge--active to the <path> to trigger the flow animation.

    function _getEdgesFromNode(drawflowNodeId) {
      const paths = [];
      document.querySelectorAll('.drawflow .connection').forEach(conn => {
        // conn.className can be SVGAnimatedString on SVG child elements — always
        // coerce to a plain string before calling .includes()
        const cls = typeof conn.className === 'string'
          ? conn.className
          : (conn.getAttribute('class') || '');
        if (cls.includes(`node_out_node-${drawflowNodeId}`) || cls.includes(`node_out_node${drawflowNodeId}`)) {
          const path = conn.querySelector('path.main-path');
          if (path) paths.push(path);
        }
      });
      return paths;
    }

    function _animateEdgesFromNode(drawflowNodeId) {
      _getEdgesFromNode(drawflowNodeId).forEach(path => {
        path.classList.add('wf-edge--active');
        setTimeout(() => path.classList.remove('wf-edge--active'), 1400);
      });
    }

    function _clearAllEdgeAnimations() {
      document.querySelectorAll('.wf-edge--active').forEach(p => p.classList.remove('wf-edge--active'));
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LOG LINE BUILDER
    // ═══════════════════════════════════════════════════════════════════════
    //
    // Each event type gets a specific icon prefix and colour so the log
    // panel reads like a real execution trace (similar to n8n's execution log).
    //
    // Icons used:
    //   ▶  workflow started / node started
    //   ✓  completed / agent created
    //   ✗  error
    //   ●  monitoring / running
    //   ⏸  paused
    //   ■  stopped / cancelled
    //   ⚡  detection fired
    //   ✉  notification sent
    //   🔔  alarm triggered   (plain text fallback: [ALARM])
    //   📄  report sent       (plain text fallback: [REPORT])
    // ═══════════════════════════════════════════════════════════════════════

    // Maps event name → { logType, icon, labelFn }
    // logType controls the colour in _execLogAppend.
    // icon    is prepended to the message.
    // labelFn is a function(msg, nodeType, error, agents, extra) → string
    //         that builds the final human-readable log line.
    // _EVENT_LOG_CONFIG maps event name → { logType, tag, tagClass, labelFn, useHtml? }
    const _EVENT_LOG_CONFIG = {

      // ── Workflow lifecycle ────────────────────────────────────────────────
      workflow_started: {
        logType: 'running', tag: 'Workflow', tagClass: 'wf-log-tag--system',
        labelFn: (msg) => msg || 'Workflow started',
      },
      workflow_completed: {
        logType: 'success', tag: 'Workflow', tagClass: 'wf-log-tag--system',
        labelFn: (msg) => msg || 'Workflow ready — agents monitoring',
      },
      workflow_error: {
        logType: 'error', tag: 'Error', tagClass: 'wf-log-tag--error',
        labelFn: (msg, _nt, error) => (msg || 'Workflow error') + (error ? ` — ${error}` : ''),
      },
      workflow_stopped: {
        logType: 'warning', tag: 'Stopped', tagClass: 'wf-log-tag--system',
        labelFn: (msg) => msg || 'Workflow stopped',
      },
      workflow_paused: {
        logType: 'warning', tag: 'Paused', tagClass: 'wf-log-tag--system',
        labelFn: (msg) => msg || 'Workflow paused',
      },
      workflow_resumed: {
        logType: 'success', tag: 'Resumed', tagClass: 'wf-log-tag--system',
        labelFn: (msg) => msg || 'Workflow resumed',
      },

      // ── Node setup ───────────────────────────────────────────────────────
      node_started: {
        logType: 'info',
        labelFn: (msg, nodeType) => msg || `${_nodeTypeLabel(nodeType) || 'Node'} starting…`,
        tagFn: (nodeType) => _nodeTypeLabel(nodeType) || null,
        tagClsFn: (nodeType) => _nodeTypeTagClass(nodeType),
      },
      node_completed: {
        logType: 'success',
        labelFn: (msg, nodeType) => msg || `${_nodeTypeLabel(nodeType) || 'Node'} configured`,
        tagFn: (nodeType) => _nodeTypeLabel(nodeType) || null,
        tagClsFn: (nodeType) => _nodeTypeTagClass(nodeType),
      },
      node_error: {
        logType: 'error', tag: 'Error', tagClass: 'wf-log-tag--error',
        labelFn: (msg, nodeType, error) => {
          const base = msg || `${_nodeTypeLabel(nodeType) || 'Node'} error`;
          return base + (error ? ` — ${error}` : '');
        },
      },

      // ── Agent created ────────────────────────────────────────────────────
      agent_created: {
        logType: 'success', tag: 'Agent', tagClass: 'wf-log-tag--agent',
        labelFn: (msg) => msg || 'Agent created',
      },

      // ── Agent status heartbeat ───────────────────────────────────────────
      agent_status_changed: {
        logType: 'info', tag: 'Status', tagClass: 'wf-log-tag--system',
        useHtml: true,
        labelFn: (_msg, _nt, _err, agents) => _buildAgentStatusHtml(agents),
      },
      status_sync: {
        logType: 'info', tag: 'Sync', tagClass: 'wf-log-tag--system',
        useHtml: true,
        labelFn: (_msg, _nt, _err, agents) => _buildAgentStatusHtml(agents),
      },

      // ── Runtime events ───────────────────────────────────────────────────
      detection_event: {
        logType: 'warning', tag: 'Detection', tagClass: 'wf-log-tag--agent',
        labelFn: (msg, _nt, _err, _agents, extra) => {
          const sev = extra && extra.severity ? ` [${extra.severity}]` : '';
          return (msg || 'Detection fired') + sev;
        },
      },
      notification_triggered: {
        logType: 'success', tag: 'Notify', tagClass: 'wf-log-tag--notification',
        labelFn: (msg) => msg || 'Notification sent',
      },
      alarm_triggered: {
        logType: 'error', tag: 'Alarm', tagClass: 'wf-log-tag--alarm',
        labelFn: (msg) => msg || 'Alarm triggered',
      },
      report_generated: {
        logType: 'success', tag: 'Report', tagClass: 'wf-log-tag--report',
        labelFn: (msg) => msg || 'Report generated',
      },
    };

    // Map node type to log tag CSS class
    function _nodeTypeTagClass(nodeType) {
      const m = {
        camera:                     'wf-log-tag--camera',
        class_detection_agent:      'wf-log-tag--agent',
        class_detection_zone_agent: 'wf-log-tag--agent',
        object_count_agent:         'wf-log-tag--agent',
        person_behaviour_agent:     'wf-log-tag--agent',
        vlm_agent:                  'wf-log-tag--agent',
        notification:               'wf-log-tag--notification',
        alarm_notification:         'wf-log-tag--alarm',
        iot_action:                 'wf-log-tag--iot',
        report:                     'wf-log-tag--report',
      };
      return m[nodeType] || 'wf-log-tag--system';
    }

    // Convert internal node type strings to friendly display labels
    function _nodeTypeLabel(nodeType) {
      if (!nodeType || nodeType === '__graph_parse__') return '';
      const labels = {
        start:                     'Start',
        camera:                    'Camera',
        class_detection_agent:     'Object Detection',
        class_detection_zone_agent:'Zone Detection',
        object_count_agent:        'Object Counter',
        person_behaviour_agent:    'Person Behaviour',
        vlm_agent:                 'VLM',
        notification:              'Notification',
        alarm_notification:        'Alarm',
        iot_action:                'IoT Action',
        report:                    'Report',
        end:                       'End',
        parse:                     '',   // internal, not shown
        detection:                 '',   // shown via message content instead
      };
      return labels[nodeType] !== undefined ? labels[nodeType] : nodeType;
    }

    // Build structured HTML rows for agent status heartbeat events
    function _buildAgentStatusHtml(agents) {
      if (!agents || agents.length === 0) return 'Agent status update';
      return agents.map(a => {
        const s    = a.paused ? 'Paused' : (a.status || 'Unknown');
        const dotCls = s === 'Monitoring' ? 'wf-log-agent-dot--running'
                     : s === 'Error'      ? 'wf-log-agent-dot--error'
                     : s === 'Cancelled'  ? 'wf-log-agent-dot--stopped'
                     : s === 'Paused'     ? 'wf-log-agent-dot--paused'
                     : s === 'Completed'  ? 'wf-log-agent-dot--done'
                     : 'wf-log-agent-dot--stopped';
        const name = _escHtml(a.name || a.id || 'agent');
        return `<span class="wf-log-agent-row"><span class="wf-log-agent-dot ${dotCls}"></span>${name}: ${_escHtml(s)}</span>`;
      }).join('');
    }

    // Build log line text + structured opts for _execLogAppend
    // Returns { text, type, opts } where opts = { tag, tagClass, elapsed, html }
    function _buildLogEntry(event, msg, nodeType, error, agents, extra) {
      const cfg = _EVENT_LOG_CONFIG[event];
      if (!cfg) {
        const label = _nodeTypeLabel(nodeType);
        return {
          text: label ? `${label}: ${msg || event}` : (msg || event),
          type: 'info',
          opts: { tag: label || null, tagClass: _nodeTypeTagClass(nodeType) },
        };
      }
      const text = cfg.labelFn(msg, nodeType, error, agents, extra);
      // Resolve tag — some entries use tagFn for dynamic tags
      const tag    = cfg.tagFn    ? cfg.tagFn(nodeType)    : (cfg.tag    || null);
      const tagCls = cfg.tagClsFn ? cfg.tagClsFn(nodeType) : (cfg.tagClass || 'wf-log-tag--system');
      return {
        text,
        type: cfg.logType || 'info',
        opts: { tag, tagClass: tagCls, html: cfg.useHtml || false },
      };
    }

    // ═══════════════════════════════════════════════════════════════════════
    // WEBSOCKET CONNECTION + MESSAGE HANDLER
    // ═══════════════════════════════════════════════════════════════════════

    function _connectExecWs(workflowId) {
      _activeWfId = workflowId;
      if (_execWs) { try { _execWs.close(); } catch (_) {} _execWs = null; }

      const token  = getAuthToken();
      const wsBase = API_BASE.replace(/^http/, 'ws');
      const url    = `${wsBase}/api/v1/workflows/${workflowId}/ws?token=${encodeURIComponent(token)}`;

      try { _execWs = new WebSocket(url); }
      catch (e) {
        _execLogAppend('Could not open event stream: ' + e.message, 'warning', { tag: 'WS', tagClass: 'wf-log-tag--error' });
        return;
      }

      // Start indeterminate progress bar — graph parse is about to begin
      _progressStart();

      _execWs.onopen = () => _execLogAppend('Connected to live event stream', 'success', { tag: 'WS', tagClass: 'wf-log-tag--system' });

      _execWs.onmessage = (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch { return; }

        if (msg.type === 'error') {
          _execLogAppend('Auth error: ' + (msg.message || ''), 'error', { tag: 'Auth', tagClass: 'wf-log-tag--error' });
          return;
        }
        if (msg.type !== 'workflow_event') { return; }

        const event    = msg.event     || '';
        const eventUid = msg.event_uid || '';

        // Deduplicate events (NATS + MongoDB can both deliver same event_uid)
        if (eventUid) {
          if (_seenExecEventUids.has(eventUid)) return;
          _seenExecEventUids.add(eventUid);
          if (_seenExecEventUids.size > 2000) {
            const first = _seenExecEventUids.values().next();
            if (!first.done) _seenExecEventUids.delete(first.value);
          }
        }

        const nodeId   = msg.node_id   || '';
        const nodeType = msg.node_type || '';
        const status   = msg.status    || '';
        const message  = msg.message   || '';
        const error    = msg.error     || '';
        const agents   = msg.agents    || [];
        const extra    = msg.extra     || {};

        // ─────────────────────────────────────────────────────────────────
        // SECTION A: Canvas node status badges + inline error callouts
        // ─────────────────────────────────────────────────────────────────

        if (nodeId && nodeId !== '__graph_parse__') {

          if (event === 'node_started') {
            _setNodeStatus(nodeId, 'running');
          }

          if (event === 'node_error') {
            _setNodeStatus(nodeId, 'error', { errorText: error || message });
          }

          if (event === 'node_completed') {
            _setNodeStatus(nodeId, 'completed');
            _animateEdgesFromNode(nodeId);     // one-shot flash
          }

          if (event === 'agent_created') {
            _setNodeStatus(nodeId, 'completed');
            _animateEdgesFromNode(nodeId);
          }

          if (event === 'detection_event') {
            _flashNodeEvent(nodeId);
            _animateEdgesFromNode(nodeId);
            _incrementNodeEventCount(nodeId);
          }

          if (event === 'notification_triggered' ||
              event === 'alarm_triggered'        ||
              event === 'report_generated') {
            _flashNodeEvent(nodeId);
            _animateEdgesFromNode(nodeId);
          }
        }

        // ─────────────────────────────────────────────────────────────────
        // SECTION B: Agent heartbeat → canvas badges + persistent live edges
        // ─────────────────────────────────────────────────────────────────

        if (event === 'agent_status_changed' || event === 'status_sync') {
          agents.forEach(agent => {
            const agentNodeId  = agent.drawflow_agent_node_id;
            const cameraNodeId = agent.drawflow_camera_node_id;
            const agentStatus  = (agent.status || '').toLowerCase();
            const isPaused     = !!agent.paused;

            if (!agentNodeId) return;

            const displayStatus = isPaused                       ? 'paused'
              : agentStatus === 'monitoring'                     ? 'monitoring'
              : agentStatus === 'cancelled'                      ? 'cancelled'
              : agentStatus;

            _setNodeStatus(agentNodeId, displayStatus);

            // Persistent live-edge animation while agent is monitoring
            const isLive = agentStatus === 'monitoring' && !isPaused;
            if (cameraNodeId) {
              _setNodeStatus(cameraNodeId, isLive ? 'running' : displayStatus);
              _setEdgeLive(cameraNodeId, isLive);
            }
            _setEdgeLive(agentNodeId, isLive);
          });

          _updateTopbarButtons(status);
        }

        // ─────────────────────────────────────────────────────────────────
        // SECTION C: Topbar buttons + progress bar + canvas banners
        // ─────────────────────────────────────────────────────────────────

        if (event === 'workflow_started') {
          _updateTopbarButtons('running');
          // Progress bar stays indeterminate until workflow_completed / error
        }

        if (event === 'workflow_completed') {
          _progressDone(false);
          _updateTopbarButtons('completed');
          _clearAllLiveEdges();
          const agentCount = (msg.agents || []).length || '';
          _showCanvasBanner('success',
            'Workflow executed successfully',
            message || (agentCount ? `${agentCount} agent(s) now monitoring` : 'Agents are monitoring'),
          );
        }

        if (event === 'workflow_error') {
          _progressDone(true);
          _updateTopbarButtons('error');
          _clearAllLiveEdges();
          _showCanvasBanner('error',
            'Workflow execution failed',
            error || message || 'Check the execution log for details',
          );
        }

        if (event === 'workflow_stopped') {
          _updateTopbarButtons('stopped');
          _clearAllLiveEdges();
          // Reset all running nodes to stopped
          document.querySelectorAll('.wf-node--running').forEach(el => {
            el.classList.replace('wf-node--running', 'wf-node--stopped');
            const b = el.querySelector('.' + _NODE_STATUS_BADGE_CLASS);
            if (b) b.innerHTML = '<i class="fa-solid fa-stop"></i>';
          });
          _showCanvasBanner('stopped', 'Workflow stopped', message || '');
        }

        if (event === 'workflow_paused') {
          _updateTopbarButtons('paused');
        }

        if (event === 'workflow_resumed') {
          _updateTopbarButtons('running');
        }

        // ─────────────────────────────────────────────────────────────────
        // SECTION D: Structured execution log
        // ─────────────────────────────────────────────────────────────────

        // Skip noisy heartbeat lines from the log panel — they update the
        // canvas badges but don't need to flood the text log every 5 s.
        if (event === 'agent_status_changed' || event === 'status_sync') {
          // Only log the first status_sync at connect; skip all subsequent heartbeats
          if (event === 'status_sync' && agents && agents.length > 0) {
            const entry = _buildLogEntry(event, message, nodeType, error, agents, extra);
            _execLogAppend(entry.text, entry.type, entry.opts);
          }
          return;
        }

        const entry = _buildLogEntry(event, message, nodeType, error, agents, extra);
        _execLogAppend(entry.text, entry.type, entry.opts);
      };

      _execWs.onclose = () => {
        _execLogAppend('Event stream closed', 'info', { tag: 'WS', tagClass: 'wf-log-tag--system' });
        _execWs = null;
      };
      _execWs.onerror = () => _execLogAppend('Event stream error', 'warning', { tag: 'WS', tagClass: 'wf-log-tag--error' });
    }

    // ── Wire exec log panel buttons ──────────────────────────────────────────
    document.getElementById('wf-exec-log-close')?.addEventListener('click', _execLogClose);
    document.getElementById('wf-exec-log-clear')?.addEventListener('click', _execLogClear);

    // ── Stop / Pause / Resume from topbar ────────────────────────────────────
    async function _wfAction(action, successMsg, warnMsg) {
      const wid = _activeWfId || editWorkflowId;
      if (!wid) return;
      if (action === 'stop' && !confirm('Stop this Watch Dog?')) return;
      try {
        const token = getAuthToken();
        await fetch(`${API_BASE}/api/v1/workflows/${wid}/${action}`, {
          method: 'POST', headers: { Authorization: `Bearer ${token}` }
        });
        const actionTag = { stop: 'Stopped', pause: 'Paused', resume: 'Resumed' }[action] || action;
        const actionType = (action === 'stop' || action === 'pause') ? 'warning' : 'success';
        _execLogAppend(successMsg, actionType, { tag: actionTag, tagClass: 'wf-log-tag--system' });
        toast[action === 'resume' ? 'success' : 'warning']?.(successMsg) || toast.info(successMsg);
        // Immediately reflect on canvas
        if (action === 'stop') {
          _clearAllLiveEdges();
          document.querySelectorAll('.wf-node--running').forEach(el => {
            el.classList.replace('wf-node--running', 'wf-node--stopped');
            const b = el.querySelector('.' + _NODE_STATUS_BADGE_CLASS);
            if (b) b.innerHTML = '<i class="fa-solid fa-stop"></i>';
          });
          _updateTopbarButtons('stopped');
          _showCanvasBanner('stopped', 'Workflow stopped', 'All agents have been terminated.');
        }
        if (action === 'pause') {
          _clearAllLiveEdges();
          document.querySelectorAll('.wf-node--running').forEach(el => {
            el.classList.replace('wf-node--running', 'wf-node--paused');
            const b = el.querySelector('.' + _NODE_STATUS_BADGE_CLASS);
            if (b) b.innerHTML = '<i class="fa-solid fa-pause"></i>';
          });
          _updateTopbarButtons('paused');
        }
        if (action === 'resume') {
          document.querySelectorAll('.wf-node--paused').forEach(el => {
            el.classList.replace('wf-node--paused', 'wf-node--running');
            const b = el.querySelector('.' + _NODE_STATUS_BADGE_CLASS);
            if (b) b.innerHTML = '<span class="wf-badge-spin"></span>';
          });
          _updateTopbarButtons('running');
        }
      } catch (e) { toast.error('Failed: ' + e.message); }
    }

    document.getElementById('btn-stop-workflow')?.addEventListener('click',   () => _wfAction('stop',   'Stop signal sent — workers terminating…'));
    document.getElementById('btn-pause-workflow')?.addEventListener('click',  () => _wfAction('pause',  'Pause signal sent'));
    document.getElementById('btn-resume-workflow')?.addEventListener('click', () => _wfAction('resume', 'Resume signal sent'));

    // ── Run Watch Dog button ─────────────────────────────────────────────────
    const runWorkflowBtn = document.getElementById('btn-run-workflow');
    if (runWorkflowBtn) {
      runWorkflowBtn.addEventListener('click', async () => {
        try {
          runWorkflowBtn.disabled = true;
          runWorkflowBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Saving…</span>';
          const saveResult = await saveWorkflowToBackend();
          if (!saveResult) {
            runWorkflowBtn.disabled = false;
            runWorkflowBtn.innerHTML = '<i class="fa-solid fa-play"></i><span>Run Watch Dog</span>';
            return;
          }
          const workflowIdToRun = saveResult.id || editWorkflowId;
          if (!workflowIdToRun) {
            toast.error('Cannot run workflow: no workflow ID found after save.');
            runWorkflowBtn.disabled = false;
            runWorkflowBtn.innerHTML = '<i class="fa-solid fa-play"></i><span>Run Watch Dog</span>';
            return;
          }

          // Update stop/pause buttons with the new workflow ID
          ['btn-stop-workflow', 'btn-pause-workflow', 'btn-resume-workflow'].forEach(id => {
            const b = document.getElementById(id);
            if (b) b.setAttribute('data-workflow-id', workflowIdToRun);
          });

          // Always force the log panel open when Run is clicked — don't let a
          // previously-saved closed state keep it hidden during live execution.
          _execLogClear();
          _execLogOpen(_LOG_HEIGHT_DEFAULT);
          _resetAllNodeStatus();
          _execLogAppend('Starting Watch Dog…', 'running');
          _connectExecWs(workflowIdToRun);

          runWorkflowBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Starting agents…</span>';
          const token = getAuthToken();
          const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
          const execRes = await fetch(`${API_BASE}/api/v1/workflows/${workflowIdToRun}/execute`, { method: 'POST', headers });

          if (execRes.status === 401) {
            toast.error('Session expired. Please login again.');
            _execLogAppend('Authentication failed', 'error');
            runWorkflowBtn.disabled = false;
            runWorkflowBtn.innerHTML = '<i class="fa-solid fa-play"></i><span>Run Watch Dog</span>';
            return;
          }
          const execResult = await execRes.json();
          if (execRes.ok) {
            const camList = (execResult.cameras || []).join(', ') || 'none';
            _execLogAppend(`Agents launched: ${execResult.agents_started || 0} | Cameras: ${camList}`, 'success');
            toast.success(`Watch Dog started — ${execResult.agents_started || 0} agent(s) launching`);
            runWorkflowBtn.innerHTML = '<i class="fa-solid fa-circle-dot"></i><span>Running…</span>';
          } else {
            const errMsg = execResult.detail || execResult.message || 'Unknown error';
            _execLogAppend('Failed to start agents: ' + errMsg, 'error');
            toast.error('Watch Dog saved but failed to start agents: ' + errMsg);
            runWorkflowBtn.disabled = false;
            runWorkflowBtn.innerHTML = '<i class="fa-solid fa-play"></i><span>Run Watch Dog</span>';
          }
        } catch (err) {
          console.error('[RunWorkflow] Unexpected error:', err);
          _execLogAppend('Unexpected error: ' + err.message, 'error');
          toast.error('Unexpected error while running Watch Dog.');
          runWorkflowBtn.disabled = false;
          runWorkflowBtn.innerHTML = '<i class="fa-solid fa-play"></i><span>Run Watch Dog</span>';
        }
      });
    }

    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', async (ev) => {
      const file = ev.target.files && ev.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const data = parsed && parsed.data ? parsed.data : parsed;
        editor.clear();
        editor.import(data);
        setTimeout(() => {
          refreshAllNodeHtml();
          setupAllNodeInputHandlers();
          populateCameraDropdowns();
          populateAllIoTDeviceRows();
        }, 50);
      } catch (err) {
        console.error(err);
        toast.error('Invalid workflow JSON.');
      } finally {
        importFile.value = '';
      }
    });

    function addExample() {
      let lastNodeId = null;
      const add = (key, x, y, overrides) => {
        const def = NODE_DEFINITIONS[key];
        const data = Object.assign(initialDataFor(def), overrides || {});
        const html = createNodeContentHtml(def, data);
        lastNodeId = editor.addNode(key, def.inputs, def.outputs, x, y, key, data, html);
        return lastNodeId;
      };
      const nStart = add('start', 40, 120, { __label: 'Start', schedule_type: 'always', run_mode: 'continuous' });
      const nCamera = add('camera', 260, 120, { __label: 'Camera', camera_ids: '' });
      const nAgent = add('class_detection_agent', 520, 120, { __label: 'Class Detection Agent', agent_name: 'Safety Detection Agent', rule_id: 'class_presence', model_name: 'yolov8m.pt' });
      const nNotification = add('notification', 780, 120, { __label: 'Ops email', channel: 'Email', subject: 'Safety alert from camera workflow' });
      const nReport = add('report', 1040, 120, {
        __label: 'Daily Report',
        report_type: 'events',
        report_schedule: 'end_of_day',
        end_of_day_time: '23:55',
        interval_minutes: 60,
        recipients: ''
      });
      const nEnd = add('end', 1300, 120, { __label: 'End' });
      editor.addConnection(nStart, nCamera, 'output_1', 'input_1');
      editor.addConnection(nCamera, nAgent, 'output_1', 'input_1');
      editor.addConnection(nAgent, nNotification, 'output_1', 'input_1');
      editor.addConnection(nNotification, nReport, 'output_1', 'input_1');
      editor.addConnection(nReport, nEnd, 'output_1', 'input_1');
      setupAllNodeInputHandlers();
    }

    async function loadWorkflowForEdit(workflowId) {
      try {
        const token = getAuthToken();
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const response = await fetch(`${API_BASE}/api/v1/workflows/${workflowId}`, { method: 'GET', headers });
        if (response.status === 401) { toast.error('Session expired. Please login again.'); return false; }
        if (response.ok) {
          const workflowData = await response.json();
          console.log('Loading workflow:', workflowData);
          window.currentWorkflowName = workflowData.name || '';
          window.currentWorkflowOwner = workflowOwner || '';
          window.currentWorkflowDescription = workflowData.description || '';
          const nameInput = document.getElementById('workflow-name-input');
          if (nameInput && workflowData.name) nameInput.value = workflowData.name;
          editor.clear();
          if (workflowData.drawflow_data) {
            editor.import(workflowData.drawflow_data);
            // Regenerate node HTML to reflect saved data values, then setup handlers
            setTimeout(() => {
              refreshAllNodeHtml();
              setupAllNodeInputHandlers();
              populateCameraDropdowns();
              populateAllIoTDeviceRows();
              updateNotificationNodesForSchedule();
            }, 50);
          }
          document.title = `Edit Watch Dog: ${window.currentWorkflowName}`;
          return true;
        } else {
          console.error('Failed to load Watch Dog:', response.statusText);
          toast.error('Failed to load Watch Dog for editing');
          return false;
        }
      } catch (error) {
        console.error('Error loading Watch Dog:', error);
        toast.error('Error loading Watch Dog for editing');
        return false;
      }
    }

    function normalizeAgentNodeConfig(nodeKey, config) {
      if (!config || typeof config !== 'object') return {};
      const c = Object.assign({}, config);
      if (nodeKey === 'camera') {
        if (c.camera_ids == null && c.camera_id != null) {
          c.camera_ids = Array.isArray(c.camera_id) ? c.camera_id.join(',') : String(c.camera_id);
        }
        if (Array.isArray(c.camera_ids)) c.camera_ids = c.camera_ids.join(',');
        delete c.camera_id;
      }
      if (nodeKey === 'notification') {
        if (c.channel) {
          const ch = String(c.channel).toLowerCase();
          if (ch === 'email') c.channel = 'Email';
          else if (ch === 'sms') c.channel = 'SMS';
          else if (ch === 'webhook') c.channel = 'Webhook';
        }
        if (c.importance) {
          const im = String(c.importance).toLowerCase();
          c.importance = im === 'high' ? 'High' : im === 'low' ? 'Low' : 'Normal';
        }
      }
      if (nodeKey === 'alarm_notification') {
        // alarm is always critical/siren/vibration — no user config needed
      }
      if (nodeKey === 'iot_action') {
        // Ensure devices is always an array and each entry has correct types
        if (!Array.isArray(c.devices)) c.devices = [];
        c.devices = c.devices
          .filter(d => d && d.device_id)
          .map(d => ({
            device_id:          String(d.device_id),
            command:            String(d.command || 'ON').toUpperCase() === 'OFF' ? 'OFF' : 'ON',
            channel:            parseInt(d.channel || 0, 10),
            auto_reset_seconds: parseInt(d.auto_reset_seconds || 0, 10),
          }));
      }
      if (nodeKey === 'start' && Array.isArray(c.active_days)) {
        c.active_days = c.active_days.join(', ');
      }
      return c;
    }

    function sleep(ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    }

    function topologicalSortIds(nodeIds, edges) {
      const incoming = {};
      nodeIds.forEach(function (id) { incoming[String(id)] = 0; });
      edges.forEach(function (e) {
        const to = String(e.to);
        if (incoming[to] !== undefined) incoming[to]++;
      });
      const queue = nodeIds.filter(function (id) { return incoming[String(id)] === 0; });
      const result = [];
      const adj = {};
      edges.forEach(function (e) {
        const f = String(e.from);
        if (!adj[f]) adj[f] = [];
        adj[f].push(String(e.to));
      });
      while (queue.length) {
        const id = String(queue.shift());
        result.push(id);
        (adj[id] || []).forEach(function (to) {
          if (incoming[to] === undefined) return;
          incoming[to]--;
          if (incoming[to] === 0) queue.push(to);
        });
      }
      nodeIds.forEach(function (id) {
        const s = String(id);
        if (result.indexOf(s) === -1) result.push(s);
      });
      return result;
    }

    function extractFromDrawflowHome(home) {
      const data = home.data;
      if (!data) return null;
      const ids = Object.keys(data);
      const edges = [];
      ids.forEach(function (id) {
        const n = data[id];
        const outs = n.outputs || {};
        Object.keys(outs).forEach(function (ok) {
          (outs[ok].connections || []).forEach(function (c) {
            edges.push({ from: String(id), to: String(c.node) });
          });
        });
      });
      const order = topologicalSortIds(ids, edges);
      const nodes = order.map(function (id) {
        const n = data[id];
        return {
          id: id,
          type: n.name,
          name: n.name,
          label: (n.data && n.data.__label) || (NODE_DEFINITIONS[n.name] && NODE_DEFINITIONS[n.name].label),
          config: Object.assign({}, n.data || {})
        };
      });
      return { nodes: nodes, edges: edges };
    }

    function extractWorkflowGraph(wf) {
      if (!wf || typeof wf !== 'object') return null;
      if (Array.isArray(wf.nodes) && Array.isArray(wf.edges)) {
        const nodes = wf.nodes.map(function (n, i) {
          const copy = Object.assign({}, n);
          if (copy.id == null || copy.id === '') copy.id = 'agent_' + i;
          return copy;
        });
        return { nodes: nodes, edges: wf.edges.map(function (e) { return Object.assign({}, e); }) };
      }
      const inner = wf.drawflow && wf.drawflow.Home ? wf : (wf.data && wf.data.drawflow && wf.data.drawflow.Home ? wf.data : null);
      if (!inner || !inner.drawflow || !inner.drawflow.Home) return null;
      return extractFromDrawflowHome(inner.drawflow.Home);
    }

    function orderNodesForGraph(graph) {
      const ids = graph.nodes.map(function (n) { return String(n.id); });
      const order = topologicalSortIds(ids, graph.edges);
      const map = {};
      graph.nodes.forEach(function (n) { map[String(n.id)] = n; });
      return order.map(function (id) { return map[id]; }).filter(Boolean);
    }

    function getWorkflowNodeLayoutDims(containerEl) {
      var vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
      var cw = containerEl && containerEl.clientWidth > 0 ? containerEl.clientWidth : vw;
      var cardW = Math.min(280, Math.max(160, Math.min(vw - 120, cw - 40)));
      cardW = Math.max(150, Math.min(220, Math.round(cardW * 0.82)));
      var NODE_W = cardW + 22;
      var NODE_H = Math.max(102, Math.round(210 * (cardW / 240)));
      var GAP_X = Math.max(18, Math.round(40 * (cardW / 240)));
      var GAP_Y = Math.max(29, Math.round(56 * (cardW / 240)));
      var PAD = vw < 576 ? 16 : (vw < 992 ? 22 : 32);
      return { NODE_W: NODE_W, NODE_H: NODE_H, GAP_X: GAP_X, GAP_Y: GAP_Y, PAD: PAD, cardW: cardW, stepFallback: NODE_W + GAP_X };
    }

    function getReservedRightWidthForChat(containerEl) {
      if (typeof window === 'undefined' || !containerEl) return 0;
      var chatDock = document.querySelector('.wf-canvas-column .wf-ai-chat.wf-ai-chat--open');
      if (!chatDock) return 0;
      var cRect = containerEl.getBoundingClientRect();
      var pRect = chatDock.getBoundingClientRect();
      if (!cRect || !pRect) return 0;
      // Reserve the panel width + breathing gap only when it overlaps canvas area.
      var overlap = Math.max(0, Math.min(cRect.right, pRect.right) - Math.max(cRect.left, pRect.left));
      if (overlap <= 0) return 0;
      return overlap + 24;
    }

    function computeGenLayoutPositions(count, containerEl) {
      var dims = getWorkflowNodeLayoutDims(containerEl);
      var NODE_W = dims.NODE_W;
      var NODE_H = dims.NODE_H;
      var GAP_X = dims.GAP_X;
      var GAP_Y = dims.GAP_Y;
      var PAD = dims.PAD;
      const canvasW = Math.max(320, (containerEl && containerEl.clientWidth) || 900);
      const reservedRight = getReservedRightWidthForChat(containerEl);
      const w = Math.max(260, canvasW - reservedRight);
      const avail = Math.max(180, w - 2 * PAD);
      const minStepX = NODE_W + GAP_X;
      let cols = Math.max(1, Math.floor(avail / minStepX));
      if (count > 0 && count < cols) cols = count;
      let rows = Math.ceil(count / cols);
      let stepX = cols <= 1 ? 0 : Math.max(minStepX, (avail - NODE_W) / Math.max(cols - 1, 1));
      let totalW = cols <= 1 ? NODE_W : (cols - 1) * stepX + NODE_W;
      while (totalW > avail && cols > 1) {
        cols--;
        rows = Math.ceil(count / cols);
        stepX = cols <= 1 ? 0 : Math.max(minStepX, (avail - NODE_W) / Math.max(cols - 1, 1));
        totalW = cols <= 1 ? NODE_W : (cols - 1) * stepX + NODE_W;
      }
      const positions = [];
      for (let i = 0; i < count; i++) {
        const row = Math.floor(i / cols);
        const col = i % cols;
        const rowStart = row * cols;
        const rowCount = Math.min(cols, count - rowStart);
        const rowW = rowCount <= 1 ? NODE_W : (rowCount - 1) * stepX + NODE_W;
        const startX = PAD + (avail - rowW) / 2;
        positions.push({
          x: startX + col * stepX,
          y: PAD + row * (NODE_H + GAP_Y)
        });
      }
      return positions;
    }

    function animateNodeEnter(nid) {
      requestAnimationFrame(function () {
        const el = document.getElementById('node-' + nid);
        if (!el) return;
        el.classList.add('wf-gen-node-enter');
        function done() {
          el.classList.remove('wf-gen-node-enter');
          el.style.willChange = 'auto';
          el.removeEventListener('animationend', done);
        }
        el.addEventListener('animationend', done, { once: true });
      });
    }

    /**
     * Run synchronously right after addConnection so the connector never paints as a full wf-flow line first.
     */
    function prepareConnectionLineHidden(path) {
      if (!path || typeof path.getTotalLength !== 'function') return 0;
      path.classList.add('wf-gen-conn-dots');
      path.style.setProperty('animation', 'none', 'important');
      path.style.setProperty('stroke', '#6366f1', 'important');
      path.style.setProperty('stroke-width', '2px', 'important');
      path.style.setProperty('stroke-linecap', 'round', 'important');
      path.style.setProperty('fill', 'none', 'important');
      path.style.setProperty('transition', 'none', 'important');
      var len = path.getTotalLength();
      if (len > 2) {
        path.style.setProperty('opacity', '1', 'important');
        path.style.setProperty('stroke-dasharray', len + ' ' + len, 'important');
        path.style.setProperty('stroke-dashoffset', String(len), 'important');
      } else {
        path.style.setProperty('opacity', '0', 'important');
      }
      return len;
    }

    /**
     * Draw the edge in (stroke-dashoffset → 0). Path should already be prepareConnectionLineHidden.
     */
    function animateConnectionLineDrawIn(path) {
      return new Promise(function (resolve) {
        if (!path || typeof path.getTotalLength !== 'function') {
          resolve();
          return;
        }

        function startAnimation(len) {
          var durMs = Math.min(3200, Math.max(750, (len / 380) * 1000));
          var finished = false;
          var rafId = null;
          var t0 = null;

          function cleanup() {
            if (finished) return;
            finished = true;
            if (rafId != null) cancelAnimationFrame(rafId);
            path.classList.remove('wf-gen-conn-dots');
            path.style.removeProperty('stroke-dasharray');
            path.style.removeProperty('stroke-dashoffset');
            path.style.removeProperty('opacity');
            path.style.removeProperty('stroke-linecap');
            path.style.removeProperty('stroke');
            path.style.removeProperty('stroke-width');
            path.style.removeProperty('fill');
            path.style.removeProperty('animation');
            path.style.removeProperty('transition');
            resolve();
          }

          function tick(now) {
            if (finished) return;
            if (t0 == null) t0 = now;
            var u = Math.min(1, (now - t0) / durMs);
            var e = 1 - Math.pow(1 - u, 3);
            var off = len * (1 - e);
            path.style.setProperty('stroke-dashoffset', String(off), 'important');
            if (u < 1) {
              rafId = requestAnimationFrame(tick);
            } else {
              path.style.setProperty('stroke-dashoffset', '0', 'important');
              cleanup();
            }
          }

          t0 = null;
          rafId = requestAnimationFrame(tick);
        }

        var len = path.getTotalLength();
        if (len > 2) {
          path.style.setProperty('stroke-dasharray', len + ' ' + len, 'important');
          path.style.setProperty('stroke-dashoffset', String(len), 'important');
          path.style.setProperty('opacity', '1', 'important');
          startAnimation(len);
          return;
        }

        requestAnimationFrame(function () {
          len = prepareConnectionLineHidden(path);
          if (!len || len < 2) {
            path.classList.remove('wf-gen-conn-dots');
            path.style.removeProperty('animation');
            path.style.removeProperty('opacity');
            path.style.removeProperty('transition');
            resolve();
            return;
          }
          startAnimation(len);
        });
      });
    }

    async function animateWorkflowImportFromGraph(graph) {
      if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) return false;
      console.log('[WF-chat] animateWorkflowImportFromGraph: nodes =', graph.nodes.length, 'edges =', (graph.edges || []).length);
      const ordered = orderNodesForGraph(graph);
      const container = document.getElementById('drawflow');
      const canvasCol = container && container.closest('.wf-canvas-column');
      if (canvasCol) canvasCol.classList.add('wf-canvas--gen-animating');
      const layoutDims = getWorkflowNodeLayoutDims(container);
      const positions = computeGenLayoutPositions(ordered.length, container);
      editor.clear();
      const idMap = {};
      /* Slower cadence: long pause after each node / after each connection line finishes */
      const NODE_STAGGER_MS = 1380;
      const EDGE_PAUSE_AFTER_CONN_MS = 520;
      for (let i = 0; i < ordered.length; i++) {
        const n = ordered[i];
        const nodeKey = n.type || n.name;
        if (!nodeKey || !NODE_DEFINITIONS[nodeKey]) {
          console.warn('[Workflow chat] Skipping unknown node type:', nodeKey);
          continue;
        }
        const def = NODE_DEFINITIONS[nodeKey];
        const raw = n.config || {};
        const merged = Object.assign({}, initialDataFor(def), normalizeAgentNodeConfig(nodeKey, raw));
        merged.__label = (n.label != null && n.label !== '') ? n.label : merged.__label;
        const pos = positions[i] || { x: layoutDims.PAD + i * layoutDims.stepFallback, y: 80 + layoutDims.PAD };
        const html = createNodeContentHtml(def, merged);
        const nid = editor.addNode(nodeKey, def.inputs, def.outputs, pos.x, pos.y, nodeKey, merged, html);
        idMap[String(n.id)] = nid;
        animateNodeEnter(nid);
        await sleep(NODE_STAGGER_MS);
      }
      const edges = graph.edges || [];
      console.log('[WF-chat] animateWorkflowImportFromGraph: edges count =', edges.length, 'gen-animating =', canvasCol && canvasCol.classList.contains('wf-canvas--gen-animating'));
      for (let j = 0; j < edges.length; j++) {
        const e = edges[j];
        const from = idMap[String(e.from)];
        const to = idMap[String(e.to)];
        if (from == null || to == null) {
          console.warn('[WF-chat] edge', j, 'skip idMap', e, 'from', from, 'to', to);
          continue;
        }
        try {
          editor.addConnection(from, to, 'output_1', 'input_1');
          console.log('[WF-chat] addConnection OK', j, { from, to, edge: e });
        } catch (err) {
          console.warn('[WF-chat] addConnection FAILED', j, e, err);
          continue;
        }
        var pathsAfter = getDrawflowConnectionMainPaths();
        var lastPath = pathsAfter.length ? pathsAfter[pathsAfter.length - 1] : null;
        if (lastPath) {
          prepareConnectionLineHidden(lastPath);
        } else {
          console.warn('[WF-chat] could not resolve path for edge', j, '— line draw will skip');
        }
        await animateConnectionLineDrawIn(lastPath);
        await sleep(EDGE_PAUSE_AFTER_CONN_MS);
      }
      if (canvasCol) canvasCol.classList.remove('wf-canvas--gen-animating');
      console.log('[WF-chat] import finished, calling forceConnectionStyles()');
      forceConnectionStyles();
      await sleep(80);
      refreshAllNodeHtml();
      setupAllNodeInputHandlers();
      populateCameraDropdowns();
      populateAllIoTDeviceRows();
      updateNotificationNodesForSchedule();
      /* Do not call editor.zoom_reset() here — it would reset zoom after import and undo zoom the user applied during the animation. */
      return true;
    }

    function newWorkflowChatSessionId() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
      }
      return 'wf-' + Date.now() + '-' + Math.random().toString(36).slice(2, 11);
    }

    function initWorkflowAiChatDock() {
      const ta = document.getElementById('wf-ai-chat-input');
      const sendBtn = document.getElementById('wf-ai-chat-send');
      const voiceBtn = document.getElementById('wf-ai-chat-voice');
      const chatInner = document.getElementById('wf-ai-chat-inner');
      const loadingEl = document.getElementById('wf-ai-chat-loading');
      const loadingTextEl = loadingEl && loadingEl.querySelector('.wf-ai-chat-loading__text');
      const modelToggle = document.getElementById('wf-ai-chat-model-toggle');
      const modelLabel = modelToggle && modelToggle.querySelector('.wf-ai-chat-model-label');
      const modeEl = document.getElementById('wf-ai-chat-mode');
      const newThreadBtn = document.getElementById('wf-ai-chat-new-thread');
      const chatDockEl = document.querySelector('.wf-ai-chat');
      const chatLauncherBtn = document.getElementById('wf-ai-chat-launcher');
      const chatCloseBtn = document.getElementById('wf-ai-chat-close');
      const chatResizer = document.getElementById('wf-ai-chat-resizer');
      const chatHost = container && container.closest('.wf-canvas-column');
      const CHAT_WIDTH_KEY = 'visionai.workflow.chatWidth.v1';
      const CHAT_WIDTH_MIN = 340;
      const CHAT_WIDTH_MAX = 680;

      const assistantPanel = document.getElementById('wf-ai-assistant-panel');
      const userSnippet = document.getElementById('wf-ai-user-msg-snippet');
      const userPromptHistoryEl = document.getElementById('wf-ai-user-msg-history');
      const assistantStatus = document.getElementById('wf-ai-assistant-status');
      const assistantStatusText = document.getElementById('wf-ai-assistant-status-text');
      const messagesEl = document.getElementById('wf-ai-assistant-messages');
      const clarBadge = document.getElementById('wf-ai-clarification-badge');
      const agentLogBody = document.getElementById('wf-ai-agent-log-body');
      const routerReasonEl = document.getElementById('wf-ai-router-reason');
      function setChatDockOpen(nextOpen) {
        const on = !!nextOpen;
        if (chatDockEl) chatDockEl.classList.toggle('wf-ai-chat--open', on);
        if (document && document.body) document.body.classList.toggle('wf-ai-chat-open', on);
        if (on) setTimeout(function () { try { ta && ta.focus(); } catch (_) {} }, 80);
      }
      if (chatLauncherBtn) chatLauncherBtn.addEventListener('click', function () { setChatDockOpen(true); });
      if (chatCloseBtn) chatCloseBtn.addEventListener('click', function () { setChatDockOpen(false); });
      if (ta) {
        ta.addEventListener('focus', function () { setChatDockOpen(true); });
      }
      setChatDockOpen(false);

      function setChatWidth(px) {
        if (!chatDockEl) return;
        var n = Math.max(CHAT_WIDTH_MIN, Math.min(CHAT_WIDTH_MAX, px || CHAT_WIDTH_MIN));
        chatDockEl.style.setProperty('--wf-chat-panel-width', n + 'px');
        try { localStorage.setItem(CHAT_WIDTH_KEY, String(n)); } catch (_) {}
      }
      try {
        var savedW = parseInt(localStorage.getItem(CHAT_WIDTH_KEY) || '', 10);
        if (Number.isFinite(savedW)) setChatWidth(savedW);
      } catch (_) {}
      if (chatResizer && chatHost && chatDockEl) {
        var resizing = false;
        function stopResize() {
          if (!resizing) return;
          resizing = false;
          chatResizer.classList.remove('is-dragging');
          document.body.style.userSelect = '';
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        }
        function onMove(e) {
          if (!resizing) return;
          var rect = chatDockEl.getBoundingClientRect();
          // Keep right edge fixed; derive width from pointer to current right edge.
          setChatWidth(rect.right - e.clientX);
        }
        function onUp() { stopResize(); }
        chatResizer.addEventListener('pointerdown', function (e) {
          if (e.button !== 0) return;
          resizing = true;
          chatResizer.classList.add('is-dragging');
          document.body.style.userSelect = 'none';
          chatResizer.setPointerCapture?.(e.pointerId);
          window.addEventListener('pointermove', onMove);
          window.addEventListener('pointerup', onUp);
        });
      }

      let wfChatSessionId = newWorkflowChatSessionId();
      let wfChatLastWorkflow = null;
      let wfChatLastPlan = null;
      let wfChatSlotFillPending = false;
      /** @type {Array<{user:string,assistant:string}>} */
      let wfChatTurns = [];
      /** Index into wfChatTurns for which assistant reply is shown */
      let wfChatSelectedTurnIndex = -1;
      /** @type {Array<{role:string,content:string,mode?:string}>} */
      let wfChatConversationHistory = [];

      var wfWatchdogVoiceWs = null;
      var wfWatchdogVoiceMic = null;
      var wfWatchdogVoiceCtx = null;
      var wfWatchdogVoiceWorklet = null;
      var wfWatchdogVoiceSource = null;
      var wfWatchdogVoiceNativeRate = 48000;
      var wfWatchdogVoiceTtsChunks = [];
      var wfWatchdogSpeaking = null;
      var wfWatchdogVoiceActive = false;
      var wfWatchdogVoiceLastUserText = '';
      var wfWatchdogVoiceLlmAcc = '';
      /** True after `tts_start` until TTS playback ends or empty `tts_done` (so `done` does not steal listening UI). */
      var wfWatchdogVoiceAwaitingTtsDone = false;

      function truncatePromptLabel(s, max) {
        max = max || 44;
        s = String(s || '').trim();
        if (!s) return 'Your message';
        if (s.length <= max) return s;
        return s.slice(0, max - 1) + '…';
      }

      function renderTurnMessages(idx) {
        if (!messagesEl || idx < 0 || idx >= wfChatTurns.length) return;
        messagesEl.innerHTML = '';
        for (var i = 0; i <= idx; i++) {
          var turn = wfChatTurns[i];

          // ── User bubble (right) ──
          var userWrap = document.createElement('div');
          userWrap.className = 'user-message-wrapper';
          var userBubble = document.createElement('div');
          userBubble.className = 'user-message';
          userBubble.textContent = String(turn.user || '').trim();
          userWrap.appendChild(userBubble);
          messagesEl.appendChild(userWrap);

          // ── AI bubble (left) ──
          var t = String(turn.assistant || '').trim();
          if (!t) {
            // Don't show "Thinking…" — the loading spinner in the composer is enough
            continue;
          }

          // One bubble per paragraph group
          var aiBubble = document.createElement('div');
          aiBubble.className = 'ai-message-transparent';
          t.split(/\n{2,}/).forEach(function (para, pi) {
            if (pi > 0) { var br = document.createElement('br'); aiBubble.appendChild(br); }
            var p = document.createElement('p');
            para.split(/\n/).forEach(function (line, li) {
              if (li > 0) p.appendChild(document.createElement('br'));
              p.appendChild(document.createTextNode(line));
            });
            aiBubble.appendChild(p);
          });
          messagesEl.appendChild(aiBubble);
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
      }

      function appendToActiveTurn(text) {
        if (!wfChatTurns.length) return;
        var chunk = String(text || '').trim();
        if (!chunk) return;
        var turn = wfChatTurns[wfChatTurns.length - 1];
        turn.assistant = turn.assistant ? (turn.assistant + '\n\n' + chunk) : chunk;
        if (wfChatSelectedTurnIndex === wfChatTurns.length - 1) {
          renderTurnMessages(wfChatSelectedTurnIndex);
        }
      }

      function rebuildUserPromptMenu() {
        if (!userPromptHistoryEl) return;
        userPromptHistoryEl.innerHTML = '';
        var ddBtn = document.getElementById('wf-ai-user-msg-dropdown-btn');
        var minIdx = Math.max(0, wfChatTurns.length - 25);
        for (var i = wfChatTurns.length - 1; i >= minIdx; i--) {
          (function (turnIndex) {
            var turn = wfChatTurns[turnIndex];
            var li = document.createElement('li');
            var btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'dropdown-item';
            btn.textContent = turn.user;
            if (turnIndex === wfChatSelectedTurnIndex) btn.classList.add('active');
            btn.addEventListener('click', function (ev) {
              ev.preventDefault();
              wfChatSelectedTurnIndex = turnIndex;
              if (userSnippet) userSnippet.textContent = truncatePromptLabel(wfChatTurns[turnIndex].user);
              rebuildUserPromptMenu();
              renderTurnMessages(turnIndex);
              if (ddBtn && window.bootstrap && window.bootstrap.Dropdown) {
                var dd = window.bootstrap.Dropdown.getInstance(ddBtn);
                if (dd) dd.hide();
              }
            });
            li.appendChild(btn);
            userPromptHistoryEl.appendChild(li);
          })(i);
        }
      }

      function registerUserPrompt(userText) {
        var t = String(userText || '').trim();
        if (!t) return;
        wfChatTurns.push({ user: t, assistant: '' });
        wfChatSelectedTurnIndex = wfChatTurns.length - 1;
        if (userSnippet) userSnippet.textContent = truncatePromptLabel(t);
        rebuildUserPromptMenu();
        renderTurnMessages(wfChatSelectedTurnIndex);
      }

      function isDevUi() {
        if (typeof window === 'undefined') return false;
        if (window.WORKFLOW_CHAT_SHOW_ROUTER_REASON === true) return true;
        var h = (window.location && window.location.hostname) || '';
        return h === 'localhost' || h === '127.0.0.1';
      }

      function setAssistantStatusVisible(on, message) {
        // Show/hide the inline typing indicator inside the messages area
        if (!messagesEl) return;
        var existingIndicator = messagesEl.querySelector('.wf-ai-typing-indicator');
        if (on) {
          if (!existingIndicator) {
            existingIndicator = document.createElement('div');
            existingIndicator.className = 'wf-ai-typing-indicator ai-message-transparent';
            messagesEl.appendChild(existingIndicator);
          }
          existingIndicator.textContent = message || 'Thinking…';
          messagesEl.scrollTop = messagesEl.scrollHeight;
        } else {
          if (existingIndicator) existingIndicator.remove();
        }
        // keep hidden elements in sync for any code that checks them
        if (assistantStatus) assistantStatus.hidden = !on;
        if (assistantStatusText && message) assistantStatusText.textContent = message || '';
      }

      function openAssistantPanelForUserMessage(userText) {
        setChatDockOpen(true);
        registerUserPrompt(userText);
        if (clarBadge) clarBadge.hidden = true;
        if (routerReasonEl) {
          routerReasonEl.hidden = true;
          routerReasonEl.textContent = '';
        }
      }

      function writeAgentLog(data) {
        if (!agentLogBody) return;
        try {
          var s = JSON.stringify(data, null, 2);
          if (s.length > 12000) s = s.slice(0, 12000) + '\n…';
          agentLogBody.textContent = s;
        } catch (e) {
          agentLogBody.textContent = String(data);
        }
      }

      function setModeUi(mode) {
        if (!modeEl) return;
        var label = 'AI: —';
        var title = 'No response yet';
        if (mode === 'create') { label = 'AI: new graph'; title = 'mode: create'; }
        else if (mode === 'refine') { label = 'AI: refine'; title = 'mode: refine'; }
        else if (mode === 'chat') { label = 'AI: chat'; title = 'mode: chat'; }
        else if (mode === 'chat_refine') { label = 'AI: chat+graph'; title = 'mode: chat_refine'; }
        modeEl.textContent = label;
        modeEl.title = title;
        modeEl.classList.toggle('text-success', mode === 'create');
        modeEl.classList.toggle('text-info', mode === 'refine' || mode === 'chat_refine');
        modeEl.classList.toggle('text-primary', mode === 'chat');
        modeEl.classList.toggle('text-secondary', !mode);
      }

      function resetWorkflowChatThread() {
        wfChatSessionId = newWorkflowChatSessionId();
        wfChatLastWorkflow = null;
        wfChatLastPlan = null;
        wfChatSlotFillPending = false;
        wfChatConversationHistory = [];
        wfChatTurns = [];
        wfChatSelectedTurnIndex = -1;
        setModeUi(null);
        if (messagesEl) messagesEl.innerHTML = '';
        if (userSnippet) userSnippet.textContent = 'Your message';
        if (userPromptHistoryEl) userPromptHistoryEl.innerHTML = '';
        if (clarBadge) clarBadge.hidden = true;
        if (agentLogBody) agentLogBody.textContent = '';
        if (routerReasonEl) { routerReasonEl.hidden = true; routerReasonEl.textContent = ''; }
        setAssistantStatusVisible(false);
        if (loadingEl) {
          loadingEl.hidden = true;
          loadingEl.setAttribute('aria-hidden', 'true');
        }
        chatInner && chatInner.classList.remove('wf-ai-chat-inner--fetching', 'wf-ai-chat-inner--building');
        endWatchdogVoiceSession();
      }

      if (newThreadBtn) {
        newThreadBtn.addEventListener('click', function () {
          resetWorkflowChatThread();
        });
      }
      document.querySelectorAll('.wf-ai-chat-model-option').forEach(function (opt) {
        opt.addEventListener('click', function (e) {
          e.preventDefault();
          const name = opt.getAttribute('data-model') || (opt.textContent || '').trim();
          if (modelLabel) modelLabel.textContent = name;
          if (modelToggle && window.bootstrap && window.bootstrap.Dropdown) {
            const dd = window.bootstrap.Dropdown.getInstance(modelToggle);
            if (dd) dd.hide();
          }
        });
      });
      const resizeTa = function () {
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 128) + 'px';
      };

      /** Empty input → wave voice assistant; text → send */
      function syncChatPrimaryAction() {
        if (!ta || !sendBtn || !voiceBtn) return;
        const hasText = (ta.value || '').trim().length > 0;
        sendBtn.hidden = !hasText;
        voiceBtn.hidden = hasText;
      }

      let speechRec = null;
      let speechListening = false;

      function stopSpeechListening() {
        speechListening = false;
        if (voiceBtn) voiceBtn.classList.remove('wf-ai-chat-voice--listening');
        if (speechRec) {
          try {
            speechRec.onresult = null;
            speechRec.onerror = null;
            speechRec.onend = null;
            speechRec.stop();
          } catch (e) { /* ignore */ }
          speechRec = null;
        }
      }

      function startSpeechListening() {
        if (!ta || busy || speechListening) return;
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) {
          toast.warning('Voice assistant is not available in this browser. Try Chrome or Edge, or type your message.');
          return;
        }
        stopSpeechListening();
        speechRec = new SR();
        speechRec.lang = (navigator.language || 'en-US').replace('_', '-');
        speechRec.interimResults = false;
        speechRec.maxAlternatives = 1;
        speechRec.continuous = false;
        speechListening = true;
        if (voiceBtn) voiceBtn.classList.add('wf-ai-chat-voice--listening');
        speechRec.onresult = function (ev) {
          var text = '';
          try {
            if (ev.results && ev.results.length) {
              text = String(ev.results[0][0].transcript || '').trim();
            }
          } catch (e) { text = ''; }
          stopSpeechListening();
          if (text) {
            ta.value = text;
            resizeTa();
            syncChatPrimaryAction();
            runGenerate();
          }
        };
        speechRec.onerror = function (ev) {
          /* Chromium uses cloud speech (Google); "network" = cannot reach that service — not your workflow API. */
          var err = ev && ev.error ? String(ev.error) : '';
          stopSpeechListening();
          if (err === 'aborted' || err === 'no-speech') return;
          var msg = err || 'Voice input failed';
          if (err === 'not-allowed') msg = 'Microphone permission denied.';
          else if (err === 'network') {
            msg = 'Voice recognition needs an internet connection (the browser sends audio to Google’s speech service). Check your network, firewall, VPN, or try again later — or type your message instead.';
          } else if (err === 'service-not-allowed') {
            msg = 'Speech service is not allowed (browser or policy may block cloud voice). Try typing your message.';
          }
          console.warn('[WF-chat] speech recognition:', err || '(unknown)', ev && ev.message ? ev.message : '');
          toast.warning(msg);
        };
        speechRec.onend = function () {
          if (speechListening) stopSpeechListening();
        };
        try {
          speechRec.start();
        } catch (e) {
          stopSpeechListening();
          toast.error('Could not start voice input.');
        }
      }

      if (ta) {
        ta.addEventListener('input', function () {
          resizeTa();
          syncChatPrimaryAction();
        });
        resizeTa();
      }
      syncChatPrimaryAction();

      let busy = false;
      function setBusy(v) {
        busy = v;
        if (sendBtn) {
          sendBtn.disabled = v;
          sendBtn.classList.toggle('opacity-50', v);
          const icon = sendBtn.querySelector('i');
          if (icon) {
            icon.className = v ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrow-up';
          }
        }
        if (voiceBtn) {
          var voiceSessionOpen = !!(wfWatchdogVoiceWs || wfWatchdogVoiceMic);
          voiceBtn.disabled = v && !voiceSessionOpen;
          voiceBtn.classList.toggle('opacity-50', v && !voiceSessionOpen);
        }
        if (ta) ta.disabled = v;
        if (v) stopSpeechListening();
      }

      function setFetchLoading(on, message) {
        if (loadingEl) {
          loadingEl.hidden = !on;
          loadingEl.setAttribute('aria-hidden', on ? 'false' : 'true');
          if (on && loadingTextEl && message) loadingTextEl.textContent = message;
        }
        chatInner && chatInner.classList.toggle('wf-ai-chat-inner--fetching', !!on);
      }

      function setBuildingPhase(on) {
        chatInner && chatInner.classList.toggle('wf-ai-chat-inner--building', !!on);
      }

      var WF_WATCHDOG_PCM_WORKLET = '\nclass PCMCaptureProcessor extends AudioWorkletProcessor {\n  constructor() {\n    super();\n    this._buf = [];\n    this._TARGET = 4096;\n  }\n  process(inputs) {\n    const ch = inputs[0] && inputs[0][0];\n    if (!ch) return true;\n    this._buf.push(new Float32Array(ch));\n    let total = this._buf.reduce((s, a) => s + a.length, 0);\n    if (total >= this._TARGET) {\n      const out = new Float32Array(total);\n      let offset = 0;\n      for (const b of this._buf) { out.set(b, offset); offset += b.length; }\n      this.port.postMessage(out.buffer, [out.buffer]);\n      this._buf = [];\n    }\n    return true;\n  }\n}\nregisterProcessor(\'pcm-capture\', PCMCaptureProcessor);\n';

      var WF_WATCHDOG_MIC = { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } };

      function wfDownsample(float32, fromRate, toRate) {
        if (fromRate === toRate) return float32;
        var ratio = fromRate / toRate;
        var out = new Float32Array(Math.floor(float32.length / ratio));
        for (var i = 0; i < out.length; i++) {
          var srcIdx = i * ratio;
          var lo = Math.floor(srcIdx);
          var hi = Math.min(lo + 1, float32.length - 1);
          var frac = srcIdx - lo;
          out[i] = float32[lo] * (1 - frac) + float32[hi] * frac;
        }
        return out;
      }

      function wfFloat32ToPcm16(float32) {
        var buf = new ArrayBuffer(float32.length * 2);
        var view = new DataView(buf);
        for (var i = 0; i < float32.length; i++) {
          var s = Math.max(-1, Math.min(1, float32[i]));
          view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }
        return buf;
      }

      function buildWatchdogVoiceWsUrl() {
        if (!api || !api.token) throw new Error('Not authenticated');
        var b = String(api.baseURL || '').replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
        return b + '/api/v1/watchdog/voice-stream?token=' + encodeURIComponent(api.token);
      }

      function teardownWatchdogVoiceMedia() {
        if (wfWatchdogVoiceWorklet) {
          try { wfWatchdogVoiceWorklet.port.onmessage = null; wfWatchdogVoiceWorklet.disconnect(); } catch (e1) {}
          wfWatchdogVoiceWorklet = null;
        }
        if (wfWatchdogVoiceSource) { try { wfWatchdogVoiceSource.disconnect(); } catch (e2) {} wfWatchdogVoiceSource = null; }
        if (wfWatchdogVoiceCtx) { try { wfWatchdogVoiceCtx.close(); } catch (e3) {} wfWatchdogVoiceCtx = null; }
        if (wfWatchdogVoiceMic) {
          try { wfWatchdogVoiceMic.getTracks().forEach(function (t) { t.stop(); }); } catch (e4) {}
          wfWatchdogVoiceMic = null;
        }
      }

      function closeWatchdogVoiceSocket() {
        if (!wfWatchdogVoiceWs) return;
        try {
          wfWatchdogVoiceWs.onopen = wfWatchdogVoiceWs.onmessage = wfWatchdogVoiceWs.onerror = wfWatchdogVoiceWs.onclose = null;
          if (wfWatchdogVoiceWs.readyState <= 1) wfWatchdogVoiceWs.close(1000, 'client');
        } catch (e) {}
        wfWatchdogVoiceWs = null;
      }

      function stopWatchdogTtsPlayback() {
        wfWatchdogVoiceAwaitingTtsDone = false;
        if (wfWatchdogSpeaking) {
          try { wfWatchdogSpeaking.pause(); } catch (e) {}
          wfWatchdogSpeaking = null;
        }
        wfWatchdogVoiceTtsChunks = [];
      }

      function endWatchdogVoiceSession() {
        wfWatchdogVoiceActive = false;
        wfWatchdogVoiceAwaitingTtsDone = false;
        if (voiceBtn) {
          voiceBtn.classList.remove('wf-ai-chat-voice--listening');
          voiceBtn.setAttribute('aria-label', 'Voice assistant — speak to send');
        }
        stopWatchdogTtsPlayback();
        closeWatchdogVoiceSocket();
        teardownWatchdogVoiceMedia();
        setBusy(false);
        setAssistantStatusVisible(false);
        setFetchLoading(false);
      }

      /**
       * Side chat voice (ChatbotVoice) must not share the mic with Watchdog voice.
       * Exposed so layout/chatbot-voice.js can release us before opening general-chat voice.
       */
      function registerWatchdogVoiceReleaseHook() {
        window.__workflowWatchdogVoiceRelease = function () {
          try { endWatchdogVoiceSession(); } catch (e) { /* ignore */ }
        };
      }

      /** True while Watchdog voice session holds mic and/or socket (for mutual exclusion). */
      function isWatchdogVoiceSessionOpen() {
        return !!(wfWatchdogVoiceWs || wfWatchdogVoiceMic);
      }

      /**
       * After each turn (TTS finished or no audio), show listening again while WS+mic stay up.
       */
      function wfResumeListeningAfterTurn() {
        if (!wfWatchdogVoiceMic) return;
        if (!wfWatchdogVoiceWs || wfWatchdogVoiceWs.readyState !== WebSocket.OPEN) return;
        if (voiceBtn) {
          voiceBtn.classList.add('wf-ai-chat-voice--listening');
          voiceBtn.setAttribute('aria-label', 'Listening — tap to stop watchdog voice');
        }
        setAssistantStatusVisible(false);
      }

      function playWatchdogTts() {
        if (!wfWatchdogVoiceTtsChunks.length) {
          wfWatchdogVoiceAwaitingTtsDone = false;
          wfResumeListeningAfterTurn();
          return;
        }
        var blob = new Blob(wfWatchdogVoiceTtsChunks.map(function (b) { return new Uint8Array(b); }), { type: 'audio/wav' });
        wfWatchdogVoiceTtsChunks = [];
        var url = URL.createObjectURL(blob);
        var audio = new Audio(url);
        wfWatchdogSpeaking = audio;
        if (voiceBtn) voiceBtn.classList.remove('wf-ai-chat-voice--listening');
        setAssistantStatusVisible(true, 'Speaking…');
        audio.play()
          .then(function () { /* speaking state */ })
          .catch(function () {
            wfWatchdogSpeaking = null;
            wfWatchdogVoiceAwaitingTtsDone = false;
            URL.revokeObjectURL(url);
            wfResumeListeningAfterTurn();
          });
        audio.onended = function () {
          URL.revokeObjectURL(url);
          wfWatchdogSpeaking = null;
          wfWatchdogVoiceAwaitingTtsDone = false;
          wfResumeListeningAfterTurn();
        };
      }

      async function applyWatchdogGeneratePayload(data, opts) {
        opts = opts || {};
        var voiceTurn = !!opts.voiceTurn;
        var ut = opts.userText != null ? String(opts.userText).trim() : '';
        if (ut) wfChatConversationHistory.push({ role: 'user', content: ut });

          var mode = data.mode || '';
          var hasWorkflow = !!data.workflow;
          var ok = data.success !== false;
          var assistantText = (data.assistant_text != null) ? String(data.assistant_text).trim() : '';
          var shortMessage = (data.message != null) ? String(data.message).trim() : '';
          var slotQuestions = Array.isArray(data.slot_questions)
            ? data.slot_questions.map(function (q) { return String(q || '').trim(); }).filter(Boolean)
            : [];
          var slotPrompt = '';
          if (data.slot_fill_pending === true && slotQuestions.length) {
            slotPrompt = 'I still need:\n- ' + slotQuestions.join('\n- ');
          } else if (data.slot_fill_pending === true && data.slot_fill_prompt) {
            slotPrompt = String(data.slot_fill_prompt).trim();
          }
          wfChatSlotFillPending = data.slot_fill_pending === true;

          // Briefly highlight canvas nodes whose type is mentioned in question text
          function highlightNodesForQuestion(questionText) {
            var q = (questionText || '').toLowerCase();
            var typeKeywords = {
              camera: 'camera', cameras: 'camera',
              notification: 'notification', email: 'notification', sms: 'notification',
              alarm: 'alarm_notification', alert: 'alarm_notification',
              report: 'report',
              iot: 'iot_action', device: 'iot_action',
              detection: 'class_detection_agent', 'object detection': 'class_detection_agent',
              zone: 'class_detection_zone_agent',
              count: 'object_count_agent',
              behaviour: 'person_behaviour_agent', fall: 'person_behaviour_agent',
              vlm: 'vlm_agent'
            };
            var matchedTypes = new Set();
            Object.keys(typeKeywords).forEach(function (kw) {
              if (q.includes(kw)) matchedTypes.add(typeKeywords[kw]);
            });
            if (!matchedTypes.size) return;
            document.querySelectorAll('.drawflow-node').forEach(function (el) {
              var nodeType = el.querySelector('[data-wf-type]');
              var t = nodeType ? nodeType.getAttribute('data-wf-type') : (el.classList[1] || '');
              if (matchedTypes.has(t)) {
                el.classList.add('wf-slot-highlight');
                setTimeout(function () { el.classList.remove('wf-slot-highlight'); }, 2800);
              }
            });
          }

          // Render interactive slot-question chips in the assistant panel
          function renderSlotChips(questions) {
            if (!messagesEl || !questions || !questions.length) return;
            var wrap = document.createElement('div');
            wrap.className = 'wf-slot-questions';
            var lbl = document.createElement('div');
            lbl.className = 'wf-slot-question-label';
            lbl.textContent = 'A few details needed:';
            wrap.appendChild(lbl);
            questions.forEach(function (q, i) {
              var chip = document.createElement('button');
              chip.type = 'button';
              chip.className = 'wf-slot-chip';
              chip.innerHTML = '<span class="wf-slot-chip__num">' + (i + 1) + '.</span><span class="wf-slot-chip__text">' + q.replace(/</g, '&lt;') + '</span>';
              chip.title = 'Click to answer this question';
              chip.addEventListener('click', function () {
                // Highlight relevant canvas nodes for this question
                highlightNodesForQuestion(q);
                // If already expanded, collapse
                var existing = wrap.querySelector('.wf-slot-answer-wrap');
                if (existing && existing.dataset.forQ === String(i)) {
                  existing.remove();
                  return;
                }
                if (existing) existing.remove();
                var ansWrap = document.createElement('div');
                ansWrap.className = 'wf-slot-answer-wrap';
                ansWrap.dataset.forQ = String(i);
                var inp = document.createElement('input');
                inp.type = 'text';
                inp.className = 'wf-slot-answer-input';
                inp.placeholder = 'Your answer…';
                inp.setAttribute('aria-label', 'Answer for: ' + q);
                var sendChipBtn = document.createElement('button');
                sendChipBtn.type = 'button';
                sendChipBtn.className = 'wf-slot-answer-send';
                sendChipBtn.textContent = 'Send';
                function submitAnswer() {
                  var val = inp.value.trim();
                  if (!val) { inp.focus(); return; }
                  // Build answer text that references the question
                  var answer = questions.length === 1
                    ? val
                    : ('Q' + (i + 1) + ': ' + q + '\nAnswer: ' + val);
                  if (ta) {
                    ta.value = answer;
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                  }
                  // auto-send
                  wfChatSlotFillPending = true;
                  if (sendBtn) sendBtn.click();
                }
                inp.addEventListener('keydown', function (e) {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitAnswer(); }
                });
                sendChipBtn.addEventListener('click', submitAnswer);
                ansWrap.appendChild(inp);
                ansWrap.appendChild(sendChipBtn);
                chip.insertAdjacentElement('afterend', ansWrap);
                setTimeout(function () { inp.focus(); }, 40);
              });
              wrap.appendChild(chip);
            });
            // For multiple questions, also show a "Send all" button after filling each inline input
            if (questions.length > 1) {
              var sendAllBtn = document.createElement('button');
              sendAllBtn.type = 'button';
              sendAllBtn.className = 'wf-slot-answer-send';
              sendAllBtn.style.marginTop = '6px';
              sendAllBtn.style.width = '100%';
              sendAllBtn.textContent = 'Send all answers';
              sendAllBtn.addEventListener('click', function () {
                var parts = [];
                wrap.querySelectorAll('.wf-slot-answer-input').forEach(function (inp, idx) {
                  var val = inp.value.trim();
                  if (val) parts.push('Q' + (idx + 1) + ': ' + questions[idx] + '\nAnswer: ' + val);
                });
                if (!parts.length) {
                  wrap.querySelector('.wf-slot-answer-input') && wrap.querySelector('.wf-slot-answer-input').focus();
                  return;
                }
                if (ta) {
                  ta.value = parts.join('\n\n');
                  ta.dispatchEvent(new Event('input', { bubbles: true }));
                }
                wfChatSlotFillPending = true;
                if (sendBtn) sendBtn.click();
              });
              wrap.appendChild(sendAllBtn);
              // Pre-expand all answer inputs when >1 questions
              questions.forEach(function (qText, qi) {
                var ansWrap = document.createElement('div');
                ansWrap.className = 'wf-slot-answer-wrap';
                ansWrap.dataset.forQ = String(qi);
                var inp = document.createElement('input');
                inp.type = 'text';
                inp.className = 'wf-slot-answer-input';
                inp.placeholder = 'Answer ' + (qi + 1) + '…';
                inp.setAttribute('aria-label', 'Answer for: ' + qText);
                inp.addEventListener('keydown', function (e) {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendAllBtn.click(); }
                });
                ansWrap.appendChild(inp);
                wrap.querySelector('.wf-slot-chip:nth-child(' + (qi + 2) + ')').insertAdjacentElement('afterend', ansWrap);
              });
            }

            messagesEl.appendChild(wrap);
            messagesEl.scrollTop = messagesEl.scrollHeight;
          }

          if (data.router_reason && isDevUi() && routerReasonEl) {
            routerReasonEl.hidden = false;
            routerReasonEl.textContent = 'Router: ' + data.router_reason;
          }

          if (clarBadge) clarBadge.hidden = !data.clarification_needed;

          if (!ok && !hasWorkflow) {
            setAssistantStatusVisible(false);
            setFetchLoading(false);
            var errMsg = (data.errors && data.errors.length) ? data.errors.join('\n') : (data.message || 'Workflow generation failed.');
            if (wfChatTurns.length) {
              wfChatTurns[wfChatTurns.length - 1].assistant = errMsg;
              renderTurnMessages(wfChatSelectedTurnIndex);
            }
            toast.error(errMsg);
            wfChatConversationHistory.pop();
            if (voiceTurn) setBusy(false);
            return;
          }

          if (data.errors && Array.isArray(data.errors) && data.errors.length) {
            console.warn('[Workflow chat] validation / notes:', data.errors);
          }

          if (mode) setModeUi(mode);

          setAssistantStatusVisible(true, 'Processing response…');

          function pushAssistantHistorySummary() {
            var summary = assistantText || shortMessage;
            if (mode === 'create' || mode === 'refine') {
              if (!summary) summary = 'Workflow updated.';
              else if (summary.length > 220) summary = summary.slice(0, 217) + '…';
            }
            if (!summary && (mode === 'chat' || mode === 'chat_refine')) summary = assistantText;
            if (slotPrompt) summary = summary ? (summary + '\n\n' + slotPrompt) : slotPrompt;
            wfChatConversationHistory.push({ role: 'assistant', content: summary || '(no text)', mode: mode || 'unknown' });
          }

          if (mode === 'chat' || mode === 'chat_refine') {
            if (hasWorkflow) {
              wfChatLastWorkflow = data.workflow;
              if (Object.prototype.hasOwnProperty.call(data, 'plan')) wfChatLastPlan = data.plan;
            }
            if (assistantText) appendToActiveTurn(assistantText);
            else if (data.clarification_needed && shortMessage) appendToActiveTurn(shortMessage);
            if (wfChatSlotFillPending && slotQuestions.length) {
              renderSlotChips(slotQuestions);
            } else if (slotPrompt) {
              appendToActiveTurn(slotPrompt);
            }
            setAssistantStatusVisible(false);
            if (mode === 'chat_refine' && hasWorkflow) {
              /* Same graph snapshot: keep canvas as-is; optional future: diff and patch */
            }
            pushAssistantHistorySummary();
          } else if (mode === 'create' || mode === 'refine') {
            var wf = data.workflow;
            var didImport = false;
            if (wf) {
              var graph = extractWorkflowGraph(wf);
              if (graph && graph.nodes && graph.nodes.length) {
                setAssistantStatusVisible(true, 'Building workflow on canvas…');
                setBuildingPhase(true);
                try {
                  await animateWorkflowImportFromGraph(graph);
                  didImport = true;
                  wfChatLastWorkflow = data.workflow;
                  if (Object.prototype.hasOwnProperty.call(data, 'plan')) wfChatLastPlan = data.plan;
                } catch (buildErr) {
                  console.error('[Workflow chat] Canvas build:', buildErr);
                  toast.error('Workflow was received but could not be placed on the canvas. See console.');
                }
                setBuildingPhase(false);
              } else {
                console.warn('[Workflow chat] Unknown workflow payload:', wf);
              }
            }
            var line = assistantText || shortMessage || (didImport ? 'Workflow placed on canvas.' : '');
            if (line) appendToActiveTurn(line);
            if (wfChatSlotFillPending && slotQuestions.length) {
              renderSlotChips(slotQuestions);
            } else if (slotPrompt) {
              appendToActiveTurn(slotPrompt);
            }
            setAssistantStatusVisible(false);
            pushAssistantHistorySummary();
          } else {
            /* Legacy API without mode */
            if (hasWorkflow) {
              var wfLegacy = data.workflow;
              var g = extractWorkflowGraph(wfLegacy);
              if (g && g.nodes && g.nodes.length) {
                setAssistantStatusVisible(true, 'Building workflow on canvas…');
                setBuildingPhase(true);
                try {
                  await animateWorkflowImportFromGraph(g);
                  wfChatLastWorkflow = data.workflow;
                  if (Object.prototype.hasOwnProperty.call(data, 'plan')) wfChatLastPlan = data.plan;
                } catch (buildErr) {
                  console.error('[Workflow chat] Canvas build:', buildErr);
                  toast.error('Workflow was received but could not be placed on the canvas. See console.');
                }
                setBuildingPhase(false);
                setModeUi('create');
                var lineLeg = assistantText || shortMessage || 'Workflow placed on canvas.';
                if (lineLeg) appendToActiveTurn(lineLeg);
                if (wfChatSlotFillPending && slotQuestions.length) { renderSlotChips(slotQuestions); } else if (slotPrompt) { appendToActiveTurn(slotPrompt); }
                wfChatConversationHistory.push({ role: 'assistant', content: (assistantText || shortMessage || 'Workflow placed on canvas.') + (slotPrompt ? ('\n\n' + slotPrompt) : ''), mode: 'create' });
              } else {
                console.warn('[Workflow chat] Unknown workflow payload:', wfLegacy);
                if (assistantText || shortMessage) {
                  appendToActiveTurn(assistantText || shortMessage);
                  if (wfChatSlotFillPending && slotQuestions.length) { renderSlotChips(slotQuestions); } else if (slotPrompt) { appendToActiveTurn(slotPrompt); }
                  wfChatConversationHistory.push({ role: 'assistant', content: (assistantText || shortMessage) + (slotPrompt ? ('\n\n' + slotPrompt) : ''), mode: 'legacy' });
                }
              }
            } else if (assistantText || shortMessage) {
              appendToActiveTurn(assistantText || shortMessage);
              if (wfChatSlotFillPending && slotQuestions.length) { renderSlotChips(slotQuestions); } else if (slotPrompt) { appendToActiveTurn(slotPrompt); }
              wfChatConversationHistory.push({ role: 'assistant', content: (assistantText || shortMessage) + (slotPrompt ? ('\n\n' + slotPrompt) : ''), mode: 'legacy' });
            } else if (ok) {
              setAssistantStatusVisible(false);
              setFetchLoading(false);
              wfChatConversationHistory.pop();
              var nwMsg = 'No workflow in response (check server / mode).';
              if (wfChatTurns.length) {
                wfChatTurns[wfChatTurns.length - 1].assistant = nwMsg;
                renderTurnMessages(wfChatSelectedTurnIndex);
              }
              toast.warning(nwMsg);
              if (voiceTurn) setBusy(false);
              return;
            }
            setAssistantStatusVisible(false);
          }

          if (data.errors && Array.isArray(data.errors) && data.errors.length) {
            appendToActiveTurn('Note: ' + data.errors.join('\n'));
          }

          setFetchLoading(false);
          if (opts.clearInput !== false && ta) {
            ta.value = '';
            resizeTa();
            syncChatPrimaryAction();
          }
      }

      async function startWatchdogVoiceSession() {
        if (wfWatchdogVoiceWs || wfWatchdogVoiceMic) return;
        if (!api || !api.token) throw new Error('Login required for watchdog voice.');
        stopSpeechListening();

        if (window.ChatbotVoice && typeof window.ChatbotVoice.stopVoiceAssistantCompletely === 'function') {
          try { await window.ChatbotVoice.stopVoiceAssistantCompletely(); } catch (e) { /* ignore */ }
        }

        wfWatchdogVoiceLastUserText = '';
        wfWatchdogVoiceLlmAcc = '';
        wfWatchdogVoiceTtsChunks = [];

        try {
        wfWatchdogVoiceMic = await navigator.mediaDevices.getUserMedia(WF_WATCHDOG_MIC);
        var AC = window.AudioContext || window.webkitAudioContext;
        wfWatchdogVoiceCtx = new AC();
        wfWatchdogVoiceNativeRate = wfWatchdogVoiceCtx.sampleRate;
        var wb = new Blob([WF_WATCHDOG_PCM_WORKLET], { type: 'application/javascript' });
        var wu = URL.createObjectURL(wb);
        await wfWatchdogVoiceCtx.audioWorklet.addModule(wu);
        URL.revokeObjectURL(wu);
        wfWatchdogVoiceSource = wfWatchdogVoiceCtx.createMediaStreamSource(wfWatchdogVoiceMic);
        wfWatchdogVoiceWorklet = new AudioWorkletNode(wfWatchdogVoiceCtx, 'pcm-capture');
        wfWatchdogVoiceWorklet.port.onmessage = function (ev) {
          if (!wfWatchdogVoiceWs || wfWatchdogVoiceWs.readyState !== WebSocket.OPEN) return;
          var f32 = new Float32Array(ev.data);
          var pcm = wfDownsample(f32, wfWatchdogVoiceNativeRate, 16000);
          wfWatchdogVoiceWs.send(wfFloat32ToPcm16(pcm));
        };
        wfWatchdogVoiceSource.connect(wfWatchdogVoiceWorklet);

        wfWatchdogVoiceWs = new WebSocket(buildWatchdogVoiceWsUrl());
        wfWatchdogVoiceWs.binaryType = 'arraybuffer';

        wfWatchdogVoiceWs.onopen = function () {
          var verbose = !!((typeof window !== 'undefined' && window.WORKFLOW_CHAT_VERBOSE) || false);
          var hist = wfChatConversationHistory.map(function (h) {
            return { role: String(h.role || ''), content: String(h.content != null ? h.content : '') };
          }).filter(function (h) { return h.role && h.content; }).slice(-20);
          wfWatchdogVoiceWs.send(JSON.stringify({
            type: 'start',
            session_id: wfChatSessionId || null,
            verbose: verbose,
            enable_intent_router: (typeof window.WORKFLOW_CHAT_ENABLE_INTENT_ROUTER === 'boolean') ? window.WORKFLOW_CHAT_ENABLE_INTENT_ROUTER : true,
            autofill_slots: true,
            slot_fill_followup: !!wfChatSlotFillPending,
            conversation_history: hist
          }));
        };

        wfWatchdogVoiceWs.onmessage = function (ev) {
          if (ev.data instanceof ArrayBuffer) {
            wfWatchdogVoiceTtsChunks.push(ev.data);
            return;
          }
          var msg;
          try { msg = JSON.parse(ev.data); } catch (e) { return; }
          var typ = msg.type;
          if (typ === 'ready') {
            wfWatchdogVoiceActive = true;
            if (voiceBtn) {
              voiceBtn.classList.add('wf-ai-chat-voice--listening');
              voiceBtn.setAttribute('aria-label', 'Listening — tap to stop watchdog voice');
            }
            setAssistantStatusVisible(false);
            return;
          }
          if (typ === 'speech_start') {
            wfWatchdogVoiceLlmAcc = '';
            wfWatchdogVoiceTtsChunks = [];
            if (voiceBtn) voiceBtn.classList.add('wf-ai-chat-voice--listening');
            openAssistantPanelForUserMessage('Listening…');
            if (wfChatTurns.length) wfChatTurns[wfChatTurns.length - 1].assistant = '';
            renderTurnMessages(wfChatSelectedTurnIndex);
            return;
          }
          if (typ === 'partial_stt' && msg.text) {
            if (wfChatTurns.length) {
              wfChatTurns[wfChatTurns.length - 1].user = String(msg.text);
              if (userSnippet) userSnippet.textContent = truncatePromptLabel(msg.text);
              renderTurnMessages(wfChatSelectedTurnIndex);
            }
            return;
          }
          if (typ === 'speech_end') {
            if (voiceBtn) voiceBtn.classList.remove('wf-ai-chat-voice--listening');
            setAssistantStatusVisible(true, 'Processing…');
            setBusy(true);
            return;
          }
          if (typ === 'final_stt') {
            wfWatchdogVoiceLastUserText = (msg.text != null) ? String(msg.text).trim() : '';
            if (wfChatTurns.length) {
              wfChatTurns[wfChatTurns.length - 1].user = wfWatchdogVoiceLastUserText || '—';
              if (userSnippet) userSnippet.textContent = truncatePromptLabel(wfWatchdogVoiceLastUserText || 'Your message');
              rebuildUserPromptMenu();
              renderTurnMessages(wfChatSelectedTurnIndex);
            }
            return;
          }
          if (typ === 'watchdog_result' && msg.result) {
            writeAgentLog(msg.result);
            applyWatchdogGeneratePayload(msg.result, { userText: wfWatchdogVoiceLastUserText, clearInput: false, voiceTurn: true }).catch(function (e) { console.error(e); });
            return;
          }
          if (typ === 'llm_token' && msg.delta) {
            wfWatchdogVoiceLlmAcc += String(msg.delta);
            if (wfChatTurns.length) wfChatTurns[wfChatTurns.length - 1].assistant = wfWatchdogVoiceLlmAcc;
            renderTurnMessages(wfChatSelectedTurnIndex);
            return;
          }
          if (typ === 'llm_done' && msg.text != null) {
            wfWatchdogVoiceLlmAcc = String(msg.text);
            if (wfChatTurns.length) wfChatTurns[wfChatTurns.length - 1].assistant = wfWatchdogVoiceLlmAcc;
            renderTurnMessages(wfChatSelectedTurnIndex);
            return;
          }
          if (typ === 'tts_start') {
            wfWatchdogVoiceAwaitingTtsDone = true;
            wfWatchdogVoiceTtsChunks = [];
            return;
          }
          if (typ === 'tts_done') {
            playWatchdogTts();
            return;
          }
          if (typ === 'interrupted') {
            wfWatchdogVoiceAwaitingTtsDone = false;
            stopWatchdogTtsPlayback();
            setBusy(false);
            wfResumeListeningAfterTurn();
            return;
          }
          if (typ === 'done') {
            if (msg.session_id) wfChatSessionId = msg.session_id;
            setBusy(false);
            setFetchLoading(false);
            if (!wfWatchdogSpeaking && !wfWatchdogVoiceAwaitingTtsDone) {
              setAssistantStatusVisible(false);
              wfResumeListeningAfterTurn();
            }
            return;
          }
          if (typ === 'error') {
            wfWatchdogVoiceAwaitingTtsDone = false;
            stopWatchdogTtsPlayback();
            setBusy(false);
            setFetchLoading(false);
            var em = msg.message || 'Voice error';
            if (wfChatTurns.length) {
              wfChatTurns[wfChatTurns.length - 1].assistant = 'Error: ' + em;
              renderTurnMessages(wfChatSelectedTurnIndex);
            }
            toast.error(em);
            setAssistantStatusVisible(false);
            wfResumeListeningAfterTurn();
          }
        };

        wfWatchdogVoiceWs.onerror = function () {
          toast.error('Watchdog voice connection error.');
          endWatchdogVoiceSession();
        };
        wfWatchdogVoiceWs.onclose = function () {
          wfWatchdogVoiceWs = null;
          wfWatchdogVoiceActive = false;
          if (voiceBtn) voiceBtn.classList.remove('wf-ai-chat-voice--listening');
          stopWatchdogTtsPlayback();
          teardownWatchdogVoiceMedia();
          setBusy(false);
        };
        } catch (voiceStartErr) {
          console.error('[WF watchdog voice] start failed:', voiceStartErr);
          endWatchdogVoiceSession();
          throw voiceStartErr;
        }
      }

      async function runGenerate() {
        setChatDockOpen(true);
        if (!ta || busy) return;
        const text = (ta.value || '').trim();
        if (!text) {
          toast.warning('Enter a description of the Watch Dog you want to create.');
          return;
        }
        setBusy(true);
        openAssistantPanelForUserMessage(text);

        // Cycle through stage labels while waiting for the backend
        const _genStages = wfChatSlotFillPending
          ? ['Collecting answers…', 'Filling node fields…', 'Validating workflow…']
          : ['Understanding request…', 'Retrieving patterns…', 'Planning nodes…', 'Building workflow…', 'Validating…'];
        let _stageIdx = 0;
        setAssistantStatusVisible(true, _genStages[0]);
        const _stageTimer = setInterval(function () {
          _stageIdx = (_stageIdx + 1) % _genStages.length;
          setAssistantStatusVisible(true, _genStages[_stageIdx]);
        }, 1600);

        setFetchLoading(true, '');
        const base = String(WORKFLOW_CHAT_API_BASE || '').replace(/\/$/, '');
        try {
          var verbose = !!((typeof window !== 'undefined' && window.WORKFLOW_CHAT_VERBOSE) || false);
          var sendHistory = (typeof window === 'undefined' || window.WORKFLOW_CHAT_SEND_HISTORY !== false);
          var body = {
            message: text,
            session_id: wfChatSessionId,
            verbose: verbose,
            autofill_slots: true,
            enable_intent_router: (typeof window !== 'undefined' && typeof window.WORKFLOW_CHAT_ENABLE_INTENT_ROUTER === 'boolean') ? window.WORKFLOW_CHAT_ENABLE_INTENT_ROUTER : true
          };
          if (wfChatLastWorkflow) {
            body.previous_workflow = wfChatLastWorkflow;
            if (wfChatLastPlan != null) body.previous_plan = wfChatLastPlan;
          }
          if (wfChatSlotFillPending) {
            body.slot_fill_followup = true;
          }
          if (sendHistory && !wfChatSessionId && wfChatConversationHistory.length) {
            body.conversation_history = wfChatConversationHistory.slice(-4);
          }
          var authToken = (typeof getAuthToken === 'function') ? getAuthToken() : (localStorage.getItem('visionai_token') || '');
          var fetchHeaders = { 'Content-Type': 'application/json' };
          if (authToken) fetchHeaders['Authorization'] = 'Bearer ' + authToken;

          const res = await fetch(base + '/api/v1/watchdog/generate', {
            method: 'POST',
            headers: fetchHeaders,
            body: JSON.stringify(body)
          });
          clearInterval(_stageTimer);
          const data = await res.json().catch(function () { return {}; });
          writeAgentLog(data);

          if (!res.ok) {
            setAssistantStatusVisible(false);
            setFetchLoading(false);
            const detail = data.detail || data.message || res.statusText || 'Request failed';
            var detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail);
            if (wfChatTurns.length) {
              wfChatTurns[wfChatTurns.length - 1].assistant = 'Error: ' + detailStr;
              renderTurnMessages(wfChatSelectedTurnIndex);
            }
            toast.error(detailStr);
            return;
          }

          await applyWatchdogGeneratePayload(data, { userText: text, clearInput: true, voiceTurn: false });
        } catch (err) {
          clearInterval(_stageTimer);
          console.error('[Workflow chat]', err);
          setFetchLoading(false);
          setBuildingPhase(false);
          setAssistantStatusVisible(false);
          chatInner && chatInner.classList.remove('wf-ai-chat-inner--building');
          var netErr = 'Failed to reach workflow chat API at ' + base + '. Please check that the backend API is running and reachable.';
          if (wfChatTurns.length) {
            wfChatTurns[wfChatTurns.length - 1].assistant = netErr;
            renderTurnMessages(wfChatSelectedTurnIndex);
          }
          toast.error(netErr);
        } finally {
          clearInterval(_stageTimer);
          setBusy(false);
        }
      }

      if (sendBtn) sendBtn.addEventListener('click', function () { runGenerate(); });
      if (voiceBtn) {
        voiceBtn.addEventListener('click', function () {
          if (wfWatchdogVoiceWs || wfWatchdogVoiceMic) {
            endWatchdogVoiceSession();
            return;
          }
          if (busy) return;
          if (speechListening) {
            stopSpeechListening();
            return;
          }
          if (api && api.token) {
            startWatchdogVoiceSession().catch(function (err) {
              console.warn('[WF watchdog voice]', err);
              startSpeechListening();
            });
            return;
          }
          startSpeechListening();
        });
      }
      if (ta) {
        ta.addEventListener('keydown', function (ev) {
          if (ev.key !== 'Enter') return;
          if (ev.shiftKey) return;
          ev.preventDefault();
          runGenerate();
        });
      }

      // Drawflow attaches a mousedown handler on #drawflow that calls preventDefault(),
      // which prevents the textarea from receiving focus when the chat dock visually
      // overlaps the canvas. Stop propagation here so Drawflow never sees the click.
      if (chatInner) {
        chatInner.addEventListener('mousedown', function (ev) {
          ev.stopPropagation();
        });
      }

      if (typeof window !== 'undefined') {
        window.__workflowChatResetThread = resetWorkflowChatThread;
        registerWatchdogVoiceReleaseHook();
      }
    }

    if (isEditMode && editWorkflowId) {
      loadWorkflowForEdit(editWorkflowId);
    } else {
      // Add default Start Node for new workflow
      addDefaultStartNode();
    }

    // Register page-level cleanup so the router can tear down this editor
    // instance before replacing the page content. Without this, document-level
    // listeners registered above survive SPA navigation and double-fire on the
    // next visit, breaking drag-drop and the chat toggle.
    window.__visionaiPageCleanup = function () {
      document.removeEventListener('click', _iotClickHandler);
      document.removeEventListener('change', _iotChangeHandler, true);
      document.removeEventListener('change', _showIfChangeHandler);
      // Remove the body-level tooltip div created by this editor instance
      const tt = document.getElementById('wf-node-tooltip');
      if (tt) tt.remove();
      // Strip body classes that affect scroll/layout on other pages
      document.body.classList.remove('wf-ai-chat-open');
      // Allow a fresh boot on the next navigation to this page
      wfEditorInitInFlight = false;
      try { editor.clear(); } catch (_) {}
    };

    initWorkflowAiChatDock();
    wfEditorInitInFlight = false;
  }

export function boot() {
  wfEditorInitInFlight = false;

  // Lock the SPA viewport so it doesn't scroll — Drawflow needs a fixed canvas
  // with a stable bounding rect.  overflow:auto on the ancestor shifts clientY
  // which makes nodes drop at the wrong position.
  const viewport = document.querySelector('.viewport-scrolls');
  if (viewport) {
    viewport.style.setProperty('overflow',        'hidden',  'important');
    viewport.style.setProperty('display',         'flex',    'important');
    viewport.style.setProperty('flex-direction',  'column',  'important');
    // Kill the default content padding the shell injects — it adds vertical
    // offset that Drawflow's getBoundingClientRect sees as part of the canvas
    // but the drop coord calculation doesn't subtract.
    viewport.querySelectorAll(':scope > *').forEach(child => {
      child.style.setProperty('padding', '0', 'important');
      child.style.removeProperty('padding-bottom');
    });
  }

  // Cleanup: restore viewport scrolling when navigating away
  window.__visionaiPageCleanup = function () {
    if (viewport) {
      viewport.style.removeProperty('overflow');
      viewport.style.removeProperty('display');
      viewport.style.removeProperty('flex-direction');
      viewport.querySelectorAll(':scope > *').forEach(child => child.style.removeProperty('padding'));
    }
  };

  initWorkflowEditor().catch(function (err) {
    wfEditorInitInFlight = false;
    const container = document.getElementById('drawflow');
    if (container) delete container.dataset.wfEditorInitialized;
    console.error(err);
  });
}

// Boot is called by the SPA router on every navigation (mod.boot()).
// Do NOT add an unconditional self-boot here — the router already handles it.

