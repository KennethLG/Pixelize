// Animated GIF encoder. Pixel art palettes are tiny, so every frame maps
// straight to one global color table; no quantization needed.

import { keyAt, rgbOfKey } from '../core/color';
import { ByteWriter } from './bytes';

// LZW as the GIF spec wants it (same scheme as omggif's encoder).
export function lzwEncode(indices: Uint8Array, minCodeSize: number): number[] {
  const out: number[] = [];
  let cur = 0, bits = 0;
  const clearCode = 1 << minCodeSize, eoi = clearCode + 1;
  let codeSize = minCodeSize + 1, next = eoi + 1;
  let table = new Map<number, number>();
  const emit = (code: number) => {
    cur |= code << bits;
    bits += codeSize;
    while (bits >= 8) { out.push(cur & 255); cur >>>= 8; bits -= 8; }
  };
  emit(clearCode);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const hit = table.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clearCode);
      next = eoi + 1; codeSize = minCodeSize + 1; table = new Map();
    } else {
      if (next >= 1 << codeSize) codeSize++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (bits > 0) out.push(cur & 255);
  return out;
}

/**
 * Frames are RGBA buffers of w×h, upscaled by `scale` (nearest neighbor).
 * Delays are in hundredths of a second. Alpha below 128 becomes transparent.
 * Without `loop` there is no NETSCAPE block, so viewers play it once.
 */
export function encodeGif(frames: Uint8ClampedArray[], w: number, h: number, scale: number, delays: number[], loop: boolean): Uint8Array {
  const counts = new Map<number, number>();
  let hasAlpha = false;
  for (const d of frames) for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) { hasAlpha = true; continue; }
    const k = keyAt(d, i);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  const off = hasAlpha ? 1 : 0; // index 0 is the transparent color
  const keep = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 256 - off).map((e) => e[0]);
  const index = new Map(keep.map((k, n) => [k, n + off]));
  // colors past the 256 limit go to the nearest kept one
  const nearest = (k: number) => {
    const c = rgbOfKey(k);
    let best = off, bd = Infinity;
    keep.forEach((q, n) => {
      const r = rgbOfKey(q);
      const d = (r[0] - c[0]) ** 2 + (r[1] - c[1]) ** 2 + (r[2] - c[2]) ** 2;
      if (d < bd) { bd = d; best = n + off; }
    });
    index.set(k, best);
    return best;
  };
  let bits = 1;
  while (1 << bits < Math.max(2, keep.length + off)) bits++;

  const W = w * scale, H = h * scale;
  const out = new ByteWriter();
  out.ascii('GIF89a');
  out.u16(W); out.u16(H);
  out.byte(0x80 | 0x70 | (bits - 1)); out.byte(0); out.byte(0);
  for (let n = 0; n < 1 << bits; n++) {
    const k = n - off;
    const c = k >= 0 && k < keep.length ? rgbOfKey(keep[k]) : [0, 0, 0];
    out.byte(c[0]); out.byte(c[1]); out.byte(c[2]);
  }
  if (loop) {
    out.byte(0x21); out.byte(0xff); out.byte(0x0b);
    out.ascii('NETSCAPE2.0');
    out.byte(0x03); out.byte(0x01); out.u16(0); out.byte(0);
  }
  const minCode = Math.max(2, bits);
  const idx = new Uint8Array(W * H);
  frames.forEach((d, f) => {
    // disposal 2 (clear) when there is transparency, so frames do not pile up
    out.byte(0x21); out.byte(0xf9); out.byte(0x04);
    out.byte(hasAlpha ? (2 << 2) | 1 : 1 << 2);
    out.u16(Math.max(2, Math.round(delays[f])));
    out.byte(0); out.byte(0);
    out.byte(0x2c); out.u16(0); out.u16(0); out.u16(W); out.u16(H); out.byte(0);
    for (let y = 0; y < H; y++) {
      const sy = Math.floor(y / scale);
      for (let x = 0; x < W; x++) {
        const i = (sy * w + Math.floor(x / scale)) * 4;
        if (d[i + 3] < 128) { idx[y * W + x] = 0; continue; }
        const k = keyAt(d, i);
        const v = index.get(k);
        idx[y * W + x] = v === undefined ? nearest(k) : v;
      }
    }
    out.byte(minCode);
    const data = lzwEncode(idx, minCode);
    for (let p = 0; p < data.length; p += 255) {
      const chunk = data.slice(p, p + 255);
      out.byte(chunk.length);
      out.bytes(chunk);
    }
    out.byte(0);
  });
  out.byte(0x3b);
  return out.result();
}
