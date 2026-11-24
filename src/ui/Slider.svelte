<script lang="ts">
  interface Props {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    /** Valor de volta no toque duplo. */
    neutral?: number;
    format?: (v: number) => string;
    onchange: (v: number) => void;
  }

  let { label, value, min, max, step = 1, neutral = 0, format, onchange }: Props = $props();

  let lastTap = 0;

  function signed(v: number): string {
    const s = step < 1 ? v.toFixed(2) : String(Math.round(v));
    return v > 0 ? `+${s}` : s;
  }

  function onpointerdown() {
    const now = performance.now();
    if (now - lastTap < 300) {
      onchange(neutral);
      lastTap = 0;
    } else {
      lastTap = now;
    }
  }

  // Centro do preenchimento: o neutro, em porcentagem da trilha.
  const pct = (v: number) => ((v - min) / (max - min)) * 100;
  let fillFrom = $derived(Math.min(pct(neutral), pct(value)));
  let fillTo = $derived(Math.max(pct(neutral), pct(value)));
</script>

<label class="slider" class:changed={value !== neutral}>
  <span class="row">
    <span class="label">{label}</span>
    <span class="value">{format ? format(value) : signed(value)}</span>
  </span>
  <input
    type="range"
    {min}
    {max}
    {step}
    {value}
    style:--from="{fillFrom}%"
    style:--to="{fillTo}%"
    {onpointerdown}
    ondblclick={() => onchange(neutral)}
    oninput={(e) => onchange(Number(e.currentTarget.value))}
  />
</label>

<style>
  .slider {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 6px 0;
    user-select: none;
    -webkit-user-select: none;
  }
  .row {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
    color: var(--muted);
  }
  .changed .label,
  .changed .value {
    color: var(--fg);
  }
  .value {
    font-variant-numeric: tabular-nums;
  }
  input {
    -webkit-appearance: none;
    appearance: none;
    width: 100%;
    height: 28px;
    background: transparent;
    margin: 0;
    touch-action: pan-y;
  }
  input::-webkit-slider-runnable-track {
    height: 2px;
    background: linear-gradient(
      to right,
      var(--track) var(--from),
      var(--fg) var(--from),
      var(--fg) var(--to),
      var(--track) var(--to)
    );
  }
  input::-moz-range-track {
    height: 2px;
    background: var(--track);
  }
  input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 22px;
    height: 22px;
    margin-top: -10px;
    border-radius: 50%;
    background: var(--fg);
    border: none;
  }
  input::-moz-range-thumb {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: var(--fg);
    border: none;
  }
</style>
