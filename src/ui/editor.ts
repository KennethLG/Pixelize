// The result editor: zoom/pan view, pixel grid, before/after split, and the
// drawing tools. Edits live in app.edits, on top of the processed base.

import { hex, hexToRgb, keyAt, type RGB, type RGBA } from '../core/color';
import { app, canRedo, canUndo, commitEdits, onResult, onSource, pushUndo, redo, schedule, undo } from './app';
import { $, cssVar, field, isChecked, num } from './dom';
import { saveSettings } from './settings';
import { currentMode } from './mode';
import { currentStep, onStep } from './steps';

type Tool = 'pan' | 'pencil' | 'eraser' | 'fill' | 'picker' | 'bg';

const stage = () => $('editStage');
const canvas = () => $<HTMLCanvasElement>('editCanvas');
const view = { zoom: 1, ox: 0, oy: 0, cw: 0, ch: 0, dpr: 1 };
let fittedDims = '';     // result size the view was last fitted to
let viewTouched = false; // the user zoomed or panned since the last fit
let tool: Tool = 'pan';
let drawColor: RGB = [27, 21, 48];
let hover: { x: number; y: number } | null = null;
let spaceHeld = false;

// ---------- view ----------

function sizeEditor(): void {
  const r = stage().getBoundingClientRect();
  if (!r.width || !r.height) return;
  view.dpr = window.devicePixelRatio || 1;
  // keep what was centered centered; refit if the view was never touched
  if (view.cw) { view.ox += (r.width - view.cw) / 2; view.oy += (r.height - view.ch) / 2; }
  view.cw = r.width;
  view.ch = r.height;
  canvas().width = Math.max(1, Math.round(r.width * view.dpr));
  canvas().height = Math.max(1, Math.round(r.height * view.dpr));
  if (!viewTouched) fittedDims = '';
  draw();
}

function setZoom(z: number, at: [number, number] | null): void {
  z = Math.max(0.25, Math.min(80, z));
  const cx = at ? at[0] : view.cw / 2, cy = at ? at[1] : view.ch / 2;
  view.ox = cx - ((cx - view.ox) * z) / view.zoom;
  view.oy = cy - ((cy - view.oy) * z) / view.zoom;
  view.zoom = z;
  $('zoomLabel').textContent = `${Math.round(z * 100)}%`;
}

function fitView(): void {
  const res = app.result;
  if (!res || !view.cw) return;
  let z = Math.min((view.cw - 24) / res.width, (view.ch - 24) / res.height);
  if (z >= 1) z = Math.floor(z);
  setZoom(z, null);
  view.ox = Math.round((view.cw - res.width * view.zoom) / 2);
  view.oy = Math.round((view.ch - res.height * view.zoom) / 2);
  fittedDims = `${res.width}x${res.height}`;
  viewTouched = false;
}

function zoomStep(dir: 1 | -1, at: [number, number] | null): void {
  const steps = [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 80];
  const z = view.zoom;
  const next = dir > 0 ? steps.find((s) => s > z + 1e-6) : [...steps].reverse().find((s) => s < z - 1e-6);
  setZoom(next || z, at);
  viewTouched = true;
  draw();
}

