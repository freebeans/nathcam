import { describe, expect, it } from 'vitest';
import { NUMERIC_PARAM_BY_PATH } from '../engine/params';
import type { PresetRecipe, Recipe } from '../engine/recipe';
import { ENGINE_VERSION } from '../engine/version';
import { applyPreset, emptyRecipe, fitSize, flattenRecipe, setUserParam, sliderModel, userDeltaRange, userValue } from './recipe-edit';
import { resolveEffective } from '../engine/layers';
import { bakeCurves } from '../engine/curves';

const p1: PresetRecipe = { id: 'a', name: 'A', pack: 'x', params: { contrast: 10 }, lut: null, engineVersion: 1 };
const p2: PresetRecipe = { id: 'b', name: 'B', pack: 'x', params: { fade: 20 }, lut: null, engineVersion: 1 };

describe('applyPreset', () => {
  it('troca o preset mantendo ajustes do usuário e recorte', () => {
    const crop = { x: 0.1, y: 0.1, w: 0.5, h: 0.5, angle: 2, quarterTurns: 0, flipH: false };
    const r: Recipe = { ...emptyRecipe(), preset: p1, intensity: 0.4, user: { exposure: 0.3 }, crop };
    const out = applyPreset(r, p2);
    expect(out.preset?.id).toBe('b');
    expect(out.user).toEqual({ exposure: 0.3 });
    expect(out.crop).toEqual(crop);
  });

  it('guarda uma cópia da receita do preset (editar o preset depois não muda a foto)', () => {
    const preset = structuredClone(p1);
    const out = applyPreset(emptyRecipe(), preset);
    (preset.params as { contrast: number }).contrast = 99;
    expect(out.preset?.params.contrast).toBe(10);
  });

  it('volta a intensidade a 100% ao escolher outro preset', () => {
    const out = applyPreset({ ...emptyRecipe(), preset: p1, intensity: 0.3 }, p2);
    expect(out.intensity).toBe(1);
  });

  it('null remove o preset', () => {
    expect(applyPreset({ ...emptyRecipe(), preset: p1 }, null).preset).toBeNull();
  });

  it('carimba a versão do motor', () => {
    expect(emptyRecipe().engineVersion).toBe(ENGINE_VERSION);
  });
});

describe('setUserParam', () => {
  it('grava caminhos aninhados sem mutar a receita', () => {
    const r = emptyRecipe();
    const out = setUserParam(r, 'hsl.blue.sat', -20);
    expect(out.user).toEqual({ hsl: { blue: { sat: -20 } } });
    expect(r.user).toEqual({});
  });

  it('voltar a zero remove a chave', () => {
    const r = setUserParam(setUserParam(emptyRecipe(), 'exposure', 1), 'contrast', 5);
    expect(setUserParam(r, 'exposure', 0).user).toEqual({ contrast: 5 });
    expect(userValue(r, 'contrast')).toBe(5);
    expect(userValue(r, 'fade')).toBe(0);
  });
});

describe('userDeltaRange', () => {
  it('é simétrico e cobre a faixa inteira a partir do neutro', () => {
    expect(userDeltaRange(NUMERIC_PARAM_BY_PATH.get('exposure')!)).toEqual([-5, 5]);
    expect(userDeltaRange(NUMERIC_PARAM_BY_PATH.get('fade')!)).toEqual([-100, 100]);
    expect(userDeltaRange(NUMERIC_PARAM_BY_PATH.get('grainSize')!)).toEqual([-75, 75]);
  });
});

describe('fitSize', () => {
  it('cabe na caixa mantendo a proporção, sem passar do lado máximo', () => {
    expect(fitSize(4000, 3000, 400, 400, 2048)).toEqual({ w: 400, h: 300 });
    expect(fitSize(3000, 4000, 4000, 4000, 2048)).toEqual({ w: 1536, h: 2048 });
    expect(fitSize(100, 50, 400, 400, 2048)).toEqual({ w: 100, h: 50 });
  });
});

