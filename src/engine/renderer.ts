/**
 * Renderer WebGL2: o único motor, usado na pré-visualização, nas miniaturas e
 * na exportação. TypeScript puro, sem dependência da interface.
 */
import type { Mat3 } from './color';
import { CURVE_LUT_SIZE } from './curves';
import type { Lut3D } from './cube';
import { fragmentShader, type PassId } from './pipeline';
import { planPasses, radiiFor, tilesFor, type Rect } from './regions';
import { VERTEX_SHADER } from './shaders/common';
import type { UniformData } from './uniforms';

export interface Frame {
  data: UniformData;
  lut: Lut3D | null;
  /** uv de saída -> uv da fonte (recorte/endireitamento). Padrão: identidade. */
  srcXform?: Mat3;
}

export interface Capabilities {
  /** Texturas intermediárias em float16 renderizáveis. */
  float16: boolean;
  /** Canvas exibe Display P3. */
  p3Display: boolean;
  /** Upload de textura converte para Display P3. */
  p3Upload: boolean;
  maxTextureSize: number;
}

type GL = WebGL2RenderingContext;
type UniformValue = number | readonly number[] | Float32Array;

interface UniformInfo {
  loc: WebGLUniformLocation;
  type: number;
  size: number;
}

interface Program {
  program: WebGLProgram;
  uniforms: Map<string, UniformInfo>;
}

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
  mips: boolean;
}

/** Pré-visualização (a, b) + miniaturas (a, b, out) + folga. */
const MAX_TARGETS = 6;
const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const UNIT = { src: 0, curves: 1, lut: 2, a: 3, b: 4 } as const;

function compile(gl: GL, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const numbered = src
      .split('\n')
      .map((l, i) => `${i + 1}: ${l}`)
      .join('\n');
    throw new Error(`Erro ao compilar shader: ${log}\n${numbered}`);
  }
  return sh;
}

