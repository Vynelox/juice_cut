#version 300 es
precision highp float;

/**
 * cursor.frag
 * 
 * Renders a custom cursor overlay on top of the captured frame.
 * Only active when config.custom_cursor is enabled.
 * 
 * The cursor geometry is provided by cursor.vert and the vertex buffer.
 * Two draw calls are used:
 *   1. TRIANGLES  — white filled arrow body (u_rainbow = 0.0)
 *   2. LINE_LOOP  — animated rainbow border   (u_rainbow = 1.0)
 * 
 * Uniforms:
 *   u_rainbow  — 0.0 = white fill, 1.0 = rainbow border outline
 *   u_time     — Elapsed time in seconds (for rainbow animation)
 *   u_resolution — Viewport size in pixels (for position-based rainbow)
 */

out vec4 outColor;

uniform float u_rainbow;  // 0.0 = fill (white), 1.0 = outline (rainbow)
uniform float u_time;

// ─── HSV to RGB conversion ──────────────────────────────────────────────────
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    // White fill
    if (u_rainbow < 0.5) {
        outColor = vec4(1.0, 1.0, 1.0, 1.0);
        return;
    }

    // Rainbow border — colour cycles with time
    float hue = fract(u_time * 0.25);
    vec3 rainbow = hsv2rgb(vec3(hue, 1.0, 0.95));
    outColor = vec4(rainbow, 1.0);
}