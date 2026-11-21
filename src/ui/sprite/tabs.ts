// Several sprites open at once, one per tab. The open tab lives in `sp` (and
// the undo history in state.ts); the others keep a copy of all that, plus
// where their view was, until they are opened again. Opening a file, a
// GameMaker sprite, a new sprite or a Pixelize result adds a tab, except when
// the open tab is an untouched empty sprite, which is reused.

import type { Mask } from '../../core/bitmap';
import { createDoc, type SpriteDoc } from '../../core/sprite';
import { restoreView, viewState, type ViewState } from './canvas';
import { commitFloating, editCount, emit, putHistory, setDoc, sp, takeHistory, type History } from './state';

export interface Tab {
  id: string;
  doc: SpriteDoc;
  name: string;
  gmName: string | null;
  fileHandle: FileSystemFileHandle | null;
  frame: number;
  layer: number;
  mask: Mask | null;
  range: [number, number] | null;
  history: History;
  view: ViewState | null;
  /** the edit count when it was last saved or opened */
  savedAt: number;
}

let seq = 0;
const newId = () => `tab${++seq}`;

/** The tabs; the open one's copy is stale while it is open (live state is in `sp`). */
let tabs: Tab[] = [];
let active = 0;

function capture(t: Tab): Tab {
  return {
    ...t, doc: sp.doc, name: sp.name, gmName: sp.gmName, fileHandle: sp.fileHandle, frame: sp.frame, layer: sp.layer,
    mask: sp.mask, range: sp.range, history: takeHistory(), view: viewState(),
  };
}

function show(t: Tab): void {
  sp.floating = null;
  sp.preview = null;
  sp.editingTag = null;
  sp.pivotAt = null;
  sp.playing = false;
  sp.showVariant = null;
  sp.issues = [];
  sp.issueFocus = null;
  sp.doc = t.doc;
  sp.name = t.name;
  sp.gmName = t.gmName;
  sp.fileHandle = t.fileHandle;
  sp.frame = Math.min(t.frame, t.doc.frames.length - 1);
  sp.layer = Math.min(t.layer, t.doc.layers.length - 1);
  sp.mask = t.mask;
  sp.range = t.range;
  putHistory(t.history);
  restoreView(t.view);
  emit('structure', 'cursor', 'pixels', 'selection', 'playback', 'tabs');
}

/** The tabs as they are now (the open one up to date). */
export function tabList(): Tab[] {
  if (!tabs.length) tabs = [capture({ id: newId(), savedAt: 0 } as Tab)];
  tabs[active] = capture(tabs[active]);
  return tabs;
}

export const activeIndex = () => active;

/** Whether a tab has changes since it was opened or saved. */
export const isModified = (t: Tab, i: number) => (i === active ? editCount() : t.history.edits) !== t.savedAt;

/** After a save: the open tab has no unsaved changes. */
export function markSaved(): void {
  tabList();
  tabs[active].savedAt = editCount();
  emit('tabs');
}

export function switchTab(i: number): void {
  tabList();
  if (i < 0 || i >= tabs.length || i === active) return;
  commitFloating();
  tabs[active] = capture(tabs[active]);
  active = i;
  show(tabs[i]);
}

export const nextTab = () => { const n = tabList().length; switchTab((active + 1) % n); };
export const prevTab = () => { const n = tabList().length; switchTab((active - 1 + n) % n); };

const isBlank = (d: SpriteDoc) => d.layers.length === 1 && d.frames.length === 1 && !d.frames[0].cels[0].px.some((v, i) => i % 4 === 3 && v);

/**
 * Opens a document in a new tab (or in the open one, when it is an untouched
 * empty sprite). `extra` is what it came from: a GameMaker sprite, a file.
 */
export function openDoc(doc: SpriteDoc, name: string, extra: { gmName?: string | null; fileHandle?: FileSystemFileHandle | null } = {}): void {
  tabList();
  commitFloating();
  const reuse = isBlank(sp.doc) && editCount() === 0 && !sp.fileHandle && !sp.gmName;
  if (!reuse) {
    tabs[active] = capture(tabs[active]);
    tabs.splice(active + 1, 0, { id: newId(), savedAt: 0 } as Tab);
    active++;
  }
  setDoc(doc, name);
  sp.gmName = extra.gmName ?? null;
  sp.fileHandle = extra.fileHandle ?? null;
  restoreView(null);
  tabs[active] = { ...capture(tabs[active]), savedAt: editCount() };
  emit('tabs');
}

/** The tab that already holds this, if any (to switch to it instead of opening it twice). */
export function findTab(match: (t: Tab) => boolean): number {
  return tabList().findIndex(match);
}

/**
 * Closes a tab, asking first when it has unsaved changes. The last tab is
 * never closed: it becomes an empty sprite.
 */
export function closeTab(i = active): void {
  const list = tabList();
  const t = list[i];
  if (!t) return;
  if (isModified(t, i) && !confirm(`${t.name} has changes that are not saved. Close it anyway?`)) return;
  if (list.length === 1) {
    tabs = [];
    active = 0;
    setDoc(createDoc(t.doc.w, t.doc.h), 'sprite');
    restoreView(null);
    tabList();
    emit('tabs');
    return;
  }
  commitFloating();
  tabs.splice(i, 1);
  if (i < active) active--;
  else if (i === active) {
    active = Math.min(active, tabs.length - 1);
    show(tabs[active]);
    return;
  }
  emit('tabs');
}

/** Moves a tab to another place in the row. */
export function moveTab(from: number, to: number): void {
  tabList();
  if (from === to || to < 0 || to >= tabs.length) return;
  const [t] = tabs.splice(from, 1);
  tabs.splice(to, 0, t);
  if (active === from) active = to;
  else if (from < active && to >= active) active--;
  else if (from > active && to <= active) active++;
  emit('tabs');
}

/** Brings back tabs saved by the autosave (the documents and names only). */
export function restoreTabs(saved: { name: string; doc: SpriteDoc; gmName?: string | null }[], open: number): void {
  if (!saved.length) return;
  tabs = [];
  active = 0;
  saved.forEach((s, i) => {
    if (i === 0) { setDoc(s.doc, s.name); sp.gmName = s.gmName ?? null; tabs = [{ ...capture({ id: newId(), savedAt: 0 } as Tab), view: null }]; return; }
    tabs.push({
      id: newId(), doc: s.doc, name: s.name, gmName: s.gmName ?? null, fileHandle: null, frame: 0, layer: 0, mask: null, range: null,
      history: { undo: [], redo: [], edits: 0 }, view: null, savedAt: 0,
    });
  });
  if (open > 0 && open < tabs.length) switchTab(open);
  emit('tabs');
}
