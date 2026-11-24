<script lang="ts">
  import type { Editor } from '../app/editor.svelte';
  import { NUMERIC_PARAM_BY_PATH } from '../engine/params';
  import { userDeltaRange, userValue } from '../app/recipe-edit';
  import Slider from './Slider.svelte';

  let { editor }: { editor: Editor } = $props();

  /** Nível 2 do PRD. Os sliders mostram a camada do usuário, relativa ao preset. */
  const CONTROLS: { path: string; label: string }[] = [
    { path: 'exposure', label: 'Exposição' },
    { path: 'contrast', label: 'Contraste' },
    { path: 'highlights', label: 'Altas luzes' },
    { path: 'shadows', label: 'Sombras' },
    { path: 'whites', label: 'Brancos' },
    { path: 'blacks', label: 'Pretos' },
    { path: 'temperature', label: 'Temperatura' },
    { path: 'tint', label: 'Tonalidade' },
    { path: 'saturation', label: 'Saturação' },
    { path: 'vibrance', label: 'Vibração' },
    { path: 'fade', label: 'Fade' },
    { path: 'grain', label: 'Grão' },
    { path: 'vignette', label: 'Vinheta' },
  ];
</script>

<div class="basic">
  {#each CONTROLS as c (c.path)}
    {@const spec = NUMERIC_PARAM_BY_PATH.get(c.path)!}
    {@const [min, max] = userDeltaRange(spec)}
    <Slider
      label={c.label}
      value={userValue(editor.recipe, c.path)}
      {min}
      {max}
      step={spec.step}
      onchange={(v) => editor.setParam(c.path, v)}
    />
  {/each}
</div>

<style>
  .basic {
    padding: 0 16px;
    max-height: 30vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
</style>
