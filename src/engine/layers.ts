import {
  CURVE_CHANNELS,
  GRADING_ZONES,
  NUMERIC_PARAMS,
  NUMERIC_PARAM_BY_PATH,
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

  // Color grading: a matiz é uma direção (não escala com a intensidade); se o
  // usuário escolheu uma, ela vale. As saturações somam.
  for (const z of GRADING_ZONES) {
    const ph = num(getPath(presetParams, `colorGrading.${z}.hue`));
    const ps = num(getPath(presetParams, `colorGrading.${z}.sat`)) ?? 0;
    const uh = num(getPath(user, `colorGrading.${z}.hue`));
    const us = num(getPath(user, `colorGrading.${z}.sat`)) ?? 0;
    const hue = clampParam(NUMERIC_PARAM_BY_PATH.get(`colorGrading.${z}.hue`)!, uh ?? ph ?? 0);
    setPath(out, `colorGrading.${z}.hue`, hue);
    setPath(out, `colorGrading.${z}.sat`, Math.min(100, Math.max(0, ps * k + us)));
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
    lut: lut ? { src: lut.src, colorSpace: lut.colorSpace, mix: k * (lut.amount ?? 1) } : null,
  };
}
