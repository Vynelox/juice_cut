/**
 * shader_window.tsx
 * 
 * This is loaded by overlay.html in Window B (the transparent overlay).
 * It sets up a WebGL2 canvas that receives raw pixel data from the app window
 * via getDisplayMedia, then renders it through a GLSL shader.
 * 
 * The main.cjs process intercepts display media requests using
 * session.defaultSession.setDisplayMediaRequestHandler to provide the exact window.
 * 
 * NO CONFIG NEEDED: The main process handles window selection automatically.
 * 
 * SHADER SYSTEM: Imports a ShaderRenderer from the shader folder
 * (e.g. ./shaders/default_shader). The renderer handles all GPU resources:
 * compilation, geometry, textures, uniforms, and per-frame rendering.
 * To use a different shader, change the import path below.
 */

console.log('PARSE: shader_window.tsx loaded');

// Web APIs not yet in TypeScript standard library
declare class MediaStreamTrackProcessor {
  readonly track: MediaStreamTrack;
  readonly readable: ReadableStream<VideoFrame>;
  constructor(options: { track: MediaStreamTrack });
}

console.log('PARSE: MediaStreamTrackProcessor declaration complete');

// ─── Import the shader module ───────────────────────────────────────────────
// Change this import to use a different shader set.
// Each shader folder exports { createShaderRenderer, ShaderRenderer }.
import { createShaderRenderer } from './shaders/default_shader/index';
console.log('PARSE: ShaderRenderer imported');

async function main() {
  console.log('running async function main()');
  
  try {
    const cfg = await fetch('/config.json').then(r => r.json());
    if (cfg?.custom_cursor) {
      document.body.style.cursor = 'none';
      document.documentElement.style.cursor = 'none';
      console.log('Overlay: System cursor hidden via custom_cursor config');
    }
  } catch (e) {
    console.warn('Overlay: Failed to fetch config for custom_cursor');
  }

  let stream: MediaStream | null = null;
  let videoTrack: MediaStreamTrack | null = null;
  let processor: MediaStreamTrackProcessor | null = null;
  let reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  let stopped = false;

  try {
    console.log('CHECKPOINT: main() entered, beginning execution');

    const root = document.getElementById('root');
    console.log('CHECKPOINT: document.getElementById(root) =', root ? 'found' : 'null');
    if (!root) {
      console.error('Overlay: No root element found');
      return;
    }

    // Create full-screen canvas
    const canvas = document.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    root.appendChild(canvas);
    console.log('CHECKPOINT: canvas created and appended to root');

    // 🔥 Fallback background to prove the window is alive
    canvas.style.backgroundColor = 'rgba(255, 0, 0, 0.3)';
    console.log('CHECKPOINT: canvas background color set');

    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
      antialias: true
    });
    console.log('CHECKPOINT: canvas.getContext(webgl2) =', gl ? 'success' : 'null');
    if (!gl) {
      console.error('Overlay: Failed to create WebGL2 context');
      return;
    }

    console.log('Overlay: WebGL2 context created successfully');

    // ─── Create the shader renderer ──────────────────────────────────────────
    const renderer = createShaderRenderer();
    const initialized = renderer.init(gl!);
    console.log('CHECKPOINT: ShaderRenderer.init() =', initialized ? 'success' : 'failed');
    if (!initialized) {
      console.error('Overlay: Failed to initialize shader renderer');
      return;
    }
    console.log('Overlay: Shader renderer initialized successfully');

    // Set canvas pixel size to window size
    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      renderer.resize(gl!, canvas.width, canvas.height);
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    console.log('CHECKPOINT: resizeCanvas configured');

    // Notify main process we're ready
    const api = (window as any).electronAPI;
    console.log('CHECKPOINT: electronAPI =', api ? 'available' : 'null');
    if (api) {
      console.log('Overlay: Notifying main process that shader window is ready...');
      api.notifyShaderWindowReady();
    } else {
      console.error('Overlay: electronAPI not available');
      return;
    }
    console.log('CHECKPOINT: notifyShaderWindowReady() called');

    // Step 2: Request display media (Main process will intercept via setDisplayMediaRequestHandler)
    console.log('PIPELINE: Requesting display media (Main process will intercept)');
    try {
      // This triggers setDisplayMediaRequestHandler in main.cjs
      stream = await navigator.mediaDevices.getDisplayMedia({
        // 'as any' bypasses the TypeScript error.
        // This tells the capture engine to EXCLUDE the cursor from the video stream.
        video: { cursor: 'never' } as any,
        audio: false,
      });
      console.log('✅ SUCCESS: MediaStream acquired, track count:', stream.getVideoTracks().length);

      // Continue directly to the MediaStreamTrackProcessor logic
      videoTrack = stream.getVideoTracks()[0];
      if (!videoTrack) {
        console.error('Overlay: No video track in stream');
        return;
      }

      processor = new MediaStreamTrackProcessor({ track: videoTrack });
      reader = processor.readable.getReader();
      console.log('Overlay: MediaStreamTrackProcessor created');

    } catch (e) {
      console.error('❌ getDisplayMedia failed:', e);
      return;
    }

    // Step 3: Process VideoFrames and render through the shader
    async function readLoop() {
      while (!stopped) {
        try {
          const { value, done } = await reader!.read();
          if (done || !value) break;

          const frame = value as VideoFrame;

          // Render the frame through the shader
          const time = performance.now() / 1000.0;
          renderer.renderFrame(gl!, frame, time, 1.0);

          // Close the frame to release GPU memory
          frame.close();
        } catch (e) {
          if (!stopped) {
            console.error('Overlay readLoop error:', e);
          }
          break;
        }
      }
    }

    readLoop();
    console.log('CHECKPOINT: readLoop() started');

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
      stopped = true;
      reader?.cancel();
      videoTrack?.stop();
      stream?.getTracks().forEach(t => t.stop());
      renderer.destroy(gl!);
    });
    console.log('CHECKPOINT: beforeunload listener registered');

  } catch (e) {
    console.error('FATAL ERROR in main():', e);
    throw e; // Re-throw so .catch() at call site can log it too
  }

  console.log('CHECKPOINT: main() completed successfully');
}

// Wait for DOM to be ready
console.log('RUNTIME: Checking document.readyState:', document.readyState);
if (document.readyState === 'loading') {
  console.log('RUNTIME: DOM is loading, registering DOMContentLoaded listener');
  document.addEventListener('DOMContentLoaded', () => {
    console.log('RUNTIME: DOMContentLoaded fired, calling main()');
    main().catch(e => console.error('UNCAUGHT promise rejection in main():', e));
  });
} else {
  console.log('RUNTIME: DOM is already loaded, calling main() directly');
  main().catch(e => console.error('UNCAUGHT promise rejection in main():', e));
}

console.log('RUNTIME: shader_window.tsx top-level code complete, waiting for DOMContentLoaded or calling main()');