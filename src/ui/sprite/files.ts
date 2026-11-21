// Files like a desktop app: Open… with the system picker, Open Recent (files
// and GameMaker sprites, kept in IndexedDB with their handles so they open
// again with a click), Save into the .pixelize file a sprite came from, and
// Save As. Browsers without the File System Access API fall back to a file
// input and downloads (no recent files then).

import { serializeDoc } from '../../core/sprite';
import { notify, setStatus } from '../dom';
import { loadGmSprite } from './gmLibrary';
import { projectFromDir, rememberProject } from './gmProject';
import { MAX_SIDE, openFile, saveProject } from './io';
import { commitFloating, emit, sp } from './state';
import { findTab, markSaved, openDoc, switchTab, tabList } from './tabs';

type Perm = 'granted' | 'denied' | 'prompt';
interface PermHandle { queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<Perm>; requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<Perm> }
interface PickerType { description: string; accept: Record<string, string[]> }
declare global {
  interface Window {
    showOpenFilePicker?(o?: { types?: PickerType[]; multiple?: boolean; id?: string; excludeAcceptAllOption?: boolean }): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?(o?: { types?: PickerType[]; suggestedName?: string; id?: string }): Promise<FileSystemFileHandle>;
  }
}

const OPEN_TYPES: PickerType[] = [
  { description: 'Sprites and images', accept: { 'application/json': ['.pixelize'], 'image/*': ['.png', '.gif', '.jpg', '.jpeg', '.webp', '.bmp'] } },
];
const SAVE_TYPES: PickerType[] = [{ description: 'Pixelize sprite', accept: { 'application/json': ['.pixelize'] } }];


const report = (e: unknown) => { if ((e as Error)?.name !== 'AbortError') setStatus((e as Error)?.message ?? String(e), true); };

async function allowed(h: FileSystemHandle, mode: 'read' | 'readwrite'): Promise<boolean> {
  const p = h as unknown as PermHandle;
  let state: Perm = (await p.queryPermission?.({ mode })) ?? 'granted';
  if (state === 'prompt') state = (await p.requestPermission?.({ mode })) ?? 'denied';
  return state === 'granted';
}

// ---------- recent ----------

export type Recent =
  | { id: string; kind: 'file'; name: string; when: number; handle: FileSystemFileHandle }
  | { id: string; kind: 'gm'; name: string; when: number; project: string; dir: FileSystemDirectoryHandle };

const DB = 'pixelize-recent', STORE = 'recent', MAX = 10;
let recent: Recent[] = [];

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function saveRecent(): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction(STORE, 'readwrite');
    const st = tx.objectStore(STORE);
    st.clear();
    for (const r of recent) st.put(r);
  } catch { /* not remembered */ }
}

/** The recent list, newest first (loaded once at start; the menus read it as it is). */
export const recentItems = () => recent;

export async function loadRecent(): Promise<void> {
  try {
    const d = await db();
    const r = d.transaction(STORE).objectStore(STORE).getAll();
    recent = (await new Promise<Recent[]>((res) => { r.onsuccess = () => res(r.result as Recent[]); r.onerror = () => res([]); }))
      .sort((a, b) => b.when - a.when).slice(0, MAX);
    emit('recent');
  } catch { /* no recent files */ }
}

async function addRecent(item: Recent): Promise<void> {
  const same = async (r: Recent) => {
    if (r.kind !== item.kind) return false;
    if (r.kind === 'gm' && item.kind === 'gm') return r.project === item.project && r.name === item.name;
    if (r.kind === 'file' && item.kind === 'file') { try { return await r.handle.isSameEntry(item.handle); } catch { return r.name === item.name; } }
    return false;
  };
  const keep: Recent[] = [];
  for (const r of recent) if (!(await same(r))) keep.push(r);
  recent = [item, ...keep].slice(0, MAX);
  emit('recent');
  await saveRecent();
}

export function clearRecent(): void {
  recent = [];
  emit('recent');
  saveRecent();
}

