// The sprite editor: wires the tool bar, tool options, selection buttons and
// keyboard shortcuts, and starts the panels.

import { flip, scaleNearest } from '../../core/bitmap';
import { $, field } from '../dom';
import { draw, fitView, initCanvas, nudge, selectAll, selectionBox, setSpaceHeld, zoomStep } from './canvas';
import { initColors, swapColors } from './colors';
import { copy, cut, initIo, loadFrames } from './io';
import { initLayers } from './layers';
import {
  canRedo, canUndo, cel, commitFloating, deselect, emit, lift, on, pushCel, redo, setFrame, setTool, sp, undo, type Tool,
} from './state';
import { initTimeline, togglePlay } from './timeline';

export { loadFrames };

const KEYS: Record<string, Tool> = { h: 'pan', b: 'pencil', e: 'eraser', g: 'bucket', i: 'picker', u: 'rect', o: 'ellipse', m: 'select', w: 'wand', v: 'move', c: 'canvas' };

function setBrush(n: number): void {
  sp.brush = Math.max(1, Math.min(32, Math.round(n) || 1));
  field('spBrush').value = String(sp.brush);
  field('spBrushR').value = String(sp.brush);
  emit('tool');
}

function syncTool(): void {
  document.querySelectorAll<HTMLElement>('[data-sptool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.sptool === sp.tool)));
  document.querySelectorAll<HTMLElement>('[data-for]').forEach((el) => { el.hidden = !el.dataset.for!.split(' ').includes(sp.tool); });
}

function syncSelectionUI(): void {
  const has = !!(sp.mask || sp.floating);
  $('spSelActions').hidden = !has;
  const b = selectionBox();
  $('spSelInfo').textContent = b ? `${b.w}×${b.h}${sp.floating ? ' · moving' : ''}` : '';
}

function syncHistory(): void {
  field('spUndo').disabled = !canUndo();
  field('spRedo').disabled = !canRedo();
}

/** Scales or flips the selection (lifting it first). */
function transform(fn: (w: number, h: number) => [number, number] | 'flipH' | 'flipV'): void {
  const f = lift();
  if (!f) return;
  const r = fn(f.w, f.h);
  if (r === 'flipH' || r === 'flipV') {
    f.src = flip(f.w === f.src.w && f.h === f.src.h ? f.src : scaleNearest(f.src, f.w, f.h), r === 'flipH');
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

function deleteSelection(): void {
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

function onKeyDown(e: KeyboardEvent, isActive: () => boolean): void {
  if (!isActive()) return;
  const t = e.target as HTMLElement;
  if (t.matches?.('input[type="text"], input[type="number"], textarea')) return;
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod) {
    const acts: Record<string, () => void> = {
      z: () => (e.shiftKey ? redo() : undo()), y: redo, c: copy, x: cut, a: selectAll, d: deselect,
    };
    // Ctrl+V is left to the paste event, which can read the system clipboard
    if (acts[k]) { e.preventDefault(); acts[k](); }
    return;
  }
  if (e.altKey) return;
  const ARROWS: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
  if (ARROWS[k] && !t.matches?.('input, select, .sp-frame, .sp-layer')) {
    if (!sp.mask && !sp.floating) return;
    e.preventDefault();
    const n = e.shiftKey ? 8 : 1;
    nudge(ARROWS[k][0] * n, ARROWS[k][1] * n);
    return;
  }
  if (t.matches?.('input, select')) return;
  if (KEYS[k]) { setTool(KEYS[k]); return; }
  if (k === 'x') swapColors();
  else if (k === '[') setBrush(sp.brush - 1);
  else if (k === ']') setBrush(sp.brush + 1);
  else if (k === '+' || k === '=') zoomStep(1);
  else if (k === '-') zoomStep(-1);
  else if (k === '0') fitView();
  else if (k === ',') setFrame(sp.frame - 1);
  else if (k === '.') setFrame(sp.frame + 1);
  else if (k === 'enter') { if (sp.floating) { e.preventDefault(); commitFloating(); } }
  else if (k === 'escape') deselect();
  else if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSelection(); }
  else if (e.key === ' ' && $('spStage').matches(':hover')) { e.preventDefault(); setSpaceHeld(true); }
  else if (k === 'p' && !e.repeat) togglePlay();
}

export function initSprite(isActive: () => boolean): void {
  initCanvas();
  initColors();
  initLayers();
  initTimeline();
  initIo(isActive);

  document.querySelectorAll<HTMLElement>('[data-sptool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.sptool as Tool)));
  field('spBrush').addEventListener('input', () => setBrush(Number(field('spBrush').value)));
  field('spBrushR').addEventListener('input', () => setBrush(Number(field('spBrushR').value)));
  document.querySelectorAll<HTMLInputElement>('input[name="spRectMode"]').forEach((r) => r.addEventListener('change', () => { sp.rectFilled = r.value === 'filled' && r.checked; }));
  field('spContig').addEventListener('change', () => { sp.contiguous = field('spContig').checked; });
  const syncBucket = () => { $('spAllFramesRow').hidden = sp.bucketMode !== 'replace'; };
  document.querySelectorAll<HTMLInputElement>('input[name="spBucketMode"]').forEach((r) => r.addEventListener('change', () => {
    if (r.checked) sp.bucketMode = r.value as typeof sp.bucketMode;
    syncBucket();
  }));
  field('spAllFrames').addEventListener('change', () => { sp.replaceAllFrames = field('spAllFrames').checked; });
  syncBucket();
  document.querySelectorAll<HTMLInputElement>('input[name="spCanvasMode"]').forEach((r) => r.addEventListener('change', () => {
    if (r.checked) sp.canvasMode = r.value as typeof sp.canvasMode;
  }));

  $('spUndo').addEventListener('click', undo);
  $('spRedo').addEventListener('click', redo);
  $('spSelAll').addEventListener('click', selectAll);
  $('spDeselect').addEventListener('click', deselect);
  $('spSelDelete').addEventListener('click', deleteSelection);
  $('spCopy').addEventListener('click', copy);
  $('spCut').addEventListener('click', cut);
  $('spFlipH').addEventListener('click', () => transform(() => 'flipH'));
  $('spFlipV').addEventListener('click', () => transform(() => 'flipV'));
  $('spGrow').addEventListener('click', () => transform((w, h) => [w * 2, h * 2]));
  $('spShrink').addEventListener('click', () => transform((w, h) => [w / 2, h / 2]));
  $('spApply').addEventListener('click', commitFloating);

  document.addEventListener('keydown', (e) => onKeyDown(e, isActive));
  document.addEventListener('keyup', (e) => { if (e.key === ' ') setSpaceHeld(false); });

  on('tool', syncTool);
  on('selection', syncSelectionUI);
  on('pixels', syncSelectionUI);
  for (const ev of ['pixels', 'structure', 'selection'] as const) on(ev, syncHistory);
  syncTool();
  syncSelectionUI();
  syncHistory();
  setBrush(sp.brush);
}

/** The editor state, for checks from the browser console. */
export const spriteState = () => sp;

/** Call when the sprite editor becomes visible: the canvas only gets its size then. */
export const showSprite = () => requestAnimationFrame(draw);
