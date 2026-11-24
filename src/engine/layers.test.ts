import { describe, expect, it } from 'vitest';
import { resolveEffective } from './layers';
import { neutralParams } from './params';
import type { Recipe } from './recipe';
import { ENGINE_VERSION } from './version';

function recipe(over: Partial<Recipe> = {}): Recipe {
  return { engineVersion: ENGINE_VERSION, preset: null, intensity: 1, user: {}, ...over };
}

const preset = {
  id: 'p',
  name: 'P',
  pack: 't',
  engineVersion: ENGINE_VERSION,
  params: { exposure: 1, contrast: -20, grainSize: 75, hsl: { blue: { sat: -40 } } },
  lut: { src: 'luts/p.cube', colorSpace: 'srgb' as const },
};

describe('resolveEffective', () => {
  it('sem preset nem ajustes, devolve parâmetros neutros e nenhuma LUT', () => {
    const eff = resolveEffective(recipe());
    expect(eff.params).toEqual(neutralParams());
    expect(eff.lut).toBeNull();
  });

  it('a 50% de intensidade escala cada parâmetro do preset em direção ao neutro', () => {
    const eff = resolveEffective(recipe({ preset, intensity: 0.5 }));
    expect(eff.params.exposure).toBeCloseTo(0.5);
    expect(eff.params.contrast).toBeCloseTo(-10);
    expect(eff.params.hsl.blue.sat).toBeCloseTo(-20);
    // grainSize tem neutro 25: 25 + (75 - 25) * 0.5
    expect(eff.params.grainSize).toBeCloseTo(50);
  });

  it('a intensidade só mistura a saída da LUT, não a remove', () => {
    const eff = resolveEffective(recipe({ preset, intensity: 0.3 }));
    expect(eff.lut).toEqual({ src: 'luts/p.cube', colorSpace: 'srgb', mix: 0.3 });
  });

  it('a camada do usuário soma por cima e não é afetada pela intensidade', () => {
    const eff = resolveEffective(recipe({ preset, intensity: 0.5, user: { exposure: 0.25, hsl: { blue: { sat: 10 } } } }));
    expect(eff.params.exposure).toBeCloseTo(0.75);
    expect(eff.params.hsl.blue.sat).toBeCloseTo(-10);
  });

  it('limita a soma à faixa do controle', () => {
    const eff = resolveEffective(recipe({ preset: { ...preset, params: { contrast: 80 } }, user: { contrast: 60 } }));
    expect(eff.params.contrast).toBe(100);
  });

  it('color grading soma como vetores no plano de cor, sem escalar a matiz', () => {
    const p = { ...preset, params: { colorGrading: { shadows: { hue: 200, sat: 40 } } } };
    const half = resolveEffective(recipe({ preset: p, intensity: 0.5 }));
    expect(half.params.colorGrading.shadows.hue).toBeCloseTo(200);
    expect(half.params.colorGrading.shadows.sat).toBeCloseTo(20);

    // mesma matiz: saturações somam
    const same = resolveEffective(recipe({ preset: p, user: { colorGrading: { shadows: { hue: 200, sat: 10 } } } }));
    expect(same.params.colorGrading.shadows.hue).toBeCloseTo(200);
    expect(same.params.colorGrading.shadows.sat).toBeCloseTo(50);

    // matiz oposta com mesma força: cancelam
    const opposite = resolveEffective(recipe({ preset: p, user: { colorGrading: { shadows: { hue: 20, sat: 40 } } } }));
    expect(opposite.params.colorGrading.shadows.sat).toBeCloseTo(0);
  });

  it('curvas viram camadas: preset escalado pela intensidade e, por cima, a do usuário', () => {
    const p = { ...preset, params: { curves: { luma: [[0, 0.2], [1, 1]] as const } } };
    const eff = resolveEffective(
      recipe({ preset: p, intensity: 0.5, user: { curves: { red: [[0, 0], [0.5, 0.6], [1, 1]] as const } } }),
    );
    expect(eff.curveLayers.luma).toEqual([[[0, 0.1], [1, 1]]]);
    expect(eff.curveLayers.red).toEqual([[[0, 0], [0.5, 0.6], [1, 1]]]);
    expect(eff.curveLayers.green).toEqual([]);
  });

  it('faixas HSL destravadas do usuário prevalecem sobre as do preset', () => {
    const bands = { red: { center: 5, width: 30, softness: 1 } };
    const eff = resolveEffective(recipe({ preset, user: { hslBands: bands as never } }));
    expect(eff.params.hslBands?.red.center).toBe(5);
    expect(eff.params.hslBands?.orange.center).toBe(30);
  });
});

describe('LUT com amount (preset achatado)', () => {
  it('a mistura da LUT é intensidade x amount', () => {
    const p = { ...preset, lut: { src: 'luts/p.cube', colorSpace: 'srgb' as const, amount: 0.6 } };
    expect(resolveEffective(recipe({ preset: p, intensity: 0.5 })).lut?.mix).toBeCloseTo(0.3);
  });
});
