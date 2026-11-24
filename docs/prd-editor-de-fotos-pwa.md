# PRD — Editor de fotos PWA (estilo VSCO)

Nov 23, 2026 · @Filipe

## Visão

Um editor de fotos web, instalável como PWA no iPhone e no Android, centrado em presets ao estilo VSCO, com ferramentas que se revelam em três níveis. Roda inteiramente no navegador: a hospedagem serve só arquivos estáticos.

- **Público:** uso próprio da autora (fotógrafa). Nomes de presets podem citar marcas (ex.: C1, A6).
- **Princípio de produto:** o preset é o centro; ajustes finos existem, mas aparecem só quando pedidos.
- **Princípio técnico:** um único motor de render na GPU, usado tanto na pré-visualização quanto na exportação, para que o que se vê seja o que se exporta.

## Escopo

O produto cobre ajustes globais, recorte e endireitamento sobre fotos JPEG, PNG e HEIC, sem nenhum back-end.

**Dentro:**

- Abrir fotos do rolo da câmera ou de arquivos (JPEG, PNG; HEIC via libheif em WASM carregado sob demanda).
- Presets com intensidade, ajustes globais em três níveis, recorte e endireitamento.
- Biblioteca leve local, histórico persistente, copiar e colar ajustes em lote.
- Importação de presets `.json`, LUTs `.cube` e presets `.xmp` do Lightroom.
- Exportação JPEG em Display P3, por compartilhamento ou download.

**Fora (por enquanto):**

- RAW (DNG, ARW, CR3 etc.).
- Ajustes locais: pincel, máscaras lineares e radiais, máscaras de sujeito.
- Ferramentas de IA, retoque, clonagem.
- Sincronização entre aparelhos, contas, qualquer servidor além da hospedagem estática.
- Importar perfis de câmera do Lightroom.

## Experiência

O editor tem três níveis fixos, sempre a um toque de distância, e o recorte vive num botão próprio, sempre visível, porque independe do preset.

| Nível | Controles |
| --- | --- |
| 1. Presets | Grade de miniaturas renderizadas na própria foto; packs como abas; favoritos; ocultar; busca por nome; intensidade 0–100% |
| 2. Básico | Exposição, contraste, altas luzes, sombras, brancos, pretos, temperatura, tonalidade, saturação, vibração, fade, grão, vinheta |
| 3. Avançado | Curvas (luminância, R, G, B); HSL em 8 faixas; color grading de 3 vias; calibração; nitidez; textura; clareza |
| Recorte (botão) | Recorte livre e por proporção, endireitamento, girar e espelhar |

**HSL:** 8 faixas fixas compatíveis com o Lightroom (vermelho, laranja, amarelo, verde, água/ciano, azul, roxo, magenta), cada uma com matiz, saturação e luminância. Uma opção "destravar faixas" permite ajustar centro, largura e suavidade de cada faixa; um preset com faixas destravadas deixa de ser compatível com XMP.

**Gestos:**

- Segurar o dedo na foto mostra o original.
- Pinça com dois dedos dá zoom e movimento; a região ampliada é renderizada em resolução maior.
- Toque duplo num slider o volta para o neutro.
- No nível 3, botão de antes/depois com divisória arrastável.

**Sliders:** com camadas (ver Presets), os sliders do nível 2 e 3 mostram o valor da camada do usuário, relativo ao preset. No modo "achatado" mostram valores absolutos.

## Presets

Um preset é uma receita completa em JSON: parâmetros de todos os ajustes, uma LUT opcional com seu espaço de cor, e uma referência opcional a um preset pai.

```json
{
  "id": "cssco-c1",
  "name": "C1",
  "pack": "cssco",
  "extends": null,
  "params": { "exposure": 0.1, "contrast": -8, "hsl": { "blue": { "sat": -15 } } },
  "lut": { "src": "luts/cssco-c1.cube", "colorSpace": "srgb" },
  "engineVersion": 1
}
```

**Camadas.** Cada foto tem duas camadas somadas: o preset (com intensidade) embaixo e os ajustes do usuário por cima. Trocar de preset mantém os ajustes do usuário e o recorte.