function link(gl: GL, fs: string): Program {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Erro ao ligar programa: ${gl.getProgramInfoLog(program)}`);
  const uniforms = new Map<string, UniformInfo>();
  const n = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i)!;
    const name = info.name.replace(/\[0\]$/, '');
    uniforms.set(name, { loc: gl.getUniformLocation(program, info.name)!, type: info.type, size: info.size });
  }
  return { program, uniforms };
}

export class Renderer {
  readonly gl: GL;
  readonly caps: Capabilities;
  private programs: Record<PassId, Program>;
  private src: WebGLTexture | null = null;
  private srcSize = { w: 0, h: 0 };
  private srcIsSrgb = 0;
  private curvesTex: WebGLTexture;
  private identityCurves: WebGLTexture;
  private dummyLut: WebGLTexture;
  private luts = new WeakMap<Lut3D, WebGLTexture>();
  /** Alvos intermediários por papel e tamanho (pré-visualização e miniaturas alternam). */
  private targets = new Map<string, Target>();
  private vao: WebGLVertexArrayObject;

  constructor(
    readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    /** Força texturas intermediárias de 8 bits (para testar o caminho de fallback). */
    opts: { forceLowPrecision?: boolean } = {},
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    }) as GL | null;
    if (!gl) throw new Error('WebGL2 não está disponível neste navegador.');
    this.gl = gl;

    const float16 =
      !opts.forceLowPrecision && (!!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float'));
    let p3Display = false;
    if ('drawingBufferColorSpace' in gl) {
      try {
        gl.drawingBufferColorSpace = 'display-p3';
        p3Display = gl.drawingBufferColorSpace === 'display-p3';
      } catch {
        p3Display = false;
      }
    }
    let p3Upload = false;
    if ('unpackColorSpace' in gl) {
      try {
        gl.unpackColorSpace = 'display-p3';
        p3Upload = gl.unpackColorSpace === 'display-p3';
      } catch {
        p3Upload = false;
      }
    }
    this.caps = { float16, p3Display, p3Upload, maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number };

    this.programs = { A: link(gl, fragmentShader('A')), B: link(gl, fragmentShader('B')), C: link(gl, fragmentShader('C')) };
    this.vao = gl.createVertexArray()!;

    this.identityCurves = this.makeCurvesTexture(null);
    this.curvesTex = this.makeCurvesTexture(null);
    this.dummyLut = this.makeLutTexture({
      size: 2,
      domainMin: [0, 0, 0],
      domainMax: [1, 1, 1],
      data: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1]),
    });
  }

  get sourceSize(): { w: number; h: number } {
    return { ...this.srcSize };
  }

  /**
   * Carrega a foto (já orientada). Converte para Display P3 no upload, se
   * possível. `mipmaps: false` economiza ~1/3 da memória quando a fonte só
   * vai ser renderizada em escala 1:1 (exportação em resolução total).
   */
  setSource(image: TexImageSource & { width: number; height: number }, opts: { mipmaps?: boolean } = {}): void {
    const mipmaps = opts.mipmaps ?? true;
    const gl = this.gl;
    const w = image.width;
    const h = image.height;
    if (w > this.caps.maxTextureSize || h > this.caps.maxTextureSize)
      throw new Error(`Imagem ${w}x${h} excede o limite de textura (${this.caps.maxTextureSize}).`);
    if (this.src) gl.deleteTexture(this.src);
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = mipmaps ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, gl.SRGB8_ALPHA8, w, h);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.BROWSER_DEFAULT_WEBGL);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, image);
    if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.src = tex;
    this.srcSize = { w, h };
    this.srcIsSrgb = this.caps.p3Upload ? 0 : 1;
  }

  /** Desenha a imagem inteira no canvas, no tamanho de saída pedido. */
  draw(frame: Frame, outW: number, outH: number): void {
    const c = this.canvas;
    if (c.width !== outW || c.height !== outH) {
      c.width = outW;
      c.height = outH;
    }
    this.renderRegion(frame, outW, outH, { x: 0, y: 0, w: outW, h: outH }, null);
  }

  /**
   * Renderiza uma região da saída e devolve RGBA 8 bits em Display P3
   * (linha de cima primeiro).
   */
  read(frame: Frame, outW: number, outH: number, region: Rect = { x: 0, y: 0, w: outW, h: outH }): Uint8Array {
    const gl = this.gl;
    const out = this.target('out', region.w, region.h, gl.RGBA8, false);
    this.renderRegion(frame, outW, outH, region, out);
    const px = new Uint8Array(region.w * region.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
    gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
    gl.readPixels(0, 0, region.w, region.h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return px;
  }

  /** Renderiza a saída inteira em tiles (mesmo shader da pré-visualização). */
  async readTiled(
    frame: Frame,
    outW: number,
    outH: number,
    tileSize = 2048,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Uint8Array> {
    const full = new Uint8Array(outW * outH * 4);
    const tiles = tilesFor(outW, outH, tileSize);
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      const px = this.read(frame, outW, outH, t);
      for (let row = 0; row < t.h; row++) {
        full.set(px.subarray(row * t.w * 4, (row + 1) * t.w * 4), ((t.y + row) * outW + t.x) * 4);
      }
      onProgress?.(i + 1, tiles.length);
      // Devolve o controle ao navegador entre tiles.
      await new Promise((r) => setTimeout(r, 0));
    }
    this.releaseTargets();
    return full;
  }

  /** Libera as texturas intermediárias (útil após exportar em tamanho grande). */
  releaseTargets(): void {
    for (const t of this.targets.values()) this.deleteTarget(t);
    this.targets.clear();
  }

  private deleteTarget(t: Target): void {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fbo);
  }

  dispose(): void {
    this.releaseTargets();
    const gl = this.gl;
    if (this.src) gl.deleteTexture(this.src);
    for (const p of Object.values(this.programs)) gl.deleteProgram(p.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  private renderRegion(frame: Frame, outW: number, outH: number, region: Rect, out: Target | null): void {
    if (!this.src) throw new Error('Nenhuma imagem carregada.');
    const gl = this.gl;
    const radii = radiiFor(outW, outH);
    const plan = planPasses(region, radii);
    const lowp = this.caps.float16 ? 0 : 1;
    const interFormat = this.caps.float16 ? gl.RGBA16F : gl.RGBA8;
    const a = this.target('a', plan.a.w, plan.a.h, interFormat, true);
    const b = this.target('b', plan.b.w, plan.b.h, interFormat, false);

    this.uploadCurves(frame.data.curves);
    const lutTex = frame.lut ? this.lutTexture(frame.lut) : this.dummyLut;
    const u = frame.data.uniforms;

    const common = (origin: Rect, flip: number): Record<string, UniformValue> => ({
      u_outSize: [outW, outH],
      u_targetOrigin: [origin.x, origin.y],
      u_targetSize: [origin.w, origin.h],
      u_flipY: flip,
      u_lowp: lowp,
    });

    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    // Texturas: fonte, curvas e LUT ficam nas mesmas unidades em todos os passes.
    gl.activeTexture(gl.TEXTURE0 + UNIT.src);
    gl.bindTexture(gl.TEXTURE_2D, this.src);
    gl.activeTexture(gl.TEXTURE0 + UNIT.curves);
    gl.bindTexture(gl.TEXTURE_2D, frame.data.curves ? this.curvesTex : this.identityCurves);
    gl.activeTexture(gl.TEXTURE0 + UNIT.lut);
    gl.bindTexture(gl.TEXTURE_3D, lutTex);

    // Pass A
    this.run('A', a, plan.a, {
      ...u,
      ...common(plan.a, 0),
      u_src: UNIT.src,
      u_srcXform: frame.srcXform ?? IDENTITY,
      u_srcSrgb: this.srcIsSrgb,
    });
    gl.activeTexture(gl.TEXTURE0 + UNIT.a);
    gl.bindTexture(gl.TEXTURE_2D, a.tex);
    gl.generateMipmap(gl.TEXTURE_2D);

    // Pass B
    const lut = frame.lut;
    this.run('B', b, plan.b, {
      ...u,
      ...common(plan.b, 0),
      u_a: UNIT.a,
      u_aOrigin: [plan.a.x, plan.a.y],
      u_aSize: [plan.a.w, plan.a.h],
      u_textureRadius: radii.textureRadius,
      u_textureLod: radii.textureLod,
      u_clarityRadius: radii.clarityRadius,
      u_clarityLod: radii.clarityLod,
      u_curves: UNIT.curves,
      u_lut: UNIT.lut,
      u_lutMix: lut ? u.u_lutMix : 0,
      u_lutSize: lut ? lut.size : 2,
      u_lutDomainMin: lut ? lut.domainMin : [0, 0, 0],
      u_lutDomainMax: lut ? lut.domainMax : [1, 1, 1],
    });
    gl.activeTexture(gl.TEXTURE0 + UNIT.b);
    gl.bindTexture(gl.TEXTURE_2D, b.tex);

    // Pass C
    this.run('C', out, plan.c, {
      ...u,
      ...common(plan.c, out ? 0 : 1),
      u_b: UNIT.b,
      u_bOrigin: [plan.b.x, plan.b.y],
      u_bSize: [plan.b.w, plan.b.h],
      // Sempre proporcional: numa pré-visualização pequena o raio fica abaixo de
      // 1 px e o efeito some, como some na exportação vista nesse tamanho.
      u_sharpenRadius: radii.sharpenRadius,
      u_outP3: out ? 1 : this.caps.p3Display ? 1 : 0,
    });

    // Desvincula as intermediárias para que possam ser alvo no próximo frame.
    gl.activeTexture(gl.TEXTURE0 + UNIT.a);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0 + UNIT.b);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  private run(pass: PassId, target: Target | null, rect: Rect, values: Record<string, UniformValue>): void {
    const gl = this.gl;
    const p = this.programs[pass];
    gl.useProgram(p.program);
    for (const [name, info] of p.uniforms) {
      const v = values[name];
      if (v === undefined) throw new Error(`Uniform sem valor: ${name} (pass ${pass})`);
      this.setUniform(info, v);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
    gl.viewport(0, 0, rect.w, rect.h);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private setUniform(info: UniformInfo, v: UniformValue): void {
    const gl = this.gl;
    const arr = typeof v === 'number' ? [v] : v;
    switch (info.type) {
      case gl.FLOAT:
        gl.uniform1fv(info.loc, arr as Float32List);
        break;
      case gl.FLOAT_VEC2:
        gl.uniform2fv(info.loc, arr as Float32List);
        break;
      case gl.FLOAT_VEC3:
        gl.uniform3fv(info.loc, arr as Float32List);
        break;
      case gl.FLOAT_MAT3:
        // Nossas matrizes estão em ordem de linhas.
        gl.uniformMatrix3fv(info.loc, true, arr as Float32List);
        break;
      case gl.INT:
      case gl.SAMPLER_2D:
      case gl.SAMPLER_3D:
        gl.uniform1i(info.loc, arr[0]);
        break;
      default:
        throw new Error(`Tipo de uniform não suportado: ${info.type}`);
    }
  }

  private target(role: 'a' | 'b' | 'out', w: number, h: number, format: number, mips: boolean): Target {
    const gl = this.gl;
    const key = `${role}:${w}x${h}`;
    const cur = this.targets.get(key);
    if (cur) {
      // Reinsere para marcar como usado recentemente.
      this.targets.delete(key);
      this.targets.set(key, cur);
      return cur;
    }
    while (this.targets.size >= MAX_TARGETS) {
      const [oldest, t] = this.targets.entries().next().value!;
      this.deleteTarget(t);
      this.targets.delete(oldest);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, format, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`Framebuffer incompleto (${status}) para ${key} ${w}x${h}`);
    const t = { tex, fbo, w, h, mips };
    this.targets.set(key, t);
    return t;
  }

  private makeCurvesTexture(data: Float32Array | null): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let d = data;
    if (!d) {
      d = new Float32Array(CURVE_LUT_SIZE * 4);
      for (let i = 0; i < CURVE_LUT_SIZE; i++) d.fill(i / (CURVE_LUT_SIZE - 1), i * 4, i * 4 + 4);
    }
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, CURVE_LUT_SIZE, 1, 0, gl.RGBA, gl.FLOAT, d);
    return tex;
  }

  private lastCurves: Float32Array | null = null;
  private uploadCurves(data: Float32Array | null): void {
    if (!data || data === this.lastCurves) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.curvesTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, CURVE_LUT_SIZE, 1, 0, gl.RGBA, gl.FLOAT, data);
    this.lastCurves = data;
  }

  private makeLutTexture(lut: Lut3D): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private lutTexture(lut: Lut3D): WebGLTexture {
    let t = this.luts.get(lut);
    if (!t) {
      t = this.makeLutTexture(lut);
      this.luts.set(lut, t);
    }
    return t;
  }
}
