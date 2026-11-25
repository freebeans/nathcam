import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { initWLibraw } from '@wasmedia/wlibraw';
import { decodeRawRgba, looksLikeRaw, looksLikeTiff, rawToneLut } from './raw';

// DNG de uma Canon EOS 5D Mark III, 1920x818, CC0 (raw.pixls.us; ver tests/fixtures/README.md).
const dng = new Uint8Array(readFileSync('tests/fixtures/photo-raw.dng'));

describe('looksLikeRaw', () => {
  it('reconhece por extensão, tipo e assinatura', () => {
    expect(looksLikeRaw('', 'IMG_0001.DNG')).toBe(true);
    expect(looksLikeRaw('', 'DSC0001.arw')).toBe(true);
    expect(looksLikeRaw('image/x-adobe-dng', 'sem-nome')).toBe(true);
    expect(looksLikeRaw('image/x-sony-arw', 'sem-nome')).toBe(true);
    const sig = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));
    expect(looksLikeRaw('', 'x', sig('\0\0\0\x18ftypcrx \0\0\0\x01'))).toBe(true); // CR3
    expect(looksLikeRaw('', 'x', sig('FUJIFILMCCD-RAW '))).toBe(true);
    expect(looksLikeRaw('', 'x', sig('IIRO\x08\0\0\0\0\0\0\0'))).toBe(true);
    expect(looksLikeRaw('', 'x', sig('IIU\0\x08\0\0\0\0\0\0\0'))).toBe(true);
  });

  it('não confunde com JPEG, HEIC nem TIFF comum', () => {
    expect(looksLikeRaw('image/jpeg', 'a.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(false);
    expect(looksLikeRaw('image/heic', 'a.heic')).toBe(false);
    expect(looksLikeRaw('image/tiff', 'scan.tif', dng.subarray(0, 16))).toBe(false);
    expect(looksLikeTiff(dng.subarray(0, 16))).toBe(true);
  });
});

describe('rawToneLut', () => {
  it('é monótona, sobe 1 EV nos meios-tons e não corta antes da saturação', () => {
    const lut = rawToneLut();
    expect(lut[0]).toBe(0);
    for (let i = 1; i < lut.length; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
    // 9% linear sobe para 18% (cinza médio, 118 em sRGB).
    expect(lut[Math.round(0.09 * 65535)]).toBeCloseTo(118, -0.5);
    // O ombro: 60% do sensor (0,7 EV acima do branco depois da base) ainda não é branco.
    expect(lut[Math.round(0.6 * 65535)]).toBeLessThan(252);
    expect(lut[65535]).toBeGreaterThanOrEqual(254);
  });
});

describe('decodeRawRgba', () => {
  it('revela em resolução inteira quando cabe', async () => {
    const img = decodeRawRgba(await initWLibraw(), dng, 4096);
    expect([img.width, img.height]).toEqual([1920, 818]);
    expect(img.data.length).toBe(1920 * 818 * 4);
    let r = 0, g = 0, b = 0, a = 255;
    for (let i = 0; i < img.data.length; i += 4) {
      r += img.data[i];
      g += img.data[i + 1];
      b += img.data[i + 2];
      a = Math.min(a, img.data[i + 3]);
    }
    const n = img.data.length / 4;
    expect(a).toBe(255);
    // Revelação de verdade (nem preta, nem estourada, nem com um canal só).
    for (const m of [r / n, g / n, b / n]) {
      expect(m).toBeGreaterThan(10);
      expect(m).toBeLessThan(240);
    }
  });

  it('usa meia resolução quando ela ainda cobre o tamanho pedido', async () => {
    const img = decodeRawRgba(await initWLibraw(), dng, 900);
    expect([img.width, img.height]).toEqual([960, 409]);
  });

  it('rejeita arquivo truncado sem derrubar o módulo', async () => {
    const lib = await initWLibraw();
    expect(() => decodeRawRgba(lib, dng.slice(0, 2048), 4096)).toThrow();
    expect(decodeRawRgba(lib, dng, 900).width).toBe(960);
  });
});
