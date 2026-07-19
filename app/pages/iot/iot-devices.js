'use strict';
import { toast } from '../../core/toast.js';
import { api } from '../../core/api.js';

// ── Device catalog (dummy) ───────────────────────────────────────────────────
const CATALOG = [
  { type: 'temperature', name: 'Temperature Sensor', icon: 'fa-temperature-half', accent: '#e5780b', kind: 'sensor', unit: '°C',    protocol: 'MQTT',      port: 1883, desc: 'Monitor cold-chain and ambient temperature in real time.' },
  { type: 'humidity',    name: 'Humidity Sensor',    icon: 'fa-droplet',         accent: '#17a2b8', kind: 'sensor', unit: '%RH',   protocol: 'MQTT',      port: 1883, desc: 'Track moisture levels for storage and product quality.' },
  { type: 'weight',      name: 'Weight / Load Cell', icon: 'fa-weight-hanging',  accent: '#6f42c1', kind: 'sensor', unit: 'kg',    protocol: 'Modbus TCP',port: 502,  desc: 'Measure package or conveyor weight for yield control.' },
  { type: 'door',        name: 'Door / Reed Switch', icon: 'fa-door-open',       accent: '#20c997', kind: 'sensor', unit: 'open/closed', protocol: 'MQTT', port: 1883, desc: 'Detect cold-room or clean-room doors left open.' },
  { type: 'gas',         name: 'Gas / Air Quality',  icon: 'fa-wind',            accent: '#25b003', kind: 'sensor', unit: 'ppm',   protocol: 'MQTT',      port: 1883, desc: 'Sense CO₂, ammonia or refrigerant leaks near equipment.' },
  { type: 'motion',      name: 'Motion / PIR',       icon: 'fa-person-walking',  accent: '#f5a623', kind: 'sensor', unit: 'bool',  protocol: 'MQTT',      port: 1883, desc: 'Trigger checks when movement is detected in a zone.' },
  { type: 'vibration',   name: 'Vibration Sensor',   icon: 'fa-wave-square',     accent: '#e83e8c', kind: 'sensor', unit: 'mm/s',  protocol: 'Modbus TCP',port: 502,  desc: 'Predictive maintenance for motors and machinery.' },
  { type: 'water_flow',  name: 'Water Flow Meter',   icon: 'fa-faucet-drip',     accent: '#0dcaf0', kind: 'sensor', unit: 'L/min', protocol: 'HTTP/REST', port: 80,   desc: 'Verify wash-down / CIP sanitation cycles actually ran.' },
  { type: 'siren',       name: 'Siren / Alarm',      icon: 'fa-bell',            accent: '#e5183b', kind: 'actuator', unit: '',    protocol: 'NATS',      port: 4222, desc: 'Sound an alert or stack light when an event fires.' },
  { type: 'relay',       name: 'Smart Relay',        icon: 'fa-toggle-on',       accent: '#3874ff', kind: 'actuator', unit: 'on/off', protocol: 'MQTT',   port: 1883, desc: 'Switch machines, stop a line, or trigger a device.' },
  { type: 'smart_light', name: 'Signal Light',       icon: 'fa-lightbulb',       accent: '#fd7e14', kind: 'actuator', unit: 'on/off', protocol: 'MQTT',   port: 1883, desc: 'Andon / status light driven by detection events.' },
];

const STORAGE_KEY = 'visionai_iot_devices';
const CUSTOM_TYPES_KEY = 'visionai_iot_custom_types';

