<script lang="ts">
  import type { Editor } from '../app/editor.svelte';
  import {
    MAX_STRAIGHTEN,
    aspectCrop,
    flipCrop,
    fullCrop,
    orientedSize,
    rotateCropClockwise,
    straightenCrop,
  } from '../engine/crop';
  import Slider from './Slider.svelte';

  let { editor }: { editor: Editor } = $props();

  let crop = $derived(editor.recipe.crop ?? fullCrop());

  const RATIOS: { label: string; value: number | 'original' | null }[] = [
    { label: 'Livre', value: null },
    { label: 'Original', value: 'original' },
    { label: '1:1', value: 1 },
    { label: '4:5', value: 4 / 5 },
    { label: '5:4', value: 5 / 4 },
    { label: '2:3', value: 2 / 3 },
    { label: '3:2', value: 3 / 2 },
    { label: '9:16', value: 9 / 16 },
    { label: '16:9', value: 16 / 9 },
  ];
  let ratioLabel = $state('Livre');

  function size() {
    const p = editor.photo!;
    return { w: p.width, h: p.height };
  }

  function chooseRatio(r: (typeof RATIOS)[number]) {
    ratioLabel = r.label;
    if (r.value === null) {
      editor.cropAspect = null;
      return;
    }
    const { w, h } = size();
    const o = orientedSize(w, h, crop.quarterTurns);
    const aspect = r.value === 'original' ? o.w / o.h : r.value;
    editor.cropAspect = aspect;
    editor.setCrop(aspectCrop(w, h, crop, aspect));
  }

  function straighten(angle: number) {
    const { w, h } = size();
    editor.setCrop(straightenCrop(w, h, crop, angle), 'straighten');
  }

  function rotate() {
    editor.setCrop(rotateCropClockwise(crop));
    if (editor.cropAspect) editor.cropAspect = 1 / editor.cropAspect;
  }

  function reset() {
    ratioLabel = 'Livre';
    editor.cropAspect = null;
    editor.setCrop(fullCrop());
  }
</script>

<div class="crop">
  <div class="straighten">
    <Slider
      label="Endireitar"
      value={crop.angle}
      min={-MAX_STRAIGHTEN}
      max={MAX_STRAIGHTEN}
      step={0.1}
      format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}°`}
      onchange={straighten}
    />
  </div>
  <div class="ratios">
    {#each RATIOS as r (r.label)}
      <button class:active={ratioLabel === r.label} onclick={() => chooseRatio(r)}>{r.label}</button>
    {/each}
  </div>
  <div class="actions">
    <button class="link" onclick={rotate}>Girar 90°</button>
    <button class="link" onclick={() => editor.setCrop(flipCrop(crop))}>Espelhar</button>
    <button class="link" onclick={reset}>Redefinir</button>
    <button class="primary" onclick={() => editor.finishCrop()}>Concluir</button>
  </div>
</div>

<style>
  .crop {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .straighten {
    padding: 0 16px;
  }
  .ratios {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding: 0 16px;
  }
  .ratios button {
    flex: 0 0 auto;
    font-size: 13px;
    padding: 6px 12px;
    border-radius: 999px;
    background: var(--track);
    color: var(--muted);
  }
  .ratios button.active {
    background: var(--fg);
    color: var(--bg);
  }
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    gap: 8px;
  }
  .actions .primary {
    padding: 8px 18px;
  }
</style>
