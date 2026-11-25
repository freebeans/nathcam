import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readExifSummary, sanitizeExif } from './exif';
import { extractAnyExif } from './exif-source';
import { extractTiffRawExif } from './tiff-exif';

const dng = new Uint8Array(readFileSync('tests/fixtures/photo-raw.dng'));

/** TIFF mínimo: IFD0 com Make e um ponteiro de EXIF; EXIF com ISO, MakerNote e uma data. */
function tinyRaw(le: boolean, magic = 42): Uint8Array {
  const b = new Uint8Array(512);
  const v = new DataView(b.buffer);
  b.set(le ? [0x49, 0x49] : [0x4d, 0x4d]);
  v.setUint16(2, magic, le);
  v.setUint32(4, 8, le);
  const entry = (o: number, tag: number, type: number, count: number, val: number) => {
    v.setUint16(o, tag, le);
    v.setUint16(o + 2, type, le);
    v.setUint32(o + 4, count, le);
    if (type === 3 && count === 1) v.setUint16(o + 8, val, le);
    else v.setUint32(o + 8, val, le);
  };
  // IFD0 em 8: Make (ASCII em 200), StripOffsets (descartado), ExifIFD em 100.
  v.setUint16(8, 3, le);
  entry(10, 0x010f, 2, 6, 200);
  entry(22, 0x0111, 4, 1, 400);
  entry(34, 0x8769, 4, 1, 100);
  b.set([...'Canon\0'].map((c) => c.charCodeAt(0)), 200);
  // EXIF em 100: ISO 400, DateTimeOriginal (ASCII em 300), MakerNote (UNDEFINED em 400).
  v.setUint16(100, 3, le);
  entry(102, 0x8827, 3, 1, 400);
  entry(114, 0x9003, 2, 20, 300);
  entry(126, 0x927c, 7, 50, 400);
  b.set([...'2024:05:06 07:08:09\0'].map((c) => c.charCodeAt(0)), 300);
  return b;
}

describe('extractTiffRawExif', () => {
  for (const le of [true, false]) {
    it(`monta um TIFF compacto (${le ? 'II' : 'MM'})`, () => {
      const out = extractTiffRawExif(tinyRaw(le))!;
      expect(out).not.toBeNull();
      expect(readExifSummary(out)).toEqual({ make: 'Canon', date: '2024-05-06T07:08:09' });
      const v = new DataView(out.buffer);
      const ifd0 = v.getUint32(4, le);
      expect(v.getUint16(ifd0, le)).toBe(2); // Make + ponteiro do EXIF; StripOffsets fora
      const exif = v.getUint32(ifd0 + 2 + 12 + 8, le);
      expect(v.getUint16(exif, le)).toBe(2); // ISO + data; MakerNote fora
      expect(v.getUint16(exif + 2, le)).toBe(0x8827);
      expect(v.getUint16(exif + 2 + 8, le)).toBe(400);
      expect(sanitizeExif(out, { stripLocation: true, width: 10, height: 10 })).not.toBeNull();
    });
  }

  it('aceita as variantes ORF e RW2 do cabeçalho', () => {
    expect(extractTiffRawExif(tinyRaw(true, 0x4f52))).not.toBeNull();
    expect(extractTiffRawExif(tinyRaw(true, 0x55))).not.toBeNull();
  });

  it('extrai do DNG real, pequeno o bastante para o JPEG', () => {
    const out = extractAnyExif(dng)!;
    expect(out).not.toBeNull();
    expect(out.length).toBeLessThan(64 * 1024);
    expect(readExifSummary(out).model).toMatch(/5D Mark III/);
  });

  it('nunca lança com arquivo truncado ou que não é TIFF', () => {
    for (const n of [0, 4, 8, 20, 100, 1000]) expect(() => extractTiffRawExif(dng.slice(0, n))).not.toThrow();
    expect(extractTiffRawExif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBeNull();
  });
});
