/**
 * ORDEM DO PIPELINE — fonte única da verdade (ver PRD, "Motor de renderização").
 *
 * Para adicionar uma etapa: escreva o GLSL em `shaders/stages.ts`, insira-a
 * aqui na posição certa e documente a posição no PRD.
 *
 * As etapas são distribuídas em três passes de GPU, porque operações de
 * vizinhança precisam ler o resultado completo das etapas anteriores:
 *   A: etapas por pixel até o tom (a saída alimenta o desfoque de textura/clareza)
 *   B: textura/clareza até efeitos (a saída alimenta a nitidez)
 *   C: nitidez e codificação final
 */
import { COMMON_GLSL } from './shaders/common';
import * as S from './shaders/stages';

export type PassId = 'A' | 'B' | 'C';

export interface Stage {
  id: string;
  pass: PassId;
  glsl: S.StageGlsl;
}

export const PIPELINE: readonly Stage[] = [
  { id: '1-decode', pass: 'A', glsl: S.decodeStage },
  { id: '2-calibration', pass: 'A', glsl: S.calibrationStage },
  { id: '3-white-balance', pass: 'A', glsl: S.whiteBalanceStage },
  { id: '4-tone', pass: 'A', glsl: S.toneStage },
  { id: '5-texture-clarity', pass: 'B', glsl: S.localContrastStage },
  { id: '6-curves', pass: 'B', glsl: S.curvesStage },
  { id: '7-hsl', pass: 'B', glsl: S.hslStage },
  { id: '8-color-grading', pass: 'B', glsl: S.colorGradingStage },
  { id: '9-vibrance-saturation', pass: 'B', glsl: S.saturationStage },
  { id: '10-lut', pass: 'B', glsl: S.lutStage },
  { id: '11-fade-grain-vignette', pass: 'B', glsl: S.effectsStage },
  { id: '12-sharpening', pass: 'C', glsl: S.sharpenStage },
  { id: '13-encode', pass: 'C', glsl: S.encodeStage },
];

const PASS_INPUT: Record<PassId, string> = {
  A: /* glsl */ `
  vec3 rgb = vec3(0.0);
`,
  B: /* glsl */ `
  vec4 aSample = texelFetch(u_a, ivec2(floor(px - u_aOrigin)), 0);
  vec3 rgb = u_lowp == 1 ? decode(aSample.rgb) : aSample.rgb;
`,
  C: /* glsl */ `
  vec4 bSample = texelFetch(u_b, ivec2(floor(px - u_bOrigin)), 0);
  vec3 rgb = u_lowp == 1 ? decode(bSample.rgb) : bSample.rgb;
`,
};

const PASS_DECL: Record<PassId, string> = {
  A: '',
  B: /* glsl */ `
uniform sampler2D u_a;
uniform vec2 u_aOrigin;
uniform vec2 u_aSize;
`,
  C: /* glsl */ `
uniform sampler2D u_b;
uniform vec2 u_bOrigin;
uniform vec2 u_bSize;
`,
};

const INTERMEDIATE_OUTPUT = /* glsl */ `
  float yOut = encode1(luma(rgb));
  if (u_lowp == 1) {
    // 8 bits: guarda valores codificados com dithering triangular de 1 LSB,
    // para que a quantização intermediária não crie faixas em degradês.
    vec2 gp = floor(px);
    float d = (hash1(gp, 3u) + hash1(gp, 5u) - 1.0) / 255.0;
    outColor = vec4(clamp(encode(rgb) + d, 0.0, 1.0), clamp(yOut + d, 0.0, 1.0));
  } else {
    outColor = vec4(rgb, yOut);
  }
`;

/** Monta o fragment shader de um pass a partir das etapas, na ordem do pipeline. */
export function fragmentShader(pass: PassId): string {
  const stages = PIPELINE.filter((s) => s.pass === pass);
  return `#version 300 es
${COMMON_GLSL}
${PASS_DECL[pass]}
${stages.map((s) => `// ---- etapa ${s.id}\n${s.glsl.decl}`).join('\n')}
out vec4 outColor;
void main() {
  vec2 px = globalPixel();
  vec2 uv = px / u_outSize;
${PASS_INPUT[pass]}
${stages.map((s) => `  // ---- etapa ${s.id}\n${s.glsl.body}`).join('\n')}
${pass === 'C' ? '  outColor = vec4(rgb, 1.0);' : INTERMEDIATE_OUTPUT}
}
`;
}
