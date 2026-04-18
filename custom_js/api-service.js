/**
 * Vision AI Backend API Service
 * Centralized API client for all backend communication
 */

/**
 * Parse FastAPI/Pydantic error detail into a human-readable message.
 * - If detail is a string: return as-is
 * - If detail is an array of validation errors: join their .msg values
 * @param {string|Array<{msg?: string, loc?: string[], type?: string}>} detail
 * @returns {string}
 */
function parseErrorDetail(detail) {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .filter((item) => item && typeof item === 'object' && item.msg)
      .map((item) => item.msg);
    return messages.length ? messages.join('. ') : JSON.stringify(detail);
  }
  return String(detail);
}

class VisionAPIService {
  constructor() {
    // Backend URL - from api-config.js (desktop: localhost, mobile: deployed API)
    this.baseURL = (typeof window !== 'undefined' && window.VISION_API_BASE) ? window.VISION_API_BASE : 'http://127.0.0.1:8000';
    this.jetsonBaseURL = (typeof window !== 'undefined' && window.VISION_JETSON_BASE) ? window.VISION_JETSON_BASE : 'http://localhost:8001';
    this.token = localStorage.getItem('visionai_token');
    this.refreshToken = localStorage.getItem('visionai_refresh_token');
    this.user = JSON.parse(localStorage.getItem('visionai_user') || 'null');
    this._refreshing = null; // in-flight refresh promise
  }

