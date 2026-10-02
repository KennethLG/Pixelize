// Building a palette from the sampled colors and snapping pixels to it.

import { dist2, keyAt, keyOf, labOf, labOfKey, rgbOfKey, type Lab, type RGB } from './color';

export interface ColorCount {
  rgb: RGB;
  lab: Lab;
  count: number;
}

export interface PaletteEntry {
  rgb: RGB;
  lab: Lab;
  count?: number;
  /** Locked by the user: never moves and never disappears. */
  pinned?: boolean;
}

/** A replace or merge edit: colors close to `from` become `to`. */
export interface ColorMap {
  from: RGB;
  to: RGB;
}

export function collectColors(pixels: Uint8ClampedArray): ColorCount[] {
  const map = new Map<number, number>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const key = keyAt(pixels, i);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([key, count]) => {
    const rgb = rgbOfKey(key);
    return { rgb, lab: labOf(rgb), count };
  });
}

export const pinnedEntries = (locks: RGB[]): PaletteEntry[] => locks.map((rgb) => ({ rgb, lab: labOf(rgb), pinned: true }));

// Centers move to the weighted mean of their members; pinned ones stay put.
function refine(colors: ColorCount[], centers: PaletteEntry[], iterations: number): PaletteEntry[] {
  for (let it = 0; it < iterations; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (const c of colors) {
      let bi = 0, bd = Infinity;
      for (let k = 0; k < centers.length; k++) { const d = dist2(c.lab, centers[k].lab); if (d < bd) { bd = d; bi = k; } }
      const a = acc[bi];
      a[0] += c.rgb[0] * c.count; a[1] += c.rgb[1] * c.count; a[2] += c.rgb[2] * c.count; a[3] += c.count;
    }
    const next: PaletteEntry[] = [];
    centers.forEach((c, k) => {
      const a = acc[k];
      if (c.pinned) { next.push({ ...c, count: a[3] }); return; }
      if (!a[3]) return;
      const rgb: RGB = [Math.round(a[0] / a[3]), Math.round(a[1] / a[3]), Math.round(a[2] / a[3])];
      next.push({ rgb, lab: labOf(rgb), count: a[3] });
    });
    centers = next;
  }
  return centers;
}

// The most common colors become entries; every other color within `tolerance`
// (Lab deltaE) of an entry is merged into it.
export function autoPalette(colors: ColorCount[], tolerance: number, locks: PaletteEntry[] = []): PaletteEntry[] {
  const sorted = [...colors].sort((a, b) => b.count - a.count);
  const t2 = tolerance * tolerance;
  let centers: PaletteEntry[] = locks.map((l) => ({ ...l }));
  for (const c of sorted) if (!centers.some((p) => dist2(p.lab, c.lab) < t2)) centers.push({ rgb: c.rgb, lab: c.lab });
  centers = refine(colors, centers, 5);
  // refining can drift two entries together; merge them again
  const merged = centers.filter((c) => c.pinned);
  for (const c of centers.filter((c) => !c.pinned).sort((a, b) => (b.count || 0) - (a.count || 0))) {
    if (!merged.some((p) => dist2(p.lab, c.lab) < t2)) merged.push(c);
  }
  return refine(colors, merged, 3);
}

// Exactly k colors: k-means++ in Lab, seeded with the locked colors.
export function kmeansPalette(colors: ColorCount[], k: number, locks: PaletteEntry[] = []): PaletteEntry[] {
  k = Math.max(k, locks.length);
  if (colors.length + locks.length <= k) return [...locks, ...colors.map((c) => ({ rgb: c.rgb, lab: c.lab }))];
  const sorted = [...colors].sort((a, b) => b.count - a.count);
  const centers: PaletteEntry[] = locks.map((l) => ({ ...l }));
  if (!centers.length) centers.push({ rgb: sorted[0].rgb, lab: sorted[0].lab });
  while (centers.length < k) {
    let best: ColorCount | null = null, bestScore = -1;
    for (const c of colors) {
      const d = Math.min(...centers.map((p) => dist2(p.lab, c.lab)));
      const score = d * Math.sqrt(c.count);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (!best || bestScore <= 0) break;
    centers.push({ rgb: best.rgb, lab: best.lab });
  }
  return refine(colors, centers, 20);
}

export function applyPalette(pixels: Uint8ClampedArray, palette: PaletteEntry[]): void {
  const cache = new Map<number, PaletteEntry>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) { pixels[i] = pixels[i + 1] = pixels[i + 2] = 0; continue; }
    const key = keyAt(pixels, i);
    let p = cache.get(key);
    if (!p) {
      const lab = labOfKey(key);
      let bd = Infinity;
      for (const q of palette) { const d = dist2(lab, q.lab); if (d < bd) { bd = d; p = q; } }
      cache.set(key, p!);
    }
    pixels[i] = p!.rgb[0]; pixels[i + 1] = p!.rgb[1]; pixels[i + 2] = p!.rgb[2];
  }
}

// Each map turns colors within deltaE 3 of `from` into `to`. Maps chain
// (A into B, then B replaced by C), with a cap so cycles end.
export function applyColorMaps(pixels: Uint8ClampedArray, maps: ColorMap[]): void {
  if (!maps.length) return;
  const ms = maps.map((m) => ({ from: labOf(m.from), to: keyOf(m.to[0], m.to[1], m.to[2]) }));
  const resolve = (k: number) => {
    for (let n = 0; n < 8; n++) {
      const lab = labOfKey(k);
      let best: (typeof ms)[number] | null = null, bd = 9;
      for (const m of ms) { const d = dist2(lab, m.from); if (d < bd) { bd = d; best = m; } }
      if (!best || best.to === k) return k;
      k = best.to;
    }
    return k;
  };
  const cache = new Map<number, number>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (!pixels[i + 3]) continue;
    const k = keyAt(pixels, i);
    let r = cache.get(k);
    if (r === undefined) { r = resolve(k); cache.set(k, r); }
    if (r !== k) { pixels[i] = (r >> 16) & 255; pixels[i + 1] = (r >> 8) & 255; pixels[i + 2] = r & 255; }
  }
}
