// The spritesheet workbench: splitting the result into frames, ordering and
// aligning them, playback, and the animation exports. The components read the
// state through the getters below and re-render on the 'anim' event; the
// preview and align canvases are drawn here, attached by their components.

import { hex, rgbOfKey } from '../core/color';
import { findFrames, gridFrames, nextIndex, playbackSequence, type Rect } from '../core/frames';
import { encodeGif } from '../export/gif';
import { makeZip, type ZipEntry } from '../export/zip';
import { app, pxBus } from './app';
import { cssVar, reducedMotion, setStatus, wait } from './dom';
import { baseName, canvasBlob, canvasBytes, saveBlob } from './downloads';
import { currentMode } from './mode';
import { settings } from './settings';
import { currentStep } from './steps';

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
let selected: number | null = null;             // frame in the align view (and shown while paused)
let offsets = new Map<number, { dx: number; dy: number }>();
let holds = new Map<number, number>();          // how many ticks a frame lasts
let playing = !reducedMotion;
let animIndex = 0, animLast = 0;
let pingDir = 1;
let ended = false;                              // "play once" reached the end

const activeFrames = () => (anim ? order.filter((i) => !excluded.has(i)) : []);
const holdOf = (i: number) => holds.get(i) || 1;
const offsetOf = (i: number) => offsets.get(i) || { dx: 0, dy: 0 };
const playOnce = () => settings.endMode === 'once';

// ---------- read-only state for the components ----------

export const animInfo = () => ({
  anim, order, excluded, selected, playing, ended,
  active: activeFrames(),
  holdOf, offsetOf,
  /** the frame on screen in the preview */
  current: currentFrame(),
});

// ---------- building the frames ----------

function buildAnim(): Anim {
  const res = app.result!, base = app.base!, s = settings;
  const mode = s.splitMode;
  const frames = mode === 'grid'
    ? gridFrames(res.width, res.height, Math.max(1, Math.min(res.width, Math.round(s.cols) || 1)), Math.max(1, Math.min(res.height, Math.round(s.rows) || 1)))
    : findFrames(res.pixels, res.width, res.height, new Set(base.bgKeys), Math.max(1, Math.round(s.minGap) || 1));
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
  const auto = mode !== 'grid';
  const fw = Math.max(0, ...frames.map((f) => f.w)), fh = Math.max(0, ...frames.map((f) => f.h));
  const bottom = s.align === 'bottom';
  // where each frame lands: centered (feet or middles lined up), then moved by its offset
  const place = frames.map((f, n) => ({
    x: (auto ? Math.floor((fw - f.w) / 2) : 0) + offsetOf(n).dx,
    y: (auto ? (bottom ? fh - f.h : Math.floor((fh - f.h) / 2)) : 0) + offsetOf(n).dy,
  }));
  // auto frames grow the canvas when moved instead of getting cut; grid cells keep their size
  let x0 = 0, y0 = 0, W = fw, H = fh;
  if (auto && frames.length) {
    x0 = Math.min(...place.map((p) => p.x));
    y0 = Math.min(...place.map((p) => p.y));
    W = Math.max(...place.map((p, n) => p.x + frames[n].w)) - x0;
    H = Math.max(...place.map((p, n) => p.y + frames[n].h)) - y0;
  }
  // keep the background color as padding when it was not removed
  const pad = !s.removeBg && base.bgKey !== null ? hex(rgbOfKey(base.bgKey)) : null;
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
    ctx.drawImage(tmp, place[n].x - x0, place[n].y - y0);
    return c;
  });
  return { frames, W, H, canvases };
}

/** Rebuilds the frames from the result and the settings, and redraws. */
export function renderAnim(): void {
  if (!settings.animOn || !app.result || !app.base) anim = null;
  else {
    anim = buildAnim();
    if (selected === null || !order.includes(selected)) selected = order[0] ?? null;
  }
  pxBus.emit('anim');
  drawPreview();
  drawAlign();
}

// ---------- preview ----------

let previewCanvas: HTMLCanvasElement | null = null;

function currentFrame(): number | null {
  const act = activeFrames();
  if (!playing && selected !== null) return selected;
  return act.length ? act[animIndex % act.length] : null;
}