describe('flattenRecipe', () => {
  const lutPreset: PresetRecipe = {
    id: 'c1',
    name: 'C1',
    pack: 'cssco',
    params: { exposure: 1, contrast: 20, hsl: { blue: { sat: -40 } }, colorGrading: { shadows: { hue: 200, sat: 30 } } },
    lut: { src: 'luts/c1.cube', colorSpace: 'srgb' },
    engineVersion: 1,
  };
  const r: Recipe = {
    ...emptyRecipe(),
    preset: lutPreset,
    intensity: 0.5,
    user: { exposure: 0.2, fade: 10, curves: { luma: [[0, 0.1], [1, 1]] } },
    crop: { x: 0, y: 0, w: 0.5, h: 1, angle: 0, quarterTurns: 0, flipH: false },
  };
  const flat = flattenRecipe(r);

  it('vira uma camada só, sem ajustes do usuário, marcada como achatada', () => {
    expect(flat.user).toEqual({});
    expect(flat.intensity).toBe(1);
    expect(flat.flattened).toBe(true);
    expect(flat.crop).toEqual(r.crop);
  });

  it('produz os mesmos parâmetros efetivos', () => {
    const a = resolveEffective(r).params;
    const b = resolveEffective(flat).params;
    expect(b.exposure).toBeCloseTo(a.exposure);
    expect(b.contrast).toBeCloseTo(a.contrast);
    expect(b.fade).toBeCloseTo(a.fade);
    expect(b.hsl.blue.sat).toBeCloseTo(a.hsl.blue.sat);
    expect(b.colorGrading.shadows.sat).toBeCloseTo(a.colorGrading.shadows.sat);
  });

  it('mantém a LUT com a mesma mistura', () => {
    expect(resolveEffective(flat).lut).toEqual(resolveEffective(r).lut);
  });

  it('as curvas compostas viram uma curva equivalente', () => {
    const before = bakeCurves(resolveEffective(r).curveLayers);
    const after = bakeCurves(resolveEffective(flat).curveLayers);
    for (let i = 0; i < before.length; i += 16) expect(after[i]).toBeCloseTo(before[i], 2);
  });

  it('sem preset nem ajustes, achatar não cria preset', () => {
    expect(flattenRecipe(emptyRecipe()).preset).toBeNull();
  });
});

describe('sliderModel', () => {
  const preset: PresetRecipe = { id: 'p', name: 'P', pack: 'x', params: { contrast: 30 }, lut: null, engineVersion: 1 };

  it('camadas: mostra o deslocamento do usuário, relativo ao preset', () => {
    const r = { ...emptyRecipe(), preset, user: { contrast: 10 } };
    const m = sliderModel(r, 'contrast', 'layer');
    expect(m).toMatchObject({ value: 10, min: -100, max: 100, neutral: 0 });
    expect(m.apply(r, 25).user.contrast).toBe(25);
  });

  it('achatado: mostra o valor absoluto e grava a diferença na camada do usuário', () => {
    const r = { ...emptyRecipe(), preset, user: { contrast: 10 }, flattened: true };
    const m = sliderModel(r, 'contrast', 'layer');
    expect(m).toMatchObject({ value: 40, min: -100, max: 100, neutral: 0 });
    expect(m.apply(r, 50).user.contrast).toBe(20);
  });

  it('editando o preset: mostra e altera a receita do preset', () => {
    const r = { ...emptyRecipe(), preset, user: { contrast: 10 } };
    const m = sliderModel(r, 'contrast', 'preset');
    expect(m.value).toBe(30);
    const out = m.apply(r, 45);
    expect(out.preset?.params.contrast).toBe(45);
    expect(out.user.contrast).toBe(10);
    expect(preset.params.contrast).toBe(30); // não muta
  });

  it('neutro diferente de zero (tamanho do grão)', () => {
    const r = emptyRecipe();
    expect(sliderModel({ ...r, flattened: true }, 'grainSize', 'layer')).toMatchObject({ value: 25, neutral: 25 });
  });
});
