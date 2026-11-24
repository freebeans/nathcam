import { P3_LUMA, P3_TO_SRGB, SRGB_TO_P3, GAMUT_POWER, GAMUT_THRESHOLD, type Mat3 } from '../color';

const f = (v: number) => {
  const s = v.toPrecision(9);
  return s.includes('.') || s.includes('e') ? s : s + '.0';
};
/** Matriz em ordem de linhas -> construtor mat3 do GLSL (que é por colunas). */
const mat3 = (m: Mat3) => `mat3(${[m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]].map(f).join(', ')})`;

export const VERTEX_SHADER = /* glsl */ `#version 300 es
// Triângulo que cobre a tela inteira.
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

export const COMMON_GLSL = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler3D;

const vec3 LUMA = vec3(${f(P3_LUMA[0])}, ${f(P3_LUMA[1])}, ${f(P3_LUMA[2])});
const mat3 P3_TO_SRGB = ${mat3(P3_TO_SRGB)};
const mat3 SRGB_TO_P3 = ${mat3(SRGB_TO_P3)};
const float GAMUT_THRESHOLD = ${f(GAMUT_THRESHOLD)};
const float GAMUT_POWER = ${f(GAMUT_POWER)};

// Tamanho da imagem de saída inteira (px) e origem/tamanho do alvo atual.
uniform vec2 u_outSize;
uniform vec2 u_targetOrigin;
uniform vec2 u_targetSize;
uniform int u_flipY;
// 1 = texturas intermediárias de 8 bits guardam valores codificados.
uniform int u_lowp;

float luma(vec3 c) { return dot(c, LUMA); }

float encode1(float x) {
  float a = abs(x);
  float r = a <= 0.0031308 ? a * 12.92 : 1.055 * pow(a, 1.0 / 2.4) - 0.055;
  return sign(x) * r;
}
float decode1(float x) {
  float a = abs(x);
  float r = a <= 0.04045 ? a / 12.92 : pow((a + 0.055) / 1.055, 2.4);
  return sign(x) * r;
}
vec3 encode(vec3 c) { return vec3(encode1(c.r), encode1(c.g), encode1(c.b)); }
vec3 decode(vec3 c) { return vec3(decode1(c.r), decode1(c.g), decode1(c.b)); }

/** Pixel global (centro) da imagem de saída, com y para baixo. */
vec2 globalPixel() {
  vec2 fc = gl_FragCoord.xy;
  if (u_flipY == 1) fc.y = u_targetSize.y - fc.y;
  return u_targetOrigin + fc;
}

/** Converte um pixel global em coordenada de textura de um alvo intermediário. */
vec2 regionCoord(vec2 px, vec2 origin, vec2 size) { return (px - origin) / size; }

/** Escala a cor para que sua luminância vá de l0 para l1, preservando a matiz. */
vec3 setLuma(vec3 rgb, float l0, float l1) {
  if (l0 <= 1e-6) return vec3(max(l1, 0.0));
  return rgb * (max(l1, 0.0) / l0);
}

uint hashU(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v.x ^ v.y ^ v.z;
}
float hash1(vec2 p, uint seed) {
  return float(hashU(uvec3(ivec2(floor(p)) + 32768, int(seed))) & 0xffffffu) / 16777215.0;
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}
`;