function drawPreview(): void {
  const cv = previewCanvas;
  if (!cv) return;
  const W = Math.max(1, anim?.W || 1), H = Math.max(1, anim?.H || 1);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const idx = currentFrame();
  if (!anim || idx === null) return;
  if (settings.onion) {
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
}

export function attachPreview(cv: HTMLCanvasElement): () => void {
  previewCanvas = cv;
  drawPreview();
  return () => { if (previewCanvas === cv) previewCanvas = null; };
}

function startIndex(): number {
  pingDir = 1;
  return settings.dir === 'reverse' ? Math.max(0, activeFrames().length - 1) : 0;
}

export function setPlaying(value: boolean): void {
  playing = value;
  if (playing && ended) { animIndex = startIndex(); ended = false; animLast = 0; }
  else if (playing && selected !== null) {
    // resume from the frame being looked at
    const act = activeFrames();
    if (act.includes(selected)) animIndex = act.indexOf(selected);
  }
  pxBus.emit('anim');
  drawPreview();
}

function tick(t: number): void {
  const fps = settings.fps || 8;
  const cur = currentFrame();
  if (anim && playing && t - animLast >= (1000 / fps) * (cur === null ? 1 : holdOf(cur))) {
    animLast = t;
    const n = activeFrames().length;
    const r = nextIndex(animIndex % Math.max(1, n), n, settings.dir, playOnce(), pingDir);
    pingDir = r.pingDir;
    if (r.next === null) { ended = true; setPlaying(false); }
    else { animIndex = r.next; pxBus.emit('anim'); }
    drawPreview();
  }
  requestAnimationFrame(tick);
}

// ---------- align view ----------

// The selected frame blown up, over a faint reference frame, with center lines.
let alignCanvas: HTMLCanvasElement | null = null;
let alignView = { z: 1, ox: 0, oy: 0, dpr: 1 };

function ghostFrame(): number | null {
  if (selected === null) return null;
  const mode = settings.ghost;
  if (mode === 'first') return order[0] !== selected ? order[0] : null;
  if (mode === 'prev') {
    const p = order.indexOf(selected);
    return order.length > 1 ? order[(p - 1 + order.length) % order.length] : null;
  }
  return null;
}

export function drawAlign(): void {
  const cv = alignCanvas;
  if (!cv) return;
  const r = cv.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
  if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, cw, ch);
  if (!anim || selected === null || !anim.W || !anim.H) return;
  const { W, H } = anim;
  const z = Math.max(1, Math.floor(Math.min((cw - 24 * dpr) / W, (ch - 24 * dpr) / H)));
  const ox = Math.floor((cw - W * z) / 2), oy = Math.floor((ch - H * z) / 2);
  alignView = { z, ox, oy, dpr };
  ctx.imageSmoothingEnabled = false;

  const ghost = ghostFrame();
  if (ghost !== null) {
    ctx.globalAlpha = 0.3;
    ctx.drawImage(anim.canvases[ghost], ox, oy, W * z, H * z);
    ctx.globalAlpha = 1;
  }
  ctx.drawImage(anim.canvases[selected], ox, oy, W * z, H * z);

  if (z >= 6) {
    ctx.strokeStyle = cssVar('--pixgrid');
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x++) { ctx.moveTo(ox + x * z + 0.5, oy); ctx.lineTo(ox + x * z + 0.5, oy + H * z); }
    for (let y = 0; y <= H; y++) { ctx.moveTo(ox, oy + y * z + 0.5); ctx.lineTo(ox + W * z, oy + y * z + 0.5); }
    ctx.stroke();
  }
  // frame border and center lines
  ctx.strokeStyle = cssVar('--muted');
  ctx.lineWidth = Math.max(1, Math.round(dpr));
  ctx.strokeRect(ox - 0.5, oy - 0.5, W * z + 1, H * z + 1);
  ctx.strokeStyle = cssVar('--accent');
  ctx.setLineDash([5 * dpr, 4 * dpr]);
  ctx.beginPath();
  const cx = Math.round(ox + (W / 2) * z) + 0.5, cy = Math.round(oy + (H / 2) * z) + 0.5;
  ctx.moveTo(cx, oy - 8 * dpr); ctx.lineTo(cx, oy + H * z + 8 * dpr);
  ctx.moveTo(ox - 8 * dpr, cy); ctx.lineTo(ox + W * z + 8 * dpr, cy);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Connects the align canvas: dragging moves the selected frame. Returns the cleanup. */
