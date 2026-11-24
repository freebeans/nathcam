/** Abertura de fotos (JPEG, PNG; HEIC só onde o navegador decodifica nativamente). */

/** v1: a exportação é limitada a 4096 px no lado maior; a fonte também. */
export const SOURCE_MAX_SIDE = 4096;

export interface Photo {
  name: string;
  bitmap: ImageBitmap;
  /** Arquivo original (para copiar o EXIF na exportação). */
  bytes: Uint8Array;
  width: number;
  height: number;
}

function isHeic(file: File): boolean {
  return /image\/hei[cf]/.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

export async function loadPhoto(file: File, maxTextureSize: number): Promise<Photo> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const blob = new Blob([bytes], { type: file.type });
  let probe: ImageBitmap;
  try {
    // "from-image": aplica a orientação do EXIF.
    probe = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch {
    if (isHeic(file)) throw new Error('Este navegador não abre HEIC. Escolha a foto pelo rolo da câmera (o iPhone converte para JPEG) ou exporte como JPEG.');
    throw new Error('Não foi possível abrir esta imagem. Use JPEG ou PNG.');
  }
  const limit = Math.min(SOURCE_MAX_SIDE, maxTextureSize);
  const k = Math.min(1, limit / Math.max(probe.width, probe.height));
  let bitmap = probe;
  if (k < 1) {
    const w = Math.round(probe.width * k);
    const h = Math.round(probe.height * k);
    bitmap = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      resizeWidth: w,
      resizeHeight: h,
      resizeQuality: 'high',
    });
    probe.close();
  }
  return { name: file.name, bitmap, bytes, width: bitmap.width, height: bitmap.height };
}
