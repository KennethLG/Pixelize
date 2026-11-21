// The sprites of a GameMaker project, for the "Open from GameMaker" window:
// what each one is (size, frames, layers, folder) and a small picture, read
// in the background a few at a time. Reading a big project is slow, so every
// sprite is cached in IndexedDB and read again only when its .yy or its first
// frame changed on disk. Also opens a sprite into the editor, with its layers.

import { parseGm, spriteMeta, type GmSpriteMeta } from '../../export/gamemaker';
import type { SpriteDoc } from '../../core/sprite';
import { db, fileAt, SPRITES, type GmProject } from './gmProject';

export interface LibEntry {
  name: string;
  w: number;
  h: number;
  frames: number;
  layers: number;
  folder: string;
  /** the first frame, small */
  thumb: Blob | null;
  /** why it could not be read */
  error?: string;
}

/** A cache row: the entry and the file stamps it was read from. */
interface Cached extends LibEntry { yyStamp: string; frame0: string; pngStamp: string }

const stamp = (f: File) => `${f.lastModified}:${f.size}`;
const THUMB = 96;
const CONCURRENCY = 8;

// ---------- cache ----------

async function loadCache(p: GmProject): Promise<Map<string, Cached>> {
  const out = new Map<string, Cached>();
  try {
    const d = await db();
    const prefix = `${p.key}/`;
    const store = d.transaction(SPRITES).objectStore(SPRITES);
    const r = store.getAll(IDBKeyRange.bound(prefix, `${prefix}￿`));
    const rows = await new Promise<Cached[]>((res) => { r.onsuccess = () => res(r.result as Cached[]); r.onerror = () => res([]); });
    for (const row of rows) out.set(row.name.toLowerCase(), row);
  } catch { /* no cache: everything is read */ }
  return out;
}

/** Writes rows in batches (one transaction each), so indexing does not wait on the disk for every sprite. */
let pending: [string, Cached][] = [];
let flushing: ReturnType<typeof setTimeout> | null = null;
function cachePut(p: GmProject, row: Cached): void {
  pending.push([`${p.key}/${row.name}`, row]);
  if (!flushing) flushing = setTimeout(flush, 400);
}
async function flush(): Promise<void> {
  flushing = null;
  const rows = pending;
  pending = [];
  if (!rows.length) return;
  try {
    const d = await db();
    const tx = d.transaction(SPRITES, 'readwrite');
    for (const [k, v] of rows) tx.objectStore(SPRITES).put(v, k);
  } catch { /* not cached this time */ }
}

/** Forgets every cached sprite of the project (the next listing reads them all again). */
export async function clearCache(p: GmProject): Promise<void> {
  try {
    const d = await db();
    const prefix = `${p.key}/`;
    d.transaction(SPRITES, 'readwrite').objectStore(SPRITES).delete(IDBKeyRange.bound(prefix, `${prefix}￿`));
  } catch { /* nothing cached */ }
}

// ---------- reading ----------

async function decode(file: Blob, w?: number, h?: number): Promise<ImageBitmap> {
  return w && h ? createImageBitmap(file, { resizeWidth: w, resizeHeight: h, resizeQuality: 'pixelated' }) : createImageBitmap(file);
}

async function thumbOf(png: File): Promise<Blob> {
  const bmp = await decode(png);
  const { width: w, height: h } = bmp;
  // small sprites keep their own PNG; big ones get a small copy
  if (w <= THUMB && h <= THUMB) { bmp.close(); return new Blob([await png.arrayBuffer()], { type: 'image/png' }); }
  const k = THUMB / Math.max(w, h);
  const c = new OffscreenCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = true;
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c.convertToBlob({ type: 'image/png' });
}

async function readMeta(p: GmProject, name: string): Promise<{ meta: GmSpriteMeta; yy: File } | null> {
  const yy = await fileAt(p.dir, `sprites/${name}/${name}.yy`);
  if (!yy) return null;
  return { meta: spriteMeta(parseGm(await yy.text()), p.gameFps), yy };
}

