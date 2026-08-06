#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 outColor;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_time;
// Random function for glitch effects
float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 texCoord = v_texCoord;  // No flip - use original coordinates
  float t = u_time;
  
  // Create glitch timing - intermittent bursts
  float glitchIntensity = step(0.95, random(vec2(floor(t * 2.0), 0.0)));
  
  // Horizontal slice displacement
  float sliceY = floor(uv.y * 30.0);
  float sliceOffset = random(vec2(sliceY, floor(t * 10.0))) * 0.1 * glitchIntensity;
  
  // RGB channel separation
  float rgbShift = 0.01 * glitchIntensity;
  vec2 uvR = texCoord + vec2(sliceOffset + rgbShift, 0.0);
  vec2 uvG = texCoord + vec2(sliceOffset, 0.0);
  vec2 uvB = texCoord + vec2(sliceOffset - rgbShift, 0.0);
  
  // Sample texture with RGB shift
  vec4 colorR = texture(u_texture, uvR).bgra;
  vec4 colorG = texture(u_texture, uvG).bgra;
  vec4 colorB = texture(u_texture, uvB).bgra;
  
  // Recombine channels
  vec3 glitchColor = vec3(colorR.r, colorG.g, colorB.b);
  
  // Add scanlines
  float scanline = sin(gl_FragCoord.y * 1.5) * 0.04;
  glitchColor -= scanline;
  
  // Add screen tear (occasional horizontal displacement)
  float tearY = step(0.98, random(vec2(floor(t * 5.0), 1.0)));
  float tearOffset = (random(vec2(floor(uv.y * 50.0), t)) - 0.5) * 0.2 * tearY;
  vec2 tornUV = texCoord + vec2(tearOffset, 0.0);
  vec4 tornColor = texture(u_texture, tornUV).bgra;
  
  // Mix glitch and tear effects
  vec3 finalColor = mix(tornColor.rgb, glitchColor, 0.7);
  
  // Add noise
  float noise = random(uv + t) * 0.05 * glitchIntensity;
  finalColor += noise;
  
  // Vignette
  float vignette = 1.0 - length(uv - 0.5) * 0.5;
  finalColor *= vignette;
  
  outColor = vec4(finalColor.gbr, tornColor.a);
}