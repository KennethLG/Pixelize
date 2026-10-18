// The result editor engine: zoom/pan view, pixel grid, before/after split, and
// the drawing tools. Edits live in app.edits, on top of the processed base.
// Imperative on purpose; the ResultView component attaches it with
// attachEditor() and shows the state below.

import { hex, keyAt, type RGB, type RGBA } from '../core/color';
import { app, commitEdits, pushUndo, pxBus, redo, schedule, undo } from './app';
import { cssVar } from './dom';
import { currentMode } from './mode';
import { setSettings, settings } from './settings';
import { currentStep } from './steps';

export type EditTool = 'pan' | 'pencil' | 'eraser' | 'fill' | 'picker' | 'bg';

/** What the components show: tool, drawing color and zoom. Changes emit 'editor'. */
export const ed = { tool: 'pan' as EditTool, color: [27, 21, 48] as RGB, zoom: 1 };

let stageEl: HTMLElement | null = null;
let canvasEl: HTMLCanvasElement | null = null;
const view = { zoom: 1, ox: 0, oy: 0, cw: 0, ch: 0, dpr: 1 };
let fittedDims = '';     // result size the view was last fitted to
let viewTouched = false; // the user zoomed or panned since the last fit
let hover: { x: number; y: number } | null = null;
let spaceHeld = false;

// ---------- view ----------

function sizeEditor(): void {
  if (!stageEl || !canvasEl) return;
  const r = stageEl.getBoundingClientRect();
  if (!r.width || !r.height) return;
  view.dpr = window.devicePixelRatio || 1;
  // keep what was centered centered; refit if the view was never touched
  if (view.cw) { view.ox += (r.width - view.cw) / 2; view.oy += (r.height - view.ch) / 2; }
  view.cw = r.width;
  view.ch = r.height;
  canvasEl.width = Math.max(1, Math.round(r.width * view.dpr));
  canvasEl.height = Math.max(1, Math.round(r.height * view.dpr));
  if (!viewTouched) fittedDims = '';
  draw();
}

function setZoom(z: number, at: [number, number] | null): void {
  z = Math.max(0.25, Math.min(80, z));
  const cx = at ? at[0] : view.cw / 2, cy = at ? at[1] : view.ch / 2;
  view.ox = cx - ((cx - view.ox) * z) / view.zoom;
  view.oy = cy - ((cy - view.oy) * z) / view.zoom;
  view.zoom = z;
  if (ed.zoom !== z) { ed.zoom = z; pxBus.emit('editor'); }
}

function fitView(): void {
  const res = app.result;
  if (!res || !view.cw) return;
  fittedDims = `${res.width}x${res.height}`;
  let z = Math.min((view.cw - 24) / res.width, (view.ch - 24) / res.height);
  if (z >= 1) z = Math.floor(z);
  setZoom(z, null);
  view.ox = Math.round((view.cw - res.width * view.zoom) / 2);
  view.oy = Math.round((view.ch - res.height * view.zoom) / 2);
  viewTouched = false;
}

export function refit(): void { fittedDims = ''; draw(); }

export function zoomStep(dir: 1 | -1, at: [number, number] | null = null): void {
  const steps = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 80];
  const z = view.zoom;
  const next = dir > 0 ? steps.find((s) => s > z + 1e-6) : [...steps].reverse().find((s) => s < z - 1e-6);
  setZoom(next || z, at);
  viewTouched = true;
  draw();
}

export function draw(): void {
  if (!canvasEl) return;
  const ctx = canvasEl.getContext('2d')!;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.cw, view.ch);
  const res = app.result;
  if (!res) return;
  if (fittedDims !== `${res.width}x${res.height}`) fitView();
  const { zoom: z, ox, oy } = view;
  const W = res.width * z, H = res.height * z;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(app.resultCanvas, ox, oy, W, H);

  const compare = settings.compare && ['colors', 'clean', 'edit'].includes(currentStep());
  if (compare && app.source && app.base) {
    const sx = (view.cw * settings.split) / 100;
    // the part of the original that the (maybe cropped) result covers
    const { xs, ys } = app.base.grid, c = app.base.crop;
    const x0 = xs[c.x], y0 = ys[c.y], x1 = xs[c.x + c.w], y1 = ys[c.y + c.h];
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, sx, view.ch);
    ctx.clip();
    ctx.clearRect(0, 0, sx, view.ch);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(app.source.img, x0, y0, x1 - x0, y1 - y0, ox, oy, W, H);
    ctx.restore();
    ctx.fillStyle = cssVar('--accent');
    ctx.fillRect(sx - 1, 0, 2, view.ch);
    ctx.font = '600 11px "JetBrains Mono", monospace';
    ctx.textBaseline = 'top';
    const tag = (text: string, x: number) => {
      const w = ctx.measureText(text).width + 10;
      ctx.fillStyle = cssVar('--panel'); ctx.fillRect(x, 8, w, 18);
      ctx.fillStyle = cssVar('--ink'); ctx.fillText(text, x + 5, 11);
    };
    if (sx > 70) tag('BEFORE', sx - 66);
    if (sx < view.cw - 60) tag('AFTER', sx + 6);
  }

  if (settings.pixGrid && z >= 6) {
    ctx.strokeStyle = cssVar('--pixgrid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = Math.max(0, Math.floor(-ox / z)), x1 = Math.min(res.width, Math.ceil((view.cw - ox) / z));
    const y0 = Math.max(0, Math.floor(-oy / z)), y1 = Math.min(res.height, Math.ceil((view.ch - oy) / z));
    for (let x = x0; x <= x1; x++) { const X = Math.round(ox + x * z) + 0.5; ctx.moveTo(X, oy + y0 * z); ctx.lineTo(X, oy + y1 * z); }
    for (let y = y0; y <= y1; y++) { const Y = Math.round(oy + y * z) + 0.5; ctx.moveTo(ox + x0 * z, Y); ctx.lineTo(ox + x1 * z, Y); }
    ctx.stroke();
  }

  if (hover && ed.tool !== 'pan' && !spaceHeld && inBounds(hover)) {
    ctx.strokeStyle = cssVar('--accent');
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + hover.x * z + 1, oy + hover.y * z + 1, Math.max(2, z - 2), Math.max(2, z - 2));
  }
}

