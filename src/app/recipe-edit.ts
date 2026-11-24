/** Operações de edição sobre a receita (imutáveis). */
import { getPath, type NumericParamSpec, type PartialParams } from '../engine/params';
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
