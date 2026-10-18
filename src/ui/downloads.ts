// Saving files. Inside a Claude artifact, downloads go through the viewer's
// `downloads` capability (it asks the viewer to confirm); opened as a local
// file, a normal download link works.

import { app } from './app';
import { setStatus } from './dom';
import { settings } from './settings';

interface DownloadsApi { save(req: { filename: string; data: Blob }): Promise<unknown> }
declare global {
  interface Window { claude?: { use(name: string): Promise<unknown> } }
}

let downloads: DownloadsApi | null | undefined;
let downloadsReady: Promise<void> | null = null;

export const baseName = () =>
  (app.source?.name || 'pixelart').replace(/\.[^.]+$/, '').replace(/[^\w.-]+/g, '_') || 'pixelart';
export const scaleValue = () => Math.max(1, Math.min(64, Math.round(settings.scale) || 1));

export const canvasBlob = (c: HTMLCanvasElement) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the PNG.'))), 'image/png'));
export const canvasBytes = async (c: HTMLCanvasElement) => new Uint8Array(await (await canvasBlob(c)).arrayBuffer());

export function scaledCanvas(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = src.width * scale;
  c.height = src.height * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  if (downloadsReady) await downloadsReady;
  if (downloads) {
    try {
      await downloads.save({ filename, data: blob });
      setStatus(`Saved ${filename}`);
    } catch (e) {
      if ((e as { code?: string })?.code !== 'declined') setStatus("Couldn't save the file here.", true);
    }
    return;
  }
  if (downloads === null) {
    setStatus("This view can't download files. Right-click the image › Save image.", true);
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  setStatus(`Saved ${filename}`);
}

export async function downloadResult(scale: number): Promise<void> {
  if (!app.result) return;
  const filename = scale === 1 ? `${baseName()}_pixel.png` : `${baseName()}_pixel_x${scale}.png`;
  await saveBlob(await canvasBlob(scaledCanvas(app.resultCanvas, scale)), filename);
}

export function initDownloads(): void {
  if (window.claude && typeof window.claude.use === 'function') {
    downloadsReady = window.claude.use('downloads').then(
      (d) => { downloads = d as DownloadsApi | null; },
      () => { downloads = null; },
    );
  }
}
