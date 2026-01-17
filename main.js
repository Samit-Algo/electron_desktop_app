const { app, BrowserWindow, Menu, ipcMain } = require('electron');
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

    // Serve event video files from local filesystem
    // This allows the Electron app to serve videos from the backend's event_videos directory
    expressApp.get('/api/v1/videos/:filename(*)', (req, res) => {
      try {
        const filename = req.params.filename;
        // Security: Only allow video files
        if (!filename.match(/\.(mp4|webm|ogg)$/i)) {
          return res.status(400).json({ error: 'Invalid file type' });
        }
        
        // Decode the file path (it may contain encoded path separators)
        const decodedPath = decodeURIComponent(filename);
        
        // Normalize the path to prevent directory traversal
        const normalizedPath = path.normalize(decodedPath);
        
        // Check if file exists
        if (!fs.existsSync(normalizedPath)) {
          console.log('[Server] Video file not found:', normalizedPath);
          return res.status(404).json({ error: 'Video file not found' });
        }
        
        // Get file stats
        const stats = fs.statSync(normalizedPath);
        if (!stats.isFile()) {
          return res.status(400).json({ error: 'Not a file' });
        }
        
        // Set appropriate headers for video streaming
        const ext = path.extname(normalizedPath).toLowerCase();
        const mimeTypes = {
          '.mp4': 'video/mp4',
          '.webm': 'video/webm',
          '.ogg': 'video/ogg'
        };
        const contentType = mimeTypes[ext] || 'video/mp4';
        
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', stats.size);
        res.setHeader('Accept-Ranges', 'bytes');
        
        // Support range requests for video seeking
        const range = req.headers.range;
        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
          const chunksize = (end - start) + 1;
          const file = fs.createReadStream(normalizedPath, { start, end });
          
          res.status(206);
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stats.size}`);
          res.setHeader('Content-Length', chunksize);
          file.pipe(res);
        } else {
          // Send entire file
          res.sendFile(normalizedPath);
        }
      } catch (error) {
        console.error('[Server] Error serving video:', error);
        res.status(500).json({ error: 'Error serving video file' });
      }
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

// IPC handler to read local video file and return as buffer
ipcMain.handle('read-video-file', async (event, filePath) => {
  try {
    console.log('[IPC] Reading video file:', filePath);
    
    // Normalize path and check if it exists
    const normalizedPath = path.normalize(filePath);
    console.log('[IPC] Normalized path:', normalizedPath);
    
    // Check if file exists
    if (!fs.existsSync(normalizedPath)) {
      console.error('[IPC] Video file not found:', normalizedPath);
      return {
        success: false,
        error: `Video file not found: ${normalizedPath}`
      };
    }
    
    // Get file stats for validation
    const stats = fs.statSync(normalizedPath);
    console.log('[IPC] File size:', stats.size, 'bytes');
    
    if (stats.size === 0) {
      console.error('[IPC] Video file is empty');
      return {
        success: false,
        error: 'Video file is empty'
      };
    }
    
    // Read file as buffer
    const fileBuffer = fs.readFileSync(normalizedPath);
    console.log('[IPC] File read successfully, buffer length:', fileBuffer.length);
    
    // Convert Node.js Buffer to ArrayBuffer for IPC (Electron serializes this correctly)
    // Buffer.buffer is the underlying ArrayBuffer
    const arrayBuffer = fileBuffer.buffer.slice(
      fileBuffer.byteOffset,
      fileBuffer.byteOffset + fileBuffer.byteLength
    );
    
    return {
      success: true,
      buffer: arrayBuffer,  // Send ArrayBuffer instead of Node.js Buffer
      mimeType: 'video/mp4',
      size: fileBuffer.length
    };
  } catch (error) {
    console.error('[IPC] Error reading video file:', error);
    return {
      success: false,
      error: error.message || 'Unknown error reading video file'
    };
  }
});

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

app.on('window-all-closed', async () => {
  // Close server when all windows are closed
  if (server) {
    server.close();
  }
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  // Close server before quitting
  if (server) {
    server.close();
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});