export function draw(): void {
  const ctx = canvas().getContext('2d')!;
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.clearRect(0, 0, view.cw, view.ch);
  const res = app.result;
  if (!res) return;
  if (fittedDims !== `${res.width}x${res.height}`) fitView();
  const { zoom: z, ox, oy } = view;
  const W = res.width * z, H = res.height * z;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(app.resultCanvas, ox, oy, W, H);

  if (isChecked('compare') && app.source && app.base) {
    const sx = (view.cw * num('split')) / 100;
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

  if (isChecked('pixGrid') && z >= 6) {
    ctx.strokeStyle = cssVar('--pixgrid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = Math.max(0, Math.floor(-ox / z)), x1 = Math.min(res.width, Math.ceil((view.cw - ox) / z));
    const y0 = Math.max(0, Math.floor(-oy / z)), y1 = Math.min(res.height, Math.ceil((view.ch - oy) / z));
    for (let x = x0; x <= x1; x++) { const X = Math.round(ox + x * z) + 0.5; ctx.moveTo(X, oy + y0 * z); ctx.lineTo(X, oy + y1 * z); }
    for (let y = y0; y <= y1; y++) { const Y = Math.round(oy + y * z) + 0.5; ctx.moveTo(ox + x0 * z, Y); ctx.lineTo(ox + x1 * z, Y); }
    ctx.stroke();
  }

  if (hover && tool !== 'pan' && !spaceHeld && inBounds(hover)) {
    ctx.strokeStyle = cssVar('--accent');
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + hover.x * z + 1, oy + hover.y * z + 1, Math.max(2, z - 2), Math.max(2, z - 2));
  }
}

// ---------- tools ----------

function setTool(t: Tool): void {
  tool = t;
  document.querySelectorAll<HTMLElement>('.tool').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
  stage().classList.toggle('pan', t === 'pan');
  stage().classList.toggle('draw', t !== 'pan');
  draw();
}

export function setDrawColor(rgb: RGB): void {
  drawColor = [rgb[0], rgb[1], rgb[2]];
  field('drawColor').value = hex(drawColor);
  $('drawHex').textContent = hex(drawColor);
}

function pixelAt(e: PointerEvent | MouseEvent) {
  const r = canvas().getBoundingClientRect();
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
  const rgba: RGBA = tool === 'eraser' ? [0, 0, 0, 0] : [...drawColor, 255];
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
  const rgba: RGBA = [...drawColor, 255];
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

function updateEditUI(): void {
  const n = app.edits.size;
  $('editInfo').textContent = n ? `${n} pixel${n === 1 ? '' : 's'} edited` : 'No pixel edits';
  field('undoBtn').disabled = !canUndo();
  field('redoBtn').disabled = !canRedo();
  field('clearEdits').disabled = !n;
}

// ---------- pointer and keyboard ----------

let gesture: { type: 'pan'; x: number; y: number } | { type: 'paint'; last: { x: number; y: number } } | null = null;

function onPointerDown(e: PointerEvent): void {
  if (!app.result || !app.base) return;
  canvas().setPointerCapture(e.pointerId);
  const p = pixelAt(e);
  if (e.button === 1 || tool === 'pan' || spaceHeld) {
    gesture = { type: 'pan', x: e.clientX, y: e.clientY };
    stage().classList.add('panning');
    e.preventDefault();
    return;
  }
  if (e.button !== 0 || !inBounds(p)) return;
  const res = app.result, base = app.base;
  if (tool === 'pencil' || tool === 'eraser') {
    pushUndo();
    gesture = { type: 'paint', last: p };
    paintLine(p, p);
    draw();
  } else if (tool === 'fill') {
    floodFill(p);
  } else if (tool === 'picker') {
    const i = (p.y * res.width + p.x) * 4;
    if (res.pixels[i + 3]) { setDrawColor([res.pixels[i], res.pixels[i + 1], res.pixels[i + 2]]); setTool('pencil'); }
  } else if (tool === 'bg') {
    // preBg is the uncropped image, so the pick is stored in its coordinates
    const x = p.x + base.crop.x, y = p.y + base.crop.y;
    const i = (y * base.fullW + x) * 4;
    if (base.preBg[i + 3]) {
      app.bgPick = { key: keyAt(base.preBg, i), x, y };
      field('removeBg').checked = true;
      field('removeBg').dispatchEvent(new Event('change'));
      setTool('pan');
      saveSettings();
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
  stage().classList.remove('panning');
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
  const tools: Record<string, Tool> = { h: 'pan', b: 'pencil', e: 'eraser', g: 'fill', i: 'picker' };
  if (tools[k]) { if (step === 'edit') setTool(tools[k]); }
  else if (k === '+' || k === '=') zoomStep(1, null);
  else if (k === '-') zoomStep(-1, null);
  else if (k === '0') { fittedDims = ''; draw(); }
  else if (e.key === ' ' && stage().matches(':hover')) {
    e.preventDefault();
    if (!spaceHeld) { spaceHeld = true; stage().classList.add('pan'); draw(); }
  }
}

export function initEditor(): void {
  new ResizeObserver(sizeEditor).observe(stage());
  onSource(() => { fittedDims = ''; viewTouched = false; });
  onResult(() => { draw(); updateEditUI(); });

  const c = canvas();
  c.addEventListener('pointerdown', onPointerDown);
  c.addEventListener('pointermove', onPointerMove);
  c.addEventListener('pointerup', endGesture);
  c.addEventListener('pointercancel', endGesture);
  c.addEventListener('pointerleave', () => { hover = null; draw(); });
  c.addEventListener('wheel', (e) => {
    if (!app.result) return;
    e.preventDefault();
    const r = c.getBoundingClientRect();
    zoomStep(e.deltaY < 0 ? 1 : -1, [e.clientX - r.left, e.clientY - r.top]);
  }, { passive: false });

  document.querySelectorAll<HTMLElement>('.tool').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.tool as Tool;
    // the background picker is a lone toggle in its step
    setTool(t === 'bg' && tool === 'bg' ? 'pan' : t);
  }));
  field('drawColor').addEventListener('input', () => {
    setDrawColor(hexToRgb(field('drawColor').value));
    if (tool === 'pan' || tool === 'picker' || tool === 'bg') setTool('pencil');
  });
  $('zoomInBtn').addEventListener('click', () => zoomStep(1, null));
  $('zoomOutBtn').addEventListener('click', () => zoomStep(-1, null));
  $('fitBtn').addEventListener('click', () => { fittedDims = ''; draw(); });
  field('pixGrid').addEventListener('change', draw);
  field('compare').addEventListener('change', () => { field('split').disabled = !isChecked('compare'); draw(); });
  field('split').addEventListener('input', draw);
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  $('clearEdits').addEventListener('click', () => { if (!app.edits.size) return; pushUndo(); app.edits = new Map(); commitEdits(); });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', (e) => {
    if (e.key === ' ' && spaceHeld && currentMode() === 'pixelize') { spaceHeld = false; stage().classList.toggle('pan', tool === 'pan'); draw(); }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);

  // drawing tools belong to "Touch up" and the background picker to its step
  onStep((s) => {
    const allowed = tool === 'pan' || (s === 'edit' && tool !== 'bg') || (s === 'clean' && tool === 'bg');
    if (!allowed) setTool('pan');
  });

  setTool('pan');
  setDrawColor(drawColor);
}
