// Getting images in: file picker, drag and drop, paste, and the sample.

import { fakePixelArt, lanternSheet } from '../core/fake';
import type { SourceImage } from '../core/grid';
import { setSource } from './app';
import { $, field, setStatus } from './dom';

export function imageToData(drawable: CanvasImageSource & { width: number; height: number }): SourceImage & { img: HTMLCanvasElement } {
  const w = (drawable as HTMLImageElement).naturalWidth || drawable.width;
  const h = (drawable as HTMLImageElement).naturalHeight || drawable.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(drawable, 0, 0);
  return { data: ctx.getImageData(0, 0, w, h).data, w, h, img: c };
}

export function decodeFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { resolve(img); URL.revokeObjectURL(url); };
    img.onerror = () => { reject(new Error("Couldn't read the image. Try another format.")); URL.revokeObjectURL(url); };
    img.src = url;
  });
}

function load(drawable: CanvasImageSource & { width: number; height: number }, name: string, isSample: boolean): void {
  const src = imageToData(drawable);
  $('srcTag').textContent = isSample ? 'Sample' : '';
  $('srcName').textContent = isSample
    ? 'Loaded: generated sample (a 4-frame lantern spritesheet blown up to ~16 px per pixel, with noise).'
    : `Loaded: ${name}`;
  const maxCell = String(Math.max(8, Math.floor(Math.min(src.w, src.h) / 4)));
  field('cellXr').max = maxCell;
  field('cellYr').max = maxCell;
  setSource({ ...src, name, isSample });
}

export async function loadFile(file: File | null | undefined): Promise<void> {
  if (!file || !file.type.startsWith('image/')) { setStatus("That file isn't an image. Use PNG, JPG or WebP.", true); return; }
  try { load(await decodeFile(file), file.name || 'pasted image', false); }
  catch (err) { setStatus((err as Error).message, true); }
}

export function sampleCanvas(): HTMLCanvasElement {
  const { data, w, h } = fakePixelArt(lanternSheet());
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(data, w, h), 0, 0);
  return c;
}

export const loadSample = () => load(sampleCanvas(), 'lantern', true);

export function initInput(): void {
  const drop = $('drop'), file = field('file');
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
  file.addEventListener('change', () => { loadFile(file.files?.[0]); file.value = ''; });
  for (const t of ['dragenter', 'dragover']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); });
  for (const t of ['dragleave', 'drop']) drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', (e) => loadFile((e as DragEvent).dataTransfer?.files[0]));
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (e.target !== drop && f) loadFile(f);
  });
  document.addEventListener('paste', (e) => {
    if ((e.target as HTMLElement).matches?.('input[type="text"]')) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });
}
