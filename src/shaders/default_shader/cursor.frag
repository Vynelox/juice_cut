#version 300 es
precision highp float;

/**
 * cursor.frag
 * 
 * Renders a custom cursor overlay on top of the captured frame.
 * Only active when config.custom_cursor is enabled.
 * 
 * The cursor is drawn as a simple circular pointer with a
 * crosshair ring and a bright center dot.
 */

in vec2 v_texCoord;
out vec4 outColor;

uniform vec2  u_cursorPos;   // Normalized cursor position (0.0 – 1.0)
uniform float u_cursorSize;  // Radius of the cursor in pixels
uniform vec2  u_resolution;  // Viewport size in pixels

void main() {
    // Distance from current fragment to cursor center, in pixels
    vec2  deltaPx  = (v_texCoord - u_cursorPos) * u_resolution;
    float dist     = length(deltaPx);

    // ── Cursor shape ──────────────────────────────────────────────────────
    // Outer ring (radius = u_cursorSize, thickness = 1.5px)
    float ringOuter = u_cursorSize;
    float ringInner = u_cursorSize - 1.5;
    float ring      = smoothstep(ringInner - 0.5, ringInner + 0.5, dist)
                    * smoothstep(ringOuter + 0.5, ringOuter - 0.5, dist);

    // Crosshair lines (horizontal + vertical, 1px wide)
    float lineW = 1.0;
    float cross = 0.0;
    if (abs(deltaPx.x) < lineW && dist < u_cursorSize * 2.5) cross = 1.0;
    if (abs(deltaPx.y) < lineW && dist < u_cursorSize * 2.5) cross = 1.0;

    // Center dot (radius = 2px)
    float dotRadius = 2.0;
    float dot = 1.0 - smoothstep(dotRadius - 0.5, dotRadius + 0.5, dist);

    // ── Composite ─────────────────────────────────────────────────────────
    float alpha = max(ring, max(cross, dot));
    vec3  color = vec3(1.0, 1.0, 1.0);  // White cursor

    // Add a subtle shadow by darkening the area just behind the cursor
    // (optional — can be disabled by removing this block)
    // float shadow = 1.0 - smoothstep(0.0, u_cursorSize * 3.0, dist);
    // color = mix(color, vec3(0.0), shadow * 0.3);

    outColor = vec4(color, alpha);
}