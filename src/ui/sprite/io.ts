// Getting sprites in and out: new sprite, canvas size, opening images and
// project files, exports (PNG, GameMaker strip, GIF), the clipboard and the
// autosave that brings the last sprite back next time. No DOM lookups here:
// the components pass in what the user typed.

import { extract, newBitmap, renderFloating, type Bitmap } from '../../core/bitmap';
import { DEFAULT_DURATION, composite, createDoc, parseDoc, resizeCanvas, scaleDoc, serializeDoc, type SpriteDoc } from '../../core/sprite';
import { playbackSequence } from '../../core/frames';
import { encodeGif } from '../../export/gif';
import { setStatus, wait } from '../dom';
import { canvasBlob, saveBlob } from '../downloads';
import { decodeFile, imageToData } from '../input';
import { viewCenter } from './canvas';
import { cel, commitFloating, emit, floatPiece, on, pushCel, pushDoc, setDoc, setTool, sp } from './state';

const SAVE_KEY = 'pixelize.sprite.doc';
export const MAX_SIDE = 2048;

const isBlank = (d: SpriteDoc) => d.frames.every((f) => f.cels.every((c) => !c.px.some((v, i) => i % 4 === 3 && v)));
const safeName = (n: string) => n.replace(/\.[^.]+$/, '').replace(/_strip\d+$/i, '').replace(/[^\w.-]+/g, '_') || 'sprite';
const clampScale = (s: number) => Math.max(1, Math.min(64, Math.round(s) || 1));

function frameCanvas(fi: number, scale = 1): HTMLCanvasElement {
  const { w, h } = sp.doc;
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  src.getContext('2d')!.putImageData(new ImageData(composite(sp.doc, fi, null, { refs: false }), w, h), 0, 0);
  if (scale === 1) return src;
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

// ---------- new, resize, open ----------

function validSize(w: number, h: number): boolean {
  if (w >= 1 && h >= 1 && w <= MAX_SIDE && h <= MAX_SIDE) return true;
  setStatus(`Use a size from 1 to ${MAX_SIDE} px.`, true);
  return false;
}

export function newSprite(w: number, h: number): void {
  if (!validSize(w, h)) return;
  commitFloating();
  if (!isBlank(sp.doc) && !confirm('Start a new sprite? The current one is replaced (save it first if you need it).')) return;
  setDoc(createDoc(w, h), 'sprite');
  setStatus(`New ${w}×${h} sprite`);
}

export function resizeSprite(w: number, h: number): void {
  if (!validSize(w, h) || (w === sp.doc.w && h === sp.doc.h)) return;
  pushDoc();
  sp.mask = null;
  if (sp.canvasMode === 'stretch') scaleDoc(sp.doc, w, h);
  else resizeCanvas(sp.doc, w, h);
  emit('structure', 'pixels', 'selection');
  setStatus(`Canvas is now ${w}×${h}${sp.canvasMode === 'stretch' ? ' (art stretched)' : ''}`);
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
  return true;
}

export async function openFile(file: File): Promise<void> {
  commitFloating();
  if (/\.(pixelize|json)$/i.test(file.name)) {
    const doc = parseDoc(await file.text());
    if (!doc) { setStatus("That isn't a Pixelize sprite file.", true); return; }
    setDoc(doc, safeName(file.name));
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
  setStatus(n > 1 ? `Opened ${file.name} as ${n} frames` : `Opened ${file.name}`);
}

// ---------- export ----------

export async function exportPng(scale: number): Promise<void> {
  commitFloating();
  const s = clampScale(scale);
  const suffix = sp.doc.frames.length > 1 ? `_${sp.frame + 1}` : '';
  await saveBlob(await canvasBlob(frameCanvas(sp.frame, s)), `${sp.name}${suffix}${s > 1 ? `_x${s}` : ''}.png`);
}

/** The frames an export covers: one tag (by index) or all of them, and the file name part. */
function exportRange(tag: number | null): { frames: number[]; name: string; dir: 'forward' | 'reverse' | 'pingpong' } {
  const t = tag === null ? null : sp.doc.tags[tag];
  const all = sp.doc.frames.map((_, i) => i);
  if (!t) return { frames: all, name: sp.name, dir: 'forward' };
  return { frames: all.slice(t.from, t.to + 1), name: `${sp.name}_${t.name.replace(/[^\w.-]+/g, '_')}`, dir: t.dir };
}

export async function exportStrip(scale: number, tag: number | null = null): Promise<void> {
  commitFloating();
  const { frames, name } = exportRange(tag);
  const s = clampScale(scale), n = frames.length;
  const c = document.createElement('canvas');
  c.width = sp.doc.w * s * n;
  c.height = sp.doc.h * s;
  const ctx = c.getContext('2d')!;
  frames.forEach((fi, k) => ctx.drawImage(frameCanvas(fi, s), k * sp.doc.w * s, 0));
  await saveBlob(await canvasBlob(c), `${name}_strip${n}.png`);
}

export async function exportGif(scale: number, tag: number | null = null): Promise<void> {
  commitFloating();
  setStatus('Encoding GIF…');
  await wait(20);
  // a tag plays in its own direction (a ping-pong tag goes there and back)
  const { frames: range, name, dir } = exportRange(tag);
  const seq = playbackSequence(range, dir, false);
  const frames = seq.map((i) => composite(sp.doc, i, null, { refs: false }));
  const bytes = encodeGif(frames, sp.doc.w, sp.doc.h, clampScale(scale), seq.map((i) => sp.doc.frames[i].duration / 10), true);
  await saveBlob(new Blob([bytes], { type: 'image/gif' }), `${name}.gif`);
}

export async function saveProject(): Promise<void> {
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

/** Brings back the last sprite. */
export function restore(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') as { name: string; doc: string } | null;
    const doc = saved && parseDoc(saved.doc);
    if (doc) setDoc(doc, saved!.name || 'sprite');
  } catch { /* nothing saved */ }
}

/** Paste, drop and autosave. `isActive` says whether the editor is the open mode. */
export function initIo(isActive: () => boolean): void {
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

  on('pixels', scheduleSave);
  on('structure', scheduleSave);
}
