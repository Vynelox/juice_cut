#version 300 es
precision highp float;

/**
 * cursor.frag
 * 
 * Renders a custom cursor overlay on top of the captured frame.
 * Only active when config.custom_cursor is enabled.
 * 
 * The cursor geometry is provided by cursor.vert and includes rounded corners
 * via vertex geometry. This fragment shader handles the color mapping and noise pattern.
 * 
 * Single draw call: TRIANGLES — fBM noise pattern with custom colormap
 * 
 * Uniforms:
 *   u_time       — Elapsed time in seconds (for animation)
 *   u_cursorSize — Base scale of the cursor in pixels
 *   u_resolution — Viewport size in pixels
 */

in vec2 v_uv;
out vec4 outColor;

uniform float u_time;
uniform float u_cursorSize;
uniform vec2 u_resolution;

// Median hue of the theme colors (0.0–1.0)
uniform float u_medianHue;

// Median saturation of the theme colors (0.0–1.0)
uniform float u_medianSat;

// Median brightness of the theme colors (0.0–1.0)
uniform float u_medianBright;

// ─── RGB ↔ HSV conversion ────────────────────────────────────────────────────
vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// ─── Colormap functions ───────────────────────────────────────────────────────
float colormap_red(float x) {
    if (x < 0.0) {
        return 54.0 / 255.0;
    } else if (x < 20049.0 / 82979.0) {
        return (829.79 * x + 54.51) / 255.0;
    } else {
        return 1.0;
    }
}

float colormap_green(float x) {
    if (x < 20049.0 / 82979.0) {
        return 0.0;
    } else if (x < 327013.0 / 810990.0) {
        return (8546482679670.0 / 10875673217.0 * x - 2064961390770.0 / 10875673217.0) / 255.0;
    } else if (x <= 1.0) {
        return (103806720.0 / 483977.0 * x + 19607415.0 / 483977.0) / 255.0;
    } else {
        return 1.0;
    }
}

float colormap_blue(float x) {
    if (x < 0.0) {
        return 54.0 / 255.0;
    } else if (x < 7249.0 / 82979.0) {
        return (829.79 * x + 54.51) / 255.0;
    } else if (x < 20049.0 / 82979.0) {
        return 127.0 / 255.0;
    } else if (x < 327013.0 / 810990.0) {
        return (792.02249341361393720147485376583 * x - 64.364790735602331034989206222672) / 255.0;
    } else {
        return 1.0;
    }
}

vec4 colormap(float x) {
    return vec4(colormap_red(x), colormap_green(x), colormap_blue(x), 1.0);
}

// ─── Noise and fBM functions ─────────────────────────────────────────────────
float rand(vec2 n) { 
    return fract(sin(dot(n, vec2(12.9898, 4.1414))) * 43758.5453);
}

float noise(vec2 p){
    vec2 ip = floor(p);
    vec2 u = fract(p);
    u = u*u*(3.0-2.0*u);

    float res = mix(
        mix(rand(ip),rand(ip+vec2(1.0,0.0)),u.x),
        mix(rand(ip+vec2(0.0,1.0)),rand(ip+vec2(1.0,1.0)),u.x),u.y);
    return res*res;
}

const mat2 mtx = mat2( 0.80,  0.60, -0.60,  0.80 );

float fbm( vec2 p )
{
    float f = 0.0;

    f += 0.500000*noise( p + u_time  ); p = mtx*p*2.02;
    f += 0.031250*noise( p ); p = mtx*p*2.01;
    f += 0.250000*noise( p ); p = mtx*p*2.03;
    f += 0.125000*noise( p ); p = mtx*p*2.01;
    f += 0.062500*noise( p ); p = mtx*p*2.04;
    f += 0.015625*noise( p + sin(u_time) );

    return f/0.96875;
}

float pattern( in vec2 p )
{
    return fbm( p + fbm( p + fbm( p ) ) );
}

// ─── Edge distance for border ────────────────────────────────────────────────
// Triangle vertices in UV space:
// v0 = (0.5, 0.0) - tip
// v1 = (0.0, 1.0) - base left
// v2 = (1.0, 1.0) - base right
//
// Edges:
// edge0: v0 -> v1 (left edge)
// edge1: v1 -> v2 (base edge)
// edge2: v2 -> v0 (right edge)

float edgeDistance(vec2 p, vec2 a, vec2 b) {
    // Distance from point p to line segment ab
    vec2 ab = b - a;
    vec2 ap = p - a;
    float t = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
    vec2 closest = a + ab * t;
    return length(p - closest);
}

float triangleEdgeDistance(vec2 uv) {
    vec2 v0 = vec2(0.5, 0.0);
    vec2 v1 = vec2(0.0, 1.0);
    vec2 v2 = vec2(1.0, 1.0);
    
    float d0 = edgeDistance(uv, v0, v1);  // left edge
    float d1 = edgeDistance(uv, v1, v2);  // base edge
    float d2 = edgeDistance(uv, v2, v0);  // right edge
    
    return min(min(d0, d1), d2);
}

void main() {
    // Scale UV coordinates for pattern density
    vec2 uv = v_uv * 10.0;
    
    // Generate pattern using fBM
    float shade = pattern(uv);
    
    // Apply colormap
    vec4 color = colormap(shade);

    // ── Hue-shift, saturation-shift, and brightness-shift the colormap output to the theme ──
    // Convert to HSV, replace hue, saturation, and brightness with median theme values, convert back to RGB
    vec3 hsv = rgb2hsv(color.rgb);
    hsv.x = u_medianHue;
    hsv.y = u_medianSat;
    hsv.z = u_medianBright;
    color.rgb = hsv2rgb(hsv);
    
    // Calculate distance to triangle edges for border
    float edgeDist = triangleEdgeDistance(v_uv);
    
    // Border width in UV space
    float borderWidth = 0.12;
    
    // Create rounded border effect using smoothstep
    float borderAlpha = smoothstep(borderWidth, 0.0, edgeDist);
    
    // Debug: visualize edge distance (uncomment to debug)
    // vec3 finalColor = vec3(edgeDist * 10.0);
    
    // Mix pattern color with black border
    vec3 finalColor = mix(vec3(0.0, 0.0, 0.0), color.rgb, 1.0 - borderAlpha);
    
    // Ensure alpha is fully opaque
    outColor = vec4(finalColor, 1.0);
}
