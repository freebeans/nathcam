/** Operações de edição sobre a receita (imutáveis). */
import { composeCurves } from '../engine/curves';
import { resolveEffective } from '../engine/layers';
import {
  CURVE_CHANNELS,
  NUMERIC_PARAMS,
  NUMERIC_PARAM_BY_PATH,
  getPath,
  setPath,
  type NumericParamSpec,
  type PartialParams,
} from '../engine/params';
import type { PresetRecipe, Recipe } from '../engine/recipe';
import { ENGINE_VERSION } from '../engine/version';

export function emptyRecipe(): Recipe {
  return { engineVersion: ENGINE_VERSION, preset: null, intensity: 1, user: {} };
}

/** Troca o preset; ajustes do usuário e recorte ficam. Guarda uma cópia da receita. */
export function applyPreset(r: Recipe, preset: PresetRecipe | null): Recipe {
  return { ...r, preset: preset ? structuredClone(preset) : null, intensity: 1 };
}

function withoutPath(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const [k, ...rest] = keys;
  const out = { ...obj };
  if (rest.length === 0) {
    delete out[k];
    return out;
  }
  const child = out[k];
  if (child && typeof child === 'object') {
    const next = withoutPath(child as Record<string, unknown>, rest);
    if (Object.keys(next).length === 0) delete out[k];
    else out[k] = next;
  }
  return out;
}

function withPath(obj: Record<string, unknown>, keys: string[], value: unknown): Record<string, unknown> {
  const [k, ...rest] = keys;
  if (rest.length === 0) return { ...obj, [k]: value };
  const child = obj[k];
  return { ...obj, [k]: withPath(child && typeof child === 'object' ? (child as Record<string, unknown>) : {}, rest, value) };
}

/** Grava um deslocamento na camada do usuário; zero remove a chave. */
export function setUserParam(r: Recipe, path: string, value: number): Recipe {
  const keys = path.split('.');
  const user = (value === 0 ? withoutPath(r.user, keys) : withPath(r.user, keys, value)) as PartialParams;
  return { ...r, user };
}

export function userValue(r: Recipe, path: string): number {
  const v = getPath(r.user, path);
  return typeof v === 'number' ? v : 0;
}

/** Faixa do slider da camada do usuário (deslocamento relativo ao preset). */
export function userDeltaRange(s: NumericParamSpec): [number, number] {
  const m = Math.max(Math.abs(s.min - s.neutral), Math.abs(s.max - s.neutral));
  return [-m, m];
}

/** Tamanho que cabe em (boxW, boxH), mantém a proporção e não amplia a fonte. */
export function fitSize(srcW: number, srcH: number, boxW: number, boxH: number, maxSide: number): { w: number; h: number } {
  const k = Math.min(1, boxW / srcW, boxH / srcH, maxSide / Math.max(srcW, srcH));
  return { w: Math.max(1, Math.round(srcW * k)), h: Math.max(1, Math.round(srcH * k)) };
}

/**
 * Achatar: funde preset (já escalado pela intensidade) e ajustes do usuário
 * numa receita de preset só. O resultado renderiza igual; a LUT guarda a
 * mistura de antes em `amount`.
 */
export function flattenRecipe(r: Recipe): Recipe {
  if (!r.preset && Object.keys(r.user).length === 0) return { ...r, flattened: true };
  const eff = resolveEffective(r);
  const params: Record<string, unknown> = {};
  for (const s of NUMERIC_PARAMS) {
    const v = getPath(eff.params, s.path) as number;
    if (s.kind === 'hue') {
      const sat = getPath(eff.params, s.path.replace(/hue$/, 'sat')) as number;
      if (sat) setPath(params, s.path, v);
    } else if (v !== s.neutral) setPath(params, s.path, v);
  }
  for (const ch of CURVE_CHANNELS) if (eff.curveLayers[ch].length) setPath(params, `curves.${ch}`, composeCurves(eff.curveLayers[ch]));
  if (eff.params.hslBands) params.hslBands = eff.params.hslBands;
  const lut = r.preset?.lut && eff.lut ? { ...r.preset.lut, amount: eff.lut.mix } : null;
  const preset: PresetRecipe = {
    id: r.preset?.id ?? 'achatado',
    name: r.preset?.name ?? 'Achatado',
    pack: r.preset?.pack ?? 'meus',
    params: params as PartialParams,
    lut,
    engineVersion: ENGINE_VERSION,
  };
  return { ...r, preset, intensity: 1, user: {}, flattened: true };
}

/** Quem o slider edita: a camada do usuário (normal ou achatada) ou a receita do preset. */
export type SliderTarget = 'layer' | 'preset';

export interface SliderModel {
  value: number;
  min: number;
  max: number;
  neutral: number;
  step: number;
  apply(r: Recipe, v: number): Recipe;
}

/** O que um slider mostra e como uma mudança volta para a receita. */
export function sliderModel(r: Recipe, path: string, target: SliderTarget): SliderModel {
  const spec = NUMERIC_PARAM_BY_PATH.get(path);
  if (!spec) throw new Error(`Parâmetro desconhecido: ${path}`);
  const pv = getPath(r.preset?.params, path);
  const presetValue = typeof pv === 'number' ? pv : spec.neutral;
  const user = userValue(r, path);
  const abs = { min: spec.min, max: spec.max, neutral: spec.neutral, step: spec.step };

  if (target === 'preset') {
    return {
      ...abs,
      value: presetValue,
      apply: (rr, v) => {
        const p = rr.preset;
        if (!p) return rr;
        const keys = path.split('.');
        const params = (v === spec.neutral ? withoutPath(p.params, keys) : withPath(p.params, keys, v)) as PartialParams;
        return { ...rr, preset: { ...p, params } };
      },
    };
  }
  if (spec.kind === 'hue') {
    // Matiz é direção, não intensidade: absoluta; a do usuário prevalece.
    const uv = getPath(r.user, path);
    return { ...abs, value: typeof uv === 'number' ? uv : presetValue, apply: (rr, v) => setUserParam(rr, path, v) };
  }
  if (r.flattened) {
    return { ...abs, value: presetValue + user, apply: (rr, v) => setUserParam(rr, path, v - presetValue) };
  }
  const [min, max] = userDeltaRange(spec);
  return { value: user, min, max, neutral: 0, step: spec.step, apply: (rr, v) => setUserParam(rr, path, v) };
}
