// Client side of the worker. Heavy work (edge detection, sampling, palette)
// runs off the main thread so big images do not freeze the page; if workers
// are unavailable the same pipeline runs here instead.

import CoreWorker from '../worker?worker&inline';
import { processImage, type ProcessOptions, type ProcessResult } from '../core/pipeline';
import type { GridCache, SourceImage } from '../core/grid';

export interface WorkSource extends SourceImage {
  id: number;
  cache?: GridCache;
}

interface Pending {
  resolve: (r: ProcessResult) => void;
  reject: (e: Error) => void;
  src: WorkSource;
  opts: ProcessOptions;
}

let worker: Worker | null = null;
let reqSeq = 0;
const pending = new Map<number, Pending>();
const sentIds = new Set<number>();

const runHere = (src: WorkSource, opts: ProcessOptions) => processImage(src, (src.cache ??= {}), opts);

export function startWorker(): void {
  try {
    worker = new CoreWorker();
    worker.onmessage = (e: MessageEvent<{ id: number; out?: ProcessResult; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error === 'lost source') {
        sentIds.delete(p.src.id);
        processAsync(p.src, p.opts).then(p.resolve, p.reject);
      } else if (e.data.error) p.reject(new Error(e.data.error));
      else p.resolve(e.data.out!);
    };
    worker.onerror = (e) => { e.preventDefault(); fallBackToMainThread(); };
  } catch {
    worker = null;
  }
}

function fallBackToMainThread(): void {
  worker?.terminate();
  worker = null;
  for (const [id, p] of pending) {
    pending.delete(id);
    try { p.resolve(runHere(p.src, p.opts)); } catch (err) { p.reject(err as Error); }
  }
}

export function processAsync(src: WorkSource, opts: ProcessOptions): Promise<ProcessResult> {
  if (!worker) {
    return new Promise((resolve, reject) => setTimeout(() => {
      try { resolve(runHere(src, opts)); } catch (err) { reject(err); }
    }, 0));
  }
  const w = worker;
  return new Promise((resolve, reject) => {
    const id = ++reqSeq;
    pending.set(id, { resolve, reject, src, opts });
    const msg: Record<string, unknown> = { type: 'process', id, srcId: src.id, w: src.w, h: src.h, opts };
    const transfer: Transferable[] = [];
    if (!sentIds.has(src.id)) {
      // send a copy once; the worker keeps it for later runs
      const copy = src.data.slice();
      msg.data = copy.buffer;
      transfer.push(copy.buffer);
      sentIds.add(src.id);
    }
    w.postMessage(msg, transfer);
  });
}

export function dropSource(src: WorkSource | null): void {
  if (src && worker && sentIds.has(src.id)) {
    worker.postMessage({ type: 'drop', srcId: src.id });
    sentIds.delete(src.id);
  }
}

export const isBusy = () => pending.size > 0;
export const usingWorker = () => worker !== null;
