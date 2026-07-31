/**
 * default_shader/index.ts
 * 
 * Shader module for the default GLSL shader.
 * Handles compilation, program creation, geometry setup, texture management,
 * and per-frame rendering.
 * 
 * shader_window.tsx imports this module and uses the exported ShaderRenderer
 * interface — no need to touch GLSL logic directly.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * 📘 HOW TO MANAGE SHADER FILES
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * ── Renaming main.frag or main.vert ──────────────────────────────────────────
 * 1. Rename the file on disk, e.g. main.frag → my_effect.frag
 * 2. Update the import path below (line ~12-13) to match:
 *        import FRAGMENT_SOURCE from './my_effect.frag?raw';
 * 3. The `?raw` suffix is required — it tells Vite to import the file as a raw
 *    text string instead of trying to parse it as JavaScript.
 * 
 * ── Adding more .frag / .vert / .glsl files ─────────────────────────────────
 * Any GLSL file in this folder can be imported with `?raw`:
 * 
 *     import ADDITIONAL_FRAG from './extra.frag?raw';
 *     import ADDITIONAL_VERT from './extra.vert?raw';
 *     import UTILS from './utils.glsl?raw';
 * 
 * Use cases:
 *   • Include a shared GLSL header (e.g. noise functions, colour helpers):
 *     ── Create a file like `utils.glsl` with your shared code.
 *     ── Import it above, then concatenate it into the shader source string
 *        before compiling:
 *            const finalFrag = UTILS + '\n' + FRAGMENT_SOURCE;
 *     ── Pass `finalFrag` to `createProgram()` instead of `FRAGMENT_SOURCE`.
 * 
 *   • Add a second shader program (e.g. for post-processing passes):
 *     ── Import the new sources:
 *         import POST_FRAG from './post.frag?raw';
 *         import POST_VERT from './post.vert?raw';
 *     ── In `init()`, create a second program:
 *         const postProgram = createProgram(gl, POST_VERT, POST_FRAG);
 *     ── Store it alongside the primary program and use it in `renderFrame()`
 *        by switching `gl.useProgram(postProgram)` before drawing.
 * 
 * ── Removing shader files ────────────────────────────────────────────────────
 * 1. Delete the file from disk (e.g. `main.frag`).
 * 2. Remove (or comment out) the matching `import ... from './filename.frag?raw'`
 *    line below.
 * 3. Remove any references to that import in the factory code below.
 * 
 * ── Switching to a completely different shader set ───────────────────────────
 * 1. Create a new folder, e.g. `src/shaders/my_shader/`.
 * 2. Copy this `index.ts` into it as a starting template.
 * 3. Replace the GLSL files with your own.
 * 4. In `shader_window.tsx`, change the import to:
 *        import { createShaderRenderer } from './shaders/my_shader/index';
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import VERTEX_SOURCE from './main.vert?raw';
import FRAGMENT_SOURCE from './main.frag?raw';
import CURSOR_VERT_SOURCE from './cursor.vert?raw';
import CURSOR_FRAG_SOURCE from './cursor.frag?raw';

// ─── Fullscreen quad geometry ───────────────────────────────────────────────
// Position (x,y) + texCoord (u,v) interleaved, using TRIANGLE_STRIP
const QUAD_VERTICES = new Float32Array([
  -1.0,  1.0,    0.0, 0.0,  // top-left
  -1.0, -1.0,    0.0, 1.0,  // bottom-left
   1.0,  1.0,    1.0, 0.0,  // top-right
   1.0, -1.0,    1.0, 1.0,  // bottom-right
]);

// ─── Cursor shape is defined entirely in cursor.vert via gl_VertexID ────────
// No vertex buffer needed — the vertex shader uses the built-in gl_VertexID
// to select points from control-point arrays and a Catmull-Rom spline.
// Fill:   15 vertices (TRIANGLES)
// Outline: 64 vertices (LINE_LOOP, Catmull-Rom spline)

// ─── Uniform names (must match GLSL declarations) ───────────────────────────
const UNIFORM_NAMES = [
  'u_texture',
  'u_resolution',
  'u_time',
  'u_strength',
] as const;

const CURSOR_UNIFORM_NAMES = [
  'u_cursorPos',
  'u_cursorSize',
  'u_resolution',
  'u_time',
] as const;

// ─── ShaderRenderer interface ───────────────────────────────────────────────
export interface ShaderRenderer {
  /** The compiled/linked WebGL program */
  readonly program: WebGLProgram | null;

  /** Named uniform locations (null if not found / not used) */
  readonly uniforms: Record<string, WebGLUniformLocation | null>;

  /** Initialise all GPU resources: compile shaders, create program, geometry, texture */
  init(gl: WebGL2RenderingContext, config?: { customCursor?: boolean }): boolean;

  /** Resize viewport and update the resolution uniform */
  resize(gl: WebGL2RenderingContext, width: number, height: number): void;

  /**
   * Render a single VideoFrame through the shader.
   * Uploads the frame to the input texture, binds everything, and issues a draw call.
   * If custom cursor is enabled, the cursor overlay is rendered on top.
   */
  renderFrame(
    gl: WebGL2RenderingContext,
    frame: VideoFrame,
    time: number,
    strength: number,
  ): void;

  /**
   * Update the cursor position in normalized coordinates (0.0 – 1.0).
   * The cursor is rendered on top of the frame only if custom_cursor was enabled
   * when init() was called. This method is a no-op otherwise.
   */
  setCursorPosition(x: number, y: number): void;

  /** Release all GPU resources */
  destroy(gl: WebGL2RenderingContext): void;
}

