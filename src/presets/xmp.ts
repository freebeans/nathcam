/**
 * Importação de presets `.xmp` do Lightroom / Camera Raw.
 *
 * Os sliders são mapeados para os controles equivalentes. As fórmulas da
 * Adobe não são públicas: o resultado é uma aproximação (ver PRD).
 * Perfil de câmera, correções de lente, máscaras e recorte são ignorados.
 */
import { HSL_BANDS, NUMERIC_PARAM_BY_PATH, clampParam, setPath, type CurvePoint, type PartialParams } from '../engine/params';

export interface XmpPreset {
  name: string;
  /** Grupo do Lightroom, se houver (vira o pack). */
  group?: string;
  params: PartialParams;
  /** O que o arquivo tinha e não foi aplicado, para avisar a usuária. */
  ignored: string[];
}

/** Slider do Lightroom -> caminho no nosso modelo (mesma escala). */
const DIRECT: Record<string, string> = {
  Exposure2012: 'exposure',
  Contrast2012: 'contrast',
  Highlights2012: 'highlights',
  Shadows2012: 'shadows',
  Whites2012: 'whites',
  Blacks2012: 'blacks',
  IncrementalTemperature: 'temperature',
  IncrementalTint: 'tint',
  Texture: 'texture',
  Clarity2012: 'clarity',
  Vibrance: 'vibrance',
  Saturation: 'saturation',
  GrainAmount: 'grain',
  GrainSize: 'grainSize',
  PostCropVignetteAmount: 'vignette',
  Sharpness: 'sharpening',
  RedHue: 'calibration.red.hue',
  RedSaturation: 'calibration.red.sat',
  GreenHue: 'calibration.green.hue',
  GreenSaturation: 'calibration.green.sat',
  BlueHue: 'calibration.blue.hue',
  BlueSaturation: 'calibration.blue.sat',
  ShadowTint: 'calibration.shadowsTint',
  SplitToningBalance: 'colorGrading.balance',
};

const LR_BAND = (b: string) => b[0].toUpperCase() + b.slice(1);

const ZONES: [lr: string, ours: string][] = [
  ['Shadow', 'shadows'],
  ['Midtone', 'midtones'],
  ['Highlight', 'highlights'],
];

const CURVES: [lr: string, ours: string][] = [
  ['ToneCurvePV2012', 'luma'],
  ['ToneCurvePV2012Red', 'red'],
  ['ToneCurvePV2012Green', 'green'],
  ['ToneCurvePV2012Blue', 'blue'],
];

/** Luz do dia: referência para converter temperatura absoluta (Kelvin) em relativa. */
const DAYLIGHT_K = 5500;

function readValues(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(/crs:(\w+)\s*=\s*"([^"]*)"/g)) out.set(m[1], m[2]);
  for (const m of text.matchAll(/<crs:(\w+)>([^<]*)<\/crs:\1>/g)) if (m[2].trim()) out.set(m[1], m[2].trim());
  return out;
}

/** Texto de um campo simples ou rdf:Alt (Name, Group). */
function readText(text: string, tag: string, values: Map<string, string>): string | undefined {
  const alt = text.match(new RegExp(`<crs:${tag}>[\\s\\S]*?<rdf:li[^>]*>([^<]*)</rdf:li>`));
  const v = (alt?.[1] ?? values.get(tag))?.trim();
  return v || undefined;
}

function readCurve(text: string, tag: string): CurvePoint[] | undefined {
  const m = text.match(new RegExp(`<crs:${tag}>([\\s\\S]*?)</crs:${tag}>`));
  if (!m) return undefined;
  const pts = [...m[1].matchAll(/<rdf:li>\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*<\/rdf:li>/g)].map(
    ([, x, y]) => [Number(x) / 255, Number(y) / 255] as const,
  );
  if (pts.length < 2 || pts.every(([x, y]) => Math.abs(x - y) < 1e-6)) return undefined;
  return pts;
}

