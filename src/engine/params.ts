/**
 * Parâmetros de ajuste do motor.
 *
 * Todos os controles numéricos têm um valor neutro (que não altera a imagem)
 * e uma faixa. As curvas e as faixas HSL destravadas são estruturas à parte.
 */

export const HSL_BANDS = ['red', 'orange', 'yellow', 'green', 'aqua', 'blue', 'purple', 'magenta'] as const;
export type HslBand = (typeof HSL_BANDS)[number];

/** Centros (graus) das 8 faixas fixas compatíveis com o Lightroom. */
export const HSL_BAND_CENTERS: Record<HslBand, number> = {
  red: 0,
  orange: 30,
  yellow: 60,
  green: 120,
  aqua: 180,
  blue: 240,
  purple: 270,
  magenta: 300,
};

export const GRADING_ZONES = ['shadows', 'midtones', 'highlights'] as const;
export type GradingZone = (typeof GRADING_ZONES)[number];

export const PRIMARIES = ['red', 'green', 'blue'] as const;
export type Primary = (typeof PRIMARIES)[number];

export const CURVE_CHANNELS = ['luma', 'red', 'green', 'blue'] as const;
export type CurveChannel = (typeof CURVE_CHANNELS)[number];

/** Ponto de curva, [entrada, saída], ambos em 0..1 (espaço perceptual). */
export type CurvePoint = readonly [number, number];
export type Curve = readonly CurvePoint[];

/** Definição de uma faixa HSL destravada: centro, largura e suavidade (graus). */
export interface HslBandShape {
  center: number;
  width: number;
  softness: number;
}

export interface HslAdjust {
  hue: number;
  sat: number;
  lum: number;
}

export interface GradingAdjust {
  hue: number;
  sat: number;
  lum: number;
}

export interface CalibrationPrimary {
  hue: number;
  sat: number;
}

export interface Params {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  temperature: number;
  tint: number;
  saturation: number;
  vibrance: number;
  fade: number;
  grain: number;
  grainSize: number;
  vignette: number;
  texture: number;
  clarity: number;
  sharpening: number;
  hsl: Record<HslBand, HslAdjust>;
  colorGrading: Record<GradingZone, GradingAdjust> & { blending: number; balance: number };
  calibration: Record<Primary, CalibrationPrimary> & { shadowsTint: number };
  curves: Record<CurveChannel, Curve>;
  /** Faixas HSL destravadas; ausente = 8 faixas fixas (compatível com XMP). */
  hslBands?: Record<HslBand, HslBandShape>;
}

/** Objeto parcial aninhado, como aparece nos arquivos de preset. */
export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};
export type PartialParams = DeepPartial<Params>;

export interface NumericParamSpec {
  /** Caminho com pontos, ex.: "hsl.blue.sat". */
  path: string;
  min: number;
  max: number;
  neutral: number;
  step: number;
  /** Matizes são ângulos: não escalam em direção ao neutro. */
  kind?: 'hue';
}

function spec(path: string, min: number, max: number, neutral = 0, step = 1, kind?: 'hue'): NumericParamSpec {
  return { path, min, max, neutral, step, kind };
}

export const NUMERIC_PARAMS: readonly NumericParamSpec[] = [
  spec('exposure', -5, 5, 0, 0.01),
  spec('contrast', -100, 100),
  spec('highlights', -100, 100),
  spec('shadows', -100, 100),
  spec('whites', -100, 100),
  spec('blacks', -100, 100),
  spec('temperature', -100, 100),
  spec('tint', -100, 100),
  spec('saturation', -100, 100),
  spec('vibrance', -100, 100),
  spec('fade', 0, 100),
  spec('grain', 0, 100),
  spec('grainSize', 0, 100, 25),
  spec('vignette', -100, 100),
  spec('texture', -100, 100),
  spec('clarity', -100, 100),
  spec('sharpening', 0, 150),
  ...HSL_BANDS.flatMap((b) => [
    spec(`hsl.${b}.hue`, -100, 100),
    spec(`hsl.${b}.sat`, -100, 100),
    spec(`hsl.${b}.lum`, -100, 100),
  ]),
  ...GRADING_ZONES.flatMap((z) => [
    spec(`colorGrading.${z}.hue`, 0, 360, 0, 1, 'hue'),
    spec(`colorGrading.${z}.sat`, 0, 100),
    spec(`colorGrading.${z}.lum`, -100, 100),
  ]),
  spec('colorGrading.blending', 0, 100, 50),
  spec('colorGrading.balance', -100, 100),
  ...PRIMARIES.flatMap((p) => [spec(`calibration.${p}.hue`, -100, 100), spec(`calibration.${p}.sat`, -100, 100)]),
  spec('calibration.shadowsTint', -100, 100),
];

export const NUMERIC_PARAM_BY_PATH: ReadonlyMap<string, NumericParamSpec> = new Map(
  NUMERIC_PARAMS.map((s) => [s.path, s]),
);

export const IDENTITY_CURVE: Curve = [
  [0, 0],
  [1, 1],
];

export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let cur = obj;
  for (const key of keys.slice(0, -1)) {
    if (cur[key] === undefined || cur[key] === null || typeof cur[key] !== 'object') cur[key] = {};
    cur = cur[key] as Record<string, unknown>;
  }
  cur[keys[keys.length - 1]] = value;
}

/** Parâmetros neutros: aplicados, deixam a imagem como está. */
export function neutralParams(): Params {
  const out: Record<string, unknown> = {};
  for (const s of NUMERIC_PARAMS) setPath(out, s.path, s.neutral);
  out.curves = { luma: IDENTITY_CURVE, red: IDENTITY_CURVE, green: IDENTITY_CURVE, blue: IDENTITY_CURVE };
  return out as unknown as Params;
}

export function clampParam(s: NumericParamSpec, v: number): number {
  if (s.kind === 'hue') return ((v % 360) + 360) % 360;
  return Math.min(s.max, Math.max(s.min, v));
}

export function defaultHslBands(): Record<HslBand, HslBandShape> {
  const out = {} as Record<HslBand, HslBandShape>;
  HSL_BANDS.forEach((b, i) => {
    const c = HSL_BAND_CENTERS[b];
    const prev = HSL_BAND_CENTERS[HSL_BANDS[(i + 7) % 8]];
    const next = HSL_BAND_CENTERS[HSL_BANDS[(i + 1) % 8]];
    const dPrev = (c - prev + 360) % 360;
    const dNext = (next - c + 360) % 360;
    out[b] = { center: c, width: (dPrev + dNext) / 2, softness: 1 };
  });
  return out;
}
