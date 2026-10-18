// The two halves of the app: "Pixelize" (turn an AI image into real pixel
// art, the step-by-step flow) and "Sprite editor" (draw and animate sprites).

import { pxBus } from './app';

export type Mode = 'pixelize' | 'sprite';
const KEY = 'pixelize.mode';

let mode: Mode = 'pixelize';

export const currentMode = () => mode;
export const onMode = (fn: (m: Mode) => void) => pxBus.on('mode', () => fn(mode));

export function setMode(m: Mode): void {
  mode = m;
  document.body.dataset.mode = m;
  try { localStorage.setItem(KEY, m); } catch { /* storage unavailable */ }
  pxBus.emit('mode');
}

export function initMode(): void {
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
  setMode(saved === 'sprite' ? 'sprite' : 'pixelize');
}
