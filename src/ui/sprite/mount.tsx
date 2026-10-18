// Starts the sprite editor's non-visual parts: preferences, the last sprite,
// paste/drop and shortcuts. The editor itself is rendered by App.

import { draw } from './canvas';
import { initIo, restore } from './io';
import { loadPrefs } from './prefs';
import { initShortcuts } from './shortcuts';
import { sp } from './state';

export function initSprite(isActive: () => boolean): void {
  loadPrefs();
  restore();
  initIo(isActive);
  initShortcuts(isActive);
}

/** The editor state, for checks from the browser console. */
export const spriteState = () => sp;

/** Call when the sprite editor becomes visible: the canvas only gets its size then. */
export const showSprite = () => requestAnimationFrame(draw);
