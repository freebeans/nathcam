/**
 * Copiar e colar ajustes escolhendo grupos (ver PRD, "Copiar e colar
 * ajustes"). Cada grupo substitui por inteiro a parte correspondente da
 * receita de destino: um grupo sem ajustes na origem zera esse grupo.
 */
import { aspectCrop, cropFits, straightenCrop } from '../engine/crop';
import type { PartialParams } from '../engine/params';
import type { Recipe } from '../engine/recipe';
import { unflattenRecipe } from './recipe-edit';

export type PasteGroupId = 'preset' | 'light' | 'color' | 'curves' | 'hsl' | 'grading' | 'effects' | 'detail' | 'crop';

export interface PasteGroup {
  id: PasteGroupId;
  label: string;
  /** Chaves da camada do usuário que o grupo leva. */
  keys: (keyof PartialParams)[];
}

export const PASTE_GROUPS: readonly PasteGroup[] = [
  { id: 'preset', label: 'Preset e intensidade', keys: [] },
  { id: 'light', label: 'Luz', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
  { id: 'color', label: 'Cor', keys: ['temperature', 'tint', 'saturation', 'vibrance', 'calibration'] },
  { id: 'curves', label: 'Curvas', keys: ['curves'] },
  { id: 'hsl', label: 'HSL', keys: ['hsl', 'hslBands'] },
  { id: 'grading', label: 'Color grading', keys: ['colorGrading'] },
  { id: 'effects', label: 'Efeitos', keys: ['fade', 'grain', 'grainSize', 'vignette'] },
  { id: 'detail', label: 'Detalhe', keys: ['sharpening', 'texture', 'clarity'] },
  { id: 'crop', label: 'Recorte', keys: [] },
];

/** Tudo marcado, menos o recorte (cada foto tem o seu enquadramento). */
export const DEFAULT_GROUPS: ReadonlySet<PasteGroupId> = new Set(PASTE_GROUPS.filter((g) => g.id !== 'crop').map((g) => g.id));

/**
 * Cola em `target` os grupos escolhidos de `source`. `size` é o tamanho da
 * foto de destino, para que um recorte colado caiba nela.
 */
export function pasteRecipe(
  target: Recipe,
  source: Recipe,
  groups: ReadonlySet<PasteGroupId>,
  size: { w: number; h: number },
): Recipe {
  // Receita achatada: tudo mora no "preset"; desfaz isso para cada grupo levar só o seu.
  const src = structuredClone(unflattenRecipe(source));
  // O destino também: colar luz numa foto achatada deve dar a luz da origem.
  const base = unflattenRecipe(target);
  const out: Recipe = { ...base, user: { ...base.user } };
  const user = out.user as Record<string, unknown>;
  const from = src.user as Record<string, unknown>;

  for (const g of PASTE_GROUPS) {
    if (!groups.has(g.id)) continue;
    for (const k of g.keys) {
      if (from[k] === undefined) delete user[k];
      else user[k] = from[k];
    }
  }
  if (groups.has('preset')) {
    out.preset = src.preset;
    out.intensity = src.intensity;
    out.flattened = src.flattened;
  }
  if (groups.has('crop')) {
    let crop = src.crop;
    // Proporção travada vale em pixels: refaz o maior recorte com ela nesta foto.
    if (crop?.aspect) crop = aspectCrop(size.w, size.h, crop, crop.aspect);
    else if (crop && !cropFits(size.w, size.h, crop)) crop = straightenCrop(size.w, size.h, crop, crop.angle);
    out.crop = crop;
  }
  return out;
}
