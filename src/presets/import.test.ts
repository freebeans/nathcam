import { describe, expect, it } from 'vitest';
import { haldToLut, resampleLut, sanitizeParams, parsePresetJson } from './import';
import type { Lut3D } from '../engine/cube';

/** Hald de identidade nível L: imagem L³ x L³, cubo de lado L². */
function identityHald(level: number, f: (c: number[]) => number[] = (c) => c): { px: Uint8Array; size: number } {
  const n = level * level;
  const size = level * level * level;
  const px = new Uint8Array(size * size * 4);
  let i = 0;
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const out = f([r / (n - 1), g / (n - 1), b / (n - 1)]);
        px.set([Math.round(out[0] * 255), Math.round(out[1] * 255), Math.round(out[2] * 255), 255], i * 4);
        i++;
      }
  return { px, size };
}

describe('haldToLut', () => {
  it('lê uma Hald nível 4 como cubo 16³ com o vermelho variando mais rápido', () => {
    const { px, size } = identityHald(4);
    const lut = haldToLut(px, size, size);
    expect(lut.size).toBe(16);
    expect(lut.data[3]).toBeCloseTo(17 / 255, 6); // r = 1/15
    expect(lut.data[16 * 3 + 1]).toBeCloseTo(17 / 255, 6); // g = 1/15
    expect(lut.data[16 * 16 * 3 + 2]).toBeCloseTo(17 / 255, 6); // b = 1/15
  });

  it('preserva a transformação gravada na Hald', () => {
    const { px, size } = identityHald(3, ([r, g, b]) => [1 - r, g * 0.5, b]);
    const lut = haldToLut(px, size, size);
    const n = lut.size;
    const at = (r: number, g: number, b: number) => Array.from(lut.data.slice((r + g * n + b * n * n) * 3, (r + g * n + b * n * n) * 3 + 3));
    const v = at(n - 1, n - 1, 0);
    expect(v[0]).toBeCloseTo(0, 2);
    expect(v[1]).toBeCloseTo(0.5, 2);
  });

  it('acusa imagens que não são Hald', () => {
    expect(() => haldToLut(new Uint8Array(100 * 80 * 4), 100, 80)).toThrow(/Hald/);
    expect(() => haldToLut(new Uint8Array(100 * 100 * 4), 100, 100)).toThrow(/Hald/);
  });

  it('reduz Halds grandes para no máximo 65³', () => {
    const { px, size } = identityHald(9); // cubo 81³
    const lut = haldToLut(px, size, size);
    expect(lut.size).toBe(65);
    // identidade continua identidade
    const n = lut.size;
    const i = (40 + 10 * n + 60 * n * n) * 3;
    expect(lut.data[i]).toBeCloseTo(40 / 64, 2);
    expect(lut.data[i + 1]).toBeCloseTo(10 / 64, 2);
    expect(lut.data[i + 2]).toBeCloseTo(60 / 64, 2);
  });
});

describe('resampleLut', () => {
  it('interpola trilinearmente', () => {
    const lut: Lut3D = { size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: new Float32Array(24) };
    // saída = (r, g, b) nos cantos -> identidade
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) lut.data.set([r, g, b], (r + g * 2 + b * 4) * 3);
    const out = resampleLut(lut, 3);
    expect(Array.from(out.data.slice((1 + 1 * 3 + 1 * 9) * 3, (1 + 1 * 3 + 1 * 9) * 3 + 3))).toEqual([0.5, 0.5, 0.5]);
  });
});

describe('sanitizeParams', () => {
  it('mantém parâmetros conhecidos, limita faixas e descarta o resto', () => {
    const { params, ignored } = sanitizeParams({
      exposure: 9,
      contrast: '10',
      hsl: { blue: { sat: -20, foo: 1 }, cinza: { sat: 1 } },
      curves: { luma: [[0, 0.1], [1, 1]], red: 'x' },
      hslBands: { red: { center: 10, width: 30, softness: 0.5 } },
      evil: { __proto__: 1 },
    });
    expect(params).toEqual({
      exposure: 5,
      hsl: { blue: { sat: -20 } },
      curves: { luma: [[0, 0.1], [1, 1]] },
      hslBands: { red: { center: 10, width: 30, softness: 0.5 } },
    });
    expect(ignored).toEqual(expect.arrayContaining(['contrast', 'hsl.blue.foo', 'curves.red', 'evil']));
  });

  it('rejeita curvas com pontos fora de 0..1', () => {
    expect(sanitizeParams({ curves: { luma: [[0, 2], [1, 1]] } }).params).toEqual({});
  });
});

describe('parsePresetJson', () => {
  it('lê o formato próprio', () => {
    const p = parsePresetJson(
      JSON.stringify({ id: 'x', name: 'Meu', pack: 'autorais', params: { exposure: 0.5 }, engineVersion: 1 }),
      'meu.json',
    );
    expect(p).toMatchObject({ name: 'Meu', pack: 'autorais', params: { exposure: 0.5 }, lut: null });
  });

  it('aceita LUT apenas dos presets oficiais (caminho relativo luts/)', () => {
    const ok = parsePresetJson(JSON.stringify({ name: 'A', params: {}, lut: { src: 'luts/cssco-c1.cube', colorSpace: 'srgb' } }), 'a.json');
    expect(ok.lut).toEqual({ src: 'luts/cssco-c1.cube', colorSpace: 'srgb' });
    expect(() => parsePresetJson(JSON.stringify({ name: 'A', params: {}, lut: { src: 'https://x.com/a.cube', colorSpace: 'srgb' } }), 'a.json')).toThrow(/LUT/);
  });

  it('recusa extends (presets salvos são achatados)', () => {
    expect(() => parsePresetJson(JSON.stringify({ name: 'A', extends: 'b', params: {} }), 'a.json')).toThrow(/extends/);
  });

  it('recusa JSON inválido ou sem params', () => {
    expect(() => parsePresetJson('{', 'a.json')).toThrow(/JSON/);
    expect(() => parsePresetJson('{"name":"x"}', 'a.json')).toThrow(/params/);
  });

  it('nome do arquivo quando falta nome', () => {
    expect(parsePresetJson('{"params":{}}', 'Look 2.json').name).toBe('Look 2');
  });
});
