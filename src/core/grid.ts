// Finding the grid of simulated pixels: edge profiles per axis, the cell size
// that best explains the gaps between edges, and the grid lines themselves.

export interface SourceImage {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

export type GridMode = 'auto' | 'manual' | 'exact';

export interface GridSettings {
  mode: GridMode;
  cellX: number;
  cellY: number;
  offX: number;
  offY: number;
  snap: boolean;
  fw: number;
  fh: number;
}

export interface Grid {
  xs: number[];
  ys: number[];
  cell: { x: number; y: number } | null;
  /** Detection margin over chance (auto mode only); see confidenceLevel. */
  confidence: number | null;
  min: number;
  max: number;
}

/** Per-source cache so changing palette settings does not redo edge detection. */
export interface GridCache {
  profiles?: { nx: Float64Array; ny: Float64Array };
  analysis?: Grid & { key: string };
}

// Edge strength between column x-1 and x (or row y-1 and y), summed over the image.
export function edgeProfiles(data: Uint8ClampedArray, w: number, h: number) {
  const px = new Float64Array(w), py = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x > 0) {
        const j = i - 4;
        px[x] += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) +
          Math.abs(data[i + 2] - data[j + 2]) + Math.abs(data[i + 3] - data[j + 3]);
      }
      if (y > 0) {
        const j = i - w * 4;
        py[y] += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) +
          Math.abs(data[i + 2] - data[j + 2]) + Math.abs(data[i + 3] - data[j + 3]);
      }
    }
  }
  return { px, py };
}

// Remove the slowly varying part so only sharp cell boundaries stand out.
export function normalizeProfile(p: Float64Array): Float64Array {
  const n = p.length, out = new Float64Array(n), r = 4;
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let k = i - r; k <= i + r; k++) if (k >= 0 && k < n) { s += p[k]; c++; }
    out[i] = Math.max(0, p[i] - s / c);
  }
  return out;
}

// Best phase of a comb with period s (fallback start when no edges are found).
function combPhase(profile: Float64Array, s: number): number {
  const n = profile.length;
  let best = -1, bestPhase = 0;
  for (let phase = 0; phase < s; phase += Math.max(0.5, s / 16)) {
    let sum = 0, count = 0;
    for (let pos = phase; pos < n; pos += s) { sum += profile[Math.round(pos)] || 0; count++; }
    if (count && sum / count > best) { best = sum / count; bestPhase = phase; }
  }
  return bestPhase;
}

// Clear cell boundaries: local maxima well above the noise floor. Blur makes one
// boundary a few px wide, so nearby maxima collapse into one.
export function findPeaks(profile: Float64Array): number[] {
  const n = profile.length;
  const sorted = [...profile].sort((a, b) => a - b);
  const threshold = (sorted[Math.floor(n * 0.98)] || sorted[n - 1]) * 0.3;
  const peaks: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = profile[i];
    if (v < threshold || v < profile[i - 1] || v < profile[i + 1]) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && i - last < 3) { if (v > profile[last]) peaks[peaks.length - 1] = i; }
    else peaks.push(i);
  }
  return peaks;
}

function gapFits(g: number, s: number, tol: number): boolean {
  const cells = Math.max(1, Math.round(g / s));
  return Math.abs(g - cells * s) <= tol;
}

// Cell size = the s that turns most gaps between boundaries into whole cells,
// minus how many would fit by chance (tiny sizes fit anything). The margin
// over chance doubles as the detection confidence.
export function detectCellSize(nx: Float64Array, ny: Float64Array, w: number, h: number): { cell: number; score: number } {
  const gaps: number[] = [];
  for (const peaks of [findPeaks(nx), findPeaks(ny)]) {
    for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1]);
  }
  if (gaps.length < 4) return { cell: 1, score: 0 };
  const maxS = Math.min(Math.max(...gaps), Math.min(w, h) / 4);
  const tolFor = (s: number) => Math.max(1.5, s * 0.12);
  const scores: { s: number; score: number }[] = [];
  for (let s = 2; s <= maxS; s += 0.05) {
    const tol = tolFor(s);
    let fit = 0;
    for (const g of gaps) if (gapFits(g, s, tol)) fit++;
    scores.push({ s, score: fit / gaps.length - Math.min(1, (2 * tol) / s) });
  }
  // Half or a third of the real size fits every gap just as well, so on a near
  // tie take the largest size (multiples of the real size fail on 1-cell gaps).
  const top = Math.max(...scores.map((r) => r.score));
  let best = scores[0] || { s: 1, score: 0 };
  for (const r of scores) if (r.score >= top - 0.03) best = r;
  for (const r of scores) if (Math.abs(r.s - best.s) <= best.s * 0.06 && r.score > best.score) best = r;
  const tol = tolFor(best.s);
  let sum = 0, count = 0;
  for (const g of gaps) {
    const cells = Math.max(1, Math.round(g / best.s));
    if (cells <= 3 && gapFits(g, best.s, tol)) { sum += g; count += cells; }
  }
  return { cell: count ? sum / count : best.s, score: best.score };
}

