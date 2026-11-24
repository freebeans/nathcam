<script lang="ts">
  import type { Gallery } from '../app/gallery.svelte';
  import type { PhotoRecord } from '../app/library';

  let {
    gallery,
    batch,
    canPaste,
    onopen,
    onimport,
    onpaste,
    onbackup,
  }: {
    gallery: Gallery;
    batch: { done: number; total: number } | null;
    canPaste: boolean;
    onopen: (p: PhotoRecord) => void;
    onimport: () => void;
    onpaste: () => void;
    onbackup: () => void;
  } = $props();

  // URLs das miniaturas, recriadas quando a lista muda.
  let urls = $state.raw<Map<string, string>>(new Map());
  $effect(() => {
    const m = new Map<string, string>();
    for (const p of gallery.photos) if (p.thumb) m.set(p.id, URL.createObjectURL(p.thumb));
    urls = m;
    return () => m.forEach((u) => URL.revokeObjectURL(u));
  });

  function tap(p: PhotoRecord) {
    if (batch) return;
    if (gallery.selecting) gallery.toggle(p.id);
    else onopen(p);
  }

  async function remove() {
    const n = gallery.selected.size;
    if (!n) return;
    if (!confirm(n === 1 ? 'Apagar 1 foto da biblioteca? O original continua no rolo da câmera.' : `Apagar ${n} fotos da biblioteca? Os originais continuam no rolo da câmera.`)) return;
    await gallery.deleteSelected();
  }
</script>

<div class="library">
  <header class="top">
    {#if gallery.selecting}
      <button class="link" disabled={!!batch} onclick={() => gallery.setSelecting(false)}>Cancelar</button>
      <span class="title">{gallery.selected.size} selecionada{gallery.selected.size === 1 ? '' : 's'}</span>
      <button class="link danger" disabled={!gallery.selected.size || !!batch} onclick={remove}>Apagar</button>
    {:else}
      <button class="link" disabled={!gallery.photos.length} onclick={() => gallery.setSelecting(true)}>Selecionar</button>
      <span class="title">nathcam</span>
      <span class="right">
        <button class="link" aria-label="Backup dos presets" onclick={onbackup}>⋯</button>
        <button class="link" onclick={onimport}>Importar</button>
      </span>
    {/if}
  </header>

  {#if batch}
    <p class="muted status">Colando ajustes… {batch.done}/{batch.total}</p>
  {/if}
  {#if gallery.importing > 0}
    <p class="muted status">Importando… {gallery.importing}</p>
  {/if}
  {#if gallery.error}
    <p class="error" role="alert">{gallery.error}</p>
  {/if}

  {#if gallery.photos.length === 0}
    <div class="empty">
      <button class="primary big" onclick={onimport}>Abrir foto</button>
      <p class="muted">JPEG ou PNG, do rolo da câmera ou de arquivos.</p>
    </div>
  {:else}
    <div class="grid">
      {#each gallery.photos as p (p.id)}
        <button
          class="cell"
          class:selected={gallery.selected.has(p.id)}
          aria-label={p.name}
          aria-pressed={gallery.selecting ? gallery.selected.has(p.id) : undefined}
          onclick={() => tap(p)}
        >
          {#if urls.get(p.id)}
            <img src={urls.get(p.id)} alt="" draggable="false" />
          {/if}
          {#if p.editedAt}<span class="dot" title="Editada"></span>{/if}
          {#if gallery.selecting}<span class="check">{gallery.selected.has(p.id) ? '✓' : ''}</span>{/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if gallery.selecting}
    <div class="selbar">
      <button class="link" disabled={!canPaste || !gallery.selected.size || !!batch} onclick={onpaste}>
        {canPaste ? `Colar ajustes${gallery.selected.size ? ` (${gallery.selected.size})` : ''}` : 'Copie ajustes de uma foto para colar'}
      </button>
    </div>
  {/if}
</div>

<style>
  .library {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding-top: env(safe-area-inset-top);
    background: var(--bg);
    z-index: 2;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
  }
  .title {
    font-size: 14px;
    letter-spacing: 0.12em;
    color: var(--muted);
  }
  .right {
    display: flex;
    gap: 16px;
  }
  .selbar {
    display: flex;
    justify-content: center;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    background: var(--panel);
  }
  .danger {
    color: var(--error);
  }
  .status,
  .error {
    margin: 0 16px 8px;
    font-size: 13px;
    white-space: pre-line;
  }
  .error {
    color: var(--error);
  }
  .muted {
    color: var(--muted);
    font-size: 13px;
    margin: 0;
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }
  .big {
    font-size: 17px;
    padding: 14px 28px;
  }
  .grid {
    flex: 1;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    gap: 2px;
    padding: 0 2px env(safe-area-inset-bottom);
    align-content: start;
    -webkit-overflow-scrolling: touch;
  }
  .cell {
    position: relative;
    aspect-ratio: 1;
    overflow: hidden;
    background: var(--track);
  }
  .cell img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }
  .cell.selected img {
    opacity: 0.6;
  }
  .dot {
    position: absolute;
    right: 6px;
    bottom: 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--fg);
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.8);
  }
  .check {
    position: absolute;
    right: 6px;
    top: 6px;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid #fff;
    background: rgba(0, 0, 0, 0.3);
    color: #fff;
    font-size: 13px;
    line-height: 18px;
    text-align: center;
  }
  .selected .check {
    background: var(--fg);
    color: var(--bg);
    border-color: var(--fg);
  }
</style>
