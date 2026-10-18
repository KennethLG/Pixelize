// Parts: layers that are posed instead of redrawn. A part keeps its art at
// rest (`src`), a pivot (the joint it turns around) and maybe a parent part.
// Each frame can pose it (an offset and an angle, relative to its parent);
// the frame's cel is then drawn from the rest art with RotSprite. A frame
// without a pose for a part is free: its cel is ordinary pixels.
//
// Cels always hold the drawn result, so compositing, exports and thumbnails
// do not need to know about parts. syncParts() notices cels the user painted
// on: in the rest pose the change becomes the new rest art (and reaches every
// posed frame); in any other pose that frame stops being posed.

import { blit, newBitmap, type Bitmap } from './bitmap';
import { rotsprite } from './rotsprite';
import type { SpriteDoc } from './sprite';

export interface Part { id: string; pivot: [number, number]; parent: string | null; src: Bitmap }
/** Offset (pixels) and turn (degrees, clockwise) of a part in one frame, relative to its parent. */
export interface Pose { x: number; y: number; angle: number }
export const REST: Pose = { x: 0, y: 0, angle: 0 };

/** A turn plus a shift: p → R(a)·p + t. */
interface Affine { a: number; tx: number; ty: number }
const ID: Affine = { a: 0, tx: 0, ty: 0 };