export function parseXmp(text: string, fileName: string): XmpPreset {
  if (!/crs:/.test(text)) throw new Error(`${fileName}: não parece um preset do Lightroom/Camera Raw.`);
  const v = readValues(text);
  const num = (k: string): number | undefined => {
    const s = v.get(k);
    if (s === undefined) return undefined;
    const n = Number(s.replace(/^\+/, ''));
    return Number.isFinite(n) ? n : undefined;
  };
  const params: Record<string, unknown> = {};
  const put = (path: string, value: number | undefined) => {
    if (value === undefined || value === 0) return;
    const spec = NUMERIC_PARAM_BY_PATH.get(path);
    setPath(params, path, spec ? clampParam(spec, value) : value);
  };

  for (const [lr, ours] of Object.entries(DIRECT)) put(ours, num(lr));

  // Temperatura e tonalidade absolutas (presets de RAW): aproximação em mireds.
  if (num('IncrementalTemperature') === undefined && num('Temperature') !== undefined) {
    const k = num('Temperature')!;
    put('temperature', (1e6 / DAYLIGHT_K - 1e6 / k) / 1.5);
  }
  if (num('IncrementalTint') === undefined && num('Tint') !== undefined) put('tint', num('Tint')! / 1.5);

  for (const b of HSL_BANDS) {
    const B = LR_BAND(b);
    put(`hsl.${b}.hue`, num(`HueAdjustment${B}`));
    put(`hsl.${b}.sat`, num(`SaturationAdjustment${B}`));
    put(`hsl.${b}.lum`, num(`LuminanceAdjustment${B}`));
  }

  // Color grading (Lightroom 10+) com recuo para o split toning antigo.
  for (const [lr, ours] of ZONES) {
    const sat = num(`ColorGrade${lr}Sat`) ?? (lr !== 'Midtone' ? num(`SplitToning${lr}Saturation`) : undefined);
    const hue = num(`ColorGrade${lr}Hue`) ?? (lr !== 'Midtone' ? num(`SplitToning${lr}Hue`) : undefined);
    if (sat) {
      setPath(params, `colorGrading.${ours}.hue`, clampParam(NUMERIC_PARAM_BY_PATH.get(`colorGrading.${ours}.hue`)!, hue ?? 0));
      put(`colorGrading.${ours}.sat`, sat);
    }
    put(`colorGrading.${ours}.lum`, num(`ColorGrade${lr}Lum`));
  }
  const blending = num('ColorGradeBlending');
  if (blending !== undefined && blending !== 50) put('colorGrading.blending', blending);

  for (const [lr, ours] of CURVES) {
    const c = readCurve(text, lr);
    if (c) setPath(params, `curves.${ours}`, c);
  }

  const ignored: string[] = [];
  const nonzero = (...keys: string[]) => keys.some((k) => (num(k) ?? 0) !== 0);
  if (v.has('CameraProfile') || v.has('Look')) ignored.push('perfil de câmera');
  if (v.get('LensProfileEnable') === '1' || nonzero('LensManualDistortionAmount', 'VignetteAmount')) ignored.push('correção de lente');
  if (/^true$/i.test(v.get('HasCrop') ?? '')) ignored.push('recorte');
  if (/<crs:(MaskGroupBasedCorrections|GradientBasedCorrections|CircularGradientBasedCorrections|PaintBasedCorrections)\b/.test(text))
    ignored.push('máscaras');
  if (nonzero('Dehaze')) ignored.push('desembaçar');
  if (nonzero('ParametricShadows', 'ParametricDarks', 'ParametricLights', 'ParametricHighlights')) ignored.push('curva paramétrica');
  if (nonzero('ColorGradeGlobalSat', 'ColorGradeGlobalLum')) ignored.push('color grading global');

  return {
    name: readText(text, 'Name', v) ?? fileName.replace(/\.xmp$/i, ''),
    group: readText(text, 'Group', v),
    params: params as PartialParams,
    ignored,
  };
}
