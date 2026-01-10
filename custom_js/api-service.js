/**
 * Vision AI Backend API Service
 * Centralized API client for all backend communication
 */

class VisionAPIService {
  constructor() {
    // Backend URL - adjust this to your backend URL
    this.baseURL = 'http://localhost:8000';  // Vision backend
    this.jetsonBaseURL = 'http://localhost:8001';  // Jetson backend (adjust port if different)
    this.token = localStorage.getItem('visionai_token');
    this.user = JSON.parse(localStorage.getItem('visionai_user') || 'null');
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
      
      // Handle 401 Unauthorized - token expired
      if (response.status === 401) {
        this.logout();
        throw new Error('Session expired. Please login again.');
      }

      // Parse JSON response
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.detail || `API Error: ${response.statusText}`);
      }

      return data;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  }

  /**
   * Authentication Methods
   */
  async register(fullName, email, password) {
    const response = await this.request('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        full_name: fullName,
        email,
        password,
      }),
    });
    return response;
  }

  async login(email, password) {
    const response = await this.request('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
      }),
    });
    
    // Store token
    if (response.access_token) {
      this.token = response.access_token;
      localStorage.setItem('visionai_token', this.token);
      
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

  logout() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('visionai_token');
    localStorage.removeItem('visionai_user');
    window.dispatchEvent(new CustomEvent('authStateChanged', { detail: { loggedIn: false } }));
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
      this.logout();
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

  async createCamera(name, streamUrl, deviceId = null) {
    return await this.request('/api/v1/cameras/create', {
      method: 'POST',
      body: JSON.stringify({
        name,
        stream_url: streamUrl,
        device_id: deviceId,
      }),
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
  async listEvents(range = 'all', limit = 50, skip = 0) {
    const params = new URLSearchParams();
    params.set('range', range);
    params.set('limit', String(limit));
    params.set('skip', String(skip));
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
      this.logout();
      throw new Error('Session expired. Please login again.');
    }
    if (!res.ok) {
      throw new Error('Failed to load event image');
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  /**
   * Streaming Methods
   */
  async getStreamStatus(cameraId) {
    return await this.request(`/api/v1/streams/${cameraId}/status`);
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
   * MSE mime codec string for your camera (H.264 Main, level 5.0).
   * Verified with MediaSource.isTypeSupported(...) in Electron.
   */
  getLiveMimeCodec() {
    return 'video/mp4; codecs="avc1.4D0032"';
  }

  /**
   * Chat Methods
   */
  async chatWithAgent(message, sessionId = null, cameraId = null, zoneData = null) {
    return await this.request('/api/v1/chat/message', {
      method: 'POST',
      body: JSON.stringify({
        message,
        session_id: sessionId,
        camera_id: cameraId,
        zone_data: zoneData,
      }),
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
      throw new Error(error.detail || 'Voice chat error');
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
}

// Create singleton instance
window.visionAPI = new VisionAPIService();

