/**
 * Geometria das regiões renderizadas. Pré-visualização, zoom e exportação
 * renderizam "regiões" da mesma imagem de saída virtual; cada pass precisa de
 * uma margem extra para as operações de vizinhança do pass seguinte.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Radii {
  textureRadius: number;
  textureLod: number;
  clarityRadius: number;
  clarityLod: number;
  sharpenRadius: number;
}

/** Proporções do lado maior da imagem (ver PRD, "Escala"). */
const TEXTURE_RADIUS = 0.003;
const CLARITY_RADIUS = 0.02;
const SHARPEN_RADIUS = 0.0004;

/** Nível de mip cujo texel cobre metade do raio: as amostras a ±r/2 completam o desfoque. */
function lodFor(radius: number): number {
  return Math.max(0, Math.log2(Math.max(radius, 1)) - 1);
}

export function radiiFor(outW: number, outH: number): Radii {
  const s = Math.max(outW, outH);
  const textureRadius = TEXTURE_RADIUS * s;
  const clarityRadius = CLARITY_RADIUS * s;
  return {
    textureRadius,
    textureLod: lodFor(textureRadius),
    clarityRadius,
    clarityLod: lodFor(clarityRadius),
    sharpenRadius: SHARPEN_RADIUS * s,
  };
}

export function expand(r: Rect, m: number): Rect {
  return { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m };
}

function alignOut(r: Rect, g: number): Rect {
  const x0 = Math.floor(r.x / g) * g;
  const y0 = Math.floor(r.y / g) * g;
  const x1 = Math.ceil((r.x + r.w) / g) * g;
  const y1 = Math.ceil((r.y + r.h) / g) * g;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export interface PassPlan {
  a: Rect;
  b: Rect;
  c: Rect;
  /** Grade de alinhamento de A (potência de 2). */
  grid: number;
}

/**
 * Regiões de cada pass para produzir `c`. A é alinhada à grade do maior mip
 * usado no desfoque, para que os blocos de mip coincidam entre tiles: assim
 * uma imagem renderizada em tiles é idêntica à renderizada inteira.
 */
export function planPasses(c: Rect, radii: Radii): PassPlan {
  const b = expand(c, Math.ceil(radii.sharpenRadius) + 2);
  const maxLod = Math.ceil(Math.max(radii.clarityLod, radii.textureLod));
  const grid = 2 ** maxLod;
  const reach = Math.max(radii.clarityRadius, radii.textureRadius) / 2 + 2 * grid;
  const a = alignOut(expand(b, Math.ceil(reach) + 2), grid);
  return { a, b, c, grid };
}

export function tilesFor(w: number, h: number, size: number): Rect[] {
  const out: Rect[] = [];
  for (let y = 0; y < h; y += size)
    for (let x = 0; x < w; x += size) out.push({ x, y, w: Math.min(size, w - x), h: Math.min(size, h - y) });
  return out;
}
