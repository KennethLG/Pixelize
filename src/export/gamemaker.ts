// GameMaker (2023+, ".yy v2") sprite assets: a sprite is a folder
// sprites/<name>/ with <name>.yy (JSON with trailing commas), one PNG per frame
// (the frame as it looks) and layers/<frameId>/<layerId>.png (each layer of each
// frame), and an entry in the project's .yyp. GameMaker lists layers top first.
// Pure: no DOM; the caller encodes the PNGs and writes the files.

/** A layer as GameMaker shows it. `opacity` is 0..100. */
export interface GmLayer { name: string; visible: boolean; opacity: number }

/** One frame: the picture as it looks, and each layer's pixels (same order as `layers`, top first). */
export interface GmFrame { composite: Uint8ClampedArray; layers: Uint8ClampedArray[] }

/** A folder of the asset tree, as the .yyp lists it. */
export interface GmFolder { name: string; path: string }

export type GmOrigin = 'top-left' | 'top' | 'top-right' | 'left' | 'center' | 'right' | 'bottom-left' | 'bottom' | 'bottom-right';
export const GM_ORIGINS: GmOrigin[] = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];

export interface GmSprite {
  name: string;
  w: number;
  h: number;
  layers: GmLayer[];
  frames: GmFrame[];
  fps: number;
  /** a preset, or a point in pixels; `null` keeps the origin of the sprite being replaced (bottom centre for a new one) */
  origin: GmOrigin | [number, number] | null;
  /** where a new sprite goes in the asset tree; a replaced sprite stays in its folder */
  folder: GmFolder | null;
}

export interface GmFile { path: string; data: Uint8Array | string }

export type PngEncoder = (px: Uint8ClampedArray, w: number, h: number) => Promise<Uint8Array>;

// ---------- reading GameMaker's JSON ----------

/** Parses GameMaker's JSON, which allows a comma before } and ]. */
export function parseGm(text: string): any {
  text = text.replace(/^﻿/, '');
  let out = '';
  let inStr = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') continue;
    }
    out += c;
  }
  return JSON.parse(out);
}

