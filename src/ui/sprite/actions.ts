// Editor actions shared by the components and the keyboard shortcuts.

import { flip, newBitmap, outline, rotate90, scaleNearest } from '../../core/bitmap';
import type { RGBA } from '../../core/color';
import { addLayer } from '../../core/sprite';
import { bakePart, freeFrame, makePart, REST, setParent, setPose, syncParts } from '../../core/parts';
import { placeFloating } from '../../core/rotsprite';
import { setStatus } from '../dom';
import { decodeFile } from '../input';
import { cel, commitFloating, emit, lift, pushCel, pushDoc, setColor, sp, type Float } from './state';

export function setBrush(n: number): void {
  sp.brush = Math.max(1, Math.min(32, Math.round(n) || 1));
  emit('tool');
}

/** Changes a tool option and lets the components know. */
export function setOption<K extends 'rectFilled' | 'contiguous' | 'bucketMode' | 'replaceAllFrames' | 'canvasMode' | 'pixelPerfect' | 'symX' | 'symY'>(key: K, value: (typeof sp)[K]): void {
  sp[key] = value;
  emit('tool');
}

export function setTileMode(on: boolean): void {
  sp.tileMode = on;
  emit('view');
}

/** Scales, flips or turns the selection (lifting it first; the whole layer without a selection). */
export function transform(fn: (w: number, h: number) => [number, number] | 'flipH' | 'flipV' | 'rotCW' | 'rotCCW' | 'rot180'): void {
  const f = lift();
  if (!f) return;
  bakeTurn(f);
  const r = fn(f.w, f.h);
  const shown = () => (f.w === f.src.w && f.h === f.src.h ? f.src : scaleNearest(f.src, f.w, f.h));
  if (r === 'flipH' || r === 'flipV') {
    f.src = flip(shown(), r === 'flipH');
  } else if (r === 'rot180') {
    f.src = flip(flip(shown(), true), false);
  } else if (r === 'rotCW' || r === 'rotCCW') {
    // a quarter turn swaps width and height around the same center
    const cx = f.x + f.w / 2, cy = f.y + f.h / 2;
    f.src = rotate90(shown(), r === 'rotCW');
    f.w = f.src.w;
    f.h = f.src.h;
    f.x = Math.round(cx - f.w / 2);
    f.y = Math.round(cy - f.h / 2);
  } else {
    // keep it centered where it was
    const [w, h] = [Math.max(1, Math.round(r[0])), Math.max(1, Math.round(r[1]))];
    f.x += Math.round((f.w - w) / 2);
    f.y += Math.round((f.h - h) / 2);
    f.w = w;
    f.h = h;
  }
  emit('pixels', 'selection');
}

// ---------- parts (layers posed frame by frame, core/parts.ts) ----------

/** Runs a change to the current layer's part with undo, after taking in what was painted. */
function partChange(fn: () => void): void {
  commitFloating();
  syncParts(sp.doc);
  pushDoc();
  fn();
  emit('structure', 'pixels');
}

export const makeLayerPart = () => partChange(() => makePart(sp.doc, sp.layer, sp.frame));
export const bakeLayerPart = () => partChange(() => bakePart(sp.doc, sp.layer));
export const restPose = () => partChange(() => setPose(sp.doc, sp.frame, sp.layer, REST));
export const freePose = () => partChange(() => freeFrame(sp.doc, sp.frame, sp.layer));
export function setLayerParent(parentId: string | null): void {
  partChange(() => { if (!setParent(sp.doc, sp.layer, parentId)) setStatus('That would make a loop of parts.', true); });
}

/** Makes a turned piece's turn part of its pixels, so it can be scaled or flipped. */
export function bakeTurn(f: Float): void {
  if (!f.angle) return;
  const p = placeFloating(f);
  f.src = { w: p.piece.w, h: p.piece.h, px: p.piece.px.slice() };
  f.x = p.x; f.y = p.y; f.w = p.piece.w; f.h = p.piece.h;
  f.angle = 0;
  delete f.pivot;
}

/** Turns the selection to `deg` degrees (clockwise), around its pivot, with RotSprite. */
export function setAngle(deg: number): void {
  const f = lift();
  if (!f) return;
  deg = ((Math.round(deg * 10) / 10) % 360 + 360) % 360;
  f.angle = deg;
  emit('pixels', 'selection');
}

