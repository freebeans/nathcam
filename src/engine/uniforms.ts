import { P3_LUMA, gamutCompressLimits, mulMat3, type Mat3 } from './color';
import { bakeCurves } from './curves';
import type { Effective } from './layers';
import {
  CURVE_CHANNELS,
  GRADING_ZONES,
  HSL_BANDS,
  PRIMARIES,
  defaultHslBands,
  type CalibrationPrimary,
  type Params,
  type Primary,
} from './params';

/** Rotação máxima de matiz de um primário na calibração (graus, a ±100). */
const CALIB_MAX_HUE = 30;

/** Rotação de `v` em torno do eixo acromático (1,1,1) por `deg` graus. */
function rotateAroundGray(v: [number, number, number], deg: number): [number, number, number] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const k = 1 / Math.sqrt(3);
  const [x, y, z] = v;
  // Rodrigues com eixo unitário (k,k,k)
  const dot = k * (x + y + z);
  const cross: [number, number, number] = [k * (z - y), k * (x - z), k * (y - x)];
  return [
    x * c + cross[0] * s + k * dot * (1 - c),
    y * c + cross[1] * s + k * dot * (1 - c),
    z * c + cross[2] * s + k * dot * (1 - c),
  ];
}

/**
 * Calibração aproximada: gira a matiz e escala a saturação de cada primário,
 * e renormaliza para que o branco continue branco. Matriz em ordem de linhas.
 */
export function calibrationMatrix(cal: Record<Primary, CalibrationPrimary>): Mat3 {
  const cols = PRIMARIES.map((p, i) => {
    const e: [number, number, number] = [0, 0, 0];
    e[i] = 1;
    const y = P3_LUMA[i];
    const chroma: [number, number, number] = [e[0] - y, e[1] - y, e[2] - y];
    const rot = rotateAroundGray(chroma, (cal[p].hue / 100) * CALIB_MAX_HUE);
    const k = 1 + cal[p].sat / 100;
    return [y + rot[0] * k, y + rot[1] * k, y + rot[2] * k];
  });
  const m: Mat3 = [cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1], cols[0][2], cols[1][2], cols[2][2]];
  const w = [m[0] + m[1] + m[2], m[3] + m[4] + m[5], m[6] + m[7] + m[8]];
  return mulMat3([1 / w[0], 0, 0, 0, 1 / w[1], 0, 0, 0, 1 / w[2]], m);
}

/**
 * Ganhos RGB do balanço de branco relativo (-100..100), normalizados para
 * preservar a luminância.
 */
export function whiteBalanceGains(temperature: number, tint: number): [number, number, number] {
  if (temperature === 0 && tint === 0) return [1, 1, 1];
  const t = temperature / 100;
  const g = tint / 100;
  const raw: [number, number, number] = [Math.exp(0.35 * t), Math.exp(-0.3 * g), Math.exp(-0.35 * t)];
  const l = raw[0] * P3_LUMA[0] + raw[1] * P3_LUMA[1] + raw[2] * P3_LUMA[2];
  return [raw[0] / l, raw[1] / l, raw[2] / l];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)];
}

/** Direção de cor (sem luminância) de uma matiz do color grading, escalada pela saturação. */
function gradingTint(hue: number, sat: number): [number, number, number] {
  const c = hsvToRgb(hue, 1, 1);
  const l = c[0] * P3_LUMA[0] + c[1] * P3_LUMA[1] + c[2] * P3_LUMA[2];
  const k = sat / 100;
  return [(c[0] - l) * k, (c[1] - l) * k, (c[2] - l) * k];
}

export interface Uniforms {
  u_calib: Mat3;
  u_shadowsTint: number;
  u_wb: [number, number, number];
  u_exposure: number;
  u_contrast: number;
  u_highlights: number;
  u_shadows: number;
  u_whites: number;
  u_blacks: number;
  u_texture: number;
  u_clarity: number;
  u_curvesActive: number;
  u_hslHue: Float32Array;
  u_hslSat: Float32Array;
  u_hslLum: Float32Array;
  u_hslCenter: Float32Array;
  u_hslWidth: Float32Array;
  u_hslSoft: Float32Array;
  u_hslActive: number;
  u_gradeShadows: [number, number, number];
  u_gradeMidtones: [number, number, number];
  u_gradeHighlights: [number, number, number];
  u_gradeLum: [number, number, number];
  u_gradeBlending: number;
  u_gradeBalance: number;
  u_gradeActive: number;
  u_vibrance: number;
  u_saturation: number;
  u_lutMix: number;
  u_lutSrgb: number;
  u_gamutLimits: [number, number, number];
  u_fade: number;
  u_grain: number;
  /** Tamanho do grão como fração da largura da imagem. */
  u_grainSize: number;
  u_vignette: number;
  u_sharpen: number;
}

