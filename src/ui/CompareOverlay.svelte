<script lang="ts">
  import type { Editor } from '../app/editor.svelte';
  import { emptyRecipe } from '../app/recipe-edit';

  /** Antes/depois: o original (sem edição, com o mesmo recorte) à esquerda da divisória. */
  let { editor, w, h, dpr }: { editor: Editor; w: number; h: number; dpr: number } = $props();

  let canvas: HTMLCanvasElement;
  let split = $state(0.5);
  let dragging = false;

  $effect(() => {
    const r = editor.renderer;
    const crop = editor.recipe.crop;
    void editor.photo;
    if (!r || !canvas) return;
    const px = r.read(editor.frameFor({ ...emptyRecipe(), crop }), w, h);
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' });
    ctx?.putImageData(new ImageData(new Uint8ClampedArray(px.buffer as ArrayBuffer), w, h, { colorSpace: 'display-p3' }), 0, 0);
  });

  function move(e: PointerEvent) {
    if (!dragging) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    split = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  }
</script>

<div
  class="compare"
  style:width="{w / dpr}px"
  style:height="{h / dpr}px"
  role="slider"
  aria-label="Antes e depois"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={Math.round(split * 100)}
  tabindex="0"
  onpointerdown={(e) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragging = true;
    move(e);
  }}
  onpointermove={move}
  onpointerup={() => (dragging = false)}
  onpointercancel={() => (dragging = false)}
  onkeydown={(e) => {
    if (e.key === 'ArrowLeft') split = Math.max(0, split - 0.05);
    if (e.key === 'ArrowRight') split = Math.min(1, split + 0.05);
  }}
>
  <canvas bind:this={canvas} style:clip-path="inset(0 {(1 - split) * 100}% 0 0)"></canvas>
  <div class="line" style:left="{split * 100}%"><span class="knob">‹ ›</span></div>
  <span class="tag before">Antes</span>
  <span class="tag after">Depois</span>
</div>

<style>
  .compare {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    touch-action: none;
    cursor: ew-resize;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
  }
  .line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: #fff;
    box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
    pointer-events: none;
  }
  .knob {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: #fff;
    color: #000;
    font-size: 12px;
    padding: 4px 6px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .tag {
    position: absolute;
    top: 8px;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    pointer-events: none;
  }
  .before {
    left: 8px;
  }
  .after {
    right: 8px;
  }
</style>
