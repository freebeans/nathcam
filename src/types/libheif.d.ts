/** Tipos mínimos do libheif-js (build WASM em ES module). */
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  interface HeifImage {
    get_width(): number;
    get_height(): number;
    display(
      target: { data: Uint8ClampedArray; width: number; height: number },
      cb: (result: { data: Uint8ClampedArray; width: number; height: number } | null) => void,
    ): void;
    free?(): void;
  }
  interface LibHeif {
    HeifDecoder: new () => { decode(bytes: Uint8Array): HeifImage[] };
  }
  const factory: () => Promise<LibHeif>;
  export default factory;
}
