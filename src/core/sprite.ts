// The sprite document: a canvas size, layers (bottom first) and frames. Each
// frame holds one cel (a bitmap) per layer, in the same order as `layers`.

import { flip, newBitmap, scaleNearest, type Bitmap } from './bitmap';
import type { Direction } from './frames';
import { bakePart, clonePart, clonePoses, duplicatePart, forgetPart, type Part, type Pose } from './parts';
import type { Variant } from './shading';

/**
 * A reference layer is shown while drawing but left out of exports and of the
 * colors in use. A layer with a part is posed frame by frame (core/parts.ts).
 */
export interface Layer { name: string; visible: boolean; opacity: number; ref?: boolean; part?: Part }
/** `poses` holds the pose of each part (by part id) in this frame; parts without one are free here. */
export interface Frame { cels: Bitmap[]; duration: number; poses?: Record<string, Pose> }
/** A named run of frames (idle, walk…) with its own playback direction. `from`/`to` are frame indices, both included. */
export interface Tag { name: string; from: number; to: number; dir: Direction; color: string }
/** `variants` are color swaps of the whole sprite (red team, blue team…), see core/shading.ts. */
export interface SpriteDoc { w: number; h: number; layers: Layer[]; frames: Frame[]; tags: Tag[]; variants: Variant[] }

export const TAG_COLORS = ['#d9732b', '#3f9a6a', '#4a7fd6', '#b0479d', '#c9a227', '#3fa3b8'];

export const DEFAULT_DURATION = 100; // ms

export function createDoc(w: number, h: number): SpriteDoc {
  return { w, h, layers: [{ name: 'Layer 1', visible: true, opacity: 1 }], frames: [{ cels: [newBitmap(w, h)], duration: DEFAULT_DURATION }], tags: [], variants: [] };
}

export const cloneDoc = (d: SpriteDoc): SpriteDoc => ({
  w: d.w, h: d.h,
  layers: d.layers.map((l) => (l.part ? { ...l, part: clonePart(l.part) } : { ...l })),
  frames: d.frames.map((f) => withPoses({ duration: f.duration, cels: f.cels.map((c) => ({ w: c.w, h: c.h, px: c.px.slice() })) }, f.poses)),
  tags: (d.tags || []).map((t) => ({ ...t })),
  variants: (d.variants || []).map((v) => ({ name: v.name, map: { ...v.map } })),
});

/** Adds a copy of `poses` to a frame, when there are any. */
function withPoses(f: Frame, poses?: Record<string, Pose>): Frame {
  const p = clonePoses(poses);
  if (p && Object.keys(p).length) f.poses = p;
  return f;
}

const move = <T>(arr: T[], from: number, to: number) => { const [x] = arr.splice(from, 1); arr.splice(to, 0, x); };

/** A name like "Layer 3" that no layer uses yet. */
export function nextLayerName(d: SpriteDoc): string {
  let n = d.layers.length + 1;
  while (d.layers.some((l) => l.name === `Layer ${n}`)) n++;
  return `Layer ${n}`;
}

// ---------- layers ----------

export function addLayer(d: SpriteDoc, at: number, name = nextLayerName(d)): void {
  d.layers.splice(at, 0, { name, visible: true, opacity: 1 });
  for (const f of d.frames) f.cels.splice(at, 0, newBitmap(d.w, d.h));
}

export function duplicateLayer(d: SpriteDoc, i: number): void {
  d.layers.splice(i + 1, 0, { ...d.layers[i], name: `${d.layers[i].name} copy` });
  for (const f of d.frames) f.cels.splice(i + 1, 0, { w: d.w, h: d.h, px: f.cels[i].px.slice() });
  duplicatePart(d, i, i + 1);
}

export function removeLayer(d: SpriteDoc, i: number): boolean {
  if (d.layers.length < 2) return false;
  forgetPart(d, i);
  d.layers.splice(i, 1);
  for (const f of d.frames) f.cels.splice(i, 1);
  return true;
}

export function moveLayer(d: SpriteDoc, from: number, to: number): void {
  if (from === to) return;
  move(d.layers, from, to);
  for (const f of d.frames) move(f.cels, from, to);
}

