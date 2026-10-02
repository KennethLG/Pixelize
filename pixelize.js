#!/usr/bin/env node
// Turns "fake" pixel art (e.g. ChatGPT images: big, uneven simulated pixels,
// noisy colors) into real pixel art: detects the pixel grid, samples one color
// per cell and snaps every color to a small shared palette.
//
// Usage: node pixelize.js <input> [options]
//   -o, --out <file>      output PNG (default: <input>_pixel.png)
//   --colors <n>          force exactly n palette colors (k-means)
//   --tolerance <dE>      auto palette: merge colors closer than this (Lab deltaE, default 10)
//   --cell <px>           skip detection and use this cell size (can be fractional)
//   --size <WxH>          skip detection and force this output size, e.g. 64x64
//   --preview <n>         also write a preview scaled n times (default 8, 0 = off)
//   --palette             also write the palette as <out>_palette.png and print hex codes
//   --alpha <0-255>       cells with alpha below this become transparent (default 128)

const sharp = require('sharp');
const path = require('path');

function parseArgs(argv) {
  const opts = { tolerance: 10, preview: 8, alpha: 128 };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '-o' || a === '--out') opts.out = next();
    else if (a === '--colors') opts.colors = parseInt(next(), 10);
    else if (a === '--tolerance') opts.tolerance = parseFloat(next());
    else if (a === '--cell') opts.cell = parseFloat(next());
    else if (a === '--size') {
      const m = /^(\d+)x(\d+)$/i.exec(next() || '');
      if (!m) throw new Error('--size must look like 64x64');
      opts.size = [parseInt(m[1], 10), parseInt(m[2], 10)];
    }
    else if (a === '--preview') opts.preview = parseInt(next(), 10);
    else if (a === '--palette') opts.palette = true;
    else if (a === '--alpha') opts.alpha = parseInt(next(), 10);
    else if (a === '-h' || a === '--help') opts.help = true;
    else rest.push(a);
  }
  opts.input = rest[0];
  return opts;
}

// ---------- grid detection ----------

// Edge strength between column x-1 and x (or row y-1 and y), summed over the image.
function edgeProfiles(data, w, h) {
  const px = new Float64Array(w);
  const py = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (x > 0) {
        const j = i - 4;
        px[x] += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) +
          Math.abs(data[i + 2] - data[j + 2]) + Math.abs(data[i + 3] - data[j + 3]);
      }
      if (y > 0) {
        const j = i - w * 4;
        py[y] += Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) +
          Math.abs(data[i + 2] - data[j + 2]) + Math.abs(data[i + 3] - data[j + 3]);
      }
    }
  }
  return { px, py };
}

// How well a comb of period s lines up with the edge peaks (best phase).
// Each tooth takes the max in a +-1 px window, so slightly uneven grids still score.
function combScore(profile, s) {
  const n = profile.length;
  let best = 0;
  let bestPhase = 0;
  const phaseStep = Math.max(0.5, s / 16);
  for (let phase = 0; phase < s; phase += phaseStep) {
    let sum = 0;
    let count = 0;
    for (let pos = phase; pos < n; pos += s) {
      const c = Math.round(pos);
      let m = 0;
      for (let k = c - 1; k <= c + 1; k++) if (k > 0 && k < n && profile[k] > m) m = profile[k];
      sum += m;
      count++;
    }
    const score = count ? sum / count : 0;
    if (score > best) { best = score; bestPhase = phase; }
  }
  return { score: best, phase: bestPhase };
}

// Smooth the profile a bit and remove the slowly varying part so only sharp
// cell boundaries stand out.
function normalizeProfile(p) {
  const n = p.length;
  const out = new Float64Array(n);
  const r = 4;
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let k = i - r; k <= i + r; k++) if (k >= 0 && k < n) { s += p[k]; c++; }
    out[i] = Math.max(0, p[i] - s / c);
  }
  return out;
}

