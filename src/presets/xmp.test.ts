import { describe, expect, it } from 'vitest';
import { parseXmp } from './xmp';

/** Formato do Lightroom Classic: sliders como atributos, curvas e nome como elementos. */
const LR_CLASSIC = `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:PresetType="Normal"
   crs:Version="15.0"
   crs:ProcessVersion="11.0"
   crs:Exposure2012="+0.35"
   crs:Contrast2012="-12"
   crs:Highlights2012="-40"
   crs:Shadows2012="+25"
   crs:Whites2012="+5"
   crs:Blacks2012="-10"
   crs:IncrementalTemperature="+8"
   crs:IncrementalTint="-3"
   crs:Texture="+10"
   crs:Clarity2012="-5"
   crs:Dehaze="+4"
   crs:Vibrance="+15"
   crs:Saturation="-20"
   crs:HueAdjustmentBlue="-10"
   crs:SaturationAdjustmentBlue="-30"
   crs:LuminanceAdjustmentOrange="+12"
   crs:ColorGradeShadowHue="210"
   crs:ColorGradeShadowSat="18"
   crs:ColorGradeShadowLum="-4"
   crs:ColorGradeMidtoneHue="35"
   crs:ColorGradeMidtoneSat="6"
   crs:ColorGradeHighlightHue="48"
   crs:ColorGradeHighlightSat="22"
   crs:ColorGradeBlending="70"
   crs:SplitToningBalance="-15"
   crs:GrainAmount="22"
   crs:GrainSize="30"
   crs:GrainFrequency="50"
   crs:PostCropVignetteAmount="-18"
   crs:Sharpness="40"
   crs:RedHue="+6"
   crs:RedSaturation="+10"
   crs:BlueHue="-15"
   crs:BlueSaturation="+20"
   crs:ShadowTint="+5"
   crs:CameraProfile="Adobe Standard"
   crs:LensProfileEnable="1"
   crs:HasCrop="True"
   crs:CropTop="0.1">
   <crs:Name>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">Filme Quente 01</rdf:li>
    </rdf:Alt>
   </crs:Name>
   <crs:Group>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">Meus filmes</rdf:li>
    </rdf:Alt>
   </crs:Group>
   <crs:ToneCurvePV2012>
    <rdf:Seq>
     <rdf:li>0, 18</rdf:li>
     <rdf:li>64, 60</rdf:li>
     <rdf:li>192, 200</rdf:li>
     <rdf:li>255, 245</rdf:li>
    </rdf:Seq>
   </crs:ToneCurvePV2012>
   <crs:ToneCurvePV2012Blue>
    <rdf:Seq>
     <rdf:li>0, 12</rdf:li>
     <rdf:li>255, 255</rdf:li>
    </rdf:Seq>
   </crs:ToneCurvePV2012Blue>
   <crs:ToneCurvePV2012Red>
    <rdf:Seq>
     <rdf:li>0, 0</rdf:li>
     <rdf:li>255, 255</rdf:li>
    </rdf:Seq>
   </crs:ToneCurvePV2012Red>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;

/** Formato antigo/alternativo: valores como elementos e split toning. */
const ELEMENTS = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/">
 <crs:Exposure2012>-0.50</crs:Exposure2012>
 <crs:Temperature>4500</crs:Temperature>
 <crs:Tint>+15</crs:Tint>
 <crs:SplitToningShadowHue>200</crs:SplitToningShadowHue>
 <crs:SplitToningShadowSaturation>25</crs:SplitToningShadowSaturation>
 <crs:SplitToningHighlightHue>45</crs:SplitToningHighlightHue>
 <crs:SplitToningHighlightSaturation>10</crs:SplitToningHighlightSaturation>
 <crs:ParametricShadows>+20</crs:ParametricShadows>
 <crs:Name>Simples</crs:Name>
</rdf:Description></rdf:RDF></x:xmpmeta>`;

describe('parseXmp', () => {
  const r = parseXmp(LR_CLASSIC, 'arquivo.xmp');

  it('lê nome e grupo', () => {
    expect(r.name).toBe('Filme Quente 01');
    expect(r.group).toBe('Meus filmes');
  });

  it('mapeia tom, balanço de branco e presença', () => {
    expect(r.params).toMatchObject({
      exposure: 0.35,
      contrast: -12,
      highlights: -40,
      shadows: 25,
      whites: 5,
      blacks: -10,
      temperature: 8,
      tint: -3,
      texture: 10,
      clarity: -5,
      vibrance: 15,
      saturation: -20,
    });
  });

  it('mapeia HSL nas 8 faixas', () => {
    expect(r.params.hsl?.blue).toEqual({ hue: -10, sat: -30 });
    expect(r.params.hsl?.orange).toEqual({ lum: 12 });
  });

  it('mapeia color grading de 3 vias, mistura e balanço', () => {
    expect(r.params.colorGrading).toEqual({
      shadows: { hue: 210, sat: 18, lum: -4 },
      midtones: { hue: 35, sat: 6 },
      highlights: { hue: 48, sat: 22 },
      blending: 70,
      balance: -15,
    });
  });

  it('mapeia efeitos, nitidez e calibração', () => {
    expect(r.params).toMatchObject({ grain: 22, grainSize: 30, vignette: -18, sharpening: 40 });
    expect(r.params.calibration).toEqual({ red: { hue: 6, sat: 10 }, blue: { hue: -15, sat: 20 }, shadowsTint: 5 });
  });

  it('converte curvas de 0..255 para 0..1 e descarta as que são identidade', () => {
    expect(r.params.curves?.luma).toEqual([
      [0, 18 / 255],
      [64 / 255, 60 / 255],
      [192 / 255, 200 / 255],
      [1, 245 / 255],
    ]);
    expect(r.params.curves?.blue).toEqual([
      [0, 12 / 255],
      [1, 1],
    ]);
    expect(r.params.curves?.red).toBeUndefined();
  });

  it('avisa o que foi ignorado', () => {
    expect(r.ignored).toEqual(expect.arrayContaining(['perfil de câmera', 'correção de lente', 'recorte', 'desembaçar']));
  });

  it('aceita valores como elementos, Kelvin absoluto e split toning antigo', () => {
    const e = parseXmp(ELEMENTS, 'x.xmp');
    expect(e.name).toBe('Simples');
    expect(e.params.exposure).toBe(-0.5);
    // 4500 K deixa a foto mais fria que a luz do dia (5500 K)
    expect(e.params.temperature).toBeLessThan(-10);
    expect(e.params.tint).toBeCloseTo(10);
    expect(e.params.colorGrading?.shadows).toEqual({ hue: 200, sat: 25 });
    expect(e.params.colorGrading?.highlights).toEqual({ hue: 45, sat: 10 });
    expect(e.ignored).toContain('curva paramétrica');
  });

  it('usa o nome do arquivo quando o XMP não tem nome', () => {
    expect(parseXmp('<x:xmpmeta><rdf:Description crs:Exposure2012="+1"/></x:xmpmeta>', 'Meu Look.xmp').name).toBe('Meu Look');
  });

  it('rejeita arquivos que não são preset do Lightroom', () => {
    expect(() => parseXmp('<html></html>', 'a.xmp')).toThrow(/Lightroom/);
  });

  it('limita valores fora da faixa', () => {
    expect(parseXmp('<x crs:Exposure2012="+9" crs:Contrast2012="300"/>', 'a.xmp').params).toMatchObject({ exposure: 5, contrast: 100 });
  });
});
