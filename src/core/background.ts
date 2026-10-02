// Background detection and removal.

import { keyAt } from './color';

// Most common opaque color along the image border: usually the background.
export function borderColor(pixels: Uint8ClampedArray, w: number, h: number): number | null {
  const counts = new Map<number, number>();
  const add = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (pixels[i + 3] === 0) return;
    const k = keyAt(pixels, i);
    counts.set(k, (counts.get(k) || 0) + 1);
  };
  for (let x = 0; x < w; x++) { add(x, 0); add(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { add(0, y); add(w - 1, y); }
  let best: number | null = null, bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { bestN = n; best = k; }
  return best;
}

export type BgMode = 'edge' | 'all';

// Makes the background colors transparent. "edge" only clears regions touching
// the border (plus the seed, usually the clicked pixel), so the same color
// inside the sprite, like eyes or highlights, survives.
export function removeBackground(pixels: Uint8ClampedArray, w: number, h: number, keys: Set<number>, mode: BgMode, seed?: { x: number; y: number } | null): void {
  if (mode === 'all') {
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] && keys.has(keyAt(pixels, i))) pixels[i + 3] = 0;
    return;
  }
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (pixels[i + 3] && keys.has(keyAt(pixels, i))) { pixels[i + 3] = 0; stack.push(x, y); }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  if (seed && seed.x < w && seed.y < h) push(seed.x, seed.y);
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
}
