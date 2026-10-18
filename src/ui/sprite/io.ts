// Getting sprites in and out: new sprite, canvas size, opening images and
// project files, exports (PNG, GameMaker strip, GIF), the clipboard and the
// autosave that brings the last sprite back next time.

import { extract, newBitmap, renderFloating, type Bitmap } from '../../core/bitmap';
import { DEFAULT_DURATION, composite, createDoc, parseDoc, resizeCanvas, serializeDoc, type SpriteDoc } from '../../core/sprite';
import { encodeGif } from '../../export/gif';
import { $, field, int, setStatus, wait } from '../dom';
import { canvasBlob, saveBlob } from '../downloads';
import { decodeFile, imageToData } from '../input';
import { viewCenter } from './canvas';
import { cel, commitFloating, emit, floatPiece, on, pushCel, pushDoc, setDoc, setTool, sp } from './state';

const SAVE_KEY = 'pixelize.sprite.doc';
const MAX_SIDE = 2048;

const isBlank = (d: SpriteDoc) => d.frames.every((f) => f.cels.every((c) => !c.px.some((v, i) => i % 4 === 3 && v)));
const safeName = (n: string) => n.replace(/\.[^.]+$/, '').replace(/_strip\d+$/i, '').replace(/[^\w.-]+/g, '_') || 'sprite';

function frameCanvas(fi: number, scale = 1): HTMLCanvasElement {
  const { w, h } = sp.doc;
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  src.getContext('2d')!.putImageData(new ImageData(composite(sp.doc, fi), w, h), 0, 0);
  if (scale === 1) return src;
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

const exportScale = () => Math.max(1, Math.min(64, int('spScale') || 1));

// ---------- new, resize, open ----------

function readSize(): [number, number] | null {
  const w = int('spW'), h = int('spH');
  if (!(w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE)) { setStatus(`Use a size from 1 to ${MAX_SIDE} px.`, true); return null; }
  return [w, h];
}

function newSprite(): void {
  const size = readSize();
  if (!size) return;
  commitFloating();
  if (!isBlank(sp.doc) && !confirm('Start a new sprite? The current one is replaced (save it first if you need it).')) return;
  setDoc(createDoc(size[0], size[1]), 'sprite');
  setStatus(`New ${size[0]}×${size[1]} sprite`);
}

function resizeSprite(): void {
  const size = readSize();
  if (!size || (size[0] === sp.doc.w && size[1] === sp.doc.h)) return;
  pushDoc();
  sp.mask = null;
  resizeCanvas(sp.doc, size[0], size[1]);
  emit('structure', 'pixels', 'selection');
  setStatus(`Canvas is now ${size[0]}×${size[1]}`);
}

/** Builds a document from an image. `frames` > 1 splits a horizontal strip. */
function docFromImage(data: Uint8ClampedArray, w: number, h: number, frames: number): SpriteDoc {
  const fw = Math.floor(w / frames);
  const doc = createDoc(fw, h);
  doc.frames = [];
  for (let k = 0; k < frames; k++) {
    const b = newBitmap(fw, h);
    for (let y = 0; y < h; y++) b.px.set(data.subarray((y * w + k * fw) * 4, (y * w + k * fw + fw) * 4), y * fw * 4);
    doc.frames.push({ cels: [b], duration: DEFAULT_DURATION });
  }
  return doc;
}

/** Opens frames from elsewhere (the Pixelize result). False when the user keeps the current sprite. */
export function loadFrames(canvases: HTMLCanvasElement[], name: string): boolean {
  commitFloating();
  if (!canvases.length) return false;
  if (!isBlank(sp.doc) && !confirm('Replace the sprite in the editor with this image? Save it first if you need it.')) return false;
  const w = Math.max(...canvases.map((c) => c.width)), h = Math.max(...canvases.map((c) => c.height));
  const doc = createDoc(w, h);
  doc.frames = canvases.map((c) => {
    const b = newBitmap(w, h);
    const src = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    for (let y = 0; y < c.height; y++) b.px.set(src.subarray(y * c.width * 4, (y + 1) * c.width * 4), y * w * 4);
    return { cels: [b], duration: DEFAULT_DURATION };
  });
  setDoc(doc, safeName(name));
  syncSizeInputs();
  return true;
}

export async function openFile(file: File): Promise<void> {
  commitFloating();
  if (/\.(pixelize|json)$/i.test(file.name)) {
    const doc = parseDoc(await file.text());
    if (!doc) { setStatus("That isn't a Pixelize sprite file.", true); return; }
    setDoc(doc, safeName(file.name));
    syncSizeInputs();
    setStatus(`Opened ${file.name}`);
    return;
  }
  if (!file.type.startsWith('image/')) { setStatus('Open a PNG (or another image) or a .pixelize file.', true); return; }
  const { data, w, h } = imageToData(await decodeFile(file));
  if (w > MAX_SIDE || h > MAX_SIDE) { setStatus(`That image is too big for the sprite editor (max ${MAX_SIDE} px). Pixelize it first.`, true); return; }
  // GameMaker strips are named name_stripN.png
  const m = /_strip(\d+)\.[^.]+$/i.exec(file.name);
  const n = m && w % +m[1] === 0 ? +m[1] : 1;
  setDoc(docFromImage(data, w, h, n), safeName(file.name));
  syncSizeInputs();
  setStatus(n > 1 ? `Opened ${file.name} as ${n} frames` : `Opened ${file.name}`);
}

function syncSizeInputs(): void {
  field('spW').value = String(sp.doc.w);
  field('spH').value = String(sp.doc.h);
}

// ---------- export ----------

async function exportPng(): Promise<void> {
  commitFloating();
  const s = exportScale();
  const suffix = sp.doc.frames.length > 1 ? `_${sp.frame + 1}` : '';
  await saveBlob(await canvasBlob(frameCanvas(sp.frame, s)), `${sp.name}${suffix}${s > 1 ? `_x${s}` : ''}.png`);
}

async function exportStrip(): Promise<void> {
  commitFloating();
  const s = exportScale(), n = sp.doc.frames.length;
  const c = document.createElement('canvas');
  c.width = sp.doc.w * s * n;
  c.height = sp.doc.h * s;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < n; i++) ctx.drawImage(frameCanvas(i, s), i * sp.doc.w * s, 0);
  await saveBlob(await canvasBlob(c), `${sp.name}_strip${n}.png`);
}

