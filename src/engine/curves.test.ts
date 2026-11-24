import { describe, expect, it } from 'vitest';
import { CURVE_LUT_SIZE, bakeCurves, evalCurve } from './curves';

describe('evalCurve', () => {
  it('identidade', () => {
    for (const x of [0, 0.25, 0.5, 1]) expect(evalCurve([[0, 0], [1, 1]], x)).toBeCloseTo(x, 9);
  });

  it('passa pelos pontos de controle', () => {
    const c = [[0, 0.1], [0.3, 0.2], [0.7, 0.85], [1, 0.95]] as const;
    for (const [x, y] of c) expect(evalCurve(c, x)).toBeCloseTo(y, 9);
  });

  it('fora da faixa dos pontos, fica constante (como no Lightroom)', () => {
    const c = [[0.2, 0.1], [0.8, 0.9]] as const;
    expect(evalCurve(c, 0)).toBeCloseTo(0.1);
    expect(evalCurve(c, 1)).toBeCloseTo(0.9);
  });

  it('é monotônica quando os pontos são (sem overshoot)', () => {
    const c = [[0, 0], [0.4, 0.05], [0.5, 0.9], [1, 1]] as const;
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const y = evalCurve(c, i / 200);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(y).toBeLessThanOrEqual(1 + 1e-12);
      prev = y;
    }
  });

  it('aceita pontos fora de ordem', () => {
    expect(evalCurve([[1, 1], [0, 0], [0.5, 0.7]], 0.5)).toBeCloseTo(0.7);
  });
});

describe('bakeCurves', () => {
  it('sem camadas, a tabela é a identidade', () => {
    const t = bakeCurves({ luma: [], red: [], green: [], blue: [] });
    expect(t.length).toBe(CURVE_LUT_SIZE * 4);
    expect(t[4 * 128]).toBeCloseTo(128 / (CURVE_LUT_SIZE - 1), 6);
  });

  it('aplica luminância e depois o canal, compondo camadas em ordem', () => {
    const up = [[0, 0.2], [1, 1]] as const; // y = 0.2 + 0.8x
    const half = [[0, 0], [1, 0.5]] as const; // y = 0.5x
    const t = bakeCurves({ luma: [up], red: [half, half], green: [], blue: [] });
    // em x = 0: luma -> 0.2; red -> 0.2 * 0.5 * 0.5
    expect(t[0]).toBeCloseTo(0.05, 6);
    expect(t[1]).toBeCloseTo(0.2, 6);
    expect(t[2]).toBeCloseTo(0.2, 6);
  });
});
