/**
 * Preload script for Electron
 * This runs in a context that has access to both DOM APIs and Node.js APIs
 * but is isolated from the main world for security
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// specific Node.js functionality without exposing the entire Node.js API
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  },

  readVideoFile: async (filePath) => {
    return await ipcRenderer.invoke('read-video-file', filePath);
  },

  /**
   * Set taskbar/dock badge count (like WhatsApp, Teams).
   * On Windows: overlay on taskbar icon. On macOS: dock badge.
   * Pass 0 to clear.
   */
  setBadgeCount: (count) => {
    ipcRenderer.send('set-badge-count', Math.max(0, parseInt(count, 10) || 0));
  }
});

