/**
 * EXIF de RAWs que são TIFF por fora (DNG, CR2, NEF, ARW, PEF, ORF, RW2…).
 * O arquivo inteiro já é um TIFF, mas grande demais e cheio de dados de
 * imagem: monta um TIFF compacto só com o que interessa à foto exportada.
 * - IFD0: fabricante, modelo, data, autor, copyright;
 * - sub-IFD EXIF inteira, menos MakerNote e ponteiros para outras IFDs;
 * - sub-IFD GPS inteira (`sanitizeExif` a apaga se for pedido).
 * CR3 e RAF não são TIFF: ficam sem EXIF.
 */

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4 };

const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const IFD0_KEEP = new Set([0x010f /* Make */, 0x0110 /* Model */, 0x0132 /* DateTime */, 0x013b /* Artist */, 0x8298 /* Copyright */]);
/** MakerNote (grande e com offsets próprios) e ponteiro de Interoperabilidade. */
const EXIF_DROP = new Set([0x927c, 0xa005]);
/** Limite por valor copiado (evita arrastar blocos grandes). */
const MAX_VALUE_BYTES = 4096;

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Bytes do valor, na ordem de bytes do original. */
  value: Uint8Array;
}

class Reader {
  readonly le: boolean;
  constructor(readonly b: Uint8Array) {
    if (b.length < 8) throw new Error('TIFF curto');
    if (b[0] === 0x49 && b[1] === 0x49) this.le = true;
    else if (b[0] === 0x4d && b[1] === 0x4d) this.le = false;
    else throw new Error('sem ordem de bytes');
    // 42 (TIFF/DNG/CR2/NEF/ARW/PEF), 0x4f52/0x5352 (ORF), 0x55 (RW2).
    if (![42, 0x4f52, 0x5352, 0x55].includes(this.u16(2))) throw new Error('não é TIFF');
  }
  check(o: number, n: number) {
    if (o < 0 || o + n > this.b.length) throw new Error('fora do arquivo');
  }
  u16(o: number) {
    this.check(o, 2);
    return this.le ? this.b[o] | (this.b[o + 1] << 8) : (this.b[o] << 8) | this.b[o + 1];
  }
  u32(o: number) {
    this.check(o, 4);
    const b = this.b;
    return this.le
      ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
      : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  }
  entries(ifd: number): (Entry & { offsetField: number })[] {
    const n = this.u16(ifd);
    this.check(ifd + 2, n * 12);
    const out: (Entry & { offsetField: number })[] = [];
    for (let i = 0; i < n; i++) {
      const o = ifd + 2 + i * 12;
      const type = this.u16(o + 2);
      const count = this.u32(o + 4);
      const size = (TYPE_SIZE[type] ?? 0) * count;
      if (!size || size > MAX_VALUE_BYTES) continue;
      const at = size <= 4 ? o + 8 : this.u32(o + 8);
      this.check(at, size);
      out.push({ tag: this.u16(o), type, count, value: this.b.slice(at, at + size), offsetField: o + 8 });
    }
    return out;
  }
}

class Writer {
  private parts: Uint8Array[] = [];
  private size = 0;
  constructor(readonly le: boolean) {}
  get offset() {
    return this.size;
  }
  push(b: Uint8Array) {
    this.parts.push(b);
    this.size += b.length;
  }
  u16(v: number) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v, this.le);
    return b;
  }
  u32(v: number) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v, this.le);
    return b;
  }
  /** Bytes da IFD em si (contagem, entradas, próximo), sem os valores longos. */
  ifdSize(n: number) {
    return 2 + n * 12 + 4;
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.size);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

/** Monta uma IFD (entradas ordenadas) com os valores longos logo depois dela. */
function writeIfd(w: Writer, entries: Entry[]): void {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  let data = w.offset + w.ifdSize(sorted.length);
  const longs: Uint8Array[] = [];
  w.push(w.u16(sorted.length));
  for (const e of sorted) {
    w.push(w.u16(e.tag));
    w.push(w.u16(e.type));
    w.push(w.u32(e.count));
    if (e.value.length <= 4) {
      const field = new Uint8Array(4);
      field.set(e.value);
      w.push(field);
    } else {
      w.push(w.u32(data));
      const v = e.value.length % 2 ? Uint8Array.from([...e.value, 0]) : e.value;
      longs.push(v);
      data += v.length;
    }
  }
  w.push(w.u32(0));
  for (const v of longs) w.push(v);
}

/** Tamanho de uma IFD escrita por `writeIfd`, contando os valores longos. */
function ifdBytes(entries: Entry[]): number {
  let n = 2 + entries.length * 12 + 4;
  for (const e of entries) if (e.value.length > 4) n += e.value.length + (e.value.length % 2);
  return n;
}

/** TIFF compacto com o EXIF do RAW, ou null se o arquivo não for TIFF. */
export function extractTiffRawExif(file: Uint8Array): Uint8Array | null {
  try {
    const r = new Reader(file);
    const ifd0 = r.entries(r.u32(4));
    const keep0 = ifd0.filter((e) => IFD0_KEEP.has(e.tag)).map(({ tag, type, count, value }) => ({ tag, type, count, value }));
    const sub = (tag: number, drop?: Set<number>): Entry[] | null => {
      const p = ifd0.find((e) => e.tag === tag && e.value.length === 4);
      if (!p) return null;
      try {
        return r
          .entries(r.u32(p.offsetField))
          .filter((e) => !drop?.has(e.tag))
          .map(({ tag, type, count, value }) => ({ tag, type, count, value }));
      } catch {
        return null;
      }
    };
    const exif = sub(TAG_EXIF_IFD, EXIF_DROP);
    const gps = sub(TAG_GPS_IFD);
    if (!keep0.length && !exif) return null;

    // Ponteiros com valor provisório; o tamanho de IFD0 não depende do valor.
    const ptr = (tag: number): Entry => ({ tag, type: 4, count: 1, value: new Uint8Array(4) });
    const entries0 = [...keep0, ...(exif ? [ptr(TAG_EXIF_IFD)] : []), ...(gps ? [ptr(TAG_GPS_IFD)] : [])];
    const w = new Writer(r.le);
    const exifAt = 8 + ifdBytes(entries0);
    const gpsAt = exifAt + (exif ? ifdBytes(exif) : 0);
    for (const e of entries0) {
      if (e.tag === TAG_EXIF_IFD) e.value = w.u32(exifAt);
      if (e.tag === TAG_GPS_IFD) e.value = w.u32(gpsAt);
    }
    w.push(r.le ? Uint8Array.of(0x49, 0x49) : Uint8Array.of(0x4d, 0x4d));
    w.push(w.u16(42));
    w.push(w.u32(8));
    writeIfd(w, entries0);
    if (exif) writeIfd(w, exif);
    if (gps) writeIfd(w, gps);
    return w.bytes();
  } catch {
    return null;
  }
}