function rot(a: number, x: number, y: number): [number, number] {
  const r = (a * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [x * c - y * s, x * s + y * c];
}
const apply = (m: Affine, x: number, y: number): [number, number] => { const [X, Y] = rot(m.a, x, y); return [X + m.tx, Y + m.ty]; };
const compose = (m1: Affine, m2: Affine): Affine => { const [x, y] = rot(m1.a, m2.tx, m2.ty); return { a: m1.a + m2.a, tx: x + m1.tx, ty: y + m1.ty }; };
const invert = (m: Affine): Affine => { const [x, y] = rot(-m.a, m.tx, m.ty); return { a: -m.a, tx: -x, ty: -y }; };
/** A pose turns around the pivot, then shifts. */
function poseAffine(p: Pose, pv: [number, number]): Affine {
  const [x, y] = rot(p.angle, pv[0], pv[1]);
  return { a: p.angle, tx: pv[0] + p.x - x, ty: pv[1] + p.y - y };
}
function affinePose(m: Affine, pv: [number, number]): Pose {
  const [x, y] = apply(m, pv[0], pv[1]);
  return { x: x - pv[0], y: y - pv[1], angle: ((m.a % 360) + 360) % 360 };
}

export const partOf = (d: SpriteDoc, li: number): Part | undefined => d.layers[li]?.part;
const layerOf = (d: SpriteDoc, id: string | null) => (id ? d.layers.findIndex((l) => l.part?.id === id) : -1);
export const poseOf = (d: SpriteDoc, fi: number, li: number): Pose | undefined => {
  const p = partOf(d, li);
  return p ? d.frames[fi]?.poses?.[p.id] : undefined;
};

/** Where a part is in a frame: its pose combined with its parents' (a missing parent pose counts as rest). */
function world(d: SpriteDoc, fi: number, li: number, depth = 0): Affine {
  const p = partOf(d, li);
  if (!p || depth > 64) return ID;
  const local = poseAffine(d.frames[fi].poses?.[p.id] ?? REST, p.pivot);
  const pi = layerOf(d, p.parent);
  return pi < 0 ? local : compose(world(d, fi, pi, depth + 1), local);
}

/** The pivot of a part in a frame, in canvas pixels, and its total turn. */
export function jointOf(d: SpriteDoc, fi: number, li: number): { x: number; y: number; angle: number } {
  const p = partOf(d, li)!, m = world(d, fi, li);
  const [x, y] = apply(m, p.pivot[0], p.pivot[1]);
  return { x, y, angle: m.a };
}

/** The total turn of a part's parent chain (0 without a parent). */
export function parentAngle(d: SpriteDoc, fi: number, li: number): number {
  const pi = layerOf(d, partOf(d, li)?.parent ?? null);
  return pi < 0 ? 0 : world(d, fi, pi).a;
}

/** A canvas point in the part's rest art (undoing its pose in this frame). */
export function toRest(d: SpriteDoc, fi: number, li: number, x: number, y: number): [number, number] {
  return apply(invert(world(d, fi, li)), x, y);
}

// ---------- drawing ----------

/** Cels drawn from a part, with the hash of what was drawn (to notice later painting). Not saved. */
const drawn = new WeakMap<Bitmap, number>();
function hash(b: Bitmap): number {
  let h = 0x811c9dc5;
  const n = b.px.length;
  for (let i = 0; i < n; i++) h = Math.imul(h ^ b.px[i], 16777619);
  return h >>> 0;
}

/** The rest art cut down to its opaque bounds, cached, so turning stays cheap on big canvases. */
const trimmed = new WeakMap<Bitmap, { piece: Bitmap; x: number; y: number } | null>();
function trim(src: Bitmap): { piece: Bitmap; x: number; y: number } | null {
  if (trimmed.has(src)) return trimmed.get(src)!;
  let x0 = src.w, y0 = src.h, x1 = -1, y1 = -1;
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    if (!src.px[(y * src.w + x) * 4 + 3]) continue;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  let out: { piece: Bitmap; x: number; y: number } | null = null;
  if (x1 >= 0) {
    const piece = newBitmap(x1 - x0 + 1, y1 - y0 + 1);
    for (let y = 0; y < piece.h; y++) piece.px.set(src.px.subarray(((y0 + y) * src.w + x0) * 4, ((y0 + y) * src.w + x1 + 1) * 4), y * piece.w * 4);
    out = { piece, x: x0, y: y0 };
  }
  trimmed.set(src, out);
  return out;
}

/** Draws a posed part into its cel of frame fi (nothing happens for a free frame). */
export function renderPart(d: SpriteDoc, fi: number, li: number): void {
  const p = partOf(d, li), cel = d.frames[fi].cels[li];
  if (!p || !d.frames[fi].poses?.[p.id]) return;
  cel.px.fill(0);
  const t = trim(p.src);
  if (t) {
    const m = world(d, fi, li);
    const [jx, jy] = apply(m, p.pivot[0], p.pivot[1]);
    const ox = Math.round(jx - p.pivot[0]), oy = Math.round(jy - p.pivot[1]);
    const r = rotsprite(t.piece, m.a, p.pivot[0] - t.x, p.pivot[1] - t.y);
    blit(cel, r.piece, t.x + r.x + ox, t.y + r.y + oy);
  }
  drawn.set(cel, hash(cel));
}

/** The part and every part hanging from it, in that order. */
function family(d: SpriteDoc, li: number): number[] {
  const out = [li];
  for (let k = 0; k < out.length; k++) {
    const id = partOf(d, out[k])!.id;
    d.layers.forEach((l, i) => { if (l.part?.parent === id && !out.includes(i)) out.push(i); });
  }
  return out;
}

/** Redraws a part and its children in one frame (after its pose changed). */
export function renderFamily(d: SpriteDoc, fi: number, li: number): void {
  for (const i of family(d, li)) renderPart(d, fi, i);
}

function renderEverywhere(d: SpriteDoc, li: number): void {
  for (let fi = 0; fi < d.frames.length; fi++) renderPart(d, fi, li);
}

/**
 * Looks for posed cels that were painted on since they were drawn. A cel in
 * the rest pose (the part and its parents not moved) gives the part new rest
 * art, redrawn in every posed frame; otherwise that frame becomes free.
 * Returns whether anything changed.
 */
export function syncParts(d: SpriteDoc): boolean {
  let changed = false;
  d.layers.forEach((l, li) => {
    const p = l.part;
    if (!p) return;
    let newSrc = false;
    d.frames.forEach((f, fi) => {
      if (!f.poses?.[p.id]) return;
      const cel = f.cels[li], was = drawn.get(cel), now = hash(cel);
      if (was === undefined) { drawn.set(cel, now); return; }
      if (was === now) return;
      const m = world(d, fi, li);
      if (!newSrc && Math.abs(m.a % 360) < 1e-9 && Math.abs(m.tx) < 1e-9 && Math.abs(m.ty) < 1e-9) {
        p.src = { w: cel.w, h: cel.h, px: cel.px.slice() };
        newSrc = true;
        drawn.set(cel, now);
      } else {
        delete f.poses[p.id];
      }
      changed = true;
    });
    if (newSrc) renderEverywhere(d, li);
  });
  return changed;
}

// ---------- changing parts ----------

function newId(d: SpriteDoc): string {
  let n = 1;
  while (d.layers.some((l) => l.part?.id === `part${n}`)) n++;
  return `part${n}`;
}

const same = (a: Bitmap, b: Bitmap) => a.px.length === b.px.length && a.px.every((v, i) => v === b.px[i]);

/**
 * Makes layer li a part, with the cel of frame fi as its rest art and its
 * pivot in the middle of the art. Frames whose cel is that same art start in
 * the rest pose; the others stay free.
 */
export function makePart(d: SpriteDoc, li: number, fi: number): Part {
  const src = d.frames[fi].cels[li];
  const t = trim(src);
  const part: Part = {
    id: newId(d),
    pivot: t ? [Math.round((t.x + t.piece.w / 2) * 2) / 2, Math.round((t.y + t.piece.h / 2) * 2) / 2] : [d.w / 2, d.h / 2],
    parent: null,
    src: { w: src.w, h: src.h, px: src.px.slice() },
  };
  d.layers[li].part = part;
  d.frames.forEach((f, i) => {
    if (i !== fi && !same(f.cels[li], src)) return;
    (f.poses ??= {})[part.id] = { ...REST };
    drawn.set(f.cels[li], hash(f.cels[li]));
  });
  return part;
}

/** Changes the pose of a part in a frame and redraws it and its children. */
export function setPose(d: SpriteDoc, fi: number, li: number, pose: Pose): void {
  const p = partOf(d, li);
  if (!p) return;
  (d.frames[fi].poses ??= {})[p.id] = { x: pose.x, y: pose.y, angle: ((pose.angle % 360) + 360) % 360 };
  renderFamily(d, fi, li);
}

/** Leaves frame fi free for this part: its pixels stay, but it no longer follows the pose. */
export function freeFrame(d: SpriteDoc, fi: number, li: number): void {
  const p = partOf(d, li);
  if (p) delete d.frames[fi].poses?.[p.id];
}

/** Rewrites a part's poses so it stays where it is while its parent or pivot changes. */
function keepPlace(d: SpriteDoc, li: number, change: () => void): void {
  const p = partOf(d, li)!;
  const worlds = d.frames.map((f, fi) => (f.poses?.[p.id] ? world(d, fi, li) : null));
  change();
  const pi = layerOf(d, p.parent);
  d.frames.forEach((f, fi) => {
    const m = worlds[fi];
    if (!m) return;
    const local = pi < 0 ? m : compose(invert(world(d, fi, pi)), m);
    f.poses![p.id] = affinePose(local, p.pivot);
  });
}

/** Hangs a part from another one (or from nothing). Loops are refused. */
export function setParent(d: SpriteDoc, li: number, parentId: string | null): boolean {
  const p = partOf(d, li);
  if (!p) return false;
  for (let id = parentId; id; id = partOf(d, layerOf(d, id))?.parent ?? null) if (id === p.id) return false;
  if (parentId && layerOf(d, parentId) < 0) return false;
  keepPlace(d, li, () => { p.parent = parentId; });
  return true;
}

/** Moves a part's pivot (in rest coordinates). Poses are rewritten so nothing moves. */
export function setPivot(d: SpriteDoc, li: number, pivot: [number, number]): void {
  const p = partOf(d, li);
  if (p) keepPlace(d, li, () => { p.pivot = pivot; });
}

/** Parts that may be the parent of layer li (not itself, not its own children). */
export function parentChoices(d: SpriteDoc, li: number): number[] {
  const mine = new Set(family(d, li));
  return d.layers.flatMap((l, i) => (l.part && !mine.has(i) ? [i] : []));
}

/** Turns a part back into a plain layer. Its cels keep their pixels; its children keep their place. */
export function bakePart(d: SpriteDoc, li: number): void {
  const p = partOf(d, li);
  if (!p) return;
  d.layers.forEach((l, i) => { if (l.part?.parent === p.id) setParent(d, i, p.parent); });
  for (const f of d.frames) delete f.poses?.[p.id];
  delete d.layers[li].part;
}

/** Moves every posed part of a frame by dx, dy (parts without a parent; the others follow) and redraws them. */
export function shiftPoses(d: SpriteDoc, fi: number, dx: number, dy: number): void {
  const poses = d.frames[fi].poses;
  if (!poses) return;
  d.layers.forEach((l, li) => {
    const p = l.part;
    if (!p || p.parent || !poses[p.id]) return;
    poses[p.id].x += dx;
    poses[p.id].y += dy;
    renderFamily(d, fi, li);
  });
}

// ---------- helpers for the document functions in sprite.ts ----------

export const clonePart = (p: Part): Part => ({ id: p.id, pivot: [p.pivot[0], p.pivot[1]], parent: p.parent, src: { w: p.src.w, h: p.src.h, px: p.src.px.slice() } });
export const clonePoses = (poses?: Record<string, Pose>) => (poses ? Object.fromEntries(Object.entries(poses).map(([k, v]) => [k, { ...v }])) : undefined);

/** A duplicated layer's part gets its own id and the same poses. */
export function duplicatePart(d: SpriteDoc, from: number, to: number): void {
  const p = partOf(d, from);
  if (!p) return;
  const copy = { ...clonePart(p), id: newId(d) };
  d.layers[to].part = copy;
  for (const f of d.frames) if (f.poses?.[p.id]) f.poses[copy.id] = { ...f.poses[p.id] };
}

/** Before a layer goes away: its children lose their parent but keep their place, its poses go. */
export function forgetPart(d: SpriteDoc, li: number): void {
  bakePart(d, li);
}
