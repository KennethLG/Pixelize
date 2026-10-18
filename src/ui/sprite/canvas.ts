// The sprite editor canvas: zoom/pan view, drawing (onion skin, grid,
// selection outline, scale handles) and the tools.

import {
  boxOf, colorMask, combineMasks, drawLine, drawRect, fill, getPixel, maskBounds, rectMask,
  type Box, type MaskOp,
} from '../../core/bitmap';
import type { RGBA } from '../../core/color';
import { composite } from '../../core/sprite';
import { $, cssVar } from '../dom';
import { cel, commitFloating, deselect, emit, lift, liveCel, on, pushCel, setColor, sp, type Tool } from './state';

type Pt = { x: number; y: number };

const stage = () => $('spStage');
const canvas = () => $<HTMLCanvasElement>('spCanvas');
const view = { zoom: 8, ox: 0, oy: 0, cw: 0, ch: 0, dpr: 1 };
let fitted = '';
let viewTouched = false;  // zoomed or panned by hand since the last fit
let hover: Pt | null = null;
let spaceHeld = false;
let lastPaint: Pt | null = null;     // for Shift+click straight lines
const PAPER_KEY = 'pixelize.sprite.paper';
/** What shows behind the sprite: a checkerboard, or a flat color. Only for looking at; exports stay transparent. */
const paper = { mode: 'checker' as 'checker' | 'color', color: '#ffffff' };
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
  view.zoom = z;
  $('spZoom').textContent = `${Math.round(z * 100)}%`;
}

