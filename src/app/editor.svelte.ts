/** Estado do editor (Svelte 5). A interface lê daqui; o motor não conhece a interface. */
import { cropOutputSize, cropTransform, fullCrop, orientedSize } from '../engine/crop';
import { resolveEffective } from '../engine/layers';
import type { Crop, PresetRecipe, Recipe } from '../engine/recipe';
import type { Frame, Renderer } from '../engine/renderer';
import { toUniformData } from '../engine/uniforms';
import { History } from './history';
import type { Library, PhotoRecord } from './library';
import { LIBRARY_THUMB_SIDE, decodeImage, thumbFromPixels, type Photo } from './photo';
import type { CurveChannel, Curve, HslBand, HslBandShape, PartialParams } from '../engine/params';
import { defaultHslBands } from '../engine/params';
import type { PresetCatalog } from './catalog.svelte';
import { loadLut, lutIfLoaded } from './presets';
import { applyPreset, emptyRecipe, fitSize, flattenRecipe, sliderModel, type SliderTarget } from './recipe-edit';

export type Level = 'presets' | 'basic' | 'advanced';

/** Lado maior das miniaturas dos presets (proxy). */
const THUMB_SIDE = 160;
/** Espera depois da última edição antes de gravar no IndexedDB. */
const SAVE_DELAY_MS = 500;

export class Editor {
  renderer: Renderer | null = null;
  photo = $state.raw<Photo | null>(null);
  recipe = $state.raw<Recipe>(emptyRecipe());
  level = $state<Level>('presets');
  showOriginal = $state(false);
  /** Modo de recorte: mostra a foto inteira (endireitada) com o retângulo por cima. */
  cropping = $state(false);
  thumbs = $state.raw<ReadonlyMap<string, ImageData>>(new Map());
  originalThumb = $state.raw<ImageData | null>(null);
  error = $state<string | null>(null);
  busy = $state(false);
  canUndo = $state(false);
  canRedo = $state(false);
  /** Antes/depois com divisória (nível 3). */
  compare = $state(false);
  /** Editando a receita do preset: guarda a cópia de antes para cancelar. */
  editingPreset = $state.raw<PresetRecipe | null>(null);

  /** Incrementa quando uma LUT termina de carregar, para re-renderizar. */
  private lutTick = $state(0);
  private thumbJob = 0;
  private history: History<Recipe> = new History(emptyRecipe());
  private saveTimer = 0;
  private dirty = false;
  /** Gravação em andamento: fechar a foto espera por ela. */
  private saving: Promise<void> = Promise.resolve();
  /** Só a abertura mais recente vale (toques duplos não abrem duas fotos). */
  private openSeq = 0;

  constructor(
    private library: Library,
    readonly catalog: PresetCatalog,
  ) {}

  /** Quem os sliders editam agora. */
  sliderTarget: SliderTarget = $derived(this.editingPreset ? 'preset' : 'layer');

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

  /** Proporção travada do recorte (largura/altura em pixels), ou livre. Vem da receita. */
  cropAspect = $derived(this.recipe.crop?.aspect ?? null);

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

  attach(renderer: Renderer): void {
    this.renderer = renderer;
    if (this.photo) {
      renderer.setSource(this.photo.bitmap);
      void this.renderThumbs();
    }
  }

