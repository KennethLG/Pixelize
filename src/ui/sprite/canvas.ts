// The sprite editor canvas engine: zoom/pan view, drawing (onion skin, grid,
// selection outline, scale handles) and the tools. It is imperative on purpose
// (pointer events and drawing must not go through React renders): the
// CanvasPanel component hands it its elements with attachCanvas().

import {
  boxOf, colorMask, combineMasks, drawEllipse, drawLine, drawRect, fill, getPixel, isLCorner, linePoints, maskBounds,
  paintPoints, rectMask, replaceColor, snapAngle, stamp, type Bitmap, type Box, type MaskOp, type PaintOpts,
} from '../../core/bitmap';
import { hex, type RGBA } from '../../core/color';
import { cloneDoc, composite, cropCanvas, scaleDoc, type SpriteDoc } from '../../core/sprite';
import { cssVar } from '../dom';
import { cel, commitFloating, deselect, emit, lift, liveCel, on, pushCel, pushDoc, setColor, sp, type Tool } from './state';

type Pt = { x: number; y: number };

let stageEl: HTMLElement | null = null;
let canvasEl: HTMLCanvasElement | null = null;
const stage = () => stageEl!;
const canvas = () => canvasEl!;
const view = { zoom: 8, ox: 0, oy: 0, cw: 0, ch: 0, dpr: 1 };
let fitted = '';
let viewTouched = false;  // zoomed or panned by hand since the last fit
let hover: Pt | null = null;
let spaceHeld = false;
let lastPaint: Pt | null = null;     // for Shift+click straight lines
let hoverInfo = '';
const MAX_SIDE = 2048;
const art = document.createElement('canvas');
const onionCanvas = document.createElement('canvas');

// ---------- view ----------

function sizeStage(): void {
  const r = stage().getBoundingClientRect();
  if (!r.width || !r.height) return;
  view.dpr = window.devicePixelRatio || 1;
  if (view.cw) { view.ox += (r.width - view.cw) / 2; view.oy += (r.height - view.ch) / 2; }
  view.cw = r.width;
  view.ch = r.height;
  canvas().width = Math.round(r.width * view.dpr);
  canvas().height = Math.round(r.height * view.dpr);
  if (!viewTouched) fitted = '';
  draw();
}

function setZoom(z: number, at: [number, number] | null): void {
  z = Math.max(1, Math.min(96, z));
  const cx = at ? at[0] : view.cw / 2, cy = at ? at[1] : view.ch / 2;
  view.ox = cx - ((cx - view.ox) * z) / view.zoom;
  view.oy = cy - ((cy - view.oy) * z) / view.zoom;
  if (z !== view.zoom) { view.zoom = z; emit('view'); }
}

export const zoomPercent = () => Math.round(view.zoom * 100);
/** "x, y  #rrggbb" for the pixel under the pointer, or the canvas size. */
export const hoverText = () => hoverInfo || `${sp.doc.w}×${sp.doc.h}`;

export function fitView(): void {
  const { w, h } = sp.doc;
  if (!view.cw) return;
  fitted = `${w}x${h}`;
  setZoom(Math.max(1, Math.floor(Math.min((view.cw - 32) / w, (view.ch - 32) / h))), null);
  view.ox = Math.round((view.cw - w * view.zoom) / 2);
  view.oy = Math.round((view.ch - h * view.zoom) / 2);
  fitted = `${w}x${h}`;
  viewTouched = false;
  draw();
}

export function zoomStep(dir: 1 | -1, at: [number, number] | null = null): void {
  const steps = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96];
  const z = view.zoom;
  const next = dir > 0 ? steps.find((s) => s > z + 1e-6) : [...steps].reverse().find((s) => s < z - 1e-6);
  setZoom(next || z, at);
  viewTouched = true;
  draw();
}

