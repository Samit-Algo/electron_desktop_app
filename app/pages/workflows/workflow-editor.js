import { navigate } from '../../core/router.js';
import { api } from '../../core/api.js';
(function () {
  'use strict';

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

  const API_BASE = (typeof window !== 'undefined' && window.VISION_API_BASE) ? window.VISION_API_BASE : 'https://api.samitweb.xyz';
  const WORKFLOW_CHAT_API_BASE = API_BASE;

  async function initWorkflowEditor() {
    try {
      await ensureDrawflow();
    } catch (e) {
      console.error('Drawflow failed to load', e);
      alert('Watch Dog editor engine failed to load. Please check your network connection.');
      return;
    }

    const container = document.getElementById('drawflow');
    const _wsu = window.history.state && window.history.state.url ? window.history.state.url : window.location.href;
    const urlParams = new URLSearchParams(new URL(_wsu, window.location.origin).search);
    const editWorkflowId = urlParams.get('workflow_id');
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
    const importBtn = document.getElementById('btn-import');
    const importFile = document.getElementById('file-import');

    const NODE_COMPATIBILITY = {
      start: ['camera'],
      camera: ['class_detection_agent', 'class_detection_zone_agent', 'object_count_agent', 'person_behaviour_agent', 'vlm_agent'],
      class_detection_agent: ['notification', 'report', 'vlm_agent'],
      class_detection_zone_agent: ['notification', 'report', 'vlm_agent'],
      object_count_agent: ['notification', 'report', 'vlm_agent'],
      person_behaviour_agent: ['notification', 'report', 'vlm_agent'],
      vlm_agent: ['notification', 'report', 'end'],
      notification: ['end', 'report'],
      report: ['end', 'notification'],
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
          { key: 'label', type: 'text', label: 'Node label', default: 'Notification' },
          { key: 'channel', type: 'select', label: 'Primary channel', options: ['Email', 'SMS', 'Webhook'], default: 'Email' },
          { key: 'recipients', type: 'text', label: 'Recipient(s)', placeholder: 'Email addresses or phone numbers, comma-separated' },
          { key: 'subject', type: 'text', label: 'Subject / title', placeholder: 'Short, descriptive subject line' },
          { key: 'body', type: 'textarea', label: 'Message body', placeholder: 'Rich free-text body. You can use placeholders like {{camera_name}} or {{class_name}}.' },
          { key: 'importance', type: 'select', label: 'Importance', options: ['Low', 'Normal', 'High'], default: 'Normal' }
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
      `;
    }

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
        const node = editor && editor.getNodeFromId && editor.getNodeFromId(nodeId);
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
        case 'textarea':
          inputHtml = `<textarea class="lf-node-input w-100 form-control form-control-sm" data-field="${field.key}" placeholder="${placeholder}">${safe(value)}</textarea>`;
          break;
        default:
          inputHtml = `<input type="text" class="lf-node-input w-100 form-control form-control-sm" data-field="${field.key}" placeholder="${placeholder}" value="${safe(value)}" />`;
      }

      // showIf: conditional visibility support
      const hasShowIf = field.showIf && field.showIf.field && field.showIf.value;
      const showIfAttrs = hasShowIf
        ? `data-show-if-field="${field.showIf.field}" data-show-if-value="${field.showIf.value}"`
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
    document.addEventListener('change', function(e) {
      const input = e.target;
      if (!input.matches('.lf-node-input')) return;

      const changedFieldKey = input.dataset.field;
      const changedValue    = input.value;

      // Walk up to the drawflow node container
      const nodeEl = input.closest('.drawflow-node');
      if (!nodeEl) return;

      // Show/hide any conditional field wrappers that depend on this field
      nodeEl.querySelectorAll('[data-show-if-field]').forEach(wrapper => {
        if (wrapper.dataset.showIfField === changedFieldKey) {
          wrapper.style.display = (changedValue === wrapper.dataset.showIfValue) ? '' : 'none';
        }
      });
    });

    // ── applyShowIfRules ─────────────────────────────────────────────────────
    // Call this after node HTML is inserted into the DOM (new node drop or
    // workflow load) so that saved values are applied and fields are shown
    // or hidden correctly without requiring user interaction.
    function applyShowIfRules(nodeEl) {
      if (!nodeEl) return;
      nodeEl.querySelectorAll('.lf-node-input').forEach(input => {
        const fieldKey = input.dataset.field;
        const value    = input.value;
        if (!fieldKey) return;
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

    document.querySelectorAll('.wf-section-item[draggable="true"]').forEach(el => {
      el.addEventListener('dragstart', ev => {
        dragNodeKey = el.getAttribute('data-node-key');
        ev.dataTransfer.setData('node', dragNodeKey);
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

    container.addEventListener('dragover', ev => ev.preventDefault());

    container.addEventListener('drop', ev => {
      ev.preventDefault();
      const key = ev.dataTransfer.getData('node') || dragNodeKey;
      if (!key || !NODE_DEFINITIONS[key]) return;
      // Prevent adding multiple Start Nodes
      if (key === 'start' && hasStartNode()) {
        alert('A Start Node already exists. Only one Start Node is allowed per workflow.');
        return;
      }
      const def = NODE_DEFINITIONS[key];
      const position = container.getBoundingClientRect();
      const posX = (ev.clientX - position.left) / editor.zoom;
      const posY = (ev.clientY - position.top) / editor.zoom;
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
              const current = (node.data.active_days || '').split(',').map(s => s.trim()).filter(Boolean);
              const set = new Set(current);
              if (target.checked) set.add(day); else set.delete(day);
              value = Array.from(set).join(',');
              node.data.active_days = value;
              if (editor.drawflow.drawflow.Home.data[nodeId]) editor.drawflow.drawflow.Home.data[nodeId].data.active_days = value;
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

    // Regenerate node HTML after import to reflect saved data values
    function refreshAllNodeHtml() {
      const data = editor?.drawflow?.drawflow?.Home?.data || {};
      Object.keys(data).forEach(nodeId => {
        const node = data[nodeId];
        if (!node) return;
        const nodeDef = NODE_DEFINITIONS[node.name];
        if (!nodeDef) return;
        const nodeElement = document.getElementById(`node-${nodeId}`);
        if (!nodeElement) return;
        // Regenerate HTML with saved data
        const updatedHtml = createNodeContentHtml(nodeDef, node.data || {}, nodeId);
        const contentNode = nodeElement.querySelector('.drawflow_content_node');
        if (contentNode) {
          contentNode.innerHTML = updatedHtml;
          // Update stored HTML in drawflow data
          node.html = updatedHtml;
        }
        // Reset the input handlers flag so it gets re-initialized
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
        editor.removeSingleConnection(connection.output_id, connection.input_id, connection.output_class, connection.input_class);
        const sourceNode = editor.getNodeFromId(connection.output_id);
        const targetNode = editor.getNodeFromId(connection.input_id);
        const sourceDef = NODE_DEFINITIONS[sourceNode.name];
        const targetDef = NODE_DEFINITIONS[targetNode.name];
        var msg = sourceNode.name === 'notification' && targetNode.name === 'end'
          ? 'When the Start node schedule is set to "Always", the Notification node does not connect to End. Change the schedule to Daily, Weekly, or Once to add an End node.'
          : `Invalid connection: "${sourceDef.label}" cannot connect to "${targetDef.label}". Please check the node compatibility rules.`;
        alert(msg);
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
      var token = getAuthToken();
      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      fetch(API_BASE + '/api/v1/cameras/' + encodeURIComponent(cameraId) + '/snapshot', { method: 'GET', headers })
        .then(r => r.json())
        .then(function (data) {
          if (loadingEl) loadingEl.classList.add('d-none');
          var b64 = data && data.frame_base64;
          if (!b64) throw new Error('No frame');
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
      if (!cameraId) { alert('Connect this Agent node to a Camera node first, and set the camera in that node.'); return; }
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
    zoomResetBtn.addEventListener('click', () => editor.zoom_reset());

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

    async function saveWorkflowToBackend() {
      if (hasUnusedEndNode()) {
        alert('Cannot save: the Start node schedule is set to "Always" but an End node is still connected. Remove the End node (or change the schedule to Daily, Weekly, or Once) and try again.');
        return null;
      }
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
      
      // When editing: deactivate old workflow first, then create new one
      if (isEditMode && editWorkflowId) {
        // Step 1: Deactivate the existing workflow
        const deactivateRes = await fetch(`${API_BASE}/api/v1/workflows/${editWorkflowId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({ is_active: false })
        });
        if (deactivateRes.status === 401) { alert('Session expired. Please login again.'); return null; }
        if (!deactivateRes.ok) {
          const err = await deactivateRes.json();
          alert('Failed to deactivate old Watch Dog: ' + (err.detail || 'Unknown error'));
          return null;
        }
        console.log('[Save] Deactivated old Watch Dog:', editWorkflowId);
      }
      
      // Step 2: Create new Watch Dog (for both new and edit modes)
      // Add creator name for new Watch Dog
      if (workflowOwner) {
        payload.created_by_name = workflowOwner;
      }
      
      const res = await fetch(API_BASE + '/api/v1/workflows/', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (res.status === 401) { alert('Session expired. Please login again.'); return null; }
      const result = await res.json();
      if (!res.ok) { alert('Failed to save Watch Dog: ' + (result.detail || 'Unknown error')); console.error('[Save] Backend error:', result); return null; }
      console.log('[Save] Watch Dog saved:', result);
      return result;
    }

    saveBtn.addEventListener('click', async () => {
      try {
        const result = await saveWorkflowToBackend();
        if (!result) return;
        const message = isEditMode 
          ? `Watch Dog updated successfully! New version created with ID: ${result.id}` 
          : `Watch Dog created successfully! Watch Dog ID: ${result.id}`;
        alert(message);
        // Update URL to the new workflow ID (for edit mode, we now have a new ID)
        if (result.id) {
          window.history.replaceState({}, '', `?workflow_id=${result.id}&name=${encodeURIComponent(result.name || '')}`);
        }
        setTimeout(() => { navigateTo('workflow-list.html'); }, 1500);
      } catch (err) {
        console.error('[Save] Unexpected error:', err);
        alert('Error while saving Watch Dog.');
      }
    });

    const runWorkflowBtn = document.getElementById('btn-run-workflow');
    if (runWorkflowBtn) {
      runWorkflowBtn.addEventListener('click', async () => {
        try {
          runWorkflowBtn.disabled = true;
          runWorkflowBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Saving…</span>';
          const saveResult = await saveWorkflowToBackend();
          if (!saveResult) {
            runWorkflowBtn.disabled = false;
            runWorkflowBtn.innerHTML = '<i class="fa-solid fa-circle-play"></i><span>Run Workflow</span>';
            return;
          }
          const workflowIdToRun = saveResult.id || editWorkflowId;
          if (!workflowIdToRun) {
            alert('Cannot run workflow: no workflow ID found after save.');
            runWorkflowBtn.disabled = false;
            runWorkflowBtn.innerHTML = '<i class="fa-solid fa-circle-play"></i><span>Run Workflow</span>';
            return;
          }
          runWorkflowBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i><span>Starting agents…</span>';
          const token = getAuthToken();
          const headers = { 'Content-Type': 'application/json' };
          if (token) headers['Authorization'] = `Bearer ${token}`;
          const execRes = await fetch(`${API_BASE}/api/v1/workflows/${workflowIdToRun}/execute`, { method: 'POST', headers });
          if (execRes.status === 401) {
            alert('Session expired. Please login again.');
            runWorkflowBtn.disabled = false;
            runWorkflowBtn.innerHTML = '<i class="fa-solid fa-circle-play"></i><span>Run Watch Dog</span>';
            return;
          }
          const execResult = await execRes.json();
          if (execRes.ok) {
            const camList = (execResult.cameras || []).join(', ') || 'none';
            alert(`Watch Dog started successfully!\n\n• Agents created: ${execResult.agents_started || 0}\n• Cameras: ${camList}\n• Status: ${execResult.initial_status || 'Monitoring'}\n\nDetection workers will start within ~5 seconds.`);
            console.log('[RunWorkflow] Execute result:', execResult);
            setTimeout(() => { navigateTo('workflow-list.html'); }, 1500);
          } else {
            alert('Watch Dog saved but failed to start agents:\n' + (execResult.detail || execResult.message || 'Unknown error'));
            console.error('[RunWorkflow] Execute error:', execResult);
          }
        } catch (err) {
          console.error('[RunWorkflow] Unexpected error:', err);
          alert('Unexpected error while running Watch Dog. Check the console.');
        } finally {
          runWorkflowBtn.disabled = false;
          runWorkflowBtn.innerHTML = '<i class="fa-solid fa-circle-play"></i><span>Run Watch Dog</span>';
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
        }, 50);
      } catch (err) {
        console.error(err);
        alert('Invalid workflow JSON.');
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
        if (response.status === 401) { alert('Session expired. Please login again.'); return false; }
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
              updateNotificationNodesForSchedule();
            }, 50);
          }
          document.title = `Edit Watch Dog: ${window.currentWorkflowName}`;
          return true;
        } else {
          console.error('Failed to load Watch Dog:', response.statusText);
          alert('Failed to load Watch Dog for editing');
          return false;
        }
      } catch (error) {
        console.error('Error loading Watch Dog:', error);
        alert('Error loading Watch Dog for editing');
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

    function computeGenLayoutPositions(count, containerEl) {
      var dims = getWorkflowNodeLayoutDims(containerEl);
      var NODE_W = dims.NODE_W;
      var NODE_H = dims.NODE_H;
      var GAP_X = dims.GAP_X;
      var GAP_Y = dims.GAP_Y;
      var PAD = dims.PAD;
      const w = Math.max(320, (containerEl && containerEl.clientWidth) || 900);
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

      const assistantPanel = document.getElementById('wf-ai-assistant-panel');
      const userSnippet = document.getElementById('wf-ai-user-msg-snippet');
      const userPromptHistoryEl = document.getElementById('wf-ai-user-msg-history');
      const assistantStatus = document.getElementById('wf-ai-assistant-status');
      const assistantStatusText = document.getElementById('wf-ai-assistant-status-text');
      const messagesEl = document.getElementById('wf-ai-assistant-messages');
      const clarBadge = document.getElementById('wf-ai-clarification-badge');
      const agentLogBody = document.getElementById('wf-ai-agent-log-body');
      const routerReasonEl = document.getElementById('wf-ai-router-reason');

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
        var turn = wfChatTurns[idx];
        messagesEl.innerHTML = '';
        var t = String(turn.assistant || '').trim();
        if (!t) {
          var empty = document.createElement('div');
          empty.className = 'wf-ai-msg-block wf-ai-msg-block--placeholder';
          empty.style.opacity = '0.75';
          empty.style.fontStyle = 'italic';
          empty.textContent = (idx === wfChatTurns.length - 1 && busy)
            ? 'Waiting for response…'
            : 'No response for this message yet.';
          messagesEl.appendChild(empty);
          messagesEl.scrollTop = messagesEl.scrollHeight;
          return;
        }
        t.split(/\n{2,}/).forEach(function (para) {
          var block = document.createElement('div');
          block.className = 'wf-ai-msg-block';
          var p = document.createElement('p');
          para.split(/\n/).forEach(function (line, idxLn) {
            if (idxLn) p.appendChild(document.createElement('br'));
            p.appendChild(document.createTextNode(line));
          });
          block.appendChild(p);
          messagesEl.appendChild(block);
        });
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
        if (!assistantStatus) return;
        assistantStatus.hidden = !on;
        if (assistantStatusText && message) assistantStatusText.textContent = message;
      }

      function openAssistantPanelForUserMessage(userText) {
        if (assistantPanel) assistantPanel.hidden = false;
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
        if (assistantPanel) {
          assistantPanel.hidden = true;
        }
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
          alert('Voice assistant is not available in this browser. Try Chrome or Edge, or type your message.');
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
          alert(msg);
        };
        speechRec.onend = function () {
          if (speechListening) stopSpeechListening();
        };
        try {
          speechRec.start();
        } catch (e) {
          stopSpeechListening();
          alert('Could not start voice input.');
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
          loadingEl.hidden = true;
          loadingEl.setAttribute('aria-hidden', 'true');
        }
        chatInner && chatInner.classList.toggle('wf-ai-chat-inner--fetching', !!on);
        if (on && loadingTextEl && message) loadingTextEl.textContent = message;
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
            alert(errMsg);
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
            if (slotPrompt) appendToActiveTurn(slotPrompt);
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
                  alert('Workflow was received but could not be placed on the canvas. See console.');
                }
                setBuildingPhase(false);
              } else {
                console.warn('[Workflow chat] Unknown workflow payload:', wf);
              }
            }
            var line = assistantText || shortMessage || (didImport ? 'Workflow updated.' : '');
            if (line) appendToActiveTurn(line);
            if (slotPrompt) appendToActiveTurn(slotPrompt);
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
                  alert('Workflow was received but could not be placed on the canvas. See console.');
                }
                setBuildingPhase(false);
                setModeUi('create');
                var lineLeg = assistantText || shortMessage || 'Workflow updated.';
                if (lineLeg) appendToActiveTurn(lineLeg);
                if (slotPrompt) appendToActiveTurn(slotPrompt);
                wfChatConversationHistory.push({ role: 'assistant', content: (assistantText || shortMessage || 'Workflow updated.') + (slotPrompt ? ('\n\n' + slotPrompt) : ''), mode: 'create' });
              } else {
                console.warn('[Workflow chat] Unknown workflow payload:', wfLegacy);
                if (assistantText || shortMessage) {
                  appendToActiveTurn(assistantText || shortMessage);
                  if (slotPrompt) appendToActiveTurn(slotPrompt);
                  wfChatConversationHistory.push({ role: 'assistant', content: (assistantText || shortMessage) + (slotPrompt ? ('\n\n' + slotPrompt) : ''), mode: 'legacy' });
                }
              }
            } else if (assistantText || shortMessage) {
              appendToActiveTurn(assistantText || shortMessage);
              if (slotPrompt) appendToActiveTurn(slotPrompt);
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
              alert(nwMsg);
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
            alert(em);
            setAssistantStatusVisible(false);
            wfResumeListeningAfterTurn();
          }
        };

        wfWatchdogVoiceWs.onerror = function () {
          alert('Watchdog voice connection error.');
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
        if (!ta || busy) return;
        const text = (ta.value || '').trim();
        if (!text) {
          alert('Enter a description of the Watch Dog you want to create.');
          return;
        }
        setBusy(true);
        openAssistantPanelForUserMessage(text);
        setAssistantStatusVisible(true, 'Researching design patterns…');
        setFetchLoading(true, '');
        const base = String(WORKFLOW_CHAT_API_BASE || '').replace(/\/$/, '');
        try {
          var verbose = !!((typeof window !== 'undefined' && window.WORKFLOW_CHAT_VERBOSE) || false);
          var sendHistory = (typeof window === 'undefined' || window.WORKFLOW_CHAT_SEND_HISTORY !== false);
          var body = {
            message: text,
            session_id: wfChatSessionId,
            verbose: verbose
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
          if (typeof window !== 'undefined' && typeof window.WORKFLOW_CHAT_ENABLE_INTENT_ROUTER === 'boolean') {
            body.enable_intent_router = window.WORKFLOW_CHAT_ENABLE_INTENT_ROUTER;
          }

          const res = await fetch(base + '/api/v1/watchdog/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
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
            alert(detailStr);
            return;
          }

          await applyWatchdogGeneratePayload(data, { userText: text, clearInput: true, voiceTurn: false });
        } catch (err) {
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
          alert(netErr);
        } finally {
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

    initWorkflowAiChatDock();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initWorkflowEditor().catch(console.error); });
  } else {
    setTimeout(function () { initWorkflowEditor().catch(console.error); }, 0);
  }
})();
        
