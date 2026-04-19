import { toast } from '../../core/toast.js';
import { api } from '../../core/api.js';
/**
 * agent-create-modal.js
 * Multi-step Create Agent wizard logic.
 * Imports zone editor; exports bindCreateAgentModal.
 */

import {
  zoneState,
  zoneReset,
  zoneSaveAndMark,
  zoneLoadSnapshot
} from './agent-zone-editor.js';

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
// Helpers
// ---------------------------------------------------------------------------

function apiRequest(path, opts) {
  if (api && typeof api.request === 'function') {
    return api.request(path, opts || {});
  }
  return Promise.reject(new Error('API service not available.'));
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
// Public entry point
// ---------------------------------------------------------------------------

export function bindCreateAgentModal(onAgentCreated) {
  var openBtn  = document.getElementById('vision-agents-create-btn');
  var modalEl  = document.getElementById('vision-create-agent-modal');
  if (!openBtn || !modalEl) return;

  var currentStep          = 1;
  var selectedRuleId       = null;
  var ruleMeta             = null;
  var totalSteps           = 2;
  var selectedScheduleType = null;

  function el(id) { return document.getElementById(id); }

  // ── Helpers ──────────────────────────────────────────────────────────────

  function toISOUTC(dtLocalValue) {
    if (!dtLocalValue) return null;
    var d = new Date(dtLocalValue);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().replace('.000Z', ':00+00:00');
  }

  function todToISOUTC(timeValue) {
    if (!timeValue) return null;
    var parts = timeValue.split(':');
    var h = parseInt(parts[0], 10);
    var m = parts.length > 1 ? parseInt(parts[1], 10) : 0;
    var now = new Date();
    var local = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0);
    return local.toISOString().replace('.000Z', ':00+00:00');
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

  function setFieldError(inputId, errorId, msg) {
    var inp = el(inputId);
    var err = el(errorId);
    if (!inp || !err) return;
    if (msg) {
      inp.classList.add('is-invalid');
      err.textContent = msg;
      err.classList.remove('d-none');
    } else {
      inp.classList.remove('is-invalid');
      err.textContent = '';
      err.classList.add('d-none');
    }
  }

  function clearFieldError(inputId, errorId) {
    setFieldError(inputId, errorId, '');
  }

  function validateOnceTimes() {
    var stVal = el('ca-start-time') && el('ca-start-time').value;
    var etVal = el('ca-end-time') && el('ca-end-time').value;
    var now   = Date.now();
    var startOk = true, endOk = true;

    if (stVal) {
      var stMs = new Date(stVal).getTime();
      if (isNaN(stMs)) {
        setFieldError('ca-start-time', 'ca-start-time-error', 'Invalid date or time.');
        startOk = false;
      } else if (stMs < now) {
        setFieldError('ca-start-time', 'ca-start-time-error', 'This date and time has already passed.');
        startOk = false;
      } else {
        clearFieldError('ca-start-time', 'ca-start-time-error');
      }
    } else {
      clearFieldError('ca-start-time', 'ca-start-time-error');
    }

    if (etVal) {
      var etMs = new Date(etVal).getTime();
      if (isNaN(etMs)) {
        setFieldError('ca-end-time', 'ca-end-time-error', 'Invalid date or time.');
        endOk = false;
      } else if (etMs < now) {
        setFieldError('ca-end-time', 'ca-end-time-error', 'This date and time has already passed.');
        endOk = false;
      } else if (stVal && startOk) {
        var stMs2 = new Date(stVal).getTime();
        if (etMs <= stMs2) {
          setFieldError('ca-end-time', 'ca-end-time-error', 'End must be after the start time.');
          endOk = false;
        } else {
          clearFieldError('ca-end-time', 'ca-end-time-error');
        }
      } else {
        clearFieldError('ca-end-time', 'ca-end-time-error');
      }
    } else {
      clearFieldError('ca-end-time', 'ca-end-time-error');
    }

    return startOk && endOk;
  }

  function validateTodTimes() {
    var stVal = el('ca-start-tod') && el('ca-start-tod').value;
    var etVal = el('ca-end-tod') && el('ca-end-tod').value;

    if (stVal && etVal) {
      if (etVal <= stVal) {
        setFieldError('ca-end-tod', 'ca-end-tod-error', 'End time must be after the start time.');
        clearFieldError('ca-start-tod', 'ca-start-tod-error');
        return false;
      }
    }
    clearFieldError('ca-start-tod', 'ca-start-tod-error');
    clearFieldError('ca-end-tod', 'ca-end-tod-error');
    return true;
  }

  function clearAllTimeErrors() {
    ['ca-start-time','ca-end-time','ca-start-tod','ca-end-tod'].forEach(function (id) {
      clearFieldError(id, id + '-error');
    });
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
    if (active) active.className = active.className.replace(idleCls, activeCls);

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

    if (backBtn)   backBtn.classList.toggle('d-none', step === 1);
    if (cancelBtn) cancelBtn.classList.toggle('d-none', false);
    if (nextBtn)   nextBtn.classList.toggle('d-none', step !== 1);
    if (zoneBtn)   zoneBtn.classList.toggle('d-none', !(step === 2 && totalSteps === 3));
    if (createBtn) createBtn.classList.toggle('d-none', !(step === 2 && totalSteps === 2) && !(step === 3));

    updateStepPills(step);

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
        var ind = el('ca-zone-saved-indicator');
        if (ind) ind.classList.add('d-none');
        if (createBtn) createBtn.disabled = true;
        zoneLoadSnapshot(camId, ruleMeta.zoneType === 'line' ? 'line' : 'polygon');
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

  // ── Schedule-type field visibility ────────────────────────────────────────

  function applyScheduleFields(sched) {
    var onceGrp = el('ca-time-once-group');
    var todGrp  = el('ca-time-tod-group');
    var daysGrp = el('ca-active-days-group');
    var hasTOD  = sched === 'daily' || sched === 'weekly';
    if (onceGrp) onceGrp.classList.toggle('d-none', sched !== 'once');
    if (todGrp)  todGrp.classList.toggle('d-none',  !hasTOD);
    if (daysGrp) daysGrp.classList.toggle('d-none', sched !== 'weekly');
  }

  // ── Rule-specific field visibility ────────────────────────────────────────

  function applyRuleFields(rule) {
    if (!rule) return;

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

    if (!selectedScheduleType) {
      ok = false;
    } else if (selectedScheduleType === 'once') {
      var st = el('ca-start-time') && el('ca-start-time').value;
      var et = el('ca-end-time') && el('ca-end-time').value;
      if (!st || !et) ok = false;
      if (!validateOnceTimes()) ok = false;
    } else if (selectedScheduleType === 'daily') {
      var ts = el('ca-start-tod') && el('ca-start-tod').value;
      var te = el('ca-end-tod') && el('ca-end-tod').value;
      if (!ts || !te) ok = false;
      if (!validateTodTimes()) ok = false;
    } else if (selectedScheduleType === 'weekly') {
      var ts2 = el('ca-start-tod') && el('ca-start-tod').value;
      var te2 = el('ca-end-tod') && el('ca-end-tod').value;
      if (!ts2 || !te2) ok = false;
      if (!validateTodTimes()) ok = false;
      var DAY_CODES = ['mon','tue','wed','thu','fri','sat','sun'];
      var anyDay = DAY_CODES.some(function (d) {
        var cb = el('ca-day-' + d);
        return cb && cb.checked;
      });
      if (!anyDay) ok = false;
    }

    var isPatrol = document.querySelector('input[name="ca-run-mode"]:checked');
    if (isPatrol && isPatrol.value === 'patrol') {
      var im = el('ca-interval-minutes') && parseFloat(el('ca-interval-minutes').value);
      var cd = el('ca-check-duration') && parseFloat(el('ca-check-duration').value);
      if (!im || im < 1 || !cd || cd < 1) ok = false;
    }

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

    var sched = selectedScheduleType || 'once';
    var body = {
      rule_id:       selectedRuleId,
      name:          (el('ca-name') && el('ca-name').value.trim()) || null,
      camera_id:     el('ca-camera') && el('ca-camera').value || null,
      run_mode:      runMode,
      schedule_type: sched
    };

    if (sched === 'once') {
      body.start_time = toISOUTC(el('ca-start-time') && el('ca-start-time').value);
      body.end_time   = toISOUTC(el('ca-end-time') && el('ca-end-time').value);
    } else if (sched === 'daily' || sched === 'weekly') {
      body.start_time = todToISOUTC(el('ca-start-tod') && el('ca-start-tod').value);
      body.end_time   = todToISOUTC(el('ca-end-tod') && el('ca-end-tod').value);
      if (sched === 'weekly') {
        var DAY_CODES = ['mon','tue','wed','thu','fri','sat','sun'];
        body.active_days = DAY_CODES.filter(function (d) {
          var cb = el('ca-day-' + d);
          return cb && cb.checked;
        });
      }
    }

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
      body.interval_minutes       = parseFloat(el('ca-interval-minutes').value) || null;
      body.check_duration_seconds = parseFloat(el('ca-check-duration').value) || null;
    }

    if (ruleMeta.needsZone && zoneState.savedCoords && zoneState.savedCoords.length) {
      body.zone = { type: zoneState.savedType, coordinates: zoneState.savedCoords };
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
        if (typeof bootstrap !== 'undefined') {
          var modal = bootstrap.Modal.getInstance(modalEl);
          if (modal) modal.hide();
        }
        if (typeof toast !== 'undefined' && toast.success) {
          toast.success('Agent created successfully.');
        }
        if (typeof onAgentCreated === 'function') {
          setTimeout(onAgentCreated, 600);
        }
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

  // ── Full reset ────────────────────────────────────────────────────────────

  function resetModal() {
    currentStep          = 1;
    selectedRuleId       = null;
    ruleMeta             = null;
    totalSteps           = 2;
    camerasLoaded        = false;
    selectedScheduleType = null;
    zoneReset('polygon');

    ['ca-name', 'ca-watch-names', 'ca-idle-threshold', 'ca-absence-threshold',
     'ca-interval-minutes', 'ca-check-duration'].forEach(function (id) {
      var f = el(id); if (f) f.value = '';
    });

    ['ca-start-time', 'ca-end-time', 'ca-start-tod', 'ca-end-tod'].forEach(function (id) {
      var f = el(id); if (f) f.value = '';
    });

    ['mon','tue','wed','thu','fri','sat','sun'].forEach(function (d) {
      var cb = el('ca-day-' + d); if (cb) cb.checked = false;
    });

    ['ca-time-once-group', 'ca-time-tod-group', 'ca-active-days-group'].forEach(function (id) {
      var g = el(id); if (g) g.classList.add('d-none');
    });
    clearAllTimeErrors();

    var schedCards = el('ca-sched-cards');
    if (schedCards) schedCards.querySelectorAll('.ca-sched-card').forEach(function (c) { c.classList.remove('selected'); });

    var contRadio = el('ca-run-continuous');
    if (contRadio) contRadio.checked = true;
    var patrolGrp = el('ca-patrol-group');
    if (patrolGrp) patrolGrp.classList.add('d-none');

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
  if (createBtn) {
    createBtn.addEventListener('click', function () {
      if (currentStep === 3 && !zoneState.savedCoords && zoneState.mode === 'polygon' && zoneState.points.length >= 3) {
        zoneSaveAndMark();
      }
    }, true);
    createBtn.addEventListener('click', submitCreateAgent);
  }

  // ── Wire up: "Change rule" chip button ────────────────────────────────────

  var changeRuleBtn = el('ca-change-rule-btn');
  if (changeRuleBtn) {
    changeRuleBtn.addEventListener('click', function () {
      var title = el('ca-modal-title');
      if (title) title.textContent = 'Create Agent';
      showStep(1);
    });
  }

  // ── Wire up: schedule type cards ─────────────────────────────────────────

  var schedCardsEl = el('ca-sched-cards');
  if (schedCardsEl) {
    schedCardsEl.querySelectorAll('.ca-sched-card').forEach(function (card) {
      card.addEventListener('click', function () {
        schedCardsEl.querySelectorAll('.ca-sched-card').forEach(function (c) { c.classList.remove('selected'); });
        card.classList.add('selected');
        selectedScheduleType = card.getAttribute('data-sched');
        applyScheduleFields(selectedScheduleType);
        clearAllTimeErrors();
        validateStep2Fields();
      });
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
   'ca-absence-threshold', 'ca-interval-minutes', 'ca-check-duration'].forEach(function (id) {
    var f = el(id);
    if (f) f.addEventListener('change', validateStep2Fields);
    if (f && f.tagName === 'INPUT') f.addEventListener('input', validateStep2Fields);
  });

  ['ca-start-time', 'ca-end-time'].forEach(function (id) {
    var f = el(id);
    if (!f) return;
    function onOnceChange() { validateOnceTimes(); validateStep2Fields(); }
    f.addEventListener('change', onOnceChange);
    f.addEventListener('input',  onOnceChange);
    f.addEventListener('blur',   onOnceChange);
  });

  ['ca-start-tod', 'ca-end-tod'].forEach(function (id) {
    var f = el(id);
    if (!f) return;
    function onTodChange() { validateTodTimes(); validateStep2Fields(); }
    f.addEventListener('change', onTodChange);
    f.addEventListener('input',  onTodChange);
    f.addEventListener('blur',   onTodChange);
  });

  ['mon','tue','wed','thu','fri','sat','sun'].forEach(function (d) {
    var cb = el('ca-day-' + d);
    if (cb) cb.addEventListener('change', validateStep2Fields);
  });

  // ── Wire up: zone undo / clear / retry ───────────────────────────────────

  var undoBtn = el('ca-zone-undo-btn');
  if (undoBtn) {
    undoBtn.addEventListener('click', function () {
      if (zoneState.points.length > 0) {
        zoneState.points.pop();
        zoneState.savedCoords = null;
        zoneState.savedType = null;
        var ind = el('ca-zone-saved-indicator');
        if (ind) ind.classList.add('d-none');
        var cb = el('ca-create-btn');
        if (cb) cb.disabled = true;
        // Re-import draw/hint lazily via dynamic import or call through exported refs
        import('./agent-zone-editor.js').then(function (m) { m.zoneDraw(); m.zoneUpdateHint(); });
      }
    });
  }

  var clearBtn = el('ca-zone-clear-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      zoneState.points = [];
      zoneState.savedCoords = null;
      zoneState.savedType = null;
      var ind = el('ca-zone-saved-indicator');
      if (ind) ind.classList.add('d-none');
      var cb = el('ca-create-btn');
      if (cb) cb.disabled = true;
      import('./agent-zone-editor.js').then(function (m) { m.zoneDraw(); m.zoneUpdateHint(); });
    });
  }

  var retryBtn = el('ca-zone-retry-btn');
  if (retryBtn) {
    retryBtn.addEventListener('click', function () {
      var camId = el('ca-camera') && el('ca-camera').value;
      if (camId && ruleMeta) {
        zoneLoadSnapshot(camId, ruleMeta.zoneType === 'line' ? 'line' : 'polygon');
      }
    });
  }

  var dismissBtn = el('ca-error-dismiss');
  if (dismissBtn) dismissBtn.addEventListener('click', hideError);
}
