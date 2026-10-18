// Frames: the timeline of thumbnails (click to edit, drag to reorder), frame
// buttons and durations, and the animated preview.

import { DEFAULT_DURATION, addFrame, composite, duplicateFrame, moveFrame, removeFrame } from '../../core/sprite';
import { $, field, reducedMotion } from '../dom';
import { emit, on, pushDoc, setFrame, sp } from './state';

let dragFrom: number | null = null;
let playing = false;
let playIndex = 0, playLast = 0;
const thumbs: HTMLCanvasElement[] = [];

function paint(c: HTMLCanvasElement, fi: number): void {
  const { w, h } = sp.doc;
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  c.getContext('2d')!.putImageData(new ImageData(composite(sp.doc, fi), w, h), 0, 0);
}

function card(fi: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'frame sp-frame' + (fi === sp.frame ? ' sel' : '');
  el.draggable = true;
  el.tabIndex = 0;
  el.title = `Frame ${fi + 1} · ${sp.doc.frames[fi].duration} ms`;
  const c = document.createElement('canvas');
  paint(c, fi);
  thumbs[fi] = c;
  const n = document.createElement('span');
  n.textContent = String(fi + 1);
  el.append(c, n);
  el.addEventListener('click', () => setFrame(fi));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFrame(fi); }
  });
  el.addEventListener('dragstart', (e) => { dragFrom = fi; el.classList.add('dragging'); e.dataTransfer!.effectAllowed = 'move'; });
  el.addEventListener('dragend', () => { dragFrom = null; clearMarks(); });
  el.addEventListener('dragover', (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    clearMarks();
    el.classList.add(before(e, el) ? 'drop-before' : 'drop-after');
  });
  el.addEventListener('drop', (e) => {
    if (dragFrom === null) return;
    e.preventDefault();
    let to = before(e, el) ? fi : fi + 1;
    if (dragFrom < to) to--;
    const from = dragFrom;
    dragFrom = null;
    clearMarks();
    if (from === to) return;
    pushDoc();
    moveFrame(sp.doc, from, to);
    sp.frame = to;
    emit('structure', 'cursor', 'pixels');
  });
  return el;
}

const before = (e: DragEvent, el: HTMLElement) => { const r = el.getBoundingClientRect(); return e.clientX < r.left + r.width / 2; };
const clearMarks = () => document.querySelectorAll('.sp-frame').forEach((f) => f.classList.remove('drop-before', 'drop-after', 'dragging'));

function render(): void {
  thumbs.length = 0;
  $('spFrames').replaceChildren(...sp.doc.frames.map((_, i) => card(i)));
  updateInfo();
}

/** Scrolls the strip (never the page) so the current frame shows. */
function revealCurrent(): void {
  const box = $('spFrames'), el = box.querySelector<HTMLElement>('.sel');
  if (!el) return;
  const l = el.offsetLeft;
  if (l < box.scrollLeft) box.scrollLeft = l;
  else if (l + el.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = l + el.offsetWidth - box.clientWidth;
}

function updateInfo(): void {
  const n = sp.doc.frames.length;
  $('spFrameInfo').textContent = `Frame ${sp.frame + 1} of ${n}`;
  field('spDuration').value = String(sp.doc.frames[sp.frame].duration);
  field('spFrameDel').disabled = n < 2;
  field('spFrameLeft').disabled = sp.frame < 1;
  field('spFrameRight').disabled = sp.frame >= n - 1;
  document.querySelectorAll('.sp-frame').forEach((el, i) => el.classList.toggle('sel', i === sp.frame));
  revealCurrent();
}

/** Repaints the current frame's thumbnail after a pixel change. */
function refreshThumb(): void {
  const c = thumbs[sp.frame];
  if (c) paint(c, sp.frame);
  if (!playing) drawPreview(sp.frame);
}

function drawPreview(fi: number): void {
  const c = $<HTMLCanvasElement>('spPreview');
  paint(c, Math.min(fi, sp.doc.frames.length - 1));
}

function setPlaying(v: boolean): void {
  playing = v && sp.doc.frames.length > 1;
  $('spPlay').textContent = playing ? 'Pause' : 'Play';
  if (playing) { playIndex = sp.frame; playLast = performance.now(); requestAnimationFrame(tick); }
  else drawPreview(sp.frame);
}

function tick(t: number): void {
  if (!playing) return;
  const frames = sp.doc.frames;
  if (playIndex >= frames.length) playIndex = 0;
  if (t - playLast >= frames[playIndex].duration) {
    playLast = t;
    playIndex = (playIndex + 1) % frames.length;
    drawPreview(playIndex);
  }
  requestAnimationFrame(tick);
}

function newFrame(copy: boolean): void {
  pushDoc();
  if (copy) duplicateFrame(sp.doc, sp.frame);
  else addFrame(sp.doc, sp.frame + 1);
  sp.frame++;
  emit('structure', 'cursor', 'pixels');
}

function shift(dir: 1 | -1): void {
  const to = sp.frame + dir;
  if (to < 0 || to >= sp.doc.frames.length) return;
  pushDoc();
  moveFrame(sp.doc, sp.frame, to);
  sp.frame = to;
  emit('structure', 'cursor', 'pixels');
}

export function initTimeline(): void {
  $('spFrameAdd').addEventListener('click', () => newFrame(false));
  $('spFrameDup').addEventListener('click', () => newFrame(true));
  $('spFrameDel').addEventListener('click', () => {
    pushDoc();
    if (removeFrame(sp.doc, sp.frame)) { sp.frame = Math.min(sp.frame, sp.doc.frames.length - 1); emit('structure', 'cursor', 'pixels'); }
  });
  $('spFrameLeft').addEventListener('click', () => shift(-1));
  $('spFrameRight').addEventListener('click', () => shift(1));
  field('spDuration').addEventListener('change', () => {
    const v = Math.max(10, Math.min(10000, Math.round(Number(field('spDuration').value) || DEFAULT_DURATION)));
    pushDoc();
    sp.doc.frames[sp.frame].duration = v;
    emit('structure');
  });
  $('spDurationAll').addEventListener('click', () => {
    const v = sp.doc.frames[sp.frame].duration;
    pushDoc();
    for (const f of sp.doc.frames) f.duration = v;
    emit('structure');
  });
  $('spPlay').addEventListener('click', () => setPlaying(!playing));
  field('spOnion').addEventListener('change', () => { sp.onion = field('spOnion').checked; emit('pixels'); });

  on('structure', render);
  on('cursor', () => { updateInfo(); if (!playing) drawPreview(sp.frame); });
  on('pixels', refreshThumb);
  render();
  setPlaying(!reducedMotion && sp.doc.frames.length > 1);
}

export const isPlaying = () => playing;
export const togglePlay = () => setPlaying(!playing);
