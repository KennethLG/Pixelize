// Keyboard shortcuts of the sprite editor.

import { deleteSelection, setBrush, swapColors } from './actions';
import { fitView, nudge, selectAll, setSpaceHeld, zoomStep } from './canvas';
import { togglePlay } from './components/Timeline';
import { copy, cut } from './io';
import { commitFloating, deselect, redo, setFrame, setTool, sp, undo, type Tool } from './state';

const KEYS: Record<string, Tool> = { h: 'pan', b: 'pencil', e: 'eraser', l: 'line', g: 'bucket', i: 'picker', u: 'rect', o: 'ellipse', m: 'select', w: 'wand', v: 'move', c: 'canvas' };
const ARROWS: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };

function onKeyDown(e: KeyboardEvent): void {
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
  else if (e.key === ' ' && document.getElementById('spStage')?.matches(':hover')) { e.preventDefault(); setSpaceHeld(true); }
  else if (k === 'p' && !e.repeat) togglePlay();
}

export function initShortcuts(isActive: () => boolean): void {
  document.addEventListener('keydown', (e) => { if (isActive()) onKeyDown(e); });
  document.addEventListener('keyup', (e) => { if (e.key === ' ') setSpaceHeld(false); });
}