// ---------- tools ----------

const panning = () => ed.tool === 'pan' || spaceHeld;
function updateStageClasses(): void {
  stageEl?.classList.toggle('pan', panning());
  stageEl?.classList.toggle('draw', !panning());
}

export function setTool(t: EditTool): void {
  ed.tool = t;
  updateStageClasses();
  pxBus.emit('editor');
  draw();
}

export function setDrawColor(rgb: RGB): void {
  ed.color = [rgb[0], rgb[1], rgb[2]];
  pxBus.emit('editor');
}

export const drawHex = () => hex(ed.color);

function pixelAt(e: PointerEvent | MouseEvent) {
  const r = canvasEl!.getBoundingClientRect();
  return { x: Math.floor((e.clientX - r.left - view.ox) / view.zoom), y: Math.floor((e.clientY - r.top - view.oy) / view.zoom) };
}
const inBounds = (p: { x: number; y: number }) => {
  const res = app.result;
  return !!res && p.x >= 0 && p.y >= 0 && p.x < res.width && p.y < res.height;
};

function setPixel(x: number, y: number, rgba: RGBA): void {
  const res = app.result!, base = app.base!.pixels;
  const i = (y * res.width + x) * 4;
  // painting a pixel back to its processed color is no edit at all
  if (base[i] === rgba[0] && base[i + 1] === rgba[1] && base[i + 2] === rgba[2] && base[i + 3] === rgba[3]) app.edits.delete(i);
  else app.edits.set(i, rgba);
  res.pixels.set(rgba, i);
}

function paintLine(a: { x: number; y: number }, b: { x: number; y: number }): void {
  const res = app.result!;
  const rgba: RGBA = ed.tool === 'eraser' ? [0, 0, 0, 0] : [...ed.color, 255];
  let x0 = a.x, y0 = a.y;
  const dx = Math.abs(b.x - x0), dy = -Math.abs(b.y - y0), sx = x0 < b.x ? 1 : -1, sy = y0 < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x0 >= 0 && y0 >= 0 && x0 < res.width && y0 < res.height) setPixel(x0, y0, rgba);
    if (x0 === b.x && y0 === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  app.resultCanvas.getContext('2d')!.putImageData(new ImageData(res.pixels, res.width, res.height), 0, 0);
}

function floodFill(p: { x: number; y: number }): void {
  const { width: w, height: h, pixels: px } = app.result!;
  const i0 = (p.y * w + p.x) * 4;
  const target = [px[i0], px[i0 + 1], px[i0 + 2], px[i0 + 3]];
  const rgba: RGBA = [...ed.color, 255];
  if (target.every((v, k) => v === rgba[k])) return;
  const same = (i: number) => px[i] === target[0] && px[i + 1] === target[1] && px[i + 2] === target[2] && px[i + 3] === target[3];
  pushUndo();
  const stack = [p.x, p.y];
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!;
    if (x < 0 || y < 0 || x >= w || y >= h || !same((y * w + x) * 4)) continue;
    setPixel(x, y, rgba);
    stack.push(x - 1, y, x + 1, y, x, y - 1, x, y + 1);
  }
  commitEdits();
}

export function clearEdits(): void {
  if (!app.edits.size) return;
  pushUndo();
  app.edits = new Map();
  commitEdits();
}

// ---------- pointer and keyboard ----------

let gesture: { type: 'pan'; x: number; y: number } | { type: 'paint'; last: { x: number; y: number } } | null = null;