// Positions of clear cell boundaries: local maxima well above the noise floor.
// Blur makes one boundary a few px wide, so nearby maxima collapse into one.
function findPeaks(profile) {
  const n = profile.length;
  const sorted = [...profile].sort((a, b) => a - b);
  const high = sorted[Math.floor(n * 0.98)] || sorted[n - 1];
  const threshold = high * 0.3;
  const peaks = [];
  for (let i = 1; i < n - 1; i++) {
    const v = profile[i];
    if (v < threshold || v < profile[i - 1] || v < profile[i + 1]) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && i - last < 3) {
      if (v > profile[last]) peaks[peaks.length - 1] = i;
    } else {
      peaks.push(i);
    }
  }
  return peaks;
}

// Whether gap g is a whole number of cells of size s (within tol px).
function gapFits(g, s, tol) {
  const cells = Math.max(1, Math.round(g / s));
  return Math.abs(g - cells * s) <= tol;
}

// Cell size from the gaps between boundaries. A gap spans one or more cells
// (neighbor cells with the same color show no edge), so a good s makes most
// gaps a whole number of cells. Tiny sizes fit any gap by chance, so each
// candidate is scored as (gaps that fit) minus (gaps expected to fit at random).
// Stray edges from noise or jpeg blocks just count as misses.
function detectCellSize(px, py, w, h) {
  const nx = normalizeProfile(px);
  const ny = normalizeProfile(py);
  const gaps = [];
  for (const peaks of [findPeaks(nx), findPeaks(ny)]) {
    for (let i = 1; i < peaks.length; i++) gaps.push(peaks[i] - peaks[i - 1]);
  }
  if (gaps.length < 4) return { cell: 1, nx, ny };
  const maxS = Math.min(Math.max(...gaps), Math.min(w, h) / 4);
  const tolFor = (s) => Math.max(1.5, s * 0.12);
  let best = { s: 1, score: -Infinity };
  for (let s = 2; s <= maxS; s += 0.05) {
    const tol = tolFor(s);
    let fit = 0;
    for (const g of gaps) if (gapFits(g, s, tol)) fit++;
    const score = fit / gaps.length - Math.min(1, (2 * tol) / s);
    if (score > best.score) best = { s, score };
  }
  // refine: average cell size measured by the short gaps that fit
  const tol = tolFor(best.s);
  let sum = 0;
  let count = 0;
  for (const g of gaps) {
    const cells = Math.max(1, Math.round(g / best.s));
    if (cells <= 3 && gapFits(g, best.s, tol)) { sum += g; count += cells; }
  }
  return { cell: count ? sum / count : best.s, nx, ny };
}

// Walk along the axis placing a cut every ~cell px, snapping each cut to the
// strongest edge nearby. Handles grids whose cells are not all the same size.
function snapCuts(profile, n, cell) {
  const peaks = findPeaks(profile);
  const window = Math.max(1, Math.round(cell * 0.3));
  const strong = Math.max(...profile) * 0.05;
  const cuts = [0];
  // start from the first real boundary, extrapolated back toward the image edge
  let pos = peaks.length ? peaks[0] : combScore(profile, cell).phase;
  while (pos - cell >= cell * 0.5) pos -= cell;
  if (pos < cell * 0.5) pos += cell;
  while (pos < n - cell * 0.5) {
    const c = Math.round(pos);
    let bestK = c;
    let bestV = -1;
    for (let k = c - window; k <= c + window; k++) {
      if (k > cuts[cuts.length - 1] + cell * 0.5 && k < n && profile[k] > bestV) { bestV = profile[k]; bestK = k; }
    }
    const cut = bestV >= strong ? bestK : c;
    cuts.push(cut);
    pos = cut + cell;
  }
  cuts.push(n);
  // A sliver at the start or end is the image border, not a real cell.
  if (cuts.length > 2 && cuts[1] - cuts[0] < cell * 0.5) cuts.splice(1, 1);
  if (cuts.length > 2 && cuts[cuts.length - 1] - cuts[cuts.length - 2] < cell * 0.5) cuts.splice(cuts.length - 2, 1);
  return cuts;
}

function uniformCuts(n, count) {
  const cuts = [];
  for (let i = 0; i <= count; i++) cuts.push(Math.round((i * n) / count));
  return cuts;
}

// ---------- cell sampling ----------

