import { describe, expect, it } from 'vitest';
import {
  P3_LUMA,
  P3_TO_SRGB,
  SRGB_TO_P3,
  applyMat3,
  bradford,
  D50,
  D65_XYZ,
  gamutCompress,
  gamutCompressLimits,
  linearToSrgb,
  mulMat3,
  srgbToLinear,
} from './color';

const close = (a: readonly number[], b: readonly number[], d = 5) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], d));

describe('curva de transferência sRGB', () => {
  it('ida e volta', () => {
    for (const v of [0, 0.001, 0.02, 0.18, 0.5, 1]) expect(srgbToLinear(linearToSrgb(v))).toBeCloseTo(v, 6);
  });
  it('cinza médio', () => {
    expect(linearToSrgb(0.18)).toBeCloseTo(0.4613, 3);
  });
});

describe('matrizes P3 <-> sRGB', () => {
  it('são inversas', () => {
    const id = mulMat3(P3_TO_SRGB, SRGB_TO_P3);
    close(id, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
  });
  it('preservam o branco', () => {
    close(applyMat3(P3_TO_SRGB, [1, 1, 1]), [1, 1, 1]);
  });
  it('vermelho sRGB cabe no P3', () => {
    const r = applyMat3(SRGB_TO_P3, [1, 0, 0]);
    r.forEach((v) => expect(v).toBeGreaterThanOrEqual(0));
    expect(r[0]).toBeCloseTo(0.8225, 3);
  });
  it('luminância P3 soma 1', () => {
    expect(P3_LUMA[0] + P3_LUMA[1] + P3_LUMA[2]).toBeCloseTo(1, 6);
    expect(P3_LUMA[1]).toBeCloseTo(0.6917, 3);
  });
});

describe('Bradford', () => {
  it('leva o branco D65 ao D50', () => {
    close(applyMat3(bradford(D65_XYZ, D50), D65_XYZ), D50, 6);
  });
});

describe('compressão de gama', () => {
  const limits = gamutCompressLimits();

  it('limites cobrem os primários P3 vistos em sRGB', () => {
    limits.forEach((l) => expect(l).toBeGreaterThan(1));
  });

  it('não mexe em cores pouco saturadas', () => {
    const c: [number, number, number] = [0.5, 0.4, 0.3];
    close(gamutCompress(c, limits), c, 9);
  });

  it('traz os primários P3 para dentro do sRGB', () => {
    for (const p of [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ] as const) {
      const s = applyMat3(P3_TO_SRGB, p);
      expect(Math.min(...s)).toBeLessThan(0);
      const out = gamutCompress(s, limits);
      out.forEach((v) => expect(v).toBeGreaterThanOrEqual(-1e-6));
    }
  });

  it('preserva a ordem de saturação (sem achatar degradês)', () => {
    const a = gamutCompress(applyMat3(P3_TO_SRGB, [0, 1, 0]), limits);
    const b = gamutCompress(applyMat3(P3_TO_SRGB, [0.2, 1, 0.2]), limits);
    // verde puro continua mais saturado (componente vermelha menor) que o verde dessaturado
    expect(a[0]).toBeLessThan(b[0]);
  });
});
