<script lang="ts">
  import { DEFAULT_GROUPS, PASTE_GROUPS, type PasteGroupId } from '../app/paste';

  let {
    count,
    onconfirm,
    oncancel,
  }: { count: number; onconfirm: (groups: ReadonlySet<PasteGroupId>) => void; oncancel: () => void } = $props();

  let groups = $state(new Set<PasteGroupId>(DEFAULT_GROUPS));

  function toggle(id: PasteGroupId, on: boolean) {
    const s = new Set(groups);
    if (on) s.add(id);
    else s.delete(id);
    groups = s;
  }
</script>

<div class="backdrop" role="presentation" onclick={oncancel}></div>
<div class="sheet" role="dialog" aria-label="Colar ajustes">
  <h3>Colar ajustes{count > 1 ? ` em ${count} fotos` : ''}</h3>
  {#each PASTE_GROUPS as g (g.id)}
    <label class="toggle">
      <input type="checkbox" checked={groups.has(g.id)} onchange={(e) => toggle(g.id, e.currentTarget.checked)} />
      {g.label}
    </label>
  {/each}
  <div class="actions">
    <button class="secondary" onclick={oncancel}>Cancelar</button>
    <button class="primary" disabled={groups.size === 0} onclick={() => onconfirm(groups)}>Colar</button>
  </div>
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
    gap: 2px;
    max-width: 560px;
    margin: 0 auto;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 15px;
  }
  .toggle {
    display: flex;
    gap: 10px;
    align-items: center;
    font-size: 15px;
    padding: 8px 0;
  }
  .actions {
    display: flex;
    gap: 8px;
    margin-top: 8px;
  }
  .actions button {
    flex: 1;
  }
</style>