/** Puts the turning point back in the middle of the piece. */
export function resetPivot(): void {
  const f = lift();
  if (!f) return;
  delete f.pivot;
  sp.pivotAt = null;
  emit('pixels', 'selection');
}

export function deleteSelection(): void {
  if (sp.floating) {
    const f = sp.floating;
    sp.floating = null;
    pushCel(f.frame, f.layer, f.before);
  } else if (sp.mask) {
    pushCel();
    const c = cel();
    for (let p = 0; p < sp.mask.length; p++) if (sp.mask[p]) c.px.fill(0, p * 4, p * 4 + 4);
  } else return;
  sp.mask = null;
  emit('pixels', 'selection');
}

/**
 * Outlines the art on the current layer (only the selected art when there is a
 * selection) with the primary color. `corners` also fills the diagonal gaps.
 */
export function outlineArt(corners: boolean): void {
  commitFloating();
  if (!sp.primary[3]) { setStatus('Pick a color for the outline first (the primary color is transparent).', true); return; }
  const c = cel(), before = c.px.slice();
  const n = outline(c, sp.primary, corners, sp.mask);
  if (!n) { setStatus('Nothing to outline on this layer.'); return; }
  pushCel(sp.frame, sp.layer, before);
  emit('pixels');
}

/**
 * Adds an image as a reference layer on top: fitted into the canvas, half
 * transparent, in every frame. It shows while drawing but is not exported.
 */
export async function addReferenceImage(file: File): Promise<void> {
  const img = await decodeFile(file);
  const { w, h } = sp.doc;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const iw = img.naturalWidth, ih = img.naturalHeight;
  const k = Math.min(w / iw, h / ih);
  // pixel art stays crisp when it is scaled up by whole steps; photos get smoothed
  ctx.imageSmoothingEnabled = k < 1 || k % 1 !== 0;
  ctx.drawImage(img, Math.round((w - iw * k) / 2), Math.round((h - ih * k) / 2), Math.round(iw * k), Math.round(ih * k));
  const px = ctx.getImageData(0, 0, w, h).data;
  pushDoc();
  const at = sp.doc.layers.length;
  addLayer(sp.doc, at, 'Reference');
  sp.doc.layers[at].ref = true;
  sp.doc.layers[at].opacity = 0.5;
  for (const f of sp.doc.frames) f.cels[at] = Object.assign(newBitmap(w, h), { px: px.slice() });
  sp.layer = at;
  emit('structure', 'cursor', 'pixels');
  setStatus(`Added ${file.name} as a reference layer. It is not exported.`);
}

/** Turns a layer into a reference (or back into a normal layer). */
export function toggleReference(i: number): void {
  pushDoc();
  const l = sp.doc.layers[i];
  if (l.ref) delete l.ref;
  else l.ref = true;
  emit('structure', 'pixels');
}

// ---------- colors ----------

export function swapColors(): void {
  const p = sp.primary;
  sp.primary = sp.secondary;
  sp.secondary = p;
  emit('color');
}

/** Chooses what the color picker edits. Choosing the paper also shows it as a flat color. */
export function pickSlot(s: typeof sp.pickSlot): void {
  sp.pickSlot = s;
  if (s === 'paper' && sp.paperMode !== 'color') { sp.paperMode = 'color'; emit('paper'); }
  emit('color');
}

/** The color the picker is editing. */
export const pickedColor = (): RGBA => (sp.pickSlot === 'paper' ? [...sp.paperColor, 255] : sp[sp.pickSlot]);

/** Sets the color the picker is editing. */
export function setPickedColor(c: RGBA): void {
  if (sp.pickSlot !== 'paper') { setColor(sp.pickSlot, c); return; }
  sp.paperColor = [c[0], c[1], c[2]];
  sp.paperMode = 'color';
  emit('paper', 'color');
}

export function setPaperMode(mode: typeof sp.paperMode): void {
  sp.paperMode = mode;
  if (mode === 'checker' && sp.pickSlot === 'paper') sp.pickSlot = 'primary';
  emit('paper', 'color');
}
