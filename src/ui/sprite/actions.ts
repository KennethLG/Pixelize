// Editor actions shared by the components and the keyboard shortcuts.

import { flip, scaleNearest } from '../../core/bitmap';
import type { RGBA } from '../../core/color';
import { cel, emit, lift, pushCel, setColor, sp } from './state';

export function setBrush(n: number): void {
  sp.brush = Math.max(1, Math.min(32, Math.round(n) || 1));
  emit('tool');
}

/** Changes a tool option and lets the components know. */
export function setOption<K extends 'rectFilled' | 'contiguous' | 'bucketMode' | 'replaceAllFrames' | 'canvasMode'>(key: K, value: (typeof sp)[K]): void {
  sp[key] = value;
  emit('tool');
}

/** Scales or flips the selection (lifting it first). */
export function transform(fn: (w: number, h: number) => [number, number] | 'flipH' | 'flipV'): void {
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
