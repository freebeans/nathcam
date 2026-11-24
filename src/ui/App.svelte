<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '../app/editor.svelte';
  import { Gallery } from '../app/gallery.svelte';
  import { Library, type PhotoRecord } from '../app/library';
  import { Db } from '../app/db';
  import { PresetCatalog } from '../app/catalog.svelte';
  import { PresetStore } from '../app/preset-store';
  import AdvancedPanel from './AdvancedPanel.svelte';
  import PasteSheet from './PasteSheet.svelte';
  import BackupSheet from './BackupSheet.svelte';
  import type { PasteGroupId } from '../app/paste';
  import Viewer from './Viewer.svelte';
  import PresetsPanel from './PresetsPanel.svelte';
  import BasicPanel from './BasicPanel.svelte';
  import CropPanel from './CropPanel.svelte';
  import ExportSheet from './ExportSheet.svelte';
  import LibraryView from './LibraryView.svelte';

  const db = new Db();
  const library = new Library(db);
  const catalog = new PresetCatalog(new PresetStore(db));
  const editor = new Editor(library, catalog);
  const gallery = new Gallery(library, () => editor.renderer?.caps.maxTextureSize ?? 4096);
  let fileInput: HTMLInputElement;
  let exporting = $state(false);
  let menu = $state(false);
  let backup = $state(false);
  /** Onde colar: na foto aberta ou nas selecionadas da biblioteca. */
  let pasting = $state<'here' | 'selected' | null>(null);
  let batch = $state<{ done: number; total: number } | null>(null);

  async function paste(groups: ReadonlySet<PasteGroupId>) {
    const where = pasting;
    pasting = null;
    if (where === 'here') return editor.pasteHere(groups);
    const recs = gallery.photos.filter((p) => gallery.selected.has(p.id));
    batch = { done: 0, total: recs.length };
    try {
      const errors = await editor.pasteInto(recs, groups, (done) => (batch = { done, total: recs.length }));
      gallery.error = errors.length ? errors.join('\n') : null;
    } catch (e) {
      gallery.error = e instanceof Error ? e.message : String(e);
    } finally {
      batch = null;
      gallery.setSelecting(false);
      await gallery.refresh();
    }
  }
  let view = $state<'library' | 'editor'>('library');

  onMount(() => {
    void catalog.init().then(() => editor.renderThumbs());
    void gallery.refresh();
    // O iOS pode encerrar a PWA em segundo plano: grava o que estiver pendente.
    const onHide = () => document.visibilityState === 'hidden' && void editor.flush();
    document.addEventListener('visibilitychange', onHide);
    // Voltar (gesto ou botão do Android) fecha o editor.
    const onPop = () => view === 'editor' && void closeEditor();
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('popstate', onPop);
    };
  });

  async function openPhoto(p: PhotoRecord) {
    view = 'editor';
    history.pushState({ photo: p.id }, '');
    await editor.open(p);
  }

  async function closeEditor() {
    exporting = false;
    view = 'library';
    await editor.close();
    await gallery.refresh();
  }

  function back() {
    if (history.state?.photo) history.back();
    else void closeEditor();
  }

  async function onfiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = '';
    if (!files.length) return;
    const ids = await gallery.import(files);
    if (ids.length === 1) {
      const rec = gallery.photos.find((p) => p.id === ids[0]);
      if (rec) await openPhoto(rec);
    }
  }
</script>

<input bind:this={fileInput} type="file" accept="image/*" multiple hidden onchange={onfiles} />