/** Pixel under the pointer (may be outside the canvas). */
function pixelAt(e: { clientX: number; clientY: number }): Pt {
  const r = canvas().getBoundingClientRect();
  return { x: Math.floor((e.clientX - r.left - view.ox) / view.zoom), y: Math.floor((e.clientY - r.top - view.oy) / view.zoom) };
}
/** Nearest grid line under the pointer (where a dragged edge snaps). */
function lineAt(e: { clientX: number; clientY: number }): Pt {
  const r = canvas().getBoundingClientRect();
  return { x: Math.round((e.clientX - r.left - view.ox) / view.zoom), y: Math.round((e.clientY - r.top - view.oy) / view.zoom) };
}
const inside = (p: Pt) => p.x >= 0 && p.y >= 0 && p.x < sp.doc.w && p.y < sp.doc.h;
const mod = (v: number, n: number) => ((v % n) + n) % n;
/** In tile mode the 3 × 3 copies around the canvas count too. */
const onTiles = (p: Pt) => sp.tileMode && p.x >= -sp.doc.w && p.y >= -sp.doc.h && p.x < 2 * sp.doc.w && p.y < 2 * sp.doc.h;
/** The canvas pixel a point stands for (the same point, or wrapped in tile mode). */
const toCanvas = (p: Pt): Pt => (onTiles(p) ? { x: mod(p.x, sp.doc.w), y: mod(p.y, sp.doc.h) } : p);
/** How the drawing tools paint right now. */
const paintOpts = (): PaintOpts => ({ mask: sp.mask, symX: sp.symX, symY: sp.symY, wrap: sp.tileMode });
const DRAW_TOOLS = ['pencil', 'eraser', 'line', 'rect', 'ellipse'];

/** The middle of what is on screen, in sprite pixels (where pastes land). */
export function viewCenter(): Pt {
  return { x: Math.floor((view.cw / 2 - view.ox) / view.zoom), y: Math.floor((view.ch / 2 - view.oy) / view.zoom) };
}

// ---------- drawing ----------

let checker: CanvasPattern | null = null;
function checkerPattern(ctx: CanvasRenderingContext2D): CanvasPattern {
  if (checker) return checker;
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d')!;
  g.fillStyle = cssVar('--check-b'); g.fillRect(0, 0, 16, 16);
  g.fillStyle = cssVar('--check-a'); g.fillRect(0, 0, 8, 8); g.fillRect(8, 8, 8, 8);
  checker = ctx.createPattern(c, 'repeat')!;
  return checker;
}

function putImage(target: HTMLCanvasElement, px: Uint8ClampedArray, w: number, h: number): void {
  if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
  target.getContext('2d')!.putImageData(new ImageData(px, w, h), 0, 0);
}

/** Selection box: the floating piece, or the bounds of the mask. */
export function selectionBox(): Box | null {
  const f = sp.floating;
  if (f) return { x: f.x, y: f.y, w: f.w, h: f.h };
  return sp.mask ? maskBounds(sp.mask, sp.doc.w) : null;
}

const HANDLE = 7;
type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
function handlePoints(b: Box): [Handle, number, number][] {
  const { zoom: z, ox, oy } = view;
  const x0 = ox + b.x * z, y0 = oy + b.y * z, x1 = ox + (b.x + b.w) * z, y1 = oy + (b.y + b.h) * z, xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  return [['nw', x0, y0], ['n', xm, y0], ['ne', x1, y0], ['e', x1, ym], ['se', x1, y1], ['s', xm, y1], ['sw', x0, y1], ['w', x0, ym]];
}
const showsHandles = () => sp.tool === 'select' || sp.tool === 'wand' || sp.tool === 'move';

let antsOffset = 0;

