/**
 * EXIF de um arquivo HEIC/HEIF: lê o contêiner (ISOBMFF), acha o item do
 * tipo `Exif` em `meta/iinf` e seus bytes em `meta/iloc`. O item começa com
 * um deslocamento de 4 bytes até o cabeçalho TIFF.
 */

class Reader {
  constructor(readonly b: Uint8Array) {}
  check(o: number, n: number) {
    if (o < 0 || o + n > this.b.length) throw new Error('fora do arquivo');
  }
  u8(o: number) {
    this.check(o, 1);
    return this.b[o];
  }
  u16(o: number) {
    this.check(o, 2);
    return (this.b[o] << 8) | this.b[o + 1];
  }
  u32(o: number) {
    this.check(o, 4);
    return ((this.b[o] << 24) | (this.b[o + 1] << 16) | (this.b[o + 2] << 8) | this.b[o + 3]) >>> 0;
  }
  /** Inteiro sem sinal de n bytes (0, 4 ou 8; 8 só até 2^53). */
  uint(o: number, n: number) {
    if (n === 0) return 0;
    if (n === 4) return this.u32(o);
    if (n === 8) return this.u32(o) * 2 ** 32 + this.u32(o + 4);
    throw new Error(`tamanho de campo ${n}`);
  }
  type(o: number) {
    this.check(o, 4);
    return String.fromCharCode(this.b[o], this.b[o + 1], this.b[o + 2], this.b[o + 3]);
  }
}

interface Box {
  type: string;
  /** Início do conteúdo (depois do cabeçalho). */
  start: number;
  end: number;
}

function* boxes(r: Reader, start: number, end: number): Generator<Box> {
  let o = start;
  while (o + 8 <= end) {
    let size = r.u32(o);
    const type = r.type(o + 4);
    let header = 8;
    if (size === 1) {
      size = r.uint(o + 8, 8);
      header = 16;
    } else if (size === 0) size = end - o;
    if (size < header || o + size > end) return;
    yield { type, start: o + header, end: o + size };
    o += size;
  }
}

function child(r: Reader, parent: Box, type: string, skip = 0): Box | undefined {
  for (const b of boxes(r, parent.start + skip, parent.end)) if (b.type === type) return b;
  return undefined;
}

function exifItemId(r: Reader, iinf: Box): number | undefined {
  const version = r.u8(iinf.start);
  const countSize = version === 0 ? 2 : 4;
  for (const infe of boxes(r, iinf.start + 4 + countSize, iinf.end)) {
    if (infe.type !== 'infe') continue;
    const v = r.u8(infe.start);
    if (v < 2) continue;
    const idSize = v === 2 ? 2 : 4;
    const id = idSize === 2 ? r.u16(infe.start + 4) : r.u32(infe.start + 4);
    const type = r.type(infe.start + 4 + idSize + 2);
    if (type === 'Exif') return id;
  }
  return undefined;
}

function itemBytes(r: Reader, iloc: Box, itemId: number): Uint8Array | undefined {
  const version = r.u8(iloc.start);
  let o = iloc.start + 4;
  const sizes = r.u8(o);
  const sizes2 = r.u8(o + 1);
  const offsetSize = sizes >> 4;
  const lengthSize = sizes & 15;
  const baseOffsetSize = sizes2 >> 4;
  const indexSize = version === 1 || version === 2 ? sizes2 & 15 : 0;
  o += 2;
  const count = version < 2 ? r.u16(o) : r.u32(o);
  o += version < 2 ? 2 : 4;
  for (let i = 0; i < count; i++) {
    const id = version < 2 ? r.u16(o) : r.u32(o);
    o += version < 2 ? 2 : 4;
    let method = 0;
    if (version === 1 || version === 2) {
      method = r.u16(o) & 15;
      o += 2;
    }
    o += 2; // data_reference_index
    const base = r.uint(o, baseOffsetSize);
    o += baseOffsetSize;
    const extents = r.u16(o);
    o += 2;
    const parts: Uint8Array[] = [];
    for (let e = 0; e < extents; e++) {
      o += indexSize;
      const off = r.uint(o, offsetSize);
      o += offsetSize;
      const len = r.uint(o, lengthSize);
      o += lengthSize;
      if (id === itemId) {
        r.check(base + off, len);
        parts.push(r.b.subarray(base + off, base + off + len));
      }
    }
    if (id === itemId) {
      if (method !== 0) return undefined; // só dados no próprio arquivo
      const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
      let w = 0;
      for (const p of parts) {
        out.set(p, w);
        w += p.length;
      }
      return out;
    }
  }
  return undefined;
}

/** TIFF do EXIF de um HEIC, ou null se não houver (ou o arquivo for inválido). */
export function extractHeicExif(file: Uint8Array): Uint8Array | null {
  try {
    const r = new Reader(file);
    const meta = [...boxes(r, 0, file.length)].find((b) => b.type === 'meta');
    if (!meta) return null;
    // meta é FullBox: 4 bytes de versão/flags antes dos filhos.
    const iinf = child(r, meta, 'iinf', 4);
    const iloc = child(r, meta, 'iloc', 4);
    if (!iinf || !iloc) return null;
    const id = exifItemId(r, iinf);
    if (id === undefined) return null;
    const item = itemBytes(r, iloc, id);
    if (!item || item.length < 12) return null;
    const tiffStart = 4 + new Reader(item).u32(0);
    const tiff = item.slice(tiffStart);
    const bo = String.fromCharCode(tiff[0], tiff[1]);
    return bo === 'MM' || bo === 'II' ? tiff : null;
  } catch {
    return null;
  }
}
