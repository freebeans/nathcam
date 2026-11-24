/**
 * Importação de presets: `.json` próprio (validado), HaldCLUT e utilidades
 * de LUT. `.cube` usa o parser do motor; `.xmp` está em `./xmp`.
 */
import type { Lut3D } from '../engine/cube';
import {
  CURVE_CHANNELS,
  HSL_BANDS,
  NUMERIC_PARAMS,
  clampParam,
  getPath,
  setPath,
  type PartialParams,
} from '../engine/params';
import type { PresetLut } from '../engine/recipe';

/** Lado máximo das LUTs guardadas no aparelho (memória e IndexedDB). */
export const MAX_LUT_SIZE = 65;

/** Trilinear: reamostra a LUT para `n` pontos por eixo. */
export function resampleLut(lut: Lut3D, n: number): Lut3D {
  const s = lut.size;
  const d = lut.data;
  const out = new Float32Array(n * n * n * 3);
  const idx = (r: number, g: number, b: number) => (r + g * s + b * s * s) * 3;
  for (let b = 0; b < n; b++)
    for (let g = 0; g < n; g++)
      for (let r = 0; r < n; r++) {
        const f = [r, g, b].map((v) => (v / (n - 1)) * (s - 1));
        const i0 = f.map((v) => Math.min(Math.floor(v), s - 2));
        const t = f.map((v, k) => v - i0[k]);
        for (let c = 0; c < 3; c++) {
          let acc = 0;
          for (let corner = 0; corner < 8; corner++) {
            const dr = corner & 1;
            const dg = (corner >> 1) & 1;
            const db = (corner >> 2) & 1;
            const w = (dr ? t[0] : 1 - t[0]) * (dg ? t[1] : 1 - t[1]) * (db ? t[2] : 1 - t[2]);
            if (w) acc += w * d[idx(i0[0] + dr, i0[1] + dg, i0[2] + db) + c];
          }
          out[(r + g * n + b * n * n) * 3 + c] = acc;
        }
      }
  return { ...lut, size: n, data: out };
}

/**
 * Converte os pixels (RGBA 8 bits) de uma imagem HaldCLUT numa LUT 3D.
 * Uma Hald de nível L é um quadrado de L³ x L³ pixels e codifica um cubo de
 * lado L², com o vermelho variando mais rápido.
 */
export function haldToLut(px: Uint8Array | Uint8ClampedArray, width: number, height: number): Lut3D {
  const level = Math.round(Math.cbrt(width));
  if (width !== height || level ** 3 !== width || level < 2)
    throw new Error(`A imagem (${width}x${height}) não é uma HaldCLUT: esperado um quadrado de L³ pixels de lado.`);
  const n = level * level;
  const data = new Float32Array(n * n * n * 3);
  for (let i = 0; i < n * n * n; i++) {
    data[i * 3] = px[i * 4] / 255;
    data[i * 3 + 1] = px[i * 4 + 1] / 255;
    data[i * 3 + 2] = px[i * 4 + 2] / 255;
  }
  const lut: Lut3D = { size: n, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data };
  return n > MAX_LUT_SIZE ? resampleLut(lut, MAX_LUT_SIZE) : lut;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Caminhos das folhas de um objeto (arrays e objetos vazios contam como folha). */
function leaves(v: unknown, prefix = ''): string[] {
  if (!isObject(v) || Object.keys(v).length === 0) return prefix ? [prefix] : [];
  return Object.entries(v).flatMap(([k, x]) => leaves(x, prefix ? `${prefix}.${k}` : k));
}

function validCurve(c: unknown): c is [number, number][] {
  return (
    Array.isArray(c) &&
    c.length >= 2 &&
    c.every((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && x >= 0 && x <= 1))
  );
}

/**
 * Valida parâmetros vindos de fora: só passa o que o motor conhece, com o
 * tipo certo, limitado às faixas. O resto é listado em `ignored`.
 */
export function sanitizeParams(raw: unknown): { params: PartialParams; ignored: string[] } {
  const params: Record<string, unknown> = {};
  const used = new Set<string>();
  for (const s of NUMERIC_PARAMS) {
    const v = getPath(raw, s.path);
    if (typeof v === 'number' && Number.isFinite(v)) {
      setPath(params, s.path, clampParam(s, v));
      used.add(s.path);
    }
  }
  for (const ch of CURVE_CHANNELS) {
    const c = getPath(raw, `curves.${ch}`);
    if (validCurve(c)) {
      setPath(params, `curves.${ch}`, c.map(([x, y]) => [x, y]));
      used.add(`curves.${ch}`);
    }
  }
  for (const b of HSL_BANDS) {
    const shape = getPath(raw, `hslBands.${b}`);
    if (!isObject(shape)) continue;
    const { center, width, softness } = shape;
    if ([center, width, softness].every((x) => typeof x === 'number' && Number.isFinite(x))) {
      setPath(params, `hslBands.${b}`, {
        center: (((center as number) % 360) + 360) % 360,
        width: Math.min(180, Math.max(1, width as number)),
        softness: Math.min(1, Math.max(0, softness as number)),
      });
      for (const k of ['center', 'width', 'softness']) used.add(`hslBands.${b}.${k}`);
    }
  }
  const ignored = leaves(raw).filter((p) => !used.has(p));
  return { params: params as PartialParams, ignored };
}

export interface ImportedPreset {
  name: string;
  pack?: string;
  params: PartialParams;
  lut: PresetLut | null;
  ignored: string[];
}

/** Lê um preset `.json` no formato próprio (ver PRD, "Presets"). */
export function parsePresetJson(text: string, fileName: string): ImportedPreset {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error(`${fileName}: JSON inválido.`);
  }
  if (!isObject(raw)) throw new Error(`${fileName}: JSON inválido.`);
  if (raw.extends) throw new Error(`${fileName}: presets com extends só valem no repositório; salve a receita achatada.`);
  if (!isObject(raw.params)) throw new Error(`${fileName}: falta o campo params.`);
  let lut: PresetLut | null = null;
  if (raw.lut) {
    const l = raw.lut as Record<string, unknown>;
    const ok = typeof l.src === 'string' && /^luts\/[\w.-]+\.cube$/.test(l.src) && (l.colorSpace === 'srgb' || l.colorSpace === 'display-p3');
    if (!ok) throw new Error(`${fileName}: LUT inválida (só LUTs oficiais, em luts/*.cube, podem ser referenciadas).`);
    lut = { src: l.src as string, colorSpace: l.colorSpace as PresetLut['colorSpace'] };
  }
  const { params, ignored } = sanitizeParams(raw.params);
  return {
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : fileName.replace(/\.json$/i, ''),
    pack: typeof raw.pack === 'string' && raw.pack.trim() ? raw.pack.trim() : undefined,
    params,
    lut,
    ignored,
  };
}