/** Writes a value on one line the way GameMaker does: `{"a":1,"b":2,}`. */
export function gmJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map((x) => gmJson(x) + ',').join('')}]`;
  return `{${Object.entries(v as Record<string, unknown>).map(([k, x]) => `${JSON.stringify(k)}:${gmJson(x)},`).join('')}}`;
}

/** The project's name (from the .yyp). */
export function projectName(yyp: string): string {
  try { return parseGm(yyp).name ?? ''; } catch { return ''; }
}

/** The folders of the asset tree, sorted by path. */
export function projectFolders(yyp: string): GmFolder[] {
  const p = parseGm(yyp);
  const list: GmFolder[] = (p.Folders ?? []).map((f: any) => ({ name: f.name, path: f.folderPath }));
  return list.sort((a, b) => a.path.localeCompare(b.path));
}

/** The sprites the project lists, by name, in the .yyp's order. */
export function projectSprites(yyp: string): string[] {
  return [...yyp.matchAll(/"path":"sprites\/([^/"]+)\/[^"]+\.yy"/g)].map((m) => m[1]);
}

/** A sprite as read back from its .yy: what the editor needs to open it. Layers are top first, as GameMaker lists them. */
export interface GmSpriteMeta {
  name: string;
  w: number;
  h: number;
  /** frame ids, in order (each is a PNG and a folder of layer PNGs) */
  frames: string[];
  layers: { id: string; name: string; visible: boolean; opacity: number }[];
  /** how long each frame shows, in ms */
  frameMs: number;
  /** the asset folder, like "Sprites/chars/momo" */
  folder: string;
  origin: [number, number];
}

/** Reads what matters of a parsed .yy. `gameFps` turns speeds given per game frame into time. */
export function spriteMeta(yy: any, gameFps = 60): GmSpriteMeta {
  const seq = yy.sequence ?? {};
  const speed = Number(seq.playbackSpeed) || 0;
  // type 0: frames per second; type 1: sprite frames per game frame
  const fps = Number(seq.playbackSpeedType) === 1 ? speed * gameFps : speed;
  return {
    name: yy.name ?? yy['%Name'] ?? '',
    w: Number(yy.width) || 1,
    h: Number(yy.height) || 1,
    frames: (yy.frames ?? []).map((f: any) => f.name ?? f['%Name']),
    layers: (yy.layers ?? []).filter((l: any) => !l.resourceType || l.resourceType === 'GMImageLayer').map((l: any) => ({
      id: l.name ?? l['%Name'], name: l.displayName ?? 'Layer', visible: l.visible !== false, opacity: Number(l.opacity ?? 100),
    })),
    frameMs: fps > 0 ? Math.max(1, Math.round(1000 / fps)) : 100,
    folder: folderLabel(yy.parent?.path ?? ''),
    origin: [Number(seq.xorigin) || 0, Number(seq.yorigin) || 0],
  };
}

/** "folders/Sprites/chars.yy" → "Sprites/chars". */
export const folderLabel = (path: string) => path.replace(/^folders\//, '').replace(/\.yy$/, '');

/** Whether the project lists a sprite of this name. */
export function hasSprite(yyp: string, name: string): boolean {
  return yyp.includes(`"path":"sprites/${name}/${name}.yy"`);
}

/** A valid GameMaker asset name: letters, digits and _, not starting with a digit. */
export function gmName(s: string): string {
  const n = s.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
  return !n ? 'sprite' : /^\d/.test(n) ? `spr_${n}` : n;
}

// ---------- writing ----------

const uuid = (): string => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** GameMaker writes some numbers as floats (100.0). */
const float = (n: number) => (Number.isInteger(n) ? `${n}.0` : String(n));

/** Where a preset origin sits (GameMaker's own rule: centre is half, right and bottom are the full size). */
export function originPoint(o: GmOrigin, w: number, h: number): [number, number] {
  const i = GM_ORIGINS.indexOf(o);
  const col = i % 3, row = Math.floor(i / 3);
  return [[0, Math.floor(w / 2), w][col], [0, Math.floor(h / 2), h][row]];
}

/** The box around every opaque pixel of every frame, or null when all frames are empty. */
export function artBox(frames: Uint8ClampedArray[], w: number, h: number): { l: number; t: number; r: number; b: number } | null {
  let l = w, t = h, r = -1, b = -1;
  for (const px of frames) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!px[(y * w + x) * 4 + 3]) continue;
        if (x < l) l = x;
        if (x > r) r = x;
        if (y < t) t = y;
        if (y > b) b = y;
      }
    }
  }
  return r < 0 ? null : { l, t, r, b };
}

/** What the sprite will look like in GameMaker: its origin and collision box. */
export function spriteInfo(s: GmSprite, existing: any | null): { origin: [number, number]; box: { l: number; t: number; r: number; b: number } } {
  return { origin: resolveOrigin(s, existing).point, box: bbox(s, existing) };
}

function resolveOrigin(s: GmSprite, existing: any | null): { preset: number; point: [number, number] } {
  if (Array.isArray(s.origin)) return { preset: 9, point: s.origin };
  if (s.origin) return { preset: GM_ORIGINS.indexOf(s.origin), point: originPoint(s.origin, s.w, s.h) };
  if (existing) {
    const preset = Number(existing.origin ?? 9);
    // a preset follows the new size; a custom point stays where it was
    if (preset >= 0 && preset < 9) return { preset, point: originPoint(GM_ORIGINS[preset], s.w, s.h) };
    return { preset: 9, point: [Number(existing.sequence?.xorigin ?? 0), Number(existing.sequence?.yorigin ?? 0)] };
  }
  return { preset: 7, point: originPoint('bottom', s.w, s.h) };
}

function bbox(s: GmSprite, existing: any | null): { l: number; t: number; r: number; b: number } {
  const mode = Number(existing?.bboxMode ?? 0);
  if (mode === 2) return { l: existing.bbox_left, t: existing.bbox_top, r: existing.bbox_right, b: existing.bbox_bottom };
  if (mode === 1) return { l: 0, t: 0, r: s.w - 1, b: s.h - 1 };
  return artBox(s.frames.map((f) => f.composite), s.w, s.h) ?? { l: 0, t: 0, r: s.w - 1, b: s.h - 1 };
}

/**
 * The files of a sprite asset, ready to write under the project folder.
 * `existing` is the parsed .yy of the sprite it replaces: its origin, collision,
 * texture group, folder and other settings are kept; frames and layers are new.
 */
export async function spriteFiles(s: GmSprite, png: PngEncoder, existing: any | null = null): Promise<GmFile[]> {
  const dir = `sprites/${s.name}`;
  const yyPath = `${dir}/${s.name}.yy`;
  const layerIds = s.layers.map(() => uuid());
  const frameIds = s.frames.map(() => uuid());
  const files: GmFile[] = [];
  for (let i = 0; i < s.frames.length; i++) {
    const f = s.frames[i];
    files.push({ path: `${dir}/${frameIds[i]}.png`, data: await png(f.composite, s.w, s.h) });
    for (let li = 0; li < s.layers.length; li++) {
      files.push({ path: `${dir}/layers/${frameIds[i]}/${layerIds[li]}.png`, data: await png(f.layers[li], s.w, s.h) });
    }
  }

  const ex = existing ?? {};
  const keep = (k: string, d: unknown) => gmJson(k in ex ? ex[k] : d);
  const { preset, point } = resolveOrigin(s, existing);
  const box = bbox(s, existing);
  const folder = s.folder ?? { name: 'Sprites', path: 'folders/Sprites.yy' };
  const parent = existing?.parent ?? { name: folder.name, path: folder.path };
  const seq = ex.sequence ?? {};

  const frameLines = frameIds.map((id) => `    {"$GMSpriteFrame":"v1","%Name":"${id}","name":"${id}","resourceType":"GMSpriteFrame","resourceVersion":"2.0",},`).join('\n');
  const layerLines = s.layers.map((l, i) => `    {"$GMImageLayer":"","%Name":"${layerIds[i]}","blendMode":0,"displayName":${JSON.stringify(l.name)},"isLocked":false,"name":"${layerIds[i]}","opacity":${float(Math.round(l.opacity * 10) / 10)},"resourceType":"GMImageLayer","resourceVersion":"2.0","visible":${l.visible},},`).join('\n');
  const keyLines = frameIds.map((id, i) => `            {"$Keyframe<SpriteFrameKeyframe>":"","Channels":{
                "0":{"$SpriteFrameKeyframe":"","Id":{"name":"${id}","path":"${yyPath}",},"resourceType":"SpriteFrameKeyframe","resourceVersion":"2.0",},
              },"Disabled":false,"id":"${uuid()}","IsCreationKey":false,"Key":${float(i)},"Length":1.0,"resourceType":"Keyframe<SpriteFrameKeyframe>","resourceVersion":"2.0","Stretch":false,},`).join('\n');
  const config = ex.ConfigValues ? `  "ConfigValues":${gmJson(ex.ConfigValues)},\n` : '';

  const yy = `{
  "$GMSprite":"v2",
  "%Name":"${s.name}",
  "bboxMode":${keep('bboxMode', 0)},
  "bbox_bottom":${box.b},
  "bbox_left":${box.l},
  "bbox_right":${box.r},
  "bbox_top":${box.t},
  "collisionKind":${keep('collisionKind', 1)},
  "collisionTolerance":${keep('collisionTolerance', 0)},
${config}  "DynamicTexturePage":${keep('DynamicTexturePage', false)},
  "edgeFiltering":${keep('edgeFiltering', false)},
  "For3D":${keep('For3D', false)},
  "frames":[
${frameLines}
  ],
  "gridX":${keep('gridX', 0)},
  "gridY":${keep('gridY', 0)},
  "height":${s.h},
  "HTile":${keep('HTile', false)},
  "layers":[
${layerLines}
  ],
  "name":"${s.name}",
  "nineSlice":${keep('nineSlice', null)},
  "origin":${preset},
  "parent":${gmJson(parent)},
  "preMultiplyAlpha":${keep('preMultiplyAlpha', false)},
  "resourceType":"GMSprite",
  "resourceVersion":"2.0",
  "sequence":{
    "$GMSequence":"v1",
    "%Name":"${s.name}",
    "autoRecord":true,
    "backdropHeight":${gmJson(seq.backdropHeight ?? 768)},
    "backdropImageOpacity":${float(seq.backdropImageOpacity ?? 0.5)},
    "backdropImagePath":${gmJson(seq.backdropImagePath ?? '')},
    "backdropWidth":${gmJson(seq.backdropWidth ?? 1366)},
    "backdropXOffset":${float(seq.backdropXOffset ?? 0)},
    "backdropYOffset":${float(seq.backdropYOffset ?? 0)},
    "events":{
      "$KeyframeStore<MessageEventKeyframe>":"",
      "Keyframes":[],
      "resourceType":"KeyframeStore<MessageEventKeyframe>",
      "resourceVersion":"2.0",
    },
    "eventStubScript":null,
    "eventToFunction":{},
    "length":${float(s.frames.length)},
    "lockOrigin":${gmJson(seq.lockOrigin ?? false)},
    "moments":{
      "$KeyframeStore<MomentsEventKeyframe>":"",
      "Keyframes":[],
      "resourceType":"KeyframeStore<MomentsEventKeyframe>",
      "resourceVersion":"2.0",
    },
    "name":"${s.name}",
    "playback":1,
    "playbackSpeed":${float(Math.round(s.fps * 100) / 100)},
    "playbackSpeedType":0,
    "resourceType":"GMSequence",
    "resourceVersion":"2.0",
    "seqHeight":${float(s.h)},
    "seqWidth":${float(s.w)},
    "showBackdrop":true,
    "showBackdropImage":false,
    "timeUnits":1,
    "tracks":[
      {"$GMSpriteFramesTrack":"","builtinName":0,"events":[],"inheritsTrackColour":true,"interpolation":1,"isCreationTrack":false,"keyframes":{"$KeyframeStore<SpriteFrameKeyframe>":"","Keyframes":[
${keyLines}
          ],"resourceType":"KeyframeStore<SpriteFrameKeyframe>","resourceVersion":"2.0",},"modifiers":[],"name":"frames","resourceType":"GMSpriteFramesTrack","resourceVersion":"2.0","spriteId":null,"trackColour":0,"tracks":[],"traits":0,},
    ],
    "visibleRange":null,
    "volume":1.0,
    "xorigin":${point[0]},
    "yorigin":${point[1]},
  },
  "swatchColours":${keep('swatchColours', null)},
  "swfPrecision":${keep('swfPrecision', 0.5)},
  "textureGroupId":${keep('textureGroupId', { name: 'Default', path: 'texturegroups/Default' })},
  "type":${keep('type', 0)},
  "VTile":${keep('VTile', false)},
  "width":${s.w},
}
`;
  files.push({ path: yyPath, data: yy });
  return files;
}

/**
 * Adds the sprite to the .yyp's resources (they are sorted by name), keeping the
 * file's line endings. Returns the text unchanged when it is already there.
 */
export function registerSprite(yyp: string, name: string): string {
  if (hasSprite(yyp, name)) return yyp;
  const nl = yyp.includes('\r\n') ? '\r\n' : '\n';
  const entry = `    {"id":{"name":"${name}","path":"sprites/${name}/${name}.yy",},},`;
  const re = /^ {4}\{"id":\{"name":"([^"]+)","path":"[^"]+",\},\},\r?$/gm;
  let m: RegExpExecArray | null;
  let at = -1, last = -1;
  while ((m = re.exec(yyp))) {
    last = m.index + m[0].length;
    if (at < 0 && m[1].toLowerCase() > name.toLowerCase()) at = m.index;
  }
  if (last < 0) {
    // no resources yet: open the list
    const i = yyp.indexOf('"resources":[');
    if (i < 0) throw new Error('This .yyp has no resources list.');
    const after = i + '"resources":['.length;
    return yyp.slice(0, after) + nl + entry + yyp.slice(after);
  }
  if (at < 0) at = yyp.indexOf(nl, last) + nl.length;
  return yyp.slice(0, at) + entry + nl + yyp.slice(at);
}

/** Frames per second for frames of these durations (ms), and whether they all play equally long. */
export function fpsFor(durations: number[]): { fps: number; even: boolean } {
  const even = durations.every((d) => d === durations[0]);
  // the most common duration sets the speed
  const count = new Map<number, number>();
  for (const d of durations) count.set(d, (count.get(d) ?? 0) + 1);
  const common = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 100;
  return { fps: Math.round((1000 / Math.max(1, common)) * 100) / 100, even };
}

/**
 * Frame indices that keep the timing at one speed: a frame twice as long as
 * the shortest one shows twice (GameMaker sprites play every frame equally long).
 */
export function evenTiming(frames: number[], durations: number[]): { frames: number[]; fps: number } {
  const ds = frames.map((i) => Math.max(1, durations[i]));
  const step = Math.min(...ds);
  const out: number[] = [];
  frames.forEach((fi, k) => { for (let n = Math.max(1, Math.round(ds[k] / step)); n > 0; n--) out.push(fi); });
  return { frames: out, fps: Math.round((1000 / step) * 100) / 100 };
}
