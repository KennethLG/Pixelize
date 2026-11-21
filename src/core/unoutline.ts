// Removes the dark outline of pixel art and fills in what was under it. The
// steps follow what the eye does:
//   1. The silhouette edge (opaque pixels next to transparency) is an outline
//      when most of it is clearly darker than the pixels just inside. The
//      colors that make that edge are the outline colors (one black, or the
//      darker shades of a "selout").
//   2. Inside the art, thin lines in those colors are sorted by what lies on
//      their sides: a line between two different regions (an arm over the body)
//      is a contour, a line with the same region all around (an eye, a mouth,
//      a fold that starts at the edge) is drawing and stays.
//   3. Removed pixels take the color of the nearest pixels left, so shading
//      runs on to the edge. A contour takes the side that is in front (the
//      smaller region, a guess).
// Every pixel can be in four classes, so a view can show what will happen.

import type { Bitmap, Mask } from './bitmap';
import { rgbToLab } from './color';

/** none: untouched; edge: silhouette outline; contour: inner outline; detail: an outline colored line kept as drawing */
export const enum OutlineClass { None = 0, Edge = 1, Contour = 2, Detail = 3 }

export interface UnoutlineOptions {
  /** only pixels in the mask are looked at */
  mask?: Mask | null;
  /** how much darker (CIE L*) than the inside an edge pixel must be to count */
  contrast?: number;
  /** remove the silhouette outline instead of filling it (the art gets 1 px smaller) */
  shrink?: boolean;
}

export interface OutlineAnalysis {
  /** one OutlineClass per pixel */
  classes: Uint8Array;
  /** the outline colors (0xRRGGBB); empty when the art has no outline */
  colors: number[];
  edge: number;
  contour: number;
  detail: number;
  /** the region of each pixel left (-1 for outline, kept lines and transparency) */
  regions: Int32Array;
  regionSizes: number[];
}

const N4 = [[0, -1], [-1, 0], [1, 0], [0, 1]];
const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
/** share of the silhouette edge that must be darker than the inside to call it an outline */
const EDGE_SHARE = 0.5;

/** Finds the outline of the art without changing it. */
export function analyzeOutline(b: Bitmap, opts: UnoutlineOptions = {}): OutlineAnalysis {
  const { w, h, px } = b;
  const n = w * h;
  const contrast = opts.contrast ?? 18;
  const mask = opts.mask;
  const classes = new Uint8Array(n);
  const solid = (p: number) => px[p * 4 + 3] > 0;
  const keyOf = (p: number) => (px[p * 4] << 16) | (px[p * 4 + 1] << 8) | px[p * 4 + 2];
  const L = new Float32Array(n);
  for (let p = 0; p < n; p++) if (solid(p)) L[p] = rgbToLab(px[p * 4], px[p * 4 + 1], px[p * 4 + 2])[0];
  const around = (p: number, near: number[][], fn: (q: number) => void) => {
    const x = p % w, y = (p - x) / w;
    for (const [dx, dy] of near) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) fn(ny * w + nx);
    }
  };
  const looked = (p: number) => solid(p) && (!mask || mask[p] === 1);

  // 1. the silhouette edge (next to transparency or the canvas border), and which of its colors are darker than the inside
  const ring = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (!looked(p)) continue;
    const x = p % w, y = (p - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) ring[p] = 1;
    else around(p, N4, (q) => { if (!solid(q)) ring[p] = 1; });
  }
  const votes = new Map<number, [number, number]>(); // color: [darker, voted]
  let darker = 0, voted = 0;
  for (let p = 0; p < n; p++) {
    if (!ring[p]) continue;
    let sum = 0, cnt = 0;
    around(p, N4, (q) => { if (solid(q) && !ring[q]) { sum += L[q]; cnt++; } });
    if (!cnt) continue;
    const dark = L[p] + contrast <= sum / cnt;
    const k = keyOf(p), v = votes.get(k) ?? [0, 0];
    v[0] += +dark; v[1]++;
    votes.set(k, v);
    darker += +dark; voted++;
  }
  const colors = new Set<number>();
  if (voted && darker / voted >= EDGE_SHARE) {
    for (const [k, [d, t]] of votes) if (d / t >= 0.5) colors.add(k);
  }
  const result: OutlineAnalysis = { classes, colors: [...colors], edge: 0, contour: 0, detail: 0, regions: new Int32Array(n).fill(-1), regionSizes: [] };
  if (!colors.size) return result;

  for (let p = 0; p < n; p++) if (ring[p] && colors.has(keyOf(p))) { classes[p] = OutlineClass.Edge; result.edge++; }

  // 2. lines inside the art in an outline color
  const line = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (looked(p) && !ring[p] && colors.has(keyOf(p))) line[p] = 1;
  // an area 3 px across or more (black hair) is art, not a line: take out what an opening keeps
  const core = new Uint8Array(n);
  const dark = (q: number) => line[q] === 1 || classes[q] === OutlineClass.Edge;
  for (let p = 0; p < n; p++) {
    if (!line[p]) continue;
    let all = 0, inside = 0;
    around(p, N8, (q) => { all++; if (dark(q)) inside++; });
    if (all === 8 && inside === 8) core[p] = 1;
  }
  for (let p = 0; p < n; p++) {
    if (!line[p]) continue;
    let area = core[p] === 1;
    if (!area) around(p, N8, (q) => { if (core[q]) area = true; });
    if (area) line[p] = 2;
  }
  // regions: what is left of the art, split by the lines (4-way, so diagonal lines split too);
  // a dark area is a region of its own, so it never joins the regions around it
  const region = result.regions;
  const regionSize = result.regionSizes;
  const stack: number[] = [];
  for (let p = 0; p < n; p++) {
    if (!solid(p) || line[p] === 1 || classes[p] || region[p] >= 0) continue;
    const id = regionSize.length, kind = line[p];
    let size = 0;
    region[p] = id; stack.push(p);
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      around(c, N4, (q) => {
        if (region[q] < 0 && solid(q) && line[q] === kind && !classes[q]) { region[q] = id; stack.push(q); }
      });
    }
    regionSize.push(size);
  }
  for (let p = 0; p < n; p++) if (line[p] === 2) line[p] = 0;
  // each connected line (8-way): a contour when it touches two regions or more
  const seen = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (!line[p] || seen[p]) continue;
    const pixels: number[] = [];
    seen[p] = 1; stack.push(p);
    while (stack.length) {
      const c = stack.pop()!;
      pixels.push(c);
      around(c, N8, (q) => { if (line[q] && !seen[q]) { seen[q] = 1; stack.push(q); } });
    }
    const touched = new Set<number>();
    for (const c of pixels) around(c, N4, (q) => { if (region[q] >= 0) touched.add(region[q]); });
    const contour = touched.size >= 2;
    for (const c of pixels) classes[c] = contour ? OutlineClass.Contour : OutlineClass.Detail;
    if (contour) result.contour += pixels.length; else result.detail += pixels.length;
  }
  return result;
}

