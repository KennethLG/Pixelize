// The spritesheet workbench: splitting the result into frames, ordering and
// aligning them, playback, and the animation exports.

import { hex, rgbOfKey } from '../core/color';
import { findFrames, gridFrames, nextIndex, playbackSequence, type Direction, type Rect } from '../core/frames';
import { encodeGif } from '../export/gif';
import { makeZip, type ZipEntry } from '../export/zip';
import { app, onResult } from './app';
import { $, field, int, isChecked, onAll, radio, reducedMotion, setStatus, wait } from './dom';
import { syncSplit } from './controls';
import { baseName, canvasBlob, canvasBytes, saveBlob } from './downloads';

interface Anim {
  frames: Rect[];
  W: number;
  H: number;
  canvases: HTMLCanvasElement[];
}

let anim: Anim | null = null;
let framesKey = '';
let order: number[] = [];                       // frame indices in playback order
let excluded = new Set<number>();
let selected: number | null = null;             // frame shown while paused
let offsets = new Map<number, { dx: number; dy: number }>();
let holds = new Map<number, number>();          // how many ticks a frame lasts
let playing = !reducedMotion;
let animIndex = 0, animLast = 0;
let pingDir = 1;
let ended = false;                              // "stop at the end" reached the end

const activeFrames = () => (anim ? order.filter((i) => !excluded.has(i)) : []);
const holdOf = (i: number) => holds.get(i) || 1;
const playDir = () => radio<Direction>('dir');
const playOnce = () => radio('endMode') === 'once';

function buildAnim(): Anim {
  const res = app.result!, base = app.base!;
  const mode = radio('splitMode');
  const frames = mode === 'grid'
    ? gridFrames(res.width, res.height, Math.max(1, Math.min(res.width, int('cols') || 1)), Math.max(1, Math.min(res.height, int('rows') || 1)))
    : findFrames(res.pixels, res.width, res.height, new Set(base.bgKeys), Math.max(1, int('minGap') || 1));
  const key = `${mode}:${frames.length}`;
  if (key !== framesKey) {
    framesKey = key;
    order = frames.map((_, i) => i);
    excluded = new Set();
    offsets = new Map();
    holds = new Map();
    selected = null;
    animIndex = 0;
    ended = false;
    pingDir = 1;
  }
  const W = Math.max(0, ...frames.map((f) => f.w)), H = Math.max(0, ...frames.map((f) => f.h));
  const bottom = radio('align') === 'bottom';
  // keep the background color as padding when it was not removed
  const pad = !isChecked('removeBg') && base.bgKey !== null ? hex(rgbOfKey(base.bgKey)) : null;
  const canvases = frames.map((f, n) => {
    const part = new ImageData(f.w, f.h);
    for (let y = 0; y < f.h; y++) {
      const from = ((f.y + y) * res.width + f.x) * 4;
      part.data.set(res.pixels.subarray(from, from + f.w * 4), y * f.w * 4);
    }
    const tmp = document.createElement('canvas');
    tmp.width = f.w;
    tmp.height = f.h;
    tmp.getContext('2d')!.putImageData(part, 0, 0);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;
    if (pad) { ctx.fillStyle = pad; ctx.fillRect(0, 0, W, H); }
    const o = offsets.get(n) || { dx: 0, dy: 0 };
    const dx = (mode === 'grid' ? 0 : Math.floor((W - f.w) / 2)) + o.dx;
    const dy = (mode === 'grid' ? 0 : bottom ? H - f.h : Math.floor((H - f.h) / 2)) + o.dy;
    ctx.drawImage(tmp, dx, dy);
    return c;
  });
  return { frames, W, H, canvases };
}

// ---------- rendering ----------

function frameCard(i: number, pos: number): HTMLElement {
  const out = excluded.has(i);
  const card = document.createElement('div');
  card.className = 'frame' + (out ? ' off' : '') + (selected === i ? ' sel' : '');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', `Frame ${pos + 1}${out ? ', excluded from the animation' : ''}`);
  card.dataset.frame = String(i);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ftoggle';
  toggle.textContent = out ? '+' : '×';
  toggle.title = out ? 'Add back to the animation' : 'Take out of the animation';
  toggle.setAttribute('aria-label', toggle.title);
  toggle.addEventListener('click', (e) => { e.stopPropagation(); toggleExcluded(i); });
  const label = document.createElement('span');
  label.textContent = String(pos + 1);
  if (holdOf(i) > 1) { const h = document.createElement('em'); h.textContent = ` ${holdOf(i)}×`; label.append(h); }
  card.append(toggle, anim!.canvases[i], label);
  card.addEventListener('keydown', (e) => {
    if (e.target !== card) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectFrame(i); }
    else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); moveFrame(i, -1); }
    else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); moveFrame(i, 1); }
    else if (e.shiftKey && e.key.startsWith('Arrow')) {
      e.preventDefault();
      const d = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
      if (d) nudge(i, d[0], d[1]);
    }
  });
  return card;
}

