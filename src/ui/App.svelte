<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '../app/editor.svelte';
  import { Gallery } from '../app/gallery.svelte';
  import { Library, type PhotoRecord } from '../app/library';
  import Viewer from './Viewer.svelte';
  import PresetsPanel from './PresetsPanel.svelte';
  import BasicPanel from './BasicPanel.svelte';
  import CropPanel from './CropPanel.svelte';
  import ExportSheet from './ExportSheet.svelte';
  import LibraryView from './LibraryView.svelte';

  const library = new Library();
  const editor = new Editor(library);
  const gallery = new Gallery(library, () => editor.renderer?.caps.maxTextureSize ?? 4096);
  let fileInput: HTMLInputElement;
  let exporting = $state(false);
  let view = $state<'library' | 'editor'>('library');

  onMount(() => {
    void editor.init();
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
    <button class="link" disabled={!editor.photo || editor.cropping} onclick={() => (exporting = true)}>Exportar</button>
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
        {#if editor.level === 'presets'}
          <PresetsPanel {editor} />
        {:else}
          <BasicPanel {editor} />
        {/if}
        <div class="levels" role="tablist">
          <button role="tab" aria-selected={editor.level === 'presets'} class:active={editor.level === 'presets'} onclick={() => (editor.level = 'presets')}>
            Presets
          </button>
          <button role="tab" aria-selected={editor.level === 'basic'} class:active={editor.level === 'basic'} onclick={() => (editor.level = 'basic')}>
            Básico
          </button>
        </div>
      {/if}
    </section>
  {/if}

  {#if view === 'library'}
    <LibraryView {gallery} onopen={openPhoto} onimport={() => fileInput.click()} />
  {/if}
</div>

{#if exporting}
  <ExportSheet {editor} onclose={() => (exporting = false)} />
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
  .error {
    margin: 0 16px 8px;
    color: var(--error);
    font-size: 13px;
  }
</style>
