// Reading palette files: GIMP .gpl ("R G B name" lines) or anything with hex
// codes (.hex from Lospec, .txt, pasted text).

import { keyOf, type RGB } from './color';

export function parsePaletteText(text: string): RGB[] {
  const out: RGB[] = [];
  const seen = new Set<number>();
  const add = (r: number, g: number, b: number) => {
    const k = keyOf(r, g, b);
    if (!seen.has(k)) { seen.add(k); out.push([r, g, b]); }
  };
  const gimp = /^GIMP Palette/m.test(text) || (/^\s*\d{1,3}\s+\d{1,3}\s+\d{1,3}/m.test(text) && !/[0-9a-f]{6}/i.test(text));
  if (gimp) {
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/.exec(line);
      if (m) add(Math.min(255, +m[1]), Math.min(255, +m[2]), Math.min(255, +m[3]));
    }
  } else {
    for (const m of text.matchAll(/#?\b([0-9a-f]{6})\b/gi)) {
      const v = parseInt(m[1], 16);
      add((v >> 16) & 255, (v >> 8) & 255, v & 255);
    }
  }
  return out;
}
