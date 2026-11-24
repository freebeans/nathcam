/**
 * Presets locais (criados, copiados ou importados) e suas LUTs, mais as
 * preferências de organização (favoritos, ocultos) — inclusive de presets
 * oficiais. Tudo no IndexedDB.
 */
import type { Lut3D } from '../engine/cube';
import type { LutColorSpace, PresetRecipe } from '../engine/recipe';
import type { PresetPrefs } from '../presets/organize';
import type { Db } from './db';

/** `src` das LUTs guardadas no aparelho. */
export const LOCAL_LUT_PREFIX = 'local:';

export class PresetStore {
  constructor(private db: Db) {}

  async list(): Promise<PresetRecipe[]> {
    const rows = await this.db.presets.orderBy('createdAt').toArray();
    return rows.map(({ createdAt: _, ...p }) => p);
  }

  /** Cria um preset local. Se vier uma LUT, ela é guardada em binário e referenciada. */
  async create(p: Omit<PresetRecipe, 'id'>, newLut?: { lut: Lut3D; colorSpace: LutColorSpace }): Promise<PresetRecipe> {
    const id = crypto.randomUUID();
    let lut = p.lut ?? null;
    if (newLut) {
      const lutId = crypto.randomUUID();
      const l = newLut.lut;
      await this.db.luts.add({
        id: lutId,
        size: l.size,
        domainMin: l.domainMin,
        domainMax: l.domainMax,
        data: l.data.slice().buffer as ArrayBuffer,
      });
      lut = { src: LOCAL_LUT_PREFIX + lutId, colorSpace: newLut.colorSpace };
    }
    const preset: PresetRecipe = { ...structuredClone(p), id, lut };
    await this.db.presets.add({ ...preset, createdAt: Date.now() });
    return preset;
  }

  async update(p: PresetRecipe): Promise<void> {
    await this.db.transaction('rw', this.db.presets, async () => {
      const cur = await this.db.presets.get(p.id);
      if (!cur) throw new Error(`Preset ${p.name} não existe mais.`);
      await this.db.presets.put({ ...structuredClone(p), createdAt: cur.createdAt });
    });
  }

  /** Apaga o preset, suas preferências e a LUT local, se nenhum outro preset a usa. */
  async remove(id: string): Promise<void> {
    await this.db.transaction('rw', this.db.presets, this.db.luts, this.db.presetMeta, async () => {
      const p = await this.db.presets.get(id);
      await this.db.presets.delete(id);
      await this.db.presetMeta.delete(`preset:${id}`);
      const src = p?.lut?.src;
      if (src?.startsWith(LOCAL_LUT_PREFIX)) {
        const stillUsed = (await this.db.presets.toArray()).some((x) => x.lut?.src === src);
        if (!stillUsed) await this.db.luts.delete(src.slice(LOCAL_LUT_PREFIX.length));
      }
    });
  }

  async getLut(src: string): Promise<Lut3D> {
    const rec = await this.db.luts.get(src.slice(LOCAL_LUT_PREFIX.length));
    if (!rec) throw new Error('LUT local não encontrada (o armazenamento pode ter sido apagado).');
    return { size: rec.size, domainMin: rec.domainMin, domainMax: rec.domainMax, data: new Float32Array(rec.data) };
  }

  async prefs(): Promise<PresetPrefs> {
    const rows = await this.db.presetMeta.toArray();
    const pick = (prefix: string, key: 'favorite' | 'hidden') =>
      new Set(rows.filter((r) => r.id.startsWith(prefix) && r[key]).map((r) => r.id.slice(prefix.length)));
    return { favorites: pick('preset:', 'favorite'), hidden: pick('preset:', 'hidden'), hiddenPacks: pick('pack:', 'hidden') };
  }

  setFavorite(presetId: string, on: boolean): Promise<void> {
    return this.setMeta(`preset:${presetId}`, { favorite: on });
  }

  setHidden(presetId: string, on: boolean): Promise<void> {
    return this.setMeta(`preset:${presetId}`, { hidden: on });
  }

  setPackHidden(pack: string, on: boolean): Promise<void> {
    return this.setMeta(`pack:${pack}`, { hidden: on });
  }

  private async setMeta(id: string, patch: { favorite?: boolean; hidden?: boolean }): Promise<void> {
    await this.db.transaction('rw', this.db.presetMeta, async () => {
      const cur = (await this.db.presetMeta.get(id)) ?? { id };
      const next = { ...cur, ...patch };
      if (!next.favorite && !next.hidden) await this.db.presetMeta.delete(id);
      else await this.db.presetMeta.put(next);
    });
  }
}
