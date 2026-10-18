// Animation actions of the sprite editor: playback (one loop for every
// preview), quick flip, cels, moving a whole frame, frame ranges, tags and
// mirrored copies. Components and shortcuts call these.

import { playbackSequence } from '../../core/frames';
import { addFrame, addTag, duplicateFrame, mirrorFrames, tagAt, translateBitmap, type Tag } from '../../core/sprite';
import type { Bitmap } from '../../core/bitmap';
import { shiftPoses, syncParts } from '../../core/parts';
import { setStatus } from '../dom';
import { cel, commitFloating, emit, pushCel, pushDoc, setFrame, sp } from './state';

// ---------- frame range ----------

/** The selected frames: the range picked with Shift+click, or just the current frame. */
export const selectedFrames = (): [number, number] => sp.range ?? [sp.frame, sp.frame];

/** Click on a frame: Shift extends a range from the current frame, a plain click clears it. */
export function pickFrame(i: number, extend: boolean): void {
  if (extend) {
    const [a, b] = sp.range ?? [sp.frame, sp.frame];
    const anchor = sp.frame >= a && sp.frame <= b ? sp.frame : a;
    sp.range = [Math.min(anchor, i), Math.max(anchor, i)];
    emit('cursor');
    return;
  }
  sp.range = null;
  setFrame(i);
  emit('cursor');
}

// ---------- playback ----------

let raf = 0;

/** The frames the preview plays: the current frame's tag (in its direction), or all of them. */
export function playSequence(): number[] {
  const tag = tagAt(sp.doc, sp.frame);
  const all = sp.doc.frames.map((_, i) => i);
  const frames = tag ? all.slice(tag.from, tag.to + 1) : all;
  return playbackSequence(frames, tag?.dir ?? 'forward', false);
}

export function setPlaying(on: boolean): void {
  cancelAnimationFrame(raf);
  sp.playing = on && sp.doc.frames.length > 1;
  sp.playFrame = sp.frame;
  emit('playback', 'playframe');
  if (!sp.playing) return;
  let seq = playSequence(), k = Math.max(0, seq.indexOf(sp.frame)), last = performance.now();
  const tick = (t: number) => {
    if (!sp.playing) return;
    const fi = seq[k % seq.length];
    if (fi === undefined || fi >= sp.doc.frames.length) { seq = playSequence(); k = 0; }
    else if (t - last >= sp.doc.frames[fi].duration) {
      last = t;
      k = (k + 1) % seq.length;
      if (k === 0) seq = playSequence();   // the frames or the tag may have changed
      sp.playFrame = seq[k] ?? 0;
      emit('playframe');
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}

export const togglePlay = () => setPlaying(!sp.playing);

// ---------- quick flip ----------

/** While the key is held, the canvas shows the previous frame (the last one from the first). */
export function startPeek(): void {
  if (sp.doc.frames.length < 2 || sp.peek !== null) return;
  sp.peek = (sp.frame - 1 + sp.doc.frames.length) % sp.doc.frames.length;
  emit('view');
}
export function endPeek(): void {
  if (sp.peek === null) return;
  sp.peek = null;
  emit('view');
}

// ---------- frames and cels ----------

export function newFrame(copy: boolean): void {
  pushDoc();
  if (copy) duplicateFrame(sp.doc, sp.frame);
  else addFrame(sp.doc, sp.frame + 1);
  sp.frame++;
  sp.range = null;
  emit('structure', 'cursor', 'pixels');
}

let celClip: Bitmap | null = null;

export function copyCel(): void {
  commitFloating();
  const c = cel();
  celClip = { w: c.w, h: c.h, px: c.px.slice() };
  setStatus(`Copied the cel of ${sp.doc.layers[sp.layer].name}, frame ${sp.frame + 1}`);
}

/** Pastes the copied cel into the current layer of the selected frames. */
export function pasteCel(): void {
  if (!celClip) { setStatus('Copy a cel first.', true); return; }
  if (celClip.w !== sp.doc.w || celClip.h !== sp.doc.h) { setStatus('The copied cel is from another canvas size.', true); return; }
  commitFloating();
  const [a, b] = selectedFrames();
  if (a === b) pushCel();
  else pushDoc();
  for (let f = a; f <= b; f++) sp.doc.frames[f].cels[sp.layer].px.set(celClip.px);
  emit('pixels', 'structure');
  setStatus(a === b ? 'Pasted the cel' : `Pasted the cel into frames ${a + 1}–${b + 1}`);
}

/** Moves every layer of the current frame by dx, dy (Alt+arrows). */
export function shiftFrame(dx: number, dy: number): void {
  commitFloating();
  pushDoc();
  syncParts(sp.doc);
  const f = sp.doc.frames[sp.frame];
  f.cels = f.cels.map((c) => translateBitmap(c, dx, dy));
  // posed parts move by their pose, so the next redraw keeps the shift
  shiftPoses(sp.doc, sp.frame, dx, dy);
  emit('pixels', 'structure');
}

// ---------- tags ----------

export function tagSelection(): void {
  const [a, b] = selectedFrames();
  pushDoc();
  const t = addTag(sp.doc, a, b);
  sp.editingTag = sp.doc.tags.indexOf(t);
  emit('structure');
}

export function updateTag(i: number, patch: Partial<Tag>): void {
  pushDoc();
  Object.assign(sp.doc.tags[i], patch);
  emit('structure');
}

export function removeTag(i: number): void {
  pushDoc();
  sp.doc.tags.splice(i, 1);
  sp.editingTag = null;
  emit('structure');
}

/** Selects a tag's frames (and goes to its first one). */
export function selectTag(i: number): void {
  const t = sp.doc.tags[i];
  sp.editingTag = i;
  setFrame(t.from);
  sp.range = t.from === t.to ? null : [t.from, t.to];
  emit('cursor', 'structure');
}

/** Mirrored copies of the selected frames (or of the current frame's tag) at the end. */
export function mirrorSelection(): void {
  commitFloating();
  let [a, b] = selectedFrames();
  const tag = a === b ? tagAt(sp.doc, a) : null;
  if (tag) [a, b] = [tag.from, tag.to];
  pushDoc();
  const [from, to] = mirrorFrames(sp.doc, a, b);
  sp.frame = from;
  sp.range = from === to ? null : [from, to];
  emit('structure', 'cursor', 'pixels');
  setStatus(`Added ${to - from + 1} mirrored frame${to > from ? 's' : ''}`);
}
