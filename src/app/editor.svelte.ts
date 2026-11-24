/** Estado do editor (Svelte 5). A interface lê daqui; o motor não conhece a interface. */
import { cropOutputSize, cropTransform, fullCrop, orientedSize } from '../engine/crop';
import { resolveEffective } from '../engine/layers';
import type { Crop, PresetRecipe, Recipe } from '../engine/recipe';
import type { Frame, Renderer } from '../engine/renderer';
import { toUniformData } from '../engine/uniforms';
import { History } from './history';
import type { Library, PhotoRecord } from './library';
import { LIBRARY_THUMB_SIDE, SOURCE_MAX_SIDE, decodeImage, thumbFromPixels, type Photo } from './photo';
import { DEFAULT_EXPORT, exportJpeg, exportSize } from '../export/export';
import type { CurveChannel, Curve, HslBand, HslBandShape, PartialParams } from '../engine/params';
import { defaultHslBands } from '../engine/params';
import type { PresetCatalog } from './catalog.svelte';
import { pasteRecipe, type PasteGroupId } from './paste';
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
  /** Ajustes copiados, prontos para colar nesta ou em outras fotos. */
  copied = $state.raw<Recipe | null>(null);
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

  /** `size`: dimensões da fonte carregada no motor (padrão: a foto aberta). */
  frameFor(recipe: Recipe, size: { width: number; height: number } | null = this.photo): Frame {
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
    const srcXform = size && recipe.crop ? cropTransform(size.width, size.height, recipe.crop) : undefined;
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
      bitmap = await decodeImage(rec.original, rec.name, Math.min(SOURCE_MAX_SIDE, this.renderer?.caps.maxTextureSize ?? 4096));
      const edit = await this.library.loadEdit(rec.id);
      if (seq !== this.openSeq) return; // outra foto foi pedida enquanto esta abria
      this.history = History.restore(edit.history, edit.recipe);
      this.photo = { id: rec.id, name: rec.name, bitmap, bytes, width: bitmap.width, height: bitmap.height };
      this.recipe = this.history.current;
      this.syncHistoryFlags();
      this.level = 'presets';
      this.cropping = false;
      this.compare = false;
      this.editingPreset = null;
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

  // ---- exportação

  /** A foto pode ter mais resolução do que a fonte usada na edição. */
  canExportFull = $derived(!!this.photo && Math.max(this.photo.width, this.photo.height) >= SOURCE_MAX_SIDE);

  /**
   * Exporta a foto aberta. Em resolução total, decodifica o original de novo
   * (até o limite de textura), carrega sem mipmaps, renderiza em tiles com o
   * mesmo motor e devolve a fonte da edição.
   */
  async exportPhoto(
    opts: { quality: number; stripLocation: boolean; full: boolean },
    onProgress?: (f: number) => void,
  ): Promise<{ blob: Blob; width: number; height: number }> {
    const r = this.renderer;
    const photo = this.photo;
    if (!r || !photo) throw new Error('Nenhuma foto aberta.');
    const recipe = this.recipe;
    const base = { quality: opts.quality, stripLocation: opts.stripLocation };
    if (!opts.full || !this.canExportFull) {
      const output = cropOutputSize(photo.width, photo.height, recipe.crop);
      const blob = await exportJpeg(r, this.frameFor(recipe), output, photo.bytes, { ...base, maxSide: DEFAULT_EXPORT.maxSide }, onProgress);
      const s = exportSize(output.w, output.h, DEFAULT_EXPORT.maxSide);
      return { blob, width: s.w, height: s.h };
    }
    const full = await decodeImage(new Blob([photo.bytes as Uint8Array<ArrayBuffer>]), photo.name, r.caps.maxTextureSize);
    try {
      r.setSource(full, { mipmaps: false });
      const output = cropOutputSize(full.width, full.height, recipe.crop);
      const blob = await exportJpeg(r, this.frameFor(recipe, full), output, photo.bytes, { ...base, maxSide: Infinity }, onProgress);
      return { blob, width: output.w, height: output.h };
    } finally {
      full.close();
      r.releaseTargets();
      // A foto pode ter sido trocada enquanto exportava.
      if (this.photo) r.setSource(this.photo.bitmap);
    }
  }

  // ---- copiar e colar

  copy(): void {
    this.copied = structuredClone(this.recipe);
  }

  /** Cola na foto aberta (um passo no histórico). */
  pasteHere(groups: ReadonlySet<PasteGroupId>): void {
    const p = this.photo;
    if (!this.copied || !p) return;
    this.commit(pasteRecipe(this.recipe, this.copied, groups, { w: p.width, h: p.height }));
    void this.renderThumbs();
  }

  /**
   * Cola em várias fotos da biblioteca: cada uma ganha um passo no histórico
   * e a miniatura editada. Usa o motor, então só roda com o editor fechado.
   */
  async pasteInto(recs: PhotoRecord[], groups: ReadonlySet<PasteGroupId>, onProgress?: (done: number) => void): Promise<string[]> {
    const source = this.copied;
    const r = this.renderer;
    if (!source || !r) return [];
    if (this.photo) throw new Error('Feche a foto aberta antes de colar em lote.');
    const errors: string[] = [];
    for (let i = 0; i < recs.length; i++) {
      const rec = recs[i];
      try {
        const edit = await this.library.loadEdit(rec.id);
        const history = History.restore(edit.history, edit.recipe);
        const next = pasteRecipe(history.current, source, groups, { w: rec.width, h: rec.height });
        history.push(next);
        const thumb = await this.renderPhotoThumb(rec, next);
        await this.library.saveEdit(rec.id, next, history.snapshot(), thumb);
      } catch (e) {
        errors.push(`${rec.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
      onProgress?.(i + 1);
    }
    return errors;
  }

  /** Miniatura da biblioteca de uma foto qualquer (carrega uma versão pequena no motor). */
  private async renderPhotoThumb(rec: PhotoRecord, recipe: Recipe): Promise<Blob> {
    const r = this.renderer!;
    const eff = resolveEffective(recipe);
    if (eff.lut) await loadLut(eff.lut.src);
    // Fonte pequena: rápido de decodificar; o recorte é normalizado, então vale igual.
    const bmp = await decodeImage(rec.original, rec.name, LIBRARY_THUMB_SIDE * 2);
    try {
      r.setSource(bmp);
      const out = cropOutputSize(bmp.width, bmp.height, recipe.crop);
      const { w, h } = fitSize(out.w, out.h, LIBRARY_THUMB_SIDE, LIBRARY_THUMB_SIDE, LIBRARY_THUMB_SIDE);
      return await thumbFromPixels(r.read(this.frameFor(recipe, bmp), w, h), w, h);
    } finally {
      bmp.close();
    }
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
    this.editingPreset = null;
    this.commit(applyPreset(this.recipe, p));
  }

  setIntensity(v: number): void {
    this.commit({ ...this.recipe, intensity: v }, 'intensity');
  }

  /** Slider numérico: grava na camada do usuário ou na receita do preset, conforme o modo. */
  setParam(path: string, v: number): void {
    this.commit(sliderModel(this.recipe, path, this.sliderTarget).apply(this.recipe, v), `param:${path}`);
  }

  /**
   * Curvas e faixas HSL não são somas: editando o preset ou com a receita
   * achatada, mexem direto na receita do preset (valor absoluto).
   */
  private get editsPresetStructures(): boolean {
    return !!this.recipe.preset && (this.sliderTarget === 'preset' || !!this.recipe.flattened);
  }

  private targetParams(): PartialParams {
    return (this.editsPresetStructures ? this.recipe.preset?.params : this.recipe.user) ?? {};
  }

  private withTargetParams(params: PartialParams): Recipe {
    const r = this.recipe;
    if (this.editsPresetStructures && r.preset) return { ...r, preset: { ...r.preset, params } };
    return { ...r, user: params };
  }

  /** Faixas destravadas pelo preset (na camada do usuário não dá para travá-las de volta). */
  hslBandsFromPreset = $derived(!this.editsPresetStructures && !!this.recipe.preset?.params.hslBands);

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
    const b = own ?? (this.editsPresetStructures ? undefined : fromPreset);
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
    const editing = this.editingPreset;
    const photoId = this.photo?.id;
    if (!p || !editing) return;
    try {
      const saved = await this.catalog.save(p);
      void this.renderThumbs({ refresh: [saved.id] });
      // A foto ou o modo podem ter mudado enquanto gravava: só atualiza se não.
      if (this.photo?.id !== photoId || this.editingPreset !== editing) return;
      this.editingPreset = null;
      if (this.recipe.preset?.id === p.id) this.commit({ ...this.recipe, preset: structuredClone(saved) });
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
      void this.renderThumbs({ refresh: [created.id] });
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
    if (this.editingPreset && recipe.preset?.id !== this.editingPreset.id) this.editingPreset = null;
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
   * recorte), proxy de ~160 px. Com `onlyMissing` ou `refresh`, mantém as
   * que já existem e renderiza só as que faltam e as pedidas (preset editado).
   */
  async renderThumbs(opts: { onlyMissing?: boolean; refresh?: string[] } = {}): Promise<void> {
    const onlyMissing = !!opts.onlyMissing || !!opts.refresh;
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
    // Só guarda miniaturas de presets que ainda existem.
    const ids = new Set(presets.map((p) => p.id));
    const out = new Map<string, ImageData>(onlyMissing ? [...this.thumbs].filter(([id]) => ids.has(id)) : []);
    for (const id of opts.refresh ?? []) out.delete(id);
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