export function renderAnim(): void {
  const on = isChecked('animOn');
  $('animBody').hidden = !on;
  if (!on || !app.result || !app.base) { anim = null; $('animInfo').textContent = ''; return; }
  // keep keyboard focus on the same frame across re-renders
  const focusFrame = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>('.frame')?.dataset.frame ?? null;
  anim = buildAnim();
  const n = anim.frames.length;
  $('animInfo').textContent = n ? `${activeFrames().length} of ${n} frames · ${anim.W}×${anim.H} px` : 'No frames';
  const cv = $<HTMLCanvasElement>('animCanvas');
  cv.width = Math.max(1, anim.W);
  cv.height = Math.max(1, anim.H);
  $('frames').replaceChildren(...order.map((i, pos) => frameCard(i, pos)));
  if (focusFrame !== null) $('frames').querySelector<HTMLElement>(`.frame[data-frame="${focusFrame}"]`)?.focus();
  updateSelectionUI();
  drawAnimFrame();
}

function updateSelectionUI(): void {
  const pos = selected === null ? -1 : order.indexOf(selected);
  const has = pos >= 0;
  field('moveL').disabled = pos <= 0;
  field('moveR').disabled = !has || pos >= order.length - 1;
  field('selToggle').disabled = !has;
  $('selToggle').textContent = has && excluded.has(selected!) ? 'Include' : 'Exclude';
  for (const id of ['holdMinus', 'holdPlus', 'nudgeL', 'nudgeU', 'nudgeD', 'nudgeR', 'nudgeReset']) field(id).disabled = !has;
  $('holdVal').textContent = has ? `${holdOf(selected!)}×` : '–';
  const o = has ? offsets.get(selected!) || { dx: 0, dy: 0 } : null;
  $('nudgeVal').textContent = o ? `${o.dx}, ${o.dy}` : '–';
}

function currentFrame(): number | null {
  const act = activeFrames();
  if (!playing && selected !== null) return selected;
  return act.length ? act[animIndex % act.length] : null;
}

function drawAnimFrame(): void {
  const cv = $<HTMLCanvasElement>('animCanvas'), ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const idx = currentFrame();
  for (const el of $('frames').children) (el as HTMLElement).classList.toggle('on', idx !== null && (el as HTMLElement).dataset.frame === String(idx));
  if (!anim || idx === null) { $('frameInfo').textContent = anim?.frames.length ? 'All frames are excluded' : ''; return; }
  if (isChecked('onion')) {
    const act = activeFrames(), p = act.indexOf(idx);
    if (act.length > 1 && p >= 0) {
      const prev = act[(p - 1 + act.length) % act.length], next = act[(p + 1) % act.length];
      ctx.globalAlpha = 0.35;
      ctx.drawImage(anim.canvases[prev], 0, 0);
      if (next !== prev) { ctx.globalAlpha = 0.18; ctx.drawImage(anim.canvases[next], 0, 0); }
      ctx.globalAlpha = 1;
    }
  }
  ctx.drawImage(anim.canvases[idx], 0, 0);
  $('frameInfo').textContent = `Frame ${order.indexOf(idx) + 1} of ${order.length}` + (excluded.has(idx) ? ' · excluded' : '');
}

// ---------- editing frames ----------

function selectFrame(i: number): void { selected = i; setPlaying(false); renderAnim(); }
function toggleExcluded(i: number): void { if (excluded.has(i)) excluded.delete(i); else excluded.add(i); renderAnim(); }

function moveFrame(i: number, dir: number): void {
  const from = order.indexOf(i), to = from + dir;
  if (from < 0 || to < 0 || to >= order.length) return;
  order.splice(from, 1);
  order.splice(to, 0, i);
  renderAnim();
}

// Moves frame i so it lands before the card currently at position `target`.
function reorder(i: number, target: number): void {
  const from = order.indexOf(i);
  order.splice(from, 1);
  if (target > from) target--;
  order.splice(target, 0, i);
  renderAnim();
}

function nudge(i: number, dx: number, dy: number): void {
  const o = offsets.get(i) || { dx: 0, dy: 0 };
  offsets.set(i, { dx: o.dx + dx, dy: o.dy + dy });
  selected = i;
  setPlaying(false);
  renderAnim();
}

