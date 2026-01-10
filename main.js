const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const express = require('express');
const http = require('http');
const fs = require('fs');

// Avoid Windows cache permission issues
try {
  const userDataRoot = path.join(app.getPath('appData'), 'PhoenixDesktop');
  app.setPath('userData', userDataRoot);
  const cacheDir = path.join(userDataRoot, 'Cache');
  app.commandLine.appendSwitch('disk-cache-dir', cacheDir);
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
} catch {
  // ignore
}

let mainWindow = null;
let server = null;
const PORT = 3000;

/**
 * Start local HTTP server to serve static files
 * This is needed because fetch() doesn't work with file:// protocol
 */
function startLocalServer() {
  return new Promise((resolve, reject) => {
    const expressApp = express();
    const appPath = app.isPackaged 
      ? path.join(process.resourcesPath, 'app')
      : __dirname;

    // Serve favicon at root (Chromium requests /favicon.ico by default)
    expressApp.get('/favicon.ico', (req, res) => {
      const faviconPath = path.join(appPath, 'assets', 'img', 'favicons', 'favicon.ico');
      res.sendFile(faviconPath);
    });

    // Serve static files from the app directory
    expressApp.use(express.static(appPath));

    // Handle SPA routing - serve index.html for all routes
    expressApp.get('*', (req, res) => {
      // If it's a file request (has extension), try to serve it
      if (path.extname(req.path)) {
        const rel = req.path.replace(/^\/+/, '');
        const direct = path.join(appPath, rel);
        const inPages = path.join(appPath, 'pages', rel);

        // This fixes common mistakes like linking to /events-board.html instead of /pages/events-board.html
        if (fs.existsSync(direct)) return res.sendFile(direct);
        if (fs.existsSync(inPages)) return res.sendFile(inPages);

        return res.status(404).end();
      } else {
        // Otherwise serve the dashboard
        res.sendFile(path.join(appPath, 'pages', 'dashboard.html'));
      }
    });

    server = http.createServer(expressApp);
    
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Local server started on http://127.0.0.1:${PORT}`);
      resolve();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} already in use, trying next port...`);
        // Try next port
        server.listen(0, '127.0.0.1', () => {
          const actualPort = server.address().port;
          console.log(`Local server started on http://127.0.0.1:${actualPort}`);
          resolve();
        });
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Get the actual server port
 */
function getServerPort() {
  return server ? server.address().port : PORT;
}

/**
 * Create the main browser window
 * 
 * Debug Renderer Process (UI: HTML/CSS/JS)
 * 
 * 🔑 Open DevTools automatically
 * 
 * mainWindow.webContents.openDevTools();
 * 
 * Or toggle manually:
 * Ctrl + Shift + I
 * 
 * This works just like Chrome DevTools:
 * - Console logs
 * - Breakpoints
 * - Network tab
 * - DOM inspection
 */
function createWindow() {
  // Remove native menu bar
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'img', 'favicons', 'favicon.ico'),
    show: false // Don't show until ready
  });

  mainWindow.setMenuBarVisibility(false);

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // 🔑 Always open DevTools for debugging the renderer process/UI
    mainWindow.webContents.openDevTools();

    // If you only want DevTools in development, use:
    // if (process.env.NODE_ENV === 'development') {
    //   mainWindow.webContents.openDevTools();
    // }
  });

  // Load the dashboard page via local server
  const serverPort = getServerPort();
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/pages/dashboard.html`);

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

/**
 * Initialize the application
 */
async function initializeApp() {
  try {
    // Start local server first
    await startLocalServer();
    
    // Then create the window
    createWindow();
  } catch (error) {
    console.error('Failed to initialize app:', error);
    app.quit();
  }
}

// App event handlers
app.whenReady().then(() => {
  initializeApp();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      initializeApp();
    }
  });
});

app.on('window-all-closed', () => {
  // Close server when all windows are closed
  if (server) {
    server.close();
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  // Close server before quitting
  if (server) {
    server.close();
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
