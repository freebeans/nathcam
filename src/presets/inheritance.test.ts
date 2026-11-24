import { describe, expect, it } from 'vitest';
import { resolvePresets, type PresetFile } from './inheritance';

const base: PresetFile = {
  id: 'base',
  name: 'Base',
  pack: 'autorais',
  extends: null,
  params: { exposure: 0.2, contrast: 10, hsl: { blue: { sat: -10, lum: 5 } } },
  lut: { src: 'luts/base.cube', colorSpace: 'srgb' },
  engineVersion: 1,
};

describe('resolvePresets', () => {
  it('preset sem extends sai igual, sem o campo extends', () => {
    const [p] = resolvePresets([base]);
    expect(p).toEqual({
      id: 'base',
      name: 'Base',
      pack: 'autorais',
      params: base.params,
      lut: base.lut,
      engineVersion: 1,
    });
    expect('extends' in p).toBe(false);
  });

  it('filho herda parâmetros do pai e sobrescreve campo a campo', () => {
    const child: PresetFile = {
      id: 'child',
      name: 'Filho',
      pack: 'autorais',
      extends: 'base',
      params: { contrast: 30, hsl: { blue: { sat: -40 } } },
      engineVersion: 1,
    };
    const out = resolvePresets([child, base]);
    const c = out.find((p) => p.id === 'child')!;
    expect(c.params).toEqual({ exposure: 0.2, contrast: 30, hsl: { blue: { sat: -40, lum: 5 } } });
    expect(c.lut).toEqual(base.lut);
  });

  it('lut: null no filho remove a LUT herdada', () => {
    const child: PresetFile = { ...base, id: 'c', extends: 'base', params: {}, lut: null };
    expect(resolvePresets([base, child]).find((p) => p.id === 'c')!.lut).toBeNull();
  });

  it('curvas são substituídas inteiras, não mescladas ponto a ponto', () => {
    const parent: PresetFile = { ...base, params: { curves: { luma: [[0, 0.1], [0.5, 0.5], [1, 1]] } } };
    const child: PresetFile = { ...base, id: 'c', extends: 'base', params: { curves: { luma: [[0, 0], [1, 0.9]] } } };
    const c = resolvePresets([parent, child]).find((p) => p.id === 'c')!;
    expect(c.params.curves?.luma).toEqual([[0, 0], [1, 0.9]]);
  });

  it('herança em cadeia resolve do avô para o neto', () => {
    const mid: PresetFile = { ...base, id: 'mid', extends: 'base', params: { contrast: 20 } };
    const leaf: PresetFile = { ...base, id: 'leaf', extends: 'mid', params: { fade: 10 } };
    const l = resolvePresets([leaf, mid, base]).find((p) => p.id === 'leaf')!;
    expect(l.params).toMatchObject({ exposure: 0.2, contrast: 20, fade: 10 });
  });

  it('acusa pai inexistente', () => {
    expect(() => resolvePresets([{ ...base, id: 'x', extends: 'nope' }])).toThrow(/nope/);
  });

  it('acusa ciclo', () => {
    const a: PresetFile = { ...base, id: 'a', extends: 'b' };
    const b: PresetFile = { ...base, id: 'b', extends: 'a' };
    expect(() => resolvePresets([a, b])).toThrow(/ciclo/i);
  });

  it('acusa ids repetidos', () => {
    expect(() => resolvePresets([base, base])).toThrow(/repetido/i);
  });
});
