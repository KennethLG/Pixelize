// Sprite editor state: the document, what is selected (frame, layer, pixels),
// the floating piece being moved, the colors, and undo/redo. The canvas engine
// listens with on(...); React components re-render with useSp(...) (hooks.ts).
// Events:
//   pixels    cel contents changed (canvas, thumbnails, colors in use)
//   structure layers or frames were added, removed, reordered or renamed
//   cursor    current frame or layer changed
//   selection the selection or the floating piece changed
//   color     primary/secondary color changed
//   tool      the tool or its options changed
//   paper     the background behind the sprite changed
//   view      zoom or grid changed
//   hover     the pixel under the pointer changed (position read-out)
//   palette   the user's palette changed
//   playback  the preview started or stopped playing
//   playframe the playing preview moved to another frame

import {
  blit, clearMasked, extract, floatingMask, type Bitmap, type Floating, type Mask,
} from '../../core/bitmap';
import type { RGB, RGBA } from '../../core/color';
import type { LintIssue } from '../../core/lint';
import { syncParts } from '../../core/parts';
import { placeFloating } from '../../core/rotsprite';
import { cloneDoc, createDoc, type SpriteDoc } from '../../core/sprite';
import { createBus } from '../bus';

export type SpEvent = 'pixels' | 'structure' | 'cursor' | 'selection' | 'color' | 'tool' | 'paper' | 'view' | 'hover' | 'palette' | 'playback' | 'playframe';
export type Tool = 'pan' | 'pencil' | 'eraser' | 'line' | 'shade' | 'bucket' | 'picker' | 'rect' | 'ellipse' | 'select' | 'lasso' | 'wand' | 'move' | 'pose' | 'canvas';

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
  rectFilled: false,       // rectangles and ellipses
  /** pencil strokes without L-shaped corners (1 px brush) */
  pixelPerfect: false,
  /** drawing is mirrored across the canvas center: left/right and top/bottom */
  symX: false,
  symY: false,
  /** the canvas shows 3 × 3 copies and strokes wrap around the edges, for tiles */
  tileMode: false,
  contiguous: true,        // select by color
  bucketMode: 'fill' as 'fill' | 'replace',
  replaceAllFrames: false,
  canvasMode: 'keep' as 'keep' | 'stretch',
  /** what shows behind the sprite (only for looking at; exports stay transparent) */
  paperMode: 'checker' as 'checker' | 'color',
  paperColor: [255, 255, 255] as RGB,
  /** what the color picker edits */
  pickSlot: 'primary' as 'primary' | 'secondary' | 'paper',
  showGrid: true,
  /** grid cell size in sprite pixels: 1 × 1 is the pixel grid, bigger sizes mark tiles or frames */
  gridW: 1,
  gridH: 1,
  onion: false,
  /** onion skin: how many frames behind and ahead, how strong, tinted red/blue or not */
  onionBefore: 1,
  onionAfter: 0,
  onionOpacity: 0.35,
  onionTint: true,
  /** the animated preview is playing, and the frame it shows */
  playing: false,
  playFrame: 0,
  /** quick flip: while held, the canvas shows this frame instead */
  peek: null as number | null,
  /** frames picked with Shift+click in the timeline (both ends included) */
  range: null as [number, number] | null,
  /** the tag whose settings are open in the timeline */
  editingTag: null as number | null,
  /** everything painted, filled or pasted snaps to the user's palette */
  paletteLock: false,
  /** the Check panel: its problems (with their frame) and the one being looked at */
  checkOpen: false,
  issues: [] as (LintIssue & { frame: number })[],
  issueFocus: null as number | null,
  /** the Variants panel, and the variant shown on the canvas (only on screen) */
  variantsOpen: false,
  showVariant: null as number | null,
  /** the floating preview window */
  previewOpen: false,
  previewScale: 2,
  previewBg: 'checker' as 'checker' | 'paper' | 'image',
  /** the current layer's cel with a shape still being dragged out (rectangle tool) */
  preview: null as Bitmap | null,
  /** where the last piece put down turned (sprite pixels), so lifting it again keeps its pivot (a shoulder, a hip) */
  pivotAt: null as [number, number] | null,
  name: 'sprite',
};

