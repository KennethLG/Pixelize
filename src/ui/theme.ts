// Light, dark, or whatever the system uses. styles.css reads <html data-theme>.

export type Theme = 'system' | 'light' | 'dark';
const KEY = 'pixelize.theme';

let theme: Theme = 'system';

export const getTheme = () => theme;

export function setTheme(t: Theme): void {
  theme = t;
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* storage unavailable */ }
  // canvases read the colors when they draw: let them redraw
  window.dispatchEvent(new Event('themechange'));
}

export function initTheme(): void {
  let saved: string | null = null;
  try { saved = localStorage.getItem(KEY); } catch { /* storage unavailable */ }
  setTheme(saved === 'light' || saved === 'dark' ? saved : 'system');
}
