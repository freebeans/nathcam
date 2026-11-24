/**
 * Etapas do pipeline em GLSL. Cada etapa declara seus uniforms e uma função.
 * A ORDEM em que são aplicadas não mora aqui: está em `../pipeline.ts`.
 *
 * Convenção: `rgb` é sempre Display P3 linear na entrada e na saída de cada
 * etapa. Etapas que trabalham em espaço perceptual codificam e decodificam
 * internamente.
 */

export interface StageGlsl {
  /** Declarações (uniforms, funções auxiliares). */
  decl: string;
  /** Corpo executado dentro de main(); lê e escreve `rgb`. */
  body: string;
}

export const decodeStage: StageGlsl = {
  decl: /* glsl */ `
uniform sampler2D u_src;
// Transformação afina (3x3) do uv de saída para o uv da fonte (recorte/rotação).
uniform mat3 u_srcXform;
// 1 = a textura foi carregada em sRGB (sem conversão para P3 no upload).
uniform int u_srcSrgb;
`,
  body: /* glsl */ `
  {
    vec2 suv = (u_srcXform * vec3(uv, 1.0)).xy;
    // SRGB8_ALPHA8: o hardware já devolve valores lineares.
    rgb = texture(u_src, suv).rgb;
    if (u_srcSrgb == 1) rgb = SRGB_TO_P3 * rgb;
  }
`,
};

export const calibrationStage: StageGlsl = {
  decl: /* glsl */ `
uniform mat3 u_calib;
uniform float u_shadowsTint;
`,
  body: /* glsl */ `
  {
    rgb = u_calib * rgb;
    if (u_shadowsTint != 0.0) {
      float w = 1.0 - smoothstep(0.0, 0.5, encode1(luma(rgb)));
      float t = 0.08 * u_shadowsTint * w;
      float l0 = luma(rgb);
      rgb *= vec3(1.0 + t, 1.0 - t, 1.0 + t);
      rgb = setLuma(rgb, luma(rgb), l0);
    }
  }
`,
};

export const whiteBalanceStage: StageGlsl = {
  decl: /* glsl */ `
uniform vec3 u_wb;
`,
  body: /* glsl */ `
  rgb *= u_wb;
`,
};

export const toneStage: StageGlsl = {
  decl: /* glsl */ `
uniform float u_exposure;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_whites;
uniform float u_blacks;

// Sino biweight: 1 no centro, 0 a partir de |y - c| >= w.
float bump(float y, float c, float w) {
  float t = clamp((y - c) / w, -1.0, 1.0);
  float k = 1.0 - t * t;
  return k * k;
}

float toneCurve(float y) {
  // Contraste: curva em S em torno do meio, extremos fixos.
  if (u_contrast != 0.0 && y > 0.0 && y < 1.0) {
    float d = y - 0.5;
    y += u_contrast * 0.5 * d * (1.0 - 4.0 * d * d);
  }
  y += 0.2 * u_shadows * bump(y, 0.25, 0.3);
  y += 0.2 * u_highlights * bump(y, 0.75, 0.35);
  float wb = clamp(1.0 - y / 0.4, 0.0, 1.0);
  y += 0.15 * u_blacks * wb * wb;
  float ww = clamp((y - 0.6) / 0.4, 0.0, 1.0);
  y += 0.15 * u_whites * ww * ww;
  return y;
}
`,
  body: /* glsl */ `
  {
    rgb *= exp2(u_exposure);
    float l0 = luma(rgb);
    float y = encode1(l0);
    float y1 = toneCurve(y);
    if (y1 != y) rgb = setLuma(rgb, l0, decode1(y1));
  }
`,
};