function setHold(i: number, v: number): void {
  holds.set(i, Math.max(1, Math.min(16, v)));
  renderAnim();
}

// ---------- playback ----------

function updatePlayLabel(): void {
  $('playBtn').textContent = playing ? 'Pause' : ended ? 'Replay' : 'Play';
}

function startIndex(): number {
  pingDir = 1;
  return playDir() === 'reverse' ? Math.max(0, activeFrames().length - 1) : 0;
}

function setPlaying(value: boolean): void {
  playing = value;
  if (playing && ended) { animIndex = startIndex(); ended = false; animLast = 0; }
  if (playing && selected !== null) {
    // resume from the frame being viewed
    const act = activeFrames();
    if (act.includes(selected)) animIndex = act.indexOf(selected);
    selected = null;
    if (anim) renderAnim();
  }
  updatePlayLabel();
}

function tick(t: number): void {
  const fps = int('fps') || 8;
  const cur = currentFrame();
  if (anim && playing && t - animLast >= (1000 / fps) * (cur === null ? 1 : holdOf(cur))) {
    animLast = t;
    const n = activeFrames().length;
    const r = nextIndex(animIndex % Math.max(1, n), n, playDir(), playOnce(), pingDir);
    pingDir = r.pingDir;
    if (r.next === null) { ended = true; setPlaying(false); }
    else animIndex = r.next;
    drawAnimFrame();
  }
  requestAnimationFrame(tick);
}

// ---------- drag to reorder ----------

// Pointer events, so it also works on touch screens. A press that does not
// move is a click and selects the frame.
let drag: { card: HTMLElement; frame: number; x: number; pointerId: number; active: boolean; target: number | null } | null = null;

function dropTarget(x: number): number {
  for (const c of [...$('frames').children] as HTMLElement[]) {
    if (c === drag!.card) continue;
    const r = c.getBoundingClientRect();
    if (x < r.left + r.width / 2) return order.indexOf(Number(c.dataset.frame));
  }
  return order.length;
}

function clearDropMarks(): void {
  for (const c of $('frames').children) c.classList.remove('drop-before', 'drop-after', 'dragging');
}

function initDrag(): void {
  const strip = $('frames');
  strip.addEventListener('pointerdown', (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>('.frame');
    if (!card || (e.target as HTMLElement).closest('.ftoggle') || e.button !== 0) return;
    drag = { card, frame: Number(card.dataset.frame), x: e.clientX, pointerId: e.pointerId, active: false, target: null };
  });
  strip.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.x) < 6) return;
      drag.active = true;
      strip.setPointerCapture(e.pointerId);
    }
    e.preventDefault();
    clearDropMarks();
    drag.card.classList.add('dragging');
    drag.target = dropTarget(e.clientX);
    const at = strip.querySelector(`.frame[data-frame="${order[drag.target]}"]`);
    if (drag.target < order.length && at && at !== drag.card) at.classList.add('drop-before');
    else if (drag.target >= order.length) strip.lastElementChild?.classList.add('drop-after');
    // scroll the strip when dragging near its edges
    const r = strip.getBoundingClientRect();
    if (e.clientX < r.left + 30) strip.scrollLeft -= 8;
    else if (e.clientX > r.right - 30) strip.scrollLeft += 8;
  });
  const end = (e: PointerEvent, cancelled: boolean) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    clearDropMarks();
    if (cancelled) return;
    if (d.active) { if (d.target !== null) reorder(d.frame, d.target); }
    else selectFrame(d.frame);
  };
  strip.addEventListener('pointerup', (e) => end(e, false));
  strip.addEventListener('pointercancel', (e) => end(e, true));
}

// ---------- exports ----------

// Active frames in order, each repeated by its duration when asked.
function exportFrames(): number[] {
  const act = activeFrames();
  return isChecked('repeatHolds') ? act.flatMap((i) => Array<number>(holdOf(i)).fill(i)) : act;
}

function noFrames(): boolean {
  if (anim && activeFrames().length) return false;
  setStatus('There are no frames to export.', true);
  return true;
}

async function downloadStrip(): Promise<void> {
  if (noFrames()) return;
  const seq = exportFrames(), a = anim!;
  const c = document.createElement('canvas');
  c.width = a.W * seq.length;
  c.height = a.H;
  const ctx = c.getContext('2d')!;
  seq.forEach((idx, k) => ctx.drawImage(a.canvases[idx], k * a.W, 0));
  await saveBlob(await canvasBlob(c), `${baseName()}_strip${seq.length}.png`);
}