  /**
   * Get authentication headers
   */
  getAuthHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };
    
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    
    return headers;
  }

  /**
   * Make authenticated API request
   */
  async request(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      ...options,
      headers: {
        ...this.getAuthHeaders(),
        ...(options.headers || {}),
      },
    };

    try {
      const response = await fetch(url, config);

      // Handle 401 Unauthorized - attempt token refresh before logging out
      if (response.status === 401) {
        const refreshed = await this._tryRefresh();
        if (refreshed) {
          // Retry original request with new token
          config.headers['Authorization'] = `Bearer ${this.token}`;
          const retry = await fetch(url, config);
          if (retry.status === 401) {
            this._clearSession();
            throw new Error('Session expired. Please login again.');
          }
          const retryData = await retry.json();
          if (!retry.ok) {
            const msg = parseErrorDetail(retryData?.detail) || `API Error: ${retry.statusText}`;
            throw new Error(msg);
          }
          return retryData;
        }
        this._clearSession();
        throw new Error('Session expired. Please login again.');
      }

      // Parse JSON response
      const data = await response.json();
      
      if (!response.ok) {
        const msg = parseErrorDetail(data?.detail) || `API Error: ${response.statusText}`;
        throw new Error(msg);
      }

      return data;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  }

  /**
   * Stream an endpoint that returns Server-Sent Events (SSE).
   *
   * This uses fetch() (not EventSource) so we can send Authorization headers.
   *
   * Yields objects: { event: string, data: any }
   */
  async *sseRequest(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      ...options,
      headers: {
        ...this.getAuthHeaders(),
        Accept: 'text/event-stream',
        ...(options.headers || {}),
      },
    };

    const response = await fetch(url, config);

    if (response.status === 401) {
      this._clearSession();
      throw new Error('Session expired. Please login again.');
    }
    if (!response.ok) {
      // Best-effort: parse JSON error, else plain text
      let msg = `API Error: ${response.statusText}`;
      try {
        const err = await response.json();
        msg = parseErrorDetail(err?.detail) || msg;
      } catch (_) {
        try {
          const t = await response.text();
          if (t) msg = t;
        } catch (_) {}
      }
      throw new Error(msg);
    }

    if (!response.body || typeof response.body.getReader !== 'function') {
      throw new Error('Streaming not supported in this environment.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    function parseEventBlock(block) {
      // SSE block: multiple lines; blank line terminates the event.
      // We support: "event: name" and one or more "data: ..." lines.
      let eventName = 'message';
      const dataLines = [];
      const lines = String(block || '').split(/\r?\n/);
      for (const line of lines) {
        if (!line) continue;
        if (line.startsWith(':')) continue; // comment/heartbeat
        if (line.startsWith('event:')) {
          eventName = line.slice('event:'.length).trim() || 'message';
          continue;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart());
          continue;
        }
      }
      const dataText = dataLines.join('\n');
      let data = dataText;
      try {
        data = dataText ? JSON.parse(dataText) : null;
      } catch (_) {
        // keep as string
      }
      return { event: eventName, data };
    }

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // Normalize newlines for simpler SSE parsing (handles \r\n coming from some servers/proxies)
        buffer = buffer.replace(/\r\n/g, '\n');

        // Process complete SSE blocks separated by blank line
        let idx;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const parsed = parseEventBlock(block);
          yield parsed;
        }
      }
    } finally {
      try { reader.releaseLock(); } catch (_) {}
    }
  }

  /**
   * Authentication Methods
   */
  async register(fullName, email, password) {
    // Use unauthenticated request - register does not require a token
    const response = await this.requestWithoutAuth('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        full_name: fullName,
        email,
        password,
      }),
    });
    return response;
  }

  /**
   * Make API request without auth header (for login, register - avoids 401 from expired token)
   */
  async requestWithoutAuth(endpoint, options = {}) {
    const url = `${this.baseURL}${endpoint}`;
    const config = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    };
    const response = await fetch(url, config);
    const data = await response.json();
    if (!response.ok) {
      const msg = parseErrorDetail(data?.detail) || `API Error: ${response.statusText}`;
      throw new Error(msg);
    }
    return data;
  }

  async login(email, password) {
    // Use unauthenticated request - do NOT send expired/invalid token to login endpoint
    const response = await this.requestWithoutAuth('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
      }),
    });
    
    // Store tokens
    if (response.access_token) {
      this.token = response.access_token;
      localStorage.setItem('visionai_token', this.token);
      if (response.refresh_token) {
        this.refreshToken = response.refresh_token;
        localStorage.setItem('visionai_refresh_token', this.refreshToken);
      }
      
      // Fetch user details
      const user = await this.getCurrentUser();
      this.user = user;
      localStorage.setItem('visionai_user', JSON.stringify(user));
      
      // Trigger auth state change event
      window.dispatchEvent(new CustomEvent('authStateChanged', { detail: { loggedIn: true, user } }));
    }
    
    return response;
  }

  async getCurrentUser() {
    return await this.request('/api/v1/auth/me');
  }

  async logout() {
    if (this.refreshToken) {
      try {
        await this.requestWithoutAuth('/api/v1/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refresh_token: this.refreshToken }),
        });
      } catch (_) {
        // Ignore errors — always clear local session
      }
    }
    this._clearSession();
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

  async _tryRefresh() {
    if (!this.refreshToken) return false;
    // Deduplicate concurrent refresh calls
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
        } catch (_) {
          return false;
        } finally {
          this._refreshing = null;
        }
      })();
    }
    return this._refreshing;
  }

  isAuthenticated() {
    return !!this.token;
  }

  async checkAuth() {
    if (!this.token) return false;
    
    try {
      const user = await this.getCurrentUser();
      this.user = user;
      localStorage.setItem('visionai_user', JSON.stringify(user));
      return true;
    } catch (error) {
      this._clearSession();
      return false;
    }
  }

  /**
   * Camera Methods
   */
  async listCameras() {
    return await this.request('/api/v1/cameras/list');
  }

  async getCamera(cameraId) {
    return await this.request(`/api/v1/cameras/get/${cameraId}`);
  }

  /**
   * Create a new camera
   * @param {Object} payload - { name, stream_url, metadata?: { location?: { area, zone }, tags?: string[] } }
   */
  async createCamera(payload) {
    const body = {
      name: payload.name,
      stream_url: payload.stream_url,
    };
    if (payload.metadata) {
      body.metadata = payload.metadata;
    }
    return await this.request('/api/v1/cameras/create', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async listAgentsByCamera(cameraId) {
    return await this.request(`/api/v1/cameras/${cameraId}/agents`);
  }

  async getWebRTCConfig() {
    return await this.request('/api/v1/cameras/webrtc-config');
  }

  /**
   * Get agent stream WebSocket URL (from jetson backend)
   * Streams agent-processed frames with bounding boxes
   */
  getAgentStreamWsURL(agentId) {
    if (!this.token) throw new Error('Not authenticated');
    const wsBase = this.jetsonBaseURL.replace('http://', 'ws://').replace('https://', 'wss://');
    // Optional: Add token if jetson backend requires auth
    return `${wsBase}/api/v1/agents/${encodeURIComponent(agentId)}/live/ws?token=${encodeURIComponent(this.token)}`;
  }

  /**
   * Events API
   */
  /**
   * @param {string} range - today | yesterday | all
   * @param {number} limit
   * @param {number} skip
   * @param {string|null} cameraId - optional (client may filter if unsupported)
   * @param {{ startTs?: string, endTs?: string }} [extra] - ISO timestamps override range (backend events API)
   */
  async listEvents(range = 'all', limit = 50, skip = 0, cameraId = null, extra = {}) {
    const params = new URLSearchParams();
    params.set('range', range);
    params.set('limit', String(limit));
    params.set('skip', String(skip));
    if (cameraId) params.set('camera_id', String(cameraId));
    if (extra && extra.startTs) params.set('start_ts', String(extra.startTs));
    if (extra && extra.endTs) params.set('end_ts', String(extra.endTs));
    return await this.request(`/api/v1/events?${params.toString()}`);
  }

  async getEvent(eventId) {
    return await this.request(`/api/v1/events/${encodeURIComponent(eventId)}`);
  }

  async fetchEventImageObjectUrl(eventId) {
    if (!this.token) throw new Error('Not authenticated');
    const url = `${this.baseURL}/api/v1/events/${encodeURIComponent(eventId)}/image`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${this.token}` } });
    if (res.status === 401) {
      this._clearSession();
      throw new Error('Session expired. Please login again.');
    }
    if (!res.ok) {
      throw new Error('Failed to load event image');
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  /**
   * Fetch event video URL from local file system (Electron only)
   * Serves video through local HTTP server instead of blob for better codec support
   * @param {string} videoPath - Absolute path to video file
   * @returns {Promise<string>} URL to the video file served by local server
   */
  async fetchEventVideoObjectUrl(videoPath) {
    // Use HTTP server approach instead of blob for better codec support
    // This works by serving the video file through the Express server
    try {
      console.log('[API] Fetching video from path:', videoPath);
      
      // Get the server port (from window.location or default)
      const serverPort = window.location.port || '3000';
      const serverHost = window.location.hostname || '127.0.0.1';
      
      // Encode the file path for URL (handle Windows paths with backslashes)
      const encodedPath = encodeURIComponent(videoPath.replace(/\\/g, '/'));
      
      // Create URL to serve video through Express server
      const videoUrl = `http://${serverHost}:${serverPort}/api/v1/videos/${encodedPath}`;
      
      console.log('[API] Video URL created:', videoUrl);
      
      // Verify the file exists by making a HEAD request
      try {
        const response = await fetch(videoUrl, { method: 'HEAD' });
        if (!response.ok) {
          throw new Error(`Video file not found or not accessible: ${response.status}`);
        }
        console.log('[API] Video file verified, size:', response.headers.get('Content-Length'), 'bytes');
      } catch (err) {
        console.error('[API] Video file verification failed:', err);
        throw new Error(`Failed to access video file: ${err.message}`);
      }
      
      return videoUrl;
    } catch (error) {
      console.error('[API] Error fetching video file:', error);
      throw new Error(`Failed to load video: ${error.message}`);
    }
  }

  /**
   * Streaming Methods
   */
  async getStreamStatus(cameraId) {
    return await this.request(`/api/v1/streams/${cameraId}/status`);
  }

  /**
   * Fetch a single JPEG snapshot for a camera (for zone drawing UI).
   *
   * Returns: Blob (image/jpeg)
   */
  async getCameraSnapshot(cameraId) {
    if (!this.token) throw new Error('Not authenticated');
    const url = `${this.baseURL}/api/v1/streams/${encodeURIComponent(cameraId)}/snapshot.jpg`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      let msg = 'Failed to fetch snapshot';
      try {
        const data = await response.json();
        msg = parseErrorDetail(data?.detail) || msg;
      } catch (_) {
        // ignore (non-json)
      }
      throw new Error(msg);
    }

    return await response.blob();
  }

  /**
   * Fetch a single JPEG snapshot for a camera from a specific URL (for zone drawing UI).
   * Returns JSON with base64-encoded frame and metadata.
   * @param {string} snapshotUrl - Snapshot URL (can be relative or absolute)
   * @returns {Promise<{camera_id: string, width: number, height: number, format: string, frame_base64: string}>}
   */
  async getCameraSnapshotFromUrl(snapshotUrl) {
    if (!this.token) throw new Error('Not authenticated');
    // Ensure URL is absolute (prepend baseURL if relative)
    const url = snapshotUrl.startsWith('http') 
      ? snapshotUrl 
      : `${this.baseURL}${snapshotUrl.startsWith('/') ? '' : '/'}${snapshotUrl}`;
    
    console.log('[API] Fetching camera snapshot from:', url);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Cache-Control': 'no-cache',
      },
    });

    console.log('[API] Snapshot response status:', response.status, response.statusText);
    console.log('[API] Snapshot response headers:', Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      let msg = 'Failed to fetch snapshot';
      try {
        const data = await response.json();
        console.error('[API] Snapshot error response:', data);
        msg = parseErrorDetail(data?.detail) || msg;
      } catch (_) {
        // ignore (non-json)
      }
      throw new Error(msg);
    }

    const jsonData = await response.json();
    console.log('[API] Snapshot response data:', {
      camera_id: jsonData?.camera_id,
      width: jsonData?.width,
      height: jsonData?.height,
      format: jsonData?.format,
      frame_base64_length: jsonData?.frame_base64?.length || 0,
      frame_base64_preview: jsonData?.frame_base64?.substring(0, 100) + '...' || 'missing'
    });
    console.log('[API] Full snapshot response:', jsonData);

    return jsonData;
  }

  /**
   * Build live WS URL for fMP4 streaming.
   * Backend expects token in query string: ?token=...
   *
   * Note: We build from baseURL to avoid relying on /status, but you can
   * still call getStreamStatus(cameraId) for health + viewer count.
   */
  getLiveWsURL(cameraId) {
    if (!this.token) throw new Error('Not authenticated');
    const wsBase = this.baseURL.replace('http://', 'ws://').replace('https://', 'wss://');
    return `${wsBase}/api/v1/streams/${cameraId}/live/ws?token=${encodeURIComponent(this.token)}`;
  }

  /**
   * Agent processed video stream (fMP4 over WebSocket).
   * Same format as live camera stream; use createWsFmp4Player with this URL.
   */
  /**
   * WebSocket URL for agent processed stream (fMP4 chunks). Use for MSE playback.
   */
  getAgentOverlayWsURL(agentId) {
    if (!this.token) throw new Error('Not authenticated');
    const wsBase = this.baseURL.replace('http://', 'ws://').replace('https://', 'wss://');
    return `${wsBase}/api/v1/streams/agents/${encodeURIComponent(agentId)}/overlay/ws?token=${encodeURIComponent(this.token)}`;
  }

  /**
   * WebSocket URL for agent processed frames (JPEG per frame). Use for direct frame display without fMP4.
   */
  getAgentOverlayFramesWsURL(agentId) {
    if (!this.token) throw new Error('Not authenticated');
    const wsBase = this.baseURL.replace('http://', 'ws://').replace('https://', 'wss://');
    return `${wsBase}/api/v1/streams/agents/${encodeURIComponent(agentId)}/overlay/frames/ws?token=${encodeURIComponent(this.token)}`;
  }

  /**
   * MSE mime codec string for your camera (H.264 Main, level 5.0).
   * Verified with MediaSource.isTypeSupported(...) in Electron.
   */
  getLiveMimeCodec() {
      // avc1.42E01E = Constrained Baseline, broadly compatible
      // OR: let the backend report actual codec params from FFmpeg
      return 'video/mp4; codecs="avc1.42E01E"';
  }

  /**
   * Chat Methods
   */
  async chatWithAgent(message, sessionId = null, cameraId = null, zoneData = null, videoPath = null, resume = null) {
    const payload = {
      session_id: sessionId,
      camera_id: cameraId,
      zone_data: zoneData,
      video_path: videoPath,
    };
    if (resume != null) {
      payload.resume = resume;
    } else {
      payload.message = message;
    }
    return await this.request('/api/v1/chat/message', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async *chatWithAgentStream(message, sessionId = null, cameraId = null, zoneData = null, videoPath = null, resume = null, signal = null) {
    const payload = {
      session_id: sessionId,
      camera_id: cameraId,
      zone_data: zoneData,
      video_path: videoPath,
    };
    if (resume != null) {
      payload.resume = resume;
    } else {
      payload.message = message;
    }
    const body = JSON.stringify(payload);
    yield* this.sseRequest('/api/v1/chat/message/stream', {
      method: 'POST',
      body,
      signal: signal || undefined,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Upload a video file for "create agent for this video" in chat.
   * @param {File} file - Video file (e.g. from input type=file)
   * @returns {Promise<{ video_path: string, filename: string }>}
   */
  async uploadVideo(file) {
    const url = `${this.baseURL}/api/v1/videos/upload`;
    const formData = new FormData();
    formData.append('file', file);
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (response.status === 401) {
      this._clearSession();
      throw new Error('Session expired. Please login again.');
    }
    const data = await response.json();
    if (!response.ok) {
      const msg = parseErrorDetail(data?.detail) || `Upload failed: ${response.statusText}`;
      throw new Error(msg);
    }
    return data;
  }

  /**
   * Upload video + optional question. Single endpoint: upload and analyze.
   * If question: analyze with it; else use general prompt.
   * @param {File} file - Video file
   * @param {string|null} question - Optional question for focused analysis
   * @returns {Promise<{ video_id: string, status: string, indexing: string }>}
   */
  async staticVideoUpload(file, question = null) {
    const url = `${this.baseURL}/api/v1/videos/static`;
    const formData = new FormData();
    formData.append('file', file);
    if (question && String(question).trim()) {
      formData.append('question', String(question).trim());
    }
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (response.status === 401) {
      this._clearSession();
      throw new Error('Session expired. Please login again.');
    }
    const data = await response.json();
    if (!response.ok) {
      const msg = parseErrorDetail(data?.detail) || `Upload failed: ${response.statusText}`;
      throw new Error(msg);
    }
    return data;
  }

  /**
   * Ask question about an uploaded video. Uses RAG first; reanalyzes only when needed.
   * @param {string} videoId - Video ID from staticVideoUpload
   * @param {string} question - User question
   * @returns {Promise<{ answer: string }>}
   */
  async staticVideoAsk(videoId, question) {
    const url = `${this.baseURL}/api/v1/videos/static/ask`;
    const formData = new FormData();
    formData.append('video_id', videoId);
    formData.append('question', question);
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (response.status === 401) {
      this._clearSession();
      throw new Error('Session expired. Please login again.');
    }
    const data = await response.json();
    if (!response.ok) {
      const msg = parseErrorDetail(data?.detail) || `Ask failed: ${response.statusText}`;
      throw new Error(msg);
    }
    return data;
  }

  /**
   * List static videos uploaded by the current user.
   * @returns {Promise<{ videos: Array<{ video_id: string, video_path: string, filename: string, created_at?: string }> }>}
   */
  async listStaticVideos() {
    return await this.request('/api/v1/videos/static/library', {
      method: 'GET',
    });
  }

  async generalChat(message, sessionId = null) {
    return await this.request('/api/v1/general-chat/message', {
      method: 'POST',
      body: JSON.stringify({
        message,
        session_id: sessionId,
      }),
    });
  }

  async *generalChatStream(message, sessionId = null, signal = null) {
    const body = JSON.stringify({
      message,
      session_id: sessionId,
    });
    yield* this.sseRequest('/api/v1/general-chat/message/stream', {
      method: 'POST',
      body,
      signal: signal || undefined,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async voiceChat(audioFile, sessionId = null) {
    const formData = new FormData();
    formData.append('audio_file', audioFile);
    if (sessionId) {
      formData.append('session_id', sessionId);
    }

    const url = `${this.baseURL}/api/v1/general-chat/voice-message`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(parseErrorDetail(error?.detail) || 'Voice chat error');
    }

    // Get session ID from header
    const finalSessionId = response.headers.get('X-Session-Id');
    const textResponse = response.headers.get('X-Text-Response');

    // Return audio blob and metadata
    const audioBlob = await response.blob();
    return {
      audioBlob,
      sessionId: finalSessionId,
      textResponse,
    };
  }

  /**
   * Stream voice chat with real-time events via Server-Sent Events (SSE)
   * @param {File} audioFile - Audio file to transcribe
   * @param {string|null} sessionId - Optional session ID
   * @param {Function} onEvent - Callback for each event: (eventType, data) => void
   * @returns {Promise<{sessionId: string}>} Final session ID
   */
  async voiceChatStream(audioFile, sessionId = null, onEvent = null) {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('audio_file', audioFile);
      if (sessionId) {
        formData.append('session_id', sessionId);
      }

      const url = `${this.baseURL}/api/v1/general-chat/voice-message/stream`;
      
      // Use fetch with ReadableStream for SSE
      fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
        },
        body: formData,
      })
        .then(response => {
          if (!response.ok) {
            return response.json().then(err => {
              throw new Error(parseErrorDetail(err?.detail) || 'Voice chat stream error');
            });
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let finalSessionId = sessionId;

          function processChunk() {
            reader.read().then(({ done, value }) => {
              if (done) {
                resolve({ sessionId: finalSessionId });
                return;
              }

              // Decode chunk and add to buffer
              buffer += decoder.decode(value, { stream: true });

              // Process complete SSE messages (ending with \n\n)
              // Split by double newline to get complete messages
              const messages = buffer.split('\n\n');
              buffer = messages.pop() || ''; // Keep incomplete message in buffer

              for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
                const message = messages[msgIdx];
                if (!message.trim()) continue;

                let eventType = 'message';
                let eventData = '';

                // Parse each message line by line
                const lines = message.split('\n');
                for (let i = 0; i < lines.length; i++) {
                  const line = lines[i];
                  if (line.startsWith('event: ')) {
                    eventType = line.substring(7).trim();
                  } else if (line.startsWith('data: ')) {
                    // Handle multi-line data (SSE allows data: on multiple lines)
                    const dataLine = line.substring(6);
                    if (eventData) {
                      eventData += '\n' + dataLine;
                    } else {
                      eventData = dataLine;
                    }
                  }
                }

                // Process the complete message
                if (eventData) {
                  try {
                    const data = JSON.parse(eventData);
                    
                    console.log('[API] Parsed SSE event:', eventType, 'data keys:', Object.keys(data));
                    
                    // Call event handler
                    if (onEvent) {
                      try {
                        onEvent(eventType, data);
                      } catch (err) {
                        console.error('[API] Error in event handler:', err);
                      }
                    }

                    // Track session ID from done event
                    if (eventType === 'done' && data.session_id) {
                      finalSessionId = data.session_id;
                    }

                    // Handle errors
                    if (eventType === 'error') {
                      reject(new Error(data.message || 'Unknown error'));
                      return;
                    }
                  } catch (e) {
                    console.warn('[API] Failed to parse SSE data:', eventData.substring(0, 100), e);
                  }
                }
              }

              // Continue reading
              processChunk();
            }).catch(err => {
              reject(err);
            });
          }

          processChunk();
        })
        .catch(err => {
          reject(err);
        });
    });
  }

  /**
   * Device Methods
   */
  async listDevices() {
    return await this.request('/api/v1/devices/list');
  }

  async createDevice(name, deviceType, deviceInfo) {
    return await this.request('/api/v1/devices/create', {
      method: 'POST',
      body: JSON.stringify({
        name,
        device_type: deviceType,
        ...deviceInfo,
      }),
    });
  }

  /**
   * Register FCM token for push notifications (mobile).
   * Backend should associate token with current user if authenticated.
   */
  async registerFcmToken(token) {
    return await this.request('/api/v1/devices/register-fcm', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  /**
   * WebSocket Connection for Notifications
   */
  connectWebSocket(onMessage, onError) {
    if (!this.token) {
      throw new Error('Not authenticated');
    }

    const wsUrl = this.baseURL.replace('http://', 'ws://').replace('https://', 'wss://');
    const ws = new WebSocket(`${wsUrl}/api/v1/notifications/ws?token=${this.token}`);

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const raw = event?.data;
      // Backend keep-alive uses plain text "pong" / "ping"
      if (raw === 'pong' || raw === 'ping') return;

      // Some servers may send plain text messages; only parse JSON when applicable
      if (typeof raw === 'string') {
        const t = raw.trim();
        const looksJson = t.startsWith('{') || t.startsWith('[');
        if (!looksJson) {
          if (onMessage) onMessage(raw);
          return;
        }
      }

      try {
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (onMessage) onMessage(data);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error, raw);
        if (onError) onError(error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      if (onError) onError(error);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      // Optionally reconnect after delay
      setTimeout(() => {
        if (this.token) {
          this.connectWebSocket(onMessage, onError);
        }
      }, 5000);
    };

    // Keep-alive ping
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send('ping');
      }
    }, 30000);

    return ws;
  }

  /**
   * Video Chunks Methods
   */
  async listVideoChunks(sessionId) {
    return await this.request(`/api/v1/notifications/video-chunks/${sessionId}`);
  }

  async getVideoChunk(sessionId, chunkNumber) {
    const url = `${this.baseURL}/api/v1/notifications/video-chunks/${sessionId}/${chunkNumber}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch video chunk');
    }

    return response.blob();
  }

  /**
   * Person Gallery: upload reference photos for face recognition (minimum 4 per person).
   * Photos are stored in Gallery/<name>/ and metadata in MongoDB person_gallery.
   * @param {string} name - Person's name (e.g. "sachin")
   * @param {FileList|File[]} files - At least 4 image files (JPEG/PNG/WebP, one face per image)
   * @returns {Promise<{id: string, name: string, image_count: number, uploaded_at: string, status: string}>}
   */
  async uploadReferencePhotos(name, files) {
    const url = `${this.baseURL}/api/v1/person-gallery/upload`;
    const formData = new FormData();
    formData.append('name', name.trim());
    const fileList = Array.isArray(files) ? files : (files && typeof files.length === 'number' ? Array.from(files) : []);
    for (let i = 0; i < fileList.length; i++) {
      formData.append('files', fileList[i]);
    }

    const headers = {};
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (response.status === 401) {
      this._clearSession();
      throw new Error('Session expired. Please login again.');
    }

    const data = await response.json();
    if (!response.ok) {
      const msg = Array.isArray(data.detail)
        ? data.detail.map(function (d) { return d.msg || JSON.stringify(d); }).join(' ')
        : (data.detail || `Upload failed: ${response.statusText}`);
      throw new Error(msg);
    }
    return data;
  }

  /**
   * Notification Preferences: get current user's notification settings.
   * @returns {Promise<{user_id, channels, by_severity, by_type}>}
   */
  async getNotificationPreferences() {
    return await this.request('/api/v1/notifications/preferences');
  }

  /**
   * Notification Preferences: update current user's notification settings.
   * @param {Object} payload - { channels?, by_severity?, by_type? }
   */
  async updateNotificationPreferences(payload) {
    return await this.request('/api/v1/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Register FCM device token for push notifications.
   * Uses auth headers when user is logged in; token is associated with that user.
   * @param {string} token - FCM device token
   * @returns {Promise<{message: string, user_id?: string}>}
   */
  async registerFcmToken(token) {
    return await this.request('/api/v1/devices/register-fcm', {
      method: 'POST',
      body: JSON.stringify({ token: String(token).trim() }),
    });
  }

  /**
   * Person Gallery: list all persons (reference photos) in the gallery.
   * @returns {Promise<Array<{id: string, name: string, image: string, uploaded_at: string, status: string}>>}
   */
  async getPersonGalleryList() {
    return await this.request('/api/v1/person-gallery/list');
  }

  /**
   * Person Gallery: fetch one gallery image as an object URL (auth-aware).
   * Used for showing small thumbnails in the UI.
   * @param {string} personId
   * @param {number} index
   * @returns {Promise<string>} object URL for use as <img src>
   */
  async fetchPersonImageObjectUrl(personId, index = 0) {
    if (!this.token) throw new Error('Not authenticated');
    const params = new URLSearchParams();
    if (index) params.set('index', String(index));
    const url = `${this.baseURL}/api/v1/person-gallery/image/${encodeURIComponent(personId)}${params.toString() ? `?${params.toString()}` : ''}`;
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${this.token}` } });
    if (res.status === 401) {
      this._clearSession();
      throw new Error('Session expired. Please login again.');
    }
    if (!res.ok) {
      throw new Error('Failed to load person image');
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }
}

// Create singleton instance
window.visionAPI = new VisionAPIService();

