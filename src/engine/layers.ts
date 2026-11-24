import {
  CURVE_CHANNELS,
  GRADING_ZONES,
  NUMERIC_PARAMS,
  clampParam,
  defaultHslBands,
  getPath,
  neutralParams,
  setPath,
  type Curve,
  type CurveChannel,
  type HslBand,
  type HslBandShape,
  type Params,
  type PartialParams,
} from './params';
import type { LutColorSpace, Recipe } from './recipe';

export interface EffectiveLut {
  src: string;
  colorSpace: LutColorSpace;
  /** Mistura da saída da LUT com a entrada dela (= intensidade). */
  mix: number;
}

/** Resultado da resolução das camadas: o que o motor de fato aplica. */
export interface Effective {
  /** Curvas em `params.curves` são ignoradas: use `curveLayers`. */
  params: Params;
  /** Curvas aplicadas em sequência, por canal (preset escalado, depois usuário). */
  curveLayers: Record<CurveChannel, Curve[]>;
  lut: EffectiveLut | null;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function isIdentity(curve: Curve): boolean {
  return curve.every(([x, y]) => Math.abs(x - y) < 1e-6);
}

/** Aproxima uma curva da identidade: k = 0 vira identidade, k = 1 mantém a curva. */
export function scaleCurve(curve: Curve, k: number): Curve {
  return curve.map(([x, y]) => [x, x + (y - x) * k] as const);
}

function toVec(hue: number, sat: number): [number, number] {
  const a = (hue * Math.PI) / 180;
  return [Math.cos(a) * sat, Math.sin(a) * sat];
}

function fromVec([x, y]: [number, number], fallbackHue: number): { hue: number; sat: number } {
  const sat = Math.hypot(x, y);
  if (sat < 1e-9) return { hue: fallbackHue, sat: 0 };
  const hue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return { hue, sat };
}

/**
 * Resolve as duas camadas de uma receita (preset escalado pela intensidade +
 * ajustes do usuário) num único conjunto de parâmetros efetivos.
 */
export function resolveEffective(recipe: Recipe): Effective {
  const k = Math.min(1, Math.max(0, recipe.intensity));
  const presetParams: PartialParams = recipe.preset?.params ?? {};
  const user = recipe.user;
  const out = neutralParams() as unknown as Record<string, unknown>;

  for (const s of NUMERIC_PARAMS) {
    if (s.kind === 'hue') continue;
    const p = num(getPath(presetParams, s.path));
    const u = num(getPath(user, s.path));
    if (p === undefined && u === undefined) continue;
    const v = s.neutral + ((p ?? s.neutral) - s.neutral) * k + (u ?? 0);
    setPath(out, s.path, clampParam(s, v));
  }

  // Color grading: matiz e saturação formam um vetor no plano de cor.
  for (const z of GRADING_ZONES) {
    const ph = num(getPath(presetParams, `colorGrading.${z}.hue`)) ?? 0;
    const ps = num(getPath(presetParams, `colorGrading.${z}.sat`)) ?? 0;
    const uh = num(getPath(user, `colorGrading.${z}.hue`)) ?? ph;
    const us = num(getPath(user, `colorGrading.${z}.sat`)) ?? 0;
    const a = toVec(ph, ps * k);
    const b = toVec(uh, us);
    const { hue, sat } = fromVec([a[0] + b[0], a[1] + b[1]], us > 0 ? uh : ph);
    setPath(out, `colorGrading.${z}.hue`, hue);
    setPath(out, `colorGrading.${z}.sat`, Math.min(100, sat));
  }

  const curveLayers = {} as Record<CurveChannel, Curve[]>;
  for (const ch of CURVE_CHANNELS) {
    const layers: Curve[] = [];
    const pc = presetParams.curves?.[ch];
    const uc = user.curves?.[ch];
    if (pc && pc.length >= 2 && k > 0 && !isIdentity(pc)) layers.push(scaleCurve(pc, k));
    if (uc && uc.length >= 2 && !isIdentity(uc)) layers.push(uc);
    curveLayers[ch] = layers;
  }

  const bandsP = presetParams.hslBands;
  const bandsU = user.hslBands;
  if (bandsP || bandsU) {
    const bands = defaultHslBands();
    for (const src of [bandsP, bandsU]) {
      if (!src) continue;
      for (const [b, shape] of Object.entries(src) as [HslBand, Partial<HslBandShape>][]) {
        bands[b] = { ...bands[b], ...shape };
      }
    }
    out.hslBands = bands;
  }

  const lut = recipe.preset?.lut;
  return {
    params: out as unknown as Params,
    curveLayers,
    lut: lut ? { src: lut.src, colorSpace: lut.colorSpace, mix: k } : null,
  };
}
