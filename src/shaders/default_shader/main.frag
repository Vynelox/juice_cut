#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 outColor;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_strength;

// 17 theme colors, 3 components (RGB) each = 51 floats
// Order matches GlobalStyleSettings.tsx colorFields array:
// 0: --bg-panel, 1: --bg-base, 2: --bg-viewer, 3: --video-bg, 4: --bg-elevated,
// 5: --bg-hover, 6: --border, 7: --border-mid, 8: --splitter, 9: --text-primary,
// 10: --text-secondary, 11: --text-muted, 12: --input-field, 13: --input-field-bg,
// 14: --playneedle, 15: --highlight-color, 16: --automation-line
uniform vec3 u_themeColors[17];

// Random function for subtle noise
float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

// Check if a pixel is close to the playneedle color (index 14)
bool isPlayneedle(vec3 color) {
  float threshold = 0.15; // Tolerance for anti-aliasing / glow
  vec3 needleColor = u_themeColors[14]; // --playneedle
  return distance(color, needleColor) < threshold;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 texCoord = v_texCoord;
  float t = u_time;

  // Sample original pixel
  vec4 originalColor = texture(u_texture, texCoord).rgba;
  vec3 pixelRGB = originalColor.rgb;

  // If this pixel is NOT the playneedle, output it unchanged
  if (!isPlayneedle(pixelRGB)) {
    outColor = originalColor;
    return;
  }

  // ── WAVE PATTERN: Only applied to playneedle pixels ──────────────────────
  // The playneedle is a vertical line, so we wave it horizontally based on Y position.
  // This creates a rippling/snake-like motion along the needle.

  // Sample the playneedle color for the wave tint
  vec3 needleColor = u_themeColors[14];

  // Wave displacement: horizontal offset based on vertical position + time
  // Creates a sine wave that travels down the needle
  float wave = sin(uv.y * 20.0 + t * 4.0) * 0.5 + 0.5;

  // Secondary wave for more organic motion
  float wave2 = sin(uv.y * 35.0 - t * 6.0 + 1.3) * 0.5 + 0.5;

  // Combine waves for a flowing effect
  float combinedWave = (wave * 0.7 + wave2 * 0.3) * u_strength;

  // Sample the texture at a horizontally displaced position to create the wave
  // The displacement is strongest at the needle's position
  vec2 waveUV = texCoord + vec2(combinedWave * 0.02, 0.0);
  vec4 waveColor = texture(u_texture, waveUV).bgra;

  // Brighten/pulse the needle with the wave
  float pulse = 0.8 + combinedWave * 0.4;

  // Mix the displaced sample with the original needle color, tinted by the wave
  vec3 finalColor = mix(waveColor.rgb, needleColor, 0.3 + combinedWave * 0.3);
  finalColor *= pulse;

  // Add a subtle glow that travels along the needle
  float glow = sin(uv.y * 15.0 + t * 3.0) * 0.5 + 0.5;
  finalColor += needleColor * glow * 0.15 * u_strength;

  // Add tiny sparkle noise for texture
  float sparkle = random(vec2(uv.y * 100.0, floor(t * 10.0))) * 0.05 * u_strength;
  finalColor += sparkle;

  outColor = vec4(finalColor.rgb, originalColor.a);
}