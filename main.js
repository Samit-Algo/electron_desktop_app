const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const express = require('express');
const http = require('http');
const fs = require('fs');

// Avoid Windows cache permission issues
try {
  const userDataRoot = path.join(app.getPath('appData'), 'AlgoVision');
  app.setPath('userData', userDataRoot);
  const cacheDir = path.join(userDataRoot, 'Cache');
  app.commandLine.appendSwitch('disk-cache-dir', cacheDir);
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
} catch {
  // ignore
}

let mainWindow = null;
let server = null;
let actualServerPort = 3000;
const PORT = 3000;

function getAppPath() {
  // Works correctly in both dev and packaged (asar) builds
  return app.getAppPath();
}

function startLocalServer() {
  return new Promise((resolve, reject) => {
    const expressApp = express();
    const appPath = getAppPath();

    // Serve favicon
    expressApp.get('/favicon.ico', (req, res) => {
      const faviconPath = path.join(appPath, 'assets', 'img', 'favicons', 'favicon.ico');
      if (fs.existsSync(faviconPath)) {
        res.sendFile(faviconPath);
      } else {
        res.status(404).end();
      }
    });

    // Serve video files
    expressApp.get('/api/v1/videos/:filename(*)', (req, res) => {
      try {
        const filename = req.params.filename;
        if (!filename.match(/\.(mp4|webm|ogg|avi|mov|mkv)$/i)) {
          return res.status(400).json({ error: 'Invalid file type' });
        }

        const decodedPath = decodeURIComponent(filename);
        const normalizedPath = path.normalize(decodedPath);

        if (!fs.existsSync(normalizedPath)) {
          console.log('[Server] Video file not found:', normalizedPath);
          return res.status(404).json({ error: 'Video file not found' });
        }

        const stats = fs.statSync(normalizedPath);
        if (!stats.isFile()) {
          return res.status(400).json({ error: 'Not a file' });
        }

        const ext = path.extname(normalizedPath).toLowerCase();
        const mimeTypes = {
          '.mp4': 'video/mp4',
          '.webm': 'video/webm',
          '.ogg': 'video/ogg',
          '.avi': 'video/x-msvideo',
          '.mov': 'video/quicktime',
          '.mkv': 'video/x-matroska'
        };
        const contentType = mimeTypes[ext] || 'video/mp4';

        const range = req.headers.range;
        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
          const chunksize = (end - start) + 1;
          const file = fs.createReadStream(normalizedPath, { start, end });

          res.status(206);
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
          res.setHeader('Content-Length', chunksize);
          res.setHeader('Accept-Ranges', 'bytes');
          file.pipe(res);
        } else {
          res.setHeader('Content-Type', contentType);
          res.setHeader('Content-Length', stats.size);
          res.setHeader('Accept-Ranges', 'bytes');
          res.sendFile(normalizedPath);
        }
      } catch (error) {
        console.error('[Server] Error serving video:', error);
        res.status(500).json({ error: 'Error serving video file' });
      }
    });

    // Serve static files
    expressApp.use(express.static(appPath));

    // SPA routing fallback
    expressApp.get('*', (req, res) => {
      if (path.extname(req.path)) {
        const rel = req.path.replace(/^\/+/, '');
        const direct = path.join(appPath, rel);
        const inPages = path.join(appPath, 'pages', rel);

        if (fs.existsSync(direct)) return res.sendFile(direct);
        if (fs.existsSync(inPages)) return res.sendFile(inPages);

        return res.status(404).end();
      } else {
        res.sendFile(path.join(appPath, 'app', 'index.html'));
      }
    });

    server = http.createServer(expressApp);

    server.listen(PORT, '127.0.0.1', () => {
      actualServerPort = server.address().port;
      console.log(`Local server started on http://127.0.0.1:${actualServerPort}`);
      resolve();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${PORT} in use, finding available port...`);
        server.listen(0, '127.0.0.1', () => {
          actualServerPort = server.address().port;
          console.log(`Local server started on http://127.0.0.1:${actualServerPort}`);
          resolve();
        });
      } else {
        reject(err);
      }
    });
  });
}

function getServerPort() {
  if (server && server.listening) {
    return server.address().port;
  }
  return actualServerPort;
}

function createWindow() {
  Menu.setApplicationMenu(null);

  const appPath = getAppPath();
  const isDev = !app.isPackaged;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#7a8195',
      height: 40
    },
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // FIX: use appPath instead of __dirname so it works when packaged
      preload: path.join(appPath, 'preload.js')
    },
    // Window and taskbar icon: AlgoOrange logo
    icon: path.join(appPath, 'assets', 'img', 'algo-logo.png'),
    show: false
  });

  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // FIX: Only open DevTools in development, not in production
    if (isDev) {
      mainWindow.webContents.openDevTools();
    }
  });

  const loadWindowURL = () => {
    if (server && server.listening) {
      const serverPort = getServerPort();
      const url = `http://127.0.0.1:${serverPort}/app/index.html`;
      console.log(`Loading window URL: ${url}`);
      mainWindow.loadURL(url).catch((err) => {
        console.error('Failed to load URL:', err);
        setTimeout(() => {
          mainWindow.loadURL(url).catch((retryErr) => {
            console.error('Retry failed:', retryErr);
          });
        }, 500);
      });
    } else {
      setTimeout(loadWindowURL, 100);
    }
  };

  setTimeout(loadWindowURL, 100);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error(`Failed to load ${validatedURL}: ${errorCode} - ${errorDescription}`);
    if (errorCode !== -3) {
      setTimeout(() => {
        const serverPort = getServerPort();
        mainWindow.loadURL(`http://127.0.0.1:${serverPort}/app/index.html`);
      }, 1000);
    }
  });
}

// IPC handler for taskbar badge count (notification count like WhatsApp/Teams)
ipcMain.on('set-badge-count', (_event, count) => {
  try {
    app.setBadgeCount(count);
  } catch (e) {
    console.warn('[Badge] setBadgeCount failed:', e);
  }
});

// IPC handler for video files
ipcMain.handle('read-video-file', async (event, filePath) => {
  try {
    console.log('[IPC] Reading video file:', filePath);
    const normalizedPath = path.normalize(filePath);

    if (!fs.existsSync(normalizedPath)) {
      return { success: false, error: `Video file not found: ${normalizedPath}` };
    }

    const stats = fs.statSync(normalizedPath);
    if (stats.size === 0) {
      return { success: false, error: 'Video file is empty' };
    }

    const fileBuffer = fs.readFileSync(normalizedPath);
    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    );

    return {
      success: true,
      buffer: arrayBuffer,
      mimeType: 'video/mp4',
      size: fileBuffer.length
    };
  } catch (error) {
    console.error('[IPC] Error reading video file:', error);
    return { success: false, error: error.message || 'Unknown error' };
  }
});

async function initializeApp() {
  try {
    await startLocalServer();

    if (!server || !server.listening) {
      throw new Error('Server failed to start properly');
    }

    await new Promise(resolve => setTimeout(resolve, 200));
    createWindow();
  } catch (error) {
    console.error('Failed to initialize app:', error);
    app.quit();
  }
}

app.whenReady().then(() => {
  initializeApp();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      initializeApp();
    }
  });
});

app.on('window-all-closed', () => {
  if (server) {
    server.close(() => console.log('Server closed'));
    server = null;
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (server) {
    server.close(() => console.log('Server closed'));
    server = null;
  }
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});