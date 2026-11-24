/** Estado do editor (Svelte 5). A interface lê daqui; o motor não conhece a interface. */
import { resolveEffective } from '../engine/layers';
import type { PresetRecipe, Recipe } from '../engine/recipe';
import type { Frame, Renderer } from '../engine/renderer';
import { toUniformData } from '../engine/uniforms';
import { loadPhoto, type Photo } from './photo';
import { loadLut, loadManifest, lutIfLoaded, type Manifest } from './presets';
import { applyPreset, emptyRecipe, fitSize, setUserParam } from './recipe-edit';

export type Level = 'presets' | 'basic';

/** Lado maior das miniaturas dos presets (proxy). */
const THUMB_SIDE = 160;

export class Editor {
  renderer: Renderer | null = null;
  photo = $state.raw<Photo | null>(null);
  recipe = $state.raw<Recipe>(emptyRecipe());
  manifest = $state.raw<Manifest | null>(null);
  pack = $state('cssco');
  level = $state<Level>('presets');
  showOriginal = $state(false);
  thumbs = $state.raw<ReadonlyMap<string, ImageData>>(new Map());
  error = $state<string | null>(null);
  busy = $state(false);
  /** Incrementa quando uma LUT termina de carregar, para re-renderizar. */
  private lutTick = $state(0);
  private thumbJob = 0;

  /** Frame da receita atual (ou do original, enquanto o dedo segura a foto). */
  frame: Frame = $derived.by(() => {
    void this.lutTick;
    return this.frameFor(this.showOriginal ? emptyRecipe() : this.recipe);
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
    return { data: toUniformData(eff), lut };
  }

  async init(): Promise<void> {
    try {
      this.manifest = await loadManifest();
      if (this.manifest.packs.length && !this.manifest.packs.includes(this.pack)) this.pack = this.manifest.packs[0];
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

  async open(file: File): Promise<void> {
    this.error = null;
    this.busy = true;
    try {
      const max = this.renderer?.caps.maxTextureSize ?? 4096;
      const photo = await loadPhoto(file, max);
      this.photo?.bitmap.close();
      this.photo = photo;
      this.recipe = emptyRecipe();
      this.level = 'presets';
      this.thumbs = new Map();
      if (this.renderer) {
        this.renderer.setSource(photo.bitmap);
        void this.renderThumbs();
      }
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.busy = false;
    }
  }

  choosePreset(p: PresetRecipe | null): void {
    if (p && this.recipe.preset?.id === p.id) return;
    this.recipe = applyPreset(this.recipe, p);
  }

  setIntensity(v: number): void {
    this.recipe = { ...this.recipe, intensity: v };
  }

  setParam(path: string, v: number): void {
    this.recipe = setUserParam(this.recipe, path, v);
  }

  /** Miniaturas de todos os presets, renderizadas na própria foto (proxy de ~160 px). */
  async renderThumbs(): Promise<void> {
    const r = this.renderer;
    const photo = this.photo;
    const presets = this.manifest?.presets;
    if (!r || !photo || !presets) return;
    const job = ++this.thumbJob;
    const { w, h } = fitSize(photo.width, photo.height, THUMB_SIDE, THUMB_SIDE, THUMB_SIDE);
    // Pack visível primeiro.
    const ordered = [...presets].sort((a, b) => Number(b.pack === this.pack) - Number(a.pack === this.pack));
    const out = new Map<string, ImageData>();
    for (const p of ordered) {
      if (p.lut) await loadLut(p.lut.src).catch(() => null);
      if (job !== this.thumbJob) return;
      const frame = this.frameFor(applyPreset(emptyRecipe(), p));
      const px = r.read(frame, w, h);
      out.set(p.id, new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), w, h, { colorSpace: 'display-p3' }));
      this.thumbs = new Map(out);
      await new Promise((res) => setTimeout(res, 0));
    }
  }

  /** Miniatura sem preset. */
  originalThumb(): ImageData | null {
    const r = this.renderer;
    const photo = this.photo;
    if (!r || !photo) return null;
    const { w, h } = fitSize(photo.width, photo.height, THUMB_SIDE, THUMB_SIDE, THUMB_SIDE);
    const px = r.read(this.frameFor(emptyRecipe()), w, h);
    return new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), w, h, { colorSpace: 'display-p3' });
  }
}