export const localContrastStage: StageGlsl = {
  decl: /* glsl */ `
uniform float u_texture;
uniform float u_clarity;
// Raios em pixels da imagem de saída e nível de mip correspondente.
uniform float u_textureRadius;
uniform float u_textureLod;
uniform float u_clarityRadius;
uniform float u_clarityLod;

float blurLuma(vec2 px, float radius, float lod) {
  vec2 s = u_aSize;
  float r = radius * 0.5;
  float a = 0.0;
  a += textureLod(u_a, regionCoord(px + vec2(-r, -r), u_aOrigin, s), lod).a;
  a += textureLod(u_a, regionCoord(px + vec2(r, -r), u_aOrigin, s), lod).a;
  a += textureLod(u_a, regionCoord(px + vec2(-r, r), u_aOrigin, s), lod).a;
  a += textureLod(u_a, regionCoord(px + vec2(r, r), u_aOrigin, s), lod).a;
  a += 2.0 * textureLod(u_a, regionCoord(px, u_aOrigin, s), lod).a;
  return a / 6.0;
}
`,
  body: /* glsl */ `
  if (u_texture != 0.0 || u_clarity != 0.0) {
    float l0 = luma(rgb);
    float y = aSample.a;
    float y1 = y;
    if (u_texture != 0.0) y1 += u_texture * 0.9 * (y - blurLuma(px, u_textureRadius, u_textureLod));
    if (u_clarity != 0.0) {
      float mid = clamp(1.0 - pow(2.0 * y - 1.0, 2.0), 0.0, 1.0);
      y1 += u_clarity * 0.7 * mid * (y - blurLuma(px, u_clarityRadius, u_clarityLod));
    }
    rgb = setLuma(rgb, l0, decode1(y1) * (l0 / max(decode1(y), 1e-6)));
  }
`,
};

export const curvesStage: StageGlsl = {
  decl: /* glsl */ `
uniform sampler2D u_curves;
uniform int u_curvesActive;
float curveAt(float x, int ch) {
  float t = clamp(x, 0.0, 1.0) * (255.0 / 256.0) + 0.5 / 256.0;
  return texture(u_curves, vec2(t, 0.5))[ch];
}
`,
  body: /* glsl */ `
  if (u_curvesActive == 1) {
    vec3 c = encode(rgb);
    rgb = decode(vec3(curveAt(c.r, 0), curveAt(c.g, 1), curveAt(c.b, 2)));
  }
`,
};

export const hslStage: StageGlsl = {
  decl: /* glsl */ `
uniform float u_hslHue[8];
uniform float u_hslSat[8];
uniform float u_hslLum[8];
// Faixas em voltas (0..1): centro, largura e suavidade.
uniform float u_hslCenter[8];
uniform float u_hslWidth[8];
uniform float u_hslSoft[8];
uniform int u_hslActive;

float bandWeight(float h, int i) {
  float d = abs(h - u_hslCenter[i]);
  d = min(d, 1.0 - d);
  float hard = u_hslWidth[i] * (1.0 - u_hslSoft[i]);
  float edge = u_hslWidth[i] * (1.0 + u_hslSoft[i]) * 0.999 + 1e-5;
  return 1.0 - smoothstep(hard * 0.5, edge * 0.5 + hard * 0.5, d);
}
`,
  body: /* glsl */ `
  if (u_hslActive == 1) {
    vec3 c = clamp(encode(rgb), 0.0, 1.0);
    vec3 hsv = rgb2hsv(c);
    float wsum = 0.0;
    float dh = 0.0, ds = 0.0, dl = 0.0;
    for (int i = 0; i < 8; i++) {
      float w = bandWeight(hsv.x, i);
      wsum += w;
      dh += w * u_hslHue[i];
      ds += w * u_hslSat[i];
      dl += w * u_hslLum[i];
    }
    if (wsum > 1.0) { dh /= wsum; ds /= wsum; dl /= wsum; }
    float s0 = hsv.y;
    float l0 = luma(rgb);
    // Matiz: gira em HSV e devolve a luminância original.
    hsv.x = fract(hsv.x + dh * (30.0 / 360.0));
    vec3 lin = decode(hsv2rgb(hsv));
    lin = setLuma(lin, luma(lin), l0);
    // Saturação: escala o croma em torno da luminância (cinzas não mudam).
    lin = vec3(l0) + (lin - vec3(l0)) * max(0.0, 1.0 + ds);
    // Luminância da faixa, proporcional à saturação original.
    rgb = lin * exp2(dl * 1.2 * s0);
  }
`,
};

