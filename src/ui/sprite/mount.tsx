// Starts the sprite editor: preferences, the last sprite, global handlers, and
// the React tree inside #spriteMode.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { $ } from '../dom';
import { draw } from './canvas';
import { SpriteEditor } from './components/SpriteEditor';
import { initIo, restore } from './io';
import { loadPrefs } from './prefs';
import { initShortcuts } from './shortcuts';
import { sp } from './state';

export function initSprite(isActive: () => boolean): void {
  loadPrefs();
  restore();
  initIo(isActive);
  initShortcuts(isActive);
  createRoot($('spriteMode')).render(<StrictMode><SpriteEditor /></StrictMode>);
}

/** The editor state, for checks from the browser console. */
export const spriteState = () => sp;

/** Call when the sprite editor becomes visible: the canvas only gets its size then. */
export const showSprite = () => requestAnimationFrame(draw);
