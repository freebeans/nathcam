/** Estado do editor (Svelte 5). A interface lê daqui; o motor não conhece a interface. */
import { cropOutputSize, cropTransform, fullCrop, orientedSize } from '../engine/crop';
import { resolveEffective } from '../engine/layers';
import type { Crop, PresetRecipe, Recipe } from '../engine/recipe';
import type { Frame, Renderer } from '../engine/renderer';
import { toUniformData } from '../engine/uniforms';
import { History } from './history';
import type { Library, PhotoRecord } from './library';
import { LIBRARY_THUMB_SIDE, decodeImage, thumbFromPixels, type Photo } from './photo';
import { loadLut, loadManifest, lutIfLoaded, type Manifest } from './presets';
import { applyPreset, emptyRecipe, fitSize, setUserParam } from './recipe-edit';

export type Level = 'presets' | 'basic';

/** Lado maior das miniaturas dos presets (proxy). */
const THUMB_SIDE = 160;
/** Espera depois da última edição antes de gravar no IndexedDB. */
const SAVE_DELAY_MS = 500;

export class Editor {
  renderer: Renderer | null = null;
  photo = $state.raw<Photo | null>(null);
  recipe = $state.raw<Recipe>(emptyRecipe());
  manifest = $state.raw<Manifest | null>(null);
  pack = $state('cssco');
  level = $state<Level>('presets');
  showOriginal = $state(false);
  /** Modo de recorte: mostra a foto inteira (endireitada) com o retângulo por cima. */
  cropping = $state(false);
  /** Proporção travada do recorte (largura/altura em pixels), ou livre. */
  cropAspect = $state<number | null>(null);
  thumbs = $state.raw<ReadonlyMap<string, ImageData>>(new Map());
  originalThumb = $state.raw<ImageData | null>(null);
  error = $state<string | null>(null);
  busy = $state(false);
  canUndo = $state(false);
  canRedo = $state(false);

  /** Incrementa quando uma LUT termina de carregar, para re-renderizar. */
  private lutTick = $state(0);
  private thumbJob = 0;
  private history: History<Recipe> = new History(emptyRecipe());
  private saveTimer = 0;
  private dirty = false;

  constructor(private library: Library) {}

  /** Tamanho da imagem de saída (recortada), em pixels da fonte. */
  outputSize = $derived.by(() => {
    const p = this.photo;
    return p ? cropOutputSize(p.width, p.height, this.recipe.crop) : null;
  });

  /** O que a tela mostra: a saída, ou a foto orientada inteira no modo de recorte. */
  displaySize = $derived.by(() => {
    const p = this.photo;
    if (!p) return null;
    if (this.cropping) return orientedSize(p.width, p.height, this.recipe.crop?.quarterTurns ?? 0);
    return cropOutputSize(p.width, p.height, this.recipe.crop);
  });

  /** Frame da pré-visualização. */
  frame: Frame = $derived.by(() => {
    void this.lutTick;
    let r = this.recipe;
    if (this.showOriginal) r = { ...emptyRecipe(), crop: r.crop };
    if (this.cropping) r = { ...r, crop: { ...(r.crop ?? fullCrop()), x: 0, y: 0, w: 1, h: 1 } };
    return this.frameFor(r);
  });

  presetsInPack: PresetRecipe[] = $derived(this.manifest?.presets.filter((p) => p.pack === this.pack) ?? []);

  frameFor(recipe: Recipe): Frame {
    const eff = resolveEffective(recipe);
    let lut = null;
    if (eff.lut) {
      lut = lutIfLoaded(eff.lut.src);
      if (!lut)
        loadLut(eff.lut.src).then(
          () => this.lutTick++,
          (e) => (this.error = String(e)),
        );
    }
    const p = this.photo;
    const srcXform = p && recipe.crop ? cropTransform(p.width, p.height, recipe.crop) : undefined;
    return { data: toUniformData(eff), lut, srcXform };
  }

  async init(): Promise<void> {
    try {
      this.manifest = await loadManifest();
      if (this.manifest.packs.length && !this.manifest.packs.includes(this.pack)) this.pack = this.manifest.packs[0];
      void this.renderThumbs();
    } catch (e) {
      this.error = String(e);
    }
  }

  attach(renderer: Renderer): void {
    this.renderer = renderer;
    if (this.photo) {
      renderer.setSource(this.photo.bitmap);
      void this.renderThumbs();
    }
  }