export function draw(): void {
  if (!canvasEl) return;
  const ctx = canvas().getContext('2d')!;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.cw, view.ch);
  const { w, h } = sp.doc;
  if (fitted !== `${w}x${h}`) { fitView(); return; }
  const { zoom: z, ox, oy } = view;
  const W = w * z, H = h * z;

  // in tile mode the eight neighbours repeat the canvas, a little dimmed
  const tiles: [number, number][] = sp.tileMode
    ? [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]
    : [];
  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = sp.paperMode === 'color' ? hex(sp.paperColor) : checkerPattern(ctx);
  ctx.fillRect(0, 0, W, H);
  for (const [tx, ty] of tiles) ctx.fillRect(tx * W, ty * H, W, H);
  ctx.restore();
  ctx.imageSmoothingEnabled = false;

  if (sp.onion && sp.frame > 0) {
    putImage(onionCanvas, composite(sp.doc, sp.frame - 1, null, { refs: false }), w, h);
    ctx.globalAlpha = 0.3;
    ctx.drawImage(onionCanvas, ox, oy, W, H);
    ctx.globalAlpha = 1;
  }
  const live = liveCel();
  const layer = sp.floating ? sp.floating.layer : sp.layer;
  putImage(art, composite(sp.doc, sp.frame, live ? { layer, cel: live } : undefined), w, h);
  ctx.drawImage(art, ox, oy, W, H);
  if (tiles.length) {
    for (const [tx, ty] of tiles) ctx.drawImage(art, ox + tx * W, oy + ty * H, W, H);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
    for (const [tx, ty] of tiles) ctx.fillRect(ox + tx * W, oy + ty * H, W, H);
  }

  if (sp.showGrid) {
    const lines = (sx: number, sy: number) => {
      ctx.beginPath();
      for (let x = 0; x <= w; x += sx) { const X = Math.round(ox + x * z) + 0.5; ctx.moveTo(X, oy); ctx.lineTo(X, oy + H); }
      for (let y = 0; y <= h; y += sy) { const Y = Math.round(oy + y * z) + 0.5; ctx.moveTo(ox, Y); ctx.lineTo(ox + W, Y); }
      ctx.stroke();
    };
    ctx.lineWidth = 1;
    // the pixel grid when zoomed in, then the bigger cells on top at any zoom
    if (z >= 6) { ctx.strokeStyle = cssVar('--pixgrid'); lines(1, 1); }
    if (sp.gridW > 1 || sp.gridH > 1) { ctx.strokeStyle = cssVar('--grid'); lines(sp.gridW, sp.gridH); }
  }
  ctx.strokeStyle = cssVar('--line');
  ctx.strokeRect(ox - 0.5, oy - 0.5, W + 1, H + 1);

  // the symmetry axes, while a drawing tool is on
  if ((sp.symX || sp.symY) && DRAW_TOOLS.includes(sp.tool)) {
    ctx.save();
    ctx.strokeStyle = cssVar('--accent');
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    if (sp.symX) { const X = Math.round(ox + W / 2) + 0.5; ctx.moveTo(X, oy - 6); ctx.lineTo(X, oy + H + 6); }
    if (sp.symY) { const Y = Math.round(oy + H / 2) + 0.5; ctx.moveTo(ox - 6, Y); ctx.lineTo(ox + W + 6, Y); }
    ctx.stroke();
    ctx.restore();
  }

  drawSelection(ctx);
  if (sp.tool === 'canvas') drawCanvasHandles(ctx);

  if (hover && !spaceHeld && (inside(hover) || onTiles(hover)) && DRAW_TOOLS.includes(sp.tool) && !gesture) {
    const o = Math.floor((sp.brush - 1) / 2);
    ctx.strokeStyle = cssVar('--accent');
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox + (hover.x - o) * z + 0.75, oy + (hover.y - o) * z + 0.75, sp.brush * z - 1.5, sp.brush * z - 1.5);
  }
}

function drawSelection(ctx: CanvasRenderingContext2D): void {
  const { zoom: z, ox, oy } = view;
  const segs: [number, number, number, number][] = [];
  const f = sp.floating;
  if (f) {
    segs.push([f.x, f.y, f.x + f.w, f.y], [f.x, f.y + f.h, f.x + f.w, f.y + f.h], [f.x, f.y, f.x, f.y + f.h], [f.x + f.w, f.y, f.x + f.w, f.y + f.h]);
  } else if (sp.mask) {
    // an edge wherever a selected pixel meets an unselected one
    const { w, h } = sp.doc, m = sp.mask;
    const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!m[y * w + x]) continue;
        if (!at(x, y - 1)) segs.push([x, y, x + 1, y]);
        if (!at(x, y + 1)) segs.push([x, y + 1, x + 1, y + 1]);
        if (!at(x - 1, y)) segs.push([x, y, x, y + 1]);
        if (!at(x + 1, y)) segs.push([x + 1, y, x + 1, y + 1]);
      }
    }
  }
  if (!segs.length) return;
  ctx.beginPath();
  for (const [x0, y0, x1, y1] of segs) {
    ctx.moveTo(Math.round(ox + x0 * z) + 0.5, Math.round(oy + y0 * z) + 0.5);
    ctx.lineTo(Math.round(ox + x1 * z) + 0.5, Math.round(oy + y1 * z) + 0.5);
  }
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = '#000';
  ctx.stroke();
  ctx.setLineDash([4, 4]);
  ctx.lineDashOffset = -antsOffset;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.setLineDash([]);

  const b = selectionBox();
  if (b && showsHandles()) {
    for (const [, x, y] of handlePoints(b)) {
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#000';
      ctx.fillRect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
      ctx.strokeRect(x - HANDLE / 2 + 0.5, y - HANDLE / 2 + 0.5, HANDLE - 1, HANDLE - 1);
    }
  }
}

