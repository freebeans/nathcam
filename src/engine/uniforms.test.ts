import { describe, expect, it } from 'vitest';
import { applyMat3, P3_LUMA } from './color';
import { neutralParams } from './params';
import { calibrationMatrix, toUniforms, whiteBalanceGains } from './uniforms';
import { resolveEffective } from './layers';
import { ENGINE_VERSION } from './version';

const lum = (v: readonly number[]) => v[0] * P3_LUMA[0] + v[1] * P3_LUMA[1] + v[2] * P3_LUMA[2];

describe('calibrationMatrix', () => {
  it('neutro é a identidade', () => {
    const m = calibrationMatrix(neutralParams().calibration);
    [1, 0, 0, 0, 1, 0, 0, 0, 1].forEach((v, i) => expect(m[i]).toBeCloseTo(v, 9));
  });

  it('sempre preserva o branco', () => {
    const cal = { ...neutralParams().calibration, red: { hue: 60, sat: 40 }, blue: { hue: -30, sat: -50 } };
    const w = applyMat3(calibrationMatrix(cal), [1, 1, 1]);
    w.forEach((v) => expect(v).toBeCloseTo(1, 9));
  });

  it('saturação do primário vermelho aumenta o croma do vermelho', () => {
    const base = neutralParams().calibration;
    const red = applyMat3(calibrationMatrix({ ...base, red: { hue: 0, sat: 50 } }), [1, 0, 0]);
    expect(red[0] - red[1]).toBeGreaterThan(1);
  });
});

describe('whiteBalanceGains', () => {
  it('neutro não muda nada', () => {
    expect(whiteBalanceGains(0, 0)).toEqual([1, 1, 1]);
  });
  it('temperatura positiva esquenta preservando a luminância', () => {
    const g = whiteBalanceGains(50, 0);
    expect(g[0]).toBeGreaterThan(g[2]);
    expect(lum(g)).toBeCloseTo(1, 9);
  });
  it('tonalidade positiva puxa para magenta', () => {
    const g = whiteBalanceGains(0, 50);
    expect(g[1]).toBeLessThan(g[0]);
    expect(lum(g)).toBeCloseTo(1, 9);
  });
});

describe('toUniforms', () => {
  it('parâmetros neutros dão uniforms neutros', () => {
    const u = toUniforms(resolveEffective({ engineVersion: ENGINE_VERSION, preset: null, intensity: 1, user: {} }));
    expect(u.u_exposure).toBe(0);
    expect(u.u_contrast).toBe(0);
    expect(u.u_lutMix).toBe(0);
    expect(Array.from(u.u_hslSat)).toEqual(new Array(8).fill(0));
    expect(u.u_curvesActive).toBe(0);
  });

  it('exposição vai em EV; sliders de -100..100 viram -1..1', () => {
    const u = toUniforms(
      resolveEffective({ engineVersion: ENGINE_VERSION, preset: null, intensity: 1, user: { exposure: 1.5, contrast: 50 } }),
    );
    expect(u.u_exposure).toBeCloseTo(1.5);
    expect(u.u_contrast).toBeCloseTo(0.5);
  });

  it('curvas ativas quando há alguma camada', () => {
    const u = toUniforms(
      resolveEffective({
        engineVersion: ENGINE_VERSION,
        preset: null,
        intensity: 1,
        user: { curves: { luma: [[0, 0.1], [1, 1]] } },
      }),
    );
    expect(u.u_curvesActive).toBe(1);
  });
});
