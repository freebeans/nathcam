/** Presets oficiais (manifest gerado no build) e cache de LUTs. */
import { parseCube, type Lut3D } from '../engine/cube';
import type { PresetRecipe } from '../engine/recipe';
import { LOCAL_LUT_PREFIX } from './preset-store';

export interface Manifest {
  packs: string[];
  presets: PresetRecipe[];
}

const base = import.meta.env.BASE_URL;

export async function loadManifest(): Promise<Manifest> {
  const res = await fetch(`${base}presets/manifest.json`);
  if (!res.ok) throw new Error(`Falha ao carregar presets (${res.status})`);
  return (await res.json()) as Manifest;
}

const luts = new Map<string, Promise<Lut3D>>();
const loaded = new Map<string, Lut3D>();
let localLoader: ((src: string) => Promise<Lut3D>) | null = null;

/** Onde buscar LUTs `local:` (guardadas no aparelho). */
export function setLocalLutLoader(loader: (src: string) => Promise<Lut3D>): void {
  localLoader = loader;
}

function fetchLut(src: string): Promise<Lut3D> {
  if (src.startsWith(LOCAL_LUT_PREFIX)) {
    if (!localLoader) return Promise.reject(new Error('LUTs locais indisponíveis'));
    return localLoader(src);
  }
  return fetch(`${base}${src}`).then((r) => {
    if (!r.ok) throw new Error(`LUT ${src}: ${r.status}`);
    return r.text().then(parseCube);
  });
}

/** Carrega (uma vez) a LUT de um preset, oficial ou local. */
export function loadLut(src: string): Promise<Lut3D> {
  let p = luts.get(src);
  if (!p) {
    p = fetchLut(src).then((lut) => {
      loaded.set(src, lut);
      return lut;
    });
    p.catch(() => luts.delete(src));
    luts.set(src, p);
  }
  return p;
}

/** LUT já carregada, ou null. */
export function lutIfLoaded(src: string): Lut3D | null {
  return loaded.get(src) ?? null;
}

/** Esquece uma LUT (ex.: preset local apagado). */
export function forgetLut(src: string): void {
  luts.delete(src);
  loaded.delete(src);
}