function loadCustomTypes() { try { return JSON.parse(localStorage.getItem(CUSTOM_TYPES_KEY) || '[]'); } catch { return []; } }
function saveCustomTypes(list) { localStorage.setItem(CUSTOM_TYPES_KEY, JSON.stringify(list)); }
function allCatalog() { return CATALOG.concat(loadCustomTypes()); }
function catalogFor(type) { return allCatalog().find(c => c.type === type) || CATALOG[0]; }
function loadDevices() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
function saveDevices(list) { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function uid() { return 'iot_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ── Backend sync (backend Mongo is the source of truth; localStorage is a cache
//    so the page still renders offline). Devices registered here appear in the
//    workflow editor's IoT node dropdown and get simulated telemetry readings. ──
function ownerUserId() { return (api.user && api.user.id) ? String(api.user.id) : ''; }

async function registerDeviceBackend(device) {
  await api.post('/api/v1/iot-gateway/devices/register', {
    device_id: device.id,
    name: device.name,
    type: device.type,
    protocol: device.protocol || 'MQTT',
    ip: device.host || '',
    owner_user_id: ownerUserId(),
    metadata: {
      unit: device.unit || '', port: device.port || '',
      identifier: device.identifier || '', location: device.location || '',
      kind: catalogFor(device.type).kind,
    },
  });
}

async function syncDevicesFromBackend() {
  // Pull the backend list; heal any local-only devices by registering them.
  const local = loadDevices();
  let backend = [];
  try {
    const res = await api.get(`/api/v1/iot-gateway/devices?owner_user_id=${encodeURIComponent(ownerUserId())}`);
    backend = res.devices || [];
  } catch (e) {
    console.warn('[IoT] backend device list unavailable, using local cache', e);
    return local;
  }
  const backendIds = new Set(backend.map(d => d.device_id));
  for (const device of local) {
    if (!backendIds.has(device.id)) {
      try { await registerDeviceBackend(device); backend.push({ device_id: device.id }); backendIds.add(device.id); }
      catch (e) { console.warn('[IoT] migrate register failed', device.id, e); }
    }
  }
  // Merge: backend is authoritative for existence; local keeps display extras.
  const localById = Object.fromEntries(local.map(d => [d.id, d]));
  const merged = backend.map(b => localById[b.device_id] || {
    id: b.device_id, type: b.type || 'relay', name: b.name || b.device_id,
    protocol: b.protocol || '', host: b.ip || '',
    port: (b.metadata && b.metadata.port) || '', unit: (b.metadata && b.metadata.unit) || '',
    identifier: (b.metadata && b.metadata.identifier) || '',
    location: (b.metadata && b.metadata.location) || '',
  });
  saveDevices(merged);
  return merged;
}

// ── Live readings (poll the simulator every 3 s; one source of truth) ────────
let readingsTimer = null;

async function refreshReadings() {
  const ids = loadDevices().map(d => d.id);
  if (!ids.length) return;
  let readings = [];
  try {
    const res = await api.get(`/api/v1/iot-gateway/readings?device_ids=${encodeURIComponent(ids.join(','))}`);
    readings = res.readings || [];
  } catch { return; }
  for (const reading of readings) {
    const el = document.querySelector(`[data-iot-reading="${CSS.escape(reading.device_id)}"]`);
    if (!el) continue;
    el.textContent = reading.display;
    el.classList.toggle('iot-reading-alert',
      reading.spiking || reading.state === 'high' || reading.display === 'ON');
  }
}

function startReadingsPoll() {
  stopReadingsPoll();
  refreshReadings();
  readingsTimer = setInterval(refreshReadings, 3000);
}

function stopReadingsPoll() {
  if (readingsTimer) { clearInterval(readingsTimer); readingsTimer = null; }
}

// ── Rendering ────────────────────────────────────────────────────────────────
function renderCatalog() {
  const grid = document.getElementById('iot-catalog-grid');
  if (!grid) return;
  const cards = allCatalog().map(c => `
    <div class="col-12 col-sm-6 col-lg-4 col-xxl-3">
      <div class="iot-catalog-card h-100" style="--iot-accent:${c.accent};" data-iot-add="${escapeHtml(c.type)}" role="button">
        <div class="d-flex align-items-start justify-content-between mb-2">
          <span class="iot-icon-tile" style="--iot-accent:${c.accent};"><i class="fa-solid ${escapeHtml(c.icon)}"></i></span>
          <span class="iot-card-cat">${c.custom ? 'custom · ' : ''}${escapeHtml(c.kind)}</span>
        </div>
        <p class="iot-card-title">${escapeHtml(c.name)}</p>
        <p class="iot-card-desc">${escapeHtml(c.desc || '')}</p>
        <div class="mt-2">
          <button type="button" class="iot-add-link" data-iot-add="${escapeHtml(c.type)}"><i class="fa-solid fa-circle-plus"></i> Add device</button>
        </div>
      </div>
    </div>`).join('');

  const addTypeCard = `
    <div class="col-12 col-sm-6 col-lg-4 col-xxl-3">
      <div class="iot-add-type-card" data-iot-new-type role="button">
        <div class="iot-add-type-icon"><i class="fa-solid fa-plus"></i></div>
        <div class="iot-add-type-title">Add new type</div>
        <div class="iot-add-type-sub">Create a custom sensor or actuator</div>
      </div>
    </div>`;

  grid.innerHTML = cards + addTypeCard;
}

function renderConnected() {
  const grid = document.getElementById('iot-connected-grid');
  const empty = document.getElementById('iot-connected-empty');
  const countPill = document.getElementById('iot-connected-count');
  if (!grid || !empty) return;
  const devices = loadDevices();
  countPill.textContent = devices.length;

  if (!devices.length) {
    grid.classList.add('d-none');
    empty.classList.remove('d-none');
  } else {
    empty.classList.add('d-none');
    grid.classList.remove('d-none');
    grid.innerHTML = devices.map(d => {
      const c = catalogFor(d.type);
      const endpoint = [d.host, d.port].filter(Boolean).join(':') || '—';
      return `
      <div class="col-12 col-sm-6 col-lg-4 col-xxl-3">
        <div class="iot-device-card h-100" style="--iot-accent:${c.accent};">
          <div class="d-flex align-items-start justify-content-between mb-2">
            <div class="d-flex align-items-center">
              <span class="iot-icon-tile me-2" style="--iot-accent:${c.accent}; width:36px; height:36px; font-size:.9rem;"><i class="fa-solid ${c.icon}"></i></span>
              <div>
                <p class="iot-card-title mb-0">${escapeHtml(d.name)}</p>
                <span class="iot-card-cat">${escapeHtml(c.name)}</span>
              </div>
            </div>
            <button type="button" class="iot-icon-btn" data-iot-remove="${d.id}" title="Remove"><i class="fa-solid fa-trash-can"></i></button>
          </div>
          <div class="d-flex align-items-center justify-content-between mb-2">
            <span class="iot-status"><span class="dot"></span> Connected</span>
            <span class="iot-device-meta"><i class="fa-solid fa-diagram-project me-1"></i>${escapeHtml(d.protocol || '')}</span>
          </div>
          <div class="iot-reading-row d-flex align-items-center justify-content-between mb-2"
               style="background:rgba(0,0,0,.04); border-radius:8px; padding:6px 10px;">
            <span class="iot-device-meta"><i class="fa-solid fa-gauge-high me-1"></i>Reading</span>
            <span class="iot-reading fw-bold" data-iot-reading="${escapeHtml(d.id)}"
                  style="font-variant-numeric: tabular-nums;">—</span>
          </div>
          <div class="iot-device-endpoint" title="${escapeHtml(endpoint)}"><i class="fa-solid fa-link me-1"></i>${escapeHtml(endpoint)}</div>
          ${d.location ? `<div class="iot-device-meta mt-2"><i class="fa-solid fa-location-dot me-1"></i>${escapeHtml(d.location)}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }
  renderStats(devices);
}

function renderStats(devices) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('iot-stat-total', devices.length);
  set('iot-stat-online', devices.length);
  set('iot-stat-sensors', devices.filter(d => catalogFor(d.type).kind === 'sensor').length);
  set('iot-stat-actuators', devices.filter(d => catalogFor(d.type).kind === 'actuator').length);
}

// ── Modal ────────────────────────────────────────────────────────────────────
const modalInstances = {};
function getModal(id) {
  const el = document.getElementById(id);
  if (!el || !window.bootstrap) return null;
  if (!modalInstances[id]) modalInstances[id] = window.bootstrap.Modal.getOrCreateInstance(el);
  return modalInstances[id];
}

function openAddModal(type) {
  const c = catalogFor(type);
  const $ = id => document.getElementById(id);
  $('iot-field-type').value = c.type;
  $('iot-field-edit-id').value = '';
  $('iot-field-name').value = '';
  $('iot-field-protocol').value = c.protocol;
  $('iot-field-unit').value = c.unit;
  $('iot-field-host').value = '';
  $('iot-field-port').value = c.port || '';
  $('iot-field-identifier').value = '';
  $('iot-field-location').value = '';
  $('iot-modal-title').textContent = 'Add ' + c.name;
  $('iot-modal-subtitle').textContent = 'Configure connection details';
  const iconEl = $('iot-modal-icon');
  iconEl.style.setProperty('--iot-accent', c.accent);
  iconEl.innerHTML = `<i class="fa-solid ${c.icon}"></i>`;
  const modal = getModal('iot-device-modal');
  if (modal) modal.show();
}

function saveDevice() {
  const $ = id => document.getElementById(id);
  const name = ($('iot-field-name').value || '').trim();
  if (!name) {
    $('iot-field-name').classList.add('is-invalid');
    $('iot-field-name').focus();
    return;
  }
  $('iot-field-name').classList.remove('is-invalid');
  const device = {
    id: uid(),
    type: $('iot-field-type').value,
    name,
    protocol: $('iot-field-protocol').value,
    unit: ($('iot-field-unit').value || '').trim(),
    host: ($('iot-field-host').value || '').trim(),
    port: ($('iot-field-port').value || '').trim(),
    identifier: ($('iot-field-identifier').value || '').trim(),
    location: ($('iot-field-location').value || '').trim(),
    createdAt: new Date().toISOString(),
  };
  const list = loadDevices();
  list.push(device);
  saveDevices(list);
  renderConnected();
  const modal = getModal('iot-device-modal');
  if (modal) modal.hide();
  // Register in the backend so the workflow dropdown sees it and readings flow.
  registerDeviceBackend(device)
    .then(() => { refreshReadings(); try { toast.success(`${device.name} connected`); } catch { /* ignore */ } })
    .catch((e) => {
      console.warn('[IoT] backend register failed', e);
      try { toast.warning(`${device.name} saved locally (backend offline)`); } catch { /* ignore */ }
    });
}

function removeDevice(id) {
  const list = loadDevices().filter(d => d.id !== id);
  saveDevices(list);
  renderConnected();
  api.delete(`/api/v1/iot-gateway/devices/${encodeURIComponent(id)}`)
    .catch((e) => console.warn('[IoT] backend remove failed', e));
  try { toast.info('Device removed'); } catch { /* ignore */ }
}

// ── New custom device type ───────────────────────────────────────────────────
const typeDraft = { icon: 'fa-gauge-high', accent: '#3874ff', kind: 'sensor' };

function updateTypePreview() {
  const el = document.getElementById('iot-type-preview');
  if (!el) return;
  el.style.setProperty('--iot-accent', typeDraft.accent);
  el.innerHTML = `<i class="fa-solid ${typeDraft.icon}"></i>`;
}

function openTypeModal() {
  const $ = id => document.getElementById(id);
  typeDraft.icon = 'fa-gauge-high'; typeDraft.accent = '#3874ff'; typeDraft.kind = 'sensor';
  $('iot-type-name').value = '';
  $('iot-type-unit').value = '';
  $('iot-type-desc').value = '';
  $('iot-type-protocol').value = 'MQTT';
  // reset active states
  document.querySelectorAll('#iot-type-icons .iot-pick').forEach(b => b.classList.toggle('active', b.getAttribute('data-icon') === typeDraft.icon));
  document.querySelectorAll('#iot-type-colors .iot-swatch').forEach(b => b.classList.toggle('active', b.getAttribute('data-color') === typeDraft.accent));
  document.querySelectorAll('#iot-type-kind .iot-segment-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-kind') === typeDraft.kind));
  updateTypePreview();
  const modal = getModal('iot-type-modal');
  if (modal) modal.show();
}

function saveType() {
  const $ = id => document.getElementById(id);
  const name = ($('iot-type-name').value || '').trim();
  if (!name) { $('iot-type-name').classList.add('is-invalid'); $('iot-type-name').focus(); return; }
  $('iot-type-name').classList.remove('is-invalid');
  const slug = 'custom_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') + '_' + Math.random().toString(36).slice(2, 5);
  const newType = {
    type: slug,
    name,
    icon: typeDraft.icon,
    accent: typeDraft.accent,
    kind: typeDraft.kind,
    unit: ($('iot-type-unit').value || '').trim(),
    protocol: $('iot-type-protocol').value,
    port: '',
    desc: ($('iot-type-desc').value || '').trim() || 'Custom device type.',
    custom: true,
  };
  const list = loadCustomTypes();
  list.push(newType);
  saveCustomTypes(list);
  renderCatalog();
  const modal = getModal('iot-type-modal');
  if (modal) modal.hide();
  try { toast.success(`${name} type added`); } catch { /* ignore */ }
}

