/**
 * Geometria do recorte e endireitamento.
 *
 * Ordem das transformações da fonte até a saída:
 *   fonte → quartos de volta (horário) → espelho horizontal → endireitar
 *   (rotação em torno do centro) → recorte.
 * O retângulo do recorte é normalizado (0..1) no espaço "endireitado", que
 * tem o tamanho da imagem orientada (W' x H').
 */
import { mulMat3, type Mat3 } from './color';
import type { Crop } from './recipe';

export const MIN_CROP_PX = 32;
export const MAX_STRAIGHTEN = 45;

export function fullCrop(): Crop {
  return { x: 0, y: 0, w: 1, h: 1, angle: 0, quarterTurns: 0, flipH: false };
}

export function isIdentityCrop(c: Crop | undefined): boolean {
  return !c || (c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1 && c.angle === 0 && c.quarterTurns % 4 === 0 && !c.flipH);
}

export function orientedSize(w: number, h: number, quarterTurns: number): { w: number; h: number } {
  return quarterTurns % 2 === 1 ? { w: h, h: w } : { w, h };
}

/** Tamanho da saída recortada, em pixels da fonte. */
export function cropOutputSize(srcW: number, srcH: number, c: Crop | undefined): { w: number; h: number } {
  if (!c) return { w: srcW, h: srcH };
  const o = orientedSize(srcW, srcH, c.quarterTurns);
  return { w: Math.max(1, Math.round(c.w * o.w)), h: Math.max(1, Math.round(c.h * o.h)) };
}

