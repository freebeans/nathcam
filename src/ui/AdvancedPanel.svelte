<script lang="ts">
  import type { Editor } from '../app/editor.svelte';
  import { GRADING_ZONES, HSL_BANDS, HSL_BAND_CENTERS, type GradingZone, type HslBand } from '../engine/params';
  import CurveEditor from './CurveEditor.svelte';
  import ParamSlider from './ParamSlider.svelte';
  import Slider from './Slider.svelte';

  let { editor }: { editor: Editor } = $props();

  type Section = 'curves' | 'hsl' | 'grading' | 'calibration' | 'detail';
  const SECTIONS: { id: Section; label: string }[] = [
    { id: 'curves', label: 'Curvas' },
    { id: 'hsl', label: 'HSL' },
    { id: 'grading', label: 'Color grading' },
    { id: 'calibration', label: 'Calibração' },
    { id: 'detail', label: 'Detalhe' },
  ];
  let section = $state<Section>('curves');

  const BAND_LABEL: Record<HslBand, string> = {
    red: 'Vermelho',
    orange: 'Laranja',
    yellow: 'Amarelo',
    green: 'Verde',
    aqua: 'Água',
    blue: 'Azul',
    purple: 'Roxo',
    magenta: 'Magenta',
  };
  let band = $state<HslBand>('red');
  let bands = $derived(editor.hslBands());

  const ZONE_LABEL: Record<GradingZone, string> = { shadows: 'Sombras', midtones: 'Médios', highlights: 'Altas luzes' };
  let zone = $state<GradingZone>('shadows');

  const deg = (v: number) => `${Math.round(v)}°`;
</script>

<div class="advanced">
  <div class="sections" role="tablist">
    {#each SECTIONS as s (s.id)}
      <button role="tab" aria-selected={section === s.id} class:active={section === s.id} onclick={() => (section = s.id)}>{s.label}</button>
    {/each}
  </div>

  <div class="body">
    {#if section === 'curves'}
      <CurveEditor {editor} />
    {:else if section === 'hsl'}
      <div class="chips">
        {#each HSL_BANDS as b (b)}
          <button
            class="chip"
            class:active={band === b}
            style:--hue={HSL_BAND_CENTERS[b]}
            aria-label={BAND_LABEL[b]}
            onclick={() => (band = b)}
          ></button>
        {/each}
      </div>
      <p class="caption">{BAND_LABEL[band]}</p>
      <ParamSlider {editor} path="hsl.{band}.hue" label="Matiz" />
      <ParamSlider {editor} path="hsl.{band}.sat" label="Saturação" />
      <ParamSlider {editor} path="hsl.{band}.lum" label="Luminância" />
      <label class="toggle">
        <input type="checkbox" checked={!!bands} onchange={(e) => editor.setHslUnlocked(e.currentTarget.checked)} />
        Destravar faixas
      </label>
      {#if bands}
        {@const shape = bands[band]}
        <p class="note">Com faixas destravadas, o preset deixa de ser compatível com XMP.</p>
        <Slider label="Centro" value={shape.center} min={0} max={359} neutral={HSL_BAND_CENTERS[band]} format={deg} onchange={(v) => editor.setHslBand(band, { ...shape, center: v }, `band-${band}-center`)} />
        <Slider label="Largura" value={shape.width} min={5} max={120} neutral={shape.width} format={deg} onchange={(v) => editor.setHslBand(band, { ...shape, width: v }, `band-${band}-width`)} />
        <Slider
          label="Suavidade"
          value={Math.round(shape.softness * 100)}
          min={5}
          max={100}
          neutral={100}
          format={(v) => `${v}%`}
          onchange={(v) => editor.setHslBand(band, { ...shape, softness: v / 100 }, `band-${band}-soft`)}
        />
      {/if}
    {:else if section === 'grading'}
      <div class="zones">
        {#each GRADING_ZONES as z (z)}
          <button class:active={zone === z} onclick={() => (zone = z)}>{ZONE_LABEL[z]}</button>
        {/each}
      </div>
      <div class="hue-track"></div>
      <ParamSlider {editor} path="colorGrading.{zone}.hue" label="Matiz" format={deg} />
      <ParamSlider {editor} path="colorGrading.{zone}.sat" label="Saturação" />
      <ParamSlider {editor} path="colorGrading.{zone}.lum" label="Luminância" />
      <ParamSlider {editor} path="colorGrading.blending" label="Mistura" />
      <ParamSlider {editor} path="colorGrading.balance" label="Equilíbrio" />
    {:else if section === 'calibration'}
      <ParamSlider {editor} path="calibration.shadowsTint" label="Tom das sombras" />
      {#each [['red', 'Vermelho'], ['green', 'Verde'], ['blue', 'Azul']] as [p, name] (p)}
        <p class="caption">Primário {name.toLowerCase()}</p>
        <ParamSlider {editor} path="calibration.{p}.hue" label="Matiz" />
        <ParamSlider {editor} path="calibration.{p}.sat" label="Saturação" />
      {/each}
    {:else}
      <ParamSlider {editor} path="sharpening" label="Nitidez" />
      <ParamSlider {editor} path="texture" label="Textura" />
      <ParamSlider {editor} path="clarity" label="Clareza" />
      <ParamSlider {editor} path="grainSize" label="Tamanho do grão" />
    {/if}
  </div>
</div>

<style>
  .advanced {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sections {
    display: flex;
    gap: 16px;
    overflow-x: auto;
    padding: 0 16px;
  }
  .sections button {
    flex: 0 0 auto;
    font-size: 13px;
    color: var(--muted);
    padding: 4px 0;
    border-bottom: 2px solid transparent;
  }
  .sections button.active {
    color: var(--fg);
    border-bottom-color: var(--fg);
  }
  .body {
    padding: 0 16px;
    max-height: 34vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  .chips,
  .zones {
    display: flex;
    gap: 10px;
    justify-content: center;
    padding: 4px 0;
  }
  .chip {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    background: hsl(calc(var(--hue) * 1deg) 85% 55%);
    outline: 2px solid transparent;
    outline-offset: 2px;
  }
  .chip.active {
    outline-color: var(--fg);
  }
  .zones button {
    font-size: 13px;
    padding: 4px 12px;
    border-radius: 999px;
    background: var(--track);
    color: var(--muted);
  }
  .zones button.active {
    background: var(--fg);
    color: var(--bg);
  }
  .hue-track {
    height: 4px;
    margin: 8px 0 -2px;
    border-radius: 2px;
    background: linear-gradient(to right, red, yellow, lime, cyan, blue, magenta, red);
  }
  .caption {
    margin: 8px 0 0;
    font-size: 12px;
    color: var(--muted);
    text-align: center;
  }
  .note {
    margin: 0;
    font-size: 12px;
    color: var(--muted);
  }
  .toggle {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 14px;
    padding: 8px 0;
  }
</style>
