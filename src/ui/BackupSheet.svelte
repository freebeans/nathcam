<script lang="ts">
  import { createBackup, restoreBackup } from '../app/backup';
  import type { PresetCatalog } from '../app/catalog.svelte';
  import type { Db } from '../app/db';
  import { canShareFiles, downloadFile, shareFile } from '../export/export';

  let { db, catalog, onclose }: { db: Db; catalog: PresetCatalog; onclose: () => void } = $props();

  let file = $state.raw<File | null>(null);
  let busy = $state(false);
  let message = $state<string | null>(null);
  let input: HTMLInputElement;

  async function make() {
    busy = true;
    message = null;
    try {
      const zip = await createBackup(db);
      const date = new Date().toISOString().slice(0, 10);
      file = new File([zip as Uint8Array<ArrayBuffer>], `nathcam-presets-${date}.zip`, { type: 'application/zip' });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function share() {
    if (!file) return;
    if (!canShareFiles(file)) return downloadFile(file);
    try {
      await shareFile(file);
    } catch (e) {
      if ((e as DOMException)?.name !== 'AbortError') message = String(e);
    }
  }

  async function onrestore(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    (e.currentTarget as HTMLInputElement).value = '';
    if (!f) return;
    busy = true;
    message = null;
    try {
      const res = await restoreBackup(db, new Uint8Array(await f.arrayBuffer()));
      await catalog.refreshLocal();
      message = `Restaurado: ${res.presets} preset${res.presets === 1 ? '' : 's'} e ${res.luts} LUT${res.luts === 1 ? '' : 's'}.`;
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    } finally {
      busy = false;
    }
  }
</script>

<input bind:this={input} type="file" accept=".zip,application/zip" hidden onchange={onrestore} />
<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="sheet" role="dialog" aria-label="Backup dos presets">
  <h3>Backup dos presets</h3>
  <p class="muted">
    Presets locais, packs, favoritos, ocultos e LUTs importadas. As fotos não entram: os originais continuam no rolo da câmera.
  </p>
  {#if !file}
    <button class="primary" disabled={busy} onclick={make}>{busy ? 'Gerando…' : 'Fazer backup'}</button>
  {:else}
    <div class="actions">
      <button class="primary" onclick={share}>Compartilhar</button>
      <button class="secondary" onclick={() => file && downloadFile(file)}>Baixar</button>
    </div>
  {/if}
  <button class="secondary" disabled={busy} onclick={() => input.click()}>Restaurar backup…</button>
  {#if message}<p class="msg" role="status">{message}</p>{/if}
  <button class="link muted close" onclick={onclose}>Fechar</button>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 20;
  }
  .sheet {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 21;
    background: var(--panel);
    border-radius: 14px 14px 0 0;
    padding: 16px 16px calc(16px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-width: 560px;
    margin: 0 auto;
  }
  h3 {
    margin: 0;
    font-size: 15px;
  }
  .muted {
    color: var(--muted);
    font-size: 13px;
    margin: 0;
  }
  .msg {
    font-size: 13px;
    margin: 0;
  }
  .actions {
    display: flex;
    gap: 8px;
  }
  .actions button {
    flex: 1;
  }
  .close {
    align-self: center;
  }
</style>
