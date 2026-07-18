/**
 * CRIT-003 / CRIT-004 — Arbitrary local file read in the Electron client.
 *
 * AUDIT.md:
 *   CRIT-003  main.js:44-99   GET /api/v1/videos/:filename(*) streams ANY absolute
 *                             path on disk whose name ends in a video extension —
 *                             no confinement to a media base directory.
 *   CRIT-004  main.js:236-266 ipcMain.handle('read-video-file') path.normalize +
 *                             fs.readFileSync of ANY path — no base-dir validation.
 *
 * Recommendation: resolve the request against an allow-listed MEDIA_ROOT and reject
 * anything that escapes it.
 *
 * Run with:  node --test tests/security/
 *
 * main.js cannot be imported outside Electron, so:
 *   - Test 1 ("VULNERABILITY") replicates main.js's CURRENT validation verbatim and
 *     proves it accepts a file OUTSIDE the media root. It FAILS today (logic accepts
 *     the out-of-root file) — that failure is the proof of the bug.
 *   - Test 2 pins the FIX contract: a shared guard `lib/secure-media-path.js` that
 *     confines paths to MEDIA_ROOT. It FAILS today (module does not exist) and PASSES
 *     once the guard is added and wired into main.js.
 */
const { test, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

let MEDIA_ROOT;       // the directory videos are SUPPOSED to be confined to
let insideVideo;      // a legitimate video inside MEDIA_ROOT
let outsideSecret;    // a sensitive file OUTSIDE MEDIA_ROOT, named like a video

before(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'algovision-sec-'));
  MEDIA_ROOT = path.join(base, 'media');
  fs.mkdirSync(MEDIA_ROOT);
  insideVideo = path.join(MEDIA_ROOT, 'clip.mp4');
  fs.writeFileSync(insideVideo, 'OK-INSIDE');

  // Simulates e.g. C:\Users\me\.ssh\id_rsa renamed/served as a video — anything the
  // user can read. It lives OUTSIDE MEDIA_ROOT and must never be served.
  outsideSecret = path.join(base, 'secret.mp4');
  fs.writeFileSync(outsideSecret, 'TOP-SECRET-CONTENTS');
});

// --- Test 1: characterize the CURRENT (vulnerable) main.js logic -----------------
test('CRIT-003/004: current main.js logic must NOT serve files outside MEDIA_ROOT', () => {
  // Verbatim from main.js:46-57 (Express route) and :239-243 (IPC handler):
  function currentLogicWouldServe(requested) {
    if (!requested.match(/\.(mp4|webm|ogg|avi|mov|mkv)$/i)) return false; // :47
    const decodedPath = decodeURIComponent(requested);                   // :51
    const normalizedPath = path.normalize(decodedPath);                  // :52
    if (!fs.existsSync(normalizedPath)) return false;                    // :54
    return true; // -> streamed to the client / returned to the renderer
  }

  assert.strictEqual(
    currentLogicWouldServe(outsideSecret),
    false,
    'SECURITY: a file outside MEDIA_ROOT was accepted and would be served to the ' +
      'client. This is the CRIT-003/004 arbitrary-file-read vulnerability.'
  );
});

// --- Test 2: pin the FIX contract (shared confinement guard) ---------------------
test('CRIT-003/004: secure-media-path guard confines requests to MEDIA_ROOT', () => {
  let resolveMediaPath;
  try {
    ({ resolveMediaPath } = require('../../lib/secure-media-path'));
  } catch (e) {
    assert.fail(
      'No confinement guard exists yet: lib/secure-media-path.js is missing. ' +
        'Expected resolveMediaPath(mediaRoot, requested) -> absolute path or null. ' +
        `(${e.message})`
    );
  }

  // Legitimate in-root request resolves.
  const ok = resolveMediaPath(MEDIA_ROOT, insideVideo);
  assert.ok(ok && fs.existsSync(ok), 'in-root video should resolve to a real path');

  // Out-of-root absolute path is rejected.
  assert.strictEqual(
    resolveMediaPath(MEDIA_ROOT, outsideSecret),
    null,
    'out-of-root absolute path must be rejected'
  );

  // Traversal escape is rejected.
  assert.strictEqual(
    resolveMediaPath(MEDIA_ROOT, path.join(MEDIA_ROOT, '..', 'secret.mp4')),
    null,
    'path-traversal escape (..) must be rejected'
  );
});
