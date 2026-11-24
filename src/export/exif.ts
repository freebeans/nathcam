/**
 * Ajusta o EXIF (TIFF) do original para a foto exportada:
 * - orientação = 1 (os pixels exportados já estão na orientação certa);
 * - espaço de cor "não calibrado" (é o que indica Display P3, via perfil ICC);
 * - dimensões novas;
 * - miniatura antiga descartada (mostraria a foto sem edição);
 * - localização removida, se pedido.
 */

export interface ExifOptions {
  stripLocation: boolean;
  width: number;
  height: number;
}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

const TAG_ORIENTATION = 0x0112;
const TAG_EXIF_IFD = 0x8769;
const TAG_GPS_IFD = 0x8825;
const TAG_COLOR_SPACE = 0xa001;
const TAG_PIXEL_X = 0xa002;
const TAG_PIXEL_Y = 0xa003;
const TAG_THUMB_OFFSET = 0x0201;
const TAG_THUMB_LENGTH = 0x0202;

class Tiff {
  readonly le: boolean;
  constructor(readonly b: Uint8Array) {
    if (b.length < 8) throw new Error('TIFF curto');
    if (b[0] === 0x49 && b[1] === 0x49) this.le = true;
    else if (b[0] === 0x4d && b[1] === 0x4d) this.le = false;
    else throw new Error('TIFF sem ordem de bytes');
    if (this.u16(2) !== 42) throw new Error('TIFF sem 42');
  }
  check(o: number, n: number) {
    if (o < 0 || o + n > this.b.length) throw new Error('Offset fora do TIFF');
  }
  u16(o: number): number {
    this.check(o, 2);
    const b = this.b;
    return this.le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
  }
  u32(o: number): number {
    this.check(o, 4);
    const b = this.b;
    return this.le
      ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
      : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
  }
  w16(o: number, v: number) {
    this.check(o, 2);
    if (this.le) {
      this.b[o] = v & 255;
      this.b[o + 1] = (v >> 8) & 255;
    } else {
      this.b[o] = (v >> 8) & 255;
      this.b[o + 1] = v & 255;
    }
  }
  w32(o: number, v: number) {
    this.check(o, 4);
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    if (this.le) bytes.reverse();
    this.b.set(bytes, o);
  }
  zero(o: number, n: number) {
    this.check(o, n);
    this.b.fill(0, o, o + n);
  }
  /** Entradas de um IFD: offset da entrada, tag, tipo, contagem. */
  entries(ifd: number) {
    const n = this.u16(ifd);
    this.check(ifd + 2, n * 12 + 4);
    return Array.from({ length: n }, (_, i) => {
      const o = ifd + 2 + i * 12;
      return { o, tag: this.u16(o), type: this.u16(o + 2), count: this.u32(o + 4) };
    });
  }
  nextIfdOffset(ifd: number): number {
    return ifd + 2 + this.u16(ifd) * 12;
  }
  /** Grava um valor SHORT ou LONG no campo de valor de uma entrada. */
  setScalar(e: { o: number; type: number }, v: number) {
    if (e.type === 3) this.w16(e.o + 8, v);
    else if (e.type === 4) this.w32(e.o + 8, v);
  }
}

/** Devolve um TIFF novo ajustado, ou null se o EXIF original for inválido. */
export function sanitizeExif(tiff: Uint8Array, opts: ExifOptions): Uint8Array | null {
  try {
    const t = new Tiff(tiff.slice());
    const ifd0 = t.u32(4);
    const e0 = t.entries(ifd0);

    for (const e of e0) {
      if (e.tag === TAG_ORIENTATION) t.setScalar(e, 1);
      if (e.tag === TAG_EXIF_IFD) {
        for (const x of t.entries(t.u32(e.o + 8))) {
          if (x.tag === TAG_COLOR_SPACE) t.setScalar(x, 0xffff);
          if (x.tag === TAG_PIXEL_X) t.setScalar(x, opts.width);
          if (x.tag === TAG_PIXEL_Y) t.setScalar(x, opts.height);
        }
      }
      if (e.tag === TAG_GPS_IFD && opts.stripLocation) {
        const gps = t.u32(e.o + 8);
        const ge = t.entries(gps);
        for (const g of ge) {
          const size = (TYPE_SIZE[g.type] ?? 1) * g.count;
          if (size > 4) t.zero(t.u32(g.o + 8), size);
        }
        t.zero(gps, 2 + ge.length * 12);
      }
    }

    // IFD1 (miniatura): zera os dados e desliga o encadeamento.
    const nextAt = t.nextIfdOffset(ifd0);
    const ifd1 = t.u32(nextAt);
    if (ifd1) {
      const e1 = t.entries(ifd1);
      const off = e1.find((e) => e.tag === TAG_THUMB_OFFSET);
      const len = e1.find((e) => e.tag === TAG_THUMB_LENGTH);
      if (off && len) t.zero(t.u32(off.o + 8), t.u32(len.o + 8));
      t.w32(nextAt, 0);
    }
    return t.b;
  } catch {
    return null;
  }
}
