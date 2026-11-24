/** Decodificação de fotos (JPEG, PNG; HEIC só onde o navegador decodifica nativamente). */
import { readExifSummary, type ExifSummary } from '../export/exif';
import { extractExif } from '../export/jpeg';
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

function isHeic(type: string, name: string): boolean {
  return /image\/hei[cf]/.test(type) || /\.hei[cf]$/i.test(name);
}

/** Decodifica aplicando a orientação do EXIF e reduzindo para caber em `maxSide`. */
export async function decodeImage(blob: Blob, name: string, maxSide: number): Promise<ImageBitmap> {
  let probe: ImageBitmap;
  try {
    probe = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    if (isHeic(blob.type, name))
      throw new Error(
        `${name}: este navegador não abre HEIC. Escolha a foto pelo rolo da câmera (o iPhone converte para JPEG) ou exporte como JPEG.`,
      );
    throw new Error(`${name}: não foi possível abrir. Use JPEG ou PNG.`);
  }
  const limit = maxSide;
  if (Math.max(probe.width, probe.height) <= limit) return probe;
  const { w, h } = fitSize(probe.width, probe.height, limit, limit, limit);
  probe.close();
  return createImageBitmap(blob, { imageOrientation: 'from-image', resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
}

export function exifSummaryOf(bytes: Uint8Array): ExifSummary {
  const tiff = extractExif(bytes);
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
