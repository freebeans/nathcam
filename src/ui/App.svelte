<script lang="ts">
  import { onMount } from 'svelte';
  import { Editor } from '../app/editor.svelte';
  import Viewer from './Viewer.svelte';
  import PresetsPanel from './PresetsPanel.svelte';
  import BasicPanel from './BasicPanel.svelte';
  import ExportSheet from './ExportSheet.svelte';

  const editor = new Editor();
  let fileInput: HTMLInputElement;
  let exporting = $state(false);

  onMount(() => {
    void editor.init().then(() => editor.renderThumbs());
  });

  function pick() {
    fileInput.click();
  }

  async function onfile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (f) await editor.open(f);
  }
</script>

<input bind:this={fileInput} type="file" accept="image/*" hidden onchange={onfile} />

<div class="app">
  <header class="top">
    <button class="link" onclick={pick}>Abrir</button>
    <span class="title">nathcam</span>
    <button class="link" disabled={!editor.photo} onclick={() => (exporting = true)}>Exportar</button>
  </header>

  <Viewer {editor} />

  {#if !editor.photo}
    <div class="empty">
      <button class="primary big" onclick={pick} disabled={editor.busy}>
        {editor.busy ? 'Abrindo…' : 'Abrir foto'}
      </button>
      <p class="muted">JPEG ou PNG, do rolo da câmera ou de arquivos.</p>
    </div>
  {/if}

  {#if editor.error}
    <p class="error" role="alert">
      {editor.error}
      <button class="link" onclick={() => (editor.error = null)}>ok</button>
    </p>
  {/if}

  {#if editor.photo}
    <section class="panel">
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
    </section>
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
  .title {
    font-size: 14px;
    letter-spacing: 0.12em;
    text-transform: lowercase;
    color: var(--muted);
  }
  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    pointer-events: none;
  }
  .empty > * {
    pointer-events: auto;
  }
  .big {
    font-size: 17px;
    padding: 14px 28px;
  }
  .muted {
    color: var(--muted);
    font-size: 13px;
    margin: 0;
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
