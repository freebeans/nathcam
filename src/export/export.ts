/**
 * Exportação: renderiza com o mesmo motor da pré-visualização (em tiles),
 * codifica JPEG em WASM num worker e embute perfil Display P3 e EXIF.
 */
import type { Frame, Renderer } from '../engine/renderer';
import { sanitizeExif } from './exif';
import { buildDisplayP3Icc } from './icc';
import { insertSegments } from './jpeg';
import { extractAnyExif } from './exif-source';

const MAX_EXIF_BYTES = 65_000;
import type { EncodeRequest } from './encode.worker';

export interface ExportOptions {
  /** 1..100 */
  quality: number;
  /** Lado maior máximo (v1: 4096). */
  maxSide: number;
  stripLocation: boolean;
}

export const DEFAULT_EXPORT: ExportOptions = { quality: 92, maxSide: 4096, stripLocation: true };

/** Tamanho de saída: a fonte, reduzida para caber em `maxSide`. */
export function exportSize(srcW: number, srcH: number, maxSide: number): { w: number; h: number } {
  const k = Math.min(1, maxSide / Math.max(srcW, srcH));
  return { w: Math.max(1, Math.round(srcW * k)), h: Math.max(1, Math.round(srcH * k)) };
}

let iccCache: Uint8Array | null = null;

export function encodeJpeg(pixels: Uint8Array, width: number, height: number, quality: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./encode.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<{ ok: boolean; jpeg?: ArrayBuffer; error?: string }>) => {
      worker.terminate();
      if (ev.data.ok && ev.data.jpeg) resolve(new Uint8Array(ev.data.jpeg));
      else reject(new Error(ev.data.error ?? 'Falha ao codificar JPEG'));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Falha no worker de codificação'));
    };
    const req: EncodeRequest = { pixels, width, height, quality };
    worker.postMessage(req, [pixels.buffer]);
  });
}

/** Acrescenta perfil ICC Display P3 e o EXIF (ajustado) do original. */
export function finalizeJpeg(
  jpeg: Uint8Array,
  original: Uint8Array | null,
  opts: { stripLocation: boolean; width: number; height: number },
): Uint8Array {
  iccCache ??= buildDisplayP3Icc();
  const exifSrc = original ? extractAnyExif(original) : null;
  let exif = exifSrc ? sanitizeExif(exifSrc, opts) : null;
  // O segmento APP1 do JPEG cabe no máximo ~64 KB; EXIF maior fica de fora.
  if (exif && exif.length > MAX_EXIF_BYTES) exif = null;
  return insertSegments(jpeg, { exif, icc: iccCache });
}

export async function exportJpeg(
  renderer: Renderer,
  frame: Frame,
  /** Tamanho da imagem de saída (já recortada) em pixels da fonte. */
  output: { w: number; h: number },
  original: Uint8Array | null,
  opts: ExportOptions,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  const { w, h } = exportSize(output.w, output.h, opts.maxSide);
  const pixels = await renderer.readTiled(frame, w, h, 2048, (d, t) => onProgress?.((0.7 * d) / t));
  const jpeg = await encodeJpeg(pixels, w, h, opts.quality);
  onProgress?.(0.95);
  const out = finalizeJpeg(jpeg, original, { stripLocation: opts.stripLocation, width: w, height: h });
  onProgress?.(1);
  return new Blob([out as Uint8Array<ArrayBuffer>], { type: 'image/jpeg' });
}

export function exportFileName(originalName: string | undefined): string {
  const base = (originalName ?? 'foto').replace(/\.[^.]+$/, '');
  return `${base}-editada.jpg`;
}

export function canShareFiles(file: File): boolean {
  return typeof navigator !== 'undefined' && !!navigator.canShare && navigator.canShare({ files: [file] });
}

export async function shareFile(file: File): Promise<void> {
  await navigator.share({ files: [file] });
}

export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