export const colorGradingStage: StageGlsl = {
  decl: /* glsl */ `
uniform vec3 u_gradeShadows;
uniform vec3 u_gradeMidtones;
uniform vec3 u_gradeHighlights;
uniform vec3 u_gradeLum;
uniform float u_gradeBlending;
uniform float u_gradeBalance;
uniform int u_gradeActive;
`,
  body: /* glsl */ `
  if (u_gradeActive == 1) {
    vec3 c = encode(max(rgb, 0.0));
    float y = luma(c);
    float pivot = 0.5 - 0.3 * u_gradeBalance;
    float spread = 0.08 + 0.42 * u_gradeBlending;
    float wh = smoothstep(pivot - spread, pivot + spread, y);
    float ws = 1.0 - wh;
    float wm = clamp(1.0 - abs(y - pivot) / (spread + 0.25), 0.0, 1.0);
    ws *= 1.0 - 0.5 * wm;
    wh *= 1.0 - 0.5 * wm;
    vec3 tint = ws * u_gradeShadows + wm * u_gradeMidtones + wh * u_gradeHighlights;
    c += 0.3 * tint;
    c += 0.2 * vec3(ws * u_gradeLum.x + wm * u_gradeLum.y + wh * u_gradeLum.z);
    rgb = decode(c);
  }
`,
};

export const saturationStage: StageGlsl = {
  decl: /* glsl */ `
uniform float u_vibrance;
uniform float u_saturation;
`,
  body: /* glsl */ `
  if (u_vibrance != 0.0 || u_saturation != 0.0) {
    float l = luma(rgb);
    float mx = max(rgb.r, max(rgb.g, rgb.b));
    float mn = min(rgb.r, min(rgb.g, rgb.b));
    float sat = mx > 1e-6 ? (mx - mn) / mx : 0.0;
    float vib = u_vibrance > 0.0 ? u_vibrance * (1.0 - sat) : u_vibrance;
    float k = max(0.0, (1.0 + u_saturation) * (1.0 + vib));
    rgb = max(vec3(l) + (rgb - vec3(l)) * k, 0.0);
  }
`,
};

export const lutStage: StageGlsl = {
  decl: /* glsl */ `
uniform sampler3D u_lut;
uniform float u_lutMix;
uniform int u_lutSrgb;
uniform float u_lutSize;
uniform vec3 u_lutDomainMin;
uniform vec3 u_lutDomainMax;
uniform vec3 u_gamutLimits;

float compressDistance(float d, float lim) {
  float t = GAMUT_THRESHOLD;
  float p = GAMUT_POWER;
  if (d < t) return d;
  float s = (lim - t) / pow(pow((1.0 - t) / (lim - t), -p) - 1.0, 1.0 / p);
  float x = (d - t) / s;
  return t + s * x / pow(1.0 + pow(x, p), 1.0 / p);
}

vec3 gamutCompress(vec3 c) {
  float ach = max(c.r, max(c.g, c.b));
  if (ach <= 0.0) return c;
  vec3 d = (vec3(ach) - c) / ach;
  vec3 dc = vec3(compressDistance(d.r, u_gamutLimits.r), compressDistance(d.g, u_gamutLimits.g), compressDistance(d.b, u_gamutLimits.b));
  return vec3(ach) - dc * ach;
}

vec3 sampleLut(vec3 c) {
  vec3 t = clamp((c - u_lutDomainMin) / (u_lutDomainMax - u_lutDomainMin), 0.0, 1.0);
  t = t * ((u_lutSize - 1.0) / u_lutSize) + 0.5 / u_lutSize;
  return texture(u_lut, t).rgb;
}
`,
  body: /* glsl */ `
  if (u_lutMix > 0.0) {
    vec3 outRgb;
    if (u_lutSrgb == 1) {
      vec3 s = gamutCompress(P3_TO_SRGB * rgb);
      vec3 e = encode(clamp(s, 0.0, 1.0));
      outRgb = SRGB_TO_P3 * decode(sampleLut(e));
    } else {
      outRgb = decode(sampleLut(encode(clamp(rgb, 0.0, 1.0))));
    }
    rgb = mix(rgb, outRgb, u_lutMix);
  }
`,
};