**Intensidade.** Escala cada parâmetro do preset em direção ao neutro (exposição +1 a 50% = +0,5) e mistura apenas a saída da LUT com a entrada dela. Não afeta a camada do usuário.

**Edição do preset:**

- *Achatar:* funde preset e ajustes numa só camada naquela foto; sliders passam a mostrar valores absolutos.
- *Editar o preset:* modo em que os sliders mexem na receita do preset. Presets do servidor são somente leitura: editar cria uma cópia local ("C1 (meu)").
- Fotos guardam uma cópia da receita do preset aplicado, então editar um preset depois não altera fotos já editadas.

**Herança.** Arquivos no repositório podem usar `extends` (herança viva, resolvida no build ou no carregamento). Presets salvos pelo app gravam a receita achatada, sem `extends`.

**Organização.** Packs como abas (ex.: cssco, comunidade, meus), favoritos no topo, ocultar preset ou pack inteiro, busca por nome.

**Origem dos presets:**

- No deploy: os 14 do cssco convertidos para `.cube` (MIT) e os presets autorais.
- Importados localmente no aparelho: recriações de VSCO da comunidade em `.cube` e `.xmp`. Não vão para o repositório, para não redistribuir material de terceiros.

## Motor de renderização

Um único motor WebGL2, escrito em TypeScript puro e sem dependência da interface, aplica a receita numa ordem fixa, tanto na pré-visualização quanto na exportação.

**Ordem do pipeline** (cada etapa em P3 linear, salvo indicação):

1. Decodificação e conversão para P3 linear (respeitando o perfil ICC de origem).
2. Calibração aproximada: matiz e saturação dos primários R, G, B e tom das sombras.
3. Balanço de branco: temperatura e tonalidade.
4. Tom: exposição, contraste, altas luzes, sombras, brancos, pretos.
5. Textura e clareza (operações de vizinhança).
6. Curvas: luminância e R, G, B.
7. HSL de 8 faixas (ou faixas destravadas).
8. Color grading de 3 vias.
9. Vibração e saturação.
10. LUT: compressão de gama para dentro do sRGB e aplicação da LUT sRGB, ou LUT P3 direta; saída misturada pela intensidade.
11. Fade, grão, vinheta.
12. Nitidez.
13. Codificação para Display P3 com curva de transferência.

**Camadas e intensidade** se resolvem antes do shader: a CPU calcula os parâmetros efetivos (preset escalado + ajustes do usuário) e passa um único conjunto de uniforms.

**Pré-visualização.** Renderiza numa textura do tamanho da tela (com zoom, renderiza a região visível em resolução maior). Miniaturas dos presets usam um proxy de \~160 px e ficam em cache.

**Exportação.** O mesmo shader percorre a foto em resolução total em tiles de \~2048 px, com margem de sobreposição para as etapas de vizinhança (textura, clareza, nitidez). Os pixels lidos vão para um codificador JPEG em WASM (ex.: MozJPEG via jSquash), sem passar por `canvas.toBlob`, contornando o limite de área de canvas do Safari iOS.

**Escala.** Grão, textura, clareza e nitidez são parametrizados em proporção à imagem (ex.: tamanho do grão = 0,05% da largura), para que pré-visualização e exportação tenham a mesma aparência.

**Precisão.** Texturas intermediárias em ponto flutuante de 16 bits quando disponíveis, com fallback para 8 bits e dithering.

**Versão do motor.** Cada receita guarda `engineVersion`. Mudanças que alterem o resultado de receitas antigas incrementam a versão e mantêm um caminho de compatibilidade.

## Gestão de cor

O espaço de trabalho é Display P3 linear do começo ao fim, e a saída é JPEG com perfil ICC Display P3 embutido.