// One color per cell: ignore the blurry border of the cell and take the most
// common color of the inside (averaged within its bucket), so antialiasing and
// noise do not leak in.
function sampleCells(data, w, xs, ys, alphaCut) {
  const ow = xs.length - 1;
  const oh = ys.length - 1;
  const out = new Uint8ClampedArray(ow * oh * 4);
  for (let cy = 0; cy < oh; cy++) {
    for (let cx = 0; cx < ow; cx++) {
      const x0 = xs[cx], x1 = xs[cx + 1], y0 = ys[cy], y1 = ys[cy + 1];
      const mx = Math.floor((x1 - x0) * 0.2);
      const my = Math.floor((y1 - y0) * 0.2);
      const buckets = new Map();
      let alphaSum = 0;
      let n = 0;
      for (let y = y0 + my; y < Math.max(y0 + my + 1, y1 - my); y++) {
        for (let x = x0 + mx; x < Math.max(x0 + mx + 1, x1 - mx); x++) {
          const i = (y * w + x) * 4;
          const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
          alphaSum += a;
          n++;
          if (a < alphaCut) continue;
          const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
          let e = buckets.get(key);
          if (!e) { e = [0, 0, 0, 0]; buckets.set(key, e); }
          e[0] += r; e[1] += g; e[2] += b; e[3]++;
        }
      }
      const o = (cy * ow + cx) * 4;
      if (alphaSum / n < alphaCut || buckets.size === 0) {
        out[o + 3] = 0;
        continue;
      }
      let best = null;
      for (const e of buckets.values()) if (!best || e[3] > best[3]) best = e;
      out[o] = best[0] / best[3];
      out[o + 1] = best[1] / best[3];
      out[o + 2] = best[2] / best[3];
      out[o + 3] = 255;
    }
  }
  return { pixels: out, width: ow, height: oh };
}

// ---------- palette ----------

function srgbToLinear(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function rgbToLab(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

// Unique opaque colors with their counts.
function collectColors(pixels) {
  const map = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) continue;
    const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([key, count]) => {
    const rgb = [(key >> 16) & 255, (key >> 8) & 255, key & 255];
    return { key, rgb, lab: rgbToLab(...rgb), count };
  });
}

// Refine centers as the weighted mean of their members (in RGB, Lab for distance).
function refine(colors, centers, iterations) {
  for (let it = 0; it < iterations; it++) {
    const acc = centers.map(() => [0, 0, 0, 0]);
    for (const c of colors) {
      let bi = 0, bd = Infinity;
      for (let k = 0; k < centers.length; k++) {
        const d = dist2(c.lab, centers[k].lab);
        if (d < bd) { bd = d; bi = k; }
      }
      const a = acc[bi];
      a[0] += c.rgb[0] * c.count; a[1] += c.rgb[1] * c.count; a[2] += c.rgb[2] * c.count; a[3] += c.count;
    }
    centers = acc.filter((a) => a[3] > 0).map((a) => {
      const rgb = [Math.round(a[0] / a[3]), Math.round(a[1] / a[3]), Math.round(a[2] / a[3])];
      return { rgb, lab: rgbToLab(...rgb), count: a[3] };
    });
  }
  return centers;
}

// Auto palette: the most common colors become palette entries, and every other
// color within `tolerance` of an entry is merged into it.
function autoPalette(colors, tolerance) {
  const sorted = [...colors].sort((a, b) => b.count - a.count);
  const t2 = tolerance * tolerance;
  let centers = [];
  for (const c of sorted) {
    if (!centers.some((p) => dist2(p.lab, c.lab) < t2)) centers.push({ rgb: c.rgb, lab: c.lab });
  }
  centers = refine(colors, centers, 5);
  // Refining can drift two entries together; merge them again.
  const merged = [];
  for (const c of centers.sort((a, b) => b.count - a.count)) {
    if (!merged.some((p) => dist2(p.lab, c.lab) < t2)) merged.push(c);
  }
  return refine(colors, merged, 3);
}

// Fixed palette size: k-means++ in Lab.
function kmeansPalette(colors, k) {
  if (colors.length <= k) return colors.map((c) => ({ rgb: c.rgb, lab: c.lab }));
  const sorted = [...colors].sort((a, b) => b.count - a.count);
  const centers = [{ rgb: sorted[0].rgb, lab: sorted[0].lab }];
  while (centers.length < k) {
    let best = null, bestScore = -1;
    for (const c of colors) {
      const d = Math.min(...centers.map((p) => dist2(p.lab, c.lab)));
      const score = d * Math.sqrt(c.count);
      if (score > bestScore) { bestScore = score; best = c; }
    }
    centers.push({ rgb: best.rgb, lab: best.lab });
  }
  return refine(colors, centers, 20);
}

