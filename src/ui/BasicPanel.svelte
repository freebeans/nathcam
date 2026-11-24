<script lang="ts">
  import type { Editor } from '../app/editor.svelte';
  import ParamSlider from './ParamSlider.svelte';

  let { editor }: { editor: Editor } = $props();

  /** Nível 2 do PRD. */
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
    <ParamSlider {editor} path={c.path} label={c.label} />
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
