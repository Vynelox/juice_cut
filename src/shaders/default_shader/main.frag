#version 300 es
precision highp float;
in vec2 v_texCoord;
out vec4 outColor;
uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform float u_time;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  vec2 center = vec2(0.5, 0.5);
  
  // Create animated plasma pattern
  float t = u_time * 0.5;
  
  // Multiple wave layers for complexity
  float wave1 = sin(uv.x * 10.0 + t);
  float wave2 = sin(uv.y * 10.0 + t * 1.3);
  float wave3 = sin((uv.x + uv.y) * 8.0 + t * 0.7);
  float wave4 = sin(length(uv - center) * 15.0 - t * 2.0);
  
  // Combine waves
  float plasma = (wave1 + wave2 + wave3 + wave4) * 0.25;
  
  // Create color cycling
  vec3 plasmaColor = vec3(
    sin(plasma * 3.14159 + t) * 0.5 + 0.5,
    sin(plasma * 3.14159 + t + 2.094) * 0.5 + 0.5,  // +120 degrees
    sin(plasma * 3.14159 + t + 4.188) * 0.5 + 0.5   // +240 degrees
  );
  
  // Get original texture
  vec4 texColor = texture(u_texture, v_texCoord).bgra;
  
  // Distort texture coordinates based on plasma
  vec2 distortion = vec2(
    sin(plasma * 5.0 + t) * 0.02,
    cos(plasma * 5.0 + t) * 0.02
  );
  vec4 distortedTex = texture(u_texture, v_texCoord + distortion).bgra;
  
  // Mix original, distorted, and plasma
  vec3 finalColor = mix(distortedTex.rgb, plasmaColor, 0.4);
  finalColor = mix(finalColor, texColor.rgb, 0.3);
  
  // Add glow effect
  float glow = smoothstep(0.3, 0.8, plasma) * 0.3;
  finalColor += glow;
  
  outColor = vec4(finalColor, 1.0);
}