import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readExifSummary, sanitizeExif } from './exif';
import { extractHeicExif } from './heic-exif';

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
