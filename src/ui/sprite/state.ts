// Sprite editor state: the document, what is selected (frame, layer, pixels),
// the floating piece being moved, the colors, and undo/redo. Modules listen
// with on(...) and redraw what they own:
//   pixels    cel contents changed (canvas, thumbnails, colors in use)
//   structure layers or frames were added, removed, reordered or renamed
//   cursor    current frame or layer changed
//   selection the selection or the floating piece changed
//   color     primary/secondary color changed
//   tool      the tool or its options changed

import {
  blit, clearMasked, extract, floatingMask, renderFloating, type Bitmap, type Floating, type Mask,
} from '../../core/bitmap';
import type { RGBA } from '../../core/color';
import { cloneDoc, createDoc, type SpriteDoc } from '../../core/sprite';

export type SpEvent = 'pixels' | 'structure' | 'cursor' | 'selection' | 'color' | 'tool';
export type Tool = 'pan' | 'pencil' | 'eraser' | 'bucket' | 'picker' | 'rect' | 'select' | 'wand' | 'move';

/** A floating piece also remembers its layer, frame, and the cel before it was lifted (for undo). */
export interface Float extends Floating { frame: number; layer: number; before: Uint8ClampedArray }

export const sp = {
  doc: createDoc(32, 32) as SpriteDoc,
  frame: 0,
  layer: 0,
  mask: null as Mask | null,
  floating: null as Float | null,
  primary: [27, 21, 48, 255] as RGBA,
  secondary: [0, 0, 0, 0] as RGBA,
  tool: 'pencil' as Tool,
  brush: 1,
  rectFilled: false,
  contiguous: true,
  onion: false,
  /** the current layer's cel with a shape still being dragged out (rectangle tool) */
  preview: null as Bitmap | null,
  name: 'sprite',
};

const listeners = new Map<SpEvent, (() => void)[]>();
export const on = (ev: SpEvent, fn: () => void) => { listeners.set(ev, [...(listeners.get(ev) || []), fn]); };
export const emit = (...evs: SpEvent[]) => { for (const ev of new Set(evs)) for (const fn of listeners.get(ev) || []) fn(); };

export const cel = (frame = sp.frame, layer = sp.layer) => sp.doc.frames[frame].cels[layer];

// ---------- undo / redo ----------
// A pixel edit stores just the cel it touched; anything else stores the whole document.

type Entry =
  | { t: 'cel'; frame: number; layer: number; px: Uint8ClampedArray; mask: Mask | null }
  | { t: 'doc'; doc: SpriteDoc; frame: number; layer: number; mask: Mask | null };

const LIMIT = 100;
let undoStack: Entry[] = [];
let redoStack: Entry[] = [];

function record(stack: Entry[], e: Entry): void {
  stack.push(e);
  if (stack.length > LIMIT) stack.shift();
}

/** Call before changing the pixels of one cel. `px` is the cel as it was, when the caller already changed it. */
export function pushCel(frame = sp.frame, layer = sp.layer, px?: Uint8ClampedArray): void {
  record(undoStack, { t: 'cel', frame, layer, px: px ?? cel(frame, layer).px.slice(), mask: sp.mask?.slice() ?? null });
  redoStack = [];
}

/** Call before any change to layers, frames or the canvas size. */
export function pushDoc(): void {
  commitFloating();
  record(undoStack, { t: 'doc', doc: cloneDoc(sp.doc), frame: sp.frame, layer: sp.layer, mask: sp.mask?.slice() ?? null });
  redoStack = [];
}

function opposite(e: Entry): Entry {
  return e.t === 'cel'
    ? { t: 'cel', frame: e.frame, layer: e.layer, px: cel(e.frame, e.layer).px.slice(), mask: sp.mask?.slice() ?? null }
    : { t: 'doc', doc: cloneDoc(sp.doc), frame: sp.frame, layer: sp.layer, mask: sp.mask?.slice() ?? null };
}

function apply(e: Entry): void {
  if (e.t === 'cel') {
    cel(e.frame, e.layer).px.set(e.px);
    sp.frame = e.frame;
    sp.layer = e.layer;
  } else {
    sp.doc = e.doc;
    sp.frame = Math.min(e.frame, e.doc.frames.length - 1);
    sp.layer = Math.min(e.layer, e.doc.layers.length - 1);
  }
  sp.mask = e.mask && e.mask.length === sp.doc.w * sp.doc.h ? e.mask : null;
}

