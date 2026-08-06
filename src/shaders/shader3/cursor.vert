#version 300 es

/**
 * cursor.vert
 *
 * Defines the cursor shape entirely inside the vertex shader using
 * control-point coordinates.
 *
 * The cursor is an **isosceles triangle** pointing up-left at 45°.
 *
 * There are NO input vertex attributes — the vertex index (gl_VertexID)
 * selects which point to output:
 *
 *   Fill mode: 3 vertices = 1 triangle with UV coordinates for plasma effect
 *
 * Uniforms:
 *   u_cursorPos   — Normalized cursor position (0.0 – 1.0)
 *   u_cursorSize  — Base scale of the cursor in pixels
 *   u_resolution  — Viewport size in pixels
 *   u_time        — Elapsed time in seconds (for plasma animation)
 *   u_rotation    — Rotation angle in radians (0.0 = default 45° orientation)
 */

uniform vec2  u_cursorPos;
uniform float u_cursorSize;
uniform vec2  u_resolution;
uniform float u_time;
const float u_rotation = 4.2;

// ─── Output varying for UV coordinates ────────────────────────────────────────
out vec2 v_uv;

// ─── Control points (isosceles triangle) ─────────────────────────────────────
// Tip is at (0,0); the two equal sides meet at the tip.
// The base is at the bottom-right, perpendicular to the 45° diagonal.
const int NUM_CTRL = 3;
const vec2 CTRL_PTS[NUM_CTRL] = vec2[](
    vec2(0.0, 0.0),     // 0: Tip (cursor position)
    vec2(10.0, 30.0),   // 1: Base left
    vec2(30.0, 10.0)    // 2: Base right
);

// UV coordinates for each vertex of the triangle
const vec2 UV_PTS[NUM_CTRL] = vec2[](
    vec2(0.5, 0.0),     // 0: Tip -> top center
    vec2(0.0, 1.0),     // 1: Base left -> bottom left
    vec2(1.0, 1.0)      // 2: Base right -> bottom right
);

// ─── Fill triangulation (3 vertices = 1 triangle) ───────────────────────────
vec2 getFillVertex(int id) {
    if (id == 0) return vec2(0.0, 0.0);
    if (id == 1) return vec2(10.0, 30.0);
    if (id == 2) return vec2(30.0, 10.0);
    return vec2(0.0);
}

vec2 getFillUV(int id) {
    return UV_PTS[id];
}

// ─── Main ───────────────────────────────────────────────────────────────────
void main() {
    vec2 localPos;
    vec2 uv;

    // Fill: single triangle with UV coordinates
    localPos = getFillVertex(gl_VertexID);
    uv = getFillUV(gl_VertexID);

    // Rotate the local position around the tip (0,0) by u_rotation radians
    float cosR = cos(u_rotation);
    float sinR = sin(u_rotation);
    vec2 rotated = vec2(
        localPos.x * cosR - localPos.y * sinR,
        localPos.x * sinR + localPos.y * cosR
    );

    // Convert from local pixel space to clip space at cursor position
    vec2 cursorClip = vec2(
        u_cursorPos.x * 2.0 - 1.0,
        1.0 - u_cursorPos.y * 2.0
    );
    float scale = u_cursorSize / 15.0;
    vec2 offset = (rotated * scale) / u_resolution * 2.0;

    gl_Position = vec4(cursorClip + offset, 0.0, 1.0);
    v_uv = uv;
}