// ─── Internal helpers ───────────────────────────────────────────────────────

function compileShader(gl: WebGL2RenderingContext, source: string, type: number): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error('Shader compile error:', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext, vsSource: string, fsSource: string): WebGLProgram | null {
  const vs = compileShader(gl, vsSource, gl.VERTEX_SHADER);
  const fs = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);

  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program link error:', gl.getProgramInfoLog(prog));
    gl.deleteProgram(prog);
    return null;
  }

  // Shaders are linked; we can detach and delete them now
  gl.detachShader(prog, vs);
  gl.detachShader(prog, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  return prog;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createShaderRenderer(): ShaderRenderer {
  let program: WebGLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let vbo: WebGLBuffer | null = null;
  let texture: WebGLTexture | null = null;
  const uniforms: Record<string, WebGLUniformLocation | null> = {};

  // ── Cursor state ────────────────────────────────────────────────────────
  let cursorEnabled = false;
  let cursorProgram: WebGLProgram | null = null;
  const cursorUniforms: Record<string, WebGLUniformLocation | null> = {};
  let cursorVao: WebGLVertexArrayObject | null = null;
  let cursorVbo: WebGLBuffer | null = null;
  let cursorX = 0.5;
  let cursorY = 0.5;

  // Track texture dimensions for re-allocation
  let textureWidth = 1;
  let textureHeight = 1;

  const renderer: ShaderRenderer = {
    get program() { return program; },
    get uniforms() { return uniforms; },

    init(gl: WebGL2RenderingContext, config?: { customCursor?: boolean }): boolean {
      cursorEnabled = config?.customCursor ?? false;

      // 1. Create main program
      program = createProgram(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);
      if (!program) return false;

      // 2. Fetch uniform locations for main program
      for (const name of UNIFORM_NAMES) {
        uniforms[name] = gl.getUniformLocation(program, name);
      }

      // 3. Create cursor program if enabled (uses its own vertex shader + geometry)
      if (cursorEnabled) {
        cursorProgram = createProgram(gl, CURSOR_VERT_SOURCE, CURSOR_FRAG_SOURCE);
        if (!cursorProgram) {
          console.warn('Custom cursor: failed to compile cursor program — disabling');
          cursorEnabled = false;
        } else {
          for (const name of CURSOR_UNIFORM_NAMES) {
            cursorUniforms[name] = gl.getUniformLocation(cursorProgram, name);
          }

          // Create an empty VAO for the cursor.
          // The vertex shader uses gl_VertexID to compute all positions
          // from control-point arrays — no vertex buffer is needed.
          cursorVao = gl.createVertexArray();
          gl.bindVertexArray(cursorVao);
          // No buffers, no attributes — everything comes from gl_VertexID
          gl.bindVertexArray(null);

          console.log('Custom cursor program compiled successfully');
        }
      }

      // 4. Main VAO / VBO (shared between main programs)
      vao = gl.createVertexArray();
      gl.bindVertexArray(vao);

      vbo = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);

      const posLoc = gl.getAttribLocation(program, 'a_position');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);

      const texLoc = gl.getAttribLocation(program, 'a_texCoord');
      gl.enableVertexAttribArray(texLoc);
      gl.vertexAttribPointer(texLoc, 2, gl.FLOAT, false, 16, 8);

      // 5. Input texture (initially 1x1, resized on first frame)
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      return true;
    },

    resize(gl: WebGL2RenderingContext, width: number, height: number): void {
      gl.viewport(0, 0, width, height);
      gl.useProgram(program);
      if (uniforms.u_resolution) {
        gl.uniform2f(uniforms.u_resolution, width, height);
      }
      // Also update cursor resolution uniform
      if (cursorEnabled && cursorProgram) {
        gl.useProgram(cursorProgram);
        if (cursorUniforms.u_resolution) {
          gl.uniform2f(cursorUniforms.u_resolution, width, height);
        }
      }
    },

    renderFrame(
      gl: WebGL2RenderingContext,
      frame: VideoFrame,
      time: number,
      strength: number,
    ): void {
      // ── Pass 1: Render the captured frame ───────────────────────────────
      // Re-allocate texture if frame size changed
      if (frame.displayWidth !== textureWidth || frame.displayHeight !== textureHeight) {
        textureWidth = frame.displayWidth;
        textureHeight = frame.displayHeight;
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(
          gl.TEXTURE_2D, 0, gl.RGBA,
          textureWidth, textureHeight, 0,
          gl.RGBA, gl.UNSIGNED_BYTE, null,
        );
      }

      // Upload VideoFrame → texture (GPU-to-GPU, zero-copy)
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame);

      // Clear and render main frame
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);

      if (uniforms.u_texture) gl.uniform1i(uniforms.u_texture, 0);
      if (uniforms.u_time) gl.uniform1f(uniforms.u_time, time);
      if (uniforms.u_strength) gl.uniform1f(uniforms.u_strength, strength);

      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // ── Pass 2: Render cursor overlay (if enabled) ──────────────────────
        if (cursorEnabled && cursorProgram && cursorVao) {
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

          gl.useProgram(cursorProgram);
          gl.bindVertexArray(cursorVao);

          // Set shared uniforms
          if (cursorUniforms.u_cursorPos) {
            gl.uniform2f(cursorUniforms.u_cursorPos, cursorX, cursorY);
          }
          if (cursorUniforms.u_cursorSize) {
            gl.uniform1f(cursorUniforms.u_cursorSize, 15.0);
          }
          if (cursorUniforms.u_resolution) {
            gl.uniform2f(cursorUniforms.u_resolution, gl.canvas.width, gl.canvas.height);
          }
          if (cursorUniforms.u_time) {
            gl.uniform1f(cursorUniforms.u_time, time);
          }

          // Draw: plasma fill (TRIANGLES, 3 vertices = 1 triangle)
          gl.drawArrays(gl.TRIANGLES, 0, 3);

          gl.bindVertexArray(null);
          gl.disable(gl.BLEND);
        }
    },

    setCursorPosition(x: number, y: number): void {
      cursorX = x;
      cursorY = y;
    },

    destroy(gl: WebGL2RenderingContext): void {
      if (vao) gl.deleteVertexArray(vao);
      if (vbo) gl.deleteBuffer(vbo);
      if (cursorVao) gl.deleteVertexArray(cursorVao);
      if (texture) gl.deleteTexture(texture);
      if (program) gl.deleteProgram(program);
      if (cursorProgram) gl.deleteProgram(cursorProgram);
      vao = null;
      vbo = null;
      cursorVao = null;
      cursorVbo = null;
      texture = null;
      program = null;
      cursorProgram = null;
      cursorEnabled = false;
    },
  };

  return renderer;
}