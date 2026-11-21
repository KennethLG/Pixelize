// The Export window's options and what they turn into: which frames each
// exported file or GameMaker sprite holds, at what speed, and their pixels.
// The window previews exactly what runExport writes.

import { playbackSequence } from '../../core/frames';
import { applyVariant, type Variant } from '../../core/shading';
import {
  evenTiming, fpsFor, gmName, spriteFiles, type GmOrigin, type GmSprite,
} from '../../export/gamemaker';
import { canvasBytes } from '../downloads';
import { setStatus } from '../dom';
import { exportGif, exportPng, exportRange, exportStrip, framePixels } from './io';
import { readSprite, writeSprite, type GmProject } from './gmProject';
import { commitFloating, sp } from './state';

export type ExportFormat = 'png' | 'strip' | 'gif' | 'gamemaker';

export interface ExportOptions {
  format: ExportFormat;
  scale: number;
  /** all frames, or a tag by index */
  tag: number | null;
  /** a color variant by index, or the original */
  variant: number | null;
  /** GameMaker: one sprite per tag */
  perTag: boolean;
  /** GameMaker: repeat long frames so the timing survives one speed */
  evenTiming: boolean;
  /** GameMaker: keep the sprite's own origin (bottom centre for a new one), a preset, or a point */
  origin: 'keep' | GmOrigin | 'custom';
  originX: number;
  originY: number;
  /** GameMaker: asset folder path for new sprites */
  folder: string | null;
}

const KEY = 'pixelize.export.v1';
const DEFAULTS: ExportOptions = {
  format: 'png', scale: 1, tag: null, variant: null, perTag: false, evenTiming: false, origin: 'keep', originX: 0, originY: 0, folder: null,
};