async function downloadSheet(): Promise<void> {
  if (noFrames()) return;
  const seq = exportFrames(), a = anim!;
  const cols = Math.max(1, Math.min(seq.length, int('sheetCols') || Math.ceil(Math.sqrt(seq.length))));
  const rows = Math.ceil(seq.length / cols);
  const pad = Math.max(0, int('sheetPad') || 0);
  const c = document.createElement('canvas');
  c.width = cols * a.W + (cols + 1) * pad;
  c.height = rows * a.H + (rows + 1) * pad;
  const ctx = c.getContext('2d')!;
  seq.forEach((idx, k) => ctx.drawImage(a.canvases[idx], pad + (k % cols) * (a.W + pad), pad + Math.floor(k / cols) * (a.H + pad)));
  await saveBlob(await canvasBlob(c), `${baseName()}_sheet_${cols}x${rows}.png`);
}

async function downloadFramesZip(): Promise<void> {
  if (noFrames()) return;
  const act = activeFrames();
  const files: ZipEntry[] = [];
  for (let k = 0; k < act.length; k++) {
    files.push({ name: `${baseName()}_${String(k).padStart(2, '0')}.png`, data: await canvasBytes(anim!.canvases[act[k]]) });
  }
  await saveBlob(new Blob([makeZip(files)], { type: 'application/zip' }), `${baseName()}_frames.zip`);
}

async function downloadGif(): Promise<void> {
  if (noFrames()) return;
  const a = anim!;
  const seq = playbackSequence(activeFrames(), playDir(), playOnce());
  const scale = Math.max(1, Math.min(32, int('gifScale') || 1));
  const fps = int('fps') || 8;
  setStatus('Encoding GIF…');
  await wait(20);
  const frames = seq.map((i) => a.canvases[i].getContext('2d')!.getImageData(0, 0, a.W, a.H).data);
  const bytes = encodeGif(frames, a.W, a.H, scale, seq.map((i) => (100 / fps) * holdOf(i)), !playOnce());
  await saveBlob(new Blob([bytes], { type: 'image/gif' }), `${baseName()}.gif`);
}

// ---------- wiring ----------

export function initAnim(): void {
  onResult(renderAnim);
  initDrag();
  field('animOn').addEventListener('change', renderAnim);
  onAll('input[name="splitMode"]', 'change', () => { syncSplit(); renderAnim(); });
  onAll('input[name="align"]', 'change', renderAnim);
  for (const id of ['cols', 'rows', 'minGap']) field(id).addEventListener('input', renderAnim);
  field('fps').addEventListener('input', () => { $('fpsOut').textContent = field('fps').value; });
  field('onion').addEventListener('change', drawAnimFrame);
  $('playBtn').addEventListener('click', () => setPlaying(!playing));
  onAll('input[name="dir"], input[name="endMode"]', 'change', () => {
    // a finished "once" run can play again after changing the options
    if (ended) { ended = false; animIndex = startIndex(); updatePlayLabel(); drawAnimFrame(); }
    if (playDir() !== 'pingpong') pingDir = 1;
  });
  const withSel = (fn: (i: number) => void) => () => { if (selected !== null) fn(selected); };
  $('moveL').addEventListener('click', withSel((i) => moveFrame(i, -1)));
  $('moveR').addEventListener('click', withSel((i) => moveFrame(i, 1)));
  $('selToggle').addEventListener('click', withSel(toggleExcluded));
  $('holdMinus').addEventListener('click', withSel((i) => setHold(i, holdOf(i) - 1)));
  $('holdPlus').addEventListener('click', withSel((i) => setHold(i, holdOf(i) + 1)));
  $('nudgeL').addEventListener('click', withSel((i) => nudge(i, -1, 0)));
  $('nudgeR').addEventListener('click', withSel((i) => nudge(i, 1, 0)));
  $('nudgeU').addEventListener('click', withSel((i) => nudge(i, 0, -1)));
  $('nudgeD').addEventListener('click', withSel((i) => nudge(i, 0, 1)));
  $('nudgeReset').addEventListener('click', withSel((i) => { offsets.delete(i); renderAnim(); }));
  $('dlStrip').addEventListener('click', downloadStrip);
  $('dlSheet').addEventListener('click', downloadSheet);
  $('dlZip').addEventListener('click', downloadFramesZip);
  $('dlGif').addEventListener('click', downloadGif);
  updatePlayLabel();
  requestAnimationFrame(tick);
}

/** Read-only view for checking the page from the console. */
export const animState = () => ({ anim, order: [...order], excluded: [...excluded], selected, playing, holds: [...holds], offsets: [...offsets] });