function drawCanvasHandles(ctx: CanvasRenderingContext2D): void {
  ctx.strokeStyle = cssVar('--accent');
  ctx.lineWidth = 2;
  ctx.strokeRect(view.ox - 1, view.oy - 1, sp.doc.w * view.zoom + 2, sp.doc.h * view.zoom + 2);
  for (const [, x, y] of handlePoints({ x: 0, y: 0, w: sp.doc.w, h: sp.doc.h })) {
    ctx.fillStyle = cssVar('--accent');
    ctx.fillRect(x - 5, y - 5, 10, 10);
    ctx.strokeStyle = cssVar('--panel');
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x - 5, y - 5, 10, 10);
  }
  if (gesture?.type === 'canvas') {
    const label = `${sp.doc.w} × ${sp.doc.h}`;
    ctx.font = '600 12px "JetBrains Mono", monospace';
    const w = ctx.measureText(label).width + 12;
    const x = view.ox + (sp.doc.w * view.zoom - w) / 2, y = Math.max(4, view.oy - 28);
    ctx.fillStyle = cssVar('--accent');
    ctx.fillRect(x, y, w, 20);
    ctx.fillStyle = cssVar('--accent-ink');
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 6, y + 10);
  }
}

// ---------- tools ----------

type Gesture =
  | { type: 'pan'; x: number; y: number }
  // `path` keeps the pixels of a pixel-perfect stroke, to take back L-shaped corners
  | { type: 'paint'; color: RGBA; last: Pt; before: Uint8ClampedArray; perfect: boolean; path: [number, number][] }
  | { type: 'rect'; shape: 'rect' | 'ellipse' | 'line'; color: RGBA; start: Pt; end: Pt }
  | { type: 'marquee'; start: Pt; end: Pt; op: MaskOp }
  // the pixels are only lifted once the pointer really moves, so a click stays a click
  | { type: 'move'; start: Pt; fx: number; fy: number; lifted: boolean; tool: Tool }
  | { type: 'scale'; handle: Handle; box: Box | null }
  // resizing the paper: `orig` is the document before the drag, the view origin stays where it was
  | { type: 'canvas'; handle: Handle; orig: SpriteDoc; ox0: number; oy0: number; changed: boolean };

let gesture: Gesture | null = null;

