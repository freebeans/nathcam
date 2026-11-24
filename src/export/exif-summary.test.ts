import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { readExifSummary } from './exif';
import { extractExif } from './jpeg';

describe('readExifSummary', () => {
  it('lê câmera e data de uma foto real', () => {
    const jpeg = new Uint8Array(readFileSync('tests/fixtures/photo-12mp-exif.jpg'));
    const s = readExifSummary(extractExif(jpeg)!);
    expect(s).toEqual({ make: 'TestCam', model: 'Model X', date: '2026-11-20T10:00:00' });
  });

  it('EXIF inválido dá resumo vazio', () => {
    expect(readExifSummary(new Uint8Array([1, 2, 3]))).toEqual({});
  });
});