- **Entrada:** fotos P3 (iPhone) entram como estão; fotos sRGB (maioria do Android) são convertidas para P3. O upload da textura usa `unpackColorSpace = "display-p3"` quando disponível.
- **Tela:** o canvas WebGL usa `drawingBufferColorSpace = "display-p3"`, com fallback para sRGB em navegadores sem suporte.
- **LUTs sRGB** (cssco, comunidade): antes da LUT, uma compressão suave de gama puxa gradualmente as cores mais saturadas para dentro do sRGB, preservando a variação entre elas (mesma ideia do gamut compress do ACES). A LUT então é aplicada em sRGB e o resultado volta para P3. Assim o look fica fiel ao original, sem costuras em degradês.
- **LUTs P3:** presets com `lut.colorSpace = "display-p3"` passam direto, sem compressão nem perda.
- **Não fazer:** converter LUTs sRGB para P3 por extrapolação (risco de desvio de matiz, costuras em degradês e saturação contrária à intenção do look).

## Dados e armazenamento

Tudo fica no IndexedDB do aparelho, tratado como área de trabalho: o original continua no rolo da câmera.

| Store | Conteúdo |
| --- | --- |
| photos | Cópia do arquivo original (Blob), miniatura, dimensões, EXIF lido, data de importação |
| recipes | Receita atual da foto: cópia do preset aplicado, intensidade, camada do usuário, recorte, `engineVersion` |
| history | Até \~100 passos por foto; passos seguidos no mesmo slider viram um só |
| presets | Presets locais (criados, copiados ou importados), packs, favoritos, ocultos |
| luts | LUTs locais em binário (Float32 ou Uint16), não em texto |

- Camada fina sobre o IndexedDB (Dexie ou idb-keyval). Nada em localStorage além de preferências mínimas de interface.
- Ao abrir, o app pede armazenamento persistente (`navigator.storage.persist()`), sem contar com isso.
- **Backup:** exportar e importar um `.zip` com presets, packs, favoritos e LUTs locais. A biblioteca (fotos e receitas) não entra no backup.

## Importação e exportação

O app importa três formatos de preset e exporta JPEG P3 com EXIF, por compartilhamento ou download.

**Imagens de entrada:** JPEG e PNG nativos; HEIC via libheif (WASM, \~1 MB) carregado só quando um HEIC chega.

**Presets:**

| Formato | Como entra |
| --- | --- |
| `.json` próprio | Direto, validado por schema |
| `.cube` | Vira um preset com só a LUT (tamanhos 17³, 33³, 65³), `colorSpace` sRGB por padrão |
| `.xmp` (Lightroom/Camera Raw) | Sliders mapeados para os controles equivalentes: tom, balanço de branco, curvas, HSL, color grading/split toning, vibração, saturação, textura, clareza, grão, vinheta, nitidez, calibração. Perfil de câmera, correções de lente, máscaras e recorte são ignorados |

O resultado de um XMP importado é uma aproximação: as fórmulas da Adobe não são públicas.

**Exportação:**

- JPEG em Display P3 com perfil ICC embutido, qualidade ajustável.
- EXIF copiado do original (data, câmera, lente), com opção de remover a localização.
- Destino: menu de compartilhamento (Web Share API com arquivos, onde há "Salvar imagem" no iOS) ou download comum. Os dois sempre disponíveis.
- v1: lado maior limitado (ex.: 4096 px). Depois: resolução total por tiles.

**Copiar e colar ajustes:** copiar de uma foto e colar escolhendo grupos (preset e intensidade, luz, cor, curvas, HSL, color grading, efeitos, detalhe). Recorte desmarcado por padrão. Colar em várias fotos selecionadas da biblioteca de uma vez.

## Stack, deploy e atualização

Vite + TypeScript + Svelte 5, publicado como site estático com service worker; código público.

- **Interface:** Svelte 5. **Motor:** TypeScript puro + GLSL (WebGL2), num pacote separado da interface. **PWA:** `vite-plugin-pwa`.
- **Testes:** Vitest para lógica (parsers de `.cube` e `.xmp`, resolução de camadas e herança); testes de imagem de referência rodando o motor num navegador headless (Playwright) e comparando com tolerância.
- **Presets oficiais:** arquivos estáticos em `public/presets/*.json`, `public/luts/*.cube` e um `manifest.json` gerado no build. Adicionar preset oficial = commit + deploy. O service worker os guarda em cache para uso offline.
- **Conversão do cssco:** script único, fora do app, que aplica cada filtro do cssco sobre uma imagem-identidade HaldCLUT num Chrome headless e grava os `.cube`.
- **Hospedagem:** GitHub Pages (`freebeans.github.io/nathcam`), com HTTPS e deploy a cada push na main (`.github/workflows/deploy.yml`).
- **Atualização:** automática. A versão nova é baixada em segundo plano e só passa a valer quando o app é aberto do zero, nunca recarregando uma edição aberta.
- **Licenças:** código do app sob licença aberta; cssco é MIT (manter aviso de copyright). Presets da comunidade nunca entram no repositório.

