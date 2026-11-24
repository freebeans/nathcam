import type { PartialParams } from '../engine/params';
import type { PresetLut, PresetRecipe } from '../engine/recipe';

/** Preset como aparece num arquivo do repositório (pode usar `extends`). */
export interface PresetFile {
  id: string;
  name: string;
  pack: string;
  extends?: string | null;
  params: PartialParams;
  lut?: PresetLut | null;
  engineVersion: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Mescla profunda: objetos se combinam, valores e arrays (curvas) substituem. */
function deepMerge<T>(parent: T, child: T): T {
  if (!isPlainObject(parent) || !isPlainObject(child)) return (child === undefined ? parent : child) as T;
  const out: Record<string, unknown> = { ...parent };
  for (const [k, v] of Object.entries(child)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

/**
 * Resolve a herança viva (`extends`) dos presets do repositório e devolve
 * receitas achatadas, na mesma ordem da entrada.
 */
export function resolvePresets(files: readonly PresetFile[]): PresetRecipe[] {
  const byId = new Map<string, PresetFile>();
  for (const f of files) {
    if (byId.has(f.id)) throw new Error(`Preset com id repetido: ${f.id}`);
    byId.set(f.id, f);
  }

  const resolved = new Map<string, PresetRecipe>();
  const visiting = new Set<string>();

  function resolve(id: string): PresetRecipe {
    const done = resolved.get(id);
    if (done) return done;
    const f = byId.get(id)!;
    if (visiting.has(id)) throw new Error(`Ciclo de herança envolvendo o preset ${id}`);
    visiting.add(id);

    let params = f.params ?? {};
    let lut = f.lut;
    if (f.extends) {
      if (!byId.has(f.extends)) throw new Error(`Preset ${id} estende ${f.extends}, que não existe`);
      const parent = resolve(f.extends);
      params = deepMerge(parent.params, params);
      if (lut === undefined) lut = parent.lut;
    }
    visiting.delete(id);

    const out: PresetRecipe = {
      id: f.id,
      name: f.name,
      pack: f.pack,
      params,
      lut: lut ?? null,
      engineVersion: f.engineVersion,
    };
    resolved.set(id, out);
    return out;
  }

  return files.map((f) => resolve(f.id));
}
