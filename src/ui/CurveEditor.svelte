<script lang="ts" module>
  /** Cada arraste é um passo próprio no histórico. */
  let gestures = 0;
</script>

<script lang="ts">
  import type { Editor } from '../app/editor.svelte';
  import { evalCurve } from '../engine/curves';
  import { CURVE_CHANNELS, IDENTITY_CURVE, type CurveChannel, type CurvePoint } from '../engine/params';

  let { editor }: { editor: Editor } = $props();

  const LABELS: Record<CurveChannel, string> = { luma: 'Luz', red: 'R', green: 'G', blue: 'B' };
  const COLORS: Record<CurveChannel, string> = { luma: 'var(--fg)', red: '#ff6b6b', green: '#5fd38d', blue: '#6ea8ff' };
  /** Distância mínima entre pontos (em x). */
  const MIN_GAP = 0.02;
  /** Arrastar além disso para fora da caixa remove o ponto. */
  const REMOVE_DIST = 0.12;

  let channel = $state<CurveChannel>('luma');
  let svg: SVGSVGElement;
  let drag: { index: number; key: string } | null = null;
  let lastTap = { index: -1, t: 0 };

  let points: CurvePoint[] = $derived([...(editor.curve(channel) ?? IDENTITY_CURVE)].sort((a, b) => a[0] - b[0]));
  let path = $derived(
    Array.from({ length: 65 }, (_, i) => {
      const x = i / 64;
      const y = Math.min(1, Math.max(0, evalCurve(points, x)));
      return `${i ? 'L' : 'M'}${x.toFixed(4)},${(1 - y).toFixed(4)}`;
    }).join(''),
  );

  function pos(e: PointerEvent): [number, number] {
    const r = svg.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
  }

  function commit(pts: CurvePoint[], key?: string) {
    const identity = pts.length === 2 && pts.every(([x, y]) => Math.abs(x - y) < 1e-4);
    editor.setCurve(channel, identity ? null : pts, key);
  }

  function down(e: PointerEvent) {
    svg.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    const key = `curve-${channel}-${++gestures}`;
    // Ponto mais próximo (em tela), se estiver perto o bastante.
    let best = -1;
    let bestD = 0.06;
    points.forEach(([px, py], i) => {
      const d = Math.hypot(px - x, py - y);
      if (d < bestD) [best, bestD] = [i, d];
    });
    if (best >= 0) {
      const now = performance.now();
      const interior = best > 0 && best < points.length - 1;
      if (interior && lastTap.index === best && now - lastTap.t < 300) {
        commit(points.filter((_, i) => i !== best));
        lastTap = { index: -1, t: 0 };
        return;
      }
      lastTap = { index: best, t: now };
      drag = { index: best, key };
      return;
    }
    // Ponto novo onde o dedo tocou, entre os vizinhos.
    const cx = Math.min(1 - MIN_GAP, Math.max(MIN_GAP, x));
    if (points.some(([px]) => Math.abs(px - cx) < MIN_GAP)) return;
    const next: CurvePoint[] = [...points, [cx, Math.min(1, Math.max(0, y))] as const].sort((a, b) => a[0] - b[0]);
    drag = { index: next.findIndex(([px]) => px === cx), key };
    commit(next, key);
  }

  function move(e: PointerEvent) {
    if (!drag) return;
    const [x, y] = pos(e);
    const i = drag.index;
    const last = points.length - 1;
    const interior = i > 0 && i < last;
    const outside = y < -REMOVE_DIST || y > 1 + REMOVE_DIST || x < -REMOVE_DIST || x > 1 + REMOVE_DIST;
    if (interior && outside) {
      commit(points.filter((_, k) => k !== i), drag.key);
      drag = null;
      return;
    }
    // Extremos só sobem e descem; os do meio ficam entre os vizinhos.
    const nx = i === 0 ? 0 : i === last ? 1 : Math.min(points[i + 1][0] - MIN_GAP, Math.max(points[i - 1][0] + MIN_GAP, x));
    const ny = Math.min(1, Math.max(0, y));
    commit(points.map((p, k) => (k === i ? ([nx, ny] as const) : p)), drag.key);
  }

  function up() {
    drag = null;
  }
</script>

<div class="curves">
  <div class="channels">
    {#each CURVE_CHANNELS as ch (ch)}
      <button class:active={channel === ch} style:--c={COLORS[ch]} onclick={() => (channel = ch)}>
        {LABELS[ch]}{editor.curve(ch) ? ' •' : ''}
      </button>
    {/each}
    <button class="link reset" disabled={!editor.curve(channel)} onclick={() => commit([...IDENTITY_CURVE])}>Zerar</button>
  </div>
  <svg
    bind:this={svg}
    viewBox="0 0 1 1"
    preserveAspectRatio="none"
    role="application"
    aria-label="Curva {LABELS[channel]}: toque para adicionar ponto, arraste para fora para remover"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
  >
    {#each [0.25, 0.5, 0.75] as g (g)}
      <line x1={g} y1="0" x2={g} y2="1" class="grid" />
      <line x1="0" y1={g} x2="1" y2={g} class="grid" />
    {/each}
    <line x1="0" y1="1" x2="1" y2="0" class="diag" />
    <path d={path} style:stroke={COLORS[channel]} class="curve" />
    {#each points as [x, y], i (i)}
      <circle cx={x} cy={1 - y} r="0.025" style:fill={COLORS[channel]} />
    {/each}
  </svg>
</div>

<style>
  .curves {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
  }
  .channels {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .channels button:not(.reset) {
    font-size: 13px;
    padding: 4px 12px;
    border-radius: 999px;
    color: var(--c);
    border: 1px solid transparent;
  }
  .channels button.active {
    border-color: var(--c);
  }
  .reset {
    font-size: 13px;
    margin-left: 8px;
    color: var(--muted);
  }
  svg {
    width: min(70vw, 240px);
    aspect-ratio: 1;
    background: rgba(255, 255, 255, 0.04);
    touch-action: none;
    overflow: visible;
  }
  .grid {
    stroke: rgba(255, 255, 255, 0.1);
    stroke-width: 0.004;
  }
  .diag {
    stroke: rgba(255, 255, 255, 0.2);
    stroke-width: 0.004;
    stroke-dasharray: 0.02 0.02;
  }
  .curve {
    fill: none;
    stroke-width: 0.012;
  }
</style>