/** Draws layer i onto the layer below it (in every frame) and removes it. */
export function mergeDown(d: SpriteDoc, i: number): boolean {
  if (i < 1) return false;
  const top = d.layers[i];
  // merged pixels are plain pixels: the layer below stops being a part
  bakePart(d, i - 1);
  for (const f of d.frames) {
    const below = f.cels[i - 1];
    if (top.visible) blendOver(below.px, f.cels[i].px, top.opacity);
  }
  removeLayer(d, i);
  return true;
}

// ---------- frames ----------
// Tags follow their frames: inserting inside a tag grows it, removing shrinks it.

/** Tags after inserting a frame at index `at`. */
function tagsInsert(d: SpriteDoc, at: number): void {
  for (const t of d.tags) {
    if (at <= t.from) { t.from++; t.to++; }
    else if (at <= t.to) t.to++;
  }
}

export function addFrame(d: SpriteDoc, at: number): void {
  d.frames.splice(at, 0, { cels: d.layers.map(() => newBitmap(d.w, d.h)), duration: d.frames[Math.max(0, at - 1)]?.duration ?? DEFAULT_DURATION });
  tagsInsert(d, at);
}

export function duplicateFrame(d: SpriteDoc, i: number): void {
  const f = d.frames[i];
  d.frames.splice(i + 1, 0, withPoses({ duration: f.duration, cels: f.cels.map((c) => ({ w: c.w, h: c.h, px: c.px.slice() })) }, f.poses));
  // the copy belongs to the same tags as its original
  for (const t of d.tags) {
    if (t.from > i) t.from++;
    if (t.to >= i) t.to++;
  }
}

export function removeFrame(d: SpriteDoc, i: number): boolean {
  if (d.frames.length < 2) return false;
  d.frames.splice(i, 1);
  d.tags = d.tags.filter((t) => {
    if (t.from > i) t.from--;
    if (t.to >= i) t.to--;
    return t.to >= t.from;
  });
  return true;
}

export function moveFrame(d: SpriteDoc, from: number, to: number): void {
  if (from === to) return;
  move(d.frames, from, to);
  // where the frame that was at index k is now
  const map = (k: number) => {
    if (k === from) return to;
    if (from < to && k > from && k <= to) return k - 1;
    if (from > to && k >= to && k < from) return k + 1;
    return k;
  };
  for (const t of d.tags) {
    const a = map(t.from), b = map(t.to);
    t.from = Math.min(a, b);
    t.to = Math.max(a, b);
  }
}

/** The tag that frame `fi` belongs to (the first one, when tags overlap). */
export const tagAt = (d: SpriteDoc, fi: number): Tag | null => d.tags.find((t) => fi >= t.from && fi <= t.to) ?? null;

export function addTag(d: SpriteDoc, from: number, to: number, name?: string): Tag {
  const t: Tag = { name: name || `Tag ${d.tags.length + 1}`, from: Math.min(from, to), to: Math.max(from, to), dir: 'forward', color: TAG_COLORS[d.tags.length % TAG_COLORS.length] };
  d.tags.push(t);
  return t;
}

/**
 * Adds left/right mirrored copies of frames `from`–`to` after the last
 * frame (a walk to the right becomes a walk to the left). When the range is
 * exactly a tag, the copies get their own tag. Returns the new frames' range.
 */
export function mirrorFrames(d: SpriteDoc, from: number, to: number): [number, number] {
  const start = d.frames.length;
  for (let i = from; i <= to; i++) {
    const f = d.frames[i];
    d.frames.push({ duration: f.duration, cels: f.cels.map((c) => flip(c, true)) });
  }
  const end = d.frames.length - 1;
  const tag = d.tags.find((t) => t.from === from && t.to === to);
  if (tag) d.tags.push({ ...tag, name: `${tag.name} mirrored`, from: start, to: end, color: TAG_COLORS[d.tags.length % TAG_COLORS.length] });
  return [start, end];
}

/** A cel moved by dx, dy pixels; what leaves the canvas is cut. */
export function translateBitmap(b: Bitmap, dx: number, dy: number): Bitmap {
  const out = newBitmap(b.w, b.h);
  for (let y = 0; y < b.h; y++) {
    const Y = y + dy;
    if (Y < 0 || Y >= b.h) continue;
    for (let x = 0; x < b.w; x++) {
      const X = x + dx;
      if (X >= 0 && X < b.w) out.px.set(b.px.subarray((y * b.w + x) * 4, (y * b.w + x) * 4 + 4), (Y * b.w + X) * 4);
    }
  }
  return out;
}

// ---------- canvas size ----------

