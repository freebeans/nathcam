import { describe, expect, it } from 'vitest';
import { buildDisplayP3Icc } from './icc';
import { extractExif, insertSegments, readSegments } from './jpeg';
import { sanitizeExif } from './exif';
import { D50 } from '../engine/color';

// ---------- utilitários de teste ----------

function u16(v: number, le: boolean): number[] {
  return le ? [v & 255, v >> 8] : [v >> 8, v & 255];
}
function u32(v: number, le: boolean): number[] {
  const b = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  return le ? b.reverse() : b;
}

interface Entry {
  tag: number;
  type: number;
  count: number;
  value: number[]; // bytes; se > 4, vai para a área de dados
}

/** Monta um TIFF mínimo com IFD0, Exif IFD, GPS IFD e IFD1 (miniatura). */
function buildTiff(le: boolean): Uint8Array {
  const out: number[] = [];
  out.push(...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42, le), ...u32(8, le));
  const ifdSize = (n: number) => 2 + n * 12 + 4;

  // Layout fixo: IFD0 @8 (3 entradas), Exif @ifd0End, GPS depois, IFD1 depois, dados depois.
  const ifd0 = 8;
  const exif = ifd0 + ifdSize(3);
  const gps = exif + ifdSize(2);
  const ifd1 = gps + ifdSize(2);
  const data = ifd1 + ifdSize(2);
  const gpsLat = data; // 3 racionais = 24 bytes
  const thumb = gpsLat + 24; // 16 bytes de "miniatura"
  const total = thumb + 16;

  const writeIfd = (entries: Entry[], next: number) => {
    out.push(...u16(entries.length, le));
    for (const e of entries) {
      out.push(...u16(e.tag, le), ...u16(e.type, le), ...u32(e.count, le));
      const v = [...e.value];
      while (v.length < 4) v.push(0);
      out.push(...v);
    }
    out.push(...u32(next, le));
  };
  const short = (v: number) => u16(v, le);
  const long = (v: number) => u32(v, le);

  writeIfd(
    [
      { tag: 0x0112, type: 3, count: 1, value: short(6) },
      { tag: 0x8769, type: 4, count: 1, value: long(exif) },
      { tag: 0x8825, type: 4, count: 1, value: long(gps) },
    ],
    ifd1,
  );
  writeIfd(
    [
      { tag: 0xa001, type: 3, count: 1, value: short(1) },
      { tag: 0xa002, type: 4, count: 1, value: long(4032) },
    ],
    0,
  );
  writeIfd(
    [
      { tag: 0x0001, type: 2, count: 2, value: [0x4e, 0] }, // "N"
      { tag: 0x0002, type: 5, count: 3, value: long(gpsLat) },
    ],
    0,
  );
  writeIfd(
    [
      { tag: 0x0201, type: 4, count: 1, value: long(thumb) },
      { tag: 0x0202, type: 4, count: 1, value: long(16) },
    ],
    0,
  );
  for (let i = 0; i < 24; i++) out.push(0x40 + i); // coordenadas
  for (let i = 0; i < 16; i++) out.push(0xaa); // miniatura
  expect(out.length).toBe(total);
  return new Uint8Array(out);
}

function readU16(b: Uint8Array, o: number, le: boolean) {
  return le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
}
function readU32(b: Uint8Array, o: number, le: boolean) {
  return le
    ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}
function entries(b: Uint8Array, ifd: number, le: boolean) {
  const n = readU16(b, ifd, le);
  return Array.from({ length: n }, (_, i) => {
    const o = ifd + 2 + i * 12;
    return { tag: readU16(b, o, le), type: readU16(b, o + 2, le), valueOffset: o + 8, value32: readU32(b, o + 8, le) };
  });
}

