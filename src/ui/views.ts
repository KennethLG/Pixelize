// The original image with its fitted grid, and the stats row above it.

import { hex, rgbOfKey } from '../core/color';
import { confidenceLevel } from '../core/grid';
import { app, onBase } from './app';
import { $, cssVar, field, isChecked, radio } from './dom';

export function renderSource(): void {
  const src = app.source;
  if (!src) return;
  const canvas = $<HTMLCanvasElement>('srcCanvas');
  canvas.width = src.w;
  canvas.height = src.h;
  canvas.parentElement!.style.aspectRatio = `${src.w} / ${src.h}`;
  // on the grid step the result matches the original's shape, and wide images stack
  const views = document.querySelector<HTMLElement>('.views')!;
  views.style.setProperty('--src-ar', `${src.w} / ${src.h}`);
  views.classList.toggle('wide', src.w > src.h * 1.25);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(src.img, 0, 0);
  if (!isChecked('showGrid') || !app.base) return;
  ctx.strokeStyle = cssVar('--grid') || 'rgba(217,115,43,.75)';
  ctx.lineWidth = Math.max(1, Math.round(src.w / 700));
  ctx.beginPath();
  for (const x of app.base.grid.xs) { ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, src.h); }
  for (const y of app.base.grid.ys) { ctx.moveTo(0, y + 0.5); ctx.lineTo(src.w, y + 0.5); }
  ctx.stroke();
}

function chip(text: string, level: string, title = ''): HTMLElement {
  const el = document.createElement('span');
  el.className = `conf ${level}`;
  el.textContent = text;
  el.title = title;
  return el;
}

export function renderStats(): void {
  const base = app.base, src = app.source;
  if (!base || !src) return;
  const g = base.grid;
  $('stIn').textContent = `${src.w}×${src.h}`;
  $('stCell').textContent = !g.cell ? `${g.min}–${g.max} px`
    : g.cell.x === g.cell.y ? `${g.cell.x.toFixed(1)} px` : `${g.cell.x.toFixed(1)}×${g.cell.y.toFixed(1)}`;
  $('stCell').title = `Cells measure ${g.min} to ${g.max} px`;
  const level = confidenceLevel(g.confidence);
  const conf = $('stConf');
  conf.replaceChildren();
  if (level) conf.append(chip(level, level, `Detection confidence (${g.confidence!.toFixed(2)})`));
  else if (radio('sizeMode') === 'manual') conf.append(chip('manual', 'medium'));
  $('confWarn').hidden = level !== 'low';
  $('stOut').textContent = `${base.width}×${base.height}`;
  $('resTag').textContent = g.cell ? `cells ${g.min}–${g.max} px` : '';
  $('gridAutoInfo').textContent = radio('sizeMode') === 'auto' && g.cell
    ? `Detected ${g.cell.x.toFixed(2)} px per pixel (${level} confidence).`
    : 'Detects the size of the fake pixels on its own.';
  const bgHex = base.bgKey === null ? null : hex(rgbOfKey(base.bgKey));
  $('bgSwatch').style.background = bgHex || '';
  $('bgHex').textContent = bgHex ? `${bgHex} ${base.bgAuto ? '(auto)' : '(picked)'}` : '–';
  field('bgAuto').disabled = base.bgAuto;
  const cropped = base.width !== base.fullW || base.height !== base.fullH;
  $('cropInfo').textContent = cropped
    ? `${base.fullW}×${base.fullH} → ${base.width}×${base.height} px`
    : `${base.width}×${base.height} px${radio('cropMode') === 'trim' ? ', nothing to trim' : ''}`;
}

export function initViews(): void {
  onBase(renderSource);
  onBase(renderStats);
  field('showGrid').addEventListener('change', renderSource);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderSource);
}
