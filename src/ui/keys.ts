// Keyboard shortcuts that the user can change in Options. Each action has
// default keys; changes are kept in this browser. Keys are written like
// "B", "Shift+N", "Ctrl+Z", "Space", "ArrowLeft".

import { createBus } from './bus';

export type KeyGroup = 'sprite' | 'pixelize';
export interface KeyAction {
  id: string;
  label: string;
  group: KeyGroup;
  section: string;
  keys: string[];
  /** held down rather than pressed (pan with Space, quick flip) */
  hold?: boolean;
}

const A = (group: KeyGroup, section: string, id: string, label: string, keys: string[], hold = false): KeyAction =>
  ({ id: `${group}.${id}`, label, group, section, keys, hold });

export const ACTIONS: KeyAction[] = [
  // sprite editor
  A('sprite', 'Tools', 'pencil', 'Pencil', ['B']),
  A('sprite', 'Tools', 'eraser', 'Eraser', ['E']),
  A('sprite', 'Tools', 'line', 'Line', ['L']),
  A('sprite', 'Tools', 'bucket', 'Paint bucket', ['G']),
  A('sprite', 'Tools', 'rect', 'Rectangle', ['U']),
  A('sprite', 'Tools', 'ellipse', 'Ellipse', ['O']),
  A('sprite', 'Tools', 'picker', 'Eyedropper', ['I']),
  A('sprite', 'Tools', 'select', 'Select', ['M']),
  A('sprite', 'Tools', 'wand', 'Select by color', ['W']),
  A('sprite', 'Tools', 'move', 'Move', ['V']),
  A('sprite', 'Tools', 'canvas', 'Canvas size', ['C']),
  A('sprite', 'Tools', 'pan', 'Hand', ['H']),
  A('sprite', 'Tools', 'panHold', 'Move the view while held', ['Space'], true),
  A('sprite', 'Drawing', 'swapColors', 'Swap primary and secondary', ['X']),
  A('sprite', 'Drawing', 'brushDown', 'Smaller brush', ['[']),
  A('sprite', 'Drawing', 'brushUp', 'Bigger brush', [']']),
  A('sprite', 'Edit', 'undo', 'Undo', ['Ctrl+Z']),
  A('sprite', 'Edit', 'redo', 'Redo', ['Ctrl+Y', 'Ctrl+Shift+Z']),
  A('sprite', 'Edit', 'copy', 'Copy', ['Ctrl+C']),
  A('sprite', 'Edit', 'cut', 'Cut', ['Ctrl+X']),
  A('sprite', 'Edit', 'selectAll', 'Select all', ['Ctrl+A']),
  A('sprite', 'Edit', 'deselect', 'Deselect', ['Ctrl+D', 'Escape']),
  A('sprite', 'Edit', 'delete', 'Delete the selection', ['Delete', 'Backspace']),
  A('sprite', 'Edit', 'apply', 'Put moved pixels down', ['Enter']),
  A('sprite', 'View', 'zoomIn', 'Zoom in', ['+', '=']),
  A('sprite', 'View', 'zoomOut', 'Zoom out', ['-']),
  A('sprite', 'View', 'fit', 'Fit the canvas', ['0']),
  A('sprite', 'View', 'onion', 'Onion skin on/off', ['Shift+O']),
  A('sprite', 'Animation', 'prevFrame', 'Previous frame', [',']),
  A('sprite', 'Animation', 'nextFrame', 'Next frame', ['.']),
  A('sprite', 'Animation', 'play', 'Play / pause', ['P']),
  A('sprite', 'Animation', 'peek', 'Show the previous frame while held', ['Q'], true),
  A('sprite', 'Animation', 'newFrame', 'New frame', ['N']),
  A('sprite', 'Animation', 'dupFrame', 'Duplicate frame', ['Shift+N']),
  A('sprite', 'Animation', 'copyCel', 'Copy cel', ['Shift+C']),
  A('sprite', 'Animation', 'pasteCel', 'Paste cel', ['Shift+V']),
  // pixelize result editor
  A('pixelize', 'Touch up', 'pan', 'Move the view', ['H']),
  A('pixelize', 'Touch up', 'pencil', 'Pencil', ['B']),
  A('pixelize', 'Touch up', 'eraser', 'Eraser', ['E']),
  A('pixelize', 'Touch up', 'fill', 'Fill', ['G']),
  A('pixelize', 'Touch up', 'picker', 'Eyedropper', ['I']),
  A('pixelize', 'Touch up', 'panHold', 'Move the view while held', ['Space'], true),
  A('pixelize', 'Touch up', 'undo', 'Undo', ['Ctrl+Z']),
  A('pixelize', 'Touch up', 'redo', 'Redo', ['Ctrl+Y', 'Ctrl+Shift+Z']),
  A('pixelize', 'View', 'zoomIn', 'Zoom in', ['+', '=']),
  A('pixelize', 'View', 'zoomOut', 'Zoom out', ['-']),
  A('pixelize', 'View', 'fit', 'Fit the result', ['0']),
];

