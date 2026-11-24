<script lang="ts">
  import { onMount } from 'svelte';
  import { Renderer } from '../engine/renderer';
  import type { Editor } from '../app/editor.svelte';
  import { fitSize } from '../app/recipe-edit';

  let { editor }: { editor: Editor } = $props();

  let box: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let boxW = $state(0);
  let boxH = $state(0);
  let dpr = $state(window.devicePixelRatio || 1);
  let ready = $state(false);

  /** Lado maior máximo da pré-visualização (memória do Safari iOS). */
  const PREVIEW_MAX_SIDE = 2048;

  let size = $derived.by(() => {
    const p = editor.photo;
    if (!p || !boxW || !boxH) return null;
    return fitSize(p.width, p.height, boxW * dpr, boxH * dpr, PREVIEW_MAX_SIDE);
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
    if (!ready || !s || !editor.photo) return;
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(() => {
      try {
        editor.renderer?.draw(frame, s.w, s.h);
      } catch (e) {
        editor.error = e instanceof Error ? e.message : String(e);
      }
    });
  });

  function hold(on: boolean) {
    editor.showOriginal = on;
  }
</script>

<div class="viewer" bind:this={box}>
  <canvas
    bind:this={canvas}
    class:hidden={!editor.photo}
    style:width={size ? `${size.w / dpr}px` : '0'}
    style:height={size ? `${size.h / dpr}px` : '0'}
    onpointerdown={(e) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      hold(true);
    }}
    onpointerup={() => hold(false)}
    onpointercancel={() => hold(false)}
    oncontextmenu={(e) => e.preventDefault()}
    aria-label="Foto. Segure para ver o original."
  ></canvas>
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
