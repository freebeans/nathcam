/**
 * Testes do motor num navegador headless (WebGL2 real).
 *
 * Referências de imagem ficam em `__refs__/`. Para regenerá-las depois de uma
 * mudança intencional no shader: `npm run refs:update` (e explique o motivo
 * no commit).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { resolveEffective } from './layers';
import type { PartialParams } from './params';
import { Renderer, type Frame } from './renderer';
import { toUniformData } from './uniforms';
import { ENGINE_VERSION } from './version';
import type { Lut3D } from './cube';
import { srgbToLinear } from './color';

declare const __UPDATE_REFS__: boolean;

const W = 256;
const H = 192;

/** Imagem sintética determinística: degradês, rampas de cinza, cores saturadas e detalhe fino. */
function testImage(w = W, h = H): ImageData {
  const img = new ImageData(w, h, { colorSpace: 'display-p3' });
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const u = x / (w - 1);
      const v = y / (h - 1);
      let r: number, g: number, b: number;
      if (v < 0.25) {
        r = g = b = u; // rampa de cinza
      } else if (v < 0.5) {
        const hue = u * 6;
        const k = (n: number) => Math.max(0, Math.min(1, Math.abs(((hue + n) % 6) - 3) - 1));
        r = k(0);
        g = k(4);
        b = k(2); // arco-íris saturado
      } else if (v < 0.75) {
        r = 0.8 * u + 0.1;
        g = 0.55 * (1 - u) + 0.2;
        b = 0.35; // tons de pele/céu
      } else {
        const check = ((Math.floor(x / 2) + Math.floor(y / 2)) % 2) * 0.3;
        r = g = b = 0.35 + check * (0.5 + 0.5 * Math.sin(u * 20)); // detalhe fino
      }
      d[i] = Math.round(r * 255);
      d[i + 1] = Math.round(g * 255);
      d[i + 2] = Math.round(b * 255);
      d[i + 3] = 255;
    }
  }
  return img;
}

function frame(user: PartialParams, lut: Lut3D | null = null, intensity = 1): Frame {
  const eff = resolveEffective({
    engineVersion: ENGINE_VERSION,
    preset: lut ? { id: 't', name: 'T', pack: 't', params: {}, lut: { src: 'x', colorSpace: 'srgb' }, engineVersion: 1 } : null,
    intensity,
    user,
  });
  return { data: toUniformData(eff), lut };
}

function diffStats(a: Uint8Array, b: Uint8Array): { mean: number; max: number } {
  let sum = 0;
  let max = 0;
  let n = 0;
  for (let i = 0; i < a.length; i++) {
    if (i % 4 === 3) continue;
    const d = Math.abs(a[i] - b[i]);
    sum += d;
    max = Math.max(max, d);
    n++;
  }
  return { mean: sum / n, max };
}

/** Reduz uma imagem RGBA por média de blocos k x k. */
function downsample(px: Uint8Array, w: number, h: number, k: number): Uint8Array {
  const ow = w / k;
  const oh = h / k;
  const out = new Uint8Array(ow * oh * 4);
  for (let y = 0; y < oh; y++)
    for (let x = 0; x < ow; x++)
      for (let c = 0; c < 4; c++) {
        let s = 0;
        for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) s += px[((y * k + j) * w + x * k + i) * 4 + c];
        out[(y * ow + x) * 4 + c] = Math.round(s / (k * k));
      }
  return out;
}

async function toPngBase64(px: Uint8Array, w: number, h: number): Promise<string> {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(px), w, h), 0, 0);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function fromPngBase64(b64: string): Promise<{ px: Uint8Array; w: number; h: number }> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  return { px: new Uint8Array(ctx.getImageData(0, 0, bmp.width, bmp.height).data.buffer), w: bmp.width, h: bmp.height };
}

/** Uma LUT 17³ que imita um look: esquenta, aumenta contraste e dessatura um pouco. */
function lookLut(): Lut3D {
  const n = 17;
  const data = new Float32Array(n * n * n * 3);
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const i = (r + g * n + b * n * n) * 3;
        const c = [r / (n - 1), g / (n - 1), b / (n - 1)];
        const l = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
        const s = c.map((v) => l + (v - l) * 0.8);
        const k = s.map((v) => v + 0.15 * (v - 0.5) * (1 - Math.abs(2 * v - 1)));
        data[i] = Math.min(1, k[0] * 1.05 + 0.02);
        data[i + 1] = k[1];
        data[i + 2] = Math.max(0, k[2] * 0.92);
      }
  return { size: n, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
}

let renderer: Renderer;
const input = testImage();

beforeAll(() => {
  renderer = new Renderer(new OffscreenCanvas(1, 1));
  renderer.setSource(input);
});

afterAll(() => renderer.dispose());

