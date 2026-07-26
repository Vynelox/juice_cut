//preload.cjs
const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

console.log('🔧 Preload script loaded');

// 1. Read config.json safely
const configPath = path.join(__dirname, 'config.json');
let borderRadius = '0px'; // Default fallback
try {
  const configData = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(configData);
  
  // Explicitly check for undefined so that '0' is treated as a valid number
  const radiusVal = config.electron_window_border_radius !== undefined 
    ? config.electron_window_border_radius 
    : 0;
    
  borderRadius = `${radiusVal}px`;
} catch (err) {
  console.error('🔧 Failed to read config.json in preload:', err);
}

// 2. Inject the CSS variable safely AFTER the DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = `
    :root {
      --electron-window-border-radius: ${borderRadius};
    }
  `;
  
  // Double-check that document.head exists before appending
  if (document.head) {
    document.head.appendChild(style);
  }
});

// 3. Expose IPC for window controls
contextBridge.exposeInMainWorld('electronAPI', {
  send: (channel, data) => {
    ipcRenderer.send(channel, data);
  },
  on: (channel, callback) => {
    ipcRenderer.on(channel, (_event, ...args) => callback(...args));
  },
  // Get the window source ID (base64 format) for getDisplayMedia
  getWindowSourceId: () => ipcRenderer.invoke('get-window-source-id'),
  // Get the window source ID (window:PID:ID format) for getUserMedia
  getWindowSourceDesktopId: () => ipcRenderer.invoke('get-window-source-desktop-id'),
  // Toggle app_window click-through at runtime
  toggleAppClickthrough: () => ipcRenderer.send('toggle-app-clickthrough'),
  // Notify main process that shader window is ready
  notifyShaderWindowReady: () => ipcRenderer.send('shader-window-ready'),
});