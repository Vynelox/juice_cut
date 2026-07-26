//main.cjs
const path = require('path');
const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const config = require('./config.json');

const DOWNSCALE_FACTOR = config.DOWNSCALE_FACTOR;
const SHADER_WINDOW = config.shader_window;
const BASE_WINDOW_TRANSPARENCY = config.base_window_transparency;
const SHADER_WINDOW_CLICKTHROUGH = config.shader_window_clickthrough;
const APP_WINDOW_CLICKTHROUGH = config.app_window_clickthrough || false;
const SYNC_WINDOWS = config.sync_windows;
const ENSHITTIFY = config.enshittify;
const SLIDESHOW = config.slideshow;
const lowest_possible_opacity = 0.004;
const open_shader_window_inspector = config.open_shader_window_inspector;

let app_window = null;
let shader_window = null;

app.whenReady().then(async () => {
  console.log('main.cjs invoked');
  if (SHADER_WINDOW) {
    // 1. Create Window A (Main App) FIRST, so it can be the parent
    //NOTE: setting skipTaskbar: false DOES NOT WORK for child windows
    //if its parent window has skipTaskbar: true. so enable skipTaskbar
    //for both shader and app window depending on which one you want
    //to make as the parent
    const appOpacity = BASE_WINDOW_TRANSPARENCY < lowest_possible_opacity ? lowest_possible_opacity : BASE_WINDOW_TRANSPARENCY;
    app_window = new BrowserWindow({
      width: 1280,
      height: 800,
      frame: false,
      skipTaskbar: false,
      icon: path.join(__dirname, 'src/67_editing_software.ico'),
      opacity: appOpacity,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    // Set a unique, known title immediately so desktopCapturer can match it later
    app_window.setTitle('67-editing-software-main');

    // 2. Create Window B (Shader Overlay) SECOND, as a child of Window A
    shader_window = new BrowserWindow({
      width: 1280,
      height: 800,
      x: 0,
      y: 0,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      skipTaskbar: false,
      icon: path.join(__dirname, 'src/67_editing_software.ico'),
      show: true,
      parent: app_window,      // 🔥 OFFICIAL DOC: Locks Z-order. Child always stays on top of parent.
      focusable: false,        // 🔥 OFFICIAL DOC: Prevents overlay from stealing keyboard focus from the parent.
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    if(open_shader_window_inspector){
      shader_window.webContents.openDevTools();
    }

    console.log('Configure: app_window_clickthrough =', APP_WINDOW_CLICKTHROUGH);
    if (!APP_WINDOW_CLICKTHROUGH) {
      app_window.setIgnoreMouseEvents(false);
      console.log('✅ app_window: mouse events enabled (interactive)');
    } else {
      app_window.setIgnoreMouseEvents(true, { forward: true });
      console.log('⚠️ app_window: mouse events ignored (click-through enabled)');
    }

    // shader_window is the visual overlay on top; it should be click-through by default
    if(!SHADER_WINDOW_CLICKTHROUGH){
      shader_window.setIgnoreMouseEvents(false);
    } else {
      shader_window.setIgnoreMouseEvents(true, { forward: true });
    }
    

    const ensureOverlayVisible = () => {
      if (!shader_window.isDestroyed() && !shader_window.isVisible()) {
        shader_window.showInactive();
        shader_window.setVisibleOnAllWorkspaces(true);
      }
    };

    app_window.on('focus', ensureOverlayVisible);
    app_window.on('show', ensureOverlayVisible);
    app_window.on('restore', ensureOverlayVisible);
    app_window.on('activate', ensureOverlayVisible);

    if (SYNC_WINDOWS) {
      let isSyncing = false;

      const sync_windows = () => {
        if (isSyncing || shader_window.isDestroyed() || app_window.isDestroyed()) return;
        isSyncing = true;
        const bounds = app_window.getBounds();
        shader_window.setBounds(bounds, false);
        isSyncing = false;
      };

      app_window.on('move', sync_windows);
      app_window.on('resize', sync_windows);

      app_window.on('maximize', () => {
        if (!shader_window.isDestroyed()) shader_window.maximize();
      });
      app_window.on('unmaximize', () => {
        if (!shader_window.isDestroyed()) shader_window.unmaximize();
      });
      app_window.on('minimize', () => {
        if (!shader_window.isDestroyed()) shader_window.minimize();
      });
      app_window.on('restore', () => {
        if (!shader_window.isDestroyed()) {
          shader_window.restore();
          shader_window.showInactive();
        }
      });

      // Initial sync after both windows are ready
      const initialSync = () => {
        if (shader_window && !shader_window.isDestroyed()) {
          sync_windows();
        }
      };
      
      setTimeout(initialSync, 100);
    }

    shader_window.loadURL('http://localhost:5173/shader_window.html');

    if (SYNC_WINDOWS) {
      const bounds = app_window.getBounds();
      shader_window.setBounds(bounds);
    }

    // 🔥 OFFICIAL ELECTRON API: Intercept display media requests and provide the exact window
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['window'] }).then((sources) => {
        // DEBUG: Log all available windows to see exactly what Windows is naming them
        console.log('🔍 DEBUG: Available windows:', sources.map(s => ({ id: s.id, name: s.name })));

        // Try to find our window, but fallback to the first available window if not found.
        // This prevents the app from crashing and helps us verify the pipeline works.
        const targetWindow = sources.find(s => s.name && s.name.includes('67-editing-software')) || sources[0];
        if (targetWindow) {
          console.log('✅ Main Process: Intercepted capture request, providing window:', targetWindow.id, '| Name:', targetWindow.name);
          callback({ video: targetWindow });
        } else {
          console.error('❌ Main Process: No windows found at all.');
          // Deny the request gracefully without crashing Electron
          callback({ });
        }
      }).catch(err => {
        console.error('❌ Main Process: desktopCapturer failed:', err);
        // Deny the request gracefully without crashing Electron
        callback({});
      });
    });

    // Runtime toggle for app_window click-through
    // Toggles whether app_window ignores mouse events (passes clicks through to windows behind)
    ipcMain.on('toggle-app-clickthrough', () => {
      if (app_window && !app_window.isDestroyed()) {
        const current = app_window.isIgnoringMouseEvents();
        const next = !current;
        app_window.setIgnoreMouseEvents(next, { forward: next });
        console.log('Toggle: app_window_clickthrough =', next);
      }
    });

    // Send the source ID to shader_window as soon as it's ready
    // shader_window.tsx will handle getting the stream directly
    ipcMain.on('shader-window-ready', (event) => {
      if (app_window && app_window.webContents) {
        try {
          const id = app_window.webContents.getMediaSourceId(app_window.webContents);
          console.log('📤 Sending window source ID to shader_window:', id);
          event.sender.send('window-source-id', id);
        } catch (e) {
          console.error('🚨 Failed to get source ID for shader_window:', e.message);
        }
      }
    });
    
  } else {
    //fallback window: if shader_window is disabled
    app_window = new BrowserWindow({
      width: 1280,
      height: 800,
      frame: false,
      skipTaskbar: false,
      opacity: 1,
      icon: path.join(__dirname, 'src/67_editing_software.ico'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    ipcMain.handle('get-window-source-id', () => {
      if (app_window && app_window.webContents) {
        return app_window.webContents.getMediaSourceId(app_window.webContents);
      }
      return null;
    });

    app_window.webContents.on('did-finish-load', () => {
      console.log('🔧 Main window loaded (no shader overlay)');
    });
  }

  ipcMain.on('window-minimize', () => app_window.minimize());
  ipcMain.on('window-maximize', () => {
    if (app_window.isMaximized()) app_window.unmaximize();
    else app_window.maximize();
  });
  ipcMain.on('window-close', () => {
    if (shader_window && !shader_window.isDestroyed()) shader_window.close();
    app_window.close();
  });

  app_window.loadURL('http://localhost:5173');

  shader_window.on('closed', () => {
    shader_window = null;
  });
  app_window.on('closed', () => {
    app_window = null;
  });
});