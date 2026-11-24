/**
 * HEIC/HEIF: o Safari decodifica nativamente; nos outros navegadores, o
 * libheif (WASM, LGPL-3.0) é carregado só quando um HEIC chega. O espaço de
 * cor vem do contêiner (ver `heifColorSpace`).
 */
import type { default as LibHeifFactory } from 'libheif-js/libheif-wasm/libheif-bundle.mjs';

/** Uma instância do WASM para o app inteiro (cada uma tem seu próprio heap). */
let lib: ReturnType<typeof LibHeifFactory> | null = null;

/** Pelo tipo, extensão ou assinatura (`ftyp` heic/heix/hevc/mif1/msf1). */
export function looksLikeHeic(type: string, name: string, head?: Uint8Array): boolean {
  if (/image\/hei[cf]/.test(type) || /\.hei[cf]$/i.test(name)) return true;
  if (!head || head.length < 12) return false;
  const s = String.fromCharCode(...head.subarray(4, 12));
  return /^ftyp(heic|heix|hevc|mif1|msf1)/.test(s);
}

export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Decodifica a imagem principal (com rotação/espelho do contêiner aplicados). */
export async function heicToRgba(bytes: Uint8Array): Promise<Rgba> {
  lib ??= import('libheif-js/libheif-wasm/libheif-bundle.mjs').then((m) => m.default());
  const images = new (await lib).HeifDecoder().decode(bytes);
  const img = images[0];
  if (!img) throw new Error('HEIC sem imagem.');
  try {
    const width = img.get_width();
    const height = img.get_height();
    return await new Promise<Rgba>((resolve, reject) =>
      img.display({ data: new Uint8ClampedArray(width * height * 4), width, height }, (d) =>
        d ? resolve(d) : reject(new Error('Falha ao decodificar o HEIC.')),
      ),
    );
  } finally {
    for (const i of images) i.free?.();
  }
}
