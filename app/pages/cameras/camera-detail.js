import { api } from '../../core/api.js';
                (function () {
                    'use strict';

                    // Get camera ID from URL - handle both SPA navigation and direct navigation
                    async function getCameraId() {
                        // In SPA mode the browser URL is always index.html — read from history state
                        const stateUrl = window.history.state && window.history.state.url ? window.history.state.url : window.location.href;
                        let params = new URLSearchParams(new URL(stateUrl, window.location.origin).search);
                        let camId = params.get('camera');

                        if (!camId) {
                            for (let i = 0; i < 10; i++) {
                                await new Promise(resolve => setTimeout(resolve, 50));
                                const su = window.history.state && window.history.state.url ? window.history.state.url : window.location.href;
                                params = new URLSearchParams(new URL(su, window.location.origin).search);
                                camId = params.get('camera');
                                if (camId) break;

                                // Also check history state (legacy fallback)
                                if (window.history.state && window.history.state.url) {
                                    try {
                                        const url = new URL(window.history.state.url, window.location.origin);
                                        camId = url.searchParams.get('camera');
                                        if (camId) break;
                                    } catch (e) {
                                        // ignore
                                    }
                                }
                            }
                        }
                        
                        // If still not found, try parsing the current pathname (fallback)
                        if (!camId) {
                            const match = window.location.pathname.match(/camera-detail\.html\?camera=([^&]+)/);
                            if (match) {
                                camId = decodeURIComponent(match[1]);
                            }
                        }
                        
                        // Last resort: check if URL was stored by layout-loader
                        if (!camId && window.__visionaiCurrentUrl) {
                            try {
                                const url = new URL(window.__visionaiCurrentUrl, window.location.origin);
                                camId = url.searchParams.get('camera');
                            } catch (e) {
                                // ignore
                            }
                        }
                        
                        return camId;
                    }

                    // DOM element references — re-queried on every init() so SPA navigation works
                    let titleEl, headerEl, idBadge, videoEl, containerEl, shellEl, statusReasonEl;
                    let statusDot, statusText, overlayBadge, streamTypeIcon;
                    let switchToCameraBtn, overlayCanvas, agentFramesEl;
                    let btnSidebar, listEl, searchEl;
                    let visContainer, zoomInBtn, zoomOutBtn, zoomLabel;
                    let popupEl, popupImg, popupTitle, popupTime, popupAgent, popupSev;

                    function queryDomRefs() {
                        titleEl           = document.getElementById('camera-title');
                        headerEl          = document.getElementById('camera-header-name');
                        idBadge           = document.getElementById('camera-id-badge');
                        videoEl           = document.getElementById('camera-video');
                        containerEl       = videoEl?.closest('.visionai-video-stage');
                        shellEl           = document.getElementById('camera-detail-shell');
                        statusDot         = document.getElementById('camera-status-dot');
                        statusText        = document.getElementById('camera-status-text');
                        statusReasonEl    = document.getElementById('camera-status-reason');
                        overlayBadge      = document.getElementById('camera-overlay-badge');
                        streamTypeIcon    = document.getElementById('stream-type-icon');
                        switchToCameraBtn = document.getElementById('switch-to-camera-btn');
                        overlayCanvas     = document.getElementById('agent-overlay-canvas');
                        agentFramesEl     = document.getElementById('camera-agent-frames');
                        btnSidebar        = document.getElementById('toggle-agent-sidebar');
                        listEl            = document.getElementById('agent-list');
                        searchEl          = document.getElementById('agent-search');
                        visContainer      = document.getElementById('cctv-vis');
                        zoomInBtn         = document.getElementById('cctv-zoom-in');
                        zoomOutBtn        = document.getElementById('cctv-zoom-out');
                        zoomLabel         = document.getElementById('cctv-zoom-label');
                        popupEl           = document.getElementById('cctv-event-popup');
                        popupImg          = document.getElementById('cctv-event-popup-img');
                        popupTitle        = document.getElementById('cctv-event-popup-title');
                        popupTime         = document.getElementById('cctv-event-popup-time');
                        popupAgent        = document.getElementById('cctv-event-popup-agent');
                        popupSev          = document.getElementById('cctv-event-popup-sev');
                    }

                    // Initialize camera with async camera ID retrieval
                    async function init() {
                        console.log('[CameraDetail] init() called');

                        // Re-register cleanup hook every time — the router nulls it out after calling it,
                        // so without this the WebSocket stays open after the first navigation away.
                        window.__visionaiPageCleanup = () => {
                            // Disconnect lazy-load observer so it doesn't fire after navigation
                            if (_widgetObserver) { _widgetObserver.disconnect(); _widgetObserver = null; }
                            try {
                                if (livePlayer && typeof livePlayer.destroy === 'function') {
                                    livePlayer.destroy();
                                }
                            } catch {
                                // ignore
                            }
                            livePlayer = null;
                            try { overlayWs?.close?.(); } catch {}
                            overlayWs = null;
                        };

                        // Reset module-level state so re-navigation starts clean
                        if (livePlayer && typeof livePlayer.destroy === 'function') {
                            try { livePlayer.destroy(); } catch {}
                        }
                        livePlayer = null;
                        cameraData = null;
                        currentCameraId = null;
                        selectedAgentId = null;
                        try { overlayWs?.close?.(); } catch {}
                        overlayWs = null;
                        overlayLastFrameIndex = null;
                        overlayLastTimestamp = null;
                        if (overlayStalenessCheckInterval) {
                            clearInterval(overlayStalenessCheckInterval);
                            overlayStalenessCheckInterval = null;
                        }

                        // Re-query DOM every time — the SPA router replaces page content on navigation
                        queryDomRefs();
                        bindUiEvents();

                        const camId = await getCameraId();
                        console.log('[CameraDetail] getCameraId() returned:', camId);

                        if (!camId) {
                            console.error('No camera ID provided. URL:', window.location.href);
                            console.error('Search params:', window.location.search);
                            console.error('History state:', window.history.state);
                            if (statusText) statusText.textContent = 'No camera ID';
                            return;
                        }

                        console.log('Camera ID from URL:', camId);

                        // Store camId for use by initCamera
                        currentCameraId = camId;
                        // Expose camera context to chatbot (for agent chat / zone drawing)
                        try {
                            window.__visionaiActiveCameraId = camId;
                            localStorage.setItem('vision_active_camera_id', camId);
                        } catch (_) {
                            // ignore
                        }

                        // Now initialize camera
                        await initCamera();
                    }

                    // Store original canvas parent for restoring after fullscreen
                    let originalCanvasParent = null;
                    let originalCanvasNextSibling = null;

                    let livePlayer = null;
                    let cameraData = null;
                    let isUserSeeking = false;
                    let currentCameraId = null;
                    let selectedAgentId = null;
                    let eventsWidgetInstance = null;
                    let agentsWidgetInstance = null;
                    let overlayWs = null;
                    let overlayLastFrameIndex = null;
                    let overlayLastTimestamp = null;  // Track latest overlay timestamp for staleness check
                    let overlayStalenessCheckInterval = null;  // Interval to check for stale overlays

                    /**
                     * Shared onState handler for fMP4 player (live and agent processed stream).
                     * Reused so we don't duplicate status/UI logic.
                     */
                    function setStreamStatus(dotState, label) {
                        if (statusDot) {
                            statusDot.classList.remove('is-live', 'is-error', 'is-loading', 'text-warning', 'text-success', 'text-danger');
                            if (dotState) statusDot.classList.add(dotState);
                        }
                        if (statusText) {
                            statusText.textContent = label;
                        }
                    }

                    function setStatusReason(message) {
                        if (!statusReasonEl) return;
                        const text = String(message || '').trim();
                        if (!text) {
                            statusReasonEl.textContent = '';
                            statusReasonEl.classList.add('d-none');
                            return;
                        }
                        statusReasonEl.textContent = text;
                        statusReasonEl.classList.remove('d-none');
                    }

                    function createFmp4PlayerOnStateHandler() {
                        // Track whether the stream has produced its first frame.
                        // If it hasn't after CONNECT_TIMEOUT_MS from ws-open, treat
                        // the camera as offline rather than leaving the badge stuck on
                        // "Starting…" forever.
                        const CONNECT_TIMEOUT_MS = 12000;
                        let connectTimeoutId = null;
                        let streamStarted = false;

                        function clearConnectTimeout() {
                            if (connectTimeoutId) { clearTimeout(connectTimeoutId); connectTimeoutId = null; }
                        }

                        return (ev) => {
                            if (!ev || !ev.state) return;
                            console.log(`[CameraDetail] player state: ${ev.state}`, ev);
                            if (ev.state === 'connecting') {
                                setStreamStatus('is-loading', 'Connecting…');
                                return;
                            }
                            if (ev.state === 'mse-ready') {
                                try {
                                    if (videoEl && videoEl.paused) videoEl.play().catch((e) => console.warn('[CameraDetail] video.play() on mse-ready rejected:', e));
                                } catch (e) {}
                                return;
                            }
                            if (ev.state === 'ws-open') {
                                setStreamStatus('is-loading', 'Starting…');
                                // Arm timeout: if first-append never fires, camera is offline
                                clearConnectTimeout();
                                connectTimeoutId = setTimeout(() => {
                                    if (!streamStarted) {
                                        console.warn('[CameraDetail] Stream timeout — camera appears offline');
                                        setStreamStatus('is-error', 'Offline');
                                        setStatusReason(cameraData?.status_reason || 'Camera is offline or unreachable.');
                                    }
                                }, CONNECT_TIMEOUT_MS);
                                return;
                            }
                            if (ev.state === 'first-append') {
                                clearConnectTimeout();
                                streamStarted = true;
                                setStreamStatus('is-live', 'Live');
                                setStatusReason('');
                                try {
                                    if (videoEl) videoEl.play().catch((e) => console.warn('[CameraDetail] video.play() rejected:', e));
                                } catch (e) {}
                                return;
                            }
                            if (ev.state === 'stalled') {
                                // Only show "Stalled" if the stream never produced a
                                // frame — once live, a stall event means a temporary
                                // gap in WebSocket data (e.g. low-motion scene). The
                                // video is still playing so keep the Live badge.
                                if (!streamStarted) {
                                    setStreamStatus('is-loading', 'Stalled…');
                                }
                                return;
                            }
                            if (ev.state === 'error') {
                                clearConnectTimeout();
                                console.error('[CameraDetail] stream error:', ev.error);
                                setStreamStatus('is-error', 'Offline');
                                setStatusReason(cameraData?.status_reason || 'Camera is offline or unreachable.');
                                return;
                            }
                            if (ev.state === 'append-error') {
                                clearConnectTimeout();
                                console.error('[CameraDetail] append error (codec mismatch?):', ev.error);
                                setStreamStatus('is-error', 'Stream error');
                                setStatusReason(cameraData?.status_reason || 'Stream error while loading camera.');
                                return;
                            }
                        };
                    }

                    /**
                     * Agent frame player: WebSocket receives JPEG frames, display on img. No fMP4/MSE — continuous stream.
                     */
                    function createAgentFramePlayer(opts) {
                        const { imgEl, videoEl, wsUrl, onState } = opts || {};
                        if (!imgEl || !videoEl || !wsUrl) return null;
                        let destroyed = false;
                        let ws = null;
                        let lastUrl = null;

                        const emit = (state) => {
                            try {
                                if (typeof onState === 'function') onState({ state });
                            } catch (_) {}
                        };

                        const cleanup = () => {
                            try {
                                if (ws) ws.close();
                            } catch (_) {}
                            ws = null;
                            if (lastUrl) {
                                try { URL.revokeObjectURL(lastUrl); } catch (_) {}
                                lastUrl = null;
                            }
                            imgEl.style.display = 'none';
                            imgEl.removeAttribute('src');
                            videoEl.style.display = '';
                        };

                        emit('connecting');
                        ws = new WebSocket(wsUrl);
                        ws.binaryType = 'arraybuffer';
                        ws.onopen = () => {
                            if (destroyed) return;
                            videoEl.style.display = 'none';
                            imgEl.style.display = '';
                            emit('ws-open');
                            emit('first-append');
                        };
                        ws.onmessage = (evt) => {
                            if (destroyed || !evt.data) return;
                            if (lastUrl) URL.revokeObjectURL(lastUrl);
                            lastUrl = URL.createObjectURL(new Blob([evt.data], { type: 'image/jpeg' }));
                            imgEl.src = lastUrl;
                        };
                        ws.onerror = () => emit('error');
                        ws.onclose = () => { emit('closed'); };

                        return {
                            destroy() {
                                if (destroyed) return;
                                destroyed = true;
                                cleanup();
                            }
                        };
                    }

                    function loadScriptOnce(src, attrName = 'data-visionai') {
                        return new Promise((resolve, reject) => {
                            if (document.querySelector(`script[${attrName}="true"][src="${src}"]`)) return resolve();
                            // Also check the shared wsfmp4 key used by dashboard
                            if (attrName === 'data-wsfmp4' && document.querySelector(`script[data-wsfmp4="true"][src="${src}"]`)) return resolve();
                            const s = document.createElement('script');
                            s.src = src;
                            s.onload = resolve;
                            s.onerror = reject;
                            s.setAttribute(attrName, 'true');
                            document.head.appendChild(s);
                        });
                    }

                    // Wait for dependencies to be ready
                    async function waitForDependencies() {
                        let attempts = 0;
                        const maxAttempts = 50;
                        
                        while (attempts < maxAttempts) {
                            if (api && api.isAuthenticated && api.isAuthenticated() && window.createWsFmp4Player) {
                                return true;
                            }
                            // Ensure WS fMP4 player helper is loaded
                            if (!window.createWsFmp4Player) {
                                try {
                                    await loadScriptOnce('/app/utils/ws-fmp4-player.js', 'data-wsfmp4');
                                } catch (e) {
                                    // keep retrying
                                }
                            }
                            await new Promise(resolve => setTimeout(resolve, 100));
                            attempts++;
                        }
                        
                        return false;
                    }

                    // Load camera data and initialize live player
                    async function initCamera() {
                        // Use the stored camera ID
                        const camId = currentCameraId;
                        if (!camId) {
                            console.error('Camera ID not available');
                            statusText.textContent = 'No camera ID';
                            return;
                        }
                        try {
                            // Wait for dependencies
                            const depsReady = await waitForDependencies();
                            if (!depsReady) {
                                console.error('Dependencies not ready');
                                statusText.textContent = 'Loading dependencies...';
                                return;
                            }

                            // Get camera details from API
                            try {
                                cameraData = await api.getCamera(camId);
                                titleEl.textContent = cameraData.name || camId;
                                if (headerEl) headerEl.textContent = cameraData.name || camId;
                                idBadge.textContent = camId;

                                // Show last-known status immediately so the badge
                                // never stays on "Connecting…" for an offline camera.
                                const knownStatus = (cameraData.status || 'unknown').toLowerCase();
                                if (knownStatus === 'offline') {
                                    setStreamStatus('is-error', 'Offline');
                                    setStatusReason(cameraData.status_reason || 'Camera is offline.');
                                } else if (knownStatus === 'reconnecting' || knownStatus === 'error') {
                                    setStreamStatus('is-loading', 'Reconnecting…');
                                    setStatusReason(cameraData.status_reason || 'Trying to reconnect camera stream.');
                                } else if (knownStatus === 'live') {
                                    setStreamStatus('is-loading', 'Connecting…');
                                    setStatusReason('');
                                } else {
                                    setStatusReason('');
                                }
                            } catch (error) {
                                console.warn('Error fetching camera data:', error);
                                titleEl.textContent = camId;
                                if (headerEl) headerEl.textContent = camId;
                                idBadge.textContent = camId;
                                setStatusReason('');
                            }

                            // Initialize live player (WS fMP4 -> MSE)
                            await initLivePlayer();

                            // Load agents list for this camera
                            await loadAgentsForCamera();

                            // Load workflows for this camera (separate section)
                            bindWorkflowTabs();
                            await loadWorkflowsForCamera();

                            // Mount Events & Agents widgets lazily — only when the section scrolls into view
                            lazyMountCameraWidgets(camId);
                        } catch (error) {
                            console.error('Error initializing camera:', error);
                            setStreamStatus('is-error', 'Error: ' + (error.message || 'Failed to load'));
                        }
                    }

                    async function initLivePlayer() {
                        // Use the stored camera ID
                        const camId = currentCameraId;
                        console.log(`[CameraDetail] initLivePlayer() — camId="${camId}"`);

                        if (!camId) {
                            console.error('[CameraDetail] initLivePlayer: camera ID not available');
                            return;
                        }

                        if (!api || !api.isAuthenticated || !api.isAuthenticated()) {
                            console.error('[CameraDetail] initLivePlayer: not authenticated');
                            setStreamStatus('is-error', 'Please login');
                            return;
                        }

                        if (!window.createWsFmp4Player) {
                            console.error('[CameraDetail] initLivePlayer: createWsFmp4Player not loaded');
                            setStreamStatus('is-error', 'Player missing');
                            return;
                        }

                        // Ensure video element is ready
                        if (!videoEl) {
                            console.error('[CameraDetail] initLivePlayer: #camera-video element not found in DOM');
                            statusText.textContent = 'Video element not found';
                            return;
                        }

                        // Destroy existing player if any
                        if (livePlayer && typeof livePlayer.destroy === 'function') {
                            console.log('[CameraDetail] Destroying existing live player before reinit');
                            livePlayer.destroy();
                            livePlayer = null;
                        }

                        let wsUrl = null;
                        try {
                            // Camera stream from vision backend (always on)
                            wsUrl = api.getLiveWsURL(camId);
                            console.log(`[CameraDetail] Live stream WS URL: ${wsUrl}`);
                        } catch (e) {
                            console.error('[CameraDetail] initLivePlayer: failed to get WS URL:', e);
                            setStreamStatus('is-error', 'Auth error');
                            return;
                        }

                        const mimeCodec = api.getLiveMimeCodec();

                        setStreamStatus('is-loading', 'Connecting…');

                        // Base header (overlay will adjust badge text)
                        if (headerEl) headerEl.textContent = cameraData?.name || camId || 'Live Camera';
                        if (streamTypeIcon) {
                            streamTypeIcon.setAttribute('class', 'fa-solid fa-video fs-9 text-primary');
                        }
                        if (overlayBadge) {
                            overlayBadge.innerHTML = '<span class="fa-solid fa-eye me-1"></span>Live preview';
                        }
                        if (switchToCameraBtn) {
                            switchToCameraBtn.classList.add('d-none');
                        }

                        livePlayer = window.createWsFmp4Player({
                            videoEl,
                            wsUrl,
                            mimeCodec,
                            bufferSeconds: 10,
                            onState: createFmp4PlayerOnStateHandler()
                        });

                        // Sync video position with timeline
                        // NOTE: Timeline-to-video sync is not implemented yet (timeline is an evidence/event UI only).
                        // Keep these hooks guarded to avoid breaking the page.
                        function updateTimelineFromVideo() {
                            // future: map videoEl.currentTime to a timeline playhead
                        }
                        videoEl.addEventListener('timeupdate', () => {
                            if (!isUserSeeking && videoEl.buffered.length > 0) {
                                if (typeof updateTimelineFromVideo === 'function') updateTimelineFromVideo();
                            }
                        });

                        // Handle user seeking in video controls
                        videoEl.addEventListener('seeked', () => {
                            isUserSeeking = false;
                            if (typeof updateTimelineFromVideo === 'function') updateTimelineFromVideo();
                        });
                    }

                    // Function to switch to agent stream
                    function clearOverlayCanvas() {
                        if (!overlayCanvas) return;
                        try {
                            const ctx = overlayCanvas.getContext('2d');
                            if (ctx) ctx.clearRect(0, 0, overlayCanvas.width || 0, overlayCanvas.height || 0);
                        } catch {}
                    }

                    function closeOverlayWs() {
                        try { overlayWs?.close?.(); } catch {}
                        overlayWs = null;
                        overlayLastFrameIndex = null;
                        overlayLastTimestamp = null;
                        if (overlayStalenessCheckInterval) {
                            clearInterval(overlayStalenessCheckInterval);
                            overlayStalenessCheckInterval = null;
                        }
                    }

                    function resizeOverlayCanvasToVideo() {
                        if (!overlayCanvas || !videoEl) return;
                        
                        // Always use video element's actual displayed dimensions
                        // This works correctly in both normal and fullscreen modes
                        // (getBoundingClientRect gives actual displayed size even in fullscreen)
                        const rect = videoEl.getBoundingClientRect();
                        const dpr = window.devicePixelRatio || 1;
                        const w = Math.max(1, Math.round(rect.width * dpr));
                        const h = Math.max(1, Math.round(rect.height * dpr));
                        if (overlayCanvas.width !== w) overlayCanvas.width = w;
                        if (overlayCanvas.height !== h) overlayCanvas.height = h;
                    }

                    function drawOverlay(payload) {
                        if (!overlayCanvas || !videoEl) return;
                        if (!payload || payload.type !== 'agent_overlay') return;

                        // Store the last payload for redrawing on fullscreen changes
                        window.__visionaiLastOverlayPayload = payload;

                        resizeOverlayCanvasToVideo();
                        const ctx = overlayCanvas.getContext('2d');
                        if (!ctx) return;

                        // Always use video element's actual displayed dimensions
                        // This works correctly in both normal and fullscreen modes
                        const rect = videoEl.getBoundingClientRect();
                        const dpr = window.devicePixelRatio || 1;
                        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
                        ctx.clearRect(0, 0, rect.width, rect.height);

                        const srcW = Number(payload.width || 0);
                        const srcH = Number(payload.height || 0);
                        if (!srcW || !srcH) return;

                        const scaleX = rect.width / srcW;
                        const scaleY = rect.height / srcH;

                        // Draw zones (polygons and lines) first (if present)
                        let zones = Array.isArray(payload.zones) ? payload.zones : [];
                        // Fallback to single zone for backward compatibility
                        if (zones.length === 0 && payload.zone) {
                            zones.push(payload.zone);
                        }
                        const zoneViolated = payload.zone_violated || false;
                        
                        // Draw each zone
                        for (const zone of zones) {
                            if (!zone || !zone.coordinates || !Array.isArray(zone.coordinates)) continue;
                            
                            const coords = zone.coordinates;
                            const zoneType = (zone.type || 'polygon').toLowerCase();
                            
                            if (zoneType === 'polygon' && coords.length >= 3) {
                                // Draw polygon zone (restricted zone)
                                // Color changes based on violation: red when violated, green when safe
                                const fillColor = zoneViolated ? 'rgba(255, 0, 0, 0.25)' : 'rgba(0, 255, 0, 0.08)';
                                const strokeColor = zoneViolated ? 'rgba(255, 0, 0, 0.9)' : 'rgba(0, 255, 0, 0.6)';
                                const lineWidth = zoneViolated ? 4 : 2;
                                
                                ctx.beginPath();
                                coords.forEach((point, i) => {
                                    if (Array.isArray(point) && point.length >= 2) {
                                        const x = point[0] * srcW * scaleX;
                                        const y = point[1] * srcH * scaleY;
                                        if (i === 0) {
                                            ctx.moveTo(x, y);
                                        } else {
                                            ctx.lineTo(x, y);
                                        }
                                    }
                                });
                                ctx.closePath();
                                ctx.fillStyle = fillColor;
                                ctx.fill();
                                ctx.lineWidth = lineWidth;
                                ctx.strokeStyle = strokeColor;
                                ctx.stroke();
                                
                                // Add "VIOLATION!" text when zone is violated
                                if (zoneViolated && coords.length > 0) {
                                    // Calculate center of polygon for label placement
                                    let centerX = 0, centerY = 0;
                                    coords.forEach(point => {
                                        if (Array.isArray(point) && point.length >= 2) {
                                            centerX += point[0] * srcW * scaleX;
                                            centerY += point[1] * srcH * scaleY;
                                        }
                                    });
                                    centerX /= coords.length;
                                    centerY /= coords.length;
                                    
                                    // Draw violation text
                                    ctx.font = 'bold 16px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
                                    ctx.fillStyle = 'rgba(255, 0, 0, 1)';
                                    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
                                    ctx.lineWidth = 3;
                                    const text = '⚠ VIOLATION!';
                                    const textMetrics = ctx.measureText(text);
                                    const textX = centerX - textMetrics.width / 2;
                                    const textY = centerY;
                                    ctx.strokeText(text, textX, textY);
                                    ctx.fillText(text, textX, textY);
                                }
                            } else if (zoneType === 'line' && coords.length === 2) {
                                // Draw counting line
                                const p1 = coords[0];
                                const p2 = coords[1];
                                if (Array.isArray(p1) && Array.isArray(p2) && p1.length >= 2 && p2.length >= 2) {
                                    ctx.beginPath();
                                    ctx.moveTo(p1[0] * srcW * scaleX, p1[1] * srcH * scaleY);
                                    ctx.lineTo(p2[0] * srcW * scaleX, p2[1] * srcH * scaleY);
                                    ctx.lineWidth = 4;
                                    ctx.strokeStyle = 'rgba(255, 165, 0, 0.9)';
                                    ctx.stroke();
                                    
                                    // Draw endpoints
                                    ctx.fillStyle = 'rgba(255, 165, 0, 1)';
                                    ctx.beginPath();
                                    ctx.arc(p1[0] * srcW * scaleX, p1[1] * srcH * scaleY, 6, 0, Math.PI * 2);
                                    ctx.fill();
                                    ctx.beginPath();
                                    ctx.arc(p2[0] * srcW * scaleX, p2[1] * srcH * scaleY, 6, 0, Math.PI * 2);
                                    ctx.fill();
                                }
                            }
                        }

                        // Draw detection boxes (if present)
                        if (payload.detections) {
                            const det = payload.detections || {};
                            const boxes = Array.isArray(det.boxes) ? det.boxes : [];
                            const classes = Array.isArray(det.classes) ? det.classes : [];
                            const scores = Array.isArray(det.scores) ? det.scores : [];
                            
                            // Get line crossing and restricted-zone information
                            const line_crossed_indices = Array.isArray(payload.line_crossed_indices) ? payload.line_crossed_indices : [];
                            const line_crossed = payload.line_crossed || false;
                            const zone_violated = payload.zone_violated || false;
                            const fire_detected = payload.fire_detected || false;
                            const track_info = Array.isArray(payload.track_info) ? payload.track_info : [];
                            const in_zone_indices = Array.isArray(payload.in_zone_indices) ? payload.in_zone_indices : [];
                            const inZoneSet = new Set(in_zone_indices);
                            const sleep_confirmed_indices = Array.isArray(payload.sleep_confirmed_indices) ? payload.sleep_confirmed_indices : [];
                            const sleepConfirmedSet = new Set(sleep_confirmed_indices);
                            const wall_climb_red_indices = Array.isArray(payload.wall_climb_red_indices) ? payload.wall_climb_red_indices : [];
                            const wall_climb_orange_indices = Array.isArray(payload.wall_climb_orange_indices) ? payload.wall_climb_orange_indices : [];
                            const wallClimbRedSet = new Set(wall_climb_red_indices);
                            const wallClimbOrangeSet = new Set(wall_climb_orange_indices);
                            
                            ctx.lineWidth = 2;
                            ctx.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';

                            // Create a map of detection index to track info for quick lookup
                            // Use IoU (Intersection over Union) for better matching
                            const detectionToTrackMap = new Map();
                            for (const track of track_info) {
                                if (track.bbox && Array.isArray(track.bbox) && track.bbox.length >= 4) {
                                    let bestMatchIdx = -1;
                                    let bestIoU = 0;
                                    
                                    // Find best matching detection by IoU
                                    for (let i = 0; i < boxes.length; i++) {
                                        const detBox = boxes[i];
                                        if (!Array.isArray(detBox) || detBox.length < 4) continue;
                                        
                                        // Calculate IoU
                                        const trackBox = track.bbox;
                                        const overlapLeft = Math.max(trackBox[0], detBox[0]);
                                        const overlapTop = Math.max(trackBox[1], detBox[1]);
                                        const overlapRight = Math.min(trackBox[2], detBox[2]);
                                        const overlapBottom = Math.min(trackBox[3], detBox[3]);
                                        
                                        if (overlapRight > overlapLeft && overlapBottom > overlapTop) {
                                            const intersection = (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
                                            const trackArea = (trackBox[2] - trackBox[0]) * (trackBox[3] - trackBox[1]);
                                            const detArea = (detBox[2] - detBox[0]) * (detBox[3] - detBox[1]);
                                            const union = trackArea + detArea - intersection;
                                            
                                            if (union > 0) {
                                                const iou = intersection / union;
                                                if (iou > bestIoU && iou >= 0.3) {
                                                    bestIoU = iou;
                                                    bestMatchIdx = i;
                                                }
                                            }
                                        }
                                    }
                                    
                                    if (bestMatchIdx >= 0 && !detectionToTrackMap.has(bestMatchIdx)) {
                                        detectionToTrackMap.set(bestMatchIdx, track);
                                    }
                                }
                            }

                            // Draw center points for all tracks in GREEN (always visible)
                            let centerPointsDrawn = 0;
                            for (const track of track_info) {
                                if (track.center && Array.isArray(track.center) && track.center.length >= 2) {
                                    // Backend sends center in absolute pixel coordinates (not percentages)
                                    // So we need to scale them to match video display size
                                    const centerX = track.center[0] * scaleX;
                                    const centerY = track.center[1] * scaleY;
                                    
                                    // Always draw center point in GREEN (larger and more visible)
                                    ctx.beginPath();
                                    ctx.arc(centerX, centerY, 8, 0, 2 * Math.PI);  // Increased radius from 6 to 8
                                    ctx.fillStyle = 'rgba(0, 255, 0, 1.0)';  // Green for all center points
                                    ctx.fill();
                                    ctx.strokeStyle = 'rgba(255, 255, 255, 1.0)';
                                    ctx.lineWidth = 3;  // Increased from 2 to 3
                                    ctx.stroke();
                                    
                                    // Draw track ID near center point
                                    if (track.track_id !== undefined) {
                                        ctx.fillStyle = 'rgba(255, 255, 255, 1.0)';
                                        ctx.font = 'bold 12px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';  // Made bold and larger
                                        ctx.fillText(`ID:${track.track_id}`, centerX + 10, centerY - 8);
                                    }
                                    
                                    centerPointsDrawn++;
                                }
                            }

                            // Get detection colors from payload (yellow when touching, green otherwise)
                            const detectionColors = Array.isArray(det.colors) ? det.colors : [];
                            
                            for (let i = 0; i < boxes.length; i++) {
                                const b = boxes[i];
                                if (!Array.isArray(b) || b.length < 4) continue;
                                const x1 = Number(b[0]), y1 = Number(b[1]), x2 = Number(b[2]), y2 = Number(b[3]);
                                if (!Number.isFinite(x1 + y1 + x2 + y2)) continue;

                                const dx = x1 * scaleX;
                                const dy = y1 * scaleY;
                                const dw = Math.max(0, (x2 - x1) * scaleX);
                                const dh = Math.max(0, (y2 - y1) * scaleY);
                                
                                // Get track info for this detection
                                const track = detectionToTrackMap.get(i);
                                const isCounted = track && track.counted === true;
                                const crossDirection = track ? track.direction : null;
                                
                                // Determine box color based on detection type:
                                // - RED: Fire detected or zone violation (safety-critical)
                                // - ORANGE: Crossed Side 2 → Side 1 (entry/ADD direction)
                                // - YELLOW: Crossed Side 1 → Side 2 (exit/OUT direction)
                                // - GREEN: Normal detection (not crossed yet)
                                let boxColor, fillColor;
                                
                                // Check if this is a fire-related class (use class name so red works even if payload lags)
                                const clsLower = String(classes[i] || '').toLowerCase();
                                const isFireClass = clsLower.includes('fire') || clsLower.includes('flame') || clsLower.includes('smoke');
                                
                                if (isFireClass || (fire_detected && isFireClass)) {
                                    // RED for fire detection (safety-critical, highest priority)
                                    // Use class name so fire boxes are always red when agent is fire detection
                                    boxColor = 'rgba(255, 0, 0, 0.95)';
                                    fillColor = 'rgba(255, 0, 0, 0.35)';
                                } else if (sleepConfirmedSet.size > 0 && sleepConfirmedSet.has(i)) {
                                    // RED when sleep confirmed by VLM (same person box, just change color)
                                    boxColor = 'rgba(255, 0, 0, 0.95)';
                                    fillColor = 'rgba(255, 0, 0, 0.35)';
                                } else if (inZoneSet.size > 0 && inZoneSet.has(i)) {
                                    // Restricted zone: red only for detections inside the zone (per-box coloring)
                                    boxColor = 'rgba(255, 0, 0, 0.95)';
                                    fillColor = 'rgba(255, 0, 0, 0.3)';
                                } else if (wallClimbRedSet.size > 0 && wallClimbRedSet.has(i)) {
                                    // Wall climb: red when person is fully above wall (stays red)
                                    boxColor = 'rgba(255, 0, 0, 0.95)';
                                    fillColor = 'rgba(255, 0, 0, 0.3)';
                                } else if (wallClimbOrangeSet.size > 0 && wallClimbOrangeSet.has(i)) {
                                    // Wall climb: orange when person is climbing (part above wall)
                                    boxColor = 'rgba(255, 165, 0, 0.95)';
                                    fillColor = 'rgba(255, 165, 0, 0.3)';
                                } else if (isCounted && crossDirection === 'entry') {
                                    // ORANGE when crossed from Side 2 → Side 1 (ADD)
                                    boxColor = 'rgba(255, 165, 0, 0.95)';
                                    fillColor = 'rgba(255, 165, 0, 0.3)';
                                } else if (isCounted && crossDirection === 'exit') {
                                    // YELLOW when crossed from Side 1 → Side 2 (OUT)
                                    boxColor = 'rgba(255, 255, 0, 0.95)';
                                    fillColor = 'rgba(255, 255, 0, 0.3)';
                                } else {
                                    // GREEN for normal detection (not crossed yet)
                                    boxColor = 'rgba(0, 255, 0, 0.95)';
                                    fillColor = 'rgba(0, 255, 0, 0.2)';
                                }
                                
                                ctx.strokeStyle = boxColor;
                                ctx.fillStyle = fillColor;
                                ctx.lineWidth = 3;
                                ctx.strokeRect(dx, dy, dw, dh);
                                ctx.fillRect(dx, dy, dw, dh);

                                const cls = String(classes[i] || '');
                                const sc = Number(scores[i] || 0);
                                let label = cls ? `${cls}${Number.isFinite(sc) && sc ? ` ${(sc).toFixed(2)}` : ''}` : '';
                                
                                // Add special labels based on detection type
                                let labelColor = 'rgba(255, 255, 255, 1.0)'; // Default white
                                
                                if (sleepConfirmedSet.size > 0 && sleepConfirmedSet.has(i)) {
                                    label = label ? `${label} CONFIRMED` : 'CONFIRMED';
                                    labelColor = 'rgba(255, 80, 80, 1.0)';
                                }
                                if (isFireClass) {
                                    // RED label with fire indicator (any fire/flame/smoke class)
                                    label = `🔥 FIRE! ${Number.isFinite(sc) ? (sc).toFixed(2) : ''}`.trim();
                                    labelColor = 'rgba(255, 50, 50, 1.0)'; // Bright red text
                                } else if (isCounted && crossDirection === 'entry') {
                                    // Add direction label when crossed
                                    // - ORANGE text for ADD (Side 2 → Side 1)
                                    label = label ? `ADD! ${label}` : 'ADD!';
                                    labelColor = 'rgba(255, 165, 0, 1.0)'; // Orange text
                                } else if (isCounted && crossDirection === 'exit') {
                                    // - YELLOW text for OUT (Side 1 → Side 2)
                                    label = label ? `OUT! ${label}` : 'OUT!';
                                    labelColor = 'rgba(255, 255, 0, 1.0)'; // Yellow text
                                }
                                
                                if (label) {
                                    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                                    ctx.fillRect(dx, dy - 18, label.length * 7, 16);
                                    ctx.fillStyle = labelColor;
                                    ctx.font = '11px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
                                    const tx = dx + 4;
                                    const ty = Math.max(14, dy - 6);
                                    ctx.fillText(label, tx, ty);
                                }
                            }

                            // Draw pose keypoints and skeleton (weapon_detection / fall_detection / any pose scenario)
                            const keypointsList = Array.isArray(det.keypoints) ? det.keypoints : [];
                            if (keypointsList.length > 0) {
                                const POSE_SKELETON = [[0,1],[0,2],[1,3],[2,4],[5,6],[5,7],[7,9],[6,8],[8,10],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16]];
                                const minConf = 0.25;
                                const pointColor = 'rgba(255, 255, 0, 1.0)';
                                const skeletonColor = 'rgba(0, 255, 0, 1.0)';
                                const pointRadius = 3;
                                const skeletonThickness = 2;
                                for (const personKps of keypointsList) {
                                    if (!personKps || !Array.isArray(personKps)) continue;
                                    const kps = [];
                                    for (const pt of personKps) {
                                        if (!pt || pt.length < 2) { kps.push(null); continue; }
                                        const x = Number(pt[0]), y = Number(pt[1]);
                                        const conf = pt.length >= 3 ? Number(pt[2]) : 1.0;
                                        if (!Number.isFinite(x + y) || conf < minConf) { kps.push(null); continue; }
                                        kps.push({ x: x * scaleX, y: y * scaleY });
                                    }
                                    for (let i = 0; i < kps.length; i++) {
                                        const pt = kps[i];
                                        if (pt) {
                                            ctx.beginPath();
                                            ctx.arc(pt.x, pt.y, pointRadius, 0, Math.PI * 2);
                                            ctx.fillStyle = pointColor;
                                            ctx.fill();
                                        }
                                    }
                                    for (const [i, j] of POSE_SKELETON) {
                                        if (i >= kps.length || j >= kps.length) continue;
                                        const a = kps[i], b = kps[j];
                                        if (a && b) {
                                            ctx.beginPath();
                                            ctx.moveTo(a.x, a.y);
                                            ctx.lineTo(b.x, b.y);
                                            ctx.strokeStyle = skeletonColor;
                                            ctx.lineWidth = skeletonThickness;
                                            ctx.stroke();
                                        }
                                    }
                                }
                            }
                            
                            // Show alert in console when line is crossed
                            if (line_crossed && line_crossed_indices.length > 0) {
                                console.warn('🚨 [LINE CROSSING]', {
                                    count: line_crossed_indices.length,
                                    indices: line_crossed_indices,
                                    frame_index: payload.frame_index
                                });
                            }
                            
                            // Show alert in console when fire is detected
                            if (fire_detected) {
                                console.warn('🔥🚨 [FIRE DETECTED]', {
                                    num_boxes: boxes.length,
                                    classes: classes,
                                    frame_index: payload.frame_index
                                });
                            }
                        }
                        
                        // Draw scenario overlays (e.g., sleep "Possibly sleeping" / "SLEEPING CONFIRMED")
                        const scenarioOverlays = Array.isArray(payload.scenario_overlays) ? payload.scenario_overlays : [];
                        for (const overlay of scenarioOverlays) {
                            const overlayBoxes = Array.isArray(overlay.boxes) ? overlay.boxes : (overlay.box ? [overlay.box] : []);
                            const overlayLabels = Array.isArray(overlay.labels) ? overlay.labels : (overlay.label != null ? [overlay.label] : []);
                            let overlayColors = Array.isArray(overlay.colors) ? overlay.colors : (overlay.color != null ? [overlay.color] : []);
                            for (let i = 0; i < overlayBoxes.length; i++) {
                                const b = overlayBoxes[i];
                                if (!Array.isArray(b) || b.length < 4) continue;
                                const x1 = Number(b[0]), y1 = Number(b[1]), x2 = Number(b[2]), y2 = Number(b[3]);
                                if (!Number.isFinite(x1 + y1 + x2 + y2)) continue;
                                // Convert BGR [b,g,r] to CSS color; backend sends BGR
                                let color = overlayColors[i] || 'rgba(0, 255, 102, 0.95)';
                                if (Array.isArray(color) && color.length >= 3) {
                                    const [b0, g, r] = color;
                                    color = 'rgb(' + Math.round(r) + ',' + Math.round(g) + ',' + Math.round(b0) + ')';
                                }
                                ctx.strokeStyle = color;
                                ctx.fillStyle = color;
                                
                                const dx = x1 * scaleX;
                                const dy = y1 * scaleY;
                                const dw = Math.max(0, (x2 - x1) * scaleX);
                                const dh = Math.max(0, (y2 - y1) * scaleY);
                                ctx.strokeRect(dx, dy, dw, dh);
                                
                                // Draw label
                                const label = String((overlayLabels && overlayLabels[i]) || '');
                                if (label) {
                                    const tx = dx + 4;
                                    const ty = Math.max(14, dy - 6);
                                    ctx.fillText(label, tx, ty);
                                }
                            }
                        }
                    }

                    /**
                     * Switch video to agent processed stream. Uses direct JPEG frames (no fMP4) so stream does not break.
                     */
                    async function openOverlayWsForAgent(agentId, agentName) {
                        closeOverlayWs();
                        clearOverlayCanvas();
                        selectedAgentId = agentId || null;

                        if (!agentId) return;
                        if (!api || !api.isAuthenticated || !api.isAuthenticated()) return;
                        if (!api.getAgentOverlayFramesWsURL) {
                            console.warn('visionAPI.getAgentOverlayFramesWsURL missing');
                            return;
                        }
                        if (!videoEl || !agentFramesEl) return;

                        let wsUrl = null;
                        try {
                            wsUrl = api.getAgentOverlayFramesWsURL(agentId);
                        } catch (e) {
                            console.warn('Agent stream auth error', e);
                            return;
                        }

                        if (livePlayer && typeof livePlayer.destroy === 'function') {
                            livePlayer.destroy();
                            livePlayer = null;
                        }

                        setStreamStatus('is-loading', 'Connecting…');

                        livePlayer = createAgentFramePlayer({
                            imgEl: agentFramesEl,
                            videoEl,
                            wsUrl,
                            onState: (ev) => {
                                if (!ev || !ev.state) return;
                                if (ev.state === 'connecting') {
                                    setStreamStatus('is-loading', 'Connecting…');
                                    return;
                                }
                                if (ev.state === 'ws-open' || ev.state === 'first-append') {
                                    setStreamStatus('is-live', 'Live');
                                    return;
                                }
                                if (ev.state === 'error' || ev.state === 'closed') {
                                    setStreamStatus('is-error', ev.state === 'closed' ? 'Disconnected' : 'Stream error');
                                }
                            }
                        });

                        if (overlayBadge) {
                            overlayBadge.innerHTML = '<span data-feather="zap" class="me-1"></span>' + escapeHtml(agentName || 'Agent') + ' (processed)';
                            if (typeof feather !== 'undefined') feather.replace();
                        }
                        if (switchToCameraBtn) {
                            switchToCameraBtn.classList.remove('d-none');
                        }
                    }

                    async function switchToAgentStream(agentId, agentName) {
                        if (!agentId) {
                            console.error('No agent ID provided');
                            return;
                        }

                        console.log('Selecting agent overlay:', agentId);
                        
                        // Update active agent highlight in list
                        document.querySelectorAll('.agent-item').forEach(item => {
                            item.classList.remove('active');
                            item.querySelector('.cd-agent-card')?.classList.remove('is-active');
                        });
                        document.querySelectorAll(`[data-agent-id="${agentId}"]`).forEach(el => {
                            el.closest('.agent-item')?.classList.add('active');
                            el.classList.add('is-active');
                        });

                        // Keep camera stream running; only switch overlay WS
                        await openOverlayWsForAgent(agentId, agentName);
                    }

                    // Function to switch back to camera (raw live) stream
                    async function switchToCameraStream() {
                        console.log('Switching to camera stream');
                        document.querySelectorAll('.agent-item').forEach(item => {
                            item.classList.remove('active');
                            item.querySelector('.cd-agent-card')?.classList.remove('is-active');
                        });
                        closeOverlayWs();
                        clearOverlayCanvas();
                        selectedAgentId = null;
                        if (overlayBadge) overlayBadge.innerHTML = '<span class="fa-solid fa-eye me-1"></span>Live preview';
                        if (switchToCameraBtn) switchToCameraBtn.classList.add('d-none');
                        if (livePlayer && typeof livePlayer.destroy === 'function') {
                            livePlayer.destroy();
                            livePlayer = null;
                        }
                        await initLivePlayer();
                    }

                    // Reload button - reloads current stream (camera or agent processed)
                    document.getElementById('camera-reload')?.addEventListener('click', async () => {
                        if (livePlayer && typeof livePlayer.destroy === 'function') {
                            livePlayer.destroy();
                            livePlayer = null;
                        }
                        if (selectedAgentId) {
                            const agentItem = document.querySelector(`[data-agent-id="${selectedAgentId}"]`);
                            const agentName = agentItem?.querySelector('.name')?.textContent || 'Agent';
                            await openOverlayWsForAgent(selectedAgentId, agentName);
                        } else {
                            await initLivePlayer();
                        }
                        loadAgentsForCamera().catch(() => {});
                    });

                    // Handle fullscreen changes to ensure canvas overlay is properly positioned
                    function handleFullscreenChange() {
                        if (!overlayCanvas || !videoEl) return;
                        
                        // Check if video is in fullscreen (support all browser prefixes)
                        const isFullscreen = document.fullscreenElement === videoEl || 
                                           document.webkitFullscreenElement === videoEl ||
                                           document.mozFullScreenElement === videoEl ||
                                           document.msFullscreenElement === videoEl;
                        
                        if (isFullscreen) {
                            // Store original parent if not already stored
                            if (!originalCanvasParent) {
                                originalCanvasParent = overlayCanvas.parentNode;
                                originalCanvasNextSibling = overlayCanvas.nextSibling;
                            }
                            
                            // Move canvas to body so it can overlay the fullscreen video
                            document.body.appendChild(overlayCanvas);
                            
                            // Function to position and size canvas to match video's displayed area
                            const updateCanvasPosition = () => {
                                const rect = videoEl.getBoundingClientRect();
                                overlayCanvas.style.position = 'fixed';
                                overlayCanvas.style.top = rect.top + 'px';
                                overlayCanvas.style.left = rect.left + 'px';
                                overlayCanvas.style.width = rect.width + 'px';
                                overlayCanvas.style.height = rect.height + 'px';
                                overlayCanvas.style.zIndex = '2147483647'; // Maximum z-index to ensure it's on top
                                overlayCanvas.style.pointerEvents = 'none'; // Ensure it doesn't block video controls
                            };
                            
                            // Initial positioning
                            updateCanvasPosition();
                            
                            // Resize and redraw after a short delay to ensure fullscreen is fully active
                            setTimeout(() => {
                                updateCanvasPosition(); // Update position again after fullscreen settles
                                resizeOverlayCanvasToVideo();
                                // If we have overlay data, trigger a redraw by calling drawOverlay with last data
                                if (window.__visionaiLastOverlayPayload) {
                                    drawOverlay(window.__visionaiLastOverlayPayload);
                                }
                            }, 150);
                            
                            // Store update function for resize events
                            window.__visionaiUpdateCanvasPosition = updateCanvasPosition;
                        } else {
                            // When exiting fullscreen, restore canvas to its original position
                            if (originalCanvasParent) {
                                if (originalCanvasNextSibling) {
                                    originalCanvasParent.insertBefore(overlayCanvas, originalCanvasNextSibling);
                                } else {
                                    originalCanvasParent.appendChild(overlayCanvas);
                                }
                                originalCanvasParent = null;
                                originalCanvasNextSibling = null;
                            }
                            
                            // Clear the update function
                            window.__visionaiUpdateCanvasPosition = null;
                            
                            // Restore original CSS positioning (will use CSS class styles)
                            overlayCanvas.style.position = '';
                            overlayCanvas.style.top = '';
                            overlayCanvas.style.left = '';
                            overlayCanvas.style.width = '';
                            overlayCanvas.style.height = '';
                            overlayCanvas.style.zIndex = '';
                            
                            // Resize and redraw after exiting fullscreen
                            setTimeout(() => {
                                resizeOverlayCanvasToVideo();
                                if (window.__visionaiLastOverlayPayload) {
                                    drawOverlay(window.__visionaiLastOverlayPayload);
                                }
                            }, 150);
                        }
                    }
                    
                    // Listen for fullscreen changes (all browser prefixes)
                    document.addEventListener('fullscreenchange', handleFullscreenChange);
                    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
                    document.addEventListener('mozfullscreenchange', handleFullscreenChange);
                    document.addEventListener('MSFullscreenChange', handleFullscreenChange);
                    
                    // Also handle resize events when in fullscreen
                    let resizeTimeout;
                    window.addEventListener('resize', () => {
                        clearTimeout(resizeTimeout);
                        resizeTimeout = setTimeout(() => {
                            const isFullscreen = document.fullscreenElement === videoEl || 
                                               document.webkitFullscreenElement === videoEl ||
                                               document.mozFullScreenElement === videoEl ||
                                               document.msFullscreenElement === videoEl;
                            if (isFullscreen) {
                                // Update canvas position to match video
                                if (window.__visionaiUpdateCanvasPosition) {
                                    window.__visionaiUpdateCanvasPosition();
                                }
                                resizeOverlayCanvasToVideo();
                                if (window.__visionaiLastOverlayPayload) {
                                    drawOverlay(window.__visionaiLastOverlayPayload);
                                }
                            }
                        }, 100);
                    });
                    
                    // Also listen for video element resize (for aspect ratio changes in fullscreen)
                    if (window.ResizeObserver) {
                        const videoResizeObserver = new ResizeObserver(() => {
                            const isFullscreen = document.fullscreenElement === videoEl || 
                                               document.webkitFullscreenElement === videoEl ||
                                               document.mozFullScreenElement === videoEl ||
                                               document.msFullscreenElement === videoEl;
                            if (isFullscreen && window.__visionaiUpdateCanvasPosition) {
                                window.__visionaiUpdateCanvasPosition();
                                resizeOverlayCanvasToVideo();
                                if (window.__visionaiLastOverlayPayload) {
                                    drawOverlay(window.__visionaiLastOverlayPayload);
                                }
                            }
                        });
                        if (videoEl) {
                            videoResizeObserver.observe(videoEl);
                        }
                    }

                    // Collapse/expand agent sidebar (persists)
                    const SIDEBAR_KEY = 'visionai.cameraDetail.sidebarCollapsed.v1';
                    function setSidebarBtnIcon() {
                        const icon = btnSidebar?.querySelector('span');
                        if (!icon || !shellEl) return;
                        const collapsed = shellEl.classList.contains('visionai-sidebar-collapsed');
                        icon.className = collapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left';
                    }
                    function setSidebarCollapsed(nextCollapsed) {
                        if (!shellEl) return;
                        shellEl.classList.toggle('visionai-sidebar-collapsed', !!nextCollapsed);
                        localStorage.setItem(SIDEBAR_KEY, nextCollapsed ? 'true' : 'false');
                        setSidebarBtnIcon();

                        // Timeline is always visible under the camera; no extra toggling needed.
                    }
                    // Agent filtering (tabs + search)
                    let activeFilter = 'active';

                    function escapeHtml(s) {
                        return String(s ?? '')
                            .replace(/&/g, '&amp;')
                            .replace(/</g, '&lt;')
                            .replace(/>/g, '&gt;')
                            .replace(/"/g, '&quot;')
                            .replace(/'/g, '&#39;');
                    }

                    function mapAgentStatus(status) {
                        const s = String(status || '').toUpperCase();
                        // System-driven active state
                        if (s === 'MONITORING' || s === 'RUNNING') return 'active';
                        // Terminal / end states
                        if (s === 'COMPLETED' || s === 'INACTIVE' || s === 'ERROR') return 'completed';
                        // Scheduled / waiting states: Scheduled, Sleeping, Paused
                        return 'scheduled';
                    }

                    function formatTimeLabel(agent) {
                        const uiStatus = mapAgentStatus(agent?.status);
                        if (uiStatus === 'completed') return 'Done';
                        if (uiStatus === 'active') return 'Now';

                        // scheduled: show start time if available
                        const start = agent?.start_time;
                        if (!start) return 'Scheduled';
                        try {
                            const d = new Date(start);
                            if (!isNaN(d.getTime())) {
                                return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            }
                        } catch {
                            // ignore
                        }
                        return 'Scheduled';
                    }

                    function buildAgentMessage(agent) {
                        const model = agent?.model ? String(agent.model) : '';
                        const fps = agent?.fps ? `FPS ${agent.fps}` : '';
                        const runMode = agent?.run_mode ? String(agent.run_mode) : '';
                        const rulesCount = Array.isArray(agent?.rules) ? `${agent.rules.length} rule(s)` : '';

                        // Pick the first non-empty bits
                        const parts = [model, runMode, rulesCount, fps].filter(Boolean);
                        return parts.length ? parts.join(' • ') : '—';
                    }

                    function renderAgentList(agents) {
                        // Also keep the hidden legacy #agent-list populated for applyFilter compatibility
                        if (listEl) listEl.innerHTML = '';

                        const sectionIds = { active: 'list-active', scheduled: 'list-scheduled', completed: 'list-completed' };
                        const countIds   = { active: 'count-active', scheduled: 'count-scheduled', completed: 'count-completed' };
                        const sections   = {};
                        const counts     = { active: 0, scheduled: 0, completed: 0 };

                        Object.entries(sectionIds).forEach(([key, id]) => { sections[key] = document.getElementById(id); });

                        // Clear skeletons
                        Object.values(sections).forEach(el => { if (el) el.innerHTML = ''; });

                        if (!agents || !Array.isArray(agents) || agents.length === 0) {
                            Object.entries(sections).forEach(([key, el]) => {
                                if (!el) return;
                                const li = document.createElement('li');
                                li.innerHTML = `<div class="cd-empty"><span class="cd-empty-icon" data-feather="zap"></span>No ${key === 'active' ? 'active' : key === 'scheduled' ? 'waiting' : 'inactive'} agents</div>`;
                                el.appendChild(li);
                                const countEl = document.getElementById(countIds[key]);
                                if (countEl) countEl.textContent = '0';
                            });
                            if (typeof feather !== 'undefined') feather.replace();
                            return;
                        }

                        // Bucket by status
                        const buckets = { active: [], scheduled: [], completed: [] };
                        agents.forEach(agent => {
                            const uiStatus = mapAgentStatus(agent?.status);
                            const bucket = buckets[uiStatus] ?? buckets.completed;
                            bucket.push(agent);
                        });

                        Object.entries(buckets).forEach(([bucketKey, list]) => {
                            const el = sections[bucketKey];
                            const countEl = document.getElementById(countIds[bucketKey]);
                            if (countEl) countEl.textContent = String(list.length);

                            if (!el) return;

                            if (list.length === 0) {
                                const li = document.createElement('li');
                                li.innerHTML = `<div class="cd-empty"><span class="cd-empty-icon" data-feather="zap"></span>No ${bucketKey === 'active' ? 'active' : bucketKey === 'scheduled' ? 'waiting' : 'inactive'} agents</div>`;
                                el.appendChild(li);
                                return;
                            }

                            list.forEach(agent => {
                                const uiStatus = bucketKey;
                                const name = escapeHtml(agent?.name || 'Agent');
                                const timeLabel = escapeHtml(formatTimeLabel(agent));
                                const message = escapeHtml(buildAgentMessage(agent));
                                const agentId = agent?.id || '';

                                const statusClass = uiStatus === 'active' ? 'cd-agent-status--active'
                                    : uiStatus === 'scheduled' ? 'cd-agent-status--waiting'
                                    : 'cd-agent-status--inactive';
                                const statusLabel = uiStatus === 'active' ? 'Active'
                                    : uiStatus === 'scheduled' ? 'Waiting' : 'Inactive';
                                const iconMod = uiStatus === 'active' ? 'cd-agent-icon--active' : '';

                                const li = document.createElement('li');
                                li.className = `agent-item ${uiStatus}`;
                                li.setAttribute('data-agent-status', uiStatus);
                                li.setAttribute('data-agent-id', agentId);

                                li.innerHTML = `
                                    <div class="cd-agent-card" role="button" data-agent-id="${agentId}">
                                        <div class="cd-agent-icon ${iconMod}">
                                            <span data-feather="zap"></span>
                                        </div>
                                        <div class="cd-agent-info">
                                            <div class="cd-agent-name name">${name}</div>
                                            <div class="cd-agent-meta message">${message || timeLabel}</div>
                                        </div>
                                        <span class="cd-agent-status ${statusClass}">${statusLabel}</span>
                                    </div>`;

                                const card = li.querySelector('.cd-agent-card');
                                if (uiStatus === 'active') {
                                    card.addEventListener('click', () => switchToAgentStream(agentId, name));
                                } else {
                                    card.style.cursor = 'default';
                                    card.style.opacity = '0.6';
                                    card.setAttribute('title', uiStatus === 'scheduled' ? 'Agent is waiting — live view not available' : 'Agent is inactive — live view not available');
                                }

                                el.appendChild(li);

                                // Also add to hidden legacy list for applyFilter
                                if (listEl) {
                                    const legacyLi = li.cloneNode(true);
                                    if (uiStatus === 'active') {
                                        legacyLi.querySelector('.cd-agent-card')?.addEventListener('click', () => switchToAgentStream(agentId, name));
                                    }
                                    listEl.appendChild(legacyLi);
                                }
                            });
                        });
                        if (typeof feather !== 'undefined') feather.replace();
                    }

                    function mapWorkflowStatus(status) {
                        const s = String(status || '').toLowerCase();
                        if (s === 'running') return 'active';
                        if (s === 'scheduled' || s === 'pending') return 'scheduled';
                        return 'completed';
                    }

                    function renderWorkflowList(workflows) {
                        const sectionIds = { active: 'wf-list-active', scheduled: 'wf-list-scheduled', completed: 'wf-list-completed' };
                        const countIds   = { active: 'wf-count-active', scheduled: 'wf-count-scheduled', completed: 'wf-count-completed' };
                        const sections   = {};
                        const counts     = { active: 0, scheduled: 0, completed: 0 };

                        Object.entries(sectionIds).forEach(([key, id]) => { sections[key] = document.getElementById(id); });
                        Object.values(sections).forEach(el => { if (el) el.innerHTML = ''; });

                        const section = document.getElementById('cd-workflow-section');

                        if (!workflows || !Array.isArray(workflows) || workflows.length === 0) {
                            if (section) section.style.display = 'none';
                            return;
                        }

                        if (section) section.style.display = '';

                        const buckets = { active: [], scheduled: [], completed: [] };
                        workflows.forEach(wf => {
                            const uiStatus = mapWorkflowStatus(wf?.status);
                            (buckets[uiStatus] ?? buckets.completed).push(wf);
                        });

                        Object.entries(buckets).forEach(([bucketKey, list]) => {
                            const el = sections[bucketKey];
                            const countEl = document.getElementById(countIds[bucketKey]);
                            if (countEl) countEl.textContent = String(list.length);

                            if (!el) return;

                            if (list.length === 0) {
                                const li = document.createElement('li');
                                li.innerHTML = `<div class="cd-empty"><span class="cd-empty-icon fa-solid fa-diagram-project"></span>No ${bucketKey === 'active' ? 'active' : bucketKey === 'scheduled' ? 'waiting' : 'inactive'} workflows</div>`;
                                el.appendChild(li);
                                return;
                            }

                            list.forEach(wf => {
                                const uiStatus = bucketKey;
                                const name = escapeHtml(wf?.name || 'Workflow');
                                const desc = escapeHtml(wf?.description || '');
                                const wfId = wf?.id || '';

                                const statusClass = uiStatus === 'active' ? 'cd-agent-status--active'
                                    : uiStatus === 'scheduled' ? 'cd-agent-status--waiting'
                                    : 'cd-agent-status--inactive';
                                const statusLabel = uiStatus === 'active' ? 'Active'
                                    : uiStatus === 'scheduled' ? 'Waiting' : 'Inactive';
                                const iconMod = uiStatus === 'active' ? 'cd-agent-icon--active' : '';

                                const li = document.createElement('li');
                                li.className = `agent-item ${uiStatus}`;
                                li.setAttribute('data-wf-id', wfId);

                                li.innerHTML = `
                                    <div class="cd-agent-card" role="button" data-wf-id="${wfId}">
                                        <div class="cd-agent-icon ${iconMod}">
                                            <span class="fa-solid fa-diagram-project"></span>
                                        </div>
                                        <div class="cd-agent-info">
                                            <div class="cd-agent-name name">${name}</div>
                                            <div class="cd-agent-meta message">${desc || '—'}</div>
                                        </div>
                                        <span class="cd-agent-status ${statusClass}">${statusLabel}</span>
                                    </div>`;

                                const card = li.querySelector('.cd-agent-card');
                                if (uiStatus === 'active') {
                                    // Find the first active agent in this workflow to stream
                                    card.addEventListener('click', () => switchToWorkflowStream(wf));
                                } else {
                                    card.style.cursor = 'default';
                                    card.style.opacity = '0.6';
                                    card.setAttribute('title', uiStatus === 'scheduled' ? 'Workflow is waiting — live view not available' : 'Workflow is inactive — live view not available');
                                }

                                el.appendChild(li);
                            });
                        });
                    }

                    async function switchToWorkflowStream(wf) {
                        if (!wf) return;
                        // Use the first running agent in the workflow for the live stream
                        const runningAgent = Array.isArray(wf.agents)
                            ? wf.agents.find(a => {
                                const s = String(a?.status || '').toLowerCase();
                                return s === 'monitoring' || s === 'running';
                              })
                            : null;

                        if (runningAgent) {
                            await switchToAgentStream(runningAgent.id, wf.name || 'Workflow');
                        } else {
                            // Fall back: use agent from wf.agents if available, first one
                            const firstAgent = Array.isArray(wf.agents) ? wf.agents[0] : null;
                            if (firstAgent) {
                                await switchToAgentStream(firstAgent.id, wf.name || 'Workflow');
                            }
                        }
                    }

                    function bindWorkflowTabs() {
                        document.querySelectorAll('.cd-wf-tab').forEach(tab => {
                            tab.addEventListener('click', () => {
                                const key = tab.getAttribute('data-cd-wf-tab');
                                document.querySelectorAll('.cd-wf-tab').forEach(t => t.classList.remove('active'));
                                tab.classList.add('active');
                                ['wf-list-active', 'wf-list-scheduled', 'wf-list-completed'].forEach(id => {
                                    const el = document.getElementById(id);
                                    if (!el) return;
                                    const match = (key === 'active' && id === 'wf-list-active') ||
                                                  (key === 'scheduled' && id === 'wf-list-scheduled') ||
                                                  (key === 'completed' && id === 'wf-list-completed');
                                    el.classList.toggle('d-none', !match);
                                });
                            });
                        });
                    }

                    async function loadWorkflowsForCamera() {
                        const camId = currentCameraId;
                        if (!camId) return;

                        ['wf-list-active', 'wf-list-scheduled', 'wf-list-completed'].forEach(id => {
                            const el = document.getElementById(id);
                            if (el) el.innerHTML = `
                                <li class="cd-agent-skeleton"><div class="cd-skel-icon"></div><div class="cd-skel-lines"><div class="cd-skel-l1"></div><div class="cd-skel-l2"></div></div></li>`;
                        });

                        if (!api || !api.isAuthenticated || !api.isAuthenticated()) return;

                        try {
                            // Fetch all workflows and get status for each
                            const workflows = await api.listWorkflowsByCamera(camId);

                            // Fetch live status for each workflow
                            const withStatus = await Promise.all(
                                (Array.isArray(workflows) ? workflows : []).map(async wf => {
                                    try {
                                        const statusData = await api.get(`/api/v1/workflows/${encodeURIComponent(wf.id)}/status`);
                                        return { ...wf, status: statusData?.status || wf.status, agents: statusData?.agents || [] };
                                    } catch {
                                        return { ...wf, agents: [] };
                                    }
                                })
                            );

                            renderWorkflowList(withStatus);
                        } catch (e) {
                            console.error('Failed to load workflows:', e);
                            ['wf-list-active', 'wf-list-scheduled', 'wf-list-completed'].forEach(id => {
                                const el = document.getElementById(id);
                                if (el) el.innerHTML = '<li><div class="cd-empty"><span class="fa-solid fa-triangle-exclamation cd-empty-icon"></span>Failed to load workflows</div></li>';
                            });
                        }
                    }

                    let _widgetObserver = null;

                    function lazyMountCameraWidgets(camId) {
                        if (!camId) return;

                        // Disconnect any previous observer (handles re-navigation to same page)
                        if (_widgetObserver) { _widgetObserver.disconnect(); _widgetObserver = null; }

                        // Destroy stale instances from a previous camera visit
                        if (eventsWidgetInstance) { try { eventsWidgetInstance.destroy(); } catch (e) {} eventsWidgetInstance = null; }
                        if (agentsWidgetInstance) { try { agentsWidgetInstance.destroy(); } catch (e) {} agentsWidgetInstance = null; }

                        const section = document.getElementById('vision-camera-events-agents-section');
                        if (!section) return;

                        // Show skeleton placeholders so the section doesn't look empty before scroll
                        section.innerHTML = `
                            <div class="row g-4">
                                <div class="col-12 col-lg-6">
                                    <div id="vision-camera-events-widget" class="vision-widget-container">
                                        <div class="cd-widget-skeleton p-3">
                                            <div class="cd-skel-l1 mb-2" style="width:40%;height:14px;border-radius:6px;background:var(--phoenix-border-color,#e2e8f0);animation:cd-pulse 1.4s ease-in-out infinite;"></div>
                                            <div class="cd-skel-l2 mb-2" style="width:100%;height:10px;border-radius:6px;background:var(--phoenix-border-color,#e2e8f0);animation:cd-pulse 1.4s ease-in-out infinite .15s;"></div>
                                            <div class="cd-skel-l2" style="width:75%;height:10px;border-radius:6px;background:var(--phoenix-border-color,#e2e8f0);animation:cd-pulse 1.4s ease-in-out infinite .3s;"></div>
                                        </div>
                                    </div>
                                </div>
                                <div class="col-12 col-lg-6">
                                    <div id="vision-camera-agents-widget" class="vision-widget-container">
                                        <div class="cd-widget-skeleton p-3">
                                            <div class="cd-skel-l1 mb-2" style="width:40%;height:14px;border-radius:6px;background:var(--phoenix-border-color,#e2e8f0);animation:cd-pulse 1.4s ease-in-out infinite;"></div>
                                            <div class="cd-skel-l2 mb-2" style="width:100%;height:10px;border-radius:6px;background:var(--phoenix-border-color,#e2e8f0);animation:cd-pulse 1.4s ease-in-out infinite .15s;"></div>
                                            <div class="cd-skel-l2" style="width:75%;height:10px;border-radius:6px;background:var(--phoenix-border-color,#e2e8f0);animation:cd-pulse 1.4s ease-in-out infinite .3s;"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>`;

                        _widgetObserver = new IntersectionObserver((entries, obs) => {
                            if (!entries[0].isIntersecting) return;
                            obs.disconnect();
                            _widgetObserver = null;
                            mountCameraWidgets(camId);
                        }, { rootMargin: '120px' }); // start loading 120px before the section reaches viewport

                        _widgetObserver.observe(section);
                    }

                    function mountCameraWidgets(camId) {
                        if (!camId) return;
                        const eventsContainer = document.getElementById('vision-camera-events-widget');
                        const agentsContainer = document.getElementById('vision-camera-agents-widget');
                        if (!eventsContainer || !agentsContainer) return;

                        // Load agents first, then events after agents resolve (staggered to avoid
                        // two simultaneous heavy requests hitting the backend at the same time)
                        if (typeof window.VisionAgentsBoardWidget !== 'undefined' && window.VisionAgentsBoardWidget.mount) {
                            agentsWidgetInstance = window.VisionAgentsBoardWidget.mount(agentsContainer, {
                                cameraId: camId,
                                showFilters: true,
                                compact: false
                            });
                            const agentsReady = agentsWidgetInstance && typeof agentsWidgetInstance.refresh === 'function'
                                ? agentsWidgetInstance.refresh()
                                : Promise.resolve();
                            agentsReady.finally(function () {
                                if (typeof window.VisionEventsBoardWidget !== 'undefined' && window.VisionEventsBoardWidget.mount) {
                                    eventsWidgetInstance = window.VisionEventsBoardWidget.mount(eventsContainer, {
                                        cameraId: camId,
                                        dateRange: 'all',
                                        severityFilter: 'all',
                                        compact: true,
                                        showFilters: true
                                    });
                                }
                            });
                        } else if (typeof window.VisionEventsBoardWidget !== 'undefined' && window.VisionEventsBoardWidget.mount) {
                            eventsWidgetInstance = window.VisionEventsBoardWidget.mount(eventsContainer, {
                                cameraId: camId,
                                dateRange: 'all',
                                severityFilter: 'all',
                                compact: true,
                                showFilters: true
                            });
                        }
                    }

                    async function loadAgentsForCamera() {
                        const camId = currentCameraId;
                        if (!camId) return;

                        // Show skeletons while loading
                        ['list-active', 'list-scheduled', 'list-completed'].forEach(id => {
                            const el = document.getElementById(id);
                            if (el) el.innerHTML = `
                                <li class="cd-agent-skeleton"><div class="cd-skel-icon"></div><div class="cd-skel-lines"><div class="cd-skel-l1"></div><div class="cd-skel-l2"></div></div></li>
                                <li class="cd-agent-skeleton"><div class="cd-skel-icon"></div><div class="cd-skel-lines"><div class="cd-skel-l1"></div><div class="cd-skel-l2"></div></div></li>`;
                        });

                        if (!api || !api.isAuthenticated || !api.isAuthenticated()) {
                            ['list-active', 'list-scheduled', 'list-completed'].forEach(id => {
                                const el = document.getElementById(id);
                                if (el) el.innerHTML = '<li><div class="cd-empty"><span class="fa-solid fa-lock cd-empty-icon"></span>Login required</div></li>';
                            });
                            return;
                        }

                        try {
                            const allAgents = await api.listAgentsByCamera(camId);
                            const agents = (Array.isArray(allAgents) ? allAgents : []).filter(a => a.agent_source !== 'workflow');
                            lastAgentsForCamera = agents;
                            renderAgentList(agents);
                            applyFilter();
                            syncTimelineGroupsFromAgents(lastAgentsForCamera);
                        } catch (e) {
                            console.error('Failed to load agents:', e);
                            ['list-active', 'list-scheduled', 'list-completed'].forEach(id => {
                                const el = document.getElementById(id);
                                if (el) el.innerHTML = '<li><div class="cd-empty"><span class="fa-solid fa-triangle-exclamation cd-empty-icon"></span>Failed to load agents</div></li>';
                            });
                        }
                    }

                    function applyFilter() {
                        const q = (searchEl?.value || '').trim().toLowerCase();
                        if (!q) {
                            // No search — show all sections normally
                            document.querySelectorAll('#list-active .agent-item, #list-scheduled .agent-item, #list-completed .agent-item').forEach(li => { li.style.display = ''; });
                            return;
                        }
                        // Search: show any match across all sections
                        document.querySelectorAll('#list-active .agent-item, #list-scheduled .agent-item, #list-completed .agent-item').forEach((li) => {
                            const name = li.querySelector('.name')?.textContent?.toLowerCase() || '';
                            const msg  = li.querySelector('.message')?.textContent?.toLowerCase() || '';
                            li.style.display = (name.includes(q) || msg.includes(q)) ? '' : 'none';
                        });
                    }

                    function bindSectionToggles() {
                        document.querySelectorAll('[data-section-toggle]').forEach(btn => {
                            btn.addEventListener('click', () => {
                                const key = btn.getAttribute('data-section-toggle');
                                const listEl = document.getElementById(`list-${key}`);
                                const expanded = btn.getAttribute('aria-expanded') === 'true';
                                btn.setAttribute('aria-expanded', expanded ? 'false' : 'true');
                                if (listEl) listEl.classList.toggle('cd-section__list--collapsed', expanded);
                            });
                        });
                    }

                    function bindUiEvents() {
                        // Switch back to raw camera stream (bound here so it works after SPA re-navigation)
                        switchToCameraBtn?.addEventListener('click', () => {
                            switchToCameraStream();
                        });

                        // Sidebar toggle
                        if (shellEl) {
                            const saved = localStorage.getItem(SIDEBAR_KEY) === 'true';
                            setSidebarCollapsed(saved);
                        }
                        btnSidebar?.addEventListener('click', () => {
                            const collapsed = shellEl?.classList.contains('visionai-sidebar-collapsed');
                            setSidebarCollapsed(!collapsed);
                        });

                        // Tab switching: show only the selected section
                        document.querySelectorAll('.cd-tab').forEach(tab => {
                            tab.addEventListener('click', () => {
                                const key = tab.getAttribute('data-cd-tab');
                                document.querySelectorAll('.cd-tab').forEach(t => t.classList.remove('active'));
                                tab.classList.add('active');
                                ['list-active', 'list-scheduled', 'list-completed'].forEach(id => {
                                    const el = document.getElementById(id);
                                    if (!el) return;
                                    const match = (key === 'active' && id === 'list-active') ||
                                                  (key === 'scheduled' && id === 'list-scheduled') ||
                                                  (key === 'completed' && id === 'list-completed');
                                    el.classList.toggle('d-none', !match);
                                });
                                applyFilter();
                            });
                        });

                        // Collapsible section headers
                        bindSectionToggles();

                        // Search filter
                        searchEl?.addEventListener('input', applyFilter);
                    }

                    // Agents are loaded from initCamera() once camera id is known.

                    // vis-timeline assets are loaded lazily so this page works in Electron static HTML.
                    // NOTE: for production builds, node_modules is excluded by electron-builder config,
                    // so you'll likely want to vendor these two files into /custom_js/vendor later.
                    function ensureLinkOnce(href) {
                        if (document.querySelector(`link[data-visionai="true"][href="${href}"]`)) return;
                        const link = document.createElement('link');
                        link.rel = 'stylesheet';
                        link.href = href;
                        link.setAttribute('data-visionai', 'true');
                        document.head.appendChild(link);
                    }

                    function pad2(n) { return String(n).padStart(2, '0'); }
                    function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
                    function fmtHHmm(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
                    function getDayBounds() {
                        const start = new Date();
                        start.setHours(0, 0, 0, 0);
                        const end = new Date();
                        end.setHours(23, 59, 59, 999);
                        return { start, end };
                    }
                    function dateAtMinute(dayStart, minute) {
                        return new Date(dayStart.getTime() + (minute * 60_000));
                    }


                    const VIS_CSS_HREF = '../node_modules/vis-timeline/styles/vis-timeline-graph2d.min.css';
                    const VIS_JS_SRC = '../node_modules/vis-timeline/standalone/umd/vis-timeline-graph2d.min.js';

                    let timeline = null;
                    let nowInterval = null;
                    let lastPointerX = null;
                    const nowId = 'now';

                    function getVisGlobal() {
                        return window.vis || window.visTimeline || window['vis-timeline'] || null;
                    }

                    async function ensureVisLoaded() {
                        // Load base vis CSS (we override most classes in our stylesheet)
                        ensureLinkOnce(VIS_CSS_HREF);
                        await loadScriptOnce(VIS_JS_SRC);
                        return getVisGlobal();
                    }

                    // ------------------------------------------------------------
                    // Realtime timeline model (agents -> groups, events -> items)
                    // ------------------------------------------------------------
                    let lastAgentsForCamera = [];
                    let visLibRef = null;
                    let groupsDS = null;
                    let itemsDS = null;
                    const imageUrlCache = new Map(); // eventId -> objectURL

                    function getActiveAgents(agents) {
                        return (Array.isArray(agents) ? agents : []).filter(a => mapAgentStatus(a?.status) === 'active');
                    }

                    function buildGroupsFromAgents(visLib, agents) {
                        const active = getActiveAgents(agents);
                        const rows = active.map((a) => ({
                            id: String(a?.id || ''),
                            content: escapeHtml(a?.name || 'Agent')
                        })).filter(g => g.id);

                        // Fallback group so timeline isn't blank
                        if (!rows.length) {
                            rows.push({ id: '__no_agents__', content: 'No active agents' });
                        }
                        return new visLib.DataSet(rows);
                    }

                    function syncTimelineGroupsFromAgents(agents) {
                        if (!visLibRef || !groupsDS) return;
                        try {
                            groupsDS.clear();
                            const next = buildGroupsFromAgents(visLibRef, agents);
                            next.forEach((g) => groupsDS.add(g));
                        } catch {
                            // ignore
                        }
                    }

                    function parseEventDate(ts) {
                        if (!ts) return new Date();
                        const d = new Date(ts);
                        return Number.isFinite(d.getTime()) ? d : new Date();
                    }

                    function classifyEventClass(label) {
                        const t = String(label || '').toLowerCase();
                        if (t.includes('motion') || t.includes('movement')) return 'cctv-motion';
                        if (t.includes('record')) return 'cctv-recording';
                        return 'cctv-event';
                    }

                    function addTimelineItemFromNotificationPayload(payload) {
                        if (!itemsDS || !payload) return;
                        if (payload.type && payload.type !== 'event_notification') return;

                        const camId = payload?.agent?.camera_id || payload?.agent?.cameraId || '';
                        if (!camId || camId !== currentCameraId) return;

                        const agentId = String(payload?.agent?.agent_id || payload?.agent?.agentId || '');
                        if (!agentId) return;

                        // Only show if this agent is currently active (group exists)
                        const groupExists = !!groupsDS.get(agentId);
                        if (!groupExists) return;

                        const start = parseEventDate(payload?.event?.timestamp || payload?.received_at);
                        const durSec = Number(payload?.metadata?.duration_seconds || payload?.metadata?.duration_sec || 30);
                        const end = new Date(start.getTime() + (Math.max(5, durSec) * 1000));

                        const id =
                            String(payload?.event_id || payload?.metadata?.event_id || payload?.session_id || payload?.metadata?.session_id || '') ||
                            `${agentId}_${start.getTime()}`;

                        if (itemsDS.get(id)) return;

                        itemsDS.add({
                            id,
                            group: agentId,
                            start,
                            end,
                            type: 'range',
                            className: classifyEventClass(payload?.event?.label),
                            content: '',
                            // popup fields
                            label: String(payload?.event?.label || 'Event'),
                            severity: String(payload?.event?.severity || payload?.metadata?.severity || ''),
                            agentName: String(payload?.agent?.agent_name || payload?.agent?.agentName || ''),
                            cameraId: String(camId),
                            eventId: String(payload?.event_id || payload?.metadata?.event_id || ''),
                            hasImage: true,
                        });
                    }

                    // ------------------------------------------------------------
                    // Popup overlay using vis itemover/itemout
                    // ------------------------------------------------------------

                    function fmtTimeLocal(d) {
                        try {
                            const dt = d instanceof Date ? d : new Date(d);
                            return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        } catch {
                            return '--:--';
                        }
                    }

                    function positionPopup(clientX, clientY) {
                        if (!popupEl) return;
                        const pad = 12;
                        const w = popupEl.offsetWidth || 320;
                        const h = popupEl.offsetHeight || 120;
                        const vw = window.innerWidth || 1024;
                        const vh = window.innerHeight || 768;

                        let x = clientX + 14;
                        let y = clientY + 14;
                        if (x + w + pad > vw) x = clientX - w - 14;
                        if (y + h + pad > vh) y = clientY - h - 14;
                        x = Math.max(pad, Math.min(vw - w - pad, x));
                        y = Math.max(pad, Math.min(vh - h - pad, y));
                        popupEl.style.left = `${x}px`;
                        popupEl.style.top = `${y}px`;
                    }

                    function setPopupVisible(show) {
                        if (!popupEl) return;
                        popupEl.setAttribute('data-show', show ? 'true' : 'false');
                        popupEl.setAttribute('aria-hidden', show ? 'false' : 'true');
                    }

                    async function ensureEventThumb(eventId) {
                        if (!eventId) return null;
                        if (imageUrlCache.has(eventId)) return imageUrlCache.get(eventId);
                        if (!api || typeof api.fetchEventImageObjectUrl !== 'function') return null;
                        try {
                            const url = await api.fetchEventImageObjectUrl(eventId);
                            imageUrlCache.set(eventId, url);
                            return url;
                        } catch {
                            return null;
                        }
                    }

                    async function showPopupForItem(itemId, clientX, clientY) {
                        if (!itemsDS || !popupEl) return;
                        const it = itemsDS.get(itemId);
                        if (!it) return;

                        popupTitle.textContent = String(it.label || 'Event');
                        popupTime.textContent = fmtTimeLocal(it.start);
                        popupAgent.textContent = String(it.agentName || '—');
                        popupSev.textContent = String(it.severity || '—');

                        // image
                        if (popupImg) {
                            popupImg.style.display = 'none';
                            popupImg.removeAttribute('src');
                        }
                        const eventId = String(it.eventId || it.id || '');
                        const hasImage = it.hasImage !== false;
                        if (hasImage && eventId) {
                            const url = await ensureEventThumb(eventId);
                            if (url && popupImg) {
                                popupImg.src = url;
                                popupImg.style.display = 'block';
                            }
                        }

                        positionPopup(clientX, clientY);
                        setPopupVisible(true);
                    }

                    function hidePopup() {
                        setPopupVisible(false);
                    }

                    function updateZoomPill() {
                        if (!timeline || !zoomLabel) return;
                        const w = timeline.getWindow();
                        const mins = Math.round((w.end.getTime() - w.start.getTime()) / 60_000);
                        if (mins >= 24 * 60) zoomLabel.textContent = '24h';
                        else if (mins >= 6 * 60) zoomLabel.textContent = '6h';
                        else if (mins >= 60) zoomLabel.textContent = '1h';
                        else zoomLabel.textContent = `${mins}m`;
                    }

                    // Cursor anchored zoom for +/- buttons using setWindow.
                    // (Mouse wheel zoom remains vis-timeline's built-in cursor-anchored behavior.)
                    function zoomAtCursor(factor, anchorClientX) {
                        if (!timeline || !visContainer) return;
                        const { start: dayStart, end: dayEnd } = getDayBounds();
                        const w = timeline.getWindow();
                        const startMs = w.start.getTime();
                        const endMs = w.end.getTime();
                        const duration = Math.max(1, endMs - startMs);

                        const rect = visContainer.getBoundingClientRect();
                        const x = clamp((anchorClientX ?? (rect.left + rect.width / 2)) - rect.left, 0, rect.width);
                        const p = rect.width > 0 ? (x / rect.width) : 0.5;
                        const timeAtCursor = startMs + p * duration;

                        const newDuration = duration * factor;
                        let newStart = timeAtCursor - p * newDuration;
                        let newEnd = newStart + newDuration;

                        // Clamp to 24h day bounds
                        const minMs = dayStart.getTime();
                        const maxMs = dayEnd.getTime();
                        if (newStart < minMs) {
                            newStart = minMs;
                            newEnd = minMs + newDuration;
                        }
                        if (newEnd > maxMs) {
                            newEnd = maxMs;
                            newStart = maxMs - newDuration;
                        }
                        newStart = clamp(newStart, minMs, maxMs);
                        newEnd = clamp(newEnd, minMs, maxMs);

                        timeline.setWindow(new Date(newStart), new Date(newEnd), { animation: false });
                        updateZoomPill();
                    }

                    function updateNowMarker() {
                        if (!timeline) return;
                        const now = new Date();
                        try {
                            timeline.setCustomTime(now, nowId);
                            timeline.setCustomTimeMarker(`NOW ${fmtHHmm(now)}`, nowId);
                        } catch {
                            // ignore
                        }
                    }

                    async function initCctvTimeline() {
                        if (!visContainer) return;

                        const visLib = await ensureVisLoaded();
                        if (!visLib || !visLib.Timeline || !visLib.DataSet) {
                            console.warn('vis-timeline not available');
                            return;
                        }

                        // Prevent double init on SPA reinjection
                        if (timeline) return;

                        const { start: dayStart, end: dayEnd } = getDayBounds();
                        visLibRef = visLib;
                        groupsDS = buildGroupsFromAgents(visLib, lastAgentsForCamera);
                        itemsDS = new visLib.DataSet([]);

                        const options = {
                            // 24h bounds
                            min: dayStart,
                            max: dayEnd,
                            start: dayStart,
                            end: dayEnd,

                            // Interaction
                            moveable: true,
                            zoomable: true,
                            zoomKey: '', // allow wheel zoom without ctrl
                            selectable: false,
                            multiselect: false,
                            stack: false,

                            // Compact layout
                            height: 160,
                            margin: { item: 6, axis: 8 },
                            groupHeightMode: 'fixed',
                        };

                        timeline = new visLib.Timeline(visContainer, itemsDS, groupsDS, options);

                        // Custom NOW playhead (cyan). (Disable default current time marker)
                        try {
                            timeline.addCustomTime(new Date(), nowId);
                            timeline.setCustomTimeMarker(`NOW ${fmtHHmm(new Date())}`, nowId);
                        } catch {
                            // ignore
                        }

                        // Update NOW periodically
                        nowInterval = setInterval(updateNowMarker, 15_000);

                        // Zoom pill updates
                        timeline.on('rangechanged', updateZoomPill);
                        updateZoomPill();

                        // Track last pointer for +/- anchoring
                        visContainer.addEventListener('mousemove', (e) => { lastPointerX = e.clientX; });

                        zoomInBtn?.addEventListener('click', () => zoomAtCursor(0.7, lastPointerX));
                        zoomOutBtn?.addEventListener('click', () => zoomAtCursor(1.35, lastPointerX));

                        // Hook into existing cleanup to destroy timeline on SPA nav
                        const prevCleanup = window.__visionaiPageCleanup;
                        const onRawEvent = (ev) => addTimelineItemFromNotificationPayload(ev?.detail);
                        window.addEventListener('vision:event-notification-raw', onRawEvent);
                        // Popup interactions
                        let popupItemId = null;
                        timeline.on('itemover', async (props) => {
                            try {
                                popupItemId = props?.item || null;
                                const e = props?.event;
                                if (!popupItemId || !e) return;
                                await showPopupForItem(popupItemId, e.clientX, e.clientY);
                            } catch {
                                // ignore
                            }
                        });
                        timeline.on('itemout', () => {
                            popupItemId = null;
                            hidePopup();
                        });
                        timeline.on('mouseMove', (props) => {
                            if (!popupItemId) return;
                            const e = props?.event;
                            if (!e) return;
                            positionPopup(e.clientX, e.clientY);
                        });

                        window.__visionaiPageCleanup = () => {
                            try { prevCleanup?.(); } catch {}
                            try { window.removeEventListener('vision:event-notification-raw', onRawEvent); } catch {}
                            try { hidePopup(); } catch {}
                            try {
                                // Revoke cached object URLs
                                imageUrlCache.forEach((u) => {
                                    try { URL.revokeObjectURL(u); } catch {}
                                });
                                imageUrlCache.clear();
                            } catch {}
                            try { if (nowInterval) clearInterval(nowInterval); } catch {}
                            nowInterval = null;
                            try { timeline?.destroy?.(); } catch {}
                            timeline = null;
                            groupsDS = null;
                            itemsDS = null;
                            visLibRef = null;
                        };

                        async function listEventsPaged(range, totalLimit) {
                            const maxPageSize = 100; // backend likely validates max limit (avoid 422)
                            const desired = Math.max(0, Number(totalLimit || 0));
                            const all = [];
                            if (!api?.listEvents) return all;

                            for (let skip = 0; skip < desired; skip += maxPageSize) {
                                const limit = Math.min(maxPageSize, desired - skip);
                                const res = await api.listEvents(range, limit, skip);
                                const rows = Array.isArray(res?.items) ? res.items : [];
                                all.push(...rows);
                                if (rows.length < limit) break; // no more pages
                            }
                            return all;
                        }

                        // Initial history: load today's events and render them into agent lanes
                        // (DB-backed, so timeline isn't empty on load)
                        try {
                            if (api?.listEvents) {
                                const rows = await listEventsPaged('today', 500);
                                rows
                                    .filter(r => String(r?.camera_id || '') === String(currentCameraId || ''))
                                    .forEach((r) => {
                                        const agentId = String(r?.agent_id || '');
                                        if (!agentId) return;
                                        if (!groupsDS.get(agentId)) return; // only active agents
                                        const start = parseEventDate(r?.event_ts || r?.received_at);
                                        const end = new Date(start.getTime() + 30_000);
                                        const id = String(r?.id || `${agentId}_${start.getTime()}`);
                                        if (itemsDS.get(id)) return;
                                        itemsDS.add({
                                            id,
                                            group: agentId,
                                            start,
                                            end,
                                            type: 'range',
                                            className: classifyEventClass(r?.label),
                                            content: '',
                                            // popup fields
                                            label: String(r?.label || 'Event'),
                                            severity: String(r?.severity || ''),
                                            agentName: String(r?.agent_name || ''),
                                            cameraId: String(r?.camera_id || ''),
                                            eventId: String(r?.id || ''),
                                            hasImage: !!r?.has_image,
                                        });
                                    });
                            }
                        } catch {
                            // ignore history load failures (realtime will still work)
                        }
                    }

                    // Boot is called by the SPA router via the exported boot() function below.
                    // We do NOT self-init here — avoids double-init and stale-state bugs on re-navigation.
                    console.log('[CameraDetail] IIFE executed — waiting for boot() call from router');

                    // Expose boot so the SPA router can call it on every navigation to this page.
                    window.__cameraDetailBoot = async function () {
                        console.log('[CameraDetail] boot() called by router');
                        await init();
                        await initCctvTimeline();
                    };
                })();

export async function boot() {
    console.log('[CameraDetail] ES module boot() called');
    if (typeof window.__cameraDetailBoot === 'function') {
        await window.__cameraDetailBoot();
    }
}
            