function applyPalette(pixels, palette) {
  const cache = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] === 0) { pixels[i] = pixels[i + 1] = pixels[i + 2] = 0; continue; }
    const key = (pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2];
    let p = cache.get(key);
    if (!p) {
      const lab = rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2]);
      let bd = Infinity;
      for (const q of palette) {
        const d = dist2(lab, q.lab);
        if (d < bd) { bd = d; p = q; }
      }
      cache.set(key, p);
    }
    pixels[i] = p.rgb[0]; pixels[i + 1] = p.rgb[1]; pixels[i + 2] = p.rgb[2];
  }
}

const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

// ---------- main ----------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.input) {
    console.log(require('fs').readFileSync(__filename, 'utf8').split('\n').slice(1, 15).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
    process.exit(opts.input ? 0 : 1);
  }

  const { data, info } = await sharp(opts.input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  console.log(`Input: ${w}x${h}`);

  let xs, ys;
  if (opts.size) {
    xs = uniformCuts(w, opts.size[0]);
    ys = uniformCuts(h, opts.size[1]);
    console.log(`Forced size: ${opts.size[0]}x${opts.size[1]}`);
  } else {
    const { px, py } = edgeProfiles(data, w, h);
    let cell, nx, ny;
    if (opts.cell) {
      cell = opts.cell;
      nx = normalizeProfile(px);
      ny = normalizeProfile(py);
    } else {
      ({ cell, nx, ny } = detectCellSize(px, py, w, h));
    }
    xs = snapCuts(nx, w, cell);
    ys = snapCuts(ny, h, cell);
    const widths = xs.slice(1).map((v, i) => v - xs[i]);
    const minW = Math.min(...widths), maxW = Math.max(...widths);
    console.log(`Detected cell size: ~${cell.toFixed(2)} px (cells vary ${minW}-${maxW} px)`);
  }

  const small = sampleCells(data, w, xs, ys, opts.alpha);
  console.log(`Output size: ${small.width}x${small.height}`);

  const colors = collectColors(small.pixels);
  const palette = opts.colors ? kmeansPalette(colors, opts.colors) : autoPalette(colors, opts.tolerance);
  applyPalette(small.pixels, palette);
  palette.sort((a, b) => a.lab[0] - b.lab[0]);
  console.log(`Palette: ${palette.length} colors (from ${colors.length} sampled)`);

  const parsed = path.parse(opts.input);
  const out = opts.out || path.join(parsed.dir, `${parsed.name}_pixel.png`);
  const raw = { raw: { width: small.width, height: small.height, channels: 4 } };
  await sharp(Buffer.from(small.pixels.buffer), raw).png().toFile(out);
  console.log(`Wrote ${out}`);

  const outParsed = path.parse(out);
  if (opts.preview > 0) {
    const prev = path.join(outParsed.dir, `${outParsed.name}_x${opts.preview}.png`);
    await sharp(Buffer.from(small.pixels.buffer), raw)
      .resize(small.width * opts.preview, small.height * opts.preview, { kernel: 'nearest' })
      .png().toFile(prev);
    console.log(`Wrote ${prev}`);
  }

  if (opts.palette) {
    const pal = Buffer.alloc(palette.length * 4);
    palette.forEach((p, i) => { pal[i * 4] = p.rgb[0]; pal[i * 4 + 1] = p.rgb[1]; pal[i * 4 + 2] = p.rgb[2]; pal[i * 4 + 3] = 255; });
    const palFile = path.join(outParsed.dir, `${outParsed.name}_palette.png`);
    await sharp(pal, { raw: { width: palette.length, height: 1, channels: 4 } }).png().toFile(palFile);
    console.log(`Wrote ${palFile}`);
    console.log(palette.map((p) => hex(p.rgb)).join(' '));
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
} else {
  module.exports = { edgeProfiles, normalizeProfile, findPeaks, detectCellSize, snapCuts };
}