  /** Abre uma foto da biblioteca com a receita e o histórico gravados. */
  async open(rec: PhotoRecord): Promise<void> {
    this.error = null;
    this.busy = true;
    try {
      await this.close();
      const bytes = new Uint8Array(await rec.original.arrayBuffer());
      const bitmap = await decodeImage(rec.original, rec.name, this.renderer?.caps.maxTextureSize ?? 4096);
      const edit = await this.library.loadEdit(rec.id);
      this.history = History.restore(edit.history, edit.recipe);
      this.photo = { id: rec.id, name: rec.name, bitmap, bytes, width: bitmap.width, height: bitmap.height };
      this.recipe = this.history.current;
      this.syncHistoryFlags();
      this.level = 'presets';
      this.cropping = false;
      this.thumbs = new Map();
      if (this.renderer) {
        this.renderer.setSource(bitmap);
        void this.renderThumbs();
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
  }

  /** Grava o que estiver pendente e solta a foto. */
  async close(): Promise<void> {
    await this.flush();
    this.photo?.bitmap.close();
    this.photo = null;
    this.cropping = false;
    this.thumbJob++;
  }

  // ---- edição (tudo passa por commit, que alimenta o histórico e a gravação)

  /** `key` identifica o controle: passos seguidos no mesmo controle viram um só no histórico. */
  private commit(recipe: Recipe, key?: string): void {
    this.recipe = recipe;
    this.history.push(recipe, key);
    this.syncHistoryFlags();
    this.scheduleSave();
  }

  choosePreset(p: PresetRecipe | null): void {
    if ((p?.id ?? null) === (this.recipe.preset?.id ?? null)) return;
    this.commit(applyPreset(this.recipe, p));
  }

  setIntensity(v: number): void {
    this.commit({ ...this.recipe, intensity: v }, 'intensity');
  }

  setParam(path: string, v: number): void {
    this.commit(setUserParam(this.recipe, path, v), `param:${path}`);
  }

  /** `key` agrupa um arraste contínuo (ex.: "crop-drag") num passo só. */
  setCrop(crop: Crop, key?: string): void {
    this.commit({ ...this.recipe, crop }, key);
  }

  undo(): void {
    this.recipe = this.history.undo();
    this.syncHistoryFlags();
    this.scheduleSave();
  }

  redo(): void {
    this.recipe = this.history.redo();
    this.syncHistoryFlags();
    this.scheduleSave();
  }

  startCrop(): void {
    this.cropping = true;
    this.showOriginal = false;
  }

  finishCrop(): void {
    this.cropping = false;
    void this.renderThumbs();
  }

  private syncHistoryFlags(): void {
    this.canUndo = this.history.canUndo;
    this.canRedo = this.history.canRedo;
  }

  // ---- persistência

  private scheduleSave(): void {
    this.dirty = true;
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.flush(), SAVE_DELAY_MS);
  }

  /** Grava receita, histórico e miniatura editada agora. */
  async flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    const photo = this.photo;
    if (!this.dirty || !photo) return;
    this.dirty = false;
    try {
      const thumb = await this.libraryThumb();
      await this.library.saveEdit(photo.id, this.recipe, this.history.snapshot(), thumb ?? undefined);
    } catch (e) {
      this.error = `Não foi possível salvar: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private async libraryThumb(): Promise<Blob | null> {
    const out = this.outputSize;
    if (!this.renderer || !out) return null;
    const { w, h } = fitSize(out.w, out.h, LIBRARY_THUMB_SIDE, LIBRARY_THUMB_SIDE, LIBRARY_THUMB_SIDE);
    return thumbFromPixels(this.renderer.read(this.frameFor(this.recipe), w, h), w, h);
  }

  // ---- miniaturas dos presets

  private thumbSize(): { w: number; h: number } | null {
    const out = this.outputSize;
    return out ? fitSize(out.w, out.h, THUMB_SIDE, THUMB_SIDE, THUMB_SIDE) : null;
  }

  private renderThumb(recipe: Recipe, w: number, h: number): ImageData {
    const px = this.renderer!.read(this.frameFor(recipe), w, h);
    return new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), w, h, { colorSpace: 'display-p3' });
  }

  /** Miniaturas de todos os presets, renderizadas na própria foto (com o recorte), proxy de ~160 px. */
  async renderThumbs(): Promise<void> {
    const presets = this.manifest?.presets;
    const size = this.thumbSize();
    if (!this.renderer || !this.photo || !presets || !size) return;
    const job = ++this.thumbJob;
    const { w, h } = size;
    const crop = this.recipe.crop;
    this.originalThumb = this.renderThumb({ ...emptyRecipe(), crop }, w, h);
    // Pack visível primeiro.
    const ordered = [...presets].sort((a, b) => Number(b.pack === this.pack) - Number(a.pack === this.pack));
    const out = new Map<string, ImageData>();
    for (const p of ordered) {
      if (p.lut) await loadLut(p.lut.src).catch(() => null);
      if (job !== this.thumbJob || !this.renderer) return;
      out.set(p.id, this.renderThumb({ ...applyPreset(emptyRecipe(), p), crop }, w, h));
      this.thumbs = new Map(out);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
}
