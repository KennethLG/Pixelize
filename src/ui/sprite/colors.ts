// Colors: primary/secondary swatches, the in-app HSV picker, the colors used
// in the sprite and the user's own palette (kept in this browser). The same
// picker also edits the paper color when its swatch (under the canvas) is chosen.

import { hex, hexToRgb, keyOf, rgbOfKey, type RGB, type RGBA } from '../../core/color';
import { parsePaletteText } from '../../core/paletteText';
import { usedColors } from '../../core/sprite';
import { $, field, setStatus } from '../dom';
import { decodeFile, imageToData } from '../input';
import { emit, on, setColor, sp } from './state';

const PAL_KEY = 'pixelize.sprite.palette';
type Slot = 'primary' | 'secondary' | 'paper';
let slot: Slot = 'primary';
let hsv: [number, number, number] = [0, 0, 0];  // the picker's color, kept so hue survives greys
let userPalette: RGB[] = [];

// ---------- HSV ----------

function rgbToHsv([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [((h * 60) + 360) % 360, max ? d / max : 0, max];
}

function hsvToRgb(h: number, s: number, v: number): RGB {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
}

const active = (): RGBA => (slot === 'paper' ? [...sp.paperColor, 255] : sp[slot]);

function setActive(c: RGBA): void {
  if (slot !== 'paper') { setColor(slot, c); return; }
  sp.paperColor = [c[0], c[1], c[2]];
  sp.paperMode = 'color';
  emit('paper');
}

/** Chooses what the picker edits. */
function pick(s: Slot): void {
  slot = s;
  hsv = [hsv[0], 0, 0];
  if (s === 'paper' && sp.paperMode !== 'color') { sp.paperMode = 'color'; emit('paper'); }
  syncFromColor();
}

function drawPicker(): void {
  const sv = $<HTMLCanvasElement>('spSV'), hue = $<HTMLCanvasElement>('spHue');
  const g = sv.getContext('2d')!, W = sv.width, H = sv.height;
  g.fillStyle = `hsl(${hsv[0]} 100% 50%)`;
  g.fillRect(0, 0, W, H);
  const white = g.createLinearGradient(0, 0, W, 0);
  white.addColorStop(0, '#fff'); white.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = white; g.fillRect(0, 0, W, H);
  const black = g.createLinearGradient(0, 0, 0, H);
  black.addColorStop(0, 'rgba(0,0,0,0)'); black.addColorStop(1, '#000');
  g.fillStyle = black; g.fillRect(0, 0, W, H);
  const x = hsv[1] * W, y = (1 - hsv[2]) * H;
  g.lineWidth = 2;
  g.strokeStyle = hsv[2] > 0.5 ? '#000' : '#fff';
  g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.stroke();

  const hg = hue.getContext('2d')!, HW = hue.width, HH = hue.height;
  const grad = hg.createLinearGradient(0, 0, HW, 0);
  for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${i * 60} 100% 50%)`);
  hg.fillStyle = grad; hg.fillRect(0, 0, HW, HH);
  const hx = (hsv[0] / 360) * HW;
  hg.fillStyle = '#fff'; hg.fillRect(hx - 2, 0, 4, HH);
  hg.strokeStyle = '#000'; hg.lineWidth = 1; hg.strokeRect(hx - 2.5, 0.5, 5, HH - 1);
}

function syncFromColor(): void {
  const c = active();
  const next = rgbToHsv([c[0], c[1], c[2]]);
  // greys and black have no hue of their own: keep the picker's
  if (next[1] === 0 || next[2] === 0) next[0] = hsv[0];
  if (next[2] === 0) next[1] = hsv[1];
  if (hex(hsvToRgb(...hsv)) !== hex(c)) hsv = next;
  drawPicker();
  for (const s of ['primary', 'secondary'] as const) {
    const el = $(s === 'primary' ? 'spPrimary' : 'spSecondary'), v = sp[s];
    el.style.setProperty('--c', v[3] ? hex(v) : 'transparent');
    el.classList.toggle('empty', !v[3]);
    el.classList.toggle('on', s === slot);
    el.title = `${s === 'primary' ? 'Primary (left click)' : 'Secondary (right click)'}: ${v[3] ? hex(v) : 'transparent'}`;
  }
  const paperEl = $('spPaperColor');
  paperEl.classList.toggle('on', slot === 'paper');
  paperEl.title = `Paper color: ${hex(sp.paperColor)}. Click to edit it with the color picker.`;
  $('spEditing').textContent = slot === 'paper' ? 'Paper' : '';
  const hexInput = field('spHex');
  if (document.activeElement !== hexInput) hexInput.value = c[3] ? hex(c) : '';
  hexInput.placeholder = c[3] ? '' : 'transparent';
  markSwatches();
}

function setFromHsv(): void {
  const [r, g, b] = hsvToRgb(...hsv);
  setActive([r, g, b, 255]);
}

function dragOn(el: HTMLCanvasElement, fn: (x: number, y: number) => void): void {
  const move = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    fn(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)));
  };
  el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); move(e); });
  el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) move(e); });
}

export function swapColors(): void {
  const p = sp.primary;
  sp.primary = sp.secondary;
  sp.secondary = p;
  emit('color');
}

// ---------- swatches ----------

function swatch(rgb: RGB, onPick: (e: MouseEvent) => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sp-sw';
  b.style.setProperty('--c', hex(rgb));
  b.dataset.key = String(keyOf(rgb[0], rgb[1], rgb[2]));
  b.title = hex(rgb);
  b.addEventListener('click', (e) => { if (slot === 'paper') pick('primary'); onPick(e); });
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); setColor('secondary', [...rgb, 255]); });
  return b;
}

function markSwatches(): void {
  const p = sp.primary, k = p[3] ? String(keyOf(p[0], p[1], p[2])) : '';
  document.querySelectorAll<HTMLElement>('.sp-sw').forEach((s) => s.classList.toggle('sel', s.dataset.key === k));
}

let usedKey = '';
function renderUsed(): void {
  const keys = usedColors(sp.doc).slice(0, 256);
  const key = keys.join(',');
  if (key === usedKey) return;
  usedKey = key;
  const box = $('spUsed');
  box.replaceChildren(...keys.map((k) => swatch(rgbOfKey(k), () => setColor('primary', [...rgbOfKey(k), 255]))));
  $('spUsedCount').textContent = String(keys.length);
  $('spUsedEmpty').hidden = keys.length > 0;
  markSwatches();
}

function savePalette(): void {
  try { localStorage.setItem(PAL_KEY, JSON.stringify(userPalette.map((c) => hex(c)))); } catch { /* storage unavailable */ }
}

function renderPalette(): void {
  $('spPal').replaceChildren(...userPalette.map((c, i) => swatch(c, (e) => {
    if (e.ctrlKey || e.metaKey) { userPalette.splice(i, 1); savePalette(); renderPalette(); return; }
    setColor('primary', [...c, 255]);
  })));
  $('spPalEmpty').hidden = userPalette.length > 0;
  markSwatches();
}

function addToPalette(cols: RGB[]): void {
  const have = new Set(userPalette.map((c) => keyOf(...c)));
  for (const c of cols) if (!have.has(keyOf(...c))) { userPalette.push(c); have.add(keyOf(...c)); }
  savePalette();
  renderPalette();
}

async function importPalette(file: File): Promise<void> {
  let cols: RGB[];
  if (file.type.startsWith('image/')) {
    const { data } = imageToData(await decodeFile(file));
    const seen = new Set<number>();
    cols = [];
    for (let i = 0; i < data.length && cols.length < 256; i += 4) {
      const k = keyOf(data[i], data[i + 1], data[i + 2]);
      if (data[i + 3] >= 128 && !seen.has(k)) { seen.add(k); cols.push(rgbOfKey(k)); }
    }
  } else {
    cols = parsePaletteText(await file.text());
  }
  if (!cols.length) { setStatus('No colors found in that file.', true); return; }
  addToPalette(cols);
  setStatus(`Added ${cols.length} colors from ${file.name}`);
}

let usedTimer = 0;

export function initColors(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(PAL_KEY) || '[]') as string[];
    userPalette = saved.filter((h) => /^#[0-9a-f]{6}$/i.test(h)).map(hexToRgb);
  } catch { /* storage unavailable */ }
  if (!userPalette.length) userPalette = ['#1b1530', '#5a5470', '#a8a4b8', '#f4f1e8', '#7a2d3a', '#d9732b', '#f0c060', '#3f7a4a'].map(hexToRgb);

  dragOn($<HTMLCanvasElement>('spSV'), (x, y) => { hsv = [hsv[0], x, 1 - y]; setFromHsv(); });
  dragOn($<HTMLCanvasElement>('spHue'), (x) => { hsv = [Math.min(359.9, x * 360), hsv[1] || 1, hsv[2] || 1]; setFromHsv(); });
  $('spPrimary').addEventListener('click', () => pick('primary'));
  $('spSecondary').addEventListener('click', () => pick('secondary'));
  $('spPaperColor').addEventListener('click', () => pick('paper'));
  $('spSwap').addEventListener('click', swapColors);
  // "Clear" on the paper goes back to the checkerboard
  $('spClearColor').addEventListener('click', () => {
    if (slot === 'paper') { sp.paperMode = 'checker'; emit('paper'); pick('primary'); }
    else setColor(slot, [0, 0, 0, 0]);
  });
  field('spHex').addEventListener('change', () => {
    const v = field('spHex').value.trim().replace(/^#?/, '#');
    if (/^#[0-9a-f]{6}$/i.test(v)) setActive([...hexToRgb(v), 255]);
    else syncFromColor();
  });
  $('spPalAdd').addEventListener('click', () => { const c = sp.primary; if (c[3]) addToPalette([[c[0], c[1], c[2]]]); });
  $('spPalUsed').addEventListener('click', () => addToPalette(usedColors(sp.doc).map(rgbOfKey)));
  $('spPalClear').addEventListener('click', () => { if (userPalette.length && confirm('Remove every color from your palette?')) { userPalette = []; savePalette(); renderPalette(); } });
  $('spPalImport').addEventListener('click', () => field('spPalFile').click());
  field('spPalFile').addEventListener('change', () => {
    const f = field('spPalFile').files?.[0];
    if (f) importPalette(f).catch((e) => setStatus((e as Error).message, true));
    field('spPalFile').value = '';
  });

  on('color', syncFromColor);
  on('paper', () => { if (slot === 'paper' && sp.paperMode !== 'color') slot = 'primary'; syncFromColor(); });
  // the colors in use only change when a stroke ends, and scanning every cel can wait a moment
  on('pixels', () => { clearTimeout(usedTimer); usedTimer = window.setTimeout(renderUsed, 150); });
  on('structure', () => { clearTimeout(usedTimer); usedTimer = window.setTimeout(renderUsed, 150); });

  hsv = rgbToHsv([sp.primary[0], sp.primary[1], sp.primary[2]]);
  renderPalette();
  renderUsed();
  syncFromColor();
}
