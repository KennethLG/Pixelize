// Small DOM helpers shared by the UI modules.

import { toast } from './toast';

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in the page`);
  return el as T;
}

export const field = (id: string) => $<HTMLInputElement>(id);
export const num = (id: string) => parseFloat(field(id).value);
export const int = (id: string) => parseInt(field(id).value, 10);
export const isChecked = (id: string) => field(id).checked;

export function radio<T extends string = string>(name: string): T {
  return (document.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement).value as T;
}

export function setRadio(name: string, value: string): void {
  const r = document.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`);
  if (r) r.checked = true;
}

export const onAll = (selector: string, type: string, fn: (e: Event) => void) =>
  document.querySelectorAll(selector).forEach((el) => el.addEventListener(type, fn));

export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Both modes have a status line; only the visible one is seen. Errors also
// show as a toast, so they are not missed.
export function setStatus(msg: string, isError = false): void {
  for (const id of ['status', 'spStatus']) {
    const s = document.getElementById(id);
    if (!s) continue;
    s.textContent = msg;
    s.classList.toggle('err', isError);
  }
  if (isError && msg) toast(msg, { kind: 'error' });
}

/** A result worth seeing (saved, exported): the status line and a toast. */
export function notify(msg: string, detail?: string): void {
  setStatus(detail ? `${msg} ${detail}` : msg);
  toast(msg, { detail });
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
