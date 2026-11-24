import { describe, expect, it } from 'vitest';
import type { PresetRecipe, Recipe } from '../engine/recipe';
import { cropFits, fullCrop, straightenCrop } from '../engine/crop';
import { DEFAULT_GROUPS, PASTE_GROUPS, pasteRecipe } from './paste';
import { emptyRecipe } from './recipe-edit';

const preset: PresetRecipe = { id: 'c1', name: 'C1', pack: 'cssco', params: {}, lut: null, engineVersion: 1 };

const source: Recipe = {
  ...emptyRecipe(),
  preset,
  intensity: 0.6,
  user: {
    exposure: 0.5,
    contrast: 10,
    temperature: 20,
    saturation: -10,
    calibration: { red: { hue: 5 } },
    curves: { luma: [[0, 0.1], [1, 1]] },
    hsl: { blue: { sat: -30 } },
    colorGrading: { shadows: { hue: 200, sat: 20 } },
    fade: 15,
    grain: 30,
    sharpening: 50,
    clarity: 10,
  },
  crop: { ...fullCrop(), x: 0.1, w: 0.5, h: 0.8 },
};

const target: Recipe = {
  ...emptyRecipe(),
  intensity: 1,
  user: { exposure: -1, whites: 40, vignette: -20, texture: 5 },
  crop: { ...fullCrop(), quarterTurns: 1 },
};

describe('pasteRecipe', () => {
  it('grupos padrão: tudo menos o recorte', () => {
    expect(DEFAULT_GROUPS.has('crop')).toBe(false);
    expect([...DEFAULT_GROUPS].sort()).toEqual(PASTE_GROUPS.filter((g) => g.id !== 'crop').map((g) => g.id).sort());
  });

  it('colar tudo (padrão) copia ajustes e preset e mantém o recorte do destino', () => {
    const out = pasteRecipe(target, source, DEFAULT_GROUPS, { w: 4000, h: 3000 });
    expect(out.preset?.id).toBe('c1');
    expect(out.intensity).toBe(0.6);
    expect(out.user).toEqual(source.user);
    expect(out.crop).toEqual(target.crop);
  });

  it('só luz: substitui exposição…pretos e deixa o resto do destino', () => {
    const out = pasteRecipe(target, source, new Set(['light']), { w: 4000, h: 3000 });
    expect(out.user).toEqual({ exposure: 0.5, contrast: 10, vignette: -20, texture: 5 });
    expect(out.preset).toBeNull();
  });

  it('um grupo ausente na origem zera esse grupo no destino', () => {
    const out = pasteRecipe(target, source, new Set(['effects', 'detail']), { w: 4000, h: 3000 });
    expect(out.user).toEqual({ exposure: -1, whites: 40, fade: 15, grain: 30, sharpening: 50, clarity: 10 });
  });

  it('cor inclui balanço de branco, saturação, vibração e calibração', () => {
    const out = pasteRecipe(emptyRecipe(), source, new Set(['color']), { w: 4000, h: 3000 });
    expect(out.user).toEqual({ temperature: 20, saturation: -10, calibration: { red: { hue: 5 } } });
  });

  it('não compartilha objetos com a origem', () => {
    const out = pasteRecipe(target, source, DEFAULT_GROUPS, { w: 4000, h: 3000 });
    (out.user.hsl!.blue as { sat: number }).sat = 99;
    expect(source.user.hsl!.blue!.sat).toBe(-30);
  });

  it('recorte colado é ajustado para caber na foto de destino', () => {
    const src = { ...source, crop: straightenCrop(3000, 4000, fullCrop(), 20) };
    const out = pasteRecipe(target, src, new Set(['crop']), { w: 4000, h: 1000 });
    expect(cropFits(4000, 1000, out.crop!)).toBe(true);
    expect(out.crop!.angle).toBe(20);
  });
});
