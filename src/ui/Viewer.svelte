<script lang="ts">
  import { onMount } from 'svelte';
  import { Renderer } from '../engine/renderer';
  import type { Editor } from '../app/editor.svelte';
  import { fitSize } from '../app/recipe-edit';
  import CropOverlay from './CropOverlay.svelte';
  import CompareOverlay from './CompareOverlay.svelte';

  let { editor }: { editor: Editor } = $props();

  let box: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let boxW = $state(0);
  let boxH = $state(0);
  let dpr = $state(window.devicePixelRatio || 1);
  let ready = $state(false);

  /** Lado maior máximo da pré-visualização (memória do Safari iOS). */
  const PREVIEW_MAX_SIDE = 2048;

  /** Folga em volta da foto no modo de recorte, para as alças não ficarem na borda da tela. */
  const CROP_MARGIN = 24;

  let size = $derived.by(() => {
    const d = editor.displaySize;
    if (!d || !boxW || !boxH) return null;
    const m = editor.cropping ? CROP_MARGIN * 2 : 0;
    return fitSize(d.w, d.h, (boxW - m) * dpr, (boxH - m) * dpr, PREVIEW_MAX_SIDE);
  });

  onMount(() => {
    try {
      editor.attach(new Renderer(canvas));
      ready = true;
    } catch (e) {
      editor.error = e instanceof Error ? e.message : String(e);
    }
    // O iOS pode descartar o contexto WebGL em segundo plano: recria o motor.
    const lost = (e: Event) => {
      e.preventDefault();
      ready = false;
    };
    const restored = () => {
      editor.attach(new Renderer(canvas));
      ready = true;
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    const ro = new ResizeObserver(([entry]) => {
      boxW = entry.contentRect.width;
      boxH = entry.contentRect.height;
      dpr = window.devicePixelRatio || 1;
    });
    ro.observe(box);
    return () => {
      ro.disconnect();
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
      editor.renderer?.dispose();
      editor.renderer = null;
    };
  });

  // Uma renderização por quadro, com o estado mais recente.
  let pending = 0;
  $effect(() => {
    const frame = editor.frame;
    const s = size;
    void editor.photo;
    // Com a fonte trocada (exportação em resolução total), não desenha.
    if (!ready || !s || !editor.photo || editor.sourceSwapped) return;
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      try {
        editor.renderer?.draw(frame, s.w, s.h);
      } catch (e) {
        editor.error = e instanceof Error ? e.message : String(e);
      }
    });
  });

  /** Tempo que o dedo precisa ficar na foto para mostrar o original (um toque rápido não pisca). */
  const HOLD_MS = 250;
  /** Movimento que cancela o "segurar" (o dedo está arrastando, não segurando). */
  const HOLD_SLOP_PX = 10;
  let holdTimer = 0;
  let holdStart: { x: number; y: number } | null = null;

  function startHold(e: PointerEvent) {
    if (editor.cropping) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    holdStart = { x: e.clientX, y: e.clientY };
    clearTimeout(holdTimer);
    holdTimer = window.setTimeout(() => (editor.showOriginal = true), HOLD_MS);
  }

  function moveHold(e: PointerEvent) {
    if (holdStart && !editor.showOriginal && Math.hypot(e.clientX - holdStart.x, e.clientY - holdStart.y) > HOLD_SLOP_PX)
      endHold();
  }

  function endHold() {
    clearTimeout(holdTimer);
    holdStart = null;
    editor.showOriginal = false;
  }
</script>

<div class="viewer" bind:this={box}>
  <canvas
    bind:this={canvas}
    class:hidden={!editor.photo}
    style:width={size ? `${size.w / dpr}px` : '0'}
    style:height={size ? `${size.h / dpr}px` : '0'}
    onpointerdown={startHold}
    onpointermove={moveHold}
    onpointerup={endHold}
    onpointercancel={endHold}
    oncontextmenu={(e) => e.preventDefault()}
    aria-label="Foto. Segure para ver o original."
  ></canvas>
  {#if editor.cropping && size}
    <CropOverlay {editor} width={size.w / dpr} height={size.h / dpr} />
  {/if}
  {#if editor.compare && editor.level === 'advanced' && !editor.cropping && size}
    <CompareOverlay {editor} w={size.w} h={size.h} {dpr} />
  {/if}
  {#if editor.showOriginal}
    <span class="badge">Original</span>
  {/if}
</div>

<style>
  .viewer {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  canvas {
    display: block;
    touch-action: none;
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .hidden {
    visibility: hidden;
  }
  .badge {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.6);
    color: #fff;
    font-size: 12px;
    padding: 4px 10px;
    border-radius: 999px;
    pointer-events: none;
  }
</style>