const colorFor = (e: PointerEvent): RGBA => (e.button === 2 ? sp.secondary : sp.primary);
const maskOp = (e: { shiftKey: boolean; altKey: boolean }): MaskOp => (e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace');
const inMask = (p: Pt) => {
  const f = sp.floating;
  if (f) return p.x >= f.x && p.y >= f.y && p.x < f.x + f.w && p.y < f.y + f.h;
  return !!sp.mask && inside(p) && sp.mask[p.y * sp.doc.w + p.x] === 1;
};

function handleAt(e: PointerEvent): Handle | null {
  const b = sp.tool === 'canvas' ? { x: 0, y: 0, w: sp.doc.w, h: sp.doc.h } : selectionBox();
  if (!b || !(showsHandles() || sp.tool === 'canvas')) return null;
  const r = canvas().getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const r2 = HANDLE / 2 + 2;
  const hit = handlePoints(b).find(([, hx, hy]) => Math.abs(hx - x) <= r2 && Math.abs(hy - y) <= r2);
  return hit ? hit[0] : null;
}

function pickColor(p: Pt, slot: 'primary' | 'secondary'): void {
  p = toCanvas(p);
  if (!inside(p)) return;
  const px = composite(sp.doc, sp.frame);
  const i = (p.y * sp.doc.w + p.x) * 4;
  setColor(slot, [px[i], px[i + 1], px[i + 2], px[i + 3]]);
}

function rectPreview(g: Extract<Gesture, { type: 'rect' }>, square: boolean): void {
  let { x, y } = g.end;
  if (g.shape === 'line') {
    // Shift: straight or 45°
    if (square) [x, y] = snapAngle(g.start.x, g.start.y, x, y);
    const c = cel();
    const out = { w: c.w, h: c.h, px: c.px.slice() };
    drawLine(out, g.start.x, g.start.y, x, y, sp.brush, g.color, paintOpts());
    sp.preview = out;
    return;
  }
  if (square) {
    const d = Math.max(Math.abs(x - g.start.x), Math.abs(y - g.start.y));
    x = g.start.x + Math.sign(x - g.start.x || 1) * d;
    y = g.start.y + Math.sign(y - g.start.y || 1) * d;
  }
  const c = cel();
  const out = { w: c.w, h: c.h, px: c.px.slice() };
  const box = boxOf(g.start.x, g.start.y, x, y);
  if (g.shape === 'ellipse') drawEllipse(out, box, sp.rectFilled, sp.brush, g.color, paintOpts());
  else drawRect(out, box, sp.rectFilled, sp.brush, g.color, paintOpts());
  sp.preview = out;
}

/** Puts back what was under a pixel (and its mirrors) before the stroke. */
function restorePixel(c: Bitmap, before: Uint8ClampedArray, x: number, y: number, o: PaintOpts): void {
  for (const [px, py] of paintPoints(c.w, c.h, x, y, o)) {
    if (px < 0 || py < 0 || px >= c.w || py >= c.h) continue;
    const i = (py * c.w + px) * 4;
    c.px.set(before.subarray(i, i + 4), i);
  }
}

/** Adds one pixel to a freehand stroke; pixel-perfect strokes take back the corner of an L. */
function strokePoint(g: Extract<Gesture, { type: 'paint' }>, x: number, y: number): void {
  const c = cel(), o = paintOpts();
  if (g.perfect) {
    const n = g.path.length, last = g.path[n - 1];
    if (last && last[0] === x && last[1] === y) return;
    if (n >= 2 && isLCorner(g.path[n - 2], last, [x, y])) { restorePixel(c, g.before, last[0], last[1], o); g.path.pop(); }
    g.path.push([x, y]);
  }
  stamp(c, x, y, sp.brush, g.color, o);
}

function strokeTo(g: Extract<Gesture, { type: 'paint' }>, p: Pt): void {
  for (const [x, y] of linePoints(g.last.x, g.last.y, p.x, p.y).slice(1)) strokePoint(g, x, y);
  g.last = p;
  lastPaint = p;
}

/** Bucket: fills the area under the pointer, or replaces its color (in this frame or in all of them). */
function bucket(p: Pt, color: RGBA): void {
  p = toCanvas(p);
  if (!inside(p)) return;
  if (sp.bucketMode === 'fill') {
    const c = cel(), before = c.px.slice();
    if (fill(c, p.x, p.y, color, true, sp.mask)) { pushCel(sp.frame, sp.layer, before); emit('pixels'); }
    return;
  }
  const from = getPixel(cel(), p.x, p.y);
  if (!sp.replaceAllFrames) {
    const c = cel(), before = c.px.slice();
    if (replaceColor(c, from, color, sp.mask)) { pushCel(sp.frame, sp.layer, before); emit('pixels'); }
    return;
  }
  const prev = cloneDoc(sp.doc);
  let n = 0;
  for (const f of sp.doc.frames) n += replaceColor(f.cels[sp.layer], from, color, sp.mask);
  if (n) { pushDoc(prev); emit('pixels', 'structure'); }
}

/** Live paper resize: new edges from the pointer, in the coordinates of the document before the drag. */
function resizeTo(g: Extract<Gesture, { type: 'canvas' }>, e: PointerEvent): void {
  const r = canvas().getBoundingClientRect(), z = view.zoom, o = g.orig;
  const px = Math.round((e.clientX - r.left - g.ox0) / z), py = Math.round((e.clientY - r.top - g.oy0) / z);
  let x0 = 0, y0 = 0, x1 = o.w, y1 = o.h;
  if (g.handle.includes('w')) x0 = Math.max(x1 - MAX_SIDE, Math.min(px, x1 - 1));
  if (g.handle.includes('e')) x1 = Math.min(x0 + MAX_SIDE, Math.max(px, x0 + 1));
  if (g.handle.includes('n')) y0 = Math.max(y1 - MAX_SIDE, Math.min(py, y1 - 1));
  if (g.handle.includes('s')) y1 = Math.min(y0 + MAX_SIDE, Math.max(py, y0 + 1));
  const w = x1 - x0, h = y1 - y0;
  if (w === sp.doc.w && h === sp.doc.h && view.ox === g.ox0 + x0 * z && view.oy === g.oy0 + y0 * z) return;
  const doc = cloneDoc(o);
  if (sp.canvasMode === 'stretch') scaleDoc(doc, w, h);
  else cropCanvas(doc, x0, y0, w, h);
  sp.doc = doc;
  g.changed = w !== o.w || h !== o.h || x0 !== 0 || y0 !== 0;
  // the opposite edge stays where it was on screen
  view.ox = g.ox0 + x0 * z;
  view.oy = g.oy0 + y0 * z;
  fitted = `${w}x${h}`;
  updateCursorInfo(null);
}

function onPointerDown(e: PointerEvent): void {
  canvas().setPointerCapture(e.pointerId);
  canvas().focus({ preventScroll: true });
  const p = pixelAt(e);
  if (e.button === 1 || sp.tool === 'pan' || spaceHeld) {
    gesture = { type: 'pan', x: e.clientX, y: e.clientY };
    stage().classList.add('panning');
    e.preventDefault();
    return;
  }
  if (e.button !== 0 && e.button !== 2) return;
  const tool: Tool = e.altKey && ['pencil', 'bucket', 'line', 'rect', 'ellipse'].includes(sp.tool) ? 'picker' : sp.tool;
  if (tool === 'canvas') {
    const handle = e.button === 0 ? handleAt(e) : null;
    if (handle) gesture = { type: 'canvas', handle, orig: cloneDoc(sp.doc), ox0: view.ox, oy0: view.oy, changed: false };
    else { gesture = { type: 'pan', x: e.clientX, y: e.clientY }; stage().classList.add('panning'); }
    return;
  }

  if (tool === 'picker') { pickColor(p, e.button === 2 ? 'secondary' : 'primary'); return; }

  if (tool === 'pencil' || tool === 'eraser') {
    const color: RGBA = tool === 'eraser' ? [0, 0, 0, 0] : colorFor(e);
    const g: Extract<Gesture, { type: 'paint' }> = {
      type: 'paint', color, last: p, before: cel().px.slice(), path: [],
      perfect: tool === 'pencil' && sp.pixelPerfect && sp.brush === 1,
    };
    // Shift+click: a straight line from where the last stroke ended
    const from = e.shiftKey && lastPaint ? lastPaint : p;
    strokePoint(g, from.x, from.y);
    g.last = from;
    strokeTo(g, p);
    gesture = g;
    draw();
    return;
  }
  if (tool === 'bucket') { bucket(p, colorFor(e)); return; }
  if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
    gesture = { type: 'rect', shape: tool, color: colorFor(e), start: p, end: p };
    rectPreview(gesture, e.shiftKey);
    draw();
    return;
  }
  if (tool === 'select' || tool === 'wand' || tool === 'move') {
    if (e.button !== 0) return;
    const handle = handleAt(e);
    if (handle) { gesture = { type: 'scale', handle, box: null }; return; }
    const op = maskOp(e);
    if (tool === 'move' || (op === 'replace' && inMask(p))) {
      gesture = { type: 'move', start: p, fx: 0, fy: 0, lifted: false, tool };
      return;
    }
    commitFloating();
    if (tool === 'wand') { wandAt(p, op); return; }
    marqueeBase = sp.mask?.slice() ?? null;
    gesture = { type: 'marquee', start: p, end: p, op };
  }
}

