/**
 * Preload script for Electron
 * This runs in a context that has access to both DOM APIs and Node.js APIs
 * but is isolated from the main world for security
 */

const { contextBridge } = require('electron');

// Expose protected methods that allow the renderer process to use
// specific Node.js functionality without exposing the entire Node.js API
contextBridge.exposeInMainWorld('electronAPI', {
  // Add any Electron-specific APIs here if needed in the future
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }
});