export const effectsStage: StageGlsl = {
  decl: /* glsl */ `
uniform float u_fade;
uniform float u_grain;
uniform float u_grainSize;
uniform float u_vignette;

float valueNoise(vec2 p, uint seed) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash1(i, seed);
  float b = hash1(i + vec2(1.0, 0.0), seed);
  float c = hash1(i + vec2(0.0, 1.0), seed);
  float d = hash1(i + vec2(1.0, 1.0), seed);
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
`,
  body: /* glsl */ `
  if (u_fade != 0.0 || u_grain != 0.0) {
    vec3 c = encode(max(rgb, 0.0));
    if (u_fade != 0.0) c = c + u_fade * 0.15 * (1.0 - c);
    if (u_grain != 0.0) {
      // Grão em coordenadas da imagem: mesmo padrão em qualquer resolução.
      vec2 cell = uv * vec2(1.0, u_outSize.y / u_outSize.x) / u_grainSize;
      float n = valueNoise(cell, 1u) * 0.7 + valueNoise(cell * 2.1 + 17.0, 2u) * 0.3 - 0.5;
      // Quando o pixel cobre vários grãos, a média reduz a amplitude.
      float cellsPerPixel = 1.0 / (u_outSize.x * u_grainSize);
      float atten = min(1.0, 1.0 / max(cellsPerPixel, 1e-6));
      float y = luma(c);
      float mid = 0.4 + 0.6 * clamp(1.0 - pow(2.0 * y - 1.0, 2.0), 0.0, 1.0);
      c += vec3(n * u_grain * 0.28 * atten * mid);
    }
    rgb = decode(c);
  }
  if (u_vignette != 0.0) {
    float aspect = u_outSize.x / u_outSize.y;
    vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
    float r = length(d) / length(vec2(aspect, 1.0) * 0.5);
    rgb *= exp2(u_vignette * 1.6 * smoothstep(0.3, 1.0, r));
  }
`,
};

export const sharpenStage: StageGlsl = {
  decl: /* glsl */ `
uniform float u_sharpen;
uniform float u_sharpenRadius;
`,
  body: /* glsl */ `
  if (u_sharpen > 0.0) {
    float r = u_sharpenRadius;
    vec2 s = u_bSize;
    float b = 0.0;
    b += texture(u_b, regionCoord(px + vec2(-r, 0.0), u_bOrigin, s)).a;
    b += texture(u_b, regionCoord(px + vec2(r, 0.0), u_bOrigin, s)).a;
    b += texture(u_b, regionCoord(px + vec2(0.0, -r), u_bOrigin, s)).a;
    b += texture(u_b, regionCoord(px + vec2(0.0, r), u_bOrigin, s)).a;
    b *= 0.25;
    float y = bSample.a;
    float detail = y - b;
    // Limiar suave: não amplifica ruído muito fino.
    detail *= smoothstep(0.002, 0.01, abs(detail));
    float l0 = luma(rgb);
    float y1 = y + u_sharpen * 0.8 * detail;
    rgb = setLuma(rgb, l0, decode1(y1) * (l0 / max(decode1(y), 1e-6)));
  }
`,
};

export const encodeStage: StageGlsl = {
  decl: /* glsl */ `
// 1 = saída em Display P3; 0 = sRGB (tela sem suporte a P3).
uniform int u_outP3;
`,
  body: /* glsl */ `
  {
    vec3 o = u_outP3 == 1 ? rgb : P3_TO_SRGB * rgb;
    o = encode(clamp(o, 0.0, 1.0));
    // Dithering triangular de 1 LSB, posicionado no pixel global.
    vec2 gp = floor(px);
    float d = hash1(gp, 7u) + hash1(gp, 11u) - 1.0;
    rgb = clamp(o + d / 255.0, 0.0, 1.0);
  }
`,
};
