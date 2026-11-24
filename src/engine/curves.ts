import type { Curve, CurveChannel } from './params';

export const CURVE_LUT_SIZE = 256;

/**
 * Avalia uma curva por interpolação cúbica monotônica (Fritsch–Carlson):
 * passa pelos pontos e não ultrapassa os valores vizinhos.
 */
export function evalCurve(curve: Curve, x: number): number {
  const pts = [...curve].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  if (n === 0) return x;
  if (x <= pts[0][0]) return pts[0][1];
  if (x >= pts[n - 1][0]) return pts[n - 1][1];
  const tangents = monotoneTangents(pts);
  let i = 0;
  while (i < n - 2 && x > pts[i + 1][0]) i++;
  const [x0, y0] = pts[i];
  const [x1, y1] = pts[i + 1];
  const h = x1 - x0;
  if (h <= 0) return y1;
  const t = (x - x0) / h;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * tangents[i] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * tangents[i + 1]
  );
}

function monotoneTangents(pts: readonly (readonly [number, number])[]): number[] {
  const n = pts.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = pts[i + 1][0] - pts[i][0];
    d.push(h > 0 ? (pts[i + 1][1] - pts[i][1]) / h : 0);
  }
  const m: number[] = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const tau = 3 / Math.sqrt(s);
      m[i] = tau * a * d[i];
      m[i + 1] = tau * b * d[i];
    }
  }
  return m;
}

function applyLayers(layers: readonly Curve[], x: number): number {
  let y = x;
  for (const c of layers) y = evalCurve(c, y);
  return y;
}

/**
 * Assa as curvas numa tabela RGBA de 256 entradas (Float32): para cada canal,
 * aplica as camadas de luminância e depois as do canal.
 */
export function bakeCurves(layers: Record<CurveChannel, readonly Curve[]>): Float32Array {
  const out = new Float32Array(CURVE_LUT_SIZE * 4);
  for (let i = 0; i < CURVE_LUT_SIZE; i++) {
    const x = i / (CURVE_LUT_SIZE - 1);
    const l = applyLayers(layers.luma, x);
    out[i * 4] = applyLayers(layers.red, l);
    out[i * 4 + 1] = applyLayers(layers.green, l);
    out[i * 4 + 2] = applyLayers(layers.blue, l);
    out[i * 4 + 3] = 1;
  }
  return out;
}
