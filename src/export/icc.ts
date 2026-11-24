/**
 * Gera um perfil ICC v4 "Display P3" (monitor, RGB -> XYZ), equivalente ao
 * perfil que o iOS embute nas fotos: primários P3, branco D65 adaptado ao PCS
 * D50 por Bradford e curva de transferência sRGB.
 */
import { D50, D65_XYZ, P3_TO_XYZ, bradford, mulMat3 } from '../engine/color';

class Writer {
  bytes: number[] = [];
  u8(v: number) {
    this.bytes.push(v & 255);
  }
  u16(v: number) {
    this.bytes.push((v >> 8) & 255, v & 255);
  }
  u32(v: number) {
    this.bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  }
  s15(v: number) {
    this.u32(Math.round(v * 65536) | 0);
  }
  sig(s: string) {
    for (const c of s) this.u8(c.charCodeAt(0));
  }
  pad4() {
    while (this.bytes.length % 4) this.u8(0);
  }
}

function mluc(text: string): number[] {
  const w = new Writer();
  w.sig('mluc');
  w.u32(0);
  w.u32(1); // registros
  w.u32(12); // tamanho do registro
  w.sig('enUS');
  w.u32(text.length * 2);
  w.u32(28);
  for (const c of text) w.u16(c.charCodeAt(0));
  return w.bytes;
}

function xyz(v: readonly number[]): number[] {
  const w = new Writer();
  w.sig('XYZ ');
  w.u32(0);
  for (const c of v) w.s15(c);
  return w.bytes;
}

function srgbCurve(): number[] {
  const w = new Writer();
  w.sig('para');
  w.u32(0);
  w.u16(3); // Y = (aX+b)^g se X >= d; senão cX
  w.u16(0);
  w.s15(2.4);
  w.s15(1 / 1.055);
  w.s15(0.055 / 1.055);
  w.s15(1 / 12.92);
  w.s15(0.04045);
  return w.bytes;
}

function sf32(m: readonly number[]): number[] {
  const w = new Writer();
  w.sig('sf32');
  w.u32(0);
  for (const v of m) w.s15(v);
  return w.bytes;
}

export function buildDisplayP3Icc(): Uint8Array {
  const chad = bradford(D65_XYZ, D50);
  const m = mulMat3(chad, P3_TO_XYZ); // colunas = colorantes adaptados a D50
  const col = (i: number) => [m[i], m[3 + i], m[6 + i]];

  const trc = srgbCurve();
  const tags: [string, number[] | 'rTRC'][] = [
    ['desc', mluc('Display P3')],
    ['cprt', mluc('No copyright, use freely')],
    ['wtpt', xyz(D50)],
    ['rXYZ', xyz(col(0))],
    ['gXYZ', xyz(col(1))],
    ['bXYZ', xyz(col(2))],
    ['rTRC', trc],
    ['gTRC', 'rTRC'],
    ['bTRC', 'rTRC'],
    ['chad', sf32(chad)],
  ];

  // Área de dados: cada tag alinhada em 4 bytes; gTRC/bTRC compartilham rTRC.
  const headerSize = 128;
  const tableSize = 4 + tags.length * 12;
  const data = new Writer();
  const placed = new Map<string, { off: number; size: number }>();
  for (const [sig, body] of tags) {
    if (body === 'rTRC') {
      placed.set(sig, placed.get('rTRC')!);
      continue;
    }
    data.pad4();
    placed.set(sig, { off: headerSize + tableSize + data.bytes.length, size: body.length });
    data.bytes.push(...body);
  }
  data.pad4();
  const total = headerSize + tableSize + data.bytes.length;

  const w = new Writer();
  w.u32(total);
  w.u32(0); // CMM
  w.u32(0x04300000); // versão 4.3
  w.sig('mntr');
  w.sig('RGB ');
  w.sig('XYZ ');
  // data de criação (fixa, para saída determinística)
  for (const v of [2026, 1, 1, 0, 0, 0]) w.u16(v);
  w.sig('acsp');
  w.u32(0); // plataforma
  w.u32(0); // flags
  w.u32(0); // fabricante
  w.u32(0); // modelo
  w.u32(0);
  w.u32(0); // atributos
  w.u32(0); // intenção: perceptual
  for (const v of D50) w.s15(v);
  w.u32(0); // criador
  for (let i = 0; i < 16; i++) w.u8(0); // profile ID (opcional)
  for (let i = 0; i < 28; i++) w.u8(0);

  w.u32(tags.length);
  for (const [sig] of tags) {
    const p = placed.get(sig)!;
    w.sig(sig);
    w.u32(p.off);
    w.u32(p.size);
  }
  w.bytes.push(...data.bytes);
  return new Uint8Array(w.bytes);
}