  /** Abre uma foto da biblioteca com a receita e o histórico gravados. */
  async open(rec: PhotoRecord): Promise<void> {
    const seq = ++this.openSeq;
    this.error = null;
    this.busy = true;
    let bitmap: ImageBitmap | null = null;
    try {
      await this.close();
      const bytes = new Uint8Array(await rec.original.arrayBuffer());
      bitmap = await decodeImage(rec.original, rec.name, this.renderer?.caps.maxTextureSize ?? 4096);
      const edit = await this.library.loadEdit(rec.id);
      if (seq !== this.openSeq) return; // outra foto foi pedida enquanto esta abria
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
      bitmap = null; // agora pertence a this.photo
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      bitmap?.close();
      if (seq === this.openSeq) this.busy = false;
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

  /** Slider numérico: grava na camada do usuário ou na receita do preset, conforme o modo. */
  setParam(path: string, v: number): void {
    this.commit(sliderModel(this.recipe, path, this.sliderTarget).apply(this.recipe, v), `param:${path}`);
  }

  /** Parâmetros que o modo atual edita (camada do usuário ou receita do preset). */
  private targetParams(): PartialParams {
    return (this.sliderTarget === 'preset' ? this.recipe.preset?.params : this.recipe.user) ?? {};
  }

  private withTargetParams(params: PartialParams): Recipe {
    const r = this.recipe;
    if (this.sliderTarget === 'preset' && r.preset) return { ...r, preset: { ...r.preset, params } };
    return { ...r, user: params };
  }

  /** Curva do modo atual (identidade = sem curva). */
  curve(ch: CurveChannel): Curve | undefined {
    return this.targetParams().curves?.[ch];
  }

  setCurve(ch: CurveChannel, curve: Curve | null, key?: string): void {
    const p = structuredClone(this.targetParams());
    const curves = { ...(p.curves ?? {}) };
    if (curve) curves[ch] = curve;
    else delete curves[ch];
    if (Object.keys(curves).length) p.curves = curves;
    else delete p.curves;
    this.commit(this.withTargetParams(p), key);
  }

  /** Faixas HSL destravadas no modo atual, ou null (8 faixas fixas). */
  hslBands(): Record<HslBand, HslBandShape> | null {
    const own = this.targetParams().hslBands;
    const fromPreset = this.recipe.preset?.params.hslBands;
    const b = own ?? (this.sliderTarget === 'layer' ? fromPreset : undefined);
    return b ? { ...defaultHslBands(), ...(b as Record<HslBand, HslBandShape>) } : null;
  }

  setHslUnlocked(on: boolean): void {
    const p = structuredClone(this.targetParams());
    if (on) p.hslBands = this.hslBands() ?? defaultHslBands();
    else delete p.hslBands;
    this.commit(this.withTargetParams(p));
  }

  setHslBand(band: HslBand, shape: HslBandShape, key?: string): void {
    const p = structuredClone(this.targetParams());
    p.hslBands = { ...(this.hslBands() ?? defaultHslBands()), [band]: shape };
    this.commit(this.withTargetParams(p), key);
  }

  // ---- preset: editar, salvar, achatar

  startEditPreset(): void {
    if (!this.recipe.preset) return;
    this.editingPreset = this.recipe.preset;
    if (this.level === 'presets') this.level = 'basic';
  }

  cancelEditPreset(): void {
    const before = this.editingPreset;
    this.editingPreset = null;
    if (before) this.commit({ ...this.recipe, preset: before });
  }

  /** Salva a receita editada: preset local é atualizado; oficial vira uma cópia "(meu)". */
  async saveEditedPreset(): Promise<void> {
    const p = this.recipe.preset;
    if (!p) return;
    try {
      const saved = await this.catalog.save(p);
      this.editingPreset = null;
      this.commit({ ...this.recipe, preset: structuredClone(saved) });
      void this.renderThumbs(true);
    } catch (e) {
      this.error = `Não foi possível salvar o preset: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /** Funde preset e ajustes nesta foto; os sliders passam a mostrar valores absolutos. */
  flatten(): void {
    this.commit(flattenRecipe(this.recipe));
  }

  /** Salva o visual atual (achatado) como um preset local novo. */
  async saveAsPreset(name: string): Promise<void> {
    const flat = flattenRecipe(this.recipe).preset;
    if (!flat) return;
    try {
      const created = await this.catalog.createFrom(flat, name);
      // A foto passa a usar o preset novo, sem ajustes por cima: mesmo resultado.
      this.commit({ ...this.recipe, preset: structuredClone(created), intensity: 1, user: {}, flattened: false });
      void this.renderThumbs(true);
    } catch (e) {
      this.error = `Não foi possível criar o preset: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /** `key` agrupa um arraste contínuo (ex.: "crop-drag") num passo só. */
  setCrop(crop: Crop, key?: string): void {
    this.commit({ ...this.recipe, crop }, key);
  }

  undo(): void {
    this.travel(this.history.undo());
  }

  redo(): void {
    this.travel(this.history.redo());
  }

  private travel(recipe: Recipe): void {
    const cropChanged = recipe.crop !== this.recipe.crop;
    this.recipe = recipe;
    this.syncHistoryFlags();
    this.scheduleSave();
    // Miniaturas dos presets mostram a foto recortada.
    if (cropChanged && !this.cropping) void this.renderThumbs();
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

  /**
   * Grava receita, histórico e miniatura editada agora. Tudo o que vai ser
   * gravado é capturado antes do primeiro await, para que trocar de foto no
   * meio não grave o estado de uma foto com o id de outra.
   */
  flush(): Promise<void> {
    clearTimeout(this.saveTimer);
    const photo = this.photo;
    if (!this.dirty || !photo) return this.saving;
    this.dirty = false;
    const id = photo.id;
    const recipe = this.recipe;
    const snapshot = this.history.snapshot();
    const thumb = this.libraryThumb(); // lê os pixels já, de forma síncrona
    this.saving = this.saving.then(async () => {
      try {
        await this.library.saveEdit(id, recipe, snapshot, (await thumb) ?? undefined);
      } catch (e) {
        this.error = `Não foi possível salvar: ${e instanceof Error ? e.message : String(e)}`;
      }
    });
    return this.saving;
  }

  private libraryThumb(): Promise<Blob | null> {
    const out = this.outputSize;
    if (!this.renderer || !out) return Promise.resolve(null);
    const { w, h } = fitSize(out.w, out.h, LIBRARY_THUMB_SIDE, LIBRARY_THUMB_SIDE, LIBRARY_THUMB_SIDE);
    return thumbFromPixels(this.renderer.read(this.frameFor(this.recipe), w, h), w, h).catch(() => null);
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

  /**
   * Miniaturas de todos os presets, renderizadas na própria foto (com o
   * recorte), proxy de ~160 px. `onlyMissing`: só as que faltam (preset novo).
   */
  async renderThumbs(onlyMissing = false): Promise<void> {
    const presets = this.catalog.items.map((i) => i.preset);
    const size = this.thumbSize();
    if (!this.renderer || !this.photo || !size) return;
    const job = ++this.thumbJob;
    const { w, h } = size;
    const crop = this.recipe.crop;
    if (!onlyMissing || !this.originalThumb) this.originalThumb = this.renderThumb({ ...emptyRecipe(), crop }, w, h);
    // Pack visível primeiro.
    const pack = this.catalog.pack;
    const ordered = [...presets].sort((a, b) => Number(b.pack === pack) - Number(a.pack === pack));
    const out = new Map<string, ImageData>(onlyMissing ? this.thumbs : []);
    for (const p of ordered) {
      if (out.has(p.id)) continue;
      if (p.lut) await loadLut(p.lut.src).catch(() => null);
      if (job !== this.thumbJob || !this.renderer) return;
      out.set(p.id, this.renderThumb({ ...applyPreset(emptyRecipe(), p), crop }, w, h));
      this.thumbs = new Map(out);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
}