export function fitView(): void {
  const { w, h } = sp.doc;
  if (!view.cw) return;
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
  const ctx = canvas().getContext('2d')!;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.cw, view.ch);
  const { w, h } = sp.doc;
  if (fitted !== `${w}x${h}`) { fitView(); return; }
  const { zoom: z, ox, oy } = view;
  const W = w * z, H = h * z;

  ctx.save();
  ctx.translate(ox, oy);
  ctx.fillStyle = paper.mode === 'color' ? paper.color : checkerPattern(ctx);
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
  ctx.imageSmoothingEnabled = false;

  if (sp.onion && sp.frame > 0) {
    putImage(onionCanvas, composite(sp.doc, sp.frame - 1), w, h);
    ctx.globalAlpha = 0.3;
    ctx.drawImage(onionCanvas, ox, oy, W, H);
    ctx.globalAlpha = 1;
  }
  const live = liveCel();
  const layer = sp.floating ? sp.floating.layer : sp.layer;
  putImage(art, composite(sp.doc, sp.frame, live ? { layer, cel: live } : undefined), w, h);
  ctx.drawImage(art, ox, oy, W, H);

  if (($('spGrid') as HTMLInputElement).checked && z >= 6) {
    ctx.strokeStyle = cssVar('--pixgrid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x++) { const X = Math.round(ox + x * z) + 0.5; ctx.moveTo(X, oy); ctx.lineTo(X, oy + H); }
    for (let y = 0; y <= h; y++) { const Y = Math.round(oy + y * z) + 0.5; ctx.moveTo(ox, Y); ctx.lineTo(ox + W, Y); }
    ctx.stroke();
  }
  ctx.strokeStyle = cssVar('--line');
  ctx.strokeRect(ox - 0.5, oy - 0.5, W + 1, H + 1);

  drawSelection(ctx);

  if (hover && !spaceHeld && inside(hover) && ['pencil', 'eraser', 'rect'].includes(sp.tool) && !gesture) {
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

// ---------- tools ----------

type Gesture =
  | { type: 'pan'; x: number; y: number }
  | { type: 'paint'; color: RGBA; last: Pt; before: Uint8ClampedArray }
  | { type: 'rect'; color: RGBA; start: Pt; end: Pt }
  | { type: 'marquee'; start: Pt; end: Pt; op: MaskOp }
  // the pixels are only lifted once the pointer really moves, so a click stays a click
  | { type: 'move'; start: Pt; fx: number; fy: number; lifted: boolean; tool: Tool }
  | { type: 'scale'; handle: Handle; box: Box | null };

let gesture: Gesture | null = null;

const colorFor = (e: PointerEvent): RGBA => (e.button === 2 ? sp.secondary : sp.primary);
const maskOp = (e: { shiftKey: boolean; altKey: boolean }): MaskOp => (e.shiftKey ? 'add' : e.altKey ? 'subtract' : 'replace');
const inMask = (p: Pt) => {
  const f = sp.floating;
  if (f) return p.x >= f.x && p.y >= f.y && p.x < f.x + f.w && p.y < f.y + f.h;
  return !!sp.mask && inside(p) && sp.mask[p.y * sp.doc.w + p.x] === 1;
};

function handleAt(e: PointerEvent): Handle | null {
  const b = selectionBox();
  if (!b || !showsHandles()) return null;
  const r = canvas().getBoundingClientRect();
  const x = e.clientX - r.left, y = e.clientY - r.top;
  const r2 = HANDLE / 2 + 2;
  const hit = handlePoints(b).find(([, hx, hy]) => Math.abs(hx - x) <= r2 && Math.abs(hy - y) <= r2);
  return hit ? hit[0] : null;
}

function pickColor(p: Pt, slot: 'primary' | 'secondary'): void {
  if (!inside(p)) return;
  const px = composite(sp.doc, sp.frame);
  const i = (p.y * sp.doc.w + p.x) * 4;
  setColor(slot, [px[i], px[i + 1], px[i + 2], px[i + 3]]);
}

function rectPreview(g: Extract<Gesture, { type: 'rect' }>, square: boolean): void {
  let { x, y } = g.end;
  if (square) {
    const d = Math.max(Math.abs(x - g.start.x), Math.abs(y - g.start.y));
    x = g.start.x + Math.sign(x - g.start.x || 1) * d;
    y = g.start.y + Math.sign(y - g.start.y || 1) * d;
  }
  const c = cel();
  const out = { w: c.w, h: c.h, px: c.px.slice() };
  drawRect(out, boxOf(g.start.x, g.start.y, x, y), sp.rectFilled, sp.brush, g.color, sp.mask);
  sp.preview = out;
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
  const tool: Tool = e.altKey && (sp.tool === 'pencil' || sp.tool === 'bucket' || sp.tool === 'rect') ? 'picker' : sp.tool;

  if (tool === 'picker') { pickColor(p, e.button === 2 ? 'secondary' : 'primary'); return; }

  if (tool === 'pencil' || tool === 'eraser') {
    const color: RGBA = tool === 'eraser' ? [0, 0, 0, 0] : colorFor(e);
    const c = cel(), before = c.px.slice();
    const from = e.shiftKey && lastPaint ? lastPaint : p;
    drawLine(c, from.x, from.y, p.x, p.y, sp.brush, color, sp.mask);
    gesture = { type: 'paint', color, last: p, before };
    lastPaint = p;
    draw();
    return;
  }
  if (tool === 'bucket') {
    const c = cel(), before = c.px.slice();
    if (fill(c, p.x, p.y, colorFor(e), sp.contiguous, sp.mask)) { pushCel(sp.frame, sp.layer, before); emit('pixels'); }
    return;
  }
  if (tool === 'rect') {
    gesture = { type: 'rect', color: colorFor(e), start: p, end: p };
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
    drawLine(cel(), g.last.x, g.last.y, p.x, p.y, sp.brush, g.color, sp.mask);
    g.last = p;
    lastPaint = p;
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
  }
  draw();
}

let marqueeBase: Uint8Array | null = null;

function wandAt(p: Pt, op: MaskOp): void {
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
  const c = canvas();
  if (spaceHeld || sp.tool === 'pan') { c.style.cursor = gesture?.type === 'pan' ? 'grabbing' : 'grab'; return; }
  const h = e && handleAt(e);
  if (h) { c.style.cursor = CURSORS[h]; return; }
  if (sp.tool === 'move' || (e && (sp.tool === 'select' || sp.tool === 'wand') && !e.shiftKey && !e.altKey && inMask(pixelAt(e)))) { c.style.cursor = 'move'; return; }
  c.style.cursor = sp.tool === 'picker' ? 'copy' : 'crosshair';
}

function updateCursorInfo(p: Pt | null): void {
  const info = $('spPos');
  if (!p || !inside(p)) { info.textContent = `${sp.doc.w}×${sp.doc.h}`; return; }
  const [r, g, b, a] = getPixel(sp.preview ?? cel(), p.x, p.y);
  info.textContent = `${p.x}, ${p.y}` + (a ? `  #${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}` : '');
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

function applyPaper(): void {
  const root = $('spriteMode');
  root.classList.toggle('paper-solid', paper.mode === 'color');
  root.style.setProperty('--paper', paper.color);
  (document.querySelector(`input[name="spPaper"][value="${paper.mode}"]`) as HTMLInputElement).checked = true;
  ($('spPaperColor') as HTMLInputElement).value = paper.color;
  try { localStorage.setItem(PAPER_KEY, JSON.stringify(paper)); } catch { /* storage unavailable */ }
  draw();
}

function initPaper(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(PAPER_KEY) || 'null') as typeof paper | null;
    if (saved?.mode === 'color' || saved?.mode === 'checker') paper.mode = saved.mode;
    if (/^#[0-9a-f]{6}$/i.test(saved?.color || '')) paper.color = saved!.color;
  } catch { /* nothing saved */ }
  document.querySelectorAll<HTMLInputElement>('input[name="spPaper"]').forEach((r) => r.addEventListener('change', () => {
    if (r.checked) { paper.mode = r.value as typeof paper.mode; applyPaper(); }
  }));
  // picking a color switches to it
  $('spPaperColor').addEventListener('input', () => { paper.color = ($('spPaperColor') as HTMLInputElement).value; paper.mode = 'color'; applyPaper(); });
  applyPaper();
}

export const setSpaceHeld = (v: boolean) => { spaceHeld = v; updateCursor(); draw(); };

export function initCanvas(): void {
  new ResizeObserver(sizeStage).observe(stage());
  initPaper();
  const c = canvas();
  c.addEventListener('pointerdown', onPointerDown);
  c.addEventListener('pointermove', onPointerMove);
  c.addEventListener('pointerup', endGesture);
  c.addEventListener('pointercancel', endGesture);
  c.addEventListener('pointerleave', () => { hover = null; updateCursorInfo(null); draw(); });
  c.addEventListener('contextmenu', (e) => e.preventDefault());
  c.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = c.getBoundingClientRect();
    if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomStep(e.deltaY < 0 ? 1 : -1, [e.clientX - r.left, e.clientY - r.top]);
  }, { passive: false });

  $('spZoomIn').addEventListener('click', () => zoomStep(1));
  $('spZoomOut').addEventListener('click', () => zoomStep(-1));
  $('spFit').addEventListener('click', fitView);
  $('spGrid').addEventListener('change', draw);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { checker = null; draw(); });

  on('pixels', draw);
  on('selection', draw);
  on('cursor', draw);
  on('structure', draw);
  on('tool', () => { updateCursor(); draw(); });

  // marching ants
  setInterval(() => {
    if (!(sp.mask || sp.floating) || document.hidden || $('spriteMode').hidden) return;
    antsOffset = (antsOffset + 1) % 8;
    draw();
  }, 120);
}
