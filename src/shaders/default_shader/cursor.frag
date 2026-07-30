#version 300 es
precision highp float;

/**
 * cursor.frag
 * 
 * Renders a custom cursor overlay on top of the captured frame.
 * Only active when config.custom_cursor is enabled.
 * 
 * The cursor geometry is provided by cursor.vert and the vertex buffer.
 * Single draw call: TRIANGLES — plasma warping pattern fill with beveled underside
 * 
 * Uniforms:
 *   u_time       — Elapsed time in seconds (for plasma animation)
 *   u_cursorSize — Base scale of the cursor in pixels (for scaling plasma)
 *   u_resolution — Viewport size in pixels
 */

in vec2 v_uv;
out vec4 outColor;

uniform float u_time;
uniform float u_cursorSize;
uniform vec2 u_resolution;

// ─── Plasma warping pattern ───────────────────────────────────────────────────
// Classic plasma effect using sine wave interference
float plasma(vec2 uv, float time) {
    // Scale UV coordinates for pattern density
    vec2 p = uv * 10.0;
    
    // Multiple sine waves at different frequencies and phases
    float v = 0.0;
    v += sin(p.x + time * 1.5);
    v += sin(p.y + time * 1.2);
    v += sin(p.x + p.y + time * 1.8);
    v += sin(sqrt(p.x * p.x + p.y * p.y) * 3.0 + time * 2.0);
    v += sin(p.x * 2.0 - p.y * 1.5 + time * 1.0);
    
    return v * 0.2;  // Scale to -1 to 1 range
}

// ─── HSV to RGB conversion ──────────────────────────────────────────────────
vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// ─── Smooth step function for smoother color transitions ─────────────────────
float smoothStep(float edge0, float edge1, float x) {
    float t = clamp((x - edge0) / (edge1 - edge0), 0.0, 1.0);
    return t * t * (3.0 - 2.0 * t);
}

// ─── Bevel effect for underside (base edge) ───────────────────────────────────
// The triangle base is at v_uv.y ≈ 1.0, spanning from v_uv.x = 0 to 1
// Returns a highlight/shadow factor for the bevel
float bevelUnderside(vec2 uv) {
    // Distance from base edge (y = 1)
    float distFromBase = 1.0 - uv.y;
    
    // Width of bevel region (in UV space)
    float bevelWidth = 0.16;
    
    // Smooth falloff from base edge
    float bevelFactor = smoothStep(bevelWidth, 0.0, distFromBase);
    
    // Add variation along the base edge for a more organic feel
    float edgeVariation = sin(uv.x * 20.0 + u_time * 3.0) * 0.3 + 0.7;
    bevelFactor *= edgeVariation;
    
    return bevelFactor;
}

void main() {
    // Get plasma value at this UV coordinate
    float plasmaVal = plasma(v_uv, u_time);
    
    // Map plasma value (-1 to 1) to hue (0 to 1)
    float hue = plasmaVal * 0.5 + 0.5 + u_time * 0.1;
    hue = fract(hue);
    
    // Create dynamic saturation and value based on plasma
    float sat = 0.8 + 0.2 * sin(plasmaVal * 3.14159 + u_time);
    float val = 0.7 + 0.3 * cos(plasmaVal * 2.0 + u_time * 0.5);
    
    // Convert to RGB
    vec3 color = hsv2rgb(vec3(hue, sat, val));
    
    // Add subtle glow at edges using UV distance from center
    float distFromCenter = length(v_uv - vec2(0.5, 0.5));
    float edgeGlow = smoothStep(0.5, 0.3, distFromCenter) * 0.3;
    color += vec3(edgeGlow);
    
    // ─── Bevel on underside (base of triangle) ──────────────────────────────
    float bevel = bevelUnderside(v_uv);
    
    // Highlight on the very edge (catching light)
    float highlight = smoothStep(0.02, 0.0, 1.0 - v_uv.y) * 0.4;
    
    // Shadow just above the highlight (recessed look)
    float shadow = smoothStep(0.06, 0.02, 1.0 - v_uv.y) * -0.25;
    
    // Apply bevel shading
    color += vec3(highlight + shadow) * bevel;
    
    // Add time-based pulsing brightness
    float pulse = 0.9 + 0.1 * sin(u_time * 2.0);
    color *= pulse;
    
    outColor = vec4(color, 1.0);
}
