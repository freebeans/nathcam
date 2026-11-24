import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Renderer } from '../engine/renderer';
import { diffStats, frame, testImage } from '../engine/test-utils';
import { exportJpeg, exportSize } from './export';
import { readSegments } from './jpeg';

let renderer: Renderer;

beforeAll(() => {
  renderer = new Renderer(new OffscreenCanvas(1, 1));
  renderer.setSource(testImage(320, 240));
});
afterAll(() => renderer.dispose());

async function decode(blob: Blob): Promise<Uint8Array> {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0);
  return new Uint8Array(ctx.getImageData(0, 0, bmp.width, bmp.height).data.buffer);
}

describe('exportação JPEG', () => {
  it('limita o lado maior', () => {
    expect(exportSize(4032, 3024, 4096)).toEqual({ w: 4032, h: 3024 });
    expect(exportSize(8000, 6000, 4096)).toEqual({ w: 4096, h: 3072 });
  });

  it('é visualmente idêntica à pré-visualização e leva o perfil Display P3', async () => {
    const f = frame({ contrast: 30, temperature: 25, clarity: 30, vignette: -30, saturation: 15 });
    const blob = await exportJpeg(renderer, f, { w: 320, h: 240 }, null, { quality: 95, maxSide: 4096, stripLocation: true });
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const icc = readSegments(bytes).find((s) => s.marker === 0xe2);
    expect(icc).toBeDefined();
    expect(new TextDecoder().decode(icc!.payload.slice(0, 11))).toBe('ICC_PROFILE');

    const exported = await decode(blob);
    const preview = renderer.read(f, 320, 240);
    const { mean } = diffStats(exported, preview);
    expect(mean).toBeLessThan(2);
  });
});
