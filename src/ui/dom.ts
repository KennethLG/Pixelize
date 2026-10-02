// Small DOM helpers shared by the UI modules.

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

export function setStatus(msg: string, isError = false): void {
  const s = $('status');
  s.textContent = msg;
  s.classList.toggle('err', isError);
}

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
