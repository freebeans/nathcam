import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { heicToRgba, looksLikeHeic } from './heic';

const heic = new Uint8Array(readFileSync('tests/fixtures/photo-heic.heic'));

describe('HEIC', () => {
  it('reconhece pelo tipo, extensão ou assinatura', () => {
    expect(looksLikeHeic('image/heic', 'x')).toBe(true);
    expect(looksLikeHeic('', 'IMG_0001.HEIC')).toBe(true);
    expect(looksLikeHeic('', 'sem-nome', heic.subarray(0, 16))).toBe(true);
    expect(looksLikeHeic('image/jpeg', 'a.jpg', new Uint8Array([0xff, 0xd8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
  });

  it('decodifica com o libheif (WASM)', async () => {
    const img = await heicToRgba(heic);
    expect([img.width, img.height]).toEqual([640, 480]);
    // retângulo vermelho desenhado em (40..200, 40..160)
    const i = (60 * img.width + 100) * 4;
    expect(img.data[i]).toBeGreaterThan(190);
    expect(img.data[i + 1]).toBeLessThan(70);
  });
});
