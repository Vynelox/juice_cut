//main.cjs
const path = require('path');
const { app, BrowserWindow, ipcMain, desktopCapturer } = require('electron');
const config = require('./config.json');

/*
Good question — let me break this down from first principles.
What's a "lifecycle"?
A lifecycle is the sequence of states something goes through from creation to destruction. Think of it like stages of life:
plain
birth → childhood → adulthood → death
For software objects, it's similar:
plain
created → initialized → running → shutting down → destroyed
What's a "lifecycle object"?
A lifecycle object is an object that:
Tracks which stage it's currently in
Notifies other code when it transitions between stages
Provides hooks for you to run code at specific stages
It's the central coordinator that says "I'm starting up now," "I'm ready," "I'm quitting."
*/


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

//These two lines declare variables to hold references
//to the application's two windows.
let app_window = null;      // Window A: main app (invisible but interactive)
let shader_window = null;   // Window B: shader overlay

/*
okay so basically there's two types of lines of code: regular lines and promise lines.
if a line doesn't return a promose, it could be a 1 billion year long calculation,
putting await won't skip it. but if you use specific functions like fetch or new promise,
it doesn't matter if it takes a nanosecond to execute, if there's no await,
the next line returns the promise object. if there is an await, the next line will wait
for the promise object to finish and then give the true answer.

oh and if you make a promise on line 1 and by line 2 its already resolved, even if you
log it at line 10,000, if there's no await, it still gives the promise object even though
it's already resolved
*/

