/// <reference lib="webworker" />
/** Revela um RAW fora da thread principal (ver `raw.ts`). */
import { initWLibraw } from '@wasmedia/wlibraw';
import { decodeRawRgba } from './raw';

self.onmessage = async (e: MessageEvent<{ bytes: Uint8Array; maxSide: number }>) => {
  try {
    const img = decodeRawRgba(await initWLibraw(), e.data.bytes, e.data.maxSide);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ ok: true, img }, [img.data.buffer]);
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
