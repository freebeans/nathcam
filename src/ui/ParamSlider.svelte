<script lang="ts">
  import type { Editor } from '../app/editor.svelte';
  import { sliderModel } from '../app/recipe-edit';
  import Slider from './Slider.svelte';

  /** Slider de um parâmetro: relativo ao preset, absoluto (achatado) ou editando o preset. */
  let { editor, path, label, format }: { editor: Editor; path: string; label: string; format?: (v: number) => string } = $props();

  let m = $derived(sliderModel(editor.recipe, path, editor.sliderTarget));
</script>

<Slider
  {label}
  value={m.value}
  min={m.min}
  max={m.max}
  step={m.step}
  neutral={m.neutral}
  {format}
  onchange={(v) => editor.setParam(path, v)}
/>