/** The last options used (per viewer); the tag and variant are checked against the open sprite. */
export function loadOptions(): ExportOptions {
  let o = { ...DEFAULTS };
  try { o = { ...o, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { /* defaults */ }
  if (o.tag !== null && !sp.doc.tags[o.tag]) o.tag = null;
  if (o.variant !== null && !sp.doc.variants[o.variant]) o.variant = null;
  return o;
}

export function saveOptions(o: ExportOptions): void {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* not remembered */ }
}

/** A GameMaker name for the open sprite: sprWalk for "walk". */
export function defaultGmName(): string {
  if (sp.gmName) return sp.gmName;
  const n = gmName(sp.name);
  return /^spr/i.test(n) ? n : `spr${n[0].toUpperCase()}${n.slice(1)}`;
}

/** One exported thing: a file, or a GameMaker sprite. `frames` are frame indices in play order. */
export interface Planned {
  name: string;
  frames: number[];
  /** how long each shown frame lasts, in ms (GameMaker: all the same) */
  durations: number[];
  fps: number;
  /** GameMaker: frames had different lengths and play at one speed now */
  uneven: boolean;
}

const variantOf = (o: ExportOptions): Variant | null => (o.variant === null ? null : sp.doc.variants[o.variant] ?? null);

export function plan(o: ExportOptions, gmBase: string): Planned[] {
  const d = sp.doc;
  const dur = d.frames.map((f) => f.duration);
  if (o.format === 'png') return [{ name: sp.name, frames: [sp.frame], durations: [dur[sp.frame]], fps: 0, uneven: false }];
  const r = exportRange(o.tag);
  if (o.format === 'strip') return [{ name: r.name, frames: r.frames, durations: r.frames.map((i) => dur[i]), fps: 0, uneven: false }];
  if (o.format === 'gif') {
    const seq = playbackSequence(r.frames, r.dir, false);
    return [{ name: r.name, frames: seq, durations: seq.map((i) => dur[i]), fps: 0, uneven: false }];
  }
  // GameMaker plays a sprite forward at one speed: directions are written out frame by frame
  const runs = o.perTag && d.tags.length
    ? d.tags.map((t) => ({ name: gmName(`${gmBase}_${t.name}`), frames: playbackSequence(d.frames.map((_, i) => i).slice(t.from, t.to + 1), t.dir, false) }))
    : [{ name: gmName(gmBase), frames: playbackSequence(r.frames, r.dir, false) }];
  return runs.map(({ name, frames }) => {
    const { fps, even } = fpsFor(frames.map((i) => dur[i]));
    if (o.evenTiming && !even) {
      const t = evenTiming(frames, dur);
      return { name, frames: t.frames, durations: t.frames.map(() => 1000 / t.fps), fps: t.fps, uneven: false };
    }
    return { name, frames, durations: frames.map(() => 1000 / fps), fps, uneven: !even };
  });
}

// ---------- pixels ----------

function scalePx(px: Uint8ClampedArray, w: number, h: number, s: number): Uint8ClampedArray {
  if (s === 1) return px;
  const W = w * s, out = new Uint8ClampedArray(W * h * s * 4);
  for (let y = 0; y < h * s; y++) {
    for (let x = 0; x < W; x++) {
      const p = ((Math.floor(y / s) * w) + Math.floor(x / s)) * 4;
      out.set(px.subarray(p, p + 4), (y * W + x) * 4);
    }
  }
  return out;
}

/** A frame as it exports, scaled, with the chosen colors. */
export const exportFrame = (fi: number, o: ExportOptions) => scalePx(framePixels(fi, variantOf(o)), sp.doc.w, sp.doc.h, clampScale(o.scale));

/** The layers GameMaker gets (reference layers stay out), top first as GameMaker lists them. */
export const gmLayers = () => sp.doc.layers.map((_, i) => i).filter((i) => !sp.doc.layers[i].ref).reverse();

function layerPixels(fi: number, li: number, o: ExportOptions): Uint8ClampedArray {
  const v = variantOf(o), px = sp.doc.frames[fi].cels[li].px;
  return scalePx(v ? applyVariant(px, v) : px, sp.doc.w, sp.doc.h, clampScale(o.scale));
}

export const clampScale = (s: number) => Math.max(1, Math.min(64, Math.round(s) || 1));

/** The GameMaker sprite for a planned run, ready to turn into files. */
export function gmSprite(p: Planned, o: ExportOptions, project: GmProject | null): GmSprite {
  const s = clampScale(o.scale);
  const layers = gmLayers();
  const folder = project?.folders.find((f) => f.path === o.folder) ?? null;
  return {
    name: p.name,
    w: sp.doc.w * s,
    h: sp.doc.h * s,
    fps: p.fps,
    layers: layers.map((li) => ({ name: sp.doc.layers[li].name, visible: sp.doc.layers[li].visible, opacity: sp.doc.layers[li].opacity * 100 })),
    // a frame repeated for its timing is written once per showing
    frames: p.frames.map((fi) => ({ composite: exportFrame(fi, o), layers: layers.map((li) => layerPixels(fi, li, o)) })),
    origin: o.origin === 'keep' ? null : o.origin === 'custom' ? [Math.round(o.originX), Math.round(o.originY)] : o.origin,
    folder,
  };
}

async function png(px: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.putImageData(new ImageData(px, w, h), 0, 0);
  return canvasBytes(c);
}

/** Does the export the options describe. */
export async function runExport(o: ExportOptions, gmBase: string, project: GmProject | null): Promise<void> {
  commitFloating();
  const v = variantOf(o);
  if (o.format === 'png') return exportPng(o.scale, v);
  if (o.format === 'strip') return exportStrip(o.scale, o.tag, v);
  if (o.format === 'gif') return exportGif(o.scale, o.tag, v);
  if (!project) throw new Error('Pick the GameMaker project folder first.');
  const done: string[] = [];
  for (const p of plan(o, gmBase)) {
    setStatus(`Writing ${p.name}…`);
    const existing = await readSprite(project, p.name);
    await writeSprite(project, p.name, await spriteFiles(gmSprite(p, o, project), png, existing));
    done.push(existing ? `${p.name} (updated)` : p.name);
  }
  setStatus(`Sent to ${project.name}: ${done.join(', ')}. Reopen the project in GameMaker if it was open.`);
}