// Grid lines along one axis. With snap, every clear edge is an anchor and the
// space between two anchors gets the whole number of cells that fits it best,
// evenly spaced, so uneven cells line up and long flat stretches cannot drift.
// Without snap the lines are a plain comb starting at `start`.
export function snapCuts(profile: Float64Array, n: number, cell: number, start: number | null = null, snap = true): number[] {
  const inner: number[] = [];
  const anchors: number[] = [];
  if (snap) {
    for (const p of findPeaks(profile)) {
      const last = anchors[anchors.length - 1];
      if (last === undefined || p - last >= cell * 0.6) anchors.push(p);
      else if (profile[p] > profile[last] && (anchors.length < 2 || p - anchors[anchors.length - 2] >= cell * 0.6)) anchors[anchors.length - 1] = p;
    }
  }
  if (anchors.length) {
    // the image borders act as anchors too
    const points = [0, ...anchors, n];
    for (let k = 0; k + 1 < points.length; k++) {
      const a = points[k], d = points[k + 1] - a, m = Math.max(1, Math.round(d / cell));
      if (k > 0) inner.push(a);
      for (let j = 1; j < m; j++) inner.push(a + (j * d) / m);
    }
  } else {
    let pos = start !== null ? start : combPhase(profile, cell);
    while (pos - cell >= 0) pos -= cell;
    for (; pos < n; pos += cell) inner.push(pos);
  }
  const cuts = [0];
  for (const p of inner.map(Math.round).sort((a, b) => a - b)) if (p > cuts[cuts.length - 1] && p < n) cuts.push(p);
  cuts.push(n);
  // a sliver at either border is part of the neighboring cell
  if (cuts.length > 2 && cuts[1] - cuts[0] < cell * 0.5) cuts.splice(1, 1);
  if (cuts.length > 2 && cuts[cuts.length - 1] - cuts[cuts.length - 2] < cell * 0.5) cuts.splice(cuts.length - 2, 1);
  return cuts;
}

export function uniformCuts(n: number, count: number): number[] {
  const cuts: number[] = [];
  for (let i = 0; i <= count; i++) cuts.push(Math.round((i * n) / count));
  return cuts;
}

export function analyzeGrid(src: SourceImage, cache: GridCache, s: GridSettings): Grid {
  const key = JSON.stringify(s);
  if (cache.analysis && cache.analysis.key === key) return cache.analysis;
  const { w, h } = src;
  let xs: number[], ys: number[];
  let cell: Grid['cell'] = null;
  let confidence: number | null = null;
  if (s.mode === 'exact') {
    if (!(s.fw > 0 && s.fh > 0)) throw new Error('Enter a width and a height greater than 0.');
    xs = uniformCuts(w, Math.min(s.fw, w));
    ys = uniformCuts(h, Math.min(s.fh, h));
  } else {
    if (!cache.profiles) {
      const { px, py } = edgeProfiles(src.data, w, h);
      cache.profiles = { nx: normalizeProfile(px), ny: normalizeProfile(py) };
    }
    const { nx, ny } = cache.profiles;
    if (s.mode === 'manual') {
      if (!(s.cellX >= 2 && s.cellY >= 2)) throw new Error('The cell must be at least 2 px.');
      cell = { x: s.cellX, y: s.cellY };
      xs = snapCuts(nx, w, s.cellX, s.offX || 0, s.snap);
      ys = snapCuts(ny, h, s.cellY, s.offY || 0, s.snap);
    } else {
      const d = detectCellSize(nx, ny, w, h);
      if (d.cell < 2) throw new Error('No pixel grid found. Try Manual or Exact.');
      cell = { x: d.cell, y: d.cell };
      confidence = d.score;
      xs = snapCuts(nx, w, d.cell);
      ys = snapCuts(ny, h, d.cell);
    }
  }
  const widths = xs.slice(1).map((v, i) => v - xs[i]).concat(ys.slice(1).map((v, i) => v - ys[i]));
  cache.analysis = { key, xs, ys, cell, confidence, min: Math.min(...widths), max: Math.max(...widths) };
  return cache.analysis;
}

export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function confidenceLevel(score: number | null): ConfidenceLevel | null {
  if (score === null) return null;
  return score >= 0.45 ? 'high' : score >= 0.25 ? 'medium' : 'low';
}
