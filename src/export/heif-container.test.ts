import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readExifSummary, sanitizeExif } from './exif';
import { extractHeicExif, heifColorSpace } from './heif-container';

const heic = new Uint8Array(readFileSync('tests/fixtures/photo-heic.heic'));

describe('extractHeicExif', () => {
  it('acha o TIFF do item Exif pelo índice do contêiner', () => {
    const tiff = extractHeicExif(heic)!;
    expect(String.fromCharCode(tiff[0], tiff[1])).toBe('MM');
    expect(readExifSummary(tiff)).toMatchObject({ make: 'TestCam', model: 'HEIC Model', date: '2026-11-21T09:30:00' });
    expect(sanitizeExif(tiff, { stripLocation: true, width: 1, height: 1 })).not.toBeNull();
  });

  it('arquivo sem Exif ou que não é HEIC dá null', () => {
    expect(extractHeicExif(new Uint8Array([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]))).toBeNull();
    expect(extractHeicExif(new Uint8Array(100))).toBeNull();
  });

  it('não lança com dados truncados', () => {
    for (const n of [10, 100, 300, 1000, heic.length - 50]) expect(() => extractHeicExif(heic.slice(0, n))).not.toThrow();
  });
});

describe('heifColorSpace', () => {
  it('nclx sRGB/BT.709 (ou não especificado) é sRGB', () => {
    expect(heifColorSpace(heic)).toBe('srgb');
  });

  it('perfil ICC Display P3 embutido é P3', () => {
    expect(heifColorSpace(new Uint8Array(readFileSync('tests/fixtures/photo-heic-p3.heic')))).toBe('display-p3');
  });

  it('sem informação de cor, assume sRGB', () => {
    expect(heifColorSpace(new Uint8Array(64))).toBe('srgb');
  });
});

describe('limites do parser', () => {
  it('iloc com extents de tamanho zero não trava', () => {
    // meta > iinf(Exif id 1) + iloc v0 com offset/length de 0 bytes e 65535 extents
    const box = (type: string, body: number[]) => {
      const n = body.length + 8;
      return [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255, ...[...type].map((c) => c.charCodeAt(0)), ...body];
    };
    const infe = box('infe', [2, 0, 0, 0, 0, 1, 0, 0, ...[...'Exif'].map((c) => c.charCodeAt(0)), 0]);
    const iinf = box('iinf', [0, 0, 0, 0, 0, 1, ...infe]);
    const iloc = box('iloc', [0, 0, 0, 0, 0x00, 0x00, 0, 1, 0, 1, 0, 0, 0xff, 0xff]);
    const meta = box('meta', [0, 0, 0, 0, ...iinf, ...iloc]);
    const t0 = performance.now();
    expect(extractHeicExif(new Uint8Array(meta))).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
