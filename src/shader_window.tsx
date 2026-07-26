/**
 * shader_window.tsx
 * 
 * This is loaded by overlay.html in Window B (the transparent overlay).
 * It sets up a WebGL2 canvas that receives raw pixel data from the app window
 * via getUserMedia or getDisplayMedia, then renders it through a GLSL shader.
 * 
 * TWO CAPTURE METHODS:
 * 
 * Option A - desktopCapturer (default):
 * - Uses desktopCapturer.getSources() in main.cjs to find window by title
 * - Returns window:PID:ID format
 * - Uses getUserMedia with chromeMediaSource: 'desktop'
 * - More reliable, works consistently in Electron
 * 
 * Option B - mediaSourceId:
 * - Uses app_window.webContents.getMediaSourceId() to get base64 ID
 * - Uses getDisplayMedia with Electron-specific constraints to pre-select source
 * - May require user permission dialog in some cases
 * 
 * CONFIGURATION:
 * Set "capture_method" in config.json:
 * - "desktopCapturer" (default) -> Option A
 * - "mediaSourceId" -> Option B
 */

console.log('PARSE: shader_window.tsx loaded');

// Web APIs not yet in TypeScript standard library
declare class MediaStreamTrackProcessor {
  readonly track: MediaStreamTrack;
  readonly readable: ReadableStream<VideoFrame>;
  constructor(options: { track: MediaStreamTrack });
}

console.log('PARSE: MediaStreamTrackProcessor declaration complete');

import VERTEX_SOURCE from './shaders/main.vert?raw';
console.log('PARSE: VERTEX_SOURCE imported');

import FRAGMENT_SOURCE from './shaders/main.frag?raw';
console.log('PARSE: FRAGMENT_SOURCE imported');

// Fullscreen quad vertices (position + texCoord) using TRIANGLE_STRIP
const QUAD_VERTICES = new Float32Array([
  -1.0,  1.0,    0.0, 0.0,  // top-left
  -1.0, -1.0,    0.0, 1.0,  // bottom-left
   1.0,  1.0,    1.0, 0.0,  // top-right
   1.0, -1.0,    1.0, 1.0,  // bottom-right
]);

function compileShader(gl: WebGL2RenderingContext, source: string, type: number): WebGLShader | null {
  console.log('CALL: compileShader');
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Overlay shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  console.log('CALL: compileShader complete');
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vsSource: string, fsSource: string): WebGLProgram | null {
  console.log('CALL: createProgram');
  const vs = compileShader(gl, vsSource, gl.VERTEX_SHADER);
  const fs = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Overlay program link error:', gl.getProgramInfoLog(prog));
    return null;
  }
  console.log('CALL: createProgram complete');
  return prog;
}

