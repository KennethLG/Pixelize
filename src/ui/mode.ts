// The two halves of the app: "Pixelize" (turn an AI image into real pixel
// art, the step-by-step flow) and "Sprite editor" (draw and animate sprites).

import { $ } from './dom';

export type Mode = 'pixelize' | 'sprite';
const KEY = 'pixelize.mode';

let mode: Mode = 'pixelize';
const listeners: ((m: Mode) => void)[] = [];

export const currentMode = () => mode;
export const onMode = (fn: (m: Mode) => void) => listeners.push(fn);

export function setMode(m: Mode): void {
  mode = m;
  document.body.dataset.mode = m;
  $('pixelizeMode').hidden = m !== 'pixelize';
  $('spriteMode').hidden = m !== 'sprite';
  document.querySelectorAll<HTMLElement>('[data-mode-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modeBtn === m)));
  try { localStorage.setItem(KEY, m); } catch { /* storage unavailable */ }
  listeners.forEach((f) => f(m));
}

export function initMode(): void {
  document.querySelectorAll<HTMLElement>('[data-mode-btn]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.modeBtn as Mode)));
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
  setMode(saved === 'sprite' ? 'sprite' : 'pixelize');
}