const KEY = 'pixelize.keys.v1';
export const keysBus = createBus<'keys'>();
let custom: Record<string, string[]> = {};
let index = new Map<string, string>();   // "group|combo" → action id

const NAMES: Record<string, string> = { ' ': 'Space', Esc: 'Escape', Del: 'Delete', Left: 'ArrowLeft', Right: 'ArrowRight', Up: 'ArrowUp', Down: 'ArrowDown' };

/**
 * The combo a key press stands for. Letters are upper case and keep Shift;
 * for symbols the character already says it (Shift+= is "+"). AltGr (which
 * the browser reports as Ctrl+Alt) counts as no modifier, for layouts that
 * need it for [ ] { } and similar.
 */
export function comboOf(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Dead'].includes(e.key)) return null;
  const altGr = e.getModifierState?.('AltGraph');
  let key = NAMES[e.key] ?? e.key;
  const letter = key.length === 1 && key.toLowerCase() !== key.toUpperCase();
  if (key.length === 1) key = key.toUpperCase();
  const parts: string[] = [];
  if ((e.ctrlKey || e.metaKey) && !altGr) parts.push('Ctrl');
  if (e.altKey && !altGr) parts.push('Alt');
  if (e.shiftKey && (letter || key.length > 1)) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

const action = (id: string) => ACTIONS.find((a) => a.id === id)!;
export const keysOf = (id: string): string[] => custom[id] ?? action(id).keys;
/** The first key of an action, for labels ("B"), or an empty string. */
export const keyLabel = (id: string) => keysOf(id)[0] ?? '';

function rebuild(): void {
  index = new Map();
  for (const a of ACTIONS) for (const k of keysOf(a.id)) index.set(`${a.group}|${k}`, a.id);
}

/** The action a key press triggers in a group, if any. */
export function actionFor(e: KeyboardEvent, group: KeyGroup): string | null {
  const c = comboOf(e);
  return c ? index.get(`${group}|${c}`) ?? null : null;
}

/** For hold actions: whether this key release ends the action (modifiers do not matter). */
export function releases(e: KeyboardEvent, id: string): boolean {
  const c = comboOf(e);
  if (!c) return false;
  const bare = c.split('+').pop();
  return keysOf(id).some((k) => k.split('+').pop() === bare);
}

/** The other action of the same group that already uses this combo. */
export const usedBy = (group: KeyGroup, combo: string, except: string): KeyAction | null =>
  ACTIONS.find((a) => a.group === group && a.id !== except && keysOf(a.id).includes(combo)) ?? null;

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(custom)); } catch { /* storage unavailable */ }
  rebuild();
  keysBus.emit('keys');
}

/** Gives an action these keys. A key taken from another action of the same group is removed there. */
export function setKeys(id: string, keys: string[]): void {
  const a = action(id);
  for (const k of keys) {
    const other = usedBy(a.group, k, id);
    if (other) custom[other.id] = keysOf(other.id).filter((x) => x !== k);
  }
  custom[id] = [...new Set(keys)];
  save();
}

export function resetKeys(id?: string): void {
  if (id) delete custom[id];
  else custom = {};
  save();
}

export const isCustom = (id: string) => id in custom;

export function initKeys(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
    for (const [id, keys] of Object.entries(saved)) {
      if (ACTIONS.some((a) => a.id === id) && Array.isArray(keys)) custom[id] = keys.map(String);
    }
  } catch { /* nothing saved */ }
  rebuild();
}
