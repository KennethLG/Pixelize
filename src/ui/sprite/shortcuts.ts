// Keyboard shortcuts of the sprite editor. The keys come from the registry in
// keys.ts (changeable in Options); the arrow keys are fixed: they move the
// selection (or, with the Move tool, the layer), and with Alt the whole frame.

import { actionFor, releases } from '../keys';
import { deleteSelection, setAngle, setBrush, swapColors } from './actions';
import { copyCel, endPeek, newFrame, pasteCel, shiftFrame, startPeek, togglePlay } from './animation';
import { fitView, nudge, selectAll, setSpaceHeld, zoomStep } from './canvas';
import { copy, cut } from './io';
import { carryFloating, commitFloating, deselect, emit, redo, setFrame, setTool, sp, undo, type Tool } from './state';

const TOOLS: Tool[] = ['pencil', 'eraser', 'line', 'shade', 'bucket', 'rect', 'ellipse', 'picker', 'select', 'lasso', 'wand', 'move', 'pose', 'canvas', 'pan'];

/** Turns the selection by a step, when there is one. */
function turnBy(deg: number): void {
  if (!sp.mask && !sp.floating) return;
  setAngle((sp.floating?.angle ?? 0) + deg);
}

const RUN: Record<string, () => void> = {
  swapColors,
  brushDown: () => setBrush(sp.brush - 1),
  brushUp: () => setBrush(sp.brush + 1),
  undo, redo, copy, cut, selectAll, deselect,
  delete: deleteSelection,
  apply: () => { if (sp.floating) commitFloating(); },
  turnLeft: () => turnBy(-15),
  turnRight: () => turnBy(15),
  zoomIn: () => zoomStep(1),
  zoomOut: () => zoomStep(-1),
  fit: fitView,
  onion: () => { sp.onion = !sp.onion; emit('view'); },
  prevFrame: () => setFrame(sp.frame - 1),
  nextFrame: () => setFrame(sp.frame + 1),
  play: togglePlay,
  newFrame: () => newFrame(false),
  dupFrame: () => newFrame(true),
  copyCel, pasteCel,
  carryNext: () => carryFloating(sp.frame + 1, true),
  carryPrev: () => carryFloating(sp.frame - 1, true),
  moveNext: () => carryFloating(sp.frame + 1, false),
  movePrev: () => carryFloating(sp.frame - 1, false),
};

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

function onKeyDown(e: KeyboardEvent): void {
  const t = e.target as HTMLElement;
  if (t.matches?.('input[type="text"], input[type="number"], textarea')) return;
  const d = ARROWS[e.key];
  if (d && !t.matches?.('input, select, .sp-frame, .sp-layer, .sp-cel')) {
    const n = e.shiftKey ? 8 : 1;
    if (e.altKey) { e.preventDefault(); shiftFrame(d[0] * n, d[1] * n); return; }
    if (!sp.mask && !sp.floating && sp.tool !== 'move') return;
    e.preventDefault();
    nudge(d[0] * n, d[1] * n);
    return;
  }
  const id = actionFor(e, 'sprite');
  if (!id) return;
  const name = id.slice('sprite.'.length);
  // plain keys do nothing while a form control has the focus; shortcuts with Ctrl still work
  if (t.matches?.('input, select') && !(e.ctrlKey || e.metaKey)) return;
  if (name === 'panHold') {
    if (!document.getElementById('spStage')?.matches(':hover')) return;
    e.preventDefault();
    setSpaceHeld(true);
    return;
  }
  if (name === 'peek') { e.preventDefault(); if (!e.repeat) startPeek(); return; }
  e.preventDefault();
  if ((TOOLS as string[]).includes(name)) { setTool(name as Tool); return; }
  if (e.repeat && (name === 'play' || name === 'newFrame' || name === 'dupFrame')) return;
  RUN[name]?.();
}

export function initShortcuts(isActive: () => boolean): void {
  document.addEventListener('keydown', (e) => { if (isActive()) onKeyDown(e); });
  document.addEventListener('keyup', (e) => {
    if (releases(e, 'sprite.panHold')) setSpaceHeld(false);
    if (releases(e, 'sprite.peek')) endPeek();
  });
  // a hold must not stick when the window loses the focus mid-press
  window.addEventListener('blur', () => { setSpaceHeld(false); endPeek(); });
}