export const spBus = createBus<SpEvent>();
/** on() returns a function that stops listening; versions counts how many times each event fired. */
export const { on, emit, versions } = spBus;

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

/** Call before any change to layers, frames or the canvas size. `prev` is the document as it was, when the caller already changed it. */
export function pushDoc(prev?: SpriteDoc): void {
  commitFloating();
  record(undoStack, { t: 'doc', doc: prev ?? cloneDoc(sp.doc), frame: sp.frame, layer: sp.layer, mask: sp.mask?.slice() ?? null });
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
    sp.range = null;
    sp.editingTag = null;
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
  const p = sp.pivotAt, b = got.box;
  if (p && p[0] >= b.x && p[1] >= b.y && p[0] <= b.x + b.w && p[1] <= b.y + b.h) sp.floating.pivot = [(p[0] - b.x) / b.w, (p[1] - b.y) / b.h];
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
  sp.pivotAt = f.pivot ? [f.x + f.pivot[0] * f.w, f.y + f.pivot[1] * f.h] : null;
  const c = cel(f.frame, f.layer);
  const placed = placeFloating(f);
  blit(c, placed.piece, placed.x, placed.y);
  pushCel(f.frame, f.layer, f.before);
  sp.mask = floatingMask(sp.doc.w, sp.doc.h, placed);
  if (!sp.mask.some((v) => v)) sp.mask = null;
  emit('pixels', 'selection');
}

/**
 * Takes the floating piece (lifting the selection first) to another frame,
 * keeping its place, size and turn, so a pose can be carried on frame by frame.
 * `copy` leaves the original frame as it was; otherwise the piece is cut out of it.
 */
export function carryFloating(to: number, copy: boolean): void {
  to = Math.max(0, Math.min(sp.doc.frames.length - 1, to));
  if (to === sp.frame || !(sp.mask || sp.floating)) return;
  const f = lift();
  if (!f) return;
  const src = cel(f.frame, f.layer);
  if (copy) src.px.set(f.before);
  else pushCel(f.frame, f.layer, f.before);
  f.frame = to;
  f.before = cel(to, f.layer).px.slice();
  sp.frame = to;
  sp.layer = f.layer;
  emit('cursor', 'pixels', 'selection');
}

export function deselect(): void {
  commitFloating();
  sp.pivotAt = null;
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
  const placed = placeFloating(f);
  blit(out, placed.piece, placed.x, placed.y);
  return out;
}

// ---------- document ----------

export function setDoc(doc: SpriteDoc, name = sp.name): void {
  sp.floating = null;
  sp.range = null;
  sp.editingTag = null;
  sp.doc = doc;
  sp.frame = 0;
  sp.layer = Math.min(sp.layer, doc.layers.length - 1);
  sp.mask = null;
  sp.preview = null;
  sp.pivotAt = null;
  sp.name = name;
  resetHistory();
  emit('structure', 'cursor', 'pixels', 'selection');
}

export function setFrame(i: number): void {
  i = Math.max(0, Math.min(sp.doc.frames.length - 1, i));
  if (i === sp.frame) return;
  commitFloating();
  // painting on a part in its rest pose reaches the other frames now
  syncParts(sp.doc);
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
  if (!['select', 'lasso', 'wand', 'move', 'pan'].includes(t)) commitFloating();
  if (t === 'canvas') deselect();
  sp.tool = t;
  emit('tool');
}

export function setColor(slot: 'primary' | 'secondary', c: RGBA): void {
  sp[slot] = [c[0], c[1], c[2], c[3]];
  emit('color');
}