function onPointerDown(e: PointerEvent): void {
  if (!app.result || !app.base) return;
  canvasEl!.setPointerCapture(e.pointerId);
  const p = pixelAt(e);
  if (e.button === 1 || panning()) {
    gesture = { type: 'pan', x: e.clientX, y: e.clientY };
    stageEl!.classList.add('panning');
    e.preventDefault();
    return;
  }
  if (e.button !== 0 || !inBounds(p)) return;
  const res = app.result, base = app.base;
  if (ed.tool === 'pencil' || ed.tool === 'eraser') {
    pushUndo();
    gesture = { type: 'paint', last: p };
    paintLine(p, p);
    draw();
  } else if (ed.tool === 'fill') {
    floodFill(p);
  } else if (ed.tool === 'picker') {
    const i = (p.y * res.width + p.x) * 4;
    if (res.pixels[i + 3]) { setDrawColor([res.pixels[i], res.pixels[i + 1], res.pixels[i + 2]]); setTool('pencil'); }
  } else if (ed.tool === 'bg') {
    // preBg is the uncropped image, so the pick is stored in its coordinates
    const x = p.x + base.crop.x, y = p.y + base.crop.y;
    const i = (y * base.fullW + x) * 4;
    if (base.preBg[i + 3]) {
      app.bgPick = { key: keyAt(base.preBg, i), x, y };
      setTool('pan');
      setSettings({ removeBg: true });
      schedule();
    }
  }
}

function onPointerMove(e: PointerEvent): void {
  const p = pixelAt(e);
  if (gesture?.type === 'pan') {
    view.ox += e.clientX - gesture.x;
    view.oy += e.clientY - gesture.y;
    gesture.x = e.clientX;
    gesture.y = e.clientY;
    viewTouched = true;
  } else if (gesture?.type === 'paint' && (p.x !== gesture.last.x || p.y !== gesture.last.y)) {
    paintLine(gesture.last, p);
    gesture.last = p;
  }
  hover = p;
  draw();
}

function endGesture(): void {
  if (gesture?.type === 'paint') commitEdits();
  gesture = null;
  stageEl?.classList.remove('panning');
}

function onKeyDown(e: KeyboardEvent): void {
  if (currentMode() !== 'pixelize') return;
  const target = e.target as HTMLElement;
  if (target.matches?.('input[type="text"], input[type="number"], textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if (mod && k === 'y') { e.preventDefault(); redo(); return; }
  if (mod || e.altKey || target.closest?.('.frame')) return;
  // the result view only shows on these steps, and the tools only on "Touch up"
  const step = currentStep();
  if (!['grid', 'colors', 'clean', 'edit', 'export'].includes(step)) return;
  const tools: Record<string, EditTool> = { h: 'pan', b: 'pencil', e: 'eraser', g: 'fill', i: 'picker' };
  if (tools[k]) { if (step === 'edit') setTool(tools[k]); }
  else if (k === '+' || k === '=') zoomStep(1);
  else if (k === '-') zoomStep(-1);
  else if (k === '0') refit();
  else if (e.key === ' ' && stageEl?.matches(':hover')) {
    e.preventDefault();
    if (!spaceHeld) { spaceHeld = true; updateStageClasses(); draw(); }
  }
}

/** Connects the engine to the result canvas. Returns the cleanup. */
export function attachEditor(stage: HTMLElement, cv: HTMLCanvasElement): () => void {
  stageEl = stage;
  canvasEl = cv;
  view.cw = 0;
  fittedDims = '';
  updateStageClasses();
  const ro = new ResizeObserver(sizeEditor);
  ro.observe(stage);
  const leave = () => { hover = null; draw(); };
  const wheel = (e: WheelEvent) => {
    if (!app.result) return;
    e.preventDefault();
    const r = cv.getBoundingClientRect();
    zoomStep(e.deltaY < 0 ? 1 : -1, [e.clientX - r.left, e.clientY - r.top]);
  };
  cv.addEventListener('pointerdown', onPointerDown);
  cv.addEventListener('pointermove', onPointerMove);
  cv.addEventListener('pointerup', endGesture);
  cv.addEventListener('pointercancel', endGesture);
  cv.addEventListener('pointerleave', leave);
  cv.addEventListener('wheel', wheel, { passive: false });
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', draw);
  return () => {
    ro.disconnect();
    scheme.removeEventListener('change', draw);
    cv.removeEventListener('pointerdown', onPointerDown);
    cv.removeEventListener('pointermove', onPointerMove);
    cv.removeEventListener('pointerup', endGesture);
    cv.removeEventListener('pointercancel', endGesture);
    cv.removeEventListener('pointerleave', leave);
    cv.removeEventListener('wheel', wheel);
    if (canvasEl === cv) { stageEl = null; canvasEl = null; }
  };
}

export function initEditor(): void {
  pxBus.on('source', () => { fittedDims = ''; viewTouched = false; });
  pxBus.on('result', draw);
  pxBus.on('settings', draw);
  pxBus.on('step', () => {
    // drawing tools belong to "Touch up" and the background picker to its step
    const s = currentStep();
    const allowed = ed.tool === 'pan' || (s === 'edit' && ed.tool !== 'bg') || (s === 'clean' && ed.tool === 'bg');
    if (!allowed) setTool('pan');
    draw();
  });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ' && spaceHeld && currentMode() === 'pixelize') { spaceHeld = false; updateStageClasses(); draw(); }
  });
}
