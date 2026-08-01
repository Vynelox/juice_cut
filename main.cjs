// main.cjs
const path = require('path');
const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const config = require('./config.json');

// ─── Constants ───────────────────────────────────────────────────────────────
const LOWEST_POSSIBLE_OPACITY = 0.004;
const APP_TITLE = '67-editing-software-main';
const WINDOW_DEFAULTS = { width: 1280, height: 800 };
const WIN_PRELOAD = path.join(__dirname, 'preload.cjs');
const WIN_ICON = path.join(__dirname, 'src/67_editing_software.ico');
const maximize_delay = 1;

// ─── Config validation with defaults ─────────────────────────────────────────
function loadConfig() {
  return {
    downscaleFactor: config.DOWNSCALE_FACTOR ?? 1,
    shaderWindow: config.shader_window ?? false,
    baseWindowTransparency: config.base_window_transparency ?? 1,
    shaderWindowClickthrough: config.shader_window_clickthrough ?? true,
    appWindowClickthrough: config.app_window_clickthrough ?? false,
    syncWindows: config.sync_windows ?? false,
    enshittify: config.enshittify ?? false,
    slideshow: config.slideshow ?? false,
    openShaderWindowInspector: config.open_shader_window_inspector ?? false,
  };
}

// ─── Shared webPreferences for all windows ───────────────────────────────────
const WEB_PREFERENCES = {
  preload: WIN_PRELOAD,
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false,
};

// ─── Window Manager ──────────────────────────────────────────────────────────
class WindowManager {
  constructor() {
    this.cfg = loadConfig();
    this.appWindow = null;
    this.shaderWindow = null;
    this.isDragging = false;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.isSyncing = false;
    this.ready = false;
  }

  // ── Window Creation ──────────────────────────────────────────────────────