export function attachAlign(stage: HTMLElement, cv: HTMLCanvasElement): () => void {
  alignCanvas = cv;
  let drag: { x: number; y: number; start: { dx: number; dy: number }; pointerId: number } | null = null;
  const ro = new ResizeObserver(drawAlign);
  ro.observe(stage);
  const down = (e: PointerEvent) => {
    if (selected === null || e.button !== 0) return;
    cv.setPointerCapture(e.pointerId);
    cv.focus();
    drag = { x: e.clientX, y: e.clientY, start: offsetOf(selected), pointerId: e.pointerId };
    stage.classList.add('dragging');
  };
  const move = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId || selected === null) return;
    const step = alignView.z / alignView.dpr; // screen px per art pixel
    const dx = drag.start.dx + Math.round((e.clientX - drag.x) / step);
    const dy = drag.start.dy + Math.round((e.clientY - drag.y) / step);
    const o = offsetOf(selected);
    if (dx !== o.dx || dy !== o.dy) setOffset(selected, dx, dy);
  };
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
    stage.classList.remove('dragging');
  };
  cv.addEventListener('pointerdown', down);
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', end);
  cv.addEventListener('pointercancel', end);
  const scheme = matchMedia('(prefers-color-scheme: dark)');
  scheme.addEventListener('change', drawAlign);
  drawAlign();
  return () => {
    ro.disconnect();
    scheme.removeEventListener('change', drawAlign);
    cv.removeEventListener('pointerdown', down);
    cv.removeEventListener('pointermove', move);
    cv.removeEventListener('pointerup', end);
    cv.removeEventListener('pointercancel', end);
    if (alignCanvas === cv) alignCanvas = null;
  };
}

// ---------- editing frames ----------

export function selectFrame(i: number): void { selected = i; renderAnim(); }
export function toggleExcluded(i: number): void { if (excluded.has(i)) excluded.delete(i); else excluded.add(i); renderAnim(); }

export function moveFrame(i: number, dir: number): void {
  const from = order.indexOf(i), to = from + dir;
  if (from < 0 || to < 0 || to >= order.length) return;
  order.splice(from, 1);
  order.splice(to, 0, i);
  renderAnim();
}

/** Moves frame i to position `to` in the playback order. */
export function reorder(i: number, to: number): void {
  const from = order.indexOf(i);
  if (from < 0 || from === to) return;
  order.splice(from, 1);
  order.splice(to, 0, i);
  renderAnim();
}

export function setOffset(i: number, dx: number, dy: number): void {
  if (dx || dy) offsets.set(i, { dx, dy });
  else offsets.delete(i);
  selected = i;
  renderAnim();
}

export const nudge = (i: number, dx: number, dy: number) => { const o = offsetOf(i); setOffset(i, o.dx + dx, o.dy + dy); };
export function resetAllOffsets(): void { offsets = new Map(); renderAnim(); }

export function setHold(i: number, v: number): void {
  holds.set(i, Math.max(1, Math.min(16, v)));
  renderAnim();
}

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

// On the animation step the arrow keys move the selected frame, unless a
// control that uses them (sliders, radios, number fields) has the focus.
function onKeyDown(e: KeyboardEvent): void {
  const d = ARROWS[e.key];
  if (!d || currentMode() !== 'pixelize' || currentStep() !== 'frames' || selected === null || e.altKey || e.ctrlKey || e.metaKey) return;
  if ((e.target as HTMLElement).matches?.('input, select, textarea, .frame')) return;
  e.preventDefault();
  nudge(selected, d[0], d[1]);
}

// ---------- exports ----------

// Active frames in order, each repeated by its duration when asked.
function exportFrames(): number[] {
  const act = activeFrames();
  return settings.repeatHolds ? act.flatMap((i) => Array<number>(holdOf(i)).fill(i)) : act;
}

function noFrames(): boolean {
  if (anim && activeFrames().length) return false;
  setStatus('There are no frames to export.', true);
  return true;
}

export async function downloadStrip(): Promise<void> {
  if (noFrames()) return;
  const seq = exportFrames(), a = anim!;
  const c = document.createElement('canvas');
  c.width = a.W * seq.length;
  c.height = a.H;
  const ctx = c.getContext('2d')!;
  seq.forEach((idx, k) => ctx.drawImage(a.canvases[idx], k * a.W, 0));
  await saveBlob(await canvasBlob(c), `${baseName()}_strip${seq.length}.png`);
}

