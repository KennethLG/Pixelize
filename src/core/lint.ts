// A pixel art "linter": finds things that usually look like mistakes. They are
// hints, not rules (an eye highlight is an orphan pixel on purpose).
//   orphan     an opaque pixel with no neighbour of its color
//   jaggy      the corner of an L in a 1 px line (a doubled pixel)
//   banding    a 1 px band of color running alongside an edge in steps
//   duplicate  two colors in use that are almost the same

import { labOfKey } from './color';

export type LintKind = 'orphan' | 'jaggy' | 'banding' | 'duplicate';
export interface LintIssue { kind: LintKind; x: number; y: number; color: number; other?: number }

const N8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

/** Color key at x, y, or -1 when outside or transparent. */
function keyAt(px: Uint8ClampedArray, w: number, h: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= w || y >= h) return -1;
  const i = (y * w + x) * 4;
  return px[i + 3] ? (px[i] << 16) | (px[i + 1] << 8) | px[i + 2] : -1;
}

export function findOrphans(px: Uint8ClampedArray, w: number, h: number): LintIssue[] {
  const out: LintIssue[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = keyAt(px, w, h, x, y);
      if (c < 0) continue;
      if (!N8.some(([dx, dy]) => keyAt(px, w, h, x + dx, y + dy) === c)) out.push({ kind: 'orphan', x, y, color: c });
    }
  }
  return out;
}

/**
 * The corner of an L in a 1 px line: exactly two straight neighbours of its
 * color, one beside and one above or below, and not the pixel between them
 * (in a filled shape that pixel is filled). In a staircase every inner pixel
 * is such a corner, so a pixel next to one already found is skipped: one
 * report per step, the pixel a "pixel perfect" stroke would leave out.
 */
export function findJaggies(px: Uint8ClampedArray, w: number, h: number): LintIssue[] {
  const out: LintIssue[] = [];
  const found = new Set<number>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = keyAt(px, w, h, x, y);
      if (c < 0) continue;
      const same = (dx: number, dy: number) => keyAt(px, w, h, x + dx, y + dy) === c;
      const left = same(-1, 0), right = same(1, 0), up = same(0, -1), down = same(0, 1);
      if (+left + +right !== 1 || +up + +down !== 1) continue;
      const hx = left ? -1 : 1, vy = up ? -1 : 1;
      if (same(hx, vy)) continue;
      if (found.has(y * w + x - 1) || found.has((y - 1) * w + x) || found.has(y * w + x + 1)) continue;
      found.add(y * w + x);
      out.push({ kind: 'jaggy', x, y, color: c });
    }
  }
  return out;
}

/**
 * 1 px bands: a pixel of color B between A and C (all different, all opaque),
 * where the same A|B|C pattern repeats on the next lines shifted one pixel the
 * same way, three or more times: two edges stepping together.
 */
export function findBanding(px: Uint8ClampedArray, w: number, h: number): LintIssue[] {
  const flagged = new Map<number, LintIssue>();
  const scan = (horizontal: boolean) => {
    // the A|B|C triple across a band at x, y (horizontal: A left of B, C right of B)
    const triple = (x: number, y: number): string | null => {
      const b = keyAt(px, w, h, x, y);
      const a = horizontal ? keyAt(px, w, h, x - 1, y) : keyAt(px, w, h, x, y - 1);
      const c = horizontal ? keyAt(px, w, h, x + 1, y) : keyAt(px, w, h, x, y + 1);
      return b >= 0 && a >= 0 && c >= 0 && a !== b && b !== c && a !== c ? `${a}|${b}|${c}` : null;
    };
    const lines = horizontal ? h : w, along = horizontal ? w : h;
    for (let l = 0; l < lines; l++) {
      for (let p = 0; p < along; p++) {
        const at = (pp: number, ll: number) => (horizontal ? triple(pp, ll) : triple(ll, pp));
        const t = at(p, l);
        if (!t) continue;
        for (const step of [-1, 1]) {
          const chain: [number, number][] = [[p, l]];
          while (at(p + step * chain.length, l + chain.length) === t) chain.push([p + step * chain.length, l + chain.length]);
          if (chain.length < 3) continue;
          for (const [cp, cl] of chain) {
            const x = horizontal ? cp : cl, y = horizontal ? cl : cp;
            flagged.set(y * w + x, { kind: 'banding', x, y, color: keyAt(px, w, h, x, y) });
          }
        }
      }
    }
  };
  scan(true);
  scan(false);
  return [...flagged.values()];
}

/**
 * Pairs of colors whose Lab distance is under \`threshold\` (they read as the
 * same color). Each pair is reported at a pixel of the rarer one.
 */
export function findNearDuplicates(px: Uint8ClampedArray, w: number, h: number, threshold = 6): LintIssue[] {
  const counts = new Map<number, { n: number; x: number; y: number }>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = keyAt(px, w, h, x, y);
      if (c < 0) continue;
      const e = counts.get(c);
      if (e) e.n++;
      else counts.set(c, { n: 1, x, y });
    }
  }
  const keys = [...counts.keys()], labs = keys.map(labOfKey), out: LintIssue[] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = labs[i], b = labs[j];
      if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= threshold) continue;
      const [rare, common] = counts.get(keys[i])!.n <= counts.get(keys[j])!.n ? [keys[i], keys[j]] : [keys[j], keys[i]];
      const at = counts.get(rare)!;
      out.push({ kind: 'duplicate', x: at.x, y: at.y, color: rare, other: common });
    }
  }
  return out;
}

export function lintImage(px: Uint8ClampedArray, w: number, h: number, kinds: LintKind[] = ['orphan', 'jaggy', 'banding', 'duplicate']): LintIssue[] {
  const out: LintIssue[] = [];
  if (kinds.includes('orphan')) out.push(...findOrphans(px, w, h));
  if (kinds.includes('jaggy')) out.push(...findJaggies(px, w, h));
  if (kinds.includes('banding')) out.push(...findBanding(px, w, h));
  if (kinds.includes('duplicate')) out.push(...findNearDuplicates(px, w, h));
  return out;
}
