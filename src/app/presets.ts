/** Presets oficiais (manifest gerado no build) e cache de LUTs. */
import { parseCube, type Lut3D } from '../engine/cube';
import type { PresetRecipe } from '../engine/recipe';

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

/** Carrega (uma vez) a LUT de um preset. */
export function loadLut(src: string): Promise<Lut3D> {
  let p = luts.get(src);
  if (!p) {
    p = fetch(`${base}${src}`)
      .then((r) => {
        if (!r.ok) throw new Error(`LUT ${src}: ${r.status}`);
        return r.text();
      })
      .then((t) => {
        const lut = parseCube(t);
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