export async function downloadSheet(): Promise<void> {
  if (noFrames()) return;
  const seq = exportFrames(), a = anim!;
  const cols = Math.max(1, Math.min(seq.length, Math.round(settings.sheetCols) || Math.ceil(Math.sqrt(seq.length))));
  const rows = Math.ceil(seq.length / cols);
  const pad = Math.max(0, Math.round(settings.sheetPad) || 0);
  const c = document.createElement('canvas');
  c.width = cols * a.W + (cols + 1) * pad;
  c.height = rows * a.H + (rows + 1) * pad;
  const ctx = c.getContext('2d')!;
  seq.forEach((idx, k) => ctx.drawImage(a.canvases[idx], pad + (k % cols) * (a.W + pad), pad + Math.floor(k / cols) * (a.H + pad)));
  await saveBlob(await canvasBlob(c), `${baseName()}_sheet_${cols}x${rows}.png`);
}

export async function downloadFramesZip(): Promise<void> {
  if (noFrames()) return;
  const act = activeFrames();
  const files: ZipEntry[] = [];
  for (let k = 0; k < act.length; k++) {
    files.push({ name: `${baseName()}_${String(k).padStart(2, '0')}.png`, data: await canvasBytes(anim!.canvases[act[k]]) });
  }
  await saveBlob(new Blob([makeZip(files)], { type: 'application/zip' }), `${baseName()}_frames.zip`);
}

export async function downloadGif(): Promise<void> {
  if (noFrames()) return;
  const a = anim!;
  const seq = playbackSequence(activeFrames(), settings.dir, playOnce());
  const scale = Math.max(1, Math.min(32, Math.round(settings.gifScale) || 1));
  const fps = settings.fps || 8;
  setStatus('Encoding GIF…');
  await wait(20);
  const frames = seq.map((i) => a.canvases[i].getContext('2d')!.getImageData(0, 0, a.W, a.H).data);
  const bytes = encodeGif(frames, a.W, a.H, scale, seq.map((i) => (100 / fps) * holdOf(i)), !playOnce());
  await saveBlob(new Blob([bytes], { type: 'image/gif' }), `${baseName()}.gif`);
}

// ---------- wiring ----------

const ANIM_KEYS = ['animOn', 'splitMode', 'cols', 'rows', 'minGap', 'align'] as const;
const VIEW_KEYS = ['onion', 'ghost'] as const;
const keyOf = (keys: readonly (keyof typeof settings)[]) => keys.map((k) => settings[k]).join('|');

export function initAnim(): void {
  pxBus.on('result', renderAnim);
  pxBus.on('step', () => { if (currentStep() === 'frames') requestAnimationFrame(drawAlign); });
  let animKey = keyOf(ANIM_KEYS), viewKey = keyOf(VIEW_KEYS), playKey = `${settings.dir}|${settings.endMode}`;
  pxBus.on('settings', () => {
    const a = keyOf(ANIM_KEYS), v = keyOf(VIEW_KEYS), p = `${settings.dir}|${settings.endMode}`;
    if (a !== animKey) { animKey = a; renderAnim(); }
    if (v !== viewKey) { viewKey = v; drawPreview(); drawAlign(); }
    if (p !== playKey) {
      playKey = p;
      // a finished "once" run can play again after changing the options
      if (ended) { ended = false; animIndex = startIndex(); pxBus.emit('anim'); drawPreview(); }
      if (settings.dir !== 'pingpong') pingDir = 1;
    }
  });
  document.addEventListener('keydown', onKeyDown);
  requestAnimationFrame(tick);
}

/** The frames of the animation as they play (aligned, in order), or null when there is no animation. */
export function animFrameCanvases(): HTMLCanvasElement[] | null {
  if (!anim || !settings.animOn) return null;
  const act = activeFrames();
  return act.length > 1 ? act.map((i) => anim!.canvases[i]) : null;
}

/** Read-only view for checking the page from the console. */
export const animState = () => ({ anim, order: [...order], excluded: [...excluded], selected, playing, holds: [...holds], offsets: [...offsets] });