<div class="app">
  <header class="top">
    <button class="link" onclick={back} disabled={editor.cropping} aria-label="Voltar à biblioteca">‹ Biblioteca</button>
    <span class="tools">
      <button class="icon" onclick={() => editor.undo()} disabled={!editor.canUndo} aria-label="Desfazer">↶</button>
      <button class="icon" onclick={() => editor.redo()} disabled={!editor.canRedo} aria-label="Refazer">↷</button>
      <button class="link" class:on={editor.cropping} onclick={() => (editor.cropping ? editor.finishCrop() : editor.startCrop())} disabled={!editor.photo}>
        Recorte
      </button>
    </span>
    <span class="tools">
      <button class="icon" aria-label="Mais ações" disabled={!editor.photo || editor.cropping} onclick={() => (menu = true)}>⋯</button>
      <button class="link" disabled={!editor.photo || editor.cropping} onclick={() => (exporting = true)}>Exportar</button>
    </span>
  </header>

  <Viewer {editor} />

  {#if editor.busy}
    <p class="muted center">Abrindo…</p>
  {/if}

  {#if editor.error}
    <p class="error" role="alert">
      {editor.error}
      <button class="link" onclick={() => (editor.error = null)}>ok</button>
    </p>
  {/if}

  {#if editor.photo}
    <section class="panel">
      {#if editor.cropping}
        <CropPanel {editor} />
      {:else}
        {#if editor.editingPreset}
          <div class="editing" role="status">
            <span>Editando <b>{editor.recipe.preset?.name}</b>: os sliders mudam o preset.</span>
            <span class="editing-actions">
              <button class="link" onclick={() => editor.cancelEditPreset()}>Cancelar</button>
              <button class="link strong" onclick={() => editor.saveEditedPreset()}>
                {catalog.isLocal(editor.recipe.preset?.id ?? '') ? 'Salvar' : 'Salvar cópia'}
              </button>
            </span>
          </div>
        {/if}
        {#if editor.level === 'presets'}
          <PresetsPanel {editor} />
        {:else if editor.level === 'basic'}
          <BasicPanel {editor} />
        {:else}
          <AdvancedPanel {editor} />
        {/if}
        <div class="levels" role="tablist">
          {#each [['presets', 'Presets'], ['basic', 'Básico'], ['advanced', 'Avançado']] as const as [lv, label] (lv)}
            <button role="tab" aria-selected={editor.level === lv} class:active={editor.level === lv} onclick={() => (editor.level = lv)}>
              {label}
            </button>
          {/each}
          {#if editor.level === 'advanced'}
            <button class="compare" class:active={editor.compare} aria-pressed={editor.compare} onclick={() => (editor.compare = !editor.compare)}>
              Antes/depois
            </button>
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  {#if view === 'library'}
    <LibraryView
      {gallery}
      {batch}
      canPaste={!!editor.copied}
      onopen={openPhoto}
      onimport={() => fileInput.click()}
      onpaste={() => (pasting = 'selected')}
      onbackup={() => (backup = true)}
    />
  {/if}
</div>

{#if exporting}
  <ExportSheet {editor} onclose={() => (exporting = false)} />
{/if}

{#if menu}
  <div class="backdrop" role="presentation" onclick={() => (menu = false)}></div>
  <div class="sheet" role="dialog" aria-label="Mais ações">
    <button
      onclick={() => {
        editor.copy();
        menu = false;
      }}>Copiar ajustes</button
    >
    <button
      disabled={!editor.copied}
      onclick={() => {
        menu = false;
        pasting = 'here';
      }}>Colar ajustes…</button
    >
    <button class="muted" onclick={() => (menu = false)}>Cancelar</button>
  </div>
{/if}

{#if backup}
  <BackupSheet {db} {catalog} onclose={() => (backup = false)} />
{/if}

{#if pasting}
  <PasteSheet count={pasting === 'selected' ? gallery.selected.size : 1} onconfirm={paste} oncancel={() => (pasting = null)} />
{/if}

<style>
  .app {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    padding-top: env(safe-area-inset-top);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 16px;
  }
  .tools {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .icon {
    font-size: 20px;
    line-height: 1;
    padding: 4px;
  }
  .on {
    text-decoration: underline;
    text-underline-offset: 4px;
  }
  .muted {
    color: var(--muted);
    font-size: 13px;
    margin: 0;
  }
  .center {
    text-align: center;
    padding: 8px;
  }
  .panel {
    background: var(--panel);
    padding: 12px 0 env(safe-area-inset-bottom);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .levels {
    display: flex;
    justify-content: center;
    gap: 28px;
    padding: 6px 0 10px;
  }
  .levels button {
    color: var(--muted);
    font-size: 14px;
  }
  .levels button.active {
    color: var(--fg);
  }
  .editing {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    justify-content: space-between;
    align-items: center;
    margin: 0 16px;
    padding: 8px 12px;
    border-radius: 8px;
    background: var(--track);
    font-size: 13px;
  }
  .editing-actions {
    display: flex;
    gap: 16px;
  }
  .strong {
    font-weight: 600;
  }
  .compare {
    color: var(--muted);
    font-size: 13px;
    border: 1px solid var(--track);
    border-radius: 999px;
    padding: 2px 10px;
  }
  .levels .compare.active {
    color: var(--bg);
    background: var(--fg);
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
    max-width: 560px;
    margin: 0 auto;
  }
  .sheet button {
    text-align: left;
    padding: 12px 0;
    font-size: 15px;
  }
  .error {
    margin: 0 16px 8px;
    color: var(--error);
    font-size: 13px;
  }
</style>