// ── Wiring ───────────────────────────────────────────────────────────────────
function wire() {
  const root = document.querySelector('.iot-page');
  if (!root || root.dataset.iotWired === '1') return;  // router may boot() twice on first load
  root.dataset.iotWired = '1';

  document.getElementById('iot-add-device-btn')?.addEventListener('click', () => openAddModal(CATALOG[0].type));
  document.getElementById('iot-save-device-btn')?.addEventListener('click', saveDevice);
  document.getElementById('iot-save-type-btn')?.addEventListener('click', saveType);

  // Icon / colour / category pickers inside the new-type modal
  document.getElementById('iot-type-icons')?.addEventListener('click', (e) => {
    const b = e.target.closest('.iot-pick'); if (!b) return;
    typeDraft.icon = b.getAttribute('data-icon');
    document.querySelectorAll('#iot-type-icons .iot-pick').forEach(x => x.classList.toggle('active', x === b));
    updateTypePreview();
  });
  document.getElementById('iot-type-colors')?.addEventListener('click', (e) => {
    const b = e.target.closest('.iot-swatch'); if (!b) return;
    typeDraft.accent = b.getAttribute('data-color');
    document.querySelectorAll('#iot-type-colors .iot-swatch').forEach(x => x.classList.toggle('active', x === b));
    updateTypePreview();
  });
  document.getElementById('iot-type-kind')?.addEventListener('click', (e) => {
    const b = e.target.closest('.iot-segment-btn'); if (!b) return;
    typeDraft.kind = b.getAttribute('data-kind');
    document.querySelectorAll('#iot-type-kind .iot-segment-btn').forEach(x => x.classList.toggle('active', x === b));
  });

  // Delegated clicks for catalog "add", "new type", and connected "remove"
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-iot-new-type]')) { openTypeModal(); return; }
    const addEl = e.target.closest('[data-iot-add]');
    if (addEl) { openAddModal(addEl.getAttribute('data-iot-add')); return; }
    const rmEl = e.target.closest('[data-iot-remove]');
    if (rmEl) { removeDevice(rmEl.getAttribute('data-iot-remove')); return; }
  });

  // Clean up modals/backdrop + readings poller on SPA navigation away
  window.__visionaiPageCleanup = function () {
    stopReadingsPoll();
    Object.values(modalInstances).forEach(m => { try { m?.hide(); m?.dispose(); } catch { /* ignore */ } });
    Object.keys(modalInstances).forEach(k => delete modalInstances[k]);
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('overflow');
    document.body.style.removeProperty('padding-right');
  };
}

export async function boot() {
  renderCatalog();
  renderConnected();          // instant paint from local cache
  wire();
  try {
    await syncDevicesFromBackend();   // backend is source of truth; heals local-only devices
    renderConnected();
  } catch (e) {
    console.warn('[IoT] backend sync failed', e);
  }
  startReadingsPoll();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () { boot(); });
} else {
  boot();
}