function onPointerMove(e: PointerEvent): void {
  const p = pixelAt(e);
  hover = p;
  updateCursorInfo(p);
  const g = gesture;
  if (!g) { updateCursor(e); draw(); return; }
  if (g.type === 'pan') {
    view.ox += e.clientX - g.x;
    view.oy += e.clientY - g.y;
    g.x = e.clientX;
    g.y = e.clientY;
    viewTouched = true;
  } else if (g.type === 'paint') {
    if (p.x === g.last.x && p.y === g.last.y) return;
    strokeTo(g, p);
  } else if (g.type === 'rect') {
    g.end = p;
    rectPreview(g, e.shiftKey);
  } else if (g.type === 'marquee') {
    g.end = p;
    const clamp = (q: Pt) => ({ x: Math.max(0, Math.min(sp.doc.w - 1, q.x)), y: Math.max(0, Math.min(sp.doc.h - 1, q.y)) });
    const a = clamp(g.start), b = clamp(p);
    sp.mask = combineMasks(marqueeBase, rectMask(sp.doc.w, sp.doc.h, boxOf(a.x, a.y, b.x, b.y)), g.op);
  } else if (g.type === 'move') {
    if (p.x === g.start.x && p.y === g.start.y && !g.lifted) return;
    if (!g.lifted) {
      const f = lift();
      if (!f) { gesture = null; return; }
      g.lifted = true;
      g.fx = f.x;
      g.fy = f.y;
      emit('pixels', 'selection');
    }
    const f = sp.floating!;
    f.x = g.fx + p.x - g.start.x;
    f.y = g.fy + p.y - g.start.y;
  } else if (g.type === 'scale') {
    if (!g.box) {
      const f = lift();
      if (!f) { gesture = null; return; }
      g.box = { x: f.x, y: f.y, w: f.w, h: f.h };
      emit('pixels', 'selection');
    }
    scaleTo(g, lineAt(e), e.shiftKey);
  } else if (g.type === 'canvas') {
    resizeTo(g, e);
  }
  draw();
}

