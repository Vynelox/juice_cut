#version 300 es
precision highp float;


//main.frag
in vec2 v_texCoord;
out vec4 outColor;

uniform sampler2D u_texture;
uniform float u_time;
uniform vec2 u_resolution;
uniform float u_strength; // 0.0 = Original, 1.0 = MAX CHAOS

// Pseudo-random function
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

void main() {
    vec2 uv = v_texCoord;

    // 1. GLITCH BLOCKS (Screen Tearing)
    // Shift horizontal slices of the image randomly based on time
    float glitchIntensity = 0.05 * u_strength;
    float glitchLine = floor(uv.y * 20.0);
    float glitchOffset = (random(vec2(glitchLine, floor(u_time * 15.0))) - 0.5) * glitchIntensity;
    
    // Only glitch occasionally to make it punchy
    float glitchTrigger = step(0.85, random(vec2(floor(u_time * 10.0), glitchLine)));
    uv.x += glitchOffset * glitchTrigger;

    // 2. EXTREME CHROMATIC ABERRATION (RGB Split)
    float aberration = 0.02 * u_strength;
    float r = texture(u_texture, uv + vec2(aberration, 0.0)).r;
    float g = texture(u_texture, uv).g;
    float b = texture(u_texture, uv - vec2(aberration, 0.0)).b;
    vec3 color = vec3(r, g, b);

    // 3. AGGRESSIVE COLOR CYCLING & INVERSION
    // Rapidly shift hues without strobing brightness
    float shift = sin(u_time * 2.0) * 0.5 + 0.5;
    color.rgb = mix(color.rgb, color.bgr, shift * u_strength);
    
    // Occasional color inversion
    float invertTrigger = step(0.9, random(vec2(floor(u_time * 8.0))));
    color.rgb = mix(color.rgb, 1.0 - color.rgb, invertTrigger * u_strength);

    // 4. HEAVY NOISE / GRAIN
    float noise = random(uv * u_time) * 0.2 * u_strength;
    color.rgb += noise;

    // 5. HIGH CONTRAST / SATURATION BOOST
    color.rgb = pow(color.rgb, vec3(0.8)); // Gamma correction for punchiness
    
    outColor = vec4(color, 1.0);
}