function removeRecent(id: string): void {
  recent = recent.filter((r) => r.id !== id);
  emit('recent');
  saveRecent();
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Called when a GameMaker sprite was opened, so it shows in Open Recent. */
export function rememberGmSprite(name: string, project: string, dir: FileSystemDirectoryHandle): void {
  addRecent({ id: newId(), kind: 'gm', name, project, dir, when: Date.now() });
}

// ---------- open ----------

/** The tab that already shows this file, or -1. */
async function tabOfFile(h: FileSystemFileHandle): Promise<number> {
  const list = tabList();
  for (let i = 0; i < list.length; i++) {
    const fh = list[i].fileHandle;
    try { if (fh && await fh.isSameEntry(h)) return i; } catch { /* not the same */ }
  }
  return -1;
}

async function openHandle(h: FileSystemFileHandle): Promise<void> {
  // a file that is already open: go to its tab
  const open = await tabOfFile(h);
  if (open >= 0) { switchTab(open); return; }
  const file = await h.getFile();
  await openFile(file);
  // Save writes back into a .pixelize file; an image opened as a sprite saves as a new file
  sp.fileHandle = /\.pixelize$/i.test(file.name) ? h : null;
  emit('recent');
  await addRecent({ id: newId(), kind: 'file', name: file.name, handle: h, when: Date.now() });
}

/** File › Open…: a .pixelize sprite, a PNG, or a _stripN.png strip. */
export function openFileDialog(): void {
  if (window.showOpenFilePicker) {
    window.showOpenFilePicker({ types: OPEN_TYPES, id: 'pixelize-open' }).then(([h]) => openHandle(h)).catch(report);
    return;
  }
  pickWithInput('image/*,.pixelize,.json', (f) => openFile(f));
}

/** A file input made on the spot, for browsers without the file pickers. */
export function pickWithInput(accept: string, use: (f: File) => Promise<void>): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = accept;
  input.onchange = () => { const f = input.files?.[0]; if (f) use(f).catch(report); };
  input.click();
}

/** Opens an entry of Open Recent. */
export function openRecent(r: Recent): void {
  (async () => {
    if (r.kind === 'file') {
      if (!(await allowed(r.handle, 'read'))) { setStatus(`Access to ${r.name} was not allowed.`, true); return; }
      try { await openHandle(r.handle); } catch (e) {
        if ((e as Error).name === 'NotFoundError') { removeRecent(r.id); setStatus(`${r.name} is not there anymore.`, true); return; }
        throw e;
      }
      return;
    }
    const open = findTab((t) => t.gmName === r.name);
    if (open >= 0) { switchTab(open); return; }
    if (!(await allowed(r.dir, 'readwrite'))) { setStatus(`Access to ${r.project} was not allowed.`, true); return; }
    const p = await projectFromDir(r.dir);
    if (!p.sprites.has(r.name.toLowerCase())) { removeRecent(r.id); setStatus(`${r.project} has no sprite ${r.name} anymore.`, true); return; }
    const doc = await loadGmSprite(p, r.name, MAX_SIDE);
    openDoc(doc, r.name, { gmName: r.name });
    // Export sends it back to this project
    await rememberProject(r.dir);
    rememberGmSprite(r.name, p.name, r.dir);
    notify(`Opened ${r.name}`, `from ${p.name}`);
  })().catch(report);
}

// ---------- save ----------

async function writeTo(h: FileSystemFileHandle): Promise<void> {
  const w = await h.createWritable();
  await w.write(serializeDoc(sp.doc));
  await w.close();
}

/** File › Save: into the .pixelize file this sprite came from, else like Save As. */
export function save(): void {
  commitFloating();
  const h = sp.fileHandle;
  if (!h) { saveAs(); return; }
  (async () => {
    if (!(await allowed(h, 'readwrite'))) { setStatus(`Access to ${h.name} was not allowed.`, true); return; }
    await writeTo(h);
    markSaved();
    notify(`Saved ${h.name}`);
  })().catch(report);
}

/** File › Save As…: picks where (or downloads, without the picker). */
export function saveAs(): void {
  commitFloating();
  if (!window.showSaveFilePicker) { saveProject().catch(report); return; }
  window.showSaveFilePicker({ types: SAVE_TYPES, suggestedName: `${sp.name}.pixelize`, id: 'pixelize-save' }).then(async (h) => {
    await writeTo(h);
    sp.fileHandle = h;
    sp.name = h.name.replace(/\.pixelize$/i, '');
    emit('recent');
    await addRecent({ id: newId(), kind: 'file', name: h.name, handle: h, when: Date.now() });
    markSaved();
    notify(`Saved ${h.name}`);
  }).catch(report);
}