let marqueeBase: Uint8Array | null = null;

function wandAt(p: Pt, op: MaskOp): void {
  p = toCanvas(p);
  if (!inside(p)) { deselect(); return; }
  sp.mask = combineMasks(sp.mask, colorMask(cel(), p.x, p.y, sp.contiguous), op);
  if (!sp.mask.some((v) => v)) sp.mask = null;
  emit('selection');
}

/** Resizes the floating piece so the dragged edges sit on grid line `p`. Shift keeps the proportions. */
function scaleTo(g: Extract<Gesture, { type: 'scale' }>, p: Pt, keepRatio: boolean): void {
  const f = sp.floating!, b = g.box!;
  let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
  const px = p.x, py = p.y;
  if (g.handle.includes('w')) x0 = Math.min(px, x1 - 1);
  if (g.handle.includes('e')) x1 = Math.max(px, x0 + 1);
  if (g.handle.includes('n')) y0 = Math.min(py, y1 - 1);
  if (g.handle.includes('s')) y1 = Math.max(py, y0 + 1);
  if (keepRatio) {
    const k = Math.max((x1 - x0) / b.w, (y1 - y0) / b.h);
    const W = Math.max(1, Math.round(b.w * k)), H = Math.max(1, Math.round(b.h * k));
    if (g.handle.includes('w')) x0 = x1 - W; else x1 = x0 + W;
    if (g.handle.includes('n')) y0 = y1 - H; else y1 = y0 + H;
  }
  f.x = x0; f.y = y0; f.w = x1 - x0; f.h = y1 - y0;
}

function endGesture(e: PointerEvent): void {
  const g = gesture;
  gesture = null;
  stage().classList.remove('panning');
  if (!g) return;
  if (g.type === 'paint') { pushCel(sp.frame, sp.layer, g.before); emit('pixels'); }
  else if (g.type === 'rect') {
    const c = cel(), before = c.px.slice();
    if (sp.preview) c.px.set(sp.preview.px);
    sp.preview = null;
    pushCel(sp.frame, sp.layer, before);
    emit('pixels');
  } else if (g.type === 'marquee') {
    // a click without a drag clears the selection
    if (g.start.x === g.end.x && g.start.y === g.end.y && g.op === 'replace') sp.mask = null;
    if (sp.mask && !sp.mask.some((v) => v)) sp.mask = null;
    emit('selection');
  } else if (g.type === 'canvas') {
    if (g.changed) {
      pushDoc(g.orig);
      viewTouched = true;
      emit('structure', 'pixels', 'selection');
    }
    draw();
  } else if (g.type === 'move' && !g.lifted) {
    // a click inside the selection: the wand selects again, the marquee deselects
    if (g.tool === 'wand') { commitFloating(); wandAt(g.start, 'replace'); }
    else if (g.tool === 'select') deselect();
  } else if (g.type === 'move' || (g.type === 'scale' && g.box)) {
    emit('pixels', 'selection');
  }
  updateCursor(e);
}

