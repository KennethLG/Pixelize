// Runs the pipeline off the main thread. Each source image is sent once and
// cached here (with its edge profiles), then reprocessed as settings change.

import { processImage, type ProcessOptions } from './core/pipeline';
import type { GridCache, SourceImage } from './core/grid';

interface Request {
  type: 'process' | 'drop';
  id: number;
  srcId: number;
  w: number;
  h: number;
  data?: ArrayBuffer;
  opts: ProcessOptions;
}

const sources = new Map<number, SourceImage & { cache: GridCache }>();
const post = (msg: unknown, transfer: Transferable[] = []) =>
  (self as unknown as { postMessage(m: unknown, t: Transferable[]): void }).postMessage(msg, transfer);

self.onmessage = (e: MessageEvent<Request>) => {
  const m = e.data;
  if (m.type === 'drop') { sources.delete(m.srcId); return; }
  try {
    let src = sources.get(m.srcId);
    if (!src) {
      if (!m.data) throw new Error('lost source');
      src = { data: new Uint8ClampedArray(m.data), w: m.w, h: m.h, cache: {} };
      sources.set(m.srcId, src);
    }
    const out = processImage(src, src.cache, m.opts);
    post({ id: m.id, out }, [out.pixels.buffer, out.preBg.buffer]);
  } catch (err) {
    post({ id: m.id, error: err instanceof Error ? err.message : String(err) });
  }
};