  createAppWindow() {
    const opacity = Math.max(
      this.cfg.baseWindowTransparency,
      LOWEST_POSSIBLE_OPACITY
    );

    // Create at default size; maximize after 5 seconds once loaded
    this.appWindow = new BrowserWindow({
      ...WINDOW_DEFAULTS,
      frame: false,
      skipTaskbar: false,
      icon: WIN_ICON,
      opacity,
      webPreferences: WEB_PREFERENCES,
    });
    this.appWindow.setTitle(APP_TITLE);
    this.appWindow.loadURL('http://localhost:5173');
    
    // Maximize after the delay once the window finishes loading
    this.appWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (this.appWindow && !this.appWindow.isDestroyed()) {
          this.appWindow.maximize();
          console.log(`✅ app_window maximized after ${maximize_delay}ms delay`);
        }
      }, maximize_delay);
    });
    
    console.log(`✅ app_window created (regular size, will maximize after ${maximize_delay}ms)`);
    return this.appWindow;
  }

  createShaderWindow() {
    if (!this.cfg.shaderWindow || !this.appWindow) return null;

    // Create shader window at default size matching parent; will sync when parent maximizes
    this.shaderWindow = new BrowserWindow({
      ...WINDOW_DEFAULTS,
      x: 0,
      y: 0,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      skipTaskbar: false,
      icon: WIN_ICON,
      show: true,
      parent: this.appWindow,   // Locks Z-order: child always on top of parent
      focusable: false,          // Prevents overlay from stealing keyboard focus
      webPreferences: WEB_PREFERENCES,
    });

    if (this.cfg.openShaderWindowInspector) {
      this.shaderWindow.webContents.openDevTools();
    }

    this.shaderWindow.loadURL('http://localhost:5173/shader_window.html');
    console.log('✅ shader_window created (regular size, will sync when parent maximizes)');
    return this.shaderWindow;
  }

  createFallbackWindow() {
    // Create at default size; maximize after 5 seconds once loaded
    this.appWindow = new BrowserWindow({
      ...WINDOW_DEFAULTS,
      frame: false,
      skipTaskbar: false,
      opacity: 1,
      icon: WIN_ICON,
      webPreferences: WEB_PREFERENCES,
    });
    this.appWindow.loadURL('http://localhost:5173');
    
    // Maximize after the delay once the window finishes loading
    this.appWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        if (this.appWindow && !this.appWindow.isDestroyed()) {
          this.appWindow.maximize();
          console.log(`✅ fallback app_window maximized after ${maximize_delay}ms delay`);
        }
      }, maximize_delay);
    });
    
    console.log(`✅ fallback app_window created (regular size, will maximize after ${maximize_delay}ms)`);
    return this.appWindow;
  }

  // ── Click-Through Configuration ──────────────────────────────────────────

  setupClickThrough() {
    // App window
    if (this.cfg.appWindowClickthrough) {
      this.appWindow.setIgnoreMouseEvents(true, { forward: true });
      console.log('⚠️ app_window: click-through enabled');
    } else {
      this.appWindow.setIgnoreMouseEvents(false);
      console.log('✅ app_window: mouse events enabled');
    }

    // Shader window (overlay) — should be click-through by default
    if (this.shaderWindow) {
      if (this.cfg.shaderWindowClickthrough) {
        this.shaderWindow.setIgnoreMouseEvents(true, { forward: true });
        console.log('⚠️ shader_window: click-through enabled');
      } else {
        this.shaderWindow.setIgnoreMouseEvents(false);
        console.log('✅ shader_window: mouse events enabled');
      }
    }
  }

  // ── Overlay Visibility ───────────────────────────────────────────────────

  setupOverlayVisibility() {
    if (!this.shaderWindow) return;

    const ensureVisible = () => {
      if (!this.shaderWindow.isDestroyed() && !this.shaderWindow.isVisible()) {
        this.shaderWindow.showInactive();
        this.shaderWindow.setVisibleOnAllWorkspaces(true);
      }
    };

    this.appWindow.on('focus', ensureVisible);
    this.appWindow.on('show', ensureVisible);
    this.appWindow.on('restore', ensureVisible);
    this.appWindow.on('activate', ensureVisible);
    console.log('✅ overlay visibility handlers registered');
  }

  // ── Window Synchronization ───────────────────────────────────────────────

  setupWindowSync() {
    if (!this.cfg.syncWindows || !this.shaderWindow) return;

    const syncBounds = () => {
      if (this.isSyncing) return;
      if (this.shaderWindow.isDestroyed() || this.appWindow.isDestroyed()) return;
      this.isSyncing = true;
      this.shaderWindow.setBounds(this.appWindow.getBounds(), false);
      this.isSyncing = false;
    };

    this.appWindow.on('move', syncBounds);
    this.appWindow.on('resize', syncBounds);

    this.appWindow.on('maximize', () => {
      if (!this.shaderWindow.isDestroyed()) this.shaderWindow.maximize();
    });
    this.appWindow.on('unmaximize', () => {
      if (!this.shaderWindow.isDestroyed()) this.shaderWindow.unmaximize();
    });
    this.appWindow.on('minimize', () => {
      if (!this.shaderWindow.isDestroyed()) this.shaderWindow.minimize();
    });
    this.appWindow.on('restore', () => {
      if (!this.shaderWindow.isDestroyed()) {
        this.shaderWindow.restore();
        this.shaderWindow.showInactive();
      }
    });

    // Initial sync after a short delay to let both windows settle
    setTimeout(() => {
      if (this.shaderWindow && !this.shaderWindow.isDestroyed()) {
        this.shaderWindow.setBounds(this.appWindow.getBounds());
      }
    }, 100);

    console.log('✅ window sync handlers registered');
  }

  // ── Display Media Handler ────────────────────────────────────────────────

  setupDisplayMediaHandler() {
    session.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['window'] })
        .then((sources) => {
          console.log('🔍 Available windows:', sources.map(s => ({ id: s.id, name: s.name })));

          const target = sources.find(s => s.name && s.name.includes(APP_TITLE)) || sources[0];
          if (target) {
            console.log('✅ Providing window for capture:', target.id, '| Name:', target.name);
            callback({ video: target });
          } else {
            console.error('❌ No windows found for capture');
            callback({});
          }
        })
        .catch((err) => {
          console.error('❌ desktopCapturer failed:', err);
          callback({});
        });
    });
    console.log('✅ display media handler registered');
  }

  // ── Manual Window Dragging ───────────────────────────────────────────────

  setupDragHandling() {
    ipcMain.on('start-drag', (_event, coords) => {
      this.isDragging = true;
      const bounds = this.appWindow.getBounds();
      this.dragOffsetX = coords.x - bounds.x;
      this.dragOffsetY = coords.y - bounds.y;
    });

    ipcMain.on('dragging', (_event, coords) => {
      if (this.isDragging && this.appWindow && !this.appWindow.isDestroyed()) {
        this.appWindow.setPosition(
          Math.round(coords.x - this.dragOffsetX),
          Math.round(coords.y - this.dragOffsetY)
        );
      }
    });

    ipcMain.on('stop-drag', () => {
      this.isDragging = false;
    });
    console.log('✅ drag handling registered');
  }

  // ── IPC Handlers ─────────────────────────────────────────────────────────

  setupIPCHandlers() {
    // Window controls
    ipcMain.on('window-minimize', () => this.appWindow.minimize());
    ipcMain.on('window-maximize', () => {
      if (this.appWindow.isMaximized()) {
        this.appWindow.unmaximize();
      } else {
        this.appWindow.maximize();
      }
    });
    ipcMain.on('window-fullscreen', () => {
      if (this.appWindow.isFullScreen()) {
        this.appWindow.setFullScreen(false);
      } else {
        this.appWindow.setFullScreen(true);
      }
    });
    ipcMain.on('window-close', () => {
      if (this.shaderWindow && !this.shaderWindow.isDestroyed()) {
        this.shaderWindow.close();
      }
      this.appWindow.close();
    });

    // Runtime toggle for app_window click-through
    ipcMain.on('toggle-app-clickthrough', () => {
      if (this.appWindow && !this.appWindow.isDestroyed()) {
        const current = this.appWindow.isIgnoringMouseEvents();
        const next = !current;
        this.appWindow.setIgnoreMouseEvents(next, { forward: next });
        console.log('Toggle: app_window_clickthrough =', next);
      }
    });

    // Shader window ready notification
    ipcMain.on('shader-window-ready', (event) => {
      if (this.appWindow && this.appWindow.webContents) {
        try {
          const id = this.appWindow.webContents.getMediaSourceId(this.appWindow.webContents);
          console.log('📤 Sending window source ID to shader_window:', id);
          event.sender.send('window-source-id', id);
        } catch (e) {
          console.error('🚨 Failed to get source ID:', e.message);
        }
      }
    });

    // Forward mouse position from app_window to shader_window for custom cursor
    ipcMain.on('cursor-move', (_event, pos) => {
      if (this.shaderWindow && !this.shaderWindow.isDestroyed()) {
        this.shaderWindow.webContents.send('cursor-move', pos);
      }
    });

    // Forward FPS from shader_window to app_window for the FPS counter display
    ipcMain.on('shader-fps', (_event, fps) => {
      if (this.appWindow && !this.appWindow.isDestroyed()) {
        this.appWindow.webContents.send('shader-fps', fps);
      }
    });

    // Fallback: get-window-source-id for non-shader mode
    ipcMain.handle('get-window-source-id', () => {
      if (this.appWindow && this.appWindow.webContents) {
        return this.appWindow.webContents.getMediaSourceId(this.appWindow.webContents);
      }
      return null;
    });

    // Placeholder handler for get-window-source-desktop-id (used by preload)
    ipcMain.handle('get-window-source-desktop-id', () => {
      // This is a stub — implement if needed for getUserMedia capture
      return null;
    });

    console.log('✅ IPC handlers registered');
  }

  // ── Window Lifecycle Cleanup ─────────────────────────────────────────────

  setupLifecycleHandlers() {
    this.shaderWindow?.on('closed', () => {
      this.shaderWindow = null;
    });
    this.appWindow?.on('closed', () => {
      this.appWindow = null;
    });
  }

  // ── Initialization ───────────────────────────────────────────────────────

  async init() {
    console.log('main.cjs — WindowManager initializing');

    if (this.cfg.shaderWindow) {
      // 1. Create app window first (parent)
      this.createAppWindow();

      // 2. Create shader window second (child)
      this.createShaderWindow();

      // 3. Configure click-through behavior
      this.setupClickThrough();

      // 4. Ensure overlay stays visible
      this.setupOverlayVisibility();

      // 5. Sync window positions if enabled
      this.setupWindowSync();

      // 6. Intercept display media requests
      this.setupDisplayMediaHandler();
    } else {
      // Fallback: single window, no shader overlay
      this.createFallbackWindow();

      // Register the IPC handler for fallback mode
      ipcMain.handle('get-window-source-id', () => {
        if (this.appWindow && this.appWindow.webContents) {
          return this.appWindow.webContents.getMediaSourceId(this.appWindow.webContents);
        }
        return null;
      });

      this.appWindow.webContents.on('did-finish-load', () => {
        console.log('🔧 Main window loaded (no shader overlay)');
      });
    }

    // 7. Manual window dragging (bypasses OS cursor override bug)
    this.setupDragHandling();

    // 8. IPC handlers (window controls, etc.)
    this.setupIPCHandlers();

    // 9. Window lifecycle cleanup
    this.setupLifecycleHandlers();

    this.ready = true;
    console.log('✅ WindowManager initialized successfully');
  }
}

// ─── Application Entry Point ─────────────────────────────────────────────────
app.whenReady().then(async () => {
  console.log('main.cjs invoked');
  const manager = new WindowManager();
  await manager.init();
});