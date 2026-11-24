import { describe, expect, it } from 'vitest';
import { NUMERIC_PARAM_BY_PATH } from '../engine/params';
import type { PresetRecipe, Recipe } from '../engine/recipe';
import { ENGINE_VERSION } from '../engine/version';
import { applyPreset, emptyRecipe, fitSize, setUserParam, userDeltaRange, userValue } from './recipe-edit';

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
