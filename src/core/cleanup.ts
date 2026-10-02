// Removing single noise pixels left after the palette snap.

import { dist2, keyAt, labOfKey } from './color';

// A pixel with no same-colored neighbor, surrounded by one similar color, is
// noise. High-contrast single pixels (eyes, highlights) stay, because they are
// further than `strength` (Lab deltaE) from their surroundings.
export function cleanStray(px: Uint8ClampedArray, w: number, h: number, strength: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(px);
  const t2 = strength * strength;
  const at = (x: number, y: number): number | null => {
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    const i = (y * w + x) * 4;
    return px[i + 3] ? keyAt(px, i) : -1;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = at(x, y);
      if (k === -1) continue;
      const ns = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)].filter((v): v is number => v !== null);
      if (ns.includes(k!)) continue;
      const counts = new Map<number, number>();
      for (const n of ns) counts.set(n, (counts.get(n) || 0) + 1);
      let c: number | null = null, cn = 0;
      for (const [n, m] of counts) if (m > cn) { cn = m; c = n; }
      // floating pixels on transparency are details, not noise
      if (c === null || c === -1 || cn < Math.max(2, ns.length - 1)) continue;
      if (dist2(labOfKey(k!), labOfKey(c)) > t2) continue;
      const i = (y * w + x) * 4;
      out[i] = (c >> 16) & 255; out[i + 1] = (c >> 8) & 255; out[i + 2] = c & 255;
    }
  }
  return out;
}
