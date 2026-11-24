/** Utilitários compartilhados pelos testes de motor e exportação (navegador). */
import type { Lut3D } from './cube';
import { resolveEffective } from './layers';
import type { PartialParams } from './params';
import type { Frame } from './renderer';
import { toUniformData } from './uniforms';
import { ENGINE_VERSION } from './version';

/** Imagem sintética determinística: degradês, rampas de cinza, cores saturadas e detalhe fino. */
export function testImage(w = 256, h = 192): ImageData {
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

export function frame(user: PartialParams, lut: Lut3D | null = null, intensity = 1): Frame {
  const eff = resolveEffective({
    engineVersion: ENGINE_VERSION,
    preset: lut ? { id: 't', name: 'T', pack: 't', params: {}, lut: { src: 'x', colorSpace: 'srgb' }, engineVersion: 1 } : null,
    intensity,
    user,
  });
  return { data: toUniformData(eff), lut };
}

export function diffStats(a: Uint8Array, b: Uint8Array): { mean: number; max: number } {
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