const translate = (x: number, y: number): Mat3 => [1, 0, x, 0, 1, y, 0, 0, 1];
const scale = (x: number, y: number): Mat3 => [x, 0, 0, 0, y, 0, 0, 0, 1];
const rotate = (deg: number): Mat3 => {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // y para baixo: ângulo positivo gira no sentido horário na tela.
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
const compose = (...ms: Mat3[]): Mat3 => ms.reduce((acc, m) => mulMat3(acc, m));

/** Desfaz k quartos de volta horários, em coordenadas normalizadas. */
function undoQuarterTurns(k: number): Mat3 {
  switch (((k % 4) + 4) % 4) {
    case 1:
      return [0, 1, 0, -1, 0, 1, 0, 0, 1]; // s = (r.y, 1 - r.x)
    case 2:
      return [-1, 0, 1, 0, -1, 1, 0, 0, 1]; // s = (1 - r.x, 1 - r.y)
    case 3:
      return [0, -1, 1, 1, 0, 0, 0, 0, 1]; // s = (1 - r.y, r.x)
    default:
      return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }
}

/** Matriz (ordem de linhas) que leva o uv da saída ao uv da fonte. */
export function cropTransform(srcW: number, srcH: number, c: Crop | undefined): Mat3 {
  if (!c) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const o = orientedSize(srcW, srcH, c.quarterTurns);
  return compose(
    undoQuarterTurns(c.quarterTurns),
    c.flipH ? [-1, 0, 1, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, 1, 0, 0, 0, 1],
    scale(1 / o.w, 1 / o.h),
    translate(o.w / 2, o.h / 2),
    rotate(-c.angle),
    translate(-o.w / 2, -o.h / 2),
    // uv da saída -> pixel do espaço endireitado
    translate(c.x * o.w, c.y * o.h),
    scale(c.w * o.w, c.h * o.h),
  );
}

export interface PxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** O retângulo (em pixels do espaço endireitado) cabe na imagem girada por `angle`? */
export function rectInside(W: number, H: number, angle: number, r: PxRect): boolean {
  const a = (angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const eps = 1e-6;
  for (const [x, y] of [
    [r.x, r.y],
    [r.x + r.w, r.y],
    [r.x, r.y + r.h],
    [r.x + r.w, r.y + r.h],
  ]) {
    const dx = x - W / 2;
    const dy = y - H / 2;
    // rotação inversa: volta ao espaço da imagem orientada
    const ox = c * dx + s * dy;
    const oy = -s * dx + c * dy;
    if (Math.abs(ox) > W / 2 + eps || Math.abs(oy) > H / 2 + eps) return false;
  }
  return true;
}

/** Maior retângulo centrado, de proporção `aspect` (largura/altura em px), dentro da imagem girada. */
export function maxCenteredRect(W: number, H: number, angle: number, aspect: number): { w: number; h: number } {
  const a = (angle * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  const hh = Math.min(W / 2 / (aspect * c + s), H / 2 / (aspect * s + c));
  return { w: 2 * hh * aspect, h: 2 * hh };
}

/**
 * Garante que o recorte cabe na foto endireitada e tem um tamanho mínimo:
 * se não couber, encolhe em torno do próprio centro (mantendo a proporção)
 * e, se preciso, aproxima o centro do centro da imagem.
 */
export function constrainCrop(srcW: number, srcH: number, c: Crop): Crop {
  const o = orientedSize(srcW, srcH, c.quarterTurns);
  const minW = Math.min(1, MIN_CROP_PX / o.w);
  const minH = Math.min(1, MIN_CROP_PX / o.h);
  let w = Math.min(1, Math.max(c.w, minW));
  let h = Math.min(1, Math.max(c.h, minH));
  let cx = c.x + c.w / 2;
  let cy = c.y + c.h / 2;
  const toPx = (k: number, t: number): PxRect => {
    const px = (0.5 + (cx - 0.5) * t) * o.w;
    const py = (0.5 + (cy - 0.5) * t) * o.h;
    return { x: px - (w * k * o.w) / 2, y: py - (h * k * o.h) / 2, w: w * k * o.w, h: h * k * o.h };
  };
  const fits = (k: number, t: number) => rectInside(o.w, o.h, c.angle, toPx(k, t));
  if (fits(1, 1)) return w === c.w && h === c.h ? c : { ...c, x: cx - w / 2, y: cy - h / 2, w, h };
  // Primeiro tenta só aproximar o centro; depois encolhe.
  let t = 1;
  if (fits(1, 0)) {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (fits(1, m)) lo = m;
      else hi = m;
    }
    t = lo;
  } else {
    t = 0;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (fits(m, 0)) lo = m;
      else hi = m;
    }
    w *= lo;
    h *= lo;
  }
  cx = 0.5 + (cx - 0.5) * t;
  cy = 0.5 + (cy - 0.5) * t;
  return { ...c, x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * Muda o ângulo de endireitamento: o recorte vira o maior retângulo
 * centrado que cabe, com a mesma proporção em pixels.
 */
export function straightenCrop(srcW: number, srcH: number, c: Crop, angle: number): Crop {
  const a = Math.max(-MAX_STRAIGHTEN, Math.min(MAX_STRAIGHTEN, angle));
  const o = orientedSize(srcW, srcH, c.quarterTurns);
  const aspect = (c.w * o.w) / (c.h * o.h);
  const r = maxCenteredRect(o.w, o.h, a, aspect);
  const w = Math.min(1, r.w / o.w);
  const h = Math.min(1, r.h / o.h);
  return { ...c, angle: a, x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** Recorte de proporção fixa (largura/altura em px), o maior possível, centrado. */
export function aspectCrop(srcW: number, srcH: number, c: Crop, aspect: number): Crop {
  const o = orientedSize(srcW, srcH, c.quarterTurns);
  const r = maxCenteredRect(o.w, o.h, c.angle, aspect);
  const w = Math.min(1, r.w / o.w);
  const h = Math.min(1, r.h / o.h);
  return { ...c, x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

/** Gira 90° no sentido horário, mantendo a região recortada. */
export function rotateCropClockwise(c: Crop): Crop {
  // O retângulo normalizado gira junto: (x, y, w, h) -> (1 - y - h, x, h, w).
  return { ...c, quarterTurns: (c.quarterTurns + 1) % 4, x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w, angle: c.angle };
}

/** Espelha na horizontal, mantendo a região recortada. */
export function flipCrop(c: Crop): Crop {
  return { ...c, flipH: !c.flipH, x: 1 - c.x - c.w, angle: -c.angle };
}

/** O recorte cabe na foto endireitada? */
export function cropFits(srcW: number, srcH: number, c: Crop): boolean {
  const o = orientedSize(srcW, srcH, c.quarterTurns);
  const r = { x: c.x * o.w, y: c.y * o.h, w: c.w * o.w, h: c.h * o.h };
  return r.w >= MIN_CROP_PX - 1e-6 && r.h >= MIN_CROP_PX - 1e-6 && rectInside(o.w, o.h, c.angle, r);
}

/**
 * Durante um arraste: vai de `from` (válido) em direção a `to` até onde o
 * recorte ainda cabe. Assim a alça "encosta" na borda em vez de travar.
 */
export function fitTowards(srcW: number, srcH: number, from: Crop, to: Crop): Crop {
  if (cropFits(srcW, srcH, to)) return to;
  const lerp = (t: number): Crop => ({
    ...to,
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    w: from.w + (to.w - from.w) * t,
    h: from.h + (to.h - from.h) * t,
  });
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const m = (lo + hi) / 2;
    if (cropFits(srcW, srcH, lerp(m))) lo = m;
    else hi = m;
  }
  return lo === 0 ? from : lerp(lo);
}
