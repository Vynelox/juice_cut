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

// Median hue of all theme colors (0.0–1.0)
// Calculated by App.tsx: converts all 17 theme colors to HSL, sorts by hue, picks the middle value
uniform float u_medianHue;

// Median saturation of all theme colors (0.0–1.0)
// Calculated by App.tsx: converts all 17 theme colors to HSL, sorts by saturation, picks the middle value
uniform float u_medianSat;

void main(){
  outColor = texture(u_texture, v_texCoord);
}