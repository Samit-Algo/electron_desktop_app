# Phoenix Desktop Application

Electron-based desktop application for the Phoenix Dashboard.

## Installation

1. Install dependencies:
```bash
npm install
```

## Development

Run the application in development mode:
```bash
npm start
```

Or with dev tools:
```bash
npm run dev
```

## Building

Build for your current platform:
```bash
npm run build
```

Build for specific platforms:
```bash
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

Built applications will be in the `dist/` folder.

## How It Works

- The app uses a local Express server (port 3000) to serve static files
- This allows `fetch()` API to work properly (file:// protocol has CORS restrictions)
- The layout loader automatically detects Electron environment and uses absolute paths
- No UI changes - works exactly like the web version

## Project Structure

```
new_desktop_app/
├── main.js              # Electron main process
├── preload.js           # Preload script for security
├── package.json         # Dependencies and build config
├── pages/               # Page content files
├── layout/              # Shared layout files
├── custom_js/           # Custom JavaScript (layout-loader)
├── assets/              # CSS, images, JS assets
└── vendors/             # Third-party libraries
```