async function main() {
  console.log('running async function main()');

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

    // Create shader program
    const program = createProgram(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);
    console.log('CHECKPOINT: createProgram() =', program ? 'success' : 'null');
    if (!program) {
      console.error('Overlay: Failed to create shader program');
      return;
    }
    const uTextureLoc = gl!.getUniformLocation(program, 'u_texture');
    const uResolutionLoc = gl!.getUniformLocation(program, 'u_resolution');
    const uTimeLoc = gl!.getUniformLocation(program, 'u_time');
    console.log('Overlay: Shader program created successfully');

    // Set canvas pixel size to window size
    function resizeCanvas() {
      const dpr = window.devicePixelRatio || 1;
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      gl!.viewport(0, 0, canvas.width, canvas.height);
      gl!.useProgram(program);
      gl!.uniform2f(uResolutionLoc, canvas.width, canvas.height);
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    console.log('CHECKPOINT: resizeCanvas configured');

    // Create VAO and VBO
    const vao = gl!.createVertexArray();
    gl!.bindVertexArray(vao);

    const vbo = gl!.createBuffer();
    gl!.bindBuffer(gl!.ARRAY_BUFFER, vbo);
    gl!.bufferData(gl!.ARRAY_BUFFER, QUAD_VERTICES, gl!.STATIC_DRAW);

    const posLoc = gl!.getAttribLocation(program, 'a_position');
    gl!.enableVertexAttribArray(posLoc);
    gl!.vertexAttribPointer(posLoc, 2, gl!.FLOAT, false, 16, 0);

    const texLoc = gl!.getAttribLocation(program, 'a_texCoord');
    gl!.enableVertexAttribArray(texLoc);
    gl!.vertexAttribPointer(texLoc, 2, gl!.FLOAT, false, 16, 8);

    // Create texture for incoming frames
    const texture = gl!.createTexture();
    gl!.bindTexture(gl!.TEXTURE_2D, texture);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.NEAREST);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.NEAREST);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    console.log('CHECKPOINT: VAO, VBO, texture created');

    let textureWidth = 1;
    let textureHeight = 1;

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

    // Load config to determine capture method
    let captureMethod: 'desktopCapturer' | 'mediaSourceId' = 'desktopCapturer';
    try {
      const cfg = await fetch('/config.json').then(r => r.json()).catch(() => null);
      console.log('CHECKPOINT: fetch(/config.json) complete, cfg =', cfg ? 'success' : 'null');
      if (cfg?.capture_method) {
        captureMethod = cfg.capture_method;
        console.log('Overlay: Using capture method:', captureMethod);
      } else {
        console.log('Overlay: No capture_method in config, defaulting to desktopCapturer');
      }
    } catch (e) {
      console.warn('Overlay: Failed to fetch config, using default desktopCapturer:', e);
    }

    // Step 1: Get window source ID based on capture method
    console.log('Overlay: Getting window source ID...');
    let sourceId: string | null = null;

    if (captureMethod === 'desktopCapturer') {
      // Option A: Use desktopCapturer method (window:PID:ID format)
      console.log('CHECKPOINT: captureMethod is desktopCapturer, calling getWindowSourceDesktopId()');
      sourceId = await api.getWindowSourceDesktopId();
      console.log('CHECKPOINT: getWindowSourceDesktopId() returned:', sourceId);
      if (sourceId && !sourceId.startsWith('window:')) {
        console.warn('Overlay: Got invalid desktop ID format, falling back to mediaSourceId:', sourceId);
        sourceId = null;
      }
    } else {
      // Option B: Use mediaSourceId method (base64 format)
      console.log('CHECKPOINT: captureMethod is mediaSourceId, calling getWindowSourceId()');
      sourceId = await api.getWindowSourceId();
      console.log('CHECKPOINT: getWindowSourceId() returned:', sourceId);
      if (sourceId && sourceId.startsWith('window:')) {
        console.warn('Overlay: Got invalid mediaSourceId format, falling back to desktopCapturer:', sourceId);
        sourceId = null;
      }
    }

    // Fallback to the other method if the first one fails
    if (!sourceId) {
      console.log('Overlay: Attempting fallback capture method...');
      const fallbackMethod = captureMethod === 'desktopCapturer' ? 'mediaSourceId' : 'desktopCapturer';
      console.log('Overlay: Trying fallback method:', fallbackMethod);

      if (fallbackMethod === 'desktopCapturer') {
        sourceId = await api.getWindowSourceDesktopId();
      } else {
        sourceId = await api.getWindowSourceId();
      }
      console.log('CHECKPOINT: fallback returned:', sourceId);
    }

    if (!sourceId) {
      console.error('Overlay: Failed to get window source ID with both methods');
      return;
    }
    console.log('Overlay: Got window source ID:', sourceId);
    console.log('CHECKPOINT: sourceId =', sourceId.substring(0, 20) + '...');

    // Step 2: Create MediaStream using the appropriate method
    let stream: MediaStream | null = null;

    // Always use desktopCapturer method for now (the working one)
    console.log('PIPELINE: desktopCapturer -> getUserMedia (window:PID:ID)');
    console.log('CHECKPOINT: Calling getUserMedia with chromeMediaSource=desktop');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: sourceId,
        },
      } as any);
      console.log('CHECKPOINT: getUserMedia() succeeded, track count:', stream.getVideoTracks().length);
    } catch (e) {
      console.error('Overlay: getUserMedia failed:', e);
      // Don't fall back here - we already tried both methods above
      return;
    }

    // Step 3: Create MediaStreamTrackProcessor to get VideoFrames
    const videoTrack = stream.getVideoTracks()[0];
    console.log('CHECKPOINT: videoTrack =', videoTrack ? 'success' : 'null');
    if (!videoTrack) {
      console.error('Overlay: No video track in stream');
      stream.getTracks().forEach(t => t.stop());
      return;
    }

    const processor = new MediaStreamTrackProcessor({ track: videoTrack });
    const reader = processor.readable.getReader();
    console.log('Overlay: MediaStreamTrackProcessor created');
    console.log('CHECKPOINT: MediaStreamTrackProcessor and reader created');

    // Step 4: Process VideoFrames and upload to WebGL
    let stopped = false;
    async function readLoop() {
      while (!stopped) {
        try {
          const { value, done } = await reader.read();
          if (done || !value) break;

          const frame = value as VideoFrame;

          // Re-allocate texture if size changed
          if (frame.displayWidth !== textureWidth || frame.displayHeight !== textureHeight) {
            textureWidth = frame.displayWidth;
            textureHeight = frame.displayHeight;
            gl!.bindTexture(gl!.TEXTURE_2D, texture);
            gl!.pixelStorei(gl!.UNPACK_ALIGNMENT, 1);
            gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, textureWidth, textureHeight, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
            console.log('Overlay: Texture resized to', textureWidth, 'x', textureHeight);
          }

          // Upload VideoFrame directly to WebGL texture (GPU-to-GPU, zero-copy)
          gl!.bindTexture(gl!.TEXTURE_2D, texture);
          gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, frame);

          // Clear and render
          gl!.clearColor(0, 0, 0, 0);
          gl!.clear(gl!.COLOR_BUFFER_BIT);
          gl!.useProgram(program);
          gl!.activeTexture(gl!.TEXTURE0);
          gl!.bindTexture(gl!.TEXTURE_2D, texture);
          gl!.uniform1i(uTextureLoc, 0);
          gl!.bindVertexArray(vao);
          gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

          const time = performance.now() / 1000.0;
          gl!.uniform1f(uTimeLoc, time);

          console.log('Overlay: VideoFrame uploaded to WebGL, size:', textureWidth, 'x', textureHeight);

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
      reader.cancel();
      videoTrack.stop();
      stream?.getTracks().forEach(t => t.stop());
      if (vao) gl!.deleteVertexArray(vao);
      if (vbo) gl!.deleteBuffer(vbo);
      if (texture) gl!.deleteTexture(texture);
      if (program) gl!.deleteProgram(program);
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
