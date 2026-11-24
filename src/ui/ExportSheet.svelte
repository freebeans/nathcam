<script lang="ts">
  import type { Editor } from '../app/editor.svelte';
  import {
    DEFAULT_EXPORT,
    canShareFiles,
    downloadFile,
    exportFileName,
    exportJpeg,
    exportSize,
    shareFile,
  } from '../export/export';
  import Slider from './Slider.svelte';

  let { editor, onclose }: { editor: Editor; onclose: () => void } = $props();

  let quality = $state(DEFAULT_EXPORT.quality);
  let stripLocation = $state(DEFAULT_EXPORT.stripLocation);
  let progress = $state<number | null>(null);
  let file = $state.raw<File | null>(null);
  let message = $state<string | null>(null);

  let size = $derived(editor.photo ? exportSize(editor.photo.width, editor.photo.height, DEFAULT_EXPORT.maxSide) : null);

  // Mudou a configuração: o arquivo gerado deixa de valer.
  $effect(() => {
    void quality;
    void stripLocation;
    file = null;
  });

  async function generate() {
    const r = editor.renderer;
    const photo = editor.photo;
    if (!r || !photo) return;
    message = null;
    progress = 0;
    try {
      const frame = editor.frameFor(editor.recipe);
      const blob = await exportJpeg(
        r,
        frame,
        photo.bytes,
        { quality, maxSide: DEFAULT_EXPORT.maxSide, stripLocation },
        (f) => (progress = f),
      );
      file = new File([blob], exportFileName(photo.name), { type: 'image/jpeg' });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      progress = null;
    }
  }

  // Compartilhar e baixar são toques próprios (o iOS exige gesto do usuário para o share).
  async function share() {
    if (!file) return;
    if (!canShareFiles(file)) {
      message = 'Este navegador não compartilha arquivos; use Baixar.';
      return;
    }
    try {
      await shareFile(file);
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') message = String(e);
    }
  }
</script>

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-modal="true" aria-label="Exportar">
  <header>
    <h2>Exportar JPEG</h2>
    <button class="link" onclick={onclose}>Fechar</button>
  </header>
  {#if size}
    <p class="muted">{size.w} × {size.h} px · Display P3</p>
  {/if}
  <Slider label="Qualidade" value={quality} min={50} max={100} neutral={DEFAULT_EXPORT.quality} format={(v) => String(v)} onchange={(v) => (quality = v)} />
  <label class="toggle">
    <input type="checkbox" bind:checked={stripLocation} />
    Remover localização
  </label>

  {#if progress !== null}
    <div class="progress"><span style:width="{Math.round(progress * 100)}%"></span></div>
  {:else if !file}
    <button class="primary" onclick={generate}>Gerar JPEG</button>
  {:else}
    <div class="actions">
      <button class="primary" onclick={share}>Compartilhar</button>
      <button class="secondary" onclick={() => file && downloadFile(file)}>Baixar</button>
    </div>
  {/if}
  {#if message}
    <p class="error">{message}</p>
  {/if}
</div>

<style>
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
    gap: 10px;
    max-width: 560px;
    margin: 0 auto;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }
  .muted {
    margin: 0;
    color: var(--muted);
    font-size: 13px;
  }
  .toggle {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 14px;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions button {
    flex: 1;
  }
  .progress {
    height: 4px;
    background: var(--track);
    border-radius: 2px;
    overflow: hidden;
  }
  .progress span {
    display: block;
    height: 100%;
    background: var(--fg);
    transition: width 0.2s;
  }
  .error {
    color: var(--error);
    font-size: 13px;
    margin: 0;
  }
</style>
