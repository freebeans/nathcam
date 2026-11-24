/**
 * Gestão de cor do motor (lado CPU). O espaço de trabalho é Display P3 linear.
 * As mesmas fórmulas existem em GLSL (ver shaders); constantes vêm daqui.
 */

export type Vec3 = readonly [number, number, number];
/** Matriz 3x3 em ordem de linhas. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export function srgbToLinear(v: number): number {
  const a = Math.abs(v);
  const r = a <= 0.04045 ? a / 12.92 : Math.pow((a + 0.055) / 1.055, 2.4);
  return Math.sign(v) * r;
}

export function linearToSrgb(v: number): number {
  const a = Math.abs(v);
  const r = a <= 0.0031308 ? a * 12.92 : 1.055 * Math.pow(a, 1 / 2.4) - 0.055;
  return Math.sign(v) * r;
}

export function mulMat3(a: Mat3, b: Mat3): Mat3 {
  const o: number[] = [];
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) o.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
  return o as unknown as Mat3;
}

export function applyMat3(m: Mat3, v: Vec3): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function invMat3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ];
}

export function diagMat3(v: Vec3): Mat3 {
  return [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]];
}

function xyToXyz(x: number, y: number): Vec3 {
  return [x / y, 1, (1 - x - y) / y];
}

/** Matriz RGB linear -> XYZ a partir das cromaticidades dos primários e do branco. */
export function rgbToXyz(prim: readonly [number, number][], white: [number, number]): Mat3 {
  const [r, g, b] = prim.map(([x, y]) => xyToXyz(x, y));
  const m: Mat3 = [r[0], g[0], b[0], r[1], g[1], b[1], r[2], g[2], b[2]];
  const s = applyMat3(invMat3(m), xyToXyz(white[0], white[1]));
  return mulMat3(m, diagMat3(s));
}

const D65_XY: [number, number] = [0.3127, 0.329];
export const D65_XYZ: Vec3 = xyToXyz(...D65_XY);
/** Branco do PCS do ICC. */
export const D50: Vec3 = [0.9642, 1, 0.8249];

export const P3_TO_XYZ = rgbToXyz(
  [
    [0.68, 0.32],
    [0.265, 0.69],
    [0.15, 0.06],
  ],
  D65_XY,
);
export const SRGB_TO_XYZ = rgbToXyz(
  [
    [0.64, 0.33],
    [0.3, 0.6],
    [0.15, 0.06],
  ],
  D65_XY,
);

export const P3_TO_SRGB = mulMat3(invMat3(SRGB_TO_XYZ), P3_TO_XYZ);
export const SRGB_TO_P3 = mulMat3(invMat3(P3_TO_XYZ), SRGB_TO_XYZ);
export const P3_LUMA: Vec3 = [P3_TO_XYZ[3], P3_TO_XYZ[4], P3_TO_XYZ[5]];

/** Adaptação cromática de Bradford de um branco XYZ para outro. */
export function bradford(src: Vec3, dst: Vec3): Mat3 {
  const M: Mat3 = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];
  const s = applyMat3(M, src);
  const d = applyMat3(M, dst);
  return mulMat3(invMat3(M), mulMat3(diagMat3([d[0] / s[0], d[1] / s[1], d[2] / s[2]]), M));
}

/** Distância (a partir da qual a compressão começa) e expoente da curva. */
export const GAMUT_THRESHOLD = 0.8;
export const GAMUT_POWER = 1.2;

/**
 * Para cada canal, a maior distância ao acromático que um primário P3 atinge
 * quando visto em sRGB linear. É a distância que deve cair exatamente na
 * borda do sRGB.
 */
export function gamutCompressLimits(): [number, number, number] {
  const lim = [1, 1, 1];
  for (const p of [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [1, 1, 0],
    [0, 1, 1],
    [1, 0, 1],
  ] as const) {
    const s = applyMat3(P3_TO_SRGB, p);
    const ach = Math.max(...s);
    s.forEach((c, i) => (lim[i] = Math.max(lim[i], (ach - c) / ach)));
  }
  // Pequena folga para cores além dos primários (ex.: valores HDR).
  return lim.map((l) => l * 1.02) as [number, number, number];
}

function compressDistance(d: number, lim: number): number {
  const t = GAMUT_THRESHOLD;
  const p = GAMUT_POWER;
  if (d < t) return d;
  // Escala tal que `lim` cai em 1.0 (ACES Reference Gamut Compression).
  const s = (lim - t) / Math.pow(Math.pow((1 - t) / (lim - t), -p) - 1, 1 / p);
  const x = (d - t) / s;
  return t + (s * x) / Math.pow(1 + Math.pow(x, p), 1 / p);
}

/**
 * Compressão suave de gama: puxa cores muito saturadas (componentes
 * negativas em sRGB) para dentro, preservando a variação entre elas.
 * Entrada e saída em sRGB linear.
 */
export function gamutCompress(rgb: Vec3, limits: Vec3): [number, number, number] {
  const ach = Math.max(rgb[0], rgb[1], rgb[2]);
  if (ach <= 0) return [rgb[0], rgb[1], rgb[2]];
  return rgb.map((c, i) => {
    const d = (ach - c) / ach;
    return ach - compressDistance(d, limits[i]) * ach;
  }) as [number, number, number];
}
