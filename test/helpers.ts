// Test fixtures and an independent GIF decoder to check the encoder against.

import type { SourceImage } from '../src/core/grid';
import { defaultOptions, processImage, type ProcessOptions } from '../src/core/pipeline';

// A perfectly regular grid of n×n cells of `cell` px (may be fractional),
// with neighbors always different in color.
export function regularGrid(n: number, cell: number): SourceImage {
  const w = Math.round(n * cell);
  const data = new Uint8ClampedArray(w * w * 4);
  const edge = (i: number) => Math.round(i * cell);
  for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
    const v = ((cx * 7 + cy * 13) % 5) * 50;
    for (let y = edge(cy); y < edge(cy + 1); y++) for (let x = edge(cx); x < edge(cx + 1); x++) {
      const i = (y * w + x) * 4;
      data[i] = v; data[i + 1] = (v + 80) % 255; data[i + 2] = 255 - v; data[i + 3] = 255;
    }
  }
  return { data, w, h: w };
}

export function run(src: SourceImage, patch: (o: ProcessOptions) => void = () => {}) {
  const o = defaultOptions();
  patch(o);
  return processImage(src, {}, o);
}

export interface DecodedGif {
  width: number;
  height: number;
  table: [number, number, number][];
  loop: boolean;
  frames: { indices: number[]; delay: number; transparent: number | null; disposal: number }[];
}

export function decodeGif(u: Uint8Array): DecodedGif {
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let p = 6;
  const width = dv.getUint16(p, true), height = dv.getUint16(p + 2, true), packed = u[p + 4];
  p += 7;
  const size = 1 << ((packed & 7) + 1);
  const table: [number, number, number][] = [];
  for (let i = 0; i < size; i++) table.push([u[p + i * 3], u[p + i * 3 + 1], u[p + i * 3 + 2]]);
  p += size * 3;
  const frames: DecodedGif['frames'] = [];
  let loop = false, gce = { delay: 0, transparent: null as number | null, disposal: 0 };
  while (p < u.length) {
    const b = u[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      const label = u[p++];
      if (label === 0xf9) gce = { disposal: (u[p + 1] >> 2) & 7, delay: dv.getUint16(p + 2, true), transparent: u[p + 1] & 1 ? u[p + 4] : null };
      if (label === 0xff) loop = true;
      while (u[p] !== 0) p += u[p] + 1;
      p++;
      continue;
    }
    if (b !== 0x2c) throw new Error(`unknown block ${b}`);
    p += 9;
    const min = u[p++];
    const data: number[] = [];
    while (u[p] !== 0) { for (let k = 1; k <= u[p]; k++) data.push(u[p + k]); p += u[p] + 1; }
    p++;
    const clear = 1 << min, eoi = clear + 1;
    let dict: number[][] = [], cs = min + 1, prev: number[] | null = null, bit = 0;
    const out: number[] = [];
    const reset = () => { dict = []; for (let i = 0; i < clear; i++) dict[i] = [i]; dict[clear] = []; dict[eoi] = []; cs = min + 1; prev = null; };
    reset();
    for (;;) {
      let code = 0;
      for (let k = 0; k < cs; k++) { const bi = bit + k; if ((data[bi >> 3] >> (bi & 7)) & 1) code |= 1 << k; }
      bit += cs;
      if (bit > data.length * 8 + 16) throw new Error('ran past the data');
      if (code === clear) { reset(); continue; }
      if (code === eoi) break;
      let entry: number[];
      if (code < dict.length && code !== clear && code !== eoi) entry = dict[code];
      else if (code === dict.length && prev) entry = [...prev, prev[0]];
      else throw new Error(`bad code ${code}`);
      out.push(...entry);
      if (prev) { dict.push([...prev, entry[0]]); if (dict.length === 1 << cs && cs < 12) cs++; }
      prev = entry;
    }
    frames.push({ indices: out, ...gce });
  }
  return { width, height, table, loop, frames };
}
