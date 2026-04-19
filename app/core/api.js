import { BASE_URL, JETSON_BASE_URL } from './api-config.js';

function parseErrorDetail(detail) {
  if (detail == null) return '';
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const msgs = detail.filter(i => i && typeof i === 'object' && i.msg).map(i => i.msg);
    return msgs.length ? msgs.join('. ') : JSON.stringify(detail);
  }
  return String(detail);
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
      throw new Error(parseErrorDetail(data?.detail) || `API Error: ${response.statusText}`);
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
            throw new Error(parseErrorDetail(retryData?.detail) || `API Error: ${retry.statusText}`);
          }
          return retryData;
        }
        this._clearSession();
        throw new Error('Session expired. Please login again.');
      }

      const data = await response.json();
      if (!response.ok) {
        throw new Error(parseErrorDetail(data?.detail) || `API Error: ${response.statusText}`);
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
      let msg = `API Error: ${response.statusText}`;
      try { const err = await response.json(); msg = parseErrorDetail(err?.detail) || msg; } catch (_) {
        try { const t = await response.text(); if (t) msg = t; } catch (_) {}
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
        } catch (_) {
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
}

export const api = new ApiClient();
