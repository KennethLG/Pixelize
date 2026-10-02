// One color per grid cell.

export interface Pixels {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

// Takes the most common color of the cell's center (averaged within its
// bucket), so the blurred cell borders and noise do not leak in.
export function sampleCells(data: Uint8ClampedArray, w: number, xs: number[], ys: number[], alphaCut: number): Pixels {
  const ow = xs.length - 1, oh = ys.length - 1;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let cy = 0; cy < oh; cy++) {
    for (let cx = 0; cx < ow; cx++) {
      const x0 = xs[cx], x1 = xs[cx + 1], y0 = ys[cy], y1 = ys[cy + 1];
      const mx = Math.floor((x1 - x0) * 0.2), my = Math.floor((y1 - y0) * 0.2);
      const buckets = new Map<number, [number, number, number, number]>();
      let alphaSum = 0, n = 0;
      for (let y = y0 + my; y < Math.max(y0 + my + 1, y1 - my); y++) {
        for (let x = x0 + mx; x < Math.max(x0 + mx + 1, x1 - mx); x++) {
          const i = (y * w + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          alphaSum += a; n++;
          if (a < alphaCut) continue;
          const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
          let e = buckets.get(key);
          if (!e) { e = [0, 0, 0, 0]; buckets.set(key, e); }
          e[0] += r; e[1] += g; e[2] += b; e[3]++;
        }
      }
      const o = (cy * ow + cx) * 4;
      if (alphaSum / n < alphaCut || buckets.size === 0) { out[o + 3] = 0; continue; }
      let best: [number, number, number, number] | null = null;
      for (const e of buckets.values()) if (!best || e[3] > best[3]) best = e;
      const b = best!;
      out[o] = b[0] / b[3]; out[o + 1] = b[1] / b[3]; out[o + 2] = b[2] / b[3]; out[o + 3] = 255;
    }
  }
  return { pixels: out, width: ow, height: oh };
}
