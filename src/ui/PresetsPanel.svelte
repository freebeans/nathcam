<script lang="ts">
  import type { Editor } from '../app/editor.svelte';
  import type { PresetItem } from '../presets/organize';
  import Slider from './Slider.svelte';
  import Thumb from './Thumb.svelte';

  let { editor }: { editor: Editor } = $props();
  let catalog = $derived(editor.catalog);

  let fileInput: HTMLInputElement;
  let menuFor = $state.raw<PresetItem | null>(null);
  let organizing = $state(false);
  let importing = $state(false);

  let current = $derived(editor.recipe.preset);
  let selected = $derived(current?.id ?? null);

  /** Segurar um preset abre o menu dele. */
  let pressTimer = 0;
  let longPressed = false;
  function pressStart(item: PresetItem) {
    longPressed = false;
    clearTimeout(pressTimer);
    pressTimer = window.setTimeout(() => {
      longPressed = true;
      menuFor = item;
    }, 500);
  }
  function pressEnd() {
    clearTimeout(pressTimer);
  }
  function choose(item: PresetItem) {
    if (longPressed) return;
    editor.choosePreset(item.preset);
  }

  async function onfiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    importing = true;
    try {
      await catalog.import(files);
      await editor.renderThumbs(true);
    } finally {
      importing = false;
    }
  }

  async function rename(item: PresetItem) {
    menuFor = null;
    const name = prompt('Nome do preset', item.preset.name);
    if (name === null) return;
    const pack = prompt('Pack', item.preset.pack);
    if (pack === null) return;
    await catalog.rename(item.preset.id, name, pack);
  }

  async function remove(item: PresetItem) {
    menuFor = null;
    if (!confirm(`Apagar o preset "${item.preset.name}" deste aparelho?`)) return;
    await catalog.remove(item.preset.id);
  }

  function saveAs() {
    const name = prompt('Nome do novo preset', current ? `${current.name} 2` : 'Meu preset');
    if (name !== null) void editor.saveAsPreset(name);
  }
</script>

<input bind:this={fileInput} type="file" accept=".json,.cube,.xmp,.png,application/json,image/png" multiple hidden onchange={onfiles} />