app.whenReady().then(async () => {
  console.log('main.cjs invoked');
  if (SHADER_WINDOW) {
    shader_window = new BrowserWindow({
      width: 1280,
      height: 800,
      x: 0,  // Start at same position as Window A
      y: 0,
      frame: false, // Frameless overlay
      transparent: true, // Transparent background
      backgroundColor: '#00000000', // Explicitly transparent black background
      hasShadow: false, // Remove shadow to avoid extra DWM compositor work
      skipTaskbar: false,  // Show in taskbar with custom icon for alt-tab
      icon: path.join(__dirname, 'src/67_editing_software.ico'),
      show: true,  // Show immediately
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
    
    // --- Window A: Main App (Invisible but Interactive) ---
    const appOpacity = BASE_WINDOW_TRANSPARENCY < lowest_possible_opacity ? lowest_possible_opacity : BASE_WINDOW_TRANSPARENCY;
    app_window = new BrowserWindow({//BASE WINDOW
      width: 1280,
      height: 800,
      frame: false,
      skipTaskbar: true,  // Hide from taskbar - parent (shader_window) is the taskbar entry
      opacity: appOpacity,  // 0 = fully invisible, click-through enabled
      parent: shader_window,  // Make Window A a child of Window B so it stays above
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });

    console.log('Configure: app_window_clickthrough =', APP_WINDOW_CLICKTHROUGH);
    if (APP_WINDOW_CLICKTHROUGH) {
      app_window.setIgnoreMouseEvents(true, { forward: true });
      console.log('✅ app_window: mouse events ignored (click-through enabled)');
    }

    shader_window.setIgnoreMouseEvents(SHADER_WINDOW_CLICKTHROUGH, { forward: SHADER_WINDOW_CLICKTHROUGH });

    const ensureOverlayVisible = () => {
      //if the shader window exists and the shader window is minimized
      if (!shader_window.isDestroyed() && !shader_window.isVisible()) {
        shader_window.showInactive(); //changes it from minimized to unminimized
        shader_window.setVisibleOnAllWorkspaces(true); //
      }
    };

    app_window.on('focus', ensureOverlayVisible);
    app_window.on('show', ensureOverlayVisible);
    app_window.on('restore', ensureOverlayVisible);
    app_window.on('activate', ensureOverlayVisible);

    if (SYNC_WINDOWS) {
      let isSyncing = false;
      let hadParent = true;

      const sync_windows = () => {
        if (isSyncing || shader_window.isDestroyed()) return;
        isSyncing = true;
        const bounds = app_window.getBounds();
        shader_window.setBounds(bounds, false);
        isSyncing = false;
      };

      app_window.on('will-move', () => {
        if (!shader_window.isDestroyed() && hadParent) {
          shader_window.setParentWindow(null);
          shader_window.setAlwaysOnTop(true, 'screen-saver', 1);
          hadParent = false;
        }
      });

      app_window.on('moved', () => {
        if (!shader_window.isDestroyed()) {
          sync_windows();
          shader_window.setAlwaysOnTop(false);
          shader_window.setParentWindow(app_window);
          hadParent = true;
        }
      });

      app_window.on('will-resize', () => {
        if (!shader_window.isDestroyed() && hadParent) {
          shader_window.setParentWindow(null);
          shader_window.setAlwaysOnTop(true, 'screen-saver', 1);
          hadParent = false;
        }
      });

      app_window.on('resized', () => {
        if (!shader_window.isDestroyed()) {
          sync_windows();
          shader_window.setAlwaysOnTop(false);
          shader_window.setParentWindow(app_window);
          hadParent = true;
        }
      });

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

      sync_windows();
    }

    shader_window.loadURL('http://localhost:5173/shader_window.html');

    // IPC handler to get the window source ID (base64 format)
    // Used with getDisplayMedia for Option B
    ipcMain.handle('get-window-source-id', () => {
      if (app_window && app_window.webContents) {
        try {
          // Try with argument first (per Electron docs)
          const id = app_window.webContents.getMediaSourceId(app_window.webContents);
          console.log('✅ getMediaSourceId(WITH arg: app_window.webContents) succeeded:', id);
          return id;
        } catch (e) {
          console.warn('⚠️ getMediaSourceId(arg) failed:', e.message);
          try {
            // Fallback: try without argument
            const id = app_window.webContents.getMediaSourceId();
            console.log('✅ getMediaSourceId(no arg) succeeded:', id);
            return id;
          } catch (e2) {
            console.error('🚨 CRITICAL: getMediaSourceId() failed both ways:', e2.message);
            return null;
          }
        }
      }
      console.warn('⚠️ app_window or webContents not available');
      return null;
    });
    
    // IPC handler to get the window source ID (window:PID:ID format)
    // Used with getUserMedia for Option A
    ipcMain.handle('get-window-source-desktop-id', async () => {
      if (!app_window || app_window.isDestroyed()) {
        console.error('🚨 Window not available for desktop ID');
        return null;
      }
      
      try {
        const targetTitle = app_window.getTitle();
        console.log('Searching for window with title:', targetTitle);
        
        const sources = await desktopCapturer.getSources({
          types: ['window'],
          thumbnailSize: { width: 0, height: 0 },
        });
        
        // Find the window that matches our app_window by title
        const windowSources = sources.filter(s => s.id.startsWith('window:'));
        console.log('Available window sources:', windowSources.map(s => ({ id: s.id, name: s.name })));
        
        // Try to find by exact or partial title match
        const matched = windowSources.find(s => {
          if (!s.name) return false;
          return s.name.includes(targetTitle);
        });
        
        if (matched) {
          console.log('✅ Found matching window by title:', matched.id, 'name:', matched.name);
          return matched.id;
        }
        
        // Fallback: use the first window source
        if (windowSources.length > 0) {
          console.log('⚠️ No exact match, using first window source:', windowSources[0].id);
          return windowSources[0].id;
        }
        
        console.error('🚨 No window sources found');
        return null;
      } catch (e) {
        console.error('🚨 Failed to get desktop source ID:', e.message);
        return null;
      }
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
    app_window = new BrowserWindow({
      width: 1280,
      height: 800,
      frame: false,
      skipTaskbar: false,
      opacity: 1,  // Visible when no overlay
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
        // Pass app_window.webContents as the required requestWebContents argument
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