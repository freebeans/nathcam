/**
 * Catálogo de presets na interface: oficiais (manifest) + locais (IndexedDB),
 * preferências de organização, busca e importação.
 */
import type { PresetRecipe } from '../engine/recipe';
import { MY_PACK, organize, type Organized, type PresetItem, type PresetPrefs } from '../presets/organize';
import { importPresetFiles, type ImportResult } from './preset-import';
import type { PresetStore } from './preset-store';
import { forgetLut, loadManifest, setLocalLutLoader, type Manifest } from './presets';

export class PresetCatalog {
  manifest = $state.raw<Manifest | null>(null);
  local = $state.raw<PresetRecipe[]>([]);
  prefs = $state.raw<PresetPrefs>({ favorites: new Set(), hidden: new Set(), hiddenPacks: new Set() });
  pack = $state('cssco');
  query = $state('');
  showHidden = $state(false);
  error = $state<string | null>(null);
  lastImport = $state.raw<ImportResult | null>(null);

  constructor(readonly store: PresetStore) {
    setLocalLutLoader((src) => store.getLut(src));
  }

  /** Todos os presets, oficiais primeiro. */
  items: PresetItem[] = $derived([
    ...(this.manifest?.presets ?? []).map((preset) => ({ preset, local: false })),
    ...this.local.map((preset) => ({ preset, local: true })),
  ]);

  organized: Organized = $derived(
    organize(this.items, this.prefs, { packOrder: this.manifest?.packs, query: this.query, showHidden: this.showHidden }),
  );

  /** Presets mostrados agora: resultados da busca ou o pack da aba. */
  shown: PresetItem[] = $derived(this.organized.search ?? this.organized.byPack[this.pack] ?? []);

  /** Packs que existem, inclusive ocultos (para o menu de organização). */
  allPacks: string[] = $derived([...new Set(this.items.map((i) => i.preset.pack))]);

  async init(): Promise<void> {
    try {
      this.manifest = await loadManifest();
    } catch (e) {
      this.error = String(e);
    }
    await this.refreshLocal();
    if (!this.organized.packs.includes(this.pack) && this.organized.packs.length) this.pack = this.organized.packs[0];
  }

  async refreshLocal(): Promise<void> {
    try {
      [this.local, this.prefs] = await Promise.all([this.store.list(), this.store.prefs()]);
    } catch (e) {
      this.error = `Presets locais indisponíveis: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  isLocal(id: string): boolean {
    return this.local.some((p) => p.id === id);
  }

  async import(files: File[]): Promise<ImportResult> {
    const res = await importPresetFiles(files, this.store);
    this.lastImport = res;
    await this.refreshLocal();
    const first = res.created[0];
    if (first) {
      this.query = '';
      this.pack = first.pack;
    }
    return res;
  }

  async toggleFavorite(id: string): Promise<void> {
    await this.store.setFavorite(id, !this.prefs.favorites.has(id));
    await this.refreshLocal();
  }

  async toggleHidden(id: string): Promise<void> {
    await this.store.setHidden(id, !this.prefs.hidden.has(id));
    await this.refreshLocal();
  }

  async togglePackHidden(pack: string): Promise<void> {
    await this.store.setPackHidden(pack, !this.prefs.hiddenPacks.has(pack));
    await this.refreshLocal();
    if (!this.organized.packs.includes(this.pack)) this.pack = this.organized.packs[0] ?? this.pack;
  }

  async remove(id: string): Promise<void> {
    const p = this.local.find((x) => x.id === id);
    await this.store.remove(id);
    if (p?.lut) forgetLut(p.lut.src);
    await this.refreshLocal();
  }

  async rename(id: string, name: string, pack: string): Promise<void> {
    const p = this.local.find((x) => x.id === id);
    if (!p) return;
    await this.store.update({ ...p, name: name.trim() || p.name, pack: pack.trim() || p.pack });
    await this.refreshLocal();
  }

  /**
   * Salva uma receita de preset como preset local. Presets oficiais são
   * somente leitura: salvar a partir deles cria uma cópia "(meu)".
   */
  async save(p: PresetRecipe): Promise<PresetRecipe> {
    if (this.isLocal(p.id)) {
      await this.store.update(p);
      await this.refreshLocal();
      return p;
    }
    const { id: _, ...rest } = p;
    const created = await this.store.create({ ...rest, name: `${p.name} (meu)`, pack: MY_PACK });
    await this.refreshLocal();
    this.pack = MY_PACK;
    return created;
  }

  /** Cria um preset novo a partir de uma receita achatada. */
  async createFrom(p: PresetRecipe, name: string): Promise<PresetRecipe> {
    const { id: _, ...rest } = p;
    const created = await this.store.create({ ...rest, name: name.trim() || 'Sem nome', pack: MY_PACK });
    await this.refreshLocal();
    this.pack = MY_PACK;
    return created;
  }
}