/** One sprite's entry: from the cache when its files did not change, read from disk otherwise. */
async function entryOf(p: GmProject, name: string, cached: Cached | undefined): Promise<LibEntry> {
  try {
    const yy = await fileAt(p.dir, `sprites/${name}/${name}.yy`);
    if (!yy) return { name, w: 0, h: 0, frames: 0, layers: 0, folder: '', thumb: null, error: 'The .yy file is missing.' };
    if (cached && cached.yyStamp === stamp(yy)) {
      const png = cached.frame0 ? await fileAt(p.dir, `sprites/${name}/${cached.frame0}.png`) : null;
      if (!cached.frame0 || (png && stamp(png) === cached.pngStamp)) return cached;
    }
    const meta = spriteMeta(parseGm(await yy.text()), p.gameFps);
    const frame0 = meta.frames[0] ?? '';
    const png = frame0 ? await fileAt(p.dir, `sprites/${name}/${frame0}.png`) : null;
    const row: Cached = {
      name, w: meta.w, h: meta.h, frames: meta.frames.length, layers: meta.layers.length, folder: meta.folder,
      thumb: png ? await thumbOf(png) : null, yyStamp: stamp(yy), frame0, pngStamp: png ? stamp(png) : '',
    };
    cachePut(p, row);
    return row;
  } catch (e) {
    return { name, w: 0, h: 0, frames: 0, layers: 0, folder: cached?.folder ?? '', thumb: null, error: (e as Error).message || 'Could not read it.' };
  }
}

export interface Indexer {
  /** reads these sprites next (the ones the filter shows) */
  prioritize(names: string[]): void;
  stop(): void;
}

/**
 * Lists the project's sprites. Cached entries come at once (`onEntries`), then
 * every sprite is checked against its files in the background, a few at a time,
 * and changed or new ones come as they are read. `onDone` fires at the end.
 */
export function indexProject(p: GmProject, onEntries: (list: LibEntry[], checked: number) => void, onDone: () => void): Indexer {
  let stopped = false;
  let queue = [...p.spriteNames];
  const found = new Map<string, LibEntry>();
  let checked = 0;
  let dirty = false;
  // updates go out a few times a second, not once per sprite
  const tick = setInterval(() => { if (dirty) { dirty = false; onEntries([...found.values()], checked); } }, 150);

  (async () => {
    const cache = await loadCache(p);
    for (const n of p.spriteNames) {
      const c = cache.get(n.toLowerCase());
      found.set(n, c ?? { name: n, w: 0, h: 0, frames: 0, layers: 0, folder: '', thumb: null });
    }
    onEntries([...found.values()], 0);
    const worker = async () => {
      while (!stopped && queue.length) {
        const n = queue.shift()!;
        const e = await entryOf(p, n, cache.get(n.toLowerCase()));
        if (stopped) return;
        found.set(n, e);
        checked++;
        dirty = true;
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (stopped) return;
    await flush();
    clearInterval(tick);
    onEntries([...found.values()], checked);
    onDone();
  })().catch(() => { clearInterval(tick); onDone(); });

  return {
    prioritize(names) {
      const first = new Set(names);
      queue = [...queue.filter((n) => first.has(n)), ...queue.filter((n) => !first.has(n))];
    },
    stop() { stopped = true; clearInterval(tick); },
  };
}

// ---------- opening ----------

async function pixels(file: File | null, w: number, h: number): Promise<Uint8ClampedArray> {
  if (!file) return new Uint8ClampedArray(w * h * 4);
  const bmp = await decode(file);
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  bmp.close();
  return g.getImageData(0, 0, w, h).data;
}

/**
 * A GameMaker sprite as an editor document: its layers (bottom first, as the
 * editor keeps them), frames and speed. `maxSide` refuses sprites too big to edit.
 */
export async function loadGmSprite(p: GmProject, name: string, maxSide: number): Promise<SpriteDoc> {
  const got = await readMeta(p, name);
  if (!got) throw new Error(`${name} has no .yy file.`);
  const { meta } = got;
  if (meta.w > maxSide || meta.h > maxSide) throw new Error(`${name} is ${meta.w}×${meta.h}: too big for the sprite editor (max ${maxSide} px).`);
  if (!meta.frames.length) throw new Error(`${name} has no frames.`);
  const dir = `sprites/${name}`;
  const layers = [...meta.layers].reverse();
  const doc: SpriteDoc = {
    w: meta.w, h: meta.h, tags: [], variants: [],
    layers: layers.length
      ? layers.map((l) => ({ name: l.name, visible: l.visible, opacity: Math.max(0, Math.min(1, l.opacity / 100)) }))
      : [{ name: 'Layer 1', visible: true, opacity: 1 }],
    frames: [],
  };
  for (const fid of meta.frames) {
    const cels = layers.length
      ? await Promise.all(layers.map(async (l) => {
        const f = await fileAt(p.dir, `${dir}/layers/${fid}/${l.id}.png`);
        // an old sprite may lack its layer files; with one layer the frame itself is that layer
        const src = f ?? (layers.length === 1 ? await fileAt(p.dir, `${dir}/${fid}.png`) : null);
        return { w: meta.w, h: meta.h, px: await pixels(src, meta.w, meta.h) };
      }))
      : [{ w: meta.w, h: meta.h, px: await pixels(await fileAt(p.dir, `${dir}/${fid}.png`), meta.w, meta.h) }];
    doc.frames.push({ cels, duration: meta.frameMs });
  }
  return doc;
}
