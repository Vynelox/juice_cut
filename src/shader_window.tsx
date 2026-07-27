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
    const uStrengthLoc = gl!.getUniformLocation(program, 'u_strength');
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

    // Step 2: Request display media (Main process will intercept via setDisplayMediaRequestHandler)
    console.log('PIPELINE: Requesting display media (Main process will intercept)');
    try {
      // This triggers setDisplayMediaRequestHandler in main.cjs
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'never'
        },
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

    // Step 3: Process VideoFrames and upload to WebGL
    async function readLoop() {
      while (!stopped) {
        try {
          const { value, done } = await reader!.read();
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
          gl!.uniform1f(uStrengthLoc, 1.0);
          gl!.bindVertexArray(vao);
          gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

          const time = performance.now() / 1000.0;
          gl!.uniform1f(uTimeLoc, time);

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
