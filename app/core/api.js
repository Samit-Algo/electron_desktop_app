import { BASE_URL, JETSON_BASE_URL } from './api-config.js';

function parseErrorDetail(detail) {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const msgs = detail.filter(i => i && typeof i === 'object' && i.msg).map(i => i.msg);
    return msgs.length ? msgs.join('. ') : JSON.stringify(detail);
  }
  // Structured error: { type, message }
  if (typeof detail === 'object' && detail.message) return detail.message;
  return String(detail);
}

// Extract the error type from a structured detail object, or null.
function parseErrorType(detail) {
  if (detail && typeof detail === 'object' && !Array.isArray(detail) && detail.type) return detail.type;
  return null;
}

// Build an Error from a response detail, attaching .errorType for callers.
function makeApiError(detail, fallback) {
  const err = new Error(parseErrorDetail(detail) || fallback);
  err.errorType = parseErrorType(detail);
  return err;
}

class ApiClient {
  constructor() {
    this.baseURL = BASE_URL;
    this.jetsonBaseURL = JETSON_BASE_URL;
    this.token = localStorage.getItem('visionai_token');
    this.refreshToken = localStorage.getItem('visionai_refresh_token');
    this.user = JSON.parse(localStorage.getItem('visionai_user') || 'null');
    this._refreshing = null;
  }

  getAuthHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    return headers;
  }

  async requestWithoutAuth(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    };
    const response = await fetch(url, config);
    const data = await response.json();
    if (!response.ok) {
      throw makeApiError(data?.detail, `API Error: ${response.statusText}`);
    }
    return data;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      ...options,
      headers: { ...this.getAuthHeaders(), ...(options.headers || {}) },
    };

    try {
      const response = await fetch(url, config);

      if (response.status === 401) {
        const refreshed = await this._tryRefresh();
        if (refreshed) {
          config.headers['Authorization'] = `Bearer ${this.token}`;
          const retry = await fetch(url, config);
          if (retry.status === 401) {
            this._clearSession();
            throw new Error('Session expired. Please login again.');
          }
          const retryData = await retry.json();
          if (!retry.ok) {
            throw makeApiError(retryData?.detail, `API Error: ${retry.statusText}`);
          }
          return retryData;
        }
        this._clearSession();
        throw new Error('Session expired. Please login again.');
      }

      const data = await response.json();
      if (!response.ok) {
        throw makeApiError(data?.detail, `API Error: ${response.statusText}`);
      }
      return data;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  }

  async get(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'GET' });
  }

  async post(endpoint, body, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  async put(endpoint, body, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  async delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  }

  async *sseRequest(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      ...options,
      headers: { ...this.getAuthHeaders(), Accept: 'text/event-stream', ...(options.headers || {}) },
    };

    const response = await fetch(url, config);
    if (response.status === 401) {
      this._clearSession();
      throw new Error('Session expired. Please login again.');
    }
    if (!response.ok) {
      let err = null;
      try { err = await response.json(); } catch (_) {
        let msg = `API Error: ${response.statusText}`;
        try { const t = await response.text(); if (t) msg = t; } catch (_) {}
        throw new Error(msg);
      }
      throw makeApiError(err?.detail, `API Error: ${response.statusText}`);
    }
    if (!response.body || typeof response.body.getReader !== 'function') {
      throw new Error('Streaming not supported in this environment.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    function parseEventBlock(block) {
      let eventName = 'message';
      const dataLines = [];
      for (const line of String(block || '').split(/\r?\n/)) {
        if (!line || line.startsWith(':')) continue;
        if (line.startsWith('event:')) { eventName = line.slice('event:'.length).trim() || 'message'; continue; }
        if (line.startsWith('data:')) { dataLines.push(line.slice('data:'.length).trimStart()); }
      }
      const dataText = dataLines.join('\n');
      let data = dataText;
      try { data = dataText ? JSON.parse(dataText) : null; } catch (_) {}
      return { event: eventName, data };
    }

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replace(/\r\n/g, '\n');
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          yield parseEventBlock(block);
        }
      }
    } finally {
      try { reader.releaseLock(); } catch (_) {}
    }
  }

  async _tryRefresh() {
    if (!this.refreshToken) return false;
    if (!this._refreshing) {
      this._refreshing = (async () => {
        try {
          const data = await this.requestWithoutAuth('/api/v1/auth/refresh', {
            method: 'POST',
            body: JSON.stringify({ refresh_token: this.refreshToken }),
          });
          if (data.access_token) {
            this.token = data.access_token;
            localStorage.setItem('visionai_token', this.token);
            return true;
          }
          return false;
        } catch (err) {
          // auth_error means the refresh token is invalid/expired — clear immediately
          if (err?.errorType === 'auth_error') this._clearSession();
          return false;
        } finally {
          this._refreshing = null;
        }
      })();
    }
    return this._refreshing;
  }

  _clearSession() {
    this.token = null;
    this.refreshToken = null;
    this.user = null;
    localStorage.removeItem('visionai_token');
    localStorage.removeItem('visionai_refresh_token');
    localStorage.removeItem('visionai_user');
    window.dispatchEvent(new CustomEvent('authStateChanged', { detail: { loggedIn: false } }));
  }

  isAuthenticated() {
    return !!this.token;
  }

  // ── Cameras ──────────────────────────────────────────────────────────────

  async listCameras() {
    return this.get('/api/v1/cameras');
  }

  async getCamera(cameraId) {
    return this.get(`/api/v1/cameras/${encodeURIComponent(cameraId)}`);
  }

  async createCamera(payload) {
    const body = { name: payload.name, stream_url: payload.stream_url };
    if (payload.metadata) body.metadata = payload.metadata;
    return this.post('/api/v1/cameras', body);
  }

  async listAgentsByCamera(cameraId) {
    return this.get(`/api/v1/cameras/${encodeURIComponent(cameraId)}/agents`);
  }

  getAgentStreamWsURL(agentId) {
    if (!this.token) throw new Error('Not authenticated');
    const wsBase = this.jetsonBaseURL.replace('http://', 'ws://').replace('https://', 'wss://');
    return `${wsBase}/api/v1/agents/${encodeURIComponent(agentId)}/live/ws?token=${encodeURIComponent(this.token)}`;
  }

  // ── Events ───────────────────────────────────────────────────────────────

  async listEvents(range = 'all', limit = 50, skip = 0, cameraId = null, extra = {}) {
    const params = new URLSearchParams();
    params.set('range', range);
    params.set('limit', String(limit));
    params.set('skip', String(skip));
    if (cameraId) params.set('camera_id', String(cameraId));
    if (extra && extra.startTs) params.set('start_ts', String(extra.startTs));
    if (extra && extra.endTs) params.set('end_ts', String(extra.endTs));
    return this.get(`/api/v1/events?${params.toString()}`);
  }

  async getEvent(eventId) {
    return this.get(`/api/v1/events/${encodeURIComponent(eventId)}`);
  }

  async fetchEventImageObjectUrl(eventId) {
    if (!this.token) throw new Error('Not authenticated');
    const url = `${this.baseURL}/api/v1/events/${encodeURIComponent(eventId)}/image`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (res.status === 401) { this._clearSession(); throw new Error('Session expired. Please login again.'); }
    if (!res.ok) throw new Error('Failed to load event image');
    return URL.createObjectURL(await res.blob());
  }

  async fetchEventVideoObjectUrl(videoPath) {
    const serverPort = window.location.port || '3000';
    const serverHost = window.location.hostname || '127.0.0.1';
    const encodedPath = encodeURIComponent(videoPath);
    const videoUrl = `http://${serverHost}:${serverPort}/api/v1/videos/${encodedPath}`;
    const res = await fetch(videoUrl, { method: 'HEAD' });
    if (!res.ok) throw new Error(`Video file not accessible: ${res.status}`);
    return videoUrl;
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  connectWebSocket(onMessage, onError) {
    if (!this.token) throw new Error('Not authenticated');
    const wsUrl = this.baseURL.replace('http://', 'ws://').replace('https://', 'wss://');
    const ws = new WebSocket(`${wsUrl}/api/v1/notifications/ws?token=${this.token}`);

    ws.onmessage = (event) => {
      const raw = event?.data;
      if (raw === 'pong' || raw === 'ping') return;
      if (typeof raw === 'string') {
        const t = raw.trim();
        if (!t.startsWith('{') && !t.startsWith('[')) { if (onMessage) onMessage(raw); return; }
      }
      try {
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (onMessage) onMessage(data);
      } catch (e) { if (onError) onError(e); }
    };

    ws.onerror = (e) => { if (onError) onError(e); };
    ws.onclose = () => { setTimeout(() => { if (this.token) this.connectWebSocket(onMessage, onError); }, 5000); };
    setInterval(() => { if (ws.readyState === WebSocket.OPEN) ws.send('ping'); }, 30000);
    return ws;
  }

  async getNotificationPreferences() {
    return this.get('/api/v1/notifications/preferences');
  }

  async updateNotificationPreferences(payload) {
    return this.put('/api/v1/notifications/preferences', payload);
  }

  // ── Streams / Live camera & Agent overlay ────────────────────────────────

  getLiveWsURL(cameraId) {
    if (!this.token) throw new Error('Not authenticated');
    const wsBase = this.baseURL.replace('http://', 'ws://').replace('https://', 'wss://');
    return `${wsBase}/api/v1/streams/${encodeURIComponent(cameraId)}/live/ws?token=${encodeURIComponent(this.token)}`;
  }

  getLiveMimeCodec() {
    return 'video/mp4; codecs="avc1.42E01E"';
  }

  getAgentOverlayFramesWsURL(agentId) {
    if (!this.token) throw new Error('Not authenticated');
    const wsBase = this.baseURL.replace('http://', 'ws://').replace('https://', 'wss://');
    return `${wsBase}/api/v1/streams/agents/${encodeURIComponent(agentId)}/overlay/frames/ws?token=${encodeURIComponent(this.token)}`;
  }

  // ── Static video analysis ─────────────────────────────────────────────────

  async listStaticVideos() {
    return this.get('/api/v1/videos/static/library');
  }

  async staticVideoUpload(file, question = null) {
    const url = `${this.baseURL}/api/v1/videos/static`;
    const formData = new FormData();
    formData.append('file', file);
    if (question && String(question).trim()) formData.append('question', String(question).trim());
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(url, { method: 'POST', headers, body: formData });
    if (res.status === 401) { this._clearSession(); throw new Error('Session expired. Please login again.'); }
    const data = await res.json();
    if (!res.ok) throw new Error(parseErrorDetail(data?.detail) || `Upload failed: ${res.statusText}`);
    return data;
  }

  async staticVideoAsk(videoId, question) {
    const url = `${this.baseURL}/api/v1/videos/static/ask`;
    const formData = new FormData();
    formData.append('video_id', videoId);
    formData.append('question', question);
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(url, { method: 'POST', headers, body: formData });
    if (res.status === 401) { this._clearSession(); throw new Error('Session expired. Please login again.'); }
    const data = await res.json();
    if (!res.ok) throw new Error(parseErrorDetail(data?.detail) || `Request failed: ${res.statusText}`);
    return data;
  }

  // ── Chat streaming ───────────────────────────────────────────────────────

  async *chatWithAgentStream(message, sessionId = null, cameraId = null, zoneData = null, videoPath = null, resume = null, signal = null) {
    const payload = { session_id: sessionId, camera_id: cameraId, zone_data: zoneData, video_path: videoPath };
    if (resume != null) payload.resume = resume;
    else payload.message = message;
    yield* this.sseRequest('/api/v1/chat/message/stream', {
      method: 'POST',
      body: JSON.stringify(payload),
      signal: signal || undefined,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async *generalChatStream(message, sessionId = null, signal = null) {
    yield* this.sseRequest('/api/v1/general-chat/message/stream', {
      method: 'POST',
      body: JSON.stringify({ message, session_id: sessionId }),
      signal: signal || undefined,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  async uploadVideo(file) {
    const url = `${this.baseURL}/api/v1/videos/upload`;
    const formData = new FormData();
    formData.append('file', file);
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(url, { method: 'POST', headers, body: formData });
    if (res.status === 401) { this._clearSession(); throw new Error('Session expired. Please login again.'); }
    const data = await res.json();
    if (!res.ok) throw new Error(parseErrorDetail(data?.detail) || `Upload failed: ${res.statusText}`);
    return data;
  }

  async uploadReferencePhotos(name, files) {
    const url = `${this.baseURL}/api/v1/person-gallery/upload`;
    const formData = new FormData();
    formData.append('name', name);
    Array.from(files).forEach(f => formData.append('files', f));
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const res = await fetch(url, { method: 'POST', headers, body: formData });
    if (res.status === 401) { this._clearSession(); throw new Error('Session expired. Please login again.'); }
    const data = await res.json();
    if (!res.ok) throw new Error(parseErrorDetail(data?.detail) || `Upload failed: ${res.statusText}`);
    return data;
  }

  // ── Person Gallery ────────────────────────────────────────────────────────

  async getPersonGalleryList() {
    return this.get('/api/v1/person-gallery/list');
  }

  async fetchPersonImageObjectUrl(personId, index = 0) {
    if (!this.token) throw new Error('Not authenticated');
    const params = new URLSearchParams();
    if (index) params.set('index', String(index));
    const qs = params.toString() ? `?${params.toString()}` : '';
    const url = `${this.baseURL}/api/v1/person-gallery/image/${encodeURIComponent(personId)}${qs}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${this.token}` } });
    if (res.status === 401) { this._clearSession(); throw new Error('Session expired. Please login again.'); }
    if (!res.ok) throw new Error('Failed to load person image');
    return URL.createObjectURL(await res.blob());
  }
}

export const api = new ApiClient();

// Expose as window.visionAPI so legacy widget scripts (events-board-widget.js, etc.) can use it
window.visionAPI = api;