export interface UniformData {
  uniforms: Uniforms;
  /** Tabela RGBA 256x1 das curvas, se ativas. */
  curves: Float32Array | null;
}

const s100 = (v: number) => v / 100;

/** Traduz os parâmetros efetivos nos uniforms do shader. */
export function toUniforms(eff: Effective): Uniforms {
  return toUniformData(eff).uniforms;
}

export function toUniformData(eff: Effective): UniformData {
  const p: Params = eff.params;
  const bands = p.hslBands ?? defaultHslBands();
  const curvesActive = CURVE_CHANNELS.some((c) => eff.curveLayers[c].length > 0);
  const cg = p.colorGrading;
  const u: Uniforms = {
    u_calib: calibrationMatrix(p.calibration),
    u_shadowsTint: s100(p.calibration.shadowsTint),
    u_wb: whiteBalanceGains(p.temperature, p.tint),
    u_exposure: p.exposure,
    u_contrast: s100(p.contrast),
    u_highlights: s100(p.highlights),
    u_shadows: s100(p.shadows),
    u_whites: s100(p.whites),
    u_blacks: s100(p.blacks),
    u_texture: s100(p.texture),
    u_clarity: s100(p.clarity),
    u_curvesActive: curvesActive ? 1 : 0,
    u_hslHue: Float32Array.from(HSL_BANDS.map((b) => s100(p.hsl[b].hue))),
    u_hslSat: Float32Array.from(HSL_BANDS.map((b) => s100(p.hsl[b].sat))),
    u_hslLum: Float32Array.from(HSL_BANDS.map((b) => s100(p.hsl[b].lum))),
    u_hslCenter: Float32Array.from(HSL_BANDS.map((b) => (((bands[b].center % 360) + 360) % 360) / 360)),
    u_hslWidth: Float32Array.from(HSL_BANDS.map((b) => Math.max(1, bands[b].width) / 360)),
    u_hslSoft: Float32Array.from(HSL_BANDS.map((b) => Math.min(1, Math.max(0.05, bands[b].softness)))),
    u_hslActive: HSL_BANDS.some((b) => p.hsl[b].hue || p.hsl[b].sat || p.hsl[b].lum) ? 1 : 0,
    u_gradeShadows: gradingTint(cg.shadows.hue, cg.shadows.sat),
    u_gradeMidtones: gradingTint(cg.midtones.hue, cg.midtones.sat),
    u_gradeHighlights: gradingTint(cg.highlights.hue, cg.highlights.sat),
    u_gradeLum: [s100(cg.shadows.lum), s100(cg.midtones.lum), s100(cg.highlights.lum)],
    u_gradeBlending: s100(cg.blending),
    u_gradeBalance: s100(cg.balance),
    u_gradeActive: GRADING_ZONES.some((z) => cg[z].sat || cg[z].lum) ? 1 : 0,
    u_vibrance: s100(p.vibrance),
    u_saturation: s100(p.saturation),
    u_lutMix: eff.lut ? eff.lut.mix : 0,
    u_lutSrgb: eff.lut?.colorSpace === 'srgb' ? 1 : 0,
    u_gamutLimits: gamutCompressLimits(),
    u_fade: s100(p.fade),
    u_grain: s100(p.grain),
    // 0..100 -> 0,025%..0,15% da largura; padrão (25) ≈ 0,05%
    u_grainSize: (0.025 + (p.grainSize / 100) * 0.125) / 100,
    u_vignette: s100(p.vignette),
    u_sharpen: p.sharpening / 100,
  };
  return { uniforms: u, curves: curvesActive ? bakeCurves(eff.curveLayers) : null };
}