/**
 * Removes the outline found by analyzeOutline, filling it with the colors
 * next to it. Returns the analysis; nothing changes when it found no outline.
 */
export function removeOutline(b: Bitmap, opts: UnoutlineOptions = {}): OutlineAnalysis {
  const a = analyzeOutline(b, opts);
  const { w, h, px } = b;
  const n = w * h;
  const cls = a.classes;
  const gone = (p: number) => cls[p] === OutlineClass.Edge || cls[p] === OutlineClass.Contour;
  // filled: the pixels that already hold their final color
  const filled = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (px[p * 4 + 3] > 0 && !gone(p)) filled[p] = 1;
  const near = (p: number, list: number[][], fn: (q: number) => void) => {
    const x = p % w, y = (p - x) / w;
    for (const [dx, dy] of list) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) fn(ny * w + nx);
    }
  };
  const copy = (to: number, from: number) => { for (let k = 0; k < 4; k++) px[to * 4 + k] = px[from * 4 + k]; };

  // contours first, from the region in front only (the smallest one they touch)
  const region = { id: a.regions, size: a.regionSizes };
  const done = new Uint8Array(n);
  for (let p = 0; p < n; p++) {
    if (cls[p] !== OutlineClass.Contour || done[p]) continue;
    const pixels: number[] = [];
    const sizes = new Map<number, number>();
    done[p] = 1;
    const stack = [p];
    while (stack.length) {
      const c = stack.pop()!;
      pixels.push(c);
      near(c, N8, (q) => { if (cls[q] === OutlineClass.Contour && !done[q]) { done[q] = 1; stack.push(q); } });
      near(c, N4, (q) => { const r = region.id[q]; if (r >= 0) sizes.set(r, region.size[r]); });
    }
    let front = -1;
    for (const [r, s] of sizes) if (front < 0 || s < sizes.get(front)!) front = r;
    // the line also carries the color along itself, for pixels with no front pixel beside them
    grow(pixels, (q) => filled[q] === 1 && (region.id[q] === front || cls[q] === OutlineClass.Contour));
  }
  // then everything left, from whatever is next to it
  const rest: number[] = [];
  for (let p = 0; p < n; p++) if (gone(p) && !filled[p]) rest.push(p);
  if (opts.shrink) {
    for (const p of rest) if (cls[p] === OutlineClass.Edge) px.fill(0, p * 4, p * 4 + 4);
    grow(rest.filter((p) => cls[p] === OutlineClass.Contour), (q) => filled[q] === 1);
  } else grow(rest, (q) => filled[q] === 1);
  return a;

  /**
   * Fills `pixels` ring by ring from the filled pixels that `source` accepts:
   * each takes the most common color among its filled straight neighbours
   * (diagonal ones when there are none). Pixels that nothing reaches keep
   * their color (art that is nothing but outline).
   */
  function grow(pixels: number[], source: (q: number) => boolean): void {
    let left = pixels.filter((p) => !filled[p]);
    for (;;) {
      const next: number[] = [];
      const take: [number, number][] = [];
      for (const p of left) {
        const from = pickFrom(p, source);
        if (from >= 0) take.push([p, from]); else next.push(p);
      }
      if (!take.length) break;
      for (const [p, from] of take) copy(p, from);
      for (const [p] of take) filled[p] = 1;
      left = next;
    }
  }

  /** The neighbour to copy: the most common color among the accepted straight neighbours, else diagonal ones. */
  function pickFrom(p: number, ok: (q: number) => boolean): number {
    for (const list of [N4, N8]) {
      const count = new Map<number, [number, number]>();
      near(p, list, (q) => {
        if (!ok(q)) return;
        const k = (px[q * 4] << 16) | (px[q * 4 + 1] << 8) | px[q * 4 + 2] | (px[q * 4 + 3] << 24);
        const c = count.get(k);
        if (c) c[1]++; else count.set(k, [q, 1]);
      });
      let best: [number, number] | null = null;
      for (const c of count.values()) if (!best || c[1] > best[1]) best = c;
      if (best) return best[0];
    }
    return -1;
  }
}
