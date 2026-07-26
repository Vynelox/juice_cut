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

void main() {
    outColor = vec4(texture(u_texture, v_texCoord).bgra);
}