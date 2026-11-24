/** Leitura e escrita de segmentos APPn de um JPEG. */

export interface Segment {
  marker: number;
  /** Dados do segmento (sem marcador e sem campo de tamanho). */
  payload: Uint8Array;
}

const EXIF_ID = [0x45, 0x78, 0x69, 0x66, 0, 0]; // "Exif\0\0"
const ICC_ID = 'ICC_PROFILE\0';

/** Segmentos entre o SOI e o SOS. */
export function readSegments(jpeg: Uint8Array): Segment[] {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('Não é um JPEG');
  const out: Segment[] = [];
  let o = 2;
  while (o + 4 <= jpeg.length) {
    if (jpeg[o] !== 0xff) throw new Error(`JPEG corrompido na posição ${o}`);
    const marker = jpeg[o + 1];
    if (marker === 0xff) {
      o++;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    const len = (jpeg[o + 2] << 8) | jpeg[o + 3];
    if (len < 2 || o + 2 + len > jpeg.length) throw new Error('Segmento JPEG truncado');
    out.push({ marker, payload: jpeg.subarray(o + 4, o + 2 + len) });
    o += 2 + len;
  }
  return out;
}

function startsWith(a: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((v, i) => a[i] === v);
}

function isExif(s: Segment): boolean {
  return s.marker === 0xe1 && startsWith(s.payload, EXIF_ID);
}

function isIcc(s: Segment): boolean {
  return s.marker === 0xe2 && startsWith(s.payload, [...ICC_ID].map((c) => c.charCodeAt(0)));
}

/** TIFF do bloco EXIF (APP1), ou null se o JPEG não tiver EXIF. */
export function extractExif(jpeg: Uint8Array): Uint8Array | null {
  let segs: Segment[];
  try {
    segs = readSegments(jpeg);
  } catch {
    return null;
  }
  const s = segs.find(isExif);
  return s ? s.payload.slice(EXIF_ID.length) : null;
}

function encodeSegment(marker: number, payload: Uint8Array): Uint8Array {
  if (payload.length + 2 > 0xffff) throw new Error('Segmento JPEG grande demais');
  const s = new Uint8Array(payload.length + 4);
  s[0] = 0xff;
  s[1] = marker;
  s[2] = (payload.length + 2) >> 8;
  s[3] = (payload.length + 2) & 255;
  s.set(payload, 4);
  return s;
}

/**
 * Insere EXIF (APP1) e perfil ICC (APP2) logo após o SOI/JFIF, removendo
 * EXIF e ICC que já existam.
 */
export function insertSegments(jpeg: Uint8Array, opts: { exif?: Uint8Array | null; icc?: Uint8Array | null }): Uint8Array {
  const segs = readSegments(jpeg);
  // Posição do fim dos segmentos lidos = início do restante (tabelas, SOS...).
  let o = 2;
  const keep: Uint8Array[] = [];
  let jfif: Uint8Array | null = null;
  for (const s of segs) {
    const raw = jpeg.subarray(o, o + 4 + s.payload.length);
    o += 4 + s.payload.length;
    if (isExif(s) || isIcc(s)) continue;
    if (s.marker === 0xe0 && !jfif) jfif = raw;
    else keep.push(raw);
  }
  const added: Uint8Array[] = [];
  if (opts.exif) added.push(encodeSegment(0xe1, new Uint8Array([...EXIF_ID, ...opts.exif])));
  if (opts.icc) {
    const head = [...ICC_ID].map((c) => c.charCodeAt(0));
    added.push(encodeSegment(0xe2, new Uint8Array([...head, 1, 1, ...opts.icc])));
  }
  const parts = [jpeg.subarray(0, 2), ...(jfif ? [jfif] : []), ...added, ...keep, jpeg.subarray(o)];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let w = 0;
  for (const p of parts) {
    out.set(p, w);
    w += p.length;
  }
  return out;
}