function fakeJpeg(segments: Uint8Array[]): Uint8Array {
  const parts = [new Uint8Array([0xff, 0xd8]), ...segments, new Uint8Array([0xff, 0xda, 0, 2, 1, 2, 3, 0xff, 0xd9])];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function segment(marker: number, payload: Uint8Array): Uint8Array {
  const s = new Uint8Array(4 + payload.length);
  s[0] = 0xff;
  s[1] = marker;
  s[2] = (payload.length + 2) >> 8;
  s[3] = (payload.length + 2) & 255;
  s.set(payload, 4);
  return s;
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0, 0];

// ---------- testes ----------

describe('perfil ICC Display P3', () => {
  const icc = buildDisplayP3Icc();
  const dv = new DataView(icc.buffer, icc.byteOffset, icc.byteLength);
  const s15 = (o: number) => dv.getInt32(o) / 65536;
  const tag = (sig: string) => {
    const n = dv.getUint32(128);
    for (let i = 0; i < n; i++) {
      const o = 132 + i * 12;
      if (String.fromCharCode(...icc.slice(o, o + 4)) === sig) return { off: dv.getUint32(o + 4), size: dv.getUint32(o + 8) };
    }
    throw new Error(`tag ${sig} ausente`);
  };

  it('cabeçalho válido: tamanho, assinatura, classe monitor, RGB -> XYZ, v4', () => {
    expect(dv.getUint32(0)).toBe(icc.length);
    expect(String.fromCharCode(...icc.slice(36, 40))).toBe('acsp');
    expect(String.fromCharCode(...icc.slice(12, 16))).toBe('mntr');
    expect(String.fromCharCode(...icc.slice(16, 20))).toBe('RGB ');
    expect(String.fromCharCode(...icc.slice(20, 24))).toBe('XYZ ');
    expect(icc[8]).toBe(4);
  });

  it('tem as tags obrigatórias e o nome "Display P3"', () => {
    for (const t of ['desc', 'cprt', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC', 'chad']) tag(t);
    const d = tag('desc');
    const text = new TextDecoder('utf-16be').decode(icc.slice(d.off + 28, d.off + d.size));
    expect(text).toBe('Display P3');
  });

  it('colorantes somam o branco D50 (perfil adaptado ao PCS)', () => {
    const sum = [0, 0, 0];
    for (const t of ['rXYZ', 'gXYZ', 'bXYZ']) {
      const { off } = tag(t);
      for (let c = 0; c < 3; c++) sum[c] += s15(off + 8 + c * 4);
    }
    sum.forEach((v, i) => expect(v).toBeCloseTo(D50[i], 3));
    const r = tag('rXYZ').off;
    expect(s15(r + 8)).toBeCloseTo(0.5151, 3); // valor do perfil Display P3 da Apple
  });

  it('tags começam alinhadas em 4 bytes', () => {
    for (const t of ['desc', 'wtpt', 'rTRC', 'chad']) expect(tag(t).off % 4).toBe(0);
  });
});

describe('segmentos JPEG', () => {
  const tiff = buildTiff(true);
  const exifSeg = segment(0xe1, new Uint8Array([...EXIF_HEADER, ...tiff]));
  const app0 = segment(0xe0, new Uint8Array([0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]));
  const src = fakeJpeg([app0, exifSeg]);

  it('lê os segmentos até o SOS', () => {
    expect(readSegments(src).map((s) => s.marker)).toEqual([0xe0, 0xe1]);
  });

  it('extrai o TIFF do EXIF', () => {
    expect(extractExif(src)).toEqual(tiff);
  });

  it('sem EXIF devolve null', () => {
    expect(extractExif(fakeJpeg([app0]))).toBeNull();
  });

  it('insere EXIF e ICC logo após o JFIF, removendo EXIF/ICC antigos', () => {
    const icc = buildDisplayP3Icc();
    const out = insertSegments(src, { exif: tiff, icc });
    const segs = readSegments(out);
    expect(segs.map((s) => s.marker)).toEqual([0xe0, 0xe1, 0xe2]);
    const iccSeg = segs[2];
    expect(new TextDecoder().decode(iccSeg.payload.slice(0, 11))).toBe('ICC_PROFILE');
    expect(iccSeg.payload.slice(14)).toEqual(icc);
    // o fim do arquivo (dados de imagem) é preservado
    expect(out.slice(-9)).toEqual(src.slice(-9));
  });
});

describe('sanitizeExif', () => {
  for (const le of [true, false]) {
    describe(le ? 'little-endian' : 'big-endian', () => {
      const tiff = buildTiff(le);
      const out = sanitizeExif(tiff, { stripLocation: true, width: 2048, height: 1536 })!;
      const ifd0 = readU32(out, 4, le);
      const e0 = entries(out, ifd0, le);

      it('não altera o original', () => {
        expect(readU16(tiff, entries(tiff, 8, le)[0].valueOffset, le)).toBe(6);
      });

      it('orientação vira 1 (a imagem exportada já está girada)', () => {
        const o = e0.find((e) => e.tag === 0x0112)!;
        expect(readU16(out, o.valueOffset, le)).toBe(1);
      });

      it('remove a localização: GPS IFD vazio e coordenadas zeradas', () => {
        const gps = e0.find((e) => e.tag === 0x8825)!.value32;
        expect(readU16(out, gps, le)).toBe(0);
        const gpsData = 8 + (2 + 36 + 4) + (2 + 24 + 4) * 3;
        expect(Array.from(out.slice(gpsData, gpsData + 24)).every((b) => b === 0)).toBe(true);
      });

      it('espaço de cor "não calibrado" (P3) e dimensões novas no Exif IFD', () => {
        const exif = e0.find((e) => e.tag === 0x8769)!.value32;
        const ee = entries(out, exif, le);
        expect(readU16(out, ee.find((e) => e.tag === 0xa001)!.valueOffset, le)).toBe(0xffff);
        expect(ee.find((e) => e.tag === 0xa002)!.value32).toBe(2048);
      });

      it('descarta a miniatura antiga (IFD1)', () => {
        const nextOffset = ifd0 + 2 + e0.length * 12;
        expect(readU32(out, nextOffset, le)).toBe(0);
        expect(Array.from(out.slice(-16)).every((b) => b === 0)).toBe(true);
      });
    });
  }

  it('mantém o GPS quando pedido', () => {
    const tiff = buildTiff(true);
    const out = sanitizeExif(tiff, { stripLocation: false, width: 1, height: 1 })!;
    const gps = entries(out, 8, true).find((e) => e.tag === 0x8825)!.value32;
    expect(readU16(out, gps, true)).toBe(2);
  });

  it('TIFF inválido devolve null em vez de quebrar', () => {
    expect(sanitizeExif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), { stripLocation: true, width: 1, height: 1 })).toBeNull();
    const t = buildTiff(true);
    t[4] = 0xff; // offset do IFD0 fora do arquivo
    t[5] = 0xff;
    expect(sanitizeExif(t, { stripLocation: true, width: 1, height: 1 })).toBeNull();
  });
});