function step(from: Entry[], to: Entry[]): void {
  // a piece still floating is undone by putting the cel back as it was before the lift
  if (sp.floating) {
    const f = sp.floating;
    sp.floating = null;
    cel(f.frame, f.layer).px.set(f.before);
    sp.mask = null;
    if (from === undoStack) { emit('pixels', 'selection'); return; }
  }
  const e = from.pop();
  if (!e) return;
  record(to, opposite(e));
  apply(e);
  emit('structure', 'cursor', 'pixels', 'selection');
}

export const undo = () => step(undoStack, redoStack);
export const redo = () => step(redoStack, undoStack);
export const canUndo = () => undoStack.length > 0 || !!sp.floating;
export const canRedo = () => redoStack.length > 0;
export function resetHistory(): void { undoStack = []; redoStack = []; }

// ---------- selection and the floating piece ----------

/** Lifts the selected pixels of the current layer (the whole layer without a selection) so they can move. */
export function lift(): Float | null {
  if (sp.floating) return sp.floating;
  const c = cel();
  const got = extract(c, sp.mask);
  if (!got) return null;
  const before = c.px.slice();
  clearMasked(c, sp.mask);
  sp.floating = { src: got.piece, x: got.box.x, y: got.box.y, w: got.box.w, h: got.box.h, frame: sp.frame, layer: sp.layer, before };
  return sp.floating;
}

/** Starts floating a piece that comes from somewhere else (paste). */
export function floatPiece(piece: Bitmap, x: number, y: number): void {
  commitFloating();
  sp.floating = { src: piece, x, y, w: piece.w, h: piece.h, frame: sp.frame, layer: sp.layer, before: cel().px.slice() };
  sp.mask = null;
  emit('pixels', 'selection');
}

/** Puts the floating piece down on its layer. The selection becomes what it covers. */
export function commitFloating(): void {
  const f = sp.floating;
  if (!f) return;
  sp.floating = null;
  const c = cel(f.frame, f.layer);
  blit(c, renderFloating(f), f.x, f.y);
  pushCel(f.frame, f.layer, f.before);
  sp.mask = floatingMask(sp.doc.w, sp.doc.h, f);
  if (!sp.mask.some((v) => v)) sp.mask = null;
  emit('pixels', 'selection');
}

export function deselect(): void {
  commitFloating();
  if (!sp.mask) return;
  sp.mask = null;
  emit('selection');
}

/** The current layer's cel with the floating piece (or a tool preview) on it, for drawing. */
export function liveCel(): Bitmap | null {
  if (sp.preview) return sp.preview;
  const f = sp.floating;
  if (!f || f.frame !== sp.frame) return null;
  const c = cel(sp.frame, f.layer);
  const out = { w: c.w, h: c.h, px: c.px.slice() };
  blit(out, renderFloating(f), f.x, f.y);
  return out;
}

// ---------- document ----------

export function setDoc(doc: SpriteDoc, name = sp.name): void {
  sp.floating = null;
  sp.doc = doc;
  sp.frame = 0;
  sp.layer = Math.min(sp.layer, doc.layers.length - 1);
  sp.mask = null;
  sp.preview = null;
  sp.name = name;
  resetHistory();
  emit('structure', 'cursor', 'pixels', 'selection');
}

export function setFrame(i: number): void {
  i = Math.max(0, Math.min(sp.doc.frames.length - 1, i));
  if (i === sp.frame) return;
  commitFloating();
  sp.frame = i;
  emit('cursor', 'pixels');
}

export function setLayer(i: number): void {
  i = Math.max(0, Math.min(sp.doc.layers.length - 1, i));
  if (i === sp.layer) return;
  commitFloating();
  sp.layer = i;
  emit('cursor');
}

export function setTool(t: Tool): void {
  if (!['select', 'wand', 'move', 'pan'].includes(t)) commitFloating();
  sp.tool = t;
  emit('tool');
}

export function setColor(slot: 'primary' | 'secondary', c: RGBA): void {
  sp[slot] = [c[0], c[1], c[2], c[3]];
  emit('color');
}