describe('motor', () => {
  it('detecta recursos', () => {
    expect(renderer.caps.maxTextureSize).toBeGreaterThanOrEqual(4096);
    expect(typeof renderer.caps.float16).toBe('boolean');
  });

  it('receita neutra devolve a imagem de entrada', () => {
    const out = renderer.read(frame({}), W, H);
    const { mean, max } = diffStats(out, new Uint8Array(input.data.buffer));
    expect(max).toBeLessThanOrEqual(3);
    expect(mean).toBeLessThan(0.8);
  });

  it('exposição +1 dobra a luz linear', () => {
    const base = renderer.read(frame({}), W, H);
    const out = renderer.read(frame({ exposure: 1 }), W, H);
    // linha da rampa de cinza, valores médios (sem estourar)
    const y = 10;
    for (const x of [40, 60, 80]) {
      const i = (y * W + x) * 4;
      const ratio = srgbToLinear(out[i] / 255) / srgbToLinear(base[i] / 255);
      expect(ratio).toBeGreaterThan(1.85);
      expect(ratio).toBeLessThan(2.15);
    }
  });

  it('saturação -100 deixa a imagem cinza', () => {
    const out = renderer.read(frame({ saturation: -100 }), W, H);
    const y = 70; // faixa do arco-íris
    for (const x of [10, 80, 150, 220]) {
      const i = (y * W + x) * 4;
      expect(Math.abs(out[i] - out[i + 1])).toBeLessThanOrEqual(3);
      expect(Math.abs(out[i + 1] - out[i + 2])).toBeLessThanOrEqual(3);
    }
  });

  it('LUT com intensidade 0 não altera; com intensidade parcial fica entre os extremos', () => {
    const lut = lookLut();
    const none = renderer.read(frame({}), W, H);
    const zero = renderer.read(frame({}, lut, 0), W, H);
    expect(diffStats(zero, none).max).toBeLessThanOrEqual(1);
    const full = renderer.read(frame({}, lut, 1), W, H);
    const half = renderer.read(frame({}, lut, 0.5), W, H);
    expect(diffStats(full, none).mean).toBeGreaterThan(3);
    const dHalf = diffStats(half, none).mean;
    expect(dHalf).toBeGreaterThan(0.5);
    expect(dHalf).toBeLessThan(diffStats(full, none).mean);
  });

  it('renderizar em tiles dá o mesmo resultado que renderizar inteiro', async () => {
    const f = frame({ clarity: 60, texture: 40, sharpening: 80, grain: 40, vignette: -40, contrast: 20 });
    const whole = renderer.read(f, W, H);
    const tiled = await renderer.readTiled(f, W, H, 64);
    const { max } = diffStats(whole, tiled);
    expect(max).toBeLessThanOrEqual(1);
  });

  it('pré-visualização e exportação têm a mesma aparência em escalas diferentes', () => {
    // Fonte grande para que as duas escalas venham da mesma informação.
    const big = new Renderer(new OffscreenCanvas(1, 1));
    big.setSource(testImage(W * 4, H * 4));
    try {
      const f = frame({ clarity: 50, texture: 30, contrast: 25, shadows: 30, vignette: -30, grain: 30, temperature: 20 });
      const preview = big.read(f, W, H);
      const exportPx = big.read(f, W * 4, H * 4);
      const reduced = downsample(exportPx, W * 4, H * 4, 4);
      const { mean } = diffStats(preview, reduced);
      expect(mean).toBeLessThan(4);
    } finally {
      big.dispose();
    }
  });
});

const REFERENCE_CASES: Record<string, { user: PartialParams; lut?: boolean; intensity?: number }> = {
  neutral: { user: {} },
  tone: { user: { exposure: 0.4, contrast: 40, highlights: -60, shadows: 50, whites: 20, blacks: -30 } },
  color: {
    user: {
      temperature: 30,
      tint: -15,
      vibrance: 40,
      saturation: -10,
      hsl: { blue: { hue: 30, sat: -50, lum: -20 }, orange: { sat: 30, lum: 20 } },
      calibration: { red: { hue: 20, sat: 10 }, blue: { hue: -30, sat: 30 }, shadowsTint: 15 },
    },
  },
  grading: {
    user: {
      colorGrading: {
        shadows: { hue: 200, sat: 40, lum: -10 },
        midtones: { hue: 40, sat: 15, lum: 0 },
        highlights: { hue: 50, sat: 30, lum: 10 },
        blending: 60,
        balance: -20,
      },
      curves: { luma: [[0, 0.06], [0.25, 0.22], [0.75, 0.8], [1, 0.96]], blue: [[0, 0.05], [1, 0.95]] },
    },
  },
  effects: { user: { fade: 40, grain: 50, grainSize: 50, vignette: -60, clarity: 40, texture: 30, sharpening: 60 } },
  lut: { user: { exposure: 0.2 }, lut: true, intensity: 0.8 },
};

describe('referências de imagem', () => {
  for (const [name, c] of Object.entries(REFERENCE_CASES)) {
    it(name, async () => {
      const out = renderer.read(frame(c.user, c.lut ? lookLut() : null, c.intensity ?? 1), W, H);
      const path = `src/engine/__refs__/${name}.png`;
      if (__UPDATE_REFS__) {
        await commands.writeFile(path, await toPngBase64(out, W, H), 'base64');
        return;
      }
      const ref = await fromPngBase64(await commands.readFile(path, 'base64'));
      expect([ref.w, ref.h]).toEqual([W, H]);
      const { mean, max } = diffStats(out, ref.px);
      expect(mean).toBeLessThan(0.5);
      expect(max).toBeLessThanOrEqual(6);
    });
  }
});
