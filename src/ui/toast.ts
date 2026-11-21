// Toasts: short messages in a corner that say how something went (saved,
// exported, sent to GameMaker, or an error), then go away on their own.
// A toast with an `id` replaces the one with the same id, so a long job can
// show "Sending…" and then "Sent" in the same place.

import { createBus } from './bus';

export type ToastKind = 'ok' | 'error' | 'info' | 'busy';
export interface Toast { id: string; kind: ToastKind; text: string; detail?: string; ms: number; at: number }

export const toastBus = createBus<'toasts'>();
let list: Toast[] = [];
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let seq = 0;

export const toasts = () => list;

const DEFAULT_MS: Record<ToastKind, number> = { ok: 4000, info: 4000, error: 8000, busy: 0 };
const MAX = 4;

/** Shows a toast. `ms` 0 keeps it until it is replaced or closed (a "busy" one does that by default). */
export function toast(text: string, opts: { kind?: ToastKind; detail?: string; id?: string; ms?: number } = {}): string {
  const kind = opts.kind ?? 'ok';
  const id = opts.id ?? `t${++seq}`;
  const t: Toast = { id, kind, text, detail: opts.detail, ms: opts.ms ?? DEFAULT_MS[kind], at: Date.now() };
  const i = list.findIndex((x) => x.id === id);
  list = i >= 0 ? list.map((x) => (x.id === id ? t : x)) : [...list, t].slice(-MAX);
  schedule(t);
  toastBus.emit('toasts');
  return id;
}

function schedule(t: Toast): void {
  clearTimeout(timers.get(t.id));
  timers.delete(t.id);
  if (t.ms > 0) timers.set(t.id, setTimeout(() => closeToast(t.id), t.ms));
}

export function closeToast(id: string): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (!list.some((t) => t.id === id)) return;
  list = list.filter((t) => t.id !== id);
  toastBus.emit('toasts');
}

/** While the pointer is on a toast it stays; it goes the usual time after the pointer leaves. */
export function holdToast(id: string, hold: boolean): void {
  const t = list.find((x) => x.id === id);
  if (!t) return;
  if (hold) { clearTimeout(timers.get(id)); timers.delete(id); } else schedule(t);
}