async function exportGif(): Promise<void> {
  commitFloating();
  setStatus('Encoding GIF…');
  await wait(20);
  const frames = sp.doc.frames.map((_, i) => composite(sp.doc, i));
  const bytes = encodeGif(frames, sp.doc.w, sp.doc.h, exportScale(), sp.doc.frames.map((f) => f.duration / 10), true);
  await saveBlob(new Blob([bytes], { type: 'image/gif' }), `${sp.name}.gif`);
}

async function saveProject(): Promise<void> {
  commitFloating();
  await saveBlob(new Blob([serializeDoc(sp.doc)], { type: 'application/json' }), `${sp.name}.pixelize`);
}

// ---------- clipboard ----------

let clip: { piece: Bitmap; x: number; y: number } | null = null;

/** The selection (or floating piece, or whole layer) of the current layer. */
function grab(): { piece: Bitmap; x: number; y: number } | null {
  const f = sp.floating;
  if (f) return { piece: renderFloating(f), x: f.x, y: f.y };
  const got = extract(cel(), sp.mask);
  return got ? { piece: got.piece, x: got.box.x, y: got.box.y } : null;
}

export function copy(): void {
  const g = grab();
  if (!g) return;
  clip = g;
  // also put it on the system clipboard, for other apps
  try {
    const c = document.createElement('canvas');
    c.width = g.piece.w; c.height = g.piece.h;
    c.getContext('2d')!.putImageData(new ImageData(g.piece.px.slice(), g.piece.w, g.piece.h), 0, 0);
    c.toBlob((b) => { if (b) navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': b })]).catch(() => {}); }, 'image/png');
  } catch { /* the internal clipboard still works */ }
  setStatus(`Copied ${g.piece.w}×${g.piece.h}`);
}

export function cut(): void {
  copy();
  if (!clip) return;
  if (sp.floating) {
    // the floating piece was already lifted off its layer: dropping it is the cut
    const f = sp.floating;
    sp.floating = null;
    pushCel(f.frame, f.layer, f.before);
  } else {
    pushCel();
    const c = cel();
    if (sp.mask) { for (let p = 0; p < sp.mask.length; p++) if (sp.mask[p]) c.px.fill(0, p * 4, p * 4 + 4); }
    else c.px.fill(0);
  }
  sp.mask = null;
  emit('pixels', 'selection');
}

function pasteBitmap(piece: Bitmap, at?: { x: number; y: number }): void {
  const pos = at ?? (() => { const c = viewCenter(); return { x: c.x - Math.floor(piece.w / 2), y: c.y - Math.floor(piece.h / 2) }; })();
  floatPiece(piece, pos.x, pos.y);
  setTool('move');
}

/** Pastes from the system clipboard if it holds an image someone else copied, else from our own. */
async function onPaste(e: ClipboardEvent): Promise<void> {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  const file = item?.getAsFile();
  if (file) {
    const { data, w, h } = imageToData(await decodeFile(file));
    // our own copy comes back the same size: keep its position
    if (clip && clip.piece.w === w && clip.piece.h === h) { pasteBitmap(clip.piece, clip); return; }
    if (w > MAX_SIDE || h > MAX_SIDE) { setStatus('The image on the clipboard is too big.', true); return; }
    pasteBitmap({ w, h, px: data.slice() });
    return;
  }
  if (clip) pasteBitmap({ ...clip.piece, px: clip.piece.px.slice() }, clip);
}

// ---------- autosave ----------

let saveTimer = 0;
function scheduleSave(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ name: sp.name, doc: serializeDoc(sp.doc) })); } catch { /* too big or storage unavailable */ }
  }, 600);
}

function restore(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') as { name: string; doc: string } | null;
    const doc = saved && parseDoc(saved.doc);
    if (doc) setDoc(doc, saved!.name || 'sprite');
  } catch { /* nothing saved */ }
}

export function initIo(isActive: () => boolean): void {
  $('spNew').addEventListener('click', newSprite);
  $('spResize').addEventListener('click', resizeSprite);
  $('spOpen').addEventListener('click', () => field('spFile').click());
  field('spFile').addEventListener('change', () => {
    const f = field('spFile').files?.[0];
    if (f) openFile(f).catch((e) => setStatus((e as Error).message, true));
    field('spFile').value = '';
  });
  $('spSave').addEventListener('click', saveProject);
  $('spExportPng').addEventListener('click', exportPng);
  $('spExportStrip').addEventListener('click', exportStrip);
  $('spExportGif').addEventListener('click', exportGif);

  document.addEventListener('paste', (e) => {
    if (!isActive() || (e.target as HTMLElement).matches?.('input[type="text"], input[type="number"], textarea')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    onPaste(e).catch((err) => setStatus((err as Error).message, true));
  }, true);
  // dropping a file anywhere in the sprite editor opens it
  document.addEventListener('drop', (e) => {
    if (!isActive()) return;
    const f = e.dataTransfer?.files[0];
    if (!f) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openFile(f).catch((err) => setStatus((err as Error).message, true));
  }, true);

  restore();
  syncSizeInputs();
  on('pixels', scheduleSave);
  on('structure', scheduleSave);
}