/** Changes the canvas size. ax/ay (0, 0.5 or 1) say which side stays put: 0.5 keeps the art centered. */
export function resizeCanvas(d: SpriteDoc, w: number, h: number, ax = 0.5, ay = 0.5): void {
  cropCanvas(d, -Math.round((w - d.w) * ax), -Math.round((h - d.h) * ay), w, h);
}

/** Stretches every cel to w × h (nearest neighbor, so pixels stay crisp). */
export function scaleDoc(d: SpriteDoc, w: number, h: number): void {
  const kx = w / d.w, ky = h / d.h;
  for (const f of d.frames) {
    f.cels = f.cels.map((c) => scaleNearest(c, w, h));
    for (const p of Object.values(f.poses ?? {})) { p.x *= kx; p.y *= ky; }
  }
  for (const l of d.layers) {
    if (!l.part) continue;
    l.part.src = scaleNearest(l.part.src, w, h);
    l.part.pivot = [l.part.pivot[0] * kx, l.part.pivot[1] * ky];
  }
  d.w = w;
  d.h = h;
}

/**
 * New canvas w × h whose top-left corner is at (x0, y0) of the old one. The
 * art keeps its pixel size: what falls outside is cut, new space is transparent.
 */
export function cropCanvas(d: SpriteDoc, x0: number, y0: number, w: number, h: number): void {
  const dx = -x0, dy = -y0;
  const cut = (c: Bitmap) => {
    const out = newBitmap(w, h);
    for (let y = 0; y < c.h; y++) {
      const Y = y + dy;
      if (Y < 0 || Y >= h) continue;
      for (let x = 0; x < c.w; x++) {
        const X = x + dx;
        if (X >= 0 && X < w) out.px.set(c.px.subarray((y * c.w + x) * 4, (y * c.w + x) * 4 + 4), (Y * w + X) * 4);
      }
    }
    return out;
  };
  for (const f of d.frames) f.cels = f.cels.map(cut);
  // parts move with the art; their poses are relative, so they stay as they are
  for (const l of d.layers) {
    if (!l.part) continue;
    l.part.src = cut(l.part.src);
    l.part.pivot = [l.part.pivot[0] + dx, l.part.pivot[1] + dy];
  }
  d.w = w;
  d.h = h;
}

// ---------- compositing ----------

/** Source-over blend of `src` onto `dst` (same size), with an extra opacity. */
export function blendOver(dst: Uint8ClampedArray, src: Uint8ClampedArray, opacity = 1): void {
  for (let i = 0; i < src.length; i += 4) {
    const sa = (src[i + 3] / 255) * opacity;
    if (sa <= 0) continue;
    const da = dst[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    for (let k = 0; k < 3; k++) dst[i + k] = (src[i + k] * sa + dst[i + k] * da * (1 - sa)) / oa;
    dst[i + 3] = oa * 255;
  }
}

/**
 * The visible image of frame `fi`. `override` swaps one layer's cel for
 * another bitmap (the editor uses it to show a selection being moved).
 * Exports pass `refs: false` to leave reference layers out.
 */
export function composite(d: SpriteDoc, fi: number, override?: { layer: number; cel: Bitmap } | null, opts: { refs?: boolean } = {}): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d.w * d.h * 4);
  const f = d.frames[fi];
  d.layers.forEach((l, li) => {
    if (!l.visible || l.opacity <= 0 || (l.ref && opts.refs === false)) return;
    const cel = override && override.layer === li ? override.cel : f.cels[li];
    blendOver(out, cel.px, l.opacity);
  });
  return out;
}