<div class="presets">
  <div class="bar">
    <input class="search" type="search" placeholder="Buscar presets" bind:value={catalog.query} aria-label="Buscar presets" />
    <button class="link" onclick={() => fileInput.click()} disabled={importing}>{importing ? 'Importando…' : 'Importar'}</button>
    <button class="link" aria-label="Organizar" onclick={() => (organizing = true)}>⋯</button>
  </div>

  {#if catalog.lastImport && (catalog.lastImport.errors.length || catalog.lastImport.notes.length)}
    <div class="notice" role="status">
      {#each catalog.lastImport.errors as e (e)}<p class="error">{e}</p>{/each}
      {#each catalog.lastImport.notes as n (n)}<p>{n}</p>{/each}
      <button class="link" onclick={() => (catalog.lastImport = null)}>ok</button>
    </div>
  {/if}

  {#if !catalog.organized.search}
    <div class="packs" role="tablist">
      {#each catalog.organized.packs as pack (pack)}
        <button role="tab" aria-selected={catalog.pack === pack} class:active={catalog.pack === pack} onclick={() => (catalog.pack = pack)}>
          {pack}
        </button>
      {/each}
    </div>
  {/if}

  <div class="current">
    {#if editor.recipe.flattened}
      <p class="muted">Achatado{current ? ` · ${current.name}` : ''}: os sliders mostram valores absolutos.</p>
    {:else}
      <div class="intensity" class:disabled={!current}>
        <Slider
          label={current ? `Intensidade · ${current.name}` : 'Intensidade'}
          value={Math.round(editor.recipe.intensity * 100)}
          min={0}
          max={100}
          neutral={100}
          format={(v) => `${v}%`}
          onchange={(v) => editor.setIntensity(v / 100)}
        />
      </div>
    {/if}
    <div class="actions">
      <button class="link" disabled={!current || !!editor.editingPreset} onclick={() => editor.startEditPreset()}>Editar preset</button>
      <button class="link" disabled={editor.recipe.flattened || (!current && !Object.keys(editor.recipe.user).length)} onclick={() => editor.flatten()}>Achatar</button>
      <button class="link" onclick={saveAs}>Salvar como…</button>
    </div>
  </div>

  <div class="grid">
    {#if !catalog.organized.search}
      <button class="tile" class:active={selected === null} onclick={() => editor.choosePreset(null)}>
        <span class="img"><Thumb image={editor.originalThumb} /></span>
        <span class="name">Original</span>
      </button>
    {/if}
    {#each catalog.shown as item (item.preset.id)}
      <button
        class="tile"
        class:active={selected === item.preset.id}
        class:hiddenPreset={catalog.prefs.hidden.has(item.preset.id) || catalog.prefs.hiddenPacks.has(item.preset.pack)}
        onclick={() => choose(item)}
        onpointerdown={() => pressStart(item)}
        onpointerup={pressEnd}
        onpointerleave={pressEnd}
        onpointercancel={pressEnd}
        oncontextmenu={(e) => {
          e.preventDefault();
          menuFor = item;
        }}
      >
        <span class="img"><Thumb image={editor.thumbs.get(item.preset.id)} /></span>
        <span class="name">{catalog.prefs.favorites.has(item.preset.id) ? '★ ' : ''}{item.preset.name}</span>
      </button>
    {:else}
      {#if catalog.organized.search}<p class="muted empty">Nenhum preset com esse nome.</p>{/if}
    {/each}
  </div>
</div>

{#if menuFor}
  {@const item = menuFor}
  <div class="backdrop" role="presentation" onclick={() => (menuFor = null)}></div>
  <div class="sheet" role="dialog" aria-label="Preset {item.preset.name}">
    <h3>{item.preset.name} <span class="muted">· {item.preset.pack}{item.local ? '' : ' (oficial)'}</span></h3>
    <button onclick={() => { void catalog.toggleFavorite(item.preset.id); menuFor = null; }}>
      {catalog.prefs.favorites.has(item.preset.id) ? 'Tirar dos favoritos' : 'Favoritar'}
    </button>
    <button onclick={() => { void catalog.toggleHidden(item.preset.id); menuFor = null; }}>
      {catalog.prefs.hidden.has(item.preset.id) ? 'Mostrar' : 'Ocultar'}
    </button>
    {#if item.local}
      <button onclick={() => rename(item)}>Renomear / mudar de pack…</button>
      <button class="danger" onclick={() => remove(item)}>Apagar</button>
    {/if}
    <button class="muted" onclick={() => (menuFor = null)}>Cancelar</button>
  </div>
{/if}

{#if organizing}
  <div class="backdrop" role="presentation" onclick={() => (organizing = false)}></div>
  <div class="sheet" role="dialog" aria-label="Organizar presets">
    <h3>Organizar</h3>
    <label class="toggle"><input type="checkbox" bind:checked={catalog.showHidden} /> Mostrar ocultos</label>
    {#each catalog.allPacks as pack (pack)}
      <label class="toggle">
        <input type="checkbox" checked={!catalog.prefs.hiddenPacks.has(pack)} onchange={() => catalog.togglePackHidden(pack)} />
        Pack {pack}
      </label>
    {/each}
    <button class="muted" onclick={() => (organizing = false)}>Fechar</button>
  </div>
{/if}

<style>
  .presets {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .bar {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 0 16px;
  }
  .search {
    flex: 1;
    min-width: 0;
    font: inherit;
    font-size: 14px;
    color: var(--fg);
    background: var(--track);
    border: none;
    border-radius: 8px;
    padding: 6px 10px;
  }
  .notice {
    margin: 0 16px;
    font-size: 12px;
    color: var(--muted);
  }
  .notice p {
    margin: 0 0 4px;
  }
  .packs {
    display: flex;
    gap: 16px;
    overflow-x: auto;
    padding: 0 16px;
  }
  .packs button {
    flex: 0 0 auto;
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
  .current {
    padding: 0 16px;
  }
  .intensity.disabled {
    opacity: 0.35;
    pointer-events: none;
  }
  .actions {
    display: flex;
    gap: 16px;
  }
  .actions button {
    font-size: 13px;
    color: var(--muted);
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
    -webkit-touch-callout: none;
    user-select: none;
    -webkit-user-select: none;
  }
  .hiddenPreset {
    opacity: 0.4;
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
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tile.active .name {
    color: var(--fg);
  }
  .muted {
    color: var(--muted);
    font-size: 13px;
    margin: 0;
  }
  .empty {
    padding: 24px 0;
  }
  .error {
    color: var(--error);
  }
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 11;
    background: var(--panel);
    border-radius: 14px 14px 0 0;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-width: 560px;
    margin: 0 auto;
  }
  .sheet h3 {
    margin: 0 0 8px;
    font-size: 15px;
  }
  .sheet button {
    text-align: left;
    padding: 12px 0;
    font-size: 15px;
  }
  .sheet .danger {
    color: var(--error);
  }
  .toggle {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 14px;
    padding: 8px 0;
  }
</style>