const CURSORS: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };

function updateCursor(e?: PointerEvent): void {
  if (!canvasEl) return;
  const c = canvas();
  if (spaceHeld || sp.tool === 'pan' || (sp.tool === 'canvas' && !(e && handleAt(e)))) { c.style.cursor = gesture?.type === 'pan' ? 'grabbing' : 'grab'; return; }
  const h = e && handleAt(e);
  if (h) { c.style.cursor = CURSORS[h]; return; }
  if (sp.tool === 'move' || (e && (sp.tool === 'select' || sp.tool === 'wand') && !e.shiftKey && !e.altKey && inMask(pixelAt(e)))) { c.style.cursor = 'move'; return; }
  c.style.cursor = sp.tool === 'picker' ? 'copy' : 'crosshair';
}

function updateCursorInfo(p: Pt | null): void {
  let text = '';
  if (p && onTiles(p)) p = toCanvas(p);
  if (p && inside(p)) {
    const [r, g, b, a] = getPixel(sp.preview ?? cel(), p.x, p.y);
    text = `${p.x}, ${p.y}` + (a ? `  #${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}` : '');
  }
  if (text !== hoverInfo) { hoverInfo = text; emit('hover'); }
}

// ---------- selection commands (keyboard, buttons) ----------

/** Moves the selection 1 px (or more) by lifting it. */
export function nudge(dx: number, dy: number): void {
  if (!sp.mask && !sp.floating) return;
  const f = lift();
  if (!f) return;
  f.x += dx;
  f.y += dy;
  emit('pixels', 'selection');
}

export function selectAll(): void {
  commitFloating();
  sp.mask = rectMask(sp.doc.w, sp.doc.h, { x: 0, y: 0, w: sp.doc.w, h: sp.doc.h });
  emit('selection');
}

export const setSpaceHeld = (v: boolean) => { spaceHeld = v; updateCursor(); draw(); };

/** Connects the engine to the canvas element (and the box that sizes it). Returns the undo for React's effect cleanup. */
export function attachCanvas(stageBox: HTMLElement, canvasBox: HTMLCanvasElement): () => void {
  stageEl = stageBox;
  canvasEl = canvasBox;
  view.cw = 0;
  fitted = '';
  const ro = new ResizeObserver(sizeStage);
  ro.observe(stageBox);
  const c = canvasBox;
  const leave = () => { hover = null; updateCursorInfo(null); draw(); };
  const menu = (e: Event) => e.preventDefault();
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    const r = c.getBoundingClientRect();
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomStep(e.deltaY < 0 ? 1 : -1, [e.clientX - r.left, e.clientY - r.top]);
  };
  c.addEventListener('pointerdown', onPointerDown);
  c.addEventListener('pointermove', onPointerMove);
  c.addEventListener('pointerup', endGesture);
  c.addEventListener('pointercancel', endGesture);
  c.addEventListener('pointerleave', leave);
  c.addEventListener('contextmenu', menu);
  c.addEventListener('wheel', wheel, { passive: false });

  const scheme = matchMedia('(prefers-color-scheme: dark)');
  const rescheme = () => { checker = null; draw(); };
  scheme.addEventListener('change', rescheme);

  const offs = [
    on('pixels', draw), on('selection', draw), on('cursor', draw), on('structure', draw),
    on('paper', draw), on('view', draw), on('tool', () => { updateCursor(); draw(); }),
  ];

  // marching ants, only while there is a selection and the editor is on screen
  const ants = setInterval(() => {
    if (!(sp.mask || sp.floating) || document.hidden || !stageBox.offsetParent) return;
    antsOffset = (antsOffset + 1) % 8;
    draw();
  }, 120);

  return () => {
    ro.disconnect();
    clearInterval(ants);
    scheme.removeEventListener('change', rescheme);
    offs.forEach((off) => off());
    c.removeEventListener('pointerdown', onPointerDown);
    c.removeEventListener('pointermove', onPointerMove);
    c.removeEventListener('pointerup', endGesture);
    c.removeEventListener('pointercancel', endGesture);
    c.removeEventListener('pointerleave', leave);
    c.removeEventListener('contextmenu', menu);
    c.removeEventListener('wheel', wheel);
    if (canvasEl === canvasBox) { stageEl = null; canvasEl = null; }
  };
}