/** Every opaque color used anywhere in the sprite, as 0xRRGGBB keys, most used first. */
export function usedColors(d: SpriteDoc): number[] {
  const counts = new Map<number, number>();
  for (const f of d.frames) {
    for (const [li, c] of f.cels.entries()) {
      if (d.layers[li]?.ref) continue;
      const px = c.px;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 128) continue;
        const k = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
        counts.set(k, (counts.get(k) || 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
}

// ---------- saving (autosave and project files) ----------

// Parts and poses were added later as optional fields, so older files still open.
interface SavedPart { id: string; pivot: [number, number]; parent: string | null; src: string }
interface SavedLayer { name: string; visible: boolean; opacity: number; ref?: boolean; part?: SavedPart }
interface SavedDoc { v: 1; w: number; h: number; layers: SavedLayer[]; frames: { duration: number; cels: string[]; poses?: Record<string, Pose> }[]; tags?: Tag[]; variants?: Variant[] }

const toB64 = (px: Uint8ClampedArray) => {
  let s = '';
  for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8ClampedArray.from(atob(s), (ch) => ch.charCodeAt(0));

export function serializeDoc(d: SpriteDoc): string {
  const saved: SavedDoc = {
    v: 1, w: d.w, h: d.h,
    layers: d.layers.map((l) => (l.part ? { ...l, part: { id: l.part.id, pivot: l.part.pivot, parent: l.part.parent, src: toB64(l.part.src.px) } } : l) as SavedLayer),
    frames: d.frames.map((f) => ({ duration: f.duration, cels: f.cels.map((c) => toB64(c.px)), ...(f.poses && Object.keys(f.poses).length ? { poses: f.poses } : {}) })),
    tags: d.tags, variants: d.variants,
  };
  return JSON.stringify(saved);
}

const DIRS: Direction[] = ['forward', 'reverse', 'pingpong'];
function parseTags(tags: unknown, n: number): Tag[] {
  if (!Array.isArray(tags)) return [];
  return tags.flatMap((t: Partial<Tag>) => {
    const from = Math.max(0, Math.round(Number(t.from))), to = Math.min(n - 1, Math.round(Number(t.to)));
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return [];
    return [{ name: String(t.name ?? 'Tag'), from, to, dir: DIRS.includes(t.dir as Direction) ? t.dir as Direction : 'forward', color: /^#[0-9a-f]{6}$/i.test(String(t.color)) ? String(t.color) : TAG_COLORS[0] }];
  });
}

function parseVariants(vs: unknown): Variant[] {
  if (!Array.isArray(vs)) return [];
  const isHex = (h: unknown) => typeof h === 'string' && /^#[0-9a-f]{6}$/i.test(h);
  return vs.map((v: Partial<Variant>) => ({
    name: String(v.name ?? 'Variant'),
    map: Object.fromEntries(Object.entries(v.map ?? {}).filter(([f, t]) => isHex(f) && isHex(t))),
  }));
}

function parsePart(p: SavedPart, src: Bitmap): Part {
  const pv = Array.isArray(p.pivot) && p.pivot.every((v) => Number.isFinite(v)) ? p.pivot : [src.w / 2, src.h / 2];
  return { id: p.id, pivot: [pv[0], pv[1]], parent: typeof p.parent === 'string' ? p.parent : null, src };
}

export function parseDoc(text: string): SpriteDoc | null {
  try {
    const s = JSON.parse(text) as SavedDoc;
    if (s.v !== 1 || !(s.w > 0) || !(s.h > 0) || !s.layers?.length || !s.frames?.length) return null;
    const size = s.w * s.h * 4;
    const bitmap = (b64?: string) => {
      const px = b64 ? fromB64(b64) : new Uint8ClampedArray(size);
      return { w: s.w, h: s.h, px: px.length === size ? px : new Uint8ClampedArray(size) };
    };
    const layers: Layer[] = s.layers.map((l) => ({
      name: String(l.name), visible: l.visible !== false, opacity: Number.isFinite(+l.opacity) ? Math.max(0, Math.min(1, +l.opacity)) : 1,
      ...(l.ref ? { ref: true } : {}),
      ...(l.part && typeof l.part.id === 'string' ? { part: parsePart(l.part, bitmap(l.part.src)) } : {}),
    }));
    const ids = new Set(layers.flatMap((l) => (l.part ? [l.part.id] : [])));
    for (const l of layers) if (l.part?.parent && !ids.has(l.part.parent)) l.part.parent = null;
    const frames: Frame[] = s.frames.map((f) => {
      const frame: Frame = { duration: f.duration || DEFAULT_DURATION, cels: s.layers.map((_, i) => bitmap(f.cels[i])) };
      const poses = Object.entries(f.poses ?? {}).filter(([id, p]) => ids.has(id) && [p?.x, p?.y, p?.angle].every((v) => Number.isFinite(v)));
      if (poses.length) frame.poses = Object.fromEntries(poses.map(([id, p]) => [id, { x: p.x, y: p.y, angle: p.angle }]));
      return frame;
    });
    return { w: s.w, h: s.h, layers, frames, tags: parseTags(s.tags, frames.length), variants: parseVariants(s.variants) };
  } catch {
    return null;
  }
}
