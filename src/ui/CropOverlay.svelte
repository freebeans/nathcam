<script lang="ts">
  import type { Editor } from '../app/editor.svelte';
  import { fitTowards, fullCrop, orientedSize } from '../engine/crop';
  import type { Crop } from '../engine/recipe';

  let { editor, width, height }: { editor: Editor; width: number; height: number } = $props();

  type Mode = 'move' | 'tl' | 'tr' | 'bl' | 'br';

  let crop = $derived(editor.recipe.crop ?? fullCrop());
  let dragging = $state(false);
  let gesture = 0;
  let start: { mode: Mode; px: number; py: number; crop: Crop } | null = null;

  function down(e: PointerEvent, mode: Mode) {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    start = { mode, px: e.clientX, py: e.clientY, crop };
    gesture++;
    dragging = true;
  }

  function move(e: PointerEvent) {
    e.stopPropagation();
    const photo = editor.photo;
    if (!start || !photo) return;
    const s = start.crop;
    const dx = (e.clientX - start.px) / width;
    const dy = (e.clientY - start.py) / height;
    let next: Crop;
    if (start.mode === 'move') {
      next = { ...crop, x: s.x + dx, y: s.y + dy };
    } else {
      // Canto oposto fixo; o arrastado segue o dedo.
      const left = start.mode === 'tl' || start.mode === 'bl';
      const top = start.mode === 'tl' || start.mode === 'tr';
      const fx = left ? s.x + s.w : s.x;
      const fy = top ? s.y + s.h : s.y;
      let w = Math.max(0, left ? fx - (s.x + dx) : s.x + s.w + dx - fx);
      let h = Math.max(0, top ? fy - (s.y + dy) : s.y + s.h + dy - fy);
      const aspect = editor.cropAspect;
      if (aspect) {
        // Proporção em pixels: converte para a normalizada do espaço endireitado.
        const o = orientedSize(photo.width, photo.height, s.quarterTurns);
        const k = (aspect * o.h) / o.w;
        if (w / h > k) h = w / k;
        else w = h * k;
      }
      next = { ...crop, x: left ? fx - w : fx, y: top ? fy - h : fy, w, h };
    }
    editor.setCrop(fitTowards(photo.width, photo.height, crop, next), `crop-drag-${gesture}`);
  }

  function up() {
    start = null;
    dragging = false;
  }
</script>

<div class="overlay" style:width="{width}px" style:height="{height}px">
  <div
    class="rect"
    class:dragging
    style:left="{crop.x * width}px"
    style:top="{crop.y * height}px"
    style:width="{crop.w * width}px"
    style:height="{crop.h * height}px"
    role="presentation"
    onpointerdown={(e) => down(e, 'move')}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    <div class="grid"></div>
    {#each ['tl', 'tr', 'bl', 'br'] as const as corner (corner)}
      <span
        class="handle {corner}"
        role="presentation"
        onpointerdown={(e) => down(e, corner)}
        onpointermove={move}
        onpointerup={up}
        onpointercancel={up}
      ></span>
    {/each}
  </div>
</div>

<style>
  .overlay {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    touch-action: none;
  }
  .rect {
    position: absolute;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.55);
    outline: 1px solid rgba(255, 255, 255, 0.9);
    cursor: move;
    touch-action: none;
  }
  .grid {
    position: absolute;
    inset: 0;
    opacity: 0;
    transition: opacity 0.15s;
    background:
      linear-gradient(to right, transparent calc(33.33% - 0.5px), rgba(255, 255, 255, 0.5) calc(33.33% - 0.5px), rgba(255, 255, 255, 0.5) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255, 255, 255, 0.5) calc(66.66% - 0.5px), rgba(255, 255, 255, 0.5) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px)),
      linear-gradient(to bottom, transparent calc(33.33% - 0.5px), rgba(255, 255, 255, 0.5) calc(33.33% - 0.5px), rgba(255, 255, 255, 0.5) calc(33.33% + 0.5px), transparent calc(33.33% + 0.5px), transparent calc(66.66% - 0.5px), rgba(255, 255, 255, 0.5) calc(66.66% - 0.5px), rgba(255, 255, 255, 0.5) calc(66.66% + 0.5px), transparent calc(66.66% + 0.5px));
    pointer-events: none;
  }
  .dragging .grid {
    opacity: 1;
  }
  .handle {
    position: absolute;
    width: 44px;
    height: 44px;
    touch-action: none;
  }
  .handle::after {
    content: '';
    position: absolute;
    width: 18px;
    height: 18px;
    border: 3px solid #fff;
  }
  .tl {
    left: -14px;
    top: -14px;
    cursor: nwse-resize;
  }
  .tl::after {
    left: 11px;
    top: 11px;
    border-right: none;
    border-bottom: none;
  }
  .tr {
    right: -14px;
    top: -14px;
    cursor: nesw-resize;
  }
  .tr::after {
    right: 11px;
    top: 11px;
    border-left: none;
    border-bottom: none;
  }
  .bl {
    left: -14px;
    bottom: -14px;
    cursor: nesw-resize;
  }
  .bl::after {
    left: 11px;
    bottom: 11px;
    border-right: none;
    border-top: none;
  }
  .br {
    right: -14px;
    bottom: -14px;
    cursor: nwse-resize;
  }
  .br::after {
    right: 11px;
    bottom: 11px;
    border-left: none;
    border-top: none;
  }
</style>
