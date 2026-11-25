/**
 * RAW de câmera (DNG, ARW, CR2, CR3, NEF, RAF, ORF, RW2…): revelado pelo
 * LibRaw em WASM (wlibraw, LGPL-2.1, sem threads, então dispensa
 * cross-origin isolation), num worker carregado só quando um RAW chega.
 *
 * A revelação é neutra, para o motor trabalhar a partir dela: balanço de
 * branco da câmera, Display P3 linear em 16 bits, sem brilho automático do
 * LibRaw (que estoura 1% dos pixels) e altas luzes reconstruídas por
 * mistura. Depois, uma curva fixa (`rawToneLut`) leva para 8 bits com curva
 * sRGB: +1 EV de base, como os reveladores fazem, e um ombro suave que
 * comprime até o ponto de saturação do sensor em vez de cortar.
 */
import type { DecodeOptions, WLibraw } from '@wasmedia/wlibraw';

/** Extensões de RAW que o LibRaw abre. */
export const RAW_EXTENSIONS = [
  'dng', 'arw', 'srf', 'sr2', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'raf', 'orf', 'rw2', 'rwl',
  'pef', 'srw', 'x3f', '3fr', 'fff', 'iiq', 'erf', 'kdc', 'dcr', 'mrw', 'mos', 'mef', 'raw',
] as const;

const RAW_EXT_RE = new RegExp(`\\.(${RAW_EXTENSIONS.join('|')})$`, 'i');

/**
 * Acima desta área (ex.: ProRAW de 48 MP) a revelação inteira não cabe com
 * folga na memória do Safari iOS (o LibRaw guarda 4 canais de 16 bits por
 * pixel), então ela sai em meia resolução: sem demosaico, 1/4 da memória.
 */
export const RAW_FULL_MAX_PIXELS = 30e6;

/** Revelação neutra; ver o comentário do módulo. */
export const RAW_DECODE_OPTIONS = {
  outputBps: 16,
  outputColor: 7, // P3 D65 (LibRaw ≥ 0.21); o enum do wlibraw só vai até ACES.
  linear: true,
  useCameraWb: true,
  noAutoBright: true,
  highlightMode: 2,
} as const;

/** Exposição de base aplicada à revelação, em EV. */
export const RAW_BASELINE_EV = 1;
/** Início do ombro (linear, depois da exposição de base). */
const SHOULDER_KNEE = 0.75;

/**
 * Curva fixa de 16 bits lineares para 8 bits com curva sRGB: exposição de
 * base e ombro exponencial acima de `SHOULDER_KNEE`, contínuo na derivada,
 * que leva a saturação do sensor (1.0 × 2^EV) para quase 1.0.
 */
export function rawToneLut(): Uint8Array {
  const lut = new Uint8Array(65536);
  const gain = 2 ** RAW_BASELINE_EV;
  const span = 1 - SHOULDER_KNEE;
  for (let i = 0; i < 65536; i++) {
    let v = (i / 65535) * gain;
    if (v > SHOULDER_KNEE) v = SHOULDER_KNEE + span * (1 - Math.exp(-(v - SHOULDER_KNEE) / span));
    const e = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    lut[i] = Math.round(Math.min(1, e) * 255);
  }
  return lut;
}

/**
 * Pela extensão, pelo tipo MIME ou por assinaturas próprias de RAW (CR3,
 * RAF, ORF, RW2). DNG, CR2, NEF e ARW são TIFF por fora: sem extensão,
 * só são tentados como RAW quando o navegador não abre o arquivo
 * (ver `looksLikeTiff`).
 */
export function looksLikeRaw(type: string, name: string, head?: Uint8Array): boolean {
  if (RAW_EXT_RE.test(name)) return true;
  if (/^image\/(x-)?(adobe-dng|dng|sony-|canon-|nikon-|fuji-|olympus-|panasonic-|pentax-|samsung-|sigma-|hasselblad-|kodak-|minolta-|raw)/.test(type)) return true;
  if (!head || head.length < 12) return false;
  const s = String.fromCharCode(...head.subarray(0, Math.min(16, head.length)));
  if (s.slice(4, 11) === 'ftypcrx') return true; // CR3
  if (s.startsWith('FUJIFILM')) return true; // RAF
  if (s.startsWith('IIRO') || s.startsWith('IIRS') || s.startsWith('MMOR')) return true; // ORF
  if (s.startsWith('IIU\0')) return true; // RW2/RWL
  return false;
}

/** Cabeçalho TIFF (II*\0 ou MM\0*): talvez um RAW sem extensão. */
export function looksLikeTiff(head: Uint8Array): boolean {
  return head.length >= 4 && ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 42 && head[3] === 0) ||
    (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0 && head[3] === 42));
}

export interface RawRgba {
  /** RGBA 8 bits em Display P3, já na orientação certa. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Revela com o LibRaw. Sai em meia resolução quando ela ainda cobre
 * `maxSide` ou quando a resolução inteira passaria de `RAW_FULL_MAX_PIXELS`;
 * a redução final até `maxSide` fica com quem chama.
 */
export function decodeRawRgba(lib: WLibraw, bytes: Uint8Array, maxSide: number): RawRgba {
  const file = lib.open(bytes);
  try {
    const { width, height } = file.metadata;
    const halfSize = Math.max(width, height) / 2 >= maxSide || width * height > RAW_FULL_MAX_PIXELS;
    const image = file.decode({ ...(RAW_DECODE_OPTIONS as unknown as DecodeOptions), halfSize });
    try {
      const px = image.toPixels();
      if (px.bits !== 16 || !(px.data instanceof Uint16Array)) throw new Error(`saída inesperada do LibRaw (${px.bits} bits)`);
      return toRgba8(px.data, px.width, px.height, px.colors);
    } finally {
      image.free();
    }
  } finally {
    file.close();
  }
}

let toneLut: Uint8Array | null = null;

/** RGB (ou cinza) de 16 bits lineares para RGBA de 8 bits pela curva fixa. */
function toRgba8(src: Uint16Array, width: number, height: number, colors: number): RawRgba {
  const lut = (toneLut ??= rawToneLut());
  const n = width * height;
  const data = new Uint8ClampedArray(n * 4);
  for (let i = 0, j = 0, o = 0; i < n; i++, j += colors, o += 4) {
    const r = lut[src[j]];
    data[o] = r;
    data[o + 1] = colors >= 3 ? lut[src[j + 1]] : r;
    data[o + 2] = colors >= 3 ? lut[src[j + 2]] : r;
    data[o + 3] = 255;
  }
  return { data, width, height };
}

/**
 * Revela num worker próprio, encerrado no fim: o heap do WASM só cresce, e
 * assim a memória da revelação volta para o sistema logo depois.
 */
export function rawToRgba(bytes: Uint8Array, maxSide: number): Promise<RawRgba> {
  const worker = new Worker(new URL('./raw.worker.ts', import.meta.url), { type: 'module' });
  return new Promise<RawRgba>((resolve, reject) => {
    worker.onmessage = (e: MessageEvent<{ ok: true; img: RawRgba } | { ok: false; error: string }>) =>
      e.data.ok ? resolve(e.data.img) : reject(new Error(e.data.error));
    worker.onerror = (e) => reject(new Error(e.message || 'falha no worker do RAW'));
    worker.postMessage({ bytes, maxSide });
  }).finally(() => worker.terminate());
}
