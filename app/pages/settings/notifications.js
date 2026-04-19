import { api } from '../../core/api.js';
'use strict';

var DBG = '[NotifSettings]';

function showStatus(msg, isError) {
  var el = document.getElementById('saveStatus');
  if (!el) return;
  el.style.display = 'block';
  el.className = 'alert ' + (isError ? 'alert-danger' : 'alert-success');
  el.textContent = msg;
  setTimeout(function () { el.style.display = 'none'; }, 4000);
}

function buildPayload() {
  var chEmail = document.getElementById('chEmail');
  var emailAddrEl = document.getElementById('emailAddress');
  var chOsPopup = document.getElementById('chOsPopup');
  var chFcm = document.getElementById('chFcm');
  if (!chEmail || !emailAddrEl || !chOsPopup || !chFcm) return null;

  const channels = {
    websocket: { enabled: true },
    email: { enabled: chEmail.checked, address: emailAddrEl.value.trim() },
    fcm: { enabled: chFcm.checked },
    os_popup: { enabled: chOsPopup.checked }
  };
  const bySeverity = { critical: [], warning: [], info: [] };
  ['critical', 'warning', 'info'].forEach(function (sev) {
    var ws = document.getElementById('sev_' + sev + '_ws');
    var em = document.getElementById('sev_' + sev + '_email');
    var fc = document.getElementById('sev_' + sev + '_fcm');
    if (ws && ws.checked) bySeverity[sev].push('websocket');
    if (em && em.checked) bySeverity[sev].push('email');
    if (fc && fc.checked) bySeverity[sev].push('fcm');
  });
  const byType = { camera_offline: [], report_ready: [] };
  var tWs = document.getElementById('type_camera_ws');
  var tEm = document.getElementById('type_camera_email');
  var tFc = document.getElementById('type_camera_fcm');
  var tRp = document.getElementById('type_report_email');
  if (tWs && tWs.checked) byType.camera_offline.push('websocket');
  if (tEm && tEm.checked) byType.camera_offline.push('email');
  if (tFc && tFc.checked) byType.camera_offline.push('fcm');
  if (tRp && tRp.checked) byType.report_ready.push('email');
  return { channels, by_severity: bySeverity, by_type: byType };
}

function loadPrefs(prefs) {
  try {
    var ch = prefs.channels || {};
    var emailCfg = ch.email || {};
    var chEmailEl = document.getElementById('chEmail');
    if (chEmailEl) chEmailEl.checked = emailCfg.enabled || false;
    var addr = emailCfg.address || '';
    if (!addr && api && api.user && api.user.email) addr = api.user.email;
    var addrEl = document.getElementById('emailAddress');
    if (addrEl) addrEl.value = addr;
    var osPopupEl = document.getElementById('chOsPopup');
    if (osPopupEl) osPopupEl.checked = (ch.os_popup || {}).enabled !== false;
    var fcmEl = document.getElementById('chFcm');
    if (fcmEl) fcmEl.checked = (ch.fcm || {}).enabled || false;

    var bySev = prefs.by_severity || {};
    ['critical', 'warning', 'info'].forEach(function (sev) {
      var list = bySev[sev] || ['websocket'];
      var ws = document.getElementById('sev_' + sev + '_ws');
      var em = document.getElementById('sev_' + sev + '_email');
      var fc = document.getElementById('sev_' + sev + '_fcm');
      if (ws) ws.checked = list.indexOf('websocket') >= 0;
      if (em) em.checked = list.indexOf('email') >= 0;
      if (fc) fc.checked = list.indexOf('fcm') >= 0;
    });
    var byType = prefs.by_type || {};
    var camList = byType.camera_offline || ['websocket'];
    var tWs = document.getElementById('type_camera_ws');
    var tEm = document.getElementById('type_camera_email');
    var tFc = document.getElementById('type_camera_fcm');
    var tRp = document.getElementById('type_report_email');
    if (tWs) tWs.checked = camList.indexOf('websocket') >= 0;
    if (tEm) tEm.checked = camList.indexOf('email') >= 0;
    if (tFc) tFc.checked = camList.indexOf('fcm') >= 0;
    if (tRp) tRp.checked = (byType.report_ready || ['email']).indexOf('email') >= 0;
  } catch (err) {
    console.warn(DBG, 'loadPrefs error:', err);
  }
}

function initUser() {
  var u = api && api.user;
  if (u) {
    var el = document.getElementById('userEmail');
    if (el) el.textContent = u.email || u.full_name || 'User';
    var av = document.getElementById('userAvatar');
    if (av && u.full_name) av.textContent = u.full_name.charAt(0).toUpperCase();
  }
}

function handleSaveClick() {
  if (!api || typeof api.isAuthenticated !== 'function' || !api.isAuthenticated()) {
    showStatus('Please log in to save settings.', true);
    return;
  }
  var chEmail = document.getElementById('chEmail');
  var emailAddrEl = document.getElementById('emailAddress');
  if (chEmail && chEmail.checked && (!emailAddrEl || !emailAddrEl.value.trim())) {
    showStatus('Please enter an email address when email is enabled.', true);
    return;
  }
  var payload = buildPayload();
  if (!payload) { showStatus('Failed to build settings payload.', true); return; }

  var btn = document.getElementById('btnSave');
  if (btn) btn.disabled = true;
  api.updateNotificationPreferences(payload)
    .then(function () {
      showStatus('Settings saved successfully.');
      window.dispatchEvent(new CustomEvent('vision:notification-prefs-updated', { detail: payload }));
    })
    .catch(function (e) { showStatus('Failed to save: ' + (e && e.message ? e.message : 'Unknown error'), true); })
    .finally(function () { var b = document.getElementById('btnSave'); if (b) b.disabled = false; });
}

function bindSaveButton() {
  var btnSaveEl = document.getElementById('btnSave');
  if (!btnSaveEl || btnSaveEl.getAttribute('data-notif-save-bound') === 'true') return;
  btnSaveEl.setAttribute('data-notif-save-bound', 'true');
  btnSaveEl.addEventListener('click', handleSaveClick);
}

function runInit() {
  initUser();
  bindSaveButton();
  if (api && api.isAuthenticated && api.isAuthenticated()) {
    api.getNotificationPreferences()
      .then(function (p) { loadPrefs(p); })
      .catch(function () { loadPrefs({}); });
  }
  if (typeof feather !== 'undefined') feather.replace();
  if (window.__visionNotifications && window.__visionNotifications.updateOsNotifStatus) {
    setTimeout(function () { window.__visionNotifications.updateOsNotifStatus(); }, 100);
  }
}

runInit();

window.addEventListener('vision:spa:navigated', function (e) {
  if (e.detail && e.detail.url && String(e.detail.url).indexOf('notifications') >= 0) runInit();
});
