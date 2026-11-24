<script lang="ts">
  import type { Editor } from '../app/editor.svelte';
  import Slider from './Slider.svelte';
  import Thumb from './Thumb.svelte';

  let { editor }: { editor: Editor } = $props();

  let none = $derived.by(() => {
    void editor.photo;
    void editor.thumbs;
    return editor.originalThumb();
  });
  let selected = $derived(editor.recipe.preset?.id ?? null);
</script>

<div class="presets">
  {#if editor.manifest && editor.manifest.packs.length > 1}
    <div class="packs" role="tablist">
      {#each editor.manifest.packs as pack (pack)}
        <button role="tab" aria-selected={editor.pack === pack} class:active={editor.pack === pack} onclick={() => (editor.pack = pack)}>
          {pack}
        </button>
      {/each}
    </div>
  {/if}

  <div class="intensity" class:disabled={!editor.recipe.preset}>
    <Slider
      label={editor.recipe.preset ? `Intensidade · ${editor.recipe.preset.name}` : 'Intensidade'}
      value={Math.round(editor.recipe.intensity * 100)}
      min={0}
      max={100}
      neutral={100}
      format={(v) => `${v}%`}
      onchange={(v) => editor.setIntensity(v / 100)}
    />
  </div>

  <div class="grid">
    <button class="tile" class:active={selected === null} onclick={() => editor.choosePreset(null)}>
      <span class="img"><Thumb image={none} /></span>
      <span class="name">Original</span>
    </button>
    {#each editor.presetsInPack as p (p.id)}
      <button class="tile" class:active={selected === p.id} onclick={() => editor.choosePreset(p)}>
        <span class="img"><Thumb image={editor.thumbs.get(p.id)} /></span>
        <span class="name">{p.name}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .presets {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .packs {
    display: flex;
    gap: 16px;
    overflow-x: auto;
    padding: 0 16px;
  }
  .packs button {
    color: var(--muted);
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 4px 0;
    border-bottom: 2px solid transparent;
  }
  .packs button.active {
    color: var(--fg);
    border-bottom-color: var(--fg);
  }
  .intensity {
    padding: 0 16px;
  }
  .intensity.disabled {
    opacity: 0.35;
    pointer-events: none;
  }
  .grid {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding: 0 16px 4px;
    scroll-snap-type: x proximity;
    -webkit-overflow-scrolling: touch;
  }
  .tile {
    flex: 0 0 auto;
    width: 76px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    scroll-snap-align: start;
  }
  .img {
    display: block;
    width: 76px;
    height: 76px;
    overflow: hidden;
    border-radius: 4px;
    outline: 2px solid transparent;
    outline-offset: -2px;
  }
  .tile.active .img {
    outline-color: var(--fg);
  }
  .name {
    font-size: 12px;
    color: var(--muted);
    text-align: center;
  }
  .tile.active .name {
    color: var(--fg);
  }
</style>