## Roadmap

A v1 utilizável termina na fase 3; as fases seguintes completam o escopo deste PRD.

1. **Motor:** pipeline WebGL2 completo (todas as etapas, mesmo sem interface para todas), testes de imagem de referência.
2. **Presets base:** script de conversão do cssco e os 14 `.cube`; formato JSON e `manifest.json`.
3. **Editor mínimo (v1):** abrir foto, nível 1 com intensidade, nível 2, segurar para ver o original, exportar por compartilhamento e download em resolução limitada; PWA instalável e offline.
4. **Biblioteca:** IndexedDB, histórico persistente, recorte e endireitamento.
5. **Avançado:** nível 3, destravar faixas HSL, importação `.cube` e `.xmp`, presets locais, edição e achatamento de preset, organização (packs, favoritos, ocultar, busca).
6. **Fluxo de série:** copiar e colar seletivo em lote, backup `.zip`, exportação em resolução total por tiles, HEIC.

**Critérios de aceite da v1:**

- [ ] Instala na tela inicial do iPhone (Safari) e do Android (Chrome) e abre sem rede.
- [ ] Uma foto de 12 MP abre e mostra a grade de presets em menos de 2 s num iPhone recente.
- [ ] Arrastar qualquer slider do nível 2 atualiza a pré-visualização a pelo menos 30 fps.
- [ ] A exportação é visualmente idêntica à pré-visualização (teste de referência com tolerância).
- [ ] O JPEG exportado abre no app Fotos com perfil Display P3 e EXIF preservado.

## Riscos e pontos em aberto

Os maiores riscos estão no Safari do iPhone (memória, cor e armazenamento) e na fidelidade dos presets importados.

| Risco | Mitigação |
| --- | --- |
| Limites de memória e de área de canvas no Safari iOS | Pré-visualização em resolução de tela; exportação por tiles; codificador JPEG em WASM |
| iOS apagar o IndexedDB de PWAs pouco usadas | Pedir armazenamento persistente; backup `.zip` dos presets; originais ficam no rolo |
| Suporte desigual a P3 e a texturas float entre aparelhos | Detectar recursos e cair para sRGB ou 8 bits com dithering |
| XMPs não batem com o Lightroom | Tratar como aproximação; calibração aproximada; testes com presets reais |
| Atualização automática mudar o cálculo de receitas antigas | `engineVersion` na receita e caminho de compatibilidade |

**Em aberto:**

- Nome do app.
- Fórmulas exatas da compressão de gama e da calibração (definir na fase 1 com imagens de teste).
- Confirmar em aparelhos reais o limite de área de canvas e o tamanho máximo de textura WebGL no iOS.

## Referências

Projetos abertos usados como leitura de referência (nenhum é base de fork):

- [cssco](https://github.com/ughnett/cssco): filtros VSCO em CSS, MIT; fonte dos 14 presets iniciais.
- [lut-studio](https://github.com/shisongsong/lut-studio): editor de LUT em WebGL2 puro, MIT; referência de renderer e bottom sheet no celular.
- [Lightframes](https://github.com/joancomadran/lightframes/releases/tag/v1.0.0): editor PWA MIT; referência do mapeamento de XMP para sliders.
- [LUMA](https://github.com/manfriendsss/Luma): editor WebGL2 MIT; referência de exportação em Web Worker com OffscreenCanvas e importação de XMP.
- [AgX](https://docs.rs/crate/agx-photo/latest): biblioteca Rust "preset-first"; referência do formato de preset com herança.
