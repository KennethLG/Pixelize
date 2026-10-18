// Palette helpers for the sprite editor: hue-shifted color ramps, the shading
// brush (one step lighter or darker along a ramp), snapping colors to a
// palette, and color swaps (variants).

import { hsvToRgb, keyOf, labOf, rgbToHsv, type Lab, type RGB } from './color';

export interface RampOptions {
  /** colors on each side of the base color (darker and lighter) */
  steps: number;
  /** degrees the hue turns per step: shadows toward blue, highlights toward yellow */
  hueShift: number;
  /** how much brightness changes per step (0–1) */
  contrast: number;
}

export const DEFAULT_RAMP: RampOptions = { steps: 2, hueShift: 12, contrast: 0.16 };

/** Turns hue \`h\` toward \`target\` by at most \`deg\` degrees, the short way round. */
function hueToward(h: number, target: number, deg: number): number {
  const d = ((target - h + 540) % 360) - 180;
  const step = Math.sign(d) * Math.min(Math.abs(d), deg);
  return (h + step + 360) % 360;
}

/**
 * A ramp from dark to light around \`base\`: each shadow step is darker, a bit
 * more saturated and turned toward blue; each highlight step lighter, a bit
 * less saturated and turned toward yellow. The base color sits in the middle.
 */
export function hueShiftRamp(base: RGB, opts: RampOptions = DEFAULT_RAMP): RGB[] {
  const [h, s, v] = rgbToHsv(base);
  // each side spreads its steps over the brightness it has left, so a dark
  // color still gets distinct shadows and a light one distinct highlights
  // only the steps that fit: nothing is darker than black or lighter than white
  const MIN_V = 0.06, MIN_STEP = 0.025;
  const kDown = Math.max(0, Math.min(opts.steps, Math.floor((v - MIN_V) / MIN_STEP)));
  const down = kDown ? Math.min(opts.contrast, (v - MIN_V) / (kDown + 0.5)) : 0;
  // a highlight gets lighter by gaining brightness, or by losing saturation when there is none left
  const kUp = Math.max(0, Math.min(opts.steps, Math.floor(((1 - v) + s) / MIN_STEP)));
  const up = kUp ? Math.min(opts.contrast * 0.85, (1 - v) / (kUp + 0.5)) : 0;
  const fade = kUp && up < 0.02 ? Math.min(0.12, s / (kUp + 0.5)) : 0;
  const out: RGB[] = [];
  for (let k = -kDown; k <= kUp; k++) {
    if (k === 0) { out.push([base[0], base[1], base[2]]); continue; }
    const n = Math.abs(k);
    // a grey has no hue to turn; only its brightness changes
    const hh = s < 0.04 ? h : hueToward(h, k < 0 ? 240 : 60, opts.hueShift * n);
    let ss = s < 0.04 ? s : Math.max(0, Math.min(1, s + (k < 0 ? 0.06 : -0.08) * n));
    if (k > 0 && fade) ss = Math.max(0, s - fade * n);
    const vv = k < 0 ? Math.max(MIN_V, v - down * n) : Math.min(1, v + up * n);
    out.push(hsvToRgb(hh, ss, vv));
  }
  return out;
}

const sameRgb = (a: RGB, b: RGB) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/**
 * The color one step lighter (dir 1) or darker (dir -1) than \`c\` in the first
 * ramp that contains it, or null when no ramp has it or it is already at the end.
 * Ramps go from dark to light.
 */
export function shadeColor(c: RGB, ramps: RGB[][], dir: 1 | -1): RGB | null {
  for (const ramp of ramps) {
    const i = ramp.findIndex((r) => sameRgb(r, c));
    if (i < 0) continue;
    const j = i + dir;
    return j >= 0 && j < ramp.length ? ramp[j] : null;
  }
  return null;
}

/** A palette ready for snapping: the colors and their Lab values. */
export interface SnapPalette { rgb: RGB[]; lab: Lab[]; cache: Map<number, RGB> }
export const snapPalette = (cols: RGB[]): SnapPalette => ({ rgb: cols, lab: cols.map(labOf), cache: new Map() });

/** The palette color that looks closest to \`c\`. */
export function nearestColor(c: RGB, p: SnapPalette): RGB {
  const key = keyOf(c[0], c[1], c[2]);
  const hit = p.cache.get(key);
  if (hit) return hit;
  const l = labOf(c);
  let best = 0, bd = Infinity;
  for (let i = 0; i < p.lab.length; i++) {
    const q = p.lab[i];
    const d = (l[0] - q[0]) ** 2 + (l[1] - q[1]) ** 2 + (l[2] - q[2]) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  const out = p.rgb[best];
  p.cache.set(key, out);
  return out;
}

/** Snaps every opaque pixel to the palette (half-transparent pixels become opaque). */
export function snapPixels(px: Uint8ClampedArray, p: SnapPalette): void {
  if (!p.rgb.length) return;
  for (let i = 0; i < px.length; i += 4) {
    if (!px[i + 3]) continue;
    const c = nearestColor([px[i], px[i + 1], px[i + 2]], p);
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  }
}

/** A color swap: each \`from\` color (0xRRGGBB key) is drawn as its \`to\` color. */
export interface Variant { name: string; map: Record<string, string> }

/** Applies a variant's swaps to a copy of the pixels. Keys and values are hex strings (#rrggbb). */
export function applyVariant(px: Uint8ClampedArray, v: Variant): Uint8ClampedArray {
  const out = px.slice();
  const table = new Map<number, RGB>();
  for (const [from, to] of Object.entries(v.map)) {
    const f = parseInt(from.slice(1), 16), t = parseInt(to.slice(1), 16);
    if (Number.isFinite(f) && Number.isFinite(t)) table.set(f, [(t >> 16) & 255, (t >> 8) & 255, t & 255]);
  }
  if (!table.size) return out;
  for (let i = 0; i < out.length; i += 4) {
    if (!out[i + 3]) continue;
    const to = table.get((out[i] << 16) | (out[i + 1] << 8) | out[i + 2]);
    if (to) { out[i] = to[0]; out[i + 1] = to[1]; out[i + 2] = to[2]; }
  }
  return out;
}
