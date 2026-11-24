/** Decodificação de fotos (JPEG, PNG; HEIC só onde o navegador decodifica nativamente). */
import { readExifSummary, type ExifSummary } from '../export/exif';
import { extractAnyExif } from '../export/exif-source';
import { heicToRgba, looksLikeHeic } from './heic';
import { fitSize } from './recipe-edit';

/**
 * Lado maior da fonte usada na edição (pré-visualização, miniaturas e
 * exportação padrão). A exportação em resolução total decodifica de novo.
 */
export const SOURCE_MAX_SIDE = 4096;
/** Lado maior das miniaturas da biblioteca. */
export const LIBRARY_THUMB_SIDE = 360;

export interface Photo {
  id: string;
  name: string;
  bitmap: ImageBitmap;
  /** Arquivo original (para copiar o EXIF na exportação). */
  bytes: Uint8Array;
  width: number;
  height: number;
}

/** Decodifica aplicando a orientação do EXIF e reduzindo para caber em `maxSide`. */
export async function decodeImage(blob: Blob, name: string, maxSide: number): Promise<ImageBitmap> {
  let probe: ImageBitmap;
  try {
    probe = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (!looksLikeHeic(blob.type, name, head)) throw new Error(`${name}: não foi possível abrir. Use JPEG, PNG ou HEIC.`);
    probe = await decodeHeicBitmap(blob, name);
  }
  if (Math.max(probe.width, probe.height) <= maxSide) return probe;
  const { w, h } = fitSize(probe.width, probe.height, maxSide, maxSide, maxSide);
  const resized = await createImageBitmap(probe, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
  probe.close();
  return resized;
}

/** HEIC sem suporte nativo: libheif em WASM, carregado agora. */
async function decodeHeicBitmap(blob: Blob, name: string): Promise<ImageBitmap> {
  try {
    const img = await heicToRgba(new Uint8Array(await blob.arrayBuffer()));
    const data = new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height, { colorSpace: 'display-p3' });
    return await createImageBitmap(data);
  } catch (e) {
    throw new Error(`${name}: não foi possível abrir o HEIC (${e instanceof Error ? e.message : String(e)}).`);
  }
}

export function exifSummaryOf(bytes: Uint8Array): ExifSummary {
  const tiff = extractAnyExif(bytes);
  return tiff ? readExifSummary(tiff) : {};
}

/** Canvas Display P3 do tamanho dado; `draw` pinta nele, e o resultado vira um JPEG pequeno. */
function smallJpeg(w: number, h: number, draw: (ctx: OffscreenCanvasRenderingContext2D) => void): Promise<Blob> {
  const c = new OffscreenCanvas(w, h);
  draw(c.getContext('2d', { colorSpace: 'display-p3' })!);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
}

/** JPEG pequeno a partir de pixels Display P3 (lidos na hora, antes de retornar). */
export function thumbFromPixels(px: Uint8Array, w: number, h: number): Promise<Blob> {
  const data = new Uint8ClampedArray(px.buffer as ArrayBuffer, px.byteOffset, px.byteLength);
  return smallJpeg(w, h, (ctx) => ctx.putImageData(new ImageData(data, w, h, { colorSpace: 'display-p3' }), 0, 0));
}

/** JPEG pequeno a partir de uma imagem decodificada. */
export function thumbFromBitmap(bmp: ImageBitmap): Promise<Blob> {
  const { w, h } = fitSize(bmp.width, bmp.height, LIBRARY_THUMB_SIDE, LIBRARY_THUMB_SIDE, LIBRARY_THUMB_SIDE);
  return smallJpeg(w, h, (ctx) => {
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
  });
}
