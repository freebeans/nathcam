/// <reference lib="webworker" />
import encode from '@jsquash/jpeg/encode';

export interface EncodeRequest {
  pixels: Uint8Array;
  width: number;
  height: number;
  quality: number;
}

self.onmessage = async (ev: MessageEvent<EncodeRequest>) => {
  const { pixels, width, height, quality } = ev.data;
  try {
    const data = new Uint8ClampedArray(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    // O codificador só lê data/width/height: evita copiar para um ImageData.
    const out = await encode({ data, width, height, colorSpace: 'srgb' } as ImageData, {
      quality,
      // 4:4:4 em qualidade alta preserva bordas de cor saturada.
      chroma_subsample: quality >= 90 ? 1 : 2,
      progressive: true,
      optimize_coding: true,
    });
    (self as unknown as Worker).postMessage({ ok: true, jpeg: out }, [out]);
  } catch (e) {
    (self as unknown as Worker).postMessage({ ok: false, error: String(e) });
  }
};
