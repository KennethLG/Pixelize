// The GameMaker project the sprite editor sends sprites to: a folder the user
// picks once (File System Access API, in Chromium browsers and the desktop app),
// remembered in IndexedDB so the next export only needs a click.

import { parseGm, projectFolders, projectName, projectSprites, registerSprite, type GmFile, type GmFolder } from '../../export/gamemaker';

type Perm = 'granted' | 'denied' | 'prompt';
interface PermHandle { queryPermission?(o: { mode: 'readwrite' }): Promise<Perm>; requestPermission?(o: { mode: 'readwrite' }): Promise<Perm> }
declare global {
  interface Window { showDirectoryPicker?(o?: { mode?: 'read' | 'readwrite'; id?: string }): Promise<FileSystemDirectoryHandle> }
}

export interface GmProject {
  dir: FileSystemDirectoryHandle;
  /** the .yyp file name and the project's name */
  yyp: string;
  name: string;
  folders: GmFolder[];
  /** the sprites the project lists, by lower-case name */
  sprites: Set<string>;
  /** their names, as the .yyp lists them */
  spriteNames: string[];
  /** the game's speed (frames per second), for sprites timed per game frame */
  gameFps: number;
  /** tells this project apart from others in the cache */
  key: string;
}

/** Whether this browser can write to a folder the user picks. */
export const canPickFolders = () => typeof window.showDirectoryPicker === 'function';

// ---------- remembering the folder ----------

const DB = 'pixelize-gm', STORE = 'handles', KEY = 'project';
/** the sprite browser's cache (gmLibrary.ts) */
export const SPRITES = 'sprites';

export function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 2);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
      if (!r.result.objectStoreNames.contains(SPRITES)) r.result.createObjectStore(SPRITES);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function rememberProject(dir: FileSystemDirectoryHandle | null): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction(STORE, 'readwrite');
    if (dir) tx.objectStore(STORE).put(dir, KEY); else tx.objectStore(STORE).delete(KEY);
    await new Promise((res) => { tx.oncomplete = res; tx.onerror = res; });
  } catch { /* nothing remembered: the user picks the folder again next time */ }
}

async function recall(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const d = await db();
    const r = d.transaction(STORE).objectStore(STORE).get(KEY);
    return await new Promise((res) => { r.onsuccess = () => res(r.result ?? null); r.onerror = () => res(null); });
  } catch { return null; }
}

// ---------- files ----------

/** A file under the project folder, or null when there is none. */
export async function fileAt(dir: FileSystemDirectoryHandle, path: string): Promise<File | null> {
  const parts = path.split('/');
  try {
    let d = dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p);
    return await (await d.getFileHandle(parts.at(-1)!)).getFile();
  } catch { return null; }
}

export async function readText(dir: FileSystemDirectoryHandle, path: string): Promise<string | null> {
  const f = await fileAt(dir, path);
  return f ? f.text() : null;
}

async function writeFile(dir: FileSystemDirectoryHandle, path: string, data: Uint8Array | string): Promise<void> {
  const parts = path.split('/');
  let d = dir;
  for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
  const w = await (await d.getFileHandle(parts.at(-1)!, { create: true })).createWritable();
  await w.write(data as FileSystemWriteChunkType);
  await w.close();
}

async function findYyp(dir: FileSystemDirectoryHandle): Promise<string | null> {
  for await (const [name, h] of (dir as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
    if (h.kind === 'file' && name.toLowerCase().endsWith('.yyp')) return name;
  }
  return null;
}

export async function projectFromDir(dir: FileSystemDirectoryHandle): Promise<GmProject> {
  const yyp = await findYyp(dir);
  if (!yyp) throw new Error(`"${dir.name}" is not a GameMaker project: pick the folder that has the .yyp file.`);
  const text = (await readText(dir, yyp))!;
  const spriteNames = projectSprites(text);
  let gameFps = 60;
  try { gameFps = Number(parseGm((await readText(dir, 'options/main/options_main.yy')) ?? '{}').option_game_speed) || 60; } catch { /* 60 */ }
  return {
    dir, yyp, name: projectName(text) || yyp.replace(/\.yyp$/i, ''), folders: projectFolders(text),
    sprites: new Set(spriteNames.map((n) => n.toLowerCase())), spriteNames, gameFps, key: `${dir.name}/${yyp}`,
  };
}

// ---------- the project ----------

/** Asks for a project folder and remembers it. */
export async function pickProject(): Promise<GmProject> {
  if (!window.showDirectoryPicker) throw new Error('This browser cannot write to folders. Use the desktop app, Chrome or Edge.');
  const dir = await window.showDirectoryPicker({ mode: 'readwrite', id: 'gm-project' });
  const p = await projectFromDir(dir);
  await rememberProject(dir);
  return p;
}

/**
 * The remembered project. `ask` requests access again when the browser
 * forgot it (needs a click); without it, a project without access is null.
 */
export async function rememberedProject(ask: boolean): Promise<GmProject | null> {
  const dir = await recall();
  if (!dir) return null;
  const h = dir as unknown as PermHandle;
  let perm: Perm = (await h.queryPermission?.({ mode: 'readwrite' })) ?? 'granted';
  if (perm === 'prompt' && ask) perm = (await h.requestPermission?.({ mode: 'readwrite' })) ?? 'denied';
  if (perm !== 'granted') return null;
  try { return await projectFromDir(dir); } catch { await rememberProject(null); return null; }
}

/** The name of the remembered folder, even without access to it yet. */
export async function rememberedName(): Promise<string | null> {
  return (await recall())?.name ?? null;
}

export const forgetProject = () => rememberProject(null);

/** The parsed .yy of a sprite of the project, or null when it has none of that name. */
export async function readSprite(p: GmProject, name: string): Promise<any | null> {
  if (!p.sprites.has(name.toLowerCase())) return null;
  const text = await readText(p.dir, `sprites/${name}/${name}.yy`);
  try { return text ? parseGm(text) : null; } catch { return null; }
}

/**
 * Writes one sprite: its old folder goes (old frames would stay otherwise),
 * the new files go in, and the .yyp lists it. Reads the .yyp again right
 * before writing it, so nothing written meanwhile is lost.
 */
export async function writeSprite(p: GmProject, name: string, files: GmFile[]): Promise<void> {
  const sprites = await p.dir.getDirectoryHandle('sprites', { create: true });
  try { await sprites.removeEntry(name, { recursive: true }); } catch { /* a new sprite */ }
  for (const f of files) await writeFile(p.dir, f.path, f.data);
  const yyp = (await readText(p.dir, p.yyp))!;
  const next = registerSprite(yyp, name);
  if (next !== yyp) await writeFile(p.dir, p.yyp, next);
  if (!p.sprites.has(name.toLowerCase())) p.spriteNames.push(name);
  p.sprites.add(name.toLowerCase());
}
